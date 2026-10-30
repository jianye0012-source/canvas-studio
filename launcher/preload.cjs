const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set(['app:load', 'runtime:start', 'runtime:stop', 'runtime:open', 'runtime:check', 'config:save', 'config:test', 'storage:open', 'storage:choose', 'browser:choose', 'update:import', 'update:check', 'update:download', 'update:install', 'update:open-release', 'about:open']);
contextBridge.exposeInMainWorld('launcher', {
  invoke(channel, value) { if (!channels.has(channel)) return Promise.reject(new Error('操作无效')); return ipcRenderer.invoke(channel, value); },
  subscribe(callback) {
    const status = (_event, value) => callback({ type: 'status', value });
    const log = (_event, value) => callback({ type: 'logs', value });
    const update = (_event, value) => callback({ type: 'update', value });
    ipcRenderer.on('runtime:status', status); ipcRenderer.on('runtime:logs', log);
    ipcRenderer.on('update:status', update);
    return () => { ipcRenderer.removeListener('runtime:status', status); ipcRenderer.removeListener('runtime:logs', log); ipcRenderer.removeListener('update:status', update); };
  },
});
