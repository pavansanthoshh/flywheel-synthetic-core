import test from 'node:test';
import assert from 'node:assert/strict';
import { configSchema } from '../config/schema.js';

test('configuration defaults remain dry-run', () => {
  const config = configSchema.parse({ version: 1, baseUrl: 'http://localhost:3000',
    allowedHosts: ['localhost'], flows: [{ id: 'home', steps: [{ type: 'goto', path: '/' }] }] });
  assert.equal(config.patch.mode, 'dry-run');
  assert.equal(config.limits.maxPatchAttempts, 2);
});
test('reject invalid or excessive agent budget', () => {
  assert.equal(configSchema.safeParse({ version: 1, baseUrl: 'http://localhost:3000', allowedHosts: ['localhost'],
    limits: { maxAgentCalls: 1000 }, flows: [{ id: 'a', steps: [{ type: 'goto', path: '/' }] }] }).success, false);
});
