# cua — native macOS computer use for Claude Code

Lets Claude Code read and operate macOS apps (accessibility tree, screenshots, clicks, typing, menus) by hosting
OpenAI's Codex computer-use stack, which ships inside ChatGPT.app. `cua-shim.mjs` is a stdio MCP proxy: Claude Code
talks to it, and it launches ChatGPT.app's own `cua_repl` server exactly as Codex does. Nothing in ChatGPT.app or
`~/.codex` is modified. The study behind it is in `research/codex-computer-use/`.

## Requirements

- macOS, ChatGPT.app 26.917 or newer, with Computer Use enabled once in its settings (that installs
  `~/.codex/computer-use/Codex Computer Use.app` and grants it Accessibility and Screen Recording).
- ChatGPT running, so its computer-use service is up. If it is not, the first call starts the service through
  LaunchServices and takes a few seconds longer.
- `node` on `PATH` (any recent version; the shim itself has no dependencies).

## Install

```sh
claude plugin marketplace add SSFSKIM/cua
claude plugin install cua@cua
```

(Inside a MAWS checkout, the repo root is also a local marketplace: `claude plugin marketplace add <path to MAWS>`
then `claude plugin install cua@maws`. The plugin's source of truth is `plugins/cua` in MAWS, published to
`github.com/SSFSKIM/cua` with `git subtree push --prefix plugins/cua`.)

Then allow the tools in your settings so each call does not prompt: `"mcp__plugin_cua_cua_repl__*"` under
`permissions.allow`. App approvals are a separate dialog; see the next section.

## App approvals

Apart from Claude Code's tool permission, OpenAI's stack asks before an app is first used, `Allow Computer Use to use
"X"?`, as an MCP elicitation that Claude Code shows as a dialog. Where an accepted answer is remembered depends on
`CUA_SHIM_PERSIST`:

- `session` (the default) writes `$CUA_SHIM_CODEX_HOME/computer-use/sessions/<session id>.toml`, so every new Claude
  Code session asks once more per app.
- `always` adds the app to the machine-wide list Codex Desktop's own "Always allow" uses,
  `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`;
  an app on that list is never asked about again from any session or host. One more accept per app, then silence.

To never see the dialog, answer it from an `Elicitation` hook: Claude Code runs the hook before showing the dialog and
takes its answer as the user's.

`~/.claude/hooks/cua-approve.sh`:

```sh
#!/usr/bin/env bash
exec jq -c 'if (.message // "" | startswith("Allow Computer Use to use ")) then {hookSpecificOutput:{hookEventName:"Elicitation",action:"accept",content:{}}} else empty end'
```

`~/.claude/settings.json`:

```json
"hooks": {
  "Elicitation": [
    {
      "matcher": "cua_repl|plugin:cua:cua_repl",
      "hooks": [{ "type": "command", "command": "bash $HOME/.claude/hooks/cua-approve.sh", "timeout": 10 }]
    }
  ]
}
```

The `startswith` test limits the hook to app approvals; anything else the server asks (audio recording) still shows
the dialog. To silence only some apps, match their names instead, for example `test("\"(Notes|TextEdit)\"")`. Be
clear about what the hook removes: the model can then bind any app OpenAI's policy allows, and binding hands it that
app's whole front window (see Use).

## Use

Ask for the task in plain words: "open Notes and read my latest note", "in Preview, rotate this image and save".
The first call returns OpenAI's API document to the model, which then writes small JavaScript cells against the `cua`
API. The shim adds host notes to the server instructions covering what that document leaves out (one approval per
app, index-first addressing, dropping an app handle after quitting it, `typeText` and emoji, and so on).

Be aware that binding an app hands the model that app's whole front window as text, chat lists and inboxes included.
For a messaging app, open the room you mean before asking.

## Verify after a ChatGPT.app update

```sh
node plugins/cua/verify.mjs
```

It spawns the shim, completes the MCP handshake and lists the tools without touching any app. A non-zero exit names
what changed. The end-to-end checks live in `spikes/computer-use-probe/` (`w3-shim-unit.mjs` drives a throwaway
TextEdit document).

## Configuration (environment of the server)

| variable | default | meaning |
|---|---|---|
| `CUA_SHIM_CODEX_HOME` | `${CLAUDE_PLUGIN_DATA}/codex-home` | where session approvals and config are stored |
| `CUA_SHIM_SESSION_ID` | Claude Code's session id | key for "allow this session" approvals |
| `CUA_SHIM_PERSIST` | `session` | `session`, `always` or `none`: how an accepted approval is remembered |
| `CUA_SHIM_SURFACES` | `computer` | `browser,computer` adds OpenAI's browser API, but under this shim it lists no browsers: it needs a Codex login in `CODEX_HOME`, and the in-app browser (`iab`) only serves ChatGPT's own Codex threads |
| `CUA_SHIM_HOST_NOTES` | built in | replacement host notes; `none` disables them |
| `CUA_SHIM_LOG` | unset | JSONL journal of every frame, for debugging |
| `CUA_SHIM_PLUGIN_MCP` | newest under `~/.codex/plugins/cache/openai-bundled/unified-computer-use/` | OpenAI's launch recipe to copy |

## For MAWS

MAWS does not load this as a plugin. It bundles `cua-shim.mjs` as an app resource and writes the same server entry
into the `--mcp-config` it passes to Claude Code, so the agent's computer use does not depend on what is installed in
the user's `~/.claude`.
