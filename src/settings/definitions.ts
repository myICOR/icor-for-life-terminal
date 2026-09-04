/* The settings table. One source drives both render paths (the 1.13
 * declarative API and the imperative fallback), so they cannot disagree. Pure. */

import { defaultAllowList } from '../keymap';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, SCROLLBACK_MAX, SCROLLBACK_MIN } from './model';
import type { TerminalSettings } from './model';

export type ControlSpec =
  | { type: 'toggle'; key: keyof TerminalSettings }
  | { type: 'text'; key: keyof TerminalSettings; placeholder?: string }
  | { type: 'textarea'; key: keyof TerminalSettings; placeholder?: string; rows?: number }
  | { type: 'number'; key: keyof TerminalSettings; min: number; max: number }
  | { type: 'dropdown'; key: keyof TerminalSettings; options: Record<string, string> };

export interface ControlItem {
  name: string;
  desc: string;
  control: ControlSpec;
}

export interface CustomItem {
  name: string;
  desc: string;
  custom: 'profiles';
}

export type ItemDefinition = ControlItem | CustomItem;

export interface GroupDefinition {
  index: string;
  heading: string;
  items: ItemDefinition[];
}

export function isCustom(item: ItemDefinition): item is CustomItem {
  return 'custom' in item;
}

export interface DefinitionInput {
  settings: TerminalSettings;
  platform: string;
}

export function settingDefinitions(input: DefinitionInput): GroupDefinition[] {
  const profiles: Record<string, string> = {};
  for (const p of input.settings.profiles) profiles[p.id] = p.name;
  const defaults = defaultAllowList(input.platform).join(', ');
  return [
    {
      index: '01',
      heading: 'Appearance',
      items: [
        {
          name: 'Font size',
          desc: `In pixels, ${FONT_SIZE_MIN} to ${FONT_SIZE_MAX}.`,
          control: { type: 'number', key: 'fontSize', min: FONT_SIZE_MIN, max: FONT_SIZE_MAX },
        },
        {
          name: 'Font family',
          desc: 'Leave empty to use the theme’s monospace font.',
          control: { type: 'text', key: 'fontFamily', placeholder: 'theme mono font' },
        },
        {
          name: 'Line height',
          desc: 'A multiple of the font size, 1 to 2.',
          control: { type: 'number', key: 'lineHeight', min: 1, max: 2 },
        },
        {
          name: 'Cursor style',
          desc: '',
          control: { type: 'dropdown', key: 'cursorStyle', options: { block: 'Block', underline: 'Underline', bar: 'Bar' } },
        },
        { name: 'Cursor blink', desc: '', control: { type: 'toggle', key: 'cursorBlink' } },
        {
          name: 'Renderer',
          desc: 'WebGL draws faster where the graphics stack allows it; the DOM renderer is the fallback and can be forced here.',
          control: { type: 'dropdown', key: 'renderer', options: { auto: 'WebGL where available', dom: 'DOM' } },
        },
        {
          name: 'Bell',
          desc: 'A quiet flash of the pane on the terminal bell. Never a sound.',
          control: { type: 'toggle', key: 'bellFlash' },
        },
      ],
    },
    {
      index: '02',
      heading: 'Behaviour',
      items: [
        {
          name: 'Scrollback lines',
          desc: `Lines kept above the visible screen, ${SCROLLBACK_MIN} to ${SCROLLBACK_MAX}. Not kept across a reload.`,
          control: { type: 'number', key: 'scrollback', min: SCROLLBACK_MIN, max: SCROLLBACK_MAX },
        },
        {
          name: 'Copy on select',
          desc: 'Selecting text copies it, the way most terminals do.',
          control: { type: 'toggle', key: 'copyOnSelect' },
        },
        {
          name: 'Open new terminals',
          desc: '',
          control: {
            type: 'dropdown',
            key: 'openIn',
            options: { tab: 'In a new tab', split: 'In a split below the active pane', right: 'In the right sidebar' },
          },
        },
      ],
    },
    {
      index: '03',
      heading: 'Keyboard',
      items: [
        {
          name: 'Capture the keyboard',
          desc: 'While a terminal is focused every key goes to the shell, except the ones below. The toggle command releases it per pane.',
          control: { type: 'toggle', key: 'captureKeys' },
        },
        {
          name: 'Keys that stay with Obsidian',
          desc: `Always kept on this platform: ${defaults}. Add more here, one per line, in Obsidian’s notation (Mod+Shift+F).`,
          control: { type: 'textarea', key: 'passthroughKeys', placeholder: 'Mod+Shift+F', rows: 3 },
        },
      ],
    },
    {
      index: '04',
      heading: 'Shell profiles',
      items: [
        {
          name: 'Default profile',
          desc: 'What a new terminal runs.',
          control: { type: 'dropdown', key: 'defaultProfile', options: profiles },
        },
        {
          name: 'Profiles',
          desc: 'Each profile is a command with arguments, extra environment and a working-folder rule. The login shell profile runs your $SHELL with -l.',
          custom: 'profiles',
        },
      ],
    },
    {
      index: '05',
      heading: 'Programs',
      items: [
        {
          name: 'Python',
          desc: 'The pty helper runs on Python 3. On macOS the system python3 needs the Xcode Command Line Tools.',
          control: { type: 'text', key: 'pythonPath', placeholder: 'python3' },
        },
        {
          name: 'Claude Code',
          desc: 'Leave empty to find claude on the repaired PATH.',
          control: { type: 'text', key: 'claudePath', placeholder: '/Users/you/.local/bin/claude' },
        },
        {
          name: 'Extra PATH folders',
          desc: 'Put in front of PATH for every terminal and for the Claude launcher, one per line.',
          control: { type: 'textarea', key: 'extraPath', placeholder: '/opt/homebrew/bin', rows: 3 },
        },
      ],
    },
    {
      index: '06',
      heading: 'Windows',
      items: [
        {
          name: 'External terminal command',
          desc: 'Windows has no integrated pane in this version. This command opens your own terminal; {cwd} and {command} are substituted.',
          control: { type: 'text', key: 'windowsLauncher', placeholder: 'wt.exe -d "{cwd}" {command}' },
        },
      ],
    },
  ];
}

/** The keys the table persists, for the coverage gate. */
export function controlKeys(input: DefinitionInput): (keyof TerminalSettings)[] {
  const out: (keyof TerminalSettings)[] = [];
  for (const g of settingDefinitions(input)) {
    for (const i of g.items) if (!isCustom(i)) out.push(i.control.key);
  }
  return out;
}
