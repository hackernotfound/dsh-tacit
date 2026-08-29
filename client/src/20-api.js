    // ── API client (the host half's own routes on the harness origin) ──────

    async function api(pathName, payload) {
      const response = await fetch('/api/tacit' + pathName, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        // Server envelopes carry a code (forbidden, bad-request, internal…);
        // surface it so the dictionary can explain instead of a generic "network".
        const error = new Error('http ' + String(response.status))
        error.code = data !== null && typeof data === 'object' && typeof data.code === 'string' && data.code.length > 0 ? data.code : 'network'
        error.detail = data !== null && typeof data === 'object' && typeof data.detail === 'string' ? data.detail : ''
        throw error
      }
      if (data === null || typeof data !== 'object') throw new Error('bad response')
      return data
    }

    /** {code, detail} for the UI from any thrown value (network failures → 'network'). */
    function errorOf(error) {
      return {
        code: error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'network',
        detail: error !== null && typeof error === 'object' && typeof error.detail === 'string' ? error.detail : '',
      }
    }

