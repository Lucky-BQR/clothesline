'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, settingsFrom, cropRect, pngBuffer } = require('../src/core');
const { png } = require('../scripts/png');
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clothesline-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function item(n, overrides = {}) {
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, file: 'original.png', title: '测试', pinned: false, archived: false, ...overrides };
}
test('mixed DPI selection maps CSS coordinates into physical pixels', () => {
  assert.deepEqual(cropRect({ x: 20, y: 40, width: 200, height: 100 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }),
    { x: 30, y: 60, width: 300, height: 150 });
});
test('crop clamps edges and rejects empty / invalid selections', () => {
  assert.deepEqual(cropRect({ x: 90, y: 90, width: 20, height: 20 }, { width: 100, height: 100 }, { width: 100, height: 100 }),
    { x: 90, y: 90, width: 10, height: 10 });
  assert.throws(() => cropRect({ x: NaN, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }, { width: 100, height: 100 }));
  assert.throws(() => cropRect({ x: 0, y: 0, width: 1, height: 1 }, { width: 100, height: 100 }, { width: 100, height: 100 }));
});
test('archive preserves pinned images and files; reorder preserves archive', t => {
  const store = new Store(temp(t));
  store.state.items = [item(1), item(2, { pinned: true }), item(3), item(4, { archived: true })];
  assert.equal(store.archive(), 2);
  assert.equal(store.item(item(2).id).archived, false);
  store.item(item(3).id).archived = false;
  store.reorder([item(3).id, item(2).id]);
  assert.deepEqual(store.state.items.map(i => i.id), [3, 2, 1, 4].map(n => item(n).id));
  assert.throws(() => store.reorder([item(3).id, item(3).id]));
});
test('corrupt metadata is preserved and last backup restored', t => {
  const root = temp(t); const store = new Store(root);
  store.state.items = [item(1)]; store.persist();
  store.state.items.push(item(2)); store.persist();
  fs.writeFileSync(store.file, '{broken');
  const restored = new Store(root);
  assert.equal(restored.state.items.length, 1);
  assert.match(restored.warning, /已恢复/);
  assert.ok(fs.readdirSync(root).some(name => name.includes('.damaged-')));
});
test('metadata path traversal never becomes an image path', t => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ version: 1, settings: {}, items: [item(1, { file: '../private.png' })] }));
  const store = new Store(root);
  assert.equal(store.state.items.length, 0);
  assert.throws(() => store.imagePath('../../private'));
});
test('settings enforce types and absolute output paths', () => {
  assert.equal(settingsFrom({ shortcut: 'Alt+Shift+S', autoCopy: true }).autoCopy, true);
  assert.throws(() => settingsFrom({ alwaysOnTop: 'yes' }));
  assert.throws(() => settingsFrom({ savePath: '../pictures' }));
  assert.throws(() => settingsFrom({ shortcut: '' }));
  assert.throws(() => settingsFrom({ position: 'center' }));
});
test('annotation endpoint only accepts bounded PNG payloads', () => {
  const buffer = png(10, 10, () => [40, 80, 120, 255]);
  assert.deepEqual(pngBuffer(`data:image/png;base64,${buffer.toString('base64')}`), buffer);
  assert.throws(() => pngBuffer('data:image/jpeg;base64,aGVsbG8='));
  assert.throws(() => pngBuffer('data:image/png;base64,aGVsbG8='));
});
