import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { marketPolicy, repoRoot, withGenerator } from './market-source.mjs'

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    upstream: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, cache: { type: 'string' },
    'release-tag': { type: 'string' }, 'release-commit': { type: 'string' }, 'allow-empty': { type: 'boolean', default: false },
  } })
  const [command] = positionals
  if (positionals.length !== 1 || !['generate', 'validate', 'test'].includes(command) || !values.upstream) {
    throw new Error('Usage: node scripts/market.mjs <generate|validate|test> --upstream <pinned-checkout> [--input <list> --output <index> --cache <base-dir>] [--allow-empty] [--release-tag <tag> --release-commit <sha>]')
  }
  if (command !== 'test' && (!values.input || !values.output || !values.cache)) throw new Error('generate/validate require --input, --output and --cache')
  const request = { command, ...values }
  for (const key of ['input', 'output', 'cache']) if (request[key]) request[key] = resolve(request[key])
  if (request.cache) request.cache = resolve(request.cache, marketPolicy)
  await withGenerator(resolve(values.upstream), ({ scratch, tsx, tsconfig }) => {
    const args = command === 'test'
      ? ['--test', resolve(repoRoot, 'scripts/market.integration.mjs')]
      : [resolve(repoRoot, 'scripts/market-worker.mjs')]
    const result = spawnSync(process.execPath, [tsx, '--tsconfig', tsconfig, ...args], {
      cwd: repoRoot, stdio: 'inherit', env: { ...process.env, DSH_MARKET_SOURCE: scratch, DSH_MARKET_REQUEST: JSON.stringify(request) },
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
}
