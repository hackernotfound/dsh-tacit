    // ── Collapsible section card (Settings → Tacit) ────────────────────────

    /**
     * One accessible collapsible card.
     *
     * A `<details>` would be shorter, but its open state lives in the DOM: the
     * store could not drive it and the SSR suite could not seed it. So this is
     * the button/`aria-expanded`/`aria-controls` pattern instead, with the body
     * always in the DOM and only the `hidden` attribute toggled — the content
     * stays findable (browser find-in-page aside) and nothing remounts.
     */
    function SectionCard(kit, { id, title, summary, count, open, onToggle, children }) {
      const { t } = kit
      const key = String(id)
      const isOpen = open === true
      const bodyId = 'tacit-card-' + key + '-body'
      const label = isOpen ? t('card.collapse') : t('card.expand')
      const kids = Array.isArray(children) ? children : (children === undefined || children === null ? [] : [children])
      return h('div', { className: 'tacit-card' },
        h('button', {
          type: 'button',
          className: 'tacit-card-head',
          id: 'tacit-card-' + key + '-head',
          'aria-expanded': isOpen,
          'aria-controls': bodyId,
          onClick: onToggle,
        },
        h('span', { className: 'tacit-card-title' }, title),
        typeof summary === 'string' && summary.length > 0
          ? h('span', { className: 'tacit-card-summary' }, summary)
          : null,
        count !== undefined && count !== null
          ? h('span', { className: 'tacit-card-count' }, String(count))
          : null,
        h('span', { className: 'tacit-card-chevron', 'aria-label': label, title: label }, isOpen ? '▾' : '▸')),
        h('div', { className: 'tacit-card-body', id: bodyId, hidden: !isOpen }, ...kids))
    }

