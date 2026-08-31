# Changelog

All notable changes to Tacit, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/) (before 1.0, a minor bump for a feature
or a breaking change, a patch for a fix). Each version section is also the text
of its GitHub release; `node scripts/release-notes.mjs <version>` prints it. One
line per change; the PR has the detail.

## [Unreleased]

Nothing yet.

## [0.6.0] - 2026-09-01

One pass over the whole UI: the same card, badge, chip and row idioms on every
surface, fewer visible controls, and a directive receipt you can actually read.

### Upgrading

- Restart `dsh web` after updating; host code only reloads on a restart.
- No new settings, routes or storage changes.

### Changed

- Directive cards carry a status-coloured rail and a pill badge; the receipt
  reads as tiles, a lifecycle timeline, trigger chips and an identity grid. (#54)
- Every settings row shares one shape, and each checkbox setting is a
  whole-sentence clickable label. (#54)
- Turn rows lead with the heading and two actions; tools, steps, tokens and
  retries read as one quiet dot-separated line under the prompt. (#54)
- One rotating chevron marks every card head and disclosure; zero counts are
  hidden, and the Learning and Agent guidance heads summarize while collapsed. (#54)
- The Improve preview leads with what changed and highlights the proposed
  rewrite; the confirm dialog narrows to fit its two buttons. (#54)
- Long prompts expand by clicking the text itself; empty states read as quiet
  dashed panels. (#54)

## [0.5.0] - 2026-08-31

Everything the review on [deepseek-harness discussion #5061](https://github.com/deepseek-ai/deepseek-harness/discussions/5061)
asked for (issues #39 to #44), plus the hardening that went with it.

### Upgrading

- Restart `dsh web` after updating; host code only reloads on a restart.
- Turn digests are recomputed on first load, so credential masking covers the
  retained history too. Nothing to set.
- Profiles migrate on read; existing directives gain their provenance fields.
- New setting `reviewCandidates` (off by default); new route
  `/api/tacit/directive-receipt`.

### Added

- Every directive shows a receipt in Settings: where it came from, its trial,
  what its distillation cost, with *Copy as JSON*; never prompt text. (#49)
- *Review new directives before their trial*: with `reviewCandidates` on, a new
  directive waits until you press *Start trial*. (#49)
- A removed directive stays removed; the distiller cannot propose it, or a
  rewording of it, again. (#49)
- Analyzing a turn that already has a report costs nothing; *Re-analyze* pays
  for a fresh one. (#49)
- *Move to workspace* on every directive, and a *not seen since* chip on a
  workspace with no open session. (#48)
- Usage card: spend by route and by trigger, a tile for failed or repair calls,
  input and output tokens shown apart, the daily cap next to today. (#47)
- The trend chips link to How it works §6 and §10. (#46)
- The privacy page states that Tacit sends no telemetry of any kind. (#49)

### Changed

- A workspace is one normalised path; a conversation anywhere inside it gets
  its directives, deepest workspace first. (#48)
- Same-name workspaces are shown to the distiller as `a/web` and `b/web`. (#48)
- At most 12 workspaces keep distilled directives; typed ones are never
  dropped. (#48)
- Removing or switching off a directive reaches conversations already open;
  adding one still waits for the next. (#49)
- The trend chips say the numbers are a before/after over your own turns, not
  a controlled comparison. (#46)
- A retired directive reads "corrections rose 10% → 30% during its trial". (#46)

### Fixed

- Unticking a candidate frees its scope's trial slot for the next queued
  directive. (#49)
- Two workspaces sharing a folder name no longer cross-wire directives. (#48)
- A directive for a workspace the evidence never named is dropped and logged,
  not applied everywhere. (#48)
- A renamed or moved workspace no longer strands its directives; a candidate
  there pauses until a session opens in it again. (#48)
- ✨ Improve skips background-job notifications and bare "continue" turns when
  it gathers context. (#46)
- Escape out of a confirm dialog returns focus to the button that opened
  it. (#46)

### Security

- Credential-shaped strings (API keys, tokens, JWTs, private keys) are masked
  as a turn is captured, before anything is stored or sent. (#45)
- The steering section states it changes no tool permission, approval or
  sandbox policy, and a directive about those is refused. (#45)
- Every coach prompt treats its input as evidence, never as instructions. (#45)

## [0.4.0] - 2026-08-31

### Changed

- Directive trials are graded on how often you correct the agent; tool errors
  alone no longer retire a directive. (#36)
- One directive per scope is on trial at a time; the rest wait as *queued*. (#36)
- A reworded directive keeps its identity and trial; retired ones are
  remembered so they are not proposed again. (#36)
- The measured trend leads with your correction rate. (#36)
- The cost panel re-reads nothing that has not changed; per-day buckets stop
  at 400 days. (#37)

### Fixed

- A provider out of credit says so instead of a generic failure. (#37)
- *Today* no longer loses a run that crossed midnight. (#37)
- The runs filter can ask for *running*. (#37)
- *Learn from my last 20 turns* no longer shows a previous batch's figures. (#37)
- The retention selector shows a `costHistoryDays` set by hand in YAML. (#37)
- The Pricing rate table stays in the page while collapsed. (#37)
- Tab stays inside the confirm dialog; two accessibility fixes in the run
  list. (#37)

## [0.3.0] - 2026-08-30

### Added

- Every Tacit model call is metered into a local, content-free usage ledger;
  new `costHistoryDays`, `costWarnDailyUsd`, `costWarnMonthlyUsd`. (#33)
- Routes for the ledger and prices, `/api/tacit/bootstrap-preview` (what a
  bootstrap would cost) and `/api/tacit/analyze-batch`. (#33)
- Usage and Pricing cards in Settings: spend tiles, a daily chart, spend by
  operation, warnings, a run list, the rate table and the price source. (#33)
- A Data & privacy card with retention, spend warnings and confirm-gated
  clearing; the bootstrap button shows a live cost estimate. (#33)

### Changed

- Settings → Tacit is eight collapsible cards instead of one long page. (#33)
- ✨ Improve converges in one pass; improving a finished prompt again returns
  it unchanged. (#31)

## [0.2.3] - 2026-08-29

### Added

- Tacit also learns from a clean prompt that follows a messy one
  (`learnFromGood`). (#29)
- Directives can be scoped to a workspace. (#27)
- Bootstrap can run several analyses at once (`bootstrapConcurrency`). (#20)
- README: a *Help shape Tacit* section. (#10)

### Changed

- Distilled directives are one sentence of at most 25 words. (#26)
- The browser bundle is generated from `client/src/`. (#22)
- Official `@deepseek-ai/*` packages are peer dependencies. (#23)

### Fixed

- The 👍/👎 strip appears on a conversation's first prompt too. (#24)
- Directive trials count only turns from conversations steered by the
  candidate. (#21)

## [0.2.2] - 2026-08-29

### Added

- A sanitized Settings screenshot and a short demo. (#8, #9)

### Fixed

- The Improve preview shows its pending state on the first click. (#19)
- The style-rule distillation call carries the session id. (#11)
- The bootstrap hint shows the documented $0.02 to $0.05 range.

## [0.2.1] - 2026-08-27

### Changed

- The npm page shows the English README; the Chinese one moved to
  `docs/README.zh.md`. (#2)
- Documentation overhaul: getting started, how it works, a diagram, a glossary,
  and claims corrected to match the code. (#3)

## [0.2.0] - 2026-08-27

First public release. Renamed from `dsh-prompt-coach` to **Tacit**; an existing
`~/.dsh/storages/prompt-coach` directory is adopted automatically. (#1)

### Added

- Zero-click learning from messy turns and your own corrections.
- Learned directives injected as a system-prompt section you can read, edit,
  toggle and delete in Settings → Tacit.
- Directive trials: a candidate is activated or retired after
  `directiveTrialTurns` turns.
- *Learn from my last 20 turns*.
- A measured trend instead of a guessed savings figure.
- ✨ Improve with 👍/👎 feedback and style rules; opt-in pre-send context.

### Security

- Tacit's routes refuse cross-site requests.

### Removed

- The guessed "token savings %", the good-examples library and the
  `learningThreshold` gate.

## 0.1.x

Published as `dsh-prompt-coach`: manual prompt coaching gated behind a learning
threshold. Superseded.

[Unreleased]: https://github.com/hackernotfound/dsh-tacit/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/hackernotfound/dsh-tacit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/hackernotfound/dsh-tacit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/hackernotfound/dsh-tacit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/hackernotfound/dsh-tacit/releases/tag/v0.2.0
