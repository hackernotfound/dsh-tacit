    // ── Shared per-session store (tab + composer button + preview) ─────────

    function createSessionStore(sessionId) {
      return {
        sessionId,
        config: null,
        profile: null,
        auto: null, // {today, budget}
        bootstrap: null, // {running, done, total}
        reports: {},
        inFlight: {}, // String(turn) -> true
        selection: new Set(), // turn numbers ticked for batch analysis
        selecting: false, // selection mode (checkboxes + batch button) shown?
        expanded: new Set(), // turn numbers whose report is unfolded
        batchRunning: false,
        preview: { open: false, pending: false, original: '', data: null, error: null },
        // Feedback strip state for the last APPLIED improve response:
        // {open, verdict: null|'up'|'down', reason, sending, noted, rewriteId, fading}
        feedback: { open: false, verdict: null, reason: '', sending: false, noted: false, rewriteId: null, fading: false },
        error: null, // transient {code, detail} for the tab
        notice: null, // transient {code} after a successful settings action
        initStarted: false,
        initDone: false,
        listeners: new Set(),
      }
    }

    const sessionStores = new Map()
    function storeFor(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      let store = sessionStores.get(sessionId)
      if (store === undefined) {
        store = createSessionStore(sessionId)
        sessionStores.set(sessionId, store)
      }
      return store
    }

    function notify(store) {
      for (const listener of store.listeners) listener()
    }

    function useStoreVersion(store) {
      const [version, setVersion] = useState(0)
      useEffect(() => {
        if (store === null) return undefined
        const listener = () => setVersion((value) => value + 1)
        store.listeners.add(listener)
        return () => {
          store.listeners.delete(listener)
        }
      }, [store])
      return version
    }

