# 05: How the Codex desktop host wires in native computer use

> **Correction (2026-09-28, wave 2).** §4.2's reading of `sessions/*.toml` as the earlier era's storage is wrong: the files are live, written by `node_repl` and keyed by `x-codex-turn-metadata.session_id`. See `README.md` §9 and `spikes/computer-use-probe/findings.md` §3.

Researcher 5 of 6, layer: the Electron host (ChatGPT.app 26.924.22138, macOS, bundle `com.openai.codex`, build flavor `prod`).
Date: 2026-09-28. Method: static reading of the readable source, read-only inspection of the installed app, `~/.codex` and
`~/Library/Group Containers`, plus `ps` of the running processes. Nothing was started, killed, connected to or modified.

Citation shorthand (all under `~/codex-app-src/readable/`):

| tag | file |
|---|---|
| `main` | `chatgpt-26.924/main-process/main-C5425b_s.js` |
| `srcB5` | `chatgpt-26.924/main-process/src-B5IOaahd.js` |
| `ans` | `chatgpt-26.924/main-process/application-network-startup-CY4ZWOz-.js` |
| `boot` | `chatgpt-26.924/main-process/bootstrap-CzzsHphT.js` |
| `worker` | `chatgpt-26.924/main-process/worker.js` |
| `r/<chunk>` | `chatgpt-26.924/renderer/app/<chunk>` |
| `m917` | `chatgpt-26.917/main-process/main-C-Mhak1n.js` |
| `m623` | `codex-26.623/main-process/main-8XtuV7fZ.js` |
| `sky-np` | `cua-node-0.0.24/node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/mac/native-pipe.js` |

**V** = Verified (read in code, on disk or in a live process). **I** = Inferred (reasoned from strong evidence, not observed end to end).
Identifiers are minified; each citation quotes a distinctive string near it.

---

## 0. What is load-bearing (summary)

1. **Nothing is downloaded for computer use on macOS.** The `cua_node` runtime (Node 24.21.0-cua.1, `node_repl`, `@oai/sky`,
   `@oai/cua`, `@oai/cua-repl`) and the service app both ship inside `ChatGPT.app/Contents/Resources/cua_node`. The README's
   "selected runtime / downloaded Node" language describes the packaging step and dev overrides, not a runtime download. (V, §1)
2. **Desktop provisions the agent path by writing files, then gets out of the way.**
   - It rewrites the `unified-computer-use` plugin's `.mcp.json` with absolute paths and env, and updates `mcp_servers.node_repl`
     in `config.toml` through `config/batchWrite` (§1.4).
   - It copies `Codex Computer Use.app` into `~/.codex/computer-use/` with `ditto` on every launch (§2.1).
   - It writes `~/.codex/computer-use/config.json` (overlay strings, accent colour, locale) before each thread start (§4.1).
   - Its only other computer-use writes are user settings: revoking always-allowed apps, the service's `defaults` sound keys, and
     the Locked-use installer.
3. **Desktop spawns and supervises the service itself** through `sky.node` (`spawnComputerUseService`), keeps its PID, and talks
   to it over **Apple Events addressed by PID** (`'SkCu'/'SndR'`, client API `CodexComputerUseNativeBridge-1`), not over
   `computeruse.sock`. The socket is the agent's path (`cua_repl` → `@oai/sky`); Apple Events are the host's control plane
   (menu bar, stop-application, permissions onboarding, appshots, Chronicle). (V, §2.2, §2.4)
4. **The `ensureService` host-services pipe exists only in internal builds** (Dev, Agent, Nightly, InternalAlpha). In this prod
   install no process carries `NODE_REPL_HOST_SERVICES_PIPE_PATH`; the JS client falls back to LaunchServices-opening
   `SKY_CUA_SERVICE_PATH`, and in practice finds the service already running because Desktop eagerly spawned it. (V, §2.3)
5. **Peer authorization is real, but guards Electron-served pipes, not the service socket.** `browser-use-peer-authorization.node`
   requires a connecting process to descend from the ChatGPT process and be signed by team `2DC432GLL2`. (V/I, §3)
6. **App approval is a standard MCP elicitation.** Desktop gives it a computer-use card, but the persistence lives elsewhere.
   - `@oai/sky` asks through `nodeRepl.createElicitation` with `_meta.connector_id = "computer-use"` and `persist: ["session","always"]`.
   - Codex relays it as the app-server server request `mcpServer/elicitation/request`. The renderer renders a dedicated card and
     answers `{action, content, _meta:{persist}}`.
   - "Always" lands in `ComputerUseAppApprovals.json` in the service's group container, whose writer is most likely `node_repl`.
     Desktop only lists and revokes it.
   - The `~/.codex/computer-use/sessions/<codex-thread-id>.toml` files are keyed by Codex thread id. The newest predates 26.917,
     so their writer in the current build is unconfirmed. (V/I, §4 and §5)
7. **Turn-end cleanup on macOS is done by Codex plugin hooks, not by Desktop.** `unified-computer-use/.codex-plugin/plugin.json`
   binds `Stop`, `Interrupt` and `SubagentStop` to the MCP tool `cua_repl.turn_ended`. Desktop only watches `turn/completed`
   to tidy its picture-in-picture (PiP) window. (V, §7)
8. **Direction:** 26.623 shipped a direct Swift MCP server (`SkyComputerUseClient mcp`) for prod; 26.917 replaced it with one
   JS REPL MCP server (`cua_repl`) that multiplexes browser and desktop control, with the Swift service demoted to a
   runtime asset of the `cua_node` package. (V, §8)

---

## 1. Runtime provisioning and plugin materialization

### 1.1 Where `cua_node` comes from

- **Bundled, fixed path (V).** The runtime root is `<resourcesPath>/cua_node` (`ans:3204` `var Jt = "cua_node"`, `ans:3642-3659`
  `vn()` joins `H ?? resourcesPath` with it). `node` and `node_repl` are resolved as `cua_node/bin/<name>` (`ans:3319-3340`, `on()`/`sn()`),
  and module dirs as `cua_node/lib/node_modules` (`ans:3341-3355`, `cn()`). `H` is an "app package core" override used on Windows.
- **Manifest (V, on disk).** `/Applications/ChatGPT.app/Contents/Resources/cua_node/manifest.json`:
  `node_version "24.21.0-cua.1"`, `runtime_archive_name "cua-node-0.0.24-20260924074400-f52ea85e2a98-darwin-arm64.tar.gz"`,
  `runtime_archive_version "0.0.24/20260924074400-f52ea85e2a98"`, `node_repl_path "bin/node_repl"`.
  The main process never reads `runtime_archive_version`; the only `runtimeArchive*` hit is the separate primary-runtime installer
  (`ans:6506`). The version is therefore a build-time pin, not a runtime-selection input (V by grep).
- **Selection and overrides (V).** `vi()` (`main:6044-6150`) resolves three executables, each with an env override first:
  `CODEX_CLI_PATH` (`main:6066`), `CODEX_BROWSER_USE_NODE_PATH` (`main:6080`), `CODEX_NODE_REPL_PATH` (`main:6103`). Otherwise it
  uses the bundled path, and in unpackaged dev builds the repo checkout. If no bundled `node` exists it falls back to the
  **primary runtime** (`main:6093-6097`, `source: "primary-runtime"`). The primary runtime is a different, downloaded bundle
  under `~/.cache/codex-runtimes/codex-primary-runtime` from `https://persistent.oaistatic.com` (`ans:5876`, `ans:6468-6511`,
  User-Agent `codex-primary-runtime-installer`) that serves the documents and presentations plugins. It is not the `cua_node` runtime.
- **Codex CLI (V).** On macOS `<resources>/codex-cli/CodexCLI.app/Contents/MacOS/codex` (`ans:3486-3496`). The live app-server is
  `codex -c features.code_mode_host=true app-server --analytics-default-enabled -c plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true`
  (V, `ps`; args built at `ans:16252`, `ans:16977`).

### 1.2 How the plugin gets from the app to `~/.codex`

This happens in three stages.

1. **Packaging time (V).** The app bundle already contains
   `Resources/plugins/openai-bundled/plugins/unified-computer-use/.mcp.json`. It is **byte-identical** to
   `cua_node/lib/node_modules/@oai/cua-repl/plugin/.mcp.template.json` (`cmp`): `"command": "node"`, `"args": []`, `"enabled": false`,
   `enabled_tools ["js","js_reset","turn_ended"]`, `omit_tools_from ["code_mode","deferred"]`, `js.output_token_limit 25000`.
   The bundled `plugin.json` differs from the package copy only in `version` (`26.924.22138` against `0.1.0`). So the README's
   "Desktop copies `@oai/cua-repl/plugin` … renames `.mcp.template.json`" happens in the Desktop **build**. No runtime code
   references `cua-repl/plugin` or `.mcp.template.json`; the only `cua-repl` hit is the bin path at `main:6607`.
2. **Runtime marketplace materialization (V).** At startup `_re()` (`main:8142-8330`) copies the bundled marketplace into
   `~/.codex/.tmp/bundled-marketplaces/openai-bundled`. It stages under `.staging-<uuid>`, writes the marketplace manifest,
   copies each plugin, writes `.materialization-key` (`main:7412`) and renames into place. The key is JSON
   `{version, appVersion, bundleId, marketplaceName, computerUseAudioEnabled, …, plugins:[{name,version}]}`. The on-disk key
   lists `unified-computer-use 26.924.22138`, `computer-use 1.0.1001242` and `computer-history 1.0.1001242`. A matching key
   short-circuits the copy (`bundled_plugins_runtime_marketplace_reused`).
3. **Install into the plugin cache (V).** Codex app-server installs the plugin to
   `~/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/` (path rule `srcB5:7092-7108`, `id()`:
   `<codexHome>/plugins/cache/<marketplace>/<plugin>/<localVersion|local>`). The plugin registry marks it
   `unifiedComputerUse: {hidden: true, installWhenMissing: true, excludeFromExecutor: false, mcpServerName: "cua_repl"}`
   (`srcB5:3240-3246`).

### 1.3 Availability gates for the plugins (V)

- `unified-computer-use` is available when `browserUseTinysky && (inAppBrowserUse || externalBrowserUse || computerUse)` (`main:15763-15766`).
- `computer-use` (the skills-only plugin) is available on darwin and win32 when `computerUse` is on (`main:15785-15789`). It carries
  `installWhenMissingRequiresOptIn: true` (`srcB5:3255-3259`). Auto-install happens only if the user opted in, or if the
  `computerUseAutoInstall` feature is on (`main:16396-16404`, `n.name !== "computer-use" || !t.desktopFeatureAvailability.computerUseAutoInstall`).
  The opt-out key is `COMPUTER_USE_BUNDLED_PLUGIN_AUTO_INSTALL_DISABLED` (`srcB5:3297-3300`).
- `computer-history` requires `skysight`, and `messages` requires `messages` (`main:15790-15801`).
- The `cua_repl` surface list is computed by `Ao()` and `Lre()` (`main:9584-9656`, `main:9700-9725`). `computer` is included only if
  all of the following hold:
  - `browserUseTinysky` is on;
  - the host is not WSL;
  - the bundled `node` and `node_repl` were found;
  - the app-server passes the capability check `mcpToolExposure` (≥ `0.147.0`, `srcB5:2546`);
  - `unified-computer-use` is installed, enabled and `AVAILABLE`;
  - the platform is darwin, `computerUse` is on, and the `computer-use` plugin is installed and enabled;
  - a service app path resolved.

### 1.4 The `.mcp.json` rewrite (the env and where each value comes from)

`Nie()` (`main:11039-11127`) runs on startup and after plugin changes (`syncAfterPluginChange`, `main:11019-11031`). The steps:

1. `Ao()` selects the surfaces. `Xo()`/`Oie()` then build a `node_repl` config **without private process env**
   (`hostServicesPipePath: null, includePrivateProcessEnv: false`, `main:11077-11083`).
2. `Dne()` (`main:6569-6617`) reads the installed plugin's `.mcp.json` and sets `cua_repl.enabled`, `env_vars` and `env`, plus
   `command = NODE_REPL_NODE_PATH` and `args = [<NODE_REPL_NODE_MODULE_DIRS>/@oai/cua-repl/bin/cua-repl.mjs]`. It then writes
   atomically (`.tmp-<uuid>` then `rename`) only if the content changed.
3. `Oo()` (`main:9493-9583`) deletes the legacy `skills/computer-use/SKILL.md` from the `computer-use` plugin once `cua_repl` owns
   the `computer` surface. This is verified on disk: the cached `computer-use/1.0.1001242/skills/` is empty, while the staging copy
   still has `skills/computer-use/SKILL.md`.
4. `config/batchWrite` (`main:11118-11124`) replaces `mcp_servers.node_repl` in `~/.codex/config.toml`, nulls
   `shell_environment_policy.set.{BROWSER_USE_AVAILABLE_BACKENDS,NODE_REPL_TRUSTED_CODE_PATHS}` (`main:11129-11141`), and sets
   `mcp_servers.cua_repl` to `null` if the plugin's `cua_repl` is enabled. Otherwise it writes the disabled stub
   `{command: process.execPath, enabled: false}` (`main:6549-6554`).
5. `qi()` (`main:6560-6568`) blanks `NODE_REPL_INSTRUCTIONS_USE_CASE_{BROWSER,CHROME,COMPUTER_USE}` in the **generic** `node_repl`
   entry for surfaces that `cua_repl` now owns. This is confirmed in `config.toml`, where they are `""`. Note that the generic
   `node_repl` still lists `"sky":"@oai/sky/service"` in `NODE_REPL_TRUSTED_SERVICES`; only the model-facing hint is removed.

The resulting env of `cua_repl` (live file `~/.codex/plugins/cache/openai-bundled/unified-computer-use/26.924.22138/.mcp.json`, V):

| var | value on this machine | computed by |
|---|---|---|
| `command` | `…/Resources/cua_node/bin/node` | `NODE_REPL_NODE_PATH` of the node_repl config (`main:6606`) |
| `args[0]` | `…/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs` | module dir + fixed suffix (`main:6607`) |
| `NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS` | `1000` | constant (`srcB5:3151`) |
| `NODE_REPL_NODE_MODULE_DIRS` | `…/cua_node/lib/node_modules` | `cn()` via `kie()` (`main:10985-10987`) |
| `NODE_REPL_NODE_PATH` | `…/cua_node/bin/node` | `vi().nodePath` |
| `NODE_REPL_TRUSTED_CODE_PATHS` | `~/.codex:…/cua_node/lib/node_modules` | `[codexHome, moduleDirs]` (`srcB5:3154`) |
| `CODEX_HOME` | `~/.codex` | `a.nt()` |
| `BROWSER_USE_AVAILABLE_BACKENDS` | `chrome,iab` | `externalBrowserUse` → chrome, `inAppBrowserUse` → iab (`main:9624-9630`) |
| `BROWSER_USE_TINYSKY_ENABLED` | `1` | `browserUseTinysky` gate |
| `NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE` | "Control desktop apps on macOS through Computer Use." | `main:10767`, only when `computerUse` and darwin |
| `NODE_REPL_INSTRUCTIONS_USE_CASE_{BROWSER,CHROME}` | fixed strings | `main:10764-10766` |
| `BROWSER_USE_CODEX_APP_BUILD_FLAVOR` / `_VERSION` | `prod` / `26.924.22138` | build metadata |
| `NODE_REPL_TRUSTED_SERVICES` | `{"browser":"@oai/browser-desktop/service","sky":"@oai/sky/service"}` | `Dne` overrides the node_repl value (`main:6593-6599`) |
| `SKY_CUA_SERVICE_PATH` | `~/.codex/computer-use/Codex Computer Use.app` | `wne()`/`Tne()` (`main:6467-6505`): env override, else the canonical copy if it exists |
| `CODEX_CLI_PATH` | `…/codex-cli/CodexCLI.app/Contents/MacOS/codex` | `vi().codexCliPath` (for the node_repl sandbox) |
| `CUA_REPL_NODE_REPL_PATH` | `…/cua_node/bin/node_repl` | node_repl command (`main:6603`) |
| `CUA_REPL_ENABLED_SURFACES` | `browser,computer` | `Ao()` surfaces |
| `env_vars` | `[]` | pass-through names; would contain `NODE_REPL_HOST_SERVICES_PIPE_PATH` only in internal builds (`main:10965-10971`) |

Conditional values not present here (V, `main:10899-10980`):
- `NODE_REPL_ENFORCE_MODEL_CHECK=1` when `nodeReplEnforceModelCheck` is on.
- `NODE_REPL_ENABLE_AUDIO`/`SKY_ENABLE_AUDIO` only if both are already set in the host env.
- `NODE_REPL_TRACE_META=1` for internal flavours.
- `NODE_REPL_SENTRY_USER_ID` and `NODE_REPL_REQUEST_META` (dev) go only into the per-thread config, never onto disk.
- `SKY_CUA_SERVICE_NATIVE_PIPE_PATH` is passed only in Dev.

Live check (V, `ps eww`, names only): the running `cua-repl.mjs` (pid 17050) carries exactly this env set. Its child
`node_repl` additionally carries `NODE_REPL_JS_BANNER`, `NODE_REPL_TOOL_OVERRIDES` and `NODE_REPL_UNTRUSTED_ENV_ALLOWLIST`, which the
launcher adds. Neither they nor the app-server (pid 5488) carry `NODE_REPL_HOST_SERVICES_PIPE_PATH`.

**Per-thread config (V).** `ns()` (`main:11143-11165`) rebuilds the `node_repl` entry **with** private env for every thread.
`buildMcpCodexConfig` (`main:131848-131888`) feeds it as `thread/start` `config` overrides through `readCodexConfig`/`fetchCodexConfig`
(`main:88006`, `main:58286-58302`). If `cua_repl` is not enabled, that override also carries the disabled `mcp_servers.cua_repl` stub.

---

## 2. Service provisioning, lifecycle and the host control plane

### 2.1 Getting `Codex Computer Use.app` into `~/.codex/computer-use`

- **Source (V).** `ise()` (`main:17322-17346`) looks for the app at, in order:
  1. `CODEX_ELECTRON_COMPUTER_USE_APP_PATH`;
  2. `<resources>/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app` (`main:6454`, `bne`);
  3. `<resources>/cua_node/lib/node_modules/@oai/sky/bin/mac/normal/Codex Computer Use.app`.
  The first match is realpath'd.
- **Copy (V).** `ese()` (`main:17141-17156`) runs **on every macOS launch** (`main:245303-245314`, "Failed to sync canonical
  Computer Use service app during startup"). It does `mkdir -p ~/.codex/computer-use`, `rm -rf` the old copy, then
  `/usr/bin/ditto --noqtn <src> ~/.codex/computer-use/Codex Computer Use.app`. The only opt-out is
  `CODEX_ELECTRON_SKIP_COMPUTER_USE_CANONICAL_REFRESH=1`. There is no version comparison, no signature verification in JS, and
  no check whether the service is running. `--noqtn` strips quarantine so Gatekeeper does not prompt.
- **Result (V).** `diff -rq` of the bundled and installed apps reports them identical. Both are signed
  `Identifier=com.openai.sky.CUAService`, `Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)`, version `26.923.1001242`,
  `LSUIElement = true`.
- **Normal vs relaxed (V/I).** `@oai/sky/package.json` lists both `bin/mac/normal/…` and `bin/mac/relaxed/…` executables, but
  ChatGPT.app ships `@oai/sky/bin/` **empty** and places one variant at `@oai/sky/Codex Computer Use.app`. The only fallback
  hard-coded in main is `normal` (`main:17340`). No JS in main or in `cua_node` mentions `relaxed`, so the variant choice happens at
  Desktop build time (V). What "relaxed" relaxes is unknown from this layer (I: likely client-validation or hardening
  differences for non-Desktop or training hosts; see open questions).
- **Bundle contents (V, `ls`).** `SharedSupport/` contains `SkyComputerUseClient.app`, `CUALockScreenGuardian.app` and
  `Codex Computer Use Installer.app`, the last carrying `CodexComputerUseAuthorizationPlugin.bundle` and
  `CodexComputerUseAuthorizationPluginInstallerTool`. Desktop runs `…/Codex Computer Use Installer status|install|uninstall`
  (`main:108084-108148`, expecting `"OK: installed"`) for the "Locked Computer Use" toggle ("Use your Mac apps while locked";
  `plugins.installModal.lockedComputerUse.*`). I: this installs a SecurityAgent authorization plugin so the service can work
  while the screen is locked.

### 2.2 Starting and supervising the service

- **Managed service (V).** The class at `main:17157-17320` (logger `managed-computer-use-service`) holds
  `serviceExecutablePath = <app>/Contents/MacOS/SkyComputerUseService`.
  - It is enabled if any of `appshotsEnabled`, `computerUseEnabled` or `skysightEnabled` is true.
  - `setEnabledFeatures()` runs on every feature-availability update from the renderer (`main:245400-245418`). It calls
    `ensureServicePidForEnabledFeatures()`, so **Desktop spawns the service eagerly as soon as the `computerUse` gate is on**,
    not lazily on first tool call.
  - Spawn goes through `sky.node`'s `spawnComputerUseService(path)` (`main:14265-14285`).
  - Liveness is checked with `kill(pid,0)` plus `ps -o state=` (not a zombie) and
    `computerUseServiceProcessMatchesExecutablePath(pid, path)` (`main:14286-14310`).
  - A stale PID is replaced ("Replacing stale managed service", reason `executable-mismatch` or `process-exited`). A respawn
    triggers a Chronicle reconcile.
- **Live confirmation (V, `ps`).** `SkyComputerUseService` pid 6872 has **ppid 697 = ChatGPT main**. `cua-repl.mjs` (17050) and
  `node_repl` (17061, the generic server) are children of the app-server (5488). There is also a separate
  `SkyComputerUseClient computer-history mcp` (17048) child of the app-server: the Chronicle plugin still uses the
  direct-Swift-MCP pattern that computer use abandoned.
- **Responsibility (I, from the `sky.node` disassembly by the native-addon pass).** `spawnComputerUseService` calls
  `responsibility_spawnattrs_setdisclaim` before `posix_spawn`. The service is therefore its own "responsible process", and the
  TCC grants (Accessibility, Screen Recording) attach to `com.openai.sky.CUAService`, not to ChatGPT.app.
- **Quit guard (V).** `before-quit` calls `preventDefault()` when `sky.node.isPrivacySettingsTerminationRequest()` is true
  (`main:221153-221156`). ChatGPT therefore ignores the "Quit & Reopen" that System Settings sends after a privacy toggle. I:
  the grant belongs to the service, and quitting ChatGPT would needlessly end the user's sessions.

### 2.3 The host-services pipe (`ensureService`)

- **Server (V).** `vle()` (`main:20454-20504`) listens on `/tmp/codex-host-services-<uuid>.sock` (`main:10761`, `Sie()`), chmods it
  `0600` (`384`), frames JSON-RPC with an 8 MiB cap, and applies the `pu()` peer authorizer (§3).
- **Protocol (V).** It serves one method, `ensureService` with `params.service` (`main:20446-20453`). The only registered service is
  `"computer-use"`, which calls the managed service's `ensureServicePid()` and returns `{}` (`main:245331-245344`). Errors are
  `-32602 "Unsupported host service: …"` or `-32000 "Host service ensure failed"` (`main:20522-20555`).
- **Gating (V).** It is started **only if `d.Et.isInternal(c)`** (`main:245328`). The internal flavours are
  `[Dev, Agent, Nightly, InternalAlpha]` (`srcB5:2966`). On success it sets `process.env.NODE_REPL_HOST_SERVICES_PIPE_PATH` so that
  the app-server, and through `env_vars` pass-through `cua_repl`, inherit it. It was gated the same way in 26.917
  (`m917:237600`) and 26.623 (`m623:100752`, `if (n.i.isInternal(i))`).
- **Client side, handoff to the JS researcher (V).** `sky-np:40-200`:
  1. Connect to `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock` with a 250 ms budget.
  2. On failure, if `NODE_REPL_HOST_SERVICES_PIPE_PATH` is set, send `{"id":0,"jsonrpc":"2.0","method":"ensureService","params":{"service":"computer-use"}}`
     over `nodeRepl.nativePipe.createConnection`.
  3. Otherwise call `nodeRepl.launchServices.openApplication({applicationPath: SKY_CUA_SERVICE_PATH})`, falling back to
     `$CODEX_HOME/computer-use/Codex Computer Use.app`, then to `{bundleIdentifier: "com.openai.sky.CUAService"}`.
  4. Reconnect for up to 5 s.
- **Consequence for prod (I).** In prod the service is started in one of two ways:
  - by Desktop's eager spawn, with parent ChatGPT and responsibility disclaimed;
  - if the service is gone when the agent needs it, by LaunchServices from inside `node_repl`, with parent launchd.

  Desktop's PID tracking learns about a LaunchServices-started instance only when something calls `ensureServicePid()`, for
  example the menu-bar item or a feature-availability update. At that point the stored PID is stale, so Desktop spawns its own
  instance. Whether two instances can coexist, or the second exits, is a service-layer question (E5).

### 2.4 Desktop ↔ service control plane: Apple Events by PID (V)

The Desktop never opens `computeruse.sock`. A **computer-use worker** in `worker.js` (logger `computer-use-worker`,
`worker:124689`) sends Apple Events through `objc-js` (Foundation/AppKit via `NobjcLibrary`, `worker:126715-126740`):

- The event is `AECreateAppleEvent('SkCu','SndR')` targeted with `typeKernelProcessID ('kpid')` at the managed service's PID.
  Its params are `'RspT'` (request type, UTF-8), `'ClVn'` = `"CodexComputerUseNativeBridge-1"` and `'ReqD'` (JSON bytes). The
  reply is read from `'----'`, with errors in `'errn'`/`'errs'` (`worker:126764-126860`). Sends retry on `-600/-609/-1708/-1717`
  (`worker:126895-126906`). On `-600` (process not running) the worker asks main for `computer-use-invalidate-service-pid` and
  `computer-use-service-pid`, then retries (`worker:139046-139062`).
- Request types (`worker:126910-126914`, `127205-127400`):
  - `ComputerUseIPCAppGetSkyshotRequest`, `ComputerUseIPCAppStartCaptureRequest` and `ComputerUseIPCAppNextCaptureUpdateRequest` (appshots);
  - `ComputerUseIPCAppStopRequest` (stop controlling an app);
  - `ComputerUseIPCCodexStatusItemMenuStateRequest` (menu bar state: `computerUse.activeApplications[]`);
  - `ComputerUseIPCSkysight{Status,Start,Stop,Pause,Resume,GetSettings,UpdateSettings,UpdateObservationPolicy,ClearHistory}Request` (Chronicle);
  - `ComputerUseIPCMessagesSearchChatsRequest`.
- Main-side RPC (`main:244990-245002`, `Zct`): the worker obtains PIDs through `ensureManagedComputerUseService`/`invalidateManagedComputerUseService`.

Implication: the Apple Event channel is a host-privileged side door. It lets the host stop an app session, read menu state
and trigger onboarding without being the agent. Whether the service restricts the AE sender (the service strings list
`com.openai.codex`, `.alpha`, `.beta`, `.dev` and `.nightly`) is a service-layer question.

---

## 3. Native addons

(Symbol-level details come from the parallel native-addon pass. JS call sites are verified here.)

**`sky.node`** (loaded by `vc()`, `main:13985-13997`, "Sky native addon is unavailable"; Swift + N-API, signed team `2DC432GLL2`). Methods called from main (V, enumerated):

| group | methods | purpose |
|---|---|---|
| service | `spawnComputerUseService`, `computerUseServiceProcessMatchesExecutablePath` | spawn (responsibility disclaimed, I) and verify the service |
| quit guard | `isPrivacySettingsTerminationRequest` | swallow System Settings' quit request (§2.2) |
| PiP overlay | `startRemoteHostedPIPContentHost`, `connectRemoteHostedPIPContentHost(pid)`, `registerRemoteHostedPIPContentHost`, `setRemoteHostedPIPContent{ActiveThreadID,ComputerUseCursorLocationHandler,VideoFrameHandler,Placement,SuppressedThreadIDs,…}`, `invalidateRemoteHostedPIPContentTurn`, `completeRemoteHostedPIPContentThread`, `upsertBrowserUsePIPContent` | picture-in-picture of what the agent is doing, content hosted by the service over XPC (I: `SAIRemoteHostedPIPContentHostXPCProtocol`, bootstrap reply verified by audit-token PID) |
| menu bar | `createStatusItem`, `updateStatusItemMenuState`, `destroyStatusItem` (`main:243845-243900`) | status item listing active apps with per-app stop |
| misc | `iconSmallForAppPath`, `iconMediumForAppPath`, `frontmostWindow`, window-drag helpers | app icons for approval and settings UI, drag |

**`browser-use-peer-authorization.node`** exports one function, `authorizeSocketPeer(fd, devMode)` (V, JS at `main:18981-19045`).
- **Mechanism (V from the disassembly by the native pass).** It reads `LOCAL_PEERTOKEN` from the socket, then `audit_token_to_pid`,
  and walks the process ancestry until it finds the ChatGPT PID ("untrusted-process-ancestry"). It then checks the code-signing
  identity of the peer, its parent and its grandparent (`SecCodeCopyGuestWithAttributes`). The allowlist is team `2DC432GLL2`
  with identifiers `com.openai.codex*`, `codex`, `node` and `node_repl` (I from strings).
- **Where it applies (V).** It is enabled for macOS prod, beta, alpha and nightly
  (`boot:725`, `boot:818-820`, `shouldIncludeBrowserUsePeerAuthorization`). It guards the browser-use native pipe, the
  dynamic-app-tools pipe (`main:19084`) and the host-services pipe (`main:20454`). A packaged build with no flavour metadata
  **fails closed** ("missing-package-build-flavor", `main:18990-19001`).
- **Answer to Q3.** Yes, there is a peer-authorization scheme: "a process may use a Desktop-served pipe only if it is an
  OpenAI-signed descendant of this ChatGPT". It does **not** govern `computeruse.sock`; that socket lives in the app-group container
  and is authorized by the service. The service's own peer check is out of scope here.
- **Adjacent fact (V, codesign).** The bundled `cua_node/bin/node` and `node_repl` carry `com.apple.security.application-groups`
  including `2DC432GLL2.com.openai.sky.CUAService`. I: that entitlement is what lets the agent-side process reach the socket
  inside the group container without a macOS "access data from other apps" prompt.

The other addons are unrelated to computer use (V): `input-monitoring-permission.node` (Codex Micro), `launch-services-helper`
(open-in and dock), `devicecheck`, `sparkle`, `airpods-mute`.

---

## 4. `config.json`, `sessions/*.toml` and the approvals stores

### 4.1 `~/.codex/computer-use/config.json`: written by Desktop (V)

- **Writer.** `Wie()`→`Yie()`→`Xie()` (`main:11187-11281`). It serialises writes per path, writes `config.json.<pid>.<ms>.<uuid>.tmp`,
  then renames.
- **Content (`Gie`, `main:11215-11237`).**
  - `accentColor`: the current chrome theme's accent, default `#339cff`.
  - `direction`: `ltr` or `rtl` from `Intl.Locale.textInfo`.
  - `locale`: the `localeOverride` setting, else `app.getLocale()`, else `en`.
  - `strings.usingComputer`, default "ChatGPT is using your computer" (`computerUseOverlay.usingComputer`).
  - `strings.escToCancel`, default "Esc to cancel" (`computerUseOverlay.escToCancel`).
  Strings are looked up in the app's `native-menu-locales/<locale>.json` (`main:11244-11249`, `$ie`).
- **When (`as()` callers).** It is written before every thread's MCP config is built (`buildMcpCodexConfig`, `main:131850`), before
  automation turns (`main:12495`), and whenever the settings `appearanceTheme`, `appearanceLightChromeTheme`,
  `appearanceDarkChromeTheme` or `localeOverride` change (`main:130160-130168`, `Uie`).
- **Semantics.** It is global, not per thread: overlay branding for the service. Live file:
  `{"accentColor":"#339cff","direction":"ltr","locale":"en-US","strings":{…}}`, mtime 15:52, which matches the
  15:52:27 start of the current `cua_repl`.

### 4.2 `~/.codex/computer-use/sessions/<id>.toml`: per Codex thread, not written by Desktop

- **Keyed by Codex thread id (V).** All three files on disk are named by a UUIDv7 that matches a Codex rollout:
  `019ffc49-…` is `~/.codex/sessions/2026/08/14/rollout-…-019ffc49-5350-7012-b00c-8c280e792f70.jsonl`, and so on. Content is
  `[apps] allowed = ["com.apple.finder", …]`.
- **Not written by Desktop (V).** There is no `sessions` or `.toml` writer for this path in the main process.
- **Who writes it: unresolved.**
  - All three files are dated 2026-08-15 to 2026-09-05, before the 26.917 build (2026-09-17). No file on disk is known to come
    from the `cua_repl` era (V, `ls -laT`).
  - The service binary links toml++ (`cua-service-26.923/service.strings.txt:27662-27677`, `N4toml2v3…`).
  - The 26.924 `node_repl` strings carry the approval vocabulary: `struct MacOSApprovals`, `computer-use-persisted-state`,
    `conversationId`, `sessionId`, `allowed`, `denied` and `computer-use/config.toml` (`cua-service-26.923/security/strings-node_repl.txt:32064-32128`).
  - Neither binary has a literal `sessions/` string. Swift inlines short literals, so this absence proves nothing.
  - **I:** "allow this conversation" is now held by `node_repl`, keyed by the conversation or session id. It is either kept in
    memory or written to a path this pass did not identify. `sessions/*.toml` is the storage of the earlier direct-Swift-MCP
    era. Experiment E4 settles it.
- **Windows contrast (V).** On win32 the Desktop migrates a `computer-use/config.toml` `[apps] allowed` list into
  `~/.codex/config.toml` `[computer_use.windows.always_allowed_app_ids]` (`main:107536-107640`). This does not run on macOS.

### 4.3 "Always allow": `ComputerUseAppApprovals.json` in the service's group container (V)

- **Path.** `CM()` (`main:107691-107702`):
  `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`,
  schema `{approvedBundleIdentifiers: string[]}` (`main:107647-107655`).
- **Live content.** `com.apple.finder`, `com.apple.ScreenSharing`, `com.apple.dt.Xcode`, `com.apple.systemuiserver`.
- **Desktop access.** Desktop reads it and **removes** entries: `getAppApprovals()`→`bM()` and `removeAppApproval(id)`→`SM()`
  rewrite the JSON (`main:108178-108186`, `main:107657-107690`). Icons and names come from `sky.node`.
- **Writer on accept (I).** The writer on accept is most likely `node_repl`. Its Rust strings embed this exact relative path
  next to `struct MacOSApprovals` and `approvedBundleIdentifiers` (`strings-node_repl.txt:32064`, `:32098`), and `node_repl`
  carries the app-group entitlement for that container. The service remains a possible co-writer. Section 5 covers how
  "always" travels.
- **Other host-managed service defaults (V).** `defaults write com.openai.sky.CUAService computerUseSoundMode|appshotSoundEnabled`
  (`main:108149-108176`).

---

## 5. Approvals UX

Citations in this section use `cua-node` for `readable/cua-node-0.0.24/node_modules/@oai/sky/dist/project/cua/sky_js/src/targets/mac/`,
`app-shared` for `r/app-shared-36eae88777f2.js` and `card` for `r/computer-use-app-approval-request-card-bdd87251b6c8.js`.

**5.1 Origin: the controller asks with a standard MCP elicitation (V).**
- In `cua-node/computer-use-policy.js` the controller first asks the service for `getAppPolicy(app)`. The answer is `allowed`,
  `denied` ("blocked … by your organization's policy") or `forbidden`.
- It then calls `nodeRepl.createElicitation` with the message `Allow Computer Use to use "<displayName>"?` and this meta
  (`computer-use-policy.js:46-73`):

```json
{ "codex_approval_kind": "mcp_tool_call", "connector_id": "computer-use", "connector_name": "Computer Use",
  "persist": ["session", "always"],            // ["session"] when allowPersistentApproval is false
  "riskLevel": "<low|high>", "subtitle": "<optional warning>", "tool_call_id": "<optional>",
  "tool_name": "<tool>", "tool_params": {"app": "<bundle id>"},
  "tool_params_display": [{"name": "app", "display_name": "App", "value": "<displayName>"}] }
```

- If the reply's `content.source === "computer-use-persisted-state"`, a stored approval answered it and the user was not asked.
- Any action other than `accept` throws "Computer Use was not approved".
- Audio capture asks separately, with `persist: ["session"]` and `riskLevel: "high"`.

**5.2 Wire (V).**
1. `node_repl` turns the elicitation into an MCP `elicitation/create` to its client, Codex. Codex surfaces it to Desktop as the
   app-server **server request** `mcpServer/elicitation/request` (`app-shared:163899`, `:165856`, `:168900`).
2. The renderer parses `params._meta` with zod. `persist` is `"session" | "always"` or an array of them; `riskLevel` is `low|high`
   (app-shared around `:163762-163854`).
3. `dcr()` (`app-shared:282640-282660`) selects the computer-use card when all of these hold:
   - the parsed kind is `mcpToolCall`;
   - `connector_id` normalizes to `computer-use` (`pcr()`);
   - `persist` is non-empty;
   - an app name is present (`tool_params_display[app]` or `tool_params.app`).
4. The reply is built by `NR()` (`app-shared:153498-153512`) as `{action, content, _meta}`, where `_meta` is `{persist}` or `null`.
   It goes out through `replyWithMcpServerElicitationResponse`, then view message `mcp-response` (`app-shared:227897`), then main
   `handleClientResponse` (`main:167692`), then the app-server JSON-RPC response.
5. Main does no computer-use-specific interception on macOS. It only emits `app-approval-resolved` analytics
   (`Fo()`/`Bre`, `main:9779-9790`, `main:9828-9845`, reading `_meta.persist`). The Windows native-pipe server does relay approvals
   itself (`requestComputerUseApproval`, `main:9917-9918`).

**5.3 The card (V, `card`).**
- Title: "Allow ChatGPT to use {appDisplayName}?" (`composer.computerUseAppApproval.title.chatgpt`, `card:160-168`).
- Header: the connector icon and name, or "Elevated Risk" when `riskLevel === "high"`.
- Body: a first-use disclosure (`composer.computerUseAppApproval.disclosure`) until the user has approved any app, then the
  service subtitle.
- Buttons:
  - **"Allow this conversation"** sends `accept` + `persist: "session"` (`card:204-219`).
  - **"Always allow"** is shown only if `persistModes` includes `always`, and sends `accept` + `persist: "always"` (`card:183-194`).
  - **Deny** sends `decline`.
- Any accept sets the renderer flag `has-approved-computer-use-app` (`card:46`, `app-shared:282691`).
- The floating avatar overlay offers a plain "Allow" (accept, no persist; `r/avatar-overlay-native-page-*.js`, per the approvals pass).

**5.4 Automatic accept from @-mentions (V).** Apps @-mentioned in the composer are recorded per conversation (`$2` map,
`app-shared:282700-282725`). Later elicitations for those apps are accepted automatically with `persist: "session"`. This happens
only after the user has approved at least one app by hand (`VI("has-approved-computer-use-app")`, `app-shared:282733-282765`),
and only for server names that pass `GA()` or equal `computer-use`.

**5.5 Where the answer persists.**
- `always`: `ComputerUseAppApprovals.json` in the service group container (§4.3). The writer is most likely `node_repl` (I).
  Settings › Computer Use lists and revokes it through `getAppApprovals`/`removeAppApproval` (`main:108184-108189`,
  `r/computer-use-app-approvals-query-*.js`).
- `session`: keyed by conversation or session id inside the controller stack (I, §4.2). Desktop stores nothing.

**5.6 The `node_repl` JavaScript-execution approval (V/I).**
- `node_repl` has its own gate. Its strings include "JavaScript execution requires an approval elicitation", with
  `connector_id node_repl`, `connector_name Node REPL` and `codex_strict_auto_review`
  (`cua-service-26.923/security/strings-node_repl.txt`, around lines 20948 and 26448; V from strings).
- Desktop has no special card for it (I). It would render the generic MCP tool-call approval ("Allow {connectorName} to run
  {toolName} tool?") or be settled by the configured approvals reviewer. This machine has `approvals_reviewer = "guardian_subagent"`
  in `config.toml`.
- Trusted code paths (`NODE_REPL_TRUSTED_CODE_PATHS = ~/.codex:<cua_node modules>`) and the `cua-repl.mjs` banner are the
  mechanisms that keep the controller's own code from prompting (I; node_repl layer).
- `NODE_REPL_FORCE_STRICT_AUTO_REVIEW` is forwarded only in Dev (`main:6038`, `main:10766`, via `wie` list applied only when flavour is Dev at `main:10939`).

---

## 6. Permissions onboarding and feature gates

**Which bundle holds the permissions (V/I).**
- Accessibility and Screen Recording belong to **`com.openai.sky.CUAService`** (`Codex Computer Use.app`, `LSUIElement`). The
  service prompts in its own window. Its string reads "…has not finished granting Accessibility and Screen Recording permissions
  in the ChatGPT Computer Use window" (`cua-service-26.923/service.strings.txt:33714`).
- The spawn disclaims responsibility (§2.2, I), so TCC attributes the prompts to the service, not to ChatGPT.
- ChatGPT.app itself holds only the Apple Events usage ("ChatGPT uses Apple Events to control Mac apps…", per the approvals
  pass). Its `isTrustedAccessibilityClient` use (`main:225619`) is for dictation paste.

**Onboarding flow (V).** `r/use-imported-setup-opportunity-5b601215bed9.js:3570-3660` walks these stages:
1. clear `COMPUTER_USE_BUNDLED_PLUGIN_AUTO_INSTALL_DISABLED`
2. install the bundled `computer-use` plugin ("The bundled computer-use plugin could not be installed")
3. enable it with `config/batchWrite`
4. `browserPluginConfig.syncAfterPluginChange()` (this rewrites the `cua_repl` `.mcp.json`, §1.4)
5. `conversationalOnboarding.requestComputerUsePermissions()`

The onboarding demo task is "Toggle system light/dark mode" (`:746-764`, "Use computer-use tools only…").

**Settings routes (V).**
- `/settings/computer-use` is served by the `catalog` chunk and `/settings/computer-use/messages` by `computer-use-settings` (`FILE-MAP.md:74-75`).
- The page shows always-allowed apps (§4.3), a sound mode (`defaults write com.openai.sky.CUAService computerUseSoundMode`),
  "Locked use" (the installer, §2.1) and browser extensions.

**Gates (V; ids are Statsig numeric hashes).**
- Computer use is available (`tTr`, `app-shared:299867-299960`) only if all of these hold:
  - Statsig gate `"1506311413"` passes;
  - the app-server's `experimentalFeature/list` has `computer_use` enabled (`:299872`);
  - `configRequirements.allowBrowserAndComputerUse !== false`, i.e. enterprise policy allows it (`:299716`);
  - the platform is macOS or Windows, in an Electron window.
- If unavailable, the reason is `statsig-disabled`, `config-requirement-disabled`, `unsupported-platform` or `window-type-disabled`.
- Other flags:
  - auto-install: dynamic config `"741821319"`.enabled (`r/app-initial-*.js:452467`);
  - `nodeReplEnforceModelCheck`: `"337408568"` (`:452468`);
  - `recordAndReplay`: `"2791276931"` (`:452473`);
  - `cuaPIP`: `"188145323"` (`:452415`);
  - Messages: `"419294242"` (`app-shared:301999`);
  - Locked use: `"2296472986"`, `"1042620455"` and `requirements.computerUse.allowLockedComputerUse` (`r/computer-use-app-approvals-query-*.js:34-41`).
- The renderer pushes the result to main as `electron-desktop-features-changed` (`r/app-initial-*.js:452573`).

**Host-side mechanics.**

- **Onboarding trigger (V).** `requestComputerUsePermissions()` (`main:108675-108686`) sends the worker
  `requestPermissions {app: "com.apple.systempreferences"}`. The worker turns that into the Apple Event
  `ComputerUseIPCAppGetSkyshotRequest {app}` to the service (`worker:126960-126968`, `oke()`; `worker:139063-139070`). The Desktop
  asks the **service** to touch an app, and the service runs its own Accessibility and Screen Recording prompts for its own bundle. The
  appshot start reply includes `permissionGrantState: none_granted | accessibility_granted | screen_recording_granted | both_granted`
  (`worker:126945-126958`).
- **Desktop feature availability (V).** The renderer pushes a `desktopFeatureAvailability` object (`setDesktopFeatureAvailability`,
  `main:245460`). Computer-use fields: `computerUse`, `computerUseAutoInstall`, `browserUseTinysky`, `nodeReplEnforceModelCheck`,
  `cuaPIP`, `appshotsEnabled`, `skysight`, `messages`, `recordAndReplay`, `inAppBrowserUse(Allowed)` and `externalBrowserUse(Allowed)`
  (schema `main:4471-4520`, defaults all `false` at `main:4522-4570`). Dev builds can override them with
  `CODEX_ELECTRON_DESKTOP_FEATURE_OVERRIDES` JSON (`main:4579`, `main:4642-4690`). Windows can force `computerUse` with
  `CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE=1`.

---

## 7. Cancellation and visibility

**Stop button (V for each hop, I for the end-to-end chain).**
1. The renderer's stop sends `turn/interrupt` to the app-server (`r/app-shared-*.js`; main forwards it at `main:199532`).
2. Codex runs the `unified-computer-use` plugin hooks. `plugin.json` declares `Interrupt`, `Stop` and `SubagentStop` hooks of
   `type: "mcp_tool"`, `server: "cua_repl"`, `tool: "turn_ended"`, with input
   `{hook_event_name, session_id: ${session_id} (${agent_id} for SubagentStop), turn_id}` (V, file on disk).
3. `turn_ended` is the hidden tool the README says "remains enabled for host cleanup notifications". The controller then
   releases the session with the service (handoff: JS and service layers; the service strings include `ComputerUseIPCCodexTurnEndedRequest`).
4. Desktop itself only listens for `turn/completed` (`cse()`, `main:17583-17602`). If the status is `completed` it completes the
   PiP thread, otherwise it invalidates the PiP turn. It then calls `closeActiveTurn`, which does real work only on Windows, where
   the Desktop hosts the native pipe itself (`main:10712-10720`).
5. The main process contains **no** `turn_ended` or `turn-ended` caller for macOS (V, grep). The Electron `notify = [helper, "turn-ended", "--previous-notify", …]`
   writer (`main:10430-10498`) is Windows-only (`codex-computer-use(-arm64).exe`). The macOS
   `notify = [".../SkyComputerUseClient", "turn-ended"]` line in this machine's `config.toml` is a leftover from an older
   setup with no writer in 26.623, 26.917 or 26.924 (V by grep; origin I).

**Esc on the overlay.** The overlay ("ChatGPT is using your computer", "Esc to cancel") is drawn by the service from `config.json`.
Esc is handled inside the service. No Desktop code observes it (V by absence). How the aborted action surfaces to the model
(tool error or turn interruption) belongs to the service and JS layers.

**Menu bar.** The `sky.node` status item shows `computerUse.activeApplications` from
`ComputerUseIPCCodexStatusItemMenuStateRequest`. Choosing an app sends `computer-use/stop-application`, then
`ComputerUseIPCAppStopRequest {app: applicationId}` (`main:243649-243656`, `worker:127341-127349`). The status item also emits
`service-state-changed {processIdentifier, computerUseActive, computerHistoryState}` (`main:243805-243809`).

**What the user sees while the agent operates (V unless marked).**
- **Service overlay** with the localized "using your computer / Esc to cancel" strings and the accent colour. The service draws it;
  Desktop only brands it.
- **Picture-in-picture** (gate `cuaPIP`; `zue()` `main:25093`, strings "Hide for this chat", "Hide for all active chats",
  "Send Picture-in-Picture to Pet", "Return Picture-in-Picture to Codex"). Activity is derived from app-server notifications in
  `Ale()` (`main:20744-20800`). A thread becomes "computer-use active" when an `item/started` or `item/completed` of type
  `mcpToolCall` comes from server `computer-use` (legacy) or from `node_repl`/`cua_repl` with
  **`result._meta["codex/toolSurface"].kind == "computerUse"`** (`main:20720-20724`). It becomes inactive on `turn/completed`,
  `thread/archived`, `thread/closed` or `thread/deleted`. That `_meta` marker is the wire contract a foreign host would need to
  reproduce the same visibility.
- **Menu-bar status item** listing active apps with per-app stop.
- **Thread UI** (tool-call cards); covered by the approvals pass.

---

## 8. Architecture history

| build | prod computer-use path | where the service app lives | host pipe | notes |
|---|---|---|---|---|
| 26.623 (Codex app) | `computer-use` plugin `.mcp.json` launched `SkyComputerUseClient mcp` directly (Swift MCP server) | inside the plugin dir, copied by `ditto --noqtn` to `~/.codex/computer-use` (`m623:8887-8905`) | internal only (`m623:100752`) | internal builds could use `node_repl` + `@oai/sky` behind gate `computerUseNodeRepl`, forced false for non-internal macOS (`m623:614-623`). In that mode Desktop wrote the disabled stub `mcp_servers.computer-use {command:"./Codex Computer Use.app/…/SkyComputerUseClient", args:["mcp"], cwd:".", enabled:false}` (`m623:2355-2362`), which matches the orphan in this machine's `config.toml`. `cua_node` 0.0.2 already bundled (`@oai/sky`, `cdp-browser-backend`) |
| 26.917 | `unified-computer-use` → `cua_repl` (`cua-repl.mjs` → `node_repl` + `@oai/cua`) | moved into `cua_node/.../@oai/sky/` | internal only (`m917:237600`) | `cua_node` 0.0.16 adds `@oai/cua` and `@oai/cua-repl`. The `computer-use` plugin becomes skills only. `SkyComputerUseClient` references and the `computerUseNodeRepl` gate are gone from main |
| 26.924 | same as 26.917 | same | internal only | `cua_node` 0.0.24. The Apple Event bridge (`CodexComputerUseNativeBridge-1`) and managed-service spawn exist in all three builds (`worker.js` in each; `m623:4492`, `m917:13726`) |

**What it implies (I).**
- OpenAI converged on one agent-facing surface: a JS REPL MCP server with three tools (`js`, `js_reset`, `turn_ended`) and platform
  instructions, shared by the in-app browser, Chrome and desktop control. It replaces per-capability MCP servers.
- That surface is the same package used in training ("TinySky variants use `cua_repl` on Linux and macOS", cua-repl README), so the
  product harness and the RL harness now match.
- The Swift service became a versioned runtime asset of `cua_node`, re-copied on each launch.
- The Desktop host keeps a private Apple Event control plane for chrome-level UX (menu bar, stop, onboarding, appshots, Chronicle)
  that never passes through the agent.
- Chronicle (`computer-history`) still uses the old direct Swift MCP server, so migration is capability by capability.

---

## 9. What this means for MAWS (host-layer view only)

- **The agent path is separable from the host.** `cua_repl` is an ordinary stdio MCP server whose full launch recipe is the
  `.mcp.json` above: absolute paths into ChatGPT.app plus about 18 env vars, all derivable without Desktop. Nothing in its env
  points at Desktop in prod, and the `ensureService` pipe is absent. The service is found by socket, or by LaunchServices-opening
  the app. So a non-Codex host (Claude Code started by MAWS) can *launch* it.
  Whether the service *accepts* it is the open question:
  - the peer and code-sign policy on `computeruse.sock` (service layer);
  - the `node`/`node_repl` app-group entitlement, which the child keeps under any parent (I);
  - the approval path, which assumes the MCP client supports **elicitation** and honours `_meta.persist`.
- **What Desktop adds that MAWS would have to rebuild or give up.**
  - Eager, responsibility-disclaimed spawn. This is optional, because LaunchServices works.
  - Overlay branding through `config.json`. The service falls back to defaults if the file is absent (I).
  - The approvals settings UI, which is just JSON in the group container.
  - Permissions onboarding. It is triggered by an Apple Event with `ClVn` "CodexComputerUseNativeBridge-1"; whether a non-OpenAI
    sender is accepted is untested.
  - The PiP and menu-bar surfaces, which depend on `sky.node`. `sky.node` is a team-signed addon that MAWS cannot load
    into its own Electron without disabling library validation (I).
  - Turn-end cleanup: Codex fires `turn_ended` from plugin hooks, so MAWS or Claude Code would need an equivalent.
    MAWS knows turn boundaries from stream-json, but the tool lives on an MCP server owned by the Claude Code process.
- **Recommendation for the later decision (I).** Treat "reuse OpenAI's controller" as reuse of the `cua_repl` stdio server plus the
  unmodified service, and test it before designing anything (E1 to E3 below). The host pieces worth copying are architectural, not
  code:
  - one service process with its own TCC identity, spawned with responsibility disclaimed;
  - a host control plane separate from the agent channel;
  - activity detection from a `_meta` marker on tool results;
  - turn-end hooks.

---

## 10. Handoffs

- **Service layer.**
  - The `computeruse.sock` peer policy.
  - The Apple Event sender policy (`ClVn`, allowed bundle ids).
  - Behaviour on a second instance.
  - Whether the service also writes `ComputerUseAppApprovals.json`, and whether it wrote the pre-26.917 `sessions/*.toml`.
  - `ComputerUseIPCCodexTurnEndedRequest`.
  - Esc handling.
  - The meaning of the "relaxed" variant.
- **JS controller (`@oai/sky`, `@oai/cua`).** How `_meta.persist` is mapped, the `session_id` source, and the LaunchServices fallback via `nodeRepl.launchServices`.
- **node_repl.**
  - `nativePipe` and `launchServices`.
  - Elicitation relay.
  - `MacOSApprovals`, which is the likely writer of `ComputerUseAppApprovals.json` and of the per-conversation approval state.
  - The JS-execution approval (`NODE_REPL_TRUSTED_CODE_PATHS`, `NODE_REPL_UNTRUSTED_ENV_ALLOWLIST`).
- **Codex CLI.** `mcp_tool` hook execution for `Interrupt`/`Stop`/`SubagentStop`, `omit_tools_from`, and the `mcpToolExposure` capability.

---

## 11. Open questions and proposed wave-2 experiments

### Open questions (ordered by weight for the MAWS reuse decision)

1. Does the service accept a `cua_repl` whose ancestry is not Codex app-server under ChatGPT? That is, what does
   `computeruse.sock` check: code-sign identity of the peer only, the app-group entitlement, or ancestry? (Service layer; E1.)
2. Does Claude Code, acting as the MCP client, handle the `elicitation/create` that `node_repl` sends? If so, does it return
   `_meta.persist`? If not, does the controller fail closed ("Computer Use was not approved")? (E1b.)
3. Who writes "allow this conversation" state in the `cua_repl` era, and where? Is `sessions/*.toml` dead? (E4.)
4. Does the service render its overlay and handle Esc correctly with no `config.json`, or with one written by a foreign host? (E2.)
5. What does the "relaxed" service variant relax, and is it the one a third-party host would need? (Service layer.)
6. Is the Apple Event control plane (`ClVn` "CodexComputerUseNativeBridge-1") restricted by sender bundle id or team? (E3.)
7. After Desktop's eager spawn, does a LaunchServices start from `node_repl` create a second service instance? (E5.)

### Proposed wave-2 experiments

All of these are designed here and were not run. Each lists setup, action, observation and the result that would decide the question.

- **E1: `cua_repl` under a foreign parent** (decides Q1 and Q2 of the reuse question).
  - **Setup:**
    - Copy the `mcpServers.cua_repl` block of the live `.mcp.json` verbatim, with the same command, args and env.
    - Keep `CUA_REPL_ENABLED_SURFACES=computer`.
    - Start the log stream: `log stream --style compact --predicate 'process == "SkyComputerUseService" OR process == "node_repl"'`.
  - **E1a:** launch it from a plain MCP stdio client in Terminal, such as a 40-line Python client using the `mcp` SDK that
    implements `elicitation/create` by printing and auto-declining. Call `tools/list`, then
    `js` with `await cua.getState()`, then a no-op read of Finder.
  - **E1b:** register the same server in a scratch Claude Code project (`.mcp.json` with the same env) and ask for the same read.
  - **Observe:**
    - socket connect success or failure;
    - whether an elicitation arrives, and its payload;
    - the service log verdict on the peer;
    - whether the Screen Recording and Accessibility prompts name "Codex Computer Use".
  - **Decides:**
    - Connection accepted and elicitation delivered: reuse is viable at the protocol level.
    - Rejected at the socket: MAWS needs its own controller, or has to run under a Codex parent.
- **E2: overlay branding by a foreign host.** During E1, temporarily point `CODEX_HOME` at a scratch dir holding a `computer-use/config.json`
  with custom `strings` and `accentColor`. Observe whether the overlay uses them and whether Esc cancels. This shows whether the
  overlay is a host-configurable surface.
- **E3: Apple Event sender policy.** From a scratch unsigned binary (or `osascript` JXA with `Application(<pid>)`-style raw AE through
  ObjC bridge), send `SkCu/SndR` with `RspT = ComputerUseIPCCodexStatusItemMenuStateRequest`, `ClVn = CodexComputerUseNativeBridge-1`,
  `ReqD = {}` to the service PID. Observe the reply or `errn`. This decides whether a MAWS host could reuse the menu-bar,
  stop-application and onboarding control plane.
- **E4: session approval storage.** In ChatGPT 26.924, start a fresh thread, ask for a harmless read of an app not in
  `ComputerUseAppApprovals.json`, and choose "Allow this conversation". Snapshot `~/.codex/computer-use/sessions/`, the group
  container and `fs_usage -w -f filesys node_repl SkyComputerUseService` (needs sudo; run by the user). Repeat with "Always allow".
  This shows who writes what, and where.
- **E5: service start paths.** Record `ps -o pid,ppid,lstart` for `SkyComputerUseService`. Quit only the service (user action
  from the menu bar or Activity Monitor), then trigger a computer-use tool call without restarting ChatGPT. Record the new ppid:
  697 (ChatGPT) or 1 (LaunchServices). Then open the ChatGPT menu-bar item, which forces `ensureServicePid`, and check for a
  second instance.
- **E6: turn-end path.** With `RUST_LOG=codex_core=debug`-style logging on the app-server (or Desktop's app-server trace), press
  Stop mid-action. Confirm the `turn/interrupt` → `Interrupt` hook → `cua_repl.turn_ended {session_id, turn_id}` order and time it.
  Repeat with Esc on the overlay to see how an Esc abort surfaces to the model. This tells MAWS what its own turn-end signal must
  carry.
