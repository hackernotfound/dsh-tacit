# Architecture

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
