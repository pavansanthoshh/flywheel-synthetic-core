# Flywheel Synthetic Core — Technical Architecture

**Version:** 0.1 design draft · **Date:** 2026-10-22 · **Audience:** frontend platform, SRE, application security.

## Problem and proposed approach

The failure of a synthetic journey identifies a user-facing symptom, not a cause. Engineers still correlate traces with a codebase, isolate the fault, and verify a fix. Flywheel combines deterministic monitoring and alerting with bounded Claude-assisted investigation. The automation ends at a reviewed **draft pull request**; merging and deploying remain human responsibilities.

A distinguishing design decision is that **only the controller has authority**. Claude proposes classifications and edits, but cannot invoke tools, increase budgets, select arbitrary files or run arbitrary shell commands. No work is performed as an npm-install side effect.

## Flow

```mermaid
sequenceDiagram
    autonumber
    participant CI as CI / Scheduler
    participant PW as Playwright
    participant Ctrl as Orchestrator
    participant Alert as Alert fan-out
    participant AI as Claude roles
    participant Src as Source scanner
    participant Box as Docker / Worktree
    participant GH as GitHub
    CI->>PW: Run configured synthetic flow
    PW-->>Ctrl: Failure and evidence
    Ctrl->>Alert: Send Slack, PagerDuty, Datadog
    Ctrl->>AI: Triage redacted evidence
    AI-->>Ctrl: RCA hypothesis
    Ctrl->>Src: Search allowed files and AST symbols
    Src-->>Ctrl: Candidate source paths
    Ctrl->>AI: Propose minimal patch
    AI-->>Ctrl: Structured file replacements
    Ctrl->>Box: Apply patch and run configured tests
    Box-->>Ctrl: Validation result
    alt Passed
      Ctrl->>AI: Independent review
      AI-->>Ctrl: Accept/reject
      opt Approved and draft-pr enabled
        Ctrl->>GH: Create draft PR + RCA
      end
    else Failed
      Ctrl->>Ctrl: Retry while within limits / human escalation
    end
    Ctrl->>Ctrl: Persist incident outcome
```

## State machine and consensus

The controller progresses through `DETECTED`, `ALERTED`, `TRIAGED`, `CONTEXT_MAPPED`, `PATCH_PROPOSED`, `VALIDATING`, `REVIEWING`, `VALIDATED`, and optionally `PR_CREATED`. `NEEDS_HUMAN` is used for unfixable/low-confidence/exhausted incidents, and `ABORTED` for unexpected infrastructure failures. A retry can return to `PATCH_PROPOSED` only within configured limits.

**PR publication requires every gate:** allowed file policy, real sandbox pass, independent model review, and explicit `draft-pr` configuration. An LLM vote cannot override a test failure. Default caps: six model calls, two patch attempts, three modified files, 25 KB per file, and 180 seconds per workflow (actual controls are in `config/schema.ts`).

## Trust boundaries

1. **Browser evidence → Claude:** Treat HTML, network failures, logs, repository snippets, and previous incidents as untrusted data. Redact passwords, cookies, tokens and PII *before* external transmission. The initial regex filter is insufficient for regulated environments; implement structured allowlisting before sensitive deployments.
2. **Model output → source:** Parse JSON with Zod, only allow existing files under designated prefixes, enforce size caps, exclude symlink and traversal escapes, and do not expose arbitrary file tools to a model.
3. **Source → execution:** Validate in a throwaway Git worktree; run explicitly configured commands via Docker with no network, a non-root user, capped resources and no mounted Docker socket. This is a reference boundary only; a dedicated hardened worker/VM is safer for malicious repository content.
4. **Controller → GitHub:** Restrict token permissions to one repository and draft PRs. Require branch protection and separate human approval. No merging or deployment capabilities exist here.
5. **Evidence → memory:** Store private artifacts under excluded local paths with retention controls. Extend the `IncidentStore` interface for a remote vector database only after tenant separation, redaction, TTL and access-control decisions.

## Production-hardening gaps

- Central scheduler and idempotent incident leases for fleet-wide duplicate suppression.
- Proper request/log and source-code DLP, secret filtering, artifact retention jobs and encryption policies.
- Observability on delivery failures, investigation latency, model usage/cost, agent actions and false-positive fix rates.
- Test-run quarantine for flaky journeys, classification of dependency outages and confidence calibration.
- End-to-end integration fixtures for browser, GitHub, Slack, PagerDuty, Datadog, Anthropic and Docker.
- Global token/concurrency/financial quotas and robust multi-tenant isolation.
- PR branch cleanup on partial publication errors; support for atomic multi-file commits.
- Remote vector embeddings and similarity ranking (local JSONL fingerprint matching only in v0.1).

## Intended rollout

| Phase | Exit criteria |
| --- | --- |
| Detection | Broken sample journey produces deterministic evidence and notification attempt. |
| RCA | Generated incident report includes classification, code candidates and trace references. |
| Guarded repair | Dangerous paths are rejected; sandbox failures never trigger a PR. |
| Draft PR pilot | One safe, validated failure generates a draft PR with RCA and human owner. |
| Scale | Distributed lease, global quota, secret-safe telemetry and operational SLOs implemented. |

## Useful upstream references

- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- Anthropic TypeScript SDK: https://github.com/anthropics/anthropic-sdk-typescript
- GitHub Pull requests API: https://docs.github.com/en/rest/pulls/pulls
- Slack incoming webhooks: https://api.slack.com/messaging/webhooks
- PagerDuty Events API v2: https://developer.pagerduty.com/
- Datadog metrics API: https://docs.datadoghq.com/api/latest/metrics/
