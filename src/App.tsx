import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppMeta, AppRecord, ModelConfig, ProviderPreset, Result } from './lib/desktop'

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function savedMessage(next: ModelConfig): string {
  if (next.provider === 'opencode' && next.opencode.available) {
    return 'Saved. Local OpenCode is used first.'
  }
  if (next.hasKey) return 'Saved. Generation uses your key.'
  if (next.provider === 'opencode') {
    return 'Saved. Add a key, or install OpenCode, before generating.'
  }
  if (next.opencode.available) {
    return 'Saved. Add a key, or choose OpenCode, before generating.'
  }
  return 'Saved. Add a key before generating.'
}

const HELP: Record<
  string,
  { intro: string; steps: string[]; url?: string; urlLabel?: string }
> = {
  openrouter: {
    intro: 'OpenRouter gives you one key that works with many models.',
    steps: [
      'Open openrouter.ai/keys and sign in.',
      'Add a small credit balance.',
      'Create a key and copy it.',
      'Paste it into Model settings and press Save.',
    ],
    url: 'https://openrouter.ai/keys',
    urlLabel: 'Open openrouter.ai/keys',
  },
  opencode: {
    intro: 'OpenCode runs on your machine and can use its own sign-in, so no key is needed.',
    steps: [
      'Install OpenCode from opencode.ai.',
      'Run “opencode auth login” once in a terminal.',
      'Keep “opencode” on your PATH. Vibed finds it automatically.',
      'Choose OpenCode as the provider and press Save.',
    ],
    url: 'https://opencode.ai',
    urlLabel: 'Open opencode.ai',
  },
  openai: {
    intro: 'Create an API key in the OpenAI dashboard.',
    steps: [
      'Open platform.openai.com/api-keys and sign in.',
      'Create a new secret key and copy it.',
      'Paste it into Model settings and press Save.',
    ],
    url: 'https://platform.openai.com/api-keys',
    urlLabel: 'Open OpenAI keys',
  },
  deepseek: {
    intro: 'Create an API key in the DeepSeek dashboard.',
    steps: [
      'Open platform.deepseek.com/api_keys and sign in.',
      'Create a key and copy it.',
      'Paste it into Model settings and press Save.',
    ],
    url: 'https://platform.deepseek.com/api_keys',
    urlLabel: 'Open DeepSeek keys',
  },
  ollama: {
    intro: 'Ollama runs locally and needs no key.',
    steps: [
      'Install Ollama from ollama.com.',
      'Run “ollama pull llama3.1” once.',
      'Keep Ollama running. The default URL is http://127.0.0.1:11434/v1.',
    ],
    url: 'https://ollama.com/download',
    urlLabel: 'Open ollama.com',
  },
  custom: {
    intro: 'Use any OpenAI-compatible endpoint.',
    steps: [
      'Set the base URL and model name in Model settings.',
      'Paste the key from that provider, if it needs one.',
    ],
  },
}

export default function App() {
  const [apps, setApps] = useState<AppMeta[]>([])
  const [current, setCurrent] = useState<AppMeta | null>(null)
  const [canvasMode, setCanvasMode] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [instruction, setInstruction] = useState('')
  const [editing, setEditing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderPreset[]>([])
  const [settings, setSettings] = useState({
    provider: 'openrouter',
    baseUrl: '',
    model: '',
    cliModel: '',
    apiKey: '',
  })
  const [config, setConfig] = useState<ModelConfig>({
    provider: 'openrouter',
    baseUrl: '',
    model: '',
    cliModel: '',
    hasKey: false,
    opencode: { available: false, version: '' },
    version: '',
  })
  const [busy, setBusy] = useState('')
  const [busyStarted, setBusyStarted] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [progress, setProgress] = useState<string[]>([])
  const [cancelling, setCancelling] = useState(false)
  const [toast, setToast] = useState('')
  const [ready, setReady] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const [modelTest, setModelTest] = useState<{
    state: 'idle' | 'running' | 'ok' | 'fail'
    message: string
  }>({ state: 'idle', message: '' })
  const [update, setUpdate] = useState<{
    checking: boolean
    latest?: string
    url?: string
  } | null>(null)

  const toastTimer = useRef<number | undefined>(undefined)
  const progressLog = useRef<HTMLOListElement | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 4200)
  }, [])

  function beginBusy(label: string) {
    setProgress([])
    setCancelling(false)
    setBusy(label)
    setBusyStarted(Date.now())
    setNow(Date.now())
  }

  function endBusy() {
    setBusy('')
    setBusyStarted(0)
    setCancelling(false)
  }

  async function cancelBusy() {
    const bridge = window.vibed
    if (!bridge || cancelling) return
    setCancelling(true)
    try {
      const cancelled = await unwrap(bridge.cancel())
      if (!cancelled) setCancelling(false)
    } catch (error) {
      notify(messageOf(error))
      setCancelling(false)
    }
  }

  useEffect(() => {
    const bridge = window.vibed
    if (!bridge) {
      setReady(true)
      notify('Open this inside the desktop shell: npm run dev')
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const [portable, list, loaded, presets] = await Promise.all([
          unwrap(bridge.portableApp()),
          unwrap(bridge.list()),
          unwrap(bridge.getConfig()),
          unwrap(bridge.providers()),
        ])
        if (cancelled) return

        setApps(list)
        setConfig(loaded)
        setProviders(presets)
        setSettings({
          provider: loaded.provider,
          baseUrl: loaded.baseUrl,
          model: loaded.model,
          cliModel: loaded.cliModel,
          apiKey: '',
        })
        if (portable) {
          const found = list.find((item) => item.id === portable) ?? null
          setCurrent(found)
          setCanvasMode(!found)
          if (found) {
            setImmersive(true)
            void bridge.setFullscreen(true)
          }
        }
      } catch (error) {
        if (!cancelled) notify(messageOf(error))
      } finally {
        if (!cancelled) {
          setReady(true)
          void testNow()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [notify])

  useEffect(() => {
    const bridge = window.vibed
    if (!bridge) return
    return bridge.onFullscreenChanged((value) => setImmersive(value))
  }, [])

  useEffect(() => {
    const bridge = window.vibed
    if (!bridge) return
    return bridge.onProgress((line) => {
      setProgress((lines) => [...lines.slice(-199), line])
    })
  }, [])

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    progressLog.current?.scrollTo({ top: progressLog.current.scrollHeight })
  }, [progress])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const bridge = window.vibed
      if (!current || !bridge) return

      let origin: URL
      try {
        origin = new URL(event.origin)
      } catch {
        return
      }
      if (origin.protocol !== 'vibed-app:' || origin.hostname !== current.id) return

      const payload = event.data as { type?: string; data?: Record<string, string> } | null
      if (payload?.type === 'vibed:fullscreen') {
        void applyImmersive(!immersive)
        return
      }
      if (payload?.type === 'vibed:edit') {
        setEditing(true)
        return
      }
      if (payload?.type === 'vibed:data' && payload.data) {
        void bridge.saveData(current.id, payload.data)
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [current, immersive])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (editing) {
          setEditing(false)
          return
        }
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }
        if (immersive) {
          void applyImmersive(false)
          return
        }
      }

      if (event.key === 'F11') {
        event.preventDefault()
        void applyImmersive(!immersive)
        return
      }

      if (!current || canvasMode) return
      if (event.key.toLowerCase() === 'e' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setEditing((value) => !value)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, canvasMode, editing, settingsOpen, immersive])

  async function applyImmersive(next: boolean) {
    setImmersive(next)
    try {
      await window.vibed?.setFullscreen(next)
    } catch {
      // The window may be closing.
    }
  }

  async function openExternal(url: string) {
    const bridge = window.vibed
    if (!bridge) return
    try {
      await unwrap(bridge.openExternal(url))
    } catch (error) {
      notify(messageOf(error))
    }
  }

  function openEditorFromBubble() {
    setEditing(true)
    void applyImmersive(false)
  }

  async function createApp() {
    const bridge = window.vibed
    if (!bridge || !prompt.trim() || busy) return

    beginBusy('Shaping your app...')
    try {
      const record = await unwrap(bridge.create({ intent: prompt.trim() }))
      setApps((list) => [record.meta, ...list.filter((item) => item.id !== record.meta.id)])
      setCurrent(record.meta)
      setPrompt('')
      setCanvasMode(false)
      notify(
        record.via === 'opencode'
          ? 'Your app is ready (local OpenCode). Press Ctrl+E to change it.'
          : 'Your app is ready. Press Ctrl+E to change it.',
      )
    } catch (error) {
      const text = messageOf(error)
      notify(text === 'Cancelled.' ? 'Cancelled. Your prompt is still here.' : text)
    } finally {
      endBusy()
    }
  }

  async function applyChange() {
    const bridge = window.vibed
    if (!bridge || !current || !instruction.trim() || busy) return

    beginBusy('Changing your app...')
    try {
      const record = await unwrap(bridge.revise(current.id, instruction.trim()))
      setApps((list) => list.map((item) => (item.id === record.meta.id ? record.meta : item)))
      setCurrent(record.meta)
      setInstruction('')
      setEditing(false)
      notify(record.via === 'opencode' ? 'Change applied (local OpenCode).' : 'Change applied.')
    } catch (error) {
      const text = messageOf(error)
      notify(text === 'Cancelled.' ? 'Cancelled. Nothing was changed.' : text)
    } finally {
      endBusy()
    }
  }

  async function exportApp() {
    const bridge = window.vibed
    if (!bridge || !current) return

    try {
      const result = await unwrap(bridge.exportApp(current.id))
      if (!result.cancelled) notify(result.message)
    } catch (error) {
      notify(messageOf(error))
    }
  }

  async function importApp() {
    const bridge = window.vibed
    if (!bridge) return

    try {
      const result = await unwrap(bridge.importApp())
      if ('cancelled' in result) return
      const record = result as AppRecord
      setApps((list) => [record.meta, ...list.filter((item) => item.id !== record.meta.id)])
      setCurrent(record.meta)
      setCanvasMode(false)
      notify('App opened.')
    } catch (error) {
      notify(messageOf(error))
    }
  }

  function startNew() {
    setCurrent(null)
    setCanvasMode(true)
    setPrompt('')
  }

  function editSettings(patch: Partial<typeof settings>) {
    setSettings((current) => ({ ...current, ...patch }))
    setModelTest({ state: 'idle', message: '' })
  }

  function chooseProvider(id: string) {
    const preset = providers.find((provider) => provider.id === id)
    setSettings((current) => {
      if (!preset || preset.id === 'custom') return { ...current, provider: id }
      return {
        ...current,
        provider: id,
        baseUrl: preset.baseUrl,
        model: preset.model,
      }
    })
    setModelTest({ state: 'idle', message: '' })
  }

  async function checkOpencode() {
    const bridge = window.vibed
    if (!bridge) return

    try {
      const opencode = await unwrap(bridge.probeOpencode())
      setConfig((current) => ({ ...current, opencode }))
      notify(
        opencode.available
          ? `Local OpenCode ${opencode.version} found.`
          : 'No local OpenCode found. Generation needs a key.',
      )
      void testNow()
    } catch (error) {
      notify(messageOf(error))
    }
  }

  async function testNow(): Promise<boolean> {
    const bridge = window.vibed
    if (!bridge) return false

    setModelTest({ state: 'running', message: 'Sending a test prompt…' })
    try {
      const result = await unwrap(bridge.testModel())
      setModelTest({ state: 'ok', message: `Works — ${result.detail}, ${result.model}` })
      return true
    } catch (error) {
      setModelTest({ state: 'fail', message: messageOf(error) })
      return false
    }
  }

  async function checkForUpdates() {
    const bridge = window.vibed
    if (!bridge) return

    if (update?.url) {
      try {
        await unwrap(bridge.openUpdate(update.url))
      } catch (error) {
        notify(messageOf(error))
      }
      return
    }

    setUpdate({ checking: true })
    try {
      const result = await unwrap(bridge.checkForUpdate())
      if (result.available) {
        setUpdate({ checking: false, latest: result.latest, url: result.url })
        notify(`v${result.latest} is available.`)
      } else {
        setUpdate(null)
        notify(`This is the latest version (${result.current}).`)
      }
    } catch (error) {
      setUpdate(null)
      notify(messageOf(error))
    }
  }

  async function saveSettings() {
    const bridge = window.vibed
    if (!bridge) return

    try {
      const next = await unwrap(bridge.setConfig({ ...settings }))
      setConfig(next)
      setSettings({
        provider: next.provider,
        baseUrl: next.baseUrl,
        model: next.model,
        cliModel: next.cliModel,
        apiKey: '',
      })

      const works = await testNow()
      if (works) {
        setSettingsOpen(false)
        notify(savedMessage(next))
      } else {
        notify('Saved, but the model test failed.')
      }
    } catch (error) {
      notify(messageOf(error))
    }
  }

  const activeApp = current && !canvasMode ? current : null
  const needsModel =
    ready &&
    !config.hasKey &&
    config.provider !== 'ollama' &&
    !(config.provider === 'opencode' && config.opencode.available)
  const help = HELP[settings.provider] ?? HELP.custom
  const activeProviderLabel =
    providers.find((provider) => provider.id === settings.provider)?.label ?? 'Provider'

  return (
    <>
      <div className={`shell${immersive ? ' immersive' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-dot" /> vibed
          </div>

          <button className="new-button" onClick={startNew}>
            + New app
          </button>
          <button className="ghost-button" onClick={importApp}>
            Open app file
          </button>

          <div className="list-label">Your apps</div>
          <div className="app-list">
            {apps.map((app) => (
              <button
                key={app.id}
                className={`app-row${current?.id === app.id && !canvasMode ? ' active' : ''}`}
                onClick={() => {
                  setCurrent(app)
                  setCanvasMode(false)
                }}
              >
                <span className="app-dot" />
                <span className="app-name">{app.name}</span>
                <span className="app-version">v{app.version}</span>
              </button>
            ))}
            {ready && apps.length === 0 && <p className="empty">Nothing here yet.</p>}
          </div>

          <div className="sidebar-foot">
            <button className="ghost-button" onClick={() => setSettingsOpen(true)}>
              Model settings
            </button>
            <span
              className={`key-state${
                modelTest.state === 'ok'
                  ? ' set'
                  : modelTest.state === 'fail'
                    ? ' fail'
                    : ''
              }`}
              title={modelTest.message}
            >
              {modelTest.state === 'running'
                ? 'Testing…'
                : modelTest.state === 'fail'
                  ? 'Check model'
                  : config.provider === 'opencode' && config.opencode.available
                    ? `opencode ${config.opencode.version}`
                    : config.hasKey
                      ? config.model
                      : 'No model'}
            </span>
            <button
              className={`version-link${update?.latest ? ' update' : ''}`}
              onClick={checkForUpdates}
            >
              {update?.checking
                ? 'Checking…'
                : update?.latest
                  ? `Update v${update.latest}`
                  : `v${config.version || '0.0.0'}`}
            </button>
          </div>
        </aside>

        <main className="main">
          {activeApp ? (
            <>
              <header className="topbar">
                <div className="topbar-text">
                  <h2>{activeApp.name}</h2>
                  <p>
                    version {activeApp.version} &middot; {activeApp.intent}
                  </p>
                </div>
                <div className="actions">
                  <button
                    className="icon-button"
                    title="Full screen (F11)"
                    aria-label="Full screen"
                    onClick={() => applyImmersive(true)}
                  >
                    ⛶
                  </button>
                  <button className="ghost-button" onClick={() => setEditing(true)}>
                    Change
                  </button>
                  <button className="ghost-button" onClick={exportApp}>
                    Make app file
                  </button>
                </div>
              </header>

              <div className="stage">
                <iframe
                  key={`${activeApp.id}-${activeApp.version}`}
                  title={activeApp.name}
                  src={`vibed-app://${activeApp.id}/index.html`}
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            </>
          ) : (
            <section className="canvas">
              <div className="canvas-inner">
                {needsModel && (
                  <div className="setup-notice" role="status">
                    <p>
                      <strong>No model yet.</strong> Add a key, or use a local OpenCode install,
                      to make your first app.
                    </p>
                    <button className="ghost-button" onClick={() => setHelpOpen(true)}>
                      How to set it up
                    </button>
                  </div>
                )}
                <p className="kicker">A blank app that becomes whatever you describe</p>
                <h1>What should this become?</h1>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={3}
                  placeholder="A quiet habit tracker that celebrates small wins"
                />
                <button
                  className="primary"
                  onClick={createApp}
                  disabled={!prompt.trim() || Boolean(busy)}
                >
                  Create it
                </button>
                <p className="hint">You can change it any time. Nothing is final.</p>
              </div>
            </section>
          )}
        </main>
      </div>

      {immersive && current && (
        <button className="update-bubble" onClick={openEditorFromBubble}>
          <span>Update app</span>
          <kbd>Ctrl E</kbd>
        </button>
      )}

      {editing && current && (
        <div
          className="overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEditing(false)
          }}
        >
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Change app">
            <h2>Change {current.name}</h2>
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={4}
              placeholder="Make the buttons bigger and add a weekly view"
            />
            <div className="dialog-actions">
              <button className="ghost-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={applyChange}
                disabled={!instruction.trim() || Boolean(busy)}
              >
                Apply
              </button>
            </div>
            <p className="hint">The previous version stays in the app folder.</p>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false)
          }}
        >
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Model settings">
            <h2>Model</h2>
            <label>
              <span>Provider</span>
              <select
                value={settings.provider}
                onChange={(event) => chooseProvider(event.target.value)}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            {settings.provider === 'opencode' && (
              <p className="hint">
                {config.opencode.available
                  ? `Local OpenCode ${config.opencode.version} found. Generation runs through it, with its own sign-in, so nothing needs a key here.`
                  : 'No local OpenCode found. This needs a paid OpenCode key. Install the CLI instead and it is free.'}
              </p>
            )}
            {settings.provider !== 'opencode' && config.opencode.available && (
              <p className="hint">
                Local OpenCode {config.opencode.version} is installed. Choose OpenCode above to
                generate with it for free instead of a key.
              </p>
            )}
            <label>
              <span>Base URL</span>
              <input
                value={settings.baseUrl}
                onChange={(event) => editSettings({ baseUrl: event.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label>
              <span>Model</span>
              <input
                value={settings.model}
                onChange={(event) => editSettings({ model: event.target.value })}
                placeholder="model-name"
              />
            </label>
            {settings.provider === 'opencode' && (
              <label>
                <span>CLI model</span>
                <input
                  value={settings.cliModel}
                  onChange={(event) => editSettings({ cliModel: event.target.value })}
                  placeholder="opencode/deepseek-v4.1-flash-free"
                />
              </label>
            )}
            <label>
              <span>{activeProviderLabel} API key</span>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(event) => editSettings({ apiKey: event.target.value })}
                placeholder={
                  config.hasKey
                    ? 'Key saved'
                    : settings.provider === 'openrouter'
                      ? 'sk-or-v1-...'
                      : 'sk-...'
                }
              />
            </label>
            <p className="hint">
              The key stays on this machine and is never written into an app or its exported file.
            </p>
            <button className="link-button" onClick={() => setHelpOpen(true)}>
              How do I set this up?
            </button>
            <p className={`test-result ${modelTest.state}`} role="status">
              <span className="test-dot" />
              {modelTest.state === 'running'
                ? 'Sending a test prompt…'
                : modelTest.message || 'Not tested yet.'}
            </p>
            <div className="dialog-actions">
              {settings.provider === 'opencode' && (
                <button className="ghost-button" onClick={checkOpencode}>
                  Check again
                </button>
              )}
              <button className="ghost-button" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
              <button className="primary" onClick={saveSettings}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div
          className="overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setHelpOpen(false)
          }}
        >
          <div
            className="dialog help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="How to connect a model"
          >
            <h2>Connect a model</h2>
            <p className="help-intro">{help.intro}</p>
            <ol className="help-steps">
              {help.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {settings.provider === 'openrouter' && (
              <p className="hint">The default model costs a fraction of a cent per app.</p>
            )}
            <div className="dialog-actions">
              {help.url && (
                <button className="ghost-button" onClick={() => void openExternal(help.url!)}>
                  {help.urlLabel}
                </button>
              )}
              <button className="ghost-button" onClick={() => setHelpOpen(false)}>
                Close
              </button>
              <button
                className="primary"
                onClick={() => {
                  setHelpOpen(false)
                  setSettingsOpen(true)
                }}
              >
                Model settings
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="progress" role="status">
          <div className="progress-head">
            <span className="spinner" />
            <strong>{busy}</strong>
            <span className="progress-time">
              {Math.max(0, Math.floor((now - busyStarted) / 1000))}s
            </span>
            <button
              className="ghost-button"
              onClick={() => void cancelBusy()}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
          {progress.length > 0 && (
            <ol className="progress-log" ref={progressLog}>
              {progress.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
