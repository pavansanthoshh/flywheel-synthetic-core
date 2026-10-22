import { z } from 'zod';
import type { FlywheelConfig } from '../config/schema.js';
import { readSafeSource } from '../security/policy.js';
import { ClaudeGateway } from './client.js';
import type { Triage } from './triageAgent.js';
import type { Context } from './contextAgent.js';

export const patchSchema = z.object({
  summary: z.string().min(1).max(500),
  explanation: z.string().min(1).max(3000),
  edits: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(6)
});
export type Patch = z.infer<typeof patchSchema>;

export async function patchAgent(gateway: ClaudeGateway, config: FlywheelConfig, triage: Triage,
  context: Context, priorFailure?: string): Promise<Patch> {
  const originals = await Promise.all(context.candidateFiles.map(async path => ({ path, content: await readSafeSource(config, path) })));
  const proposed = await gateway.ask('strong', 'Fix and Patch Agent: replace minimal permitted source files and preserve unrelated behavior', {
    triage, context, originals, priorValidationFailure: priorFailure?.slice(0, 3500),
    outputContract: 'edits must contain complete replacement contents for existing candidateFiles, not unified diff. No new files.'
  }, patchSchema);
  if (proposed.edits.length > config.limits.maxFilesChanged) throw new Error('Too many files changed');
  const names = new Set(context.candidateFiles);
  const changed = new Set<string>();
  for (const edit of proposed.edits) {
    if (!names.has(edit.path) || changed.has(edit.path)) throw new Error('Unauthorized or duplicate patch file');
    changed.add(edit.path);
    if (Buffer.byteLength(edit.content, 'utf8') > config.limits.maxBytesPerFile) throw new Error('Patch exceeds byte limit');
    await readSafeSource(config, edit.path);
  }
  return proposed;
}
