// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeConfig } from '../lib/service.js'

// ── mergeConfig: the three usage-ledger config keys ────────────────────────
// (Task 3 adds `costHistoryDays`/`costWarnDailyUsd`/`costWarnMonthlyUsd` to
// Config/configPatchSchema; the clamps below live in mergeConfig itself, in
// the same style as every other numeric field in this function.)

test('mergeConfig: costHistoryDays clamps to [7, 365], rounds, and defaults to 30', () => {
  assert.equal(mergeConfig({}, {}).costHistoryDays, 30)
  assert.equal(mergeConfig({}, { costHistoryDays: 3 }).costHistoryDays, 7)
  assert.equal(mergeConfig({}, { costHistoryDays: 1000 }).costHistoryDays, 365)
  assert.equal(mergeConfig({}, { costHistoryDays: 45.6 }).costHistoryDays, 46)
  assert.equal(mergeConfig({}, { costHistoryDays: 90 }).costHistoryDays, 90)
  // The UI-written patch wins over the loader/YAML base.
  assert.equal(mergeConfig({ costHistoryDays: 60 }, { costHistoryDays: 10 }).costHistoryDays, 10)
})

test('mergeConfig: costWarnDailyUsd clamps to [0, 10000]; 0 means "off" and defaults to 0', () => {
  assert.equal(mergeConfig({}, {}).costWarnDailyUsd, 0)
  assert.equal(mergeConfig({}, { costWarnDailyUsd: 0 }).costWarnDailyUsd, 0)
  assert.equal(mergeConfig({}, { costWarnDailyUsd: -5 }).costWarnDailyUsd, 0)
  assert.equal(mergeConfig({}, { costWarnDailyUsd: 50000 }).costWarnDailyUsd, 10000)
  assert.equal(mergeConfig({}, { costWarnDailyUsd: 12.5 }).costWarnDailyUsd, 12.5)
})

test('mergeConfig: costWarnMonthlyUsd clamps the same way as costWarnDailyUsd', () => {
  assert.equal(mergeConfig({}, {}).costWarnMonthlyUsd, 0)
  assert.equal(mergeConfig({}, { costWarnMonthlyUsd: 0 }).costWarnMonthlyUsd, 0)
  assert.equal(mergeConfig({}, { costWarnMonthlyUsd: -5 }).costWarnMonthlyUsd, 0)
  assert.equal(mergeConfig({}, { costWarnMonthlyUsd: 50000 }).costWarnMonthlyUsd, 10000)
  assert.equal(mergeConfig({}, { costWarnMonthlyUsd: 250 }).costWarnMonthlyUsd, 250)
})

/**
 * A non-numeric value for ANY numeric Config field (not specific to the
 * three new ones) fails `Config.parse`'s strict `z.number()` type check
 * before mergeConfig's own clamp line ever runs — `Config.parse` is a
 * throwing `.parse()`, not a `.safeParse()`, and zod v4's `z.number()`
 * accepts neither strings nor NaN/Infinity. Verified here against both an
 * existing field (`maxKeptTurns`) and the new ones, so the two new clamps
 * are not held to a different standard than the rest of the function.
 * (In production this can only be reached from a hand-edited
 * `config.patch.json`, since the `/config` route validates patches with
 * `configArgSchema` — same `z.number()` — before they ever reach
 * `mergeConfig`.)
 */
test('mergeConfig: a wrong-typed field throws via Config.parse, same as every other numeric field', () => {
  assert.throws(() => mergeConfig({}, { maxKeptTurns: 'abc' }), /number/i)
  assert.throws(() => mergeConfig({}, { costWarnDailyUsd: 'abc' }), /number/i)
  assert.throws(() => mergeConfig({}, { costWarnMonthlyUsd: 'abc' }), /number/i)
  assert.throws(() => mergeConfig({}, { costHistoryDays: 'abc' }), /number/i)
})
