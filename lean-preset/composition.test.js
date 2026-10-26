import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseDocument } from 'yaml'

import { apply } from './tool-order.js'

// Preserve Loader expressions as inert values: tests must not evaluate !!js.
const document = parseDocument(await readFile(new URL('./cordis.patch.yml', import.meta.url), 'utf8'), {
  customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }],
})
assert.deepEqual(document.errors, [])
assert.deepEqual(document.warnings, [])
const patches = document.toJS()
const declarations = patches.flatMap(patch => patch.insert ?? [])
const preset = id => declarations.find(row => row.config.id === id)
const presentationName = '@deepseek-ai/dsh-agent-tool-presentation'

function checkIds(rows) {
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length)
  for (const row of rows) {
    assert.ok(row.id)
    if (row.group) checkIds(row.config)
  }
}

test('only inserts three independent preset declarations, without changing defaults', () => {
  assert.equal(patches.length, 1)
  assert.deepEqual(Object.keys(patches[0]), ['insert'])
  assert.deepEqual(declarations.map(row => row.config.id), ['lean', 'lean-cordis', 'lean-ptc'])
  checkIds(declarations)
  for (const row of declarations) {
    assert.equal(row.name, '@deepseek-ai/dsh-agent-preset')
    assert.equal(row.id, `preset-${row.config.id}`)
    assert.match(row.config.id, /^[a-z0-9-]+$/)
    checkIds(row.config.plugins)
  }
  assert.equal(preset('lean').config.order, 5)
  assert.equal(preset('lean-cordis').config.order, 6)
  assert.equal(preset('lean-ptc').config.order, 7)
})

test('lean-ptc has exactly the lean composition plus official PTC presentation', () => {
  const base = preset('lean').config.plugins
  const ptc = preset('lean-ptc').config.plugins
  assert.deepEqual(ptc.filter(row => row.name !== presentationName), base)
  assert.deepEqual(ptc.filter(row => row.name === presentationName), [{
    id: 'tool-presentation',
    name: presentationName,
    config: { mode: 'ptc' },
  }])
  for (const id of ['lean', 'lean-cordis']) {
    assert.equal(preset(id).config.plugins.some(row => row.name === presentationName), false)
  }
})

test('only lean-cordis mounts the Cordis tool-order policy', () => {
  for (const row of declarations) {
    const policies = row.config.plugins.filter(plugin => plugin.name === '@local/dsh-lean-preset/tool-order')
    assert.equal(policies.length, row.config.id === 'lean-cordis' ? 1 : 0)
  }
})

test('PTC keeps compaction providers and consumers in the same isolated group', () => {
  const group = preset('lean-ptc').config.plugins.find(row => row.id === 'compaction')
  assert.equal(group.name, 'cordis:group')
  assert.equal(group.group, true)
  assert.deepEqual(group.isolate, { compaction: true, toolResultPruner: true })
  assert.deepEqual(group.config.map(row => row.id), ['compaction-basic', 'command-compact', 'tool-result-pruner'])
})

test('package export ./tool-order resolves to the implemented plugin', async () => {
  const plugin = await import('@local/dsh-lean-preset/tool-order')
  assert.equal(plugin.apply, apply)
})
