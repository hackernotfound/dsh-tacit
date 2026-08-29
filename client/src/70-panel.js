    // ── Global panel (Settings → Tacit section) ────────────────────────────

    function DirectivesEditor(kit) {
      const { t } = kit
      return function DirectivesEditorView(props) {
        const { config, directives, steering } = props
        const workspaces = Array.isArray(props.workspaces) ? props.workspaces : []
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
          directives.length === 0
            ? h('div', { className: 'tacit-empty' }, t('steer.empty'))
            : h('div', { className: 'tacit-rules-list' },
              directives.map((entry) => h('div', { key: entry.id, className: 'tacit-rule tacit-directive' + (entry.enabled === false ? ' tacit-directive-off' : '') },
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
                entry.status === 'candidate'
                  ? h('span', { className: 'tacit-chip tacit-chip-trial' }, t('steer.trial', {
                    n: String(entry.trial !== null && typeof entry.trial === 'object' && typeof entry.trial.turns === 'number' ? entry.trial.turns : 0),
                    total: String(config !== null && typeof config.directiveTrialTurns === 'number' ? config.directiveTrialTurns : 10),
                  }))
                  : entry.status === 'retired'
                    ? h('span', { className: 'tacit-chip tacit-chip-warn' }, t('steer.retired', { reason: String(entry.retiredReason || '') }))
                    : h('span', { className: 'tacit-chip tacit-chip-ok' }, t('steer.active')),
                h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => editDirectives({ action: 'remove', id: entry.id }) }, t('steer.remove'))))),
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
          card('overview', [
            StatusCard(kit, { config, profile, auto: rootStore.auto, trend: rootStore.trend }),
            config !== null && typeof config.model === 'string' && config.model.length > 0
              ? h('div', { className: 'tacit-settings-row' },
                h('span', { className: 'tacit-chip' }, t('overview.model', { model: config.model })))
              : null,
            h('div', { className: 'tacit-settings-row' },
              BootstrapButton(kit, { bootstrap: rootStore.bootstrap, onClick: () => bootstrapAll(t) }),
              h('span', { className: 'tacit-panel-hint' }, t('bootstrap.hint'))),
            h('p', { className: 'tacit-panel-hint' }, t('bootstrap.estimateDoc')),
            notice !== null
              ? h('div', { className: 'tacit-settings-notice', role: 'status' }, notice.text)
              : null,
          ]),
          card('usage', [h('p', { className: 'tacit-panel-hint' }, t('usage.pending'))]),
          card('pricing', [h('p', { className: 'tacit-panel-hint' }, t('usage.pending'))]),
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
              workspaces: rootStore.workspaces, config, directives, steering: rootStore.steering }),
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
            h('div', { className: 'tacit-settings-row' },
              h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => clearAllRoot() }, t('settings.clear'))),
            h('p', { className: 'tacit-panel-hint' }, t('privacy.stored')),
          ]))
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
        }, [])
        return h('div', { className: 'tacit-root' },
          h('div', { className: 'tacit-head' }, h('div', { className: 'tacit-head-title' }, t('panel.title'))),
          h(CoachPanelView))
      }
    }

