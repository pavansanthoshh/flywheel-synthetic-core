import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FlywheelConfig } from '../config/schema.js';
import type { Patch } from '../agents/patchAgent.js';
import { redact } from '../security/policy.js';
import { runCommand, withWorkspace } from './workspace.js';
export type Validation = { passed: boolean; details: string };
export async function validatePatch(config: FlywheelConfig, patch: Patch): Promise<Validation> {
  return withWorkspace(config, patch, async workspace => {
    const nodeModules = join(config.projectRoot, 'node_modules');
    if (!existsSync(nodeModules)) return { passed: false, details: 'Missing host node_modules; run npm install in target repository before validating' };
    for (const command of config.sandbox.commands) {
      const dockerArgs = [
        'run', '--rm', '--pull', 'never', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--read-only', '--pids-limit', '128', '--memory', '1g', '--cpus', '1',
        '--tmpfs', '/tmp:rw,nosuid,size=64m', '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        '-e', 'HOME=/tmp', '--workdir', '/workspace',
        '--mount', `type=bind,src=${workspace},dst=/workspace`,
        '--mount', `type=bind,src=${nodeModules},dst=/workspace/node_modules,readonly`,
        config.sandbox.image, ...command
      ];
      const result = await runCommand('docker', dockerArgs, config.projectRoot, config.sandbox.timeoutMs);
      if (result.code !== 0) return { passed: false, details: redact(`Command [${command.join(' ')}] failed\n${result.output}`) };
    }
    return { passed: true, details: `Passed ${config.sandbox.commands.length} sandbox command(s)` };
  });
}
