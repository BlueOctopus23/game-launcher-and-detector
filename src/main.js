const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const { execFile } = require('child_process');

// ── Paths ─────────────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const DB_PATH   = path.join(USER_DATA, 'games.db');
const IS_FIRST  = !fs.existsSync(DB_PATH);

// ── Database (sql.js — puro WebAssembly, sin binarios nativos) ────────────────
let SQL, db;

function saveDB() {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDB() {
  SQL = await require('sql.js')();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      exe_path    TEXT NOT NULL UNIQUE,
      last_played TEXT,
      play_count  INTEGER DEFAULT 0,
      added_at    TEXT DEFAULT (datetime('now')),
      folder_id   INTEGER
    );
    CREATE TABLE IF NOT EXISTS folders (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      path     TEXT NOT NULL UNIQUE,
      label    TEXT,
      type     TEXT DEFAULT 'custom',
      added_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  runSave(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`, ['accent','#e84855']);
  runSave(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`, ['theme','dark']);
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    for (const k of Object.keys(r)) if (typeof r[k] === 'bigint') r[k] = Number(r[k]);
    rows.push(r);
  }
  stmt.free();
  return rows;
}
function queryGet(sql, params = []) { return queryAll(sql, params)[0] || null; }
function runSave(sql, params = []) { db.run(sql, params); saveDB(); }

// ── Known game executable names (lista negra de NO-juegos) ────────────────────
// En lugar de una lista blanca, usamos una lista NEGRA de ejecutables que
// definitivamente NO son juegos (instaladores, runtimes, herramientas, etc.)
// Esto permite detectar CUALQUIER juego nuevo automáticamente.
const NON_GAME_EXES = new Set([
  // Runtimes / redistributables
  'vc_redist.x64.exe','vc_redist.x86.exe','vcredist_x64.exe','vcredist_x86.exe',
  'dxwebsetup.exe','directx_jun2010_redist.exe',
  'dotnetfx.exe','dotnet-runtime.exe','dotnet-sdk.exe','windowsdesktop-runtime.exe',
  'oalinst.exe','openalwiz.exe',
  'physxsetup.exe','uerequisites.exe',
  // Instaladores / setup
  'setup.exe','install.exe','uninstall.exe','uninst.exe','uninstall000.exe',
  'setup_x64.exe','setup_x86.exe','installer.exe',
  'redist.exe','prerequisites.exe',
  // Herramientas del engine
  'unreal editor.exe','unrealcefsubprocess.exe','crashreportclient.exe',
  'crashpad_handler.exe','sentry_crashpad_handler.exe',
  'unitycrashhandler64.exe','unitycrashhandler32.exe',
  'unity hub.exe','unityhub.exe',
  // Anti-cheat / DRM
  'easyanticheat.exe','easyanticheat_setup.exe',
  'be_launcher.exe','battleye_launcher.exe',
  'beclient.exe','beclient_x64.exe',
  'vgc.exe','vanguard.exe',
  'faceit.exe','faceitclient.exe',
  'esportal.exe',
  // Launchers/helpers propios
  'launch.exe','launcher.exe','launcherqt.exe',
  'gameoverlayui.exe','steam.exe','steamservice.exe','steamwebhelper.exe',
  'epicgameslauncher.exe','eosoverlayrenderer.exe',
  'goggalaxy.exe','galaxyclient.exe',
  'origin.exe','eadesktop.exe','eabackgroundservice.exe',
  'bethesda.net_launcher.exe','bethesdanetlauncher.exe',
  'upc.exe','ubisoftconnect.exe','uplay.exe',
  'blizzardgame.exe',
  // Herramientas gráficas / sistema
  'dxdiag.exe','regedit.exe','cmd.exe','powershell.exe',
  'nvidia_installer.exe','nvidiaoverlaycontainer.exe',
  // CEF / chromium embebido
  'cefsharp.browsersubprocess.exe',
  'chrome_crashpad_handler.exe',
  // Otros helpers comunes
  'helper.exe','updater.exe','autoupdate.exe','patcher.exe',
  'bootstrapper.exe','dotnetcheck.exe',
  'servicehub.identityhost.exe',
  // Editores de mapa / herramientas de modding
  'worldeditor.exe','editor.exe','devtools.exe','sdk.exe',
  'hammer.exe','hammer++.exe','modtools.exe',
]);

// Palabras clave en la ruta que indican que NO es un juego jugable
const NON_GAME_PATH_KEYWORDS = [
  '\\redist\\', '\\redistributables\\', '\\prerequisites\\',
  '\\__installer\\', '\\_installer\\', '\\setup\\',
  '\\tools\\', '\\editor\\', '\\sdk\\', '\\devtools\\',
  '\\crashpad\\', '\\crashreport\\',
  '\\eac\\', '\\easyanticheat\\', '\\battleye\\',
  '\\cef\\', '\\chromium\\',
];

function isLikelyGame(filePath) {
  const name    = path.basename(filePath).toLowerCase();
  const fullLow = filePath.toLowerCase();

  if (NON_GAME_EXES.has(name)) return false;

  for (const kw of NON_GAME_PATH_KEYWORDS) {
    if (fullLow.includes(kw)) return false;
  }

  // Ignorar ejecutables muy pequeños (< 500 KB) — suelen ser helpers/shims
  try {
    const size = fs.statSync(filePath).size;
    if (size < 512 * 1024) return false;
  } catch { return false; }

  return true;
}

// ── Scanning ──────────────────────────────────────────────────────────────────

// Modo STEAM: escanea steamapps/common — cada subcarpeta es un juego.
// Busca el .exe principal de cada juego (el más grande de la raíz del juego).
function scanSteamCommon(commonPath) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(commonPath, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const gameDir  = path.join(commonPath, entry.name);
    const gameName = entry.name;

    // Candidatos: .exe en la raíz del juego
    let rootExes = [];
    try {
      rootExes = fs.readdirSync(gameDir, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.exe'))
        .map(f => path.join(gameDir, f.name))
        .filter(isLikelyGame);
    } catch { continue; }

    if (rootExes.length === 0) {
      // Si no hay exe en raíz, buscar un nivel más adentro
      try {
        const sub = fs.readdirSync(gameDir, { withFileTypes: true });
        for (const s of sub) {
          if (!s.isDirectory()) continue;
          const subDir = path.join(gameDir, s.name);
          const subExes = fs.readdirSync(subDir, { withFileTypes: true })
            .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.exe'))
            .map(f => path.join(subDir, f.name))
            .filter(isLikelyGame);
          rootExes.push(...subExes);
        }
      } catch {}
    }

    if (rootExes.length === 0) continue;

    // Elegir el .exe más grande (el ejecutable principal suele ser el más grande)
    rootExes.sort((a, b) => {
      try { return fs.statSync(b).size - fs.statSync(a).size; }
      catch { return 0; }
    });

    results.push({ name: gameName, exe_path: rootExes[0] });
  }
  return results;
}

// Modo GENÉRICO: escanea recursivamente buscando .exe que pasen el filtro
function scanGeneric(folderPath, depth = 0, maxDepth = 4) {
  const results = [];
  if (depth > maxDepth) return results;
  let entries;
  try { entries = fs.readdirSync(folderPath, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanGeneric(full, depth + 1, maxDepth));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
      if (isLikelyGame(full)) {
        results.push({ name: path.basename(full, '.exe'), exe_path: full });
      }
    }
  }
  return results;
}

// Detecta si una ruta es (o contiene) steamapps/common
function isSteamCommonFolder(folderPath) {
  const norm = folderPath.toLowerCase().replace(/\\/g, '/');
  return norm.endsWith('steamapps/common') || norm.endsWith('steamapps\\common');
}

// Encuentra steamapps/common si el usuario seleccionó una librería de Steam más arriba
function findSteamCommon(folderPath) {
  const norm = folderPath.toLowerCase();
  if (norm.includes('steamapps')) {
    // Subir hasta steamapps y bajar a common
    const parts = folderPath.split(path.sep);
    const idx   = parts.findIndex(p => p.toLowerCase() === 'steamapps');
    if (idx !== -1) {
      const candidate = path.join(...parts.slice(0, idx + 1), 'common');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  // Buscar steamapps/common dentro
  const common = path.join(folderPath, 'steamapps', 'common');
  if (fs.existsSync(common)) return common;
  const common2 = path.join(folderPath, 'common');
  if (fs.existsSync(common2) && folderPath.toLowerCase().includes('steamapps')) return common2;
  return null;
}

// ── IPC: games ────────────────────────────────────────────────────────────────
ipcMain.handle('db:getGames',    ()            => queryAll('SELECT * FROM games ORDER BY name'));
ipcMain.handle('db:addGame',     (_, {name, exe_path, folder_id}) => {
  try { runSave(`INSERT OR IGNORE INTO games(name,exe_path,folder_id) VALUES(?,?,?)`, [name, exe_path, folder_id||null]); return {ok:true}; }
  catch(e) { return {ok:false, error:e.message}; }
});
ipcMain.handle('db:removeGame',     (_, id)        => { runSave('DELETE FROM games WHERE id=?',[id]); return {ok:true}; });
ipcMain.handle('db:updateGameName', (_, {id,name}) => { runSave('UPDATE games SET name=? WHERE id=?',[name,id]); return {ok:true}; });
ipcMain.handle('db:searchGames',    (_, q)         => queryAll(`SELECT * FROM games WHERE name LIKE ? ORDER BY name`,[`%${q}%`]));

// ── IPC: folders ──────────────────────────────────────────────────────────────
ipcMain.handle('db:getFolders', () => queryAll('SELECT * FROM folders ORDER BY label'));

ipcMain.handle('db:addFolder', (_, {folderPath, type}) => {
  try {
    const label = path.basename(folderPath);
    runSave(`INSERT OR IGNORE INTO folders(path,label,type) VALUES(?,?,?)`, [folderPath, label, type||'custom']);
    const folder = queryGet('SELECT * FROM folders WHERE path=?', [folderPath]);
    return {ok:true, folder};
  } catch(e) { return {ok:false, error:e.message}; }
});

ipcMain.handle('db:removeFolder', (_, id) => { runSave('DELETE FROM folders WHERE id=?',[id]); return {ok:true}; });

// ── IPC: settings ─────────────────────────────────────────────────────────────
ipcMain.handle('db:getSetting',  (_, key)        => { const r=queryGet('SELECT value FROM settings WHERE key=?',[key]); return r?r.value:null; });
ipcMain.handle('db:setSetting',  (_, {key,value})=> { runSave(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`,[key,value]); return {ok:true}; });
ipcMain.handle('db:isFirstRun',  ()              => IS_FIRST);

// ── IPC: scan ─────────────────────────────────────────────────────────────────
ipcMain.handle('scan:folder', (_, folderPath) => {
  // Detectar si es una carpeta de Steam
  const steamCommon = findSteamCommon(folderPath);
  if (steamCommon || isSteamCommonFolder(folderPath)) {
    const target = steamCommon || folderPath;
    return { results: scanSteamCommon(target), mode: 'steam', steamCommon: target };
  }
  return { results: scanGeneric(folderPath), mode: 'generic' };
});

ipcMain.handle('scan:importResults', (_, {games, folderId}) => {
  for (const g of games) {
    db.run(`INSERT OR IGNORE INTO games(name,exe_path,folder_id) VALUES(?,?,?)`, [g.name, g.exe_path, folderId]);
  }
  saveDB();
  return {ok:true, count:games.length};
});

// ── IPC: auto-detect Steam libraries ──────────────────────────────────────────
ipcMain.handle('steam:detectLibraries', () => {
  const found = [];
  const drives = ['C','D','E','F','G'];

  for (const drive of drives) {
    const candidates = [
      `${drive}:\\Program Files (x86)\\Steam\\steamapps\\common`,
      `${drive}:\\Program Files\\Steam\\steamapps\\common`,
      `${drive}:\\Steam\\steamapps\\common`,
      `${drive}:\\SteamLibrary\\steamapps\\common`,
      `${drive}:\\Games\\Steam\\steamapps\\common`,
      `${drive}:\\Games\\SteamLibrary\\steamapps\\common`,
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) found.push(c);
    }
  }
  return found;
});

// ── IPC: launch ───────────────────────────────────────────────────────────────
ipcMain.handle('game:launch', (_, exePath) => {
  try {
    runSave(`UPDATE games SET play_count=play_count+1, last_played=datetime('now') WHERE exe_path=?`,[exePath]);
    execFile(exePath, { cwd: path.dirname(exePath), detached: true });
    return {ok:true};
  } catch(e) { return {ok:false, error:e.message}; }
});

ipcMain.handle('game:openFolder', (_, exePath) => {
  shell.showItemInFolder(exePath); return {ok:true};
});

// ── IPC: dialogs ──────────────────────────────────────────────────────────────
ipcMain.handle('dialog:selectFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:selectExe', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name:'Ejecutables', extensions:['exe'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── IPC: window ───────────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWin?.minimize());
ipcMain.on('window:maximize', () => { if(mainWin?.isMaximized()) mainWin.unmaximize(); else mainWin?.maximize(); });
ipcMain.on('window:close',    () => mainWin?.close());

// ── Window ────────────────────────────────────────────────────────────────────
let mainWin;
function createWindow() {
  mainWin = new BrowserWindow({
    width:1100, height:700, minWidth:800, minHeight:550,
    frame:false, backgroundColor:'#0d0d0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  await initDB();
  createWindow();
  app.on('activate', () => { if(BrowserWindow.getAllWindows().length===0) createWindow(); });
});
app.on('window-all-closed', () => { if(process.platform !== 'darwin') app.quit(); });
