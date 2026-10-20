import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../index.js'

class Tools extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
    this.visible = new Map()
  }
  get(name, scope) { return this.visible.get(scope)?.has(name) ? { name } : undefined }
}

function capability(key) {
  return class extends Service {
    constructor(ctx) { super(ctx, key) }
  }
}

async function settle(ctx) {
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) await fiber.await()
  }
}

async function fixture(t, config = {}) {
  const ctx = new Context()
  ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
  ctx.plugin(Tools)
  const fork = ctx.plugin(plugin, config)
  t.after(() => ctx.fiber.dispose())
  await settle(ctx)
  const scope = {}
  ctx.tools.visible.set(scope, new Set(['job_output', 'send_message']))
  const sectionNames = async (view = scope) => (await ctx.systemPrompt.assemble({ scope: view })).sections
    .filter(item => item.name.startsWith('local-background-wait-') && item.text.length > 0)
    .map(item => item.name)
  return { ctx, scope, fork, sectionNames }
}

const jobsSection = 'local-background-wait-jobs'
const subagentsSection = 'local-background-wait-subagents'
const jobsYield = 'When no independent work remains and you are waiting for background jobs, tell the user which jobs you are waiting for, then yield the turn — you will be notified when a job finishes. A waiting update is not a completion report.'
const subagentsYield = 'When no independent work remains and you are waiting for subagents, tell the user which subagents you are waiting for, then yield the turn — you will be notified when a subagent finishes or sends a message. A waiting update is not a completion report.'

test('defaults to yield and rejects unsupported jobs modes', () => {
  assert.equal(plugin.Config({}).jobsWaitMode, 'yield')
  assert.equal(plugin.Config({ jobsWaitMode: 'blocking' }).jobsWaitMode, 'blocking')
  assert.throws(() => plugin.Config({ jobsWaitMode: 'poll' }))
})

test('without optional services there is no guidance', async t => {
  const { sectionNames } = await fixture(t)
  assert.deepEqual(await sectionNames(), [])
})

test('jobs can mount, unmount and remount without duplicate section', async t => {
  const { ctx, sectionNames } = await fixture(t)
  const Jobs = capability('jobs')
  const first = ctx.plugin(Jobs)
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [jobsSection])
  await first.dispose()
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [])
  ctx.plugin(Jobs)
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [jobsSection])
})

test('subagents work without jobs', async t => {
  const { ctx, sectionNames } = await fixture(t)
  const fork = ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [subagentsSection])
  await fork.dispose()
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [])
})

test('blocking mode omits jobs guidance without affecting subagent guidance', async t => {
  const { ctx, scope, sectionNames } = await fixture(t, { jobsWaitMode: 'blocking' })
  ctx.plugin(capability('jobs'))
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [])
  assert.equal(renderPrompt(await ctx.systemPrompt.assemble({ scope })), '')
  assert.deepEqual(await sectionNames({}), [])
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [subagentsSection])
})

test('tool visibility is evaluated per scope on every assembly', async t => {
  const { ctx, scope, sectionNames } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await sectionNames({}), [])
  ctx.tools.visible.get(scope).delete('send_message')
  assert.deepEqual(await sectionNames(), [jobsSection])
  ctx.tools.visible.get(scope).delete('job_output')
  assert.deepEqual(await sectionNames(), [])
  ctx.tools.visible.get(scope).add('send_message')
  assert.deepEqual(await sectionNames(), [subagentsSection])
})

test('plugin disposal and reload preserve section registration across jobs modes', async t => {
  const { ctx, fork, sectionNames } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [jobsSection, subagentsSection])
  await fork.dispose()
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [])
  const blockingFork = ctx.plugin(plugin, { jobsWaitMode: 'blocking' })
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [subagentsSection])
  await blockingFork.dispose()
  ctx.plugin(plugin, { jobsWaitMode: 'yield' })
  await settle(ctx)
  assert.deepEqual(await sectionNames(), [jobsSection, subagentsSection])
})

for (const jobsWaitMode of ['yield', 'blocking']) {
  test(`${jobsWaitMode} guidance renders only in the system prompt, even with runtime context suppressed`, async t => {
    const { ctx, scope } = await fixture(t, { jobsWaitMode })
    ctx.plugin(capability('jobs'))
    ctx.plugin(capability('subagents'))
    await settle(ctx)
    const expected = jobsWaitMode === 'yield' ? `${jobsYield}\n\n${subagentsYield}` : subagentsYield
    const before = await ctx.systemPrompt.assemble({ scope })
    assert.equal(renderPrompt(before), expected)
    assert.equal(renderContextSnapshot(before), '')
    assert.deepEqual(before.contexts, [])
    const guidance = before.sections.filter(section => section.name.startsWith('local-background-wait-'))
    assert.deepEqual(guidance.filter(section => section.text.length > 0).map(section => section.name),
      jobsWaitMode === 'yield' ? [jobsSection, subagentsSection] : [subagentsSection])
    assert.ok(guidance.every(section => section.interpolate === false))

    const restore = ctx.systemPrompt.suppressRuntimeContext()
    const suppressed = await ctx.systemPrompt.assemble({ scope })
    assert.equal(renderPrompt(suppressed), expected)
    assert.equal(renderContextSnapshot(suppressed), '')
    restore()
  })
}

test('guidance follows the corresponding tool section in canonical order', async t => {
  const { ctx, scope } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  // Register anchors after the guidance and in reverse order to test sorting.
  ctx.systemPrompt.section({
    name: 'test-subagent', order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'), text: 'Subagent tools.',
  })
  ctx.systemPrompt.section({
    name: 'test-jobs', order: ctx.systemPrompt.getSectionOrder('TOOL_JOBS'), text: 'Job tools.',
  })
  const assembly = await ctx.systemPrompt.assemble({ scope })
  assert.deepEqual(assembly.sections.filter(section => section.text.length > 0).map(section => section.name), [
    'test-jobs', jobsSection, 'test-subagent', subagentsSection,
  ])
  assert.equal(renderPrompt(assembly), `Job tools.\n\n${jobsYield}\n\nSubagent tools.\n\n${subagentsYield}`)
})

test('complete system prompt sections can replace the guidance', async t => {
  const { ctx, scope } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  ctx.systemPrompt.section({ name: 'test-complete', order: 0, text: 'Custom system prompt.', complete: true })
  const assembly = await ctx.systemPrompt.assemble({ scope })
  assert.equal(renderPrompt(assembly), 'Custom system prompt.')
  assert.equal(renderContextSnapshot(assembly), '')
})
