export interface AppMeta {
  id: string
  name: string
  intent: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface AppRecord {
  meta: AppMeta
  files: Record<string, string>
  via?: 'opencode' | 'key'
}

export interface OpencodeStatus {
  available: boolean
  version: string
}

export interface ModelConfig {
  provider: string
  baseUrl: string
  model: string
  cliModel: string
  hasKey: boolean
  opencode: OpencodeStatus
  version: string
}

export interface UpdateCheck {
  current: string
  latest: string
  url: string
  available: boolean
}

export interface LogEntry {
  at: string
  level: string
  message: string
}

export interface LogList {
  entries: LogEntry[]
  file: string
}

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  model: string
}

export interface ModelTestResult {
  via: 'opencode' | 'key'
  model: string
  detail: string
}

export interface ExportResult {
  cancelled: boolean
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface VibedBridge {
  platform: string
  list(): Promise<Result<AppMeta[]>>
  create(input: { name?: string; intent: string }): Promise<Result<AppRecord>>
  revise(id: string, instruction: string): Promise<Result<AppRecord>>
  saveData(id: string, data: Record<string, string>): Promise<Result<unknown>>
  exportApp(id: string): Promise<Result<ExportResult>>
  importApp(): Promise<Result<AppRecord | { cancelled: boolean }>>
  getConfig(): Promise<Result<ModelConfig>>
  setConfig(config: {
    provider: string
    baseUrl: string
    model: string
    cliModel: string
    apiKey?: string
  }): Promise<Result<ModelConfig>>
  providers(): Promise<Result<ProviderPreset[]>>
  testModel(): Promise<Result<ModelTestResult>>
  checkForUpdate(): Promise<Result<UpdateCheck>>
  openUpdate(url: string): Promise<Result<unknown>>
  openExternal(url: string): Promise<Result<unknown>>
  onFullscreenChanged(callback: (value: boolean) => void): () => void
  cancel(): Promise<Result<boolean>>
  onProgress(callback: (line: string) => void): () => void
  getLogs(): Promise<Result<LogList>>
  clearLogs(): Promise<Result<boolean>>
  openLogs(): Promise<Result<string>>
  onLog(callback: (entry: LogEntry) => void): () => void
  probeOpencode(): Promise<Result<OpencodeStatus>>
  setFullscreen(value: boolean): Promise<Result<boolean>>
  portableApp(): Promise<Result<string | null>>
  reveal(id: string): Promise<Result<unknown>>
  remove(id: string): Promise<Result<boolean>>
}

declare global {
  interface Window {
    vibed?: VibedBridge
  }
}

export {}
