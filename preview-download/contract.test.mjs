/**
 * Behavior tests for the Host half: drives the registered route with a fake context
 * and a real temporary file, then asserts the headers, the refusal statuses,
 * and byte-for-byte streaming across several byte windows.
 *
 * Run: node --test
 */
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, ROUTE_PATH } from './index.js'

/** Byte window the fake service reports, deliberately far below the file size. */
const WINDOW_BYTES = 64 * 1024

/** The route both halves of the package must agree on. */
const EXPECTED_ROUTE = '/api/preview-download'
/** ASCII fallback for a filename with CJK text and a double quote. */
const EXPECTED_ASCII = `attachment; filename="__ with space'()*_quote.bin"`
/** RFC 5987 form of the same name, including `'()*`. */
const EXPECTED_UTF8 = "filename*=UTF-8''%E6%8A%A5%E5%91%8A%20with%20space%27%28%29%2A%22quote.bin"

// Keep the original check aggregation: every label in a group is evaluated.
function checkGroup(t, name, run) {
  return t.test(name, async t => {
    const failures = []
    let count = 0
    const check = (label, condition, detail) => {
      count++
      if (!condition) failures.push(`${label}${detail === undefined ? '' : `: ${detail}`}`)
    }
    await run(check)
    assert.deepEqual(failures, [], name)
    t.diagnostic(`${count} preserved check labels`)
  })
}

test('download route contract', async t => {
  const client = await readFile(new URL('./client.js', import.meta.url), 'utf8')
  const clientRoute = client.match(/const ROUTE_URL = ['"`]([^'"`]+)['"`]/)?.[1]

  const dir = await mkdtemp(join(tmpdir(), 'preview-download-'))
  let route
  let windows = 0
  try {
    const file = join(dir, '报告 with space\'()*"quote.bin')
    const bytes = new Uint8Array(300_123)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    await writeFile(file, bytes)

    const sessionScope = { sessionId: 'session-1', workspaceRoot: dir }

    const ctx = {
      connection: { fetch: { register: (registered) => { route = registered } } },
      typert: {
        lookups: {
          get: key => key === 'workspaceFileScope'
            ? { resolve: async id => (id === 'session-1' ? sessionScope : undefined) }
            : undefined,
        },
      },
      workspaceFiles: {
        async stat(_scope, path) {
          let info
          try {
            info = await stat(path)
          } catch {
            throw Object.assign(new Error(`no entry at "${path}"`), { code: 'workspace-file/not-found' })
          }
          if (!info.isFile()) {
            throw Object.assign(new Error(`"${path}" is a directory`), { code: 'workspace-file/not-regular-file' })
          }
          return { absolutePath: path, version: 'v1', bytes: info.size }
        },
        async readBytes(_scope, path, options) {
          windows += 1
          const offset = options.range.offset
          const info = await stat(path)
          const length = Math.min(WINDOW_BYTES, Math.max(0, info.size - offset))
          const handle = await open(path, 'r')
          try {
            const buffer = new Uint8Array(length)
            const { bytesRead } = await handle.read(buffer, 0, length, offset)
            const data = buffer.subarray(0, bytesRead)
            return {
              absolutePath: path, version: 'v1', bytes: info.size,
              offset, data, eof: info.size === undefined ? true : offset + data.length >= info.size,
            }
          } finally {
            await handle.close()
          }
        },
      },
    }

    apply(ctx)

    const fetch = (method, query) => route.fetch(new Request(
      `http://127.0.0.1:3080${ROUTE_PATH}${query === undefined ? `?${new URLSearchParams({ sessionId: 'session-1', path: file })}` : query}`,
      { method },
    ))

    await checkGroup(t, 'route registration and client agreement', async check => {
      check('route path', route.path === EXPECTED_ROUTE, route.path)
      check('client route agrees', clientRoute === EXPECTED_ROUTE.slice(1), clientRoute)
      check('route methods', route.methods.join(',') === 'GET,HEAD', route.methods.join(','))
    })

    await checkGroup(t, 'HEAD headers and empty body', async check => {
      const head = await fetch('HEAD')
      check('HEAD status', head.status === 200, String(head.status))
      check('HEAD length', head.headers.get('content-length') === String(bytes.length), head.headers.get('content-length'))
      check('HEAD type', head.headers.get('content-type') === 'application/octet-stream')
      check('HEAD cache', head.headers.get('cache-control') === 'no-store')
      const disposition = head.headers.get('content-disposition') ?? ''
      check('HEAD disposition', disposition === `${EXPECTED_ASCII}; ${EXPECTED_UTF8}`, disposition)
      check('HEAD body', (await head.text()) === '')
    })

    await checkGroup(t, 'GET streams exact bytes across multiple windows', async check => {
      windows = 0
      const get = await fetch('GET')
      check('GET status', get.status === 200, String(get.status))
      const body = new Uint8Array(await get.arrayBuffer())
      check('GET length', body.length === bytes.length, `${body.length} of ${bytes.length}`)
      check('GET bytes', body.every((value, index) => value === bytes[index]))
      check('GET windows', windows > 1, `${windows} window(s)`)
    })

    await checkGroup(t, 'request and filesystem refusals', async check => {
      const missing = await fetch('GET', '?sessionId=session-1')
      check('missing path', missing.status === 400, String(missing.status))
      const unknown = await fetch('GET', `?${new URLSearchParams({ sessionId: 'session-2', path: file })}`)
      check('unknown session', unknown.status === 404, String(unknown.status))
      const absent = await fetch('GET', `?${new URLSearchParams({ sessionId: 'session-1', path: join(dir, 'gone') })}`)
      check('absent file', absent.status === 404, String(absent.status))
      const directory = await fetch('GET', `?${new URLSearchParams({ sessionId: 'session-1', path: dir })}`)
      check('directory refusal', directory.status === 400, String(directory.status))
    })

  } finally {
    assert.equal(dirname(dir), tmpdir())
    assert.match(basename(dir), /^preview-download-/u)
    await rm(dir, { recursive: true, force: true })
    await assert.rejects(stat(dir), { code: 'ENOENT' })
  }
})
