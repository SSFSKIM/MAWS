# Codex Computer Use — the native Swift service (SkyComputerUseService / SkyComputerUseClient)

> **Correction (2026-09-28, wave 2).** Live tests contradict this report's portability verdict (the "Bottom line" below, §2.3 and "Portability verdict for MAWS"). The service accepted OpenAI's `node_repl` whenever its parent was OpenAI's signed `node` (team `2DC432GLL2`), with no Codex or ChatGPT process in the chain, and even when that `node` ran a non-OpenAI script. The relay-needs-a-trusted-ancestor model is correct; what this report missed is that OpenAI's bundled `node`, which any host can launch, is that trusted ancestor. A non-Codex host launching `cua-repl.mjs` therefore gets working computer use. The §6.4 abort also does not reproduce: the client lists its tools and fails per call with -10000. See `README.md` §7 and §9, and `spikes/computer-use-probe/findings.md` §1.

Reverse-engineering notes for MAWS. Build **26.923.1001242** (CFBundleVersion `1001242`),
bundle id `com.openai.sky.CUAService`, team `2DC432GLL2` (OpenAI OpCo, LLC).
Scope: the Swift server side of Codex native computer use, cross-checked against the JS client.

Everything here is read-only observation of an installed, signed build. Large intermediates
(strings, demangled symbols, disassembly, fixups, decoded profiles) are under
`~/codex-app-src/readable/cua-service-26.923/` — cited as `INT/<file>`. Each claim is marked
**[V]** Verified (read directly / observed) or **[I]** Inferred (reasoned from names, strings, imports,
or partial disassembly). The Swift side has almost no readable source; a large fraction is **[I]**.

Bottom line for MAWS: OpenAI's native controller is a **hard fork point**, not a reusable component.
The service authenticates every caller by code signature and refuses processes not signed by team
`2DC432GLL2` with a trusted OpenAI ancestor. A Claude Code harness cannot connect to it as-is; the
reusable asset is the *architecture* (AX-first perception + a soft-linked CGEvent action layer +
per-app policy), not the binary. See §2 and "Portability verdict" at the end.

---

## 0. Component map (what each binary/bundle is) [V]

Inside `~/.codex/computer-use/Codex Computer Use.app/Contents/` (byte-identical copy shipped inside
`/Applications/ChatGPT.app/.../@oai/sky/`):

- `MacOS/SkyComputerUseService` — the daemon. 23.7 MB arm64 Mach-O, `LSUIElement=true` (agent, no
  Dock icon). Owns the IPC server, perception, action, overlay, policy, Skysight, Messages. [V]
- `SharedSupport/SkyComputerUseClient.app` (`com.openai.sky.CUAService.cli`, exec `SkyComputerUseClient`)
  — a CLI/MCP bridge, 14.8 MB. Exposes MCP servers to Codex and relays into the service. [V]
- `SharedSupport/CUALockScreenGuardian.app`, `SharedSupport/Codex Computer Use Installer.app`
  (+ `CodexComputerUseAuthorizationPlugin.bundle`, `...InstallerTool`) — out of my scope; the service
  depends on the Guardian for lock-screen auto-unlock (§4) and on the Installer's authorization plugin
  for that flow. Named only where relevant. [V]
- `Resources/Package_ComputerUse.bundle` — resources for the controller: `AppInstructions/*.md`,
  `SkysightSummarizer.md`, `SkysightMemoryInstructions.md`, `LensSequence/Lens_frame_00..44.png`
  (45-frame "Lens" cursor animation). [V]
- `Resources/Package_Appshot.bundle` — `Appshot.wav` (camera-shutter sound for the user-facing
  "Appshot" screenshot feature; distinct from the agent's "Skyshot" capture). [V]
- `Resources/Package_SlimCore.bundle`, `SwiftProtobuf_SwiftProtobuf.bundle` — support bundles. [V]

Swift modules statically linked into the service (from `nm | swift-demangle` type-descriptor counts,
`INT/service.symbols.full.txt`): `OAIProtobuf` (~1012 types — analytics/protobuf), `MCP`, `SwiftProtobuf`,
`ComputerUseClient`, `ComputerUse`, `ComputerUseCore`, `SlimCore`, `AccessibilitySupport`, `MessagesCore`,
`ContactsCore`, `Statsig`/`OAIStatsig`, `GraphicsSupport`, `Fog`, `SoftLink`, `Markdown`, `SQLite`,
`TOML`, `Algorithms`, `Collections`, `ArgumentParser`, `Sparkle`, `EventSource`, `Gzip`. [V]
`BUILD.bazel` in the bundle confirms deps: `CodexAnalytics, ComputerUse, ComputerUseClient, Fog,
GraphicsSupport, Logging, SlimCore, OAIProtobuf, OAIStatsig, Sparkle, SwiftProtobuf`. [V]

---

## 1. The IPC server: methods, requestTypes, schemas, versions, errors

### 1.1 Transport [V]
Server class `ComputerUse.ComputerUseIPCServer`, allocated with `init(jsonRPCSocketURL:)`
(`INT/service.addr-demangled.tsv`). It runs **two** transports behind the same request dispatch:

1. **Unix-domain socket, JSON-RPC 2.0, 4-byte little-endian length prefix, 8 MiB max frame.**
   Class `ComputerUse.ComputerUseIPCSocket` (`_TtC11ComputerUse20ComputerUseIPCSocket`). Socket path:
   `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`
   (string `computeruse.sock`, `INT/service.strings.txt`; matches the JS `native-pipe.js`). Mach service
   names `com.openai.sky.computer-use-json-rpc-socket` and `...-readiness`. [V]
2. **NSXPC / Apple-event bootstrap.** Classes `ComputerUseIPCXPCSession`
   (`listener:shouldAcceptNewConnection:`, `sendRequestWithTypeName:requestData:codexMetadataData:fileDescriptors:withReply:`),
   `SAIXPCEndpointTransport`, `SAIMachBootstrapRendezvous`. A Mach bootstrap rendezvous hands an
   `NSXPCListenerEndpoint` across processes ("Could not access the bootstrap XPC endpoint", "Computer Use
   bootstrap response came from an unexpected process"). The JS `native-pipe.js` fallback that sends
   `ensureService {service:"computer-use"}` and the `SKY_CUA_SERVICE_PATH` LaunchServices open path
   drive this. [V]

Wire methods (both from JS `native-pipe.js` and server strings `INT/service.strings.txt`): **`ping`**
`{clientApiVersion}` → `{serverApiVersion}`, and **`request`**
`{clientApiVersion, codexTurnMetadata, deadlineUnixMilliseconds, request, requestType}`. Framing helpers
in JS (`encodeMessageFrame`/`decodeMessageFrames`) confirm the length-prefix; server strings
`Response exceeds maximum frame size`, `Request deadline exceeded`, `Method not found`,
`frame is too large:`, `invalid peer token length:` confirm the server enforces the same. [V]

### 1.2 API version [V]
Single constant **`CodexComputerUseIPC-5`** present in *both* binaries (`INT/service.strings.txt`,
`INT/client.strings.txt`). JS default `apiVersion: "CodexComputerUseIPC-5"` (`client.js`). `ping`
compares `serverApiVersion !== clientApiVersion` and rejects with `incompatibleClientVersion` (-10013).
The version is an **opaque string equality check**, not semver — a different string is refused outright.
A per-version transport is cached client-side keyed by the version string. [V]

### 1.3 requestType catalogue (server-served) [V]
Every served requestType has a Swift extension `…Request.handle(senderContext:) async throws -> …`
(`INT/ipc-symbols.txt`). The requestType wire name is the Swift struct name (JS `client.js` sends e.g.
`requestType: "ComputerUseIPCAppPerformActionRequest"`). Full set served by the daemon:

Computer-use core:
- `ComputerUseIPCListAppsRequest` → `[ComputerUseIPCDiscoveredApp]`
- `ComputerUseIPCAppPolicyRequest` (`{app}`) → `ComputerUseIPCAppPolicyResult`
  `{decision: ComputerUseIPCAppPolicyDecision, target: ComputerUseIPCTargetDescriptor, allowPersistentApproval: Bool}`
- `ComputerUseIPCAppStartRequest` (`{app}`) → `ComputerUseIPCAppState`
- `ComputerUseIPCAppStopRequest` → `ComputerUseIPCAppState`
- `ComputerUseIPCAppModifyRequest` (`{app, modification}`) → `ComputerUseIPCAppState`
- `ComputerUseIPCAppGetSkyshotRequest` (`{app, disableDiff}`) → `ComputerUseIPCSkyshotResult`
- `ComputerUseIPCAppPerformActionRequest` (`{app, action: ComputerUseIPCAction}`) → `ComputerUseIPCActionResult`
- `ComputerUseIPCAppStartCaptureRequest` / `ComputerUseIPCAppNextCaptureUpdateRequest` → capture-stream types
- `ComputerUseIPCFrontmostWindowRequest` → `ComputerUseIPCFrontmostWindow?`
- `ComputerUseIPCCodexStatusItemMenuStateRequest` → menu-state; `ComputerUseIPCCodexTurnEndedRequest` → empty

Audio: `ComputerUseIPCStartAudioRecordingRequest`, `ComputerUseIPCStopAudioRecordingRequest` → `ComputerUseIPCAudio`.
Skysight (background activity recorder): `Start/Stop/Pause/Resume/Status/GetSettings/UpdateSettings/
UpdateObservationPolicy/ClearHistory`. Event stream (record & replay): `EventStreamStart/Status/Stop`.
Messages: `FindChats/ReadMessages/SearchMessages/SearchChats/PrepareSend/CommitSend(fileHandles:)/
CountActivity/ReadImage`. Calendar: `CalendarPlaceholderRequest` (stub). Permission:
`ComputerUseIPCPermissionRequest`. [V]

The `ComputerUseIPCAction` union (from JS `client.js` + server type
`ComputerUse.ComputerUseAppController.{ClickType,KeyboardAction,ScrollDirection}`): `click {at, clickCount,
mouseButton}`, `drag {from,to}`, `scroll {at, direction, pages}`, `type {_0:text}`, `pressKey {_0:key}`,
`paste {text, format}`, `setValue {elementID, value}`, `selectText {elementID, text, prefix, suffix,
selection}`, `performSecondaryAction {action, elementID}`. `at` is `elementID{_0}` **or** `coordinate{_0:[x,y]}`;
`mouseButton` 0/1/2 = left/right/middle. Element indices are strings. [V]

### 1.4 Error codes [V]
Client-visible enum (JS `errors.js`), all negative: `senderProcessNotAuthenticated -10000`,
`couldNotGetRequestData -10001`, `couldNotGetRequestTypeName -10002`, `couldNotResolveRequestType -10003`,
`unhandledEvent -10004`, `unknownError -10005`, `appNotAllowed -10006`, `runningApplicationNotFound -10007`,
`accessibilityError -10008`, `permissionsNotGranted -10009`, `invalidApp -10010`, `noActiveSession -10011`,
`userStoppedSession -10012`, `incompatibleClientVersion -10013`, `permissionsPending -10014`,
`blockedURL -10015`, `userIntervened -10016`, `couldNotGetSenderPID -10017`, `ambiguousApp -10018`,
`couldNotGetBootstrapPort -10019`, `screenLocked -10020`. [V]
Server-side enum (`INT/service.strings.txt` ~L49137) adds names not in the JS map — Messages
(`messagesInvalidRequest, messagesAmbiguousDestination, messagesSendPlanUnavailable,
messagesSendRateLimited, messagesPermissionsPending/Denied, messagesQueryTimedOut,
messagesSendOutcomeUncertain`), bootstrap (`couldNotAllocateBootstrapPort, couldNotEncodeBootstrapPort,
bootstrapTimedOut, couldNotReceiveEndpoint, invalidFileDescriptor, missingRemoteProxy`), and
`turnEnded, serverError, couldNotFindServiceApp, notImplemented, appGroupContainerUnavailable,
legacyMCP, nodeRepl, unknownTool, invalidArgument, parentProcessIsCodex`. [V]

### 1.5 codexTurnMetadata is forwarded, not authenticated [V/I]
`request.codexTurnMetadata` is opaque JSON (`x-codex-turn-metadata`, JS `client.js` `d()`), decoded by
the server (`j()` in `native-pipe.js` accepts object or serialized bytes). It carries thread/turn ids,
model, reasoning-effort, approval policy (telemetry fields `_threadID,_turnID,_model,_reasoningEffort,
_toolName,_approvalResult`). **It is trusted transitively because the *sender process* is authenticated
(§2), not because the metadata itself is signed.** [V that it is forwarded; I that it is unauthenticated —
no signing/HMAC over it appears in imports or strings.]

---

## 2. Peer authentication — the load-bearing gate (answer to the MAWS question)

**This is the crux. The service does NOT use SecRequirement string matching or
`SecCodeCheckValidity`.** Neither `SecRequirementCreateWithString`, `SecCodeCheckValidity`,
`SecStaticCodeCheckValidity`, nor `SecTaskCopyValueForEntitlement` is imported (grep of
`INT/service.fixups.txt`, the GOT bind table = the complete dynamic-import list). [V]

Instead it authenticates by **extracting the caller's code-signing identity from its audit token and
comparing fields in Swift code** against hard-coded allow-lists. Imported Security/BSM/proc APIs [V]:
`xpc_dictionary_get_audit_token`, `audit_token_to_pid`, `SecTaskCreateWithAuditToken`,
`SecCodeCopyGuestWithAttributes` (+ `kSecGuestAttributeAudit`, `kSecGuestAttributePid`),
`SecCodeCopySigningInformation`, `SecCodeCopyStaticCode`, `SecCodeCopySelf`,
`kSecCodeInfoTeamIdentifier`, `kSecCodeInfoIdentifier`, `proc_pidpath`, `proc_pidinfo`,
`proc_listpids`, `getpid`. For the Unix socket the peer audit token comes from
`getsockopt(...LOCAL_PEERTOKEN...)` (strings `LOCAL_PEERTOKEN failed errno=`, `invalid peer token
length:`, `couldNotGetSenderPID -10017`). [V]

### 2.1 What it computes about a caller [V for the fields; I for exact algorithm]
Types `ComputerUse.ComputerUseIPCSenderAuthorization`, its nested `ProcessIdentity`,
`ComputerUseIPCSenderContextResolver`, and `ComputerUseIPCSenderContext`
(`INT/service.addr-demangled.tsv`). `SenderContext` fields (strings `INT/service.strings.txt` L43000+):
`senderPID, parentIdentity, responsibleIdentity, ancestorIdentities, clientType, mcpRuntime,
codexManaged, standalone`. A `ProcessIdentity` (strings `codeSignature, bundleIdentifier,
executableName, teamIdentifier, identifier`) is built from each of: the **sender** process, its
**parent**, its **responsible** process (`responsibility_get_pid_responsible_for_pid`-style — via
`proc_pidinfo`), and the **ancestor chain** (walked via `proc_pidinfo`/`proc_pidpath`, hence
`ancestorIdentities`, `ancestor_depth`, `has_trusted_ancestor`). [V fields; I the chain-walk mechanism.]

### 2.2 The trust decision [V for the lists; I for exact predicate]
The server holds two requirement structs (Swift reflection field names in `__constg_swiftt`,
`INT/service.strings.txt`): **`trustedProcessRequirement`** and **`allowedRelayRequirement`**, each a
set of `{teamIdentifiers, identifiers/signingIdentifiers, executableNames}` (strings
`teamIdentifiers, identifiers, executableNames` adjacent). The concrete allow-list values sit as Swift
`String` constants in `__data` at `0x1013d3de0…0x1013d3fd8` (dumped `INT/`): team ids **`2DC432GLL2`**
(OpenAI, repeated), **`MQ55VZLNZQ`**, **`HX7739G8FX`**; signing/executable names **`codex-acp`**,
**`node`**, **`node_repl`**; plus the accepted host bundle-id list (strings L29119+):
`com.openai.codex[.alpha/.beta/.dev/.nightly]`, `com.openai.chat[.alpha/.beta/.nightly/.mac-debug]`,
`com.openai.atlas[.alpha/.beta]`, `com.openai.sky.app`. [V that these strings exist and are the trust
material; I on how team-vs-identifier-vs-executable are combined per row.]

`clientType` resolves to one of `codexManaged / desktopManaged / nodeRepl / standalone / legacyMcp`
and transport to `nativeBridge / appleEvent / jsonRpcSocket` (strings `INT/client.strings.txt` L28700).
Authorization-failure reasons (enum): **`missingParent`, `untrustedParent`,
`relayWithoutTrustedAncestor`** (strings, both binaries). Telemetry event
`CodexComputerUseIpcRequestFailed` records `sender_responsible_{team_id,signing_id,bundle_id,executable}`,
`sender_parent_{team_id,signing_id,executable}`, `has_trusted_ancestor`, `ancestor_depth`,
`authorization_failure_reason`, `client_type`, `transport` (`INT/service.strings.txt` L25281, L28680). [V]

### 2.3 What makes it reject a non-OpenAI process [V/I]
Reconstructed predicate: a caller is served only if its own code-signing identity **and** a trusted
ancestor satisfy the requirement — team must be one of `{2DC432GLL2, MQ55VZLNZQ, HX7739G8FX}` and the
signing/executable identity must match (`node`/`node_repl` for the Codex-CLI Node runtime that opens the
socket, `codex-acp`, or an accepted OpenAI bundle id), with the parent/responsible/ancestor also trusted
(`parentProcessIsCodex`; else `untrustedParent`/`missingParent`/`relayWithoutTrustedAncestor`). A process
signed by any other Team ID, or ad-hoc/unsigned, is rejected with **`senderProcessNotAuthenticated`
(-10000)** before any action runs. Because the check is on the live audit token, you cannot spoof it from
JS — the socket is opened by the trusted `node_repl` host binary (`nodeRepl.nativePipe.createConnection`),
not by arbitrary Node. [V that -10000 exists and is the gate; I on the full boolean.]

**MAWS implication:** a Claude Code harness (Electron `com.anthropic.*`, or `node`/`claude` signed by
Anthropic's Team ID) fails every arm of this test. There is no config/entitlement toggle to add a Team
ID; the lists are compiled into the binary and the app is notarized+hardened-runtime, so patching it
violates its signature (and MAWS D-1 forbids patching engines anyway — though that rule is about the
Claude engine, the same "don't patch a signed vendor binary" logic applies). Reuse would require OpenAI
to add your Team ID to `trustedProcessRequirement`, i.e. a business dependency, not an engineering one.

`MQ55VZLNZQ` / `HX7739G8FX`: additional trusted Team IDs (likely the standalone Codex CLI distribution
and/or a Node signing identity). Not confirmed against a registry — **open question**.

---

## 3. Perception — capture + accessibility tree

### 3.1 Screen capture [V/I]
**ScreenCaptureKit**, per-window. Imports: `SCShareableContent, SCStream, SCStreamConfiguration,
SCScreenshotManager, SCStreamFrameInfo{Status,BoundingRect,ContentRect}` (`INT/service.fixups.txt`);
CoreGraphics only for geometry (`CGDisplayBounds`) — no `CGWindowListCreateImage`, no
`CGDisplayCreateImage`. So the agent screenshot ("Skyshot") is an SCK capture scoped to the target app's
key window, not a full-display grab. [V] Types: `SkyshotOperation.Capture`, `ComputerUseSkyshotAttachment`,
`RefetchableSkyshotAXTree`, `SkyshotClassifier`. Encoding via `CGImageDestination` + `compressionQuality`
+ `scaleFactor` (strings). Model coordinates are scaled: fields `scalingFactor, scaledScreenSize,
scaledScreenSize, cursorPositionInScaledCoordinates, visibleRect` (strings L28300). So the model sees a
downscaled window image and works in scaled coordinates that the service maps back to real points. [V
fields; I the exact scale target — no fixed pixel dimension string found.]

### 3.2 Accessibility tree [V/I]
Extraction is pure **AX (ApplicationServices)** — a broad import set:
`AXUIElementCreateApplication/CreateSystemWide/CopyAttributeValue(s)/CopyMultipleAttributeValues/
CopyParameterizedAttributeValue/CopyActionNames/CopyActionDescription/IsAttributeSettable/GetPid`,
`AXObserverCreateWithInfoCallback/AddNotification`, `AXValue*`, `AXTextMarkerRange*` (`INT/service.fixups.txt`).
`AXIsProcessTrusted` gates on the Accessibility TCC grant. [V]
Serialization lives in module **`ComputerUseCore`**: `UIElementRenderTree` (with
`NextAvailableElementIDIterator` → the stable integer element indices the model clicks by),
`UIElementRender`, `AccessibilityTreePresentation`, `AccessibilityRoleKind`, `UIElementFlattenedRole`,
`TransformedUIString`, `UIElementURLShortener`. Roles/values are normalized (`AccessibilityValueType`:
float/integer/boolean/string/date/unknown). [V]
**Diffing:** `UIElementRenderDifference`, `RefetchableSkyshotAXTree`, and strings "The following is a diff
from the previous accessibility tree / with ~, +, and - representing changed, added, and removed
elements", "cumulative diff from the initial accessibility tree", "There has been no change in the
accessibility tree for". So after the first full tree, subsequent `get_app_state` calls can return a
**diff** (`disableDiff` opts out). [V]
**Truncation/budget:** `AccessibilityDifferenceLineBudgetExceeded`, `AXTruncationDescriptor`,
`textTruncationDescriptor`, `recursionBudget`, `maxDepth`, `[truncated to visible range]` — the tree is
depth- and line-budgeted and text is truncated, to bound tokens. [V]
Target apps are forced to expose a full tree via an **AX enablement assertion**
(`AXEnablementAssertion`, `axEnablementAssertion`, `AXEnablementOperation`) — i.e. it sets
`AXEnhancedUserInterface`/`AXManualAccessibility` on the target while a session is active. [V name; I the
specific attribute.]
**No OCR/vision:** no Vision/VNRecognizeText import. Screenshots are for the model's own vision; the
service does not run OCR. It ships `SystemSelection*` (reads the user's current text selection) and a
`MessagesDatabase`/`SQLite` reader, but no local OCR. [V]

### 3.3 Package contributions [I from names]
`ComputerUse` = the controller/session/policy/overlay logic. `ComputerUseCore` = AX tree rendering/diff
model. `Appshot` = the *user-facing* capture feature (shutter sound `Appshot.wav`, animated
`AppshotCaptureTransitionOverlayWindow`, a keyboard shortcut) — separate from the agent Skyshot. `SlimCore`
= shared runtime utilities. `GraphicsSupport`/`Fog` = the "Lens"/software-cursor rendering
(`FogCursorStyle`, `SkyLensView`). [I]

---

## 4. Action — how clicks/keys/scroll are executed

**Hybrid: AX actions for element-targeted ops, soft-linked CGEvent/NSEvent synthesis for pointer/keyboard.**

- **AX path** [V]: `AXUIElementPerformAction` (secondary actions, menu/press), `AXUIElementSetAttributeValue`
  (`setValue`, `selectText` via settable selected-text-range). Strings: "is not a valid secondary action
  for", "Cannot set a value for an element that is not settable", "Cannot select text for an element that
  does not support a settable selected text range", "Failed to click menu item".
- **Synthetic-event path** [V/I]: CoreGraphics event APIs are **soft-linked** (module `SoftLink`, dlopen/
  dlsym) — that is why no `CGEventPost`/`CGEventCreate*` appears in the static bind table, yet the strings
  carry the whole vocabulary: `CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGEventTapOptions,
  CGEventTapPlacement, CGEventType, CGEventField, CGEventFlags, failedToCreateCGEvent, keyboardEventTap,
  mouseEventTaps, SynthesizedEvent, MouseEventType, MouseEventTarget, KeyboardEventTarget,
  EventTargetingError, NCGEventRef, NCGEventSourceRef` (`INT/service.strings.txt` L22437+). It also uses
  NSEvent constructors that target a **specific window** — `mouseEventWithType:location:modifierFlags:
  timestamp:windowNumber:context:eventNumber:clickCount:pressure:` and `otherEventWithType:…` (L51610),
  with `windowNumberAtPoint:belowWindowWithWindowNumber:`. So it can post events to a chosen window. [V
  strings; I that CG functions are resolved via SoftLink rather than statically.]
- **Focus/cursor behaviour** [V/I]: it **does** take over pointer/focus during an action. Types
  `SyntheticAppFocusEnforcer`, `SystemFocusStealPreventer` (+ `DisallowedThiefProcess`, `thiefAppPID`,
  `FocusStealSuppression`), `focusEnforcer`, `activateWithOptions:`, `SetFrontProcessOptions`,
  `frontmostApplicationTracker/Observer`. Reading: it briefly activates the target app, enforces that the
  synthetic events land there, and suppresses *other* apps stealing focus mid-action (a "thief"
  process). It renders a **software agent cursor** (`ComputerUseCursor`, `AgentCursor`,
  `SoftwareCursorStyle`, `MotionConfiguration`, `CursorMotionPath`) — the animated Lens dot — while
  driving events; whether it also warps the real hardware cursor is unresolved (no
  `CGWarpMouseCursorPosition` import seen; the agent cursor may be purely drawn). **Open question.** [I]
- **Keyboard** [V]: `+[SAIVirtualKeyPress keyPressesForString:]` maps text to keycodes using the current
  keyboard layout ("Unable to get current keyboard layout", "Could not find key code for character").
  `press_key` uses **xdotool keysym names** (`Return, Tab, Escape, KP_0, super+c, Up`… full keysym table
  at L27977 — this is the keysym map, not the overlay). [V]
- **Paste** [V]: writes the clipboard and waits for the app to read it ("Timed out waiting for the
  application to read the clipboard", "The user may have conflicted with your paste operation…"), i.e.
  clipboard + paste keystroke, with conflict detection.

### 4.1 Overlay, Lens, Esc-to-cancel [V/I]
- Overlay text comes from `~/.codex/computer-use/config.json`:
  `{"accentColor":"#339cff", …, "strings":{"usingComputer":"ChatGPT is using your computer",
  "escToCancel":"Esc to cancel"}}` (read [V]). Rendered by the service (`OverlayWindowLevelReasons`,
  `SkyLensView`, `SkyLensViewRepresentable`); 45-frame Lens animation in `LensSequence/`. [V]
- **Cancellation / user intervention** [V/I]: `UserInterruptedIntervention`, `InterventionReason`,
  `computerUseAppControllerDidReceiveUserInterruption`, `ComputerUseAppInstanceManager.
  UserInterruptedIntervention` → error `userIntervened` (-10016). Any real user input during an action
  (including Esc, and the paste-conflict case) aborts the turn. The `physicalInputMonitor`/`onPhysicalInput`
  strings I found are on the lock-screen path (`SystemLockScreenPhysicalInputMonitor`); the overlay-Esc
  detection is most likely an event tap/NSEvent monitor feeding the same intervention path. [I on the
  exact Esc mechanism — worth a wave-2 probe.]

---

## 5. App policy on the native side

- **Per-session approvals** [V]: `~/.codex/computer-use/sessions/<uuid>.toml`, each `[apps] allowed =
  [bundleId, …]` (observed live: three files, e.g. `allowed = ["com.apple.finder"]`,
  `["com.haegi.ClaudeUsage"]`). `ComputerUseIPCAppPolicyRequest` returns a decision +
  `allowPersistentApproval`; approvals are keyed by session and can be persisted. Decisions:
  `ComputerUseIPCAppPolicyDecision` (rawValue string; values include allow/deny/forbidden per strings
  `allowed/denied/forbidden`). MCP-side approval strings: "Allow ChatGPT to use <app>", persistence
  telemetry `computer_use_mcp_approval_persistence`. [V]
- **Blocked / special-cased apps** [V]: hard lists in `__cstring` (L29100+). Password managers &
  security surfaces are blocked: `com.apple.keychainaccess, com.apple.Passwords, com.1password.1password,
  com.1password.safari, com.bitwarden.desktop, com.dashlane.dashlanephonefinal, com.lastpass.LastPass,
  com.nordsec.nordpass, me.proton.pass.{electron,catalyst}`, plus `com.apple.ScreenContinuity` and a
  generic "Computer use actions are not allowed for system security process:" guard. Terminals
  (`com.apple.Terminal, iterm2, Warp, kitty, wezterm, ghostty, rio, waveterm, alacritty, hyper, tabby`)
  and browsers (`Safari, Chrome/Chromium, Edge, Opera, Vivaldi, Arc/Dia (thebrowser), Brave, Comet,
  Atlas`) are enumerated for *special handling* (browser URL policy + incognito detection), not
  necessarily blocked. [V]
- **Browser URL policy** [V]: `ComputerUseURLBlocklistCache`, `ComputerUseURLPolicyChecking`,
  `blockedURL` (-10015), and the session-ending message "Computer Use is not allowed on the current
  browser URL…". Incognito/private windows are detected (large localized "Incognito/Inkognito/…" table).
  There is a docs.google regex (`#/(?i)(?:^|\.)docs\.google\.[a-z.]+$/#`). [V]
- **AppInstructions** [V]: `Package_ComputerUse.bundle/Contents/Resources/AppInstructions/{Slack,Notion,
  Clock,Numbers,iPhone Mirroring,AppleMusic,Spotify}.md`. These are per-app model guidance strings
  delivered into the model context when that app is used — the client tracks
  `bundleIdentifiersWithDeliveredInstructions` and wraps them in `<app_specific_instructions>…
  </app_specific_instructions>` (client strings). Read in full; e.g. Slack.md tells the model to prefer
  `set_value` over `type_text` to avoid sending, Notion.md covers block editing, Numbers.md covers
  cell entry. [V]
- **Skysight** [V] (background passive-context recorder, module `ComputerUse.SkysightService`):
  `SkysightSummarizer.md` (a full system prompt for an LLM that turns a local event stream into 10-min/6-h
  activity summaries, with an extensive prompt-injection "security boundary" — treats all observed screen
  content as untrusted) and `SkysightMemoryInstructions.md` (how those summaries feed
  `$HOME/.codex/memories/extensions/skysight/resources/`). Controlled by the Skysight IPC requests
  (§1.3), with observation rules/scopes and pause/clear. Read in full. [V]
- **Messages / Contacts** [V]: `MessagesService`, `MessagesDatabase` (reads the local Messages SQLite via
  `MessagesCore`+`SQLite`), `ContactsCore`. Entitlements `com.apple.security.personal-information.
  addressbook` (Contacts) and `com.apple.security.automation.apple-events` (AppleEvents) back the send
  flow. `NSAppleEventsUsageDescription`="By default, ChatGPT sends messages only after you approve the
  message and its recipients." The MCP `send_message` requires an elicitation approval and supports
  user-edited text (`user_edited`); read/search are permission-gated with "Never allow" per-chat settings.
  Full tool descriptions captured in `INT/client.strings.txt` L14139+. [V]

---

## 6. SkyComputerUseClient — subcommands, MCP tools, service reach, the abort

### 6.1 Subcommands [V] (`SkyComputerUseClient --help`, inert)
`cua <subcommand>`: **`mcp`** (Computer Use MCP server), **`event-stream mcp`** (Record & Replay),
**`computer-history mcp`** (Computer History), **`calendar mcp`**, **`messages mcp`**, **`turn-ended`**
(`cua turn-ended [--previous-notify <p>] <payload>` — handles a Codex turn-ended notification). Built with
swift-argument-parser. The bundled Codex plugin `~/.codex/plugins/cache/openai-bundled/computer-history`
runs `SkyComputerUseClient computer-history mcp`. [V]

### 6.2 MCP tools exposed [V] (descriptions from `INT/client.strings.txt`)
- **Computer Use (`cua mcp`)**: `list_apps`, `get_app_state` ("Start an app use session if needed, then
  get the state of the app's key window and return a screenshot and accessibility tree. This must be
  called once per assistant turn before interacting with the app"), `click`, `perform_secondary_action`,
  `set_value`, `select_text`, `scroll`, `drag`, `press_key` ("supports xdotool's `key` syntax"),
  `type_text`. Each write returns "Action completed. Call `get_app_state` to fetch the updated UI state."
  Telemetry `computer_use_mcp_tool_called`, `computer_use_mcp_app_approval_{requested,resolved}`. [V]
- **Record & Replay (`event-stream mcp`)**: `event_stream_start` ("Start recording the user's actions
  for up to 30 minutes…"), `event_stream_status`, `event_stream_stop`; MCP elicitation approval "Allow
  ChatGPT to record your actions on your Mac?" [V]
- **Computer History (`computer-history mcp`)**: pause/resume/status/get-settings/update-settings for the
  Skysight recorder ("Get Computer History status and paths to recent activity files.", etc.). [V]
- **Messages (`messages mcp`)**: `find_chats, read_messages, search_messages, send_message,
  count_message_activity, read_image` — full descriptions captured. [V]
- **Calendar (`calendar mcp`)**: present as a subcommand; server-side handler is a
  `CalendarPlaceholderRequest` stub (no real tools yet). [I]

### 6.3 How the client reaches the service, and the parent-trust requirement [V]
`SkyComputerUseClient.app/Contents/Resources/SkyComputerUseClient_Parent.coderequirement` is a plist
`{team-identifier: 2DC432GLL2}` (read [V]). The client validates that its **parent** process is signed by
Team ID `2DC432GLL2` before relaying to the service. Transport class
`ComputerUseClient.ComputerUseIPCXPCTransport` (`sendRequest(requestTypeName:requestData:
codexMetadataData:fileHandles:)`, `MachReceivePort`), plus `CodexAppServerJSONRPCConnection` for talking
back to `codex app-server`. [V]

### 6.4 Why `cua mcp` answers `initialize` then aborts before `tools/list` [I, high-confidence]
The MCP `initialize` handshake is answered locally (no service needed). But the client (or the service on
the first real call) enforces the parent/ancestor trust check: launched standalone from a shell, its
parent is Terminal/login-shell, not a `2DC432GLL2`-signed Codex — failing
`SkyComputerUseClient_Parent.coderequirement`, yielding `missingParent`/`untrustedParent`/
`relayWithoutTrustedAncestor` (client strings) and, on the socket, `senderProcessNotAuthenticated`
(-10000). The process then exits rather than list tools. So the earlier probe's abort is the
**parent-trust gate**, not a protocol bug. Confirmable in wave 2 (see below). [I]

---

## 7. Linked frameworks, entitlements, profile, Sparkle, BUILD

- **Frameworks** (`INT/service.otool-L.txt`): ScreenCaptureKit, ApplicationServices, CoreGraphics,
  AppKit, SwiftUI, QuartzCore, AVFoundation/AVFAudio (audio recording), Contacts, EventKit, Intents,
  CoreLocation, WebKit, Security, Network, OSLog, libbsm. Client links the same minus AVFoundation-heavy
  and ScreenCaptureKit-lite subset. [V]
- **Service entitlements** (`codesign -d --entitlements`): `application-identifier
  2DC432GLL2.com.openai.sky.CUAService`, `team-identifier 2DC432GLL2`, `application-groups
  [2DC432GLL2.com.openai.sky.CUAService]`, **`com.apple.security.automation.apple-events = true`**,
  **`com.apple.security.personal-information.addressbook = true`**, `keychain-access-groups [2DC432GLL2.*]`.
  **No App Sandbox entitlement** (`com.apple.security.app-sandbox` absent) — it is a hardened-runtime,
  notarized, non-sandboxed daemon, which is what lets it drive AX/CGEvent across other apps. [V]
- **Client entitlements**: same minus apple-events/addressbook; id `…CUAService.cli`. [V]
- **Designated Requirement** (both): `identifier "…" and anchor apple generic and certificate 1
  [field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate
  leaf[subject.OU] = "2DC432GLL2"` — standard Developer ID DR. Signed **Developer ID Application: OpenAI
  OpCo, LLC (2DC432GLL2)**, hardened runtime (flags 0x10000), timestamped 2026-09-23. [V]
- **Provisioning profile** (`INT/service.provisionprofile.plist`): "CUA Service", `ProvisionsAllDevices`,
  OSX, expires 2044, groups `[group.com.openai.sky.CUAService, 2DC432GLL2.*]`. Client profile adds
  `group.com.openai.sky.Service`. [V]
- **Sparkle** (Info.plist): `SUFeedURL =
  https://oaisidekickupdates.blob.core.windows.net/mac/cua/alpha/appcast.xml`, `SUPublicEDKey =
  5Yw9jMXMH6O3mJZmpFuQT6ECfC3ZKBfVjWUVMNrElRo=`, `SUVerifyUpdateBeforeExtraction`, automatic updates on.
  The feed URL returns **HTTP 403 AuthorizationFailure** (Azure blob needs a SAS token) to an
  unauthenticated fetch (`INT/security/appcast.{xml,headers}`) — the "alpha" channel is gated. [V]
- **Min OS** 14.4; built with Xcode 26.1 SDK; `LSUIElement`. Bazel: `macos_application` "CUAService",
  deps as in §0. [V]

---

## Portability verdict for MAWS (why this is a decision input)

1. **Cannot be reused as-is by a Claude harness.** The service gates every request on the caller's live
   code-signing identity + trusted OpenAI ancestor (§2). A non-`2DC432GLL2` process gets -10000. No
   entitlement/config toggle exists; the allow-lists are compiled in and the binary is notarized/hardened.
   Reuse = OpenAI adding your Team ID to `trustedProcessRequirement` = a partnership, not integration work.
2. **The socket is opened by a trusted host, not by Node.** `nodeRepl.nativePipe.createConnection`
   (a `node_repl` host function) opens `computeruse.sock`; the peer audit token is that trusted binary.
   You cannot substitute your own Node process and inherit trust.
3. **What *is* reusable is the design, and it is a strong reference for MAWS's own controller:**
   - AX-first perception with **stable integer element ids**, **tree diffing** (`disableDiff`), and
     **depth/line/text budgets** to bound tokens — the right shape for an agent that must not blow context.
   - A **soft-linked CGEvent + NSEvent(windowNumber:) action layer** with **focus-steal prevention** and
     an **AX-enablement assertion** to force full trees — the hard parts of "drive real apps reliably".
   - **Layered safety**: per-session `[apps] allowed` TOML, compiled block-lists for password managers /
     security surfaces, browser URL blocklist + incognito detection, per-app model instruction files, and
     a Skysight summarizer whose prompt treats all screen content as untrusted (prompt-injection defense).
   - A clean **requestType/JSON-RPC-over-uds** contract (length-prefixed, 8 MiB, deadline-bearing) that
     MAWS could mirror for its own controller if it builds one.
   A MAWS-native controller would re-implement this stack (ScreenCaptureKit + AX + soft-linked CGEvent),
   sign it with Anthropic's Team ID, and own its own policy — which is the realistic path if MAWS wants
   native computer use for Claude agents.

---

## Open questions

1. **Exact trust predicate.** Are `trustedProcessRequirement` vs `allowedRelayRequirement` combined as
   "sender must satisfy trusted AND some ancestor must satisfy relay", or a looser OR? Need the disasm of
   the resolver/authorization functions (their symbols are stripped/`<redacted>`; must be found by
   xref from the `__data` trust-list addresses).
2. **`MQ55VZLNZQ` / `HX7739G8FX` identities.** Which OpenAI/Node signing entities are these?
3. **Real cursor movement.** Does an action warp the hardware cursor, or is only the software Lens cursor
   drawn? No `CGWarpMouseCursorPosition` import seen — needs a live observation.
4. **Esc-to-cancel mechanism.** Event tap vs NSEvent global monitor for the overlay Esc (distinct from the
   lock-screen physical-input monitor).
5. **Skyshot scale target.** Exact downscaled dimensions/quality (`scaleFactor`/`compressionQuality`
   values) the model receives — no literal pixel constant found in strings.
6. **codexTurnMetadata trust.** Confirm nothing signs/validates it server-side (I found no HMAC/verify),
   i.e. it is trusted purely via sender authentication.

## Proposed wave-2 experiments (designed; not run this wave)

- **E1 — parent-trust confirmation (safe).** Under `log stream --predicate 'process ==
  "SkyComputerUseService" OR process == "SkyComputerUseClient"'`, run `SkyComputerUseClient mcp` from a
  plain shell and send only `initialize`; capture the exact failure token
  (`missingParent`/`untrustedParent`/`relayWithoutTrustedAncestor`/`senderProcessNotAuthenticated`) and
  the `CodexComputerUseIpcRequestFailed` analytics fields. Confirms §6.4. Read-only except starting one
  MCP process (which this wave forbids; hence deferred).
- **E2 — socket auth from a non-OpenAI process (safe, expected reject).** Connect to `computeruse.sock`
  from a small Anthropic/ad-hoc-signed test client, send `ping`. Expected: version handshake may return,
  but `request` → `senderProcessNotAuthenticated` (-10000). Establishes exactly which step rejects and
  whether `ping` alone is gated. (Explicitly out of scope this wave — no socket connections.)
- **E3 — action mechanism trace.** With a live authorized session, `sample SkyComputerUseService` and
  `log stream` during a click/type on a **background** window; check whether events reach a non-frontmost
  window and whether the hardware cursor moves. Resolves Q3.
- **E4 — disasm xref of the authorizer.** Offline: xref the trust-list `__data` addresses
  (`0x1013d3de0…`) and the audit-token/`SecCodeCopyGuestWithAttributes` call sites in
  `INT/service.disasm.txt` to recover the exact predicate. Resolves Q1 without touching the system.
- **E5 — Skyshot scale.** Offline: disasm `SkyshotOperation.Capture`/`SCStreamConfiguration` setup to read
  the width/height/quality constants. Resolves Q5.
