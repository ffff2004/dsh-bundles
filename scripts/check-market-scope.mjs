#!/usr/bin/env node
import { resolve } from 'node:path'
import { discoverBundles } from './dependency-policy.mjs'
import { isMarketPackageName, MARKET_SCOPE } from './market-policy.mjs'

const root = resolve(process.argv[2] ?? '.')
const errors = []
try {
  const bundles = discoverBundles(root)
  for (const bundle of bundles) {
    if (!isMarketPackageName(bundle.manifest.name)) {
      errors.push(`${bundle.path}/package.json: bundle name must use ${MARKET_SCOPE} (found ${bundle.manifest.name})`)
    }
  }
  if (!errors.length) console.log(`Market scope passed: ${bundles.length} bundles use ${MARKET_SCOPE}`)
} catch (error) {
  errors.push(error.message)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
