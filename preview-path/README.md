# Preview path

Makes the document preview's path row editable in the DSH Web UI, so a file can
be previewed by typing its path instead of opening it from the conversation or
the file tree.

## What it does

- The browser half contributes one control to
  `sidebar.right.tab.document.actions`, the document-preview toolbar seat owned
  by `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`. That seat renders for
  every file type the tab can show (text, code, markdown, HTML, image, PDF,
  Office, Excel), so one contribution covers them all.
- The pencil sits at the path row's left edge (`order: -1`), in front of the
  path it edits. Clicking it opens an editor in that row's own space. While it
  is open, the preview's `PathLabel` is hidden through its `data-textpreview-path`
  marker and the editor claims the row's flex slot (`order: -1; flex: 1`).
  Closing the editor removes the marker, so the shipped row is untouched the
  rest of the time.
- Typing a path and pressing Enter builds the
  `dsh-resource://file/session/<sessionId>/<path>` address the preview tab is
  addressed by, asks the Host's `workspaceFiles.stat` whether that path is a
  readable regular file, and only then opens it with
  `ctx.sidebarRight.openResource(address, { replaceTab })` — the current tab is
  replaced, not duplicated. Escape cancels, and a refused path stays in the
  editor with a localized reason instead of replacing the tab with a failure
  page.
- A relative path resolves against the addressed Session's workspace root;
  absolute paths are handed to the Host unchanged (`~` is not expanded). The
  tab to replace is resolved from the editor element at submit time with
  `sidebarRight.focusedTarget`, because the toolbar seat carries no tab id.
- The Host half registers nothing. Files are read by the preview's own
  `workspaceFiles` Remote, so this plugin adds no route, no service, and no
  extra access: a path it opens is a path the preview itself could read.

## Layout

| File | Role |
|---|---|
| `package.json` | Bundle manifest: `dsh.bundle.patch` plus the `dsh.client` browser row |
| `cordis.patch.yml` | Inserts the one plugin row |
| `index.js` | Host half: empty, the row exists to carry the Client row |
| `client.js` | Browser half: the toolbar control, the inline editor, and the address grammar |
| `check.mjs` | Self-check for the plugin surface, address grammar, copy, and slot registration (`node check.mjs`) |
| `locale/{en,zh}.json` | Display metadata for the Plugin Manager |

## Install and remove

Install through the Plugin Manager (`install_bundle` with this directory), then
reload the page once: the Host composes the new client entry into its graph, but
a page that was already open did not pick it up until reloaded. To undo,
`remove_bundle @local/dsh-preview-path`.

## Known limitations

- The path row is not a slot. The editor displaces the shipped `PathLabel` by
  its `data-textpreview-path` marker and the toolbar's flex row; a release that
  renames the marker or stops drawing the row as a flex sibling leaves the
  editor working but the original path visible beside it.
- No completion, history, or validation while typing: one Host `stat` runs on
  Enter only.
- The control exists only while the preview holds a resolved Host path — the
  same condition the download control uses. A preview that never resolved its
  metadata (an unknown workspace, a refused address) shows no path row and so
  no editor.
- Replacing the tab drops the previous file from the sidebar history; reopen it
  from the conversation or the file tree.
- The editor hides only the preview it belongs to (the marker is set on that
  preview's root), so another pane keeps its own path row while this one edits.
