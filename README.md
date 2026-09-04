# ICOR for Life - Terminal

A real terminal inside your vault. Your login shell in a tab or a split,
keyboard capture that still lets Obsidian keep its palette, and a
one-command launcher for Claude Code in the vault folder.

The terminal is a pane like any other: it lives in Obsidian's own tabs and
splits, it is renamed from its tab, it comes back after a reload in the
same folder, and it is skinned by the ICOR for Life - INKLINE theme while
staying legible on any other theme.

**Beta release, desktop only.** It runs in a real vault every day and it
has rough edges. If something looks off, open an issue.

## What this plugin does on your machine, stated plainly

Read this before installing. A terminal is the largest capability a plugin
can have, and the point of this section is that nothing below surprises you
later.

- **It runs local processes.** Every terminal pane starts a process: your
  login shell by default (`$SHELL -l`), a command you configured as a
  profile, or `claude`. The process runs as you, with your permissions. The
  plugin spawns it through a small Python helper (shipped inside `main.js`
  as readable source, `src/pty/helper.py` in this repository) that gives
  the process a real pseudo-terminal, because Node has no pseudo-terminal
  without a native module and a native module cannot ship through the
  Obsidian directory.
- **It accesses files outside the vault.** A shell reads and writes whatever
  you can. The plugin itself also looks for the `claude` executable on your
  PATH and uses your vault's folder on disk as the working directory.
- **It makes no network connection of its own.** No telemetry, no update
  check, no fetch. What you run inside the shell is yours.
- **It scrubs one family of environment variables.** Every variable whose
  name starts with `CLAUDE` is removed from what the shell inherits, because
  a Claude Code CLI that inherits `CLAUDE_CODE_CHILD_SESSION` stops saving
  its transcript. Everything else passes through, plus `TERM`, `COLORTERM`,
  `TERM_PROGRAM`, `ICOR_VAULT` (your vault path) and a repaired `PATH`.
- **Windows scope.** There is no integrated terminal pane on Windows in this
  version. The pane says so and offers one button that opens your own
  terminal (Windows Terminal by default) in the same folder. Windows needs
  a pseudo-terminal component the plugin cannot ship; see "Deferred" below.

`SECURITY.md` is the long form, with the file to read for every claim.

## Prerequisites

- **macOS or Linux** for the integrated pane. macOS needs a `python3`: the
  one from the Xcode Command Line Tools (`xcode-select --install`) or
  Homebrew's; Linux nearly always has one. A bare name in the Python setting
  is looked up on the repaired PATH (developer tool folders first, so a
  Homebrew `python3` wins when both are installed) and the setting shows
  which one is in use; an absolute path is used as is. The helper runs in
  Python's isolated mode (`-I`), so nothing in a vault folder can be
  imported by it.
- **Claude Code** installed, for the launcher. Everything else works
  without it.

## Against VS Code's integrated terminal

VS Code's integrated terminal is the bar. This is where this plugin stands
against it, measured on this codebase rather than promised.

**Matches**

- A real pseudo-terminal: full-screen programs, colours, resize reflow,
  `Esc` and `Ctrl+C` reaching the program. Claude Code's interface runs in
  it unmodified.
- xterm.js as the emulator, the same one VS Code uses, with the WebGL
  renderer where the graphics stack allows it and the DOM renderer as the
  fallback.
- Tabs and splits, rename, restore on reload in the same folder, a find
  bar with match counts, clickable links, Unicode 11 widths, bracketed
  paste, copy on select as an option, a bell that flashes and never sounds.
- Shell profiles with their own command, arguments, environment and
  working-folder rule.
- Keyboard capture with an allow-list of keys that stay with the editor,
  and a command to release capture per pane.
- Flow control on output: a flood is queued through xterm's write callback
  and never blocks the interface.
- Environment repair: a developer's tool folders in front of PATH, so
  `claude`, `node` and friends are found from a GUI-launched app.

**Beats**

- It lives next to your notes, in the same window, in the same theme, and
  every colour rides a design token: the INKLINE theme skins it, and a stock
  Obsidian theme gets the same layout with stock colours.
- The Claude Code launcher: one command starts `claude` in the vault
  folder, one resumes a session by id, and a session id can be open in at
  most one pane, because two writers on one session file fork it silently.
- No toolbar, no bespoke tab bar, no status strip: the tab is the
  wayfinding and the pane is the terminal.
- One honest failure surface: when the shell ends, one quiet row says what
  happened (exit code or signal, and stderr when it never started), with a
  Restart button and nothing else.

**Does not match yet** (see "Deferred")

- Scrollback across a reload. VS Code restores it; this plugin relaunches
  the shell in the same folder and says so on the first line.
- An integrated pane on Windows.
- Shell integration decorations (command markers, per-command navigation).
- Process-name tab titles. Tabs show the shell and the folder, or the name
  you gave them.

## Commands

All under "ICOR for Life - Terminal" in the command palette.

| Command | What it does |
| --- | --- |
| New terminal | The default profile, at the profile's working folder (vault root by default) |
| New terminal at the folder of the active file | Same, in the folder of the note you have open |
| New terminal in split | Same, in a split below the active pane |
| Focus terminal | Focuses the active or most recent terminal; opens one if there is none |
| Run Claude Code here | `claude` in the vault folder |
| Resume a Claude session by ID | Asks for an id (or a pasted `claude --resume` line) and runs `claude --resume <id>` |
| Toggle keyboard capture | Releases every key to Obsidian for this pane, or captures again |
| Rename terminal | Sets the tab title; also in the tab's menu |
| Clear terminal | Same as Cmd+K in the pane |
| Find in terminal | Opens the find bar; same as Cmd+F in the pane |
| Restart the shell in this terminal | Ends the process and starts the profile again |
| Continue this Claude session in AI Chat | Asks the CLI to exit, waits for it, then turns this pane into an ICOR for Life - AI Chat pane on the same session |

The terminal icon in the ribbon and in the file explorer's button row opens
a menu with the same launchers and one entry per extra profile.

## Keys

While a terminal pane is focused, every key goes to the shell, with an
allow-list that stays with Obsidian:

- **macOS:** `Cmd+P`, `Cmd+W`, `Cmd+Shift+[`, `Cmd+Shift+]`, `Cmd+,`.
- **Linux and Windows:** `Ctrl+Shift+[`, `Ctrl+Shift+]`. `Ctrl+P` and
  `Ctrl+W` are shell keys there (history and delete-word), so they are not
  taken from the shell; add them in settings if you prefer the editor's
  meaning.

Add more in settings, one per line, in Obsidian's notation (`Mod+Shift+F`).
The plugin's own keys inside the pane: `Cmd+K` clears, `Cmd+F` finds
(`Ctrl+Shift+K` and `Ctrl+Shift+F` on Linux and Windows). `Esc` always
reaches the program. `Cmd+C` copies a selection and `Cmd+V` pastes, with
bracketed paste when the program asks for it.

## Settings

Appearance (font size, font family, line height, cursor, renderer, bell),
behaviour (scrollback lines, copy on select, where new terminals open),
keyboard (capture on or off by default, keys that stay with Obsidian),
shell profiles (default profile, and each profile's name, command,
arguments, environment and working-folder rule), programs (the Python
interpreter, the Claude Code executable, extra PATH folders) and the
Windows launcher command.

Scrollback defaults to 10000 lines. The font family is empty by default,
which means the theme's monospace font through the `--ink-font-mono` token,
with the stock `--font-monospace` as the fallback.

## The Claude Code launcher and the one rule it enforces

`Run Claude Code here` starts `claude` in the vault folder with the repaired
PATH and the scrubbed environment. `Resume a Claude session by ID` runs
`claude --resume <id>`.

A session id is held by the pane that runs it. A second pane asking to
resume the same id is refused and the first pane is revealed instead. This
is not fussiness: two live processes writing one Claude session file do not
collide, they fork it silently, and the next resume follows one branch and
loses the other. One pane per session is the only safe shape.

The pane state is `{ resumeSessionId, cwd, launch, profile, returnTo }`.
Another plugin can hand a session over by setting that state on a leaf
(`leaf.setViewState({ type: 'icor-for-life-terminal', state: { launch: 'claude', resumeSessionId, cwd, returnTo } })`).
With a `returnTo`, the pane shows `Back to chat` in its header while the CLI
runs and in the exit row after it ends; the button asks the CLI to exit
(`/exit`), waits for it (10 s ceiling), then hands the same leaf back with
`returnTo`. Never while the process is alive. The plugin exposes
`holdsSession(id)` for the other side's check. The whole contract, stated
once: [docs/handoff.md](docs/handoff.md).

## Restore on reload

Obsidian remembers every terminal pane. After a reload a shell pane comes
back and the shell is started again in the same folder, with the same
profile. A Claude pane comes back with a `Resume Claude Code` button and
waits for it: a resumed session runs your vault's hooks, and that should be
your click, not Obsidian's restore. Scrollback is not restorable: the
process that produced it is gone, and the first line of the restored pane
says so.

## Deferred, with reasons

- **Windows integrated pane.** Needs ConPTY, which needs a native binding or
  a Python package (`pywinpty`) that does not ship with Python. The honest
  v1 is the external launcher. A later version can add the pane behind a
  declared prerequisite.
- **Scrollback restore.** Would need the plugin to persist output to disk on
  every write; not in scope for 0.1.
- **Shell integration.** Command markers and per-command navigation need a
  shell-side script per shell.
- **Process-name titles.** Needs polling the pseudo-terminal's foreground
  process; deferred until it can be done without a timer per pane.

## Development

```
npm install
npm run gate
```

The gate is typecheck, build, lint (the same `eslint-plugin-obsidianmd`
rules the directory runs, plus the CSS scanner), the pure test suite, a
headless-Chrome gate that mounts the shipped pane builders and a real xterm
on the shipped stylesheet in a stock light and a stock dark room and
measures contrast, and a smoke script that spawns the Python helper with
the login shell outside Obsidian, asserts `READY` arrives, resizes on fd 3,
reads the new size back from `stty size`, and sees the exit code through.

`styles.css` is assembled by the build from xterm's own stylesheet and
`src/terminal.css`; edit the source, never the assembled file.

## Licence

Source-available under the ICOR for Life Source-Available License (Code),
Version 1.0; see `LICENSE`. Third-party components are MIT; see
`THIRD-PARTY-NOTICES.md`.
