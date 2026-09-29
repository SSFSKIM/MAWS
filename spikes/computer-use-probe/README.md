# computer-use-probe

Live experiments behind `research/codex-computer-use/` and behind the `cua` plugin (`plugins/cua/`), which lets
Claude Code drive OpenAI's Codex computer-use stack on macOS. Results are in `findings.md`; raw journals in `fixtures/`.

## The shim

`cua-shim.mjs` now lives in `plugins/cua/` as the `cua` Claude Code plugin; see `plugins/cua/README.md` for
installation and use. The scripts here reference it there.

## Scripts

- `mcp-client.mjs`: neutral stdio MCP client used by every `w2-*`/`w3-*` scenario; journals to `fixtures/<name>.jsonl`.
- `cua-env.mjs`: the launch recipe read from the installed plugin's `.mcp.json`, re-pointed at a scratch home.
- `w2-*.mjs`, `raw-socket-ping.py`, `sock-client.mjs`, `*-launcher.mjs`, `run-under.mjs`, `sh-hop.mjs`: wave-2
  experiments on the trust gate, the MCP surface, approvals, perception and actions.
- `w3-shim-unit.mjs`: the shim under the neutral client.
- `w3-claude-code-host.mjs`, `w3-claude-code-host-2.mjs`: Claude Code 2.1.283 headless (`spikes/protocol-probe`
  harness) hosting the shim on two TextEdit tasks.

Every scenario that acts on the GUI confines itself to a throwaway TextEdit document it creates in `/tmp`.
