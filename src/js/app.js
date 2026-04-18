'use strict';
// ── State ─────────────────────────────────────────────────────────────────────
let allGames    = [];
let currentView = 'grid';
let ctxGame     = null;
let renameGame  = null;
let frFolders   = [];   // { path, type: 'steam'|'custom' }
let frStep      = 1;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  applyStoredTheme();
  bindWindowControls();
  bindNavButtons();
  bindToolbar();
  bindContextMenu();
  bindSearch();

  const firstRun = await api.isFirstRun();
  if (firstRun) {
    showFirstRun();
    autoDetectSteamForFirstRun();
  } else {
    await loadGames();
    await renderFolderSidebar();
    renderSettingsView();
  }
});

// ── Theme ─────────────────────────────────────────────────────────────────────
async function applyStoredTheme() {
  const accent = await api.getSetting('accent');
  if (accent) setAccent(accent, false);
}
function setAccent(color, save = true) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-glow', hexToRgba(color, 0.35));
  if (save) api.setSetting('accent', color);
  document.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.color === color));
}
function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Window controls ───────────────────────────────────────────────────────────
function bindWindowControls() {
  document.getElementById('btn-min').addEventListener('click',   () => api.minimize());
  document.getElementById('btn-max').addEventListener('click',   () => api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => api.close());
}

// ── Navigation ────────────────────────────────────────────────────────────────
function bindNavButtons() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}
function switchView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  if (name === 'recent')    renderRecent();
  if (name === 'favorites') renderFavorites();
  if (name === 'settings')  renderSettingsView();
  if (name === 'grid')      renderGrid(allGames);
}

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadGames() {
  allGames = await api.getGames();
  renderGrid(allGames);
  document.getElementById('game-count').textContent =
    `${allGames.length} juego${allGames.length !== 1 ? 's' : ''}`;
}

function renderGrid(games) {
  const container = document.getElementById('view-grid');
  container.innerHTML = '';
  if (games.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎮</div>
      <p>No se encontraron juegos.<br>Añade carpetas con <strong>+ Carpeta</strong> y pulsa <strong>↻ Escanear</strong>.</p>
    </div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'game-grid';
  games.forEach((g, i) => {
    const card = buildCard(g);
    card.style.animationDelay = `${Math.min(i * 18, 280)}ms`;
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

function buildCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card';
  card.dataset.id = game.id;
  const initial = (game.name || '?')[0].toUpperCase();

  card.innerHTML = `
    <div class="card-cover">
      <div class="card-initial">${initial}</div>
      ${game.play_count > 0 ? `<span class="card-badge played">×${game.play_count}</span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-name" title="${escHtml(game.name)}">${escHtml(game.name)}</div>
      <button class="card-launch">▶ JUGAR</button>
    </div>`;

  card.querySelector('.card-launch').addEventListener('click', async e => {
    e.stopPropagation();
    await api.launchGame(game.exe_path);
    toast(`Lanzando ${game.name}…`, 'success');
    setTimeout(loadGames, 1500);
  });
  card.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, game); });
  return card;
}

// ── Search ────────────────────────────────────────────────────────────────────
function bindSearch() {
  const input = document.getElementById('search-input');
  const clear = document.getElementById('search-clear');
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    clear.classList.toggle('hidden', !q);
    if (!q) { renderGrid(allGames); updateCount(allGames.length); return; }
    const res = await api.searchGames(q);
    renderGrid(res); updateCount(res.length, true);
  });
  clear.addEventListener('click', () => {
    input.value = ''; clear.classList.add('hidden');
    renderGrid(allGames); updateCount(allGames.length);
  });
}
function updateCount(n, search = false) {
  document.getElementById('game-count').textContent =
    search ? `${n} resultado${n!==1?'s':''}` : `${n} juego${n!==1?'s':''}`;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function bindToolbar() {
  document.getElementById('btn-scan').addEventListener('click',       doScan);
  document.getElementById('btn-add-folder').addEventListener('click', doAddFolder);
  document.getElementById('btn-add-exe').addEventListener('click',    doAddExe);
}

async function doAddFolder() {
  const folder = await api.selectFolder();
  if (!folder) return;
  const prog = showScanProgress('Analizando carpeta…');
  const { results, mode, steamCommon } = await api.scanFolder(folder);
  prog.remove();

  const type = mode === 'steam' ? 'steam' : 'custom';
  const savePath = steamCommon || folder;
  const res = await api.addFolder(savePath, type);
  if (!res.ok) { toast('Esa carpeta ya está añadida.', ''); return; }

  if (results.length > 0) {
    await api.importResults({ games: results, folderId: res.folder.id });
    toast(`${mode === 'steam' ? '🎮 Steam' : '📂 Carpeta'}: ${results.length} juegos encontrados`, 'success');
  } else {
    toast(`Carpeta añadida (sin juegos detectados aún).`, '');
  }
  await loadGames();
  await renderFolderSidebar();
  renderSettingsView();
}

async function doAddExe() {
  const exePath = await api.selectExe();
  if (!exePath) return;
  const name = exePath.split('\\').pop().replace(/\.exe$/i, '');
  const res  = await api.addGame({ name, exe_path: exePath });
  if (res.ok) { toast(`Añadido: ${name}`, 'success'); await loadGames(); }
  else toast('Ese juego ya está en la lista.', '');
}

async function doScan() {
  const folders = await api.getFolders();
  if (!folders.length) { toast('Añade al menos una carpeta primero.', ''); return; }

  const prog = showScanProgress('Escaneando…');
  let total = 0;
  for (const folder of folders) {
    const { results, mode } = await api.scanFolder(folder.path);
    if (results.length) {
      await api.importResults({ games: results, folderId: folder.id });
      total += results.length;
    }
  }
  prog.remove();
  toast(`Escaneo completado — ${total} juego${total!==1?'s':''} encontrado${total!==1?'s':''}.`, 'success');
  await loadGames();
}

function showScanProgress(msg) {
  const el = document.createElement('div');
  el.className = 'scan-progress';
  el.innerHTML = `<span class="sp-spin">⟳</span> ${msg}`;
  document.body.appendChild(el);
  return el;
}

// ── Folder sidebar ────────────────────────────────────────────────────────────
async function renderFolderSidebar() {
  const list = document.getElementById('folder-list-sidebar');
  list.innerHTML = '';
  const folders = await api.getFolders();
  folders.forEach(f => {
    const dot = document.createElement('div');
    dot.className = 'sidebar-folder-dot';
    const icon = f.type === 'steam' ? '🎮' : '📁';
    dot.innerHTML = `${icon}<span class="folder-tooltip">${escHtml(f.label || f.path)}</span>`;
    list.appendChild(dot);
  });
}

// ── Recent & Favorites ────────────────────────────────────────────────────────
function renderRecent() {
  const grid = document.getElementById('recent-grid');
  grid.innerHTML = '';
  const recent = [...allGames].filter(g => g.last_played)
    .sort((a,b) => new Date(b.last_played)-new Date(a.last_played)).slice(0,20);
  if (!recent.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">◷</div><p>Aún no has jugado a nada.</p></div>`;
    return;
  }
  recent.forEach(g => grid.appendChild(buildCard(g)));
}
function renderFavorites() {
  const grid = document.getElementById('fav-grid');
  grid.innerHTML = '';
  const favs = allGames.filter(g => g.play_count >= 3)
    .sort((a,b) => b.play_count - a.play_count);
  if (!favs.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">♥</div><p>Juega 3+ veces a un juego para verlo aquí.</p></div>`;
    return;
  }
  favs.forEach(g => grid.appendChild(buildCard(g)));
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function renderSettingsView() {
  const el = document.getElementById('settings-content');
  const folders = await api.getFolders();
  const accents = ['#e84855','#ff6b35','#00d4aa','#3b82f6','#a855f7','#f59e0b','#10b981'];
  const cur = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  el.innerHTML = `
    <div class="settings-section">
      <h3>Apariencia</h3>
      <div class="setting-row">
        <div><div class="setting-label">Color de acento</div></div>
        <div class="color-swatches">
          ${accents.map(c=>`<div class="swatch ${c===cur?'active':''}" style="background:${c}" data-color="${c}" onclick="setAccent('${c}')"></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Carpetas de juegos</h3>
      ${!folders.length
        ? `<p style="color:var(--subtext);font-size:12px;font-family:var(--font-mono)">Sin carpetas. Añade una con "+ Carpeta".</p>`
        : folders.map(f=>`
          <div class="folder-item-row">
            <span>${f.type==='steam'?'🎮':'📁'}</span>
            <span class="folder-path" title="${escHtml(f.path)}">${escHtml(f.path)}</span>
            <button class="btn-danger" onclick="removeFolder(${f.id})">✕</button>
          </div>`).join('')
      }
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="doAddFolder()">+ Añadir carpeta</button>
        <button class="btn-icon" onclick="doScan()">↻ Re-escanear</button>
        <button class="btn-secondary" onclick="doDetectSteam()">🎮 Detectar Steam</button>
      </div>
    </div>
    <div class="settings-section">
      <h3>Base de datos</h3>
      <div class="setting-row">
        <div class="setting-label">Total de juegos</div>
        <strong style="font-family:var(--font-mono);color:var(--accent)">${allGames.length}</strong>
      </div>
      <div class="setting-row">
        <div class="setting-label">Carpetas indexadas</div>
        <strong style="font-family:var(--font-mono);color:var(--accent)">${folders.length}</strong>
      </div>
    </div>`;
}
async function removeFolder(id) {
  await api.removeFolder(id);
  toast('Carpeta eliminada.', '');
  await renderFolderSidebar();
  renderSettingsView();
}

// ── Steam auto-detect ─────────────────────────────────────────────────────────
async function doDetectSteam() {
  const libs = await api.detectSteam();
  if (!libs.length) { toast('No se encontraron librerías de Steam automáticamente.', ''); return; }

  let added = 0, games = 0;
  const prog = showScanProgress(`Detectando ${libs.length} librería(s) de Steam…`);
  for (const libPath of libs) {
    const res = await api.addFolder(libPath, 'steam');
    if (res.ok) {
      added++;
      const { results } = await api.scanFolder(libPath);
      if (results.length) {
        await api.importResults({ games: results, folderId: res.folder.id });
        games += results.length;
      }
    }
  }
  prog.remove();
  toast(`Steam: ${added} librería(s) añadida(s), ${games} juegos importados.`, 'success');
  await loadGames();
  await renderFolderSidebar();
  renderSettingsView();
}

// First-run auto-detect
async function autoDetectSteamForFirstRun() {
  const libs = await api.detectSteam();
  for (const lib of libs) {
    if (!frFolders.find(f => f.path === lib)) {
      frFolders.push({ path: lib, type: 'steam' });
    }
  }
  renderFrFolders();
  if (libs.length) {
    document.getElementById('fr-steam-note').textContent =
      `✓ ${libs.length} librería(s) de Steam detectada(s) automáticamente.`;
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────
function bindContextMenu() {
  const menu = document.getElementById('ctx-menu');
  document.getElementById('ctx-launch').addEventListener('click', async () => {
    if (!ctxGame) return;
    await api.launchGame(ctxGame.exe_path);
    toast(`Lanzando ${ctxGame.name}…`, 'success');
    menu.classList.add('hidden');
    setTimeout(loadGames, 1500);
  });
  document.getElementById('ctx-folder').addEventListener('click', async () => {
    if (!ctxGame) return;
    await api.openFolder(ctxGame.exe_path);
    menu.classList.add('hidden');
  });
  document.getElementById('ctx-rename').addEventListener('click', () => {
    if (!ctxGame) return;
    menu.classList.add('hidden');
    openRename(ctxGame);
  });
  document.getElementById('ctx-remove').addEventListener('click', async () => {
    if (!ctxGame) return;
    await api.removeGame(ctxGame.id);
    toast(`${ctxGame.name} eliminado.`, '');
    menu.classList.add('hidden');
    await loadGames();
  });
  document.addEventListener('click',   () => menu.classList.add('hidden'));
  document.addEventListener('keydown', e => { if(e.key==='Escape') menu.classList.add('hidden'); });
}
function showCtxMenu(e, game) {
  ctxGame = game;
  const menu = document.getElementById('ctx-menu');
  menu.style.left = `${e.clientX}px`;
  menu.style.top  = `${e.clientY}px`;
  menu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = `${e.clientX - r.width}px`;
    if (r.bottom > window.innerHeight) menu.style.top  = `${e.clientY - r.height}px`;
  });
}

// ── Rename ────────────────────────────────────────────────────────────────────
function openRename(game) {
  renameGame = game;
  const input = document.getElementById('rename-input');
  input.value = game.name;
  document.getElementById('rename-modal').classList.remove('hidden');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}
function closeRename() { document.getElementById('rename-modal').classList.add('hidden'); renameGame = null; }
async function confirmRename() {
  if (!renameGame) return;
  const name = document.getElementById('rename-input').value.trim();
  if (!name) return;
  await api.updateGameName(renameGame.id, name);
  toast(`Renombrado a "${name}".`, 'success');
  closeRename(); await loadGames();
}
document.getElementById('rename-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter')  confirmRename();
  if (e.key === 'Escape') closeRename();
});

// ── First-run wizard ──────────────────────────────────────────────────────────
function showFirstRun() { document.getElementById('first-run-overlay').classList.remove('hidden'); }
function frNext() { frGoStep(2); }
async function frAddFolder() {
  const folder = await api.selectFolder();
  if (!folder) return;
  if (!frFolders.find(f => f.path === folder)) {
    frFolders.push({ path: folder, type: 'custom' });
    renderFrFolders();
  }
}
function renderFrFolders() {
  const list = document.getElementById('fr-folders-list');
  list.innerHTML = frFolders.map(f => `
    <div class="fr-folder-item">
      <span>${f.type === 'steam' ? '🎮' : '📁'}</span>
      <span>${escHtml(f.path)}</span>
      <small style="color:var(--subtext);font-size:10px">${f.type === 'steam' ? 'Steam' : 'Personalizada'}</small>
    </div>`).join('');
}
async function frScan() {
  if (!frFolders.length) { toast('Añade al menos una carpeta.', ''); return; }
  frGoStep(3);
  let total = 0;
  for (const { path: fp, type } of frFolders) {
    document.getElementById('fr-scan-status').textContent = `Escaneando ${fp}…`;
    const res = await api.addFolder(fp, type);
    if (res.ok) {
      const { results } = await api.scanFolder(fp);
      if (results.length) {
        await api.importResults({ games: results, folderId: res.folder.id });
        total += results.length;
      }
    }
  }
  document.getElementById('fr-count').textContent = total;
  frGoStep(4);
}
async function frFinish() {
  document.getElementById('first-run-overlay').classList.add('hidden');
  await loadGames(); await renderFolderSidebar(); renderSettingsView();
}
function frGoStep(n) {
  document.querySelectorAll('.fr-step').forEach((s,i) => s.classList.toggle('active', i+1===n));
  frStep = n;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = type ? `show ${type}` : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
