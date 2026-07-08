// preload.js: 通过 contextBridge 安全暴露 IPC API 给渲染进程
// 渲染进程通过 window.electronAPI.invoke(channel, ...args) 调用

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => ipcRenderer.on(channel, (event, ...args) => listener(...args))
});
