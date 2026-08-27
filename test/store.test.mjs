// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CoachStore, emptyProfile } from '../lib/store.js'

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

  const removed = store.clearReports()
  assert.equal(removed, 3)
  assert.deepEqual(store.listReports('s1'), [])
  assert.deepEqual(store.listReports('s2'), [])
  assert.equal(fs.readFileSync(path.join(s1Dir, 'keep.txt'), 'utf8'), 'keep me')
  assert.equal(fs.readFileSync(path.join(s1Dir, '10.json.bak'), 'utf8'), 'backup')
  assert.equal(fs.readFileSync(path.join(dir, 'config.patch.json'), 'utf8'), '{}')
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
