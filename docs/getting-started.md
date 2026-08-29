# Getting started

*For anyone installing Tacit for the first time. About five minutes.*

## Prerequisites

| You need | Details |
| --- | --- |
| DeepSeek Harness (`dsh`) | version `>= 0.1.1-rc.1` — check with `npx @deepseek-ai/dsh --version` |
| Node.js | `>= 22` |
| A DeepSeek API key | already configured in the harness (**Settings → Models**). Tacit never reads it: every model call goes through the harness's own model service. |

## Install

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-tacit
```

If the CLI is already installed globally, you can use the shorter
`dsh plugin --profile web add dsh-tacit` form instead.

Then **start (or restart) `npx @deepseek-ai/dsh web`** and **refresh the browser
page**. Tacit has two halves: one runs inside the `dsh` process (needs the
restart), one runs in the browser (needs the refresh).

## Check that it is on

- In any conversation there is a **Tacit** tab next to *Chat / Trajectory / Context*.
- **Settings → Tacit** shows *Learned from 0 prompt(s)* and *Auto-learning on · 0/30 today*.

If the tab is missing, restart `npx @deepseek-ai/dsh web` once more and check the
version above.

## Optional: learn from what you already did (bootstrap)

Tacit learns as you go, but you can give it a head start from your recent history.
There are two buttons with the same label and different scope:

| Button | Where | Looks at |
| --- | --- | --- |
| *Learn from my last 20 turns* | Tacit tab | this conversation only |
| *Learn from my last 20 turns* | Settings → Tacit | every conversation currently loaded |

What it does: takes the 20 most recent finished turns, skips prompts shorter than
8 characters, bare continuations ("continue", "ok") and turns already analyzed,
analyzes the rest one after the other, then runs one distillation to produce the
first directives. It runs **outside** the daily cap. Cost: roughly $0.02–0.05 at
list price, once (see [Privacy & cost](privacy-and-cost.md#cost)).

## Then just work

Nothing else to do. Tacit reacts to two things, in the background:

| Signal | Example | What happens |
| --- | --- | --- |
| A turn ends **messy** — a retry, a tool error, a compaction, a cancel/reject, or 15+ model steps | the agent thrashed through many tool calls before answering | the prompt of that turn is analyzed |
| Your next message reads as a **correction** (short, starts with "no", "wrong", "I meant", "不对"…) | *"no, I meant the Next.js app under apps/web"* | the *previous* prompt is analyzed, with your correction as evidence |

After every 3 analyses Tacit distills what it learned into 1–4 **directives**. A
new directive is a *candidate* for 10 finished turns; if your messy-turn rate does
not get worse it becomes *active*, otherwise it is *retired*. Directives are
injected into the system prompt of every **new** conversation (not the running
one). The exact text is visible under **Settings → Tacit → Exact text injected**.

The details, with the real numbers, are in [How it works](how-it-works.md).

## Where things are in the UI

| Surface | What you see | What it does |
| --- | --- | --- |
| **Tacit tab** (conversation view) | one row per turn: tool calls, steps, tokens, retries; an *auto / correction / manual / bootstrap* badge on analyzed turns; the prompt; *Context added before the send* (only with `enrichPrompts`); the report | *Analyze* / *Re-analyze* one turn; *Select prompts…* → *Analyze selected*; *Learn from my last 20 turns* (this conversation); inline settings toggle |
| **Settings → Tacit** | learned-from count, auto-learning status (today / cap), the measured trend (messy-turn rate and tokens per turn, first 20 turns vs. latest 20 — appears after 40 finished turns) | bootstrap (all conversations); analysis model (`deepseek-v4-flash` / `deepseek-v4-pro`); *Auto-analyze messy turns*; *Daily cap on automatic analyses*; *Enable the composer Improve button*; *Clear all analysis reports (every session)* |
| **Settings → Tacit → What the agent is told about you** | every directive with its state chip (*trial 3/10*, *active*, *retired · reason*) and source chip (*yours* / *distilled*); *Learned style rules*; *Analyzed prompts* across conversations | toggle / remove / add directives; the *Inject learned directives into the system prompt* and *Add learned context before each send* switches; *Exact text injected* |
| **Composer** | **✨ Improve prompt** button left of the input | rewrites your current draft using what Tacit has learned; before/after preview → *Apply*; then a *Was this better?* 👍/👎 strip (👎 asks for a one-line reason) |

## Troubleshooting

**Nothing is being analyzed.**
Auto-analysis only looks at turns that *finish after the plugin started* (a
restart resets that), only when the turn was messy or your next message was a
correction, and never for bare continuations. Check **Settings → Tacit**: is
auto-learning on, and is today's count below the cap (30 by default)? You can
always analyze a turn by hand from the Tacit tab.

**I edited a directive and the agent still ignores it.**
The steering text is frozen when a conversation starts (it keeps the model's
prompt cache warm). Open a new conversation.

**The trend chips are missing.**
They need at least 40 finished turns across the conversations currently loaded.

**There is no ✨ button.**
It is switched off: Settings → Tacit → *Enable the composer Improve button*
(`liveSuggestions`).

**Manual Analyze says "continuation".**
Short continuation prompts ("continue", "go ahead", "yes") are never analyzed —
their context lives in the previous turn. No model call was made.

**Where is my data?**
`~/.dsh/storages/tacit/` (or `$DSH_HOME/storages/tacit/` if you set `DSH_HOME`).
See [Privacy & cost](privacy-and-cost.md).

**I used `dsh-prompt-coach` before.**
Tacit is its successor. On first start it renames `storages/prompt-coach` to
`storages/tacit` if the new directory does not exist yet. Nothing is deleted.

---

← [Docs index](README.md) · Next: [How it works](how-it-works.md)
