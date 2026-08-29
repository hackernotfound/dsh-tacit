// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CoachStore, dayKey } from '../lib/store.js'
import { usageDayFileSchema, usageSummarySchema } from '../lib/schema.js'
import { createUsageTracker, totalTokens } from '../lib/usage.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const START = Date.UTC(2026, 8, 2, 12, 0, 0) // Wednesday 2026-09-02 12:00 UTC

/** A pricing double: fixed usd for official routes, `null` (unpriceable) for `'proxy'`. */
function fakePricing(usd = 0.5) {
  return {
    calls: [],
    priceCall(args) {
      this.calls.push(args)
      if (args.provider === 'proxy') return null
      return {
        source: 'bundled',
        tier: 'offPeak',
        rates: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
        asOf: '2026-08-22',
        usd,
      }
    },
  }
}

function setup({ start = START, costHistoryDays = 30, pricing = fakePricing(), flushDelayMs = 60_000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tacit-usage-'))
  const store = new CoachStore(dir)
  const clock = { ms: start }
  const now = () => clock.ms
  const usage = createUsageTracker({ store, config: () => ({ costHistoryDays }), pricing, now, flushDelayMs })
  return { dir, store, clock, now, pricing, usage }
}

/** One `callCoachModel` sink record. */
function record(clock, over = {}) {
  return {
    startedAt: clock.ms,
    durationMs: 120,
    model: 'deepseek-v4-flash',
    provider: 'deepseek-official',
    reasoningEffort: 'low',
    finish: 'stop',
    status: 'ok',
    code: '',
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 4, reasoningTokens: 20 },
    ...over,
  }
}

/** Run `fn` with console.warn captured (the store warns once per corrupt file). */
function captureWarn(fn) {
  const original = console.warn
  const lines = []
  console.warn = (...args) => lines.push(args.join(' '))
  try {
    return { value: fn(), lines }
  } finally {
    console.warn = original
  }
}

// ── one run, one attempt ─────────────────────────────────────────────────

test('a single attempt fills the run totals, the attempt row, and the summary', () => {
  const { usage, store, clock } = setup()
  const runId = usage.beginRun({ type: 'analysis', trigger: 'auto', sessionId: 's1', turn: 4, workspace: 'repo', model: 'deepseek-v4-flash', provider: 'deepseek-official' })
  assert.match(runId, /^u[0-9a-z]+-[0-9a-z]+$/)

  usage.attemptSink(runId, { op: 'analysis', sessionId: 's1', turn: 4 })(record(clock))

  const [run] = usage.liveRuns()
  assert.equal(run.runId, runId)
  assert.equal(run.status, 'running')
  assert.equal(run.attempts.length, 1)
  const attempt = run.attempts[0]
  assert.equal(attempt.id, `${runId}:0`)
  assert.equal(attempt.op, 'analysis')
  assert.equal(attempt.sessionId, 's1')
  assert.equal(attempt.turn, 4)
  assert.equal(attempt.status, 'ok')
  assert.equal(attempt.model, 'deepseek-v4-flash')
  assert.equal(attempt.priced.usd, 0.5)
  assert.deepEqual(attempt.usage, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 4, reasoningTokens: 20 })

  assert.deepEqual(run.totals, {
    attempts: 1,
    billedCalls: 1,
    unmeteredCalls: 0,
    unpricedCalls: 0,
    tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 4, reasoningTokens: 20 },
    usdKnown: 0.5,
  })

  const summary = usage.summary()
  assert.equal(summary.lifetime.attempts, 1)
  assert.equal(summary.lifetime.usdKnown, 0.5)
  assert.equal(summary.byType.analysis.attempts, 1)
  assert.equal(summary.byModel['deepseek-v4-flash'].attempts, 1)
  const day = dayKey(clock.ms)
  assert.equal(summary.days[day].attempts, 1)
  assert.equal(summary.days[day].byType.analysis.attempts, 1)

  assert.deepEqual(usage.runSummary(runId), {
    runId,
    type: 'analysis',
    status: 'running',
    attempts: 1,
    billedCalls: 1,
    unmeteredCalls: 0,
    unpricedCalls: 0,
    tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 4, reasoningTokens: 20 },
    usdKnown: 0.5,
  })
  assert.equal(usage.runSummary('nope'), null)
  assert.equal(store.readUsageDay(day).runs.length, 0, 'nothing is written before endRun/flush')
})

test('the pricing table is asked at the attempt start time, with the attempt model/provider', () => {
  const { usage, clock, pricing } = setup()
  const runId = usage.beginRun({ type: 'improve', model: 'deepseek-v4-flash', provider: 'deepseek-official' })
  usage.attemptSink(runId, { op: 'improve' })(record(clock, { model: 'deepseek-v4-pro', provider: 'deepseek', startedAt: clock.ms - 1000 }))
  assert.equal(pricing.calls.length, 1)
  assert.equal(pricing.calls[0].model, 'deepseek-v4-pro')
  assert.equal(pricing.calls[0].provider, 'deepseek')
  assert.equal(pricing.calls[0].atMs, clock.ms - 1000)
  assert.equal(pricing.calls[0].usage.inputTokens, 100)
})

// ── the reasoning-effort fallback: two attempts in one run ───────────────

test('the reasoning-effort fallback records two attempts in one run', () => {
  const { usage, clock } = setup()
  const runId = usage.beginRun({ type: 'analysis', model: 'deepseek-v4-flash', provider: 'deepseek-official' })
  const sink = usage.attemptSink(runId, { op: 'analysis', sessionId: 's1', turn: 1 })
  sink(record(clock, { status: 'failed', code: 'UNSUPPORTED_REASONING_EFFORT', finish: 'error', usage: null }))
  sink(record(clock, { reasoningEffort: null }))

  const [run] = usage.liveRuns()
  assert.deepEqual(run.attempts.map((a) => a.id), [`${runId}:0`, `${runId}:1`])
  assert.equal(run.totals.attempts, 2)
  assert.equal(run.totals.billedCalls, 1)
  assert.equal(run.totals.unmeteredCalls, 1)
  assert.equal(run.totals.usdKnown, 0.5)
  usage.endRun(runId, {})
  assert.equal(usage.runSummary(runId).status, 'partial')
})

test('a failed attempt that still reported usage is billed', () => {
  const { usage, clock } = setup()
  const runId = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock, { status: 'failed', finish: 'error', code: 'RATE_LIMIT' }))
  const [run] = usage.liveRuns()
  assert.equal(run.totals.billedCalls, 1)
  assert.equal(run.totals.unmeteredCalls, 0)
  assert.equal(run.totals.usdKnown, 0.5)
  assert.equal(run.attempts[0].status, 'failed')
  assert.equal(run.attempts[0].code, 'RATE_LIMIT')
})

test('an unmetered attempt is never billed and never priced', () => {
  const { usage, clock, pricing } = setup()
  const runId = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock, { status: 'unmetered', usage: null }))
  const [run] = usage.liveRuns()
  assert.equal(run.totals.billedCalls, 0)
  assert.equal(run.totals.unmeteredCalls, 1)
  assert.equal(run.totals.unpricedCalls, 0)
  assert.equal(run.totals.usdKnown, 0)
  assert.deepEqual(run.totals.tokens, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })
  assert.equal(run.attempts[0].usage, null)
  assert.equal(run.attempts[0].priced, null)
  assert.equal(pricing.calls.length, 0, 'an unmetered call is never priced')
})

test('a route with no price table counts as unpriced but keeps its tokens', () => {
  const { usage, clock } = setup()
  const runId = usage.beginRun({ type: 'analysis', provider: 'proxy' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock, { provider: 'proxy' }))
  const [run] = usage.liveRuns()
  assert.equal(run.attempts[0].priced, null)
  assert.equal(run.totals.billedCalls, 1)
  assert.equal(run.totals.unpricedCalls, 1)
  assert.equal(run.totals.usdKnown, 0)
  assert.equal(run.totals.tokens.inputTokens, 100)
  assert.equal(usage.summary().lifetime.usdKnown, 0)
})

// ── bootstrap: four interleaved sinks on one run ────────────────────────

test('four interleaved bootstrap sinks land in one run with stable attempt ids', () => {
  const { usage, clock, store } = setup()
  const runId = usage.beginRun({ type: 'bootstrap', trigger: 'bootstrap', workspace: 'repo' })
  const sinks = [0, 1, 2, 3].map((i) => usage.attemptSink(runId, { op: 'analysis', sessionId: `s${i}`, turn: i }))
  // interleaved, in an order no worker controls
  sinks[2](record(clock))
  sinks[0](record(clock))
  sinks[3](record(clock, { status: 'failed', finish: 'error', usage: null }))
  sinks[1](record(clock))

  assert.equal(usage.liveRuns().length, 1)
  const [run] = usage.liveRuns()
  assert.deepEqual(run.attempts.map((a) => a.id), [`${runId}:0`, `${runId}:1`, `${runId}:2`, `${runId}:3`])
  assert.deepEqual(run.attempts.map((a) => a.sessionId), ['s2', 's0', 's3', 's1'])
  assert.equal(run.totals.attempts, 4)
  assert.equal(run.totals.billedCalls, 3)
  assert.equal(run.totals.unmeteredCalls, 1)
  assert.equal(run.totals.usdKnown, 1.5)

  usage.endRun(runId, { results: { analyzed: 3, failed: 1 } })
  const day = dayKey(clock.ms)
  const written = store.readUsageDay(day)
  assert.equal(written.runs.length, 1)
  assert.equal(written.runs[0].attempts.length, 4)
  assert.deepEqual(written.runs[0].results, { analyzed: 3, failed: 1 })
  assert.equal(usage.liveRuns().length, 0, 'a finished run leaves the live map')
})

// ── accumulation across runs, types, models and days ────────────────────

test('lifetime / byType / byModel / days accumulate across runs and days', () => {
  const { usage, clock, store } = setup()
  const first = usage.beginRun({ type: 'analysis', model: 'deepseek-v4-flash' })
  usage.attemptSink(first, { op: 'analysis' })(record(clock))
  usage.endRun(first, {})
  const dayOne = dayKey(clock.ms)

  clock.ms += MS_PER_DAY
  const second = usage.beginRun({ type: 'improve', model: 'deepseek-v4-pro' })
  const sink = usage.attemptSink(second, { op: 'improve' })
  sink(record(clock, { model: 'deepseek-v4-pro' }))
  sink(record(clock, { model: 'deepseek-v4-pro' }))
  usage.endRun(second, {})
  const dayTwo = dayKey(clock.ms)
  usage.flush()

  const summary = usage.summary()
  assert.equal(summary.lifetime.attempts, 3)
  assert.equal(summary.lifetime.billedCalls, 3)
  assert.equal(summary.lifetime.usdKnown, 1.5)
  assert.equal(summary.lifetime.tokens.inputTokens, 300)
  assert.equal(summary.byType.analysis.attempts, 1)
  assert.equal(summary.byType.improve.attempts, 2)
  assert.equal(summary.byModel['deepseek-v4-flash'].attempts, 1)
  assert.equal(summary.byModel['deepseek-v4-pro'].attempts, 2)
  assert.notEqual(dayOne, dayTwo)
  assert.equal(summary.days[dayOne].attempts, 1)
  assert.equal(summary.days[dayOne].byType.analysis.attempts, 1)
  assert.equal(summary.days[dayTwo].attempts, 2)
  assert.equal(summary.days[dayTwo].byType.improve.attempts, 2)

  // each day file holds only its own run, and both survive a schema-validated read
  assert.equal(store.readUsageDay(dayOne).runs.length, 1)
  assert.equal(store.readUsageDay(dayTwo).runs.length, 1)
  assert.deepEqual(store.listUsageDays(), [dayOne, dayTwo].sort())
  const persisted = store.readUsageSummary()
  assert.equal(persisted.lifetime.attempts, 3)
  assert.equal(persisted.days[dayTwo].byType.improve.attempts, 2)
})

test('a written run round-trips through the day-file schema (never dropped as corrupt)', () => {
  const { usage, clock, store, dir } = setup()
  const runId = usage.beginRun({ type: 'bootstrap', trigger: 'startup', sessionId: 's1', turn: 2, workspace: 'repo', model: 'deepseek-v4-flash', provider: 'deepseek-official' })
  usage.attemptSink(runId, { op: 'directive-distillation', sessionId: 's1', turn: 2 })(record(clock))
  usage.endRun(runId, { results: { analyzed: 1 } })
  const day = dayKey(clock.ms)
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'usage', `${day}.json`), 'utf8'))
  const parsed = usageDayFileSchema.safeParse(raw)
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues))
  assert.equal(parsed.data.runs[0].runId, runId)
  usage.flush()
  const summaryRaw = JSON.parse(fs.readFileSync(path.join(dir, 'usage', 'summary.json'), 'utf8'))
  assert.ok(usageSummarySchema.safeParse(summaryRaw).success)
  assert.equal(store.readUsageDay(day).runs[0].attempts[0].op, 'directive-distillation')
})

// ── endRun status derivation ────────────────────────────────────────────

test('endRun derives the run status from its attempts', () => {
  const cases = [
    { name: 'no attempts', statuses: [], expected: 'failed' },
    { name: 'all ok', statuses: ['ok', 'ok'], expected: 'success' },
    { name: 'ok + unmetered', statuses: ['ok', 'unmetered'], expected: 'success' },
    { name: 'some failed', statuses: ['ok', 'failed'], expected: 'partial' },
    { name: 'all failed', statuses: ['failed', 'failed'], expected: 'failed' },
  ]
  for (const testCase of cases) {
    const { usage, clock, store } = setup()
    const runId = usage.beginRun({ type: 'analysis' })
    const sink = usage.attemptSink(runId, { op: 'analysis' })
    for (const status of testCase.statuses) sink(record(clock, { status, usage: status === 'unmetered' ? null : record(clock).usage }))
    clock.ms += 5000
    usage.endRun(runId, {})
    const [run] = store.readUsageDay(dayKey(clock.ms)).runs
    assert.equal(run.status, testCase.expected, testCase.name)
    assert.equal(run.endedAt, clock.ms, testCase.name)
    assert.equal(usage.runSummary(runId).status, testCase.expected, testCase.name)
  }
})

test('endRun honours an explicit status and ignores an unknown run', () => {
  const { usage, clock, store } = setup()
  const runId = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock))
  usage.endRun(runId, { status: 'failed' })
  assert.equal(store.readUsageDay(dayKey(clock.ms)).runs[0].status, 'failed')
  assert.doesNotThrow(() => usage.endRun('missing', {}))
  assert.doesNotThrow(() => usage.endRun(runId, {}), 'a second endRun is a no-op')
})

test('non-numeric results entries are dropped (the schema only allows numbers)', () => {
  const { usage, clock, store } = setup()
  const runId = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock))
  usage.endRun(runId, { results: { analyzed: 2, note: 'oops', bad: NaN } })
  assert.deepEqual(store.readUsageDay(dayKey(clock.ms)).runs[0].results, { analyzed: 2 })
})

// ── expiry ──────────────────────────────────────────────────────────────

test('endRun prunes expired day files once per day', () => {
  const { usage, clock, store } = setup({ costHistoryDays: 7 })
  const old = dayKey(clock.ms - 40 * MS_PER_DAY)
  store.writeUsageDay(old, { version: 1, day: old, runs: [] })
  const recent = dayKey(clock.ms - 2 * MS_PER_DAY)
  store.writeUsageDay(recent, { version: 1, day: recent, runs: [] })
  assert.ok(store.listUsageDays().includes(old))

  const runId = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock))
  usage.endRun(runId, {})

  const days = store.listUsageDays()
  assert.equal(days.includes(old), false, 'the expired file is gone')
  assert.equal(days.includes(recent), true, 'a file inside the window stays')
  assert.equal(days.includes(dayKey(clock.ms)), true)

  // a second run on the same day must not re-prune a file seeded meanwhile
  const seeded = dayKey(clock.ms - 90 * MS_PER_DAY)
  store.writeUsageDay(seeded, { version: 1, day: seeded, runs: [] })
  const second = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(second, { op: 'analysis' })(record(clock))
  usage.endRun(second, {})
  assert.equal(store.listUsageDays().includes(seeded), true, 'pruning happens once per day, not per run')

  // ... but the next calendar day prunes again
  clock.ms += MS_PER_DAY
  const third = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(third, { op: 'analysis' })(record(clock))
  usage.endRun(third, {})
  assert.equal(store.listUsageDays().includes(seeded), false, 'a day change prunes again')
})

// ── flush ───────────────────────────────────────────────────────────────

test('flush writes live runs with status running, plus the summary', () => {
  const { usage, clock, store } = setup()
  const runId = usage.beginRun({ type: 'bootstrap', trigger: 'startup' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock))
  usage.flush()

  const day = dayKey(clock.ms)
  const [run] = store.readUsageDay(day).runs
  assert.equal(run.runId, runId)
  assert.equal(run.status, 'running')
  assert.equal(run.endedAt, 0)
  assert.equal(run.attempts.length, 1)
  assert.equal(store.readUsageSummary().lifetime.attempts, 1)
  assert.equal(usage.liveRuns().length, 1, 'flush does not end the run')

  // the same run is upserted (not duplicated) when it finishes
  usage.attemptSink(runId, { op: 'analysis' })(record(clock))
  usage.endRun(runId, {})
  const runs = store.readUsageDay(day).runs
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'success')
  assert.equal(runs[0].attempts.length, 2)
})

test('a scheduled flush lands without any endRun (and its timer is unref\'d)', async () => {
  const { usage, clock, store } = setup({ flushDelayMs: 5 })
  const runId = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(runId, { op: 'analysis' })(record(clock))
  await delay(80)
  assert.equal(store.readUsageSummary().lifetime.attempts, 1)
  assert.equal(store.readUsageDay(dayKey(clock.ms)).runs.length, 1)
  usage.flush()
})

test('a corrupt day file on disk does not lose the run being written', () => {
  const { usage, clock, store, dir } = setup()
  const day = dayKey(clock.ms)
  fs.mkdirSync(path.join(dir, 'usage'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'usage', `${day}.json`), '{not json', 'utf8')

  const { lines } = captureWarn(() => {
    const runId = usage.beginRun({ type: 'analysis' })
    usage.attemptSink(runId, { op: 'analysis' })(record(clock))
    usage.endRun(runId, {})
    return runId
  })
  assert.ok(lines.some((line) => line.includes('corrupt usage file')), 'the store warned once')
  const runs = store.readUsageDay(day).runs
  assert.equal(runs.length, 1)
  assert.equal(runs[0].attempts.length, 1)
})

// ── summary bootstrap ───────────────────────────────────────────────────

test('a freshly created summary is written back so trackingSince sticks', () => {
  const { usage, store, clock } = setup()
  assert.equal(usage.summary().trackingSince, clock.ms)
  assert.equal(store.readUsageSummary().trackingSince, clock.ms)
})

test('an existing summary is loaded once and kept (never recomputed)', () => {
  const { dir, store } = setup()
  const runId = 'useeded-0'
  store.writeUsageSummary(usageSummarySchema.parse({
    version: 1,
    trackingSince: 111,
    lifetime: { attempts: 5, billedCalls: 5, unmeteredCalls: 0, unpricedCalls: 0, usdKnown: 2 },
    byType: { analysis: { attempts: 5, usdKnown: 2 } },
  }))
  const clock = { ms: START }
  const usage = createUsageTracker({
    store: new CoachStore(dir),
    config: () => ({ costHistoryDays: 30 }),
    pricing: fakePricing(),
    now: () => clock.ms,
    flushDelayMs: 60_000,
  })
  assert.equal(usage.summary().trackingSince, 111)
  const started = usage.beginRun({ type: 'analysis' })
  assert.notEqual(started, runId)
  usage.attemptSink(started, { op: 'analysis' })(record(clock))
  assert.equal(usage.summary().lifetime.attempts, 6)
  assert.equal(usage.summary().byType.analysis.attempts, 6)
})

// ── defensive narrowing ─────────────────────────────────────────────────

test('sinks for unknown runs, unknown ops and junk records are ignored', () => {
  const { usage, clock } = setup()
  assert.doesNotThrow(() => usage.attemptSink('nope', { op: 'analysis' })(record(clock)))
  const runId = usage.beginRun({ type: 'analysis' })
  usage.attemptSink(runId, { op: 'not-an-op' })(record(clock))
  usage.attemptSink(runId, { op: 'analysis' })(null)
  usage.attemptSink(runId, { op: 'analysis' })('junk')
  assert.equal(usage.liveRuns()[0].attempts.length, 0)
  assert.equal(usage.summary().lifetime.attempts, 0)
})

test('an unknown run type is never tracked (a bad row would drop the whole day file)', () => {
  const { usage, clock, store } = setup()
  const { value: runId, lines } = captureWarn(() => usage.beginRun({ type: 'not-a-type' }))
  assert.equal(typeof runId, 'string')
  assert.ok(lines.some((line) => line.includes('not-a-type')))
  usage.attemptSink(runId, { op: 'analysis' })(record(clock))
  assert.equal(usage.liveRuns().length, 0)
  assert.equal(usage.runSummary(runId), null)
  usage.endRun(runId, {})
  usage.flush()
  assert.equal(store.readUsageDay(dayKey(clock.ms)).runs.length, 0)
})

test('an unusable status or usage bucket is narrowed, never trusted', () => {
  const { usage, clock } = setup()
  const runId = usage.beginRun({ type: 'analysis' })
  const sink = usage.attemptSink(runId, { op: 'analysis' })
  sink(record(clock, { status: 'weird' }))
  sink(record(clock, { status: 'weird', usage: null }))
  sink(record(clock, { usage: { inputTokens: -5, outputTokens: 'x', cacheReadTokens: NaN } }))
  const [run] = usage.liveRuns()
  assert.deepEqual(run.attempts.map((a) => a.status), ['ok', 'unmetered', 'ok'])
  assert.deepEqual(run.attempts[2].usage, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })
  assert.equal(run.totals.attempts, 3)
})

// ── token totals ────────────────────────────────────────────────────────

test('totalTokens excludes reasoning (a subset of output) and never double counts', () => {
  assert.equal(totalTokens({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 4, reasoningTokens: 20 }), 164)
  assert.equal(totalTokens({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 999 }), 2)
  assert.equal(totalTokens(null), 0)
  assert.equal(totalTokens({ inputTokens: -5, outputTokens: 'x' }), 0)
})

test('token buckets stay separate as totals accumulate', () => {
  const { usage, clock } = setup()
  const runId = usage.beginRun({ type: 'analysis' })
  const sink = usage.attemptSink(runId, { op: 'analysis' })
  sink(record(clock))
  sink(record(clock))
  const [run] = usage.liveRuns()
  assert.deepEqual(run.totals.tokens, { inputTokens: 200, outputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 8, reasoningTokens: 40 })
  assert.equal(totalTokens(run.totals.tokens), 328)
  assert.equal(totalTokens(usage.summary().lifetime.tokens), 328)
})
