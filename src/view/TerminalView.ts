/* One terminal per leaf. The tab IS the wayfinding: Obsidian's own tabs and
 * splits arrange terminals, there is no bespoke tab bar and no toolbar. The
 * pane holds exactly the terminal, a find bar when asked for, and one quiet
 * row when the process has ended. */

import { ItemView, Notice, Scope, setIcon } from 'obsidian';
import type { Menu, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { basename } from 'node:path';
import process from 'node:process';
import { TERMINAL_ICON, VIEW_TYPE_TERMINAL } from '../constants';
import { buildChildEnv, splitPathLines } from '../env';
import { compileAllowList, defaultAllowList, passesToObsidian, splitHotkeyLines, virtualKey } from '../keymap';
import type { CompiledAllowList } from '../keymap';
import { findProfile, resolveShell } from '../profiles';
import { claudeArgs } from '../claude/launch';
import { PtyProcess } from '../pty/PtyProcess';
import { buildPane } from './pane';
import type { PaneRefs } from './pane';
import { readFontFamily, readPalette } from './theme';
import { externalLaunch, openExternalTerminal } from '../platform/external';
import { PromptModal } from './PromptModal';
import type TerminalPlugin from '../main';

export type LaunchKind = 'shell' | 'claude';

/**
 * The leaf state. Persisted by Obsidian into workspace.json, and the shape
 * another plugin hands over with `leaf.setViewState` when it wants this pane
 * to pick up a Claude session: `{ launch: 'claude', resumeSessionId, cwd }`.
 */
export interface TerminalViewState {
  cwd?: string;
  launch?: LaunchKind;
  profile?: string;
  resumeSessionId?: string;
  title?: string;
  /** Wall-clock ms when the pane was opened; a restore after a reload is older than a fresh open. */
  startedAt?: number;
}

const STATE_KEYS: (keyof TerminalViewState)[] = ['cwd', 'launch', 'profile', 'resumeSessionId', 'title', 'startedAt'];

/** Older than this at setState time means Obsidian restored the pane rather than the user opening it. */
const RESTORE_AGE_MS = 5000;
/** Flow control watermarks in bytes queued into xterm. */
const HIGH_WATER = 512 * 1024;
const LOW_WATER = 64 * 1024;
const RESIZE_DEBOUNCE_MS = 40;
const BELL_FLASH_MS = 160;
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let holderCounter = 0;

export class TerminalView extends ItemView {
  private refs: PaneRefs | null = null;
  private term: Terminal | null = null;
  private fit: FitAddon | null = null;
  private search: SearchAddon | null = null;
  private webgl: WebglAddon | null = null;
  private pty: PtyProcess | null = null;
  private ptyCleanup: (() => void)[] = [];
  private state: TerminalViewState = {};
  private launched = false;
  private readonly captureScope: Scope;
  private captureOn: boolean;
  private allow: CompiledAllowList;
  private observer: ResizeObserver | null = null;
  private resizeTimer: number | null = null;
  private pending = 0;
  private paused = false;
  private scopePushed = false;
  private readonly holder = `terminal-${++holderCounter}`;
  private heldId: string | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TerminalPlugin) {
    super(leaf);
    this.navigation = false;
    this.captureOn = plugin.settings.captureKeys;
    this.allow = this.compileAllow();
    this.captureScope = new Scope(this.app.scope);
    /* The catch-all. `true` tells Obsidian the key is handled and to stop
       looking, and the event carries on to xterm untouched. `undefined` on an
       allow-listed key lets the walk fall through to the parent scope, which
       is where Cmd+P lives. */
    this.captureScope.register(null, null, (evt: KeyboardEvent) => {
      if (!this.captureOn) return undefined;
      if (passesToObsidian(evt, this.allow)) return undefined;
      return true;
    });
  }

  private compileAllow(): CompiledAllowList {
    const platform = process.platform;
    return compileAllowList(
      [...defaultAllowList(platform), ...splitHotkeyLines(this.plugin.settings.passthroughKeys)],
      platform,
    );
  }

  /* ------------------------------------------------------------ identity */

  override getViewType(): string {
    return VIEW_TYPE_TERMINAL;
  }

  override getIcon(): string {
    return TERMINAL_ICON;
  }

  override getDisplayText(): string {
    if (this.state.title) return this.state.title;
    const where = this.state.cwd ? basename(this.state.cwd) : 'terminal';
    if (this.state.launch === 'claude') return `claude · ${where}`;
    const profile = findProfile(this.plugin.settings.profiles, this.state.profile ?? this.plugin.settings.defaultProfile);
    const shell = profile.command ? basename(profile.command) : basename(resolveShell(process.env, process.platform));
    return `${shell} · ${where}`;
  }

  get viewState(): TerminalViewState {
    return { ...this.state };
  }

  get heldSessionId(): string | null {
    return this.heldId;
  }

  get captureEnabled(): boolean {
    return this.captureOn;
  }

  /* --------------------------------------------------------------- state */

  override getState(): Record<string, unknown> {
    return { ...this.state };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === 'object') {
      const s = state as Record<string, unknown>;
      for (const k of STATE_KEYS) {
        const v = s[k];
        if (k === 'startedAt') {
          if (typeof v === 'number') this.state.startedAt = v;
        } else if (k === 'launch') {
          if (v === 'shell' || v === 'claude') this.state.launch = v;
        } else if (typeof v === 'string') {
          this.state[k] = v;
        }
      }
    }
    await super.setState(state, result);
    this.refreshHeader();
    this.ensureLaunched();
  }

  private refreshHeader(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

  /* ---------------------------------------------------------------- mount */

  override async onOpen(): Promise<void> {
    const host = this.contentEl;
    host.empty();
    host.addClass('ict-host');
    this.refs = buildPane(host, { icon: (el, name) => setIcon(el, name) });
    const s = this.plugin.settings;
    const term = new Terminal({
      allowProposedApi: true,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      scrollback: s.scrollback,
      macOptionIsMeta: true,
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
      scrollOnUserInput: true,
    });
    this.term = term;
    this.fit = new FitAddon();
    this.search = new SearchAddon();
    term.loadAddon(this.fit);
    term.loadAddon(this.search);
    term.loadAddon(new WebLinksAddon((_evt, uri) => window.open(uri)));
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.open(this.refs.surface);
    this.applyTheme();
    this.mountRenderer();
    this.wireKeyboard();
    this.wireSearch();
    this.wireExitRow();
    term.onSelectionChange(() => {
      if (this.plugin.settings.copyOnSelect && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
      }
    });
    term.onBell(() => this.flashBell());
    this.observer = new ResizeObserver(() => this.scheduleFit());
    this.observer.observe(this.refs.surface);
    this.registerEvent(this.app.workspace.on('css-change', () => {
      this.applyTheme();
      this.scheduleFit();
    }));
    this.plugin.trackView(this);
    await Promise.resolve();
  }

  private mountRenderer(): void {
    if (!this.term || this.plugin.settings.renderer === 'dom') return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        this.webgl = null;
      });
      this.term.loadAddon(webgl);
      this.webgl = webgl;
    } catch {
      /* No WebGL here: xterm keeps its DOM renderer, which is the fallback. */
      this.webgl = null;
    }
  }

  get rendererName(): 'webgl' | 'dom' {
    return this.webgl ? 'webgl' : 'dom';
  }

  applyTheme(): void {
    if (!this.term || !this.refs) return;
    const cs = getComputedStyle(this.refs.root);
    const read = (token: string): string => cs.getPropertyValue(token);
    this.term.options.theme = readPalette(read);
    this.term.options.fontFamily = readFontFamily(read, this.plugin.settings.fontFamily);
  }

  /** Settings changed while the pane is open: re-read what xterm can change live. */
  applySettings(): void {
    const s = this.plugin.settings;
    this.allow = this.compileAllow();
    if (!this.term) return;
    this.term.options.fontSize = s.fontSize;
    this.term.options.lineHeight = s.lineHeight;
    this.term.options.scrollback = s.scrollback;
    this.term.options.cursorStyle = s.cursorStyle;
    this.term.options.cursorBlink = s.cursorBlink;
    this.applyTheme();
    this.scheduleFit();
  }

  private scheduleFit(): void {
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.doFit();
    }, RESIZE_DEBOUNCE_MS);
  }

  private doFit(): void {
    if (!this.fit || !this.term || !this.refs) return;
    if (this.refs.surface.clientWidth === 0 || this.refs.surface.clientHeight === 0) return;
    const before = { cols: this.term.cols, rows: this.term.rows };
    this.fit.fit();
    if (this.term.cols !== before.cols || this.term.rows !== before.rows) {
      this.pty?.resize(this.term.cols, this.term.rows);
    }
  }

  /* ------------------------------------------------------------- keyboard */

  private wireKeyboard(): void {
    const term = this.term;
    const textarea = term?.textarea;
    if (!term || !textarea) return;
    this.registerDomEvent(textarea, 'focus', () => this.pushScope());
    this.registerDomEvent(textarea, 'blur', () => this.popScope());
    const platform = process.platform;
    term.attachCustomKeyEventHandler((evt) => {
      if (evt.type !== 'keydown') return true;
      if (this.captureOn && passesToObsidian(evt, this.allow)) return false;
      const mod = platform === 'darwin' ? evt.metaKey && !evt.ctrlKey : evt.ctrlKey && evt.shiftKey;
      if (mod && !evt.altKey) {
        const k = virtualKey(evt);
        if (k === 'k') {
          term.clear();
          return false;
        }
        if (k === 'f') {
          this.openSearch();
          return false;
        }
      }
      return true;
    });
  }

  private pushScope(): void {
    if (this.scopePushed) return;
    this.app.keymap.pushScope(this.captureScope);
    this.scopePushed = true;
  }

  private popScope(): void {
    if (!this.scopePushed) return;
    this.app.keymap.popScope(this.captureScope);
    this.scopePushed = false;
  }

  toggleCapture(): boolean {
    this.captureOn = !this.captureOn;
    new Notice(this.captureOn ? 'Terminal: keyboard captured' : 'Terminal: keyboard released');
    return this.captureOn;
  }

  /* --------------------------------------------------------------- search */

  private wireSearch(): void {
    const refs = this.refs;
    const search = this.search;
    if (!refs || !search) return;
    const bar = refs.search;
    const opts = () => ({
      decorations: {
        matchOverviewRuler: 'transparent',
        activeMatchColorOverviewRuler: 'transparent',
        matchBackground: this.readToken('--ict-search-match'),
        activeMatchBackground: this.readToken('--ict-search-active'),
      },
    });
    const next = (): void => {
      if (bar.input.value) search.findNext(bar.input.value, opts());
    };
    const prev = (): void => {
      if (bar.input.value) search.findPrevious(bar.input.value, opts());
    };
    search.onDidChangeResults((e) => bar.setCount(e.resultIndex, e.resultCount));
    this.registerDomEvent(bar.input, 'input', () => {
      if (bar.input.value) search.findNext(bar.input.value, { ...opts(), incremental: true });
      else {
        search.clearDecorations();
        bar.setCount(-1, 0);
      }
    });
    this.registerDomEvent(bar.input, 'keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        if (evt.shiftKey) prev();
        else next();
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        this.closeSearch();
      }
    });
    this.registerDomEvent(bar.next, 'click', next);
    this.registerDomEvent(bar.prev, 'click', prev);
    this.registerDomEvent(bar.close, 'click', () => this.closeSearch());
  }

  private readToken(token: string): string {
    if (!this.refs) return '';
    return getComputedStyle(this.refs.root).getPropertyValue(token).trim();
  }

  openSearch(): void {
    if (!this.refs) return;
    this.refs.search.show();
    this.refs.search.input.focus();
    this.refs.search.input.select();
    this.scheduleFit();
  }

  closeSearch(): void {
    if (!this.refs) return;
    this.refs.search.hide();
    this.search?.clearDecorations();
    this.term?.focus();
    this.scheduleFit();
  }

  /* ------------------------------------------------------------ lifecycle */

  private ensureLaunched(): void {
    if (this.launched || !this.term) return;
    this.launched = true;
    const restored = typeof this.state.startedAt === 'number' && Date.now() - this.state.startedAt > RESTORE_AGE_MS;
    this.launch(restored);
  }

  private launch(restored: boolean): void {
    const term = this.term;
    const refs = this.refs;
    if (!term || !refs) return;
    const s = this.plugin.settings;
    const launch: LaunchKind = this.state.launch ?? 'shell';
    const profile = findProfile(s.profiles, this.state.profile ?? s.defaultProfile);
    const cwd = this.state.cwd ?? this.plugin.vaultPath;
    this.state.cwd = cwd;
    this.state.launch = launch;
    this.refreshHeader();

    let command: string;
    let args: string[];
    if (launch === 'claude') {
      const id = this.state.resumeSessionId ?? null;
      if (id) {
        if (!this.plugin.held.claim(id, this.holder)) {
          refs.notice.show(
            'Session in use',
            'Another terminal pane already holds this Claude session. Two live writers would fork it.',
            null,
          );
          return;
        }
        this.heldId = id;
      }
      command = this.plugin.claudeExecutable();
      args = claudeArgs({ resumeSessionId: id });
    } else {
      command = profile.command.trim() || resolveShell(process.env, process.platform);
      args = profile.args;
    }

    const env = {
      ...buildChildEnv(process.env, {
        platform: process.platform,
        home: process.env.HOME ?? process.env.USERPROFILE ?? '',
        vaultPath: this.plugin.vaultPath,
        version: this.plugin.manifest.version,
        extraPath: splitPathLines(s.extraPath),
      }),
      ...profile.env,
    };

    if (process.platform === 'win32') {
      this.launchExternal(cwd, [command, ...args], env);
      return;
    }

    this.doFit();
    if (restored) {
      term.writeln(`${DIM}restored after a reload · scrollback is not kept, the shell starts fresh in the same folder${RESET}`);
    }
    const pty = new PtyProcess({
      python: s.pythonPath,
      command,
      args,
      cwd,
      env,
      cols: term.cols,
      rows: term.rows,
    });
    this.pty = pty;
    this.pending = 0;
    this.paused = false;
    this.ptyCleanup.push(
      pty.onData((chunk) => this.onOutput(chunk)),
      pty.onExit((exit) => {
        this.releaseHeld();
        refs.exit.show({ code: exit.code, signal: exit.signal, ready: exit.ready, detail: exit.stderr });
        this.scheduleFit();
      }),
    );
    const dataSub = term.onData((d) => pty.write(d));
    const resizeSub = term.onResize(({ cols, rows }) => pty.resize(cols, rows));
    this.ptyCleanup.push(() => dataSub.dispose(), () => resizeSub.dispose());
    refs.exit.hide();
    refs.notice.hide();
    term.focus();
  }

  private onOutput(chunk: Buffer): void {
    const term = this.term;
    const pty = this.pty;
    if (!term || !pty) return;
    this.pending += chunk.length;
    if (!this.paused && this.pending > HIGH_WATER) {
      pty.pause();
      this.paused = true;
    }
    term.write(chunk, () => {
      this.pending -= chunk.length;
      if (this.paused && this.pending < LOW_WATER) {
        this.paused = false;
        pty.resume();
      }
    });
  }

  private launchExternal(cwd: string, command: string[], env: Record<string, string>): void {
    const refs = this.refs;
    if (!refs) return;
    const launch = externalLaunch(this.plugin.settings.windowsLauncher, cwd, command);
    refs.notice.show(
      'Windows',
      'An integrated terminal pane needs a pseudo-terminal, and on Windows that needs a native component this plugin cannot ship. This button opens your own terminal in the same folder instead.',
      launch ? 'Open in external terminal' : null,
    );
    if (!launch) return;
    this.registerDomEvent(refs.notice.action, 'click', () => {
      openExternalTerminal(launch, cwd, env).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Terminal: could not open ${launch.file}: ${message}`);
      });
    });
  }

  private releaseHeld(): void {
    if (this.heldId) {
      this.plugin.held.release(this.heldId, this.holder);
      this.heldId = null;
    }
  }

  private teardownPty(): void {
    for (const c of this.ptyCleanup) c();
    this.ptyCleanup = [];
    this.pty?.dispose();
    this.pty = null;
    this.releaseHeld();
  }

  /** Ends the process without closing the pane; the exit row will show. */
  terminate(): void {
    this.pty?.kill();
  }

  restart(): void {
    this.teardownPty();
    this.refs?.exit.hide();
    this.term?.writeln('');
    this.launch(false);
  }

  clear(): void {
    this.term?.clear();
  }

  focusTerminal(): void {
    this.term?.focus();
  }

  async rename(): Promise<void> {
    const modal = new PromptModal(this.app, {
      title: 'Rename terminal',
      label: 'Tab title',
      initial: this.state.title ?? this.getDisplayText(),
      submit: 'Rename',
    });
    modal.open();
    const value = await modal.result;
    if (value === null) return;
    const t = value.trim();
    if (t) this.state.title = t;
    else delete this.state.title;
    this.refreshHeader();
    this.app.workspace.requestSaveLayout();
  }

  private wireExitRow(): void {
    const refs = this.refs;
    if (!refs) return;
    this.registerDomEvent(refs.exit.restart, 'click', () => this.restart());
    this.registerDomEvent(refs.exit.close, 'click', () => this.leaf.detach());
  }

  private flashBell(): void {
    const root = this.refs?.root;
    if (!root || !this.plugin.settings.bellFlash) return;
    root.addClass('ict-bell');
    window.setTimeout(() => root.removeClass('ict-bell'), BELL_FLASH_MS);
  }

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((i) => i.setTitle('Rename terminal').setIcon('pencil').setSection('terminal').onClick(() => void this.rename()));
    menu.addItem((i) => i.setTitle('Restart shell').setIcon('rotate-ccw').setSection('terminal').onClick(() => this.restart()));
    menu.addItem((i) => i.setTitle('Clear terminal').setIcon('eraser').setSection('terminal').onClick(() => this.clear()));
    menu.addItem((i) => i.setTitle('Find in terminal').setIcon('search').setSection('terminal').onClick(() => this.openSearch()));
    menu.addItem((i) =>
      i
        .setTitle(this.captureOn ? 'Release keyboard to Obsidian' : 'Capture keyboard in terminal')
        .setIcon('keyboard')
        .setSection('terminal')
        .onClick(() => this.toggleCapture()),
    );
  }

  override async onClose(): Promise<void> {
    this.popScope();
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.observer?.disconnect();
    this.observer = null;
    this.teardownPty();
    this.webgl?.dispose();
    this.webgl = null;
    this.term?.dispose();
    this.term = null;
    this.fit = null;
    this.search = null;
    this.refs = null;
    this.plugin.untrackView(this);
    await Promise.resolve();
  }
}
