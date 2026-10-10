'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
      else console.log(`OK ${path.relative(process.cwd(), file)}`);
    }
  }
}
for (const directory of ['src', 'scripts', 'test']) check(path.resolve(__dirname, '..', directory));
