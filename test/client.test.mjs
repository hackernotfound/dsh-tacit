// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * Client bundle smoke test WITHOUT a browser: stubs the module-loader
 * environment, loads the real bundle, applies it against a fake client ctx,
 * and server-renders the registered slot components with React DOM server.
 * This exercises every UI wiring path (slots, i18n, projection reads, store,
 * report cards, learning gate, preview overlay) before the harness restart.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { COACH_ERROR_CODES } from '../lib/schema.js'

// No real network in SSR tests: the bundle's fire-and-forget calls
// (/applied, /feedback) reject and are swallowed by their .catch handlers.
globalThis.fetch = async () => {
  throw new Error('no network in SSR tests')
}

// ── Browser environment stub (must exist BEFORE the bundle is imported) ────

const registrations = []
globalThis.window = globalThis
globalThis.window.__ModuleLoader__ = {
  load: (spec) => {
    registrations.push(spec)
  },
}

await import('../client/client.js')

const fakeRequire = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      MarkdownText: (props) => React.createElement('div', { className: 'tacit-md-test' }, String(props.text ?? '')),
    }
  }
  throw new Error('unexpected require: ' + name)
}

// ── Fake client ctx + apply ────────────────────────────────────────────────

const slotEntries = []
const localeDicts = {}
const ctx = {
  locale: {
    register: (ns, dicts) => {
      localeDicts[ns] = dicts
      return () => {}
    },
    bind: (ns) => {
      const dict = (localeDicts[ns] !== undefined && localeDicts[ns].en) || {}
      return (key, vars) => {
        let text = dict[key] !== undefined ? dict[key] : key
        if (vars !== undefined) {
          for (const k of Object.keys(vars)) text = text.split('{' + k + '}').join(String(vars[k]))
        }
        return text
      }
    },
  },
  slots: {
    inject: (name, factory) => {
      slotEntries.push({ name, registration: factory() })
    },
    register: (options, component) => ({ options, component }),
  },
  effect: (fn) => {
    fn()
  },
}

const plugin = registrations[0].factory(fakeRequire)
plugin.apply(ctx)

const sampleTurn = {
  turn: 2,
  startedAt: Date.now(),
  prompt: 'fix the bug please',
  steps: 3,
  toolCalls: [{ name: 'bash', args: '{"command":"grep"}' }],
  toolErrors: 0,
  retries: 1,
  compactions: 0,
  feedback: 0,
  usage: { inputTokens: 800, outputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 50 },
  finalText: 'done',
  model: 'deepseek-v4-flash',
  provider: 'deepseek',
  finished: true,
  endedAt: Date.now(),
}

const tabProps = {
  sessionId: 'session-ssr',
  useProjection: (key) => (key === 'tacitTimeline' ? { turns: [sampleTurn] } : undefined),
}

const overlayEntry = slotEntries.find((e) => e.name === 'conversation.input.overlay')
const overlayInjection = overlayEntry.registration.options.inject('session-ssr')
const store = overlayInjection.tacitStore

const buttonProps = {
  sessionId: 'session-ssr',
  input: { draft: 'hello' },
  inputActions: { setDraft() {} },
}

test('the bundle registers and applies with the five expected slots', () => {
  assert.equal(registrations.length, 1)
  assert.equal(plugin.name, 'dsh-tacit')
  assert.deepEqual(
    slotEntries.map((e) => e.name),
    ['conversation.view', 'conversation.input.left', 'conversation.input.overlay', 'conversation.input.dock', 'settings.section'],
  )
})

test('the preview store is injected as a flat prop, outside DSH reserved hooks', () => {
  assert.equal(Object.hasOwn(overlayInjection, 'hooks'), false)
  assert.equal(overlayInjection.tacitStore, store)
})

test('the settings section renders a Tacit page with the coach panel', () => {
  const Section = slotEntries.find((e) => e.name === 'settings.section').registration.component
  assert.equal(slotEntries.find((e) => e.name === 'settings.section').registration.options.id, 'tacit')
  assert.equal(slotEntries.find((e) => e.name === 'settings.section').registration.options.order, 32)
  const markup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(markup.includes('Tacit'))
  assert.ok(markup.includes('Learned from'))
  assert.ok(markup.includes('Auto-learning'))
})

test('the Coach tab renders turn rows, chips, and the Analyze button', () => {
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  const markup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(markup.includes('Tacit'))
  assert.ok(markup.includes('# 2'))
  assert.ok(markup.includes('fix the bug please'))
  assert.ok(markup.includes('1 tool calls'))
  assert.ok(markup.includes('3 steps'))
  assert.ok(markup.includes('retries 1'))
  assert.ok(markup.includes('Analyze'))
  assert.ok(markup.includes('Learned from'))
})

test('a stored report renders problems, improved prompt, explanation, and its trigger badge', () => {
  store.initDone = true
  store.config = { model: 'deepseek-v4-flash', liveSuggestions: true }
  store.profile = { analyzedCount: 1, patterns: [] }
  store.reports['2'] = {
    ok: true,
    turn: 2,
    time: Date.now(),
    model: 'deepseek-v4-flash',
    problems: [{ kind: 'ambiguous-goal', severity: 'high', what: 'no acceptance criteria', why: 'agent wandered' }],
    improvedPrompt: 'Rewritten prompt',
    explanation: 'Scope was open.'
  }
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  // Collapsed by default: the header carries the trigger badge, the body waits behind a toggle.
  store.expanded.delete(2)
  const collapsed = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(collapsed.includes('manual'))
  assert.ok(!collapsed.includes('Problems found'))
  assert.ok(collapsed.includes('Re-analyze'))
  assert.ok(!collapsed.includes('tacit-btn-primary'), 'manual Analyze is a secondary control')
  store.expanded.add(2)
  const markup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(markup.includes('Problems found'))
  assert.ok(markup.includes('ambiguous-goal'))
  assert.ok(markup.includes('High'))
  assert.ok(markup.includes('Rewritten prompt'))
  assert.ok(markup.includes('Scope was open.'))
  assert.ok(!markup.includes('token savings'))
  store.expanded.delete(2)
})

test('the composer button appears as soon as the store is ready (no learning gate) and hides when disabled', () => {
  const Button = slotEntries.find((e) => e.name === 'conversation.input.left').registration.component

  // Before init: nothing rendered.
  const freshStore = overlayEntry.registration.options.inject('session-ssr-2').tacitStore
  const beforeInit = renderToStaticMarkup(React.createElement(Button, {
    sessionId: 'session-ssr-2',
    input: { draft: 'hello' },
    inputActions: { setDraft() {} },
  }))
  assert.equal(beforeInit, '')

  // Ready with zero analyses: the button is already there.
  freshStore.initDone = true
  freshStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true }
  freshStore.profile = { analyzedCount: 0, patterns: [] }
  const readyMarkup = renderToStaticMarkup(React.createElement(Button, {
    sessionId: 'session-ssr-2',
    input: { draft: 'hello' },
    inputActions: { setDraft() {} },
  }))
  assert.ok(readyMarkup.includes('✨ Improve prompt'))

  // Feature disabled: hidden again.
  freshStore.config.liveSuggestions = false
  const hiddenMarkup = renderToStaticMarkup(React.createElement(Button, {
    sessionId: 'session-ssr-2',
    input: { draft: 'hello' },
    inputActions: { setDraft() {} },
  }))
  assert.equal(hiddenMarkup, '')
})

test('the tab renders the auto-learning status, per-prompt checkboxes, and the batch button', () => {
  store.initDone = true
  store.config = { model: 'deepseek-v4-flash', liveSuggestions: true, autoAnalyze: true, autoDailyBudget: 30 }
  store.profile = { analyzedCount: 3, patterns: [] }
  store.auto = { today: 2, budget: 30 }
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component

  const markup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(markup.includes('Learned from 3 prompt(s)'))
  assert.ok(markup.includes('Auto-learning on'))
  assert.ok(markup.includes('2/30 today'))
  assert.ok(!markup.includes('tacit-progress-fill'))
  // Manual selection is hidden by default — the tab reads as a log, not a to-do list.
  assert.ok(!markup.includes('checkbox'))
  assert.ok(!markup.includes('Coach selected'))
  assert.ok(markup.includes('Select prompts…'))
  assert.ok(markup.includes('Analyze it manually'))

  // Selecting mode reveals the checkboxes and the batch button; a tick updates its label.
  store.selecting = true
  const selectingMarkup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(selectingMarkup.includes('checkbox'))
  assert.ok(selectingMarkup.includes('Analyze selected (0)'))
  store.selection.add(2)
  const selectedMarkup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(selectedMarkup.includes('Analyze selected (1)'))
  store.selection.delete(2)
  store.selecting = false
})

test('the preview overlay renders pending, result, and closed states', () => {
  const Overlay = overlayEntry.registration.component
  const overlayProps = {
    sessionId: 'session-ssr',
    ...overlayEntry.registration.options.inject('session-ssr'),
    inputActions: { setDraft() {} },
  }

  store.preview = { open: false, pending: false, original: '', data: null, error: null }
  assert.equal(renderToStaticMarkup(React.createElement(Overlay, overlayProps)), '')

  store.preview = { open: true, pending: true, original: 'original draft', data: null, error: null }
  const pendingMarkup = renderToStaticMarkup(React.createElement(Overlay, overlayProps))
  assert.ok(pendingMarkup.includes('Analyzing your draft…'))

  store.preview = { open: true, pending: false, original: 'original draft', data: { improved: 'improved draft', rationale: 'added constraints' }, error: null }
  const resultMarkup = renderToStaticMarkup(React.createElement(Overlay, overlayProps))
  assert.ok(resultMarkup.includes('original draft'))
  assert.ok(resultMarkup.includes('improved draft'))
  assert.ok(resultMarkup.includes('added constraints'))
  assert.ok(!resultMarkup.includes('token savings'))
  assert.ok(resultMarkup.includes('Apply improvement'))
  assert.ok(resultMarkup.includes('Cancel'))

  store.preview = { open: true, pending: false, original: 'original draft', data: null, error: { code: 'call-failed', detail: 'boom' } }
  const errorMarkup = renderToStaticMarkup(React.createElement(Overlay, overlayProps))
  assert.ok(errorMarkup.includes('The model call failed: boom'))
})

test('the preview overlay shows "already complete" and no Apply when the rewrite equals the draft', () => {
  const Overlay = overlayEntry.registration.component
  const overlayProps = {
    sessionId: 'session-ssr',
    ...overlayEntry.registration.options.inject('session-ssr'),
    inputActions: { setDraft() {} },
  }

  store.preview = { open: true, pending: false, original: 'a finished prompt', data: { improved: '  a finished prompt \n', rationale: 'Already complete.', rewriteId: 'rw-same' }, error: null }
  const markup = renderToStaticMarkup(React.createElement(Overlay, overlayProps))
  assert.ok(markup.includes('already complete'))
  assert.ok(markup.includes('Already complete.'))
  assert.ok(!markup.includes('Apply improvement'))
  assert.ok(markup.includes('Cancel'))
  store.preview = { open: false, pending: false, original: '', data: null, error: null }
})

test('Apply replaces the draft without sending, while Cancel preserves it', () => {
  const testKit = plugin.__test
  let draft = 'original draft'
  let sends = 0
  const inputActions = {
    setDraft(value) {
      draft = value
    },
    send() {
      sends += 1
    },
  }

  store.initDone = true
  store.config = { model: 'deepseek-v4-flash', liveSuggestions: true }
  store.preview = {
    open: true,
    pending: false,
    original: draft,
    data: { improved: 'improved draft', rewriteId: 'rw-apply' },
    error: null,
  }
  testKit.applyImproved(store, inputActions)
  assert.equal(draft, 'improved draft')
  assert.equal(sends, 0)
  assert.equal(store.preview.open, false)

  draft = 'draft to keep'
  store.preview = {
    open: true,
    pending: false,
    original: draft,
    data: { improved: 'unused rewrite' },
    error: null,
  }
  testKit.closePreview(store)
  assert.equal(draft, 'draft to keep')
  assert.equal(sends, 0)
  assert.equal(store.preview.open, false)
})

test('the settings panel renders with the allowlisted model selector', () => {
  store.config = { model: 'deepseek-v4-flash', liveSuggestions: true }
  store.profile = { analyzedCount: 1, patterns: [] }
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  // The settings panel opens via a button click; render it directly through
  // the same component path by checking the collapsed state first, then
  // asserting the panel code path exists by rendering with the store ready.
  const markup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(markup.includes('Settings'))
  assert.ok(markup.includes('deepseek-v4-flash') === false) // selector only when opened
})

// ── v2 self-improving loop (feedback strip) ───────────────────────────────

// input.dock, not composer.dock: the harness renders composer.dock only once a
// conversation has content, so a strip there never shows for a first prompt.
const Dock = slotEntries.find((e) => e.name === 'conversation.input.dock').registration.component
const dockProps = { sessionId: 'session-ssr', useInput: () => '' }
const testKit = plugin.__test

test('the feedback strip opens above the composer after every Apply (no learning gate)', () => {
  store.initDone = true
  store.config = { model: 'deepseek-v4-flash', liveSuggestions: true }
  store.feedback = { open: false, verdict: null, reason: '', sending: false, noted: false, rewriteId: null, fading: false }

  // Disabled feature: Apply must NOT open the strip.
  store.config.liveSuggestions = false
  store.profile = { analyzedCount: 0, patterns: [] }
  store.preview = { open: true, pending: false, original: 'original draft', data: { improved: 'improved draft', rewriteId: 'rw-1' }, error: null }
  testKit.applyImproved(store, { setDraft() {} })
  assert.equal(store.feedback.open, false, 'no strip when the feature is off')
  assert.equal(renderToStaticMarkup(React.createElement(Dock, dockProps)), '')

  // Enabled: Apply opens the strip under the composer, from the first analysis on.
  store.config.liveSuggestions = true
  store.profile = { analyzedCount: 0, patterns: [] }
  store.preview = { open: true, pending: false, original: 'original draft', data: { improved: 'improved draft', rewriteId: 'rw-2' }, error: null }
  testKit.applyImproved(store, { setDraft() {} })
  assert.equal(store.feedback.open, true)
  const markup = renderToStaticMarkup(React.createElement(Dock, dockProps))
  assert.ok(markup.includes('Was this better?'))
  assert.ok(markup.includes('👍'))
  assert.ok(markup.includes('👎'))
  assert.ok(markup.includes('tacit-feedback'))
})

test('👎 expands the one-line reason field; posting shows noted and closes', () => {
  store.feedback = { open: true, verdict: 'down', reason: '', sending: false, noted: false, rewriteId: 'rw-2', fading: false }
  const markup = renderToStaticMarkup(React.createElement(Dock, dockProps))
  assert.ok(markup.includes('What was wrong? (one line)'))
  assert.ok(markup.includes('Send feedback'))

  // Noted state replaces the strip content before it closes.
  store.feedback = { ...store.feedback, noted: true }
  const notedMarkup = renderToStaticMarkup(React.createElement(Dock, dockProps))
  assert.ok(notedMarkup.includes('Noted — thanks!'))
  assert.ok(!notedMarkup.includes('Send feedback'))

  // A closed strip renders nothing.
  testKit.closeFeedback(store)
  assert.equal(renderToStaticMarkup(React.createElement(Dock, dockProps)), '')
})

test('the strip fades out (CSS class) instead of hard-closing when the next send lands', () => {
  store.feedback = { open: true, verdict: null, reason: '', sending: false, noted: false, rewriteId: 'rw-2', fading: false }
  // The real shell triggers this from the useInput phase observer; the SSR
  // suite drives the same path directly (effects never run server-side).
  testKit.fadeFeedback(store)
  assert.equal(store.feedback.open, true)
  assert.equal(store.feedback.fading, true)
  const markup = renderToStaticMarkup(React.createElement(Dock, dockProps))
  assert.ok(markup.includes('tacit-feedback-fading'))
})

test('the settings page shows learned style rules once they exist', () => {
  const rootStore = testKit.rootStore
  rootStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true }
  rootStore.profile = {
    analyzedCount: 25,
    patterns: [],
    styleRules: [{ rule: 'Keep the original intent.', createdAt: 1 }, { rule: 'Always add acceptance criteria.', createdAt: 2 }],
  }
  const Section = slotEntries.find((e) => e.name === 'settings.section').registration.component
  const markup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(markup.includes('Learned style rules'))
  assert.ok(markup.includes('Keep the original intent.'))
  assert.ok(markup.includes('Always add acceptance criteria.'))

  // Rules that exist are shown even during the learning phase.
  rootStore.profile = { analyzedCount: 3, patterns: [], styleRules: [{ rule: 'Early rule.', createdAt: 1 }] }
  const learningMarkup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(learningMarkup.includes('Early rule.'))

  // Ready but no rules: the empty hint explains how rules appear.
  rootStore.profile = { analyzedCount: 25, patterns: [] }
  const emptyMarkup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(emptyMarkup.includes('Learned style rules'))
  assert.ok(emptyMarkup.includes('No style rules yet'))
  rootStore.profile = null
})

test('the clear-reports control says it clears every session, not just this one', () => {
  const en = localeDicts['dsh-tacit'].en
  assert.match(en['settings.clear'], /all/i)
  assert.doesNotMatch(en['settings.clear'], /this session/i)
})

test('the settings page shows what the agent is told, with per-directive toggles and an add box', () => {
  const rootStore = testKit.rootStore
  rootStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true, autoAnalyze: true, autoDailyBudget: 30, steerAgent: true }
  rootStore.profile = {
    analyzedCount: 4,
    patterns: [],
    styleRules: [],
    directives: [{ id: 'd1', text: 'Grep before asking for paths.', enabled: true, source: 'distilled', createdAt: 1 }],
  }
  rootStore.steering = { enabled: true, text: '## About this user\n- Grep before asking for paths.' }
  const Section = slotEntries.find((e) => e.name === 'settings.section').registration.component
  const markup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(markup.includes('What the agent is told about you'))
  assert.ok(markup.includes('Grep before asking for paths.'))
  assert.ok(markup.includes('tacit-directive-toggle'))
  assert.ok(markup.includes('Add your own directive'))
  rootStore.profile = null
  rootStore.steering = null
})

test('the report card no longer shows the guessed savings percentage', () => {
  store.initDone = true
  store.config = { model: 'deepseek-v4-flash', liveSuggestions: true }
  store.reports['2'] = { ok: true, turn: 2, time: Date.now(), model: 'deepseek-v4-flash', problems: [], improvedPrompt: 'Rewritten', explanation: '', trigger: 'auto' }
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  store.expanded.add(2)
  const markup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(!markup.includes('token savings'))
  assert.ok(markup.includes('auto'), 'the trigger badge is shown instead')
  store.expanded.delete(2)
})

test('only the newest unfinished turn is "In progress"; older ones read as interrupted', () => {
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  const older = { ...sampleTurn, turn: 5, finished: false, endedAt: 0 }
  const newest = { ...sampleTurn, turn: 6, finished: false, endedAt: 0 }
  const props = { ...tabProps, useProjection: () => ({ turns: [older, newest] }) }
  const markup = renderToStaticMarkup(React.createElement(Tab, props))
  assert.equal((markup.match(/In progress/g) || []).length, 1)
  assert.ok(markup.includes('interrupted'))
})

test('the status card shows the measured trend when enough turns exist', () => {
  const rootStore = testKit.rootStore
  rootStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true, autoAnalyze: true, autoDailyBudget: 30, steerAgent: true }
  rootStore.profile = { analyzedCount: 4, patterns: [] }
  rootStore.trend = { enough: true, window: 20, early: { n: 20, messyRate: 0.4, tokensPerTurn: 12000 }, recent: { n: 20, messyRate: 0.2, tokensPerTurn: 9000 } }
  const Section = slotEntries.find((e) => e.name === 'settings.section').registration.component
  const markup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(markup.includes('Messy turns: 40% → 20%'))
  assert.ok(markup.includes('12.0k → 9.0k'))
  rootStore.profile = null
  rootStore.trend = null
})

test('a turn row shows the context the coach added before the send', () => {
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  const props = { ...tabProps, useProjection: () => ({ turns: [{ ...sampleTurn, enrichment: 'Context from Tacit: check apps/web first.' }] }) }
  const markup = renderToStaticMarkup(React.createElement(Tab, props))
  assert.ok(markup.includes('Context added'))
  assert.ok(markup.includes('check apps/web first.'))
})

test('the composer ✨ button is styled like the harness toolbar controls: borderless, transparent', () => {
  const rule = /\.tacit-improve-btn\{([^}]*)\}/.exec(String(testKit.css))
  assert.ok(rule, 'the improve button rule exists')
  assert.match(rule[1], /background:transparent/)
  assert.match(rule[1], /border:0/)
  assert.match(rule[1], /font-size:13px/)
  assert.match(rule[1], /font-weight:500/)
})

test('the directives editor shows trial / active / retired status chips', () => {
  const rootStore = testKit.rootStore
  rootStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true, autoAnalyze: true, autoDailyBudget: 30, steerAgent: true, directiveTrialTurns: 10 }
  rootStore.profile = {
    analyzedCount: 4,
    patterns: [],
    directives: [
      { id: 'c', text: 'On trial.', enabled: true, source: 'distilled', createdAt: 1, status: 'candidate', trial: { turns: 4, messy: 1, baselineRate: 0.2, startedAt: 1 } },
      { id: 'a', text: 'Proven.', enabled: true, source: 'distilled', createdAt: 2, status: 'active' },
      { id: 'r', text: 'Dropped.', enabled: false, source: 'distilled', createdAt: 3, status: 'retired', retiredReason: 'messy turns 20% → 45% while active' },
    ],
  }
  const Section = slotEntries.find((e) => e.name === 'settings.section').registration.component
  const markup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(markup.includes('trial 4/10'))
  assert.ok(markup.includes('active'))
  assert.ok(markup.includes('retired'))
  assert.ok(markup.includes('20% → 45%'))
  rootStore.profile = null
})

test('the bootstrap button lives in the tab and in Settings, and shows progress while learning', () => {
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  store.initDone = true
  store.bootstrap = null
  const tabMarkup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(tabMarkup.includes('Learn from my last 20 turns'))
  store.bootstrap = { running: true, done: 7, total: 20 }
  const runningMarkup = renderToStaticMarkup(React.createElement(Tab, tabProps))
  assert.ok(runningMarkup.includes('Learning… 7/20'))
  store.bootstrap = null

  const rootStore = testKit.rootStore
  rootStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true, autoAnalyze: true, autoDailyBudget: 30, steerAgent: true }
  rootStore.profile = { analyzedCount: 0, patterns: [], directives: [] }
  rootStore.bootstrap = null
  const Section = slotEntries.find((e) => e.name === 'settings.section').registration.component
  const settingsMarkup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(settingsMarkup.includes('Learn from my last 20 turns'))
  rootStore.profile = null
})

test('the zh and en dictionaries carry identical key sets (the host only checks this in TypeScript)', () => {
  const dicts = localeDicts['dsh-tacit']
  assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort())
  for (const key of Object.keys(dicts.en)) {
    assert.equal(typeof dicts.zh[key], 'string', key)
    assert.ok(dicts.zh[key].length > 0, key)
  }
})

test('every error code the client can render has a message in both dictionaries', () => {
  const dicts = localeDicts['dsh-tacit']
  const codes = ['bad-request', 'no-session', 'not-retained', 'busy', 'continuation', 'network', 'internal', ...COACH_ERROR_CODES]
  for (const code of codes) {
    assert.equal(typeof dicts.en['err.' + code], 'string', code)
    assert.equal(typeof dicts.zh['err.' + code], 'string', code)
  }
})

test('the settings page marks workspace-scoped directives and offers a scope for new ones', () => {
  const rootStore = testKit.rootStore
  rootStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true, steerAgent: true }
  rootStore.profile = {
    analyzedCount: 3,
    patterns: [],
    styleRules: [],
    directives: [
      { id: 'g', text: 'Global rule.', enabled: true, source: 'distilled', createdAt: 1, status: 'active' },
      { id: 'a', text: 'Check apps/web first.', enabled: true, source: 'user', createdAt: 2, workspace: '/repos/alpha' },
    ],
  }
  rootStore.steering = { enabled: true, text: '' }
  rootStore.workspaces = [{ cwd: '/repos/alpha', label: 'alpha' }, { cwd: '/repos/beta', label: 'beta' }]
  const Section = slotEntries.find((e) => e.name === 'settings.section').registration.component
  const markup = renderToStaticMarkup(React.createElement(Section, {}))
  assert.ok(markup.includes('only alpha'), 'scoped chip shows the workspace name')
  assert.ok(markup.includes('Everywhere'), 'scope selector defaults to everywhere')
  assert.ok(markup.includes('<option value="/repos/beta">beta</option>'))
  rootStore.workspaces = []
  rootStore.profile = null
})

// ── Settings page as accessible collapsible section cards ─────────────────

const SectionComponent = slotEntries.find((e) => e.name === 'settings.section').registration.component
const CARD_IDS = ['overview', 'usage', 'pricing', 'learning', 'guidance', 'improve', 'history', 'privacy']

/** renderToStaticMarkup escapes `&` in text nodes; card titles may carry one. */
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;')

function renderSettings() {
  return renderToStaticMarkup(React.createElement(SectionComponent, {}))
}

function seedSettings() {
  const rootStore = testKit.rootStore
  rootStore.config = { model: 'deepseek-v4-flash', liveSuggestions: true, autoAnalyze: true, autoDailyBudget: 30, steerAgent: true }
  rootStore.profile = { analyzedCount: 4, patterns: [], styleRules: [], directives: [] }
  return rootStore
}

function tagWithId(markup, tag, id) {
  const match = new RegExp('<' + tag + '[^>]*id="' + id + '"[^>]*>').exec(markup)
  assert.ok(match, 'expected a <' + tag + '> with id="' + id + '"')
  return match[0]
}

test('the settings page renders all eight collapsible section cards', () => {
  const rootStore = seedSettings()
  const en = localeDicts['dsh-tacit'].en
  const markup = renderSettings()
  for (const id of CARD_IDS) {
    const title = en['card.' + id]
    assert.equal(typeof title, 'string', 'card.' + id + ' is translated')
    assert.ok(markup.includes(escapeHtml(title)), 'card.' + id + ' title renders')
  }
  assert.ok(markup.includes(en['improve.explain']))
  assert.ok(markup.includes(en['privacy.stored']))
  assert.ok(markup.includes('Model: deepseek-v4-flash'))
  rootStore.profile = null
})

test('overview and usage are open by default, every other card is collapsed', () => {
  seedSettings()
  const markup = renderSettings()
  for (const id of CARD_IDS) {
    const head = tagWithId(markup, 'button', 'tacit-card-' + id + '-head')
    const expected = id === 'overview' || id === 'usage' ? 'true' : 'false'
    assert.ok(head.includes('aria-expanded="' + expected + '"'), id + ' aria-expanded=' + expected + ' — got ' + head)
  }
  testKit.rootStore.profile = null
})

test('each card header controls its own body id', () => {
  seedSettings()
  const markup = renderSettings()
  for (const id of CARD_IDS) {
    const head = tagWithId(markup, 'button', 'tacit-card-' + id + '-head')
    assert.ok(head.includes('aria-controls="tacit-card-' + id + '-body"'), id + ' aria-controls')
    tagWithId(markup, 'div', 'tacit-card-' + id + '-body')
  }
  testKit.rootStore.profile = null
})

test('a collapsed card keeps its body in the DOM behind the hidden attribute', () => {
  const rootStore = seedSettings()
  rootStore.coached = [{ turn: 4, time: Date.now(), trigger: 'manual', promptExcerpt: 'a coached prompt excerpt' }]

  const collapsed = renderSettings()
  assert.ok(tagWithId(collapsed, 'div', 'tacit-card-history-body').includes('hidden'), 'history body is hidden by default')
  assert.ok(collapsed.includes('a coached prompt excerpt'), 'the body stays in the DOM while collapsed')

  testKit.toggleSection('history')
  const opened = renderSettings()
  assert.equal(tagWithId(opened, 'div', 'tacit-card-history-body').includes('hidden'), false, 'the opened body drops hidden')
  assert.ok(tagWithId(opened, 'button', 'tacit-card-history-head').includes('aria-expanded="true"'))
  assert.ok(opened.includes('a coached prompt excerpt'))

  testKit.toggleSection('history')
  assert.ok(tagWithId(renderSettings(), 'div', 'tacit-card-history-body').includes('hidden'), 'toggling back collapses it again')
  rootStore.coached = []
  rootStore.profile = null
})

test('a result notice renders above the cards in an always-present live region', () => {
  const rootStore = seedSettings()
  rootStore.notice = { text: 'Bootstrap complete · 7 analyzed · 3 skipped' }
  const markup = renderSettings()
  const match = /<div[^>]*role="status"[^>]*>([\s\S]*?)<\/div>/.exec(markup)
  assert.ok(match, 'a [role="status"] region renders')
  assert.ok(match[1].includes('7 analyzed'))
  assert.ok(match[1].includes('3 skipped'))
  // Outside every card body: a notice must be announced even with Overview collapsed.
  assert.ok(match.index < markup.indexOf('tacit-card-overview-head'), 'the notice sits above the first card')

  rootStore.notice = null
  const empty = renderSettings()
  const idle = /<div[^>]*role="status"[^>]*>([\s\S]*?)<\/div>/.exec(empty)
  // A live region mounted together with its text is missed by screen readers,
  // so the container is always in the DOM — empty while there is no notice.
  assert.ok(idle, 'the live region stays mounted with no notice')
  assert.equal(idle[1], '', 'and is empty')
  rootStore.profile = null
})

test('the stylesheet carries the narrow-viewport rules', () => {
  assert.match(String(testKit.css), /@media \(max-width:640px\)/)
  assert.match(String(testKit.css), /\.tacit-card-head\{[^}]*cursor:pointer/)
  assert.match(String(testKit.css), /\.tacit-card-head:focus-visible\{outline:2px solid var\(--dsw-alias-brand-primary\)\}/)
})

test('the bootstrap hint states the real eligibility rule, not the old guess', () => {
  const en = localeDicts['dsh-tacit'].en
  assert.doesNotMatch(en['bootstrap.hint'], /went fine on their own/)
  assert.match(en['bootstrap.hint'], /8 characters/)
  assert.equal(typeof en['bootstrap.estimateDoc'], 'string')
})

// ── Usage dashboard card ──────────────────────────────────────────────────

const EN = () => localeDicts['dsh-tacit'].en

/** The bound translator the bundle itself uses, so tests assert on real copy. */
function tr(key, vars) {
  const dict = EN()
  let text = dict[key] !== undefined ? dict[key] : key
  if (vars !== undefined) for (const k of Object.keys(vars)) text = text.split('{' + k + '}').join(String(vars[k]))
  return text
}

const emptyTokens = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 })

const period = (over) => ({
  attempts: 0,
  billedCalls: 0,
  unmeteredCalls: 0,
  unpricedCalls: 0,
  tokens: emptyTokens(),
  usdKnown: 0,
  avgAnalysisUsd: null,
  cachedInputRate: null,
  ...(over === undefined ? {} : over),
})

/** `n` zero-filled days ending 2026-08-30, with a single visible peak on the 14th. */
const seriesDays = (n) => Array.from({ length: n }, (_, index) => {
  const dayNumber = 30 - n + 1 + index
  const day = '2026-08-' + String(dayNumber).padStart(2, '0')
  const peak = day === '2026-08-14'
  return { day, usdKnown: peak ? 0.09 : 0.01, billedCalls: peak ? 9 : 1 }
})

const sampleRun = {
  runId: 'run-1',
  type: 'analysis',
  status: 'partial',
  attempts: 2,
  billedCalls: 2,
  unmeteredCalls: 0,
  unpricedCalls: 0,
  tokens: { inputTokens: 800, outputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 50 },
  usdKnown: 0.0004,
  trigger: 'auto',
  startedAt: 1756500000000,
  endedAt: 1756500002000,
  sessionId: 'session-ssr',
  turn: 7,
  workspace: 'dsh-tacit',
  model: 'deepseek-v4-flash',
  provider: 'deepseek-official',
  results: {},
}

/** The bundled list prices (USD per 1M), exactly as the service reports them. */
const bundledRates = () => ({
  'deepseek-v4-flash': {
    offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
    peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
  },
  'deepseek-v4-pro': {
    offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
    peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
  },
})

function usageEnvelope(over) {
  return {
    ok: true,
    trackingSince: 1785585600000,
    pricing: { source: 'bundled', asOf: '2026-08-22', refreshedAt: 0, tierNow: 'offPeak', error: '', rates: bundledRates(), label: 'Measured usage · list-price cost' },
    today: period({ attempts: 4, billedCalls: 4, usdKnown: 0.0196, cachedInputRate: 0.25 }),
    month: period({ attempts: 40, billedCalls: 38, unpricedCalls: 2, usdKnown: 0.3812 }),
    last7: period({ attempts: 12, billedCalls: 12, usdKnown: 0.1234 }),
    last30: period({
      attempts: 42,
      billedCalls: 40,
      unpricedCalls: 2,
      tokens: { inputTokens: 40000, outputTokens: 10000, cacheReadTokens: 4230, cacheWriteTokens: 0, reasoningTokens: 900 },
      usdKnown: 0.36,
      avgAnalysisUsd: 0.0196,
      cachedInputRate: 0.5,
    }),
    lifetime: period({ attempts: 90, billedCalls: 88, usdKnown: 0.94 }),
    byType: {
      improve: period({ attempts: 10, billedCalls: 10, tokens: { ...emptyTokens(), inputTokens: 1000 }, usdKnown: 0.05 }),
      analysis: period({
        attempts: 30,
        billedCalls: 30,
        tokens: { inputTokens: 40000, outputTokens: 10000, cacheReadTokens: 4230, cacheWriteTokens: 0, reasoningTokens: 900 },
        usdKnown: 0.3,
      }),
    },
    byModel: { 'deepseek-v4-flash': period({ billedCalls: 40, usdKnown: 0.36 }) },
    series7: seriesDays(7),
    series30: seriesDays(30),
    warnings: {
      daily: { limit: 1, spent: 0.9, level: 'warn' },
      monthly: { limit: 2, spent: 2.5, level: 'exceeded' },
    },
    runs: { items: [sampleRun], page: 1, pageSize: 20, total: 1 },
    ...(over === undefined ? {} : over),
  }
}

function seedUsage(over) {
  const rootStore = seedSettings()
  rootStore.usage = usageEnvelope(over)
  rootStore.usageFilters = { range: '30d', type: '', status: '', model: '', workspace: '', sessionId: '', page: 1, pageSize: 20 }
  rootStore.usageSeries = '30'
  rootStore.usageExpanded = new Set()
  rootStore.usageRuns = {}
  return rootStore
}

function resetUsage() {
  const rootStore = testKit.rootStore
  rootStore.usage = null
  rootStore.usageFilters = { range: '30d', type: '', status: '', model: '', workspace: '', sessionId: '', page: 1, pageSize: 20 }
  rootStore.usageSeries = '30'
  rootStore.usageExpanded = new Set()
  rootStore.usageRuns = {}
  rootStore.profile = null
}

test('the usage card shows spend tiles, stat tiles and the unpriced note', () => {
  seedUsage()
  const markup = renderSettings()
  assert.ok(markup.includes('$0.0196'), 'today tile uses four-decimal money')
  assert.ok(markup.includes('$0.3812'), 'this-month tile')
  assert.ok(markup.includes('$0.3600'), 'last-30-days tile')
  assert.ok(markup.includes('$0.9400'), 'lifetime tile')
  assert.ok(markup.includes('2026-08-01'), 'the lifetime tile is labelled with the tracking-since day')
  assert.ok(markup.includes('54,230'), 'token totals are grouped')
  assert.ok(markup.includes(tr('usage.unpricedShort', { n: 2 })), 'unpriced note rides the tiles that have one')
  assert.ok(markup.includes('50%'), 'cached-input rate is a percentage')
  assert.ok(markup.includes(EN()['usage.label']))
  assert.ok(!markup.includes('$0.00 '), 'no truncated two-decimal money')
  resetUsage()
})

test('the usage card falls back to an empty state before anything is metered', () => {
  const rootStore = seedSettings()
  rootStore.usage = null
  const before = renderSettings()
  assert.ok(before.includes(tr('usage.empty', { since: '—' })), 'null envelope renders the empty hint')

  rootStore.usage = usageEnvelope({ lifetime: period({}) })
  const zeroed = renderSettings()
  assert.ok(zeroed.includes(tr('usage.empty', { since: '2026-08-01' })), 'a zero-billed lifetime renders the empty hint')
  assert.equal(/class="tacit-usage-table"/.test(zeroed), false, 'no runs table in the empty state')
  resetUsage()
})

test('the spend sparkline is an accessible SVG with one titled bar per day', () => {
  seedUsage()
  const markup = renderSettings()
  assert.ok(markup.includes('role="img"'), 'the strip is an image role')
  assert.ok(markup.includes('aria-label="' + tr('usage.chartLabel', { n: 30 }) + '"'))
  assert.ok(markup.includes('viewBox="0 0 300 48"'))
  assert.equal((markup.match(/<rect/g) || []).length, 30, 'one rect per day')
  assert.equal((markup.match(/<title>/g) || []).length, 30, 'one title per rect')
  assert.ok(markup.includes('<title>' + tr('usage.barTitle', { day: '2026-08-14', usd: '$0.0900', calls: 9 }) + '</title>'))
  assert.ok(markup.includes(tr('usage.chartSummary', { n: 30, total: '$0.3800', day: '2026-08-14', max: '$0.0900' })), 'a visually hidden text equivalent')
  assert.ok(markup.includes('tacit-visually-hidden'))
  assert.ok(markup.includes('aria-pressed="true"'), 'the active series button is pressed')
  resetUsage()
})

test('the 7-day series toggle narrows the strip to seven bars', () => {
  const rootStore = seedUsage()
  rootStore.usageSeries = '7'
  const markup = renderSettings()
  assert.equal((markup.match(/<rect/g) || []).length, 7)
  assert.ok(markup.includes('viewBox="0 0 70 48"'))
  assert.ok(markup.includes(tr('usage.chartLabel', { n: 7 })))
  resetUsage()
})

test('the by-operation breakdown is ordered by spend, with share bars', () => {
  seedUsage()
  const markup = renderSettings()
  const analysisAt = markup.indexOf(EN()['runtype.analysis'])
  const improveAt = markup.indexOf(EN()['runtype.improve'])
  assert.ok(analysisAt > -1 && improveAt > -1, 'both operation rows render')
  assert.ok(analysisAt < improveAt, 'the costliest operation is listed first')
  assert.ok(markup.includes('tacit-usage-breakdown'))
  assert.ok(/class="tacit-share"[^>]*style="width:100%"/.test(markup), 'the top row fills its share bar')
  resetUsage()
})

test('budget warnings render as progress bars carrying their level', () => {
  seedUsage()
  const markup = renderSettings()
  assert.equal((markup.match(/role="progressbar"/g) || []).length, 2)
  assert.ok(markup.includes('tacit-warn-warn'), 'the daily bar is at the warn level')
  assert.ok(markup.includes('tacit-warn-exceeded'), 'the monthly bar is over its limit')
  assert.ok(markup.includes('aria-valuemin="0"'))
  assert.ok(markup.includes('aria-valuemax="1"'))
  assert.ok(markup.includes('aria-valuenow="0.9"'), 'a bar under its cap reports the real figure')
  assert.ok(markup.includes('aria-valuetext="$0.9000"'))
  assert.ok(markup.includes(tr('warn.daily', { spent: '$0.9000', limit: '$1.0000', pct: 90 })))
  // $2.50 against a $2 cap: valuenow may never exceed valuemax, so it pins at the
  // cap and the overspend is carried by valuetext (and by the label) instead.
  assert.ok(markup.includes('aria-valuemax="2"'))
  assert.ok(markup.includes('aria-valuenow="2"'), 'an exceeded budget clamps to its maximum')
  assert.equal(markup.includes('aria-valuenow="2.5"'), false, 'never a valuenow past valuemax')
  assert.ok(markup.includes('aria-valuetext="$2.5000"'), 'the true overspend stays announced')
  assert.ok(markup.includes(tr('warn.monthly', { spent: '$2.5000', limit: '$2.0000', pct: 125 })))

  testKit.rootStore.usage = usageEnvelope({ warnings: { daily: { limit: 0, spent: 0.9, level: 'none' }, monthly: { limit: 0, spent: 2.5, level: 'none' } } })
  assert.equal(/role="progressbar"/.test(renderSettings()), false, 'no bar without a configured limit')
  resetUsage()
})

test('the usage filters render the six controls with the active values selected', () => {
  const rootStore = seedUsage()
  rootStore.usageFilters = { range: '7d', type: 'analysis', status: 'failed', model: 'deepseek-v4-flash', workspace: 'dsh-tacit', sessionId: 'session-ssr', page: 1, pageSize: 20 }
  const markup = renderSettings()
  assert.ok(markup.includes('<option value="7d" selected=""'), 'range keeps its value')
  assert.ok(markup.includes('<option value="analysis" selected=""'), 'type keeps its value')
  assert.ok(markup.includes('<option value="failed" selected=""'), 'status keeps its value')
  assert.ok(markup.includes('<option value="deepseek-v4-flash" selected=""'), 'model comes from byModel')
  assert.ok(markup.includes('value="dsh-tacit"'), 'workspace input is filled')
  assert.ok(markup.includes('value="session-ssr"'), 'session input is filled')
  assert.ok(markup.includes(EN()['filter.all']))
  resetUsage()
})

test('the runs table is a role=table with an expandable first cell and a pager', () => {
  const rootStore = seedUsage()
  rootStore.usage.runs = { items: [sampleRun], page: 2, pageSize: 20, total: 45 }
  const markup = renderSettings()
  assert.ok(markup.includes('role="table"'))
  assert.equal((markup.match(/class="tacit-usage-cell" role="columnheader"/g) || []).length, 8, 'eight column headers')
  assert.ok(markup.includes(EN()['usage.col.time']))
  assert.ok(markup.includes(EN()['usage.col.cost']))
  assert.ok(markup.includes('aria-controls="tacit-run-run-1"'), 'the toggle points at its detail row')
  assert.ok(markup.includes('aria-expanded="false"'))
  assert.ok(markup.includes('tacit-status-partial'), 'the status chip carries the run status')
  assert.ok(markup.includes('dsh-tacit · #7'), 'scope is workspace · turn')
  assert.ok(markup.includes(tr('usage.page', { page: 2, pages: 3 })))
  resetUsage()
})

test('a run still in flight is labelled, not left as a raw status key', () => {
  const rootStore = seedUsage()
  const live = { ...sampleRun, runId: 'run-live', status: 'running', endedAt: 0 }
  rootStore.usage.runs = { items: [live, sampleRun], page: 1, pageSize: 20, total: 2 }
  const markup = renderSettings()
  assert.ok(markup.includes('tacit-status-running'), 'the chip carries the running status')
  assert.ok(markup.includes(EN()['status.running']), 'and its translated label')
  assert.ok(!markup.includes('status.running'), 'never the bare dictionary key')
  resetUsage()
})

test('an expanded run lists its attempts; a not-yet-fetched run says so', () => {
  const rootStore = seedUsage()
  rootStore.usageExpanded = new Set(['run-1'])
  const pending = renderSettings()
  assert.ok(pending.includes('id="tacit-run-run-1"'))
  assert.ok(pending.includes('aria-expanded="true"'))
  assert.ok(pending.includes(EN()['usage.loading']), 'a missing run detail renders the loading line')

  rootStore.usageRuns = {
    'run-1': {
      ...sampleRun,
      attempts: [
        {
          id: 'a1',
          op: 'analysis',
          startedAt: 1756500000000,
          durationMs: 1234,
          model: 'deepseek-v4-flash',
          provider: 'deepseek-official',
          reasoningEffort: 'medium',
          finish: 'stop',
          status: 'ok',
          code: '',
          sessionId: 'session-ssr',
          turn: 7,
          usage: { inputTokens: 800, outputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0, reasoningTokens: 50 },
          priced: { source: 'bundled', tier: 'off-peak', rates: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 }, asOf: '2026-08-22', usd: 0.000308 },
        },
        {
          id: 'a2',
          op: 'analysis-repair',
          startedAt: 1756500001000,
          durationMs: 90,
          model: 'deepseek-v4-flash',
          provider: 'deepseek-official',
          reasoningEffort: null,
          finish: 'error',
          status: 'failed',
          code: 'rate-limited',
          sessionId: 'session-ssr',
          turn: 7,
          usage: null,
          priced: null,
        },
      ],
    },
  }
  const markup = renderSettings()
  assert.ok(markup.includes(EN()['op.analysis']))
  assert.ok(markup.includes(EN()['op.analysis-repair']))
  assert.ok(markup.includes(tr('attempt.source', { source: 'bundled', tier: 'off-peak' })))
  assert.ok(markup.includes(tr('attempt.duration', { ms: '1,234' })))
  assert.ok(markup.includes(tr('attempt.effort', { effort: 'medium' })))
  assert.ok(markup.includes('rate-limited'), 'the failure code is shown')
  assert.ok(markup.includes('$0.0003'), 'the priced attempt shows its cost')
  assert.ok(markup.includes(EN()['usage.priceUnavailable']), 'the unmetered attempt never shows $0.00')
  assert.ok(markup.includes('800'), 'the token buckets are listed')
  assert.ok(!markup.includes(EN()['usage.loading']), 'the loading line is gone once the run is present')
  resetUsage()
})

test('usage polling is reference-counted and never holds a runner open', () => {
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  let started = 0
  let cleared = 0
  try {
    globalThis.setInterval = () => {
      started += 1
      return { handle: started }
    }
    globalThis.clearInterval = () => {
      cleared += 1
    }
    testKit.startUsagePolling()
    testKit.startUsagePolling()
    assert.equal(started, 1, 'the second mount reuses the running timer')
    testKit.stopUsagePolling()
    assert.equal(cleared, 0, 'one unmount leaves the timer running')
    testKit.stopUsagePolling()
    assert.equal(cleared, 1, 'the last unmount clears it')
    testKit.startUsagePolling()
    assert.equal(started, 2, 'a later mount starts a fresh timer')
    testKit.stopUsagePolling()
    assert.equal(cleared, 2)
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
})

test('the usage filter action resets paging and drops empty values', () => {
  const rootStore = testKit.rootStore
  rootStore.usageFilters = { range: '30d', type: '', status: '', model: '', workspace: '', sessionId: '', page: 4, pageSize: 20 }
  testKit.setUsageFilter({ type: 'improve' })
  assert.equal(rootStore.usageFilters.type, 'improve')
  assert.equal(rootStore.usageFilters.page, 1, 'a new filter goes back to page one')
  testKit.setUsageFilter({ page: 3 })
  assert.equal(rootStore.usageFilters.page, 3, 'an explicit page is kept')
  testKit.setUsageSeries('7')
  assert.equal(rootStore.usageSeries, '7')
  testKit.setUsageSeries('nonsense')
  assert.equal(rootStore.usageSeries, '30', 'an unknown series falls back to 30 days')
  resetUsage()
})

/** Every element in a `h()` tree matching `predicate`, depth first. */
function collectElements(node, predicate, found) {
  const hits = found === undefined ? [] : found
  if (node === null || node === undefined || typeof node !== 'object') return hits
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, hits)
    return hits
  }
  if (node.props === undefined) return hits
  if (predicate(node)) hits.push(node)
  return collectElements(node.props.children, predicate, hits)
}

test('the free-text filters patch the store keys the server actually reads', () => {
  const rootStore = seedUsage()
  const patches = []
  // UsageCard is hook-free by design, so the suite can call it directly and
  // fire the handlers that renderToStaticMarkup throws away.
  const kit = { t: tr, fmt: (n) => String(n), fmtTime: () => '00:00:00' }
  const tree = testKit.UsageCard(kit, {
    usage: rootStore.usage,
    config: rootStore.config,
    filters: { ...rootStore.usageFilters, workspace: 'dsh-tacit', sessionId: 'session-ssr' },
    series: '30',
    expanded: new Set(),
    runs: {},
    onFilter: (patch) => patches.push(patch),
    onToggleRun: () => {},
    onSeries: () => {},
  })
  const inputs = collectElements(tree, (node) => node.type === 'input' && node.props.type === 'text')
  assert.equal(inputs.length, 2, 'a workspace and a session-id input')
  assert.equal(inputs[0].props.defaultValue, 'dsh-tacit')
  assert.equal(inputs[1].props.defaultValue, 'session-ssr', 'the session input round-trips the store value')

  inputs[1].props.onKeyDown({ key: 'Enter', target: { value: '  sess-42  ' } })
  assert.deepEqual(patches, [{ sessionId: 'sess-42' }], 'Enter patches sessionId, not a stray `session`')
  inputs[0].props.onBlur({ target: { value: 'alpha' } })
  assert.deepEqual(patches[1], { workspace: 'alpha' }, 'blur patches workspace')
  inputs[1].props.onBlur({ target: { value: 'session-ssr' } })
  assert.equal(patches.length, 2, 'an unchanged field fires nothing on blur')

  // …and that patch lands on the field `usageQuery` forwards to /usage.
  testKit.setUsageFilter({ sessionId: 'sess-42' })
  assert.equal(rootStore.usageFilters.sessionId, 'sess-42')
  assert.equal(rootStore.usageFilters.session, undefined, 'no stray key beside it')
  assert.equal(rootStore.usageFilters.page, 1, 'and paging restarts')
  resetUsage()
})

// ── Pricing card ──────────────────────────────────────────────────────────

const pricingBlock = (over) => ({
  source: 'bundled',
  asOf: '2026-08-22',
  refreshedAt: 0,
  tierNow: 'offPeak',
  error: '',
  rates: bundledRates(),
  label: 'Measured usage · list-price cost',
  ...(over === undefined ? {} : over),
})

function seedPricing(over, open) {
  const rootStore = seedUsage({ pricing: pricingBlock(over) })
  rootStore.sections.pricing = open === true
  rootStore.pricingRefreshing = false
  return rootStore
}

function resetPricing() {
  testKit.rootStore.sections.pricing = false
  testKit.rootStore.pricingRefreshing = false
  resetUsage()
}

const cardSummary = (markup) => {
  const match = /<span class="tacit-card-summary">([\s\S]*?)<\/span>/.exec(markup)
  assert.ok(match, 'a card summary renders')
  return match[1]
}

test('the collapsed pricing card summarises the flash rates in its header', () => {
  seedPricing(undefined, false)
  const markup = renderSettings()
  const summary = cardSummary(markup)
  assert.ok(summary.includes('flash'), 'the headline model — got ' + summary)
  assert.ok(summary.includes(EN()['pricing.offPeak']), 'at the tier in force right now')
  assert.ok(summary.includes('$0.007 / $0.22 / $0.66'), 'trimmed per-1M rates — got ' + summary)
  assert.ok(summary.includes('per 1M'))
  assert.ok(summary.includes(EN()['pricing.sourceBundled']))
  assert.ok(summary.includes('2026-08-22'), 'and the as-of day')
  const body = /<div class="tacit-card-body"[^>]*id="tacit-card-pricing-body"([^>]*)>/.exec(markup)
  assert.ok(body, 'the pricing body renders')
  assert.ok(body[1].includes('hidden'), 'a collapsed card hides its body instead of unmounting it')
  assert.ok(markup.includes('$3.96'), 'so find-in-page still reaches the rate table')
  resetPricing()
})

test('the expanded pricing card tables both models at both tiers', () => {
  seedPricing(undefined, true)
  const markup = renderSettings()
  assert.ok(markup.includes('deepseek-v4-flash'))
  assert.ok(markup.includes('deepseek-v4-pro'))
  for (const rate of ['$0.007', '$0.22', '$0.66', '$0.014', '$0.44', '$1.32', '$0.022', '$1.98', '$0.044', '$3.96']) {
    assert.ok(markup.includes(rate), 'rate cell ' + rate)
  }
  assert.ok(!markup.includes('$0.2200'), 'rate cells trim to at most three decimals')
  for (const key of ['pricing.rateTable', 'pricing.model', 'pricing.tier', 'pricing.cacheHit', 'pricing.cacheMiss', 'pricing.output', 'pricing.reasoning']) {
    assert.ok(markup.includes(escapeHtml(EN()[key])), key + ' renders')
  }
  const reasoning = markup.split(EN()['pricing.reasoningSameAsOutput']).length - 1
  assert.equal(reasoning, 4, 'the reasoning column is prose on all four rows, never a number')

  // The table is named by the heading above it, not by a duplicate aria-label.
  const table = /<div class="tacit-pricing-table"[^>]*>/.exec(markup)
  assert.ok(table, 'the rate table renders')
  assert.ok(table[0].includes('aria-labelledby="tacit-pricing-title"'), 'named by its heading — got ' + table[0])
  assert.equal(table[0].includes('aria-label='), false, 'and not by a duplicate label')
  assert.ok(markup.includes('id="tacit-pricing-title"'))

  // A rate the source did not quote is an em dash, never $0.
  seedPricing({ rates: { 'deepseek-v4-flash': { offPeak: { cacheHit: null, cacheMiss: '0.22', output: 0.66 }, peak: {} } } }, true)
  const partial = renderSettings()
  assert.ok(partial.includes('$0.66'), 'the quoted rate still renders')
  assert.equal(partial.includes('$0<'), false, 'a null rate never becomes $0')
  assert.equal(partial.includes('$0.22'), false, 'and a stringly-typed rate is not trusted either')
  assert.ok(partial.includes('—'), 'unquoted rates render as em dashes')
  resetPricing()
})

test('the expanded pricing card states the schedule, the weekend rule and the source', () => {
  seedPricing(undefined, true)
  const bundled = renderSettings()
  assert.ok(bundled.includes(escapeHtml(EN()['pricing.schedule'])))
  assert.ok(EN()['pricing.schedule'].includes('UTC'), 'the windows are stated in UTC')
  assert.ok(/01:00/.test(EN()['pricing.schedule']) && /06:00/.test(EN()['pricing.schedule']), 'both peak windows')
  assert.ok(bundled.includes(escapeHtml(EN()['pricing.weekendRule'])))
  assert.ok(/UTC\+8|Beijing/.test(EN()['pricing.weekendRule']), 'the weekend rule names the Beijing calendar')
  assert.ok(bundled.includes(tr('pricing.tierNow', { tier: EN()['pricing.offPeak'] })))
  assert.ok(bundled.includes(escapeHtml(EN()['pricing.formula'])))
  assert.ok(bundled.includes(escapeHtml(EN()['pricing.accuracy'])))
  assert.equal(EN()['pricing.accuracy'], 'List price; your provider invoice is the billing authority')
  assert.ok(bundled.includes(EN()['pricing.sourceBundled']))
  assert.ok(!bundled.includes(EN()['pricing.sourceCostMeter']))
  assert.ok(bundled.includes(EN()['pricing.never']), 'a never-refreshed source says so')

  seedPricing({ source: 'costMeter', refreshedAt: 1756500000000 }, true)
  const metered = renderSettings()
  assert.ok(metered.includes(EN()['pricing.sourceCostMeter']))
  assert.ok(!metered.includes(EN()['pricing.sourceBundled']))
  assert.ok(!metered.includes(EN()['pricing.never']), 'a refreshed source shows when')

  seedPricing({ error: 'the costMeter service is not available' }, true)
  const failed = renderSettings()
  assert.ok(failed.includes(tr('pricing.error', { error: 'the costMeter service is not available' })))
  resetPricing()
})

test('the pricing refresh button is disabled while a refresh is in flight', () => {
  const rootStore = seedPricing(undefined, true)
  const idle = renderSettings()
  const button = (markup) => {
    const match = /<button[^>]*class="[^"]*tacit-pricing-refresh[^"]*"[^>]*>([\s\S]*?)<\/button>/.exec(markup)
    assert.ok(match, 'the refresh button renders')
    return match
  }
  assert.equal(button(idle)[1], EN()['pricing.refresh'])
  assert.equal(button(idle)[0].includes('disabled'), false, 'enabled while idle')

  rootStore.pricingRefreshing = true
  const busy = button(renderSettings())
  assert.equal(busy[1], EN()['pricing.refreshing'])
  assert.ok(busy[0].includes('disabled'), 'and disabled while the refresh is in flight')
  resetPricing()
})

test('a result notice carries the measured figures of its run', () => {
  const run = {
    runId: 'run-9',
    billedCalls: 9,
    unmeteredCalls: 0,
    unpricedCalls: 0,
    tokens: { inputTokens: 40000, outputTokens: 10000, cacheReadTokens: 4230, cacheWriteTokens: 0, reasoningTokens: 900 },
    usdKnown: 0.0196,
  }
  const text = testKit.runNotice(tr, 'notice.bootstrap', { analyzed: 7, skipped: 3 }, run)
  assert.equal(text, tr('notice.bootstrap', { analyzed: 7, skipped: 3, calls: '9', tokens: '54,230', usd: '$0.0196' }))
  assert.ok(text.includes('7 analyzed') && text.includes('3 skipped'), 'the counts stay — got ' + text)
  assert.ok(text.includes('54,230'), 'grouped token total')
  assert.ok(text.includes('$0.0196'), 'four-decimal list price')
  assert.ok(!text.includes('unpriced'), 'no suffix when everything was priced')

  const some = testKit.runNotice(tr, 'notice.bootstrap', { analyzed: 7, skipped: 3 }, { ...run, unpricedCalls: 2 })
  assert.ok(some.endsWith(tr('notice.unpriced', { n: 2 })), 'the unpriced count rides as a suffix — got ' + some)

  const none = testKit.runNotice(tr, 'notice.analyze', { turn: 7 }, { ...run, unpricedCalls: 9, usdKnown: 0 })
  assert.ok(none.includes(EN()['usage.priceUnavailable']), 'an entirely unpriced run says so')
  assert.ok(!none.includes('$0.00'), 'and never claims it was free')

  const unmetered = testKit.runNotice(tr, 'notice.analyze', { turn: 7 }, { ...run, attempts: 3, billedCalls: 0, unmeteredCalls: 3, unpricedCalls: 0, usdKnown: 0 })
  assert.ok(unmetered.includes(EN()['usage.priceUnavailable']), 'a run whose every call went unmetered says so')
  assert.ok(!unmetered.includes('$0.00'), 'and never prints $0.0000 for it')

  const idle = testKit.runNotice(tr, 'notice.analyze', { turn: 7 }, { ...run, attempts: 0, billedCalls: 0, unmeteredCalls: 0, unpricedCalls: 0, usdKnown: 0 })
  assert.ok(idle.includes('$0.0000'), 'a genuinely idle run stays honestly zero — got ' + idle)

  const rootStore = seedSettings()
  rootStore.notice = { text }
  assert.ok(renderSettings().includes('54,230'), 'the notice renders with its figures')
  rootStore.notice = null
  rootStore.profile = null
})

test('the bootstrap button shows the running list-price cost, and only an honest one', () => {
  const rootStore = seedSettings()
  const label = () => {
    const match = /<span class="tacit-bootstrap"><button[^>]*>([\s\S]*?)<\/button>/.exec(renderSettings())
    assert.ok(match, 'the bootstrap button renders')
    return match[1]
  }

  // The service ships usdKnown: 0 from the first tick, so "nothing billed yet"
  // is what gates the money — not the presence of the field.
  rootStore.bootstrap = { running: true, done: 3, total: 20, billedCalls: 0, unpricedCalls: 0, usdKnown: 0, tokens: 0 }
  assert.equal(label(), tr('bootstrap.running', { done: 3, total: 20 }), 'no billed call yet: no money in the label')

  rootStore.bootstrap = { running: true, done: 8, total: 20, billedCalls: 4, unpricedCalls: 4, usdKnown: 0, tokens: 5000 }
  assert.equal(label(), tr('bootstrap.runningUsd', { done: 8, total: 20, usd: EN()['usage.priceUnavailable'] }), 'an all-unpriced batch says so')
  assert.equal(label().includes('$0.0000'), false, 'and never claims the batch was free')

  rootStore.bootstrap = { running: true, done: 9, total: 20, billedCalls: 4, unpricedCalls: 0, usdKnown: 0.0196, tokens: 5000 }
  assert.equal(label(), tr('bootstrap.runningUsd', { done: 9, total: 20, usd: '$0.0196' }))

  rootStore.bootstrap = null
  assert.equal(label(), EN()['bootstrap.btn'])
  rootStore.profile = null
})

test('the conversation tab renders its store notice in an always-mounted live region', () => {
  const Tab = slotEntries.find((e) => e.name === 'conversation.view').registration.component
  const region = () => {
    const match = /<div[^>]*role="status"[^>]*>([\s\S]*?)<\/div>/.exec(renderToStaticMarkup(React.createElement(Tab, tabProps)))
    assert.ok(match, 'the tab keeps a [role="status"] region mounted')
    return match[1]
  }
  assert.equal(region(), '', 'empty while there is nothing to report')

  store.notice = { code: 'notice.analyze', text: 'Analyzed #7 · 2 call(s) · 54,230 tokens · $0.0196' }
  const announced = region()
  assert.ok(announced.includes('Analyzed #7'))
  assert.ok(announced.includes('54,230'))
  assert.ok(announced.includes('$0.0196'))

  // The Settings-panel clear path stores a code and a count, with no text.
  store.notice = { code: 'settings.cleared', n: 3 }
  assert.equal(region(), '', 'a text-less notice renders nothing — and throws nothing')
  store.notice = null
})

test('every pricing and notice dictionary key exists in both dictionaries', () => {
  const dicts = localeDicts['dsh-tacit']
  const keys = [
    'pricing.summary', 'pricing.rateTable', 'pricing.model', 'pricing.tier',
    'pricing.cacheHit', 'pricing.cacheMiss', 'pricing.output', 'pricing.reasoning', 'pricing.reasoningSameAsOutput',
    'pricing.peak', 'pricing.offPeak', 'pricing.tierNow', 'pricing.schedule', 'pricing.weekendRule',
    'pricing.source', 'pricing.sourceBundled', 'pricing.sourceCostMeter', 'pricing.refreshedAt', 'pricing.never',
    'pricing.formula', 'pricing.accuracy', 'pricing.refresh', 'pricing.refreshing', 'pricing.error',
    'notice.bootstrap', 'notice.analyze', 'notice.improve', 'notice.pricingRefreshed', 'notice.unpriced',
    'bootstrap.running', 'bootstrap.runningUsd',
  ]
  for (const key of keys) {
    assert.equal(typeof dicts.en[key], 'string', 'en ' + key)
    assert.equal(typeof dicts.zh[key], 'string', 'zh ' + key)
  }
  assert.equal(Object.keys(dicts.en).length, Object.keys(dicts.zh).length, 'the two dictionaries stay the same size')
})

test('the stylesheet carries the usage dashboard rules', () => {
  const sheet = String(testKit.css)
  assert.match(sheet, /\.tacit-pricing-row\{display:grid;grid-template-columns:/)
  assert.match(sheet, /\.tacit-tiles\{display:flex;flex-wrap:wrap;gap:8px\}/)
  assert.match(sheet, /\.tacit-tile\{flex:1 1 140px/)
  assert.match(sheet, /\.tacit-bars\{width:100%;height:48px\}/)
  assert.match(sheet, /\.tacit-visually-hidden\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\);white-space:nowrap\}/)
  assert.match(sheet, /\.tacit-usage-row\{display:grid;grid-template-columns:/)
  assert.match(sheet, /\.tacit-status-running\{[^}]*var\(--dsw-/)
  assert.match(sheet, /\.tacit-warn-warn\{[^}]*--dsw-alias-state-warn-primary/)
  assert.match(sheet, /\.tacit-warn-exceeded\{[^}]*--dsw-alias-state-error-primary/)
  assert.match(sheet, /@media \(max-width:640px\)\{[\s\S]*?\.tacit-usage-row\{display:flex;flex-direction:column\}/)
  assert.match(sheet, /@media \(max-width:640px\)\{[\s\S]*\.tacit-tile\{flex-basis:45%\}/)
  assert.doesNotMatch(sheet, /tacit-progress-fill/)
})

test('every usage dictionary key exists in both dictionaries', () => {
  const dicts = localeDicts['dsh-tacit']
  const keys = [
    'usage.empty', 'usage.today', 'usage.month', 'usage.last30', 'usage.since', 'usage.calls',
    'usage.avgAnalysis', 'usage.cachedRate', 'usage.unpriced', 'usage.unpricedShort', 'usage.priceUnavailable',
    'usage.chartLabel', 'usage.chartSummary', 'usage.barTitle', 'usage.series7', 'usage.series30', 'usage.breakdown',
    'usage.filters', 'usage.loading', 'usage.page', 'usage.prev', 'usage.next', 'usage.label',
    'usage.col.time', 'usage.col.op', 'usage.col.scope', 'usage.col.model', 'usage.col.status',
    'usage.col.calls', 'usage.col.tokens', 'usage.col.cost',
    'filter.range', 'filter.type', 'filter.status', 'filter.model', 'filter.workspace', 'filter.session', 'filter.all',
    'range.today', 'range.7d', 'range.30d', 'range.month', 'range.all',
    'status.success', 'status.partial', 'status.failed', 'status.ok', 'status.unmetered',
    'attempt.effort', 'attempt.finish', 'attempt.source', 'attempt.duration',
    'warn.daily', 'warn.monthly',
  ]
  for (const type of ['bootstrap', 'analysis', 'analysis-batch', 'improve', 'directive-distillation', 'style-distillation', 'prompt-enrichment']) keys.push('runtype.' + type)
  for (const op of ['analysis', 'analysis-repair', 'directive-distillation', 'style-distillation', 'improve', 'improve-repair', 'enrichment']) keys.push('op.' + op)
  for (const key of keys) {
    assert.equal(typeof dicts.en[key], 'string', 'en ' + key)
    assert.equal(typeof dicts.zh[key], 'string', 'zh ' + key)
  }
  assert.equal(dicts.en['usage.label'], 'Measured usage · list-price cost')
})

// ── Confirm dialog, bootstrap preview and the Data & Privacy card ─────────

function seedPrivacy(over) {
  const rootStore = seedSettings()
  rootStore.config = {
    ...rootStore.config,
    costHistoryDays: 90,
    costWarnDailyUsd: 1.5,
    costWarnMonthlyUsd: 0,
    ...(over === undefined ? {} : over),
  }
  rootStore.sections.privacy = true
  return rootStore
}

function resetPrivacy() {
  const rootStore = testKit.rootStore
  rootStore.sections.privacy = false
  rootStore.confirm = null
  rootStore.preview = null
  rootStore.config = null
  rootStore.profile = null
}

test('the Data & Privacy card states exactly what a usage record holds', () => {
  try {
    seedPrivacy()
    const markup = renderSettings()
    const stored = EN()['privacy.stored']
    assert.ok(markup.includes(escapeHtml(stored)), 'the stored-data paragraph renders')
    for (const field of ['session id', 'turn number', 'workspace', 'model', 'provider', 'token counts', 'list price']) {
      assert.ok(stored.includes(field), 'privacy.stored names the ' + field)
    }
    assert.match(stored, /never your prompt/i, 'and states prompt/response text is never stored')
  } finally {
    resetPrivacy()
  }
})

test('the retention select is bound to the configured costHistoryDays', () => {
  try {
    seedPrivacy()
    const markup = renderSettings()
    assert.ok(markup.includes(escapeHtml(EN()['privacy.retention'])), 'the retention row is labelled')
    for (const days of [7, 14, 30, 90, 180, 365]) {
      assert.ok(new RegExp('<option[^>]*value="' + days + '"').test(markup), 'option ' + days + ' renders')
    }
    assert.match(markup, /<option[^>]*value="90"[^>]*selected=""/, 'the configured 90 days is the selected option')
    assert.equal(/<option[^>]*value="30"[^>]*selected=""/.test(markup), false, 'and nothing else is')
  } finally {
    resetPrivacy()
  }
})

test('the two USD threshold rows carry the configured amounts and the 80 % hint', () => {
  try {
    seedPrivacy()
    const markup = renderSettings()
    assert.ok(markup.includes(escapeHtml(EN()['privacy.warnDaily'])), 'the daily row is labelled')
    assert.ok(markup.includes(escapeHtml(EN()['privacy.warnMonthly'])), 'the monthly row is labelled')
    assert.ok(markup.includes('value="1.5"'), 'the daily threshold shows its configured amount')
    assert.ok(markup.includes('value="0"'), 'and a zero (off) threshold shows as 0')
    assert.ok(markup.includes(escapeHtml(EN()['privacy.warnHint'])), 'the hint renders')
    assert.match(EN()['privacy.warnHint'], /80\s?%/, 'the hint states the 80 % warn point')
    assert.match(EN()['privacy.warnHint'], /\b0\b/, 'and that 0 turns the warning off')
    const applies = markup.split(EN()['privacy.apply']).length - 1
    assert.ok(applies >= 2, 'both threshold rows have their own Apply button — got ' + applies)
    // Two buttons reading "Apply" in one card need accessible names that say
    // which threshold each one applies.
    for (const key of ['privacy.warnDaily', 'privacy.warnMonthly']) {
      const label = escapeHtml(EN()['privacy.apply'] + ': ' + EN()[key])
      assert.ok(new RegExp('<button[^>]*aria-label="' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(markup),
        'the Apply button for ' + key + ' names its threshold')
    }
  } finally {
    resetPrivacy()
  }
})

test('the Data & Privacy card offers both destructive actions', () => {
  try {
    seedPrivacy()
    const markup = renderSettings()
    assert.ok(markup.includes(escapeHtml(EN()['settings.clear'])), 'clear reports')
    assert.ok(markup.includes(escapeHtml(EN()['privacy.clearUsage'])), 'clear usage history')
  } finally {
    resetPrivacy()
  }
})

test('the confirm dialog renders only while a confirm is pending, and is a labelled modal', () => {
  try {
    const rootStore = seedPrivacy()
    assert.equal(/role="dialog"/.test(renderSettings()), false, 'no dialog while nothing is pending')

    rootStore.confirm = { kind: 'reports' }
    const markup = renderSettings()
    const dialog = /<div[^>]*role="dialog"[^>]*>/.exec(markup)
    assert.ok(dialog, 'the dialog renders')
    assert.ok(dialog[0].includes('aria-modal="true"'), 'it is modal — got ' + dialog[0])
    assert.ok(dialog[0].includes('aria-labelledby="tacit-confirm-title"'), 'named by its own heading')
    assert.ok(/<h3[^>]*id="tacit-confirm-title"[^>]*>/.test(markup), 'the heading carries that id')
    assert.ok(markup.includes('tacit-modal-backdrop'), 'behind a backdrop')
    assert.ok(markup.includes(escapeHtml(EN()['confirm.reportsTitle'])))
    assert.ok(markup.includes(escapeHtml(EN()['confirm.reportsBody'])))

    // Cancel comes first so the safe action is the one focus and Tab reach first.
    const cancelAt = markup.indexOf(EN()['confirm.cancel'])
    const clearAt = markup.indexOf('tacit-btn-danger')
    assert.ok(cancelAt > -1 && clearAt > -1 && cancelAt < clearAt, 'Cancel precedes the destructive button')
    assert.ok(/<button[^>]*tacit-btn-danger[^>]*>/.test(markup), 'the destructive button is styled as such')
    assert.ok(markup.includes(escapeHtml(EN()['confirm.clear'])))

    rootStore.confirm = { kind: 'usage' }
    const usage = renderSettings()
    assert.ok(usage.includes(escapeHtml(EN()['confirm.usageTitle'])))
    assert.ok(usage.includes(escapeHtml(EN()['confirm.usageBody'])))
    assert.equal(usage.includes(escapeHtml(EN()['confirm.reportsTitle'])), false, 'one dialog at a time')
  } finally {
    resetPrivacy()
  }
})

test('openConfirm and closeConfirm are the only way the dialog opens', () => {
  try {
    const rootStore = seedPrivacy()
    testKit.openConfirm('usage')
    assert.deepEqual(rootStore.confirm, { kind: 'usage' })
    testKit.openConfirm('reports')
    assert.deepEqual(rootStore.confirm, { kind: 'reports' })
    testKit.openConfirm('nonsense')
    assert.deepEqual(rootStore.confirm, { kind: 'reports' }, 'an unknown kind is ignored')
    testKit.closeConfirm()
    assert.equal(rootStore.confirm, null)
  } finally {
    resetPrivacy()
  }
})

test('the overview preview line prices the eligible turns and names its basis', () => {
  try {
    const rootStore = seedSettings()
    rootStore.preview = null
    assert.ok(renderSettings().includes(escapeHtml(EN()['bootstrap.estimateDoc'])), 'the documented line stands in until a preview lands')

    rootStore.preview = {
      ok: true,
      eligible: 12,
      skipped: 3,
      limit: 20,
      model: 'deepseek-v4-flash',
      estimate: { usd: 0.0312, basis: 'measured', samples: 9, perAnalysisUsd: 0.0026 },
    }
    const measured = renderSettings()
    assert.ok(measured.includes(tr('bootstrap.preview', { eligible: 12, usd: '$0.0312' })), 'the measured line renders — got ' + measured.slice(0, 0))
    assert.ok(measured.includes(escapeHtml(tr('bootstrap.previewMeasured', { samples: 9 }))), 'and says it is measured')
    assert.equal(measured.includes(escapeHtml(EN()['bootstrap.previewDoc'])), false)
    assert.equal(measured.includes(escapeHtml(EN()['bootstrap.estimateDoc'])), false, 'the standing-in line steps aside')

    rootStore.preview = { ...rootStore.preview, estimate: { usd: 0.03, basis: 'doc', samples: 0, perAnalysisUsd: 0.0025 } }
    const doc = renderSettings()
    assert.ok(doc.includes(escapeHtml(EN()['bootstrap.previewDoc'])), 'the doc-basis line says so')
    assert.equal(doc.includes(escapeHtml(tr('bootstrap.previewMeasured', { samples: 0 }))), false)

    // An estimate the host could not price must never read as a free run.
    rootStore.preview = { ...rootStore.preview, estimate: { usd: null, basis: 'doc', samples: 0, perAnalysisUsd: null } }
    const unpriced = renderSettings()
    assert.ok(unpriced.includes(tr('bootstrap.preview', { eligible: 12, usd: EN()['usage.priceUnavailable'] })), 'an unpriceable estimate says so')
    assert.equal(unpriced.includes('$0.0000'), false, 'and never claims the run is free')

    rootStore.preview = { ...rootStore.preview, estimate: { usd: 0.03, basis: 'doc', samples: 0, perAnalysisUsd: 0.0025 } }
    const button = (markup) => {
      const match = /<span class="tacit-bootstrap"><button([^>]*)>/.exec(markup)
      assert.ok(match, 'the bootstrap button renders')
      return match[1]
    }
    assert.equal(button(doc).includes('disabled'), false, 'enabled while there is something to learn from')
    rootStore.preview = { ...rootStore.preview, eligible: 0 }
    assert.ok(button(renderSettings()).includes('disabled'), 'and disabled once nothing is eligible')

    rootStore.preview = null
    assert.equal(button(renderSettings()).includes('disabled'), false, 'never disabled before a preview has loaded')
  } finally {
    resetPrivacy()
  }
})

test('a batch notice carries the analyzed/requested counts and the run figures', () => {
  const run = {
    runId: 'run-batch',
    billedCalls: 4,
    unmeteredCalls: 0,
    unpricedCalls: 0,
    tokens: { inputTokens: 20000, outputTokens: 6000, cacheReadTokens: 1230, cacheWriteTokens: 0, reasoningTokens: 400 },
    usdKnown: 0.0088,
  }
  const text = testKit.runNotice(tr, 'notice.batch', { analyzed: 4, requested: 5 }, run)
  assert.equal(text, tr('notice.batch', { analyzed: 4, requested: 5, calls: '4', tokens: '27,230', usd: '$0.0088' }))
  assert.ok(text.includes('4') && text.includes('5'), 'both counts survive')
  assert.ok(text.includes('27,230'), 'grouped token total')
  assert.ok(text.includes('$0.0088'), 'four-decimal list price')

  const unpriced = testKit.runNotice(tr, 'notice.batch', { analyzed: 4, requested: 5 }, { ...run, unpricedCalls: 4, usdKnown: 0 })
  assert.ok(unpriced.includes(EN()['usage.priceUnavailable']), 'an entirely unpriced batch says so')
  assert.equal(unpriced.includes('$0.00'), false, 'and never claims it was free')
})

test('every confirm, privacy and preview key exists in both dictionaries', () => {
  const dicts = localeDicts['dsh-tacit']
  const keys = [
    'notice.batch', 'notice.usageCleared',
    'bootstrap.preview', 'bootstrap.previewMeasured', 'bootstrap.previewDoc',
    'confirm.reportsTitle', 'confirm.reportsBody', 'confirm.usageTitle', 'confirm.usageBody',
    'confirm.cancel', 'confirm.clear',
    'privacy.retention', 'privacy.warnDaily', 'privacy.warnMonthly', 'privacy.warnHint',
    'privacy.clearUsage', 'privacy.apply', 'privacy.stored',
  ]
  for (const key of keys) {
    assert.equal(typeof dicts.en[key], 'string', 'en ' + key)
    assert.equal(typeof dicts.zh[key], 'string', 'zh ' + key)
  }
  assert.equal(Object.keys(dicts.en).length, Object.keys(dicts.zh).length, 'the two dictionaries stay the same size')
})

test('the stylesheet carries the destructive-action rules', () => {
  const sheet = String(testKit.css)
  assert.match(sheet, /\.tacit-btn-danger\{[^}]*--dsw-alias-state-error-primary/)
  assert.match(sheet, /\.tacit-confirm-actions\{display:flex/)
})

/**
 * `ConfirmDialog` owns a hook, so it is rendered through a throwaway component
 * to give it a dispatcher; the returned tree keeps the handlers that
 * `renderToStaticMarkup` throws away.
 */
function confirmTree(props) {
  let tree = null
  const Probe = () => {
    tree = testKit.ConfirmDialog({ t: tr }, props)
    return tree
  }
  renderToStaticMarkup(React.createElement(Probe))
  return tree
}

test('Tab cycles between the two buttons instead of walking out of the confirm dialog', () => {
  const tree = confirmTree({
    open: true,
    title: tr('confirm.usageTitle'),
    body: tr('confirm.usageBody'),
    confirmLabel: tr('confirm.clear'),
    onConfirm: () => {},
    onCancel: () => {},
  })
  const buttons = collectElements(tree, (node) => node.type === 'button')
  assert.deepEqual(buttons.map((button) => button.props.id), ['tacit-confirm-cancel', 'tacit-confirm-accept'],
    'both stops are addressable without a ref')

  const focused = []
  const prevented = []
  const stops = {
    'tacit-confirm-cancel': { focus: () => focused.push('cancel') },
    'tacit-confirm-accept': { focus: () => focused.push('accept') },
  }
  globalThis.document = {
    activeElement: stops['tacit-confirm-cancel'],
    getElementById: (id) => (stops[id] === undefined ? null : stops[id]),
  }
  try {
    const press = (key, shiftKey) => tree.props.onKeyDown({
      key,
      shiftKey,
      preventDefault: () => prevented.push(key),
    })
    press('Tab', false)
    assert.deepEqual(focused, ['accept'], 'Tab off Cancel reaches the danger button')
    globalThis.document.activeElement = stops['tacit-confirm-accept']
    press('Tab', false)
    assert.deepEqual(focused, ['accept', 'cancel'], 'and wraps back rather than escaping the dialog')
    press('Tab', true)
    assert.deepEqual(focused, ['accept', 'cancel', 'cancel'], 'Shift+Tab off the danger button also stays inside')
    assert.deepEqual(prevented, ['Tab', 'Tab', 'Tab'], 'the browser is never left to move focus as well')
    press('Enter', false)
    assert.equal(focused.length, 3, 'and any other key is left alone')
  } finally {
    delete globalThis.document
  }
})

/**
 * Run `body` with every /api/tacit call answered from `routes` (anything not
 * listed answers a bare ok envelope), handing it the list of paths called in
 * order. The suite's throwing fetch is always put back.
 */
async function withApiStub(routes, body) {
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const path = String(url).replace('/api/tacit', '')
    calls.push(path)
    const payload = routes[path] === undefined ? { ok: true, code: '', detail: '' } : routes[path]
    return { ok: true, json: async () => payload }
  }
  try {
    await body(calls)
  } finally {
    globalThis.fetch = realFetch
  }
}

const previewEnvelope = (over) => ({
  ok: true,
  eligible: 6,
  skipped: 1,
  limit: 20,
  model: 'deepseek-v4-flash',
  estimate: { usd: 0.015, basis: 'doc', samples: 0, perAnalysisUsd: 0.0025 },
  code: '',
  detail: '',
  ...(over === undefined ? {} : over),
})

test('clearing reports re-prices the bootstrap preview instead of stranding the button', async () => {
  const rootStore = seedSettings()
  try {
    // The preview the panel is holding says there is nothing left to learn
    // from — exactly the state that leaves the button disabled forever.
    rootStore.preview = previewEnvelope({ eligible: 0 })
    await withApiStub({ '/bootstrap-preview': previewEnvelope({ eligible: 6 }) }, async (calls) => {
      await testKit.clearAllRoot()
      assert.ok(calls.includes('/clear'), 'the clear itself is posted')
      assert.ok(calls.includes('/bootstrap-preview'), 'and the preview is re-read')
      assert.ok(calls.indexOf('/clear') < calls.indexOf('/bootstrap-preview'), 'after the clear, not before')
      assert.equal(rootStore.preview.eligible, 6, 'the stale zero-eligible preview is replaced')
    })
    assert.equal(/<span class="tacit-bootstrap"><button([^>]*)>/.exec(renderSettings())[1].includes('disabled'), false,
      'so the Bootstrap button is usable again without a remount')
  } finally {
    rootStore.preview = null
    rootStore.usage = null
    rootStore.coached = []
    rootStore.notice = null
    rootStore.profile = null
  }
})

test('clearing usage history re-prices the preview whose measured basis it deleted', async () => {
  const rootStore = seedSettings()
  try {
    rootStore.preview = previewEnvelope({ estimate: { usd: 0.031, basis: 'measured', samples: 9, perAnalysisUsd: 0.0026 } })
    await withApiStub({
      '/usage-clear': { ok: true, removed: 12, trackingSince: 1756512000000, code: '', detail: '' },
      '/bootstrap-preview': previewEnvelope(),
    }, async (calls) => {
      await testKit.clearUsageHistory()
      assert.ok(calls.includes('/usage-clear'), 'the ledger is cleared')
      assert.ok(calls.includes('/bootstrap-preview'), 'and the estimate re-read')
      assert.ok(calls.indexOf('/usage-clear') < calls.indexOf('/bootstrap-preview'), 'after the clear, not before')
      assert.equal(rootStore.preview.estimate.basis, 'doc', 'a measured basis whose ledger is gone falls back')
      assert.equal(rootStore.notice.text, tr('notice.usageCleared', { n: 12 }), 'the clear reports what it removed')
    })
  } finally {
    rootStore.preview = null
    rootStore.usage = null
    rootStore.notice = null
    rootStore.profile = null
  }
})
