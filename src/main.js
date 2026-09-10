const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const net = require('net');
const child_process = require('child_process');
const dgram = require('dgram');
const os = require('os');
const pidusage = require('pidusage');

let mainWindow;
let tray = null;
let isQuitting = false;
let isShuttingDownAll = false;
const activeProcesses = new Map(); // serverId -> ChildProcess
const activeTunnels = new Map(); // serverId -> { proc, publicAddress }
const activeUPnPMappings = new Map(); // serverId -> { gateway, port, publicIp, publicAddress, duckTimer }
const activePinggyTunnels = new Map(); // serverId -> { proc, publicAddress }
const activePortmapTunnels = new Map(); // serverId -> { proc, publicAddress }

let lastCpuMeasure = null;

function getSystemAndCoreCpuUsage() {
  const currentCpus = os.cpus();
  if (!lastCpuMeasure) {
    lastCpuMeasure = currentCpus;
    return {
      systemCpu: 0,
      coreUsages: currentCpus.map(() => 0),
      cpuModel: currentCpus[0]?.model || '',
      coreCount: currentCpus.length
    };
  }

  let totalDiffAll = 0;
  let idleDiffAll = 0;
  const coreUsages = currentCpus.map((cpu, i) => {
    const prev = lastCpuMeasure[i] || cpu;
    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
    const currTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const totalDiff = currTotal - prevTotal;
    const idleDiff = (cpu.times.idle || 0) - (prev.times.idle || 0);

    totalDiffAll += totalDiff;
    idleDiffAll += idleDiff;

    const usage = totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0;
    return Math.max(0, Math.min(100, usage));
  });

  lastCpuMeasure = currentCpus;

  const systemCpu = totalDiffAll > 0 ? Math.round(((totalDiffAll - idleDiffAll) / totalDiffAll) * 100) : 0;

  return {
    systemCpu: Math.max(0, Math.min(100, systemCpu)),
    coreUsages,
    cpuModel: currentCpus[0]?.model || '',
    coreCount: currentCpus.length
  };
}

async function calculateDirectorySizeAndBreakdown(dirPath) {
  let totalSize = 0;
  const breakdown = {
    world: 0,
    plugins: 0,
    mods: 0,
    logs: 0,
    jars: 0,
    other: 0
  };

  if (!fs.existsSync(dirPath)) {
    return { totalSize, breakdown };
  }

  async function walk(currentDir, relativePrefix = '') {
    let entries = [];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.join(relativePrefix, entry.name).replace(/\\/g, '/').toLowerCase();

      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          const size = stat.size || 0;
          totalSize += size;

          if (relPath.startsWith('world') || relPath.startsWith('world_nether') || relPath.startsWith('world_the_end') || relPath.includes('/region/') || relPath.includes('/poi/') || relPath.includes('/entities/')) {
            breakdown.world += size;
          } else if (relPath.startsWith('plugins/') || relPath.startsWith('plugin/')) {
            breakdown.plugins += size;
          } else if (relPath.startsWith('mods/')) {
            breakdown.mods += size;
          } else if (relPath.startsWith('logs/') || relPath.startsWith('crash-reports/') || relPath.endsWith('.log') || relPath.endsWith('.log.gz')) {
            breakdown.logs += size;
          } else if (relPath.endsWith('.jar')) {
            breakdown.jars += size;
          } else {
            breakdown.other += size;
          }
        } catch (e) {}
      }
    }
  }

  await walk(dirPath);
  return { totalSize, breakdown };
}

function getAppRootDirectory() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (app.isPackaged) {
    const execDir = path.dirname(process.execPath);
    if (path.basename(execDir).toLowerCase() === 'win-unpacked') {
      return path.resolve(execDir, '..');
    }
    return execDir;
  }
  return path.resolve(__dirname, '..');
}

function getPrimaryServersDir() {
  const rootDir = getAppRootDirectory();
  const primaryDir = path.join(rootDir, 'servers');
  try {
    if (!fs.existsSync(primaryDir)) {
      fs.mkdirSync(primaryDir, { recursive: true });
    }
    return primaryDir;
  } catch (err) {
    console.error('Erreur accès dossier racine servers, fallback userData:', err);
    const fallbackDir = path.join(app.getPath('userData'), 'servers');
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
    return fallbackDir;
  }
}

function getAllServerCandidateDirs() {
  const dirs = new Set();
  try { dirs.add(getPrimaryServersDir()); } catch (e) {}
  try { dirs.add(path.join(app.getPath('userData'), 'servers')); } catch (e) {}
  try {
    dirs.add(path.join(process.cwd(), 'servers'));
    dirs.add(path.join(process.cwd(), 'dist', 'servers'));
    dirs.add(path.join(process.cwd(), 'dist', 'win-unpacked', 'servers'));
  } catch (e) {}
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    try {
      dirs.add(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'servers'));
      dirs.add(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'dist', 'servers'));
      dirs.add(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'dist', 'win-unpacked', 'servers'));
    } catch (e) {}
  }
  return dirs;
}

function syncServerSecret(folderPath, serverId) {
  const secretPath = path.join(folderPath, 'playit_secret.txt');
  const serverJsonPath = path.join(folderPath, 'server.json');

  let secret = '';
  if (fs.existsSync(secretPath)) {
    try {
      secret = fs.readFileSync(secretPath, 'utf8').trim();
    } catch (e) {}
  }

  if ((!secret || secret.length < 20) && fs.existsSync(serverJsonPath)) {
    try {
      const srv = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
      if (srv.playitSecret && srv.playitSecret.trim().length > 20) {
        secret = srv.playitSecret.trim();
        fs.writeFileSync(secretPath, secret, 'utf8');
      }
    } catch (e) {}
  }

  // Si toujours pas de secret, fouiller les autres dossiers candidats
  if (!secret || secret.length < 20) {
    for (const dir of getAllServerCandidateDirs()) {
      const otherSecretPath = path.join(dir, serverId, 'playit_secret.txt');
      if (fs.existsSync(otherSecretPath)) {
        try {
          const otherSecret = fs.readFileSync(otherSecretPath, 'utf8').trim();
          if (otherSecret && otherSecret.length > 20) {
            secret = otherSecret;
            try { fs.writeFileSync(secretPath, secret, 'utf8'); } catch (e) {}
            break;
          }
        } catch (e) {}
      }
    }
  }

  // Si on a un secret valide, mettre à jour server.json
  if (secret && secret.length > 20 && fs.existsSync(serverJsonPath)) {
    try {
      const srv = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
      if (srv.playitSecret !== secret) {
        srv.playitSecret = secret;
        fs.writeFileSync(serverJsonPath, JSON.stringify(srv, null, 2), 'utf8');
      }
    } catch (e) {}
  }

  return secret;
}

function getServerFolderPath(serverId) {
  for (const dir of getAllServerCandidateDirs()) {
    const candidate = path.join(dir, serverId);
    if (fs.existsSync(candidate) && (fs.existsSync(path.join(candidate, 'server.json')) || fs.existsSync(path.join(candidate, 'playit_secret.txt')))) {
      syncServerSecret(candidate, serverId);
      return candidate;
    }
  }
  for (const dir of getAllServerCandidateDirs()) {
    const candidate = path.join(dir, serverId);
    if (fs.existsSync(candidate)) {
      syncServerSecret(candidate, serverId);
      return candidate;
    }
  }
  const defaultDir = path.join(getPrimaryServersDir(), serverId);
  return defaultDir;
}

// Détermination précise de la version majeure Java requise pour une version Minecraft
function getRequiredJavaVersion(mcVersion) {
  if (!mcVersion) return 21;
  const v = String(mcVersion).trim().toLowerCase();

  // Instantanés ou snapshots (ex: 26w09a, 25w10a)
  if (v.startsWith('26w') || v.startsWith('25w')) {
    return 25;
  }
  if (v.startsWith('24w') || v.startsWith('23w')) {
    return 21;
  }

  // Versions modernes Mojang (ex: 26.1, 26.2, 25.0)
  const parts = v.split('.').map(n => parseInt(n, 10));
  if (!isNaN(parts[0]) && parts[0] >= 25) {
    return 25;
  }

  // Versions classiques 1.X.Y
  if (parts[0] === 1 && !isNaN(parts[1])) {
    const minor = parts[1];
    const patch = isNaN(parts[2]) ? 0 : parts[2];

    if (minor >= 25) return 25; // 1.25+
    if (minor === 20 && patch >= 5) return 21; // 1.20.5, 1.20.6
    if (minor >= 21) return 21; // 1.21.x
    if (minor >= 17) return 17; // 1.17 à 1.20.4
    return 8; // 1.8 à 1.16.5
  }

  return 21;
}

// Emplacement permanent et persistant des runtimes Java portables
function getPersistentJavaRuntimesDir() {
  // Toujours utiliser AppData pour garantir que les runtimes Java ne soient JAMAIS effacés
  // (même en cas de mise à jour, rebuild electron ou exécution en mode portable)
  let baseDir = '';
  try {
    baseDir = app.getPath('userData');
  } catch (e) {
    baseDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'desktop-server') : path.resolve(__dirname, '..');
  }

  const primaryDir = path.join(baseDir, 'java_runtimes');
  try {
    if (!fs.existsSync(primaryDir)) {
      fs.mkdirSync(primaryDir, { recursive: true });
    }
    return primaryDir;
  } catch (err) {
    const fallback = path.join(getAppRootDirectory(), 'java_runtimes');
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  }
}

// Recherche récursive profonde (jusqu'à 5 niveaux) d'un exécutable Java (java.exe sur Windows, bin/java ou Contents/Home/bin/java sur macOS/Linux)
function findJavaBin(dir, maxDepth = 5) {
  if (!dir || !fs.existsSync(dir) || maxDepth < 0) return null;

  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [
        path.join(dir, 'bin', 'java.exe'),
        path.join(dir, 'java.exe')
      ]
    : [
        path.join(dir, 'Contents', 'Home', 'bin', 'java'),
        path.join(dir, 'bin', 'java'),
        path.join(dir, 'java')
      ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      if (!isWin) {
        try { fs.chmodSync(cand, 0o755); } catch (e) {}
      }
      return process.platform === 'darwin' ? ensureMacJavaRunner(cand) : cand;
    }
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subExe = findJavaBin(path.join(dir, entry.name), maxDepth - 1);
        if (subExe) return subExe;
      }
    }
  } catch (e) {}

  return null;
}
const findJavaExe = findJavaBin;

// Recherche multi-emplacements d'un runtime Java déjà stocké sur la machine
function findExistingJavaRuntime(targetJavaVer) {
  const candidateDirs = [];

  // 1. AppData persistant garanti
  try {
    candidateDirs.push(path.join(app.getPath('userData'), 'java_runtimes', `java-${targetJavaVer}`));
  } catch (e) {}

  // 2. Dossier APPDATA direct si userData diffère
  if (process.env.APPDATA) {
    candidateDirs.push(path.join(process.env.APPDATA, 'desktop-server', 'java_runtimes', `java-${targetJavaVer}`));
  }

  // 3. Dossier de l'exécutable portable
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidateDirs.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'java_runtimes', `java-${targetJavaVer}`));
  }

  // 4. Dossier racine de l'application
  try {
    candidateDirs.push(path.join(getAppRootDirectory(), 'java_runtimes', `java-${targetJavaVer}`));
  } catch (e) {}

  // 5. Répertoire de travail
  try {
    candidateDirs.push(path.join(process.cwd(), 'java_runtimes', `java-${targetJavaVer}`));
  } catch (e) {}

  for (const dir of candidateDirs) {
    const exe = findJavaBin(dir);
    if (exe) return exe;
  }

  return null;
}

// Détection de la version majeure du Java installé dans le PATH système
function getSystemJavaMajorVersion() {
  try {
    const res = child_process.spawnSync('java', ['-version'], { encoding: 'utf8' });
    const output = (res.stderr || '') + (res.stdout || '');
    const match = output.match(/version "([0-9]+)(?:\.([0-9]+))?/i);
    if (match) {
      const first = parseInt(match[1], 10);
      if (first === 1 && match[2]) {
        return parseInt(match[2], 10);
      }
      return first;
    }
  } catch (e) {}
  return null;
}

// Extraction d'une archive (.zip ou .tar.gz) via tar ou outils système
function extractArchive(archivePath, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const isTarGz = archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz');
  if (isTarGz) {
    child_process.execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'ignore' });
    return;
  }
  try {
    child_process.execSync(`tar -xf "${archivePath}" -C "${destDir}"`, { stdio: 'ignore' });
  } catch (err) {
    if (process.platform === 'win32') {
      child_process.execSync(`powershell -NoProfile -NonInteractive -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'ignore' });
    } else {
      child_process.execSync(`unzip -q -o "${archivePath}" -d "${destDir}"`, { stdio: 'ignore' });
    }
  }
}
const extractZipArchive = extractArchive;

// Shim dyld pour macOS 10.13 High Sierra (resout le symbole manquant ____chkstk_darwin pour Java 25)
function getMacDyldShimPath() {
  if (process.platform !== 'darwin') return null;
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'mac', 'libchkstk.dylib'),
    path.join(process.resourcesPath || '', 'libchkstk.dylib'),
    path.join(__dirname, '..', 'bin', 'mac', 'libchkstk.dylib'),
    path.join(__dirname, '..', 'libchkstk.dylib'),
    path.join(typeof app !== 'undefined' && app.getAppPath ? app.getAppPath() : '', 'bin', 'mac', 'libchkstk.dylib'),
    path.join(typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : '', 'libchkstk.dylib'),
    path.join(typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : '', 'bin', 'libchkstk.dylib'),
    path.join(typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : '', 'java_runtimes', 'libchkstk.dylib'),
    path.join(typeof app !== 'undefined' && app.getPath ? app.getPath('userData') : '', 'java_runtimes', 'java-25', 'libchkstk.dylib')
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function getMacDyldEnv() {
  const shim = getMacDyldShimPath();
  if (shim) {
    return {
      DYLD_FORCE_FLAT_NAMESPACE: '1',
      DYLD_INSERT_LIBRARIES: shim
    };
  }
  return {};
}

// Genere un lanceur d'execution direct sur macOS (evite le filtrage des variables DYLD par le systeme)
function ensureMacJavaRunner(javaBinPath) {
  if (process.platform !== 'darwin' || !javaBinPath || !fs.existsSync(javaBinPath)) return javaBinPath;
  if (javaBinPath.endsWith('.sh')) return javaBinPath;
  try {
    const binDir = path.dirname(javaBinPath);
    const runnerPath = path.join(binDir, 'java_runner.sh');
    let shimDylib = getMacDyldShimPath();

    // Copie de secours du shim directement dans le dossier lib du runtime
    const candidateLibDirs = [
      path.join(binDir, '..', 'lib'),
      path.join(binDir, '..', 'Contents', 'Home', 'lib'),
      path.join(binDir, 'lib')
    ];
    for (const lDir of candidateLibDirs) {
      if (fs.existsSync(lDir)) {
        const localShim = path.join(lDir, 'libchkstk.dylib');
        if (shimDylib && fs.existsSync(shimDylib) && !fs.existsSync(localShim)) {
          try { fs.copyFileSync(shimDylib, localShim); } catch (e) {}
        }
        if (fs.existsSync(localShim)) {
          shimDylib = localShim;
        }
      }
    }

    const script = [
      '#!/bin/sh',
      'export DYLD_FORCE_FLAT_NAMESPACE=1',
      shimDylib ? `export DYLD_INSERT_LIBRARIES="${shimDylib}"` : '',
      `exec "${javaBinPath}" "$@"`
    ].filter(Boolean).join('\n') + '\n';

    fs.writeFileSync(runnerPath, script, { mode: 0o755 });
    try { fs.chmodSync(runnerPath, 0o755); } catch (e) {}
    return runnerPath;
  } catch (e) {
    return javaBinPath;
  }
}

// Teste la validite reelle d'un executable Java (verifie l'absence de crash dyld ou de symboles manquants)
function testJavaExecutable(javaPath) {
  if (!javaPath) return false;
  try {
    let execPath = javaPath;
    let execArgs = ['-version'];
    const env = { ...process.env, ...getMacDyldEnv() };

    if (process.platform === 'darwin' && javaPath.endsWith('.sh')) {
      execPath = '/bin/sh';
      execArgs = [javaPath, '-version'];
    }

    const res = child_process.spawnSync(execPath, execArgs, {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 15000,
      env
    });
    return res.status === 0;
  } catch (e) {
    return false;
  }
}

// Detecte si le systeme macOS est anterieur a macOS 11 Big Sur (ex: macOS 10.13 High Sierra, 10.14 Mojave, 10.15 Catalina)
function isMacOlderThanBigSur() {
  if (process.platform !== 'darwin') return false;
  try {
    const darwinMajor = parseInt(os.release().split('.')[0], 10);
    return darwinMajor < 20; // Darwin 20 = macOS 11.0 Big Sur
  } catch (e) {
    return false;
  }
}

// Resolution dynamique BellSoft Liberica JRE (certifiee sans symbole manquant pour macOS 10.12+)
async function getLibericaDownloadUrl(featureVer, isArm64) {
  const arch = isArm64 ? 'arm' : 'x86';
  const apiUrl = `https://api.bell-sw.com/v1/liberica/releases?version-feature=${featureVer}&version-modifier=latest&bitness=64&os=macos&arch=${arch}&package-type=tar.gz&bundle-type=jre`;
  try {
    const res = await new Promise((resolve, reject) => {
      const req = https.get(apiUrl, { headers: { 'User-Agent': 'DesktopServer' } }, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          https.get(resp.headers.location, { headers: { 'User-Agent': 'DesktopServer' } }, (r2) => {
            let body = '';
            r2.on('data', chunk => body += chunk);
            r2.on('end', () => resolve(body));
          }).on('error', reject);
          return;
        }
        let body = '';
        resp.on('data', chunk => body += chunk);
        resp.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
    const parsed = JSON.parse(res);
    if (parsed && parsed.length > 0 && parsed[0].downloadUrl) {
      return parsed[0].downloadUrl;
    }
  } catch (err) {}
  return null;
}

// Telechargement, stockage permanent et verification de validite du runtime Java adapte (Windows, macOS ARM/Intel, Linux)
async function getOrInstallJavaRuntime(mcVersion, onProgress) {
  let targetJavaVer = getRequiredJavaVersion(mcVersion);
  const isMac = process.platform === 'darwin';
  const isArm64 = process.arch === 'arm64';

  // 1. REUTILISATION IMMÉDIATE si deja stocke
  const existingDedicatedExe = findExistingJavaRuntime(targetJavaVer);
  if (existingDedicatedExe) {
    const runner = isMac ? ensureMacJavaRunner(existingDedicatedExe) : existingDedicatedExe;
    if (testJavaExecutable(runner)) {
      if (onProgress) {
        onProgress(100, 0, 0, `Java ${targetJavaVer} deja installe : reutilisation instantanee sans telechargement.`);
      }
      return runner;
    } else {
      if (targetJavaVer === 25 && isMac) {
        return runner;
      }
      console.warn(`Java ${targetJavaVer} dans ${existingDedicatedExe} non fonctionnel sur cet OS, nettoyage automatique...`);
      try {
        const runtimesDir = getPersistentJavaRuntimesDir();
        const dedicatedDir = path.join(runtimesDir, `java-${targetJavaVer}`);
        fs.rmSync(dedicatedDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }

  // 2. Reutilisation si Java 8 deja installe localement sur le systeme Windows
  if (targetJavaVer === 8 && process.platform === 'win32') {
    const defaultJre8 = 'C:\\Program Files\\Java\\jre1.8.0_461\\bin\\java.exe';
    if (fs.existsSync(defaultJre8) && testJavaExecutable(defaultJre8)) {
      if (onProgress) {
        onProgress(100, 0, 0, `Java 8 systeme detecte : reutilisation.`);
      }
      return defaultJre8;
    }
  }

  // 3. Reutilisation si le Java systeme du PATH est compatible et operationnel
  const systemMajor = getSystemJavaMajorVersion();
  if (systemMajor && testJavaExecutable('java')) {
    if (targetJavaVer === 25 && systemMajor >= 25) {
      if (onProgress) onProgress(100, 0, 0, `Java ${systemMajor} present dans le PATH : reutilisation.`);
      return 'java';
    }
    if (targetJavaVer === 21 && systemMajor >= 21) {
      if (onProgress) onProgress(100, 0, 0, `Java ${systemMajor} present dans le PATH : reutilisation.`);
      return 'java';
    }
    if (targetJavaVer === 17 && (systemMajor === 17 || systemMajor >= 21)) {
      if (onProgress) onProgress(100, 0, 0, `Java ${systemMajor} compatible : reutilisation.`);
      return 'java';
    }
    if (targetJavaVer === 8 && systemMajor === 8) {
      if (onProgress) onProgress(100, 0, 0, `Java 8 present dans le PATH : reutilisation.`);
      return 'java';
    }
  }

  // 4. Premier telechargement unique vers le dossier persistant
  const runtimesDir = getPersistentJavaRuntimesDir();
  const dedicatedDir = path.join(runtimesDir, `java-${targetJavaVer}`);

  if (onProgress) {
    onProgress(0, 0, 0, `Telechargement unique de Java ${targetJavaVer} (pour Minecraft ${mcVersion})...`);
  }

  let ext = (isMac || process.platform === 'linux') ? 'tar.gz' : 'zip';
  let downloadUrl = '';

  if (isMac) {
    downloadUrl = await getLibericaDownloadUrl(targetJavaVer, isArm64);
    if (!downloadUrl) {
      const archKey = isArm64 ? 'aarch64' : 'amd64';
      const staticFallbacks = {
        8: `https://github.com/bell-sw/Liberica/releases/download/8u504+1/bellsoft-jre8u504+1-macos-${archKey}.tar.gz`,
        17: `https://github.com/bell-sw/Liberica/releases/download/17.0.20.1+1/bellsoft-jre17.0.20.1+1-macos-${archKey}.tar.gz`,
        21: `https://github.com/bell-sw/Liberica/releases/download/21.0.12.1+1/bellsoft-jre21.0.12.1+1-macos-${archKey}.tar.gz`,
        25: `https://github.com/bell-sw/Liberica/releases/download/25.0.2+12/bellsoft-jre25.0.2+12-macos-${archKey}.tar.gz`
      };
      downloadUrl = staticFallbacks[targetJavaVer] || `https://api.adoptium.net/v3/binary/latest/${targetJavaVer}/ga/mac/${isArm64 ? 'aarch64' : 'x64'}/jre/hotspot/normal/eclipse`;
    }
  } else {
    let osSlug = process.platform === 'win32' ? 'windows' : 'linux';
    let archSlug = isArm64 ? 'aarch64' : 'x64';
    downloadUrl = `https://api.adoptium.net/v3/binary/latest/${targetJavaVer}/ga/${osSlug}/${archSlug}/jre/hotspot/normal/eclipse`;
  }

  const tempArchive = path.join(runtimesDir, `jre_${targetJavaVer}_${Date.now()}.${ext}`);

  try {
    await downloadFile(downloadUrl, tempArchive, (percent, cur, total) => {
      if (onProgress) {
        onProgress(percent, cur, total, `Telechargement de Java ${targetJavaVer} : ${percent}% (${cur} / ${total} Mo)`);
      }
    });

    if (onProgress) {
      onProgress(95, 0, 0, `Extraction et stockage permanent de Java ${targetJavaVer}...`);
    }

    extractArchive(tempArchive, dedicatedDir);

    if (process.platform === 'darwin') {
      const shim = getMacDyldShimPath();
      if (shim && fs.existsSync(shim)) {
        try {
          const subDirs = [
            'lib',
            path.join('Contents', 'Home', 'lib'),
            path.join('jre', 'lib')
          ];
          for (const sub of subDirs) {
            const targetDir = path.join(dedicatedDir, sub);
            if (fs.existsSync(targetDir)) {
              fs.copyFileSync(shim, path.join(targetDir, 'libchkstk.dylib'));
            }
          }
          fs.copyFileSync(shim, path.join(dedicatedDir, 'libchkstk.dylib'));
        } catch (e) {}
      }
    }

    try {
      if (fs.existsSync(tempArchive)) fs.unlinkSync(tempArchive);
    } catch (e) {}

    const installedExe = findJavaBin(dedicatedDir);
    if (installedExe) {
      const runner = isMac ? ensureMacJavaRunner(installedExe) : installedExe;
      testJavaExecutable(runner);
      if (onProgress) {
        onProgress(100, 0, 0, `Java ${targetJavaVer} stocke avec succes dans ${dedicatedDir}`);
      }
      return runner;
    }
  } catch (err) {
    console.error(`Erreur lors du telechargement/installation de Java ${targetJavaVer}:`, err);
    try {
      if (fs.existsSync(tempArchive)) fs.unlinkSync(tempArchive);
    } catch (e) {}
  }

  // Fallback si echec de l'installation dediee
  if (targetJavaVer === 8 && process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Java\\jre1.8.0_461\\bin\\java.exe')) {
    return 'C:\\Program Files\\Java\\jre1.8.0_461\\bin\\java.exe';
  }

  // Ne JAMAIS utiliser un 'java' systeme inferieur a la version requise (evite UnsupportedClassVersionError)
  const sysMajor = getSystemJavaMajorVersion();
  if (sysMajor && sysMajor >= targetJavaVer) {
    return 'java';
  }

  const lastResort = findExistingJavaRuntime(targetJavaVer);
  if (lastResort) {
    return isMac ? ensureMacJavaRunner(lastResort) : lastResort;
  }

  throw new Error(`Le runtime Java ${targetJavaVer} requis pour Minecraft ${mcVersion} n'a pas pu être initialisé.`);
}

function getPlayitBinaryPath() {
  const exeName = process.platform === 'win32' ? 'playit.exe' : 'playit';
  const userDataBin = path.join(app.getPath('userData'), 'bin', exeName);
  if (fs.existsSync(userDataBin)) {
    try {
      if (fs.statSync(userDataBin).size > 1000000) {
        if (process.platform !== 'win32') {
          try { fs.chmodSync(userDataBin, 0o755); } catch (e) {}
        }
        return userDataBin;
      }
    } catch (e) {}
  }

  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', exeName));
    candidates.push(path.join(process.resourcesPath, exeName));
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'bin', exeName));
  }
  if (!app.isPackaged) {
    candidates.push(path.resolve(__dirname, '..', 'bin', exeName));
  }

  for (const c of candidates) {
    // Crucial : filtrer strictement tout chemin contenant .asar (invalide pour CreateProcess/spawn)
    if (!c.includes('.asar') && fs.existsSync(c)) {
      try {
        const stat = fs.statSync(c);
        if (stat.size > 1000000) {
          const uDir = path.dirname(userDataBin);
          if (!fs.existsSync(uDir)) fs.mkdirSync(uDir, { recursive: true });
          fs.copyFileSync(c, userDataBin);
          if (process.platform !== 'win32') {
            try { fs.chmodSync(userDataBin, 0o755); } catch (e) {}
          }
          return userDataBin;
        }
      } catch (e) {
        return c;
      }
    }
  }

  return userDataBin;
}

async function ensurePlayitBinary() {
  const binPath = getPlayitBinaryPath();
  if (fs.existsSync(binPath) && !binPath.includes('.asar')) {
    try {
      if (fs.statSync(binPath).size > 1000000) {
        if (process.platform !== 'win32') {
          try { fs.chmodSync(binPath, 0o755); } catch (e) {}
        }
        return binPath;
      }
    } catch (e) {}
  }

  const binDir = path.dirname(binPath);
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  const isMac = process.platform === 'darwin';
  const isArm64 = process.arch === 'arm64';
  let url = 'https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-windows-x86_64.exe';
  if (isMac) {
    url = isArm64
      ? 'https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-darwin-aarch64'
      : 'https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-darwin-amd64';
  } else if (process.platform === 'linux') {
    url = isArm64
      ? 'https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-linux-aarch64'
      : 'https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-linux-x86_64';
  }

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(binPath);
    const get = (targetUrl) => {
      https.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
        } else if (res.statusCode === 200) {
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            if (process.platform !== 'win32') {
              try { fs.chmodSync(binPath, 0o755); } catch (e) {}
            }
            resolve(binPath);
          });
        } else {
          fs.unlink(binPath, () => {});
          reject(new Error(`Download failed with status ${res.statusCode}`));
        }
      }).on('error', (err) => {
        fs.unlink(binPath, () => {});
        reject(err);
      });
    };
    get(url);
  });
}

function parsePlayitTunnels(output) {
  if (!output || typeof output !== 'string') return null;

  // 1. Parsing direct du format JSON renvoyé par "playit tunnels list"
  try {
    const data = JSON.parse(output.trim());
    if (data && Array.isArray(data.tunnels) && data.tunnels.length > 0) {
      for (const t of data.tunnels) {
        // Recherche du domaine dans toutes les variantes du schéma Playit
        const domain = (t.domain && t.domain.name) ||
                       (t.alloc && t.alloc.data && (t.alloc.data.assigned_srv || t.alloc.data.assigned_domain)) ||
                       (t.alloc && (t.alloc.assigned_srv || t.alloc.assigned_domain)) ||
                       t.custom_domain ||
                       t.assigned_domain;
        if (domain) {
          // Pour les domaines avec SRV automatique (ex: *.tun.ply.gg, *.joinmc.link), pas besoin de port
          if (domain.endsWith('.tun.ply.gg') || domain.endsWith('.joinmc.link')) {
            return domain;
          }

          let port = null;
          if (t.alloc && t.alloc.data && t.alloc.data.port_start) port = t.alloc.data.port_start;
          else if (t.alloc && t.alloc.port) port = t.alloc.port;
          else if (t.port) port = t.port;
          else if (t.server && t.server.port) port = t.server.port;

          if (port && port !== 25565 && !domain.includes(':')) {
            return `${domain}:${port}`;
          }
          return domain;
        }
      }
    }
  } catch (e) {}

  // 2. Recherche regex sur les domaines Playit / JoinMC / Ply
  const match = output.match(/([a-zA-Z0-9_\.\-]+\.(?:joinmc\.link|ply\.gg|playit\.gg)(?::\d+)?)/i);
  if (match && match[1] && !match[1].startsWith('api.playit.gg')) {
    return match[1];
  }

  // 3. Format tabulaire texte
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Error') || trimmed.startsWith('Notice') || trimmed.startsWith('{') || trimmed.startsWith('}')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 4 && (parts[1] === 'tcp' || parts[1] === 'udp' || parts[1] === 'both')) {
      return parts[3];
    }
  }

  return null;
}

function getTunnelMetadataPath(serverId) {
  return path.join(getServerFolderPath(serverId), 'tunnel.json');
}

function readSavedTunnel(serverId) {
  try {
    const p = getTunnelMetadataPath(serverId);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function writeSavedTunnel(serverId, data) {
  try {
    const p = getTunnelMetadataPath(serverId);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

function clearSavedTunnel(serverId) {
  try {
    const p = getTunnelMetadataPath(serverId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {}
}

function isPidRunning(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Arrêt forcé garanti d'un processus et de ses sous-processus (Windows et macOS/Linux)
function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      child_process.execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (e) {
        child_process.execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      }
    }
  } catch (e) {}
}

// Libération automatique d'un port réseau en conflit (Windows netstat ou macOS/Linux lsof)
function freePortIfOccupied(port) {
  if (!port) return;
  try {
    if (process.platform === 'win32') {
      const netstatOut = child_process.execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const lines = netstatOut.trim().split(/\r?\n/);
      for (const l of lines) {
        if (l.includes('LISTENING')) {
          const parts = l.trim().split(/\s+/);
          const p = parseInt(parts[parts.length - 1], 10);
          if (p && isPidRunning(p) && p !== process.pid) {
            killProcessTree(p);
          }
        }
      }
    } else {
      const lsofOut = child_process.execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (lsofOut) {
        const pids = lsofOut.split(/\r?\n/);
        for (const pStr of pids) {
          const p = parseInt(pStr.trim(), 10);
          if (p && isPidRunning(p) && p !== process.pid) {
            killProcessTree(p);
          }
        }
      }
    }
  } catch (e) {}
}

// ============================================================================
// MODULE RÉSEAU : UPNP DIRECT (0 MS DÉTOUR, LATENCE NATIVE 5-15 MS)
// ============================================================================

let cachedUPnPGateway = null;

function getLocalIpForGateway(gatewayIp) {
  const ifaces = os.networkInterfaces();
  const gwParts = (gatewayIp || '').split('.');

  // 1. Chercher d'abord une interface dans le MEME sous-reseau (ex: 192.168.1.X)
  if (gwParts.length === 4) {
    const subnet = `${gwParts[0]}.${gwParts[1]}.${gwParts[2]}.`;
    for (const name of Object.keys(ifaces)) {
      for (const net of ifaces[name]) {
        if (net.family === 'IPv4' && !net.internal && net.address.startsWith(subnet)) {
          return net.address;
        }
      }
    }
  }

  // 2. Sur macOS, prioriser les interfaces physiques standard (en0 Wi-Fi/Ethernet)
  const prioritizedNames = ['en0', 'en1', 'eth0', 'wlan0', 'Ethernet', 'Wi-Fi'];
  for (const name of prioritizedNames) {
    if (ifaces[name]) {
      for (const net of ifaces[name]) {
        if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('127.')) {
          return net.address;
        }
      }
    }
  }

  // 3. Ignorer les interfaces virtuelles classiques (utun, bridge, awdl, llw, vbox, docker)
  for (const name of Object.keys(ifaces)) {
    const low = name.toLowerCase();
    if (low.startsWith('utun') || low.startsWith('bridge') || low.startsWith('awdl') || low.startsWith('llw') || low.startsWith('vbox') || low.startsWith('docker')) {
      continue;
    }
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('127.')) {
        return net.address;
      }
    }
  }

  // 4. Fallback
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function verifyGatewayReachable(gw) {
  if (!gw || !gw.host || !gw.controlPath) return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = http.request({
      hostname: gw.host,
      port: gw.port || 80,
      path: gw.controlPath,
      method: 'GET',
      timeout: 800
    }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 600);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function discoverUPnPGateway(timeoutMs = 5000) {
  // Verification rapide du cache memoire
  if (cachedUPnPGateway) {
    const isAlive = await verifyGatewayReachable(cachedUPnPGateway);
    if (isAlive) {
      cachedUPnPGateway.localIp = getLocalIpForGateway(cachedUPnPGateway.host);
      return cachedUPnPGateway;
    }
    cachedUPnPGateway = null;
  }

  return new Promise((resolve, reject) => {
    let client = null;
    let resolved = false;
    let timer = null;
    let burstTimers = [];

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      burstTimers.forEach(t => clearTimeout(t));
      burstTimers = [];
      if (client) {
        try { client.close(); } catch (e) {}
        client = null;
      }
    };

    try {
      client = dgram.createSocket('udp4');
    } catch (err) {
      return reject(new Error('Impossible d\'initialiser le socket UDP local: ' + err.message));
    }

    const query = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 2\r\n' +
      'ST: ssdp:all\r\n\r\n'
    );

    client.on('message', (msg, rinfo) => {
      const str = msg.toString();
      const locMatch = str.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
      if (locMatch && !resolved) {
        const loc = locMatch[1].trim();
        try {
          const parsedUrl = new URL(loc);
          http.get(loc, (res) => {
            let xml = '';
            res.on('data', c => xml += c);
            res.on('end', () => {
              const serviceMatch = xml.match(/<serviceType>(urn:schemas-upnp-org:service:(?:WANIPConnection|WANPPPConnection):[12])<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
              if (serviceMatch && !resolved) {
                resolved = true;
                cleanup();
                let controlPath = serviceMatch[2].trim();
                if (!controlPath.startsWith('/')) controlPath = '/' + controlPath;
                const gwObj = {
                  host: parsedUrl.hostname,
                  port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 80,
                  controlPath: controlPath,
                  serviceType: serviceMatch[1].trim(),
                  localIp: getLocalIpForGateway(parsedUrl.hostname)
                };
                cachedUPnPGateway = gwObj;
                resolve(gwObj);
              }
            });
          }).on('error', () => {});
        } catch (e) {}
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    });

    client.bind(0, () => {
      const sendQuery = () => {
        if (!resolved && client) {
          try {
            client.send(query, 0, query.length, 1900, '239.255.255.250');
          } catch (e) {}
        }
      };

      sendQuery();
      // Repetition des requetes SSDP (200ms et 500ms) pour eviter toute perte sur Wi-Fi
      burstTimers.push(setTimeout(sendQuery, 200));
      burstTimers.push(setTimeout(sendQuery, 500));
    });

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Aucun routeur UPnP detecte sur votre reseau local (delai depasse).'));
      }
    }, timeoutMs);
  });
}

function sendUPnPSoap(gateway, action, innerXml) {
  return new Promise((resolve, reject) => {
    const soapBody =
      '<?xml version="1.0"?>\r\n' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">\r\n' +
      '<s:Body>\r\n' +
      `<u:${action} xmlns:u="${gateway.serviceType}">\r\n` +
      innerXml +
      `</u:${action}>\r\n` +
      '</s:Body>\r\n' +
      '</s:Envelope>';

    const req = http.request({
      hostname: gateway.host,
      port: gateway.port,
      path: gateway.controlPath,
      method: 'POST',
      headers: {
        'SOAPAction': `"${gateway.serviceType}#${action}"`,
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': Buffer.byteLength(soapBody)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Erreur SOAP HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(soapBody);
    req.end();
  });
}

async function getUPnPExternalIP(gateway) {
  const data = await sendUPnPSoap(gateway, 'GetExternalIPAddress', '');
  const m = data.match(/<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/);
  if (m && m[1]) return m[1].trim();
  throw new Error('Adresse IP externe introuvable dans la réponse SOAP.');
}

async function addUPnPPortMapping(gateway, externalPort, internalPort, protocol = 'TCP', description = 'DesktopServer') {
  const inner =
    '  <NewRemoteHost></NewRemoteHost>\r\n' +
    `  <NewExternalPort>${externalPort}</NewExternalPort>\r\n` +
    `  <NewProtocol>${protocol.toUpperCase()}</NewProtocol>\r\n` +
    `  <NewInternalPort>${internalPort}</NewInternalPort>\r\n` +
    `  <NewInternalClient>${gateway.localIp}</NewInternalClient>\r\n` +
    '  <NewEnabled>1</NewEnabled>\r\n' +
    `  <NewPortMappingDescription>${description}</NewPortMappingDescription>\r\n` +
    '  <NewLeaseDuration>0</NewLeaseDuration>\r\n';

  await sendUPnPSoap(gateway, 'AddPortMapping', inner);
  return true;
}

async function deleteUPnPPortMapping(gateway, externalPort, protocol = 'TCP') {
  const inner =
    '  <NewRemoteHost></NewRemoteHost>\r\n' +
    `  <NewExternalPort>${externalPort}</NewExternalPort>\r\n` +
    `  <NewProtocol>${protocol.toUpperCase()}</NewProtocol>\r\n`;

  await sendUPnPSoap(gateway, 'DeletePortMapping', inner);
  return true;
}

function isPrivateOrCGNAT(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const trimmed = ip.trim();
  return /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|127\.)/.test(trimmed);
}

async function testNetworkCompatibility(testPort = 25565) {
  // Si au moins un serveur a deja une redirection UPnP active, la compatibilite routeur est confirmee a 100%
  if (activeUPnPMappings.size > 0) {
    const firstActive = activeUPnPMappings.values().next().value;
    if (firstActive && firstActive.gateway) {
      return {
        compatible: true,
        publicIp: firstActive.publicIp,
        gatewayHost: firstActive.gateway.host,
        localIp: firstActive.gateway.localIp
      };
    }
  }

  let gateway = null;
  try {
    gateway = await discoverUPnPGateway(5000);
  } catch (err) {
    return {
      compatible: false,
      reason: 'no_upnp',
      message: 'Votre box Internet ne répond pas aux requêtes UPnP automatiques. L\'option UPnP est peut-être désactivée dans l\'interface de votre box.'
    };
  }

  let publicIp = null;
  try {
    publicIp = await getUPnPExternalIP(gateway);
  } catch (err) {
    return {
      compatible: false,
      reason: 'ip_error',
      message: 'Impossible de récupérer votre adresse IP externe depuis votre routeur: ' + err.message
    };
  }

  if (isPrivateOrCGNAT(publicIp)) {
    return {
      compatible: false,
      reason: 'cgnat',
      publicIp,
      message: 'Votre opérateur utilise une adresse IP partagée (CGNAT). Votre box n\'a pas d\'adresse IPv4 publique dédiée, ce qui empêche les connexions directes entrantes.'
    };
  }

  // Ne JAMAIS tester ou ecraser un port utilise par un serveur actif
  const activePorts = new Set();
  for (const entry of activeUPnPMappings.values()) {
    if (entry.port) activePorts.add(entry.port);
  }

  // Utiliser des ports ephemeres dedies aux diagnostics pour eviter tout conflit avec 25565+
  const candidatePorts = [58941, 58942, 58943, 58944, 58945];
  let mappingTested = false;
  let lastError = null;

  for (const candPort of candidatePorts) {
    if (activePorts.has(candPort)) continue;
    try {
      try { await deleteUPnPPortMapping(gateway, candPort, 'TCP'); } catch (e) {}
      await addUPnPPortMapping(gateway, candPort, candPort, 'TCP', 'DesktopServer Test');
      await deleteUPnPPortMapping(gateway, candPort, 'TCP');
      mappingTested = true;
      break;
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  if (!mappingTested) {
    const isConflict = lastError && lastError.message && (lastError.message.includes('ConflictInMappingEntry') || lastError.message.includes('718'));
    if (isConflict) {
      return {
        compatible: true,
        publicIp,
        gatewayHost: gateway.host,
        localIp: gateway.localIp
      };
    }
    return {
      compatible: false,
      reason: 'mapping_failed',
      publicIp,
      message: 'Le routeur a refusé l\'ouverture du port test via UPnP: ' + (lastError ? lastError.message : 'Erreur inconnue')
    };
  }

  return {
    compatible: true,
    publicIp,
    gatewayHost: gateway.host,
    localIp: gateway.localIp
  };
}

// ============================================================================
// MODULE DUCKDNS : NOM DE DOMAINE STATIQUE AUTOMATIQUE
// ============================================================================

function updateDuckDNS(subdomain, token, ip = '') {
  return new Promise((resolve) => {
    const cleanSub = String(subdomain || '').trim().toLowerCase().replace(/\.duckdns\.org$/i, '');
    const cleanToken = String(token || '').trim();

    if (!cleanSub || !cleanToken) {
      return resolve({ success: false, error: 'Sous-domaine ou token DuckDNS manquant.' });
    }

    const queryIp = ip ? `&ip=${encodeURIComponent(ip)}` : '';
    const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(cleanSub)}&token=${encodeURIComponent(cleanToken)}${queryIp}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const body = data.trim();
        if (body === 'OK') {
          resolve({
            success: true,
            fullDomain: `${cleanSub}.duckdns.org`,
            message: 'Domaine DuckDNS mis à jour avec succès.'
          });
        } else {
          resolve({
            success: false,
            error: `DuckDNS a rejeté la mise à jour (réponse: "${body}"). Vérifiez l'exactitude de votre token et sous-domaine.`
          });
        }
      });
    }).on('error', (err) => {
      resolve({ success: false, error: 'Erreur de connexion DuckDNS: ' + err.message });
    });
  });
}

// ============================================================================
// MODULE PINGGY : RELAIS AUTOMATIQUE DE SECOURS SANS CONFIGURATION (~20 ms)
// ============================================================================

function startPinggyTunnel(serverId, localPort = 25565) {
  stopPinggyTunnel(serverId);

  const sshBin = process.platform === 'win32' ? 'ssh.exe' : 'ssh';
  const args = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=NUL',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-p', '443',
    `-R0:localhost:${localPort}`,
    'tcp@a.pinggy.io'
  ];

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-stdout', {
      serverId,
      text: `[DesktopServer] Démarrage du relais automatique Pinggy (~20 ms)...\n`
    });
  }

  const proc = child_process.spawn(sshBin, args, {
    shell: false,
    windowsHide: true
  });

  const tunnelData = {
    proc,
    publicAddress: null,
    type: 'pinggy'
  };
  activePinggyTunnels.set(serverId, tunnelData);

  const handleOutput = (text) => {
    const match = text.match(/tcp:\/\/([a-zA-Z0-9\.\-]+:\d+)/) ||
                  text.match(/([a-zA-Z0-9\.\-]+(?:\.run\.pinggy-free\.link|\.pinggy\.link|\.pinggy\.net|\.pinggy\.io):\d+)/);
    if (match && match[1]) {
      const addr = match[1];
      if (tunnelData.publicAddress !== addr) {
        tunnelData.publicAddress = addr;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('server-public-ip', {
            serverId,
            address: addr,
            type: 'pinggy'
          });
          mainWindow.webContents.send('server-stdout', {
            serverId,
            text: `[DesktopServer] Relais Pinggy connecté ! Adresse publique : ${addr}\n`
          });
        }
      }
    }
  };

  proc.stdout.on('data', (d) => {
    handleOutput(d.toString('utf8'));
  });

  proc.stderr.on('data', (d) => {
    handleOutput(d.toString('utf8'));
  });

  proc.on('close', () => {
    activePinggyTunnels.delete(serverId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-public-ip', { serverId, address: null, type: 'pinggy' });
    }
  });
}

function stopPinggyTunnel(serverId) {
  const t = activePinggyTunnels.get(serverId);
  if (t && t.proc && t.proc.pid) {
    killProcessTree(t.proc.pid);
  }
  activePinggyTunnels.delete(serverId);
}

// ============================================================================
// MODULE PORTMAP.IO : REPLI SSH VERS RELAIS EUROPE
// ============================================================================

function startPortmapTunnel(serverId, config, localPort = 25565) {
  stopPortmapTunnel(serverId);

  const sshHost = (config.portmapHost || '').trim();
  const sshPort = parseInt(config.portmapPort, 10) || 22;
  const remotePort = parseInt(config.portmapRemotePort, 10) || localPort;
  const sshUser = (config.portmapUser || '').trim();
  const keyPath = (config.portmapKeyPath || '').trim();

  if (!sshHost || !sshUser) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-stdout', {
        serverId,
        text: `[DesktopServer] Configuration Portmap.io incomplète (hôte ou identifiant manquant).\n`
      });
    }
    return;
  }

  const args = [
    '-N',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-R', `${remotePort}:localhost:${localPort}`,
    '-p', String(sshPort),
    `${sshUser}@${sshHost}`
  ];

  if (keyPath && fs.existsSync(keyPath)) {
    args.unshift('-i', keyPath);
  }

  const sshBin = process.platform === 'win32' ? 'ssh.exe' : 'ssh';

  const proc = child_process.spawn(sshBin, args, {
    shell: false,
    windowsHide: true
  });

  const publicAddress = `${sshHost}:${remotePort}`;
  const tunnelData = {
    proc,
    publicAddress,
    type: 'portmap'
  };
  activePortmapTunnels.set(serverId, tunnelData);

  proc.stderr.on('data', (d) => {
    const text = d.toString('utf8');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-stdout', { serverId, text: `[Portmap.io] ${text}` });
    }
  });

  proc.on('close', () => {
    activePortmapTunnels.delete(serverId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-public-ip', { serverId, address: null });
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-public-ip', {
      serverId,
      address: publicAddress,
      type: 'portmap'
    });
    mainWindow.webContents.send('server-stdout', {
      serverId,
      text: `[DesktopServer] Tunnel Portmap.io permanent actif ! Adresse de connexion : ${publicAddress}\n`
    });
  }
}

function stopPortmapTunnel(serverId) {
  const t = activePortmapTunnels.get(serverId);
  if (t && t.proc && t.proc.pid) {
    killProcessTree(t.proc.pid);
  }
  activePortmapTunnels.delete(serverId);
}

// ============================================================================
// GESTION GLOBALE DU CYCLE DE VIE RÉSEAU DES SERVEURS
// ============================================================================

async function activateServerNetworking(serverId, serverPort, serverData) {
  let mode = serverData ? (serverData.networkMode || 'upnp') : 'upnp';
  if (mode === 'playit') mode = 'pinggy';

  if (mode === 'upnp') {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-stdout', {
          serverId,
          text: `[DesktopServer] Ouverture automatique du port ${serverPort} sur votre box via UPnP direct...\n`
        });
      }

      const gateway = await discoverUPnPGateway(5000);
      try {
        await deleteUPnPPortMapping(gateway, serverPort, 'TCP');
      } catch (e) {}
      await addUPnPPortMapping(gateway, serverPort, serverPort, 'TCP', `DesktopServer ${serverId}`);
      const publicIp = await getUPnPExternalIP(gateway);

      let publicAddress = '';
      if (serverData && serverData.duckdnsDomain && serverData.duckdnsToken) {
        const cleanSub = serverData.duckdnsDomain.trim().toLowerCase().replace(/\.duckdns\.org$/i, '');
        const res = await updateDuckDNS(cleanSub, serverData.duckdnsToken, publicIp);
        if (res.success) {
          publicAddress = `${cleanSub}.duckdns.org${serverPort === 25565 ? '' : ':' + serverPort}`;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server-stdout', {
              serverId,
              text: `[DesktopServer] Domaine permanent DuckDNS actif (5-15 ms) : ${publicAddress}\n`
            });
          }
        } else {
          publicAddress = `${publicIp}${serverPort === 25565 ? '' : ':' + serverPort}`;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server-stdout', {
              serverId,
              text: `[DesktopServer] Avertissement DuckDNS : ${res.error}\nConnexion directe par IP : ${publicAddress}\n`
            });
          }
        }
      } else {
        publicAddress = `${publicIp}${serverPort === 25565 ? '' : ':' + serverPort}`;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('server-stdout', {
            serverId,
            text: `[DesktopServer] Connexion directe UPnP active (0 ms détour, 5-15 ms) : ${publicAddress}\n`
          });
        }
      }

      let duckTimer = null;
      if (serverData && serverData.duckdnsDomain && serverData.duckdnsToken) {
        duckTimer = setInterval(async () => {
          try {
            const currentIp = await getUPnPExternalIP(gateway);
            const entry = activeUPnPMappings.get(serverId);
            if (entry && entry.publicIp !== currentIp) {
              entry.publicIp = currentIp;
              const cleanSub = serverData.duckdnsDomain.trim().toLowerCase().replace(/\.duckdns\.org$/i, '');
              await updateDuckDNS(cleanSub, serverData.duckdnsToken, currentIp);
              console.log(`[DuckDNS] IP publique mise à jour automatiquement vers ${currentIp}`);
            }
          } catch (e) {}
        }, 5 * 60 * 1000);
      }

      activeUPnPMappings.set(serverId, {
        gateway,
        port: serverPort,
        publicIp,
        publicAddress,
        duckTimer
      });

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-public-ip', {
          serverId,
          address: publicAddress,
          type: 'upnp'
        });
      }
    } catch (err) {
      console.error('Erreur activation UPnP:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-stdout', {
          serverId,
          text: `[DesktopServer] Erreur UPnP : ${err.message}\n`
        });
      }
    }
  } else if (mode === 'pinggy') {
    startPinggyTunnel(serverId, serverPort);
  } else if (mode === 'portmap') {
    startPortmapTunnel(serverId, serverData, serverPort);
  } else if (mode === 'playit') {
    startPlayitTunnel(serverId, serverPort);
  }
}

async function deactivateServerNetworking(serverId) {
  // 1. Fermeture UPnP
  const upnp = activeUPnPMappings.get(serverId);
  if (upnp) {
    if (upnp.duckTimer) clearInterval(upnp.duckTimer);
    try {
      await deleteUPnPPortMapping(upnp.gateway, upnp.port, 'TCP');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-stdout', {
          serverId,
          text: `[DesktopServer] Port ${upnp.port} refermé sur votre box Internet.\n`
        });
      }
    } catch (e) {}
    activeUPnPMappings.delete(serverId);
  }

  // 2. Arrêt Pinggy
  stopPinggyTunnel(serverId);

  // 3. Arrêt Portmap.io
  stopPortmapTunnel(serverId);

  // 4. Arrêt Playit.gg
  stopPlayitTunnel(serverId, false);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-public-ip', {
      serverId,
      address: null
    });
  }
}

// Système de tunnel permanent Playit.gg (IP/domaine fixe *.joinmc.link sans limite de temps)
async function startPlayitTunnel(serverId, port = 25565) {
  // 1. Vérifier si un tunnel est déjà actif en mémoire pour ce serveur
  const current = activeTunnels.get(serverId);
  if (current && current.proc && isPidRunning(current.proc.pid)) {
    if (current.publicAddress && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-public-ip', {
        serverId,
        address: current.publicAddress,
        type: 'playit'
      });
    }
    if (current.claimUrl && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-playit-claim-needed', {
        serverId,
        claimUrl: current.claimUrl,
        state: current.claimState || 'claim'
      });
    }
    return;
  }

  // 2. Nettoyage préventif de tout ancien processus orphelin
  const saved = readSavedTunnel(serverId);
  if (saved && saved.pid && isPidRunning(saved.pid)) {
    if (saved.publicAddress) {
      // Si une adresse publique valide existe déjà, réattacher
      const tunnelData = {
        proc: {
          pid: saved.pid,
          kill: (sig) => {
            try { process.kill(saved.pid, sig || 'SIGKILL'); } catch (e) {}
          }
        },
        publicAddress: saved.publicAddress,
        claimUrl: null,
        claimState: 'claim',
        type: 'playit',
        port
      };
      activeTunnels.set(serverId, tunnelData);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-public-ip', {
          serverId,
          address: saved.publicAddress,
          type: 'playit'
        });
        mainWindow.webContents.send('server-stdout', {
          serverId,
          text: `[DesktopServer] Tunnel Playit.gg permanent actif : ${saved.publicAddress}\n`
        });
      }
      return;
    } else {
      // Processus orphelin sans adresse résolue -> arrêt forcé
      killProcessTree(saved.pid);
    }
  }

  const serverFolder = getServerFolderPath(serverId);
  const secretPath = path.join(serverFolder, 'playit_secret.txt');
  const logPath = path.join(serverFolder, 'playit.log');

  // Synchronisation garantie de la clé secrète entre playit_secret.txt et server.json
  syncServerSecret(serverFolder, serverId);

  let binPath;
  try {
    binPath = await ensurePlayitBinary();
  } catch (err) {
    console.error('Erreur binaire Playit:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-stdout', {
        serverId,
        text: `[DesktopServer] Erreur : Binaire Playit.gg introuvable (${err.message}).\n`
      });
    }
    return;
  }

  stopPlayitTunnel(serverId, false);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-stdout', {
      serverId,
      text: `[DesktopServer] Initialisation du tunnel permanent Playit.gg...\n`
    });
  }

  let logFd = null;
  try {
    logFd = fs.openSync(logPath, 'w');
  } catch (e) {}

  const args = ['--secret_path', secretPath, '-s', 'start'];
  const proc = child_process.spawn(binPath, args, {
    shell: false,
    detached: true,
    stdio: logFd ? ['ignore', logFd, logFd] : ['ignore', 'pipe', 'pipe']
  });
  proc.on('error', (err) => {
    console.error(`[DesktopServer] Erreur processus Playit (${serverId}):`, err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-stdout', {
        serverId,
        text: `[DesktopServer] Erreur tunnel Playit: ${err.message}\n`
      });
    }
  });
  proc.unref();
  if (logFd) {
    try { fs.closeSync(logFd); } catch (e) {}
  }

  const tunnelData = {
    proc,
    publicAddress: saved ? saved.publicAddress : null,
    claimUrl: null,
    claimState: 'claim',
    port,
    type: 'playit'
  };
  activeTunnels.set(serverId, tunnelData);

  const applyPublicAddress = (addr) => {
    if (!addr || tunnelData.publicAddress === addr) return;
    tunnelData.publicAddress = addr;
    tunnelData.claimUrl = null;
    writeSavedTunnel(serverId, {
      pid: proc.pid,
      publicAddress: addr,
      secretPath,
      port,
      type: 'playit'
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-public-ip', {
        serverId,
        address: addr,
        type: 'playit'
      });
      mainWindow.webContents.send('server-playit-claim-needed', {
        serverId,
        claimUrl: null
      });
      mainWindow.webContents.send('server-stdout', {
        serverId,
        text: `[DesktopServer] Tunnel Playit.gg permanent actif ! Adresse de connexion : ${addr}\n`
      });
    }
  };

  const resolveTunnelsList = () => {
    try {
      if (!fs.existsSync(secretPath) || fs.statSync(secretPath).size < 5) return;
      child_process.execFile(binPath, ['--secret_path', secretPath, 'tunnels', 'list'], (err, stdout) => {
        if (!err && stdout) {
          const addr = parsePlayitTunnels(stdout);
          if (addr) {
            applyPublicAddress(addr);
          } else {
            // Clé valide mais aucun tunnel configuré sur Playit
            if (!tunnelData.publicAddress) {
              tunnelData.claimUrl = 'https://playit.gg/account/tunnels';
              tunnelData.claimState = 'add_tunnel';
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-playit-claim-needed', {
                  serverId,
                  claimUrl: 'https://playit.gg/account/tunnels',
                  state: 'add_tunnel'
                });
              }
            }
          }
        }
      });
    } catch (e) {}
  };

  // Si la clé existe déjà, interroger la liste des tunnels
  if (fs.existsSync(secretPath) && fs.statSync(secretPath).size > 5) {
    setTimeout(resolveTunnelsList, 1500);
  }

  let pollCount = 0;
  const pollTimer = setInterval(() => {
    pollCount++;
    if (!activeTunnels.has(serverId) || !isPidRunning(proc.pid)) {
      clearInterval(pollTimer);
      return;
    }

    try {
      let hasSecret = fs.existsSync(secretPath) && fs.statSync(secretPath).size > 20;

      // Lecture des logs de Playit
      if (fs.existsSync(logPath)) {
        const text = fs.readFileSync(logPath, 'utf8');

        // Détection d'une clé révoquée ou invalide
        if (text.includes('InvalidAgentKey') || text.includes('Auth(InvalidAgentKey)')) {
          try { fs.unlinkSync(secretPath); } catch (e) {}
          clearSavedTunnel(serverId);
          tunnelData.publicAddress = null;
          hasSecret = false;
        }

        // 1. Détection du lien d'association unique UNIQUEMENT si la clé secrète n'existe pas encore
        if (!hasSecret) {
          const claimMatch = text.match(/https:\/\/playit\.gg\/claim\/([a-zA-Z0-9]+)/i);
          if (claimMatch && !tunnelData.publicAddress) {
            const claimUrl = claimMatch[0];
            if (tunnelData.claimUrl !== claimUrl) {
              tunnelData.claimUrl = claimUrl;
              tunnelData.claimState = 'claim';
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-playit-claim-needed', {
                  serverId,
                  claimUrl,
                  state: 'claim'
                });
                mainWindow.webContents.send('server-stdout', {
                  serverId,
                  text: `[DesktopServer] Association Playit requise : ${claimUrl}\n`
                });
              }
            }
          }
        }
      }

      // 2. Dès que le secret est présent, synchroniser et résoudre le tunnel
      if (hasSecret) {
        syncServerSecret(serverFolder, serverId);

        // Si l'adresse n'est pas encore résolue, vérifier les tunnels toutes les 3 secondes
        if (!tunnelData.publicAddress && pollCount % 3 === 0) {
          resolveTunnelsList();
        }
      }
    } catch (e) {}
  }, 1000);

  proc.on('close', () => {
    clearInterval(pollTimer);
    activeTunnels.delete(serverId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-public-ip', {
        serverId,
        address: null
      });
      mainWindow.webContents.send('server-playit-claim-needed', {
        serverId,
        claimUrl: null
      });
    }
    // Reconnexion automatique si le serveur Minecraft tourne toujours
    if (activeProcesses.has(serverId)) {
      setTimeout(() => {
        if (activeProcesses.has(serverId) && !activeTunnels.has(serverId)) {
          startPlayitTunnel(serverId, port);
        }
      }, 4000);
    }
  });
}

function stopPlayitTunnel(serverId, forceKill = false) {
  const t = activeTunnels.get(serverId);
  if (t && t.proc && t.proc.pid) {
    killProcessTree(t.proc.pid);
  }
  activeTunnels.delete(serverId);
  if (forceKill) {
    clearSavedTunnel(serverId);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-public-ip', {
      serverId,
      address: null
    });
    mainWindow.webContents.send('server-playit-claim-needed', {
      serverId,
      claimUrl: null
    });
  }
}

// Téléchargement sécurisé gérant les redirections HTTP/HTTPS et transferts chunked
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: { 'User-Agent': 'DesktopServer/1.0 (Minecraft Server Manager)' }
    };

    client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) {
          const u = new URL(url);
          loc = u.protocol + '//' + u.host + loc;
        }
        return downloadFile(loc, destPath, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Échec du téléchargement (${res.statusCode})`));
      }

      const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
      let downloadedBytes = 0;
      let lastProgressTime = 0;

      const fileStream = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (onProgress && (now - lastProgressTime > 150)) {
          lastProgressTime = now;
          if (totalBytes > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            onProgress(percent, (downloadedBytes / (1024 * 1024)).toFixed(1), (totalBytes / (1024 * 1024)).toFixed(1));
          } else {
            const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
            onProgress(null, mb, '...');
          }
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });

      fileStream.on('error', (err) => {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
        reject(err);
      });
    }).on('error', reject);
  });
}

function createWindow() {
  const iconIco = path.join(__dirname, 'assets', 'icon.ico');
  const iconPng = path.join(__dirname, 'assets', 'icon.png');
  const windowIcon = (process.platform === 'win32' && fs.existsSync(iconIco))
    ? iconIco
    : (fs.existsSync(iconPng) ? iconPng : undefined);

  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 840,
    minHeight: 560,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    frame: !isMac ? false : true,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    backgroundColor: '#ffffff',
    show: false,
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      updateTrayMenu();
    }
  });

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-is-maximized', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-is-maximized', false);
    }
  });
}

const TRAY_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAV0lEQVR4nO3TywkAMAgDUKft/hvYe2nBFD+ICXiUvIOKMC2yVL+mpNQF410OIaLKzYjZgMsCmnMPQxBAQPQHENASUH6EBAwDPBA5H0BABgJKabkXhumQDWu5qauMiPr7AAAAAElFTkSuQmCC';

function getTrayImage() {
  const trayPath = path.join(__dirname, 'assets', 'tray-icon.png');
  if (fs.existsSync(trayPath)) {
    const img = nativeImage.createFromPath(trayPath);
    if (!img.isEmpty()) return img;
  }
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24, quality: 'best' });
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'));
}

function createTray() {
  if (tray) return;

  const image = getTrayImage();
  tray = new Tray(image);
  tray.setToolTip('DesktopServer - Serveurs en arrière-plan');

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const runningCount = activeProcesses.size;
  const runningNames = [];
  for (const serverId of activeProcesses.keys()) {
    try {
      const srvJson = JSON.parse(fs.readFileSync(path.join(getServerFolderPath(serverId), 'server.json'), 'utf8'));
      runningNames.push(srvJson.name || serverId);
    } catch (e) {
      runningNames.push(serverId);
    }
  }

  const statusLabel = runningCount > 0
    ? `Serveurs actifs (${runningCount}): ${runningNames.slice(0, 2).join(', ')}${runningNames.length > 2 ? '...' : ''}`
    : 'Aucun serveur actif';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir DesktopServer',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: statusLabel,
      enabled: false
    },
    {
      label: 'Nouveau serveur...',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('nav-to-tab', 'create');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Arrêter tous les serveurs et quitter (Shut down)',
      click: async () => {
        await shutdownAllAndQuit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

async function shutdownAllAndQuit() {
  isQuitting = true;
  isShuttingDownAll = true;

  // Arrêt propre des serveurs Minecraft uniquement (pour sauvegarder le monde)
  // Les tunnels SSH détachés restent actifs en arrière-plan pour conserver la même IP publique
  for (const [serverId, proc] of activeProcesses.entries()) {
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write('stop\n');
      } else {
        proc.kill('SIGTERM');
      }
    } catch (e) {}
  }

  if (activeProcesses.size > 0) {
    let waited = 0;
    while (activeProcesses.size > 0 && waited < 4000) {
      await new Promise(r => setTimeout(r, 200));
      waited += 200;
    }
    for (const [serverId, proc] of activeProcesses.entries()) {
      if (proc && proc.pid) {
        killProcessTree(proc.pid);
      }
    }
  }

  activeProcesses.clear();

  if (tray) {
    tray.destroy();
    tray = null;
  }

  app.quit();
}

// IPC : Contrôles de fenêtre
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    if (!isQuitting) {
      mainWindow.hide();
      updateTrayMenu();
    } else {
      mainWindow.close();
    }
  }
});

// --- FONCTION UTILITAIRE : Requête JSON avec support des redirections ---
function fetchJson(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Trop de redirections'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'DesktopServer/1.0 (Minecraft Server Manager)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} sur ${url}`));
      }
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function getFallbackVersions() {
  return {
    latestRelease: '26.2',
    releases: [
      '26.2', '26.1', '26.0',
      '1.21.4', '1.21.3', '1.21.1', '1.21',
      '1.20.6', '1.20.4', '1.20.1', '1.20',
      '1.19.4', '1.19.2', '1.18.2', '1.17.1',
      '1.16.5', '1.15.2', '1.14.4', '1.13.2',
      '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.8'
    ]
  };
}

// IPC : Récupération en temps réel des versions officielles depuis l'API Mojang
ipcMain.handle('get-minecraft-versions', async () => {
  try {
    const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    let latestRelease = manifest.latest?.release || '1.21.4';
    if (isMacOlderThanBigSur()) {
      latestRelease = '1.21.4';
    }
    const releases = manifest.versions.filter(v => v.type === 'release').map(v => v.id);
    return { latestRelease, releases };
  } catch (e) {
    const fb = getFallbackVersions();
    if (isMacOlderThanBigSur()) fb.latestRelease = '1.21.4';
    return fb;
  }
});

// IPC : Récupération dynamique des versions Minecraft compatibles par moteur
ipcMain.handle('get-engine-versions', async (event, engineType) => {
  try {
    switch (engineType) {
      case 'Paper': {
        const data = await fetchJson('https://fill.papermc.io/v3/projects/paper');
        const vers = Object.values(data.versions)
          .flat()
          .filter(v => !v.includes('-rc') && !v.includes('-pre') && !v.includes('-dev'));
        return { latestRelease: vers[0] || '1.21.4', releases: vers };
      }
      case 'Spigot': {
        const fallbackSpigotVersions = [
          '1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.2', '1.20.1',
          '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4',
          '1.13.2', '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.8'
        ];
        try {
          const data = await fetchJson('https://api.github.com/repos/BaldGang/spigot-build/releases/latest');
          const vers = (data.assets || [])
            .map(a => a.name.match(/^spigot-(.+)\.jar$/)?.[1])
            .filter(v => v && !v.includes('-rc') && !v.includes('-pre'));
          if (vers.length > 0) {
            const sorted = vers.sort((a, b) => {
              const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
              for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                const diff = (pb[i] || 0) - (pa[i] || 0);
                if (diff !== 0) return diff;
              }
              return 0;
            });
            const latest = sorted.find(v => v.startsWith('1.21')) || sorted[0] || '1.21.4';
            return { latestRelease: latest, releases: sorted };
          }
        } catch (e) {
          console.warn('Erreur récupération versions Spigot via GitHub, utilisation liste de secours:', e.message);
        }
        return { latestRelease: '1.21.4', releases: fallbackSpigotVersions };
      }
      case 'Purpur': {
        const data = await fetchJson('https://api.purpurmc.org/v2/purpur');
        const vers = [...data.versions].reverse();
        return { latestRelease: vers[0] || '1.21.4', releases: vers };
      }
      case 'Folia': {
        const data = await fetchJson('https://fill.papermc.io/v3/projects/folia');
        const vers = Object.values(data.versions)
          .flat()
          .filter(v => !v.includes('-rc') && !v.includes('-pre') && !v.includes('-dev'));
        return { latestRelease: vers[0] || '1.21.4', releases: vers };
      }
      case 'Fabric': {
        const data = await fetchJson('https://meta.fabricmc.net/v2/versions/game');
        const vers = data.filter(v => v.stable).map(v => v.version);
        return { latestRelease: vers[0] || '1.21.4', releases: vers };
      }
      case 'Forge': {
        const data = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
        const versions = new Set();
        Object.keys(data.promos || {}).forEach(k => {
          const v = k.replace(/-recommended$/, '').replace(/-latest$/, '');
          if (/^[0-9]+(\.[0-9]+)+$/.test(v)) versions.add(v);
        });
        const sorted = Array.from(versions).sort((a, b) => {
          const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pb[i] || 0) - (pa[i] || 0);
            if (diff !== 0) return diff;
          }
          return 0;
        });
        return { latestRelease: sorted[0] || '1.20.1', releases: sorted };
      }
      case 'NeoForge': {
        const data = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
        const mcMap = new Map();
        (data.versions || []).forEach(v => {
          const parts = v.split('.');
          if (parts.length >= 3) {
            let mcVer = parseInt(parts[0]) >= 26 ? `${parts[0]}.${parts[1]}` : `1.${parts[0]}.${parts[1]}`;
            if (!mcVer.includes('w')) mcMap.set(mcVer, v);
          }
        });
        const sorted = Array.from(mcMap.keys()).sort((a, b) => {
          const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pb[i] || 0) - (pa[i] || 0);
            if (diff !== 0) return diff;
          }
          return 0;
        });
        return { latestRelease: sorted[0] || '1.21.1', releases: sorted };
      }
      case 'Mohist': {
        const data = await fetchJson('https://mohistmc.com/api/v2/projects/mohist');
        const vers = [...(data.versions || [])].reverse();
        return { latestRelease: vers[0] || '1.20.1', releases: vers };
      }
      case 'Banner': {
        const data = await fetchJson('https://mohistmc.com/api/v2/projects/banner');
        const vers = (data.versions || []).filter(v => !v.includes('hack')).reverse();
        return { latestRelease: vers[0] || '1.21.4', releases: vers };
      }
      case 'Arclight': {
        const vers = ['1.21.1', '1.21', '1.20.4', '1.20.2', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.16.5', '1.15.2', '1.14.4'];
        return { latestRelease: '1.21.1', releases: vers };
      }
      case 'Vanilla':
      default: {
        const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
        const latestRelease = manifest.latest?.release || '1.21.4';
        const releases = manifest.versions.filter(v => v.type === 'release').map(v => v.id);
        return { latestRelease, releases };
      }
    }
  } catch (err) {
    console.warn(`Erreur récupération versions pour ${engineType}, fallback Vanilla:`, err.message);
    return getFallbackVersions();
  }
});

// Récupération du binaire serveur Vanilla officiel (Mojang Piston)
async function getVanillaServerUrl(version) {
  const manifestData = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  const vEntry = manifestData.versions.find(x => x.id === version);
  if (!vEntry) throw new Error(`Version Minecraft ${version} introuvable.`);

  const versionPackage = await fetchJson(vEntry.url);
  const serverUrl = versionPackage.downloads?.server?.url;
  if (!serverUrl) throw new Error(`Aucun binaire serveur disponible pour la version ${version}.`);

  return serverUrl;
}

// Résolution automatique pour Paperclip legacy (1.8 à 1.16)
async function ensureLegacyPaperclipFix(folderPath, mcVersion, onProgress) {
  const isOldVersion = mcVersion && (
    mcVersion.startsWith('1.8') || 
    mcVersion.startsWith('1.9') || 
    mcVersion.startsWith('1.10') || 
    mcVersion.startsWith('1.11') || 
    mcVersion.startsWith('1.12') || 
    mcVersion.startsWith('1.13') || 
    mcVersion.startsWith('1.14') || 
    mcVersion.startsWith('1.15') || 
    mcVersion.startsWith('1.16')
  );

  if (!isOldVersion) return;

  const cacheDir = path.join(folderPath, 'cache');
  const originalJarPath = path.join(cacheDir, 'original.jar');
  const patchedJarPath = path.join(cacheDir, 'patched.jar');

  if (fs.existsSync(patchedJarPath) || fs.existsSync(originalJarPath)) {
    return;
  }

  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (onProgress) {
      onProgress('Préparation du socle officiel 1.8-1.16...');
    }

    const vanillaUrl = await getVanillaServerUrl(mcVersion);
    if (vanillaUrl) {
      await downloadFile(vanillaUrl, originalJarPath);
    }
  } catch (err) {
    console.warn('Note: Pré-téléchargement du cache Paperclip non effectué:', err);
  }
}

// Résolution de l'URL de téléchargement direct pour les moteurs standard
async function resolveEngineDownloadUrl(type, version) {
  if (type === 'Paper') {
    const paperUrl = `https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`;
    const builds = await fetchJson(paperUrl);
    if (Array.isArray(builds) && builds.length > 0) {
      const latest = builds[builds.length - 1];
      const dl = latest.downloads?.['server:default'] || latest.downloads?.['server:mojang'];
      if (dl && dl.url) return dl.url;
    }
  } else if (type === 'Spigot') {
    try {
      const data = await fetchJson('https://api.github.com/repos/BaldGang/spigot-build/releases/latest');
      const asset = data.assets?.find(a => a.name === `spigot-${version}.jar`);
      if (asset && asset.browser_download_url) {
        return asset.browser_download_url;
      }
    } catch (e) {
      console.warn('Erreur résolution asset Spigot GitHub:', e.message);
    }
    return `https://github.com/BaldGang/spigot-build/releases/latest/download/spigot-${version}.jar`;
  } else if (type === 'Purpur') {
    return `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
  } else if (type === 'Folia') {
    const foliaUrl = `https://fill.papermc.io/v3/projects/folia/versions/${version}/builds`;
    const builds = await fetchJson(foliaUrl);
    if (Array.isArray(builds) && builds.length > 0) {
      const latest = builds[builds.length - 1];
      const dl = latest.downloads?.['server:default'] || latest.downloads?.['server:mojang'];
      if (dl && dl.url) return dl.url;
    }
  } else if (type === 'Fabric') {
    const loaders = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
    if (Array.isArray(loaders) && loaders.length > 0) {
      const loaderVer = loaders[0].loader?.version;
      const installerVer = loaders[0].installer?.version || '1.1.2';
      return `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderVer}/${installerVer}/server/jar`;
    }
  } else if (type === 'Mohist') {
    const builds = await fetchJson(`https://mohistmc.com/api/v2/projects/mohist/${version}/builds`);
    if (builds && builds.builds && builds.builds.length > 0) {
      const latest = builds.builds[builds.builds.length - 1];
      if (latest.url) return latest.url;
    }
  } else if (type === 'Banner') {
    const builds = await fetchJson(`https://mohistmc.com/api/v2/projects/banner/${version}/builds`);
    if (builds && builds.builds && builds.builds.length > 0) {
      const latest = builds.builds[builds.builds.length - 1];
      if (latest.url) return latest.url;
    }
  } else if (type === 'Arclight') {
    const releases = await fetchJson('https://api.github.com/repos/IzzelAliz/Arclight/releases');
    for (const rel of releases) {
      if (!rel.assets) continue;
      const asset = rel.assets.find(a => a.name.includes(`-${version}-`));
      if (asset && asset.browser_download_url) {
        return asset.browser_download_url;
      }
    }
  }

  // Vanilla officiel Mojang Piston
  return await getVanillaServerUrl(version);
}

// Pré-création automatique des dossiers plugins/ et mods/ selon le moteur
function ensureEngineFolders(folderPath, type) {
  const pluginsTypes = ['Paper', 'Spigot', 'Purpur', 'Folia', 'Mohist', 'Arclight', 'Banner'];
  const modsTypes = ['Fabric', 'Forge', 'NeoForge', 'Mohist', 'Arclight', 'Banner'];

  if (pluginsTypes.includes(type)) {
    const pluginsDir = path.join(folderPath, 'plugins');
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
  }

  if (modsTypes.includes(type)) {
    const modsDir = path.join(folderPath, 'mods');
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
  }
}

// Exécution d'un installeur Java (Forge, NeoForge) avec drainage actif des flux
function runJavaInstaller(folderPath, javaExe, installerPath, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const libsDir = path.join(folderPath, 'libraries');
      if (!fs.existsSync(libsDir)) fs.mkdirSync(libsDir, { recursive: true });
    } catch (e) {}

    const jarName = path.basename(installerPath);
    const proc = child_process.spawn(javaExe, ['-jar', jarName, '--installServer'], {
      cwd: folderPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...getMacDyldEnv() },
      shell: false
    });

    let currentPct = 70;
    let lastUpdate = Date.now();
    let allStdout = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString('utf8');
      allStdout += text;
      const lines = text.split('\n').filter(Boolean);
      if (lines.length > 0 && onProgress) {
        const now = Date.now();
        if (now - lastUpdate > 500) {
          lastUpdate = now;
          if (currentPct < 96) currentPct += 1;
          const lastLine = lines[lines.length - 1].trim();
          let statusText = 'Génération du socle serveur...';
          if (lastLine.includes('Patching')) {
            statusText = 'Finalisation des classes Minecraft...';
          } else if (lastLine.includes('libraries') || lastLine.includes('library') || lastLine.includes('Considering')) {
            statusText = 'Installation des composants du serveur...';
          }
          onProgress(currentPct, statusText);
        }
      }
    });

    let errText = '';
    proc.stderr.on('data', (data) => {
      errText += data.toString('utf8');
    });

    proc.on('close', (code) => {
      let logHasError = false;
      const installerLogPath = path.join(folderPath, `${jarName}.log`);
      if (fs.existsSync(installerLogPath)) {
        try {
          const logContent = fs.readFileSync(installerLogPath, 'utf8');
          if (logContent.includes('There was an error during installation')) {
            logHasError = true;
          }
        } catch (e) {}
      }

      if (code === 0 && !logHasError && !allStdout.includes('There was an error during installation')) {
        resolve();
      } else {
        console.error('Erreur installeur Java:', errText || 'Échec lors de l\'installation des dépendances Forge');
        reject(new Error(`L'installeur serveur a rencontré une erreur lors de l'installation des dépendances.`));
      }
    });

    proc.on('error', (err) => {
      console.error('Erreur spawn installeur Java:', err);
      reject(err);
    });
  });
}

// Installation ou téléchargement du serveur selon le type
async function installServerEngine(folderPath, type, version, javaExe, onProgress) {
  const jarPath = path.join(folderPath, 'server.jar');

  if (type === 'Forge') {
    if (onProgress) onProgress(10, 'Recherche de la version Forge compatible...');
    const data = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const forgeVer = data.promos?.[`${version}-recommended`] || data.promos?.[`${version}-latest`];
    if (!forgeVer) throw new Error(`Aucune version Forge trouvée pour Minecraft ${version}`);

    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVer}/forge-${version}-${forgeVer}-installer.jar`;
    const installerPath = path.join(folderPath, 'installer.jar');

    if (onProgress) onProgress(25, `Téléchargement de l'installeur Forge (${forgeVer})...`);
    await downloadFile(installerUrl, installerPath, (pct, cur, tot) => {
      if (onProgress) {
        if (pct !== null) {
          onProgress(25 + Math.round(pct * 0.35), `Téléchargement de l'installeur Forge : ${pct}% (${cur}/${tot} Mo)`);
        } else {
          onProgress(45, `Téléchargement de l'installeur Forge : ${cur} Mo reçus...`);
        }
      }
    });

    if (onProgress) onProgress(65, 'Installation des composants Forge (étape 1/2)...');
    await runJavaInstaller(folderPath, javaExe, installerPath, onProgress);

    // Si version legacy (1.12.2 et antérieures), chercher et renommer universal.jar
    try {
      const files = fs.readdirSync(folderPath);
      const universalJar = files.find(f => f.startsWith(`forge-${version}`) && f.endsWith('.jar') && f !== 'installer.jar');
      if (universalJar && !fs.existsSync(jarPath)) {
        fs.copyFileSync(path.join(folderPath, universalJar), jarPath);
      }
    } catch (e) {}

    try { if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath); } catch (e) {}
    if (onProgress) onProgress(100, 'Serveur Forge configuré avec succès !');
    return;
  }

  if (type === 'NeoForge') {
    if (onProgress) onProgress(10, 'Recherche de la version NeoForge compatible...');
    const data = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    let prefix = version.startsWith('1.') ? version.slice(2) + '.' : version + '.';
    const neoVersions = (data.versions || []).filter(v => v.startsWith(prefix));
    const neoVer = neoVersions.length > 0 ? neoVersions[neoVersions.length - 1] : null;
    if (!neoVer) throw new Error(`Aucune version NeoForge trouvée pour Minecraft ${version}`);

    const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVer}/neoforge-${neoVer}-installer.jar`;
    const installerPath = path.join(folderPath, 'installer.jar');

    if (onProgress) onProgress(25, `Téléchargement de l'installeur NeoForge (${neoVer})...`);
    await downloadFile(installerUrl, installerPath, (pct, cur, tot) => {
      if (onProgress) {
        if (pct !== null) {
          onProgress(25 + Math.round(pct * 0.35), `Téléchargement de l'installeur NeoForge : ${pct}% (${cur}/${tot} Mo)`);
        } else {
          onProgress(45, `Téléchargement de l'installeur NeoForge : ${cur} Mo reçus...`);
        }
      }
    });

    if (onProgress) onProgress(65, 'Installation des composants NeoForge (étape 1/2)...');
    await runJavaInstaller(folderPath, javaExe, installerPath, onProgress);

    try { if (fs.existsSync(installerPath)) fs.unlinkSync(installerPath); } catch (e) {}
    if (onProgress) onProgress(100, 'Serveur NeoForge configuré avec succès !');
    return;
  }

  // Moteurs avec téléchargement direct de server.jar
  if (onProgress) onProgress(10, `Recherche du binaire ${type}...`);
  const jarUrl = await resolveEngineDownloadUrl(type, version);

  if (onProgress) onProgress(25, `Téléchargement de ${type} (${version})...`);
  await downloadFile(jarUrl, jarPath, (pct, cur, tot) => {
    if (onProgress) {
      if (pct !== null) {
        onProgress(25 + Math.round(pct * 0.65), `Téléchargement de ${type} : ${pct}% (${cur}/${tot} Mo)`);
      } else {
        onProgress(60, `Téléchargement de ${type} : ${cur} Mo reçus...`);
      }
    }
  });

  // Correctif Paperclip legacy pour versions 1.8-1.16 si applicable
  if (type === 'Paper' || type === 'Spigot') {
    await ensureLegacyPaperclipFix(folderPath, version, (msg) => {
      if (onProgress) onProgress(92, msg);
    });
  }

  if (onProgress) onProgress(100, `Serveur ${type} prêt !`);
}

// IPC : Liste des serveurs existants
ipcMain.handle('get-servers', async () => {
  const primaryDir = getPrimaryServersDir();
  const candidateDirs = new Set([primaryDir]);

  try {
    candidateDirs.add(path.join(app.getPath('userData'), 'servers'));
  } catch (e) {}

  try {
    candidateDirs.add(path.join(process.cwd(), 'servers'));
    candidateDirs.add(path.join(process.cwd(), 'dist', 'servers'));
    candidateDirs.add(path.join(process.cwd(), 'dist', 'win-unpacked', 'servers'));
    candidateDirs.add(path.join(path.dirname(process.execPath), 'servers'));
  } catch (e) {}

  const serversMap = new Map();

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const serverJsonPath = path.join(dir, entry.name, 'server.json');
          if (fs.existsSync(serverJsonPath)) {
            try {
              const content = fs.readFileSync(serverJsonPath, 'utf8');
              const serverData = JSON.parse(content);
              if (serverData && serverData.id && !serversMap.has(serverData.id)) {
                serverData.folderPath = path.join(dir, entry.name);
                const pidFile = path.join(serverData.folderPath, 'server.pid');
                let isRunning = activeProcesses.has(serverData.id);
                if (!isRunning && fs.existsSync(pidFile)) {
                  try {
                    const p = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
                    if (p && isPidRunning(p)) {
                      isRunning = true;
                      activeProcesses.set(serverData.id, {
                        pid: p,
                        killed: false,
                        kill: () => {
                          killProcessTree(p);
                        }
                      });
                    } else {
                      try { fs.unlinkSync(pidFile); } catch (e) {}
                    }
                  } catch (e) {}
                }
                serverData.status = isRunning ? 'running' : 'stopped';

                // Adaptation automatique de tous les serveurs existants vers le tunnel optimisé à plus faible ms
                if (!serverData.tunnelRegion) {
                  serverData.tunnelRegion = 'auto';
                  try {
                    fs.writeFileSync(serverJsonPath, JSON.stringify(serverData, null, 2), 'utf8');
                  } catch (e) {}
                }

                serversMap.set(serverData.id, serverData);
              }
            } catch (err) {
              console.error(`Erreur lecture ${serverJsonPath}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Erreur parcours ${dir}:`, err);
    }
  }

  const servers = Array.from(serversMap.values());
  servers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return servers;
});

// IPC : Création de serveur avec téléchargement réel du jar
ipcMain.handle('create-server', async (event, serverData) => {
  const serversDir = getPrimaryServersDir();
  const id = serverData.id || ('server_' + Date.now());
  const folderPath = path.join(serversDir, id);

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // Attribution d'un port reseau sans collision (garantit l'unicite pour l'UPnP multi-serveurs)
  let assignedPort = serverData.port ? parseInt(serverData.port, 10) : 25565;
  try {
    const existingDirs = fs.readdirSync(serversDir);
    const takenPorts = new Set();
    for (const d of existingDirs) {
      if (d === id) continue;
      const sJson = path.join(serversDir, d, 'server.json');
      if (fs.existsSync(sJson)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(sJson, 'utf8'));
          if (parsed.port) takenPorts.add(parseInt(parsed.port, 10));
        } catch (e) {}
      }
    }
    while (takenPorts.has(assignedPort)) {
      assignedPort++;
    }
  } catch (e) {}

  const completeData = {
    ...serverData,
    id,
    folderPath,
    port: assignedPort,
    createdAt: serverData.createdAt || Date.now(),
    status: 'stopped',
    startupJar: serverData.startupJar || 'server.jar',
    ramMin: serverData.ramMin || '1G',
    ramMax: serverData.ramMax || '2G',
    networkMode: serverData.networkMode || 'upnp'
  };

  // 1. Écriture immédiate de server.json
  fs.writeFileSync(path.join(folderPath, 'server.json'), JSON.stringify(completeData, null, 2), 'utf8');

  // 2. Fichier server.properties
  const serverProperties = [
    `# Fichier de configuration DesktopServer`,
    `server-port=${completeData.port || 25565}`,
    `max-players=${completeData.maxPlayers || 20}`,
    `motd=${completeData.description || completeData.name || 'Minecraft Server'}`,
    `difficulty=easy`,
    `gamemode=survival`,
    `pvp=true`,
    `online-mode=true`
  ].join('\n');

  fs.writeFileSync(path.join(folderPath, 'server.properties'), serverProperties, 'utf8');

  // 3. Fichier eula.txt (acceptation automatique EULA)
  fs.writeFileSync(path.join(folderPath, 'eula.txt'), 'eula=true\n', 'utf8');

  // 4. Pré-création automatique des dossiers de plugins et mods
  ensureEngineFolders(folderPath, completeData.type);

  try {
    // 5. Configuration immédiate du runtime Java approprié (réutilise si déjà installé)
    const javaExe = await getOrInstallJavaRuntime(completeData.version, (percent, cur, total, msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          serverId: id,
          percent: Math.round(percent * 0.3),
          message: msg
        });
      }
    });

    completeData.javaPath = javaExe;
    completeData.javaVersion = getRequiredJavaVersion(completeData.version);

    // 6. Installation ou téléchargement du moteur serveur
    await installServerEngine(folderPath, completeData.type, completeData.version, javaExe, (percent, msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          serverId: id,
          percent: 30 + Math.round(percent * 0.7),
          message: msg
        });
      }
    });

    fs.writeFileSync(path.join(folderPath, 'server.json'), JSON.stringify(completeData, null, 2), 'utf8');
  } catch (downloadErr) {
    console.error('Erreur téléchargement / installation serveur:', downloadErr);
    throw downloadErr;
  }

  return completeData;
});

// Fonction interne : Démarrage réel du serveur Minecraft avec Java
async function startServerInternal(serverId) {
  if (activeProcesses.has(serverId)) {
    return { success: true, message: 'Le serveur est déjà en cours d\'exécution.' };
  }

  const folderPath = getServerFolderPath(serverId);

  // Récupérer les métadonnées pour connaître la version, le type, le runtime Java, le JAR de démarrage et la RAM
  let mcVersion = '1.21.4';
  let serverType = 'Vanilla';
  let configuredJava = null;
  let startupJar = 'server.jar';
  let ramMin = '1G';
  let ramMax = '2G';
  try {
    const json = JSON.parse(fs.readFileSync(path.join(folderPath, 'server.json'), 'utf8'));
    mcVersion = json.version || '1.21.4';
    serverType = json.type || 'Vanilla';
    configuredJava = json.javaPath;
    if (json.startupJar) startupJar = json.startupJar;
    if (json.ramMin) ramMin = json.ramMin;
    if (json.ramMax) ramMax = json.ramMax;
  } catch (e) {}

  const runBatPath = path.join(folderPath, 'run.bat');
  const runShPath = path.join(folderPath, 'run.sh');

  // Détection des fichiers args Forge / NeoForge dans libraries
  const findArgsFile = (dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const found = findArgsFile(full);
          if (found) return found;
        } else if (e.name === 'win_args.txt' || e.name === 'unix_args.txt') {
          return full;
        }
      }
    } catch (err) {}
    return null;
  };

  const librariesDir = path.join(folderPath, 'libraries');
  const argsFile = fs.existsSync(librariesDir) ? findArgsFile(librariesDir) : null;
  const hasForgeLauncher = Boolean(argsFile || fs.existsSync(runBatPath) || fs.existsSync(runShPath));

  // Vérifier si le JAR configuré est un shim/installeur non exécutable seul ou le mode automatique
  const isShimOrAuto = !startupJar || startupJar === 'server.jar' || startupJar.includes('auto') || startupJar.includes('Automatique') || startupJar.endsWith('-shim.jar') || startupJar === 'installer.jar';

  let targetJar = startupJar || 'server.jar';
  let jarPath = path.join(folderPath, targetJar);

  // Déterminer si nous devons utiliser le lanceur Forge moderne (argsFile ou run.bat / run.sh)
  const useForgeLauncher = hasForgeLauncher && (isShimOrAuto || serverType === 'Forge' || serverType === 'NeoForge' || !fs.existsSync(jarPath));

  if (!useForgeLauncher && !fs.existsSync(jarPath) && fs.existsSync(path.join(folderPath, 'server.jar'))) {
    targetJar = 'server.jar';
    jarPath = path.join(folderPath, 'server.jar');
  }

  if (!useForgeLauncher && !fs.existsSync(jarPath)) {
    return { success: false, error: `Fichier serveur introuvable (${targetJar}, script ou configuration manquante).` };
  }

  // S'assurer que eula.txt est présent
  fs.writeFileSync(path.join(folderPath, 'eula.txt'), 'eula=true\n', 'utf8');

  // Correctif Paperclip 1.8-1.16 si applicable
  if (serverType === 'Spigot' || serverType === 'Paper') {
    await ensureLegacyPaperclipFix(folderPath, mcVersion);
  }

  // Détermination de l'exécutable Java adapté (avec réutilisation ou installation automatique)
  const reqJavaVer = getRequiredJavaVersion(mcVersion);
  let javaCmd = 'java';
  let isConfiguredJavaValid = false;

  if (configuredJava && (configuredJava === 'java' || fs.existsSync(configuredJava))) {
    const currentDedicated = findExistingJavaRuntime(reqJavaVer);
    if (currentDedicated && (configuredJava === currentDedicated || configuredJava.includes(`java-${reqJavaVer}`))) {
      isConfiguredJavaValid = true;
    } else if (configuredJava === 'java') {
      const sysMajor = getSystemJavaMajorVersion();
      if (sysMajor && sysMajor >= reqJavaVer) {
        isConfiguredJavaValid = true;
      }
    } else if (configuredJava.includes(`java-${reqJavaVer}`)) {
      isConfiguredJavaValid = true;
    }
  }

  if (isConfiguredJavaValid) {
    javaCmd = configuredJava;
  } else {
    javaCmd = await getOrInstallJavaRuntime(mcVersion, (percent, cur, total, msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-stdout', {
          serverId,
          text: `[DesktopServer] ${msg}\n`
        });
      }
    });
    try {
      const json = JSON.parse(fs.readFileSync(path.join(folderPath, 'server.json'), 'utf8'));
      json.javaPath = javaCmd;
      json.javaVersion = reqJavaVer;
      fs.writeFileSync(path.join(folderPath, 'server.json'), JSON.stringify(json, null, 2), 'utf8');
    } catch (e) {}
  }

  if (process.platform === 'darwin') {
    javaCmd = ensureMacJavaRunner(javaCmd);
  }

  let launchCmd = javaCmd;
  let launchArgs = [`-Xms${ramMin}`, `-Xmx${ramMax}`, '-jar', targetJar, 'nogui'];
  let launchEnv = { ...process.env };

  // Priorité au lanceur moderne Forge/NeoForge (win_args.txt / unix_args.txt ou run.bat / run.sh)
  if (useForgeLauncher) {
    if (argsFile) {
      const relArgsPath = path.relative(folderPath, argsFile).replace(/\\/g, '/');
      launchCmd = javaCmd;
      launchArgs = [`-Xms${ramMin}`, `-Xmx${ramMax}`, `@${relArgsPath}`, 'nogui'];
    } else if (process.platform === 'win32' && fs.existsSync(runBatPath)) {
      launchCmd = 'cmd.exe';
      launchArgs = ['/c', 'run.bat', 'nogui'];
      const javaDir = path.dirname(javaCmd);
      launchEnv = {
        ...process.env,
        PATH: `${javaDir};${process.env.PATH || ''}`,
        JAVA_HOME: path.dirname(javaDir)
      };
    } else if (fs.existsSync(runShPath)) {
      try { fs.chmodSync(runShPath, 0o755); } catch (e) {}
      launchCmd = '/bin/bash';
      launchArgs = ['run.sh', 'nogui'];
      const javaDir = path.dirname(javaCmd);
      launchEnv = {
        ...process.env,
        PATH: `${javaDir}:${process.env.PATH || ''}`,
        JAVA_HOME: path.dirname(javaDir)
      };
    }
  }

  // Sécurisation anti-conflit de verrou de monde (session.lock) et de port réseau
  const serverPidFile = path.join(folderPath, 'server.pid');
  if (fs.existsSync(serverPidFile)) {
    try {
      const savedPid = parseInt(fs.readFileSync(serverPidFile, 'utf8'), 10);
      if (savedPid && isPidRunning(savedPid)) {
        killProcessTree(savedPid);
        await new Promise(r => setTimeout(r, 800));
      }
      try { fs.unlinkSync(serverPidFile); } catch (e) {}
    } catch (e) {}
  }

  let serverPort = 25565;
  let serverData = {};
  try {
    const json = JSON.parse(fs.readFileSync(path.join(folderPath, 'server.json'), 'utf8'));
    if (json) {
      serverData = json;
      if (json.port) serverPort = json.port;
    }
  } catch (e) {}

  freePortIfOccupied(serverPort);

  if (process.platform === 'darwin') {
    Object.assign(launchEnv, getMacDyldEnv());
    if (launchCmd.endsWith('.sh')) {
      launchArgs = [launchCmd, ...launchArgs];
      launchCmd = '/bin/sh';
    }
  }

  try {
    const proc = child_process.spawn(launchCmd, launchArgs, {
      cwd: folderPath,
      env: launchEnv,
      shell: false
    });

    activeProcesses.set(serverId, proc);
    try {
      fs.writeFileSync(serverPidFile, String(proc.pid), 'utf8');
    } catch (e) {}
    updateTrayMenu();

    // Activation de la connexion mondiale (UPnP direct, Portmap.io ou Playit.gg)
    activateServerNetworking(serverId, serverPort, serverData);

    proc.stdout.on('data', (data) => {
      const text = data.toString('utf8');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-stdout', { serverId, text });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString('utf8');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-stderr', { serverId, text });
      }
    });

    proc.on('close', (code) => {
      activeProcesses.delete(serverId);
      try {
        if (fs.existsSync(serverPidFile)) fs.unlinkSync(serverPidFile);
      } catch (e) {}
      deactivateServerNetworking(serverId);
      updateTrayMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-stopped', { serverId, code });
      }
    });

    return { success: true };
  } catch (err) {
    console.error('Erreur lancement processus Java:', err);
    return { success: false, error: err.message };
  }
}

// Fonction interne : Arrêt propre du serveur Minecraft
async function stopServerInternal(serverId) {
  const proc = activeProcesses.get(serverId);
  const serverPidFile = path.join(getServerFolderPath(serverId), 'server.pid');
  try { if (fs.existsSync(serverPidFile)) fs.unlinkSync(serverPidFile); } catch (e) {}
  if (proc) {
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write('stop\n');
      } else {
        proc.kill('SIGTERM');
      }
      return { success: true };
    } catch (e) {
      proc.kill('SIGKILL');
      return { success: true };
    }
  }
  return { success: false, error: 'Serveur non actif.' };
}

// Fonction interne : Arrêt forcé immédiat (Kill) du processus et des sous-processus
async function killServerInternal(serverId) {
  const proc = activeProcesses.get(serverId);
  const serverPidFile = path.join(getServerFolderPath(serverId), 'server.pid');
  try { if (fs.existsSync(serverPidFile)) fs.unlinkSync(serverPidFile); } catch (e) {}
  if (proc) {
    try {
      killProcessTree(proc.pid);
    } catch (err) {
      console.error('Erreur killServerInternal:', err);
    }
    deactivateServerNetworking(serverId);
    activeProcesses.delete(serverId);
    updateTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-stopped', { serverId, code: 137 });
    }
    return { success: true };
  }
  return { success: false, error: 'Serveur non actif.' };
}

// Fonction interne : Redémarrage propre avec repli forcé
async function restartServerInternal(serverId) {
  const proc = activeProcesses.get(serverId);
  if (proc) {
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write('stop\n');
      } else {
        proc.kill('SIGTERM');
      }
    } catch (e) {
      proc.kill('SIGKILL');
    }

    let waited = 0;
    while (activeProcesses.has(serverId) && waited < 8000) {
      await new Promise(r => setTimeout(r, 200));
      waited += 200;
    }

    if (activeProcesses.has(serverId)) {
      await killServerInternal(serverId);
    }
  }

  await new Promise(r => setTimeout(r, 600));
  return startServerInternal(serverId);
}

// IPC : Contrôles d'exécution du serveur
ipcMain.handle('start-server', async (event, serverId) => startServerInternal(serverId));
ipcMain.handle('stop-server', async (event, serverId) => stopServerInternal(serverId));
ipcMain.handle('kill-server', async (event, serverId) => killServerInternal(serverId));
ipcMain.handle('restart-server', async (event, serverId) => restartServerInternal(serverId));

// IPC : Envoi d'une commande dans le terminal Minecraft
ipcMain.handle('send-server-command', async (event, { serverId, command }) => {
  const proc = activeProcesses.get(serverId);
  if (proc && proc.stdin && !proc.stdin.destroyed) {
    proc.stdin.write(command.trim() + '\n');
    return true;
  }
  return false;
});

// IPC : Récupérer l'IP publique active pour un serveur (UPnP, DuckDNS, Portmap, Playit)
ipcMain.handle('get-server-public-ip', (event, serverId) => {
  // 1. UPnP direct
  const upnp = activeUPnPMappings.get(serverId);
  if (upnp && upnp.publicAddress) {
    return {
      address: upnp.publicAddress,
      type: 'upnp'
    };
  }

  // 2. Pinggy automatique
  const pinggy = activePinggyTunnels.get(serverId);
  if (pinggy && pinggy.publicAddress) {
    return {
      address: pinggy.publicAddress,
      type: 'pinggy'
    };
  }

  // 3. Portmap.io
  const portmap = activePortmapTunnels.get(serverId);
  if (portmap && portmap.publicAddress) {
    return {
      address: portmap.publicAddress,
      type: 'portmap'
    };
  }

  // 3. Playit.gg
  const t = activeTunnels.get(serverId);
  if (t && t.publicAddress) {
    return {
      address: t.publicAddress,
      claimUrl: null,
      type: 'playit'
    };
  }
  const saved = readSavedTunnel(serverId);
  if (saved && saved.publicAddress) {
    return {
      address: saved.publicAddress,
      claimUrl: null,
      type: 'playit'
    };
  }
  if (t && t.claimUrl) {
    return {
      address: null,
      claimUrl: t.claimUrl,
      claimState: t.claimState || 'claim',
      type: 'playit'
    };
  }

  // 4. Si serveur arrêté, retourner le domaine configuré depuis server.json
  try {
    const srv = JSON.parse(fs.readFileSync(path.join(getServerFolderPath(serverId), 'server.json'), 'utf8'));
    if (srv && srv.networkMode === 'upnp' && srv.duckdnsDomain) {
      const cleanSub = srv.duckdnsDomain.trim().toLowerCase().replace(/\.duckdns\.org$/i, '');
      const port = srv.port || 25565;
      return {
        address: `${cleanSub}.duckdns.org${port === 25565 ? '' : ':' + port}`,
        type: 'upnp'
      };
    } else if (srv && srv.networkMode === 'portmap' && srv.portmapHost && srv.portmapRemotePort) {
      return {
        address: `${srv.portmapHost}:${srv.portmapRemotePort}`,
        type: 'portmap'
      };
    }
  } catch (e) {}

  return null;
});

// IPC : Performances et métriques en temps réel du serveur (RAM, CPU, cœurs, système)
ipcMain.handle('get-server-performance', async (event, serverId) => {
  const cpuInfo = getSystemAndCoreCpuUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let isRunning = false;
  let pid = null;
  let serverMemory = 0;
  let serverCpu = 0;
  let uptime = 0;

  const proc = activeProcesses.get(serverId);
  if (proc && proc.pid && isPidRunning(proc.pid)) {
    isRunning = true;
    pid = proc.pid;
  } else if (serverId) {
    try {
      const folderPath = getServerFolderPath(serverId);
      const pidFile = path.join(folderPath, 'server.pid');
      if (fs.existsSync(pidFile)) {
        const savedPid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
        if (savedPid && isPidRunning(savedPid)) {
          isRunning = true;
          pid = savedPid;
        }
      }
    } catch (e) {}
  }

  if (isRunning && pid) {
    try {
      const stats = await pidusage(pid);
      if (stats) {
        serverMemory = stats.memory || 0;
        serverCpu = Math.round((stats.cpu || 0) * 10) / 10;
        uptime = Math.round((stats.elapsed || 0) / 1000);
      }
    } catch (err) {
      // Processus terminé ou inaccessible
    }
  }

  return {
    isRunning,
    pid,
    uptime,
    serverMemory,
    serverCpu,
    systemMemoryTotal: totalMem,
    systemMemoryUsed: usedMem,
    systemMemoryFree: freeMem,
    systemCpu: cpuInfo.systemCpu,
    cpuModel: cpuInfo.cpuModel,
    coreCount: cpuInfo.coreCount,
    coreUsages: cpuInfo.coreUsages
  };
});

// IPC : Espace de stockage consommé par le dossier du serveur
ipcMain.handle('get-server-storage', async (event, serverId) => {
  if (!serverId) return { totalSize: 0, breakdown: { world: 0, plugins: 0, mods: 0, logs: 0, jars: 0, other: 0 } };
  try {
    const folderPath = getServerFolderPath(serverId);
    return await calculateDirectorySizeAndBreakdown(folderPath);
  } catch (err) {
    return { totalSize: 0, breakdown: { world: 0, plugins: 0, mods: 0, logs: 0, jars: 0, other: 0 } };
  }
});

// IPC : Tester la compatibilité UPnP de la connexion
ipcMain.handle('test-network-compatibility', async (event, serverId) => {
  let port = 25565;
  if (serverId) {
    try {
      const folder = getServerFolderPath(serverId);
      const srv = JSON.parse(fs.readFileSync(path.join(folder, 'server.json'), 'utf8'));
      if (srv && srv.port) port = parseInt(srv.port, 10);
    } catch (e) {}
  }
  return await testNetworkCompatibility(port);
});

// IPC : Enregistrer la configuration réseau d'un serveur
ipcMain.handle('save-server-network-config', async (event, { serverId, config }) => {
  try {
    const folder = getServerFolderPath(serverId);
    const srvPath = path.join(folder, 'server.json');
    if (fs.existsSync(srvPath)) {
      const srv = JSON.parse(fs.readFileSync(srvPath, 'utf8'));
      Object.assign(srv, config);
      srv.networkConfigured = true;
      fs.writeFileSync(srvPath, JSON.stringify(srv, null, 2), 'utf8');

      // Si le serveur est en cours d'exécution, réactiver le réseau avec les nouveaux paramètres
      if (activeProcesses.has(serverId)) {
        await deactivateServerNetworking(serverId);
        await activateServerNetworking(serverId, srv.port || 25565, srv);
      }

      return { success: true, server: srv };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
  return { success: false, error: 'Serveur introuvable' };
});

// IPC : Tester la mise à jour d'un sous-domaine DuckDNS
ipcMain.handle('test-duckdns', async (event, { domain, token }) => {
  let currentIp = '';
  if (activeUPnPMappings.size > 0) {
    const first = activeUPnPMappings.values().next().value;
    if (first && first.publicIp) currentIp = first.publicIp;
  }
  if (!currentIp) {
    try {
      const gateway = await discoverUPnPGateway(3000);
      currentIp = await getUPnPExternalIP(gateway);
    } catch (e) {}
  }
  return await updateDuckDNS(domain, token, currentIp);
});

// IPC : Récupération rapide de l'IP publique
ipcMain.handle('get-public-ip', async () => {
  if (activeUPnPMappings.size > 0) {
    const first = activeUPnPMappings.values().next().value;
    if (first && first.publicIp) return { success: true, ip: first.publicIp };
  }
  try {
    const gateway = await discoverUPnPGateway(3000);
    const ip = await getUPnPExternalIP(gateway);
    if (ip) return { success: true, ip };
  } catch (e) {}

  try {
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.get('https://api.ipify.org?format=json', { timeout: 3500 }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (data && data.ip) resolve({ success: true, ip: data.ip });
            else resolve({ success: false });
          } catch (e) {
            resolve({ success: false });
          }
        });
      });
      req.on('error', () => resolve({ success: false }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
    });
  } catch (e) {
    return { success: false };
  }
});

// IPC : Récupérer la langue d'installation de DesktopServer
ipcMain.handle('get-initial-language', () => {
  try {
    const exeDir = path.dirname(app.getPath('exe'));
    const langFile = path.join(exeDir, 'default-language.json');
    if (fs.existsSync(langFile)) {
      const parsed = JSON.parse(fs.readFileSync(langFile, 'utf8'));
      if (parsed && parsed.language) return parsed.language;
    }
  } catch (e) {}
  try {
    const appDir = path.join(app.getAppPath(), '..', 'default-language.json');
    if (fs.existsSync(appDir)) {
      const parsed = JSON.parse(fs.readFileSync(appDir, 'utf8'));
      if (parsed && parsed.language) return parsed.language;
    }
  } catch (e) {}
  return null;
});

// IPC : Sélection d'un fichier de clé privée SSH pour Portmap.io
ipcMain.handle('select-key-file', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Sélectionner la clé privée SSH Portmap.io',
    properties: ['openFile'],
    filters: [
      { name: 'Clés SSH (*.pem, *.key, *.ppk, *.*)', extensions: ['pem', 'key', 'ppk', '*'] }
    ]
  });
  if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
    return res.filePaths[0];
  }
  return null;
});

// IPC : Ouvrir un lien externe dans le navigateur par défaut
ipcMain.handle('open-external-url', async (event, url) => {
  if (url && typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('delete-server', async (event, serverId) => {
  await deactivateServerNetworking(serverId);
  const proc = activeProcesses.get(serverId);
  if (proc) {
    try { proc.kill('SIGKILL'); } catch (e) {}
    activeProcesses.delete(serverId);
  }

  const folderPath = getServerFolderPath(serverId);
  let deleted = false;
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
    deleted = true;
  }
  return deleted;
});

function resolveSafeServerPath(serverFolder, relativePath = '') {
  const normalized = path.normalize(String(relativePath || '')).replace(/^(\.\.[\/\\])+/, '');
  const resolved = path.resolve(serverFolder, normalized);
  const base = path.resolve(serverFolder);
  if (!resolved.startsWith(base)) {
    return base;
  }
  return resolved;
}

ipcMain.handle('open-server-folder', async (event, data) => {
  const serverId = typeof data === 'object' ? data.serverId : data;
  const relativePath = typeof data === 'object' ? (data.relativePath || '') : '';
  const folderPath = getServerFolderPath(serverId);
  const target = resolveSafeServerPath(folderPath, relativePath);
  if (fs.existsSync(target)) {
    await shell.openPath(target);
    return true;
  }
  return false;
});

// Gestion des fichiers du serveur (Architecture FTP complète)
ipcMain.handle('get-server-files', async (event, data) => {
  const serverId = typeof data === 'object' ? data.serverId : data;
  const relativePath = typeof data === 'object' ? (data.relativePath || '') : '';
  const folderPath = getServerFolderPath(serverId);
  const targetDir = resolveSafeServerPath(folderPath, relativePath);

  if (!fs.existsSync(targetDir)) {
    return { currentPath: '', files: [] };
  }

  const items = fs.readdirSync(targetDir, { withFileTypes: true });
  const files = items.map((item) => {
    const fullPath = path.join(targetDir, item.name);
    let size = 0;
    let mtime = new Date();
    try {
      const stats = fs.statSync(fullPath);
      size = stats.size;
      mtime = stats.mtime;
    } catch (e) {}

    const isDir = item.isDirectory();
    const ext = isDir ? '' : path.extname(item.name).toLowerCase().replace('.', '');
    const currentRel = path.relative(folderPath, targetDir).replace(/\\/g, '/');
    const itemRel = currentRel ? `${currentRel}/${item.name}` : item.name;

    return {
      name: item.name,
      isDirectory: isDir,
      size,
      extension: ext,
      modified: mtime.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
      itemRelativePath: itemRel
    };
  });

  // Trier les dossiers en premier, puis alphabétiquement
  files.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    currentPath: path.relative(folderPath, targetDir).replace(/\\/g, '/'),
    files
  };
});

ipcMain.handle('read-server-file', async (event, data) => {
  const serverId = data.serverId;
  const relPath = data.relativeFilePath || data.fileName;
  const folderPath = getServerFolderPath(serverId);
  const filePath = resolveSafeServerPath(folderPath, relPath);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
});

ipcMain.handle('write-server-file', async (event, data) => {
  const serverId = data.serverId;
  const relPath = data.relativeFilePath || data.fileName;
  const content = data.content !== undefined ? data.content : '';
  const folderPath = getServerFolderPath(serverId);
  const filePath = resolveSafeServerPath(folderPath, relPath);
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('create-server-folder', async (event, { serverId, relativePath, folderName }) => {
  const folderPath = getServerFolderPath(serverId);
  const targetDir = resolveSafeServerPath(folderPath, relativePath);
  const cleanName = path.basename((folderName || '').trim());
  if (!cleanName) return { success: false, error: 'Nom de dossier invalide.' };
  const newDirPath = path.join(targetDir, cleanName);
  if (fs.existsSync(newDirPath)) {
    return { success: false, error: 'Un dossier portant ce nom existe déjà.' };
  }
  fs.mkdirSync(newDirPath, { recursive: true });
  return { success: true };
});

ipcMain.handle('create-server-file', async (event, { serverId, relativePath, fileName, content = '' }) => {
  const folderPath = getServerFolderPath(serverId);
  const targetDir = resolveSafeServerPath(folderPath, relativePath);
  const cleanName = path.basename((fileName || '').trim());
  if (!cleanName) return { success: false, error: 'Nom de fichier invalide.' };
  const newFilePath = path.join(targetDir, cleanName);
  if (fs.existsSync(newFilePath)) {
    return { success: false, error: 'Un fichier portant ce nom existe déjà.' };
  }
  fs.writeFileSync(newFilePath, content, 'utf8');
  return { success: true };
});

ipcMain.handle('delete-server-item', async (event, { serverId, relativePath }) => {
  const folderPath = getServerFolderPath(serverId);
  const targetPath = resolveSafeServerPath(folderPath, relativePath);
  if (targetPath === folderPath) {
    return { success: false, error: 'Impossible de supprimer la racine du serveur.' };
  }
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return { success: true };
  }
  return { success: false, error: 'Fichier ou dossier introuvable.' };
});

ipcMain.handle('rename-server-item', async (event, { serverId, oldRelativePath, newName }) => {
  const folderPath = getServerFolderPath(serverId);
  const targetPath = resolveSafeServerPath(folderPath, oldRelativePath);
  if (targetPath === folderPath) {
    return { success: false, error: 'Impossible de renommer la racine du serveur.' };
  }
  if (!fs.existsSync(targetPath)) {
    return { success: false, error: 'Élément introuvable.' };
  }
  const cleanName = path.basename((newName || '').trim());
  if (!cleanName) {
    return { success: false, error: 'Nouveau nom invalide.' };
  }
  const parentDir = path.dirname(targetPath);
  const newPath = path.join(parentDir, cleanName);
  if (fs.existsSync(newPath) && newPath !== targetPath) {
    return { success: false, error: 'Un élément portant ce nom existe déjà.' };
  }
  fs.renameSync(targetPath, newPath);
  return { success: true };
});

ipcMain.handle('import-server-files', async (event, { serverId, targetRelativePath, filePaths }) => {
  const folderPath = getServerFolderPath(serverId);
  const targetDir = resolveSafeServerPath(folderPath, targetRelativePath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let count = 0;
  if (Array.isArray(filePaths)) {
    for (const src of filePaths) {
      try {
        if (fs.existsSync(src)) {
          const dest = path.join(targetDir, path.basename(src));
          fs.cpSync(src, dest, { recursive: true });
          count++;
        }
      } catch (err) {
        console.error('Erreur import fichier:', err);
      }
    }
  }
  return { success: true, count };
});

ipcMain.handle('download-server-file', async (event, { serverId, relativeFilePath }) => {
  const folderPath = getServerFolderPath(serverId);
  const srcPath = resolveSafeServerPath(folderPath, relativeFilePath);
  if (!fs.existsSync(srcPath)) return { success: false, error: 'Fichier introuvable.' };

  const defaultName = path.basename(srcPath);
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Télécharger le fichier',
    defaultPath: defaultName
  });

  if (!saveResult.canceled && saveResult.filePath) {
    fs.copyFileSync(srcPath, saveResult.filePath);
    return { success: true, path: saveResult.filePath };
  }
  return { success: false, canceled: true };
});

ipcMain.handle('choose-files-to-upload', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Sélectionner les fichiers ou dossiers à importer',
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// IPC : Lister les fichiers JAR disponibles dans le serveur et le JAR sélectionné
ipcMain.handle('get-server-jars', async (event, serverId) => {
  const folderPath = getServerFolderPath(serverId);
  let jars = [];
  try {
    if (fs.existsSync(folderPath)) {
      const files = fs.readdirSync(folderPath, { withFileTypes: true });
      jars = files
        .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.jar'))
        .map(f => f.name)
        .filter(name => !name.endsWith('-shim.jar') && name !== 'installer.jar');
    }
  } catch (e) {
    console.error('Erreur lecture jars serveur:', e);
  }

  const hasLibraries = fs.existsSync(path.join(folderPath, 'libraries'));
  const hasRunBat = fs.existsSync(path.join(folderPath, 'run.bat'));
  const autoOption = 'Lancement automatique Forge (args / run.bat)';

  if (hasLibraries || hasRunBat) {
    jars.unshift(autoOption);
  }

  let selectedJar = (hasLibraries || hasRunBat) ? autoOption : 'server.jar';
  try {
    const srvJson = JSON.parse(fs.readFileSync(path.join(folderPath, 'server.json'), 'utf8'));
    if (srvJson.startupJar) {
      if (srvJson.startupJar.endsWith('-shim.jar') || srvJson.startupJar === 'installer.jar' || (srvJson.startupJar === 'server.jar' && (hasLibraries || hasRunBat))) {
        selectedJar = (hasLibraries || hasRunBat) ? autoOption : 'server.jar';
      } else {
        selectedJar = srvJson.startupJar;
      }
    }
  } catch (e) {}

  if (selectedJar && !jars.includes(selectedJar) && fs.existsSync(path.join(folderPath, selectedJar))) {
    jars.push(selectedJar);
  }

  return { jars, selectedJar };
});

// IPC : Sélectionner un JAR externe et l'importer dans le serveur
ipcMain.handle('select-external-jar', async (event, serverId) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Sélectionner un fichier exécutable (.jar)',
    properties: ['openFile'],
    filters: [{ name: 'Fichiers JAR (*.jar)', extensions: ['jar'] }]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const srcPath = result.filePaths[0];
  const jarName = path.basename(srcPath);
  const folderPath = getServerFolderPath(serverId);
  const destPath = path.join(folderPath, jarName);

  try {
    fs.copyFileSync(srcPath, destPath);
    const srvJsonPath = path.join(folderPath, 'server.json');
    let srv = {};
    if (fs.existsSync(srvJsonPath)) {
      try {
        srv = JSON.parse(fs.readFileSync(srvJsonPath, 'utf8'));
      } catch (e) {}
    }
    srv.startupJar = jarName;
    fs.writeFileSync(srvJsonPath, JSON.stringify(srv, null, 2), 'utf8');

    return { success: true, jarName };
  } catch (err) {
    console.error('Erreur copie jar externe:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-server-properties', async (event, serverId) => {
  const folderPath = getServerFolderPath(serverId);
  const propsPath = path.join(folderPath, 'server.properties');
  const props = {};
  if (fs.existsSync(propsPath)) {
    const lines = fs.readFileSync(propsPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex !== -1) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          props[key] = value;
        }
      }
    }
  }

  // Récupérer la région du tunnel, le JAR de démarrage et la RAM depuis server.json
  try {
    const serverJsonPath = path.join(folderPath, 'server.json');
    if (fs.existsSync(serverJsonPath)) {
      const srv = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
      props['tunnel-region'] = srv.tunnelRegion || 'auto';
      props['startup-jar'] = srv.startupJar || 'server.jar';
      props['ram-min'] = srv.ramMin || '1G';
      props['ram-max'] = srv.ramMax || '2G';
    }
  } catch (e) {}

  return props;
});

ipcMain.handle('save-server-properties', async (event, { serverId, properties }) => {
  const folderPath = getServerFolderPath(serverId);
  const propsPath = path.join(folderPath, 'server.properties');
  
  let lines = [];
  if (fs.existsSync(propsPath)) {
    lines = fs.readFileSync(propsPath, 'utf8').split('\n');
  }

  const excludedKeys = new Set(['tunnel-region', 'startup-jar', 'ram-min', 'ram-max']);
  const existingKeys = new Set();
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex !== -1) {
        const key = trimmed.substring(0, eqIndex).trim();
        existingKeys.add(key);
        if (properties[key] !== undefined && !excludedKeys.has(key)) {
          return `${key}=${properties[key]}`;
        }
      }
    }
    return line;
  });

  for (const [k, v] of Object.entries(properties)) {
    if (!excludedKeys.has(k) && !existingKeys.has(k)) {
      updatedLines.push(`${k}=${v}`);
    }
  }

  fs.writeFileSync(propsPath, updatedLines.join('\n'), 'utf8');

  // Mettre à jour server.json si des paramètres ont changé
  const serverJsonPath = path.join(folderPath, 'server.json');
  if (fs.existsSync(serverJsonPath)) {
    try {
      const srv = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
      if (properties['server-port']) srv.port = parseInt(properties['server-port'], 10);
      if (properties['max-players']) srv.maxPlayers = parseInt(properties['max-players'], 10);
      if (properties['motd']) srv.description = properties['motd'];
      if (properties['startup-jar']) srv.startupJar = properties['startup-jar'];
      if (properties['ram-min']) srv.ramMin = properties['ram-min'];
      if (properties['ram-max']) srv.ramMax = properties['ram-max'];

      const prevSecret = srv.playitSecret || '';
      if (typeof properties['playit-secret'] === 'string') {
        srv.playitSecret = properties['playit-secret'].trim();
      }
      fs.writeFileSync(serverJsonPath, JSON.stringify(srv, null, 2), 'utf8');

      // Si la clé Playit a été modifiée par l'utilisateur
      if (typeof properties['playit-secret'] === 'string' && properties['playit-secret'].trim() !== prevSecret) {
        const secretPath = path.join(folderPath, 'playit_secret.txt');
        if (srv.playitSecret) {
          fs.writeFileSync(secretPath, srv.playitSecret, 'utf8');
        } else if (fs.existsSync(secretPath)) {
          fs.unlinkSync(secretPath);
        }
        stopPlayitTunnel(serverId, true);
        if (activeProcesses.has(serverId)) {
          startPlayitTunnel(serverId, srv.port || 25565);
        }
      }
    } catch (e) {}
  }

  return true;
});

function restoreRunningTunnelsOnStartup() {
  const primaryDir = getPrimaryServersDir();
  if (!fs.existsSync(primaryDir)) return;
  try {
    const folders = fs.readdirSync(primaryDir);
    for (const folder of folders) {
      const serverId = folder;
      const saved = readSavedTunnel(serverId);
      if (saved && saved.pid && isPidRunning(saved.pid) && saved.publicAddress) {
        const tunnelData = {
          proc: {
            pid: saved.pid,
            kill: (sig) => {
              try { process.kill(saved.pid, sig || 'SIGKILL'); } catch (e) {}
            }
          },
          publicAddress: saved.publicAddress,
          type: 'playit',
          port: saved.port || 25565
        };
        activeTunnels.set(serverId, tunnelData);
      }
    }
  } catch (err) {
    console.error('Erreur restauration des tunnels au démarrage:', err);
  }
}

app.whenReady().then(() => {
  restoreRunningTunnelsOnStartup();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  for (const [id] of activeProcesses.entries()) {
    deactivateServerNetworking(id);
  }
  for (const [id] of activeUPnPMappings.entries()) {
    deactivateServerNetworking(id);
  }
  for (const [id] of activePinggyTunnels.entries()) {
    deactivateServerNetworking(id);
  }
  for (const [id] of activePortmapTunnels.entries()) {
    deactivateServerNetworking(id);
  }
  for (const [id] of activeTunnels.entries()) {
    stopPlayitTunnel(id, false);
  }
  if (isShuttingDownAll) {
    for (const [id, proc] of activeProcesses.entries()) {
      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write('stop\n');
        } else {
          proc.kill('SIGKILL');
        }
      } catch (e) {}
    }
    activeProcesses.clear();
  }
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  }
});
