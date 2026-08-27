# Tacit — for DeepSeek Harness

[![test](https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml/badge.svg)](https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/dsh-tacit)](https://www.npmjs.com/package/dsh-tacit)
[中文说明](README.zh.md)

**Tacit learns what you leave unsaid in your prompts and fills it in for the agent.**

You keep writing prompts the way you already do. In the background, Tacit
watches how each turn went — retries, tool errors, compactions, and above all
*the message you send next when the agent got it wrong* — learns your habits,
and turns them into a short set of **directives the agent follows on your
behalf** in every new session. No clicks required; roughly $0.001 per learning
step (estimate — see *Cost*).

```
you: "make the login page better"
     ↓ (agent stumbles, you say "no I meant the Next.js app under apps/web")
Tacit learns: "The user often omits which app/folder they mean — check apps/web first."
     ↓ every later session's system prompt carries that directive
agent: checks apps/web first. You never had to say it again.
```

## What it does

| Layer | What happens | Cost |
| --- | --- | --- |
| **Zero-click learning** (on) | When a turn finishes *messy* (retries / tool errors / compactions / rejected / ≥15 steps) or your next message reads as a correction ("no I meant…", "why did you…"), Tacit analyzes that prompt automatically, including your correction as evidence. Capped per day (default 30). | ≈ $0.001 per analysis (`deepseek-v4-flash`, low reasoning effort, structured output) |
| **Ambient steering** (on) | Every few analyses, one tiny call distills what it learned into 2–4 **directives for the agent**. They are rendered as a ≤300-token section of every *new* session's system prompt. You see the exact text in Settings → Tacit, can switch any directive off, delete it, or add your own. | ≈ free (cached input) |
| **✨ Improve** (on) | A button in the composer rewrites your current draft on demand, using the learned patterns, style rules and your last 👎 reasons. Before/after preview, *Apply* / *Cancel*, then 👍/👎 (👎 asks for a one-line reason; three reasons distill into style rules). | ≈ $0.001 per click |
| **Pre-send context** (off, opt-in) | Before the first step of a turn, one small call appends a plugin message ("Context from Tacit: the user probably means …; check … first") **after** your own untouched message. Never rewrites your words; the note is visible in the Tacit tab. | ≈ $0.001 per send |
| **Measured, not guessed** | Settings shows the real trend from your own sessions: messy-turn rate and tokens/turn, first 20 turns vs. latest 20. | free |
| **Directives earn their place** | A freshly distilled directive is a *candidate*: it is injected while the next 10 turns finish (across all your sessions), then activated — or **retired automatically** if the messy-turn rate over those turns rose more than 15 points above the baseline. Retired ones stay visible in Settings (with the reason) and can be re-enabled by hand. | free |
| **Bootstrap** | *Learn from my last 20 turns* (Tacit tab = this session, Settings = every session) analyzes recent turns right away and distills directives — the quick start for a new install (the analyses run one after another; expect a few minutes). Bare continuations ("continue", "go ahead") and already-analyzed turns are skipped. **Ignores the daily cap.** | ≈ $0.02 one time |

## Requirements

- DeepSeek Harness `>= 0.1.1-rc.1` (`npx @deepseek-ai/dsh web`), Node `>= 22`
- a DeepSeek API key configured in the harness (Settings → Models) — Tacit never
  reads it, it only calls the harness's own model service

## Install

```bash
dsh plugin --profile web add dsh-tacit
# restart `dsh web`, then refresh the harness page
```

From a checkout instead (development): `dsh plugin --profile web add /abs/path/to/dsh-tacit`.
`dsh plugin add` forwards to pnpm inside the profile and reconciles
`dsh.profile.bundles`. Coming from `dsh-prompt-coach`: remove that entry, add
this one — the old `~/.dsh/storages/prompt-coach` directory is adopted
automatically.

## Where things are in the UI

- **Tacit tab** in the conversation view ring (beside Chat / Trajectory / Context):
  every turn's digest, an *auto* / *correction* / *manual* badge on each report,
  the context Tacit added before a send (opt-in feature), and a manual
  *Analyze* button / batch selection when you want to analyze a prompt yourself.
- **Settings → Tacit**: learned-from count, auto-learning status (today's
  spend vs. cap), the measured trend, **what the agent is told about you**
  (toggle / remove / add directives, exact injected text), style rules, the
  analyzed-prompt list across sessions, and the switches for every layer.
- **Composer**: ✨ Improve button; a 👍/👎 strip after you apply a rewrite.

## Configuration

Settings changed in the UI persist under `~/.dsh/storages/tacit/`. Defaults can
also be set from the profile's user patch layer (`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: tacit
  config:
    model: deepseek-v4-pro
    autoDailyBudget: 50
    enrichPrompts: true
```

All keys (defaults shown): `model: deepseek-v4-flash` (allowlist: `deepseek-v4-flash` /
`deepseek-v4-pro`), `autoAnalyze: true`, `autoDailyBudget: 30`, `autoMinSteps: 15`,
`steerAgent: true`, `directiveEvery: 3`, `directiveTrialTurns: 10`, `directiveWorseBy: 0.15`,
`enrichPrompts: false`, `liveSuggestions: true`
(the ✨ button), `maxKeptTurns: 60`, `maxPromptChars: 4000`, `maxToolCallChars: 500`,
`maxAssistantChars: 4000`, `maxToolCallsPerTurn: 50`, `maxPatterns: 12`.
`learningThreshold` is accepted for compatibility and ignored (there is no gate
any more) — safe to delete from `config.patch.json`. The bootstrap size (20) is
an API parameter (`limit`, 1–50), not a setting.

## Security & privacy

- **Never reads or stores API keys** — every model call goes through the
  harness's own LLM service (`ctx.llm.stream`), which resolves the key you
  configured in Settings → Models.
- **No custom endpoints** — the model is allowlisted on the official provider
  (the session's own provider route is followed, falling back to `deepseek-official`).
- **Bounded, local data** — only clipped turn digests leave the machine;
  reports, the profile and the directives stay in `~/.dsh/storages/tacit/`.
- **Context-aware analysis** — every analysis sees the previous turn; a bare "continue" is
  judged with its context, heavy-but-successful work is never blamed on the prompt, and
  directives that would make the agent *ask you* instead of compensating are dropped.
- **Visible steering** — the exact system-prompt section is shown in Settings
  and can be switched off entirely (`steerAgent`). The section is frozen per
  session so the model's prefix cache stays warm.
- **Same-origin only** — the harness web server has no origin policy, so
  Tacit's routes refuse cross-site requests themselves (fetch-metadata,
  `Origin`, and content-type checks): a web page you happen to visit cannot
  plant a directive or spend your budget through `127.0.0.1`.
- **Append-only pre-send** — opt-in, and it never rewrites your message: it
  appends a separate plugin-sourced message that is logged and shown.
- **Cost guards** — automatic calls are capped per day (`autoDailyBudget`);
  every call uses low reasoning effort, tool-schema structured output (no
  repair loops on prose) and is attributed to the session so a cost meter sees
  it. Bootstrap is the one deliberate exception: one click runs up to 20
  analyses outside the cap.
- **Never deletes pre-existing files** — the only deletion is *Clear all
  analysis reports* in Settings, which removes the plugin's own
  `reports/<session>/<turn>.json` files.

## Cost

The dollar figures above are **estimates** from DeepSeek list prices for
`deepseek-v4-flash` at the token budgets Tacit uses (≤ 3000 output tokens per
analysis, ≤ 1000 per distillation, low reasoning effort). Tacit keeps no ledger
of its own; every call carries the session id, so a cost plugin such as
[`dsh-cost-meter`](https://www.npmjs.com/package/dsh-cost-meter) shows the real
spend next to the session.

## Known limitations

Honest list — these are v0.2 behaviors, not hidden surprises:

- **The steering section is frozen per session.** The exact text is captured
  the first time a session assembles its system prompt (to keep the model's
  prefix cache warm). So a retirement verdict *and* anything you toggle, edit
  or add in Settings → Tacit apply to **new sessions only**; the running one
  keeps what it started with.
- **Trials are counted globally, not per directive.** Every candidate sees the
  same finished-turn / messy-turn counts, so candidates distilled together get
  the same verdict. It is a trend check, not an A/B test per directive.
- **"Messy" means two slightly different things.** Auto-analysis also counts a
  turn as messy when it needs ≥ `autoMinSteps` steps; the trend chip and the
  trial verdict count only retries, tool errors, compactions, rejections and
  cancellations (long-but-successful work is never held against a directive).
- **Bootstrap runs serially** and ignores the daily cap (see *Cost guards*).
- Directives are global, not per workspace; learning from *good* prompts and a
  weekly digest are not implemented yet.

## Architecture

| Piece | Mechanism |
| --- | --- |
| Trajectory read | `ctx.sessionProjections` unit `tacitTimeline` (pure fold over session events, fork-seed guarded, bounded retention); the browser reads it via `useProjection` |
| Zero-click triggers | `sessionProjections.onChanged` (no polling): messy-turn and correction heuristics are plain code; only the analysis itself is a model call |
| Steering | `ctx.systemPrompt.section({ name: 'tacit:steering', order: 60 })`, text frozen per session |
| Pre-send context | `agent/pre-step` waterfall listener, append-only, no-op unless `enrichPrompts` |
| Model calls | `ctx.llm.stream` with `reasoningEffort: 'low'` and a tool schema for structured output |
| Browser ↔ host | `/api/tacit/*` JSON routes on the harness web server |
| UI | `conversation.view` tab, `conversation.input.left` button, `conversation.input.overlay` preview, `conversation.composer.dock` feedback strip, `settings.section` page — vanilla `React.createElement` via `window.__ModuleLoader__` |
| Storage | `~/.dsh/storages/tacit/` — `config.patch.json`, `profile.json`, `auto.json`, `reports/<sessionId>/<turn>.json`, atomic writes |

## Development

```bash
pnpm install   # zod, dsh-home-paths, dsh-llm (+ react/react-dom for the SSR client test)
pnpm test      # node --test: fold, calls, analysis, trust, schema, store, host integration (stubbed harness), client SSR
pnpm smoke     # live smoke against a running dsh web (real model calls, ~$0.005); TACIT_BASE overrides the URL
```

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
checkout/link workflow, the restart-vs-refresh rule and the ground rules
(tests for behavior, zh/en dictionaries in sync, no key handling).

## License

MIT
