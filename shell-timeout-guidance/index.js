/** Optional model-facing guidance; does not change tool schemas or execution. */
export const name = 'shell-timeout-guidance'
export const inject = ['systemPrompt', 'tools']

// Reviewed bash and pwsh descriptions. Update only after reviewing upstream changes.
const expectedDescriptions = Object.freeze([
  'Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed.',
  'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.',
])
const shellNames = ['bash', 'pwsh']

/** Register on the plugin context so disabling it removes the prompt section. */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'local-shell-timeout-guidance',
    order: 900,
    text: ({ scope }) => {
      const visible = []
      for (const shellName of shellNames) {
        // Web presets register shell tools in an agent scope, not globally.
        const shell = ctx.tools.get(shellName, scope)
        if (shell === undefined) continue

        const actual = shell.parameters?.properties?.timeoutMs?.description
        if (!expectedDescriptions.includes(actual)) {
          throw new Error(
            `shell-timeout-guidance: upstream ${shellName}.timeoutMs.description is missing or has changed. `
            + 'Review upstream behavior before updating the approved snapshots.\n'
            + `Expected one of: ${JSON.stringify(expectedDescriptions, null, 2)}\n`
            + `Actual: ${actual === undefined ? '<missing>' : JSON.stringify(actual)}`,
          )
        }
        visible.push(shellName)
      }
      if (visible.length === 0) return ''
      return `For ${visible.join(' and ')} calls, omit \`timeoutMs\` unless the user requests a specific timeout or the command needs a deliberate override of the configured default. Do not routinely supply a timeout.`
    },
    interpolate: false,
  })
}
