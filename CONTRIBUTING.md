# Contributing to Tacit

Thanks for looking. Tacit is a small, zero-build plugin for
[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (`dsh`):
plain ES modules, no bundler, no TypeScript step.

## Prerequisites

- Node ≥ 22 and pnpm
- a working `dsh` install (`npx @deepseek-ai/dsh web`) with a DeepSeek API key
  configured in Settings → Models — only needed for the live smoke test

## Set up a development checkout

```bash
git clone https://github.com/hackernotfound/dsh-tacit
cd dsh-tacit
pnpm install
dsh plugin --profile web add "$PWD"   # links this folder into ~/.dsh/profiles/web
```

Then start (or restart) `dsh web` and refresh the harness page.

**Restart vs refresh:** anything under `lib/` runs in the host process — restart
`dsh web` after changing it. `client/client.js` runs in the browser — a page
refresh is enough. Reinstall only when `package.json` dependencies change.

## Tests

```bash
pnpm test                 # node --test: fold, calls, analysis, trust, schema, store, host integration, client SSR
pnpm smoke                # live end-to-end against a running dsh web; real model calls, ≈ $0.005
TACIT_BASE=http://127.0.0.1:4000 pnpm smoke   # if your dsh web is not on :3080
```

CI runs `pnpm test` on Node 22 and 24. Please keep it green.

## Ground rules

- **Tests for behavior.** Anything that changes what Tacit learns, injects, or
  spends money on needs a test in `test/`. The integration tests stub the
  whole harness (`test/integration.test.mjs`) so no key is needed.
- **`zh` and `en` dictionaries stay in sync.** Both live in `client/client.js`
  and a test fails if their key sets diverge. If you only speak one of the two,
  add the other with a best-effort translation and say so in the PR — a native
  review is welcome.
- **Never add a way for Tacit to read an API key or call a custom endpoint.**
  All model calls go through `ctx.llm.stream`; the model is allowlisted in
  `lib/schema.js`.
- **Cost is a feature.** New automatic calls must be capped (see
  `autoDailyBudget`) and use `reasoningEffort: 'low'` with a tool schema.
- **Don't delete user data.** The only deletion path is "Clear all analysis
  reports" in Settings.

## Where things live

See [docs/architecture.md](docs/architecture.md). Short version:
`lib/fold.js` turns session events into turn digests, `lib/analyze.js` holds
the prompts, heuristics and model calls, `lib/service.js` is the host service
(auto triggers, trials, bootstrap, steering), `lib/routes.js` the JSON API,
`client/client.js` the whole UI.

## Reporting bugs

Open an issue with the dsh version (`npx @deepseek-ai/dsh --version`), what you
typed, what the Tacit tab / console showed, and — if it is about a directive —
the directive text from Settings → Tacit. Please strip anything private from
prompts before pasting them.
