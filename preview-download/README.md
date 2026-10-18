# Preview download

Adds a download control to the Document preview toolbar in the DSH Web UI, so a
previewed workspace file can be saved through the browser's own download
manager.

## What it does

- The browser half contributes one control to
  `sidebar.right.tab.document.actions`, the document-preview toolbar seat owned
  by `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`. That seat renders for
  every file type the tab can show (text, code, markdown, HTML, image, PDF,
  Office, Excel), so one contribution covers them all.
- The control is an `<a href="…" download="…">` with the file's download URL.
  An ordinary click `HEAD`s `api/preview-download` first, then starts a same-origin
  download navigation. The preflight turns a refusal into a visible failure on
  the control instead of an empty save. Context-menu actions (including "Save
  link as") and modified clicks use the real link directly without a preflight.
- The Host half registers `GET`/`HEAD /api/preview-download` on the shared
  `/api` channel, so the Connection service's Host/Origin fence and browser
  authentication apply before the handler runs.
- Bytes come from `ctx.workspaceFiles` under the addressed Session's file scope
  — the same service and resolution the preview tab reads through — streamed as
  successive windows, each capped by that service's own `maxBytes`. Nothing
  caps the download at a constant chosen here, and the whole file is never held
  in memory.

## Layout

| File | Role |
|---|---|
| `package.json` | Bundle manifest: `dsh.bundle.patch` plus the `dsh.client` browser row |
| `cordis.patch.yml` | Inserts the one plugin row |
| `index.js` | Host half: the authenticated download route |
| `client.js` | Browser half: the toolbar control |
| `check.mjs` | Self-check for the host route against a temporary file (`node check.mjs`) |

## Install and remove

Installed through the Plugin Manager (`install_bundle` with this directory). To
undo, `remove_bundle @local/dsh-preview-download` and restart the profile.

## Known limitations

- The route serves what the preview can read, no more and no less: it does not
  add confinement to the workspace, because the preview itself reads paths
  outside it. Access is gated by the same browser authentication as every other
  `/api` route.
- The browser half cannot import the host half, so the route path is written in
  both `index.js` (`ROUTE_PATH`) and `client.js` (`ROUTE_URL`); changing one
  requires changing the other.
- A failed gesture reports only on the control (error color, tooltip, and a
  polite status announcement); a richer toast would require copying the
  host `Toast` primitive, which persistent plugins must not load as a module.
