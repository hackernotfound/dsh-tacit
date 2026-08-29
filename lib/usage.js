// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — the usage/cost tracker.
 *
 * Groups metered model calls into *runs* (one bootstrap batch, one
 * auto-analysis, one ✨ Improve, ...) and each underlying `run()` of
 * `callCoachModel` into an *attempt*. Attempts arrive through
 * `attemptSink(runId, tag)`, the `onUsage` callback the analyzer calls.
 *
 * Two hard rules shape the design:
 *  - **Synchronous.** Every mutation here is plain JS with no `await`, so the
 *    four bootstrap workers calling sinks concurrently interleave safely and
 *    no model call ever waits on the ledger. Disk writes happen on `endRun`
 *    and on a debounced, `unref()`'d flush timer that never holds the process
 *    open.
 *  - **Content-free.** A run carries ids, counts, tokens and money — never
 *    prompts, responses, tool arguments or full paths (`workspace` is the
 *    label, not the path).
 *
 * Totals are kept twice: on the run (written into its day file) and in the
 * in-memory summary (loaded once at creation, delta-applied at record time,
 * flushed to `usage/summary.json`) so reports never re-scan every day file.
 */

import { dayKey } from './store.js'
import { USAGE_OPS, USAGE_RUN_TYPES } from './schema.js'

const ATTEMPT_STATUSES = ['ok', 'failed', 'unmetered']
const RUN_STATUSES = ['running', 'success', 'partial', 'failed']
const TOKEN_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
/** Finished runs kept addressable for `runSummary()` after they leave `live`. */
const MAX_REMEMBERED_RUNS = 50

/** A non-negative finite number, or 0. */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function emptyTokens() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
}

function emptyTotals() {
  return { attempts: 0, billedCalls: 0, unmeteredCalls: 0, unpricedCalls: 0, tokens: emptyTokens(), usdKnown: 0 }
}

function emptyDayTotals() {
  return { ...emptyTotals(), byType: {} }
}

/**
 * Billed token count: uncached input + cache reads + cache writes + output.
 * `reasoningTokens` is a subset of `outputTokens` (DeepSeek adapter) and is
 * deliberately NOT added — summing it would double count every reasoning
 * token in every total.
 */
export function totalTokens(tokens) {
  if (!isPlainObject(tokens)) return 0
  return count(tokens.inputTokens) + count(tokens.outputTokens) + count(tokens.cacheReadTokens) + count(tokens.cacheWriteTokens)
}

/** A `tokenBucketsSchema` object from an untrusted usage record, or `null` for an unmetered call. */
function narrowUsage(usage) {
  if (!isPlainObject(usage)) return null
  const out = emptyTokens()
  for (const key of TOKEN_KEYS) out[key] = count(usage[key])
  return out
}

/** Add `delta` into `target` in place (both are `usageTotalsSchema` shaped). */
function addTotals(target, delta) {
  target.attempts += delta.attempts
  target.billedCalls += delta.billedCalls
  target.unmeteredCalls += delta.unmeteredCalls
  target.unpricedCalls += delta.unpricedCalls
  target.usdKnown += delta.usdKnown
  for (const key of TOKEN_KEYS) target.tokens[key] += delta.tokens[key]
}

/** `record[key]`, creating it from `factory` the first time (and repairing a corrupt bucket). */
function bucketOf(record, key, factory) {
  const existing = record[key]
  if (!isPlainObject(existing)) {
    record[key] = factory()
    return record[key]
  }
  // A summary read back from disk is schema-validated, but a bucket that
  // predates a field still needs it before `+=` turns it into NaN.
  const filled = { ...factory(), ...existing }
  filled.tokens = { ...emptyTokens(), ...(isPlainObject(existing.tokens) ? existing.tokens : {}) }
  record[key] = filled
  return filled
}

/** Only finite numbers may reach `results` (`z.record(z.number())` would drop the whole run otherwise). */
function narrowResults(results) {
  const out = {}
  if (!isPlainObject(results)) return out
  for (const [key, value] of Object.entries(results)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** no attempts → failed; any failure → partial (all failed → failed); otherwise success. */
function deriveStatus(attempts) {
  if (attempts.length === 0) return 'failed'
  const failed = attempts.filter((attempt) => attempt.status === 'failed').length
  if (failed === 0) return 'success'
  return failed === attempts.length ? 'failed' : 'partial'
}

/**
 * The run/attempt ledger. `config` is the effective-config getter (only
 * `costHistoryDays` is read); `pricing` is anything with `priceCall`
 * (`lib/pricing-source.js`); `now`/`flushDelayMs` are injectable for tests.
 */
export function createUsageTracker({ store, config, pricing, now = Date.now, flushDelayMs = 250 }) {
  /** Runs that have begun and not yet ended, by runId. */
  const live = new Map()
  /** Finished run summaries, so `runSummary()` still answers after `endRun`. */
  const remembered = new Map()
  /** Day keys whose file has unwritten live-run state. */
  const dirtyDays = new Set()
  let summaryDirty = false
  let timer = null
  let seq = 0
  /** '' until the first prune; then the day key it last ran on. */
  let lastPruneDay = ''

  const summary = store.readUsageSummary()
  if (isFreshSummary(summary)) {
    summary.trackingSince = now()
    store.writeUsageSummary(summary)
  }

  /** A summary with nothing recorded yet was just created by the store — persist it so `trackingSince` sticks. */
  function isFreshSummary(value) {
    return count(value?.lifetime?.attempts) === 0
      && Object.keys(value?.days ?? {}).length === 0
      && Object.keys(value?.byType ?? {}).length === 0
      && Object.keys(value?.byModel ?? {}).length === 0
  }

  /** The day file a run belongs to (its start, so a run never splits across two files). */
  function runDay(run) {
    return dayKey(run.startedAt)
  }

  function scheduleFlush() {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, flushDelayMs)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  /** Read the day file, upsert `runs` by runId, write it back. */
  function upsertDay(day, runs) {
    if (runs.length === 0) return
    const file = store.readUsageDay(day)
    const list = Array.isArray(file?.runs) ? [...file.runs] : []
    for (const run of runs) {
      const at = list.findIndex((existing) => existing?.runId === run.runId)
      if (at >= 0) list[at] = run
      else list.push(run)
    }
    store.writeUsageDay(day, { version: 1, day, runs: list })
  }

  /** Expire old day files at most once per calendar day. */
  function pruneIfNewDay() {
    const today = dayKey(now())
    if (today === lastPruneDay) return
    lastPruneDay = today
    const keepDays = count(config?.().costHistoryDays)
    store.pruneUsageDays(keepDays > 0 ? keepDays : 30, today)
  }

  function beginRun({ type, trigger = '', sessionId = '', turn = null, workspace = '', model = '', provider = '' } = {}) {
    const startedAt = now()
    const runId = `u${startedAt.toString(36)}-${(seq++).toString(36)}`
    if (!USAGE_RUN_TYPES.includes(type)) {
      // Never track a run the day-file schema would reject: one bad row makes
      // the whole day unreadable. The id stays valid; every sink ignores it.
      console.warn(`[tacit] usage: unknown run type ${JSON.stringify(type)}, not tracked`)
      return runId
    }
    live.set(runId, {
      runId,
      type,
      trigger: String(trigger ?? ''),
      startedAt,
      endedAt: 0,
      status: 'running',
      sessionId: String(sessionId ?? ''),
      turn: typeof turn === 'number' && Number.isFinite(turn) ? turn : null,
      workspace: String(workspace ?? ''),
      model: String(model ?? ''),
      provider: String(provider ?? ''),
      results: {},
      attempts: [],
      totals: emptyTotals(),
    })
    return runId
  }

  /** Fold one attempt into the run totals and every summary bucket. Synchronous by contract. */
  function recordAttempt(runId, { op, sessionId = '', turn = null } = {}, record) {
    const run = live.get(runId)
    if (run === undefined || !isPlainObject(record)) return
    if (!USAGE_OPS.includes(op)) return

    const usage = narrowUsage(record.usage)
    const startedAt = count(record.startedAt) > 0 ? record.startedAt : now()
    const model = typeof record.model === 'string' ? record.model : ''
    const provider = typeof record.provider === 'string' ? record.provider : ''
    const priced = usage === null ? null : (pricing?.priceCall({ model, provider, atMs: startedAt, usage }) ?? null)

    const attempt = {
      id: `${runId}:${run.attempts.length}`,
      op,
      startedAt,
      durationMs: count(record.durationMs),
      model,
      provider,
      reasoningEffort: typeof record.reasoningEffort === 'string' ? record.reasoningEffort : null,
      finish: typeof record.finish === 'string' ? record.finish : '',
      status: ATTEMPT_STATUSES.includes(record.status) ? record.status : (usage === null ? 'unmetered' : 'ok'),
      code: typeof record.code === 'string' ? record.code : '',
      sessionId: String(sessionId ?? ''),
      turn: typeof turn === 'number' && Number.isFinite(turn) ? turn : null,
      usage,
      priced: isPlainObject(priced) ? priced : null,
    }
    run.attempts.push(attempt)

    const delta = {
      attempts: 1,
      billedCalls: usage !== null ? 1 : 0,
      unmeteredCalls: usage === null ? 1 : 0,
      unpricedCalls: usage !== null && attempt.priced === null ? 1 : 0,
      tokens: usage ?? emptyTokens(),
      usdKnown: count(attempt.priced?.usd),
    }
    addTotals(run.totals, delta)
    addTotals(bucketOf(summary, 'lifetime', emptyTotals), delta)
    addTotals(bucketOf(summary.byType, run.type, emptyTotals), delta)
    if (model.length > 0) addTotals(bucketOf(summary.byModel, model, emptyTotals), delta)
    const day = bucketOf(summary.days, dayKey(startedAt), emptyDayTotals)
    if (!isPlainObject(day.byType)) day.byType = {}
    addTotals(day, delta)
    addTotals(bucketOf(day.byType, run.type, emptyTotals), delta)

    dirtyDays.add(runDay(run))
    summaryDirty = true
    scheduleFlush()
  }

  /** The `onUsage` callback for one op: a closed-over `recordAttempt`. Unknown runs are ignored. */
  function attemptSink(runId, tag = {}) {
    return (record) => recordAttempt(runId, tag, record)
  }

  /** Close a run: derive its status, write its day file, evict it, and expire old days. */
  function endRun(runId, { results = {}, status } = {}) {
    const run = live.get(runId)
    if (run === undefined) return null
    run.endedAt = now()
    run.status = RUN_STATUSES.includes(status) ? status : deriveStatus(run.attempts)
    run.results = narrowResults(results)
    upsertDay(runDay(run), [run])
    live.delete(runId)
    remember(run)
    pruneIfNewDay()
    return runSummary(runId)
  }

  /** Keep the newest finished runs addressable (bounded, FIFO). */
  function remember(run) {
    remembered.set(run.runId, summarize(run))
    if (remembered.size > MAX_REMEMBERED_RUNS) {
      const oldest = remembered.keys().next()
      if (!oldest.done) remembered.delete(oldest.value)
    }
  }

  function summarize(run) {
    return {
      runId: run.runId,
      type: run.type,
      status: run.status,
      attempts: run.totals.attempts,
      billedCalls: run.totals.billedCalls,
      unmeteredCalls: run.totals.unmeteredCalls,
      unpricedCalls: run.totals.unpricedCalls,
      tokens: { ...run.totals.tokens },
      usdKnown: run.totals.usdKnown,
    }
  }

  /** Counters for a live or recently finished run; `null` when the id is unknown. */
  function runSummary(runId) {
    const run = live.get(runId)
    if (run !== undefined) return summarize(run)
    return remembered.get(runId) ?? null
  }

  /** Write every dirty day file (live runs included, still `running`) and the summary. Synchronous. */
  function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const byDay = new Map()
    for (const run of live.values()) {
      const day = runDay(run)
      const runs = byDay.get(day)
      if (runs === undefined) byDay.set(day, [run])
      else runs.push(run)
    }
    for (const day of dirtyDays) upsertDay(day, byDay.get(day) ?? [])
    dirtyDays.clear()
    if (summaryDirty) {
      store.writeUsageSummary(summary)
      summaryDirty = false
    }
  }

  return {
    beginRun,
    attemptSink,
    recordAttempt,
    endRun,
    runSummary,
    flush,
    summary: () => summary,
    liveRuns: () => [...live.values()],
  }
}
