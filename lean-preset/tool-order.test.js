import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject } from './tool-order.js'

function listener() {
  let handler
  apply({
    on(event, callback) {
      assert.equal(event, 'system-prompt/assemble')
      assert.equal(handler, undefined)
      handler = callback
    },
  })
  assert.deepEqual(inject, ['systemPrompt'])
  return handler
}

function assembly(names) {
  return {
    tools: names.map(name => ({ name, description: name, parameters: {} })),
    sections: [{ name: 'persona', text: 'unchanged' }],
    contexts: [],
    variables: {},
    futureField: 'preserve me',
  }
}

const namesOf = result => result.tools.map(tool => tool.name)

test('stably moves only the four additional tools after common tools', async () => {
  const input = assembly([
    'bash', 'cordis_inspect_list', 'cordis_inspect_query', 'edit',
    'plugin_manager', 'plugin_market', 'read', 'web_search',
  ])
  const originalTools = [...input.tools]
  const result = await listener()(input, {}, async () => input)

  assert.deepEqual(namesOf(result), [
    'bash', 'edit', 'read', 'web_search',
    'cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager', 'plugin_market',
  ])
  assert.deepEqual(input.tools, originalTools)
  assert.equal(result.sections, input.sections)
  assert.equal(result.contexts, input.contexts)
  assert.equal(result.variables, input.variables)
  assert.equal(result.futureField, input.futureField)
  assert.deepEqual(new Set(result.tools), new Set(input.tools))
})

test('respects existing non-alphabetical order within both groups', async () => {
  const input = assembly(['web_search', 'plugin_market', 'bash', 'cordis_inspect_query', 'read'])
  const result = await listener()(input, {}, async () => input)
  assert.deepEqual(namesOf(result), ['web_search', 'bash', 'read', 'plugin_market', 'cordis_inspect_query'])
})

test('handles unavailable management tools and unknown common tools', async () => {
  const input = assembly(['custom_tool', 'cordis_inspect_query', 'bash'])
  const result = await listener()(input, {}, async () => input)
  assert.deepEqual(namesOf(result), ['custom_tool', 'bash', 'cordis_inspect_query'])
})

test('leaves common-only and empty lists unchanged in content', async () => {
  for (const names of [[], ['web_search', 'bash']]) {
    const input = assembly(names)
    assert.deepEqual(namesOf(await listener()(input, {}, async () => input)), names)
  }
})

test('uses the downstream waterfall result, not the original assembly', async () => {
  const input = assembly(['original'])
  const downstream = assembly(['plugin_market', 'downstream'])
  let calls = 0
  const result = await listener()(input, {}, async () => {
    calls += 1
    return downstream
  })
  assert.equal(calls, 1)
  assert.deepEqual(namesOf(result), ['downstream', 'plugin_market'])
  assert.equal(result.sections, downstream.sections)
})

test('propagates downstream failure', async () => {
  const error = new Error('downstream failure')
  await assert.rejects(listener()(assembly([]), {}, async () => { throw error }), candidate => candidate === error)
})
