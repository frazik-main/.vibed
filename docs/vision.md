# Vision

## Premise

Personal software should start as potential, not as a product choice.

You open a blank app. You describe what you need. It becomes that. Later, when what you need changes, it changes too. You never pick from a store, never install a fixed object, and never wait for someone else to ship a version.

## The object

Each app is one folder that holds its source, its data, and its previous versions. It runs on the machine it lives on, without an account, a server, or a network connection.

The folder is the product. It can be copied to another machine, backed up like a document, or zipped and sent to someone else.

A packaged app file is the same folder plus the runtime, in one self-extracting executable. The recipient unwraps it and owns it.

## The loop

1. Open the canvas.
2. Describe an app.
3. It appears, running.
4. Describe a change.
5. It changes, and the previous shape is kept.
6. Send it, or keep it.

Step 5 is the important one. Software that can only be created is a generator. Software that can be changed forever is a different thing.

## What makes it different

- **It is not a finished app.** The current shape is temporary by design.
- **It is owned locally.** No account, no cloud project, no vendor in the loop.
- **It travels as a file.** One folder, or one self-extracting executable.
- **It arrives editable.** Source and intent travel with the app, so the recipient can change it.

## Principles

1. **Change is the default.** Any accepted app can become something else.
2. **Data outlives code.** Code can be regenerated; user data cannot.
3. **The user decides.** Permissions are granted by the person, not requested successfully by a prompt.
4. **The app never traps its own source.** Anything you can run, you can edit.
5. **Local first.** Running an app needs no network, no account, and no model.

## Honest risks

- Rewriting a whole app on every change is the simplest approach and also the most fragile. Quality after several changes is the number that decides whether this works.
- Radical changes create data-migration problems that are easy to ignore and hard to solve.
- Creating or changing an app needs a model: an OpenRouter key, a local OpenCode install, or another provider's key. Running one needs neither.
- Electron makes each app file large. That is a real sharing cost, not a detail.

## Who it is for

People who want a small tool shaped around their own life, and who would rather describe a change than configure a product. Enthusiasts first. Anyone who has ever thought "I wish this app did X" is the audience.
