const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Contrôles de la barre de fenêtre personnalisée
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onWindowMaximized: (callback) => ipcRenderer.on('window-is-maximized', (e, isMax) => callback(isMax)),

  // Persistance et gestion des serveurs
  getServers: () => ipcRenderer.invoke('get-servers'),
  createServer: (data) => ipcRenderer.invoke('create-server', data),
  deleteServer: (id) => ipcRenderer.invoke('delete-server', id),
  openServerFolder: (id, relativePath = '') => ipcRenderer.invoke('open-server-folder', { serverId: id, relativePath }),

  // Exécution réelle du serveur Minecraft
  startServer: (id) => ipcRenderer.invoke('start-server', id),
  stopServer: (id) => ipcRenderer.invoke('stop-server', id),
  killServer: (id) => ipcRenderer.invoke('kill-server', id),
  restartServer: (id) => ipcRenderer.invoke('restart-server', id),
  sendServerCommand: (id, command) => ipcRenderer.invoke('send-server-command', { serverId: id, command }),
  onServerStdout: (callback) => ipcRenderer.on('server-stdout', (e, data) => callback(data)),
  onServerStderr: (callback) => ipcRenderer.on('server-stderr', (e, data) => callback(data)),
  onServerStopped: (callback) => ipcRenderer.on('server-stopped', (e, data) => callback(data)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (e, data) => callback(data)),

  // Réseau et routage multijoueur (UPnP, Pinggy, DuckDNS)
  getServerPublicIp: (id) => ipcRenderer.invoke('get-server-public-ip', id),
  getPublicIp: () => ipcRenderer.invoke('get-public-ip'),
  onServerPublicIp: (callback) => ipcRenderer.on('server-public-ip', (e, data) => callback(data)),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  // Performances et Métriques Système
  getServerPerformance: (id) => ipcRenderer.invoke('get-server-performance', id),
  getServerStorage: (id) => ipcRenderer.invoke('get-server-storage', id),

  // Récupération des versions officielles et par moteur en direct
  getMinecraftVersions: () => ipcRenderer.invoke('get-minecraft-versions'),
  getEngineVersions: (type) => ipcRenderer.invoke('get-engine-versions', type),

  // Fichiers et gestionnaire FTP complet
  getServerFiles: (id, relativePath = '') => ipcRenderer.invoke('get-server-files', { serverId: id, relativePath }),
  readServerFile: (id, relativeFilePath) => ipcRenderer.invoke('read-server-file', { serverId: id, relativeFilePath }),
  writeServerFile: (id, relativeFilePath, content) => ipcRenderer.invoke('write-server-file', { serverId: id, relativeFilePath, content }),
  createFolder: (id, relativePath, folderName) => ipcRenderer.invoke('create-server-folder', { serverId: id, relativePath, folderName }),
  createFile: (id, relativePath, fileName, content = '') => ipcRenderer.invoke('create-server-file', { serverId: id, relativePath, fileName, content }),
  deleteServerItem: (id, relativePath) => ipcRenderer.invoke('delete-server-item', { serverId: id, relativePath }),
  renameServerItem: (id, oldRelativePath, newName) => ipcRenderer.invoke('rename-server-item', { serverId: id, oldRelativePath, newName }),
  importFiles: (id, targetRelativePath, filePaths) => ipcRenderer.invoke('import-server-files', { serverId: id, targetRelativePath, filePaths }),
  downloadFile: (id, relativeFilePath) => ipcRenderer.invoke('download-server-file', { serverId: id, relativeFilePath }),
  chooseFilesToUpload: () => ipcRenderer.invoke('choose-files-to-upload'),
  getPathForFile: (file) => {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      try {
        return webUtils.getPathForFile(file);
      } catch (e) {
        return file.path || '';
      }
    }
    return file.path || '';
  },

  // Paramètres du serveur et sélection du JAR de démarrage
  getServerProperties: (id) => ipcRenderer.invoke('get-server-properties', id),
  saveServerProperties: (id, properties) => ipcRenderer.invoke('save-server-properties', { serverId: id, properties }),
  getServerJars: (id) => ipcRenderer.invoke('get-server-jars', id),
  selectExternalJar: (id) => ipcRenderer.invoke('select-external-jar', id),

  // Diagnostics et configuration du réseau mondial (UPnP direct, DuckDNS, Portmap.io)
  testNetworkCompatibility: (serverId) => ipcRenderer.invoke('test-network-compatibility', serverId),
  saveServerNetworkConfig: (serverId, config) => ipcRenderer.invoke('save-server-network-config', { serverId, config }),
  testDuckDns: (domain, token) => ipcRenderer.invoke('test-duckdns', { domain, token }),
  selectKeyFile: () => ipcRenderer.invoke('select-key-file'),

  // Configuration de l'installateur
  getInitialLanguage: () => ipcRenderer.invoke('get-initial-language'),

  // Événement de navigation depuis le menu contextuel du Tray
  onNavToTab: (callback) => ipcRenderer.on('nav-to-tab', (e, tab) => callback(tab))
});
