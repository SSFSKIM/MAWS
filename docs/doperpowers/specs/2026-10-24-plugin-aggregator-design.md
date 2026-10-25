# Discover: one place to find skills, plugins and connectors (P4 child P4-AGG, 2026-10-24)

Parent: `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` (P4, the UX wave), Decision Log 86. Root: `docs/charter.md`.

## Purpose

The owner wants a way to find new capabilities for their agents without leaving MAWS. Today Customize can list plugins from marketplaces they have already added and from the engine's built-in copy of Anthropic's directory, one list at a time. Skills have no discovery at all, and an MCP server is added by editing configuration by hand.

After this work, each of Customize's three tabs (Skills, Connectors, Plugins) has **My items** (what is installed or configured) and **Discover** (what exists). Discover draws from:
- the sources the owner named: Anthropic's official and community marketplaces, the owner's own doperpowers and cua, and Anthropic's, Notion's, Canva's and Carta's skill and plugin repositories;
- Anthropic's public directory, which also lists MCP servers such as Linear;
- the engine's own built-in copy of that directory, which is what installs a directory plugin.

The owner can search everything at once, see who published each item, how far it was reviewed and how many people installed it, and add it with one confirmation. A connector can be signed in to from MAWS.

To see it working, open Customize → Plugins → Discover, search "legal", press + on a result, confirm, and find it under My items.

Discover is for the person. Agents get no catalog, no discovery tool and no suggestions; they see a plugin only once the person installs it (owner, 2026-10-24).

## Progress

- [x] (2026-10-24 23:50Z) Design approved by the owner (six rulings, below). Research hand-back recorded in this spec.
- [x] (2026-10-25 02:30Z) Spec reviews (design, 13 findings; buildability, 7 findings) and the architect's rulings on them folded in (Decision Log, second entry). The facts section was re-measured against the live directory, the 2.1.309 engine and the e2e harness.
- [x] (2026-10-25 04:10Z) Buildability review, round 2 (five gaps on 259658d64), folded in (Decision Log, third entry): the test-source seam, exact Keychain custody, engine provisioning, the added-marketplace metadata read, the terminal fallback's launch.
- [x] (2026-10-25 02:59Z) M1 — the real-engine test harness and the catalog fixtures (0df1e2398, fix 95b775f2f; class 1a run 40154912725, e2e:discover run 40154941453 2/2 on the mini's installed 2.1.309; review clean). The `gate.yml` change (the group in CLASS1_E2E, the provisioning step, the default-group pin) is held uncommitted pending CI-opt's clearance.
- [x] (2026-10-25 04:53Z) M2 — the catalog (9e6309756, e711484d7; fixes f56a44c6a, 882a8c838; class 1a run 40163330358 green on 882a8c838; review clean after two fix waves). The connector count after the `url_options` fix is measured by M5's live smoke.
- [x] (2026-10-25 08:01Z) M3 — Discover for Plugins and Skills (aa428cb2c..594f7291a; fixes cecae1595..5ca41695b, e232a394d; run 40174394148 on e232a394d: class 1a green, e2e:discover 6, widgets 29, layout 14; settings 12 on f2538909d; review clean after two fix waves). Open Discover keeps a session's exact directory, a page for it when no project owns it.
- [x] (2026-10-25 11:24Z) M4 — Connectors: the spike (promote, path B with the late-server variant; gate run 40175924834), then Discover, add, remove and sign in (295e97229..9eb7f22b3; fixes 5adfffcc6, 45751b733, bc9572458, c542e6362; gate run 40188327848 on c542e6362: class 1a green, e2e:discover 8 passed with the env-gated spike skipped; settings, widgets and layout green earlier; review clean after four fix waves).
- [x] (2026-10-25 13:23Z) M5 — acceptance at 1280 and 1512 and the whole Mac matrix (88f05bd80..788b5bb70, fix b29167822; whole Mac matrix run 40190324774 green on 788b5bb70, every job on attempt 1; e2e:discover and e2e:discover-live 40190325020; e2e:discover 40196923687 on b29167822; review clean). Screenshots in /tmp/p4-discover-evidence/. The branch review is the architect's panel, after hand-back.

## The owner's rulings (2026-10-24)

- Discover is mainly for finding new things; managing what is installed is a separate view, as in Claude Desktop's Customize (references: `/Users/new/Developer/MAWS-notes/ux-comparison-2026-10-23/owner-notes/claude-customize-discover-2026-10-24.png` and `claude-customize-my-items-2026-10-24.png`).
- Agents do not see the catalog unless the person explicitly asks; there is no "discover and suggest" tool.
- **Home layout: shelves.** A featured card, then one row per source and per category, then everything. The alternative was one flat grid with filters; it lost because browsing to learn what exists is the main use.
- **Anthropic's directory is read**, even though it is undocumented, because it alone carries publishers, review and security checks, categories and connector addresses. It is cached, and Discover keeps working without it. The alternative was documented sources only (GitHub manifests and the MCP Registry); it lost on card quality.
- **Community items are shown and labelled**, in search and in All, but not on the featured shelves. The alternative, hiding them behind a filter, lost because the label carries the risk honestly.
- **Connectors come from Anthropic's directory.** The official MCP Registry was the alternative; it lost because its listing verifies only who published a server, not whether the server is safe, and it adds thousands of entries.

## What exists today (master b51430679)

- `src/renderer/src/customize/CustomizeView.tsx`:
  - Customize has Plugins, Skills and MCP servers tabs, and a selector for user configuration or a project (its `cwd`).
  - It attaches only to an engine process that is already ready in exactly that directory. Opening it never starts a session.
- **Plugins** embeds `PluginsLibrary` (`src/renderer/src/widgets/PluginsWidget.tsx`), which already has:
  - My items and Browse;
  - Add marketplace and Manage marketplaces;
  - an install confirmation (`widgets/plugins/ConfirmSheet.tsx`) with a choice of scope (user, project or local) and the exact command;
  - command-hash acceptance for marketplaces that declare commands;
  - progress, and a reload outcome per session;
  - install counts on the cards that have one ("1.3M installs"), from the engine's own number.
- **Browse lists what the engine's `claude plugin list --json --available` returns:** the marketplaces already added plus the engine's built-in **Anthropic Directory** marketplace, named `anthropic-plugin-directory` (fact 2). Its items carry the id, name, marketplace, description, version, source and an optional install count (`src/shared/ipc/schema/plugins.ts` `AvailablePluginSchema`), and no publisher, category or review fields. `plugins.list`, `plugins.available` and `marketplaces.list` take the Customize page's `cwd`: what counts as installed depends on it.
- **Engine mutations:**
  - `src/shared/plugins/cli.ts` builds the `claude plugin … --json` argv; `marketplace-add` already takes a scope.
  - `src/engine-host/plugins/runner.ts` spawns the unmodified engine binary for it, at the absolute path `src/engine-host/binary-info.ts` resolves (the Engine setting, else `MAWS_E2E_ENGINE_BIN` under e2e, else the installed link, else `claude` on the login shell's PATH).
  - `src/engine-host/plugins/reload-after.ts` reloads ready sessions afterwards, after the host's settings watcher has seen the CLI's write.
- **The host's listing reducers lose fields** (`src/engine-host/plugins/cli-result.ts`): `availableOf` keeps a plugin's name, id, description, version, a reduced source and the count; `sourceRefOf` drops `sha` and keeps `ref` only when no sha pins the entry; `marketplacesOf` carries no `owner`. **`plugins.manifest`** (`src/engine-host/plugins/listings.ts` `manifestsFor`, `PluginManifestViewSchema` in `src/shared/ipc/schema/plugins.ts`) already reads what an installed or available plugin says about itself from its folder or its marketplace's clone (`installLocation`): author, skills, hooks, commands, agents, and each MCP server's transport.
- **The terminal surface:** `pty.spawn` (`src/shared/ipc/schema/pty.ts`) takes `cwd`, an absolute program as `shell` and its `args`, or a `command` line written to the shell; the pty host builds the child's environment from the login shell's and strips every `MAWS_` and `ELECTRON_` variable (`src/pty-host/env.ts`).
- **Skills** reads the disk inventory (`src/engine-host/customization/inventory.ts`) and has no discovery or installer.
- **MCP servers** shows the servers configured on disk, and separately the live ones in an attached session, through `widgets/McpWidget`. There is no add or remove.
- **The engine host's bounded session calls:** `session.mcpStatus` (a read), `session.mcpReconnect` and `session.mcpToggle` (operations with a receipt), in `src/shared/ipc/schema/session.ts` and `src/engine-host/operations.ts`. Every call from main to a host answers within the supervisor's 10 s (`REQUEST_TIMEOUT_MS`, `src/main/hosts/supervisor.ts`) or fails with `timeout`.
- **MAWS's own connector connections:**
  - `src/main/connectors/*` implements MAWS's own connections, including full OAuth with sealed storage; `oauth-callback.ts` is a loopback listener on 127.0.0.1, port 0, path `/callback`.
  - Those credentials are MAWS's; they do not sign the engine in.
  - `src/engine-host/mcp-call.ts` already recognises the engine's `needs_auth` refusal, which asks for `mcp_authenticate`.
- **Slash commands never reach the engine from the composer:** `src/renderer/src/composer/editor/controller.ts` intercepts `/<word>` and opens MAWS's own widget, and MAWS's `/mcp` widget only reconnects and toggles. The engine's own `/mcp` TUI is reachable through MAWS's terminal surface (`pty.*`, `src/shared/ipc/names/pty.ts`), which runs `claude` in a project directory.
- **The e2e harness** (fact 6): its launcher writes a version-only stub engine unless `MAWS_E2E_ENGINE_BIN` names a binary; the OAuth fixture `e2e/support/connector-oauth.ts` serves MAWS alone (it refuses a live engine and admits only `127.0.0.1` callbacks). No e2e group installs a plugin through the real CLI today.

## Facts the design rests on (research 2026-10-24, re-measured 2026-10-25)

1. **All fourteen named repositories exist and are Claude Code plugin marketplaces** (`.claude-plugin/marketplace.json` at the root), including those described as skill directories. Their raw manifests answer with an ETag and `Cache-Control: max-age=300`.

| Repository | Marketplace name | Plugins | Ownership class |
|---|---|---:|---|
| anthropics/claude-plugins-official | claude-plugins-official | 315 | anthropic |
| anthropics/claude-plugins-community | claude-community | 2,283 | community (Anthropic's scanned mirror) |
| SSFSKIM/doperpowers | doperpowers | 5 | added (the owner's; not a seed, fact 1a) |
| SSFSKIM/cua | cua | 1 | added (the owner's; not a seed) |
| anthropics/skills | anthropic-agent-skills | 5 | anthropic |
| anthropics/financial-services | claude-for-financial-services | 19 | anthropic |
| anthropics/knowledge-work-plugins | knowledge-work-plugins | 123 | anthropic |
| anthropics/claude-for-legal | claude-for-legal | 13 | anthropic |
| anthropics/life-sciences | life-sciences | 2 | anthropic |
| anthropics/k12-teacher-skills | k12-teacher-skills | 1 | anthropic |
| anthropics/claude-for-financial-advisors | claude-for-financial-advisors | 1 | anthropic |
| makenotion/claude-code-notion-plugin | notion-plugin-marketplace | 1 | partner |
| canva-sdks/canva-skills | canva-skills | 1 | partner |
| carta/plugins | carta-plugins | 3 | partner |

   1a. The owner's engine configuration already lists doperpowers and cua as marketplaces (`~/.claude/plugins/known_marketplaces.json`, read once, read-only: claude-community, claude-plugins-official, cua, daily-journal, designer, doperpowers, ptc-tool). They reach Discover as marketplaces the person added, not as built-in seeds.
   1b. Entries mix local folders, remote git repositories and pinned subdirectories: 2,637 of 2,773 entries pin a sha, tag or branch. 262 of the official marketplace's 315 entries point at third-party repositories (`external_plugins/*` and vendors' own repositories). 216 (repository, path) pairs are listed by more than one of the fourteen, 107 of them at different refs. Only 13 entries declare `skills`; 2 declare `mcpServers`; none declares hooks.

2. **The engine (2.1.309, unmodified).**
   - **Installing:** `plugin marketplace add <owner/repo|url|path> --scope user|project|local` (default user, `--json`), then `plugin install <name>@<marketplace> --scope … --json`. A bare skills folder is refused (`manifest_missing`); wrapped in a marketplace entry with `strict:false`, the same skills install and uninstall (scratch probe). The one-step `plugin install <name> --marketplace <source>` always adds the marketplace in user settings, whatever scope was chosen (cli.pretty.js 1136328).
   - **The built-in Anthropic Directory marketplace.** The engine carries a marketplace named `anthropic-plugin-directory`, displayed "Anthropic Directory" (cli.pretty.js 38626, 38649; module 779797 to 780468). It walks `/api/directory/plugins?visibility=public` itself, caches the walk under the plugins folder (`plugin-directory-cache-v2.json`), turns every listing that has a 40-hex `reviewed_commit`, a `claude_code` surface and a well-formed repository URL into a marketplace entry `{source: 'git-subdir' | 'url', url, path?, sha: reviewed_commit}`, skipping the rest (`other_surface`, `no_pin`, `bad_url`, `bad_path`), and derives each entry's name from the listing's name, path or repository with a suffix on collision (780196 to 780260). `plugin install <entry>@anthropic-plugin-directory` installs it; `--replace` switches a plugin "between Anthropic Directory and Anthropic's official marketplaces". It is on by default (flag default, 565164), can be turned off by an on/off file the engine reads in the plugins folder (`plugin-directory-marketplace.json`, `{"enabled": false}`; M1 confirms the path), and is gated by the organisation policy `allow_plugin_directory_search`. Its entry names are the engine's and are not computable from a directory record; `plugin list --json --available` reports them with each entry's `source`.
   - **Install counts and contents for the official marketplace:** the engine fetches `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json` with no credentials (730045 to 730146) and caches it 24 h. Today it holds, for the 315 `<name>@claude-plugins-official` ids, `unique_installs` (313 have one), `components` by name (commands, agents, skills, hooks, mcpServers), `last_updated` and `version`. `plugin list --available` reports it as `installCount`, which Browse shows.
   - **Plugin contents:** a plugin's skills, hooks and MCP servers load as parts of the plugin.
   - **Reload limit:** MCP changes from a plugin take effect at the next session (cli.pretty.js around 331433).
   - **Remote MCP servers:** `claude mcp add --transport http|sse <name> <url> --scope local|user|project` (default **local**; 390606 to 390619). It also takes `-H` headers, `--client-id`, `--client-secret` and `--callback-port` for servers that need a pre-registered client. It has no `--json`; it prints `Added <transport> MCP server <name> with URL: <url> to <scope> config` on success. It refuses a name already configured in the same scope (measured by M4, against this line's first reading); MAWS's sheet still refuses a name configured in any scope that applies in the `cwd`. A name may hold letters, digits, hyphens and underscores.
   - **Signing in:** the control request `mcp_authenticate {serverName, redirectUri}` (handler at 856438) resolves the server among the session's loaded clients and its startup configuration; a name it does not know answers "Server not found". For a known server it answers `{authUrl, requiresUserAction, callbackExpected, redirectScheme: 'custom' | 'localhost', state, callbackPort?}` after registering the client, and never opens a browser. It uses the request's `redirectUri` only when the server has no static `clientId`; if the authorization server rejects that URI it retries with its own `localhost:<callbackPort>/callback` listener and answers `redirectScheme: 'localhost'`, in which case the engine receives the callback itself. `mcp_oauth_callback_url {serverName, callbackUrl}` accepts a URL carrying `code` or `error` whose `state` matches the flow in progress; otherwise "No active OAuth flow" or "Callback URL not accepted". `mcp_set_servers {servers}` (856203) loads servers into a running session as dynamic servers. Credentials go to the macOS Keychain under one service name per configuration directory: `Claude Code-credentials` for the owner's, and `Claude Code-credentials-<first 8 hex of sha256(CLAUDE_CONFIG_DIR, NFC-normalised)>` when `CLAUDE_CONFIG_DIR` is set (2.1.304 cli.pretty.js 1134003 to 1134006; `spikes/protocol-probe/scenarios/pass3/p4-r8-mcp-servers.mjs` `scratchItem` derives and removes exactly that name; confirmed against 2.1.309 by M1: 318187 to 318190, the directory string as given, no realpath, provided neither `CLAUDE_SECURESTORAGE_CONFIG_DIR` nor `CLAUDE_CODE_CUSTOM_OAUTH_URL` is set; `spikes/p4-aggregator/findings-m1.txt` 3). `security find-generic-password -s` and `delete-generic-password -s` match an exact service name, never a prefix.
   2a. **The engine's listings (measured by M1 against 2.1.309).** `plugin marketplace list --json` carries no `owner`; `plugin list --json --available` omits installed plugins; the Anthropic Directory's on/off file is `<CLAUDE_CONFIG_DIR>/plugins/plugin-directory-marketplace.json` (cli.pretty.js 780384 to 780398), and `{"enabled": false}` there takes the available listing from 3,597 directory entries to 0 (`spikes/p4-aggregator/findings-m1.txt` 1, 2).

3. **Anthropic's directory, plugins endpoint.** `GET https://api.anthropic.com/api/directory/plugins` answers HTTP 200 with no cookies or keys and returns `{data, facets, next_page, omitted}`; it honours `limit`, `page`, `visibility`, `verified_tier`, `include=launch` and `q=<text>`.
   - **Visibility decides what a record is.** `visibility=public` returns exactly 3,601 records in one page of 5,000: every one has `source.repository {url, path?, reviewed_commit}` and is a Claude Code plugin; 92 are tier `anthropic`, 344 `partner`, 3,165 `community`. Adding `commercial` adds 7,256 records that are not plugins: 7,124 hosted MCP connectors (`checks.scan.reason: directory_mcp_server`, no repository, a `components[0].endpoint.url`) and 132 desktop extensions (`compatibility.claude_code: does_not_work`).
   - **What a plugin record carries:** `name`, `summary`, `description`, `verified_tier`, `checks.review {state, by.type}` and `checks.scan {state}`, `compatibility` and `surfaces`, `components` (`skill`, `command`, `agent`, `hook`, `mcp_server`, `cli`, each with `access.type`: `stays_inside_claude`, `runs_on_your_computer`, or `sends_data_to` with a `service`), `source.repository`, `release.version`, `license`, `links`, `media.icons`, `taxonomy` (five axes: `object_acted_on`, `work_department`, `industry`, `life_area`, `subject`; a value is a string or an array), `updated_time`, `metrics` (always `{}` anonymously) and `publisher`.
   - **What it does not carry:** an install action naming a marketplace (every record's `installation.actions` is `{sign_in: true}`, Claude.ai's own action; `source.marketplace_slug` is `anthropic-plugin-directory` or absent); a publisher for most plugins (null on 3,277 of the 3,286 skill-bearing records, including every anthropic-tier one); a failed scan (scan states are only `not_scanned` and `unavailable`); a launch banner worth showing (one in 10,857, a gated partner beta).
   - **Names:** the directory's display name differs from the marketplace's install name for 723 of the 1,436 (repository, path) matches ("Adobe" versus `adobe-for-creativity`); the directory's `reviewed_commit` differs from the marketplace's pin for 648 of them.
   - **Gaps:** nothing references SSFSKIM/doperpowers, SSFSKIM/cua or anthropics/k12-teacher-skills; only 52 of the official marketplace's 315 entries have a directory record, 289 join by (repository, path). The directory is Anthropic's curated list, not a federation.
   - **No published contract:** no third-party API, support or redistribution contract was found. Treat it as an observed public endpoint: cache it for this user, and never republish it.

4. **Anthropic's directory, servers endpoint.** `GET https://api.anthropic.com/api/directory/servers?limit=500[&cursor=…]` returns `{servers, total, next_cursor, stale_feeds}`; 1,011 servers over three pages today, every one tier `partner` (1,001) or `anthropic` (10): **the servers list has no community tier**. 877 are `type: remote` with `remote {url | null, url_regex | null, transport: 'streamable-http' | 'sse', auth_posture: 'auth_required' | 'no_auth', is_authless}`; 123 are `type: local` desktop extensions for Claude Desktop only. 733 remote servers list `claude-code` in `works_with` (723 streamable-http, 10 sse; 646 need auth, 87 do not); 73 of them have `url: null` with a `url_regex` the person's own instance URL must match (Snowflake, Salesforce, NetSuite, n8n, Smartsheet). A record also carries `slug`, `display_name`, `author {name, url}`, `one_liner`, `icon_url`, `tool_names`, `categories` (25 values; 878 of 1,011 have one), `taxonomy`, `documentation`, `privacy_policy`, `support`, `rank`, `popularity_rank`, `trending_rank`, `is_new`, and for some `claude_code_copy_text`, the exact `claude mcp add --transport http <name> <url>` line (Linear: `claude mcp add --transport http linear https://mcp.linear.app/mcp`). 427 names contain spaces or other characters the engine's name rule refuses; 8 names appear twice. Linear is listed: partner, auth required, `https://mcp.linear.app/mcp`, streamable-http.

5. **Desktop's trust wording** (`/Users/new/claude-desktop-re/readable/app-3.6556.2/web/app/v1/c80c79f6c-DHtpOo2e.js` 174 to 230). Desktop has three labels: Verified for any tier other than community (`c0d28f116-C3xOyICT.js:14`), Community, and Custom. Its tooltips:
   - Verified: "Verified — Anthropic has reviewed this plugin for quality and security." (connector: "… this connector …").
   - Community plugin: "This plugin hasn't been reviewed in depth by Anthropic." Community skill: the same with "skill". Community connector: "This connector passed our automated checks but hasn't been reviewed in depth by Anthropic."
   - Custom: "You added this connector. Anthropic hasn't reviewed it."
   Desktop has no partner wording. Its runs-code warning ("The <name> plugin includes components that run code", `c7aca31b8-BKE9xWdm.js:89`) fires on components whose `access.type` is `runs_on_your_computer` and on `cli:` components (`c12456454-DrLqfhYF.js` 1636, 4054 to 4064); when a component's access is unknown it says the plugin "may include components that run code". Desktop's Discover home (the owner's reference) is a signed-in editorial feed (`GET /api/organizations/{org}/library/discover/home`, `shared-52-uHFNjl7C.js:25534`); MAWS has no claude.ai session and does not reproduce its picks. Its counts and ranks, however, are public: fact 2's plugin-details for official plugins, fact 4's ranks for connectors.

6. **The e2e harness.**
   - `e2e/support/launch.ts` writes a version-only replay stub (`test/support/replay-engine.ts`) as the engine unless the run's `MAWS_E2E_ENGINE_BIN` names a binary; `test/support/engine-pin/index.ts` prefers 2.1.283, then the newest installed release. A recorded catalog does not make `plugin marketplace add` or a plugin's download work offline.
   - `e2e/support/connector-oauth.ts` serves MAWS's own OAuth alone: `enterOAuthPhase` refuses an empty engine-PID proof and a live engine, `e2e/connectors-oauth.spec.ts` stops the engine before the OAuth phase, and registration admits only `http://127.0.0.1:<port>` callbacks. The engine's own callback is `http://localhost:<port>/callback` (fact 2).
   - A scratch `CLAUDE_CONFIG_DIR` under the real `HOME` does not keep the engine out of the macOS Keychain: a scratch run created `Claude Code-credentials-8e824fb9` and the scenario removed it by that exact name, derived from the scratch directory (`spikes/protocol-probe/findings-p4-r8-mcp-servers.txt` 6; fact 2). A scratch `HOME` does: the login keychain is found through `HOME`, so under a scratch `HOME` the engine stores no credential anywhere (no Keychain item, no plaintext fallback; `spikes/p4-aggregator/findings-m1.txt` 3, Decision Log, fifth entry).
   - Nothing provisions a given engine version for a gate job: the Mac lane has whatever `~/.local/share/claude/versions/` holds, and `.github/workflows/gate.yml` is shared with the CI-opt initiative.
   - A terminal the renderer opens through `pty.spawn` runs with the pty host's environment, in which `MAWS_E2E_ENGINE_BIN` and every other `MAWS_` variable are absent (What exists today), so a bare `claude` in it is whatever the login shell's PATH finds, or nothing.

## Design

### Parts and where they live

```
main process                              renderer (Customize)
───────────────                           ─────────────────────
src/main/catalog/                         src/renderer/src/customize/discover/
  sources.ts     seed list; the test-       DiscoverHome.tsx   shelves
                 source seam                DiscoverGrid.tsx   search results, All, See all
  fetch.ts       GitHub, directory,         CatalogCard.tsx    one card, three kinds
                 plugin-details through     CatalogDetail.tsx  detail sheet
                 egressGet's `catalog`      add.ts             + → existing sheets
                 rule; the fixture seam
  engine-reads.ts installed, available,   widgets/plugins/*    install (reused)
                 marketplaces, manifests, widgets/McpWidget    My items for connectors
                 via host
  normalize.ts   → CatalogItem
  join.ts        one item per thing
  store.ts       disk cache, refresh
  index.ts       catalog.* IPC
src/main/connectors/sign-in.ts            the sign-in operation (M4)
src/shared/net/egress.ts                  the guarded GET and EGRESS_RULES, lifted from engine-host/egress.ts (M2)
engine-host: plugins/cli-result.ts keeps sha, ref and owner; plugins/listings.ts gains the marketplace manifest read
             (M2); plugins/runner.ts gains `mcp add|remove`; session.mcpAuthenticate, session.mcpOAuthCallback and
             session.mcpSetServers beside session.mcpStatus (bounded control calls) (M4)
e2e/support/real-engine.ts, scripts/provision-engine.sh, e2e/support/connector-oauth.ts (engine mode),
e2e/fixtures/catalog/ (M1)
```

- **Why the main process:** the catalog is fetched over the network, cached on disk and shared by every window. It is not engine state, so it does not belong in engine-host. MAWS's main process already owns outbound HTTP for connectors. **The boundary:** the catalog's engine reads (`plugins.list`, `plugins.available`, `marketplaces.list` and, for each added marketplace, `plugins.marketplaceManifest`, each per `cwd`) go through the engine host, from `src/main/catalog/engine-reads.ts`, and their answers are held per `cwd` until `plugins.changed` fires or the host's settings watcher reports a change (the same signals `reload-after.ts` acts on).
- **Why not only via the engine:** the engine's `--available` listing already covers the whole directory (fact 2) and every marketplace that is added, so it is the install-route source. What it cannot show is a seed marketplace the person has not added: adding thirteen marketplaces to their settings just to browse them would write configuration they never chose. So the manifests of un-added seeds are fetched directly, and the directory is read directly for what the engine's listing lacks (publisher, tier, categories, components, icons). The alternative, the engine only, lost on the un-added seeds; the alternative, the directory without the engine, lost because the engine's entry names are the only install route a directory plugin has.

### The catalog

**Sources**, in this order:
1. **The seed list** in `src/main/catalog/sources.ts`: the twelve general repositories of fact 1 (Anthropic's nine, Notion, Canva, Carta), each with a display name, a publisher (the organisation) and an ownership class `anthropic`, `partner` or `community`. The owner's doperpowers and cua are not seeds (fact 1a): a seed list in the general base holds only general sources (CLAUDE.md's split). The alternative, hardcoding the owner's two as a `yours` class, lost because every other user would see them as theirs.
2. **Marketplaces the engine already has** (`marketplaces.list` for the page's `cwd`; the engine's listing carries no `owner`, which comes from the marketplace's manifest, read through `plugins.marketplaceManifest`). One that is not a seed is class `added`. One that is a seed keeps its seed class; the engine's `anthropic-plugin-directory` is always present and is class `anthropic`.
3. **The engine's available listing** (`plugins.available` for the page's `cwd`): every entry's name, marketplace, `source` (with its `sha` and `ref`, which M2 stops the host's reducer from dropping) and `installCount`. The listing omits plugins that are installed (fact 2a): an installed plugin's route comes from `plugins.list` (its name and marketplace) and its source from that marketplace's manifest read. This is the install route for a directory plugin and for any added marketplace's plugin. **An added marketplace's metadata** (its plugins' author, skills, hooks, commands, agents, and each MCP server's transport) is not in that listing: the catalog reads it through `plugins.marketplaceManifest`, an explicit host read of the marketplace's manifest and its plugins' manifests from the clone under the marketplace's `installLocation`, the same reading `plugins.manifest` does for one plugin. The alternative, fetching the added marketplace's manifest from GitHub, lost because a local or private marketplace has no raw URL and the clone is what installs.
3a. **Test sources** (fixture-only): when the environment variable `MAWS_CATALOG_TEST_SOURCES` names a JSON file, `sources.ts` adds each descriptor in it as one more source: `{key, label, ownership: 'added', marketplaceName, marketplaceSource, manifestPath}`, where `marketplaceSource` is the scratch absolute path `plugin marketplace add` takes and `manifestPath` the marketplace's `marketplace.json`, read from disk. Its plugins are discoverable whether or not the engine has the marketplace; once it does, their routes are `present` and the engine's listing is what names them. The seam adds sources only: listing after the add and every mutation stay real. The alternative, a recorded `plugins.available` standing in for the CLI, lost because acceptance must prove the real listing; the recorded listing is a unit-test input only.
4. **Anthropic's directory, plugins** (`/api/directory/plugins?visibility=public&limit=5000`, paged until `next_page` is empty). A record without `source.repository` is dropped at parse: it is a connector or a desktop extension, not a plugin (fact 3). The alternative, `visibility=commercial,public`, lost because it puts 7,256 non-plugins into the Plugins tab with no install route, and Linear twice.
5. **Anthropic's directory, servers** (`/api/directory/servers?limit=500`, paged by `cursor` until `next_cursor` is empty). Connectors come from here only (the owner's ruling).
6. **plugin-details.json** (fact 2): counts, components and `last_updated` for the official marketplace.

**Fetching.**
- **Marketplace manifests** of seeds the engine does not have: `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/.claude-plugin/marketplace.json`. Raw URLs need no token and serve the 1.56 MB community manifest, which the Contents API does not. A marketplace the engine has is read from the engine's listing, not fetched: the engine's clone is what installs.
- **Requests:** every catalog request goes through MAWS's one guarded GET, `egressGet`, under a new egress rule `catalog` (Decision Log, fourth entry): GET only, no redirect followed, no credentials, a content-type list and a size cap per route, a timeout per rule. Its routes: `raw.githubusercontent.com/<owner>/<repo>/HEAD/.claude-plugin/marketplace.json`, `api.anthropic.com/api/directory/plugins` and `/api/directory/servers` with the queries above, and the plugin-details URL of fact 2; M2 measures each route's content type and size and sets the caps to fit. A `User-Agent` naming MAWS and its version; `If-None-Match` where an ETag was served, if the guarded GET carries it (else a full fetch every 24 h, recorded). Under `MAWS_E2E=1` the network is never reached.
- **The fixture seam:** when the environment variable `MAWS_CATALOG_FIXTURES` names a directory, `fetch.ts` reads `<dir>/<source-key>.json` instead of the network and reports the source `fresh`; a missing file is the source failing (so a test can make the directory unavailable by leaving its file out). It changes no behaviour above `fetch.ts`. The test-source seam (Sources, 3a) is the only other test hook; neither touches the engine reads.

**Caching.**
- Each source is cached under the app's user-data directory (`catalog/<source-key>.json`: the raw response, its fetch time and its ETag where served). Sizes today: plugins 13 MB, servers 2.7 MB, the community manifest 1.6 MB, plugin-details 0.5 MB.
- Discover refreshes a source when its copy is older than 24 hours, and Discover's Refresh refreshes all of them. Refresh is serialised: one refresh at a time; a second request joins the one running.
- A failed source keeps its last copy and reports its age. A source never fetched and failing is reported as unavailable. In both cases the other sources still show.
- The engine reads (sources 2 and 3) are not cached on disk; they are re-read on `plugins.changed`, on a change main's settings watch sees (Decision Log, eighth entry) and when the page's `cwd` changes.

**Parsing.**
- Every record passes a zod schema at this boundary. Taxonomy values may be a string or an array; both are accepted.
- A record that fails is dropped and counted; it never stops the source. Unknown fields are ignored.

**Normalising.** Every record becomes one `CatalogItem` (shape in Interfaces):
- **Kind:** `plugin` or `connector`.
- **Routes:** every way the engine can install the thing, each `{marketplaceSource, marketplaceName, pluginName, ref | null, present}` for a plugin (`present`: the marketplace is already in the engine's list, so no add step is needed), or `{name, url | null, urlPattern | null, transport, authPosture}` for a connector. The chosen route is the first by precedence (below); the others are "Also listed by …".
- **Components:** skills (with their names), MCP servers (with each one's transport where the manifest or the directory says), hooks, commands, agents, CLI tools, where known; `null` when nothing lists them.
- **Runs code:** `runsOnYourComputer` is `true` when any component has `access.type: runs_on_your_computer`, is a hook, is a `cli` component, or is an MCP server with transport `stdio`; `false` when every component is known and none of those holds; `'unknown'` when the components are not known.
- **Who published it** (the publisher chain), the ownership class, the directory's review tier and scan state, categories (one axis, below), description, icon, `installs` and `rank` where a source has them, and `updatedAt` from plugin-details' `last_updated`, else the directory's `updated_time`.
- **Names:** `name` is the display name (the directory's where it has a record, else the manifest's); `installName` is what the install command uses. Search indexes both; detail shows both when they differ.

**One item per thing.** Two records are the same item when they point at the same source: the same repository (URL normalised: lower-case, `.git` and a trailing slash dropped) and the same path within it. Refs are not part of identity; each route keeps its own ref (fact 1b, fact 3: the directory's `reviewed_commit` and a marketplace's pin differ for 648 of 1,436 matches, and seeds pin the same source at different refs 107 times; identity by ref would show one plugin two or three times). Names never join items: two sources can both have a "github" plugin. **One exception:** where one marketplace lists several entries at the same (repository, path), each entry defines its own plugin (`strict: false` entries naming different skills; anthropics/skills lists five at `./`, life-sciences two), so the identity of such an entry is (repository, path, entry name), and it joins another source's record only at the same three.
- **Route precedence** when several sources list the same (repository, path): routes whose marketplace the engine already has come first, so that + never adds a marketplace it does not need; within each group the order is claude-plugins-official, then the other seeds in table order, then `anthropic-plugin-directory`, then claude-community, then a non-seed added marketplace. Ownership follows the chosen route. The alternative, the richest metadata's source, lost because the route is what the engine runs and what My items will show.
- **Metadata precedence:** the directory's record where one exists (tier, publisher, categories, components, icon), plugin-details for counts, components and `updatedAt` of official plugins, `plugins.marketplaceManifest` for an added marketplace's plugins (author, components, transports), the manifest entry for the rest. So a plugin from an added marketplace the directory has never heard of still shows its author, its skills and whether it runs code.
- **Installed state** is computed per `cwd` against `plugins.list`: `here` when any route to this (repository, path) is installed at a scope that applies in this `cwd` (user, or project/local for this project; `coversHere` in `InstalledPluginSchema`), `elsewhere` when installed only in another project, `no` otherwise. A connector is `here` when its name is configured in a scope that applies in this `cwd`.
- A directory plugin the engine's listing does not carry (no `reviewed_commit`, 0 of 3,601 on 2026-10-25, the fixture's record synthetic; a surface without `claude_code`, 5; the engine's directory off or blocked by policy) is shown with its documentation link and no + button, with the reason in detail ("Not installable by this engine: no reviewed commit" or "Anthropic Directory is off in this engine").

**Publisher chain:** the directory's `publisher.name`, else the manifest entry's `author.name`, else, only for an entry whose source lies in the marketplace's own repository (a local `./…` entry or a source in that repository), the seed's publisher (the organisation the seed list names: Anthropic, Notion, Canva, Carta) for a seed, or the marketplace manifest's `owner.name` for an added marketplace (`plugins.marketplaceManifest`). An entry pointing at another repository (`external_plugins/*`, a vendor's repository) never inherits the marketplace's publisher (Decision Log, seventh entry). (The directory names a publisher for 9 of 3,601 plugins; the chain is what makes "by Anthropic" true for claude-for-legal.)

**Categories:** one taxonomy axis, chosen by coverage over the public plugin set and the servers set. Measured today: `object_acted_on` covers 92% of the 3,601 plugins (29 values; code 1,123, files-documents 885, designs-media 442, tickets-tasks 380) and 57% of the 1,011 servers; `work_department` 66% and 30%; the other three axes under 15%. The servers' own `categories` field covers 86% of servers (25 values). The decision: `object_acted_on` for every tab, with a connector falling back to its `categories` when it has no `object_acted_on`. M2 re-measures from the recorded fixtures and the live walk and records the numbers in the Decision Log; if a later axis beats it on both sets, M2 switches and records why.

**Components before install.** When no source lists an item's components (a remote git entry the directory doesn't know: 1,344 manifest entries today, 1,297 of them claude-community's), the card says "Contents shown after install", the honest copy `widgets/plugins/BrowseDetail.tsx` already uses, and the sheet carries Desktop's "may include components that run code".

### Discover, per tab

| Tab | Discover shows | Add does |
|---|---|---|
| Plugins | every plugin item | install the plugin |
| Skills | plugin items whose skills are known, one card per item, its skill names listed; a one-line note says that items with unknown contents are under Plugins | install the plugin that carries them, named as such |
| Connectors | servers-endpoint items that are `remote`, list `claude-code` in `works_with`, and have transport `streamable-http` or `sse` (733 today) | add the server, then offer sign-in where `auth_posture` is `auth_required` |

- **Directory servers that are local desktop extensions** or do not work with Claude Code are not shown. A remote server with `url: null` and a `url_regex` is shown; its sheet asks for the instance URL (Adding, below). Running another publisher's install command is out of scope for this work.
- **A skill card never implies a lone skill install.** Its + sheet says "Installs the plugin <name> from <marketplace>, with N skills: …" and lists the other components that come with it. That is the unit the engine installs; Desktop's Discover does the same with plugins presented as skills.

**The home** (the owner's approved shape; the Featured rule and the sort control are this revision's):

```
Discover            [Search all sources      ]   Refresh · updated 3 h ago
[Anthropic] [Partner] [Community] [Added by you]  Category ▾  Not installed ☐

┌ Featured · From Anthropic ───────────────────┐
│ Data        Query, chart and explain   [Add] │
│             2.9M installs                    │
└──────────────────────────────────────────────┘
Your sources                              See all
[doperpowers +] [cua +] [ci-kit +]
Claude for Financial Services             See all
[Pitch deck +] [Comps +] [DCF +] …
Code                                      See all
[Data +] [Snowflake +] [Hex +] …
All · 3,912                     Installs ▾
```

- **Featured:** derived from data MAWS has, never editorial. Plugins and Skills: the item with the most installs among those listed by Anthropic (an `anthropic` route, which plugin-details covers) that is not installed here; on Skills, among items whose skills are known. Connectors: the item with the best `popularity_rank` not configured here. No card when none qualifies. The directory's launch banners are ignored: the one that exists is a gated partner beta (fact 3). The alternative, Desktop's banner, is not reproducible (fact 5).
- **Your sources:** first, items from `added` marketplaces (doperpowers, cua and whatever else the person added, fact 1a). Empty for a person who added none; then the shelf is not shown.
- **One shelf per seed source** with more than one item, in the seed order. Community gets no shelf.
- **Category shelves:** the chosen axis's values with the most items in this tab, at most four.
- **All:** every item, under the sort control: installs or rank (default), updated, or name.
- **Shelf order** within a shelf: installs or rank descending, then `updatedAt` descending, then name ascending, ties by id. The alternative, alphabetical, lost: it puts `42crunch…` first on a shelf of 315.
- **Shelf size:** each shelf shows one row, as many cards as fit, plus See all, which opens the grid filtered to that shelf (the source, or the category) with the shelf's chip removable.
- **Search** covers every source and both names; matches on name rank above matches on description.
- **Filter chips:** ownership class and review tier together (Anthropic, Partner, Community, Added by you), category, and Not installed.
- **Installed state:** an item installed here shows "Installed" in place of + and its card opens the item in My items; one installed only in another project shows "Installed in another project" and keeps +.

**A card** shows:
- the icon, name and one-line description (the icon fetched by main through the egress rule and handed to the renderer as data, else a monogram; Decision Log, seventh entry);
- "by <publisher>";
- the trust label;
- the components ("3 skills · MCP server · runs code"), or "Contents shown after install";
- "N installs" where a source has it (official plugins), or "#N most popular" for a connector with a rank;
- the + button.

Counts are shown where the source has them and nowhere else. The alternative, no counts at all (the first draft's fact 4), lost: Browse already shows the engine's number, and the connector ranks are public (fact 5).

**The trust label** comes from the review tier where the directory has one: Verified · Partner · Community. Otherwise it comes from the ownership class: Listed by Anthropic · Listed by <vendor> · Community · Added by you. Tooltips:
- Verified: Desktop's wording (fact 5), with "plugin" or "connector".
- Partner: "Anthropic's directory lists the publisher as a partner." No security claim: Desktop folds partner into Verified, and the directory does not say what a partner review covers.
- Community: Desktop's plugin or connector wording.
- Listed by Anthropic / Listed by <vendor>: "In the <marketplace> marketplace; Anthropic's directory has no record of it." ("Anthropic repository" was the first draft's label; it lost because 262 of the official marketplace's 315 entries live in other people's repositories.)
- Added by you: "You added this marketplace. Anthropic hasn't reviewed it." (Desktop's Custom wording, adapted.)
A failed security scan in the directory disables + with the reason, as in Desktop; no live record fails today (fact 3), so the fixture's failed-scan record is synthetic and marked so. Cards do not advertise "security checks".

### Adding

**Plugins and skills reuse the existing install sheet.** It gains three things:
- what gets installed, with the plugin's components, and "Also listed by …" when the item has other routes;
- the runs-code warning when `runsOnYourComputer` is `true` ("includes components that run code", naming them: hooks, a local MCP server, a CLI), and the softer "may include components that run code" when it is `'unknown'`;
- when the route's marketplace is not present yet, a first step that adds it at the chosen scope.

Both steps run through the existing runner, as `plugin marketplace add <owner/repo> --scope S` and then `plugin install <name>@<marketplace> --scope S`. If the add succeeds and the install fails, the marketplace stays added, and the sheet says so and offers Remove marketplace. The one-step `--marketplace` form is not used (fact 2: it always writes user settings).

**Connectors** get a new sheet, built like the install sheet. It shows:
- the server's name, publisher, review tier and URL;
- the transport (`http` for streamable-http, `sse` for sse);
- for a server with a `url_regex` and no URL, a required instance-URL field validated against the regex, with the pattern shown;
- the scope, defaulting to **user** (the engine's own default is local; user matches how the person thinks of a connector, available in every project);
- "No sign-in needed" when `auth_posture` is `no_auth`;
- the exact command `claude mcp add --transport <http|sse> <name> <url> --scope <scope>`.

The runner gains `mcp add` and `mcp remove` beside `plugin`, their results parsed from the lines the CLI prints (fact 2). **The name** is the directory's `claude_code_copy_text` name when the record has one, else its `slug`, else the display name lower-cased with runs of other characters replaced by one hyphen; the sheet shows it and lets the person edit it within the engine's rule. (`normalizedMcpName` in `src/engine-host/mcp-call.ts` is the engine's tool-prefix rule and would name Google Drive `Google_Drive`; it is not used here.) If that name is already configured in the chosen scope, or in any scope that applies in this `cwd`, the sheet refuses and shows the existing entry: the engine does not refuse a duplicate itself (fact 2).

**Signing in** drives the engine's own flow, so the agents' sessions are signed in. It is an operation main owns (`src/main/connectors/sign-in.ts`): `connectors.signIn` answers a receipt at once and progress arrives as `connectors.signInChanged` events, because consent takes as long as the person takes and every main-to-host call must answer within 10 s (What exists today: the supervisor). The host exposes three bounded calls main composes: `session.mcpAuthenticate` (`mcp_authenticate`), `session.mcpOAuthCallback` (`mcp_oauth_callback_url`) and the existing `session.mcpStatus`; and, if the spike promotes path A, `session.mcpSetServers` (`mcp_set_servers`). The states and transitions:

| State | Entered when | Leaves on |
|---|---|---|
| `starting` | the receipt is issued | `session.mcpAuthenticate` answered → `waiting_browser`; error → `failed` (`engine`) |
| `waiting_browser` | the engine answered an `authUrl`; MAWS opens it in the system browser | `redirectScheme: 'custom'` → `waiting_callback`; `'localhost'` → `watching_status`; `requiresUserAction: false` → `done` |
| `waiting_callback` | MAWS's loopback listener (127.0.0.1, ephemeral port, path `/callback`, one operation, one `state`) is up | the one request whose `state` matches → `submitting`; another request → answered 400, still waiting; 5 min → `failed` (`timeout`) |
| `watching_status` | the engine holds its own `localhost:<callbackPort>` listener; MAWS polls `session.mcpStatus` every 2 s | the server reports connected → `done`; `needs-auth` still after 5 min → `failed` (`timeout`); the server reports failed → `failed` (`engine`, its message) |
| `submitting` | `session.mcpOAuthCallback` is sent with the callback URL | success → `session.mcpReconnect`, then `watching_status` (the engine does not reconnect a server whose callback arrived this way; Decision Log, twelfth entry); error → `failed` (`denied` when the callback carried `error`, else `engine`) |
| `done` / `failed` / `cancelled` | terminal | — |

Cancel (`connectors.signInCancel`) closes the listener or stops the poll and ends in `cancelled`; the engine's own pending flow is left to its own timeout, and a retry starts a new operation (the spike records whether the engine refuses a second `mcp_authenticate` while one is pending, and what message Sign in shows then). The attached session exiting in any non-terminal state ends in `failed` (`session_exited`). One operation per server at a time.

**Which session.** A connector added after the attached session started is not loaded there: it never appears in that session's `mcp_status` (`mcp_authenticate` nonetheless starts a flow for it, against fact 2's "Server not found"; M4's spike). The spike decided between two paths: path A is out (Decision Log, twelfth entry), because `mcp_set_servers` removes the session's SDK server, and MAWS never uses it. **Chosen: path B with the late-server variant** (Decision Log, fourteenth entry): Sign in is offered from any ready session whose scope includes the connector, including one started before the add. The flow is `mcp_authenticate`, then the callback (the custom scheme through MAWS's listener followed by `mcp_reconnect`, or the localhost scheme through the engine's own listener). When the callback succeeds the connector reads "Signed in", then "connected here" when the signing session's `mcp_status` lists it connected, else "available in new sessions". One sign-in per connector at a time: a second press cancels the first (the engine refuses the old flow's callback anyway). The paths as first written follow, for the record:
- **Path A:** load the server into the attached session with `session.mcpSetServers` for the sign-in, then authenticate; the credential is stored under the server's name and URL, so sessions that read the file configuration find it. Promote only if the spike shows the call does not drop the session's other dynamic servers and the next file-configured session reports the server connected.
- **Path B:** offer Sign in only in sessions started after the add; until one exists, Sign in says "Open a session in <project>, then sign in" and does nothing else. Customize never starts a session (a standing rule of the page).

**If the spike discards engine-driven sign-in** (neither scheme completes against the fixture for a reason that is the engine's, not the fixture's): add and remove still work, and Sign in hands off to the engine itself. It opens MAWS's terminal surface in the project directory with the engine running, and tells the person to run `/mcp` there, choose the server and authenticate, with a copy button for `/mcp`. That is the engine's real TUI, sharing the same configuration and Keychain; the composer's `/mcp` is MAWS's own widget and cannot do it (What exists today). **How it is launched:** `pty.spawn` with `shell` set to the absolute engine path `binary-info.ts` resolved (the same binary the runner spawns), `args` the engine's own argv, `cwd` the project, and `env` carrying `CLAUDE_CONFIG_DIR` when the host runs under one; never a `command` line naming `claude`, because the pty host's environment has no `MAWS_` variable and its PATH may have no `claude` (fact 6). `pty.spawn` gains the optional `env`, limited to that one variable, which the pty host applies after its own stripping. The design section is revised with a Decision Log entry either way.

MAWS's own OAuth store (`src/main/connectors/oauth-store.ts`) is not involved: those credentials serve MAWS's own connections, not the engine.

### My items

My items is as today for Plugins and Skills, plus "Installed in another project" where that is the case for the page's `cwd`. Connectors' My items keeps "Configured on disk" and "Live in the attached session", and adds:
- **Remove** for a server configured in a scope MAWS can name. It runs `claude mcp remove <name> --scope <scope>`.
- **Sign-in state** from the attached session's `mcp_status`: connected, needs sign-in, or failed with the engine's message; "No sign-in needed" for an authless server.

**Installed versus ready.** MAWS claims only what it can observe:
- an installed plugin whose MCP server the attached session reports failed shows "Installed · its server failed: <engine message>";
- a connector shows its sign-in state.

There is no generic "needs setup" detection, because a plugin's setup steps, such as cua's runtime, are not machine-readable.

The tab named "MCP servers" becomes **Connectors**, matching Desktop and the owner's word. The layout schema's `customize` section value `mcp` stays as it is, so saved tabs keep working; only the label changes.

### What agents see

Nothing new. The catalog lives in the main process and the renderer. No engine tool, MCP server, prompt text or session context carries it. M5's acceptance checks this.

### Failure handling

| Failure | What the person sees |
|---|---|
| A source unreachable, cached copy exists | Its items, and in Refresh's popover "<source>: offline, from 2 days ago" |
| A source unreachable, never fetched | "<source> unavailable" in that popover; the other sources show |
| The directory unreachable | Plugins and skills from the engine's listing and the manifests, with plainer cards: no review tier, categories or icons. Connectors' Discover says "Anthropic's directory is unavailable" with Retry |
| plugin-details unreachable | Official cards without counts; Featured on Plugins and Skills absent until a copy exists |
| A record fails its schema | Dropped; Refresh's popover counts the dropped records per source |
| The engine's directory is off or blocked by policy | Directory plugins show "Not installable by this engine: <reason>" and no +, as detail explains |
| The engine refuses an add or install | The engine's own words, as the install sheet shows today |
| A command-declaring marketplace | The existing second sheet with the command and its hash |
| A connector name already configured here | The sheet refuses and shows the existing entry |
| An instance URL that does not match the server's pattern | The field says so, with the pattern; + stays disabled |
| Sign-in: the session does not know the server | Path A loads it; path B: "Open a session in <project>, then sign in" |
| Sign-in: callback timeout (5 min), denied, cancelled, session exited | "Sign-in didn't finish" with the reason; Sign in can be pressed again |
| Sign-in: a retry while a flow is pending | The engine starts a new flow and refuses the old flow's callback ("OAuth state mismatch"); MAWS's new operation completes, the old one's listener is already closed |

## Acceptance

Run against the branch's build in the e2e harness as M1 provides it: the real 2.1.309 engine, provisioned by the job and asserted by the run (fail, not skip, when it is missing or another version), a scratch `HOME` (except the sign-in scenes of item 9, which run under the runner's `HOME` with a scratch `CLAUDE_CONFIG_DIR`, since a scratch `HOME` hides the login keychain, fact 6), a scratch `CLAUDE_CONFIG_DIR` and project directories, `MAWS_CATALOG_FIXTURES=e2e/fixtures/catalog` so the catalog's network fetches read recorded files, `MAWS_CATALOG_TEST_SOURCES` naming the generated descriptor of the local test marketplace (M1), and the engine's Anthropic Directory turned off in the scratch configuration so `plugin list --available` is deterministic. Every engine listing and mutation in these items is the real CLI; no recorded engine output stands in for it. Gate group: `e2e:discover`. The offline test phase needs no network.

1. **The home.** Customize → Plugins → Discover shows, in order:
   - the Featured card: the fixture's most-installed Anthropic-listed plugin not installed here, with its install count;
   - "Your sources" with the local test marketplace's plugins, discoverable through the test-source descriptor before the marketplace is added, class `added`, labelled "Added by you", each with its author and components from its manifest;
   - a shelf per seed source with more than one item, each shelf ordered by installs, then updated, then name;
   - up to four category shelves;
   - "All · N", where N equals the fixture's distinct item count after joining, and the sort control on Installs.

   Screenshots at 1280×820 and 1512×982 go next to the owner's Discover reference.
2. **Search and labels.** Searching "legal" lists claude-for-legal's plugins, each "by Anthropic" (from the manifest's `author`, the directory record having none) with its directory label. A claude-community item reads Community and its tooltip has the community wording; a partner item reads Partner with the partner tooltip; a joined item (the fixture's official-and-community pair) is one card whose detail reads "Also listed by claude-community"; the same-name pair (two `skill-creator` plugins from different repositories; the live seeds hold no same-name "github" pair, Decision Log, fifth entry) stays two cards; searching the directory's display name "Adobe" and the install name `adobe-for-creativity` both find the item.
3. **Installing, end to end.** Pressing + on the test marketplace's `hooked` plugin before the marketplace is added opens the sheet:
   - it shows "Adds the marketplace <name> (user) and installs hooked", the plugin's components, and the runs-code warning naming its hook;
   - after confirming, the scratch user `settings.json` lists the marketplace and the plugin enabled, `claude plugin list --json` in the scratch configuration lists it, My items shows it, and its Discover card reads Installed;
   - the `local-server` plugin's sheet warns (stdio MCP server); `skills-only`'s does not; the fixture's unknown-contents item says "may include components that run code".
4. **Installed here versus elsewhere.** With two scratch projects A and B: installing `remote-server` at project scope in A makes its card read Installed in A and "Installed in another project" in B, where + still works; the Not installed chip hides it in A and shows it in B.
5. **A skill installs its plugin.** In Skills → Discover, the `skills-only` item's sheet names the plugin and lists its skills, and the tab's note points unknown-contents items to Plugins.
6. **See all and sorting.** See all on the Claude for Financial Services shelf opens the grid with that source's chip, removable; sorting All by updated across the fixture's page boundary (the fixture has items with equal `updatedAt`) lists every item exactly once in both directions.
7. **Marketplaces change under Discover.** Adding the test marketplace by path from Manage marketplaces while Discover is open makes its plugins' routes `present` without reopening the page (their sheets no longer offer the add step, and their author and components now come from the host's manifest read of the clone); removing it restores the add step. A second added marketplace that neither the directory nor the seeds know (a scratch clone the test makes) shows its plugins with author, skills and a stdio server's runs-code warning from the same read.
8. **Adding a connector.** In Connectors → Discover, Linear is listed: Partner, "#N most popular", with its URL. + opens the connector sheet with name `linear`, scope user and the exact command. After confirming, the scratch configuration has `linear` with type http and that URL, and Connectors → My items lists it under Configured on disk with "Sign in needed". The fixture's `url_regex` server requires an instance URL and rejects one that does not match; its authless server reads "No sign-in needed"; pressing + on Linear again is refused with the existing entry shown; Remove removes it.
9. **Signing in, promoted path** (Decision Log, fourteenth entry; runs only on the Mac mini, Decision Log 13). Against the engine-mode OAuth fixture: (a) with session S1 running, add the connector, sign in from S1: Sign in reaches `done` and its result line agrees with S1's own `mcp_status` (measured on the mini: the reconnect after the callback loads the late server into S1, so it reads "Signed in · connected here"); start S2, and S2's `mcp_status` reads the server connected. (b) With a session started after the add: Sign in reaches `done` and that session's `session.mcpStatus` reports the server connected ("connected here"). In both, the browser step is driven by the test; a consent the test delays by 15 s still completes; Cancel ends in `cancelled` and a retry completes; a second press cancels the first operation and completes; stopping the session mid-flow ends in `failed` (`session_exited`); with no ready session whose scope includes the connector, the button shows the "Open a session" message. Keychain custody: the scratch configuration's exact service name (fact 2) is absent before the run starts, is recorded as the run's own before the exchange, and in teardown, after every engine (S1 and S2) is stopped, is deleted by that exact name and verified gone; no other item is read or removed.
10. **Signing in, discarded path.** With `claude` deliberately absent from the pty host's PATH, Sign in opens MAWS's terminal in the project with the engine running and the `/mcp` instruction with its copy button; the pty's process is the resolved engine path, its `CLAUDE_CONFIG_DIR` is the scratch configuration and its cwd the project; add and Remove still pass item 8. Exactly one of items 9 and 10 runs, per the spike's verdict recorded in the Decision Log.
11. **Without the directory.** With the directory's fixture files absent, Plugins → Discover still lists the engine's and the manifests' items with no review tier, Refresh's popover says the directory is unavailable, and Connectors → Discover shows the unavailable message with Retry; with plugin-details absent, official cards show no count and Featured is absent.
12. **Nothing reaches agents.**
    - A unit test asserts that no MCP tool name, system-prompt fragment or engine launch argument built by MAWS mentions the catalog.
    - The fake session's tool list in the e2e run is the same with Discover visited as without.

**Live smoke, opt-in, not part of the gate** (`MAWS_LIVE_SMOKE=1`, a Mac with network, a scratch configuration): the real sources are walked, the counts are printed and compared with Surprises & Discoveries, `frontend-design@anthropic-plugin-directory` is installed into the scratch configuration through Discover and uninstalled, and Linear is added and removed.

## Execution

### Constraints for every milestone

- **The engine is unmodified** (D-1). Mutations go only through its CLI (`plugin …` and `mcp …` via `src/engine-host/plugins/runner.ts`) and its control requests. MAWS never writes the engine's settings files itself. The test harness may write the scratch configuration's on/off file for the engine's directory marketplace; MAWS never does.
- **Network:** only GET requests, to `raw.githubusercontent.com`, `api.anthropic.com/api/directory/*` and the plugin-details URL of fact 2, with no credentials, and only through `egressGet` under the `catalog` rule (all of MAWS's traffic beyond the model's own goes through the egress rules, charter §19, P4-B2 2026-10-22; Decision Log, fourth entry). Nothing from the catalog is sent anywhere.
- **IPC:**
  - New IPC follows `src/shared/ipc/names/*` and `src/shared/ipc/schema/*`, with a name list and a zod schema per namespace, pinned by `src/shared/ipc/schema.test.ts`.
  - Only display metadata and install routes cross IPC. A connector's URL crosses, because the person must see it before adding.
- **Styling:** light theme by default; components use tokens only.
- **Copy** is plain and literal. Trust wording follows the Design's label section and never claims more review than the source records.
- **Gates:**
  - class 1a through `scripts/ci-gate.sh <worktree> --gates static,unit,probes --class1a pool`;
  - Mac e2e through `--gates e2e:discover --runner macos --class1a pool` once M1 registers the group;
  - the whole Mac matrix at M5, because the work touches shell, layout and settings (P4 Decision Log 78).
  - No e2e runs on the MacBook. Local heavy runs go through `/tmp/maws-review/with-slot.sh`, one focused file at a time.
- **Off limits:** never touch the owner's running MAWS, its build, its user data, the owner's `~/.claude` or the owner's Keychain items. Probes and tests use scratch configuration directories and delete only the one Keychain item whose exact service name derives from their scratch directory (fact 2); nothing enumerates or deletes by prefix.
- **Gate infrastructure is shared:** `.github/workflows/gate.yml` also serves the CI-opt initiative; the change M1 makes there (the group and the provisioning step) is coordinated with CI-opt by the architect before it merges.

### M1 — The real-engine test harness and the catalog fixtures

Today no e2e group runs a real `claude plugin` mutation or an engine-driven OAuth (fact 6). At the end of M1 a gate group exists that launches MAWS with the pinned 2.1.309 engine, a scratch configuration and recorded catalog sources, installs a plugin from a local marketplace through today's Browse and ConfirmSheet, and sees it in `plugins.list`; and the OAuth fixture has an engine mode. Nothing in Discover exists yet; M1's proof is that the harness can prove M3 and M4.

- **Touches:**
  - `scripts/provision-engine.sh`: the job-local provisioning step for the Mac lane: downloads the official 2.1.309 build, verifies it against the checksum committed beside the script (`scripts/engine-checksums.txt`, one line per version), caches it under the runner's user directory by version, runs `--version`, and exports `MAWS_E2E_ENGINE_BIN` for the test phase. It runs before the offline test phase, so the phase itself needs no network. A verification failure stops the job with the checksum it saw.
  - `e2e/support/real-engine.ts`: resolves the engine as `MAWS_E2E_ENGINE_BIN`, else `~/.local/share/claude/versions/2.1.309`; runs `--version` and fails the run, with the provisioning command in the message, when it is absent or another version. Provisioning and verification are two steps on purpose: a missing or wrong version stays a test-time verification failure even when the job skipped provisioning. The pin's replay default (`test/support/engine-pin`) is not changed.
  - `e2e/support/launch.ts`: a launch option for a real engine with a scratch `HOME`, `CLAUDE_CONFIG_DIR`, one or two scratch project directories, `MAWS_CATALOG_FIXTURES`, `MAWS_CATALOG_TEST_SOURCES` (the descriptor file the launch writes into the scratch user-data directory, with the test marketplace's scratch absolute path), and the engine's directory marketplace turned off through its on/off file in the scratch plugins folder (fact 2; confirm the path against the binary and record it).
  - `e2e/fixtures/catalog/`: recorded, trimmed responses, one file per network source key: a slice of each seed's manifest (the official slice includes the official-and-community pair; the same-name pair is two `skill-creator` plugins), the manifests whole for the small seeds, the public plugins page trimmed to the records those slices join plus a community item, the synthetic failed-scan item, a record without `reviewed_commit`, and one with unknown contents; the servers pages trimmed to Linear, a `url_regex` server, an authless one, an `sse` one, a local desktop extension and one without `claude-code`; plugin-details trimmed to the official slice with counts and equal `last_updated` on two items. The scratch engine's raw CLI JSON (`plugin list --json --available`, `plugin list --json`, `plugin marketplace list --json`) goes under `test/fixtures/catalog/` as unit-test input for M2's reducers; never read by the e2e harness. The recorded `plugins.marketplaceManifest` answer is M2's (the read does not exist before it; Decision Log, fifth entry).
  - `e2e/fixtures/catalog/marketplace/`: a local marketplace with four installable plugins, `hooked` (a hook), `local-server` (a stdio MCP server that is a Node script in the fixture), `remote-server` (an HTTP MCP server pointing at the OAuth fixture's origin), `skills-only`, each with an `author`; copied into the scratch directory at launch and added by that absolute path.
  - `scripts/catalog-fixtures.mjs`: records and trims the network sources, so they can be re-recorded; committed with the fixtures.
  - `e2e/support/connector-oauth.ts`: an engine mode that accepts `http://localhost:<port>/callback` and `http://127.0.0.1:<port>/callback` redirect URIs, has no engine-PID gate, and owns the Keychain custody of acceptance 9: it derives the scratch configuration's exact service name (fact 2), requires it absent before the phase starts, records it as the run's own, and in teardown, after the engine is confirmed stopped, deletes exactly that name and verifies it is gone. The existing MAWS-only mode keeps every safeguard it has.
  - `package.json`: the script `e2e:discover` over `e2e/discover.spec.ts` and `e2e/discover-connectors.spec.ts`; `.github/workflows/gate.yml`: the group on the macOS lane with the provisioning step before its test phase (coordinated with CI-opt, Constraints); `scripts/ci-gate.sh`: nothing, it takes `e2e:<group>` by name.
- **Decisions:**
  - Missing prerequisites fail the run; they never skip (B1).
  - The fixture seam is one environment variable read by `fetch.ts` alone; the test-source seam is one environment variable read by `sources.ts` alone (Design, Sources 3a); neither replaces an engine read.
  - The Keychain derivation is confirmed against 2.1.309 by a scratch probe before the fixture relies on it, and the confirming line is recorded in Surprises & Discoveries.
  - The live smoke is a separate, opt-in spec (`e2e/discover-live.spec.ts`, `MAWS_LIVE_SMOKE=1`), never run by the gate: like the repository's other live specs, the bare `pnpm e2e` collects it and it skips itself without its flag; its own script `e2e:discover-live` sets the flag (Decision Log, seventeenth entry).
- **Does not touch:** `src/` beyond the two seams' environment variable names in `src/main/catalog/fetch.ts` and `sources.ts`, which M2 implements; the renderer.
- **Proves:** the harness prerequisites of every acceptance item; a smoke spec in the group installs `skills-only` through Browse and ConfirmSheet as they are today and sees it in My items; the provisioning step on a clean runner cache yields a binary whose `--version` is 2.1.309; and the engine-mode OAuth fixture completes a token exchange from a plain HTTP client with a `localhost` redirect and leaves the Keychain as it found it.

### M2 — The catalog

At the end, the main process holds a normalised, joined catalog of the seeds, the engine's marketplaces and listing, the directory's plugins and servers, and plugin-details, per `cwd`, cached on disk and served over the `catalog.*` IPC (Interfaces).
- A unit test loads the recorded fixtures and checks the item count, the joins, the route precedence, installed-here-versus-elsewhere for two `cwd`s, `runsOnYourComputer` for a stdio-only, a remote-only and an unknown item, the publisher chain, the category axis coverage, deterministic pagination across a tie, and the engine-read invalidation on `plugins.changed`.
- A dev-only command prints a summary of the live catalog. The milestone runs it once against the real sources and records the counts in Surprises & Discoveries beside the 2026-10-25 numbers.

- **Touches:**
  - new `src/main/catalog/` (sources with the test-source seam, fetch, engine-reads, normalize, join, store, index);
  - `src/engine-host/egress.ts` → `src/shared/net/egress.ts`: the guarded GET, its types and `EGRESS_RULES` move to a module main and the engine host both import, with the `catalog` rule beside `google-fonts`; its tests move with it and keep every guarantee; the source guard (no `fetch(` outside the egress module and route D's transport) extends to `src/main/catalog/`;
  - `src/shared/ipc/names/catalog.ts` and `src/shared/ipc/schema/catalog.ts`;
  - registration in `src/main/` where other namespaces register;
  - `src/engine-host/plugins/cli-result.ts`: `sourceRefOf` keeps `sha` and `ref` both (the fold-key reading stays where the manifest views use it); `src/shared/ipc/schema/plugins.ts`: `PluginSourceRefSchema` grows accordingly (`marketplace list --json` carries no `owner`; the owner comes from `plugins.marketplaceManifest`);
  - `src/engine-host/plugins/listings.ts` and `src/shared/ipc/schema/plugins.ts`: the new read `plugins.marketplaceManifest` (Interfaces), built on `manifestsFor`'s reading of a plugin's manifest from its marketplace's clone, extended to every entry of one marketplace in one call under the same deadline; its answer for the local test marketplace is recorded under `test/fixtures/catalog/` for the normaliser's unit tests.
- **Decisions:**
  - Join by source identity without refs; route precedence as the Design says; the fixture includes a pair that joins, a same-name pair that must not, and a pair at different refs that must.
  - The engine-host extensions come first, before normalisation consumes them; their unit tests take the recorded listings under `test/fixtures/catalog/` and an added marketplace that neither the directory nor the seeds know.
  - Parse each source independently. One failure never empties the catalog.
  - The refresh age is 24 h. Refresh is serialised.
  - `catalog.changed` fires once per refresh that changed anything and once per engine-read invalidation.
  - The category axis: `object_acted_on`, re-measured here and recorded (Design, Categories).
  - A cursor encodes the sort, the last item's sort key and id, and the catalog revision; a cursor from another revision restarts the page and says so (`restarted: true`).
- **Does not touch:** the renderer; the runner or the control client in engine-host.
- **Proves:** acceptance 11's data side (a source fails and the others remain); the join rules; schema drops counted; cache reuse when offline; acceptance 4's state per `cwd` (the data side); acceptance 7's data side (an added marketplace absent from the directory yields author, skills and a stdio server's `runsOnYourComputer: true`, and a test-source descriptor yields the same before the add).

### M3 — Discover for Plugins and Skills

At the end, Plugins and Skills each have My items and Discover; Plugins' Browse becomes Discover. The home, search, filters, sort, cards, detail and + work over M2's catalog, and installing runs through the extended sheet.

- **Touches:**
  - new `src/renderer/src/customize/discover/`;
  - `src/renderer/src/customize/CustomizeView.tsx`;
  - `src/renderer/src/widgets/PluginsWidget.tsx` and `widgets/plugins/*`. Browse is replaced by Discover, and the existing BrowsePane, BrowseCard and BrowseDetail are retired where Discover covers them;
  - `widgets/plugins/ConfirmSheet.tsx` and `present.ts`: the add-then-install route, the contents, the "Also listed by" line and the two warning wordings;
  - `e2e/discover.spec.ts`.
- **Decisions:**
  - Discover reads only `catalog.*`, always with the page's `cwd`.
  - The Add marketplace dialog gains the scope choice, which its confirmation lacks today.
  - "See all" opens the grid with the shelf's filter applied (`source` or `category`), and its chip can be removed.
  - Cards are a fixed height, so shelves align. Long descriptions clamp to two lines.
  - Keyboard: shelves are rows of buttons reachable by Tab; arrow keys move within a shelf; Enter opens detail; + is its own focus stop.
- **Does not touch:** connectors, or MCP add, remove and sign-in.
- **Proves:** acceptance 1 to 7, 11's Plugins side, 12.

### M4 — Connectors: the spike, then Discover, add, remove and sign in

**The spike comes first.** It is a prototyping step whose deliverable is a verdict.
- **Questions:** Over a ready session's control client, against M1's engine-mode OAuth fixture, does `mcp_authenticate` with a MAWS-chosen `http://127.0.0.1:<port>/callback` answer `redirectScheme: 'custom'`, and does `mcp_oauth_callback_url` then make `mcp_status` report the server connected? When the engine answers `'localhost'` instead, does its own listener complete the flow and `mcp_status` change? Does `mcp_set_servers` with the new server keep the session's other dynamic servers and leave a credential the next file-configured session uses (path A)? What does the engine answer to a second `mcp_authenticate` while one is pending, and to one after the session was cancelled mid-flow?
- **Where it runs:** on the Mac mini through the gate (an `e2e:discover` case or a probe job under `--runner macos`), never on the MacBook (Decision Log, sixth entry). If the runner's login keychain is locked or unavailable in a CI session, that is the spike's verdict; it does not fall back to the MacBook.
- **How to run it:** a probe script under `spikes/p4-aggregator/` that starts the engine in a scratch configuration with the server configured at user scope, the fixture in engine mode, and drives the exchange; each failure is classified as the fixture's (the fixture's own log shows a request it refused) or the engine's (the engine answered an error or never called the fixture).
- **Record:** the request and response frames as a fixture under `spikes/protocol-probe/fixtures/p4/`; the verdict and the Keychain service names seen, in Surprises & Discoveries.
- **Promote** when a sign-in completes through either scheme with the server reported connected; choose path A if its two conditions hold, else path B; record the choice in the Decision Log and in the Design's "Which session". **Discard** when no sign-in completes for a reason classified as the engine's: implement the terminal hand-off (Design, "If the spike discards"), record a Decision Log entry, and acceptance 10 runs instead of 9.

**At the end**, Connectors has My items and Discover. + adds a remote server at the chosen scope. Remove removes it. Sign in works as the spike's verdict allows, and My items shows each server's sign-in state.

- **Touches:**
  - `src/engine-host/plugins/runner.ts` and `src/shared/plugins/cli.ts`: the `mcp add` and `mcp remove` argv and their results parsed from the lines the CLI prints;
  - `src/engine-host/operations.ts`, `src/shared/ipc/schema/session.ts`: `session.mcpAuthenticate`, `session.mcpOAuthCallback`, `session.mcpSetServers` (path A only), each a bounded call under the supervisor's timeout;
  - `src/main/connectors/sign-in.ts`: the operation, its state table, the loopback listener reusing `oauth-callback.ts`'s pattern, the status poll;
  - `src/renderer/src/widgets/McpWidget*` and `customize/CustomizeView.tsx`;
  - the IPC `connectors.add`, `connectors.remove`, `connectors.signIn`, `connectors.signInCancel` and the event `connectors.signInChanged` (Interfaces);
  - on the discard path only: `src/shared/ipc/schema/pty.ts` (`pty.spawn`'s optional `env`), `src/pty-host/env.ts` (applies it after the stripping), and the terminal launch from the Connectors tab with the resolved engine path (Design, "If the spike discards");
  - `e2e/discover-connectors.spec.ts`.
- **Decisions:**
  - The default scope is user. The name rule and the duplicate refusal are the Design's.
  - The terminal fallback launches the engine by absolute path through `pty.spawn`'s `shell` and `args`, never by a `command` line (fact 6); the renderer asks the engine host for the path it resolved (`plugins.env` answers it today).
  - Only remote servers that work with Claude Code get +; `http` and `sse` both.
  - The listener binds 127.0.0.1 on an ephemeral port, accepts exactly one request whose `state` matches, answers a fixed page, and closes after it or after 5 minutes.
  - The engine's `mcp_authenticate` registers the client before answering (fact 2); if the spike measures that over 10 s against a slow authorization server, `session.mcpAuthenticate` becomes an operation with a receipt like `session.mcpReconnect`, and the state table's `starting` waits on its completion event.
- **Does not touch:** MAWS's own connector store (`src/main/connectors/oauth-store.ts`); the composer's slash handling.
- **Proves:** acceptance 8, 9 or 10, and 11's Connectors side.

### M5 — Acceptance

Run acceptance 1 to 12 as written (9 or 10 per the verdict), then the whole Mac matrix with `--evidence`. Capture the screenshots of acceptance 1 at both sizes, plus the detail sheet, the install sheet and the connector sheet, and put them next to the owner's two references. Run the live smoke once on a Mac with network and record its counts. Hand the branch back for the architect's branch review (Decision Log, verification).

- **Touches:**
  - the tests that acceptance 12 names;
  - fixes the acceptance run exposes.
- **Proves:** acceptance 1 to 12 together, on one head.

## Interfaces and Dependencies

`src/shared/ipc/schema/catalog.ts`:

```ts
export const CatalogKindSchema = z.enum(['plugin', 'connector']);
export const OwnershipSchema = z.enum(['anthropic', 'partner', 'community', 'added']);
export const ReviewTierSchema = z.enum(['anthropic', 'partner', 'community']).nullable(); // the directory's verified_tier only
export const McpTransportSchema = z.enum(['stdio', 'http', 'sse', 'unknown']);
export const PluginRouteSchema = z.strictObject({
  kind: z.literal('plugin'),
  marketplaceSource: z.string(),   // owner/repo, a URL or a path: what `plugin marketplace add` takes
  marketplaceName: z.string(),     // what `plugin install <name>@<marketplace>` takes
  pluginName: z.string(),
  ref: z.string().nullable(),      // this route's pin, if any; not part of identity
  present: z.boolean(),            // the engine already has this marketplace: no add step
});
export const ConnectorRouteSchema = z.strictObject({
  kind: z.literal('connector'),
  name: z.string(),                // the engine-legal name the sheet proposes
  url: z.string().nullable(),      // null when the server takes an instance URL
  urlPattern: z.string().nullable(), // the directory's url_regex
  urlOptions: z.array(z.strictObject({ url: z.string(), label: z.string(), description: z.string().nullable() })), // the directory's url_options: a choice of URLs (Decision Log, ninth entry)
  transport: z.enum(['http', 'sse']),
  authPosture: z.enum(['auth_required', 'no_auth']),
});
export const ManualRouteSchema = z.strictObject({ kind: z.literal('manual'), docsUrl: z.string().nullable(), reason: z.string() });
export const CatalogItemSchema = z.strictObject({
  id: z.string(),                       // stable: normalised repo url + path for a plugin; the directory's server id for a connector
  kind: CatalogKindSchema,
  name: z.string(),                     // the display name
  installName: z.string().nullable(),   // what the command uses, when it differs
  description: z.string().nullable(),
  publisher: z.string().nullable(),     // the publisher chain's answer
  ownership: OwnershipSchema,           // the chosen route's
  reviewTier: ReviewTierSchema,
  scanBlocked: z.string().nullable(),   // the directory's reason when a failed scan disables Add
  categories: z.array(z.string()),      // the chosen axis's values
  iconUrl: z.string().nullable(),
  updatedAt: z.string().nullable(),
  installs: z.number().int().nullable(),  // plugin-details unique_installs
  rank: z.number().int().nullable(),      // the servers endpoint's popularity_rank
  components: z.strictObject({
    skills: z.array(z.string()),
    mcpServers: z.array(z.strictObject({ name: z.string(), transport: McpTransportSchema })),
    hooks: z.boolean(),
    commands: z.number().int(),
    agents: z.number().int(),
    cli: z.boolean(),
  }).nullable(),                        // null: not known before install
  runsOnYourComputer: z.union([z.boolean(), z.literal('unknown')]),
  install: z.union([PluginRouteSchema, ConnectorRouteSchema, ManualRouteSchema]), // the chosen route
  alsoListedBy: z.array(z.string()),    // the other routes' marketplace names
  sources: z.array(z.string()),         // source keys that listed it
  installed: z.enum(['here', 'elsewhere', 'no']), // for the request's cwd
});
export const CatalogSourceStatusSchema = z.strictObject({
  key: z.string(), label: z.string(), fetchedAt: z.string().nullable(),
  state: z.enum(['fresh', 'stale', 'offline', 'unavailable']), dropped: z.number().int(),
});
export const CatalogSortSchema = z.enum(['installs', 'updated', 'name']); // 'installs' is rank for connectors
```

Commands (`src/shared/ipc/names/catalog.ts`); every one takes the Customize page's `cwd` (`PluginsCwdSchema`, or `null` for the user configuration), and `tab` is `'plugins' | 'skills' | 'connectors'`:
- `catalog.home({tab, cwd})` returns `{featured: CatalogItem | null, shelves: {key, kind: 'added' | 'source' | 'category', title, items, total}[], total}`.
- `catalog.query({tab, cwd, text, chips, category, source, notInstalled, sort, cursor})` returns `{items, nextCursor, total, restarted}`; `source` is a source key or `'added'`; pages are deterministic under one sort, ties broken by id.
- `catalog.item({id, cwd})` returns `CatalogItem`.
- `catalog.refresh()` returns `CatalogSourceStatus[]`.
- `catalog.sources()` returns `CatalogSourceStatus[]`.
- `catalog.icon({url})` returns `{dataUrl: string | null}`: a directory icon fetched by main under the `catalog` rule's icon routes, as a `data:image/(png|svg+xml);base64` URL, or null (a monogram) (M3).
- `catalog.home`'s answer also carries `categories: {value, title, total}[]`, every category value in the tab, for the Category filter (M3).

Event: `catalog.changed`.

Connector commands (M4), in the `connectors` namespace beside the existing names (`src/shared/ipc/names/connectors.ts`):
- `connectors.add({name, url, transport, scope, cwd})` returns the runner's receipt; completes on `plugins.operation` like a plugin verb.
- `connectors.remove({name, scope, cwd})` likewise.
- `connectors.signIn({name, scope, cwd, appSessionId})` returns `{opId}` at once; `connectors.signInCancel({opId})`.
- `catalog.postures({cwd})` (M4) returns, per configured server, the directory's auth posture matched by its endpoint against a record's `url`, `url_options` or `url_regex` (null when nothing or several disagreeing records match) and an opaque per-run fingerprint (an HMAC of transport and URL under a key that lives one MAWS run), each keyed by name, scope and the entry's file path; no URL reaches the renderer. Configured URLs reach main through the main-only host command `customization.serverEndpoints`; the inventory gains `serversRead`, true only when every applicable MCP configuration was read without a warning.
- Event `connectors.signInChanged {opId, name, state: 'starting' | 'waiting_browser' | 'waiting_callback' | 'watching_status' | 'submitting' | 'done' | 'failed' | 'cancelled', reason: 'no_session' | 'timeout' | 'denied' | 'engine' | 'session_exited' | null, message: string | null}`.

Host session calls (M4), in `src/shared/ipc/schema/session.ts` beside `session.mcpStatus`:
- `session.mcpAuthenticate({appSessionId, serverName, redirectUri})` returns the engine's `{authUrl, requiresUserAction, callbackExpected, redirectScheme, state, callbackPort}` or its error;
- `session.mcpOAuthCallback({appSessionId, serverName, callbackUrl})` returns `{ok: true} | {ok: false, message}`;
- `session.mcpSetServers({appSessionId, servers})` (path A only) returns the engine's `{added, removed, errors}`.

Plugin installs reuse `plugins.install` and `marketplaces.add` as they are, with `marketplaces.add` given its scope argument.

Engine-host extensions (M2), in `src/shared/ipc/schema/plugins.ts`:
- `PluginSourceRefSchema`'s object form gains `sha: z.string().nullable()` and keeps `ref` whether or not a sha pins the entry;
- `plugins.marketplaceManifest({cwd, name})` → `{ state: 'read' | 'missing' | 'unknown', owner, plugins: { name: string, author: string | null, source: PluginSourceRef | null, components: PluginManifestView['components'] | null, partial: boolean, problems: string[] }[] }`, read from the marketplace's clone under its `installLocation` under `MANIFEST_READ_MS`; a marketplace the engine does not have answers `unknown`.
- `plugins.directoryProvenance({names})` → `{pluginsDir, entries: {name, repositoryKey}[]}`: for installed `anthropic-plugin-directory` entries, where the engine recorded each one's code, read only from the engine's own records in its plugins folder (`plugin-directory-bindings.json`, then the `entryNames` of `plugin-directory-cache-v2.json`); never a join by name (Decision Log, ninth entry).

Terminal fallback (M4, discard path only): `PtySpawnInputSchema` gains `env: z.strictObject({ CLAUDE_CONFIG_DIR: z.string() }).optional()`, the one variable the pty host sets after its stripping.

Test seams (M1):
- the environment variable `MAWS_CATALOG_FIXTURES` (Design, Fetching); `e2e/fixtures/catalog/<source-key>.json` with the network source keys `seed:<marketplace name>`, `directory:plugins`, `directory:servers`, `plugin-details`;
- the environment variable `MAWS_CATALOG_TEST_SOURCES` (Design, Sources 3a), a JSON array of `{ key: string, label: string, ownership: 'added', marketplaceName: string, marketplaceSource: string /* absolute path */, manifestPath: string /* absolute path */ }`, generated at launch;
- `e2e/fixtures/catalog/marketplace/.claude-plugin/marketplace.json` with the four plugins named above; `test/fixtures/catalog/` with the scratch engine's raw CLI JSON (M1) and the recorded `plugins.marketplaceManifest` answer (M2) for unit tests;
- `e2e/support/real-engine.ts` exporting the resolved binary and version; `scripts/provision-engine.sh` and `scripts/engine-checksums.txt`.

## Surprises & Discoveries

- Observation: the "skill directories" are all plugin marketplaces already, so no skill copier is needed.
  Evidence: `gh api repos/<each>/contents/.claude-plugin/marketplace.json` returned a manifest for all fourteen (2026-10-24).
- Observation: Desktop's Discover home is a signed-in editorial feed, not the public directory.
  Evidence: `shared-52-uHFNjl7C.js:25534` (`/api/organizations/{org}/library/discover/home`).
- Observation: the directory's plugin records carry no install action naming a marketplace; the install route for a directory plugin is the engine's own built-in marketplace.
  Evidence: 10,857 of 10,857 records have `installation.actions == {"sign_in": true}`; `source.marketplace_slug` is `anthropic-plugin-directory` on 3,357, absent on the rest; cli.pretty.js 38626 `bn = "anthropic-plugin-directory"`, 38649 `Or = "Anthropic Directory"`, 780172 `directoryListingSource` (2026-10-25).
- Observation: `visibility=public` is exactly the installable plugin set; `commercial` adds only connectors and desktop extensions.
  Evidence: a `visibility=public` walk returned 3,601 records, every one with `source.repository`; the `commercial,public` walk's other 7,256 records are 7,124 with `checks.scan.reason == "directory_mcp_server"` and 132 with a `desktop_extension` component, all `claude_code: does_not_work` (2026-10-25).
- Observation: install counts and contents for official plugins are public; Desktop's counts are editorial but the engine's are not.
  Evidence: plugin-details.json (fact 2) answered 200, 539 KB, 315 ids, 313 with `unique_installs` (e.g. `agent-sdk-dev@claude-plugins-official`: 67,988); `PluginsWidget.test.tsx:1496` expects "1.3M installs" from `installCount` (2026-10-25).
- Observation: identity by pinned ref would split joined items.
  Evidence: of 1,436 (repository, path) matches between the fourteen manifests and the directory, 648 have a manifest ref unequal to `reviewed_commit`; 216 (repository, path) pairs appear in more than one manifest, 107 at different refs (2026-10-25).
- Observation: the directory names most plugins by a display name, not the install name, and names almost no publisher.
  Evidence: 723 of 1,436 matches differ in name ("Adobe" vs `adobe-for-creativity`); `publisher` is null on 3,592 of 10,857 records, including every anthropic-tier GitHub plugin (2026-10-25).
- Observation: no directory record fails a scan, and one record has a launch banner.
  Evidence: `checks.scan.state` counts: `not_scanned` 7,256, `unavailable` 3,601; `launch.banner` only on "Sana from Workday" (partner, beta, access-request form) (2026-10-25).
- Observation: the servers list has no community tier, and 268 of its servers do not work with Claude Code.
  Evidence: 1,011 servers: `verified_tier` partner 1,001, anthropic 10; `works_with` lacks `claude-code` on 268 (123 local desktop extensions); 73 remote Claude Code servers have `url: null` with a `url_regex` (2026-10-25).
- Observation: the engine answers `mcp_authenticate` with the authorization URL and a redirect scheme, and falls back to its own localhost listener.
  Evidence: cli.pretty.js 856485 `{ authUrl, requiresUserAction: !0, callbackExpected: !0, redirectScheme: tn, state, ...callbackPort }`; 856470 to 856480 "AS rejected custom redirectUri … falling back to localhost"; 856441 "Server not found" when the session has no such server (2026-10-25).
- Observation: the directory's taxonomy has five axes; one covers most of both sets.
  Evidence: over the 3,601 public plugins, `object_acted_on` 92%, `work_department` 66%, `industry` 13%, `life_area` 12%, `subject` 6%; over 1,011 servers, `object_acted_on` 57%, the servers' own `categories` 86% (2026-10-25).
- Observation: the engine's own name rule for a connector differs from MAWS's tool-prefix normaliser, and 427 directory server names would not pass it.
  Evidence: `claude mcp add` accepts letters, digits, hyphens and underscores (`findings-p4-r8-mcp-servers.txt` 7); `normalizedMcpName` maps every other character to `_` (`src/engine-host/mcp-call.ts:16`); 427 of 1,011 server names contain a space or other character; Linear's `claude_code_copy_text` names it `linear` (2026-10-25).
- Observation: the host's listing reducers drop what the catalog needs from an added marketplace, so the catalog cannot be built from `plugins.available` alone.
  Evidence: `src/engine-host/plugins/cli-result.ts` `sourceRefOf` returns `ref: pinnedBySha ? null : …` and no `sha`; `marketplacesOf` maps `name, source, locator, ref, installLocation` and no `owner`; `PluginManifestViewSchema` already carries `author` and per-server `transport` for one plugin (buildability review round 2, 2026-10-25).
- Observation: the engine's Keychain item for a scratch configuration has an exact, derivable name; `security` matches service names exactly.
  Evidence: `p4-r8-mcp-servers.mjs` `scratchItem = home => 'Claude Code-credentials-' + sha256(home.normalize('NFC')).slice(0, 8)`, checked with `security find-generic-password -s <item>` and removed with `delete-generic-password -s <item>`; the run logged `{item, itemBefore: false, itemAfter: true, removed: true}` (2026-10-25).

- Observation: a scratch `HOME` keeps the engine out of the Keychain entirely; a scratch `CLAUDE_CONFIG_DIR` alone does not.
  Evidence: `spikes/p4-aggregator/findings-m1.txt` 3: under the caller's `HOME` the probe's `mcp add --client-secret` created exactly `Claude Code-credentials-2802fe40` (derived from its scratch config), deleted by that name; under a scratch `HOME` the engine answered "the client secret could not be stored" and `security default-keychain` found none (2026-10-25).
- Observation: no live directory plugin lacks `reviewed_commit`; anthropics/skills lists five plugins at the same source `./`.
  Evidence: M1's recording walk: 0 of 3,601 public records without `reviewed_commit` (the spec had 107 from the 2026-10-25 research walk; the difference is unexplained); `anthropic-agent-skills` manifest entries all `source: "./"`, `strict: false` (2026-10-25).

- Observation: the live catalog on 2026-10-25T03:39Z (M2's one walk, `scripts/catalog-summary.mjs`): seed entries, 3,601 public plugins (92 / 344 / 3,165), 5 without `claude_code`, 0 without `reviewed_commit` and 315 plugin-details ids (313 with installs) all as recorded; 9 plugins with a `publisher` (the Design said 116); 1,011 servers (879 remote, was 877); 700 connectors shown (690 http, 10 sse; 614 auth required, 86 not) against the 733 the facts counted, the 33 all among the url-pattern-only servers (40 against 73); 5,702 items (5,002 plugins, 700 connectors), 3,124 on the Skills tab. Category coverage re-measured: `object_acted_on` 92.8% of plugins, 58.0% of servers (fixtures 93.4% and 91.7%), leading every axis on all four sets, so it stays.
  Evidence: `task-2-report.md` (the M2 executor's), "Live catalog summary" and "Category axis coverage" (2026-10-25).
- Observation: two seeds name a person as owner (`anthropic-agent-skills`: Keith Lazuka; `claude-for-financial-services`: Matt Piccolella); directory plugin icons live at `api.anthropic.com/api/directory/plugin-icons/…`, server icons at `storage.googleapis.com/media-assets-…` and Google's favicon service `t0.gstatic.com/faviconV2`.
  Evidence: the seeds' recorded manifests; `e2e/fixtures/catalog/directory:*.json` (2026-10-25).

- Observation: a scratch `HOME` on a Mac with a logged-in desktop turns every failed keychain write into a modal dialog.
  Evidence: a local run of the M4 spike under a scratch `HOME` (01:10:50 to 01:15:07 PDT, 2026-10-25; outside the brief, stopped) failed the engine's token save with `errSecNoDefaultKeychain` about 120 times, each with a "keychain cannot be found" dialog on the owner's screen (the architect's report).

## Decision Log

- Decision: verification. One design review of this spec (a general-purpose reviewer on the fable model), plus the `doperpowers:adversarial-reviewer` on the execution section, because there are four milestones. Branch review: the doperpowers code-review panel at xhigh on the whole branch. The owner opted into panels for branches of this size in the UX wave.
  Rationale: four milestones across main, engine-host and renderer, with a network boundary and engine mutations.
  Date/Author: 2026-10-24, the architect.
- Decision: the first revision after review (the architect's rulings on the design review's 13 findings and the buildability review's 7, all accepted; `rulings-round1.md`). The directory's install route is the engine's built-in `anthropic-plugin-directory` marketplace with entry names from `plugin list --available`, not a marketplace the record names (none does). Plugins come from `visibility=public` only and connectors from the servers endpoint only, dropping 7,256 non-plugin records and the duplicate connector cards. Identity is (repository, path) without refs, with route precedence and "Also listed by". Install counts and connector ranks return; official contents and dates come from plugin-details. Featured is derived from installs or rank, never from a banner. Fallback labels say "Listed by", the Partner tooltip makes no security claim, the publisher chain falls back to the manifest. Connector names come from the directory's command text or slug, URLs may be patterns, `sse` is included, `works_with` filters. The owner's two repositories leave the seed list and arrive as marketplaces the engine already has. `runsOnYourComputer` is three-valued from access types, hooks, CLI components and MCP transports; Skills lists only items with known skills. Catalog requests carry `cwd`, "installed" means here, the engine reads go through the host and invalidate on plugin operations and the settings watcher, and queries take a source or shelf filter, a sort and deterministic pagination. Sign-in is a main-owned operation with a receipt, events and a state table over three bounded host calls, branching on the engine's redirect scheme, with path A (`mcp_set_servers`) or path B (sessions started after the add) chosen by the spike and a real discard fallback through the terminal surface. A new first milestone provides a real-engine harness: the pinned binary asserted, scratch configuration, the fixture seam, a local installable marketplace, an engine-mode OAuth fixture with Keychain cleanup, and the gate group `e2e:discover`; the live smoke is opt-in and outside the gate. Milestones are now M1 harness, M2 catalog, M3 Discover, M4 connectors with the spike first, M5 acceptance; acceptance is renumbered 1 to 12.
  Rationale: the design review measured the live directory and the engine (Surprises & Discoveries, 2026-10-25 entries): the first draft's join, route, counts, Featured and sign-in rested on four facts that were wrong; the buildability review found the e2e harness could not run the acceptance as written. The alternatives rejected are recorded beside each decision in the Design.
  Date/Author: 2026-10-25, the design reviewer, from the architect's rulings.
- Decision: the second revision, from the buildability review's round 2 on 259658d64 (five gaps, all accepted). A fixture-only test-source seam (`MAWS_CATALOG_TEST_SOURCES`) makes the local test marketplace discoverable before it is added, with the scratch path as its install route; recorded engine output is a unit-test input only, never the CLI's stand-in in acceptance. Keychain custody is by the exact service name derived from the scratch configuration directory, required absent before, recorded as owned, deleted after the engine stops and verified gone; nothing by prefix. M1 provisions the 2.1.309 build on the Mac lane (download, checksum committed in the repo, cached by version, `MAWS_E2E_ENGINE_BIN` exported) before the offline phase, the test-time version check stays, and the `.github/` change is coordinated with CI-opt by the architect. M2 may touch engine-host: `sourceRefOf` keeps `sha` and `ref`, `marketplacesOf` keeps `owner`, and `plugins.marketplaceManifest` reads an added marketplace's plugins' author, skills, hooks and MCP transports from its clone, before normalisation, tested with a marketplace the directory does not know. The terminal fallback launches the resolved absolute engine path through `pty.spawn`'s `shell` and `args` with `CLAUDE_CONFIG_DIR` passed explicitly (the pty host strips `MAWS_` variables), and acceptance 10 verifies the executable and the configuration with `claude` absent from PATH. Acceptance 1, 7, 9 and 10 and the M1, M2 and M4 entries carry the changes.
  Rationale: the round found that the first revision's harness could not discover the test marketplace before the add, could not clean the Keychain as written, never provisioned the binary it asserted, lost the fields an added marketplace's cards need, and would have run a `claude` the terminal cannot find.
  Date/Author: 2026-10-25, the design reviewer, from the architect's rulings.

- Decision: the catalog's network traffic goes through MAWS's egress rules (the architect's binding constraint, relayed 2026-10-25). Every catalog fetch is a GET through `egressGet` under one new rule `catalog` with four routes (the seed manifests' raw URLs, the directory's plugins and servers endpoints, plugin-details), each with the content type and a size cap M2 measures. The guarded GET and `EGRESS_RULES` are lifted from `src/engine-host/egress.ts` into `src/shared/net/egress.ts`, which main and the engine host both import, keeping its guarantees, its tests and the source guard (extended to `src/main/catalog/`). The alternative, fetching through the engine host, lost: every main-to-host call answers within the supervisor's 10 s, the directory's plugins page is 13 MB, and the catalog belongs to main (Design, Parts). The final rule goes into the hand-back; the architect writes its charter §19 line when the branch lands.
  Rationale: the spec's Fetching section named GET-only, credential-free requests but not the one door every MAWS request already passes through (charter §19, P4-B2 2026-10-22).
  Date/Author: 2026-10-25, the executing session, from the architect's ruling.

- Decision: M1's measurements folded in (2026-10-25). (1) A scratch `HOME` hides the login keychain from the engine, which then stores no credential anywhere; the harness's launch option takes `home: 'scratch' | 'runner'`, and the sign-in scenes (acceptance 9, M4's spike) run under the runner's `HOME` with a scratch `CLAUDE_CONFIG_DIR`, custody by the exact derived name unchanged; every other scene keeps a scratch `HOME`. (2) Identity gains one exception: entries one marketplace lists at the same (repository, path) are told apart by entry name (anthropics/skills, life-sciences). (3) `marketplace list --json` has no `owner`, so `MarketplaceSchema` does not grow one: the owner comes from the marketplace manifest (fetched for seeds, `plugins.marketplaceManifest` for added marketplaces); `plugin list --available` omits installed plugins, so installed routes come from `plugins.list`. (4) The recorded `plugins.marketplaceManifest` answer moves to M2, which creates the read; M1 records the raw CLI JSON that M2's reducers take. (5) The same-name pair is two `skill-creator` plugins (no "github" pair exists in the seeds). (6) The live smoke (`e2e/discover-live.spec.ts`) drives Discover, so it is written in M5, not M1. (7) The Discover specs run only under their group's script (`MAWS_DISCOVER_E2E=1`), so the bare `pnpm e2e` of e2e:default skips them; inside the group a missing prerequisite fails. (8) Provisioning downloads `https://downloads.claude.ai/claude-code-releases/<version>/<platform>/claude` and checks it against the checksum the version's signed `manifest.json` lists, committed in `scripts/engine-checksums.txt`.
  Rationale: M1's scratch probe and recordings (`spikes/p4-aggregator/findings-m1.txt`; the M1 task review) contradicted four statements the design rested on; each revision keeps the design's intent.
  Date/Author: 2026-10-25, the executing session.

- Decision: nothing writes to the owner's login keychain on the MacBook from now on, scratch-named or not (the architect's ruling on Decision Log 5's first item, 2026-10-25). M4's spike and acceptance 9 run on the Mac mini through the gate, under the runner's `HOME` with a scratch `CLAUDE_CONFIG_DIR` and exact-name custody and teardown; a keychain locked or unavailable to the CI session is recorded as the spike's verdict, with no MacBook fallback. `spikes/p4-aggregator/m1-engine-probe.sh`'s keychain arm is not re-run on the MacBook.
  Rationale: the owner's login keychain is off limits; M1's probe created and removed two scratch-named items there before this ruling.
  Date/Author: 2026-10-25, the architect, recorded by the executing session.

- Decision: M2's decisions folded in, and two calls the walk raised (2026-10-25). Kept as built: `sha` is optional on the source ref (older recorded answers lack it; the host always fills it); every seed is fetched whatever the `cwd`, and the engine's listing takes over a seed's route when the engine has that marketplace (the network cache is shared by every `cwd`, and a marketplace can be present at one project's scope and absent at another's, so the fetch set cannot follow one `cwd`'s engine view); no conditional GET, since `egressGet` sends only a user agent, so a refresh is a full fetch of about 18 MB every 24 h (a rule-level ETag allowance is later work); entry-declared components count only for `strict: false` entries; a directory component `runs_on_your_computer` maps to transport `stdio`, other access to `unknown`, and monitors, LSP servers and bundles run code; directory routes come only from the engine's `anthropic-plugin-directory` listing, else a manual route with its reason; connectors take ownership `anthropic` (the directory's curation) and one synthesised MCP component; `catalog.query` adds `reverse` and `limit` (default 60, at most 200), its cursor revision a string, a malformed or foreign cursor restarting with `restarted: true`; a failed source is not refetched within 5 minutes except by Refresh; the manifest reader follows 2.1.309's root-entry skills rule; ids are `<repo>#<path>`, with `?entry=<name>` for same-source entries (Decision Log 5), `local:<path>#<sub>` for a local marketplace, `entry:<marketplace>/<name>` when unresolvable; the connector name fallback lower-cases and joins runs of other characters with one hyphen. Two calls: (a) the publisher chain's marketplace fallback applies only to entries in the marketplace's own repository, and for a seed it is the seed's organisation, not the manifest's `owner` (a person, on two seeds), so anthropics/skills reads "by Anthropic"; (b) icons: main fetches a directory icon through `egressGet` under the `catalog` rule, which gains the icon routes on Anthropic's origins (`api.anthropic.com/api/directory/plugin-icons/…` and the directory's `storage.googleapis.com/media-assets-…` bucket, M3 measuring their types and caps), caches it beside the catalog and hands it to the renderer as data; any other icon host (Google's favicon service among them) is not fetched and the card shows a monogram. The renderer fetches nothing itself.
  Rationale: the owner chose the directory for card quality, icons included (rulings), and every MAWS request goes through the egress rules (Decision Log 4); a favicon service queried with each server's domain is a third party the catalog does not need. "by Keith Lazuka" on Anthropic's skills repository is true of the manifest but not of who publishes it.
  Date/Author: 2026-10-25, the executing session.

- Decision: settings-change invalidation (the M2 task review, 2026-10-25). The Design's "the host's settings watcher" does not exist: `reload-after.ts` waits a fixed interval for the engine's own watcher and forwards no event. Main adds a read-only, debounced file watch on what the engine's plugin state lives in for the configuration and each `cwd` the catalog holds (the user `settings.json`, the plugins folder's installed and known-marketplace records, and the project's `.claude/settings.json` and `.claude/settings.local.json`), reusing an existing watcher where MAWS already has one; a change invalidates that `cwd`'s engine reads and fires `catalog.changed`. The alternative, Refresh only, lost: a plugin an agent installs from a terminal would read "not installed" until the person pressed Refresh.
  Rationale: the Design's re-read on outside changes is the intent; only its named mechanism was missing.
  Date/Author: 2026-10-25, the executing session.

- Decision: M2's review fixes (2026-10-25). An item's install route is the route it was installed through, ahead of precedence. A (repository, path) any source lists more than once is ambiguous everywhere; every listing there carries `?entry=<name>` and a directory record there joins as the entry of its engine name; an item's components describe what its chosen route installs: the directory's record for the engine's directory route, the entry's declared subset for a `strict: false` entry's route, another route's list only when it installs the same bundle (same repository, path and entry); built catalogs and cursor revisions are bound to the engine read behind each `cwd`'s view and evicted with it. An installed directory plugin's source after a restart comes from the new host read `plugins.directoryProvenance` (Interfaces). A catalog build is bound to the engine reads' generation; a read overtaken by an invalidation is read again up to three times, then answered uncached; the generation is shared across `cwd`s, so any invalidation restarts open cursors. A partial manifest inventory reads `true` if what was read runs code, else `'unknown'`, never `false`. The servers endpoint's `url_options` (31 Claude Code remote servers with neither `url` nor `url_regex`, one with an empty `url_regex`) is a choice of URLs, as in Claude Desktop: `ConnectorRoute.urlOptions`, and M4's connector sheet offers a picker; one server with neither is left out.
  Rationale: the M2 task review's five findings and the second live walk's classification of the 33 servers the first walk missed.
  Date/Author: 2026-10-25, the executing session.

- Decision: one discovery surface, following the owner's ruling that Discover is the place to find new things (architect, 2026-10-25). The session `/plugins` modal's Browse becomes "Open Discover", which opens Customize → Plugins → Discover for the session's `cwd`; the modal keeps its installed view. Icons (Decision Log 7(b)) are approved on two routes as M3 measured them: `https://api.anthropic.com` `^/api/directory/plugin-icons/[0-9a-f]{64}/256\.png$`, no query, `image/png`, 512 KiB; `https://storage.googleapis.com` `^/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons/[A-Za-z0-9._-]{1,100}\.(?:png|svg)$`, no query, `image/png` and `image/svg+xml`, 512 KiB. An icon renders only as `<img src="data:…">`, never inline SVG, `innerHTML` or `<object>`, so an SVG's scripts and external references neither run nor load; a test pins it with an SVG carrying a script and an external href.
  Rationale: two discovery surfaces with different data would contradict the ruling; an image element is the one SVG context that runs nothing.
  Date/Author: 2026-10-25, the architect, recorded by the executing session.

- Decision: M3's decisions (2026-10-25). Browse is gone from the plugins library everywhere (Decision Log 10); its view, code and tests are retired and the library's tab value is `discover`. Contract additions: `catalog.icon` and `catalog.home`'s `categories` (Interfaces). Icon cache: content-addressed plugin icons are kept indefinitely, bucket icons refresh after 24 h and keep their copy on failure, a failure is retried after 5 minutes; in the renderer misses stay fresh 5 minutes and hits 24 h, and Refresh asks again; only a `data:image/(png|svg+xml);base64` source renders, else a monogram. The e2e icon fixture is a synthetic PNG named by its URL's sha256 (Anthropic's asset is not republished). Every marketplace add carries `--scope`, user by default, the modal's included. A two-step + runs the add and the install under one operation key, the install only after a successful add; a failed install says the marketplace stays added and offers Remove marketplace, on every entry point including Featured. "Listed by <vendor>" names the item's publisher. A Skills card installed here opens Skills → My items searched to the plugin. `catalog.changed` is connected once for the window's life; Skills' operations are owned above its two views and survive view and section switches. An added marketplace plugin's description comes from the engine's listing, else its `plugin.json`, else the manifest entry. A result whose item has left the catalog stays at Discover's head. Open Discover hands Customize the session's exact directory: that project's page when a project's directory is exactly it, else a page for the directory itself, labelled by its path in the selector; never the parent project of a worktree or the user configuration; disabled when the modal knows no directory. The e2e scratch gains `omitSources` for failing sources; the e2e half of acceptance 12 is M5's, M3 adds the source-level guard.
  Rationale: the M3 task review (three Important findings on view lifetime and feedback, all fixed) and the executor's decisions.
  Date/Author: 2026-10-25, the executing session.

- Decision: the M4 spike's verdict, promote with path B (2026-10-25). Gate run 40175924834 on 295e97229 (the Mac mini, `e2e:discover`), under the runner's `HOME` and login keychain with a scratch `CLAUDE_CONFIG_DIR`; the one item touched, `Claude Code-credentials-ae335039`, absent before, deleted by that exact name after every engine exited and verified gone. Both redirect schemes complete. The custom scheme (MAWS's `http://127.0.0.1:<port>/callback`) answers in about 137 ms, but after `mcp_oauth_callback_url` the server stays `needs-auth` until `mcp_reconnect`, so `submitting` sends `session.mcpReconnect` and then watches the status. The localhost scheme completes through the engine's own listener with no reconnect. A second `mcp_authenticate` starts a new flow and the old flow's callback is refused; there is no "already authenticating". `mcp_set_servers` returns `{added: [fx-dynamic], removed: [spike-sdk]}`: it removes the session's SDK server (MAWS's own), so path A fails its first condition (its second holds: the next session reads every signed-in server connected); `session.mcpSetServers` is not built. `mcp_authenticate` takes 134 to 234 ms, so it stays a bounded call. A server added after the session started never appears in that session's `mcp_status`, so Sign in runs in the attached session only when its status lists the server, else "Open a session in <project>, then sign in".
  Rationale: the spike's measurements (`spikes/p4-aggregator/findings-m4.txt`, `spikes/protocol-probe/fixtures/p4/p4-agg-m4-signin.jsonl`); acceptance 9 needs the signing session's `mcp_status` to report the server connected.
  Date/Author: 2026-10-25, the executing session.
- Decision: every engine sign-in, every Keychain write and everything under acceptance 9 runs only in gate jobs on the Mac mini (`--runner macos`), scratch keychains included; none on the MacBook in any form (the architect, 2026-10-25, after a local spike run raised about 120 "keychain cannot be found" dialogs on the owner's screen). On the mini, a run that needs a keychain under a scratch `HOME` gives it its own (`HOME=$root/home security create-keychain -p '' $root/home/Library/Keychains/login.keychain-db`), deleted in teardown.
  Rationale: a scratch `HOME` on a Mac with a logged-in desktop does not fail silently: each failed keychain write raises a modal dialog.
  Date/Author: 2026-10-25, the architect, recorded by the executing session.

- Decision: the late-server variant of path B (the architect, 2026-10-25). The spike found a server added after a session started absent from its `mcp_status` but still answered by `mcp_authenticate` with a flow, contradicting fact 2's "Server not found". So Sign in is offered from any ready session whose scope includes the connector, including one started before the add; the credential is keyed by name and configuration and serves every later session. The result line reads "Signed in", then "connected here" or "available in new sessions" by the signing session's `mcp_status`. One sign-in per connector at a time; a second press cancels the first. `mcp_set_servers` is never used. Acceptance 9 gains the S1-then-S2 case, with path B's connected-here case kept as the second.
  Rationale: the person should not have to open a new session just to sign in after pressing Add.
  Date/Author: 2026-10-25, the architect, recorded by the executing session.

- Decision: M4's decisions (2026-10-25). `mcp_authenticate`'s "Server not found" is retried for up to 10 s, since the engine re-reads its configuration file about once a second and a server added a moment earlier is not yet known. Sign in runs in the attached session first; otherwise a user-scope server uses any ready session, a project or local one a ready session in the page's directory. Without a session, a connector's sign-in state comes from the directory's auth posture in catalog data the window already holds; My items never starts a catalog read (that would fetch); a remote server nothing describes shows no state and keeps Sign in. A configured connector reads Installed and has no +; the sheet's duplicate refusal matches any server in the page's inventory. `connectors.add` and `connectors.remove` carry the resolved engine `binary`, the MCP verbs are their own union in the runner's request type, and `connectors.signInChanged` gains `where` (the session it ran in). The reconnect after a custom-scheme callback loads a late-added server into the signing session, so case 9(a)'s line reads "connected here" there (acceptance 9 amended).
  Rationale: the M4 executor's measurements on the mini (gate runs 40181273536, 40181488158) and the decisions in its report.
  Date/Author: 2026-10-25, the executing session.

- Decision: M4's review fixes (2026-10-25). A sign-in result applies to the configuration it was for: results are keyed by name, scope and (for project and local) the `cwd`, carry the signing session and the configuration's fingerprint (`catalog.postures`), show only when the fingerprints match, and are forgotten when MAWS adds or removes that name and scope; a later status read saying `needs-auth` or failed supersedes a success. Exclusivity holds on two identities: a new sign-in cancels any running one for the same configuration or the same engine flow (session and server name, since `mcp_authenticate` and the callback carry no scope). A name configured in more than one scope offers Sign in only on the entry the engine uses (local, else user, else the nearest project `.mcp.json`; 2.1.309 cli.pretty.js 720717 to 720726, 720870, 720898), the others reading "Shadowed by the <scope> entry"; a same-name MAWS app server (passed as `--mcp-config`, which the engine loads as `dynamic` and prefers when authenticating; cli.pretty.js 457558, 853424) shadows every file entry of that name, which reads "Shadowed by MAWS's <name> server" with no Sign in, and the app row itself offers no Sign in. Postures and fingerprints carry the entry's file path, so two project files configuring one name each read their own. The callback-wait deadline ends when the callback is taken. A `url_regex` is tested as the directory writes it (52 live patterns, all anchored at the start, 35 at the end); one JavaScript cannot read refuses every URL. Add waits until every applicable MCP configuration is read whole, a current read failure outranking cached data, with Retry. A connector's posture comes from its endpoint, never its editable name; unknown stays unknown.
  Rationale: the M4 task review's three rounds (eight Important findings, all fixed).
  Date/Author: 2026-10-25, the executing session.

- Decision: M5's decisions (2026-10-25). Acceptance 12's e2e half runs two real sessions, one before and one after browsing all three Discover tabs, their turns sent to a local stand-in model through `MAWS_RELAY_URL` (nothing spent), and compares each session's init tools and the tool definitions it sends the model, with no request carrying catalog content. `MAWS_CATALOG_LIVE=1` is a third catalog test seam: under `MAWS_E2E=1` it is the only way the catalog reaches the network, and only through `egressGet`'s `catalog` rule. The live smoke drops the test marketplace, leaves the engine's directory on, and counts the sources both through the summary script and through the app. The All grid stays unvirtualized: at live scale (4,970 items over 82 pages) the end is reached in 17.2 s with about 77k DOM nodes and 190 MB of heap, frames at most 18.4 ms apart and a search answering in 126 ms. The live smoke is an ordinary named group, collected by the bare `pnpm e2e` and skipping itself there, as the repository's other live specs do; the M5 task review read "never collected" literally, and the spec now says "never run" (the intent). A marketplace added at project scope in project A is already the engine's in project B (one marketplace registry per configuration), so B's + offers the install alone.
  Rationale: the M5 executor's report and its task review.
  Date/Author: 2026-10-25, the executing session.

- Decision: the branch review panel's thirteen findings, fixed in one wave (the architect's panel at xhigh on fbeb2ceb6..504c67c9c, 2026-10-25; fixes merged at 371fd50bc, 16c7930bf, 283c01937).
  - A card's contents and its runs-code warning follow the chosen route's own revision: the engine's clone of that route outranks the directory record.
  - A seed's ownership is assigned only after its repository is verified.
  - `mcpServers` given as an array counts as contents.
  - The other-repository publisher exclusion applies to the normalised path.
  - Each source's walk has one cumulative byte budget (64 MiB; `egressGet` gains a `maxBytes` option that can only lower a route's cap) and one deadline and cancellation across all its pages (180 s); stopping the store cancels a walk in flight.
  - Connector snapshots go stale on MCP configuration changes. The configuration directory, the plugins folder and each held project's `.claude` are watched as directories. The engine's global `.claude.json`, MAWS's own `settings.json` and every `.mcp.json` from the project up to the home folder (never `/`) are polled by stat about every 2 s. Neither the home folder nor any ancestor is ever watched as a directory, so main does not hold an FSEvents stream over the person's home. Only views whose configured servers changed are dropped.
  - A connector's removal runs in the directory of the `.mcp.json` its entry lives in.
  - A sign-in runs only in a session whose engine uses exactly the row's entry. The precedence rule is shared, in `src/shared/plugins/connector-precedence.ts`, and `connectors.signIn` gains `path`.
  - `mcp_authenticate` calls for one session and server go one at a time, so a replacement waits for the cancelled call still in flight.
  - A server the session already has connected ends at once ("Already connected in that session"), with no consent page opened.
  - Customize's plugin operations outlive its views and a project switch, held per page and section.
  - The recovery's Remove marketplace names the plugins currently installed from that marketplace, read when it is pressed.
  - Taste: the publisher keeps its line and the trust label wraps beneath it. A digit-led name's monogram is its first two characters ("42"), any other name's its first letter.
  - The held `gate.yml` change is applied (254f7dd99), cleared by CI-opt on three standing conditions for every test that can reach the mini's login keychain, which holds the owner's real Claude Code credential:
    - (a) tests delete only the two service names derived from their own scratch `CLAUDE_CONFIG_DIR` and created in that run, never the bare `Claude Code-credentials`;
    - (b) nothing reads an item that existed before the run: existence checks only, both derived items required absent before any engine runs, and the engine's environment checked before launch and after each session starts;
    - (c) a keychain dialog fails the test fast: every `security` call is bounded at 5 s and checks for a SecurityAgent prompt before and after, and every real-engine launch on a Mac is watched, its process tree killed on a prompt.
    `e2e/support/keychain-guard.ts`, `e2e/support/connector-oauth.ts` and `test/support/keychain-discover-pin.test.ts` hold and pin them.
  Rationale: each finding was verified with a reproduction; each fix has a test that failed before it.
  Date/Author: 2026-10-25, the executing session, from the architect's panel and rulings.

- Decision: the bounded verification's four fixes (the architect's reviewer-high on 504c67c9c..e477f4514, 2026-10-25; 4e2b951d5, cfedb7871, 884dcde1c, 9340c4894).
  - The keychain guard validates only the environment the login shell actually captured, with the host's own parsing and fallback, and refuses to start when the scratch `CLAUDE_CONFIG_DIR` is absent or different.
  - A prompt probe that cannot tell counts as a prompt: the guarded process tree is stopped, then the step fails.
  - The state watch polls `.mcp.json` in every ancestor below `/`, by stat, the same range the inventory reads.
  - Sign in compares the selected session's live server (scope, transport and URL from its `mcp_status`, cli.pretty.js 1128186; `streamable-http` read as `http`) with the row's entry, and when they differ refuses with "this session uses a different <name>; start a new session to sign in".
  - Deferred to residue: an unrelated repository registered under a seed's marketplace name inherits that seed's installed state (`src/main/catalog/normalize.ts` ~315, `join.ts`).
  Rationale: each verified with a reproduction; each fix has a test that failed before it.
  Date/Author: 2026-10-25, the executing session, from the architect's verification.

- Decision: the owner's ruling of 2026-10-25. The plugin install sheet, the add-then-install sheet and the connector sheet fold the exact engine commands and the files they write behind a "Details" disclosure, closed each time a sheet opens. What stays in view: what installs, what comes with it, the runs-code warning, the scope, and for a connector its URL and transport. The command-hash sheet for a marketplace that declares commands is unchanged, because there the command is the decision (e13b7093d, f7f722010).
  - `ConfirmSheet` serves every plugin action, so its uninstall, enable, update and marketplace sheets fold the same way. The connector Remove sheet folds too, for consistency.
  - "The files they write" is the sheet's whole writes block: the file list, the engine's own records line, and the dependency-cache and override notes. "Also uninstalls" and the reload line stay in view, because they are consequences of the action, not files.
  - While the engine is still resolving, or when it errors, the sheet offers no Details: there is nothing to detail yet.
  - Where a sheet shows no scope selector but a scope applies, the scope stays in view as a plain line in the selector's words ("Scope: User"). This covers the connector add sheet on the user configuration's page, every connector remove sheet, and a scoped marketplace removal (the review's P2, 7b2725ff5).
  - The 1280×820 screenshots are taken with Details closed: `discover-install-sheet` (the one-step install), `discover-add-then-install-sheet` (new) and `discover-connector-sheet`.
  Rationale: the owner's taste. The command is the audit, not the decision, except where a marketplace declares one.
  Date/Author: 2026-10-25, the owner, through the architect; built by the executing session.

- Decision: the merge with master (p4-discover-merge, 2026-10-25). On the merge, the transcript's anchoring case failed twice at "the end stays pinned" (182 px). Traces showed the same follower lag on master: while streaming, the end sat up to 212 px away for two frames at each growth, and the merge's timing landed the test's one sample in that window. Discover's catalog does no work at startup, and the built transcript CSS was byte-identical, so neither was the cause. The fix landed on master separately (p4-transcript-follow, merge 0809ddc2b). This branch merges it.
  Date/Author: 2026-10-25, the executing session.

## Outcomes & Retrospective

**2026-10-25, the executing session, at hand-back (before the architect's branch review).**

What shipped: each of Customize's three tabs has My items and Discover; the catalog in main joins twelve seed marketplaces, the engine's own marketplaces and listing, Anthropic's public directory of plugins and servers and the official plugin-details, per `cwd`, behind one egress rule; + installs through the engine's CLI (adding the marketplace first when needed), connectors add and remove through `claude mcp`, and Sign in drives the engine's own OAuth in a ready session, the engine's credential serving every later session. Acceptance 1 to 12 pass together against the real 2.1.309 engine on the Mac mini, and the whole Mac matrix is green on 788b5bb70. Live, the catalog holds about 5,700 items (4,970 plugins in the app, 732 connectors) and the All grid stays responsive at that scale without virtualization.

Against the purpose: the owner can open Customize → Plugins → Discover, search "legal", press +, confirm and find the plugin under My items, and do the same for a connector, signed in without leaving MAWS. Agents see nothing new (acceptance 12, both halves).

What the spec got wrong, and how execution found it: the design rested on several facts that measurement overturned, each folded in place with a dated entry. A scratch `HOME` hides the login keychain (M1; and on a logged-in Mac it raises a dialog per failed write, learned the hard way). `marketplace list` has no owner and `--available` omits installed plugins (M1). One marketplace can list several plugins at one source (M1). The host had no settings watcher (M2). 33 servers use `url_options` (M2). The directory route installs whole-repository bundles (M2). `mcp_authenticate` knows late-added servers, a callback through `mcp_oauth_callback_url` needs a reconnect, and `mcp_set_servers` drops the SDK server (M4). The engine refuses same-scope duplicate names (M4). The publisher count was 9, not 116 (M2).

Lessons: the milestone reviews earned their cost. Every milestone needed one to four fix waves, and each wave's findings were real defects in lifetime, identity or fail-open checks rather than style; the last rounds narrowed to edges (shadowed scopes, nested project files) and stopped there. A worker briefed "never on this machine" still ran a keychain-touching probe locally; a rule whose breach harms the owner needs to be stated as the first line of the brief, with the reason, not as one constraint among many.

Left open (the hand-back's residue and unresolved findings): the held `gate.yml` change awaiting CI-opt, the charter's egress line, conditional GET for the catalog rule, the two converted live plugin specs never run, and the pre-existing `--term-bg` test noise.
