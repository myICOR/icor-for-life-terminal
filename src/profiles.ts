/* Shell profiles and the working-directory rule. Pure. */

import { isAbsolute, resolve } from 'node:path';

export type CwdRule = 'vault' | 'active-file' | 'fixed' | 'home';

export interface ShellProfile {
  id: string;
  name: string;
  /** Empty means the user's login shell, resolved at spawn time. */
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: CwdRule;
  fixedCwd: string;
}

export const LOGIN_SHELL_PROFILE_ID = 'login-shell';

export function loginShellProfile(): ShellProfile {
  return {
    id: LOGIN_SHELL_PROFILE_ID,
    name: 'Login shell',
    command: '',
    args: ['-l'],
    env: {},
    cwd: 'vault',
    fixedCwd: '',
  };
}

/** $SHELL, or the platform's usual shell when the host has none. */
export function resolveShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const fromEnv = (env.SHELL ?? '').trim();
  if (fromEnv) return fromEnv;
  if (platform === 'darwin') return '/bin/zsh';
  if (platform === 'win32') return (env.ComSpec ?? 'cmd.exe').trim();
  return '/bin/bash';
}

export interface CwdContext {
  vaultPath: string;
  /** Folder of the active file, absolute; null when no file is active. */
  activeFileDir: string | null;
  home: string;
}

export interface ResolvedCwd {
  cwd: string;
  /** The rule could not be honoured and the vault root was used instead. */
  fellBack: boolean;
}

export function resolveCwd(profile: Pick<ShellProfile, 'cwd' | 'fixedCwd'>, ctx: CwdContext): ResolvedCwd {
  switch (profile.cwd) {
    case 'home':
      return { cwd: ctx.home, fellBack: false };
    case 'active-file':
      if (ctx.activeFileDir) return { cwd: ctx.activeFileDir, fellBack: false };
      return { cwd: ctx.vaultPath, fellBack: true };
    case 'fixed': {
      const fixed = profile.fixedCwd.trim();
      if (!fixed) return { cwd: ctx.vaultPath, fellBack: true };
      const expanded = fixed.startsWith('~/') || fixed === '~' ? resolve(ctx.home, fixed.slice(2)) : fixed;
      return { cwd: isAbsolute(expanded) ? expanded : resolve(ctx.vaultPath, expanded), fellBack: false };
    }
    default:
      return { cwd: ctx.vaultPath, fellBack: false };
  }
}

/** KEY=VALUE per line; lines without "=" or with an empty key are ignored. */
export function parseEnvLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/[\n\r]+/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = t.slice(eq + 1);
  }
  return out;
}

export function formatEnvLines(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
}

/** Whitespace-separated, with double or single quotes to keep a space. */
export function parseArgs(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) {
      if (has || cur) { out.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch;
  }
  if (has || cur) out.push(cur);
  return out;
}

export function formatArgs(args: string[]): string {
  return args.map((a) => (/\s/.test(a) || a === '' ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
}

export function findProfile(profiles: ShellProfile[], id: string | undefined): ShellProfile {
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? loginShellProfile();
}

/** A stable id from a name; unique within the given list. */
export function profileId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
  let id = base;
  let n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}
