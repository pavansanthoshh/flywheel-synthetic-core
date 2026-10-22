import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlywheelConfig } from '../config/schema.js';
import type { FailureEvidence } from '../engine/types.js';
import { alertFailure } from '../alerting/alerts.js';
import { type IncidentStore, fingerprintFailure } from '../flywheel/memory.js';
import { budgetExceeded, redact } from '../security/policy.js';
import { ensureCleanGit } from '../sandbox/workspace.js';
import { validatePatch } from '../sandbox/validator.js';
import { ClaudeGateway } from './client.js';
import { triageAgent } from './triageAgent.js';
import { contextAgent } from './contextAgent.js';
import { patchAgent } from './patchAgent.js';
import { createDraftPr, rcaMarkdown, reviewProposal } from './prAgent.js';

export type ClusterState = 'DETECTED' | 'ALERTED' | 'TRIAGED' | 'CONTEXT_MAPPED' | 'PATCH_PROPOSED' |
  'VALIDATING' | 'REVIEWING' | 'VALIDATED' | 'PR_CREATED' | 'NEEDS_HUMAN' | 'ABORTED';
export type ClusterResult = { failureId: string; state: ClusterState; transitions: ClusterState[]; prUrl?: string; note: string };

export async function handleFailure(config: FlywheelConfig, failure: FailureEvidence, store: IncidentStore): Promise<ClusterResult> {
  const transitions: ClusterState[] = ['DETECTED'];
  const advance = (next: ClusterState): void => { transitions.push(next); state = next; };
  const started = Date.now();
  const fingerprint = fingerprintFailure(failure);
  let outcome: 'failed' | 'unresolved' | 'validated' | 'draft-pr' = 'failed';
  let cause: string | undefined;
  let summary: string | undefined;
  let prUrl: string | undefined;
  let note = '';
  let state: ClusterState = 'DETECTED';
  try {
    const alerts = await alertFailure(failure).catch(error => ({ succeeded: [], failed: [String(error)] }));
    advance('ALERTED');
    note = `Alerts delivered: ${alerts.succeeded.join(', ') || 'none'}; failed: ${alerts.failed.join(', ') || 'none'}.`;
    if (config.patch.mode === 'disabled' || config.limits.maxPatchAttempts === 0) {
      outcome = 'unresolved'; advance('NEEDS_HUMAN');
      return { failureId: failure.id, state: 'NEEDS_HUMAN', transitions, note: note + ' Auto-fix disabled.' };
    }
    await ensureCleanGit(config);
    const prior = await store.findSimilar(failure);
    const gateway = new ClaudeGateway(config);
    const triage = await triageAgent(gateway, failure, prior);
    advance('TRIAGED');
    if (triage.confidence < config.patch.confidenceThreshold) {
      cause = triage.probableCause;
      outcome = 'unresolved'; advance('NEEDS_HUMAN');
      return { failureId: failure.id, state: 'NEEDS_HUMAN', transitions, note: note + ' Low RCA confidence.' };
    }
    budgetExceeded(started, config.limits.workflowTimeoutMs);
    const context = await contextAgent(gateway, config, triage);
    cause = context.rootCause;
    advance('CONTEXT_MAPPED');
    let previousValidation = '';
    for (let attempt = 1; attempt <= config.limits.maxPatchAttempts; attempt++) {
      budgetExceeded(started, config.limits.workflowTimeoutMs);
      const patch = await patchAgent(gateway, config, triage, context, previousValidation);
      summary = patch.summary;
      advance('PATCH_PROPOSED');
      const artifactDir = join(config.artifactsDir, failure.id);
      await mkdir(artifactDir, { recursive: true, mode: 0o700 });
      await writeFile(join(artifactDir, 'proposal.json'), JSON.stringify(patch, null, 2), { mode: 0o600 });
      await writeFile(join(artifactDir, 'rca.md'), rcaMarkdown(failure, triage, context, patch), { mode: 0o600 });
      advance('VALIDATING');
      const validation = await validatePatch(config, patch);
      if (!validation.passed) { previousValidation = validation.details; continue; }
      advance('REVIEWING');
      const review = await reviewProposal(gateway, failure, triage, context, patch);
      if (!review.approve) { previousValidation = `Agent reviewer rejected: ${review.concerns.join('; ')}`; continue; }
      advance('VALIDATED');
      outcome = 'validated';
      if (config.patch.mode === 'draft-pr') {
        prUrl = await createDraftPr(config, failure, triage, context, patch);
        advance('PR_CREATED'); outcome = 'draft-pr';
        note += ' Draft PR created after sandbox and reviewer gates.';
        return { failureId: failure.id, state: 'PR_CREATED', transitions, prUrl, note };
      }
      note += ` Validated proposal available at ${artifactDir}; remote mutations disabled.`;
      return { failureId: failure.id, state: 'VALIDATED', transitions, note };
    }
    outcome = 'unresolved'; advance('NEEDS_HUMAN');
    return { failureId: failure.id, state: 'NEEDS_HUMAN', transitions, note: note + ` Patch attempts exhausted. ${redact(previousValidation).slice(0, 800)}` };
  } catch (error) {
    advance('ABORTED');
    return { failureId: failure.id, state: 'ABORTED', transitions, note: note + ` ${redact(error instanceof Error ? error.message : String(error))}` };
  } finally {
    await store.record({ id: failure.id, fingerprint, time: failure.time, flowId: failure.flowId, symptom: failure.message,
      rootCause: cause, patchSummary: summary, outcome, prUrl }).catch(error => {
      console.error('[flywheel] incident persistence failed:', redact(String(error)));
    });
  }
}
