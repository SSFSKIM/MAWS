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
  `w2-client-mcp-call.mjs`, `w2-auth-ancestry.mjs`, `w2-auth-discriminate.mjs`, `w2-elicitation-capability.mjs`,
  `w2-textedit.mjs`, `w2-textedit-actions.mjs`: one scenario each. Run with `node <file>` (or `python3` for the ping);
  each prints a summary and writes its fixture.
- Process-chain helpers the auth scenarios spawn to put a chosen binary at one hop of the ancestry: `own-launcher.mjs`
  (our own script under OpenAI's `node`, spawning `node_repl`), `hop-launcher.mjs` (one more hop, then `node_repl`),
  `sh-hop.mjs` (`/bin/sh` as `node_repl`'s parent), `run-under.mjs` (runs a command whose parent is whichever `node`
  runs this file) and `sock-client.mjs` (a minimal direct socket client: `ping`, then `ListApps`).

## Results

### 1. Who the service accepts

The signatures of the binaries used below (`codesign -dv`, verified):

| binary | signing id | team | on an allowlist? |
|---|---|---|---|
| `cua_node/bin/node`, `.../node_repl` (OpenAI) | `node` / `node_repl` | `2DC432GLL2` | relay **and** trusted team |
| `~/.nvm/.../node` (Node.js Foundation) | `node` | `HX7739G8FX` | relay only (not the trusted team) |
| `/opt/homebrew/bin/node` | ad-hoc | none | no |
| Python.framework `python3.12` (PSF) | `python3` | `BMM5U3QVKW` | no |
| `/bin/sh`, `/usr/bin/python3` (Apple) | Apple platform | none | no |

Two definitions from reports 01/02, now confirmed by the results:
- a process is **trusted** if its team is `2DC432GLL2` (the static lists also admit OpenAI app bundle-ids and Zed's
  `codex-acp` under `MQ55VZLNZQ`);
- a process is a **relay** if its signing id is `node`/`node_repl` under team `2DC432GLL2` **or** `HX7739G8FX`.

The full chain above every probe is `… ← zsh ← claude ← zsh ← login ← cmux ← launchd`, with no OpenAI process in it.

**Relay senders** (`node_repl` connecting; fixtures `w2-auth-*`, `w2-foreign-parent-*`, `w2-auth-discriminate.json`):

| sender | chain to a team-2DC432GLL2 process | result |
|---|---|---|
| `node_repl` | parent = OpenAI `node` (team 2DC432GLL2) | **accepted** |
| `node_repl` | parent = OpenAI `node`, its parent unsigned Node | **accepted** |
| `node_repl` | parent = Node.js-Foundation `node` (HX7, relay), its parent OpenAI `node` | **accepted** |
| `node_repl` | parent = Node.js-Foundation `node` (HX7, relay), no 2DC ancestor above | **rejected** |
| `node_repl` | parent = OpenAI `node`, but an ad-hoc `node` or `/bin/sh` sits **between** them | **rejected** |
| `node_repl` | parent = ad-hoc Homebrew `node` | **rejected** |

**Direct socket senders** (each spawned by OpenAI `node` via `run-under.mjs`, or standalone; `sock-client.mjs`,
`raw-socket-ping.py`):

| sender | parent | result |
|---|---|---|
| OpenAI `node` (relay) | our shell (no 2DC ancestor) | **rejected**: ping gets no reply |
| Node.js-Foundation `node` (relay) | our shell | **rejected** |
| Node.js-Foundation `node` (relay) | OpenAI `node` (2DC) | **accepted**: ping + ListApps (31 apps) |
| ad-hoc Homebrew `node` (not a relay) | OpenAI `node` (2DC) | **rejected** |
| PSF `python3` (not a relay) | OpenAI `node` (2DC) | **rejected** |

Reading. One predicate fits all 16 rows, and it is the `relayWithoutTrustedAncestor` model of report 02 §1b:

1. The **sender** must be a relay (id `node`/`node_repl`). A non-relay sender is rejected outright with
   `senderProcessNotAuthenticated` (-10000), even under a trusted parent (the ad-hoc and PSF direct senders). A trusted
   non-relay sender connecting directly would presumably be allowed too, but no such binary was on hand to test [I].
2. The service then walks the parent chain **through consecutive relays**, and the walk must reach a **trusted**
   (team `2DC432GLL2`) process. The first ancestor that is neither a relay nor trusted halts the walk. A relay chain
   that never reaches a 2DC ancestor → `relayWithoutTrustedAncestor`.

This is why: OpenAI `node` → `node_repl` is accepted (parent is team 2DC432GLL2); Node.js-Foundation `node` →
`node_repl` is rejected (the parent is a relay but team HX7, and nothing above is 2DC); and interposing an ad-hoc `node`
or `/bin/sh` between OpenAI `node` and `node_repl` breaks the relay chain, so the 2DC ancestor two levels up is never
reached.

**What this means for reuse.** The standard launch still works from any host: spawn
`cua_node/bin/node .../@oai/cua-repl/bin/cua-repl.mjs`. OpenAI's `node` (team 2DC432GLL2) becomes `node_repl`'s parent
and satisfies the trusted-ancestor test; whatever launched that `node` is irrelevant. The constraint is narrower than
"any OpenAI-signed node counts": you must not interpose any non-relay process between `node_repl` and OpenAI's `node`,
and a Node.js-Foundation `node` (HX7) is **not** by itself a sufficient trusted ancestor.

Correcting my earlier wave-2 note: the `w2-auth-ancestry` runs I first labeled "signed-then-unsigned" and
"unsigned-then-signed" used nvm's `node`, which is Node.js-Foundation-signed (HX7, a relay), not unsigned. They
therefore did **not** show that an unsigned process may sit in the chain; the `w2-auth-discriminate` runs with a
genuinely ad-hoc `node` and `/bin/sh` show it may not.

Not separated by these runs: whether the *responsible* process (here likely cmux) is ever consulted, and the exact
combining of the team, id and executable-name criteria within one requirement row.

The older Codex observation that `SkyComputerUseClient mcp` "aborts before `tools/list`" does not reproduce on this
build. The client answers `tools/list` (10 tools) and fails per call with `-10000` under a foreign parent.

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
- Bare `elicitation:{}`, which Claude Code advertises by default, is enough for app approvals. A `getApp("TextEdit")`
  cell drew the approval request both from a client advertising `elicitation:{}` and from one advertising
  `elicitation:{form:{}}` (`w2-elicit-cap-bare.jsonl` and `w2-elicit-cap-form.jsonl`, seq 6). A client advertising no
  elicitation got "nodeRepl.createElicitation is unavailable because the MCP client does not support form
  elicitation", and no request was sent (`w2-elicit-cap-none.jsonl`, seq 6). Script `w2-elicitation-capability.mjs`;
  every request was declined, so no app was acted on.

### 3. Approval flow (TextEdit only; every other request would have been declined)

- Each app operation first sends `elicitation/create` with `mode:"form"`, an empty `requestedSchema`, message
  `Allow Computer Use to use "TextEdit"?`, and `_meta` containing `codex_approval_kind`, `connector_id:"computer-use"`,
  `persist:["session","always"]`, `riskLevel:"low"`, `tool_name`, `tool_params:{app:"com.apple.TextEdit"}` and
  `tool_params_display`, plus `callId` and `x-codex-turn-metadata` echoed from the call when present.
- **Without `_meta["x-codex-turn-metadata"]` on `tools/call`, approval did not persist.** The first run
  (`w2-textedit.jsonl`), whose calls carried no `_meta`, was asked on every app operation: 4 prompts across 4 app
  operations in 3 cells (seq 10, 17, 39, 42). Two other cells failed on a regex before reaching the app (seq 24, 28),
  and the save-and-quit cell drew two prompts, one per `pressKey`. Every reply carried `persist:"session"`.
- **With `x-codex-turn-metadata.session_id` on the call and `_meta:{persist:"session"}` in the reply**, `node_repl`
  wrote `$CODEX_HOME/computer-use/sessions/<session_id>.toml` (`[apps] allowed = ["com.apple.TextEdit"]`). Every later
  call was answered locally: 1 prompt in 5 calls. This settles report 05's question: the `sessions/*.toml` files are
  live, keyed by the Codex session id, and written by `node_repl`.
- Two things these runs did not separate. Both replied `persist:"session"`, so whether `persist` is required on top of
  the session id is unknown. And no run restarted `node_repl`, so whether a new process honours the session file is
  unknown.
- A declined request surfaces to the model as `Computer Use was not approved to use TextEdit` (plain text, not
  `isError`).

### 4. Perception and action (throwaway `/tmp/maws-cu-probe/textedit-probe.txt`, opened with `open -g`)

- **AX tree.** Numbered, indented, one element per line, and **localized**: the role names are the system language's
  AX role descriptions (`텍스트 엔트리 영역` for a text entry area). Each line shows flags (`settable`, `disabled`),
  `ID:`, `Value:`, `Help:` and `Secondary Actions:`. The block ends with `The focused UI element is …`. The menu bar
  comes after the window.
- **Diffs.** A later `getAXState()` returns "The following is a diff from the previous accessibility tree …", with lines
  marked `~` (changed) or `+` (added) and a summary line `Removed element IDs: 10`.
- **Element ids** stay stable within a chain of diffs, and a replaced element gets a fresh id, but a full refetch can
  renumber. In `w2-textedit-actions.jsonl` the diff at seq 14 removed id 10 and re-added the same element as `+ 19`;
  the full tree at seq 20 lists it as id 10 again.
- **Screenshot.** The service captures the target window only, including while it is behind another app. The image is
  **JPEG** (`ffd8ffe0…`, JFIF) at full backing resolution: 1312×844 px for a 656×422 pt window. It is delivered as an MCP
  image block **labeled `image/png`** with `_meta:{"codex/imageDetail":"original"}`. Report 03 predicted the mislabel.
  This is single-window evidence: both screenshots (`w2-textedit.1.png`, `w2-textedit-actions.1.png`, JPEGs despite the
  name) come from the same 656×422 pt window, which was not downscaled.
- **Coordinates are screenshot pixels, on this window.** `click([20, 76])` put the caret before the first character of
  line 1, which is where (20, 76) falls in the 2× screenshot. In points the same numbers land below the text. At this
  size screenshot pixels and backing pixels are the same numbers, so the test cannot tell them apart. Report 01 §3.1
  reads the service's scaling fields as a downscaled image in scaled coordinates [I]; that is still unreconciled, and a
  window large enough to be downscaled would settle it.
- **Actions**, all verified by the value read back through AX and by the saved file:
  - `click(index)` and the key chord `super+Down`, then `typeText`, appended text;
  - `setValue(index, …)` replaced the whole value through AX;
  - `pressKey("super+s")` and `pressKey("super+q")` saved the file and quit TextEdit.
- **Background operation, sampled at call boundaries only.** `w2-textedit-actions.mjs` read the frontmost app and the
  pointer before and after each call (the `observe` events), never during one.
  - TextEdit was not frontmost before or after any call; the owner's Google Chrome was.
  - The element-index click left the pointer where it was (`1258.90,659.73` before and after, seq 15).
  - The one coordinate click coincided with the owner's own pointer movement (seq 18), so it shows nothing about the
    pointer.

  A brief activation of TextEdit during a call cannot be excluded, and report 01 §4 reads its focus-enforcer symbols as
  exactly that [I]. "No focus steal during an action" is therefore not established.
- **Agent cursor and badge.** `w2-textedit-actions.1.png` (a JPEG), taken after the actions, shows a drawn agent cursor
  near the window's centre and a purple computer-use badge where the traffic lights were. The virtual cursor and the
  in-use badge are composited into the target window and appear in the model's own screenshot [V]. The first run's
  screenshot, taken before any action and without turn metadata, shows neither, with the traffic lights visible.
- `turn_ended {hook_event_name, session_id, turn_id}` returns `{}`. The next cell was still answered from the session
  approval (`w2-textedit-actions.jsonl` seq 22 to 27).

## What this changes

1. A non-Codex MCP host (standing in for Claude Code) drove the complete loop: approve, read, act, screenshot. The only
   requirement was launching `node_repl` under OpenAI's signed `node`. The "hard fork point" verdicts in reports 01
   and 02 are wrong for this build.
2. What the host must supply, observed rather than inferred:
   - an elicitation capability; bare `elicitation:{}`, Claude Code's default, is verified to be enough (§2);
   - `x-codex-turn-metadata.session_id` on `tools/call` for approvals to stick, with `_meta.persist` in the
     elicitation reply (every run sent it, so whether it is required is untested; §3). Claude Code 2.1.283 sends
     neither (report 06, H9 and H11), so under it every app operation would prompt unless a shim injects them.
3. The gate is a policy choice by OpenAI that it can tighten at any time. The Zed `codex-acp` allowlist entry shows
   OpenAI already restricts by harness identity in other places. Whether OpenAI's terms allow using these bundled
   components from another agent is a non-technical question these tests do not answer.
4. A fourth reuse route exists (README §11): our own JS speaking `CodexComputerUseIPC-5` directly on the socket. Run by
   a Node.js-Foundation `node` whose parent was OpenAI's `node`, `sock-client.mjs` completed `ping` and `ListApps`
   (31 apps; §1, `w2-auth-discriminate.json`). This bypasses `node_repl` and its elicitation; whether the service
   enforces per-app approval without the policy step is untested (report 03, E4).

## Wave 3: Claude Code hosting OpenAI's cua_repl through a shim

Goal set by the owner after wave 2: let Claude Code use Codex computer use. Route 1 from README §11, with the shim
`cua-shim.mjs` (see `README.md` in this folder for usage). Same envelope: a throwaway TextEdit document in `/tmp`.

### 5. The shim under the neutral client (`w3-shim-unit.mjs`, fixtures `w3-shim-unit*.jsonl`)

The client sent what Claude Code sends: bare `elicitation:{}`, `_meta:{"claudecode/toolUseId"}` on calls, and
`{action, content}` replies with no `_meta`. Observed [V]:
- `tools/list` came back as `js`, `js_reset` (each with `_meta["anthropic/alwaysLoad"]: true`) and `turn_ended`
  (`_meta.ui.visibility: []`); `js_add_node_module_dir` was removed.
- Every `tools/call` reached `node_repl` with `callId`, `threadId`, `sessionId` and `x-codex-turn-metadata`
  (`turn_id` = the Claude tool-use id).
- The accepted approval was forwarded as `{action:"accept", content:{}, _meta:{persist:"session"}}`; one prompt for
  `getApp`, none for the two later calls; `sessions/shim-unit-s1.toml` written under the shim's `CODEX_HOME`.
- The screenshot reached the client as `image/jpeg` (the shim sniffed the JPEG magic and relabeled it).

### 6. Claude Code 2.1.283 headless, run 1 (`w3-claude-code-host.mjs`, fixture `w3-claude-code-host*.jsonl`)

Claude Code 2.1.283 in `-p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`
(the MAWS wiring, through `spikes/protocol-probe/harness.mjs`), model Sonnet, `--strict-mcp-config` with the shim as
the only server, no settings files. The harness accepted only approvals whose message named TextEdit and allowed only
`mcp__cua_repl__*` tools. The prompt gave the goal, not the API: read the document, append " Hello from Claude Code."
at the end, save, screenshot and describe, quit.

Result [V]: `success` in 6 turns, 5 `js` calls, 29.6 s, $0.39.
- `system/init` listed `mcp__cua_repl__js` and `mcp__cua_repl__js_reset` directly; no `ToolSearch` call occurred. So
  the `anthropic/alwaysLoad` marker the shim injects is enough; no host config is needed.
- Claude Code advertised `capabilities: {roots:{listChanged:true}, elicitation:{}}` and
  `clientInfo {name:"claude-code", version:"2.1.283"}` (shim journal).
- The elicitation arrived as `control_request` subtype `elicitation` (`mcp_server_name: "cua_repl"`, `mode: "form"`,
  empty schema); one prompt, then the approval persisted as `sessions/<claude session id>.toml`. The shim took the
  session id from `CLAUDE_CODE_SESSION_ID` in the server's environment, which Claude Code sets at spawn.
- The first `js` result delivered OpenAI's 18,789-character API document plus the AX tree; the model learned the API
  from it and wrote correct code on the first try (`cua.getApp`, `click(2)`, `pressKey("super+Down")`, `typeText`,
  `pressKey("super+s")`, `getAXState`, `getScreenshot`, `listApps`).
- The screenshot reached the model as an `image/jpeg` block, followed by Claude Code's `[Image: source: …]` note
  pointing at the persisted file.
- On disk afterwards: `MAWS computer-use probe document.\n Hello from Claude Code.`; TextEdit not running.
- 5 `can_use_tool` escalations (one per call), all allowed by the harness; in interactive Claude Code these would be
  permission prompts unless `mcp__cua_repl__js` is allowed in settings.

### 7. Claude Code 2.1.283 headless, run 2 (`w3-claude-code-host-2.mjs`, fixture `w3-claude-code-host-2*.jsonl`)

A harder in-envelope task on an RTF document: select the first line, make it bold through the menu bar (Format > Font >
Bold), confirm through AX, save, quit, report the menu items used. Plus a `Stop` hook of type `mcp_tool` registered
through `--settings` that calls `cua_repl.turn_ended` with `${session_id}` and `${prompt_id}`.

Result [V]: `success` in 13 turns, 12 `js` calls, 66 s, $0.43.
- Menu navigation through AX indices worked on the Korean menu bar: the model clicked 포맷 (Format), then 서체 (Font),
  then 볼드체 (Bold), after `selectText(2, "First line of the probe.")`. The saved RTF carries `\b` on the first line
  and `\b0` before the second.
- The `Stop` hook fired once and reached the wire as `tools/call turn_ended {hook_event_name:"Stop", session_id:<claude
  session id>, turn_id:<prompt_id>}`, answered `{}`; the hook reported success. `mcp_tool` hooks against a
  `--mcp-config` server therefore work for the cleanup contract (06 H14).
- A gotcha surfaced and the model recovered on its own: after `super+q`, a check through the stale app handle called
  `get_app_state`, which relaunches the app if needed (03 §2.3). TextEdit came back with an Open panel, which blocked
  `super+q`; the model read the tree, clicked the panel's 취소 (Cancel) button (index 72) and quit again. Seven of the
  twelve calls were this recovery. The model instructions for MAWS should say: after quitting an app, drop its handle
  and verify with `cua.listApps()`.
- No screenshot was taken in this run (the model relied on AX alone), so `imagesToModel` was 0.

### What wave 3 settles

- Route 1 works end to end under a real Claude Code 2.1.283 host, headless, with a 100-line shim and no changes to
  Claude Code, OpenAI's binaries or the user's `~/.codex`. Both tasks completed; total cost under $1.
- Of README §8's rows, these are now verified live under Claude Code: launch and start budget (the shim initialized in
  well under a second); bare `elicitation:{}` end to end including the headless `control_request`; session metadata and
  `persist` (supplied by the shim); image blocks to the model with correct MIME; `js` directly visible through
  `anthropic/alwaysLoad`; `turn_ended` through a Stop `mcp_tool` hook.
- Still open from §8: the coordinate multiplier on downscaled screenshots (both windows here were small), the
  interrupt path (`notifications/cancelled` was not exercised), and `SubagentStop`.

## Not tested

- Under Claude Code: an interrupt mid-call (`notifications/cancelled`), `SubagentStop`, interactive-mode dialogs, and a downscaled (>2000 px) screenshot's coordinate multiplier.
- The Esc/overlay path and `userIntervened`.
- Screen-lock behavior.
- The Apple Event control plane (`SkCu/SndR`).
- What `turn_ended` releases.
- The model-gate digests.
- Behavior under a trusted-parent launcher when OpenAI ships a newer service build.
- Whether `_meta.persist` is required for session approval: every run replied `persist:"session"`.
- Whether a session approval survives a `node_repl` restart.
- Focus and pointer during a call: they were sampled only before and after.
- A window large enough for its screenshot to be downscaled, and the coordinate space then.
- Whether the service refuses an app operation from a direct socket client that skipped the policy step (report 03,
  E4).

## 2026-09-30 addendum: silencing the app-approval dialog

Three of the open questions above are now settled, all from this Claude Code session (host 2.1.285, ChatGPT.app
26.924.22138), against the plugin's shim with the owner's scratch `CODEX_HOME` (`~/.maws/cua-home`).

- **`node_repl` reads the machine-wide always-allow list even under a scratch `CODEX_HOME`.** Finder, which is on the
  owner's `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`,
  bound with no `elicitation/create`; TextEdit, which is not, drew the request (`persist:["session","always"]`,
  `riskLevel:"low"`) and was declined. Nothing was written (`w4-always-allow-read.shim.jsonl`, seq 4 to 11).
- **A reply carrying `_meta:{persist:"always"}` (`CUA_SHIM_PERSIST=always`) is written to that same list**, not to a
  session file: `com.apple.TextEdit` was appended to `approvedBundleIdentifiers` and no `sessions/*.toml` appeared
  (`w4-persist-always.shim.jsonl`, seq 7). The list was restored to its four original entries afterwards.
- **A Claude Code `Elicitation` hook answers the request before any dialog.** With
  `hooks.Elicitation[matcher "cua_repl|plugin:cua:cua_repl"]` returning
  `{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{}}}`, a `claude -p` run bound
  TextEdit on its first call: request at seq 8, accept from the host 43 ms later at seq 9, `_meta.persist:"session"`
  stamped by the shim, `sessions/<session id>.toml` written (`w4-elicitation-hook.shim.jsonl`). In the 2.1.283 source
  the handler returns the hook's response and skips `ask()` (`handle` in the elicitation class: "Elicitation resolved
  by hook"); the same order holds on the print-mode path. The hook input carries `mcp_server_name`, `message`, `mode`,
  `url`, `elicitation_id` and `requested_schema`, not the server's `_meta`, so an app filter has to go by `message`.

## 2026-10-01 addendum: the browser surface (`cua.createBrowserTab("iab", …)`)

Prompted by Codex describing its in-app browser control as `cua.createBrowserTab("iab", url, {visible:true})` through
the same `js` tool. Source: `cua_node` in ChatGPT.app 26.924.22138 and the readable main process
(`~/codex-app-src/readable/chatgpt-26.924/main-process/main-C5425b_s.js`, "main" below).

- **Same server, other surface.** With `browser` in `CUA_REPL_ENABLED_SURFACES`, the `cua` global gains `getBrowser`,
  `createBrowserTab`, `getTab`, `listBrowsers` and `listTabs`. They go through `nodeRepl.rpc("browser")` to
  `@oai/browser-desktop/service` in the trusted worker and never touch Sky (report 03 §1.2).
- **Discovery is by socket directory.** The service lists `/tmp/codex-browser-use/*.sock` (`BROWSER_USE_BACKEND_PATHS`
  overrides) and asks each `getInfo` over JSON-RPC 2.0 with a 4-byte length prefix. Backend types are `iab`,
  `extension` and `cdp`; the installed recipe sets `BROWSER_USE_AVAILABLE_BACKENDS=chrome,iab`. Live, ChatGPT's main
  process held three sockets there, and two `ChatGPT for Chrome` native-messaging hosts
  (`~/.codex/plugins/cache/openai-bundled/chrome/latest/extension-host/…`, children of Chrome) held one each.
- **`iab` is ChatGPT.app's built-in browser panel, one backend per Codex conversation.** Its metadata is
  `codexSessionId = conversationId` (main:151528), and `createTabForBrowserUse` opens a page in that conversation's
  panel (main:151551). The service keeps only `iab` backends whose `codexSessionId` equals the session id in the call's
  turn metadata (`Mee`/`Nee` in `browser-service.mjs`; diagnostic reasons `no-iab-backends`, `no-session-match`). A
  Claude Code session id never matches, so `iab` is out of this shim's reach by design. Reaching one would mean
  borrowing a live Codex thread's id and driving that thread's panel.
- **The sockets have their own peer gate.** Packaged prod, beta and nightly builds load
  `Resources/native/browser-use-peer-authorization.node` (team 2DC432GLL2; main:18981-19040). It reads the peer's
  audit token and checks the code-signing identity of the peer, its parent and its grandparent; its strings list
  `node`, `node_repl`, `codex` and `com.openai.codex*`, and the rejection `untrusted-process-ancestry`. Not exercised.
- **Live, read-only (`w4-browser-inventory.mjs`, scratch `CODEX_HOME`).** With surfaces `browser,computer` the `js`
  description gains the browser API. `cua.getState()` returned the app inventory and `browsers: []` with
  `errors: ["Browsers: Error: Codex auth token is unavailable"]`. That string is in the `node_repl` binary beside
  `getAuthStatus`, client name `codex-browser-use` and `BROWSER_CONFIG_AUTH_TOKEN`, and `node_repl` had started a Codex
  app-server against the scratch home (it left `logs_2.sqlite`, `goals_1.sqlite` and `installation_id` there). Reading
  (inferred): `node_repl` fetches the Codex login token through that app-server and hands it to the browser service,
  so the browser surface lists nothing until `CODEX_HOME` holds a Codex login.
- **Not tested:** the same inventory with `CUA_SHIM_CODEX_HOME=~/.codex`, which would show whether the Chrome
  extension backend accepts this process chain; anything that opens a tab.
