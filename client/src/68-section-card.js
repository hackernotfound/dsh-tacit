    // ── Collapsible section card (Settings → Tacit) ────────────────────────

    /**
     * One settings row: a label that takes the slack and wraps, and its
     * control(s) right-aligned. `htmlFor` names the control when it has an id;
     * checkbox settings use `OptionRow` instead, which is a label all through.
     */
    function FieldRow(label, control, htmlFor) {
      const controls = Array.isArray(control) ? control : [control]
      return h('div', { className: 'tacit-field' },
        h('label', {
          className: 'tacit-field-label',
          ...(typeof htmlFor === 'string' && htmlFor.length > 0 ? { htmlFor } : {}),
        }, label),
        h('div', { className: 'tacit-field-control' }, ...controls))
    }

    /**
     * One checkbox setting as a clickable `<label>`, so the hit target is the
     * whole sentence rather than a 14px box.
     */
    function OptionRow(label, checked, onChange, extra) {
      return h('label', { className: 'tacit-option' },
        h('input', {
          type: 'checkbox',
          className: 'tacit-check',
          checked,
          onChange,
          ...(extra !== null && typeof extra === 'object' ? extra : {}),
        }),
        h('span', null, label))
    }

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
        // A zero count is silence, not a figure worth a chip.
        typeof count === 'number' && count > 0
          ? h('span', { className: 'tacit-card-count' }, String(count))
          : null,
        h('span', {
          className: 'tacit-chevron tacit-card-chevron' + (isOpen ? ' tacit-chevron-open' : ''),
          'aria-label': label,
          title: label,
        }, '›')),
        h('div', { className: 'tacit-card-body', id: bodyId, hidden: !isOpen }, ...kids))
    }

