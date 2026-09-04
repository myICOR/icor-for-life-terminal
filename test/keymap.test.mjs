import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHotkey, matches, virtualKey, defaultAllowList, compileAllowList, passesToObsidian, splitHotkeyLines } from './build/pure.mjs';

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
