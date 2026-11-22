'use strict'

const APP_RULES = `Rules:
- "index.html" is required and must be a complete HTML document.
- Keep CSS and JavaScript inline, or add .css and .js files.
- Store user data with localStorage.
- Keep it small, working, and pleasant to use.
- Never mention that you are an AI or how the app was made.

Graphics:
- Plain Canvas 2D and WebGL work with no library.
- Three.js is available as an ES module at vibed-lib://three/build/three.module.js

React, only if the app is genuinely stateful:
- vibed-lib://react/umd/react.production.min.js
- vibed-lib://react-dom/umd/react-dom.production.min.js
- vibed-lib://htm/dist/htm.umd.js (use htm tagged templates instead of JSX)

There is no network and no other library. Do not load anything else.`

const SYSTEM_PROMPT = `You build small web apps that run entirely offline inside a sandboxed browser frame.
Reply with JSON only. No prose and no markdown fences.
Shape: {"files":{"index.html":"<!doctype html>..."}}
${APP_RULES}`

function taskPrompt(instruction, hasSource) {
  const opening = hasSource
    ? 'The current app source is already in ./source. Change it in place.'
    : 'Create the app source in ./source.'

  return `You build small web apps that run entirely offline inside a sandboxed browser frame.
${opening}
Edit only files under ./source. Do not create files anywhere else. Do not delete source/index.html. Do not run commands.

${APP_RULES
  .split('\n')
  .map((line) => line.replace(/^"index\.html"/, 'source/index.html'))
  .join('\n')}

When you are done, reply with one short line saying what you changed. Do not print the files.

The request:

${instruction}
`
}

module.exports = { APP_RULES, SYSTEM_PROMPT, taskPrompt }
