'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  shortcut: 'CommandOrControl+Shift+2', displayId: '', position: 'top',
  alwaysOnTop: true, launchAtLogin: false, autoCopy: false, savePath: ''
});

function settingsFrom(input, defaults = DEFAULTS) {
  if (!input || typeof input !== 'object') throw new Error('设置格式不正确');
  const result = { ...defaults };
  for (const key of ['alwaysOnTop', 'launchAtLogin', 'autoCopy']) {
    if (key in input) {
      if (typeof input[key] !== 'boolean') throw new Error('设置必须是布尔值');
      result[key] = input[key];
    }
  }
  for (const key of ['shortcut', 'displayId', 'savePath']) {
    if (key in input) {
      if (typeof input[key] !== 'string' || input[key].length > 1024) throw new Error('设置文本无效');
      result[key] = input[key].trim();
    }
  }
  if (!result.shortcut || result.shortcut.length > 80) throw new Error('请输入有效快捷键');
  if (result.savePath && !path.isAbsolute(result.savePath)) throw new Error('保存目录必须是绝对路径');
  if ('position' in input) {
    if (!['top', 'bottom'].includes(input.position)) throw new Error('位置必须为顶部或底部');
    result.position = input.position;
  }
  return result;
}

function cropRect(rect, size, viewport) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(Number.isFinite)) {
    throw new Error('选区无效');
  }
  if (viewport.width <= 0 || viewport.height <= 0 || rect.width < 3 || rect.height < 3) throw new Error('选区太小');
  const x = Math.max(0, Math.min(size.width - 1, Math.floor(rect.x * size.width / viewport.width)));
  const y = Math.max(0, Math.min(size.height - 1, Math.floor(rect.y * size.height / viewport.height)));
  const right = Math.min(size.width, Math.ceil((rect.x + rect.width) * size.width / viewport.width));
  const bottom = Math.min(size.height, Math.ceil((rect.y + rect.height) * size.height / viewport.height));
  if (right <= x || bottom <= y) throw new Error('选区超出屏幕');
  return { x, y, width: right - x, height: bottom - y };
}

function pngBuffer(dataURL) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/png;base64,') || dataURL.length > 64 * 1024 * 1024) {
    throw new Error('需要小于 48 MB 的 PNG 图片');
  }
  const data = Buffer.from(dataURL.slice(22), 'base64');
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG 格式不正确');
  return data;
}

class Store {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, 'state.json');
    this.warning = '';
    fs.mkdirSync(path.join(root, 'captures'), { recursive: true });
    this.state = { version: 1, settings: { ...DEFAULTS }, items: [] };
    if (fs.existsSync(this.file)) {
      try {
        this.state = this.parse(this.file);
      } catch {
        // Preserve the unreadable file before writing any new metadata.
        fs.copyFileSync(this.file, `${this.file}.damaged-${Date.now()}`);
        this.warning = '截图索引损坏，已保留原文件。';
        if (fs.existsSync(`${this.file}.bak`)) {
          try { this.state = this.parse(`${this.file}.bak`); this.warning += '已恢复上一次索引。'; }
          catch { this.warning += '请从 captures 目录找回原始 PNG。'; }
        } else this.warning += '请从 captures 目录找回原始 PNG。';
      }
    }
  }
  parse(file) {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.items)) throw new Error('Invalid state');
    state.settings = settingsFrom(state.settings);
    if (state.items.some(item => !item || !/^[a-f0-9-]{36}$/.test(item.id) ||
      !/^(original|edit-\d+)\.png$/.test(item.file) || typeof item.archived !== 'boolean' ||
      typeof item.pinned !== 'boolean')) throw new Error('Invalid item');
    return state;
  }
  persist() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(temporary, this.file);
  }
  item(id) {
    const item = this.state.items.find(entry => entry.id === id);
    if (!item) throw new Error('截图已不存在');
    return item;
  }
  directory(id) { this.item(id); return path.join(this.root, 'captures', id); }
  imagePath(id, original = false) {
    const item = this.item(id);
    return path.join(this.directory(id), original ? 'original.png' : item.file);
  }
  archive() {
    let count = 0;
    for (const item of this.state.items) if (!item.pinned && !item.archived) { item.archived = true; count++; }
    this.persist();
    return count;
  }
  reorder(ids) {
    const current = this.state.items.filter(item => !item.archived);
    if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length ||
      ids.some(id => !current.some(item => item.id === id))) throw new Error('排序列表无效');
    this.state.items = [...ids.map(id => this.item(id)), ...this.state.items.filter(item => item.archived)];
    this.persist();
  }
}

module.exports = { Store, DEFAULTS, settingsFrom, cropRect, pngBuffer };
