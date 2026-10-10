'use strict';
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, nativeImage,
  clipboard, dialog, Menu, Tray, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store, settingsFrom, cropRect, pngBuffer } = require('./core');

const smoke = process.argv.includes('--smoke');
if (smoke) {
  app.setPath('userData', path.resolve(__dirname, `../test-results/smoke-data/run-${Date.now()}`));
  app.disableHardwareAcceleration();
}
let store, rope, tray, captureSession, capturing = false, quitting = false;
const roles = new Map();
const previews = new Map();
const dirtyEditors = new Set();
let settingsWindow;
const page = path.join(__dirname, 'ui/index.html');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createWindow(role, options = {}, query = {}) {
  const win = new BrowserWindow({ width: 1080, height: 760, show: false,
    backgroundColor: '#f4f1e9', autoHideMenuBar: true, title: '晒衣绳 · Clothesline', icon: path.join(__dirname, 'icon.ico'),
    ...options, webPreferences: { preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  // Native BrowserWindow accessors are invalid once `closed` fires.
  const contentsId = win.webContents.id;
  let closeEvent;
  roles.set(contentsId, role);
  win.on('close', event => { closeEvent = event; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.once('closed', () => roles.delete(contentsId));
  win.loadFile(page, { query: { mode: role, ...query } }).catch(error => {
    // Closing can reject navigation before the native `closed` event fires.
    // A prevented close (e.g. unsaved annotations) still needs load errors reported.
    if (!win.isDestroyed() && !quitting && !(closeEvent && !closeEvent.defaultPrevented)) report(error);
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed() || quitting) return;
    if (role === 'rope') win.showInactive();
    else win.show();
  });
  return win;
}

function displays() {
  return screen.getAllDisplays().map((display, index) => ({ id: String(display.id),
    label: `${index + 1} · ${display.label || '显示器'} · ${display.size.width} × ${display.size.height}`,
    ...display }));
}
function selectedDisplay() {
  return screen.getAllDisplays().find(d => String(d.id) === store.state.settings.displayId) || screen.getPrimaryDisplay();
}
function positionRope() {
  if (!rope || rope.isDestroyed() || quitting) return;
  const display = selectedDisplay();
  const area = display.workArea;
  const height = Math.min(272, area.height);
  rope.setBounds({ x: area.x, y: store.state.settings.position === 'top' ? area.y : area.y + area.height - height,
    width: area.width, height });
  rope.setAlwaysOnTop(store.state.settings.alwaysOnTop, 'floating');
}
function imageFor(id, original = false) {
  const image = nativeImage.createFromPath(store.imagePath(id, original));
  if (image.isEmpty()) throw new Error('图片无法读取，请检查本地数据目录');
  return image;
}
function snapshot() {
  return { settings: store.state.settings, warning: store.warning, displays: displays(),
    items: store.state.items.map(item => {
      let thumbnail = '';
      try { thumbnail = imageFor(item.id).resize({ width: 280 }).toDataURL(); } catch { /* Keep missing records recoverable. */ }
      return { ...item, thumbnail };
    }) };
}
function broadcast() {
  if (quitting) return;
  const state = snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && roles.get(win.webContents.id) !== 'capture') win.webContents.send('state-changed', state);
  }
}
function showRope() {
  if (!rope || rope.isDestroyed() || quitting || capturing) return;
  positionRope();
  rope.showInactive();
}
function report(error) {
  if (!quitting) dialog.showErrorBox('晒衣绳', error.message || String(error));
}
function makeTray() {
  // Windows chooses the ICO frame matching the taskbar DPI.
  tray = new Tray(path.join(__dirname, 'icon.ico'));
  tray.setToolTip('晒衣绳 · 单击显示，右键打开菜单');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '区域截图', click: () => beginCapture('region').catch(report) },
    { label: '全屏截图', click: () => beginCapture('screen').catch(report) },
    { label: '窗口截图', click: () => beginCapture('window').catch(report) },
    { type: 'separator' }, { label: '显示 / 隐藏晒衣绳', click: () => {
      if (!rope || rope.isDestroyed() || quitting) return;
      rope.isVisible() ? rope.hide() : showRope();
    } },
    { label: '设置', click: openSettings }, { label: '退出', click: () => app.quit() }
  ]));
  tray.on('click', showRope);
  tray.on('double-click', showRope);
}
function bindShortcut(shortcut) {
  const old = store.state.settings.shortcut;
  if (shortcut === old && globalShortcut.isRegistered(old)) return;
  let registered = false;
  try { registered = globalShortcut.register(shortcut, () => beginCapture('region').catch(report)); } catch { /* Invalid accelerator. */ }
  if (!registered) throw new Error('快捷键无效或已被占用，请选择其他组合');
  if (old !== shortcut) globalShortcut.unregister(old);
}

function addImage(image, title) {
  if (image.isEmpty()) throw new Error('截图为空，窗口可能已关闭或禁止截图');
  const active = store.state.items.filter(item => !item.archived).length;
  if (active >= 80) throw new Error('绳子已挂满 80 张，请先收衣服');
  const id = randomUUID();
  const dir = path.join(store.root, 'captures', id);
  const file = image.toPNG();
  if (file.length > 48 * 1024 * 1024) throw new Error('截图太大，请缩小选区');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'original.png'), file);
  store.state.items.push({ id, title: String(title).slice(0, 200), file: 'original.png',
    createdAt: new Date().toISOString(), pinned: false, archived: false, ...image.getSize() });
  store.persist();
  if (store.state.settings.autoCopy) clipboard.writeImage(image);
  broadcast();
  return id;
}

async function beginCapture(kind) {
  if (quitting) return;
  if (!['region', 'screen', 'window'].includes(kind)) throw new Error('未知截图模式');
  if (capturing) throw new Error('已有截图进行中，按 Esc 取消');
  capturing = true;
  const visible = BrowserWindow.getAllWindows().filter(win => win.isVisible());
  for (const win of visible) win.hide();
  const session = { visible, kind, selecting: false };
  captureSession = session;
  try {
    await delay(220); // Let Windows compositor remove our windows from the captured frame.
    if (captureSession !== session || quitting) return;
    const display = selectedDisplay();
    if (kind === 'window') {
      const available = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 480, height: 300 } });
      if (captureSession !== session || quitting) return;
      session.sources = available.filter(source => !source.thumbnail.isEmpty() && !source.name.includes('Clothesline'));
      if (!session.sources.length) throw new Error('没有可截图的窗口，请先打开目标窗口');
      session.window = createWindow('capture', { width: 1000, height: 720, alwaysOnTop: true }, { kind });
      session.window.once('closed', () => finishCapture(session));
      return;
    }
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    if (captureSession !== session || quitting) return;
    const source = sources.find(entry => entry.display_id === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取显示器画面');
    const frozen = source.thumbnail;
    if (kind === 'screen') {
      const id = addImage(frozen, '全屏截图');
      finishCapture(session);
      return id;
    }
    session.image = frozen;
    session.display = display;
    session.window = createWindow('capture', { ...display.bounds, frame: false, resizable: false,
      skipTaskbar: true, alwaysOnTop: true, enableLargerThanScreen: true }, { kind });
    session.window.once('closed', () => finishCapture(session));
  } catch (error) {
    if (captureSession !== session || quitting) return;
    finishCapture(session); throw error;
  }
}
function finishCapture(session = captureSession) {
  if (!session || session !== captureSession) return;
  captureSession = null;
  capturing = false;
  if (session.window && !session.window.isDestroyed()) session.window.destroy();
  if (!quitting) for (const win of session.visible) if (!win.isDestroyed()) win === rope ? win.showInactive() : win.show();
}
async function chooseWindow(id) {
  const session = captureSession;
  if (!session || session.kind !== 'window' || !session.sources.some(source => source.id === id)) throw new Error('窗口选择无效');
  if (session.selecting) throw new Error('正在读取窗口');
  session.selecting = true;
  session.window.hide();
  try {
    await delay(150);
    if (captureSession !== session || quitting) return;
    const displays = screen.getAllDisplays();
    const thumbnailSize = {
      width: Math.min(8192, Math.max(...displays.map(d => Math.round(d.size.width * d.scaleFactor)))),
      height: Math.min(8192, Math.max(...displays.map(d => Math.round(d.size.height * d.scaleFactor))))
    };
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize });
    if (captureSession !== session || quitting) return;
    const source = sources.find(entry => entry.id === id);
    if (!source || source.thumbnail.isEmpty()) throw new Error('目标窗口无法截图，请恢复窗口后重试');
    return addImage(source.thumbnail, source.name);
  } finally { finishCapture(session); }
}
function openPreview(id) {
  store.item(id);
  if (previews.has(id)) { previews.get(id).show(); previews.get(id).focus(); return previews.get(id); }
  const win = createWindow('editor', { minWidth: 820, minHeight: 560 }, { id });
  previews.set(id, win);
  win.on('close', event => {
    if (dirtyEditors.has(id) && !quitting) {
      const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['继续编辑', '放弃未保存标注'],
        defaultId: 0, cancelId: 0, message: '还有未保存的标注', detail: '返回编辑器点击「保存标注」即可保留。' });
      if (choice === 0) event.preventDefault();
    }
  });
  win.on('closed', () => { previews.delete(id); dirtyEditors.delete(id); });
  return win;
}
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return settingsWindow; }
  settingsWindow = createWindow('settings', { width: 700, height: Math.min(790, selectedDisplay().workArea.height), minWidth: 600 });
  return settingsWindow;
}
async function saveImage(id, parent) {
  const folder = store.state.settings.savePath || app.getPath('pictures');
  const result = await dialog.showSaveDialog(parent, { title: '保存截图',
    defaultPath: path.join(folder, `Clothesline-${id.slice(0, 8)}.png`), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
  if (!result.canceled) {
    const target = path.extname(result.filePath).toLowerCase() === '.png' ? result.filePath : `${result.filePath}.png`;
    if (path.resolve(target).startsWith(path.resolve(store.root) + path.sep)) throw new Error('请保存到应用数据目录以外的位置');
    fs.copyFileSync(store.imagePath(id), target);
  }
  return !result.canceled;
}
async function removeImage(id, parent) {
  const item = store.item(id);
  const answer = await dialog.showMessageBox(parent, { type: 'question', buttons: ['取消', '移入回收站'],
    defaultId: 0, cancelId: 0, message: '删除这张截图？', detail: '原图与标注版本会一起移入 Windows 回收站。' });
  if (answer.response !== 1) return false;
  await shell.trashItem(store.directory(id));
  store.state.items = store.state.items.filter(entry => entry !== item);
  store.persist();
  previews.get(id)?.close();
  broadcast();
  return true;
}
function contextMenu(id, parent) {
  const item = store.item(id);
  const run = fn => () => Promise.resolve().then(fn).catch(report);
  Menu.buildFromTemplate([
    { label: '预览 / 标注', click: run(() => openPreview(id)) },
    { label: '复制图片', click: run(() => clipboard.writeImage(imageFor(id))) },
    { label: '另存为…', click: run(() => saveImage(id, parent)) },
    { label: item.pinned ? '取消固定' : '固定在绳子上', click: run(() => { item.pinned = !item.pinned; store.persist(); broadcast(); }) },
    { label: item.archived ? '挂回绳子' : '收纳这一张', click: run(() => { item.archived = !item.archived; store.persist(); broadcast(); }) },
    { type: 'separator' }, { label: '删除…', click: run(() => removeImage(id, parent)) }
  ]).popup({ window: parent });
}

const allowed = {
  rope: ['state', 'capture', 'preview', 'copy', 'save', 'delete', 'pin', 'restore', 'archive', 'reorder', 'menu', 'settings', 'quit'],
  editor: ['state', 'image', 'copy', 'save', 'edit', 'dirty', 'reset-image', 'close', 'delete'],
  settings: ['state', 'apply-settings', 'pick-folder', 'show-data', 'close'],
  capture: ['state', 'choose-window', 'select-region', 'cancel-capture', 'close']
};
ipcMain.handle('action', async (event, action, payload) => {
  try {
    const role = roles.get(event.sender.id);
    if (!allowed[role]?.includes(action)) throw new Error('操作未授权');
    const parent = BrowserWindow.fromWebContents(event.sender);
    let value;
    switch (action) {
      case 'state':
        if (role === 'capture') {
          if (!captureSession || captureSession.window !== parent) throw new Error('截图会话已结束');
          value = captureSession.kind === 'region' ? { kind: 'region', image: captureSession.image.toDataURL() } :
            { kind: 'window', sources: captureSession.sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() })) };
        } else value = snapshot();
        break;
      case 'capture': value = await beginCapture(payload); break;
      case 'choose-window': value = await chooseWindow(payload); break;
      case 'select-region': {
        const session = captureSession;
        if (!session || session.window !== parent || session.kind !== 'region') throw new Error('截图会话已结束');
        const rect = cropRect(payload.rect, session.image.getSize(), payload.viewport);
        value = addImage(session.image.crop(rect), '区域截图');
        finishCapture(); break;
      }
      case 'cancel-capture': finishCapture(); break;
      case 'preview': openPreview(payload); break;
      case 'image': value = { data: imageFor(payload).toDataURL(), item: store.item(payload) }; break;
      case 'copy': clipboard.writeImage(imageFor(payload)); break;
      case 'save': value = await saveImage(payload, parent); break;
      case 'delete': value = await removeImage(payload, parent); break;
      case 'pin': { const item = store.item(payload); item.pinned = !item.pinned; store.persist(); broadcast(); break; }
      case 'restore': store.item(payload).archived = false; store.persist(); broadcast(); break;
      case 'archive': value = store.archive(); broadcast(); break;
      case 'reorder': store.reorder(payload); broadcast(); break;
      case 'menu': contextMenu(payload, parent); break;
      case 'dirty': {
        if (previews.get(payload.id) !== parent) throw new Error('编辑器无效');
        payload.value ? dirtyEditors.add(payload.id) : dirtyEditors.delete(payload.id); break;
      }
      case 'edit': {
        const item = store.item(payload.id);
        const buffer = pngBuffer(payload.data);
        const image = nativeImage.createFromBuffer(buffer);
        const size = image.getSize();
        if (image.isEmpty() || size.width !== item.width || size.height !== item.height) throw new Error('标注图片尺寸不匹配');
        const name = `edit-${Date.now()}.png`;
        fs.writeFileSync(path.join(store.directory(item.id), name), buffer);
        item.file = name; store.persist(); broadcast(); break;
      }
      case 'reset-image': {
        const result = await dialog.showMessageBox(parent, { type: 'question', buttons: ['取消', '恢复原图'], defaultId: 0,
          cancelId: 0, message: '恢复这张截图的原始画面？', detail: '已保存的标注版本仍保留在本地数据目录。' });
        if (result.response === 1) { store.item(payload).file = 'original.png'; store.persist(); broadcast(); value = true; }
        else value = false;
        break;
      }
      case 'settings': openSettings(); break;
      case 'apply-settings': {
        const settings = settingsFrom(payload, store.state.settings);
        if (settings.savePath && !fs.statSync(settings.savePath).isDirectory()) throw new Error('保存目录不存在');
        const previous = { ...store.state.settings };
        bindShortcut(settings.shortcut);
        try {
          if (settings.launchAtLogin !== previous.launchAtLogin) {
            if (!app.isPackaged) throw new Error('开机启动需要安装或打包后的应用');
            app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });
          }
          store.state.settings = settings; store.persist();
        } catch (error) {
          store.state.settings = previous;
          globalShortcut.unregister(settings.shortcut);
          bindShortcut(previous.shortcut);
          throw error;
        }
        positionRope(); broadcast(); break;
      }
      case 'pick-folder': {
        const result = await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] });
        value = result.canceled ? null : result.filePaths[0]; break;
      }
      case 'show-data': { const error = await shell.openPath(store.root); if (error) throw new Error(error); break; }
      case 'close': if (role === 'capture') finishCapture(); else parent.close(); break;
      case 'quit': app.quit(); break;
    }
    return { ok: true, value };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.on('hit-test', (event, active) => {
  if (!quitting && rope && !rope.isDestroyed() && roles.get(event.sender.id) === 'rope') rope.setIgnoreMouseEvents(!active, { forward: true });
});
ipcMain.on('drag-file', (event, id) => {
  if (!['rope', 'editor'].includes(roles.get(event.sender.id))) return;
  try { event.sender.startDrag({ file: store.imagePath(id), icon: imageFor(id).resize({ width: 100 }) }); }
  catch (error) { report(error); }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => rope && showRope());
  app.whenReady().then(async () => {
    store = new Store(app.getPath('userData'));
    rope = createWindow('rope', { frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, skipTaskbar: true, hasShadow: false, focusable: true });
    rope.setIgnoreMouseEvents(true, { forward: true });
    positionRope();
    rope.on('close', event => { if (!quitting) { event.preventDefault(); rope.hide(); } });
    makeTray();
    try { bindShortcut(store.state.settings.shortcut); } catch (error) { store.warning += error.message; }
    screen.on('display-added', () => { positionRope(); broadcast(); });
    screen.on('display-removed', () => { positionRope(); broadcast(); });
    screen.on('display-metrics-changed', () => { positionRope(); broadcast(); });
    if (smoke) await require('../scripts/smoke').run({ app, rope, addImage, store, openPreview, openSettings,
      snapshot, imageFor, nativeImage, clipboard, desktopCapturer, createWindow, roles, beginCapture, finishCapture, tray });
  }).catch(error => { report(error); app.quit(); });
  app.on('before-quit', event => {
    if (!quitting && dirtyEditors.size) {
      const choice = dialog.showMessageBoxSync({ type: 'question', buttons: ['继续编辑', '退出并放弃未保存标注'],
        defaultId: 0, cancelId: 0, message: '还有未保存的标注，是否退出？' });
      if (choice === 0) { event.preventDefault(); return; }
    }
    quitting = true; finishCapture(); globalShortcut.unregisterAll(); tray?.destroy();
  });
  app.on('window-all-closed', () => { /* Tray keeps the rope available. */ });
}
