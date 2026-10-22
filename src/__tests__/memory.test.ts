import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintFailure, JsonlIncidentStore } from '../flywheel/memory.js';

test('incidents persist and retrieve by normalized fingerprint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flywheel-test-'));
  try {
    const fail = { id: 'a', flowId: 'home', time: new Date().toISOString(), url: 'http://localhost',
      message: 'selector failed at line 122', consoleErrors: [], failedRequests: [] };
    const store = new JsonlIncidentStore(join(dir, 'incidents.jsonl'));
    await store.record({ id: fail.id, fingerprint: fingerprintFailure(fail), time: fail.time, flowId: fail.flowId,
      symptom: fail.message, outcome: 'unresolved' });
    const results = await store.findSimilar({ ...fail, id: 'b', message: 'selector failed at line 567' });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, 'a');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
