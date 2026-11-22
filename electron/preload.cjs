const { contextBridge, ipcRenderer } = require('electron')

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('vibed', {
  platform: process.platform,
  list: () => call('vibed:list'),
  create: (input) => call('vibed:create', input),
  revise: (id, instruction) => call('vibed:revise', { id, instruction }),
  saveData: (id, data) => call('vibed:data:save', { id, data }),
  exportApp: (id) => call('vibed:export', id),
  importApp: () => call('vibed:import'),
  getConfig: () => call('vibed:config:get'),
  setConfig: (config) => call('vibed:config:set', config),
  providers: () => call('vibed:providers'),
  testModel: () => call('vibed:model:test'),
  checkForUpdate: () => call('vibed:update:check'),
  openUpdate: (url) => call('vibed:update:open', url),
  openExternal: (url) => call('vibed:open:external', url),
  onFullscreenChanged: (callback) => {
    const listener = (_event, value) => callback(Boolean(value))
    ipcRenderer.on('vibed:fullscreen-changed', listener)
    return () => ipcRenderer.removeListener('vibed:fullscreen-changed', listener)
  },
  cancel: () => call('vibed:cancel'),
  onProgress: (callback) => {
    const listener = (_event, line) => callback(String(line))
    ipcRenderer.on('vibed:progress', listener)
    return () => ipcRenderer.removeListener('vibed:progress', listener)
  },
  probeOpencode: () => call('vibed:opencode:probe'),
  portableApp: () => call('vibed:portable'),
  setFullscreen: (value) => call('vibed:fullscreen', value),
  reveal: (id) => call('vibed:reveal', id),
  remove: (id) => call('vibed:delete', id),
})
