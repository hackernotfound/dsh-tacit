    // ── Global panel (Settings → Tacit section) ────────────────────────────

    function DirectivesEditor(kit) {
      const { t } = kit
      const fmtDay = (ms) => {
        const date = new Date(Number(ms))
        return !(Number(ms) > 0) || Number.isNaN(date.getTime()) ? t('steer.receiptNever') : date.toISOString().slice(0, 10)
      }
      const pct = (value) => (typeof value === 'number' && value >= 0 ? Math.round(value * 100) + '%' : t('steer.receiptNever'))
      const triggerName = (name) => {
        const key = 'trigger.' + name
        const label = t(key)
        return label === key ? name : label
      }
      const copyReceipt = (receipt) => {
        if (typeof navigator === 'undefined' || navigator === null || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return
        navigator.clipboard.writeText(JSON.stringify(receipt, null, 2)).catch(() => {})
      }
      const receiptRow = (label, value) => [h('dt', { key: label + '-t' }, label), h('dd', { key: label + '-d' }, value)]
      /** What the receipt route returned for this directive, as definition rows; never any prompt text. */
      function Receipt(receipt) {
        if (receipt === null || typeof receipt === 'object' === false) return h('div', { className: 'tacit-panel-hint' }, t('steer.receiptLoading'))
        const triggers = Object.entries(receipt.triggers !== null && typeof receipt.triggers === 'object' ? receipt.triggers : {})
          .map(([name, count]) => triggerName(name) + ' ' + String(count)).join(' · ')
        const evidence = receipt.evidence !== null && typeof receipt.evidence === 'object' ? receipt.evidence : { turns: 0, conversations: 0 }
        const cost = receipt.cost !== null && typeof receipt.cost === 'object' ? receipt.cost : { usd: null, calls: 0 }
        const trial = receipt.trial !== null && typeof receipt.trial === 'object' ? receipt.trial : null
        return h('div', null,
          h('dl', { className: 'tacit-receipt' },
            ...receiptRow(t('steer.receiptId'), String(receipt.id)),
            ...receiptRow(t('steer.receiptScope'), typeof receipt.scope === 'string' && receipt.scope.length > 0 ? receipt.scope : t('steer.everywhere')),
            ...receiptRow(t('steer.receiptStatus'), String(receipt.status)),
            ...receiptRow(t('steer.receiptSource'), receipt.source === 'user' ? t('steer.user') : t('steer.distilled')),
            ...receiptRow(t('steer.receiptCreated'), fmtDay(receipt.createdAt)),
            ...receiptRow(t('steer.receiptUpdated'), fmtDay(receipt.updatedAt)),
            ...receiptRow(t('steer.receiptEvaluated'), fmtDay(receipt.evaluatedAt)),
            ...receiptRow(t('steer.receiptVersion'), String(receipt.version)),
            ...receiptRow(t('steer.receiptTrial'), trial === null ? t('steer.receiptNever') : t('steer.receiptTrialValue', {
              turns: String(trial.turns), started: fmtDay(trial.startedAt), messy: pct(trial.baselineMessyRate), corrected: pct(trial.baselineCorrectionRate) })),
            ...receiptRow(t('steer.receiptTriggers'), triggers.length > 0 ? triggers : t('steer.receiptNever')),
            ...receiptRow(t('steer.receiptEvidence'), t('steer.receiptEvidenceValue', { turns: String(evidence.turns), conversations: String(evidence.conversations) })),
            ...receiptRow(t('steer.receiptCost'), cost.usd === null ? t('steer.receiptNoRun') : t('steer.receiptCostValue', { usd: fmtUsd(cost.usd), calls: String(cost.calls) }))),
          h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => copyReceipt(receipt) }, t('steer.receiptCopy')))
      }
      return function DirectivesEditorView(props) {
        const { config, steering } = props
        const directives = (Array.isArray(props.directives) ? props.directives : []).filter((entry) => entry.status !== 'removed')
        const receipts = rootStore.receipts !== null && typeof rootStore.receipts === 'object' ? rootStore.receipts : {}
        const reviewOn = config !== null && config.reviewCandidates === true
        const workspaces = Array.isArray(props.workspaces) ? props.workspaces : []
        const seenAt = props.seenAt !== null && typeof props.seenAt === 'object' ? props.seenAt : {}
        const liveScope = (scope) => workspaces.some((entry) => entry.cwd === scope || String(entry.cwd).startsWith(scope + '/'))
        const notSeenSince = (entry) => {
          const stamp = typeof seenAt[entry.workspace] === 'number' ? seenAt[entry.workspace] : entry.createdAt
          const date = new Date(Number(stamp))
          return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
        }
        const scopeOptions = (current) => {
          const options = [
            h('option', { key: '-', value: '-' }, t('steer.moveTo')),
            h('option', { key: '', value: '' }, t('steer.everywhere')),
          ]
          for (const entry of workspaces) options.push(h('option', { key: entry.cwd, value: entry.cwd }, entry.label))
          if (current.length > 0 && !workspaces.some((entry) => entry.cwd === current)) options.push(h('option', { key: current, value: current }, labelOf(current)))
          return options
        }
        const [draft, setDraft] = useState('')
        const [scope, setScope] = useState('')
        const labelOf = (cwd) => {
          const parts = String(cwd).split(/[\\/]+/).filter((part) => part.length > 0)
          return parts.length > 0 ? parts[parts.length - 1] : String(cwd)
        }
        const [steerOn, setSteerOn] = useState(config !== null && config.steerAgent !== false)
        const [enrichOn, setEnrichOn] = useState(config !== null && config.enrichPrompts === true)
        useEffect(() => {
          if (config !== null && typeof config.steerAgent === 'boolean') setSteerOn(config.steerAgent)
          if (config !== null && typeof config.enrichPrompts === 'boolean') setEnrichOn(config.enrichPrompts)
        }, [config])
        const toggleSteer = () => {
          const next = !steerOn
          setSteerOn(next)
          updateRootConfig({ steerAgent: next })
        }
        const toggleEnrich = () => {
          const next = !enrichOn
          setEnrichOn(next)
          updateRootConfig({ enrichPrompts: next })
        }
        const toggleReview = () => updateRootConfig({ reviewCandidates: !reviewOn })
        const onAdd = () => {
          const text = draft.trim()
          if (text.length === 0) return
          setDraft('')
          editDirectives({ action: 'add', text: text.slice(0, 300), ...(scope.length > 0 ? { workspace: scope } : {}) })
        }
        return h('div', { className: 'tacit-panel-section', 'data-testid': 'tacit-steering' },
          h('div', { className: 'tacit-report-title' }, t('steer.title')),
          h('div', { className: 'tacit-panel-hint' }, t('steer.desc')),
          h('div', { className: 'tacit-settings-row' },
            h('label', { className: 'tacit-settings-label' }, t('steer.toggle')),
            h('input', { type: 'checkbox', checked: steerOn, onChange: toggleSteer })),
          h('div', { className: 'tacit-settings-row' },
            h('label', { className: 'tacit-settings-label' }, t('steer.enrich')),
            h('input', { type: 'checkbox', checked: enrichOn, onChange: toggleEnrich })),
          h('div', { className: 'tacit-settings-row' },
            h('label', { className: 'tacit-settings-label' }, t('steer.review')),
            h('input', { type: 'checkbox', checked: reviewOn, onChange: toggleReview })),
          directives.length === 0
            ? h('div', { className: 'tacit-empty' }, t('steer.empty'))
            : h('div', { className: 'tacit-rules-list' },
              directives.map((entry) => h('div', { key: entry.id, className: 'tacit-directive-block' },
                h('div', { className: 'tacit-rule tacit-directive' + (entry.enabled === false ? ' tacit-directive-off' : '') },
                h('input', {
                  type: 'checkbox',
                  className: 'tacit-check',
                  'data-testid': 'tacit-directive-toggle',
                  checked: entry.enabled !== false,
                  onChange: () => editDirectives({ action: 'toggle', id: entry.id, enabled: entry.enabled === false }),
                }),
                h('span', { className: 'tacit-directive-text' }, String(entry.text)),
                h('span', { className: 'tacit-chip' }, entry.source === 'user' ? t('steer.user') : t('steer.distilled')),
                typeof entry.workspace === 'string' && entry.workspace.length > 0
                  ? h('span', { className: 'tacit-chip tacit-chip-scope', title: entry.workspace }, t('steer.workspace', { name: labelOf(entry.workspace) }))
                  : null,
                typeof entry.workspace === 'string' && entry.workspace.length > 0 && !liveScope(entry.workspace)
                  ? h('span', { className: 'tacit-chip tacit-chip-muted', title: entry.workspace }, t('steer.notSeen', { date: notSeenSince(entry) }))
                  : null,
                entry.status === 'queued'
                  ? h('span', { className: 'tacit-chip tacit-chip-muted' }, t('steer.queued'))
                  : entry.status === 'candidate'
                    ? h('span', { className: 'tacit-chip tacit-chip-trial' }, t('steer.trial', {
                      n: String(entry.trial !== null && typeof entry.trial === 'object' && typeof entry.trial.turns === 'number' ? entry.trial.turns : 0),
                      total: String(config !== null && typeof config.directiveTrialTurns === 'number' ? config.directiveTrialTurns : 10),
                    }))
                    : entry.status === 'retired'
                      ? h('span', { className: 'tacit-chip tacit-chip-warn' }, t('steer.retired', { reason: String(entry.retiredReason || '') }))
                      : h('span', { className: 'tacit-chip tacit-chip-ok' }, t('steer.active')),
                reviewOn && entry.status === 'queued' && !(entry.approvedAt > 0)
                  ? h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => editDirectives({ action: 'start-trial', id: entry.id }) }, t('steer.startTrial'))
                  : null,
                h('select', {
                  className: 'tacit-input tacit-select tacit-select-sm',
                  'aria-label': t('steer.moveTo'),
                  onChange: (event) => {
                    if (event.target.value !== '-') editDirectives({ action: 'rescope', id: entry.id, workspace: event.target.value })
                  },
                }, ...scopeOptions(typeof entry.workspace === 'string' ? entry.workspace : '')),
                h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => editDirectives({ action: 'remove', id: entry.id }) }, t('steer.remove'))),
                h('details', {
                  className: 'tacit-preview',
                  'data-testid': 'tacit-receipt',
                  'data-directive-id': entry.id,
                  onToggle: (event) => {
                    if (event.target.open) fetchReceipt(entry.id)
                  },
                },
                h('summary', null, t('steer.receipt')),
                Receipt(receipts[entry.id] ?? null))))),
          h('div', { className: 'tacit-settings-row' },
            h('input', {
              className: 'tacit-input tacit-directive-input',
              type: 'text',
              maxLength: 300,
              placeholder: t('steer.addPlaceholder'),
              'aria-label': t('steer.add'),
              value: draft,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') onAdd()
              },
            }),
            workspaces.length > 0
              ? h('select', {
                className: 'tacit-input tacit-select',
                'aria-label': t('steer.scope'),
                value: scope,
                onChange: (event) => setScope(event.target.value),
              },
              h('option', { value: '' }, t('steer.everywhere')),
              ...workspaces.map((entry) => h('option', { key: entry.cwd, value: entry.cwd }, entry.label)))
              : null,
            h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', disabled: draft.trim().length === 0, onClick: onAdd }, t('steer.add'))),
          steering !== null && typeof steering === 'object' && typeof steering.text === 'string' && steering.text.length > 0
            ? h('details', { className: 'tacit-preview' },
              h('summary', null, t('steer.preview')),
              h('pre', { className: 'tacit-pre' }, steering.text))
            : null)
      }
    }

    /** Days offered by the retention select; the host clamps to 7–365 anyway. */
    const RETENTION_DAYS = [7, 14, 30, 90, 180, 365]

    /**
     * The `/bootstrap-preview` envelope, narrowed. `null` for anything that is
     * not a successful preview, so the Overview card falls back to the
     * documented estimate rather than pricing an envelope it cannot read.
     */
    function previewOf(value) {
      if (value === null || typeof value !== 'object' || value.ok !== true) return null
      if (typeof value.eligible !== 'number' || !Number.isFinite(value.eligible)) return null
      const estimate = value.estimate !== null && typeof value.estimate === 'object' ? value.estimate : {}
      return {
        eligible: Math.max(0, Math.floor(value.eligible)),
        usd: typeof estimate.usd === 'number' && Number.isFinite(estimate.usd) ? estimate.usd : null,
        basis: estimate.basis === 'measured' ? 'measured' : 'doc',
        samples: typeof estimate.samples === 'number' && Number.isFinite(estimate.samples) ? Math.max(0, Math.floor(estimate.samples)) : 0,
      }
    }

    function CoachPanel(kit) {
      const { t, fmtTime } = kit
      const DirectivesEditorView = DirectivesEditor(kit)
      return function CoachPanelView() {
        useRootVersion()
        useEffect(() => {
          initRootStore()
        }, [])

        const config = configOf(rootStore.config)
        const profile = profileOf(rootStore.profile)
        const [model, setModel] = useState(config !== null && typeof config.model === 'string' ? config.model : 'deepseek-v4-flash')
        const [budgetText, setBudgetText] = useState(config !== null && typeof config.autoDailyBudget === 'number' ? String(config.autoDailyBudget) : '30')
        const [auto, setAuto] = useState(config !== null && config.autoAnalyze !== false)
        const [learnGood, setLearnGood] = useState(config !== null && config.learnFromGood !== false)
        const [live, setLive] = useState(config !== null && config.liveSuggestions !== false)
        // The two USD thresholds follow the budget field's text-state + Apply
        // pattern: money is typed a character at a time, and clamping mid-typing
        // fights the user. `0` is a real value here (the warning off), so the
        // fallback is `??`, never `||`.
        const [dailyText, setDailyText] = useState(config !== null && typeof config.costWarnDailyUsd === 'number' ? String(config.costWarnDailyUsd) : '0')
        const [monthlyText, setMonthlyText] = useState(config !== null && typeof config.costWarnMonthlyUsd === 'number' ? String(config.costWarnMonthlyUsd) : '0')

        useEffect(() => {
          if (config !== null) {
            if (typeof config.model === 'string') setModel(config.model)
            if (typeof config.autoDailyBudget === 'number') setBudgetText(String(config.autoDailyBudget))
            if (typeof config.autoAnalyze === 'boolean') setAuto(config.autoAnalyze)
            if (typeof config.learnFromGood === 'boolean') setLearnGood(config.learnFromGood)
            if (typeof config.liveSuggestions === 'boolean') setLive(config.liveSuggestions)
            if (typeof config.costWarnDailyUsd === 'number') setDailyText(String(config.costWarnDailyUsd))
            if (typeof config.costWarnMonthlyUsd === 'number') setMonthlyText(String(config.costWarnMonthlyUsd))
          }
        }, [config])

        const applyModel = (value) => {
          setModel(value)
          updateRootConfig({ model: value })
        }
        const applyBudget = () => {
          const number = Math.max(0, Math.min(1000, Math.round(Number(budgetText) || 0)))
          setBudgetText(String(number))
          updateRootConfig({ autoDailyBudget: number })
        }
        const toggleLearnGood = () => {
          const next = !learnGood
          setLearnGood(next)
          updateRootConfig({ learnFromGood: next })
        }
        const toggleAuto = () => {
          const next = !auto
          setAuto(next)
          updateRootConfig({ autoAnalyze: next })
        }
        const toggleLive = () => {
          const next = !live
          setLive(next)
          updateRootConfig({ liveSuggestions: next })
        }
        /** One USD threshold: never negative, `0` = off, no rounding to whole dollars. */
        const applyWarn = (key, text, setText) => {
          const typed = String(text).trim()
          // An empty field means "off". Anything that is not a number at all is
          // a typo: silently writing 0 would turn a warning off behind the
          // user's back, so the entry is left alone instead.
          if (typed.length > 0 && !Number.isFinite(Number(typed))) return
          const value = Math.max(0, typed.length === 0 ? 0 : Number(typed))
          setText(String(value))
          updateRootConfig({ [key]: value })
        }

        const coached = Array.isArray(rootStore.coached) ? rootStore.coached : []
        const error = rootStore.error
        const styleRules = rootStore.profile !== null && typeof rootStore.profile === 'object' && Array.isArray(rootStore.profile.styleRules)
          ? rootStore.profile.styleRules.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.rule === 'string' && entry.rule.length > 0)
          : []
        const directives = rootStore.profile !== null && typeof rootStore.profile === 'object' && Array.isArray(rootStore.profile.directives)
          ? rootStore.profile.directives.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.text === 'string')
          : []

        const sections = rootStore.sections !== null && typeof rootStore.sections === 'object' ? rootStore.sections : {}
        const notice = rootStore.notice !== null && typeof rootStore.notice === 'object' && typeof rootStore.notice.text === 'string'
          ? rootStore.notice
          : null
        // Rates ride the /usage envelope, so the Pricing card reads them there
        // rather than calling a route of its own on every render.
        const usageReport = usageOf(rootStore.usage)
        const usagePricing = usageReport === null ? null : usageReport.pricing
        const preview = previewOf(rootStore.preview)
        const confirm = rootStore.confirm !== null && typeof rootStore.confirm === 'object' && rootStore.confirm.kind === 'usage'
          ? 'usage'
          : (rootStore.confirm !== null && typeof rootStore.confirm === 'object' && rootStore.confirm.kind === 'reports' ? 'reports' : null)
        const retention = config !== null && typeof config.costHistoryDays === 'number' && Number.isFinite(config.costHistoryDays) && config.costHistoryDays > 0
          ? config.costHistoryDays
          : 30
        // A value set by hand in the YAML need not be one of the offered days.
        // It gets an option of its own, in place, rather than being displayed
        // as a neighbour it is not.
        const retentionDays = RETENTION_DAYS.includes(retention)
          ? RETENTION_DAYS
          : [...RETENTION_DAYS, retention].sort((a, b) => a - b)
        /** Every card is titled by `card.<id>` and driven by `rootStore.sections`. */
        const card = (id, children, extra) => SectionCard(kit, {
          id,
          title: t('card.' + id),
          open: sections[id] === true,
          onToggle: () => toggleSection(id),
          children,
          ...(extra !== undefined ? extra : {}),
        })

        return h('div', { className: 'tacit-panel' },
          error !== null && typeof error === 'object'
            ? h('div', { className: 'tacit-error' }, t('err.' + String(error.code), { detail: String(error.detail || '') }))
            : null,
          // Above the cards, and always mounted: a live region that appears
          // together with its text is missed by screen readers, and one nested
          // in the Overview body would be silent while that card is collapsed.
          h('div', { className: 'tacit-settings-notice', role: 'status' }, notice === null ? '' : notice.text),
          card('overview', [
            StatusCard(kit, { config, profile, auto: rootStore.auto, trend: rootStore.trend }),
            config !== null && typeof config.model === 'string' && config.model.length > 0
              ? h('div', { className: 'tacit-settings-row' },
                h('span', { className: 'tacit-chip' }, t('overview.model', { model: config.model })))
              : null,
            h('div', { className: 'tacit-settings-row' },
              BootstrapButton(kit, {
                bootstrap: rootStore.bootstrap,
                // Only a loaded preview may disable the button: before one
                // lands, "0 eligible" is an absence of data, not a fact.
                disabled: preview !== null && preview.eligible === 0,
                onClick: () => bootstrapAll(t),
              }),
              h('span', { className: 'tacit-panel-hint' }, t('bootstrap.hint'))),
            // What the run would actually cost, priced from the ledger once it
            // holds enough analyses; until the preview lands, the documented
            // figure stands in.
            preview === null
              ? h('p', { className: 'tacit-panel-hint' }, t('bootstrap.estimateDoc'))
              : h('p', { className: 'tacit-panel-hint' },
                // An estimate the host could not price says so; `fmtUsd(null)`
                // would read `$0.0000` and claim the run is free.
                t('bootstrap.preview', {
                  eligible: String(preview.eligible),
                  usd: preview.usd === null ? t('usage.priceUnavailable') : fmtUsd(preview.usd),
                }),
                ' ',
                preview.basis === 'measured'
                  ? t('bootstrap.previewMeasured', { samples: String(preview.samples) })
                  : t('bootstrap.previewDoc')),
          ]),
          card('usage', [
            UsageCard(kit, {
              usage: rootStore.usage,
              config,
              filters: rootStore.usageFilters,
              series: rootStore.usageSeries,
              expanded: rootStore.usageExpanded,
              runs: rootStore.usageRuns,
              onFilter: (patch) => setUsageFilter(patch),
              onToggleRun: (runId) => toggleUsageRun(runId),
              onSeries: (value) => setUsageSeries(value),
            }),
          ]),
          card('pricing', [
            PricingCard(kit, {
              pricing: usagePricing,
              refreshing: rootStore.pricingRefreshing === true,
              onRefresh: () => refreshPricing(t),
            }),
          ], { summary: pricingSummary(kit, usagePricing) }),
          card('learning', [
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
          ]),
          card('guidance', [
            h(DirectivesEditorView, {
              workspaces: rootStore.workspaces, config, directives, steering: rootStore.steering,
              seenAt: rootStore.profile !== null && typeof rootStore.profile === 'object' ? rootStore.profile.workspaceSeenAt : null }),
          ]),
          card('improve', [
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label' }, t('settings.live')),
              h('input', { type: 'checkbox', checked: live, onChange: toggleLive })),
            h('div', { className: 'tacit-panel-section' },
              h('div', { className: 'tacit-report-title' }, t('panel.styleRules')),
              styleRules.length === 0
                ? h('div', { className: 'tacit-empty' }, t('panel.styleRulesEmpty'))
                : h('div', { className: 'tacit-rules-list' },
                  styleRules.map((entry, index) => h('div', { key: 'rule-' + index, className: 'tacit-rule' }, String(entry.rule))))),
            h('p', { className: 'tacit-panel-hint' }, t('improve.explain')),
          ]),
          card('history', [
            h('div', { className: 'tacit-panel-section' },
              h('div', { className: 'tacit-report-title' }, t('panel.coached')),
              coached.length === 0
                ? h('div', { className: 'tacit-empty' }, t('panel.coachedEmpty'))
                : h('div', { className: 'tacit-coached-list' },
                  coached.map((entry, index) => h('div', { key: 'c' + index, className: 'tacit-coached-row' },
                    h('div', { className: 'tacit-coached-meta' },
                      h('span', { className: 'tacit-coached-turn' }, (typeof entry.sessionLabel === 'string' && entry.sessionLabel.length > 0 ? entry.sessionLabel + ' · ' : '') + '# ' + String(entry.turn)),
                      h('span', { className: 'tacit-coached-time' }, fmtTime(entry.time)),
                      h('span', { className: 'tacit-chip tacit-coached-trigger' }, t('trigger.' + (entry.trigger === 'auto' || entry.trigger === 'correction' || entry.trigger === 'bootstrap' ? entry.trigger : 'manual')))),
                    typeof entry.promptExcerpt === 'string' && entry.promptExcerpt.length > 0
                      ? h('div', { className: 'tacit-coached-excerpt' }, entry.promptExcerpt)
                      : null,
                    typeof entry.improvedPrompt === 'string' && entry.improvedPrompt.length > 0
                      ? h('div', { className: 'tacit-coached-improved' }, entry.improvedPrompt.slice(0, 240) + (entry.improvedPrompt.length > 240 ? '…' : ''))
                      : null)))),
            h('p', { className: 'tacit-panel-hint' }, t('panel.hint')),
          ], { count: coached.length }),
          card('privacy', [
            h('p', { className: 'tacit-panel-hint' }, t('privacy.stored')),
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label', htmlFor: 'tacit-retention' }, t('privacy.retention')),
              h('select', {
                id: 'tacit-retention',
                className: 'tacit-select',
                value: String(retention),
                onChange: (event) => updateRootConfig({ costHistoryDays: Number(event.target.value) }),
              },
              ...retentionDays.map((days) => h('option', { key: days, value: String(days) }, String(days))))),
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label', htmlFor: 'tacit-warn-daily' }, t('privacy.warnDaily')),
              h('input', {
                id: 'tacit-warn-daily',
                className: 'tacit-input',
                type: 'number',
                min: 0,
                step: '0.01',
                value: dailyText,
                onChange: (event) => setDailyText(event.target.value),
              }),
              h('button', {
                type: 'button',
                className: 'tacit-btn tacit-btn-sm',
                // Two identically labelled buttons in one card: the accessible
                // name has to say which threshold each one applies.
                'aria-label': t('privacy.applyTo', { action: t('privacy.apply'), field: t('privacy.warnDaily') }),
                onClick: () => applyWarn('costWarnDailyUsd', dailyText, setDailyText),
              }, t('privacy.apply'))),
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label', htmlFor: 'tacit-warn-monthly' }, t('privacy.warnMonthly')),
              h('input', {
                id: 'tacit-warn-monthly',
                className: 'tacit-input',
                type: 'number',
                min: 0,
                step: '0.01',
                value: monthlyText,
                onChange: (event) => setMonthlyText(event.target.value),
              }),
              h('button', {
                type: 'button',
                className: 'tacit-btn tacit-btn-sm',
                // Two identically labelled buttons in one card: the accessible
                // name has to say which threshold each one applies.
                'aria-label': t('privacy.applyTo', { action: t('privacy.apply'), field: t('privacy.warnMonthly') }),
                onClick: () => applyWarn('costWarnMonthlyUsd', monthlyText, setMonthlyText),
              }, t('privacy.apply'))),
            h('p', { className: 'tacit-panel-hint' }, t('privacy.warnHint')),
            // Both clears are irreversible, so both go through the dialog.
            h('div', { className: 'tacit-settings-row' },
              h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => openConfirm('reports') }, t('settings.clear')),
              h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => openConfirm('usage') }, t('privacy.clearUsage'))),
          ]),
          // Always rendered (null while closed) so its one effect keeps this
          // component's hook count stable.
          ConfirmDialog(kit, {
            open: confirm !== null,
            title: t(confirm === 'usage' ? 'confirm.usageTitle' : 'confirm.reportsTitle'),
            body: t(confirm === 'usage' ? 'confirm.usageBody' : 'confirm.reportsBody'),
            confirmLabel: t('confirm.clear'),
            onConfirm: () => confirmAction(),
            onCancel: () => closeConfirm(),
          }))
      }
    }

    function SettingsSection(kit) {
      const { t } = kit
      const CoachPanelView = CoachPanel(kit)
      return function SettingsSectionView() {
        useEffect(() => {
          initRootStore()
          // Fresh read so freshly distilled style rules appear on open.
          refreshRootState()
          // What a bootstrap would cost right now, priced from the ledger.
          fetchBootstrapPreview()
          // One shared 10s /usage poll while any Tacit settings page is mounted.
          startUsagePolling()
          return stopUsagePolling
        }, [])
        return h('div', { className: 'tacit-root' },
          h('div', { className: 'tacit-head' }, h('div', { className: 'tacit-head-title' }, t('panel.title'))),
          h(CoachPanelView))
      }
    }

