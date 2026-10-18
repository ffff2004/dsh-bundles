import { readFile, realpath, readdir, stat } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const providerName = 'local-name-mapping'
const absent = error => error.code === 'ENOENT' || error.code === 'ENOTDIR'

/** Mirror the native shallow roots; no recursive filesystem search. */
export async function resolveRoots(config, cwd, signal) {
  const roots = []
  const add = (path, source, rank) => roots.push({ path: resolve(path), source, rank })
  if (config.includeDefaultRoots && cwd !== undefined) {
    const original = resolve(cwd)
    let project = original
    for (let current = original; ; current = dirname(current)) {
      signal?.throwIfAborted()
      try { await stat(join(current, '.git')); project = current; break } catch { signal?.throwIfAborted() }
      if (dirname(current) === current) break
    }
    add(join(project, '.dsh/skills'), 'project-dsh', 100)
    add(join(project, '.agents/skills'), 'project-agents', 200)
  }
  for (const path of config.customSkillDirs) add(path, 'custom', 300)
  if (config.includeDefaultRoots) {
    add(join(config.dshHome, 'skills'), 'user-dsh', 400)
    add(join(config.agentsHome, 'skills'), 'user-agents', 500)
  }
  const bundled = config.bundledSkillDir || (config.includeDefaultRoots && process.env.DSH_BUNDLED_SKILL_DIR)
  if (bundled) add(bundled, 'bundled', 600)
  return roots
}

export function createAutoProvider(config, control, warn, parseSkill) {
  const issued = new WeakSet()
  const diagnostics = new Map()
  const watchedRoots = new Map()
  let disposed = false
  const combinedSignal = options => options.signal ? AbortSignal.any([options.signal, control.signal]) : control.signal
  function report(path, message) {
    if (diagnostics.get(path) === message) return
    // Diagnostics are a bounded cache, never a source of truth.
    if (diagnostics.size >= 256) diagnostics.delete(diagnostics.keys().next().value)
    diagnostics.set(path, message)
    warn(`skill-name-mapping: ${path}: ${message}`)
  }
  function stopRoot(watches) {
    for (const [path, changed] of watches) unwatchFile(path, changed)
  }
  function watchRoot(root) {
    if (disposed) return new Map()
    let watches = watchedRoots.get(root)
    if (watches) watchedRoots.delete(root)
    else {
      watches = new Map()
      // Bound retained project-root watchers across sessions. Eviction clears catalog caches.
      if (watchedRoots.size >= Math.max(32, config.customSkillDirs.length + 6)) {
        const [oldRoot, oldWatches] = watchedRoots.entries().next().value
        stopRoot(oldWatches)
        watchedRoots.delete(oldRoot)
        control.invalidate()
      }
    }
    watchedRoots.set(root, watches)
    watchPath(watches, root)
    return watches
  }
  function watchPath(watches, path) {
    if (disposed || watches.has(path)) return
    const changed = () => { if (!disposed) control.invalidate() }
    watchFile(path, { interval: 1000, persistent: false }, changed)
    watches.set(path, changed)
  }
  function pruneWatches(watches, paths) {
    for (const [path, changed] of watches) {
      if (paths.has(path)) continue
      unwatchFile(path, changed)
      watches.delete(path)
    }
  }
  async function load(path, source, signal) {
    signal.throwIfAborted()
    let canonical, text
    try {
      canonical = await realpath(path)
      const info = await stat(canonical)
      signal.throwIfAborted()
      if (!info.isFile()) { report(path, 'not a regular instruction file'); return }
      text = await readFile(canonical, { encoding: 'utf8', signal })
    } catch (error) {
      signal.throwIfAborted()
      if (absent(error)) return
      throw error
    }
    signal.throwIfAborted()
    try {
      const skill = parseSkill(text, canonical)
      diagnostics.delete(path)
      return { ...skill, source }
    } catch (error) {
      report(path, error.message)
    }
  }
  return {
    name: providerName,
    async list(options = {}) {
      const signal = combinedSignal(options)
      signal.throwIfAborted()
      if (disposed) return { candidates: [], complete: false }
      const roots = await resolveRoots(config, options.cwd, signal)
      const converted = []
      const lowercase = new Set()
      let complete = true
      for (const root of roots) {
        signal.throwIfAborted()
        const watches = watchRoot(root.path)
        const observed = new Set([root.path])
        try {
          let entries
          try { entries = await readdir(root.path, { withFileTypes: true }) } catch (error) {
            signal.throwIfAborted()
            if (absent(error)) { pruneWatches(watches, observed); continue }
            throw error
          }
          entries.sort((a, b) => a.name.localeCompare(b.name))
          for (const entry of entries) {
            signal.throwIfAborted()
            if (root.source === 'user-dsh' && entry.name === '.system') continue
            const path = join(root.path, entry.name)
            let info = entry
            try {
              if (entry.isSymbolicLink()) {
                // Also observe broken links so a restored/retargeted target is rediscovered.
                observed.add(path)
                watchPath(watches, path)
                info = await stat(path)
              }
              let instruction
              if (info.isDirectory()) instruction = join(path, 'SKILL.md')
              else if (info.isFile() && entry.name.endsWith('.md')) instruction = path
              else continue
              observed.add(instruction)
              watchPath(watches, instruction)
              const skill = await load(instruction, root.source, signal)
              if (!skill) continue
              if (skill.metadata.originalName === skill.name) { lowercase.add(skill.name); continue }
              const { content, ...summary } = skill
              const locator = Object.freeze({ path: instruction, originalName: skill.metadata.originalName, name: skill.name, source: root.source })
              issued.add(locator)
              converted.push({ ...summary, rank: root.rank + 1, locator })
            } catch (error) {
              signal.throwIfAborted()
              if (absent(error)) continue
              complete = false
              report(path, `read failed: ${error.message}`)
            }
          }
          pruneWatches(watches, observed)
        } catch (error) {
          signal.throwIfAborted()
          complete = false
          report(root.path, `scan failed: ${error.message}`)
        }
      }
      signal.throwIfAborted()
      if (disposed) return { candidates: [], complete: false }
      const byName = new Map()
      for (const candidate of converted) {
        const group = byName.get(candidate.name) || new Map()
        // The same symlink target may be visible through several roots.
        if (!group.has(candidate.path)) group.set(candidate.path, candidate)
        byName.set(candidate.name, group)
      }
      const candidates = []
      for (const [alias, files] of byName) {
        if (lowercase.has(alias) || files.size > 1) {
          report(`collision:${alias}`, `lowercase name collision for "${alias}"; skipping converted skills: ${[...files.keys()].join(', ')}`)
          continue
        }
        diagnostics.delete(`collision:${alias}`)
        candidates.push(files.values().next().value)
      }
      return { candidates, complete }
    },
    async get(candidate, options = {}) {
      const signal = combinedSignal(options)
      signal.throwIfAborted()
      if (disposed || !issued.has(candidate.locator) || candidate.name !== candidate.locator.name) return
      const locator = candidate.locator
      const skill = await load(locator.path, locator.source, signal)
      if (disposed) return
      if (!skill || skill.name !== candidate.name || skill.metadata.originalName !== locator.originalName) {
        control.invalidate()
        return
      }
      const fields = ['description', 'whenToUse', 'invocation', 'metadata', 'path', 'resourceBase']
      if (fields.some(key => !isDeepStrictEqual(skill[key], candidate[key]))) control.invalidate()
      return skill
    },
    dispose() {
      disposed = true
      for (const watches of watchedRoots.values()) stopRoot(watches)
      watchedRoots.clear()
      diagnostics.clear()
    },
  }
}
