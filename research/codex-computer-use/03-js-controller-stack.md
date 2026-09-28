# 03: The JS controller stack (`@oai/cua` tinyskyAlt and `@oai/sky` mac target)

Researcher 3 of 6, wave 1, static analysis only. Target: ChatGPT.app 26.924.22138 (macOS), `cua_node` 0.0.24, containing `@oai/cua` 0.2.5, `@oai/sky` 0.7.4 and `@oai/cua-repl` 0.1.0. I confirmed that the prettified snapshot matches the installed originals: `targets/mac/client.js` re-prettified byte-identical, and `tinysky-alt-confirmations.md` is identical.

## Conventions

- Paths are relative to `~/codex-app-src/readable/cua-node-0.0.24/node_modules/@oai/`, with these abbreviations:
  - `alt/` = `cua/dist/lib/js/oai_js_cua/src/tinysky_alt/`
  - `cuasrc/` = `cua/dist/lib/js/oai_js_cua/src/`
  - `skysrc/` = `sky/dist/project/cua/sky_js/src/`
  - `mac/` = `sky/dist/project/cua/sky_js/src/targets/mac/`
  - `docs/` = `cua/docs/`
  - `repl/` = `cua-repl/`
- `NR:<n>` refers to line *n* of `strings -n 1 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl`. The node_repl binary embeds its `kernel.js`, `privileged-node-repl.js`, `trusted-worker.js` and `worker-runtime.js` as plain JS source, and the NR line numbers point at the first of its two identical copies. node_repl internals belong to another researcher; I cite them only where they decide something about this layer's boundary.
- `SVC:` marks a string in `~/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService`. These are pointers for the Swift researcher, not claims about Swift behavior.
- **[V]** means verified by reading the cited code. **[I]** means inferred and not yet exercised live. Nothing in this wave touched the socket, ran a REPL or drove the GUI.

---

## 0. Key findings

1. **The JS layer is a thin, replaceable veneer.** For macOS it is about 700 lines. On the *cell* side (untrusted kernel) it:
   - shapes the arguments;
   - emits documentation and state;
   - reads screenshot files and emits them as images.

   On the *trusted-worker* side (`@oai/sky/service`) it:
   - runs a per-call app-policy and consent flow;
   - encodes 7 request types as Swift-enum JSON;
   - speaks length-prefixed JSON-RPC over the socket.

   All the computer-use intelligence lives in the Swift service: AX extraction and indexing, diffing, UI-settle waits, capture, coordinate mapping, input synthesis, clipboard handling, and app resolution and launch. [V: §2, §7]
2. **Per-app user consent is enforced on the client side, not visibly by the service.** Before *every* app call, including `get_app_state`, the worker:
   - sends `ComputerUseIPCAppPolicyRequest`;
   - issues `nodeRepl.createElicitation`, which node_repl's Rust interceptor auto-answers from persisted approvals;
   - rewrites `app` to the service-resolved `appPath`.

   Sensitive-action confirmations such as purchases, deletion and messaging are **prompt-only**: a model-facing policy document that `requestMeta` can override. [V: `mac/computer-use-policy.js:11-126`, `alt/create_documentation.js:20-49`]
3. **Hard dependency on form elicitation.** If the MCP client does not advertise form elicitation, every mac app operation except `listApps` fails. The JS check runs before the persisted-approval interceptor can help. [V: `mac/computer-use-policy.js:15,46`; NR:62382-62390]
4. **Error codes do not survive the trusted-RPC boundary.** The model sees only `error.message`, never `ServerErrorCode`. [V: NR:65705-65712, NR:61874-61876]
5. **The socket is opened by node_repl's Rust process, not by Node.** `nativePipe` is a bridge (NR:62514-62660). Service strings show peer authentication by audit token, team ID and executable name, possibly including the ancestor chain (SVC: `LOCAL_PEERTOKEN`, `teamIdentifiers`, `executableNames`, `senderAncestorIdentities`, and an allowlist-like cluster `2DC432GLL2`, `MQ55VZLNZQ`, `HX7739G8FX`, `node`, `node_repl`, `codex-acp`). A thin client in another language would therefore likely be rejected with `senderProcessNotAuthenticated` (-10000). [I, pending the Swift researcher and E3]
6. **The JS layer uses 7 of about 45 IPC request types.** The service also carries Messages, Skysight, EventStream, capture-stream, AppModify, Permission and other families that this JS version never calls. [V: `mac/client.js:4-10`; SVC name list, §8]

---

## 1. The model-facing API

### 1.1 How the API and its text reach the model

| Stage | What is injected | Where |
|---|---|---|
| MCP tool description (`js`) | `description.md` + `browser.md` (or `browser-disabled.md`) + `computer.md` (or `computer-disabled.md`) + `output.md`, joined with blank lines. Also sets server instructions `server.md`, the field description `code.md` and the `js_reset` description `reset.md`. All of it is passed to node_repl as `NODE_REPL_TOOL_OVERRIDES`. | `repl/dist/lib/js/oai_js_cua_repl/src/launch.js:37-55,77`; `…/instructions.js:7-22`; `repl/instructions/macos/*.md` [V] |
| Banner | `await import("@oai/cua/tinyskyAlt");`, prepended to the **first** cell of each REPL session (and again after `js_reset`). | `repl/instructions/banner.js:1`; `launch.js:70-76`; NR:61947 [V] |
| First tool result, item `cua.core` | The core API document `docs/tinysky-alt-core-cua-repl.md` followed by the confirmations policy (`docs/tinysky-alt-confirmations.md`, or an override from `requestMeta`). Emitted at import time by `create_tinysky_alt` via `emit()` with no state. | `alt/create_tinysky_alt.js:15-23`; `alt/create_bootstrap_emitter.js:35-60`; `alt/create_documentation.js:14-49` [V] |
| Per-browser first use, item `cua.browser.<id>` | Browser documentation plus `other-browser-apis`. Browser-only; out of scope. | `alt/create_bootstrap_emitter.js:42-57` [V] |
| Each observation, item `cua.state` | AX text, JSON inventory, or (for images) an `emitImage` call. | `cuasrc/core/display.js:2-26` [V] |
| Once per app per worker lifetime | `<app_specific_instructions>\n…\n</app_specific_instructions>\n` prepended to the AX text when the service returns `appSpecificInstructions`. Suppressed permanently for `com.apple.iWork.Numbers`. | `mac/window_result.js:2,24-51` [V] |
| After context compaction | `cua.rewriteDocumentation()` re-emits `cua.core` and each `cua.browser.*` item, skipping any already emitted within the same exec, as detected by the `requestMeta` object identity. `output.md` tells the model to call it when "your context begins with a summary". | `alt/create_bootstrap_emitter.js:62-71`; `repl/instructions/macos/output.md:3` [V] |

Two details about how documents are selected:

- The document variant is chosen by `nodeRepl.env.TINYSKY_ALT_INITIALIZE_DOCS` (default `core-cua-repl`; the alternative is `core-node-repl`). The cell only sees env vars on `NODE_REPL_UNTRUSTED_ENV_ALLOWLIST`, and cua-repl adds only `CUA_REPL_ENABLED_SURFACES` and `CUA_REPL_BROWSER_ENV` (`launch.js:59-65`; NR:60627). So this deployment always uses `core-cua-repl`. [V]
- The confirmations text can be replaced per request by `requestMeta["openai/confirmation_policies"].computer_use`: a non-empty string of at most 12,000 bytes. It is skipped entirely when `CUA_REPL_BROWSER_ENV=orbit` (`alt/create_documentation.js:20-49`) [V]. Who sets that meta key is not visible from this layer; it could be codex app-server or the backend. [I]

`nodeRepl.write(text, itemId)` tags every emission with a content-item ID (`cua.core`, `cua.browser.<id>`, `cua.state`) (NR:65985 `write(value, itemId)`). What the host does with item IDs, for example replacing or deduplicating docs, is outside this layer. [V for the tagging; I for the purpose]

### 1.2 The `cua` global on macOS (both surfaces enabled)

`cuasrc/tinysky_alt/globals.js:3-23` requires `CUA_REPL_ENABLED_SURFACES` (values `browser` and/or `computer`), builds the object and sets `globalThis.cua`, with `initialize` as an alias of `getState`. With the browser surface on, it also sets `globalThis.agent` (`alt/create_tinysky_alt.js:38`). [V]

| Member | Behavior on mac | Evidence |
|---|---|---|
| `getState(opts?)` / `initialize()` | Runs `computer.list_apps()` and browser inventory under `Promise.allSettled`. Returns `{apps, browsers, errors?}` and emits JSON to `cua.state` unless `emit:false`. | `alt/create_tinysky_alt.js:26-34`; `cuasrc/get_state.js:4-21` [V] |
| `listApps(opts?)` | `sky.list_apps()`: array of AppInfo, emitted as JSON. | `alt/create_tinysky_alt.js:43-48`; `cuasrc/get_apps.js:8-9` [V] |
| `getApp(name: string)` | Rejects anything that is not a string. Calls `get_app_state({app, disableDiff:true})`, emits the full AX text, and returns an App handle bound to the **service-resolved** `app` (see §5.1). No screenshot is emitted. | `alt/create_tinysky_alt.js:53-69` [V] |
| `computer` | The raw `sky` proxy (§1.4), with `target:"mac"`. The documented `launch_app?` is **absent** on mac. | `mac/create_client.js:21-43`; `docs/tinysky-alt-core-cua-repl.md:126-129` [V] |
| `rewriteDocumentation()` | See §1.1. | [V] |
| Browser members (`browsers`, `getBrowser`, `createBrowserTab`, `getTab`, `listBrowsers`, `listTabs`) | These go through `nodeRepl.rpc("browser", …)` to `@oai/browser-desktop/service` and never touch Sky. | `alt/create_browser_api.js`; `cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.js:8237-8276` [V] |
| `listWindows` | Linux and Windows only. | `alt/create_tinysky_alt.js:83-106` [V] |

### 1.3 The mac App handle (`alt/bind_mac_app.js:4-80`)

The public signatures come from `alt/types.d.ts:66-89` and the docs at `docs/tinysky-alt-core-cua-repl.md:29-60`.

| Method | Sky call (snake_case, sent through RPC) | Emits | Returns |
|---|---|---|---|
| `getAXState({disableDiffing?, emit?})` | `get_app_state({app, disableDiff?})` | AX text, to `cua.state` | the text |
| `getScreenshot({emit?})` | `get_app_state({app})`. **No `disableDiff`**, so the AX text is discarded (see §3). | image, declared `image/png` | `Uint8Array` |
| `getAXStateAndScreenshot(opts)` | one `get_app_state({app, disableDiff?})` | text, then the image from **the same capture** | `{state, screenshot?}` |
| `click(target: number \| [x,y], {mouseButton?, clickCount?})` | `click({app, element_index \| x,y, mouse_button?, click_count?})` | none | void |
| `drag([x1,y1],[x2,y2])` | `drag({app, from_x, from_y, to_x, to_y})` | none | void |
| `scroll(target, direction, pages?)` | `scroll({app, direction, element_index \| x,y, pages?})`. An object distance throws "macOS scroll accepts pages, not pixels." | none | void |
| `selectText(idx, text, {prefix?, suffix?, selectionType?})` | `select_text({app, element_index, text, prefix?, suffix?, selection_type?})` | none | void |
| `setValue(idx, value)` | `set_value({app, element_index, value})` | none | void |
| `performSecondaryAction(idx, action)` | `perform_secondary_action({app, element_index, action})` | none | void |
| `typeText(text)` | `type_text({app, text})`, typed at the current focus with no index | none | void |
| `pressKey(key)` | `press_key({app, key})`, using xdotool-style names such as `super+c` or `KP_0` | none | void |
| `paste(text, {format?="text"})` | `paste({app, text, format})`. The service saves and restores the clipboard. | none | void |

All rows above are verified. The clipboard behavior comes from `docs/tinysky-alt-core-cua-repl.md:198` and is a service claim that is **not** implemented in JS.

**Actions return nothing.** The model is told to batch its actions and then call `getAXState()` in the same cell (`docs/tinysky-alt-core-cua-repl.md:163-185`). Settle waits happen in the service:

- "about 1 second, with additional delays of up to 5 seconds" (`sky/docs/skills/oai_sky_lib/macos/SKILL.md:112`);
- SVC `needsUISettleBeforeSkyshot`.

[V for the docs; I that the service implements it as described]

### 1.4 The raw `sky` proxy in the cell (`skysrc/sky.js`)

At import time, top-level `await nodeRepl.rpc("sky", {type:"setup"})` returns `{target, methods}` (`skysrc/sky.js:7-12`; `skysrc/service.js:16-21`). The proxy then exposes one stub per method that sends `{type:"execute", method, args}` (`skysrc/sky.js:44-50,66-90`). The method list on mac is `list_apps, get_app_state, click, drag, paste, perform_secondary_action, press_key, scroll, select_text, set_value, type_text`, plus `start_audio_recording` and `stop_audio_recording` only when the **worker's** `process.env.SKY_ENABLE_AUDIO === "1"` (`mac/create_client.js:21-43`). The Codex plugin env does not set it (`~/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/.mcp.json`), so audio is off. [V]

If setup failed, any member missing from the proxy resolves to a function that rejects with the setup error (`skysrc/sky.js:17-23`). [V]

The model can call `cua.computer.click({app, x, y})` directly and bypass the handle. That path runs the same trusted-worker policy, so it is not a bypass. [V]

---

## 2. The mac target, operation by operation

### 2.1 Pipeline per call

```
cell: app.click(42)                                   alt/bind_mac_app.js:38-48
  └ cua.computer.click({app, element_index:42})       skysrc/sky.js:48 (rpc "sky" execute)
    └ kernel requestTrustedWorker → Rust → trusted worker          NR:61866-61910, 65716+
      └ handleRpc({type:"execute", method:"click", args:[…]})      skysrc/service.js:23-47
        └ mac/click.js:4-19 → withComputerUsePolicy("click", input, act)
            1. setResponseMeta(codex/toolSurface app:null)        policy.js:13,187-204
            2. ComputerUseIPCAppPolicyRequest {app}               policy.js:17-18; client.js:32-34
            3. decision gate (denied/forbidden throw)             policy.js:20-34
            4. nodeRepl.createElicitation(app approval)           policy.js:35-123
            5. input frozen, app := target.appPath ?? app         policy.js:124,224-250
            6. telemetry(withSuspendedTimeout(act(input)))        policy.js:125,159-186
               └ MacComputerUseClient.click → performAction       client.js:51-65,143-149
                 └ request("ComputerUseIPCAppPerformActionRequest", {app, action:{click:{…}}})
                   └ MacNativePipeTransport.request → frame → Rust nativePipe bridge → socket
```

`list_apps` skips steps 2 to 5 and the timeout suspension, and wraps only telemetry (`mac/list_apps.js:7-13`). The audio operations run their own approval (§5.3). [V]

Every app operation therefore makes **two** socket round trips (policy, then action) and **one** host round trip (elicitation). [V]

### 2.2 Wire envelope

The socket path defaults to `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock` and can be overridden with `nodeRepl.env.SKY_CUA_SERVICE_NATIVE_PIPE_PATH` (`mac/native-pipe.js:24-39`). The Electron bundle forwards that variable only in Dev builds (`app.asar` grep). On disk the socket is `srw-------` (0600) inside a 0700 group container. [V]

- **Framing.** Each frame is a 4-byte little-endian length followed by UTF-8 JSON. The maximum frame is 8,388,608 bytes, enforced both ways as a `SkyComputerUseTransportError` (`mac/native-pipe.js:16,328-347`). [V]
- **JSON-RPC 2.0.** Request IDs are integers starting at 1 per connection; `ensureService` uses ID 0 on a separate connection (`mac/native-pipe.js:257,424,151-155`). A response must have a numeric `id`, `jsonrpc:"2.0"`, and exactly one of `result` or `error{code:number, message:string}`; anything else is a transport error (`mac/native-pipe.js:353-382`). [V]
- **`ping`.** Params are `{clientApiVersion}`. The result must be `{serverApiVersion}` equal to the client version, or the client throws "API version mismatch" (`mac/native-pipe.js:313-326`). [V]
- **`request`.** Params are, in this key order:

  ```
  {clientApiVersion, codexTurnMetadata, deadlineUnixMilliseconds, request, requestType}
  ```

  (`mac/native-pipe.js:282-297`)
  - `clientApiVersion` defaults to `"CodexComputerUseIPC-5"` (`mac/client.js:15-18`). The same literal appears in SVC.
  - `deadlineUnixMilliseconds` is `Date.now() + timeoutSeconds*1000`, with a default of 120 s (`mac/client.js:19-21`).
  - `codexTurnMetadata` is `requestMeta["x-codex-turn-metadata"]`, JSON-parsed if it arrives as a string or bytes, and omitted if absent (`mac/client.js:191-203`; `mac/native-pipe.js:348-352`).
  - `request` has undefined keys stripped recursively (`mac/client.js:265-275`).

  [V]
- **Serialization.** Requests are strictly serialized per connection (a promise chain) (`mac/native-pipe.js:282-311`). The worker uses a single module-level client (`mac/client.js:190`), so every Sky call in the REPL goes through one connection. [V]

### 2.3 Reference table: request types, payloads and responses

This is the most reusable artifact of this layer. Request payloads are exactly what the JS writes. Response fields are **only those the JS reads**; the service may send more.

| requestType | JS entry point | `request` payload | Response fields read | JS result |
|---|---|---|---|---|
| `ComputerUseIPCListAppsRequest` | `list_apps` (no policy) | `{}` | array of `{bundleIdentifier?, displayName?, isRunning?, lastUsedDate?, useCount?}` | `AppInfo[]`: `{id: bundleIdentifier ?? displayName ?? "unknown", displayName, isRunning, lastUsedDate?, useCount?}` (`mac/list_apps.js:14-31`) [V] |
| `ComputerUseIPCAppPolicyRequest` | every policy-wrapped operation | `{app}`, the model-supplied name, path or bundle ID (then the resolved path on bound handles) | `{decision: "allowed"\|"denied"\|"forbidden", target:{bundleIdentifier, displayName, appPath?, risk, warningSubtitle?}, allowPersistentApproval: bool}` | none directly. It drives the elicitation and the `app` rewrite (`mac/computer-use-policy.js:17-34,38-72,124`) [V] |
| `ComputerUseIPCAppGetSkyshotRequest` | `get_app_state` | `{app, disableDiff?: bool}` | `{skyshot:{text: string, screenshot?:{url: string}}, appSpecificInstructions?: string, app?: {bundleIdentifier?}\|string}` | `{app: <resolved app string>, screenshot: {url}\|null, text}`. A missing `skyshot` or non-string `text` throws (`mac/client.js:38-50`; `mac/window_result.js:3-51`) [V] |
| `ComputerUseIPCAppPerformActionRequest` | click, drag, paste, perform_secondary_action, press_key, scroll, select_text, set_value, type_text | `{app, action: <ActionCase>}` (§2.4) | ignored | void (`mac/client.js:143-149`). SVC has `ComputerUseIPCActionResult`, which JS drops. [V] |
| `ComputerUseIPCAppStartRequest` | none. `MacComputerUseClient.startApp` is defined but has no caller. Launching happens implicitly inside GetSkyshot ("launches the app in the background if needed"). | `{app}` | – | – (`mac/client.js:35-37`; `docs/tinysky-alt-core-cua-repl.md:205`) [V] |
| `ComputerUseIPCStartAudioRecordingRequest` | `start_audio_recording` (gated by `SKY_ENABLE_AUDIO=1`) | `{maxDurationMilliseconds}`, an integer from 100 to 300000, default 60000 | ignored | void (`mac/audio_recording.js:12-33`) [V] |
| `ComputerUseIPCStopAudioRecordingRequest` | `stop_audio_recording` | `{}` | `{url}`, which must be a `file:` URL | `{filepath, bytes, data_url:"data:audio/wav;base64,…"}`. The worker suspends the cell timeout while waiting (`mac/audio_recording.js:34-72`) [V] |

The error for every type is JSON-RPC `{code, message}` (§6).

### 2.4 `ActionCase` encodings (Swift `Codable` enum shape)

`AT` is either `{"elementID":{"_0":"<int as decimal string>"}}` or `{"coordinate":{"_0":[x, y]}}` (`mac/client.js:211-215`). The index must satisfy `Number.isInteger`; negative values are not rejected on mac (`mac/client.js:221-225`). Coordinates must be finite and are sent as numbers (`mac/client.js:216-220`). The `_0` key is Swift's synthesized encoding for unlabeled associated values. [V for the encoding; I that Swift `Codable` is the origin]

| Action | Encoding | JS defaults and validation |
|---|---|---|
| click | `{click:{at:AT, clickCount:n, mouseButton:0\|1\|2}}` | `clickCount` defaults to 1 and is not validated. The button accepts `left/l/0`, `right/r/1`, `middle/m/2` (`mac/client.js:51-65,226-246`) |
| drag | `{drag:{from:[x,y], to:[x,y]}}` | Coordinates only (`mac/client.js:66-77`) |
| paste | `{paste:{text, format}}` | Format is `"text"\|"md"\|"html"`; the handle defaults it to `"text"` (`mac/client.js:78-84`; `alt/bind_mac_app.js:30-37`) |
| performSecondaryAction | `{performSecondaryAction:{action, elementID:"n"}}` | Index only (`mac/client.js:85-96`) |
| pressKey | `{pressKey:{_0:key}}` | Rejects an empty or whitespace-only key (`mac/client.js:97-100`) |
| scroll | `{scroll:{at:AT, direction:"up"\|"down"\|"left"\|"right", pages:p}}` | `pages` defaults to 1 and must be finite and greater than 0. Directions also accept `u/d/l/r` (`mac/client.js:101-116,247-264`) |
| setValue | `{setValue:{elementID:"n", value}}` | (`mac/client.js:117-123`) |
| selectText | `{selectText:{elementID:"n", text, prefix?, suffix?, selection}}` | `selection` defaults to `"text"`; the other values are `cursor_before` and `cursor_after` (`mac/client.js:124-139`) |
| type | `{type:{_0:text}}` | Types at the current focus (`mac/client.js:140-142`) |

### 2.5 How results become model output

- Actions produce no output. [V]
- AX text is written with `nodeRepl.write(text, "cua.state")` in the cell (`alt/bind_mac_app.js:6-10`; `cuasrc/core/display.js:2-12`). [V]
- Images go through `nodeRepl.emitImage({bytes, mimeType})` in the cell (§3). [V]
- Inventory is written as `JSON.stringify` output (`alt/create_bootstrap_emitter.js:47-49`). [V]
- Across the RPC boundary, anything the worker writes or emits (it does neither on mac) would be appended to the calling cell's output (NR:61870-61873). [V]
- `setResponseMeta` in the worker attaches `{"codex/toolSurface":{kind:"computerUse", app:{kind:"appId", appId:<bundleId>}|null}}` to the tool result, plus `{"codex/computerUseChrome": true}` when the bundle is `com.google.Chrome` (`mac/computer-use-policy.js:9-10,187-204`; NR:62827-62847). This probably drives the Codex UI's "using app X" affordance. [V for the emission; I for the UI use]

---

## 3. Screenshot pipeline and element addressing

- **There is no separate screenshot request on mac.** Every `ComputerUseIPCAppGetSkyshotRequest` returns `skyshot.screenshot.url` with the AX text. JS drops the URL for text-only observations (`mac/window_result.js:8-19`; `alt/bind_mac_app.js:6-10`). Whether the service captures an image on every call is unknown. [V for JS; I for the service]
- **Transport of pixels.** The URL is either a `data:` URL (base64-decoded in memory) or a `file:` URL (`fs.readFile` **in the untrusted cell**) (`cuasrc/core/screenshot_bytes.js:2-16`). The docs disagree: the mac SKILL says the URL is "always `file://`" (`sky/docs/skills/oai_sky_lib/macos/SKILL.md:116`), while the window API types say "data URL" (`sky/docs/sky-window-api.md:113`). With `file:` URLs only a path crosses the socket; a data URL would be bounded by the 8 MiB frame cap. [V for the code; the actual format is open (E5)]
- **Encoding to the model.** `display.image` calls `emitImage({bytes, mimeType: options.mime_type ?? "image/png"})`, and the mac handle never passes a MIME type (`cuasrc/core/display.js:13-24`). When given `{bytes, mimeType}`, the kernel trusts the declared type without sniffing and builds `data:<mime>;base64,…` (NR:65838-65847 `encodeByteImage`; NR:65888-65917). A JPEG or HEIC file would therefore be mislabeled `image/png`. The JS does **no scaling, compression or dedupe** of images on mac. [V]
- **Deduplication that does exist** [V]:
  - AX text diffing is done in the service and toggled by `disableDiff`;
  - core docs are emitted once per session;
  - app-specific instructions are emitted once per app per worker (`mac/window_result.js:48-51`, keyed by bundle ID, else by app string).
- **Hidden diff-baseline side effect.** `getScreenshot()` calls GetSkyshot *without* `disableDiff` and throws the text away (`alt/bind_mac_app.js:12-19`). If the service advances its diff baseline on every call, the next `getAXState()` diff is relative to a tree the model never saw. The docs tell the model to compensate: "After a screenshot-only observation, request a full tree before relying on accessibility indexes again" (`docs/tinysky-alt-core-cua-repl.md:164`). [V for the code and docs; I for the mechanism (E6)]
- **Atomic pair.** `getAXStateAndScreenshot()` is the only way to get text and image from one capture (`alt/bind_mac_app.js:21-29`). [V]
- **Addressing.** The model can use either of two forms [V]:
  - an **AX element index** (an integer from the latest AX text, sent as a string `elementID`);
  - **coordinates** `[x, y]`, documented as being "in the app-window screenshot" (`sky/docs/sky-window-api.md:51-52,70-71,82-85`).

  JS does not transform coordinates, so the mapping to the screen belongs to the service. Whether the space is screenshot pixels or logical points (Retina 2x) is unknown to this layer (E5).

  Index-only operations are `setValue`, `selectText` and `performSecondaryAction`. Either form works for `click` and `scroll`. `drag` takes coordinates only.
- `positive_pixels` and `one_screenshot` are **Linux and Windows only** (`alt/bind_linux_app.js:3-4`; `alt/bind_windows_app.js:3-5`). On mac there is one screenshot per state and no pixel-distance scrolling. [V]

---

## 4. `@oai/sky/service` as a trusted service: the boundary

### 4.1 Which code runs where

| Context | Process and privileges | Code from this layer |
|---|---|---|
| **Cell** (untrusted kernel) | A Node `vm` ESM cell. `process` is denied. The env contains only allowlisted variables (NR:60605-60628). `nodeRepl` has `cwd, env, homeDir, tmpDir, requestMeta, write, emitImage, [emitAudio], rpc` (NR:65965-66040, NR:61888-61911). | `@oai/cua/tinyskyAlt` and all of `alt/*`, plus the **cua-bundled copy** of sky_js (`cua/dist/project/cua/sky_js/…`), which is only the `sky.js` RPC proxy on this path, and the browser client. |
| **Trusted worker** | A separate Node process that receives the **full** process env (NR:65591-65597). Every resolved file must sit under `NODE_REPL_TRUSTED_CODE_PATHS` (NR:65576-65590); services come from `NODE_REPL_TRUSTED_SERVICES` and must export `handleRpc` (NR:65660-65676). `nodeRepl` is the privileged object (NR:62680-62900, 65619-65624). | `@oai/sky/service` → `skysrc/service.js` → `mac/*`, including the policy, the transport and telemetry (statsig is resolved from `cua_node/lib/node_modules/@statsig`). |
| **node_repl (Rust)** | Owns the socket I/O (`native_pipe_request` connect/write/close), elicitations (with the persisted-approval interceptor), authenticated fetch, LaunchServices and timeouts. | Not JS. See the node_repl researcher. |

The two sky_js copies are identical except for the statsig import path in `computer-use-telemetry.js`. `@oai/sky` additionally ships `service.js` (`diff -rq sky/dist/project cua/dist/project`). [V]

Consequences [V]:

- The cell cannot reach `nativePipe`, `createElicitation`, `launchServices` or the authenticated `fetch`, so policy and consent cannot be skipped from model-written code.
- `NODE_REPL_TRUSTED_CODE_PATHS` includes `~/.codex` (`.mcp.json`). Code placed under `~/.codex` can therefore be loaded as a trusted service if `NODE_REPL_TRUSTED_SERVICES` names it. That is relevant to the E1 shim and worth noting as a local-privilege surface.

### 4.2 How cell calls cross the boundary

1. `nodeRepl.rpc("sky", req)` checks that `req` is JSON-serializable and sends `trusted_service_request {service, request}` tagged with the exec ID. It is tracked as a background operation of the cell (NR:61888-61910). [V]
2. The worker runs `handleRpc(req)` inside the caller's exec context, so `requestMeta`, elicitations and response meta bind to the calling tool call. It drains background tasks, then replies `{ok:true, value}` or `{ok:false, error: <message string>}` (NR:65679-65715). [V]
3. Only the four request shapes in `skysrc/service.d.ts:10-27` are accepted:
   - `setup`;
   - `execute {method, args}`;
   - `drag_start`, `drag_move`, `drag_end` (Linux only).

   Media results cross as `WireMedia {filepath, data_url}` (`skysrc/service.js:33-45,72-74`) and are rebuilt with `bytes` in the cell (`skysrc/sky.js:71-99`). [V]

### 4.3 Every `nodeRepl.*` member the JS layer touches

| Member | Context | Used for | Evidence |
|---|---|---|---|
| `env.CUA_REPL_ENABLED_SURFACES` | cell | Surface gating; required | `alt/globals.js:3-20` |
| `env.TINYSKY_ALT_INITIALIZE_DOCS` | cell | Document variant (not allowlisted, so always the default) | `alt/create_documentation.js:4-13` |
| `env.CUA_REPL_BROWSER_ENV` | cell | `codex-app\|training\|cloud\|orbit`. `orbit` drops the confirmations doc. | `alt/create_documentation.js:23-30`; `alt/setup_browser.js:4-16` |
| `requestMeta` | cell | The confirmations override; exec identity for doc rewrites | `alt/create_documentation.js:31-45`; `alt/create_bootstrap_emitter.js:16-18` |
| `write(value, itemId)` | cell | All text output | `alt/create_bootstrap_emitter.js:10-18`; `cuasrc/core/display.js:5-10` |
| `emitImage({bytes, mimeType})` | cell | Screenshots | `cuasrc/core/display.js:16-23` |
| `rpc(service, req)` | cell | Crossing into the worker | `skysrc/sky.js:7,68-70` |
| `nativePipe.createConnection(path)` | worker | The socket (bridged through Rust) | `mac/native-pipe.js:21-23,56-63,218` |
| `launchServices.openApplication({applicationPath}\|{bundleIdentifier})` | worker | Fallback service launch | `mac/native-pipe.js:169-192` |
| `createElicitation({message, meta})` | worker | App and audio approval | `mac/computer-use-policy.js:15,46,130-134` |
| `withSuspendedTimeout(fn)` | worker | Wraps every policy-wrapped action and audio stop | `mac/computer-use-policy.js:16,125`; `mac/audio_recording.js:39-46`; NR:62726-62746 |
| `setResponseMeta(obj)` | worker | `codex/toolSurface`, `codex/computerUseChrome` | `mac/computer-use-policy.js:187-204` |
| `requestMeta["x-codex-turn-metadata"]` | worker | `codexTurnMetadata`, the elicitation `tool_call_id`, telemetry IDs | `mac/client.js:191-203`; `mac/computer-use-policy.js:205-223`; `mac/computer-use-telemetry.js:39-81` |
| `config` (presence only) and `fetch` | worker | Telemetry gate and transport | `mac/computer-use-telemetry.js:215-220,141,155` |
| `env.*` in the worker | worker | See §4.4 | — |

**Not used by this layer:** `addTurnEndedHandler`, `addAfterSubmittedCodeHook`, `emitContentItem`, `otel`, `gaasBrowserConfig`. The browser service registers the turn-ended handler (`@oai/browser-desktop/scripts/browser-service.mjs`); `@oai/sky` does not, so nothing in JS forwards turn end to the service. [V by grep]

### 4.4 Environment variables read

| Variable | Read via | Effect | Evidence |
|---|---|---|---|
| `CUA_REPL_ENABLED_SURFACES` | cell env | Required; `browser,computer` | `alt/globals.js` |
| `TINYSKY_ALT_INITIALIZE_DOCS` | cell env | Document variant | `alt/create_documentation.js:10` |
| `CUA_REPL_BROWSER_ENV` | cell env | Browser docs and the confirmations skip | as above |
| `OAI_SKY_CONFIG_PATH` | worker `process.env` | JSON `{target,…}` overriding platform detection | `skysrc/load_options.js:2-21` |
| `SKY_ENABLE_AUDIO` | worker `process.env` | Exposes the audio methods | `mac/create_client.js:40` |
| `SKY_CUA_SERVICE_NATIVE_PIPE_PATH` | worker `nodeRepl.env` | Socket path override | `mac/native-pipe.js:27-39` |
| `NODE_REPL_HOST_SERVICES_PIPE_PATH` | worker `nodeRepl.env` | Chooses `ensureService` over LaunchServices. Set by the Electron host as `/tmp/codex-host-services-<uuid>.sock` (`app.asar` grep); not in the plugin `.mcp.json`. | `mac/native-pipe.js:49-53` |
| `SKY_CUA_SERVICE_PATH`, `CODEX_HOME` | worker `nodeRepl.env` | Launch target: `SKY_CUA_SERVICE_PATH`, then `$CODEX_HOME/computer-use/Codex Computer Use.app` if it exists, then bundle ID `com.openai.sky.CUAService` | `mac/native-pipe.js:178-191` |
| `NODE_REPL_DISABLE_ANALYTICS`, `BROWSER_USE_DISABLE_AMBIENT_NETWORK` | worker `nodeRepl.env` | `"1"` disables telemetry | `mac/computer-use-telemetry.js:202-214` |
| `BROWSER_USE_CODEX_APP_VERSION`, `BROWSER_USE_CODEX_APP_BUILD_FLAVOR`, `NODE_REPL_SENTRY_USER_ID` | worker `nodeRepl.env` | Telemetry metadata, tier and user ID | `mac/computer-use-telemetry.js:124-145,221-243` |

---

## 5. Policy and telemetry

### 5.1 `computer-use-policy.js`: what the client enforces

`withComputerUsePolicy(toolName, input, act)` (`mac/computer-use-policy.js:11-126`) runs these steps:

1. **Input hygiene.** The input must be a plain object whose `app` is a non-empty *data* property (no getters). The input is re-created as a frozen, non-writable object (`:224-250`). [V]
2. **Service decision.** It sends `ComputerUseIPCAppPolicyRequest {app}`. Then [V]:
   - `denied` throws "Computer Use is blocked from using the app '<bundleId>' by your organization's policy."
   - `forbidden` throws "Computer Use is not allowed to use the app '<bundleId>' for safety reasons."
   - `allowed` continues. (`:17-34`)
   - Any other value is unhandled and yields a TypeError at step 4.
3. **User consent on every call.** It calls `createElicitation` with the payload below. It then [V]:
   - accepts a response whose `content.source === "computer-use-persisted-state"` (auto-answered) silently, with no telemetry;
   - otherwise logs Requested and Resolved and requires `action === "accept"`, else throws "Computer Use was not approved to use <displayName>" (`:78-121`).
4. **Canonicalization.** `app := target.appPath ?? app`, so the action targets the service-resolved path, not the model's string (`:124`). Bound handles inherit it through `get_app_state` → `window_result.app` (`mac/get_app_state.js:7-13`; `mac/window_result.js:17-20`). [V]
5. **Execution.** Runs `act()` inside `withSuspendedTimeout` and times it for telemetry (`:125,159-186`). [V]

App-approval elicitation payload (`:46-73`) [V]:

```json
{
  "message": "Allow Computer Use to use \"<displayName>\"?",
  "meta": {
    "codex_approval_kind": "mcp_tool_call",
    "connector_id": "computer-use",
    "connector_name": "Computer Use",
    "persist": ["session", "always"],
    "riskLevel": "<target.risk>",
    "subtitle": "<target.warningSubtitle, if any>",
    "tool_call_id": "<turn-metadata call_id|item_id, if any>",
    "tool_name": "<click|get_app_state|…>",
    "tool_params": { "app": "<bundleIdentifier>" },
    "tool_params_display": [{ "name": "app", "display_name": "App", "value": "<displayName>" }]
  }
}
```

- `persist` is `["session"]` alone when `allowPersistentApproval` is false.
- No `requestedSchema` is sent, so node_repl substitutes `{type:"object",properties:{}}` (NR:62420-62431).
- The chosen persistence is read back from the response `_meta.persist === "always"` (`:104-113`).

**Where approvals persist.** This is not in JS [I, from node_repl strings and on-disk files]:

- node_repl's Rust side has an "elicitation interceptor" that auto-answers (NR:66280) using `computer-use-persisted-state` and `$CODEX_HOME/computer-use/…` paths (NR:73064, 73168-73172).
- Session approvals appear as `~/.codex/computer-use/sessions/<thread-uuid>.toml` containing `[apps] allowed = ["com.apple.finder", …]`.
- "Always" approvals appear in the service's group container, `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json` `{"approvedBundleIdentifiers":[…]}`, which node_repl references (NR:73064).

**The JS gate precedes the interceptor.** `createElicitation` rejects outright when the exec's `formElicitationSupported` is false ("…because the MCP client does not support form elicitation") (NR:62382-62390). The approval check therefore fails *even if the app was persisted*, whenever the MCP client lacks form elicitation. [V]

**No sensitive-action confirmation in code.** Nothing in `mac/*` or `alt/*` classifies actions such as deletion, purchases, messaging, credentials or CAPTCHAs. The only elicitations are app approval and audio approval (a grep for `createElicitation` finds `policy.js:15,130` only). `tinysky-alt-confirmations.md` is a model-behavior policy with four modes:

- hand-off required (password-change submit, bypassing safety interstitials);
- always confirm at action time (delete, account and permission changes, CAPTCHAs, installs, third-party communication, subscriptions, financial transactions, system settings, medical);
- pre-approval works (login, age verification, third-party warnings, uploads, file moves, sensitive-data transmission naming both data and destination);
- no confirmation (cookies and ToS, downloads, anything else).

It also sets hygiene rules: third-party content is never permission, explain risk and mechanism, don't ask early, avoid redundant asks (`docs/tinysky-alt-confirmations.md:23-78`). Service-side guards exist only as error codes (`blockedURL`, `userIntervened`, `screenLocked`, `userStoppedSession`). [V]

### 5.2 `computer-use-telemetry.js`

Telemetry is sent through a Statsig client:

- client key `client-br04gwIKFntB05BUONtNnF3NhWQsvmSI8R97Pigr7A5`;
- API `https://ab.chatgpt.com/v1`;
- events to `https://chatgpt.com/ces/v1/rgstr`;
- **all network through `nodeRepl.fetch`**, node_repl's authenticated fetch, whose strings include `authorization`, `ChatGPT-Account-ID` and `originator codex_browser_use` (`mac/computer-use-telemetry.js:8-11,132-145`; NR:62448-62512, NR:73152-73163).

[V for the JS; I that the host attaches ChatGPT auth headers]

**User identity.** The initial user is `userID = NODE_REPL_SENTRY_USER_ID`, custom `{auth_status, codexAppVersion, platform}`, tier development/staging/production from the build flavor. After init it fetches `https://chatgpt.com/backend-api/me` and calls `updateUserSync({email, userID: id, custom})`, so events carry the ChatGPT account ID and **email** (`:117-176,221-243`). [V for setting them; I that Statsig transmits the user with each event]

**Envelope.** Each event is logged as `__protobuf_structured_event__` with metadata:

```
{eventCreatedAt, eventId: uuid, eventType: "client",
 eventParams: {"@type": "openai.buf.dev/openai/protobuf-analytics-events/protobuf_analytics_events.v1.<Name>",
               …fields, runtime: "CODEX_COMPUTER_USE_MCP_RUNTIME_NODE_REPL"}}
```

(`:180-196`) [V]

**Events:**

| Event | When | Fields |
|---|---|---|
| `CodexComputerUseMcpServerLaunched` | mac client created (worker startup, at `setup`) | `{transport:"stdio"}` |
| `CodexComputerUseMcpAppApprovalRequested` | Elicitation threw, or the answer was not auto-persisted | `{bundleIdentifier, toolName}`, timestamped at request time |
| `CodexComputerUseMcpAppApprovalResolved` | Answer was not auto-persisted | `{approvalResult: accepted\|canceled\|declined, bundleIdentifier, toolName, approvalPersistence?: session\|always}` |
| `CodexComputerUseMcpToolCalled` | After every policy-wrapped op, `list_apps` and the audio ops | `{durationMs, invocationSource:"code_mode", mcpErrorPresent, mcpServerName:"node_repl", pluginId:"computer-use@openai-bundled", terminalStatus: completed\|failed\|cancelled, toolName, transport:"native_pipe", bundleIdentifier?, threadId?, turnId?, itemId?, model?, reasoningEffort?}`. The IDs are parsed from `x-codex-turn-metadata` (`thread_id\|threadId\|session_id`, `turn_id`, `item_id\|itemId\|call_id`, `model`, `reasoning_effort\|…`). `cancelled` means `userStoppedSession` or `userIntervened`. |

(`mac/computer-use-telemetry.js:14-116`; `mac/computer-use-policy.js:159-186`) [V]

Telemetry is disabled when `NODE_REPL_DISABLE_ANALYTICS=1` or `BROWSER_USE_DISABLE_AMBIENT_NETWORK=1`, or when `nodeRepl.config` or `fetch` is absent, which is the case in the cell (`:202-220`). Errors are swallowed (`:197-200`). [V]

### 5.3 Audio approval

`start_audio_recording` asks "Allow Computer Use to record computer audio?" with:

- `codex_request_type:"approval_request"`;
- `persist:["session"]`;
- `riskLevel:"high"`;
- `tool_name:"start_audio_recording"`.

It does **not** accept a persisted-state answer specially; it requires `action === "accept"` (`mac/computer-use-policy.js:128-158`). node_repl has a `computer-audio` persistence key (NR:73170). Audio is off in this deployment (§1.4). [V/I]

---

## 6. Error model, handshake, retries

**`ServerErrorCode`** (`mac/errors.js:1-24`). SVC contains `senderProcessNotAuthenticated`; the other names are JS-side. [V]

| code | name | code | name |
|---|---|---|---|
| -10000 | senderProcessNotAuthenticated | -10011 | noActiveSession |
| -10001 | couldNotGetRequestData | -10012 | userStoppedSession |
| -10002 | couldNotGetRequestTypeName | -10013 | incompatibleClientVersion |
| -10003 | couldNotResolveRequestType | -10014 | permissionsPending |
| -10004 | unhandledEvent | -10015 | blockedURL |
| -10005 | unknownError | -10016 | userIntervened |
| -10006 | appNotAllowed | -10017 | couldNotGetSenderPID |
| -10007 | runningApplicationNotFound | -10018 | ambiguousApp |
| -10008 | accessibilityError | -10019 | couldNotGetBootstrapPort |
| -10009 | permissionsNotGranted | -10020 | screenLocked |
| -10010 | invalidApp | | |

**Error classes.** [V]

- `SkyComputerUseError{code, errorName (from the map, else "jsonRPCError"), request:null, requestType:"jsonRPC"}` is built for any JSON-RPC error. The real request and type are *not* attached (`mac/native-pipe.js:457-465`).
- `SkyComputerUseTransportError{cause}` covers framing, closure, timeout and startup failures (`mac/errors.js:37-43`).
- The declared `formatOSStatus` is not present in `errors.js` (`mac/errors.d.ts:41`).

**Connect and handshake** (`mac/native-pipe.js:19-253`) [V]:

1. Connect to the socket with a 250 ms budget, then ping with timeout `min(1000, remaining)`. Other failures retry every 100 ms until the budget is spent. **Fatal immediately**: a version mismatch (`serverApiVersion ≠ "CodexComputerUseIPC-5"`, class `D`) or `incompatibleClientVersion` (-10013).
2. If the socket is unavailable, start the service:
   - with `NODE_REPL_HOST_SERVICES_PIPE_PATH` set: framed JSON-RPC `{id:0, method:"ensureService", params:{service:"computer-use"}}` to that pipe, with a 5 s connect and 5 s response budget; any `result` counts as success;
   - otherwise: `launchServices.openApplication(...)` (§4.4).

   A failure throws `SkyComputerUseTransportError("…service startup request failed", {cause})`.
3. Reconnect with a 5 s budget, else throw "…native pipe startup failed".

**Per request** [V]:

- The timeout is `timeoutSeconds` (120 s). It rejects "Sky Computer Use request timed out" but does **not** close the connection; a late response is ignored (`mac/native-pipe.js:420-433,451-456`).
- The deadline is sent to the server so it can abandon work.
- Socket close or error rejects all pending requests. The client drops a closed transport, and the *next* call reconnects (`mac/client.js:150-188`; `mac/native-pipe.js:468-475`).
- **No request is ever retried.**

Two layers of timeout interact. The cell's timeout (default 30 s, adjustable with `timeout_ms`) is suspended only around the action itself; the policy round trip and the elicitation run under the cell timeout (`mac/computer-use-policy.js:17-125`; NR:62726-62746). Whether node_repl pauses the clock during an elicitation is out of scope. [V/I]

**What the model sees.** In the worker, errors are serialized as `error.message` only (NR:65705-65712). In the cell, `rpc` rejects with `new Error(message)` (NR:61874-61876). The model therefore sees plain text such as the policy strings, the service's `message` for JSON-RPC errors, or "Sky Computer Use native pipe is unavailable: …". It never sees `code` or `errorName`, so it cannot branch on `screenLocked` versus `userIntervened` except by matching strings. [V]

---

## 7. The boundary, and whether a thin client could replace the JS

### 7.1 What JS decides, and what it delegates

**JS decides:**

- the model-facing API shape and its documentation (including the confirmation policy text and its override);
- argument normalization and validation;
- the Swift-enum wire encoding;
- when to observe (the model drives this; there are no automatic post-action snapshots);
- the app-approval flow and how it is presented;
- the `app` → `appPath` canonicalization;
- one-time app-instruction injection;
- screenshot retrieval and image labeling;
- response meta for the UI;
- telemetry;
- connection lifecycle, the version pin, service launch, serialization and timeouts.

**Delegated to the service:**

- resolving name, path or bundle ID to an app, and background launch;
- AX tree extraction, element indexing, **diffing** and full-tree mode;
- settle waits;
- screenshot capture, format, scaling and storage;
- coordinate mapping;
- all input synthesis (click, drag, scroll by pages, key chords from xdotool syntax, typing, paste with clipboard save and restore, AX `setValue`, `selectText`, secondary actions);
- per-app policy verdicts (`allowed`/`denied`/`forbidden`, risk, `warningSubtitle`, `allowPersistentApproval`, org policy);
- app-specific guidance text;
- session and overlay UX ("ChatGPT is using your computer / Esc to cancel", from `~/.codex/computer-use/config.json`);
- user-intervention and lock-screen detection;
- TCC permissions;
- **sender authentication**.

[V for the JS side; I for the service side, from API docs and error names]

### 7.2 Could the JS be replaced by a thin client over the same socket?

**At the protocol level, yes.** A client in any language would need to:

1. Frame messages with a 4-byte LE length prefix, capped at 8 MiB, and speak JSON-RPC 2.0 with integer IDs.
2. Ping with `CodexComputerUseIPC-5` and refuse to proceed on a mismatch.
3. Send the `request` envelope (§2.2), including a deadline and, optionally, `codexTurnMetadata`.
4. Implement the seven request types and the ActionCase encodings (§2.3 and §2.4).
5. Reproduce the consent flow if user approval is wanted: AppPolicy → honor denied/forbidden → ask the user → persist the approval → act on `appPath`.
6. Prefix app-specific instructions once per app.
7. Read `file:` or `data:` screenshots and hand them to the model with a correct MIME type.
8. Carry the model-facing documentation, including the confirmation policy.
9. Handle service startup through LaunchServices or `ensureService`.

This is well under 1 kLOC. **The JS is not the obstacle.**

**In practice it is likely blocked on the service side** [I]:

1. **Peer authentication.** Error codes -10000, -10017 and -10019, and SVC strings `LOCAL_PEERTOKEN failed errno=`, `teamIdentifiers`, `identifiers`, `executableNames`, `trustedProcessRequirement`, `allowedRelayRequirement`, `senderAncestorIdentities` and `senderParentResponsibleIdentity`, point to the service verifying the socket peer's code identity and possibly its ancestry.

   Because node_repl's Rust process performs `connect` (NR:62561-62580), the peer Codex presents is the OpenAI-signed `node_repl`. A near-contiguous SVC string run lists team IDs `2DC432GLL2` (OpenAI's group-container prefix), `MQ55VZLNZQ` and `HX7739G8FX` alongside `codex-acp`, `node` and `node_repl`. It looks like an allowlist, but I have not verified what each entry means, and I did not attempt to identify the two unknown team IDs.
2. **Group Container access.** The socket lives in `2DC432GLL2.com.openai.sky.CUAService`. Newer macOS versions may put container-access consent in front of processes from other teams.
3. **Consent is client-side.** If the service does not enforce per-app approval itself (E4), a thin client *could* act without it, which makes the service's authentication the real consent boundary. That is probably why the peer checks exist.

**The more plausible reuse route for MAWS** is to host OpenAI's `cua_repl` MCP server (`cua-repl.mjs` → `node_repl`) as an MCP server under Claude Code. The OpenAI-signed binaries then stay the socket peer, and MAWS only needs to be a capable MCP client. Requirements:

- **Form elicitation.** Claude Code 2.1.283 advertises `elicitation: {}` and, behind a gate, `{form:{}, url:{}}` (`/Users/new/claude-code-bundle/2.1.283/cli.pretty.js:872197,872219`), and handles `elicitation/create` (`:427795`). Whether node_repl treats bare `elicitation: {}` as form support is unknown.
- **The same env** as `.mcp.json`.
- **Tolerance of the codex-specific elicitation meta**, which a generic client just ignores.
- **Checks still to run:**
  - whether persistence works without `x-codex-turn-metadata`, `tool_call_id` and `_meta.persist` in the response, since node_repl keys session approvals by thread;
  - whether the service's ancestry check accepts a Claude-Code-parented `node_repl`;
  - OpenAI's terms for using its bundled service from another harness. That is a non-technical gate someone should look at before MAWS builds on this route.

**My recommendation:** treat E2 as the go/no-go test (hosting cua_repl under Claude Code). If it fails on authentication, MAWS needs its own native controller. §2 to §3 then serve as a proven API design to copy: AX-index-first addressing, service-side diffing, batched actions followed by one observation, per-app consent, and once-per-app guidance.

---

## 8. Open questions

1. Does the service authenticate the socket peer? By which criteria (team, identifier, executable name, ancestry, responsible process)? At `ping` or per request? Which products do `MQ55VZLNZQ`, `HX7739G8FX` and `codex-acp` stand for? (Swift researcher; E3)
2. Does the service itself refuse actions on an app with no approval, or is consent purely client-side? (E4)
3. Screenshot format (PNG/JPEG/HEIC), location, lifetime, scaling, and coordinate space (screenshot pixels versus points, Retina scale, window-relative origin). (E5)
4. Does GetSkyshot advance the diff baseline even when the text is discarded? Is the baseline per app or per connection? (E6)
5. Which fields of `codexTurnMetadata` does the service consume, and does omitting them cause `noActiveSession`, overlay changes, or no effect? (E7)
6. Who sends `ComputerUseIPCCodexTurnEndedRequest` (SVC has `onCodexTurnEnded`)? JS never does. Possibly Electron or app-server directly.
7. What does node_repl need from an MCP client to set `form_elicitation_supported`, auto-answer, and persist approvals? What is the exact response shape (`content.source`, `_meta.persist`)? (node_repl researcher; E2)
8. Does `js_reset` restart the trusted worker? That would reset the app-instruction Set and the transport.
9. The unused service families (Messages*, Skysight*, EventStream*, AppStartCapture/NextCaptureUpdate, FrontmostWindow, AppModify, AppStop, AppUsage, Permission, CalendarPlaceholder, CodexStatusItemMenuState): are they reachable from the same socket by an authenticated client, and are they used by other OpenAI clients?
10. Where does `requestMeta["openai/confirmation_policies"]` originate: app-server config, backend, or enterprise policy?

## 9. Proposed wave-2 experiments (designed, not run)

All of these are read-mostly and use harmless targets (Calculator, TextEdit). Each should run in a scratch copy of the environment, never editing `/Applications` or `~/.codex`.

- **E1: Wire capture without modifying installed files.**
  - Setup: create a scratch dir `S` containing `sky-log/service.mjs`. It imports `handleRpc` from the installed `@oai/sky/service`, wraps `MacComputerUseClient.prototype.request` (imported from the installed `…/targets/mac/client.js`, same module URL, so the same instance) to log `requestType`, request and result to `S/log.jsonl`, and re-exports `handleRpc`.
  - Launch `cua-repl.mjs` from a standalone MCP client, such as MCP Inspector or a 50-line Python client that advertises form elicitation. Use `.mcp.json`'s env, but with `NODE_REPL_TRUSTED_CODE_PATHS=<installed node_modules>:S` and `NODE_REPL_TRUSTED_SERVICES={"sky":"S/sky-log/service.mjs"}`.
  - Run `await cua.getApp("Calculator")`, `app.click(<idx>)`, `app.getAXStateAndScreenshot()`.
  - Yields: real response bodies for every type in §2.3, including the fields JS ignores, such as `ActionResult`.
  - Note: this also exercises E2's non-Codex-parent condition, so run E2 first or interpret the results together.
- **E2: Go/no-go for reuse under Claude Code.**
  - Setup: `claude mcp add cua_repl -- /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node /Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs`, with the `.mcp.json` env.
  - Call the `js` tool with `await cua.listApps()`, which needs no elicitation.
    - Success: authentication accepted this parentage.
    - "…native pipe is unavailable…" or a message tied to `senderProcessNotAuthenticated`: rejected.
  - Then call `await cua.getApp("Calculator")`.
    - "does not support form elicitation": the capability gate failed.
    - A Claude Code dialog: the elicitation passed.
  - After accepting, check whether `~/.codex/computer-use/sessions/*.toml` gained an entry, and whether a second call re-prompts.
- **E3: Raw thin-client probe.**
  - A Python script connects to `computeruse.sock` and sends a framed `ping {clientApiVersion:"CodexComputerUseIPC-5"}`, then `request ListApps`. Repeat with `clientApiVersion:"CodexComputerUseIPC-4"`.
  - Record the error codes and messages. This isolates peer authentication from everything else.
  - Optionally repeat from an ad-hoc-signed binary named `node`, to see whether executable-name matching alone suffices.
- **E4: Where consent is enforced.**
  - Through the E1 shim (an authenticated path), call `client.getAppState({app:"com.apple.calculator"})` and `client.performAction(…, {pressKey:{_0:"Escape"}})` **without** a prior `getAppPolicy` or elicitation, for an app absent from both approval stores.
  - Outcomes: an `appNotAllowed` (-10006) error means the service enforces consent; success means consent is client-side only.
- **E5: Screenshot format and coordinate space.**
  - On a TextEdit window of known point size, run `getAXStateAndScreenshot()`. Log the URL scheme and path, magic bytes, pixel dimensions, and the window's frame in points and its backing scale.
  - Click at the screenshot coordinate of a known AX element's center and verify the target by AX focus or value.
  - Repeat on a non-Retina display if one is available.
- **E6: Diff baseline.**
  - Run `getAXState({disableDiffing:true})`, change the UI, call `getScreenshot()`, change the UI again, then call `getAXState()`.
  - Check whether the diff includes the first change. If it does not, the screenshot call advanced the baseline invisibly.
- **E7: Turn-metadata dependence.**
  - Through E1/E3, send identical GetSkyshot requests with `codexTurnMetadata` omitted, `{}`, and a realistic `{thread_id, turn_id, call_id}`.
  - Compare the responses, the overlay behavior and any `noActiveSession` errors.
- **E8: Service startup path.**
  - With the service stopped (the user quits it; no kill from us), trigger a call in E2's setup (no `NODE_REPL_HOST_SERVICES_PIPE_PATH`) and confirm the LaunchServices launch of `SKY_CUA_SERVICE_PATH` and the 5 s reconnect.
  - Inside Codex, confirm that the Electron host provides `ensureService` on `/tmp/codex-host-services-<uuid>.sock`.
