import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(resolve(root, 'src/00-config.js'), 'utf8');
const storage = readFileSync(resolve(root, 'src/01-storage.js'), 'utf8');
const header = readFileSync(resolve(root, 'userscript.header.js'), 'utf8');

function evaluate(settings = {}) {
  const saved = new Map(Object.entries(settings));
  const sandbox = {
    GM_getValue: key => saved.get(key),
    GM_setValue: (key, value) => saved.set(key, value),
  };
  const actual = runInNewContext(
    `${config}\n${storage}\nloadConfig().backendUrl`,
    sandbox,
  );
  return { actual, saved };
}

test('new installations use the current canonical backend', () => {
  const { actual, saved } = evaluate();
  assert.equal(actual, 'https://timetable.yanze.me');
  assert.equal(saved.size, 0);
});

test('saved legacy backend is migrated without dropping other preferences', () => {
  const { actual, saved } = evaluate({
    'seqtaCal.backendUrl': 'https://timetable.leoze.top/',
    'seqtaCal.weeksAhead': 4,
  });
  assert.equal(actual, 'https://timetable.yanze.me');
  assert.equal(saved.get('seqtaCal.backendUrl'), 'https://timetable.yanze.me');
  assert.equal(saved.get('seqtaCal.weeksAhead'), 4);
});

test('custom backend address remains untouched', () => {
  const { actual, saved } = evaluate({
    'seqtaCal.backendUrl': 'https://custom.example.test/',
  });
  assert.equal(actual, 'https://custom.example.test');
  assert.equal(saved.get('seqtaCal.backendUrl'), 'https://custom.example.test/');
});

test('Tampermonkey connect permissions include the canonical backend', () => {
  assert.match(header, /^\/\/ @connect\s+timetable\.yanze\.me$/m);
});
