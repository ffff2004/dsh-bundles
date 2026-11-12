import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'
import { parse } from 'yaml'

function git(cwd, args, allowed = [0]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (!allowed.includes(result.status)) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result
}

function commit(cwd, ref) {
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('release-ref is required')
  return git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).stdout.trim()
}

function exactVersion(version) {
  const parsed = semver.parse(version)
  return parsed && `${parsed.version}${parsed.build.length ? `+${parsed.build.join('.')}` : ''}` === version
}

function bundles(cwd, ref) {
  const paths = git(cwd, ['ls-tree', '-r', '--name-only', '-z', ref]).stdout.split('\0')
  const found = new Map()
  for (const path of paths.filter(path => path.endsWith('/package.json'))) {
    const manifest = JSON.parse(git(cwd, ['show', `${ref}:${path}`]).stdout)
    if (manifest.dsh?.bundle !== undefined) found.set(path, manifest)
  }
  return found
}

function consumedPackages(cwd, parent, ref) {
  const deleted = git(cwd, ['diff', '--no-renames', '--diff-filter=D', '--name-only', '-z', parent, ref]).stdout.split('\0')
  const names = new Set()
  for (const path of deleted.filter(path => /^\.changeset\/[^/]+\.md$/u.test(path) && path !== '.changeset/README.md')) {
    const text = git(cwd, ['show', `${parent}:${path}`]).stdout
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
    if (!frontmatter) throw new Error(`Consumed changeset has no frontmatter: ${path}`)
    const releases = parse(frontmatter[1])
    if (releases === null) continue // Changesets also supports intentionally empty changesets.
    if (typeof releases !== 'object' || Array.isArray(releases)) throw new Error(`Invalid changeset: ${path}`)
    for (const [name, type] of Object.entries(releases)) {
      if (!['patch', 'minor', 'major'].includes(type)) throw new Error(`Invalid release type in ${path}: ${name}`)
      names.add(name)
    }
  }
  return names
}

// All discovery reads Git objects, never the potentially different checked-out tree.
// R^1 is essential: a merge's other parents already contain the version changes.
export function planRelease({ cwd = process.cwd(), releaseRef, mainRef = 'refs/remotes/origin/main' }) {
  const ref = commit(cwd, releaseRef)
  const main = commit(cwd, mainRef)
  if (git(cwd, ['merge-base', '--is-ancestor', ref, main], [0, 1]).status !== 0) {
    throw new Error('release-ref must be an ancestor of trusted main')
  }
  const parent = git(cwd, ['rev-list', '--parents', '-n', '1', ref]).stdout.trim().split(' ')[1]
  const packages = []
  if (parent) {
    const previous = bundles(cwd, parent)
    const consumed = consumedPackages(cwd, parent, ref)
    const names = new Set()
    for (const [path, manifest] of bundles(cwd, ref)) {
      if (names.has(manifest.name)) throw new Error(`Duplicate bundle name: ${manifest.name}`)
      names.add(manifest.name)
      const before = previous.get(path)
      // Initial package additions and scope-only migration are not releases.
      if (!before || before.version === manifest.version) continue
      if (before.name !== manifest.name) throw new Error(`Cannot rename and release a bundle together: ${path}`)
      if (!exactVersion(before.version) || !exactVersion(manifest.version)
        || !semver.gt(manifest.version, before.version)) {
        throw new Error(`Bundle version must increase with valid SemVer: ${manifest.name}`)
      }
      if (manifest.private !== true) throw new Error(`Release bundles must remain private: ${manifest.name}`)
      if (!consumed.has(manifest.name)) throw new Error(`Version change has no consumed changeset: ${manifest.name}`)
      const tag = `${manifest.name}@${manifest.version}`
      git(cwd, ['check-ref-format', `refs/tags/${tag}`])
      packages.push({ name: manifest.name, version: manifest.version, previousVersion: before.version, path, tag })
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name))
  return { isRelease: packages.length > 0, releaseRef: ref, releaseTags: packages.map(pkg => pkg.tag), packages }
}

// Validate the entire remote batch before any writes. Explicit SHA:tag refspecs
// need no local tags; --atomic prevents partial publication or moving a raced tag.
export function publishRelease(options) {
  const cwd = options.cwd ?? process.cwd()
  const plan = planRelease(options)
  if (!plan.isRelease) throw new Error('release-ref has no valid release diff')
  const lines = git(cwd, ['ls-remote', '--tags', 'origin']).stdout.trim().split('\n').filter(Boolean)
  const remote = new Map(lines.map(line => line.split(/\s+/u).reverse()))
  const missing = []
  for (const tag of plan.releaseTags) {
    const name = `refs/tags/${tag}`
    const existing = remote.get(`${name}^{}`) ?? remote.get(name)
    if (existing && existing !== plan.releaseRef) throw new Error(`Tag ${tag} already points to another commit: ${existing}`)
    if (!existing) missing.push(`${plan.releaseRef}:${name}`)
  }
  if (missing.length) git(cwd, ['push', '--atomic', 'origin', ...missing])
  return plan
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!['plan', 'publish'].includes(command)) throw new Error('Usage: release.mjs plan|publish --release-ref <ref> [--main-ref <ref>]')
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--release-ref', '--main-ref'].includes(args[i]) || !args[i + 1]) throw new Error(`Invalid argument: ${args[i]}`)
    options[args[i] === '--release-ref' ? 'releaseRef' : 'mainRef'] = args[i + 1]
  }
  const plan = command === 'publish' ? publishRelease(options) : planRelease(options)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `is-release=${plan.isRelease}\nrelease-ref=${plan.releaseRef}\nrelease-tags=${JSON.stringify(plan.releaseTags)}\n`)
  }
  console.log(JSON.stringify(plan))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
