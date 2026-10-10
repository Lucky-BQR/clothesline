'use strict';
const api = window.clothesline;
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'rope';
const root = document.querySelector('#app');
let state, archiveView = false, toastTimer, selectionActive = false;
document.body.className = mode === 'settings' ? 'settings-window' : `${mode}-page`;
document.documentElement.classList.toggle('transparent-root', mode === 'rope');

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3800);
}
async function call(action, payload) {
  try { return await api.call(action, payload); }
  catch (error) { toast(error.message); throw error; }
}
function button(text, handler, className = '', title = '') {
  const element = node('button', className, text);
  element.type = 'button';
  if (title) { element.title = title; element.setAttribute('aria-label', title); }
  element.addEventListener('click', event => {
    event.stopPropagation();
    Promise.resolve().then(() => handler(event)).catch(() => {});
  });
  return element;
}
function interactive(element) { element.dataset.interactive = 'true'; return element; }
function enableNativeDrag(element, id) {
  element.draggable = true;
  element.addEventListener('dragstart', event => { event.preventDefault(); api.drag(id); });
}

function renderRope() {
  const previousScroll = document.querySelector('.rail')?.scrollLeft || 0;
  root.replaceChildren();
  const active = state.items.filter(item => !item.archived);
  const archived = state.items.filter(item => item.archived);
  const toolbar = interactive(node('div', 'rope-toolbar'));
  toolbar.append(node('span', 'brand', '⌁ 晒衣绳'),
    button('＋ 区域', () => call('capture', 'region'), 'primary', `区域截图 · ${state.settings.shortcut}`),
    button('全屏', () => call('capture', 'screen')), button('窗口', () => call('capture', 'window')),
    node('span', 'wash-count', `${active.length} 张在晒`),
    button('收衣服', async () => { const count = await call('archive'); toast(`已收纳 ${count} 张，固定截图继续留在绳子上`); }, '', '收纳全部未固定截图'),
    button(archiveView ? '回到绳子' : `收纳箱 ${archived.length || ''}`, () => { archiveView = !archiveView; renderRope(); }),
    button('设置', () => call('settings')));
  const wrap = node('div', 'line-wrap');
  const rail = node('div', `rail ${archiveView ? 'archive-view' : ''}`);
  wrap.append(node('div', 'clothesline'), rail);
  root.append(toolbar, wrap);
  const items = archiveView ? archived : active;
  if (!items.length) {
    const empty = interactive(node('div', 'empty-rope'));
    empty.append(node('strong', '', archiveView ? '衣服已晾好，收纳箱还是空的' : '把灵感，轻轻挂起来'),
      node('span', '', archiveView ? '点「收衣服」可收纳未固定的截图。' : `${state.settings.shortcut} 截一张 · 点击预览 · 拖动 ↗ 分享`));
    rail.append(empty);
  }
  for (const item of items) {
    const card = interactive(node('article', 'card'));
    card.dataset.id = item.id;
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${item.title}，点击预览`);
    card.title = `${item.title} · ${item.width} × ${item.height}\n右键查看更多操作`;
    const image = node('img'); image.alt = item.title;
    if (item.thumbnail) image.src = item.thumbnail;
    card.append(node('span', 'clip'), image);
    if (item.pinned) card.append(node('span', 'pin', '★'));
    const footer = node('div', 'card-footer');
    footer.append(node('time', '', new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
    if (!archiveView) {
      const handle = button('↔', () => {}, '', '按住左右拖动，调整位置');
      handle.addEventListener('pointerdown', event => startReorder(event, card, rail));
      footer.append(handle);
    } else footer.append(button('挂回', () => call('restore', item.id)));
    const share = button('↗', () => toast('按住 ↗ 拖到聊天窗口或文件夹；也可以右键复制图片'), '', '拖拽 PNG 文件到其他应用');
    enableNativeDrag(share, item.id);
    footer.append(share);
    card.append(footer);
    card.addEventListener('click', event => { if (!event.target.closest('button')) call('preview', item.id).catch(() => {}); });
    card.addEventListener('keydown', event => { if (event.key === 'Enter') call('preview', item.id).catch(() => {}); });
    card.addEventListener('contextmenu', event => { event.preventDefault(); call('menu', item.id).catch(() => {}); });
    rail.append(card);
  }
  rail.scrollLeft = previousScroll;
}
function startReorder(event, card, rail) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  card.classList.add('reordering');
  selectionActive = true; api.hitTest(true);
  const move = e => {
    const cards = [...rail.querySelectorAll('.card')].filter(other => other !== card);
    const next = cards.find(other => { const rect = other.getBoundingClientRect(); return e.clientX < rect.left + rect.width / 2; });
    if (next) rail.insertBefore(card, next); else rail.append(card);
    const bounds = rail.getBoundingClientRect();
    if (e.clientX < bounds.left + 40) rail.scrollLeft -= 20;
    if (e.clientX > bounds.right - 40) rail.scrollLeft += 20;
  };
  const finish = e => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', cancel);
    card.classList.remove('reordering'); selectionActive = false;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    call('reorder', [...rail.querySelectorAll('.card')].map(element => element.dataset.id)).catch(() => renderRope());
  };
  const cancel = () => { selectionActive = false; renderRope(); };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', cancel, { once: true });
}

function renderSettings() {
  root.replaceChildren();
  const page = node('section', 'settings-page');
  page.append(node('span', 'eyebrow', 'A LITTLE ROOM FOR IDEAS'), node('h1', '', '让晒衣绳顺手一点'), node('p', '', '截图留在本机。选一个习惯的位置，随时挂起灵感。'));
  const fields = {};
  function field(key, title, element) {
    fields[key] = element;
    const label = node('label', 'field');
    label.append(node('span', '', title), element); page.append(label);
  }
  const shortcut = node('input'); shortcut.value = state.settings.shortcut;
  field('shortcut', '区域截图快捷键', shortcut);
  const display = node('select');
  const primary = node('option', '', '主显示器'); primary.value = ''; display.append(primary);
  for (const item of state.displays) { const option = node('option', '', item.label); option.value = item.id; display.append(option); }
  display.value = state.settings.displayId;
  field('displayId', '晒衣绳与截图所在显示器', display);
  const position = node('select');
  for (const [value, title] of [['top', '屏幕顶部'], ['bottom', '屏幕底部']]) { const option = node('option', '', title); option.value = value; position.append(option); }
  position.value = state.settings.position; field('position', '绳子位置', position);
  const folder = node('input'); folder.value = state.settings.savePath; folder.readOnly = true; folder.placeholder = '默认使用系统图片目录'; fields.savePath = folder;
  const folderLabel = node('label', 'field'); folderLabel.append(node('span', '', '另存为默认目录'));
  const folderRow = node('div', 'row'); folderRow.append(folder, button('选择…', async () => { const value = await call('pick-folder'); if (value) folder.value = value; }));
  folderLabel.append(folderRow); page.append(folderLabel);
  for (const [key, title] of [['alwaysOnTop', '始终置顶'], ['autoCopy', '截图后自动复制到剪贴板'], ['launchAtLogin', '开机启动（安装或打包后可用）']]) {
    const input = node('input'); input.type = 'checkbox'; input.checked = state.settings[key]; fields[key] = input;
    const label = node('label', 'check'); label.append(input, node('span', '', title)); page.append(label);
  }
  page.append(node('small', '', '快捷键示例：CommandOrControl+Shift+2。冲突时会提示并保留原设置。绳子占用的透明空白区域可穿透鼠标。'));
  const footer = node('div', 'row settings-footer');
  footer.append(button('查看本地数据', () => call('show-data')), node('span', 'grow'), button('保存设置', async () => {
    const settings = {};
    for (const [key, input] of Object.entries(fields)) settings[key] = input.type === 'checkbox' ? input.checked : input.value;
    await call('apply-settings', settings); toast('设置已保存');
  }, 'primary'));
  page.append(footer); root.append(page);
}

function renderCapture(data) {
  root.replaceChildren();
  document.addEventListener('keydown', event => { if (event.key === 'Escape') call('cancel-capture').catch(() => {}); });
  if (data.kind === 'window') {
    const page = node('section', 'window-picker');
    const header = node('div', 'row'); header.append(node('h1', '', '选一扇窗口，挂到绳子上'), node('span', 'grow'), button('取消 · Esc', () => call('cancel-capture')));
    page.append(header, node('p', 'muted', '选择当前打开的窗口。受保护内容可能无法捕获；最小化窗口请先恢复。'));
    const grid = node('div', 'source-grid');
    for (const source of data.sources) {
      const choice = button('', async () => {
        for (const button of grid.querySelectorAll('button')) button.disabled = true;
        await call('choose-window', source.id);
      }, 'source');
      const image = node('img'); image.src = source.thumbnail; image.alt = source.name;
      choice.append(image, node('span', '', source.name)); grid.append(choice);
    }
    page.append(grid); root.append(page); return;
  }
  const image = node('img', 'frozen'); image.src = data.image; image.alt = '冻结的屏幕画面';
  const shade = node('div', 'capture-shade');
  const selection = node('div', 'selection');
  const tip = node('div', 'capture-tip', '拖动选择区域 · 松开挂到绳子上 · Esc 取消');
  root.append(image, shade, selection, tip);
  let start, rect, busy = false;
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || busy) return;
    start = { x: event.clientX, y: event.clientY };
    document.body.setPointerCapture(event.pointerId);
    shade.hidden = true; selection.classList.add('visible'); update(event);
  });
  function update(event) {
    if (!start) return;
    const x = Math.max(0, Math.min(innerWidth, event.clientX));
    const y = Math.max(0, Math.min(innerHeight, event.clientY));
    rect = { x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
    Object.assign(selection.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    tip.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} · 松开截图 · Esc 取消`;
  }
  document.addEventListener('pointermove', update);
  document.addEventListener('pointerup', async event => {
    if (!start || busy) return;
    update(event); start = null;
    if (rect.width < 3 || rect.height < 3) { selection.classList.remove('visible'); shade.hidden = false; return; }
    busy = true;
    try { await call('select-region', { rect, viewport: { width: innerWidth, height: innerHeight } }); }
    catch { busy = false; }
  });
}

async function renderEditor() {
  const id = params.get('id');
  let record = await call('image', id);
  root.replaceChildren();
  const header = node('header', 'editor-header');
  const headingRow = node('div', 'row');
  headingRow.append(node('h1', 'grow', record.item.title), button('复制', () => call('copy', id).then(() => toast('已复制已保存的图片'))),
    button('另存为', () => call('save', id)), button('完成', () => call('close'), 'primary'));
  header.append(headingRow, node('p', '', `${record.item.width} × ${record.item.height} · 原图一直保留 · 标注后先保存，再复制或分享`));
  const tools = node('div', 'tools');
  const stage = node('div', 'stage');
  const canvas = node('canvas'); canvas.width = record.item.width; canvas.height = record.item.height;
  stage.append(canvas);
  const footer = node('footer', 'row editor-footer');
  const status = node('span', 'grow', '点击工具后，在图片上拖动；文字工具使用右侧文本。');
  const share = button('↗ 拖拽分享', () => toast('按住按钮拖动到其他应用，分享已保存的 PNG 文件'));
  enableNativeDrag(share, id); footer.append(status, share);
  root.append(header, tools, stage, footer);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let base = await loadImage(record.data), operations = [], undone = [], draft, tool = 'pen', start, dirty = false;
  const toolButtons = [];
  for (const [value, title] of [['pen', '画笔'], ['arrow', '箭头'], ['text', '文字'], ['highlight', '高亮'], ['mosaic', '马赛克']]) {
    const element = button(title, () => { tool = value; for (const entry of toolButtons) entry.button.classList.toggle('active', entry.value === tool); }, value === tool ? 'active' : '');
    toolButtons.push({ value, button: element }); tools.append(element);
  }
  const color = node('input'); color.type = 'color'; color.value = '#e45b42'; color.title = '标注颜色';
  const width = node('input'); width.type = 'number'; width.value = '5'; width.min = '1'; width.max = '40'; width.title = '线宽 / 字号基准';
  const text = node('input'); text.type = 'text'; text.placeholder = '输入标注文字'; text.maxLength = 300;
  const undoButton = button('撤销', () => { if (operations.length) { undone.push(operations.pop()); changed(); } });
  const redoButton = button('重做', () => { if (undone.length) { operations.push(undone.pop()); changed(); } });
  tools.append(color, width, text, undoButton, redoButton,
    button('保存标注', async () => {
      await call('edit', { id, data: canvas.toDataURL('image/png') });
      base = await loadImage(canvas.toDataURL()); operations = []; undone = []; dirty = false;
      await call('dirty', { id, value: false }); render(); status.textContent = '标注已保存，可以复制或拖拽分享。'; toast('已保存，原图仍保留');
    }, 'primary'),
    button('恢复原图', async () => {
      const restored = await call('reset-image', id);
      if (restored) { record = await call('image', id); base = await loadImage(record.data); operations = []; undone = []; dirty = false; await call('dirty', { id, value: false }); render(); }
    }));
  function fit() {
    const space = stage.getBoundingClientRect();
    const ratio = Math.min((space.width - 40) / canvas.width, (space.height - 40) / canvas.height, 1);
    canvas.style.width = `${Math.max(1, canvas.width * ratio)}px`;
    canvas.style.height = `${Math.max(1, canvas.height * ratio)}px`;
  }
  new ResizeObserver(fit).observe(stage); fit();
  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)) };
  }
  function changed() {
    dirty = operations.length > 0;
    call('dirty', { id, value: dirty }).catch(() => {});
    status.textContent = dirty ? '有未保存的标注，保存后再复制或分享。' : '当前画面已保存。'; render();
  }
  function render() {
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(base, 0, 0);
    for (const operation of operations) draw(operation);
    if (draft) draw(draft);
    undoButton.disabled = !operations.length; redoButton.disabled = !undone.length;
  }
  function draw(op) {
    context.save(); context.strokeStyle = op.color; context.fillStyle = op.color;
    context.lineWidth = op.width; context.lineCap = 'round'; context.lineJoin = 'round';
    if (op.type === 'pen') {
      context.beginPath(); context.moveTo(op.points[0].x, op.points[0].y);
      if (op.points.length === 1) { context.lineTo(op.points[0].x + .1, op.points[0].y + .1); }
      else for (const p of op.points.slice(1)) context.lineTo(p.x, p.y);
      context.stroke();
    } else if (op.type === 'text') {
      context.font = `600 ${Math.max(18, op.width * 5)}px "Microsoft YaHei", sans-serif`;
      context.textBaseline = 'top'; context.fillText(op.text, op.start.x, op.start.y);
    } else {
      const a = op.start, b = op.end;
      const x = Math.floor(Math.min(a.x, b.x)), y = Math.floor(Math.min(a.y, b.y));
      const w = Math.min(canvas.width - x, Math.ceil(Math.abs(b.x - a.x))), h = Math.min(canvas.height - y, Math.ceil(Math.abs(b.y - a.y)));
      if (op.type === 'arrow') {
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.max(15, op.width * 4);
        context.beginPath(); context.moveTo(b.x, b.y);
        context.lineTo(b.x - length * Math.cos(angle - .45), b.y - length * Math.sin(angle - .45));
        context.lineTo(b.x - length * Math.cos(angle + .45), b.y - length * Math.sin(angle + .45)); context.closePath(); context.fill();
      } else if (op.type === 'highlight') {
        context.globalAlpha = .32; context.fillRect(x, y, w, h);
      } else if (op.type === 'mosaic' && w > 0 && h > 0) {
        const block = Math.max(12, op.width * 4);
        for (let cy = y; cy < y + h; cy += block) for (let cx = x; cx < x + w; cx += block) {
          const bw = Math.min(block, x + w - cx), bh = Math.min(block, y + h - cy);
          const pixels = context.getImageData(cx, cy, bw, bh).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < pixels.length; i += 4) { r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; }
          const count = pixels.length / 4;
          context.fillStyle = `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`; context.fillRect(cx, cy, bw, bh);
        }
      }
    }
    context.restore();
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    start = point(event); canvas.setPointerCapture(event.pointerId);
    const lineWidth = Math.max(1, Math.min(40, Number(width.value) || 5));
    draft = { type: tool, color: color.value, width: lineWidth, start, end: start, points: [start], text: text.value };
    if (tool === 'text') {
      if (!text.value.trim()) { toast('先输入标注文字，再点击图片'); draft = null; start = null; return; }
      operations.push(draft); draft = null; start = null; undone = []; changed();
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (!start || !draft) return;
    const p = point(event); draft.end = p;
    if (draft.type === 'pen') draft.points.push(p);
    render();
  });
  canvas.addEventListener('pointerup', event => {
    if (!draft || !start) return;
    draft.end = point(event); operations.push(draft); draft = null; start = null; undone = []; changed();
  });
  canvas.addEventListener('pointercancel', () => { draft = null; start = null; render(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.closest('input')) {
      event.preventDefault(); (event.shiftKey ? redoButton : undoButton).click();
    }
  });
  render();
}
function loadImage(data) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片解码失败')); image.src = data;
  });
}

if (mode === 'rope') {
  document.addEventListener('mousemove', event => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    api.hitTest(selectionActive || Boolean(target?.closest('[data-interactive]')));
  });
  document.addEventListener('mouseleave', () => { if (!selectionActive) api.hitTest(false); });
}
api.onState(next => {
  state = next;
  if (mode === 'rope' && !selectionActive) renderRope();
});
(async () => {
  state = await call('state');
  if (mode === 'rope') renderRope();
  else if (mode === 'settings') renderSettings();
  else if (mode === 'capture') renderCapture(state);
  else if (mode === 'editor') await renderEditor();
  if (state.warning) toast(state.warning);
})().catch(error => { root.append(node('p', '', `加载失败：${error.message}`)); });
