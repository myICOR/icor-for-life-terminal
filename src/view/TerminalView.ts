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
import { CHAT_PLUGIN_ID, CHAT_VIEW_TYPE, TERMINAL_ICON, VIEW_TYPE_TERMINAL } from '../constants';
import { buildChildEnv, splitPathLines } from '../env';
import { captureApplies, compileAllowList, defaultAllowList, passesToObsidian, splitHotkeyLines, virtualKey } from '../keymap';
import type { CompiledAllowList } from '../keymap';
import { findProfile, resolveShell } from '../profiles';
import { claudeArgs } from '../claude/launch';
import { PtyProcess } from '../pty/PtyProcess';
import { buildPane } from './pane';
import type { PaneRefs } from './pane';
import { readFontFamily, readPalette } from './theme';
import { EXIT_CEILING_MS, exitThenSwap, parseTerminalState } from './handoff';
import type { LaunchKind, ReturnTo, TerminalViewState } from './handoff';
import { TYPE_PROMPT_CEILING_MS, TYPE_SETTLE_MS, typeRefusal } from './typed';
import type { TypeTarget } from './typed';
import { externalLaunch, openExternalTerminal } from '../platform/external';
import { PromptModal } from './PromptModal';
import type TerminalPlugin from '../main';

export type { LaunchKind, ReturnTo, TerminalViewState } from './handoff';

const BACK_LABEL = 'Back to chat';

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
  /** The process has drawn something (its first prompt, for a shell). */
  private firstOutput = false;
  private scopePushed = false;
  private readonly holder = `terminal-${++holderCounter}`;
  private heldId: string | null = null;
  private backAction: HTMLElement | null = null;
  private swapping = false;
  /** What the in-pane notice's one button does right now. */
  private noticeAction: (() => void) | null = null;

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
      if (!this.captureActive) return undefined;
      if (passesToObsidian(evt, this.allow)) return undefined;
      return true;
    });
  }

  /* Capture is asked for in settings; whether it APPLIES also depends on
     there being a live process to give the keys to. The question is asked at
     the verdict, not when the scope is pushed, so a pane that gains a shell
     or loses one while it is focused needs no push or pop to be right. */
  private get captureActive(): boolean {
    return captureApplies(this.captureOn, this.pty);
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
    /* Parsed, never trusted: a leaf state arrives from workspace.json or from
       another plugin's setViewState, and a mistyped id must not reach argv. */
    const parsed = parseTerminalState(state);
    Object.assign(this.state, parsed.state);
    if (parsed.rejected.length) new Notice(`Terminal: ignored in the pane state: ${parsed.rejected.join('; ')}`);
    await super.setState(state, result);
    this.refreshHeader();
    this.mountBackAction();
    this.ensureLaunched();
  }

  /* Two surfaces show the title: the tab (the leaf redraws it) and the pane's
     own header (the view holds that element). Both are Obsidian internals,
     both optional-called, and a build where either is absent loses a title
     refresh and nothing else. */
  private refreshHeader(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
    const view = this as unknown as { titleEl?: HTMLElement };
    view.titleEl?.setText(this.getDisplayText());
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
    this.registerDomEvent(textarea, 'focus', () => {
      this.pushScope();
      this.plugin.noteFocused(this);
    });
    this.registerDomEvent(textarea, 'blur', () => this.popScope());
    const platform = process.platform;
    term.attachCustomKeyEventHandler((evt) => {
      if (evt.type !== 'keydown') return true;
      if (this.captureActive && passesToObsidian(evt, this.allow)) return false;
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

    if (restored && launch === 'claude') {
      /* Nothing with a runtime starts on its own after a reload. A resumed
         Claude session runs the vault's own hooks, and that is the user's
         click, not Obsidian's restore. Shells relaunch, like any terminal. */
      const id = this.state.resumeSessionId;
      this.noticeAction = () => {
        refs.notice.hide();
        this.launch(false);
      };
      refs.notice.show(
        'Restored after a reload',
        `This pane was running Claude Code in ${cwd}${id ? ` on session ${id}` : ''}. It does not start on its own; resume it when you are ready.`,
        'Resume Claude Code',
      );
      return;
    }

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

    /* The profile's variables go in BEFORE the scrub, so a profile can add to
       the environment but never put a CLAUDE* name back or replace PATH. */
    const env = buildChildEnv(
      { ...process.env, ...profile.env },
      {
        platform: process.platform,
        home: process.env.HOME ?? process.env.USERPROFILE ?? '',
        vaultPath: this.plugin.vaultPath,
        version: this.plugin.manifest.version,
        extraPath: splitPathLines(s.extraPath),
      },
    );

    if (process.platform === 'win32') {
      this.launchExternal(cwd, [command, ...args], env);
      return;
    }

    this.doFit();
    if (restored) {
      term.writeln(`${DIM}restored after a reload · scrollback is not kept, the shell starts fresh in the same folder${RESET}`);
    }
    if (typeof this.state.startedAt !== 'number') {
      /* A pane handed over by another plugin arrives without a timestamp;
         record the launch so a later restore is recognised as one. */
      this.state.startedAt = Date.now();
      this.app.workspace.requestSaveLayout();
    }
    const pty = new PtyProcess({
      python: this.plugin.pythonExecutable(),
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
    this.firstOutput = false;
    this.ptyCleanup.push(
      pty.onData((chunk) => this.onOutput(chunk)),
      pty.onExit((exit) => {
        this.releaseHeld();
        refs.exit.setBack(this.returnTarget() ? BACK_LABEL : null);
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
    this.firstOutput = true;
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
    this.noticeAction = () => {
      openExternalTerminal(launch, cwd, env).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Terminal: could not open ${launch.file}: ${message}`);
      });
    };
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
    this.registerDomEvent(refs.exit.back, 'click', () => void this.backToChat());
    this.registerDomEvent(refs.notice.action, 'click', () => this.noticeAction?.());
  }

  /* ------------------------------------------------------------- hand-off */

  /**
   * Where `Back to chat` goes. The target handed over with the state wins;
   * a Claude pane opened on a known id without one (the terminal's own
   * `Resume a Claude session by ID`) can still continue in AI Chat, so the
   * target is derived from the id. A fresh `claude` with no id yet has
   * nowhere to go: the id is only printed when the CLI exits.
   */
  returnTarget(): ReturnTo | null {
    if (this.state.launch !== 'claude') return null;
    if (this.state.returnTo) return this.state.returnTo;
    const id = this.state.resumeSessionId;
    if (!id) return null;
    return { type: CHAT_VIEW_TYPE, state: { resumeSessionId: id, provider: 'claude' } };
  }

  canContinueInChat(): boolean {
    return this.returnTarget() !== null && !this.swapping;
  }

  /** The header action while the CLI runs; the exit row carries the same button after. */
  private mountBackAction(): void {
    if (this.backAction || !this.returnTarget()) return;
    this.backAction = this.addAction('message-square', BACK_LABEL, () => void this.backToChat());
  }

  /** Is the view type registered right now, so the swap lands on a real pane and not a blank one. */
  private viewTypeKnown(type: string): boolean {
    const registry = (this.app as unknown as { viewRegistry?: { getViewCreatorByType?: (t: string) => unknown } }).viewRegistry;
    const probe = registry?.getViewCreatorByType;
    if (typeof probe !== 'function') return true;
    return !!probe.call(registry, type);
  }

  /**
   * `/exit` to the CLI, wait for it to end (10 s ceiling), then hand the SAME
   * leaf back to the view named in the state. Never swaps while the process
   * is alive: two writers on one session file fork it.
   */
  async backToChat(): Promise<void> {
    const target = this.returnTarget();
    if (!target || this.swapping) return;
    if (!this.viewTypeKnown(target.type)) {
      const what = target.type === CHAT_VIEW_TYPE ? `ICOR for Life - AI Chat (${CHAT_PLUGIN_ID}) is not enabled` : `no view of type ${target.type} is registered`;
      new Notice(`Terminal: cannot go back, ${what}.`);
      return;
    }
    this.swapping = true;
    this.backAction?.addClass('is-disabled');
    try {
      const result = await exitThenSwap(
        this.pty,
        async () => {
          this.teardownPty();
          await this.leaf.setViewState({ type: target.type, active: true, state: target.state });
        },
        {
          setTimeout: (fn, ms) => window.setTimeout(fn, ms),
          clearTimeout: (h) => window.clearTimeout(h as number),
        },
      );
      if (result === 'timeout') {
        new Notice(`Terminal: Claude did not exit within ${EXIT_CEILING_MS / 1000} s. It is still running; end it in the pane, then go back.`);
      }
    } finally {
      this.swapping = false;
      this.backAction?.removeClass('is-disabled');
    }
  }

  /* ---------------------------------------------------------- typed text */

  /** What the typing rules need to know about this pane right now. */
  typeTarget(): TypeTarget | null {
    const pty = this.pty;
    if (!pty) return null;
    return { ready: pty.ready, alive: pty.alive, launch: this.state.launch };
  }

  /**
   * Puts `text` on the shell's input line through xterm's own paste path
   * (the mode 2004 markers when the shell asked for them), never an Enter.
   * The rules in ./typed.ts decide; false is a refusal, and nothing was
   * sent. Public through the plugin: docs/handoff.md, Public API.
   */
  typeText(text: string): boolean {
    if (typeRefusal(text, this.typeTarget()) !== null) return false;
    const term = this.term;
    if (!term || !this.pty) return false;
    term.paste(text);
    return true;
  }

  /**
   * Resolves true once the shell is ready for typed text: the helper has
   * said `ready`, the process has drawn its first output (the prompt), or
   * the ceiling passed with the helper ready and the shell silent, then a
   * short settle. False when there is no process or it ended first.
   */
  async awaitPrompt(settleMs = TYPE_SETTLE_MS, ceilingMs = TYPE_PROMPT_CEILING_MS): Promise<boolean> {
    const pty = this.pty;
    if (!pty || !pty.alive) return false;
    if (!(pty.ready && this.firstOutput)) {
      const ok = await new Promise<boolean>((resolve) => {
        let done = false;
        let offReady = (): void => undefined;
        let offData = (): void => undefined;
        let offExit = (): void => undefined;
        let limit: number | null = null;
        const finish = (value: boolean): void => {
          if (done) return;
          done = true;
          offReady();
          offData();
          offExit();
          if (limit !== null) window.clearTimeout(limit);
          resolve(value);
        };
        const check = (): void => {
          if (pty.ready && this.firstOutput) finish(true);
        };
        offExit = pty.onExit(() => finish(false));
        offReady = pty.onReady(check);
        offData = pty.onData(() => {
          this.firstOutput = true;
          check();
        });
        limit = window.setTimeout(() => finish(pty.ready && pty.alive), ceilingMs);
        check();
      });
      if (!ok) return false;
    }
    await new Promise<void>((r) => window.setTimeout(r, settleMs));
    return this.pty === pty && pty.alive;
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
