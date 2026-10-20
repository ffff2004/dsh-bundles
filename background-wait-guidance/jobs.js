/** Guidance only: does not change notification delivery or tool execution. */
export const name = 'background-wait-jobs'
export const inject = ['systemPrompt', 'tools']

const guidance = 'When no independent work remains and you are waiting for background jobs, tell the user which jobs you are waiting for, then yield the turn — you will be notified when a job finishes. A waiting update is not a completion report.'

export function apply(ctx) {
  ctx.inject(['jobs'], (jobCtx) => {
    jobCtx.systemPrompt.section({
      name: 'local-background-wait-jobs',
      order: jobCtx.systemPrompt.getSectionOrder('TOOL_JOBS') + 1,
      interpolate: false,
      text: ({ scope }) => jobCtx.tools.get('job_output', scope) === undefined ? '' : guidance,
    })
  })
}
