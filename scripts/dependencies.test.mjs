import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { discoverBundles } from './dependency-policy.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(repo, 'scripts/check-dependencies.mjs')
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2))
const base = () => ({
  name: '@local/fixture', version: '1.0.0', type: 'module',
  dsh: { bundle: { patch: './cordis.patch.yml' } }, engines: { dsh: '>=1.2.0 <2.0.0' },
  dependencies: { '@deepseek-ai/schemastery': '3.18.5' },
  peerDependencies: { '@deepseek-ai/dsh-llm': '>=1.3.0-beta.2 <2.0.0-0' },
  devDependencies: { '@deepseek-ai/dsh-llm': '1.3.0-beta.4' },
})
const baseline = "import '@deepseek-ai/dsh-llm'\nimport '@deepseek-ai/schemastery'\n"
function fixture(t, manifests = [base()], sources = [baseline]) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dependency-'))
  t.after(() => {
    // Only the exact temporary tree created above may be removed.
    assert.equal(dirname(root), tmpdir())
    assert.ok(root.startsWith(join(tmpdir(), 'dsh-dependency-')))
    rmSync(root, { recursive: true, force: true })
  })
  json(join(root, 'package.json'), { name: 'dsh-bundles-tooling', private: true, type: 'module', devDependencies: { yaml: '2.9.1' } })
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages: ['*']\n")
  // Make real root-only and installed imports resolvable by the upstream rule.
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir')
  manifests.forEach((manifest, i) => {
    mkdirSync(join(root, `bundle-${i}`))
    json(join(root, `bundle-${i}/package.json`), manifest)
    writeFileSync(join(root, `bundle-${i}/index.js`), sources[i] ?? baseline)
  })
  return root
}
function run(root, tool) {
  const [command, args] = tool === 'eslint'
    ? [join(repo, 'node_modules/.bin/eslint'), ['--config', join(repo, 'eslint.config.mjs'), '.']]
    : tool === 'syncpack'
      ? [join(repo, 'node_modules/.bin/syncpack'), ['lint', '--config', join(repo, '.syncpackrc.json')]]
      : [process.execPath, [cli]]
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}
function passes(root, tool) {
  const result = run(root, tool)
  assert.equal(result.status, 0, result.output)
  return result.output
}
function rejects(root, tool, pattern) {
  const result = run(root, tool)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, pattern)
}

test('real CLIs accept ordinary owned deps, shared peer ranges and exact dev versions', t => {
  const root = fixture(t)
  for (const tool of ['eslint', 'syncpack', 'policy']) passes(root, tool)
})

for (const [title, source] of [
  ['bare static import', "import 'missing-package'"],
  ['multiline import', "import {\n missing\n} from 'missing-package/subpath'"],
  ['named re-export', "export { missing } from 'missing-package'"],
  ['star re-export', "export * from 'missing-package'"],
  ['literal dynamic import', "await import('missing-package/subpath')"],
  ['unbound Node require', "require('missing-package')"],
  ['scoped third-party subpath', "import '@earendil-works/pi-ai/providers/all'"],
]) {
  test(`ESLint rejects missing declaration: ${title}`, t => {
    rejects(fixture(t, [base()], [baseline + source]), 'eslint', /must be declared in this bundle/u)
  })
}

test('installed root dependency cannot satisfy a bundle import (upstream rule and supplement)', t => {
  const root = fixture(t, [base()], [baseline + "import 'yaml'\n"])
  rejects(root, 'eslint', /bundle\/no-extraneous-dependencies/u)
  rejects(root, 'eslint', /no root\/dev-only fallback/u)
})

test('production dev-only import is rejected; a test import is allowed', t => {
  const pkg = base()
  pkg.devDependencies.yaml = '^2.8.1'
  const root = fixture(t, [pkg], [baseline + "import 'yaml'\n"])
  rejects(root, 'eslint', /not devDependencies/u)
  writeFileSync(join(root, 'bundle-0/index.js'), baseline)
  writeFileSync(join(root, 'bundle-0/index.test.js'), "import 'yaml'\n")
  passes(root, 'eslint')
})

for (const [file, allowed] of [
  ['test/probe.js', true], ['test/nested/probe.mjs', true],
  ['tests/probe.mjs', true], ['tests/nested/probe.cjs', true],
  ['__tests__/probe.cjs', true], ['__tests__/nested/probe.js', true],
  ['probe.test.js', true], ['probe.test.mjs', true], ['probe.test.cjs', true],
  ['src/test/probe.js', false], ['src/tests/probe.js', false],
  ['src/__tests__/probe.mjs', false], ['src/probe.test.js', false],
  ['src/probe.test.mjs', false], ['src/probe.test.cjs', false],
  ['check.mjs', false],
]) {
  test(`all declaration checks treat ${file} as ${allowed ? 'test' : 'production'}`, t => {
    const pkg = base()
    delete pkg.peerDependencies
    pkg.devDependencies.yaml = '^2.8.1'
    const root = fixture(t, [pkg], ["import '@deepseek-ai/schemastery'\n"])
    const path = join(root, 'bundle-0', file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file.endsWith('.cjs')
      ? "require('yaml'); require('@deepseek-ai/dsh-llm')\n"
      : "import 'yaml'; import '@deepseek-ai/dsh-llm'\n")
    if (allowed) {
      passes(root, 'eslint')
      passes(root, 'policy')
    } else {
      const result = run(root, 'eslint')
      assert.equal(result.status, 1, result.output)
      assert.match(result.output, /bundle\/no-extraneous-dependencies/u)
      assert.match(result.output, /bundle\/own-manifest/u)
      // The collector must also count this shared import as production use.
      rejects(root, 'policy', /runtime shared-instance use requires both peerDependencies/u)
    }
  })
}

test('AST normalizes owned scoped subpaths and permits self-reference/Node builtins', t => {
  const pkg = base()
  pkg.dependencies['@earendil-works/pi-ai'] = '1.3.0'
  const root = fixture(t, [pkg], [baseline + "export * from '@earendil-works/pi-ai/providers/all'\nimport '@local/fixture/subpath'\nimport 'node:fs'\nimport 'fs/promises'\n"])
  passes(root, 'eslint')
})

test('local factory require is not Node require; nonliteral loading stays outside analysis', t => {
  const root = fixture(t, [base()], [baseline + "function factory(require) { return require('yaml') }\nconst target = 'missing-package'; import(target); require(target)\n"])
  passes(root, 'eslint')
  passes(root, 'policy')
})

for (const [title, change, pattern] of [
  ['shared dependency', p => { p.dependencies['@deepseek-ai/dsh-llm'] = p.devDependencies['@deepseek-ai/dsh-llm'] }, /shared-instance packages belong/u],
  ['shared optional dependency', p => { p.optionalDependencies = { '@deepseek-ai/dsh-llm': '1.3.0-beta.4' } }, /shared-instance packages belong/u],
  ['missing peer', p => { delete p.peerDependencies['@deepseek-ai/dsh-llm'] }, /requires both peerDependencies/u],
  ['missing dev', p => { delete p.devDependencies['@deepseek-ai/dsh-llm'] }, /requires both peerDependencies/u],
  ['nonexact dev', p => { p.devDependencies['@deepseek-ai/dsh-llm'] = '^1.3.0-beta.4' }, /must be an exact SemVer/u],
  ['dev outside peer', p => { p.peerDependencies['@deepseek-ai/dsh-llm'] = '>=1.4.0 <2.0.0' }, /does not satisfy peer/u],
  ['missing engines', p => { delete p.engines }, /engines.dsh must be a non-empty valid SemVer range/u],
  ['missing dsh engine', p => { p.engines = { node: '>=24' } }, /engines.dsh must be a non-empty valid SemVer range/u],
  ['invalid engine', p => { p.engines.dsh = 'not-a-range' }, /engines.dsh must be a non-empty valid SemVer range/u],
  ['empty engine', p => { p.engines.dsh = '' }, /engines.dsh must be a non-empty valid SemVer range/u],
  ['nonstring engine', p => { p.engines.dsh = 42 }, /engines.dsh must be a non-empty valid SemVer range/u],
  ['invalid peer', p => { p.peerDependencies['@deepseek-ai/dsh-llm'] = 'not-a-range' }, /invalid peer range/u],
  ['empty peer', p => { p.peerDependencies['@deepseek-ai/dsh-llm'] = '' }, /invalid peer range/u],
  ['nonstring peer', p => { p.peerDependencies['@deepseek-ai/dsh-llm'] = 42 }, /invalid peer range/u],
  ['dsh peer replacing engines', p => { p.peerDependencies['@deepseek-ai/dsh'] = '*' }, /Use engines.dsh, not a dsh peer/u],
  ['unknown scoped classification', p => { p.devDependencies['@deepseek-ai/new-host'] = '1.0.0' }, /classify explicitly/u],
]) {
  test(`semantic CLI rejects ${title}`, t => {
    const pkg = base()
    change(pkg)
    rejects(fixture(t, [pkg]), 'policy', pattern)
  })
}

test('unused peer is not made used by test-only imports', t => {
  const root = fixture(t, [base()], ["import '@deepseek-ai/schemastery'\n"])
  writeFileSync(join(root, 'bundle-0/index.test.js'), "import '@deepseek-ai/dsh-llm'\n")
  rejects(root, 'policy', /unused peer/u)
})

test('shared runtime modules used only by tests remain dev-only', t => {
  const pkg = base()
  delete pkg.peerDependencies
  const root = fixture(t, [pkg], ["import '@deepseek-ai/schemastery'\n"])
  writeFileSync(join(root, 'bundle-0/index.test.js'), "import '@deepseek-ai/dsh-llm'\n")
  passes(root, 'eslint')
  passes(root, 'policy')
})

test('cordis ctx contract is scoped to codex-live, exact 4.0.5 is not DSH 0.x', t => {
  const pkg = base()
  pkg.name = '@local/dsh-codex-live'
  pkg.peerDependencies['@deepseek-ai/cordis'] = '4.0.5'
  pkg.devDependencies['@deepseek-ai/cordis'] = '4.0.5'
  passes(fixture(t, [pkg]), 'policy')
  pkg.name = '@local/not-codex-live'
  rejects(fixture(t, [pkg]), 'policy', /cordis: unused peer/u)
  pkg.name = '@local/dsh-codex-live'
  delete pkg.peerDependencies['@deepseek-ai/cordis']
  rejects(fixture(t, [pkg]), 'policy', /stale unused-peer host contract/u)
})

test('only Syncpack rejects cross-bundle drift when each exact dev satisfies its peer', t => {
  const a = base()
  const b = base()
  b.name = '@local/other'
  b.devDependencies['@deepseek-ai/dsh-llm'] = '1.3.0-beta.5'
  const root = fixture(t, [a, b])
  rejects(root, 'syncpack', /dsh-llm/u)
  passes(root, 'policy')
})

test('Syncpack separates peer ranges from exact dev versions, and enforces owned versions', t => {
  const a = base()
  const b = base()
  b.name = '@local/other'
  b.dependencies['@deepseek-ai/schemastery'] = '3.18.4'
  rejects(fixture(t, [a, b]), 'syncpack', /schemastery/u)
})

test('new workspace bundle is automatically checked; out-of-workspace bundle fails discovery', t => {
  const root = fixture(t)
  mkdirSync(join(root, 'new-bundle'))
  const pkg = base()
  pkg.name = '@local/new-bundle'
  json(join(root, 'new-bundle/package.json'), pkg)
  writeFileSync(join(root, 'new-bundle/index.js'), "import 'missing-package'\n")
  rejects(root, 'eslint', /must be declared in this bundle/u)
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages: ['bundle-*']\n")
  rejects(root, 'policy', /outside workspace globs/u)
})

test('root tooling cannot become a market bundle; repository discovery excludes tooling', t => {
  const bundles = discoverBundles(repo)
  assert.ok(bundles.length >= 8)
  assert.ok(bundles.every(bundle => bundle.dir !== repo))
  const tooling = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  assert.equal(tooling.private, true)
  assert.equal(tooling.dsh, undefined)
  const root = fixture(t)
  json(join(root, 'package.json'), { ...tooling, dsh: { bundle: {} } })
  rejects(root, 'policy', /market discovery would select only the root/u)
})

for (const [title, engine, peer, dev] of [
  ['raised minimum and new prerelease dev', '>=2.4.0 <3.0.0-0', '>=2.5.0-rc.2 <3.0.0-0', '2.5.0-rc.3'],
  ['tightened package range', '~1.3.2', '>=1.3.2 <1.3.4', '1.3.3'],
  ['wildcard ranges', '*', '*', '4.0.0-next.1'],
  ['cross-minor compatibility', '>=0.1.0 <0.8.0', '>=0.3.0 <0.7.0', '0.6.0'],
  ['equal engine and peer floors', '>=1.3.0-beta.2 <2.0.0-0', '>=1.3.0-beta.2 <2.0.0-0', '1.3.0-beta.4'],
]) {
  test(`semantic CLI accepts manifest-owned versions: ${title}`, t => {
    const pkg = base()
    pkg.engines.dsh = engine
    pkg.peerDependencies['@deepseek-ai/dsh-llm'] = peer
    pkg.devDependencies['@deepseek-ai/dsh-llm'] = dev
    passes(fixture(t, [pkg]), 'policy')
  })
}

for (const [peer, dev, satisfied] of [
  ['>=1.6.0-beta.2 <1.7.0-0', '1.6.0-beta.1', false],
  ['>=1.6.0-beta.2 <1.7.0-0', '1.6.0-beta.2', true],
  ['>=1.6.0-beta.2 <1.7.0-0', '1.6.0-beta.3', true],
  ['>=1.6.0-beta.2 <1.7.0-0', '1.6.0', true],
  ['>=1.6.0-beta.2 <1.7.0-0', '1.6.1-rc.1', true],
  ['>=1.6.0-beta.2 <1.7.0-0', '1.7.0-0', false],
  ['>=1.6.0-beta.2 <1.7.0-0', '1.7.0-rc.1', false],
  ['>=1.6.0-beta.2 <1.7.0-0', '1.7.0', false],
  ['>=1.6.0-beta.2 <1.7.0', '1.7.0-rc.1', true],
]) {
  test(`semantic CLI includePrerelease:true: ${dev} ${satisfied ? 'satisfies' : 'does not satisfy'} ${peer}`, t => {
    const pkg = base()
    pkg.peerDependencies['@deepseek-ai/dsh-llm'] = peer
    pkg.devDependencies['@deepseek-ai/dsh-llm'] = dev
    const root = fixture(t, [pkg])
    if (satisfied) passes(root, 'policy')
    else rejects(root, 'policy', /does not satisfy peer/u)
  })
}
