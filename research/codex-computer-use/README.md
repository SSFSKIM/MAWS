# How Codex's native computer use works

Synthesis of a two-wave study, dated 2026-09-28, of ChatGPT.app **26.924.22138**, which ships `codex-cli 0.158.0-alpha.2.1`, the
`cua_node` runtime 0.0.24 and `Codex Computer Use.app` **26.923.1001242**. The target is macOS 26.6.2.

The study came in two waves:

- **Wave 1** was static analysis in six layer reports:
  - `01-native-service.md`: the Swift service and client
  - `02-security-and-lifecycle.md`: signing, the lock-screen guardian, the authorization plugin, TCC, install and update
  - `03-js-controller-stack.md`: `@oai/cua` and `@oai/sky`
  - `04-node-repl-and-mcp-surface.md`: `node_repl` and the MCP server
  - `05-desktop-host-integration.md`: the Electron host
  - `06-codex-cli-host-contract.md`: what the Codex CLI does as the MCP host, and how Claude Code compares
- **Wave 2** was live experiments from a neutral MCP client standing in for Claude Code: `spikes/computer-use-probe/findings.md`,
  with fixtures in `spikes/computer-use-probe/fixtures/`.
- **Wave 3** built the shim (`spikes/computer-use-probe/cua-shim.mjs`) and ran a real Claude Code 2.1.283 host through it:
  `findings.md` §5–7 and `spikes/computer-use-probe/README.md`.

Where the two disagree, wave 2 wins; §9 lists the corrections. **[V]** marks a claim that was observed live or read in
code. **[I]** marks one inferred from binary strings, symbols or disassembly.

Readable sources used throughout:
- `~/codex-app-src/readable/chatgpt-26.924/`: the Electron app.
- `~/codex-app-src/readable/cua-node-0.0.24/`: the prettified `@oai/*` packages, plus JS extracted from `node_repl`.
- `~/codex-app-src/readable/cua-service-26.923/`: string, symbol and disassembly dumps of the Swift binaries.
- `~/codex-app-src/codex-src-0.158/`: the open-source Codex CLI at the exact shipped tag.

---

## 1. The system in one picture

```
ChatGPT.app  (Electron host, com.openai.codex)
 │  spawns and supervises (sky.node, responsibility disclaimed)
 ├──────────────► SkyComputerUseService   (~/.codex/computer-use/Codex Computer Use.app, com.openai.sky.CUAService)
 │                 holds the TCC grants (Accessibility, Screen Recording); reads the AX tree; captures windows with
 │                 ScreenCaptureKit; synthesizes input; draws the overlay and the "Lens" cursor; enforces app policy
 │  ◄─ Apple Events 'SkCu'/'SndR' by PID: host control plane (menu bar, stop app, permission onboarding, appshots, Chronicle)
 │
 └─ spawns  codex app-server  (Rust CLI: model loop, MCP host, approvals, plugin hooks)
             └─ spawns MCP server "cua_repl" = OpenAI-signed node running @oai/cua-repl/bin/cua-repl.mjs  (launcher)
                  └─ node_repl  (Rust MCP stdio server, OpenAI-signed; the only process that touches the socket)
                       ├─ codex sandbox → node kernel.js          UNTRUSTED: the model's JS cells, global `cua` from @oai/cua
                       ├─ codex sandbox → node trusted-worker.js  TRUSTED: @oai/sky/service (policy, approvals, socket client)
                       └─ JSON-RPC 2.0, 4-byte LE length frames ──► ~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock
```

The live process tree on this Mac matches this picture:
- the service is a child of ChatGPT (pid 697);
- `cua-repl.mjs` is a child of `codex app-server`;
- `node_repl` spawns two `codex sandbox` children, each running a Node process.

All of this is [V] from `ps` and the wave-2 process trees.

Three design choices shape everything else:

1. **One process holds all the power.** The Swift service is the only thing with TCC grants. Everything above it is
   an unprivileged client that must be authorized to speak to it.
2. **The model writes code, not tool calls.** The model gets one tool, `js`, which runs JavaScript in a persistent REPL
   against a small `cua` API. It batches several actions and then one observation into each cell. Browser and desktop
   control share this surface, and the README of `@oai/cua-repl` says the training harness ("TinySky") uses the same
   package.
3. **Policy lives on the trusted side of a split REPL.** The model's code runs in a sandboxed VM that cannot reach the
   socket, the approval channel or LaunchServices. Only the trusted worker, which loads code from pinned paths, can.

---

## 2. One action, end to end

What happens when the model runs `await app.click(2); await app.getAXState();`:

1. **Tool call.** Codex calls `tools/call js` on `cua_repl`. It is a plain function tool in namespace `mcp__cua_repl__`,
   never deferred and never exposed to Code Mode. `_meta` carries `callId`, `threadId`, `sessionId` and
   `x-codex-turn-metadata`, which holds `session_id`, `turn_id`, `model` and the node_repl flags. (06 §3, §5 [V])
2. **Cell.** `node_repl` sends the code to the kernel. The first cell of a session is prefixed with the banner
   `await import("@oai/cua/tinyskyAlt")`, which defines `cua` and returns about 19 KB of API documentation as that
   call's result. (04 §2; W2 §2 [V])
3. **Crossing into the trusted worker.** `app.click(2)` becomes
   `nodeRepl.rpc("sky", {type:"execute", method:"click", args})`. `node_repl` relays it to the trusted worker, where
   `@oai/sky/service` handles it. (03 §2.1 [V])
4. **Policy and consent.** For every app operation (03 §5.1, 04 §4 [V]; W2 §3 [V]):
   - the worker sends `ComputerUseIPCAppPolicyRequest {app}`;
   - the service answers `allowed`, `denied` (organization policy) or `forbidden` (safety), with the resolved
     target and its risk level;
   - the worker calls `nodeRepl.createElicitation("Allow Computer Use to use \"TextEdit\"?")`;
   - `node_repl`'s interceptor answers from persisted approvals if it can. Otherwise it sends MCP `elicitation/create`
     to the host. Codex relays that to the Desktop as `mcpServer/elicitation/request`, which renders an approval card
     (05 §5).
5. **Action.** The worker sends
   `request {clientApiVersion:"CodexComputerUseIPC-5", codexTurnMetadata, deadlineUnixMilliseconds, requestType:"ComputerUseIPCAppPerformActionRequest", request:{app:<resolved path>, action:{click:{at:{elementID:{_0:"2"}}, clickCount:1, mouseButton:0}}}}`
   over the socket. `node_repl` opened that socket itself. (03 §2.2–2.4 [V])
6. **Service.** The service authenticates the peer (§7), resolves the app and performs the action. Wave 2 sampled
   the frontmost app and the pointer only before and after each call: the target app was not frontmost at either
   point, and an element-index click left the real pointer where it was (W2 §4 [V]). Report 01 §4 reads the focus
   enforcer as briefly activating the target app during the action [I]; that sampling can neither confirm nor exclude
   it.
7. **Observation.** `getAXState()` sends `ComputerUseIPCAppGetSkyshotRequest {app, disableDiff?}`. The service
   returns AX text (a diff after the first call) and a screenshot file URL. The cell writes the text; for a screenshot
   it reads the JPEG and calls `nodeRepl.emitImage`. The MCP result carries text blocks, image blocks and
   `_meta["codex/toolSurface"]`, which drives the Desktop's "using app X" indicators. Codex turns each image into
   `input_image`, sized for the model's image-detail mode. (03 §3, 06 §2 [V]; W2 §4 [V])
8. **Turn end.** Codex's bundled plugin hooks call the hidden tool `turn_ended {hook_event_name, session_id, turn_id}`:
   awaited on Stop and SubagentStop, and on Interrupt with a 1 s budget. Codex sends no `notifications/cancelled`.
   (06 §6 [V])

---

## 3. Who owns what

| Layer | Owns | Report |
|---|---|---|
| **Electron host** | See the list below this table. | 05 |
| **Codex CLI** | Exposing `js` directly to the model; turning image blocks into `input_image`, where images don't count against `output_token_limit`; routing elicitations (it auto-accepts the routine "Run JavaScript" gate and relays app approvals to the UI); `_meta` on every call; the allowlisted `mcp_tool` hooks that call `turn_ended`. Plugin MCP servers are **not** sandboxed. | 06 |
| **`cua-repl.mjs`** | A launcher only. It builds the tool descriptions from Markdown, sets the banner and the trusted-services map, and `spawn`s `node_repl` with inherited stdio. | 04 §2 |
| **`node_repl`** | The MCP server, the split REPL (a kernel VM plus a trusted worker, both under `codex sandbox`), the host functions (`nativePipe`, `createElicitation`, `launchServices`, authenticated `fetch`, `config.*`), the approval interceptor, approval persistence, and the socket I/O. | 04 |
| **`@oai/cua` (cell)** | The model-facing API: `getState`, `listApps`, `getApp`, and the app handle's `getAXState`, `getScreenshot`, `click`, `drag`, `scroll`, `typeText`, `pressKey`, `paste`, `setValue`, `selectText` and `performSecondaryAction`. Also its documentation and the image emit. | 03 §1 |
| **`@oai/sky` (trusted worker)** | The per-call policy and consent flow, the Swift-`Codable` wire encoding, the socket client and version handshake, and telemetry (Statsig, through the host's authenticated fetch). It uses 7 of about 36 served request types. | 03 §2, §5 |
| **Swift service** | Everything that touches the machine: app resolution and background launch; AX extraction, indexing, diffing and budgets; settle waits; window capture; coordinate mapping; input synthesis; clipboard handling; overlay; blocklists and URL policy; lock-screen handling; peer authentication. | 01, 02 |

The Electron host, in detail:
- ships the runtime and the service inside the app;
- copies the service into `~/.codex/computer-use` with `ditto` on every launch;
- writes the plugin `.mcp.json` env and `config.json` (overlay strings);
- spawns the service eagerly;
- renders approval cards and the menu-bar, picture-in-picture and settings surfaces;
- runs the Apple-Event control plane;
- has **no** role in the agent's data path.

The JS layer is thin, about 700 lines for macOS. All the hard work is in the Swift service.

---

## 4. Perception

- **Accessibility tree.** This is the primary signal. The service renders one numbered line per element, with
  indentation for depth, flags such as `settable` and `disabled`, `ID:`, `Value:`, `Help:` and
  `Secondary Actions:`. The block ends with a `The focused UI element is …` line.
  - The model addresses elements by integer id. Ids stay stable within a chain of diffs, and a replaced element gets
    a fresh id, but a full refetch can renumber: a diff removed id 10 and re-added the same element as `+ 19`, and the
    next full tree listed it as 10 again (`w2-textedit-actions.jsonl` seq 14 and 20).
  - After the first call the service sends a **diff**: `~` changed, `+` added, `Removed element IDs: …`.
    `disableDiff` asks for the full tree.
  - Role names are the **localized** AX role descriptions. On this Korean-language Mac, a text area is `텍스트 엔트리 영역`.
  - Depth, line and text budgets bound the size.
  - Per-app guidance from `AppInstructions/*.md` (Slack, Notion, Numbers and others) is prepended once per app, in
    `<app_specific_instructions>`.

  (01 §3.2 [V/I], 03 §1.1 [V]; W2 §4 [V])
- **Screenshot.** ScreenCaptureKit captures **the target window only**, including when it sits behind another app.
  - The image is a JPEG at full backing resolution: 1312×844 px for a 656×422 pt window on a 2× display. This is
    single-window evidence: both wave-2 screenshots come from that one window.
  - It travels as a file URL. The cell emits it as an MCP image **mislabeled `image/png`**, with
    `_meta["codex/imageDetail"]: "original"`.
  - There is no OCR; the model's own vision reads the image.

  (01 §3.1 [V/I]; W2 §4 [V])
- **Coordinates** are in **screenshot pixel space**, and the service maps them back to screen points (W2 §4 [V]). On
  the one window tested, screenshot pixels and backing pixels are the same numbers, so this does not show which space
  applies once an image is downscaled. Report 01 §3.1 reads the service's scaling fields as a downscaled image in
  scaled coordinates [I], which stays unreconciled until a large-window test (§10).
- **Observation discipline** is taught, not enforced: actions return nothing, and the documentation tells the model to
  batch its actions and then observe once. `getScreenshot()` alone may move the diff baseline without the model seeing
  the text. (03 §1.3, §3 [V/I])

## 5. Action

- **Element operations go through AX**: `setValue` and `selectText` set attributes, and secondary actions call
  `AXUIElementPerformAction`. (01 §4 [I]; W2: `setValue` replaced a text view's contents [V])
- **Pointer and keyboard** are synthesized events aimed at the target window. CoreGraphics is soft-linked, so it does
  not show in the import table.
  - A focus enforcer and a "focus-steal preventer" keep other apps from taking focus mid-action. Report 01 reads the
    enforcer as briefly activating the target app for the action [I].
  - A drawn "Lens" cursor shows the agent's position. After actions, this virtual cursor and a purple computer-use
    badge over the traffic lights are composited into the target window and appear in the model's own screenshot
    (W2 §4 [V]).
  - Key chords use xdotool keysym names, such as `super+s` or `KP_0`.
  - `paste` saves and restores the clipboard, and detects when the user interferes.

  (01 §4 [V/I])
- **Background operation, observed at call boundaries.** An element click, typing, `super+Down`, `super+s` and
  `super+q` all reached a TextEdit window behind Google Chrome. TextEdit was not frontmost before or after any call,
  and the element-index click left the pointer where it was. The frontmost app and pointer were not sampled during a
  call, so "no focus steal during an action" is not established, and 01 §4's brief activation [I] is neither confirmed
  nor excluded. (W2 §4 [V])
- **Interruption.** Real user input during an action, including Esc on the overlay, yields `userIntervened` (-10016).
  The overlay text and accent colour come from `~/.codex/computer-use/config.json`, which the Desktop writes. (01 §4.1,
  05 §4.1 [V/I]; not exercised)

---

## 6. The consent and safety model, layer by layer

1. **Service-side policy.** It returns `forbidden` for password managers, Keychain Access, Passwords and system security
   processes. `denied` comes from organization policy (`[computer_use]` requirements, fed by the host). In browsers it
   enforces a URL blocklist and detects incognito windows. (01 §5 [I], from strings)
2. **Per-app user approval** through MCP form elicitation, on every app operation, persisted three ways:
   - *this conversation*: `$CODEX_HOME/computer-use/sessions/<session_id>.toml`, written by `node_repl` when the call
     carried `x-codex-turn-metadata.session_id`; without it, every app operation prompted [V, W2 §3]. Every run also
     replied `_meta.persist:"session"`, so whether `persist` is required was not isolated, and whether the file is
     honoured after a `node_repl` restart is untested;
   - *always*: `…/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`,
     which Desktop settings can list and revoke (05 §4.3 [V]). Every `node_repl` reads this file from the service's
     group container whatever its `CODEX_HOME`, so a `cua_repl` hosted by MAWS would inherit the user's Codex "always"
     approvals (04 §4(d) [I]). On this Mac those are Finder, Screen Sharing, Xcode and systemuiserver;
   - Desktop also auto-accepts apps the user @-mentioned, once the user has approved any app by hand (05 §5.4 [V]).
3. **Sensitive-action confirmations** (purchases, deletion, messaging, credentials) are **model instructions only**.
   The policy text is `tinysky-alt-confirmations.md`, which the call's `_meta["openai/confirmation_policies"]` can
   replace. Nothing in code classifies actions. (03 §5.1 [V])
4. **The REPL split.** Model-written code runs in a VM under `codex sandbox`, with no `process`, no `eval` and no
   privileged host functions. Policy code runs only in the trusted worker, which loads only from
   `NODE_REPL_TRUSTED_CODE_PATHS`. (04 §5 [V])
5. **The peer gate on the socket** (§7).
6. **A locked Mac.** A root-installed SecurityAgent plugin is installed on this Mac (plugin 26.812), and
   `system.login.screensaver` has been rewritten to consult it first (02 §3 [V]). From strings: the plugin lets the
   service auto-unlock the Mac during an active computer-use turn, the lock-screen guardian keeps the session visible,
   and physical input pauses the unlock (02 §2–3 [I]).

**Where consent is enforced.** The per-app prompt and its persistence live on the client side, in `@oai/sky`'s policy
step and `node_repl`'s interceptor (03 §5.1, 04 §4 [V]). The service's part is the policy answer, `allowed`, `denied`
or `forbidden` (03 §5.1 [V]), and it does not authenticate the turn metadata it is sent (01 §1.5 [I]). A client that
skips the policy step therefore skips the prompt. Wave 2 ran such a client, though only for requests that need no
approval: our own `sock-client.mjs`, under a Node.js-Foundation `node` spawned by OpenAI's `node`, completed `ping` and
`ListApps` (31 apps) directly on the socket (W2 §1, `w2-auth-discriminate.json` [V]). Whether the service refuses an
app operation that no approval covers is untested (03 E4). This is route 4 in §11.

## 7. The trust gate, and what the live tests showed

**Static picture (01 §2, 02 §1).** The service reads the connecting process's audit token. It builds code-signing
identities for the sender, its parent, its responsible process and its ancestors, and compares them in Swift against
allowlists compiled into the binary. Two roles matter:
- **trusted**: team `2DC432GLL2` (OpenAI). The lists also admit OpenAI app bundle ids and Zed's `codex-acp` under team
  `MQ55VZLNZQ`.
- **relay**: signing id `node` or `node_repl`, under team `2DC432GLL2` **or** `HX7739G8FX`. `HX7739G8FX` is the
  Node.js Foundation, not an OpenAI team; the relay list admits the unmodified upstream Node binary.

Failure reasons include `senderProcessNotAuthenticated`, `untrustedParent` and `relayWithoutTrustedAncestor`.

**The predicate, confirmed by 16 live connections (W2 §1 [V]):**

1. The **sender** must be a relay. A non-relay sender is rejected with `-10000` even under a trusted parent (an ad-hoc
   Homebrew `node` and a PSF `python3`, each spawned by OpenAI's `node`, were both rejected). A trusted non-relay
   sender would presumably be admitted directly, but no such binary was tested [I].
2. The service then walks the parent chain **through consecutive relays** and must reach a **trusted** (team
   `2DC432GLL2`) process. The first ancestor that is neither a relay nor trusted halts the walk. A relay chain that
   never reaches a 2DC432GLL2 process fails with `relayWithoutTrustedAncestor`.

The decisive rows: OpenAI `node` → `node_repl` is **accepted** (the parent is team 2DC432GLL2). Node.js-Foundation
`node` → `node_repl` is **rejected** (the parent is a relay but team HX7, and nothing above is 2DC432GLL2).
Interposing an ad-hoc `node` or `/bin/sh` between OpenAI's `node` and `node_repl` is **rejected** (the relay chain
breaks before the 2DC432GLL2 ancestor). Above every probe sits `zsh ← claude ← … ← cmux`, with no OpenAI process.

**What this means for reuse.** A host still gets working computer use by launching the bundled launcher exactly as
Codex does: `cua_node/bin/node .../@oai/cua-repl/bin/cua-repl.mjs`. OpenAI's `node` (team 2DC432GLL2) becomes
`node_repl`'s parent and is the trusted ancestor; whatever launched that `node` is irrelevant, and no Codex or ChatGPT
app process is needed. That is how wave 2 drove a complete approve → read → act → screenshot loop from outside Codex.
The constraint is specific: you must not interpose any non-relay process between `node_repl` and OpenAI's `node`, and a
Node.js-Foundation `node` alone is not a sufficient trusted ancestor.

What this does not settle:
- Whether the *responsible* process is ever consulted, and how team, id and executable-name combine within one
  requirement row.
- The gate is OpenAI's policy, and one release could tighten it, for example to require a Codex ancestor. The Zed
  entry shows OpenAI already allowlists specific third-party harnesses by signature.


## 8. What a host must provide

Condensed from 06 §1, updated with waves 2 and 3. "W3" marks rows verified under a real Claude Code 2.1.283 headless
host with the shim (`spikes/computer-use-probe/findings.md` §6–7); the rest of the Claude Code column comes from its
local spec (`~/claude-code-bundle/2.1.283/SPEC/`).

| Requirement | Why | Codex | Claude Code 2.1.283 |
|---|---|---|---|
| Launch `cua_node/bin/node …/cua-repl.mjs` with the plugin env, outside any sandbox, with a start budget of about 120 s | Trust gate (§7); the service socket | yes | yes, **W3**: the shim spawns the same command; it initialized well inside the default 30 s `MCP_TIMEOUT` |
| Advertise an **elicitation** capability (bare `elicitation:{}` is enough) and answer `elicitation/create` during a call | Every app operation asks; with no elicitation capability, `createElicitation` throws before the persisted-approval check (W2 §2) | yes (relays to UI) | yes, **W3**: Claude Code advertised `elicitation:{}`; headless, the request arrived as a `control_request` of subtype `elicitation` and the `{action, content}` answer went through |
| Send `x-codex-turn-metadata.session_id` in `tools/call._meta` and return `_meta.persist` in the elicitation reply | Without the session id, every app operation prompted even though the reply carried `persist` (W2 §3). Every run sent `persist`, so whether it is required is untested | yes | **no**, but **W3**: the shim injects both, taking the session id from `CLAUDE_CODE_SESSION_ID`, which Claude Code sets in the server's environment; one prompt per app per session |
| Turn image blocks into model image input, keeping order | Screenshots | yes; images are exempt from the token limit | yes, **W3**: the screenshot reached the model as `image/jpeg` (the shim corrects the label), followed by Claude Code's saved-file note. Images count 1,600 tokens each, and a large text block can cut later images |
| Keep the model's coordinates in the screenshot's pixel space | Coordinate clicks are in screenshot pixels (§4) | yes, when the model accepts the `original` detail the cell requests: up to 6,000 px (06 §2) | **partly**. Images above 2,000 px (a window wider than 1,000 pt on a 2× display) are downscaled, with a text note giving the coordinate multiplier (06 H4). Coordinate clicks then need that multiplier; element-index addressing is unaffected |
| Keep `js` directly visible | Tool quality | `omit_tools_from` | **W3**: the shim marks `js` and `js_reset` with `_meta["anthropic/alwaysLoad"]`; both appeared in the initial tool list and no `ToolSearch` call was made. No host config needed |
| Call hidden `turn_ended` at turn end or interrupt | Releases per-turn state | Stop, SubagentStop and Interrupt hooks | **W3** for Stop: an `mcp_tool` hook (`server: cua_repl`, `tool: turn_ended`, `${session_id}`, `${prompt_id}`) reached the wire and returned `{}`. SubagentStop and StopFailure untested; there is no interrupt hook, but Claude Code sends `notifications/cancelled` (untested here) |

Two things are **not** requirements, as wave 2 showed. The `js` description is 1,511 characters, and the API document
arrives in the first result, so Claude Code's 2,048-character description cap is harmless. And no "Run JavaScript"
approval is raised without Codex turn metadata.

## 9. Corrections to the layer reports

1. **01 §2.3 and "Portability verdict"; 02 §0 and §1e.** "A Claude Code harness cannot connect / would be rejected" is
   wrong for the launcher route: see §7 and W2 §1. The allowlist strings and the relay-needs-a-trusted-ancestor model
   are real and confirmed. What the reports missed is that OpenAI's bundled `node` (team `2DC432GLL2`), which any host
   can launch, is itself the trusted ancestor when it is `node_repl`'s parent.
2. **02 §1c.** `HX7739G8FX` is the **Node.js Foundation**, not "an OpenAI secondary/CI signing team". It sits on the
   relay list, so an upstream Node binary may relay, but it is not trusted and cannot be the ancestor that satisfies the
   gate.
3. **02 §1a** ("a caller outside team 2DC432GLL2 cannot join this group container"). An unsigned-by-OpenAI process
   opened the socket (`connect()` succeeded, W2 §1). The group container does not block the connection; the service's
   own peer check does.
4. **01 §6.3** ("the client validates its parent before relaying"). Under a foreign parent, `SkyComputerUseClient`'s
   call reached the service and came back `-10000`; the rejection happened at the service, not in the client.
5. **01 §6.4.** "`SkyComputerUseClient mcp` aborts before `tools/list`" does not reproduce on this build. It lists 10
   tools and fails per call with -10000 under a foreign parent.
6. **04 §4(d) and §6.** "Pre-seeding approval files avoids needing elicitation at all" is wrong. `createElicitation`
   throws before the interceptor runs whenever the client advertises no elicitation capability
   (`node_repl-embedded/privileged-node-repl.js:69`; W2 §2). Pre-seeding avoids the *prompt*, not the *capability*.
7. **05 §4.2.** The `sessions/*.toml` files are not a dead format. `node_repl` writes them today, keyed by
   `x-codex-turn-metadata.session_id` (W2 §3).
8. **06 open question 3.** The `js` annotations are `readOnlyHint:true, destructiveHint:false, openWorldHint:false`, so
   Codex adds no approval of its own. **06 H3** ("degraded by default" under Claude Code) does not apply in practice
   (§8).
9. **03 §3.** The mislabeled JPEG and the screenshot-pixel coordinate space are now confirmed, on one 656×422 pt window
   (§4).
10. **04 §3.** Server info is `rmcp 1.5.0`, the crate default, not `node_repl 0.1.0`.
11. **03 §7.2 and 06 H7.** Whether `node_repl` treats bare `elicitation:{}` as form support is settled: it does. A client
    advertising it received the app-approval request; only a client advertising no elicitation got "createElicitation
    is unavailable" (W2 §2).
12. **03 §7.2** ("in practice it is likely blocked on the service side"). The service's peer check did not block a thin
    client of our own: `sock-client.mjs`, run by a Node.js-Foundation `node` whose parent was OpenAI's `node`,
    completed `ping` and `ListApps` (W2 §1). The check constrains which binaries run the client and sit above it, not
    whose code runs. Whether the service enforces consent for such a client is still E4 (§6, §11 route 4).

## 10. Open questions

- The exact trust predicate: are the responsible process and deeper ancestors ever consulted? What are `HX7739G8FX`
  and the `com.openai.atlas`/`com.openai.sky.app` entries?
- What `turn_ended` releases, and what breaks if it never arrives.
- How Esc and the overlay are detected, and how `userIntervened` reaches the model mid-cell.
- Whether a screenshot-only observation moves the diff baseline (03 E6).
- Screenshot scale on a large window. Both wave-2 screenshots come from one 656×422 pt window, where screenshot and
  backing pixels coincide. A window large enough to be downscaled would show whether the service scales the image, as
  01 §3.1 reads its scaling fields [I], and which space coordinate clicks use then.
- Focus during an action: whether the service briefly activates the target app (01 §4 [I]). Wave 2 sampled the
  frontmost app and pointer only between calls.
- Where consent is enforced: whether the service refuses an app operation that skipped the policy step (03 E4). This
  decides what route 4 in §11 bypasses.
- Whether `_meta.persist` is required for a session approval, and whether one survives a `node_repl` restart.
- Behavior under a real Claude Code 2.1.283 host: stream-json elicitation, ToolSearch, hooks, and the model's ability
  to use the API.
- The model-gate digests (`NODE_REPL_ENFORCE_MODEL_CHECK`, off in this deployment).
- Stability across ChatGPT updates. The runtime and service are re-copied on every launch, and the service also
  self-updates through Sparkle.

## 11. What this means for MAWS (input for the next discussion, not a decision)

Four routes are now concrete:

1. **Host OpenAI's `cua_repl` under Claude Code.** **Done and proven (wave 3).** The owner chose this route on
   2026-09-28. `spikes/computer-use-probe/cua-shim.mjs`, a stdio MCP proxy of about 100 lines, launches OpenAI's
   server exactly as Codex does and supplies what Codex's host would: session metadata on each call, `persist` on
   accepted approvals, the real image MIME type, and the `anthropic/alwaysLoad` marker. Under a real Claude Code
   2.1.283 headless host (Sonnet), two TextEdit tasks completed end to end, including menu-bar navigation, a
   screenshot to the model, one approval prompt per app per session, and a Stop → `turn_ended` hook; each run cost
   under $0.50 (W3 §6–7). Usage is in `spikes/computer-use-probe/README.md`. It inherits the user's Codex "always"
   approvals (§6 [I]). The structural risk stands: OpenAI can tighten the gate or the protocol,
   `CodexComputerUseIPC-5`, in any weekly release, so the shim must be re-verified per ChatGPT.app update.
2. **Delegate GUI work to a Codex agent.** Claude hands a GUI task to Codex through `codex app-server`, as the
   `codex-companion` "amigo" verb already does. This is the sanctioned path, but a GPT model performs the GUI steps.
3. **Build MAWS's own controller** with its own TCC identity, using this architecture as the template:
   - an AX-first rendering with ids that stay stable across diffs;
   - per-window ScreenCaptureKit capture;
   - background event targeting;
   - a split REPL that keeps policy on the trusted side;
   - per-app consent through MCP elicitation.

   This is durable and independent. Its hardest part is reliable input to a background window. Wave 2 did not
   establish that OpenAI's service avoids a brief focus change during an action (§5), so that part has no proven
   template to copy.
4. **Speak the service's socket protocol directly.** MAWS-authored JS speaks `CodexComputerUseIPC-5` on the socket,
   run by a relay `node` under an OpenAI `node` parent, bypassing `node_repl` and its elicitation. Wave 2's
   `sock-client.mjs` completed `ping` and `ListApps` this way (§6). MAWS would then own consent itself, and whether
   the service enforces approval for app operations without the policy step is untested (03 E4). Coupling weighs
   more heavily here than on route 1: MAWS would depend on the wire encodings directly, and would drive OpenAI's
   service with its consent layer bypassed. With route 1 working, this route is a fallback only.
