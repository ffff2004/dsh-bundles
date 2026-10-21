# Preview path

Makes a path editable wherever the DSH Web UI shows one, and adds a directory
page so a path can be opened as a directory rather than only as a file.

## What it does

- **Document preview toolbar.** One control in
  `sidebar.right.tab.document.actions`, the seat owned by
  `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`. That seat renders for
  every file type the tab can show (text, code, markdown, HTML, image, PDF,
  Office, Excel), so one contribution covers them all. The pencil sits at the
  row's left edge (`order: -1`), in front of the path it edits, and a
  parent-directory button sits left of it (`order: -2`) and opens the directory
  page at the file's own directory; while the editor is open the preview's own
  `PathLabel` is hidden through its `data-textpreview-path` marker and the
  editor claims the row's flex slot.
- **File tree toolbar.** The same control in `sidebar.right.tab.files.actions`,
  the seat the file tree offers after its reload button, hiding that tree's
  `data-files-path` row while it edits.
- **Directory page.** A page type (`preview-path-directory`) whose header *is*
  the editable row: a folder icon and a guide entry ("Directory") open it at the
  Session's workspace root, its pencil or path opens any directory, its rows
  switch directories on click and hand files to the document preview. The page
  lists through `workspaceFiles.list` and binds the tab's refresh command.
  Directory tabs allow multiple instances, including multiple tabs for the
  same path in the same pane. Opening from the guide creates another instance.
- **Tab menu.** Any tab addressed at a file (a preview, including one whose
  metadata never resolved) gains "Open as directory" in its actions menu, which
  reopens that path as the directory page — the way out of a directory or
  missing path that the model linked and the preview could not read.

Submitting a path builds the `dsh-resource://file/session/<sessionId>/<path>`
address and asks the Host's `workspaceFiles.stat` what it is:

- a regular file opens in the document preview, replacing the tab the editor
  lives in (`replaceTab`);
- a non-regular path (a directory, or a link to one) opens the directory page,
  replacing that same tab;
- anything else stays in the editor with a localized reason.

Escape cancels. A relative path resolves against the addressed Session's
workspace root; absolute paths are handed to the Host unchanged (`~` is not
expanded). The toolbar's tab id is resolved from the editor element at submit
time with `sidebarRight.focusedTarget`, because those seats carry no tab id. The
Host half registers nothing: every read is the preview's and the file tree's own
`workspaceFiles` Remote, so the plugin adds no route, service, or extra access.

## Navigation policy

All ordinary path gestures navigate **in the source tab's place**: typing a
file or directory, clicking a directory row or a file row, going to the parent,
and choosing "Open as directory" in the tab menu. Every open carries
`replaceTab` and `revealIfOpened: false`: another tab already showing that file
or directory is never activated, changed, or closed by these gestures.

Directory tabs register `multiple: true`, rather than being unique per pane.
Their path comes only from `tab.navigation.params.path` (or the Session's cwd
when opened without params); there is no independent local path state.

The Host currently exposes no in-place page navigation method. Even a
subdirectory click therefore opens a new instance **replacing** its source:
a docked tab keeps its pane and strip position, but not its internal tab id.
This also rebinds the new page's refresh command and cancels the old reads.
Refresh itself only reloads; it does not navigate. Submitting the unchanged path
only leaves edit mode. Invalid input keeps the source and reports the failure.
The tab menu deliberately skips `stat`, letting the directory listing report
whether the path is a directory.

## Layout

| File | Role |
|---|---|
| `package.json` | Bundle manifest: `dsh.bundle.patch` plus the `dsh.client` browser row |
| `cordis.patch.yml` | Inserts the one plugin row |
| `index.js` | Host half: empty, the row exists to carry the Client row |
| `client.js` | Browser half: the shared editor, the directory page, the tab-menu item, and the address grammar |
| `check.mjs` | Self-check for the plugin surface, grammar, copy, tab type, menu item, and every slot registration |
| `navigation.test.mjs` | Real React behavioral tests for navigation intents, inputs, independent instances, refresh, cancellation, and stale targets (`pnpm test` runs both checks) |
| `locale/{en,zh}.json` | Display metadata for the Plugin Manager |

## Install and remove

Install through the Plugin Manager (`install_bundle` with this directory), then
reload the page once: the Host composes the new client entry into its graph, but
a page that was already open did not pick it up until reloaded. Later edits to
`client.js` are picked up by the bundle watcher without a reload. To undo,
`remove_bundle @local/dsh-preview-path`.

## Known limitations

- **A click on a directory address still lands on the preview's failure state.**
  Which tab type claims an address is decided synchronously (`canOpen(address)`
  is a predicate), so no plugin can tell a directory from a file at claim time;
  the tab menu's "Open as directory" is the way from there. Making the click
  itself open the directory page needs an upstream change (an asynchronous
  `canOpen`, or a claim that falls through when a resource fails to resolve).
- The path rows are not slots. The editor displaces the shipped `PathLabel` by
  its `data-textpreview-path` / `data-files-path` marker and the toolbar's flex
  row; a release that renames a marker or stops drawing the row as a flex
  sibling leaves the editor working but the original path visible beside it.
- The two toolbar controls exist only while their owner holds a resolved Host
  path — the same condition the download control uses. A preview that never
  resolved its metadata (an unknown workspace, a refused address) shows no path
  row, so the tab menu is the only entry point there.
- The file tree's root comes from the Session's working directory and its
  package exposes no re-root action, so submitting a directory from that toolbar
  replaces the tree tab with the directory page instead of re-rooting the tree.
- No completion, history, or validation while typing: one Host `stat` runs on
  Enter only. The directory page lists one level at a time, workspace-scoped, and
  shows the endpoint's entry cap when a listing is truncated.
- The directory page's parent button stops at the workspace root: a listing
  reports the listed directory relative to that root (empty for the root), so
  the page learns the floor from the listing it just received. A path whose
  listing failed keeps its syntactic parent, so it stays a way back from an
  outside or missing path. The preview toolbar's parent button has no listing to
  learn from, so previewing a file outside the workspace opens a parent the
  listing then refuses, with the path left editable.
- Navigation replaces the tab record; it is not a stable-id, back/forward
  browser history. The Host does not persist page navigation params with layout:
  undo, tab duplication, or restart restoration may lose a directory's path and
  show the workspace root instead. No plugin-owned persistence is added here.
- Replacing a floating tab currently opens its replacement in the active docked
  pane, not in the floating window. This is the Host's `replaceTab` behavior for
  file previews too; preserving a floating occurrence needs an upstream change.
