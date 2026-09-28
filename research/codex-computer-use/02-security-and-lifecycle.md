# Codex Computer Use — Security Perimeter and Native Lifecycle

> **Correction (2026-09-28, wave 2).** Live tests refine §0 and §1e. The effective check is on the sender and its **immediate parent**. OpenAI's signed `node` satisfies it whatever script it runs, so a non-OpenAI harness that launches `cua-repl.mjs` is accepted without any Codex ancestor. The allowlists decoded here are real. See `README.md` §7 and §9, and `spikes/computer-use-probe/findings.md` §1.

Layer 02 of the Codex desktop computer-use reverse-engineering wave. Scope: the
security perimeter and lifecycle of the **native** side (the Swift service bundle,
its helpers, the SecurityAgent authorization plugin, TCC, launch/update). IPC
request types, perception/action internals, the JS API, node_repl internals and
the Electron UI belong to other researchers; handoff points are noted, not
followed.

Build under study: `Codex Computer Use.app` **26.923.1001242**
(`com.openai.sky.CUAService`, team **2DC432GLL2**), installed at
`~/.codex/computer-use/` and byte-identical to the copy inside
`ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky/`. Host app:
`ChatGPT.app` 26.924.22138 (`com.openai.codex`).

Large intermediates (codesign dumps, strings, symbols, disassembly slices, the
adrp/xref and cs-blob scripts) are under
`~/codex-app-src/readable/cua-service-26.923/security/`.

Verification convention: **[V]** = verified against a tool result this session;
**[I]** = inferred from evidence, reasoning stated.

---

## 0. TL;DR for the MAWS decision

- The native controller is **not** a generic "any signed caller" service. The
  Swift service (`SkyComputerUseService`) authenticates every IPC connection by
  the peer's **audit token**, resolves the sender's parent and full ancestor
  chain, and admits a request only if some ancestor matches one of four
  **hardcoded code-signing allow-lists** baked into the binary. A non-OpenAI
  harness (e.g. Claude Code) driving this service would be rejected as
  `UNTRUSTED_PARENT` / `RELAY_WITHOUT_TRUSTED_ANCESTOR` unless it is signed with
  an allow-listed team + signing-id, or it re-hosts OpenAI's `node`/`node_repl`
  as the connecting process. **This is the single biggest reuse blocker.** [V]
- The allow-lists (decoded from the binary) are: (a) an OpenAI relay pair
  `node`/`node_repl` under teams `2DC432GLL2` or `HX7739G8FX`; (b) team
  `2DC432GLL2`; (c) Codex/ChatGPT app bundle-ids; (d) a **Zed** entry (team
  `MQ55VZLNZQ`, signing-id `codex-acp`). The Zed entry is direct evidence OpenAI
  already whitelists a *specific third-party harness* by signature. [V]
- OpenAI installs a **root SecurityAgent authorization plugin** at
  `/Library/Security/SecurityAgentPlugins/` and rewrites the
  `system.login.screensaver` authorization right so a locked Mac can be
  **auto-unlocked** during an active computer-use turn. It is installed on this
  machine. This is a large, load-bearing, privileged component with real
  security weight. [V]

---

## 1. The trust chain

### 1a. Per-executable code-signing table

All signatures: `Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)` → Apple
Developer ID CA → Apple Root; hardened runtime enabled (`flags=0x10000(runtime)`)
on every executable. The service's `embedded.provisionprofile` is a
Developer-ID / direct-distribution profile (`ProvisionsAllDevices = true`,
`AppIDName "CUA Service"`, expires 2044). Source:
`security/codesign-service-bundle.txt`, `codesign-chatgpt.txt`. [V]

| Executable | Bundle / signing id | DR (designated requirement) | Entitlements of note | Launch constraints |
|---|---|---|---|---|
| Service `SkyComputerUseService` | `com.openai.sky.CUAService` | id + anchor apple generic + Dev-ID leaf + OU=2DC432GLL2 | app-group `2DC432GLL2.com.openai.sky.CUAService`; `automation.apple-events`; `personal-information.addressbook`; keychain `2DC432GLL2.*` | none [V] |
| Client `SkyComputerUseClient` | `com.openai.sky.CUAService.cli` | id + anchor apple + Dev-ID + OU | same app-group; keychain `2DC432GLL2.*` (no addressbook/apple-events) | none [V] |
| Guardian `CUALockScreenGuardian` | `com.openai.sky.CUAService.guardian` | id + anchor apple + Dev-ID + OU | **none** | none [V] |
| Installer app `Codex Computer Use Installer` | `com.openai.sky.CUAService.AuthorizationPluginInstaller` | id + anchor apple + Dev-ID + OU | empty dict | none [V] |
| Installer tool `CodexComputerUseAuthorizationPluginInstallerTool` | ad-hoc id `…InstallerTool-55554944…` | id + anchor apple + Dev-ID + OU | `application-identifier 2DC432GLL2.com.openai.sky.app.CodexComputerUseAuthorizationPluginInstallerTool` | none [V] |
| Auth plugin `CodexComputerUseAuthorizationPlugin.bundle` | `com.openai.sky.CUAService.AuthorizationPlugin` | id + anchor apple + Dev-ID + OU | none | none [V] |
| `node` (in ChatGPT.app) | id `node` | id + anchor apple + Dev-ID + OU | app-sandbox=false; app-groups incl. `2DC432GLL2.com.openai.sky.CUAService`; `allow-jit`; `allow-unsigned-executable-memory`; apple-events; audio/camera/calendars; user-selected files | none [V] |
| `node_repl` (in ChatGPT.app) | id `node_repl` | id + anchor apple + Dev-ID + OU | identical set to `node` | none [V] |
| ChatGPT host `com.openai.codex` | `com.openai.codex` | id + anchor apple + Dev-ID + OU | **notarized/stapled**; app-groups incl. `2DC432GLL2.com.openai.sky.CUAService`; apple-events; camera/audio; calendars; user-selected files; keychain `2DC432GLL2.*`, `com.openai.shared` | none [V] |
| `codex` (CodexCLI.app app-server) | `com.openai.codex.cli` | id + anchor apple + Dev-ID + OU | notarized; `allow-jit`; keychain `com.openai.codex.cli` | none [V] |
| `codex-code-mode-host` | id `codex-code-mode-host` | id + anchor apple + Dev-ID + OU | `allow-jit`, `allow-unsigned-executable-memory` | none [V] |

Notes:
- `Resources/codex-cli/bin/codex` is an **unsigned shell shim** that `exec`s
  `CodexCLI.app/Contents/MacOS/codex`; the real binary is signed+notarized. [V]
- No executable ships **launch constraints** (LC blob slots 8/9/10/11 absent):
  parsed by `security/cs_blobs.py`. Peer/parent trust is therefore enforced *in
  application code*, not by the kernel's launch-constraint machinery. [V]
- The shared **app-group `2DC432GLL2.com.openai.sky.CUAService`** is what lets
  ChatGPT, `node`, `node_repl` and the service share the group container that
  holds the IPC socket (`~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`). A caller outside team 2DC432GLL2 cannot join
  this group container. [V]

### 1b. The runtime peer-trust model (the real gate)

The service class `ComputerUseIPCServer` owns `senderAuthorization`,
`senderContextResolver`, and per-connection context with fields
`senderPID, parentIdentity, responsibleIdentity, ancestorIdentities, clientType,
mcpRuntime, codexManaged, standalone, codeSignature, bundleIdentifier,
executableName, teamIdentifier, identifier` (Swift reflection strings, `strings-service.txt` ~L43016–43040). [V]

Mechanism (symbols + disassembly, `symbols-service.txt`,
`disasm-service-ipc-requirements.txt`, `authz.asm`):
- Peer identity is taken from the connection's **audit token**
  (`xpc_dictionary_get_audit_token` / `LOCAL_PEERTOKEN` on the JSON-RPC socket),
  then `SecTaskCreateWithAuditToken` → `SecCode…` + `kSecCodeInfoTeamIdentifier` /
  `kSecCodeInfoIdentifier`. There is a Swift type `SkyIPCRequirement` with
  `Criterion.evaluate(senderAuditTokenData:)`, `isFromSameTeam()`,
  `isFromDeveloperTeam(_:)`. [V]
- Failure reasons enumerated in the binary:
  `…AUTHORIZATION_FAILURE_REASON_MISSING_PARENT`, `…_UNTRUSTED_PARENT`,
  `…_RELAY_WITHOUT_TRUSTED_ANCESTOR`; analytics carry
  `has_trusted_ancestor`, `ancestor_depth`, `sender_parent_{team_id,signing_id,executable}`,
  `sender_responsible_{team_id,signing_id,bundle_id,executable}`. Client types:
  `LEGACY_MCP`, `NODE_REPL`, `NATIVE_BRIDGE`. [V]
- The decision routine (`0x1001703d8` region) resolves the sender context, tests
  the **responsible/parent identity** against a "trusted process requirement"
  and, if that is a relay (node/node_repl), then walks the **ancestor chain**
  requiring a trusted ancestor; a relay with no trusted ancestor →
  `relay_without_trusted_ancestor`. Return codes 0/1/2/3 map to
  deny/allow-variants observed in the branch. [I — control flow read from
  disassembly; exact enum mapping inferred]

### 1c. The four hardcoded allow-lists (decoded from the binary)

Four global `SkyIPCRequirement`s are built once and consulted at authorization
time. Decoded from the Swift static string arrays they reference (script logic in
`security/`, values dumped from `__data`/chained-fixups). [V]

1. **Relay requirement** (`G1`): teams **`2DC432GLL2`** OR **`HX7739G8FX`**;
   signing-ids **`node`, `node_repl`**; executable-names **`node`, `node_repl`**.
   → the OpenAI-shipped Node relay hosting `@oai/sky`. [V]
2. **Team requirement** (`G2`): team **`2DC432GLL2`**. [V]
3. **Codex/ChatGPT app requirement** (`G3`): bundle-ids
   `com.openai.codex[.alpha|.beta|.dev|.nightly]` and
   `com.openai.chat[.alpha|.beta|.nightly|.mac-debug]`. [V]
4. **Zed requirement** (`G4`): team **`MQ55VZLNZQ`**, signing-id **`codex-acp`**.
   `codex-acp` is Zed's Agent-Client-Protocol adapter for Codex; team
   `MQ55VZLNZQ` = Zed Industries. → OpenAI whitelists Zed's harness by
   signature. [V for the strings; I for the Zed attribution]

Also present in the same table region: a `--sandbox/read-only/exec/--json/
--ephemeral/--thread-source/--ignore-rules` argv template and a browser/terminal/
password-manager bundle-id catalog (used elsewhere for URL/app policy, not IPC
auth). `HX7739G8FX` is a second Apple team id trusted for the node relay; likely
an OpenAI secondary/CI signing team (not matched to any app installed here). [I]

### 1d. The `.coderequirement` files (decoded)

Both `CUALockScreenGuardian_Parent.coderequirement` and
`SkyComputerUseClient_Parent.coderequirement` are **XML property lists**, not
compiled `csreq` blobs (that is why `csreq -r` errors on them). Each contains
exactly:

```
{ "team-identifier": "2DC432GLL2" }
```

So the guardian and the client each verify that **their parent process** is
signed by team 2DC432GLL2 before trusting it. The plist is read by the helper and
evaluated via `SecCode`/team-id APIs at runtime (both link Security.framework and
import `SecTaskCopyTeamIdentifier`-style checks). [V for contents; I for the
"parent is checked at runtime" reading, supported by the `_Parent` naming, the
Mach-rendezvous strings, and the `sender_parent_team_id` telemetry]

### 1e. Who-trusts-whom (summary)

- **Service trusts a caller** iff the caller (or a responsible ancestor) matches
  G1–G4 above, evaluated from the audit token. Everyone else →
  MISSING/UNTRUSTED_PARENT. [V]
- **node/node_repl** are the sanctioned relay: they open the socket for the JS
  `@oai/sky` client, and the service treats them as a relay whose *ancestor*
  (ChatGPT / codex app-server) must itself be trusted. [V]
- **Guardian trusts its parent** = the service (team 2DC432GLL2). [V/I]
- **Client trusts its parent** = team 2DC432GLL2. [V/I]
- **Auth plugin trusts its socket peer** = the service, verified by signing-id +
  team id (see §3). [V]
- The whole set is **Developer-ID direct-distribution**, so a peer only needs a
  valid OpenAI (or Zed) signature; nothing here requires notarization at the IPC
  boundary. [I]

---

## 2. CUALockScreenGuardian

**What it is.** `CUALockScreenGuardian.app` (`com.openai.sky.CUAService.guardian`,
LSUIElement, 23 MB, no entitlements). It links the same media/AX/ScreenCaptureKit
stack as the service and carries the same `Package_ComputerUse.bundle` +
`AppInstructions` resources, i.e. it is essentially a second instance of the
computer-use engine specialized for the lock screen. [V]

**What it exists for.** Lock-screen continuity of an in-progress computer-use
turn. The *service* binary already contains the lock-screen state machine —
`SystemLockScreenMonitor` (observes `com.apple.screenIsLocked/Unlocked`,
`…screenLockUIIsShown`), `SystemLockScreenController` (drives
`UserPasswordTextField` via AX), `SystemLockScreenOverlayPresenter` (shows the
"**ChatGPT is Using Your Mac / Press any key or click to unlock**" overlay),
`LockScreenAutoUnlockCoordinator`, `LockScreenGuardianCoordinator`,
`SystemLockScreenPhysicalInputMonitor`, and
`LockScreenLoginAuthorization{Broker,Attempt,SocketServer}`. The guardian is the
helper the coordinator launches so an overlay/assertion survives at the
loginwindow/screensaver layer where the main service's windows cannot draw. [V
for the class inventory; I for the exact division of labor]

**How/by whom launched, and what it checks.** The service and guardian connect
via a **Mach bootstrap rendezvous** (`SAIMachBootstrapRendezvous`; guardian
strings: "Could not look up/register the Guardian Mach bootstrap rendezvous
port", `rendezvousName`, `portForName:`). The guardian verifies its parent
against `CUALockScreenGuardian_Parent.coderequirement` (team 2DC432GLL2, §1d). It
is not a LaunchAgent; there is no guardian plist in `~/Library/LaunchAgents`. [V
for rendezvous + parent requirement; I for "service spawns it on demand"]

**Locked vs. unlocked.** The design both (a) keeps the session alive and visibly
signals it while locked, and (b) can *drive* the unlock UI (type into the
password field) and, in the auto-unlock path, coordinates with the SecurityAgent
plugin (§3) to approve the unlock. Physical input by the human pauses auto-unlock
("automatic unlock is paused because physical input was detected. Ask the user to
unlock the Mac manually"). So it is about **acting on a locked Mac**, not merely
staying alive. [V]

---

## 3. Installer, installer tool, and the SecurityAgent authorization plugin

**Layout.** Inside the service bundle:
`SharedSupport/Codex Computer Use Installer.app`
(`com.openai.sky.CUAService.AuthorizationPluginInstaller`) contains
`Resources/CodexComputerUseAuthorizationPluginInstallerTool` and
`Resources/CodexComputerUseAuthorizationPlugin.bundle`. [V]

**What it does (from strings + on-disk state).** The installer app is a thin CLI
(`usage: … install|uninstall|status`) that uses
`AuthorizationExecuteWithPrivileges` with right `system.privilege.admin` to run
the privileged **installer tool** as root. The tool
(`install|uninstall|status RESOURCE_DIR`):
- Copies the plugin to
  **`/Library/Security/SecurityAgentPlugins/CodexComputerUseAuthorizationPlugin.bundle`**,
  sets `root:wheel` ownership and hardened perms. [V]
- Via `/usr/bin/security authorizationdb`, creates the custom right
  **`com.openai.sky.CUAService.AuthorizationPlugin.remote`** (class
  `evaluate-mechanisms`, mechanism **`CodexComputerUseAuthorizationPlugin:allow`**),
  and rewrites **`system.login.screensaver`** to the rule
  `[ com.openai.sky.CUAService.AuthorizationPlugin.remote, use-login-window-ui ]`.
  The original rule is **backed up** to
  `/Library/Application Support/CodexComputerUseAuthorizationPlugin/backups/…`
  with a `latest-backup-manifest.plist`, so `uninstall` restores stock behavior
  ("OK: Uninstalled. Stock screen-unlock behavior restored."). [V]

**Right touched:** `system.login.screensaver` (screen-unlock), plus the two
OpenAI custom rights above. Not `system.login.console`. [V]

**Is it installed here?** **Yes.** [V]
- `/Library/Security/SecurityAgentPlugins/CodexComputerUseAuthorizationPlugin.bundle`
  exists, `root:wheel`, valid signature, satisfies its DR. Installed plugin
  version is **26.812.1000717** (older than the 26.923 bundled copy — the plugin
  was installed by an earlier build and not refreshed). [V]
- `security authorizationdb read system.login.screensaver` returns the rewritten
  rule with `com.openai.sky.CUAService.AuthorizationPlugin.remote` first. [V]
- The custom right and the backup (`system.login.screensaver.20260815-…plist`
  containing the stock `use-login-window-ui` rule) are present. [V]

**What the plugin does at unlock time.** The plugin
(`MechanismInvoke`) connects to the UNIX socket
**`/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock`** (that
socket is currently open by the running service, fd 11), reads the peer's audit
token, and verifies the peer is the CUA service by **signing-id + team-id**
("Login authorization socket peer is not the expected Codex Computer Use
service"; imports `SecTaskCopySigningIdentifier`, `SecTaskCopyTeamIdentifier`,
`SecTaskCreateWithAuditToken`). If the service reports an **active Computer Use
login authorization pending**, the mechanism returns **Allow** (auto-unlock);
otherwise it defers to the normal login-window UI. Comment string:
"Screen-unlock branch that asks SkyComputerUseClient whether an active Computer
Use login authorization is pending." [V]

**Interpretation for MAWS.** This is a privileged, root-installed extension of
the OS login/authorization stack whose sole purpose is to let the agent unlock a
locked Mac while it is working. It is the highest-trust component in the whole
system. Reusing it from a non-OpenAI harness is not merely a signing problem: the
plugin only ever answers a socket peer that is the OpenAI service, so any reuse
would still funnel through the OpenAI service's own authorization gate. [I]

---

## 4. TCC permissions the design needs, and which bundle id must hold each

The **service** (and its guardian twin) is the process that performs perception
and actions, so it is the TCC principal. Evidence = imports + entitlements +
usage strings. [V]

| Capability | Evidence | Holder (bundle id) |
|---|---|---|
| **Accessibility** (AXUIElement read + `PerformAction`/`SetAttributeValue`, `AXIsProcessTrusted`) | service/guardian import the full `AX*` surface | `com.openai.sky.CUAService` (+ `.guardian`) [V] |
| **Screen Recording** (`SCShareableContent`, `CGPreflight/RequestScreenCaptureAccess`) | service/guardian imports | `com.openai.sky.CUAService` (+ `.guardian`) [V] |
| **Automation / Apple Events** | entitlement `com.apple.security.automation.apple-events` on service, `node`, `node_repl`, host; `NSAppleEventsUsageDescription`; `apple_events_com.apple.MobileSMS` for Messages | `com.openai.sky.CUAService`; also host + relay [V] |
| **Contacts** | entitlement `com.apple.security.personal-information.addressbook`; `NSContactsUsageDescription`; links Contacts.framework | `com.openai.sky.CUAService` [V] |
| **Calendars** | entitlement `com.apple.security.personal-information.calendars` on host/node/node_repl; client has `CalendarMCPServer` | host `com.openai.codex` / relay [V] |
| Camera / Microphone | entitlements on host/node/node_repl (device.camera/audio-input) | host / relay [V] |
| Full Disk-ish (Messages `chat.db`) | `Library/Messages/chat.db`, `MessagesSender` | service (needs the relevant TCC grant) [V] |

Input Monitoring is not evidenced as a distinct requirement; synthetic input is
issued through the AX action path and CoreGraphics, and the physical-input
*monitor* is used only to pause auto-unlock. No TCC.db was read or touched. [V]

**MAWS implication:** whoever plays the "service" role must itself hold
Accessibility + Screen Recording (per-bundle-id, non-transferable TCC grants). A
Claude harness reusing OpenAI's service inherits OpenAI's grants under
`com.openai.sky.CUAService`; a *rebuilt* service would need its own grants under
its own bundle id and a fresh user consent. [I]

---

## 5. "normal" vs "relaxed" variants

`@oai/sky/package.json` (`publishConfig.executableFiles`) lists two full sets of
mac binaries: **`bin/mac/normal/…`** and **`bin/mac/relaxed/…`**, covering
service, guardian, installer, installer tool, auth plugin, client. This install
ships **only the package-root `Codex Computer Use.app`** (no `bin/mac/*`
directory present) — i.e. a single variant is delivered per install, with the
tarball-time choice already made upstream. [V]

I found **no runtime selector** for normal-vs-relaxed in the shipped JS
(`native-pipe.js`, `service.js`, `create_client.js`, `load_options.js`) or in the
Electron config: grep for `relaxed` across `@oai/*` matches only `package.json`
and unrelated leveldb source. The distinction is a **build/packaging** property
(most plausibly a hardened "normal" vs. a loosened-for-testing "relaxed"
signing/entitlement profile), resolved when the platform tarball is assembled,
not chosen on the user's machine. [I — absence-of-evidence for a runtime switch;
worth a wave-2 probe if it matters]

Env overrides that *do* select behavior at runtime (from `native-pipe.js`):
`SKY_CUA_SERVICE_NATIVE_PIPE_PATH`, `SKY_CUA_SERVICE_PATH`,
`NODE_REPL_HOST_SERVICES_PIPE_PATH`, `CODEX_HOME`. These pick socket/app paths,
not the normal/relaxed flavor. [V]

---

## 6. Native lifecycle: start, update, and the two copies

### 6a. Start

Two start paths in the trusted transport `@oai/sky/.../mac/native-pipe.js`
(`MacNativePipeTransport.create`): [V]
1. Connect directly to the group-container socket
   `…/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`. If absent →
2. If `NODE_REPL_HOST_SERVICES_PIPE_PATH` is set, send JSON-RPC
   `{"method":"ensureService","params":{"service":"computer-use"}}` over the
   **node_repl host pipe** (the host process, not the JS, opens the socket — this
   is the "the service checks the connecting process's signature" hook). Else →
3. Fall back to `nodeRepl.launchServices.openApplication` with, in order,
   `SKY_CUA_SERVICE_PATH`, else `$CODEX_HOME/computer-use/Codex Computer Use.app`,
   else `bundleIdentifier: com.openai.sky.CUAService`. Then reconnect (5 s
   budget), and `ping` to check `serverApiVersion` compatibility. [V]

Observed on this machine (`ps`/`launchctl`): the service (pid 6872) runs as
`com.apple.xpc.launchd.unmanaged.SkyComputerUseS.6872` **parented under
ChatGPT** (pid 697), i.e. an on-demand LaunchServices spawn, **not** a persistent
LaunchAgent. There is a `com.openai.codex.MachPortRendezvousServer.697`. No
OpenAI/sky/cua entries in `~/Library/LaunchAgents`. The service terminates when
no clients remain (`shouldTerminateWhenNoClientsRemain`). [V]

Config wiring (`~/.codex/config.toml`, other researcher owns the Electron side —
noted as handoff): `[mcp_servers.node_repl]` sets
`NODE_REPL_TRUSTED_SERVICES = {"sky":"@oai/sky/service", …}` and
`SKY_CUA_SERVICE_PATH = ~/.codex/computer-use/Codex Computer Use.app`. The
`[mcp_servers.computer-use]` (client `mcp`) entry is `enabled = false`; the live
path is node_repl → `@oai/sky`. `notify` points at the client `turn-ended`. [V]

### 6b. Update (Sparkle)

Service `Info.plist`: `SUFeedURL =
https://oaisidekickupdates.blob.core.windows.net/mac/cua/alpha/appcast.xml`,
`SUAllowsAutomaticUpdates`/`SUAutomaticallyUpdate`/`SUEnableAutomaticChecks =
true`, `SUVerifyUpdateBeforeExtraction = true`, and an EdDSA key
`SUPublicEDKey = 5Yw9jMXMH6O3mJZmpFuQT6ECfC3ZKBfVjWUVMNrElRo=`. So the native
service is a self-updating Sparkle app on the "alpha" channel with signed-update
verification. The `SkyComputerUseService` binary itself does not statically link
a Sparkle framework (`otool -L` shows only system libs), so the update is
orchestrated from the host/installer side using these plist keys, or Sparkle is
loaded from the host app. Fetching the appcast returned HTTP **403
AuthorizationFailure** (Azure blob requires a SAS token), so its contents were
not retrieved. [V]

### 6c. Relationship of the two copies

The `~/.codex/computer-use/Codex Computer Use.app` and the copy inside
`ChatGPT.app/.../@oai/sky/Codex Computer Use.app` are the **same build**
(26.923.1001242) per the research README and identical Info.plists; the
`~/.codex` copy is the **installed, runnable, auto-updating** instance (the one
running as pid 6872 and resolved by `SKY_CUA_SERVICE_PATH`/`CODEX_HOME`), while
the in-app copy is the **pristine payload** shipped with ChatGPT that seeds/repairs
the `~/.codex` install. Sparkle updates the `~/.codex` copy in place from the
appcast. The Electron code that performs the initial copy/seed is another
researcher's area (handoff point: `install:computer-use` script referenced in
`@oai/sky/package.json` and the host's first-run install flow). [I, supported by
V facts: identical build, `SKY_CUA_SERVICE_PATH` target, Sparkle keys]

---

## 7. The `computer-history` plugin

`computer-history` is a **separate MCP surface on the same client binary**, not a
separate service. The bundled plugin
(`~/.codex/plugins/cache/openai-bundled/computer-history/1.0.1001242`) launches
`bin/computer-use-client-launcher computer-history mcp`, which `exec`s the very
same `SkyComputerUseClient` (`cua computer-history mcp` — confirmed via the
client's inert `--help`: subcommands `mcp, event-stream, computer-history,
calendar, messages, turn-ended`). It keeps a **local, opt-in activity record**
("Ask ChatGPT about what you were doing recently"); the client hosts a
`ComputerHistoryMCPServer` and the *service* owns the storage/segments
(Skysight/`EventStream…`, `event-stream` scope enums, `sessions/*.toml`
allow-lists like `com.haegi.ClaudeUsage`). So computer-history **shares the same
native service** (same `com.openai.sky.CUAService` process and group container);
it is a different MCP entrypoint and skill over the same engine, gated by a
user-enabled setting ("Enable Computer History in Codex Settings first"). Two
`SkyComputerUseClient computer-history mcp` instances are currently running as
children of the app-server. [V]

---

## Open questions

1. **Exact enum for the auth decision (0/1/2/3).** I read the branch structure
   (relay → ancestor-walk; direct match; deny) but did not fully pin which return
   value is "allow-once" vs "allow-relay" vs "deny". Needs targeted decomp of
   `0x1001703d8`/`0x100170718`. [I]
2. **`HX7739G8FX` identity.** Trusted alongside 2DC432GLL2 for the node relay;
   not matched to any installed app. Likely an OpenAI secondary/CI team — unproven.
3. **Zed reuse contract.** The `codex-acp`/`MQ55VZLNZQ` allow-list entry proves
   third-party reuse is *possible by signature*, but not what additional
   ancestor/relay conditions Zed must satisfy, nor whether it uses the JSON-RPC
   socket directly or via node_repl.
4. **normal vs relaxed.** Confirmed as build-time; the concrete signing/
   entitlement delta between the two variants is unknown (only one ships here).
5. **Sparkle appcast contents / update cadence** (403 without SAS token).
6. **Whether the JSON-RPC socket accepts a direct, non-relay peer** that itself
   matches G2/G3/G4 (i.e., can a signed app connect without node_repl?). The
   `NATIVE_BRIDGE` client type and direct-socket path in `native-pipe.js` suggest
   yes, but the ancestor requirement may still apply.

## Proposed wave-2 experiments (designed, not run)

- **E1 — Rejection fingerprint.** From an *unsigned* / non-allow-listed process,
  `connect()` to `computeruse.sock` and send a `ping`. Expected: immediate close
  or an error whose analytics reason is `UNTRUSTED_PARENT`/`MISSING_PARENT`.
  Confirms the gate empirically and reveals whether rejection is pre- or
  post-handshake. Read `log show --predicate 'subsystem CONTAINS "openai"'` for
  the `cua_ipc_*` failure fields. (Connecting to the socket is out of scope this
  wave; run under the wave that permits live IPC.)
- **E2 — Relay-ancestor test.** Launch OpenAI's `node_repl` with
  `NODE_REPL_TRUSTED_SERVICES` under a **non-Codex parent** (a plain shell) and
  attempt `@oai/sky`. Expected `RELAY_WITHOUT_TRUSTED_ANCESTOR` — proves whether
  a third party can borrow the relay without a Codex/ChatGPT ancestor. This
  directly answers the MAWS reuse question.
- **E3 — Signature-match test.** Build a tiny harness signed with a team id and
  connect; observe whether team-only (G2) is sufficient or an app/bundle-id or
  relay identity is also required. (Requires an Apple Developer signing identity;
  purely to characterize the gate, no privilege escalation.)
- **E4 — Auth-plugin path (observation only).** With the plugin installed, lock
  the screen during an active turn and capture `log stream` around
  `LockScreenLoginAuthorization.sock` and the SecurityAgent to confirm the
  auto-unlock Allow/Deny flow and the peer-verification failure messages. No
  bypass; observation of the sanctioned flow.
- **E5 — Sparkle appcast** with a valid SAS token (if obtainable) or capture the
  host's actual update request via a proxy, to learn channel/versioning.
