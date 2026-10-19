import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
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
  const contextNames = async (view = scope) => (await ctx.systemPrompt.assemble({ scope: view })).contexts
    .filter(item => item.name.startsWith('local-background-wait-') && item.text.length > 0)
    .map(item => item.name)
  return { ctx, scope, fork, contextNames }
}

const jobsContext = 'local-background-wait-jobs'
const subagentsContext = 'local-background-wait-subagents'

test('defaults to yield and rejects unsupported jobs modes', () => {
  assert.equal(plugin.Config({}).jobsWaitMode, 'yield')
  assert.equal(plugin.Config({ jobsWaitMode: 'blocking' }).jobsWaitMode, 'blocking')
  assert.throws(() => plugin.Config({ jobsWaitMode: 'poll' }))
})

test('without optional services there is no guidance', async t => {
  const { contextNames } = await fixture(t)
  assert.deepEqual(await contextNames(), [])
})

test('jobs can mount, unmount and remount without duplicate context', async t => {
  const { ctx, contextNames } = await fixture(t)
  const Jobs = capability('jobs')
  const first = ctx.plugin(Jobs)
  await settle(ctx)
  assert.deepEqual(await contextNames(), [jobsContext])
  await first.dispose()
  await settle(ctx)
  assert.deepEqual(await contextNames(), [])
  ctx.plugin(Jobs)
  await settle(ctx)
  assert.deepEqual(await contextNames(), [jobsContext])
})

test('subagents work without jobs', async t => {
  const { ctx, contextNames } = await fixture(t)
  const fork = ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await contextNames(), [subagentsContext])
  await fork.dispose()
  await settle(ctx)
  assert.deepEqual(await contextNames(), [])
})

test('blocking mode registers jobs and subagent contexts independently', async t => {
  const { ctx, contextNames } = await fixture(t, { jobsWaitMode: 'blocking' })
  ctx.plugin(capability('jobs'))
  await settle(ctx)
  assert.deepEqual(await contextNames(), [jobsContext])
  assert.deepEqual(await contextNames({}), [])
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await contextNames(), [jobsContext, subagentsContext])
})

test('tool visibility is evaluated per scope on every assembly', async t => {
  const { ctx, scope, contextNames } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await contextNames({}), [])
  ctx.tools.visible.get(scope).delete('send_message')
  assert.deepEqual(await contextNames(), [jobsContext])
  ctx.tools.visible.get(scope).delete('job_output')
  assert.deepEqual(await contextNames(), [])
  ctx.tools.visible.get(scope).add('send_message')
  assert.deepEqual(await contextNames(), [subagentsContext])
})

test('plugin disposal and reload preserve context registration across jobs modes', async t => {
  const { ctx, fork, contextNames } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await contextNames(), [jobsContext, subagentsContext])
  await fork.dispose()
  await settle(ctx)
  assert.deepEqual(await contextNames(), [])
  const blockingFork = ctx.plugin(plugin, { jobsWaitMode: 'blocking' })
  await settle(ctx)
  assert.deepEqual(await contextNames(), [jobsContext, subagentsContext])
  await blockingFork.dispose()
  ctx.plugin(plugin, { jobsWaitMode: 'yield' })
  await settle(ctx)
  assert.deepEqual(await contextNames(), [jobsContext, subagentsContext])
})
