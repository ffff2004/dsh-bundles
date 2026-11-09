import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseDocument } from 'yaml'
import { discoverBundles } from './dependency-policy.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scope = '@ffff2004-dsh-bundles/'
const expected = {
  'background-wait-guidance': ['2.0.4', '2.0.5', ['background-wait-jobs', 'background-wait-subagents']],
  'codex-live': ['1.1.2', '1.2.0', ['codex-live']],
  'dsh-shell-description': ['1.0.3', '1.0.4', ['shell-description']],
  'lean-preset': ['1.1.3', '1.1.4', ['preset-lean', 'preset-lean-cordis', 'preset-lean-ptc']],
  'preview-download': ['1.0.2', '1.0.3', ['preview-download']],
  'preview-path': ['1.2.1', '1.2.2', ['preview-path']],
  'shell-timeout-guidance': ['1.1.3', '1.1.4', ['shell-timeout-guidance']],
  'skill-name-mapping': ['2.0.2', '2.0.3', ['skill-name-mapping']],
  'zotero-select': ['1.0.0', '1.0.1', ['zotero-select']],
}
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const bundles = discoverBundles(repo)

test('all nine namespaces, patch row IDs, browser IDs and exported self resources agree', () => {
  assert.deepEqual(bundles.map(bundle => bundle.path).sort(), Object.keys(expected).sort())
  for (const { dir, path, manifest } of bundles) {
    assert.equal(manifest.name, scope + path.replace(/^dsh-/, ''))
    const patch = readFileSync(join(dir, manifest.dsh.bundle.patch), 'utf8')
    assert.equal(patch.includes('@local/'), false)
    const document = parseDocument(patch, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ expression: value }) }],
    })
    assert.deepEqual(document.errors, [])
    assert.deepEqual(document.toJS().flatMap(p => p.insert ?? []).map(row => row.id), expected[path][2])
    if (manifest.dsh.client) {
      const client = readFileSync(join(dir, manifest.exports['./client']), 'utf8')
      assert.equal(client.match(/\bid: ['"]([^'"]+)['"]/u)?.[1], manifest.name)
      assert.equal(client.includes('@local/'), false)
    }
    const require = createRequire(join(dir, 'package.json'))
    for (const key of Object.keys(manifest.exports)) {
      if (!key.endsWith('/icon') && !key.includes('/locale/')) continue
      for (const language of key.includes('*') ? ['en', 'zh'] : ['']) {
        const specifier = manifest.name + key.slice(1).replace('*', language)
        assert.ok(existsSync(require.resolve(specifier)), specifier)
      }
    }
  }
})

test('release configuration keeps private tooling out and private bundles independently versioned', () => {
  const config = json(join(repo, '.changeset/config.json'))
  assert.equal(config.changelog, '@changesets/cli/changelog')
  assert.equal(config.commit, false)
  assert.deepEqual(config.fixed, [])
  assert.deepEqual(config.linked, [])
  assert.equal(config.baseBranch, 'main')
  assert.deepEqual(config.ignore, ['dsh-bundles-tooling'])
  assert.deepEqual(config.privatePackages, { version: true, tag: false })
  assert.equal(config.access, 'restricted')
  const root = json(join(repo, 'package.json'))
  assert.equal(root.private, true)
  assert.equal(root.dsh, undefined)
  assert.match(root.devDependencies['@changesets/cli'], /^\d+\.\d+\.\d+$/u)
})

test('initial changesets plan eight patches and codex-live minor without mutating manifests', t => {
  // The initial plan is consumed by a future Release PR, not a permanent version baseline.
  const migration = join(repo, '.changeset/namespace-migration.md')
  if (!existsSync(migration)) return t.skip('initial namespace changeset already consumed')
  const before = bundles.map(({ dir }) => readFileSync(join(dir, 'package.json'), 'utf8'))
  const temp = mkdtempSync(join(tmpdir(), 'dsh-release-status-'))
  t.after(() => {
    assert.equal(dirname(temp), tmpdir())
    assert.ok(temp.startsWith(join(tmpdir(), 'dsh-release-status-')))
    rmSync(temp, { recursive: true, force: true })
  })
  const output = join(temp, 'status.json')
  const result = spawnSync(process.execPath, [
    join(repo, 'node_modules/@changesets/cli/bin.js'), 'status', '--output', output,
  ], { cwd: repo, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const plan = json(output)
  assert.equal(plan.releases.length, 9)
  for (const { path, manifest } of bundles) {
    const release = plan.releases.find(item => item.name === manifest.name)
    assert.ok(release, manifest.name)
    assert.equal(release.type, path === 'codex-live' ? 'minor' : 'patch')
    assert.equal(release.oldVersion, expected[path][0])
    assert.equal(release.newVersion, expected[path][1])
    assert.equal(readFileSync(join(repo, path, 'package.json'), 'utf8'), before[bundles.findIndex(b => b.path === path)])
  }
  const namespace = plan.changesets.find(item => item.id === 'namespace-migration')
  assert.equal(namespace.releases.length, 9)
  assert.ok(namespace.releases.every(item => item.type === 'patch'))
  const quota = plan.changesets.find(item => item.id === 'codex-quota-settings')
  assert.deepEqual(quota.releases, [{ name: scope + 'codex-live', type: 'minor' }])
})
