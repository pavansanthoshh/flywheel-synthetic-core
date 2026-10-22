import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { FailureEvidence } from '../engine/types.js';
import { redact } from '../security/policy.js';
export type MemoryRecord = {
  id: string; fingerprint: string; time: string; flowId: string; symptom: string;
  rootCause?: string; patchSummary?: string; outcome: 'failed' | 'unresolved' | 'validated' | 'draft-pr'; prUrl?: string;
};
export interface IncidentStore {
  record(item: MemoryRecord): Promise<void>;
  findSimilar(failure: FailureEvidence, limit?: number): Promise<MemoryRecord[]>;
}
export function fingerprintFailure(failure: FailureEvidence): string {
  return createHash('sha256').update(`${failure.flowId}:${failure.message.replace(/\d+/g, '#').slice(0, 300)}`).digest('hex').slice(0, 24);
}
export class JsonlIncidentStore implements IncidentStore {
  constructor(private readonly file: string) {}
  async record(item: MemoryRecord): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, JSON.stringify({ ...item, symptom: redact(item.symptom), rootCause: item.rootCause && redact(item.rootCause) }) + '\n', { mode: 0o600 });
  }
  async findSimilar(failure: FailureEvidence, limit = 3): Promise<MemoryRecord[]> {
    let items: MemoryRecord[] = [];
    try { items = (await readFile(this.file, 'utf8')).split('\n').filter(Boolean).slice(-1000).map(line => JSON.parse(line) as MemoryRecord); }
    catch { return []; }
    const fingerprint = fingerprintFailure(failure);
    return items.map(item => ({ item, score: (item.fingerprint === fingerprint ? 20 : 0) + (item.flowId === failure.flowId ? 3 : 0) }))
      .filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(result => result.item);
  }
}
export function defaultStore(artifactsDir: string): IncidentStore {
  return new JsonlIncidentStore(join(dirname(artifactsDir), 'incidents.jsonl'));
}
