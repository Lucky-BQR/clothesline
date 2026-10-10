'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const archive = path.join(root, 'release/win-unpacked/resources/app.asar');
const files = asar.listPackage(archive);
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
if (packaged.version !== version || packaged.name !== 'clothesline-desktop') {
  throw new Error(`打包版本不一致：期望 ${version}，实际 ${packaged.version}`);
}
const source = ['main.js', 'core.js', 'preload.js', 'icon.png', 'icon.ico', 'icon.svg', 'ui/app.js', 'ui/index.html', 'ui/style.css'];
for (const file of source) {
  const relative = path.join('src', file);
  if (!asar.extractFile(archive, relative).equals(fs.readFileSync(path.join(root, relative)))) {
    throw new Error(`打包内容与源码不一致：${relative}`);
  }
}
if (files.some(file => /[\\/](node_modules|test-results|test)[\\/]/.test(file))) throw new Error('应用包含不应发布的测试或依赖文件');
const artifacts = [`Clothesline-Setup-${version}-x64.exe`, `Clothesline-Portable-${version}-x64.exe`].map(name => {
  const bytes = fs.readFileSync(path.join(root, 'release', name));
  if (bytes.subarray(0, 2).toString() !== 'MZ') throw new Error(`不是 Windows 可执行程序：${name}`);
  return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const report = { version, sourceMatches: true, noDevelopmentFiles: true, artifacts };
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-results/release.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, 'release/SHA256SUMS.txt'), artifacts.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n');
console.log(JSON.stringify(report, null, 2));
