<h1 align="center">Tacit</h1>

<p align="center"><b>Learns what you leave unsaid in your prompts — and tells the agent for you.</b><br>
A plugin for <a href="https://www.npmjs.com/package/@deepseek-ai/dsh">DeepSeek Harness</a>.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-tacit"><img alt="npm" src="https://img.shields.io/npm/v/dsh-tacit"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml"><img alt="test" src="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml/badge.svg"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/blob/main/LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/blob/main/docs/README.zh.md">中文</a>
</p>

You keep writing prompts the way you already do. Tacit watches how each turn
*actually* went — retries, tool errors, and above all the message you send
when the agent got it wrong — and turns your habits into a few directives the
agent follows in every new conversation. No clicks, $0.001–0.003 per lesson.

```
you:    "make the login page better"
agent:  …stumbles…
you:    "no, I meant the Next.js app under apps/web"

Tacit:  learns → "The user often omits which app they mean — check apps/web first."
        injects it into every later conversation's system prompt.
        You never have to say it again.
```

<p align="center">
  <img alt="Install Tacit, open its conversation tab, review learning controls, and edit the directive it gives the agent" src="https://raw.githubusercontent.com/hackernotfound/dsh-tacit/main/docs/assets/tacit-demo.gif" width="960">
</p>

## Install — 30 seconds

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-tacit
```

If `dsh` is already installed globally, `dsh plugin --profile web add dsh-tacit`
is the equivalent shorthand.

Start (or restart) with `npx @deepseek-ai/dsh web`, then refresh the page.
Optional kick-start: **Settings → Tacit →
*Learn from my last 20 turns*** (≈ $0.02–0.05, once).

Requires DeepSeek Harness `>= 0.1.1-rc.1`, Node `>= 22`, and a DeepSeek API key
already configured in the harness (Tacit never reads it).

## What you get

| | What | Cost |
| --- | --- | --- |
| **Zero-click learning** | messy turns and your own corrections are analyzed in the background, with the previous turn as context; automatic analyses are capped per day (30 by default) | $0.001–0.003 each |
| **Directives that earn their place** | learned directives are injected as a short system-prompt section you can read, edit, toggle or delete; a new one starts as a *candidate* and is retired if your messy-turn rate gets worse | free |
| **✨ Improve** | a composer button that rewrites your current draft using what Tacit has learned, with a before/after preview and 👍/👎 | $0.001–0.002 per click |
| **Measured, not guessed** | Settings shows your real trend — messy-turn rate and tokens per turn, first 20 turns vs. latest 20 | free |

<p align="center">
  <img alt="Tacit settings with automatic learning controls and an editable active directive" src="https://raw.githubusercontent.com/hackernotfound/dsh-tacit/main/docs/assets/tacit-settings.png" width="960">
</p>
<p align="center"><sub>Settings → Tacit, captured from a clean local profile with a synthetic example directive.</sub></p>

## How it works

1. Tacit keeps a small, bounded digest of every turn: the prompt, what tools ran,
   what went wrong, how it ended.
2. When a turn ends messy, or your next message reads as a correction, one small
   `deepseek-v4-flash` call analyzes that prompt and records what was missing.
3. Every few analyses, one more call distills the findings into 1–4 one-sentence
   directives for the agent. Each new directive is on trial for 10 turns.
4. The directives become a ~300-token section of the system prompt in every new
   conversation. The exact text is visible in Settings; only clipped digests of
   your turns ever leave the machine.

The full walkthrough with every number and a diagram:
[How it works](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/how-it-works.md).

## Privacy & cost, in one paragraph

Tacit never sees your API key (every call goes through the harness's own model
service), only calls the allowlisted official models over your session's own
provider route, keeps reports and directives in `~/.dsh/storages/tacit/`, refuses
cross-site requests to its own routes, and never deletes anything but its own
reports and expired usage files. Dollar figures are estimates at list price; a cost plugin such as
`dsh-cost-meter` shows the real number. The full data-flow and cost tables, and
the honest list of limitations:
[Privacy, cost & limitations](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/privacy-and-cost.md).

## Help shape Tacit

Tacit works and I use it every day — but so far it has learned from one
person's prompts. It gets better with more of them.

- **Try it and say what feels wrong.** A directive that misfires, a cost that
  surprised you, a label that reads oddly:
  [open an issue](https://github.com/hackernotfound/dsh-tacit/issues/new/choose).
  Two minutes of your time beats a week of my guessing.
- **Pick up a task.** Issues tagged
  [`good first issue`](https://github.com/hackernotfound/dsh-tacit/labels/good%20first%20issue)
  are small and come with acceptance criteria;
  [`help wanted`](https://github.com/hackernotfound/dsh-tacit/labels/help%20wanted)
  ones are bigger and I will pair on the design.
- **Ask anything** in
  [Discussions](https://github.com/hackernotfound/dsh-tacit/discussions).

PRs are welcome — the fork → branch → PR walkthrough is in
[CONTRIBUTING.md](https://github.com/hackernotfound/dsh-tacit/blob/main/CONTRIBUTING.md).
No API key is needed to run the tests.

## Documentation

| | |
| --- | --- |
| [Getting started](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/getting-started.md) | install, check it's on, bootstrap, where things are in the UI, troubleshooting |
| [How it works](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/how-it-works.md) | the pipeline step by step, with a diagram and a glossary |
| [Privacy, cost & limitations](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/privacy-and-cost.md) | what stays local, what is sent, what each call costs, what it can't do yet |
| [Configuration](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/configuration.md) | every setting, defaults and ranges |
| [Architecture](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/architecture.md) | for contributors: modules, hooks, routes, storage |
| [Contributing](https://github.com/hackernotfound/dsh-tacit/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/hackernotfound/dsh-tacit/blob/main/CHANGELOG.md) | |

MIT © hackernotfound
