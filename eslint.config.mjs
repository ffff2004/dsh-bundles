import { relative } from 'node:path'
import importX from 'eslint-plugin-import-x'
import {
  discoverBundles, importVisitors, isNodeRequire, isTestFile, packageName,
} from './scripts/dependency-policy.mjs'

const extraneous = importX.rules['no-extraneous-dependencies']
// Upstream's CommonJS visitor also visits factory(require) browser loaders.
// Keep its established declaration rule, adapting only lexical require scope.
const scopedExtraneous = {
  ...extraneous,
  create(context) {
    const visitors = extraneous.create(context)
    return {
      ...visitors,
      CallExpression(node) {
        if (isNodeRequire(context, node)) visitors.CallExpression?.(node)
      },
    }
  },
}

function ownManifestRule(bundle) {
  return {
    meta: { schema: [], messages: { missing: '{{name}} must be declared in this bundle\'s {{fields}} (no root/dev-only fallback)' } },
    create(context) {
      const test = isTestFile(relative(bundle.dir, context.filename))
      const fields = ['dependencies', 'peerDependencies', ...(test ? ['devDependencies'] : [])]
      return importVisitors(context, (specifier, node) => {
        const name = packageName(specifier)
        if (!name || name === bundle.manifest.name) return
        // The upstream rule skips unresolved modules. Check declarations even
        // before installation, including empty manifests and package subpaths.
        if (!fields.some(field => Object.hasOwn(bundle.manifest[field] ?? {}, name))) {
          context.report({ node, messageId: 'missing', data: { name, fields: fields.join('/') } })
        }
      })
    },
  }
}

const root = process.cwd()
const bundles = discoverBundles(root)
export default [
  { ignores: ['**/node_modules/**', '**/.git/**', '.dsh-source/**', '_site/**', '.plugin-market-cache/**'] },
  ...bundles.map(bundle => ({
    files: [`${bundle.path}/**/*.{js,mjs,cjs}`],
    plugins: { bundle: { rules: { 'no-extraneous-dependencies': scopedExtraneous, 'own-manifest': ownManifestRule(bundle) } } },
    rules: {
      'bundle/no-extraneous-dependencies': ['error', {
        packageDir: bundle.dir,
        devDependencies: [`${bundle.path}/**/*.test.{js,mjs,cjs}`, `${bundle.path}/test/**`, `${bundle.path}/tests/**`, `${bundle.path}/__tests__/**`, `${bundle.path}/check.mjs`],
        optionalDependencies: false,
        bundledDependencies: false,
      }],
      'bundle/own-manifest': 'error',
    },
  })),
]
