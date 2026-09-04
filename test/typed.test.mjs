/* Typing on behalf of another plugin, the pure part: every refusal rule,
   and the paste wrap. The live half is tools/smoke-typed.mjs, which sends
   the wrapped text into a real shell on the helper's pty and proves the
   line lands without running. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { textRefusal, typeRefusal, bracketPaste, PASTE_START, PASTE_END, TYPE_SETTLE_MS, TYPE_PROMPT_CEILING_MS } from './build/pure.mjs';

const shell = { ready: true, alive: true, launch: 'shell' };
const LINE = 'curl -fsSL https://example.invalid/install.sh | sh';

test('a plain line into a ready shell pane is typed', () => {
  assert.equal(typeRefusal(LINE, shell), null);
  assert.equal(typeRefusal('echo "quotes" && $VAR | grep -v x', shell), null, 'shell syntax is text, not a rule');
  assert.equal(typeRefusal('a\tb', shell), null, 'a tab is kept, a paste inserts it literally');
  assert.equal(typeRefusal('unicode: ü ß 日本', shell), null);
});

test('a line break is the Enter the user never pressed: refused in every position and form', () => {
  for (const bad of [`${LINE}\n`, `${LINE}\r`, `${LINE}\r\n`, `\n${LINE}`, 'echo a\necho b', '\n', '\r']) {
    assert.equal(textRefusal(bad), 'line-break', JSON.stringify(bad));
    assert.equal(typeRefusal(bad, shell), 'line-break', JSON.stringify(bad));
  }
});

test('other control characters are refused: EOF ends a shell, an escape could close the bracket', () => {
  for (const bad of ['\x04', `${LINE}\x04`, '\x03', `\x1b[201~; rm -rf ~\x1b[200~`, 'a\x00b', 'a\x7fb']) {
    assert.equal(typeRefusal(bad, shell), 'control', JSON.stringify(bad));
  }
});

test('nothing to type is a refusal, not a silent success', () => {
  assert.equal(textRefusal(''), 'empty');
  assert.equal(typeRefusal('', shell), 'empty');
  assert.equal(typeRefusal(undefined, shell), 'empty');
  assert.equal(typeRefusal(42, shell), 'empty');
});

test('the pane must exist, be alive, be ready, and run a shell', () => {
  assert.equal(typeRefusal(LINE, null), 'no-pane');
  assert.equal(typeRefusal(LINE, { ...shell, alive: false }), 'ended');
  assert.equal(typeRefusal(LINE, { ...shell, ready: false }), 'not-ready');
  assert.equal(typeRefusal(LINE, { ...shell, launch: 'claude' }), 'not-shell', 'a line into the Claude TUI is a prompt, not a command');
  assert.equal(typeRefusal(LINE, { ...shell, launch: undefined }), 'not-shell', 'unknown is not a shell');
  assert.equal(typeRefusal(LINE, { ready: false, alive: false, launch: 'claude' }), 'ended', 'the first failing rule names the reason');
});

test('the text rules win over the pane rules, so a caller can refuse before opening a pane', () => {
  assert.equal(typeRefusal(`${LINE}\n`, null), 'line-break');
  assert.equal(typeRefusal('', { ...shell, launch: 'claude' }), 'empty');
});

test('the paste wrap is xterm\'s: mode 2004 markers around the text, or the bare text', () => {
  assert.equal(bracketPaste(LINE, true), `\x1b[200~${LINE}\x1b[201~`);
  assert.equal(bracketPaste(LINE, false), LINE);
  assert.equal(PASTE_START, '\x1b[200~');
  assert.equal(PASTE_END, '\x1b[201~');
  assert.ok(!bracketPaste(LINE, true).includes('\r'), 'the wrap never adds an Enter');
});

test('the timings are short and the ceiling is longer than the settle', () => {
  assert.ok(TYPE_SETTLE_MS >= 100 && TYPE_SETTLE_MS <= 1000, `settle ${TYPE_SETTLE_MS} ms`);
  assert.ok(TYPE_PROMPT_CEILING_MS > TYPE_SETTLE_MS && TYPE_PROMPT_CEILING_MS <= 10000, `ceiling ${TYPE_PROMPT_CEILING_MS} ms`);
});
