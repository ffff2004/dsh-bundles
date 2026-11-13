#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseReleaseTag } from './market-policy.mjs';

/** Independently check every listed release against local Git tag objects, never HEAD versions. */
export function verifyMarket({ index, repo, sourceUrl, mode, expectedTags = [], releaseRef }) {
  if (!['deploy', 'pr-bootstrap'].includes(mode)) throw new Error('--mode must be deploy or pr-bootstrap');
  if (typeof sourceUrl !== 'string' || !sourceUrl) throw new Error('--source-url is required');
  if (!Array.isArray(expectedTags) || expectedTags.some(tag => !parseReleaseTag(tag))) {
    throw new Error('Expected tags must be an array of exact new-scope package release tags');
  }
  if (releaseRef !== undefined && (typeof releaseRef !== 'string' || !/^[0-9a-f]{40}$/u.test(releaseRef))) {
    throw new Error('--release-ref must be a full commit SHA');
  }
  if (releaseRef !== undefined && expectedTags.length === 0) {
    throw new Error('--release-ref requires at least one expected release tag');
  }
  const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  // No network here: CI must fetch complete tags and their objects before verification.
  if (git('rev-parse', '--is-shallow-repository') !== 'false') throw new Error('Verification requires a full checkout; fetch complete history and tags first');
  const tags = new Set(git('for-each-ref', '--format=%(refname:strip=2)', 'refs/tags').split('\n').filter(tag => parseReleaseTag(tag)));
  if (index?.format !== 1 || !Array.isArray(index.plugins)) throw new Error('Expected a format-1 index with plugins');
  if (index.plugins.length === 0) {
    if (mode !== 'pr-bootstrap' || tags.size || expectedTags.length) {
      throw new Error('Empty index allowed only for pr-bootstrap with no new-scope release tags or expected releases; deploy must be nonempty');
    }
    return { plugins: 0, versions: 0, bootstrap: true };
  }
  const names = new Set();
  const included = new Set();
  const commits = new Map();
  let count = 0;
  for (const plugin of index.plugins) {
    if (names.has(plugin?.name)) throw new Error(`Duplicate plugin: ${plugin.name}`);
    names.add(plugin?.name);
    if (!Array.isArray(plugin?.versions) || !plugin.versions.length) throw new Error('Each plugin must contain versions');
    for (const version of plugin.versions) {
      const tag = `${plugin.name}@${version?.version}`;
      if (!parseReleaseTag(tag) || !tags.has(tag)) throw new Error(`No exact release tag for ${tag}`);
      if (included.has(tag)) throw new Error(`Duplicate release: ${tag}`);
      const source = version.source;
      if (source?.type !== 'git' || source.url !== sourceUrl) throw new Error(`${tag}: source type/url mismatch`);
      if (typeof source.commit !== 'string' || !/^[0-9a-f]{40}$/u.test(source.commit)) throw new Error(`${tag}: expected full commit SHA`);
      const commit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
      if (source.commit !== commit) throw new Error(`${tag}: source commit does not match tag commit ${commit}`);
      const path = source.path === undefined ? '' : source.path;
      if (typeof path !== 'string' || path.includes('\\') || (path !== '' && path.split('/').some(part => !/^[A-Za-z0-9._@+-]+$/u.test(part) || part === '.' || part === '..'))) {
        throw new Error(`${tag}: noncanonical source path`);
      }
      const manifestPath = path ? `${path}/package.json` : 'package.json';
      const tree = git('ls-tree', '-z', commit, '--', manifestPath);
      if (!/^100(?:644|755) blob [0-9a-f]{40}\t/u.test(tree)) throw new Error(`${tag}: source path has no regular package.json`);
      let manifest;
      try {
        manifest = JSON.parse(git('show', `${commit}:${manifestPath}`));
      } catch {
        throw new Error(`${tag}: cannot read tag manifest at source path ${manifestPath}`);
      }
      if (manifest?.name !== plugin.name || manifest?.version !== version.version) {
        throw new Error(`${tag}: tag manifest name/version mismatch at ${manifestPath}`);
      }
      const bundle = manifest.dsh?.bundle;
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
        || !(typeof bundle.patch === 'string' || (Array.isArray(bundle.patch) && bundle.patch.every(file => typeof file === 'string')))) {
        throw new Error(`${tag}: tag manifest does not declare dsh.bundle`);
      }
      included.add(tag);
      commits.set(tag, commit);
      count++;
    }
  }
  for (const tag of expectedTags) {
    if (!included.has(tag)) throw new Error(`Expected release tag was not indexed: ${tag}`);
    // releaseRef anchors only this release batch; historical tags stay self-consistent.
    if (releaseRef !== undefined && commits.get(tag) !== releaseRef) {
      throw new Error(`Expected release tag ${tag} points to ${commits.get(tag)}, not release commit ${releaseRef}`);
    }
  }
  return { plugins: index.plugins.length, versions: count, bootstrap: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      index: { type: 'string' }, repo: { type: 'string' }, 'source-url': { type: 'string' }, mode: { type: 'string' },
      'expect-tag': { type: 'string', multiple: true }, 'expect-tags-file': { type: 'string' },
      'release-ref': { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) console.log('Usage: node scripts/market-verify.mjs --index <index.json> --repo <git-checkout-with-tags> --source-url <exact-generator-url> --mode deploy|pr-bootstrap [--expect-tag <package@version> ...] [--expect-tags-file <JSON-array>] [--release-ref <full-commit-sha>]');
    else {
      if (!values.index || !values.repo) throw new Error('--index and --repo are required');
      const fromFile = values['expect-tags-file'] ? JSON.parse(readFileSync(values['expect-tags-file'], 'utf8')) : [];
      if (!Array.isArray(fromFile)) throw new Error('--expect-tags-file must contain a JSON array');
      const result = verifyMarket({ index: JSON.parse(readFileSync(values.index, 'utf8')), repo: values.repo,
        sourceUrl: values['source-url'], mode: values.mode, expectedTags: [...fromFile, ...(values['expect-tag'] ?? [])],
        releaseRef: values['release-ref'] || undefined });
      console.log(`Validated market: ${result.plugins} plugins, ${result.versions} tagged versions${result.bootstrap ? ' (PR migration bootstrap; not deployable)' : ''}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
