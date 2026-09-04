/* Build ICOR for Life - Terminal into a single CommonJS main.js for Obsidian.
 *
 * Two things this build does that a stock Obsidian sample does not:
 *
 *   1. `.py` files load as TEXT. The pty helper is Python source and it ships
 *      inside main.js as a string, spawned with `python3 -c`. It is the only
 *      route to a real pty without a native module, and a native module cannot
 *      ride a directory release (main.js, manifest.json, styles.css and
 *      nothing else).
 *   2. styles.css is ASSEMBLED, not hand-written: xterm's own stylesheet
 *      (MIT, verbatim, with its licence header) followed by this plugin's
 *      terminal.css. Obsidian loads exactly one stylesheet per plugin, so the
 *      upstream css has to live in it, and copying it by hand is how an
 *      upstream fix gets missed. The assembled file is committed because it is
 *      a release asset.
 */
import esbuild from 'esbuild';
import { builtinModules as builtins } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const production = process.argv[2] === 'production';

/* Upstream xterm.css carries six declarations the directory's CSS scanner
 * rejects (use-baseline and no-important). Each is rewritten here, with its
 * reason, rather than hand-edited in the shipped file, so an xterm upgrade
 * re-applies the same edits and test/hygiene.test.mjs proves none survived:
 *   - `user-select` / `-ms-user-select`: dropped; `-webkit-user-select` stays
 *     and is the one Chromium (Electron) honours.
 *   - `resize: none` on the helper textarea: dropped; the element is 0 by 0
 *     and off-screen, nothing can resize it.
 *   - the `*::selection` rule in the accessibility tree: dropped; it only
 *     matters in screen-reader mode, and Chromium paints the tree's own
 *     transparent text anyway.
 *   - `.xterm-dim { opacity: 1 !important }`: the runtime generates
 *     `.xterm-dim { color: ... }` and never an opacity, so this was a guard
 *     against older custom css; `.xterm .xterm-dim { opacity: 1 }` out-ranks
 *     any single-class rule the same way without the flag.
 *   - `.scra { font-size: 11px !important }`: the scrollbar arrow class does
 *     not occur in the runtime at all; the flag is dropped, the rule kept.
 *   - `text-decoration: double underline` and the other shorthands that carry
 *     a style keyword or two lines (the `.xterm-underline-N` and
 *     `.xterm-overline.xterm-underline-N` rules): the directory's baseline
 *     check reads a styled or two-line decoration as only partially
 *     supported at the declared floor, in the shorthand (0.1.0 review) and
 *     in the `text-decoration-line` / `text-decoration-style` longhands
 *     alike (0.1.1 review, both 2026-09-04). Only the plain single-keyword
 *     forms (`underline`, `overline`, `line-through`) pass, so every
 *     multi-value declaration is mapped to ONE plain keyword: `underline`
 *     when the value carries it, else the first line keyword. The cost is
 *     confined to the DOM renderer (the fallback behind WebGL): it draws
 *     double, wavy, dotted and dashed underlines as a plain underline and
 *     an overline plus underline as the underline alone. The WebGL renderer,
 *     the default, draws decorations on its canvas and never reads these
 *     rules. */
const DECORATION_LINES = ['underline', 'line-through', 'overline'];

export function plainTextDecoration(declaration, value) {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 2) return declaration;
  const line = DECORATION_LINES.find((l) => tokens.includes(l));
  if (!line) throw new Error(`text-decoration without a line keyword: ${value}`);
  return `text-decoration: ${line};`;
}

export function transformUpstreamCss(css) {
  return css
    .replace(/^\s*user-select:\s*[^;]+;\s*\n/gm, '')
    .replace(/^\s*-ms-user-select:\s*[^;]+;\s*\n/gm, '')
    .replace(/^\s*resize:\s*none;\s*\n/gm, '')
    .replace(/\.xterm \.xterm-accessibility-tree:not\(\.debug\) \*::selection \{[^}]*\}\s*/g, '')
    .replace(/\.xterm-dim \{([^}]*?)opacity:\s*1\s*!important;/g, '.xterm .xterm-dim {$1opacity: 1;')
    .replace(/font-size:\s*11px\s*!important;/g, 'font-size: 11px;')
    .replace(/text-decoration:\s*([^;]+);/g, plainTextDecoration);
}

export function assembleStyles() {
  const xterm = transformUpstreamCss(readFileSync('node_modules/@xterm/xterm/css/xterm.css', 'utf8'));
  const own = readFileSync('src/terminal.css', 'utf8');
  const out = [
    '/* ICOR for Life - Terminal - styles.css is ASSEMBLED by esbuild.config.mjs.',
    ' * Edit src/terminal.css, never this file. Section 1 is @xterm/xterm/css/xterm.css',
    ' * verbatim (MIT, see THIRD-PARTY-NOTICES.md); section 2 is the plugin. */',
    '',
    '/* ==================================================== 1. xterm.css (upstream) */',
    '',
    xterm.trim(),
    '',
    '/* ==================================================== 2. ICOR for Life - Terminal */',
    '',
    own.trim(),
    '',
  ].join('\n');
  writeFileSync('styles.css', out);
}

assembleStyles();

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  logLevel: 'info',
  treeShaking: true,
  sourcemap: production ? false : 'inline',
  minify: production,
  loader: { '.py': 'text' },
  external: [
    'obsidian',
    'electron',
    '@codemirror/state',
    '@codemirror/view',
    ...builtins,
    ...builtins.map((m) => `node:${m}`),
  ],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
