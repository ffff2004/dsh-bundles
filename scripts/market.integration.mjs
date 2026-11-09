import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { packageNames, validateMarket } from './market-policy.mjs'
import { generatorPath, removeScratch, repoRoot } from './market-source.mjs'

// This file is deliberately NOT a default node:test discovery name. The explicit gate must prepare the real upstream.
if (!process.env.DSH_MARKET_SOURCE) throw new Error('Run test:market:integration --upstream <pinned checkout>; never skip the real fixture gate')
const load = path => import(pathToFileURL(join(process.env.DSH_MARKET_SOURCE, path)).href)
const { generate } = await load(`${generatorPath}/src/generate.ts`)
const { gitRefs } = await load(`${generatorPath}/src/fetchers.ts`)
const { main } = await load(`${generatorPath}/src/cli.ts`)
const { parseMarketIndex } = await load('packages/util/plugin-market-index/src/index.ts')
const url = 'https://fixture.invalid/team/bundles'
const a = '@ffff2004-dsh-bundles/codex-live'
const b = '@ffff2004-dsh-bundles/preview-path'
const icon = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-market-fixture-'))
  t.after(() => removeScratch(root))
  const dir = join(root, 'repo')
  const home = join(root, 'home')
  mkdirSync(dir)
  mkdirSync(home)
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), HOME: home, XDG_CONFIG_HOME: home }
  const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
  Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: home })
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', ...args], {
    cwd: dir, env, encoding: 'utf8',
  }).trim()
  git('init', '--quiet', '--initial-branch=main')
  // The only allowed transport is file. Even a broken URL rewrite cannot reach GitHub or another network source.
  writeFileSync(join(home, '.gitconfig'), `[url "${pathToFileURL(dir).href}"]\n\tinsteadOf = ${url}\n`)
  const write = (path, value) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  const bundle = (path, name, version) => write(`${path}/package.json`, {
    name, version, private: true, engines: { dsh: '>=0.2.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } },
    exports: { './icon': './icon.svg' },
  })
  const commit = () => { git('add', '--all'); git('commit', '--quiet', '-m', 'fixture'); return git('rev-parse', 'HEAD') }
  const options = cache => ({
    sources: [{ kind: 'git', line: url, url }], cacheDir: join(root, cache), registry: 'https://registry.invalid/',
    recordRegistry: false, title: 'Fixture', inlineIconBytes: 1, concurrency: 1,
    limits: { timeoutMs: 10000, maxTarballBytes: 1024 * 1024 }, gitTransports: ['file'], warn() {},
  })
  return { root, home, dir, git, write, bundle, commit, options }
}

function writeResult(root, result) {
  const output = join(root, 'site/index.json')
  mkdirSync(join(root, 'site/icons'), { recursive: true })
  writeFileSync(output, JSON.stringify(result.index))
  for (const [path, cached] of result.icons) writeFileSync(join(root, 'site', path), readFileSync(cached))
  return output
}

test('real generator: named/annotated tags only, private bundles, exact manifests/commits, icons and isolated caches', async t => {
  const f = fixture(t)
  f.write('package.json', { private: true })
  f.write('pnpm-workspace.yaml', 'packages:\n  - "*"\n')
  f.bundle('codex-live', '@local/dsh-codex-live', '0.8.0')
  f.bundle('preview-path', b, '0.5.0')
  f.write('codex-live/icon.svg', icon)
  f.write('preview-path/icon.svg', icon)
  f.commit()
  f.git('tag', '@local/dsh-codex-live@0.8.0')
  // A current-name tag on an old-name manifest must not be accepted.
  f.git('tag', `${a}@0.8.0`)
  f.bundle('codex-live', a, '1.0.0')
  const release = f.commit()
  f.git('tag', '-a', '-m', 'annotated release', `${a}@1.0.0`)
  f.git('tag', `${b}@0.5.0`)
  f.git('tag', `${a}@1.9.0`) // version mismatch
  f.git('tag', `${a}@v1.0.0`) // not exact SemVer
  f.git('tag', `${b}@1.0.0`) // tag agrees with a different package, not this manifest
  f.bundle('codex-live', a, '1.1.0')
  f.bundle('preview-path', b, '0.6.0')
  f.commit()
  f.git('tag', 'v1.1.0')
  f.git('tag', '0.6.0')
  f.bundle('codex-live', a, '1.2.0-rc.1+build.7')
  const prerelease = f.commit()
  f.git('tag', `${a}@1.2.0-rc.1+build.7`)
  // A new, unapproved identity with a perfectly valid named tag is also excluded.
  f.bundle('other', '@ffff2004-dsh-bundles/other', '1.0.0')
  f.bundle('legacy', '@local/dsh-legacy', '1.0.0')
  f.bundle('codex-live', a, '2.0.0')
  f.bundle('preview-path', b, '0.5.0') // same version as a tag, different commit
  f.write('preview-path/untagged.txt', 'must not change source.commit')
  const head = f.commit()
  f.git('tag', '@ffff2004-dsh-bundles/other@1.0.0')
  f.git('tag', '@local/dsh-legacy@1.0.0')
  const opts = f.options('shared-cache')
  // Seed exactly the old upstream mode's result and last-success caches first.
  const old = await generate(opts)
  assert.ok(old.index.plugins.find(p => p.name === a).versions.some(v => v.version === '2.0.0' && v.source.commit === head))
  assert.ok(old.index.plugins.some(p => p.name === '@local/dsh-legacy'))
  const strict = { ...opts, packageTagsOnly: packageNames }
  const result = await generate(strict)
  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.index.plugins.map(p => [p.name, p.versions.map(v => [v.version, v.source.commit])]), [
    [a, [['1.2.0-rc.1+build.7', prerelease], ['1.0.0', release]]], [b, [['0.5.0', release]]],
  ])
  assert.equal(result.index.format, 1)
  assert.equal(result.icons.size, 1)
  assert.match(result.index.plugins[0].icon, /^icons\/[a-f0-9]{16}\.svg$/u)
  assert.equal(readFileSync([...result.icons.values()][0], 'utf8'), icon)
  const refs = await gitRefs(url, ['file'], opts.limits)
  assert.equal(refs.tags.get(`${a}@1.0.0`), release) // annotated tag is peeled
  const output = writeResult(f.root, result)
  validateMarket({ output, sourceUrl: url, refs, parseMarketIndex, releaseTag: `${a}@1.0.0`, releaseCommit: release })
  assert.throws(() => validateMarket({ output, sourceUrl: url, refs, parseMarketIndex, releaseTag: `${a}@1.0.0`, releaseCommit: head }), /not indexed/u)
  assert.deepEqual((await generate({ ...strict, packageTagsOnly: [...packageNames].reverse() })).index, result.index)

  // Source outage: old-mode fallback cannot leak into a strict-mode run with no successful strict result.
  const onlyOld = f.options('old-only-cache')
  await generate(onlyOld)
  writeFileSync(join(f.home, '.gitconfig'), `[url "${pathToFileURL(join(f.root, 'missing')).href}"]\n\tinsteadOf = ${url}\n`)
  const firstStrictOutage = await generate({ ...onlyOld, packageTagsOnly: packageNames })
  assert.equal(firstStrictOutage.failures.length, 1)
  assert.deepEqual(firstStrictOutage.index.plugins, [])
  // Once strict mode has succeeded, only that policy's last-success record is reused.
  const outage = await generate(strict)
  assert.equal(outage.failures.length, 1)
  assert.deepEqual(outage.index, result.index)
  assert.deepEqual((await generate(opts)).index, old.index) // default behavior remains unchanged
  // A changed allowlist must not borrow the wider policy's fallback either.
  assert.deepEqual((await generate({ ...strict, packageTagsOnly: [a] })).index.plugins, [])
})

test('real repository generate/validate worker runs patched CLI against local Git without network', t => {
  const f = fixture(t)
  f.write('package.json', { private: true })
  f.write('pnpm-workspace.yaml', 'packages:\n  - "*"\n')
  f.bundle('codex-live', a, '1.0.0')
  f.write('codex-live/icon.svg', icon)
  const commit = f.commit()
  f.git('tag', '-a', '-m', 'release', `${a}@1.0.0`)
  f.bundle('codex-live', a, '2.0.0')
  f.commit()
  // Exercise the production CLI's existing SSH support with a local upload-pack program, never a network client.
  const ssh = join(f.root, 'local-ssh')
  writeFileSync(ssh, '#!/bin/sh\nif [ "$1" = "-G" ]; then exit 1; fi\nexec git-upload-pack "$DSH_MARKET_FIXTURE_REPO"\n', { mode: 0o700 })
  writeFileSync(join(f.home, '.gitconfig'), `[url "ssh://fixture.invalid/local"]\n\tinsteadOf = ${url}\n`)
  const input = join(f.root, 'sources.txt')
  const output = join(f.root, 'site/index.json')
  writeFileSync(input, `${url}\n`)
  const request = { input, output, cache: join(f.root, 'cache'), 'release-tag': `${a}@1.0.0`, 'release-commit': commit }
  for (const command of ['generate', 'validate']) {
    const result = spawnSync(process.execPath, [...process.execArgv, join(repoRoot, 'scripts/market-worker.mjs')], {
      cwd: repoRoot, encoding: 'utf8', env: { ...process.env, GIT_SSH_COMMAND: ssh, DSH_MARKET_FIXTURE_REPO: f.dir,
        DSH_MARKET_REQUEST: JSON.stringify({ ...request, command }) },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
  const index = JSON.parse(readFileSync(output, 'utf8'))
  assert.deepEqual(index.plugins.map(p => [p.name, p.versions.map(v => [v.version, v.source.commit])]), [[a, [['1.0.0', commit]]]])
  assert.match(index.plugins[0].icon, /^data:image\/svg\+xml;base64,/u)
})

test('patched CLI exposes the opt-in flag, preserves shared validation, and writes format 1', async t => {
  const f = fixture(t)
  const input = join(f.root, 'sources.txt')
  const output = join(f.root, 'empty.json')
  writeFileSync(input, '# offline CLI parse/format smoke\n')
  assert.equal(await main(['--input', input, '--output', output, '--cache', join(f.root, 'cache'), '--title', 'Fixture', '--package-tags-only', packageNames.join(',')]), 0)
  const index = JSON.parse(readFileSync(output, 'utf8'))
  parseMarketIndex(index, 'https://market.invalid/index.json')
  assert.deepEqual(index.plugins, [])
  assert.throws(() => validateMarket({ output, sourceUrl: url, refs: { tags: new Map() }, parseMarketIndex }), /empty market/u)
  validateMarket({ output, sourceUrl: url, refs: { tags: new Map() }, parseMarketIndex, allowEmpty: true })
  assert.throws(() => parseMarketIndex({ ...index, format: 2 }, 'https://market.invalid/index.json'))
})
