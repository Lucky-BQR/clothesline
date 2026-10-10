'use strict';
const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function closed(win) {
  for (let i = 0; i < 100; i++) {
    if (win.isDestroyed()) return;
    await sleep(20);
  }
  throw new Error('Window did not close');
}
exports.run = async ({ rope, roles, createWindow, beginCapture, finishCapture, openPreview, openSettings, id, results }) => {
  // Close actual native windows: mocks do not enforce destroyed-object semantics.
  for (const win of BrowserWindow.getAllWindows()) if (win !== rope) win.close();
  await sleep(150);
  assert.equal(roles.size, 1);
  for (let i = 0; i < 10; i++) {
    const win = createWindow('settings', { width: 700, height: 700 });
    const contentsId = win.webContents.id;
    if (i % 2) win.close(); else win.destroy();
    await closed(win);
    assert.equal(roles.has(contentsId), false, 'Closed windows must release their IPC role');
    // A delayed show event must not revive or access a destroyed native window.
    assert.doesNotThrow(() => win.emit('ready-to-show'));
  }
  results.push('10 native windows closed/destroyed before loading; roles released; delayed show events harmless');
  for (let i = 0; i < 3; i++) {
    const preview = openPreview(id);
    const settings = openSettings();
    await sleep(200);
    preview.close(); settings.close();
    await closed(preview); await closed(settings);
    assert.equal(roles.size, 1);
  }
  results.push('Preview and settings repeatedly reopened and normally closed');
  for (let i = 0; i < 4; i++) {
    await beginCapture('region');
    const capture = BrowserWindow.getAllWindows().find(win => roles.get(win.webContents.id) === 'capture');
    assert.ok(capture, 'Region selector must open');
    if (i % 2) capture.close(); else finishCapture();
    await closed(capture);
    assert.equal(roles.size, 1);
    assert.equal(rope.isVisible(), true);
    finishCapture(); // Cancelling a finished capture must be harmless.
  }
  results.push('4 real region captures cancelled by close/destroy; rope restored; repeated cancellation harmless');
  const first = beginCapture('region');
  await sleep(10);
  finishCapture();
  const second = beginCapture('region');
  await first; await second;
  const current = BrowserWindow.getAllWindows().find(win => roles.get(win.webContents.id) === 'capture');
  assert.ok(current, 'A cancelled old capture must not end the new capture');
  finishCapture(); await closed(current);
  assert.equal(roles.size, 1);
  results.push('Cancel/restart while capture starts does not leave ghost windows or cancel the new session');
  // Leave all window roles open so app.quit exercises actual multi-window shutdown.
  openPreview(id); openSettings();
  await sleep(250);
  await beginCapture('region');
  assert.equal(roles.size, 4);
  results.push('Editor, settings and active capture left open for normal app.quit verification');
};
