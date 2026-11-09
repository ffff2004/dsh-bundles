import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { currentPackages, packageNames, validateMarket } from './market-policy.mjs'
import { generatorPath } from './market-source.mjs'

const upstream = process.env.DSH_MARKET_SOURCE
const load = path => import(pathToFileURL(join(upstream, path)).href)
const { main } = await load(`${generatorPath}/src/cli.ts`)
const { parseSources } = await load(`${generatorPath}/src/sources.ts`)
const { gitRefs } = await load(`${generatorPath}/src/fetchers.ts`)
const { parseMarketIndex } = await load('packages/util/plugin-market-index/src/index.ts')
const request = JSON.parse(process.env.DSH_MARKET_REQUEST)
currentPackages()
const sources = parseSources(readFileSync(request.input, 'utf8'))
if (sources.length !== 1 || sources[0].kind !== 'git') throw new Error('This market requires exactly one Git repository source')
if ((request['release-tag'] === undefined) !== (request['release-commit'] === undefined)) throw new Error('Supply both release tag and commit')
const status = request.command === 'generate' ? await main([
  '--input', request.input, '--output', request.output, '--cache', request.cache,
  '--title', 'ffff2004 DSH Bundles', '--description', 'Personal DeepSeek Harness bundles by ffff2004',
  '--package-tags-only', packageNames.join(','),
]) : 0
if (status !== 0) process.exitCode = status
else {
  const refs = await gitRefs(sources[0].url, ['https', 'ssh'], { timeoutMs: 60000, maxTarballBytes: 64 * 1024 * 1024 })
  const index = validateMarket({
    output: request.output, sourceUrl: sources[0].url, refs, parseMarketIndex,
    releaseTag: request['release-tag'], releaseCommit: request['release-commit'], allowEmpty: request['allow-empty'],
  })
  console.log(`Validated package-tags-only market: ${index.plugins.length} plugins`)
}
