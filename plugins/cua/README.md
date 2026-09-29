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
`permissions.allow`. App approvals ("Allow Computer Use to use X?") are separate and still appear once per app per
session; accepted approvals are stored under the plugin's data directory.

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
| `CUA_SHIM_SURFACES` | `computer` | `browser,computer` also enables OpenAI's browser control (untested) |
| `CUA_SHIM_HOST_NOTES` | built in | replacement host notes; `none` disables them |
| `CUA_SHIM_LOG` | unset | JSONL journal of every frame, for debugging |
| `CUA_SHIM_PLUGIN_MCP` | newest under `~/.codex/plugins/cache/openai-bundled/unified-computer-use/` | OpenAI's launch recipe to copy |

## For MAWS

MAWS does not load this as a plugin. It bundles `cua-shim.mjs` as an app resource and writes the same server entry
into the `--mcp-config` it passes to Claude Code, so the agent's computer use does not depend on what is installed in
the user's `~/.claude`.
