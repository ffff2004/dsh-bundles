import z from '@deepseek-ai/schemastery'

/** Guidance only: does not change notification delivery or tool execution. */
export const name = 'background-wait-guidance'
export const inject = ['systemPrompt', 'tools']

export const Config = z.object({
  jobsWaitMode: z.union(['yield', 'blocking']).default('yield').description(
    'yield adds guidance to end the turn while awaiting job notifications; blocking adds no jobs guidance and leaves waiting behavior to the model. Use blocking for quiet delivery or a wake budget that may run out. This does not change tool-jobs configuration.',
  ),
})

const jobsYield = 'When no independent work remains and you are waiting for background jobs, tell the user which jobs you are waiting for, then yield the turn — you will be notified when a job finishes. A waiting update is not a completion report.'
const subagentsYield = 'When no independent work remains and you are waiting for subagents, tell the user which subagents you are waiting for, then yield the turn — you will be notified when a subagent finishes or sends a message. A waiting update is not a completion report.'

/** Register independently owned system prompt sections for optional background capabilities. */
export function apply(ctx, config = {}) {
  const { jobsWaitMode } = Config(config)

  ctx.inject(['jobs'], (jobCtx) => {
    jobCtx.systemPrompt.section({
      name: 'local-background-wait-jobs',
      order: jobCtx.systemPrompt.getSectionOrder('TOOL_JOBS') + 1,
      interpolate: false,
      text: ({ scope }) => jobCtx.tools.get('job_output', scope) === undefined
        ? ''
        : jobsWaitMode === 'yield' ? jobsYield : '',
    })
  })

  ctx.inject(['subagents'], (subagentCtx) => {
    subagentCtx.systemPrompt.section({
      name: 'local-background-wait-subagents',
      order: subagentCtx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 1,
      interpolate: false,
      text: ({ scope }) => subagentCtx.tools.get('send_message', scope) === undefined
        ? ''
        : subagentsYield,
    })
  })
}
