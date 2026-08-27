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

test('clipSafe never cuts a surrogate pair in half', () => {
  const text = 'a'.repeat(199) + '👍' + 'tail'
  const clipped = clipSafe(text, 200)
  assert.ok(clipped.length <= 200)
  assert.ok(!/[\uD800-\uDBFF]$/.test(clipped), 'must not end on a lone high surrogate')
  assert.equal(clipSafe('short', 200), 'short')
})
