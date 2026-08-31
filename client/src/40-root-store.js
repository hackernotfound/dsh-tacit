    // ── Root store (settings section + bootstrap + directives editor) ──────

    const rootStore = {
      config: null,
      profile: null,
      auto: null,
      steering: null, // {enabled, text}
      workspaces: [], // [{cwd, label}] from /state
      receipts: {}, // directive id → the /directive-receipt receipt, re-read on each expand
      trend: null, // measured early-vs-recent trend
      bootstrap: null, // {running, done, total}
      coached: [], // cross-session coached-prompt entries
      // Which Settings cards are expanded. Open state lives here (not in React
      // state) so it survives re-renders and is seedable from the SSR suite.
      sections: {
        overview: true,
        usage: true,
        pricing: false,
        learning: false,
        guidance: false,
        improve: false,
        history: false,
        privacy: false,
      },
      notice: null, // {text} — a short-lived result line, cleared after 5s
      // A destructive action waiting on its confirmation dialog:
      // null | {kind:'reports'|'usage'}.
      confirm: null,
      preview: null, // the last /bootstrap-preview envelope
      usage: null, // the last /usage envelope
      usageFilters: { range: '30d', type: '', status: '', model: '', workspace: '', sessionId: '', page: 1, pageSize: 20 },
      usageRuns: {}, // runId → the full run (attempts included), fetched on first expand
      usageExpanded: new Set(), // runIds whose attempt rows are open
      usageSeries: '30', // '7' | '30' — which sparkline the strip shows
      pricingRefreshing: false, // a /pricing-refresh call is in flight
      initStarted: false,
      initDone: false,
      error: null,
      listeners: new Set(),
    }

    function notifyRoot() {
      for (const listener of rootStore.listeners) listener()
    }

    /** Expand/collapse one Settings card; unknown ids are ignored. */
    function toggleSection(id) {
      const key = String(id)
      if (rootStore.sections === null || typeof rootStore.sections !== 'object'
        || typeof rootStore.sections[key] !== 'boolean') return
      rootStore.sections[key] = !rootStore.sections[key]
      notifyRoot()
    }

    let noticeTimer = null

    /**
     * Show one result line (e.g. "Bootstrap complete · 7 analyzed"). It clears
     * itself after 5s; the timer is skipped where there is no scheduler (SSR).
     */
    function setRootNotice(text) {
      rootStore.notice = typeof text === 'string' && text.length > 0 ? { text } : null
      notifyRoot()
      if (typeof setTimeout !== 'function' || rootStore.notice === null) return
      if (noticeTimer !== null && typeof clearTimeout === 'function') clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => {
        noticeTimer = null
        rootStore.notice = null
        notifyRoot()
      }, 5000)
      unrefTimer(noticeTimer)
    }

    /**
     * Node hands back a Timeout object that keeps the process alive; the
     * browser hands back a number. Unref'ing where it exists means a test that
     * merely touches one of these paths can never hold the runner open.
     */
    function unrefTimer(handle) {
      if (handle !== null && typeof handle === 'object' && typeof handle.unref === 'function') handle.unref()
    }

    /**
     * The bound translator, captured once when the plugin applies.
     *
     * A notice states what a call actually cost, so it is written where those
     * figures land — inside the store actions. Those run far from any `kit`
     * (a click in the conversation tab, a poll), and there is exactly one
     * translator per plugin instance, so it is held here rather than threaded
     * through every call site.
     */
    let translate = null

    function setTranslator(fn) {
      translate = typeof fn === 'function' ? fn : null
    }

    /**
     * A result line with the run's measured figures: billed calls, total
     * tokens and list-price cost. A run that priced nothing says so instead of
     * claiming `$0.0000`, and the count of unpriced calls rides as a suffix —
     * an unmetered call has no price, not a price of zero.
     */
    function runNotice(t, key, vars, run) {
      const source = run !== null && typeof run === 'object' ? run : {}
      const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
      const totals = {
        // `attempts` rides along so a run whose every call went unmetered
        // reads as an unknown cost rather than a free one.
        attempts: count(source.attempts),
        billedCalls: count(source.billedCalls),
        unpricedCalls: count(source.unpricedCalls),
        usdKnown: count(source.usdKnown),
      }
      const text = t(key, {
        ...(vars === null || typeof vars !== 'object' ? {} : vars),
        calls: fmtTokens(totals.billedCalls),
        tokens: fmtTokens(tokensTotal(source.tokens)),
        usd: usageSpend({ t }, totals),
      })
      return totals.unpricedCalls > 0 ? text + t('notice.unpriced', { n: String(totals.unpricedCalls) }) : text
    }

    /**
     * Record a run's result line on a session store, where the conversation
     * tab's live region reads it. It stays on that store: a tab action has no
     * business announcing itself on the Settings page.
     */
    function setStoreNotice(store, key, vars, run) {
      if (translate === null || store === null || typeof store !== 'object') return
      store.notice = { code: key, text: runNotice(translate, key, vars, run) }
    }

    // ── Usage ledger (the Settings → Usage card) ───────────────────────────

    /** The filter payload for `/usage`: defaults always, empty strings never. */
    function usageQuery() {
      const filters = rootStore.usageFilters !== null && typeof rootStore.usageFilters === 'object' ? rootStore.usageFilters : {}
      const query = {
        range: typeof filters.range === 'string' && filters.range.length > 0 ? filters.range : '30d',
        page: typeof filters.page === 'number' && filters.page > 0 ? Math.floor(filters.page) : 1,
        pageSize: typeof filters.pageSize === 'number' && filters.pageSize > 0 ? Math.floor(filters.pageSize) : 20,
      }
      for (const key of ['type', 'status', 'model', 'workspace', 'sessionId']) {
        const value = filters[key]
        if (typeof value === 'string' && value.length > 0) query[key] = value
      }
      return query
    }

    /** Read the whole cost panel in one call; a failure keeps the last envelope. */
    async function fetchUsage() {
      try {
        const result = await api('/usage', usageQuery())
        if (result !== null && typeof result === 'object' && result.ok === true) rootStore.usage = result
      } catch {
        // A stale panel beats a blank one; the next poll tries again.
      }
      notifyRoot()
    }

    /** Narrow the runs list. Any change but an explicit page jump goes back to page 1. */
    function setUsageFilter(patch) {
      if (patch === null || typeof patch !== 'object') return
      const next = { ...rootStore.usageFilters, ...patch }
      if (patch.page === undefined) next.page = 1
      rootStore.usageFilters = next
      notifyRoot()
      fetchUsage()
    }

    /** Open/close one run's attempt rows, fetching its detail the first time. */
    async function toggleUsageRun(runId) {
      const key = String(runId)
      if (key.length === 0) return
      if (rootStore.usageExpanded.has(key)) {
        rootStore.usageExpanded.delete(key)
        notifyRoot()
        return
      }
      rootStore.usageExpanded.add(key)
      notifyRoot()
      if (rootStore.usageRuns[key] !== undefined) return
      try {
        const result = await api('/usage-run', { runId: key })
        if (result !== null && typeof result === 'object' && result.ok === true
          && result.run !== null && typeof result.run === 'object') {
          rootStore.usageRuns[key] = result.run
        }
      } catch {
        // The row keeps its loading line; closing and reopening retries.
      }
      notifyRoot()
    }

    /**
     * Re-read the prices from the cost-meter service. The card renders the
     * rates the `/usage` envelope carries, so the refreshed table only shows
     * once that envelope has been re-fetched.
     */
    async function refreshPricing(t) {
      if (rootStore.pricingRefreshing) return
      rootStore.pricingRefreshing = true
      rootStore.error = null
      notifyRoot()
      try {
        const result = await api('/pricing-refresh', {})
        if (result !== null && typeof result === 'object' && result.ok === true) {
          const pricing = result.pricing !== null && typeof result.pricing === 'object' ? result.pricing : {}
          if (typeof t === 'function') {
            setRootNotice(t('notice.pricingRefreshed', {
              source: t(pricing.source === 'costMeter' ? 'pricing.sourceCostMeter' : 'pricing.sourceBundled'),
              asOf: typeof pricing.asOf === 'string' && pricing.asOf.length > 0 ? pricing.asOf : '—',
            }))
          }
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      } finally {
        rootStore.pricingRefreshing = false
      }
      await fetchUsage()
    }

    /** Which sparkline the bar strip shows; anything unknown means 30 days. */
    function setUsageSeries(value) {
      rootStore.usageSeries = value === '7' ? '7' : '30'
      notifyRoot()
    }

    /** One shared 10s poll, reference-counted so remounts never stack timers. */
    let usageTimer = null
    let usageMounts = 0

    function startUsagePolling() {
      usageMounts += 1
      if (usageTimer !== null || typeof setInterval !== 'function') return
      usageTimer = setInterval(() => {
        // A hidden tab costs nothing: the next visible tick catches up.
        if (typeof document !== 'undefined' && document !== null && document.hidden === true) return
        fetchUsage()
      }, 10000)
      unrefTimer(usageTimer)
    }

    function stopUsagePolling() {
      usageMounts = usageMounts > 0 ? usageMounts - 1 : 0
      if (usageMounts > 0 || usageTimer === null) return
      if (typeof clearInterval === 'function') clearInterval(usageTimer)
      usageTimer = null
    }

    function useRootVersion() {
      const [version, setVersion] = useState(0)
      useEffect(() => {
        const listener = () => setVersion((value) => value + 1)
        rootStore.listeners.add(listener)
        return () => {
          rootStore.listeners.delete(listener)
        }
      }, [])
      return version
    }

    async function initRootStore() {
      if (rootStore.initStarted) return
      rootStore.initStarted = true
      try {
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          rootStore.config = state.config !== null && typeof state.config === 'object' ? state.config : null
          rootStore.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : null
          rootStore.auto = state.auto !== null && typeof state.auto === 'object' ? state.auto : null
          rootStore.steering = state.steering !== null && typeof state.steering === 'object' ? state.steering : null
          rootStore.workspaces = Array.isArray(state.workspaces) ? state.workspaces : []
          rootStore.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
        const coached = await api('/history', { limit: 50 })
        if (coached !== null && typeof coached === 'object' && coached.ok && Array.isArray(coached.entries)) {
          rootStore.coached = coached.entries
        }
        const stats = await api('/stats', {})
        if (stats !== null && typeof stats === 'object' && stats.ok && stats.trend !== null && typeof stats.trend === 'object') {
          rootStore.trend = stats.trend
        }
        rootStore.initDone = true
      } catch (error) {
        rootStore.error = errorOf(error)
        rootStore.initDone = true
      }
      fetchUsage()
      notifyRoot()
    }

    /** Re-fetch profile/config so freshly distilled style rules show up. */
    async function refreshRootState() {
      try {
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          rootStore.config = state.config !== null && typeof state.config === 'object' ? state.config : null
          rootStore.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : null
          rootStore.auto = state.auto !== null && typeof state.auto === 'object' ? state.auto : null
          rootStore.steering = state.steering !== null && typeof state.steering === 'object' ? state.steering : null
          rootStore.workspaces = Array.isArray(state.workspaces) ? state.workspaces : []
          rootStore.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
      } catch {
        // Stale view beats a broken panel.
      }
      fetchUsage()
      notifyRoot()
    }

    async function updateRootConfig(patch) {
      rootStore.error = null
      try {
        const result = await api('/config', { patch })
        if (result !== null && typeof result === 'object' && result.ok && result.config !== null && typeof result.config === 'object') {
          rootStore.config = result.config
        } else {
          rootStore.error = {
            code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request',
            detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
          }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      // The warning thresholds live in the config, so the bars may have moved.
      fetchUsage()
      notifyRoot()
    }

    async function clearAllRoot() {
      rootStore.error = null
      try {
        const result = await api('/clear', {})
        if (result !== null && typeof result === 'object' && result.ok) {
          rootStore.coached = []
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      fetchUsage()
      // Turns without a report are eligible again, so a preview that last read
      // `eligible: 0` would otherwise keep the Bootstrap button disabled.
      await fetchBootstrapPreview()
      notifyRoot()
    }

    /**
     * Delete the usage ledger and restart the tracking window. The runs the
     * panel had expanded are dropped with it — their ids no longer exist.
     */
    async function clearUsageHistory() {
      rootStore.error = null
      try {
        const result = await api('/usage-clear', {})
        if (result !== null && typeof result === 'object' && result.ok) {
          rootStore.usageRuns = {}
          rootStore.usageExpanded = new Set()
          rootStore.usageFilters = { ...rootStore.usageFilters, page: 1 }
          if (translate !== null) setRootNotice(translate('notice.usageCleared', { n: fmtTokens(usageNum(result.removed)) }))
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      await fetchUsage()
      // The measured basis of the bootstrap estimate came from the ledger this
      // just deleted; re-price it rather than quoting figures that are gone.
      await fetchBootstrapPreview()
      notifyRoot()
    }

    /**
     * Ask before deleting. The two clears are the only irreversible actions in
     * the panel, so neither fires straight off a click: the kind is parked here
     * and the dialog does the asking.
     */
    function openConfirm(kind) {
      if (kind !== 'reports' && kind !== 'usage') return
      // Captured before the dialog steals focus, so closing it can hand focus
      // back to the button that opened it.
      captureConfirmOpener()
      rootStore.confirm = { kind }
      notifyRoot()
    }

    function closeConfirm() {
      rootStore.confirm = null
      notifyRoot()
      restoreConfirmOpener()
    }

    /** Run the parked destructive action, whichever it is, and close the dialog. */
    async function confirmAction() {
      const kind = rootStore.confirm !== null && typeof rootStore.confirm === 'object' ? rootStore.confirm.kind : null
      closeConfirm()
      if (kind === 'reports') await clearAllRoot()
      else if (kind === 'usage') await clearUsageHistory()
    }

    /**
     * "What would Bootstrap do, and what would it cost?" — read-only, no model
     * call. A failure leaves `preview` alone: the documented estimate stands in.
     */
    async function fetchBootstrapPreview() {
      try {
        const result = await api('/bootstrap-preview', { limit: 20 })
        if (result !== null && typeof result === 'object' && result.ok === true) rootStore.preview = result
      } catch {
        // One missing hint line; the next mount tries again.
      }
      notifyRoot()
    }

    /** Poll /state while a bootstrap runs so the counter moves; `apply` receives each snapshot. */
    function pollBootstrap(apply) {
      const tick = async () => {
        try {
          const state = await api('/state', {})
          const running = state !== null && typeof state === 'object' && state.bootstrap !== null && typeof state.bootstrap === 'object' && state.bootstrap.running === true
          apply(state)
          if (running) setTimeout(tick, 2000)
        } catch {
          // Give up quietly; the final response of the bootstrap call still lands.
        }
      }
      setTimeout(tick, 1500)
    }

    async function bootstrapSession(store) {
      if (store.bootstrap !== null && typeof store.bootstrap === 'object' && store.bootstrap.running) return
      store.bootstrap = { running: true, done: 0, total: 0 }
      store.error = null
      notify(store)
      pollBootstrap((state) => {
        if (state !== null && typeof state === 'object' && state.bootstrap !== null && typeof state.bootstrap === 'object') store.bootstrap = state.bootstrap
        notify(store)
      })
      try {
        const result = await api('/bootstrap', { sessionId: store.sessionId, limit: 20 })
        if (!(result !== null && typeof result === 'object' && result.ok)) {
          store.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed', detail: '' }
        }
        const reports = await api('/reports', { sessionId: store.sessionId })
        if (reports !== null && typeof reports === 'object' && reports.ok && reports.reports !== null && typeof reports.reports === 'object') store.reports = reports.reports
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          store.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : store.profile
          store.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
      } catch (error) {
        store.error = errorOf(error)
        store.bootstrap = null
      }
      notify(store)
    }

    /** `t` is the caller's bound translator, used only for the result notice. */
    async function bootstrapAll(t) {
      if (rootStore.bootstrap !== null && typeof rootStore.bootstrap === 'object' && rootStore.bootstrap.running) return
      rootStore.bootstrap = { running: true, done: 0, total: 0 }
      rootStore.error = null
      rootStore.notice = null
      notifyRoot()
      pollBootstrap((state) => {
        if (state !== null && typeof state === 'object' && state.bootstrap !== null && typeof state.bootstrap === 'object') rootStore.bootstrap = state.bootstrap
        notifyRoot()
      })
      try {
        const result = await api('/bootstrap', { limit: 20 })
        if (result !== null && typeof result === 'object' && result.ok) {
          if (typeof t === 'function') {
            setRootNotice(runNotice(t, 'notice.bootstrap', {
              analyzed: String(typeof result.analyzed === 'number' ? result.analyzed : 0),
              skipped: String(typeof result.skipped === 'number' ? result.skipped : 0),
            }, result.run))
          }
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      rootStore.initStarted = false
      rootStore.initDone = false
      // `initRootStore` refetches the ledger itself, so there is no `fetchUsage`
      // here: a second call would only duplicate the one the batch already
      // makes worth issuing.
      await initRootStore()
      // Fewer turns are eligible now, and the ledger has fresh measurements to
      // price the next batch from.
      await fetchBootstrapPreview()
    }

    async function editDirectives(payload) {
      rootStore.error = null
      try {
        const result = await api('/directives', payload)
        if (result !== null && typeof result === 'object' && result.ok) {
          if (result.profile !== null && typeof result.profile === 'object') rootStore.profile = result.profile
          if (result.steering !== null && typeof result.steering === 'object') rootStore.steering = result.steering
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      fetchUsage()
      notifyRoot()
    }

    /** One directive's audit receipt. Re-read on every expand: a trial's counters move while it runs. */
    async function fetchReceipt(id) {
      const key = String(id)
      if (key.length === 0) return
      rootStore.error = null
      try {
        const result = await api('/directive-receipt', { id: key })
        if (result !== null && typeof result === 'object' && result.ok === true
          && result.receipt !== null && typeof result.receipt === 'object') {
          rootStore.receipts[key] = result.receipt
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      notifyRoot()
    }

    async function initStore(store) {
      if (store === null || store.initStarted) return
      store.initStarted = true
      try {
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          store.config = state.config !== null && typeof state.config === 'object' ? state.config : null
          store.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : null
          store.auto = state.auto !== null && typeof state.auto === 'object' ? state.auto : null
          store.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
        const reports = await api('/reports', { sessionId: store.sessionId })
        if (reports !== null && typeof reports === 'object' && reports.ok && reports.reports !== null && typeof reports.reports === 'object') {
          store.reports = reports.reports
        }
        store.initDone = true
      } catch (error) {
        store.error = errorOf(error)
        store.initDone = true
      }
      notify(store)
    }

    function analyzeTurn(store, turn) {
      if (store.inFlight[String(turn)]) return
      store.inFlight[String(turn)] = true
      store.expanded.add(turn)
      store.error = null
      store.notice = null
      notify(store)
      // A turn that already has a report is only re-analyzed on purpose; the button reads "Re-analyze" then.
      api('/analyze', { sessionId: store.sessionId, turn, ...(store.reports[String(turn)] ? { force: true } : {}) })
        .then((result) => {
          if (result !== null && typeof result === 'object' && result.ok && result.report !== null && typeof result.report === 'object') {
            store.reports[String(turn)] = result.report
            store.error = null
            // What that one analysis cost, from the envelope's own run record.
            setStoreNotice(store, 'notice.analyze', { turn: String(turn) }, result.run)
          } else {
            store.error = {
              code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed',
              detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
            }
          }
          if (result !== null && typeof result === 'object' && result.profile !== null && typeof result.profile === 'object') {
            store.profile = result.profile
          }
        })
        .catch((error) => {
          store.error = errorOf(error)
        })
        .finally(() => {
          delete store.inFlight[String(turn)]
          notify(store)
        })
    }

    /**
     * Coach every ticked prompt in ONE `/analyze-batch` call.
     *
     * The host runs the whole selection under a single ledger run, so the tab
     * reports one price for the batch instead of N separate analyses — and the
     * turns settle together rather than one row at a time.
     */
    async function coachSelected(store) {
      if (store.batchRunning) return
      const turns = [...store.selection].sort((a, b) => a - b)
      if (turns.length === 0) return
      store.batchRunning = true
      store.error = null
      store.notice = null
      // Every ticked row shows its spinner for the whole call: the batch has no
      // per-turn progress to report.
      for (const turn of turns) store.inFlight[String(turn)] = true
      notify(store)
      try {
        const result = await api('/analyze-batch', { sessionId: store.sessionId, turns })
        if (result !== null && typeof result === 'object' && result.ok) {
          const results = Array.isArray(result.results) ? result.results : []
          let analyzed = 0
          let failure = null
          for (const entry of results) {
            if (entry === null || typeof entry !== 'object') continue
            const turn = typeof entry.turn === 'number' ? entry.turn : null
            if (entry.ok === true && entry.report !== null && typeof entry.report === 'object') {
              if (turn !== null) {
                store.reports[String(turn)] = entry.report
                store.expanded.add(turn)
              }
              analyzed += 1
              continue
            }
            // `busy` means an analysis of that turn was already running — a
            // race with the auto-analyzer, not a failure of this batch.
            const code = typeof entry.code === 'string' && entry.code.length > 0 ? entry.code : 'call-failed'
            if (failure === null && code !== 'busy' && code !== 'already-analyzed') failure = { code, detail: '' }
          }
          if (failure !== null) store.error = failure
          if (result.profile !== null && typeof result.profile === 'object') store.profile = result.profile
          // What the whole batch cost, from the run the host closed for it.
          setStoreNotice(store, 'notice.batch', { analyzed: String(analyzed), requested: String(turns.length) }, result.run)
        } else {
          store.error = {
            code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed',
            detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
          }
        }
      } catch (error) {
        store.error = errorOf(error)
      }
      for (const turn of turns) delete store.inFlight[String(turn)]
      store.selection.clear()
      store.batchRunning = false
      store.selecting = false
      notify(store)
      // The batch just spent money, and analyzed turns stop being eligible for
      // a bootstrap; the Settings page should say both.
      fetchUsage()
      fetchBootstrapPreview()
    }

    function toggleSelecting(store) {
      store.selecting = !store.selecting
      if (!store.selecting) store.selection.clear()
      notify(store)
    }

    function toggleReport(store, turn) {
      if (store.expanded.has(turn)) store.expanded.delete(turn)
      else store.expanded.add(turn)
      notify(store)
    }

    function improveDraft(store, draft) {
      if (store.preview.open || typeof draft !== 'string' || draft.trim().length === 0) return
      store.preview = { open: true, pending: true, original: draft, data: null, error: null }
      store.notice = null
      notify(store)
      api('/improve', { sessionId: store.sessionId, draft })
        .then((result) => {
          if (result !== null && typeof result === 'object' && result.ok && typeof result.improved === 'string' && result.improved.trim().length > 0) {
            store.preview = { ...store.preview, pending: false, data: result }
            setStoreNotice(store, 'notice.improve', {}, result.run)
          } else {
            store.preview = {
              ...store.preview,
              pending: false,
              error: {
                code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed',
                detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
              },
            }
          }
        })
        .catch((error) => {
          store.preview = { ...store.preview, pending: false, error: errorOf(error) }
        })
        .finally(() => notify(store))
    }

    /** Is the live improve feature enabled for this store? (No learning gate.) */
    function storeReady(store) {
      if (store === null || !store.initDone) return false
      const config = configOf(store.config)
      return config !== null && config.liveSuggestions !== false
    }

    function applyImproved(store, inputActions) {
      const data = store.preview.data
      if (data !== null && typeof data === 'object' && typeof data.improved === 'string'
        && inputActions !== undefined && inputActions !== null && typeof inputActions.setDraft === 'function') {
        inputActions.setDraft(data.improved)
      }
      // The feedback strip rides every applied rewrite while the feature is on.
      const rewriteId = data !== null && typeof data === 'object' && typeof data.rewriteId === 'string' && data.rewriteId.length > 0
        ? data.rewriteId
        : null
      if (storeReady(store) && rewriteId !== null) {
        store.feedback = { open: true, verdict: null, reason: '', sending: false, noted: false, rewriteId, fading: false }
        // Free bookkeeping on an existing call: host bumps `applied` and
        // captures the verification baseline for the next finished turn.
        api('/applied', { sessionId: store.sessionId, rewriteId }).catch(() => {})
      } else {
        store.feedback = { ...store.feedback, open: false }
      }
      store.preview = { open: false, pending: false, original: '', data: null, error: null }
      notify(store)
    }

    function closeFeedback(store) {
      store.feedback = { open: false, verdict: null, reason: '', sending: false, noted: false, rewriteId: null, fading: false }
      notify(store)
    }

    /** The strip fades out after the next send (observed via the input machine phase). */
    function fadeFeedback(store) {
      if (!store.feedback.open || store.feedback.fading) return
      store.feedback = { ...store.feedback, fading: true }
      notify(store)
      setTimeout(() => {
        if (store.feedback.open && store.feedback.fading) closeFeedback(store)
      }, 350)
    }

    /** 👍 posts immediately; 👎 expands the one-line reason field first. */
    function voteFeedback(store, verdict) {
      if (!store.feedback.open || store.feedback.sending || store.feedback.rewriteId === null) return
      if (verdict === 'down') {
        store.feedback = { ...store.feedback, verdict: 'down' }
        notify(store)
        return
      }
      sendFeedback(store, 'up')
    }

    function sendFeedback(store, verdict) {
      if (!store.feedback.open || store.feedback.sending || store.feedback.rewriteId === null) return
      const reason = verdict === 'down' ? store.feedback.reason.trim() : ''
      if (verdict === 'down' && reason.length === 0) return
      store.feedback = { ...store.feedback, sending: true }
      notify(store)
      const payload = { rewriteId: store.feedback.rewriteId, verdict }
      if (verdict === 'down') payload.reason = reason.slice(0, 300)
      api('/feedback', payload)
        .then((result) => {
          if (result !== null && typeof result === 'object' && result.ok && result.profile !== null && typeof result.profile === 'object') {
            store.profile = result.profile
            store.feedback = { ...store.feedback, sending: false, noted: true }
            notify(store)
            setTimeout(() => {
              if (store.feedback.noted) closeFeedback(store)
            }, 1500)
          } else {
            closeFeedback(store)
          }
        })
        .catch(() => closeFeedback(store))
    }

    function closePreview(store) {
      store.preview = { open: false, pending: false, original: '', data: null, error: null }
      notify(store)
    }

    async function updateConfig(store, patch) {
      try {
        const result = await api('/config', { patch })
        if (result !== null && typeof result === 'object' && result.ok && result.config !== null && typeof result.config === 'object') {
          store.config = result.config
        } else {
          store.error = {
            code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request',
            detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
          }
        }
      } catch (error) {
        store.error = errorOf(error)
      }
      notify(store)
    }

    async function clearReports(store) {
      store.error = null
      try {
        const result = await api('/clear', {})
        if (result !== null && typeof result === 'object' && result.ok) {
          store.reports = {}
          store.notice = { code: 'settings.cleared', n: typeof result.removed === 'number' ? result.removed : 0 }
        } else {
          store.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        store.error = errorOf(error)
      }
      notify(store)
    }

