/* The settings record and its defaults. Pure. `normaliseSettings` is the one
 * door data.json comes through, so a value from an older version or a hand
 * edit never reaches the terminal unchecked. */

import { isScrubbed } from '../env';
import { loginShellProfile } from '../profiles';
import type { CwdRule, ShellProfile } from '../profiles';

export type CursorStyle = 'block' | 'underline' | 'bar';
export type Renderer = 'auto' | 'dom';
export type OpenLocation = 'tab' | 'split' | 'right';

export interface TerminalSettings {
  fontSize: number;
  /** Empty means the theme's mono font through the --ict-mono token. */
  fontFamily: string;
  lineHeight: number;
  scrollback: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  copyOnSelect: boolean;
  bellFlash: boolean;
  renderer: Renderer;
  /** Capture the keyboard while the pane is focused. The toggle command flips it per pane. */
  captureKeys: boolean;
  /** Hotkeys that stay with Obsidian, one per line, added to the platform default list. */
  passthroughKeys: string;
  openIn: OpenLocation;
  pythonPath: string;
  claudePath: string;
  /** Folders added to PATH, one per line. */
  extraPath: string;
  defaultProfile: string;
  profiles: ShellProfile[];
  /** Windows only: the command that opens an external terminal. {cwd} and {command} are substituted. */
  windowsLauncher: string;
}

export const SCROLLBACK_MIN = 100;
export const SCROLLBACK_MAX = 100000;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 13,
  fontFamily: '',
  lineHeight: 1.2,
  scrollback: 10000,
  cursorStyle: 'block',
  cursorBlink: false,
  copyOnSelect: false,
  bellFlash: true,
  renderer: 'auto',
  captureKeys: true,
  passthroughKeys: '',
  openIn: 'tab',
  pythonPath: 'python3',
  claudePath: '',
  extraPath: '',
  defaultProfile: loginShellProfile().id,
  profiles: [loginShellProfile()],
  windowsLauncher: 'wt.exe -d "{cwd}" {command}',
};

const CURSOR_STYLES: CursorStyle[] = ['block', 'underline', 'bar'];
const RENDERERS: Renderer[] = ['auto', 'dom'];
const OPEN_LOCATIONS: OpenLocation[] = ['tab', 'split', 'right'];
const CWD_RULES: CwdRule[] = ['vault', 'active-file', 'fixed', 'home'];

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

function normaliseProfile(raw: unknown, taken: string[]): ShellProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, '').trim();
  if (!name) return null;
  let id = str(r.id, '').trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (!id || taken.includes(id)) id = `${id || 'profile'}-${taken.length + 1}`;
  const args = Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === 'string') : [];
  const env: Record<string, string> = {};
  if (r.env && typeof r.env === 'object') {
    for (const [k, v] of Object.entries(r.env as Record<string, unknown>)) {
      if (typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !isScrubbed(k)) env[k] = v;
    }
  }
  return {
    id,
    name,
    command: str(r.command, ''),
    args,
    env,
    cwd: oneOf(r.cwd, CWD_RULES, 'vault'),
    fixedCwd: str(r.fixedCwd, ''),
  };
}

export function normaliseSettings(raw: unknown): TerminalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const profiles: ShellProfile[] = [];
  if (Array.isArray(r.profiles)) {
    for (const p of r.profiles) {
      const np = normaliseProfile(p, profiles.map((x) => x.id));
      if (np) profiles.push(np);
    }
  }
  if (!profiles.some((p) => p.id === loginShellProfile().id)) profiles.unshift(loginShellProfile());
  const defaultProfile = profiles.some((p) => p.id === r.defaultProfile)
    ? (r.defaultProfile as string)
    : loginShellProfile().id;
  return {
    fontSize: num(r.fontSize, d.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
    fontFamily: str(r.fontFamily, d.fontFamily),
    lineHeight: num(r.lineHeight, d.lineHeight, 1, 2),
    scrollback: Math.round(num(r.scrollback, d.scrollback, SCROLLBACK_MIN, SCROLLBACK_MAX)),
    cursorStyle: oneOf(r.cursorStyle, CURSOR_STYLES, d.cursorStyle),
    cursorBlink: bool(r.cursorBlink, d.cursorBlink),
    copyOnSelect: bool(r.copyOnSelect, d.copyOnSelect),
    bellFlash: bool(r.bellFlash, d.bellFlash),
    renderer: oneOf(r.renderer, RENDERERS, d.renderer),
    captureKeys: bool(r.captureKeys, d.captureKeys),
    passthroughKeys: str(r.passthroughKeys, d.passthroughKeys),
    openIn: oneOf(r.openIn, OPEN_LOCATIONS, d.openIn),
    pythonPath: str(r.pythonPath, d.pythonPath).trim() || d.pythonPath,
    claudePath: str(r.claudePath, d.claudePath),
    extraPath: str(r.extraPath, d.extraPath),
    defaultProfile,
    profiles,
    windowsLauncher: str(r.windowsLauncher, d.windowsLauncher),
  };
}
