import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const NAME = '@ffff2004-dsh-packages/shell-description';
export const SOURCE_URL = 'https://git.example/test/bundles';
export const manifest = (name = NAME, version = '1.0.0', extra = {}) => JSON.stringify({
  name, version, dsh: { bundle: { patch: './patch.yml' } }, ...extra,
});

export function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'market-test-')));
  t.after(() => {
    // The only deletion is the exact scratch directory created by this test.
    assert.equal(realpathSync(dir), dir);
    assert.ok(dir.startsWith(`${realpathSync(tmpdir())}/market-test-`));
    rmSync(dir, { recursive: true, force: true });
  });
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', '-C', repo, ...args], { encoding: 'utf8', env }).trim();
  git('init', '--quiet', '--initial-branch=main');
  const write = (path, contents) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), contents);
  };
  const commit = () => {
    git('add', '--all');
    git('commit', '--quiet', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  write('package.json', JSON.stringify({ private: true }));
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('packages/shell-description/package.json', manifest());
  const first = commit();
  return { dir, repo, home, env, git, write, commit, first };
}

export function indexAt(commit, { name = NAME, version = '1.0.0', path = 'packages/shell-description', url = SOURCE_URL } = {}) {
  return { format: 1, title: 'Fixture', plugins: [{ name, versions: [{ version, publishTimestamp: 0,
    source: { type: 'git', url, commit, ...(path === '' ? {} : { path }) } }] }] };
}
