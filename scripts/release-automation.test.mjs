import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeRelease, assertPublishingContext, recoverBatches, selectUpgrades } from './release-automation.mjs'

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ReleaseRepository } from './release-git.mjs'
import { syncReleasePR, recoverReleases, completeReleases } from './release-github.mjs'
import { parse } from 'yaml'

test('real Changesets regeneration yields an immutable tree without consuming the working copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-release-fixture-'))
  try {
    const put = (path, value) => writeFileSync(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
    mkdirSync(join(dir, '.changeset'))
    mkdirSync(join(dir, 'codex-live'))
    put('package.json', { name: 'tooling', private: true })
    put('pnpm-workspace.yaml', 'packages:\n  - codex-live\n')
    put('.gitignore', 'node_modules/\n')
    put('codex-live/package.json', { name, version: '1.1.2', private: true, dsh: { bundle: 'patch.yaml' } })
    put('.changeset/config.json', { changelog: '@changesets/cli/changelog', commit: false, fixed: [], linked: [], access: 'restricted', baseBranch: 'main', updateInternalDependencies: 'patch', ignore: ['tooling'], privatePackages: { version: true, tag: false } })
    put('.changeset/quota.md', `---\n"${name}": minor\n---\n\nQuota settings.\n`)
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git('init', '-b', 'main'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')
    const repository = new ReleaseRepository(dir, resolve('node_modules'))
    const base = git('rev-parse', 'HEAD')
    const generated = repository.versionTree(base)
    assert.deepEqual(generated.upgrades.map(pkg => pkg.tag), [`${name}@1.2.0`])
    assert.notEqual(generated.tree, git('rev-parse', 'HEAD^{tree}'))
    assert.equal(git('ls-tree', generated.tree, 'node_modules'), '', 'temporary dependency symlink must never enter the Release PR tree even with directory-only gitignore')
    assert.equal(repository.versionTree(base).tree, generated.tree, 'same immutable R/base yields identical regenerated tree')
    assert.equal(git('status', '--porcelain'), '', 'original manifests and pending changesets are untouched')
  } finally {
    assert.equal(resolve(dir, '..'), tmpdir())
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-release-fixture-')))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('write commands reject PRs, tag events and non-main dispatches', () => {
  for (const event of ['push', 'workflow_dispatch']) assert.doesNotThrow(() => assertPublishingContext({ GITHUB_EVENT_NAME: event, GITHUB_REF: 'refs/heads/main' }))
  for (const env of [{ GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/heads/main' },
    { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/pkg@1.0.0' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature' }]) assert.throws(() => assertPublishingContext(env), /main/)
})

test('workflow keeps PR checks read-only, explicitly tests bot heads and serializes all publication with no tag trigger', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
  assert.deepEqual(ci.permissions, { contents: 'read' })
  assert.equal(ci.on.push, undefined)
  assert.ok(ci.on.pull_request !== undefined || Object.hasOwn(ci.on, 'pull_request'))
  assert.deepEqual(release.on.push, { branches: ['main'] })
  assert.equal(release.concurrency['cancel-in-progress'], false)
  assert.equal(release.jobs['release-checks'].with.ref, '${{ needs.prepare.outputs.head }}')
  const runs = ci.jobs.test.steps.map(step => step.run ?? '').join('\n')
  for (const command of ['pnpm lint', 'pnpm test:lint', 'pnpm test:release', 'pnpm test:market', 'pnpm -r test', 'pnpm test:market:integration --upstream']) assert.ok(runs.includes(command), command)
  assert.equal(release.jobs.recover.environment, undefined, 'first boot never requests Pages environment')
  assert.equal(release.jobs.publish.if, "needs.recover.outputs.publish == 'true'")
  assert.equal(release.jobs.recover.permissions.pages, undefined)
  assert.equal(release.jobs.recover.permissions['id-token'], undefined)
  const publishing = release.jobs.publish.steps
  const generate = publishing.find(step => step.name?.startsWith('Generate exactly once'))
  assert.ok(generate.run.includes('node scripts/market.mjs generate'))
  assert.equal(generate.run.includes('--allow-empty'), false)
  assert.equal(publishing.filter(step => step.uses === 'actions/deploy-pages@v4').length, 1)
  assert.equal(publishing[0].with.ref, 'main', 'old workflow reruns check out latest trusted main')
  assert.deepEqual(release.jobs.prepare.permissions, { contents: 'write', 'pull-requests': 'write' })
})

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-release-api-'))
  const root = join(dir, 'repo')
  const remote = join(dir, 'remote.git')
  mkdirSync(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const put = (file, value) => writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
  mkdirSync(join(root, '.changeset'))
  put('package.json', { name: 'tooling', private: true })
  put('pnpm-workspace.yaml', 'packages:\n  - codex-live\n  - zotero-select\n')
  put('.gitignore', 'node_modules\n')
  for (const pkg of ['codex-live', 'zotero-select']) {
    mkdirSync(join(root, pkg))
    put(`${pkg}/package.json`, { name: `@ffff2004-dsh-bundles/${pkg}`, version: '1.0.0', private: true, dsh: { bundle: 'patch.yaml' } })
  }
  put('.changeset/config.json', { changelog: '@changesets/cli/changelog', commit: false, fixed: [], linked: [], access: 'restricted', baseBranch: 'main', updateInternalDependencies: 'patch', ignore: ['tooling'], privatePackages: { version: true, tag: false } })
  put('.changeset/batch.md', '---\n"@ffff2004-dsh-bundles/codex-live": minor\n"@ffff2004-dsh-bundles/zotero-select": patch\n---\n\nRelease batch.\n')
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  git('add', '.'); git('commit', '-m', 'fixture'); git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote); git('push', '-u', 'origin', 'main')
  const repository = new ReleaseRepository(root, resolve('node_modules'))
  const prs = []
  const statuses = new Map()
  let creates = 0
  const github = { repository: 'owner/repo', token: 'fixture',
    list: async path => {
      if (path.startsWith('pulls?state=open')) return prs.filter(pr => !pr.merged)
      if (path.startsWith('pulls?state=closed')) return prs.filter(pr => pr.merged)
      if (path.startsWith('commits/')) return statuses.get(path.split('/')[1]) ?? []
      throw new Error(`Unexpected list ${path}`)
    },
    request: async (path, method = 'GET', payload) => {
      if (path === 'pulls' && method === 'POST') {
        creates++
        const pr = { number: creates, user: { login: 'github-actions[bot]', id: 41898282 },
          head: { ref: 'changeset-release/main', sha: git('rev-parse', 'refs/remotes/origin/changeset-release/main'), repo: { full_name: 'owner/repo' } },
          base: { ref: 'main', repo: { full_name: 'owner/repo' } }, merged: false }
        prs.push(pr)
        return pr
      }
      if (path.startsWith('pulls/')) {
        const pr = prs.find(pr => pr.number === Number(path.split('/')[1]))
        if (method === 'PATCH') pr.head.sha = git('rev-parse', 'refs/remotes/origin/changeset-release/main')
        return pr
      }
      if (path === 'git/refs') { git('--git-dir', remote, 'update-ref', payload.ref, payload.sha); return {} }
      if (path.startsWith('statuses/')) {
        const commit = path.split('/')[1]
        statuses.set(commit, [payload, ...(statuses.get(commit) ?? [])]); return {}
      }
      throw new Error(`Unexpected request ${path}`)
    },
  }
  t.after(() => {
    assert.equal(resolve(dir, '..'), tmpdir())
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-release-api-')))
    rmSync(dir, { recursive: true, force: true })
  })
  return { git, put, repository, github, prs, statuses, creates: () => creates }
}

test('GITHUB_TOKEN Release PR is created once, updated without force, and creating it never authorizes publication', async t => {
  const f = fixture(t)
  const first = await syncReleasePR(f.repository, f.github)
  assert.ok(first.head)
  assert.equal((await syncReleasePR(f.repository, f.github)).head, first.head)
  assert.equal(f.creates(), 1)
  assert.equal((await recoverReleases(f.repository, f.github)).publish, false)
  await assert.rejects(recoverReleases(f.repository, f.github, first.number), /not a merged authorized/)
  f.put('ordinary.txt', 'ordinary main commit\n'); f.git('add', '.'); f.git('commit', '-m', 'ordinary'); f.git('push', 'origin', 'main')
  const updated = await syncReleasePR(f.repository, f.github)
  assert.notEqual(updated.head, first.head)
  assert.equal(f.repository.isAncestor(first.head, updated.head), true, 'branch update is fast-forward, never force')
  assert.equal(f.creates(), 1)
  assert.equal((await recoverReleases(f.repository, f.github)).publish, false)
})

for (const mode of ['merge', 'squash', 'single-commit rebase']) test(`merged ${mode} Release PR recovers immutable full batch and never redeploys completed replay`, async t => {
  const f = fixture(t)
  const generated = await syncReleasePR(f.repository, f.github)
  const base = f.git('rev-parse', 'origin/main')
  const parents = mode === 'merge' ? [base, generated.head] : [base]
  const release = f.repository.commitTree(f.repository.tree(generated.head), parents)
  f.git('update-ref', 'refs/heads/main', release); f.git('push', 'origin', 'main')
  Object.assign(f.prs[0], { merged: true, merged_at: '2026-01-01T00:00:00Z', merge_commit_sha: release, merged_by: { login: 'maintainer', type: 'User' } })
  // Explicit bot-head check is recorded by the workflow, not a recursive PR event.
  await assert.rejects(recoverReleases(f.repository, f.github, generated.number), /explicit.*checks/)
  assert.equal(f.repository.remoteTags().size, 0, 'missing bot checks cannot tag')
  f.statuses.set(generated.head, [{ context: 'dsh-release/checks', state: 'success' }])
  if (mode === 'merge') {
    f.git('tag', '-a', '@ffff2004-dsh-bundles/codex-live@1.1.0', release, '-m', 'already created annotated tag')
    f.git('push', 'origin', 'refs/tags/@ffff2004-dsh-bundles/codex-live@1.1.0')
  }
  const result = await recoverReleases(f.repository, f.github, generated.number)
  assert.equal(result.publish, true)
  assert.deepEqual([...result.refs.keys()].sort(), ['@ffff2004-dsh-bundles/codex-live@1.1.0', '@ffff2004-dsh-bundles/zotero-select@1.0.1'])
  assert.ok([...result.refs.values()].every(commit => commit === release))
  await completeReleases(f.github, result.batches, 'https://example.invalid/run')
  assert.equal((await recoverReleases(f.repository, f.github)).publish, false)
  assert.equal(await syncReleasePR(f.repository, f.github), null, 'version changes consumed only in separate Release PR')
})

test('real CLI main-context prepare/recover with offline GitHub transport boots without deploying or touching current manifests', t => {
  const f = fixture(t)
  symlinkSync(resolve('node_modules'), join(f.repository.root, 'node_modules'), 'dir')
  const temp = resolve(f.repository.root, '..')
  const preload = join(temp, 'github-fixture.mjs')
  const output = join(temp, 'output.txt')
  const apiState = join(temp, 'api.json')
  writeFileSync(apiState, '[]')
  writeFileSync(preload, `import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
globalThis.fetch = async (url, options) => {
  if (!url.startsWith('https://api.github.com/repos/owner/repo/')) throw new Error('Network forbidden');
  const path = url.split('/owner/repo/')[1];
  const prs = JSON.parse(readFileSync(process.env.FIXTURE_API, 'utf8'));
  let value;
  if (path.startsWith('pulls?state=open')) value = prs;
  else if (path.startsWith('pulls?state=closed')) value = [];
  else if (path === 'pulls' && options.method === 'POST') {
    value = { number: 1, user: { login: 'github-actions[bot]', id: 41898282 } };
    prs.push(value); writeFileSync(process.env.FIXTURE_API, JSON.stringify(prs));
  } else if (path === 'pulls/1' && options.method === 'PATCH') value = prs[0];
  else throw new Error('Unexpected offline API: ' + path);
  return { ok: true, status: 200, json: async () => value };
};`)
  const env = { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_TOKEN: 'fixture', RUNNER_TEMP: temp, GITHUB_OUTPUT: output, FIXTURE_API: apiState, NODE_OPTIONS: `--import=${preload}` }
  for (const command of ['prepare', 'prepare', 'recover']) execFileSync(process.execPath, [resolve('scripts/release.mjs'), command], { cwd: f.repository.root, env, stdio: 'pipe' })
  assert.equal(JSON.parse(readFileSync(apiState, 'utf8')).length, 1)
  assert.match(readFileSync(output, 'utf8'), /publish=false/u)
  assert.equal(f.repository.remoteTags().size, 0)
  assert.equal(f.git('status', '--porcelain'), '')
})

test('a newer completed batch does not erase an older incomplete authorization; old dispatch reconciles full latest tags', async t => {
  const f = fixture(t)
  const mergeGenerated = async () => {
    const generated = await syncReleasePR(f.repository, f.github)
    const release = f.repository.commitTree(f.repository.tree(generated.head), [f.git('rev-parse', 'origin/main')])
    f.git('update-ref', 'refs/heads/main', release); f.git('push', 'origin', 'main')
    Object.assign(f.prs.find(pr => pr.number === generated.number), { merged: true, merged_at: '2026-01-01', merge_commit_sha: release, merged_by: { login: 'maintainer', type: 'User' } })
    f.statuses.set(generated.head, [{ context: 'dsh-release/checks', state: 'success' }])
    return { ...generated, release }
  }
  const old = await mergeGenerated()
  f.git('reset', '--hard', old.release)
  f.put('.changeset/next.md', '---\n"@ffff2004-dsh-bundles/codex-live": patch\n---\n\nNext release.\n')
  f.git('add', '.'); f.git('commit', '-m', 'next changeset'); f.git('push', 'origin', 'main')
  const newer = await mergeGenerated()
  await completeReleases(f.github, [{ release: newer.release }], 'https://example.invalid/newer')
  const recovered = await recoverReleases(f.repository, f.github, old.number)
  assert.equal(recovered.publish, true)
  assert.equal(recovered.refs.get('@ffff2004-dsh-bundles/codex-live@1.1.0'), old.release)
  assert.equal(recovered.refs.get('@ffff2004-dsh-bundles/codex-live@1.1.1'), newer.release)
  assert.equal(recovered.batches.length, 2)
  await completeReleases(f.github, recovered.batches, 'https://example.invalid/full-latest')
  assert.equal((await recoverReleases(f.repository, f.github, old.number)).publish, false)
})

const sha = c => c.repeat(40)
const pr = { number: 20, merged: true, user: { login: 'github-actions[bot]', id: 41898282 },
  merged_by: { login: 'maintainer', type: 'User' }, base: { ref: 'main', repo: { full_name: 'owner/repo' } },
  head: { ref: 'changeset-release/main', sha: sha('b'), repo: { full_name: 'owner/repo' } }, merge_commit_sha: sha('c') }
const evidence = { repository: 'owner/repo', base: sha('a'), head: sha('b'), release: sha('c'),
  headParents: [sha('a')], releaseParents: [sha('a'), sha('b')], headTree: sha('d'), releaseTree: sha('d'), expectedTree: sha('d'), onMain: true }
test('only a human-merged bot Release PR with a regenerated version tree authorizes merge, squash and single rebase', () => {
  for (const releaseParents of [[sha('a'), sha('b')], [sha('a')]]) {
    assert.equal(authorizeRelease(pr, { ...evidence, releaseParents }), sha('c'))
  }
  assert.equal(authorizeRelease(pr, { ...evidence, headParents: [sha('a'), sha('f')] }), sha('c'), 'bot can fast-forward update its PR with a merge-shaped generated commit')
  for (const invalid of [{ ...pr, merged: false }, { ...pr, user: { login: 'human', id: 1 } },
    { ...pr, merged_by: { login: 'github-actions[bot]', type: 'Bot' } },
    { ...pr, head: { ...pr.head, ref: 'feature' } }]) assert.throws(() => authorizeRelease(invalid, evidence), /authorization/)
  for (const invalid of [{ ...evidence, expectedTree: sha('e') }, { ...evidence, releaseTree: sha('e') },
    { ...evidence, headParents: [sha('e')] }, { ...evidence, onMain: false },
    { ...evidence, releaseParents: [sha('e')] }]) assert.throws(() => authorizeRelease(pr, invalid), /authorization/)
})

test('durable batches preflight all tags, recover partial failures, and replay with the full current remote snapshot', async () => {
  const refs = new Map([['old@1.0.0', sha('a')]])
  let writes = 0
  let fail = true
  const remote = { readTags: async () => new Map(refs), createTag: async (tag, commit) => {
    writes++
    if (tag === 'two@1.0.0' && fail) throw new Error('injected API failure')
    refs.set(tag, commit)
  } }
  const batches = [{ release: sha('b'), tags: ['one@1.0.0', 'two@1.0.0'] }, { release: sha('c'), tags: ['three@2.0.0'] }]
  refs.set('three@2.0.0', sha('f'))
  await assert.rejects(recoverBatches(batches, remote, new Set()), /conflict/)
  assert.equal(writes, 0, 'no partial mutations before global preflight')
  refs.delete('three@2.0.0')
  await assert.rejects(recoverBatches(batches, remote, new Set()), /injected/)
  assert.equal(refs.get('one@1.0.0'), sha('b'))
  fail = false
  const recovered = await recoverBatches(batches, remote, new Set([sha('c')]))
  assert.equal(recovered.publish, true)
  assert.deepEqual([...recovered.refs.keys()].sort(), ['old@1.0.0', 'one@1.0.0', 'three@2.0.0', 'two@1.0.0'])
  assert.equal(writes, 4, 'retry skips matching tags including peeled annotated refs')
  assert.equal((await recoverBatches(batches, remote, new Set([sha('b'), sha('c')]))).publish, false)
  assert.equal((await recoverBatches([], remote, new Set())).publish, false, 'implementation merge / first boot never deploys')
})

const name = '@ffff2004-dsh-bundles/codex-live'
test('release plan selects only actual upgrades, never unchanged packages or a claimed plan alone', () => {
  const before = [{ name, version: '1.1.2', path: 'codex-live' }, { name: 'other', version: '2.0.0', path: 'other' }]
  const after = [{ ...before[0], version: '1.2.0' }, before[1]]
  assert.deepEqual(selectUpgrades(before, after, [{ name, oldVersion: '1.1.2', newVersion: '1.2.0' }]), [
    { name, version: '1.2.0', path: 'codex-live', tag: `${name}@1.2.0` },
  ])
  assert.throws(() => selectUpgrades(before, after, []), /plan/)
  assert.throws(() => selectUpgrades(before, [{ ...after[0], version: '1.0.0' }, before[1]], []), /upgrade/)
})
