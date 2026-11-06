import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function editorHarness() {
  let registration
  let cursor = 0
  const state = []
  const requests = []
  let saveOk = true
  const clipboard = { writeText: async (text) => { clipboard.text = text } }
  const context = {
    window: { __ModuleLoader__: { load: (value) => { registration = value } } },
    navigator: { clipboard }, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body)
      requests.push({ url, body })
      return { ok: true, json: async () => url.endsWith('/directives')
        ? { ok: saveOk, code: saveOk ? '' : 'directive-policy', profile: {}, steering: {} }
        : { ok: true, receipt: { version: 2 } } }
    },
  }
  vm.runInNewContext(readFileSync(new URL('../client/client.js', import.meta.url), 'utf8'), context)
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((child) => child != null) }),
    useState: (initial) => {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useEffect() {},
  }
  const plugin = registration.factory((name) => name === 'react' ? react : {})
  const View = plugin.__test.DirectivesEditor({ t: (key) => key })
  const props = { config: {}, steering: { text: 'Current guidance.' }, directives: [
    { id: 'a', text: 'Check app files.', status: 'active', source: 'user', workspace: '/repos/APP' },
    { id: 'b', text: 'Read tests.', status: 'queued', source: 'distilled' },
    { id: 'c', text: 'Old advice.', status: 'retired', enabled: false },
    { id: 'd', text: 'Removed advice.', status: 'removed' },
  ] }
  const render = () => { cursor = 0; return View(props) }
  const nodes = (node) => typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)]
  const find = (predicate) => nodes(render()).find(predicate)
  const button = (label) => find((node) => node.type === 'button' && node.children.includes(label))
  const field = (label) => find((node) => node.props['aria-label'] === label)
  return { render, nodes, button, field, requests, clipboard, context, testKit: plugin.__test, setSaveOk: (value) => { saveOk = value } }
}

test('directive controls combine workspace search and status filtering and clear both', () => {
  const ui = editorHarness()
  const text = () => JSON.stringify(ui.render())
  assert.ok(!text().includes('Removed advice.'))
  ui.field('steer.search').props.onChange({ target: { value: 'app' } })
  assert.ok(text().includes('Check app files.'))
  assert.ok(!text().includes('Read tests.'))
  ui.field('steer.filter').props.onChange({ target: { value: 'queued' } })
  assert.ok(text().includes('steer.noMatches'))
  ui.button('steer.clearFilters').props.onClick()
  assert.ok(text().includes('Read tests.'))
  ui.field('steer.filter').props.onChange({ target: { value: 'disabled' } })
  assert.ok(text().includes('Old advice.'))
  assert.ok(!text().includes('Check app files.'))
})

test('directive editor cancels locally and retains draft after failed save', async () => {
  const ui = editorHarness()
  ui.button('steer.edit').props.onClick()
  ui.field('steer.editText').props.onChange({ target: { value: 'My new wording.' } })
  ui.button('steer.cancel').props.onClick()
  assert.equal(ui.requests.length, 0)
  assert.equal(ui.field('steer.editText'), undefined)
  ui.button('steer.edit').props.onClick()
  ui.field('steer.editText').props.onChange({ target: { value: 'My new wording.' } })
  ui.setSaveOk(false)
  const pending = ui.button('steer.save').props.onClick()
  assert.equal(ui.button('steer.save').props.disabled, true)
  await pending
  assert.equal(ui.field('steer.editText').props.value, 'My new wording.')
  assert.equal(ui.button('steer.save').props.disabled, false)
  ui.setSaveOk(true)
  await ui.button('steer.save').props.onClick()
  assert.equal(ui.field('steer.editText'), undefined)
  const request = ui.requests.find((r) => r.url.endsWith('/directives'))
  assert.equal(request.body.action, 'edit')
  assert.equal(request.body.id, 'a')
  assert.equal(request.body.text, 'My new wording.')
})

test('copy controls copy only the chosen text and announce clipboard failures', async () => {
  const ui = editorHarness()
  await ui.button('steer.copy').props.onClick()
  assert.equal(ui.clipboard.text, 'Check app files.')
  assert.ok(JSON.stringify(ui.render()).includes('steer.copied'))
  await ui.button('steer.copyGuidance').props.onClick()
  assert.equal(ui.clipboard.text, 'Current guidance.')
  delete ui.context.navigator.clipboard
  await ui.button('steer.copy').props.onClick()
  assert.ok(JSON.stringify(ui.render()).includes('steer.copyFailed'))
})


test('an old receipt response cannot overwrite the receipt fetched after an edit', async () => {
  const ui = editorHarness()
  const pending = []
  ui.context.fetch = () => new Promise((resolve) => pending.push(resolve))
  const old = ui.testKit.fetchReceipt('a')
  const fresh = ui.testKit.fetchReceipt('a')
  const response = (version) => ({ ok: true, json: async () => ({ ok: true, receipt: { version } }) })
  pending[1](response(2))
  await fresh
  pending[0](response(1))
  await old
  assert.equal(ui.testKit.rootStore.receipts.a.version, 2)
})
