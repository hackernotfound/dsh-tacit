// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — the coach service (host side).
 *
 * Reached by the browser through the plugin's own /api/tacit/* routes.
 * Every method is a plain async function returning a structured payload with
 * an `ok` flag and a stable error `code` the client localizes. Expected
 * failures never throw; unexpected ones are mapped by the route layer.
 *
 * Model calls are either user-triggered (analyzeTurn / improveDraft /
 * bootstrap) or automatic analyses of messy and corrected turns, the latter
 * capped by `autoDailyBudget`. There is no polling and no telemetry.
 */

import {
  Config,
  COACH_MODELS,
  COACH_PROVIDER,
  analyzeArgSchema,
  appliedArgSchema,
  configArgSchema,
  feedbackArgSchema,
  improveArgSchema,
  profileSchema,
  reportSchema,
  sessionArgSchema,
  directivesArgSchema,
  statsArgSchema,
  bootstrapArgSchema,
} from './schema.js'
import { dayKey } from './store.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { textOfBlocks } from './fold.js'
import {
  aggregateProfile,
  buildAnalysisUserText,
  buildDistillUserText,
  buildImproveUserText,
  callCoachModel,
  improvePatterns,
  lastDownReasons,
  normalizeDistillRules,
  normalizeImprove,
  normalizeReport,
  parseJsonObject,
  ANALYSIS_SYSTEM_PROMPT,
  GOOD_SYSTEM_PROMPT,
  GOOD_TOOL,
  normalizeGoodReport,
  ANALYSIS_REPAIR_SYSTEM_PROMPT,
  IMPROVE_SYSTEM_PROMPT,
  IMPROVE_REPAIR_SYSTEM_PROMPT,
  DISTILL_SYSTEM_PROMPT,
  ANALYZE_MAX_TOKENS,
  ANALYZE_TIMEOUT_MS,
  IMPROVE_MAX_TOKENS,
  IMPROVE_TIMEOUT_MS,
  DISTILL_MAX_TOKENS,
  DISTILL_TIMEOUT_MS,
  MAX_STYLE_RULES,
  MAX_FEEDBACK_LOG,
  MAX_FEEDBACK_REASON_CHARS,
  ANALYSIS_TOOL,
  IMPROVE_TOOL,
  DISTILL_TOOL,
  clipSafe,
  isMessyTurn,
  looksLikeCorrection,
  looksLikeContinuation,
  classifyDirectives,
  DIRECTIVE_SYSTEM_PROMPT,
  DIRECTIVE_TOOL,
  DIRECTIVE_MAX_TOKENS,
  DIRECTIVE_TIMEOUT_MS,
  MAX_DIRECTIVES,
  buildDirectiveUserText,
  buildSteeringSection,
  renderSteeringSection,
  workspaceLabel,
  MAX_WORKSPACE_DIRECTIVES,
  ENRICH_SYSTEM_PROMPT,
  ENRICH_TOOL,
  ENRICH_MAX_TOKENS,
  ENRICH_TIMEOUT_MS,
  ENRICH_MIN_DRAFT_CHARS,
  ENRICH_MAX_DRAFT_CHARS,
  ENRICH_PREFIX,
  buildEnrichUserText,
  normalizeEnrichNote,
  computeTrend,
} from './analyze.js'

/** In-memory rewrite ledger bounds (never persisted). */
const MAX_REWRITE_RECORDS = 50
/** Pending outcome verifications kept per session (FIFO, oldest dropped). */
const MAX_PENDING_VERIFICATIONS = 20

/** Merge the loader/YAML base config with the UI-written patch (patch wins). */
export function mergeConfig(base, patch) {
  const merged = Config.parse({
    ...(base !== null && typeof base === 'object' ? base : {}),
    ...(patch !== null && typeof patch === 'object' ? patch : {}),
  })
  // Allowlist the model; a bad persisted value falls back to the default.
  if (!COACH_MODELS.includes(merged.model)) merged.model = 'deepseek-v4-flash'
  merged.maxKeptTurns = Math.max(1, Math.min(1000, Math.round(Number(merged.maxKeptTurns) || 60)))
  merged.maxPromptChars = Math.max(200, Math.min(100000, Math.round(Number(merged.maxPromptChars) || 4000)))
  merged.maxToolCallChars = Math.max(100, Math.min(20000, Math.round(Number(merged.maxToolCallChars) || 500)))
  merged.maxAssistantChars = Math.max(200, Math.min(100000, Math.round(Number(merged.maxAssistantChars) || 4000)))
  merged.maxToolCallsPerTurn = Math.max(1, Math.min(500, Math.round(Number(merged.maxToolCallsPerTurn) || 50)))
  merged.maxPatterns = Math.max(1, Math.min(50, Math.round(Number(merged.maxPatterns) || 12)))
  merged.autoAnalyze = merged.autoAnalyze !== false
  merged.autoDailyBudget = Math.max(0, Math.min(1000, Math.round(Number(merged.autoDailyBudget ?? 30))))
  merged.autoMinSteps = Math.max(1, Math.min(500, Math.round(Number(merged.autoMinSteps) || 15)))
  merged.steerAgent = merged.steerAgent !== false
  merged.directiveEvery = Math.max(1, Math.min(100, Math.round(Number(merged.directiveEvery) || 3)))
  merged.enrichPrompts = merged.enrichPrompts === true
  merged.directiveTrialTurns = Math.max(1, Math.min(500, Math.round(Number(merged.directiveTrialTurns) || 10)))
  merged.directiveWorseBy = Math.max(0, Math.min(1, Number.isFinite(Number(merged.directiveWorseBy)) ? Number(merged.directiveWorseBy) : 0.15))
  merged.bootstrapConcurrency = Math.max(1, Math.min(4, Math.round(Number(merged.bootstrapConcurrency) || 1)))
  merged.learnFromGood = merged.learnFromGood !== false
  return merged
}

function serviceOf(ctx) {
  const get = (name) => (ctx.get !== undefined && typeof ctx.get === 'function' ? ctx.get(name) : undefined)
  return { get, llm: get('llm'), sessions: get('sessions'), sessionProjections: get('sessionProjections') }
}

function turnsOf(service, sessionId) {
  const session = typeof service.sessions?.get === 'function' ? service.sessions.get(sessionId) : undefined
  if (session === undefined) return { session, turns: [] }
  if (service.sessionProjections === undefined || typeof service.sessionProjections.snapshot !== 'function') {
    return { session, turns: [] }
  }
  try {
    const snapshot = service.sessionProjections.snapshot(session)
    const value = snapshot?.values?.tacitTimeline
    return { session, turns: Array.isArray(value?.turns) ? value.turns : [] }
  } catch {
    return { session, turns: [] }
  }
}

/** The absolute workspace directory a session was created in, else undefined. */
function cwdOf(session) {
  const cwd = session !== null && typeof session === 'object' && session.header !== null && typeof session.header === 'object'
    ? session.header.cwd
    : undefined
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** A human label for a session: the workspace directory's basename, else ''. */
function sessionLabelOf(service, sessionId) {
  const session = typeof service.sessions?.get === 'function' ? service.sessions.get(sessionId) : undefined
  return workspaceLabel(cwdOf(session))
}

/** Every distinct workspace among the live sessions, labelled for the UI. */
function listWorkspaces(service) {
  const sessions = typeof service.sessions?.list === 'function' ? service.sessions.list() : []
  const seen = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const cwd = cwdOf(session)
    if (cwd !== undefined && !seen.has(cwd)) seen.set(cwd, { cwd, label: workspaceLabel(cwd) })
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** At most MAX_DIRECTIVES global directives and MAX_WORKSPACE_DIRECTIVES per workspace, order kept. */
function capDirectives(list) {
  const counts = new Map()
  const out = []
  for (const entry of list) {
    const scope = typeof entry.workspace === 'string' && entry.workspace.length > 0 ? entry.workspace : ''
    const limit = scope === '' ? MAX_DIRECTIVES : MAX_WORKSPACE_DIRECTIVES
    const n = counts.get(scope) ?? 0
    if (n >= limit) continue
    counts.set(scope, n + 1)
    out.push(entry)
  }
  return out
}

/** Short, secret-free context digest of a session's last two finished turns. */
function recentContextOf(turns) {
  const finished = (Array.isArray(turns) ? turns : []).filter((turn) => turn?.finished === true).slice(-2)
  if (finished.length === 0) return ''
  return finished.map((turn) => {
    const prompt = typeof turn.prompt === 'string' ? turn.prompt.slice(0, 600) : ''
    const finalText = typeof turn.finalText === 'string' ? turn.finalText.slice(0, 600) : ''
    return 'prompt: ' + (prompt || '(none)') + '\nresponse: ' + (finalText || '(none)')
  }).join('\n---\n')
}

// ── Free outcome verification signals (v2 loop) ────────────────────────────
// The spec's hard rule: rework quality is judged ONLY by error/retry/
// compaction/rejection signals and the emptiness of the final answer —
// NEVER by steps or tool-call counts (user correction).

const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0)

/** Rework score of one finished turn: lower is better. */
function outcomeScore(turn) {
  if (turn === null || typeof turn !== 'object') return Number.POSITIVE_INFINITY
  let score = num(turn.toolErrors) + num(turn.retries) + num(turn.compactions)
  const reason = typeof turn.endReason === 'string' ? turn.endReason : ''
  if (reason === 'rejected' || reason === 'cancelled') score += 1
  if (typeof turn.finalText !== 'string' || turn.finalText.trim() === '') score += 1
  return score
}

/** Compact baseline digest captured at apply time. */
function outcomeBaselineOf(turn) {
  if (turn === null || typeof turn !== 'object') return null
  return {
    turn: typeof turn.turn === 'number' ? turn.turn : 0,
    toolErrors: num(turn.toolErrors),
    retries: num(turn.retries),
    compactions: num(turn.compactions),
    endReason: typeof turn.endReason === 'string' ? turn.endReason : '',
    finalText: typeof turn.finalText === 'string' ? turn.finalText : '',
  }
}

/** The newest finished turn of a projection view, or null. */
function lastFinishedTurnOf(turns) {
  const finished = (Array.isArray(turns) ? turns : []).filter((turn) => turn !== null && typeof turn === 'object' && turn.finished === true)
  return finished.length > 0 ? finished[finished.length - 1] : null
}

function coachErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (error !== null && typeof error === 'object' && typeof error.code === 'string') return error.code
  if (/abort|aborted|timeout/i.test(message)) return 'timeout'
  if (/auth|401|403|api key|key not/i.test(message)) return 'no-api-key'
  if (/rate|429/i.test(message)) return 'rate-limited'
  return 'call-failed'
}

export function createCoachService(ctx, store, effectiveConfig) {
  const inFlight = new Map()
  /** Turns already handed to automatic analysis (sessionId:turn). */
  const autoSeen = new Set()
  /** In-flight automatic analyses (for flushAuto / tests). */
  const autoRunning = new Set()
  /** Only turns finishing after this instant are eligible for auto-analysis (cold-restore guard). */
  const pluginStartedAt = Date.now()
  /** rewriteId → {rewriteId, sessionId, patternsUsed, draft, improved} (last 50). */
  const rewriteRecords = new Map()
  /** sessionId → FIFO [{rewriteId, baseline}] (one per applied rewrite). */
  const pendingVerifications = new Map()
  /** sessionId → ids of the directives in that session's frozen steering (bounded; insertion order = age). */
  const steeringIdsBySession = new Map()
  const MAX_STEERING_SESSIONS = 500
  let distillInFlight = false
  let rewriteSeq = 0

  const safeProfile = () => {
    const parsed = profileSchema.safeParse(store.profile())
    return parsed.success
      ? parsed.data
      : { analyzedCount: 0, patterns: [], updatedAt: 0, styleRules: [], feedbackLog: [], pendingDistill: 0, directives: [], analysesSinceDirectives: 0 }
  }
  let directiveSeq = 0
  const nextDirectiveId = () => {
    directiveSeq += 1
    return 'd' + Date.now().toString(36) + '-' + directiveSeq.toString(36)
  }
  let directivesInFlight = false
  /** Steering `{ text, ids }` frozen per live session object (keeps the model's prefix cache stable within a session). */
  const steeringFrozen = new WeakMap()

  const nextRewriteId = () => {
    rewriteSeq += 1
    return 'rw' + Date.now().toString(36) + '-' + rewriteSeq.toString(36)
  }

  const rememberRewrite = (record) => {
    rewriteRecords.set(record.rewriteId, record)
    if (rewriteRecords.size > MAX_REWRITE_RECORDS) {
      rewriteRecords.delete(rewriteRecords.keys().next().value)
    }
  }

  const providerForSession = (sessionId) => {
    const { turns } = turnsOf(serviceOf(ctx), sessionId)
    const known = turns.filter((turn) => typeof turn?.provider === 'string' && turn.provider.length > 0)
    return known.length > 0 ? known[known.length - 1].provider : COACH_PROVIDER
  }

  /** Increment one counter on each pattern kind (create the pattern when unknown). */
  const bumpPatterns = (profile, kinds, key) => {
    for (const kind of kinds) {
      const found = profile.patterns.find((pattern) => pattern !== null && typeof pattern === 'object' && pattern.kind === kind)
      if (found !== undefined) found[key] += 1
      else profile.patterns.push({ kind, count: 0, lastExample: '', applied: 0, accepted: 0, rejected: 0, verified: 0, unverified: 0, [key]: 1 })
    }
    return profile
  }

  /** Bound every v2 field, validate, persist; returns the stored profile. */
  const capAndSaveProfile = (profile) => {
    const config = effectiveConfig()
    profile.patterns = profile.patterns.slice(0, config.maxPatterns)
    profile.styleRules = profile.styleRules.slice(-MAX_STYLE_RULES)
    profile.feedbackLog = profile.feedbackLog.slice(-MAX_FEEDBACK_LOG)
    profile.directives = capDirectives(profile.directives)
    profile.updatedAt = Date.now()
    const validated = profileSchema.parse(profile)
    store.saveProfile(validated)
    return validated
  }

  /**
   * The ONE new paid call: distill 3+ unreviewed 👎 reasons into 2-3 durable
   * style rules (≤300 tokens). Guarded: in-flight dedup, soft-silent failure
   * (pendingDistill stays and retries on the next trigger), never throws.
   * Returns the profile with fresh rules on success, the input profile on a
   * soft no-op/failure.
   */
  const maybeDistill = async (profile, provider, sessionId) => {
    if (profile.pendingDistill < 3 || distillInFlight) return profile
    distillInFlight = true
    try {
      const config = effectiveConfig()
      const reasons = lastDownReasons(profile, 3)
      const text = await callCoachModel(ctx, {
        provider,
        model: config.model,
        system: DISTILL_SYSTEM_PROMPT,
        userText: buildDistillUserText(reasons),
        maxTokens: DISTILL_MAX_TOKENS,
        timeoutMs: DISTILL_TIMEOUT_MS,
        tool: DISTILL_TOOL,
        sessionId,
      })
      const rules = normalizeDistillRules(text)
      if (rules.length === 0) return profile
      const fresh = safeProfile()
      fresh.styleRules = [...fresh.styleRules, ...rules.map((rule) => ({ rule, createdAt: Date.now() }))].slice(-MAX_STYLE_RULES)
      fresh.pendingDistill = 0
      return capAndSaveProfile(fresh)
    } catch {
      return profile
    } finally {
      distillInFlight = false
    }
  }

  const runExclusive = (key, task) => {
    if (inFlight.has(key)) return null
    const promise = task().finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }

  /**
   * Free outcome verification: runs on the existing projection change feed
   * (no polling, no background loops). When a NEW finished turn lands for a
   * session with pending verifications, the FIFO head — the applied rewrite
   * whose baseline was the immediately preceding finished turn — is compared
   * on rework signals only (never steps/tool counts).
   */
  const handleProjectionChange = (session, key, value) => {
    if (key !== 'tacitTimeline') return
    const sessionId = session !== null && typeof session === 'object' && typeof session.id === 'string' ? session.id : null
    if (sessionId === null) return
    const turns = Array.isArray(value?.turns) ? value.turns : []
    try {
      maybeAutoAnalyze(sessionId, turns)
    } catch {
      // Zero-click learning must never break the feed.
    }
    try {
      recordTrialTurns(sessionId, turns)
    } catch {
      // Trials are bookkeeping; never break the feed.
    }
    handleVerification(sessionId, turns)
  }

  /** Finished turns already counted toward directive trials (sessionId:turn). */
  const seenFinished = new Set()

  const pct = (rate) => String(Math.round(rate * 100)) + '%'

  /**
   * Directive trials ride the same free feed: every NEW finished turn counts
   * toward each candidate that was actually in that session's frozen steering
   * text; after `directiveTrialTurns` such turns the candidate is activated,
   * or retired when the messy rate rose past the baseline by more than
   * `directiveWorseBy`. A session whose steering was never assembled here
   * (started before the candidate existed, or before a restart) counts toward
   * nobody — its turns say nothing about the candidate.
   */
  const recordTrialTurns = (sessionId, turns) => {
    const fresh = (Array.isArray(turns) ? turns : []).filter((turn) => turn !== null && typeof turn === 'object'
      && turn.finished === true && typeof turn.turn === 'number' && typeof turn.endedAt === 'number' && turn.endedAt >= pluginStartedAt
      && !seenFinished.has(sessionId + ':' + turn.turn))
    if (fresh.length === 0) return
    for (const turn of fresh) seenFinished.add(sessionId + ':' + turn.turn)
    const steered = steeringIdsBySession.get(sessionId)
    if (steered === undefined || steered.length === 0) return
    const profile = safeProfile()
    const candidates = profile.directives.filter((entry) => entry.status === 'candidate' && entry.trial !== undefined && steered.includes(entry.id))
    if (candidates.length === 0) return
    const config = effectiveConfig()
    const messyCount = fresh.filter((turn) => isMessyTurn(turn, { minSteps: Number.POSITIVE_INFINITY })).length
    for (const entry of candidates) {
      entry.trial.turns += fresh.length
      entry.trial.messy += messyCount
      if (entry.trial.turns < config.directiveTrialTurns) continue
      const rate = entry.trial.messy / entry.trial.turns
      if (rate > entry.trial.baselineRate + config.directiveWorseBy) {
        entry.status = 'retired'
        entry.enabled = false
        entry.retiredReason = 'messy turns ' + pct(entry.trial.baselineRate) + ' → ' + pct(rate) + ' while active'
        console.info('[tacit] retired directive (' + entry.retiredReason + '): ' + entry.text)
      } else {
        entry.status = 'active'
        console.info('[tacit] activated directive (messy turns ' + pct(entry.trial.baselineRate) + ' → ' + pct(rate) + '): ' + entry.text)
      }
    }
    capAndSaveProfile(profile)
  }

  const handleVerification = (sessionId, turns) => {
    const queue = pendingVerifications.get(sessionId)
    if (queue === undefined || queue.length === 0) return
    const finished = lastFinishedTurnOf(turns)
    if (finished === null) return
    const head = queue[0]
    if (head.baseline !== null && finished.turn <= head.baseline.turn) return
    queue.shift()
    if (head.baseline === null) return // no prior finished turn to compare against
    const record = rewriteRecords.get(head.rewriteId)
    if (record === undefined || record.patternsUsed.length === 0) return
    const better = outcomeScore(finished) < outcomeScore(head.baseline)
    let profile = safeProfile()
    profile = bumpPatterns(profile, record.patternsUsed, better ? 'verified' : 'unverified')
    capAndSaveProfile(profile)
  }

  const svcAtStartup = serviceOf(ctx)
  if (svcAtStartup.sessionProjections !== undefined && typeof svcAtStartup.sessionProjections.onChanged === 'function') {
    const unsubscribe = svcAtStartup.sessionProjections.onChanged(handleProjectionChange)
    // The registry's own onChanged effect rides the harness root fiber; tie the
    // unsubscription to THIS plugin's fiber so an unload stops the listener.
    if (typeof ctx.effect === 'function') ctx.effect(() => unsubscribe, 'tacit: outcome verification feed')
  }

  /**
   * One analysis of a retained turn (manual click or automatic trigger):
   * model call → report on disk → profile aggregation. Deduped per
   * session:turn while running. Never throws.
   */
  /** The newest finished turn that ended before `turn` (context the agent already had). */
  const previousFinishedOf = (turns, turn) => {
    const earlier = (Array.isArray(turns) ? turns : [])
      .filter((candidate) => candidate !== null && typeof candidate === 'object' && candidate.finished === true && typeof candidate.turn === 'number' && candidate.turn < turn)
    return earlier.length > 0 ? earlier[earlier.length - 1] : null
  }

  const runAnalysis = (sessionId, turn, { trigger = 'manual', followUp = '', digest = null, previousDigest = null } = {}) => {
    const profile = safeProfile()
    const key = `${sessionId}:${turn}`
    const exclusive = runExclusive(key, async () => {
      const svc = serviceOf(ctx)
      const { session, turns } = turnsOf(svc, sessionId)
      if (session === undefined) return { ok: false, report: null, profile, code: 'no-session', detail: '' }
      const cwd = cwdOf(session)
      // The change feed already carries the digest; a manual click re-reads the snapshot.
      const record = digest !== null && typeof digest === 'object' ? digest : turns.find((candidate) => candidate?.turn === turn)
      if (record === undefined) return { ok: false, report: null, profile, code: 'not-retained', detail: '' }
      // A bare "continue" carries no intent to learn from; the auto and bootstrap paths
      // never get here, and a manual click gets a soft, explained refusal instead of a paid call.
      if (trigger === 'manual' && looksLikeContinuation(record.prompt)) {
        return { ok: false, report: null, profile, code: 'continuation', detail: '' }
      }
      const previous = previousDigest !== null && typeof previousDigest === 'object' ? previousDigest : previousFinishedOf(turns, turn)
      const userText = buildAnalysisUserText(record, { followUp, previous })
      if (userText === null) return { ok: false, report: null, profile, code: 'not-retained', detail: '' }
      const config = effectiveConfig()
      try {
        const provider = typeof record.provider === 'string' && record.provider.length > 0
          ? record.provider
          : COACH_PROVIDER
        if (trigger === 'good') {
          // One attempt, no repair retry: a recovery lesson is a bonus, not a diagnosis.
          const goodText = await callCoachModel(ctx, {
            provider,
            model: config.model,
            system: GOOD_SYSTEM_PROMPT,
            userText,
            maxTokens: ANALYZE_MAX_TOKENS,
            timeoutMs: ANALYZE_TIMEOUT_MS,
            tool: GOOD_TOOL,
            sessionId,
          })
          const goodParsed = goodText.trim() === '' ? null : parseJsonObject(goodText)
          if (goodParsed === null) return { ok: false, report: null, profile, code: 'empty-response', detail: '' }
          const goodReport = {
            ...normalizeGoodReport(goodParsed, { turn, time: Date.now(), model: config.model, prompt: record.prompt }),
            ...(typeof record.prompt === 'string' && record.prompt.length > 0 ? { promptExcerpt: clipSafe(record.prompt, 200) } : {}),
            trigger,
            ...(cwd !== undefined ? { cwd } : {}),
          }
          if (goodReport.lesson === '' && goodReport.strengths.length === 0) {
            return { ok: false, report: null, profile, code: 'nothing-learned', detail: '' }
          }
          const isNew = store.report(sessionId, turn) === null
          store.saveReport(sessionId, turn, goodReport)
          const grown = aggregateProfile(store.profile(), goodReport, config.maxPatterns, { countNew: isNew })
          if (isNew) grown.analysesSinceDirectives = (grown.analysesSinceDirectives ?? 0) + 1
          store.saveProfile(grown)
          if (isNew && !bootstrapState.running) {
            const task = maybeDistillDirectives(sessionId, provider).catch(() => null).finally(() => autoRunning.delete(task))
            autoRunning.add(task)
          }
          return { ok: true, report: goodReport, profile: grown, code: '', detail: '' }
        }
        let text = await callCoachModel(ctx, {
          provider,
          model: config.model,
          system: ANALYSIS_SYSTEM_PROMPT,
          userText,
          maxTokens: ANALYZE_MAX_TOKENS,
          timeoutMs: ANALYZE_TIMEOUT_MS,
          tool: ANALYSIS_TOOL,
          sessionId,
        })
        if (text.trim() === '') {
          return { ok: false, report: null, profile, code: 'empty-response', detail: '' }
        }
        let parsed = parseJsonObject(text)
        if (parsed === null) {
          // One-shot repair: the model answered in prose; re-ask for strict JSON.
          const repaired = await callCoachModel(ctx, {
            provider,
            model: config.model,
            system: ANALYSIS_REPAIR_SYSTEM_PROMPT,
            userText,
            maxTokens: ANALYZE_MAX_TOKENS,
            timeoutMs: ANALYZE_TIMEOUT_MS,
            tool: ANALYSIS_TOOL,
            sessionId,
          })
          if (repaired.trim() !== '') {
            const reparsed = parseJsonObject(repaired)
            if (reparsed !== null) {
              text = repaired
              parsed = reparsed
            }
          }
        }
        const report = {
          ...reportSchema.parse(normalizeReport(parsed, {
            turn,
            time: Date.now(),
            model: config.model,
            rawText: text,
          })),
          ...(typeof record.prompt === 'string' && record.prompt.length > 0
            ? { promptExcerpt: clipSafe(record.prompt, 200) }
            : {}),
          trigger,
          ...(followUp.length > 0 ? { followUp: clipSafe(followUp, 300) } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
        }
        const countNew = store.report(sessionId, turn) === null
        store.saveReport(sessionId, turn, report)
        const nextProfile = aggregateProfile(store.profile(), report, config.maxPatterns, { countNew })
        if (countNew) nextProfile.analysesSinceDirectives = (nextProfile.analysesSinceDirectives ?? 0) + 1
        store.saveProfile(nextProfile)
        if (countNew && !bootstrapState.running) {
          const task = maybeDistillDirectives(sessionId, provider).catch(() => null).finally(() => autoRunning.delete(task))
          autoRunning.add(task)
        }
        return { ok: true, report, profile: nextProfile, code: '', detail: '' }
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
        return { ok: false, report: null, profile, code: coachErrorCode(error), detail }
      }
    })
    if (exclusive === null) return Promise.resolve({ ok: false, report: null, profile, code: 'busy', detail: '' })
    return exclusive
  }

  const steeringStatus = (cwd) => {
    const config = effectiveConfig()
    return { enabled: config.steerAgent, text: config.steerAgent ? renderSteeringSection(safeProfile(), { cwd }) : '' }
  }

  /** What a session in `cwd` assembling its system prompt right now would get. */
  const steeringNow = (cwd) => (effectiveConfig().steerAgent ? buildSteeringSection(safeProfile(), { cwd }) : { text: '', ids: [] })

  /** The system-prompt section provider (sync; frozen per session). */
  const steeringText = (assemble) => {
    const session = assemble !== null && typeof assemble === 'object' && assemble.agent !== null && typeof assemble.agent === 'object'
      ? assemble.agent.session
      : undefined
    if (session === null || session === undefined || typeof session !== 'object') return steeringNow().text
    let frozen = steeringFrozen.get(session)
    if (frozen === undefined) {
      frozen = steeringNow(cwdOf(session))
      steeringFrozen.set(session, frozen)
      if (typeof session.id === 'string' && session.id.length > 0) {
        steeringIdsBySession.delete(session.id)
        steeringIdsBySession.set(session.id, frozen.ids)
        while (steeringIdsBySession.size > MAX_STEERING_SESSIONS) steeringIdsBySession.delete(steeringIdsBySession.keys().next().value)
      }
    }
    return frozen.text
  }

  /**
   * Replace the distilled directives with the model's new complete set; user
   * entries are untouched, and a re-emitted directive keeps the enabled flag
   * the user gave its identical text. Capped at MAX_DIRECTIVES overall.
   */
  const scopeOf = (entry) => (typeof entry.workspace === 'string' && entry.workspace.length > 0 ? entry.workspace : '')
  const directiveKey = (scope, text) => scope + '\n' + text.trim().toLowerCase()

  /** Messy-turn baseline for a new candidate: the workspace's own turns when there are enough, else everything. */
  const baselineRateFor = (cwd) => {
    const scoped = cwd !== undefined ? allFinishedTurns({ cwd }) : []
    const turns = scoped.length >= 20 ? scoped : allFinishedTurns()
    return computeTrend(turns, { window: 20 }).recent.messyRate
  }

  /**
   * Merge the model's new complete set of directives ({ text, workspace? }):
   * user entries are untouched; the global distilled set and the distilled set
   * of every workspace the model mentioned are replaced; distilled entries of
   * other workspaces are kept (their evidence was not in this batch). A
   * re-emitted directive keeps its identity, state and enabled flag.
   */
  const mergeDirectives = (profile, items) => {
    const users = profile.directives.filter((entry) => entry.source === 'user')
    const userKeys = new Set(users.map((entry) => directiveKey(scopeOf(entry), entry.text)))
    const prior = profile.directives.filter((entry) => entry.source !== 'user')
    const previous = new Map(prior.map((entry) => [directiveKey(scopeOf(entry), entry.text), entry]))
    const mentioned = new Set([''])
    for (const item of items) mentioned.add(scopeOf(item))
    const untouched = prior.filter((entry) => !mentioned.has(scopeOf(entry)))
    const distilled = []
    const seen = new Set()
    const baselines = new Map()
    for (const item of items) {
      const scope = scopeOf(item)
      const key = directiveKey(scope, item.text)
      if (seen.has(key) || userKeys.has(key)) continue
      seen.add(key)
      const kept = previous.get(key)
      if (kept !== undefined) {
        distilled.push({ ...kept, text: item.text })
        continue
      }
      // A new distilled directive goes on trial against the current messy-turn rate.
      if (!baselines.has(scope)) baselines.set(scope, baselineRateFor(scope === '' ? undefined : scope))
      distilled.push({
        id: nextDirectiveId(),
        text: item.text,
        enabled: true,
        source: 'distilled',
        createdAt: Date.now(),
        status: 'candidate',
        trial: { turns: 0, messy: 0, baselineRate: baselines.get(scope), startedAt: Date.now() },
        ...(scope === '' ? {} : { workspace: scope }),
      })
    }
    profile.directives = capDirectives([...users, ...distilled, ...untouched])
    return profile
  }

  /** ONE small call every `directiveEvery` new analyses (or forced). Soft-fails; never throws. */
  const maybeDistillDirectives = async (sessionId, provider, { force = false } = {}) => {
    if (directivesInFlight) return
    const config = effectiveConfig()
    let profile = safeProfile()
    if (!force && profile.analysesSinceDirectives < config.directiveEvery) return
    directivesInFlight = true
    try {
      const recent = store.listAllReports(20).map((entry) => store.report(entry.sessionId, entry.turn)).filter((report) => report !== null)
      // The model sees workspace names only; map them back to the directories they stand for.
      const workspaces = new Map()
      for (const report of recent) {
        if (typeof report.cwd !== 'string' || report.cwd.length === 0) continue
        const label = workspaceLabel(report.cwd)
        if (label.length > 0 && !workspaces.has(label)) workspaces.set(label, report.cwd)
      }
      const text = await callCoachModel(ctx, {
        provider,
        model: config.model,
        system: DIRECTIVE_SYSTEM_PROMPT,
        userText: buildDirectiveUserText(profile, recent.reverse()),
        maxTokens: DIRECTIVE_MAX_TOKENS,
        timeoutMs: DIRECTIVE_TIMEOUT_MS,
        tool: DIRECTIVE_TOOL,
        sessionId,
      })
      const { kept, rejected } = classifyDirectives(text)
      for (const dropped of rejected) console.warn('[tacit] dropped directive (it asks the user instead of compensating):', dropped)
      if (kept.length === 0) {
        console.warn('[tacit] directive distillation returned nothing usable; will retry after the next analysis:', clipSafe(text, 300))
        return
      }
      const items = kept.map((item) => (item.workspace !== undefined && workspaces.has(item.workspace)
        ? { text: item.text, workspace: workspaces.get(item.workspace) }
        : { text: item.text }))
      profile = mergeDirectives(safeProfile(), items)
      profile.analysesSinceDirectives = 0
      capAndSaveProfile(profile)
      const scoped = items.filter((item) => item.workspace !== undefined).length
      console.info('[tacit] distilled ' + items.length + ' directive(s) into the steering section' + (scoped > 0 ? ' (' + scoped + ' workspace-specific)' : ''))
    } catch (error) {
      // Soft: the counter stays and the next analysis retries.
      console.warn('[tacit] directive distillation failed (will retry):', error instanceof Error ? error.message : String(error))
    } finally {
      directivesInFlight = false
    }
  }

  /**
   * Opt-in `agent/pre-step` listener. APPEND-ONLY: the user's own message is
   * never rewritten; when the note is worth it, one plugin-sourced user
   * message rides after it (so it is logged and visible). Any failure, an
   * empty note, or a later step leaves the step exactly as it was.
   */
  const preStep = async (payload, next) => {
    try {
      const config = effectiveConfig()
      if (!config.enrichPrompts) return next()
      if (payload === null || typeof payload !== 'object' || payload.step !== 1) return next()
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      const human = messages.find((message) => message !== null && typeof message === 'object' && message.source?.kind === 'user')
      const draft = human !== undefined ? textOfBlocks(human.content).trim() : ''
      if (draft.length < ENRICH_MIN_DRAFT_CHARS || draft.length > ENRICH_MAX_DRAFT_CHARS) return next()
      const sessionId = typeof payload.agent?.session?.id === 'string' ? payload.agent.session.id : (typeof payload.agent?.id === 'string' ? payload.agent.id : '')
      const { turns } = sessionId.length > 0 ? turnsOf(serviceOf(ctx), sessionId) : { turns: [] }
      const text = await callCoachModel(ctx, {
        provider: sessionId.length > 0 ? providerForSession(sessionId) : COACH_PROVIDER,
        model: config.model,
        system: ENRICH_SYSTEM_PROMPT,
        userText: buildEnrichUserText({ draft, profile: safeProfile(), recentContext: recentContextOf(turns) }),
        maxTokens: ENRICH_MAX_TOKENS,
        timeoutMs: ENRICH_TIMEOUT_MS,
        tool: ENRICH_TOOL,
        sessionId,
      })
      const note = normalizeEnrichNote(text)
      if (note.length === 0) return next()
      const base = await next()
      if (base === null || typeof base !== 'object' || base.kind !== 'enter' || !Array.isArray(base.messages)) return base
      const added = createUserMessage({
        content: [{ type: 'text', text: ENRICH_PREFIX + note }],
        source: { kind: 'plugin', plugin: 'dsh-tacit' },
      })
      return { kind: 'enter', messages: [...base.messages, added] }
    } catch {
      return next()
    }
  }

  /** Every live session's finished turns (optionally only sessions in one workspace), for the measured trend. */
  const allFinishedTurns = ({ cwd } = {}) => {
    const svc = serviceOf(ctx)
    const sessions = typeof svc.sessions?.list === 'function' ? svc.sessions.list() : []
    const out = []
    for (const session of Array.isArray(sessions) ? sessions : []) {
      if (session === null || typeof session !== 'object' || typeof session.id !== 'string') continue
      if (cwd !== undefined && cwdOf(session) !== cwd) continue
      const { turns } = turnsOf(svc, session.id)
      for (const turn of turns) if (turn?.finished === true) out.push(turn)
    }
    return out
  }

  /** One bootstrap at a time; progress is exposed through /state. */
  const bootstrapState = { running: false, done: 0, total: 0, startedAt: 0 }

  /**
   * "Learn from my last N turns now": explicit user action, so it ignores the
   * daily auto budget. Skips continuations, tiny prompts and turns that already
   * have a report; runs up to `bootstrapConcurrency` analyses at once (same
   * number of calls either way); then forces one directive distillation.
   */
  const runBootstrap = async ({ sessionId, limit }) => {
    if (bootstrapState.running) return { ok: false, analyzed: 0, skipped: 0, directives: 0, code: 'busy', detail: '' }
    const svc = serviceOf(ctx)
    const pool = []
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      const { session, turns } = turnsOf(svc, sessionId)
      if (session === undefined) return { ok: false, analyzed: 0, skipped: 0, directives: 0, code: 'no-session', detail: '' }
      for (const turn of turns) if (turn?.finished === true) pool.push({ sessionId, turn, turns })
    } else {
      const sessions = typeof svc.sessions?.list === 'function' ? svc.sessions.list() : []
      for (const session of Array.isArray(sessions) ? sessions : []) {
        if (session === null || typeof session !== 'object' || typeof session.id !== 'string') continue
        const { turns } = turnsOf(svc, session.id)
        for (const turn of turns) if (turn?.finished === true) pool.push({ sessionId: session.id, turn, turns })
      }
    }
    pool.sort((a, b) => (b.turn.endedAt ?? 0) - (a.turn.endedAt ?? 0))
    const eligible = []
    let skipped = 0
    for (const item of pool) {
      const prompt = typeof item.turn.prompt === 'string' ? item.turn.prompt.trim() : ''
      if (prompt.length < ENRICH_MIN_DRAFT_CHARS || looksLikeContinuation(prompt) || store.report(item.sessionId, item.turn.turn) !== null) {
        skipped += 1
        continue
      }
      eligible.push(item)
      if (eligible.length >= limit) break
    }
    bootstrapState.running = true
    bootstrapState.done = 0
    bootstrapState.total = eligible.length
    bootstrapState.startedAt = Date.now()
    let analyzed = 0
    try {
      // A small worker pool: each worker pulls the next eligible turn until the
      // list is drained. Analyses for different turns never share an in-flight
      // key, and the profile read-modify-write inside runAnalysis has no await,
      // so concurrent analyses cannot lose each other's counts.
      let next = 0
      const worker = async () => {
        while (next < eligible.length) {
          const item = eligible[next]
          next += 1
          const previous = previousFinishedOf(item.turns, item.turn.turn)
          const result = await runAnalysis(item.sessionId, item.turn.turn, { trigger: 'bootstrap', digest: item.turn, previousDigest: previous })
          if (result !== null && typeof result === 'object' && result.ok === true) analyzed += 1
          else console.warn('[tacit] bootstrap: ' + item.sessionId + ':' + item.turn.turn + ' skipped: ' + (result?.code ?? 'unknown'))
          bootstrapState.done += 1
        }
      }
      const concurrency = Math.min(effectiveConfig().bootstrapConcurrency, Math.max(1, eligible.length))
      await Promise.all(Array.from({ length: concurrency }, () => worker()))
      if (analyzed > 0) {
        await service.flushAuto() // let any scheduled distillation settle before forcing one
        // The forced distillation is attributed to the newest eligible turn's session.
        await maybeDistillDirectives(eligible[0].sessionId, providerForSession(eligible[0].sessionId), { force: true })
      }
    } finally {
      bootstrapState.running = false
    }
    return { ok: true, analyzed, skipped, directives: safeProfile().directives.length, code: '', detail: '' }
  }

  const autoStatus = () => {
    const config = effectiveConfig()
    return { today: store.autoLedger(dayKey()).count, budget: config.autoDailyBudget }
  }

  /** Spend one unit of today's auto budget; false when exhausted. */
  const spendAuto = () => {
    const config = effectiveConfig()
    const ledger = store.autoLedger(dayKey())
    if (ledger.count >= config.autoDailyBudget) return false
    store.bumpAuto(ledger.date)
    return true
  }

  const scheduleAuto = (sessionId, turn, options) => {
    const key = `${sessionId}:${turn}`
    if (autoSeen.has(key)) return
    autoSeen.add(key)
    if (store.report(sessionId, turn) !== null) return // already analyzed (manually or earlier)
    if (!spendAuto()) return
    const task = runAnalysis(sessionId, turn, options)
      .then((result) => {
        if (result !== null && typeof result === 'object' && result.ok === false) {
          console.warn('[tacit] auto-analysis of ' + key + ' skipped: ' + result.code + (result.detail ? ' — ' + result.detail : ''))
        }
        return result
      })
      .catch(() => null)
      .finally(() => autoRunning.delete(task))
    autoRunning.add(task)
  }

  /**
   * Zero-click learning. Three triggers, all free (no model call to decide):
   *  - the newest FINISHED turn is messy (retries / tool errors / compactions /
   *    rejection / long step run);
   *  - the newest (possibly unfinished) turn's prompt reads as a correction of
   *    the previous answer → the PREVIOUS turn is analyzed with that
   *    follow-up attached as evidence;
   *  - (learnFromGood) the newest finished turn is clean right after a messy
   *    one → a small "what did the user include this time" call.
   * Turns finished before the plugin started are ignored (cold restore).
   */
  const maybeAutoAnalyze = (sessionId, turns) => {
    const config = effectiveConfig()
    if (!config.autoAnalyze) return
    const list = Array.isArray(turns) ? turns.filter((turn) => turn !== null && typeof turn === 'object' && typeof turn.turn === 'number') : []
    if (list.length === 0) return
    const fresh = (turn) => typeof turn.endedAt === 'number' && turn.endedAt >= pluginStartedAt
    const newest = list[list.length - 1]
    const previous = list.length >= 2 ? list[list.length - 2] : null
    if (newest.finished === true) {
      // A bare continuation ("continue", "go ahead") is adequate by construction:
      // the conversation is its context. Heavy work after it is not a prompt fault.
      if (fresh(newest) && isMessyTurn(newest, { minSteps: config.autoMinSteps }) && !looksLikeContinuation(newest.prompt)) {
        scheduleAuto(sessionId, newest.turn, { trigger: 'auto', digest: newest, previousDigest: previous })
        return
      }
      // A recovery: clean now, messy just before, with a real prompt in between.
      const recovery = config.learnFromGood && fresh(newest) && !looksLikeContinuation(newest.prompt)
        && typeof newest.prompt === 'string' && newest.prompt.trim().length >= ENRICH_MIN_DRAFT_CHARS
        && previous !== null && previous.finished === true && isMessyTurn(previous, { minSteps: config.autoMinSteps })
      if (recovery) {
        scheduleAuto(sessionId, newest.turn, { trigger: 'good', digest: newest, previousDigest: previous })
      }
      return
    }
    // Newest turn is running: is its prompt a correction of the previous one?
    if (previous !== null && previous.finished === true && fresh(previous) && looksLikeCorrection(newest.prompt)) {
      const beforePrevious = list.length >= 3 ? list[list.length - 3] : null
      scheduleAuto(sessionId, previous.turn, { trigger: 'correction', followUp: newest.prompt, digest: previous, previousDigest: beforePrevious })
    }
  }

  const service = {
    /** Await every in-flight automatic analysis (tests / orderly shutdown). */
    async flushAuto() {
      await Promise.all([...autoRunning])
    },

    /** Optional `{ sessionId }`: the steering preview is then rendered for that conversation's workspace. */
    async getState(args) {
      const svc = serviceOf(ctx)
      const sessionId = args !== null && typeof args === 'object' && typeof args.sessionId === 'string' && args.sessionId.length > 0 ? args.sessionId : null
      const session = sessionId !== null && typeof svc.sessions?.get === 'function' ? svc.sessions.get(sessionId) : undefined
      return {
        ok: true,
        config: effectiveConfig(),
        profile: safeProfile(),
        auto: autoStatus(),
        steering: steeringStatus(cwdOf(session)),
        workspaces: listWorkspaces(svc),
        bootstrap: { ...bootstrapState },
        message: '',
      }
    },

    async getReports(args) {
      const parsed = sessionArgSchema.safeParse(args)
      if (!parsed.success) return { ok: false, reports: {}, message: 'bad-request' }
      const reports = {}
      for (const entry of store.listReports(parsed.data.sessionId)) {
        const checked = reportSchema.safeParse(entry.report)
        if (checked.success) reports[String(entry.turn)] = checked.data
      }
      return { ok: true, reports, message: '' }
    },

    async listHistory(args) {
      const raw = args !== null && typeof args === 'object' ? args : {}
      const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? raw.limit : 50
      const svc = serviceOf(ctx)
      const entries = store.listAllReports(limit).map((entry) => ({ ...entry, sessionLabel: sessionLabelOf(svc, entry.sessionId) }))
      return { ok: true, entries, code: '', detail: '' }
    },

    async analyzeTurn(args) {
      const parsed = analyzeArgSchema.safeParse(args)
      if (!parsed.success) {
        return { ok: false, report: null, profile: safeProfile(), code: 'bad-request', detail: '' }
      }
      return runAnalysis(parsed.data.sessionId, parsed.data.turn, { trigger: 'manual' })
    },

    async improveDraft(args) {
      const parsed = improveArgSchema.safeParse(args)
      if (!parsed.success) {
        return { ok: false, improved: '', rationale: '', rewriteId: '', patternsUsed: [], code: 'bad-request', detail: '' }
      }
      const { sessionId, draft } = parsed.data
      const config = effectiveConfig()
      const profile = safeProfile()
      const svc = serviceOf(ctx)
      const { turns } = turnsOf(svc, sessionId)
      const recentContext = recentContextOf(turns)
      // Distillation also fires on user-triggered improve calls (soft, in-flight
      // deduped, never awaited: an improve call is never blocked by it).
      if (profile.pendingDistill >= 3) {
        maybeDistill(profile, providerForSession(sessionId), sessionId).catch(() => {})
      }
      // Only trusted (or still-inexperienced) patterns reach the prompt;
      // style rules + the last 3 verbatim down-reasons ride along for free
      // on this existing call. There is no learning gate.
      const selected = improvePatterns(profile, config.maxPatterns)
      const userText = buildImproveUserText({
        draft: draft.trim(),
        profile: { patterns: selected },
        recentContext,
        styleRules: profile.styleRules,
        negativeFeedback: lastDownReasons(profile, 3),
      })
      try {
        // Provider follows the session's own route (latest known), so proxy
        // or custom provider setups keep working; the shipped DeepSeek
        // adapter id is the fallback.
        const provider = providerForSession(sessionId)
        let text = await callCoachModel(ctx, {
          provider,
          model: config.model,
          system: IMPROVE_SYSTEM_PROMPT,
          userText,
          maxTokens: IMPROVE_MAX_TOKENS,
          timeoutMs: IMPROVE_TIMEOUT_MS,
          tool: IMPROVE_TOOL,
          sessionId,
        })
        if (text.trim() === '') {
          return { ok: false, improved: '', rationale: '', rewriteId: '', patternsUsed: [], code: 'empty-response', detail: '' }
        }
        let parsed = parseJsonObject(text)
        if (parsed === null) {
          const repaired = await callCoachModel(ctx, {
            provider,
            model: config.model,
            system: IMPROVE_REPAIR_SYSTEM_PROMPT,
            userText,
            maxTokens: IMPROVE_MAX_TOKENS,
            timeoutMs: IMPROVE_TIMEOUT_MS,
            tool: IMPROVE_TOOL,
            sessionId,
          })
          if (repaired.trim() !== '') {
            const reparsed = parseJsonObject(repaired)
            if (reparsed !== null) parsed = reparsed
          }
        }
        const result = normalizeImprove(parsed, draft.trim())
        const rewriteId = nextRewriteId()
        const patternsUsed = selected.map((pattern) => pattern.kind)
        rememberRewrite({
          rewriteId,
          sessionId,
          patternsUsed,
          draft: draft.trim().slice(0, 1000),
          improved: result.improved.slice(0, 2000),
        })
        return { ok: true, ...result, rewriteId, patternsUsed, code: '', detail: '' }
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
        return { ok: false, improved: '', rationale: '', rewriteId: '', patternsUsed: [], code: coachErrorCode(error), detail }
      }
    },

    /**
     * 👍/👎 on an applied rewrite: trust counters + good-examples library +
     * bounded feedback log. A 👎 reason is clipped to 300 chars, logged
     * verbatim (it rides the very next improve prompt), and counts toward
     * the distillation trigger. Without a known rewriteId the verdict is
     * ignored (soft 400).
     */
    async feedback(args) {
      const parsed = feedbackArgSchema.safeParse(args)
      if (!parsed.success) return { ok: false, profile: safeProfile(), code: 'bad-request', detail: '' }
      const record = rewriteRecords.get(parsed.data.rewriteId)
      if (record === undefined) return { ok: false, profile: safeProfile(), code: 'unknown-rewrite', detail: '' }
      const { verdict } = parsed.data
      const reason = typeof parsed.data.reason === 'string'
        ? parsed.data.reason.trim().slice(0, MAX_FEEDBACK_REASON_CHARS)
        : ''
      let profile = safeProfile()
      if (verdict === 'up') {
        profile = bumpPatterns(profile, record.patternsUsed, 'accepted')
        profile.feedbackLog = [...profile.feedbackLog, {
          time: Date.now(),
          verdict: 'up',
          reason: '',
          patternKinds: [...record.patternsUsed],
        }].slice(-MAX_FEEDBACK_LOG)
      } else {
        profile = bumpPatterns(profile, record.patternsUsed, 'rejected')
        profile.feedbackLog = [...profile.feedbackLog, {
          time: Date.now(),
          verdict: 'down',
          reason,
          patternKinds: [...record.patternsUsed],
        }].slice(-MAX_FEEDBACK_LOG)
        if (reason.length > 0) profile.pendingDistill += 1
      }
      profile = capAndSaveProfile(profile)
      // 3+ unreviewed down-reasons fire ONE distillation call, on this
      // user action. Awaited so the returned profile already carries the
      // fresh style rules; a failure is soft-silent and retries later.
      if (profile.pendingDistill >= 3) {
        profile = await maybeDistill(profile, providerForSession(record.sessionId), record.sessionId)
      }
      return { ok: true, profile, code: '', detail: '' }
    },

    /**
     * The client applied a rewrite: bump `applied` on the used patterns and
     * capture the current last finished turn's digest as the baseline for
     * the free outcome verification of the immediately following turn.
     */
    async applied(args) {
      const parsed = appliedArgSchema.safeParse(args)
      if (!parsed.success) return { ok: false, code: 'bad-request', detail: '' }
      const record = rewriteRecords.get(parsed.data.rewriteId)
      if (record === undefined) return { ok: false, code: 'unknown-rewrite', detail: '' }
      const { sessionId, rewriteId } = parsed.data
      let profile = safeProfile()
      profile = bumpPatterns(profile, record.patternsUsed, 'applied')
      capAndSaveProfile(profile)
      const { session, turns } = turnsOf(serviceOf(ctx), sessionId)
      const baseline = session === undefined ? null : outcomeBaselineOf(lastFinishedTurnOf(turns))
      let queue = pendingVerifications.get(sessionId)
      if (queue === undefined) {
        queue = []
        pendingVerifications.set(sessionId, queue)
      }
      queue.push({ rewriteId, baseline })
      if (queue.length > MAX_PENDING_VERIFICATIONS) queue.shift()
      return { ok: true, code: '', detail: '' }
    },

    /** Settings edits to the agent-facing directives. */
    async directives(args) {
      const parsed = directivesArgSchema.safeParse(args)
      if (!parsed.success) return { ok: false, profile: safeProfile(), steering: steeringStatus(), code: 'bad-request', detail: '' }
      const profile = safeProfile()
      const input = parsed.data
      if (input.action === 'toggle') {
        const found = profile.directives.find((entry) => entry.id === input.id)
        if (found === undefined) return { ok: false, profile, steering: steeringStatus(), code: 'bad-request', detail: 'id' }
        found.enabled = input.enabled
        // Re-enabling a retired directive is an explicit override.
        if (input.enabled && found.status === 'retired') {
          found.status = 'active'
          delete found.retiredReason
        }
      } else if (input.action === 'add') {
        const text = clipSafe(input.text.trim(), 220)
        if (text.length === 0) return { ok: false, profile, steering: steeringStatus(), code: 'bad-request', detail: 'text' }
        const workspace = typeof input.workspace === 'string' && input.workspace.trim().length > 0 ? input.workspace.trim() : undefined
        profile.directives.push({ id: nextDirectiveId(), text, enabled: true, source: 'user', createdAt: Date.now(), ...(workspace === undefined ? {} : { workspace }) })
      } else {
        profile.directives = profile.directives.filter((entry) => entry.id !== input.id)
      }
      const saved = capAndSaveProfile(profile)
      return { ok: true, profile: saved, steering: steeringStatus(), code: '', detail: '' }
    },

    /** System-prompt section provider (registered by the host entry). */
    steeringText,

    /** agent/pre-step listener (registered by the host entry). */
    preStep,

    async bootstrap(args) {
      const parsed = bootstrapArgSchema.safeParse(args !== null && typeof args === 'object' ? args : {})
      if (!parsed.success) return { ok: false, analyzed: 0, skipped: 0, directives: 0, code: 'bad-request', detail: '' }
      return runBootstrap({ sessionId: parsed.data.sessionId, limit: parsed.data.limit ?? 20 })
    },

    async stats(args) {
      const parsed = statsArgSchema.safeParse(args !== null && typeof args === 'object' ? args : {})
      const window = parsed.success && typeof parsed.data.window === 'number' ? parsed.data.window : 20
      return { ok: true, trend: computeTrend(allFinishedTurns(), { window }), code: '', detail: '' }
    },

    async updateConfig(args) {
      const parsed = configArgSchema.safeParse(args)
      if (!parsed.success) return { ok: false, config: effectiveConfig(), code: 'bad-request', detail: '' }
      const patch = parsed.data.patch ?? {}
      if (typeof patch.model === 'string' && !COACH_MODELS.includes(patch.model)) {
        return { ok: false, config: effectiveConfig(), code: 'bad-request', detail: 'model' }
      }
      store.saveConfigPatch({ ...store.configPatch(), ...patch })
      return { ok: true, config: effectiveConfig(), code: '', detail: '' }
    },

    async clearReports() {
      const removed = store.clearReports()
      return { ok: true, removed, code: '', detail: '' }
    },
  }

  return service
}
