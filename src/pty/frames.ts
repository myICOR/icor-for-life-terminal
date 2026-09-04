/* The resize channel between the plugin and the pty helper.
 *
 * The helper reads fd 3 as a line protocol: `resize <cols> <rows>\n`. It is a
 * separate descriptor on purpose: keystrokes go down stdin byte for byte, and
 * a control message mixed into that stream would need an escape the shell
 * could never see. Both ends parse the same grammar; `parseResize` exists so
 * the test can prove the encoder writes what the helper reads. */

export const MIN_DIMENSION = 1;
export const MAX_DIMENSION = 10000;

/** Integers only, inside the pty window range; anything else takes the fallback. */
export function clampDimension(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, n));
}

export function encodeResize(cols: number, rows: number): string {
  return `resize ${clampDimension(cols, 80)} ${clampDimension(rows, 24)}\n`;
}

/** The helper's parse, mirrored: one complete line, three tokens, two ints. */
export function parseResize(line: string): { cols: number; rows: number } | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 3 || parts[0] !== 'resize') return null;
  const cols = Number(parts[1]);
  const rows = Number(parts[2]);
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  if (cols < MIN_DIMENSION || rows < MIN_DIMENSION) return null;
  if (cols > MAX_DIMENSION || rows > MAX_DIMENSION) return null;
  return { cols, rows };
}
