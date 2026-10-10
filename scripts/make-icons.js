'use strict';
// Original vector primitives shared by editable SVG and antialiased PNG/ICO exports.
// No fonts, external art, native rendering dependency or network required.
const fs = require('node:fs');
const path = require('node:path');
const { png } = require('./png');
const color = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function shapes(small = false) {
  const list = [];
  const add = (kind, fill, data, rotate = 0) => list.push({ kind, fill, ...data, rotate });
  // Matte graphite, warm ivory and a restrained brass accent; no illustration.
  add('round', '#20272B', { x: 10, y: 10, w: 236, h: 236, r: 52 });
  // A quiet cord and a single geometric peg preserve the clothesline metaphor.
  const cord = [];
  for (let i = 0; i <= 24; i++) { const x = 30 + i * 196 / 24; cord.push([x, 73 + 9 * (1 - ((x - 128) / 98) ** 2)]); }
  for (let i = 24; i >= 0; i--) { const x = 30 + i * 196 / 24; cord.push([x, 73 + (small ? 6 : 4) + 9 * (1 - ((x - 128) / 98) ** 2)]); }
  add('polygon', '#BDA47A', { points: cord });
  add('round', '#F3F0E7', { x: 62, y: 83, w: 132, h: 128, r: 12 });
  if (!small) {
    // Four capture corners communicate a screenshot without a decorative photo.
    for (const [x, y, dx, dy] of [[86, 125, 1, 1], [170, 125, -1, 1], [86, 183, 1, -1], [170, 183, -1, -1]]) {
      add('round', '#697171', { x: dx > 0 ? x : x - 17, y: dy > 0 ? y : y - 4, w: 17, h: 4, r: 1 });
      add('round', '#697171', { x: dx > 0 ? x : x - 4, y: dy > 0 ? y : y - 17, w: 4, h: 17, r: 1 });
    }
  }
  add('round', '#BDA47A', { x: small ? 114 : 116, y: 44, w: small ? 28 : 24, h: 70, r: 4 });
  add('round', '#20272B', { x: small ? 114 : 116, y: 78, w: small ? 28 : 24, h: 4, r: 0 });
  return list;
}
function local(shape, x, y) {
  const angle = -shape.rotate * Math.PI / 180;
  const dx = x - 128, dy = y - 128;
  return [128 + dx * Math.cos(angle) - dy * Math.sin(angle), 128 + dx * Math.sin(angle) + dy * Math.cos(angle)];
}
function contains(s, x, y) {
  [x, y] = local(s, x, y);
  if (s.kind === 'circle') return (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r ** 2;
  if (s.kind === 'round') {
    if (x < s.x || y < s.y || x > s.x + s.w || y > s.y + s.h) return false;
    const cx = Math.max(s.x + s.r, Math.min(s.x + s.w - s.r, x));
    const cy = Math.max(s.y + s.r, Math.min(s.y + s.h - s.r, y));
    return (x - cx) ** 2 + (y - cy) ** 2 <= s.r ** 2;
  }
  let inside = false;
  for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
    const [xi, yi] = s.points[i], [xj, yj] = s.points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function painter(size) {
  const list = shapes(size <= 24).map(s => ({ ...s, rgb: color(s.fill) }));
  return (x, y) => {
    const sum = [0, 0, 0]; let hits = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) * 256 / size, py = (y + (sy + .5) / 4) * 256 / size;
      for (let i = list.length - 1; i >= 0; i--) if (contains(list[i], px, py)) {
        list[i].rgb.forEach((v, c) => { sum[c] += v; }); hits++; break;
      }
    }
    return hits ? [...sum.map(v => Math.round(v / hits)), Math.round(255 * hits / 16)] : [0, 0, 0, 0];
  };
}
function svg() {
  const body = shapes().map(s => {
    const style = `fill="${s.fill}" transform="rotate(${s.rotate} 128 128)"`;
    if (s.kind === 'round') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" ${style}/>`;
    if (s.kind === 'circle') return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" ${style}/>`;
    return `<polygon points="${s.points.map(p => p.join(',')).join(' ')}" ${style}/>`;
  }).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title">\n  <title id="title">Clothesline — a screenshot held by a wooden peg</title>\n  ${body}\n</svg>\n`;
}
exports.build = () => {
  const root = path.resolve(__dirname, '..');
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = sizes.map(size => png(size, size, painter(size)));
  fs.writeFileSync(path.join(root, 'src/icon.svg'), svg());
  fs.writeFileSync(path.join(root, 'src/icon.png'), images.at(-1));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  fs.writeFileSync(path.join(root, 'src/icon.ico'), Buffer.concat([header, ...images]));
  const previewSize = 576;
  const large = painter(192), small = sizes.slice(0, 4).map(painter);
  const board = png(previewSize, 256, (x, y) => {
    let bg = x < 288 ? [248, 246, 236] : [29, 38, 33];
    let fg;
    if (x >= 42 && x < 234 && y >= 32 && y < 224) fg = large(x - 42, y - 32);
    for (let i = 0; i < 4; i++) {
      const size = sizes[i], left = 328 + i * 52, top = 112 - Math.floor(size / 2);
      if (x >= left && x < left + size && y >= top && y < top + size) fg = small[i](x - left, y - top);
    }
    if (!fg) return [...bg, 255];
    return [...bg.map((v, i) => Math.round(v * (1 - fg[3] / 255) + fg[i] * fg[3] / 255)), 255];
  });
  fs.mkdirSync(path.join(root, 'design'), { recursive: true });
  fs.writeFileSync(path.join(root, 'design/icon-preview.png'), board);
  console.log(`Generated editable SVG, 256px PNG and ICO sizes: ${sizes.join(', ')}; design/icon-preview.png`);
};
if (require.main === module) exports.build();
