// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — browser-facing HTTP routes on the harness's own web
 * server (the same transport dsh-memento's panel uses). No third-party
 * server, no extra port: the GUI already talks to these /api/* routes on the
 * harness origin.
 *
 * Registered through the guarded `webServer` service; disposers are collected
 * into one ctx.effect so a fiber unload removes every route.
 */

/**
 * Run `fn(service)` as soon as `serviceName` exists — immediately when it is
 * already registered, otherwise once on the next `internal/service` event for
 * it (the listener removes itself). Exported so the service layer can wait on
 * optional siblings (e.g. `costMeter`) the same way the routes wait on
 * `webServer`.
 */
export function withService(ctx, serviceName, fn) {
  const existing = ctx.get !== undefined && typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
  if (existing !== undefined && existing !== null) {
    fn(existing)
    return
  }
  if (ctx.on !== undefined && typeof ctx.on === 'function') {
    const off = ctx.on('internal/service', (name) => {
      if (name !== serviceName) return
      const service = ctx.get !== undefined && typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
      if (service !== undefined && service !== null) {
        off()
        fn(service)
      }
    })
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/** Read a JSON request body (bounded); never rejects — returns {} on any problem. */
async function readJsonBody(req) {
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of req) {
      if (chunk === null || chunk === undefined) continue
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > 256 * 1024) return null
      chunks.push(buffer)
    }
  } catch {
    return null
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Cross-site request guard. The harness web server has no origin policy, and
 * Tacit's routes write into the agent's system prompt (directives) and spend
 * money (analyze/improve/bootstrap) — so a web page must not be able to drive
 * them from another origin. Browsers block cross-origin `application/json`
 * fetches at the CORS preflight; this closes the remaining "simple request"
 * shapes (forms, text/plain) and honours the fetch-metadata headers.
 * Non-browser callers (curl, the smoke script) carry none of these headers and
 * pass; the browser client always sends application/json from the same origin.
 */
function crossSiteReason(req) {
  const headers = req !== null && typeof req === 'object' && req.headers !== null && typeof req.headers === 'object' ? req.headers : {}
  const site = typeof headers['sec-fetch-site'] === 'string' ? headers['sec-fetch-site'].toLowerCase() : ''
  if (site !== '' && site !== 'same-origin' && site !== 'none') return 'sec-fetch-site'
  const origin = typeof headers.origin === 'string' ? headers.origin : ''
  const host = typeof headers.host === 'string' ? headers.host : ''
  if (origin !== '' && origin !== 'null' && host !== '') {
    let originHost = ''
    try { originHost = new URL(origin).host } catch { originHost = '' }
    if (originHost !== host) return 'origin'
  }
  const type = typeof headers['content-type'] === 'string' ? headers['content-type'].toLowerCase() : ''
  if (type !== '' && !type.startsWith('application/json')) return 'content-type'
  return ''
}

/**
 * Register the /api/tacit/* routes against the harness web server.
 * `service` is the object returned by createCoachService.
 */
export function registerWebRoutes(ctx, service) {
  withService(ctx, 'webServer', (webServer) => {
    if (webServer === null || typeof webServer.register !== 'function') return
    const disposers = []
    const route = (method, pathName, handler) => {
      disposers.push(webServer.register({
        kind: 'exact',
        path: pathName,
        handler: async (req, res) => {
          try {
            if (typeof req.method === 'string' && req.method.toUpperCase() !== method) {
              sendJson(res, 405, { ok: false, code: 'bad-request', detail: 'method' })
              return
            }
            const reason = crossSiteReason(req)
            if (reason !== '') {
              sendJson(res, 403, { ok: false, code: 'forbidden', detail: reason })
              return
            }
            const body = await readJsonBody(req)
            if (body === null) {
              sendJson(res, 400, { ok: false, code: 'bad-json', detail: '' })
              return
            }
            const result = await handler(body)
            // Malformed or orphaned feedback/applied requests are rejected
            // with an HTTP 400 (soft envelopes keep the other codes at 200).
            const rejected = result !== null && typeof result === 'object' && result.ok === false
              && (result.code === 'bad-request' || result.code === 'unknown-rewrite')
            sendJson(res, rejected ? 400 : 200, result)
          } catch (error) {
            const detail = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
            sendJson(res, 500, { ok: false, code: 'internal', detail })
          }
        },
      }))
    }

    route('POST', '/api/tacit/state', (body) => service.getState(body))
    route('POST', '/api/tacit/reports', (body) => service.getReports(body))
    route('POST', '/api/tacit/history', (body) => service.listHistory(body))
    route('POST', '/api/tacit/analyze', (body) => service.analyzeTurn(body))
    route('POST', '/api/tacit/improve', (body) => service.improveDraft(body))
    route('POST', '/api/tacit/feedback', (body) => service.feedback(body))
    route('POST', '/api/tacit/applied', (body) => service.applied(body))
    route('POST', '/api/tacit/directives', (body) => service.directives(body))
    route('POST', '/api/tacit/stats', (body) => service.stats(body))
    route('POST', '/api/tacit/bootstrap', (body) => service.bootstrap(body))
    route('POST', '/api/tacit/config', (body) => service.updateConfig(body))
    route('POST', '/api/tacit/clear', () => service.clearReports())
    route('POST', '/api/tacit/usage', (body) => service.usageReport(body))
    route('POST', '/api/tacit/usage-run', (body) => service.usageRun(body))
    route('POST', '/api/tacit/usage-clear', () => service.usageClear())
    route('POST', '/api/tacit/pricing-refresh', () => service.pricingRefresh())

    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose?.()
        } catch {
          // Best-effort teardown.
        }
      }
    }, 'tacit: web routes')
  })
}
