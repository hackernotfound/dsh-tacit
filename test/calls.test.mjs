// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * callCoachModel: cheap, structured model calls through the harness llm
 * waterfall — low reasoning effort, tool-schema structured output, no
 * reasoning-text fallback, effort downgrade on unsupported deployments.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callCoachModel, clipSafe } from '../lib/analyze.js'

const TOOL = { name: 'report', description: 'the report', parameters: { type: 'object', properties: {} } }

function ctxWith(stream) {
  return { get: (name) => (name === 'llm' ? { stream } : undefined) }
}

test('callCoachModel sends a tool schema, low reasoning effort and the session id', async () => {
  const captured = []
  const ctx = ctxWith(async function* (options) {
    captured.push(options)
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'c1', name: 'report', arguments: '{"a":1}' } }
    yield { type: 'finish', reason: 'tool-calls' }
  })
  const text = await callCoachModel(ctx, {
    provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, tool: TOOL, sessionId: 'session-9',
  })
  assert.equal(text, '{"a":1}')
  assert.equal(captured[0].tools[0].name, 'report')
  assert.equal(captured[0].reasoningEffort, 'low')
  assert.equal(captured[0].sessionId, 'session-9')
})

test('callCoachModel assembles tool-call deltas when no block-end block arrives', async () => {
  const ctx = ctxWith(async function* () {
    yield { type: 'tool-call-delta', index: 0, id: 'c1', name: 'report', argumentsDelta: '{"a":' }
    yield { type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '2}' }
    yield { type: 'finish', reason: 'tool-calls' }
  })
  const text = await callCoachModel(ctx, { provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, tool: TOOL })
  assert.equal(text, '{"a":2}')
})

test('callCoachModel never returns reasoning text as the answer', async () => {
  const ctx = ctxWith(async function* () {
    yield { type: 'reasoning-delta', index: 0, text: '{"looks":"like json but is chain of thought"}' }
    yield { type: 'finish', reason: 'stop' }
  })
  const text = await callCoachModel(ctx, { provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, tool: TOOL })
  assert.equal(text, '')
})

test('callCoachModel retries once without reasoningEffort when the deployment rejects it', async () => {
  const efforts = []
  const ctx = ctxWith(async function* (options) {
    efforts.push(options.reasoningEffort)
    if (options.reasoningEffort !== undefined) {
      const error = new Error('DeepSeek deployment does not support reasoning effort "low"')
      error.code = 'UNSUPPORTED_REASONING_EFFORT'
      throw error
    }
    yield { type: 'text-delta', index: 0, text: '{"ok":true}' }
  })
  const text = await callCoachModel(ctx, { provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000 })
  assert.equal(text, '{"ok":true}')
  assert.deepEqual(efforts, ['low', undefined])
})

test('callCoachModel reports usage via onUsage with an object finish reason', async () => {
  const records = []
  const ctx = ctxWith(async function* () {
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3 } }
    yield { type: 'text-delta', index: 0, text: 'hi' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const text = await callCoachModel(ctx, {
    provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, onUsage: (record) => records.push(record),
  })
  assert.equal(text, 'hi')
  assert.equal(records.length, 1)
  const record = records[0]
  assert.equal(record.finish, 'stop')
  assert.equal(record.status, 'ok')
  assert.equal(record.code, '')
  assert.equal(record.model, 'm')
  assert.equal(record.provider, 'p')
  assert.equal(record.reasoningEffort, 'low')
  assert.ok(record.durationMs >= 0)
  assert.ok(Number.isFinite(record.startedAt))
  assert.deepEqual(record.usage, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3 })
})

test('callCoachModel onUsage still works with a plain string finish reason', async () => {
  const records = []
  const ctx = ctxWith(async function* () {
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 1 } }
    yield { type: 'finish', reason: 'stop' }
  })
  await callCoachModel(ctx, {
    provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, onUsage: (record) => records.push(record),
  })
  assert.equal(records.length, 1)
  assert.equal(records[0].finish, 'stop')
  assert.equal(records[0].status, 'ok')
  assert.deepEqual(records[0].usage, { inputTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })
})

test('callCoachModel onUsage fires twice on the reasoning-effort fallback', async () => {
  const records = []
  const ctx = ctxWith(async function* (options) {
    if (options.reasoningEffort !== undefined) {
      const error = new Error('DeepSeek deployment does not support reasoning effort "low"')
      error.code = 'UNSUPPORTED_REASONING_EFFORT'
      throw error
    }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const text = await callCoachModel(ctx, {
    provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, onUsage: (record) => records.push(record),
  })
  assert.equal(text, 'ok')
  assert.equal(records.length, 2)
  assert.equal(records[0].reasoningEffort, 'low')
  assert.equal(records[0].status, 'failed')
  assert.equal(records[0].code, 'UNSUPPORTED_REASONING_EFFORT')
  assert.equal(records[1].reasoningEffort, null)
  assert.equal(records[1].status, 'ok')
})

test('callCoachModel onUsage reports unmetered when no usage chunk arrives', async () => {
  const records = []
  const ctx = ctxWith(async function* () {
    yield { type: 'text-delta', index: 0, text: 'hi' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  await callCoachModel(ctx, {
    provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, onUsage: (record) => records.push(record),
  })
  assert.equal(records.length, 1)
  assert.equal(records[0].status, 'unmetered')
  assert.equal(records[0].usage, null)
})

test('callCoachModel onUsage reports a failed status and throws with the failure code on an error finish', async () => {
  const records = []
  const ctx = ctxWith(async function* () {
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'x' } } }
  })
  await assert.rejects(
    () => callCoachModel(ctx, {
      provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, onUsage: (record) => records.push(record),
    }),
    (error) => {
      assert.equal(error.code, 'RATE_LIMIT')
      assert.equal(error.message, 'x')
      return true
    },
  )
  assert.equal(records.length, 1)
  const record = records[0]
  assert.equal(record.status, 'failed')
  assert.equal(record.code, 'RATE_LIMIT')
  assert.deepEqual(record.usage, { inputTokens: 7, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })
})

test('callCoachModel onUsage reports one failed record when the stream throws mid-stream', async () => {
  const records = []
  const ctx = ctxWith(async function* () {
    yield { type: 'text-delta', index: 0, text: 'partial' }
    throw new Error('boom')
  })
  await assert.rejects(
    () => callCoachModel(ctx, {
      provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000, onUsage: (record) => records.push(record),
    }),
    /boom/,
  )
  assert.equal(records.length, 1)
  assert.equal(records[0].status, 'failed')
  assert.equal(records[0].usage, null)
})

test('callCoachModel does not fail the call when the onUsage sink throws', async () => {
  const ctx = ctxWith(async function* () {
    yield { type: 'text-delta', index: 0, text: 'hi' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const text = await callCoachModel(ctx, {
    provider: 'p', model: 'm', system: 's', userText: 'u', maxTokens: 10, timeoutMs: 1000,
    onUsage: () => { throw new Error('sink exploded') },
  })
  assert.equal(text, 'hi')
})

test('clipSafe never cuts a surrogate pair in half', () => {
  const text = 'a'.repeat(199) + '👍' + 'tail'
  const clipped = clipSafe(text, 200)
  assert.ok(clipped.length <= 200)
  assert.ok(!/[\uD800-\uDBFF]$/.test(clipped), 'must not end on a lone high surrogate')
  assert.equal(clipSafe('short', 200), 'short')
})
