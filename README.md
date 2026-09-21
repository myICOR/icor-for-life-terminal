# ICOR for Life - Terminal

**A real terminal, in the pane next to your notes.**

Your login shell in a tab or a split, and a one-command start for Claude Code
already pointed at your vault.

Part of the [ICOR for Life](https://myicor.com) suite.

## Read this before installing

**A terminal is the largest capability a plugin can have.** Nothing here
should surprise you later, so it is stated first rather than buried:

- **It runs programs on your machine**, as you, with your permissions. Your
  login shell by default, or a command you set up, or `claude`.
- **It reaches files outside your vault**, because a shell does. Whatever you
  can open, it can open.
- **It makes no network connection of its own.** No telemetry, no update
  check. Whatever you run inside the shell is yours.
- **It touches the clipboard only when you press the key.** Copy and paste
  work as you expect. One optional setting, off by default, copies a
  selection as you make it.

If any of that is more than you want in your vault, do not install it. That
is a reasonable decision and the plugin will not try to talk you out of it.

## What it is for

Work that lives in the vault often needs a command run against the vault: a
script, a git status, an AI session in the right folder. Switching to a
separate terminal app means finding the right window and typing the right
`cd`, every time.

Here the terminal is a pane like any other. It sits in Obsidian's tabs and
splits, you rename it from its tab, and it comes back in the same folder
after a reload.

## Getting started

Open a terminal from the command palette. It starts in your vault folder.

The **Claude Code launcher** starts a session already in the right place, so
you never start one against the wrong folder.

## Good to know

- **Desktop only**, macOS and Linux. There is no terminal pane on Windows in
  this version.
- **The command palette still works** while the terminal has your keyboard,
  so you are never trapped in the pane.
- **The shell belongs to Obsidian's window.** Reloading, updating or quitting
  Obsidian ends it, the way closing a terminal window ends the shell inside
  it. Closing the lid does not, on its own; what you usually see after a
  sleep is Obsidian reloading on wake. The pane comes back and starts a fresh
  shell in the same folder, without the earlier output. For a job that has to
  survive that, start `tmux` or `screen` in the pane and run it there.
- **INKLINE skins it**, and it stays legible on any other theme.
- **Beta.** It runs in a real vault every day and it has rough edges. If
  something looks off, open an issue.

## Support

What myICOR supports: the plugin as published in a tagged release, on the
current version, installed from that release. Bugs go to this repo's issues,
security reports to the process in `SECURITY.md`.

What the community maintains: anything marked community-maintained, including
community source adapters. We review it before it is merged. We do not support
it, we cannot promise it keeps working, and it can be disabled or removed in
any release.

What is yours: your own changes, your fork, your local patch. Please reproduce
the problem on a clean install of the current release before reporting it.

## Licence

MIT, see `LICENSE`. Install it, run it, read it, change it, sell it, ship it in
your own product; keep the copyright and licence notice.
Releases before 0.2.0 stay under the ICOR for Life
Source-Available License (Code) v1.0 they were published with.

The licence covers the code only. "ICOR", "ICOR for Life", "myICOR" and
"Paperless Movement" are trademarks of Paperless Movement, S.L.; a fork needs
its own plugin id and name. See `TRADEMARK.md`.

Contributions are welcome as pull requests under the same MIT terms, with a
DCO sign-off on every commit. See `CONTRIBUTING.md`.

Bundled third-party components keep their own licences; see
`THIRD-PARTY-NOTICES.md`.
