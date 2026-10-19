import z from '@deepseek-ai/schemastery'

/** Guidance only: does not change notification delivery or tool execution. */
export const name = 'background-wait-guidance'
export const inject = ['systemPrompt', 'tools']

export const Config = z.object({
  jobsWaitMode: z.union(['yield', 'blocking']).default('yield').description(
    'yield adds guidance to end the turn while awaiting job notifications; blocking adds a short instruction not to yield solely for those notifications. Use blocking for quiet delivery or a wake budget that may run out. This does not change tool-jobs configuration.',
  ),
})

const jobsYield = 'When no independent work remains and you are waiting for background jobs, tell the user which jobs you are waiting for, then yield the turn until a completion notification arrives. Do not call job_output or job_list merely to wait or check progress. A waiting update is not a completion report; collect the relevant results with job_output when resumed.'
const jobsBlocking = 'Do not yield solely to await job completion notifications; use job_output with wait: true instead.'
const subagentsYield = 'When no independent work remains and you are waiting for subagents, tell the user which subagents you are waiting for, then yield the turn until their completion notifications arrive. Do not call send_message or list_agents merely to wait or check progress. A waiting update is not a completion report. If background jobs require blocking waits, collect those results before yielding for subagents.'

/** Register independently owned contexts for optional background capabilities. */
export function apply(ctx, config = {}) {
  const { jobsWaitMode } = Config(config)

  ctx.inject(['jobs'], (jobCtx) => {
    jobCtx.systemPrompt.context({
      name: 'local-background-wait-jobs',
      order: 920,
      interpolate: false,
      text: ({ scope }) => jobCtx.tools.get('job_output', scope) === undefined
        ? ''
        : jobsWaitMode === 'yield' ? jobsYield : jobsBlocking,
    })
  })

  ctx.inject(['subagents'], (subagentCtx) => {
    subagentCtx.systemPrompt.context({
      name: 'local-background-wait-subagents',
      order: 921,
      interpolate: false,
      text: ({ scope }) => subagentCtx.tools.get('send_message', scope) === undefined
        ? ''
        : subagentsYield,
    })
  })
}
