/* The headless-Chrome gate: the shipped builders on the shipped stylesheet.
 * Fails loudly without Chrome (see dom/chrome.mjs); never skips. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Chrome } from './dom/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = pathToFileURL(resolve(here, 'dom/fixture.html')).href;

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseRgb = (s) => { const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };

async function mount(chrome, dark) {
  await chrome.open(fixture, '#host .ict-root');
  if (dark) await chrome.evaluate('document.body.classList.add("theme-dark"), true');
  const deadline = Date.now() + 15000;
  while (!(await chrome.evaluate('document.body.getAttribute("data-ict-ready") === "1"'))) {
    if (Date.now() > deadline) throw new Error('xterm never finished its first write');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('the pane mounts, every control is a labelled <button>, and the tokens resolve in both rooms', async () => {
  const chrome = await Chrome.launch();
  try {
    for (const dark of [false, true]) {
      await mount(chrome, dark);
      const facts = await chrome.evaluate(`(() => {
        const root = document.querySelector('.ict-root');
        const cs = getComputedStyle(root);
        const buttons = [...root.querySelectorAll('.ict-btn')];
        const pretending = [...root.querySelectorAll('[role="button"]')].filter((e) => e.tagName !== 'BUTTON');
        const tokens = Object.fromEntries(window.ictTokens.map((t) => [t, cs.getPropertyValue(t).trim()]));
        const rowsText = document.querySelector('.xterm-rows')?.textContent ?? '';
        const exit = root.querySelector('.ict-exit');
        return {
          attr: root.getAttribute('data-ink-plugin'),
          buttonTags: buttons.map((b) => b.tagName),
          buttonLabels: buttons.map((b) => b.getAttribute('aria-label') || ''),
          pretending: pretending.length,
          tokens,
          palette: window.ictPalette,
          rowsText,
          cols: window.ictCols, rows: window.ictRows,
          fg: getComputedStyle(root).color,
          bg: getComputedStyle(root).backgroundColor,
          kicker: getComputedStyle(exit.querySelector('.ict-exit-kicker')).color,
          exitBg: getComputedStyle(exit).backgroundColor,
          markers: root.querySelectorAll('.ict-exit .ict-btn-marker').length,
          restartBg: getComputedStyle(root.querySelector('.ict-btn-marker')).backgroundColor,
          restartFg: getComputedStyle(root.querySelector('.ict-btn-marker')).color,
          font: cs.getPropertyValue('--ict-mono').trim(),
        };
      })()`);
      const room = dark ? 'stock dark' : 'stock light';
      assert.equal(facts.attr, 'icor-for-life-terminal', `${room}: root carries the INKLINE declaration`);
      assert.ok(facts.buttonTags.length >= 6, `${room}: the pane has its controls`);
      assert.ok(facts.buttonLabels.includes('Back to chat'), `${room}: the exit row carries the way back when there is one`);
      assert.equal(facts.markers, 1, `${room}: exactly one marker action in the exit row`);
      assert.ok(facts.buttonTags.every((t) => t === 'BUTTON'), `${room}: every control is a <button>`);
      assert.ok(facts.buttonLabels.every((l) => l.length > 0), `${room}: every control has an accessible name`);
      assert.equal(facts.pretending, 0, `${room}: nothing pretends to be a button`);
      for (const [t, v] of Object.entries(facts.tokens)) assert.ok(v, `${room}: ${t} resolved to nothing`);
      assert.equal(Object.keys(facts.palette).length, 22, `${room}: all 22 palette entries resolved`);
      assert.match(facts.rowsText, /ICOR_DOM_OK/, `${room}: xterm rendered the written text`);
      assert.ok(facts.cols >= 20 && facts.rows >= 5, `${room}: xterm measured a real grid (${facts.cols}x${facts.rows})`);
      assert.match(facts.font, /mono/i, `${room}: the mono token resolved to a monospace stack (${facts.font})`);
      const fgbg = contrast(parseRgb(facts.fg), parseRgb(facts.bg));
      assert.ok(fgbg >= 4.5, `${room}: pane text over pane ground measures ${fgbg.toFixed(2)}:1, floor 4.5`);
      const kick = contrast(parseRgb(facts.kicker), parseRgb(facts.exitBg));
      assert.ok(kick >= 4.5, `${room}: the exit kicker over its row measures ${kick.toFixed(2)}:1, floor 4.5`);
      const restart = contrast(parseRgb(facts.restartFg), parseRgb(facts.restartBg));
      assert.ok(restart >= 4.5, `${room}: the Restart label over the marker fill measures ${restart.toFixed(2)}:1, floor 4.5`);
    }
  } finally {
    await chrome.close();
  }
});
