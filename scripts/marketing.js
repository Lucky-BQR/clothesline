'use strict';
// Capture real UI using invented examples in --smoke's isolated data directory.
// No user's desktop, screenshots, settings or clipboard are exported here.
const fs = require('node:fs');
const path = require('node:path');
exports.run = async ({ rope, addImage, nativeImage, openPreview, waitFor, capture, track, results }) => {
  const output = path.resolve(__dirname, '../docs/images');
  fs.mkdirSync(output, { recursive: true });
  const demoCanvas = theme => {
    const canvas = document.createElement('canvas'); canvas.width = 880; canvas.height = 560;
    const ctx = canvas.getContext('2d');
    const themes = [
      { title: '新的一周，轻一点', label: 'MONDAY NOTES', accent: '#35624d', rows: ['09:30  整理今天的三件重要小事', '11:00  给新想法留一页空白', '15:00  把反馈整理成下一步行动'], foot: '一张便签，随手放在眼前。' },
      { title: '这版设计，先留着', label: 'DESIGN REFERENCE', accent: '#8f6947', rows: ['更少的颜色 · 更清晰的层级', '给标题留一点呼吸的空间', '把值得留下的细节圈出来'], foot: '先截图，再标注，最后一起讨论。' },
      { title: '把反馈变成下一步', label: 'FEEDBACK BOARD', accent: '#657a95', rows: ['✓ 下载按钮放在页面最上方', '✓ 三个步骤就能开始使用', '○ 把常见问题写给第一次打开的人'], foot: '示例内容 · 不含个人资料' }
    ];
    const t = themes[theme];
    ctx.fillStyle = '#f8f6ef'; ctx.fillRect(0, 0, 880, 560);
    ctx.fillStyle = t.accent; ctx.fillRect(0, 0, 880, 9);
    ctx.font = '18px "Segoe UI", "Microsoft YaHei", sans-serif'; ctx.fillText(t.label, 52, 69);
    ctx.fillStyle = '#25352e'; ctx.font = 'bold 46px "Microsoft YaHei", sans-serif'; ctx.fillText(t.title, 52, 148);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i === 0 ? '#e8eddf' : '#efeee5';
      ctx.beginPath(); ctx.roundRect(52, 194 + i * 80, 776, 64, 10); ctx.fill();
      ctx.fillStyle = '#34463c'; ctx.font = '24px "Microsoft YaHei", sans-serif'; ctx.fillText(t.rows[i], 74, 235 + i * 80);
    }
    ctx.fillStyle = '#788477'; ctx.font = '20px "Microsoft YaHei", sans-serif'; ctx.fillText(t.foot, 52, 507);
    return canvas.toDataURL('image/png');
  };
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const data = await rope.webContents.executeJavaScript(`(${demoCanvas.toString()})(${i})`);
    ids.push(addImage(nativeImage.createFromDataURL(data), ['本周工作便签', '设计参考', '反馈清单'][i]));
  }
  rope.setBounds({ x: rope.getBounds().x, y: rope.getBounds().y, width: 1200, height: 272 });
  await waitFor(rope, 'document.querySelectorAll(".card").length >= 5');
  await capture(rope, path.join(output, 'clothesline-rope.png'));
  const editor = openPreview(ids[0]); track(editor);
  await waitFor(editor, 'document.querySelector("canvas")?.width === 880');
  const bounds = await editor.webContents.executeJavaScript('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()');
  await editor.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent === '箭头').click()");
  const x1 = Math.round(bounds.x + bounds.width * .83), y1 = Math.round(bounds.y + bounds.height * .27);
  const x2 = Math.round(bounds.x + bounds.width * .73), y2 = Math.round(bounds.y + bounds.height * .42);
  editor.webContents.sendInputEvent({ type:'mouseDown', x:x1, y:y1, button:'left', clickCount:1 });
  editor.webContents.sendInputEvent({ type:'mouseMove', x:x2, y:y2, button:'left' });
  editor.webContents.sendInputEvent({ type:'mouseUp', x:x2, y:y2, button:'left', clickCount:1 });
  await waitFor(editor, 'document.querySelector(".editor-footer").textContent.includes("有未保存")');
  await editor.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent === '保存标注').click()");
  await waitFor(editor, 'document.querySelector(".editor-footer").textContent.includes("标注已保存")');
  await capture(editor, path.join(output, 'clothesline-editor.png'));
  results.push('Public documentation screenshots captured from real UI with synthetic notes and saved arrow annotation');
};
