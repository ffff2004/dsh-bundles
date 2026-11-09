import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { currentPackages, packageNames, validateMarket } from './market-policy.mjs'
import { git, marketPolicy, patchPath, removeScratch, repoRoot, upstreamRevision, verifyUpstream } from './market-source.mjs'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-market-static-'))
  t.after(() => removeScratch(dir))
  return dir
}

test('market identity policy covers exactly the nine current private bundles without changing release gates', () => {
  assert.equal(currentPackages().size, 9)
  assert.equal(packageNames.length, 9)
  for (const path of currentPackages().values()) assert.equal(JSON.parse(readFileSync(join(repoRoot, path, 'package.json'))).private, true)
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json')))
  assert.equal(manifest.scripts['test:release'], 'node --test scripts/release.test.mjs')
  assert.equal(manifest.scripts['test:market:integration'], 'node scripts/market.mjs test')
  assert.equal(marketPolicy, 'package-tags-only-v1')
  assert.ok(readFileSync(patchPath, 'utf8').startsWith('diff --git '))
})

test('explicit upstream dependency/source requirements fail closed instead of silently skipping integration', t => {
  const result = spawnSync(process.execPath, ['scripts/market.mjs', 'test'], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--upstream/u)
  const dir = scratch(t)
  git(dir, ['init', '--quiet'])
  writeFileSync(join(dir, 'file'), 'not the pinned source')
  git(dir, ['add', '.'])
  git(dir, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', 'commit', '--quiet', '-m', 'fixture'])
  assert.throws(() => verifyUpstream(dir), new RegExp(upstreamRevision, 'u'))
})

test('repository validator rejects forbidden identities/commits and requires explicit empty-market permission', t => {
  const dir = scratch(t)
  const output = join(dir, 'index.json')
  const commit = 'a'.repeat(40)
  const sourceUrl = 'https://fixture.invalid/bundles'
  const name = '@ffff2004-dsh-bundles/codex-live'
  const plugin = { name, versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'git', url: sourceUrl, path: 'codex-live', commit } }] }
  const refs = { tags: new Map([[`${name}@1.0.0`, commit]]) }
  // This unit test covers only the additive repository policy. The real shared parser is exercised by the mandatory integration gate.
  const options = { output, sourceUrl, refs, parseMarketIndex() {} }
  const write = plugins => writeFileSync(output, JSON.stringify({ format: 1, title: 'Fixture', plugins }))
  write([plugin])
  validateMarket(options)
  write([{ ...plugin, name: '@local/dsh-codex-live' }])
  assert.throws(() => validateMarket(options), /Disallowed/u)
  write([{ ...plugin, versions: [{ ...plugin.versions[0], source: { ...plugin.versions[0].source, commit: 'b'.repeat(40) } }] }])
  assert.throws(() => validateMarket(options), /must match/u)
  write([])
  assert.throws(() => validateMarket(options), /empty market/u)
  validateMarket({ ...options, allowEmpty: true })
  assert.throws(() => validateMarket({ ...options, allowEmpty: true, releaseTag: `${name}@1.0.0` }), /both/u)
})
