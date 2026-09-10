window.addEventListener('DOMContentLoaded', async () => {
  if (window.electronAPI && window.electronAPI.platform === 'darwin') {
    document.body.classList.add('platform-mac');
  }

  // 1. Splashscreen
  const splash = document.getElementById('splash');
  setTimeout(() => {
    if (splash) {
      splash.classList.add('fade-out');
    }
  }, 1000);

  // Utilitaires de conversion RAM (valeur + unité GB/MB)
  function parseRamString(ramStr, defaultVal = 1, defaultUnit = 'GB') {
    if (!ramStr || typeof ramStr !== 'string') return { value: defaultVal, unit: defaultUnit };
    const clean = ramStr.trim().toUpperCase();
    const match = clean.match(/^(\d+)\s*([GM])(?:B)?$/);
    if (match) {
      return {
        value: parseInt(match[1], 10) || defaultVal,
        unit: match[2] === 'M' ? 'MB' : 'GB'
      };
    }
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num > 0) {
      return {
        value: num,
        unit: clean.includes('M') ? 'MB' : 'GB'
      };
    }
    return { value: defaultVal, unit: defaultUnit };
  }

  function formatRamString(value, unit) {
    const num = parseInt(value, 10) || 1;
    const u = (unit === 'MB' || unit === 'M') ? 'M' : 'G';
    return `${num}${u}`;
  }

  let cachedDetectedPublicIp = null;
  async function getOrFetchPublicIp() {
    if (cachedDetectedPublicIp) return cachedDetectedPublicIp;
    try {
      if (window.electronAPI && window.electronAPI.getPublicIp) {
        const res = await window.electronAPI.getPublicIp();
        if (res && res.success && res.ip) {
          cachedDetectedPublicIp = res.ip;
          return res.ip;
        }
      }
    } catch (e) {}
    return null;
  }

  // 2. Contrôles de la barre de fenêtre personnalisée
  const btnWindowMinimize = document.getElementById('btnWindowMinimize');
  const btnWindowMaximize = document.getElementById('btnWindowMaximize');
  const btnWindowClose = document.getElementById('btnWindowClose');

  if (window.electronAPI) {
    if (btnWindowMinimize) {
      btnWindowMinimize.addEventListener('click', () => window.electronAPI.minimize());
    }
    if (btnWindowMaximize) {
      btnWindowMaximize.addEventListener('click', () => window.electronAPI.maximize());
    }
    if (btnWindowClose) {
      btnWindowClose.addEventListener('click', () => window.electronAPI.close());
    }

    const titlebarDragArea = document.querySelector('.titlebar-drag-area');
    if (titlebarDragArea && window.electronAPI.maximize) {
      titlebarDragArea.addEventListener('dblclick', () => {
        window.electronAPI.maximize();
      });
    }

    const iconWindowMaximize = document.getElementById('iconWindowMaximize');
    if (window.electronAPI.onWindowMaximized) {
      window.electronAPI.onWindowMaximized((isMax) => {
        if (iconWindowMaximize) {
          if (isMax) {
            iconWindowMaximize.innerHTML = '<rect x="2.5" y="1" width="6.5" height="6.5" rx="1"></rect><path d="M1 3.5v5.5h5.5"></path>';
          } else {
            iconWindowMaximize.innerHTML = '<rect x="1" y="1" width="8" height="8" rx="1.5"></rect>';
          }
        }
      });
    }
  }

  // 3. Gestion des sidebars et vues
  const mainContent = document.querySelector('.main-content');
  const sidebarMain = document.getElementById('sidebar-main');
  const sidebarServer = document.getElementById('sidebar-server');

  const navItems = document.querySelectorAll('.nav-item');
  const serverNavItems = document.querySelectorAll('.server-nav-item');

  const tabViews = {
    servers: document.getElementById('view-servers'),
    create: document.getElementById('view-create-server'),
    settings: document.getElementById('view-settings'),
    console: document.getElementById('server-view-console'),
    files: document.getElementById('server-view-files'),
    properties: document.getElementById('server-view-properties'),
    network: document.getElementById('server-view-network'),
    performance: document.getElementById('server-view-performance')
  };

  function switchMainView(targetTab) {
    if (mainContent) {
      mainContent.classList.remove('no-scroll');
    }
    sidebarMain.style.display = 'flex';
    sidebarServer.style.display = 'none';

    if (typeof stopPerformancePolling === 'function') {
      stopPerformancePolling();
    }

    navItems.forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-tab') === targetTab);
    });

    Object.keys(tabViews).forEach((key) => {
      if (tabViews[key]) {
        tabViews[key].classList.toggle('active', key === targetTab);
      }
    });

    if (targetTab === 'servers') {
      loadServers();
    }
  }

  function switchServerView(targetTab) {
    if (mainContent) {
      if (targetTab === 'console') {
        mainContent.classList.add('no-scroll');
      } else {
        mainContent.classList.remove('no-scroll');
      }
    }
    sidebarMain.style.display = 'none';
    sidebarServer.style.display = 'flex';

    if (targetTab !== 'performance' && typeof stopPerformancePolling === 'function') {
      stopPerformancePolling();
    }

    serverNavItems.forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-server-tab') === targetTab);
    });

    Object.keys(tabViews).forEach((key) => {
      if (tabViews[key]) {
        tabViews[key].classList.toggle('active', key === targetTab);
      }
    });

    if (targetTab === 'console') {
      refreshConsoleView();
    } else if (targetTab === 'files') {
      refreshFilesView();
    } else if (targetTab === 'properties') {
      refreshPropertiesView();
    } else if (targetTab === 'network') {
      refreshNetworkView();
    } else if (targetTab === 'performance') {
      refreshPerformanceView();
    }
  }

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchMainView(targetTab);
    });
  });

  serverNavItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-server-tab');
      switchServerView(targetTab);
    });
  });

  const btnBackToServersList = document.getElementById('btnBackToServersList');
  if (btnBackToServersList) {
    btnBackToServersList.addEventListener('click', () => {
      switchMainView('servers');
    });
  }

  // 4. Gestion des Thèmes
  const themeOptions = document.querySelectorAll('.theme-option');
  const savedTheme = localStorage.getItem('app-theme') || 'system';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);

    themeOptions.forEach((opt) => {
      opt.classList.toggle('active', opt.getAttribute('data-theme-val') === theme);
    });
  }

  themeOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      const themeVal = opt.getAttribute('data-theme-val');
      applyTheme(themeVal);
    });
  });

  applyTheme(savedTheme);

  // 4b. Gestion des Langues (i18n)
  const langOptions = document.querySelectorAll('.lang-option');
  if (window.i18n) {
    if (!localStorage.getItem('app-language') && window.electronAPI && window.electronAPI.getInitialLanguage) {
      window.electronAPI.getInitialLanguage().then(initLang => {
        if (initLang && window.i18n) {
          window.i18n.setLanguage(initLang);
        }
      }).catch(() => {});
    }

    const curLang = window.i18n.getLanguage();
    langOptions.forEach((opt) => {
      opt.classList.toggle('active', opt.getAttribute('data-lang-val') === curLang);
      opt.addEventListener('click', () => {
        const langVal = opt.getAttribute('data-lang-val');
        window.i18n.setLanguage(langVal);
      });
    });

    window.addEventListener('language-changed', () => {
      const activeLang = window.i18n.getLanguage();
      langOptions.forEach((opt) => {
        opt.classList.toggle('active', opt.getAttribute('data-lang-val') === activeLang);
      });
      if (typeof renderServers === 'function') renderServers();
      if (typeof refreshConsoleView === 'function' && currentActiveServer) {
        refreshConsoleView();
      } else if (consoleToggleLabel) {
        consoleToggleLabel.textContent = window.i18n ? window.i18n.t('btn_start') : 'Démarrer';
      }
      if (typeof updateEngineHintText === 'function') {
        updateEngineHintText();
      }
      if (tabViews.files && tabViews.files.classList.contains('active') && typeof refreshFilesView === 'function') {
        refreshFilesView();
      }
      if (tabViews.network && tabViews.network.classList.contains('active') && typeof updateNetworkTabLiveStatus === 'function') {
        updateNetworkTabLiveStatus();
      }
      if (tabViews.properties && tabViews.properties.classList.contains('active') && typeof refreshPropertiesView === 'function') {
        refreshPropertiesView();
      }
      if (tabViews.performance && tabViews.performance.classList.contains('active') && typeof refreshPerformanceView === 'function') {
        refreshPerformanceView();
      }
    });
  }

  // 5. Gestion de la liste des serveurs & persistance
  const emptyState = document.getElementById('empty-state');
  const serversList = document.getElementById('servers-list');
  const btnHeaderNewServer = document.getElementById('btnHeaderNewServer');
  const btnCreateServer = document.getElementById('btnCreateServer');

  let servers = [];
  let currentActiveServer = null;
  const serverPublicIps = new Map(); // serverId -> address string
  const serverClaimUrls = new Map(); // serverId -> claimUrl string

  function saveCache() {
    try {
      localStorage.setItem('desktop_servers_cache', JSON.stringify(servers));
    } catch (e) {}
  }

  function getCache() {
    try {
      const data = localStorage.getItem('desktop_servers_cache');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  async function loadServers() {
    let diskServers = [];

    if (window.electronAPI && window.electronAPI.getServers) {
      try {
        diskServers = await window.electronAPI.getServers();
      } catch (err) {
        console.error('Erreur getServers:', err);
      }
    }

    const cachedServers = getCache();

    if (diskServers && diskServers.length > 0) {
      servers = diskServers;
      saveCache();
    } else if (cachedServers && cachedServers.length > 0) {
      servers = cachedServers;
      if (window.electronAPI && window.electronAPI.createServer) {
        for (const s of cachedServers) {
          try {
            await window.electronAPI.createServer(s);
          } catch (e) {}
        }
      }
    } else {
      servers = [];
    }

    if (window.electronAPI && window.electronAPI.getServerPublicIp) {
      for (const s of servers) {
        if (s.status === 'running') {
          try {
            const res = await window.electronAPI.getServerPublicIp(s.id);
            if (res) {
              const address = typeof res === 'object' ? res.address : res;
              if (address) serverPublicIps.set(s.id, address);
            }
          } catch (e) {}
        }
      }
    }

    renderServers();
  }

  function renderServers() {
    if (servers.length === 0) {
      emptyState.style.display = 'block';
      serversList.style.display = 'none';
      serversList.innerHTML = '';
      btnHeaderNewServer.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      serversList.style.display = 'flex';
      serversList.innerHTML = '';
      btnHeaderNewServer.style.display = 'inline-flex';

      servers.forEach((srv) => {
        const card = document.createElement('div');
        card.className = 'server-card';

        const isRunning = srv.status === 'running';
        const playersUnit = window.i18n ? window.i18n.t('server_card_players') : 'joueurs max';
        let statusLabel = window.i18n ? window.i18n.t('server_card_status_stopped') : 'Arrêté';
        if (srv.status === 'running') {
          statusLabel = window.i18n ? window.i18n.t('server_card_status_running') : 'En ligne';
        } else if (srv.status === 'starting') {
          statusLabel = window.i18n ? window.i18n.t('server_card_status_starting') : 'Démarrage...';
        } else if (srv.status === 'stopping') {
          statusLabel = window.i18n ? window.i18n.t('server_card_status_stopping') : 'Arrêt...';
        } else if (srv.status === 'error') {
          statusLabel = window.i18n ? window.i18n.t('server_card_status_error') : 'Erreur';
        }

        const openText = window.i18n ? window.i18n.t('server_card_open') : 'Gérer';
        const restartText = window.i18n ? window.i18n.t('btn_restart') : 'Redémarrer';
        const folderText = window.i18n ? window.i18n.t('btn_open_folder') : 'Dossier';
        const deleteText = window.i18n ? window.i18n.t('btn_delete') : 'Supprimer';
        const killText = window.i18n ? window.i18n.t('btn_kill') : 'Kill';

        card.innerHTML = `
          <div class="server-card-info">
            <div class="server-card-top">
              <span class="server-title">${srv.name}</span>
              <span class="badge-version">${srv.type || 'Vanilla'} ${srv.version}</span>
            </div>
            ${srv.description ? `<p class="server-desc">${srv.description}</p>` : ''}
            <div class="server-meta">
              <span>0 / ${srv.maxPlayers || 20} ${playersUnit}</span>
              <span>•</span>
              <span>Port ${srv.port}</span>
              <span>•</span>
              <span class="server-status-indicator ${isRunning ? 'status-online' : 'status-ready'}">
                <span class="status-dot"></span>
                <span>${statusLabel}</span>
              </span>
            </div>
          </div>
          <div class="server-actions">
            <button type="button" class="action-btn btn-action-primary btn-open-server" data-id="${srv.id}" title="${openText}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>${openText}</span>
            </button>
            ${isRunning ? `
              <button type="button" class="action-btn btn-action-secondary btn-card-restart" data-id="${srv.id}" title="${restartText}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                <span>${restartText}</span>
              </button>
              <button type="button" class="action-btn btn-action-kill btn-card-kill" data-id="${srv.id}" title="${killText}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <span>${killText}</span>
              </button>
            ` : ''}
            <button type="button" class="action-btn btn-action-secondary btn-open-folder" data-id="${srv.id}" title="${folderText}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <span>${folderText}</span>
            </button>
            <button type="button" class="action-btn btn-action-danger btn-delete" data-id="${srv.id}" title="${deleteText}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>${deleteText}</span>
            </button>
          </div>
        `;

        // Bouton Ouvrir : ouvre la page dédiée du serveur
        card.querySelector('.btn-open-server').addEventListener('click', () => {
          openDedicatedServerPage(srv);
        });

        // Bouton Redémarrer (si en ligne)
        const btnCardRestart = card.querySelector('.btn-card-restart');
        if (btnCardRestart) {
          btnCardRestart.addEventListener('click', async (e) => {
            e.stopPropagation();
            btnCardRestart.disabled = true;
            if (window.electronAPI && window.electronAPI.restartServer) {
              await window.electronAPI.restartServer(srv.id);
            }
            await loadServers();
          });
        }

        // Bouton Kill forcé (si en ligne)
        const btnCardKill = card.querySelector('.btn-card-kill');
        if (btnCardKill) {
          btnCardKill.addEventListener('click', async (e) => {
            e.stopPropagation();
            btnCardKill.disabled = true;
            if (window.electronAPI && window.electronAPI.killServer) {
              await window.electronAPI.killServer(srv.id);
            }
            srv.status = 'ready';
            saveCache();
            renderServers();
          });
        }

        // Bouton Dossier : ouvre le dossier Windows Explorer
        card.querySelector('.btn-open-folder').addEventListener('click', async () => {
          if (window.electronAPI && window.electronAPI.openServerFolder) {
            await window.electronAPI.openServerFolder(srv.id);
          }
        });

        // Bouton Supprimer
        card.querySelector('.btn-delete').addEventListener('click', async () => {
          if (window.electronAPI && window.electronAPI.deleteServer) {
            await window.electronAPI.deleteServer(srv.id);
          }
          servers = servers.filter((s) => s.id !== srv.id);
          saveCache();
          renderServers();
        });

        serversList.appendChild(card);
      });
    }
  }

  // 6. Ouverture de la page dédiée au serveur & Gestion Console Minecraft
  const activeServerName = document.getElementById('activeServerName');
  const activeServerBadge = document.getElementById('activeServerBadge');
  const consoleServerMeta = document.getElementById('consoleServerMeta');
  const btnConsoleToggle = document.getElementById('btnConsoleToggle');
  const consoleToggleLabel = document.getElementById('consoleToggleLabel');
  const consoleToggleIcon = document.getElementById('consoleToggleIcon');
  const btnConsoleRestart = document.getElementById('btnConsoleRestart');
  const btnConsoleKill = document.getElementById('btnConsoleKill');
  const consoleLogs = document.getElementById('consoleLogs');
  const consoleForm = document.getElementById('consoleForm');
  const consoleInput = document.getElementById('consoleInput');
  const btnCopyPublicIp = document.getElementById('btnCopyPublicIp');
  const copyPublicIpLabel = document.getElementById('copyPublicIpLabel');
  const btnOpenNetworkConfig = document.getElementById('btnOpenNetworkConfig');
  const upnpStatusBadge = document.getElementById('upnpStatusBadge');
  const pinggyStatusBadge = document.getElementById('pinggyStatusBadge');
  const portmapStatusBadge = document.getElementById('portmapStatusBadge');

  const serverLogsBuffer = new Map(); // serverId -> string[]

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function appendLogToBuffer(serverId, htmlContent) {
    if (!serverLogsBuffer.has(serverId)) {
      serverLogsBuffer.set(serverId, []);
    }
    const buf = serverLogsBuffer.get(serverId);
    buf.push(htmlContent);
    if (buf.length > 1500) buf.shift();

    if (currentActiveServer && currentActiveServer.id === serverId && tabViews.console && tabViews.console.classList.contains('active')) {
      const div = document.createElement('div');
      div.className = 'log-line';
      div.innerHTML = htmlContent;
      consoleLogs.appendChild(div);
      consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }
  }

  function appendLog(text, type = 'info', targetServerId = null) {
    const sid = targetServerId || (currentActiveServer ? currentActiveServer.id : null);
    if (!sid) return;

    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let colorClass = 'log-info';
    if (type === 'warn') colorClass = 'log-warn';
    if (type === 'cmd') colorClass = 'log-cmd';

    const html = `<span class="log-time">[${time}]</span> <span class="${colorClass}">${escapeHtml(text)}</span>`;
    appendLogToBuffer(sid, html);
  }

  function appendRawServerOutput(serverId, rawText, isError = false) {
    const lines = rawText.split(/\r?\n/);
    for (const l of lines) {
      const trimmed = l.trim();
      if (!trimmed) continue;

      let colorClass = 'log-info';
      if (isError || trimmed.toUpperCase().includes('WARN') || trimmed.toUpperCase().includes('ERROR')) {
        colorClass = 'log-warn';
      }

      const html = `<span class="${colorClass}">${escapeHtml(trimmed)}</span>`;
      appendLogToBuffer(serverId, html);
    }
  }

  function updatePublicIpButton() {
    if (!btnCopyPublicIp || !currentActiveServer) return;
    const isRunning = currentActiveServer.status === 'running';
    const address = serverPublicIps.get(currentActiveServer.id);
    const mode = currentActiveServer.networkMode || 'upnp';

    const upnpBadge = document.getElementById('upnpStatusBadge');
    const pinggyBadge = document.getElementById('pinggyStatusBadge');

    if (isRunning) {
      if (mode === 'pinggy') {
        if (upnpBadge) upnpBadge.style.display = 'none';
        if (pinggyBadge) pinggyBadge.style.display = 'inline-flex';
      } else {
        if (upnpBadge) upnpBadge.style.display = 'inline-flex';
        if (pinggyBadge) pinggyBadge.style.display = 'none';
      }
    } else {
      if (upnpBadge) upnpBadge.style.display = 'none';
      if (pinggyBadge) pinggyBadge.style.display = 'none';
    }

    if (isRunning && address) {
      btnCopyPublicIp.style.display = 'inline-flex';
      btnCopyPublicIp.setAttribute('data-ip', address);
      const copyTooltip = window.i18n ? window.i18n.t('tooltip_copy_ip') : "Copier l'adresse de connexion pour vos amis";
      btnCopyPublicIp.title = `${copyTooltip} (${address})`;
      if (copyPublicIpLabel) copyPublicIpLabel.textContent = window.i18n ? window.i18n.t('btn_copy_ip') : "Copier l'IP";
    } else {
      btnCopyPublicIp.style.display = 'none';
    }
  }

  // Écouteurs IPC globaux pour les flux du serveur Minecraft
  if (window.electronAPI) {
    if (window.electronAPI.onServerStdout) {
      window.electronAPI.onServerStdout(({ serverId, text }) => {
        appendRawServerOutput(serverId, text, false);
      });
    }

    if (window.electronAPI.onServerStderr) {
      window.electronAPI.onServerStderr(({ serverId, text }) => {
        appendRawServerOutput(serverId, text, true);
      });
    }

    if (window.electronAPI.onServerStopped) {
      window.electronAPI.onServerStopped(({ serverId, code }) => {
        const srv = servers.find(s => s.id === serverId);
        if (srv) srv.status = 'stopped';
        serverPublicIps.delete(serverId);
        serverClaimUrls.delete(serverId);
        if (currentActiveServer && currentActiveServer.id === serverId) {
          currentActiveServer.status = 'stopped';
          updatePublicIpButton();
          refreshConsoleView();
          if (tabViews.network && tabViews.network.classList.contains('active')) {
            updateNetworkTabLiveStatus();
          }
        }
        const stopMsg = window.i18n ? window.i18n.t('log_server_stopped_code').replace('{code}', code) : `Le serveur s'est arrêté (code de sortie: ${code}).`;
        appendLog(stopMsg, 'warn', serverId);
        saveCache();
        renderServers();
      });
    }

    if (window.electronAPI.onServerPublicIp) {
      window.electronAPI.onServerPublicIp((data) => {
        const serverId = data ? data.serverId : null;
        const address = data ? data.address : null;
        if (!serverId) return;

        if (address) {
          serverPublicIps.set(serverId, address);
          serverClaimUrls.delete(serverId);
        } else {
          serverPublicIps.delete(serverId);
        }

        if (currentActiveServer && currentActiveServer.id === serverId) {
          updatePublicIpButton();
          if (tabViews.network && tabViews.network.classList.contains('active')) {
            updateNetworkTabLiveStatus();
          }
        }

        renderServers();
      });
    }
  }

  if (btnCopyPublicIp) {
    btnCopyPublicIp.addEventListener('click', async () => {
      const address = btnCopyPublicIp.getAttribute('data-ip') || (currentActiveServer ? serverPublicIps.get(currentActiveServer.id) : null);
      if (!address) return;

      try {
        await navigator.clipboard.writeText(address);
        if (copyPublicIpLabel) copyPublicIpLabel.textContent = window.i18n ? window.i18n.t('btn_copied') : 'Copié !';
        btnCopyPublicIp.classList.add('copied');
        setTimeout(() => {
          if (copyPublicIpLabel) copyPublicIpLabel.textContent = window.i18n ? window.i18n.t('btn_copy_ip') : "Copier l'IP";
          btnCopyPublicIp.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.error('Erreur copie presse-papier:', err);
      }
    });
  }

  function openDedicatedServerPage(server) {
    currentActiveServer = server;
    currentFilesPath = '';
    currentEditingFilePath = null;
    if (fileEditorPanel) fileEditorPanel.style.display = 'none';
    activeServerName.textContent = server.name;
    activeServerBadge.textContent = `${server.type || 'Vanilla'} ${server.version}`;
    consoleServerMeta.textContent = `${server.type || 'Vanilla'} ${server.version} • Port ${server.port}`;

    switchServerView('console');

    // Premier acces / diagnostic reseau automatique
    if (!server.networkConfigured) {
      setTimeout(() => {
        openNetworkDiagnosticModal(server, 'initial');
      }, 250);
    }
  }

  function refreshConsoleView() {
    if (!currentActiveServer) return;
    const isRunning = currentActiveServer.status === 'running';

    if (consoleToggleLabel) {
      consoleToggleLabel.textContent = isRunning
        ? (window.i18n ? window.i18n.t('btn_stop') : 'Arrêter')
        : (window.i18n ? window.i18n.t('btn_start') : 'Démarrer');
    }
    if (consoleToggleIcon) {
      consoleToggleIcon.innerHTML = isRunning
        ? '<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"></rect>'
        : '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"></polygon>';
    }

    if (btnConsoleToggle) {
      btnConsoleToggle.style.backgroundColor = '';
      if (isRunning) {
        btnConsoleToggle.className = 'btn btn-compact btn-danger-subtle';
      } else {
        btnConsoleToggle.className = 'btn btn-compact';
      }
    }

    if (btnConsoleRestart) {
      btnConsoleRestart.style.display = isRunning ? 'inline-flex' : 'none';
    }
    if (btnConsoleKill) {
      btnConsoleKill.style.display = isRunning ? 'inline-flex' : 'none';
    }

    // Gestion minimaliste du bouton Copier l'IP
    updatePublicIpButton();
    if (isRunning && !serverPublicIps.has(currentActiveServer.id)) {
      if (window.electronAPI && window.electronAPI.getServerPublicIp) {
        window.electronAPI.getServerPublicIp(currentActiveServer.id).then((res) => {
          if (res) {
            const address = typeof res === 'object' ? res.address : res;
            if (address) {
              serverPublicIps.set(currentActiveServer.id, address);
              serverClaimUrls.delete(currentActiveServer.id);
            }
            if (res.claimUrl) {
              serverClaimUrls.set(currentActiveServer.id, { url: res.claimUrl, state: res.claimState || 'claim' });
            }
            updatePublicIpButton();
            renderServers();
          }
        });
      }
    }

    consoleLogs.innerHTML = '';
    const logs = serverLogsBuffer.get(currentActiveServer.id) || [];
    if (logs.length > 0) {
      logs.forEach((html) => {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.innerHTML = html;
        consoleLogs.appendChild(div);
      });
    } else {
      const initMsg = window.i18n 
        ? window.i18n.t('console_init_instance').replace('{name}', currentActiveServer.name).replace('{type}', currentActiveServer.type || 'Vanilla').replace('{version}', currentActiveServer.version)
        : `Initialisation de l'instance Minecraft ${currentActiveServer.name} (${currentActiveServer.type || 'Vanilla'} ${currentActiveServer.version})...`;
      appendLog(initMsg);
      const portMetaMsg = window.i18n
        ? window.i18n.t('console_port_meta').replace('{port}', currentActiveServer.port).replace('{max}', currentActiveServer.maxPlayers)
        : `Port local configuré : ${currentActiveServer.port} • Joueurs max : ${currentActiveServer.maxPlayers}`;
      appendLog(portMetaMsg);
      if (isRunning) {
        appendLog(window.i18n ? window.i18n.t('console_running_status') : `Serveur en cours d'exécution.`);
      } else {
        appendLog(window.i18n ? window.i18n.t('console_stopped_status') : `Serveur arrêté. Cliquez sur "Démarrer" pour lancer l'instance locale et ouvrir le tunnel public.`, 'warn');
      }
    }
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  btnConsoleToggle.addEventListener('click', async () => {
    if (!currentActiveServer) return;
    const isRunning = currentActiveServer.status === 'running';

    if (isRunning) {
      appendLog(window.i18n ? window.i18n.t('console_stopping') : 'Arrêt du serveur en cours...', 'warn');
      btnConsoleToggle.disabled = true;
      if (btnConsoleRestart) btnConsoleRestart.disabled = true;
      if (btnConsoleKill) btnConsoleKill.disabled = true;

      if (window.electronAPI && window.electronAPI.stopServer) {
        await window.electronAPI.stopServer(currentActiveServer.id);
      }
      btnConsoleToggle.disabled = false;
      if (btnConsoleRestart) btnConsoleRestart.disabled = false;
      if (btnConsoleKill) btnConsoleKill.disabled = false;
    } else {
      if (!currentActiveServer.networkConfigured) {
        openNetworkDiagnosticModal(currentActiveServer, 'initial');
        return;
      }
      appendLog(window.i18n ? window.i18n.t('console_launching') : 'Lancement du serveur Minecraft en cours...', 'info');
      btnConsoleToggle.disabled = true;
      if (window.electronAPI && window.electronAPI.startServer) {
        const res = await window.electronAPI.startServer(currentActiveServer.id);
        btnConsoleToggle.disabled = false;
        if (res && res.success) {
          currentActiveServer.status = 'running';
          const srv = servers.find(s => s.id === currentActiveServer.id);
          if (srv) srv.status = 'running';
          saveCache();
          refreshConsoleView();
          renderServers();
        } else {
          const launchFailMsg = window.i18n ? `${window.i18n.t('console_launch_failed')} : ${res?.error || 'Erreur inattendue'}` : `Échec du démarrage : ${res?.error || 'Erreur inattendue'}`;
          appendLog(launchFailMsg, 'warn');
        }
      }
    }
  });

  if (btnConsoleRestart) {
    btnConsoleRestart.addEventListener('click', async () => {
      if (!currentActiveServer || currentActiveServer.status !== 'running') return;
      appendLog(window.i18n ? window.i18n.t('console_restarting') : 'Redémarrage du serveur en cours...', 'warn');
      btnConsoleRestart.disabled = true;
      btnConsoleToggle.disabled = true;
      if (btnConsoleKill) btnConsoleKill.disabled = true;

      if (window.electronAPI && window.electronAPI.restartServer) {
        const res = await window.electronAPI.restartServer(currentActiveServer.id);
        if (res && res.success) {
          currentActiveServer.status = 'running';
          const srv = servers.find(s => s.id === currentActiveServer.id);
          if (srv) srv.status = 'running';
          saveCache();
          refreshConsoleView();
          renderServers();
          appendLog(window.i18n ? window.i18n.t('console_restarted_success') : 'Serveur redémarré avec succès.', 'info');
        } else {
          const restartFailMsg = window.i18n ? `${window.i18n.t('console_restart_failed')} : ${res?.error || 'Erreur inattendue'}` : `Échec du redémarrage : ${res?.error || 'Erreur inattendue'}`;
          appendLog(restartFailMsg, 'warn');
        }
      }

      btnConsoleRestart.disabled = false;
      btnConsoleToggle.disabled = false;
      if (btnConsoleKill) btnConsoleKill.disabled = false;
    });
  }

  if (btnConsoleKill) {
    btnConsoleKill.addEventListener('click', async () => {
      if (!currentActiveServer) return;
      appendLog(window.i18n ? window.i18n.t('console_killing') : 'Interruption forcée immédiate (Kill) en cours...', 'warn');
      btnConsoleKill.disabled = true;
      btnConsoleToggle.disabled = true;
      if (btnConsoleRestart) btnConsoleRestart.disabled = true;

      if (window.electronAPI && window.electronAPI.killServer) {
        await window.electronAPI.killServer(currentActiveServer.id);
        currentActiveServer.status = 'ready';
        const srv = servers.find(s => s.id === currentActiveServer.id);
        if (srv) srv.status = 'ready';
        saveCache();
        refreshConsoleView();
        renderServers();
        appendLog('Processus Java interrompu immédiatement (Kill).', 'warn');
      }

      btnConsoleKill.disabled = false;
      btnConsoleToggle.disabled = false;
      if (btnConsoleRestart) btnConsoleRestart.disabled = false;
    });
  }

  consoleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentActiveServer) return;
    const cmd = consoleInput.value.trim();
    if (!cmd) return;

    appendLog(`> ${cmd}`, 'cmd');
    consoleInput.value = '';

    if (currentActiveServer.status === 'running') {
      if (window.electronAPI && window.electronAPI.sendServerCommand) {
        await window.electronAPI.sendServerCommand(currentActiveServer.id, cmd);
      }
    } else {
      appendLog(window.i18n ? window.i18n.t('console_not_running') : 'Impossible d\'envoyer la commande : le serveur n\'est pas en cours d\'exécution.', 'warn');
    }
  });

  // 7. Vue Fichiers du Serveur (Architecture & Client FTP)
  const btnOpenExplorer = document.getElementById('btnOpenExplorer');
  const filesBreadcrumb = document.getElementById('filesBreadcrumb');
  const btnUploadFile = document.getElementById('btnUploadFile');
  const btnNewFolder = document.getElementById('btnNewFolder');
  const btnNewFile = document.getElementById('btnNewFile');
  const btnRefreshFiles = document.getElementById('btnRefreshFiles');
  const filesDropzone = document.getElementById('filesDropzone');
  const filesDropOverlay = document.getElementById('filesDropOverlay');
  const filesList = document.getElementById('filesList');

  const fileEditorPanel = document.getElementById('fileEditorPanel');
  const fileEditorTitle = document.getElementById('fileEditorTitle');
  const fileEditorText = document.getElementById('fileEditorText');
  const btnSaveFile = document.getElementById('btnSaveFile');
  const btnCloseFileEditor = document.getElementById('btnCloseFileEditor');

  // Modals FTP
  const modalNewFolder = document.getElementById('modalNewFolder');
  const inputNewFolderName = document.getElementById('inputNewFolderName');
  const btnCancelNewFolder = document.getElementById('btnCancelNewFolder');
  const btnConfirmNewFolder = document.getElementById('btnConfirmNewFolder');

  const modalNewFile = document.getElementById('modalNewFile');
  const inputNewFileName = document.getElementById('inputNewFileName');
  const btnCancelNewFile = document.getElementById('btnCancelNewFile');
  const btnConfirmNewFile = document.getElementById('btnConfirmNewFile');

  const modalRename = document.getElementById('modalRename');
  const inputRenameName = document.getElementById('inputRenameName');
  const btnCancelRename = document.getElementById('btnCancelRename');
  const btnConfirmRename = document.getElementById('btnConfirmRename');

  const modalConfirmDelete = document.getElementById('modalConfirmDelete');
  const deleteConfirmMessage = document.getElementById('deleteConfirmMessage');
  const btnCancelDelete = document.getElementById('btnCancelDelete');
  const btnConfirmDelete = document.getElementById('btnConfirmDelete');

  let currentFilesPath = '';
  let currentEditingFilePath = null;
  let targetRenameItem = null; // { relativePath, name }
  let targetDeleteItem = null; // { relativePath, name, isDirectory }

  function formatFileSize(bytes) {
    if (bytes === 0 || bytes === null || bytes === undefined) return '-';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
  }

  function getFileIconSvg(isDir, ext) {
    if (isDir) {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon folder-icon">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>`;
    }
    if (ext === 'jar') {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon jar-icon">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
        <line x1="6" y1="1" x2="6" y2="4"></line>
        <line x1="10" y1="1" x2="10" y2="4"></line>
        <line x1="14" y1="1" x2="14" y2="4"></line>
      </svg>`;
    }
    if (['yml', 'yaml', 'properties', 'json', 'toml', 'cfg', 'conf', 'ini', 'xml'].includes(ext)) {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon config-icon">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <circle cx="12" cy="14" r="2"></circle>
      </svg>`;
    }
    if (['log', 'txt', 'md'].includes(ext)) {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon log-icon">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>`;
    }
    if (['zip', 'gz', 'tar', '7z', 'rar', 'bz2'].includes(ext)) {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon archive-icon">
        <polyline points="21 8 21 21 3 21 3 8"></polyline>
        <rect x="1" y="3" width="22" height="5"></rect>
        <line x1="10" y1="12" x2="14" y2="12"></line>
      </svg>`;
    }
    if (['bat', 'cmd', 'sh', 'ps1', 'bash'].includes(ext)) {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon script-icon">
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
      </svg>`;
    }
    if (['mca', 'dat', 'nbt', 'schem', 'schematic', 'lock'].includes(ext)) {
      return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon world-icon">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
      </svg>`;
    }
    return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon default-icon">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
      <polyline points="13 2 13 9 20 9"></polyline>
    </svg>`;
  }

  function isEditable(ext, name) {
    const editableExts = ['txt', 'log', 'properties', 'yml', 'yaml', 'json', 'toml', 'cfg', 'conf', 'ini', 'bat', 'cmd', 'sh', 'ps1', 'csv', 'md', 'xml', 'lang'];
    if (editableExts.includes(ext)) return true;
    if (name === 'server.properties' || name === 'eula.txt' || name.endsWith('.json')) return true;
    return false;
  }

  function renderBreadcrumbs(pathStr) {
    if (!filesBreadcrumb) return;
    filesBreadcrumb.innerHTML = '';

    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.className = 'breadcrumb-btn' + (!pathStr ? ' active' : '');
    rootBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
      <span>Racine</span>
    `;
    rootBtn.addEventListener('click', () => {
      if (currentFilesPath !== '') navigateToPath('');
    });
    filesBreadcrumb.appendChild(rootBtn);

    if (!pathStr) return;

    const segments = pathStr.split('/').filter(Boolean);
    let accum = '';
    segments.forEach((seg, index) => {
      accum = accum ? `${accum}/${seg}` : seg;
      const thisPath = accum;
      const isLast = index === segments.length - 1;

      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      filesBreadcrumb.appendChild(sep);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'breadcrumb-btn' + (isLast ? ' active' : '');
      btn.textContent = seg;
      if (!isLast) {
        btn.addEventListener('click', () => navigateToPath(thisPath));
      }
      filesBreadcrumb.appendChild(btn);
    });
  }

  function navigateToPath(relPath) {
    currentFilesPath = relPath ? relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
    refreshFilesView();
  }

  async function openFileInEditor(relPath, fileName) {
    if (!currentActiveServer || !window.electronAPI || !window.electronAPI.readServerFile) return;
    const content = await window.electronAPI.readServerFile(currentActiveServer.id, relPath);
    if (content !== null) {
      currentEditingFilePath = relPath;
      fileEditorTitle.textContent = fileName;
      fileEditorText.value = content;
      fileEditorPanel.style.display = 'block';
      fileEditorPanel.scrollIntoView({ behavior: 'smooth' });
    }
  }

  async function refreshFilesView() {
    if (!currentActiveServer) return;
    filesList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary); font-size: 13px;">${window.i18n ? window.i18n.t('files_loading') : 'Chargement des fichiers...'}</div>`;
    renderBreadcrumbs(currentFilesPath);

    if (window.electronAPI && window.electronAPI.getServerFiles) {
      const result = await window.electronAPI.getServerFiles(currentActiveServer.id, currentFilesPath);
      const files = result && result.files ? result.files : (Array.isArray(result) ? result : []);
      if (result && result.currentPath !== undefined) {
        currentFilesPath = result.currentPath;
      }
      renderBreadcrumbs(currentFilesPath);
      filesList.innerHTML = '';

      // Si dans un sous-dossier, afficher la ligne Dossier parent (..)
      if (currentFilesPath) {
        const parentRow = document.createElement('div');
        parentRow.className = 'files-table-row';
        parentRow.innerHTML = `
          <div class="file-col-name">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon folder-icon">
              <polyline points="9 14 4 9 9 4"></polyline>
              <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
            </svg>
            <span style="font-weight: 600;">..</span>
            <span style="font-size: 11.5px; color: var(--text-secondary); margin-left: 6px;">(${window.i18n ? window.i18n.t('parent_folder') : 'Dossier parent'})</span>
          </div>
          <div class="file-col-size">-</div>
          <div class="file-col-date">-</div>
          <div class="file-col-actions"></div>
        `;
        parentRow.querySelector('.file-col-name').addEventListener('click', () => {
          const parts = currentFilesPath.split('/');
          parts.pop();
          navigateToPath(parts.join('/'));
        });
        filesList.appendChild(parentRow);
      }

      if (files.length === 0 && !currentFilesPath) {
        filesList.innerHTML = `
          <div class="file-empty-state">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); opacity: 0.6;">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>${window.i18n ? window.i18n.t('empty_folder') : 'Ce dossier est vide.'}</span>
          </div>
        `;
        return;
      }

      files.forEach((file) => {
        const row = document.createElement('div');
        row.className = 'files-table-row';
        const iconHtml = getFileIconSvg(file.isDirectory, file.extension);
        const sizeStr = file.isDirectory ? '-' : formatFileSize(file.size);
        const canEdit = !file.isDirectory && isEditable(file.extension, file.name);

        const editTitle = window.i18n ? window.i18n.t('btn_edit') : 'Modifier';
        const dlTitle = window.i18n ? window.i18n.t('btn_download') : 'Télécharger';
        const renameTitle = window.i18n ? window.i18n.t('btn_rename') : 'Renommer';
        const deleteTitle = window.i18n ? window.i18n.t('btn_delete') : 'Supprimer';

        let actionsHtml = '';
        if (canEdit) {
          actionsHtml += `
            <button type="button" class="file-action-btn btn-edit" title="${editTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
          `;
        }
        if (!file.isDirectory) {
          actionsHtml += `
            <button type="button" class="file-action-btn btn-download" title="${dlTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          `;
        }
        actionsHtml += `
          <button type="button" class="file-action-btn btn-rename" title="${renameTitle}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
          </button>
          <button type="button" class="file-action-btn btn-delete" title="${deleteTitle}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        `;

        row.innerHTML = `
          <div class="file-col-name" title="${escapeHtml(file.name)}">
            ${iconHtml}
            <span class="file-item-name">${escapeHtml(file.name)}</span>
          </div>
          <div class="file-col-size">${sizeStr}</div>
          <div class="file-col-date">${file.modified}</div>
          <div class="file-col-actions">${actionsHtml}</div>
        `;

        // Clic sur le nom / dossier
        row.querySelector('.file-col-name').addEventListener('click', async () => {
          if (file.isDirectory) {
            navigateToPath(file.itemRelativePath);
          } else if (canEdit) {
            openFileInEditor(file.itemRelativePath, file.name);
          }
        });

        // Bouton Éditer
        const btnEdit = row.querySelector('.btn-edit');
        if (btnEdit) {
          btnEdit.addEventListener('click', (e) => {
            e.stopPropagation();
            openFileInEditor(file.itemRelativePath, file.name);
          });
        }

        // Bouton Télécharger
        const btnDl = row.querySelector('.btn-download');
        if (btnDl) {
          btnDl.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (window.electronAPI && window.electronAPI.downloadFile) {
              await window.electronAPI.downloadFile(currentActiveServer.id, file.itemRelativePath);
            }
          });
        }

        // Bouton Renommer
        const btnRen = row.querySelector('.btn-rename');
        if (btnRen) {
          btnRen.addEventListener('click', (e) => {
            e.stopPropagation();
            targetRenameItem = { relativePath: file.itemRelativePath, name: file.name };
            inputRenameName.value = file.name;
            modalRename.style.display = 'flex';
            setTimeout(() => {
              inputRenameName.focus();
              inputRenameName.select();
            }, 50);
          });
        }

        // Bouton Supprimer
        const btnDel = row.querySelector('.btn-delete');
        if (btnDel) {
          btnDel.addEventListener('click', (e) => {
            e.stopPropagation();
            targetDeleteItem = { relativePath: file.itemRelativePath, name: file.name, isDirectory: file.isDirectory };
            const typeLabel = file.isDirectory 
              ? (window.i18n ? window.i18n.t('delete_folder_desc') : 'le dossier et son contenu')
              : (window.i18n ? window.i18n.t('delete_file_desc') : 'le fichier');
            deleteConfirmMessage.textContent = window.i18n 
              ? window.i18n.t('delete_confirm_msg').replace('{type}', typeLabel).replace('{name}', file.name)
              : `Voulez-vous vraiment supprimer définitivement ${typeLabel} "${file.name}" ?`;
            modalConfirmDelete.style.display = 'flex';
          });
        }

        filesList.appendChild(row);
      });
    }
  }

  // Ouvrir dans l'Explorateur Windows
  btnOpenExplorer.addEventListener('click', async () => {
    if (currentActiveServer && window.electronAPI && window.electronAPI.openServerFolder) {
      await window.electronAPI.openServerFolder(currentActiveServer.id, currentFilesPath);
    }
  });

  // Actualiser
  if (btnRefreshFiles) {
    btnRefreshFiles.addEventListener('click', () => {
      refreshFilesView();
    });
  }

  // Téléverser via sélecteur
  if (btnUploadFile) {
    btnUploadFile.addEventListener('click', async () => {
      if (!currentActiveServer || !window.electronAPI || !window.electronAPI.chooseFilesToUpload) return;
      const paths = await window.electronAPI.chooseFilesToUpload();
      if (paths && paths.length > 0) {
        await window.electronAPI.importFiles(currentActiveServer.id, currentFilesPath, paths);
        refreshFilesView();
      }
    });
  }

  // Nouveau dossier modal
  if (btnNewFolder) {
    btnNewFolder.addEventListener('click', () => {
      inputNewFolderName.value = '';
      modalNewFolder.style.display = 'flex';
      setTimeout(() => inputNewFolderName.focus(), 50);
    });
  }
  if (btnCancelNewFolder) {
    btnCancelNewFolder.addEventListener('click', () => {
      modalNewFolder.style.display = 'none';
    });
  }
  if (btnConfirmNewFolder) {
    btnConfirmNewFolder.addEventListener('click', async () => {
      const name = inputNewFolderName.value.trim();
      if (!name || !currentActiveServer) return;
      if (window.electronAPI && window.electronAPI.createFolder) {
        await window.electronAPI.createFolder(currentActiveServer.id, currentFilesPath, name);
        modalNewFolder.style.display = 'none';
        refreshFilesView();
      }
    });
  }
  if (inputNewFolderName) {
    inputNewFolderName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnConfirmNewFolder.click();
      if (e.key === 'Escape') modalNewFolder.style.display = 'none';
    });
  }

  // Nouveau fichier modal
  if (btnNewFile) {
    btnNewFile.addEventListener('click', () => {
      inputNewFileName.value = '';
      modalNewFile.style.display = 'flex';
      setTimeout(() => inputNewFileName.focus(), 50);
    });
  }
  if (btnCancelNewFile) {
    btnCancelNewFile.addEventListener('click', () => {
      modalNewFile.style.display = 'none';
    });
  }
  if (btnConfirmNewFile) {
    btnConfirmNewFile.addEventListener('click', async () => {
      const name = inputNewFileName.value.trim();
      if (!name || !currentActiveServer) return;
      if (window.electronAPI && window.electronAPI.createFile) {
        await window.electronAPI.createFile(currentActiveServer.id, currentFilesPath, name, '');
        modalNewFile.style.display = 'none';
        const newRel = currentFilesPath ? `${currentFilesPath}/${name}` : name;
        await refreshFilesView();
        openFileInEditor(newRel, name);
      }
    });
  }
  if (inputNewFileName) {
    inputNewFileName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnConfirmNewFile.click();
      if (e.key === 'Escape') modalNewFile.style.display = 'none';
    });
  }

  // Renommer modal
  if (btnCancelRename) {
    btnCancelRename.addEventListener('click', () => {
      modalRename.style.display = 'none';
      targetRenameItem = null;
    });
  }
  if (btnConfirmRename) {
    btnConfirmRename.addEventListener('click', async () => {
      const newName = inputRenameName.value.trim();
      if (!newName || !targetRenameItem || !currentActiveServer) return;
      if (window.electronAPI && window.electronAPI.renameServerItem) {
        await window.electronAPI.renameServerItem(currentActiveServer.id, targetRenameItem.relativePath, newName);
        modalRename.style.display = 'none';
        targetRenameItem = null;
        refreshFilesView();
      }
    });
  }
  if (inputRenameName) {
    inputRenameName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnConfirmRename.click();
      if (e.key === 'Escape') modalRename.style.display = 'none';
    });
  }

  // Suppression modal
  if (btnCancelDelete) {
    btnCancelDelete.addEventListener('click', () => {
      modalConfirmDelete.style.display = 'none';
      targetDeleteItem = null;
    });
  }
  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', async () => {
      if (!targetDeleteItem || !currentActiveServer) return;
      if (window.electronAPI && window.electronAPI.deleteServerItem) {
        await window.electronAPI.deleteServerItem(currentActiveServer.id, targetDeleteItem.relativePath);
        modalConfirmDelete.style.display = 'none';
        targetDeleteItem = null;
        refreshFilesView();
      }
    });
  }

  // ============================================================================
  // DIAGNOSTIC ET CONFIGURATION RESEAU MULTIJOUEUR (UPnP Direct, DuckDNS, Portmap)
  // ============================================================================
  let diagnosticServer = null;

  const networkDiagnosticModal = document.getElementById('networkDiagnosticModal');
  const btnCloseNetworkModal = document.getElementById('btnCloseNetworkModal');
  const btnSkipNetworkDiag = document.getElementById('btnSkipNetworkDiag');
  const btnRunNetworkDiag = document.getElementById('btnRunNetworkDiag');

  const diagStepInitial = document.getElementById('diagStepInitial');
  const diagStepCompatible = document.getElementById('diagStepCompatible');
  const diagStepIncompatible = document.getElementById('diagStepIncompatible');

  const diagTestingStatus = document.getElementById('diagTestingStatus');
  const diagTestingStatusText = document.getElementById('diagTestingStatusText');
  const diagCompatibleDetail = document.getElementById('diagCompatibleDetail');
  const diagIncompatibleDetail = document.getElementById('diagIncompatibleDetail');

  const inputDuckSubdomain = document.getElementById('inputDuckSubdomain');
  const inputDuckToken = document.getElementById('inputDuckToken');
  const btnOpenDuckDnsSite = document.getElementById('btnOpenDuckDnsSite');
  const btnTestDuckDnsConn = document.getElementById('btnTestDuckDnsConn');
  const duckDnsFeedback = document.getElementById('duckDnsFeedback');
  const chkUseDirectIpOnly = document.getElementById('chkUseDirectIpOnly');
  const btnBackToInitialDiag = document.getElementById('btnBackToInitialDiag');
  const btnConfirmUPnP = document.getElementById('btnConfirmUPnP');

  const btnBackToInitialDiag2 = document.getElementById('btnBackToInitialDiag2');
  const btnConfirmPinggy = document.getElementById('btnConfirmPinggy');
  const modalToggleUseDuckDns = document.getElementById('modalToggleUseDuckDns');
  const modalDuckFieldsContainer = document.getElementById('modalDuckFieldsContainer');
  const modalDirectIpContainer = document.getElementById('modalDirectIpContainer');
  const modalDirectIpDisplay = document.getElementById('modalDirectIpDisplay');

  if (modalToggleUseDuckDns) {
    modalToggleUseDuckDns.addEventListener('change', () => {
      const isDuck = modalToggleUseDuckDns.checked;
      if (modalDuckFieldsContainer) modalDuckFieldsContainer.style.display = isDuck ? 'block' : 'none';
      if (modalDirectIpContainer) modalDirectIpContainer.style.display = isDuck ? 'none' : 'block';
    });
  }

  function openNetworkDiagnosticModal(server, forceStep = null) {
    if (!server || !networkDiagnosticModal) return;
    diagnosticServer = server;

    if (duckDnsFeedback) {
      duckDnsFeedback.style.display = 'none';
      duckDnsFeedback.textContent = '';
      duckDnsFeedback.className = 'duck-feedback';
    }
    if (diagTestingStatus) diagTestingStatus.style.display = 'none';
    if (btnRunNetworkDiag) btnRunNetworkDiag.disabled = false;

    if (inputDuckSubdomain) {
      inputDuckSubdomain.value = server.duckdnsDomain ? server.duckdnsDomain.replace(/\.duckdns\.org$/i, '') : '';
    }
    if (inputDuckToken) {
      inputDuckToken.value = server.duckdnsToken || '';
    }

    const useDuck = !server.useDirectIp && !!server.duckdnsDomain;
    if (modalToggleUseDuckDns) {
      modalToggleUseDuckDns.checked = useDuck;
    }
    if (modalDuckFieldsContainer) modalDuckFieldsContainer.style.display = useDuck ? 'block' : 'none';
    if (modalDirectIpContainer) modalDirectIpContainer.style.display = useDuck ? 'none' : 'block';

    getOrFetchPublicIp().then(ip => {
      if (modalDirectIpDisplay) {
        modalDirectIpDisplay.textContent = `${ip || 'IP_PUBLIQUE'}:${server.port || 25565}`;
      }
    });

    if (forceStep === 'initial' || !server.networkConfigured) {
      diagStepInitial.style.display = 'flex';
      diagStepCompatible.style.display = 'none';
      diagStepIncompatible.style.display = 'none';
    } else if (server.networkMode === 'upnp') {
      diagStepInitial.style.display = 'none';
      diagStepCompatible.style.display = 'flex';
      diagStepIncompatible.style.display = 'none';
    } else if (server.networkMode === 'pinggy') {
      diagStepInitial.style.display = 'none';
      diagStepCompatible.style.display = 'none';
      diagStepIncompatible.style.display = 'flex';
    } else {
      diagStepInitial.style.display = 'flex';
      diagStepCompatible.style.display = 'none';
      diagStepIncompatible.style.display = 'none';
    }

    networkDiagnosticModal.style.display = 'flex';
  }

  if (btnCloseNetworkModal) {
    btnCloseNetworkModal.addEventListener('click', () => {
      if (networkDiagnosticModal) networkDiagnosticModal.style.display = 'none';
    });
  }

  if (btnSkipNetworkDiag) {
    btnSkipNetworkDiag.addEventListener('click', () => {
      if (diagnosticServer) {
        diagnosticServer.networkConfigured = true;
        saveCache();
      }
      if (networkDiagnosticModal) networkDiagnosticModal.style.display = 'none';
    });
  }

  if (btnBackToInitialDiag) {
    btnBackToInitialDiag.addEventListener('click', () => {
      diagStepCompatible.style.display = 'none';
      diagStepIncompatible.style.display = 'none';
      diagStepInitial.style.display = 'flex';
    });
  }

  if (btnRunNetworkDiag) {
    btnRunNetworkDiag.addEventListener('click', async () => {
      if (!diagnosticServer) return;
      btnRunNetworkDiag.disabled = true;
      if (diagTestingStatus) {
        diagTestingStatus.style.display = 'flex';
        if (diagTestingStatusText) {
          diagTestingStatusText.textContent = window.i18n ? window.i18n.t('diag_testing_box') : "Interrogation de votre box Internet et vérification des protocoles...";
        }
      }

      try {
        let result = null;
        if (window.electronAPI && window.electronAPI.testNetworkCompatibility) {
          result = await window.electronAPI.testNetworkCompatibility(diagnosticServer.id);
        }

        if (result && result.compatible) {
          diagStepInitial.style.display = 'none';
          diagStepIncompatible.style.display = 'none';
          diagStepCompatible.style.display = 'flex';
          if (diagCompatibleDetail) {
            diagCompatibleDetail.textContent = result.details || (window.i18n ? window.i18n.t('diag_compatible_detail') : "Votre équipement autorise l'ouverture de port directe avec une IP publique dédiée.");
          }
        } else {
          diagStepInitial.style.display = 'none';
          diagStepCompatible.style.display = 'none';
          diagStepIncompatible.style.display = 'flex';
          if (diagIncompatibleDetail) {
            diagIncompatibleDetail.textContent = (result && (result.details || result.reason)) || (window.i18n ? window.i18n.t('diag_incompatible_detail') : "UPnP non supporté ou réseau sous Carrier-Grade NAT (CGNAT).");
          }
        }
      } catch (err) {
        diagStepInitial.style.display = 'none';
        diagStepCompatible.style.display = 'none';
        diagStepIncompatible.style.display = 'flex';
        if (diagIncompatibleDetail) {
          diagIncompatibleDetail.textContent = (window.i18n ? window.i18n.t('diag_error_detail') : "Erreur lors du diagnostic") + ` : ${err.message || err}`;
        }
      } finally {
        btnRunNetworkDiag.disabled = false;
        if (diagTestingStatus) diagTestingStatus.style.display = 'none';
      }
    });
  }

  if (btnOpenDuckDnsSite) {
    btnOpenDuckDnsSite.addEventListener('click', () => {
      if (window.electronAPI && window.electronAPI.openExternalUrl) {
        window.electronAPI.openExternalUrl('https://www.duckdns.org');
      }
    });
  }

  if (btnBackToInitialDiag2) {
    btnBackToInitialDiag2.addEventListener('click', () => {
      diagStepCompatible.style.display = 'none';
      diagStepIncompatible.style.display = 'none';
      diagStepInitial.style.display = 'flex';
    });
  }

  if (btnTestDuckDnsConn) {
    btnTestDuckDnsConn.addEventListener('click', async () => {
      const sub = inputDuckSubdomain ? inputDuckSubdomain.value.trim().toLowerCase().replace(/\.duckdns\.org$/i, '') : '';
      const token = inputDuckToken ? inputDuckToken.value.trim() : '';

      if (!sub || !token) {
        if (duckDnsFeedback) {
          duckDnsFeedback.style.display = 'block';
          duckDnsFeedback.className = 'duck-feedback error';
          duckDnsFeedback.textContent = window.i18n ? window.i18n.t('net_duck_feedback_fill') : "Veuillez renseigner le sous-domaine et le jeton de sécurité DuckDNS.";
        }
        return;
      }

      btnTestDuckDnsConn.disabled = true;
      if (duckDnsFeedback) {
        duckDnsFeedback.style.display = 'block';
        duckDnsFeedback.className = 'duck-feedback';
        duckDnsFeedback.textContent = window.i18n ? window.i18n.t('net_duck_testing') : "Test de communication avec l'API DuckDNS...";
      }

      try {
        let res = null;
        if (window.electronAPI && window.electronAPI.testDuckDns) {
          res = await window.electronAPI.testDuckDns(sub, token);
        }

        if (res && res.success) {
          duckDnsFeedback.className = 'duck-feedback success';
          duckDnsFeedback.textContent = window.i18n ? window.i18n.t('net_duck_success').replace('{sub}', sub).replace('{ip}', res.ip || 'OK') : `Liaison réussie ! Le domaine ${sub}.duckdns.org a été associé à votre IP (${res.ip || 'OK'}).`;
        } else {
          duckDnsFeedback.className = 'duck-feedback error';
          duckDnsFeedback.textContent = `${window.i18n ? window.i18n.t('net_duck_failed') : 'Échec de validation'} : ${res?.error || (window.i18n ? window.i18n.t('net_duck_verify_notice') : 'Vérifiez le nom et le jeton sur duckdns.org.')}`;
        }
      } catch (e) {
        duckDnsFeedback.className = 'duck-feedback error';
        duckDnsFeedback.textContent = `${window.i18n ? window.i18n.t('net_error_network') : 'Erreur réseau'} : ${e.message || e}`;
      } finally {
        btnTestDuckDnsConn.disabled = false;
      }
    });
  }

  if (btnConfirmUPnP) {
    btnConfirmUPnP.addEventListener('click', async () => {
      if (!diagnosticServer) return;
      const isDuck = modalToggleUseDuckDns ? modalToggleUseDuckDns.checked : false;
      const sub = inputDuckSubdomain ? inputDuckSubdomain.value.trim().toLowerCase().replace(/\.duckdns\.org$/i, '') : '';
      const token = inputDuckToken ? inputDuckToken.value.trim() : '';

      if (isDuck && (!sub || !token)) {
        if (duckDnsFeedback) {
          duckDnsFeedback.style.display = 'block';
          duckDnsFeedback.className = 'duck-feedback error';
          duckDnsFeedback.textContent = window.i18n ? window.i18n.t('net_duck_feedback_fill') : "Veuillez renseigner le sous-domaine et le jeton DuckDNS.";
        }
        return;
      }

      const fullDomain = (isDuck && sub) ? `${sub}.duckdns.org` : '';
      const config = {
        networkMode: 'upnp',
        duckdnsDomain: fullDomain,
        duckdnsToken: isDuck ? token : '',
        useDirectIp: !isDuck
      };

      if (window.electronAPI && window.electronAPI.saveServerNetworkConfig) {
        await window.electronAPI.saveServerNetworkConfig(diagnosticServer.id, config);
      }

      diagnosticServer.networkMode = 'upnp';
      diagnosticServer.duckdnsDomain = fullDomain;
      diagnosticServer.duckdnsToken = isDuck ? token : '';
      diagnosticServer.useDirectIp = !isDuck;
      diagnosticServer.networkConfigured = true;

      const inList = servers.find(s => s.id === diagnosticServer.id);
      if (inList) Object.assign(inList, diagnosticServer);
      saveCache();

      if (networkDiagnosticModal) networkDiagnosticModal.style.display = 'none';
      updatePublicIpButton();
      appendLog(window.i18n ? window.i18n.t('net_upnp_success') : `Mode UPnP Direct activé avec succès (0 ms de routage, latence 5-15 ms).`, 'info', diagnosticServer.id);
    });
  }

  if (btnConfirmPinggy) {
    btnConfirmPinggy.addEventListener('click', async () => {
      if (!diagnosticServer) return;
      const config = {
        networkMode: 'pinggy'
      };

      if (window.electronAPI && window.electronAPI.saveServerNetworkConfig) {
        await window.electronAPI.saveServerNetworkConfig(diagnosticServer.id, config);
      }

      diagnosticServer.networkMode = 'pinggy';
      diagnosticServer.networkConfigured = true;

      const inList = servers.find(s => s.id === diagnosticServer.id);
      if (inList) Object.assign(inList, diagnosticServer);
      saveCache();

      if (networkDiagnosticModal) networkDiagnosticModal.style.display = 'none';
      updatePublicIpButton();
      appendLog(window.i18n ? window.i18n.t('net_pinggy_success') : `Mode Pinggy automatique activé avec succès (~20 ms).`, 'info', diagnosticServer.id);
    });
  }

  // ============================================================================
  // VUE DÉDIÉE RÉSEAU : GESTION MULTIJOUEUR, STATUT & DIAGNOSTIC REFAISABLE
  // ============================================================================
  const networkServerMeta = document.getElementById('networkServerMeta');
  const btnTabRerunDiagHeader = document.getElementById('btnTabRerunDiagHeader');
  const netTabBadgeActive = document.getElementById('netTabBadgeActive');
  const netTabBadgeText = document.getElementById('netTabBadgeText');
  const netTabAddressStatusText = document.getElementById('netTabAddressStatusText');
  const netTabPublicAddressDisplay = document.getElementById('netTabPublicAddressDisplay');
  const btnCopyAddressFromTab = document.getElementById('btnCopyAddressFromTab');
  const lblCopyAddressTab = document.getElementById('lblCopyAddressTab');
  const netTabLocalPortDisplay = document.getElementById('netTabLocalPortDisplay');
  const netTabRoutingSubtext = document.getElementById('netTabRoutingSubtext');
  const netTabRoutingStatusDisplay = document.getElementById('netTabRoutingStatusDisplay');

  const btnRunTabDiag = document.getElementById('btnRunTabDiag');
  const netTabDiagBanner = document.getElementById('netTabDiagBanner');
  const netTabDiagIcon = document.getElementById('netTabDiagIcon');
  const netTabDiagTitle = document.getElementById('netTabDiagTitle');
  const netTabDiagDesc = document.getElementById('netTabDiagDesc');
  const netTabDiagTesting = document.getElementById('netTabDiagTesting');

  const netToggleUseDuckDns = document.getElementById('netToggleUseDuckDns');
  const netDuckFieldsContainer = document.getElementById('netDuckFieldsContainer');
  const netDirectIpContainer = document.getElementById('netDirectIpContainer');
  const netDirectIpDisplay = document.getElementById('netDirectIpDisplay');

  const netInputDuckSubdomain = document.getElementById('netInputDuckSubdomain');
  const netInputDuckToken = document.getElementById('netInputDuckToken');
  const btnNetOpenDuckDns = document.getElementById('btnNetOpenDuckDns');
  const btnNetTestDuckDns = document.getElementById('btnNetTestDuckDns');
  const netDuckFeedback = document.getElementById('netDuckFeedback');
  const btnSaveNetworkConfigTab = document.getElementById('btnSaveNetworkConfigTab');
  const netSaveFeedback = document.getElementById('netSaveFeedback');

  if (netToggleUseDuckDns) {
    netToggleUseDuckDns.addEventListener('change', () => {
      const isDuck = netToggleUseDuckDns.checked;
      if (netDuckFieldsContainer) netDuckFieldsContainer.style.display = isDuck ? 'block' : 'none';
      if (netDirectIpContainer) netDirectIpContainer.style.display = isDuck ? 'none' : 'block';
    });
  }

  function updateNetworkTabLiveStatus() {
    if (!currentActiveServer) return;
    const isRunning = currentActiveServer.status === 'running';
    const address = serverPublicIps.get(currentActiveServer.id);
    const mode = currentActiveServer.networkMode || 'upnp';

    if (networkServerMeta) {
      networkServerMeta.textContent = `${currentActiveServer.name} • ${currentActiveServer.type || 'Vanilla'} ${currentActiveServer.version} • Port ${currentActiveServer.port || 25565}`;
    }

    if (netTabLocalPortDisplay) {
      netTabLocalPortDisplay.textContent = `${currentActiveServer.port || 25565} (TCP)`;
    }

    if (netTabBadgeActive && netTabBadgeText) {
      netTabBadgeActive.className = 'tunnel-latency-badge';
      if (mode === 'pinggy') {
        netTabBadgeActive.classList.add('badge-pinggy');
        netTabBadgeText.textContent = window.i18n ? window.i18n.t('badge_pinggy_text') : 'Pinggy • 20 ms';
      } else {
        netTabBadgeActive.classList.add('badge-upnp');
        netTabBadgeText.textContent = window.i18n ? window.i18n.t('badge_upnp_text') : 'UPnP Direct • 5-15 ms';
      }
    }

    if (netTabPublicAddressDisplay) {
      if (isRunning) {
        if (address) {
          netTabPublicAddressDisplay.textContent = address;
          if (btnCopyAddressFromTab) btnCopyAddressFromTab.style.display = 'inline-flex';
          if (netTabRoutingStatusDisplay) {
            netTabRoutingStatusDisplay.textContent = window.i18n ? window.i18n.t('net_status_online') : 'En ligne (Actif)';
            netTabRoutingStatusDisplay.style.color = 'var(--accent)';
          }
          if (netTabRoutingSubtext) {
            netTabRoutingSubtext.textContent = window.i18n ? window.i18n.t('net_routing_active') : 'Le routage externe est actif et prêt à recevoir des joueurs.';
          }
        } else {
          netTabPublicAddressDisplay.textContent = window.i18n ? window.i18n.t('net_connecting') : 'Connexion et assignation en cours...';
          if (btnCopyAddressFromTab) btnCopyAddressFromTab.style.display = 'none';
          if (netTabRoutingStatusDisplay) {
            netTabRoutingStatusDisplay.textContent = window.i18n ? window.i18n.t('net_status_init') : 'Initialisation...';
            netTabRoutingStatusDisplay.style.color = 'var(--text-secondary)';
          }
          if (netTabRoutingSubtext) {
            netTabRoutingSubtext.textContent = window.i18n ? window.i18n.t('net_opening_port') : 'Ouverture du port ou établissement du tunnel vers le relais...';
          }
        }
      } else {
        const atStartup = window.i18n ? window.i18n.t('net_at_startup') : '(au démarrage)';
        if (mode === 'upnp' && currentActiveServer.duckdnsDomain && !currentActiveServer.useDirectIp) {
          const cleanSub = currentActiveServer.duckdnsDomain.trim().toLowerCase().replace(/\.duckdns\.org$/i, '');
          const port = currentActiveServer.port || 25565;
          netTabPublicAddressDisplay.textContent = `${cleanSub}.duckdns.org${port === 25565 ? '' : ':' + port} ${atStartup}`;
        } else if (mode === 'upnp') {
          const port = currentActiveServer.port || 25565;
          const ip = cachedDetectedPublicIp;
          const directText = window.i18n ? window.i18n.t('net_public_ip_direct') : 'IP publique directe';
          netTabPublicAddressDisplay.textContent = `${ip ? ip + ':' + port : directText} ${atStartup}`;
        } else {
          netTabPublicAddressDisplay.textContent = window.i18n ? window.i18n.t('net_pinggy_auto_startup') : 'Relais Pinggy automatique (au démarrage)';
        }
        if (btnCopyAddressFromTab) btnCopyAddressFromTab.style.display = 'none';
        if (netTabRoutingStatusDisplay) {
          netTabRoutingStatusDisplay.textContent = window.i18n ? window.i18n.t('net_status_stopped') : 'Arrêté';
          netTabRoutingStatusDisplay.style.color = 'var(--text-secondary)';
        }
        if (netTabRoutingSubtext) {
          netTabRoutingSubtext.textContent = window.i18n ? window.i18n.t('net_port_startup_sub') : 'Le port et le routage s\'activeront automatiquement au lancement du serveur.';
        }
      }
    }
  }

  function setNetworkTabSelectedMode(mode) {
    const effectiveMode = (mode === 'pinggy') ? 'pinggy' : 'upnp';
    const radioUPnP = document.getElementById('radioModeUPnP');
    const radioPinggy = document.getElementById('radioModePinggy');

    const cardUPnP = document.getElementById('cardModeUPnP');
    const cardPinggy = document.getElementById('cardModePinggy');

    const sectionUPnP = document.getElementById('netSectionUPnPConfig');
    const sectionPinggy = document.getElementById('netSectionPinggyConfig');

    if (radioUPnP) radioUPnP.checked = (effectiveMode === 'upnp');
    if (radioPinggy) radioPinggy.checked = (effectiveMode === 'pinggy');

    if (cardUPnP) cardUPnP.classList.toggle('active', effectiveMode === 'upnp');
    if (cardPinggy) cardPinggy.classList.toggle('active', effectiveMode === 'pinggy');

    if (sectionUPnP) sectionUPnP.style.display = (effectiveMode === 'upnp') ? 'block' : 'none';
    if (sectionPinggy) sectionPinggy.style.display = (effectiveMode === 'pinggy') ? 'block' : 'none';
  }

  function refreshNetworkView() {
    if (!currentActiveServer) return;
    updateNetworkTabLiveStatus();

    const mode = currentActiveServer.networkMode || 'upnp';
    setNetworkTabSelectedMode(mode);

    const useDuck = !currentActiveServer.useDirectIp && !!currentActiveServer.duckdnsDomain;
    if (netToggleUseDuckDns) {
      netToggleUseDuckDns.checked = useDuck;
    }
    if (netDuckFieldsContainer) netDuckFieldsContainer.style.display = useDuck ? 'block' : 'none';
    if (netDirectIpContainer) netDirectIpContainer.style.display = useDuck ? 'none' : 'block';

    getOrFetchPublicIp().then(ip => {
      if (netDirectIpDisplay) {
        netDirectIpDisplay.textContent = `${ip || 'IP_PUBLIQUE'}:${currentActiveServer.port || 25565}`;
      }
    });

    if (netInputDuckSubdomain) {
      netInputDuckSubdomain.value = currentActiveServer.duckdnsDomain ? currentActiveServer.duckdnsDomain.replace(/\.duckdns\.org$/i, '') : '';
    }
    if (netInputDuckToken) {
      netInputDuckToken.value = currentActiveServer.duckdnsToken || '';
    }
    if (netDuckFeedback) {
      netDuckFeedback.style.display = 'none';
      netDuckFeedback.textContent = '';
      netDuckFeedback.className = 'duck-feedback';
    }
  }

  async function runTabNetworkDiagnostic() {
    if (!currentActiveServer) return;

    if (btnRunTabDiag) btnRunTabDiag.disabled = true;
    if (btnTabRerunDiagHeader) btnTabRerunDiagHeader.disabled = true;

    if (netTabDiagTesting) netTabDiagTesting.style.display = 'flex';
    if (netTabDiagBanner) netTabDiagBanner.style.display = 'none';

    try {
      let res = null;
      if (window.electronAPI && window.electronAPI.testNetworkCompatibility) {
        res = await window.electronAPI.testNetworkCompatibility(currentActiveServer.id);
      }

      if (netTabDiagBanner) netTabDiagBanner.style.display = 'flex';

      if (res && res.compatible) {
        if (netTabDiagBanner) {
          netTabDiagBanner.className = 'diag-status-banner banner-success';
        }
        if (netTabDiagIcon) {
          netTabDiagIcon.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
        }
        if (netTabDiagTitle) {
          netTabDiagTitle.textContent = window.i18n ? window.i18n.t('diag_upnp_comp_title') : "Connexion compatible UPnP Direct (0 ms détour, 5-15 ms)";
        }
        if (netTabDiagDesc) {
          netTabDiagDesc.textContent = res.details || (window.i18n ? window.i18n.t('diag_upnp_comp_desc') : "Votre équipement autorise l'ouverture de port directe avec une IP publique dédiée. Le mode UPnP Direct avec DuckDNS est optimal pour vos joueurs.");
        }
        setNetworkTabSelectedMode('upnp');
      } else {
        if (netTabDiagBanner) {
          netTabDiagBanner.className = 'diag-status-banner banner-warning';
        }
        if (netTabDiagIcon) {
          netTabDiagIcon.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          `;
        }
        if (netTabDiagTitle) {
          netTabDiagTitle.textContent = window.i18n ? window.i18n.t('diag_blocked_title') : "Connexion directe bloquée par votre opérateur ou équipement";
        }
        if (netTabDiagDesc) {
          const reason = (res && (res.details || res.reason)) || (window.i18n ? window.i18n.t('diag_incompatible_detail') : "UPnP non supporté ou réseau sous Carrier-Grade NAT (CGNAT).");
          const cgnatDesc = window.i18n ? window.i18n.t('diag_cgnat_desc') : "Cette limitation dépend de votre box ou opérateur, et non de DesktopServer. Le mode Pinggy automatique contourne le problème immédiatement.";
          netTabDiagDesc.textContent = `${reason} ${cgnatDesc}`;
        }
        if (!currentActiveServer.networkMode || currentActiveServer.networkMode === 'upnp') {
          setNetworkTabSelectedMode('pinggy');
        }
      }
    } catch (err) {
      if (netTabDiagBanner) {
        netTabDiagBanner.style.display = 'flex';
        netTabDiagBanner.className = 'diag-status-banner banner-warning';
      }
      if (netTabDiagTitle) netTabDiagTitle.textContent = window.i18n ? window.i18n.t('diag_error_title') : "Erreur lors du diagnostic";
      if (netTabDiagDesc) netTabDiagDesc.textContent = `${window.i18n ? window.i18n.t('diag_error_analysis') : 'Une erreur est survenue lors de l\'analyse'} : ${err.message || err}`;
    } finally {
      if (btnRunTabDiag) btnRunTabDiag.disabled = false;
      if (btnTabRerunDiagHeader) btnTabRerunDiagHeader.disabled = false;
      if (netTabDiagTesting) netTabDiagTesting.style.display = 'none';
    }
  }

  if (btnRunTabDiag) {
    btnRunTabDiag.addEventListener('click', runTabNetworkDiagnostic);
  }
  if (btnTabRerunDiagHeader) {
    btnTabRerunDiagHeader.addEventListener('click', runTabNetworkDiagnostic);
  }

  // Clic sur les cartes de sélection de mode (UPnP Direct et Pinggy)
  ['upnp', 'pinggy'].forEach((m) => {
    const cardId = m === 'upnp' ? 'cardModeUPnP' : 'cardModePinggy';
    const card = document.getElementById(cardId);
    if (card) {
      card.addEventListener('click', () => {
        setNetworkTabSelectedMode(m);
      });
    }
    const radioId = m === 'upnp' ? 'radioModeUPnP' : 'radioModePinggy';
    const radio = document.getElementById(radioId);
    if (radio) {
      radio.addEventListener('change', () => {
        setNetworkTabSelectedMode(m);
      });
    }
  });

  // Copie de l'adresse depuis l'onglet
  if (btnCopyAddressFromTab) {
    btnCopyAddressFromTab.addEventListener('click', async () => {
      if (!currentActiveServer) return;
      const addr = serverPublicIps.get(currentActiveServer.id);
      if (!addr) return;
      try {
        await navigator.clipboard.writeText(addr);
        if (lblCopyAddressTab) lblCopyAddressTab.textContent = window.i18n ? window.i18n.t('btn_copied') : 'Copié !';
        setTimeout(() => {
          if (lblCopyAddressTab) lblCopyAddressTab.textContent = window.i18n ? window.i18n.t('btn_copy_net_addr') : 'Copier';
        }, 1500);
      } catch (e) {}
    });
  }

  // Actions DuckDNS dans l'onglet
  if (btnNetOpenDuckDns) {
    btnNetOpenDuckDns.addEventListener('click', () => {
      if (window.electronAPI && window.electronAPI.openExternalUrl) {
        window.electronAPI.openExternalUrl('https://www.duckdns.org');
      }
    });
  }

  if (btnNetTestDuckDns) {
    btnNetTestDuckDns.addEventListener('click', async () => {
      const sub = netInputDuckSubdomain ? netInputDuckSubdomain.value.trim().toLowerCase().replace(/\.duckdns\.org$/i, '') : '';
      const token = netInputDuckToken ? netInputDuckToken.value.trim() : '';

      if (!sub || !token) {
        if (netDuckFeedback) {
          netDuckFeedback.style.display = 'block';
          netDuckFeedback.className = 'duck-feedback error';
          netDuckFeedback.textContent = window.i18n ? window.i18n.t('net_duck_feedback_fill') : "Veuillez renseigner le sous-domaine et le jeton de sécurité DuckDNS.";
        }
        return;
      }

      btnNetTestDuckDns.disabled = true;
      if (netDuckFeedback) {
        netDuckFeedback.style.display = 'block';
        netDuckFeedback.className = 'duck-feedback';
        netDuckFeedback.textContent = window.i18n ? window.i18n.t('net_duck_testing') : "Test de communication avec l'API DuckDNS...";
      }

      try {
        let res = null;
        if (window.electronAPI && window.electronAPI.testDuckDns) {
          res = await window.electronAPI.testDuckDns(sub, token);
        }

        if (res && res.success) {
          netDuckFeedback.className = 'duck-feedback success';
          netDuckFeedback.textContent = window.i18n ? window.i18n.t('net_duck_synced').replace('{sub}', sub).replace('{ip}', res.ip || 'OK') : `Liaison réussie ! Le domaine ${sub}.duckdns.org a été synchronisé avec votre IP (${res.ip || 'OK'}).`;
        } else {
          netDuckFeedback.className = 'duck-feedback error';
          netDuckFeedback.textContent = `${window.i18n ? window.i18n.t('net_duck_failed') : 'Échec de validation'} : ${res?.error || (window.i18n ? window.i18n.t('net_duck_verify_notice') : 'Vérifiez le nom et le jeton sur duckdns.org.')}`;
        }
      } catch (e) {
        netDuckFeedback.className = 'duck-feedback error';
        netDuckFeedback.textContent = `${window.i18n ? window.i18n.t('net_error_network') : 'Erreur réseau'} : ${e.message || e}`;
      } finally {
        btnNetTestDuckDns.disabled = false;
      }
    });
  }

  // Enregistrement des paramètres réseau dans l'onglet
  if (btnSaveNetworkConfigTab) {
    btnSaveNetworkConfigTab.addEventListener('click', async () => {
      if (!currentActiveServer) return;

      const selectedRadio = document.querySelector('input[name="netModeChoice"]:checked');
      const mode = selectedRadio ? selectedRadio.value : 'upnp';

      const isDuck = (mode === 'upnp') && netToggleUseDuckDns ? netToggleUseDuckDns.checked : false;
      const sub = netInputDuckSubdomain ? netInputDuckSubdomain.value.trim().toLowerCase().replace(/\.duckdns\.org$/i, '') : '';
      const token = netInputDuckToken ? netInputDuckToken.value.trim() : '';

      if (isDuck && (!sub || !token)) {
        if (netDuckFeedback) {
          netDuckFeedback.style.display = 'block';
          netDuckFeedback.className = 'duck-feedback error';
          netDuckFeedback.textContent = window.i18n ? window.i18n.t('net_duck_feedback_fill') : "Veuillez renseigner le sous-domaine et le jeton DuckDNS.";
        }
        return;
      }

      const fullDomain = (isDuck && sub) ? `${sub}.duckdns.org` : '';
      const config = {
        networkMode: mode,
        duckdnsDomain: fullDomain,
        duckdnsToken: isDuck ? token : '',
        useDirectIp: !isDuck
      };

      if (window.electronAPI && window.electronAPI.saveServerNetworkConfig) {
        await window.electronAPI.saveServerNetworkConfig(currentActiveServer.id, config);
      }

      currentActiveServer.networkMode = mode;
      currentActiveServer.duckdnsDomain = fullDomain;
      currentActiveServer.duckdnsToken = isDuck ? token : '';
      currentActiveServer.useDirectIp = !isDuck;
      currentActiveServer.networkConfigured = true;

      const inList = servers.find(s => s.id === diagnosticServer?.id || s.id === currentActiveServer.id);
      if (inList) Object.assign(inList, currentActiveServer);
      saveCache();

      updateNetworkTabLiveStatus();
      updatePublicIpButton();

      if (netSaveFeedback) {
        netSaveFeedback.style.display = 'inline';
        setTimeout(() => {
          netSaveFeedback.style.display = 'none';
        }, 2000);
      }
      appendLog(window.i18n ? window.i18n.t('net_saved_mode').replace('{mode}', mode) : `Paramètres réseau enregistrés (Mode: ${mode}).`, 'info', currentActiveServer.id);
    });
  }

  // Drag and drop réel sur le gestionnaire de fichiers
  let dragCounter = 0;

  if (filesDropzone && filesDropOverlay) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      window.addEventListener(eventName, (e) => {
        e.preventDefault();
      }, false);
    });

    filesDropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      filesDropOverlay.classList.add('active');
    });

    filesDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!filesDropOverlay.classList.contains('active')) {
        filesDropOverlay.classList.add('active');
      }
    });

    filesDropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        filesDropOverlay.classList.remove('active');
      }
    });

    filesDropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      filesDropOverlay.classList.remove('active');

      if (!currentActiveServer || !window.electronAPI || !window.electronAPI.importFiles) return;

      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;

      const filePaths = [];
      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i];
        let filePath = '';
        if (window.electronAPI.getPathForFile) {
          filePath = window.electronAPI.getPathForFile(file);
        } else {
          filePath = file.path || '';
        }
        if (filePath) {
          filePaths.push(filePath);
        }
      }

      if (filePaths.length > 0) {
        await window.electronAPI.importFiles(currentActiveServer.id, currentFilesPath, filePaths);
        refreshFilesView();
      }
    });
  }

  // File Editor Actions
  btnSaveFile.addEventListener('click', async () => {
    if (currentActiveServer && currentEditingFilePath && window.electronAPI && window.electronAPI.writeServerFile) {
      await window.electronAPI.writeServerFile(currentActiveServer.id, currentEditingFilePath, fileEditorText.value);
      btnSaveFile.textContent = window.i18n ? window.i18n.t('msg_saved_file') : 'Enregistré !';
      setTimeout(() => {
        btnSaveFile.textContent = window.i18n ? window.i18n.t('btn_save_file') : 'Enregistrer';
      }, 1500);
      refreshFilesView();
    }
  });

  btnCloseFileEditor.addEventListener('click', () => {
    fileEditorPanel.style.display = 'none';
    currentEditingFilePath = null;
  });

  // 8. Vue Paramètres du Serveur (server.properties)
  const propSearchInput = document.getElementById('propSearchInput');
  const propCategoryFilter = document.getElementById('propCategoryFilter');
  const btnSaveProperties = document.getElementById('btnSaveProperties');

  // Serveur & Démarrage
  const propStartupJar = document.getElementById('propStartupJar');
  const btnRefreshJars = document.getElementById('btnRefreshJars');
  const btnBrowseJar = document.getElementById('btnBrowseJar');
  const propRamMinValue = document.getElementById('propRamMinValue');
  const propRamMinUnit = document.getElementById('propRamMinUnit');
  const propRamMaxValue = document.getElementById('propRamMaxValue');
  const propRamMaxUnit = document.getElementById('propRamMaxUnit');

  // Général & Réseau
  const propMotd = document.getElementById('propMotd');
  const propPort = document.getElementById('propPort');
  const propServerIp = document.getElementById('propServerIp');
  const propMaxPlayers = document.getElementById('propMaxPlayers');
  const propEnableStatus = document.getElementById('propEnableStatus');
  const propHideOnlinePlayers = document.getElementById('propHideOnlinePlayers');
  const propNetworkCompressionThreshold = document.getElementById('propNetworkCompressionThreshold');
  const propMaxTickTime = document.getElementById('propMaxTickTime');
  const propRateLimit = document.getElementById('propRateLimit');
  const propPreventProxyConnections = document.getElementById('propPreventProxyConnections');
  const propUseNativeTransport = document.getElementById('propUseNativeTransport');
  const propAcceptsTransfers = document.getElementById('propAcceptsTransfers');

  // Gameplay & Règles
  const propGamemode = document.getElementById('propGamemode');
  const propForceGamemode = document.getElementById('propForceGamemode');
  const propDifficulty = document.getElementById('propDifficulty');
  const propHardcore = document.getElementById('propHardcore');
  const propPvp = document.getElementById('propPvp');
  const propAllowFlight = document.getElementById('propAllowFlight');
  const propSpawnProtection = document.getElementById('propSpawnProtection');
  const propPlayerIdleTimeout = document.getElementById('propPlayerIdleTimeout');
  const propPauseWhenEmptySeconds = document.getElementById('propPauseWhenEmptySeconds');

  // Monde & Génération
  const propLevelName = document.getElementById('propLevelName');
  const propLevelSeed = document.getElementById('propLevelSeed');
  const propLevelType = document.getElementById('propLevelType');
  const propGeneratorSettings = document.getElementById('propGeneratorSettings');
  const propGenerateStructures = document.getElementById('propGenerateStructures');
  const propAllowNether = document.getElementById('propAllowNether');
  const propViewDistance = document.getElementById('propViewDistance');
  const propSimulationDistance = document.getElementById('propSimulationDistance');
  const propMaxWorldSize = document.getElementById('propMaxWorldSize');
  const propSyncChunkWrites = document.getElementById('propSyncChunkWrites');

  // Créatures & Entités
  const propSpawnAnimals = document.getElementById('propSpawnAnimals');
  const propSpawnMonsters = document.getElementById('propSpawnMonsters');
  const propSpawnNpcs = document.getElementById('propSpawnNpcs');
  const propEntityBroadcastRangePercentage = document.getElementById('propEntityBroadcastRangePercentage');

  // Sécurité, Whitelist & Administration
  const propOnlineMode = document.getElementById('propOnlineMode');
  const propWhiteList = document.getElementById('propWhiteList');
  const propEnforceWhitelist = document.getElementById('propEnforceWhitelist');
  const propEnforceSecureProfile = document.getElementById('propEnforceSecureProfile');
  const propLogIps = document.getElementById('propLogIps');
  const propEnableRcon = document.getElementById('propEnableRcon');
  const propRconPort = document.getElementById('propRconPort');
  const propRconPassword = document.getElementById('propRconPassword');
  const propBroadcastRconToOps = document.getElementById('propBroadcastRconToOps');
  const propBroadcastConsoleToOps = document.getElementById('propBroadcastConsoleToOps');
  const propEnableQuery = document.getElementById('propEnableQuery');
  const propQueryPort = document.getElementById('propQueryPort');

  // Packs de ressources & Données
  const propResourcePack = document.getElementById('propResourcePack');
  const propResourcePackPrompt = document.getElementById('propResourcePackPrompt');
  const propRequireResourcePack = document.getElementById('propRequireResourcePack');
  const propResourcePackSha1 = document.getElementById('propResourcePackSha1');
  const propResourcePackId = document.getElementById('propResourcePackId');
  const propInitialEnabledPacks = document.getElementById('propInitialEnabledPacks');
  const propInitialDisabledPacks = document.getElementById('propInitialDisabledPacks');
  const propBugReportLink = document.getElementById('propBugReportLink');

  // Tunnel & Réseau
  const propNetworkModeSummary = document.getElementById('propNetworkModeSummary');
  const btnSettingsReconfigureNetwork = document.getElementById('btnSettingsReconfigureNetwork');
  const propDuckSubdomain = document.getElementById('propDuckSubdomain');
  const propDuckToken = document.getElementById('propDuckToken');

  if (btnSettingsReconfigureNetwork) {
    btnSettingsReconfigureNetwork.addEventListener('click', () => {
      switchServerView('network');
    });
  }

  // Clés personnalisées
  const customPropertiesList = document.getElementById('customPropertiesList');
  const btnAddCustomProp = document.getElementById('btnAddCustomProp');

  const standardPropertyKeys = new Set([
    'motd', 'server-port', 'server-ip', 'max-players', 'enable-status', 'hide-online-players',
    'network-compression-threshold', 'max-tick-time', 'rate-limit', 'prevent-proxy-connections',
    'use-native-transport', 'accepts-transfers',
    'gamemode', 'force-gamemode', 'difficulty', 'hardcore', 'pvp', 'allow-flight',
    'spawn-protection', 'player-idle-timeout', 'pause-when-empty-seconds',
    'level-name', 'level-seed', 'level-type', 'generator-settings', 'generate-structures',
    'allow-nether', 'view-distance', 'simulation-distance', 'max-world-size', 'sync-chunk-writes',
    'spawn-animals', 'spawn-monsters', 'spawn-npcs', 'entity-broadcast-range-percentage',
    'online-mode', 'white-list', 'enforce-whitelist', 'enforce-secure-profile', 'log-ips',
    'enable-rcon', 'rcon.port', 'rcon.password', 'broadcast-rcon-to-ops', 'broadcast-console-to-ops',
    'enable-query', 'query.port',
    'resource-pack', 'resource-pack-prompt', 'require-resource-pack', 'resource-pack-sha1',
    'resource-pack-id', 'initial-enabled-packs', 'initial-disabled-packs', 'bug-report-link',
    'startup-jar', 'ram-min', 'ram-max'
  ]);

  function addCustomPropertyRow(key = '', value = '') {
    if (!customPropertiesList) return;
    const keyPl = window.i18n ? window.i18n.t('prop_custom_key_placeholder') : 'Nom de la clé';
    const valPl = window.i18n ? window.i18n.t('prop_custom_val_placeholder') : 'Valeur';
    const delTitle = window.i18n ? window.i18n.t('prop_custom_del_title') : 'Supprimer ce paramètre';
    const row = document.createElement('div');
    row.className = 'custom-prop-row';
    row.innerHTML = `
      <input type="text" class="input-text custom-prop-key" placeholder="${keyPl}" value="${escapeHtml(String(key))}">
      <input type="text" class="input-text custom-prop-val" placeholder="${valPl}" value="${escapeHtml(String(value))}">
      <button type="button" class="custom-prop-del" title="${delTitle}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    row.querySelector('.custom-prop-del').addEventListener('click', () => {
      row.remove();
      checkCustomPropEmpty();
    });
    customPropertiesList.appendChild(row);
    checkCustomPropEmpty();
  }

  function checkCustomPropEmpty() {
    if (!customPropertiesList) return;
    const existingRows = customPropertiesList.querySelectorAll('.custom-prop-row');
    let emptyMsg = customPropertiesList.querySelector('.custom-prop-empty');
    const emptyText = window.i18n ? window.i18n.t('prop_custom_empty') : 'Aucun paramètre personnalisé. Cliquez sur "+ Ajouter une clé" pour en définir un.';
    if (existingRows.length === 0) {
      if (!emptyMsg) {
        emptyMsg = document.createElement('div');
        emptyMsg.className = 'custom-prop-empty';
        emptyMsg.textContent = emptyText;
        customPropertiesList.appendChild(emptyMsg);
      } else {
        emptyMsg.textContent = emptyText;
      }
    } else if (emptyMsg) {
      emptyMsg.remove();
    }
  }

  if (btnAddCustomProp) {
    btnAddCustomProp.addEventListener('click', () => {
      addCustomPropertyRow('', '');
    });
  }

  // Chargement dynamique de la liste des JARs disponibles dans le dossier du serveur
  async function loadServerJars(serverId) {
    if (!propStartupJar) return;
    propStartupJar.innerHTML = '';
    let selectedJar = 'server.jar';

    if (window.electronAPI && window.electronAPI.getServerJars) {
      try {
        const data = await window.electronAPI.getServerJars(serverId);
        const jars = data && data.jars ? data.jars : [];
        selectedJar = (data && data.selectedJar) ? data.selectedJar : 'server.jar';

        const defaultTag = window.i18n ? window.i18n.t('default_tag') : 'Défaut';
        if (jars.length === 0) {
          const opt = document.createElement('option');
          opt.value = 'server.jar';
          opt.textContent = `server.jar (${defaultTag})`;
          propStartupJar.appendChild(opt);
        } else {
          jars.forEach(jar => {
            const opt = document.createElement('option');
            opt.value = jar;
            opt.textContent = jar + (jar === 'server.jar' ? ` (${defaultTag})` : '');
            if (jar === selectedJar) {
              opt.selected = true;
            }
            propStartupJar.appendChild(opt);
          });
        }
      } catch (err) {
        console.error('Erreur chargement des fichiers JAR:', err);
      }
    }

    if (selectedJar) {
      propStartupJar.value = selectedJar;
    }
  }

  if (btnRefreshJars) {
    btnRefreshJars.addEventListener('click', async () => {
      if (!currentActiveServer) return;
      btnRefreshJars.disabled = true;
      try {
        await loadServerJars(currentActiveServer.id);
      } finally {
        btnRefreshJars.disabled = false;
      }
    });
  }

  if (btnBrowseJar) {
    btnBrowseJar.addEventListener('click', async () => {
      if (!currentActiveServer) return;
      if (window.electronAPI && window.electronAPI.selectExternalJar) {
        btnBrowseJar.disabled = true;
        try {
          const res = await window.electronAPI.selectExternalJar(currentActiveServer.id);
          if (res && res.success && res.jarName) {
            await loadServerJars(currentActiveServer.id);
            propStartupJar.value = res.jarName;
          }
        } finally {
          btnBrowseJar.disabled = false;
        }
      }
    });
  }

  // Filtrage combiné : Catégorie choisie + recherche en temps réel
  function applyPropertiesFilter() {
    const q = propSearchInput ? propSearchInput.value.trim().toLowerCase() : '';
    const selectedCategory = (propCategoryFilter && propCategoryFilter.value) ? propCategoryFilter.value : 'server';
    const groups = document.querySelectorAll('#server-view-properties .settings-group');

    groups.forEach(group => {
      const groupCategory = group.getAttribute('data-group');
      const categoryMatches = (selectedCategory === groupCategory);

      if (!categoryMatches) {
        group.classList.add('hidden-by-filter');
        return;
      }

      group.classList.remove('hidden-by-filter');

      const rows = group.querySelectorAll('.setting-row');
      let visibleCount = 0;

      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const inputs = row.querySelectorAll('input, select');
        let idMatch = false;
        inputs.forEach(inp => {
          if (inp.id && inp.id.toLowerCase().includes(q)) idMatch = true;
        });

        if (!q || text.includes(q) || idMatch) {
          row.classList.remove('hidden-by-search');
          visibleCount++;
        } else {
          row.classList.add('hidden-by-search');
        }
      });

      if (rows.length > 0) {
        if (visibleCount === 0) {
          group.classList.add('hidden-by-search');
        } else {
          group.classList.remove('hidden-by-search');
        }
      } else {
        group.classList.remove('hidden-by-search');
      }
    });
  }

  if (propSearchInput) {
    propSearchInput.addEventListener('input', applyPropertiesFilter);
  }

  if (propCategoryFilter) {
    propCategoryFilter.addEventListener('change', () => {
      applyPropertiesFilter();
      const content = document.querySelector('#server-view-properties .settings-content');
      if (content) content.scrollTop = 0;
    });
  }

  async function refreshPropertiesView() {
    if (!currentActiveServer) return;
    if (propCategoryFilter && (!propCategoryFilter.value || propCategoryFilter.value === 'all')) {
      propCategoryFilter.value = 'server';
    }
    if (window.electronAPI && window.electronAPI.getServerProperties) {
      const props = await window.electronAPI.getServerProperties(currentActiveServer.id);

      // Serveur & Démarrage
      await loadServerJars(currentActiveServer.id);
      const minParsed = parseRamString(props['ram-min'] || currentActiveServer.ramMin || '1G', 1, 'GB');
      if (propRamMinValue) propRamMinValue.value = minParsed.value;
      if (propRamMinUnit) propRamMinUnit.value = minParsed.unit;

      const maxParsed = parseRamString(props['ram-max'] || currentActiveServer.ramMax || '2G', 2, 'GB');
      if (propRamMaxValue) propRamMaxValue.value = maxParsed.value;
      if (propRamMaxUnit) propRamMaxUnit.value = maxParsed.unit;

      // Général & Réseau
      propMotd.value = props['motd'] !== undefined ? props['motd'] : (currentActiveServer.description || currentActiveServer.name || 'Minecraft Server');
      propPort.value = props['server-port'] !== undefined ? props['server-port'] : (currentActiveServer.port || 25565);
      propServerIp.value = props['server-ip'] || '';
      propMaxPlayers.value = props['max-players'] !== undefined ? props['max-players'] : (currentActiveServer.maxPlayers || 20);
      propEnableStatus.checked = props['enable-status'] !== 'false';
      propHideOnlinePlayers.checked = props['hide-online-players'] === 'true';
      propNetworkCompressionThreshold.value = props['network-compression-threshold'] !== undefined ? props['network-compression-threshold'] : 256;
      propMaxTickTime.value = props['max-tick-time'] !== undefined ? props['max-tick-time'] : 60000;
      propRateLimit.value = props['rate-limit'] !== undefined ? props['rate-limit'] : 0;
      propPreventProxyConnections.checked = props['prevent-proxy-connections'] === 'true';
      propUseNativeTransport.checked = props['use-native-transport'] !== 'false';
      propAcceptsTransfers.checked = props['accepts-transfers'] === 'true';

      // Gameplay & Règles
      propGamemode.value = props['gamemode'] || 'survival';
      propForceGamemode.checked = props['force-gamemode'] === 'true';
      propDifficulty.value = props['difficulty'] || 'easy';
      propHardcore.checked = props['hardcore'] === 'true';
      propPvp.checked = props['pvp'] !== 'false';
      propAllowFlight.checked = props['allow-flight'] === 'true';
      propSpawnProtection.value = props['spawn-protection'] !== undefined ? props['spawn-protection'] : 16;
      propPlayerIdleTimeout.value = props['player-idle-timeout'] !== undefined ? props['player-idle-timeout'] : 0;
      propPauseWhenEmptySeconds.value = props['pause-when-empty-seconds'] !== undefined ? props['pause-when-empty-seconds'] : 60;

      // Monde & Génération
      propLevelName.value = props['level-name'] || 'world';
      propLevelSeed.value = props['level-seed'] || '';
      propLevelType.value = props['level-type'] || 'minecraft:normal';
      propGeneratorSettings.value = props['generator-settings'] || '';
      propGenerateStructures.checked = props['generate-structures'] !== 'false';
      propAllowNether.checked = props['allow-nether'] !== 'false';
      propViewDistance.value = props['view-distance'] !== undefined ? props['view-distance'] : 10;
      propSimulationDistance.value = props['simulation-distance'] !== undefined ? props['simulation-distance'] : 10;
      propMaxWorldSize.value = props['max-world-size'] !== undefined ? props['max-world-size'] : 29999984;
      propSyncChunkWrites.checked = props['sync-chunk-writes'] !== 'false';

      // Créatures & Entités
      propSpawnAnimals.checked = props['spawn-animals'] !== 'false';
      propSpawnMonsters.checked = props['spawn-monsters'] !== 'false';
      propSpawnNpcs.checked = props['spawn-npcs'] !== 'false';
      propEntityBroadcastRangePercentage.value = props['entity-broadcast-range-percentage'] !== undefined ? props['entity-broadcast-range-percentage'] : 100;

      // Sécurité, Whitelist & Administration
      propOnlineMode.checked = props['online-mode'] !== 'false';
      propWhiteList.checked = props['white-list'] === 'true';
      propEnforceWhitelist.checked = props['enforce-whitelist'] === 'true';
      propEnforceSecureProfile.checked = props['enforce-secure-profile'] !== 'false';
      propLogIps.checked = props['log-ips'] !== 'false';
      propEnableRcon.checked = props['enable-rcon'] === 'true';
      propRconPort.value = props['rcon.port'] !== undefined ? props['rcon.port'] : 25575;
      propRconPassword.value = props['rcon.password'] || '';
      propBroadcastRconToOps.checked = props['broadcast-rcon-to-ops'] !== 'false';
      propBroadcastConsoleToOps.checked = props['broadcast-console-to-ops'] !== 'false';
      propEnableQuery.checked = props['enable-query'] === 'true';
      propQueryPort.value = props['query.port'] !== undefined ? props['query.port'] : 25565;

      // Packs de ressources & Données
      propResourcePack.value = props['resource-pack'] || '';
      propResourcePackPrompt.value = props['resource-pack-prompt'] || '';
      propRequireResourcePack.checked = props['require-resource-pack'] === 'true';
      propResourcePackSha1.value = props['resource-pack-sha1'] || '';
      propResourcePackId.value = props['resource-pack-id'] || '';
      propInitialEnabledPacks.value = props['initial-enabled-packs'] || '';
      propInitialDisabledPacks.value = props['initial-disabled-packs'] || '';
      propBugReportLink.value = props['bug-report-link'] || '';

      // Tunnel & Réseau
      if (propNetworkModeSummary && currentActiveServer) {
        const mode = currentActiveServer.networkMode || 'upnp';
        if (mode === 'upnp') {
          const sub = currentActiveServer.duckdnsDomain ? ` (${currentActiveServer.duckdnsDomain})` : '';
          const upnpText = window.i18n ? window.i18n.t('badge_upnp_text') : 'UPnP Direct • 5-15 ms';
          propNetworkModeSummary.textContent = `${upnpText}${sub}`;
        } else if (mode === 'pinggy') {
          propNetworkModeSummary.textContent = window.i18n ? window.i18n.t('badge_pinggy_text') : 'Pinggy • 20 ms';
        } else {
          propNetworkModeSummary.textContent = window.i18n ? window.i18n.t('badge_upnp_text') : 'UPnP Direct • 5-15 ms';
        }
      }
      if (propDuckSubdomain && currentActiveServer) {
        propDuckSubdomain.value = currentActiveServer.duckdnsDomain ? currentActiveServer.duckdnsDomain.replace(/\.duckdns\.org$/i, '') : '';
      }
      if (propDuckToken && currentActiveServer) {
        propDuckToken.value = currentActiveServer.duckdnsToken || '';
      }

      // Clés personnalisées
      customPropertiesList.innerHTML = '';
      for (const [k, v] of Object.entries(props)) {
        if (!standardPropertyKeys.has(k)) {
          addCustomPropertyRow(k, v);
        }
      }
      checkCustomPropEmpty();
      applyPropertiesFilter();
    }
  }

  btnSaveProperties.addEventListener('click', async () => {
    if (!currentActiveServer) return;
    const properties = {
      // Serveur & Démarrage
      'startup-jar': propStartupJar ? propStartupJar.value : 'server.jar',
      'ram-min': formatRamString(propRamMinValue ? propRamMinValue.value : 1, propRamMinUnit ? propRamMinUnit.value : 'GB'),
      'ram-max': formatRamString(propRamMaxValue ? propRamMaxValue.value : 2, propRamMaxUnit ? propRamMaxUnit.value : 'GB'),

      // Général & Réseau
      'motd': propMotd.value.trim(),
      'server-port': propPort.value.trim(),
      'server-ip': propServerIp.value.trim(),
      'max-players': propMaxPlayers.value.trim(),
      'enable-status': propEnableStatus.checked ? 'true' : 'false',
      'hide-online-players': propHideOnlinePlayers.checked ? 'true' : 'false',
      'network-compression-threshold': propNetworkCompressionThreshold.value.trim(),
      'max-tick-time': propMaxTickTime.value.trim(),
      'rate-limit': propRateLimit.value.trim(),
      'prevent-proxy-connections': propPreventProxyConnections.checked ? 'true' : 'false',
      'use-native-transport': propUseNativeTransport.checked ? 'true' : 'false',
      'accepts-transfers': propAcceptsTransfers.checked ? 'true' : 'false',

      // Gameplay & Règles
      'gamemode': propGamemode.value,
      'force-gamemode': propForceGamemode.checked ? 'true' : 'false',
      'difficulty': propDifficulty.value,
      'hardcore': propHardcore.checked ? 'true' : 'false',
      'pvp': propPvp.checked ? 'true' : 'false',
      'allow-flight': propAllowFlight.checked ? 'true' : 'false',
      'spawn-protection': propSpawnProtection.value.trim(),
      'player-idle-timeout': propPlayerIdleTimeout.value.trim(),
      'pause-when-empty-seconds': propPauseWhenEmptySeconds.value.trim(),

      // Monde & Génération
      'level-name': propLevelName.value.trim(),
      'level-seed': propLevelSeed.value.trim(),
      'level-type': propLevelType.value,
      'generator-settings': propGeneratorSettings.value.trim(),
      'generate-structures': propGenerateStructures.checked ? 'true' : 'false',
      'allow-nether': propAllowNether.checked ? 'true' : 'false',
      'view-distance': propViewDistance.value.trim(),
      'simulation-distance': propSimulationDistance.value.trim(),
      'max-world-size': propMaxWorldSize.value.trim(),
      'sync-chunk-writes': propSyncChunkWrites.checked ? 'true' : 'false',

      // Créatures & Entités
      'spawn-animals': propSpawnAnimals.checked ? 'true' : 'false',
      'spawn-monsters': propSpawnMonsters.checked ? 'true' : 'false',
      'spawn-npcs': propSpawnNpcs.checked ? 'true' : 'false',
      'entity-broadcast-range-percentage': propEntityBroadcastRangePercentage.value.trim(),

      // Sécurité, Whitelist & Administration
      'online-mode': propOnlineMode.checked ? 'true' : 'false',
      'white-list': propWhiteList.checked ? 'true' : 'false',
      'enforce-whitelist': propEnforceWhitelist.checked ? 'true' : 'false',
      'enforce-secure-profile': propEnforceSecureProfile.checked ? 'true' : 'false',
      'log-ips': propLogIps.checked ? 'true' : 'false',
      'enable-rcon': propEnableRcon.checked ? 'true' : 'false',
      'rcon.port': propRconPort.value.trim(),
      'rcon.password': propRconPassword.value,
      'broadcast-rcon-to-ops': propBroadcastRconToOps.checked ? 'true' : 'false',
      'broadcast-console-to-ops': propBroadcastConsoleToOps.checked ? 'true' : 'false',
      'enable-query': propEnableQuery.checked ? 'true' : 'false',
      'query.port': propQueryPort.value.trim(),

      // Packs de ressources & Données
      'resource-pack': propResourcePack.value.trim(),
      'resource-pack-prompt': propResourcePackPrompt.value.trim(),
      'require-resource-pack': propRequireResourcePack.checked ? 'true' : 'false',
      'resource-pack-sha1': propResourcePackSha1.value.trim(),
      'resource-pack-id': propResourcePackId.value.trim(),
      'initial-enabled-packs': propInitialEnabledPacks.value.trim(),
      'initial-disabled-packs': propInitialDisabledPacks.value.trim(),
      'bug-report-link': propBugReportLink.value.trim()
    };

    // Collecter les clés personnalisées
    const customRows = customPropertiesList ? customPropertiesList.querySelectorAll('.custom-prop-row') : [];
    customRows.forEach(row => {
      const keyInput = row.querySelector('.custom-prop-key');
      const valInput = row.querySelector('.custom-prop-val');
      if (keyInput && valInput) {
        const k = keyInput.value.trim();
        if (k) {
          properties[k] = valInput.value.trim();
        }
      }
    });

    if (window.electronAPI && window.electronAPI.saveServerProperties) {
      await window.electronAPI.saveServerProperties(currentActiveServer.id, properties);
      currentActiveServer.port = parseInt(properties['server-port'], 10) || currentActiveServer.port;
      currentActiveServer.maxPlayers = parseInt(properties['max-players'], 10) || currentActiveServer.maxPlayers;
      currentActiveServer.description = properties['motd'];
      currentActiveServer.startupJar = properties['startup-jar'];
      currentActiveServer.ramMin = properties['ram-min'];
      currentActiveServer.ramMax = properties['ram-max'];

      if (propDuckSubdomain && propDuckToken) {
        const sub = propDuckSubdomain.value.trim().toLowerCase().replace(/\.duckdns\.org$/i, '');
        const token = propDuckToken.value.trim();
        const fullDomain = sub ? `${sub}.duckdns.org` : '';
        currentActiveServer.duckdnsDomain = fullDomain;
        currentActiveServer.duckdnsToken = token;
        if (window.electronAPI && window.electronAPI.saveServerNetworkConfig) {
          await window.electronAPI.saveServerNetworkConfig(currentActiveServer.id, {
            duckdnsDomain: fullDomain,
            duckdnsToken: token
          });
        }
      }

      const srvIndex = servers.findIndex(s => s.id === currentActiveServer.id);
      if (srvIndex !== -1) {
        servers[srvIndex].port = currentActiveServer.port;
        servers[srvIndex].maxPlayers = currentActiveServer.maxPlayers;
        servers[srvIndex].description = currentActiveServer.description;
        servers[srvIndex].startupJar = currentActiveServer.startupJar;
        servers[srvIndex].ramMin = currentActiveServer.ramMin;
        servers[srvIndex].ramMax = currentActiveServer.ramMax;
        servers[srvIndex].duckdnsDomain = currentActiveServer.duckdnsDomain;
        servers[srvIndex].duckdnsToken = currentActiveServer.duckdnsToken;
      }
      saveCache();

      btnSaveProperties.textContent = window.i18n ? window.i18n.t('msg_saved') : 'Modifications enregistrées !';
      setTimeout(() => {
        btnSaveProperties.textContent = window.i18n ? window.i18n.t('btn_save_prop') : 'Enregistrer les modifications';
      }, 1500);
    }
  });

  // ============================================================================
  // 8 bis. Vue Performances & Métriques Système
  // ============================================================================
  const perfServerMeta = document.getElementById('perfServerMeta');
  const perfServerStatusBadge = document.getElementById('perfServerStatusBadge');
  const perfServerStatusText = document.getElementById('perfServerStatusText');
  const perfUptimeBox = document.getElementById('perfUptimeBox');
  const perfUptimeVal = document.getElementById('perfUptimeVal');
  const perfStoppedNotice = document.getElementById('perfStoppedNotice');

  // RAM
  const perfRamServerVal = document.getElementById('perfRamServerVal');
  const perfRamServerSub = document.getElementById('perfRamServerSub');
  const perfRamMaxVal = document.getElementById('perfRamMaxVal');
  const perfRamSystemVal = document.getElementById('perfRamSystemVal');
  const perfRamSystemSub = document.getElementById('perfRamSystemSub');
  const perfRamChart = document.getElementById('perfRamChart');

  // CPU
  const perfCpuModelHeader = document.getElementById('perfCpuModelHeader');
  const perfCpuServerVal = document.getElementById('perfCpuServerVal');
  const perfCpuSystemVal = document.getElementById('perfCpuSystemVal');
  const perfCpuChart = document.getElementById('perfCpuChart');

  // Stockage
  const btnRefreshStorage = document.getElementById('btnRefreshStorage');
  const perfStorageTotalVal = document.getElementById('perfStorageTotalVal');
  const perfStorageCalculatedAt = document.getElementById('perfStorageCalculatedAt');
  const perfStorageWorldVal = document.getElementById('perfStorageWorldVal');
  const perfStorageWorldBar = document.getElementById('perfStorageWorldBar');
  const perfStoragePluginsVal = document.getElementById('perfStoragePluginsVal');
  const perfStoragePluginsBar = document.getElementById('perfStoragePluginsBar');
  const perfStorageModsVal = document.getElementById('perfStorageModsVal');
  const perfStorageModsBar = document.getElementById('perfStorageModsBar');
  const perfStorageJarsVal = document.getElementById('perfStorageJarsVal');
  const perfStorageJarsBar = document.getElementById('perfStorageJarsBar');
  const perfStorageLogsVal = document.getElementById('perfStorageLogsVal');
  const perfStorageLogsBar = document.getElementById('perfStorageLogsBar');
  const perfStorageOtherVal = document.getElementById('perfStorageOtherVal');
  const perfStorageOtherBar = document.getElementById('perfStorageOtherBar');

  const MAX_HISTORY_POINTS = 30;
  let ramHistory = [];
  let cpuHistory = [];
  let perfPollingInterval = null;
  const serverStorageCache = new Map();

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function formatUptimeString(seconds) {
    if (!seconds || seconds <= 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }

  function drawSmoothChart(canvas, historyData, maxScaleValue, unitSuffix = '', colorHex = '#2563eb') {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.width || 300;
    const height = rect.height || canvas.height || 120;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pLeft = 10;
    const pRight = 10;
    const pTop = 15;
    const pBottom = 15;
    const drawW = width - pLeft - pRight;
    const drawH = height - pTop - pBottom;

    let maxVal = maxScaleValue || 100;
    if (historyData.length > 0) {
      const peak = Math.max(...historyData);
      if (peak > maxVal * 0.9) {
        maxVal = Math.max(peak * 1.15, maxVal);
      }
    }
    if (maxVal <= 0) maxVal = 100;

    // Lignes horizontales de repère
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    [0.25, 0.5, 0.75].forEach(ratio => {
      const y = pTop + drawH * (1 - ratio);
      ctx.beginPath();
      ctx.moveTo(pLeft, y);
      ctx.lineTo(pLeft + drawW, y);
      ctx.stroke();
    });

    ctx.setLineDash([]);

    if (!historyData || historyData.length === 0) {
      ctx.restore();
      return;
    }

    const stepX = drawW / Math.max(MAX_HISTORY_POINTS - 1, 1);
    const startIndex = MAX_HISTORY_POINTS - historyData.length;
    const points = historyData.map((val, idx) => {
      const x = pLeft + (startIndex + idx) * stepX;
      const normalized = Math.max(0, Math.min(val / maxVal, 1));
      const y = pTop + drawH * (1 - normalized);
      return { x, y, val };
    });

    if (points.length === 1) {
      points.unshift({ x: pLeft, y: points[0].y, val: points[0].val });
    }

    // Dégradé de remplissage sous la courbe
    const gradient = ctx.createLinearGradient(0, pTop, 0, pTop + drawH);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.28)');
    gradient.addColorStop(0.7, 'rgba(37, 99, 235, 0.08)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, pTop + drawH);
    ctx.lineTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, (p0.y + p1.y) / 2);
    }
    const lastP = points[points.length - 1];
    ctx.lineTo(lastP.x, lastP.y);
    ctx.lineTo(lastP.x, pTop + drawH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Tracé de la ligne principale
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, (p0.y + p1.y) / 2);
    }
    ctx.lineTo(lastP.x, lastP.y);
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Point lumineux sur la dernière valeur
    ctx.beginPath();
    ctx.arc(lastP.x, lastP.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorHex;
    ctx.stroke();

    ctx.restore();
  }

  async function pollPerformanceData() {
    if (!currentActiveServer || !window.electronAPI || !window.electronAPI.getServerPerformance) return;

    try {
      const perf = await window.electronAPI.getServerPerformance(currentActiveServer.id);
      if (!perf) return;

      const isRunning = perf.isRunning;

      // 1. Badge d'état & Uptime
      if (perfServerStatusBadge && perfServerStatusText) {
        perfServerStatusBadge.classList.toggle('running', isRunning);
        perfServerStatusText.textContent = window.i18n ? window.i18n.t(isRunning ? 'perf_status_running' : 'perf_status_stopped') : (isRunning ? 'Serveur actif' : 'Serveur arrêté');
      }

      if (perfStoppedNotice) {
        perfStoppedNotice.style.display = isRunning ? 'none' : 'flex';
      }

      if (perfUptimeBox && perfUptimeVal) {
        if (isRunning && perf.uptime > 0) {
          perfUptimeBox.style.display = 'inline-flex';
          perfUptimeVal.textContent = formatUptimeString(perf.uptime);
        } else {
          perfUptimeBox.style.display = 'none';
        }
      }

      // 2. Métriques RAM
      const serverMemBytes = isRunning ? (perf.serverMemory || 0) : 0;
      const serverMemMB = Math.round(serverMemBytes / (1024 * 1024));

      const parsedRamMax = parseRamString(currentActiveServer.ramMax || '2GB');
      const maxAllocatedMB = parsedRamMax.unit === 'MB' ? parsedRamMax.value : (parsedRamMax.value * 1024);

      if (perfRamServerVal) {
        perfRamServerVal.textContent = isRunning ? formatBytes(serverMemBytes) : '0 MB';
      }

      if (perfRamServerSub) {
        if (isRunning && maxAllocatedMB > 0) {
          const pctOfMax = Math.round((serverMemMB / maxAllocatedMB) * 100);
          perfRamServerSub.textContent = `${pctOfMax}% de l'allocation max`;
        } else {
          perfRamServerSub.textContent = '-';
        }
      }

      if (perfRamMaxVal) {
        perfRamMaxVal.textContent = currentActiveServer.ramMax || '2 GB';
      }

      if (perfRamSystemVal && perf.systemMemoryTotal > 0) {
        const usedSystemGB = (perf.systemMemoryUsed / (1024 * 1024 * 1024)).toFixed(1);
        const totalSystemGB = (perf.systemMemoryTotal / (1024 * 1024 * 1024)).toFixed(1);
        perfRamSystemVal.textContent = `${usedSystemGB} / ${totalSystemGB} GB`;
      }

      if (perfRamSystemSub && perf.systemMemoryTotal > 0) {
        const sysPct = Math.round((perf.systemMemoryUsed / perf.systemMemoryTotal) * 100);
        perfRamSystemSub.textContent = `${sysPct}% utilisé par l'ordinateur`;
      }

      // Graphique RAM
      ramHistory.push(serverMemMB);
      if (ramHistory.length > MAX_HISTORY_POINTS) ramHistory.shift();
      drawSmoothChart(perfRamChart, ramHistory, maxAllocatedMB, ' MB', '#2563eb');

      // 3. Métriques CPU
      const srvCpu = isRunning ? (perf.serverCpu || 0) : 0;
      const sysCpu = perf.systemCpu || 0;

      if (perfCpuServerVal) {
        perfCpuServerVal.textContent = `${srvCpu}%`;
      }

      if (perfCpuSystemVal) {
        perfCpuSystemVal.textContent = `${sysCpu}%`;
      }

      if (perfCpuModelHeader && perf.cpuModel) {
        perfCpuModelHeader.textContent = perf.cpuModel;
      }

      // Graphique CPU
      cpuHistory.push(srvCpu);
      if (cpuHistory.length > MAX_HISTORY_POINTS) cpuHistory.shift();
      drawSmoothChart(perfCpuChart, cpuHistory, 100, '%', '#3b82f6');
    } catch (err) {
      console.error('Erreur pollPerformanceData:', err);
    }
  }

  function startPerformancePolling() {
    stopPerformancePolling();
    pollPerformanceData();
    perfPollingInterval = setInterval(pollPerformanceData, 1500);
  }

  function stopPerformancePolling() {
    if (perfPollingInterval) {
      clearInterval(perfPollingInterval);
      perfPollingInterval = null;
    }
  }

  async function refreshServerStorage(serverId, force = false) {
    if (!serverId || !window.electronAPI || !window.electronAPI.getServerStorage) return;

    if (!force && serverStorageCache.has(serverId)) {
      applyStorageData(serverStorageCache.get(serverId));
      return;
    }

    if (btnRefreshStorage) btnRefreshStorage.disabled = true;
    if (perfStorageTotalVal && (!serverStorageCache.has(serverId) || force)) {
      perfStorageTotalVal.textContent = window.i18n ? window.i18n.t('perf_storage_calculating') : 'Calcul de la taille du dossier...';
    }

    try {
      const data = await window.electronAPI.getServerStorage(serverId);
      if (data) {
        const payload = {
          data,
          time: new Date().toLocaleTimeString()
        };
        serverStorageCache.set(serverId, payload);
        applyStorageData(payload);
      }
    } catch (err) {
      console.error('Erreur refreshServerStorage:', err);
    } finally {
      if (btnRefreshStorage) btnRefreshStorage.disabled = false;
    }
  }

  function applyStorageData(payload) {
    if (!payload || !payload.data) return;
    const { totalSize, breakdown } = payload.data;

    if (perfStorageTotalVal) {
      perfStorageTotalVal.textContent = formatBytes(totalSize);
    }

    if (perfStorageCalculatedAt) {
      perfStorageCalculatedAt.textContent = `Calculé à ${payload.time}`;
    }

    const maxCat = Math.max(totalSize, 1);

    if (perfStorageWorldVal) perfStorageWorldVal.textContent = formatBytes(breakdown.world);
    if (perfStorageWorldBar) perfStorageWorldBar.style.width = `${Math.round((breakdown.world / maxCat) * 100)}%`;

    if (perfStoragePluginsVal) perfStoragePluginsVal.textContent = formatBytes(breakdown.plugins);
    if (perfStoragePluginsBar) perfStoragePluginsBar.style.width = `${Math.round((breakdown.plugins / maxCat) * 100)}%`;

    if (perfStorageModsVal) perfStorageModsVal.textContent = formatBytes(breakdown.mods);
    if (perfStorageModsBar) perfStorageModsBar.style.width = `${Math.round((breakdown.mods / maxCat) * 100)}%`;

    if (perfStorageJarsVal) perfStorageJarsVal.textContent = formatBytes(breakdown.jars);
    if (perfStorageJarsBar) perfStorageJarsBar.style.width = `${Math.round((breakdown.jars / maxCat) * 100)}%`;

    if (perfStorageLogsVal) perfStorageLogsVal.textContent = formatBytes(breakdown.logs);
    if (perfStorageLogsBar) perfStorageLogsBar.style.width = `${Math.round((breakdown.logs / maxCat) * 100)}%`;

    if (perfStorageOtherVal) perfStorageOtherVal.textContent = formatBytes(breakdown.other);
    if (perfStorageOtherBar) perfStorageOtherBar.style.width = `${Math.round((breakdown.other / maxCat) * 100)}%`;
  }

  if (btnRefreshStorage) {
    btnRefreshStorage.addEventListener('click', () => {
      if (currentActiveServer) {
        refreshServerStorage(currentActiveServer.id, true);
      }
    });
  }

  function refreshPerformanceView() {
    if (!currentActiveServer) return;
    if (perfServerMeta) {
      perfServerMeta.textContent = `${currentActiveServer.name} • ${currentActiveServer.type || 'Vanilla'} ${currentActiveServer.version} • Port ${currentActiveServer.port || 25565}`;
    }
    startPerformancePolling();
    refreshServerStorage(currentActiveServer.id);
  }

  // 9. Formulaire de Création dans la page à droite
  const btnBackToServers = document.getElementById('btnBackToServers');
  const btnCancelCreation = document.getElementById('btnCancelCreation');
  const btnStep1Next = document.getElementById('btnStep1Next');
  const btnStep2Back = document.getElementById('btnStep2Back');
  const btnValidateServer = document.getElementById('btnValidateServer');

  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const createStepSubtitle = document.getElementById('create-step-subtitle');

  const inputServerName = document.getElementById('inputServerName');
  const inputServerDesc = document.getElementById('inputServerDesc');
  const descCharCount = document.getElementById('descCharCount');
  const engineCatBtns = document.querySelectorAll('.engine-cat-btn');
  const engineGroups = document.querySelectorAll('.engine-group');
  const typeOptions = document.querySelectorAll('.type-option');
  const engineDetailHint = document.getElementById('engineDetailHint');
  const selectMcVersion = document.getElementById('selectMcVersion');
  const inputMaxPlayers = document.getElementById('inputMaxPlayers');
  const creationProgress = document.getElementById('creationProgress');
  const creationProgressText = document.getElementById('creationProgressText');

  let selectedType = 'Paper';
  const engineVersionsCache = new Map();

  async function loadEngineVersions(engineType) {
    if (!window.electronAPI || !selectMcVersion) return;

    if (engineVersionsCache.has(engineType)) {
      renderVersions(engineVersionsCache.get(engineType));
      return;
    }

    selectMcVersion.innerHTML = `<option value="" disabled selected>${window.i18n ? window.i18n.t('loading_versions') : 'Chargement des versions compatibles...'}</option>`;
    selectMcVersion.disabled = true;

    try {
      let data = null;
      if (window.electronAPI.getEngineVersions) {
        data = await window.electronAPI.getEngineVersions(engineType);
      } else if (window.electronAPI.getMinecraftVersions) {
        data = await window.electronAPI.getMinecraftVersions();
      }

      if (data && data.releases && data.releases.length > 0) {
        engineVersionsCache.set(engineType, data);
        renderVersions(data);
      }
    } catch (err) {
      console.error(`Erreur chargement versions pour ${engineType}:`, err);
    } finally {
      selectMcVersion.disabled = false;
    }
  }

  function renderVersions(data) {
    selectMcVersion.innerHTML = '';
    const latestTag = window.i18n ? window.i18n.t('latest_version') : 'Plus récente';
    data.releases.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v === data.latestRelease ? `${v} (${latestTag})` : v;
      selectMcVersion.appendChild(opt);
    });
    selectMcVersion.value = data.latestRelease || data.releases[0];
  }

  // Écouteur de progression de téléchargement du JAR
  if (window.electronAPI && window.electronAPI.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((data) => {
      if (creationProgressText) {
        creationProgressText.textContent = data.message || `${window.i18n ? window.i18n.t('downloading_percent') : 'Téléchargement :'} ${data.percent}%`;
      }
    });
  }

  function updateEngineHintText() {
    if (!engineDetailHint || !selectedType) return;
    const hintKey = 'hint_' + selectedType.toLowerCase();
    const trans = window.i18n ? window.i18n.t(hintKey) : '';
    if (trans && trans !== hintKey) {
      engineDetailHint.textContent = trans;
    } else {
      const activeBtn = document.querySelector(`.type-option[data-type="${selectedType}"]`);
      engineDetailHint.textContent = activeBtn?.getAttribute('data-hint') || '';
    }
  }

  function showCreationStep(step) {
    if (step === 1) {
      step1.classList.add('active');
      step2.classList.remove('active');
      createStepSubtitle.textContent = window.i18n ? window.i18n.t('create_subtitle') : 'Étape 1 sur 2 : Informations générales';
      setTimeout(() => inputServerName.focus(), 50);
    } else {
      step1.classList.remove('active');
      step2.classList.add('active');
      createStepSubtitle.textContent = window.i18n ? window.i18n.t('step2_title') : 'Étape 2 : Moteur & Version';
    }
  }

  async function openCreationPage() {
    inputServerName.value = '';
    inputServerDesc.value = '';
    inputServerName.style.borderColor = '';
    if (descCharCount) descCharCount.textContent = '0 / 120';
    
    // Réinitialiser vers Paper par défaut dans "Officiel & Plugins"
    selectedType = 'Paper';
    engineCatBtns.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-category') === 'plugins'));
    engineGroups.forEach(grp => grp.classList.toggle('active', grp.getAttribute('data-category') === 'plugins'));
    typeOptions.forEach(opt => opt.classList.toggle('active', opt.getAttribute('data-type') === 'Paper'));
    updateEngineHintText();

    inputMaxPlayers.value = '20';
    if (creationProgress) creationProgress.style.display = 'none';

    showCreationStep(1);
    switchMainView('create');

    // Charger dynamiquement les versions compatibles pour Paper
    await loadEngineVersions('Paper');
  }

  if (btnCreateServer) btnCreateServer.addEventListener('click', openCreationPage);
  if (btnHeaderNewServer) btnHeaderNewServer.addEventListener('click', openCreationPage);

  if (window.electronAPI && window.electronAPI.onNavToTab) {
    window.electronAPI.onNavToTab((tab) => {
      if (tab === 'create') {
        openCreationPage();
      }
    });
  }

  if (btnBackToServers) btnBackToServers.addEventListener('click', () => switchMainView('servers'));
  if (btnCancelCreation) btnCancelCreation.addEventListener('click', () => switchMainView('servers'));

  if (inputServerDesc && descCharCount) {
    inputServerDesc.addEventListener('input', () => {
      descCharCount.textContent = `${inputServerDesc.value.length} / 120`;
    });
  }

  // Clic sur les onglets de catégories de moteurs
  engineCatBtns.forEach((catBtn) => {
    catBtn.addEventListener('click', () => {
      const cat = catBtn.getAttribute('data-category');
      engineCatBtns.forEach(b => b.classList.remove('active'));
      catBtn.classList.add('active');

      engineGroups.forEach(g => {
        const match = g.getAttribute('data-category') === cat;
        g.classList.toggle('active', match);
        if (match) {
          const firstTypeBtn = g.querySelector('.type-option');
          if (firstTypeBtn) {
            typeOptions.forEach(o => o.classList.remove('active'));
            firstTypeBtn.classList.add('active');
            selectedType = firstTypeBtn.getAttribute('data-type');
            updateEngineHintText();
            loadEngineVersions(selectedType);
          }
        }
      });
    });
  });

  // Clic sur un moteur individuel
  typeOptions.forEach((btn) => {
    btn.addEventListener('click', () => {
      typeOptions.forEach((opt) => opt.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.getAttribute('data-type');
      updateEngineHintText();
      loadEngineVersions(selectedType);
    });
  });

  if (btnStep1Next) {
    btnStep1Next.addEventListener('click', () => {
      const name = inputServerName.value.trim();
      if (!name) {
        inputServerName.style.borderColor = '#ef4444';
        inputServerName.focus();
        return;
      }
      inputServerName.style.borderColor = '';
      showCreationStep(2);
    });
  }

  if (btnStep2Back) {
    btnStep2Back.addEventListener('click', () => {
      showCreationStep(1);
    });
  }

  if (btnValidateServer) {
    btnValidateServer.addEventListener('click', async () => {
      const name = inputServerName.value.trim() || (window.i18n ? window.i18n.t('default_server_name') : 'Serveur Minecraft');
      const description = inputServerDesc.value.trim();
      const version = selectMcVersion.value || '1.21.4';
      const maxPlayers = parseInt(inputMaxPlayers.value, 10) || 20;

      const usedPorts = new Set((servers || []).map(s => parseInt(s.port, 10)).filter(p => !isNaN(p) && p > 0));
      let port = 25565;
      while (usedPorts.has(port)) {
        port++;
      }

      const inputRamMinVal = document.getElementById('inputCreateRamMinVal');
      const selectRamMinUnit = document.getElementById('inputCreateRamMinUnit');
      const inputRamMaxVal = document.getElementById('inputCreateRamMaxVal');
      const selectRamMaxUnit = document.getElementById('inputCreateRamMaxUnit');

      const ramMin = formatRamString(inputRamMinVal ? inputRamMinVal.value : 1, selectRamMinUnit ? selectRamMinUnit.value : 'GB');
      const ramMax = formatRamString(inputRamMaxVal ? inputRamMaxVal.value : 2, selectRamMaxUnit ? selectRamMaxUnit.value : 'GB');

      const newServerData = {
        name,
        description,
        game: 'Minecraft',
        type: selectedType,
        version,
        maxPlayers,
        port,
        ramMin,
        ramMax,
        networkMode: 'upnp'
      };

      // Afficher le chargement et désactiver les boutons
      btnValidateServer.disabled = true;
      btnStep2Back.disabled = true;
      if (creationProgress) {
        creationProgress.style.display = 'flex';
        if (creationProgressText) {
          const prepMsg = window.i18n ? window.i18n.t('creating_prep_msg').replace('{type}', selectedType).replace('{version}', version) : `Préparation et vérification des fichiers (${selectedType} ${version})...`;
          creationProgressText.textContent = prepMsg;
        }
      }

      try {
        let createdServer = null;
        if (window.electronAPI && window.electronAPI.createServer) {
          createdServer = await window.electronAPI.createServer(newServerData);
        } else {
          createdServer = {
            id: 'server_' + Date.now(),
            ...newServerData,
            createdAt: Date.now(),
            status: 'stopped'
          };
        }

        // Ajouter le nouveau serveur au début (plus récent en haut)
        servers.unshift(createdServer);
        saveCache();

        switchMainView('servers');
        renderServers();
        openDedicatedServerPage(createdServer);
      } catch (err) {
        alert(`${window.i18n ? window.i18n.t('error_server_creation') : 'Erreur lors de la création du serveur'} : ${err.message || err}`);
      } finally {
        btnValidateServer.disabled = false;
        btnStep2Back.disabled = false;
        if (creationProgress) creationProgress.style.display = 'none';
      }
    });
  }

  window.addEventListener('focus', () => {
    if (sidebarMain.style.display !== 'none') {
      loadServers();
    }
  });

  // Rendu synchrone immédiat depuis le cache local (0 ms de latence à l'ouverture)
  const cachedAtBoot = getCache();
  if (cachedAtBoot && cachedAtBoot.length > 0) {
    servers = cachedAtBoot;
    renderServers();
  }

  // Chargement initial complet et asynchrone des serveurs depuis le disque
  try {
    await loadServers();
  } catch (err) {
    console.error('Erreur chargement initial des serveurs:', err);
  }

  // Préchargement sécurisé en arrière-plan des versions pour l'assistant de création
  try {
    loadEngineVersions('Paper');
  } catch (e) {}

  // ============================================================================
  // GESTION DU SYSTEME DE MISE A JOUR INTRA-APPLICATION (GITHUB RELEASES DIRECT)
  // ============================================================================

  const appCurrentVersionText = document.getElementById('appCurrentVersionText');
  const updateStatusIndicator = document.getElementById('updateStatusIndicator');
  const btnCheckForUpdates = document.getElementById('btnCheckForUpdates');
  const toggleAutoCheckUpdates = document.getElementById('toggleAutoCheckUpdates');
  const sidebarUpdateBadge = document.getElementById('sidebarUpdateBadge');

  const modalUpdate = document.getElementById('modalUpdate');
  const updateModalBadge = document.getElementById('updateModalBadge');
  const updateModalDate = document.getElementById('updateModalDate');
  const updateChangelogContent = document.getElementById('updateChangelogContent');
  const updateProgressSection = document.getElementById('updateProgressSection');
  const updateProgressStatus = document.getElementById('updateProgressStatus');
  const updateProgressPercent = document.getElementById('updateProgressPercent');
  const updateProgressFill = document.getElementById('updateProgressFill');
  const btnUpdateModalAction = document.getElementById('btnUpdateModalAction');
  const btnUpdateActionText = document.getElementById('btnUpdateActionText');
  const btnUpdateModalClose = document.getElementById('btnUpdateModalClose');
  const btnUpdateModalLater = document.getElementById('btnUpdateModalLater');

  let currentUpdateData = null;
  let updateActionState = 'download'; // 'download' | 'install'

  function formatBytesSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function renderChangelogHtml(rawMarkdown) {
    if (!rawMarkdown || !rawMarkdown.trim()) {
      return `<p>${window.i18n ? window.i18n.t('modal_update_features') : 'Nouvelles fonctionnalités et améliorations'}</p>`;
    }
    const lines = rawMarkdown.split('\n');
    let html = '';
    let inList = false;

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inList) { html += '</ul>'; inList = false; }
        continue;
      }
      if (trimmed.startsWith('#')) {
        if (inList) { html += '</ul>'; inList = false; }
        const cleanHeader = trimmed.replace(/^#+\s*/, '');
        html += `<div style="font-weight: 700; margin-top: 8px; margin-bottom: 4px; color: var(--text-primary);">${escapeHtml(cleanHeader)}</div>`;
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) { html += '<ul>'; inList = true; }
        const item = trimmed.slice(2).trim();
        html += `<li>${escapeHtml(item)}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<p style="margin: 4px 0;">${escapeHtml(trimmed)}</p>`;
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function openUpdateModal(updateInfo) {
    currentUpdateData = updateInfo;
    updateActionState = 'download';

    if (updateModalBadge) updateModalBadge.textContent = `v${updateInfo.latestVersion}`;
    if (updateModalDate) {
      let dateStr = '';
      if (updateInfo.releaseDate) {
        try {
          const d = new Date(updateInfo.releaseDate);
          dateStr = d.toLocaleDateString();
        } catch (e) {}
      }
      const label = window.i18n ? window.i18n.t('modal_update_published_at') : 'Publiée le';
      updateModalDate.textContent = dateStr ? `${label} ${dateStr}` : '';
    }

    if (updateChangelogContent) {
      updateChangelogContent.innerHTML = renderChangelogHtml(updateInfo.releaseNotes);
    }

    if (updateProgressSection) updateProgressSection.style.display = 'none';
    if (updateProgressFill) updateProgressFill.style.width = '0%';
    if (btnUpdateActionText) {
      btnUpdateActionText.textContent = window.i18n ? window.i18n.t('modal_update_btn_download') : 'Télécharger et installer';
    }
    if (btnUpdateModalAction) btnUpdateModalAction.disabled = false;

    if (modalUpdate) modalUpdate.style.display = 'flex';
  }

  function closeUpdateModal() {
    if (modalUpdate) modalUpdate.style.display = 'none';
  }

  if (btnUpdateModalClose) btnUpdateModalClose.addEventListener('click', closeUpdateModal);
  if (btnUpdateModalLater) btnUpdateModalLater.addEventListener('click', closeUpdateModal);

  if (btnUpdateModalAction) {
    btnUpdateModalAction.addEventListener('click', async () => {
      if (updateActionState === 'install') {
        try {
          btnUpdateModalAction.disabled = true;
          await window.electronAPI.applyUpdateAndRestart();
        } catch (err) {
          alert('Erreur lors de l\'installation : ' + err.message);
          btnUpdateModalAction.disabled = false;
        }
        return;
      }

      if (!currentUpdateData || !currentUpdateData.downloadUrl) {
        if (currentUpdateData && currentUpdateData.htmlUrl) {
          window.electronAPI.openExternalUrl(currentUpdateData.htmlUrl);
        }
        return;
      }

      try {
        btnUpdateModalAction.disabled = true;
        if (updateProgressSection) updateProgressSection.style.display = 'flex';
        if (updateProgressPercent) updateProgressPercent.textContent = '0%';
        if (updateProgressFill) updateProgressFill.style.width = '0%';
        if (updateProgressStatus) {
          updateProgressStatus.textContent = window.i18n ? window.i18n.t('modal_update_downloading') : 'Téléchargement en cours...';
        }

        await window.electronAPI.startDownloadUpdate(currentUpdateData.downloadUrl);
      } catch (err) {
        alert((window.i18n ? window.i18n.t('modal_update_error') : 'Erreur de mise à jour') + ' : ' + err.message);
        btnUpdateModalAction.disabled = false;
        if (updateProgressSection) updateProgressSection.style.display = 'none';
      }
    });
  }

  if (window.electronAPI.onUpdateDownloadProgress) {
    window.electronAPI.onUpdateDownloadProgress((data) => {
      if (updateProgressFill) updateProgressFill.style.width = `${data.percent}%`;
      if (updateProgressPercent) updateProgressPercent.textContent = `${data.percent}%`;
      if (updateProgressStatus) {
        const transferred = formatBytesSize(data.bytesTransferred);
        const total = formatBytesSize(data.totalBytes);
        updateProgressStatus.textContent = `${window.i18n ? window.i18n.t('modal_update_downloading') : 'Téléchargement'} : ${transferred} / ${total}`;
      }
    });
  }

  if (window.electronAPI.onUpdateDownloaded) {
    window.electronAPI.onUpdateDownloaded(() => {
      updateActionState = 'install';
      if (updateProgressFill) updateProgressFill.style.width = '100%';
      if (updateProgressPercent) updateProgressPercent.textContent = '100%';
      if (updateProgressStatus) {
        updateProgressStatus.textContent = window.i18n ? window.i18n.t('modal_update_ready') : 'Téléchargement terminé. Prêt pour l\'installation.';
      }
      if (btnUpdateActionText) {
        btnUpdateActionText.textContent = window.i18n ? window.i18n.t('modal_update_btn_install') : 'Installer et redémarrer';
      }
      if (btnUpdateModalAction) btnUpdateModalAction.disabled = false;
    });
  }

  async function performUpdateCheck(manual = false) {
    if (manual) {
      if (btnCheckForUpdates) btnCheckForUpdates.disabled = true;
      if (updateStatusIndicator) {
        updateStatusIndicator.textContent = window.i18n ? window.i18n.t('settings_updates_checking') : 'Vérification en cours...';
        updateStatusIndicator.style.color = 'var(--text-secondary)';
      }
    }

    try {
      const res = await window.electronAPI.checkForUpdates();
      if (res && res.hasUpdate) {
        if (sidebarUpdateBadge) sidebarUpdateBadge.style.display = 'inline-block';
        if (updateStatusIndicator) {
          updateStatusIndicator.textContent = `${window.i18n ? window.i18n.t('settings_updates_available') : 'Nouvelle version disponible !'} (v${res.latestVersion})`;
          updateStatusIndicator.style.color = '#2563eb';
        }
        openUpdateModal(res);
      } else {
        if (sidebarUpdateBadge) sidebarUpdateBadge.style.display = 'none';
        if (updateStatusIndicator) {
          updateStatusIndicator.textContent = window.i18n ? window.i18n.t('settings_updates_up_to_date') : 'Votre application est à jour.';
          updateStatusIndicator.style.color = 'var(--text-secondary)';
        }
      }
    } catch (err) {
      if (manual && updateStatusIndicator) {
        updateStatusIndicator.textContent = (window.i18n ? window.i18n.t('modal_update_error') : 'Erreur') + ' : ' + err.message;
        updateStatusIndicator.style.color = '#dc2626';
      }
    } finally {
      if (manual && btnCheckForUpdates) {
        btnCheckForUpdates.disabled = false;
      }
    }
  }

  if (btnCheckForUpdates) {
    btnCheckForUpdates.addEventListener('click', () => performUpdateCheck(true));
  }

  try {
    window.electronAPI.getAppVersion().then((v) => {
      if (appCurrentVersionText && v) {
        appCurrentVersionText.textContent = `DesktopServer v${v}`;
      }
    });
  } catch (e) {}

  if (toggleAutoCheckUpdates) {
    const savedAutoCheck = localStorage.getItem('desktopserver_autocheck_updates');
    if (savedAutoCheck !== null) {
      toggleAutoCheckUpdates.checked = savedAutoCheck === 'true';
    }
    toggleAutoCheckUpdates.addEventListener('change', () => {
      localStorage.setItem('desktopserver_autocheck_updates', toggleAutoCheckUpdates.checked ? 'true' : 'false');
    });

    if (toggleAutoCheckUpdates.checked) {
      setTimeout(() => {
        performUpdateCheck(false);
      }, 3500);
    }
  }
});
