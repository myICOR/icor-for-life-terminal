/* The same-pane hand-off with ICOR for Life - AI Chat, the pure part.
 *
 * Three things live here and none of them touches Obsidian or a process:
 *   - the leaf state as another plugin hands it over (parsed, never trusted);
 *   - the return target a `Back to chat` restores with `leaf.setViewState`;
 *   - the exit-then-swap sequence, against an abstract pty, so a fake one
 *     can prove the ordering: `/exit`, Enter, wait for the exit, swap, and
 *     never swap while the process is alive.
 * The contract is stated once, in docs/handoff.md. */

import { normaliseSessionId } from '../claude/launch';

export type LaunchKind = 'shell' | 'claude';

/** What `Back to chat` restores: the view type and the state it was opened with. */
export interface ReturnTo {
  type: string;
  state: Record<string, unknown>;
}

/**
 * The leaf state of a terminal pane. Persisted by Obsidian into
 * workspace.json, and the shape another plugin hands over with
 * `leaf.setViewState` when it wants this pane to pick up a Claude session.
 */
export interface TerminalViewState {
  cwd?: string;
  launch?: LaunchKind;
  profile?: string;
  resumeSessionId?: string;
  returnTo?: ReturnTo;
  title?: string;
  /** Wall-clock ms when the pane was opened; a restore after a reload is older than a fresh open. */
  startedAt?: number;
}

export interface ParsedState {
  /** Only the fields that were present and well-formed; merge over the current state. */
  state: TerminalViewState;
  /** Fields that were present and refused, with the reason, for a notice rather than silence. */
  rejected: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A return target needs a non-empty view type and an object state; anything else is no target. */
export function parseReturnTo(v: unknown): ReturnTo | null {
  if (!isRecord(v)) return null;
  const type = v.type;
  if (typeof type !== 'string' || !type.trim()) return null;
  const state = isRecord(v.state) ? { ...v.state } : {};
  return { type: type.trim(), state };
}

/**
 * Reads a leaf state as handed over. `null` for a field means "unset" and is
 * accepted as absent; a `resumeSessionId` that is not a UUID is refused and
 * reported, so a mistyped id never reaches argv and never silently starts a
 * fresh session in its place.
 */
export function parseTerminalState(raw: unknown): ParsedState {
  const state: TerminalViewState = {};
  const rejected: string[] = [];
  if (!isRecord(raw)) return { state, rejected };

  const str = (k: 'cwd' | 'profile' | 'title'): void => {
    const v = raw[k];
    if (typeof v === 'string' && v) state[k] = v;
    else if (v !== undefined && v !== null && v !== '') rejected.push(`${k}: not a string`);
  };
  str('cwd');
  str('profile');
  str('title');

  const launch = raw.launch;
  if (launch === 'shell' || launch === 'claude') state.launch = launch;
  else if (launch !== undefined && launch !== null) rejected.push(`launch: not 'claude' or 'shell'`);

  const id = raw.resumeSessionId;
  if (typeof id === 'string' && id) {
    const n = normaliseSessionId(id);
    if (n && n.length === id.trim().length) state.resumeSessionId = n;
    else rejected.push('resumeSessionId: not a Claude session id (a UUID)');
  } else if (id !== undefined && id !== null && id !== '') {
    rejected.push('resumeSessionId: not a string');
  }

  if ('returnTo' in raw && raw.returnTo !== undefined && raw.returnTo !== null) {
    const rt = parseReturnTo(raw.returnTo);
    if (rt) state.returnTo = rt;
    else rejected.push('returnTo: needs { type: string, state: object }');
  }

  const started = raw.startedAt;
  if (typeof started === 'number' && Number.isFinite(started)) state.startedAt = started;

  return { state, rejected };
}

/* ------------------------------------------------------------ the swap */

/** The one shape the sequencer needs from a process; PtyProcess satisfies it. */
export interface ExitablePty {
  readonly alive: boolean;
  write(data: string): void;
  /** Calls the listener once the process has ended (at once if it already has); returns the unsubscribe. */
  onExit(listener: () => void): () => void;
}

export interface ExitThenSwapOptions {
  /** What is typed to ask the CLI to end itself. */
  exitCommand?: string;
  /** Gap between the command text and the Enter, so a TUI reads them as typing, not a paste. */
  settleMs?: number;
  /** How long to wait for the exit before giving up WITHOUT swapping. */
  ceilingMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export type ExitThenSwapResult = 'swapped' | 'timeout';

export const EXIT_COMMAND = '/exit';
export const EXIT_SETTLE_MS = 150;
export const EXIT_CEILING_MS = 10000;

/**
 * Asks the process to exit, waits for it, then swaps. The swap runs exactly
 * once and only after the process has ended; on the ceiling it does not run
 * at all, and the caller says so to the user. A process that is already gone
 * swaps at once.
 */
export async function exitThenSwap(
  pty: ExitablePty | null,
  swap: () => Promise<void> | void,
  opts: ExitThenSwapOptions = {},
): Promise<ExitThenSwapResult> {
  const settle = opts.settleMs ?? EXIT_SETTLE_MS;
  const ceiling = opts.ceilingMs ?? EXIT_CEILING_MS;
  const command = opts.exitCommand ?? EXIT_COMMAND;
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  if (!pty || !pty.alive) {
    await swap();
    return 'swapped';
  }

  const exited = await new Promise<boolean>((resolve) => {
    let done = false;
    let enter: unknown = null;
    let limit: unknown = null;
    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      if (enter !== null) clearT(enter);
      if (limit !== null) clearT(limit);
      off();
      resolve(value);
    };
    const off = pty.onExit(() => finish(true));
    if (done) return;
    limit = setT(() => finish(false), ceiling);
    pty.write(command);
    enter = setT(() => {
      enter = null;
      if (!done && pty.alive) pty.write('\r');
    }, settle);
  });

  if (!exited) return 'timeout';
  await swap();
  return 'swapped';
}
