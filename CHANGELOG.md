# Changelog

## Unreleased

- Docs overhaul, no code changes: new *Getting started* and *How it works*
  pages (with a pipeline diagram and glossary), a docs index, and rewritten
  *Configuration*, *Privacy, cost & limitations* and *Architecture* pages as
  tables. Corrected claims to match the code: one JSON repair retry exists,
  only automatic analyses are capped, the style-rule distillation call is not
  session-tagged, the steering budget is 1400 chars (~300 tokens), distillation
  yields 1–4 directives, the provider route is the session's own. README links
  are absolute so they work on npm.

## 0.2.1 — 2026-08-27

- npm package page now shows the English README (the Chinese one moved to
  `docs/README.zh.md`). No code changes.

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
