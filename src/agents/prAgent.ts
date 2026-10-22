import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FlywheelConfig } from '../config/schema.js';
import type { Patch } from './patchAgent.js';
import { readSafeSource, redact } from '../security/policy.js';
import type { FailureEvidence } from '../engine/types.js';
import type { Triage } from './triageAgent.js';
import type { Context } from './contextAgent.js';
import { ClaudeGateway } from './client.js';

class GitHubApi {
  constructor(private readonly owner: string, private readonly repo: string, private readonly token: string) {}
  async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${route}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`, 'content-type': 'application/json',
        'x-github-api-version': '2022-11-28', 'user-agent': 'flywheel-synthetic-core'
      },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${route.split('?')[0]} failed with HTTP ${response.status}`);
    return await response.json() as T;
  }
}

export function rcaMarkdown(failure: FailureEvidence, triage: Triage, context: Context, patch: Patch): string {
  return `## Automated root-cause analysis\n\n**Synthetic flow:** ${failure.flowId}\n**Failure ID:** ${failure.id}\n**Detected:** ${failure.time}\n\n` +
    `### Symptom\n${redact(failure.message)}\n\n### Triage hypothesis\n${redact(triage.probableCause)}\n\n` +
    `**Category:** ${triage.category}; **confidence:** ${triage.confidence.toFixed(2)}\n\n` +
    `### Source analysis\n${redact(context.rootCause)}\n\n` +
    `**Candidate files:** ${context.candidateFiles.join(', ')}\n\n` +
    `### Proposed fix\n${redact(patch.summary)}\n\n${redact(patch.explanation)}\n\n` +
    `### Evidence\n${triage.evidence.map(e => '- ' + redact(e)).join('\n')}\n\n` +
    '### Safety / review\n- Container validation passed.\n- Draft PR requires human review and CI approval.\n- Raw browser artifacts are not attached.\n';
}

export async function createDraftPr(config: FlywheelConfig, failure: FailureEvidence, triage: Triage,
  context: Context, patch: Patch): Promise<string> {
  if (!config.github || config.patch.mode !== 'draft-pr') throw new Error('Draft PR mode not enabled');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing');
  const api = new GitHubApi(config.github.owner, config.github.repo, token);
  const baseName = encodeURIComponent(config.github.base);
  const base = await api.request<{ object: { sha: string } }>('GET', `/git/ref/heads/${baseName}`);
  const contents = await Promise.all(patch.edits.map(async edit => {
    const path = edit.path.split('/').map(encodeURIComponent).join('/');
    const remote = await api.request<{ sha: string; content: string; encoding: string }>('GET', `/contents/${path}?ref=${baseName}`);
    const local = await readSafeSource(config, edit.path);
    if (remote.encoding !== 'base64' || Buffer.from(remote.content.replace(/\s/g, ''), 'base64').toString('utf8') !== local) {
      throw new Error(`Local source differs from GitHub base: ${edit.path}`);
    }
    return { edit, path, sha: remote.sha };
  }));
  const branch = `flywheel/fix-${failure.flowId.slice(0, 30)}-${randomUUID().slice(0, 8)}`;
  await api.request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base.object.sha });
  for (const { edit, path, sha } of contents) {
    await api.request('PUT', `/contents/${path}`, {
      message: `fix(synthetics): ${failure.flowId.slice(0, 65)}`,
      branch, sha, content: Buffer.from(edit.content, 'utf8').toString('base64')
    });
  }
  const pr = await api.request<{ html_url: string }>('POST', '/pulls', {
    title: `fix(synthetics): ${failure.flowId.slice(0, 65)}`,
    head: branch, base: config.github.base,
    body: rcaMarkdown(failure, triage, context, patch), draft: true, maintainer_can_modify: true
  });
  return pr.html_url;
}

const reviewSchema = z.object({ approve: z.boolean(), concerns: z.array(z.string().max(300)).max(10), rationale: z.string().max(1000) });
export type AgentReview = z.infer<typeof reviewSchema>;
export async function reviewProposal(gateway: ClaudeGateway, failure: FailureEvidence, triage: Triage,
  context: Context, patch: Patch): Promise<AgentReview> {
  return gateway.ask('fast', 'PR Agent: independent critical review, reject ambiguous or broad edits', {
    symptom: failure.message, triage, context: { rootCause: context.rootCause, candidateFiles: context.candidateFiles },
    patch: { summary: patch.summary, explanation: patch.explanation,
      edits: patch.edits.map(e => ({ path: e.path, preview: e.content.slice(0, 7000) })) },
    reviewPrinciple: 'Reject security-sensitive, scope-creeping, ungrounded or risky changes.'
  }, reviewSchema);
}
