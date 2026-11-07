const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ostedge', {
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  appInfo: () => ipcRenderer.invoke('app:info'),
  platform: process.platform,
})
