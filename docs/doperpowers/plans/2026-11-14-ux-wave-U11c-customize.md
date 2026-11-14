# UX wave · U11c · Customize: My items and Discover, an image for every item, a plugin's connectors in the list (2026-11-14)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11** (`docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`), landing **U11c**, parent pin master `c7b62e48b176dceba1620d16865dac2bef23b1b2`.
> **Where the design is.** The child's file: its two items "O-14" (the structure; the images) and its item "X-184", with Acceptance A16, A17, A18 and A20, the Contracts' lines on UC-8, UC-12 and UC-14, bindings 9, 13 and 14 of its Design inheritance, and its "Waiting" entry "A plugin's connector that the engine drops". This document carries the constraints, the milestones and what the code adds to the design, and nothing of the design itself.
> **Branch:** `ux-wave/U11c`, from the parent pin; master is merged in before anything is built (Concrete Steps, 1). **Stands on:** U11a (`docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md`) and U7b (`docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md`), both on master with their code, and on **U11g** (`docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md`), which is in build at this writing and lands first: this document is written for a tree that holds it ("Statements about U11g's code").

## Purpose

Today Customize asks a person to pick a kind first (Plugins, Skills, Connectors) and then, inside each, My items or Discover; each kind keeps its own choice, its own search and its own tools. Nearly every connector and every installed plugin is drawn with the same grey glyph or no image at all. And a connector that a plugin brings is not listed until a session runs in that folder.

After this landing the page opens on what the person has: My items | Discover at the top, and under it "Show: All · Plugins · Skills · Connectors". All is one list of everything this Mac has for the project, each row the row its kind's own list draws, so a plugin's menu, a skill's detail and a connector's Sign in and Remove work from it. Every row and card has an image: the directory's icon where MAWS holds a record of the item with one, else the item's letter on a colour that is the same wherever the item is drawn. A plugin's connectors are listed with the others, with no session running, as "<server> · from <plugin>", and can be signed in from there while a session holds them.

The page is also the one a later landing puts connector switches on (board ticket 476); what that landing reads from this one is named in §J and nothing of it is built here.

How to see it working: Acceptance, C1 to C14.

## Progress

- [x] (2026-11-14) This document written against master `c7b62e48b`; the code statements in "What the code says today" checked at that commit, and U11g's document and first milestone read on `origin/ux-wave/U11g` at `018f471f2`.
- [ ] The adversarial review of this document (the architect dispatches it).
- [ ] The one pass over "Statements about U11g's code" once U11g is on master (the architect sends this document back for it before an executor starts).
- [ ] M1 — The inventory lists a plugin's connectors; the sign-in checks the configuration a plugin's row showed.
- [ ] M2 — One image component, the letter tile, the directory's icons on installed items.
- [ ] M3 — The page: My items and Discover outside, Show inside, one place that holds what a person started.
- [ ] M4 — A plugin's connectors in the list, with Sign in; the lists before a chat starts.
- [ ] M5 — My items, All; one search.
- [ ] M6 — Discover, All.
- [ ] M7 — The record, the e2e scenes written, the whole checks, the hand-back.
- [ ] The architect's: the e2e scenes on a Mac, the branch review, class 1a, the pull request (Proof, P1 to P4).

## Statements about U11g's code, to check again once it is on master

U11g (`origin/ux-wave/U11g`) had landed its first milestone of three when this was written: the command, the shared rules and the runner. Its window part (its M2) and its sentence (its M3) are known here only from its document. Each line below is a statement this document rests on; the pass replaces "its document says" by what master holds, and corrects the place this document names where they differ.

| | the statement | this document rests on it in |
|---|---|---|
| G-1 | The action is one button, labelled "Add custom connector…", mounted in `ConnectorsSection`'s My items toolbar (`data-customize-toolbar="mcp"` in `customize/connectors/ConnectorsSection.tsx`), before Refresh, and drawn in My items only. No key, no keymap row, no palette entry. | M3 (the move to the head), §D "The head", C13 |
| G-2 | It opens the sheet by the section's own `ask`, with `requestFor('mcp-add', { name: '', scope: 'user', entry: { type: 'http', url: '', headers: [] } }, null)`; `ConnectorSheet` draws the custom sheet for an `mcp-add` request whose input holds an `entry`, and that sheet takes what `ConnectorSheet` takes (`request`, `env`, `onConfirm`, `onClose`). | M3, §D "One place that holds what a person started" |
| G-3 | The sheet's read at its opening, and Add's wait for an answer newer than the opening, need nothing from the section but `env.configured` and `env.retryServers`; `CustomizeView.tsx` was not edited by U11g. | M3 (the page passes the same two from its one inventory read) |
| G-4 | An add's line is keyed `connector:add:<scope>:<name>` and drawn by `Gone` at the head of the configured list while its operation works or has failed; a succeeded add draws nothing there. | §E "Results with no row", M4, M5 |
| G-5 | `OperationBook.run` (`widgets/plugins/operation.ts`) sends `connectors.addJson` with `folder` for a request whose input holds an `entry`, and keeps the masked form of that request (`mcpShown`), so nothing the book holds contains a header's or a variable's value. | §D (the book becomes a kept one: what it holds is held for the run of the app) |
| G-6 | U11g's M2 says: "the section is keyed by its folder, so choosing another project closes the sheet and drops the lines". After U11c the sheet still closes, and the lines are kept for the place (§D). U11g's "a failed line stays until an add of the same name and scope replaces it or the page changes" becomes "until an add of the same name and scope replaces it". | §D, "One place that holds what a person started"; one dated line in U11g's document (The record) |
| G-7 | `forgetSignIn({ name, scope, cwd })` after a successful connector change stays in the connector manage's `onConfirm` and serves a custom add too. | M3 |
| G-8 | `WIRE_MINOR` is 47 on master with U11g ("the UX wave's U11g: connectors.addJson"). This landing takes the next number. | M1, Concrete Steps 3 |
| G-9 | The tests U11g adds to `customize/CustomizeView.test.tsx` and its scene in `e2e/discover-connectors.spec.ts` find the action through today's structure (the tab panel named Connectors, the My items radio inside it). They are moved with the head, their assertions kept. | M3, M7 |
| G-10 | `widgets/copy.ts` holds U11g's sentence in `MCP.reach`; this landing edits two other entries of that file (`LIBRARY.show`, `BEFORE_START.connectors`) and not that one. | "Files both landings edit" |
| G-11 | The lists of commands that U11g's command joined (`src/shared/ipc/schema.test.ts`, `test/support/cross-build-samples.test.ts`, `test/endpoint/artifact-rows.test.ts`, `src/shared/ipc/routes.json`) are where this landing's one new command of main and its one refusal test go. | M1, M2 |

**Files both landings edit** (U11g first; this branch merges master and keeps both): `src/renderer/src/customize/connectors/ConnectorsSection.tsx`, `ConnectorSheet.tsx`, `copy.ts`, `present.ts` and their tests; `src/renderer/src/customize/CustomizeView.test.tsx`; `src/renderer/src/widgets/plugins/operation.ts` and `present.ts`; `src/renderer/src/widgets/copy.ts`; `e2e/discover-connectors.spec.ts`; `e2e/widgets.spec.ts`; `src/shared/ipc/wire.ts` with `wire-manifest.json` and `wire-fingerprint.json`; `src/shared/ipc/routes.json`; `src/shared/ipc/schema.test.ts`; `test/support/cross-build-samples.test.ts`; `test/endpoint/artifact-rows.test.ts`; `docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md` (one dated line each). Not edited here: `src/shared/plugins/` (U11g's rules), `src/engine-host/plugins/runner.ts` and `cli-result.ts`, `widgets/McpWidget.test.tsx`'s and `McpDriven.test.tsx`'s sentence patterns.

**Where U11g's action and sheet sit in the new structure.** The words and the sheet do not change. The button stands in the head's second row, among the tools at its right, before Refresh, in My items while Show is Connectors or All (the child's "Waiting" entry for l8-settings-05 names both), and nowhere in Discover. The sheet is drawn by the page's one place that holds what a person started (§D), over the page, whichever Show value was chosen when it opened. The add's line stands at the head of the connector rows: of the Connectors list, and under All of the connectors' part (§E).

## The landing's edge

**In.** The child's table of landings gives U11c three things: O-14's structure; the image component, the letter tile and the directory's icons on installed items; X-184.

**Not included, each a landing of its own** (named so that nobody builds it here):

| landing | what it holds, and what this landing leaves for it |
|---|---|
| U11b · the default writer | Nothing shared but `widgets/copy.ts`, in other entries (the table's "touch no file in common" is corrected under "The table's columns, checked"). |
| U11d · connector icons | The favicon route, the kept copies, the switch "Connector icons" and its Settings row, `site` on a catalog item and on a posture, `catalog.favicon`, the amendment of the aggregator spec's Decision Log 7(b) and the four code headers that cite it. **This landing fetches no site icon.** It leaves one named place: `ItemImage` (§C) has a fixed box that the tile fills first, and U11d adds one prop, `site`, and one read between the directory's icon and the tile. |
| U11e, U11f | Untouched. Sign in from a plugin's row runs through a session on this Mac only. |
| the connector switches (board ticket 476) | The two switch columns, rows for connectors that are off, the record, the default, the acts. §J names what it reads from this landing. No switch, no column, no record and no sentence about them is built. |
| the move of MAWS's own list; "New skill…", Open and Reveal on a skill's detail; a skill's switch | Untouched (the child's "Waiting"). |

Also not included (the child's "Not included" of the three items): counts on the Show choices; one list across kinds ordered by name; a card for a single skill in Discover; Customize for another machine; any change to the session's `/plugins`, `/skills` and Connectors dialogs beyond the images and the word "Filter"; icons in a session's Connectors dialog, in the "+" › Connectors submenu or on the Connectors card; skills that a marketplace declares and no folder holds; a switch per plugin connector; any change to how a plugin is turned off.

**The table's columns, checked against the code.**

- *"after: U11a; either side of U7b".* U11a is on master. U7b is on master too, so "either side" is settled: Customize is a page, the stored tab is gone, and the item's paragraph "While Customize is still a stored tab" describes a build that no longer exists. Where the page is, is U7b's `destination` key, whose schema already holds both fields with `all` among them (`DestinationSchema` in `src/shared/ipc/schema/layout.ts`). U7b left three stand-ins that this landing retires: `SECTION_OF_SHOW` and `SHOW_OF_SECTION` (`destination/customize.ts`), `requestDiscover` and `customizeDirectory` (`destination/discover.ts`), and the request store `useDiscoverRequest` with `takeDiscoverRequest` (`customize/open.ts`).
- *"after": one more.* U11g lands before this one (the architect's order); the table does not name it.
- *"review: the panel by size".* Holds, by more than the table suggests: about 5,800 changed lines in about 75 files ("Size").
- *"U11b and U11c touch no file in common".* One: `src/renderer/src/widgets/copy.ts` (U11b's words under the model list are `SELECTOR.sessionOnly` there; this landing's are `LIBRARY.show` and `BEFORE_START.connectors`). Different entries, so the merge is clean; they can still run together.
- *The table's last sentence* ("the tile and directory icons can move ahead of the structure; the cost is drawing them into three section bodies that U11c then moves") is taken in a cheaper form: the rows and cards are components that the structure moves and does not rewrite, so M2 draws the images into them before M3 moves the bodies, and nothing is drawn twice.

## Words used here

- **The page** is the Customize page, U7b's destination `{ kind: 'customize'; view; show }`. **Where** it is, is those two fields. Its **place** is the folder it is about: a project of this Mac, a folder no project has, or the user configuration (`customizePlace` in `destination/discover.ts`).
- **A kind's body** is what one Show value draws under the head: the plugin list with its loaded line and groups, the skills' groups, the configured connectors with the live list under them, or that kind's Discover.
- **The attached session** is the ready session MAWS runs on this Mac in exactly the page's folder that the "Live session" picker names (`attached` in `CustomizeView`). A page never starts one.
- **The inventory**, **MAWS's own list** and **dynamic** are the three words the child's file defines before its first item.
- **A plugin's connector** is a server that an installed plugin's files declare. Three names belong to it, and they are kept apart throughout: its **server name**, as the plugin's file writes it; its plugin's **key**, `<name>@<marketplace>`, by which the plugin is installed and My items lists it; and its **engine name**, `plugin:<manifest name>:<server name>`, under which a session's status lists it.
- **The book** is the set of operations a person started on a page and their lines (`OperationBook` in `widgets/plugins/operation.ts`); a **kept** book is found again by its name after the views that showed it have gone.
- **The held copy** is what main's catalog store has on disk of the network sources (`CatalogStore`, `src/main/catalog/store.ts`): `loaded()` reads it and fetches nothing; `ready()` may refresh.
- **Build F** is `f1852de3a`, the build on the owner's machines.

## What the code says today, beyond the section

Checked at the parent pin. Numbered so that milestones can point.

1. **The page already has its two fields, and nothing writes one of them.** `DestinationSchema` admits `view: 'mine' | 'discover'` and `show: 'all' | 'plugins' | 'skills' | 'connectors'`; `openDestination` with the same kind changes only those fields and closes the Settings dialog (`stores/layout.ts`). `DestinationPage.tsx` turns `show` into a section for `CustomizeView` (`all` as Plugins) and delivers `view: 'discover'` to the plugin library alone, through `useDiscoverRequest`. No opener writes `all`.
2. **Three sections, three states.** `CustomizeView` keeps each section mounted once visited (`forceMount`), because each holds its own operations and sheet: the plugin library's `useManageState` with the kept book `customize:plugins:<folder>` (`widgets/PluginsWidget.tsx`, `LibraryBody`), `SkillsManage` with the kept book `customize:skills:<folder>` (`customize/discover/SkillsDiscover.tsx`), and `useConnectorManage` with a book that is **not** kept (`customize/connectors/ConnectorsSection.tsx`: `usePluginOperations()` with no name). So a connector's line is lost when the page is left or the project changes, and a plugin's is not. Each body is keyed by the folder, so a change of project resets details and sheets; `PluginsLibrary`'s comment gives the reason ("an old request cannot silently become a change in a different project"), and the test "Customize: an add-then-install outlives a change of the page's project" (`customize/discover/Discover.test.tsx`) pins the kept books.
3. **One component is both the session's dialog and Customize's plugin body.** `LibraryBody` serves `presentation.variant` `modal` (the session's `/plugins`) and `embedded` (Customize), and holds the view (`tab`), the selected plugin, the marketplace dialogs and the manage state. Its head is `WidgetFrame`'s, whose embedded variant carries `heading`, `toolbar` and `scope`.
4. **Two `ask`s behind one context.** A Discover card's `+` calls `useManage().ask(key, request)` (`customize/discover/CatalogCard.tsx`). Under the plugin and skill bodies that opens the install sheet (`ConfirmSheet`); under the connector body the same call opens `ConnectorSheet`, because that body provides its own `Manage`. One grid that mixes plugins and connectors needs one `ask` that chooses the sheet by the request's action.
5. **Search, filter and sort are shared with the session's dialogs.** `MyItems` and `DiskSkills` read `useLibraryStore` (`widgets/plugins/library-store.ts`), which the session's `/plugins` and `/skills` read too, "for the app run". The connector list has no search field. Discover's choices are per kind in `useDiscoverStore` (`customize/discover/store.ts`).
6. **Images.** `CatalogIcon` (`customize/discover/CatalogIcon.tsx`) draws `item.iconUrl` through `catalog.icon`, else `monogramOf(item.name)` in a neutral box, and marks itself `data-catalog-icon="image" | "monogram"`. `PluginTile` (`widgets/plugins/PluginRow.tsx`) is one glyph, used by the plugin row, the loaded-only row (`LoadedView.tsx`) and the built-in mods (`BuiltInMods.tsx`); the plugin's detail draws the glyph itself (`PluginDetail.tsx`); `SkillTile` (`widgets/skills/SkillsLibrary.tsx`) draws "/" or a document glyph; `ServerRow` has no image.
7. **`catalog.icon` can reach the network; `catalog.postures` cannot.** `CatalogIcons.dataUrl` (`src/main/catalog/icons.ts`) answers from `catalog/icons/<sha256 of the URL>.json` and otherwise asks the URL, only when `isIconUrl` admits it (the two icon routes of `CATALOG_EGRESS`), four at a time. `catalog.postures` awaits `store.loaded()` and reads `store.data()`: the held copy, no fetch. Building a folder's whole catalog (`catalogOf`) is a different cost: it asks the machine for the engine's view, which runs the engine's CLI, and `e2e/widgets.spec.ts` pins that the session's `/plugins` does not cause it ("the catalogue is read only once Open Discover shows it").
8. **A directory record knows a plugin by its repository, not by `name@marketplace`.** The join (`src/main/catalog/join.ts`, `pluginItem`) ties a record to the marketplace routes that install it; a `CatalogItem` carries the chosen route and only the names of the others (`alsoListedBy`). An installed plugin's id is `<name>@<marketplace>` (`PluginIdentity.id`).
9. **The inventory reads a plugin's folder for skills and not for servers.** `installedSkills` in `src/engine-host/customization/inventory.ts` walks `installed_plugins.json`, keeps the installations that apply to the folder (user scope, or a project path the folder is under), reads `.claude-plugin/plugin.json` for the manifest's name (`pluginNameOf`), and adds the coverage warning once per installation. What a plugin's files declare as servers is read by another reader with other bounds, for "What's inside": `Inventory.mcpServers` in `src/engine-host/plugins/manifest.ts` (`.mcp.json`, then the manifest's paths and inline maps; a `.mcpb` or `.dxt` bundle is counted and never read; a URL where a path belongs is a problem). It keeps a name and a transport, no address and no file.
10. **The coverage sentence is a value on the wire.** The engine host sends `CUSTOMIZATION_INVENTORY_COVERAGE` as one of `warnings`, and the window finds it by equality (`customize/InventoryState.tsx`): an equal string is the folded note, any other string is listed under "Some configuration could not be read". Build F holds the same constant.
11. **An added member of an enum is a wire major.** `src/shared/ipc/wire.ts`: "a changed type, `const`, `enum` or union member set (an added enum member included, since an older reader refuses it)". `customization.inventory` and `customization.serverEndpoints` are owned by the engine host and are in the manifest. A new optional property at any depth is a minor. A receiver whose peer may be another build reads with `readTolerant` (`src/shared/ipc/tolerant.ts`), which drops a key it does not know; both pairs exist on one Mac (this build's app relays build F's engine host until it is idle, and build F's app runs over this build's `mawsd`: the scenes "(update, daemon)" and "(build F's app, unit mawsd)" of `e2e/cross-build.spec.ts`).
12. **The engine names a plugin's server by the manifest's name.** Engine `2.1.322`: a loaded plugin's `name` is its manifest's (`cli.pretty.js:496452`, `name: ne.name`, with the key kept beside it as `source`), and its servers are named `plugin:${name}:${server}` from that (`:474842` calling `:474719` to `:474729`). For a plugin of the engine's own built-in marketplace the name passes through one more function (`:954009`); no installed plugin is one. This agrees with probe P3 for a plugin's skills (`spikes/protocol-probe/findings-uxwave-u11-skill-names.txt`). **It is a reading, not a run:** no recorded fixture holds a plugin whose manifest name differs from its key and that brings a server ("Reported to the architect", 3).
13. **The sign-in of a dynamic connector checks an entry only for MAWS's own list.** `dynamicRefusal` (`src/services/connectors/sign-in-entry.ts`) looks a press's `entry.revision` up among entries of scope `app`; the services read `customization.serverEndpoints` with `cwd: null` for it (`check` in `src/services/connectors/sign-in.ts`). U11a's document says of its interfaces: "X-184, whose rows for a plugin's connector will need a revision of their own".
14. **Before a chat starts,** the "+" › Connectors submenu (`widgets/connector-menu.ts`) and the dialog (`McpBeforeStart` in `widgets/McpWidget.tsx`) list `usedEntries(inventory.servers)`, under `BEFORE_START.connectors`: "Configured for <place>. Connection state, and connectors from plugins, show once the chat starts."
15. **Customize cannot show another machine.** Its project list is cut to this machine's (`machineOf(id) === ipc.localMachine`), the inventory, the plugin reads, the catalog reads and every operation are sent with `{ machine: ipc.localMachine }`, and the live and signing sessions are filtered to this machine's (`CustomizeView.tsx`, `customize/inventory.ts`, `widgets/plugins/read.ts`, `customize/discover/read.ts`, `widgets/plugins/operation.ts`, `ConnectorsSection.tsx`). `src/endpoint/offers.ts` has no row for `customization.inventory`, `customization.serverEndpoints` or any `catalog.*` command.
16. **The eight author colours are theme colours.** `--author-1` to `--author-8` (`styles/tokens.css`, both themes) are exposed as `--color-author-1` to `-8` (`styles/app.css`), so `bg-author-3` and `text-author-3` are token utilities. No renderer source uses one with an opacity modifier yet. The tokens guard (`test/support/tokens-guard.ts`) reads source text for hex colours, colour functions and palette classes.
17. **The e2e scenes that hold today's structure** select `getByRole('tab', { name: 'Plugins' | 'Skills' | 'Connectors' })`, `getByRole('tabpanel', …)`, the tab list named "Customize sections", `[data-widget="plugins"][data-widget-variant="embedded"]`, `[data-catalog-icon]`, and the button named "Show" (the list is under "The e2e groups").

## Reported to the architect

Each is written to its recommended default, in one named place, so that a ruling changes that place and nothing else.

1. **X-184's rows cannot be a fifth value of `scope` on the wire** (code, 11). The item says "the scope `plugin` (a fifth value beside `app`, `user`, `project`, `local`)", and its "Probes and checks" left the question for the plan. Both builds can meet on one Mac, and an added enum member is a major. **Default:** the rows travel as a new optional array, `pluginServers`, on the two answers (§A): a minor; build F's main drops the key and its window is answered as today. In the window the row's scope is `plugin`, as the item says. *Named place:* §A.
2. **The coverage sentence cannot change on the wire** (code, 10). Changing the constant would make build F's window list the new sentence under "Some configuration could not be read", and this build's window do the same with build F's. **Default:** the string on the wire stays byte for byte and is only a mark; the window words the note itself: the item's sentence when the answer carries `pluginServers`, today's sentence when it does not (an engine host of an earlier build, of which today's sentence is true). *Named place:* §G, `COVERAGE`.
3. **Which name the engine gives a plugin's connector where the manifest's name and the key's differ is read in the engine's code and not run** (code, 12; it is the open check 10 of the connector-switch design). **Default:** the engine name is built from the manifest's name, and is null where that name cannot be read; a wrong name fails safe, because Sign in is offered only while a session's own status lists that exact name and the services refuse a name the session does not list. The row carries the key, the manifest's name and the engine name apart (§A), so the later landing can treat a plugin whose two names differ as unresolved. An engine fact the recorded fixtures do not hold is the architect's: one wire probe on `2.1.322`, a scratch plugin whose manifest name differs from its key and that declares one server, reading `mcp_status`. Nothing in this landing waits for it. *Named place:* §A, `name`.
4. **What a plugin's connector says when no session will ever hold it** (the child's "Waiting", handed to this document). **Default:** three muted lines in the state's place, each with no Sign in, first that holds: "Not loaded: same address as <name>" when a `user`, `project` or `local` entry of the same read has the same address, compared as written and only for an address with no `${`; "Plugin turned off" when the page's plugin read says its plugin is not enabled here; "Not in the attached session" when the attached session's status has answered and lists no server of its engine name. Before a chat starts, the "+" › Connectors submenu and the dialog leave out a row of the first kind and a row whose plugin the launch profile turns off. *Why not less:* with no line, such a row reads "Sign in needed · Open a session, then sign in" for ever, with a session open beside it. *Why not more:* MAWS does not copy the engine's rule for normalising addresses or its second rule (a later plugin's server that repeats an earlier plugin's); the third line covers what the first misses, by observation. *Named place:* §E, "A plugin's row".
5. **"No request leaves the app in this landing" holds for new routes and not for old ones.** The item's first source is "the directory's own icon", new "for an installed plugin and for a configured connector"; its bytes come from `catalog.icon`, which asks one of the two approved addresses when no kept copy is on disk (code, 7). So My items, and the session's `/plugins` dialog, which draws the same rows, can now cause a request that only Discover caused before: the same route, the same two hosts, a URL that the directory's record itself names, kept on disk afterwards. No new route, no new host, nothing of the person's configuration in any request. **Default:** as the item is written. The other reading (a row outside Discover draws a directory icon only when its copy is already on disk) would be one option on the image's read and one branch in main. *Named place:* §C, "Where the bytes come from".
6. **A connector bundle (`.mcpb`, `.dxt`) a plugin ships is not listed,** because no reader opens one (code, 9), while the note stops saying that plugin connectors are missing (A20). **Default:** the note is the item's sentence and nothing more; the gap is a residue row. *Named place:* §G, `COVERAGE.now`.
7. **Where the drawing and the file differ**, the file governs; these are the differences, each with what is built.
   - The drawn Discover frames have no "Live session" picker; the file's head has it "while a session MAWS runs on this Mac is ready in that folder", with no view named. Discover uses no attachment. **Built:** in My items only (law 3). *Named place:* §D, "The head".
   - The drawn Plugins and Skills shelves of Discover › All hold a community item each. The file says "one shelf per kind" and nothing on this; the aggregator spec's ruling that community items stand on no shelf is not among the rulings reversed. **Built:** a kind's shelf holds no community item; they are in the grid and under the kind's own Discover. *Named place:* §F.
   - The drawn search grid has a sort control reading "Installs". The file gives the grid one order ("matches on the name first") and says that installs and rank do not mix. **Built:** name matches first, then by name; no sort control under All. *Named place:* §F.
   - The drawn All has only the search field and Refresh at the head's right, as the item's "The head" says; the child's "Waiting" entry for l8-settings-05 puts "Add custom connector…" there "while Show is Connectors or All", and the drawing predates that form. **Built:** the action under both.
   - The drawn search fields read "Search my items" and "Search connectors"; the file gives no label. **Built:** those two, beside today's "Search plugins" and "Search skills". *Named place:* §G.
   - The drawn empty All shows no built-in mod. **Built:** the empty state is decided by plugins, skills and connectors; the built-in mods are drawn under All only beside at least one such row, and always under Show: Plugins. *Named place:* §E.
8. **Size.** The landing is about three times the panel's threshold ("Size"). If the architect would rather review it in two, the cut that costs nothing is after M3: X-184 (M1 and M4) as its own pull request on top of the structure. This document does not make that cut.

## Acceptance

Each line is behaviour a person can see or a test shows; the milestone that proves it is named in the Plan of Work.

- **C1 · Two views and one filter** (A16). The page's head shows My items | Discover and, under it, "Show:" with All, Plugins, Skills, Connectors, exactly one chosen; no tab named Plugins, Skills or Connectors is left. With Connectors chosen in My items, pressing Discover shows Discover's connectors; pressing My items again shows the configured connectors. The stored `destination` holds what was chosen, and a relaunch opens the page there.
- **C2 · What a person started outlives the view** (A16). An install started from a Discover card keeps running after Discover is left for My items and after Show is changed, and its line is on the item's card and, once installed, on its row; a connector's removal and a sign-in behave the same. After the project is changed and chosen again the line is still there.
- **C3 · Ways in** (A16). The sidebar's Customize row and Settings' "Customize ›" open My items, All. The composer's "Manage connectors…" opens My items with Connectors chosen, "Manage plugins…" with Plugins. The session's `/plugins` dialog's "Open Discover" opens Discover, Plugins, for the session's folder. A Discover card that reads "Installed" opens My items with the item's kind chosen, a plugin on its detail when My items lists it.
- **C4 · All lists what this Mac has** (A17). In My items with All chosen, on a project with two plugins, three skills and two connectors, the list has seven rows beside the built-in mods: the plugins, the mods, the skills, the connectors, each part by name, no heading between them; each row ends in one word, Plugin, Mod, Skill or Connector, in one column. A plugin's menu, a skill's detail and a connector's Sign in and Remove work from this list. Typing in the search narrows all parts, and the text is still there after Show is changed. With nothing installed or configured the list reads "Nothing here yet. Find plugins, skills and connectors in Discover." and its button opens Discover.
- **C5 · One failed read hides nothing else** (A17). With the plugin list unreadable, All shows the plugins' own failure line with Retry in the plugins' place, and the skills and connectors under it.
- **C6 · Every item has an image** (A18). No row or card of a plugin, a skill, a connector or a built-in mod is drawn without one, in Customize and in the session's `/plugins` and `/skills` dialogs. An item with no icon shows its letter on one of eight colours, the same letter and colour in My items, in Discover, in its detail and after a relaunch. An installed plugin that the directory lists with an icon shows that icon in My items, and a configured connector whose address matches exactly one directory record with an icon shows that record's icon. The row does not move when an icon arrives.
- **C7 · Nothing new is asked** (binding 13; "Reported", 5). With the catalog's egress rule recording, drawing My items, All and both Discover homes makes requests only to the two icon routes that `CATALOG_EGRESS` already lists, each for a URL a directory record names; none to `gstatic.com` or any other host; none for an item the directory does not list. `CATALOG_EGRESS` is unchanged.
- **C8 · A plugin's connector is listed and signs in** (A20). With an installed plugin that brings a connector, and no session running, My items lists it under Connectors and under All as "<server> · from <plugin>", with its image and no Remove; "from <plugin>" opens the plugin's detail. The folded "Inventory coverage" note reads "Skills that a marketplace declares but no folder holds are not listed; see Plugins." While a session MAWS runs on this Mac holds the connector and it needs a sign-in, the row offers Sign in and ends "Signed in · connected here"; with no such session it says "Open a session, then sign in". In a new chat, "+" › Connectors lists it before the first message, and the dialog's line reads "Configured for <place>. Connection state shows once the chat starts."
- **C9 · A plugin's connector that nothing will load says so** ("Reported", 4). Each of the three lines, in its case, with no Sign in.
- **C10 · Sign in from a plugin's row signs in what the row showed** (U11a's §A, extended). A press sends the revision of the configuration the row was drawn with; where the plugin's file has changed since, or the session's server is of another transport or address, the operation ends before the engine is asked, with its sentence.
- **C11 · Discover, All** (O-14). The home is the Featured plugin and three shelves, Plugins, Skills, Connectors; a shelf's "See all" chooses that kind in Show. A search or a chip turns the page into one grid across kinds, in which each card says Plugin or Connector beside its name; a connector's `+` there opens the connector sheet and a plugin's the install sheet. No Category menu and no sort control are drawn under All.
- **C12 · This Mac only** (bindings 9 and 14). The page lists this machine's projects and folders and nothing of another machine's; a new chat set to another machine still reads "Shown once the chat starts on <machine>"; `customization.inventory` and `customization.serverEndpoints` are refused to a caller on another machine; no command this landing adds or changes is sent to another machine.
- **C13 · Build F, and nothing stored** (UC-14). This landing adds no layout key, no settings key and no file of a new kind. Build F's reader accepts this build's two answers and drops `pluginServers`; this build's reader accepts build F's answers, lists no plugin connector and words the coverage note as today.
- **C14 · U11g's action, and the narrow page.** "Add custom connector…" stands at the head's right in My items under Connectors and under All, opens U11g's sheet, and its tests pass moved. At 400 px the head stacks as the item's "Narrow" gives it and the four Show choices stay on one line.

## Constraints that bind every milestone

- **The build brief binds.** No typecheck, lint, vitest, install, Electron or build on the MacBook; every check runs on the build VM in a checkout of the pushed head (Concrete Steps). The VM is shared with two other landings: a slow or timed-out check is read against its load first. A test that fails must fail in bounded time.
- **The engine is not run and not guessed at** (law 6). No engine runs on the MacBook. Every engine statement here is one the child's file, a recorded finding or the cited line of `cli.pretty.js` 2.1.322 holds; "Reported", 3 is the one that is a reading only, and the code fails safe on it.
- **Privacy** (UC-11, the architect's rule). A fault is never reproduced by reading the content of a person's session, settings file, configuration file or plugin folder: structure and counts only, and none of it enters the repository. Every name in a test, a fixture or a scene is invented, plugin, connector and skill names included. Nothing is copied from the drawn example beyond what the child's file says.
- **Nothing stored, nothing in a settings file** (UC-14). §H is the whole list. A milestone that finds it must store something stops and reports.
- **The wire moves by one minor, additively** (code, 11): two optional properties. No enum of a command or event the manifest holds gains a member. Run `pnpm exec vitest run src/shared/machine` when a schema of a command changes.
- **This Mac only** (bindings 9 and 14). Every read and operation of the page keeps `{ machine: ipc.localMachine }`; no offer row, capability or `remote-unavailable` entry is added.
- **Every request MAWS makes goes through a declared egress rule, and the window fetches nothing** (binding 13). `src/shared/net/egress.ts` is not edited. An icon is drawn only as image data in an `<img>` (`IMAGE_DATA` in today's `CatalogIcon`, kept).
- **Tokens only** (law 7). The tile's colours are `author-1` to `author-8`; no new token. In renderer source a ticket is written in words ("ticket 476"), never with a number sign; run `test/support/tokens-guard.test.ts` with every milestone that adds renderer source.
- **Keep means keep** (law 8; A15). What a row can do, what a sheet writes and what the session's dialogs do are not changed: a kind's body is moved whole. A milestone that finds a behaviour of a row, a sheet or a dialog changing beyond the images, the word "Filter" and what this document names stops and reports.
- **Files other children own** (UC-8). Named insertions only: in U7's `destination/` (M3: `DestinationPage.tsx`, `customize.ts`, `discover.ts` and `DestinationPage.test.tsx`: the page passes its two fields, and the three stand-ins of "The table's columns" go); in U13's sense of `customize/CustomizeView.tsx`, the current project read (`useCurrentRow`) is kept as it is; in `e2e/cross-build.spec.ts` (the P5 work's) nothing. `composer/plus-menu/PlusMenu.tsx` (U4's) is **not** edited: `openCustomize` keeps taking the names it passes. In files no child holds: `src/shared/ipc/wire.ts` and the generated wire files (one minor; made again after the last merge of master, right before the hand-back, by UC-8's row for them); `src/services/connectors/` (§B's check); `src/engine-host/plugins/manifest.ts` (two more fields on its server reader, only if M1 shares the rule that way); `test/endpoint/artifact-rows.test.ts` (one case beside U11g's).
- **Merge, never rebase or force-push.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e.
- If a command fails with "No space left on device": stop, report, delete nothing.

## Plan of Work

Seven milestones. M1 is the machine's side and is reviewed before M4 consumes it; M2 draws the images into rows and cards that M3 then moves and does not rewrite; M3 is the move itself; M4, M5 and M6 each add one thing to the moved page; M7 is the record and the whole checks. Until M5 (for My items) and M6 (for Discover), the Show value All draws what Plugins draws, as U7b left it, and no test asserts All's content.

**Size**, counted from the code (changed lines, tests included; files with the overlap between milestones counted once in the total):

| | changed lines | files |
|---|---|---|
| M1 | about 800 | about 18 |
| M2 | about 700 | about 24 |
| M3 | about 1,900 | about 28 |
| M4 | about 650 | about 14 |
| M5 | about 700 | about 12 |
| M6 | about 650 | about 14 |
| M7 | about 450 | about 12 |
| the landing | about 5,800 | about 75 |

### M1 — The inventory lists a plugin's connectors; the sign-in checks the configuration a plugin's row showed

**At its end** the engine host answers, beside today's rows, one row for each connector that an installed plugin's files declare for the folder (§A); main answers each one's posture, fingerprint and revision; and a press that names a plugin's connector with a revision is checked in the services against the plugin's entry as it is then (§B). Nothing in the window draws any of it yet.

**Touches.** `src/shared/ipc/schema/customization.ts`; `src/engine-host/customization/inventory.ts` and its test; `src/engine-host/plugins/manifest.ts` and its test, only if the one rule below is kept by extending its reader; `src/shared/ipc/schema/catalog.ts` (the postures' answer); `src/main/catalog/postures.ts`, `index.ts` and their tests; `src/services/connectors/sign-in.ts`, `sign-in-entry.ts` and their tests; `src/shared/ipc/wire.ts` and the generated wire files; one new test file beside `src/shared/ipc/send-now-builds.test.ts` for the two builds; `test/endpoint/artifact-rows.test.ts` (one case).

**Interfaces.** Exposes §A and §B. Consumes U11a's revision (`configurationRevision`, `revisionOf`), `pluginNameOf`, `holds` and `dynamicRefusal`.

**Decisions.**
- *One rule for what a plugin's files declare.* For an installation, the inventory lists the servers that "What's inside" lists for it (`readManifestView(…).components.mcpServers`): the plugin's `.mcp.json`, then the paths and inline maps its manifest names, first declaration of a name winning; a `.mcpb` or `.dxt` bundle and a URL where a path belongs are not listed and add no warning (a warning would be drawn as "Some configuration could not be read"). How the rule is shared is the executor's: the reader of `manifest.ts` extended to keep each server's address and declaring file, or the inventory's own `Reading` following the same rule. Either way the inventory's bounds hold (`INVENTORY_BOUNDS`: entries, bytes, the deadline, and `rows` as the cap of this list too), every file is read confined to the plugin's folder as the skills' files are, and a test pins that the two readers name the same servers for one invented plugin that uses all three ways of declaring. Lost: a second, independent reading of the manifest in the inventory; two rules for one question drift.
- *Which installations.* The ones `installedSkills` keeps for the folder. One row per key and server name: where a plugin is installed twice for the folder, the first installation in the file's order.
- *The address is compared as written.* `sameAddressAs` names a `user`, `project` or `local` entry of the same read whose address string equals this one's, only where the row's transport is `http`, `sse` or `ws` and neither address holds `${`; the highest in the engine's precedence (`local`, then `user`, then `project`, the order of `connector-precedence.ts`) when several do. MAWS's own entries are not compared (the engine does not compare servers given at launch: the child, l8-settings-01). This is the engine's drop as far as MAWS can know it without copying the engine's normalisation.
- *The revision* is `revisionOf` over the engine name, the transport and the address; null where the engine name or the address is null.
- *The services read the plugin's entry at the session's folder.* For a press whose name starts `plugin:` and that names an entry, `check` reads `customization.serverEndpoints` with the session's own folder (a plugin can be installed for one project), where it reads with `cwd: null` for MAWS's own list today.
- *The coverage warning* is still added once per installation, and its string is not edited ("Reported", 2).
- *The wire's minor*: the next after master's, with the comment "the UX wave's U11c: customization.inventory's and customization.serverEndpoints' pluginServers" (Concrete Steps, 3).
- *Pitfalls.* `serversRead` is about the files Add checks a name against and does not change (a plugin's engine name holds colons, which no configured name may). The inventory's test helpers build a scratch config home; no test reads a real one. A fixture with a key named like a credential needs the scan (Concrete Steps, 4).

**Does not touch.** The window. `customization.inventory`'s `servers` and `skills`. `connectors.signIn`, `connectors.signInServer`, the command's schema, the redirect. `src/endpoint/`. `src/shared/net/egress.ts`.

**Proves** the machine half of C8 and C9, C10, and of C12 and C13 what a test can show. Its tests pin:
- for an invented plugin: a server from `.mcp.json`, one from a manifest path, one from an inline map, each with its transport, its declaring file and its engine name built from the manifest's name; the same names as `readManifestView`; a bundle and a URL spec not listed; a file outside the plugin refused;
- a manifest whose name cannot be read: rows with `pluginName` and `name` null; a name whose engine name is longer than 128: `name` null;
- an installation for another project: no row; the same plugin installed twice for the folder: one row per server;
- `sameAddressAs`: equal addresses name the entry; a `${` in either, a `stdio` server, and an entry of MAWS's own list name none;
- `customization.serverEndpoints` carries each row's address and revision; `customization.inventory` carries no address in any field;
- postures for a plugin's row: the posture of the one record its address matches, null for none or several that disagree, a fingerprint, the host's revision;
- §B's table, row by row, at the function; and at the service, **held open**: the endpoints read is out while the status has answered, and `mcp_authenticate` is not sent before both have; the read fails: the operation ends with "that session's configuration could not be read"; the read is made with the session's folder;
- the two builds: build F's copy of the inventory's and the endpoints' answer schemas, read with `readTolerant` over this build's answers, accept them and drop exactly `pluginServers`; this build's schemas accept build F's answers;
- `customization.inventory` and `customization.serverEndpoints` answer `not-offered` to a caller on another machine (one case beside U11g's in `test/endpoint/artifact-rows.test.ts`);
- `wire.test.ts` classifies the change as a minor.

### M2 — One image component, the letter tile, the directory's icons on installed items

**At its end** every row and card of a plugin, a skill, a connector and a built-in mod draws `ItemImage` (§C), in today's three sections and in the session's `/plugins` and `/skills` dialogs: the directory's icon where there is one, else the letter tile. Nothing moves yet.

**Touches.** New `src/renderer/src/customize/image/` (the component, the tile's rule, their tests). `customize/discover/CatalogIcon.tsx` (retired into the component), `read.ts`, `CatalogCard.tsx`, `CatalogDetail.tsx`, `DiscoverHome.tsx`; `widgets/plugins/PluginRow.tsx`, `LoadedView.tsx`, `PluginDetail.tsx`, `BuiltInMods.tsx`, `MyItems.tsx`; `widgets/skills/SkillsLibrary.tsx`; `customize/connectors/ConnectorsSection.tsx` (the row's image). In main: `src/shared/ipc/schema/catalog.ts` with the command's name, route and grade rows where `catalog.postures` has its own; `src/main/catalog/index.ts`, `join.ts`, `postures.ts` and their tests. The tests that pin today's tiles: `customize/discover/Discover.test.tsx` (the icon's mark), `widgets/PluginsWidget.test.tsx`, `widgets/SkillsWidget.test.tsx`, `widgets/plugins/BuiltInMods.test.tsx`, `customize/CustomizeView.test.tsx`; `src/shared/ipc/schema.test.ts` and `test/support/cross-build-samples.test.ts` where they list commands.

**Interfaces.** Exposes §C. Consumes `monogramOf` (unchanged), `useCatalogIcon`, M1's postures rows.

**Decisions.**
- *`catalog.pluginIcons` reads the held copy and nothing else* (code, 7 and 8): `store.loaded()`, then a join of the network data with no engine view, built once per revision of the store; it never calls `ready()`, never asks the machine for the engine's view and never refreshes. So the session's `/plugins` dialog still causes no catalog read of the engine. A plugin installed from a marketplace that is not one of the seeds has no route in that join and gets its tile.
- *One read per list, not per row*: the list asks for the ids it draws; a row takes its URL from that answer.
- *The seed* (§C) decides both the letter and the colour, so that an item is the same in My items and in Discover: a Discover card's letter comes from its install name where it has one, no longer from its display name.
- *The "/" tile of an invocable skill goes* (the item); "Use in chat" says it.
- *No image* in the Connectors dialog, in its rows before a chat starts, in the "+" submenu or on the Connectors card (the item's "Not included").
- *Pitfall.* Tailwind sees a class only where its whole name is written: the eight colour pairs are one table of literal class names (§C). The component's mark changes (`data-item-image`), so the e2e assertions on `data-catalog-icon` change in M7.

**Does not touch.** The structure of the page. `src/shared/net/egress.ts`, `src/main/catalog/icons.ts`, `fetch.ts`. The four code headers that cite the aggregator spec's Decision Log 7(b) (U11d rewords them with the reversal).

**Proves** C6 and C7. Its tests pin:
- the tile's rule: the vectors of §C; the same seed gives the same letter and colour for a row, a card and a detail;
- **held open**: with the icons' read out, every row is drawn with its tile; when the read answers, the icon stands in the same box and no row is added, removed or reordered; when the read fails or answers null the tile stays;
- an installed plugin whose id a route of the held copy installs, and whose record names an icon on an approved address, draws that icon in My items and in the session's `/plugins` dialog; one with no record, or with an icon elsewhere, draws its tile and asks `catalog.icon` nothing;
- a configured connector whose address matches exactly one record with an icon draws it; two records, or none, draw the tile;
- in main: `catalog.pluginIcons` with a store whose refresh and whose machine read would count: neither is called; an id no route installs answers null; more than 512 ids are refused;
- with the egress rule's `get` recording (`CatalogIcons`' `get`), drawing the lists asks only URLs that `isIconUrl` admits; `CATALOG_EGRESS` is deep-equal to what it was (a snapshot of its routes in the test);
- an SVG icon's script and external reference neither run nor load (today's case, kept on the new component).

### M3 — The page: My items and Discover outside, Show inside, one place that holds what a person started

**At its end** the head is the item's two rows, the three section tabs are gone, each kind's body is drawn under its Show value in each view as it is today, and what a person started is held by the page for its place (§D). U11g's action stands in the head. All still draws Plugins.

**Touches.** `customize/CustomizeView.tsx` and the files the executor cuts from it (the head; where the page is and its in-memory state, `customize/page.ts`); `customize/open.ts`; U7's `destination/DestinationPage.tsx`, `destination/customize.ts` (removed), `destination/discover.ts` (left with `customizePlace`); `widgets/PluginsWidget.tsx`; `widgets/plugins/LibraryHeader.tsx`, `manage.tsx`, `MyItems.tsx`; `widgets/WidgetFrame.tsx` (the embedded variant goes if nothing draws it); `widgets/copy.ts` (`LIBRARY.show`); `customize/connectors/ConnectorsSection.tsx`; `customize/discover/SkillsDiscover.tsx`, `DiscoverPane.tsx`, `DiscoverToolbar.tsx`; `customize/connectors/copy.ts` and `customize/discover/copy.ts` for §G. Tests: `customize/CustomizeView.test.tsx`, `customize-machine.test.tsx`, `customize/discover/Discover.test.tsx`, `destination/DestinationPage.test.tsx`, `widgets/PluginsWidget.test.tsx`, `widgets/WidgetFrame.test.tsx`, `widgets/plugins/LibraryHeader.test.tsx`.

**Interfaces.** Exposes §D. Consumes U7b's `openDestination`, `Destination` and the page's Esc rule (a search field marked `data-escape-clears` clears first, then the page closes), U13a's `useCurrentRow`, U11g's sheet and action (G-1 to G-7).

**Decisions.**
- *The move, not a rewrite.* `MyItems`, `PluginDetail`, the loaded line, `SkillsLibrary`, `Configured` with its live list, `DiscoverPane` and the sheets keep their code; what changes is who mounts them and who holds the state above them. The session's `/plugins` dialog keeps its head and its look: `LibraryBody` is cut into the reads and the list that both use, the dialog that only the session uses, and nothing else.
- *What the page holds, and for how long* (§D). One kept book per place, `customize:<folder or 'user'>`, for all three kinds, in place of the two kept books and the one that was not kept (code, 2). So a connector's line now outlives a change of project and the page being left, as a plugin's does. Lost: lifting the three states as they are. One grid that mixes kinds (M6) needs one `ask` and one set of lines (code, 4), and a book that is kept for two kinds and not for the third cannot be one book.
- *The sheets and the marketplace dialogs* are drawn by that one place, over the page, and a change of project closes them (the bodies and the place's state stay keyed by the folder; code, 2). A change of view or Show cannot happen under an open sheet, which is modal.
- *Search* (§D): My items has one text, the page's, held for the run. The bodies that read the library store take it in the store's place; Filter and Sort stay the store's, shared with the session's dialog as today. A body's "Reset filters" clears the page's text. Discover keeps its choices per Show value in `useDiscoverStore`, as today: its chips, category and sort mean different things per kind.
- *A detail hides the tools.* While a plugin's or a skill's detail is open the head's second row keeps Show and draws no tools, as the library's head does today; pressing the view shown, or a Show value, returns to the list.
- *The word "Filter"*: `LIBRARY.show` reads "Filter", in Customize and in the session's `/plugins`.
- *Ways in* (§D): `openCustomize()` with no section opens My items, All; with a section, that kind. The request store for Discover goes: the view is a field of the page.
- *Pitfalls.* The page region's Esc and focus rules are U7b's and are not edited: the search field keeps `data-widget-search` and `data-escape-clears`, and `/` focuses it. `customizePlace` stays the one rule of the place. The "Live session" picker's change must not reset what was typed or chosen on disk (today's test "keeps the plugin session picker… without resetting disk choices"). Leaving a detail returns the keyboard to the row it was opened from (`data-row-open`), as today.

**Does not touch.** What any row, sheet or dialog does. `composer/plus-menu/PlusMenu.tsx`. The layout store and its schema. All's own list (M5), Discover's All (M6), a plugin's connector rows (M4).

**Proves** C1, C2, C3, C14 and the keeps. Its tests pin:
- the head's two rows and their order; Show is a radio group named "Show" with four choices, one checked; no element of role `tab` named Plugins, Skills or Connectors; the tools drawn for each of the eight pairs of view and Show (§D's table), and none while a detail is open;
- a change of view keeps Show, and a change of Show keeps the view; each writes the page's fields through `openDestination` and nothing else of the layout;
- each kind's body under its Show value draws what its section drew: the cases of today's `CustomizeView.test.tsx`, `Discover.test.tsx` and `PluginsWidget.test.tsx` that open a section are kept with their assertions and reach it by Show and the view switch;
- **held open** (C2): an install is confirmed on a Discover card and its receipt comes with no `done`; the view is changed to My items and Show to Connectors and back; the line still reads its progress on the card; `done` arrives while another Show value is drawn; back on the card the result reads; the same with an add-then-install whose second step starts while My items shows; the same across a change of project and back (today's case, kept);
- **held open**: a connector's Remove is confirmed and runs; Show is changed; the project is changed and chosen again; its line is at the head of the connector rows;
- a sign-in started on a row keeps its steps on that row after Show is changed and changed back;
- a change of project closes an open sheet and resets an open detail;
- each way in of C3, by the page's stored fields and what is drawn; **held open**: a card that reads "Installed" is opened while the plugin list has not answered: My items, Plugins shows; when the list answers with the plugin, its detail opens; when the person opens another row first, or changes Show, the request is dropped;
- U11g's action: drawn in My items under Connectors and under All, not under Plugins or Skills, not in Discover; U11g's cases pass with the action found in the head;
- the session's `/plugins` dialog: its head, its Open Discover and its cases unchanged, but for the word "Filter";
- this Mac only (`customize-machine.test.tsx`, extended): with a project of another machine in front and a session of another machine ready, the page is the user configuration's and lists and attaches nothing of that machine; and in a walk through both views and the four Show values every command the page sends either names this machine or is one of main's own, which name none.

### M4 — A plugin's connectors in the list, with Sign in; the lists before a chat starts

**At its end** My items' connector list draws a plugin's connectors after the configured ones, as the item's row, with the state lines of "Reported", 4, and Sign in through a session that holds one; the coverage note has the item's words; and a new chat's "+" › Connectors and its dialog list them.

**Touches.** `customize/connectors/` (the row cut out as `ConnectorRow`, `rows.ts`, `present.ts`, `copy.ts`, `ConnectorsSection.tsx` and their tests); `customize/InventoryState.tsx`; `widgets/McpWidget.tsx` (the dialog before a chat starts), `widgets/connector-menu.ts`, `widgets/copy.ts` (`BEFORE_START.connectors`); `widgets/before-start.test.tsx`, `customize/CustomizeView.test.tsx`.

**Interfaces.** Exposes §E's row and §J. Consumes §A, §B, U11a's `startSignInDynamic`, `signsInDynamic`, `signInKeyOf`, `ownSignInSessionOf`, `resultFor`, `useSignIns`, `usedEntries`, `connectorStatusWords`, `useTabPlace`, and the launch profile's `plugins.off` as `SkillsOnDisk` reads it.

**Decisions.**
- *The row is one component for both kinds of connector*, cut from today's `ServerRow` with its code kept; a plugin's connector differs in what §E's table names and nowhere else.
- *Who signs in*: the session `ownSignInSessionOf` picks for the engine name, as for a row of MAWS's own list. Ticket 619's limit holds here too: a ready session other than the attached one is found only after its first turn.
- *The press* sends the engine name and the revision the row was drawn with, and keeps the fingerprint in the window, exactly as a row of MAWS's own list does.
- *The three lines* come before any sign-in state, as a shadowed row's words do today.
- *Before a chat starts* the two lists are today's entries, then the plugin's connectors that are left after the two exclusions of "Reported", 4; a row's detail word is "from <plugin>" in the submenu and the row's opened part names the declaring file in the dialog.
- *Pitfall.* An engine host of an earlier build answers no `pluginServers`: the list is today's, and the note is today's sentence.

**Does not touch.** `src/services/`, the command, the dialog of a started chat, the Connectors card, Settings › MCP servers.

**Proves** C8, C9 and the window's half of C10. Its tests pin:
- the row: the server name, "from <plugin>" (a button that opens the plugin's detail), the transport, the image, no scope word, no file line, no Remove; `data-connector-scope="plugin"`;
- its state from the attached session's status under the engine name, else from the posture; Sign in only with an engine name of at most 128 characters, a revision, and a session that holds it; "Open a session, then sign in" otherwise;
- **held open**: Sign in is pressed; `starting` is heard before the receipt; Show is changed to All (after M5: this case is extended there) and back; the steps read on the row and Cancel reaches the operation; the invoke is refused: the row reads the transport's words; the services refuse with §B's sentence: the row reads it after "Sign-in didn't finish:";
- each of the three lines in its case, with no Sign in; their order where two hold;
- the coverage note's words with and without `pluginServers` in the answer, and that neither sentence is ever listed under "Some configuration could not be read";
- before a chat starts: the submenu's and the dialog's rows; the two exclusions; the line's new words; a tab set to another machine reads nothing and says "Shown once the chat starts on <machine>".

### M5 — My items, All; one search

**At its end** the Show value All in My items draws the one list of §E, the openers' default is All, and the search narrows every part.

**Touches.** `customize/` (the All list as its own file; `CustomizeView.tsx`, `open.ts`, `page.ts`); `widgets/plugins/PluginRow.tsx`, `BuiltInMods.tsx`, `widgets/skills/SkillsLibrary.tsx`, `customize/connectors/ConnectorRow.tsx` (the kind word's cell, drawn only under All); `widgets/plugins/library.ts` and `widgets/skills/skills.ts` only for an order or a filter exported; their tests and `customize/CustomizeView.test.tsx`.

**Interfaces.** Exposes §E. Consumes M3's page and M4's rows.

**Decisions.** §E holds them: the parts and their order, which plugins count, the kind word's column, what is not drawn, the part states, the empty state, where a result with no row stands.
- *A row under All is the kind's own row component with one prop more* (the kind word), never a copy.
- *Refresh* reads the inventory and the plugin list again; the postures and the icons follow their reads.

**Does not touch.** A kind's own list. Discover.

**Proves** C4 and C5. Its tests pin:
- C4's seven rows in order with the mods after the plugins, the kind words, their one column, and no group heading, loaded line, live list or kind's menu;
- a plugin's menu opens its sheet from All and its line reads on the row; a skill's row opens its detail and Back returns to All with the scroll; a connector's Sign in and Remove work from All;
- the search narrows each part by its kind's own rule, keeps its text across Show, and a text that matches nothing reads "Nothing matches these filters." with Reset;
- **held open**: the inventory has answered and the plugin list has not: skills and connectors are drawn, the plugins' place is empty; the plugin list then fails: its line and Retry stand in its place and the other parts have not moved; Retry reads it again; the inventory failing instead shows its line once, in the skills' place, and the plugins above it;
- the empty state only when all reads have answered with nothing, and never while one is out; its button opens Discover with All kept;
- M4's held-open sign-in, with Show changed to All in the middle.

### M6 — Discover, All

**At its end** the Show value All in Discover draws the home and the grid of §F.

**Touches.** `src/shared/ipc/schema/catalog.ts` (the tab `all`, the shelf kind); `src/main/catalog/query.ts` and its tests in `catalog.test.ts`; `customize/discover/` (`DiscoverPane.tsx`, `DiscoverHome.tsx`, `DiscoverToolbar.tsx`, `DiscoverGrid.tsx`, `CatalogCard.tsx`, `store.ts`, `add.ts`, `copy.ts`, `Discover.test.tsx`).

**Interfaces.** Exposes §F. Consumes M3's one `ask`.

**Decisions.** §F holds them. `catalog.home` and `catalog.query` are main's commands and are not on the wire between builds, so the tab's new value is no wire change.

**Does not touch.** A kind's own Discover. The catalog's sources, store and join.

**Proves** C11. Its tests pin:
- in main: the home for `all` is the Plugins home's Featured, three shelves in order with each kind's first items in that kind's own order, no community item, no card of the Plugins shelf repeated on the Skills shelf, each shelf's total the kind's whole count, and no categories; the query for `all` holds both kinds, name matches before description matches, then by name, ties by id, the same across a page boundary, whatever `sort` is sent;
- in the window: the three shelves; "See all" writes that kind as the page's `show`; no Category menu and no sort control; a search draws one grid with "Plugin" or "Connector" beside each name, and a shelf's cards carry no kind word;
- a connector's `+` in the grid opens the connector sheet and a plugin's the install sheet; **held open**: one of each is confirmed and both run; each line reads on its own card; the search is cleared and the lines read on the shelves' cards;
- a card that reads "Installed" opens My items with its own kind chosen.

### M7 — The record, the e2e scenes written, the whole checks, the hand-back

**At its end** the e2e scenes that crossed the moved sections find the new head, the new scenes are written and typechecked, the record is in the branch, and the acceptance has been run as far as an executor can run it.

**Touches.** The specs under "The e2e groups"; the two documents of "The record"; code comments that describe the retired structure (`destination/`'s headers, `customize/open.ts`, `widgets/PluginsWidget.tsx`'s header); this document.

**Decisions.**
- *The scenes follow the structure and keep what they prove.* A helper that opened a section by its tab and a view by the section's switch opens the view by the head's switch and the kind by Show; the locators that scoped to a tab panel scope to the page's region. No scene is deleted; one is renamed, because its premise was the three rows of controls (`e2e/ux2-shell.spec.ts`, "Chrome: live Customize keeps scopes on its two control rows and loaded feedback on the third": it becomes the head's two rows and the loaded line under them, with the same measures).
- *No spec file is added* (the gate's script tests pin their number and groups); the new scenes are cases of existing files.
- *No time bound is asserted* in a scene but in a form `.github/scripts/gate-plan.test.mjs` lists.

**Proves** by running, on the VM: the whole typecheck, lint, the whole unit suite once, the scan and the script tests (Concrete Steps, 5). What only a Mac shows is Proof P2.

### The e2e groups whose scenes cross the moved sections

By the group's name in `package.json`. "Changes" means the scene's selectors or expectations are edited in M7; "kept" means it is read again and expected to pass unedited.

| group | file | scenes |
|---|---|---|
| `e2e:discover` | `e2e/discover.spec.ts` | Every scene opens Customize through the helpers `openDiscover`, `chooseProject`, `library` and `pane`, which change. "home: Featured, the shelves, All…" (also the icon's mark on Featured); "labels: search over both names…"; "install: + adds the marketplace and installs…" (its step "installed: … My items" reads the switch's state and opens the Skills and Plugins tabs); "projects: installed at project scope in A…"; "offline: without the directory…" (the monogram's mark; the Connectors tab); "agents: a session started after Discover was browsed…". **New case** "all: My items lists the three kinds in one list; Discover's home has a shelf per kind; a search mixes them": after an install and an add in its scratch home, C4's order and kind words, a plugin's menu and a connector's Remove from All, then C11's shelves, "See all", and one search with a plugin and a connector in the grid. |
| `e2e:discover` | `e2e/discover-connectors.spec.ts` | The helpers `panel`, `row` and `openConnectors` change. "add: Linear from Discover…" (its step under "Configured on disk"); "sign-in: S1 then S2…"; "dynamic: a plugin's connector and one of MAWS's own list signed in from the Connectors dialog, a second of the list from Customize" gains **one step**: the plugin's connector's row in My items reads "from <plugin>", offers Sign in while the session holds it and ends signed in (an engine sign-in: it runs only in a gate job on the Mac mini runner, binding 11); U11g's scene, with the action found in the head. |
| `e2e:settings` | `e2e/settings.spec.ts` | "Customize and Projects are reachable without a chat, at desktop and narrow widths": its three tab clicks, the tab panel that holds "Inventory coverage", and its screenshots at four widths change; it gains the head at 620 px against C14. `e2e/accounts.spec.ts`, "the ring", opens Customize by the sidebar only: kept. |
| `e2e:layout` | `e2e/ux2-shell.spec.ts` | "Chrome measurements: document, deck and live Customize at both desktop sizes" (it captures the tab list named "Customize sections" and the embedded library's header) and the renamed "Chrome: live Customize…" change. It gains **one step** for C6: with the catalog fixtures named in the launch (`MAWS_CATALOG_FIXTURES`) and the stub CLI's installed list holding the id of a fixture plugin whose record has an icon, that plugin's row in My items draws an image of data and a plugin with no record draws its tile. |
| `e2e:layout` | `e2e/shell.spec.ts` | "a page beside the sidebar", "⌘⇧\ under a page", "the Overview over a page": they read the page's region and the stored `destination` by its kind: kept. |
| `e2e:widgets` | `e2e/widgets.spec.ts` | The button named "Show" in `/plugins` becomes "Filter" ("reads render their fixtures…", "My items on an owner-shaped registry…"); the helpers `customizeLibrary`, `openDiscover` and `toMyItems` change, and with them "install at user scope from a Discover card…", "Stop on a CLI that ignores SIGTERM…", "install at project and at local scope…", "an engine error is the engine's words…", "a plugin that declares a dependency…", "Discover on an owner-shaped registry…"; "a New chat lists its folder's connectors, skills and plugins before the first message…" (the line's words); "lists the engine's plugins and marketplaces; the catalogue is read only once Open Discover shows it" changes through the same helpers and keeps its claim: it is the scene that shows M2's icon read causes no catalog read of the engine. |
| `e2e:library` | `e2e/library.spec.ts` | "a replayed session's transcript keeps its scroll offset across a page and Back": kept. |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | "(destinations, both ways)" reads the page's kind: kept, not edited. |
| `e2e:discover-live`, `e2e:plugins-live`, `e2e:plugins-library-live` | `e2e/discover-live.spec.ts`, `e2e/plugins-live.spec.ts`, `e2e/plugins-library-live.spec.ts` | The tab, tab panel, "Show" and switch selectors change. They run a real engine or the real network: edited and typechecked here, run at a live sitting. |
| `default` (`e2e`) | | Run because the renderer changed; no scene of it opens Customize's sections. |

### The record (in the same pull request, UC-10)

- **The ruling this landing reverses** (the child's "Rulings reversed", O-14, the structure): one dated line under P4's Decision Log 88 in `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` and one under "Discover, per tab" in `docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md`, each: "2026-11-14, UX wave U11 (O-14), the owner's answer of 2026-11-12: Customize's outer level is My items and Discover; the kind (plugins, skills, connectors) is a filter inside each, with All. (`docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md`)". The reversal about icons is U11d's, with the fetch.
- **U11a's execution document**, under its §A: "2026-11-14, UX wave U11c: a plugin's connector listed in Customize (X-184) signs in through `connectors.signInDynamicServer` with the revision of its own entry, which the services read at the session's folder; `dynamicRefusal` looks a `plugin:` name up among the plugin entries."
- **U11g's execution document**, under its M2: "2026-11-14, UX wave U11c: the action stands in the page's head while Show is Connectors or All; an add's line is kept for the place and no longer dropped when the project changes."
- At landing, by the architect: the register's rows for O-14 and X-184, and the tracker row of 2026-10-24 (its connector half).

## Concrete Steps

From the worktree of branch `ux-wave/U11c`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11c --`. The VM is shared: read a slow or timed-out check against its load before reading it as a failure.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Master must hold U11g (`grep -n "connectors.addJson" src/shared/ipc/names/connectors.ts` prints a line, and `customize/connectors/ConnectorsSection.tsx` holds the action "Add custom connector…"). If it does not, stop and report: this document is written for a tree that holds it, and its table of statements about U11g must have had its pass ("Progress"). Then, for each file this document names that the merge changed (`git diff --name-only c7b62e48b origin/master`), read it again against "What the code says today" before building on it.

2. **Each milestone**, tests first where a test can fail first. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U11c
       vmcheck 'timeout 900 pnpm exec vitest run <the milestone's paths, below>'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'   # main, the hosts, the services and shared code
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'    # the renderer; tsconfig.e2e.json for e2e/
       vmcheck 'timeout 600 pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11c at <short sha>` and then the command's output; its exit status is the command's (do not pipe it without `set -o pipefail`). At a tests-first commit vitest fails on the new assertions; at the milestone's head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing. The paths:

   | | vitest | typecheck |
   |---|---|---|
   | M1 | `src/shared/ipc src/shared/machine src/engine-host/customization src/engine-host/plugins src/main/catalog src/services/connectors test/endpoint/artifact-rows.test.ts test/lane-b/offer-coverage.test.ts` | node |
   | M2 | `src/renderer/src/customize src/renderer/src/widgets src/main/catalog src/shared/ipc test/support/cross-build-samples.test.ts test/support/tokens-guard.test.ts` | node and web |
   | M3 | `src/renderer/src/customize src/renderer/src/widgets src/renderer/src/destination src/renderer/src/settings-tab/SettingsView.test.tsx src/renderer/src/sidebar src/renderer/src/composer test/support/tokens-guard.test.ts` (`settings-tab`, `sidebar` and `composer` hold the callers of `customize/open.ts`; `sidebar/Sidebar.test.tsx` can fail under the VM's load and pass alone) | web |
   | M4 | `src/renderer/src/customize src/renderer/src/widgets test/support/tokens-guard.test.ts` | web |
   | M5 | the same | web |
   | M6 | `src/main/catalog src/shared/ipc src/renderer/src/customize test/support/tokens-guard.test.ts` | node and web |

   After a merge of master inside a milestone, run that milestone's set again, not the whole suite.

3. **M1, the wire.** After the schema is edited, take the next `WIRE_MINOR` on the master last merged (48 if master holds U11g's 47; merge again first if master has moved), with its comment, then make the generated files again on the VM and bring the result back:

       G='src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json src/shared/ipc/routes.json src/shared/machine/address-paths.json'
       vmcheck "pnpm wire:manifest >/dev/null; MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts >/dev/null; git diff -- $G; git checkout -- $G" > /tmp/u11c-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u11c-wire.patch | git apply

   Expect the patch to add `pluginServers` under the outputs of `commands.customization.inventory` and `commands.customization.serverEndpoints`, the minor, and a new value in `wire-fingerprint.json`; nothing in `routes.json` and nothing in `address-paths.json` (no command is added on the wire and none names a session). A changed `enum` anywhere in the patch means a member was added to a wire enum: undo it (code, 11). M2 adds `catalog.pluginIcons`, a command of main: run the same regeneration then and expect one name in `routes.json` and nothing in the manifest.

4. **M1 and M4 add fixtures and tests with configuration-shaped content.** Run the scan before each hand-back: `vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'`. It passes; a failure names the file, and the cure is a plainer invented value, not an allow-list entry.

5. **M7, master again, then the whole checks.**

       git fetch origin master && git merge origin/master
       grep -n "export const WIRE_MINOR" src/shared/ipc/wire.ts | cut -c1-60

   If the merge conflicted in `wire.ts` or in a generated file, or master's minor is now this branch's or higher: keep master's comment, give this landing's addition the next number after master's, take master's side of the generated files, and run step 3's regeneration again. Then:

       vmcheck 'timeout 900 pnpm typecheck'
       vmcheck 'timeout 900 pnpm exec eslint src/shared/ipc src/engine-host/customization src/engine-host/plugins src/main/catalog src/services/connectors src/renderer/src/customize src/renderer/src/widgets src/renderer/src/destination e2e test/endpoint/artifact-rows.test.ts'
       vmcheck 'timeout 2400 pnpm test'
       vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'

   Then the acceptance's own tests, named, so that the hand-back can quote one result for C1 to C14:

       vmcheck 'timeout 1200 pnpm exec vitest run src/engine-host/customization src/main/catalog src/services/connectors src/shared/ipc test/endpoint/artifact-rows.test.ts src/renderer/src/customize src/renderer/src/widgets src/renderer/src/destination test/support/tokens-guard.test.ts'

   It prints `Test Files … passed` with no failure. C8's and C9's machine half, C10, C12's refusal and C13 are shown by the paths before `src/renderer`; C1 to C6, C9, C11 and C14's unit part by the three renderer folders; C7 by `src/main/catalog` and the image component's tests. `pnpm typecheck` takes about five minutes and prints no error. In `pnpm test` the files the build brief lists as failing on master too are not this landing's; any other failure is. The script tests pass: this landing adds no spec file and no time bound to a scene. Look at a run in the background before its limit has passed twice; a log that has stopped growing beside a process at full CPU is a loop, and a finding.

6. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e, engine or probe. The hand-back says: what exists, with the command and result that showed it; the master and the wire minor the branch stands on; what is not verified (every e2e scene; the engine fact of "Reported", 3); the decisions made; anything that contradicts this document; the residue. Residue known at authoring, each a row for the debt tracker at landing:
   - a connector that a plugin ships as a bundle (`.mcpb`, `.dxt`), or names by a URL where a path belongs, is not listed in My items ("Reported", 6);
   - a plugin whose manifest is its marketplace entry (no `plugin.json` in its folder) lists only what its `.mcp.json` declares, if the inventory is not handed its marketplace's root;
   - a plugin's connector that the engine drops for a reason MAWS does not compare (an address that differs only as written, or a later plugin's server that repeats an earlier plugin's) reads "Sign in needed · Open a session, then sign in" until a session is attached, and then "Not in the attached session";
   - before a chat starts, a connector of a plugin turned off in Claude Code's own settings is listed until the chat starts (the "+" menu runs no plugin CLI);
   - which name the engine gives a plugin's connector where the manifest's name differs from the key's is read, not run ("Reported", 3);
   - an installed plugin from a marketplace that is not a seed shows its tile even where the directory has an icon for it, since the held copy alone cannot tie the two (code, 8);
   - a connector row and its Discover card show one tile only where the configured name is the name the directory's add proposes (§C, the seed);
   - a line of a finished operation stays on its row or at the head of its part for the run of the app, for connectors now as for plugins before (§D);
   - ticket 619's limit applies to a plugin's row: a ready session other than the attached one is found only after its first turn;
   - `e2e/discover-live.spec.ts`, `e2e/plugins-live.spec.ts` and `e2e/plugins-library-live.spec.ts` are edited and typechecked and run only at a live sitting.

7. **The architect's, after the hand-back.** Proof P1 to P4.

## Interfaces and Dependencies

### §A. A plugin's connectors in the inventory (M1; consumed by M4 and by the connector-switch landing)

    // src/shared/ipc/schema/customization.ts
    export const CustomizationPluginServerSchema = z.strictObject({
      plugin: z.string().min(1).max(256),             // the key the plugin is installed by, `<name>@<marketplace>`: installed_plugins.json's key, and the id of its row in My items
      pluginName: z.string().max(256).nullable(),     // the `name` of its .claude-plugin/plugin.json, by `pluginNameOf`; null: not readable
      server: z.string().min(1).max(256),             // the name the plugin's file gives the server
      name: z.string().min(1).max(128).nullable(),    // the engine's name for it, `plugin:<pluginName>:<server>`; null when pluginName is null or the whole is longer than 128
      installScope: z.enum(['user', 'project', 'local']),   // the installation's, as installed_plugins.json has it
      path: AbsolutePath,                             // the file that declares it
      transport: CustomizationServerSchema.shape.transport,
      sameAddressAs: z.string().max(256).nullable(),  // a `user`, `project` or `local` entry of this read with the same address, by its name; null: none found
    });
    // CustomizationInventorySchema gains
    pluginServers: z.array(CustomizationPluginServerSchema).optional(),   // absent from an engine host of an earlier build

    // customization.serverEndpoints' answer gains (main only, as `servers` is)
    pluginServers: z.array(z.strictObject({
      plugin: z.string().min(1).max(256), server: z.string().min(1).max(256), name: z.string().min(1).max(128).nullable(),
      path: AbsolutePath, transport: CustomizationServerSchema.shape.transport,
      url: z.string().max(4096).nullable(), revision: z.string().max(64).nullable(),
    })).optional(),

This build's engine host always sends `pluginServers`, an empty array where there is nothing to list, so the key's absence means an earlier build. No address is in the inventory's answer; it goes to main alone, as every row's does. `servers`, `skills`, `warnings` and `serversRead` are as they are. **Why an array of its own and not a fifth scope:** "Reported", 1. **The three names** are carried apart because they answer three questions: `plugin` finds the plugin's row and detail; `name` finds the server in a session's status and is what a sign-in sends; `server` is what the row shows. A reader that needs to know whether the engine name is proven where the manifest's name and the key's differ compares `pluginName` with the part of `plugin` before its last `@` ("Reported", 3).

    // src/shared/ipc/schema/catalog.ts: catalog.postures' answer gains a second list, row for row with pluginServers
    plugins: z.array(z.strictObject({
      plugin: z.string(), server: z.string(), path: z.string().max(4096),
      authPosture: z.enum(['auth_required', 'no_auth']).nullable(), fingerprint: z.string().max(64).nullable(), revision: z.string().max(64).nullable(),
      iconUrl: z.string().max(2048).nullable(),   // M2
    })),
    // and each row of `servers` gains, in M2
    iconUrl: z.string().max(2048).nullable(),     // the icon of the one directory record the address matches; null for none or several

`catalog.postures` is main's and never crosses to another build. An engine host that answers no `pluginServers` gives an empty `plugins`.

### §B. The sign-in of a plugin's connector from its row (M1; U11a's §A extended)

The command, its schema, its grade, the redirect and the event are U11a's and unchanged. What changes is the entry a press's revision is checked against (`dynamicRefusal`, `src/services/connectors/sign-in-entry.ts`), and where the services read it (`check`, `sign-in.ts`):

| the press | the entries read | the entry looked up | where it is missing, of another revision, or has none |
|---|---|---|---|
| names no entry (the Connectors dialog) | none | none: the session's own server, as today | n/a |
| names an entry; the name does not start `plugin:` | `customization.serverEndpoints` with `cwd: null`, as today | among `servers`, scope `app`, by name | "MAWS’s <name> server changed since this page read it; refresh the page, then sign in" (today's) |
| names an entry; the name starts `plugin:` | `customization.serverEndpoints` with the session's own folder | among `pluginServers`, by `name` | "<name> changed since this page read it; refresh the page, then sign in" |

In every row the first two checks stay first (the session's status lists the name, with scope `dynamic`), and after the entry is found the session's server must be it by `holds(held, entry, 'dynamic')`: the same transport, and the same address where the entry's holds no `${`; otherwise "this session uses a different <name>; start a new session to sign in". All of it runs in the services, on the status of the session the operation then drives, before `mcp_authenticate` is sent, from one read of the entries; a failed read ends the operation with "that session’s configuration could not be read: <words>". A services build from before this landing looks a `plugin:` name up among MAWS's own entries, finds none and refuses with the sentence of the second row: safe, and not a build anyone returns to; build F answers `unknown_command`, which the row shows in the transport's words.

### §C. The image (M2; consumed by every row and card, and by U11d)

    // src/renderer/src/customize/image/tile.ts (pure)
    export type ItemKind = 'plugin' | 'skill' | 'connector' | 'mod';
    export function tileOf(kind: ItemKind, seed: string): { letter: string; colour: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 };

    // src/renderer/src/customize/image/ItemImage.tsx
    export function ItemImage(props: { kind: ItemKind; seed: string; iconUrl: string | null; size: 'row' | 'card' | 'detail' }): JSX.Element;

    // src/renderer/src/customize/discover/read.ts
    export function usePluginIcons(ids: readonly string[]): ReadonlyMap<string, string | null>;   // id → the directory's icon URL; one request for the list

    // src/shared/ipc/schema/catalog.ts
    'catalog.pluginIcons': main(
      z.strictObject({ ids: z.array(z.string().min(1).max(512)).max(512) }),    // `<name>@<marketplace>`
      z.strictObject({ icons: z.array(z.strictObject({ id: z.string(), iconUrl: z.string().max(2048).nullable() })) }),
    ),

**The tile.** `letter` is `monogramOf(seed)` (`customize/discover/present.ts`, unchanged). `colour` is one more than the 32-bit FNV-1a hash (offset 2166136261, prime 16777619, unsigned) of the UTF-8 bytes of the kind, one zero byte, and the seed in lower case, taken modulo 8. Vectors a test pins: (`plugin`, `berth-notes`) 4; (`skill`, `csv-export`) 4; (`connector`, `tides`) 6, and `Tides` the same; (`mod`, `to-human`) 5; (`plugin`, `élan`) 6. The tile's background is the author colour of that number at a low strength and its letter is that colour at full strength: the token utilities with an opacity modifier (`bg-author-<n>/15 text-author-<n>`), all eight pairs written out in one table so that the stylesheet holds them; one strength for all eight, the same in both themes, whose colours are the tokens' own. The strength is the executor's to tune by eye between 12 and 20; no new token.

**The seed**, one string per item, so that an item is the same wherever it is drawn:

| item | seed |
|---|---|
| a plugin: its row in My items, a loaded-only row, its detail; a Discover card or detail whose chosen route installs a plugin | the plugin's install name (the part of its id before the last `@`; the route's `pluginName`) |
| a Discover card with no plugin route | the item's name |
| a skill | its name as the row lists it |
| a connector: a configured row | the server's name; for a plugin's connector, its `server` |
| a connector: a Discover card or detail | the name its add proposes (the route's `name`) |
| a built-in mod | its registry name |

**What it draws.** A box of fixed size per `size` (each place keeps the box it has today), marked `data-item-image="icon" | "tile"`, `data-item-kind` and, for a tile, `data-tile-colour`; `aria-hidden`. The tile at once; when `iconUrl` is given and `catalog.icon` answers image data (`IMAGE_DATA`'s rule, kept), the image in the same box. U11d's place: one prop, `site`, and one read between the two, marked `data-item-image="site"`; the box and the callers' layout do not change.

**Where the bytes come from.**

| what is drawn | where its bytes are | can a request leave? |
|---|---|---|
| the directory's icon on a Discover card or detail | main's `catalog.icon`: the kept copy under `<userData>/catalog/icons/`, else the URL, only on the two icon routes of `CATALOG_EGRESS` | as today |
| the directory's icon on an installed plugin's row (My items; the session's `/plugins`) | the same; the URL comes from `catalog.pluginIcons`, which reads the held copy and asks nothing | the same route, now asked from these rows too ("Reported", 5) |
| the directory's icon on a configured connector's row (My items) | the same; the URL comes from `catalog.postures`, which reads the held copy and asks nothing | the same |
| a skill, a built-in mod, and any item with no record or no icon on the two routes | nowhere: the tile is computed in the window from the seed | never |
| a site's icon | not in this landing | never |

Under e2e the catalog's sources and icons are fixtures or offline (`src/main/catalog/fetch.ts`), so no scene reaches the network.

### §D. The page (M3)

**Where it is.** The two fields of U7b's `destination`; `openDestination({ kind: 'customize', view, show })` is the one writer. `DestinationPage` passes them to `CustomizeView`:

    // src/renderer/src/customize/CustomizeView.tsx
    export function CustomizeView(props: { view: 'mine' | 'discover'; show: 'all' | 'plugins' | 'skills' | 'connectors' }): JSX.Element;

    // src/renderer/src/customize/open.ts
    export type CustomizeSection = 'plugins' | 'skills' | 'mcp';   // the composer's names, kept
    export function openCustomize(section?: CustomizeSection, projectId?: ProjectId | null): void;   // no section: My items, All
    export function openDiscover(cwd: string | null): void;        // Discover, Plugins, on that folder's page (the session's `/plugins`)
    export function openMine(show: 'plugins' | 'skills' | 'connectors', item?: { pluginId?: string; search?: string }): void;   // on the page's own place: a card that reads "Installed"; "from <plugin>"

    // src/renderer/src/customize/page.ts: held for the run, never stored
    export const useCustomizePage: UseBoundStore<StoreApi<{ search: string }>>;   // My items' one search text

`openMine` with a `pluginId` opens that plugin's detail once the plugin list holds it, and leaves the list where it does not; the request ends when the person opens another row or changes where the page is. With `search` it sets the page's text (a Skills card names its plugin, as today).

**The head**, two rows, in an element that keeps `data-customize-header`:

- *First row:* the view switch (today's `LibrarySwitch`: a radio group named "Library", My items | Discover); at the right "Showing" with the project select, as today; beside it, in My items only, "Live session" with its select while a session MAWS runs on this Mac is ready in exactly that folder.
- *Second row:* "Show:" and a radio group named "Show" with All, Plugins, Skills, Connectors in that order, drawn in the shape today's section tabs have (the chosen one on the active background); at the right the tools:

| view | Show | tools |
|---|---|---|
| My items | All | the search field ("Search my items"); "Add custom connector…"; Refresh |
| My items | Plugins | the search field ("Search plugins"); Filter; Sort by; the Add menu (Add marketplace, Manage marketplaces) |
| My items | Skills | the search field ("Search skills"); Sort by, while a plugin brings a skill; Refresh |
| My items | Connectors | the search field ("Search connectors"); "Add custom connector…"; Refresh |
| Discover | Plugins, Skills, Connectors | today's Discover tools for that kind: "Search all sources", Refresh, the catalog's age with the Sources popover; under Plugins the Add menu |
| Discover | All | "Search all sources", Refresh, the catalog's age with the Sources popover |

  No tools while a detail is open. The visible heading "Configured on disk" goes with the toolbar it stood in; the connector list keeps it as its name.
- *Narrow*, by the item: when the Show choices and the tools do not fit on one line the tools take a line of their own under the choices; the four choices stay on one line down to 400 px; under the `customize` container's 24rem each row stacks (the switch; "Showing" and "Live session" at full width; the Show choices; the search field at full width), and a plugin's row gives up its version and date.

**One place that holds what a person started**, keyed by the place, above every body of both views:

- one kept book, named `customize:<folder>` or `customize:user`, for plugins, skills and connectors alike;
- one `Manage` (what `useManage()` answers anywhere on the page): `ask(key, request)` opens the connector sheet for the actions `mcp-add` and `mcp-remove` and the install sheet for every other; `askIn(key, request, runIn)` is today's, for a connector's removal in its own folder;
- the sheets and the two marketplace dialogs, drawn once, over the page;
- the reads the bodies share: the inventory (one query, as today), the plugin list with its marketplaces and manifests, the attached session's status, the postures.

A change of project gives a new place: sheets close and details reset, and the book of the place left is found again on return. What the book holds of a custom add is its masked form (G-5).

**What the session's dialogs keep.** `/plugins`, `/skills` and the Connectors dialog are drawn as today: their own head, their own book (not kept), the library store's search, Filter and Sort.

### §E. A connector's row, and My items, All (M4, M5)

    // src/renderer/src/customize/connectors/rows.ts
    export type ConnectorRowModel =
      | { kind: 'configured'; key: string; name: string; scope: 'app' | 'user' | 'project' | 'local'; path: string; transport: string }
      | { kind: 'plugin'; key: string; name: string | null; server: string; plugin: string; pluginName: string | null; installScope: 'user' | 'project' | 'local'; path: string; transport: string; sameAddressAs: string | null };
    export const connectorRowKey: (row: …) => string;   // configured: today's `serverKey`, `connector:<scope>:<name>:<path>`; a plugin's: `connector:plugin:<plugin>:<server>`
    export function connectorRows(inventory: Pick<Inventory, 'servers' | 'pluginServers'>): ConnectorRowModel[];   // the configured rows in the inventory's order, then the plugins' by key and server

    // src/renderer/src/customize/connectors/ConnectorRow.tsx
    export function ConnectorRow(props: { row: ConnectorRowModel; kindWord?: boolean; … }): JSX.Element;

**A plugin's row** against a configured one:

| | a configured connector (today) | a plugin's connector |
|---|---|---|
| name shown | the configured name | `server` |
| after the name | "<scope> scope · <transport>" | "from <plugin>" (a button: `openMine('plugins', { pluginId: plugin })`; the plugin's name as its own row shows it where the plugin list holds it, else the part of the key before its last `@`) "· <transport>" |
| second line | the file's path | none |
| state | a sign-in under way or ended; else the attached session's status under the name; else the posture | first of: "Not loaded: same address as <sameAddressAs>"; "Plugin turned off" (the plugin list says it is not enabled here); "Not in the attached session" (the attached session's status has answered and lists no server of `name`, or `name` is null); then as a configured row, under `name` |
| Sign in | by scope, as today | while `name` is not null and `signsInDynamic(name)`, the posture row has a revision, none of the three lines holds, and `signInViewOf` offers it: through `ownSignInSessionOf(name, …)`, sending `startSignInDynamic({ name, revision }, fingerprint, session)`; with no such session, "Open a session, then sign in" |
| Remove | by scope, as today | none |
| marks | `data-connector="<name>"`, `data-connector-scope="<scope>"` | `data-connector="<server>"`, `data-connector-scope="plugin"`, `data-connector-plugin="<plugin>"` |

The row's parts are named for the landing that adds columns to it: `data-connector-main` (the image, the name, what follows it, the state), `data-connector-trailing` (Cancel, Sign in or its sentence, Remove), and after it, only under All, the kind word.

**My items, All.** One scrolling list, no heading:

1. *Plugins*: the installed plugins that have an installation here or at user scope (every identity whose `group` is not null), by the name their row shows; the library store's Filter and Sort do not apply. Then MAWS's built-in mods, by name.
2. *Skills*: every skill of the inventory, by the label its row shows, with no group heading.
3. *Connectors*: `connectorRows`, by the name each row shows, a configured row before a plugin's of the same name.

Each row is its kind's row with the kind word: "Plugin", "Mod", "Skill", "Connector", in one cell of one width (the widest word's), marked `data-kind-word`, before the row's last control (a plugin's menu, the mod's switch) and as the last cell of a skill's and a connector's row, where an empty cell of the last control's width follows so that the words line up. Not drawn under All: the plugins' loaded line and group headings, the skills' groups, the connectors' live list and its sentence, each kind's menus.

*The search* narrows each part by its kind's own rule: a plugin and a mod as My items' search does today, a skill as `skillsView` does, a connector by the name it shows and, for a plugin's, its plugin's name.

*Part states.* A part is drawn when its read has answered. While the plugin list is out its place is empty; when it fails, its place holds today's failure ("Couldn’t load your plugins.", the read's words, Retry) and the built-in mods under it. The skills and the connectors share the inventory: its reading line and its failure with Retry stand once, where the skills would be, and its folded notes stand under the list. *Empty*: when every read has answered and there is no plugin with an installation here, no skill and no connector, and the search is empty, the list is "Nothing here yet." with "Find plugins, skills and connectors in Discover." under it and the button "Open Discover", which opens Discover with All kept; the built-in mods are then not drawn here. With a search that matches nothing: "Nothing matches these filters." and Reset, today's words.

*Results with no row* (a removal's, an uninstall's, U11g's add while it works or has failed) stand at the head of their kind's part under All, and where they stand today under the kind's own Show value.

### §F. Discover, All (M6)

    // src/shared/ipc/schema/catalog.ts
    export const CatalogTabSchema = z.enum(['plugins', 'skills', 'connectors', 'all']);
    // CatalogShelfSchema.kind gains 'kind'; its key is `kind:plugins`, `kind:skills` or `kind:connectors`

- *The home for `all`* (`homeOf`): `featured` is the Plugins home's; `shelves` are three, in that order, titled "Plugins", "Skills", "Connectors"; each holds that kind's items that are not community items, in that kind's own shelf order, its first twelve (`SHELF_ITEMS`), and the Skills shelf leaves out every item among the Plugins shelf's twelve; each `total` is the kind's whole count, community items included, which is what "See all" leads to; `categories` is empty. No All grid stands under the shelves.
- *The query for `all`* (`queryOf`): every item; the chips, Not installed and the text as today; `category` ignored; one order whatever `sort` is sent: a match on a name before a match on the description only, then by name, ties by id; `reverse` and the cursor as today.
- *The window:* the filter row without the Category menu; a shelf's "See all" is `openDestination({ kind: 'customize', view: 'discover', show: <that kind> })`; a search, a chip or Not installed turns the page into one grid headed by the count, with no sort control; a card in that grid carries "Plugin" or "Connector", muted, beside its name, and a shelf's card none; the Skills note is not drawn. `+` asks the page's one `ask`; a card on the Skills shelf asks as a Skills card does today (its sheet names the skills), every other card as its own kind's. A card that reads "Installed" calls `openMine` with the item's own kind. Discover's choices for All are a fourth entry of `useDiscoverStore`.
- *A kind's own Discover* is unchanged, community items and Category included.

### §G. Words

New or changed strings; every other string is today's.

| where | words |
|---|---|
| `LIBRARY.show` (`widgets/copy.ts`) | "Filter" |
| the Show row | "Show:"; "All", "Plugins", "Skills", "Connectors" |
| the kind word | "Plugin", "Mod", "Skill", "Connector" |
| the search field | "Search my items" (All); "Search connectors"; "Search plugins" and "Search skills" as today |
| All, empty | "Nothing here yet." / "Find plugins, skills and connectors in Discover." / "Open Discover" (`DISCOVER.openDiscover`) |
| a plugin's row | "from <plugin>"; "Not loaded: same address as <name>"; "Plugin turned off"; "Not in the attached session" |
| `COVERAGE.now` (the folded note, an answer with `pluginServers`) | "Skills that a marketplace declares but no folder holds are not listed; see Plugins." |
| `COVERAGE.before` (an answer without) | today's sentence, the wire constant's own text |
| `BEFORE_START.connectors` | "Configured for <place>. Connection state shows once the chat starts." |
| the shelves of Discover › All | "Plugins", "Skills", "Connectors" |
| the services (§B) | "<name> changed since this page read it; refresh the page, then sign in" |

`CUSTOMIZATION_INVENTORY_COVERAGE` keeps its value; its comment says it is a mark on the wire and that the window words the note.

### §H. What is stored or sent, and what build F does with it

**Stored: nothing new.** Per value:

| value | where | build F; this build after F; this build, then F, then this build |
|---|---|---|
| the view and Show | U7b's layout key `destination`, written by `openDestination` | The key, its version and its schema are U7b's and unchanged; this landing only writes values the schema already admits (`show: 'all'`; `view: 'discover'` with any Show). F never asks for the key and keeps it through its writes. After a stay on F, U7b's rules decide the page at the start (a Customize tab F left in front opens My items at that tab's kind; otherwise the stored page while the tabs have this build's shape). A build of the wave from before this landing reads `all` as Plugins. |
| My items' search text; Discover's choices; an open detail; an open sheet | memory, for the run | not stored |
| a tile's letter and colour | computed from the seed | not stored |
| a directory icon's copy | `<userData>/catalog/icons/<sha256 of the URL>.json`, written by `CatalogIcons` as today | The same file, form and writer as F's; more URLs may be kept, each one a URL F would keep the same way. |

No layout key, no settings key, no file of a new kind, no field on a stored tab: the cross-build coverage table (U13a's M5) gains no row, and the scene "(destinations, both ways)" of `e2e/cross-build.spec.ts` stays the proof of the key. Shown by: `LayoutKeySchema` and both settings schemas are not in the diff.

**Sent between builds: two optional properties, one minor.**

| what | this build's sender, F's receiver | F's sender, this build's receiver |
|---|---|---|
| `pluginServers` on `customization.inventory`'s answer | F's main reads its engine host's answers with `readTolerant` and drops the key; F's window is answered as today and lists no plugin connector | absent: the window lists none and words the coverage note as `COVERAGE.before`, which is true of that host |
| `pluginServers` on `customization.serverEndpoints`' answer | the same; F's postures are as today | absent: `catalog.postures` answers an empty `plugins` |
| the coverage warning's string | unchanged: F's window folds it as today | unchanged |
| `connectors.signInDynamicServer` with an entry for a `plugin:` name | not sent: F's host answers no row to press. Asked anyway, F answers `unknown_command` | n/a |

M1's test of the two builds holds F's own copies of the two answer schemas (as `send-now-builds.test.ts` holds F's event schemas) and pins both columns.

### §I. Routes (law 5), and other machines

Customize is not a session surface, and it is this Mac's (bindings 9 and 14). What the page shows for another machine: nothing. Its project list is this machine's; a project of another machine in front makes the page the user configuration's (today's rule, pinned by `customize-machine.test.tsx`); every read and operation is sent with `{ machine: ipc.localMachine }`.

What this landing sends, and to whom:

| command | new or changed | where it goes | holds |
|---|---|---|---|
| `customization.inventory`, `customization.serverEndpoints` | two optional output properties | this Mac's engine host | names, transports and file paths of this Mac's plugins to this Mac's window; addresses to this Mac's main only. No offer row exists for either, and M1's case shows `not-offered` to a caller on another machine |
| `catalog.pluginIcons` | new | this Mac's main | the ids of plugins installed here; answered from the held copy; nothing leaves the Mac |
| `catalog.postures` | one more list, one more field | this Mac's main | as today |
| `catalog.icon` | unchanged | this Mac's main, and from there one of the two icon routes | a URL a directory record names; nothing of the person's configuration |
| `connectors.signInDynamicServer` | unchanged; now also pressed from a plugin's row | the services of the session's machine, and the session is always one of this Mac's (`ownSignInSessionOf` is handed this Mac's ready sessions only) | the engine name and the revision; no address |

No offer row, capability or `remote-unavailable` entry is added or changed; `src/endpoint/` is not in the diff.

The session surfaces this landing touches are the images in two dialogs and the lists before a chat starts:

| route | `/plugins` and `/skills` | "+" › Connectors and the dialog, before the first message |
|---|---|---|
| a session MAWS runs on this Mac | the rows gain their image; a plugin's directory icon by `catalog.pluginIcons` for this Mac's plugin ids | a new chat on this Mac lists the folder's connectors, a plugin's among them |
| a terminal session on this Mac | the same rows and images | not on this route: a terminal session is never unstarted inside MAWS |
| a session on another machine | `/plugins` keeps its one sentence and draws no row; `/skills` draws that machine's skills with tiles, which are computed from each row's own name and read nothing | a new chat set to another machine says "Shown once the chat starts on <machine>" and reads nothing of this Mac |

### §J. What the connector-switch landing reads from this one

Named so that it is built on and not rebuilt. Nothing here is a switch, a column or a record.

- **The row**: `ConnectorRow` (`customize/connectors/ConnectorRow.tsx`), with its three named parts (`data-connector-main`, `data-connector-trailing`, the kind word's cell under All). Two switch cells go between the trailing part and the kind word; the column words go once above the list that `Configured` draws.
- **The list's source**: `connectorRows(inventory)` over the page's one `useCustomizationInventory(cwd)` read, with `catalog.postures` beside it. A connector that is off will come from the same read.
- **A row's identity**: `connectorRowKey(row)`. For a configured connector the engine reports its `name`. For a plugin's connector the row carries three identities and does not choose between them: `plugin`, the key it is installed by; `pluginName`, the manifest's name; and `name`, the engine's name built from the manifest's name, null where that cannot be read. By the engine's code (code, 12) `name` is what a session's status reports; where `pluginName` differs from the name in the key this is not run on the wire ("Reported", 3), and the row lets a reader tell that case by comparing the two.
- **`installScope`**: which projects a plugin's connector reaches.
- **The page**: the place (`customizePlace`), the "Showing" select, the head's second row for a sentence above the list while Show is Connectors, and `useManage()` for an act's line on a row.
- **Before a chat starts**: the submenu's and the dialog's lists read the same `connectorRows`.

### §K. Dependencies on other landings

Consumed, by the name each is exposed under. **U7b**: `Destination`, `openDestination`, `DestinationPage`'s region and its Esc rule (a field marked `data-escape-clears`), `customizePlace`; its three stand-ins end here. **U11a**: `connectors.signInDynamicServer`, `startSignInDynamic`, `SignInScope`, `signsInDynamic`, `signInKeyOf`, `ownSignInSessionOf`, `dynamicRefusal`, `configurationRevision`, `pluginNameOf`, `useCustomizationInventory`, `usedEntries`, `useTabPlace`, `connectorStatusWords`, `BEFORE_START`. **U11g**: the action, the custom sheet opened from a request, the add's key and line, the book's masked request ("Statements about U11g's code"). **U13a**: `useCurrentRow`, the current project the page is about; the cross-build coverage table, to which no row is added. **U6a, U8a, U3a, U9, U8b**: nothing; no action id or chord, no working-folder selector, no arrival, no act on a session or offer, no card or tab of the side column.

Exposed: §A's rows and three names; §B's check; `ItemImage`, `tileOf`, `usePluginIcons`, `catalog.pluginIcons`, the postures' `iconUrl` (U11d adds `site` beside each); `CustomizeView`'s two props, `openCustomize`, `openDiscover`, `openMine`, `useCustomizePage`; the page's one `Manage`; `ConnectorRow`, `ConnectorRowModel`, `connectorRows`, `connectorRowKey`; the catalog's tab `all`.

## Proof that an executor does not run

| | what | when | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **The e2e scenes**, on a Mac under the load rule | after M7's hand-back; a milestone's new case alone as soon as it is pushed | the new case of `e2e/discover.spec.ts` and the new step of `e2e/ux2-shell.spec.ts` alone first; then `e2e:discover`, `e2e:settings`, `e2e:layout`, `e2e:widgets`, `e2e:library` and `default`. The new step of the "dynamic" scene makes an engine sign-in: it runs only in a gate job on the Mac mini runner (binding 11), with the spike's switch the architect arranges. No scene reads a person's configuration: each has its scratch home | verdicts by group, and screenshots of the head at 1512, 900, 620 and 400 px beside the drawn frames. A red scene goes back as a fix |
| P2 | **The branch review** | after M7 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11c` (Decision Log, with its lenses) | a verdict and findings; the fixes are one wave |
| P3 | **Class 1a** | on the head handed back; again on the final head if the review changed the branch | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11c`, in the background | the run's id, which the pull request names |
| P4 | **The owner's look at the built page** | at the wave's sitting | the page on the wave's build, with the list of "Reported", 7 beside the drawn frames | each difference kept or changed; a change is a fix in the place "Reported" names |
| P5 | **One engine fact** ("Reported", 3) | any time; nothing waits for it | a wire probe on engine `2.1.322` with a scratch config home, off the MacBook: a plugin whose manifest name differs from its key and that declares one server; read `mcp_status` | the name the engine reports. As read: nothing changes. Otherwise: §A's `name` is built from the other name, one line |
| P6 | **The live groups** | at a live sitting | `e2e:discover-live`, `e2e:plugins-live`, `e2e:plugins-library-live` | that their edited selectors find the new head |

No cross-build run is needed for this landing's own content: §H stores nothing new and relies on no read by build F beyond the tolerant reader that M1's test pins with F's own schemas. Whether the chain's rule (UC-10, the final Mac runs) asks for the cross-build group on this head is the architect's.

## The owner's look

The owner has seen the page drawn and answered its three choices (the child's "Waiting", 2026-11-13); this document builds to the file. No new drawing is needed before the build: what differs from the drawn frames is listed under "Reported", 7, each small and each in one named place, and the lines of "Reported", 4 are words in a state's place that no frame drew. They are shown to the owner on the built page (P4).

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, landing U11c" and the parent pin; names its class 1a run, its review verdict and its residue (Concrete Steps 6, with what the milestones add); says what it leaves to U11d and to the connector-switch landing; names the engine fact that is read and not run; and lists the dated lines it carries ("The record"). It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

- Observation: X-184's rows cannot be a fifth value of the inventory's `scope`, and its coverage sentence cannot be reworded where it is defined: both are values on a wire that build F and this build share on one Mac.
  Evidence: `src/shared/ipc/wire.ts`, the compatibility rule ("an added enum member included, since an older reader refuses it"); `customize/InventoryState.tsx` compares each warning with the constant by equality, at build F too (`git show f1852de3a:src/renderer/src/customize/CustomizeView.tsx`).
- Observation: the directory's icon on an installed item is not free of the network: the read that hands out an icon fetches it when no copy is kept.
  Evidence: `CatalogIcons.resolve` in `src/main/catalog/icons.ts`; `catalog.postures` and the new `catalog.pluginIcons` read `store.loaded()` and fetch nothing.
- Observation: the engine names a plugin's server by the manifest's name, as it names a plugin's skill.
  Evidence: `cli.pretty.js:496452`, `:474842`, `:474719` to `:474729` (2.1.322), read; `spikes/protocol-probe/findings-uxwave-u11-skill-names.txt` for the skill, run.
- Observation: the three sections' operations do not have one lifetime today: two books are kept by name and the connectors' is not.
  Evidence: `usePluginOperations(base.keep)` in `widgets/plugins/manage.tsx` against `usePluginOperations()` in `customize/connectors/ConnectorsSection.tsx`.
- Observation: U7b is on master, so the item's "while Customize is still a stored tab" has no build left to describe, and the two fields are already in the stored schema.
  Evidence: `DestinationSchema` in `src/shared/ipc/schema/layout.ts`; `RETIRED_KINDS` holds `customize`.

## Decision Log

- Decision: the verification this landing gets. This document gets an adversarial review before an executor starts; the architect dispatches it, and sends the document back once for the pass over "Statements about U11g's code" when U11g is on master. Each milestone is reviewed at its boundary; M1's before M4 consumes it, M3's before M4, M5 and M6 build on the page. The branch gets `doperpowers:review-code` at the xhigh panel: it is of panel size three times over, by its lines (about 5,800 against the wave's two thousand) and by its files (about 75 against twenty), and the child's table already gave it the panel "by size (it moves three sections and their state)". The panel's lenses: (1) nothing lost in the move: every act of a kind's list from its own Show value and from All; an operation, a sheet and a sign-in across a change of view, of Show and of project; the session's three dialogs unchanged but for the images and one word; (2) what is sent and to whom: no address in anything the window receives; a press from a plugin's row signs in the configuration the row showed or nothing; no command to another machine; `CATALOG_EGRESS` untouched and no request for an item the directory does not list; (3) the two builds: the wire's change is a minor, both tolerant directions, the coverage mark, nothing stored; (4) the head by keyboard and by assistive technology, and narrow: two radio groups, the search field's Esc before the page's, the keyboard back on the row a detail was opened from, the four widths; (5) the tests: each "held open" case holds its sequence open and would fail on the final state alone. Class 1a on GitHub Actions is the gate of record.
  Rationale: the root gives the panel to a branch of panel size (UC-10); the lenses follow where a move of this size goes wrong unseen.
  Date/Author: 2026-11-14, the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
