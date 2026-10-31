/**
 * The codex CLI's stored credential, shared by the provider and the quota routes.
 *
 * Both halves read the same `auth.json`: the provider spends the token on model
 * requests, and the quota service reads usage and reset credits for the same
 * account. Keeping the read in one place means one definition of "logged in"
 * and one `exp` interpretation, so a token the provider would reject cannot
 * look fresh to the settings page.
 *
 * @module @local/dsh-codex-live/auth
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'

/** The codex credential file the request token is read from. */
export const AUTH_FILE = 'auth.json'

/**
 * The credential file for one codex home, shortened to `~/…` for display.
 *
 * The quota page prints this path when the credential is unusable, so it must
 * follow `codexHome`: a hardcoded default there would tell someone with a custom
 * directory to refresh a file that does not exist.
 * @param codexHome - directory holding `auth.json`.
 * @returns the path to show, with the user's home directory abbreviated.
 */
export function authFileDisplayPath(codexHome) {
  const path = join(codexHome, AUTH_FILE)
  const home = homedir()
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path
}

/**
 * Read the codex CLI's current credential.
 * @param codexHome - directory holding `auth.json`.
 * @returns the token with its source path and, for a JWT, its expiry, plus the
 * ChatGPT account id when the file carries one; undefined when the file or a
 * token is absent.
 */
export async function readCodexAuth(codexHome) {
  const path = join(codexHome, AUTH_FILE)
  let auth
  try {
    auth = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  // The account id is a routing header on every ChatGPT-surface request, not a
  // credential: an API-key login carries none, and the quota service treats
  // that absence as "this account has no plan", not "not logged in".
  const accountId = auth?.tokens?.account_id
  const origin = typeof accountId === 'string' ? { accountId } : {}
  const access = auth?.tokens?.access_token
  if (typeof access === 'string' && access.length > 0) {
    return { token: access, path, expiresAt: jwtExpiry(access), ...origin }
  }
  const key = auth?.OPENAI_API_KEY
  if (typeof key === 'string' && key.length > 0) return { token: key, path, expiresAt: undefined, ...origin }
  return undefined
}

/**
 * The `exp` claim of a JWT, in milliseconds, or undefined for any other token.
 * The claim is read, never verified: the provider is the only authority on the
 * token's validity, and this exists to fail early and in the user's language.
 * @param token - the bearer token.
 * @returns the expiry instant, or undefined when the token is not a JWT or carries no `exp`.
 */
export function jwtExpiry(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}
