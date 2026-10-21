/**
 * Preview path, Host half: nothing.
 *
 * The bundle's one row carries the package so its `dsh.client` declaration is
 * composed into the Web page; every behaviour lives in the browser half, which
 * opens files through the existing `workspaceFiles` Remote and the Sidebar's
 * own tab controller. No Host route, service, or configuration is added.
 *
 * @module @local/dsh-preview-path
 */

/** The Host row exists only to carry the Client row. */
export function apply() {}
