/* THE ENTRY POINT IS OBSIDIAN'S OWN RIBBON (0.3.1).
 *
 * Tom, 2026-11-23: the row of icons under the logo goes, and every plugin's
 * launcher moves to the ribbon on the left, so members can reorder or hide it
 * in Settings, Appearance, Ribbon menu like any other plugin's icon. Up to
 * 0.3.0 this plugin also put a button into the file explorer's tool-button
 * row (`.nav-buttons-container`).
 *
 * A source scan, with the assembled stylesheet and the build checked too: the
 * plugin class needs the whole Obsidian surface to load, and the thing to
 * prove is an absence. No code names the explorer's row, `addRibbonIcon` is
 * called exactly once, with a tooltip, and that icon opens the launcher
 * menu. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blank = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}
const src = sources(resolve(repo, 'src')).map((p) => [p, blank(readFileSync(p, 'utf8'))]);
const main = blank(readFileSync(resolve(repo, 'src/main.ts'), 'utf8'));

test('nothing is written into the file explorer\'s tool-button row', () => {
  const offenders = src.filter(([, code]) => /nav-buttons-container|nav-action-button|ict-tree-launcher/.test(code)).map(([p]) => p);
  assert.deepEqual(offenders, [], 'source still reaches into .nav-buttons-container');
  assert.doesNotMatch(readFileSync(resolve(repo, 'styles.css'), 'utf8'), /ict-tree-launcher/, 'the stylesheet still styles the row button');
  const build = resolve(repo, 'main.js');
  if (existsSync(build)) {
    assert.doesNotMatch(readFileSync(build, 'utf8'), /nav-buttons-container/, 'the build still reaches into .nav-buttons-container');
  }
});

test('exactly one ribbon icon, with a tooltip, opening the launcher menu', () => {
  const calls = src.flatMap(([p, code]) => (code.match(/\.addRibbonIcon\(/g) || []).map(() => p));
  assert.equal(calls.length, 1, `addRibbonIcon is called ${calls.length} times: ${calls.join(', ')}`);
  const call = main.match(/this\.addRibbonIcon\(\s*TERMINAL_ICON,\s*(\w+),\s*\(evt\)\s*=>\s*\{[\s\S]*?this\.openLauncherMenu\(/);
  assert.ok(call, 'the ribbon icon must open the launcher menu');
  const tooltip = main.match(new RegExp(`const ${call[1]} = '([^']+)'`));
  assert.ok(tooltip && /^[A-Z]/.test(tooltip[1]), 'the ribbon icon has a sentence-case tooltip');
});
