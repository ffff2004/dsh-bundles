import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import * as plugin from './index.js'

const approved = [
  'Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed.',
  'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.',
]
const definition = description => ({
  parameters: { type: 'object', properties: { timeoutMs: { type: 'number', description } } },
})
const expected = names => `For ${names.join(' and ')} calls, omit \`timeoutMs\` unless the user requests a specific timeout or the command needs a deliberate override of the configured default. Do not routinely supply a timeout.`
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
      assert.equal(section.text({ scope }), expected(names))
    }
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

// Both directories must point to installed packages from the same DSH version.
test('real scoped registry: bash/pwsh isolation, drift, restriction, shadowing and disposal', {
  skip: !process.env.DSH_SYSTEM_PROMPT_DIR || !process.env.DSH_TOOLS_DIR,
}, async () => {
  const require = createRequire(realpathSync(`${process.env.DSH_TOOLS_DIR}/package.json`))
  const load = spec => import(pathToFileURL(require.resolve(spec)))
  const { Context } = await load('@deepseek-ai/cordis')
  const { createScope } = await load('@deepseek-ai/dsh-scope')
  const { default: Tools, defineTool } = await load('@deepseek-ai/dsh-tools')
  const { default: SystemPrompt, renderPrompt } = await import(pathToFileURL(`${process.env.DSH_SYSTEM_PROMPT_DIR}/lib/index.js`))
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
    assert.equal(combined.sections.filter(s => s.text === expected(['bash', 'pwsh'])).length, 1)
    removeSecond()
    removePwsh()
    removePwsh = pwshScope.ctx.tools.register(makeShell('pwsh', 'Changed upstream'))
    await assert.rejects(assemble(pwshAgent), /upstream pwsh\.timeoutMs\.description/)
    assert.ok((await prompt(bashAgent)).includes(expected(['bash'])))
    removePwsh()
    pwshScope.ctx.tools.register(makeShell('pwsh', approved[1]))
    assert.ok((await prompt(pwshAgent)).includes(expected(['pwsh'])))

    // A scoped approved bash shadows a global drifted bash. A restriction hides it elsewhere.
    const removeGlobal = owner.tools.register(makeShell('bash', 'Changed upstream'))
    assert.ok((await prompt(bashAgent)).includes(expected(['bash'])))
    const lift = pwshScope.ctx.tools.restrict({ deny: ['bash'] })
    assert.ok((await prompt(pwshAgent)).includes(expected(['pwsh'])))
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
