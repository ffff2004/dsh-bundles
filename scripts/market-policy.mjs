import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { discoverBundles } from './dependency-policy.mjs'
import { readJson, repoRoot } from './market-source.mjs'

// Deliberate allowlist: new bundle identities require an explicit policy change.
export const packageNames = Object.freeze([
  'background-wait-guidance', 'codex-live', 'lean-preset', 'preview-download', 'preview-path',
  'shell-description', 'shell-timeout-guidance', 'skill-name-mapping', 'zotero-select',
].map(name => `@ffff2004-dsh-bundles/${name}`).sort())

export function currentPackages() {
  const bundles = discoverBundles(repoRoot)
  const names = bundles.map(bundle => bundle.manifest.name).sort()
  if (JSON.stringify(names) !== JSON.stringify(packageNames)) throw new Error('Current bundle identities differ from the nine-package market policy')
  return new Map(bundles.map(bundle => [bundle.manifest.name, bundle.path]))
}

/** Additional repository policy after the original shared format-1 validator. No JSON filtering. */
export function validateMarket({ output, sourceUrl, refs, parseMarketIndex, releaseTag, releaseCommit, allowEmpty = false }) {
  const index = readJson(output)
  parseMarketIndex(index, 'https://market.invalid/index.json')
  if (!allowEmpty && index.plugins.length === 0) throw new Error('Refusing an empty market (no eligible releases yet?)')
  const paths = currentPackages()
  for (const plugin of index.plugins) {
    if (!paths.has(plugin.name)) throw new Error(`Disallowed package identity: ${plugin.name}`)
    if (plugin.icon?.startsWith('icons/') && !existsSync(join(dirname(output), plugin.icon))) throw new Error(`Missing icon: ${plugin.icon}`)
    for (const version of plugin.versions) {
      const tag = `${plugin.name}@${version.version}`
      if (semver.valid(version.version) !== version.version.replace(/\+.*$/u, '') || version.source.type !== 'git'
        || version.source.url !== sourceUrl || version.source.path !== paths.get(plugin.name)
        || refs.tags.get(tag) !== version.source.commit) {
        throw new Error(`Version must match its package tag, source and current directory: ${tag}`)
      }
    }
  }
  if ((releaseTag === undefined) !== (releaseCommit === undefined)) throw new Error('Supply both --release-tag and --release-commit')
  if (releaseTag !== undefined && !index.plugins.some(plugin => plugin.versions.some(version =>
    `${plugin.name}@${version.version}` === releaseTag && version.source.commit === releaseCommit))) {
    throw new Error(`Release tag was not indexed at the requested commit: ${releaseTag}`)
  }
  return index
}
