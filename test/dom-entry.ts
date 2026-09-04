/* The browser fixture: mount the SHIPPED pane builders and a real xterm on
 * the plugin's stylesheet, in a page with no Obsidian in it. Obsidian's
 * element helpers (createEl, createDiv, createSpan, setAttr, setText,
 * addClass, toggleClass, empty) are polyfilled here with the same signatures,
 * because the builders are written on them and a copy of the builders would
 * only ever agree with itself. */
import { Terminal } from '@xterm/xterm';
import { buildPane } from '../src/view/pane';
import { readPalette, readFontFamily, paletteTokens } from '../src/view/theme';

type Opts = { cls?: string; text?: string; attr?: Record<string, string> };

function make(this: Node, tag: string, opts?: Opts): HTMLElement {
  const el = document.createElement(tag);
  if (opts?.cls) el.className = opts.cls;
  if (opts?.text) el.textContent = opts.text;
  if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
  this.appendChild(el);
  return el;
}

const proto = Node.prototype as unknown as Record<string, unknown>;
proto.createEl = make;
proto.createDiv = function (this: Node, opts?: Opts) { return make.call(this, 'div', opts); };
proto.createSpan = function (this: Node, opts?: Opts) { return make.call(this, 'span', opts); };
const eproto = Element.prototype as unknown as Record<string, unknown>;
eproto.setAttr = function (this: Element, k: string, v: string) { this.setAttribute(k, v); };
eproto.setText = function (this: Element, t: string) { this.textContent = t; };
eproto.addClass = function (this: Element, ...c: string[]) { this.classList.add(...c); };
eproto.removeClass = function (this: Element, ...c: string[]) { this.classList.remove(...c); };
eproto.toggleClass = function (this: Element, c: string, on: boolean) { this.classList.toggle(c, on); };
eproto.empty = function (this: Element) { this.replaceChildren(); };

const host = document.getElementById('host') as HTMLElement;
const refs = buildPane(host, { icon: (el, name) => { el.setAttribute('data-icon', name); } });
const cs = getComputedStyle(refs.root);
const read = (t: string) => cs.getPropertyValue(t);
const palette = readPalette(read);
const term = new Terminal({ allowProposedApi: true, fontFamily: readFontFamily(read, ''), theme: palette });
term.open(refs.surface);
refs.exit.show({ code: 0, signal: null, ready: true, detail: '' });
refs.search.show();
term.write('ICOR_DOM_OK', () => {
  const w = window as unknown as Record<string, unknown>;
  w.ictPalette = palette;
  w.ictTokens = paletteTokens();
  w.ictRows = term.rows;
  w.ictCols = term.cols;
  document.body.setAttribute('data-ict-ready', '1');
});
