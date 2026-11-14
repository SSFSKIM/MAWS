# UX wave · U11h · A plugin's connectors under My items, with Sign in (2026-11-14)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11** (`docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`), landing **U11h**, parent pin master `c6a22fe89722dcbed4f5ff1e5f290a7fdaeb2933`.
> **Where the design is.** The child's item "X-184", with Acceptance A20, its "Waiting" entry "A plugin's connector that the engine drops", and bindings 8, 9, 11 and 14 of its Design inheritance. The child's table of landings gave X-184 to U11c; the architect cut it out on 2026-11-14 into this landing, because its sign-in rests on engine facts that no fixture held and on a rule about credentials across plugins (U11c's Decision Log). Those facts are now run: `spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt` with its record `spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn.ndjson`, which lands on master as its own pull request before this landing is built. The sign-in rule below is the architect's ruling on those findings.
> **Branch:** `ux-wave/U11h`, from the parent pin; master is merged in before anything is built (Concrete Steps, 1). **Stands on:** U11a (on master), and on **U11g** (`docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md`) and **U11c** (`docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md`), neither on master at this writing: this document is written for a tree that holds both ("Statements to check again").

## Purpose

A connector that a plugin brings is listed today only while a session runs in that folder, in that session's own dialog. A person whose connectors come mostly from plugins sees few of them in Customize, and can sign one in only from a chat.

After this landing My items lists a plugin's connectors with the others, with no session running, as "<server> · from <plugin>", under Connectors and under All, and a new chat's "+" › Connectors lists them before its first message. A row that needs a sign-in offers Sign in while a session MAWS runs on this Mac provably holds that plugin's server; where it cannot be proven, the row says in one line why, and what resolves it. The proof matters because the engine names such a server by the plugin's manifest name alone: two plugins can build one name, the engine keeps one of them and says nothing, and a row must never sign in another plugin's server.

How to see it working: Acceptance, H1 to H10.

## Progress

- [x] (2026-11-14) This document written against master `c6a22fe89`, from the draft parked when X-184 left U11c, the architect's rulings on it and the probe's findings; U11c's document read on `origin/ux-wave/U11c` at `876230bae`, U11g's on `origin/ux-wave/U11g`.
- [ ] The adversarial review of this document (the architect dispatches it).
- [ ] The probe's pull request on master.
- [ ] The one pass over "Statements to check again" once U11g and U11c are on master.
- [ ] M1 — The inventory lists a plugin's connectors.
- [ ] M2 — The rule: a press from a plugin's row signs in that plugin's server or nothing.
- [ ] M3 — The row in My items, its lines and Sign in; the coverage note; the lists before a chat starts.
- [ ] M4 — The record, the e2e scenes written, the whole checks, the hand-back.
- [ ] The architect's: the e2e scenes on a Mac, the branch review, class 1a, the pull request (Proof, P1 to P5).

## Statements to check again once U11g and U11c are on master

Neither landing's code was on master when this was written; U11c's is known here only from its document. The pass replaces "its document says" by what master holds, and corrects the place this document names where they differ.

| | the statement | this document rests on it in |
|---|---|---|
| **U11c** | | |
| K-1 | The connector's row is `ConnectorRow` in `src/renderer/src/customize/connectors/ConnectorRow.tsx`, over `ConnectorRowModel` in `customize/connectors/rows.ts`; the model is a union with the one member `kind: 'configured'`, and everything in the row that depends on the kind is decided on `row.kind` in one place. | M3, §E |
| K-2 | `connectorRows(inventory)` takes the inventory (not a list of servers) and answers the configured rows in the inventory's order; `connectorRowKey` is today's `serverKey` for a configured row. | M3, §E |
| K-3 | The row's parts are marked `data-connector-main` and `data-connector-trailing`, and under All the kind word's cell follows; a row under All is the same component with the kind word. | M3 |
| K-4 | My items, All draws the connectors' part from `connectorRows`, by the name each row shows, and its one search narrows a connector by that name. | M3 (a plugin's rows join that part; the search also finds them by their plugin's name) |
| K-5 | `openMine('plugins', { pluginId })` (`customize/open.ts`) opens My items, Plugins, on that plugin's detail once the plugin list holds it. | M3 ("from <plugin>") |
| K-6 | The page holds one inventory read, one plugin list (with `enabledHere` per identity), the attached session's status read and the postures, shared by the bodies; and one `Manage` whose book is kept per place. | M3 |
| K-7 | `ItemImage` takes `{ kind, seed, iconUrl, size }`; a configured connector's seed is its name; `catalog.postures` rows carry `iconUrl`. | M3, §E |
| K-8 | U11c left untouched: `customize/InventoryState.tsx` and the coverage note; `widgets/McpWidget.tsx`'s dialog before a chat starts; `widgets/connector-menu.ts`; `BEFORE_START.connectors`; everything in `src/engine-host/`, `src/services/` and on the wire. | M1 to M3 |
| K-9 | The helpers of `e2e/discover-connectors.spec.ts` reach My items, Connectors by the head's switch and the Show choice. | M4 |
| **U11g** | | |
| K-10 | `WIRE_MINOR` is 47 on master with U11g. This landing takes the next free number at the chain merge. | M1, Concrete Steps 3 |
| K-11 | `test/endpoint/artifact-rows.test.ts` holds U11g's case that `connectors.addJson` is `not-offered` to a caller on another machine; this landing's case stands beside it. | M1 |
| K-12 | A custom connector added by U11g's sheet is a configured row like any other; nothing of it is a plugin's connector, and `sameAddressAs` (§A) can name one. | §A |

## The landing's edge

**In.** X-184 as the child writes it: the inventory lists a plugin's connectors; their row in My items under Connectors and under All; Sign in from the row; no Remove; the coverage note's other half; l8-settings-03's line shortened and a plugin's connectors in a new chat's lists. And the "Waiting" entry the child handed to this document: what a row says when no session will hold it.

**Not included.** A switch per plugin connector (board ticket 476; §J names what it reads from here); skills that a marketplace declares and no folder holds; connectors of the engine's account and managed scopes; any change to how a plugin is turned off; a connector's site icon (U11d); the sign-in of a dynamic connector on a session of another machine (U11f); **any change to the session's Connectors dialog**, which keeps signing a dynamic connector in by its name alone, as U11a built it ("Reported", 7); a connector a plugin ships as a bundle.

## Words used here

- **A plugin's connector** is a server that an installed plugin's files declare. Three names belong to it and are kept apart throughout: its **server name**, as the plugin's file writes it; its plugin's **key**, `<name>@<marketplace>`, by which the plugin is installed, by which My items lists it, and which a session reports as the plugin's `source`; and its **engine name**, `plugin:<manifest name>:<server name>`, under which a session's status lists it. The **manifest name** is the `name` of the plugin's `.claude-plugin/plugin.json`.
- **A session's plugin list** is what the engine last reported of the plugins it loaded: `system/init`'s `plugins`, or a `reload_plugins` answer's. MAWS holds it in the session's status (`EngineSessionStatus.plugins`: `name`, `path`, `source`, `version`; `pluginsObservedAt` is null until the engine has reported one).
- **A collision** is two or more loaded plugins with one manifest name: the engine builds one engine name for a server they both declare, connects one of them and says nothing.
- **A templated address** holds one or more `${…}`; the engine fills them from the launch's environment and reports the address filled.
- **The inventory**, **MAWS's own list**, **dynamic**, **the attached session**, **the page**, **the place**: as U11a's and U11c's documents use them.
- **Build F** is `f1852de3a`, the build on the owner's machines.

## Engine facts this landing rests on

Each is run on engine `2.1.322` unless it says otherwise. "The findings" are `spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt`; "the record" is `spikes/protocol-probe/fixtures/uxwave/u11-plugin-conn.ndjson` (its line per case in brackets).

1. **The name is `plugin:<manifest name>:<server>`**, in `mcp_status` and in init's server list; the key's name plays no part (the findings, 1; the record [2]: a plugin installed as `key-alpha@m4-a` whose manifest says `mani-alpha` has `plugin:mani-alpha:alpha-http`). Proven for marketplace plugins. For a plugin whose source ends `@builtin` the engine puts an alias in the middle (`cli.pretty.js:954009-954011`): read, not run; such a plugin is not in `installed_plugins.json`, and its connector's engine name is null here.
2. **Nothing on a server's status entry names its plugin.** An entry carries `config`, `name`, `scope` (`dynamic`), `serverInfo`, `source` (`plugin`), `status`, `tools`, `transport`; `config` holds only the transport's fields: `type` and `url`, or `type`, `command` and `args` (the findings, 2). What names a plugin is the session's plugin list: `name` is the manifest name, `source` the key, `path` and `version` beside them; it is joined to a server only through the engine name's middle part.
3. **What `path` and `version` hold** (the record [1] `installedEntries` against [2] `init.plugins`): for a plugin installed from a marketplace that is a folder, the session's `path` is the plugin's folder **in the marketplace** while the installation's `installPath` is its copy under the engine's plugin cache: they are different folders, and neither contains the other. `version` is the same string in both (`0.0.1`). One marketplace kind was run; a marketplace cloned from a repository was not.
4. **A collision gives one server and no word** (the findings, 3; the record [6] to [10]): the server of the plugin that comes later in the user settings' `enabledPlugins`; the session's plugin list holds both plugins under the one name. Not run: a collision between a plugin enabled in the user's settings and one enabled only in a project's or the local settings.
5. **A templated address is reported filled** in `config.url` (the findings, 4), and a local command's `${CLAUDE_PLUGIN_ROOT}` likewise in `command` and `args`.
6. **A plugin turned off has no server**, at user, project or local scope, silently (the findings, 5).
7. **Odd and long names are listed as written**: a space, a colon, 147 characters (the findings, 6). The engine has no bound here; MAWS's sign-in has one (§B, "The bound").
8. **The engine drops a plugin's server whose address a file-configured server names** (`spikes/protocol-probe/findings-uxwave-u11-plugin-server-dedup.txt`; the child, l8-settings-01).
9. **The engine reports its plugin list only once a session has had a turn.** A session MAWS started with no message has sent no `system/init` (U11a's document, gate run 43386195217; the probe itself sent the local command `/cost` to get one). Its `mcp_status` answers before that.
10. **The engine keys a credential by the server's name, type, address and headers** (`spikes/protocol-probe/findings-p4-r8-mcp-servers.txt`, items 2 and 5), and `mcp_authenticate` looks the name up among the session's loaded servers (the child, l8-settings-01).

## What the code says today, beyond the section

Checked at the parent pin (U11c's and U11g's parts by their documents).

1. **The inventory reads a plugin's folder for skills and not for servers.** `installedSkills` in `src/engine-host/customization/inventory.ts` walks `installed_plugins.json`, keeps the installations that apply to the folder (user scope, or a project path the folder is under), reads `.claude-plugin/plugin.json` for the manifest name (`pluginNameOf`), and adds the coverage warning once per installation. What a plugin's files declare as servers is read by another reader with other bounds, for "What's inside": `Inventory.mcpServers` in `src/engine-host/plugins/manifest.ts` (`.mcp.json`, then the manifest's paths and inline maps; a `.mcpb` or `.dxt` bundle is counted and never read; a URL where a path belongs is a problem). It keeps a name and a transport, no address and no file.
2. **The coverage sentence is a value on the wire.** The engine host sends `CUSTOMIZATION_INVENTORY_COVERAGE` as one of `warnings`, and the window finds it by equality (`customize/InventoryState.tsx`): an equal string is the folded note, any other is listed under "Some configuration could not be read". Build F holds the same constant.
3. **An added member of an enum is a wire major** (`src/shared/ipc/wire.ts`); a new optional property at any depth is a minor. `customization.inventory` and `customization.serverEndpoints` are the engine host's and in the manifest. A receiver whose peer may be another build reads with `readTolerant`, which drops a key it does not know; both pairs exist on one Mac (`e2e/cross-build.spec.ts`, "(update, daemon)" and "(build F's app, unit mawsd)"). Build F's schemas also lack `skills[].pluginName` and the endpoints' `revision`.
4. **The sign-in of a dynamic connector checks an entry only for MAWS's own list.** `dynamicRefusal` (`src/services/connectors/sign-in-entry.ts`) looks a press's `entry.revision` up among entries of scope `app`; `check` (`src/services/connectors/sign-in.ts`) reads `customization.serverEndpoints` with `cwd: null` for it and `session.mcpStatus` beside it. `holds` compares the scope, the transport, and the address only where the entry's holds no `${`.
5. **The services are told each session's plugin list and keep none of it.** The sign-in service hears `session.status` (`onSessionStatus`, wired in `src/services/spine-root.ts` to the hosts' event), whose payload is the whole `EngineSessionStatus`, the plugin list and `pluginsObservedAt` among it; its type there is narrowed to `{ process, cwd }` and it keeps the folder alone. The window holds the same status per session (`useSessions`' `engine`). So the list is in both places already, and carrying it costs a wider type and one more value kept per ready session: nothing on the wire.
6. **The status answer passes the engine's keys through.** `McpStatusResponseSchema` (`src/shared/wire/control.ts`) is loose: an entry's `scope`, `source`, `transport` and `config` reach the services as the engine sent them (`LiveServer`).
7. **A sign-in's name is bounded at 128 characters by MAWS's own schemas:** the command's input (`connectors.signInDynamicServer`, `name: z.string().min(1).max(128)`) and the event that carries its progress (`ConnectorSignInChangedSchema`); moving the event's bound is a wire major (the child, l8-settings-01). `signsInDynamic` is the window's form of it.
8. **Before a chat starts,** the "+" › Connectors submenu (`widgets/connector-menu.ts`) and the dialog (`McpBeforeStart` in `widgets/McpWidget.tsx`) list `usedEntries(inventory.servers)`, under `BEFORE_START.connectors`: "Configured for <place>. Connection state, and connectors from plugins, show once the chat starts."
9. **Only a remote connector signs in.** `signInViewOf` (`customize/connectors/present.ts`) answers no state and no Sign in for a transport outside `http`, `sse` and unknown (`REMOTE`).
10. **Customize cannot show another machine** (U11c's document, code 9), and `src/endpoint/offers.ts` has no row for `customization.inventory` or `customization.serverEndpoints`.

## The sign-in rule (the architect's ruling of 2026-11-14 on the probe)

A press on a plugin's row signs in through a session only when all four hold. Each is checked in the services, in the operation, before `mcp_authenticate` is sent; (a) is also evaluated in the window, from the same function over the same list, so that the row can say its line instead of offering Sign in.

| | what must hold | read where | from what |
|---|---|---|---|
| (a) | In that session's own plugin list, **exactly one** plugin carries the row's manifest name, and that plugin's `source` is the row's key. Two or more of the name is the collision: refused, whichever would win. Where both the session's entry and the installation state a version, they are equal. | the services: the list they keep per ready session from `session.status` (code, 5). The window: the same status | `EngineSessionStatus.plugins`, `pluginsObservedAt` |
| (b) | The session's status lists the engine name with scope `dynamic`, source `plugin` and the row's transport (`streamable-http` read as `http`). | the services: `session.mcpStatus`, asked for this check | the entry's `scope`, `source`, `transport` |
| (c) | The address. A literal address equals the live `config.url`. A templated one matches it with each `${…}` standing for any non-empty text, and only when the address's origin (scheme, host, port) holds no `${…}`; otherwise there is no Sign in from the row. | the services: the entry's address from `customization.serverEndpoints`, read once for this check at the session's folder; the live one from the same `session.mcpStatus` answer | `url` against `config.url` |
| (d) | The revision the press carries is the entry's now: it covers the plugin's key and its installation (scope, folder, version) together with the engine name, the transport and the address, so a removal, a replacement or an update between display and press is refused. | the services: the same read of the endpoints | `revision` |

*What else of the session's plugin entry is compared* (engine facts, 3): `version`, where both sides state one. `path` is **not** compared: for the one marketplace kind that was run it names another folder than the installation's, by the engine's own behaviour, so a comparison would refuse every plugin. *A local command* is never signed in (code, 9), so the rule is not reached for it: nothing of its `command` or `args` is compared, and they cross to no one; its row reads its state from the status under (a) and (b) alone.

*Before any session exists*, the window has a second net for the row's own words: two installed plugins, both enabled for the place, whose rows would have one engine name are both drawn with the collision's line.

*The session's Connectors dialog is not under this rule.* It signs in the session's own server by its name, and its row claims no plugin ("Reported", 7).

## Reported to the architect

Each is written to its recommended default, in one named place.

1. **(a) can be had, with one limit: a session that has not had a turn has reported no plugin list** (engine facts, 9). The list is already in the services' hands and the window's (code, 5); no wire change. But the attached session before its first message cannot satisfy (a), though its status may already list the server. **Default:** such a session is not signed in through; the row says so and what to do. The other way to get a list sooner, asking the engine to reload its plugins, is an act on a session that Customize has never made. *Named place:* §B, the verdict `not-reported`.
2. **The version comparison is proven on one marketplace kind** (engine facts, 3). If a repository-cloned marketplace writes the two versions in different forms, every such plugin would be refused Sign in from its row: the safe direction, and a visible one. **Default:** compare where both state one. *Named place:* §B, the verdict `other-version`; one probe case (a plugin from a cloned marketplace: its `version` in the session's list against `installed_plugins.json`) would settle it and is not a gate.
3. **`path` cannot be compared** (engine facts, 3; the ruling's question).
4. **A window stays between the check and the engine's own lookup.** `mcp_authenticate` looks the name up again; a reload of the session's plugins between the services' check and that call could put another plugin's server under the name. It is the length of one call, MAWS makes such reloads itself only after a change it ran, and the engine gives no way to name the server but its name. Not closed; a residue row. *Named place:* §B, "What the check cannot see".
5. **The bound of 128 characters is MAWS's own** (code, 7; engine facts, 7). A row whose engine name is longer is listed, reads its state, and has no Sign in, with its line. Moving the bound is a wire major and is not proposed.
6. **The words** (§G) are this document's: nine lines for a row with no Sign in, three sentences the services refuse with. Among them, the collision's, as the architect asked for it (the reason in plain words, and what resolves it): **"Two plugins are named <manifest name>, and Claude Code loads only one of them. Turn one off to sign in."**, before any session exists and for a session whose list holds two.
7. **The session's Connectors dialog still signs a plugin's server in by name alone, in a collision too.** That is U11a's, and the child keeps the dialog out of X-184. Its row shows the session's own server and claims no plugin, so it does not sign in "another plugin's server" in the sense of this rule; but a person in a collision can sign in the winner there without being told there are two. **Default:** unchanged here. A line in the dialog for a session whose list holds two plugins of a name would be a change to U11a's dialog, for the architect to place.
8. **A connector a plugin ships as a bundle (`.mcpb`, `.dxt`) is not listed,** because no reader opens one, while the note stops saying that plugin connectors are missing (A20). **Default:** the note is the item's sentence; a residue row.
9. **Size:** about 2,350 changed lines in about 40 files: past twenty files, so the xhigh panel, with the rule about credentials as its first lens (Decision Log).

## Acceptance

- **H1 · Listed with no session** (A20). With an installed plugin that brings a connector, and no session running, My items lists it under Connectors and under All as "<server> · from <plugin>", with its image, no file line and no Remove; "from <plugin>" opens the plugin's detail. Under All it carries the word Connector.
- **H2 · The note** (A20). The folded "Inventory coverage" note reads "Skills that a marketplace declares but no folder holds are not listed; see Plugins." With an engine host of an earlier build it reads as today, and neither sentence is ever listed under "Some configuration could not be read".
- **H3 · Sign in from the row** (A20). While a session MAWS runs on this Mac has had a turn, loaded the row's plugin and no other of its name, and holds the connector needing a sign-in, the row offers Sign in; pressing it opens the consent page and the row ends "Signed in · connected here". With no session that holds it: "Open a session, then sign in".
- **H4 · Through another session** (the architect's ruling, F3). With the attached session not holding the connector and a second ready session on this Mac that satisfies the rule, the row reads "Not in the attached session" and still offers Sign in, which runs through the second; a running sign-in's Cancel and its result stay on the row.
- **H5 · Never another plugin's server** (the rule). With two enabled plugins of one manifest name that declare one server name, neither row offers Sign in, with or without a session, and each says why and what resolves it. A press sent anyway (the window bypassed) is refused in the services before the engine is asked: for a session whose plugin list holds two of the name; for one whose plugin of that name has another key; for a server of another transport or address; for a revision that is not the entry's now.
- **H6 · A templated address.** A row whose address has `${…}` in its path signs in when the live address matches the pattern; one whose origin has `${…}` offers no Sign in and points at the chat's dialog.
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
- **Nothing stored, nothing in a settings file** (UC-14); the wire moves by one minor, additively: two optional properties. No enum of a command or event the manifest holds gains a member, and no bound moves.
- **This Mac only** (bindings 9 and 14). No offer row, capability or `remote-unavailable` entry is added; `src/endpoint/` is not edited.
- **Tokens only** (law 7); a ticket is written in words in renderer source; run `test/support/tokens-guard.test.ts` with every milestone that adds renderer source.
- **Keep means keep** (law 8). The configured rows, the session's dialogs and U11a's sign-in for MAWS's own list are not changed: `dynamicRefusal`'s cases for a press with no entry and for a name that does not start `plugin:` keep their results and their words, and their tests stay.
- **Files other children own or none holds** (UC-8). `src/shared/ipc/wire.ts` and the generated wire files (one minor; made again after the last merge of master); `src/services/connectors/` and `src/engine-host/plugins/manifest.ts`, which no child holds; `test/endpoint/artifact-rows.test.ts` (one case). In U4's `composer/plus-menu/PlusMenu.tsx`: nothing (the submenu's rows come from `widgets/connector-menu.ts`).
- **Merge, never rebase or force-push.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. On "No space left on device": stop, report, delete nothing.

## Plan of Work

Four milestones. M1 and M2 are the machine's side, each reviewed at its boundary before M3 consumes them; M2 holds the rule and nothing else, so that its proof is read alone.

**Size**, counted from the code (changed lines, tests included):

| | changed lines | files |
|---|---|---|
| M1 | about 700 | about 15 |
| M2 | about 600 | about 9 |
| M3 | about 800 | about 16 |
| M4 | about 250 | about 7 |
| the landing | about 2,350 | about 40 |

### M1 — The inventory lists a plugin's connectors

**At its end** the engine host answers, beside today's rows, one row for each connector that an installed plugin's files declare for the folder (§A), and main answers each one's posture, fingerprint, revision and icon. Nothing in the window draws any of it yet.

**Touches.** `src/shared/ipc/schema/customization.ts`; `src/engine-host/customization/inventory.ts` and its test; `src/engine-host/plugins/manifest.ts` and its test, only if the one rule below is kept by extending its reader; `src/shared/plugins/` (the address's shape, §B, with its test: the engine host and the services both read it); `src/shared/ipc/schema/catalog.ts` (the postures' answer); `src/main/catalog/postures.ts`, `index.ts` and their tests; `src/shared/ipc/wire.ts` and the generated wire files; one new test file beside `src/shared/ipc/send-now-builds.test.ts` for the two builds; `test/endpoint/artifact-rows.test.ts` (one case).

**Interfaces.** Exposes §A. Consumes U11a's `configurationRevision` and `pluginNameOf`.

**Decisions.**
- *One rule for what a plugin's files declare.* For an installation, the inventory lists the servers that "What's inside" lists for it (`readManifestView(…).components.mcpServers`): the plugin's `.mcp.json`, then the paths and inline maps its manifest names, first declaration of a name winning; a bundle and a URL where a path belongs are not listed and add no warning (a warning would be drawn as "Some configuration could not be read"). How the rule is shared is the executor's: the reader of `manifest.ts` extended to keep each server's address and declaring file, or the inventory's own `Reading` following the same rule. Either way the inventory's bounds hold (`INVENTORY_BOUNDS`: entries, bytes, the deadline, and `rows` as this list's cap too), every file is read confined to the plugin's folder as the skills' files are, and a test pins that the two readers name the same servers for one invented plugin that uses all three ways of declaring.
- *Which installations.* The ones `installedSkills` keeps for the folder. One row per key and server name: where a plugin is installed twice for the folder, the first installation in the file's order. A plugin whose key ends `@builtin` gets a null engine name (engine facts, 1).
- *A name is listed as written* (engine facts, 7): no cut. A server name or manifest name longer than its field's bound (§A) is not listed, since a cut name is another name.
- *The address is compared as written.* `sameAddressAs` names a `user`, `project` or `local` entry of the same read whose address string equals this one's, only where the row's transport is `http`, `sse` or `ws` and neither address holds `${`; the highest in the engine's precedence (`local`, then `user`, then `project`) when several do. MAWS's own entries are not compared (the engine does not compare servers given at launch).
- *The revision* covers what rule (d) names; null where the engine name or the address is null.
- *The coverage warning* is still added once per installation, and its string is not edited ("What the code says", 2).
- *The wire's minor*: the next free one after master's at the last merge, with the comment "the UX wave's U11h: customization.inventory's and customization.serverEndpoints' pluginServers" (Concrete Steps, 3).
- *Pitfalls.* `serversRead` is about the files Add checks a name against and does not change. The inventory's test helpers build a scratch config home; no test reads a real one.

**Does not touch.** The window. The services. `customization.inventory`'s `servers` and `skills`. `src/endpoint/`. `src/shared/net/egress.ts`.

**Proves** the machine half of H1, H7 and H8, and H9's and H10's part that a test can show. Its tests pin:
- for an invented plugin: a server from `.mcp.json`, one from a manifest path, one from an inline map, each with its transport, its declaring file, its installation's scope and version, and its engine name built from the manifest name where that differs from the key's (engine facts, 1); the same names as `readManifestView`; a name with a space and one with a colon as written; an engine name of 147 characters whole; a bundle and a URL spec not listed; a file outside the plugin refused;
- a manifest whose name cannot be read, and a key ending `@builtin`: `pluginName` or `name` null as §A says;
- an installation for another project: no row; the same plugin installed twice for the folder: one row per server;
- `address`: literal, templated, templated in the origin, and null for a local command; `sameAddressAs` in its cases;
- `customization.serverEndpoints` carries each row's address and revision, and the revision moves when the key, the installation's scope, folder or version, the name, the transport or the address moves; `customization.inventory` carries no address, command or argument in any field;
- postures for a plugin's row: the posture and the icon of the one record its address matches, null for none or several, a fingerprint, the host's revision;
- the two builds, over representative answers (a plugin's skill with `pluginName`, an endpoint with `revision`, a `pluginServers` list): build F's copies of the two answer schemas, read with `readTolerant`, accept them, and what is dropped is only what F does not know; this build's schemas accept build F's answers;
- `customization.inventory` and `customization.serverEndpoints` answer `not-offered` to a caller on another machine;
- `wire.test.ts` classifies the change as a minor.

### M2 — The rule: a press from a plugin's row signs in that plugin's server or nothing

**At its end** a press that names a `plugin:` server with a revision is checked in the services by the four parts of the rule, in the order of §B's table, and every failure ends the operation before the engine is asked, with its own sentence.

**Touches.** `src/shared/plugins/` (the two pure functions of §B and their tests); `src/services/connectors/sign-in-entry.ts`, `sign-in.ts` and their tests; `src/services/spine-root.ts` only if the wiring's type must widen.

**Interfaces.** Exposes §B. Consumes §A's endpoints, U11a's `dynamicRefusal`, `holds` and the operation's `check`.

**Decisions.**
- *The functions are pure and shared* (`pluginInSession`, `addressMatches`): the services enforce with them and the window words its lines with the first, so the row and the refusal cannot disagree about (a).
- *The services keep each ready session's plugin list* from the status event they already hear, with `pluginsObservedAt`, beside its folder, and drop it when the session is gone. A session they learn of from the listing they read at a start (`deps.sessions()`) takes the same two fields where that listing holds the status; where it does not, such a session counts as `not-reported` until its next status event.
- *The entry is found by its revision and its name together* among `pluginServers` read at the session's own folder (a plugin can be installed for one project): the revision covers the key, so two entries of one engine name are told apart, and the press's own schema does not change.
- *Order:* (d), then (a), then (b), then (c): the cheapest proof that the page is stale first, the collision before anything is compared with a server that may be the other plugin's.
- *Reason and words:* every failure fails with today's reason `other_entry` and §G's sentence.
- *The dialog's press* (no entry) and a press for MAWS's own list are today's code paths, unchanged.

**Does not touch.** The command's and the event's schemas, their bounds, the redirect, the grade. The window. `connectors.signIn`, `connectors.signInServer`.

**Proves** H5 and H6 where the act runs, and H3's and H4's part that the services decide. Its tests pin, at the functions and then at the service:
- (a): a list not yet reported; no plugin of the name; one of the name with the row's key; one with another key; two of the name, the row's first and the row's last (the collision is refused whichever would win: the record's cases [6] and [7] as the two orders); a version that differs, and a version one side lacks;
- (b): no server of the name; scope not `dynamic`; source not `plugin`; another transport; `streamable-http` against `http`;
- (c): a literal address equal and unequal; a templated path that matches, one that does not, a `${…}` that would have to stand for nothing; a `${…}` in the scheme, the host and the port, each refused; a trailing slash is a difference;
- (d): the entry gone; its revision another (each of the six things the revision covers changed in turn); the host answering no revision;
- **held open** at the service: the endpoints read is out while the status has answered, and `mcp_authenticate` is not sent before both have and before the kept list is consulted; the read fails: "that session's configuration could not be read"; the read is made with the session's folder;
- **held open**: a status event that changes the session's plugin list arrives while the read is out: the check uses the list as it is when the read returns;
- the list is dropped when the session ends, and a new launch's list is not the old one's;
- U11a's cases of `dynamicRefusal` and of the service for a press with no entry and for MAWS's own list pass unedited.

### M3 — The row in My items, its lines and Sign in; the coverage note; the lists before a chat starts

**At its end** My items draws a plugin's connectors after the configured ones under Connectors and in the connectors' part of All, with §E's row and lines and Sign in through a session the rule admits; the note has the item's words; a new chat's "+" › Connectors and its dialog list them.

**Touches.** `customize/connectors/` (`rows.ts`, `ConnectorRow.tsx`, `present.ts`, `copy.ts`, `ConnectorsSection.tsx` and their tests); `customize/image/` only for the seed's table; `customize/InventoryState.tsx`; `widgets/McpWidget.tsx` (the dialog before a chat starts), `widgets/connector-menu.ts`, `widgets/copy.ts` (`BEFORE_START.connectors`); `src/shared/ipc/schema/customization.ts` (the constant's comment); `widgets/before-start.test.tsx`, `customize/CustomizeView.test.tsx`.

**Interfaces.** Exposes §E and §J. Consumes §A, §B, U11c's row and page (K-1 to K-7), U11a's `startSignInDynamic`, `signsInDynamic`, `signInKeyOf`, `resultFor`, `useSignIns`, `signInViewOf`, `usedEntries`, `useTabPlace`, and the launch profile's `plugins.off` as `SkillsOnDisk` reads it.

**Decisions.**
- *The plugin kind is the model's second member and the row's second branch* (K-1): nothing of the configured branch is edited.
- *Which session.* The attached session when the rule's window half admits it; else the first ready session MAWS runs on this Mac that the window half admits, one in the page's folder first, then by id (U11a's order). "Admits": its status lists the engine name (the attached session's own status read counts too) and `pluginInSession` answers `ok`. The services decide; this only picks whom to ask.
- *The row reads a live state only from a session the window half admits*: a server under the same name in a session where (a) fails may be another plugin's.
- *The lines* (§E's table) come before any sign-in state, as a shadowed row's words do today, except "Not in the attached session", which is information beside Sign in (H4).
- *The collision before any session* is told from the page's own reads: two rows of one engine name whose plugins the plugin list says are enabled here.
- *The press* sends the engine name and the revision the row was drawn with, and keeps the fingerprint in the window, exactly as a row of MAWS's own list does.
- *Before a chat starts* the two lists are today's entries, then the plugin's connectors without those that read "Not loaded: same address…" and those whose plugin the launch profile turns off; a row's detail word is "from <plugin>" in the submenu, and its opened part names the declaring file in the dialog.
- *Pitfall.* An engine host of an earlier build answers no `pluginServers`: the list is today's and the note is today's sentence.

**Does not touch.** `src/services/`, the command, the dialog of a started chat, the Connectors card, Settings › MCP servers, the configured rows.

**Proves** H1 to H4, H7, H8 and the window's half of H5 and H6. Its tests pin:
- the row: the server name, "from <plugin>" (a button that opens the plugin's detail), the transport, the image, no scope word, no file line, no Remove; its marks; under All its kind word and its place by name;
- each line of §E's table in its case, with no Sign in, and their order where two hold; the collision's line on both rows with no session, and on the row for a session whose list holds two; "Plugin turned off" for the plugin list's not-enabled, whatever turned it off;
- Sign in only where §E says, and the press's two values; "Open a session, then sign in" with no session that holds the name;
- **held open** (H4): the attached session's status has answered without the server; a second ready session holds it and is admitted: the row reads "Not in the attached session" with Sign in; the press goes to the second; `starting` is heard before the receipt; Show is changed to All and back; the steps and Cancel stay on the row; the result reads on it;
- **held open**: the attached session has had no turn (no list reported) and lists the server: its line, no Sign in; its status then reports the list: Sign in appears with no reload of the page;
- the services refuse with each of §G's sentences: the row reads it after "Sign-in didn't finish:"; the invoke is refused (`unknown_command`): the transport's words;
- the note's words with and without `pluginServers` in the answer, and that neither sentence is listed under "Some configuration could not be read";
- before a chat starts: the submenu's and the dialog's rows, the two exclusions, the line's new words; a tab set to another machine reads nothing.

### M4 — The record, the e2e scenes written, the whole checks, the hand-back

**At its end** the scenes are written and typechecked, the record is in the branch, and the acceptance has been run as far as an executor can run it.

**Touches.** `e2e/discover-connectors.spec.ts`, `e2e/widgets.spec.ts`; the documents of "The record"; this document.

**Decisions.** No spec file is added and no time bound asserted but in a form `.github/scripts/gate-plan.test.mjs` lists. The scene that signs in gives its session a turn without calling a model, by the local command the probe used (`/cost`), so that the engine has reported its plugin list.

**Proves** by running, on the VM: the whole typecheck, lint, the whole unit suite once, the scan and the script tests (Concrete Steps, 5).

### The e2e groups and scenes

| group | file | scenes |
|---|---|---|
| `e2e:discover` | `e2e/discover-connectors.spec.ts` | "dynamic: a plugin's connector and one of MAWS's own list signed in from the Connectors dialog, a second of the list from Customize" gains **two steps**. (1) *The row signs in:* after the session has had its `/cost`, the scratch plugin's connector's row in My items reads "from <plugin>", offers Sign in, and ends signed in; the same step first shows the row with no Sign in and its line before the `/cost`. It makes an engine sign-in: the scene already runs on the Mac lane alone, and runs only in a gate job on the Mac mini runner (binding 11). (2) *The collision:* a second scratch plugin of the same manifest name and server name is installed and enabled; both rows read the collision's line with no Sign in, before a session and with a new session that loaded both; turning one off brings Sign in back on the other after a new session. No sign-in in this step. |
| `e2e:widgets` | `e2e/widgets.spec.ts` | "a New chat lists its folder's connectors, skills and plugins before the first message, and Use in chat inserts the skill": the dialog's line's words; with a plugin in its stub home that declares a connector, the submenu and the dialog list it with "from <plugin>". |
| `e2e:settings` | `e2e/settings.spec.ts` | "Customize and Projects are reachable without a chat, at desktop and narrow widths" finds "Inventory coverage" by its summary: kept. |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | not edited. Whether the wire's minor asks for the group on this head is the architect's (Proof). |
| `default` (`e2e`) | | run because the renderer changed. |

### The record (in the same pull request, UC-10)

- **U11a's execution document**, under its §A: "2026-11-14, UX wave U11h (X-184): a plugin's connector listed in Customize signs in through `connectors.signInDynamicServer` with the revision of its own entry, only through a session whose own plugin list holds exactly one plugin of its manifest name, with its key, and whose server of that name has its transport and address (`docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md`, the sign-in rule)."
- **U11c's execution document**, under its §J: "2026-11-14, UX wave U11h: the connector row's second kind, `plugin`, and its identity are built as that landing's §E and §J state them."
- No ruling is reversed by X-184 (the child's "Rulings reversed" names none for it).
- At landing, by the architect: the register's row for X-184 and the tracker row of 2026-10-24 (its connector half); the child's "Waiting" entry "A plugin's connector that the engine drops" closes with §E's lines.

## Concrete Steps

From the worktree of branch `ux-wave/U11h`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11h --`.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Master must hold the probe (`ls spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt`), U11g (`grep -n "connectors.addJson" src/shared/ipc/names/connectors.ts` prints a line) and U11c (`ls src/renderer/src/customize/connectors/ConnectorRow.tsx src/renderer/src/customize/connectors/rows.ts`). If any is missing, stop and report: this document is written for a tree that holds all three, and its table of statements must have had its pass. Then read each file this document names that the merge changed against "What the code says today".

2. **Each milestone**, tests first where a test can fail first. Push before every check.

       git push -u origin ux-wave/U11h
       vmcheck 'timeout 900 pnpm exec vitest run <the milestone's paths, below>'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'   # main, the hosts, the services and shared code
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'    # the renderer; tsconfig.e2e.json for e2e/
       vmcheck 'timeout 600 pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11h at <short sha>` and then the command's output; its exit status is the command's. At a tests-first commit vitest fails on the new assertions; at the milestone's head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing.

   | | vitest | typecheck |
   |---|---|---|
   | M1 | `src/shared/ipc src/shared/machine src/shared/plugins src/engine-host/customization src/engine-host/plugins src/main/catalog test/endpoint/artifact-rows.test.ts test/lane-b/offer-coverage.test.ts` | node |
   | M2 | `src/shared/plugins src/services/connectors src/services/spine-root.test.ts` | node |
   | M3 | `src/renderer/src/customize src/renderer/src/widgets test/support/tokens-guard.test.ts` | web |

3. **M1, the wire.** Take the next free `WIRE_MINOR` on the master last merged, with its comment, then make the generated files again on the VM and bring the result back:

       G='src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json src/shared/ipc/routes.json src/shared/machine/address-paths.json'
       vmcheck "pnpm wire:manifest >/dev/null; MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts >/dev/null; git diff -- $G; git checkout -- $G" > /tmp/u11h-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u11h-wire.patch | git apply

   Expect the patch to add `pluginServers` under the outputs of `commands.customization.inventory` and `commands.customization.serverEndpoints`, the minor, and a new value in `wire-fingerprint.json`; nothing in `routes.json` and nothing in `address-paths.json`. A changed `enum`, `maxLength` or `required` anywhere else in the patch means something other than an addition moved: undo it.

4. **M1 to M3 add fixtures and tests with configuration-shaped content.** Run the scan before each hand-back: `vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'`. A failure names the file; the cure is a plainer invented value, not an allow-list entry.

5. **M4, master again, then the whole checks.**

       git fetch origin master && git merge origin/master
       grep -n "export const WIRE_MINOR" src/shared/ipc/wire.ts | cut -c1-60

   If the merge conflicted in `wire.ts` or in a generated file, or master's minor is now this branch's or higher: keep master's comment, give this landing's addition the next number after master's, take master's side of the generated files, and run step 3's regeneration again. Then:

       vmcheck 'timeout 900 pnpm typecheck'
       vmcheck 'timeout 900 pnpm exec eslint src/shared/ipc src/shared/plugins src/engine-host/customization src/engine-host/plugins src/main/catalog src/services/connectors src/renderer/src/customize src/renderer/src/widgets e2e/discover-connectors.spec.ts e2e/widgets.spec.ts test/endpoint/artifact-rows.test.ts'
       vmcheck 'timeout 2400 pnpm test'
       vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 1200 pnpm exec vitest run src/shared/plugins src/shared/ipc src/engine-host/customization src/main/catalog src/services/connectors test/endpoint/artifact-rows.test.ts src/renderer/src/customize src/renderer/src/widgets'

   The last prints `Test Files … passed` with no failure, and is the one result the hand-back quotes for H1 to H10: the rule (H5, H6) by `src/shared/plugins` and `src/services/connectors`; H9 and H10 by the paths before `src/renderer`; the rest by the two renderer folders. In `pnpm test` the files the build brief lists as failing on master too are not this landing's.

6. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e, engine or probe. The hand-back says: what exists, with the command and result that showed it; the master and the wire minor the branch stands on; what is not verified (every e2e scene; "What is not proven"); the decisions made; anything that contradicts this document; the residue. Residue known at authoring:
   - a reload of a session's plugins between the services' check and the engine's own lookup is not seen ("Reported", 4);
   - a session that has not had a turn cannot be signed in through from a row ("Reported", 1);
   - a connector a plugin ships as a bundle, or names by a URL where a path belongs, is not listed;
   - a plugin whose manifest is its marketplace entry (no `plugin.json` in its folder) lists only what its `.mcp.json` declares, if the inventory is not handed its marketplace's root;
   - a connector the engine drops for a reason MAWS does not compare (an address that differs only as written, or a later plugin's server that repeats an earlier plugin's) reads as needing a sign-in until a session shows it absent;
   - before a chat starts, a connector of a plugin turned off in Claude Code's own settings is listed until the chat starts (the "+" menu runs no plugin CLI);
   - the session's Connectors dialog says nothing of a collision ("Reported", 7);
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

**Why an array of its own and not a fifth scope:** an added enum member is a wire major ("What the code says", 3); the architect's ruling. In the window the row's kind is `plugin`. **The revision** is `configurationRevision`'s form (an HMAC under the host's key of the run) over the key, the installation's scope, folder and version, the engine name, the transport and the address. **No address, command or argument** is in the inventory's answer.

### §B. The rule's functions and the check (M1 for the first, M2)

    // src/shared/plugins/plugin-connector.ts (pure, zod-free; read by the engine host, the services and the window)
    export type AddressForm = 'literal' | 'templated' | 'templated-origin';
    export function addressFormOf(url: string): AddressForm;                     // `templated-origin`: a `${…}` before the first `/` after the scheme's `//`, or in the scheme
    /** Whether a live address is the declared one: equal for a literal; for a templated one, each `${…}` standing for one or more characters and every other character itself. Never asked of `templated-origin`. */
    export function addressMatches(declared: string, live: string): boolean;

    export interface SessionPlugin { name: string; source: string | null; version: string | null }   // an entry of the session's plugin list
    export type PluginInSession = 'ok' | 'not-reported' | 'absent' | 'collision' | 'other-plugin' | 'other-version';
    /** Rule (a). `observedAt` null: the engine has reported no list in this launch. */
    export function pluginInSession(row: { plugin: string; pluginName: string; version: string | null }, plugins: readonly SessionPlugin[], observedAt: string | null): PluginInSession;

`pluginInSession`, first that holds: `not-reported` (no list); `absent` (no entry of the name); `collision` (two or more of the name); `other-plugin` (the one entry's `source` is not the row's key); `other-version` (both state a version and they differ); `ok`.

**The check**, for a press that names an entry and whose name starts `plugin:` (`check` in `sign-in.ts`, `dynamicRefusal`'s new branch), in this order; the first that fails ends the operation with reason `other_entry`:

| | the services | on failure (§G) |
|---|---|---|
| read | `customization.serverEndpoints` at the session's own folder and `session.mcpStatus`, once, together; the session's kept plugin list as it is when they return | "that session’s configuration could not be read: <words>" (today's) |
| (d) | among `pluginServers`, the entry whose `name` is the press's and whose `revision` is the press's | the changed sentence |
| (a) | `pluginInSession(entry, list, observedAt)` is `ok` | the sentence of its verdict |
| (b) | the status lists the name, with scope `dynamic`, source `plugin`, and the entry's transport | "that session has no <name> server", or the different sentence |
| (c) | the entry's `addressFormOf` is not `templated-origin`, and `addressMatches(entry.url, live.config.url)` | the launch sentence, or the different sentence |

**The bound.** The engine lists a name of any length; MAWS's sign-in takes at most 128 characters ("What the code says", 7), so the window offers no Sign in for a longer engine name (`signsInDynamic`) and the command's own schema refuses one.

**What the check cannot see.** It reads the list the engine last reported and the status at one moment; `mcp_authenticate` then looks the name up again in the engine ("Reported", 4).

### §E. A plugin's row (M3; U11c's §E extended)

    // src/renderer/src/customize/connectors/rows.ts: the model's second member, and its rows after the configured ones
    | { kind: 'plugin'; key: string; name: string | null; server: string; plugin: string; pluginName: string | null; installScope: 'user' | 'project' | 'local'; version: string | null; path: string; transport: string; address: AddressForm | null; sameAddressAs: string | null }
    // connectorRowKey for it: `connector:plugin:<plugin>:<server>`
    // connectorRows(inventory: Pick<Inventory, 'servers' | 'pluginServers'>): the configured rows in the inventory's order, then the plugins' by key and server

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
| 4 | another plugin's row has the same engine name and both plugins are enabled here | the collision's line |
| 5 | its transport is not one that signs in ("What the code says", 9) | the state from an admitted session's status, if any; nothing else |
| 6 | an admitted session's status, or its posture, says it needs no sign-in, is connected, or the like | that state, as a configured row's |
| 7 | `name` is longer than 128 characters | "Its name is too long to sign in from MAWS." |
| 8 | `address` is `templated-origin` | "Its address is set when a chat starts. Sign in from that chat’s Connectors dialog." |
| 9 | a session is admitted | Sign in, through it; and "Not in the attached session" beside it when the attached session's status has answered without the server and the admitted session is another |
| 10 | sessions list the name but none is admitted | by the first of their verdicts in this order: `collision`: the collision's line; `other-plugin`: "That session loaded <manifest name> from another plugin."; `other-version`: "That session loaded another version of this plugin. Start a new session, then sign in."; `not-reported`: "Send a message in that session, then sign in." |
| 11 | no session lists the name | "Open a session, then sign in" (today's), and "Not in the attached session" when the attached session's status has answered |

A sign-in under way or ended is shown first, as on every row. An **admitted** session is a ready session MAWS runs on this Mac whose status lists `name` and for which `pluginInSession` is `ok`; the attached one first, then one in the page's folder, then by id.

### §G. Words

| where | words |
|---|---|
| a plugin's row | "from <plugin>" |
| the collision's line (rows 4 and 10) | "Two plugins are named <manifest name>, and Claude Code loads only one of them. Turn one off to sign in." |
| rows 1, 2, 3, 7, 8, 10, and "Not in the attached session" | as §E's table gives them |
| `COVERAGE.now` (the folded note, an answer with `pluginServers`) | "Skills that a marketplace declares but no folder holds are not listed; see Plugins." |
| `COVERAGE.before` (an answer without) | today's sentence, the wire constant's own text |
| `BEFORE_START.connectors` | "Configured for <place>. Connection state shows once the chat starts." |
| the services, (d) | "<name> changed since this page read it; refresh the page, then sign in" |
| the services, (a) | `not-reported`: "that session has not reported its plugins yet; send it a message, then sign in"; `absent`: "that session did not load <manifest name>"; `collision`: "that session loaded two plugins named <manifest name>; turn one off, start a new session, then sign in"; `other-plugin`: "that session loaded <manifest name> from another plugin"; `other-version`: "that session loaded another version of <manifest name>; start a new session to sign in" |
| the services, (b) and (c) | "that session has no <name> server" and "this session uses a different <name>; start a new session to sign in" (both today's); `templated-origin`: "<name>’s address is set when a chat starts; sign in from that chat’s Connectors dialog" |

`CUSTOMIZATION_INVENTORY_COVERAGE` keeps its value; its comment says it is a mark on the wire and that the window words the note.

### §H. What is stored or sent, and what build F does with it

**Stored: nothing.** The services' kept plugin list, the revision and the fingerprint live in memory for a run. No layout key, no settings key, no file: the cross-build coverage table gains no row.

**Sent between builds: two optional properties, one minor.**

| what | this build's sender, F's receiver | F's sender, this build's receiver |
|---|---|---|
| `pluginServers` on `customization.inventory`'s answer | F's main reads its engine host's answers with `readTolerant` and drops the key (with the others it does not know); F's window is answered as today | absent: the window lists none and words the note as `COVERAGE.before`, which is true of that host |
| `pluginServers` on `customization.serverEndpoints`' answer | the same; F's postures are as today | absent: `catalog.postures` answers an empty `plugins`; the services find no entry and refuse a press with the changed sentence |
| the coverage warning's string | unchanged: F's window folds it as today | unchanged |
| `connectors.signInDynamicServer` with an entry for a `plugin:` name | its schema is unchanged. F does not know the command and answers `unknown_command`; a services build from U11a to before this landing looks the name up among MAWS's own entries, finds none and refuses: safe, and not a build anyone returns to | n/a |
| `session.status` | unchanged: the services read two more fields of what is already sent | unchanged |

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

Consumed. **U11a**: `connectors.signInDynamicServer`, `dynamicRefusal`, `holds`, `configurationRevision`, `pluginNameOf`, `startSignInDynamic`, `signsInDynamic`, `signInKeyOf`, `resultFor`, `useSignIns`, `signInViewOf`, `usedEntries`, `useTabPlace`, `useCustomizationInventory`, `BEFORE_START`. **U11c**: `ConnectorRow`, `ConnectorRowModel`, `connectorRows`, `connectorRowKey`, `ItemImage`, the postures' `iconUrl`, `openMine`, the page's reads and `Manage` (K-1 to K-8). **U11g**: the wire's minor before this one; its `not-offered` case's place. **U6a, U8a, U3a, U13a, U9, U8b**: nothing; no action id, no stored key, no act on a session of another machine, no offer.

Exposed: §A's rows; `addressFormOf`, `addressMatches`, `pluginInSession`; the check's new branch; the row's second kind.

## What is not proven

| | what | what it could change |
|---|---|---|
| N-1 | A collision between a plugin enabled in the user's settings and one enabled only in a project's or the local settings (engine facts, 4) | nothing: the rule refuses every collision, whichever wins |
| N-2 | Whether a session's `version` and the installation's are written in one form for a marketplace cloned from a repository (engine facts, 3) | a false refusal from the row for such plugins ("Reported", 2) |
| N-3 | The name of a built-in plugin's connector (read, not run) | nothing here: its engine name is null |
| N-4 | Whether the engine's status reports a remote server's headers, and whether a loser's credential could serve a winner | nothing in the rule: the engine keys a credential by address and headers, and the rule requires the address |
| N-5 | A reload between the check and the engine's lookup ("Reported", 4) | the residue |
| N-6 | That `system/init` never comes before a first turn on a later engine | only how often the row says "Send a message…" |

## Proof that an executor does not run

| | what | when | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **The sign-in scene**, in a gate job on the Mac mini runner (binding 11) | after M4's hand-back | `e2e:discover` with the "dynamic" scene's first new step: the real engine under a scratch configuration directory and the scene's own Keychain custody, the OAuth fixture in engine mode, and whatever switch the gate needs for an engine sign-in on that runner. Never on the MacBook in any form. The step gives its session a turn by `/cost`, which calls no model and costs nothing | that a plugin's row signs in through MAWS's redirect and ends signed in; a red step goes back as a fix. The run's record names the engine's version, since the facts here were run on 2.1.322 |
| P2 | **The other scenes**, on a Mac under the load rule | after M4 | the collision step of the same scene (no sign-in) and `e2e:widgets`' scene alone first; then `e2e:discover`, `e2e:widgets`, `e2e:settings` and `default` | verdicts by group |
| P3 | **The branch review** | after M4 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11h` (Decision Log) | a verdict and findings; the fixes are one wave |
| P4 | **Class 1a** | on the head handed back, and on the final head | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11h`, in the background; whether the wire's minor also asks for the cross-build group with build F as the peer is the architect's | the run's id |
| P5 | **One more probe case, not a gate** ("Reported", 2) | any time | engine `2.1.322`, a scratch home, a plugin installed from a marketplace cloned from a repository: its `version` and `path` in the session's plugin list against `installed_plugins.json` | the version comparison stays, or its one branch goes |

## The owner's look

No drawn example is needed before the build. The row was drawn with the Customize page ("tides · from Tide Tables", frames 1, 2 and 7 of that example) and the owner chose full rows. What no frame drew is the nine lines of §E's table; they are words in a state's place, proposed in §G for the architect's ruling ("Reported", 6), and are shown to the owner on the built page at the wave's sitting.

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, landing U11h" and the parent pin; names the probe it rests on, its class 1a run, its review verdict and its residue (Concrete Steps 6); states the sign-in rule in its four parts and what is not proven; and lists the dated lines it carries ("The record"). It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

- Observation: nothing a session says of a plugin's server names its plugin; only the session's plugin list does, through the name.
  Evidence: the findings, 2; the record [2], `status.servers[].keys` and `init.plugins`.
- Observation: the plugin list the rule needs is already delivered to the services and the window; the sign-in service narrows it away.
  Evidence: `onSessionStatus` in `src/services/connectors/sign-in.ts` against `EngineSessionStatus.plugins` in `src/shared/engine/status.ts`; the wiring in `src/services/spine-root.ts`.
- Observation: a session reports the plugin's folder in its marketplace, not the folder the installation records, so the two paths cannot be compared; their versions can.
  Evidence: the record [1] `installedEntries` (`installPath` under the plugin cache) against [2] `init.plugins` (`path` under the marketplace).
- Observation: a session has no plugin list before its first turn, though its status already lists its servers.
  Evidence: U11a's document (gate run 43386195217); the probe's method, which sends `/cost` to get `system/init`.

## Decision Log

- Decision: the verification this landing gets. This document gets an adversarial review before an executor starts; the architect dispatches it, and sends the document back once for the pass over "Statements to check again". Each milestone is reviewed at its boundary: M1's and M2's before M3 consumes them, and M2's alone, since it is the rule. The branch gets `doperpowers:review-code` at the **xhigh panel**: by the architect's ruling it is reviewer-high at least, because the rule touches credentials across plugins, and the panel if it passes about twenty files; by this document's count it is about forty files and about 2,350 lines. The panel's lenses: (1) the rule: a press from a row can never reach `mcp_authenticate` for a server of another plugin, another transport or another address; try the collision in both orders, a plugin of the name with another key, a templated path that matches too much, a `${…}` in the origin, a stale revision, a list not yet reported, a press with the window bypassed; and that U11a's two other presses are untouched; (2) what crosses: no address, command or argument in anything the window receives; nothing to another machine; (3) the two builds: the minor is additive, both tolerant directions, the coverage mark; (4) the row's words against what the code knows at that moment: no line claims more than was observed, and the collision's line names the remedy; (5) the tests: each "held open" case holds its sequence open. Class 1a on GitHub Actions is the gate of record.
  Rationale: the root gives the panel to a branch of panel size (UC-10); the first lens is the reason this landing was cut out of U11c.
  Date/Author: 2026-11-14, the author of this document.
- Decision (the architect's rulings, 2026-11-14 UTC, carried from U11c's review and written on the probe's findings): the sign-in rule in its four parts, with the inventory-side check as a second net for the row's words; "fails safe" is not a reason anywhere; the probe is a gate and has answered; "Not in the attached session" is information; the rows travel as an optional array and the coverage string stays a mark; the wire's minor is the next free one at the chain merge; the two-builds test is over representative answers; the name is proven for marketplace plugins and null for a built-in one; a row whose engine name MAWS's schema cannot carry is listed with no Sign in; "Plugin turned off" covers all three scopes; the collision's line says the reason and the remedy.
  Date/Author: 2026-11-14 (UTC), the architect; recorded by the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
