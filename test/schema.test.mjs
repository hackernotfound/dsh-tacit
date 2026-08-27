import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Config,
  profileSchema,
  patternCountersSchema,
  turnSchema,
  feedbackArgSchema,
  appliedArgSchema,
  improvePayloadSchema,
} from '../lib/schema.js'

// Regression: the loader passes `undefined` when the patch row has no
// `config:` block — Config must resolve to all defaults, not throw.
test('Config.parse(undefined) resolves to all defaults', () => {
  const parsed = Config.parse(undefined)
  assert.deepEqual(parsed, {
    model: 'deepseek-v4-flash',
    learningThreshold: 20,
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
  })
})

test('Config.parse keeps overrides and fills the rest with defaults', () => {
  const parsed = Config.parse({ learningThreshold: 1 })
  assert.equal(parsed.learningThreshold, 1)
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
  })
  assert.deepEqual(parsed.styleRules, [])
  assert.deepEqual(parsed.goodExamples, [])
  assert.deepEqual(parsed.feedbackLog, [])
  assert.equal(parsed.pendingDistill, 0)
})

test('profile v2 parses counters, style rules, good examples, and the feedback log', () => {
  const parsed = profileSchema.parse({
    analyzedCount: 5,
    patterns: [{ kind: 'k', count: 1, lastExample: '', applied: 2, accepted: 1, rejected: 1, verified: 1, unverified: 0 }],
    updatedAt: 1,
    styleRules: [{ rule: 'Keep the original intent.', createdAt: 2 }],
    goodExamples: [{ prompt: 'p', improved: 'i', acceptedAt: 3 }],
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

test('improve payloads accept rewriteId and patternsUsed (defaulted for old clients)', () => {
  const minimal = improvePayloadSchema.parse({ ok: true, improved: 'x', rationale: '', savingsEstimate: 0, code: '', detail: '' })
  assert.equal(minimal.rewriteId, '')
  assert.deepEqual(minimal.patternsUsed, [])
  const full = improvePayloadSchema.parse({ ok: true, improved: 'x', rationale: '', savingsEstimate: 0, rewriteId: 'rw-1', patternsUsed: ['k'], code: '', detail: '' })
  assert.equal(full.rewriteId, 'rw-1')
})
