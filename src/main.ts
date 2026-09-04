/* ICOR for Life - Terminal. A real terminal in a leaf: the login shell on a
 * pseudo-terminal, tabs and splits through Obsidian's own leaves, a ribbon
 * and file-tree launcher in the suite pattern, and a one-command Claude Code
 * launcher in the vault folder. */

import { FileSystemAdapter, Menu, Notice, Plugin, setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME, TERMINAL_ICON, VIEW_TYPE_TERMINAL } from './constants';
import { augmentPath, findOnPath, resolveInterpreter, splitPathLines } from './env';
import { HeldSessions } from './claude/held';
import { normaliseSessionId } from './claude/launch';
import { findProfile, resolveCwd } from './profiles';
import type { CwdRule } from './profiles';
import { DEFAULT_SETTINGS, normaliseSettings } from './settings/model';
import type { OpenLocation, TerminalSettings } from './settings/model';
import { TerminalSettingsTab } from './settings/SettingsTab';
import { PromptModal } from './view/PromptModal';
import { TerminalView } from './view/TerminalView';
import type { LaunchKind } from './view/TerminalView';

const TREE_LAUNCHER_CLASS = 'ict-tree-launcher';
const RIBBON_MENU_CLASS = 'ict-menu';
const RIBBON_TOOLTIP = 'Terminal';

export interface OpenOptions {
  launch?: LaunchKind;
  profile?: string;
  cwd?: string;
  cwdRule?: CwdRule;
  resumeSessionId?: string;
  where?: OpenLocation;
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export default class TerminalPlugin extends Plugin {
  override settings: TerminalSettings = DEFAULT_SETTINGS;
  readonly held = new HeldSessions();
  private readonly views: TerminalView[] = [];

  get vaultPath(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
  }

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_TERMINAL, (leaf) => new TerminalView(leaf, this));
    this.addSettingTab(new TerminalSettingsTab(this.app, this));

    this.addRibbonIcon(TERMINAL_ICON, RIBBON_TOOLTIP, (evt) => {
      const target = evt.currentTarget;
      const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
      this.openLauncherMenu(rect ? { x: rect.right, y: rect.top } : { x: evt.clientX, y: evt.clientY });
    });

    this.addCommand({ id: 'new-terminal', name: 'New terminal', callback: () => void this.openTerminal({}) });
    this.addCommand({
      id: 'new-terminal-here',
      name: 'New terminal at the folder of the active file',
      callback: () => void this.openTerminal({ cwdRule: 'active-file' }),
    });
    this.addCommand({
      id: 'new-terminal-split',
      name: 'New terminal in split',
      callback: () => void this.openTerminal({ where: 'split' }),
    });
    this.addCommand({ id: 'focus-terminal', name: 'Focus terminal', callback: () => void this.focusTerminal() });
    this.addCommand({
      id: 'run-claude',
      name: 'Run Claude Code here',
      callback: () => void this.openTerminal({ launch: 'claude' }),
    });
    this.addCommand({
      id: 'resume-claude',
      name: 'Resume a Claude session by ID',
      callback: () => void this.resumeClaude(),
    });
    this.addTerminalCommand('toggle-keyboard-capture', 'Toggle keyboard capture', (v) => v.toggleCapture());
    this.addTerminalCommand('rename-terminal', 'Rename terminal', (v) => void v.rename());
    this.addTerminalCommand('clear-terminal', 'Clear terminal', (v) => v.clear());
    this.addTerminalCommand('find-in-terminal', 'Find in terminal', (v) => v.openSearch());
    this.addTerminalCommand('restart-terminal', 'Restart the shell in this terminal', (v) => v.restart());
    this.addCommand({
      id: 'continue-in-chat',
      name: 'Continue this Claude session in AI Chat',
      checkCallback: (checking) => {
        const view = this.activeTerminal();
        if (!view?.canContinueInChat()) return false;
        if (!checking) void view.backToChat();
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => this.mountTreeLauncher());
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mountTreeLauncher()));
  }

  override onunload(): void {
    /* No orphan survives the plugin: every helper gets SIGHUP, and the kernel
       hangs up the shell behind it. The leaves stay where they are so the
       layout survives an update; a reload relaunches them. */
    for (const v of [...this.views]) v.terminate();
    for (const el of Array.from(document.querySelectorAll(`.${TREE_LAUNCHER_CLASS}`))) el.remove();
  }

  private addTerminalCommand(id: string, name: string, run: (view: TerminalView) => void): void {
    this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        const view = this.activeTerminal();
        if (!view) return false;
        if (!checking) run(view);
        return true;
      },
    });
  }

  /* ------------------------------------------------------------- settings */

  async loadSettings(): Promise<void> {
    this.settings = normaliseSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    this.settings = normaliseSettings(this.settings);
    await this.saveData(this.settings);
    for (const v of this.views) v.applySettings();
  }

  /* ----------------------------------------------------------------- views */

  trackView(view: TerminalView): void {
    if (!this.views.includes(view)) this.views.push(view);
  }

  untrackView(view: TerminalView): void {
    const i = this.views.indexOf(view);
    if (i >= 0) this.views.splice(i, 1);
  }

  activeTerminal(): TerminalView | null {
    return this.app.workspace.getActiveViewOfType(TerminalView);
  }

  /** The pane holding a Claude session id, if any. */
  viewHolding(sessionId: string): TerminalView | null {
    const id = normaliseSessionId(sessionId) ?? sessionId;
    return this.views.find((v) => v.heldSessionId === id) ?? null;
  }

  /**
   * Public, for the other side of the hand-off (docs/handoff.md): true while
   * a terminal pane of this plugin has a live `claude --resume <id>` on that
   * id. AI Chat asks before it resumes; a false here is the go-ahead.
   * `app.plugins.plugins['icor-for-life-terminal']?.holdsSession(id)`.
   */
  holdsSession(sessionId: string): boolean {
    const id = normaliseSessionId(sessionId);
    if (!id) return false;
    return this.held.holderOf(id) !== null;
  }

  private activeFileDir(): string | null {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.vaultPath) return null;
    return dirname(join(this.vaultPath, file.path));
  }

  private leafFor(where: OpenLocation): WorkspaceLeaf {
    const ws = this.app.workspace;
    if (where === 'split') return ws.getLeaf('split', 'horizontal');
    if (where === 'right') return ws.getRightLeaf(false) ?? ws.getLeaf('tab');
    return ws.getLeaf('tab');
  }

  async openTerminal(opts: OpenOptions): Promise<TerminalView | null> {
    if (!this.vaultPath) {
      new Notice('Terminal: this vault has no folder on disk.');
      return null;
    }
    if (opts.resumeSessionId) {
      const holder = this.viewHolding(opts.resumeSessionId);
      if (holder) {
        await this.app.workspace.revealLeaf(holder.leaf);
        holder.focusTerminal();
        new Notice('Terminal: that Claude session is already open in a terminal pane.');
        return holder;
      }
    }
    const profile = findProfile(this.settings.profiles, opts.profile ?? this.settings.defaultProfile);
    const cwd =
      opts.cwd ??
      resolveCwd(
        { cwd: opts.cwdRule ?? profile.cwd, fixedCwd: profile.fixedCwd },
        { vaultPath: this.vaultPath, activeFileDir: this.activeFileDir(), home: process.env.HOME ?? '' },
      ).cwd;
    const leaf = this.leafFor(opts.where ?? this.settings.openIn);
    await leaf.setViewState({
      type: VIEW_TYPE_TERMINAL,
      active: true,
      state: {
        launch: opts.launch ?? 'shell',
        profile: profile.id,
        cwd,
        resumeSessionId: opts.resumeSessionId,
        startedAt: Date.now(),
      },
    });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view instanceof TerminalView ? leaf.view : null;
    view?.focusTerminal();
    return view;
  }

  async focusTerminal(): Promise<void> {
    const active = this.activeTerminal();
    if (active) {
      active.focusTerminal();
      return;
    }
    const last = this.views[this.views.length - 1];
    if (last) {
      await this.app.workspace.revealLeaf(last.leaf);
      last.focusTerminal();
      return;
    }
    await this.openTerminal({});
  }

  async resumeClaude(): Promise<void> {
    const modal = new PromptModal(this.app, {
      title: 'Resume a Claude session',
      label: 'Session ID',
      placeholder: 'paste the id, or the whole "claude --resume" line',
      submit: 'Resume',
      validate: (v) => (normaliseSessionId(v) ? null : 'That is not a Claude session id.'),
    });
    modal.open();
    const value = await modal.result;
    if (value === null) return;
    const id = normaliseSessionId(value);
    if (!id) return;
    await this.openTerminal({ launch: 'claude', resumeSessionId: id });
  }

  /** The PATH every child gets: extras first, then the tool folders, then the host. */
  childPath(): string {
    return augmentPath(process.env.PATH, {
      platform: process.platform,
      home: process.env.HOME ?? process.env.USERPROFILE ?? '',
      vaultPath: this.vaultPath,
      version: this.manifest.version,
      extraPath: splitPathLines(this.settings.extraPath),
    });
  }

  /** The Claude Code executable: the setting, else the first on the repaired PATH, else the bare name. */
  claudeExecutable(): string {
    const explicit = this.settings.claudePath.trim();
    if (explicit) return explicit;
    return findOnPath('claude', this.childPath(), process.platform, isFile) ?? 'claude';
  }

  /** The interpreter the pty helper runs on, resolved on the child PATH so the settings page can show it. */
  pythonExecutable(): string {
    return resolveInterpreter(this.settings.pythonPath, this.childPath(), process.platform, isFile);
  }

  /* ------------------------------------------------------------ launchers */

  /* The icon-only launcher in the file explorer's tool-button row, the
   * suite's own pattern. A real <button>, so it has a tab stop and the
   * theme's focus ring can ever fire. */
  private mountTreeLauncher(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const row = leaf.view?.containerEl?.querySelector('.nav-buttons-container');
      if (!row || row.querySelector(`.${TREE_LAUNCHER_CLASS}`)) continue;
      const btn = row.createEl('button', { cls: `clickable-icon nav-action-button ${TREE_LAUNCHER_CLASS}` });
      btn.type = 'button';
      setIcon(btn, TERMINAL_ICON);
      btn.setAttr('aria-label', RIBBON_TOOLTIP);
      this.registerDomEvent(btn, 'click', () => {
        const rect = btn.getBoundingClientRect();
        this.openLauncherMenu({ x: rect.left, y: rect.bottom });
      });
    }
  }

  private openLauncherMenu(at: { x: number; y: number }): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('New terminal').setIcon(TERMINAL_ICON).onClick(() => void this.openTerminal({})));
    menu.addItem((i) =>
      i
        .setTitle('New terminal at the active file')
        .setIcon('folder')
        .onClick(() => void this.openTerminal({ cwdRule: 'active-file' })),
    );
    menu.addItem((i) =>
      i.setTitle('New terminal in split').setIcon('square-split-vertical').onClick(() => void this.openTerminal({ where: 'split' })),
    );
    for (const p of this.settings.profiles) {
      if (p.id === this.settings.defaultProfile) continue;
      menu.addItem((i) =>
        i.setTitle(`New terminal: ${p.name}`).setIcon(TERMINAL_ICON).setSection('profiles').onClick(() => void this.openTerminal({ profile: p.id })),
      );
    }
    menu.addItem((i) =>
      i.setTitle('Run Claude Code here').setIcon('bot').setSection('claude').onClick(() => void this.openTerminal({ launch: 'claude' })),
    );
    menu.addItem((i) =>
      i.setTitle('Resume a Claude session by ID').setIcon('history').setSection('claude').onClick(() => void this.resumeClaude()),
    );
    const dom = (menu as unknown as { dom?: HTMLElement }).dom;
    if (dom) {
      dom.addClass(RIBBON_MENU_CLASS);
      dom.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
    }
    menu.showAtPosition(at);
  }
}
