// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Config,
  profileSchema,
  reportSchema,
  patternCountersSchema,
  turnSchema,
  feedbackArgSchema,
  appliedArgSchema,
  configArgSchema,
  directivesArgSchema,
  analyzeArgSchema,
  analyzeBatchArgSchema,
  directiveReceiptArgSchema,
  tokenBucketsSchema,
  usageAttemptSchema,
  usageTotalsSchema,
  usageRunSchema,
  usageDayFileSchema,
  usageSummarySchema,
  USAGE_OPS,
  USAGE_RUN_TYPES, directivesArgSchema } from '../lib/schema.js'

// Regression: the loader passes `undefined` when the patch row has no
// `config:` block — Config must resolve to all defaults, not throw.
test('Config.parse(undefined) resolves to all defaults', () => {
  const parsed = Config.parse(undefined)
  assert.deepEqual(parsed, {
    model: 'deepseek-v4-flash',
    liveSuggestions: true,
    maxKeptTurns: 60,
    maxPromptChars: 4000,
    maxToolCallChars: 500,
    maxAssistantChars: 4000,
    maxToolCallsPerTurn: 50,
    maxPatterns: 12,
    autoAnalyze: true,
    autoDailyBudget: 30,
    autoMinSteps: 15,
    steerAgent: true,
    directiveEvery: 3,
    enrichPrompts: false,
    directiveTrialTurns: 10,
    directiveWorseBy: 0.15,
    bootstrapConcurrency: 1,
    learnFromGood: true,
    costHistoryDays: 30,
    costWarnDailyUsd: 0,
    costWarnMonthlyUsd: 0,
    reviewCandidates: false,
  })
})

test('Config.parse keeps overrides and fills the rest with defaults', () => {
  const parsed = Config.parse({ autoDailyBudget: 1 })
  assert.equal(parsed.autoDailyBudget, 1)
  assert.equal(parsed.model, 'deepseek-v4-flash')
  assert.equal(parsed.maxKeptTurns, 60)
})

// ── Profile v2 (backward compatible) ──────────────────────────────────────

test('a v1 profile (no counters, no v2 fields) parses into the v2 shape with defaults', () => {
  const v1 = {
    analyzedCount: 3,
    patterns: [{ kind: 'ambiguous-goal', count: 2, lastExample: 'be specific' }],
    updatedAt: 42,
  }
  const parsed = profileSchema.parse(v1)
  assert.equal(parsed.analyzedCount, 3)
  assert.deepEqual(parsed.patterns[0], {
    kind: 'ambiguous-goal',
    count: 2,
    lastExample: 'be specific',
    applied: 0,
    accepted: 0,
    rejected: 0,
    verified: 0,
    unverified: 0,
    resolved: 0,
  })
  assert.deepEqual(parsed.styleRules, [])
  assert.deepEqual(parsed.feedbackLog, [])
  assert.equal(parsed.pendingDistill, 0)
})

test('profile v2 parses counters, style rules, good examples, and the feedback log', () => {
  const parsed = profileSchema.parse({
    analyzedCount: 5,
    patterns: [{ kind: 'k', count: 1, lastExample: '', applied: 2, accepted: 1, rejected: 1, verified: 1, unverified: 0 }],
    updatedAt: 1,
    styleRules: [{ rule: 'Keep the original intent.', createdAt: 2 }],
    feedbackLog: [{ time: 4, verdict: 'down', reason: 'lost intent', patternKinds: ['k'] }],
    pendingDistill: 2,
  })
  assert.equal(parsed.patterns[0].applied, 2)
  assert.equal(parsed.styleRules[0].rule, 'Keep the original intent.')
  assert.equal(parsed.pendingDistill, 2)
  assert.doesNotThrow(() => patternCountersSchema.parse(parsed.patterns[0]))
})

test('turn digests accept endReason and default it for old checkpoints', () => {
  assert.equal(turnSchema.parse({ turn: 1, startedAt: 0, prompt: '', steps: 0, toolCalls: [], toolErrors: 0, retries: 0, compactions: 0, feedback: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, finalText: '', model: '', provider: '', finished: true, endedAt: 1 }).endReason, '')
  const withReason = turnSchema.parse({ turn: 1, startedAt: 0, prompt: '', steps: 0, toolCalls: [], toolErrors: 0, retries: 0, compactions: 0, feedback: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, finalText: '', model: '', provider: '', finished: true, endedAt: 1, endReason: 'rejected' })
  assert.equal(withReason.endReason, 'rejected')
})

test('feedback/applied arg schemas validate the loop payloads', () => {
  assert.deepEqual(feedbackArgSchema.parse({ rewriteId: 'rw-1', verdict: 'up' }), { rewriteId: 'rw-1', verdict: 'up' })
  assert.deepEqual(feedbackArgSchema.parse({ rewriteId: 'rw-1', verdict: 'down', reason: 'lost intent' }), { rewriteId: 'rw-1', verdict: 'down', reason: 'lost intent' })
  assert.equal(feedbackArgSchema.safeParse({ rewriteId: 'rw-1', verdict: 'maybe' }).success, false)
  assert.equal(feedbackArgSchema.safeParse({ verdict: 'up' }).success, false)
  // Long reasons pass the wire schema — the SERVICE clips them to 300.
  assert.equal(feedbackArgSchema.safeParse({ rewriteId: 'rw-1', verdict: 'down', reason: 'x'.repeat(400) }).success, true)
  assert.deepEqual(appliedArgSchema.parse({ sessionId: 's1', rewriteId: 'rw-1' }), { sessionId: 's1', rewriteId: 'rw-1' })
  assert.equal(appliedArgSchema.safeParse({ rewriteId: 'rw-1' }).success, false)
})

test('a directive may carry the workspace it is scoped to, and a report the conversation\'s cwd', () => {
  const profile = profileSchema.parse({
    analyzedCount: 0, patterns: [], updatedAt: 1, styleRules: [], feedbackLog: [], pendingDistill: 0, analysesSinceDirectives: 0,
    directives: [
      { id: 'a', text: 'Scoped.', createdAt: 1, workspace: '/repos/alpha' },
      { id: 'g', text: 'Global.', createdAt: 2 },
    ],
  })
  assert.equal(profile.directives[0].workspace, '/repos/alpha')
  assert.equal(profile.directives[1].workspace, undefined)
  const report = reportSchema.parse({ ok: true, turn: 1, time: 1, model: 'm', problems: [], improvedPrompt: 'p', explanation: 'e', cwd: '/repos/alpha' })
  assert.equal(report.cwd, '/repos/alpha')
})

test('a trial written before corrections were graded parses: baselineRate becomes the messy baseline, the correction baseline is unknown', () => {
  const profile = profileSchema.parse({
    analyzedCount: 0, patterns: [], updatedAt: 1, styleRules: [], feedbackLog: [], pendingDistill: 0, analysesSinceDirectives: 0,
    directives: [{ id: 'c', text: 'Old candidate.', createdAt: 1, status: 'candidate', trial: { turns: 3, messy: 1, baselineRate: 0.2, startedAt: 1 } }],
  })
  assert.deepEqual(profile.directives[0].trial, { turns: 3, messy: 1, corrected: 0, baselineMessyRate: 0.2, baselineCorrectionRate: -1, startedAt: 1 })
})

test('a legacy directive (no provenance fields) migrates: updatedAt = createdAt, version 1, empty evidence, no run, never evaluated or approved', () => {
  const profile = profileSchema.parse({
    analyzedCount: 0, patterns: [], updatedAt: 1,
    directives: [{ id: 'a', text: 'Old.', enabled: true, source: 'distilled', createdAt: 7, status: 'active' }],
  })
  assert.deepEqual(profile.directives[0], {
    id: 'a', text: 'Old.', enabled: true, source: 'distilled', createdAt: 7, status: 'active',
    updatedAt: 7, version: 1, evidence: [], distillationRunId: '', evaluatedAt: 0, approvedAt: 0,
  })
})

test('a directive keeps its provenance fields, and a removed status parses', () => {
  const evidence = [{ sessionId: 's1', turn: 3, trigger: 'correction' }]
  const profile = profileSchema.parse({
    analyzedCount: 0, patterns: [], updatedAt: 1,
    directives: [{ id: 'r', text: 'Gone.', enabled: false, source: 'user', createdAt: 1, updatedAt: 9, version: 3, status: 'removed', evidence, distillationRunId: 'run-1', evaluatedAt: 5, approvedAt: 4 }],
  })
  const [entry] = profile.directives
  assert.equal(entry.status, 'removed')
  assert.deepEqual([entry.updatedAt, entry.version, entry.evidence, entry.distillationRunId, entry.evaluatedAt, entry.approvedAt], [9, 3, evidence, 'run-1', 5, 4])
})

test('a candidate written disabled is read back as queued without its trial', () => {
  const profile = profileSchema.parse({
    analyzedCount: 0, patterns: [], updatedAt: 1,
    directives: [{ id: 'c', text: 'Off while on trial.', enabled: false, createdAt: 1, status: 'candidate', trial: { turns: 3, messy: 1, baselineMessyRate: 0.2, startedAt: 1 } }],
  })
  assert.equal(profile.directives[0].status, 'queued')
  assert.equal(profile.directives[0].trial, undefined)
})

test('reviewCandidates is a patchable config key, off by default', () => {
  assert.equal(Config.parse({}).reviewCandidates, false)
  assert.deepEqual(configArgSchema.parse({ patch: { reviewCandidates: true } }).patch, { reviewCandidates: true })
})

test('route codecs: start-trial, force on analyze and analyze-batch, and the receipt id', () => {
  assert.deepEqual(directivesArgSchema.parse({ action: 'start-trial', id: 'q1' }), { action: 'start-trial', id: 'q1' })
  assert.equal(analyzeArgSchema.parse({ sessionId: 's', turn: 1, force: true }).force, true)
  assert.equal(analyzeArgSchema.parse({ sessionId: 's', turn: 1 }).force, undefined)
  assert.equal(analyzeBatchArgSchema.parse({ sessionId: 's', turns: [1], force: true }).force, true)
  assert.deepEqual(directiveReceiptArgSchema.parse({ id: 'd1' }), { id: 'd1' })
  assert.equal(directiveReceiptArgSchema.safeParse({}).success, false)
})

// ── Usage ledger schemas ────────────────────────────────────────────────────

test('configPatchSchema keeps the three cost keys', () => {
  const parsed = configArgSchema.parse({ patch: { costHistoryDays: 90, costWarnDailyUsd: 5, costWarnMonthlyUsd: 50 } })
  assert.deepEqual(parsed.patch, { costHistoryDays: 90, costWarnDailyUsd: 5, costWarnMonthlyUsd: 50 })
  // Still an allowlist: a key not in configPatchSchema is silently stripped, never persisted.
  const withUnknown = configArgSchema.parse({ patch: { costHistoryDays: 10, notAKey: 1 } })
  assert.deepEqual(withUnknown.patch, { costHistoryDays: 10 })
})

test('tokenBucketsSchema parses an empty object into five zero counters', () => {
  assert.deepEqual(tokenBucketsSchema.parse({}), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  })
})

test('usageAttemptSchema fills defaults around the identity fields', () => {
  const parsed = usageAttemptSchema.parse({ id: 'u1:0', op: 'analysis', startedAt: 100, status: 'ok' })
  assert.equal(parsed.id, 'u1:0')
  assert.equal(parsed.op, 'analysis')
  assert.equal(parsed.startedAt, 100)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.durationMs, 0)
  assert.equal(parsed.model, '')
  assert.equal(parsed.provider, '')
  assert.equal(parsed.reasoningEffort, null)
  assert.equal(parsed.finish, '')
  assert.equal(parsed.code, '')
  assert.equal(parsed.sessionId, '')
  assert.equal(parsed.turn, null)
  assert.equal(parsed.usage, null)
  assert.equal(parsed.priced, null)
  assert.deepEqual(USAGE_OPS, [
    'analysis',
    'analysis-repair',
    'directive-distillation',
    'style-distillation',
    'improve',
    'improve-repair',
    'enrichment',
  ])
  // The sink record fields Task 1 hands over, plus the identity fields the tracker adds.
  const full = usageAttemptSchema.parse({
    id: 'u1:0',
    op: 'analysis',
    sessionId: 's1',
    turn: 3,
    startedAt: 100,
    durationMs: 50,
    model: 'deepseek-v4-flash',
    provider: 'deepseek-official',
    reasoningEffort: 'low',
    finish: 'stop',
    status: 'ok',
    code: '',
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
    priced: { source: 'bundled', tier: 'offPeak', rates: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 }, asOf: '2026-08-22', usd: 0.0001 },
  })
  assert.equal(full.priced.source, 'bundled')
  assert.equal(full.usage.inputTokens, 10)
  assert.equal(usageAttemptSchema.safeParse({ id: 'u', op: 'not-an-op', startedAt: 1, status: 'ok' }).success, false)
})

test('usageTotalsSchema defaults every counter to zero', () => {
  assert.deepEqual(usageTotalsSchema.parse({}), {
    attempts: 0,
    billedCalls: 0,
    failedCalls: 0,
    unmeteredCalls: 0,
    unpricedCalls: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
    usdKnown: 0,
    failedUsd: 0,
  })
})

test('usageRunSchema fills defaults and starts running', () => {
  const parsed = usageRunSchema.parse({ runId: 'u1', type: 'analysis', startedAt: 100 })
  assert.equal(parsed.status, 'running')
  assert.equal(parsed.endedAt, 0)
  assert.equal(parsed.trigger, '')
  assert.deepEqual(parsed.results, {})
  assert.deepEqual(parsed.attempts, [])
  assert.deepEqual(parsed.totals, usageTotalsSchema.parse({}))
  assert.deepEqual(USAGE_RUN_TYPES, [
    'bootstrap',
    'analysis',
    'analysis-batch',
    'improve',
    'directive-distillation',
    'style-distillation',
    'prompt-enrichment',
  ])
  assert.equal(usageRunSchema.safeParse({ runId: 'u1', type: 'not-a-type', startedAt: 1 }).success, false)
})

test('usageDayFileSchema parses a minimal day file', () => {
  const parsed = usageDayFileSchema.parse({ version: 1, day: '2026-08-30' })
  assert.deepEqual(parsed.runs, [])
  assert.equal(usageDayFileSchema.safeParse({ version: 2, day: '2026-08-30' }).success, false)
})

test('usageSummarySchema parses an old summary without byModel', () => {
  const parsed = usageSummarySchema.parse({ version: 1, trackingSince: 5 })
  assert.deepEqual(parsed.byModel, {})
  assert.deepEqual(parsed.byType, {})
  assert.deepEqual(parsed.days, {})
  assert.deepEqual(parsed.lifetime, usageTotalsSchema.parse({}))

  const withDay = usageSummarySchema.parse({
    version: 1,
    trackingSince: 5,
    days: { '2026-08-30': { attempts: 2, usdKnown: 0.01 } },
  })
  assert.equal(withDay.days['2026-08-30'].attempts, 2)
  assert.deepEqual(withDay.days['2026-08-30'].byType, {})
})

test('usageSummarySchema parses an old summary without the failed counters or the provider/trigger buckets', () => {
  const parsed = usageSummarySchema.parse({
    version: 1,
    trackingSince: 5,
    lifetime: { attempts: 3, billedCalls: 3, usdKnown: 0.9 },
    byType: { analysis: { attempts: 3, usdKnown: 0.9 } },
    days: { '2026-08-30': { attempts: 3, usdKnown: 0.9, byType: { analysis: { attempts: 3 } } } },
  })
  assert.deepEqual(parsed.byProvider, {})
  assert.deepEqual(parsed.byTrigger, {})
  assert.equal(parsed.lifetime.failedCalls, 0)
  assert.equal(parsed.lifetime.failedUsd, 0)
  assert.equal(parsed.byType.analysis.failedCalls, 0)
  assert.equal(parsed.byType.analysis.failedUsd, 0)
  assert.equal(parsed.days['2026-08-30'].failedCalls, 0)
  assert.equal(parsed.days['2026-08-30'].failedUsd, 0)
  assert.equal(parsed.days['2026-08-30'].byType.analysis.failedCalls, 0)
})

test('the directives route accepts a rescope action, and the profile records when each scope was last seen', () => {
  assert.deepEqual(directivesArgSchema.parse({ action: 'rescope', id: 'a', workspace: '/repos/beta' }), { action: 'rescope', id: 'a', workspace: '/repos/beta' })
  assert.deepEqual(directivesArgSchema.parse({ action: 'rescope', id: 'a', workspace: '' }), { action: 'rescope', id: 'a', workspace: '' })
  assert.equal(directivesArgSchema.safeParse({ action: 'rescope', id: 'a' }).success, false)
  const profile = profileSchema.parse({ analyzedCount: 0, patterns: [], updatedAt: 0, workspaceSeenAt: { '/repos/alpha': 5 } })
  assert.deepEqual(profile.workspaceSeenAt, { '/repos/alpha': 5 })
  assert.deepEqual(profileSchema.parse({ analyzedCount: 0, patterns: [], updatedAt: 0 }).workspaceSeenAt, {})
})
