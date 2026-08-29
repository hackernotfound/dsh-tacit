    // ── Components ─────────────────────────────────────────────────────────

    function makeKit(t) {
      return { t, fmt, fmtTime }
    }

    /** "Learned from N prompts · Auto-learning on · x/y today" status card. */
    /** "Learn from my last 20 turns" — spinner label while a bootstrap runs. */
    function BootstrapButton(kit, { bootstrap, onClick }) {
      const { t } = kit
      const running = bootstrap !== null && bootstrap !== undefined && typeof bootstrap === 'object' && bootstrap.running === true
      return h('span', { className: 'tacit-bootstrap' },
        h('button', {
          type: 'button',
          className: 'tacit-btn tacit-btn-sm',
          disabled: running,
          title: t('bootstrap.hint'),
          onClick,
        }, running
          ? t('bootstrap.running', { done: String(typeof bootstrap.done === 'number' ? bootstrap.done : 0), total: String(typeof bootstrap.total === 'number' ? bootstrap.total : 0) })
          : t('bootstrap.btn')))
    }

    function pct(value) {
      return String(Math.round((Number(value) || 0) * 100)) + '%'
    }

    function StatusCard(kit, { config, profile, auto, trend }) {
      const { t } = kit
      const hasTrend = trend !== null && trend !== undefined && typeof trend === 'object' && trend.enough === true
        && trend.early !== null && typeof trend.early === 'object' && trend.recent !== null && typeof trend.recent === 'object'
      const analyzed = profile !== null ? profile.analyzedCount : 0
      const autoOn = config !== null && config.autoAnalyze !== false
      const today = auto !== null && typeof auto === 'object' && typeof auto.today === 'number' ? auto.today : 0
      const budget = auto !== null && typeof auto === 'object' && typeof auto.budget === 'number'
        ? auto.budget
        : (config !== null && typeof config.autoDailyBudget === 'number' ? config.autoDailyBudget : 30)
      return h('div', { className: 'tacit-progress' },
        h('div', { className: 'tacit-progress-head' },
          h('span', { className: 'tacit-progress-title' }, t('status.learned', { count: String(analyzed) })),
          h('span', { className: 'tacit-progress-count' }, autoOn ? t('status.autoOn', { today: String(today), budget: String(budget) }) : '')),
        h('div', { className: 'tacit-progress-text' }, autoOn ? t('status.autoHint') : t('status.autoOff')),
        hasTrend
          ? h('div', { className: 'tacit-trend' },
            h('span', { className: 'tacit-chip' }, t('status.trendMessy', { a: pct(trend.early.messyRate), b: pct(trend.recent.messyRate) })),
            h('span', { className: 'tacit-chip' }, t('status.trendTokens', { a: fmt(trend.early.tokensPerTurn), b: fmt(trend.recent.tokensPerTurn) })),
            h('span', { className: 'tacit-progress-text' }, t('status.trendHint', { n: String(trend.window) })))
          : null)
    }

    function ProblemRow(kit, problem, index) {
      const { t } = kit
      const severity = String(problem.severity === 'high' || problem.severity === 'medium' || problem.severity === 'low' ? problem.severity : 'info')
      const sevClass = 'tacit-sev-' + (severity === 'info' ? 'info' : severity)
      return h('div', { key: 'p' + index, className: 'tacit-problem' },
        h('div', { className: 'tacit-problem-head' },
          h('span', { className: 'tacit-problem-kind' }, String(problem.kind || 'general')),
          h('span', { className: 'tacit-problem-sev ' + sevClass }, t('sev.' + severity))),
        h('div', { className: 'tacit-problem-what' }, String(problem.what || '')),
        h('div', { className: 'tacit-problem-why' }, String(problem.why || '')))
    }

    function ReportCard(props) {
      const { kit, report } = props
      const { t } = kit
      const [copied, setCopied] = useState(false)
      if (report === null) return null
      const improved = report.improvedPrompt
      const onCopy = () => {
        copyText(improved)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
      return h('div', { className: 'tacit-report' },
        h('div', { className: 'tacit-report-title' },
          report.trigger === 'good' ? t('report.strengths') : t('report.problems'),
          ' ',
          h('span', { className: 'tacit-chip tacit-chip-trigger' + (report.trigger === 'good' ? ' tacit-chip-ok' : '') }, t('trigger.' + report.trigger))),
        report.trigger === 'good'
          ? (Array.isArray(report.strengths) && report.strengths.length > 0
            ? report.strengths.map((strength, index) => h('div', { key: index, className: 'tacit-problem' },
              h('span', { className: 'tacit-chip tacit-chip-ok' }, String(strength.kind)),
              ' ',
              h('span', { className: 'tacit-problem-what' }, String(strength.what))))
            : h('div', { className: 'tacit-report-note' }, '—'))
          : report.problems.length === 0
            ? h('div', { className: 'tacit-report-note' }, '—')
            : report.problems.map((problem, index) => ProblemRow(kit, problem, index)),
        report.trigger === 'good' ? null : h('div', { className: 'tacit-report-title' }, t('report.improved')),
        report.trigger === 'good' ? null : improved.length > 0
          ? h('div', { className: 'tacit-report-improved' },
            h('div', { className: 'tacit-report-actions' },
              h('button', {
                type: 'button',
                className: 'tacit-btn tacit-btn-sm',
                onClick: onCopy,
              }, copied ? t('report.copied') : t('report.copy'))),
            h('div', { className: 'tacit-report-body' },
              MarkdownText !== null
                ? h(MarkdownText, { text: improved })
                : h('pre', { className: 'tacit-pre' }, improved)))
          : h('div', { className: 'tacit-report-note' }, t('report.emptyImproved')),
        typeof report.explanation === 'string' && report.explanation.length > 0
          ? h('div', null,
            h('div', { className: 'tacit-report-title' }, report.trigger === 'good' ? t('report.lesson') : t('report.explanation')),
            h('div', { className: 'tacit-report-body' },
              MarkdownText !== null
                ? h(MarkdownText, { text: report.explanation })
                : h('pre', { className: 'tacit-pre' }, report.explanation)))
          : null)
    }

    function TurnRow(props) {
      const { kit, store, turn, isNewest } = props
      const { t, fmtTime } = kit
      const [expanded, setExpanded] = useState(false)
      const analyzing = store.inFlight[String(turn.turn)] === true
      const report = reportOf(store.reports[String(turn.turn)])
      const selected = store.selection.has(turn.turn)
      const reportOpen = store.expanded.has(turn.turn)
      const usage = turn.usage !== null && typeof turn.usage === 'object' ? turn.usage : {}
      const tokens = (typeof usage.inputTokens === 'number' ? usage.inputTokens : 0)
        + (typeof usage.outputTokens === 'number' ? usage.outputTokens : 0)
      const tools = Array.isArray(turn.toolCalls) ? turn.toolCalls.length : 0
      const prompt = typeof turn.prompt === 'string' ? turn.prompt : ''
      const promptPreview = prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt

      const toggleSelected = () => {
        if (selected) store.selection.delete(turn.turn)
        else store.selection.add(turn.turn)
        notify(store)
      }

      // A turn without turn/end is live only when it is the newest one; an
      // older unfinished turn belonged to a session that was interrupted.
      const status = turn.finished === true
        ? null
        : (isNewest === true
          ? h('span', { className: 'tacit-row-live' }, t('turn.running'))
          : h('span', { className: 'tacit-chip tacit-chip-muted' }, t('turn.interrupted')))

      return h('div', { className: 'tacit-row' + (report !== null ? ' tacit-row-analyzed' : '') },
        h('div', { className: 'tacit-row-head' },
          store.selecting
            ? h('input', {
              type: 'checkbox',
              className: 'tacit-check',
              checked: selected,
              title: t('turn.select'),
              onChange: toggleSelected,
            })
            : null,
          h('div', { className: 'tacit-row-heading' },
            h('span', { className: 'tacit-row-turn' }, '# ' + String(turn.turn)),
            h('span', { className: 'tacit-row-time' }, fmtTime(turn.startedAt)),
            report !== null ? h('span', { className: 'tacit-chip tacit-chip-trigger' }, t('trigger.' + report.trigger)) : null,
            status),
          h('div', { className: 'tacit-row-chips' },
            h('span', { className: 'tacit-chip' }, t('turn.tools', { n: String(tools) })),
            h('span', { className: 'tacit-chip' }, t('turn.steps', { n: String(typeof turn.steps === 'number' ? turn.steps : 0) })),
            h('span', { className: 'tacit-chip' }, t('turn.tokens', { n: fmt(tokens) })),
            typeof turn.retries === 'number' && turn.retries > 0
              ? h('span', { className: 'tacit-chip tacit-chip-warn' }, t('turn.retries', { n: String(turn.retries) }))
              : null,
            report !== null
              ? h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => toggleReport(store, turn.turn) },
                t('turn.report') + (reportOpen ? ' ▾' : ' ▸'))
              : null,
            h('button', {
              type: 'button',
              className: 'tacit-btn tacit-btn-sm tacit-btn-quiet',
              disabled: analyzing,
              onClick: () => analyzeTurn(store, turn.turn),
            }, analyzing ? t('turn.analyzing') : (report !== null ? t('turn.reanalyze') : t('turn.analyze'))))),
        prompt.length > 0
          ? h('div', { className: 'tacit-row-prompt' },
            h('button', {
              type: 'button',
              className: 'tacit-row-prompt-text',
              onClick: () => setExpanded((open) => !open),
            }, expanded ? prompt : promptPreview),
            prompt.length > 120
              ? h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => setExpanded((open) => !open) },
                expanded ? t('turn.collapse') : t('turn.expand'))
              : null)
          : null,
        typeof turn.enrichment === 'string' && turn.enrichment.length > 0
          ? h('div', { className: 'tacit-row-enrichment' },
            h('span', { className: 'tacit-report-title' }, t('turn.enrichment')),
            h('div', { className: 'tacit-pre' }, turn.enrichment))
          : null,
        report !== null && reportOpen ? h(ReportCard, { kit, report }) : null)
    }

    function SettingsPanel(props) {
      const { kit, store } = props
      const { t } = kit
      const config = configOf(store.config)
      const [model, setModel] = useState(config !== null && typeof config.model === 'string' ? config.model : 'deepseek-v4-flash')
      const [budgetText, setBudgetText] = useState(config !== null && typeof config.autoDailyBudget === 'number' ? String(config.autoDailyBudget) : '30')
      const [auto, setAuto] = useState(config !== null && config.autoAnalyze !== false)
      const [learnGood, setLearnGood] = useState(config !== null && config.learnFromGood !== false)
      const [live, setLive] = useState(config !== null && config.liveSuggestions !== false)
      const [notice, setNotice] = useState(null)

      useEffect(() => {
        if (config !== null) {
          if (typeof config.model === 'string') setModel(config.model)
          if (typeof config.autoDailyBudget === 'number') setBudgetText(String(config.autoDailyBudget))
          if (typeof config.autoAnalyze === 'boolean') setAuto(config.autoAnalyze)
          if (typeof config.learnFromGood === 'boolean') setLearnGood(config.learnFromGood)
          if (typeof config.liveSuggestions === 'boolean') setLive(config.liveSuggestions)
        }
      }, [config])

      const applyModel = (value) => {
        setModel(value)
        updateConfig(store, { model: value })
      }
      const applyBudget = () => {
        const number = Math.max(0, Math.min(1000, Math.round(Number(budgetText) || 0)))
        setBudgetText(String(number))
        updateConfig(store, { autoDailyBudget: number })
      }
      const toggleLearnGood = () => {
        const next = !learnGood
        setLearnGood(next)
        updateConfig(store, { learnFromGood: next })
      }
      const toggleAuto = () => {
        const next = !auto
        setAuto(next)
        updateConfig(store, { autoAnalyze: next })
      }
      const toggleLive = () => {
        const next = !live
        setLive(next)
        updateConfig(store, { liveSuggestions: next })
      }
      const onClear = async () => {
        await clearReports(store)
        if (store.notice !== null && store.notice.code === 'settings.cleared') {
          setNotice(t(store.notice.code, { n: String(store.notice.n) }))
          setTimeout(() => setNotice(null), 3000)
        }
      }

      return h('div', { className: 'tacit-settings' },
        h('div', { className: 'tacit-settings-title' }, t('settings.title')),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.model')),
          h('select', {
            className: 'tacit-select',
            value: model,
            onChange: (event) => applyModel(event.target.value),
          },
          h('option', { value: 'deepseek-v4-flash' }, 'deepseek-v4-flash'),
          h('option', { value: 'deepseek-v4-pro' }, 'deepseek-v4-pro'))),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.auto')),
          h('input', { type: 'checkbox', checked: auto, onChange: toggleAuto })),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.learnGood')),
          h('input', { type: 'checkbox', checked: learnGood, onChange: toggleLearnGood })),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.budget')),
          h('input', {
            className: 'tacit-input',
            type: 'number',
            min: 0,
            value: budgetText,
            onChange: (event) => setBudgetText(event.target.value),
          }),
          h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: applyBudget }, t('settings.apply'))),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.live')),
          h('input', { type: 'checkbox', checked: live, onChange: toggleLive })),
        h('div', { className: 'tacit-settings-row' },
          h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: onClear }, t('settings.clear')),
          notice !== null ? h('span', { className: 'tacit-settings-notice' }, notice) : null))
    }

    function CoachTab(kit) {
      const { t } = kit
      return function CoachTabView(props) {
        const sessionId = props.sessionId
        const store = storeFor(sessionId)
        useStoreVersion(store)
        useEffect(() => {
          if (store !== null) initStore(store)
        }, [store])
        const [settingsOpen, setSettingsOpen] = useState(false)

        if (store === null) {
          return h('div', { className: 'tacit-root' }, h('div', { className: 'tacit-empty' }, t('err.no-session')))
        }

        const rawTurns = typeof props.useProjection === 'function' ? props.useProjection('tacitTimeline') : undefined
        const turns = turnsOf(rawTurns).slice().reverse()
        const config = configOf(store.config)
        const profile = profileOf(store.profile)
        const selectedCount = store.selection.size
        const error = store.error

        return h('div', { className: 'tacit-root' },
          h('div', { className: 'tacit-head' },
            h('div', { className: 'tacit-head-title' }, t('tab')),
            h('button', {
              type: 'button',
              className: 'tacit-btn',
              onClick: () => setSettingsOpen((open) => !open),
            }, settingsOpen ? t('settings.close') : t('settings'))),
          StatusCard(kit, { config, profile, auto: store.auto }),
          settingsOpen ? h(SettingsPanel, { kit, store }) : null,
          error !== null && typeof error === 'object'
            ? h('div', { className: 'tacit-error' }, t('err.' + String(error.code), { detail: String(error.detail || '') }))
            : null,
          turns.length === 0
            ? h('div', { className: 'tacit-empty' }, t('empty'))
            : h('div', null,
              h('div', { className: 'tacit-toolbar' },
                h('span', { className: 'tacit-panel-hint tacit-toolbar-hint' }, t('manual.hint')),
                BootstrapButton(kit, { bootstrap: store.bootstrap, onClick: () => bootstrapSession(store) }),
                h('button', {
                  type: 'button',
                  className: 'tacit-btn tacit-btn-sm',
                  onClick: () => toggleSelecting(store),
                }, store.selecting ? t('coach.selectDone') : t('coach.select')),
                store.selecting
                  ? h('button', {
                    type: 'button',
                    className: 'tacit-btn tacit-btn-sm tacit-btn-primary',
                    disabled: selectedCount === 0 || store.batchRunning,
                    onClick: () => coachSelected(store),
                  }, store.batchRunning ? t('coach.batchRunning') : t('coach.selected', { n: String(selectedCount) }))
                  : null),
              turns.map((turn, index) => h(TurnRow, { key: String(turn.turn), kit, store, turn, isNewest: index === 0 }))))
      }
    }

    function ImproveButton(kit) {
      const { t } = kit
      return function ImproveButtonView(props) {
        const sessionId = props.sessionId
        const store = storeFor(sessionId)
        useStoreVersion(store)
        useEffect(() => {
          if (store !== null) initStore(store)
        }, [store])

        if (!storeReady(store)) return null

        const draft = props.input !== null && typeof props.input === 'object' && typeof props.input.draft === 'string'
          ? props.input.draft
          : ''

        return h('button', {
          type: 'button',
          className: 'tacit-improve-btn',
          title: t('improve.btn'),
          onClick: () => improveDraft(store, draft),
        }, '✨ ' + t('improve.btn'))
      }
    }

    function PreviewOverlay(kit) {
      const { t } = kit
      return function PreviewOverlayView(props) {
        const store = props.tacitStore !== null && typeof props.tacitStore === 'object'
          ? props.tacitStore
          : null
        useStoreVersion(store)
        if (store === null || !store.preview.open) return null

        const preview = store.preview
        const onApply = () => applyImproved(store, props.inputActions)
        const onCancel = () => closePreview(store)
        const improvedText = preview.data !== null && typeof preview.data === 'object' && typeof preview.data.improved === 'string'
          ? preview.data.improved
          : ''
        // The model returns a finished draft verbatim (its fixed point): show
        // that instead of two identical columns, and offer no Apply so a no-op
        // rewrite never counts as applied.
        const unchanged = !preview.pending && preview.error === null && improvedText.trim() === preview.original.trim()

        return h('div', { className: 'tacit-modal-backdrop' },
          h('div', { className: 'tacit-modal-card' },
            h('div', { className: 'tacit-modal-head' },
              h('span', { className: 'tacit-modal-title' }, t('preview.title')),
              h('button', { type: 'button', className: 'tacit-modal-close', onClick: onCancel }, '×')),
            preview.pending
              ? h('div', { className: 'tacit-modal-pending' }, t('preview.pending'))
              : preview.error !== null
                ? h('div', { className: 'tacit-error' },
                  t('err.' + String(preview.error.code), { detail: String(preview.error.detail || '') }))
                : h('div', null,
                  unchanged
                    ? h('div', { className: 'tacit-modal-unchanged' }, t('preview.unchanged'))
                    : h('div', { className: 'tacit-modal-cols' },
                      h('div', { className: 'tacit-modal-col' },
                        h('div', { className: 'tacit-modal-col-title' }, t('preview.original')),
                        h('pre', { className: 'tacit-pre' }, preview.original)),
                      h('div', { className: 'tacit-modal-col' },
                        h('div', { className: 'tacit-modal-col-title' }, t('preview.improved')),
                        h('pre', { className: 'tacit-pre' }, improvedText))),
                  preview.data !== null && typeof preview.data === 'object' && typeof preview.data.rationale === 'string' && preview.data.rationale.length > 0
                    ? h('div', { className: 'tacit-modal-rationale' },
                      h('div', { className: 'tacit-modal-col-title' }, t('preview.rationale')),
                      h('div', { className: 'tacit-modal-rationale-text' }, preview.data.rationale))
                    : null,
                  h('div', { className: 'tacit-modal-actions' },
                    unchanged
                      ? null
                      : h('button', { type: 'button', className: 'tacit-btn tacit-btn-primary', onClick: onApply }, t('preview.apply')),
                    h('button', { type: 'button', className: 'tacit-btn', onClick: onCancel }, t('preview.cancel'))))))
      }
    }

