import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative } from 'node:path';
import { configSchema, type FlywheelConfig } from './schema.js';
export async function loadConfig(filePath = 'flywheel.config.json'): Promise<FlywheelConfig> {
  const configFile = resolve(filePath);
  const raw = JSON.parse(await readFile(configFile, 'utf8')) as unknown;
  const parsed = configSchema.parse(raw);
  const projectRoot = await realpath(resolve(dirname(configFile), parsed.projectRoot));
  if (!(await stat(projectRoot)).isDirectory()) throw new Error('projectRoot is not a directory');
  const expectedHost = new URL(parsed.baseUrl).hostname.toLowerCase();
  if (!parsed.allowedHosts.includes(expectedHost)) throw new Error('baseUrl host must appear in allowedHosts');
  const artifactsDir = isAbsolute(parsed.artifactsDir) ? parsed.artifactsDir : resolve(projectRoot, parsed.artifactsDir);
  const rel = relative(projectRoot, artifactsDir);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('artifactsDir must stay within projectRoot');
  if (parsed.patch.mode === 'draft-pr' && !parsed.github) throw new Error('draft-pr mode requires github configuration');
  return { ...parsed, projectRoot, artifactsDir };
}
