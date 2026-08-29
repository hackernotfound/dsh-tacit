# Changelog

## Unreleased

- Every Tacit model call is now metered (tokens + list-price cost) into a
  local, content-free usage ledger; new `costHistoryDays`, `costWarnDailyUsd`,
  `costWarnMonthlyUsd` settings.
- ✨ Improve converges in one pass: the rewrite is checked against a fixed
  checklist (goal, context, scope, constraints, output format, efficiency) and
  pulls concrete facts from the recent turns, so one click reaches the finished
  prompt. Improving a finished prompt again returns it unchanged; the preview
  says *already complete* and offers no Apply.

## 0.2.3 — 2026-08-29

- Tacit also learns from a clean prompt that follows a messy one — what you
  included the second time feeds the directives. Automatic, capped like the
  other automatic analyses; off with `learnFromGood: false`.
- Directives can be scoped to a workspace: the distiller scopes a habit that only
  shows up in one project, the add form offers *Everywhere* or a workspace, and
  each conversation gets its own workspace's directives first.
- Distilled directives are one sentence of at most 25 words, and a long one is
  cut at a sentence or word boundary instead of mid-word. Tacit logs one line at
  startup with what it is injecting.
- The 👍/👎 strip after an applied ✨ Improve rewrite now appears on the first
  prompt of a conversation too (it sits in the row above the composer).
- The browser bundle is now generated from `client/src/` (one file per
  section); `client/client.js` itself is unchanged apart from a header line.
- Official `@deepseek-ai/*` packages are peer dependencies: Tacit now uses the
  harness's own copies instead of bundling private ones.
- Directive trials count only turns from conversations whose system prompt
  actually contained the candidate; conversations started earlier no longer
  move its counters.
- Bootstrap can run several analyses at once (`bootstrapConcurrency`, 1–4;
  default 1 keeps today's one-at-a-time behaviour).
- README: new *Help shape Tacit* section pointing to issues, labels and
  Discussions.

## 0.2.2 — 2026-08-29

- Fixed the Improve preview so the first click immediately shows its pending
  state, followed by the rewrite or an in-modal error. DSH reserves the slot
  `hooks` property, so Tacit now injects its subscribed store as a normal prop.
- Added a sanitized Settings → Tacit screenshot and a short demo covering the
  universal `npx` install command, the Tacit conversation tab, learning and an
  editable directive.
- The style-rule distillation call now carries the session id, so cost meters
  attribute it like every other call.
- The bootstrap hint in Settings shows the documented $0.02–0.05 range.

## 0.2.1 — 2026-08-27

- The npm package page now shows the English README; the Chinese translation
  moved to `docs/README.zh.md`.
- Documentation overhaul, with no runtime changes: added *Getting started*,
  *How it works*, a docs index, a pipeline diagram and a glossary; rewrote the
  configuration, privacy/cost and architecture references as tables.
- Corrected documentation claims to match the code: one JSON repair retry
  exists, only automatic analyses are capped, style-rule distillation is not
  session-tagged, steering is capped at 1400 characters, distillation yields
  1–4 directives, and model calls follow the session's provider route.
- README documentation links are absolute so they work from npmjs.com.

## 0.2.0 — 2026-08-27

First public release. Renamed from `dsh-prompt-coach` to **Tacit**; an existing
`~/.dsh/storages/prompt-coach` directory is adopted automatically.

- Zero-click learning: messy turns and your own corrections are analyzed in the
  background, with the previous turn as context. Bare continuations
  ("continue", "go ahead") are never blamed on the prompt.
- Ambient steering: learned directives are injected as a system-prompt section
  you can read, edit, toggle and delete in Settings → Tacit. Directives that
  would make the agent *ask you* instead of compensating are dropped.
- Directive trials: a distilled directive starts as a candidate, runs for
  `directiveTrialTurns` finished turns, then is activated or retired if the
  messy-turn rate rose by more than `directiveWorseBy`.
- Bootstrap: "Learn from my last 20 turns" (this session or every session).
- Measured trend (messy-turn rate, tokens per turn) instead of a guessed
  savings figure.
- ✨ Improve rewrite with 👍/👎 feedback and learned style rules; opt-in
  pre-send context (`enrichPrompts`).
- Tacit's routes refuse cross-site requests (the harness web server has no
  origin policy of its own).
- Removed: the guessed "token savings %" (never shown; no longer requested
  from the model), the unused good-examples library, the `learningThreshold`
  gate (old config keys are ignored, not rejected).

## 0.1.x — `dsh-prompt-coach`

Manual prompt coaching gated behind a learning threshold. Superseded.
