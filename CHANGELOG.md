# Changelog

## Unreleased

- Tacit masks credential-shaped strings as it captures a turn. An API key, a
  token, a JWT, a private-key block or a `key=value` secret in your prompt, in a
  tool argument or in the agent's answer becomes `[redacted:…]` in the turn
  digest, which is what reports, corrections, the recent-conversation context and
  every model call read. The shapes are listed in `lib/redact.js`.
- The steering section now states that it does not change which tools may run
  or what needs approval, and a directive that talks about permissions,
  approvals, the sandbox or elevated execution is refused — both when the
  distiller proposes one and when you type one in Settings → Tacit.
- Every coach prompt now frames its input as evidence about you rather than as
  instructions: text that arrives inside a rule, a reason, an example or the
  conversation is read as data.

## 0.4.0 — 2026-08-31

- Directive trials are now graded on how often you *correct* the agent: a
  candidate is retired when its correction rate rises more than
  `directiveWorseBy` above the baseline (*retired · corrections 10% → 30% while
  active*); the messy-turn rate only retires it past twice that margin, so tool
  errors alone no longer sink a directive you never pushed back on.
- One directive per scope (global, or one workspace) is on trial at a time; the
  rest of a distillation waits as *queued* (greyed, not injected) and starts
  its own trial, with fresh baselines, when the previous verdict lands.
- A distillation that rewords a directive keeps its identity — id, state, trial
  progress and on/off — instead of restarting it as a new candidate; retired
  directives (the last 6) are kept and handed to the distiller as *do not
  re-propose*, and one that comes back anyway stays retired.
- The measured trend in Settings → Tacit leads with your correction rate, then
  messy turns and tokens per turn.
- A provider that has run out of credit now says so. `insufficient_quota` and
  `INSUFFICIENT_BALANCE` used to surface as the generic "the model call
  failed", or worse as a rate limit you could wait out; they are their own
  message in both languages now.
- The cost panel is cheaper to leave open. Day files are parsed once and reused
  until they change, so the ten-second poll re-reads nothing, and the rolling
  summary's per-day buckets stop at 400 days instead of growing for good.
- *Today* no longer loses a run that crossed midnight. Such a run bills into
  two days, and it is now listed under today whenever any of its calls happened
  today, so the tile and the run list agree on the same work.
- The runs filter can ask for *running*, which is what a live run in the table
  actually is.
- *Learn from my last 20 turns* stops showing the previous batch's figures when
  there is nothing to analyze, and stops calling a finished batch the live one.
- The retention selector shows a `costHistoryDays` set by hand in YAML even
  when it is not one of the offered values; it used to display a neighbour.
- The Pricing rate table stays in the page while its card is collapsed, so
  find-in-page reaches it.
- Tab stays inside the confirm dialog instead of walking out of it, the run
  list calls a bootstrap's scope *all sessions* rather than leaving it blank,
  and the expanded attempt rows carry the column span assistive technology
  needs.

## 0.3.0 — 2026-08-30

- Every Tacit model call is now metered (tokens + list-price cost, priced
  from the bundled DeepSeek table or the optional `dsh-cost-meter` sibling)
  into a local, content-free usage ledger, grouped into runs and their
  attempts; new `costHistoryDays`, `costWarnDailyUsd`, `costWarnMonthlyUsd`
  settings.
- Four new routes for the ledger and the price source — `/api/tacit/usage`,
  `/api/tacit/usage-run`, `/api/tacit/usage-clear`, `/api/tacit/pricing-refresh`
  — plus `/api/tacit/bootstrap-preview` (what a bootstrap would cost) and
  `/api/tacit/analyze-batch` (analyze exactly the turns you pick as one run).
- Settings → Tacit is now eight collapsible section cards — Overview, Usage,
  Pricing, Learning, Agent guidance, Improve & feedback, Analysis history,
  Data & privacy — instead of one long page.
- New Usage card: today / this month / last 30 days / lifetime spend tiles, a
  daily spend bar chart, spend by operation, budget warning bars, filters and
  a paginated, expandable run list. New Pricing card: the list-price rate
  table for both models, the tier in force right now, the price source and a
  manual *Refresh prices*.
- New Data & privacy card: what a usage record holds, a retention selector
  (7/14/30/90/180/365 days), the two spend-warning thresholds (warns at 80 %,
  marks exceeded above the limit), and a confirm-dialog-gated *Clear usage
  history* alongside *Clear all analysis reports*. *Learn from my last 20
  turns* now shows a live cost estimate (measured from the ledger once enough
  analyses are priced, the documented figure until then).
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
