# Wave 1 — Layer 04: `node_repl` and the `cua_repl` MCP surface

> **Correction (2026-09-28, wave 2).**
> - §4(d) and §6 say pre-seeded approval files let a host avoid elicitation "at all". That is wrong: `createElicitation` throws before the interceptor runs whenever the client lacks form elicitation (`node_repl-embedded/privileged-node-repl.js:69`). Pre-seeding avoids the prompt, not the capability.
> - Server info is `rmcp 1.5.0`, not `node_repl 0.1.0`.
> - The §6 "statically yes" conclusion was confirmed live.
>
> See `README.md` §9.

Reverse-engineering of how Codex desktop (ChatGPT.app 26.924.22138, macOS arm64) implements
native computer use, at the `node_repl` / `cua_repl` layer. Read-only static analysis plus live
process/env inspection. Nothing under `/Applications`, `~/.codex`, or `~/Library` was modified;
no sockets were opened; no MCP servers were started.

Purpose for MAWS: decide later whether Claude Code agents can reuse OpenAI's native controller
from another harness or need their own. This report records what is load-bearing and what a
non-OpenAI caller would hit.

## Sources and how to cite them

- Binary: `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl`
  (Mach-O arm64, 17,690,080 bytes, `sha256 10f9b28bf9d63b8a4910dbb55dae5d2b198fc08d00efca25e13d0bc3dfe482b4`).
  Verified: `file`, `shasum`.
- Embedded JS extracted by exact byte range to
  `~/codex-app-src/readable/cua-node-0.0.24/node_repl-embedded/` (prettified) and `.../raw/` (verbatim).
  Byte offsets in `.../node_repl-embedded/EXTRACTION.json`. The prettified copies are byte-identical
  to raw except reflow; cite prettified line numbers.
- Prettified JS packages: `~/codex-app-src/readable/cua-node-0.0.24/node_modules/@oai/{cua-repl,cua,sky,browser-desktop}`.
- Rust symbol/string evidence: cited as `node_repl+<file_offset>` (string) or
  `node_repl@<vaddr>` (function, name from Mach-O symbol table). Symbols are present
  (`nm` shows 6,602 `9node_repl` Rust symbols); function names below are demangled from them, so
  "Verified (symbol)". Control-flow claims are "Verified (disasm)" via
  `llvm-objdump`; semantic interpretations are "Inferred".

---

## 1. Embedded JS extraction (task item 1) — Verified

`node_repl` is a Rust MCP stdio server that carries its Node "kernel" JS as a static file table in
`__TEXT,__const`. There are **two identical copies** of the table (offsets 12428608 and 12436544;
same sha256 per file), likely one per build config; the extractor used the first. Files, in table order:

| file | bytes | role |
|---|---|---|
| `package.json` | 19 | `{"type":"commonjs"}` for the kernel dir |
| `kernel.js` | 56,208 | the untrusted VM kernel (JSONL over stdin/stdout) |
| `diagnostics.js` | 5,195 | source-redaction for error reporting |
| `privileged-node-repl.js` | 19,589 | trusted host bridge (nativePipe, elicitation, fetch, config, launchServices, otel) |
| `privileged-node-repl-config.js` | 7,189 | `nodeRepl.config.*` (Codex TOML) argument validation |
| `realmChecks.js` | 640 | realm-safe ArrayBuffer brand check |
| `meriyah.umd.min.js` | 133,892 | bundled JS parser (meriyah 7.0.0) used to instrument cells |
| `tracing.js` | 6,446 | response-meta OTel span tracer |
| `trusted-worker.js` | 6,935 | the **trusted** Node process entry point |
| `worker-runtime.js` | 12,941 | shared runtime: JSONL transport, `nodeRepl` base bridge, exec state |

All ten were prettified and read in full. Extraction method: located the `{name_ptr,len,content_ptr,len}`
records in the `__const` pointer table and sliced by exact offset+length (not fragmented `strings`).

---

## 2. Process model (task item 2) — Verified

### The chain

`cua-repl.mjs` (`@oai/cua-repl/dist/.../launch.js`) is a thin **launcher**, not the server. It:

1. reads `CUA_REPL_NODE_REPL_PATH` (must be absolute) and `CUA_REPL_ENABLED_SURFACES`
   (`browser`, `computer`, or both; empty/unknown = fatal) — `launch.js:11-36`.
2. loads platform Markdown instructions and assembles a `NODE_REPL_TOOL_OVERRIDES` JSON blob
   (`server_instructions`, per-tool `description` + `field_descriptions` for `js`/`js_reset`) — `launch.js:37-55`.
3. builds `NODE_REPL_TRUSTED_SERVICES` from the enabled surfaces (`browser →
   @oai/browser-desktop/service`, `sky → @oai/sky/service`) unless the caller already set it — `launch.js:39-69`.
4. sets `NODE_REPL_JS_BANNER` to `instructions/banner.js` (`await import("@oai/cua/tinyskyAlt");`)
   unless overridden — `launch.js:70-76`.
5. `spawn(node_repl, [], {stdio:"inherit"})` and forwards SIGINT/SIGTERM/SIGHUP, then mirrors the
   child's exit — `launch.js:56-89`. So `cua-repl.mjs` just decorates the environment and `exec`-style
   proxies `node_repl`; the MCP protocol is spoken by `node_repl` itself over the inherited stdio.

`node_repl` (Rust) is the MCP server. On a `js` call it lazily spawns **two Node child processes**:

- **the kernel** (`kernel.js`) — the untrusted VM host. Launched via `JsRuntimeManager::start_kernel`
  (`node_repl@0x1000e2adc`) using `NODE_REPL_NODE_PATH` Node with `--experimental-vm-modules`, args
  `--session-id <id> --working-dir <cwd>` (`kernel.js:120-160`), env scrubbed (see §5). node ≥ 22.22
  is required (`resolve_node`, string "Node runtime too old for node_repl").
- **the trusted worker** (`trusted-worker.js`) — spawned by `TrustedProcess::start`
  (`node_repl@…trusted_process`), only when `NODE_REPL_TRUSTED_RPC_ENABLED=1`. It hosts the
  privileged services (`@oai/sky/service`, browser service) that the untrusted cell reaches via
  `nodeRepl.rpc(...)`.

The kernel and trusted worker each speak **newline-delimited JSON** to `node_repl` over their own
stdin/stdout (`worker-runtime.js:346-448`; `kernel.js:1862-1872`). `node_repl` is the supervisor
that owns both pipes and brokers every host capability. The kernel never talks to the trusted worker
directly — requests go kernel → `node_repl` → trusted worker and back
(`kernel.js:1586-1607` `requestTrustedWorker`; `trusted-worker.js:224-230`).

### The two live `node_repl` processes (task item 2) — Verified

Both are the same binary but different roles, distinguished by env:

- **pid 17076** — child of `cua-repl.mjs` (17050), which is a child of `codex … app-server` (5488).
  This is the **`unified-computer-use` plugin's `cua_repl` MCP server**. Env has
  `CUA_REPL_ENABLED_SURFACES=browser,computer`, `NODE_REPL_TOOL_OVERRIDES=…`, `NODE_REPL_JS_BANNER=await …`,
  `NODE_REPL_UNTRUSTED_ENV_ALLOWLIST=CUA_REPL_ENABLED_SURFACES,CUA_REPL_BROWSER_ENV`, and
  `NODE_REPL_TRUSTED_SERVICES={"browser":"@oai/browser-desktop/service","sky":"@oai/sky/service"}`.
  Config: `~/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/.mcp.json`.
- **pid 17061** — **direct** child of `codex … app-server` (5488), **no `CUA_REPL_*`**, **no
  `NODE_REPL_JS_BANNER`**. Its env is exactly `~/.codex/config.toml` `[mcp_servers.node_repl]`
  (lines 177-197): `command = .../node_repl`, and `NODE_REPL_TRUSTED_SERVICES` points `browser` at the
  on-disk `.../browser/26.924.22138/scripts/browser-service.mjs` and `sky` at `@oai/sky/service`.

**Answer to "what is the second node_repl":** it is the standalone `node_repl` MCP server declared
directly in `config.toml` (`[mcp_servers.node_repl]`), launched by app-server as a normal MCP server
(not through the `cua-repl.mjs` wrapper and not through the plugin). Because it has no
`NODE_REPL_JS_BANNER`, it does **not** auto-`import("@oai/cua/tinyskyAlt")`; it is the raw JS-execution
host used by Codex "code mode" (app-server was started with `-c features.code_mode_host=true`, and there
is a separate `codex-code-mode-host` helper at `Resources/codex-cli/bin/codex-code-mode-host`, pid
44055). The raw server still has `browser` + `sky` trusted services wired, so code-mode cells can drive
the same surfaces through `nodeRepl.rpc`, just without the cua tool descriptions/banner. The cua_repl
instance (17076) is the human-facing "computer use / browser" tool; 17061 is the general code-mode JS
engine. (Codex code-mode internals are another researcher's scope; this is only what `node_repl`'s host
config shows.) Verified: `ps -Eww` env dumps + `config.toml` + the two `.mcp.json`/`plugin.json` files.

Note: each `app-server` also spawns a `SkyComputerUseClient … computer-history mcp` sibling next to each
`cua-repl.mjs`; that is the history MCP, not part of this layer.

### Kernel REPL semantics — Verified

Each `js` exec compiles as a fresh ESM "cell" (`vm.SourceTextModule`); top-level bindings are carried
to the next cell through a synthetic `@prev` module (`kernel.js:166-171, 1716-1738`). meriyah parses
each cell to (a) rewrite `const`/`let`/`var`/function/class declarations so committed bindings survive
even when a later statement throws (`kernel.js:940-1315`), and (b) produce a **redacted** copy of the
source (identifiers→`idN`, strings→`""`, templates/regex blanked, comments→`/* */`) that is sent to the
host as `exec_redacted_source` for diagnostics (`diagnostics.js:132-201`; `kernel.js:1681-1685`). The
VM context has `codeGeneration.strings=false, wasm=false` (no `eval`/`new Function`/wasm)
(`kernel.js:95-100`). `process` and `node:process` imports are denied (`kernel.js:204-217`); top-level
static imports are rejected — only `await import(...)` (`kernel.js:1735-1737`). `nodeRepl` and `tmpDir`
are locked non-writable globals (`kernel.js:1639-1642`).

---

## 3. The MCP surface (task item 3)

### Server info / initialize — Verified (symbol) / Inferred (values)

`node_repl::mcp_server::NodeReplServer` implements the full rmcp `ServerHandler`: `initialize`,
`get_info`, `list_tools`, `call_tool`, plus `list_resources/templates`, `list_prompts`, `complete`,
tasks, logging, subscribe, etc. (all present as symbols). rmcp is `rmcp-1.5.0`
(`node_repl+10815039`). Supported protocol versions in the binary: `2024-11-05`, `2025-03-26`,
`2025-06-18`, `2025-11-25` (`node_repl+9883800`). `get_info` returns `instructions` and attaches
`_meta` key `codex/sandbox-state-meta` (`node_repl@0x10020867c`, ref `node_repl+9898597`). Server
Implementation name/version are the crate defaults; sentry/otel use `node_repl` / `0.1.0`
(`node_repl+9899508`, `9903947`/`9903971`), so server info is almost certainly `node_repl` `0.1.0`
(Inferred).

`server_instructions`, tool descriptions and `field_descriptions` are overridable via
`NODE_REPL_TOOL_OVERRIDES` (`overrides::ServerAndToolInfoOverrides {server_instructions, tools:{
description, omit, field_descriptions }}`, `node_repl@0x10020867c`/`0x100261210`;
`node_repl+9895341`). The `cua_repl` instance sets `server_instructions` = "UI automation through
cua_repl using the initialized cua API." (`@oai/cua-repl/instructions/server.md`). The **default**
(raw) server instructions are "Use `js` for `node_repl` execution with persistent, redeclarable
top-level bindings, `js_reset` to clear bindings, and `js_add_node_module_dir` to add package
directories." (`node_repl+9894952`). Instruction fragments may also be injected via
`NODE_REPL_INSTRUCTIONS_USE_CASE_{BROWSER,CHROME,COMPUTER_USE}` (`server_instructions_from_env`,
`node_repl@0x100207e8c`; live env shows these set for 17076 to "Control…" strings).

### Tools — Verified (symbol + strings)

Four tools are built in `NodeReplServer::with_server_options…`
(`node_repl@0x100201f8c`, string refs at `node_repl+9894940…9896013`):

- **`js`** — "Execute JavaScript in a persistent `node_repl` with top-level await…"
  (`node_repl+9896643`). Input schema: `code` (string, "JavaScript code to execute with top-level
  await."), `title` (string, "Short user-facing description of what the code does."), `timeout_ms`
  (integer, "Optional execution timeout in milliseconds. Defaults to 30000 (30 seconds) when omitted.",
  `node_repl+9897448`). `additionalProperties:false`. The full assembled description enumerates
  `nodeRepl.write` / `nodeRepl.emitImage` / `nodeRepl.emitAudio` and `nodeRepl.{cwd,homeDir,tmpDir,
  requestMeta}`.
- **`js_reset`** — "Reset the JavaScript kernel and clear all bindings." (`JsResetArgs`, empty schema).
  Runs the banner again with a fresh module cache (`@oai/cua-repl/instructions/reset.md`;
  `kernel.js:1673-1676`). Does not close tabs/apps.
- **`js_add_node_module_dir`** — "Add an absolute `node_modules` directory for package imports. The
  directory remains available after `js_reset`." Arg `path` (`JsAddNodeModuleDirArgs`,
  `node_repl+9896147`; kernel `add_node_module_dir`, `kernel.js:1867-1870`).
- **`turn_ended`** — hidden lifecycle tool: "Notify trusted libraries that a Codex turn ended.
  Repeated notifications for the same session and turn are ignored." (`node_repl+9895898`). Args
  `hook_event_name`, `session_id` (minLength 1), `turn_id` (`trusted_process::TurnEnded`). Marked with
  a `visibility` field and "turn-ended tool metadata" (`node_repl+9896013`) — i.e. flagged hidden so
  it does not surface to the model. See §7.

Enabled/omitted per host config: `cua_repl` enables `["js","js_reset","turn_ended"]` and
`omit_tools_from:["code_mode","deferred"]` (`.mcp.json`). The raw `[mcp_servers.node_repl]` sets no
`enabled_tools`, so it also exposes `js_add_node_module_dir`. **No hidden tools beyond these four** were
found (the enum in `with_server_options` is exactly js/js_reset/js_add_node_module_dir/turn_ended).

### Request metadata → `nodeRepl.requestMeta` — Verified

The host injects per-exec metadata into the kernel `exec` message as `request_meta` (kernel copies it
frozen to `execState.requestMeta`, `worker-runtime.js:360-363`; exposed read-only via
`nodeRepl.requestMeta`, `worker-runtime.js:247-249`). Codex populates it from the request's `_meta`;
`default_request_meta_from_env` reads `NODE_REPL_REQUEST_META` (`node_repl@0x10023ecb8`). The
turn-scoped bits arrive under key `x-codex-turn-metadata` (JSON string with `threadId/turnId/callId`,
also `conversation.id`, `turn.id`, `call_id`; `node_repl+9894653…9894724`,
`turn_metadata_from_request_meta` `node_repl@0x1002069e8`). Sky reads
`nodeRepl.requestMeta["x-codex-turn-metadata"]` to tag approvals with `call_id`/`item_id`
(`@oai/sky/.../mac/computer-use-policy.js:205-223`).

### Result content types — Verified

Kernel `exec_result` carries `output` (stdout/console), `named_outputs`, and `content_items`
(`kernel.js:1761-1768`). Rich content is emitted out-of-band:
- **text**: `nodeRepl.write(value[,itemId])` pushes an output event (`worker-runtime.js:250-265`);
  `nodeRepl.emitContentItem(text)` pushes a content item (`privileged-node-repl.js:574-584`).
- **images**: `await nodeRepl.emitImage(image)` — accepts data:/file: URL, Buffer/Uint8Array/ArrayBuffer,
  or `{bytes,mimeType}`; sniffs PNG/JPEG/WebP; sends `emit_image` and awaits host ack
  (`worker-runtime.js:266-293, 95-180`). The host may attach `_meta:{codex/imageDetail:"original"}` and
  `node_repl` preserves it (`image_content_with_original_detail`, `node_repl@0x100201e1c`).
- **audio**: `await nodeRepl.emitAudio(dataUrl)` — only if `NODE_REPL_ENABLE_AUDIO=1`
  (`worker-runtime.js:295-330`).

Serde message enum `KernelToHost::{ExecResult, TurnEndedResult, ResponseMeta, ResponseMetaTrace,
ExecRedactedSource, OtelLog, …}` (`node_repl+9880187`). Emit acks flow back as
`emit_image_result` / `emit_audio_result` (`node_repl+9879878`).

### Timeouts / `withSuspendedTimeout` — Verified

Default `js` timeout 30000 ms; overridable per call via `timeout_ms`. The host enforces it with a
tokio `timeout` around the exec (`call_tool` closure, `node_repl@0x1000932c0`), returning "js execution
timed out; kernel reset, rerun your request" (`node_repl+9871915`) and resetting the kernel. Cell code
can pause the timer around long native ops with `await nodeRepl.withSuspendedTimeout(fn)`, which sends
`suspend_timeout` before and `resume_timeout` after (`privileged-node-repl.js:424-449`).

---

## 4. Approval / elicitation (task item 4) — Verified (disasm) — **decision-critical**

There are **two distinct elicitation paths**, and both matter for "can another MCP host drive it".

### (a) Strict-auto-review elicitation on the `js` tool itself

In `call_tool` (`node_repl@0x10008ebb4`, disasm), a `js` exec first calls
`strict_auto_review_is_required(self, req)` (`node_repl@0x100206208`):
- if `req` flag `[+0x20]` set (per-turn `node_repl_auto_review_required` from `x-codex-turn-metadata`)
  → required;
- else if `NODE_REPL_DISABLE_STRICT_AUTO_REVIEW=1` (`self+0x38`) → not required;
- else if `NODE_REPL_FORCE_STRICT_AUTO_REVIEW=1` (`self+0x39`) → required;
- else → `node_repl_is_restricted(req)` (model check, below).

When required: if the code is ≤ **64000 bytes** it sends an MCP elicitation whose message is
`"Review JavaScript execution: <code>"` (`node_repl+10816595`,
`src/mcp_server/strict_auto_review.rs`); if > 64000 bytes it hard-errors "JavaScript execution exceeds
the N-byte strict auto-review limit". Before sending, it checks the client's
`supported_elicitation_modes` (rmcp `Peer::supported_elicitation_modes`,
`node_repl@0x10008f550`): **if the client did not advertise the required elicitation mode, the call
fails with "JavaScript execution requires an approval elicitation"** (`node_repl+9364868`, 53-byte
error at `node_repl@0x100090168`). The elicitation response `action` maps `accept`→run,
`decline`/`cancel`→ "JavaScript execution was denied" / "JavaScript execution did not receive approval"
(`node_repl+9365811`, `9365842`).

The elicitation request carries codex approval metadata keys: `codex_request_type`,
`codex_approval_kind="mcp_tool_call"`, `codex_strict_auto_review`, `connector_id="node_repl"`,
`connector_name="Node REPL"`, `tool_name`, `tool_title="Run JavaScript"`, `tool_params`,
`x-codex-turn-metadata`, `callId` (`node_repl+9365636…9365811`).

### (b) Model gate

`model_access_is_restricted(self, req)` (`node_repl@0x100201444`): if `req` flag `[+0x21]`
(`node_repl_disabled` from turn metadata) → true; else if `NODE_REPL_ENFORCE_MODEL_CHECK=1`
(`self+0x3a`) → `node_repl_is_restricted(req)`, else false. `call_tool` raises "node_repl is
unavailable for this model" (`node_repl+9615960`) when this returns true. `node_repl_is_restricted`
(`node_repl@0x100206854`, disasm) takes the model string from the turn metadata and compares
**SHA-256** (`ring::digest`) of its first **6** and **7** characters against two hard-coded 32-byte
digests. The plaintext prefixes were not recovered (deliberately not brute-forced). So model gating is
by a hashed allow/deny prefix, enforced only when `NODE_REPL_ENFORCE_MODEL_CHECK=1`. Env flags also:
`NODE_REPL_DISABLE_STRICT_AUTO_REVIEW`, `NODE_REPL_FORCE_STRICT_AUTO_REVIEW` (`node_repl+9896433…9896503`).

### (c) `nodeRepl.createElicitation` — the computer-use per-app approval

This is the host function trusted service code calls to raise its own approval UI
(`privileged-node-repl.js:65-130`; also `createPrivilegedNodeReplBridge` prop `createElicitation`,
lines 513-520). Schema (validated in JS): `{ message: non-empty string, requestedSchema?: object,
meta?: object }`; extra keys rejected. It sends `{type:"elicit", id, exec_id, message, requested_schema
(default `{type:"object",properties:{}}`), meta}` and resolves to `{action, content, _meta}`
(`privileged-node-repl.js:104-127`). **It throws immediately if `execState.formElicitationSupported`
is false** (`privileged-node-repl.js:69-72`) — that flag is set per exec from the host message field
`form_elicitation_supported` (`worker-runtime.js:353`), which `node_repl` sets from the MCP client's
`elicitation` capability (form mode). Host-side the request is `elicitation/create` /
`notifications/elicitation/complete` with schema variants `FormElicitationParams`/`UrlElicitationParams`
and client capability `FormElicitationCapability`/`UrlElicitationCapability`
(`node_repl+9884810`, `9886499`, `9883426…9883500`). Accepted `action` values: `accept`, `decline`,
`cancel` (`node_repl+9881514`).

Sky's policy layer (`@oai/sky/.../mac/computer-use-policy.js`) calls `createElicitation` **before every
app control**: message `Allow Computer Use to use "<app>"?`, meta
`{codex_approval_kind:"mcp_tool_call", connector_id:"computer-use", connector_name:"Computer Use",
persist:["session"] or ["session","always"], riskLevel, tool_name, tool_params:{app}, ...}`
(lines 35-127); and `Allow Computer Use to record computer audio?` for audio (lines 128-158). It also
throws `Computer Use requires nodeRepl.createElicitation` / `withSuspendedTimeout` if those host
functions are missing (lines 251-256). **Consequence: to drive computer use, the MCP host MUST implement
elicitation** — there is no path around it in sky except pre-persisted approvals (§ below).

### (d) Host-side auto-answer interceptor (short-circuits some elicitations) — Verified

`node_repl` interposes `JsRuntimeManager::handle_elicitation_request` (`node_repl@…`) with a
`ComputerUseElicitationInterceptor` (`node_repl@0x100287ba8` `maybe_auto_answer`, `0x10028e388`
`on_result`). Before forwarding an `elicit` to the MCP client, it inspects the meta
(`computer_use_request_info`, `node_repl@0x10028af7c`) and, for computer-use approvals, checks persisted
approval state and **answers `accept`/`decline` locally without any MCP round-trip**
(`auto_computer_use_result`, `node_repl@0x10028acbc`, returns content `{source:
"computer-use-persisted-state", …}`; sky recognises this marker, computer-use-policy.js:78-86). State
read from:
- `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`
  (`{approvedBundleIdentifiers:[…]}`) — `macos_approvals::{resolve_path,read,persist}`
  (`node_repl@0x10023fab8/…`, `node_repl+9904064`).
- `~/.codex/computer-use/config.toml` with `[apps] allowed=[…]` under scopes `global`/`conversation`,
  plus `~/.codex/computer-use/sessions/<id>.toml` — `computer_use_state_path`/`resolve_computer_use_
  session_state_path` (`node_repl@0x10028ab00/0x10028bf40`, `node_repl+9914308`, `9914192`). On accept
  with `persist:"always"`, `on_result` writes these files. Verified by reading the live files
  (approvals JSON lists finder/ScreenSharing/Xcode/systemuiserver; session TOMLs list per-app allows).

So: for apps the user already approved "always", computer use proceeds with **no** client elicitation;
only first-time apps require the host to answer an `elicitation/create`. A non-Codex host could
pre-seed those files to avoid needing elicitation at all (notable for MAWS).

---

## 5. Trust model and `nodeRepl.*` host functions (task item 5) — Verified

### Two privilege tiers

- **Untrusted kernel** (`kernel.js` via `worker-runtime.js`): gets the **base** `nodeRepl` bridge only:
  `cwd, env, homeDir, tmpDir, requestMeta, write, emitImage`, `+emitAudio` if audio enabled
  (`worker-runtime.js:242-332`). `nodeRepl.rpc(service, request)` is added only if
  `NODE_REPL_TRUSTED_RPC_ENABLED=1` and is the *only* way untrusted code reaches a trusted service
  (`kernel.js:1609-1638`) — it just forwards `trusted_service_request` to `node_repl`, which relays to
  the trusted worker. `nodeRepl` is then frozen (`kernel.js:1639`).
- **Trusted worker** (`trusted-worker.js`): gets the **privileged** bridge
  (`createPrivilegedNodeReplBridge`, `privileged-node-repl.js:373-601`), a frozen object *prototype-
  chained* onto the base bridge, adding: `nativePipe`, `launchServices.openApplication`, `config.*`,
  `createElicitation`, `fetch`, `setResponseMeta`, `emitContentItem`, `withSuspendedTimeout`,
  `addTurnEndedHandler`, `addAfterSubmittedCodeHook`, `otel.log`, `gaasBrowserConfig`, and (if tracing)
  `telemetry`.

### Env / import restrictions

- **Trusted-code path pinning**: the trusted worker registers a module `resolve` hook that rejects any
  `file:` dependency not under `NODE_REPL_TRUSTED_CODE_PATHS` (colon-joined, realpath-canonicalised) —
  `trusted-worker.js:24-60`. Trusted services must resolve within `NODE_REPL_NODE_MODULE_DIRS`
  (`resolveTrustedService`, `trusted-worker.js:102-133`) and must `export handleRpc`
  (`trusted-worker.js:135-153`). Live values: `NODE_REPL_TRUSTED_CODE_PATHS=/Users/new/.codex:.../cua_node/lib/node_modules`.
- **Kernel import restrictions**: only bare packages resolvable within the configured
  `node_modules` roots, or relative/absolute/`file:` `.js`/`.mjs` paths; directory imports rejected;
  `process` denied; escapes via parent `node_modules` ignored (`kernel.js:387-592`).
- **Env scrubbing** (`start_kernel`, `node_repl@0x1000e2adc`, strings `node_repl+…`): the spawned kernel
  gets a curated env — it **strips** `NODE_OPTIONS, NODE_PATH, LD_PRELOAD, LD_LIBRARY_PATH,
  DYLD_INSERT_LIBRARIES, BROWSER_USE_SECURITY_MODE` and passes only an allowlist
  (`HOME, LANG, LC_ALL, LC_CTYPE, PATH, TMPDIR, TMP, CODEX_HOME, NODE_REPL_ENABLE_AUDIO,
  NODE_REPL_JS_BANNER, NODE_REPL_UNTRUSTED_ENV_ALLOWLIST, NODE_REPL_TRUSTED_RPC_ENABLED, SYSTEMROOT,
  USERPROFILE, WINDIR, …`). Cell code sees only the frozen subset named by
  `NODE_REPL_UNTRUSTED_ENV_ALLOWLIST` (`kernel.js:225-263`), which the launcher sets to
  `CUA_REPL_ENABLED_SURFACES,CUA_REPL_BROWSER_ENV`. The trusted worker, by contrast, sees the full
  process env (`trusted-worker.js:62-68`).
- **Sandbox**: `SandboxConfig::from_process_env` reads `CODEX_CLI_PATH`, `NODE_REPL_DENIED_PATHS`,
  `NODE_REPL_SANDBOX_ALLOWED_UNIX_SOCKETS` (`node_repl@0x100275440`). `build_command_spec`
  (`node_repl@0x100275c44`) wraps the kernel launch under Codex's own sandbox (seatbelt) when
  `CODEX_CLI_PATH` is set, passing `--allow-unix-socket` (for the CUA socket) and
  `--experimental-vm-modules`. The `--disable-sandbox` CLI flag "Start the Node kernel directly even
  when CODEX_CLI_PATH is set" exists (`node_repl --help`), but "the node_repl sandbox with denied paths
  cannot be disabled" and "the gaas-browser node_repl sandbox cannot be disabled" (`node_repl+9896532`,
  `9912741`).

### `nodeRepl.config.*` — does it write Codex's config.toml? — Verified: **guarded no/limited yes**

`nodeRepl.config` (`privileged-node-repl-config.js`) offers `readToml, writeToml, read,
readRequirements, writeValue, batchWrite`, backed by host `ConfigAction::{ReadToml, WriteToml,
ReadConfig, WriteConfigValue, BatchWriteConfig}` (`config_manager`, `node_repl@…`). It **does** write
Codex TOML under `CODEX_HOME` (`~/.codex`), but:
- `writeToml` **refuses** `config.toml` outright — "does not allow writing ~/.codex/config.toml; use
  nodeRepl.config.writeValue or nodeRepl.config.batchWrite" (`privileged-node-repl-config.js:12-20`;
  host echo `node_repl+9902033`). Path must be relative, `.toml`, no `..`/symlink ancestors
  (`config_manager::validate_toml_*`, `node_repl+9902193…9902435`).
- `writeValue`/`batchWrite` do targeted key-path edits with optimistic `expectedVersion` and
  merge strategy `upsert`/`replace` (`privileged-node-repl-config.js:179-240`), and `batchWrite` can
  `reloadUserConfig`. So structured edits to Codex config are allowed; wholesale `config.toml`
  replacement is not. This is how computer-use persists app approvals into `computer-use/config.toml`
  (not the main config).

### Other host functions

- `nodeRepl.fetch(input, init)` = `authenticated_fetch` (`privileged-node-repl.js:132-195`). Sends the
  request to the host, which injects OpenAI auth: `authorization` bearer, `originator: codex_browser_use`,
  `ChatGPT-Account-ID` (`outbound_authenticated_request`, `node_repl@0x100278628`,
  `node_repl+9913159/9913176`). Auth token/account come from a **codex app-server** child that
  `node_repl` spawns (`CodexAppServerConnection::spawn`, `node_repl@0x100206238`, using
  `CODEX_CLI_PATH`; `codex_app_server_auth`, claim endpoint `https://api.openai.com/auth`). In
  gaas-browser mode certain routes are GET-only / no caller headers/body (`resolved_request`,
  `node_repl+9912912…9913104`).
- `nodeRepl.launchServices.openApplication({applicationPath|bundleIdentifier})`
  (`privileged-node-repl.js:455-473`, `launch_services::launch_args` `node_repl@0x100254864`) — used by
  sky to cold-start the SkyComputerUseService via `/usr/bin/open` (`node_repl+9619198`).
- `nodeRepl.setResponseMeta(obj)` → `response_meta` message (`privileged-node-repl.js:529-548`); sky
  sets `codex/toolSurface`/`codex/computerUseChrome` (computer-use-policy.js:187-204).
- `nodeRepl.otel.log(name, attrs)` → `otel_log` (`privileged-node-repl.js:556-573`); host exports OTLP.
- `nodeRepl.addTurnEndedHandler` / `addAfterSubmittedCodeHook` — lifecycle hooks (§7).
- `nodeRepl.gaasBrowserConfig` — per-exec GAAS browser config (frozen, `privileged-node-repl.js:488-494`).

---

## 6. `nativePipe` and can a non-Codex host drive it (task item 6)

### `nativePipe` mechanics — Verified (disasm)

`nodeRepl.nativePipe.createConnection(path)` (`privileged-node-repl.js:200-333`) does **not** pass a
file descriptor and does **not** open the socket in the Node process. It sends
`{type:"native_pipe_request", op:"connect", path}` to `node_repl`; the Rust
`NativePipeBroker` (`node_repl@0x100248464`) validates the path (`validate_native_pipe_path`: absolute,
is a socket — `node_repl@0x10024efe8`) and **opens the unix socket itself** via
`socket2::Socket::new` + `set_nonblocking` + `connect(unix_sockaddr)`
(`start_macos_native_pipe_connect`, `node_repl@0x10024f4f8`, disasm shows `Socket::new`/`connect`
calls). Bytes then flow: kernel/worker → `node_repl` (`op:"write"`, base64) → socket; socket →
`node_repl` → `native_pipe_data` (base64) → listeners (`privileged-node-repl.js:278-368`). Connect
timeout from `NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS` (live: 1000). The socket path defaults to
`~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock` (chosen by
sky, `@oai/sky/.../mac/native-pipe.js:24-39`); sky also supports a `NODE_REPL_HOST_SERVICES_PIPE_PATH`
`ensureService` handshake and a `launchServices.openApplication` cold-start fallback (native-pipe.js:44-207).

**So the socket peer the SkyComputerUseService sees is `node_repl` itself**, not the Node kernel and not
`cua-repl.mjs`. This is the load-bearing identity.

### Code signature / entitlements — Verified

`node_repl`: Developer ID Application "OpenAI OpCo, LLC (2DC432GLL2)", hardened runtime
(`flags=0x10000(runtime)`), Runtime Version 11.3.0, designated requirement
`identifier "node_repl" and anchor apple generic and … leaf[subject.OU]="2DC432GLL2"`. Entitlements
include `com.apple.security.application-groups = [2DC432GLL2.com.openai.codex.notifications,
2DC432GLL2.com.openai.sky.CUAService]`, `com.apple.security.automation.apple-events=true`,
`cs.allow-jit=true`, `cs.allow-unsigned-executable-memory=true`, device audio/camera, calendars, etc.
The bundled `node` has the identical entitlement set. (Verified: `codesign -dvvv`, `-d --entitlements`,
`-r-`.) The socket lives inside the `2DC432GLL2.com.openai.sky.CUAService` group container
(`~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`, mode `srw-------`).

### Does `node_repl` verify its parent/caller? — Verified: **no explicit parent check found**

No code was found where `node_repl` checks that its parent is `codex`/`cua-repl.mjs` or validates a
caller signature. It trusts its **environment** (`NODE_REPL_TRUSTED_SERVICES`, `TRUSTED_CODE_PATHS`,
`NODE_PATH`, `CODEX_CLI_PATH`) and its own hardened-runtime signature. The access control is delegated:
(a) the sandbox wraps the *kernel*, (b) the CUA socket lives in an OS-enforced app-group container that
only processes with the `2DC432GLL2.com.openai.sky.CUAService` group entitlement can open, and (c) the
SkyComputerUseService (other researcher's scope) presumably authorises its peer by that entitlement /
team id — and the peer is always the genuine, OpenAI-signed `node_repl`.

### Could a non-Codex MCP host spawn `cua-repl.mjs`/`node_repl` and get working computer use? — Inferred

**Yes, statically it appears possible**, because the gatekeeping is the socket peer's *signature*, and
that peer is the unmodified OpenAI-signed `node_repl` regardless of who its parent is. A third-party MCP
host that (1) runs the bundled `node` + `node_repl` binaries unmodified, (2) supplies the same env
(`CUA_REPL_*` via `cua-repl.mjs`, or `NODE_REPL_TRUSTED_SERVICES={sky:@oai/sky/service}`,
`NODE_REPL_TRUSTED_CODE_PATHS` including the cua_node `node_modules`, `NODE_REPL_NODE_PATH`,
`NODE_REPL_TRUSTED_RPC_ENABLED=1`), and (3) implements MCP **elicitation**, would have the genuine
`node_repl` open the CUA socket as a signed, entitled peer.

**Likely blockers / requirements** a non-OpenAI caller runs into:
1. **Elicitation is mandatory for computer use.** Sky calls `nodeRepl.createElicitation` before each
   app control and throws if the client lacks form-elicitation capability. The host must implement
   `elicitation/create` and respond `{action:"accept"}` — or pre-seed the approval files (§4d) so the
   interceptor auto-answers. Plain MCP hosts without elicitation cannot drive it (and, if strict
   auto-review is triggered, cannot even run `js`).
2. **Model gate**: if `NODE_REPL_ENFORCE_MODEL_CHECK=1`, the model string in `x-codex-turn-metadata`
   must satisfy the hashed-prefix check, and `node_repl_disabled` must be unset, or every call returns
   "node_repl is unavailable for this model." Off by default in the observed config (env does not set
   it), but this is a switch OpenAI can flip.
3. **You cannot substitute your own binary.** The socket peer must be the OpenAI-signed `node_repl`;
   the service almost certainly authorises by team/app-group. `node_repl` scrubs
   `DYLD_INSERT_LIBRARIES`/`NODE_OPTIONS` and is hardened-runtime + JIT-only, so you cannot inject into
   it or fake its identity. A clean-room reimplementation would be rejected at the socket.
4. **Auth/app-server dependency for browser + `nodeRepl.fetch`.** Those spawn a `codex` app-server
   child (`CODEX_CLI_PATH`) and inject ChatGPT auth; they need a logged-in Codex. Pure local
   computer-use (sky over the CUA socket) appears not to need auth, only the running SkyComputerUseService.
5. **The service must be installed and running** (`~/.codex/computer-use/Codex Computer Use.app`
   /`SkyComputerUseService`), and macOS TCC/accessibility grants must exist.
6. **Node ≥ 22.22** and the exact `cua_node` `node_modules` layout for `@oai/sky/service` to resolve
   within a trusted code path.

Net: the controller is reusable in principle from another harness *only by shelling out to OpenAI's
own signed `node_repl` + `@oai/sky` stack and speaking MCP-with-elicitation to it* — not by
reimplementing the socket client. For MAWS this means "reuse OpenAI's native controller" = "orchestrate
the genuine `node_repl` binary as a subprocess", with the elicitation and (optional) model-gate
constraints above. Building an independent controller for Claude Code agents would require replicating
the Swift service side, which is out of reach given the app-group/signature gate.

---

## 7. `turn_ended` (task item 7) — Verified

`turn_ended` is a hidden MCP tool (`visibility` metadata, not shown to the model) taking
`{hook_event_name, session_id, turn_id}` (`trusted_process::TurnEnded`). It requires all three
non-empty ("turn_ended requires non-empty event, session, and turn IDs", `node_repl+9615900`). On
receipt, `node_repl` forwards a `turn_ended` message to the trusted worker (only meaningful when
`NODE_REPL_TRUSTED_RPC_ENABLED=1`), which runs all registered `turnEndedHandlers` concurrently over the
frozen event and replies `turn_ended_result` (`trusted-worker.js:197-209`;
`privileged-node-repl.js:633-671`, handlers are `createLifecycleHandlers(…, concurrent=true)`). Repeated
notifications for the same session/turn are ignored (dedup, per the tool description). Handlers are
best-effort with a per-handler `timeoutMs` (`privileged-node-repl.js:14-54`); the host bounds the whole
thing ("turn-ended handlers timed out" / "turn-ended response channel closed", `node_repl+9365887/9365921`).

It is wired to **Stop, Interrupt, SubagentStop** hooks (`plugin.json` of both the
`unified-computer-use` and `browser` plugins) so that trusted libraries get a **cleanup / teardown
signal at every turn boundary**: end of a normal turn (Stop), user interruption (Interrupt), and
subagent completion (SubagentStop, keyed on `agent_id`). This lets sky/browser flush state, release the
CUA session, stop audio recording, etc., deterministically when a Codex turn ends — rather than relying
on GC or process exit. It is separate from the `notify = [… "turn-ended"]` in `config.toml`, which is the
SkyComputerUseClient's own notification channel.

There is also `addAfterSubmittedCodeHook` (`run_hooks` → `afterSubmittedCodeHooks`, sequential) which
fires after each submitted cell completes (`kernel.js:1571-1584`, `trusted-worker.js:211-218`) — the
per-exec analogue of the per-turn `turn_ended`.

---

## Open questions and proposed wave-2 experiments

**Open questions**
1. The two SHA-256 model-prefix digests in `node_repl_is_restricted` (6-char and 7-char). Not
   brute-forced. Determines which models are gated when `NODE_REPL_ENFORCE_MODEL_CHECK=1`, and whether
   "restricted" means allowed or blocked. (Digests: 6-char
   `b3011a26…fd006ac0`, 7-char `0bf89f91…8484556a`, little-endian qwords in
   `node_repl@0x1002068d8/0x100206970`.)
2. Whether SkyComputerUseService actually enforces peer team-id/app-group on `computeruse.sock`
   accept, or relies only on container ACLs. Swift side is another researcher's scope; confirm with them.
3. Exact server Implementation `name`/`version` in `initialize`/`get_info` (Inferred `node_repl`/`0.1.0`).
4. Whether `code_mode` (the raw `[mcp_servers.node_repl]`, pid 17061) ever drives computer use in
   practice, or only browser/code — coordinate with the Codex-CLI researcher on `code_mode_host`.

**Proposed experiments (design only — not run this wave)**
1. **MCP handshake from a non-Codex parent.** Spawn `node_repl` directly with the observed env
   (copy `[mcp_servers.node_repl].env`, set `NODE_REPL_TRUSTED_RPC_ENABLED=1`), speak MCP over stdio:
   `initialize` (advertise `elicitation` capability with form mode) → `tools/list`. Expect
   js/js_reset/js_add_node_module_dir/turn_ended. Confirms server info, capabilities, and that a
   non-Codex parent is accepted.
2. **`js` with vs without elicitation.** From that harness, call `js` with trivial code both (a)
   advertising elicitation and (b) not, with `NODE_REPL_FORCE_STRICT_AUTO_REVIEW=1` set, to confirm the
   "requires an approval elicitation" failure vs the "Review JavaScript execution:" prompt, and the
   64000-byte limit.
3. **Computer-use reachability.** With `banner.js` importing `@oai/cua/tinyskyAlt` (or a direct
   `nodeRepl.rpc("sky", …)`), attempt one `cua.getState()` while auto-accepting elicitations, to see
   whether the genuine `node_repl` connects to `computeruse.sock` from a non-Codex parent and whether
   the service accepts it. This is the decisive test for "reuse from another harness"; do it in a
   disposable VM/account.
4. **Pre-seeded approvals.** Add a test bundle id to `~/.codex/computer-use/config.toml [apps] allowed`
   and `ComputerUseAppApprovals.json`, then verify the interceptor auto-answers (no client elicitation).
5. **Model gate.** Vary the `model` field in `x-codex-turn-metadata` with
   `NODE_REPL_ENFORCE_MODEL_CHECK=1` to map which model strings pass — and thereby recover the hashed
   prefixes empirically.

## Extracted-source index

`~/codex-app-src/readable/cua-node-0.0.24/node_repl-embedded/` — prettified `kernel.js`,
`worker-runtime.js`, `privileged-node-repl.js`, `privileged-node-repl-config.js`, `trusted-worker.js`,
`tracing.js`, `diagnostics.js`, `realmChecks.js`, `package.json`; `raw/` holds verbatim copies plus
`meriyah.umd.min.js`; `EXTRACTION.json` records binary path, table offsets, per-file offset/length/sha256.
Launcher/instructions/plugin: `~/codex-app-src/readable/cua-node-0.0.24/node_modules/@oai/cua-repl/`.
