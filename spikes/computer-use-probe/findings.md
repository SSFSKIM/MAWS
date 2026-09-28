# Computer-use probe: wave-2 findings (2026-09-28)

Live experiments against ChatGPT.app 26.924.22138 and `Codex Computer Use.app` 26.923.1001242 on this Mac (macOS 26.6.2 build 25G83,
Retina main screen 1512×982 pt at 2×, system language Korean). They test the static claims of
`research/codex-computer-use/01`–`06`. Everything ran from this Claude Code session, whose ancestry is
`zsh ← claude ← zsh ← login ← cmux ← launchd`: no OpenAI process sits anywhere above the probes.

Scope the owner approved: read-only probes, plus real actions only inside a throwaway TextEdit document the experiment
opens. The probes used a scratch `CODEX_HOME` (`/tmp/maws-cu-probe/codex-home`) and `NODE_REPL_DISABLE_ANALYTICS=1`.
Nothing under `~/.codex`, the service's group container or `/Applications` was written. The owner's "always allow" list
(`ComputerUseAppApprovals.json`) was read and left unchanged.

## Harness

- `mcp-client.mjs`: a neutral stdio MCP client. It journals every frame to `fixtures/<name>.jsonl`, answers
  server-initiated requests (elicitation, roots, ping) with pluggable handlers, and writes image payloads beside the
  journal. It reuses `redact` and `processTree` from `../protocol-probe/harness.mjs`.
- `cua-env.mjs`: the `cua_repl` launch recipe read from the live plugin `.mcp.json`, re-pointed at the scratch home.
- `raw-socket-ping.py`, `w2-foreign-parent.mjs`, `w2-auth-matrix.mjs`, `w2-auth-own-script.mjs`,
  `w2-client-mcp-call.mjs`, `w2-textedit.mjs`, `w2-textedit-actions.mjs`: one scenario each. Run with `node <file>`
  (or `python3` for the ping); each prints a summary and writes its fixture.

## Results

### 1. Who the service accepts

| # | Process that connects to the service | Its parent | Result | Fixture |
|---|---|---|---|---|
| a | unsigned `python3` (raw socket, `ping` with `CodexComputerUseIPC-5`, then `ListApps`) | this shell | `connect()` succeeds; the service closes the connection without answering, even `ping`. Nothing appears in the unified log. | `w2-raw-socket-ping.json` |
| b | OpenAI-signed `node_repl` | our unsigned Node client (nvm) | rejected. The JS client reports "Sky Computer Use native pipe startup failed" after about 5.5 s (250 ms connect, LaunchServices open, 5 s retry). | `w2-auth-node_repl-direct-child-of-unsigned.jsonl` |
| c | OpenAI-signed `SkyComputerUseClient mcp` (the legacy direct Swift MCP server) | our unsigned Node client | `initialize` and `tools/list` succeed (10 tools). `list_apps` returns "Computer Use server error -10000: Sender process is not authenticated". | `w2-client-mcp-list-apps.jsonl` |
| d | OpenAI-signed `node_repl` | OpenAI-signed `node` running OpenAI's `cua-repl.mjs` | **accepted.** `listApps` returns 31 apps. | `w2-foreign-parent-elicitation-{bare,form}.jsonl`, `w2-auth-via-signed-node-launcher.jsonl` |
| e | OpenAI-signed `node_repl` | OpenAI-signed `node` running **our own** 3-line launcher script | **accepted.** | `w2-auth-signed-node-own-script.jsonl` |

Reading. The service checks the code-signing identity of the connecting process **and of its immediate parent**. It
does not require a Codex or ChatGPT process anywhere in the ancestry, which is what reports 01 and 02 predicted from the
`relayWithoutTrustedAncestor` strings. OpenAI's signed `node` counts as a trusted parent whatever script it runs,
because code signing covers the executable and not the JavaScript it loads. Any MCP host can therefore satisfy the
gate by launching the bundled launcher exactly as Codex does: `cua_node/bin/node .../@oai/cua-repl/bin/cua-repl.mjs`.

The older Codex observation that `SkyComputerUseClient mcp` "aborts before `tools/list`" does not reproduce on this
build. The client now answers `tools/list` and fails per call with -10000.

### 2. The MCP surface as a foreign host sees it

- `initialize`: server info `rmcp 1.5.0` (the rmcp crate default, not `node_repl`), capabilities
  `{tools:{listChanged:true}, experimental:{"codex/sandbox-state-meta":{}}}`, instructions "UI automation through cua_repl
  using the initialized cua API." (61 characters).
- `tools/list`: `js`, `js_reset` and `js_add_node_module_dir` are all annotated
  `{readOnlyHint:true, destructiveHint:false, openWorldHint:false}`. That is why Codex adds no pre-call approval of its
  own, which settles report 06's open question 3. `turn_ended` is annotated `{idempotentHint:true}` and carries
  `_meta.ui.visibility: []`, which hides it from the model. The `js` description is only 1,511 characters.
- The API documentation arrives as the **first tool result**, not in the tool description. The first `js` call runs the
  banner (`await import("@oai/cua/tinyskyAlt")`) and returns an 18,789-character `## Computer Use` document ahead of the
  cell's own output. A host that truncates tool descriptions (Claude Code cuts them at 2,048 characters) therefore
  loses nothing.
- Every result carries `_meta` of the form `{"codex/nodeReplExecutionDurationMs": n, "codex/toolSurface":
  {"kind":"computerUse","app": null | {"kind":"appId","appId":"com.apple.TextEdit"}}}`.
- `js` ran without any "Run JavaScript" elicitation from this host. Strict auto-review stays off without Codex turn
  metadata or the force flag.
- Both `elicitation:{}` (what Claude Code advertises) and `elicitation:{form:{}}` enabled app approvals.

### 3. Approval flow (TextEdit only; every other request would have been declined)

- Each app operation first sends `elicitation/create` with `mode:"form"`, an empty `requestedSchema`, message
  `Allow Computer Use to use "TextEdit"?`, and `_meta` containing `codex_approval_kind`, `connector_id:"computer-use"`,
  `persist:["session","always"]`, `riskLevel:"low"`, `tool_name`, `tool_params:{app:"com.apple.TextEdit"}` and
  `tool_params_display`, plus `callId` and `x-codex-turn-metadata` echoed from the call when present.
- **Without `_meta["x-codex-turn-metadata"]` on `tools/call`, approval never persists.** The first run was asked on
  every app call (4 prompts in 4 calls), even though it answered `persist:"session"`.
- **With `x-codex-turn-metadata.session_id` on the call and `_meta:{persist:"session"}` in the reply**, `node_repl`
  wrote `$CODEX_HOME/computer-use/sessions/<session_id>.toml` (`[apps] allowed = ["com.apple.TextEdit"]`). Every later
  call was answered locally: 1 prompt in 5 calls. This settles report 05's question: the `sessions/*.toml` files are
  live, keyed by the Codex session id, and written by `node_repl`.
- A declined request surfaces to the model as `Computer Use was not approved to use TextEdit` (plain text, not
  `isError`).

### 4. Perception and action (throwaway `/tmp/maws-cu-probe/textedit-probe.txt`, opened with `open -g`)

- **AX tree.** Numbered, indented, one element per line, and **localized**: the role names are the system language's
  AX role descriptions (`텍스트 엔트리 영역` for a text entry area). Each line shows flags (`settable`, `disabled`),
  `ID:`, `Value:`, `Help:` and `Secondary Actions:`. The block ends with `The focused UI element is …`. Element indices
  stayed stable across calls. The menu bar comes after the window.
- **Diffs.** A later `getAXState()` returns "The following is a diff from the previous accessibility tree …", with lines
  marked `~` (changed) or `+` (added) and a summary line `Removed element IDs: 10`. New elements get fresh ids (`+ 19`).
- **Screenshot.** The service captures the target window only, including while it is behind another app. The image is
  **JPEG** (`ffd8ffe0…`, JFIF) at full backing resolution: 1312×844 px for a 656×422 pt window. It is delivered as an MCP
  image block **labeled `image/png`** with `_meta:{"codex/imageDetail":"original"}`. Report 03 predicted the mislabel.
- **Coordinates are screenshot pixels.** `click([20, 76])` put the caret before the first character of line 1, which is
  where (20, 76) falls in the 2× screenshot. In points the same numbers land below the text.
- **Actions**, all verified by the value read back through AX and by the saved file:
  - `click(index)` and the key chord `super+Down`, then `typeText`, appended text;
  - `setValue(index, …)` replaced the whole value through AX;
  - `pressKey("super+s")` and `pressKey("super+q")` saved the file and quit TextEdit.
- **Background operation.** Throughout, the frontmost app stayed the owner's Google Chrome, and TextEdit never came to
  the front. The real pointer did not move during the index click (`1258.90,659.73` before and after). Other pointer
  changes in the journal are the owner's own movement. Whether an overlay or the Lens cursor was drawn was not captured.
- `turn_ended {hook_event_name, session_id, turn_id}` returns `{}`.

## What this changes

1. A non-Codex MCP host (standing in for Claude Code) drove the complete loop: approve, read, act, screenshot. The only
   requirement was launching `node_repl` under OpenAI's signed `node`. The "hard fork point" verdicts in reports 01
   and 02 are wrong for this build.
2. What the host must supply, observed rather than inferred:
   - form elicitation;
   - `x-codex-turn-metadata.session_id` on `tools/call`, plus `_meta.persist` in the elicitation reply, for approvals
     to stick. Claude Code 2.1.283 sends neither (report 06, H9 and H11), so under it every app call would prompt
     unless a shim injects them.
3. The gate is a policy choice by OpenAI that it can tighten at any time. The Zed `codex-acp` allowlist entry shows
   OpenAI already restricts by harness identity in other places. Whether OpenAI's terms allow using these bundled
   components from another agent is a non-technical question these tests do not answer.

## Not tested

- A real Claude Code 2.1.283 host (stream-json `elicitation` control requests, ToolSearch deferral, `mcp_tool` hooks).
- The Esc/overlay path and `userIntervened`.
- Screen-lock behavior.
- The Apple Event control plane (`SkCu/SndR`).
- What `turn_ended` releases.
- The model-gate digests.
- Behavior under a trusted-parent launcher when OpenAI ships a newer service build.
