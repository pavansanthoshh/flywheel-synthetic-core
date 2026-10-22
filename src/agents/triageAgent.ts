import { z } from 'zod';
import type { FailureEvidence } from '../engine/types.js';
import { redact } from '../security/policy.js';
import { ClaudeGateway } from './client.js';

export const triageSchema = z.object({
  probableCause: z.string().max(2000),
  evidence: z.array(z.string().max(500)).max(10),
  searchTerms: z.array(z.string().min(2).max(80)).max(10),
  confidence: z.number().min(0).max(1),
  category: z.enum(['selector', 'rendering', 'routing', 'network', 'permissions', 'data', 'unknown'])
});
export type Triage = z.infer<typeof triageSchema>;

export function triageAgent(gateway: ClaudeGateway, failure: FailureEvidence, pastIncidents: unknown): Promise<Triage> {
  return gateway.ask('fast', 'Triage Agent: identify actual symptoms and hypotheses', {
    failure: { ...failure, message: redact(failure.message), screenshotPath: undefined, tracePath: undefined,
      consoleErrors: failure.consoleErrors.map(redact), failedRequests: failure.failedRequests.map(redact) },
    historicalSimilarIncidents: pastIncidents,
    note: 'Screenshots/traces remain local; only sanitized metadata and log summaries are supplied.'
  }, triageSchema);
}
