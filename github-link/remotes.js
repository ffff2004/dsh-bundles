import { execFile } from 'node:child_process'
import { delimiter, dirname, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const REMOTE_URL_KEY = /^remote\.([A-Za-z0-9_.\/-]{1,128})\.url$/
const GITHUB_REMOTE = /^(?:(?:https?|git):\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)\/?$/i

/** Parse only Git config's NUL-delimited, key-newline-value output. */
export function parseGithubLinks(stdout) {
  const candidates = []
  const records = stdout.split('\0')
  if (records.pop() !== '') return []
  for (const record of records) {
    const newline = record.indexOf('\n')
    if (newline === -1) continue
    const remote = REMOTE_URL_KEY.exec(record.slice(0, newline))?.[1]
    const raw = record.slice(newline + 1)
    // No trimming, URL decoding, or normalization of untrusted input. In
    // particular, userinfo, suffix domains, ports and query strings fail.
    if (!remote || /[^\x21-\x7e]/.test(raw)) continue
    const match = GITHUB_REMOTE.exec(raw)
    if (!match) continue
    const [, owner, repoWithSuffix] = match
    const repo = repoWithSuffix.replace(/\.git$/i, '')
    if (!repo || repo === '.' || repo === '..' || repo.length > 100) continue
    candidates.push({ remote, repository: `${owner}/${repo}` })
  }

  // Stable sort preserves config order when one remote has multiple URLs.
  candidates.sort((a, b) => a.remote === b.remote ? 0
    : a.remote === 'origin' || (b.remote !== 'origin' && a.remote < b.remote) ? -1 : 1)

  const targets = new Map()
  for (const { remote, repository } of candidates) {
    const key = repository.toLowerCase()
    if (!targets.has(key)) {
      targets.set(key, { repository, url: `https://github.com/${repository}`, remotes: new Set() })
    }
    targets.get(key).remotes.add(remote)
  }
  return [...targets.values()].map(link => ({ ...link, remotes: [...link.remotes] }))
}

/** Read raw fetch URLs from the registered workspace's local Git config. */
export async function readGithubLinks(workspacePath, signal) {
  if (signal?.aborted || typeof workspacePath !== 'string' || !isAbsolute(workspacePath)) return []
  const parent = dirname(workspacePath)
  if (parent.includes(delimiter)) return []
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
  for (const key of Object.keys(env)) {
    if (/^PATH$/i.test(key)) env[key] = env[key].split(delimiter).filter(isAbsolute).join(delimiter)
  }
  // Do not discover a parent workspace's repository, process-level Git
  // overrides, or any include files. Linked worktrees still use their repo's
  // common local config through Git's ordinary repository metadata.
  env.GIT_CEILING_DIRECTORIES = parent
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', workspacePath, 'config', '--local', '--no-includes', '--null', '--get-regexp', '^remote\\..*\\.url$',
    ], {
      // Do not perform executable lookup in a repository-controlled directory.
      cwd: dirname(process.execPath), env, encoding: 'utf8', shell: false,
      timeout: 1500, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true, signal,
    })
    return parseGithubLinks(stdout)
  } catch {
    // Not a repository, no remotes, missing Git, cancellation, over-limit,
    // and unreadable config all hide the affordance without exposing stderr.
    return []
  }
}
