import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeArgs, isSessionId, normaliseSessionId, HeldSessions } from './build/pure.mjs';

const ID = 'c1427e31-1234-4abc-8def-0123456789ab';

test('claude argv: bare for a new session, --resume for a known id, never for junk', () => {
  assert.deepEqual(claudeArgs({}), []);
  assert.deepEqual(claudeArgs({ resumeSessionId: ID }), ['--resume', ID]);
  assert.deepEqual(claudeArgs({ resumeSessionId: '; rm -rf /' }), []);
});

test('a pasted "claude --resume <id>" line yields the id', () => {
  assert.equal(normaliseSessionId(`Resume this session with: claude --resume ${ID.toUpperCase()}`), ID);
  assert.equal(normaliseSessionId('nothing here'), null);
  assert.ok(isSessionId(ID));
  assert.ok(!isSessionId('c1427e31'));
});

test('a session id is held by one pane at a time', () => {
  const h = new HeldSessions();
  assert.ok(h.claim(ID, 'a'));
  assert.ok(h.claim(ID, 'a'), 'the same holder may re-claim');
  assert.ok(!h.claim(ID, 'b'), 'a second pane is refused');
  assert.equal(h.holderOf(ID), 'a');
  h.release(ID, 'b');
  assert.equal(h.holderOf(ID), 'a', 'a non-holder cannot release');
  h.release(ID, 'a');
  assert.equal(h.holderOf(ID), null);
  h.claim(ID, 'c');
  h.releaseAll('c');
  assert.equal(h.size, 0);
});
