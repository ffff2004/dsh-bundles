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
  assert.equal(typeof section.text, 'function')
  assert.equal(section.interpolate, false)
  assert.notEqual(section.complete, true)
  assert.ok(Number.isFinite(section.order))
})

for (const names of [['bash'], ['pwsh'], ['bash', 'pwsh']]) {
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

for (const backgroundName of ['bash', 'pwsh']) {
  test(`mixed timeout modes: guides only ${backgroundName}`, () => {
    const section = sectionFor(name => definition(approved[name === backgroundName ? 0 : 1]))
    assert.equal(section.text({}), expected([backgroundName]))
  })
}

test('omits guidance when both tools are absent; observes registration and removal', () => {
  const visible = new Map()
  const section = sectionFor(name => visible.get(name))
  assert.equal(section.text({}), '')
  visible.set('pwsh', definition(approved[0]))
  assert.equal(section.text({}), expected(['pwsh']))
  visible.clear()
  assert.equal(section.text({}), '')
})

for (const name of ['bash', 'pwsh']) {
  test(`rejects changed or missing descriptions for ${name}, even alongside an approved shell`, () => {
    for (const invalid of [{}, { parameters: {} }, definition(undefined), definition(null), definition(42), definition('Changed upstream'), definition(`${approved[0]} `)]) {
      const section = sectionFor(tool => tool === name ? invalid : definition(approved[0]))
      assert.throws(() => section.text({}), error => {
        assert.ok(error.message.includes(`shell-timeout-guidance: upstream ${name}.timeoutMs.description is missing or has changed`))
        assert.match(error.message, /Expected one of:/)
        assert.match(error.message, /Actual:/)
        return true
      })
    }
  })
}

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
    assert.ok(!(await prompt(bashAgent)).includes('timeoutMs'))

    const removeBash = bashScope.ctx.tools.register(makeShell('bash'))
    let removePwsh = pwshScope.ctx.tools.register(makeShell('pwsh'))
    assert.equal(owner.tools.get('bash'), undefined)
    assert.equal(owner.tools.get('pwsh'), undefined)
    assert.ok((await prompt(bashAgent)).includes(expected(['bash'])))
    assert.ok((await prompt(pwshAgent)).includes(expected(['pwsh'])))
    assert.ok(!(await prompt(emptyAgent)).includes('timeoutMs'))
    assert.ok(!(await prompt()).includes('timeoutMs'))
    assert.deepEqual((await assemble(bashAgent)).tools, owner.tools.schemas(bashAgent))
    assert.deepEqual((await assemble(pwshAgent)).tools, owner.tools.schemas(pwshAgent))

    const removeSecond = bashScope.ctx.tools.register(makeShell('pwsh', approved[1]))
    const combined = await assemble(bashAgent)
    assert.equal(combined.sections.filter(s => s.text === expected(['bash'])).length, 1)
    assert.ok(!renderPrompt(combined).includes('For bash and pwsh calls'))
    removeSecond()
    removePwsh()
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
    assert.ok(!(await prompt(pwshAgent)).includes('For pwsh calls'))
    removeBash()
    await bashScope.dispose()
    await pwshScope.dispose()
    assert.deepEqual(await assemble(bashAgent), before)
  } finally {
    await ctx.fiber.dispose()
  }
})
