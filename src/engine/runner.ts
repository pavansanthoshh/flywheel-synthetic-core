import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { FlywheelConfig, Flow } from '../config/schema.js';
import type { FailureEvidence, RunReport } from './types.js';
import { redact, sameAllowedHost } from '../security/policy.js';

async function executeStep(page: Page, config: FlywheelConfig, step: Flow['steps'][number]): Promise<void> {
  switch (step.type) {
    case 'goto': {
      const url = new URL(step.path, config.baseUrl).toString();
      if (!sameAllowedHost(url, config.allowedHosts)) throw new Error('Navigation target outside allowedHosts');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!sameAllowedHost(page.url(), config.allowedHosts)) throw new Error('Redirected outside allowedHosts');
      break;
    }
    case 'click': await page.locator(step.selector).click(); break;
    case 'fill': {
      const value = process.env[step.env];
      if (!value) throw new Error(`Missing secret environment variable: ${step.env}`);
      await page.locator(step.selector).fill(value);
      break;
    }
    case 'expectVisible': await page.locator(step.selector).waitFor({ state: 'visible' }); break;
    case 'expectText': {
      const text = await page.locator(step.selector).innerText();
      if (!text.includes(step.text)) throw new Error(`Text expectation failed for selector ${step.selector}`);
      break;
    }
    case 'expectURL': {
      if (!page.url().includes(step.pattern)) throw new Error('URL expectation failed');
      break;
    }
  }
}

async function executeFlow(config: FlywheelConfig, flow: Flow): Promise<FailureEvidence | undefined> {
  const browser = await chromium.launch({ headless: true });
  let context: BrowserContext | undefined;
  const id = randomUUID();
  const dir = join(config.artifactsDir, id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  let page: Page | undefined;
  let failure: FailureEvidence | undefined;
  try {
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async route => {
      if (sameAllowedHost(route.request().url(), config.allowedHosts)) await route.continue();
      else await route.abort('blockedbyclient');
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage();
    page.setDefaultTimeout(config.limits.flowTimeoutMs);
    page.on('console', msg => { if (msg.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(redact(msg.text())); });
    page.on('pageerror', error => { if (consoleErrors.length < 20) consoleErrors.push(redact(error.message)); });
    page.on('requestfailed', req => {
      if (failedRequests.length < 20) failedRequests.push(redact(`${req.method()} ${new URL(req.url()).origin}${new URL(req.url()).pathname}: ${req.failure()?.errorText ?? 'failed'}`));
    });
    for (const step of flow.steps) await executeStep(page, config, step);
    await context.tracing.stop();
  } catch (err) {
    const tracePath = join(dir, 'trace.zip');
    const screenshotPath = join(dir, 'failure.png');
    try { await page?.screenshot({ path: screenshotPath, fullPage: false }); } catch { /* best effort */ }
    try { await context?.tracing.stop({ path: tracePath }); } catch { /* best effort */ }
    failure = {
      id, flowId: flow.id, time: new Date().toISOString(), message: redact(err instanceof Error ? err.message : String(err)),
      url: page?.url() ?? config.baseUrl, consoleErrors, failedRequests, screenshotPath, tracePath
    };
  } finally {
    await browser.close();
  }
  return failure;
}

export async function runSynthetics(config: FlywheelConfig, onFailure?: (failure: FailureEvidence) => Promise<void>): Promise<RunReport> {
  const report: RunReport = { succeeded: [], failures: [] };
  for (const flow of config.flows) {
    let failure: FailureEvidence | undefined;
    try { failure = await executeFlow(config, flow); }
    catch (error) {
      failure = { id: randomUUID(), flowId: flow.id, time: new Date().toISOString(),
        message: redact(error instanceof Error ? error.message : String(error)), url: config.baseUrl, consoleErrors: [], failedRequests: [] };
    }
    if (failure) {
      report.failures.push(failure);
      if (onFailure) await onFailure(failure);
    } else report.succeeded.push(flow.id);
  }
  return report;
}
