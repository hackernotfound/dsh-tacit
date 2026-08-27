import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTimelineDefinition, applyTimeline, emptyTurn, DEFAULT_BOUNDS } from '../lib/fold.js'
import { timelineStateSchema, timelineViewSchema } from '../lib/schema.js'

const ev = (type, seq, data = {}, time = seq * 1000) => ({ type, seq, time, data })

function foldAll(events, bounds = DEFAULT_BOUNDS) {
  const definition = createTimelineDefinition(() => bounds)
  let state = definition.init()
  for (const event of events) state = definition.apply(state, event)
  return { state, view: definition.view(state) }
}

const textMessage = (text, source = { kind: 'user' }) => ({
  content: [{ type: 'text', text }],
  source,
})

test('folds a complete turn: prompt, tools, usage, final text', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('Fix the failing login test')),
    ev('request/header', 3, { header: { config: { model: 'deepseek-v4-pro', provider: 'deepseek' }, reason: 'initial' } }),
    ev('step/start', 4, { turn: 1, step: 1 }),
    ev('tool/call', 5, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls -la"}' }),
    ev('tool/result', 6, { turn: 1, step: 1, message: { content: [] } }),
    ev('assistant/message', 7, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Done' }] }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 } }),
    ev('step/end', 8, { turn: 1, step: 1 }),
    ev('turn/end', 9, { turn: 1, reason: 'success' }),
  ]
  const { state, view } = foldAll(events)
  assert.equal(state.turns.length, 1)
  const turn = view.turns[0]
  assert.equal(turn.turn, 1)
  assert.equal(turn.prompt, 'Fix the failing login test')
  assert.equal(turn.steps, 1)
  assert.equal(turn.toolCalls.length, 1)
  assert.equal(turn.toolCalls[0].name, 'bash')
  assert.equal(turn.toolCalls[0].args, '{"command":"ls -la"}')
  assert.equal(turn.usage.inputTokens, 100)
  assert.equal(turn.usage.cacheReadTokens, 30)
  assert.equal(turn.finalText, 'Done')
  assert.equal(turn.model, 'deepseek-v4-pro')
  assert.equal(turn.provider, 'deepseek')
  assert.equal(turn.finished, true)
  assert.equal(turn.endedAt, 9000)
})

test('fork-seed events (timestamps before createdAt) are skipped', () => {
  // A fork child's log: header line (createdAt=5000), parent-copied events
  // with original timestamps, then the child's own events.
  const events = [
    { type: 'session', seq: 0, time: 5000, createdAt: 5000 },
    ev('turn/start', 1, { turn: 1 }, 1000),
    ev('user/message', 2, textMessage('parent seed prompt'), 1100),
    ev('session/end-seed', 3, {}, 5000),
    ev('turn/start', 4, { turn: 5 }, 5100),
    ev('user/message', 5, textMessage('the real prompt'), 5200),
    ev('turn/end', 6, { turn: 5, reason: 'success' }, 5300),
  ]
  const { state, view } = foldAll(events)
  assert.equal(state.createdAt, 5000)
  assert.equal(view.turns.length, 1)
  assert.equal(view.turns[0].turn, 5)
  assert.equal(view.turns[0].prompt, 'the real prompt')
})

test('a resumed session folds its own history (timestamps >= createdAt)', () => {
  const events = [
    { type: 'session', seq: 0, time: 5000, createdAt: 5000 },
    ev('turn/start', 1, { turn: 1 }, 5100),
    ev('user/message', 2, textMessage('own history prompt'), 5200),
    ev('turn/end', 3, { turn: 1, reason: 'success' }, 5300),
    ev('session/end-seed', 4, {}, 5300),
    ev('turn/start', 5, { turn: 2 }, 6000),
    ev('turn/end', 6, { turn: 2, reason: 'success' }, 6100),
  ]
  const { view } = foldAll(events)
  assert.equal(view.turns.length, 2)
  assert.deepEqual(view.turns.map((t) => t.turn), [1, 2])
  assert.equal(view.turns[0].prompt, 'own history prompt')
})

test('counts retries, compactions, feedback, and tool errors', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('do things')),
    ev('llm/retry', 3, {}),
    ev('llm/retry', 4, {}),
    ev('compaction/summary', 5, {}),
    ev('feedback/record', 6, {}),
    ev('tool/result', 7, { turn: 1, step: 1, message: { content: [] }, error: { name: 'X', code: 'Y' } }),
    ev('tool/result', 8, { turn: 1, step: 1, message: { content: [] } }),
    ev('turn/end', 9, { turn: 1, reason: 'success' }),
  ]
  const { view } = foldAll(events)
  const turn = view.turns[0]
  assert.equal(turn.retries, 2)
  assert.equal(turn.compactions, 1)
  assert.equal(turn.feedback, 1)
  assert.equal(turn.toolErrors, 1)
})

test('clips prompt, tool args, and assistant text to bounds', () => {
  const bounds = { ...DEFAULT_BOUNDS, maxPromptChars: 10, maxToolCallChars: 6, maxAssistantChars: 8 }
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('12345678901234567890')),
    ev('tool/call', 3, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"abcdefghij"}' }),
    ev('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'ABCDEFGHIJKLMNOP' }] } }),
    ev('turn/end', 5, { turn: 1, reason: 'success' }),
  ]
  const { view } = foldAll(events, bounds)
  const turn = view.turns[0]
  assert.equal(turn.prompt, '1234567890')
  assert.equal(turn.toolCalls[0].args, '{"comm')
  assert.equal(turn.finalText, 'ABCDEFGH')
})

test('retains only the newest maxKeptTurns whole turns', () => {
  const bounds = { ...DEFAULT_BOUNDS, maxKeptTurns: 2 }
  const events = []
  let seq = 0
  for (const turn of [1, 2, 3]) {
    events.push(ev('turn/start', ++seq, { turn }))
    events.push(ev('user/message', ++seq, textMessage(`prompt ${turn}`)))
    events.push(ev('turn/end', ++seq, { turn, reason: 'success' }))
  }
  const { state, view } = foldAll(events, bounds)
  assert.equal(view.turns.length, 2)
  assert.deepEqual(view.turns.map((t) => t.turn), [2, 3])
  assert.equal(state.turns.length, 2)
})

test('provisional fallback: a turn with only plugin-source user messages still records text', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('injected context', { kind: 'plugin', plugin: 'dsh-skill' })),
    ev('turn/end', 3, { turn: 1, reason: 'success' }),
  ]
  const { view } = foldAll(events)
  assert.equal(view.turns[0].prompt, 'injected context')
})

test('human prompt wins over an earlier plugin-source message', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('injected context', { kind: 'plugin', plugin: 'dsh-skill' })),
    ev('user/message', 3, textMessage('the human prompt')),
    ev('turn/end', 4, { turn: 1, reason: 'success' }),
  ]
  const { view } = foldAll(events)
  assert.equal(view.turns[0].prompt, 'the human prompt')
})

test('usage accumulates across multiple assistant messages in one turn', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('task')),
    ev('assistant/message', 3, { turn: 1, step: 1, message: { content: [] }, usage: { inputTokens: 10, outputTokens: 2 } }),
    ev('assistant/message', 4, { turn: 1, step: 2, message: { content: [] }, usage: { inputTokens: 15, outputTokens: 3, reasoningTokens: 4 } }),
    ev('turn/end', 5, { turn: 1, reason: 'success' }),
  ]
  const { view } = foldAll(events)
  assert.equal(view.turns[0].usage.inputTokens, 25)
  assert.equal(view.turns[0].usage.outputTokens, 5)
  assert.equal(view.turns[0].usage.reasoningTokens, 4)
})

test('an open turn appears in the view and never in the finished ring', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('in progress')),
  ]
  const { state, view } = foldAll(events)
  assert.equal(state.turns.length, 0)
  assert.equal(view.turns.length, 1)
  assert.equal(view.turns[0].finished, false)
})

test('unrelated events leave the state reference unchanged', () => {
  const definition = createTimelineDefinition(() => DEFAULT_BOUNDS)
  const state = definition.init()
  const next = definition.apply(state, ev('session/title', 1, { title: 'hi' }))
  assert.equal(next, state)
})

test('state and wire payloads pass their schemas', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('schema check')),
    ev('tool/call', 3, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }),
    ev('turn/end', 4, { turn: 1, reason: 'success' }),
  ]
  const { state, view } = foldAll(events)
  assert.doesNotThrow(() => timelineStateSchema.parse(state))
  assert.doesNotThrow(() => timelineViewSchema.parse(view))
})

test('turn number falls back when turn/start data is missing', () => {
  const events = [
    ev('turn/start', 1),
    ev('user/message', 2, textMessage('no turn number given')),
    ev('turn/end', 3, { reason: 'success' }),
  ]
  const { view } = foldAll(events)
  assert.equal(view.turns[0].turn, 1)
})

test('turn/end data.reason is captured into the digest as endReason', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('rejected prompt')),
    ev('turn/end', 3, { turn: 1, reason: 'rejected' }),
  ]
  const { view } = foldAll(events)
  assert.equal(view.turns[0].endReason, 'rejected')

  // A missing reason records '' and an open (unfinished) turn has none set.
  const cancelled = foldAll([
    ev('turn/start', 1, { turn: 2 }),
    ev('user/message', 2, textMessage('another')),
    ev('turn/end', 3, { turn: 2 }),
  ])
  assert.equal(cancelled.view.turns[0].endReason, '')
  const open = foldAll([
    ev('turn/start', 1, { turn: 3 }),
    ev('user/message', 2, textMessage('still going')),
  ])
  assert.equal(open.view.turns[0].endReason, '')
})

test('endReason is clipped to 40 chars and the definition is stateVersion 3', () => {
  const events = [
    ev('turn/start', 1, { turn: 1 }),
    ev('user/message', 2, textMessage('clip me')),
    ev('turn/end', 3, { turn: 1, reason: 'r'.repeat(100) }),
  ]
  const { state, view } = foldAll(events)
  assert.equal(view.turns[0].endReason.length, 40)
  assert.doesNotThrow(() => timelineStateSchema.parse(state))
  assert.equal(createTimelineDefinition(() => DEFAULT_BOUNDS).stateVersion, 3)
})

test('a plugin-sourced user message from the coach is folded as the turn enrichment, not as the prompt', () => {
  const definition = createTimelineDefinition(() => ({}))
  let state = definition.init()
  const events = [
    { type: 'turn/start', seq: 0, time: 100, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 200, data: { content: [{ type: 'text', text: 'fix it' }], source: { kind: 'user' } } },
    { type: 'user/message', seq: 2, time: 201, data: { content: [{ type: 'text', text: 'Context from Tacit: check src/ first.' }], source: { kind: 'plugin', plugin: 'dsh-tacit' } } },
    { type: 'turn/end', seq: 3, time: 300, data: { turn: 1, reason: 'success' } },
  ]
  for (const event of events) state = definition.apply(state, event)
  const view = definition.wire.view(state)
  assert.equal(view.turns[0].prompt, 'fix it')
  assert.equal(view.turns[0].enrichment, 'Context from Tacit: check src/ first.')
})
