import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHotkey, matches, virtualKey, defaultAllowList, compileAllowList, passesToObsidian, splitHotkeyLines, captureApplies, captureMenuTitle, captureNotice } from './build/pure.mjs';

const ev = (o) => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });

test('Mod is Meta on macOS and Ctrl elsewhere', () => {
  assert.deepEqual(parseHotkey('Mod+P', 'darwin'), { meta: true, ctrl: false, alt: false, shift: false, key: 'p' });
  assert.deepEqual(parseHotkey('Mod+P', 'linux'), { meta: false, ctrl: true, alt: false, shift: false, key: 'p' });
});

test('the virtual key is the physical key where the code names one', () => {
  assert.equal(virtualKey(ev({ key: '{', code: 'BracketLeft' })), '[');
  assert.equal(virtualKey(ev({ key: 'P', code: 'KeyP' })), 'p');
  assert.equal(virtualKey(ev({ key: '!', code: 'Digit1' })), '1');
  assert.equal(virtualKey(ev({ key: 'Escape', code: 'Escape' })), 'escape');
});

test('Cmd+Shift+[ matches the event a US keyboard reports', () => {
  const hk = parseHotkey('Mod+Shift+[', 'darwin');
  assert.ok(matches(hk, ev({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true })));
  assert.ok(!matches(hk, ev({ key: '[', code: 'BracketLeft', metaKey: true })));
});

test('the default allow-list keeps the palette, close and tab keys on macOS only', () => {
  const mac = compileAllowList(defaultAllowList('darwin'), 'darwin');
  assert.equal(mac.rejected.length, 0);
  assert.ok(passesToObsidian(ev({ key: 'p', code: 'KeyP', metaKey: true }), mac));
  assert.ok(passesToObsidian(ev({ key: 'w', code: 'KeyW', metaKey: true }), mac));
  assert.ok(passesToObsidian(ev({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }), mac));
  assert.ok(!passesToObsidian(ev({ key: 'c', code: 'KeyC', ctrlKey: true }), mac), 'Ctrl+C is the shell interrupt');
  assert.ok(!passesToObsidian(ev({ key: 'Escape', code: 'Escape' }), mac), 'Escape reaches the pty');
  assert.ok(!passesToObsidian(ev({ key: 'p', code: 'KeyP', ctrlKey: true }), mac), 'Ctrl+P is history back');
  const linux = compileAllowList(defaultAllowList('linux'), 'linux');
  assert.ok(!passesToObsidian(ev({ key: 'p', code: 'KeyP', ctrlKey: true }), linux), 'Ctrl+P stays with the shell on Linux');
  assert.ok(!passesToObsidian(ev({ key: 'w', code: 'KeyW', ctrlKey: true }), linux), 'Ctrl+W deletes a word on Linux');
});

test('the user list is added and bad lines are reported, not swallowed', () => {
  const lines = splitHotkeyLines('Mod+Shift+F\nnonsense+\n\nCtrl+Alt+T');
  const c = compileAllowList([...defaultAllowList('darwin'), ...lines], 'darwin');
  assert.deepEqual(c.rejected, ['nonsense+']);
  assert.ok(passesToObsidian(ev({ key: 'F', code: 'KeyF', metaKey: true, shiftKey: true }), c));
  assert.ok(passesToObsidian(ev({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true }), c));
});

test('modifier spellings are accepted', () => {
  assert.equal(parseHotkey('Cmd+Option+K', 'darwin').alt, true);
  assert.equal(parseHotkey('Control+Esc', 'linux').key, 'escape');
  assert.equal(parseHotkey('Bogus+K', 'darwin'), null);
  assert.equal(parseHotkey('', 'darwin'), null);
});

/* The pane builds xterm and pushes the capture scope on every platform, but a
   Windows pane never gets a pseudo-terminal: it returns to the external
   launcher first. Capture there would take Ctrl+P and Ctrl+W from Obsidian and
   hand them to nothing. The same shape covers a macOS or Linux pane after its
   shell has exited. */
test('capture applies only while a live process can receive the keys', () => {
  const live = { alive: true };
  const exited = { alive: false };
  assert.equal(captureApplies(true, live), true, 'a running shell keeps the keys');
  assert.equal(captureApplies(false, live), false, 'capture released is released');
  assert.equal(captureApplies(true, null), false, 'no pty at all: the Windows pane');
  assert.equal(captureApplies(true, exited), false, 'the shell exited: the pane is a transcript');
  assert.equal(captureApplies(false, null), false);
});

/* What the Windows pane costs the user if capture is not gated: on a non-mac
   platform the allow-list is only the bracket pair, so Ctrl+P and Ctrl+W are
   NOT on it and the scope's catch-all would claim them. */
test('the keys a Windows pane would swallow are the ones not on its allow-list', () => {
  const win = compileAllowList(defaultAllowList('win32'), 'win32');
  const ctrlP = ev({ key: 'p', code: 'KeyP', ctrlKey: true });
  const ctrlW = ev({ key: 'w', code: 'KeyW', ctrlKey: true });
  assert.ok(!passesToObsidian(ctrlP, win), 'Ctrl+P is off the allow-list there');
  assert.ok(!passesToObsidian(ctrlW, win), 'Ctrl+W is off the allow-list there');
  /* So the only thing that can give them back is the capture gate. */
  assert.equal(captureApplies(true, null), false);
});

/* The same gate has to reach what the pane SAYS. Before this, both strings
   came from the setting alone, so a dead pane offered "Release keyboard to
   Obsidian" and the toggle announced "keyboard captured" while every key went
   to Obsidian. */
test('the menu item says what is true, not what the setting says', () => {
  const live = { alive: true };
  const exited = { alive: false };
  assert.equal(captureMenuTitle(true, live), 'Release keyboard to Obsidian');
  assert.equal(captureMenuTitle(false, live), 'Capture keyboard in terminal');
  assert.equal(captureMenuTitle(true, exited), 'Keyboard not captured, no running shell');
  assert.equal(captureMenuTitle(false, exited), 'Keyboard not captured, no running shell');
  assert.equal(captureMenuTitle(true, null), 'Keyboard not captured, no running shell', 'the Windows pane');
});

test('the toggle notice does not claim keys a dead pane cannot hold', () => {
  const live = { alive: true };
  const exited = { alive: false };
  assert.equal(captureNotice(true, live), 'Terminal: keyboard captured');
  assert.equal(captureNotice(false, live), 'Terminal: keyboard released');
  assert.equal(
    captureNotice(true, exited),
    'Terminal: capture on for the next shell. No shell is running, so the keys stay with Obsidian.',
  );
  assert.equal(captureNotice(true, null), captureNotice(true, exited), 'the Windows pane reads the same');
  /* Released is released either way: the keys are Obsidian's in both. */
  assert.equal(captureNotice(false, exited), 'Terminal: keyboard released');
});
