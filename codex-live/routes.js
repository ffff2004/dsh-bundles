/**
 * The two exact `/api` routes the Codex quota page talks to.
 *
 * They are Fetch handlers, not a framework surface: `index.js` registers them on
 * the Connection's `/api` channel (owner-only, Host/Origin fenced) and this
 * module owns the HTTP contract — status codes, JSON bodies, and the fact that
 * the read answers every domain outcome with 200.
 *
 * Kept apart from the service so the mapping is testable without a Host context:
 * the service decides *what* the account looks like, this module decides how a
 * browser sees it.
 *
 * @module @local/dsh-codex-live/routes
 */

/**
 * Build both handlers over one quota service.
 * @param {{ snapshot: (options?: { refresh?: boolean }) => Promise<object>, consume: (input: { redeemRequestId: string, creditId: string }) => Promise<object> }} quota
 *   the service created by `createQuotaService`.
 * @returns {{ read: (request: Request) => Promise<Response>, consume: (request: Request) => Promise<Response> }}
 *   the handlers `index.js` registers.
 */
export function quotaRoutes(quota) {
  return {
    /**
     * Answer one snapshot read. Every domain outcome (including "not logged in"
     * and upstream failures) is a 200 with a `status`: the page switches on that
     * value, and a non-2xx would reach it as an unparsed blob.
     * @param request - the admitted GET request.
     * @returns the JSON snapshot.
     */
    read: async (request) => {
      const refresh = new URL(request.url).searchParams.get('refresh') === '1'
      return jsonResponse(200, await quota.snapshot({ refresh }))
    },

    /**
     * Spend one reset credit.
     * @param request - the admitted POST request with a JSON body.
     * @returns 200 with the outcome, 400 for a malformed request, 502 when the
     *   upstream refused or the transport failed.
     */
    consume: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return jsonResponse(400, { error: 'invalid-request' })
      }
      try {
        return jsonResponse(200, await quota.consume({
          redeemRequestId: body?.redeemRequestId,
          creditId: body?.creditId,
        }))
      } catch (error) {
        // Only the message crosses; the service already guarantees it carries no
        // token and no upstream body.
        const detail = error instanceof Error ? error.message : 'codex-live: redemption failed'
        return error?.code === 'invalid'
          ? jsonResponse(400, { error: 'invalid-request', detail })
          : jsonResponse(502, { error: 'upstream-error', detail })
      }
    },
  }
}

/**
 * A JSON response the browser half can read; these routes never cache.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 * @returns the response with the headers both routes share.
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
