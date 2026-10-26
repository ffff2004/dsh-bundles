import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { Config as agentInstructionsConfig } from '@deepseek-ai/dsh-agent-instructions'
import { Config as presentationConfig } from '@deepseek-ai/dsh-agent-tool-presentation'
import { resolveConfig as resolvePrunerConfig } from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import { Config as personaConfig } from '@deepseek-ai/dsh-persona'
import { Config as skillFilesystemConfig } from '@deepseek-ai/dsh-skill-filesystem'
import { Config as toolSubagentConfig } from '@deepseek-ai/dsh-tool-subagent'
import { Config as toolWebConfig } from '@deepseek-ai/dsh-tool-web'
import Schema from '@deepseek-ai/schemastery'
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

// Upstream schema contracts for the config rows these presets mount. Each
// `Config` export is a schemastery schema: resolving a row config with
// `strict = true` drops every key the schema does not declare, so a key that
// survives in the row but is missing from the resolved object is a config field
// the upstream package no longer supports.
const configSchemas = new Map([
  ['@deepseek-ai/dsh-agent-instructions', agentInstructionsConfig],
  ['@deepseek-ai/dsh-agent-tool-presentation', presentationConfig],
  ['@deepseek-ai/dsh-persona', personaConfig],
  ['@deepseek-ai/dsh-skill-filesystem', skillFilesystemConfig],
  ['@deepseek-ai/dsh-tool-subagent', toolSubagentConfig],
  ['@deepseek-ai/dsh-tool-web', toolWebConfig],
])

// The pruner exports no schemastery schema; its own resolver throws on unknown keys.
const prunerName = '@deepseek-ai/dsh-compaction-tool-result-pruner'

// Rows whose config carries a Loader expression cannot be resolved without
// evaluating it. The expected skip set is pinned: a new expression row must be
// reviewed and added here rather than silently escaping validation.
const loaderExpressionRows = new Set(['lean-cordis/skill-filesystem'])

function hasLoaderExpression(value) {
  if (Array.isArray(value)) return value.some(hasLoaderExpression)
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(([key, inner]) => key === '__jsExpr' || hasLoaderExpression(inner))
}

function rowsWithConfig(rows, label, collected = []) {
  for (const row of rows) {
    if (row.group === true) rowsWithConfig(row.config, `${label}/${row.id}`, collected)
    else if (row.config !== undefined) collected.push({ row, label: `${label}/${row.id}` })
  }
  return collected
}

test('every mounted preset config row is accepted by its upstream schema', () => {
  const skipped = new Set()
  for (const presetId of ['lean', 'lean-cordis', 'lean-ptc']) {
    for (const { row, label } of rowsWithConfig(preset(presetId).config.plugins, presetId)) {
      const where = `${label} (${row.name})`
      if (hasLoaderExpression(row.config)) {
        skipped.add(`${presetId}/${row.id}`)
        continue
      }
      if (row.name === prunerName) {
        assert.doesNotThrow(() => resolvePrunerConfig(row.config), `${where} config is rejected by its resolver`)
        continue
      }
      const schema = configSchemas.get(row.name)
      assert.ok(schema !== undefined,
        `${where} carries config but this test has no upstream schema for it: newly added config rows need a validator`)
      const [resolved] = Schema.resolve(row.config, schema, {}, true)
      const undeclared = Object.keys(row.config).filter(key => !(key in resolved))
      assert.deepEqual(
        undeclared,
        [],
        `${where} config has keys its upstream schema does not declare: ${undeclared.join(', ')}`,
      )
    }
  }
  assert.deepEqual([...skipped].sort(), [...loaderExpressionRows].sort(),
    'a preset row gained a Loader expression: decide explicitly whether it can be validated')
})
