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
  const texts = async (view = scope) => (await ctx.systemPrompt.assemble({ scope: view })).contexts
    .filter(item => item.name.startsWith('local-background-wait-'))
    .map(item => item.text)
    .filter(Boolean)
  return { ctx, scope, fork, texts }
}

// Pin model-visible instructions so wording changes require explicit review.
const yieldText = 'When no independent work remains and you are waiting for background jobs, tell the user which jobs you are waiting for, then yield the turn until a completion notification arrives. Do not call job_output or job_list merely to wait or check progress. A waiting update is not a completion report; collect the relevant results with job_output when resumed.'
const blockingText = 'Do not yield solely to await job completion notifications; use job_output with wait: true instead.'
const subagentText = 'When no independent work remains and you are waiting for subagents, tell the user which subagents you are waiting for, then yield the turn until their completion notifications arrive. Do not call send_message or list_agents merely to wait or check progress. A waiting update is not a completion report. If background jobs require blocking waits, collect those results before yielding for subagents.'

test('defaults to yield and rejects unsupported jobs modes', () => {
  assert.equal(plugin.Config({}).jobsWaitMode, 'yield')
  assert.equal(plugin.Config({ jobsWaitMode: 'blocking' }).jobsWaitMode, 'blocking')
  assert.throws(() => plugin.Config({ jobsWaitMode: 'poll' }))
})

test('without optional services there is no guidance', async t => {
  const { texts } = await fixture(t)
  assert.deepEqual(await texts(), [])
})

test('jobs can mount, unmount and remount without duplicate context', async t => {
  const { ctx, texts } = await fixture(t)
  const Jobs = capability('jobs')
  const first = ctx.plugin(Jobs)
  await settle(ctx)
  assert.deepEqual(await texts(), [yieldText])
  await first.dispose()
  await settle(ctx)
  assert.deepEqual(await texts(), [])
  ctx.plugin(Jobs)
  await settle(ctx)
  assert.deepEqual(await texts(), [yieldText])
})

test('subagents work without jobs', async t => {
  const { ctx, texts } = await fixture(t)
  const fork = ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await texts(), [subagentText])
  await fork.dispose()
  await settle(ctx)
  assert.deepEqual(await texts(), [])
})

test('blocking mode adds a short counter-instruction alongside subagent guidance', async t => {
  const { ctx, texts } = await fixture(t, { jobsWaitMode: 'blocking' })
  ctx.plugin(capability('jobs'))
  await settle(ctx)
  assert.deepEqual(await texts(), [blockingText])
  assert.deepEqual(await texts({}), [])
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await texts(), [blockingText, subagentText])
})

test('tool visibility is evaluated per scope on every assembly', async t => {
  const { ctx, scope, texts } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await texts({}), [])
  ctx.tools.visible.get(scope).delete('send_message')
  assert.deepEqual(await texts(), [yieldText])
  ctx.tools.visible.get(scope).delete('job_output')
  assert.deepEqual(await texts(), [])
  ctx.tools.visible.get(scope).add('send_message')
  assert.deepEqual(await texts(), [subagentText])
})

test('plugin disposal removes both contexts; reload can change jobs policy', async t => {
  const { ctx, fork, texts } = await fixture(t)
  ctx.plugin(capability('jobs'))
  ctx.plugin(capability('subagents'))
  await settle(ctx)
  assert.deepEqual(await texts(), [yieldText, subagentText])
  await fork.dispose()
  await settle(ctx)
  assert.deepEqual(await texts(), [])
  const blockingFork = ctx.plugin(plugin, { jobsWaitMode: 'blocking' })
  await settle(ctx)
  assert.deepEqual(await texts(), [blockingText, subagentText])
  await blockingFork.dispose()
  ctx.plugin(plugin, { jobsWaitMode: 'yield' })
  await settle(ctx)
  assert.deepEqual(await texts(), [yieldText, subagentText])
})
