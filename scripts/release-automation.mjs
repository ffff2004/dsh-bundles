import semver from 'semver'

export const releaseBranch = 'changeset-release/main'
export const bot = 'github-actions[bot]'
export const statusContext = 'dsh-market/batch'

export function assertPublishingContext(env) {
  if (!['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Publishing commands require a main push or main recovery dispatch')
  }
}

/** Caller supplies only verified durable Release PRs; all batches preflight before the first write. */
export async function recoverBatches(batches, remote, completed) {
  const desired = new Map()
  for (const batch of batches) for (const tag of batch.tags) {
    if (desired.has(tag) && desired.get(tag) !== batch.release) throw new Error(`Tag conflict: ${tag}`)
    desired.set(tag, batch.release)
  }
  const refs = await remote.readTags()
  for (const [tag, commit] of desired) {
    if (refs.has(tag) && refs.get(tag) !== commit) throw new Error(`Tag conflict: ${tag}`)
  }
  let created = false
  for (const [tag, commit] of desired) {
    if (refs.has(tag)) continue
    await remote.createTag(tag, commit)
    created = true
  }
  const current = await remote.readTags()
  for (const [tag, commit] of desired) if (current.get(tag) !== commit) throw new Error(`Incomplete tag batch: ${tag}`)
  return { publish: created || batches.some(batch => !completed.has(batch.release)), refs: current }
}

/** Evidence comes from immutable Git objects and a fresh Changesets regeneration, never PR artifacts. */
export function authorizeRelease(pr, evidence) {
  const e = evidence
  if (!pr.merged || pr.user?.login !== bot || pr.user?.id !== 41898282
    || pr.merged_by?.type !== 'User' || pr.merged_by?.login === bot
    || pr.base?.ref !== 'main' || pr.base.repo?.full_name !== e.repository
    || pr.head?.ref !== releaseBranch || pr.head.repo?.full_name !== e.repository
    || pr.head.sha !== e.head || pr.merge_commit_sha !== e.release || !e.onMain
    || ![1, 2].includes(e.headParents.length) || e.headParents[0] !== e.base
    || e.releaseParents[0] !== e.base || ![1, 2].includes(e.releaseParents.length)
    || (e.releaseParents.length === 2 && e.releaseParents[1] !== e.head)
    || e.expectedTree !== e.headTree || e.headTree !== e.releaseTree) {
    throw new Error(`Release PR #${pr.number} failed authorization (must be up to date and version-only)`)
  }
  return e.release
}

export function selectUpgrades(before, after, plan) {
  if (before.length !== after.length) throw new Error('Release cannot add/remove packages')
  const upgrades = []
  for (const old of before) {
    const next = after.find(pkg => pkg.name === old.name && pkg.path === old.path)
    if (!next) throw new Error('Release cannot rename/move packages')
    if (next.version === old.version) continue
    if (!semver.valid(next.version) || !semver.gt(next.version, old.version)) throw new Error('Release must upgrade versions')
    upgrades.push({ ...next, tag: `${next.name}@${next.version}` })
  }
  const actual = upgrades.map(pkg => `${pkg.name}:${before.find(old => old.name === pkg.name).version}:${pkg.version}`).sort()
  const claimed = plan.filter(pkg => pkg.type !== 'none').map(pkg => `${pkg.name}:${pkg.oldVersion}:${pkg.newVersion}`).sort()
  if (JSON.stringify(actual) !== JSON.stringify(claimed) || !actual.length) throw new Error('Manifest changes do not match Changesets plan')
  return upgrades
}
