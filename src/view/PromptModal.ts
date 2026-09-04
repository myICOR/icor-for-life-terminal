/* One text field, one answer. Used for renaming a pane and for pasting a
 * Claude session id. Obsidian's own Modal chrome, deliberately: the dialog
 * carries the plugin's INKLINE declaration so a theme can skin it, and no
 * treatment of its own. */

import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { INK_PLUGIN_ATTR, INK_PLUGIN_NAME } from '../constants';

export interface PromptSpec {
  title: string;
  label: string;
  placeholder?: string;
  initial?: string;
  submit: string;
  /** Return a message to refuse the value, or null to accept. */
  validate?: (value: string) => string | null;
}

export class PromptModal extends Modal {
  private value: string;
  private resolved = false;
  private readonly resolve: (value: string | null) => void;
  readonly result: Promise<string | null>;

  constructor(app: App, private readonly spec: PromptSpec) {
    super(app);
    this.value = spec.initial ?? '';
    let resolve: (value: string | null) => void = () => undefined;
    this.result = new Promise<string | null>((r) => {
      resolve = r;
    });
    this.resolve = resolve;
  }

  override onOpen(): void {
    this.modalEl.addClass('ict-modal');
    this.modalEl.setAttr(INK_PLUGIN_ATTR, INK_PLUGIN_NAME);
    this.titleEl.setText(this.spec.title);
    const error = this.contentEl.createDiv({ cls: 'ict-modal-error' });
    error.hidden = true;
    const commit = (): void => {
      const message = this.spec.validate ? this.spec.validate(this.value) : null;
      if (message) {
        error.setText(message);
        error.hidden = false;
        return;
      }
      this.resolved = true;
      this.resolve(this.value);
      this.close();
    };
    new Setting(this.contentEl).setName(this.spec.label).addText((t) => {
      t.setValue(this.value);
      if (this.spec.placeholder) t.setPlaceholder(this.spec.placeholder);
      t.inputEl.setAttr('aria-label', this.spec.label);
      t.onChange((v) => {
        this.value = v;
        error.hidden = true;
      });
      t.inputEl.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          commit();
        }
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(this.spec.submit).setCta().onClick(commit));
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolve(null);
  }
}
