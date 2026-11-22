'use strict'

const path = require('node:path')
const fs = require('node:fs/promises')
const { spawn } = require('node:child_process')

const core = require('./core.cjs')
const { taskPrompt } = require('./prompt.cjs')

// The CLI is optional. When it is on PATH we use it: it carries the user's own
// OpenCode sign-in, so the free models work and Vibed never sees a key.
const PROBE_TIMEOUT = 15_000
const RUN_TIMEOUT = 5 * 60 * 1000
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/#-]*$/

// Everything the agent may touch. The app source is a copy, so a failed change
// is thrown away with the workspace.
const PERMISSIONS = [
  { action: 'external_directory', resource: '*', effect: 'deny' },
  { action: 'shell', resource: '*', effect: 'deny' },
  { action: 'webfetch', resource: '*', effect: 'deny' },
  { action: 'websearch', resource: '*', effect: 'deny' },
  { action: 'subagent', resource: '*', effect: 'deny' },
  { action: 'question', resource: '*', effect: 'deny' },
  { action: 'read', resource: '*', effect: 'allow' },
  { action: 'edit', resource: '*', effect: 'allow' },
  { action: 'glob', resource: '*', effect: 'allow' },
  { action: 'grep', resource: '*', effect: 'allow' },
]

const TASK_FILE = 'TASK.md'
const CONFIG_FILE = 'opencode.json'
const TASK_MESSAGE = 'Follow the instructions in TASK.md'

let probed = null

function spawnCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      // Windows resolves `opencode` to its npm .cmd shim, which needs a shell.
      // Every argument here is a constant or an already-validated model id.
      shell: process.platform === 'win32',
      windowsHide: true,
      // An open stdin pipe makes the CLI wait for input instead of running.
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout,
      killSignal: 'SIGKILL',
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const onAbort = () => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        // The process is already gone.
      }
    }

    const finish = (callback) => {
      if (settled) return
      settled = true
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      callback()
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-200_000)
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-200_000)
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code, signal) => finish(() => resolve({ code, signal, stdout, stderr })))

    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

async function probeOpencode({ refresh = false } = {}) {
  if (probed && !refresh) return probed

  try {
    const { code, stdout, stderr } = await spawnCapture('opencode', ['--version'], {
      timeout: PROBE_TIMEOUT,
    })
    const match = `${stdout}\n${stderr}`.match(/(\d+\.\d+\.\d+)/)
    probed = { available: code === 0 && Boolean(match), version: match ? match[1] : '' }
  } catch {
    probed = { available: false, version: '' }
  }
  return probed
}

async function writeTree(root, source) {
  await fs.mkdir(root, { recursive: true })
  for (const [relative, content] of Object.entries(source || {})) {
    const safe = core.normalizePath(relative)
    const full = path.resolve(root, safe)
    if (!full.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error(`Unsafe file path: ${relative}`)
    }
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, 'utf8')
  }
}

async function readTree(root, prefix = '', out = {}) {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await readTree(root, relative, out)
    } else if (entry.isFile()) {
      out[relative] = await fs.readFile(path.join(root, relative), 'utf8')
    }
  }
  return out
}

function failureMessage({ code, signal, stderr, stdout }) {
  if (signal) return 'The local OpenCode run was stopped before it finished.'
  const text = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter((line) => line && !line.startsWith('>') && !line.startsWith('←') && !line.startsWith('→'))
    .pop()
  return text
    ? `OpenCode did not finish the change: ${text}`
    : `OpenCode did not finish the change (exit ${code}).`
}

/**
 * Copies the app source into a throwaway workspace, lets the local OpenCode
 * agent edit it, and returns the validated file map. Nothing outside the
 * workspace is touched.
 */
async function generateWithOpencode({ workspace, instruction, source, model, signal }) {
  if (!MODEL_PATTERN.test(String(model || ''))) {
    throw new Error('The OpenCode CLI model name is not valid.')
  }

  const sourceRoot = path.join(workspace, 'source')
  const hasSource = Boolean(source && Object.keys(source).length > 0)

  await writeTree(sourceRoot, source)
  await fs.writeFile(
    path.join(workspace, CONFIG_FILE),
    `${JSON.stringify({ permissions: PERMISSIONS }, null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(workspace, TASK_FILE),
    taskPrompt(instruction, hasSource),
    'utf8',
  )

  const result = await spawnCapture(
    'opencode',
    ['run', '--standalone', '--auto', '--model', String(model), '--format', 'json', TASK_MESSAGE],
    { cwd: workspace, timeout: RUN_TIMEOUT, signal },
  )

  if (result.code !== 0) throw new Error(failureMessage(result))

  const files = await readTree(sourceRoot)
  return core.normalizeFiles(files)
}

module.exports = { generateWithOpencode, probeOpencode, RUN_TIMEOUT }
