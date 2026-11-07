/* Vault paths in terminal output become links only when the vault holds the
   file. The live half is in dom.test.mjs, on a real xterm buffer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findVaultPaths, logicalLine, toVaultPath, VaultLinkProvider } from './build/pure.mjs';

const FILES = new Set([
  '04 Inner World/My Life/Key Elements/Health.md',
  '04 Inner World/Notes/Touche à Bâle.md',
  '06 AI Team/README.md',
  'README.md',
  'Assets/scan.pdf',
  'Notes/café.md',
]);
const ctx = { vaultName: 'zenjk', vaultRoot: '/Users/me/zenjk', isFile: (p) => FILES.has(p) };
const paths = (text, c = ctx) => findVaultPaths(text, c).map((m) => [text.slice(m.start, m.end), m.path]);

test('a vault-relative path with spaces is found whole', () => {
  const p = '04 Inner World/My Life/Key Elements/Health.md';
  assert.deepEqual(paths(p), [[p, p]]);
  assert.deepEqual(paths(`see ${p} now`), [[p, p]]);
  assert.deepEqual(paths(`| note | ${p} |`), [[p, p]]);
  assert.deepEqual(paths(`(${p}), and`), [[p, p]]);
  assert.deepEqual(paths(`\`${p}\`.`), [[p, p]]);
});

test('this vault\'s name in front is part of the link; another vault\'s name means no link', () => {
  const p = '06 AI Team/README.md';
  assert.deepEqual(paths(`zenjk: ${p}`), [[`zenjk: ${p}`, p]]);
  assert.deepEqual(paths(`| x | zenjk: ${p} |`), [[`zenjk: ${p}`, p]]);
  assert.deepEqual(paths(`m42: ${p}`), [], 'the same path in the other vault is not this file');
  assert.deepEqual(paths(`m42: ${p} and zenjk: README.md`), [['zenjk: README.md', 'README.md']]);
});

test('non-ASCII names match, composed or decomposed', () => {
  assert.deepEqual(paths('zenjk: 04 Inner World/Notes/Touche à Bâle.md'), [
    ['zenjk: 04 Inner World/Notes/Touche à Bâle.md', '04 Inner World/Notes/Touche à Bâle.md'],
  ]);
  assert.deepEqual(paths('Notes/café.md'), [['Notes/café.md', 'Notes/café.md']]);
});

test('an absolute path inside the vault folder links to the same file', () => {
  assert.deepEqual(paths('Read /Users/me/zenjk/06 AI Team/README.md'), [['/Users/me/zenjk/06 AI Team/README.md', '06 AI Team/README.md']]);
  assert.deepEqual(paths('Read /Users/me/other/README.md'), [], 'outside the vault folder is no link');
});

test('several paths on one line, any extension the vault holds', () => {
  assert.deepEqual(paths('README.md, Assets/scan.pdf and 06 AI Team/README.md.'), [
    ['README.md', 'README.md'],
    ['Assets/scan.pdf', 'Assets/scan.pdf'],
    ['06 AI Team/README.md', '06 AI Team/README.md'],
  ]);
});

test('nothing that is not an existing vault file is a link', () => {
  assert.deepEqual(paths('04 Inner World/Missing.md'), []);
  assert.deepEqual(paths('README.md.bak'), [], 'a longer name is a different file');
  assert.deepEqual(paths('xREADME.md'), [], 'a path starts at a boundary');
  assert.deepEqual(paths('https://example.invalid/README.md'), []);
  assert.deepEqual(paths('obsidian://open?file=README.md'), []);
  assert.deepEqual(paths('just text, no file.'), []);
  assert.deepEqual(paths(`${'a '.repeat(1100)}README.md`), [], 'an overlong line is not searched');
});

test('no candidate can leave the vault or reach the adapter unnormalised', () => {
  for (const bad of ['../README.md', 'a/../README.md', './README.md', '/etc/passwd.md', 'a//b.md', 'a\\b.md', '']) {
    assert.equal(toVaultPath(bad, ctx.vaultRoot), null, JSON.stringify(bad));
  }
  assert.equal(toVaultPath('/Users/me/zenjk/../secret.md', ctx.vaultRoot), null);
  assert.equal(toVaultPath('/Users/me/zenjkother/a.md', ctx.vaultRoot), null);
  const asked = [];
  findVaultPaths('../README.md /etc/x.md /Users/me/zenjk/../y.md', { ...ctx, isFile: (p) => (asked.push(p), false) });
  assert.ok(asked.every((p) => !p.startsWith('/') && !p.split('/').includes('..')), asked.join(' | '));
});

/* A fake buffer: rows of cells, a wide character as a width-2 cell and a width-0 spacer. */
function rows(cols, ...texts) {
  return texts.map((t, i) => {
    const cells = [];
    for (const ch of t) {
      if (ch === '中') cells.push({ c: ch, w: 2 }, { c: '', w: 0 });
      else cells.push({ c: ch, w: 1 });
    }
    while (cells.length < cols) cells.push({ c: '', w: 1 });
    return {
      isWrapped: i > 0,
      length: cols,
      getCell: (x) => (cells[x] ? { getChars: () => cells[x].c, getWidth: () => cells[x].w } : undefined),
    };
  });
}

test('a path wrapped over rows is one logical line, each character on its own cell', () => {
  const buf = rows(10, 'zenjk: 06 ', 'AI Team/RE', 'ADME.md');
  for (const y of [0, 1, 2]) {
    const { text, cells } = logicalLine((i) => buf[i], y);
    assert.equal(text.trimEnd(), 'zenjk: 06 AI Team/README.md', `row ${y}`);
    assert.deepEqual(cells[0], { x: 1, y: 1 });
    assert.deepEqual(cells[10], { x: 1, y: 2 });
    assert.deepEqual(cells[26], { x: 7, y: 3 });
  }
});

test('wide characters take two cells and an early wrap leaves no gap', () => {
  const one = logicalLine((i) => rows(5, 'a中b')[i], 0);
  assert.equal(one.text.slice(0, 3), 'a中b');
  assert.deepEqual(one.cells.slice(0, 3), [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 4, y: 1 }]);
  const early = rows(4, 'abc', '中d');
  const two = logicalLine((i) => early[i], 1);
  assert.equal(two.text.trimEnd(), 'abc中d', 'the empty cell before the wrap is dropped');
  assert.deepEqual(two.cells[3], { x: 1, y: 2 });
});

test('the provider hands xterm 1-based inclusive ranges and opens the vault path', () => {
  const buf = rows(12, 'x zenjk: 06 ', 'AI Team/READ', 'ME.md done');
  const opened = [];
  const provider = new VaultLinkProvider(() => ({ getLine: (y) => buf[y] }), () => ctx, (p) => opened.push(p));
  let got;
  provider.provideLinks(2, (links) => { got = links; });
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].range, { start: { x: 3, y: 1 }, end: { x: 5, y: 3 } });
  assert.equal(got[0].text, 'zenjk: 06 AI Team/README.md');
  got[0].activate(new Event('click'), got[0].text);
  assert.deepEqual(opened, ['06 AI Team/README.md']);
  provider.provideLinks(1, (links) => { got = links; });
  assert.equal(got.length, 1, 'the same link from its first row');
  const empty = rows(12, 'nothing here');
  new VaultLinkProvider(() => ({ getLine: (y) => empty[y] }), () => ctx, () => {}).provideLinks(1, (links) => { got = links; });
  assert.equal(got, undefined);
});
