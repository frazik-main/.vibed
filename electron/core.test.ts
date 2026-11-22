import { describe, expect, it } from 'vitest'
import core from './core.cjs'

describe('app file rules', () => {
  it('slugifies a name into a folder-safe id', () => {
    expect(core.slugify('My Habit Tracker!')).toBe('my-habit-tracker')
    expect(core.slugify('   ')).toBe('app')
    expect(core.titleFromIntent('a quiet habit tracker that celebrates small wins')).toBe(
      'a quiet habit tracker that celebrates',
    )
  })

  it('accepts a normal file map', () => {
    const files = core.normalizeFiles({
      'index.html': '<!doctype html><h1>Hi</h1>',
      'style.css': 'body { color: red }',
    })
    expect(Object.keys(files)).toEqual(['index.html', 'style.css'])
  })

  it('rejects a map without index.html', () => {
    expect(() => core.normalizeFiles({ 'style.css': 'body{}' })).toThrow('index.html')
  })

  it('rejects path traversal', () => {
    expect(() =>
      core.normalizeFiles({ 'index.html': 'x', '../outside.html': 'no' }),
    ).toThrow('Invalid file path')
  })

  it('rejects absolute and Windows paths', () => {
    expect(() => core.normalizeFiles({ '/index.html': 'x' })).toThrow('Invalid file path')
    expect(() => core.normalizeFiles({ 'index.html': 'x', 'src\\app.js': '' })).toThrow(
      'Invalid file path',
    )
  })

  it('rejects unsupported file types', () => {
    expect(() => core.normalizeFiles({ 'index.html': 'x', 'app.exe': 'MZ' })).toThrow(
      'Unsupported file type',
    )
  })

  it('rejects files the runtime owns', () => {
    expect(() => core.normalizeFiles({ 'index.html': 'x', 'data/data.json': '{}' })).toThrow(
      'Reserved folder',
    )
  })
})

describe('provider presets', () => {
  it('lists OpenRouter first, then OpenCode and the previous endpoints', () => {
    expect(core.PROVIDERS.map((provider: { id: string }) => provider.id)).toEqual([
      'openrouter',
      'opencode',
      'openai',
      'deepseek',
      'ollama',
      'custom',
    ])
    expect(core.PROVIDERS[0]).toBe(core.OPENROUTER)
  })

  it('sends OpenRouter keys to the aggregator', () => {
    expect(core.OPENROUTER.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(core.OPENROUTER.model).toBe('deepseek/deepseek-v4.1-flash')
  })

  it('keeps OpenCode reachable with its own endpoint', () => {
    expect(core.OPENCODE.baseUrl).toBe('https://opencode.ai/inference/openai/v1')
    expect(core.OPENCODE.model).toBe('deepseek-v4.1-flash')
  })

  it('keeps the local Ollama preset on loopback', () => {
    const ollama = core.PROVIDERS.find((provider: { id: string }) => provider.id === 'ollama')
    expect(ollama.baseUrl).toBe('http://127.0.0.1:11434/v1')
  })

  it('defaults the CLI to the free model and the provider/model form', () => {
    expect(core.OPENCODE_CLI_MODEL).toBe('opencode/deepseek-v4.1-flash-free')
    expect(core.OPENCODE_CLI_MODEL.startsWith('opencode/')).toBe(true)
  })
})

describe('version comparison', () => {
  it('ignores a leading v and pre-release suffixes', () => {
    expect(core.compareVersions('v0.2.0', '0.1.0')).toBe(1)
    expect(core.compareVersions('0.2.0-beta', 'v0.2.0')).toBe(0)
    expect(core.compareVersions('0.1.9', '0.1.10')).toBe(-1)
    expect(core.compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('portable payload', () => {
  const base = Buffer.from('SHELL-EXE-BYTES')
  const payload = Buffer.from('APP-PAYLOAD')

  it('round-trips base and payload', () => {
    const container = core.buildContainer(base, payload)
    const read = core.readContainer(container)
    expect(read).not.toBeNull()
    expect(Buffer.from(read.base).toString()).toBe('SHELL-EXE-BYTES')
    expect(Buffer.from(read.payload).toString()).toBe('APP-PAYLOAD')
  })

  it('returns null for a file without a footer', () => {
    expect(core.readContainer(base)).toBeNull()
  })

  it('replaces an existing payload instead of stacking them', () => {
    const first = core.buildContainer(base, payload)
    const second = core.buildContainer(first, Buffer.from('NEW'))
    const read = core.readContainer(second)
    expect(Buffer.from(read.payload).toString()).toBe('NEW')
    expect(Buffer.from(read.base).toString()).toBe('SHELL-EXE-BYTES')
  })

  it('detects a tampered payload', () => {
    const container = core.buildContainer(base, payload)
    container[base.length] ^= 0xff
    expect(core.readContainer(container)).toBeNull()
  })
})

describe('app bootstrap', () => {
  it('runs its script before app scripts and escapes closing tags', () => {
    const html = '<html><head><script src="app.js"></script></head><body></body></html>'
    const out = core.injectBootstrap(html, { note: '</script><script>alert(1)</script>' })
    const injected = out.indexOf('vibed:data')
    expect(injected).toBeGreaterThan(-1)
    expect(injected).toBeLessThan(out.indexOf('app.js'))
    expect(out).not.toContain('</script><script>alert(1)')
    expect(out).toContain('\\u003c/script')
    expect(out).toContain('vibed:edit')
    expect(out).toContain('vibed:fullscreen')
  })

  it('adds a head when the document has none', () => {
    const out = core.injectBootstrap('<h1>Hi</h1>', {})
    expect(out).toContain('<head><script>')
  })

  it('serves the right content types', () => {
    expect(core.mimeFor('index.html')).toContain('text/html')
    expect(core.mimeFor('app.js')).toContain('javascript')
    expect(core.mimeFor('unknown.bin')).toBe('application/octet-stream')
  })
})
