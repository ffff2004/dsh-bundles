import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// 只读文本，不加载宿主包：这样测试不依赖 @deepseek-ai/* 是否可解析。
const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

// 静态 import/export（含裸副作用 import 与 export ... from）；
// 动态 import()、import.meta 与 ctx.get('服务名') 不在覆盖范围。
const STATIC_IMPORT = /^\s*(?:import|export)\b(?!\s*[.(])[^'"]*?(?:from\s*)?['"]([^'"]+)['"]/gm

const dshImportsOf = (source) => {
  const names = new Set()
  for (const [, specifier] of source.matchAll(STATIC_IMPORT)) {
    if (!specifier.startsWith('@deepseek-ai/')) continue
    // 子路径 import（@scope/pkg/sub）仍然需要声明 @scope/pkg 本身。
    names.add(specifier.split('/').slice(0, 2).join('/'))
  }
  return names
}

const manifest = JSON.parse(read('package.json'))
const peerVersions = manifest.peerDependencies ?? {}
const devVersions = manifest.devDependencies ?? {}
const peers = new Set(Object.keys(peerVersions))
const dependencies = new Set(Object.keys(manifest.dependencies ?? {}))

const imported = dshImportsOf(read('index.js'))

test('collects bare and re-exported imports', () => {
  const source = [
    "import { a } from '@deepseek-ai/dsh-llm'",
    "import '@deepseek-ai/dsh-session'",
    "export { b } from '@deepseek-ai/dsh-session/sub'",
    "import z from '@deepseek-ai/schemastery'",
    "import('@deepseek-ai/dsh-scope')",
    "import { x } from 'node:fs'",
  ].join('\n')
  assert.deepEqual(
    [...dshImportsOf(source)].sort(),
    ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/schemastery'],
  )
})

test('every imported dsh package is declared as a peer', () => {
  // dsh-* 包必须与宿主共享实例（自带副本会破坏 LlmError 的 instanceof），因此只能在 peers。
  const misplaced = [...imported]
    .sort()
    .filter((name) => name.startsWith('@deepseek-ai/dsh-') && !peers.has(name))
    .map((name) => `${name} (${dependencies.has(name) ? 'dependencies' : 'undeclared'})`)
  assert.deepEqual(misplaced, [], `index.js imports that must be peerDependencies: ${misplaced.join(', ')}`)
})

test('imported non-dsh packages come from dependencies', () => {
  // 无状态工具包（schemastery）按 AGENTS.md 只能放 dependencies，不能当 peer。
  const misplaced = [...imported]
    .sort()
    .filter((name) => !name.startsWith('@deepseek-ai/dsh-') && !dependencies.has(name))
    .map((name) => `${name} (${peers.has(name) ? 'peerDependencies' : 'undeclared'})`)
  assert.deepEqual(misplaced, [], `index.js imports that must be dependencies: ${misplaced.join(', ')}`)
})

test('peerDependencies lists only imported packages', () => {
  // @deepseek-ai/cordis 是唯一的豁免：宿主运行时，插件只通过 ctx 使用，从不直接 import。
  const unused = [...peers].filter((name) => name !== '@deepseek-ai/cordis' && !imported.has(name)).sort()
  assert.deepEqual(unused, [], `peerDependencies entries that index.js never imports: ${unused.join(', ')}`)
})

test('dependencies and peerDependencies do not overlap', () => {
  const overlap = [...dependencies].filter((name) => peers.has(name)).sort()
  assert.deepEqual(overlap, [], `packages declared in both dependencies and peerDependencies: ${overlap.join(', ')}`)
})

test('every peer is pinned to the same version in devDependencies', () => {
  const mismatched = [...peers]
    .sort()
    .filter((name) => devVersions[name] !== peerVersions[name])
    .map((name) => `${name} (peer ${peerVersions[name]}, dev ${devVersions[name] ?? '<missing>'})`)
  assert.deepEqual(mismatched, [], `peer/devDependencies version mismatch: ${mismatched.join(', ')}`)
})
