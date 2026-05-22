const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onProgress: (callback) => {
    ipcRenderer.on("setup-progress", (event, data) => callback(data));
  },
  onStatus: (callback) => {
    ipcRenderer.on("setup-status", (event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on("setup-error", (event, data) => callback(data));
  }
});
