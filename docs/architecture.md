# Architecture

*For contributors. Read [How it works](how-it-works.md) first for the behaviour;
this page maps it onto files, harness hooks, routes and storage. Tacit is plain ES
modules — no bundler, no TypeScript step.*

## Modules

| File | Lines | Responsibility | Tests |
| --- | --- | --- | --- |
| `lib/index.js` | ~90 | plugin entry: legacy storage rename, service + store wiring, registers projection, system-prompt section, `agent/pre-step` listener and routes | `test/integration.test.mjs` |
| `lib/fold.js` | ~300 | the `tacitTimeline` projection: session events → per-turn digests (pure fold, bounded, `stateVersion: 3`) | `test/fold.test.mjs` |
| `lib/analyze.js` | ~900 | prompts, tool schemas, heuristics (messy / correction / continuation), report normalisation, trust score, steering renderer, the single `callCoachModel` transport | `test/analyze.test.mjs`, `calls`, `trust` |
| `lib/service.js` | ~1050 | the host service: auto triggers, trials, verification, bootstrap, distillations, steering freeze, pre-send, every route handler | `test/integration.test.mjs` (stubbed harness) |
| `lib/routes.js` | ~150 | `/api/tacit/*` on the harness web server, JSON body limit, cross-site guard, status mapping | `test/integration.test.mjs` |
| `lib/schema.js` | ~300 | zod schemas: config, digest, report, profile, route argument codecs, model allowlist | `test/schema.test.mjs` |
| `lib/store.js` | ~220 | `~/.dsh/storages/tacit/` — atomic JSON writes, reports, profile, ledger, clear | `test/store.test.mjs` |
| `client/src/*.js` | ~1700 | the whole browser UI, one file per section (`10-i18n`, `20-api`, `30-session-store`, `40-root-store`, `50-format`, `60-components`, `65-feedback-strip`, `70-panel`, `80-css`, `90-plugin`); `scripts/build-client.mjs` concatenates them into the shipped `client/client.js` (one classic script per plugin is all the harness loads) | `test/client.test.mjs` (SSR render of the built file), `pnpm check:client` |
| `scripts/smoke.mjs` | — | live HTTP smoke against a running `dsh web` | — |

## Harness hooks (host side)

| Hook | Plain language | Where |
| --- | --- | --- |
| `ctx.sessionProjections` unit `tacitTimeline` | Tacit's per-turn digest, derived from the session log; the browser reads it with `useProjection('tacitTimeline')` | `fold.js`, `index.js` |
| `sessionProjections.onChanged` | the only trigger source — on every change: `maybeAutoAnalyze → recordTrialTurns → handleVerification`; no polling | `service.js` |
| `ctx.systemPrompt.section({ name: 'tacit:steering', order: 60 })` | the directives block; text and the injected directive ids captured once per session object (`WeakMap`, plus a bounded id map by session id for trials) | `index.js`, `service.js` |
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
| `conversation.composer.dock` | `tacit-feedback` | 10 | 👍/👎 strip |
| `settings.section` | `tacit` | 32 | Settings → Tacit |

Vanilla `React.createElement` via `window.__ModuleLoader__`; locale namespace
`dsh-tacit`, zh and en dictionaries must have identical key sets (a test enforces it).

## HTTP routes

All `POST`, JSON in / JSON out, on the harness web server (no extra port), body
≤ 256 KiB, every route (including read-only ones) passes the cross-site guard.

| Route | Body | Returns |
| --- | --- | --- |
| `/api/tacit/state` | — | config, profile, `auto {today, budget}`, `steering {enabled, text}`, bootstrap progress |
| `/api/tacit/reports` | `{sessionId}` | reports of that session keyed by turn |
| `/api/tacit/history` | `{limit?}` (≤ 500) | latest reports across sessions |
| `/api/tacit/analyze` | `{sessionId, turn}` | report + profile; codes `no-session`, `not-retained`, `continuation`, `busy`, `empty-response`, `timeout`, `no-api-key`, `rate-limited`, `call-failed` |
| `/api/tacit/improve` | `{sessionId, draft}` | `improved`, `rationale`, `rewriteId`, `patternsUsed` |
| `/api/tacit/applied` | `{sessionId, rewriteId}` | ok (starts free verification) |
| `/api/tacit/feedback` | `{rewriteId, verdict: up\|down, reason?}` | profile |
| `/api/tacit/directives` | `{action: toggle\|add\|remove, …}` | profile + steering |
| `/api/tacit/stats` | `{window?}` (3–200, default 20) | trend early vs. recent |
| `/api/tacit/bootstrap` | `{sessionId?, limit?}` (1–50, default 20) | analyzed / skipped / directives; `busy` if one is running |
| `/api/tacit/config` | `{patch}` | effective config; non-allowlisted model → 400 |
| `/api/tacit/clear` | — | `removed` count |

Status codes: wrong method → 405; cross-site guard (`Sec-Fetch-Site` not
same-origin/none, `Origin` host ≠ `Host`, or non-JSON content type) → 403;
bad JSON → 400; handler `bad-request` / `unknown-rewrite` → 400; every other
`ok: false` → 200 with a `code`; thrown → 500.

## Storage

`~/.dsh/storages/tacit/` (root = `$DSH_HOME` or `~/.dsh`): `config.patch.json`,
`profile.json`, `auto.json`, `reports/<sessionId>/<turn>.json`. Session ids are
sanitised to `[A-Za-z0-9._-]{1,128}`. Writes go to a `.tmp-<pid>-<time>` file
then `rename`. On first start a legacy `storages/prompt-coach` directory is renamed
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
