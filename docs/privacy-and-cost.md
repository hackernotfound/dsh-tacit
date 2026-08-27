# Privacy, cost and known limitations

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
