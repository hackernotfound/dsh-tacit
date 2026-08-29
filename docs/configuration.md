# Configuration

*For anyone who wants to change a setting. Most people never need to.*

## Two ways to set a value

| Where | How | Notes |
| --- | --- | --- |
| **Settings → Tacit** (UI) | flip the switch / pick the model / type the cap | writes only the keys you changed to `~/.dsh/storages/tacit/config.patch.json` |
| **Profile patch** (YAML) | add an id-targeted row to `~/.dsh/profiles/web/cordis.patch.yml` | any key, incl. the ones with no UI control; takes effect after restarting `npx @deepseek-ai/dsh web` |

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: tacit
  config:
    model: deepseek-v4-pro
    autoDailyBudget: 50
    enrichPrompts: true
```

Precedence: **UI patch > YAML > built-in defaults.** A key set once in the UI keeps
winning over YAML until you change it again in the UI (patch keys are never removed).

## All keys

| Key | Default | Allowed | What it does | UI |
| --- | --- | --- | --- | --- |
| `model` | `deepseek-v4-flash` | `deepseek-v4-flash`, `deepseek-v4-pro` | model used for every Tacit call | Analysis model |
| `autoAnalyze` | `true` | boolean | analyze messy / corrected turns automatically | Auto-analyze messy turns |
| `learnFromGood` | `true` | boolean | also analyze a clean turn that follows a messy one (what you included the second time); counts against the daily cap | Also learn from a clean prompt right after a messy turn |
| `autoDailyBudget` | `30` | 0–1000 | cap on **automatic** analyses per local calendar day; `0` disables them | Daily cap on automatic analyses |
| `autoMinSteps` | `15` | 1–500 | a finished turn with at least this many model steps counts as messy (auto-analysis only) | — |
| `steerAgent` | `true` | boolean | inject the learned directives into every new conversation's system prompt | Inject learned directives into the system prompt |
| `directiveEvery` | `3` | 1–100 | new analyses between two directive distillations | — |
| `directiveTrialTurns` | `10` | 1–500 | finished turns a candidate directive stays on trial | — |
| `directiveWorseBy` | `0.15` | 0–1 | retire a candidate when its trial messy-turn rate exceeds the baseline by more than this | — |
| `bootstrapConcurrency` | `1` | 1–4 | analyses run at once during *Learn from my last 20 turns*; same calls and cost, less waiting | — |
| `enrichPrompts` | `false` | boolean | opt-in: one small call before each send appends learned context (never rewrites your words); uncapped | Add learned context before each send |
| `liveSuggestions` | `true` | boolean | show the ✨ Improve prompt button | Enable the composer Improve button |
| `maxPatterns` | `12` | 1–50 | mistake patterns kept in the profile and offered to ✨ Improve | — |
| `maxKeptTurns` | `60` | 1–1000 | turns retained per conversation (newest kept) | — |
| `maxPromptChars` | `4000` | 200–100000 | prompt text kept per turn | — |
| `maxAssistantChars` | `4000` | 200–100000 | final answer kept per turn | — |
| `maxToolCallChars` | `500` | 100–20000 | tool-call arguments kept per call | — |
| `maxToolCallsPerTurn` | `50` | 1–500 | tool calls kept per turn | — |

## Good to know

- **Out-of-range numbers are clamped silently** to the allowed range; nothing is logged.
- **`0` only means zero for `autoDailyBudget`.** For every other numeric key `0`
  falls back to the default (the code uses `value || default`).
- **A `model` outside the allowlist** silently becomes `deepseek-v4-flash` when it
  comes from YAML, and is rejected with `400 bad-request` when set through the UI/API.
- **`liveSuggestions: false` hides the button** only; the `/api/tacit/improve` route
  stays callable.
- **Unknown keys are dropped**, not rejected — an old `learningThreshold` from
  `dsh-prompt-coach` is simply ignored.
- **`DSH_HOME`** moves the whole storage root (`$DSH_HOME/storages/tacit/`).
- **The bootstrap size** (20) is an argument of the `/api/tacit/bootstrap` route
  (`limit`, 1–50), not a setting; the UI always sends 20.
- Changing `steerAgent` or any directive affects **new conversations only** — see
  [How it works §7](how-it-works.md#7-steering-section).

---

← [Docs index](README.md) · See also: [Privacy, cost & limitations](privacy-and-cost.md)
