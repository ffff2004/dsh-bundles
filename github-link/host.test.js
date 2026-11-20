import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, ROUTE_PATH } from './index.js'
import { parseGithubLinks, readGithubLinks } from './remotes.js'

function config(...pairs) {
  return pairs.map(([name, url]) => `remote.${name}.url\n${url}\0`).join('')
}

function link(repository, ...remotes) {
  return { repository, url: `https://github.com/${repository}`, remotes }
}

test('groups canonical targets case-insensitively, preferring origin and retaining remote names', () => {
  assert.deepEqual(parseGithubLinks(config(
    ['upstream', 'https://github.com/other/parent.git'],
    ['mirror', 'ssh://git@GITHUB.COM/acme/PROJECT.git'],
    ['origin', 'git@github.com:Acme/Project.git'],
    ['origin', 'https://github.com/acme/project'],
    ['fork/dev', 'http://github.com/acme/project/'],
    ['zfork', 'git://github.com/third/.github.git'],
  )), [link('Acme/Project', 'origin', 'fork/dev', 'mirror'), link('other/parent', 'upstream'), link('third/.github', 'zfork')])
})

test('drops unsafe, non-public, non-repository, and malformed config entries', () => {
  assert.deepEqual(parseGithubLinks(config(
    ...[
      'https://private.github.example/owner/repo', 'https://github.com.evil/owner/repo',
      'https://github.com@evil.example/owner/repo', 'https://secret@github.com/owner/repo',
      'https://github.com:443/owner/repo', 'ssh://other@github.com/owner/repo',
      'git@github.com:/owner/repo', 'https://github.com/owner/repo?token=secret',
      'https://github.com/owner/repo#file', 'https://github.com/owner/repo/a',
      'https://github.com/owner/..', 'https://github.com/owner/...git',
      'https://github.com/owner/.git', 'https://github.com/owner/%2e%2e',
      'https://github.com/owner\\repo', 'https://github.com/owner/repo\nremote.forged.url\nhttps://github.com/other/repo',
      ' https://github.com/owner/repo', 'file:///tmp/repo',
    ].map(raw => ['origin', raw]),
    ['bad\x1bname', 'https://github.com/owner/repo'],
    ['ok', 'https://github.com/owner/repo'],
  )), [link('owner/repo', 'ok')])
  assert.deepEqual(parseGithubLinks('remote.origin.url\nhttps://github.com/owner/repo'), [])
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-github-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo with spaces')
  const unrelated = join(root, 'unrelated')
  mkdirSync(repo)
  mkdirSync(unrelated)
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  git('init', '--quiet')
  git('config', '--local', 'remote.origin.url', 'git@github.com:owner/repo.git')
  return { root, repo, unrelated, git }
}

test('reads only local fetch URLs at the registered root (no includes, rewrites, pushes or parent search)', async t => {
  const { root, repo, unrelated, git } = fixture(t)
  const outside = join(root, 'included.gitconfig')
  writeFileSync(outside, '[remote "included"]\n\turl = https://github.com/outside/secret\n')
  git('config', '--local', 'include.path', outside)
  git('config', '--local', 'url.https://github.com/rewrite/secret.insteadOf', 'git@github.com:owner/repo.git')
  git('config', '--local', 'remote.origin.pushurl', 'https://github.com/push/secret')
  const child = join(repo, 'nested workspace')
  mkdirSync(child)
  const oldGitDir = process.env.GIT_DIR
  process.env.GIT_DIR = join(repo, '.git')
  t.after(() => {
    if (oldGitDir === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = oldGitDir
  })

  assert.deepEqual(await readGithubLinks(repo), [link('owner/repo', 'origin')])
  assert.deepEqual(await readGithubLinks(child), [])
  assert.deepEqual(await readGithubLinks(unrelated), [])
  assert.deepEqual(await readGithubLinks('relative'), [])
  assert.deepEqual(await readGithubLinks(repo, AbortSignal.abort()), [])
})

test('hides results if Git output exceeds the configured limit', async t => {
  const { repo } = fixture(t)
  appendFileSync(join(repo, '.git', 'config'), `\n[remote "big"]\n\turl = ${'x'.repeat(70 * 1024)}\n`)
  assert.deepEqual(await readGithubLinks(repo), [])
})

function endpoint({ get, decide }) {
  let route
  const principal = { kind: 'owner' }
  apply({
    connection: { browserPeer: { principal }, fetch: { register: registration => { route = registration } } },
    remoteAccess: { decide },
    workspaceRegistry: { get },
  })
  assert.equal(route.path, '/api/github-link')
  assert.deepEqual(route.methods, ['GET'])
  assert.equal(route.requestBody, 'buffered')
  return query => route.fetch(new Request(`https://localhost${ROUTE_PATH}?${query}`))
}

test('authorizes the specific workspace before resolving its registered path', async t => {
  const { repo } = fixture(t)
  const calls = []
  const get = id => {
    calls.push(['get', id])
    return id === 'allowed' ? { path: repo } : undefined
  }
  const decide = request => {
    calls.push(['decide', request])
    return { kind: request.args.workspaceId === 'denied' ? 'deny' : 'allow' }
  }
  const fetch = endpoint({ get, decide })
  const response = await fetch('workspaceId=allowed')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { links: [link('owner/repo', 'origin')] })
  assert.deepEqual(calls, [
    ['decide', {
      principal: { kind: 'owner' }, action: 'github-link/links',
      resources: [{ kind: 'workspace', id: 'allowed' }], args: { workspaceId: 'allowed' },
    }],
    ['get', 'allowed'],
  ])

  calls.length = 0
  assert.equal((await fetch('workspaceId=denied')).status, 403)
  assert.deepEqual(calls.map(([step]) => step), ['decide'])
  assert.equal((await fetch('workspaceId=unknown')).status, 404)

  // The ID is opaque. A path-looking value goes to the registry as an ID;
  // it cannot become the path passed to Git.
  calls.length = 0
  assert.equal((await fetch('workspaceId=%2Ftmp%2Frepo%20%26%20id')).status, 404)
  assert.deepEqual(calls[1], ['get', '/tmp/repo & id'])
})

test('never accepts supplied paths, missing/blank IDs, or ambiguous query parameters', async () => {
  const unexpected = () => assert.fail('invalid request reached workspace services')
  const fetch = endpoint({ get: unexpected, decide: unexpected })
  for (const query of ['', 'workspaceId=', `workspaceId=${'x'.repeat(257)}`,
    'path=%2Ftmp', 'workspaceId=id&path=%2Ftmp', 'workspaceId=id&workspaceId=other']) {
    assert.equal((await fetch(query)).status, 400, query)
  }
})
