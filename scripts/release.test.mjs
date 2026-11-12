import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'
import { planRelease, publishRelease } from './release.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const alpha = '@example-packages/alpha'
const beta = '@example-packages/beta'
const tag = (name, version = '1.0.1') => `${name}@${version}`

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-'))
  t.after(() => {
    assert.equal(dirname(root), tmpdir())
    assert.ok(root.startsWith(join(tmpdir(), 'dsh-release-')))
    rmSync(root, { recursive: true, force: true })
  })
  const cwd = join(root, 'work')
  const remote = join(root, 'remote.git')
  mkdirSync(cwd)
  function git(...args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    return result.stdout.trim()
  }
  function write(path, value) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), value)
  }
  function manifest(path, name, version, extra = {}) {
    write(`${path}/package.json`, JSON.stringify({ name, version, private: true, dsh: { bundle: {} }, ...extra }))
  }
  function changeset(file, names) {
    write(`.changeset/${file}.md`, `---\n${names.map(name => `"${name}": patch`).join('\n')}\n---\n\nFixture change.\n`)
  }
  function consume(file) {
    const path = resolve(cwd, '.changeset', `${file}.md`)
    assert.equal(dirname(path), join(cwd, '.changeset'))
    unlinkSync(path)
  }
  function commit(message = 'fixture') {
    git('add', '--all')
    git('commit', '--no-gpg-sign', '--allow-empty', '-m', message)
    const sha = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', sha)
    return sha
  }
  git('init', '--initial-branch=main')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Release fixture')
  git('config', 'core.hooksPath', '/dev/null')
  git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote)
  write('package.json', JSON.stringify({ name: 'tooling', private: true }))
  manifest('alpha', alpha, '1.0.0')
  manifest('beta', beta, '1.0.0')
  changeset('alpha', [alpha])
  changeset('beta', [beta])
  const initial = commit('initial')
  const options = releaseRef => ({ cwd, releaseRef })
  function release(names = [alpha]) {
    for (const name of names) {
      const path = name === alpha ? 'alpha' : 'beta'
      manifest(path, name, '1.0.1')
      consume(path)
    }
    return commit('release')
  }
  const remoteTags = () => git('ls-remote', '--tags', 'origin')
  return { cwd, remote, git, write, manifest, changeset, consume, commit, initial, options, release, remoteTags }
}

test('ordinary main commit and first scope-only setup with an unconsumed changeset do not release', t => {
  const f = fixture(t)
  f.write('notes.txt', 'ordinary commit\n')
  assert.deepEqual(planRelease(f.options(f.commit())).releaseTags, [])
  f.manifest('alpha', '@new-scope/alpha', '1.0.0')
  f.changeset('alpha', ['@new-scope/alpha'])
  const setup = planRelease(f.options(f.commit()))
  assert.equal(setup.isRelease, false)
  assert.deepEqual(setup.packages, [])
  assert.throws(() => publishRelease(f.options(setup.releaseRef)), /no valid release diff/u)
  assert.equal(f.remoteTags(), '')
})

test('release derives only changed manifests and consumed changesets from R and its first parent', t => {
  const f = fixture(t)
  const releaseRef = f.release()
  // The working tree and even HEAD may be unrelated to the release being retried.
  f.manifest('beta', beta, '9.0.0')
  const plan = planRelease(f.options(releaseRef))
  assert.equal(plan.isRelease, true)
  assert.equal(plan.releaseRef, releaseRef)
  assert.deepEqual(plan.releaseTags, [tag(alpha)])
  assert.deepEqual(plan.packages.map(pkg => [pkg.name, pkg.previousVersion, pkg.version]), [[alpha, '1.0.0', '1.0.1']])
})

test('first-parent diff detects an actual merge release, not the release branch parent', t => {
  const f = fixture(t)
  f.git('switch', '-c', 'changeset-release/main')
  f.release()
  f.git('switch', 'main')
  f.write('notes.txt', 'main advanced\n')
  f.commit()
  f.git('merge', '--no-ff', '--no-gpg-sign', 'changeset-release/main', '-m', 'Merge release PR')
  const releaseRef = f.git('rev-parse', 'HEAD')
  f.git('update-ref', 'refs/remotes/origin/main', releaseRef)
  assert.deepEqual(planRelease(f.options(releaseRef)).releaseTags, [tag(alpha)])
})

test('unconsumed changeset cannot authorize a version change', t => {
  const f = fixture(t)
  f.manifest('alpha', alpha, '1.0.1')
  assert.throws(() => planRelease(f.options(f.commit())), /no consumed changeset/u)
})

test('an unrelated consumed changeset cannot authorize the bumped bundle', t => {
  const f = fixture(t)
  f.manifest('alpha', alpha, '1.0.1')
  f.consume('beta')
  assert.throws(() => planRelease(f.options(f.commit())), /no consumed changeset.*alpha/u)
})

test('deleted changeset counts as consumed even when a replacement changeset is added', t => {
  const f = fixture(t)
  f.manifest('alpha', alpha, '1.0.1')
  f.consume('alpha')
  f.changeset('future', [alpha])
  assert.deepEqual(planRelease(f.options(f.commit())).releaseTags, [tag(alpha)])
})

for (const version of ['0.9.0', 'not-semver', 'v1.0.1', ' 1.0.1 ']) {
  test(`rejects a non-increasing or invalid version: ${version}`, t => {
    const f = fixture(t)
    f.manifest('alpha', alpha, version)
    f.consume('alpha')
    assert.throws(() => planRelease(f.options(f.commit())), /must increase with valid SemVer/u)
  })
}

test('accepts exact prerelease and build metadata SemVer without stripping it from tags', t => {
  const f = fixture(t)
  f.manifest('alpha', alpha, '1.1.0-beta.1+build.7')
  f.consume('alpha')
  assert.deepEqual(planRelease(f.options(f.commit())).releaseTags, [tag(alpha, '1.1.0-beta.1+build.7')])
})

test('rejects a simultaneous rename/version bump and a non-private release', t => {
  const f = fixture(t)
  f.manifest('alpha', '@new-scope/alpha', '1.0.1')
  assert.throws(() => planRelease(f.options(f.commit())), /Cannot rename and release/u)
  f.manifest('alpha', '@new-scope/alpha', '1.0.2', { private: false })
  f.changeset('new-name', ['@new-scope/alpha'])
  f.commit()
  f.manifest('alpha', '@new-scope/alpha', '1.0.3', { private: false })
  f.consume('new-name')
  assert.throws(() => planRelease(f.options(f.commit())), /must remain private/u)
})

test('retry rejects an arbitrary side-branch ref even when it contains a valid release diff', t => {
  const f = fixture(t)
  const ref = f.release()
  f.git('update-ref', 'refs/remotes/origin/main', f.initial)
  assert.throws(() => planRelease(f.options(ref)), /ancestor of trusted main/u)
})

test('rejects missing and option-like release refs', t => {
  const f = fixture(t)
  assert.throws(() => planRelease(f.options(undefined)), /release-ref is required/u)
  assert.throws(() => planRelease(f.options('--all')), /rev-parse failed/u)
})

test('publishes all this release tags at R atomically, without local tags or npm', t => {
  const f = fixture(t)
  const ref = f.release([alpha, beta])
  const result = publishRelease(f.options(ref))
  assert.deepEqual(result.releaseTags, [tag(alpha), tag(beta)])
  assert.equal(f.remoteTags(), `${ref}\trefs/tags/${tag(alpha)}\n${ref}\trefs/tags/${tag(beta)}`)
  assert.equal(f.git('tag', '--list'), '')
})

test('already-published tags at R are idempotent, including annotated tags', t => {
  const f = fixture(t)
  const ref = f.release([alpha, beta])
  f.git('tag', '-a', tag(alpha), ref, '-m', 'existing annotated tag')
  f.git('push', 'origin', `refs/tags/${tag(alpha)}`)
  publishRelease(f.options(ref))
  const before = f.remoteTags()
  publishRelease(f.options(ref))
  assert.equal(f.remoteTags(), before)
  assert.match(before, new RegExp(`${ref}\\trefs/tags/${tag(beta)}`, 'u'))
})

test('a conflicting later tag aborts the whole batch before any tag write', t => {
  const f = fixture(t)
  const ref = f.release([alpha, beta])
  f.git('push', 'origin', `${f.initial}:refs/tags/${tag(beta)}`)
  const before = f.remoteTags()
  assert.throws(() => publishRelease(f.options(ref)), /already points to another commit/u)
  assert.equal(f.remoteTags(), before)
  assert.doesNotMatch(before, /refs\/tags\/@example-packages\/alpha/u)
  assert.equal(f.git('tag', '--list'), '')
})

test('server rejection leaves no partial tags because publication is one atomic push', t => {
  const f = fixture(t)
  const ref = f.release([alpha, beta])
  // Local bare Git is the only remote used by the tests. No network writes.
  f.git('--git-dir', f.remote, 'config', 'receive.denyCurrentBranch', 'refuse')
  const hook = join(f.remote, 'hooks', 'update')
  writeFileSync(hook, `#!/bin/sh\ncase "$1" in *beta*) exit 1 ;; esac\nexit 0\n`, { mode: 0o755 })
  assert.throws(() => publishRelease(f.options(ref)), /push failed/u)
  assert.equal(f.remoteTags(), '')
})

test('a later release never backfills old or unrelated package tags', t => {
  const f = fixture(t)
  const oldRelease = f.release()
  // Deliberately do not tag the old alpha release.
  const current = f.release([beta])
  const result = publishRelease(f.options(current))
  assert.deepEqual(result.releaseTags, [tag(beta)])
  assert.equal(f.remoteTags(), `${current}\trefs/tags/${tag(beta)}`)
  // An explicit ancestor retry is permitted, but still limited to that commit's diff.
  assert.deepEqual(planRelease(f.options(oldRelease)).releaseTags, [tag(alpha)])
})

test('CLI emits safe JSON outputs and rejects a nonrelease manual-publish attempt', t => {
  const f = fixture(t)
  const output = join(f.cwd, 'github-output')
  const ref = f.release()
  const args = [join(repo, 'scripts/release.mjs'), 'plan', '--release-ref', ref]
  const result = spawnSync(process.execPath, args, { cwd: f.cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output } })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout).releaseTags, [tag(alpha)])
  assert.equal(readFileSync(output, 'utf8'), `is-release=true\nrelease-ref=${ref}\nrelease-tags=${JSON.stringify([tag(alpha)])}\n`)
  const invalid = spawnSync(process.execPath, [args[0], 'publish', '--release-ref', f.initial], { cwd: f.cwd, encoding: 'utf8' })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /no valid release diff/u)
})

for (const mode of ['fresh', 'stale', 'redispatch-error', 'remote-error']) {
  test(`Release PR preparation uses only the current main context: ${mode}`, t => {
    const f = fixture(t)
    f.git('push', 'origin', `${f.initial}:refs/heads/main`)
    f.write('new-feature.txt', 'new main content\n')
    const latest = f.commit('newer main')
    f.git('push', 'origin', `${latest}:refs/heads/main`)
    const bin = join(f.cwd, 'bin')
    mkdirSync(bin)
    const log = join(f.cwd, 'refresh-calls')
    const output = join(f.cwd, 'fresh-output')
    writeFileSync(log, '')
    writeFileSync(output, '')
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.GH_CALL_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
if (process.env.GH_TEST_MODE === 'redispatch-error') process.exit(1)
`, { mode: 0o755 })
    if (mode === 'remote-error') f.git('remote', 'set-url', 'origin', join(f.cwd, 'missing-remote'))
    const workflow = parse(readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'))
    const gate = workflow.jobs.prepare.steps.find(step => step.id === 'fresh')
    const action = workflow.jobs.prepare.steps.find(step => step.uses === 'changesets/action@v1')
    assert.equal(action.if, "steps.fresh.outputs.current == 'true'")
    assert.ok(workflow.jobs.prepare.steps.indexOf(gate) < workflow.jobs.prepare.steps.indexOf(action))
    const result = spawnSync('bash', ['-c', gate.run], {
      cwd: f.cwd, encoding: 'utf8', env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'example/repo',
        GITHUB_SHA: mode === 'fresh' ? latest : f.initial, GITHUB_OUTPUT: output,
        GH_CALL_LOG: log, GH_TEST_MODE: mode,
      },
    })
    assert.ifError(result.error)
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const decision = readFileSync(output, 'utf8')
    if (mode === 'fresh') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(decision, 'current=true\n', 'only the newest context may execute changesets/action')
      assert.deepEqual(calls, [])
    } else if (mode === 'stale') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(decision, 'current=false\n', 'the old context must not overwrite the newer Release PR')
      assert.deepEqual(calls, [['api', '--method', 'POST', 'repos/example/repo/actions/workflows/release.yml/dispatches', '-f', 'ref=main']])
    } else {
      assert.notEqual(result.status, 0, result.stdout)
      assert.equal(decision, '', 'failures cannot authorize changesets/action')
      assert.equal(calls.length, mode === 'redispatch-error' ? 1 : 0)
    }
  })
}

for (const mode of ['success', 'foreign-pr', 'wrong-base', 'api-error', 'race-before', 'race-after', 'dispatch-error']) {
  test(`explicit PR CI dispatch fails closed: ${mode}`, t => {
    const f = fixture(t)
    const bin = join(f.cwd, 'bin')
    mkdirSync(bin)
    const log = join(f.cwd, 'gh-calls')
    // Execute the real workflow shell against a local gh adapter, never GitHub.
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.GH_CALL_LOG, JSON.stringify(args) + '\\n')
const mode = process.env.GH_TEST_MODE
const route = args.find(arg => arg.startsWith('repos/'))
if (mode === 'api-error') process.exit(1)
if (route.endsWith('/pulls/42')) {
  console.log(JSON.stringify({ state: 'open', base: { ref: mode === 'wrong-base' ? 'other' : 'main' }, head: {
    ref: 'changeset-release/main', sha: 'a'.repeat(40), repo: { full_name: mode === 'foreign-pr' ? 'other/repo' : 'example/repo' },
  } }))
} else if (route.includes('/git/ref/heads/')) {
  const calls = readFileSync(process.env.GH_CALL_LOG, 'utf8')
  const count = calls.split('\\n').filter(line => line.includes('/git/ref/heads/')).length
  console.log(mode === 'race-before' || (mode === 'race-after' && count > 1) ? 'b'.repeat(40) : 'a'.repeat(40))
} else if (route.endsWith('/dispatches')) {
  if (mode === 'dispatch-error') process.exit(1)
} else process.exit(2)
`, { mode: 0o755 })
    const workflow = parse(readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'))
    const dispatch = workflow.jobs.prepare.steps.find(step => step.name === 'Explicitly validate the Release PR branch')
    const result = spawnSync('bash', ['-c', dispatch.run], {
      cwd: f.cwd, encoding: 'utf8', env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'example/repo', PR_NUMBER: '42',
        GH_CALL_LOG: log, GH_TEST_MODE: mode,
      },
    })
    assert.ifError(result.error)
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const dispatched = calls.filter(args => args.some(arg => arg.endsWith('/dispatches')))
    if (mode === 'success') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(dispatched.length, 1)
      assert.ok(dispatched[0].includes('ref=changeset-release/main'))
      assert.ok(dispatched[0].includes(`inputs[validation-sha]=${'a'.repeat(40)}`))
    } else {
      assert.notEqual(result.status, 0, result.stdout)
      assert.equal(dispatched.length, ['race-after', 'dispatch-error'].includes(mode) ? 1 : 0)
    }
  })
}

test('workflow keeps trusted main execution, token permissions, explicit PR dispatch and reusable CI', () => {
  const workflow = parse(readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'))
  assert.equal(workflow.name, 'Release bundles')
  assert.deepEqual(workflow.on.push.branches, ['main'])
  assert.equal(workflow.concurrency, undefined, 'distinct release commits must never replace pending tag jobs')
  assert.equal(workflow.jobs.publish.concurrency, undefined)
  assert.equal(workflow.jobs.prepare.concurrency.group, 'bundle-release-pr')
  assert.equal(workflow.on.workflow_dispatch.inputs['release-ref'].required, false)
  assert.equal(workflow.jobs.plan.if, "github.ref == 'refs/heads/main'")
  assert.equal(workflow.jobs.prepare.if, "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.release-ref == '')")
  assert.equal(workflow.jobs.publish.if, "needs.plan.outputs.is-release == 'true' && (github.event_name == 'push' || inputs.release-ref != '')")
  const plan = workflow.jobs.plan.steps.find(step => step.id === 'plan')
  assert.equal(plan.env.RELEASE_REF, '${{ inputs.release-ref || github.sha }}')
  const retryGuard = workflow.jobs.plan.steps.find(step => step.name === 'Reject retries without a valid release diff')
  assert.equal(retryGuard.if, "github.event_name == 'workflow_dispatch' && inputs.release-ref != '' && steps.plan.outputs.is-release != 'true'")
  for (const name of ['plan', 'prepare', 'publish']) {
    const checkout = workflow.jobs[name].steps.find(step => step.uses === 'actions/checkout@v4')
    assert.equal(checkout.with.ref, 'main')
  }
  const action = workflow.jobs.prepare.steps.find(step => step.uses === 'changesets/action@v1')
  assert.equal(action.with.version, 'pnpm version-packages')
  assert.equal(action.with.publish, undefined)
  assert.equal(workflow.jobs.prepare.permissions.actions, 'write')
  const dispatch = workflow.jobs.prepare.steps.find(step => step.name === 'Explicitly validate the Release PR branch')
  assert.equal(dispatch.env.PR_NUMBER, '${{ steps.changesets.outputs.pullRequestNumber }}')
  assert.match(dispatch.run, /validation-sha/u)
  assert.match(dispatch.run, /actions\/workflows\/ci\.yml\/dispatches/u)
  assert.match(dispatch.run, /test "\$actual" = "\$sha"/u)
  assert.equal(workflow.jobs.market.uses, './.github/workflows/ci.yml')
  assert.equal(workflow.jobs.market.with['release-ref'], '${{ needs.publish.outputs.release-ref }}')
  assert.equal(workflow.jobs.market.with['release-tags'], '${{ needs.publish.outputs.release-tags }}')
})
