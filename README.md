<h1 align="center">Tacit</h1>

<p align="center"><b>Learns what you leave unsaid in your prompts — and tells the agent for you.</b><br>
A plugin for <a href="https://www.npmjs.com/package/@deepseek-ai/dsh">DeepSeek Harness</a>.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-tacit"><img alt="npm" src="https://img.shields.io/npm/v/dsh-tacit"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml"><img alt="test" src="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="docs/README.zh.md">中文</a>
</p>

You keep writing prompts the way you already do. Tacit watches how each turn
*actually* went — retries, tool errors, and above all the message you send
when the agent got it wrong — and turns your habits into a few directives the
agent follows in every new session. No clicks, about $0.001 per lesson.

```
you:    "make the login page better"
agent:  …stumbles…
you:    "no, I meant the Next.js app under apps/web"

Tacit:  learns → "The user often omits which app they mean — check apps/web first."
        injects it into every later session's system prompt.
        You never have to say it again.
```

## Install — 30 seconds

```bash
dsh plugin --profile web add dsh-tacit
```

Restart `dsh web`, refresh the page. Optional kick-start: **Settings → Tacit →
*Learn from my last 20 turns*** (≈ $0.02, once).

Requires DeepSeek Harness `>= 0.1.1-rc.1`, Node `>= 22`, and a DeepSeek API key
already configured in the harness (Tacit never reads it).

## What you get

- **Zero-click learning** — messy turns and your own corrections are analyzed
  in the background, with the previous turn as context. Capped per day
  (30 by default). *≈ $0.001 per analysis.*
- **Directives that earn their place** — learned directives are injected as a
  small system-prompt section you can read, edit, toggle or delete. A new one
  starts as a *candidate* and is retired automatically if your messy-turn
  rate gets worse. *free*
- **✨ Improve** — a composer button that rewrites your current draft using
  what Tacit has learned, with a before/after preview and 👍/👎. *≈ $0.001 per click*
- **Measured, not guessed** — Settings shows your real trend: messy-turn rate
  and tokens per turn, first 20 turns vs. latest 20. *free*

## How it works

1. A pure fold over the session's events produces a bounded digest per turn.
2. When a turn ends messy, or your next message reads as a correction, one
   small `deepseek-v4-flash` call (low reasoning effort, structured output)
   analyzes the prompt.
3. Every few analyses, one more call distills the findings into 2–4 directives.
4. The directives are rendered as a ≤300-token section of the system prompt —
   the exact text is visible in Settings, and nothing else about your prompts
   leaves the machine.

## Privacy & cost, in one paragraph

Tacit never sees your API key (every call goes through the harness's own model
service), only calls the allowlisted official model, keeps reports and
directives in `~/.dsh/storages/tacit/`, refuses cross-site requests to its own
routes, and never deletes anything but its own reports. The dollar figures are
estimates at list price; a cost plugin such as `dsh-cost-meter` shows the real
number. Full details, including the honest list of limitations:
[docs/privacy-and-cost.md](docs/privacy-and-cost.md).

## More

[Configuration](docs/configuration.md) ·
[Privacy, cost & limitations](docs/privacy-and-cost.md) ·
[Architecture](docs/architecture.md) ·
[Contributing](CONTRIBUTING.md) ·
[Changelog](CHANGELOG.md)

MIT © hackernotfound
