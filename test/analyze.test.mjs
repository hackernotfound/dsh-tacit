// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateProfile,
  buildAnalysisUserText,
  buildImproveUserText,
  digestTurn,
  normalizeImprove,
  normalizeReport,
  parseJsonObject,
} from '../lib/analyze.js'
import { reportSchema, profileSchema } from '../lib/schema.js'

const sampleTurn = {
  turn: 3,
  startedAt: 1000,
  prompt: 'make it work',
  steps: 4,
  toolCalls: [
    { name: 'bash', args: '{"command":"ls"}' },
    { name: 'read', args: '{"file_path":"x"}' },
  ],
  toolErrors: 1,
  retries: 2,
  compactions: 1,
  feedback: 0,
  usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 400, cacheWriteTokens: 0, reasoningTokens: 150 },
  finalText: 'all done',
  model: 'deepseek-v4-flash',
  provider: 'deepseek',
  finished: true,
  endedAt: 5000,
}

test('parseJsonObject handles plain, fenced, and surrounded JSON', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonObject('Sure! Here you go:\n{"a":1}\nHope it helps.'), { a: 1 })
})

test('parseJsonObject rejects non-JSON and non-objects', () => {
  assert.equal(parseJsonObject('no json here'), null)
  assert.equal(parseJsonObject(''), null)
  assert.equal(parseJsonObject('[1,2]'), null)
  assert.equal(parseJsonObject(null), null)
})

test('normalizeReport shapes a valid parsed object and validates against reportSchema', () => {
  const parsed = {
    problems: [
      { kind: 'ambiguous-goal', severity: 'high', what: 'no acceptance criteria', why: 'agent tried 4 approaches' },
      { kind: 'missing-context', severity: 'medium', what: 'no file paths given', why: 'agent searched the whole repo' },
    ],
    improvedPrompt: 'Add acceptance criteria and file paths.',
    explanation: 'The prompt left scope open.',
  }
  const report = normalizeReport(parsed, { turn: 3, time: 42, model: 'deepseek-v4-flash', rawText: '' })
  assert.equal(report.ok, true)
  assert.equal(report.problems.length, 2)
  assert.equal(report.problems[0].kind, 'ambiguous-goal')
  assert.equal(report.problems[0].severity, 'high')
  assert.doesNotThrow(() => reportSchema.parse(report))
})

test('normalizeReport falls back to a notes problem on unparseable model output', () => {
  const report = normalizeReport(null, { turn: 3, time: 42, model: 'deepseek-v4-flash', rawText: 'sorry I cannot do this' })
  assert.equal(report.ok, true)
  assert.equal(report.problems.length, 1)
  assert.equal(report.problems[0].kind, 'notes')
  assert.equal(report.improvedPrompt, '')
  assert.doesNotThrow(() => reportSchema.parse(report))
})

test('aggregateProfile merges counts, sorts by count, caps patterns, and counts analyses', () => {
  const first = aggregateProfile({ analyzedCount: 0, patterns: [], updatedAt: 0 }, {
    problems: [
      { kind: 'ambiguous-goal', severity: 'high', what: 'first example', why: '' },
      { kind: 'missing-context', severity: 'low', what: 'context example', why: '' },
    ],
  }, 12)
  assert.equal(first.analyzedCount, 1)
  assert.equal(first.patterns.length, 2)

  const second = aggregateProfile(first, {
    problems: [
      { kind: 'AMBIGUOUS GOAL', severity: 'high', what: 'second example', why: '' },
    ],
  }, 1)
  assert.equal(second.analyzedCount, 2)
  assert.equal(second.patterns.length, 1)
  assert.equal(second.patterns[0].kind, 'ambiguous-goal')
  assert.equal(second.patterns[0].count, 2)
  assert.equal(second.patterns[0].lastExample, 'second example')
  assert.doesNotThrow(() => profileSchema.parse(second))
})

test('aggregateProfile counts only NEW analyses toward analyzedCount', () => {
  const report = { problems: [{ kind: 'k', severity: 'low', what: 'w', why: '' }] }
  const first = aggregateProfile({ analyzedCount: 0, patterns: [], updatedAt: 0 }, report, 12)
  assert.equal(first.analyzedCount, 1)

  // Re-coaching the same prompt: patterns still merge, the gate stays put.
  const second = aggregateProfile(first, { problems: [{ kind: 'k', severity: 'low', what: 'w2', why: '' }] }, 12, { countNew: false })
  assert.equal(second.analyzedCount, 1)
  assert.equal(second.patterns[0].count, 2)
  assert.equal(second.patterns[0].lastExample, 'w2')
})

test('digestTurn and buildAnalysisUserText include the trajectory facts', () => {
  const digest = digestTurn(sampleTurn)
  assert.equal(digest.turn, 3)
  assert.equal(digest.toolCalls.length, 2)
  assert.equal(digest.usage.inputTokens, 1200)

  const text = buildAnalysisUserText(sampleTurn)
  assert.ok(text.includes('make it work'))
  assert.ok(text.includes('bash'))
  assert.ok(text.includes('retries: 2'))
  assert.ok(text.includes('all done'))
  assert.equal(buildAnalysisUserText(null), null)
})

test('buildImproveUserText includes learned patterns only when provided', () => {
  const withProfile = buildImproveUserText({
    draft: 'fix it',
    profile: { patterns: [{ kind: 'ambiguous-goal', count: 3, lastExample: 'be specific' }] },
    recentContext: '',
  })
  assert.ok(withProfile.includes('ambiguous-goal'))
  assert.ok(withProfile.includes('fix it'))

  const withoutProfile = buildImproveUserText({ draft: 'fix it', profile: { patterns: [] }, recentContext: 'prompt: hi' })
  assert.ok(withoutProfile.includes('RECENT CONVERSATION CONTEXT'))
  assert.ok(!withoutProfile.includes('RECURRING MISTAKE PATTERNS'))
})

test('buildImproveUserText adds the STYLE RULES block when rules exist', () => {
  const text = buildImproveUserText({
    draft: 'fix it',
    profile: { patterns: [] },
    recentContext: '',
    styleRules: [{ rule: 'Keep the original intent.', createdAt: 1 }],
  })
  assert.ok(text.includes('STYLE RULES'))
  assert.ok(text.includes('Keep the original intent.'))
  assert.ok(text.indexOf('STYLE RULES') < text.indexOf('DRAFT TO IMPROVE'))

  const withoutRules = buildImproveUserText({ draft: 'fix it', profile: { patterns: [] }, recentContext: '' })
  assert.ok(!withoutRules.includes('STYLE RULES'))
})

test('buildImproveUserText carries down-reasons verbatim with the rejection phrasing', () => {
  const text = buildImproveUserText({
    draft: 'fix it',
    profile: { patterns: [] },
    recentContext: '',
    negativeFeedback: ['it dropped my acceptance criteria'],
  })
  assert.ok(text.includes('your last suggestion was rejected because: it dropped my acceptance criteria'))
  assert.ok(text.includes('NEGATIVE FEEDBACK'))

  const two = buildImproveUserText({
    draft: 'fix it',
    profile: { patterns: [] },
    recentContext: '',
    negativeFeedback: ['first rejected', 'second rejected'],
  })
  assert.ok(two.includes('your last suggestion was rejected because: first rejected'))
  assert.ok(two.includes('an earlier suggestion was rejected because: second rejected'))
})

test('aggregateProfile preserves the v2 loop fields across re-analyses', () => {
  const prev = {
    analyzedCount: 4,
    patterns: [{ kind: 'ambiguous-goal', count: 2, lastExample: 'old', applied: 1, accepted: 1, rejected: 0, verified: 1, unverified: 0 }],
    updatedAt: 1,
    styleRules: [{ rule: 'Be specific.', createdAt: 2 }],
    feedbackLog: [{ time: 4, verdict: 'down', reason: 'vague', patternKinds: ['ambiguous-goal'] }],
    pendingDistill: 2,
  }
  const next = aggregateProfile(prev, {
    problems: [{ kind: 'ambiguous-goal', severity: 'high', what: 'newer example', why: '' }],
  }, 12)
  assert.equal(next.analyzedCount, 5)
  assert.equal(next.patterns[0].count, 3)
  assert.equal(next.patterns[0].lastExample, 'newer example')
  // v2 counters and loop fields survive the merge untouched.
  assert.equal(next.patterns[0].applied, 1)
  assert.equal(next.patterns[0].accepted, 1)
  assert.equal(next.patterns[0].verified, 1)
  assert.deepEqual(next.styleRules, prev.styleRules)
  assert.deepEqual(next.feedbackLog, prev.feedbackLog)
  assert.equal(next.pendingDistill, 2)
  assert.doesNotThrow(() => profileSchema.parse(next))
})

test('normalizeImprove falls back to the original draft when the model produces nothing', () => {
  const empty = normalizeImprove(null, 'original draft')
  assert.equal(empty.improved, 'original draft')
  assert.equal(empty.rationale, '')

  const blank = normalizeImprove({ improved: '   ' }, 'original draft')
  assert.equal(blank.improved, 'original draft')

  const good = normalizeImprove({ improved: 'better', rationale: 'shorter' }, 'original')
  assert.equal(good.improved, 'better')
  assert.equal(good.rationale, 'shorter')
})

// ── Zero-click learning: trigger heuristics ────────────────────────────────

import { isMessyTurn, looksLikeCorrection } from '../lib/analyze.js'

test('isMessyTurn flags retries, tool errors, compactions, rejection, and long step counts', () => {
  const clean = { ...sampleTurn, retries: 0, toolErrors: 0, compactions: 0, steps: 3, endReason: 'success', finished: true }
  assert.equal(isMessyTurn(clean, { minSteps: 15 }), false)
  assert.equal(isMessyTurn({ ...clean, retries: 1 }, { minSteps: 15 }), true)
  assert.equal(isMessyTurn({ ...clean, toolErrors: 2 }, { minSteps: 15 }), true)
  assert.equal(isMessyTurn({ ...clean, compactions: 1 }, { minSteps: 15 }), true)
  assert.equal(isMessyTurn({ ...clean, endReason: 'rejected' }, { minSteps: 15 }), true)
  assert.equal(isMessyTurn({ ...clean, steps: 15 }, { minSteps: 15 }), true)
  assert.equal(isMessyTurn({ ...clean, finished: false, retries: 3 }, { minSteps: 15 }), false, 'unfinished turns are never messy yet')
})

test('looksLikeCorrection recognizes short follow-ups that correct the agent', () => {
  assert.equal(looksLikeCorrection('no, I meant the other file'), true)
  assert.equal(looksLikeCorrection("that's not what I asked"), true)
  assert.equal(looksLikeCorrection('what are you doing why is it stuck'), true)
  assert.equal(looksLikeCorrection('why did you delete the tests?'), true)
  assert.equal(looksLikeCorrection('不对，我是说另一个文件'), true)
  assert.equal(looksLikeCorrection('Now add a dark mode toggle to the settings page.'), false)
  assert.equal(looksLikeCorrection('thanks, looks good'), false)
  assert.equal(looksLikeCorrection('no'.padEnd(400, ' more text')), false, 'long messages are new tasks, not corrections')
})

test('buildAnalysisUserText carries the user\'s next message as correction evidence', () => {
  const text = buildAnalysisUserText(sampleTurn, { followUp: 'no I meant src/app.js' })
  assert.ok(text.includes("=== USER'S NEXT MESSAGE"))
  assert.ok(text.includes('no I meant src/app.js'))
  assert.ok(!buildAnalysisUserText(sampleTurn).includes("=== USER'S NEXT MESSAGE"))
})

// ── Ambient steering: directives → system-prompt section ───────────────────

import { renderSteeringSection, buildDirectiveUserText, STEERING_MAX_CHARS } from '../lib/analyze.js'

test('renderSteeringSection is empty without enabled directives and lists enabled ones', () => {
  assert.equal(renderSteeringSection({ directives: [] }), '')
  assert.equal(renderSteeringSection({ directives: [{ id: 'd1', text: 'Off.', enabled: false, source: 'distilled', createdAt: 1 }] }), '')
  const text = renderSteeringSection({
    directives: [
      { id: 'd1', text: 'They often omit file paths: grep the repo before asking.', enabled: true, source: 'distilled', createdAt: 1 },
      { id: 'd2', text: 'Hidden one.', enabled: false, source: 'distilled', createdAt: 2 },
      { id: 'd3', text: '"What do you think" means opinion only — do not build.', enabled: true, source: 'user', createdAt: 3 },
    ],
  })
  assert.ok(text.includes('grep the repo before asking'))
  assert.ok(text.includes('opinion only'))
  assert.ok(!text.includes('Hidden one.'))
  assert.ok(text.startsWith('## '), 'renders as a titled prompt section')
})

test('renderSteeringSection stays within the token-cheap character budget', () => {
  const directives = Array.from({ length: 20 }, (_, i) => ({ id: 'd' + i, text: 'Directive number ' + i + ' ' + 'x'.repeat(200), enabled: true, source: 'distilled', createdAt: i }))
  assert.ok(renderSteeringSection({ directives }).length <= STEERING_MAX_CHARS)
})

test('classifyDirectives parses the tool payload into clipped, deduped imperatives', () => {
  const parsed = classifyDirectives(JSON.stringify({ directives: ['Grep before asking.', ' grep before asking. ', '', 42, 'Second rule.'] })).kept
  assert.deepEqual(parsed, ['Grep before asking.', 'Second rule.'])
  assert.deepEqual(classifyDirectives('nonsense').kept, [])
})

test('buildDirectiveUserText feeds patterns, examples, style rules and recent corrections to the distiller', () => {
  const text = buildDirectiveUserText({
    patterns: [{ kind: 'missing-context', count: 3, lastExample: 'no file paths given' }],
    styleRules: [{ rule: 'Keep paths verbatim.', createdAt: 1 }],
    directives: [{ id: 'd1', text: 'Existing directive.', enabled: true, source: 'distilled', createdAt: 1 }],
  }, [{ promptExcerpt: 'fix it', followUp: 'no I meant the tests' }])
  assert.ok(text.includes('missing-context'))
  assert.ok(text.includes('no file paths given'))
  assert.ok(text.includes('Keep paths verbatim.'))
  assert.ok(text.includes('Existing directive.'))
  assert.ok(text.includes('no I meant the tests'))
})

test('aggregateProfile carries the directives and the distillation counter across analyses', () => {
  const prev = {
    analyzedCount: 1,
    patterns: [],
    updatedAt: 1,
    directives: [{ id: 'u1', text: 'My own rule.', enabled: true, source: 'user', createdAt: 1 }],
    analysesSinceDirectives: 2,
  }
  const next = aggregateProfile(prev, { problems: [] }, 12)
  assert.equal(next.directives.length, 1)
  assert.equal(next.directives[0].text, 'My own rule.')
  assert.equal(next.analysesSinceDirectives, 2)
})

// ── Measured trend (replaces the guessed savings %) ────────────────────────

import { computeTrend } from '../lib/analyze.js'

test('computeTrend compares messy-turn rate and tokens/turn between the first and the latest window', () => {
  const mk = (i, messy, tokens) => ({ ...sampleTurn, turn: i, endedAt: i * 1000, finished: true, retries: messy ? 1 : 0, toolErrors: 0, compactions: 0, steps: 2, endReason: 'success', usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } })
  const turns = [
    ...Array.from({ length: 10 }, (_, i) => mk(i + 1, i % 2 === 0, 1000)), // 50% messy, 1000 tok
    ...Array.from({ length: 10 }, (_, i) => mk(i + 11, i === 0, 600)), // 10% messy, 600 tok
  ]
  const trend = computeTrend(turns, { window: 10 })
  assert.equal(trend.early.n, 10)
  assert.equal(trend.recent.n, 10)
  assert.equal(trend.early.messyRate, 0.5)
  assert.equal(trend.recent.messyRate, 0.1)
  assert.equal(trend.early.tokensPerTurn, 1000)
  assert.equal(trend.recent.tokensPerTurn, 600)
  assert.equal(trend.enough, true)
})

test('computeTrend reports not-enough data below two windows and never divides by zero', () => {
  const trend = computeTrend([], { window: 20 })
  assert.equal(trend.enough, false)
  assert.equal(trend.recent.n, 0)
  assert.equal(trend.recent.messyRate, 0)
})

// ── Context-aware analysis / directive hygiene ─────────────────────────────

import { looksLikeContinuation, classifyDirectives, clipDirective } from '../lib/analyze.js'

test('looksLikeContinuation recognizes bare continuations in en/zh and rejects real prompts', () => {
  for (const text of ['continue', 'Continue.', 'go ahead', 'yes do it', 'ok', 'proceed', 'next', '继续', '好的', 'go ahead make the plan']) {
    assert.equal(looksLikeContinuation(text), true, text)
  }
  for (const text of ['continue but skip the tests and only touch lib/', 'make the login page better', 'no I meant the other file', '']) {
    assert.equal(looksLikeContinuation(text), false, text)
  }
})

test('buildAnalysisUserText carries the previous turn as context and flags continuations', () => {
  const previous = { ...sampleTurn, turn: 2, prompt: 'Build the fold projection first.', finalText: 'Fold done, tests green.' }
  const text = buildAnalysisUserText({ ...sampleTurn, prompt: 'continue' }, { previous })
  assert.ok(text.includes('=== PREVIOUS TURN'))
  assert.ok(text.includes('Build the fold projection first.'))
  assert.ok(text.includes('Fold done, tests green.'))
  assert.ok(text.includes('continuation of the previous turn'))
  const plain = buildAnalysisUserText(sampleTurn, { previous })
  assert.ok(!plain.includes('continuation of the previous turn'))
  assert.ok(!buildAnalysisUserText(sampleTurn).includes('=== PREVIOUS TURN'))
})

test('classifyDirectives rejects directives that make the agent ask the user', () => {
  const { kept, rejected } = classifyDirectives(JSON.stringify({ directives: [
    'When the user writes "continue", stop and ask what task was in progress.',
    'Confirm with the user before touching migrations.',
    'When the user names a feature but no files, grep the repo for it first.',
    'Assume the Next.js app under apps/web unless told otherwise.',
  ] }))
  assert.deepEqual(kept, [
    'When the user names a feature but no files, grep the repo for it first.',
    'Assume the Next.js app under apps/web unless told otherwise.',
  ])
  assert.equal(rejected.length, 2)
  assert.deepEqual(classifyDirectives(JSON.stringify({ directives: ['Get approval from the user first.'] })).kept, [])
})

test('renderSteeringSection renders candidates and active directives but never retired ones', () => {
  const text = renderSteeringSection({ directives: [
    { id: 'a', text: 'Active one.', enabled: true, source: 'distilled', createdAt: 1, status: 'active' },
    { id: 'c', text: 'Candidate one.', enabled: true, source: 'distilled', createdAt: 2, status: 'candidate' },
    { id: 'r', text: 'Retired one.', enabled: true, source: 'distilled', createdAt: 3, status: 'retired' },
  ] })
  assert.ok(text.includes('Active one.'))
  assert.ok(text.includes('Candidate one.'))
  assert.ok(!text.includes('Retired one.'))
})

test('clipDirective never cuts mid-word: sentence end first, then word boundary with an ellipsis', () => {
  const short = 'When the user names a feature but no files, grep the repo for it before asking.'
  assert.equal(clipDirective(short), short)
  const twoSentences = 'When the user asks to review or check something without naming files, inspect the loaded modules first. Then state the assumption you made and continue without asking for confirmation unless the target is genuinely undiscoverable from the repository.'
  assert.equal(clipDirective(twoSentences), 'When the user asks to review or check something without naming files, inspect the loaded modules first.')
  const oneLongSentence = 'When the user continues from a prior turn that ended on a required step such as restarting the server or refreshing the page, assume that step was done and verify the resulting state before proceeding with the next action they asked for.'
  const clipped = clipDirective(oneLongSentence)
  assert.ok(clipped.length <= 220)
  assert.ok(clipped.endsWith('…'))
  assert.ok(oneLongSentence.startsWith(clipped.slice(0, -1)))
  assert.ok(oneLongSentence[clipped.length - 1] === ' ', 'cut lands on a word boundary')
  // Chinese full stop counts as a sentence end.
  const zh = '用户提到某个功能但没有给出任何文件路径时，先在整个仓库里搜索相关的模块、组件和测试再动手，不要先问用户文件在哪里，也不要假设它在最显眼的目录里，而是根据搜索结果判断最可能的位置。' + '然后把你做的假设说清楚并继续，除非目标确实无法从仓库、对话或用户习惯中找到，否则不要停下来问用户确认，也不要要求用户重复已经说过的内容，直接按最可能的理解执行下去并在结尾简短说明你选择了哪个位置以及原因，方便用户在需要时纠正，同时保留原有的文件路径、命名和范围不要擅自改动。'
  assert.equal(clipDirective(zh), '用户提到某个功能但没有给出任何文件路径时，先在整个仓库里搜索相关的模块、组件和测试再动手，不要先问用户文件在哪里，也不要假设它在最显眼的目录里，而是根据搜索结果判断最可能的位置。')
})

test('classifyDirectives stores a long model directive clipped at its sentence boundary', () => {
  const long = 'When the user asks broadly to review, check, or see what is missing without naming files, inspect every loaded module first. Then state the assumptions you made and continue without asking, unless the target is genuinely undiscoverable from the repository.'
  const { kept } = classifyDirectives(JSON.stringify({ directives: [long] }))
  assert.equal(kept.length, 1)
  assert.equal(kept[0], 'When the user asks broadly to review, check, or see what is missing without naming files, inspect every loaded module first.')
})
