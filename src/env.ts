/* The environment a child process is handed. Pure: it takes the host env and
 * a description of the machine and returns a new object; nothing here reads
 * `process` directly, so the test can construct every input.
 *
 * Three jobs:
 *   1. PATH repair. Obsidian is a GUI app and on macOS inherits the launchd
 *      PATH (/usr/bin:/bin:/usr/sbin:/sbin), which has none of the places a
 *      developer's tools live. A login shell fixes its own PATH from the
 *      profile files; a program spawned directly (the Claude launcher) does
 *      not, so the usual tool folders are put in front, plus the user's own.
 *   2. Scrub CLAUDE*. A Claude Code CLI that inherits CLAUDE_CODE_CHILD_SESSION
 *      starts with "Transcript saving is off" and writes nothing to its session
 *      file; measured 2026-09-04. Obsidian usually carries none of these, but
 *      an Obsidian started from inside a Claude session does.
 *   3. Declare the terminal: TERM, COLORTERM, TERM_PROGRAM, LANG when the host
 *      has none, and the vault path in ICOR_VAULT. */

import { TERM_PROGRAM, VAULT_ENV } from './constants';

export interface EnvInput {
  platform: NodeJS.Platform;
  home: string;
  vaultPath: string;
  version: string;
  /** Folders the user listed in settings; go first, in the order given. */
  extraPath?: string[];
}

export const TERM_NAME = 'xterm-256color';
export const DEFAULT_LANG = 'en_US.UTF-8';

/** Variable names that never reach a child. Prefix match, case-sensitive. */
export const SCRUBBED_PREFIXES = ['CLAUDE'];

export function isScrubbed(name: string): boolean {
  return SCRUBBED_PREFIXES.some((p) => name.startsWith(p));
}

/** The folders a developer's tools usually live in, in front of the host PATH. */
export function standardToolDirs(input: Pick<EnvInput, 'platform' | 'home'>): string[] {
  const h = input.home;
  if (input.platform === 'win32') {
    return [`${h}\\AppData\\Roaming\\npm`, `${h}\\.local\\bin`];
  }
  const dirs = [
    `${h}/.local/bin`,
    `${h}/.npm-global/bin`,
    `${h}/.bun/bin`,
    `${h}/.cargo/bin`,
    `${h}/.volta/bin`,
    '/usr/local/bin',
  ];
  if (input.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/opt/homebrew/sbin');
  return dirs;
}

/** The system floor, appended when the host PATH lacks it. */
const SYSTEM_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export function augmentPath(hostPath: string | undefined, input: EnvInput): string {
  const sep = input.platform === 'win32' ? ';' : ':';
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (dir: string): void => {
    const d = dir.trim();
    if (!d || seen.has(d)) return;
    seen.add(d);
    out.push(d);
  };
  for (const d of input.extraPath ?? []) push(d);
  for (const d of standardToolDirs(input)) push(d);
  for (const d of (hostPath ?? '').split(sep)) push(d);
  if (input.platform !== 'win32') for (const d of SYSTEM_DIRS) push(d);
  return out.join(sep);
}

export function buildChildEnv(base: NodeJS.ProcessEnv, input: EnvInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'string') continue;
    if (isScrubbed(k)) continue;
    out[k] = v;
  }
  const hostPath = base.PATH ?? base.Path;
  out.PATH = augmentPath(hostPath, input);
  if (input.platform === 'win32') out.Path = out.PATH;
  out.TERM = TERM_NAME;
  out.COLORTERM = 'truecolor';
  out.TERM_PROGRAM = TERM_PROGRAM;
  out.TERM_PROGRAM_VERSION = input.version;
  out[VAULT_ENV] = input.vaultPath;
  if (!out.LANG) out.LANG = DEFAULT_LANG;
  return out;
}

/** One folder per line, blank lines and surrounding whitespace ignored. */
export function splitPathLines(raw: string): string[] {
  return raw
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type FileProbe = (path: string) => boolean;

/** The first `name` found on the given PATH string, or null. Pure via the probe. */
export function findOnPath(
  name: string,
  pathValue: string,
  platform: NodeJS.Platform,
  probe: FileProbe,
): string | null {
  const sep = platform === 'win32' ? ';' : ':';
  const join = platform === 'win32' ? '\\' : '/';
  const names = platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
  for (const dir of pathValue.split(sep)) {
    if (!dir) continue;
    for (const n of names) {
      const full = `${dir}${join}${n}`;
      if (probe(full)) return full;
    }
  }
  return null;
}
