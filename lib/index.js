// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — host half entry.
 *
 * Loaded by the profile's bundle patch row (`cordis.patch.yml`):
 *   - registers the `tacitTimeline` session projection (the trajectory
 *     fold the browser reads via useProjection);
 *   - provides the `tacit` service and its /api/tacit/* routes;
 *   - injects the learned directives as a system-prompt section;
 *   - stores everything under $DSH_HOME/storages/tacit/.
 *
 * The plugin shares the harness process, so it only talks to services through
 * the duck-typed `ctx` — no cordis runtime imports, no second instance of
 * anything stateful. API keys are handled entirely by the harness's own LLM
 * service.
 */

import fs from 'node:fs'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Config } from './schema.js'
import { createTimelineDefinition } from './fold.js'
import { CoachStore } from './store.js'
import { createCoachService, mergeConfig } from './service.js'
import { registerWebRoutes } from './routes.js'

export const name = 'tacit'
export { Config }

/**
 * One-time adoption of the plugin's previous name: an existing
 * storages/prompt-coach directory becomes storages/tacit (rename only —
 * nothing is deleted; when both exist the newer one wins untouched).
 * Safe to drop after 0.3.0 — every dsh-prompt-coach user has migrated by then.
 */
export function migrateLegacyStorage(dshHome) {
  const legacy = path.join(dshHome, 'storages', 'prompt-coach')
  const current = path.join(dshHome, 'storages', 'tacit')
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(current)) fs.renameSync(legacy, current)
  } catch {
    // Best effort: a failed rename just means a fresh profile.
  }
  return current
}

export function apply(ctx, config) {
  const store = new CoachStore(migrateLegacyStorage(resolveDshHome()))
  const effectiveConfig = () => mergeConfig(config, store.configPatch())

  // Trajectory fold. Guarded inject so assemblies without the projection
  // registry (headless) simply skip this half instead of failing.
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(createTimelineDefinition(() => effectiveConfig()))
  })

  // Browser-facing service + routes.
  const service = createCoachService(ctx, store, effectiveConfig)
  ctx.provide('tacit', service)
  registerWebRoutes(ctx, service)

  // Ambient steering: the learned directives ride every session's system
  // prompt (order 60: after the persona, before tool guidance). Guarded
  // inject — assemblies without a system-prompt service simply skip it.
  ctx.inject(['systemPrompt'], (scope) => {
    if (scope.systemPrompt === undefined || scope.systemPrompt === null || typeof scope.systemPrompt.section !== 'function') return
    scope.systemPrompt.section({
      name: 'tacit:steering',
      order: 60,
      text: (assemble) => service.steeringText(assemble),
    })
  })

  // Opt-in pre-send enrichment (config.enrichPrompts, default off): append a
  // learned context note to the first step of a turn; never rewrites the
  // user's message. The listener itself is a no-op while the option is off.
  if (typeof ctx.on === 'function') {
    const off = ctx.on('agent/pre-step', (payload, next) => service.preStep(payload, next))
    if (typeof off === 'function') ctx.effect(() => off, 'tacit: pre-step enrichment')
  }

  // One line so an audit can tell from the logs alone that Tacit is loaded
  // and what it is currently injecting.
  try {
    const cfg = effectiveConfig()
    const directives = store.profile().directives
    const count = (status) => directives.filter((entry) => entry.status === status).length
    console.info('[tacit] loaded — directives: ' + count('active') + ' active, ' + count('candidate') + ' candidates, '
      + count('retired') + ' retired; steering ' + (cfg.steerAgent ? 'on' : 'off') + '; auto-analysis '
      + (cfg.autoAnalyze ? 'on (cap ' + cfg.autoDailyBudget + '/day)' : 'off'))
  } catch {
    // Logging must never keep the plugin from loading.
  }

  ctx.effect(() => () => {
    // Nothing to flush: all writes are atomic and complete at call time.
  }, 'tacit: dispose')
}
