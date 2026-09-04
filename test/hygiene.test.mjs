/* Text properties of the repo that the directory's scanner, the design
 * system and the team's hard rules each check; checked here first. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(resolve(repo, f), 'utf8');

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const prose = ['README.md', 'SECURITY.md', 'THIRD-PARTY-NOTICES.md', 'manifest.json', 'src/terminal.css', 'esbuild.config.mjs', 'eslint.config.mjs']
  .map((f) => resolve(repo, f))
  .concat(walk(resolve(repo, 'src'), ['.ts', '.py']), walk(resolve(repo, 'test'), ['.mjs', '.ts', '.html']), walk(resolve(repo, 'tools'), ['.mjs']));

test('no em dash or en dash anywhere in the repo text', () => {
  const hits = [];
  for (const f of prose) {
    const text = readFileSync(f, 'utf8');
    for (const [i, line] of text.split('\n').entries()) {
      if (/[\u2014\u2013]/.test(line)) hits.push(`${f.slice(repo.length + 1)}:${i + 1}`);
    }
  }
  assert.deepEqual(hits, [], `dashes at:\n  ${hits.join('\n  ')}`);
});

/* The shipped stylesheet, section 2, with comments blanked so line numbers hold. */
const shipped = read('styles.css');
const ownStart = shipped.indexOf('2. ICOR for Life - Terminal');
assert.ok(ownStart > 0, 'styles.css carries the assembled section marker');
/* Comments are blanked BEFORE slicing, so the section marker comment itself
   cannot be read as a selector; blanking keeps every line in place. */
const own = shipped.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).slice(ownStart);

test('every colour in the plugin css rides a token: raw hex only inside the token blocks', () => {
  const offenders = [];
  for (const block of own.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim();
    const isTokenBlock = /^\.ict-root, \.ict-settings|^\.theme-dark \.ict-root/.test(selector);
    if (isTokenBlock) continue;
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(block[2])) offenders.push(selector);
  }
  assert.deepEqual(offenders, [], `raw colours outside the token blocks in:\n  ${offenders.join('\n  ')}`);
});

test('every token in the block defers to an --ink-* channel first', () => {
  const block = own.match(/\.ict-root, \.ict-settings[^{]*\{([^}]*)\}/)[1];
  const bad = [...block.matchAll(/(--ict-[a-z0-9-]+):\s*([^;]+);/g)].filter((m) => !/^var\(--ink-/.test(m[2].trim())).map((m) => m[1]);
  assert.deepEqual(bad, []);
});

test('the shipped stylesheet carries none of the findings the directory scanner rejects', () => {
  assert.doesNotMatch(shipped, /!important/, '!important survived assembly');
  assert.doesNotMatch(shipped, /^\s*user-select\s*:/m, 'unprefixed user-select survived assembly');
  assert.doesNotMatch(shipped, /^\s*-ms-user-select\s*:/m);
  assert.doesNotMatch(shipped, /^\s*resize\s*:/m);
  assert.doesNotMatch(shipped, /::selection/);
  assert.match(shipped, /\.xterm \.xterm-dim \{[^}]*opacity: 1;/, 'the dim reset is kept without the flag');
  assert.match(shipped, /Copyright \(c\) 2014 The xterm\.js authors/, 'xterm.css ships with its licence header');
});

test('source carries nothing the scanner reads as obfuscation or self-modification', () => {
  for (const f of walk(resolve(repo, 'src'), ['.ts'])) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /\beval\(/, f);
    assert.doesNotMatch(s, /new Function\(/, f);
    assert.doesNotMatch(s, /require\s*=|window\.require\./, f);
    assert.doesNotMatch(s, /role:\s*'button'|role="button"/, `${f}: a div pretending to be a button`);
  }
});

test('the bundle carries the helper as text and no other executable payload', () => {
  const main = read('main.js');
  assert.match(main, /pty\.fork\(\)/, 'the helper source is in the bundle');
  assert.doesNotMatch(main, /\.node["']/, 'no native module reference');
  assert.match(main, /Copyright \(c\) 2014 The xterm\.js authors|xterm/, 'xterm is bundled');
});
