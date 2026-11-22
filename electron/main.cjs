'use strict'

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { app, BrowserWindow, ipcMain, protocol, safeStorage, dialog, shell } = require('electron')
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate')

const core = require('./core.cjs')
const generator = require('./generator.cjs')
const { SYSTEM_PROMPT } = require('./prompt.cjs')

const developmentUrl = process.env.VITE_DEV_SERVER_URL
const APP_SCHEME = 'vibed-app'
const LIB_SCHEME = 'vibed-lib'

const LIBRARIES = {
  react: ['umd/'],
  'react-dom': ['umd/'],
  htm: ['dist/'],
  three: ['build/'],
}

let portableAppId = null
let activeJob = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: LIB_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

function appsRoot() {
  return path.join(app.getPath('userData'), 'apps')
}

function appDir(id) {
  return path.join(appsRoot(), id)
}

function sourceDir(id) {
  return path.join(appDir(id), 'source')
}

function metaFile(id) {
  return path.join(appDir(id), 'app.json')
}

function dataFile(id) {
  return path.join(appDir(id), 'data', 'data.json')
}

function configFile() {
  return path.join(app.getPath('userData'), 'config.json')
}

function keyFile() {
  return path.join(app.getPath('userData'), 'model-key.bin')
}

const DEFAULT_CONFIG = {
  provider: core.OPENROUTER.id,
  baseUrl: core.OPENROUTER.baseUrl,
  model: core.OPENROUTER.model,
  cliModel: core.OPENCODE_CLI_MODEL,
}

function providerById(id) {
  const known = core.PROVIDERS.find((provider) => provider.id === id)
  return known || core.OPENROUTER
}

async function readConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(configFile(), 'utf8'))
    const provider = providerById(typeof parsed.provider === 'string' ? parsed.provider : '')
    const baseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : provider.baseUrl
    const model = typeof parsed.model === 'string' ? parsed.model.trim() : provider.model
    const cliModel =
      typeof parsed.cliModel === 'string' && parsed.cliModel.trim()
        ? parsed.cliModel.trim()
        : DEFAULT_CONFIG.cliModel
    return {
      provider: provider.id,
      baseUrl,
      model,
      cliModel,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

async function writeConfig(next) {
  const provider = providerById(String(next?.provider || DEFAULT_CONFIG.provider).trim())
  const baseUrl = String(next?.baseUrl ?? provider.baseUrl).trim()
  const model = String(next?.model ?? provider.model).trim()
  const cliModel = String(next?.cliModel || DEFAULT_CONFIG.cliModel).trim()
  await fs.mkdir(path.dirname(configFile()), { recursive: true })
  await fs.writeFile(
    configFile(),
    `${JSON.stringify({ provider: provider.id, baseUrl, model, cliModel }, null, 2)}\n`,
    'utf8',
  )
  return { provider: provider.id, baseUrl, model, cliModel }
}

function readKey() {
  try {
    const raw = fsSync.readFileSync(keyFile())
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(raw)
    return raw.toString('utf8')
  } catch {
    return ''
  }
}

function writeKey(value) {
  const text = String(value || '')
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text)
    : Buffer.from(text, 'utf8')
  fsSync.writeFileSync(keyFile(), data)
}

async function publicConfig() {
  const config = await readConfig()
  const opencode = await generator.probeOpencode()
  return {
    ...config,
    hasKey: readKey().length > 0,
    opencode,
    version: app.getVersion(),
  }
}

function parseJsonObject(text) {
  let value = String(text).trim()
  if (value.startsWith('```')) {
    value = value.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '')
  }
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The model did not return JSON.')
  return JSON.parse(value.slice(start, end + 1))
}

function modelErrorMessage(status, detail) {
  const suffix = detail ? ` ${detail}` : ''
  if (status === 401) return `The provider rejected the key (401).${suffix}`
  if (status === 402) return `The provider says the account is out of credit (402).${suffix}`
  if (status === 403) return `The provider refused the request (403).${suffix}`
  if (status === 404) {
    return `The model or endpoint was not found (404). Check the model name and base URL.${suffix}`
  }
  if (status === 429) return `The provider is rate limiting (429). Try again shortly.${suffix}`
  if (status >= 500) return `The provider had a server error (${status}). Try again.${suffix}`
  return `The model request failed (${status}).${suffix}`
}

async function callModel(messages, job) {
  const config = await readConfig()
  const key = readKey()
  if (!key) throw new Error('Add a key for this provider in Settings first.')
  if (!config.baseUrl) throw new Error('Set a base URL in Settings first.')
  if (!config.model) throw new Error('Set a model in Settings first.')

  // Reasoning models reject or ignore sampling and JSON-mode parameters.
  const reasoning = /reasoner|deepseek-r1/i.test(config.model)
  const body = {
    model: config.model,
    messages,
    max_tokens: 8192,
  }
  if (!reasoning) {
    body.temperature = 0.4
    if (config.provider === 'openai' || config.provider === 'deepseek') {
      body.response_format = { type: 'json_object' }
    }
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: job?.controller.signal,
    })
  } catch (error) {
    if (job?.cancelled || error?.name === 'AbortError') throw cancelledError()
    throw new Error('Could not reach the model. Check the base URL and your connection.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const failure = await response.json()
      detail = failure?.error?.message || ''
    } catch {
      // The provider returned a non-JSON error.
    }
    throw new Error(modelErrorMessage(response.status, detail))
  }

  const payload = await response.json()
  const choice = payload?.choices?.[0]
  if (choice?.finish_reason === 'length') {
    throw new Error(
      'The model ran out of room before finishing. Ask for a smaller app or a smaller change.',
    )
  }

  const text = choice?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('The model returned an unexpected response.')
  }
  return parseJsonObject(text)
}

/**
 * One tiny prompt, so settings can show whether the chosen model answers.
 * The local CLI path costs nothing, so it is reported without a request.
 */
async function testModel() {
  const config = await readConfig()
  const probe = await generator.probeOpencode()

  if (config.provider === 'opencode' && probe.available) {
    return {
      via: 'opencode',
      model: config.cliModel,
      detail: `local OpenCode ${probe.version}`,
    }
  }

  const label = providerById(config.provider).label
  if (!config.baseUrl) throw new Error('No base URL saved. Open Model settings and add one.')
  if (!config.model) throw new Error('No model saved. Open Model settings and add one.')

  const key = readKey()
  if (!key) throw new Error(`No ${label} key saved. Paste one in Model settings.`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  let response
  try {
    response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    throw new Error(
      error?.name === 'AbortError'
        ? 'No answer within 20 seconds. Check the base URL and the key.'
        : 'Could not reach the model. Check the base URL and your connection.',
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const failure = await response.json()
      detail = failure?.error?.message || ''
    } catch {
      // The provider returned a non-JSON error.
    }
    throw new Error(modelErrorMessage(response.status, detail))
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('The model answered, but not with JSON. Check the base URL.')
  }
  if (!Array.isArray(payload?.choices) || payload.choices.length === 0) {
    throw new Error('The model answered, but not with a chat completion. Check the base URL.')
  }

  return { via: 'key', model: config.model, detail: label }
}

const RELEASES_REPO = 'frazik-main/.vibed'

async function checkForUpdate() {
  const current = app.getVersion()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let response
  try {
    response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `Vibed/${current}`,
      },
      signal: controller.signal,
    })
  } catch {
    throw new Error('Could not reach GitHub. Check your connection.')
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 404) {
    throw new Error('This build has no public release to compare against yet.')
  }
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status}. Try again later.`)
  }

  const release = await response.json()
  const latest = String(release?.tag_name || '').replace(/^v/i, '')
  if (!latest) throw new Error('The latest release has no version tag.')
  return {
    current,
    latest,
    url: `https://github.com/${RELEASES_REPO}/releases`,
    available: core.compareVersions(latest, current) > 0,
  }
}

function fileMapFrom(parsed) {
  const map = parsed && typeof parsed === 'object' && parsed.files ? parsed.files : parsed
  return core.normalizeFiles(map)
}

async function writeSource(id, files) {
  if (!files['index.html']) throw new Error('An app must contain index.html.')

  const target = sourceDir(id)
  const staging = `${target}.new`
  const previous = `${target}.old`

  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })

  try {
    for (const [relative, content] of Object.entries(files)) {
      const safe = core.normalizePath(relative)
      const full = path.resolve(staging, safe)
      if (!full.startsWith(`${path.resolve(staging)}${path.sep}`)) {
        throw new Error(`Unsafe file path: ${relative}`)
      }
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, 'utf8')
    }

    await fs.rm(previous, { recursive: true, force: true })
    let hadPrevious = false
    try {
      await fs.rename(target, previous)
      hadPrevious = true
    } catch {
      // Nothing accepted yet.
    }

    try {
      await fs.rename(staging, target)
    } catch (error) {
      if (hadPrevious) await fs.rename(previous, target)
      throw error
    }
    await fs.rm(previous, { recursive: true, force: true })
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

async function readSource(id) {
  const root = sourceDir(id)
  const files = {}

  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, relative)
      else if (entry.isFile()) files[relative] = await fs.readFile(full, 'utf8')
    }
  }

  await walk(root, '')
  return files
}

async function readMeta(id) {
  return JSON.parse(await fs.readFile(metaFile(id), 'utf8'))
}

async function writeMeta(id, meta) {
  await fs.writeFile(metaFile(id), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

async function uniqueId(base) {
  let id = base
  let counter = 2
  for (;;) {
    try {
      await fs.access(appDir(id))
      id = `${base}-${counter}`
      counter += 1
    } catch {
      return id
    }
  }
}

async function backupVersion(id, meta) {
  const previousRoot = path.join(appDir(id), 'previous')
  const target = path.join(previousRoot, String(meta.version))
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await fs.cp(sourceDir(id), path.join(target, 'source'), { recursive: true })
  await fs.writeFile(path.join(target, 'app.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

  const versions = (await fs.readdir(previousRoot))
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b))
  while (versions.length > 10) {
    const oldest = versions.shift()
    await fs.rm(path.join(previousRoot, oldest), { recursive: true, force: true })
  }
}

async function readData(id) {
  try {
    return JSON.parse(await fs.readFile(dataFile(id), 'utf8'))
  } catch {
    return {}
  }
}

async function writeData(id, data) {
  const text = `${JSON.stringify(data ?? {}, null, 2)}\n`
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
    throw new Error('That app is trying to save more data than the MVP allows.')
  }
  await fs.mkdir(path.dirname(dataFile(id)), { recursive: true })
  await fs.writeFile(dataFile(id), text, 'utf8')
}

async function listApps() {
  await fs.mkdir(appsRoot(), { recursive: true })
  const entries = await fs.readdir(appsRoot(), { withFileTypes: true })
  const apps = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      apps.push(await readMeta(entry.name))
    } catch {
      // A half-written folder is not an app.
    }
  }
  return apps.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function beginJob() {
  if (activeJob) throw new Error('Wait for the current app to finish, or cancel it.')
  const job = { controller: new AbortController(), cancelled: false }
  activeJob = job
  return job
}

function finishJob(job) {
  if (activeJob === job) activeJob = null
}

function cancelActiveJob() {
  if (!activeJob) return false
  activeJob.cancelled = true
  activeJob.controller.abort()
  return true
}

function cancelledError() {
  const error = new Error('Cancelled.')
  error.code = 'CANCELLED'
  return error
}

function makeProgress(sender) {
  return (text) => {
    if (!sender.isDestroyed()) sender.send('vibed:progress', String(text))
  }
}

function startHeartbeat(progress) {
  let seconds = 0
  const timer = setInterval(() => {
    seconds += 5
    progress(`Still working — ${seconds}s`)
  }, 5000)
  timer.unref?.()
  return () => clearInterval(timer)
}

async function generateFiles({ instruction, source, job, progress }) {
  const config = await readConfig()
  progress('Reading settings')
  progress('Checking for a local OpenCode install')
  const probe = await generator.probeOpencode()
  const hasSource = Boolean(source && Object.keys(source).length > 0)
  const stopHeartbeat = startHeartbeat(progress)

  try {
    // The local install only stands in for OpenCode. Another provider means the
    // user asked for that endpoint, so the key path answers.
    if (config.provider === 'opencode' && probe.available) {
      progress('Starting local OpenCode')
      const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vibed-generate-'))
      try {
        progress('Copying the app into a workspace')
        progress('OpenCode is working on it')
        const files = await generator.generateWithOpencode({
          workspace,
          instruction,
          source,
          model: config.cliModel,
          signal: job.controller.signal,
        })
        if (job.cancelled) throw cancelledError()
        progress('Reading the result')
        return { files, via: 'opencode' }
      } finally {
        await fs.rm(workspace, { recursive: true, force: true })
      }
    }

    if (!readKey()) {
      throw new Error(
        config.provider === 'opencode'
          ? 'Install OpenCode, or add an OpenCode key in Settings, before generating.'
          : `Add a key for ${providerById(config.provider).label} in Settings first.`,
      )
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      hasSource
        ? {
            role: 'user',
            content: `Here are the current files:\n${JSON.stringify(source)}\n\nChange the app like this:\n${instruction}\n\nReturn the complete updated file set as JSON. Keep everything that should not change.`,
          }
        : { role: 'user', content: `Build this app:\n${instruction}\n\nReturn the JSON now.` },
    ]

    progress(`Contacting ${providerById(config.provider).label}`)
    progress('Waiting for the model')
    const parsed = await callModel(messages, job)
    if (job.cancelled) throw cancelledError()
    progress('Checking the files')
    return { files: fileMapFrom(parsed), via: 'key' }
  } catch (error) {
    if (job.cancelled) throw cancelledError()
    throw error
  } finally {
    stopHeartbeat()
  }
}

async function createApp(input, job, progress = () => {}) {
  const intent = String(input?.intent || '').trim()
  if (!intent) throw new Error('Describe the app first.')

  const { files, via } = await generateFiles({ instruction: intent, source: null, job, progress })
  if (job?.cancelled) throw cancelledError()

  progress('Writing the app folder')
  const name = String(input?.name || '').trim() || core.titleFromIntent(intent)
  const id = await uniqueId(core.slugify(name))
  const now = new Date().toISOString()
  const meta = { id, name, intent, version: 1, createdAt: now, updatedAt: now }

  await fs.mkdir(path.join(appDir(id), 'data'), { recursive: true })
  await writeSource(id, files)
  await writeMeta(id, meta)
  await fs.writeFile(dataFile(id), '{}\n', 'utf8')

  return { meta, files, via }
}

async function reviseApp(id, instruction, job, progress = () => {}) {
  const text = String(instruction || '').trim()
  if (!text) throw new Error('Describe the change first.')

  progress('Reading the current app')
  const meta = await readMeta(id)
  const current = await readSource(id)
  const { files, via } = await generateFiles({ instruction: text, source: current, job, progress })
  if (job?.cancelled) throw cancelledError()

  progress('Writing the new version')
  await backupVersion(id, meta)
  await writeSource(id, files)

  const next = { ...meta, version: meta.version + 1, updatedAt: new Date().toISOString() }
  await writeMeta(id, next)
  return { meta: next, files, via }
}

function buildPayload(meta, files) {
  const entries = { 'app.json': strToU8(`${JSON.stringify(meta, null, 2)}\n`) }
  for (const [relative, content] of Object.entries(files)) {
    const safe = core.normalizePath(relative)
    entries[`source/${safe}`] = strToU8(content)
  }
  return Buffer.from(zipSync(entries, { level: 6 }))
}

function safeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'app'
}

function saveDialog(options) {
  const window = BrowserWindow.getFocusedWindow()
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
}

function openDialog(options) {
  const window = BrowserWindow.getFocusedWindow()
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
}

async function readPortableFile(file) {
  const size = (await fs.stat(file)).size
  if (size < core.FOOTER_SIZE) return null

  const handle = await fs.open(file, 'r')
  try {
    const footer = Buffer.alloc(core.FOOTER_SIZE)
    await handle.read(footer, 0, core.FOOTER_SIZE, size - core.FOOTER_SIZE)
    const info = core.parseFooter(footer)
    if (!info) return null
    if (info.offset + info.length > size - core.FOOTER_SIZE) return null

    const payload = Buffer.alloc(info.length)
    await handle.read(payload, 0, info.length, info.offset)
    if (!core.verifyPayload(payload, footer)) return null
    return payload
  } finally {
    await handle.close()
  }
}

async function importPayload(payload) {
  const entries = unzipSync(payload)
  const metaBytes = entries['app.json']
  if (!metaBytes) throw new Error('That file is not a Vibed app.')

  const parsed = JSON.parse(strFromU8(metaBytes))
  const id = core.slugify(parsed?.id || parsed?.name || 'app')
  const exists = await fs.access(appDir(id)).then(
    () => true,
    () => false,
  )
  const targetId = exists ? await uniqueId(id) : id

  const files = {}
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('source/')) continue
    const relative = name.slice('source/'.length)
    try {
      files[core.normalizePath(relative)] = strFromU8(bytes)
    } catch {
      // Ignore anything the model was never allowed to write.
    }
  }
  if (!files['index.html']) throw new Error('That file has no app source.')

  const now = new Date().toISOString()
  const meta = {
    id: targetId,
    name: String(parsed?.name || targetId),
    intent: String(parsed?.intent || ''),
    version: Number(parsed?.version) || 1,
    createdAt: String(parsed?.createdAt || now),
    updatedAt: now,
  }

  await fs.mkdir(path.join(appDir(targetId), 'data'), { recursive: true })
  await writeSource(targetId, files)
  await writeMeta(targetId, meta)
  await fs.writeFile(dataFile(targetId), '{}\n', 'utf8')

  return { meta, files }
}

async function preparePortable() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe) return null

  const payload = await readPortableFile(exe)
  if (!payload) return null

  const entries = unzipSync(payload)
  const metaBytes = entries['app.json']
  if (!metaBytes) return null

  const parsed = JSON.parse(strFromU8(metaBytes))
  const id = core.slugify(parsed?.id || parsed?.name || 'app')

  const alreadyHere = await fs.access(metaFile(id)).then(
    () => true,
    () => false,
  )
  if (alreadyHere) return id

  const files = {}
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('source/')) continue
    try {
      files[core.normalizePath(name.slice('source/'.length))] = strFromU8(bytes)
    } catch {
      // Ignore unsafe entries.
    }
  }
  if (!files['index.html']) return null

  const now = new Date().toISOString()
  const meta = {
    id,
    name: String(parsed?.name || id),
    intent: String(parsed?.intent || ''),
    version: Number(parsed?.version) || 1,
    createdAt: String(parsed?.createdAt || now),
    updatedAt: now,
  }

  await fs.mkdir(path.join(appDir(id), 'data'), { recursive: true })
  await writeSource(id, files)
  await writeMeta(id, meta)
  await fs.writeFile(dataFile(id), '{}\n', 'utf8')
  return id
}

async function exportApp(id) {
  const meta = await readMeta(id)
  const files = await readSource(id)
  const payload = buildPayload(meta, files)
  const basePath = process.env.PORTABLE_EXECUTABLE_FILE
  const baseDir = basePath ? path.dirname(basePath) : app.getPath('documents')
  const extension = basePath ? '.exe' : '.zip'

  const { canceled, filePath } = await saveDialog({
    title: 'Make app file',
    defaultPath: path.join(baseDir, `${safeFileName(meta.name)}${extension}`),
    filters: basePath
      ? [{ name: 'App', extensions: ['exe'] }]
      : [{ name: 'App bundle', extensions: ['zip'] }],
  })
  if (canceled || !filePath) return { cancelled: true, message: 'Nothing was written.' }

  if (basePath) {
    const base = await fs.readFile(basePath)
    await fs.writeFile(filePath, core.buildContainer(base, payload))
    return { cancelled: false, message: `Saved ${filePath}` }
  }

  await fs.writeFile(filePath, payload)
  return {
    cancelled: false,
    message: `Saved ${filePath}. In the packaged build this button writes a single .exe.`,
  }
}

const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' vibed-lib:",
  "style-src 'self' 'unsafe-inline' vibed-lib:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function installAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const id = url.hostname
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        return new Response('Not found', { status: 404 })
      }

      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
      const root = path.resolve(sourceDir(id))
      const full = path.resolve(root, relative)
      if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
        return new Response('Forbidden', { status: 403 })
      }

      let body
      try {
        body = await fs.readFile(full)
      } catch {
        return new Response('Not found', { status: 404 })
      }

      if (relative === 'index.html') {
        const data = await readData(id)
        body = Buffer.from(core.injectBootstrap(body.toString('utf8'), data), 'utf8')
      }

      return new Response(body, {
        headers: {
          'content-type': core.mimeFor(full),
          'content-security-policy': APP_CONTENT_SECURITY_POLICY,
          'cache-control': 'no-store',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function libraryPath(pkg, relative) {
  const prefixes = LIBRARIES[pkg]
  if (!prefixes) return null
  const parts = relative.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  if (!prefixes.some((prefix) => relative.startsWith(prefix))) return null
  return path.join(__dirname, '..', 'node_modules', pkg, ...parts)
}

function installLibraryProtocol() {
  protocol.handle(LIB_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const pkg = url.hostname
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = libraryPath(pkg, relative)
      if (!file) {
        return new Response('Not found', { status: 404 })
      }

      const body = await fs.readFile(file)
      return new Response(body, {
        headers: {
          'content-type': core.mimeFor(file),
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=86400',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function installProductionHeaders() {
  if (developmentUrl) return

  const { session } = require('electron')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // App frames carry their own policy from the protocol handler.
    if (details.url.startsWith(`${APP_SCHEME}://`) || details.url.startsWith(`${LIB_SCHEME}://`)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'self' vibed-app:",
        ],
      },
    })
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0b0d',
    title: 'Vibed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, destination) => {
    const allowed = developmentUrl
      ? destination.startsWith(developmentUrl)
      : destination.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  // Escape leaves full screen even when the key is pressed inside the app frame.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && window.isFullScreen()) {
      event.preventDefault()
      window.setFullScreen(false)
      window.webContents.send('vibed:fullscreen-changed', false)
    }
  })

  window.once('ready-to-show', () => {
    window.show()
    if (portableAppId) window.setFullScreen(true)
  })

  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

const EXTERNAL_HOSTS = new Set([
  'openrouter.ai',
  'platform.openai.com',
  'platform.deepseek.com',
  'ollama.com',
  'opencode.ai',
])

handle('vibed:list', () => listApps())
handle('vibed:create', async (event, input) => {
  const job = beginJob()
  try {
    return await createApp(input, job, makeProgress(event.sender))
  } finally {
    finishJob(job)
  }
})
handle('vibed:revise', async (event, input) => {
  const job = beginJob()
  try {
    return await reviseApp(input?.id, input?.instruction, job, makeProgress(event.sender))
  } finally {
    finishJob(job)
  }
})
handle('vibed:cancel', () => cancelActiveJob())
handle('vibed:data:save', (_event, input) => writeData(input?.id, input?.data))
handle('vibed:export', async (_event, id) => {
  return exportApp(id)
})
handle('vibed:import', async () => {
  const { canceled, filePaths } = await openDialog({
    title: 'Open an app',
    properties: ['openFile'],
    filters: [{ name: 'Vibed app', extensions: ['zip', 'exe'] }],
  })
  if (canceled || !filePaths[0]) return { cancelled: true }

  let payload = await readPortableFile(filePaths[0]).catch(() => null)
  if (!payload) payload = await fs.readFile(filePaths[0])
  return importPayload(payload)
})
handle('vibed:config:get', () => publicConfig())
handle('vibed:providers', () => core.PROVIDERS)
handle('vibed:model:test', async () => {
  return testModel()
})
handle('vibed:update:check', () => checkForUpdate())
handle('vibed:update:open', (_event, url) => {
  const parsed = new URL(String(url))
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    throw new Error('That link is not a GitHub release page.')
  }
  return shell.openExternal(parsed.toString())
})
handle('vibed:open:external', (_event, url) => {
  const parsed = new URL(String(url))
  if (parsed.protocol !== 'https:' || !EXTERNAL_HOSTS.has(parsed.hostname)) {
    throw new Error('That link is not allowed.')
  }
  return shell.openExternal(parsed.toString())
})
handle('vibed:opencode:probe', () => generator.probeOpencode({ refresh: true }))
handle('vibed:config:set', async (_event, next) => {
  await writeConfig(next)
  if (typeof next?.apiKey === 'string' && next.apiKey.trim()) writeKey(next.apiKey.trim())
  return publicConfig()
})
handle('vibed:portable', () => portableAppId)
handle('vibed:fullscreen', (event, value) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return false
  window.setFullScreen(Boolean(value))
  return window.isFullScreen()
})
handle('vibed:reveal', (_event, id) => shell.openPath(appDir(id)))
handle('vibed:delete', async (_event, id) => {
  await fs.rm(appDir(id), { recursive: true, force: true })
  return true
})

app.whenReady().then(async () => {
  installProductionHeaders()
  installAppProtocol()
  installLibraryProtocol()
  portableAppId = await preparePortable().catch(() => null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
