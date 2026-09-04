/* Identity and floor. The manifest id, the constant the roots stamp and the
 * package name are one string; the version is one string across three files;
 * and every named import from 'obsidian' exists at the declared minAppVersion,
 * read from the @since annotations in obsidian.d.ts, the same source the
 * directory's scanner reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { INK_PLUGIN_NAME, PLUGIN_ID, VIEW_TYPE_TERMINAL } from './build/pure.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(resolve(repo, f), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const versions = JSON.parse(read('versions.json'));

test('one identity across manifest, package and constants', () => {
  assert.equal(manifest.id, 'icor-for-life-terminal');
  assert.equal(PLUGIN_ID, manifest.id);
  assert.equal(INK_PLUGIN_NAME, manifest.id);
  assert.equal(VIEW_TYPE_TERMINAL, manifest.id);
  assert.equal(pkg.name, manifest.id);
  assert.equal(manifest.author, 'myICOR');
  assert.equal(manifest.isDesktopOnly, true, 'a plugin that spawns processes is desktop only');
  assert.equal(manifest.minAppVersion, '1.7.2');
});

test('one version across manifest, package and versions.json', () => {
  assert.equal(pkg.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
});

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const cmp = (a, b) => {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
};

test('every named import from obsidian exists at minAppVersion', () => {
  const dts = read('node_modules/obsidian/obsidian.d.ts');
  const since = new Map();
  for (const m of dts.matchAll(/\/\*\*([^]*?)\*\/\s*export (?:abstract )?(?:class|function|interface|type|const|enum|let|var) (\w+)/g)) {
    const s = m[1].match(/@since (\d+\.\d+\.\d+)/);
    if (s && !since.has(m[2])) since.set(m[2], s[1]);
  }
  const floor = manifest.minAppVersion;
  const offenders = [];
  for (const file of walk(resolve(repo, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import (?:type )?\{([^}]*)\} from 'obsidian'/g)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (!name) continue;
        const s = since.get(name);
        if (s && cmp(s, floor) > 0) offenders.push(`${name} (@since ${s}) in ${file.slice(repo.length + 1)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `newer than minAppVersion ${floor}:\n  ${offenders.join('\n  ')}`);
});
