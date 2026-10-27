import { globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { parse } from 'yaml'

// Identity-bearing host modules. Classification is explicit, not an npm-scope rule.
export const sharedPackages = new Set([
  '@deepseek-ai/cordis',
  ...[
    'agent', 'agent-instructions', 'agent-tool-presentation',
    'compaction-tool-result-pruner', 'launch-environment', 'llm', 'llm-pi-ai',
    'persona', 'scope', 'skill-filesystem', 'system-prompt', 'tool-bash',
    'tool-subagent', 'tool-web', 'tools',
  ].map(name => `@deepseek-ai/dsh-${name}`),
])
export const ownedPackages = new Set(['@deepseek-ai/schemastery'])
export const unusedPeerContracts = {
  '@local/dsh-codex-live': {
    '@deepseek-ai/cordis': 'The host supplies the Cordis ctx passed to apply(); no direct import is needed.',
  },
}

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const excluded = ['**/node_modules/**', '**/.git/**', '**/.dsh-source/**', '**/_site/**', '**/.plugin-market-cache/**']
export const sourceFiles = dir => globSync('**/*.{js,mjs,cjs}', { cwd: dir, exclude: excluded }).sort()
// Paths are relative to the bundle root. Only root test locations get dev-only access.
export const isTestFile = file => /^(?:tests?|__tests__)\//u.test(file)
  || /^[^/]+\.test\.(?:js|mjs|cjs)$/u.test(file)
export function packageName(specifier) {
  if (isBuiltin(specifier) || /^(?:[./#]|[a-z][a-z\d+.-]*:)/iu.test(specifier)) return undefined
  return specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
}

// One discovery seam shared by ESLint and the semantic CLI. Scan independently of
// workspace globs too: a newly moved/added bundle must not silently escape lint.
export function discoverBundles(root) {
  root = resolve(root)
  const tooling = readJson(join(root, 'package.json'))
  if (tooling.dsh?.bundle !== undefined) {
    throw new Error('Root tooling must not declare dsh.bundle (market discovery would select only the root)')
  }
  const patterns = parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).packages
  if (!Array.isArray(patterns) || patterns.some(p => typeof p !== 'string' || p.startsWith('!'))) {
    throw new Error('Use positive workspace globs shared with market discovery')
  }
  const workspaceDirs = new Set(globSync(patterns, { cwd: root, exclude: excluded }).map(p => resolve(root, p)))
  const bundles = []
  const names = new Set([tooling.name])
  for (const file of globSync('**/package.json', { cwd: root, exclude: excluded }).sort()) {
    if (file === 'package.json') continue
    const manifest = readJson(join(root, file))
    if (manifest.dsh?.bundle === undefined) continue
    const dir = resolve(root, file, '..')
    if (!workspaceDirs.has(dir)) throw new Error(`${file}: bundle is outside workspace globs`)
    if (!manifest.name || names.has(manifest.name)) throw new Error(`${file}: missing or duplicate bundle name`)
    names.add(manifest.name)
    bundles.push({ dir, path: relative(root, dir), manifest })
  }
  if (!bundles.length) throw new Error('No workspace bundles discovered')
  return bundles
}

export function isNodeRequire(context, node) {
  if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return false
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    if (scope.set.get('require')?.defs.length) return false
  }
  return true
}

// ESLint supplies the AST and scopes; no regex import parsing or module resolver.
export function importVisitors(context, visit) {
  const source = node => {
    if (node.source?.type === 'Literal' && typeof node.source.value === 'string') visit(node.source.value, node)
  }
  return {
    ImportDeclaration: source,
    ExportNamedDeclaration: source,
    ExportAllDeclaration: source,
    ImportExpression: source,
    CallExpression(node) {
      if (isNodeRequire(context, node) && node.arguments.length === 1
        && node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string') {
        visit(node.arguments[0].value, node)
      }
    },
  }
}
