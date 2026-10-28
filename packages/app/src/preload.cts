import electron = require("electron");
const { contextBridge, ipcRenderer } = electron;
import type { AppBridge, AppRoute, SocketEvent } from "@workforces/protocol";

// Preload com sandbox: só "electron" pode ser importado; os canais repetem os literais do main.ts.
const subscribe = <T extends unknown[]>(channel: string, listener: (...args: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => void ipcRenderer.off(channel, handler);
};

const bridge: AppBridge = {
  startup: () => ipcRenderer.invoke("app:startup"),
  onRoute: (listener) => subscribe<[AppRoute]>("app:route", listener),
  offices: {
    list: () => ipcRenderer.invoke("offices:list"),
    reachable: (id) => ipcRenderer.invoke("offices:reachable", id),
    open: (id) => ipcRenderer.invoke("offices:open", id),
    add: (address) => ipcRenderer.invoke("offices:add", address),
    forget: (id) => ipcRenderer.invoke("offices:forget", id),
    current: () => ipcRenderer.invoke("offices:current"),
  },
  invites: { open: (link) => ipcRenderer.invoke("invites:open", link) },
  socket: {
    open: (id) => ipcRenderer.send("socket:open", id),
    send: (id, text) => ipcRenderer.send("socket:send", id, text),
    close: (id, code) => ipcRenderer.send("socket:close", id, code),
    onEvent: (listener) => subscribe<[number, SocketEvent]>("socket:event", listener),
  },
};

contextBridge.exposeInMainWorld("workforces", bridge);
