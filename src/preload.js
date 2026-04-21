const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Games
  getGames:         ()                => ipcRenderer.invoke('db:getGames'),
  searchGames:      (q)               => ipcRenderer.invoke('db:searchGames', q),
  addGame:          (data)            => ipcRenderer.invoke('db:addGame', data),
  removeGame:       (id)              => ipcRenderer.invoke('db:removeGame', id),
  updateGameName:   (id, name)        => ipcRenderer.invoke('db:updateGameName', { id, name }),
  updateGameCover:  (data)            => ipcRenderer.invoke('db:updateGameCover', data),
  // Folders
  getFolders:       ()                => ipcRenderer.invoke('db:getFolders'),
  addFolder:        (p, type)         => ipcRenderer.invoke('db:addFolder', { folderPath: p, type }),
  removeFolder:     (id)              => ipcRenderer.invoke('db:removeFolder', id),
  // Settings
  getSetting:       (key)             => ipcRenderer.invoke('db:getSetting', key),
  setSetting:       (key, value)      => ipcRenderer.invoke('db:setSetting', { key, value }),
  isFirstRun:       ()                => ipcRenderer.invoke('db:isFirstRun'),
  // Scan
  scanFolder:       (p)               => ipcRenderer.invoke('scan:folder', p),
  importResults:    (data)            => ipcRenderer.invoke('scan:importResults', data),
  // Steam
  detectSteam:      ()                => ipcRenderer.invoke('steam:detectLibraries'),
  // Covers
  fetchCoverByName: (name)            => ipcRenderer.invoke('cover:fetchByName', name),
  getCoverDataUri:  (filePath)        => ipcRenderer.invoke('cover:getDataUri', filePath),
  // Launch
  launchGame:       (exePath)         => ipcRenderer.invoke('game:launch', exePath),
  openFolder:       (exePath)         => ipcRenderer.invoke('game:openFolder', exePath),
  // Dialogs
  selectFolder:     ()                => ipcRenderer.invoke('dialog:selectFolder'),
  selectExe:        ()                => ipcRenderer.invoke('dialog:selectExe'),
  // Window
  minimize:         ()                => ipcRenderer.send('window:minimize'),
  maximize:         ()                => ipcRenderer.send('window:maximize'),
  close:            ()                => ipcRenderer.send('window:close'),
});
