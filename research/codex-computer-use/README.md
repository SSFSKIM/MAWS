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
6. **Service.** The service authenticates the peer (§7), resolves the app and performs the action. Observed: the
   target app stayed in the background, and the real pointer did not move. (01 §4 [I]; W2 §4 [V])
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
  - Element ids are stable integers across a session. The model addresses elements by id.
  - After the first call the service sends a **diff**: `~` changed, `+` added, `Removed element IDs: …`.
    `disableDiff` asks for the full tree.
  - Role names are the **localized** AX role descriptions. On this Korean-language Mac, a text area is `텍스트 엔트리 영역`.
  - Depth, line and text budgets bound the size.
  - Per-app guidance from `AppInstructions/*.md` (Slack, Notion, Numbers and others) is prepended once per app, in
    `<app_specific_instructions>`.

  (01 §3.2 [V/I], 03 §1.1 [V]; W2 §4 [V])
- **Screenshot.** ScreenCaptureKit captures **the target window only**, including when it sits behind another app.
  - The image is a JPEG at full backing resolution: 1312×844 px for a 656×422 pt window on a 2× display.
  - It travels as a file URL. The cell emits it as an MCP image **mislabeled `image/png`**, with
    `_meta["codex/imageDetail"]: "original"`.
  - There is no OCR; the model's own vision reads the image.

  (01 §3.1 [V/I]; W2 §4 [V])
- **Coordinates** are in **screenshot pixel space**. The service maps them back to screen points. (W2 §4 [V])
- **Observation discipline** is taught, not enforced: actions return nothing, and the documentation tells the model to
  batch its actions and then observe once. `getScreenshot()` alone may move the diff baseline without the model seeing
  the text. (03 §1.3, §3 [V/I])

## 5. Action

- **Element operations go through AX**: `setValue` and `selectText` set attributes, and secondary actions call
  `AXUIElementPerformAction`. (01 §4 [V strings]; W2: `setValue` replaced a text view's contents [V])
- **Pointer and keyboard** are synthesized events aimed at the target window. CoreGraphics is soft-linked, so it does
  not show in the import table.
  - A focus enforcer and a "focus-steal preventer" keep other apps from taking focus mid-action.
  - A drawn "Lens" cursor shows the agent's position.
  - Key chords use xdotool keysym names, such as `super+s` or `KP_0`.
  - `paste` saves and restores the clipboard, and detects when the user interferes.

  (01 §4 [V/I])
- **Background operation, observed.** An element click, typing, `super+Down`, `super+s` and `super+q` all reached a
  TextEdit window behind Google Chrome. Chrome stayed frontmost the whole time, and the pointer stayed put during the
  click. (W2 §4 [V])
- **Interruption.** Real user input during an action, including Esc on the overlay, yields `userIntervened` (-10016).
  The overlay text and accent colour come from `~/.codex/computer-use/config.json`, which the Desktop writes. (01 §4.1,
  05 §4.1 [V/I]; not exercised)

---

## 6. The consent and safety model, layer by layer

1. **Service-side policy.** It returns `forbidden` for password managers, Keychain Access, Passwords and system security
   processes. `denied` comes from organization policy (`[computer_use]` requirements, fed by the host). In browsers it
   enforces a URL blocklist and detects incognito windows. (01 §5 [V])
2. **Per-app user approval** through MCP form elicitation, on every app operation, persisted three ways:
   - *this conversation*: `$CODEX_HOME/computer-use/sessions/<session_id>.toml`, written by `node_repl` when the call
     carried `x-codex-turn-metadata.session_id` and the reply carried `_meta.persist:"session"` [V, W2 §3];
   - *always*: `…/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`,
     which Desktop settings can list and revoke (05 §4.3 [V]);
   - Desktop also auto-accepts apps the user @-mentioned, once the user has approved any app by hand (05 §5.4 [V]).
3. **Sensitive-action confirmations** (purchases, deletion, messaging, credentials) are **model instructions only**.
   The policy text is `tinysky-alt-confirmations.md`, which the call's `_meta["openai/confirmation_policies"]` can
   replace. Nothing in code classifies actions. (03 §5.1 [V])
4. **The REPL split.** Model-written code runs in a VM under `codex sandbox`, with no `process`, no `eval` and no
   privileged host functions. Policy code runs only in the trusted worker, which loads only from
   `NODE_REPL_TRUSTED_CODE_PATHS`. (04 §5 [V])
5. **The peer gate on the socket** (§7).
6. **A locked Mac.** A root-installed SecurityAgent plugin rewrites `system.login.screensaver`, so the service can
   auto-unlock the Mac during an active computer-use turn. The lock-screen guardian keeps the session visible, and
   physical input pauses the unlock. It is installed on this Mac (plugin 26.812). (02 §2–3 [V])

## 7. The trust gate, and what the live tests showed

**Static picture (01 §2, 02 §1).** The service reads the connecting process's audit token. It builds code-signing
identities for the sender, its parent, its responsible process and its ancestors, and compares them in Swift against
allowlists compiled into the binary:
- teams `2DC432GLL2` (OpenAI) and `HX7739G8FX`, with signing ids `node` and `node_repl` (the "relay");
- team `2DC432GLL2`;
- OpenAI app bundle ids;
- team `MQ55VZLNZQ` with signing id `codex-acp`, which is Zed's Codex adapter.

Failure reasons include `untrustedParent` and `relayWithoutTrustedAncestor`. Both reports concluded that a
non-OpenAI harness would be rejected.

**Live results (W2 §1 [V]):**

| Connecting process | Its parent | Result |
|---|---|---|
| unsigned Python | shell | connection closed without a reply |
| OpenAI `node_repl` | unsigned Node | rejected |
| OpenAI `SkyComputerUseClient mcp` | unsigned Node | `-10000 Sender process is not authenticated` |
| OpenAI `node_repl` | OpenAI `node` running OpenAI's `cua-repl.mjs` | **accepted** |
| OpenAI `node_repl` | OpenAI `node` running **our own** script | **accepted** |

The probes had no OpenAI process anywhere in their ancestry. The effective rule is that both the sender and its
immediate parent must carry an allowlisted signature. OpenAI's signed `node` is a trusted parent whatever JavaScript it
runs, because code signing covers the executable and not the script. So **any MCP host that launches the bundled
launcher exactly as Codex does gets working computer use.** That is how wave 2 drove a complete approve → read → act →
screenshot loop from outside Codex.

What this does not settle:
- The gate is OpenAI's policy, and one release could tighten it, for example to require a Codex ancestor. The Zed
  entry shows OpenAI already allowlists specific third-party harnesses.
- Whether OpenAI's terms allow using these bundled components from another agent is a non-technical question these
  tests cannot answer.

## 8. What a host must provide

Condensed from 06 §1 and updated with wave 2. The "Claude Code 2.1.283" column is verified from its local spec
(`~/claude-code-bundle/2.1.283/SPEC/`) but not yet run.

| Requirement | Why | Codex | Claude Code 2.1.283 |
|---|---|---|---|
| Launch `cua_node/bin/node …/cua-repl.mjs` with the plugin env, outside any sandbox, with a start budget of about 120 s | Trust gate (§7); the service socket | yes | yes. stdio servers run unsandboxed; set `MCP_TIMEOUT` |
| Advertise **form elicitation** and answer `elicitation/create` during a call | Every app operation asks; without the capability, `createElicitation` throws before the persisted-approval check | yes (relays to UI) | yes. Headless: a `control_request` of subtype `elicitation` |
| Send `x-codex-turn-metadata.session_id` in `tools/call._meta` and return `_meta.persist` in the elicitation reply | Otherwise approval never persists, and every app call prompts (W2 §3) | yes | **no**. Needs a small MCP shim between Claude Code and `cua-repl.mjs` to inject both |
| Turn image blocks into model image input, keeping order | Screenshots | yes; images are exempt from the token limit | yes; images count 1,600 tokens each, and a large text block can cut later images |
| Keep `js` directly visible | Tool quality | `omit_tools_from` | set `alwaysLoad: true` (otherwise it is deferred behind ToolSearch) |
| Call hidden `turn_ended` at turn end or interrupt | Releases per-turn state | Stop, SubagentStop and Interrupt hooks | `mcp_tool` hooks on Stop, SubagentStop and StopFailure; there is no interrupt hook, but it sends `notifications/cancelled` |

Two things are **not** requirements, as wave 2 showed. The `js` description is 1,511 characters, and the API document
arrives in the first result, so Claude Code's 2,048-character description cap is harmless. And no "Run JavaScript"
approval is raised without Codex turn metadata.

## 9. Corrections to the layer reports

1. **01 §2.3 and "Portability verdict"; 02 §0 and §1e.** "A Claude Code harness cannot connect / would be rejected" is
   wrong for the launcher route: see §7, W2 §1 rows d and e. The allowlist strings are real. The effective check is on
   the sender and its immediate parent, not on a trusted ancestor.
2. **01 §6.4.** "`SkyComputerUseClient mcp` aborts before `tools/list`" does not reproduce on this build. It lists 10
   tools and fails per call with -10000 under a foreign parent.
3. **04 §4(d) and §6.** "Pre-seeding approval files avoids needing elicitation at all" is wrong. `createElicitation`
   throws before the interceptor runs whenever the client lacks form elicitation
   (`node_repl-embedded/privileged-node-repl.js:69`). Pre-seeding avoids the *prompt*, not the *capability*.
4. **05 §4.2.** The `sessions/*.toml` files are not a dead format. `node_repl` writes them today, keyed by
   `x-codex-turn-metadata.session_id` (W2 §3).
5. **06 open question 3.** The `js` annotations are `readOnlyHint:true, destructiveHint:false, openWorldHint:false`, so
   Codex adds no approval of its own. **06 H3** ("degraded by default" under Claude Code) does not apply in practice
   (§8).
6. **03 §3.** The mislabeled JPEG and the screenshot-pixel coordinate space are now confirmed.
7. **04 §3.** Server info is `rmcp 1.5.0`, the crate default, not `node_repl 0.1.0`.

## 10. Open questions

- The exact trust predicate: are the responsible process and deeper ancestors ever consulted? What are `HX7739G8FX`
  and the `com.openai.atlas`/`com.openai.sky.app` entries?
- What `turn_ended` releases, and what breaks if it never arrives.
- How Esc and the overlay are detected, and how `userIntervened` reaches the model mid-cell.
- Whether a screenshot-only observation moves the diff baseline (03 E6).
- Behavior under a real Claude Code 2.1.283 host: stream-json elicitation, ToolSearch, hooks, and the model's ability
  to use the API.
- The model-gate digests (`NODE_REPL_ENFORCE_MODEL_CHECK`, off in this deployment).
- Stability across ChatGPT updates. The runtime and service are re-copied on every launch, and the service also
  self-updates through Sparkle.

## 11. What this means for MAWS (input for the next discussion, not a decision)

Three routes are now concrete:

- **Host OpenAI's `cua_repl` under Claude Code.** Technically proven from a neutral client. To match Codex's approval
  behavior it needs a thin MCP shim that injects the session metadata and `persist`. Its risks are non-technical
  (OpenAI's terms) and structural (OpenAI can tighten the gate or the protocol, `CodexComputerUseIPC-5`, in any weekly
  release).
- **Delegate GUI work to a Codex agent.** Claude hands a GUI task to Codex through `codex app-server`, as the
  `codex-companion` "amigo" verb already does. This is the sanctioned path, but a GPT model performs the GUI steps.
- **Build MAWS's own controller** with its own TCC identity, using this architecture as the template:
  - an AX-first rendering with stable ids and diffs;
  - per-window ScreenCaptureKit capture;
  - background event targeting;
  - a split REPL that keeps policy on the trusted side;
  - per-app consent through MCP elicitation.

  This is durable and independent. Its hardest part is reliable background input without stealing focus.
