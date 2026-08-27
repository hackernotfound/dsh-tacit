/**
 * dsh-tacit — shared zod schemas (host side).
 *
 * All wire payloads, persisted state, and the plugin Config live here so the
 * fold, the service, the HTTP routes, and the loader's config validation
 * share one definition. zod v4 (the same major the profile hoists).
 */

import { z } from 'zod'

// ── Config ─────────────────────────────────────────────────────────────────

export const COACH_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro']
/**
 * Fallback provider id — the shipped DeepSeek adapter registers as
 * `deepseek-official` (see dsh-llm-deepseek / agent-default-model settings).
 * Whenever the session's own route is known (from its request/header events)
 * that route wins, so proxy/custom providers keep working.
 */
export const COACH_PROVIDER = 'deepseek-official'

/**
 * The loader-facing plugin config. Wrapped in `z.preprocess` so a patch row
 * without a `config:` block (`undefined`) resolves to all defaults — a bare
 * `z.object` rejects `undefined` even when every field has a default.
 */
export const Config = z.preprocess((v) => v ?? {}, z.object({
  /** Coach model id, allowlisted (see COACH_MODELS). */
  model: z.string().default('deepseek-v4-flash'),
  /** Analyses required before the live composer button unlocks. */
  learningThreshold: z.number().default(20),
  /** Whether the live composer improvement feature may appear at all. */
  liveSuggestions: z.boolean().default(true),
  /** Whole turns retained in the projection (newest kept). */
  maxKeptTurns: z.number().default(60),
  /** Prompt text kept per turn (chars). */
  maxPromptChars: z.number().default(4000),
  /** Tool-call argument preview kept per call (chars). */
  maxToolCallChars: z.number().default(500),
  /** Final assistant text kept per turn (chars). */
  maxAssistantChars: z.number().default(4000),
  /** Tool-call entries kept per turn. */
  maxToolCallsPerTurn: z.number().default(50),
  /** Mistake patterns kept in the persistent profile. */
  maxPatterns: z.number().default(12),
  /** Analyze messy / corrected turns automatically on the projection feed (zero clicks). */
  autoAnalyze: z.boolean().default(true),
  /** Hard cap on automatic analyses per calendar day (cost guard). */
  autoDailyBudget: z.number().default(30),
  /** A finished turn with at least this many model steps counts as messy. */
  autoMinSteps: z.number().default(15),
  /** Inject the learned directives into every session's system prompt. */
  steerAgent: z.boolean().default(true),
  /** New analyses between two directive distillations. */
  directiveEvery: z.number().default(3),
  /** Opt-in: before each send, one small call appends learned context to the step (never rewrites the user's words). */
  enrichPrompts: z.boolean().default(false),
  /** Finished turns a distilled directive stays on trial before it is activated or retired. */
  directiveTrialTurns: z.number().default(10),
  /** A candidate retires when the messy-turn rate during its trial exceeds the baseline by more than this. */
  directiveWorseBy: z.number().default(0.15),
}))

/**
 * A UI-written config patch: only fields the user changed are persisted, so
 * YAML/loader config keeps acting as the base for everything else.
 */
export const configPatchSchema = z.object({
  model: z.string().optional(),
  learningThreshold: z.number().optional(),
  liveSuggestions: z.boolean().optional(),
  maxKeptTurns: z.number().optional(),
  maxPromptChars: z.number().optional(),
  maxToolCallChars: z.number().optional(),
  maxAssistantChars: z.number().optional(),
  maxToolCallsPerTurn: z.number().optional(),
  maxPatterns: z.number().optional(),
  autoAnalyze: z.boolean().optional(),
  autoDailyBudget: z.number().optional(),
  autoMinSteps: z.number().optional(),
  steerAgent: z.boolean().optional(),
  directiveEvery: z.number().optional(),
  enrichPrompts: z.boolean().optional(),
  directiveTrialTurns: z.number().optional(),
  directiveWorseBy: z.number().optional(),
})

// ── Trajectory projection ──────────────────────────────────────────────────

export const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  reasoningTokens: z.number(),
})

export const toolCallSchema = z.object({
  name: z.string(),
  args: z.string(),
})

/** One turn's digest — the fold's unit and the analysis input. */
export const turnSchema = z.object({
  turn: z.number(),
  startedAt: z.number(),
  /** Fold-internal provisional (first user/message of any source); absent on the wire. */
  provisionalPrompt: z.string().optional(),
  prompt: z.string(),
  steps: z.number(),
  toolCalls: z.array(toolCallSchema),
  toolErrors: z.number(),
  retries: z.number(),
  compactions: z.number(),
  feedback: z.number(),
  usage: usageSchema,
  finalText: z.string(),
  model: z.string(),
  provider: z.string(),
  finished: z.boolean(),
  endedAt: z.number(),
  /** How the turn ended (from turn/end data.reason, e.g. 'success'|'rejected'|'cancelled'); absent on old checkpoints. */
  endReason: z.string().default(''),
  /** Context the coach appended before the send (plugin-sourced user message); '' when none. */
  enrichment: z.string().default(''),
})

/** Persisted projection state (plain JSON; bump stateVersion on change). */
export const timelineStateSchema = z.object({
  createdAt: z.number().default(0),
  maxKeptTurns: z.number().default(60),
  turns: z.array(turnSchema),
  current: turnSchema.nullable(),
})

/** The wire payload delivered to the browser for `tacitTimeline`. */
export const timelineViewSchema = z.object({
  turns: z.array(turnSchema),
})

// ── Reports & profile ──────────────────────────────────────────────────────

export const problemSchema = z.object({
  kind: z.string(),
  severity: z.string(),
  what: z.string(),
  why: z.string(),
})

export const reportSchema = z.object({
  ok: z.boolean(),
  turn: z.number(),
  time: z.number(),
  model: z.string(),
  problems: z.array(problemSchema),
  improvedPrompt: z.string(),
  explanation: z.string(),
  estimatedTokenSavingPct: z.number(),
  /** Original prompt excerpt (clipped at save time); older reports lack it. */
  promptExcerpt: z.string().optional(),
  /** What produced this report: 'manual' (click), 'auto' (messy turn), 'correction' (next prompt corrected the agent). */
  trigger: z.string().default('manual'),
  /** The user's next message when it triggered the analysis (clipped). */
  followUp: z.string().optional(),
})

/**
 * v2 trust/feedback counters on one mistake pattern. Every field is
 * optional-with-default so v1 profiles (kind/count/lastExample only) parse
 * unchanged — missing counters mean 0, exactly what `safeProfile` merges.
 */
export const patternCountersSchema = z.object({
  /** Times a rewrite touching this pattern was APPLIED to the composer. */
  applied: z.number().int().default(0),
  /** Times an applied rewrite was rated 👍. */
  accepted: z.number().int().default(0),
  /** Times an applied rewrite was rated 👎. */
  rejected: z.number().int().default(0),
  /** Times the next turn's outcome was BETTER than the baseline (free signals). */
  verified: z.number().int().default(0),
  /** Times the next turn's outcome was same/worse than the baseline. */
  unverified: z.number().int().default(0),
})

/** One distilled durable style rule (from rejected-improvement reasons). */
export const styleRuleSchema = z.object({
  rule: z.string(),
  createdAt: z.number(),
})

/** One accepted rewrite kept in the bounded good-examples library. */
export const goodExampleSchema = z.object({
  prompt: z.string(),
  improved: z.string(),
  acceptedAt: z.number(),
})

/** One recorded verdict in the bounded feedback log. */
export const feedbackEntrySchema = z.object({
  time: z.number(),
  verdict: z.enum(['up', 'down']),
  reason: z.string(),
  patternKinds: z.array(z.string()),
})

/**
 * One directive the AGENT follows on the user's behalf (rendered into the
 * system prompt). `distilled` entries come from analyses; `user` entries are
 * typed in Settings and survive every distillation.
 */
export const directiveTrialSchema = z.object({
  /** Finished turns observed while the candidate was injected. */
  turns: z.number().int().min(0),
  /** How many of those were messy. */
  messy: z.number().int().min(0),
  /** Messy-turn rate over the 20 turns before the trial started. */
  baselineRate: z.number(),
  startedAt: z.number(),
})

export const directiveSchema = z.object({
  id: z.string(),
  text: z.string(),
  enabled: z.boolean().default(true),
  source: z.enum(['distilled', 'user']).default('distilled'),
  createdAt: z.number(),
  /** candidate = injected on trial; active = proven (or user-made); retired = made things worse. */
  status: z.enum(['candidate', 'active', 'retired']).default('active'),
  trial: directiveTrialSchema.optional(),
  retiredReason: z.string().optional(),
})

/** The persistent user-wide mistake profile. */
export const profileSchema = z.object({
  analyzedCount: z.number(),
  patterns: z.array(
    z.object({
      kind: z.string(),
      count: z.number(),
      lastExample: z.string(),
    }).merge(patternCountersSchema),
  ),
  updatedAt: z.number(),
  /** Distilled style rules riding every improve call (max 6, oldest replaced). */
  styleRules: z.array(styleRuleSchema).default([]),
  /** Accepted rewrites (max 10, oldest replaced). */
  goodExamples: z.array(goodExampleSchema).default([]),
  /** Verdict log (max 10, oldest replaced). */
  feedbackLog: z.array(feedbackEntrySchema).default([]),
  /** Down-reasons not yet distilled into style rules. */
  pendingDistill: z.number().int().min(0).default(0),
  /** Agent-facing directives (max 8) rendered into the steering section. */
  directives: z.array(directiveSchema).default([]),
  /** New analyses since the last directive distillation. */
  analysesSinceDirectives: z.number().int().min(0).default(0),
})

// ── HTTP wire payloads (client-facing) ─────────────────────────────────────

export const autoStatusSchema = z.object({
  /** Automatic analyses already spent today. */
  today: z.number(),
  /** The configured daily cap. */
  budget: z.number(),
})

export const steeringStatusSchema = z.object({
  enabled: z.boolean(),
  /** The exact section text the agent receives ('' when nothing is injected). */
  text: z.string(),
})

export const bootstrapStatusSchema = z.object({
  running: z.boolean(),
  done: z.number(),
  total: z.number(),
  startedAt: z.number(),
})

export const statePayloadSchema = z.object({
  ok: z.boolean(),
  config: Config,
  profile: profileSchema,
  auto: autoStatusSchema,
  steering: steeringStatusSchema,
  bootstrap: bootstrapStatusSchema,
  message: z.string(),
})

export const bootstrapArgSchema = z.object({
  sessionId: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

export const bootstrapPayloadSchema = z.object({
  ok: z.boolean(),
  analyzed: z.number(),
  skipped: z.number(),
  directives: z.number(),
  code: z.string(),
  detail: z.string(),
})

export const statsArgSchema = z.object({
  window: z.number().int().min(3).max(200).optional(),
})

export const trendWindowSchema = z.object({
  n: z.number(),
  messyRate: z.number(),
  tokensPerTurn: z.number(),
})

export const trendSchema = z.object({
  enough: z.boolean(),
  window: z.number(),
  early: trendWindowSchema,
  recent: trendWindowSchema,
})

export const statsPayloadSchema = z.object({
  ok: z.boolean(),
  trend: trendSchema,
  code: z.string(),
  detail: z.string(),
})

export const directivesArgSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('toggle'), id: z.string().min(1).max(64), enabled: z.boolean() }),
  z.object({ action: z.literal('add'), text: z.string().min(1).max(300) }),
  z.object({ action: z.literal('remove'), id: z.string().min(1).max(64) }),
])

export const directivesPayloadSchema = z.object({
  ok: z.boolean(),
  profile: profileSchema,
  steering: steeringStatusSchema,
  code: z.string(),
  detail: z.string(),
})

export const reportsPayloadSchema = z.object({
  ok: z.boolean(),
  reports: z.record(z.string(), reportSchema),
  message: z.string(),
})

export const coachedEntrySchema = z.object({
  sessionId: z.string(),
  /** Workspace basename of the session (empty when unknown). */
  sessionLabel: z.string().default(''),
  turn: z.number(),
  time: z.number(),
  model: z.string(),
  promptExcerpt: z.string(),
  improvedPrompt: z.string(),
  estimatedTokenSavingPct: z.number(),
  trigger: z.string().default('manual'),
})

export const coachedPayloadSchema = z.object({
  ok: z.boolean(),
  entries: z.array(coachedEntrySchema),
  code: z.string(),
  detail: z.string(),
})

export const analyzePayloadSchema = z.object({
  ok: z.boolean(),
  report: reportSchema.nullable(),
  profile: profileSchema,
  code: z.string(),
  detail: z.string(),
})

export const improvePayloadSchema = z.object({
  ok: z.boolean(),
  improved: z.string(),
  rationale: z.string(),
  savingsEstimate: z.number(),
  /** Id of this rewrite for the feedback/applied loop; empty on failure. */
  rewriteId: z.string().default(''),
  /** Pattern kinds offered in THIS rewrite's prompt (empty before readiness). */
  patternsUsed: z.array(z.string()).default([]),
  code: z.string(),
  detail: z.string(),
})

export const feedbackPayloadSchema = z.object({
  ok: z.boolean(),
  profile: profileSchema,
  code: z.string(),
  detail: z.string(),
})

export const appliedPayloadSchema = z.object({
  ok: z.boolean(),
  code: z.string(),
  detail: z.string(),
})

export const configPayloadSchema = z.object({
  ok: z.boolean(),
  config: Config,
  code: z.string(),
  detail: z.string(),
})

export const clearPayloadSchema = z.object({
  ok: z.boolean(),
  removed: z.number(),
  code: z.string(),
  detail: z.string(),
})

// ── Route argument codecs ──────────────────────────────────────────────────

export const sessionArgSchema = z.object({
  sessionId: z.string().min(1).max(200),
})

export const analyzeArgSchema = z.object({
  sessionId: z.string().min(1).max(200),
  turn: z.number().int().min(1),
})

export const improveArgSchema = z.object({
  sessionId: z.string().min(1).max(200),
  draft: z.string().min(1).max(100000),
})

export const feedbackArgSchema = z.object({
  rewriteId: z.string().min(1).max(64),
  verdict: z.enum(['up', 'down']),
  /** One-line rejection reason; the service clips it to 300 chars (bounded log). */
  reason: z.string().max(2000).optional(),
})

export const appliedArgSchema = z.object({
  sessionId: z.string().min(1).max(200),
  rewriteId: z.string().min(1).max(64),
})

export const configArgSchema = z.object({
  patch: configPatchSchema,
})
