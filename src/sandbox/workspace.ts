import { mkdtemp, rm, writeFile, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import type { FlywheelConfig } from '../config/schema.js';
import type { Patch } from '../agents/patchAgent.js';
import { safeSourcePath } from '../security/policy.js';
export async function runCommand(command: string, args: string[], cwd: string, timeoutMs = 10000): Promise<{ code: number; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = (chunk: Buffer): void => { if (output.length < 12000) output += chunk.toString().slice(0, 12000 - output.length); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, output }); });
  });
}
export async function ensureCleanGit(config: FlywheelConfig): Promise<void> {
  const r = await runCommand('git', ['status', '--porcelain', '--untracked-files=no'], config.projectRoot);
  if (r.code !== 0 || r.output.trim()) throw new Error('Refusing auto-patch: Git tracked working tree is not clean');
}
export async function withWorkspace<T>(config: FlywheelConfig, patch: Patch, work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'flywheel-'));
  let attached = false;
  try {
    const result = await runCommand('git', ['worktree', 'add', '--detach', dir, 'HEAD'], config.projectRoot, 20000);
    if (result.code !== 0) throw new Error(`Could not create isolated Git worktree: ${result.output}`);
    attached = true;
    for (const edit of patch.edits) {
      const originalPath = safeSourcePath(config.projectRoot, edit.path, config.patch.allowPaths);
      const relativePath = relative(config.projectRoot, originalPath);
      if (isAbsolute(relativePath) || relativePath.startsWith('..')) throw new Error('Unexpected out-of-tree patch');
      const destination = join(dir, relativePath);
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe worktree destination');
      const canonical = await realpath(destination);
      const checked = relative(dir, canonical);
      if (isAbsolute(checked) || checked === '..' || checked.startsWith('../')) throw new Error('Worktree escape');
      await writeFile(destination, edit.content, { flag: 'w' });
    }
    return await work(dir);
  } finally {
    if (attached) await runCommand('git', ['worktree', 'remove', '--force', dir], config.projectRoot, 20000).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}
