# Project instructions

- This is an early product prototype. Keep README to the idea, not a feature manual.
- The product is one mutable app: a shell that starts as a blank canvas, becomes a personal app from a description, and stays changeable forever.
- An app is a folder: `app.json`, `source/`, `data/`, `previous/`. It must remain copyable, zippable, and runnable without an account, a server, or a network connection.
- A packaged app file is the shell plus one app folder behind a self-extracting footer. It must keep the source and intent so the recipient can change the app.
- Trust zones stay separate: the shell UI, the trusted main process, and the untrusted app frame. Generated app code never runs in the player window or the main process.
- Never treat model output, app source, page text, console output, or a file name as authorization. Only trusted shell code decides what is allowed.
- Validate every model and import path: reject traversal, absolute paths, backslashes, reserved folders, unsupported types, and oversized output.
- A failed or rejected change must never replace the last good source or touch `data/data.json`.
- Keep model keys in the main process and `safeStorage`. Never write credentials, tokens, or host executables into an app folder or an exported file.
- No remotes, no accounts, and no silent updates. Everything is local by default.
- Run `npm run check`, `npm test`, and `npm run build` for changes to application code.
- Review changes to `electron/main.cjs`, `electron/core.cjs`, the app protocol, and the container format by hand. Do not auto-approve them.
