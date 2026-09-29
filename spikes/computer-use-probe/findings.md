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

## Not tested

- A real Claude Code 2.1.283 host (stream-json `elicitation` control requests, ToolSearch deferral, `mcp_tool` hooks).
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
