import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import semver from 'semver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = path => JSON.parse(readFileSync(path, 'utf8'))

test('real Changesets versions all nine private identities independently, consumes the initial changeset, and writes migration notes', () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-changesets-')))
  try {
    mkdirSync(join(fixture, '.changeset'))
    writeFileSync(join(fixture, '.changeset/config.json'), readFileSync(join(root, '.changeset/config.json')))
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'dsh-bundles-tooling', private: true, packageManager: 'pnpm@11.25.0' }))
    writeFileSync(join(fixture, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir')
    const directories = ['background-wait-guidance', 'codex-live', 'dsh-shell-description', 'lean-preset', 'preview-download', 'preview-path', 'shell-timeout-guidance', 'skill-name-mapping', 'zotero-select']
    const manifests = directories.map(directory => json(join(root, directory, 'package.json')))
    // The real initial changeset is consumed by the first Release PR; keep the
    // versioning regression test useful after that release as well.
    const initial = join(root, '.changeset/new-package-identities.md')
    writeFileSync(join(fixture, '.changeset/initial.md'), existsSync(initial)
      ? readFileSync(initial)
      : `---\n${manifests.map(manifest => `"${manifest.name}": patch`).join('\n')}\n---\n\n新身份需移除旧包后重装。\n`)
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
      assert.equal(updated.name, original.name)
      assert.equal(updated.version, semver.inc(original.version, 'patch'))
      assert.equal(updated.private, true)
      const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')
      assert.ok(changelog.includes(updated.version))
      assert.match(changelog, /移除旧包/)
    }
    assert.equal(existsSync(join(fixture, '.changeset/initial.md')), false)
    assert.equal(json(join(fixture, 'package.json')).version, undefined)
    assert.equal(git('tag', '--list').toString().trim(), '')
  } finally {
    // fixture is the verified absolute directory returned by mkdtemp above.
    assert.ok(fixture.startsWith(join(realpathSync(tmpdir()), 'dsh-changesets-')))
    rmSync(fixture, { recursive: true, force: true })
  }
})
