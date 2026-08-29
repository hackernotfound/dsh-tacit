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
- **Never deletes your files.** The only deletion path is *Clear all analysis
  reports*, which removes Tacit's own `reports/*/*.json` files (and the emptied
  folders). The profile, config and ledger are never deleted.
- **Bounded everything.** Every text sent to the model is clipped (table above);
  directives ≤ 220 chars, the steering section ≤ 1400 chars, 8 directives, 12 patterns.

## Cost

Tacit keeps no ledger of its own. Every call is made with low reasoning effort
and a tool schema (no prose to parse), and every one is tagged with the session id so
a cost plugin such as [`dsh-cost-meter`](https://www.npmjs.com/package/dsh-cost-meter)
shows the real spend next to the conversation.

| Call | When | Max output tokens | Counts against the daily cap | Tagged with session | Est. cost, `deepseek-v4-flash`\* |
| --- | --- | --- | --- | --- | --- |
| Analysis — auto / correction | messy turn or correction | 3000 | **yes** (30/day) | yes | ≈ $0.001 off-peak · $0.002–0.003 peak |
| Analysis — good (`learnFromGood`) | a clean turn right after a messy one | 3000 | **yes** (same 30/day) | yes | ≈ $0.001–0.002 (shorter answer than a diagnosis) |
| Analysis — manual / bootstrap | you click | 3000 | no | yes | same; bootstrap (20 + 1 distillation) ≈ $0.02–0.05 |
| Repair retry | analysis or Improve returned unparseable JSON (rare) | same as the call | no | yes | doubles that one call |
| Directive distillation | every 3 analyses | 1500 | no | yes | ≈ $0.0005–0.001 |
| Style-rule distillation | every 3 👎 with a reason | 1000 | no | yes | < $0.001 |
| ✨ Improve | you click | 1500 | no | yes | ≈ $0.001–0.002 |
| Pre-send context (opt-in) | **every** send with an 8–1500-char draft | 1000 | no | yes | < $0.001 each, but on every send |

\* Computed from DeepSeek's list prices (per 1M tokens) with a typical analysis
of ~2500 input and ~800 output tokens (reasoning tokens count as output; the
other calls are smaller):

| Model | Input (cache miss) | Output | |
| --- | --- | --- | --- |
| `deepseek-v4-flash` | $0.22 off-peak · $0.44 peak | $0.66 off-peak · $1.32 peak | default |
| `deepseek-v4-pro` | $0.66 off-peak · $1.32 peak | $1.98 off-peak · $3.96 peak | 3× flash |

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
- **Bootstrap runs serially** and ignores the daily cap.
- The distiller sees workspace **names** (the last path segment, e.g. `dsh-tacit`),
  never full paths; full paths stay in the local reports and profile.
- A weekly digest is not implemented yet.

---

← [How it works](how-it-works.md) · Next: [Configuration](configuration.md)
