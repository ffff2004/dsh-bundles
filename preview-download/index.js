/**
 * Preview download, Host half: one authenticated download route on the shared
 * `/api` channel.
 *
 * Security has one home: the route rides `/api`, so the Connection service
 * applies its Host/Origin fence and browser authentication before this handler
 * runs (`requestRejection`, then the shared Fetch dispatch). The handler itself
 * validates only what the wire admits: a non-empty `sessionId` and `path`.
 *
 * Read access is deliberately the preview's own: the same `workspaceFiles`
 * service the document-preview tab reads through, resolved for the addressed
 * Session. So a file the preview can display is a file this route can stream,
 * path for path, and a file it refuses stays refused with the same failure
 * code. Bytes arrive as repeated windows — each window is that service's own
 * configured `maxBytes`, so no chunk size here can exceed its cap and the whole
 * file is never held in memory.
 *
 * @module @local/dsh-preview-download
 */

/** Absolute pathname the Host registers; `GET` and `HEAD` both answer it. */
export const ROUTE_PATH = '/api/preview-download'

/**
 * Document-relative form of {@link ROUTE_PATH}, which is what the browser
 * addresses. The browser half cannot import this module — it is a separate
 * plain-JavaScript artifact in the module table — so its own copy of the path
 * must stay in step with this one.
 */
export const ROUTE_URL = ROUTE_PATH.slice(1)

/** Services required: the `/api` carrier, workspace file reads, and the Session→workspace lookup. */
export const inject = ['connection', 'workspaceFiles', 'typert']

/**
 * Register the download route; the registration is owned by the calling fiber.
 * @param ctx - Host context carrying the connection, file, and lookups services.
 */
export function apply(ctx) {
  ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: request => respond(ctx, request),
  })
}

/**
 * Answer one download request: `HEAD` reports the file's headers, `GET` streams it.
 * @param ctx - Host context carrying the workspace file service and lookups.
 * @param request - admitted request whose query names the Session and the path.
 * @returns the file as an attachment, or the refusal it earned.
 */
async function respond(ctx, request) {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const path = query.get('path')
  if (sessionId === null || sessionId === '' || path === null || path === '') {
    return new Response('sessionId and path query parameters are required', { status: 400 })
  }
  const scope = await resolveScope(ctx, sessionId)
  if (scope === undefined) return new Response('unknown session', { status: 404 })
  let stat
  try {
    stat = await ctx.workspaceFiles.stat(scope, path, request.signal)
  } catch (error) {
    return new Response(failureText(error), { status: failureStatus(error) })
  }
  const headers = {
    'content-type': 'application/octet-stream',
    'content-disposition': contentDisposition(stat.absolutePath),
    'cache-control': 'no-store',
    // A backend that cannot size the file omits the length; the stream still ends.
    ...stat.bytes === undefined ? {} : { 'content-length': String(stat.bytes) },
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(streamFile(ctx, scope, path, request.signal), { status: 200, headers })
}

/**
 * Resolve the Session's workspace scope through the same lookup the Remote
 * gateway uses for `workspaceFiles` calls, so the route reads under the
 * Session the browser named rather than a process-wide default.
 * @param ctx - Host context carrying the Typert lookup registry.
 * @param sessionId - Session identity received on the wire.
 * @returns the Session's file scope, or `undefined` when no such Session is known.
 */
async function resolveScope(ctx, sessionId) {
  const provider = ctx.typert.lookups.get('workspaceFileScope')
  if (provider === undefined) return undefined
  return await provider.resolve(sessionId)
}

/**
 * Stream the named file as successive byte windows.
 * @param ctx - Host context carrying the workspace file service.
 * @param scope - the addressed Session's file scope.
 * @param path - path as the browser named it, absolute or workspace-relative.
 * @param signal - request cancellation; a cancelled request stops reading.
 * @returns the file's bytes, window by window.
 */
function streamFile(ctx, scope, path, signal) {
  let offset = 0
  return new ReadableStream({
    async pull(controller) {
      let window
      try {
        // A range without `length` takes the service's configured window, so no
        // constant here can drift past its cap.
        window = await ctx.workspaceFiles.readBytes(scope, path, { range: { offset } }, signal)
      } catch (error) {
        controller.error(error)
        return
      }
      offset += window.data.length
      if (window.data.length > 0) controller.enqueue(window.data)
      // A window that reports EOF, or that carries nothing at all, ends the
      // stream; a short read never leaves `pull` looping without progress.
      if (window.eof || window.data.length === 0) controller.close()
    },
  })
}

/**
 * Name the attachment after the file the Host actually resolved.
 * @param absolutePath - absolute path reported by the workspace file service.
 * @returns a download disposition with an ASCII fallback and the RFC 5987 form.
 */
function contentDisposition(absolutePath) {
  const cut = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'))
  const name = (cut === -1 ? absolutePath : absolutePath.slice(cut + 1)) || 'download'
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Map one workspace file failure onto an HTTP status.
 * @param error - the failure a `workspaceFiles` call threw.
 * @returns the status the browser should see.
 */
function failureStatus(error) {
  switch (error?.code) {
    case 'workspace-file/not-found':
      return 404
    case 'workspace-file/not-regular-file':
    case 'workspace-file/outside-workspace':
    case 'workspace-file/too-large':
    case 'gateway/bad-request':
      return 400
    default:
      return 500
  }
}

/**
 * Describe one failure without inventing a reason the service did not give.
 * @param error - the failure a `workspaceFiles` call threw.
 * @returns the failure's code and message.
 */
function failureText(error) {
  if (!(error instanceof Error)) return String(error)
  const code = error.code
  return code === undefined ? error.message : `${code}: ${error.message}`
}
