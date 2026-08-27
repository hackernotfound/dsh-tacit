# Contributing to Tacit

Thanks for looking. Tacit is a small, zero-build plugin for
[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (`dsh`):
plain ES modules, no bundler, no TypeScript step.

## Prerequisites

- Node ≥ 22 and pnpm 11.23.0 (`corepack enable` will honor the pinned
  `packageManager` version)
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
pnpm check:docs           # local Markdown links and anchors
pnpm check:package        # npm tarball contents and English root README
pnpm check                # all three checks above
pnpm smoke                # HTTP end-to-end against a running dsh web (no model calls, free)
TACIT_SMOKE_SESSION=<id> pnpm smoke           # also exercises ✨ Improve: one real model call, ≈ $0.001
TACIT_BASE=http://127.0.0.1:4000 pnpm smoke   # if your dsh web is not on :3080
```

CI runs `pnpm test` on Node 22 and 24 plus the docs and package checks for every
push and PR. Publishing to npm happens when a `v*` tag is pushed, with npm
provenance through OIDC trusted publishing and no npm token. Please keep CI
green.

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
- **Cost is a feature.** Every call must use `reasoningEffort: 'low'` with a
  tool schema and pass the `sessionId` so cost meters can attribute it; new
  *automatic* calls should be capped (see `autoDailyBudget`). Add any new call to
  the cost table in [docs/privacy-and-cost.md](docs/privacy-and-cost.md#cost).
- **Don't delete user data.** The only deletion path is "Clear all analysis
  reports" in Settings.

## Where things live

Behaviour: [docs/how-it-works.md](docs/how-it-works.md). Code map, hooks,
routes and storage: [docs/architecture.md](docs/architecture.md). Short version:
`lib/fold.js` turns session events into turn digests, `lib/analyze.js` holds
the prompts, heuristics and model calls, `lib/service.js` is the host service
(auto triggers, trials, bootstrap, steering), `lib/routes.js` the JSON API,
`client/client.js` the whole UI.

## Reporting bugs

Open an issue with the dsh version (`npx @deepseek-ai/dsh --version`), what you
typed, what the Tacit tab / console showed, and — if it is about a directive —
the directive text from Settings → Tacit. Please strip anything private from
prompts before pasting them.

## Release policy

Not every merged change needs an npm release:

- Use a **patch** release for fixes, runtime dependency or configuration
  changes, packaged host/client changes, and root `README.md` updates that must
  appear on npmjs.com.
- While Tacit is pre-1.0, use a **minor** release for new features and breaking
  changes.
- Do not release for GitHub-only `docs/` changes, tests, CI, contributor files,
  security files or repository settings.

Add release-worthy notes under `## Unreleased` in `CHANGELOG.md`. To release,
turn that section into a dated version section, then run `npm version patch` or
`npm version minor` and push the commit and tag with `git push --follow-tags`.
Never move an existing release tag; corrections after publication get a new
patch version.
