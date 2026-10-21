/** Guidance only: does not change subagent execution or notification delivery. */
export const name = 'background-wait-subagents'
export const inject = ['systemPrompt', 'tools']

const guidance = 'When no independent work remains and you are waiting for subagents, tell the user which subagents you are waiting for, then yield the turn — you will be resumed when a subagent finishes or sends a message. A waiting update is not a completion report.'

export function apply(ctx) {
  ctx.inject(['subagents'], (subagentCtx) => {
    subagentCtx.systemPrompt.section({
      name: 'local-background-wait-subagents',
      order: subagentCtx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 1,
      interpolate: false,
      text: ({ scope }) => subagentCtx.tools.get('send_message', scope) === undefined ? '' : guidance,
    })
  })
}
