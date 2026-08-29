    // ── Formatting & defensive narrowing ───────────────────────────────────

    function fmt(n) {
      const value = Number(n)
      if (!Number.isFinite(value)) return '—'
      const sign = value < 0 ? '-' : ''
      const abs = Math.abs(value)
      if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M'
      if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'k'
      return sign + String(Math.round(abs))
    }

    function fmtTime(ms) {
      const date = new Date(Number(ms))
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleTimeString('en-GB', { hour12: false })
    }

    function turnsOf(value) {
      if (value === null || typeof value !== 'object' || !Array.isArray(value.turns)) return []
      return value.turns.filter((turn) => turn !== null && typeof turn === 'object' && typeof turn.turn === 'number')
    }

    function profileOf(value) {
      if (value === null || typeof value !== 'object') return null
      return {
        analyzedCount: typeof value.analyzedCount === 'number' ? value.analyzedCount : 0,
      }
    }

    function configOf(value) {
      if (value === null || typeof value !== 'object') return null
      return value
    }

    function reportOf(value) {
      if (value === null || typeof value !== 'object') return null
      const problems = Array.isArray(value.problems)
        ? value.problems.filter((p) => p !== null && typeof p === 'object')
        : []
      return {
        ok: value.ok === true,
        turn: typeof value.turn === 'number' ? value.turn : 0,
        model: typeof value.model === 'string' ? value.model : '',
        problems,
        improvedPrompt: typeof value.improvedPrompt === 'string' ? value.improvedPrompt : '',
        explanation: typeof value.explanation === 'string' ? value.explanation : '',
        trigger: value.trigger === 'auto' || value.trigger === 'correction' || value.trigger === 'bootstrap' ? value.trigger : 'manual',
        followUp: typeof value.followUp === 'string' ? value.followUp : '',
      }
    }

    function copyText(text) {
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
        return
      }
      fallbackCopy(text)
    }

    function fallbackCopy(text) {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch {
        // Clipboard unavailable; the text remains selectable in the card.
      }
    }

