# Discover: one place to find skills, plugins and connectors (P4 child P4-AGG, 2026-10-24)

Parent: `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` (P4, the UX wave), Decision Log 86. Root: `docs/charter.md`.

## Purpose

The owner wants a way to find new capabilities for their agents without leaving MAWS. Today Customize can list plugins from marketplaces they have already added, one marketplace at a time. Skills have no discovery at all, and an MCP server is added by editing configuration by hand.

After this work, each of Customize's three tabs (Skills, Connectors, Plugins) has **My items** (what is installed or configured) and **Discover** (what exists). Discover draws from:
- the sources the owner named: Anthropic's official and community marketplaces, the owner's own doperpowers and cua, and Anthropic's, Notion's, Canva's and Carta's skill and plugin repositories;
- Anthropic's public directory, which also lists MCP servers such as Linear.

The owner can search everything at once, see who published each item and how far it was reviewed, and add it with one confirmation. A connector can be signed in to from MAWS.

To see it working, open Customize → Plugins → Discover, search "legal", press + on a result, confirm, and find it under My items.

Discover is for the person. Agents get no catalog, no discovery tool and no suggestions; they see a plugin only once the person installs it (owner, 2026-10-24).

## Progress

- [x] (2026-10-24 23:50Z) Design approved by the owner (four rulings, below). Research hand-back recorded in this spec.
- [ ] Spec reviews (design and buildability).
- [ ] M1 — the catalog.
- [ ] M2 — Discover for Plugins and Skills.
- [ ] M3 — Connectors: Discover, add, sign in.
- [ ] M4 — acceptance at 1280 and 1512, whole Mac matrix, branch review.

## The owner's rulings (2026-10-24)

- Discover is mainly for finding new things; managing what is installed is a separate view, as in Claude Desktop's Customize (references: `/Users/new/Developer/MAWS-notes/ux-comparison-2026-10-23/owner-notes/claude-customize-discover-2026-10-24.png` and `claude-customize-my-items-2026-10-24.png`).
- Agents do not see the catalog unless the person explicitly asks; there is no "discover and suggest" tool.
- **Home layout: shelves.** A featured card, then one row per source and per category, then everything. The alternative was one flat grid with filters; it lost because browsing to learn what exists is the main use.
- **Anthropic's directory is read**, even though it is undocumented, because it alone carries publishers, review and security checks, categories and connector addresses. It is cached, and Discover keeps working without it. The alternative was documented sources only (GitHub manifests and the MCP Registry); it lost on card quality.
- **Community items are shown and labelled**, in search and in All, but not on the featured shelves. The alternative, hiding them behind a filter, lost because the label carries the risk honestly.
- **Connectors come from Anthropic's directory.** The official MCP Registry was the alternative; it lost because its listing verifies only who published a server, not whether the server is safe, and it adds thousands of entries.

## What exists today (master c2b54f62b)

- `src/renderer/src/customize/CustomizeView.tsx`:
  - Customize has Plugins, Skills and MCP servers tabs, and a selector for user configuration or a project.
  - It attaches only to an engine process that is already ready in exactly that directory. Opening it never starts a session.
- **Plugins** embeds `PluginsLibrary` (`src/renderer/src/widgets/PluginsWidget.tsx`), which already has:
  - My items and Browse;
  - Add marketplace and Manage marketplaces;
  - an install confirmation (`widgets/plugins/ConfirmSheet.tsx`) with a choice of scope (user, project or local);
  - the exact command shown;
  - command-hash acceptance for marketplaces that declare commands;
  - progress, and a reload outcome per session.
- **Browse lists only what the engine's `claude plugin list --json --available` returns:** the engine's built-in directory plus marketplaces already added. Its items carry the id, name, marketplace, description, version, source and an optional install count (`src/shared/ipc/schema/plugins.ts` `AvailablePluginSchema`), and no publisher, category or review fields.
- **Engine mutations:**
  - `src/shared/plugins/cli.ts` builds the `claude plugin … --json` argv.
  - `src/engine-host/plugins/runner.ts` spawns the unmodified engine binary for it.
  - `src/engine-host/plugins/reload-after.ts` reloads ready sessions afterwards.
- **Skills** reads the disk inventory (`src/engine-host/customization/inventory.ts`) and has no discovery or installer.
- **MCP servers** shows the servers configured on disk, and separately the live ones in an attached session, through `widgets/McpWidget`. There is no add or remove.
- **MAWS's own connector connections:**
  - `src/main/connectors/*` implements MAWS's own connections, including full OAuth with sealed storage.
  - Those credentials are MAWS's; they do not sign the engine in.
  - `src/engine-host/mcp-call.ts` already recognises the engine's `needs_auth` refusal, which asks for `mcp_authenticate`.

## Facts the design rests on (research, 2026-10-24)

1. **All fourteen named repositories exist and are Claude Code plugin marketplaces** (`.claude-plugin/marketplace.json` at the root), including those described as skill directories.

| Repository | Marketplace name | Plugins | Ownership |
|---|---|---:|---|
| anthropics/claude-plugins-official | claude-plugins-official | 315 | Anthropic |
| anthropics/claude-plugins-community | claude-community | 2,283 | Anthropic (scanned mirror) |
| SSFSKIM/doperpowers | doperpowers | 5 | owner |
| SSFSKIM/cua | cua | 1 | owner |
| anthropics/skills | anthropic-agent-skills | 5 | Anthropic |
| anthropics/financial-services | claude-for-financial-services | 19 | Anthropic |
| anthropics/knowledge-work-plugins | knowledge-work-plugins | 123 | Anthropic |
| anthropics/claude-for-legal | claude-for-legal | 13 | Anthropic |
| anthropics/life-sciences | life-sciences | 2 | Anthropic |
| anthropics/k12-teacher-skills | k12-teacher-skills | 1 | Anthropic |
| anthropics/claude-for-financial-advisors | claude-for-financial-advisors | 1 | Anthropic |
| makenotion/claude-code-notion-plugin | notion-plugin-marketplace | 1 | Notion |
| canva-sdks/canva-skills | canva-skills | 1 | Canva |
| carta/plugins | carta-plugins | 3 | Carta |

   Entries mix local folders, remote git repositories and pinned subdirectories. An entry's repository is often not the marketplace's.

2. **The engine (2.1.309, unmodified).**
   - **Installing:** `plugin marketplace add <owner/repo|url|path> --scope user|project|local` (default user), then `plugin install <name>@<marketplace> --scope … --json`. A bare skills folder is refused (`manifest_missing`); wrapped in a marketplace entry with `strict:false`, the same skills install and uninstall (scratch probe).
   - **Plugin contents:** a plugin's skills, hooks and MCP servers load as parts of the plugin.
   - **Reload limit:** MCP changes from a plugin take effect at the next session (cli.pretty.js around 331433).
   - **Remote MCP servers:** `claude mcp add --transport http <name> <url> --scope local|user|project` adds one (default **local**).
   - **Signing in:** the engine signs in to a server through the control requests `mcp_authenticate {serverName, redirectUri}` and `mcp_oauth_callback_url {serverName, callbackUrl}` (cli.pretty.js 412968 and 412974; the handler near 455531).

3. **Anthropic's directory.**
   - **Endpoints:**
     - `GET https://api.anthropic.com/api/directory/plugins` returns `{data, facets, next_page, omitted}`.
     - `GET https://api.anthropic.com/api/directory/servers` returns `{servers, total, next_cursor, stale_feeds}`.
     - Both answer HTTP 200 with no cookies or keys.
   - **What a plugin record carries:** the publisher, source and repository, components (skills, MCP and others), access implications, review and scan checks, compatibility, install actions, media, taxonomy and optional metrics.
   - **What a server record carries:** the author, category, tools, documentation, privacy policy, `verified_tier`, and `remote` (URL, transport, auth).
   - **Where Desktop reads them:** `/Users/new/claude-desktop-re/readable/app-3.6556.2/web/app/v1/c310cdd26-CSnNH8yH.js` 1090 to 1404, and `shared-156-BLTosN8U.js` 16824 to 17285.
   - **Size:** a full anonymous walk (`?limit=5000&visibility=commercial,public&verified_tier=anthropic,partner,community`) returned 10,854 plugin records.
   - **Gaps:** none reference SSFSKIM/doperpowers, SSFSKIM/cua or anthropics/k12-teacher-skills, so the directory is Anthropic's curated list, not a federation.
   - **Metrics:** anonymous records return `metrics: {}`.
   - **No published contract:** no third-party API, support or redistribution contract was found. Treat it as an observed public endpoint: cache it for this user, and never republish it.

4. **Desktop's Discover home is not reproducible.** Its featured card and Recommended shelf come from `GET /api/organizations/{org}/library/discover/home` (signed in): editorial blocks, per-organization `install_count`. MAWS has no claude.ai session and does not reproduce it. **MAWS shows no install counts.**

5. **Linear** documents `https://mcp.linear.app/mcp`, Streamable HTTP, OAuth 2.1 with dynamic client registration. The directory lists it as partner, auth required, with that URL.

6. **Desktop's trust wording** is at `c80c79f6c-DHtpOo2e.js:174`:
   - Verified: Anthropic reviewed it for quality and security.
   - Community connector: passed automated checks, not reviewed in depth.
   - Community plugin: not reviewed in depth.
   - Custom: added by the person, not reviewed by Anthropic.

   Its warning for executable content is at `c7aca31b8-BKE9xWdm.js:89`. A failed security scan disables Add.

## Design

### Parts and where they live

```
main process                         renderer (Customize)
───────────────                      ─────────────────────
src/main/catalog/                    src/renderer/src/customize/discover/
  sources.ts   seed list               DiscoverHome.tsx   shelves
  fetch.ts     GitHub + directory      DiscoverGrid.tsx   search results and All
  normalize.ts → CatalogItem           CatalogCard.tsx    one card, three kinds
  join.ts      one item per thing      CatalogDetail.tsx  detail sheet
  store.ts     disk cache, refresh     add.ts             + → existing sheets
  index.ts     catalog.* IPC         widgets/plugins/*    install (reused)
                                     widgets/McpWidget    My items for connectors
engine-host: plugins/runner.ts gains `mcp add|remove`; a sign-in driver over the attached session's control client
```

- **Why the main process:** the catalog is fetched over the network, cached on disk and shared by every window. It is not engine state, so it does not belong in engine-host. MAWS's main process already owns outbound HTTP for connectors.
- **Why not via the engine:** the engine's `--available` listing covers only marketplaces already added. Adding fourteen marketplaces to the person's settings just to browse them would write configuration they never chose.

### The catalog

**Sources**, in this order:
1. **The seed list** in `src/main/catalog/sources.ts`: the fourteen repositories above, each with a display name and an ownership class. The owner's two are class `yours`; the rest are `anthropic`, `partner` (Notion, Canva, Carta) or `community` (claude-plugins-community).
2. **Marketplaces the engine already has** (`marketplaces.list`). One that is not a seed is class `added`.
3. **Anthropic's directory**: plugin and server records.

**Fetching.**
- **Marketplace manifests:** fetched from `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/.claude-plugin/marketplace.json`. Raw URLs need no token and serve the 1.56 MB community manifest, which the Contents API does not.
- **The directory:** paged until done.
- **Requests:** no credentials, and a `User-Agent` naming MAWS and its version.

**Caching.**
- Each source is cached under the app's user-data directory (`catalog/<source-key>.json`, holding the raw response, its fetch time and its ETag where served).
- Discover refreshes a source when its copy is older than 24 hours, and Discover's Refresh refreshes all of them.
- A failed source keeps its last copy and reports its age. A source never fetched and failing is reported as unavailable. In both cases the other sources still show.

**Parsing.**
- Every record passes a zod schema at this boundary.
- A record that fails is dropped and counted; it never stops the source.
- Unknown fields are ignored.

**Normalising.** Every record becomes one `CatalogItem` (shape in Interfaces):
- **Kind:** `plugin` or `connector`.
- **Install route:** for a plugin, `{marketplace source, marketplace name, plugin name}`. For a connector, `{name, url, transport}`.
- **Components:** skills (with their names), MCP servers, hooks, commands, agents, where known.
- **Who published it**, the ownership class, the directory's review tier and checks, categories, description and icon, and `updatedAt` where known.

**One item per thing.** A directory record and a marketplace entry are the same item when they point at the same source: the same repository, the same path within it, and the same pinned ref where one is pinned.
- The merged item takes the marketplace's install route, because that is what the engine installs, and the directory's metadata, because that is richer.
- Names never join items: two sources can both have a "github" plugin.
- The ownership class comes from the marketplace (seed or added). The review tier comes only from the directory.
- An item that only the directory has installs through the marketplace its install action names. Typically that is claude-plugins-official or claude-community, which is a seed, so the route is always known. A directory item with no usable install action is shown with its documentation link and no + button.

**Components before install.** When neither source lists an item's components (a remote git entry the directory doesn't know), the card says "Contents shown after install". This is the honest copy that `widgets/plugins/BrowseDetail.tsx` already uses.

### Discover, per tab

| Tab | Discover shows | Add does |
|---|---|---|
| Plugins | every plugin item | install the plugin |
| Skills | plugin items that contain skills, one card per item, its skill names listed | install the plugin that carries them, named as such |
| Connectors | connector items from the directory whose `remote` transport is HTTP | add the server, then offer sign-in |

- **Directory servers with no remote URL** (local stdio servers needing a command) are listed with "Set up from its documentation" and a link, and no + button. Running another publisher's install command is out of scope for this work.
- **A skill card never implies a lone skill install.** Its + sheet says "Installs the plugin <name> from <marketplace>, with N skills: …" and lists the other components that come with it. That is the unit the engine installs; Desktop's Discover does the same with plugins presented as skills.

**The home** (owner's approved preview):

```
Discover            [Search all sources      ]   Refresh · updated 3 h ago
[Anthropic] [Partner] [Community] [Yours]  Category ▾  Not installed ☐

┌ Featured · From Anthropic ───────────────────┐
│ Legal       Contracts, NDAs, review    [Add] │
└──────────────────────────────────────────────┘
Your sources                              See all
[doperpowers +] [cua +] [ci-kit +]
Claude for Financial Services             See all
[Pitch deck +] [Comps +] [DCF +] …
Data & analytics                          See all
[Data +] [Snowflake +] [Hex +] …
All · 2,961                     Name ▾
```

- **Featured:** the directory's launch banner (`include=launch`, `has(launch.banner)`, c310cdd26 1404) when it has one for this tab's kind. When it has none, no featured card is shown. MAWS invents no editorial picks.
- **Your sources:** first, items from the `yours` and `added` sources.
- **One shelf per seed source** with more than one item, in the seed order. Community gets no shelf.
- **Category shelves:** the directory's categories with the most items in this tab, at most four.
- **All:** every item, sorted by name, or by recently updated where `updatedAt` is known.
- **Shelf size:** each shelf shows one row, as many cards as fit, plus See all, which opens the grid filtered to that shelf.
- **Search** covers every source; matches on name rank above matches on description.
- **Filter chips:** ownership class and review tier together (Anthropic, Partner, Community, Yours), category, and Not installed.
- **Installed state:** an installed item shows "Installed" in place of +, and its card opens the item in My items.

**A card** shows:
- the icon, name and one-line description;
- "by <publisher>";
- the trust label;
- the components ("3 skills · MCP server · runs hooks");
- the + button.

It shows no install counts (fact 4).

**The trust label** comes from the review tier where the directory has one: Verified · Partner · Community. Otherwise it comes from the ownership class: Anthropic repository · <Vendor> repository · Yours · Added by you. Its tooltip carries Desktop's wording for that class (fact 6), so a label never claims more review than the directory records. A failed security scan in the directory disables + with the reason, as in Desktop.

### Adding

**Plugins and skills reuse the existing install sheet.** It gains three things:
- what gets installed, with the plugin's components;
- the executable-content warning when the components include hooks or a local MCP server;
- when the marketplace is not added yet, a first step that adds it at the chosen scope.

Both steps run through the existing runner, as `plugin marketplace add <owner/repo> --scope S` and then `plugin install <name>@<marketplace> --scope S`. If the add succeeds and the install fails, the marketplace stays added, and the sheet says so and offers Remove marketplace.

The engine's one-step `plugin install <name> --marketplace <source>` is not used, because it always adds the marketplace to user settings, whatever scope the person chose.

**Connectors** get a new sheet, built like the install sheet. It shows:
- the server's name, publisher, review tier and URL;
- the transport;
- the scope, defaulting to **user** (the engine's own default is local; user matches how the person thinks of a connector, available in every project);
- the exact command `claude mcp add --transport http <name> <url> --scope <scope>`.

The runner gains `mcp add` and `mcp remove` beside `plugin`. The name is the directory's server name, normalised the way the engine normalises it (`normalizedMcpName` in `src/engine-host/mcp-call.ts`). If that name is already configured in the chosen scope, the sheet refuses and shows the existing entry, instead of overwriting it.

**Signing in.** A connector whose server needs auth shows "Sign in needed" in My items. Sign in drives the engine's own flow, so the agents' sessions are signed in:
1. Pick a ready session whose scope includes the connector. Customize's attached session is used when it qualifies.
2. Send `mcp_authenticate {serverName, redirectUri}`. The redirect URI is a MAWS loopback listener on 127.0.0.1, reusing the callback server pattern of `src/main/connectors/oauth-callback.ts`.
3. Open the authorization URL the engine returns in the system browser.
4. Wait for the callback, then send `mcp_oauth_callback_url {serverName, callbackUrl}`.
5. Show the result from the engine's `mcp_status`.

With no qualifying ready session, Sign in says "Open a session in <project>, then sign in" and does nothing else. Customize never starts a session (a standing rule of the page). M3's spike settles the exact shape of the exchange; this section is revised from its verdict.

MAWS's own OAuth store (`src/main/connectors/oauth-store.ts`) is not involved: those credentials serve MAWS's own connections, not the engine.

### My items

My items is as today for Plugins and Skills. Connectors' My items keeps "Configured on disk" and "Live in the attached session", and adds:
- **Remove** for a server configured in a scope MAWS can name. It runs `claude mcp remove <name> --scope <scope>`.
- **Sign-in state** from the attached session's `mcp_status`: connected, needs sign-in, or failed with the engine's message.

**Installed versus ready.** MAWS claims only what it can observe:
- an installed plugin whose MCP server the attached session reports failed shows "Installed · its server failed: <engine message>";
- a connector shows its sign-in state.

There is no generic "needs setup" detection, because a plugin's setup steps, such as cua's runtime, are not machine-readable.

The tab named "MCP servers" becomes **Connectors**, matching Desktop and the owner's word. The layout schema's `customize` section value `mcp` stays as it is, so saved tabs keep working; only the label changes.

### What agents see

Nothing new. The catalog lives in the main process and the renderer. No engine tool, MCP server, prompt text or session context carries it. M4's acceptance checks this.

### Failure handling

| Failure | What the person sees |
|---|---|
| A source unreachable, cached copy exists | Its items, and in Refresh's popover "<source>: offline, from 2 days ago" |
| A source unreachable, never fetched | "<source> unavailable" in that popover; the other sources show |
| The directory unreachable | Plugins and skills from marketplaces, with plainer cards: no review tier, categories or connector list. The Connectors Discover says "Anthropic's directory is unavailable" with Retry |
| A record fails its schema | Dropped; Refresh's popover counts the dropped records per source |
| The engine refuses an add or install | The engine's own words, as the install sheet shows today |
| A command-declaring marketplace | The existing second sheet with the command and its hash |
| Sign-in: no qualifying session | "Open a session in <project>, then sign in" |
| Sign-in: callback timeout (5 min) or denied | "Sign-in didn't finish"; the engine is told nothing more; Sign in can be pressed again |

## Acceptance

Run against the branch's build in the e2e harness, with a scratch engine configuration (`CLAUDE_CONFIG_DIR` and `HOME` under the test's temporary directory). Catalog sources come from recorded fixtures, so the gate needs no network; the recorded responses live under `e2e/fixtures/catalog/`.

1. **The home.** Customize → Plugins → Discover shows, in order:
   - the Featured card (the fixture has a launch banner);
   - "Your sources" with doperpowers and cua;
   - a shelf per seed source with more than one item;
   - up to four category shelves;
   - "All · N", where N equals the fixture's distinct item count after joining.

   Screenshots at 1280×820 and 1512×982 go next to the owner's Discover reference.
2. **Search and labels.** Searching "legal" lists claude-for-legal's plugins, each "by Anthropic" with its directory label. A claude-community item reads Community, and its tooltip has the community wording.
3. **Installing, end to end.** Pressing + on a fixture plugin from a not-yet-added seed marketplace opens the sheet:
   - it shows "Adds the marketplace <name> (user) and installs <plugin>", the plugin's components, and the runs-code warning, since the fixture plugin has hooks;
   - after confirming, the scratch user `settings.json` lists the marketplace and the plugin enabled;
   - My items shows it;
   - its Discover card reads Installed.
4. **A skill installs its plugin.** In Skills → Discover, the anthropics/skills item's sheet names the plugin and lists its skills.
5. **Adding a connector.** In Connectors → Discover, Linear is listed: Partner, with its URL. + opens the connector sheet with scope user and the exact command. After confirming, the scratch configuration has `linear` with type http and that URL, and Connectors → My items lists it under Configured on disk.
6. **Signing in.** Against the fake OAuth MCP server the connectors-oauth e2e group already uses, with an attached ready session, Sign in completes: the browser step is driven by the test, and the engine's `mcp_status` reports the server connected. With no attached session, the button shows the "Open a session" message.
7. **Without the directory.** With the directory fixture failing, Plugins → Discover still lists marketplace items with no review tier, Refresh's popover says the directory is unavailable, and Connectors → Discover shows the unavailable message with Retry.
8. **Nothing reaches agents.**
   - A unit test asserts that no MCP tool name, system-prompt fragment or engine launch argument built by MAWS mentions the catalog.
   - The fake session's tool list in the e2e run is the same with Discover visited as without.

## Execution

### Constraints for every milestone

- **The engine is unmodified** (D-1). Mutations go only through its CLI (`plugin …` and `mcp …` via `src/engine-host/plugins/runner.ts`) and its control requests. MAWS never writes the engine's settings files itself.
- **Network:** only GET requests, to `raw.githubusercontent.com` and `api.anthropic.com/api/directory/*`, with no credentials. Nothing from the catalog is sent anywhere.
- **IPC:**
  - New IPC follows `src/shared/ipc/names/*` and `src/shared/ipc/schema/*`, with a name list and a zod schema per namespace, pinned by `src/shared/ipc/schema.test.ts`.
  - Only display metadata and install routes cross IPC. A connector's URL crosses, because the person must see it before adding.
- **Styling:** light theme by default; components use tokens only.
- **Copy** is plain and literal. Trust wording follows fact 6 and never claims more review than the source records.
- **Gates:**
  - class 1a through `scripts/ci-gate.sh <worktree> --gates static,unit,probes --class1a pool`;
  - Mac e2e through `--runner macos --class1a pool`;
  - the whole Mac matrix at M4, because the work touches shell, layout and settings (P4 Decision Log 78).
  - No e2e runs on the MacBook. Local heavy runs go through `/tmp/maws-review/with-slot.sh`, one focused file at a time.
- **Off limits:** never touch the owner's running MAWS, its build, its user data, or the owner's `~/.claude`. Probes use scratch configuration directories.

### M1 — The catalog

At the end, the main process holds a normalised, joined catalog of the fourteen seeds, the engine's added marketplaces and the directory. It is cached on disk and served over the `catalog.*` IPC (Interfaces).
- A unit test loads the recorded fixtures and checks that the item count and joins are right.
- A dev-only command prints a summary of the live catalog. The milestone runs it once against the real sources and records the counts in Surprises & Discoveries.

- **Touches:**
  - new `src/main/catalog/` (sources, fetch, normalize, join, store, index);
  - `src/shared/ipc/names/catalog.ts` and `src/shared/ipc/schema/catalog.ts`;
  - registration in `src/main/` where other namespaces register;
  - `e2e/fixtures/catalog/`, recorded trimmed responses: a slice of each seed's manifest, the doperpowers and cua manifests whole, and two directory pages with a launch banner, Linear, a community item, a failed-scan item and a local-only server.
- **Decisions:**
  - Join by source identity (Design, "One item per thing"); the fixture includes a pair that joins and a same-name pair that must not.
  - Parse each source independently. One failure never empties the catalog.
  - The refresh age is 24 h. Refresh is serialised: one refresh at a time; a second request joins the one running.
  - `catalog.changed` fires once per refresh that changed anything.
  - Recording the fixtures is a script under `scripts/catalog-fixtures.mjs`, committed with the fixtures, so they can be re-recorded.
- **Does not touch:** the renderer or engine-host.
- **Proves:**
  - acceptance 7's data side (the directory fails, and marketplace items remain);
  - the join rules;
  - schema drops counted;
  - cache reuse when offline.

### M2 — Discover for Plugins and Skills

At the end, Plugins and Skills each have My items and Discover; Plugins' Browse becomes Discover. The home, search, filters, cards, detail and + work over M1's catalog, and installing runs through the extended sheet.

- **Touches:**
  - new `src/renderer/src/customize/discover/`;
  - `src/renderer/src/customize/CustomizeView.tsx`;
  - `src/renderer/src/widgets/PluginsWidget.tsx` and `widgets/plugins/*`. Browse is replaced by Discover, and the existing BrowsePane, BrowseCard and BrowseDetail are retired where Discover covers them;
  - `widgets/plugins/ConfirmSheet.tsx` and `present.ts`: the add-then-install route and the contents and warning lines;
  - `src/shared/plugins/cli.ts`: the scoped marketplace add, already supported by its API;
  - e2e specs for the Plugins and Skills tabs.
- **Decisions:**
  - Discover reads only `catalog.*`. Installed state comes from the existing installed-plugins read, matched by install route.
  - The Add marketplace dialog gains the scope choice, which its confirmation lacks today.
  - "See all" opens the grid with the shelf's filter applied, and its chip can be removed.
  - Cards are a fixed height, so shelves align. Long descriptions clamp to two lines.
  - Keyboard: shelves are rows of buttons reachable by Tab; arrow keys move within a shelf; Enter opens detail; + is its own focus stop.
- **Does not touch:** connectors, or MCP add, remove and sign-in.
- **Proves:** acceptance 1 to 4; acceptance 7's Plugins side.

### M3 — Connectors: Discover, add, sign in

**The spike comes first.** It is a prototyping step whose deliverable is a verdict.
- **Question:** does the engine's `mcp_authenticate` / `mcp_oauth_callback_url` exchange, driven over a ready session's control client, sign a remote HTTP server in? And does `mcp_status` then report it connected?
- **How to run it:** against the fake OAuth MCP server of `e2e/connectors-oauth.spec.ts`, in a scratch configuration, with a session started by a probe script under `spikes/p4-aggregator/`.
- **Record:**
  - the request and response frames, as a fixture under `spikes/protocol-probe/fixtures/p4/`;
  - whether the engine returns the authorization URL or opens a browser itself;
  - what redirect URIs it accepts.
- **Promote** if a sign-in completes with a MAWS-chosen loopback redirect. **Otherwise discard:** in that case, Sign in shows the engine's own instruction (run `/mcp` in the session) and the Design section is revised with a Decision Log entry.

**At the end**, Connectors has My items and Discover. + adds a remote server at the chosen scope. Remove removes it. Sign in works through the engine as the spike's verdict allows, and My items shows each server's sign-in state.

- **Touches:**
  - `src/engine-host/plugins/runner.ts` and `src/shared/plugins/cli.ts`: the `mcp add` and `mcp remove` argv, and their results parsed from the CLI's output, since `mcp add` has no `--json`; record what it prints;
  - a sign-in driver in `src/engine-host/` beside `mcp-call.ts`;
  - a loopback listener reusing `src/main/connectors/oauth-callback.ts`'s pattern;
  - `src/renderer/src/widgets/McpWidget*` and `customize/CustomizeView.tsx`;
  - the IPC for `connectors.add`, `connectors.remove` and `connectors.signIn` (Interfaces);
  - e2e for the Connectors tab.
- **Decisions:**
  - The default scope is user.
  - Refuse on a name already configured in that scope.
  - The name is normalised as the engine normalises it.
  - Sign-in never starts a session.
  - The callback listener binds 127.0.0.1 on an ephemeral port, accepts exactly one request whose `state` matches, and closes after it or after 5 minutes.
  - Only remote HTTP servers get +.
- **Does not touch:** MAWS's own connector store (`src/main/connectors/oauth-store.ts`).
- **Proves:** acceptance 5 and 6; acceptance 7's Connectors side.

### M4 — Acceptance

Run acceptance 1 to 8 as written, then the whole Mac matrix with `--evidence`. Capture the screenshots of acceptance 1 at both sizes, plus the detail sheet, the install sheet and the connector sheet, and put them next to the owner's two references. Hand the branch back for the architect's branch review (Decision Log, verification).

- **Touches:**
  - the tests that acceptance 8 names;
  - fixes the acceptance run exposes.
- **Proves:** acceptance 1 to 8 together, on one head.

## Interfaces and Dependencies

`src/shared/ipc/schema/catalog.ts`:

```ts
export const CatalogKindSchema = z.enum(['plugin', 'connector']);
export const OwnershipSchema = z.enum(['anthropic', 'partner', 'community', 'yours', 'added']);
export const ReviewTierSchema = z.enum(['anthropic', 'partner', 'community']).nullable(); // the directory's verified_tier only
export const CatalogItemSchema = z.strictObject({
  id: z.string(),                       // stable: source identity (repo + path + ref) or directory id for connectors
  kind: CatalogKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  publisher: z.string().nullable(),
  ownership: OwnershipSchema,
  reviewTier: ReviewTierSchema,
  scanBlocked: z.string().nullable(),   // the directory's reason when a failed scan disables Add
  categories: z.array(z.string()),
  iconUrl: z.string().nullable(),
  updatedAt: z.string().nullable(),
  components: z.strictObject({ skills: z.array(z.string()), mcpServers: z.number().int(), hooks: z.boolean(), commands: z.number().int(), agents: z.number().int() }).nullable(), // null: not known before install
  install: z.union([
    z.strictObject({ kind: z.literal('plugin'), marketplaceSource: z.string(), marketplaceName: z.string(), pluginName: z.string() }),
    z.strictObject({ kind: z.literal('connector'), name: z.string(), url: z.string(), transport: z.literal('http') }),
    z.strictObject({ kind: z.literal('manual'), docsUrl: z.string().nullable() }),
  ]),
  sources: z.array(z.string()),          // source keys that listed it (seed or added marketplace name, 'directory')
});
export const CatalogSourceStatusSchema = z.strictObject({ key: z.string(), label: z.string(), fetchedAt: z.string().nullable(), state: z.enum(['fresh', 'stale', 'offline', 'unavailable']), dropped: z.number().int() });
```

Commands (`src/shared/ipc/names/catalog.ts`):
- `catalog.home({tab})` returns `{featured: CatalogItem | null, shelves: {key, title, items, total}[], total}`.
- `catalog.query({tab, text, chips, category, notInstalled, cursor})` returns `{items, nextCursor, total}`.
- `catalog.item({id})` returns `CatalogItem`.
- `catalog.refresh()` returns `CatalogSourceStatus[]`.
- `catalog.sources()` returns `CatalogSourceStatus[]`.

Event: `catalog.changed`. `tab` is `'plugins' | 'skills' | 'connectors'`.

Connector commands (M3), in the `connectors` namespace beside the existing names:
- `connectors.add({name, url, scope, cwd})` returns the runner's outcome.
- `connectors.remove({name, scope, cwd})` returns the runner's outcome.
- `connectors.signIn({name, appSessionId})` returns `{ok: true, status} | {ok: false, reason: 'no_session' | 'timeout' | 'denied' | 'engine', message}`.

Plugin installs reuse `plugins.install` and `marketplaces.add` as they are, with `marketplaces.add` given its scope argument.

## Surprises & Discoveries

- Observation: the "skill directories" are all plugin marketplaces already, so no skill copier is needed.
  Evidence: `gh api repos/<each>/contents/.claude-plugin/marketplace.json` returned a manifest for all fourteen (2026-10-24).
- Observation: Desktop's Discover home is a signed-in editorial feed, not the public directory.
  Evidence: `shared-52-uHFNjl7C.js:25534` (`/api/organizations/{org}/library/discover/home`).

## Decision Log

- Decision: verification. One design review of this spec (a general-purpose reviewer on the fable model), plus the `doperpowers:adversarial-reviewer` on the execution section, because there are four milestones. Branch review: the doperpowers code-review panel at xhigh on the whole branch. The owner opted into panels for branches of this size in the UX wave.
  Rationale: four milestones across main, engine-host and renderer, with a network boundary and engine mutations.
  Date/Author: 2026-10-24, the architect.

## Outcomes & Retrospective

Pending — written at finish.
