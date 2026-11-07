/* Vault paths in terminal output become links only when the vault holds the
   file. The live half is in dom.test.mjs, on a real xterm buffer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findVaultPaths, isOpenable, logicalLine, toVaultPath, VaultLinkProvider, LOOKUP_BUDGET, MAX_PATH } from './build/pure.mjs';

const FILES = new Set([
  '04 Inner World/My Life/Key Elements/Health.md',
  '04 Inner World/Notes/Touche à Bâle.md',
  '06 AI Team/README.md',
  'README.md',
  'Assets/scan.pdf',
  'Downloads/x.command',
  'Downloads/x.html',
  'Downloads/run.sh',
  'notes/a.md',
  'Notes/café.md',
]);
const ctx = { vaultName: 'zenjk', vaultRoot: '/Users/me/zenjk', isFile: (p) => FILES.has(p) };
/** Provider actions that log what a click did. */
const acts = (log) => ({
  open: (p, e) => log.push(['open', p, e]),
  reveal: (p) => log.push(['reveal', p]),
  hint: (t) => log.push(['hint', t]),
  openHint: 'Open in a new tab',
  revealHint: 'Reveal in Finder',
});
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
  assert.deepEqual(one.ends.slice(0, 3), [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }], 'a link ending in a wide character covers both its cells');
  const early = rows(4, 'abc', '中d');
  const two = logicalLine((i) => early[i], 1);
  assert.equal(two.text.trimEnd(), 'abc中d', 'the empty cell before the wrap is dropped');
  assert.deepEqual(two.cells[3], { x: 1, y: 2 });
});

test('the provider hands xterm 1-based inclusive ranges and opens the vault path', () => {
  const buf = rows(12, 'x zenjk: 06 ', 'AI Team/READ', 'ME.md done');
  const opened = [];
  const provider = new VaultLinkProvider(() => ({ getLine: (y) => buf[y] }), () => ctx, { ...acts([]), open: (p) => opened.push(p) });
  let got;
  provider.provideLinks(2, (links) => { got = links; });
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].range, { start: { x: 3, y: 1 }, end: { x: 5, y: 3 } });
  assert.equal(got[0].text, 'zenjk: 06 AI Team/README.md');
  const click = new Event('click');
  got[0].activate(click, got[0].text);
  assert.deepEqual(opened, ['06 AI Team/README.md']);
  const events = [];
  new VaultLinkProvider(() => ({ getLine: (y) => buf[y] }), () => ctx, { ...acts([]), open: (p, e) => events.push(e) })
    .provideLinks(1, (links) => links[0].activate(click, links[0].text));
  assert.equal(events[0], click, 'the click event reaches the opener, for modifier keys');
  provider.provideLinks(1, (links) => { got = links; });
  assert.equal(got.length, 1, 'the same link from its first row');
  const empty = rows(12, 'nothing here');
  new VaultLinkProvider(() => ({ getLine: (y) => empty[y] }), () => ctx, acts([])).provideLinks(1, (links) => { got = links; });
  assert.equal(got, undefined);
});

function clickAll(text) {
  const log = [];
  const buf = rows(text.length + 1, text);
  new VaultLinkProvider(() => ({ getLine: (y) => buf[y] }), () => ctx, acts(log)).provideLinks(1, (links) => {
    for (const l of links ?? []) {
      l.hover(new Event('mouseover'), l.text);
      l.activate(new Event('click'), l.text);
      l.leave(new Event('mouseout'), l.text);
    }
  });
  return log.map(([what, arg]) => [what, arg]);
}

test('a format Obsidian shows itself opens in a tab; any other vault file is only revealed', () => {
  assert.deepEqual(clickAll('Downloads/x.command and zenjk: Downloads/x.html and Downloads/run.sh'), [
    ['hint', 'Reveal in Finder'], ['reveal', 'Downloads/x.command'], ['hint', null],
    ['hint', 'Reveal in Finder'], ['reveal', 'Downloads/x.html'], ['hint', null],
    ['hint', 'Reveal in Finder'], ['reveal', 'Downloads/run.sh'], ['hint', null],
  ]);
  assert.deepEqual(clickAll('06 AI Team/README.md and Assets/scan.pdf'), [
    ['hint', 'Open in a new tab'], ['open', '06 AI Team/README.md'], ['hint', null],
    ['hint', 'Open in a new tab'], ['open', 'Assets/scan.pdf'], ['hint', null],
  ]);
  assert.deepEqual(clickAll('Downloads/missing.command Downloads/missing.md'), [], 'a file the vault does not hold gets no link');
  assert.deepEqual(clickAll('m42: Downloads/x.command'), [], 'another vault\'s file is not revealed either');
  for (const ok of ['a.md', 'a.MD', 'b.base', 'c.canvas', 'd.png', 'e.mp3', 'f.mp4', 'g.pdf']) assert.ok(isOpenable(ok), ok);
  for (const no of ['a.html', 'a.command', 'a.sh', 'a.bat', 'a.js', 'a.lnk', 'md', 'dir.md/file']) assert.ok(!isOpenable(no), no);
});

test('a vault name with spaces is recognised as this vault', () => {
  for (const vaultName of ['My Vault', 'ICOR for Life']) {
    const c = { ...ctx, vaultName };
    assert.deepEqual(paths(`${vaultName}: notes/a.md`, c), [[`${vaultName}: notes/a.md`, 'notes/a.md']]);
    assert.deepEqual(paths(`| ${vaultName}: notes/a.md |`, c), [[`${vaultName}: notes/a.md`, 'notes/a.md']]);
    assert.deepEqual(paths('Other: notes/a.md', c), [], 'another name still makes no link');
  }
  assert.deepEqual(paths('NotMy Vault: notes/a.md', { ...ctx, vaultName: 'My Vault' }), [], 'the name starts at a boundary');
});

test('dense output costs a bounded number of vault lookups', () => {
  let calls = 0;
  const line = 'a.md '.repeat(409);
  assert.deepEqual(findVaultPaths(line, { ...ctx, isFile: () => (calls++, false) }), []);
  assert.ok(calls <= LOOKUP_BUDGET && LOOKUP_BUDGET <= 2000, `${calls} lookups`);
  assert.deepEqual(paths(`${'x'.repeat(MAX_PATH)} notes/a.md`), [['notes/a.md', 'notes/a.md']]);
  const all = { ...ctx, isFile: () => true };
  assert.deepEqual(findVaultPaths(`${'d/'.repeat(MAX_PATH)}a.md`, all), [], 'no start further back than the bound');
  assert.equal(findVaultPaths(`${'d/'.repeat(100)}a.md`, all).length, 1, 'a long path inside the bound still links');
});

test('a no-break space in the buffer reads as a space', () => {
  const buf = rows(30, `notes/a${String.fromCharCode(0xa0)}b.md`);
  assert.equal(logicalLine((i) => buf[i], 0).text.slice(0, 12), 'notes/a b.md');
});
