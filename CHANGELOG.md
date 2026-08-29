# Changelog

## Unreleased

- Directive trials count only turns from conversations whose system prompt
  actually contained the candidate; conversations started earlier no longer
  move its counters.
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
