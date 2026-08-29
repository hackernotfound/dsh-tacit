// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CoachStore, emptyProfile, dayKey } from '../lib/store.js'

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tacit-test-'))
  return { store: new CoachStore(dir), dir }
}

test('config patch round-trips and survives a re-read', () => {
  const { store } = tempStore()
  assert.deepEqual(store.configPatch(), {})
  store.saveConfigPatch({ model: 'deepseek-v4-pro', autoDailyBudget: 5 })
  assert.deepEqual(store.configPatch(), { model: 'deepseek-v4-pro', autoDailyBudget: 5 })
})

test('profile round-trips with defaults filled in', () => {
  const { store } = tempStore()
  const profile = store.profile()
  assert.deepEqual(profile, emptyProfile())
  store.saveProfile({ analyzedCount: 3, patterns: [], updatedAt: 42 })
  const read = store.profile()
  assert.equal(read.analyzedCount, 3)
  assert.equal(read.updatedAt, 42)
})

test('profile v2 fields round-trip and old files get the v2 defaults merged', () => {
  const { store, dir } = tempStore()
  // An OLD v1 profile on disk loads with the new bounded fields defaulted.
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ analyzedCount: 1, patterns: [], updatedAt: 7 }))
  const upgraded = store.profile()
  assert.deepEqual(upgraded.styleRules, [])
  assert.deepEqual(upgraded.feedbackLog, [])
  assert.equal(upgraded.pendingDistill, 0)

  store.saveProfile({
    analyzedCount: 2,
    patterns: [],
    updatedAt: 8,
    styleRules: [{ rule: 'Be specific.', createdAt: 9 }],
    feedbackLog: [{ time: 11, verdict: 'down', reason: 'vague', patternKinds: [] }],
    pendingDistill: 3,
  })
  const read = store.profile()
  assert.equal(read.styleRules[0].rule, 'Be specific.')
  assert.equal(read.pendingDistill, 3)
})

test('reports round-trip per session and turn', () => {
  const { store } = tempStore()
  const report = { ok: true, turn: 2, time: 9, model: 'm', problems: [], improvedPrompt: '', explanation: '' }
  store.saveReport('session-abc', 2, report)
  store.saveReport('session-abc', 5, { ...report, turn: 5 })
  const listed = store.listReports('session-abc')
  assert.equal(listed.length, 2)
  assert.deepEqual(new Set(listed.map((e) => e.turn)), new Set([2, 5]))
  assert.deepEqual(store.report('session-abc', 2), report)
  assert.equal(store.report('session-abc', 99), null)
  assert.equal(store.report('other-session', 2), null)
})

test('session ids are sanitized before touching the filesystem', () => {
  const { store, dir } = tempStore()
  store.saveReport('../../etc/passwd', 1, { ok: true, turn: 1, time: 1, model: 'm', problems: [], improvedPrompt: '', explanation: '' })
  const entries = fs.readdirSync(path.join(dir, 'reports'))
  assert.equal(entries.length, 1)
  assert.ok(entries[0].includes('.._.._etc_passwd'))
  // The file lives inside the store root, never above it.
  const files = fs.readdirSync(path.join(dir, 'reports', entries[0]))
  assert.deepEqual(files, ['1.json'])
})

test('clearReports removes only plugin-named report files', () => {
  const { store, dir } = tempStore()
  const report = { ok: true, turn: 1, time: 1, model: 'm', problems: [], improvedPrompt: '', explanation: '' }
  store.saveReport('s1', 1, report)
  store.saveReport('s1', 2, report)
  store.saveReport('s2', 1, report)
  // Files the plugin did not create (or did not name as reports) must survive.
  const s1Dir = path.join(dir, 'reports', 's1')
  fs.writeFileSync(path.join(s1Dir, 'keep.txt'), 'keep me')
  fs.writeFileSync(path.join(s1Dir, '10.json.bak'), 'backup')
  fs.writeFileSync(path.join(dir, 'config.patch.json'), '{}')
  // A usage day file must never be touched by clearReports — only clearUsage()
  // (and day expiry) may ever remove a file under usage/.
  fs.mkdirSync(path.join(dir, 'usage'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'usage', '2026-01-01.json'), JSON.stringify({ version: 1, day: '2026-01-01', runs: [] }))

  const removed = store.clearReports()
  assert.equal(removed, 3)
  assert.deepEqual(store.listReports('s1'), [])
  assert.deepEqual(store.listReports('s2'), [])
  assert.equal(fs.readFileSync(path.join(s1Dir, 'keep.txt'), 'utf8'), 'keep me')
  assert.equal(fs.readFileSync(path.join(s1Dir, '10.json.bak'), 'utf8'), 'backup')
  assert.equal(fs.readFileSync(path.join(dir, 'config.patch.json'), 'utf8'), '{}')
  assert.ok(fs.existsSync(path.join(dir, 'usage', '2026-01-01.json')))
})

test('clearReports is a no-op when the reports directory is absent', () => {
  const { store } = tempStore()
  assert.equal(store.clearReports(), 0)
})

test('listAllReports merges sessions, sorts newest first, and caps the list', () => {
  const { store } = tempStore()
  store.saveReport('s1', 1, { ok: true, turn: 1, time: 100, model: 'm', problems: [], improvedPrompt: 'a', explanation: '', promptExcerpt: 'excerpt one' })
  store.saveReport('s2', 3, { ok: true, turn: 3, time: 300, model: 'm', problems: [], improvedPrompt: 'c', explanation: '', promptExcerpt: 'excerpt three' })
  store.saveReport('s1', 2, { ok: true, turn: 2, time: 200, model: 'm', problems: [], improvedPrompt: 'b', explanation: '' })

  const all = store.listAllReports(10)
  assert.equal(all.length, 3)
  assert.deepEqual(all.map((e) => e.time), [300, 200, 100])
  assert.equal(all[0].sessionId, 's2')
  assert.equal(all[0].promptExcerpt, 'excerpt three')

  const capped = store.listAllReports(2)
  assert.equal(capped.length, 2)

  // Old reports without the excerpt field are tolerated.
  assert.equal(all[1].promptExcerpt, '')
})

// ── Usage ledger storage ────────────────────────────────────────────────────

function captureWarn(fn) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    fn()
  } finally {
    console.warn = original
  }
  return warnings
}

test('dayKey (moved from service.js) yields a local YYYY-MM-DD key', () => {
  const local = new Date(2026, 7, 30, 15, 0, 0) // August 30 2026, local time
  assert.equal(dayKey(local.getTime()), '2026-08-30')
  assert.match(dayKey(), /^\d{4}-\d{2}-\d{2}$/)
})

test('usageDir points at <root>/usage', () => {
  const { store, dir } = tempStore()
  assert.equal(store.usageDir(), path.join(dir, 'usage'))
})

test('usageDayFile rejects a day that is not YYYY-MM-DD', () => {
  const { store } = tempStore()
  assert.throws(() => store.usageDayFile('2026-1-1'))
  assert.throws(() => store.usageDayFile('not-a-day'))
  assert.throws(() => store.usageDayFile('2026-08-30.json'))
  assert.doesNotThrow(() => store.usageDayFile('2026-08-30'))
})

test('usage day file round-trips and readUsageDay defaults an absent day without warning', () => {
  const { store } = tempStore()
  const warnings = captureWarn(() => {
    assert.deepEqual(store.readUsageDay('2026-08-30'), { version: 1, day: '2026-08-30', runs: [] })
  })
  assert.equal(warnings.length, 0)

  const run = { runId: 'u1', type: 'analysis', startedAt: 1000 }
  store.writeUsageDay('2026-08-30', { version: 1, day: '2026-08-30', runs: [run] })
  const read = store.readUsageDay('2026-08-30')
  assert.equal(read.runs.length, 1)
  assert.equal(read.runs[0].runId, 'u1')
  assert.equal(read.runs[0].status, 'running')
})

test('writeUsageDay caps runs to the newest 500 by startedAt', () => {
  const { store } = tempStore()
  const runs = Array.from({ length: 520 }, (_, i) => ({ runId: 'u' + i, type: 'analysis', startedAt: i }))
  store.writeUsageDay('2026-08-30', { version: 1, day: '2026-08-30', runs })
  const read = store.readUsageDay('2026-08-30')
  assert.equal(read.runs.length, 500)
  assert.equal(read.runs[0].startedAt, 20)
  assert.equal(read.runs[read.runs.length - 1].startedAt, 519)
})

test('listUsageDays ignores atomic-write temp files, non-day files, and malformed dates; returns sorted keys', () => {
  const { store, dir } = tempStore()
  const usageDir = path.join(dir, 'usage')
  fs.mkdirSync(usageDir, { recursive: true })
  fs.writeFileSync(path.join(usageDir, '2026-08-30.json'), '{}')
  fs.writeFileSync(path.join(usageDir, '2026-01-05.json'), '{}')
  fs.writeFileSync(path.join(usageDir, '2026-01-01.json.tmp-1-2'), '{}')
  fs.writeFileSync(path.join(usageDir, 'notes.txt'), 'x')
  fs.writeFileSync(path.join(usageDir, '2026-1-1.json'), '{}')
  fs.writeFileSync(path.join(usageDir, 'summary.json'), '{}')
  assert.deepEqual(store.listUsageDays(), ['2026-01-05', '2026-08-30'])
})

test('listUsageDays returns [] when the usage directory is absent', () => {
  const { store } = tempStore()
  assert.deepEqual(store.listUsageDays(), [])
})

test('pruneUsageDays removes day files strictly before today - keepDays, string-compared', () => {
  const { store, dir } = tempStore()
  const usageDir = path.join(dir, 'usage')
  fs.mkdirSync(usageDir, { recursive: true })
  for (const day of ['2026-08-20', '2026-08-23', '2026-08-29']) {
    fs.writeFileSync(path.join(usageDir, day + '.json'), JSON.stringify({ version: 1, day, runs: [] }))
  }
  fs.writeFileSync(path.join(usageDir, 'summary.json'), '{}')
  fs.writeFileSync(path.join(usageDir, 'keep.txt'), 'x')

  const removed = store.pruneUsageDays(7, '2026-08-30')
  assert.equal(removed, 1)
  assert.deepEqual(store.listUsageDays(), ['2026-08-23', '2026-08-29'])
  assert.ok(fs.existsSync(path.join(usageDir, 'summary.json')))
  assert.ok(fs.existsSync(path.join(usageDir, 'keep.txt')))
})

test('pruneUsageDays defaults `today` to dayKey()', () => {
  const { store } = tempStore()
  assert.equal(store.pruneUsageDays(7), 0)
})

test('pruneUsageDays swallows a per-file unlink failure and keeps pruning the rest', () => {
  const { store, dir } = tempStore()
  const usageDir = path.join(dir, 'usage')
  fs.mkdirSync(usageDir, { recursive: true })
  // A directory masquerading as a day file: unlinkSync on it throws (EISDIR/EPERM).
  // One unremovable entry must not stop the rest of the prune sweep.
  fs.mkdirSync(path.join(usageDir, '2026-08-19.json'))
  fs.writeFileSync(path.join(usageDir, '2026-08-20.json'), JSON.stringify({ version: 1, day: '2026-08-20', runs: [] }))

  const removed = store.pruneUsageDays(7, '2026-08-30')
  assert.equal(removed, 1) // only the real file was unlinked
  assert.deepEqual(store.listUsageDays(), ['2026-08-19']) // the directory survives the failed unlink
})

test('a corrupt usage day file on disk falls back to a fresh object with a single warning', () => {
  const { store, dir } = tempStore()
  const usageDir = path.join(dir, 'usage')
  fs.mkdirSync(usageDir, { recursive: true })
  fs.writeFileSync(path.join(usageDir, '2026-08-30.json'), 'not json{')

  let first, second
  const warnings = captureWarn(() => {
    first = store.readUsageDay('2026-08-30')
    second = store.readUsageDay('2026-08-30')
  })
  assert.deepEqual(first, { version: 1, day: '2026-08-30', runs: [] })
  assert.deepEqual(second, { version: 1, day: '2026-08-30', runs: [] })
  assert.equal(warnings.length, 1)
})

test('a schema-invalid usage day file (valid JSON, wrong shape) also warns once and falls back', () => {
  const { store, dir } = tempStore()
  const usageDir = path.join(dir, 'usage')
  fs.mkdirSync(usageDir, { recursive: true })
  fs.writeFileSync(path.join(usageDir, '2026-08-30.json'), JSON.stringify({ version: 2, day: '2026-08-30' }))

  let read
  const warnings = captureWarn(() => {
    read = store.readUsageDay('2026-08-30')
    store.readUsageDay('2026-08-30')
  })
  assert.deepEqual(read, { version: 1, day: '2026-08-30', runs: [] })
  assert.equal(warnings.length, 1)
})

test('readUsageSummary defaults an absent summary without warning', () => {
  const { store } = tempStore()
  let summary
  const warnings = captureWarn(() => {
    summary = store.readUsageSummary()
  })
  assert.equal(warnings.length, 0)
  assert.equal(summary.version, 1)
  assert.ok(typeof summary.trackingSince === 'number' && summary.trackingSince > 0)
  assert.deepEqual(summary.byModel, {})
  assert.deepEqual(summary.byType, {})
  assert.deepEqual(summary.days, {})
})

test('a corrupt usage summary falls back to a fresh object with a single warning', () => {
  const { store, dir } = tempStore()
  const usageDir = path.join(dir, 'usage')
  fs.mkdirSync(usageDir, { recursive: true })
  fs.writeFileSync(path.join(usageDir, 'summary.json'), '{ bad json')

  let first, second
  const warnings = captureWarn(() => {
    first = store.readUsageSummary()
    second = store.readUsageSummary()
  })
  assert.equal(first.version, 1)
  assert.equal(second.version, 1)
  assert.equal(warnings.length, 1)
})

test('writeUsageSummary round-trips', () => {
  const { store } = tempStore()
  store.writeUsageSummary({ version: 1, trackingSince: 5, lifetime: {}, byType: {}, byModel: {}, days: {} })
  const read = store.readUsageSummary()
  assert.equal(read.trackingSince, 5)
})

test('clearUsage removes only matching day files, writes a fresh summary, and never touches reports/profile/other usage files', () => {
  const { store, dir } = tempStore()
  const usageDir = path.join(dir, 'usage')
  fs.mkdirSync(usageDir, { recursive: true })
  fs.writeFileSync(path.join(usageDir, '2026-08-20.json'), JSON.stringify({ version: 1, day: '2026-08-20', runs: [] }))
  fs.writeFileSync(path.join(usageDir, '2026-08-29.json'), JSON.stringify({ version: 1, day: '2026-08-29', runs: [] }))
  fs.writeFileSync(path.join(usageDir, 'keep.txt'), 'keep me')
  store.saveReport('s1', 1, { ok: true, turn: 1, time: 1, model: 'm', problems: [], improvedPrompt: '', explanation: '' })
  store.saveProfile({ analyzedCount: 1, patterns: [], updatedAt: 1 })

  const before = Date.now()
  const result = store.clearUsage()
  assert.equal(result.removed, 2)
  assert.deepEqual(store.listUsageDays(), [])
  assert.ok(fs.existsSync(path.join(usageDir, 'keep.txt')))
  assert.equal(store.report('s1', 1).turn, 1)
  assert.equal(store.profile().analyzedCount, 1)
  assert.ok(fs.existsSync(path.join(dir, 'reports')))
  const summary = store.readUsageSummary()
  assert.ok(summary.trackingSince >= before)
})
