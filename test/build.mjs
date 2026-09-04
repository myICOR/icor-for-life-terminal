/* Two bundles feed the gate: the pure surface node:test imports directly, and
 * a browser fixture the headless-Chrome gate mounts. The fixture bundles the
 * SHIPPED pane builders and xterm itself; a hand-written copy of the markup
 * would only ever agree with itself. */
import esbuild from 'esbuild';
import { builtinModules as builtins } from 'node:module';

const external = [...builtins, ...builtins.map((m) => `node:${m}`)];

await esbuild.build({
  entryPoints: ['test/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'test/build/pure.mjs',
  logLevel: 'warning',
  loader: { '.py': 'text' },
  external,
});

await esbuild.build({
  entryPoints: ['test/dom-entry.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'test/build/dom.js',
  logLevel: 'warning',
});
