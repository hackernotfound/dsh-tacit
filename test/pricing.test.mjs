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
import { COACH_MODELS } from '../lib/schema.js'
import { createPricingSource } from '../lib/pricing-source.js'

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

test('isOfficialRoute matches a provider id whatever its case', () => {
  // A harness or proxy reporting 'DeepSeek-Official' must still be priced —
  // an exact match would silently count every one of its calls as unpriced.
  assert.equal(isOfficialRoute('DeepSeek-Official'), true)
  assert.equal(isOfficialRoute('DeepSeek'), true)
  assert.equal(isOfficialRoute('DEEPSEEK'), true)
  assert.equal(isOfficialRoute('Some-Proxy'), false)
  assert.equal(isOfficialRoute(42), false)
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

test('a provider table is matched whatever case either side spells the id in', () => {
  // The cost-meter table is a foreign, duck-typed schema: its provider keys are
  // whatever that plugin's user typed. A casing mismatch must not silently drop
  // the call through to bundled pricing (or to unpriced).
  const normalized = normalizeCostMeterState({
    prices: {
      currency: 'USD',
      providers: { OpenRouter: { models: { 'deepseek-v4-flash': { input: 1, cachedInput: 0.5, output: 2 } } } },
    },
  })
  assert.deepEqual(Object.keys(normalized.providers), ['openrouter'], 'the normalized keys are case-folded')

  for (const provider of ['openrouter', 'OpenRouter', 'OPENROUTER']) {
    const found = ratesFor({ model: 'deepseek-v4-flash', provider, atMs: weekday(12), table: normalized })
    assert.equal(found?.source, 'costMeter', provider)
    assert.equal(found?.tier, 'flat', provider)
    assert.deepEqual(found?.rates, { cacheMiss: 1, cacheHit: 0.5, output: 2 }, provider)
  }
  assert.equal(ratesFor({ model: 'deepseek-v4-flash', provider: 'other-proxy', atMs: weekday(12), table: normalized }), null)
})

test('normalizeCostMeterState: provider keys that differ only by case merge, first one wins', () => {
  const normalized = normalizeCostMeterState({
    prices: {
      currency: 'USD',
      providers: {
        OpenRouter: { models: { 'deepseek-v4-flash': { input: 1, cachedInput: 0.5, output: 2 } } },
        openrouter: { models: { 'deepseek-v4-flash': { input: 9, cachedInput: 9, output: 9 } } },
      },
    },
  })
  assert.deepEqual(Object.keys(normalized.providers), ['openrouter'])
  assert.deepEqual(normalized.providers.openrouter['deepseek-v4-flash'], { cacheMiss: 1, cacheHit: 0.5, output: 2 })
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

test('normalizeCostMeterState: peakEffectiveAt is accepted as an ISO string as well as epoch ms', () => {
  const iso = '2026-08-22T16:00:00Z'
  assert.equal(normalizeCostMeterState({ prices: {}, peakEffectiveAt: iso }).effectiveAtMs, Date.parse(iso))
  assert.equal(normalizeCostMeterState({ prices: {}, peakEffectiveAt: 1234 }).effectiveAtMs, 1234)
  assert.equal(normalizeCostMeterState({ prices: {}, peakEffectiveAt: 'not a date' }).effectiveAtMs, 0)
  assert.equal(normalizeCostMeterState({ prices: {}, peakEffectiveAt: null }).effectiveAtMs, 0)
})

test('normalizeCostMeterState: a peakWindows array that filters down to nothing falls back to the bundled windows', () => {
  const junk = normalizeCostMeterState({ prices: {}, peakWindows: [{ start: 'x', end: 4 }, null, 7] })
  assert.deepEqual(junk.windows, PEAK_WINDOWS_UTC, 'no usable window is the same as none given')
  assert.deepEqual(normalizeCostMeterState({ prices: {}, peakWindows: [] }).windows, PEAK_WINDOWS_UTC)
  assert.deepEqual(normalizeCostMeterState({ prices: {}, peakWindows: [{ start: 2, end: 3 }] }).windows, [{ start: 2, end: 3 }])
})

// ── pricing source (lib/pricing-source.js) ───────────────────────────────

const costMeterState = {
  peakEnabled: true,
  peakWindows: [{ start: 1, end: 4 }],
  peakEffectiveAt: 0,
  config: {
    prices: {
      currency: 'USD',
      models: {
        'deepseek-v4-flash': {
          offPeak: { cacheHit: 0.01, cacheMiss: 0.3, output: 0.9 },
          peak: { cacheHit: 0.02, cacheMiss: 0.6, output: 1.8 },
        },
      },
      providers: { 'my-proxy': { models: { 'deepseek-v4-flash': { input: 1, cachedInput: 0.5, output: 2 } } } },
    },
  },
}

/** A ctx double exposing (or hiding) a `costMeter` service. */
function ctxWith(service) {
  return { get: (name) => (name === 'costMeter' ? service : undefined) }
}

test('pricing source: no costMeter service → bundled prices', async () => {
  const source = createPricingSource(ctxWith(undefined), { now: () => weekday(12) })
  assert.deepEqual(source.status(), { source: 'bundled', asOf: PRICES_AS_OF, refreshedAt: 0, tierNow: 'offPeak', error: '' })
  await source.refresh()
  const status = source.status()
  assert.equal(status.source, 'bundled')
  assert.equal(status.refreshedAt, 0)
  assert.ok(status.error.length > 0, 'the absent service is reported, not hidden')
  assert.equal(source.priceCall({ model: 'deepseek-v4-flash', provider: 'deepseek', atMs: weekday(12), usage: { inputTokens: 1e6 } }).source, 'bundled')
})

test('pricing source: a ctx without get() never throws', async () => {
  const source = createPricingSource({}, { now: () => weekday(12) })
  await source.refresh()
  assert.equal(source.status().source, 'bundled')
})

test('pricing source: a valid costMeter state becomes the snapshot', async () => {
  const now = () => weekday(2) // inside the table's 01:00-04:00 peak window
  const source = createPricingSource(ctxWith({ getState: () => costMeterState }), { now })
  await source.refresh()
  const status = source.status()
  assert.equal(status.source, 'costMeter')
  assert.equal(status.refreshedAt, weekday(2))
  assert.equal(status.error, '')
  assert.equal(status.tierNow, 'peak')
  assert.ok(Number.isFinite(Date.parse(status.asOf)))

  const priced = source.priceCall({ model: 'deepseek-v4-flash', provider: 'deepseek', atMs: weekday(2), usage: { outputTokens: 1e6 } })
  assert.equal(priced.source, 'costMeter')
  assert.equal(priced.tier, 'peak')
  assert.equal(priced.usd, 1.8)
  // a proxy route the table knows about is priced flat
  assert.equal(source.priceCall({ model: 'deepseek-v4-flash', provider: 'my-proxy', atMs: weekday(2), usage: { outputTokens: 1e6 } }).usd, 2)
})

test('pricing source: status().tierNow follows the snapshot the calls are priced against', async () => {
  const now = () => weekday(2) // inside both the bundled and the snapshot peak window
  const offPeakState = { ...costMeterState, config: { ...costMeterState.config, peakEnabled: false } }
  const source = createPricingSource(ctxWith({ getState: () => offPeakState }), { now })
  await source.refresh()
  assert.equal(source.status().tierNow, 'offPeak', 'a snapshot with peak pricing off is off-peak everywhere')
  assert.equal(
    source.priceCall({ model: 'deepseek-v4-flash', provider: 'deepseek', atMs: weekday(2), usage: { outputTokens: 1e6 } }).tier,
    source.status().tierNow,
    'the card agrees with how the call was priced',
  )

  // A snapshot whose windows differ from the bundled ones is read, not ignored.
  const shifted = { ...costMeterState, config: { ...costMeterState.config, peakWindows: [{ start: 12, end: 14 }] } }
  const shiftedSource = createPricingSource(ctxWith({ getState: () => shifted }), { now: () => weekday(12) })
  await shiftedSource.refresh()
  assert.equal(shiftedSource.status().tierNow, 'peak', 'noon is peak under the snapshot even though the bundle says otherwise')

  // Not effective yet → off-peak, however the windows read.
  const later = { ...costMeterState, config: { ...costMeterState.config, peakEffectiveAt: weekday(23) } }
  const laterSource = createPricingSource(ctxWith({ getState: () => later }), { now })
  await laterSource.refresh()
  assert.equal(laterSource.status().tierNow, 'offPeak')
})

test('pricing source: an async getState is awaited', async () => {
  const source = createPricingSource(ctxWith({ getState: async () => costMeterState }), { now: () => weekday(12) })
  await source.refresh()
  assert.equal(source.status().source, 'costMeter')
})

test('pricing source: a throwing / rejecting / junk getState falls back to bundled with an error', async () => {
  const cases = [
    ['throws', () => { throw new Error('boom') }],
    ['rejects', () => Promise.reject(new Error('nope'))],
    ['returns junk', () => 42],
    ['returns a state with no usable prices', () => ({ config: { prices: { models: { m: { cacheHit: NaN, cacheMiss: 1, output: 1 } } } } })],
    ['is not a function', undefined],
  ]
  for (const [name, getState] of cases) {
    const source = createPricingSource(ctxWith({ getState }), { now: () => weekday(12) })
    await source.refresh()
    const status = source.status()
    assert.equal(status.source, 'bundled', name)
    assert.equal(status.refreshedAt, 0, name)
    assert.ok(status.error.length > 0, name)
    assert.equal(source.priceCall({ model: 'deepseek-v4-flash', provider: 'deepseek', atMs: weekday(12), usage: { outputTokens: 1e6 } }).source, 'bundled', name)
  }
})

test('pricing source: a hanging getState gives up after timeoutMs', async () => {
  const source = createPricingSource(ctxWith({ getState: () => new Promise(() => {}) }), { now: () => weekday(12), timeoutMs: 10 })
  const startedAt = Date.now()
  await source.refresh()
  assert.ok(Date.now() - startedAt < 2000, 'refresh returned promptly')
  assert.equal(source.status().source, 'bundled')
  assert.ok(source.status().error.length > 0)
})

test('pricing source: a later failure drops back to bundled', async () => {
  let ok = true
  const source = createPricingSource(ctxWith({ getState: () => { if (!ok) throw new Error('gone'); return costMeterState } }), { now: () => weekday(12) })
  await source.refresh()
  assert.equal(source.status().source, 'costMeter')
  ok = false
  await source.refresh()
  assert.equal(source.status().source, 'bundled')
  assert.equal(source.priceCall({ model: 'deepseek-v4-flash', provider: 'deepseek', atMs: weekday(12), usage: { outputTokens: 1e6 } }).source, 'bundled')
})

test('pricing source: rates() covers both coach models, from the snapshot then the bundle', async () => {
  const source = createPricingSource(ctxWith({ getState: () => costMeterState }), { now: () => weekday(12) })
  const bundled = source.rates()
  assert.deepEqual(Object.keys(bundled), COACH_MODELS)
  for (const model of COACH_MODELS) {
    assert.deepEqual(bundled[model], { offPeak: BUNDLED_PRICES[model].offPeak, peak: BUNDLED_PRICES[model].peak })
    assert.notEqual(bundled[model].offPeak, BUNDLED_PRICES[model].offPeak, 'a fresh copy, not a reference')
  }
  bundled['deepseek-v4-flash'].offPeak.output = 999
  assert.equal(BUNDLED_PRICES['deepseek-v4-flash'].offPeak.output, 0.66, 'the bundle is not mutable through rates()')

  await source.refresh()
  const live = source.rates()
  assert.deepEqual(live['deepseek-v4-flash'], { offPeak: { cacheHit: 0.01, cacheMiss: 0.3, output: 0.9 }, peak: { cacheHit: 0.02, cacheMiss: 0.6, output: 1.8 } })
  assert.deepEqual(live['deepseek-v4-pro'], { offPeak: BUNDLED_PRICES['deepseek-v4-pro'].offPeak, peak: BUNDLED_PRICES['deepseek-v4-pro'].peak }, 'a model the table omits keeps its bundled price')
})
