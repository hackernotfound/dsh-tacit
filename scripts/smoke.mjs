// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * Live smoke for Tacit against a RUNNING `dsh web` (http://127.0.0.1:3080).
 * Pure HTTP — the same routes the browser uses. Real model calls (a few
 * flash calls, well under a cent). Uses the real profile/config.
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
if (SESSION_ID.length > 0) {
  const improved = await post('/improve', { sessionId: SESSION_ID, draft: 'write a small node script that prints hello world' })
  check('improve: ok with rewriteId', improved.data?.ok === true && typeof improved.data?.rewriteId === 'string' && improved.data.rewriteId.length > 0,
    'code=' + improved.data?.code + ' ' + (improved.data?.detail ?? ''))
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

console.log('\n' + (failures === 0 ? 'SMOKE PASS ✔' : 'SMOKE FAIL ✖ (' + failures + ' checks)'))
process.exit(failures === 0 ? 0 : 1)
