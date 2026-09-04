/* The same-pane hand-off, the pure part: the state as handed over, the
   guard, and the exit-then-swap ordering against a fake pty. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTerminalState, parseReturnTo, exitThenSwap, claudeArgs, HeldSessions, EXIT_COMMAND } from './build/pure.mjs';

const ID = 'c1427e31-1234-4abc-8def-0123456789ab';
const timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };
const RETURN = { type: 'icor-chat-view', state: { resumeSessionId: ID, provider: 'claude' } };

test('the contract state parses field by field and normalises the id', () => {
  const { state, rejected } = parseTerminalState({
    resumeSessionId: ID.toUpperCase(),
    cwd: '/vault',
    launch: 'claude',
    profile: null,
    returnTo: RETURN,
  });
  assert.deepEqual(rejected, []);
  assert.deepEqual(state, { resumeSessionId: ID, cwd: '/vault', launch: 'claude', returnTo: RETURN });
  assert.equal(state.profile, undefined, 'null means unset, not a rejection');
});

test('a non-UUID resumeSessionId is refused before it can reach argv', () => {
  for (const bad of ['; rm -rf /', `${ID} --dangerously-skip-permissions`, 'c1427e31', 42]) {
    const { state, rejected } = parseTerminalState({ launch: 'claude', resumeSessionId: bad });
    assert.equal(state.resumeSessionId, undefined, String(bad));
    assert.equal(rejected.length, 1, String(bad));
    assert.match(rejected[0], /^resumeSessionId/);
    assert.deepEqual(claudeArgs({ resumeSessionId: state.resumeSessionId ?? null }), []);
  }
  const ok = parseTerminalState({ resumeSessionId: ID });
  assert.deepEqual(claudeArgs(ok.state), ['--resume', ID]);
});

test('a returnTo needs a view type and an object state, and nothing else is a target', () => {
  assert.deepEqual(parseReturnTo(RETURN), RETURN);
  assert.deepEqual(parseReturnTo({ type: 'x' }), { type: 'x', state: {} });
  assert.equal(parseReturnTo({ type: '', state: {} }), null);
  assert.equal(parseReturnTo({ state: {} }), null);
  assert.equal(parseReturnTo('icor-chat-view'), null);
  assert.equal(parseReturnTo(null), null);
  const { state, rejected } = parseTerminalState({ returnTo: { state: {} } });
  assert.equal(state.returnTo, undefined);
  assert.deepEqual(rejected, ['returnTo: needs { type: string, state: object }']);
  assert.deepEqual(parseTerminalState({ returnTo: null }).rejected, [], 'null is "no target"');
  assert.deepEqual(parseTerminalState({ launch: 'python' }).rejected, ["launch: not 'claude' or 'shell'"]);
  assert.deepEqual(parseTerminalState('junk').state, {});
});

test('the guard: one holder per id, in whatever case the id arrives', () => {
  const held = new HeldSessions();
  const holds = (id) => held.holderOf(id.toLowerCase()) !== null;
  assert.ok(!holds(ID));
  assert.ok(held.claim(ID, 'pane-1'));
  assert.ok(holds(ID));
  assert.ok(holds(ID.toUpperCase()), 'the check normalises before it looks');
  assert.ok(!held.claim(ID, 'pane-2'), 'a second terminal pane is refused');
  held.release(ID, 'pane-1');
  assert.ok(!holds(ID), 'released on exit, so AI Chat may resume');
});

class FakePty {
  constructor(opts = {}) {
    this.alive = true;
    this.writes = [];
    this.listeners = new Set();
    this.exitsOn = opts.exitsOn ?? 'enter';
  }
  write(data) {
    if (!this.alive) throw new Error('write after exit');
    this.writes.push(data);
    const typed = this.writes.join('');
    if (this.exitsOn === 'enter' && typed === `${EXIT_COMMAND}\r`) this.end();
  }
  onExit(l) {
    if (!this.alive) l();
    else this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  end() {
    this.alive = false;
    for (const l of this.listeners) l();
    this.listeners.clear();
  }
}

test('exit then swap: /exit, Enter after the settle, swap once, only after the exit', async () => {
  const pty = new FakePty();
  const log = [];
  const result = await exitThenSwap(
    pty,
    async () => {
      log.push(`swap alive=${pty.alive}`);
    },
    { ...timers, settleMs: 5, ceilingMs: 500 },
  );
  assert.equal(result, 'swapped');
  assert.deepEqual(pty.writes, [EXIT_COMMAND, '\r']);
  assert.deepEqual(log, ['swap alive=false']);
});

test('exit then swap: a process that ignores /exit is never swapped away from', async () => {
  const pty = new FakePty({ exitsOn: 'never' });
  let swaps = 0;
  const result = await exitThenSwap(pty, () => void swaps++, { ...timers, settleMs: 5, ceilingMs: 40 });
  assert.equal(result, 'timeout');
  assert.equal(swaps, 0);
  assert.ok(pty.alive);
  assert.deepEqual(pty.writes, [EXIT_COMMAND, '\r']);
  assert.equal(pty.listeners.size, 0, 'the listener is unsubscribed on the ceiling');
});

test('exit then swap: a process that already ended swaps at once, nothing is typed', async () => {
  const pty = new FakePty();
  pty.end();
  let swaps = 0;
  assert.equal(await exitThenSwap(pty, () => void swaps++, timers), 'swapped');
  assert.equal(await exitThenSwap(null, () => void swaps++, timers), 'swapped');
  assert.equal(swaps, 2);
  assert.deepEqual(pty.writes, []);
});

test('exit then swap: an exit that lands before the settle cancels the Enter', async () => {
  const pty = new FakePty({ exitsOn: 'never' });
  const done = exitThenSwap(pty, () => undefined, { ...timers, settleMs: 30, ceilingMs: 500 });
  pty.end();
  assert.equal(await done, 'swapped');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(pty.writes, [EXIT_COMMAND], 'no Enter typed into a dead pty');
});
