# UX wave · U11h · A plugin's connectors under My items, with Sign in (2026-11-14)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11** (`docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`), landing **U11h**, parent pin master `c6a22fe89722dcbed4f5ff1e5f290a7fdaeb2933`.
> **Where the design is.** The child's item "X-184", with Acceptance A20, its "Waiting" entry "A plugin's connector that the engine drops", and bindings 8, 9, 11 and 14 of its Design inheritance. The child's table of landings gave X-184 to U11c; the architect cut it out on 2026-11-14 into this landing, because its sign-in rests on engine facts that no fixture held and on a rule about credentials across plugins (U11c's Decision Log). Those facts are now run: `spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt` with its record `spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn.ndjson` and one journal per case beside it, on master. The sign-in rule below is the architect's ruling on those findings, restated after this document's adversarial review (Decision Log).
> **Branch:** `ux-wave/U11h`, from the parent pin, with master `557253ecd` merged in (the probe) and then master `ef1d659ad` (U11g and U11c; the pass of 2026-11-15, UTC); master is merged in again before anything is built (Concrete Steps, 1). **Stands on:** U11a, **U11g** (`docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md`) and **U11c** (`docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md`), all three on master. This document was written before the last two were, for a tree that holds both, and was checked against that tree at the pass ("Statements to check again").

## Purpose

A connector that a plugin brings is listed today only while a session runs in that folder, in that session's own dialog. A person whose connectors come mostly from plugins sees few of them in Customize, and can sign one in only from a chat.

After this landing My items lists a plugin's connectors with the others, with no session running, as "<server> · from <plugin>", under Connectors and under All, and a new chat's "+" › Connectors lists them before its first message. A row that needs a sign-in offers Sign in while a session MAWS runs on this Mac reports this row's plugin as the one possible owner of the connector's name; where it does not, the row says in one line why, and what resolves it. This matters because the engine names such a server by plugin name and server name alone: more than one plugin can build one name, the engine keeps one of them and says nothing. So the sign-in is held to a guarantee with an enforced part and a named residue ("The guarantee"): the browser is never opened at an address outside the one the row declares, and never while the session's own report leaves the owner in doubt; what an unmodified engine does not let MAWS close is said, not hidden.

How to see it working: Acceptance, H1 to H10.

## Progress

- [x] (2026-11-14) This document written against master `c6a22fe89`, from the draft parked when X-184 left U11c, the architect's rulings on it and the probe's findings; U11c's document read on `origin/ux-wave/U11c` at `876230bae`, U11g's on `origin/ux-wave/U11g`.
- [x] (2026-11-14) The adversarial review of this document: five findings, each read by the architect in the code and accepted. Revised once to the architect's rulings A to H and two additions (Decision Log): the guarantee restated; rule (a) on the engine name; the check at three points; the strict form of a templated address; a retained result never gives Sign in back; the scene's own plugin server.
- [x] (2026-11-14) The probe is on master (`557253ecd`), merged into this branch.
- [x] (2026-11-15 (UTC)) The one pass over "Statements to check again" once U11g and U11c are on master: master `ef1d659ad` merged into this branch; K-3 to K-5, K-7 to K-9, K-11 and K-12 hold (five of them worded more exactly), K-1, K-2, K-6 and K-10 are restated and the places that rested on them corrected; "What the code says today" and each milestone's files read against the merged tree; three points handed to the architect and not decided here (under the table).
- [x] (2026-11-15 (UTC)) The architect's rulings on those three points, written into M1, M3, §E and the checks (Decision Log; under the table).
- [x] (2026-11-15 (UTC)) M1 — The inventory lists a plugin's connectors. Commits `1b87d0313`..`c966751a5` (the stand-in minor 49 in `c966751a5` alone), fixes `17c48cf83`..`d81aa792c`; task review clean after two fix rounds (Decision Log, "the controller, on M1's task review").
- [x] (2026-11-15 (UTC)) M2 — The rule, at three points of the operation. Commits `add32850b`..`3ded12f06`, fix `a045c6b0f`..`5a82acbe0`; task review clean after one fix round (Decision Log, "the controller, on M2's task review"); each point's named tests shown red with that point's check removed, on a scratch branch, before and after the fix.
- [ ] M3 — The row in My items, its lines and Sign in; the coverage note; the lists before a chat starts.
- [ ] M4 — The record, the e2e scenes written, the whole checks, the hand-back.
- [ ] The architect's: the e2e scenes on a Mac, the branch review, class 1a, the pull request (Proof, P1 to P5).

## Statements to check again once U11g and U11c are on master

Neither landing's code was on master when this was written; U11c's was known here only from its document. **The pass is made.** Both are on master (`ef1d659ad`), which is merged into this branch, and each statement was read against that tree on 2026-11-15 (UTC). The table gives each statement as the code has it and says what holds and what is restated; the places of this document that rest on a restated one are corrected to it. Three points were more than a moved name; the architect ruled on each the same day, and they are under the table with where each ruling is written.

| | the statement, as the code has it | checked | this document rests on it in |
|---|---|---|---|
| **U11c** | | | |
| K-1 | The connector's row is `ConnectorRow` in `src/renderer/src/customize/connectors/ConnectorRow.tsx`, over `ConnectorRowModel` in `customize/connectors/rows.ts`; the model is a union with the one member `kind: 'configured'`. What the row decides on `row.kind` in one place is `partsOf`: what follows the name, the second line, the server a sign-in is kept for, where a file sign-in runs, and the removal. **Outside `partsOf`** the component reads the configured member's fields directly: `row.name` and `row.scope` for the row's two marks, and `row.name` for the image's seed, the name drawn, the shadow's words and the buttons' names; and it chooses between the two sign-in presses in its own markup, on `own` and `target`. `useConnectorRowFacts` (`customize/connectors/ConnectorsSection.tsx`) reads `row.scope`, `row.name` and `row.path` for the shadow, the session, the live entry and the posture. | restated: a second member, whose `name` may be null and which has no `scope`, is a second `case` of `partsOf` and a branch at each place named after it | M3, §E |
| K-2 | `connectorRows(inventory: Pick<Inventory, 'servers'>)` (`rows.ts`) takes the inventory and answers the configured rows in the inventory's order; `connectorRowKey` is `serverKey`. Of its two callers, `customize/MineAll.tsx` hands it the inventory's answer. The Connectors list does not: `ConnectorsBody` (`customize/bodies.tsx`) hands `ConnectorsMine` the answer's `servers` alone, and `Configured` (`ConnectorsSection.tsx`) calls `connectorRows({ servers })`. | restated: the function holds; the Connectors list is handed `servers`, so what `ConnectorsBody` hands `ConnectorsMine`, and it `Configured`, widens to carry `pluginServers` and `plugins` | M3, §E |
| K-3 | The row's parts are marked `data-connector-main` and `data-connector-trailing`, and under All (`kindWord`) `KindWord` and `NoLastControl` (`customize/KindWord.tsx`) follow them; both lists mount the one component (`Configured`; `AllConnectors` in `customize/MineAll.tsx`). | holds | M3 |
| K-4 | My items, All (`customize/MineAll.tsx`) draws the connectors' part from `connectorRows(inventory.data)`, narrowed by `connectorRowsMatching(rows, search)` (`rows.ts`, on `row.name`) and then sorted by `row.name` in `MineAll.tsx` itself; `AllConnectors` is handed the answer's `servers` for the rows' facts. The Connectors list narrows by the same `connectorRowsMatching`: the page has one search for every Show value. | holds, with where each part is: the narrowing is one function for both lists, the sort is All's own | M3 (a plugin's rows join that part by the name they show, `server`; the search also finds them by their plugin's name, under Show: Connectors as under All: ruled, the third point under the table) |
| K-5 | `openMine('plugins', { pluginId })` (`customize/open.ts`) opens My items with Show at Plugins and leaves a request (`useOpenRequest`, `customize/page.ts`), which `PluginsAt` (`customize/bodies.tsx`) honours once the plugin list holds an identity of that `id`. The `id` is the plugin's key, `<name>@<marketplace>` (`PluginIdentity.id`, `widgets/plugins/library.ts`). | holds | M3 ("from <plugin>") |
| K-6 | The page's place (`CustomizePlace` in `customize/place.tsx`, read by `usePlace()`) holds the one inventory read, the attached session's id and its plugin facts, and the one `Manage`, whose book is kept per place (`bookOf(cwd)`). It holds **neither the plugin list, nor the status read, nor the postures.** The plugin list is `usePluginsLibrary(directory, session)` (`widgets/PluginsWidget.tsx`), whose `identities` carry `enabledHere` (`widgets/plugins/library.ts`): the Plugins body and All each call it, their reads (`plugins.list`, `marketplaces.list`, the manifests) shared by query key, and **the Connectors body calls it nowhere.** The attached session's status read and the postures are `useConnectorRowFacts`' (`ConnectorsSection.tsx`), called once by each list; its postures read (`useCatalogPostures(cwd, servers, readAt)`, `customize/discover/read.ts`) is enabled only while `servers` holds at least one entry. | restated. Corrected here: the files M3 touches, and the postures read's condition (M3, Touches). **Ruled:** the plugin list under Show: Connectors (the first point under the table) | M3, §E |
| K-7 | `ItemImage` takes `{ kind, seed, iconUrl, size }` (`customize/image/ItemImage.tsx`); a configured connector's seed is its name; `catalog.postures`' rows carry `iconUrl` (`src/shared/ipc/schema/catalog.ts`). `posturesOf` (`src/main/catalog/postures.ts`) answers the icon of exactly one matching record, and the posture that the matching records agree on. The table of seeds is in U11c's document (its §C); `customize/image/tile.ts` holds the two seed helpers (`pluginSeedOf`, `catalogSeedOf`). | holds; M1's case for a plugin's posture is worded to `posturesOf`'s rule | M1, M3, §E |
| K-8 | U11c left untouched: `customize/InventoryState.tsx` and the coverage note's sentence; `widgets/McpWidget.tsx`'s dialog before a chat starts; `widgets/connector-menu.ts`; `BEFORE_START.connectors`; and, of what this landing edits, everything in `src/engine-host/`, `src/services/` and the wire's manifest (no commit between the parent pin and master `ef1d659ad` touches `src/engine-host/customization/`, `src/engine-host/plugins/manifest.ts`, `src/services/connectors/`, `src/services/spine-root.ts` or `src/shared/ipc/schema/customization.ts`). What moved is who mounts the note: `InventoryState` is handed `warnings` by `SkillsMine` and `ConnectorsBody` (`customize/bodies.tsx`), by `customize/MineAll.tsx`, and by the two dialogs before a chat starts (`widgets/McpWidget.tsx`, `widgets/SkillsWidget.tsx`). On main's side U11c added `iconUrl` to `catalog.postures`' rows and the command `catalog.pluginIcons`; neither is in the wire's manifest. | holds | M1 to M3 |
| K-9 | The helpers of `e2e/discover-connectors.spec.ts` reach My items, Connectors by the head's switch and the Show choice: `openConnectors(page, view)` opens Customize and calls `chooseCustomize(page, { view, show: 'Connectors' })` (`e2e/support/customize.ts`); `row(page, name)` finds `[data-connector="<name>"]` in the page. A plugin's row carries its server name in that mark (§E), so the collision step, whose two rows share a server name, finds each by `data-connector-plugin` as well. | holds | M4 |
| **U11g** | | | |
| K-10 | `WIRE_MINOR` is 48 on master `ef1d659ad` (47 was U11g's; a later landing took 48), and landings ahead of this one in the chain take more before it lands. This landing's minor is **the next free number of the tree it is merged onto, taken in one commit of its own at the chain merge.** No number is final before that. What the branch carries while it is built is a stand-in: one past the manifest's on the master it last merged, which `src/shared/ipc/wire.test.ts` demands of any branch that adds to the wire, in one commit that holds the minor's line with its history note, the generated files and nothing else. | restated | M1, Concrete Steps 3, 5 and 6, §K |
| K-11 | `test/endpoint/artifact-rows.test.ts` holds U11g's case that `connectors.addJson` is `not-offered` to a caller on another machine: under the comment "UX wave U11g (G6)", in the case "are offered, each as its kind, executor and target, and Discover’s catalog, Drive’s sign-in and main’s own are not". This landing's case stands beside it. | holds | M1 |
| K-12 | A custom connector added by U11g's sheet is a configured row like any other: `connectors.addJson` (`McpAddJsonSchema`, `src/shared/ipc/schema/connectors.ts`) adds at `user`, `project` or `local` scope through the engine's CLI, and the inventory lists the entry among `servers`. Nothing of it is a plugin's connector, and `sameAddressAs` (§A) can name one. | holds | §A |

**Handed to the architect at the pass, and ruled on 2026-11-15 (UTC)** (Decision Log, "the architect's ruling at the pre-build pass"). Each ruling is written where a builder reads it:

1. *The plugin list under Show: Connectors* (K-6). **Ruled:** the Connectors body reads the plugin list only when the inventory holds at least one plugin's connector, and Sign in is offered on a plugin's row only once that list has answered. Written in M3's Decisions, Touches and tests, and in §E ("While the plugin list is unknown").
2. *`catalog.postures`' new list against the window's check of every answer* ("What the code says", 16). **Ruled:** the list stays required; M1 adds `plugins: []` to the four scripted answers and runs the renderer's folder and typecheck. Written in M1's Touches, Decisions and "Does not touch", and in M1's row of checks (Concrete Steps, 2).
3. *The search by a plugin's name under Show: Connectors* (K-4). **Ruled:** under Show: Connectors as under All. Written in M3's Decisions and tests, and in §E.

## The landing's edge

**In.** X-184 as the child writes it: the inventory lists a plugin's connectors; their row in My items under Connectors and under All; Sign in from the row; no Remove; the coverage note's other half; l8-settings-03's line shortened and a plugin's connectors in a new chat's lists. And the "Waiting" entry the child handed to this document: what a row says when no session will hold it.

**Not included.** A switch per plugin connector (board ticket 476; §J names what it reads from here); skills that a marketplace declares and no folder holds; connectors of the engine's account and managed scopes; any change to how a plugin is turned off; a connector's site icon (U11d); the sign-in of a dynamic connector on a session of another machine (U11f); **any change to the session's Connectors dialog**, which keeps signing a dynamic connector in by its name alone, as U11a built it (ruled point 7; a tracker row); a connector a plugin ships as a bundle.

## Words used here

- **A plugin's connector** is a server that an installed plugin's files declare. Three names belong to it and are kept apart throughout: its **server name**, as the plugin's file writes it; its plugin's **key**, `<name>@<marketplace>`, by which the plugin is installed, by which My items lists it, and which a session reports as the plugin's `source`; and its **engine name**, `plugin:<manifest name>:<server name>`, under which a session's status lists it. The **manifest name** is the `name` of the plugin's `.claude-plugin/plugin.json`.
- **A session's plugin list** is what the engine last reported of the plugins it loaded: `system/init`'s `plugins`, or a `reload_plugins` answer's. MAWS holds it in the session's status (`EngineSessionStatus.plugins`: `name`, `path`, `source`, `version`; `pluginsObservedAt` is null until the engine has reported one).
- **A possible owner** of an engine name is a plugin whose `plugin:<its manifest name>:` is a prefix of that name. A manifest name may hold a colon, so two different manifest names can own one engine name (`alpha` with a server `beta:gamma`, and `alpha:beta` with a server `gamma`); two plugins of one manifest name are the plain case. **A collision** is an engine name with more than one possible owner: the engine connects one of them and says nothing.
- **A templated address** holds one or more `${…}`; the engine fills them from the launch's environment and reports the address filled.
- **The inventory**, **MAWS's own list**, **dynamic**, **the attached session**, **the page**, **the place**: as U11a's and U11c's documents use them.
- **Build F** is `f1852de3a`, the build on the owner's machines.

## Engine facts this landing rests on

Each is run on engine `2.1.322` unless it says otherwise. "The findings" are `spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt`; "the record" is `spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn.ndjson` (its line per case in brackets).

1. **The name is `plugin:<manifest name>:<server>`**, in `mcp_status` and in init's server list; the key's name plays no part (the findings, 1; the record [2]: a plugin installed as `key-alpha@m4-a` whose manifest says `mani-alpha` has `plugin:mani-alpha:alpha-http`). Proven for marketplace plugins. For a plugin whose source ends `@builtin` the engine puts an alias in the middle (`cli.pretty.js:954009-954011`): read, not run; such a plugin is not in `installed_plugins.json`, and its connector's engine name is null here.
2. **Nothing on a server's status entry names its plugin.** An entry carries `config`, `name`, `scope` (`dynamic`), `serverInfo`, `source` (`plugin`), `status`, `tools`, `transport`; `config` holds only the transport's fields: `type` and `url`, or `type`, `command` and `args` (the findings, 2). What names a plugin is the session's plugin list: `name` is the manifest name, `source` the key, `path` and `version` beside them; it is joined to a server only through the engine name's middle part.
3. **What `path` and `version` hold** (the journal `spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn-names.jsonl`, seq 30, `system/init`'s `plugins`, against the record's line 1, `installedEntries`, which holds the installation's values): for a plugin installed from a marketplace that is a folder, the session's `path` is the plugin's folder **in the marketplace** while the installation's `installPath` is its copy under the engine's plugin cache: they are different folders, and neither contains the other. `version` is the same string in both (`0.0.1`). One marketplace kind was run; a marketplace cloned from a repository was not.
4. **A collision gives one server and no word** (the findings, 3; the record [6] to [10]): the server of the plugin that comes later in the user settings' `enabledPlugins`; the session's plugin list holds both plugins under the one name. Not run: a collision between a plugin enabled in the user's settings and one enabled only in a project's or the local settings.
5. **A templated address is reported filled** in `config.url` (the findings, 4), and a local command's `${CLAUDE_PLUGIN_ROOT}` likewise in `command` and `args`.
6. **A plugin turned off has no server**, at user, project or local scope, silently (the findings, 5).
7. **Odd and long names are listed as written**: a space, a colon, 147 characters (the findings, 6). The engine has no bound here; MAWS's sign-in has one (§B, "The bound").
8. **The engine drops a plugin's server whose address a file-configured server names** (`spikes/protocol-probe/findings-uxwave-u11-plugin-server-dedup.txt`; the child, l8-settings-01).
9. **Until the engine has reported a plugin list, there is none to read.** A session MAWS started with no message has sent no `system/init` (U11a's document, gate run 43386195217; the probe itself sent the local command `/cost` to get one), while its `mcp_status` answers before that. No earlier source exists: the answer to the `initialize` request (the journal `u11-plugin-conn-names.jsonl`, the request at seq 3, its answer at seq 6) has 24 keys and none is a plugin list. MAWS's mark of it is `pluginsObservedAt === null`.
10. **The engine keys a credential by the server's name, type, address and headers** (`spikes/protocol-probe/findings-p4-r8-mcp-servers.txt`, items 2 and 5), and `mcp_authenticate` looks the name up among the session's loaded servers afresh at the call (`cli.pretty.js:614201`; the child, l8-settings-01).
11. **The engine reconciles plugins by itself** while a session runs: after a plugin install it finds (`cli.pretty.js:611574-611578`, "plugin_install_diff"), at a recheck of plugin copies (`:611791`, "plugin_copy_recheck") and at a sync (`:611797`, "plugins_sync"). Read, not run: when each fires was not probed. So the set of servers under a name can change with no act of MAWS's.
12. **A manifest name may hold a colon.** The engine's rule for it refuses an empty name, a space and control or formatting characters, and nothing else (`cli.pretty.js:953562`). Read, not run: no fixture holds a plugin whose manifest name has a colon; the probe ran a colon in a server name.
13. **The control protocol has no call that ends a sign-in flow; the flow ends by itself.** Read in `cli.pretty.js` 2.1.322, not run. The `mcp_` subtypes are `mcp_status`, `mcp_authenticate`, `mcp_oauth_callback_url`, `mcp_reconnect`, `mcp_message`, `mcp_set_servers`, `mcp_call` and `mcp_clear_auth`; the last clears the server's stored credential and reconnects (`:614430` on): it is not a cancel. A flow (`:149420-149527`) ends on its callback, on an abort signal, or on its own timer of 300,000 ms (`:149523-149525`); its cleanup (`:149431-149442`) closes its listener and removes its submitter. With a redirect of MAWS's (the custom scheme) the engine opens no listener (`:149491-149494`); with the engine's own loopback it listens on `127.0.0.1` for `/callback` only and refuses a state that is not the flow's (`:149494-149500`, `:149522`). The handler behind `mcp_oauth_callback_url` (`:149461-149479`) would end a flow at once when given a URL whose `state` is the flow's and that carries `error`; the engine's answer to `mcp_authenticate` carries that `state` (`:614267-614269`). **No record shows that path run:** the one recorded sign-in fixture, `spikes/protocol-probe/fixtures/p4/p4-agg-m4-signin.jsonl`, holds six `mcp_oauth_callback_url` requests and each carries a `code`; the declined branch of `submit` in `src/services/connectors/sign-in.ts` is pinned only against a stand-in host (`sign-in.test.ts`, "a callback carrying an error is submitted, and the engine's refusal reads denied"); no e2e scene declines a consent on the engine's flow.

## What the code says today, beyond the section

Checked at the parent pin, and again on master `ef1d659ad` at the pass of 2026-11-15 (UTC). No commit between the two touches a file that items 1, 4 to 6, 11 to 13 and 15 name, nor `customize/InventoryState.tsx`, `widgets/McpWidget.tsx` or `widgets/connector-menu.ts` (items 2 and 8). Where a named file did change, the statement was read again and stands: `src/shared/ipc/schema/connectors.ts` gained U11g's command and both bounds of item 7 are as they were; `customize/connectors/present.ts` (items 9 and 14) changed only above its sign-in half; `src/main/catalog/postures.ts` gained the icon and `configurationFingerprint` is as it was (item 14); `widgets/copy.ts` changed elsewhere and `BEFORE_START.connectors` has the same words (item 8); `src/shared/ipc/wire.ts` moved its minor (item 3; K-10). What U11c and U11g built is in "Statements to check again", read in the code; item 16 is the pass's.

1. **The inventory reads a plugin's folder for skills and not for servers.** `installedSkills` in `src/engine-host/customization/inventory.ts` walks `installed_plugins.json`, keeps the installations that apply to the folder (user scope, or a project path the folder is under), reads `.claude-plugin/plugin.json` for the manifest name (`pluginNameOf`), and adds the coverage warning once per installation. What a plugin's files declare as servers is read by another reader with other bounds, for "What's inside": `Inventory.mcpServers` in `src/engine-host/plugins/manifest.ts` (`.mcp.json`, then the manifest's paths and inline maps; a `.mcpb` or `.dxt` bundle is counted and never read; a URL where a path belongs is a problem). It keeps a name and a transport, no address and no file.
2. **The coverage sentence is a value on the wire.** The engine host sends `CUSTOMIZATION_INVENTORY_COVERAGE` as one of `warnings`, and the window finds it by equality (`customize/InventoryState.tsx`): an equal string is the folded note, any other is listed under "Some configuration could not be read". Build F holds the same constant. The component is handed the answer's `warnings` and nothing else of it, by five callers (K-8).
3. **An added member of an enum is a wire major** (`src/shared/ipc/wire.ts`); a new optional property at any depth is a minor. `customization.inventory` and `customization.serverEndpoints` are the engine host's and in the manifest. A receiver whose peer may be another build reads with `readTolerant` (`src/shared/ipc/tolerant.ts`), which drops a key it does not know; both pairs exist on one Mac (`e2e/cross-build.spec.ts`, "(update, daemon)" and "(build F's app, unit mawsd)"). Build F's schemas also lack `skills[].pluginName` and the endpoints' `revision`.
4. **The sign-in of a dynamic connector checks an entry only for MAWS's own list.** `dynamicRefusal` (`src/services/connectors/sign-in-entry.ts`) looks a press's `entry.revision` up among entries of scope `app`; `check` (`src/services/connectors/sign-in.ts`) reads `customization.serverEndpoints` with `cwd: null` for it and `session.mcpStatus` beside it. `holds` compares the scope, the transport, and the address only where the entry's holds no `${`.
5. **The services are told each session's plugin list and keep none of it.** The sign-in service hears `session.status` (`onSessionStatus`, wired in `src/services/spine-root.ts` to the hosts' event), whose payload is the whole `EngineSessionStatus`, the plugin list and `pluginsObservedAt` among it; its type there is narrowed to `{ process, cwd }` and it keeps the folder alone. The window holds the same status per session (`useSessions`' `engine`). So the list is in both places already, and carrying it costs a wider type and one more value kept per ready session: nothing on the wire.
6. **The status answer passes the engine's keys through.** `McpStatusResponseSchema` (`src/shared/wire/control.ts`) is loose: an entry's `scope`, `source`, `transport` and `config` reach the services as the engine sent them (`LiveServer`).
7. **A sign-in's name is bounded at 128 characters by MAWS's own schemas:** the command's input (`connectors.signInDynamicServer`, `name: z.string().min(1).max(128)`) and the event that carries its progress (`ConnectorSignInChangedSchema`); moving the event's bound is a wire major (the child, l8-settings-01). `signsInDynamic` is the window's form of it.
8. **Before a chat starts,** the "+" › Connectors submenu (`widgets/connector-menu.ts`) and the dialog (`McpBeforeStart` in `widgets/McpWidget.tsx`) list `usedEntries(inventory.servers)`, under `BEFORE_START.connectors`: "Configured for <place>. Connection state, and connectors from plugins, show once the chat starts."
9. **Only a remote connector signs in.** `signInViewOf` (`customize/connectors/present.ts`) answers no state and no Sign in for a transport outside `http`, `sse` and unknown (`REMOTE`).
10. **Customize cannot show another machine** (U11c's document, code 9), and `src/endpoint/offers.ts` has no row for `customization.inventory` or `customization.serverEndpoints`.
11. **The operation waits three times between its check and the engine's call** (`run` in `src/services/connectors/sign-in.ts`): after `deps.check` it reads the status again for its baseline (a server already connected ends the operation as "already connected"), binds its listener, and then queues its `session.mcpAuthenticate` behind an earlier one for the same session and name (`authenticateInOrder`). Each wait is long enough for a plugin to change.
12. **MAWS opens the browser itself.** After the engine's answer the operation calls `openExternal` with the engine's `authUrl`; where the answer has no `authUrl`, or `requiresUserAction` is false, it reports the sign-in done at once, with no browser.
13. **A cancel ends MAWS's operation and tells the engine nothing.** `cancel` moves the operation to `cancelled`, which closes its listener and drops its later answers; the engine's half-started flow is left as it is and is replaced by the next `mcp_authenticate` for that name (the comment at `authenticateInOrder`). MAWS makes no call that ends a flow in the engine, and the engine's control protocol has none (engine facts, 13).
14. **A retained result offers Sign in before anything else is asked.** `signInViewOf` (`customize/connectors/present.ts`) answers a failed or a cancelled record with `signIn: true`, and a running one too, ahead of the status and the posture; and it answers null, no state at all, for a transport that is not remote. A record is kept against main's fingerprint, which covers the transport and the address only (`configurationFingerprint`, `src/main/catalog/postures.ts`).
15. **Which plugin events the services hear.** `plugins.operation` (an operation of MAWS's own runner: started, its output, done) and `plugins.changed` (every plugin and marketplace change the engine host makes or sees) are both events of the engine host, which the spine's `hosts.onEvent` delivers to any service. Today the catalog's machine half hears `plugins.changed` (`src/services/catalog/machine.ts`); no service hears `plugins.operation`; the sign-in service hears neither. Carrying both to it is one subscription each in its wiring (`src/services/spine-root.ts`): nothing on the wire.
16. **The window checks every command's answer against its schema** (`src/renderer/src/ipc/client.ts`, which calls `validateCommandOutput` on each): an answer that lacks a required property comes back as `invalid_output`, and a read that fails so leaves its rows without their states (U11c's document, Surprises, M1: every scripted `catalog.postures` answer gained `iconUrl` with the schema). Four renderer test files script a `catalog.postures` answer today: `customize/CustomizeView.test.tsx`, `customize/MineAll.test.tsx`, `customize/CustomizePage.test.tsx` and `customize/discover/DiscoverAll.test.tsx`. Ruled (2026-11-15, UTC): the new list on that answer stays required, and M1 adds `plugins: []` to the scripted answers of those four files (M1's Decisions).

## The guarantee, and the sign-in rule (the architect's rulings of 2026-11-14)

### The guarantee

**G1, enforced.** A press on a plugin's row never opens the browser for, and never reports a sign-in on, a server whose address, when the engine answered, is outside the row's declared address: for a literal address, equal to it; for a templated one, of the same literal origin and matching its pattern. And never while the session's last reported plugin list shows no owner, another owner, or more than one possible owner of the engine name.

**G2, residue: not closed with an unmodified engine.** The engine reconciles plugins by itself (engine facts, 11) and looks the name up afresh at the call (engine facts, 10), and MAWS cannot tie the plugin list a session last reported to the set of servers of one instant. So between two checks that both pass, another plugin's server can stand under the name only if the engine swapped it twice, or swapped to a server whose address is inside the row's declared address while the reported list still shows this row's plugin alone. In both cases the address the person signs in at is the row's declared one. This is named here, in the pull request's body and in one tracker row, which also says what a person would see if it happened: a sign-in that opens at the right address and ends well, and lands on another plugin's entry of that name, so that the row's own connector still reads as needing a sign-in, or the name shows the other plugin's tools.

### The rule

All four parts hold, at each of the three points below, or nothing is sent, opened or reported.

| | what must hold | from what |
|---|---|---|
| (a) | **The owner.** Among the plugins the session last reported, those that are a possible owner of the row's engine name are exactly one, and its `source` is the row's key. None is no owner; one of another key is another owner; two or more is the collision, refused whichever would win. Where both that entry and the installation state a version, they are equal. No list reported (`pluginsObservedAt === null`) is refused. | `EngineSessionStatus.plugins`, `pluginsObservedAt`, as the services keep them per ready session from `session.status` (code, 5); the window reads the same status |
| (b) | **The server.** The session's status lists the engine name with scope `dynamic`, source `plugin` and the row's transport (`streamable-http` read as `http`). | `session.mcpStatus`, read afresh at each point |
| (c) | **The address.** A literal declared address equals the live `config.url`. A templated one is accepted only in the strict form of §B (a literal origin); then the live address, parsed, has that origin, and its whole text matches the pattern in which each `${…}` stands for one or more characters. A live address that does not parse fails. Any other templated address gives no Sign in from the row. | the entry's `url` from `customization.serverEndpoints`, against `config.url` of the same status read |
| (d) | **The revision.** The revision the press carries is the entry's now: it covers the plugin's key and its installation (scope, folder, version) together with the engine name, the transport and the address, so a removal, a replacement or an update between display and press is refused. | the same read of the endpoints |

### The three points

| | where in the operation (`run`, `src/services/connectors/sign-in.ts`) | what it reads | a failure |
|---|---|---|---|
| 1 | **at the press**, where `deps.check` runs today; and the baseline that follows it is judged by the same parts (b) and (c), so "already connected" is never said of a server outside the row's address | the endpoints at the session's folder and `session.mcpStatus`, once, together; the kept plugin list | is immediate: its own sentence (§G), nothing bound, nothing sent |
| 2 | **inside the queued call**, after the wait behind an earlier authentication and immediately before `session.mcpAuthenticate` is sent | `session.mcpStatus` afresh; the kept list; and that nothing moved since point 1 (below) | sends nothing |
| 3 | **after the engine's answer and before `openExternal`**, and equally before the end with no browser (`authUrl` undefined, or `requiresUserAction` false) is reported as signed in | the same as point 2 | opens no browser and reports no sign-in; MAWS's operation ends as a cancel ends it (its listener closed, the engine's later answers dropped). **Nothing is sent to the engine to end its flow** (ruled 2026-11-14; engine facts, 13): the flow is left to the engine's own timer of 300 seconds, or to the next `session.mcpAuthenticate` for that name, which replaces it. `mcp_clear_auth` is never used here: it would clear a stored credential |

*Nothing moved since point 1* means all of: the session's `pluginsObservedAt` is the value read at point 1; no operation of MAWS's own plugin runner is under way (a `plugins.operation` begun and not done); and no `plugins.changed` has been heard since point 1 (code, 15). A failure at point 2 or 3 that point 1 did not have reads "Plugins changed while this sign-in started. Try again."

*What else of the session's plugin entry is compared* (engine facts, 3): `version`, where both sides state one. `path` is not compared: for the one marketplace kind that was run it names another folder than the installation's, so a comparison would refuse every plugin. *A local command* is never signed in (code, 9), so the rule is not reached for it; nothing of its `command` or `args` is compared, and they cross to no one.

*Before any session exists*, the window has a second net for the row's own words: the same prefix test, over the plugins the inventory keeps for the page's folder that the plugin list says are enabled there (§A, `plugins`).

*The session's Connectors dialog is not under this rule.* It signs in the session's own server by its name, and its row claims no plugin (ruled; a tracker row).

## Reported to the architect, and ruled

The first version reported nine points; the architect ruled on each on 2026-11-14 (ruling G; Decision Log). The numbers are kept.

1. **No plugin list yet. Ruled:** the condition is `pluginsObservedAt === null` (not "no turn"); the row says "Send a message in that session, then sign in." No earlier source exists (engine facts, 9). The candidate "send `reload_plugins` at the press and read its answer" is **not taken**: no fixture shows that a reload of an unchanged set leaves running connectors and their sign-ins alone. One tracker row, with that as what would open it.
2. **Version. Ruled:** compared where both state one (engine facts, 3, for the equality that was run). P5 stays optional; one tracker row.
3. **Path. Ruled:** not compared.
4. **A local command. Ruled:** nothing compared, nothing crosses.
5. **The race. Ruled** in the guarantee (G2) and the three points; the first version's "the length of one call" is withdrawn.
6. **The bound of 128 characters. Ruled:** MAWS's own; the row is listed with "Its name is too long to sign in from MAWS."
7. **The session's Connectors dialog. Ruled:** unchanged in this landing; it claims no plugin. One tracker row: a line in that dialog when the session's list holds more than one possible owner of a `plugin:` name.
8. **Bundles. Ruled:** the coverage note keeps an explicit clause that a plugin's connector shipped as a bundle, or in any other form the inventory does not read, is not listed (§G). No reader is built.
9. **The words. Ruled** (§G): the collision's line is one form that also covers two different manifest names; "That session loaded <manifest name> from another plugin." becomes "That session loaded this connector's name from another plugin."; the other lines stand; the sentence of point 3 is added.

**Reported at this revision**, each a precision the code adds to a ruling and none a contradiction:

- *Ruling C, "ends the engine's flow the way a cancel does today":* a cancel today ends MAWS's operation and tells the engine nothing (code, 13). **Ruled on the architect's reading of the engine's source (2026-11-14, UTC; engine facts, 13):** the flow could be ended by submitting a callback URL with the flow's `state` and `error=access_denied` through the existing submit path, and that call is written only if a record or a scene shows a declined consent ending the flow that way. None does (engine facts, 13, its last sentences), so **no such call is written**: a failure at point 3 leaves the engine's flow to its 300-second timer or to the next call for that name. One tracker row carries it, and "What is not proven", N-5b.
- *Ruling G1's citation:* the `initialize` request is at seq 3 of the journal and its answer, the 24 keys, at seq 6.
- *Ruling G2's citation:* the journal holds the session's side of the version equality (seq 30); the installation's side is a value in the record's line 1, `installedEntries`, and in no journal.
- *Ruling B's second net* needs the manifest name of every plugin enabled for the folder, also of one that declares no connector (it can own a prefix). The inventory lists them (§A, `plugins`): a third optional property in the same minor.

## Acceptance

- **H1 · Listed with no session** (A20). With an installed plugin that brings a connector, and no session running, My items lists it under Connectors and under All as "<server> · from <plugin>", with its image, no file line and no Remove; "from <plugin>" opens the plugin's detail. Under All it carries the word Connector.
- **H2 · The note** (A20; ruling G8). The folded "Inventory coverage" note no longer says that plugin connectors are missing; it reads §G's sentence, which keeps the clause for a connector shipped as a bundle. With an engine host of an earlier build it reads as today, and neither sentence is ever listed under "Some configuration could not be read".
- **H3 · Sign in from the row** (A20). While a session MAWS runs on this Mac has reported its plugins, this row's plugin is the one possible owner of the connector's name there, and the session holds the connector needing a sign-in, the row offers Sign in; pressing it opens the consent page and the row ends "Signed in · connected here". With no session that holds it: "Open a session, then sign in".
- **H4 · Through another session** (the architect's ruling, F3). With the attached session not holding the connector and a second ready session on this Mac that satisfies the rule, the row reads "Not in the attached session" and still offers Sign in, which runs through the second; a running sign-in's Cancel and its result stay on the row.
- **H5 · The guarantee's enforced part** (G1). With more than one possible owner of a connector's name (two plugins of one manifest name; or two manifest names that build one engine name), no row of that name offers Sign in, with or without a session, and each says why and what resolves it. A press sent anyway (the window bypassed) is refused in the services before the engine is asked: for a session whose list shows none, another or more than one possible owner; for a server of another transport or address; for a revision that is not the entry's now. And when plugins change after the press, at either later point: nothing is sent, or no browser is opened and no sign-in is reported, with "Plugins changed while this sign-in started. Try again."
- **H6 · A templated address.** A row whose address has `${…}` after a literal origin signs in when the live address has that origin and matches the pattern; one whose origin is not literal in the strict form offers no Sign in and points at the chat's dialog.
- **H6b · A retained result never gives Sign in back** (ruling E). On a plugin's row Sign in is offered only by what holds now. After a failed or cancelled sign-in, and after a success, a reason that blocks now (a collision that arrived, the plugin turned off) shows its line in place of the old result and offers nothing; a sign-in under way keeps its step and Cancel.
- **H7 · A row that nothing will load says so** (the child's "Waiting"): "Not loaded: same address as <name>"; "Plugin turned off", whichever of the three scopes turned it off.
- **H8 · Before a chat starts** (A20). In a new chat on this Mac, "+" › Connectors and the dialog list a plugin's connectors with the configured ones, and the dialog's line reads "Configured for <place>. Connection state shows once the chat starts." A chat set to another machine still reads "Shown once the chat starts on <machine>".
- **H9 · This Mac only** (bindings 9 and 14). `customization.inventory` and `customization.serverEndpoints` are refused to a caller on another machine; a press from a row goes only to a session of this Mac; no address reaches the window.
- **H10 · Build F** (UC-14). Nothing is stored. Build F's reader accepts this build's two answers, dropping what it does not know; this build's reader accepts build F's, lists no plugin connector and words the note as today.

## Constraints that bind every milestone

- **The build brief binds.** No typecheck, lint, vitest, install, Electron or build on the MacBook; every check runs on the build VM in a checkout of the pushed head (Concrete Steps), read against its load when slow. A test that fails must fail in bounded time.
- **The engine is not run and not guessed at** (law 6). No engine runs on the MacBook. Every engine statement here is in "Engine facts", each with where it was run or that it was only read; a milestone that needs one more comes back to the architect.
- **Every engine sign-in and every Keychain write a test makes runs only in a gate job on the Mac mini runner** (binding 11). No unit test signs in; the one scene that does is the architect's to run (Proof, P1).
- **One sign-in per connector at a time** (binding 8) is U11a's and unchanged: a plugin's connector is keyed by its machine and its engine name.
- **Privacy** (UC-11, the architect's rule). A fault is never reproduced by reading the content of a person's session, settings file, configuration file or plugin folder: structure and counts only, none of it in the repository. Every plugin, connector, marketplace and skill name in a test, a fixture or a scene is invented.
- **No address in the window.** A plugin's connector's address goes to main alone, as every row's does; the window gets its shape (`address`, §A) and nothing of its text. A local command's command and arguments go to no one.
- **Nothing stored, nothing in a settings file** (UC-14); the wire moves by one minor, additively: three optional properties. No enum of a command or event the manifest holds gains a member, and no bound moves.
- **This Mac only** (bindings 9 and 14). No offer row, capability or `remote-unavailable` entry is added; `src/endpoint/` is not edited.
- **Tokens only** (law 7); a ticket is written in words in renderer source; run `test/support/tokens-guard.test.ts` with every milestone that adds renderer source.
- **Keep means keep** (law 8). The configured rows, the session's dialogs and U11a's sign-in for MAWS's own list are not changed: `dynamicRefusal`'s cases for a press with no entry and for a name that does not start `plugin:` keep their results and their words, and their tests stay.
- **Files other children own or none holds** (UC-8). `src/shared/ipc/wire.ts` and the generated wire files (one minor, whose number is taken at the chain merge, K-10; made again after the last merge of master and at the chain merge); `src/services/connectors/` and `src/engine-host/plugins/manifest.ts`, which no child holds; `test/endpoint/artifact-rows.test.ts` (one case). In U4's `composer/plus-menu/PlusMenu.tsx`: nothing (the submenu's rows come from `widgets/connector-menu.ts`).
- **Merge, never rebase or force-push.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. On "No space left on device": stop, report, delete nothing.

## Plan of Work

Four milestones. M1 and M2 are the machine's side, each reviewed at its boundary before M3 consumes them; M2 holds the rule and its three points and nothing else, so that its proof is read alone.

**Size**, counted from the code (changed lines, tests included):

| | changed lines | files |
|---|---|---|
| M1 | about 750 | about 19 |
| M2 | about 950 | about 10 |
| M3 | about 1,000 | about 21 |
| M4 | about 300 | about 7 |
| the landing | about 3,000 | about 50 |

### M1 — The inventory lists a plugin's connectors

**At its end** the engine host answers, beside today's rows, one row for each connector that an installed plugin's files declare for the folder and one entry for each plugin it keeps for the folder, with its manifest name (§A), and main answers each connector's posture, fingerprint, revision and icon. Nothing in the window draws any of it yet.

**Touches.** `src/shared/ipc/schema/customization.ts`; `src/engine-host/customization/inventory.ts` and its test; `src/engine-host/plugins/manifest.ts` and its test, only if the one rule below is kept by extending its reader; `src/shared/plugins/` (the address's shape, §B, with its test: the engine host and the services both read it); `src/shared/ipc/schema/catalog.ts` (the postures' answer); `src/main/catalog/postures.ts`, `index.ts` and their tests; `src/shared/ipc/wire.ts` and the generated wire files; one new test file beside `src/shared/ipc/send-now-builds.test.ts` for the two builds; `test/endpoint/artifact-rows.test.ts` (one case); and four window test files, for the one key their scripted `catalog.postures` answers gain: `src/renderer/src/customize/CustomizeView.test.tsx`, `MineAll.test.tsx`, `CustomizePage.test.tsx` and `discover/DiscoverAll.test.tsx`.

**Interfaces.** Exposes §A. Consumes U11a's `configurationRevision` and `pluginNameOf`.

**Decisions.**
- *One rule for what a plugin's files declare.* For an installation, the inventory lists the servers that "What's inside" lists for it (`readManifestView(…).components.mcpServers`): the plugin's `.mcp.json`, then the paths and inline maps its manifest names, first declaration of a name winning; a bundle and a URL where a path belongs are not listed and add no warning (a warning would be drawn as "Some configuration could not be read"). How the rule is shared is the executor's: the reader of `manifest.ts` extended to keep each server's address and declaring file, or the inventory's own `Reading` following the same rule. Either way the inventory's bounds hold (`INVENTORY_BOUNDS`: entries, bytes, the deadline, and `rows` as this list's cap too), every file is read confined to the plugin's folder as the skills' files are, and a test pins that the two readers name the same servers for one invented plugin that uses all three ways of declaring.
- *Which installations.* The ones `installedSkills` keeps for the folder. One row per key and server name: where a plugin is installed twice for the folder, the first installation in the file's order. A plugin whose key ends `@builtin` gets a null engine name (engine facts, 1).
- *Every plugin kept for the folder is named* (`plugins`, §A), also one that declares no connector: a plugin can be a possible owner of another's engine name by its manifest name alone, and the window's second net needs them all.
- *The address's shape* is `addressFormOf`'s (§B): the strict form, written once and read by the engine host and the services.
- *A name is listed as written* (engine facts, 7): no cut. A server name or manifest name longer than its field's bound (§A) is not listed, since a cut name is another name.
- *The address is compared as written.* `sameAddressAs` names a `user`, `project` or `local` entry of the same read whose address string equals this one's, only where the row's transport is `http`, `sse` or `ws` and neither address holds `${`; **only an entry the engine uses for its name is compared** (`usedEntry`'s rank among the read's file entries: an entry another scope overrides by name is not loaded and drops nothing; corrected 2026-11-15, Decision Log); the highest in that precedence (`local`, then `user`, then `project`) when several do. The address compared, its form and the revision are of the declared text whole; a connector whose declared address is longer than the endpoints' bound of 4096 **is not listed** in either answer, by the rule above for a name past its bound (a cut address is another address, which a session at that prefix would match; the architect's ruling of 2026-11-15, Decision Log); M2's (c) still refuses an entry of a remote transport whose `url` is null. MAWS's own entries are not compared (the engine does not compare servers given at launch).
- *The revision* covers what rule (d) names; null where the engine name or the address is null.
- *The coverage warning* is still added once per installation, and its string is not edited ("What the code says", 2).
- *The wire's minor* (K-10): the next free number of the tree this landing is merged onto, taken in one commit of its own at the chain merge. Until then the branch carries a stand-in, one past the manifest's on the master it last merged, in one commit that holds the minor's line, the generated files and nothing else; the history note beside the number reads "the UX wave's U11h: customization.inventory's and customization.serverEndpoints' pluginServers" (Concrete Steps, 3 and 5). Nothing but that line and the generated files holds the number.
- *`catalog.postures`' new list is required* (the architect's ruling at the pre-build pass, 2026-11-15 UTC): the window and main are one build, so the property is not optional. The window checks every answer against its schema (code, 16), so in this milestone each scripted `catalog.postures` answer of the four window test files gains `plugins: []`, and this milestone's checks run `src/renderer/src/customize` and the renderer's typecheck beside its own (Concrete Steps, 2). A later test that scripts that answer includes the list.
- *Pitfalls.* `serversRead` is about the files Add checks a name against and does not change. The inventory's test helpers build a scratch config home; no test reads a real one.

**Does not touch.** It touches no window source; four window test files gain the new key. The services. `customization.inventory`'s `servers` and `skills`. `src/endpoint/`. `src/shared/net/egress.ts`.

**Proves** the machine half of H1, H7 and H8, and H9's and H10's part that a test can show. Its tests pin:
- for an invented plugin: a server from `.mcp.json`, one from a manifest path, one from an inline map, each with its transport, its declaring file, its installation's scope and version, and its engine name built from the manifest name where that differs from the key's (engine facts, 1); the same names as `readManifestView`; a name with a space and one with a colon as written; an engine name of 147 characters whole; a bundle and a URL spec not listed; a file outside the plugin refused;
- a manifest whose name cannot be read, and a key ending `@builtin`: `pluginName` or `name` null as §A says;
- an installation for another project: no row; the same plugin installed twice for the folder: one row per server;
- `plugins`: every installation kept for the folder with its manifest name, a plugin with no connector among them, one whose manifest name holds a colon as written;
- `address` by §B's strict form: literal; templated after a literal origin; and `templated-origin` for a `${…}` in the scheme, the authority or the port, for an extra slash before the authority (`https:///${HOST}/mcp`), a backslash, userinfo (`@`), whitespace, and an upper-case scheme with a `${…}` anywhere; null for a local command; `sameAddressAs` in its cases;
- `customization.serverEndpoints` carries each row's address and revision, and the revision moves when the key, the installation's scope, folder or version, the name, the transport or the address moves; `customization.inventory` carries no address, command or argument in any field;
- postures for a plugin's row, by the rule `posturesOf` has for a configured row (K-7): the posture that the records its address matches agree on, null for none or where they disagree; the icon of the one record it matches, null for none or several; a fingerprint; the host's revision;
- the two builds, over representative answers (a plugin's skill with `pluginName`, an endpoint with `revision`, a `pluginServers` list): build F's copies of the two answer schemas, read with `readTolerant`, accept them, and what is dropped is only what F does not know; this build's schemas accept build F's answers;
- `customization.inventory` and `customization.serverEndpoints` answer `not-offered` to a caller on another machine;
- `wire.test.ts` classifies the change as a minor;
- the four window test files pass with `plugins: []` in their scripted `catalog.postures` answers, their rows keeping their sign-in states.

### M2 — The rule, at three points of the operation

**At its end** a press that names a `plugin:` server with a revision is held to the four parts of the rule at the three points of "The three points", and every failure ends the operation with its own sentence: at the press before anything is bound; at point 2 before anything is sent; at point 3 before any browser is opened and before any sign-in is reported.

**Touches.** `src/shared/plugins/` (the pure functions of §B and their tests); `src/services/connectors/sign-in-entry.ts`, `sign-in.ts` and their tests; `src/services/spine-root.ts` (the wider status type and the two event subscriptions; code, 5 and 15) with its test.

**Interfaces.** Exposes §B. Consumes §A's endpoints, U11a's `dynamicRefusal`, `holds` and the operation's `check`.

**Decisions.**
- *The functions are pure and shared* (`pluginInSession`, `addressMatches`): the services enforce with them and the window words its lines with the first, so the row and the refusal cannot disagree about (a).
- *One function is the check at all three points* (§B, `SignInDeps['check']` widened to take the point): the same four parts, on a fresh status each time; points 2 and 3 add "nothing moved since point 1". A check that is written three times would drift.
- *The services keep each ready session's plugin list* from the status event they already hear, with `pluginsObservedAt`, beside its folder, and drop it when the session is gone. A session they learn of from the listing they read at a start (`deps.sessions()`) takes the same two fields where that listing holds the status; where it does not, such a session counts as having reported no list until its next status event.
- *What moved* is told by three things the services hold (the rule, "Nothing moved since point 1"): the kept `pluginsObservedAt`; a count of `plugins.operation`s begun and not done; whether a `plugins.changed` came since the operation's point 1. The two events are new subscriptions of the sign-in service.
- *The entry is found by its revision and its name together* among `pluginServers` read at the session's own folder: the revision covers the key, so two entries of one engine name are told apart, and the press's own schema does not change. Points 2 and 3 use the entry found at point 1 and do not read the endpoints again: what they guard is the session, and (d) guarded the page.
- *Point 1's baseline.* The status the operation reads after its check, to see whether the server is already connected, is judged by (b) and (c) like any other: "already connected" is a report of a sign-in. So before it is reported, (a) is judged again on the list kept now and nothing may have moved since point 1, as at point 3 (corrected 2026-11-15 on M2's review: a collision reported during the baseline read must not end as "already connected"); a failure there reads the later points' sentence.
- *A cancel is honoured at every resumption.* Wherever the operation resumes after a wait (after the check at point 2, before `session.mcpAuthenticate` is sent; after point 3, before the answer is acted on), it confirms it is still live, so a cancel that lands between a passing check and its side effect sends nothing and opens nothing (M2's review).
- *Point 3 comes before every way the engine's answer is acted on*: before `openExternal`, before the end with no browser, and before the branch that leaves the redirect to the engine's own listener.
- *A failure at point 3* ends MAWS's operation as a cancel does (code, 13) and with the sentence of the point. **It sends the engine nothing**: no callback URL of MAWS's own making, and never the engine's `mcp_clear_auth` (MAWS sends that subtype nowhere today, and this landing adds no command for it) or anything else that touches a stored credential ("The three points"; engine facts, 13). The path that would end the engine's flow at once is read in its source and shown in no record, so it is not built on.
- *Order within a point:* (d) at point 1 only, then (a), then (b), then (c): the collision before anything is compared with a server that may be another plugin's.
- *Reason and words:* every failure fails with today's reason `other_entry` and §G's sentence.
- *The dialog's press* (no entry) and a press for MAWS's own list are today's code paths, with no point 2 or 3: unchanged.

**Does not touch.** The command's and the event's schemas, their bounds, the redirect, the grade. The window. `connectors.signIn`, `connectors.signInServer`.

**Proves** H5 and H6 where the act runs, and H3's and H4's part that the services decide. Its tests pin, at the functions and then at the service:
- (a), on the engine name: no list reported; no possible owner; one, with the row's key; one, with another key; two plugins of one manifest name, the row's first and the row's last (the record's lines 6 and 7 as the two orders); **the colon pair**: `alpha` with a server `beta:gamma` and `alpha:beta` with a server `gamma`, both loaded in one folder's session: refused for either row; the same pair where the second plugin is installed only for another folder and that folder's session is asked: there it is the collision, and in the first folder's session, which did not load it, the first plugin is admitted; a version that differs, and a version one side lacks;
- (b): no server of the name; scope not `dynamic`; source not `plugin`; another transport; `streamable-http` against `http`;
- (c): a literal address equal and unequal, a trailing slash a difference; a templated path that matches, one that does not, a `${…}` that would have to stand for nothing; the strict form's refusals (the extra slash, a backslash, userinfo, a `${…}` in the port, an upper-case scheme), each `templated-origin` and never asked of `addressMatches`; a live address whose parsed origin differs though its text matches the pattern; a live address that does not parse; an entry of a remote transport whose `url` is null (its declared address past the endpoints' bound, M1) refused, and a session whose live address is that address's first 4096 characters is not admitted;
- (d): the entry gone; its revision another (each of the six things the revision covers changed in turn); the host answering no revision;
- **the three points, each by its own named tests**, built so that the other two points pass and removing the named point's check fails the test (the architect's addition). Each "swap" replaces what the session reports with another plugin's server under the same name, or its list with one that fails (a):

  | point | test names |
  |---|---|
  | 1 | "point 1: a press the rule refuses binds no listener and reads no baseline"; "point 1: the baseline of a server already connected at another address is not reported as already connected" |
  | 2 | "point 2: a swap during the baseline read sends no mcp_authenticate"; "point 2: a swap while the listener is bound sends no mcp_authenticate"; "point 2: a swap while queued behind an earlier authentication sends no mcp_authenticate"; "point 2: a reload answered during the queue wait sends no mcp_authenticate" |
  | 3 | "point 3: a swap between the call and the engine's answer opens no browser"; "point 3: a status whose address changed between the call and the answer opens no browser"; "point 3: a new pluginsObservedAt between the press and the answer opens no browser"; "point 3: a plugins operation running at the answer opens no browser"; "point 3: the no-browser end with a changed address is not reported as signed in"; "point 3: a refused answer leaves the operation ended as a cancel leaves it, and sends the engine no callback and no other call" |

  In each, the earlier points see the first state (held open: the swap is injected after the earlier point's reads have answered and before the named wait resolves), and the assertion is on what was not sent, not opened or not reported, and on the sentence;
- **held open** at point 1: the endpoints read is out while the status has answered, and nothing proceeds before both have; the read fails: "that session's configuration could not be read"; the read is made with the session's folder;
- the list is dropped when the session ends, and a new launch's list is not the old one's; a `plugins.operation` that is done no longer blocks;
- U11a's cases of `dynamicRefusal` and of the service for a press with no entry and for MAWS's own list pass unedited, and make no second or third status read.

### M3 — The row in My items, its lines and Sign in; the coverage note; the lists before a chat starts

**At its end** My items draws a plugin's connectors after the configured ones under Connectors and in the connectors' part of All, with §E's row and lines and Sign in through a session the rule admits; the note has the item's words; a new chat's "+" › Connectors and its dialog list them.

**Touches.** `customize/connectors/` (`rows.ts`, `ConnectorRow.tsx`, `present.ts`, `copy.ts`, `ConnectorsSection.tsx` and their tests); `customize/bodies.tsx` (`ConnectorsBody`: what the Connectors list is handed, K-2; the plugin list read, mounted on its condition; its `InventoryState`s) and `customize/MineAll.tsx` (All's sort by the name a row shows, what `AllConnectors` is handed, its `InventoryState`; K-4, K-8) with `customize/MineAll.test.tsx`; `customize/discover/read.ts` (`useCatalogPostures`, which must also read where a folder holds only plugins' connectors; K-6); `customize/image/tile.ts` and its test, only if a plugin's connector's seed gets a helper beside the two there (K-7); `customize/InventoryState.tsx`; `widgets/McpWidget.tsx` (the dialog before a chat starts), `widgets/SkillsWidget.tsx` (only as a caller of `InventoryState`, if what that component is handed changes), `widgets/PluginsWidget.tsx` (only if `usePluginsLibrary` takes a switch for the condition below), `widgets/connector-menu.ts`, `widgets/copy.ts` (`BEFORE_START.connectors`); `src/shared/ipc/schema/customization.ts` (the constant's comment); `widgets/before-start.test.tsx`, `customize/CustomizeView.test.tsx` (the Connectors list's cases are its `describe('Connectors')`; All's are `MineAll.test.tsx`'s).

**Interfaces.** Exposes §E and §J. Consumes §A, §B, U11c's row and page (K-1 to K-7), U11a's `startSignInDynamic`, `signsInDynamic`, `signInKeyOf`, `resultFor`, `useSignIns`, `signInViewOf`, `usedEntries`, `useTabPlace`, and the launch profile's `plugins.off` as `SkillsOnDisk` reads it.

**Decisions.**
- *The plugin kind is the model's second member and the row's second branch* (K-1): a second `case` of `partsOf`, and each place K-1 names outside `partsOf` (the marks, the seed, the name drawn, the buttons' names, the press, and the facts `useConnectorRowFacts` answers) takes what it reads from the kind. The configured `case` is not edited, and a configured row draws and sends what it does today: its cases in `CustomizeView.test.tsx` and `MineAll.test.tsx` pass unedited.
- *Which session.* The attached session when the rule's window half admits it; else the first ready session MAWS runs on this Mac that the window half admits, one in the page's folder first, then by id (U11a's order). "Admits": its status lists the engine name (the attached session's own status read counts too) and `pluginInSession` answers `ok`. The services decide; this only picks whom to ask.
- *Sign in is decided by what holds now, never by a retained record* (ruling E; code, 14). For a plugin's row the action comes from §E's table alone; a retained record gives text only, and Cancel while its operation is under way. A reason that blocks now is shown in place of a retained ended result, a success included. So the row does not take `signInViewOf`'s `signIn` for its action, and its record is kept against the row's revision, not main's fingerprint (§E, "What a retained record is kept by").
- *A local command's row has its own presentation* (code, 14: `signInViewOf` answers null for it): its state is the admitted session's status in the dialog's words (`connectorStatusWords`), or nothing; never a sign-in word.
- *The row reads a live state only from a session the window half admits*: a server under the same name in a session where (a) fails may be another plugin's.
- *The plugin list under Show: Connectors* (the architect's ruling at the pre-build pass, 2026-11-15 UTC; K-6). The Connectors body mounts the plugin list read (`usePluginsLibrary`) only when the inventory's answer holds at least one plugin's connector (`pluginServers` present and not empty), the same kind of condition `useCatalogPostures` has, so a person with none pays no read. How the condition reaches the reads is the executor's (`usePluginsRead` is off for a null folder and takes `enabled`). All already reads the list and is not changed in that. **Sign in is offered only once the plugin list has answered**; what a row reads while the list is unknown is §E's ("While the plugin list is unknown"). No new sentence is drawn for that state.
- *The page's search finds a plugin's connector by its plugin's name* under Show: Connectors as under All (the architect's ruling at the pre-build pass, 2026-11-15 UTC; K-4): `connectorRowsMatching` is the one rule for both lists, and a plugin's row matches by the name it shows, `server`, or by its plugin's name as "from <plugin>" shows it.
- *The lines* (§E's table) come before any sign-in state, as a shadowed row's words do today, except "Not in the attached session", which is information beside Sign in (H4).
- *The collision before any session* is told from the page's own reads by the rule's own prefix test: among the inventory's `plugins` that the plugin list says are enabled here, more than one possible owner of the row's engine name. The line names them as My items shows them.
- *The press* sends the engine name and the revision the row was drawn with, and keeps the fingerprint in the window, exactly as a row of MAWS's own list does.
- *Before a chat starts* the two lists are today's entries, then the plugin's connectors without those that read "Not loaded: same address…" and those whose plugin the launch profile turns off; a row's detail word is "from <plugin>" in the submenu, and its opened part names the declaring file in the dialog.
- *Pitfall.* An engine host of an earlier build answers no `pluginServers`: the list is today's and the note is today's sentence.

**Does not touch.** `src/services/`, the command, the dialog of a started chat, the Connectors card, Settings › MCP servers, the configured rows.

**Proves** H1 to H4, H7, H8 and the window's half of H5 and H6. Its tests pin:
- the row: the server name, "from <plugin>" (a button that opens the plugin's detail), the transport, the image, no scope word, no file line, no Remove; its marks; under All its kind word and its place by name;
- each line of §E's table in its case, with no Sign in, and their order where two hold; the collision's line on both rows with no session, naming both plugins, for two plugins of one manifest name and for the colon pair (where the second plugin declares no connector of its own name, and still owns the prefix); on the row for a session whose list holds two; "Plugin turned off" for the plugin list's not-enabled, whatever turned it off;
- **a retained result** (ruling E): a collision arrives after a press, while the operation runs: the step and Cancel stay, and when it ends its result is not shown, the collision's line is, with no Sign in; a collision arrives after a failure, and after a cancel: the line replaces "Sign-in didn't finish", with no Sign in; the plugin is turned off after a success: "Plugin turned off" replaces "Signed in"; the row's revision changes: the retained record is dropped; with nothing blocking, a failed record shows its words and Sign in is offered because the table offers it, not because the record does;
- a local command's row: its state from an admitted session's status, no sign-in word in any case, nothing where no session is admitted;
- Sign in only where §E says, and the press's two values; "Open a session, then sign in" with no session that holds the name;
- **held open** (the plugin list; ruled 2026-11-15, UTC), on a row that row 9 would give Sign in: while the plugin list read is out, no Sign in, the admitted session's state in the dialog's status words, and "from" followed by the part of the key before its last `@`; the list answers with the plugin enabled: Sign in appears and the name is the one the plugin's own row shows; the list answers with the plugin not enabled: "Plugin turned off"; the list fails: no Sign in, and nothing is thrown;
- the plugin list read is not mounted by the Connectors body when `pluginServers` is empty, and when it is absent (no `plugins.list` is asked), and is when it holds one;
- the search, under Show: Connectors and under All, one test for each list: a text that is in a plugin's name and in no connector's name keeps that plugin's connectors' rows and no configured row; a text in the server name keeps the row;
- **held open** (H4): the attached session's status has answered without the server; a second ready session holds it and is admitted: the row reads "Not in the attached session" with Sign in; the press goes to the second; `starting` is heard before the receipt; Show is changed to All and back; the steps and Cancel stay on the row; the result reads on it;
- **held open**: the attached session has had no turn (no list reported) and lists the server: its line, no Sign in; its status then reports the list: Sign in appears with no reload of the page;
- the services refuse with each of §G's sentences: the row reads it after "Sign-in didn't finish:"; the invoke is refused (`unknown_command`): the transport's words;
- the note's words with and without `pluginServers` in the answer, and that neither sentence is listed under "Some configuration could not be read";
- before a chat starts: the submenu's and the dialog's rows, the two exclusions, the line's new words; a tab set to another machine reads nothing.

### M4 — The record, the e2e scenes written, the whole checks, the hand-back

**At its end** the scenes are written and typechecked, the record is in the branch, and the acceptance has been run as far as an executor can run it.

**Touches.** `e2e/discover-connectors.spec.ts`, `e2e/widgets.spec.ts`; the documents of "The record"; this document.

**Decisions.** No spec file is added and no time bound asserted but in a form `.github/scripts/gate-plan.test.mjs` lists. The scene that signs in gives its session a turn without calling a model, by the local command the probe used (`/cost`), so that the engine has reported its plugin list. The row's sign-in step has a scratch plugin, a server and an OAuth fixture address of its own, which no earlier step signs in (ruling F): the scene's existing plugin connector is signed in through the dialog before Customize is reached, so a row that read "Signed in" for it would prove nothing.

**Proves** by running, on the VM: the whole typecheck, lint, the whole unit suite once, the scan and the script tests (Concrete Steps, 5).

### The e2e groups and scenes

| group | file | scenes |
|---|---|---|
| `e2e:discover` | `e2e/discover-connectors.spec.ts` | "dynamic: a plugin’s connector and one of MAWS’s own list signed in from the Connectors dialog, a second of the list from Customize" keeps its dialog assertions as they are and gains **two steps**. (1) *The row signs in:* a second scratch plugin, with its own server and its own OAuth fixture address, signed in by no earlier step. Before the session's `/cost` its row in My items reads its line and offers no Sign in; after it the row reads "from <plugin>" and offers Sign in; the step accepts the row's success only after the browser hand-off was recorded and the consent exchange was made at that fixture's address. It makes an engine sign-in: the scene already runs on the Mac lane alone, and runs only in a gate job on the Mac mini runner (binding 11). (2) *The collision:* a third scratch plugin of the second's manifest name and server name is installed and enabled; both rows read the collision's line, naming both, with no Sign in, before a session and with a new session that loaded both; turning one off brings Sign in back on the other after a new session. No sign-in in this step. |
| `e2e:widgets` | `e2e/widgets.spec.ts` | "a New chat lists its folder’s connectors, skills and plugins before the first message, and Use in chat inserts the skill": the dialog's line's words (the scene pins today's sentence); with a plugin in its stub home that declares a connector, the submenu and the dialog list it with "from <plugin>". |
| `e2e:settings` | `e2e/settings.spec.ts` | "Customize and Projects are reachable without a chat, at desktop and narrow widths" finds "Inventory coverage" by its summary, under the page's skills body: kept. |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | not edited. Whether the wire's minor asks for the group on this head is the architect's (Proof). |
| `default` (`e2e`) | | run because the renderer changed. |

### The record (in the same pull request, UC-10)

- **U11a's execution document**, under its §A: "2026-11-14, UX wave U11h (X-184): a plugin's connector listed in Customize signs in through `connectors.signInDynamicServer` with the revision of its own entry, only through a session whose own plugin list holds exactly one plugin of its manifest name, with its key, and whose server of that name has its transport and address (`docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md`, the sign-in rule)."
- **U11c's execution document**, under its §J: "2026-11-14, UX wave U11h: the connector row's second kind, `plugin`, and its identity are built as that landing's §E and §J state them."
- No ruling is reversed by X-184 (the child's "Rulings reversed" names none for it).
- At landing, by the architect: the register's row for X-184 and the tracker row of 2026-10-24 (its connector half); the child's "Waiting" entry "A plugin's connector that the engine drops" closes with §E's lines.
- **Six tracker rows** this landing opens (the architect's rulings), each with what would close it:
  1. *The residue G2.* "A sign-in from a plugin's row in Customize can land on another plugin's entry of the same engine name if the engine swaps the server under that name between MAWS's checks (twice, or to a server inside the row's declared address while the session's reported plugin list still shows the row's plugin alone). What a person would see: the consent page opens at the right address and the sign-in ends well, and yet the row's connector still reads 'Sign in needed', or the name shows another plugin's tools." Closes when the engine lets a sign-in name its server by more than its name, or reports a server's plugin.
  2. *A plugin list before a session's first message.* Sending `reload_plugins` at the press and reading its answer is not taken. Opens when a fixture shows that a reload of an unchanged set leaves running connectors and their sign-ins alone.
  3. *The version's form for a marketplace cloned from a repository* (Proof, P5).
  4. *The session's Connectors dialog* says nothing when the session's list holds more than one possible owner of a `plugin:` name.
  5. *A sign-in refused at its third check leaves the engine's flow standing* for up to 300 seconds, or until the next sign-in for that name. Opens the call that would end it (a callback URL with the flow's `state` and `error=access_denied`, through the existing submit path, at a point-3 failure and at no other end) when a recording shows a declined consent submitted through `mcp_oauth_callback_url` ending the flow.
  6. *A plugin's connector whose declared address is longer than 4096 characters is missing from Customize's list*, though the engine loads it: My items, its lines and Sign in never show it, and a new chat's lists before the first message leave it out (the architect's ruling of 2026-11-15: MAWS's endpoints carry an address of at most 4096 characters, and a cut address is another one). Closes when the endpoints' bound grows past such an address or an over-bound address gets a row of its own with no Sign in.

## Concrete Steps

From the worktree of branch `ux-wave/U11h`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11h --`.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Master must hold the probe (`ls spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt`), U11g (`grep -n "connectors.addJson" src/shared/ipc/names/connectors.ts` prints a line) and U11c (`ls src/renderer/src/customize/connectors/ConnectorRow.tsx src/renderer/src/customize/connectors/rows.ts`). If any is missing, stop and report: this document is written for a tree that holds all three. Its table of statements had its pass on master `ef1d659ad` (2026-11-15, UTC). Then read each file this document names that the merge changed against "What the code says today".

2. **Each milestone**, tests first where a test can fail first. Push before every check.

       git push -u origin ux-wave/U11h
       vmcheck 'timeout 900 pnpm exec vitest run <the milestone's paths, below>'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'   # main, the hosts, the services and shared code
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'    # the renderer; tsconfig.e2e.json for e2e/
       vmcheck 'timeout 600 pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11h at <short sha>` and then the command's output; its exit status is the command's. At a tests-first commit vitest fails on the new assertions; at the milestone's head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing.

   | | vitest | typecheck |
   |---|---|---|
   | M1 | `src/shared/ipc src/shared/machine src/shared/plugins src/engine-host/customization src/engine-host/plugins src/main/catalog test/endpoint/artifact-rows.test.ts test/lane-b/offer-coverage.test.ts src/renderer/src/customize` (the last for the four window test files; ruled 2026-11-15, UTC) | node, web |
   | M2 | `src/shared/plugins src/services/connectors src/services/spine-root.test.ts src/services/catalog` (the last hears `plugins.changed` through the same wiring) | node |
   | M3 | `src/renderer/src/customize src/renderer/src/widgets test/support/tokens-guard.test.ts` | web |

3. **M1, the wire.** In one commit that holds nothing else: set `WIRE_MINOR` one past the manifest's on the master last merged, with its history note, then make the generated files again on the VM and bring the result back. That number is a stand-in (K-10): this landing's minor is the next free number of the tree it is merged onto, taken at the chain merge in a commit of its own, by this same step.

       G='src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json src/shared/ipc/routes.json src/shared/machine/address-paths.json'
       vmcheck "pnpm wire:manifest >/dev/null; MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts >/dev/null; git diff -- $G; git checkout -- $G" > /tmp/u11h-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u11h-wire.patch | git apply

   Expect the patch to add `pluginServers` and `plugins` under the output of `commands.customization.inventory`, `pluginServers` under that of `commands.customization.serverEndpoints`, the minor, and a new value in `wire-fingerprint.json`; nothing in `routes.json` and nothing in `address-paths.json`. A changed `enum`, `maxLength` or `required` anywhere else in the patch means something other than an addition moved: undo it.

4. **M1 to M3 add fixtures and tests with configuration-shaped content.** Run the scan before each hand-back: `vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'`. A failure names the file; the cure is a plainer invented value, not an allow-list entry.

5. **M4, master again, then the whole checks.**

       git fetch origin master && git merge origin/master
       grep -n "export const WIRE_MINOR" src/shared/ipc/wire.ts | cut -c1-60

   If the merge conflicted in `wire.ts` or in a generated file, or master's minor is now this branch's or higher: keep master's comment, give this landing's addition the next number after master's, take master's side of the generated files, and run step 3's regeneration again, in a commit of its own. That number is a stand-in still (K-10). Then:

       vmcheck 'timeout 900 pnpm typecheck'
       vmcheck 'timeout 900 pnpm exec eslint src/shared/ipc src/shared/plugins src/engine-host/customization src/engine-host/plugins src/main/catalog src/services/connectors src/renderer/src/customize src/renderer/src/widgets e2e/discover-connectors.spec.ts e2e/widgets.spec.ts test/endpoint/artifact-rows.test.ts'
       vmcheck 'timeout 2400 pnpm test'
       vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 1200 pnpm exec vitest run src/shared/plugins src/shared/ipc src/engine-host/customization src/main/catalog src/services/connectors test/endpoint/artifact-rows.test.ts src/renderer/src/customize src/renderer/src/widgets'

   The last prints `Test Files … passed` with no failure, and is the one result the hand-back quotes for H1 to H10: the rule (H5, H6) by `src/shared/plugins` and `src/services/connectors`; H9 and H10 by the paths before `src/renderer`; the rest by the two renderer folders. In `pnpm test` the files the build brief lists as failing on master too are not this landing's.

6. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e, engine or probe. The hand-back says: what exists, with the command and result that showed it; the master the branch stands on and the stand-in minor it carries, named as a stand-in (K-10); what is not verified (every e2e scene; "What is not proven"); the decisions made; anything that contradicts this document; the residue. Residue known at authoring:
   - the guarantee's residue G2, as its tracker row words it (The record);
   - a session that has reported no plugin list cannot be signed in through from a row (ruled point 1; a tracker row);
   - the version comparison is run on one marketplace kind (a tracker row);
   - a connector a plugin ships as a bundle, or names by a URL where a path belongs, is not listed, and the note says so;
   - a plugin whose manifest is its marketplace entry (no `plugin.json` in its folder) lists only what its `.mcp.json` declares, if the inventory is not handed its marketplace's root;
   - a connector the engine drops for a reason MAWS does not compare (an address that differs only as written, or a later plugin's server that repeats an earlier plugin's) reads as needing a sign-in until a session shows it absent;
   - before a chat starts, a connector of a plugin turned off in Claude Code's own settings is listed until the chat starts (the "+" menu runs no plugin CLI);
   - the session's Connectors dialog says nothing of a collision (a tracker row);
   - a failure at point 3 leaves the engine's half-started flow standing for up to 300 seconds, or until the next call for that name (a tracker row);
   - a row whose engine name is longer than 128 characters cannot be signed in from MAWS at all, row or dialog.

7. **The architect's, after the hand-back.** Proof P1 to P5.

## Interfaces and Dependencies

### §A. A plugin's connectors in the inventory (M1)

    // src/shared/ipc/schema/customization.ts
    export const CustomizationPluginServerSchema = z.strictObject({
      plugin: z.string().min(1).max(256),             // the key, `<name>@<marketplace>`: installed_plugins.json's key, the id of its row in My items, a session's `source` for it
      pluginName: z.string().max(256).nullable(),     // the manifest name, by `pluginNameOf`; null: not readable
      server: z.string().min(1).max(256),             // the name the plugin's file gives the server, as written
      name: z.string().min(1).max(1024).nullable(),   // the engine's name, `plugin:<pluginName>:<server>`, whole; null when pluginName is null or the key ends `@builtin`
      installScope: z.enum(['user', 'project', 'local']),
      version: z.string().max(256).nullable(),        // the installation record's version
      path: AbsolutePath,                             // the file that declares it
      transport: CustomizationServerSchema.shape.transport,
      address: z.enum(['literal', 'templated', 'templated-origin']).nullable(),   // the shape of its address, never its text; null: it has none (a local command)
      sameAddressAs: z.string().max(256).nullable(),  // a `user`, `project` or `local` entry of this read with the same address, by its name
    });
    // CustomizationInventorySchema gains
    pluginServers: z.array(CustomizationPluginServerSchema).optional(),   // absent from an engine host of an earlier build; this build always sends it, empty where there is nothing
    plugins: z.array(z.strictObject({                                      // every installation kept for the folder, one per key, also a plugin that declares no connector
      plugin: z.string().min(1).max(256), pluginName: z.string().max(256).nullable(), installScope: z.enum(['user', 'project', 'local']),
    })).optional(),

    // customization.serverEndpoints' answer gains (main and the services only)
    pluginServers: z.array(z.strictObject({
      plugin: z.string().min(1).max(256), pluginName: z.string().max(256).nullable(), server: z.string().min(1).max(256),
      name: z.string().min(1).max(1024).nullable(), version: z.string().max(256).nullable(),
      path: AbsolutePath, transport: CustomizationServerSchema.shape.transport,
      url: z.string().max(4096).nullable(), revision: z.string().max(64).nullable(),
    })).optional(),

    // src/shared/ipc/schema/catalog.ts: catalog.postures' answer gains a list, row for row with pluginServers
    plugins: z.array(z.strictObject({
      plugin: z.string(), server: z.string(), path: z.string().max(4096),
      authPosture: z.enum(['auth_required', 'no_auth']).nullable(), fingerprint: z.string().max(64).nullable(), revision: z.string().max(64).nullable(),
      iconUrl: z.string().max(2048).nullable(),
    })),

**Why an array of its own and not a fifth scope:** an added enum member is a wire major ("What the code says", 3); the architect's ruling. In the window the row's kind is `plugin`. **The revision** is `configurationRevision`'s form (an HMAC under the host's key of the run) over the key, the installation's scope, folder and version, the engine name, the transport and the address. **No address, command or argument** is in the inventory's answer. **`plugins`** is there for the second net (the rule, "Before any session exists"): a plugin is a possible owner of an engine name by its manifest name alone.

### §B. The rule's functions and the check (M1 for the address's form, M2)

    // src/shared/plugins/plugin-connector.ts (pure, zod-free; read by the engine host, the services and the window)
    export type AddressForm = 'literal' | 'templated' | 'templated-origin';
    export function addressFormOf(url: string): AddressForm;
    /** Whether a live address is the declared one. `literal`: the same text. `templated`: the live address parses, its origin is the declared literal origin's, and its whole text matches the pattern. Never asked of `templated-origin`. */
    export function addressMatches(declared: string, live: string): boolean;

    export interface SessionPlugin { name: string; source: string | null; version: string | null }   // an entry of the session's plugin list
    export type PluginInSession = 'ok' | 'not-reported' | 'absent' | 'collision' | 'other-plugin' | 'other-version';
    /** The possible owners of an engine name among plugins: those whose `plugin:<name>:` is a prefix of it. */
    export function ownersOf<P extends { name: string }>(engineName: string, plugins: readonly P[]): P[];
    /** Rule (a). `observedAt` null: the engine has reported no list in this launch. */
    export function pluginInSession(row: { name: string; plugin: string; version: string | null }, plugins: readonly SessionPlugin[], observedAt: string | null): PluginInSession;

**`addressFormOf`.** An address with no `${` is `literal`. One with a `${` is `templated` only when it matches the strict form: the scheme `http` or `https` in lower case, then `://`, then a non-empty authority that holds no `$`, no backslash, no whitespace or control character and no `@`, ended by `/`, `?`, `#` or the end of the text. Anything else with a `${` in it is `templated-origin`. The declared literal origin is what the URL parser gives for the text up to the end of that authority.

**`addressMatches`** for a templated address: the live address is parsed with the URL parser, and one that does not parse fails; its origin equals the declared literal origin; and its whole text matches the declared text in which each `${…}` stands for one or more characters and every other character for itself.

**`pluginInSession`**, first that holds: `not-reported` (`observedAt` null); with `ownersOf(row.name, plugins)`: `absent` (none); `collision` (two or more); `other-plugin` (the one's `source` is not the row's key); `other-version` (both state a version and they differ); `ok`.

**The check**, for a press that names an entry and whose name starts `plugin:`. One function, asked at the three points of "The three points":

    // src/services/connectors/sign-in.ts: SignInDeps['check'], for a plugin's row
    check(request, point: 1 | 2 | 3): Promise<string | null>;   // why not, in §G's words, or null

| | at point 1 | at points 2 and 3 | on failure (§G) |
|---|---|---|---|
| read | `customization.serverEndpoints` at the session's own folder and `session.mcpStatus`, once, together; the kept plugin list and its `pluginsObservedAt`, which the operation remembers | `session.mcpStatus` afresh; the kept list | "that session’s configuration could not be read: <words>" (today's) |
| moved | | `pluginsObservedAt` is point 1's; no `plugins.operation` under way; no `plugins.changed` since point 1 | the sentence of the later points |
| (d) | among `pluginServers`, the entry whose `name` is the press's and whose `revision` is the press's; the operation keeps it | the kept entry | the changed sentence |
| (a) | `pluginInSession(entry, list, observedAt)` is `ok` | the same | point 1: the sentence of its verdict; later: the sentence of the later points |
| (b) | the status lists the name, with scope `dynamic`, source `plugin`, and the entry's transport | the same | point 1: "that session has no <name> server", or the different sentence; later: the sentence of the later points |
| (c) | the entry's form is not `templated-origin`, its `url` is not null (no such remote entry is listed since the architect's ruling of 2026-11-15; refused if one ever reaches the check), and `addressMatches(entry.url, live.config.url)` | the same | point 1: the launch sentence, or the different sentence; later: the sentence of the later points |

Every failure ends the operation with reason `other_entry`. Point 1's baseline read is judged by (b) and (c) before "already connected" is reported.

**The bound.** The engine lists a name of any length; MAWS's sign-in takes at most 128 characters (code, 7), so the window offers no Sign in for a longer engine name (`signsInDynamic`) and the command's own schema refuses one.

**What the check cannot see** is the guarantee's residue, G2.

### §E. A plugin's row (M3; U11c's §E extended)

    // src/renderer/src/customize/connectors/rows.ts: the model's second member, and its rows after the configured ones
    | { kind: 'plugin'; key: string; name: string | null; server: string; plugin: string; pluginName: string | null; installScope: 'user' | 'project' | 'local'; version: string | null; path: string; transport: string; address: AddressForm | null; sameAddressAs: string | null }
    // connectorRowKey for it: `connector:plugin:<plugin>:<server>`
    // connectorRows(inventory: Pick<Inventory, 'servers' | 'pluginServers'>): the configured rows in the inventory's order, then the plugins' by key and server
    // connectorRowsMatching (the page's search, under Show: Connectors and under All) and All's sort in MineAll.tsx read the name a row shows: `server` for a plugin's row;
    // the search also keeps a plugin's row whose plugin's name holds the text (K-4; ruled 2026-11-15, UTC)

| | a configured connector (U11c's row) | a plugin's connector |
|---|---|---|
| name shown | the configured name | `server` |
| after the name | "<scope> scope · <transport>" | "from <plugin>" (a button: `openMine('plugins', { pluginId: plugin })`; the plugin's name as its own row shows it where the plugin list holds it, else the part of the key before its last `@`) "· <transport>" |
| second line | the file's path | none |
| Remove | by scope | none |
| image | seed: its name | seed: `server`; `iconUrl` from its posture |
| marks | `data-connector="<name>"`, `data-connector-scope="<scope>"` | `data-connector="<server>"`, `data-connector-scope="plugin"`, `data-connector-plugin="<plugin>"` |

**Its state and Sign in**, first that holds; each line is muted and stands where the state stands, with no Sign in:

| | when | the row |
|---|---|---|
| 1 | `name` is null | "Its plugin’s name can’t be read, so it can’t be matched to a session." |
| 2 | `sameAddressAs` is not null | "Not loaded: same address as <name>" |
| 3 | the plugin list says its plugin is not enabled here | "Plugin turned off" |
| 4 | among the inventory's `plugins` enabled here, more than one is a possible owner of `name` | the collision's line, naming them |
| 5 | its transport is not one that signs in (code, 9) | the state from an admitted session's status, in the dialog's status words, if any; nothing else |
| 6 | an admitted session's status, or its posture, says it needs no sign-in, is connected, or the like | that state, as a configured row's |
| 7 | `name` is longer than 128 characters | "Its name is too long to sign in from MAWS." |
| 8 | `address` is `templated-origin` | "Its address is set when a chat starts. Sign in from that chat’s Connectors dialog." |
| 9 | a session is admitted | Sign in, through it; and "Not in the attached session" beside it when the attached session's status has answered without the server and the admitted session is another |
| 10 | sessions list the name but none is admitted | by the first of their verdicts in this order: `collision`: the collision's line, naming that session's possible owners; `other-plugin`: "That session loaded this connector’s name from another plugin."; `other-version`: "That session loaded another version of this plugin. Start a new session, then sign in."; `not-reported`: "Send a message in that session, then sign in." |
| 11 | no session lists the name | "Open a session, then sign in" (today's), and "Not in the attached session" when the attached session's status has answered |

An **admitted** session is a ready session MAWS runs on this Mac whose status lists `name` and for which `pluginInSession` is `ok`; the attached one first, then one in the page's folder, then by id.

**While the plugin list is unknown** (its read has not answered yet, or failed; the architect's ruling at the pre-build pass, 2026-11-15 UTC): **Sign in is offered only once the plugin list has answered.** Rows 3 and 4 are skipped. Rows 1, 2, 5 to 8, 10 and 11 hold as written. Row 9 offers no Sign in: the row shows the admitted session's state in the dialog's status words (`connectorStatusWords`), as row 6 words a state. "From <plugin>" shows the part of the key before its last `@` until the list holds the plugin, then the name its own row shows. No sentence of its own is drawn for this state, and when the list answers the row settles by the table. Under Show: Connectors the list is read only when the inventory holds at least one plugin's connector (M3's Decisions).

**A retained record gives text, never the action** (ruling E). An operation under way shows its step and Cancel, whatever the table says now. An ended record (a success, a failure, a cancel) shows its words only while no line of rows 1 to 4, 7, 8 or 10 holds; where one holds, that line is shown in the record's place. Sign in is offered only by row 9. So a failed or cancelled sign-in does not bring Sign in back by itself, and a success is not left standing over a collision or a plugin turned off.

**What a retained record is kept by.** Its key is today's for a dynamic connector, the machine and the engine name (`signInKeyOf`). What it is shown against changes for a plugin's row: the **row's revision** (§A: the key, the installation, the name, the transport, the address), where a configured row uses main's fingerprint of the transport and the address alone. `startSignInDynamic` is handed the revision in the fingerprint's place, `resultFor` compares it with the row's revision now, and a row whose revision changed drops the record (`forgetSignIn`). A revision lives for one run of the engine host, so a host restart drops every such record: the safe direction.

**A local command's row** (row 5) does not go through `signInViewOf`, which answers no state for it (code, 14): it reads an admitted session's status entry and words it as the Connectors dialog does (`connectorStatusWords`); with no admitted session it shows nothing after the transport.

### §G. Words

Ruled (ruling G9), but for the three marked *proposed*, which this revision adds for the architect's ruling.

| where | words |
|---|---|
| a plugin's row | "from <plugin>" |
| the collision's line (rows 4 and 10) | "More than one plugin supplies a connector with this name (<the plugins' names as My items shows them, comma-separated>). Claude Code keeps only one. Turn the others off to sign in." |
| rows 1, 2, 3, 7, 8 and "Not in the attached session" | as §E's table gives them |
| row 10 | "That session loaded this connector’s name from another plugin."; "That session loaded another version of this plugin. Start a new session, then sign in."; "Send a message in that session, then sign in." |
| `COVERAGE.now` (the folded note, an answer with `pluginServers`) | *proposed:* "Skills that a marketplace declares but no folder holds, and connectors that a plugin ships as a bundle or in another form MAWS does not read, are not listed; see Plugins." |
| `COVERAGE.before` (an answer without) | today's sentence, the wire constant's own text |
| `BEFORE_START.connectors` | "Configured for <place>. Connection state shows once the chat starts." |
| the services, points 2 and 3 | *proposed:* "Plugins changed while this sign-in started. Try again." |
| the services, (d) | "<name> changed since this page read it; refresh the page, then sign in" |
| the services, (a) at point 1 | `not-reported`: "that session has not reported its plugins yet; send it a message, then sign in"; `absent`: "that session loaded no plugin that supplies <name>"; `collision`: *proposed:* "more than one plugin in that session supplies <name>; turn the others off, start a new session, then sign in"; `other-plugin`: "that session loaded <name> from another plugin"; `other-version`: "that session loaded another version of this plugin; start a new session to sign in" |
| the services, (b) and (c) at point 1 | "that session has no <name> server" and "this session uses a different <name>; start a new session to sign in" (both today's); `templated-origin`: "<name>’s address is set when a chat starts; sign in from that chat’s Connectors dialog" |

`CUSTOMIZATION_INVENTORY_COVERAGE` keeps its value; its comment says it is a mark on the wire and that the window words the note.

### §H. What is stored or sent, and what build F does with it

**Stored: nothing.** The services' kept plugin list and their marks of what moved, the revision, and the window's retained records live in memory for a run. No layout key, no settings key, no file: the cross-build coverage table gains no row.

**Sent between builds: three optional properties, one minor.**

| what | this build's sender, F's receiver | F's sender, this build's receiver |
|---|---|---|
| `pluginServers` and `plugins` on `customization.inventory`'s answer | F's main reads its engine host's answers with `readTolerant` and drops the keys (with the others it does not know); F's window is answered as today | absent: the window lists none and words the note as `COVERAGE.before`, which is true of that host |
| `pluginServers` on `customization.serverEndpoints`' answer | the same; F's postures are as today | absent: `catalog.postures` answers an empty `plugins`; the services find no entry and refuse a press with the changed sentence |
| the coverage warning's string | unchanged: F's window folds it as today | unchanged |
| `connectors.signInDynamicServer` with an entry for a `plugin:` name | its schema is unchanged. F does not know the command and answers `unknown_command`; a services build from U11a to before this landing looks the name up among MAWS's own entries, finds none and refuses: safe, and not a build anyone returns to | n/a |
| `session.status`, `plugins.operation`, `plugins.changed` | unchanged: the sign-in service reads two more fields of the first and newly hears the other two, all already sent | unchanged |

### §I. Routes (law 5), and other machines

Customize is this Mac's (bindings 9 and 14). What this landing sends:

| command | new or changed | where it goes | holds |
|---|---|---|---|
| `customization.inventory`, `customization.serverEndpoints` | two optional output properties | this Mac's engine host | names, transports, file paths and an address's shape to this Mac's window; addresses to this Mac's main and services only. No offer row exists for either; M1's case shows `not-offered` to a caller on another machine |
| `catalog.postures` | one more list | this Mac's main | as today |
| `connectors.signInDynamicServer` | unchanged; now also pressed from a plugin's row | the services of the session's machine, and the session is always one of this Mac's (the row is handed this Mac's ready sessions only) | the engine name and the revision |

| route | what this landing changes |
|---|---|
| a session MAWS runs on this Mac | it can be the session a row signs in through; a new chat here lists a plugin's connectors before its first message |
| a terminal session on this Mac | nothing: Customize signs in through sessions MAWS runs (the child, l8-settings-01: a terminal session offers no command to authenticate) |
| a session on another machine | nothing: never offered to a row; a new chat set to another machine says "Shown once the chat starts on <machine>" and reads nothing of this Mac. Its own dialog's sign-in is U11f's |

### §J. What the connector-switch landing reads from this one

- **A plugin's row**: the `plugin` member of `ConnectorRowModel` and its key, `connector:plugin:<plugin>:<server>`.
- **Its identity, three names kept apart**: `plugin`, the key it is installed by; `pluginName`, the manifest name; `name`, the engine's name, which is what a session's status reports and what the engine's own switch is keyed by. That the engine uses the manifest name is run (engine facts, 1); so that draft's open check 10 is answered, and a plugin whose two names differ is resolvable. `name` is null only where the manifest cannot be read or the plugin is built-in.
- **A collision is visible from here** (§E, row 4): two rows of one engine name are one switch in the engine.
- **`installScope`**: which projects a plugin's connector reaches. **`sameAddressAs`**: a row the engine will not load.
- From U11c, unchanged: the row component and its named parts, `connectorRows`, the page.

### §K. Dependencies on other landings

Consumed. **U11a**: `connectors.signInDynamicServer`, `dynamicRefusal`, `holds`, `configurationRevision`, `pluginNameOf`, `startSignInDynamic`, `signsInDynamic`, `signInKeyOf`, `resultFor`, `useSignIns`, `signInViewOf`, `usedEntries`, `useTabPlace`, `useCustomizationInventory`, `BEFORE_START`. **U11c**: `ConnectorRow` and its `partsOf`, `ConnectorRowModel`, `connectorRows`, `connectorRowsMatching`, `connectorRowKey`, `useConnectorRowFacts`, `ItemImage`, the postures' `iconUrl`, `openMine`, the place's reads and `Manage` (`usePlace`), `usePluginsLibrary` (K-1 to K-8). **U11g**: its `not-offered` case's place (K-11). The wire's minor before this one is not U11g's any more: it is whatever the tree this landing is merged onto holds (K-10). **U6a, U8a, U3a, U13a, U9, U8b**: nothing; no action id, no stored key, no act on a session of another machine, no offer.

Exposed: §A's rows; `addressFormOf`, `addressMatches`, `pluginInSession`; the check's new branch; the row's second kind.

## What is not proven

| | what | what it could change |
|---|---|---|
| N-1 | A collision between a plugin enabled in the user's settings and one enabled only in a project's or the local settings (engine facts, 4) | nothing: the rule refuses every collision, whichever wins |
| N-1b | Two different manifest names that build one engine name, through a colon in a manifest name (engine facts, 12): read from the engine's source, not run | nothing: the rule is on the engine name and refuses it either way |
| N-1c | When the engine's own reconciling of plugins fires (engine facts, 11): read, not run | nothing in what is enforced; it is why G2 is a residue |
| N-2 | Whether a session's `version` and the installation's are written in one form for a marketplace cloned from a repository (engine facts, 3) | a false refusal from the row for such plugins (ruled point 2; a tracker row) |
| N-3 | The name of a built-in plugin's connector (read, not run) | nothing here: its engine name is null |
| N-4 | Whether the engine's status reports a remote server's headers, and whether a loser's credential could serve a winner | nothing in the rule: the engine keys a credential by address and headers, and the rule requires the address |
| N-5 | A swap of the server under the name between two passing checks | the residue, G2 |
| N-5b | Whether a callback URL that carries the flow's `state` and an `error`, submitted through `mcp_oauth_callback_url`, ends the engine's flow at once (engine facts, 13: read, shown in no record) | only what a failure at point 3 leaves in the engine: a half-started flow that the engine's own timer ends after 300 seconds, or the next `mcp_authenticate` for that name replaces. While it stands, with MAWS's redirect the engine has no listener open for it; with the engine's own loopback its listener on `127.0.0.1` takes `/callback` with the flow's state only, and closes at the 300 seconds. MAWS has opened no browser for it, so no consent page is out |
| N-6 | That a later engine still reports no plugin list before a first turn | only how often the row says "Send a message…" |

## Proof that an executor does not run

| | what | when | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **The sign-in scene**, in a gate job on the Mac mini runner (binding 11) | after M4's hand-back | `e2e:discover` with the "dynamic" scene's first new step: the real engine under a scratch configuration directory and the scene's own Keychain custody, a second OAuth fixture in engine mode at an address of its own for the step's own scratch plugin (ruling F), and whatever switch the gate needs for an engine sign-in on that runner. Never on the MacBook in any form. The step gives its session a turn by `/cost`, which calls no model and costs nothing | that a plugin's row, not signed in by any earlier step, signs in through MAWS's redirect with the browser hand-off and the consent exchange seen at its own fixture, and ends signed in; a red step goes back as a fix. The run's record names the engine's version, since the facts here were run on 2.1.322 |
| P2 | **The other scenes**, on a Mac under the load rule | after M4 | the collision step of the same scene (no sign-in) and `e2e:widgets`' scene alone first; then `e2e:discover`, `e2e:widgets`, `e2e:settings` and `default` | verdicts by group |
| P3 | **The branch review** | after M4 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11h` (Decision Log) | a verdict and findings; the fixes are one wave |
| P4 | **Class 1a** | on the head handed back, and on the final head | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11h`, in the background; whether the wire's minor also asks for the cross-build group with build F as the peer is the architect's | the run's id |
| P5 | **One more probe case, not a gate** (ruled point 2) | any time | engine `2.1.322`, a scratch home, a plugin installed from a marketplace cloned from a repository: its `version` and `path` in the session's plugin list against `installed_plugins.json` | the version comparison stays, or its one branch goes |

## The owner's look

No drawn example is needed before the build. The row was drawn with the Customize page ("tides · from Tide Tables", frames 1, 2 and 7 of that example) and the owner chose full rows. What no frame drew is the nine lines of §E's table; they are words in a state's place, ruled in §G but for the three it marks as proposed, and are shown to the owner on the built page at the wave's sitting.

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, landing U11h" and the parent pin; names the probe it rests on, its class 1a run, its review verdict and its residue (Concrete Steps 6); states the guarantee in its two parts, G1 as enforced and G2 as the residue in the words of its tracker row, the rule's four parts and three points, and what is not proven; names the five tracker rows it opens; and lists the dated lines it carries ("The record"). It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

- Observation: nothing a session says of a plugin's server names its plugin; only the session's plugin list does, through the name.
  Evidence: the findings, 2; the record [2], `status.servers[].keys` and `init.plugins`.
- Observation: the plugin list the rule needs is already delivered to the services and the window; the sign-in service narrows it away.
  Evidence: `onSessionStatus` in `src/services/connectors/sign-in.ts` against `EngineSessionStatus.plugins` in `src/shared/engine/status.ts`; the wiring in `src/services/spine-root.ts`.
- Observation: a session reports the plugin's folder in its marketplace, not the folder the installation records, so the two paths cannot be compared; their versions can.
  Evidence: the record [1] `installedEntries` (`installPath` under the plugin cache) against [2] `init.plugins` (`path` under the marketplace).
- Observation: the engine name does not name one plugin even when manifest names differ, because a manifest name may hold a colon; and the engine changes a session's plugins by itself. So ownership is a rule on the engine name, and what MAWS can enforce is the address and the reported owner, not the server's identity.
  Evidence: `cli.pretty.js:953562` (the manifest name's rule), `:611574-611578`, `:611791`, `:611797`, `:614201` (2.1.322), read; the adversarial review's findings 1 and 2.
- Observation: the operation waits three times between its check and the engine's call, and opens the browser itself after the answer; and a retained failed result offered Sign in before anything else was asked.
  Evidence: `run` and `authenticateInOrder` in `src/services/connectors/sign-in.ts`; `signInViewOf` in `customize/connectors/present.ts`.
- Observation: a session has no plugin list before its first turn, though its status already lists its servers, and the `initialize` answer has none either.
  Evidence: U11a's document (gate run 43386195217); the probe's method, which sends `/cost` to get `system/init`.
- Observation (the pass, 2026-11-15 UTC; K-1 restated): the row's one place for what depends on the kind is `partsOf`, and it is not the only place that reads the kind's fields: the marks, the seed, the name drawn, the buttons' names and the choice of press read the configured member directly, and so does `useConnectorRowFacts`. The second member is a second `case` and a branch at each of those.
  Evidence: `ConnectorRow.tsx` (`partsOf`; the `<li>`'s `data-connector` and `data-connector-scope`, `ItemImage`'s `seed`, `C.signInName(row.name)`); `useConnectorRowFacts` in `ConnectorsSection.tsx` (`shadowedBy(row, servers)`, `row.scope === 'app'`, `liveOf(row.name)`, `postureOf(row)`).
- Observation (the pass, 2026-11-15 UTC; K-2 restated): `connectorRows` takes the inventory, and the Connectors list is not handed one: it gets the answer's `servers` and wraps them. What that list is handed widens in M3, in `customize/bodies.tsx`.
  Evidence: `ConnectorsBody` in `customize/bodies.tsx` (`servers={inventory.data?.servers}`); `Configured` in `ConnectorsSection.tsx` (`connectorRows({ servers })`); `MineAll.tsx` (`connectorRows(inventory.data)`).
- Observation (the pass, 2026-11-15 UTC; K-6 restated): the page's place holds the inventory, the attached session and the one `Manage`, and not the plugin list, the status read or the postures. The plugin list is a hook the Plugins body and All each call and the Connectors body does not; the postures are read only while the folder has a configured server. So M3 touches `bodies.tsx`, `MineAll.tsx` and `discover/read.ts`; whether the Connectors list reads the plugin list, and what a row reads while it is out, went to the architect, who ruled the same day (Decision Log).
  Evidence: `Place` and `CustomizePlace` in `customize/place.tsx`; `usePluginsLibrary` in `widgets/PluginsWidget.tsx`, called by `PluginsAt` (`bodies.tsx`) and `MineAll`; `useCatalogPostures` in `customize/discover/read.ts` (`enabled: servers !== undefined && servers.length > 0`).
- Observation (the pass, 2026-11-15 UTC; K-10 restated): the wire's minor on master is not U11g's any more, and it will move again before this landing lands; the wire's own test makes a branch that adds to the wire carry some number meanwhile. So the number is taken at the chain merge, in a commit of its own, and what the branch carries before that is a stand-in in one commit.
  Evidence: `export const WIRE_MINOR` in `src/shared/ipc/wire.ts` on master `ef1d659ad`; `verdict` in `src/shared/ipc/wire.test.ts` ("bump WIRE_MINOR to … and run pnpm wire:manifest").
- Observation (the pass, 2026-11-15 UTC): a required property added to an answer of main's reaches every renderer test that scripts that answer, because the window checks each answer against its schema. §A's list on `catalog.postures` is such a property, added in a milestone that does not touch the window.
  Evidence: "What the code says", 16; U11c's document, Surprises, M1; the four test files named there.
- Observation (M1): "What's inside" (`manifest.ts`'s `serversOf`) reads a server of type `streamable-http` as `unknown`, while the inventory reads it as `http`, as for a configured server; a plugin's row and its "What's inside" line can name two transports for one server. Outside this landing's edge (`manifest.ts` is unchanged); residue.
  Evidence: `serversOf` in `src/engine-host/plugins/manifest.ts` (keeps `stdio|http|sse|ws`) against `transportOf` in `src/engine-host/customization/inventory.ts`.
- Observation (M1): the catalog's machine half tells whether the MCP configuration moved by `serverEndpoints`' `servers` alone (`serversOf` in `src/services/catalog/engine-reads.ts`), so a change to a plugin's connectors does not invalidate a held catalog view. No catalog state rests on a plugin's connectors today; noted only.
  Evidence: `src/services/catalog/engine-reads.ts`.
- Observation (M2): two of M2's (c) cases cannot be built as worded for an address in the strict form: a live address whose parsed origin differs though its text matches the pattern, and one that does not parse. The strict form's declared text is literal from the scheme through the authority's end, so any live text that fits the pattern begins with that head, parses, and has the declared origin. The origin and parse comparisons stay as §B states them (defence in depth) and are tested with live addresses that do not fit the pattern.
  Evidence: `addressFormOf` and `addressMatches` in `src/shared/plugins/plugin-connector.ts`; task-2 report.
- Observation (M2): a reload's `pluginsObservedAt` is stamped with the wall clock to the millisecond, `system/init`'s with the frame's own time; a reload in the same millisecond as point 1's report would not move it. (a) still judges the list itself; noted only.
  Evidence: `applyReload` (the engine host's session status).
- Observation (M2's fix): U11a's other presses (no entry; MAWS's own list) keep a cancel window a few microtasks wide between `ask`'s liveness check and the operation resuming on the engine's answer; the plugin press closes it (the re-check after point 3). Left as it is (law 8: those paths are unchanged); one liveness check after the answer would close it for every press. Residue.
  Evidence: `run` in `src/services/connectors/sign-in.ts` (the post-answer guard applies when `op.kept !== null`); task-2 report, Fix 1.

## Decision Log

- Decision: the verification this landing gets. This document gets an adversarial review before an executor starts; the architect dispatches it, and sends the document back once for the pass over "Statements to check again". Each milestone is reviewed at its boundary: M1's and M2's before M3 consumes them, and M2's alone, since it is the rule. The branch gets `doperpowers:review-code` at the **xhigh panel**: by the architect's ruling it is reviewer-high at least, because the rule touches credentials across plugins, and the panel if it passes about twenty files; by this document's count it is about 41 files and about 2,900 lines. The panel's lenses: (1) G1 with the three check points: no browser is opened and no sign-in reported for a server whose address when the engine answered is outside the row's declared address, or while the reported list shows no owner, another owner or more than one; try the collision in both orders and the colon pair, a plugin with another key, the strict-authority cases and a pattern that matches too much, a stale revision, a list not yet reported, a swap in each of the three waits, a retained result on a row that is now blocked, a press with the window bypassed; and that U11a's two other presses are untouched; (2) what crosses: no address, command or argument in anything the window receives; nothing to another machine; (3) the two builds: the minor is additive, both tolerant directions, the coverage mark; (4) the row's words against what the code knows at that moment: no line claims more than was observed, and the collision's line names the remedy; (5) the tests: each "held open" case holds its sequence open. Class 1a on GitHub Actions is the gate of record.
  Rationale: the root gives the panel to a branch of panel size (UC-10); the first lens is the reason this landing was cut out of U11c.
  Date/Author: 2026-11-14, the author of this document.
- Decision (the architect's rulings, 2026-11-14 UTC, carried from U11c's review and written on the probe's findings): the sign-in rule in its four parts, with the inventory-side check as a second net for the row's words; "fails safe" is not a reason anywhere; the probe is a gate and has answered; "Not in the attached session" is information; the rows travel as an optional array and the coverage string stays a mark; the wire's minor is the next free one at the chain merge; the two-builds test is over representative answers; the name is proven for marketplace plugins and null for a built-in one; a row whose engine name MAWS's schema cannot carry is listed with no Sign in; "Plugin turned off" covers all three scopes; the collision's line says the reason and the remedy.
  Date/Author: 2026-11-14 (UTC), the architect; recorded by the author of this document.

- Decision (the architect's rulings on this document's adversarial review, 2026-11-14 UTC; five findings, each read by the architect in the code and accepted; revised once, in place). By the rulings' letters:
  - **A · The guarantee is restated**, everywhere the first version wrote "a press from a row can never reach `mcp_authenticate` for another plugin's server": G1 is enforced (the address when the engine answered; the reported owner), G2 is a residue that an unmodified engine does not let MAWS close, named in this document, the pull request's body and one tracker row, which also says what a person would see. "The length of one call" is withdrawn.
  - **B · Part (a) is a rule on the engine name:** among the session's reported plugins, those whose `plugin:<manifest name>:` is a prefix of the row's engine name are exactly one, with the row's key. Two manifest names that build one name are refused like two plugins of one name. The window's second net uses the same test over the enabled plugins of the page's folder, for which the inventory names every plugin it keeps.
  - **C · The check runs at three points:** at the press; inside the queued call immediately before `session.mcpAuthenticate`; after the engine's answer and before `openExternal` or the end with no browser. Points 2 and 3 also require that nothing moved since point 1. Each point has its own named unit tests, built so that removing that point's check fails them (the architect's addition).
  - **D · The strict form of a templated address,** and the parsed origins compared at the check.
  - **E · A retained result never gives Sign in back** on a plugin's row; a blocking reason replaces an ended result, success included; a record is kept against the row's revision.
  - **F · The row's sign-in scene has its own scratch plugin, server and fixture address.**
  - **G · The nine reported points,** as "Reported to the architect, and ruled" gives them, with the collision's line in the one form that covers two manifest names.
  - **H · The rung stays the xhigh panel;** its first lens is G1 with the three points, and its cases include the colon pair, the strict-authority cases and the retained-result cases. Sizes re-estimated: about 2,900 lines in about 41 files.
  Rationale: the first version promised more than an unmodified engine lets MAWS keep, checked once where the operation waits three times, and judged ownership by a name that a colon makes ambiguous.
  Alternative rejected: keeping the single check and calling the remainder a short race; the review showed the waits are as long as an earlier sign-in's.
  Date/Author: 2026-11-14 (UTC), the architect; revised by the author of this document.

- Decision (the architect's, 2026-11-14 UTC, on a reading of the engine's source; engine facts, 13): what a failure at the third check does to the engine's flow. The engine's control protocol has no call that ends a sign-in flow, and `mcp_clear_auth` is not one and is never used for it. The flow could be ended through the callback handler, by a callback URL of MAWS's own with the flow's `state` and `error=access_denied`; that call was to be written only if a record or an existing scene showed a declined consent, submitted through the session's callback-URL command, ending the flow. **None does**: the recorded sign-in fixture holds only callbacks that carry a code, the declined branch of `submit` is pinned against a stand-in host alone, and no scene declines a consent on the engine's flow. So this document takes the second branch: **no such call is written**; the flow is left to the engine's 300-second timer or to the next `mcp_authenticate` for that name; "What is not proven" (N-5b) says so with what stays open meanwhile (no listener with MAWS's redirect; with the engine's loopback, `/callback` with the flow's state only, closed at 300 seconds); and one more tracker row carries the call and what would open it.
  Rationale: a path read in source and never seen run is not built on (law 6); the cost of not building it is a flow that ends by itself, with no browser opened.
  Date/Author: 2026-11-14 (UTC), the architect; recorded by the author of this document.

- Decision (the pass over "Statements to check again", 2026-11-15 UTC). Master `ef1d659ad`, which holds U11g and U11c, is merged into this branch, and the twelve statements, "What the code says today" and each milestone's named files were read against it. Restated in place, with the places that rested on them: K-1 (M3's decision on the row's second branch), K-2 and K-6 (M3's Touches: `customize/bodies.tsx`, `customize/MineAll.tsx` with its test, `customize/discover/read.ts`, `widgets/SkillsWidget.tsx` as a caller), K-10 (M1's decision on the minor, Concrete Steps 3, 5 and 6, the constraint on files others own, §K). Worded more exactly, the statement holding: K-4 (§E's note on the search and All's sort), K-7 (M1's case for a plugin's posture), K-8, K-9, K-11. The sizes follow the files: M3 about 21 files and about 1,000 lines, the landing about 46 and about 3,000; the rung does not move. Three points are more than a moved name and are not decided here: the plugin list under Show: Connectors, `catalog.postures`' new list against the window's check of every answer, and the search by a plugin's name under Show: Connectors. Each is under the table with the one place a ruling changes. The architect ruled on all three the same day: the three entries after this one.
  Rationale: the pass replaces what this document knew from two other documents by what the code holds; a difference that changes what a person sees, or what a milestone leaves green, is the architect's (the build brief, "What is yours to decide, and what goes back").
  Date/Author: 2026-11-15 (UTC), the author of the pass.

- Decision (the architect's ruling at the pre-build pass, 2026-11-15 (UTC)): the plugin list under Show: Connectors. The Connectors body mounts the plugin list read (`usePluginsLibrary`) only when the inventory holds at least one plugin's connector, so a person with none pays no read. While that list is unknown (not answered yet, or failed): rows 3 and 4 of §E's table are skipped; rows 1, 2, 5 to 8, 10 and 11 hold as written; row 9 offers no Sign in and the row shows the admitted session's state in the dialog's status words, as row 6 words a state; "from <plugin>" shows the part of the key before its last `@` until the list holds the plugin, then the name its own row shows. When the list answers, the row settles by the table. In one sentence: Sign in is offered only once the plugin list has answered. No new sentence is drawn for the unknown state. Its tests hold the sequence open (list out; answers enabled; answers not enabled; fails) and show that the read is not mounted when `pluginServers` is empty or absent. Written in M3's Decisions, Touches and tests, and §E.
  Date/Author: 2026-11-15 (UTC), the architect; recorded by the author of the pass.
- Decision (the architect's ruling at the pre-build pass, 2026-11-15 (UTC)): `catalog.postures`' `plugins` list stays required, since the window and main are one build. M1 adds `plugins: []` to the four scripted answers (`customize/CustomizeView.test.tsx`, `MineAll.test.tsx`, `CustomizePage.test.tsx`, `discover/DiscoverAll.test.tsx`) and adds `src/renderer/src/customize` and the web typecheck to its checks; M1's "Does not touch. The window" becomes "touches no window source; four window test files gain the new key". Written in M1's Touches, Decisions, "Does not touch" and tests, and in Concrete Steps 2. M1 counts about 19 files, the landing about 50.
  Date/Author: 2026-11-15 (UTC), the architect; recorded by the author of the pass.
- Decision (the architect's ruling at the pre-build pass, 2026-11-15 (UTC)): the page's search finds a plugin's connector by its plugin's name under Show: Connectors as under All, with a test for each list. Written in M3's Decisions and tests, and §E.
  Date/Author: 2026-11-15 (UTC), the architect; recorded by the author of the pass.

- Decision (the executor's pre-flight, 2026-11-15 (UTC)): the run's brief says the executor merges nothing; when a merge is due the architect names the head (`chain-merge.md`). So Concrete Steps 1's merge is moot (the branch at `c12eec1e5` holds `origin/master` `ef1d659ad`, which had not moved at the start: `git rev-list --count HEAD..origin/master` printed 0), and Concrete Steps 5's merge of master in M4 is not made by the executor: M4 runs its whole checks on the master the branch holds, and the stand-in minor stays 49 (48 on `ef1d659ad`) until the architect names a head. The milestones run in order, each reviewed before the next dispatches (M2 consumes M1's endpoints, M3 both, M4 the branch), and every worker reads the common build brief and the run's brief beside this document.
  Rationale: the run's brief binds the executor where it is narrower than this document's steps; the merge is the chain merge's, which also takes the final minor (K-10).
  Date/Author: 2026-11-15 (UTC), the executor (controller of the run).

- Decision (M1's executor, 2026-11-15 (UTC); folded by the controller). The means M1 left open: (1) the inventory's own `Reading` follows "What's inside"'s rule (`manifest.ts` is not extended), since only `Reading` keeps `INVENTORY_BOUNDS` and the skills' confinement; a parity test runs `readManifestView` on one invented plugin that declares servers all three ways plus a bundle, a URL, a file outside and an escaping link, and both name the same four servers in one order. (2) Only the first installation of a key kept for the folder, in the file's order, gives that key's `plugins` entry and servers; a second installation adds nothing, a server name the first lacks included (the engine loads one plugin per key). (3) A bundle, a URL where a path belongs, and an absent declared file add no warning; a declared file outside the plugin, or of an unreadable shape, warns in the inventory's existing words, as a skill's declaration does. (4) The revision covers both the installation's `installPath` and its `projectPath` as "its folder", under a `plugin` domain tag so it cannot equal a configured row's. (5) A server name or key empty or over 256 characters is not listed; a version that is not a string or is over 256 is null (not stated, so (a) skips it); a url is cut at 4096 as a configured one is, and its form and the revision are of that text (a cut address matches no live one). (6) `addressFormOf` also requires the URL parser to accept the literal origin (`https://[::1/${X}` is `templated-origin`): §B defines the origin as what the parser gives. (7) Names: `CustomizationPluginEndpointSchema` (§A's endpoint item), `pluginPosturesOf`, `pluginConfigurationRevision`, `installedSkills` renamed `installedPlugins`, the two-builds test `src/shared/ipc/customization-builds.test.ts`; the barrel `src/shared/ipc/schema.ts` gains two type exports.
  Rationale: each follows the nearby rule it names (the inventory's bounds; one plugin per key in the engine; the inventory's warnings drawn as "could not be read"; a revision that moves with every part (d) names).
  Date/Author: 2026-11-15 (UTC), M1's executor; folded by the controller.

- Decision (the controller, on M1's task review, 2026-11-15 (UTC)): **`sameAddressAs` compares only the entry the engine uses for each name.** The engine merges the file-configured servers by name before it drops a plugin's server of the same address (`cli.pretty.js` 2.1.322: the merge `{ ...user, …, ...local, … }` at about 477063, then the suppression `Iys` at 476051 over the merged map), so a `user` entry overridden by a `local` entry of the same name is not loaded and drops nothing; M1's first wording ("an entry of the same read") would have shown "Not loaded" on a row the engine loads. The rank is `usedEntry`'s (`src/shared/plugins/connector-precedence.ts`) over the read's file entries; MAWS's own list stays out (the dedup findings: the launch's list is not checked). And, on the review's Minor finding: a declared address over the endpoints' bound of 4096 is compared, classified and put in the revision whole, so a cut text never equals another address and a change past the bound still moves the revision. The endpoints' `url` of such an address is null, not cut (the re-review: a cut `url` would admit a session whose live address is that prefix), and (c) refuses a remote entry whose `url` is null.
  Rationale: the decision's purpose is "a row the engine will not load" (§J); the engine's merge decides which entries load. Told to the architect as a checkpoint.
  Date/Author: 2026-11-15 (UTC), the controller.

- Decision (M2's executor, 2026-11-15 (UTC); folded by the controller). The means M2 left open: (1) the sign-in service's two new inputs (`onPluginsOperation`, `onPluginsChanged`) are optional on its deps, so U11a's harnesses run unedited; the root always passes both, pinned by `spine-root.test.ts`. (2) What point 1 found (the entry, `pluginsObservedAt`, the count of `plugins.changed`) is kept in a box the operation creates and passes to the check only for a press held to the rule, so U11a's assertion on the check's request is unchanged. (3) "Moved" is a count of `plugins.changed` heard and a set of runner operations not yet `done` (any other phase adds; the set is cleared when the engine host leaves ready). (4) Point 1's baseline is judged in the operation, by the same pure refusal over the entry point 1 kept; a held press that reached it with no kept entry fails `engine`, never proceeds unjudged. (5) A remote entry whose `url` is null is refused at (c) with the "different" sentence (the window's side went to the architect, who ruled that such a connector is not listed: the entry after this one). (6) A status read that fails at point 2 or 3 reads today's "that session's servers could not be read: <words>", not "Plugins changed": a failed read is not a change. (7) The kept list is read after both of point 1's reads have answered. (8) The rule's service tests and the three points are in `src/services/connectors/sign-in-plugin.test.ts`. (9) A templated address is matched without a regular expression, so a hostile declared address cannot stall the services; a `${` never closed is literal. Names: `heldToRule`, `CheckPoint`, `Kept` (`sign-in.ts`); `pluginEntryOf`, `pluginEntryChanged`, `pluginOwnerRefusal`, `pluginServerRefusal`, `PLUGINS_CHANGED` (`sign-in-entry.ts`).
  Rationale: each keeps U11a's paths unedited (law 8) and the check one function at three points.
  Date/Author: 2026-11-15 (UTC), M2's executor; folded by the controller.

- Decision (the architect's ruling, 2026-11-15 (UTC)): **a plugin's connector whose declared address is longer than 4096 characters is not listed** by the inventory, in `pluginServers` of either answer, by the same rule M1 applies to a server name or key past its bound; no new sentence, no wire change. Where a row is listed its address is compared, classified and put in its revision whole, as before. One tracker row states the residue in a person's terms (The record, row 6). Asked by the controller after M2 showed that such a row would offer Sign in in the window (its form is `literal`) while the services refuse it with a sentence whose remedy does not help.
  Date/Author: 2026-11-15 (UTC), the architect; recorded by the controller.

- Decision (the controller, on M2's task review, 2026-11-15 (UTC)): two corrections the review showed with focused reproductions on the VM. (1) **The baseline's "already connected" is held to (a) and to "nothing moved"** as well as (b) and (c): point 1 can pass with one owner, a status event can report a collision while the baseline read is out, and the first wording ("judged by (b) and (c)") would then report a sign-in while the last reported list shows two possible owners, against G1. (2) **A cancel between a passing check and its side effect is honoured**: the operation re-confirms it is live after point 2's check before sending and after point 3's check before acting on the answer. Both have held-open regressions.
  Rationale: G1 forbids reporting a sign-in while the reported list leaves the owner in doubt; "already connected" is such a report. A cancel's promise (code, 13) is that nothing more is done.
  Date/Author: 2026-11-15 (UTC), the controller.

## Outcomes & Retrospective

Pending — written at finish.
