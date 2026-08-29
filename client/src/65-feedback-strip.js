    // ── Feedback strip (above the composer, Improve enabled only) ───────────

    function FeedbackStrip(kit) {
      const { t } = kit
      return function FeedbackStripView(props) {
        const store = storeFor(props.sessionId)
        useStoreVersion(store)
        useEffect(() => {
          if (store !== null) initStore(store)
        }, [store])
        // The input machine's phase: 'submitting' means the user sent — the
        // strip fades out right after the next send.
        const phase = typeof props.useInput === 'function'
          ? props.useInput((state) => (state === null || typeof state !== 'object' ? '' : state.phase))
          : ''
        useEffect(() => {
          if (phase === 'submitting' && store !== null && store.feedback.open && !store.feedback.sending) {
            fadeFeedback(store)
          }
        }, [phase, store])

        if (store === null || !store.feedback.open) return null
        const feedback = store.feedback
        const reason = feedback.reason

        return h('div', {
          className: 'tacit-feedback' + (feedback.fading ? ' tacit-feedback-fading' : ''),
          'data-testid': 'tacit-feedback',
        },
        feedback.noted
          ? h('span', { className: 'tacit-feedback-noted' }, t('feedback.noted'))
          : h('div', { className: 'tacit-feedback-row' },
            h('span', { className: 'tacit-feedback-title' }, t('feedback.title')),
            h('button', {
              type: 'button',
              className: 'tacit-feedback-vote',
              title: t('feedback.up'),
              'aria-label': t('feedback.up'),
              onClick: () => voteFeedback(store, 'up'),
            }, '👍'),
            h('button', {
              type: 'button',
              className: 'tacit-feedback-vote' + (feedback.verdict === 'down' ? ' tacit-feedback-vote-active' : ''),
              title: t('feedback.down'),
              'aria-label': t('feedback.down'),
              onClick: () => voteFeedback(store, 'down'),
            }, '👎'),
            feedback.verdict === 'down'
              ? h('div', { className: 'tacit-feedback-reason' },
                h('input', {
                  className: 'tacit-input tacit-feedback-input',
                  type: 'text',
                  maxLength: 300,
                  placeholder: t('feedback.reasonPlaceholder'),
                  value: reason,
                  onChange: (event) => {
                    store.feedback = { ...store.feedback, reason: event.target.value }
                    notify(store)
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'tacit-btn tacit-btn-sm',
                  disabled: feedback.sending || reason.trim().length === 0,
                  onClick: () => sendFeedback(store, 'down'),
                }, feedback.sending ? '…' : t('feedback.send')))
              : null))
      }
    }

