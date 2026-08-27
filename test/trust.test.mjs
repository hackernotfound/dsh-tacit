/**
 * Trust & selection unit tests for the v2 self-improving loop: the pure
 * trust score, trusted-pattern selection for the improve prompt, verbatim
 * down-reason extraction, and the distillation prompt/normalizer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  trustScore,
  improvePatterns,
  lastDownReasons,
  buildDistillUserText,
  normalizeDistillRules,
  TRUST_MIN_APPLIED,
} from '../lib/analyze.js'

const pattern = (kind, counters) => ({
  kind,
  count: counters.count ?? 0,
  lastExample: '',
  applied: counters.applied ?? 0,
  accepted: counters.accepted ?? 0,
  rejected: counters.rejected ?? 0,
  verified: counters.verified ?? 0,
  unverified: counters.unverified ?? 0,
})

test('trustScore: acceptance and verification raise trust, rejection lowers it', () => {
  // (accepted + 2·verified) − (rejected + unverified) over (applied + 1)
  assert.equal(trustScore(pattern('good', { applied: 1, accepted: 1 })), 0.5)
  assert.equal(trustScore(pattern('great', { applied: 3, accepted: 3, verified: 2 })), 7 / 4)
  assert.equal(trustScore(pattern('bad', { applied: 3, rejected: 3, unverified: 1 })), -4 / 4)
  // 2·verified weighting: two verifications outrank two acceptances.
  assert.ok(trustScore(pattern('v', { applied: 2, verified: 2 })) > trustScore(pattern('a', { applied: 2, accepted: 2 })))
})

test('trustScore: unknown counters and empty patterns are neutral (0)', () => {
  assert.equal(trustScore(null), 0)
  assert.equal(trustScore({ kind: 'x' }), 0)
  assert.equal(trustScore(pattern('fresh', {})), 0)
})

test('improvePatterns: experienced patterns with non-positive trust are dropped', () => {
  const profile = {
    patterns: [
      pattern('failed-advice', { count: 5, applied: 2, rejected: 2 }),
      pattern('untested-rookie', { count: 4 }),
      pattern('trusted', { count: 3, applied: 3, accepted: 2, verified: 1 }),
    ],
  }
  const selected = improvePatterns(profile, 12)
  const kinds = selected.map((entry) => entry.kind)
  assert.ok(!kinds.includes('failed-advice'), 'the coach stops repeating advice that did not work')
  assert.ok(kinds.includes('trusted'))
  assert.ok(kinds.includes('untested-rookie'), 'patterns with <2 applied samples still rank by count')
})

test('improvePatterns: trusted patterns come first, rookies rank by count, top-k capped', () => {
  const profile = {
    patterns: [
      pattern('rookie-low', { count: 1 }),
      pattern('rookie-high', { count: 9 }),
      pattern('trusted-a', { count: 2, applied: 4, accepted: 4 }),
      pattern('trusted-b', { count: 2, applied: 4, accepted: 2 }),
    ],
  }
  const selected = improvePatterns(profile, 3)
  assert.deepEqual(selected.map((entry) => entry.kind), ['trusted-a', 'trusted-b', 'rookie-high'])
  const capped = improvePatterns(profile, 2)
  assert.equal(capped.length, 2)
})

test('improvePatterns: an experienced pattern needs TRUST_MIN_APPLIED samples before trust gates it', () => {
  assert.equal(TRUST_MIN_APPLIED, 2)
  const profile = {
    patterns: [pattern('barely-tried', { count: 3, applied: 1, rejected: 1 })],
  }
  const selected = improvePatterns(profile, 12)
  assert.deepEqual(selected.map((entry) => entry.kind), ['barely-tried'])
})

test('lastDownReasons returns the last 3 verbatim down-reasons, newest first', () => {
  const profile = {
    feedbackLog: [
      { time: 1, verdict: 'up', reason: '', patternKinds: [] },
      { time: 2, verdict: 'down', reason: 'oldest reason', patternKinds: ['a'] },
      { time: 3, verdict: 'down', reason: '', patternKinds: ['a'] }, // reasonless → skipped
      { time: 4, verdict: 'down', reason: 'middle reason', patternKinds: ['b'] },
      { time: 5, verdict: 'down', reason: 'newest reason', patternKinds: ['c'] },
    ],
  }
  assert.deepEqual(lastDownReasons(profile, 3), ['newest reason', 'middle reason', 'oldest reason'])
  assert.deepEqual(lastDownReasons({ feedbackLog: [] }, 3), [])
  assert.deepEqual(lastDownReasons(null, 3), [])
})

test('lastDownReasons clips each reason to 300 chars', () => {
  const long = 'x'.repeat(500)
  const reasons = lastDownReasons({ feedbackLog: [{ verdict: 'down', reason: long, patternKinds: [] }] }, 3)
  assert.equal(reasons[0].length, 300)
})

test('buildDistillUserText carries verbatim reasons and normalizeDistillRules parses them', () => {
  const text = buildDistillUserText(['too verbose', 'lost my intent'])
  assert.ok(text.includes('too verbose'))
  assert.ok(text.includes('lost my intent'))

  const rules = normalizeDistillRules(JSON.stringify({ rules: ['Keep the original intent.', '  ', 'Be concise.', 'KEEP THE ORIGINAL INTENT.', 'Fourth rule'] }))
  assert.deepEqual(rules, ['Keep the original intent.', 'Be concise.', 'Fourth rule'])
})

test('normalizeDistillRules is a soft no-op on prose, empty, and cap-violating output', () => {
  assert.deepEqual(normalizeDistillRules('sorry, no rules today'), [])
  assert.deepEqual(normalizeDistillRules(null), [])
  assert.deepEqual(normalizeDistillRules(JSON.stringify({ rules: ['a'] })), ['a'])
  assert.equal(normalizeDistillRules(JSON.stringify({ rules: ['one', 'two', 'three', 'four'] })).length, 3)
})
