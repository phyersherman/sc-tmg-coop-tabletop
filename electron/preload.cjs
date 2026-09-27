/** What the page may ask of the desktop app: quitting, and going in and out of full screen. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  quit: () => ipcRenderer.send('desktop:quit'),
  toggleFullScreen: () => ipcRenderer.send('desktop:fullscreen'),
});
