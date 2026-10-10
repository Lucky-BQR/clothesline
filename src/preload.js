'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Only named capabilities are exposed; no arbitrary IPC or filesystem access.
contextBridge.exposeInMainWorld('clothesline', {
  call: async (action, payload) => {
    const allowed = ['state', 'capture', 'choose-window', 'select-region', 'cancel-capture', 'image',
      'preview', 'copy', 'save', 'delete', 'pin', 'restore', 'archive', 'reorder', 'menu',
      'edit', 'dirty', 'reset-image', 'settings', 'apply-settings', 'pick-folder', 'show-data', 'close', 'quit'];
    if (!allowed.includes(action)) throw new Error('Unsupported action');
    const result = await ipcRenderer.invoke('action', action, payload);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  drag: id => ipcRenderer.send('drag-file', id),
  hitTest: active => ipcRenderer.send('hit-test', Boolean(active)),
  onState: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('state-changed', listener);
    return () => ipcRenderer.removeListener('state-changed', listener);
  }
});
