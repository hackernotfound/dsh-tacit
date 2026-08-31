# Changelog

All notable changes to Tacit, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/) (before 1.0, a minor bump for a feature
or a breaking change, a patch for a fix). Each version section is also the text
of its GitHub release; `node scripts/release-notes.mjs <version>` prints it.

## [Unreleased]

Nothing yet.

## [0.5.0] - 2026-08-31

Everything the review on [deepseek-harness discussion #5061](https://github.com/deepseek-ai/deepseek-harness/discussions/5061)
asked for (issues #39 to #44), plus the hardening that went with it.

### Upgrading

- Restart `dsh web` after updating; host code only reloads on a restart.
- Turn digests are recomputed on first load (projection state version 4), so
  credential masking applies to the retained history as well. Nothing to set.
- Profiles migrate on read: existing directives gain their provenance fields
  with defaults, and a candidate stored switched off reads back as queued.
- One new setting, `reviewCandidates` (off by default), and one new route,
  `/api/tacit/directive-receipt`.

### Added

- Every directive records where it came from: when its text last changed, its
  version, the analysis reports its distillation read, the ledger run of that
  distillation, when its trial was judged and when you approved it. Settings →
  Tacit shows it as a receipt with *Copy as JSON*; the receipt route returns the
  same record by id, and neither ever carries prompt text. (#49)
- *Review new directives before their trial* (`reviewCandidates`): a freshly
  distilled directive waits as *queued* until you press *Start trial* on it, so
  nothing new is injected unasked. (#49)
- *Remove* keeps a record of the directive. It leaves the list and is never
  injected again, the distiller is told not to propose it, and one that comes
  back by id, by text, or as a close rewording (token overlap of 0.6 or more)
  stays removed. Retired and removed directives share one budget of 6. (#49)
- Analyzing a turn that already has a report costs nothing: `/api/tacit/analyze`
  and `/api/tacit/analyze-batch` answer `already-analyzed` with no model call and
  no ledger run; `force: true` (the *Re-analyze* button) pays for a fresh one.
  A batch of nothing but such turns closes as a success. (#49)
- A *Move to workspace* picker on every directive (`rescope` on the directives
  route) and a *not seen since* chip on a workspace no open session is in. (#48)
- The Usage card splits spend by route and by trigger next to the by-operation
  table, shows what failed or repair calls cost as their own tile, separates
  input and output tokens in the tiles and every run row, and shows the daily
  automatic-analysis cap next to today's spend. The ledger keeps `byProvider`,
  `byTrigger`, `failedCalls` and `failedUsd`. (#47)
- The trend chips carry a tooltip pointing at How it works §6 and §10. (#46)
- The privacy page states that Tacit sends no telemetry or analytics of any
  kind; the only network traffic is the model call through the harness. (#49)

### Changed

- A workspace is one normalised path (`..` resolved, trailing slash dropped,
  symlinks followed), and a conversation started anywhere inside it gets its
  directives, deepest workspace first. Two workspaces that share a folder name
  are shown to the distiller as `a/web` and `b/web`. At most 12 workspaces keep
  distilled directives; the least recently seen one loses its set first, and
  directives you typed yourself are never dropped this way. (#48)
- Removing a directive or switching one off reaches the conversations you
  already have open; adding or rewording one still waits for the next. (#49)
- The trend chips say the numbers are a before/after over your own turns, not a
  controlled comparison, and a retired directive reads "corrections rose
  10% → 30% during its trial" rather than as a verdict it earned. (#46)

### Fixed

- Unticking a candidate frees its scope's trial slot: it returns to *queued*
  with its trial reset and the next queued directive starts at once. (#49)
- Two workspaces sharing a folder name no longer cross-wire their directives,
  and a directive the distiller returns for a name none of the evidence carried
  is dropped and logged instead of applied everywhere. (#48)
- Renaming or moving a workspace no longer strands its directives: a candidate
  on trial there pauses and frees the slot until a session opens in that
  workspace again. (#48)
- ✨ Improve reads past background-job notifications and bare "continue" turns
  when it gathers recent context, so the first click sees the last exchange you
  wrote. (#46)
- Escape out of a confirm dialog returns focus to the button that opened it,
  not to the Settings close button; confirming does too. (#46)

### Security

- Credential-shaped strings are masked as a turn is captured. An API key, a
  token, a JWT, a private-key block or a `key=value` secret in a prompt, a tool
  argument or an answer becomes `[redacted:…]` in the turn digest, which is what
  reports, corrections, the recent-conversation context and every model call
  read. The shapes are listed in `lib/redact.js`. (#45)
- The steering section states that it does not change which tools may run or
  what needs approval, and a directive about permissions, approvals, the
  sandbox or elevated execution is refused, whether distilled or typed. (#45)
- Every coach prompt frames its input as evidence about you rather than as
  instructions; text inside a rule, a reason, an example or the conversation is
  read as data. (#45)

## [0.4.0] - 2026-08-31

### Changed

- Directive trials are graded on how often you *correct* the agent: a candidate
  is retired when its correction rate rises more than `directiveWorseBy` above
  the baseline; the messy-turn rate only retires it past twice that margin, so
  tool errors alone no longer sink a directive you never pushed back on. (#36)
- One directive per scope (global, or one workspace) is on trial at a time; the
  rest of a distillation waits as *queued* (greyed, not injected) and starts its
  own trial, with fresh baselines, when the previous verdict lands. (#36)
- A distillation that rewords a directive keeps its identity (id, state, trial
  progress, on/off) instead of restarting it; retired directives (the last 6)
  are kept and handed to the distiller as *do not re-propose*, and one that
  comes back anyway stays retired. (#36)
- The measured trend in Settings → Tacit leads with your correction rate, then
  messy turns and tokens per turn. (#36)
- The cost panel is cheaper to leave open: day files are parsed once and reused
  until they change, and the rolling summary's per-day buckets stop at 400
  days. (#37)

### Fixed

- A provider that has run out of credit says so (`insufficient_quota`,
  `INSUFFICIENT_BALANCE`) instead of a generic failure or a rate limit. (#37)
- *Today* no longer loses a run that crossed midnight; it is listed under today
  whenever any of its calls happened today, so the tile and the run list agree.
  (#37)
- The runs filter can ask for *running*. (#37)
- *Learn from my last 20 turns* stops showing the previous batch's figures when
  there is nothing to analyze, and stops calling a finished batch the live one.
  (#37)
- The retention selector shows a `costHistoryDays` set by hand in YAML even
  when it is not one of the offered values. (#37)
- The Pricing rate table stays in the page while its card is collapsed, so
  find-in-page reaches it. (#37)
- Tab stays inside the confirm dialog, the run list calls a bootstrap's scope
  *all sessions*, and the expanded attempt rows carry the column span
  assistive technology needs. (#37)

## [0.3.0] - 2026-08-30

### Added

- Every Tacit model call is metered (tokens and list-price cost, priced from
  the bundled DeepSeek table or the optional `dsh-cost-meter` sibling) into a
  local, content-free usage ledger of runs and attempts; new `costHistoryDays`,
  `costWarnDailyUsd` and `costWarnMonthlyUsd` settings. (#33)
- Routes `/api/tacit/usage`, `/api/tacit/usage-run`, `/api/tacit/usage-clear`,
  `/api/tacit/pricing-refresh`, `/api/tacit/bootstrap-preview` (what a
  bootstrap would cost) and `/api/tacit/analyze-batch` (analyze exactly the
  turns you pick as one run). (#33)
- A Usage card (today / this month / last 30 days / lifetime spend, a daily
  spend chart, spend by operation, budget warning bars, filters and a paginated
  run list) and a Pricing card (the list-price rate table, the tier in force,
  the price source, *Refresh prices*). (#33)
- A Data & privacy card: what a usage record holds, a retention selector, the
  two spend-warning thresholds, and confirm-gated *Clear usage history* and
  *Clear all analysis reports*. *Learn from my last 20 turns* shows a live cost
  estimate. (#33)

### Changed

- Settings → Tacit is eight collapsible cards instead of one long page. (#33)
- ✨ Improve converges in one pass against a fixed checklist and pulls concrete
  facts from the recent turns; improving a finished prompt again returns it
  unchanged and the preview says *already complete*. (#31)

## [0.2.3] - 2026-08-29

### Added

- Tacit also learns from a clean prompt that follows a messy one; off with
  `learnFromGood: false`. (#29)
- Directives can be scoped to a workspace: the distiller scopes a habit that
  only shows up in one project, the add form offers *Everywhere* or a
  workspace, and each conversation gets its own workspace's directives first.
  (#27)
- Bootstrap can run several analyses at once (`bootstrapConcurrency`, 1 to 4).
  (#20)
- README: a *Help shape Tacit* section pointing to issues, labels and
  Discussions. (#10)

### Changed

- Distilled directives are one sentence of at most 25 words, cut at a sentence
  or word boundary; Tacit logs one line at startup with what it injects. (#26)
- The browser bundle is generated from `client/src/`, one file per section.
  (#22)
- Official `@deepseek-ai/*` packages are peer dependencies, so Tacit uses the
  harness's own copies. (#23)

### Fixed

- The 👍/👎 strip after an applied ✨ Improve rewrite appears on the first
  prompt of a conversation too. (#24)
- Directive trials count only turns from conversations whose system prompt
  actually contained the candidate. (#21)

## [0.2.2] - 2026-08-29

### Added

- A sanitized Settings → Tacit screenshot and a short demo covering the `npx`
  install command, the Tacit conversation tab, learning and an editable
  directive. (#8, #9)

### Fixed

- The Improve preview shows its pending state on the first click, then the
  rewrite or an in-modal error; DSH reserves the slot `hooks` property, so the
  subscribed store is injected as a normal prop. (#19)
- The style-rule distillation call carries the session id, so cost meters
  attribute it like every other call. (#11)
- The bootstrap hint in Settings shows the documented $0.02 to $0.05 range.

## [0.2.1] - 2026-08-27

### Changed

- The npm package page shows the English README; the Chinese translation moved
  to `docs/README.zh.md`, and README links are absolute so they work from
  npmjs.com. (#2)
- Documentation overhaul with no runtime changes: *Getting started*, *How it
  works*, a docs index, a pipeline diagram and a glossary; the configuration,
  privacy/cost and architecture references rewritten as tables; claims
  corrected to match the code (one JSON repair retry, only automatic analyses
  capped, steering capped at 1400 characters, 1 to 4 directives per
  distillation, calls follow the session's provider route). (#3)

## [0.2.0] - 2026-08-27

First public release. Renamed from `dsh-prompt-coach` to **Tacit**; an existing
`~/.dsh/storages/prompt-coach` directory is adopted automatically. (#1)

### Added

- Zero-click learning: messy turns and your own corrections are analyzed in the
  background, with the previous turn as context. Bare continuations are never
  blamed on the prompt.
- Ambient steering: learned directives are injected as a system-prompt section
  you can read, edit, toggle and delete in Settings → Tacit. Directives that
  would make the agent *ask you* instead of compensating are dropped.
- Directive trials: a distilled directive starts as a candidate, runs for
  `directiveTrialTurns` finished turns, then is activated or retired if the
  messy-turn rate rose by more than `directiveWorseBy`.
- Bootstrap: *Learn from my last 20 turns* (this session or every session).
- A measured trend (messy-turn rate, tokens per turn) instead of a guessed
  savings figure.
- ✨ Improve rewrite with 👍/👎 feedback and learned style rules; opt-in
  pre-send context (`enrichPrompts`).

### Security

- Tacit's routes refuse cross-site requests (the harness web server has no
  origin policy of its own).

### Removed

- The guessed "token savings %", the unused good-examples library and the
  `learningThreshold` gate (old config keys are ignored, not rejected).

## 0.1.x

Published as `dsh-prompt-coach`: manual prompt coaching gated behind a learning
threshold. Superseded.

[Unreleased]: https://github.com/hackernotfound/dsh-tacit/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/hackernotfound/dsh-tacit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/hackernotfound/dsh-tacit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/hackernotfound/dsh-tacit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/hackernotfound/dsh-tacit/releases/tag/v0.2.0
