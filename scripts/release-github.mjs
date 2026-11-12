import { releaseBranch, bot, recoverBatches, statusContext } from './release-automation.mjs'

export class GitHub {
  constructor(repository, token) {
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !token) throw new Error('Expected GITHUB_REPOSITORY and GITHUB_TOKEN')
    this.repository = repository
    this.token = token
  }
  async request(path, method = 'GET', body) {
    const response = await fetch(`https://api.github.com/repos/${this.repository}/${path}`, {
      method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status} ${await response.text()}`)
    return response.status === 204 ? null : response.json()
  }
  async list(path) {
    const result = []
    for (let page = 1; ; page++) {
      const items = await this.request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      result.push(...items)
      if (items.length < 100) return result
    }
  }
}

export async function syncReleasePR(git, github) {
  const owner = github.repository.split('/')[0]
  const open = await github.list(`pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:${releaseBranch}`)}`)
  if (open.length > 1 || open.some(pr => pr.user?.login !== bot || pr.user?.id !== 41898282)) throw new Error('Release branch has an unexpected PR owner')
  const base = git.git('rev-parse', 'origin/main')
  const generated = git.versionTree(base)
  if (!generated) return null
  const branchRef = git.git('ls-remote', '--heads', 'origin', `refs/heads/${releaseBranch}`).split(/\s+/u)[0]
  let head = branchRef
  if (head) git.git('fetch', '--no-tags', 'origin', head)
  if (!head || git.tree(head) !== generated.tree || git.parents(head)[0] !== base) {
    const parents = [base]
    // Fast-forward branch updates, even when main advances: never force-push.
    if (head && !git.isAncestor(head, base)) parents.push(head)
    head = git.commitTree(generated.tree, parents)
    git.pushBranch(head, releaseBranch, github.token)
  }
  const body = `Automated Changesets release. Human review and merge authorizes the listed package tags and one market deployment. Never auto-approved or auto-merged.\n\nBase: ${base}\nGenerated head: ${head}\n\n${generated.upgrades.map(pkg => `- ${pkg.tag}`).join('\n')}\n\nKeep this PR up to date with main before merging. Prefer squash or merge; rebase is supported only for a single-commit Release PR. Bot-token checks are explicitly run by the release workflow, not PR events.`
  const payload = { title: 'chore: release packages', body }
  const pr = open[0]
    ? await github.request(`pulls/${open[0].number}`, 'PATCH', payload)
    : await github.request('pulls', 'POST', { ...payload, base: 'main', head: releaseBranch })
  return { number: pr.number, head }
}

export async function recoverReleases(git, github, requestedPR) {
  const candidates = (await github.list('pulls?state=closed&base=main&sort=created&direction=asc'))
    .filter(pr => pr.merged_at && pr.head.ref === releaseBranch && pr.user?.login === bot && pr.user?.id === 41898282)
  if (requestedPR && !candidates.some(pr => pr.number === requestedPR)) throw new Error('Requested PR is not a merged authorized Release PR')
  const batches = []
  const completed = new Set()
  for (const candidate of candidates) {
    const pr = await github.request(`pulls/${candidate.number}`)
    const checks = await github.list(`commits/${pr.head.sha}/statuses`)
    if (checks.find(status => status.context === 'dsh-release/checks')?.state !== 'success') {
      throw new Error(`Release PR #${pr.number} requires successful explicit bot-head checks`)
    }
    git.git('fetch', '--no-tags', 'origin', pr.head.sha)
    const batch = git.verify(pr, github.repository)
    batches.push(batch)
    // Completion is a retry optimization, never release authorization.
    const statuses = await github.list(`commits/${batch.release}/statuses`)
    if (statuses.find(status => status.context === statusContext)?.state === 'success') completed.add(batch.release)
  }
  const result = await recoverBatches(batches, {
    readTags: async () => git.remoteTags(),
    createTag: async (tag, sha) => {
      try { await github.request('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha }) }
      catch (error) {
        // A racing creator may have succeeded; matching peeled target is safe, never overwrite.
        if (git.remoteTags().get(tag) !== sha) throw error
      }
    },
  }, completed)
  return { ...result, batches }
}

export async function completeReleases(github, batches, runUrl) {
  for (const batch of batches) await github.request(`statuses/${batch.release}`, 'POST', {
    state: 'success', context: statusContext, description: 'Full market snapshot deployed', target_url: runUrl,
  })
}
