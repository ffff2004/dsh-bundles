import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../index.js'
import { projection, projectionKey } from '../src/projection.js'

const uri = 'zotero://select/library/items/ABCD1234'
const links = [{ uri, title: 'Paper', itemKey: 'ABCD1234' }]
const message = (id, text, extra = {}) => ({
  type: 'assistant/message', data: { message: { id, content: [{ type: 'text', text }] }, ...extra },
})

test('projection replay is deterministic, JSON-safe, message-indexed and ignores live/reasoning/user content', () => {
  const initial = projection.init()
  for (const event of [
    { type: 'user/message' }, { type: 'assistant/attempt' }, { type: 'turn/end' },
    message('interrupted', `[Paper](${uri})`, { interrupted: true }),
    message('no-links', 'ordinary text'),
    { type: 'assistant/message', data: { message: { id: 'reasoning', content: [{ type: 'reasoning', text: `[Paper](${uri})` }] } } },
  ]) assert.equal(projection.apply(initial, event), initial)
  const event = message('old-message', `[Paper](${uri})`)
  const state = projection.apply(initial, event)
  assert.deepEqual(state['old-message'], links)
  assert.deepEqual(initial, {})
  assert.equal(projection.wire.view(state), state)
  assert.deepEqual(projection.stateSchema.parse(JSON.parse(JSON.stringify(state))), state)
  assert.deepEqual(projection.apply(projection.init(), event), state)
  const next = projection.apply(state, message('next-message', `[Other](${uri})`))
  assert.equal(next['old-message'], state['old-message'])
  assert.equal(projection.apply(next, { type: 'tool/result' }), next)
})

test('bold citation with external Zotero marker preserves extraction and title', () => {
  const state = projection.apply({}, message('styled', `**[Paper](${uri})**〔Zotero〕`))
  assert.deepEqual(state.styled, links)
})

test('text block boundaries join like host copy without including reasoning', () => {
  const event = { type: 'assistant/message', data: { message: { id: 'split', content: [
    { type: 'text', text: '[Paper](zotero://' },
    { type: 'reasoning', text: 'IGNORE' },
    { type: 'text', text: 'select/library/items/ABCD1234)' },
  ] } } }
  assert.deepEqual(projection.apply({}, event).split, links)
})

class Projections extends Service {
  constructor(ctx) { super(ctx, 'sessionProjections'); this.definition = undefined }
  register(definition) {
    this.definition = definition
    return this.ctx.effect(() => () => { this.definition = undefined })
  }
}
async function settle(ctx) {
  for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) await fiber.await()
}

test('real prompt assembly adds English personal/group Markdown examples and unload removes the section', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
  ctx.plugin(Projections)
  await settle(ctx)
  const before = await ctx.systemPrompt.assemble()
  const fork = ctx.plugin(plugin)
  await settle(ctx)
  const after = await ctx.systemPrompt.assemble()
  const added = after.sections.filter(section => !before.sections.some(old => old.name === section.name))
  assert.equal(added.length, 1)
  assert.equal(added[0].text, plugin.citationGuidance)
  assert.equal(ctx.sessionProjections.definition, projection)
  await fork.dispose()
  assert.equal(ctx.sessionProjections.definition, undefined)
  assert.deepEqual((await ctx.systemPrompt.assemble()).sections, before.sections)
})

async function clientFixture() {
  let registration
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // Same combo can be evaluated twice without top-level binding collisions.
  const context = vm.createContext({ window: { __ModuleLoader__: { load(value) { registration = value } } } })
  vm.runInContext(source + ';\n' + source, context)
  assert.equal(registration.id, '@local/dsh-zotero-select')
  const client = registration.factory(name => { assert.equal(name, 'react'); return React })
  let entry, Component, disposeCallback
  const locales = []
  client.apply({
    locale: { register(ns, dicts) { locales.push({ ns, dicts }) } },
    slots: {
      inject(name, effect) { assert.equal(name, 'conversation.chat.turnTail'); disposeCallback = effect() },
      register(options, component) { entry = options; Component = component; return () => {} },
    },
  })
  assert.equal(entry.id, 'local-zotero-select')
  assert.equal(entry.locale, locales[0].ns)
  assert.deepEqual(Object.keys(locales[0].dicts.en).sort(), Object.keys(locales[0].dicts.zh).sort())
  const makeProps = (view, closing = { status: 'settled', finalNode: { messageId: 'old-message' } }) => ({
    turn: { turn: 42 },
    useChat(selector) { return selector({ timeline: { turns: new Map([[42, { data: new Map([['turn-tail', { closing }]]) }]]) } }) },
    useProjection(key, selector) { assert.equal(key, projectionKey); return selector(view) },
    t(key, args) { return locales[0].dicts.en[key].replace('{count}', args?.count) },
  })
  return { Component, makeProps, disposeCallback }
}

test('client is additive, collapsed by default and renders only validated per-message select links', async t => {
  const { Component, makeProps, disposeCallback } = await clientFixture()
  let rendered
  act(() => { rendered = TestRenderer.create(React.createElement(Component, makeProps({ 'old-message': links }))) })
  t.after(() => { act(() => rendered.unmount()); disposeCallback() })
  const details = rendered.root.findByType('details')
  assert.equal(details.props.open, undefined)
  assert.equal(rendered.root.findByType('summary').children.join(''), 'Zotero references (1)')
  const anchor = rendered.root.findByType('a')
  assert.equal(anchor.props.href, uri)
  assert.equal(anchor.props.onClick, undefined) // native navigation only, no Host execution
  assert.equal(anchor.children.join(''), 'Paper')
  assert.equal(rendered.root.findAllByType('p').length, 0)
  act(() => rendered.update(React.createElement(Component, makeProps({ 'old-message': [{ uri: 'javascript:alert(1)', title: 'bad' }] }))))
  assert.equal(rendered.toJSON(), null)
})

test('missing capability, another message, streaming and interrupted states render no menu', async () => {
  const { Component, makeProps } = await clientFixture()
  for (const props of [
    makeProps(undefined), makeProps({ other: links }), makeProps({}),
    makeProps({ 'old-message': links }, { status: 'streaming', finalNode: { messageId: 'old-message' } }),
    makeProps({ 'old-message': links }, { status: 'interrupted', finalNode: { messageId: 'old-message' } }),
    makeProps({ 'old-message': links }, null),
  ]) {
    let rendered
    act(() => { rendered = TestRenderer.create(React.createElement(Component, props)) })
    assert.equal(rendered.toJSON(), null)
    act(() => rendered.unmount())
  }
})
