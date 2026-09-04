# The same-pane hand-off between ICOR for Life - Terminal and ICOR for Life - AI Chat

Stated once, here. The terminal side is implemented in this repo; the AI Chat
side conforms to this file. Public Obsidian API only: `leaf.setViewState`,
`leaf.getViewState`, `workspace.getLeavesOfType`, `app.plugins.plugins`.

## 1. The terminal view's leaf state

View type: `icor-for-life-terminal`.

```ts
{
  resumeSessionId: string | null,   // a Claude session id (UUID); null starts a fresh session
  cwd: string,                      // the working folder; the vault path for a hand-off
  launch: 'claude' | 'shell',       // what runs in the pane
  profile: string | null,           // a shell profile id; null means the default profile
  returnTo: {                       // what `Back to chat` restores; null means there is no way back
    type: string,                   // the view type to swap the leaf back to
    state: Record<string, unknown>  // the state that view is opened with
  } | null
}
```

Rules the terminal applies when it reads that state:

- `null` means unset. It is accepted for every field and never reported.
- `resumeSessionId` is validated as a UUID and lower-cased before it reaches
  argv. A value that is not a UUID is refused with a Notice and the pane does
  NOT start a fresh session in its place: a mistyped id is an error, not a
  request for a new session.
- `returnTo` needs a non-empty `type` and an object `state`; anything else is
  refused with a Notice and the pane opens with no way back.
- `launch` other than `'claude'` or `'shell'` is refused. `returnTo` only
  matters with `launch: 'claude'`; a shell pane ignores it.
- The state is persisted by Obsidian in workspace.json, so after a reload the
  pane comes back with the same id and the same way back. It does not resume
  on its own: a restored Claude pane shows a `Resume Claude Code` button and
  waits (the terminal records `startedAt` at launch to tell a restore from a
  fresh hand-off).

The pane also keeps `title` and `startedAt` in its state; they are the
terminal's own and a hand-off does not set them.

## 2. AI Chat -> Terminal: `Continue in terminal`

AI Chat, on the SAME leaf its chat view occupies:

1. interrupts and disposes its `ChatSession` (the SDK writer must be gone
   before the CLI writer starts);
2. swaps the leaf:

```ts
await leaf.setViewState({
  type: 'icor-for-life-terminal',
  active: true,
  state: {
    resumeSessionId,
    cwd: vaultPath,
    launch: 'claude',
    profile: null,
    returnTo: { type: 'icor-chat-view', state: { resumeSessionId, provider: 'claude' } },
  },
});
```

The terminal then runs `claude --resume <id>` in `cwd`, claims the id, shows a
`Back to chat` header action while the CLI runs, and shows a `Back to chat`
button in the exit row once the CLI has ended (exit code 0 or not).

If the terminal plugin is not enabled, AI Chat's button reads
`Install ICOR for Life - Terminal` instead. The check is
`app.plugins.plugins['icor-for-life-terminal']` being defined.

## 3. Terminal -> AI Chat: `Back to chat`

The terminal, on its own leaf:

1. if the CLI is still running: writes `/exit` to the pty, then Enter after a
   short settle, and waits for the process to end, with a 10 s ceiling. On
   the ceiling it does NOT swap; it tells the user the CLI is still running.
2. once the process has ended (which releases the id): swaps the leaf back
   with `leaf.setViewState({ type: returnTo.type, active: true, state: returnTo.state })`.

Never swapped while the process is alive. `returnTo.state` is passed through
verbatim; the terminal does not read or change it. For AI Chat that state is
`{ resumeSessionId, provider: 'claude' }`, which `ChatView.setState` already
accepts (0.8.0).

The same swap is available as the command
`Continue this Claude session in AI Chat` on the active terminal pane. It is
enabled when the pane has a `returnTo`, or when it is a `launch: 'claude'`
pane opened on a known id (the terminal's own `Resume a Claude session by
ID`); in the second case the target is derived as
`{ type: 'icor-chat-view', state: { resumeSessionId, provider: 'claude' } }`.
A fresh `claude` with no id yet has nowhere to go: the CLI prints the id only
when it exits.

If `returnTo.type` is not a registered view type at the time of the swap (AI
Chat disabled), the terminal refuses with a Notice and stays.

## 4. The guard both sides keep

A session id is held by exactly one view at a time. Two live writers on one
session file do not collide, they fork it silently, and the next resume
follows one branch and orphans the other.

- The terminal refuses to run `claude --resume <id>` while another terminal
  pane of this plugin holds that id (the first pane is revealed instead).
- AI Chat refuses to resume an id a terminal pane holds. Two ways to ask:

```ts
// the exact, live check: true while a terminal pane has a live claude on that id
app.plugins.plugins['icor-for-life-terminal']?.holdsSession(id) === true

// the workspace-level check any plugin can do without the terminal plugin's API:
// a terminal leaf opened on that id and still open. Conservative: it stays
// true after the CLI has exited until the pane is closed or relaunched.
app.workspace
  .getLeavesOfType('icor-for-life-terminal')
  .some((leaf) => leaf.getViewState().state?.resumeSessionId === id)
```

`holdsSession` normalises the id (any case, or a pasted `claude --resume <id>`
line) and returns `false` for anything that is not a session id. The hold
is released the moment the CLI process ends, which is why `Back to chat`
waits for the exit before it swaps: the leaf that arrives in AI Chat is
never holding the id it is asked to resume.

## 5. What the AI Chat stream implements

1. `Continue in terminal`: interrupt + dispose the session, then the
   `setViewState` in section 2 on the same leaf; the install wording when the
   terminal plugin is absent.
2. Before any resume (its own `openChat(resumeSessionId)` and the `setState`
   path): the guard in section 4; when held, reveal the terminal leaf and say
   so instead of resuming.
3. `ChatView.setState` keeps accepting `{ resumeSessionId, provider }`; that
   is the whole `returnTo.state`, and the terminal never adds to it.
