/* Two render paths, one table. Obsidian 1.13 renders `getSettingDefinitions()`
 * and indexes it for settings search; older Obsidian calls `display()`. The
 * floor is 1.7.2, so both stay, both driven from definitions.ts. `display()`
 * is the fallback and nothing else, which is the case its deprecation notice
 * carves out. */

import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import process from 'node:process';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME } from '../constants';
import type TerminalPlugin from '../main';
import { formatArgs, formatEnvLines, loginShellProfile, parseArgs, parseEnvLines, profileId } from '../profiles';
import type { CwdRule, ShellProfile } from '../profiles';
import { isCustom, settingDefinitions } from './definitions';
import type { ControlSpec, DefinitionInput, GroupDefinition, ItemDefinition } from './definitions';
import type { TerminalSettings } from './model';

type Definitions = ReturnType<PluginSettingTab['getSettingDefinitions']>;
type Definition = Definitions[number];
type Group = Extract<Definition, { type: 'group' | 'list' }>;
type GroupItem = NonNullable<Group['items']>[number];

const CWD_OPTIONS: Record<CwdRule, string> = {
  vault: 'Vault root',
  'active-file': 'Folder of the active file',
  fixed: 'A fixed folder',
  home: 'Home folder',
};

export class TerminalSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TerminalPlugin) {
    super(app, plugin);
  }

  private input(): DefinitionInput {
    return { settings: this.plugin.settings, platform: process.platform, pythonResolved: this.plugin.pythonExecutable() };
  }

  /* ------------------------------------------------ 1.13: declarative */

  override getSettingDefinitions(): Definitions {
    return settingDefinitions(this.input()).map((group) => this.toGroup(group));
  }

  private toGroup(group: GroupDefinition): Group {
    return {
      type: 'group' as const,
      heading: `${group.index} · ${group.heading}`,
      cls: 'ict-settings-group',
      items: group.items.map((item) => this.toItem(item)),
    };
  }

  private toItem(item: ItemDefinition): GroupItem {
    if (isCustom(item)) {
      return {
        name: item.name,
        desc: item.desc,
        render: (setting: Setting) => {
          setting.setName(item.name).setDesc(item.desc);
          setting.settingEl.addClass('ict-settings-profiles');
          this.renderProfiles(setting.settingEl);
        },
      };
    }
    const c = item.control;
    if (c.type === 'number') {
      return {
        name: item.name,
        desc: item.desc,
        control: {
          type: 'number',
          key: c.key,
          min: c.min,
          max: c.max,
          validate: (v: number) => (Number.isFinite(v) && v >= c.min && v <= c.max ? undefined : `Between ${c.min} and ${c.max}.`),
        },
      };
    }
    return { name: item.name, desc: item.desc, control: c };
  }

  override getControlValue(key: string): unknown {
    return this.record()[key];
  }

  private record(): Record<string, unknown> {
    return this.plugin.settings as unknown as Record<string, unknown>;
  }

  /* Only strings and numbers are ever put into a text field; the profiles
     array is rendered by its own builder and never stringified. */
  private text(key: keyof TerminalSettings): string {
    const v = this.record()[key];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    Object.assign(this.plugin.settings, { [key]: value });
    await this.plugin.saveSettings();
  }

  /* ----------------------------------------- < 1.13: imperative fallback */

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('ict-settings');
    containerEl.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
    for (const group of settingDefinitions(this.input())) {
      const head = containerEl.createDiv({ cls: 'ict-settings-section' });
      head.createSpan({ cls: 'ict-settings-index', text: group.index });
      head.createSpan({ cls: 'ict-settings-name', text: group.heading });
      for (const item of group.items) this.renderItem(containerEl, item);
    }
  }

  private renderItem(parent: HTMLElement, item: ItemDefinition): void {
    const row = new Setting(parent).setName(item.name);
    if (item.desc) row.setDesc(item.desc);
    if (isCustom(item)) {
      row.settingEl.addClass('ict-settings-profiles');
      this.renderProfiles(row.settingEl);
      return;
    }
    this.bind(row, item.control);
  }

  private bind(row: Setting, c: ControlSpec): void {
    const save = async (value: unknown): Promise<void> => {
      Object.assign(this.plugin.settings, { [c.key]: value });
      await this.plugin.saveSettings();
    };
    switch (c.type) {
      case 'toggle':
        row.addToggle((t) => t.setValue(this.record()[c.key] === true).onChange((v) => void save(v)));
        return;
      case 'text':
        row.addText((t) => {
          if (c.placeholder) t.setPlaceholder(c.placeholder);
          t.setValue(this.text(c.key)).onChange((v) => void save(v));
        });
        return;
      case 'textarea':
        row.addTextArea((t) => {
          if (c.placeholder) t.setPlaceholder(c.placeholder);
          t.setValue(this.text(c.key)).onChange((v) => void save(v));
        });
        return;
      case 'dropdown':
        row.addDropdown((d) => d.addOptions(c.options).setValue(this.text(c.key)).onChange((v) => void save(v)));
        return;
      case 'number':
        row.addText((t) =>
          t.setValue(this.text(c.key)).onChange((v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= c.min && n <= c.max) void save(n);
          }),
        );
        return;
      default:
        return;
    }
  }

  /* ------------------------------------------------------------ profiles */

  private renderProfiles(host: HTMLElement): void {
    const list = host.createDiv({ cls: 'ict-profiles' });
    const redraw = (): void => {
      list.empty();
      this.plugin.settings.profiles.forEach((p, i) => this.renderProfile(list, p, i, redraw));
      const addRow = new Setting(list).setClass('ict-profile-add');
      addRow.addButton((b) =>
        b.setButtonText('Add profile').onClick(() => {
          const taken = this.plugin.settings.profiles.map((x) => x.id);
          const fresh: ShellProfile = { ...loginShellProfile(), id: profileId('profile', taken), name: 'New profile', args: [] };
          this.plugin.settings.profiles.push(fresh);
          void this.plugin.saveSettings().then(redraw);
        }),
      );
    };
    redraw();
  }

  private renderProfile(list: HTMLElement, p: ShellProfile, index: number, redraw: () => void): void {
    const card = list.createDiv({ cls: 'ict-profile' });
    const isLogin = p.id === loginShellProfile().id;
    const save = (): Promise<void> => this.plugin.saveSettings();
    const head = card.createDiv({ cls: 'ict-profile-head' });
    head.createSpan({ cls: 'ict-kicker', text: `Profile ${index + 1}` });
    const name = new Setting(card).setName('Name');
    name.addText((t) =>
      t.setValue(p.name).onChange((v) => {
        p.name = v.trim() || p.name;
        void save();
      }),
    );
    const command = new Setting(card).setName('Command').setDesc(isLogin ? 'Empty runs your login shell.' : '');
    command.addText((t) =>
      t.setPlaceholder('Your login shell').setValue(p.command).onChange((v) => {
        p.command = v.trim();
        void save();
      }),
    );
    new Setting(card).setName('Arguments').addText((t) =>
      t.setValue(formatArgs(p.args)).onChange((v) => {
        p.args = parseArgs(v);
        void save();
      }),
    );
    new Setting(card)
      .setName('Environment')
      .setDesc('One variable per line, written name=value, merged in before the Claude Code variables are removed. Stored in plain text in this plugin\'s data.json; keep secrets in your shell profile instead.')
      .addTextArea((t) =>
        t.setValue(formatEnvLines(p.env)).onChange((v) => {
          p.env = parseEnvLines(v);
          void save();
        }),
      );
    const cwd = new Setting(card).setName('Working folder');
    let fixedRow: Setting | null = null;
    cwd.addDropdown((d) =>
      d
        .addOptions(CWD_OPTIONS)
        .setValue(p.cwd)
        .onChange((v) => {
          p.cwd = v as CwdRule;
          if (fixedRow) fixedRow.settingEl.hidden = p.cwd !== 'fixed';
          void save();
        }),
    );
    fixedRow = new Setting(card).setName('Fixed folder').setDesc('Absolute, or relative to the vault. ~ is your home.');
    fixedRow.settingEl.hidden = p.cwd !== 'fixed';
    fixedRow.addText((t) =>
      t.setValue(p.fixedCwd).onChange((v) => {
        p.fixedCwd = v.trim();
        void save();
      }),
    );
    if (!isLogin) {
      new Setting(card).addButton((b) =>
        b
          .setButtonText('Remove profile')
          .setWarning()
          .onClick(() => {
            this.plugin.settings.profiles.splice(index, 1);
            void save().then(redraw);
          }),
      );
    }
  }
}

export type { TerminalSettings };
