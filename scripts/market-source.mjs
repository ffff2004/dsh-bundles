import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const upstreamRevision = '687f282e8625c6b8d11ff58211a90524be2e4317'
export const marketPolicy = 'package-tags-only-v1'
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const generatorPath = 'apps/plugin-market-generator'
const validatorPath = 'packages/util/plugin-market-index'
export const patchPath = join(repoRoot, 'scripts/patches/market-package-tags-only.patch')

export function git(cwd, args, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', ...options })
}

export function removeScratch(path) {
  const absolute = realpathSync(path)
  if (dirname(absolute) !== realpathSync(tmpdir()) || !absolute.startsWith(join(realpathSync(tmpdir()), 'dsh-market-'))) {
    throw new Error(`Refusing to remove unexpected scratch directory: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

/** Require an explicit pinned checkout; never patch or install into that checkout. */
export function verifyUpstream(upstream) {
  const source = realpathSync(upstream)
  if (git(source, ['rev-parse', 'HEAD']).trim() !== upstreamRevision) {
    throw new Error(`Generator checkout must be at ${upstreamRevision}`)
  }
  const paths = [generatorPath, validatorPath, 'pnpm-lock.yaml', 'package.json']
  if (git(source, ['status', '--porcelain', '--untracked-files=no', '--', ...paths]).trim()) {
    throw new Error('Generator source/dependency manifests have tracked changes; refusing drift')
  }
  const tsx = join(source, generatorPath, 'node_modules/tsx/dist/cli.mjs')
  if (!existsSync(tsx)) throw new Error('Install the pinned upstream generator dependencies first (see publishing notes)')
  return { source, tsx }
}

export async function withGenerator(upstream, work) {
  const { source, tsx } = verifyUpstream(upstream)
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-market-source-'))
  try {
    const archive = git(source, ['archive', '--format=tar', upstreamRevision, generatorPath, validatorPath], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
    execFileSync('tar', ['--no-same-owner', '-xf', '-', '-C', scratch], { input: archive })
    // Check the exact archived revision before applying; never accept offset/fuzz on another checkout.
    git(scratch, ['apply', '--check', patchPath])
    git(scratch, ['apply', patchPath])
    for (const path of [generatorPath, validatorPath]) {
      symlinkSync(join(source, path, 'node_modules'), join(scratch, path, 'node_modules'), 'dir')
    }
    writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}\n')
    const tsconfig = join(scratch, 'tsconfig.market.json')
    writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { baseUrl: scratch, paths: {
      '@deepseek-ai/dsh-plugin-market-index': [`${validatorPath}/src/index.ts`],
    } } }))
    return await work({ scratch, tsx, tsconfig })
  } finally {
    removeScratch(scratch)
  }
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
