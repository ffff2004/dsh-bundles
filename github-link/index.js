import { readGithubLinks } from './remotes.js'

export const inject = ['connection', 'remoteAccess', 'workspaceRegistry']
export const ROUTE_PATH = '/api/github-link'

export function apply(ctx) {
  // rc.3's shared Connection Fetch dispatcher authenticates the request and
  // admits only its owner Peer to exact Fetch routes, before invoking us.
  ctx.connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request => respond(ctx, request),
  })
}

async function respond(ctx, request) {
  const query = new URL(request.url).searchParams
  const workspaceId = query.get('workspaceId')
  if (query.size !== 1 || !workspaceId || workspaceId.length > 256) {
    return json({ error: 'workspaceId is required' }, 400)
  }

  // An exact Fetch handler receives no Peer argument. The carrier guarantees
  // owner admission; keep the access decision bound to this one workspace.
  const decision = ctx.remoteAccess.decide({
    principal: ctx.connection.browserPeer.principal,
    action: 'github-link/links',
    resources: [{ kind: 'workspace', id: workspaceId }],
    args: { workspaceId },
  })
  if (decision.kind !== 'allow') return json({ error: 'forbidden' }, 403)

  const workspace = ctx.workspaceRegistry.get(workspaceId)
  if (!workspace) return json({ error: 'workspace not found' }, 404)
  return json({ links: await readGithubLinks(workspace.path, request.signal) })
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
