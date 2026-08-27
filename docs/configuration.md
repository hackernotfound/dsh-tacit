# Configuration

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
The bootstrap size (20) is an API parameter (`limit`, 1–50), not a setting.
An old `learningThreshold` key in `config.patch.json` is ignored.

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
