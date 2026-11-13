import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CACHE_POLICY, MARKET_SCOPE } from './market-policy.mjs';
import { fixture, manifest, NAME, SOURCE_URL } from './market-test-fixture.mjs';
import { verifyMarket } from './market-verify.mjs';
import { GENERATE_PATH, PATCHES, patchGenerateSource, prepareGenerator, UPSTREAM_SHA } from './prepare-market-generator.mjs';

const anchorFixture = () => PATCHES.map(([before]) => before).join('\n\n');

test('minimal patch replaces only unique known anchors and namespaces all upstream cache keys', () => {
  const source = anchorFixture();
  const patched = patchGenerateSource(source);
  for (const [before, after] of PATCHES) {
    assert.ok(source.includes(before));
    assert.ok(patched.includes(after));
  }
  assert.match(patched, new RegExp(CACHE_POLICY, 'u'));
  assert.ok(patched.includes(MARKET_SCOPE.replaceAll('/', '\\/')));
  assert.doesNotMatch(patched, /version: undefined|tag\.name === undefined/u);
  // Normal results and the last-success fallback both include the same policy version upstream.
  const key = version => createHash('sha256').update(JSON.stringify([version, SOURCE_URL])).digest('hex');
  assert.notEqual(key(7), key(CACHE_POLICY));
});

test('patch rejects changed, missing, duplicate anchors and a second application', () => {
  const source = anchorFixture();
  for (const [before] of PATCHES) {
    assert.throws(() => patchGenerateSource(source.replace(before, `${before} drift`.replace(before[0], '#'))), /exactly once/u);
    assert.throws(() => patchGenerateSource(`${source}\n${before}`), /exactly once/u);
    assert.throws(() => patchGenerateSource(source.replace(before, '')), /exactly once/u);
  }
  assert.throws(() => patchGenerateSource(patchGenerateSource(source)), /exactly once/u);
});

test('prepare CLI refuses an unpinned temporary checkout without changing it', t => {
  const f = fixture(t);
  f.write(GENERATE_PATH, anchorFixture());
  const file = join(f.repo, GENERATE_PATH);
  const before = readFileSync(file, 'utf8');
  assert.throws(() => prepareGenerator(f.repo), /HEAD must equal pinned/u);
  assert.equal(readFileSync(file, 'utf8'), before);
  const command = fileURLToPath(new URL('./prepare-market-generator.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [command, '--checkout', f.repo], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HEAD must equal pinned/u);
  assert.equal(readFileSync(file, 'utf8'), before);
});

const upstream = process.env.MARKET_GENERATOR_CHECKOUT;
test('real pinned official generator: tags only, icons/validation retained, normal and fallback cache isolation', {
  skip: !upstream && 'Set MARKET_GENERATOR_CHECKOUT to an installed pinned upstream checkout to run the integration test',
  timeout: 120000,
}, t => {
  const f = fixture(t);
  const originalRoot = resolve(upstream);
  const originalFile = join(originalRoot, GENERATE_PATH);
  const originalSource = readFileSync(originalFile, 'utf8');
  const checkout = join(f.dir, 'generator');
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--quiet', '--shared', '--no-checkout', '--', originalRoot, checkout], { env: f.env });
  assert.equal(execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), UPSTREAM_SHA);
  const generatorDir = join(checkout, 'apps/plugin-market-generator');
  mkdirSync(generatorDir, { recursive: true });
  cpSync(join(originalRoot, 'apps/plugin-market-generator/src'), join(generatorDir, 'src'), { recursive: true });
  writeFileSync(join(checkout, 'package.json'), '{"type":"module"}');
  writeFileSync(join(generatorDir, 'src/generate-original.ts'), originalSource);
  const dependencies = join(originalRoot, 'apps/plugin-market-generator/node_modules');
  assert.ok(existsSync(join(dependencies, 'tsx/dist/loader.mjs')), 'Install the pinned generator dependencies first');
  symlinkSync(dependencies, join(generatorDir, 'node_modules'), 'dir');
  const temporarySource = join(checkout, GENERATE_PATH);
  const drifted = `${originalSource}\n// unrelated upstream drift\n`;
  writeFileSync(temporarySource, drifted);
  assert.throws(() => prepareGenerator(checkout), /source blob has drifted/u);
  assert.equal(readFileSync(temporarySource, 'utf8'), drifted, 'drift rejection must not partially patch');
  writeFileSync(temporarySource, originalSource);
  prepareGenerator(checkout);
  assert.equal(readFileSync(originalFile, 'utf8'), originalSource, 'original upstream checkout must remain untouched');

  f.write('packages/shell-description/package.json', manifest(NAME, '1.0.0', { icon: './icon.svg' }));
  f.write('packages/shell-description/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  const releaseCommit = f.commit();
  f.git('tag', 'v1.0.0');
  f.git('tag', '1.0.0');
  f.git('tag', '@local/dsh-shell-description@1.0.0');
  f.write('packages/shell-description/package.json', manifest(NAME, '1.1.0', { icon: './icon.svg' }));
  f.write('packages/legacy/package.json', manifest('@local/dsh-legacy', '5.0.0'));
  f.commit();
  writeFileSync(join(f.home, '.gitconfig'), `[url "${new URL(`file://${f.repo}`).href}"]\n\tinsteadOf = ${SOURCE_URL}\n`);
  const worker = join(checkout, 'run.mjs');
  writeFileSync(worker, `
import { pathToFileURL } from 'node:url';
const [module, cacheDir, allowed] = process.argv.slice(2);
const { generate } = await import(pathToFileURL(module).href);
const warnings = [];
const result = await generate({ sources: [{ kind: 'git', line: ${JSON.stringify(SOURCE_URL)}, url: ${JSON.stringify(SOURCE_URL)} }],
  cacheDir, registry: 'https://registry.npmjs.org/', recordRegistry: false, title: 'Fixture', inlineIconBytes: 0,
  limits: { timeoutMs: 20000, maxTarballBytes: 1048576 }, concurrency: 1, gitTransports: JSON.parse(allowed),
  warn: message => warnings.push(message) });
console.log(JSON.stringify({ ...result, icons: [...result.icons], warnings }));
`);
  const run = (flavor, cache, transports = ['file']) => JSON.parse(execFileSync(process.execPath,
    ['--import', join(dependencies, 'tsx/dist/loader.mjs'), worker, join(generatorDir, `src/${flavor}.ts`),
      join(f.dir, cache), JSON.stringify(transports)], { encoding: 'utf8',
      env: { ...f.env, TSX_TSCONFIG_PATH: join(originalRoot, 'tsconfig.json') } }));
  const original = run('generate-original', 'shared-before-tags');
  assert.ok(original.index.plugins.some(p => p.name === NAME && p.versions.some(v => v.version === '1.1.0')));
  assert.ok(original.index.plugins.some(p => p.name === '@local/dsh-legacy'));
  const failedFreshPolicy = run('generate', 'shared-before-tags', []);
  assert.equal(failedFreshPolicy.failures.length, 1);
  assert.deepEqual(failedFreshPolicy.index.plugins, [], 'must not restore upstream last-success fallback');
  const noTags = run('generate', 'shared-before-tags');
  assert.deepEqual(noTags.index.plugins, [], 'neither HEAD, unified tags nor old scope may be listed');
  assert.deepEqual(noTags.failures, []);

  const tag = `${NAME}@1.0.0`;
  f.git('tag', '-a', tag, releaseCommit, '-m', 'release');
  f.git('tag', `${NAME}@2.0.0`); // Mismatched tag version and manifest must not be included.
  run('generate-original', 'shared-tagged');
  const tagged = run('generate', 'shared-tagged');
  assert.deepEqual(tagged.failures, []);
  assert.deepEqual(tagged.index.plugins.map(p => [p.name, p.versions.map(v => v.version)]), [[NAME, ['1.0.0']]]);
  assert.equal(tagged.index.plugins[0].versions[0].source.commit, releaseCommit);
  assert.match(tagged.index.plugins[0].icon, /^icons\/[0-9a-f]{16}\.svg$/u);
  assert.equal(tagged.icons.length, 1, 'official generated icon pipeline is retained');
  verifyMarket({ repo: f.repo, index: tagged.index, sourceUrl: SOURCE_URL, mode: 'deploy', expectedTags: [tag] });
  const fallback = run('generate', 'shared-tagged', []);
  assert.equal(fallback.failures.length, 1);
  assert.deepEqual(fallback.index, tagged.index, 'policy fallback must contain policy-only releases');

  f.write('packages/shell-description/package.json', manifest(NAME, '3.0.0', { engines: { dsh: 'workspace:*' } }));
  f.commit();
  f.git('tag', `${NAME}@3.0.0`);
  const invalid = run('generate', 'shared-tagged');
  assert.deepEqual(invalid.index.plugins[0].versions.map(v => v.version), ['1.0.0']);
  assert.ok(invalid.warnings.some(message => message.includes('3.0.0 skipped')), 'official release validation remains active');
  assert.equal(readFileSync(originalFile, 'utf8'), originalSource);
});
