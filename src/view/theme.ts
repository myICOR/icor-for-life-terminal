/* xterm's palette, read from the plugin's CSS tokens at mount and again on
 * every `css-change`. The stylesheet is the single source: `--ict-*` tokens
 * defer to INKLINE's `--ink-*` and fall back to stock Obsidian variables, so
 * the SAME token that colours the exit row colours the terminal cells, and a
 * theme switch re-reads them rather than restating them in code.
 *
 * Pure apart from the `read` function it is handed: in the plugin that is
 * getComputedStyle on the pane root; in the DOM gate it is the same call on a
 * fixture, and in the pure test it is a map. */

export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionInactiveBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const PALETTE_TOKENS: Record<keyof TerminalPalette, string> = {
  background: '--ict-bg',
  foreground: '--ict-fg',
  cursor: '--ict-cursor',
  cursorAccent: '--ict-bg',
  selectionBackground: '--ict-selection',
  selectionInactiveBackground: '--ict-selection-inactive',
  black: '--ict-ansi-black',
  red: '--ict-ansi-red',
  green: '--ict-ansi-green',
  yellow: '--ict-ansi-yellow',
  blue: '--ict-ansi-blue',
  magenta: '--ict-ansi-magenta',
  cyan: '--ict-ansi-cyan',
  white: '--ict-ansi-white',
  brightBlack: '--ict-ansi-bright-black',
  brightRed: '--ict-ansi-bright-red',
  brightGreen: '--ict-ansi-bright-green',
  brightYellow: '--ict-ansi-bright-yellow',
  brightBlue: '--ict-ansi-bright-blue',
  brightMagenta: '--ict-ansi-bright-magenta',
  brightCyan: '--ict-ansi-bright-cyan',
  brightWhite: '--ict-ansi-bright-white',
};

export const FONT_TOKEN = '--ict-mono';

export type TokenReader = (token: string) => string;

/** Every token that resolved to a non-empty value; the rest are left to xterm's defaults. */
export function readPalette(read: TokenReader): Partial<TerminalPalette> {
  const out: Partial<TerminalPalette> = {};
  for (const [name, token] of Object.entries(PALETTE_TOKENS) as [keyof TerminalPalette, string][]) {
    const v = read(token).trim();
    if (v) out[name] = v;
  }
  return out;
}

export function readFontFamily(read: TokenReader, override: string): string {
  const o = override.trim();
  if (o) return o;
  const v = read(FONT_TOKEN).trim();
  return v || 'ui-monospace, SFMono-Regular, Menlo, monospace';
}

/** The names a computed-style reader should expose, for the gate. */
export function paletteTokens(): string[] {
  return [...new Set(Object.values(PALETTE_TOKENS)), FONT_TOKEN];
}
