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
const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Report defaults for the wire-optional filter fields. */
const DEFAULT_RANGE = '30d'
const DEFAULT_PAGE_SIZE = 20
/** Days each `range` looks back over (`month`/`all` are computed instead). */
const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30 }
/** Spend at or above this share of the limit is a warning (below the limit itself). */
const WARN_AT = 0.8
/** The one honest claim the cost cards may make: real usage, list-price arithmetic. */
const PRICING_LABEL = 'Measured usage · list-price cost'

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
 * The `count` day keys ending on `endMs`'s own day, ascending. Anchored at
 * local noon so a DST shift can never drop or repeat a calendar day.
 */
function dayKeysEnding(endMs, count) {
  const anchor = new Date(endMs)
  anchor.setHours(12, 0, 0, 0)
  const out = []
  for (let back = count - 1; back >= 0; back -= 1) out.push(dayKey(anchor.getTime() - back * MS_PER_DAY))
  return out
}

/** Middle value (mean of the two middles when even); `null` for an empty list. */
function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** A `usageTotalsSchema`-shaped value from an untrusted bucket (a report must never add `undefined`). */
function safeTotals(value) {
  const source = isPlainObject(value) ? value : {}
  const out = { ...emptyTotals(), ...source }
  out.tokens = { ...emptyTokens(), ...(isPlainObject(source.tokens) ? source.tokens : {}) }
  for (const key of ['attempts', 'billedCalls', 'unmeteredCalls', 'unpricedCalls', 'usdKnown']) out[key] = count(out[key])
  for (const key of TOKEN_KEYS) out.tokens[key] = count(out.tokens[key])
  return out
}

/** The totals delta one stored attempt contributed — the same arithmetic `recordAttempt` applied live. */
function attemptDelta(attempt) {
  const usage = narrowUsage(attempt.usage)
  const priced = isPlainObject(attempt.priced) ? attempt.priced : null
  return {
    attempts: 1,
    billedCalls: usage !== null ? 1 : 0,
    unmeteredCalls: usage === null ? 1 : 0,
    unpricedCalls: usage !== null && priced === null ? 1 : 0,
    tokens: usage ?? emptyTokens(),
    usdKnown: count(priced?.usd),
  }
}

/**
 * Cache-hit share of the billed input: `cacheRead / (input + cacheRead)`.
 * `null` when nothing was billed for input at all (0 % would be a lie).
 */
function cachedInputRateOf(tokens) {
  const billedInput = count(tokens.inputTokens) + count(tokens.cacheReadTokens)
  return billedInput === 0 ? null : count(tokens.cacheReadTokens) / billedInput
}

/** `'none'` with no limit set; `'exceeded'` at or over it; `'warn'` from 80 % up. */
function warningLevel(limit, spent) {
  if (!(limit > 0)) return 'none'
  if (spent >= limit) return 'exceeded'
  return spent >= WARN_AT * limit ? 'warn' : 'none'
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

  // Reassigned by `clear()`, which reloads the (fresh) summary the store wrote.
  let summary = store.readUsageSummary()
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

  // ── the read side (reports, one run, clear) ──────────────────────────────

  /** How many days of detail are on disk at all — the hard bound on every range. */
  function retentionDays() {
    const keepDays = count(config?.().costHistoryDays)
    return keepDays > 0 ? keepDays : 30
  }

  /** Ascending day keys one `range` covers, never reaching past retention. */
  function rangeKeys(range, keepDays, available) {
    if (range === 'all') {
      // "All" is still only as far back as detail is kept — bound by day key,
      // not by file count, so a sparse history cannot smuggle in older days.
      const oldest = dayKeysEnding(now(), keepDays)[0]
      return available.filter((day) => day >= oldest)
    }
    if (range === 'month') {
      const today = dayKey(now())
      const dayOfMonth = Number(today.slice(-2))
      return dayKeysEnding(now(), Math.min(dayOfMonth, keepDays))
    }
    return dayKeysEnding(now(), Math.min(RANGE_DAYS[range] ?? RANGE_DAYS[DEFAULT_RANGE], keepDays))
  }

  /**
   * The runs of the day files inside `keys` that `available` says exist —
   * one `readdir` up front means only the reads that can pay off happen.
   * This runs on every 10 s poll of the cost panel.
   */
  function loadDays(keys, available) {
    const out = []
    for (const day of keys) {
      if (!available.has(day)) continue
      const file = store.readUsageDay(day)
      if (Array.isArray(file?.runs)) out.push(...file.runs)
    }
    return out
  }

  /** Summary day buckets summed over `keys` (missing days simply contribute nothing). */
  function totalsOver(keys) {
    const out = emptyTotals()
    for (const day of keys) {
      const bucket = summary.days?.[day]
      if (isPlainObject(bucket)) addTotals(out, safeTotals(bucket))
    }
    return out
  }

  /**
   * One period card: the summary's own totals plus the two derived figures
   * the panel shows. `avgAnalysisUsd` is a median (a single bootstrap batch
   * must not drag the typical cost of one analysis upwards) over the priced
   * `analysis` attempts of the day files that were loaded — so it is only as
   * deep as the retention window, which is exactly how deep detail goes.
   */
  function periodOf(totals, attempts) {
    const usds = []
    for (const attempt of attempts) {
      if (attempt.op !== 'analysis') continue
      if (!isPlainObject(attempt.priced)) continue
      usds.push(count(attempt.priced.usd))
    }
    return { ...totals, avgAnalysisUsd: median(usds), cachedInputRate: cachedInputRateOf(totals.tokens) }
  }

  /** `[{day, usdKnown, billedCalls}]`, zero-filled, ending on today. */
  function seriesOf(days) {
    return dayKeysEnding(now(), days).map((day) => {
      const bucket = summary.days?.[day]
      const totals = isPlainObject(bucket) ? safeTotals(bucket) : emptyTotals()
      return { day, usdKnown: totals.usdKnown, billedCalls: totals.billedCalls }
    })
  }

  /** A run row without its attempt array: the counters plus the identity the list shows. */
  function runItem(run) {
    return {
      ...summarize({ ...run, totals: safeTotals(run.totals) }),
      trigger: typeof run.trigger === 'string' ? run.trigger : '',
      startedAt: count(run.startedAt),
      endedAt: count(run.endedAt),
      sessionId: typeof run.sessionId === 'string' ? run.sessionId : '',
      turn: typeof run.turn === 'number' ? run.turn : null,
      workspace: typeof run.workspace === 'string' ? run.workspace : '',
      model: typeof run.model === 'string' ? run.model : '',
      provider: typeof run.provider === 'string' ? run.provider : '',
      results: narrowResults(run.results),
    }
  }

  /** Every filter is an exact match; an absent filter matches everything. */
  function matchesFilters(run, filters) {
    if (filters.type !== undefined && run.type !== filters.type) return false
    if (filters.status !== undefined && run.status !== filters.status) return false
    if (filters.model !== undefined && run.model !== filters.model) return false
    if (filters.workspace !== undefined && run.workspace !== filters.workspace) return false
    if (filters.sessionId !== undefined && run.sessionId !== filters.sessionId) return false
    return true
  }

  /**
   * The whole cost panel in one read: period cards, the two sparkline series,
   * the type/model breakdowns, the budget warnings and one page of runs.
   *
   * Cheap by construction — every total comes from the in-memory summary, and
   * the only disk work is the day files inside the requested range (bounded by
   * `costHistoryDays`), which the run list and the medians read anyway.
   */
  function report({ config: effective = {}, pricingStatus = {}, pricingRates = {}, filters = {} } = {}) {
    // The caller's effective config wins (it is the same getter in production);
    // the injected one is the fallback for a bare `report()`.
    const keepDays = count(effective?.costHistoryDays) > 0 ? Math.floor(effective.costHistoryDays) : retentionDays()
    const range = typeof filters.range === 'string' ? filters.range : DEFAULT_RANGE
    const page = count(filters.page) > 0 ? Math.floor(filters.page) : 1
    const pageSize = count(filters.pageSize) > 0 ? Math.floor(filters.pageSize) : DEFAULT_PAGE_SIZE

    const available = store.listUsageDays()
    const runs = loadDays(rangeKeys(range, keepDays, available), new Set(available))
    const attempts = []
    for (const run of runs) {
      if (Array.isArray(run?.attempts)) attempts.push(...run.attempts.filter(isPlainObject))
    }
    /** Loaded attempts by the day they were billed on, so each period medians only its own. */
    const attemptsByDay = new Map()
    for (const attempt of attempts) {
      const day = dayKey(count(attempt.startedAt))
      const list = attemptsByDay.get(day)
      if (list === undefined) attemptsByDay.set(day, [attempt])
      else list.push(attempt)
    }
    const attemptsIn = (keys) => keys.flatMap((day) => attemptsByDay.get(day) ?? [])

    const todayKeys = dayKeysEnding(now(), 1)
    const last7Keys = dayKeysEnding(now(), 7)
    const last30Keys = dayKeysEnding(now(), 30)
    const monthPrefix = dayKey(now()).slice(0, 7)
    const monthKeys = Object.keys(summary.days ?? {}).filter((day) => day.startsWith(monthPrefix)).sort()

    // byType comes straight from the summary's own per-day buckets; byModel is
    // folded from the loaded attempts because the day buckets carry no model
    // split — both are the same last-30-days window.
    const byType = {}
    for (const day of last30Keys) {
      const buckets = summary.days?.[day]?.byType
      if (!isPlainObject(buckets)) continue
      for (const [type, totals] of Object.entries(buckets)) addTotals(bucketOf(byType, type, emptyTotals), safeTotals(totals))
    }
    const byModel = {}
    for (const attempt of attemptsIn(last30Keys)) {
      const model = typeof attempt.model === 'string' ? attempt.model : ''
      if (model.length === 0) continue
      addTotals(bucketOf(byModel, model, emptyTotals), attemptDelta(attempt))
    }

    const today = periodOf(totalsOver(todayKeys), attemptsIn(todayKeys))
    const month = periodOf(totalsOver(monthKeys), attemptsIn(monthKeys))
    const dailyLimit = count(effective?.costWarnDailyUsd)
    const monthlyLimit = count(effective?.costWarnMonthlyUsd)

    const matched = runs
      .filter((run) => isPlainObject(run) && matchesFilters(run, filters))
      .sort((a, b) => count(b.startedAt) - count(a.startedAt))
    const from = (page - 1) * pageSize

    return {
      ok: true,
      trackingSince: count(summary.trackingSince),
      pricing: { ...pricingStatus, rates: pricingRates, label: PRICING_LABEL },
      today,
      month,
      last7: periodOf(totalsOver(last7Keys), attemptsIn(last7Keys)),
      last30: periodOf(totalsOver(last30Keys), attemptsIn(last30Keys)),
      lifetime: periodOf(safeTotals(summary.lifetime), attempts),
      byType,
      byModel,
      series7: seriesOf(7),
      series30: seriesOf(30),
      warnings: {
        daily: { limit: dailyLimit, spent: today.usdKnown, level: warningLevel(dailyLimit, today.usdKnown) },
        monthly: { limit: monthlyLimit, spent: month.usdKnown, level: warningLevel(monthlyLimit, month.usdKnown) },
      },
      runs: {
        items: matched.slice(from, from + pageSize).map(runItem),
        page,
        pageSize,
        total: matched.length,
      },
      code: '',
      detail: '',
    }
  }

  /**
   * One run with its attempts — the live copy first (so a run is addressable
   * before it is ever written), then the day files newest-first. `null` when
   * the id is unknown or its day has expired.
   */
  function run(runId) {
    const liveRun = live.get(runId)
    if (liveRun !== undefined) return { ...liveRun, attempts: [...liveRun.attempts], totals: { ...liveRun.totals, tokens: { ...liveRun.totals.tokens } } }
    for (const day of store.listUsageDays().reverse()) {
      const file = store.readUsageDay(day)
      const found = Array.isArray(file?.runs) ? file.runs.find((entry) => entry?.runId === runId) : undefined
      if (found !== undefined) return found
    }
    return null
  }

  /**
   * Delete the ledger: every day file (never anything else in `usage/`) and
   * the summary, which the store replaces with a fresh one. Live runs are
   * deliberately kept — a bootstrap batch mid-flight keeps recording, into the
   * new tracking window.
   */
  function clear() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    // Nothing pending may resurrect what was just deleted.
    dirtyDays.clear()
    summaryDirty = false
    lastPruneDay = ''
    const { removed } = store.clearUsage()
    summary = store.readUsageSummary()
    // The store stamps the new window with its own `Date.now()`; the tracker's
    // injected clock is the one every other timestamp here comes from.
    summary.trackingSince = now()
    store.writeUsageSummary(summary)
    return { removed, trackingSince: summary.trackingSince }
  }

  return {
    beginRun,
    attemptSink,
    recordAttempt,
    endRun,
    runSummary,
    flush,
    report,
    run,
    clear,
    summary: () => summary,
    liveRuns: () => [...live.values()],
  }
}
