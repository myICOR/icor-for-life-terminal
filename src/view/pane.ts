/* The pane's DOM. Built on Obsidian's own element API (createEl, createDiv,
 * createSpan), which the headless-Chrome gate polyfills with the same
 * signatures so it can mount the SHIPPED builders without an Obsidian runtime.
 * Every control is a real <button> with an accessible name; the icon setter
 * is injected because Obsidian's setIcon is the only icon source and the
 * gate has none. */

import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME } from '../constants';

export type IconSetter = (el: HTMLElement, icon: string) => void;

export interface PaneOptions {
  icon?: IconSetter;
}

export interface ButtonSpec {
  label: string;
  icon?: string;
  cls?: string;
}

export function button(parent: HTMLElement, spec: ButtonSpec, icon?: IconSetter): HTMLButtonElement {
  const b = parent.createEl('button', { cls: `ict-btn${spec.cls ? ` ${spec.cls}` : ''}`, attr: { type: 'button' } });
  b.setAttr('aria-label', spec.label);
  b.title = spec.label;
  if (spec.icon && icon) {
    b.addClass('ict-btn-icon');
    icon(b, spec.icon);
  } else {
    b.setText(spec.label);
  }
  return b;
}

export interface SearchBar {
  el: HTMLElement;
  input: HTMLInputElement;
  count: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
  show(): void;
  hide(): void;
  get visible(): boolean;
  setCount(index: number, total: number): void;
}

export function buildSearchBar(parent: HTMLElement, icon?: IconSetter): SearchBar {
  const el = parent.createDiv({ cls: 'ict-search', attr: { role: 'search' } });
  el.hidden = true;
  el.createSpan({ cls: 'ict-kicker', text: 'Find' });
  const input = el.createEl('input', {
    cls: 'ict-search-input',
    attr: { type: 'search', 'aria-label': 'Find in terminal', placeholder: 'Find in terminal', spellcheck: 'false' },
  });
  const count = el.createSpan({ cls: 'ict-search-count', attr: { 'aria-live': 'polite' } });
  const prev = button(el, { label: 'Previous match', icon: 'chevron-up' }, icon);
  const next = button(el, { label: 'Next match', icon: 'chevron-down' }, icon);
  const close = button(el, { label: 'Close find', icon: 'x' }, icon);
  return {
    el,
    input,
    count,
    prev,
    next,
    close,
    show() {
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
      count.setText('');
    },
    get visible() {
      return !el.hidden;
    },
    setCount(index, total) {
      /* Both numbers come from the search addon's own result event. */
      if (total <= 0) count.setText(input.value ? 'No matches' : '');
      else count.setText(`${index + 1} of ${total}`);
    },
  };
}

export interface ExitState {
  code: number | null;
  signal: string | null;
  ready: boolean;
  detail: string;
}

export interface ExitRow {
  el: HTMLElement;
  kicker: HTMLElement;
  note: HTMLElement;
  detail: HTMLElement;
  restart: HTMLButtonElement;
  close: HTMLButtonElement;
  show(state: ExitState): void;
  hide(): void;
}

/** The kicker line: what happened, in the numbers the process reported. */
export function exitKicker(state: ExitState): string {
  if (!state.ready) return 'Could not start';
  if (state.signal) return `Ended by ${state.signal}`;
  if (state.code === null) return 'Ended';
  return `Exited · code ${state.code}`;
}

export function exitNote(state: ExitState): string {
  if (!state.ready) return 'the terminal never got going. the message below says why.';
  if (state.code === 0 && !state.signal) return 'the shell is done. start another?';
  return 'that one ended badly. start another?';
}

export function isFailure(state: ExitState): boolean {
  return !state.ready || (state.code !== 0 && state.code !== null) || !!state.signal;
}

export function buildExitRow(parent: HTMLElement, icon?: IconSetter): ExitRow {
  const el = parent.createDiv({ cls: 'ict-exit', attr: { role: 'status' } });
  el.hidden = true;
  const kicker = el.createDiv({ cls: 'ict-kicker ict-exit-kicker' });
  const note = el.createDiv({ cls: 'ict-hand ict-exit-note' });
  const detail = el.createEl('pre', { cls: 'ict-exit-detail' });
  detail.hidden = true;
  const actions = el.createDiv({ cls: 'ict-exit-actions' });
  const restart = button(actions, { label: 'Restart', cls: 'ict-btn-marker' });
  if (icon) {
    restart.setText('');
    icon(restart, 'rotate-ccw');
    restart.createSpan({ text: 'Restart' });
  }
  const close = button(actions, { label: 'Close pane' });
  return {
    el,
    kicker,
    note,
    detail,
    restart,
    close,
    show(state) {
      kicker.setText(exitKicker(state));
      note.setText(exitNote(state));
      const d = state.detail.trim();
      detail.setText(d);
      detail.hidden = !d;
      el.toggleClass('ict-exit-failed', isFailure(state));
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

export interface Notice {
  el: HTMLElement;
  kicker: HTMLElement;
  body: HTMLElement;
  action: HTMLButtonElement;
  show(kicker: string, body: string, action: string | null): void;
  hide(): void;
}

/** A quiet message inside the pane, with one optional action. */
export function buildNotice(parent: HTMLElement): Notice {
  const el = parent.createDiv({ cls: 'ict-notice' });
  el.hidden = true;
  const kicker = el.createDiv({ cls: 'ict-kicker' });
  const body = el.createDiv({ cls: 'ict-notice-body' });
  const action = button(el, { label: 'Open' });
  return {
    el,
    kicker,
    body,
    action,
    show(k, b, a) {
      kicker.setText(k);
      body.setText(b);
      action.hidden = a === null;
      if (a !== null) {
        action.setText(a);
        action.setAttr('aria-label', a);
        action.title = a;
      }
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}

export interface PaneRefs {
  root: HTMLElement;
  surface: HTMLElement;
  search: SearchBar;
  exit: ExitRow;
  notice: Notice;
}

export function buildPane(host: HTMLElement, opts: PaneOptions = {}): PaneRefs {
  const root = host.createDiv({ cls: 'ict-root' });
  root.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
  const search = buildSearchBar(root, opts.icon);
  const surface = root.createDiv({ cls: 'ict-surface' });
  const notice = buildNotice(root);
  const exit = buildExitRow(root, opts.icon);
  return { root, surface, search, exit, notice };
}
