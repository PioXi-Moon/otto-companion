/**
 * 预加载脚本必须是 CommonJS。
 * Electron 的渲染进程默认开 sandbox，而 sandbox 下的 preload 不支持 ESM——
 * 之前那个 .mjs 版本会静默加载失败，于是 window.ottoPet 是 undefined，
 * 拖动、缩放、右键菜单全部没反应，而且不报错。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ottoPet", {
  isElectron: true,
  dragStart: (box) => ipcRenderer.send("pet:drag-start", box),
  dragMove: (dx, dy) => ipcRenderer.send("pet:drag-move", { dx, dy }),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  box: (r) => ipcRenderer.send("pet:box", r),
  openPanel: () => ipcRenderer.send("panel:open"),
  quit: () => ipcRenderer.send("app:quit"),
  menu: () => ipcRenderer.send("pet:menu"),
  action: (name) => ipcRenderer.send("pet:action", name),
  resize: (scale) => ipcRenderer.send("pet:resize", scale),
  setIgnoreMouse: (v) => ipcRenderer.send("pet:ignore-mouse", v),
  apiKey: {
    status: () => ipcRenderer.invoke("api-key:status"),
    save: (key) => ipcRenderer.invoke("api-key:save", key),
    skip: () => ipcRenderer.invoke("api-key:skip"),
    close: () => ipcRenderer.send("api-key:close"),
  },
});
