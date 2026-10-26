import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// 只读文本，不加载宿主包：这样测试不依赖 @deepseek-ai/* 是否可解析。
const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

// 静态 import/export ... from '...'；动态 import() 与 ctx.get('服务名') 不在覆盖范围。
const STATIC_IMPORT = /^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm

const manifest = JSON.parse(read('package.json'))
const peers = new Set(Object.keys(manifest.peerDependencies ?? {}))
const dependencies = new Set(Object.keys(manifest.dependencies ?? {}))

const imported = new Set()
for (const [, specifier] of read('index.js').matchAll(STATIC_IMPORT)) {
  if (!specifier.startsWith('@deepseek-ai/')) continue
  // 子路径 import（@scope/pkg/sub）仍然需要声明 @scope/pkg 本身。
  imported.add(specifier.split('/').slice(0, 2).join('/'))
}

test('every imported @deepseek-ai package is declared as a peer', () => {
  // 无状态工具包（如 @deepseek-ai/schemastery）由本包自带，按约定放 dependencies；
  // 其余直接 import 的 dsh 包必须与宿主共享实例，因此必须在 peerDependencies。
  const missing = [...imported].filter((name) => !dependencies.has(name) && !peers.has(name)).sort()
  assert.deepEqual(missing, [], `index.js imports without a peerDependencies entry: ${missing.join(', ')}`)
})

test('peerDependencies lists only imported packages', () => {
  // @deepseek-ai/cordis 是宿主运行时：插件只通过 ctx 使用它，从不直接 import。
  const unused = [...peers].filter((name) => name !== '@deepseek-ai/cordis' && !imported.has(name)).sort()
  assert.deepEqual(unused, [], `peerDependencies entries that index.js never imports: ${unused.join(', ')}`)
})

test('dependencies and peerDependencies do not overlap', () => {
  const overlap = [...dependencies].filter((name) => peers.has(name)).sort()
  assert.deepEqual(overlap, [], `packages declared in both dependencies and peerDependencies: ${overlap.join(', ')}`)
})
