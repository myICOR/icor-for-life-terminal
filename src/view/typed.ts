/* Typing text into a pane on behalf of another plugin, the pure part.
 *
 * The vault's rule is that a runtime is started by the user, never by an
 * agent. So another plugin may put a line on the shell's input line, exactly
 * as a paste would, and it stops there: the user reads it and presses Enter,
 * or does not. These rules are what makes "stops there" true, and they are
 * checked BEFORE a byte reaches the pty:
 *
 *   - no line break: a `\n` or `\r` inside the text is the Enter the user
 *     never pressed;
 *   - no other control character: `\x04` at an empty prompt ends the shell,
 *     `\x03` interrupts it, an `\x1b` could close the paste bracket early
 *     (tab is the one exception, a paste keeps it literal);
 *   - only into a shell: a pane running `claude` is a TUI reading keys, and a
 *     line typed into it is a prompt to a model, not a command a user reads;
 *   - only into a pane whose helper has said `ready`, and whose process is
 *     still alive.
 *
 * The text itself goes through xterm's own paste path, so it arrives with
 * the bracketed-paste markers whenever the shell has asked for them (mode
 * 2004; zsh, bash 5.1+ and fish do), and a shell that has not asked gets the
 * plain bytes, exactly as a Cmd+V would deliver them. `bracketPaste` mirrors
 * that wrap so the smoke can send what the pane sends. */

import type { LaunchKind } from './handoff';

export type TypeRefusal = 'empty' | 'line-break' | 'control' | 'no-pane' | 'ended' | 'not-ready' | 'not-shell';

/** What the rules need to know about a pane; the view supplies it, tests fake it. */
export interface TypeTarget {
  /** The helper reported `ready`: the pty exists and the shell has exec'd. */
  ready: boolean;
  /** The process has not ended. */
  alive: boolean;
  /** What runs in the pane. */
  launch: LaunchKind | undefined;
}

export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

/** After the helper's `ready` and the first output (the prompt), the gap before typing. */
export const TYPE_SETTLE_MS = 250;
/** How long `newTerminalWithText` waits for the shell to draw its first prompt before it types anyway. */
export const TYPE_PROMPT_CEILING_MS = 3000;

const TAB = 0x09;
const DEL = 0x7f;
const C0_END = 0x20;

/** A C0 control other than tab, or DEL. Written as a loop: a control character in a regex is a lint finding. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < C0_END && c !== TAB) || c === DEL) return true;
  }
  return false;
}

/** The rules that depend on the text alone, so a caller can check before it opens a pane. */
export function textRefusal(text: string): TypeRefusal | null {
  if (typeof text !== 'string' || text.length === 0) return 'empty';
  if (text.includes('\n') || text.includes('\r')) return 'line-break';
  if (hasControl(text)) return 'control';
  return null;
}

/** All the rules, text first, then the pane. `null` means type it. */
export function typeRefusal(text: string, target: TypeTarget | null): TypeRefusal | null {
  const onText = textRefusal(text);
  if (onText) return onText;
  if (!target) return 'no-pane';
  if (!target.alive) return 'ended';
  if (!target.ready) return 'not-ready';
  if (target.launch !== 'shell') return 'not-shell';
  return null;
}

/** The wrap xterm applies to a paste when the program has enabled mode 2004. */
export function bracketPaste(text: string, enabled: boolean): string {
  return enabled ? `${PASTE_START}${text}${PASTE_END}` : text;
}
