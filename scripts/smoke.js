'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { dialog } = require('electron');
const { png } = require('./png');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(win, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (win.isDestroyed()) throw new Error('Window closed before ready');
    try { if (await win.webContents.executeJavaScript(expression)) return; } catch { /* Still loading. */ }
    await sleep(100);
  }
  throw new Error(`UI timeout: ${expression}`);
}
async function capture(win, file) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(500);
    try { const frame = await win.webContents.capturePage(); fs.writeFileSync(file, frame.toPNG()); return frame; }
    catch (error) { if (attempt === 2) throw new Error(`Capture ${path.basename(file)}: ${error.message}`); }
  }
}
exports.run = async ({ app, rope, addImage, store, openPreview, openSettings, snapshot, imageFor, nativeImage,
  desktopCapturer, createWindow, roles, beginCapture, finishCapture, tray }) => {
  const output = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  const errors = [];
  const mainError = error => errors.push(`Main process: ${error.stack || error}`);
  // Test-only observers prevent native error dialogs from hiding shutdown failures.
  process.on('uncaughtException', mainError);
  process.on('unhandledRejection', mainError);
  dialog.showErrorBox = (title, message) => errors.push(`Error dialog (${title}): ${message}`);
  let finished = false;
  function finish(code) {
    if (finished) return;
    finished = true;
    app.once('will-quit', () => {
      if (roles.size !== 0) errors.push(`Shutdown leaked ${roles.size} window roles`);
      const ok = code === 0 && errors.length === 0;
      if (ok) results.push('Normal app.quit closes all native windows and releases roles without main-process exceptions');
      const report = { ok, results, errors };
      fs.writeFileSync(path.join(output, 'smoke.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      app.exit(ok ? 0 : 1);
    });
    app.quit();
  }
  function track(win) {
    win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
    win.webContents.on('render-process-gone', (_, details) => errors.push(`Renderer ${details.reason}`));
  }
  try {
    track(rope);
    await waitFor(rope, 'Boolean(document.querySelector(".rope-toolbar"))');
    results.push('Transparent rope renderer and preload loaded');
    rope.hide();
    assert.equal(rope.isVisible(), false);
    tray.emit('click');
    assert.equal(rope.isVisible(), true, 'Single tray click must restore the hidden rope');
    tray.emit('click'); tray.emit('double-click');
    assert.equal(rope.isVisible(), true, 'Repeated tray clicks must keep the rope visible');
    results.push('Tray click event restores the real hidden rope; repeated/double clicks keep it visible');
    const buffer = png(640, 420, (x, y) => {
      if (y < 50) return [53, 98, 77, 255];
      if (x > 35 && x < 605 && y > 90 && y < 330) {
        if (y > 130 && y < 147 && x < 390) return [126, 163, 136, 255];
        if (y > 180 && y < 197 && x < 480) return [201, 171, 118, 255];
        return [238, 235, 217, 255];
      }
      return [249, 247, 237, 255];
    });
    const id = addImage(nativeImage.createFromBuffer(buffer), '一张灵感便签');
    const originalPng = fs.readFileSync(store.imagePath(id, true));
    const secondId = addImage(nativeImage.createFromBuffer(buffer), '下午的工作片段');
    await waitFor(rope, 'document.querySelectorAll(".card").length >= 2');
    await rope.webContents.executeJavaScript(`window.clothesline.call('reorder', ${JSON.stringify([secondId, id])})`);
    assert.equal(store.state.items.filter(item => !item.archived)[0].id, secondId);
    await rope.webContents.executeJavaScript(`window.clothesline.call('pin', ${JSON.stringify(id)})`);
    const archived = await rope.webContents.executeJavaScript("window.clothesline.call('archive')");
    assert.ok(archived >= 1);
    assert.equal(store.item(id).archived, false);
    await rope.webContents.executeJavaScript(`window.clothesline.call('restore', ${JSON.stringify(secondId)})`);
    results.push('Real IPC: reorder, pin, archive, restore; persistence verified');
    await sleep(200);
    const ropeFrame = await capture(rope, path.join(output, 'rope.png'));
    assert.equal(ropeFrame.toBitmap()[3], 0, 'Transparent rope corner must have zero alpha');
    results.push('Rope empty area has actual transparent pixels');
    const editor = openPreview(id);
    if (!editor) throw new Error('Editor did not open');
    track(editor);
    await waitFor(editor, 'Boolean(document.querySelector("canvas")) && document.querySelector("canvas").getBoundingClientRect().width > 100');
    await sleep(250);
    const bounds = await editor.webContents.executeJavaScript('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()');
    editor.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(bounds.x + 80), y: Math.round(bounds.y + 70), button: 'left', clickCount: 1 });
    editor.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(bounds.x + 200), y: Math.round(bounds.y + 160), button: 'left' });
    editor.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(bounds.x + 200), y: Math.round(bounds.y + 160), button: 'left', clickCount: 1 });
    await waitFor(editor, 'document.querySelector(".editor-footer").textContent.includes("有未保存")');
    await editor.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(b => b.textContent === "保存标注").click()');
    await waitFor(editor, 'document.querySelector(".editor-footer").textContent.includes("标注已保存")');
    assert.notEqual(store.item(id).file, 'original.png');
    assert.ok(fs.readFileSync(store.imagePath(id, true)).equals(originalPng));
    assert.ok(!imageFor(id).toPNG().equals(nativeImage.createFromBuffer(buffer).toPNG()));
    results.push('Real canvas pointer annotation saved through IPC; original PNG preserved');
    await capture(editor, path.join(output, 'editor.png'));
    for (const [tool, start, end] of [
      ['箭头', [.52, .28], [.82, .55]], ['文字', [.14, .70], [.14, .70]],
      ['高亮', [.09, .46], [.74, .53]], ['马赛克', [.10, .12], [.48, .40]]
    ]) {
      const before = await editor.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()');
      await editor.webContents.executeJavaScript(`(() => {
        [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(tool)}).click();
        document.querySelector('.tools input[type=text]').value = '灵感，已挂好';
      })()`);
      const x1 = Math.round(bounds.x + bounds.width * start[0]), y1 = Math.round(bounds.y + bounds.height * start[1]);
      const x2 = Math.round(bounds.x + bounds.width * end[0]), y2 = Math.round(bounds.y + bounds.height * end[1]);
      editor.webContents.sendInputEvent({ type: 'mouseDown', x: x1, y: y1, button: 'left', clickCount: 1 });
      editor.webContents.sendInputEvent({ type: 'mouseMove', x: x2, y: y2, button: 'left' });
      editor.webContents.sendInputEvent({ type: 'mouseUp', x: x2, y: y2, button: 'left', clickCount: 1 });
      await sleep(150);
      const after = await editor.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()');
      assert.notEqual(after, before, `${tool} must alter pixels`);
      await editor.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent === '撤销').click()");
      assert.equal(await editor.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()'), before, `${tool} undo`);
      await editor.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent === '重做').click()");
      assert.equal(await editor.webContents.executeJavaScript('document.querySelector("canvas").toDataURL()'), after, `${tool} redo`);
    }
    await editor.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent === '保存标注').click()");
    await waitFor(editor, 'document.querySelector(".editor-footer").textContent.includes("标注已保存")');
    results.push('Arrow, text, highlight, mosaic all change pixels; undo/redo restore exact canvas');
    const settings = openSettings();
    track(settings);
    await waitFor(settings, 'Boolean(document.querySelector(".settings-footer"))');
    const rejection = await rope.webContents.executeJavaScript("window.clothesline.call('show-data').then(() => false, () => true)");
    assert.equal(rejection, true);
    const security = editor.webContents.getLastWebPreferences();
    assert.equal(security.nodeIntegration, false); assert.equal(security.contextIsolation, true); assert.equal(security.sandbox, true);
    results.push('Settings renderer loaded; IPC role boundaries and sandbox verified');
    await capture(settings, path.join(output, 'settings.png'));
    // Capture remains in memory; never export the user's desktop into test artifacts.
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 200 } });
    assert.ok(sources.length > 0 && sources.some(source => !source.thumbnail.isEmpty()));
    results.push('Windows desktopCapturer returns non-empty screen frame (not saved)');
    await require('./lifecycle-regression').run({ rope, roles, createWindow, beginCapture, finishCapture, openPreview, openSettings, id, results });
    tray.emit('click');
    assert.equal(rope.isVisible(), false, 'Tray clicks during capture must not expose our rope in the screenshot');
    results.push('Tray click while capturing keeps the rope hidden');
    assert.ok(snapshot().items.some(item => item.id === id));
    await sleep(100);
    assert.deepEqual(errors, []);
    finish(0);
  } catch (error) {
    errors.push(error.stack || String(error));
    console.error(error.stack);
    finish(1);
  }
};
