# Security Policy

ICOR for Life - Terminal is a terminal. It starts your login shell, or any
command you configure, as a real process on the machine Obsidian is running
on, with your user's permissions, in a folder of your choosing. Everything
you can do in Terminal.app or Windows Terminal you can do here, and so can
anything you run inside it. There is no sandbox, and we are not going to
describe it as anything smaller than that.

If you find a way to make this plugin do something its user did not ask for,
we want to hear about it before anyone else does.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.**

Two channels, in order of preference:

1. **GitHub private security advisory** (preferred). Open a draft advisory on
   the Security tab of this repository. It stays private between you and the
   maintainer until a fix ships.
2. **Email** `team@myicor.com` with `SECURITY` and `icor-for-life-terminal` in
   the subject line. This is a monitored mailbox. If you want to encrypt the
   report, say so in a first message and we will arrange a key.

A useful report contains the plugin version (`manifest.json`), your Obsidian
version and operating system, what an attacker can do and what they need in
order to do it, and steps to reproduce against a throwaway vault. Never send
a real credential or a real shell history; describe it instead.

## What to expect

| Stage | Target |
| --- | --- |
| We acknowledge your report | within 5 business days |
| We tell you whether we agree it is a vulnerability, and how severe | within 10 business days |
| We ship a fix for a confirmed critical or high issue | we aim for 30 days |
| We ask you to hold public disclosure until | a fix ships, or 90 days from your report, whichever comes first |

Only the most recent release is supported. One branch, no backports.

## Scope: exactly what this plugin does on your machine

The source is in this repository; every claim below names the file to read.

**It spawns processes.** `src/pty/PtyProcess.ts` calls Node's
`child_process.spawn` with the configured Python interpreter
(`python3` by default), the helper source as a `-c` argument, the terminal
size, and the command to run. No shell is involved in that spawn: the
arguments are passed as an array, never interpolated into a command line.
The command is your login shell (`$SHELL -l`) unless you configured a
profile, or `claude` / `claude --resume <id>` from the Claude launcher.

**The helper is one Python file you can read top to bottom.** `src/pty/helper.py`
forks the command onto a pseudo-terminal and copies bytes: stdin to the
pty, the pty to stdout, resize frames from fd 3 to `ioctl(TIOCSWINSZ)`.
It imports only the standard library, opens no socket, reads no file, and
never touches the environment. It is shipped inside `main.js` as a string
because a directory release can carry only `main.js`, `manifest.json` and
`styles.css`; `test/frames.test.mjs` asserts the string in the bundle
contains no `environ` access.

**It reads files outside the vault.** A shell reads whatever the user can
read. The plugin itself also probes for the `claude` executable on PATH
(`src/main.ts`, `claudeExecutable`) and resolves the vault's folder on
disk to use as the working directory. Nothing else is read by the plugin
code; everything else is the shell, under your control.

**It hands the child an environment.** `src/env.ts` copies the process
environment, repairs PATH (developer tool folders in front, plus the folders
you list in settings), sets `TERM`, `COLORTERM`, `TERM_PROGRAM`,
`TERM_PROGRAM_VERSION`, `LANG` (only when the host has none) and
`ICOR_VAULT`, and **removes every variable whose name starts with `CLAUDE`**.
The removal is deliberate: a Claude Code CLI that inherits
`CLAUDE_CODE_CHILD_SESSION` silently stops saving transcripts. Profile
environment entries you configure are added on top.

**It captures the keyboard while a pane is focused.** `src/view/TerminalView.ts`
pushes an Obsidian keymap `Scope` on focus and pops it on blur, so keys
reach the shell instead of Obsidian's hotkeys. The allow-list of keys that
stay with Obsidian is in `src/keymap.ts` and in settings. The scope is
popped when the pane closes or the plugin unloads.

**It kills what it started.** Closing a pane, restarting a shell, and
unloading the plugin send `SIGHUP` to the helper, which closes the
pseudo-terminal; the kernel hangs up the shell behind it. No child of this
plugin outlives it on purpose.

**It makes no network connection of its own.** There is no telemetry, no
update check, no fetch. `main.js` contains no `fetch`, `XMLHttpRequest`,
`WebSocket` or `net`/`http` import from plugin code (xterm's bundled source
has none either). What you run inside the shell is another matter, and it is
yours.

**Windows.** No process is spawned onto a pseudo-terminal on Windows. The
pane offers one button that runs the configured external launcher
(`wt.exe -d "{cwd}" {command}` by default) through `child_process.spawn`
with `detached: true`; see `src/platform/external.ts`.

**Claude session guard.** Two live processes writing one Claude session
file fork it silently. `src/claude/held.ts` keeps a session id in at most
one pane; a second `claude --resume` on a held id is refused before it
spawns. This is a data-integrity guard, not a security boundary.

## What a review should look at

1. That `spawn` is never given `shell: true` and never a string built from
   user input. (`grep -n "shell:" src` finds nothing.)
2. That the helper string in `main.js` is byte-identical to
   `src/pty/helper.py` (`npm run build` regenerates it from the file).
3. That every `CLAUDE*` variable is scrubbed (`test/env.test.mjs`).
4. That `onunload` reaches every child (`src/main.ts`, `onunload`, and
   `TerminalView.terminate`).
5. That the keymap scope is popped on blur and close.
6. That the plugin's own code makes no network call. `main.js` is minified;
   review `src/` and rebuild with `npm run build` to compare.

## Obsidian's own guidance

This plugin declares `isDesktopOnly: true`. The Obsidian developer policies
require disclosure of network use and of access to files outside the vault;
the README carries both, and this document is the long form.
