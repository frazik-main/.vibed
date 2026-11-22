# Architecture

## Pieces

```
Electron main (trusted)
  ├─ App store        apps/<id>/ on disk
  ├─ Generator        local OpenCode CLI when that provider is selected, else one chat-completions request
  ├─ App protocol     vibed-app://<id>/ serves source with a strict CSP
  ├─ Library protocol vibed-lib://<package>/ serves an allowlisted set of browser builds
  └─ Player window    React UI, context isolation, no Node
       └─ iframe      the app, sandboxed, separate origin
```

The UI is React 18 and TypeScript built by Vite. The main process is CommonJS. Pure logic that both tests and the main process use lives in `electron/core.cjs`.

## App folder

```
apps/<id>/
  app.json          id, name, intent, version, timestamps
  source/           index.html plus optional css/js
  data/data.json    the app's saved key/value data
  previous/<n>/     source and app.json before each accepted change
```

App folders live under Electron's `userData` directory. They are ordinary folders: copy one to move the app.

`previous/` keeps the last ten versions. There is no Git yet; see the roadmap.

## Creating and changing

**Create.** The UI sends the description to the main process. The main process calls the model, validates the returned file map, writes `source/`, and writes `app.json`.

**Change.** The main process reads the current source, sends it plus the instruction to the model, validates the new file map, copies the current version into `previous/`, then swaps in the new source.

Writes are staged into `source.new` and renamed into place, so a failed write does not leave a half-written app.

The model returns whole files, not patches. That keeps the transport trivial and makes validation strict. It is also the main quality risk.

## Runtime isolation

Apps are served from `vibed-app://<id>/index.html` and rendered in an iframe with `sandbox="allow-scripts allow-same-origin"`.

- The app origin is per app, so localStorage is not shared between apps.
- The app cannot reach the player window or the player's IPC bridge.
- Responses carry `connect-src 'none'`, so an app cannot make network requests.
- Only `index.html` receives injected bootstrap data; the rest is served as-is.

This is a useful boundary, not a hardened sandbox. The iframe has `allow-same-origin` because localStorage needs it, and Chromium is still the enforcement layer. A production runtime should use a separate process, OS-level containment for untrusted code, and a capability broker.

## Libraries available to apps

The shell serves a fixed, allowlisted set of browser builds from `vibed-lib://`:

| URL | Library |
|---|---|
| `vibed-lib://react/umd/react.production.min.js` | React 18 |
| `vibed-lib://react-dom/umd/react-dom.production.min.js` | ReactDOM 18 |
| `vibed-lib://htm/dist/htm.umd.js` | htm, a no-build JSX alternative |
| `vibed-lib://three/build/three.module.js` | Three.js |

Only files under the listed package folders are served, and `..` is rejected. The app frame's CSP allows `vibed-lib:` in `script-src`, and library responses allow cross-origin module imports.

The libraries come from the shell's `node_modules`, not from each app folder, so apps stay small and still work offline. Plain Canvas 2D and WebGL need no library, which means a small 2D or 3D game can be written with no dependency at all.

The set is fixed on purpose. There is no package manager at runtime and no arbitrary import.

## Data

Apps use `localStorage`. The shell injects the saved values before app scripts run, and the app posts a snapshot to the parent whenever it changes. The parent writes it to `data/data.json`.

That keeps data inside the app folder and independent of the code. It also means the model never sees or edits user data.

## Model boundary

OpenRouter is the default provider: one key against `https://openrouter.ai/api/v1`, any model id. Settings also list OpenCode, OpenAI, DeepSeek, Ollama on loopback, and a custom OpenAI-compatible endpoint. The CLI shortcut is only used when the OpenCode provider is selected; every other provider goes straight to its key path.

**Local OpenCode CLI.** At startup the main process asks `opencode --version`. If the OpenCode provider is selected and the CLI answers, creation and change run through `opencode run` in a throwaway workspace: a copy of `source/`, a `TASK.md` with the request, and an `opencode.json` that denies shell, web, subagents, and anything outside the workspace. The agent edits the copy; the result is read back and validated like any other model output. The CLI carries the user's own OpenCode sign-in, so free models work here and Vibed never handles a key.

**API key.** Otherwise generation posts one OpenAI-compatible request to the selected base URL with the user's own key. The key never enters the renderer and is stored with Electron `safeStorage` (DPAPI on Windows); `config.json` holds the provider, base URL, and model names, never the key.

Provider error codes are mapped to plain messages: 401 key, 402 credit, 404 model, 429 rate limit, 5xx provider failure.

## Generation jobs

One generation runs at a time. The main process streams stage lines to the renderer over `vibed:progress`, and `vibed:cancel` aborts the current request or kills the local OpenCode process tree. A cancelled job writes nothing: the last good source, `previous/`, and `data/data.json` stay untouched. The prompt stays in the input so the same request can be started again.

## Updates

The update check is a single unauthenticated request to the GitHub releases API, made only when the user clicks the version in the sidebar. It compares tags with `core.compareVersions` and, on a newer one, offers the release page. It cannot install anything: the build target is `portable`, which electron-updater does not support. The exported single-file apps carry their own copy of the shell and do not update with it.

The model is treated as an untrusted code generator:

- File paths are normalized and rejected for `..`, absolute paths, backslashes, reserved folders, and unsupported extensions.
- At most 40 files and 2 MB of source.
- `index.html` is required.
- Nothing the model writes can escape `source/`.

A model response is never authorization. It cannot grant capabilities or widen the runtime.

## Full screen

The shell has two states. Normal shows the sidebar and top bar. Immersive hides both, removes the frame padding, and asks Electron for window fullscreen, so the app owns the screen.

- A ⛶ button in the app top bar enters immersive mode.
- In immersive mode an **Update app** control sits in the bottom-right, styled like the editor, with a `Ctrl E` key hint. Clicking it leaves full screen and opens the change dialog. It is the one visible piece of shell UI over the app, and it exists to make the app's mutability discoverable.
- F11 is forwarded from inside the app and toggles full screen.
- Escape leaves full screen, handled at the window level so it works from inside the app frame.
- An exported app starts in immersive mode, because there is only one app to show.

The injected bootstrap forwards Ctrl+E and F11 from inside the app frame. Each message is checked against the app origin like the data messages.

## Export and import

`npm run dist` builds the shell with electron-builder's portable target and writes `release/Vibed.exe`.

**Export** builds a zip of `app.json` plus `source/`, then:

- In the packaged portable build, appends it to a copy of the running executable behind a footer.
- In the dev build, writes the zip on its own.

The footer is 68 bytes: magic, version, payload offset and length, SHA-256, end magic. `electron/core.cjs` reads and verifies it, and tests cover tampering and repeated export.

**Import** reads the footer when present, otherwise treats the file as a zip, validates every path, and creates a new app folder.

**First run of an exported app** extracts `source/` into a working app folder if one does not exist, then runs normally. If the folder already exists, edits are left alone.

## Security posture

What is true now:

- The renderer has no Node access.
- The app runs in a separate origin with no network.
- Model output is path-checked and size-checked.
- The API key stays in the main process.

What is not true yet:

- Exported executables are not signed.
- The app frame is not an OS sandbox.
- There is no permission system, so the runtime has a fixed, small surface rather than a brokered one.
- Imported files are not sandboxed during parsing.

These are roadmap items, not claims.
