# Contributing to Tacit

*中文版：[docs/CONTRIBUTING.zh.md](docs/CONTRIBUTING.zh.md)*

Thanks for looking. Tacit is a small, zero-build plugin for
[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (`dsh`):
plain ES modules, no bundler, no TypeScript step. You do not need push access,
a signing key or an API key to contribute — the whole test suite runs against
a stubbed harness.

## Prerequisites

- Node ≥ 22 and pnpm 11.23.0 (`corepack enable` will honor the pinned
  `packageManager` version)
- a GitHub account (to fork and open a pull request)
- a working `dsh` install (`npx @deepseek-ai/dsh web`) with a DeepSeek API key
  configured in Settings → Models — only needed to try your change live or run
  the smoke test, not for the unit tests

## Find something to work on

- [`good first issue`](https://github.com/hackernotfound/dsh-tacit/labels/good%20first%20issue)
  — small, bounded, with acceptance criteria and a pointer to the code.
- [`help wanted`](https://github.com/hackernotfound/dsh-tacit/labels/help%20wanted)
  — bigger pieces where the design is open; comment on the issue first and the
  maintainer will pair on the approach.
- Anything else you noticed: open an
  [issue](https://github.com/hackernotfound/dsh-tacit/issues/new/choose) or ask
  in [Discussions](https://github.com/hackernotfound/dsh-tacit/discussions).

If a task will take you more than an hour, leave a comment on the issue before
you start so nobody duplicates the work. Where the code lives is mapped in
[docs/architecture.md](docs/architecture.md).

## Fork, clone, link

```bash
gh repo fork hackernotfound/dsh-tacit --clone      # or fork on github.com and git clone your fork
cd dsh-tacit
git remote add upstream https://github.com/hackernotfound/dsh-tacit   # skip if gh added it already
pnpm install
npx @deepseek-ai/dsh plugin --profile web add "$PWD"   # links this folder into ~/.dsh/profiles/web
```

Then start (or restart) `npx @deepseek-ai/dsh web` and refresh the harness page.

**Restart vs refresh:** anything under `lib/` runs in the host process — restart
`npx @deepseek-ai/dsh web` after changing it. The browser side is edited under
`client/src/` (one file per section, no imports — the harness loads a single
classic script per plugin) and rebuilt into `client/client.js` with
`pnpm build:client`; then a page refresh is enough. Never edit
`client/client.js` by hand — `pnpm check:client` (also run in CI) rejects a
bundle that differs from its sources. Reinstall only when `package.json`
dependencies change.

## Tests

```bash
pnpm test                 # node --test: fold, calls, analysis, trust, schema, store, host integration, client SSR
pnpm build:client         # regenerate client/client.js from client/src/
pnpm check:client         # the committed client/client.js matches client/src/
pnpm check:docs           # local Markdown links and anchors
pnpm check:package        # npm tarball contents and English root README
pnpm check                # all four checks above
pnpm smoke                # HTTP end-to-end against a running dsh web (no model calls, free)
TACIT_SMOKE_SESSION=<id> pnpm smoke           # also exercises ✨ Improve: one real model call, ≈ $0.001
TACIT_BASE=http://127.0.0.1:4000 pnpm smoke   # if your dsh web is not on :3080
```

CI runs `pnpm test` on Node 22 and 24 plus the docs and package checks for every
push and PR. Please keep CI green.

## Open a pull request

```bash
git fetch upstream
git switch -c fix/short-description upstream/main   # feat/, fix/, docs/, chore/, refactor/
# … make your change …
pnpm check
git commit -am "fix: short description"
git push -u origin fix/short-description
gh pr create        # or open the PR from your fork on github.com
```

- One concern per PR. A fix and an unrelated refactor are two PRs.
- The PR template asks for the essentials: what and why, `pnpm check` green,
  tests for behaviour changes, `zh`/`en` parity, and a line under
  `## Unreleased` in `CHANGELOG.md` when the change is release-worthy.
- You do **not** need to sign commits or keep history tidy; the maintainer
  squashes or rebases on merge.
- Reviews are usually within a few days. A request for changes is about the
  diff, never about you.

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
  tool schema and pass the `sessionId` so cost meters can attribute it, and
  wrap the call with `metered()` so it lands in the usage ledger; new
  *automatic* calls should be capped (see `autoDailyBudget`). Add any new call to
  the cost table in [docs/privacy-and-cost.md](docs/privacy-and-cost.md#cost).
- **Don't delete user data.** There are exactly two deletion paths, both
  restricted to Tacit's own files: analysis reports
  (`reports/<session>/<turn>.json`), via "Clear all analysis reports" in
  Settings; and usage day files (`usage/<YYYY-MM-DD>.json`) older than
  `costHistoryDays`, or all of them via `clearUsage()`. Nothing else on disk
  is ever touched, and neither directory is ever removed.

## Where things live

Behaviour: [docs/how-it-works.md](docs/how-it-works.md). Code map, hooks,
routes and storage: [docs/architecture.md](docs/architecture.md). Short version:
`lib/fold.js` turns session events into turn digests, `lib/analyze.js` holds
the prompts, heuristics and model calls, `lib/service.js` is the host service
(auto triggers, trials, bootstrap, steering), `lib/routes.js` the JSON API,
`client/src/*.js` the whole UI (i18n, API client, stores, components, panel,
CSS, plugin body — concatenated into the shipped `client/client.js`).

## Reporting bugs

Use the [bug report form](https://github.com/hackernotfound/dsh-tacit/issues/new/choose).
It asks for the dsh version (`npx @deepseek-ai/dsh --version`), what you typed,
what the Tacit tab / console showed, and — if it is about a directive — the
directive text from Settings → Tacit. Please strip anything private from
prompts before pasting them. Suspected vulnerabilities go through
[SECURITY.md](SECURITY.md), not a public issue.

## Release policy (maintainer only)

Contributors never need to run any of this; it is here so the versioning is
predictable. Not every merged change needs an npm release:

- Use a **patch** release for fixes, runtime dependency or configuration
  changes, packaged host/client changes, and root `README.md` updates that must
  appear on npmjs.com.
- While Tacit is pre-1.0, use a **minor** release for new features and breaking
  changes.
- Do not release for GitHub-only `docs/` changes, tests, CI, contributor files,
  security files or repository settings.

Release-worthy notes go under `## Unreleased` in `CHANGELOG.md`. To release,
turn that section into a dated version section, then run `npm version patch` or
`npm version minor` and push the commit and tag with `git push --follow-tags`.
Publishing to npm happens when the `v*` tag is pushed, with npm provenance
through OIDC trusted publishing and no npm token. Never move an existing
release tag; corrections after publication get a new patch version.
