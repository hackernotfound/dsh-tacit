# Architecture

*For contributors. Read [How it works](how-it-works.md) first for the behaviour;
this page maps it onto files, harness hooks, routes and storage. Tacit is plain ES
modules — no bundler, no TypeScript step.*

## Modules

| File | Lines | Responsibility | Tests |
| --- | --- | --- | --- |
| `lib/index.js` | ~90 | plugin entry: legacy storage rename, service + store wiring, registers projection, system-prompt section, `agent/pre-step` listener and routes | `test/integration.test.mjs` |
| `lib/fold.js` | ~300 | the `tacitTimeline` projection: session events → per-turn digests (pure fold, bounded, masked, `stateVersion: 4`) | `test/fold.test.mjs` |
| `lib/redact.js` | ~50 | `SECRET_PATTERNS` and `redactSecrets(text)`: the credential shapes masked as `[redacted:…]` at capture | `test/redact.test.mjs` |
| `lib/analyze.js` | ~900 | prompts, tool schemas, heuristics (messy / correction / continuation), report normalisation, trust score, steering renderer, the single `callCoachModel` transport | `test/analyze.test.mjs`, `calls`, `trust` |
| `lib/service.js` | ~1450 | the host service: auto triggers, trials, verification, bootstrap, distillations, steering freeze, pre-send, every route handler | `test/integration.test.mjs` (stubbed harness) |
| `lib/routes.js` | ~150 | `/api/tacit/*` on the harness web server, JSON body limit, cross-site guard, status mapping | `test/integration.test.mjs` |
| `lib/schema.js` | ~460 | zod schemas: config, digest, report, profile, usage ledger, route argument codecs, model allowlist | `test/schema.test.mjs` |
| `lib/store.js` | ~370 | `~/.dsh/storages/tacit/` — atomic JSON writes, reports, profile, usage day files, expiry, clear | `test/store.test.mjs` |
| `lib/usage.js` | ~700 | the usage/cost ledger: runs and attempts (synchronous, content-free), the rolling summary, day files, and the report/run/clear read side | `test/usage.test.mjs` |
| `lib/pricing.js` | ~290 | pure price arithmetic: the bundled DeepSeek list prices, off-peak/peak tiers, `costOf`, `costMeter` state normalisation | `test/pricing.test.mjs` |
| `lib/pricing-source.js` | ~130 | the live price source: the optional `costMeter` sibling when it answers, the bundled table otherwise; `refresh()` never throws and never blocks a call | `test/pricing.test.mjs` |
| `client/src/*.js` | ~3400 | the whole browser UI, one file per section (`10-i18n`, `20-api`, `30-session-store`, `40-root-store`, `50-format`, `55-usage-format`, `60-components`, `65-feedback-strip`, `68-section-card`, `69-confirm-dialog`, `70-panel`, `72-usage-panel`, `80-css`, `90-plugin`); `scripts/build-client.mjs` concatenates them into the shipped `client/client.js` (one classic script per plugin is all the harness loads) | `test/client.test.mjs` (SSR render of the built file), `pnpm check:client` |
| `scripts/smoke.mjs` | — | live HTTP smoke against a running `dsh web` | — |
| `scripts/rehearse.mjs` | — | live rehearsal: packs the plugin, installs it into a throwaway `DSH_HOME`, drives real headless turns, and asserts on what landed on disk | — |
| `scripts/check-ci-logs.mjs` | — | log audit: reads the repo's own recent GitHub Actions run logs through `gh` and scans them for credentials, personal paths, addresses and any words listed in `TACIT_LOG_DENY`; the `scanLines` half is pure | `test/ci-logs.test.mjs` |

## Harness hooks (host side)

| Hook | Plain language | Where |
| --- | --- | --- |
| `ctx.sessionProjections` unit `tacitTimeline` | Tacit's per-turn digest, derived from the session log; the browser reads it with `useProjection('tacitTimeline')` | `fold.js`, `index.js` |
| `sessionProjections.onChanged` | the only trigger source — on every change: `maybeAutoAnalyze → recordTrialTurns → handleVerification`; no polling | `service.js` |
| `ctx.systemPrompt.section({ name: 'tacit:steering', order: 60 })` | the directives block for that session's workspace (`session.header.cwd`: its own scoped directives first, then global); text and the injected directive ids captured once per session object (`WeakMap`, plus a bounded id map by session id for trials) | `index.js`, `service.js` |
| `agent/pre-step` (waterfall) | opt-in `enrichPrompts`: append one plugin-sourced user message on step 1 | `service.js` |
| `ctx.llm.stream` | every model call: allowlisted model, session's provider route, `reasoningEffort: 'low'` (one retry without it if unsupported), tool schema, `maxTokens`, timeout, `sessionId` | `analyze.js` |
| `webServer` routes | the JSON API below | `routes.js` |

Fork guard: a forked session's log starts with events copied from the parent,
carrying the parent's timestamps. The fold skips events older than the session's
own `createdAt` so they are not counted twice.

## Browser slots (`client/src/90-plugin.js`)

| Slot | id | order | Component |
| --- | --- | --- | --- |
| `conversation.view` | `tacit` | 30 | Tacit tab |
| `conversation.input.left` | `tacit-improve` | 100 | ✨ Improve button |
| `conversation.input.overlay` | `tacit-preview` | 10 | before/after preview |
| `conversation.input.dock` | `tacit-feedback` | 10 | 👍/👎 strip (the row above the composer; `composer.dock` is hidden by the harness until a conversation has content) |
| `settings.section` | `tacit` | 32 | Settings → Tacit |

Vanilla `React.createElement` via `window.__ModuleLoader__`; locale namespace
`dsh-tacit`, zh and en dictionaries must have identical key sets (a test enforces it).

**Slots unchanged.** The usage/cost dashboard (Usage and Pricing cards, the
Data & privacy card's retention/warning controls) is entirely new content
inside the existing `settings.section` slot's own DOM — it registers no new
slot and does not touch the four conversation-view slots above.

## HTTP routes

All `POST`, JSON in / JSON out, on the harness web server (no extra port), body
≤ 256 KiB, every route (including read-only ones) passes the cross-site guard.

| Route | Body | Returns |
| --- | --- | --- |
| `/api/tacit/state` | — | config, profile, `auto {today, budget}`, `steering {enabled, text}`, bootstrap progress |
| `/api/tacit/reports` | `{sessionId}` | reports of that session keyed by turn |
| `/api/tacit/history` | `{limit?}` (≤ 500) | latest reports across sessions |
| `/api/tacit/analyze` | `{sessionId, turn, force?}` | report + profile; codes `no-session`, `not-retained`, `continuation`, `already-analyzed` (the turn already has a report; no model call and no ledger run unless `force: true`), `busy`, `empty-response`, `timeout`, `no-api-key`, `no-credit`, `rate-limited`, `call-failed` |
| `/api/tacit/analyze-batch` | `{sessionId, turns, force?}` (1–50 turns, deduped and sorted) | one `analysis-batch` run over the picked turns: `results [{turn, ok, code, report}]` (a turn already being analyzed reports `busy`, one that already has a report reports `already-analyzed` unless `force: true`; both cost nothing and count as `skipped`, and a batch of nothing else closes as `success`), profile, run summary |
| `/api/tacit/improve` | `{sessionId, draft}` | `improved`, `rationale`, `rewriteId`, `patternsUsed` |
| `/api/tacit/applied` | `{sessionId, rewriteId}` | ok (starts free verification) |
| `/api/tacit/feedback` | `{rewriteId, verdict: up\|down, reason?}` | profile |
| `/api/tacit/directives` | `{action: toggle\|add\|rescope\|remove\|start-trial, …}` (`rescope` takes `id` and a `workspace`, `''` for global) | profile + steering |
| `/api/tacit/directive-receipt` | `{id}` | that directive's receipt: text, scope, status, source, enabled, `createdAt`/`updatedAt`/`evaluatedAt`/`approvedAt`, `version`, its trial counters and baselines, `retiredReason`, the trigger counts and evidence ids derived from its evidence, and `cost {runId, calls, usd}` read from the ledger (`usd` is `null` when the run is unknown or none of its attempts is priced); never prompt text. `unknown-directive` when no directive has that id |
| `/api/tacit/stats` | `{window?}` (3–200, default 20) | trend early vs. recent |
| `/api/tacit/bootstrap` | `{sessionId?, limit?}` (1–50, default 20) | analyzed / skipped / directives; `busy` if one is running |
| `/api/tacit/bootstrap-preview` | `{sessionId?, limit?}` (1–50, default 20) | what a bootstrap would do: `eligible` / `skipped` counts and `estimate {usd, basis: measured\|doc, samples, perAnalysisUsd}` (the ledger's median once 3 priced analyses exist in 30 days, the doc figure otherwise). No model call, no run, never `busy` |
| `/api/tacit/config` | `{patch}` | effective config; non-allowlisted model → 400 |
| `/api/tacit/clear` | — | `removed` count |
| `/api/tacit/usage` | `{range?, type?, status?, model?, workspace?, sessionId?, page?, pageSize?}` (range `today\|7d\|30d\|month\|all`, default `30d`; status `running\|success\|partial\|failed`; page ≥ 1, pageSize ≤ 100) | `today`/`month`/`last7`/`last30`/`lifetime` totals, `series7`/`series30`, `byType`/`byModel`/`byProvider`/`byTrigger`, `auto {today, budget}`, `warnings`, one page of `runs`, price-source status |
| `/api/tacit/usage-run` | `{runId}` | that run with its attempt rows (a live run included); `unknown-run` once its day expired |
| `/api/tacit/usage-clear` | — | `removed` day files + the new `trackingSince` |
| `/api/tacit/pricing-refresh` | — | price-source status + both models' off-peak/peak rates |

Status codes: wrong method → 405; cross-site guard (`Sec-Fetch-Site` not
same-origin/none, `Origin` host ≠ `Host`, or non-JSON content type) → 403;
bad JSON → 400; handler `bad-request` / `unknown-rewrite` → 400; every other
`ok: false` → 200 with a `code`; thrown → 500.

## Storage

`~/.dsh/storages/tacit/` (root = `$DSH_HOME` or `~/.dsh`): `config.patch.json`,
`profile.json`, `auto.json`, `reports/<sessionId>/<turn>.json` (a report records the conversation's absolute workspace directory as `cwd`; a directive may carry a `workspace` it is limited to),
`usage/<YYYY-MM-DD>.json` (one day of ledger runs and their attempts) and
`usage/summary.json` (the rolling lifetime / byType / byModel / byProvider /
byTrigger / per-day totals, so a report never re-scans the day files; day
buckets are kept for 400 days, far past the 30 any range reads). Each directive in `profile.json` carries its
provenance next to its text: `updatedAt`, `version`, the ids of the reports its
distillation read, `distillationRunId`, `evaluatedAt` and `approvedAt`. A
directive you removed stays in the profile, so the distiller can be told not to
propose it again. Day files are
parsed once and served from an in-memory memo keyed on the file's mtime and
size, bounded by total size, so the ten-second poll behind the cost panel
re-reads nothing that has not changed. The ledger is content-free: ids,
counts, tokens and money only — no prompts, no responses, no tool arguments, and
`workspace` is the directory's last segment, never the full path. Session ids are
sanitised to `[A-Za-z0-9._-]{1,128}`. Writes go to a `.tmp-<pid>-<time>` file
then `rename`. Deletion is limited to three paths, all over the plugin's own
files: `clearReports()` (`reports/*/<n>.json`), day-file expiry after
`costHistoryDays` (7–365), and `usage-clear` — the last two unlink only files
matching `^\d{4}-\d{2}-\d{2}\.json$` inside `usage/` and never remove the
directory itself. On first start a legacy `storages/prompt-coach` directory is renamed
to `tacit` if the new one does not exist (nothing is deleted; safe to drop after 0.3).

## Development

Official `@deepseek-ai/*` packages are **peer dependencies**: an installed Tacit
uses the copies the running harness provides (dsh links them into
`~/.dsh/profiles/node_modules` when it boots), never a private nested copy, so the objects it
hands to the host are built by the host's own version. They are also
`devDependencies` so a checkout can run the tests without a harness.
`scripts/check-install.mjs <profile dir>` asserts this against a real install;
the weekly `compatibility.yml` runs it against `@deepseek-ai/dsh@latest`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the checkout/link workflow, the
restart-vs-refresh rule, tests, smoke and the ground rules.

---

← [Docs index](README.md)
