    // ── Usage dashboard (Settings → Usage card) ────────────────────────────

    /** Every run type and op the ledger can tag, in the order the filters list them. */
    const USAGE_RUN_TYPES = ['bootstrap', 'analysis', 'analysis-batch', 'improve', 'directive-distillation', 'style-distillation', 'prompt-enrichment']
    const USAGE_RANGES = ['today', '7d', '30d', 'month', 'all']
    const USAGE_STATUSES = ['success', 'partial', 'failed']
    const USAGE_COLUMNS = ['time', 'op', 'scope', 'model', 'status', 'calls', 'tokens', 'cost']

    /**
     * Spend for one bucket of calls. A period that billed calls but priced
     * none of them says so — `$0.0000` would claim the calls were free, and an
     * unmetered call is never `$0.00`. A genuinely idle period stays `$0.0000`.
     */
    function usageSpend(kit, totals) {
      if (totals.billedCalls > 0 && totals.billedCalls === totals.unpricedCalls) return kit.t('usage.priceUnavailable')
      return fmtUsd(totals.usdKnown)
    }

    /** One label/value tile; `note` is the small "n unpriced" line under the value. */
    function UsageTile(key, label, value, note) {
      return h('div', { key, className: 'tacit-tile' },
        h('span', { className: 'tacit-tile-label' }, label),
        h('span', { className: 'tacit-tile-value' }, value),
        typeof note === 'string' && note.length > 0 ? h('span', { className: 'tacit-tile-note' }, note) : null)
    }

    /** Money tile: the period's spend plus its unpriced-call footnote. */
    function SpendTile(kit, id, label, totals) {
      const note = totals.unpricedCalls > 0 ? kit.t('usage.unpricedShort', { n: String(totals.unpricedCalls) }) : ''
      return UsageTile(id, label, usageSpend(kit, totals), note)
    }

    /**
     * Daily spend as a bar per day. `role="img"` with one `<title>` per rect
     * carries the detail to a pointer; the visually hidden paragraph under it
     * carries the same shape to a screen reader, which cannot read the bars.
     */
    function BarStrip(kit, { series, which, onSeries }) {
      const { t } = kit
      const days = Array.isArray(series) ? series : []
      const count = days.length
      let max = 0
      let total = 0
      let peak = null
      for (const point of days) {
        if (point.usdKnown > max) max = point.usdKnown
        total += point.usdKnown
        if (peak === null || point.usdKnown > peak.usdKnown) peak = point
      }
      const bars = days.map((point, index) => {
        // A day with any spend at all keeps a visible 1px stub.
        const height = point.usdKnown > 0 && max > 0 ? Math.max(1, Math.round((point.usdKnown / max) * 46)) : 0
        return h('rect', {
          key: point.day,
          className: 'tacit-bar',
          x: String(index * 10 + 1),
          y: String(48 - height),
          width: '8',
          height: String(height),
        }, h('title', null, t('usage.barTitle', {
          day: fmtDay(point.day),
          usd: fmtUsd(point.usdKnown),
          calls: String(point.billedCalls),
        })))
      })
      const summary = t('usage.chartSummary', {
        n: String(count),
        total: fmtUsd(total),
        day: peak === null ? '—' : fmtDay(peak.day),
        max: peak === null ? '—' : fmtUsd(peak.usdKnown),
      })
      const seriesButton = (value, label) => h('button', {
        key: value,
        type: 'button',
        className: 'tacit-btn tacit-btn-sm',
        'aria-pressed': which === value,
        onClick: () => onSeries(value),
      }, label)
      return h('div', { className: 'tacit-usage-chart' },
        h('svg', {
          className: 'tacit-bars',
          role: 'img',
          'aria-label': t('usage.chartLabel', { n: String(count) }),
          viewBox: '0 0 ' + String(count * 10) + ' 48',
          preserveAspectRatio: 'none',
        }, bars),
        h('p', { className: 'tacit-visually-hidden' }, summary),
        h('div', { className: 'tacit-series-toggle' },
          seriesButton('7', t('usage.series7')),
          seriesButton('30', t('usage.series30'))))
    }

    /** Spend per operation, costliest first, each row ending in a share bar. */
    function UsageBreakdown(kit, { byType }) {
      const { t } = kit
      const rows = Object.entries(byType).sort((a, b) => b[1].usdKnown - a[1].usdKnown)
      if (rows.length === 0) return null
      const top = rows[0][1].usdKnown
      return h('div', { className: 'tacit-usage-breakdown' },
        h('div', { className: 'tacit-report-title' }, t('usage.breakdown')),
        rows.map(([type, totals]) => {
          const share = top > 0 ? Math.round((totals.usdKnown / top) * 100) : 0
          return h('div', { key: type, className: 'tacit-breakdown-row' },
            h('span', { className: 'tacit-breakdown-name' }, t('runtype.' + type)),
            h('span', { className: 'tacit-breakdown-calls' }, fmtTokens(totals.billedCalls)),
            h('span', { className: 'tacit-breakdown-tokens' }, fmtTokens(tokensTotal(totals.tokens))),
            h('span', { className: 'tacit-breakdown-usd' }, usageSpend(kit, totals)),
            h('div', { className: 'tacit-share-track' },
              h('div', { className: 'tacit-share', style: { width: String(share) + '%' } })))
        }))
    }

    /** One budget bar; nothing at all when that threshold is switched off (`limit` 0). */
    function WarnBar(kit, { id, warning }) {
      const { t } = kit
      if (!(warning.limit > 0)) return null
      const pct = Math.round((warning.spent / warning.limit) * 100)
      const label = t('warn.' + id, { spent: fmtUsd(warning.spent), limit: fmtUsd(warning.limit), pct: String(pct) })
      return h('div', {
        key: id,
        className: 'tacit-warn-bar tacit-warn-' + warning.level,
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': warning.limit,
        'aria-valuenow': warning.spent,
        'aria-label': label,
      },
      h('span', { className: 'tacit-warn-label' }, label),
      h('div', { className: 'tacit-warn-track' },
        h('div', { className: 'tacit-warn-fill', style: { width: String(Math.min(100, pct)) + '%' } })))
    }

    /** Range/type/status/model selects plus the two free-text scopes. */
    function UsageFilters(kit, { filters, models, onFilter }) {
      const { t } = kit
      const select = (name, value, options) => h('label', { className: 'tacit-filter' },
        h('span', { className: 'tacit-filter-label' }, t('filter.' + name)),
        h('select', {
          className: 'tacit-select',
          value,
          onChange: (event) => onFilter({ [name]: event.target.value }),
        }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label))))
      // A text scope applies on Enter or on leaving the field — not per keystroke,
      // which would fire a /usage call for every character typed.
      const text = (name, value) => h('label', { className: 'tacit-filter' },
        h('span', { className: 'tacit-filter-label' }, t('filter.' + name)),
        h('input', {
          className: 'tacit-input',
          type: 'text',
          key: name + '-' + value,
          defaultValue: value,
          onBlur: (event) => {
            if (event.target.value !== value) onFilter({ [name]: event.target.value.trim() })
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') onFilter({ [name]: event.target.value.trim() })
          },
        }))
      const all = { value: '', label: t('filter.all') }
      return h('div', { className: 'tacit-usage-filters' },
        h('div', { className: 'tacit-report-title' }, t('usage.filters')),
        h('div', { className: 'tacit-filter-row' },
          select('range', filters.range, USAGE_RANGES.map((value) => ({ value, label: t('range.' + value) }))),
          select('type', filters.type, [all, ...USAGE_RUN_TYPES.map((value) => ({ value, label: t('runtype.' + value) }))]),
          select('status', filters.status, [all, ...USAGE_STATUSES.map((value) => ({ value, label: t('status.' + value) }))]),
          select('model', filters.model, [all, ...models.map((value) => ({ value, label: value }))]),
          text('workspace', filters.workspace),
          text('session', filters.sessionId)))
    }

    /** The five token buckets of one attempt, in the order the adapter reports them. */
    function attemptTokens(usage) {
      if (usage === null || typeof usage !== 'object') return '—'
      return 'in ' + fmtTokens(usage.inputTokens)
        + ' · out ' + fmtTokens(usage.outputTokens)
        + ' · cacheRead ' + fmtTokens(usage.cacheReadTokens)
        + ' · cacheWrite ' + fmtTokens(usage.cacheWriteTokens)
        + ' · reasoning ' + fmtTokens(usage.reasoningTokens)
    }

    /** One `run()` of the coach model: what it was, how it ended, what it cost. */
    function AttemptRow(kit, attempt) {
      const { t } = kit
      const priced = attempt.priced !== null && typeof attempt.priced === 'object' ? attempt.priced : null
      const finish = String(attempt.finish || '')
      const code = String(attempt.code || '')
      return h('div', { key: String(attempt.id), className: 'tacit-attempt' },
        h('span', { className: 'tacit-chip' }, t('op.' + String(attempt.op))),
        typeof attempt.reasoningEffort === 'string' && attempt.reasoningEffort.length > 0
          ? h('span', { className: 'tacit-attempt-meta' }, t('attempt.effort', { effort: attempt.reasoningEffort }))
          : null,
        h('span', { className: 'tacit-chip tacit-status-' + String(attempt.status) }, t('status.' + String(attempt.status))),
        h('span', { className: 'tacit-attempt-meta' }, t('attempt.finish', { finish, code })),
        h('span', { className: 'tacit-attempt-meta' }, priced === null
          ? t('usage.priceUnavailable')
          : t('attempt.source', { source: String(priced.source), tier: String(priced.tier) })),
        h('span', { className: 'tacit-attempt-tokens' }, attemptTokens(attempt.usage)),
        h('span', { className: 'tacit-attempt-meta' }, t('attempt.duration', { ms: fmtTokens(attempt.durationMs) })),
        h('span', { className: 'tacit-attempt-usd' }, priced === null ? t('usage.priceUnavailable') : fmtUsd(priced.usd)))
    }

    /** The expanded detail row of one run: its attempts, or the loading line. */
    function AttemptsRow(kit, { runId, run }) {
      const { t } = kit
      const attempts = run !== null && run !== undefined && typeof run === 'object' && Array.isArray(run.attempts)
        ? run.attempts.filter((attempt) => attempt !== null && typeof attempt === 'object')
        : null
      return h('div', { className: 'tacit-usage-attempts', id: 'tacit-run-' + runId, role: 'row' },
        h('div', { className: 'tacit-usage-cell tacit-usage-attempts-cell', role: 'cell' },
          attempts === null
            ? h('p', { className: 'tacit-panel-hint' }, t('usage.loading'))
            : attempts.map((attempt) => AttemptRow(kit, attempt))))
    }

    /** One run row; the first cell is the disclosure button for its attempts. */
    function RunRow(kit, { item, open, onToggleRun }) {
      const { t, fmtTime } = kit
      const scope = item.workspace.length > 0 && item.turn !== null
        ? item.workspace + ' · #' + String(item.turn)
        : (item.workspace.length > 0 ? item.workspace : (item.turn !== null ? '#' + String(item.turn) : '—'))
      const cell = (key, child) => h('span', { key, className: 'tacit-usage-cell', role: 'cell' }, child)
      return h('div', { className: 'tacit-usage-row', role: 'row' },
        cell('time', h('button', {
          type: 'button',
          className: 'tacit-btn tacit-btn-sm tacit-run-toggle',
          'aria-expanded': open,
          'aria-controls': 'tacit-run-' + item.runId,
          onClick: () => onToggleRun(item.runId),
        }, (open ? '▾ ' : '▸ ') + fmtTime(item.startedAt))),
        cell('op', t('runtype.' + item.type)),
        cell('scope', scope),
        cell('model', item.model.length > 0 ? item.model : '—'),
        cell('status', h('span', { className: 'tacit-chip tacit-status-' + item.status }, t('status.' + item.status))),
        cell('calls', fmtTokens(item.billedCalls)),
        cell('tokens', fmtTokens(tokensTotal(item.tokens))),
        cell('cost', usageSpend(kit, item)))
    }

    /** The runs table plus its pager. */
    function UsageRuns(kit, { runs, expanded, runDetails, onToggleRun, onFilter }) {
      const { t } = kit
      const pages = Math.max(1, Math.ceil(runs.total / Math.max(1, runs.pageSize)))
      const page = Math.min(Math.max(1, runs.page), pages)
      return h('div', { className: 'tacit-usage-runs' },
        h('div', { className: 'tacit-usage-table', role: 'table', 'aria-label': t('card.usage') },
          h('div', { className: 'tacit-usage-row tacit-usage-head', role: 'row' },
            USAGE_COLUMNS.map((column) => h('span', {
              key: column,
              className: 'tacit-usage-cell',
              role: 'columnheader',
            }, t('usage.col.' + column)))),
          runs.items.map((item) => {
            const open = expanded.has(item.runId)
            return h(React.Fragment, { key: item.runId },
              RunRow(kit, { item, open, onToggleRun }),
              open ? AttemptsRow(kit, { runId: item.runId, run: runDetails[item.runId] }) : null)
          })),
        h('div', { className: 'tacit-pager' },
          h('button', {
            type: 'button',
            className: 'tacit-btn tacit-btn-sm',
            disabled: page <= 1,
            onClick: () => onFilter({ page: page - 1 }),
          }, t('usage.prev')),
          h('span', { className: 'tacit-pager-label' }, t('usage.page', { page: String(page), pages: String(pages) })),
          h('button', {
            type: 'button',
            className: 'tacit-btn tacit-btn-sm',
            disabled: page >= pages,
            onClick: () => onFilter({ page: page + 1 }),
          }, t('usage.next'))))
    }

    /**
     * The whole Usage card. A plain renderer, not a component: it is called
     * from `CoachPanelView`'s render, so it must never own hooks — every bit
     * of its state lives in `rootStore` and arrives as a prop.
     */
    function UsageCard(kit, props) {
      const { t } = kit
      const usage = usageOf(props.usage)
      const since = fmtDay(usage === null ? 0 : usage.trackingSince)
      if (usage === null || usage.lifetime.billedCalls === 0) {
        return h('div', { className: 'tacit-usage' },
          h('p', { className: 'tacit-panel-hint' }, t('usage.empty', { since })))
      }
      const filters = props.filters !== null && typeof props.filters === 'object' ? props.filters : {}
      const value = (key) => (typeof filters[key] === 'string' ? filters[key] : '')
      const expanded = props.expanded instanceof Set ? props.expanded : new Set()
      const runDetails = props.runs !== null && typeof props.runs === 'object' ? props.runs : {}
      const which = props.series === '7' ? '7' : '30'
      const last30 = usage.last30
      return h('div', { className: 'tacit-usage' },
        h('p', { className: 'tacit-panel-hint' }, t('usage.label')),
        h('div', { className: 'tacit-tiles' },
          SpendTile(kit, 'today', t('usage.today'), usage.today),
          SpendTile(kit, 'month', t('usage.month'), usage.month),
          SpendTile(kit, 'last30', t('usage.last30'), last30),
          SpendTile(kit, 'lifetime', t('usage.since', { day: since }), usage.lifetime)),
        h('div', { className: 'tacit-tiles' },
          UsageTile('calls', t('usage.calls'), fmtTokens(last30.billedCalls)),
          UsageTile('avg', t('usage.avgAnalysis'), last30.avgAnalysisUsd === null
            ? t('usage.priceUnavailable')
            : fmtUsd(last30.avgAnalysisUsd)),
          UsageTile('cached', t('usage.cachedRate'), fmtPct(last30.cachedInputRate)),
          UsageTile('unpriced', t('usage.unpriced'), fmtTokens(last30.unpricedCalls))),
        BarStrip(kit, { series: which === '7' ? usage.series7 : usage.series30, which, onSeries: props.onSeries }),
        UsageBreakdown(kit, { byType: usage.byType }),
        WarnBar(kit, { id: 'daily', warning: usage.warnings.daily }),
        WarnBar(kit, { id: 'monthly', warning: usage.warnings.monthly }),
        UsageFilters(kit, {
          filters: {
            range: value('range').length > 0 ? value('range') : '30d',
            type: value('type'),
            status: value('status'),
            model: value('model'),
            workspace: value('workspace'),
            sessionId: value('sessionId'),
          },
          models: Object.keys(usage.byModel).sort(),
          onFilter: props.onFilter,
        }),
        UsageRuns(kit, {
          runs: usage.runs,
          expanded,
          runDetails,
          onToggleRun: props.onToggleRun,
          onFilter: props.onFilter,
        }))
    }
