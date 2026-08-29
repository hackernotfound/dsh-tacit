// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
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
  /** Bootstrap analyses run at once (1 = one after another; same calls, less waiting). */
  bootstrapConcurrency: z.number().default(1),
  /** Also learn from a clean turn that follows a messy one (what the user included the second time). Automatic, capped. */
  learnFromGood: z.boolean().default(true),
  /** Days of detailed usage-ledger day files kept before they expire (7-365, clamped in mergeConfig). */
  costHistoryDays: z.number().default(30),
  /** Daily USD spend that triggers the warn/exceeded cost UI; 0 disables (clamped in mergeConfig). */
  costWarnDailyUsd: z.number().default(0),
  /** Same as `costWarnDailyUsd`, over a calendar month; 0 disables (clamped in mergeConfig). */
  costWarnMonthlyUsd: z.number().default(0),
}))

/**
 * A UI-written config patch: only fields the user changed are persisted, so
 * YAML/loader config keeps acting as the base for everything else.
 */
const configPatchSchema = z.object({
  model: z.string().optional(),
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
  bootstrapConcurrency: z.number().optional(),
  learnFromGood: z.boolean().optional(),
  costHistoryDays: z.number().optional(),
  costWarnDailyUsd: z.number().optional(),
  costWarnMonthlyUsd: z.number().optional(),
})

// ── Trajectory projection ──────────────────────────────────────────────────

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  reasoningTokens: z.number(),
})

const toolCallSchema = z.object({
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

const problemSchema = z.object({
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
  /** Original prompt excerpt (clipped at save time); older reports lack it. */
  promptExcerpt: z.string().optional(),
  /** What produced this report: 'manual' (click), 'auto' (messy turn), 'correction' (next prompt corrected the agent). */
  trigger: z.string().default('manual'),
  /** The user's next message when it triggered the analysis (clipped). */
  followUp: z.string().optional(),
  /** Absolute workspace directory of the conversation, when the harness knew it. */
  cwd: z.string().optional(),
  /** trigger 'good' only: what the clean prompt supplied that the messy one before it lacked. */
  strengths: z.array(z.object({ kind: z.string(), what: z.string() })).optional(),
  /** trigger 'good' only: the one-sentence lesson fed to the distiller. */
  lesson: z.string().optional(),
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
  /** Times a clean prompt right after a messy turn showed the user supplying this themselves. */
  resolved: z.number().int().default(0),
})

/** One distilled durable style rule (from rejected-improvement reasons). */
const styleRuleSchema = z.object({
  rule: z.string(),
  createdAt: z.number(),
})

/** One recorded verdict in the bounded feedback log. */
const feedbackEntrySchema = z.object({
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
const directiveTrialSchema = z.object({
  /** Finished turns observed while the candidate was injected. */
  turns: z.number().int().min(0),
  /** How many of those were messy. */
  messy: z.number().int().min(0),
  /** Messy-turn rate over the 20 turns before the trial started. */
  baselineRate: z.number(),
  startedAt: z.number(),
})

const directiveSchema = z.object({
  id: z.string(),
  text: z.string(),
  enabled: z.boolean().default(true),
  source: z.enum(['distilled', 'user']).default('distilled'),
  createdAt: z.number(),
  /** candidate = injected on trial; active = proven (or user-made); retired = made things worse. */
  status: z.enum(['candidate', 'active', 'retired']).default('active'),
  trial: directiveTrialSchema.optional(),
  retiredReason: z.string().optional(),
  /** Absolute workspace directory this directive is limited to; absent = every conversation. */
  workspace: z.string().optional(),
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
  /** Verdict log (max 10, oldest replaced). */
  feedbackLog: z.array(feedbackEntrySchema).default([]),
  /** Down-reasons not yet distilled into style rules. */
  pendingDistill: z.number().int().min(0).default(0),
  /** Agent-facing directives (max 8) rendered into the steering section. */
  directives: z.array(directiveSchema).default([]),
  /** New analyses since the last directive distillation. */
  analysesSinceDirectives: z.number().int().min(0).default(0),
})

// ── Route argument codecs ──────────────────────────────────────────────────

export const bootstrapArgSchema = z.object({
  sessionId: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

export const statsArgSchema = z.object({
  window: z.number().int().min(3).max(200).optional(),
})

export const directivesArgSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('toggle'), id: z.string().min(1).max(64), enabled: z.boolean() }),
  z.object({ action: z.literal('add'), text: z.string().min(1).max(300), workspace: z.string().max(1000).optional() }),
  z.object({ action: z.literal('remove'), id: z.string().min(1).max(64) }),
])

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

// ── Usage ledger (content-free: no prompts, no responses, no tool args) ────

/** Every op a metered model call can be tagged with (Task 1's sink + the distillation/enrichment calls). */
export const USAGE_OPS = [
  'analysis',
  'analysis-repair',
  'directive-distillation',
  'style-distillation',
  'improve',
  'improve-repair',
  'enrichment',
]

/** Every kind of run the tracker groups attempts into. */
export const USAGE_RUN_TYPES = [
  'bootstrap',
  'analysis',
  'analysis-batch',
  'improve',
  'directive-distillation',
  'style-distillation',
  'prompt-enrichment',
]

/** Raw token counts, zero-filled so totals can be summed without null checks. */
export const tokenBucketsSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadTokens: z.number().default(0),
  cacheWriteTokens: z.number().default(0),
  reasoningTokens: z.number().default(0),
})

/**
 * One metered model call. Mirrors the sink record `callCoachModel` hands the
 * tracker (`startedAt`..`usage`) plus the identity fields the tracker itself
 * assigns (`id`, `op`, `sessionId`, `turn`) and the priced result. Never
 * carries prompt/response text, tool args, or API keys.
 */
export const usageAttemptSchema = z.object({
  id: z.string(),
  op: z.enum(USAGE_OPS),
  startedAt: z.number(),
  durationMs: z.number().default(0),
  model: z.string().default(''),
  provider: z.string().default(''),
  reasoningEffort: z.string().nullable().default(null),
  finish: z.string().default(''),
  status: z.enum(['ok', 'failed', 'unmetered']),
  code: z.string().default(''),
  sessionId: z.string().default(''),
  turn: z.number().nullable().default(null),
  usage: tokenBucketsSchema.nullable().default(null),
  /** null when no price table matched the route/model (e.g. a proxy provider). */
  priced: z.object({
    source: z.enum(['bundled', 'costMeter']),
    tier: z.string(),
    rates: z.object({ cacheHit: z.number(), cacheMiss: z.number(), output: z.number() }),
    asOf: z.string(),
    usd: z.number(),
  }).nullable().default(null),
})

/**
 * A precomputed, already-defaulted instance of a nested object schema.
 * zod's `.default(value)` injects `value` verbatim when a field is absent —
 * it does NOT re-run `value` through the schema — so a literal `{}` default
 * on a nested object would skip that object's own field defaults. Passing
 * `schema.parse({})` instead gives the same "all defaults" shape correctly.
 */
const emptyTokenBuckets = tokenBucketsSchema.parse({})

/** Aggregate counters shared by a run's totals, the lifetime summary, and every summary bucket. */
export const usageTotalsSchema = z.object({
  attempts: z.number().default(0),
  billedCalls: z.number().default(0),
  unmeteredCalls: z.number().default(0),
  unpricedCalls: z.number().default(0),
  tokens: tokenBucketsSchema.default(emptyTokenBuckets),
  usdKnown: z.number().default(0),
})

const emptyUsageTotals = usageTotalsSchema.parse({})

/** One tracker run: a group of attempts sharing a trigger (a single call, an auto-analysis, a bootstrap batch, ...). */
export const usageRunSchema = z.object({
  runId: z.string(),
  type: z.enum(USAGE_RUN_TYPES),
  trigger: z.string().default(''),
  startedAt: z.number(),
  endedAt: z.number().default(0),
  status: z.enum(['running', 'success', 'partial', 'failed']).default('running'),
  sessionId: z.string().default(''),
  turn: z.number().nullable().default(null),
  workspace: z.string().default(''),
  model: z.string().default(''),
  provider: z.string().default(''),
  results: z.record(z.number()).default({}),
  attempts: z.array(usageAttemptSchema).default([]),
  totals: usageTotalsSchema.default(emptyUsageTotals),
})

/** One day's `usage/YYYY-MM-DD.json` file. */
export const usageDayFileSchema = z.object({
  version: z.literal(1),
  day: z.string(),
  runs: z.array(usageRunSchema).default([]),
})

const usageDayTotalsSchema = usageTotalsSchema.extend({
  byType: z.record(usageTotalsSchema).default({}),
})

/** `usage/summary.json`: rolling totals kept alongside the day files so reports never have to re-scan every day. */
export const usageSummarySchema = z.object({
  version: z.literal(1),
  trackingSince: z.number(),
  lifetime: usageTotalsSchema.default(emptyUsageTotals),
  byType: z.record(usageTotalsSchema).default({}),
  byModel: z.record(usageTotalsSchema).default({}),
  days: z.record(usageDayTotalsSchema).default({}),
})

/**
 * Arguments for `/api/tacit/usage`. Declared here (not next to
 * `bootstrapArgSchema`) because `z.enum(USAGE_RUN_TYPES)` needs the run-type
 * list above it. Every field is optional on the wire; `tracker.report()`
 * applies the defaults (`range: '30d'`, `page: 1`, `pageSize: 20`).
 */
export const usageArgSchema = z.object({
  range: z.enum(['today', '7d', '30d', 'month', 'all']).optional(),
  type: z.enum(USAGE_RUN_TYPES).optional(),
  status: z.enum(['success', 'partial', 'failed']).optional(),
  model: z.string().max(64).optional(),
  workspace: z.string().max(200).optional(),
  sessionId: z.string().max(200).optional(),
  page: z.number().int().min(1).max(1000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

/** Arguments for `/api/tacit/usage-run`: one run id, as minted by `beginRun`. */
export const usageRunArgSchema = z.object({
  runId: z.string().min(1).max(64),
})
