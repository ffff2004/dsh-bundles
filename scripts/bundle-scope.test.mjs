import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { MARKET_SCOPE } from './market-policy.mjs'

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'check-market-scope.mjs')

function fixture(t, names) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-market-scope-'))
  t.after(() => {
    assert.equal(dirname(root), tmpdir())
    assert.ok(root.startsWith(join(tmpdir(), 'dsh-market-scope-')))
    rmSync(root, { recursive: true, force: true })
  })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-bundles-tooling', private: true }))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages: ['*']\n")
  names.forEach((name, index) => {
    const dir = join(root, `bundle-${index}`)
    mkdirSync(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name, version: '1.0.0', private: true, dsh: { bundle: {} },
    }))
  })
  return root
}

function run(root) {
  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' })
  assert.ifError(result.error)
  return { status: result.status, output: result.stdout + result.stderr }
}

test('accepts bundles in the market scope', t => {
  const result = run(fixture(t, [`${MARKET_SCOPE}alpha`, `${MARKET_SCOPE}beta`]))
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /2 bundles/u)
})

for (const name of ['@local/dsh-alpha', '@other/alpha', `${MARKET_SCOPE}UPPER`, MARKET_SCOPE]) {
  test(`rejects out-of-scope bundle name: ${name}`, t => {
    const result = run(fixture(t, [name]))
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /bundle name must use @ffff2004-dsh-packages\//u)
  })
}
