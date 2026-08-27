// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — trajectory fold (session projection unit).
 *
 * A pure, synchronous fold over the committed session event log that keeps a
 * bounded ring of per-turn digests: the human prompt, step count, tool calls
 * (name + clipped argument preview), tool errors, retries, compactions,
 * feedback counts, provider-reported usage, and the final assistant text.
 *
 * Registered on the harness's `ctx.sessionProjections` registry, which drives
 * `apply(state, event)` over every committed event, persists the state through
 * the projection cache, and pushes the finished value to the browser as a
 * `session/projection` frame where the client reads it with
 * `useProjection('tacitTimeline')`.
 *
 * The contract on dsh >= 0.1.1-rc.1 requires BOTH `stateSchema` (validates the
 * persisted state on restore) and `wire` (declares the browser-delivered
 * payload); `schema`/`view` are kept for older hosts. `stateVersion` must be
 * bumped whenever the persisted state shape or fold semantics change.
 *
 * Fork-seed guard: a forked session's log starts with parent-copied events
 * whose original timestamps predate the child's createdAt (carried by the
 * `session` header-line event during cold restore). Those are skipped — the
 * parent session already folded them. A resumed session's seed is its own
 * history and folds normally.
 */

import { timelineStateSchema, timelineViewSchema } from './schema.js'

export const DEFAULT_BOUNDS = {
  maxKeptTurns: 60,
  maxPromptChars: 4000,
  maxToolCallChars: 500,
  maxAssistantChars: 4000,
  maxToolCallsPerTurn: 50,
}

/** Clip text to `max` chars (string-safe). */
export function clip(text, max) {
  const value = typeof text === 'string' ? text : ''
  return value.length <= max ? value : value.slice(0, max)
}

/** Concatenate the text blocks of a message content list (blocks may be any shape). */
export function textOfBlocks(content) {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (
      block !== null && typeof block === 'object'
      && block.type === 'text' && typeof block.text === 'string'
    ) {
      out = out.length > 0 ? `${out}\n${block.text}` : block.text
    }
  }
  return out
}

function zeroUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

export function emptyTurn(turn, time) {
  return {
    turn,
    startedAt: time,
    prompt: '',
    provisionalPrompt: '',
    steps: 0,
    toolCalls: [],
    toolErrors: 0,
    retries: 0,
    compactions: 0,
    feedback: 0,
    usage: zeroUsage(),
    finalText: '',
    model: '',
    provider: '',
    finished: false,
    endedAt: 0,
    endReason: '',
    enrichment: '',
  }
}

/** Is this user/message the coach's own pre-send context note? */
function isCoachEnrichment(source) {
  return source !== null && typeof source === 'object' && source.kind === 'plugin' && source.plugin === 'dsh-tacit'
}

/** Add the usage of one assistant message into the turn's running totals (mutates `usage`). */
function accumulateUsage(usage, usageReport) {
  if (usageReport === null || typeof usageReport !== 'object') return usage
  const read = (key) => {
    const value = usageReport[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  usage.inputTokens += read('inputTokens')
  usage.outputTokens += read('outputTokens')
  usage.cacheReadTokens += read('cacheReadTokens')
  usage.cacheWriteTokens += read('cacheWriteTokens')
  usage.reasoningTokens += read('reasoningTokens')
  return usage
}

/** Close the open turn: strip fold-internal fields, mark finished, append to the ring, trim. */
function closeTurn(state, turn, finished, endedAt, endReason = '') {
  const { provisionalPrompt, ...record } = turn
  const closed = {
    ...record,
    prompt: record.prompt.length > 0 ? record.prompt : provisionalPrompt,
    finished,
    endedAt,
    endReason: clip(endReason, 40),
  }
  const turns = state.turns.concat([closed])
  const excess = turns.length - state.maxKeptTurns
  if (excess > 0) turns.splice(0, excess)
  return { ...state, turns, current: null }
}

/** Fold one committed event into the timeline state (same reference when irrelevant). */
export function applyTimeline(state, event, bounds) {
  // The persistence header line arrives as a `type: 'session'` event during
  // cold restore; it carries the session's createdAt at the envelope level.
  if (event.type === 'session') {
    const created = Number(event.createdAt)
    if (Number.isFinite(created) && created > 0 && created !== state.createdAt) {
      return { ...state, createdAt: created }
    }
    return state
  }
  // Fork-seed guard: a forked session's log starts with the parent's copied
  // events, whose original timestamps predate the child's createdAt. The
  // parent already folded them, so skip. A resumed session's seed is its own
  // history (timestamps >= its own createdAt) and folds normally.
  const eventTime = Number(event.time)
  if (state.createdAt > 0 && Number.isFinite(eventTime) && eventTime > 0 && eventTime < state.createdAt) {
    return state
  }

  switch (event.type) {
    case 'turn/start': {
      const turn = event.data !== null && typeof event.data === 'object' && typeof event.data.turn === 'number'
        ? event.data.turn
        : (state.current?.turn ?? 0) + 1
      const next = state.current === null
        ? state
        : closeTurn(state, state.current, false, event.time)
      return { ...next, current: emptyTurn(turn, event.time) }
    }

    case 'turn/end': {
      if (state.current === null) return state
      const reason = event.data !== null && typeof event.data === 'object' && typeof event.data.reason === 'string'
        ? event.data.reason
        : ''
      return closeTurn(state, state.current, true, event.time, reason)
    }

    case 'user/message': {
      if (state.current === null) return state
      const data = event.data
      const source = data !== null && typeof data === 'object' ? data.source : null
      const text = data !== null && typeof data === 'object' ? textOfBlocks(data.content) : ''
      if (text.length === 0) return state
      const current = state.current
      if (isCoachEnrichment(source)) {
        if (current.enrichment === '') current.enrichment = clip(text, bounds.maxPromptChars)
        return { ...state }
      }
      const isHuman = source !== null && typeof source === 'object' && source.kind === 'user'
      if (current.provisionalPrompt === '') current.provisionalPrompt = clip(text, 100000)
      if (isHuman && current.prompt === '') current.prompt = clip(text, bounds.maxPromptChars)
      return { ...state }
    }

    case 'step/start':
    case 'step/end': {
      if (state.current === null) return state
      const step = event.data !== null && typeof event.data === 'object' && typeof event.data.step === 'number'
        ? event.data.step
        : 0
      if (step > state.current.steps) state.current.steps = step
      return { ...state }
    }

    case 'tool/call': {
      if (state.current === null) return state
      if (state.current.toolCalls.length >= bounds.maxToolCallsPerTurn) return state
      const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
      state.current.toolCalls.push({
        name: typeof data.name === 'string' ? data.name : '?',
        args: clip(typeof data.arguments === 'string' ? data.arguments : '', bounds.maxToolCallChars),
      })
      return { ...state }
    }

    case 'tool/result': {
      if (state.current === null) return state
      const data = event.data !== null && typeof event.data === 'object' ? event.data : null
      if (data !== null && data.error !== undefined && data.error !== null) state.current.toolErrors += 1
      return { ...state }
    }

    case 'assistant/message': {
      if (state.current === null) return state
      const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
      accumulateUsage(state.current.usage, data.usage)
      const text = data.message !== null && typeof data.message === 'object'
        ? textOfBlocks(data.message.content)
        : ''
      if (text.length > 0) state.current.finalText = clip(text, bounds.maxAssistantChars)
      return { ...state }
    }

    case 'request/header': {
      if (state.current === null) return state
      const header = event.data !== null && typeof event.data === 'object' ? event.data.header : null
      const config = header !== null && typeof header === 'object' ? header.config : null
      if (config !== null && typeof config === 'object') {
        if (typeof config.model === 'string') state.current.model = config.model
        if (typeof config.provider === 'string') state.current.provider = config.provider
      }
      return { ...state }
    }

    case 'llm/retry': {
      if (state.current === null) return state
      state.current.retries += 1
      return { ...state }
    }

    case 'compaction/summary': {
      if (state.current === null) return state
      state.current.compactions += 1
      return { ...state }
    }

    case 'feedback/record': {
      if (state.current === null) return state
      state.current.feedback += 1
      return { ...state }
    }

    default:
      return state
  }
}

/**
 * The `tacitTimeline` projection definition. `boundsOf` is re-read on
 * every fold so retention settings changed from the UI apply live.
 */
export function createTimelineDefinition(boundsOf) {
  const view = (state) => ({
    turns: state.current === null ? state.turns : state.turns.concat([stripProvisional(state.current)]),
  })
  const definition = {
    key: 'tacitTimeline',
    // Contract (dsh >= 0.1.1-rc.1): without `wire` and `stateSchema`
    // the registry treats the unit as host-only and never pushes to the browser.
    stateSchema: timelineStateSchema,
    wire: {
      viewSchema: timelineViewSchema,
      view,
    },
    init: () => ({ createdAt: 0, turns: [], current: null, maxKeptTurns: 60 }),
    apply: (state, event) => {
      const bounds = {
        ...DEFAULT_BOUNDS,
        ...(boundsOf === undefined ? {} : boundsOf()),
      }
      // Keep the retention cap inside the persisted state so old checkpoints
      // restore with the bound that produced them; refresh it live here.
      if (state.maxKeptTurns !== bounds.maxKeptTurns) {
        state = { ...state, maxKeptTurns: bounds.maxKeptTurns }
      }
      return applyTimeline(state, event, bounds)
    },
    // 1 → 2: turn digests gained `endReason` (from turn/end data.reason).
    // 2 → 3: turn digests gained `enrichment` (the coach's pre-send context note).
    stateVersion: 3,
  }
  return definition
}

/** Strip the fold-internal provisional field before anything leaves the fold. */
function stripProvisional(turn) {
  if (turn === null || turn === undefined) return turn
  const { provisionalPrompt, ...rest } = turn
  return rest
}
