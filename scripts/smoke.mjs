// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * Live smoke for Tacit against a RUNNING `dsh web` (http://127.0.0.1:3080).
 * Pure HTTP — the same routes the browser uses. Real model calls (a few
 * flash calls, well under a cent). Uses the real profile/config. Also
 * exercises the usage/cost dashboard routes (usage, usage-run,
 * pricing-refresh, bootstrap-preview) read-only, once the earlier steps have
 * produced at least one usage run — never usage-clear (destructive) or
 * analyze-batch (paid).
 *
 *   pnpm smoke                                 # dsh web on the default http://127.0.0.1:3080
 *   TACIT_BASE=http://127.0.0.1:4000 pnpm smoke  # any other host/port
 *   TACIT_SMOKE_SESSION=<id> pnpm smoke         # pin a session instead of the newest one
 */

import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.env.TACIT_BASE || 'http://127.0.0.1:3080'
const SESSION_ID = process.env.TACIT_SMOKE_SESSION || ''

let failures = 0
function check(name, condition, detail) {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? ' — ' + detail : ''))
  if (!condition) failures += 1
}

async function post(pathName, payload) {
  const response = await fetch(BASE + '/api/tacit' + pathName, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload === undefined ? {} : payload),
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  return { status: response.status, data }
}

async function waitForServer(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE + '/')
      if (response.ok) return
    } catch {
      // not up yet
    }
    await sleep(1000)
  }
  throw new Error('dsh web did not come up on ' + BASE)
}

console.log('tacit live smoke — waiting for ' + BASE)
await waitForServer()

// 1. State: config + profile + auto + steering.
const state = await post('/state', {})
check('state: ok', state.data?.ok === true)
check('state: auto status present', typeof state.data?.auto?.today === 'number' && typeof state.data?.auto?.budget === 'number',
  'today=' + state.data?.auto?.today + ' budget=' + state.data?.auto?.budget)
check('state: steering status present', typeof state.data?.steering?.enabled === 'boolean' && typeof state.data?.steering?.text === 'string')
check('state: profile has directives array', Array.isArray(state.data?.profile?.directives))

// 2. Stats: measured trend.
const stats = await post('/stats', { window: 5 })
check('stats: ok with early/recent windows', stats.data?.ok === true && typeof stats.data?.trend?.recent?.messyRate === 'number',
  'enough=' + stats.data?.trend?.enough + ' recent.n=' + stats.data?.trend?.recent?.n)

// 3. Directives: add → appears in steering text → remove.
const added = await post('/directives', { action: 'add', text: 'Smoke-test directive: prefer pnpm over npm.' })
check('directives: add ok', added.data?.ok === true)
const addedId = (added.data?.profile?.directives ?? []).find((d) => d.text.startsWith('Smoke-test directive'))?.id
check('directives: rendered into the steering text', typeof addedId === 'string' && (added.data?.steering?.text ?? '').includes('prefer pnpm'))
const toggled = await post('/directives', { action: 'toggle', id: addedId ?? 'x', enabled: false })
check('directives: toggle off removes it from the steering text', toggled.data?.ok === true && !(toggled.data?.steering?.text ?? '').includes('prefer pnpm'))
const removed = await post('/directives', { action: 'remove', id: addedId ?? 'x' })
check('directives: remove ok', removed.data?.ok === true && !(removed.data?.profile?.directives ?? []).some((d) => d.id === addedId))
const bad = await post('/directives', { action: 'explode' })
check('directives: bad action → HTTP 400', bad.status === 400)

// 4. Improve (real model call) when a session id is given.
let improveRanOk = false
if (SESSION_ID.length > 0) {
  const improved = await post('/improve', { sessionId: SESSION_ID, draft: 'write a small node script that prints hello world' })
  check('improve: ok with rewriteId', improved.data?.ok === true && typeof improved.data?.rewriteId === 'string' && improved.data.rewriteId.length > 0,
    'code=' + improved.data?.code + ' ' + (improved.data?.detail ?? ''))
  improveRanOk = improved.data?.ok === true
  if (improved.data?.ok === true) {
    const applied = await post('/applied', { sessionId: SESSION_ID, rewriteId: improved.data.rewriteId })
    check('applied: ok', applied.data?.ok === true)
    const up = await post('/feedback', { rewriteId: improved.data.rewriteId, verdict: 'up' })
    check('feedback 👍: ok', up.data?.ok === true)
  }
} else {
  console.log('  skip  improve/applied/feedback (set TACIT_SMOKE_SESSION=<session id> to exercise the real model path)')
}

const orphan = await post('/feedback', { rewriteId: 'rw-does-not-exist', verdict: 'up' })
check('orphan feedback → HTTP 400', orphan.status === 400 && orphan.data?.ok === false)

// 5. Usage & cost dashboard — read-only. By this point the /improve call
//    above (when TACIT_SMOKE_SESSION is set) has minted at least one usage
//    run, so the report/run-lookup/filter checks below have something real
//    to look at. Deliberately never calls /usage-clear (wipes the ledger —
//    destructive) or /analyze-batch (a paid model call the bootstrap/batch
//    button drives, out of scope for a read-only pass).
const usageReport = await post('/usage', { range: '30d' })
check('usage: ok', usageReport.data?.ok === true)
check('usage: pricing label', usageReport.data?.pricing?.label === 'Measured usage · list-price cost',
  'label=' + usageReport.data?.pricing?.label)
check('usage: pricing source', ['bundled', 'costMeter'].includes(usageReport.data?.pricing?.source),
  'source=' + usageReport.data?.pricing?.source)
check('usage: pricing tierNow', ['peak', 'offPeak'].includes(usageReport.data?.pricing?.tierNow),
  'tierNow=' + usageReport.data?.pricing?.tierNow)
check('usage: series30 has 30 entries', Array.isArray(usageReport.data?.series30) && usageReport.data.series30.length === 30,
  'len=' + usageReport.data?.series30?.length)
check('usage: series7 has 7 entries', Array.isArray(usageReport.data?.series7) && usageReport.data.series7.length === 7,
  'len=' + usageReport.data?.series7?.length)
const runItems = usageReport.data?.runs?.items ?? []
check('usage: at least one run on the page', runItems.length >= 1, 'items=' + runItems.length)
check('usage: lifetime billedCalls >= 1', (usageReport.data?.lifetime?.billedCalls ?? 0) >= 1,
  'billedCalls=' + usageReport.data?.lifetime?.billedCalls)
const RUN_STATUSES = ['success', 'partial', 'failed', 'running']
check('usage: every run item has runId/type/status', runItems.every((r) =>
  typeof r?.runId === 'string' && r.runId.length > 0 && typeof r?.type === 'string' && RUN_STATUSES.includes(r?.status)))
if (improveRanOk) {
  check('usage: the improve run from this smoke appears by type', runItems.some((r) => r.type === 'improve'))
} else {
  console.log('  skip  usage run-type check for improve (set TACIT_SMOKE_SESSION=<session id> to produce one)')
}

const firstRunId = runItems[0]?.runId
const runDetail = firstRunId !== undefined ? await post('/usage-run', { runId: firstRunId }) : { data: null }
check('usage-run: ok', runDetail.data?.ok === true, 'runId=' + firstRunId)
const runAttempts = runDetail.data?.run?.attempts ?? []
check('usage-run: attempts.length >= 1', runAttempts.length >= 1, 'n=' + runAttempts.length)
const TOKEN_BUCKETS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
check('usage-run: every attempt has op/status and usage or is unmetered', runAttempts.every((a) =>
  typeof a?.op === 'string' && typeof a?.status === 'string'
  && (a.status === 'unmetered' || (a.usage !== null && typeof a.usage === 'object' && TOKEN_BUCKETS.every((k) => typeof a.usage[k] === 'number')))))
check('usage-run: priced is null or {usd>=0, source}', runAttempts.every((a) =>
  a?.priced === null || (typeof a?.priced?.usd === 'number' && a.priced.usd >= 0 && typeof a.priced.source === 'string')))

const unknownRun = await post('/usage-run', { runId: 'nope' })
check('usage-run: unknown id → ok:false code:unknown-run', unknownRun.data?.ok === false && unknownRun.data?.code === 'unknown-run')

const badPageSize = await post('/usage', { pageSize: 101 })
check('usage: pageSize > 100 → HTTP 400 bad-request', badPageSize.status === 400 && badPageSize.data?.code === 'bad-request')

const todayAnalysis = await post('/usage', { range: 'today', type: 'analysis' })
check('usage: ok filtering to today + type:analysis', todayAnalysis.data?.ok === true)
const analysisItems = todayAnalysis.data?.runs?.items ?? []
check('usage: every filtered item is type:analysis', analysisItems.every((r) => r.type === 'analysis'), 'n=' + analysisItems.length)

const pricingRefresh = await post('/pricing-refresh', {})
check('pricing-refresh: ok', pricingRefresh.data?.ok === true)
const flashOffPeakCacheMiss = pricingRefresh.data?.pricing?.rates?.['deepseek-v4-flash']?.offPeak?.cacheMiss
if (pricingRefresh.data?.pricing?.source === 'bundled') {
  check('pricing-refresh: bundled deepseek-v4-flash off-peak cacheMiss rate', flashOffPeakCacheMiss === 0.22, 'rate=' + flashOffPeakCacheMiss)
} else {
  console.log('  skip  bundled rate check (pricing source is costMeter) rate=' + flashOffPeakCacheMiss)
}

const beforePreview = await post('/usage', { range: '30d' })
const preview = await post('/bootstrap-preview', { limit: 20 })
check('bootstrap-preview: ok', preview.data?.ok === true)
check('bootstrap-preview: estimate.basis', ['measured', 'doc'].includes(preview.data?.estimate?.basis), 'basis=' + preview.data?.estimate?.basis)
check('bootstrap-preview: estimate.usd is a number', typeof preview.data?.estimate?.usd === 'number', 'usd=' + preview.data?.estimate?.usd)
check('bootstrap-preview: eligible + skipped >= 0', (preview.data?.eligible ?? -1) + (preview.data?.skipped ?? -1) >= 0,
  'eligible=' + preview.data?.eligible + ' skipped=' + preview.data?.skipped)
const afterPreview = await post('/usage', { range: '30d' })
check('bootstrap-preview: no model call (lifetime.attempts unchanged)',
  afterPreview.data?.lifetime?.attempts === beforePreview.data?.lifetime?.attempts,
  'before=' + beforePreview.data?.lifetime?.attempts + ' after=' + afterPreview.data?.lifetime?.attempts)

const usdKnown = typeof usageReport.data?.last30?.usdKnown === 'number' ? usageReport.data.last30.usdKnown : 0
console.log('\nusage: ' + (usageReport.data?.runs?.total ?? 0) + ' runs · $' + usdKnown.toFixed(4) + ' list price · source '
  + (usageReport.data?.pricing?.source ?? '?') + ' · tier ' + (usageReport.data?.pricing?.tierNow ?? '?'))

console.log('\n' + (failures === 0 ? 'SMOKE PASS ✔' : 'SMOKE FAIL ✖ (' + failures + ' checks)'))
process.exit(failures === 0 ? 0 : 1)
