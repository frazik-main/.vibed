'use strict'

const crypto = require('node:crypto')

const MAX_FILES = 40
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
  'html',
  'css',
  'js',
  'mjs',
  'json',
  'svg',
  'md',
  'txt',
])

// OpenRouter first: one key, one balance, any model. OpenCode second: it can
// run without a key through a local install, or through its own key.
const PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4.1-flash',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    model: 'deepseek-v4.1-flash',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    model: '',
  },
]

const OPENROUTER = PROVIDERS[0]
const OPENCODE = PROVIDERS.find((provider) => provider.id === 'opencode')
// The CLI model uses provider/model form and needs the free-model listing.
const OPENCODE_CLI_MODEL = 'opencode/deepseek-v4.1-flash-free'

const FOOTER_SIZE = 68
const MAGIC = Buffer.from('VIBEDPAY', 'ascii')
const END_MAGIC = Buffer.from('VIBEDEND', 'ascii')

// Compare dotted versions for the update check. A pre-release suffix is ignored,
// so 0.2.0-beta counts as 0.2.0.
function compareVersions(left, right) {
  const parse = (value) =>
    String(value)
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)

  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

function slugify(value) {
  const slug = String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'app'
}

function titleFromIntent(intent) {
  const words = String(intent).trim().split(/\s+/).slice(0, 6).join(' ')
  const title = words.replace(/[.!?,;:]+$/, '')
  return title.length > 42 ? `${title.slice(0, 39).trimEnd()}...` : title || 'New app'
}

function normalizePath(rawPath) {
  if (typeof rawPath !== 'string') throw new Error('File paths must be strings.')
  if (!rawPath || rawPath.length > 200) {
    throw new Error(`Invalid file path: ${rawPath || '(empty)'}`)
  }
  if (rawPath.startsWith('/') || rawPath.includes('\\') || rawPath.includes('\0')) {
    throw new Error(`Invalid file path: ${rawPath}`)
  }
  const parts = rawPath.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid file path: ${rawPath}`)
  }
  const extension = parts[parts.length - 1].split('.').pop().toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file type: ${rawPath}`)
  }
  if (parts[0] === 'data' || parts[0] === 'previous') {
    throw new Error(`Reserved folder: ${rawPath}`)
  }
  return parts.join('/')
}

function normalizeFiles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The model did not return a set of files.')
  }
  const entries = Object.entries(value)
  if (entries.length === 0) throw new Error('The model returned no files.')
  if (entries.length > MAX_FILES) throw new Error('The model returned too many files.')

  const files = {}
  let total = 0
  for (const [rawPath, content] of entries) {
    const filePath = normalizePath(rawPath)
    if (typeof content !== 'string') {
      throw new Error(`File content must be text: ${filePath}`)
    }
    total += Buffer.byteLength(content, 'utf8')
    if (total > MAX_TOTAL_BYTES) throw new Error('The generated app is too large.')
    files[filePath] = content
  }
  if (!files['index.html']) throw new Error('The generated app has no index.html.')
  return files
}

const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
}

function mimeFor(filePath) {
  const extension = String(filePath).split('.').pop().toLowerCase()
  return MIME_TYPES[extension] || 'application/octet-stream'
}

function escapeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function injectBootstrap(html, data) {
  const payload = escapeForScript(data || {})
  const script =
    '<script>(function(){' +
    `var D=${payload};` +
    'try{for(var k in D){localStorage.setItem(k,D[k])}}catch(e){}' +
    'var last=null;' +
    'function snap(){try{var o={};for(var i=0;i<localStorage.length;i++){' +
    'var k=localStorage.key(i);o[k]=localStorage.getItem(k)}' +
    "var s=JSON.stringify(o);if(s!==last){last=s;parent.postMessage({type:'vibed:data',data:o},'*')}}catch(e){}}" +
    'addEventListener("keydown",function(e){' +
    'if(e.key==="F11"){e.preventDefault();parent.postMessage({type:"vibed:fullscreen"},"*")}' +
    'if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==="e"){' +
    'e.preventDefault();parent.postMessage({type:"vibed:edit"},"*")}});' +
    'setInterval(snap,1500);window.addEventListener("pagehide",snap);snap()' +
    '})()</script>'

  const head = /<head\b[^>]*>/i.exec(html)
  if (head) {
    const at = head.index + head[0].length
    return `${html.slice(0, at)}${script}${html.slice(at)}`
  }

  const htmlTag = /<html\b[^>]*>/i.exec(html)
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length
    return `${html.slice(0, at)}<head>${script}</head>${html.slice(at)}`
  }

  return `<!doctype html><html><head>${script}</head><body>${html}</body></html>`
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest()
}

function parseFooter(footer) {
  if (!Buffer.isBuffer(footer) || footer.length !== FOOTER_SIZE) return null
  if (!footer.subarray(0, 8).equals(MAGIC)) return null
  if (!footer.subarray(60, 68).equals(END_MAGIC)) return null
  if (footer.readUInt32LE(8) !== 1) return null
  const offset = Number(footer.readBigUInt64LE(12))
  const length = Number(footer.readBigUInt64LE(20))
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) return null
  if (offset < 0 || length < 0) return null
  return { offset, length, digest: footer.subarray(28, 60) }
}

function verifyPayload(payload, footer) {
  const info = parseFooter(footer)
  if (!info) return false
  return sha256(payload).equals(Buffer.from(info.digest))
}

function readContainer(bytes) {
  const buffer = Buffer.from(bytes)
  if (buffer.length < FOOTER_SIZE) return null
  const footer = buffer.subarray(buffer.length - FOOTER_SIZE)
  const info = parseFooter(footer)
  if (!info) return null
  if (info.offset + info.length > buffer.length - FOOTER_SIZE) return null
  const payload = buffer.subarray(info.offset, info.offset + info.length)
  if (!verifyPayload(payload, footer)) return null
  return { base: buffer.subarray(0, info.offset), payload }
}

function buildContainer(base, payload) {
  const baseBytes = Buffer.from(base)
  const payloadBytes = Buffer.from(payload)
  const existing = readContainer(baseBytes)
  const cleanBase = existing ? existing.base : baseBytes

  const footer = Buffer.alloc(FOOTER_SIZE)
  MAGIC.copy(footer, 0)
  footer.writeUInt32LE(1, 8)
  footer.writeBigUInt64LE(BigInt(cleanBase.length), 12)
  footer.writeBigUInt64LE(BigInt(payloadBytes.length), 20)
  sha256(payloadBytes).copy(footer, 28)
  END_MAGIC.copy(footer, 60)

  return Buffer.concat([cleanBase, payloadBytes, footer])
}

module.exports = {
  MAX_FILES,
  MAX_TOTAL_BYTES,
  FOOTER_SIZE,
  OPENCODE,
  OPENCODE_CLI_MODEL,
  OPENROUTER,
  PROVIDERS,
  compareVersions,
  slugify,
  titleFromIntent,
  normalizePath,
  normalizeFiles,
  mimeFor,
  injectBootstrap,
  sha256,
  parseFooter,
  verifyPayload,
  readContainer,
  buildContainer,
}
