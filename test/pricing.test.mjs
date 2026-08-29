// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICES_AS_OF,
  REASONING_BILLED_SEPARATELY,
  OFFICIAL_PROVIDERS,
  BUNDLED_PRICES,
  PEAK_WINDOWS_UTC,
  WEEKEND_OFFPEAK_FROM,
  isBeijingWeekend,
  tierAt,
  isOfficialRoute,
  ratesFor,
  costOf,
  priceCall,
  normalizeCostMeterState,
} from '../lib/pricing.js'

const weekday = (h, m = 0) => Date.UTC(2026, 8, 2, h, m) // Wednesday 2026-09-02

// ── module shape ─────────────────────────────────────────────────────────

test('module constants match the spec', () => {
  assert.equal(PRICES_AS_OF, '2026-08-22')
  assert.equal(REASONING_BILLED_SEPARATELY, false)
  assert.deepEqual(OFFICIAL_PROVIDERS, ['deepseek-official', 'deepseek'])
  assert.equal(WEEKEND_OFFPEAK_FROM, Date.parse('2026-08-22T16:00:00Z'))
  assert.deepEqual(PEAK_WINDOWS_UTC, [{ start: 1, end: 4 }, { start: 6, end: 10 }])
})

// ── isOfficialRoute ──────────────────────────────────────────────────────

test('isOfficialRoute recognizes both official provider ids', () => {
  assert.equal(isOfficialRoute('deepseek-official'), true)
  assert.equal(isOfficialRoute('deepseek'), true)
  assert.equal(isOfficialRoute('some-proxy'), false)
  assert.equal(isOfficialRoute(undefined), false)
})

// ── isBeijingWeekend ─────────────────────────────────────────────────────

test('isBeijingWeekend shifts by +8h and checks Sat/Sun', () => {
  // Wednesday 2026-09-02 UTC noon stays a weekday after +8h shift.
  assert.equal(isBeijingWeekend(Date.UTC(2026, 8, 2, 12, 0, 0)), false)
  // Friday 2026-09-04T17:00Z + 8h = Saturday 01:00 Beijing.
  assert.equal(isBeijingWeekend(Date.UTC(2026, 8, 4, 17, 0, 0)), true)
  // Saturday 2026-08-29T02:00Z + 8h = Saturday 10:00 Beijing.
  assert.equal(isBeijingWeekend(Date.UTC(2026, 7, 29, 2, 0, 0)), true)
})

// ── tierAt: hour-window boundaries on a plain weekday ───────────────────

test('tierAt: hour-window boundaries on a weekday', () => {
  const cases = [
    [[0, 59], 'offPeak'],
    [[1, 0], 'peak'],
    [[3, 59], 'peak'],
    [[4, 0], 'offPeak'],
    [[5, 59], 'offPeak'],
    [[6, 0], 'peak'],
    [[9, 59], 'peak'],
    [[10, 0], 'offPeak'],
  ]
  for (const [[h, m], expected] of cases) {
    assert.equal(tierAt(weekday(h, m)), expected, `${h}:${m} should be ${expected}`)
  }
})

test('tierAt: Beijing weekend after the cutoff forces offPeak even in a peak window', () => {
  // Saturday 2026-08-29T02:00Z: hour 2 is inside [1,4) and after WEEKEND_OFFPEAK_FROM.
  const ms = Date.UTC(2026, 7, 29, 2, 0, 0)
  assert.ok(ms >= WEEKEND_OFFPEAK_FROM)
  assert.equal(tierAt(ms), 'offPeak')
})

test('tierAt: Friday 17:00 UTC (Saturday 01:00 Beijing) is offPeak', () => {
  const ms = Date.UTC(2026, 8, 4, 17, 0, 0)
  assert.equal(tierAt(ms), 'offPeak')
})

test('tierAt: the same weekday-hour pattern before the cutoff still follows the window (peak)', () => {
  // Saturday 2026-08-15T02:00Z: same hour-2/Saturday pattern, but before WEEKEND_OFFPEAK_FROM.
  const ms = Date.UTC(2026, 7, 15, 2, 0, 0)
  assert.ok(ms < WEEKEND_OFFPEAK_FROM)
  assert.equal(tierAt(ms), 'peak')
})

test('tierAt: peakEnabled false forces offPeak regardless of hour', () => {
  assert.equal(tierAt(weekday(2, 0), { peakEnabled: false }), 'offPeak')
})

test('tierAt: ms before effectiveAtMs forces offPeak', () => {
  const ms = weekday(2, 0)
  assert.equal(tierAt(ms, { effectiveAtMs: ms + 1 }), 'offPeak')
  assert.equal(tierAt(ms, { effectiveAtMs: ms }), 'peak')
})

// ── bundled pricing: exact numbers ──────────────────────────────────────

const usage1M = { inputTokens: 1000000, outputTokens: 1000000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }

test('bundled prices: both models at both tiers give the exact list numbers', () => {
  const peakMs = weekday(2, 0) // inside [1,4) -> peak
  const offPeakMs = weekday(0, 0) // outside any window -> offPeak

  const flashOffPeak = priceCall({ model: 'deepseek-v4-flash', provider: 'deepseek-official', atMs: offPeakMs, usage: usage1M })
  assert.equal(flashOffPeak.source, 'bundled')
  assert.equal(flashOffPeak.tier, 'offPeak')
  assert.deepEqual(flashOffPeak.rates, { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 })
  assert.equal(flashOffPeak.usd, 0.88)
  assert.equal(flashOffPeak.asOf, PRICES_AS_OF)

  const flashPeak = priceCall({ model: 'deepseek-v4-flash', provider: 'deepseek-official', atMs: peakMs, usage: usage1M })
  assert.equal(flashPeak.tier, 'peak')
  assert.deepEqual(flashPeak.rates, { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 })
  assert.equal(flashPeak.usd, 1.76)

  const proOffPeak = priceCall({ model: 'deepseek-v4-pro', provider: 'deepseek-official', atMs: offPeakMs, usage: usage1M })
  assert.equal(proOffPeak.tier, 'offPeak')
  assert.deepEqual(proOffPeak.rates, { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 })
  assert.equal(proOffPeak.usd, 2.64)

  const proPeak = priceCall({ model: 'deepseek-v4-pro', provider: 'deepseek-official', atMs: peakMs, usage: usage1M })
  assert.equal(proPeak.tier, 'peak')
  assert.deepEqual(proPeak.rates, { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 })
  assert.equal(proPeak.usd, 5.28)
})

// ── ratesFor / priceCall resolution and misses ──────────────────────────

test('unknown provider yields null', () => {
  assert.equal(ratesFor({ model: 'deepseek-v4-flash', provider: 'some-proxy', atMs: weekday(0) }), null)
  assert.equal(priceCall({ model: 'deepseek-v4-flash', provider: 'some-proxy', atMs: weekday(0), usage: usage1M }), null)
})

test('unknown model on the official route yields null', () => {
  assert.equal(ratesFor({ model: 'deepseek-v4-ultra', provider: 'deepseek-official', atMs: weekday(0) }), null)
})

test('costMeter table overrides the bundled numbers', () => {
  const table = {
    models: {
      'deepseek-v4-flash': {
        offPeak: { cacheHit: 1, cacheMiss: 2, output: 3 },
        peak: { cacheHit: 4, cacheMiss: 5, output: 6 },
      },
    },
    providers: {},
    windows: PEAK_WINDOWS_UTC,
    effectiveAtMs: 0,
    peakEnabled: true,
    asOf: '2026-08-01T00:00:00.000Z',
  }
  const peak = ratesFor({ model: 'deepseek-v4-flash', provider: 'deepseek-official', atMs: weekday(2, 0), table })
  assert.equal(peak.source, 'costMeter')
  assert.equal(peak.tier, 'peak')
  assert.deepEqual(peak.rates, { cacheHit: 4, cacheMiss: 5, output: 6 })
  assert.equal(peak.asOf, '2026-08-01T00:00:00.000Z')

  const offPeak = ratesFor({ model: 'deepseek-v4-flash', provider: 'deepseek-official', atMs: weekday(0, 0), table })
  assert.equal(offPeak.tier, 'offPeak')
  assert.deepEqual(offPeak.rates, { cacheHit: 1, cacheMiss: 2, output: 3 })
})

test('a malformed costMeter table falls back to bundled pricing', () => {
  const malformedTables = [
    {},
    { models: 'nope' },
    { models: { 'deepseek-v4-flash': { cacheHit: 1 } } }, // missing offPeak/peak, not a flat triple either
    { models: null, providers: null },
    'not even an object',
    42,
  ]
  for (const table of malformedTables) {
    const result = ratesFor({ model: 'deepseek-v4-flash', provider: 'deepseek-official', atMs: weekday(0, 0), table })
    assert.equal(result.source, 'bundled')
    assert.equal(result.tier, 'offPeak')
  }
})

test('a flat provider table entry prices with tier "flat"', () => {
  const table = {
    models: {},
    providers: {
      'custom-provider': {
        'deepseek-v4-flash': { cacheHit: 0.5, cacheMiss: 1.5, output: 2.5 },
      },
    },
    windows: PEAK_WINDOWS_UTC,
    effectiveAtMs: 0,
    peakEnabled: true,
    asOf: '2026-08-01T00:00:00.000Z',
  }
  const priced = priceCall({ model: 'deepseek-v4-flash', provider: 'custom-provider', atMs: weekday(2, 0), usage: usage1M, table })
  assert.equal(priced.source, 'costMeter')
  assert.equal(priced.tier, 'flat')
  assert.deepEqual(priced.rates, { cacheHit: 0.5, cacheMiss: 1.5, output: 2.5 })
  // (1e6 * 1.5 + 0 + 1e6 * 2.5) / 1e6
  assert.equal(priced.usd, 4)
})

// ── costOf ────────────────────────────────────────────────────────────

test('costOf: reasoningTokens (subset of outputTokens) is not double-billed', () => {
  const rates = { cacheHit: 1, cacheMiss: 2, output: 3 }
  const withReasoning = costOf({ inputTokens: 0, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 40 }, rates)
  const withoutReasoningField = costOf({ inputTokens: 0, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, rates)
  assert.equal(withReasoning, (100 * 3) / 1e6)
  assert.equal(withReasoning, withoutReasoningField)
})

test('costOf: cacheRead and cacheWrite both bill at the cache-hit rate', () => {
  const rates = { cacheHit: 1, cacheMiss: 2, output: 3 }
  const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 }
  const expected = (10 * 2 + (7 + 3) * 1 + 5 * 3) / 1e6
  assert.equal(costOf(usage, rates), expected)
})

// ── fresh copies ─────────────────────────────────────────────────────────

test('mutating a returned rates object does not alter BUNDLED_PRICES', () => {
  const priced = ratesFor({ model: 'deepseek-v4-flash', provider: 'deepseek-official', atMs: weekday(0, 0) })
  priced.rates.cacheHit = 999999
  assert.equal(BUNDLED_PRICES['deepseek-v4-flash'].offPeak.cacheHit, 0.007)
})

// ── normalizeCostMeterState ──────────────────────────────────────────────

test('normalizeCostMeterState: non-object input yields null', () => {
  assert.equal(normalizeCostMeterState(null), null)
  assert.equal(normalizeCostMeterState(undefined), null)
  assert.equal(normalizeCostMeterState(42), null)
  assert.equal(normalizeCostMeterState('nope'), null)
})

test('normalizeCostMeterState: accepts state.config or a bare config root', () => {
  const rawConfig = {
    prices: {
      currency: 'USD',
      models: { 'deepseek-v4-flash': { cacheHit: 0.01, cacheMiss: 0.2, output: 0.6 } },
      providers: {},
    },
    peakEnabled: true,
    peakWindows: [{ start: 1, end: 4 }],
    peakEffectiveAt: 0,
    exchangeRate: 7.2,
  }
  const wrapped = normalizeCostMeterState({ someOtherField: 'x', config: rawConfig })
  const bare = normalizeCostMeterState(rawConfig)
  assert.deepEqual(wrapped.models, bare.models)
  assert.deepEqual(wrapped.models['deepseek-v4-flash'], { offPeak: { cacheHit: 0.01, cacheMiss: 0.2, output: 0.6 }, peak: { cacheHit: 0.01, cacheMiss: 0.2, output: 0.6 } })
})

test('normalizeCostMeterState: a model entry with offPeak/peak sub-objects is kept as-is', () => {
  const state = {
    prices: {
      currency: 'USD',
      models: {
        'deepseek-v4-pro': {
          offPeak: { cacheHit: 0.02, cacheMiss: 0.6, output: 1.9 },
          peak: { cacheHit: 0.04, cacheMiss: 1.3, output: 3.9 },
        },
      },
    },
  }
  const normalized = normalizeCostMeterState(state)
  assert.deepEqual(normalized.models['deepseek-v4-pro'], {
    offPeak: { cacheHit: 0.02, cacheMiss: 0.6, output: 1.9 },
    peak: { cacheHit: 0.04, cacheMiss: 1.3, output: 3.9 },
  })
})

test('normalizeCostMeterState: a provider entry {input, cachedInput, output} converts to {cacheMiss, cacheHit, output}', () => {
  const state = {
    prices: {
      currency: 'USD',
      providers: {
        'custom-provider': {
          models: {
            'deepseek-v4-flash': { input: 0.3, cachedInput: 0.1, output: 0.9 },
            'deepseek-v4-pro': { input: 0.5, output: 1.5 }, // no cachedInput -> falls back to input
          },
        },
      },
    },
  }
  const normalized = normalizeCostMeterState(state)
  assert.deepEqual(normalized.providers['custom-provider']['deepseek-v4-flash'], { cacheMiss: 0.3, cacheHit: 0.1, output: 0.9 })
  assert.deepEqual(normalized.providers['custom-provider']['deepseek-v4-pro'], { cacheMiss: 0.5, cacheHit: 0.5, output: 1.5 })
})

test('normalizeCostMeterState: CNY prices are divided by exchangeRate', () => {
  const state = {
    prices: {
      currency: 'CNY',
      models: { 'deepseek-v4-flash': { cacheHit: 7.2, cacheMiss: 14.4, output: 21.6 } },
    },
    exchangeRate: 7.2,
  }
  const normalized = normalizeCostMeterState(state)
  assert.deepEqual(normalized.models['deepseek-v4-flash'].offPeak, { cacheHit: 1, cacheMiss: 2, output: 3 })
})

test('normalizeCostMeterState: CNY defaults to exchangeRate 7.2 when none/invalid is given', () => {
  const state = {
    prices: {
      currency: 'CNY',
      models: { 'deepseek-v4-flash': { cacheHit: 7.2, cacheMiss: 14.4, output: 21.6 } },
    },
    exchangeRate: -1, // invalid -> default
  }
  const normalized = normalizeCostMeterState(state)
  assert.deepEqual(normalized.models['deepseek-v4-flash'].offPeak, { cacheHit: 1, cacheMiss: 2, output: 3 })
})

test('normalizeCostMeterState: non-finite or negative numbers drop the entry', () => {
  const state = {
    prices: {
      currency: 'USD',
      models: {
        bad1: { cacheHit: NaN, cacheMiss: 1, output: 1 },
        bad2: { cacheHit: -1, cacheMiss: 1, output: 1 },
        bad3: { cacheHit: Infinity, cacheMiss: 1, output: 1 },
        good: { cacheHit: 0.01, cacheMiss: 0.2, output: 0.6 },
      },
    },
  }
  const normalized = normalizeCostMeterState(state)
  assert.equal(normalized.models.bad1, undefined)
  assert.equal(normalized.models.bad2, undefined)
  assert.equal(normalized.models.bad3, undefined)
  assert.ok(normalized.models.good)
})

test('normalizeCostMeterState: asOf is a fresh ISO timestamp', () => {
  const before = Date.now()
  const normalized = normalizeCostMeterState({ prices: {} })
  const parsed = Date.parse(normalized.asOf)
  assert.ok(Number.isFinite(parsed))
  assert.ok(parsed >= before)
})

test('normalizeCostMeterState: missing windows/peakEnabled/effectiveAt fall back to sane defaults', () => {
  const normalized = normalizeCostMeterState({ prices: {} })
  assert.deepEqual(normalized.windows, PEAK_WINDOWS_UTC)
  assert.equal(normalized.peakEnabled, true)
  assert.equal(normalized.effectiveAtMs, 0)
})
