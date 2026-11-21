import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import semver from 'semver'
import { discoverBundles } from './dependency-policy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = path => JSON.parse(readFileSync(path, 'utf8'))

test('real Changesets config versions every discovered private bundle and leaves tooling and tags alone', () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-changesets-')))
  try {
    mkdirSync(join(fixture, '.changeset'))
    writeFileSync(join(fixture, '.changeset/config.json'), readFileSync(join(root, '.changeset/config.json')))
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'dsh-bundles-tooling', private: true, packageManager: 'pnpm@11.25.0' }))
    writeFileSync(join(fixture, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir')
    // Discovery instead of a hand-maintained list: a new bundle is versioned automatically.
    const manifests = discoverBundles(root).map(bundle => bundle.manifest)
    writeFileSync(join(fixture, '.changeset/bundles.md'),
      `---\n${manifests.map(({ name }) => `"${name}": patch`).join('\n')}\n---\n\nVersion every bundle.\n`)
    for (const [index, manifest] of manifests.entries()) {
      const dir = join(fixture, 'packages', String(index))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    }
    const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' })
    git('init', '-b', 'main')
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test: initial')
    execFileSync(process.execPath, [join(root, 'node_modules/@changesets/cli/bin.js'), 'version'], { cwd: fixture, stdio: 'pipe' })
    for (const [index, original] of manifests.entries()) {
      const dir = join(fixture, 'packages', String(index))
      const updated = json(join(dir, 'package.json'))
      assert.equal(updated.private, true, `${original.name} must stay private`)
      assert.ok(semver.gt(updated.version, original.version), `${original.name} must be versioned`)
      assert.ok(existsSync(join(dir, 'CHANGELOG.md')), `${original.name} must keep a changelog`)
    }
    // Root tooling is ignored: it is never versioned, changelogged or tagged.
    assert.equal(json(join(fixture, 'package.json')).version, undefined)
    assert.equal(existsSync(join(fixture, 'CHANGELOG.md')), false)
    assert.equal(git('tag', '--list').toString().trim(), '')
  } finally {
    // fixture is the verified absolute directory returned by mkdtemp above.
    assert.ok(fixture.startsWith(join(realpathSync(tmpdir()), 'dsh-changesets-')))
    rmSync(fixture, { recursive: true, force: true })
  }
})
