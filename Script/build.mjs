import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8'));
const header = readFileSync(join(root, 'userscript.header.js'), 'utf8')
  .trimEnd()
  .replace(/^(\/\/ @version\s+).+$/m, `$1${pkg.version}`);
const parts = readdirSync(join(root, 'src'))
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => readFileSync(join(root, 'src', name), 'utf8').trimEnd());

const body = parts.join('\n\n');
const output = `${header}\n\n(function seqtaCalendarSync() {\n  'use strict';\n\n${body}\n})();\n`;

writeFileSync(join(root, 'seqta-calendar-sync.user.js'), output);
console.log(`Built ${join(root, 'seqta-calendar-sync.user.js')} (${output.split('\n').length} lines)`);
