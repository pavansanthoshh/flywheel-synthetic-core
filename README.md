# @flywheel/synthetic-core

A guarded synthetic-monitoring and incident-investigation framework for Node.js frontend repositories. Flywheel runs browser journeys with Playwright, sends failure notifications, and can use specialized Claude roles to propose changes. Approved proposals are validated in a disposable Git worktree and Docker sandbox. Draft GitHub pull requests are **opt-in**.

> **Status:** v0.1 engineering scaffold. It has not undergone a security audit, enterprise production certification, or full external-integration test. Review the limitations in `docs/architecture.md` before using it with sensitive repositories.

## What it does

- Runs configurable Playwright Chromium flows against an already-running application.
- Captures failure messages, console errors, failed requests, screenshots and traces.
- Fans out alerts to optional Slack, PagerDuty and Datadog destinations.
- Uses Anthropic Claude for triage, source-context search, patch proposals and independent review, with strict budgets.
- Restricts patch proposals to existing allowed source files; validates them in a throwaway Git worktree and constrained Docker container.
- Can open a draft GitHub PR only when explicitly configured.
- Stores fingerprinted incident records in local JSONL files, through a replaceable storage interface.

The package **never executes itself during `npm install`** and does not merge or deploy changes.

## Requirements

- Node.js 22 or newer; npm.
- Chromium installed using `npx playwright install chromium`.
- A running target web application, e.g. `http://127.0.0.1:3000`.
- Git and Docker for patch validation. The configured Docker image must be available locally (the validator uses `--pull never`).
- An `ANTHROPIC_API_KEY` to enable AI investigation; optional alert credentials and `GITHUB_TOKEN` for integrations.
- A **clean Git checkout** for assisted patch proposals.

## Quick start

To try this source repository locally:

```sh
npm install
npm run build
npm test
npm link
# In a test frontend repository:
flywheel init
flywheel doctor
flywheel run
```

`flywheel run` returns a failing exit code when synthetic journeys fail. That is intentional for CI. A failed test may also initiate an investigation if auto-patch mode is enabled.

**Note:** This package has not been published to npm. Use the local source workflow above until publication.

## Configuration

`flywheel init` creates `flywheel.config.json`. See `examples/flywheel.config.json` for an example. Key sections:

| Property | Description |
| --- | --- |
| `baseUrl`, `allowedHosts` | Base address and allowed hostnames for browser traffic. |
| `flows` | Ordered browser actions and assertions. `fill` reads values from named environment variables. |
| `patch.mode` | `disabled`, `dry-run` (default), or `draft-pr`. |
| `patch.allowPaths` | Paths in the host repo that may be considered for code changes. |
| `sandbox.commands` | **Trusted**, operator-specified executable/argument arrays run inside Docker. |
| `limits` | Bounded workflow duration, agent calls, patch attempts and files. |
| `models.fast`, `models.strong` | Claude model IDs; configure available models for your account. |
| `github` | Required with `draft-pr` mode: owner, repository, base branch. |

### Environment variables

```sh
ANTHROPIC_API_KEY=               # Claude-powered triage and patch analysis
SLACK_WEBHOOK_URL=               # Optional; Slack Incoming Webhook
PAGERDUTY_ROUTING_KEY=           # Optional; PagerDuty Events API v2
DD_API_KEY=                       # Optional; Datadog metrics
DD_SITE=datadoghq.com            # Optional site override
GITHUB_TOKEN=                    # Optional; only used in draft-pr mode
```

Never commit real credentials. Add your `flywheel.config.json` to Git only if it contains no secrets and its target URL/source paths are appropriate to share.

## Security and known limitations

The AI can make mistakes; no patch is trusted solely because an LLM approved it. Browser and source inputs can contain prompt injection or secrets. This scaffold uses basic redaction and file allowlists but is **not sufficient for sensitive production logs or untrusted code** without additional controls (egress policy, structured PII filtering, separate sandbox VMs and enterprise secret governance). Docker with no network and limited privileges reduces risk but is not equivalent to a hostile-code isolation guarantee.

The current runner supports Playwright, not Puppeteer. Knowledge memory is local JSONL and simple fingerprint matching, not a vector database. The CLI does not provide an integrated scheduler. Alert delivery is best-effort. Multi-runner deduplication, PR-storm prevention, global quota enforcement and hardened model-data redaction remain future work.

More technical detail and an explicit roadmap: [docs/architecture.md](docs/architecture.md).
