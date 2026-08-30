// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — the price table behind the usage tracker.
 *
 * Wraps the pure `lib/pricing.js` with one optional input: the sibling
 * `dsh-cost-meter` plugin's `costMeter` service. When that service is
 * installed and hands over a usable state, its prices win; otherwise the
 * bundled DeepSeek list prices apply. The service is fully duck-typed and
 * never trusted: `refresh()` never throws, never blocks longer than
 * `timeoutMs`, and any failure (absent, throwing, hanging, junk) leaves the
 * source on the bundled table with a human-readable `error`.
 *
 * A model call must never wait on this — the service refreshes it in the
 * background and every `priceCall` reads whatever snapshot is current.
 */

import { priceCall as priceCallWith, normalizeCostMeterState, tierAt, PRICES_AS_OF, BUNDLED_PRICES } from './pricing.js'
import { COACH_MODELS } from './schema.js'

/** A `{cacheHit, cacheMiss, output}` triple as a fresh object (never a reference into a shared table). */
function copyTriple(triple) {
  return { cacheHit: triple.cacheHit, cacheMiss: triple.cacheMiss, output: triple.output }
}

/** A normalized snapshot is only worth using if it actually carries a price. */
function hasPrices(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return false
  const models = snapshot.models !== null && typeof snapshot.models === 'object' ? Object.keys(snapshot.models) : []
  const providers = snapshot.providers !== null && typeof snapshot.providers === 'object' ? Object.keys(snapshot.providers) : []
  return models.length > 0 || providers.length > 0
}

/** Whatever was thrown/rejected, as a short message. */
function messageOf(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0) return error.message
  return String(error)
}

/** Reject after `ms`; the timer is unref'd so a pending refresh never holds the process open. */
function rejectAfter(ms) {
  let timer = null
  const promise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`costMeter getState() timed out after ${ms}ms`)), ms)
    if (typeof timer?.unref === 'function') timer.unref()
  })
  return { promise, cancel: () => { if (timer !== null) clearTimeout(timer) } }
}

/**
 * The price source the tracker and the reports read from.
 * `now`/`timeoutMs` are injectable so tests can drive the clock and the
 * hang path without waiting five seconds.
 */
export function createPricingSource(ctx, { now = Date.now, timeoutMs = 5000 } = {}) {
  const state = { snapshot: null, source: 'bundled', refreshedAt: 0, error: '' }

  /** Drop back to the bundled table, remembering why. */
  function fallBack(error) {
    state.snapshot = null
    state.source = 'bundled'
    state.refreshedAt = 0
    state.error = error
  }

  async function refresh() {
    const service = ctx !== null && typeof ctx === 'object' && typeof ctx.get === 'function' ? ctx.get('costMeter') : undefined
    if (service === undefined || service === null || typeof service.getState !== 'function') {
      fallBack('the costMeter service is not available — using bundled list prices')
      return
    }
    const timeout = rejectAfter(timeoutMs)
    let raw
    try {
      raw = await Promise.race([Promise.resolve(service.getState()), timeout.promise])
    } catch (error) {
      fallBack(messageOf(error))
      return
    } finally {
      timeout.cancel()
    }
    const snapshot = normalizeCostMeterState(raw)
    if (!hasPrices(snapshot)) {
      fallBack('the costMeter state carried no usable prices — using bundled list prices')
      return
    }
    state.snapshot = snapshot
    state.source = 'costMeter'
    state.refreshedAt = now()
    state.error = ''
  }

  /** {@link priceCallWith} against the current snapshot (bundled when there is none). */
  function priceCall(args) {
    return priceCallWith({ ...args, table: state.snapshot })
  }

  /**
   * What the Pricing card shows about the source itself. `tierNow` is read
   * off the same snapshot `priceCall` prices against — a cost-meter table
   * that turns peak pricing off, shifts the windows, or dates them into the
   * future must not leave the card quoting the bundled schedule.
   */
  function status() {
    const snapshot = state.snapshot
    const tierNow = snapshot === null
      ? tierAt(now())
      : tierAt(now(), { windows: snapshot.windows, effectiveAtMs: snapshot.effectiveAtMs, peakEnabled: snapshot.peakEnabled !== false })
    return {
      source: state.source,
      asOf: typeof snapshot?.asOf === 'string' ? snapshot.asOf : PRICES_AS_OF,
      refreshedAt: state.refreshedAt,
      tierNow,
      error: state.error,
    }
  }

  /** `{model: {offPeak, peak}}` for both coach models — snapshot first, bundled per model otherwise. */
  function rates() {
    const models = state.snapshot?.models
    const out = {}
    for (const model of COACH_MODELS) {
      const entry = models !== null && typeof models === 'object' ? models[model] : undefined
      const source = entry !== null && typeof entry === 'object' && entry.offPeak !== undefined && entry.peak !== undefined
        ? entry
        : BUNDLED_PRICES[model]
      out[model] = { offPeak: copyTriple(source.offPeak), peak: copyTriple(source.peak) }
    }
    return out
  }

  return { refresh, priceCall, status, rates }
}
