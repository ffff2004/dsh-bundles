import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertPublishingContext } from './release-automation.mjs'
import { ReleaseRepository } from './release-git.mjs'
import { GitHub, syncReleasePR, recoverReleases, completeReleases } from './release-github.mjs'

try {
  assertPublishingContext(process.env)
  const [command] = process.argv.slice(2)
  if (!['prepare', 'recover', 'validate-snapshot', 'complete'].includes(command)) throw new Error('Expected prepare, recover, validate-snapshot or complete')
  const git = new ReleaseRepository()
  const github = new GitHub(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN)
  const statePath = join(process.env.RUNNER_TEMP, 'dsh-release-batches.json')
  const output = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  if (command === 'prepare') {
    git.git('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    const pr = await syncReleasePR(git, github)
    output('head', pr?.head ?? '')
    output('number', pr?.number ?? '')
  } else if (command === 'recover') {
    git.git('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    const requested = process.env.RECOVERY_PR
    if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && !/^[1-9]\d*$/u.test(requested ?? '')) throw new Error('Recovery dispatch requires a merged Release PR number')
    const result = await recoverReleases(git, github, requested ? Number(requested) : undefined)
    writeFileSync(statePath, JSON.stringify({ refs: [...result.refs], batches: result.batches }))
    output('publish', result.publish)
  } else {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    if (command === 'validate-snapshot') {
      const current = [...git.remoteTags()].sort(([a], [b]) => a.localeCompare(b))
      const expected = state.refs.sort(([a], [b]) => a.localeCompare(b))
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('Remote tags changed during generation; retry current full snapshot')
      const market = JSON.parse(readFileSync('_site/index.json', 'utf8'))
      for (const batch of state.batches) for (const tag of batch.tags) {
        if (!market.plugins.some(plugin => plugin.versions.some(version => `${plugin.name}@${version.version}` === tag && version.source.commit === batch.release))) {
          throw new Error(`Incomplete market batch: ${tag}`)
        }
      }
    } else {
      await completeReleases(github, state.batches, `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`)
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
