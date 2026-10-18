import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { parseDocument } from 'yaml'
import z from '@deepseek-ai/schemastery'
import { createAutoProvider, resolveRoots } from './discovery.js'

export { resolveRoots }
export const name = 'skill-name-mapping'
export const inject = ['skills']
const grammar = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const providerName = 'local-name-mapping'

export const Config = z.object({
  includeDefaultRoots: z.boolean().default(true).description('Scan project and user skill roots, plus DSH_BUNDLED_SKILL_DIR when set.'),
  customSkillDirs: z.array(z.string().min(1).required()).default([]).description('Additional local skill roots; absolute paths or ~/ paths.'),
  dshHome: z.string().default(process.env.DSH_HOME || join(homedir(), '.dsh')).description('DSH home; its skills directory is scanned.'),
  agentsHome: z.string().default(process.env.DSH_AGENTS_HOME || join(homedir(), '.agents')).description('Agents home; its skills directory is scanned.'),
  bundledSkillDir: z.string().default('').description('Optional additional bundled skill root.'),
})

function invocationBoolean(data, key, fallback) {
  if (!Object.hasOwn(data, key)) return fallback
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 0) return false
  if (typeof value === 'string') {
    if (/^(true|yes|on|1)$/i.test(value)) return true
    if (/^(false|no|off|0)$/i.test(value)) return false
  }
  throw new Error(`invalid invocation field ${key}`)
}

/** Parse the source without changing its body or accepting arbitrary YAML tags. */
export function parseMappedSkill(text, resolvedPath) {
  const match = /^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)([\s\S]*)$/.exec(text)
  if (!match) throw new Error('missing YAML frontmatter')
  const document = parseDocument(match[1], { customTags: [] })
  if (document.errors.length || document.warnings.length) throw new Error(`invalid YAML: ${(document.errors[0] ?? document.warnings[0]).message}`)
  const data = document.toJS({ maxAliasCount: 50 })
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter must be an object')
  for (const key of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (Object.hasOwn(data, key)) throw new Error(`unsupported invocation field ${key}`)
  }
  if (typeof data.name !== 'string' || !data.name) throw new Error('name must be a non-empty string')
  const alias = data.name.replace(/[A-Z]/g, letter => letter.toLowerCase())
  if (!grammar.test(alias)) throw new Error(`name remains invalid after ASCII lowercasing: ${JSON.stringify(data.name)}`)
  if (typeof data.description !== 'string' || !data.description.trim()) throw new Error('description must be a non-empty string')
  if (data.whenToUse !== undefined && typeof data.whenToUse !== 'string') throw new Error('whenToUse must be a string')
  return {
    name: alias,
    description: data.description.trim(),
    ...(data.whenToUse !== undefined ? { whenToUse: data.whenToUse } : {}),
    invocation: {
      modelInvocable: !invocationBoolean(data, 'disable-model-invocation', false),
      userInvocable: invocationBoolean(data, 'user-invocable', true),
    },
    source: 'custom',
    provider: providerName,
    path: resolvedPath,
    resourceBase: { kind: 'directory', path: dirname(resolvedPath) },
    metadata: {
      ...(data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : {}),
      originalName: data.name,
      mappedBy: providerName,
    },
    content: match[2].trim(),
  }
}

export function resolveConfig(config = {}) {
  const keys = ['includeDefaultRoots', 'customSkillDirs', 'dshHome', 'agentsHome', 'bundledSkillDir']
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !keys.includes(key))) throw new Error('invalid automatic-lowercase configuration; explicit mappings are no longer supported')
  const result = Config(config)
  function absolute(path) {
    const expanded = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
    if (!isAbsolute(expanded)) throw new Error(`skill root requires an absolute path: ${path}`)
    return normalize(expanded)
  }
  return {
    ...result,
    customSkillDirs: result.customSkillDirs.map(absolute),
    dshHome: absolute(result.dshHome),
    agentsHome: absolute(result.agentsHome),
    bundledSkillDir: result.bundledSkillDir ? absolute(result.bundledSkillDir) : '',
  }
}

export function createProvider(config, control, warn) {
  return createAutoProvider(resolveConfig(config), control, warn, parseMappedSkill)
}

export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  let provider
  ctx.skills.registerProvider(control => {
    provider = createAutoProvider(resolved, control, message => ctx.logger.warn(message), parseMappedSkill)
    return provider
  })
  ctx.effect(() => () => provider.dispose())
}
