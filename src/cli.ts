import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from './config/load.js';
import { runSynthetics } from './engine/runner.js';
import { handleFailure } from './agents/cluster.js';
import { defaultStore } from './flywheel/memory.js';
import { redact } from './security/policy.js';
const SAMPLE_CONFIG = {
  version: 1, projectRoot: '.', baseUrl: 'http://127.0.0.1:3000', allowedHosts: ['127.0.0.1'],
  flows: [{ id: 'landing-page', steps: [{ type: 'goto', path: '/' }, { type: 'expectVisible', selector: 'body' }] }],
  artifactsDir: '.flywheel/artifacts',
  patch: { mode: 'dry-run', allowPaths: ['src/'], confidenceThreshold: 0.7 },
  sandbox: { image: 'node:22-bookworm-slim', commands: [['npm', 'run', 'test:unit']], timeoutMs: 60000 },
  limits: { flowTimeoutMs: 30000, workflowTimeoutMs: 180000, maxAgentCalls: 6, maxPatchAttempts: 2, maxFilesChanged: 3, maxBytesPerFile: 25000 }
};
async function main(): Promise<void> {
  const [, , command = 'help', ...args] = process.argv;
  if (command === 'help' || command === '--help') {
    console.log('Usage: flywheel init | doctor [config] | run [config]'); return;
  }
  if (command === 'init') {
    const target = resolve('flywheel.config.json');
    try { await readFile(target); throw new Error('flywheel.config.json already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await writeFile(target, JSON.stringify(SAMPLE_CONFIG, null, 2) + '\n', { flag: 'wx' });
    console.log(`Created ${target}. Edit before running (the application must already be served).`);
    return;
  }
  const config = await loadConfig(args[0] ?? 'flywheel.config.json');
  if (command === 'doctor') {
    console.log(JSON.stringify({ validConfig: true, projectRoot: config.projectRoot,
      baseUrl: config.baseUrl, mode: config.patch.mode,
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY), hasGitHubToken: Boolean(process.env.GITHUB_TOKEN) }, null, 2));
    return;
  }
  if (command !== 'run') throw new Error(`Unknown subcommand: ${command}`);
  const store = defaultStore(config.artifactsDir);
  const report = await runSynthetics(config, async failure => {
    const result = await handleFailure(config, failure, store);
    console.log(JSON.stringify(result, null, 2));
  });
  console.log(`Synthetic run: ${report.succeeded.length} passing, ${report.failures.length} failing`);
  if (report.failures.length) process.exitCode = 1;
}
main().catch(error => {
  console.error('[flywheel]', redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 2;
});
