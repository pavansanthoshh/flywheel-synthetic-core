import type { FailureEvidence } from '../engine/types.js';
import { redact } from '../security/policy.js';
async function postJson(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<void> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Alert endpoint returned HTTP ${response.status}`);
}
export async function alertFailure(failure: FailureEvidence): Promise<{ succeeded: string[]; failed: string[] }> {
  const tasks: Array<[string, () => Promise<void>]> = [];
  const summary = `Flywheel synthetic failure [${failure.flowId}]: ${redact(failure.message).slice(0, 500)}`;
  if (process.env.SLACK_WEBHOOK_URL) {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (new URL(webhook).hostname !== 'hooks.slack.com') throw new Error('Slack webhook hostname must be hooks.slack.com');
    tasks.push(['slack', () => postJson(webhook, { text: summary })]);
  }
  if (process.env.PAGERDUTY_ROUTING_KEY) tasks.push(['pagerduty', () =>
    postJson('https://events.pagerduty.com/v2/enqueue', {
      routing_key: process.env.PAGERDUTY_ROUTING_KEY, event_action: 'trigger',
      dedup_key: `flywheel:${failure.flowId}`, payload: {
        summary, source: 'flywheel-synthetic-core', severity: 'error', timestamp: failure.time,
        custom_details: { flowId: failure.flowId, failureId: failure.id }
      }
    })]);
  if (process.env.DD_API_KEY) {
    const site = process.env.DD_SITE ?? 'datadoghq.com';
    if (!['datadoghq.com', 'datadoghq.eu', 'us3.datadoghq.com', 'us5.datadoghq.com', 'ap1.datadoghq.com'].includes(site)) {
      throw new Error('Unrecognized Datadog site');
    }
    tasks.push(['datadog', () => postJson(`https://api.${site}/api/v2/series`, {
      series: [{ metric: 'flywheel.synthetic.failure', type: 3,
        points: [{ timestamp: Math.floor(Date.now() / 1000), value: 1 }],
        resources: [{ name: 'flywheel-synthetic-core', type: 'host' }] }]
    }, { 'DD-API-KEY': process.env.DD_API_KEY! })]);
  }
  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  const output = { succeeded: [] as string[], failed: [] as string[] };
  settled.forEach((outcome, index) => {
    const provider = tasks[index]?.[0] ?? 'unknown';
    if (outcome.status === 'fulfilled') output.succeeded.push(provider);
    else output.failed.push(provider);
  });
  return output;
}
