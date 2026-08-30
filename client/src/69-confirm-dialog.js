    // ── Confirm dialog (destructive actions) ───────────────────────────────

    /**
     * What had focus when a destructive action was requested.
     *
     * It is captured by the store action that opens the dialog rather than by
     * the dialog itself: React focuses the `autoFocus`ed Cancel button while it
     * commits, so by the time an effect runs the opener is already gone.
     */
    let confirmOpener = null

    function captureConfirmOpener() {
      confirmOpener = typeof document !== 'undefined' && document !== null ? document.activeElement : null
    }

    /**
     * One small modal confirmation, rendered unconditionally by its owner (and
     * `null` when closed) so React's hook count never changes between renders.
     * Hook-free but for the focus restore, which is the one thing it cannot do
     * with markup alone.
     *
     * Cancel comes first and takes focus: the safe answer is the one a keyboard
     * or screen-reader user reaches without looking.
     */
    function ConfirmDialog(kit, { open, title, body, confirmLabel, onConfirm, onCancel }) {
      const { t } = kit
      const isOpen = open === true
      useEffect(() => {
        if (!isOpen || typeof document === 'undefined') return undefined
        const opener = confirmOpener
        return () => {
          if (opener !== null && typeof opener.focus === 'function') opener.focus()
        }
      }, [isOpen])
      if (!isOpen) return null
      const cancel = typeof onCancel === 'function' ? onCancel : () => {}
      return h('div', {
        className: 'tacit-modal-backdrop',
        onClick: cancel,
        // Escape cancels from anywhere inside: keydown from either button
        // bubbles here.
        onKeyDown: (event) => {
          if (event.key === 'Escape') cancel()
        },
      },
      h('div', {
        className: 'tacit-modal-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'tacit-confirm-title',
        // A click on the card is not a click on the backdrop.
        onClick: (event) => event.stopPropagation(),
      },
      h('h3', { className: 'tacit-modal-title', id: 'tacit-confirm-title' }, title),
      h('p', { className: 'tacit-confirm-body' }, body),
      h('div', { className: 'tacit-confirm-actions' },
        h('button', { type: 'button', className: 'tacit-btn', autoFocus: true, onClick: cancel }, t('confirm.cancel')),
        h('button', { type: 'button', className: 'tacit-btn tacit-btn-danger', onClick: onConfirm }, confirmLabel))))
    }

