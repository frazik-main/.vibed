# Roadmap

Ordered by what most limits the idea today. Each step has an exit condition.

## 1. Finish the MVP

- Package the shell with `electron-builder`'s portable target. Done: `npm run dist` writes `release/Vibed.exe`.
- Verify that the portable launcher tolerates an appended payload and footer. Done: an exported app launched, unpacked, and auto-opened.
- Run the whole loop on a clean machine: create, change, export, double-click, change again.

**Exit:** one downloaded file, one generated app, one exported file, no install and no missing dependency.

## 2. Make the change loop trustworthy

- Replace whole-file regeneration with a real agent loop (OpenCode, pinned) that edits only what it needs.
- Add a smoke check per app: it loads, the console has no uncaught errors, the title matches.
- Keep a change only when the check passes; otherwise show the failure and the last good version.
- Measure the number that matters: after five consecutive changes, how often is the app still correct?

**Exit:** five changes in a row on ten apps, with a measured success rate and no silent breakage.

## 3. History

- One hidden local Git repository per app, no remotes.
- Linear commits on accept; `previous/` disappears.
- Restore from the app UI in plain language; show the diff on request.
- A commit message is the user's sentence plus a short summary.

**Exit:** restore any accepted version and its data from the UI.

## 4. Permissions and isolation

- A capability broker: `network`, `files`, `notifications`, each granted per app by the user.
- Move the app runtime to a separate process and an OS boundary.
- Quotas for CPU, memory, and stored bytes.
- Treat page content, console output, and model output as untrusted.

**Exit:** an app without a grant is denied at runtime, and the denial is tested.

## 5. Signing and trust

- Sign the shell and exported containers.
- Verify on open and show publisher and integrity state.
- Decide the policy for appended payloads, which invalidate a signature over the base executable.

**Exit:** a modified export is detected; an unsigned file is labelled honestly.

## 6. Smaller shell and real sharing

- Evaluate Tauri or a custom shell to cut app files from ~150 MB to tens of MB.
- A static registry or index before any hosted service.
- Forks carry a parent reference; updates are opt-in and never silent.

**Exit:** a recipient verifies the publisher, runs the pinned version, and forks without altering the original.

## 7. Games

- Canvas 2D and WebGL already work; Three.js is available from `vibed-lib://`.
- Deterministic test mode: seeded randomness, fixed clock, scripted input.
- Save-schema migration.
- Evaluate a shared 2D engine only if Canvas proves too thin.

**Exit:** a generated 2D or 3D game plays under scripted input in tests and keeps its saves across changes.

## Deliberately not planned

- Accounts, cloud sync, and a hosted editor.
- Running arbitrary native code or shell commands inside apps.
- Multiplayer authority.
- An app store with rankings and editorial curation.

Each of these turns a local, owned object into a platform relationship. If one becomes necessary, it should be justified against that cost.

## Open questions

- Does whole-file regeneration hold up for apps larger than a screen or two?
- What happens to user data when an app changes shape completely?
- Is one app per folder the right unit, or should one folder hold several shapes?
- How large a download will people accept for a single app file?
