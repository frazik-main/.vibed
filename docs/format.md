# Format

Two things are specified here: the app folder, and the portable container used to send an app as one file.

## App folder

```
<app-id>/
  app.json
  source/
    index.html
  data/
    data.json
  previous/
    1/
      app.json
      source/
```

### app.json

```json
{
  "id": "my-habit-tracker",
  "name": "My Habit Tracker",
  "intent": "A quiet habit tracker that celebrates small wins.",
  "version": 3,
  "createdAt": "2026-10-18T09:00:00.000Z",
  "updatedAt": "2026-10-18T09:20:00.000Z"
}
```

- `id` is lowercase, hyphen-separated, and also the folder name and the protocol hostname.
- `version` increments once per accepted change. It is not semver.
- `intent` is the original description. It travels with the app so a later change has context.

### source/

A complete web app. `index.html` is required at the root.

Allowed file types: `html`, `css`, `js`, `mjs`, `json`, `svg`, `md`, `txt`.

Rejected:

- absolute paths, backslashes, and empty segments;
- `.` and `..` segments;
- the `data/` and `previous/` folders;
- more than 40 files, or more than 2 MB of source.

The app runs with no network. Anything it needs must be inside `source/`.

### data/

`data.json` is an object of string keys and string values, mirroring `localStorage`. It is written by the shell and never read or edited by the model.

### previous/

One folder per accepted change, named by the version it replaced. The shell keeps the last ten. This is the undo buffer, not a history format.

## Portable container

An exported app file is the shell executable with an archive appended and a footer at the end.

```
[ shell executable ][ payload zip ][ footer 68 bytes ]
```

The payload zip is:

```
app.json
source/index.html
source/...
```

### Footer

| Offset | Size | Value |
|---|---|---|
| 0 | 8 | `VIBEDPAY` |
| 8 | 4 | format version, `1`, little-endian |
| 12 | 8 | payload offset from file start |
| 20 | 8 | payload length |
| 28 | 32 | SHA-256 of the payload |
| 60 | 8 | `VIBEDEND` |

Rules:

- A reader must check both magics, the version, the bounds, and the digest.
- Re-exporting strips the old payload and footer instead of appending a second one.
- If the footer is absent, the file is treated as a plain zip.

The payload is what makes the file self-unpacking: on first run the shell extracts `source/` into a working app folder beside the user's other apps, then runs it.

## Versioning

- App folder format version 1: the layout above.
- Container format version 1: the footer above.
- Both are bumped when a reader could misinterpret an older file.

There is no `.vibed` bundle format anymore. The folder is the portable artifact, and the container is how it is delivered.

## Library surface

Libraries such as React and Three.js are not part of an app folder. The shell serves them from `vibed-lib://` and the app imports them by URL. This keeps app folders small and identical to what the user edits.

An app that uses a library records the URL in its own source, so the code reads normally:

```html
<script src="vibed-lib://react/umd/react.production.min.js"></script>
<script src="vibed-lib://htm/dist/htm.umd.js"></script>
```

or, for Three.js:

```js
import * as THREE from 'vibed-lib://three/build/three.module.js'
```

The trade-off is that an exported app depends on the shell version that produced it for those URLs. That is acceptable while the shell is the runtime; a future format can pin library versions if apps need to outlive shell upgrades.

## Not in the format yet

- Capability declarations.
- Tests and checks.
- Signatures and provenance.
- Git history in the folder.

These are additive. A capability list or a checks folder can be added without changing how apps run.
