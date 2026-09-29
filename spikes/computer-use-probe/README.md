# computer-use-probe

Live experiments behind `research/codex-computer-use/`, and `cua-shim.mjs`, which lets Claude Code drive OpenAI's
Codex computer-use stack on macOS. Results are in `findings.md`; raw journals in `fixtures/`.

## What the shim is

`cua-shim.mjs` is a stdio MCP proxy. Claude Code talks MCP to it; it launches OpenAI's own server exactly as Codex
does (`ChatGPT.app/…/cua_node/bin/node …/@oai/cua-repl/bin/cua-repl.mjs`) and forwards everything, with five edits
that replace what Codex's host would otherwise supply (see the header comment in the file). Nothing under
`/Applications` or `~/.codex` is modified, and nothing is patched: the trust chain the native service checks is
satisfied because OpenAI's signed `node` remains `node_repl`'s parent.

Requirements on this Mac: ChatGPT.app 26.924 with computer use enabled once (so `~/.codex/computer-use/Codex Computer
Use.app` exists and holds the Accessibility and Screen Recording grants), and the `SkyComputerUseService` process
running (ChatGPT starts it).

## Using it from Claude Code

Register the shim as a stdio server. `CUA_SHIM_CODEX_HOME` is where per-session app approvals are stored; give it a
persistent path.

```sh
claude mcp add cua_repl -s user \
  -e CUA_SHIM_CODEX_HOME=$HOME/.maws/cua-home \
  -- node /Users/new/Developer/GitHub/MAWS/spikes/computer-use-probe/cua-shim.mjs
```

Then, in a session, ask for a GUI task. The first `js` call returns OpenAI's API document; the model reads it and
proceeds. Each new app raises an approval dialog ("Allow Computer Use to use "TextEdit"?"); Accept persists it for the
session. To skip the per-call permission prompt for the tool itself, allow `mcp__cua_repl__js` and
`mcp__cua_repl__js_reset` in settings. Optional cleanup hook, in settings:

```json
{"hooks":{"Stop":[{"hooks":[{"type":"mcp_tool","server":"cua_repl","tool":"turn_ended",
  "input":{"hook_event_name":"Stop","session_id":"${session_id}","turn_id":"${prompt_id}"},"timeout":30}]}]}}
```

Shim environment: `CUA_SHIM_CODEX_HOME`, `CUA_SHIM_SESSION_ID` (default: Claude Code's session id),
`CUA_SHIM_PERSIST` (`session` | `always` | `none`), `CUA_SHIM_SURFACES` (`computer` by default; `browser,computer`
also enables OpenAI's browser control, untested here), `CUA_SHIM_LOG` (JSONL journal), `CUA_SHIM_MODEL`.

Known gotchas for the model: `get_app_state` on an app handle relaunches the app if it has quit; the accessibility
tree uses the system language's role names; screenshot coordinates are in screenshot pixels, and Claude Code
downscales images above 2000 px (prefer element indices).

## Scripts

- `mcp-client.mjs`: neutral stdio MCP client used by every `w2-*`/`w3-*` scenario; journals to `fixtures/<name>.jsonl`.
- `cua-env.mjs`: the launch recipe read from the installed plugin's `.mcp.json`, re-pointed at a scratch home.
- `w2-*.mjs`, `raw-socket-ping.py`, `sock-client.mjs`, `*-launcher.mjs`, `run-under.mjs`, `sh-hop.mjs`: wave-2
  experiments on the trust gate, the MCP surface, approvals, perception and actions.
- `w3-shim-unit.mjs`: the shim under the neutral client.
- `w3-claude-code-host.mjs`, `w3-claude-code-host-2.mjs`: Claude Code 2.1.283 headless (`spikes/protocol-probe`
  harness) hosting the shim on two TextEdit tasks.

Every scenario that acts on the GUI confines itself to a throwaway TextEdit document it creates in `/tmp`.
