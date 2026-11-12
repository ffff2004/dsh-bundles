#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CACHE_POLICY } from './market-policy.mjs';

export const UPSTREAM_SHA = '687f282e8625c6b8d11ff58211a90524be2e4317';
export const GENERATE_PATH = 'apps/plugin-market-generator/src/generate.ts';
const SOURCE_SHA256 = 'fd472b937b666a0f7483dd07175d0c0a80d93669a94341f28ea2ff2d02379f5f';

// Each replacement is deliberately literal, unique, and tied to the fixed upstream blob.
export const PATCHES = [
  ['const CACHE_VERSION = 7', `const CACHE_VERSION = '${CACHE_POLICY}'`],
  [
    "  const { name, version = '' } = /^(?:(?<name>.+)@|v)?(?<version>[^@]+)$/u.exec(tag)?.groups ?? {}\n  return semver.valid(version) === version ? { tag, commit, version, ...name === undefined ? {} : { name } } : undefined",
    "  const { name, version = '' } = /^(?<name>@ffff2004-dsh-packages\\/[a-z0-9][a-z0-9._-]*)@(?<version>[^@]+)$/u.exec(tag)?.groups ?? {}\n  const parsed = semver.parse(version)\n  const canonical = parsed === null ? undefined : `${parsed.version}${parsed.build.length ? `+${parsed.build.join('.')}` : ''}`\n  return name !== undefined && canonical === version ? { tag, commit, version, name } : undefined",
  ],
  [
    "    // Lower ranks win when several commits carry one version: `<name>@` tags, then unified tags, then the default branch.\n    const units = [\n      ...tags.flatMap(tag => packages.filter(found => tag.name === undefined || tag.name === found.name)\n        .map(found => ({ found, commit: tag.commit, version: tag.version, rank: tag.name === undefined ? 1 : 0 }))),\n      ...packages.map(found => ({ found, commit: refs.head, version: undefined, rank: 2 })),\n    ].map(unit => ({ ...unit, file: unitFile('release', unit.commit, unit.found.path) }))",
    "    // Only exact package release tags are candidates; HEAD is discovery only.\n    const units = tags.flatMap(tag => packages.filter(found => tag.name === found.name)\n      .map(found => ({ found, commit: tag.commit, version: tag.version, rank: 0 })))\n      .map(unit => ({ ...unit, file: unitFile('release', unit.commit, unit.found.path) }))",
  ],
];

/** Compute the entire patch before writing anything; drift or duplicate anchors fail closed. */
export function patchGenerateSource(source) {
  for (const [before] of PATCHES) {
    if (source.split(before).length !== 2) throw new Error(`Generator patch anchor must occur exactly once: ${before.split('\n')[0]}`);
  }
  return PATCHES.reduce((text, [before, after]) => text.replace(before, () => after), source);
}

/** Only use on a disposable checkout of the pinned upstream revision. Never resets or cleans files. */
export function prepareGenerator(checkout) {
  const root = realpathSync(checkout);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  if (realpathSync(git('rev-parse', '--show-toplevel')) !== root) throw new Error('--checkout must be the checkout root');
  if (git('rev-parse', 'HEAD') !== UPSTREAM_SHA) throw new Error(`Generator HEAD must equal pinned ${UPSTREAM_SHA}`);
  const file = resolve(root, GENERATE_PATH);
  if (realpathSync(file) !== file) throw new Error('Generator source must be a regular path inside the disposable checkout, not a symlink');
  const source = readFileSync(file, 'utf8');
  const patched = patchGenerateSource(source);
  if (createHash('sha256').update(source).digest('hex') !== SOURCE_SHA256) throw new Error('Pinned generator source blob has drifted');
  writeFileSync(file, patched);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { checkout: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) console.log('Usage: node scripts/prepare-market-generator.mjs --checkout <disposable-pinned-checkout>');
    else {
      if (!values.checkout) throw new Error('--checkout is required (only a disposable checkout will be patched)');
      console.log(`Prepared tags-only reference generator: ${prepareGenerator(values.checkout)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
