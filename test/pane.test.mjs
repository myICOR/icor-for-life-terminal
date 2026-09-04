import test from 'node:test';
import assert from 'node:assert/strict';
import { exitKicker, exitNote, isFailure, readPalette, readFontFamily, paletteTokens, PALETTE_TOKENS } from './build/pure.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the exit row prints only what the process reported', () => {
  assert.equal(exitKicker({ code: 0, signal: null, ready: true, detail: '' }), 'Exited · code 0');
  assert.equal(exitKicker({ code: 130, signal: null, ready: true, detail: '' }), 'Exited · code 130');
  assert.equal(exitKicker({ code: null, signal: 'SIGHUP', ready: true, detail: '' }), 'Ended by SIGHUP');
  assert.equal(exitKicker({ code: 1, signal: null, ready: false, detail: 'python3: not found' }), 'Could not start');
  assert.ok(!isFailure({ code: 0, signal: null, ready: true, detail: '' }));
  assert.ok(isFailure({ code: 1, signal: null, ready: true, detail: '' }));
  assert.ok(isFailure({ code: 0, signal: null, ready: false, detail: '' }));
  assert.match(exitNote({ code: 0, signal: null, ready: true, detail: '' }), /start another\?/);
});

test('the palette reads every token and drops the ones the stylesheet did not resolve', () => {
  const full = readPalette((t) => `${t}-value`);
  assert.equal(Object.keys(full).length, Object.keys(PALETTE_TOKENS).length);
  assert.equal(full.background, '--ict-bg-value');
  const partial = readPalette((t) => (t === '--ict-bg' ? ' #101010 ' : ''));
  assert.deepEqual(partial, { background: '#101010', cursorAccent: '#101010' });
  assert.equal(readFontFamily(() => ' Mono ', ''), 'Mono');
  assert.equal(readFontFamily(() => 'Mono', 'Menlo'), 'Menlo');
  assert.match(readFontFamily(() => '', ''), /monospace/);
});

test('every token the code reads is declared in the stylesheet token block', () => {
  const css = readFileSync(resolve(repo, 'src/terminal.css'), 'utf8');
  const declared = new Set([...css.matchAll(/(--ict-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const token of [...paletteTokens(), '--ict-search-match', '--ict-search-active']) {
    assert.ok(declared.has(token), `${token} is read by the plugin but not declared in src/terminal.css`);
  }
});
