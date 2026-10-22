import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSourcePath, sameAllowedHost, redact } from '../security/policy.js';

const root = '/home/project';
test('source allowlist rejects escape, absolute paths and lockfiles', () => {
  assert.equal(safeSourcePath(root, 'src/foo.ts', ['src/']), '/home/project/src/foo.ts');
  for (const file of ['../etc/passwd', '/etc/passwd', 'package.json', 'src/../../etc/passwd', 'src/key.pem', 'src/.env']) {
    assert.throws(() => safeSourcePath(root, file, ['src/']));
  }
});
test('navigation blocks foreign hosts and protocols', () => {
  assert.ok(sameAllowedHost('https://example.org/path', ['example.org']));
  assert.equal(sameAllowedHost('https://evil.example.org', ['example.org']), false);
  assert.equal(sameAllowedHost('file:///etc/passwd', ['example.org']), false);
});
test('redacts bearer credentials and Slack webhook URLs', () => {
  const result = redact('Authorization: Bearer abc.DEF https://hooks.slack.com/services/T/B/SECRET');
  assert.ok(!result.includes('abc.DEF'));
  assert.ok(!result.includes('T/B/SECRET'));
});
