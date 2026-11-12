import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, symlinkSync, readlinkSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { discoverBundles } from './dependency-policy.mjs'
import { authorizeRelease, selectUpgrades } from './release-automation.mjs'

export class ReleaseRepository {
  constructor(root = process.cwd(), modules = resolve(root, 'node_modules')) {
    this.root = root
    this.modules = modules
  }
  git(...args) {
    return execFileSync('git', args, { cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  parents(commit) { return this.git('show', '-s', '--format=%P', commit).split(' ').filter(Boolean) }
  tree(commit) { return this.git('rev-parse', `${commit}^{tree}`) }
  isAncestor(a, b) {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: this.root })
    if (result.error) throw result.error
    if (![0, 1].includes(result.status)) throw new Error('Cannot verify ancestry')
    return result.status === 0
  }
  versionTree(base) {
    if (!/^[a-f0-9]{40}$/u.test(base)) throw new Error('Expected immutable commit SHA')
    const temp = mkdtempSync(join(tmpdir(), 'dsh-version-tree-'))
    const work = join(temp, 'work')
    try {
      this.git('worktree', 'add', '--detach', work, base)
      symlinkSync(this.modules, join(work, 'node_modules'), 'dir')
      const packages = () => discoverBundles(work).map(({ path, manifest }) => ({ path, name: manifest.name, version: manifest.version }))
      const before = packages()
      const cli = join(this.modules, '@changesets/cli/bin.js')
      execFileSync(process.execPath, [cli, 'status', '--output', join(temp, 'plan.json')], { cwd: work, stdio: 'pipe' })
      const plan = JSON.parse(readFileSync(join(temp, 'plan.json'), 'utf8'))
      if (!plan.releases.some(pkg => pkg.type !== 'none')) return null
      execFileSync(process.execPath, [cli, 'version'], { cwd: work, stdio: 'pipe' })
      const upgrades = selectUpgrades(before, packages(), plan.releases)
      const git = new ReleaseRepository(work, this.modules)
      // Directory-only ignores (node_modules/) do not cover symlinks.
      // Remove only our verified temporary link before staging the release tree.
      const link = join(work, 'node_modules')
      if (dirname(link) !== work || readlinkSync(link) !== this.modules) throw new Error('Unexpected temporary dependency link')
      unlinkSync(link)
      git.git('add', '-A')
      return { tree: git.git('write-tree'), upgrades, plan }
    } finally {
      // Both paths are bounded to this freshly created, verified temporary directory.
      if (dirname(temp) !== tmpdir() || !temp.startsWith(join(tmpdir(), 'dsh-version-tree-'))) throw new Error('Unsafe cleanup path')
      this.git('worktree', 'remove', '--force', work)
      rmSync(temp, { recursive: true, force: true })
    }
  }
  verify(pr, repository, main = 'origin/main') {
    const head = pr.head.sha
    const release = pr.merge_commit_sha
    if (![head, release].every(sha => /^[a-f0-9]{40}$/u.test(sha))) throw new Error('Missing immutable release/head SHA')
    const headParents = this.parents(head)
    const base = headParents[0]
    const headTree = this.tree(head)
    const evidence = { repository, base, head, release, headParents,
      releaseParents: this.parents(release), headTree, releaseTree: this.tree(release),
      expectedTree: headTree, onMain: this.isAncestor(release, main) }
    // Validate provenance and that base is the actual main parent BEFORE executing
    // Changesets configuration. Never execute a PR-controlled base/changelog module.
    authorizeRelease(pr, evidence)
    const generated = this.versionTree(base)
    if (!generated) throw new Error(`Release PR #${pr.number} has no Changesets plan`)
    authorizeRelease(pr, { ...evidence, expectedTree: generated.tree })
    return { release, tags: generated.upgrades.map(pkg => pkg.tag), number: pr.number }
  }
  commitTree(tree, parents) {
    return this.git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', 'chore: version packages')
  }
  pushBranch(commit, branch, token) {
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
    execFileSync('git', ['push', 'origin', `${commit}:refs/heads/${branch}`], { cwd: this.root, stdio: 'pipe',
      env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: header } })
  }
  remoteTags() {
    const refs = new Map()
    const lines = this.git('ls-remote', '--tags', 'origin').split('\n').filter(Boolean)
    for (const line of lines) {
      const [sha, ref] = line.split(/\s+/u)
      if (!ref.endsWith('^{}')) refs.set(ref.slice('refs/tags/'.length), sha)
    }
    for (const line of lines) {
      const [sha, ref] = line.split(/\s+/u)
      if (ref.endsWith('^{}')) refs.set(ref.slice('refs/tags/'.length, -3), sha)
    }
    return refs
  }
}
