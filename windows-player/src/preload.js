const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("playerApi", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveServer: (serverUrl) => ipcRenderer.invoke("server:save", serverUrl),
  createPairing: () => ipcRenderer.invoke("pairing:create"),
  pollPairing: () => ipcRenderer.invoke("pairing:poll"),
  syncManifest: () => ipcRenderer.invoke("manifest:sync"),
  sendHeartbeat: (currentItem) => ipcRenderer.invoke("heartbeat:send", currentItem),
  reset: () => ipcRenderer.invoke("configuration:reset"),
  getAutoLaunch: () => ipcRenderer.invoke("autolaunch:get"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("autolaunch:set", enabled),
  setFullscreen: (enabled) => ipcRenderer.invoke("window:fullscreen", enabled),
  quit: () => ipcRenderer.invoke("app:quit"),
  onOpenSettings: (callback) => ipcRenderer.on("settings:open", callback),
  onDownloadProgress: (callback) => ipcRenderer.on("download:progress", (_event, value) => callback(value))
});
