import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FlywheelConfig } from '../config/schema.js';
export function redact(input: string): string {
  return input
    .replace(/(Bearer\s+)[a-z0-9._~+/-]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key|token|authorization|password|secret)(["'=:\s]+)([^\s,;"']+)/gi, '$1$2[REDACTED]')
    .replace(/https:\/\/hooks\.slack\.com\/services\/[^\s"']+/gi, '[REDACTED_SLACK_WEBHOOK]')
    .slice(0, 6000);
}
export function sameAllowedHost(url: string, hosts: string[]): boolean {
  try {
    const target = new URL(url);
    return ['https:', 'http:'].includes(target.protocol) && hosts.includes(target.hostname.toLowerCase());
  } catch { return false; }
}
export function safeSourcePath(projectRoot: string, file: string, allowedPrefixes: string[]): string {
  if (file.includes('\\') || file.includes('\0') || isAbsolute(file)) throw new Error('Unsafe patch path');
  const fullPath = resolve(projectRoot, file);
  const rel = relative(projectRoot, fullPath).split(sep).join('/');
  if (!rel || rel === '..' || rel.startsWith('../') || !allowedPrefixes.some(prefix => rel.startsWith(prefix))) {
    throw new Error(`Disallowed patch path: ${file}`);
  }
  if (rel.split('/').some(part => ['..', '.git', '.github', 'node_modules', '.flywheel', '.vscode'].includes(part))) throw new Error('Unsafe path segment');
  if (/(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.yarnrc|Dockerfile|Makefile)$/i.test(rel) || !/\.[cm]?[jt]sx?$/.test(rel)) throw new Error('Protected or non-source file type');
  return fullPath;
}
export async function readSafeSource(config: FlywheelConfig, file: string): Promise<string> {
  const full = safeSourcePath(config.projectRoot, file, config.patch.allowPaths);
  const actual = await realpath(full);
  const root = await realpath(config.projectRoot);
  const rel = relative(root, actual);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Source path resolves outside root');
  const info = await lstat(full);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Only regular source files may be edited');
  if (info.size > config.limits.maxBytesPerFile) throw new Error('Source file exceeds size cap');
  return await readFile(full, 'utf8');
}
export function budgetExceeded(started: number, maxMs: number): void {
  if (Date.now() - started > maxMs) throw new Error('Workflow deadline exceeded');
}
