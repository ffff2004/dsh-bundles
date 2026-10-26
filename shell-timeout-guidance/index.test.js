import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import * as plugin from './index.js'

const approved = [
  'Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed.',
  'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.',
]
const definition = description => ({
  parameters: { type: 'object', properties: { timeoutMs: { type: 'number', description } } },
})
const expected = names => `For ${names.join(' and ')} calls, omit \`timeoutMs\` unless the command needs a deliberate override of the configured default. Do not routinely supply a timeout.`
function sectionFor(get) {
  const sections = []
  plugin.apply({ tools: { get }, systemPrompt: { section: value => sections.push(value) } })
  assert.equal(sections.length, 1)
  return sections[0]
}

test('registers a renamed literal section without looking up tools at activation', () => {
  const section = sectionFor(() => { throw new Error('must not look up at activation') })
  assert.equal(plugin.name, 'shell-timeout-guidance')
  assert.equal(section.name, 'local-shell-timeout-guidance')
  assert.deepEqual(plugin.inject, ['systemPrompt', 'tools'])
  assert.equal(section.interpolate, false)
  assert.equal(section.order, 900)
})

for (const names of [['bash'], ['bash', 'pwsh']]) {
  test(`guides only visible tools: ${names.join(', ')}, with both approved descriptions`, () => {
    const scope = {}
    for (const description of approved) {
      const section = sectionFor((name, actualScope) => {
        assert.equal(actualScope, scope)
        assert.ok(['bash', 'pwsh'].includes(name))
        return names.includes(name) ? definition(description) : undefined
      })
      assert.equal(section.text({ scope }), description === approved[0] ? expected(names) : '')
    }
  })
}

test('mixed timeout modes: guides only bash', () => {
  const backgroundName = 'bash'
  const section = sectionFor(name => definition(approved[name === backgroundName ? 0 : 1]))
  assert.equal(section.text({}), expected([backgroundName]))
})

test('rejects changed or missing descriptions for bash, even alongside an approved shell', () => {
  const name = 'bash'
  const fixtures = [
    [{}, 'Actual: <missing>'],
    [definition('Changed upstream'), 'Actual: "Changed upstream"'],
    [definition(`${approved[0]} `), `Actual: ${JSON.stringify(`${approved[0]} `)}`],
  ]
  for (const [invalid, actual] of fixtures) {
    const section = sectionFor(tool => tool === name ? invalid : definition(approved[0]))
    assert.throws(() => section.text({}), error => {
      assert.ok(error.message.includes(`shell-timeout-guidance: upstream ${name}.timeoutMs.description is missing or has changed`))
      for (const description of approved) assert.ok(error.message.includes(description), error.message)
      assert.ok(error.message.includes(actual), error.message)
      return true
    })
  }
})

test('real scoped registry: bash/pwsh isolation, drift, restriction, shadowing and disposal', async () => {
  const ctx = new Context()
  const makeShell = (name, description = approved[0]) => defineTool({
    name, description: 'Scoped test shell',
    parameters: { timeoutMs: { type: 'number', description } },
    output: { schema: { type: 'string' }, render: () => [] },
    execute: async () => '',
  })
  try {
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(Tools)
    let owner
    await ctx.plugin({ inject: ['tools', 'systemPrompt'], apply(ctx) { owner = ctx } })
    const bashAgent = {}, pwshAgent = {}, emptyAgent = {}
    const bashScope = createScope(owner, bashAgent)
    const pwshScope = createScope(owner, pwshAgent)
    const before = await owner.systemPrompt.assemble({ scope: bashAgent })
    const fork = ctx.plugin(plugin)
    await fork
    const assemble = scope => owner.systemPrompt.assemble({ scope })
    const prompt = async scope => renderPrompt(await assemble(scope))

    const removeBash = bashScope.ctx.tools.register(makeShell('bash'))
    let removePwsh = pwshScope.ctx.tools.register(makeShell('pwsh'))
    assert.equal(owner.tools.get('bash'), undefined)
    assert.equal(owner.tools.get('pwsh'), undefined)
    assert.ok((await prompt(bashAgent)).includes(expected(['bash'])))
    assert.ok((await prompt(pwshAgent)).includes(expected(['pwsh'])))
    assert.ok(!(await prompt(emptyAgent)).includes('timeoutMs'))

    const removeSecond = bashScope.ctx.tools.register(makeShell('pwsh', approved[1]))
    const combined = await assemble(bashAgent)
    assert.equal(combined.sections.filter(s => s.text === expected(['bash'])).length, 1)
    removeSecond()
    removePwsh()
    assert.ok(!(await prompt(pwshAgent)).includes('timeoutMs'))
    removePwsh = pwshScope.ctx.tools.register(makeShell('pwsh', 'Changed upstream'))
    await assert.rejects(assemble(pwshAgent), /upstream pwsh\.timeoutMs\.description/)
    assert.ok((await prompt(bashAgent)).includes(expected(['bash'])))
    removePwsh()
    pwshScope.ctx.tools.register(makeShell('pwsh', approved[1]))
    assert.ok(!(await prompt(pwshAgent)).includes('timeoutMs'))

    // A scoped approved bash shadows a global drifted bash. A restriction hides it elsewhere.
    const removeGlobal = owner.tools.register(makeShell('bash', 'Changed upstream'))
    assert.ok((await prompt(bashAgent)).includes(expected(['bash'])))
    const lift = pwshScope.ctx.tools.restrict({ deny: ['bash'] })
    assert.ok(!(await prompt(pwshAgent)).includes('timeoutMs'))
    lift()
    await assert.rejects(assemble(pwshAgent), /upstream bash\.timeoutMs\.description/)
    removeGlobal()

    await fork.dispose()
    assert.ok(!(await prompt(bashAgent)).includes('timeoutMs'))
    removeBash()
    await bashScope.dispose()
    await pwshScope.dispose()
    assert.deepEqual(await assemble(bashAgent), before)
  } finally {
    await ctx.fiber.dispose()
  }
})
