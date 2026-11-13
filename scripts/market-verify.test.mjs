import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseReleaseTag } from './market-policy.mjs';
import { fixture, indexAt, manifest, NAME, SOURCE_URL } from './market-test-fixture.mjs';
import { verifyMarket } from './market-verify.mjs';

const verify = (repo, index, extra = {}) => verifyMarket({ repo, index, sourceUrl: SOURCE_URL, mode: 'deploy', ...extra });
const TAG = `${NAME}@1.0.0`;

test('only full new-scope exact canonical SemVer tags qualify', () => {
  for (const version of ['1.0.0', '2.0.0-rc.1', '1.0.0+build.5']) {
    assert.deepEqual(parseReleaseTag(`${NAME}@${version}`), { name: NAME, version });
  }
  for (const tag of ['HEAD', '1.0.0', 'v1.0.0', '@local/dsh-shell-description@1.0.0',
    '@other/shell-description@1.0.0', `${NAME}@v1.0.0`, `${NAME}@01.0.0`, `${NAME}@1.0`,
    `${NAME}@1.0.0-01`, `${NAME}@1.0.0 `, `${NAME}@=1.0.0`, '@ffff2004-dsh-packages/@1.0.0']) {
    assert.equal(parseReleaseTag(tag), undefined, tag);
  }
});

test('checks each release, including annotated tags and expected release batch', t => {
  const f = fixture(t);
  f.git('tag', '-a', TAG, '-m', 'release');
  assert.deepEqual(verify(f.repo, indexAt(f.first), { expectedTags: [TAG] }), { plugins: 1, versions: 1, bootstrap: false });
  assert.throws(() => verify(f.repo, indexAt(f.first), { expectedTags: [`${NAME}@2.0.0`] }), /Expected release tag was not indexed/u);
  assert.throws(() => verify(f.repo, indexAt(f.first), { expectedTags: ['v1.0.0'] }), /Expected tags/u);
});

test('release-ref anchors expected batch tags to the release commit', t => {
  const f = fixture(t);
  f.git('tag', '-a', TAG, '-m', 'release');
  assert.equal(verify(f.repo, indexAt(f.first), { expectedTags: [TAG], releaseRef: f.first }).versions, 1);
  f.write('readme', 'next commit');
  const second = f.commit();
  f.git('tag', '-f', '-a', TAG, second, '-m', 'moved');
  assert.throws(() => verify(f.repo, indexAt(second), { expectedTags: [TAG], releaseRef: f.first }),
    /not release commit/u);
  assert.equal(verify(f.repo, indexAt(second), { expectedTags: [TAG], releaseRef: second }).versions, 1);
  assert.throws(() => verify(f.repo, indexAt(second), { expectedTags: [TAG], releaseRef: 'main' }), /full commit SHA/u);
  assert.throws(() => verify(f.repo, indexAt(second), { releaseRef: second }), /at least one expected release tag/u);
});

test('rejects HEAD-only, unified-only, and old-scope releases', t => {
  const f = fixture(t);
  f.git('tag', 'v1.0.0');
  f.git('tag', '1.0.0');
  f.git('tag', '@local/dsh-shell-description@1.0.0');
  assert.throws(() => verify(f.repo, indexAt(f.first)), /No exact release tag/u);
  assert.throws(() => verify(f.repo, indexAt(f.first, { name: '@local/dsh-shell-description' })), /No exact release tag/u);
});

test('rejects wrong commit, URL, path and tag manifest name/version', t => {
  const f = fixture(t);
  f.git('tag', TAG);
  f.write('readme', 'next commit');
  const second = f.commit();
  assert.throws(() => verify(f.repo, indexAt(second)), /source commit does not match tag/u);
  assert.throws(() => verify(f.repo, indexAt(f.first, { url: 'https://wrong.example/repo' })), /type\/url mismatch/u);
  assert.throws(() => verify(f.repo, indexAt(f.first, { path: 'packages/missing' })), /no regular package.json/u);
  assert.throws(() => verify(f.repo, indexAt(f.first, { path: 'packages/../shell-description' })), /noncanonical source path/u);
  f.git('tag', `${NAME}@2.0.0`);
  assert.throws(() => verify(f.repo, indexAt(second, { version: '2.0.0' })), /manifest name\/version mismatch/u);
  f.write('packages/other/package.json', manifest('@ffff2004-dsh-packages/other'));
  const third = f.commit();
  f.git('tag', `${NAME}@3.0.0`);
  assert.throws(() => verify(f.repo, indexAt(third, { version: '3.0.0', path: 'packages/other' })), /manifest name\/version mismatch/u);
});

test('validates every historical version, not just expected/current one', t => {
  const f = fixture(t);
  f.git('tag', TAG);
  const index = indexAt(f.first);
  index.plugins[0].versions.push({ ...index.plugins[0].versions[0], version: '0.9.0' });
  assert.throws(() => verify(f.repo, index, { expectedTags: [TAG] }), /No exact release tag/u);
});

test('PR migration bootstrap accepts only empty index with no new-scope tags; deploy never empty', t => {
  const f = fixture(t);
  const empty = { format: 1, title: 'Empty', plugins: [] };
  f.git('tag', '@local/dsh-shell-description@1.0.0');
  assert.equal(verify(f.repo, empty, { mode: 'pr-bootstrap' }).bootstrap, true);
  assert.throws(() => verify(f.repo, empty), /deploy must be nonempty/u);
  assert.throws(() => verify(f.repo, empty, { mode: 'pr-bootstrap', expectedTags: [TAG] }), /Empty index/u);
  f.git('tag', TAG);
  assert.throws(() => verify(f.repo, empty, { mode: 'pr-bootstrap' }), /Empty index/u);
  assert.throws(() => verify(f.repo, empty, { mode: 'allow-empty' }), /--mode/u);
});

test('real CLI checks expected-tags JSON and has fail-closed explicit modes', t => {
  const f = fixture(t);
  f.git('tag', TAG);
  const index = join(f.dir, 'index.json');
  const expected = join(f.dir, 'expected.json');
  writeFileSync(index, JSON.stringify(indexAt(f.first)));
  writeFileSync(expected, JSON.stringify([TAG]));
  const script = fileURLToPath(new URL('./market-verify.mjs', import.meta.url));
  const args = [script, '--repo', f.repo, '--index', index, '--source-url', SOURCE_URL, '--expect-tags-file', expected];
  const run = (...tail) => spawnSync(process.execPath, [...args, ...tail], { encoding: 'utf8' });
  assert.equal(run('--mode', 'deploy').status, 0);
  assert.equal(run().status, 1);
  assert.equal(run('--mode', 'deploy', '--expect-tag', `${NAME}@2.0.0`).status, 1);
  f.write('readme', 'next commit');
  const second = f.commit();
  assert.equal(run('--mode', 'deploy', '--release-ref', f.first).status, 0);
  assert.equal(run('--mode', 'deploy', '--release-ref', second).status, 1);
  assert.match(run('--mode', 'deploy', '--release-ref', 'main').stderr, /full commit SHA/u);
  writeFileSync(expected, '{}');
  assert.match(run('--mode', 'deploy').stderr, /JSON array/u);
});
