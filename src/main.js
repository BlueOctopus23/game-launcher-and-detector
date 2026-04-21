const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path  = require('path');
const fs    = require('fs');
const { execFile } = require('child_process');

const USER_DATA  = app.getPath('userData');
const DB_PATH    = path.join(USER_DATA, 'games.db');
const COVERS_DIR = path.join(USER_DATA, 'covers');

let SQL, db;

function saveDB() {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDB() {
  SQL = await require('sql.js')();
  db  = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      exe_path    TEXT NOT NULL UNIQUE,
      cover       TEXT,
      steam_id    INTEGER,
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
  // Migrar: añadir columnas si no existen (para DBs antiguas)
  try { db.run(`ALTER TABLE games ADD COLUMN cover TEXT`);   } catch {}
  try { db.run(`ALTER TABLE games ADD COLUMN steam_id INTEGER`); } catch {}

  for (const [k, v] of [
    ['accent','#e84855'],['theme','dark'],
    ['autoscan_on_start','0'],['autoscan_admin','0'],['setup_done','0'],
  ]) db.run(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`, [k, v]);

  saveDB();
  fs.mkdirSync(COVERS_DIR, { recursive: true });
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
function runSave(sql, params = [])  { db.run(sql, params); saveDB(); }

// ── Descarga de imágenes ──────────────────────────────────────────────────────
async function downloadFile(url, dest) {
  // net.fetch uses Electron's browser stack — works where Node https fails
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buf));
}

// ── fetchJSON — net.fetch de Electron (maneja redirects, cookies, TLS) ─────
async function fetchJSON(url) {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Buscar cover por nombre ────────────────────────────────────────────────────
// Flujo: nombre → Steam storesearch (obtener appid) → descargar header.jpg de CDN
ipcMain.handle('cover:fetchByName', async (_, gameName) => {
  try {
    const safeName = String(gameName).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const dest     = path.join(COVERS_DIR, `${safeName}.jpg`);

    // Si ya existe en caché, devolverla directamente
    if (fs.existsSync(dest)) return dest;

    // 1. Buscar appid en Steam
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
    const data = await fetchJSON(searchUrl);

    let imageUrl = null;

    if (data && data.items && data.items.length > 0) {
      // Usar el primer resultado (el más relevante)
      const appid  = data.items[0].id;
      imageUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
    }

    if (!imageUrl) return null;

    // 2. Descargar la imagen
    await downloadFile(imageUrl, dest);
    return dest;

  } catch (e) {
    return null;
  }
});

// ── Lista negra ───────────────────────────────────────────────────────────────
const NON_GAME_EXES = new Set([
  'vc_redist.x64.exe','vc_redist.x86.exe','vcredist_x64.exe','vcredist_x86.exe',
  'dxwebsetup.exe','directx_jun2010_redist.exe','dotnetfx.exe','dotnet-runtime.exe',
  'dotnet-sdk.exe','windowsdesktop-runtime.exe','oalinst.exe','physxsetup.exe','uerequisites.exe',
  'setup.exe','install.exe','uninstall.exe','uninst.exe','uninstall000.exe',
  'setup_x64.exe','setup_x86.exe','installer.exe','redist.exe','prerequisites.exe',
  'unrealcefsubprocess.exe','crashreportclient.exe','crashpad_handler.exe',
  'sentry_crashpad_handler.exe','unitycrashhandler64.exe','unitycrashhandler32.exe',
  'unity hub.exe','unityhub.exe',
  'easyanticheat.exe','easyanticheat_setup.exe','be_launcher.exe','battleye_launcher.exe',
  'beclient.exe','beclient_x64.exe','vgc.exe','vanguard.exe','faceit.exe','esportal.exe',
  'launch.exe','launcher.exe','launcherqt.exe','gameoverlayui.exe',
  'steam.exe','steamservice.exe','steamwebhelper.exe',
  'epicgameslauncher.exe','eosoverlayrenderer.exe','goggalaxy.exe','galaxyclient.exe',
  'origin.exe','eadesktop.exe','eabackgroundservice.exe',
  'upc.exe','ubisoftconnect.exe','uplay.exe','blizzardgame.exe',
  'dxdiag.exe','regedit.exe','cmd.exe','powershell.exe',
  'cefsharp.browsersubprocess.exe','chrome_crashpad_handler.exe',
  'helper.exe','updater.exe','autoupdate.exe','patcher.exe','bootstrapper.exe',
  'worldeditor.exe','editor.exe','devtools.exe','sdk.exe','hammer.exe','modtools.exe',
]);
const NON_GAME_PATH_KW = [
  '\\redist\\','\\redistributables\\','\\prerequisites\\','\\__installer\\',
  '\\_installer\\','\\setup\\','\\tools\\','\\editor\\','\\sdk\\','\\devtools\\',
  '\\crashpad\\','\\crashreport\\','\\eac\\','\\easyanticheat\\','\\battleye\\',
  '\\cef\\','\\chromium\\',
];
function isLikelyGame(filePath) {
  if (NON_GAME_EXES.has(path.basename(filePath).toLowerCase())) return false;
  const low = filePath.toLowerCase();
  for (const kw of NON_GAME_PATH_KW) if (low.includes(kw)) return false;
  try { if (fs.statSync(filePath).size < 512 * 1024) return false; } catch { return false; }
  return true;
}

// ── Scanning CON TIMEOUT ──────────────────────────────────────────────────────
// El timeout evita que se quede colgado en carpetas enormes o inaccesibles

function scanWithTimeout(fn, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), timeoutMs);
    try {
      const result = fn();
      clearTimeout(timer);
      resolve(result);
    } catch {
      clearTimeout(timer);
      resolve([]);
    }
  });
}

function scanSteamCommon(commonPath) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(commonPath, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const gameDir = path.join(commonPath, entry.name);
    let exes = [];
    try {
      exes = fs.readdirSync(gameDir, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.exe'))
        .map(f => path.join(gameDir, f.name))
        .filter(isLikelyGame);
    } catch { continue; }
    if (!exes.length) {
      try {
        for (const s of fs.readdirSync(gameDir, { withFileTypes: true })) {
          if (!s.isDirectory()) continue;
          exes.push(...fs.readdirSync(path.join(gameDir, s.name), { withFileTypes: true })
            .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.exe'))
            .map(f => path.join(gameDir, s.name, f.name))
            .filter(isLikelyGame));
        }
      } catch {}
    }
    if (!exes.length) continue;
    exes.sort((a, b) => { try { return fs.statSync(b).size - fs.statSync(a).size; } catch { return 0; } });
    results.push({ name: entry.name, exe_path: exes[0] });
  }
  return results;
}

function scanGeneric(folderPath, depth = 0, maxDepth = 3) {
  const results = [];
  if (depth > maxDepth) return results;
  let entries;
  try { entries = fs.readdirSync(folderPath, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) results.push(...scanGeneric(full, depth + 1, maxDepth));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && isLikelyGame(full))
      results.push({ name: path.basename(full, '.exe'), exe_path: full });
  }
  return results;
}

function findSteamCommon(folderPath) {
  const low = folderPath.toLowerCase();
  if (low.includes('steamapps')) {
    const parts = folderPath.split(path.sep);
    const idx   = parts.findIndex(p => p.toLowerCase() === 'steamapps');
    if (idx !== -1) { const c = path.join(...parts.slice(0, idx + 1), 'common'); if (fs.existsSync(c)) return c; }
  }
  const c1 = path.join(folderPath, 'steamapps', 'common');
  if (fs.existsSync(c1)) return c1;
  return null;
}

// ── IPC: games ────────────────────────────────────────────────────────────────
ipcMain.handle('db:getGames',       ()              => queryAll('SELECT * FROM games ORDER BY name'));
ipcMain.handle('db:searchGames',    (_, q)          => queryAll('SELECT * FROM games WHERE name LIKE ? ORDER BY name', [`%${q}%`]));
ipcMain.handle('db:removeGame',     (_, id)         => { runSave('DELETE FROM games WHERE id=?', [id]); return { ok: true }; });
ipcMain.handle('db:updateGameName', (_, { id, name }) => { runSave('UPDATE games SET name=? WHERE id=?', [name, id]); return { ok: true }; });

ipcMain.handle('db:addGame', (_, { name, exe_path, folder_id, cover, steam_id }) => {
  try {
    runSave(
      `INSERT OR IGNORE INTO games(name,exe_path,folder_id,cover,steam_id) VALUES(?,?,?,?,?)`,
      [name, exe_path, folder_id || null, cover || null, steam_id || null]
    );
    // Si ya existía, actualizamos cover/steam_id si se proveen
    if (cover || steam_id) {
      if (cover)    db.run(`UPDATE games SET cover=?    WHERE exe_path=? AND cover IS NULL`,    [cover,    exe_path]);
      if (steam_id) db.run(`UPDATE games SET steam_id=? WHERE exe_path=? AND steam_id IS NULL`, [steam_id, exe_path]);
      saveDB();
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('db:updateGameCover', (_, { id, cover, steam_id, name }) => {
  const sets = [];
  const vals = [];
  if (cover)    { sets.push('cover=?');    vals.push(cover);    }
  if (steam_id) { sets.push('steam_id=?'); vals.push(steam_id); }
  if (name)     { sets.push('name=?');     vals.push(name);     }
  if (!sets.length) return { ok: false };
  vals.push(id);
  runSave(`UPDATE games SET ${sets.join(',')} WHERE id=?`, vals);
  return { ok: true };
});

// ── IPC: folders ──────────────────────────────────────────────────────────────
ipcMain.handle('db:getFolders',   ()       => queryAll('SELECT * FROM folders ORDER BY label'));
ipcMain.handle('db:removeFolder', (_, id) => { runSave('DELETE FROM folders WHERE id=?', [id]); return { ok: true }; });
ipcMain.handle('db:addFolder', (_, { folderPath, type }) => {
  try {
    const label = path.basename(folderPath) || folderPath;
    db.run(`INSERT OR IGNORE INTO folders(path,label,type) VALUES(?,?,?)`, [folderPath, label, type || 'custom']);
    saveDB();
    const folder = queryGet('SELECT * FROM folders WHERE path=?', [folderPath]);
    return { ok: true, folder };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: settings ─────────────────────────────────────────────────────────────
ipcMain.handle('db:getSetting',  (_, key)          => { const r = queryGet('SELECT value FROM settings WHERE key=?', [key]); return r ? r.value : null; });
ipcMain.handle('db:setSetting',  (_, { key, value }) => { runSave(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`, [key, value]); return { ok: true }; });
ipcMain.handle('db:isFirstRun',  ()                => { const r = queryGet(`SELECT value FROM settings WHERE key='setup_done'`); return !r || r.value !== '1'; });

// ── IPC: scan CON TIMEOUT ─────────────────────────────────────────────────────
ipcMain.handle('scan:folder', async (_, folderPath) => {
  // Verificar que la ruta existe antes de escanear
  if (!fs.existsSync(folderPath)) return { results: [], mode: 'generic' };

  const sc = findSteamCommon(folderPath);
  if (sc) {
    const results = await scanWithTimeout(() => scanSteamCommon(sc), 10000);
    return { results, mode: 'steam', steamCommon: sc };
  }
  const low = folderPath.toLowerCase().replace(/\\/g, '/');
  if (low.endsWith('steamapps/common')) {
    const results = await scanWithTimeout(() => scanSteamCommon(folderPath), 10000);
    return { results, mode: 'steam', steamCommon: folderPath };
  }
  const results = await scanWithTimeout(() => scanGeneric(folderPath), 10000);
  return { results, mode: 'generic' };
});

ipcMain.handle('scan:importResults', (_, { games, folderId }) => {
  for (const g of games)
    db.run(`INSERT OR IGNORE INTO games(name,exe_path,folder_id,cover,steam_id) VALUES(?,?,?,?,?)`,
      [g.name, g.exe_path, folderId, g.cover || null, g.steam_id || null]);
  saveDB();
  return { ok: true, count: games.length };
});

ipcMain.handle('steam:detectLibraries', () => {
  const found = [];
  for (const drive of ['C','D','E','F','G'])
    for (const p of [
      `${drive}:\\Program Files (x86)\\Steam\\steamapps\\common`,
      `${drive}:\\Program Files\\Steam\\steamapps\\common`,
      `${drive}:\\Steam\\steamapps\\common`,
      `${drive}:\\SteamLibrary\\steamapps\\common`,
      `${drive}:\\Games\\SteamLibrary\\steamapps\\common`,
    ]) if (fs.existsSync(p)) found.push(p);
  return found;
});

// ── IPC: launch ───────────────────────────────────────────────────────────────
ipcMain.handle('game:launch', (_, exePath) => {
  try {
    runSave(`UPDATE games SET play_count=play_count+1, last_played=datetime('now') WHERE exe_path=?`, [exePath]);
    execFile(exePath, { cwd: path.dirname(exePath), detached: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('game:openFolder', (_, p) => { shell.showItemInFolder(p); return { ok: true }; });

// ── IPC: dialogs ──────────────────────────────────────────────────────────────
ipcMain.handle('dialog:selectFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:selectExe', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Ejecutables', extensions: ['exe'] }] });
  return r.canceled ? null : r.filePaths[0];
});

// ── IPC: covers ───────────────────────────────────────────────────────────────
// Convertir ruta local a data URI para mostrar en renderer (contextIsolation seguro)
ipcMain.handle('cover:getDataUri', (_, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1) || 'jpg';
    return `data:image/${ext};base64,${data.toString('base64')}`;
  } catch { return null; }
});

// ── IPC: window ───────────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWin?.minimize());
ipcMain.on('window:maximize', () => { if (mainWin?.isMaximized()) mainWin.unmaximize(); else mainWin?.maximize(); });
ipcMain.on('window:close',    () => mainWin?.close());

let mainWin;
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1100, height: 700, minWidth: 800, minHeight: 550,
    frame: false, backgroundColor: '#0d0d0f',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  await initDB();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
