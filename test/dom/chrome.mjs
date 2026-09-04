/* A minimum-viable Chrome DevTools Protocol client: launch headless, open one
 * page, read computed styles, force pseudo-states. No dependency, because a
 * gate that needs a 300MB install is a gate somebody turns off.
 *
 * There is no silent skip. If Chrome cannot be found the gate FAILS and names
 * CHROME_BIN, because a guard whose passing state is reachable without the
 * thing being true is worse than no guard at all. */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  const hit = CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(
      'No Chrome binary found for the computed-style gate. Set CHROME_BIN to one. ' +
      `Looked at: ${CANDIDATES.join(', ')}`,
    );
  }
  return hit;
}

export class Chrome {
  #proc = null;
  #ws = null;
  #dir = null;
  #next = 1;
  #pending = new Map();

  static async launch() {
    const chrome = new Chrome();
    await chrome.#start();
    return chrome;
  }

  async #start() {
    const bin = findChrome();
    this.#dir = await mkdtemp(join(tmpdir(), 'aic-cdp-'));
    this.#proc = spawn(bin, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--allow-file-access-from-files',
      '--remote-debugging-port=0',
      `--user-data-dir=${this.#dir}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`Chrome did not report a DevTools endpoint.\n${buf}`)), 30000);
      this.#proc.stderr.on('data', (chunk) => {
        buf += String(chunk);
        const m = buf.match(/ws:\/\/[^\s]+/);
        if (m) { clearTimeout(timer); resolve(m[0]); }
      });
      this.#proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}\n${buf}`)); });
    });

    this.#ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      this.#ws.addEventListener('open', res, { once: true });
      this.#ws.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true });
    });
    this.#ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    });

    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('CSS.enable');
  }

  send(method, params = {}, useSession = true) {
    const id = this.#next++;
    const payload = { id, method, params };
    if (useSession && this.sessionId && !method.startsWith('Target.')) payload.sessionId = this.sessionId;
    this.#ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }));
  }

  /* Navigate and wait for the fixture to signal it finished mounting.
   *
   * `ready` is per CALLER, and it has to be: more than one fixture uses this
   * driver and they do not mount the same things. A readiness condition
   * tightened for one of them silently becomes a requirement for all of them,
   * which is exactly how a guard added for the attachment strip failed the
   * turn fixture, a page that has no composer in it at all. The default is the
   * one element every fixture here does build.
   *
   * The wait is a REQUIREMENT and never a courtesy: an async mount that has
   * not finished reads as an element that does not exist, and a probe that ran
   * on readyState alone would measure a half-built page and call it green. */
  async open(fileUrl, ready = '.aic-root .aic-send') {
    await this.send('Page.navigate', { url: fileUrl });
    const deadline = Date.now() + 20000;
    for (;;) {
      const { result } = await this.send('Runtime.evaluate', {
        expression: 'document.readyState === "complete" && !!document.querySelector('
          + JSON.stringify(ready) + ')',
        returnByValue: true,
      });
      if (result.value === true) return;
      if (Date.now() > deadline) throw new Error(`Fixture never mounted ${ready}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + (exceptionDetails.exception?.description ?? ''));
    return result.value;
  }

  /**
   * Pin :hover (or any pseudo-class) on a set of selectors for the next read.
   *
   * One `DOM.getDocument` for the whole set, deliberately: a second call
   * re-roots the DOM agent and silently DROPS every pseudo-state forced against
   * the previous node ids. Forcing two selectors in two calls left the first
   * one reading its resting style while the second read correctly, which looks
   * exactly like a hover rule that works.
   */
  async forcePseudos(pairs) {
    const { root } = await this.send('DOM.getDocument', { depth: -1 });
    for (const [selector, classes] of pairs) {
      const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`forcePseudos: no node for ${selector}`);
      await this.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
    }
  }

  /**
   * Pin a pseudo-class on EVERY node matching each selector, not just the first.
   *
   * `forcePseudos` answers "does this control's :hover rule work". The focus
   * sweep needs the other question - "is there any focusable element the pen
   * does not reach" -
   * and that one is a sweep, so it has to force the state on all of them at
   * once. Same single-`getDocument` discipline: a second call re-roots the DOM
   * agent and silently drops every state forced against the previous node ids.
   */
  async forcePseudosAll(pairs) {
    const { root } = await this.send('DOM.getDocument', { depth: -1 });
    for (const [selector, classes] of pairs) {
      const { nodeIds } = await this.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
      if (!nodeIds.length) throw new Error(`forcePseudosAll: no nodes for ${selector}`);
      for (const nodeId of nodeIds) {
        await this.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
      }
    }
  }

  async close() {
    try { this.#ws?.close(); } catch { /* already gone */ }
    this.#proc?.kill('SIGKILL');
    if (this.#dir) await rm(this.#dir, { recursive: true, force: true }).catch(() => {});
  }
}
