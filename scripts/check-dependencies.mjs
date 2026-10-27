import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Linter } from 'eslint'
import semver from 'semver'
import {
  discoverBundles, importVisitors, isTestFile, ownedPackages, packageName,
  sharedPackages, sourceFiles, unusedPeerContracts,
} from './dependency-policy.mjs'

const options = { includePrerelease: true }
const validRange = range => typeof range === 'string' && range.trim() !== ''
  && semver.validRange(range, options) !== null
const root = resolve(process.argv[2] ?? '.')
const errors = []
let files = 0

try {
  const bundles = discoverBundles(root)
  for (const bundle of bundles) {
    const { manifest: pkg } = bundle
    const fail = message => errors.push(`${bundle.path}/package.json: ${message}`)
    const deps = pkg.dependencies ?? {}
    const peers = pkg.peerDependencies ?? {}
    const dev = pkg.devDependencies ?? {}
    const runtimeImports = new Set()
    const linter = new Linter()
    for (const file of sourceFiles(bundle.dir)) {
      files++
      const collector = {
        meta: { schema: [] },
        create(context) {
          return importVisitors(context, specifier => {
            const name = packageName(specifier)
            if (name && !isTestFile(file)) runtimeImports.add(name)
          })
        },
      }
      const messages = linter.verify(readFileSync(join(bundle.dir, file), 'utf8'), {
        plugins: { inventory: { rules: { imports: collector } } },
        rules: { 'inventory/imports': 'error' },
      }, { filename: file })
      for (const message of messages) {
        errors.push(`${bundle.path}/${file}:${message.line}: ${message.message}`)
      }
    }
    if (!validRange(pkg.engines?.dsh)) fail('engines.dsh must be a non-empty valid SemVer range')
    if ('@deepseek-ai/dsh' in peers) fail('Use engines.dsh, not a dsh peer')
    const declared = new Set([
      ...Object.keys(deps), ...Object.keys(peers), ...Object.keys(dev),
      ...Object.keys(pkg.optionalDependencies ?? {}), ...runtimeImports,
    ])
    for (const name of declared) {
      if (name.startsWith('@deepseek-ai/') && !sharedPackages.has(name) && !ownedPackages.has(name)) {
        fail(`${name}: classify explicitly as shared-instance or owned/stateless`)
      }
      if (!sharedPackages.has(name)) continue
      if (name in deps || name in (pkg.optionalDependencies ?? {})) {
        fail(`${name}: shared-instance packages belong in peerDependencies + devDependencies, never dependencies/optionalDependencies`)
      }
      if ((runtimeImports.has(name) || name in peers) && (!(name in peers) || !(name in dev))) {
        fail(`${name}: runtime shared-instance use requires both peerDependencies + devDependencies`)
      }
      if (name in dev) {
        if (!semver.valid(dev[name])) fail(`${name}: devDependency must be an exact SemVer`)
      }
    }
    for (const [name, range] of Object.entries(peers)) {
      if (!sharedPackages.has(name)) fail(`${name}: peers must be explicitly classified shared-instance packages`)
      if (!validRange(range)) fail(`${name}: invalid peer range ${range}`)
      else if (!semver.valid(dev[name]) || !semver.satisfies(dev[name], range, options)) {
        fail(`${name}: exact dev ${dev[name]} does not satisfy peer ${range} (includePrerelease:true)`)
      }
      if (!runtimeImports.has(name) && !unusedPeerContracts[pkg.name]?.[name]) {
        fail(`${name}: unused peer (production import or explicit host contract required)`)
      }
    }
    for (const name of Object.keys(unusedPeerContracts[pkg.name] ?? {})) {
      if (!(name in peers) || runtimeImports.has(name)) fail(`${name}: stale unused-peer host contract; remove or update its exception`)
    }
  }
  if (!errors.length) console.log(`Dependency policy passed: ${bundles.length} bundles, ${files} source files; root tooling excluded`)
} catch (error) {
  errors.push(error.message)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
