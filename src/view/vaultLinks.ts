/* Vault file paths printed in the terminal become links that open the note.
 * Text is only a candidate: a link is made only for a path the vault index
 * holds as a file. A format Obsidian shows itself opens in a tab; any other
 * file is only revealed in the system file manager, never opened, so nothing
 * outside the vault, no URL scheme and no default-app handler is reached
 * from here. */

import type { IBufferCellPosition, ILink, ILinkProvider } from '@xterm/xterm';

/** The longest logical line searched, as in xterm's own web links addon. */
const MAX_LINE = 2048;
/** How far before its extension a path may start. */
export const MAX_PATH = 512;
/** Vault lookups per line, so hovering dense output stays cheap. */
export const LOOKUP_BUDGET = 2000;

/** The formats Obsidian opens in its own views (obsidian.md/help/file-formats). */
export const OPENABLE = new Set([
  'md', 'base', 'canvas',
  'avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp',
  'flac', 'm4a', 'mp3', 'ogg', 'wav',
  'webm', '3gp', 'mkv', 'mov', 'mp4', 'ogv',
  'pdf',
]);

export function isOpenable(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') && OPENABLE.has(path.slice(dot + 1).toLowerCase());
}

const EXTENSION = /\.[\p{L}\p{N}]{1,10}(?=[.,;:!?]*(?:[\s)\]}>'"`|*]|$))/gu;
const OPENERS = new Set(['(', '[', '{', '<', "'", '"', '`', '|', '*']);
/** `name: ` right before a path, as in `vault: folder/note.md`. */
const PREFIX = /(?:^|[\s([{<'"`|*])([^\s:/\\]+): $/u;

export interface VaultLinkContext {
  /** The vault's name, as `Vault.getName()` returns it. */
  vaultName: string;
  /** The vault folder on disk, no trailing separator; empty when unknown. */
  vaultRoot: string;
  /** True when the vault-relative path is a file in the vault. */
  isFile(path: string): boolean;
}

export interface VaultPathMatch {
  /** String index of the first character of the link, prefix included. */
  start: number;
  /** String index one past the last character. */
  end: number;
  /** The vault-relative path that exists. */
  path: string;
}

function isStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text.charAt(i - 1);
  return /\s/u.test(prev) || OPENERS.has(prev);
}

/** The vault-relative form of a candidate, or null when it cannot name a vault file. */
export function toVaultPath(candidate: string, vaultRoot: string): string | null {
  let p = candidate;
  if (vaultRoot && p.startsWith(`${vaultRoot}/`)) p = p.slice(vaultRoot.length + 1);
  if (!p || p.startsWith('/') || p.includes('\\')) return null;
  if (p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  return p;
}

function existing(candidate: string, ctx: VaultLinkContext, budget: { left: number }): string | null {
  const p = toVaultPath(candidate, ctx.vaultRoot);
  if (p === null) return null;
  /* A name typed on macOS may be stored decomposed; the printed text is usually composed. */
  for (const form of new Set([p, p.normalize('NFC'), p.normalize('NFD')])) {
    if (budget.left-- <= 0) return null;
    if (ctx.isFile(form)) return form;
  }
  return null;
}

/**
 * Every vault file path in `text`. A path may contain spaces: each run ending
 * in an extension is tried from its longest start to its shortest, and the
 * first that names a file wins. A `name: ` prefix in front of the path must
 * be this vault's name, or the path is left alone: it belongs to another vault.
 */
export function findVaultPaths(text: string, ctx: VaultLinkContext): VaultPathMatch[] {
  const out: VaultPathMatch[] = [];
  if (text.length > MAX_LINE) return out;
  const own = ctx.vaultName ? `${ctx.vaultName}: ` : '';
  const budget = { left: LOOKUP_BUDGET };
  let floor = 0;
  for (const m of text.matchAll(EXTENSION)) {
    if (budget.left <= 0) break;
    const end = (m.index ?? 0) + m[0].length;
    for (let start = Math.max(floor, end - MAX_PATH); start < end; start++) {
      if (!isStart(text, start)) continue;
      const path = existing(text.slice(start, end), ctx, budget);
      if (path === null) continue;
      const before = text.slice(floor, start);
      if (own && before.endsWith(own) && isStart(text, start - own.length)) {
        out.push({ start: start - own.length, end, path });
        floor = end;
        break;
      }
      const name = PREFIX.exec(before)?.[1];
      if (name !== undefined) break;
      out.push({ start, end, path });
      floor = end;
      break;
    }
  }
  return out;
}

export interface CellLike {
  getChars(): string;
  getWidth(): number;
}

export interface LineLike {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(x: number): CellLike | undefined;
}

export interface LogicalLine {
  text: string;
  /** The 1-based buffer cell of each string index of `text`. */
  cells: IBufferCellPosition[];
  /** The last cell of each string index, which differs for a wide character. */
  ends: IBufferCellPosition[];
}

/** The wrapped rows around 0-based row `y`, joined, with each character's cell. */
export function logicalLine(getLine: (y: number) => LineLike | undefined, y: number): LogicalLine {
  let top = y;
  while (top > 0 && getLine(top)?.isWrapped) top--;
  let text = '';
  const cells: IBufferCellPosition[] = [];
  const ends: IBufferCellPosition[] = [];
  for (let row = top; ; row++) {
    const line = getLine(row);
    if (!line || (row > top && !line.isWrapped)) break;
    const continues = getLine(row + 1)?.isWrapped === true;
    let last = line.length;
    /* A wide character that did not fit leaves an empty cell before the wrap. */
    if (continues) while (last > 0 && line.getCell(last - 1)?.getChars() === '') last--;
    for (let x = 0; x < last; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      const raw = cell.getChars();
      const chars = raw === '' || raw === '\u00a0' ? ' ' : raw;
      for (let i = 0; i < chars.length; i++) {
        cells.push({ x: x + 1, y: row + 1 });
        ends.push({ x: x + cell.getWidth(), y: row + 1 });
      }
      text += chars;
    }
    if (text.length > MAX_LINE) break;
  }
  return { text, cells, ends };
}

export interface BufferLike {
  getLine(y: number): LineLike | undefined;
}

export interface VaultLinkActions {
  /** Opens a format Obsidian shows itself. */
  open(path: string, event: MouseEvent): void;
  /** Shows any other file in the system file manager. */
  reveal(path: string): void;
  /** Shows or clears the hint for the link under the pointer. */
  hint?(text: string | null): void;
  openHint: string;
  revealHint: string;
}

export class VaultLinkProvider implements ILinkProvider {
  constructor(
    private readonly buffer: () => BufferLike,
    private readonly ctx: () => VaultLinkContext,
    private readonly actions: VaultLinkActions,
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const buf = this.buffer();
    const { text, cells, ends } = logicalLine((y) => buf.getLine(y), bufferLineNumber - 1);
    const links: ILink[] = [];
    for (const m of findVaultPaths(text, this.ctx())) {
      const start = cells[m.start];
      const end = ends[m.end - 1];
      if (!start || !end) continue;
      const opens = isOpenable(m.path);
      const hint = opens ? this.actions.openHint : this.actions.revealHint;
      links.push({
        range: { start, end },
        text: text.slice(m.start, m.end),
        activate: (event) => (opens ? this.actions.open(m.path, event) : this.actions.reveal(m.path)),
        hover: () => this.actions.hint?.(hint),
        leave: () => this.actions.hint?.(null),
      });
    }
    callback(links.length ? links : undefined);
  }
}
