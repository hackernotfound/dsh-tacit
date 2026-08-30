# Privacy, cost & limitations

*For anyone deciding whether to trust Tacit with their conversations. Everything
below is the actual behaviour of v0.2.1; where the code has a rough edge it says so.*

## What stays on your machine

Everything Tacit keeps lives under `~/.dsh/storages/tacit/` (or
`$DSH_HOME/storages/tacit/`). Files are written atomically (write a temp file, then
rename) and never truncated in place.

| File | Holds |
| --- | --- |
| `profile.json` | mistake patterns with trust counters, directives (max 8 global + 4 per workspace, each with the absolute workspace path it is scoped to, if any), style rules (max 6), the last 10 👎 verdicts, counters |
| `reports/<conversation>/<turn>.json` | one analysis report per analyzed turn (problems, improved prompt, explanation, a 200-char excerpt of the prompt, your correction if any, the absolute workspace directory of the conversation) |
| `config.patch.json` | the settings you changed in the UI |
| `auto.json` | today's date and how many automatic analyses were spent |
| `usage/<YYYY-MM-DD>.json` | one day's usage ledger: *runs* (one bootstrap batch, auto-analysis, ✨ Improve, distillation, ...), each with its *attempts* (op, timing, model, provider, token counts, finish reason/code, priced USD) — never prompt or response text |
| `usage/summary.json` | rolling lifetime / by-type / by-model / by-day usage totals, kept alongside the day files so nothing has to re-scan them |

The turn digests themselves are not here — they live in the harness's own session
projection store, next to the session.

## What is sent to the model

Every call goes through the harness's model service with **your** configured key —
Tacit never reads, stores or forwards the key. Only the model id is allowlisted
(`deepseek-v4-flash` / `deepseek-v4-pro`); the *provider route* is the one your
session already uses, so a proxy or self-hosted route configured in the harness
is honoured. Nothing is sent anywhere else.

| Call | What goes out | Clipped to |
| --- | --- | --- |
| **Analysis** | previous turn's prompt + answer; the analyzed prompt; step/tool/error/retry/token counters; the first 25 tool calls (name + arguments); the final answer; your correction | 600 + 600 · 4000 · — · 400 per call · 3000 · 1000 chars |
| **Directive distillation** | your top 12 patterns (kind + one example); the last 5 "prompt → correction" pairs; your style rules; the current directives | 200 · 120 + 200 · 300 · 220 chars each |
| **Style-rule distillation** | your last 3 👎 reasons, verbatim | 300 chars each |
| **✨ Improve** | your draft; the last 2 turns' prompts and answers; style rules; last 3 👎 reasons; trusted patterns | draft as typed (≤ 100 000) · 600 + 600 each · 300 · 300 · 200 |
| **Pre-send context** (opt-in) | your draft; enabled directives; top 6 patterns; the last 2 turns | 1500 · 220 · 160 · 600 + 600 |

Never sent: tool *results* or file contents (only whether a tool errored), API
keys, session ids, anything outside the clips above.

## Guarantees

- **Never reads or stores API keys.** Calls use `ctx.llm.stream`, the harness's own service.
- **Visible steering.** The exact injected text is in Settings → Tacit → *Exact text
  injected*, and `steerAgent: false` removes it entirely.
- **Append-only pre-send.** `enrichPrompts` (off by default) appends a separate,
  labelled, plugin-sourced message; your words are never rewritten.
- **Same-origin only.** The harness web server has no origin policy, so Tacit's
  routes check `Sec-Fetch-Site`, `Origin` and `Content-Type` themselves: a web page
  you happen to visit cannot plant a directive or spend your budget through
  `127.0.0.1`. (A request with none of those headers — `curl`, the smoke test —
  passes by design.)
- **Two deletion paths, both restricted to Tacit's own files.** Analysis reports:
  *Clear all analysis reports* removes `reports/*/<turn>.json` files (and the
  emptied folders). Usage: day files older than `costHistoryDays` are deleted
  automatically (at most once per calendar day), and the whole usage ledger can
  be reset at once. Both only ever unlink files matching Tacit's own naming
  (`reports/*/<n>.json` or `usage/<YYYY-MM-DD>.json`); the `usage/` directory,
  `summary.json` (rewritten fresh, not unlinked), the profile and the config are
  never touched by either path.
- **Bounded everything.** Every text sent to the model is clipped (table above);
  directives ≤ 220 chars, the steering section ≤ 1400 chars, 8 directives, 12 patterns.

## Cost

Every Tacit model call is metered from the model's own `usage` block (uncached
input, output, cache-read, cache-write and reasoning tokens) and folded into a
content-free ledger under `usage/`. Reasoning tokens are always a subset of
output tokens, never a separate quantity, so they are never billed twice.

**Runs and attempts.** The ledger groups calls into *runs* — one bootstrap
batch, one auto/manual/batch analysis, one ✨ Improve, one directive
distillation, one style-rule distillation, one pre-send enrichment — and each
underlying model call inside a run is an *attempt*. A run carries an id, its
type, a trigger, start/end times, a derived status — `success` when no
attempt failed (an unmetered attempt still counts as not failed), `partial`
when some attempts failed, `failed` when every attempt failed or there are no
attempts, `running` while open — the session id and turn, the workspace
**label** (never the path), the model/provider and its list of attempts. An
attempt carries an id, the op (`analysis`, `analysis-repair`,
`directive-distillation`, `style-distillation`, `improve`, `improve-repair`,
`enrichment`), its timing, model, provider, reasoning effort, finish
reason/code, a status (`ok` / `failed` / `unmetered`), the session id and
turn, the five raw token buckets, and the priced result (`null` when nothing
matched). None of it is ever a prompt, a response, a tool argument or an API
key.

**Pricing sources and resolution order.** Each attempt is priced once, at the
call's own start time, in this order:

1. [`dsh-cost-meter`](https://www.npmjs.com/package/dsh-cost-meter)'s own
   **model** rates for that model, when the call went through an official
   DeepSeek route — tiered off-peak/peak using `dsh-cost-meter`'s own peak
   windows / effective-at / peak-enabled flag when it supplies them, with
   Tacit's own Beijing-weekend rule always applied on top (see *Tiers*
   below) — `dsh-cost-meter` has no such rule of its own, which is exactly
   why the two plugins' figures can differ on a weekend (Known limitations).
2. `dsh-cost-meter`'s **provider** rates for that provider + model, when the
   above did not match — a flat rate, no tier, so a proxy or custom route can
   still be priced when the meter knows its rate card.
3. The bundled DeepSeek V4 list price (dated `2026-08-22`), for an official
   route and an allowlisted model, when neither of the above applies.
4. Otherwise: no price at all — see *Unpriced calls* below.

`dsh-cost-meter`'s rates always win when they match; the bundled table is the
fallback, never a ceiling. The plugin is entirely optional and duck-typed:
Tacit never blocks a model call on it, and a `getState()` call that hangs,
throws or returns nothing usable falls back to the bundled table within 5
seconds, remembering why (shown in the Pricing card).

**Formula.** For one attempt:

```
cost = (uncachedInput · cacheMissRate
      + (cacheRead + cacheWrite) · cacheHitRate
      + output · outputRate) / 1,000,000
```

in USD per 1M tokens.

**Tiers.** Peak hours are 01:00–04:00 and 06:00–10:00 UTC; every other UTC
hour is off-peak. Since 2026-08-22T16:00 UTC, Beijing-calendar weekends
(Saturday/Sunday at UTC+8) are always off-peak regardless of the hour. The
tier is decided once, at the call's start time, so a call that straddles a
tier boundary is still priced consistently.

**Unpriced calls.** A call on a route Tacit can't match to any price table —
a proxy or custom provider neither the bundled table nor `dsh-cost-meter`
know — has no computed price; it's counted separately as an *unpriced* call
(shown in the Usage card) rather than assumed free. A call that never
received a `usage` block at all (the adapter reported none) is *unmetered*,
which is never shown as `$0.00`.

Every call is also made with low reasoning effort and a tool schema (no prose
to parse), and every one is tagged with the session id, so a cost plugin such
as `dsh-cost-meter` can additionally show the real spend next to the
conversation.

| Call | When | Max output tokens | Counts against the daily cap | Tagged with session | Est. cost, `deepseek-v4-flash`\* |
| --- | --- | --- | --- | --- | --- |
| Analysis — auto / correction | messy turn or correction | 3000 | **yes** (30/day) | yes | ≈ $0.001 off-peak · $0.002–0.003 peak |
| Analysis — good (`learnFromGood`) | a clean turn right after a messy one | 3000 | **yes** (same 30/day) | yes | ≈ $0.001–0.002 (shorter answer than a diagnosis) |
| Analysis — manual / bootstrap | you click | 3000 | no | yes | same; bootstrap (20 + 1 distillation) ≈ $0.02–0.05 |
| Repair retry | analysis or Improve returned unparseable JSON (rare) | same as the call | no | yes | doubles that one call |
| Directive distillation | every 3 analyses | 1500 | no | yes | ≈ $0.0005–0.001 |
| Style-rule distillation | every 3 👎 with a reason | 1000 | no | yes | < $0.001 |
| ✨ Improve | you click | 1500 | no | yes | ≈ $0.001–0.002 (its system prompt is a stable, cache-hit prefix) |
| Pre-send context (opt-in) | **every** send with an 8–1500-char draft | 1000 | no | yes | < $0.001 each, but on every send |

\* Computed from DeepSeek's list prices (per 1M tokens) with a typical analysis
of ~2500 input and ~800 output tokens (reasoning tokens count as output; the
other calls are smaller):

| Model | Cache hit | Input (cache miss) | Output | |
| --- | --- | --- | --- | --- |
| `deepseek-v4-flash` | $0.007 off-peak · $0.014 peak | $0.22 off-peak · $0.44 peak | $0.66 off-peak · $1.32 peak | default |
| `deepseek-v4-pro` | $0.022 off-peak · $0.044 peak | $0.66 off-peak · $1.32 peak | $1.98 off-peak · $3.96 peak | 3× flash |

Cache-hit input is ~30× cheaper ($0.007–0.044), and Tacit's system prompts are
stable, so real spend is often below the estimates. Peak/off-peak hours and
current prices: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing).

Guards: automatic analyses are capped per local calendar day (`autoDailyBudget`);
each turn is analyzed at most once automatically; bare continuations are skipped
without a call; turns that finished before the plugin started are ignored.

## Known limitations

Honest list — these are v0.2 behaviours, not hidden surprises:

- **Steering is frozen per conversation.** Any verdict, toggle, edit or new directive
  applies to conversations started afterwards; the running one keeps what it started with.
- **Trials are a trend check, not an A/B test.** A candidate is judged only on turns
  from conversations whose frozen steering text actually contained it; conversations
  started before it existed (or before a restart) contribute nothing, so a trial can
  take more than `directiveTrialTurns` turns of wall-clock time to conclude.
- **"Messy" means two slightly different things.** Auto-analysis also counts 15+
  steps as messy; the trend and the trial verdict do not (long-but-successful work is
  never held against a directive).
- **Only automatic analyses are capped.** Manual, bootstrap, ✨ Improve, both
  distillations and pre-send context run outside `autoDailyBudget`.
- **The trend only sees loaded conversations**, and only turns within
  `maxKeptTurns`; it needs 40 finished turns to show.
- **Bootstrap runs a small worker pool** (`bootstrapConcurrency`, 1–4, default
  1) and ignores the daily cap.
- The distiller sees workspace **names** (the last path segment, e.g. `dsh-tacit`),
  never full paths; full paths stay in the local reports and profile.
- A weekly digest is not implemented yet.
- **Bundled prices are a snapshot**, dated `PRICES_AS_OF` (currently
  `2026-08-22`). A DeepSeek price change is only reflected once this package
  updates, or via `dsh-cost-meter`.
- **`dsh-cost-meter` has no weekend rule.** Its price table carries no
  Beijing-weekend off-peak override, so on a weekend a bundled-table figure
  and a `dsh-cost-meter` figure for the same call can differ.
- **The measured bootstrap estimate uses only day files on disk.** It reads
  the priced attempts already written to disk, not an in-flight run's own live
  counters. A run that has *finished* is already there — `endRun` writes its
  day file synchronously — so only a run **still in flight** lags: its
  attempts do not move the estimate until the debounced flush (250 ms) has
  written them.

---

← [How it works](how-it-works.md) · Next: [Configuration](configuration.md)
