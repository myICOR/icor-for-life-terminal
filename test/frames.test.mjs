import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeResize, parseResize, clampDimension, MAX_DIMENSION, HELPER_ARGV_PREFIX } from './build/pure.mjs';

test('a resize frame is one line the helper parses back to the same numbers', () => {
  assert.equal(encodeResize(120, 40), 'resize 120 40\n');
  assert.deepEqual(parseResize(encodeResize(120, 40)), { cols: 120, rows: 40 });
});

test('dimensions are clamped to the pty window range and floored to integers', () => {
  assert.equal(clampDimension(0, 80), 1);
  assert.equal(clampDimension(99.9, 80), 99);
  assert.equal(clampDimension(NaN, 80), 80);
  assert.equal(clampDimension(1e9, 80), MAX_DIMENSION);
  assert.equal(encodeResize(-5, Infinity), 'resize 1 24\n');
});

test('the helper parse refuses anything but three tokens of the right kind', () => {
  assert.equal(parseResize('resize 1'), null);
  assert.equal(parseResize('resize a b'), null);
  assert.equal(parseResize('size 1 2'), null);
  assert.equal(parseResize('resize 0 5'), null);
});

test('the helper ships as a -c string, and it reads the same frame grammar', () => {
  assert.deepEqual(HELPER_ARGV_PREFIX.slice(0, 2), ['-I', '-c'], 'isolated mode: the cwd never enters sys.path');
  /* Code lines only: the header comment names the pitfalls it avoids. */
  const source = HELPER_ARGV_PREFIX[2].split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.match(source, /pty\.fork\(\)/);
  assert.match(source, /parts\[0\] != b"resize"/);
  assert.match(source, /waitpid\(pid, os\.WNOHANG\)/, 'the macOS EOF quirk needs waitpid polling');
  assert.doesNotMatch(source, /ttyname/, 'os.ttyname raises on a ptmx master on macOS');
  assert.doesNotMatch(source, /environ/, 'the helper never reads or prints the environment');
});
