import { readdir, lstat, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { ClaudeGateway } from './client.js';
import { safeSourcePath } from '../security/policy.js';
import type { FlywheelConfig } from '../config/schema.js';
import type { Triage } from './triageAgent.js';

export const contextSchema = z.object({
  candidateFiles: z.array(z.string()).min(1).max(5),
  rootCause: z.string().max(2000),
  rationale: z.string().max(2000)
});
export type Context = z.infer<typeof contextSchema>;

type Candidate = { path: string; symbols: string[]; excerpt: string };

async function enumerateSources(config: FlywheelConfig): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= 500) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= 500) break;
      if (entry.isSymbolicLink()) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', 'dist', '.flywheel'].includes(entry.name)) await walk(full);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
        const path = relative(config.projectRoot, full).replace(/\\/g, '/');
        try {
          safeSourcePath(config.projectRoot, path, config.patch.allowPaths);
          if ((await lstat(full)).size <= config.limits.maxBytesPerFile) files.push(path);
        } catch { /* skip */ }
      }
    }
  };
  for (const prefix of config.patch.allowPaths) {
    try { await walk(resolve(config.projectRoot, prefix)); } catch { /* optional source folder */ }
  }
  return [...new Set(files)];
}

function symbolsOf(file: string, source: string): string[] {
  const syntax = file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, syntax);
  const symbols: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isVariableDeclaration(node)) {
      if (node.name && symbols.length < 30) symbols.push(node.name.getText(root).slice(0, 90));
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return symbols;
}

export async function contextAgent(gateway: ClaudeGateway, config: FlywheelConfig, triage: Triage): Promise<Context & { snippets: Candidate[] }> {
  const paths = await enumerateSources(config);
  const terms = triage.searchTerms.map(s => s.toLowerCase()).filter(s => s.length >= 3).slice(0, 10);
  const scored: Array<Candidate & { score: number }> = [];
  for (const path of paths) {
    const source = await readFile(resolve(config.projectRoot, path), 'utf8');
    const symbols = symbolsOf(path, source);
    const text = `${path} ${symbols.join(' ')} ${source}`.toLowerCase();
    const score = terms.reduce((n, term) => n + (text.includes(term) ? (path.toLowerCase().includes(term) ? 4 : 1) : 0), 0);
    scored.push({ path, symbols, excerpt: source.slice(0, 7500), score });
  }
  const snippets = scored.sort((a, b) => b.score - a.score).slice(0, 8).map(({ score: _score, ...rest }) => rest);
  if (snippets.length === 0) throw new Error('No permitted source files to inspect');
  const decision = await gateway.ask('fast', 'Context and AST Search Agent: map evidence to only files provided', {
    triage, snippets: snippets.map(s => ({ path: s.path, symbols: s.symbols, excerpt: s.excerpt }))
  }, contextSchema);
  const known = new Set(snippets.map(item => item.path));
  if (!decision.candidateFiles.every(path => known.has(path))) throw new Error('Context agent hallucinated a source path');
  return { ...decision, snippets: snippets.filter(item => decision.candidateFiles.includes(item.path)) };
}
