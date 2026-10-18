/** Host-wide adaptation of one-shot bash/pwsh definitions; no polling or private scope tags. */
export const name = 'shell-description'
export const inject = ['tools', 'agents']

const SHELL_NAMES = ['bash', 'pwsh']
const DESCRIPTION_HINT = 'Provide `description` before `command` in the arguments.'

/** Keep invalid argument shapes intact so the original validator still rejects them. */
function withDescription(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return args
  if (typeof args.description === 'string' && args.description.trim().length > 0) return { ...args }
  const command = typeof args.command === 'string' ? args.command : ''
  const summary = command.split('\n', 1)[0].trim() || 'shell command'
  return { ...args, description: summary.slice(0, 80) }
}

/**
 * Borrow the stored definition, replacing only our fields. Keep the original
 * parameters object intact: defineTool's validator may close over that object.
 * Returns a guarded undo, or undefined for native description-free/persistent tools.
 */
function adapt(tool) {
  const parameters = tool.parameters
  if (parameters?.properties?.command?.type !== 'string') return
  const hasParameter = Object.hasOwn(parameters.properties, 'description')
  const hasHint = typeof tool.description === 'string' && tool.description.includes(DESCRIPTION_HINT)
  // hasHint also admits definitions already modified by the retired lean adapter.
  if (!hasParameter && !hasHint) return

  const original = {
    parameters,
    description: tool.description,
    execute: tool.execute,
  }
  const properties = { ...parameters.properties }
  delete properties.description
  const replacement = {
    parameters: {
      ...parameters,
      properties,
      ...(Array.isArray(parameters.required)
        ? { required: parameters.required.filter((field) => field !== 'description') }
        : {}),
    },
    description: tool.description.replace(DESCRIPTION_HINT, '').replace(/ {2,}/g, ' ').trim(),
    execute: function (args, exec) { return original.execute.call(this, withDescription(args), exec) },
  }
  for (const field of ['presentCall', 'presentResult']) {
    if (typeof tool[field] !== 'function') continue
    original[field] = tool[field]
    replacement[field] = function (args, ...rest) {
      return original[field].call(this, withDescription(args), ...rest)
    }
  }
  Object.assign(tool, replacement)
  return () => {
    // Do not clobber another plugin's subsequent replacement of any field.
    for (const field of Object.keys(replacement)) {
      if (tool[field] === replacement[field]) tool[field] = original[field]
    }
  }
}

/**
 * Presets share definition objects across agents. Reconcile by identity, not by
 * agent id, and release unreachable definitions when scopes/registrations leave.
 * Global definitions are intentionally adapted too: this is a Host-wide policy.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const patches = new Map()
    const listeners = []
    let active = true
    let reconciling = false

    const reconcile = (createdAgent) => {
      if (!active || reconciling) return
      reconciling = true
      try {
        const visible = new Set()
        const agents = ctx.agents.list()
        if (createdAgent !== undefined && !agents.includes(createdAgent)) agents.push(createdAgent)
        for (const scope of [undefined, ...agents]) {
          for (const name of SHELL_NAMES) {
            const tool = ctx.tools.get(name, scope)
            if (tool !== undefined) visible.add(tool)
          }
        }
        for (const [tool, undo] of patches) {
          if (visible.has(tool)) continue
          undo()
          patches.delete(tool)
        }
        for (const tool of visible) {
          if (patches.has(tool)) continue
          const undo = adapt(tool)
          if (undo !== undefined) patches.set(tool, undo)
        }
      } finally {
        reconciling = false
      }
    }

    const dispose = () => {
      active = false
      for (const off of listeners) off()
      for (const undo of patches.values()) undo()
      patches.clear()
    }
    try {
      listeners.push(ctx.on('agent/created', ({ agent }) => { reconcile(agent) }))
      listeners.push(ctx.on('agent/disposed', () => { reconcile() }))
      listeners.push(ctx.on('agent-preset/selected', () => { reconcile() }))
      listeners.push(ctx.on('tools/change', () => { reconcile() }))
      reconcile()
    } catch (error) {
      dispose()
      throw error
    }
    return dispose
  }, 'shell-description.adaptation')
}
