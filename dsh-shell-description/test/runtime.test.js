import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Test-only devDependencies: consumers never install them, so the plugin stays dependency-free.
// Override with another compatible DSH installation's node_modules to test that version.
const runtimeModules = process.env.DSH_RUNTIME_NODE_MODULES
const installation = createRequire(runtimeModules === undefined
  ? import.meta.url
  : resolve(runtimeModules, '__runtime_test__.cjs'))
let bashPath
try {
  bashPath = installation.resolve('@deepseek-ai/dsh-tool-bash')
} catch {
  throw new Error('Runtime test dependencies are missing; run `pnpm install` in this bundle directory, or set DSH_RUNTIME_NODE_MODULES to a compatible DSH installation.')
}
const peers = createRequire(bashPath)
const loadPeer = name => import(pathToFileURL(peers.resolve(name)).href)
const [{ Context }, { ToolRuntime }, { SystemPrompt }, { AgentRegistry }, ToolBash] = await Promise.all([
  loadPeer('@deepseek-ai/cordis'),
  loadPeer('@deepseek-ai/dsh-tools'),
  loadPeer('@deepseek-ai/dsh-system-prompt'),
  loadPeer('@deepseek-ai/dsh-agent'),
  import(pathToFileURL(bashPath).href),
])
const toolsPeers = createRequire(peers.resolve('@deepseek-ai/dsh-tools'))
const { createScope, bindScopeParent } = await import(pathToFileURL(toolsPeers.resolve('@deepseek-ai/dsh-scope')).href)
let nextId = 0

async function fixture(t) {
  const ctx = new Context()
  const executed = []
  ctx.provide('shell', {
    resolve: request => ({ ...request, workdir: request.workdir ?? '/mock-workspace', timeoutMs: request.timeoutMs ?? 1000 }),
    execute: async spec => {
      executed.push(spec)
      return { result: async () => ({
        exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: spec.timeoutMs,
        stdout: { text: 'mock output\n', truncated: false },
        stderr: { text: '', truncated: false },
      }) }
    },
  })
  ctx.provide('shellEnv', { collect: () => ({}) })
  ctx.provide('workingDirectory', { ensure: async () => '/mock-workspace' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const detachers = []
  t.after(async () => {
    for (const detach of detachers.reverse()) detach()
    await ctx.fiber.dispose()
  })
  return {
    ctx, executed,
    async agent({ parent, announce = true, enter = true } = {}) {
      const id = `runtime-agent-${++nextId}`
      const agent = { id, session: { id, header: { id, cwd: '/mock-workspace' } } }
      const scope = createScope(ctx, agent, parent ? { parent } : undefined)
      agent.ctx = scope.ctx
      if (enter) {
        const detach = ctx.agents.enter(agent, undefined)
        detachers.push(detach)
        if (announce) await ctx.agents.announce(agent, 'startup')
      }
      return agent
    },
    async publish(agent) {
      detachers.push(ctx.agents.enter(agent, undefined))
      await ctx.agents.announce(agent, 'startup')
    },
    async bash(owner = ctx) {
      const fiber = owner.plugin(ToolBash, { enableRunInBackground: false })
      await fiber
      return fiber
    },
    async adapter() {
      const plugin = await import(process.env.DSH_PLUGIN_UNDER_TEST ?? new URL('../index.js', import.meta.url).href)
      assert.equal(typeof plugin.apply, 'function')
      assert.ok(plugin.inject.includes('agents') && plugin.inject.includes('tools'), 'plugin injects agents and tools')
      const fiber = ctx.plugin(plugin)
      await fiber
      return fiber
    },
    async call(agent, args) {
      return ctx.tools.execute({
        name: 'bash', callId: `runtime-call-${++nextId}`, arguments: args,
        signal: new AbortController().signal, ...(agent ? { agent } : {}),
      })
    },
  }
}

function snapshot(definition) {
  return {
    parameters: definition.parameters,
    parameterValue: structuredClone(definition.parameters),
    description: definition.description,
    execute: definition.execute,
    presentCall: definition.presentCall,
    presentResult: definition.presentResult,
  }
}

// Model-facing contract of the real ToolBash definition used by this fixture
// (config `{ enableRunInBackground: false }` does not expose `run_in_background`).
const toolBashSchema = {
  properties: ['command', 'timeoutMs', 'workdir'],
  description: /Execute a bash command \(`bash -c`\) and return its stdout\/stderr\./,
}
// The third-party shell definitions built by synthetic().
const thirdPartySchema = {
  properties: ['command'],
  description: /^A third-party shell tool\.$/,
}

function hidden(ctx, scope, name = 'bash', expected = toolBashSchema) {
  const schema = ctx.tools.schemas(scope).find(tool => tool.name === name)
  assert.ok(schema, `${name} is visible`)
  assert.equal(Object.hasOwn(schema.parameters.properties, 'description'), false, 'model schema hides description')
  assert.equal(schema.parameters.required?.includes('description') ?? false, false)
  assert.ok(schema.parameters.required?.includes('command') ?? false, 'model schema still requires command')
  for (const property of expected.properties) {
    assert.equal(typeof schema.parameters.properties[property]?.type, 'string', `model schema keeps ${property}`)
  }
  assert.equal(typeof schema.description, 'string', 'model schema keeps a description')
  assert.ok(schema.description.trim().length > 0, 'schema description is not empty')
  assert.match(schema.description, expected.description, `${name} schema description keeps its upstream text`)
  // The model must never be told to fill a parameter the schema no longer has.
  // A failure here means upstream reworded the hint, so the plugin's literal
  // replace missed it: the parameter stays hidden but the instruction leaks.
  assert.doesNotMatch(schema.description, /`description`/)
  return schema
}

const hiddenThirdParty = (ctx, scope, name = 'bash') => hidden(ctx, scope, name, thirdPartySchema)

function restored(tool, before) {
  assert.equal(tool.parameters, before.parameters, 'original parameters identity is restored')
  assert.deepEqual(tool.parameters, before.parameterValue, 'original parameter contents are restored')
  for (const key of ['description', 'execute', 'presentCall', 'presentResult']) {
    assert.equal(tool[key], before[key], `${key} is restored exactly`)
  }
}

function synthetic({ name = 'bash', command = true, description = true } = {}) {
  return {
    name,
    description: description
      ? 'A third-party shell tool. Provide `description` before `command` in the arguments.'
      : 'A native description-free shell tool.',
    parameters: {
      type: 'object',
      properties: {
        [command ? 'command' : 'input']: { type: 'string' },
        ...(description ? { description: { type: 'string' } } : {}),
      },
      required: [command ? 'command' : 'input', ...(description ? ['description'] : [])],
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async args => args.description ?? 'native',
    presentCall: args => ({ card: 'terminal', title: args.command ?? args.input, description: args.description }),
    presentResult: (args, result) => ({ card: 'generic', title: args.description, content: result.content }),
  }
}

test('fixture uses the real bash validator and refuses missing description before adaptation', async t => {
  const h = await fixture(t)
  const agent = await h.agent()
  await h.bash(agent.ctx)
  const result = await h.call(agent, { command: 'not actually executed' })
  assert.equal(result.isError, true)
  assert.match(result.error.message, /description/)
  assert.equal(h.executed.length, 0)
})

test('Host initial scan hides an existing scoped bash and executes without description', async t => {
  const h = await fixture(t)
  const agent = await h.agent()
  await h.bash(agent.ctx)
  await h.adapter()
  hidden(h.ctx, agent)
  const result = await h.call(agent, { command: 'not actually executed' })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(h.executed.length, 1)
  assert.equal(h.executed[0].command, 'not actually executed')
})

test('agent/created discovers a previously unpublished agent scope', async t => {
  const h = await fixture(t)
  await h.adapter()
  const agent = await h.agent({ enter: false })
  await h.bash(agent.ctx)
  assert.ok(h.ctx.tools.get('bash', agent).parameters.properties.description,
    'expected the unadapted description parameter before the agent is published')
  await h.publish(agent)
  hidden(h.ctx, agent)
  assert.equal((await h.call(agent, { command: 'new agent command' })).isError, false)
})

test('shared preset-parent definition is wrapped only once across agents and change notifications', async t => {
  const h = await fixture(t)
  const preset = {}
  const scope = createScope(h.ctx, preset)
  await h.bash(scope.ctx)
  const first = await h.agent({ parent: preset })
  const second = await h.agent({ parent: preset })
  const tool = h.ctx.tools.get('bash', first)
  const before = snapshot(tool)
  const adapter = await h.adapter()
  const wrapped = tool.execute
  assert.equal(tool, h.ctx.tools.get('bash', second))
  hidden(h.ctx, first)
  hidden(h.ctx, second)
  for (let index = 0; index < 3; index++) h.ctx.emit('tools/change')
  assert.equal(tool.execute, wrapped, 'same shared definition is not repeatedly wrapped')
  const third = await h.agent({ parent: preset })
  hidden(h.ctx, third)
  assert.equal(tool.execute, wrapped)
  await adapter.dispose()
  restored(tool, before)
})

test('global tool is hidden without any agents, including registration after activation', async t => {
  const h = await fixture(t)
  const first = synthetic()
  const unregister = h.ctx.tools.register(first)
  const adapter = await h.adapter()
  hiddenThirdParty(h.ctx)
  unregister()
  const replacement = synthetic()
  h.ctx.tools.register(replacement)
  hiddenThirdParty(h.ctx)
  assert.equal(await replacement.execute({ command: 'global command' }), 'global command')
  await adapter.dispose()
})

test('unregister/re-register adapts the replacement immediately without timers', async t => {
  const h = await fixture(t)
  const agent = await h.agent()
  const originalFiber = await h.bash(agent.ctx)
  const oldDefinition = h.ctx.tools.get('bash', agent)
  await h.adapter()
  hidden(h.ctx, agent)
  await originalFiber.dispose()
  assert.equal(h.ctx.tools.get('bash', agent), undefined)
  await h.bash(agent.ctx)
  assert.notEqual(h.ctx.tools.get('bash', agent), oldDefinition)
  hidden(h.ctx, agent)
  assert.equal((await h.call(agent, { command: 'replacement command' })).isError, false)
})

test('unload restores original objects and callbacks; supplied descriptions remain intact', async t => {
  const h = await fixture(t)
  const agent = await h.agent()
  await h.bash(agent.ctx)
  const tool = h.ctx.tools.get('bash', agent)
  const before = snapshot(tool)
  const adapter = await h.adapter()
  const args = { command: 'first line\nsecond line', description: 'User supplied description' }
  assert.equal((await h.call(agent, args)).isError, false)
  assert.equal(tool.presentCall(args).description, 'User supplied description')
  assert.equal(tool.presentCall({ command: 'first line\nsecond line' }).description, 'first line')
  assert.deepEqual(args, { command: 'first line\nsecond line', description: 'User supplied description' })
  await adapter.dispose()
  restored(tool, before)
  const missing = await h.call(agent, { command: 'not run after unload' })
  assert.equal(missing.isError, true)
  assert.match(missing.error.message, /description/)
  // No adaptation after dispose: definitions registered later stay untouched.
  const other = synthetic({ name: 'pwsh' })
  const otherBefore = snapshot(other)
  h.ctx.tools.register(other)
  restored(other, otherBefore)
})

test('pwsh-shaped one-shot definitions adapt execution and both presentation callbacks', async t => {
  const h = await fixture(t)
  const tool = synthetic({ name: 'pwsh' })
  const before = snapshot(tool)
  h.ctx.tools.register(tool)
  const adapter = await h.adapter()
  hiddenThirdParty(h.ctx, undefined, 'pwsh')
  const args = { command: 'Write-Output test' }
  const result = { content: [{ type: 'text', text: 'test' }], isError: false }
  assert.equal(await tool.execute(args), 'Write-Output test')
  assert.equal(tool.presentCall(args).description, 'Write-Output test')
  assert.equal(tool.presentResult(args, result).title, 'Write-Output test')
  const given = { ...args, description: 'Explicit label' }
  assert.equal(await tool.execute(given), 'Explicit label')
  assert.equal(tool.presentCall(given).description, 'Explicit label')
  assert.equal(tool.presentResult(given, result).title, 'Explicit label')
  assert.deepEqual(args, { command: 'Write-Output test' }, 'adapter does not mutate the logged input')
  await adapter.dispose()
  restored(tool, before)
})

test('preset parent switch restores unreachable definitions and adapts the newly selected preset', async t => {
  const h = await fixture(t)
  const firstPreset = {}
  const secondPreset = {}
  const firstScope = createScope(h.ctx, firstPreset)
  const secondScope = createScope(h.ctx, secondPreset)
  await h.bash(firstScope.ctx)
  await h.bash(secondScope.ctx)
  const agent = await h.agent()
  const binding = bindScopeParent(agent, firstPreset)
  const firstTool = h.ctx.tools.get('bash', firstPreset)
  const secondTool = h.ctx.tools.get('bash', secondPreset)
  const firstBefore = snapshot(firstTool)
  const secondBefore = snapshot(secondTool)
  const adapter = await h.adapter()
  hidden(h.ctx, agent)
  restored(secondTool, secondBefore)
  binding.rebind(secondPreset)
  h.ctx.emit('agent-preset/selected', agent.id, 'second-preset')
  hidden(h.ctx, agent)
  restored(firstTool, firstBefore)
  assert.equal((await h.call(agent, { command: 'new preset command' })).isError, false)
  await adapter.dispose()
  restored(secondTool, secondBefore)
})

test('unload does not overwrite another plugin subsequent field replacement', async t => {
  const h = await fixture(t)
  const tool = synthetic()
  const before = snapshot(tool)
  h.ctx.tools.register(tool)
  const adapter = await h.adapter()
  hiddenThirdParty(h.ctx)
  const subsequent = async () => 'another plugin implementation'
  const subsequentCall = () => ({ card: 'generic', title: 'another plugin call' })
  tool.execute = subsequent
  tool.presentCall = subsequentCall
  await adapter.dispose()
  assert.equal(tool.execute, subsequent)
  assert.equal(tool.presentCall, subsequentCall)
  assert.equal(tool.parameters, before.parameters)
  assert.deepEqual(tool.parameters, before.parameterValue)
  assert.equal(tool.description, before.description)
  assert.equal(tool.presentResult, before.presentResult)
})

test('native description-free and persistent input-shaped tools are untouched', async t => {
  const h = await fixture(t)
  const native = synthetic({ description: false })
  const persistent = synthetic({ name: 'pwsh', command: false })
  const nativeBefore = snapshot(native)
  const persistentBefore = snapshot(persistent)
  h.ctx.tools.register(native)
  h.ctx.tools.register(persistent)
  const adapter = await h.adapter()
  restored(native, nativeBefore)
  restored(persistent, persistentBefore)
  h.ctx.emit('tools/change')
  restored(native, nativeBefore)
  restored(persistent, persistentBefore)
  await adapter.dispose()
})
