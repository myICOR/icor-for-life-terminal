/* Names that cross module boundaries. Nothing here computes. */

export const PLUGIN_ID = 'icor-for-life-terminal';
export const PLUGIN_NAME = 'ICOR for Life - Terminal';

/**
 * The declaration every root this plugin owns carries. The ICOR for Life -
 * INKLINE theme reads it and skins the subtree; every colour in styles.css
 * still rides an --ink-* token WITH a stock Obsidian fallback, so a vault on
 * another theme gets a legible terminal rather than an unstyled one.
 */
export const INK_PLUGIN_ATTR = 'data-ink-plugin';
export const INK_PLUGIN_NAME = 'icor-for-life-terminal';

/** Stored in the user's workspace.json; a key other files are written under. */
export const VIEW_TYPE_TERMINAL = 'icor-for-life-terminal';

/** The Lucide icon the ribbon, the tab and the tree launcher share. */
export const TERMINAL_ICON = 'terminal';

/** What the child sees as TERM_PROGRAM, so scripts can tell where they run. */
export const TERM_PROGRAM = 'icor-for-life-terminal';

/** Environment variable carrying the vault path into every child. */
export const VAULT_ENV = 'ICOR_VAULT';
