/* Which keys the shell owns while the pane is focused, and which stay with
 * Obsidian. Pure: hotkey strings in, a predicate out.
 *
 * The runtime side is a pushed Obsidian Scope (see TerminalView): Obsidian's
 * keymap listens on `window` in the CAPTURE phase, so nothing xterm does can
 * stop a key from reaching it. The Scope's catch-all handler asks this module
 * one question per keydown: does this key pass through to Obsidian? Yes means
 * the handler falls through to Obsidian's own bindings (Cmd+P opens the
 * palette); no means the key continues to xterm untouched.
 *
 * Keys are matched on `code` where it names a physical key, the way Obsidian
 * itself derives its virtual key: Cmd+Shift+[ reports `key` as `{` on a US
 * layout and `code` as BracketLeft on every layout, and a rule written as
 * "Mod+Shift+[" has to match the second. */

export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface Hotkey {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-case virtual key: a letter, a digit, punctuation, or a named key. */
  key: string;
}

const CODE_PUNCTUATION: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
};

/** Obsidian's virtual key for an event: physical where the code names one. */
export function virtualKey(evt: KeyLike): string {
  const code = evt.code ?? '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const punct = CODE_PUNCTUATION[code];
  if (punct) return punct;
  return evt.key.toLowerCase();
}

const MODIFIER_WORDS: Record<string, 'mod' | 'meta' | 'ctrl' | 'alt' | 'shift'> = {
  mod: 'mod',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

/** "Mod+Shift+[" style. Null when the text is not a hotkey. */
export function parseHotkey(text: string, platform: string): Hotkey | null {
  const raw = text.trim();
  if (!raw) return null;
  const parts = raw.split('+').map((p) => p.trim());
  /* A trailing "+" is the plus key itself: "Mod++" splits to ["Mod", "", ""]. */
  if (parts.length >= 2 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(parts.length - 2, 2, '+');
  }
  const keyText = parts.pop();
  if (!keyText) return null;
  const hk: Hotkey = { meta: false, ctrl: false, alt: false, shift: false, key: keyText.toLowerCase() };
  for (const p of parts) {
    const m = MODIFIER_WORDS[p.toLowerCase()];
    if (!m) return null;
    if (m === 'mod') {
      if (platform === 'darwin') hk.meta = true;
      else hk.ctrl = true;
    } else hk[m] = true;
  }
  if (hk.key === 'esc') hk.key = 'escape';
  if (hk.key === 'return') hk.key = 'enter';
  return hk;
}

export function matches(hk: Hotkey, evt: KeyLike): boolean {
  return (
    hk.meta === evt.metaKey &&
    hk.ctrl === evt.ctrlKey &&
    hk.alt === evt.altKey &&
    hk.shift === evt.shiftKey &&
    hk.key === virtualKey(evt)
  );
}

/**
 * What stays with Obsidian out of the box. On macOS the Command key is not a
 * shell modifier, so the palette, close-tab and tab switching can be kept
 * without taking anything from the shell. Elsewhere Mod is Ctrl, and Ctrl+P
 * and Ctrl+W are shell keys (history back, delete word), so only the
 * bracket pair is kept and the rest is the user's call in settings.
 */
export function defaultAllowList(platform: string): string[] {
  if (platform === 'darwin') return ['Mod+P', 'Mod+W', 'Mod+Shift+[', 'Mod+Shift+]', 'Mod+,'];
  return ['Ctrl+Shift+[', 'Ctrl+Shift+]'];
}

export interface CompiledAllowList {
  hotkeys: Hotkey[];
  /** Lines that did not parse, so settings can say which. */
  rejected: string[];
}

export function compileAllowList(lines: string[], platform: string): CompiledAllowList {
  const hotkeys: Hotkey[] = [];
  const rejected: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const hk = parseHotkey(t, platform);
    if (hk) hotkeys.push(hk);
    else rejected.push(t);
  }
  return { hotkeys, rejected };
}

/** One line per hotkey, the settings textarea shape. */
export function splitHotkeyLines(raw: string): string[] {
  return raw.split(/[\n\r,]+/).map((s) => s.trim()).filter(Boolean);
}

/** True when the key is Obsidian's, false when the shell gets it. */
export function passesToObsidian(evt: KeyLike, allow: CompiledAllowList): boolean {
  return allow.hotkeys.some((hk) => matches(hk, evt));
}
