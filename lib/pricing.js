// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — pure pricing (no I/O).
 *
 * Prices one model call from its token usage against either the bundled
 * DeepSeek list prices (peak / off-peak / Beijing-weekend tiers) or a price
 * table sourced from the `dsh-cost-meter` plugin's state. Nothing here
 * touches the network, the store, or the service — `lib/pricing-source.js`
 * is responsible for fetching the cost-meter state, normalizing it with
 * `normalizeCostMeterState`, and handing the result in as `table`.
 *
 * Tier is decided once, at the request's start time (`atMs`) — not at
 * finish, so a call that straddles a boundary is priced consistently.
 */

export const PRICES_AS_OF = '2026-08-22'

/**
 * `reasoningTokens` (DeepSeek adapter) is always a subset of `outputTokens`,
 * never a separate quantity — so it must not be billed again. Kept as a
 * named constant (rather than inlined `false`) so it can be flipped if a
 * future adapter ever reports reasoning as additional to output.
 */
export const REASONING_BILLED_SEPARATELY = false

/** Provider ids that route through DeepSeek's own API (bundled list prices apply). */
export const OFFICIAL_PROVIDERS = ['deepseek-official', 'deepseek']

/** USD per 1M tokens, as of {@link PRICES_AS_OF}. */
export const BUNDLED_PRICES = {
  'deepseek-v4-flash': {
    offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
    peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
  },
  'deepseek-v4-pro': {
    offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
    peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
  },
}

/** Peak hour windows, UTC, `[start, end)`. */
export const PEAK_WINDOWS_UTC = [{ start: 1, end: 4 }, { start: 6, end: 10 }]

/** Beijing-weekend off-peak rule only applies from this moment on. */
export const WEEKEND_OFFPEAK_FROM = Date.parse('2026-08-22T16:00:00Z')

const MS_PER_HOUR = 3600 * 1000

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value) {
  return isFiniteNumber(value) && value > 0
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Is the day-of-week of `ms + 8h`, in UTC, a Saturday or Sunday (Beijing calendar)? */
export function isBeijingWeekend(ms) {
  if (!isFiniteNumber(ms)) return false
  const day = new Date(ms + 8 * MS_PER_HOUR).getUTCDay()
  return day === 0 || day === 6
}

/**
 * The pricing tier in effect at `ms`. `offPeak` when `!peakEnabled`, when
 * `ms < effectiveAtMs`, when it's a Beijing weekend at/after
 * {@link WEEKEND_OFFPEAK_FROM}, or when the UTC hour falls outside every
 * window; `peak` otherwise.
 */
export function tierAt(ms, { windows = PEAK_WINDOWS_UTC, effectiveAtMs = 0, peakEnabled = true } = {}) {
  if (!peakEnabled) return 'offPeak'
  if (!isFiniteNumber(ms)) return 'offPeak'
  if (isFiniteNumber(effectiveAtMs) && ms < effectiveAtMs) return 'offPeak'
  if (ms >= WEEKEND_OFFPEAK_FROM && isBeijingWeekend(ms)) return 'offPeak'

  const hour = new Date(ms).getUTCHours()
  const activeWindows = Array.isArray(windows) ? windows : PEAK_WINDOWS_UTC
  const inWindow = activeWindows.some(
    (w) => isPlainObject(w) && isFiniteNumber(w.start) && isFiniteNumber(w.end) && hour >= w.start && hour < w.end,
  )
  return inWindow ? 'peak' : 'offPeak'
}

/** Does `provider` route through DeepSeek's own API (as opposed to a proxy/custom route)? */
export function isOfficialRoute(provider) {
  return OFFICIAL_PROVIDERS.includes(provider)
}

/** A well-formed `{cacheHit, cacheMiss, output}` triple, or `null`. */
function isRateTriple(triple) {
  return isPlainObject(triple) && isFiniteNumber(triple.cacheHit) && isFiniteNumber(triple.cacheMiss) && isFiniteNumber(triple.output)
}

/** Look up `table.models[model]`'s tiered rates for an official-route call, or `null`. */
function costMeterModelRates(table, model, atMs) {
  const models = isPlainObject(table.models) ? table.models : null
  const entry = models === null ? undefined : models[model]
  if (!isPlainObject(entry) || !isRateTriple(entry.offPeak) || !isRateTriple(entry.peak)) return null
  const tier = tierAt(atMs, {
    windows: table.windows,
    effectiveAtMs: table.effectiveAtMs,
    peakEnabled: table.peakEnabled !== false,
  })
  return { tier, rates: entry[tier] }
}

/** Look up `table.providers[provider][model]`'s flat rates, or `null`. */
function costMeterProviderRates(table, provider, model) {
  const providers = isPlainObject(table.providers) ? table.providers : null
  const providerEntry = providers === null ? undefined : providers[provider]
  const flat = isPlainObject(providerEntry) ? providerEntry[model] : undefined
  return isRateTriple(flat) ? flat : null
}

/**
 * Resolve the price source and rates for one call. Resolution order:
 * (1) `table.models[model]` when the route is official → `costMeter`, tier
 *     from `tierAt` using the table's own windows/effectiveAt/peakEnabled;
 * (2) `table.providers[provider][model]` → `costMeter`, `tier:'flat'`;
 * (3) the bundled list price, when the route is official and the model is
 *     known → `bundled`;
 * (4) `null`.
 *
 * Always returns fresh copies of `rates` — never a reference into
 * `BUNDLED_PRICES` or `table`.
 */
export function ratesFor({ model, provider, atMs, table = null }) {
  if (isPlainObject(table)) {
    if (isOfficialRoute(provider)) {
      const found = costMeterModelRates(table, model, atMs)
      if (found !== null) {
        return {
          source: 'costMeter',
          tier: found.tier,
          rates: { ...found.rates },
          asOf: typeof table.asOf === 'string' ? table.asOf : PRICES_AS_OF,
        }
      }
    }
    const flat = costMeterProviderRates(table, provider, model)
    if (flat !== null) {
      return {
        source: 'costMeter',
        tier: 'flat',
        rates: { ...flat },
        asOf: typeof table.asOf === 'string' ? table.asOf : PRICES_AS_OF,
      }
    }
  }

  if (isOfficialRoute(provider) && Object.prototype.hasOwnProperty.call(BUNDLED_PRICES, model)) {
    const tier = tierAt(atMs)
    return {
      source: 'bundled',
      tier,
      rates: { ...BUNDLED_PRICES[model][tier] },
      asOf: PRICES_AS_OF,
    }
  }

  return null
}

/** Read a usage field as a non-negative finite number, defaulting to 0. */
function tokensOf(usage, key) {
  const value = usage === null || typeof usage !== 'object' ? undefined : usage[key]
  return isFiniteNumber(value) && value >= 0 ? value : 0
}

/**
 * USD cost of `usage` at `rates`. `inputTokens` is uncached input, billed at
 * `cacheMiss`; `cacheReadTokens` + `cacheWriteTokens` bill at `cacheHit`;
 * `reasoningTokens` is added to output only if {@link REASONING_BILLED_SEPARATELY}.
 */
export function costOf(usage, rates) {
  const input = tokensOf(usage, 'inputTokens')
  const output = tokensOf(usage, 'outputTokens')
  const cacheRead = tokensOf(usage, 'cacheReadTokens')
  const cacheWrite = tokensOf(usage, 'cacheWriteTokens')
  const reasoning = tokensOf(usage, 'reasoningTokens')
  const billedOutput = REASONING_BILLED_SEPARATELY ? output + reasoning : output
  const cacheHitTokens = cacheRead + cacheWrite

  const cacheHit = isFiniteNumber(rates?.cacheHit) ? rates.cacheHit : 0
  const cacheMiss = isFiniteNumber(rates?.cacheMiss) ? rates.cacheMiss : 0
  const outputRate = isFiniteNumber(rates?.output) ? rates.output : 0

  return (input * cacheMiss + cacheHitTokens * cacheHit + billedOutput * outputRate) / 1e6
}

/** Price one call end to end: resolve rates via {@link ratesFor}, then cost via {@link costOf}. */
export function priceCall({ model, provider, atMs, usage, table = null }) {
  const priced = ratesFor({ model, provider, atMs, table })
  if (priced === null) return null
  return { ...priced, usd: costOf(usage, priced.rates) }
}

// ── costMeter state normalization ───────────────────────────────────────

const DEFAULT_EXCHANGE_RATE = 7.2

/** A `{cacheHit, cacheMiss, output}` triple, currency-converted; `null` if any rate is invalid. */
function normalizeTriple(triple, currency, exchangeRate) {
  if (!isRateTriple(triple) || triple.cacheHit < 0 || triple.cacheMiss < 0 || triple.output < 0) return null
  const divisor = currency === 'CNY' ? (isPositiveNumber(exchangeRate) ? exchangeRate : DEFAULT_EXCHANGE_RATE) : 1
  return { cacheHit: triple.cacheHit / divisor, cacheMiss: triple.cacheMiss / divisor, output: triple.output / divisor }
}

/** A model price entry (`{cacheHit,cacheMiss,output}` or `{offPeak,peak}`) → `{offPeak, peak}`, or `null`. */
function normalizeModelEntry(entry, currency, exchangeRate) {
  if (!isPlainObject(entry)) return null
  if (entry.offPeak !== undefined || entry.peak !== undefined) {
    const offPeak = normalizeTriple(entry.offPeak, currency, exchangeRate)
    const peak = normalizeTriple(entry.peak, currency, exchangeRate)
    return offPeak === null || peak === null ? null : { offPeak, peak }
  }
  const flat = normalizeTriple(entry, currency, exchangeRate)
  return flat === null ? null : { offPeak: flat, peak: { ...flat } }
}

/** A provider price entry `{input, cachedInput?, output}` → `{cacheMiss, cacheHit, output}`, or `null`. */
function normalizeProviderModelEntry(entry, currency, exchangeRate) {
  if (!isPlainObject(entry)) return null
  const cachedInput = entry.cachedInput !== undefined ? entry.cachedInput : entry.input
  return normalizeTriple({ cacheMiss: entry.input, cacheHit: cachedInput, output: entry.output }, currency, exchangeRate)
}

/**
 * Duck-typed normalization of the `dsh-cost-meter` service state (or its
 * `config` sub-object) into the shape {@link ratesFor} consumes:
 * `{models, providers, windows, effectiveAtMs, peakEnabled, asOf}`.
 * Invalid rates (non-finite or negative) drop the entry that carries them;
 * a non-object input (or config root) yields `null`.
 */
export function normalizeCostMeterState(state) {
  if (!isPlainObject(state)) return null
  const config = isPlainObject(state.config) ? state.config : state
  if (!isPlainObject(config)) return null

  const prices = isPlainObject(config.prices) ? config.prices : {}
  const currency = prices.currency === 'CNY' ? 'CNY' : 'USD'
  const exchangeRate = isPositiveNumber(config.exchangeRate) ? config.exchangeRate : DEFAULT_EXCHANGE_RATE

  const models = {}
  const rawModels = isPlainObject(prices.models) ? prices.models : {}
  for (const [id, entry] of Object.entries(rawModels)) {
    const normalized = normalizeModelEntry(entry, currency, exchangeRate)
    if (normalized !== null) models[id] = normalized
  }

  const providers = {}
  const rawProviders = isPlainObject(prices.providers) ? prices.providers : {}
  for (const [providerId, providerEntry] of Object.entries(rawProviders)) {
    if (!isPlainObject(providerEntry)) continue
    const rawProviderModels = isPlainObject(providerEntry.models) ? providerEntry.models : {}
    const byModel = {}
    for (const [modelId, entry] of Object.entries(rawProviderModels)) {
      const normalized = normalizeProviderModelEntry(entry, currency, exchangeRate)
      if (normalized !== null) byModel[modelId] = normalized
    }
    if (Object.keys(byModel).length > 0) providers[providerId] = byModel
  }

  const rawWindows = Array.isArray(config.peakWindows)
    ? config.peakWindows.filter((w) => isPlainObject(w) && isFiniteNumber(w.start) && isFiniteNumber(w.end))
    : null
  const windows = rawWindows !== null
    ? rawWindows.map((w) => ({ start: w.start, end: w.end }))
    : PEAK_WINDOWS_UTC.map((w) => ({ ...w }))

  const effectiveAtMs = isFiniteNumber(config.peakEffectiveAt) ? config.peakEffectiveAt : 0
  const peakEnabled = typeof config.peakEnabled === 'boolean' ? config.peakEnabled : true

  return {
    models,
    providers,
    windows,
    effectiveAtMs,
    peakEnabled,
    asOf: new Date().toISOString(),
  }
}
