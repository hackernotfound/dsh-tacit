    // ── Usage formatting & narrowing (money is formatted ONLY here) ─────────

    /**
     * List-price money, always four decimals — a coach analysis costs a few
     * hundredths of a cent, and two decimals would round every honest figure
     * to `$0.00`. A positive amount too small to show at four decimals reads
     * `< $0.0001` rather than a zero it is not.
     */
    function fmtUsd(n) {
      const value = Number(n)
      if (!Number.isFinite(value)) return '—'
      if (value > 0 && value < 0.0001) return '< $0.0001'
      if (value < 0) return '-$' + Math.abs(value).toFixed(4)
      return '$' + value.toFixed(4)
    }

    /**
     * A published rate, per 1M tokens. Rates are quoted, not measured, so they
     * read as they are quoted: three decimals at most and no trailing zeros —
     * `$0.007`, `$0.22`, `$1.32`. `fmtUsd`'s four fixed decimals belong to
     * spend, where every hundredth of a cent is a real figure.
     */
    function fmtRate(n) {
      const value = Number(n)
      if (!Number.isFinite(value) || value < 0) return '—'
      const trimmed = value.toFixed(3).replace(/\.?0+$/, '')
      if (value > 0 && Number(trimmed) === 0) return '< $0.001'
      return '$' + trimmed
    }

    /** Thousands-separated token counts, grouped here so no locale data is needed. */
    function fmtTokens(n) {
      const value = Number(n)
      if (!Number.isFinite(value)) return '—'
      const grouped = String(Math.round(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      return (value < 0 ? '-' : '') + grouped
    }

    /** A `YYYY-MM-DD` day, from either a day key (passed through) or an epoch ms. */
    function fmtDay(day) {
      if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day
      const value = Number(day)
      if (!Number.isFinite(value) || value <= 0) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (part) => String(part).padStart(2, '0')
      return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    }

    /** A 0..1 ratio as a whole percentage; `null`/non-finite stays an em dash. */
    function fmtPct(x) {
      const value = Number(x)
      if (!Number.isFinite(value)) return '—'
      return String(Math.round(value * 100)) + '%'
    }

    /**
     * Billed tokens in one bucket set: uncached input + output + cache reads +
     * cache writes. `reasoningTokens` is a subset of `outputTokens`, so adding
     * it would count every reasoning token twice.
     */
    function tokensTotal(buckets) {
      if (buckets === null || typeof buckets !== 'object') return 0
      const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
      return num(buckets.inputTokens) + num(buckets.outputTokens) + num(buckets.cacheReadTokens) + num(buckets.cacheWriteTokens)
    }

    function usageNum(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
    }

    function usageTokens(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      return {
        inputTokens: usageNum(source.inputTokens),
        outputTokens: usageNum(source.outputTokens),
        cacheReadTokens: usageNum(source.cacheReadTokens),
        cacheWriteTokens: usageNum(source.cacheWriteTokens),
        reasoningTokens: usageNum(source.reasoningTokens),
      }
    }

    /** One period card, zero-filled; the two derived figures stay nullable. */
    function usagePeriod(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      return {
        attempts: usageNum(source.attempts),
        billedCalls: usageNum(source.billedCalls),
        unmeteredCalls: usageNum(source.unmeteredCalls),
        unpricedCalls: usageNum(source.unpricedCalls),
        tokens: usageTokens(source.tokens),
        usdKnown: usageNum(source.usdKnown),
        avgAnalysisUsd: typeof source.avgAnalysisUsd === 'number' && Number.isFinite(source.avgAnalysisUsd) ? source.avgAnalysisUsd : null,
        cachedInputRate: typeof source.cachedInputRate === 'number' && Number.isFinite(source.cachedInputRate) ? source.cachedInputRate : null,
      }
    }

    function usageBuckets(value) {
      const out = {}
      if (value === null || typeof value !== 'object') return out
      for (const [key, totals] of Object.entries(value)) out[key] = usagePeriod(totals)
      return out
    }

    function usageSeries(value) {
      if (!Array.isArray(value)) return []
      return value
        .filter((point) => point !== null && typeof point === 'object' && typeof point.day === 'string')
        .map((point) => ({ day: point.day, usdKnown: usageNum(point.usdKnown), billedCalls: usageNum(point.billedCalls) }))
    }

    function usageWarning(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      const level = source.level === 'warn' || source.level === 'exceeded' ? source.level : 'none'
      return { limit: usageNum(source.limit), spent: usageNum(source.spent), level }
    }

    function usageRunItem(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      const text = (key) => (typeof source[key] === 'string' ? source[key] : '')
      return {
        runId: text('runId'),
        type: text('type'),
        status: text('status'),
        attempts: usageNum(source.attempts),
        billedCalls: usageNum(source.billedCalls),
        unmeteredCalls: usageNum(source.unmeteredCalls),
        unpricedCalls: usageNum(source.unpricedCalls),
        tokens: usageTokens(source.tokens),
        usdKnown: usageNum(source.usdKnown),
        trigger: text('trigger'),
        startedAt: usageNum(source.startedAt),
        endedAt: usageNum(source.endedAt),
        sessionId: text('sessionId'),
        turn: typeof source.turn === 'number' ? source.turn : null,
        workspace: text('workspace'),
        model: text('model'),
        provider: text('provider'),
      }
    }

    /**
     * The `/usage` envelope, narrowed. `null` for anything that is not a
     * successful report, so the card can render its empty state instead of
     * reaching into `undefined`.
     */
    function usageOf(value) {
      if (value === null || typeof value !== 'object' || value.ok !== true) return null
      const runs = value.runs !== null && typeof value.runs === 'object' ? value.runs : {}
      const warnings = value.warnings !== null && typeof value.warnings === 'object' ? value.warnings : {}
      return {
        trackingSince: usageNum(value.trackingSince),
        pricing: value.pricing !== null && typeof value.pricing === 'object' ? value.pricing : {},
        today: usagePeriod(value.today),
        month: usagePeriod(value.month),
        last7: usagePeriod(value.last7),
        last30: usagePeriod(value.last30),
        lifetime: usagePeriod(value.lifetime),
        byType: usageBuckets(value.byType),
        byModel: usageBuckets(value.byModel),
        series7: usageSeries(value.series7),
        series30: usageSeries(value.series30),
        warnings: { daily: usageWarning(warnings.daily), monthly: usageWarning(warnings.monthly) },
        runs: {
          items: (Array.isArray(runs.items) ? runs.items : []).map(usageRunItem),
          page: usageNum(runs.page) > 0 ? Math.floor(usageNum(runs.page)) : 1,
          pageSize: usageNum(runs.pageSize) > 0 ? Math.floor(usageNum(runs.pageSize)) : 20,
          total: usageNum(runs.total),
        },
      }
    }
