import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import test from 'node:test'

// 只读文本，不加载宿主包：这样测试不依赖 @deepseek-ai/* 是否可解析。
const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

// 只匹配真实 import 语法：import/export ... from 'x' 与裸 import 'x'。
// 不会命中 import('x')、import.meta、export const a = ['@x']。
const FROM_IMPORT = /\bfrom\s*['"]([^'"]+)['"]/g
const SIDE_EFFECT = /\bimport\s*['"]([^'"]+)['"]/g

const importsOf = (source) => {
  const specifiers = new Set()
  for (const pattern of [FROM_IMPORT, SIDE_EFFECT]) {
    for (const [, specifier] of source.matchAll(pattern)) specifiers.add(specifier)
  }
  return specifiers
}

const packageOf = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

const isExternal = (specifier) =>
  !specifier.startsWith('.') &&
  !specifier.startsWith('/') &&
  !specifier.includes('://') &&
  !specifier.startsWith('node:') &&
  !builtinModules.includes(specifier)

// 递归扫描 bundle 目录下所有非测试 JS 模块，新增模块（含子目录）不会漏检。
const moduleFiles = readdirSync(new URL('.', import.meta.url), { recursive: true })
  .filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'))
  .filter((file) => !file.split('/').includes('node_modules'))
  .sort()

const importedBy = new Map()
for (const file of moduleFiles) {
  for (const specifier of importsOf(read(file))) {
    if (!isExternal(specifier)) continue
    const name = packageOf(specifier)
    if (!importedBy.has(name)) importedBy.set(name, new Set())
    importedBy.get(name).add(file)
  }
}

const manifest = JSON.parse(read('package.json'))
const peerVersions = manifest.peerDependencies ?? {}
const devVersions = manifest.devDependencies ?? {}
const peers = new Set(Object.keys(peerVersions))
const dependencies = new Set(Object.keys(manifest.dependencies ?? {}))

const imported = [...importedBy.keys()].sort()
const importers = (name) => [...(importedBy.get(name) ?? [])].sort()
const locationOf = (name) =>
  peers.has(name) ? 'peerDependencies' : dependencies.has(name) ? 'dependencies' : 'undeclared'
const dshImports = imported.filter((name) => name.startsWith('@deepseek-ai/dsh-'))
const utilImports = imported.filter(
  (name) => name.startsWith('@deepseek-ai/') && !name.startsWith('@deepseek-ai/dsh-'),
)
const thirdPartyImports = imported.filter((name) => !name.startsWith('@deepseek-ai/'))

test('scans every non-test runtime module', () => {
  assert.notEqual(moduleFiles.length, 0)
  assert.ok(moduleFiles.includes('index.js'), `scanned files: ${moduleFiles.join(', ')}`)
  assert.equal(moduleFiles.some((file) => file.endsWith('.test.js')), false)
})

test('collects imports without false positives', () => {
  const source = [
    "import { a } from '@deepseek-ai/dsh-llm'",
    "import '@deepseek-ai/dsh-session'",
    "export { b } from '@deepseek-ai/dsh-session/sub'",
    "import z from '@deepseek-ai/schemastery'",
    "import { c } from '@earendil-works/pi-ai/providers/all'",
    "export const PEERS = ['@deepseek-ai/dsh-timeout']",
    "import('@deepseek-ai/dsh-scope')",
    "import { x } from 'node:fs'",
    "import { y } from './local.js'",
  ].join('\n')
  const packages = [...new Set([...importsOf(source)].filter(isExternal).map(packageOf))].sort()
  assert.deepEqual(packages, [
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/schemastery',
    '@earendil-works/pi-ai',
  ])
})

test('every imported dsh package is declared as a peer', () => {
  // dsh-* 包必须与宿主共享实例（自带副本会破坏 LlmError 的 instanceof），因此只能在 peers。
  const misplaced = dshImports
    .filter((name) => !peers.has(name))
    .map((name) => `${importers(name).join(', ')} imports ${name} (${locationOf(name)})`)
  assert.deepEqual(misplaced, [], `runtime modules importing packages that must be peerDependencies: ${misplaced.join('; ')}`)
})

test('every imported @deepseek-ai utility package is a dependency', () => {
  // 无状态工具包（schemastery）按 AGENTS.md 只能放 dependencies，不能当 peer。
  const misplaced = utilImports
    .filter((name) => !dependencies.has(name))
    .map((name) => `${importers(name).join(', ')} imports ${name} (${locationOf(name)})`)
  assert.deepEqual(misplaced, [], `runtime modules importing packages that must be dependencies: ${misplaced.join('; ')}`)
})

test('every imported third-party package is a dependency', () => {
  // 第三方库（@earendil-works/pi-ai）同样属于 dependencies。
  const misplaced = thirdPartyImports
    .filter((name) => !dependencies.has(name))
    .map((name) => `${importers(name).join(', ')} imports ${name} (${locationOf(name)})`)
  assert.deepEqual(misplaced, [], `runtime modules importing packages that must be dependencies: ${misplaced.join('; ')}`)
})

test('peerDependencies lists only imported packages', () => {
  // @deepseek-ai/cordis 是唯一的豁免：宿主运行时，插件只通过 ctx 使用，从不直接 import。
  const unused = [...peers].filter((name) => name !== '@deepseek-ai/cordis' && !importedBy.has(name)).sort()
  assert.deepEqual(unused, [], `peerDependencies entries that no runtime module imports: ${unused.join(', ')}`)
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
