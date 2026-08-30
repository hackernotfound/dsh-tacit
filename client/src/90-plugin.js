    // ── Client plugin body ──────────────────────────────────────────────────

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'dsh-tacit: dictionaries')
      const t = ctx.locale.bind(NS)
      // Store actions write result notices themselves — they hold the measured
      // figures — so the one bound translator is handed to them here.
      setTranslator(t)
      const kit = makeKit(t)
      injectCss()

      const CoachTabView = CoachTab(kit)
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'tacit',
        order: 30,
        locale: NS,
        label: () => t('tab'),
      }, (props) => h(CoachTabView, props)))

      const ImproveButtonView = ImproveButton(kit)
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'tacit-improve',
        order: 100,
        locale: NS,
        label: () => t('improve.btn'),
      }, (props) => h(ImproveButtonView, props)))

      const PreviewOverlayView = PreviewOverlay(kit)
      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay',
        id: 'tacit-preview',
        order: 10,
        locale: NS,
        inject: (sessionId) => ({ tacitStore: storeFor(sessionId) }),
      }, (props) => h(PreviewOverlayView, props)))

      // The post-apply 👍/👎 strip lives in the full-width row ABOVE the composer
      // card (input.dock). Not composer.dock: the harness hides that one until a
      // conversation has content, which is exactly when a first draft is improved.
      const FeedbackStripView = FeedbackStrip(kit)
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'tacit-feedback',
        order: 10,
        locale: NS,
        label: () => t('feedback.title'),
      }, (props) => h(FeedbackStripView, props)))

      // Own Settings page under "Cost": a nav section in the Settings panel,
      // on its own. Reuses the coach panel. Order 32 places it right after
      // cost-meter's "Cost" section (order 30/31).
      const SettingsSectionView = SettingsSection(kit)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'tacit',
        order: 32,
        locale: NS,
        label: () => t('settings.sectionLabel'),
      }, (props) => h(SettingsSectionView, props)))
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply,
      // Test-only handles for the SSR suite (ignored by the module loader).
      __test: {
        css,
        applyImproved,
        closePreview,
        closeFeedback,
        fadeFeedback,
        rootStore,
        toggleSection,
        setRootNotice,
        fetchUsage,
        setUsageFilter,
        toggleUsageRun,
        startUsagePolling,
        stopUsagePolling,
        setUsageSeries,
        refreshPricing,
        runNotice,
        fmtRate,
        UsageCard,
        PricingCard,
      },
    }
