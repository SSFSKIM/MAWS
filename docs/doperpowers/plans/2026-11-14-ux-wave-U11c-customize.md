# UX wave · U11c · Customize: My items and Discover, and an image for every item (2026-11-14)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11** (`docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`), landing **U11c**, parent pin master `c7b62e48b176dceba1620d16865dac2bef23b1b2`.
> **Where the design is.** The child's file: its two items "O-14" (the structure; the images), with Acceptance A16, A17 and A18, the Contracts' lines on UC-8, UC-12 and UC-14, and bindings 9, 13 and 14 of its Design inheritance. This document carries the constraints, the milestones and what the code adds to the design, and nothing of the design itself.
> **What left this landing.** The child's table gives U11c a third thing, X-184 (a plugin's connectors under My items, with Sign in). The architect cut it out on 2026-11-14 into a landing of its own, **U11h**, built after this one and after an engine probe (Decision Log). Nothing of X-184 is built here; §J names what this landing leaves for it.
> **Branch:** `ux-wave/U11c`, from the parent pin; master is merged in before anything is built (Concrete Steps, 1). **Stands on:** U11a (`docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md`) and U7b (`docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md`), both on master with their code, and on **U11g** (`docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md`), on master since `93905c9ef`, which is merged into this branch: this document's statements about its code were checked against it on 2026-11-15 ("Statements about U11g's code").

## Purpose

Today Customize asks a person to pick a kind first (Plugins, Skills, Connectors) and then, inside each, My items or Discover; each kind keeps its own choice, its own search and its own tools. Nearly every connector and every installed plugin is drawn with the same grey glyph or no image at all.

After this landing the page opens on what the person has: My items | Discover at the top, and under it "Show: All · Plugins · Skills · Connectors". All is one list of everything this Mac has for the project, each row the row its kind's own list draws, so a plugin's menu, a skill's detail and a connector's Sign in and Remove work from it. Every row and card has an image: the directory's icon where MAWS holds a record of the item with one, else the item's letter on a colour that is the same wherever the item is drawn.

The page is also the one two later landings build on: U11h lists a plugin's connectors in it, and the connector switches (board ticket 476) put their columns on its connector rows. What each reads from this landing is named in §J, and nothing of either is built here.

How to see it working: Acceptance, C1 to C12.

## Progress

- [x] (2026-11-14) This document written against master `c7b62e48b`; the code statements in "What the code says today" checked at that commit, and U11g's document and first milestone read on `origin/ux-wave/U11g` at `018f471f2`.
- [x] (2026-11-14) The adversarial review of this document: five findings, each checked by the architect in the code and accepted. The architect ruled on them, on the cut and on the seven points this document had reported, and this document was revised once to the rulings (Decision Log): X-184 left for U11h; the icon read's periods stated as they are; one more test file that imports the retired request store; what the kept book holds once an operation has ended.
- [x] (2026-11-15) The one pass over "Statements about U11g's code", against master `93905c9ef` merged into this branch (head `d1aee5dc9`): eight statements hold, three are restated (G-2, G-3, G-11), G-4 and G-9 gain what the code names; M1, M2, §D, §H and the e2e table are corrected to them. "What the code says today" was read again where master moved since `c7b62e48b`: only U11g's files lie under a statement (code, 2 and 12, restated). The import cycle of the two connector sheets, a tracker row U11g left to this landing, ends in M2.
- [x] (2026-11-15 UTC) M1 — One image component, the letter tile, the directory's icons on installed items. Commits `c54b22f0f`..`1b929e709`, fix `b8e19cebe` (the 44 px head box); reviewed clean. C7's red run at `c54b22f0f`.
- [x] (2026-11-15 UTC) M2 — The page: My items and Discover outside, Show inside, one place that holds what a person started. Commits `a55f72769`..`346071e46`, fix `b460aedab`..`02b9b0101`; reviewed clean. Red runs at `a55f72769` (C12, the import cycle, the page module), `3d91faa89` (a sheet after a change of project) and `b460aedab` (the review's four).
- [x] (2026-11-15 UTC) M3 — My items, All; one search. Commits `9c78d2154`..`44eea0f0d`, fixes `bed4feb92`..`40e099f82` and `eccdb0555`; reviewed clean. Red runs at `9c78d2154` (22 of 22) and `bed4feb92`.
- [x] (2026-11-15 UTC) M4 — Discover, All. Commits `f26c9665b`..`be3f17328`, fix `11ad36db5`..`c7340507b`; reviewed clean. Red runs at `f26c9665b` and `11ad36db5`.
- [ ] M5 — The record, the e2e scenes written, the whole checks, the hand-back.
- [ ] The architect's: the e2e scenes on a Mac, the branch review, class 1a, the pull request (Proof, P1 to P5).

## Statements about U11g's code, checked on master

U11g is on master (`93905c9ef`, wire minor 47). Each statement the first versions of this document rested on was read against the code on this branch on 2026-11-15; the table says what holds and what is restated, and the places of this document that rest on a restated one are corrected to it.

| | the statement, as the code has it | checked | this document rests on it in |
|---|---|---|---|
| G-1 | The action is one button, `CONNECTORS.addCustom` ("Add custom connector…"), marked `data-connector-add-custom`, mounted in `ConnectorsSection`'s My items toolbar (`data-customize-toolbar="mcp"`), before Refresh, and drawn in My items only. No key, no keymap row, no palette entry. | holds | M2 (the move to the head), §D "The head", C11 |
| G-2 | It opens the sheet by the section's **`askIn`** with the sheet's own key: `askIn('connector:add', CUSTOM_ADD, null)`, where `CUSTOM_ADD` is `requestFor('mcp-add', { name: '', scope: 'user', entry: { type: 'http', url: '', headers: [] } }, null)`. `ConnectorSheet` hands an `mcp-add` request whose input is an entry (`isMcpEntryAdd`) to `CustomConnectorSheet`, a file of its own beside it, which takes the same four props; `ConnectorSheetEnv` gained `place`, the page's name for its place. | restated (`askIn` and its key, not `ask`; the sheet's file; `env.place`) | M2, §D "One place that holds what a person started" |
| G-3 | The read at the sheet's opening is **not the sheet's: it is `useConnectorManage`'s.** That hook calls `useCustomizationInventory(cwd)` itself (the page's own query, shared by its key), reads again at each custom opening (twice when no answer was in hand, so that the read counted began after the opening), keeps `Asking.read` (`'out'`, `'answered'`, or null for every other sheet) and hands the sheet `configuredSinceOpening(…)` as `env.configured`; its signature is `useConnectorManage(cwd, place, configured, retryServers)`. `CustomizeView.tsx` was not edited by U11g. | restated: the first version said the sheet needs only `env.configured` and `env.retryServers` from the section | M2: the page's one place takes this logic whole (§D) |
| G-4 | An add runs under `customAddKey(scope, name)`, `connector:add:<scope>:<name>`. Its line is drawn by `Adding` (`ConnectorsSection.tsx`) through `Gone`, marked `data-connector-adding`, at the head of the configured list while `addLineShown(state)` holds: working, a send refused, or done and not ok; a succeeded add draws nothing there. What the line draws once the add has ended is the engine host's `done` event's words with its code (`OperationLine`), under the name, which `Adding` reads from **`entry.request.input.name`**. | holds; the reader of the name is one more reader of an ended entry's request (code, 12) | §D "What the book keeps of an ended operation", §E "Results with no row", M2, M3 |
| G-5 | `OperationBook.run` sends `connectors.addJson` with `folder` for a request whose input is an entry (`commandOf`), and keeps `shownRequestOf(asked)`: header and variable values masked; the URL, the command and the arguments as typed. Its comment says "nothing it holds while the section is mounted". | holds | §D (after this landing the request is dropped when the operation ends) |
| G-6 | U11g's M2 says: "the section is keyed by its folder, so choosing another project closes the sheet and drops the lines". After U11c the sheet still closes, and the lines are kept for the place (§D). U11g's "a failed line stays until an add of the same name and scope replaces it or the page changes" becomes "until an add of the same name and scope replaces it". | holds: the connector book is still not kept (`usePluginOperations()` with no name) | §D; one dated line in U11g's document (The record) |
| G-7 | `forgetSignIn({ name, scope, cwd })` after a successful connector change is in the connector manage's `onConfirm` and serves a custom add too. | holds | M2 |
| G-8 | No control on an add's line starts the add again from the book's copy of the request: `Adding` draws `Gone`, whose line offers Cancel while the operation works and nothing after. | holds | §D "What the book keeps of an ended operation" |
| G-9 | U11g's tests of the action are the six cases of `describe('Connectors › Add custom connector')` in `customize/CustomizeView.test.tsx`, which reach it on the Connectors section by its role and name; the sheet's own are `customize/connectors/CustomConnectorSheet.test.tsx` and `custom-form.test.ts`, mounted through `ConnectorSheet`. Its e2e scene is "custom: a local command for all projects and a remote one shared in the project, added from My items through the real CLI; a name taken meanwhile refused on the line" (`e2e/discover-connectors.spec.ts`), through the helpers `openConnectors` and `panel`. | holds; the names are now the code's | M2, M5, "The e2e groups" |
| G-10 | `widgets/copy.ts` holds U11g's sentence in `MCP.reach`; this landing edits one other entry of that file (`LIBRARY.show`) and not that one. | holds | "Files both landings edit" |
| G-11 | U11g's command joined `src/shared/ipc/schema.test.ts` (its list of the runner's commands) and `test/support/cross-build-samples.test.ts` (commands the hosts answer). **A command of main joins neither:** `catalog.postures` and `catalog.icon` are named in `src/shared/ipc/names/catalog.ts`, `routes.ts` and `routes.json`, and nowhere in those two tests. | restated: the two test files are not this landing's | M1 |

**Files of U11g's that this landing edits**: `src/renderer/src/customize/connectors/ConnectorsSection.tsx`, `ConnectorSheet.tsx`, `CustomConnectorSheet.tsx` (its imports only: the cycle, M2), `copy.ts`, `present.ts` and their tests; `src/renderer/src/customize/CustomizeView.test.tsx`; `src/renderer/src/widgets/plugins/operation.ts` and `operation.test.ts`; `src/renderer/src/widgets/copy.ts`; `e2e/discover-connectors.spec.ts`; `e2e/widgets.spec.ts`; `src/shared/ipc/routes.json` and `routes.ts`; U11g's own execution document (one dated line). Not edited: `custom-form.ts` and the sheet's own code and tests beyond the import. Not edited here: `src/shared/plugins/` (U11g's rules), `src/engine-host/`, `src/shared/ipc/wire.ts` and the generated wire files, `widgets/McpWidget.test.tsx`'s and `McpDriven.test.tsx`'s sentence patterns.

**Where U11g's action and sheet sit in the new structure.** The words and the sheet do not change. The button stands in the head's second row, among the tools at its right, before Refresh, in My items while Show is Connectors or All (the child's "Waiting" entry for l8-settings-05 names both), and nowhere in Discover. The sheet is drawn by the page's one place that holds what a person started (§D), over the page, whichever Show value was chosen when it opened. The add's line stands at the head of the connector rows: of the Connectors list, and under All of the connectors' part (§E).

## The landing's edge

**In.** O-14's structure; the image component, the letter tile and the directory's icons on installed items.

**Not included, each a landing of its own** (named so that nobody builds it here):

| landing | what it holds, and what this landing leaves for it |
|---|---|
| **U11h · a plugin's connectors (X-184)** | The inventory's rows for the connectors a plugin brings, their row in My items with "from <plugin>" and Sign in, the coverage note's new words, the lists before a chat starts, the wire's minor, the engine host's and the services' part. Cut out by the architect (Decision Log); its draft is kept outside the repository until its engine probe has answered. **Here the connector list draws the configured rows as today, under today's coverage note**, and the "+" › Connectors submenu and the dialog before a chat starts are not touched. This landing builds the connector's row as a component of its own for the configured kind, shaped so that U11h adds the plugin kind without reshaping it (§E, §J). |
| U11b · the default writer | Nothing shared but `widgets/copy.ts`, in other entries (the table's "touch no file in common" is corrected under "The table's columns, checked"). |
| U11d · connector icons | The favicon route, the kept copies, the switch "Connector icons" and its Settings row, `site` on a catalog item and on a posture, `catalog.favicon`, the amendment of the aggregator spec's Decision Log 7(b) and the four code headers that cite it. **This landing fetches no site icon.** It leaves one named place: `ItemImage` (§C) has a fixed box that the tile fills first, and U11d adds one prop, `site`, and one read between the directory's icon and the tile. |
| U11e, U11f | Untouched. |
| the connector switches (board ticket 476) | The two switch columns, rows for connectors that are off, the record, the default, the acts. §J names what it reads from this landing and from U11h. No switch, no column, no record and no sentence about them is built. |
| the move of MAWS's own list; "New skill…", Open and Reveal on a skill's detail; a skill's switch | Untouched (the child's "Waiting"). |

Also not included (the child's "Not included" of the two items): counts on the Show choices; one list across kinds ordered by name; a card for a single skill in Discover; Customize for another machine; any change to the session's `/plugins`, `/skills` and Connectors dialogs beyond the images and the word "Filter"; icons in a session's Connectors dialog, in the "+" › Connectors submenu or on the Connectors card.

**The table's columns, checked against the code.**

- *"holds: … X-184".* No longer: U11h (above).
- *"after: U11a; either side of U7b".* U11a is on master. U7b is on master too, so "either side" is settled: Customize is a page, the stored tab is gone, and the item's paragraph "While Customize is still a stored tab" describes a build that no longer exists. Where the page is, is U7b's `destination` key, whose schema already holds both fields with `all` among them (`DestinationSchema` in `src/shared/ipc/schema/layout.ts`). U7b left three stand-ins that this landing retires: `SECTION_OF_SHOW` and `SHOW_OF_SECTION` (`destination/customize.ts`), `requestDiscover` and `customizeDirectory` (`destination/discover.ts`), and the request store `useDiscoverRequest` with `takeDiscoverRequest` (`customize/open.ts`).
- *"after": one more.* U11g lands before this one (the architect's order); the table does not name it.
- *"review: the panel by size".* Holds without X-184 too: about 4,450 changed lines in about 63 files ("Size").
- *"U11b and U11c touch no file in common".* One: `src/renderer/src/widgets/copy.ts` (U11b's words under the model list are `SELECTOR.sessionOnly` there; this landing's is `LIBRARY.show`). Different entries, so the merge is clean; they can still run together.
- *The table's last sentence* ("the tile and directory icons can move ahead of the structure; the cost is drawing them into three section bodies that U11c then moves") is taken in a cheaper form: the rows and cards are components that the structure moves and does not rewrite, so M1 draws the images into them before M2 moves the bodies, and nothing is drawn twice.

## Words used here

- **The page** is the Customize page, U7b's destination `{ kind: 'customize'; view; show }`. **Where** it is, is those two fields. Its **place** is the folder it is about: a project of this Mac, a folder no project has, or the user configuration (`customizePlace` in `destination/discover.ts`).
- **A kind's body** is what one Show value draws under the head: the plugin list with its loaded line and groups, the skills' groups, the configured connectors with the live list under them, or that kind's Discover.
- **The attached session** is the ready session MAWS runs on this Mac in exactly the page's folder that the "Live session" picker names (`attached` in `CustomizeView`). A page never starts one.
- **The inventory** and **MAWS's own list** are the words the child's file defines before its first item.
- **The book** is the set of operations a person started on a page and their lines (`OperationBook` in `widgets/plugins/operation.ts`); a **kept** book is found again by its name after the views that showed it have gone. An operation has **ended** when its `done` event has come or its send was refused.
- **The held copy** is what main's catalog store has on disk of the network sources (`CatalogStore`, `src/main/catalog/store.ts`): `loaded()` reads it and fetches nothing; `ready()` may refresh.
- **Build F** is `f1852de3a`, the build on the owner's machines.

## What the code says today, beyond the section

Checked at the parent pin. Numbered so that milestones can point.

1. **The page already has its two fields, and nothing writes one of them.** `DestinationSchema` admits `view: 'mine' | 'discover'` and `show: 'all' | 'plugins' | 'skills' | 'connectors'`; `openDestination` with the same kind changes only those fields and closes the Settings dialog (`stores/layout.ts`). `DestinationPage.tsx` turns `show` into a section for `CustomizeView` (`all` as Plugins) and delivers `view: 'discover'` to the plugin library alone, through `useDiscoverRequest`. No opener writes `all`.
2. **Three sections, three states.** `CustomizeView` keeps each section mounted once visited (`forceMount`), because each holds its own operations and sheet: the plugin library's `useManageState` with the kept book `customize:plugins:<folder>` (`widgets/PluginsWidget.tsx`, `LibraryBody`), `SkillsManage` with the kept book `customize:skills:<folder>` (`customize/discover/SkillsDiscover.tsx`), and `useConnectorManage(cwd, place, configured, retryServers)` with a book that is **not** kept (`customize/connectors/ConnectorsSection.tsx`: `usePluginOperations()` with no name). Since U11g that hook also owns the read at a custom sheet's opening (G-3). So a connector's line is lost when the page is left or the project changes, and a plugin's is not. Each body is keyed by the folder, so a change of project resets details and sheets; `PluginsLibrary`'s comment gives the reason ("an old request cannot silently become a change in a different project"), and the test "Customize: an add-then-install outlives a change of the page's project" (`customize/discover/Discover.test.tsx`) pins the kept books.
3. **One component is both the session's dialog and Customize's plugin body.** `LibraryBody` serves `presentation.variant` `modal` (the session's `/plugins`) and `embedded` (Customize), and holds the view (`tab`), the selected plugin, the marketplace dialogs and the manage state. Its head is `WidgetFrame`'s, whose embedded variant carries `heading`, `toolbar` and `scope`.
4. **Two `ask`s behind one context.** A Discover card's `+` calls `useManage().ask(key, request)` (`customize/discover/CatalogCard.tsx`). Under the plugin and skill bodies that opens the install sheet (`ConfirmSheet`); under the connector body the same call opens `ConnectorSheet`, because that body provides its own `Manage`. One grid that mixes plugins and connectors needs one `ask` that chooses the sheet by the request's action.
5. **Search, filter and sort are shared with the session's dialogs.** `MyItems` and `DiskSkills` read `useLibraryStore` (`widgets/plugins/library-store.ts`), which the session's `/plugins` and `/skills` read too, "for the app run". The connector list has no search field. Discover's choices are per kind in `useDiscoverStore` (`customize/discover/store.ts`).
6. **Images.** `CatalogIcon` (`customize/discover/CatalogIcon.tsx`) draws `item.iconUrl` through `catalog.icon`, else `monogramOf(item.name)` in a neutral box, and marks itself `data-catalog-icon="image" | "monogram"`. `PluginTile` (`widgets/plugins/PluginRow.tsx`) is one glyph, used by the plugin row, the loaded-only row (`LoadedView.tsx`) and the built-in mods (`BuiltInMods.tsx`); the plugin's detail draws the glyph itself (`PluginDetail.tsx`); `SkillTile` (`widgets/skills/SkillsLibrary.tsx`) draws "/" or a document glyph; `ServerRow` has no image.
7. **How `catalog.icon` answers, and when it asks the network** (`CatalogIcons.resolve`, `src/main/catalog/icons.ts`; pinned by `icons.test.ts`). Only a URL that `isIconUrl` admits is answered at all: the two icon routes of `CATALOG_EGRESS`, the directory's plugin icons on `api.anthropic.com` and its server icons in its own storage bucket; any other URL answers null with no request. Then, in order:
   - a kept copy (`<userData>/catalog/icons/<sha256 of the URL>.json`) is answered with no request while it is **a plugin icon**, whose URL names its content's hash (`CONTENT_ADDRESSED`: under `/api/directory/plugin-icons/`), at any age; or while it is **younger than 24 hours** (`REFRESH_AGE_MS`), for a server icon;
   - otherwise, where a request for that URL failed less than five minutes ago (`RETRY_MS`), the old copy is answered if there is one, else null, with no request;
   - otherwise the URL is asked, four requests at a time and one per URL however many ask together; an answer whose bytes are the image its type names is kept and answered; a failure is remembered for the five minutes and the old copy, if any, is answered.
   So a plugin icon is fetched once and never again, and a server icon is fetched again by the first ask after its copy is a day old. In the window `useCatalogIcon` (`customize/discover/read.ts`) holds an answer for a day and a miss for five minutes before it asks main again; Discover's Refresh and `catalog.changed` make it ask sooner, and main answers those from the rules above.
   **`catalog.postures` cannot reach the network:** it awaits `store.loaded()` and reads `store.data()`. Building a folder's whole catalog (`catalogOf`) is a different cost: it asks the machine for the engine's view, which runs the engine's CLI, and `e2e/widgets.spec.ts` pins that the session's `/plugins` does not cause it ("the catalogue is read only once Open Discover shows it").
8. **A directory record knows a plugin by its repository, not by `name@marketplace`.** The join (`src/main/catalog/join.ts`, `pluginItem`) ties a record to the marketplace routes that install it; a `CatalogItem` carries the chosen route and only the names of the others (`alsoListedBy`). An installed plugin's id is `<name>@<marketplace>` (`PluginIdentity.id`).
9. **Customize cannot show another machine.** Its project list is cut to this machine's (`machineOf(id) === ipc.localMachine`), the inventory, the plugin reads, the catalog reads and every operation are sent with `{ machine: ipc.localMachine }`, and the live and signing sessions are filtered to this machine's (`CustomizeView.tsx`, `customize/inventory.ts`, `widgets/plugins/read.ts`, `customize/discover/read.ts`, `widgets/plugins/operation.ts`, `ConnectorsSection.tsx`). `src/endpoint/offers.ts` has no row for any `catalog.*` command, which are main's.
10. **The eight author colours are theme colours.** `--author-1` to `--author-8` (`styles/tokens.css`, both themes) are exposed as `--color-author-1` to `-8` (`styles/app.css`), so `bg-author-3` and `text-author-3` are token utilities. No renderer source uses one with an opacity modifier yet. The tokens guard (`test/support/tokens-guard.ts`) reads source text for hex colours, colour functions and palette classes.
11. **The request store that M2 retires has a reader outside Customize's own tests.** `src/renderer/src/widgets/before-start.test.tsx` imports `useDiscoverRequest` and, in "opens Customize for the user configuration from Open Discover when no folder is chosen", asserts that the dialog's `close` was called, that `useCustomizeProject` holds `{ projectId: null }` and that the request holds `{ cwd: null }`.
12. **What reads a book entry's request.** An entry holds the request for as long as the book does (`PluginOperationEntry.request`): the request as asked, but for a custom add, of which it holds the shown form, with header and variable values masked (`shownRequestOf`, U11g). Its readers: the operation's line, for the scope in the reload report (`scopeOf(entry.request)`) and for the marketplace an install added first (`entry.request.afterAdd`: its name and scope, for the sentence and for "Remove marketplace"), both in `widgets/plugins/manage.tsx`; the head of the connector list, for a removal's action and name (`Configured` in `ConnectorsSection.tsx`) and for an add's name (`Adding`, U11g: `entry.request.input.name`); Discover's results whose card has gone, for the item's name (`request.catalog?.name`, `LeftResult` in `DiscoverPane.tsx`). Nothing starts an operation again from the book's copy: the second step of an add-then-install and the second sheet of a marketplace-declared command use the copy that `confirm` holds while the operation runs (`useManageState`).
13. **The e2e scenes that hold today's structure** select `getByRole('tab', { name: 'Plugins' | 'Skills' | 'Connectors' })`, `getByRole('tabpanel', …)`, the tab list named "Customize sections", `[data-widget="plugins"][data-widget-variant="embedded"]`, `[data-catalog-icon]`, and the button named "Show" (the list is under "The e2e groups").

## Reported to the architect, and ruled

The first version of this document reported eight points. The architect ruled on each on 2026-11-14 (Decision Log); the numbers are kept.

- **1, 2, 3, 4 and 6** were about X-184 (the wire's shape for the rows, the coverage sentence as a mark on the wire, the engine's name for a plugin's connector, what a row says when nothing will load it, a connector shipped as a bundle). They left with it and stand, with the architect's conditions, in U11h's draft.
- **5 · The icon requests this landing adds. Ruled: stands, on the statement of code, 7.** The item's first source is "the directory's own icon", new "for an installed plugin and for a configured connector". Its bytes come from `catalog.icon`, the existing route with its existing periods: no new route, no new host, a URL that the directory's record itself names, nothing of the person's configuration in any request. What is new is who asks: My items' rows, and the session's `/plugins` rows, which are the same rows. §C, "Where the bytes come from", says for each what can be asked and how often. *Named place for the other reading* (a row outside Discover draws a directory icon only from a copy already kept): one option on the image's read and one branch in main.
- **7 · Where the drawing and the file differ. Ruled: all six stand.**
  - The "Live session" picker is drawn **in My items only**. This follows the approved drawing, whose Discover frames have none, where the child's head names no view; it is not the child's own reading. *Named place:* §D, "The head".
  - **No community item stands on a kind's shelf of Discover › All.** The drawn Plugins and Skills shelves hold one each; the file says "one shelf per kind" and nothing on this. Built to the earlier ruling carried forward (the aggregator spec: community items stand on no shelf), which is not among the rulings reversed; and it is listed among what the owner sees at the look of the built page (P4). *Named place:* §F.
  - The search grid of Discover › All has **no sort control**: name matches first, then by name. The drawing shows one reading "Installs"; the file gives the grid one order and says that installs and rank do not mix. *Named place:* §F.
  - **"Add custom connector…" stands under All as well as under Connectors.** The drawn All has only the search field and Refresh, as the item's "The head" says; the child's "Waiting" entry for l8-settings-05 puts the action there "while Show is Connectors or All", and the drawing predates that form.
  - The search fields read **"Search my items" and "Search connectors"**, from the drawing; the file gives no label. *Named place:* §G.
  - The drawn empty All shows no built-in mod. **The empty state is decided by plugins, skills and connectors;** the built-in mods are drawn under All only beside at least one such row, and always under Show: Plugins. *Named place:* §E.
- **8 · Size. Ruled: the cut is made**, and not where the first version drew it: X-184 leaves as U11h, and this landing keeps the images, the page and both All views.

## Acceptance

Each line is behaviour a person can see or a test shows; the milestone that proves it is named in the Plan of Work.

- **C1 · Two views and one filter** (A16). The page's head shows My items | Discover and, under it, "Show:" with All, Plugins, Skills, Connectors, exactly one chosen; no tab named Plugins, Skills or Connectors is left. With Connectors chosen in My items, pressing Discover shows Discover's connectors; pressing My items again shows the configured connectors; with Skills chosen, each view shows what the Skills section showed before. The stored `destination` holds what was chosen, and a relaunch opens the page there.
- **C2 · What a person started outlives the view** (A16). An install started from a Discover card keeps running after Discover is left for My items and after Show is changed, and its line is on the item's card and, once installed, on its row; a connector's removal and a sign-in behave the same. After the project is changed and chosen again the line is still there.
- **C3 · Ways in** (A16). The sidebar's Customize row and Settings' "Customize ›" open My items, All. The composer's "Manage connectors…" opens My items with Connectors chosen, "Manage plugins…" with Plugins. The session's `/plugins` dialog's "Open Discover" closes the dialog and opens Discover, Plugins, for the session's folder, and for the user configuration when the chat has no folder. A Discover card that reads "Installed" opens My items with the item's kind chosen, a plugin on its detail when My items lists it.
- **C4 · All lists what this Mac has** (A17). In My items with All chosen, on a project with two plugins, three skills and two connectors, the list has seven rows beside the built-in mods: the plugins, the mods, the skills, the connectors, each part by name, no heading between them; each row ends in one word, Plugin, Mod, Skill or Connector, in one column. A plugin's menu, a skill's detail and a connector's Sign in and Remove work from this list. Typing in the search narrows all parts, and the text is still there after Show is changed. With nothing installed or configured the list reads "Nothing here yet. Find plugins, skills and connectors in Discover." and its button opens Discover.
- **C5 · One failed read hides nothing else** (A17). With the plugin list unreadable, All shows the plugins' own failure line with Retry in the plugins' place, and the skills and connectors under it.
- **C6 · Every item has an image** (A18). No row or card of a plugin, a skill, a connector or a built-in mod is drawn without one, in Customize and in the session's `/plugins` and `/skills` dialogs. An item with no icon shows its letter on one of eight colours, the same letter and colour in My items, in Discover, in its detail and after a relaunch. An installed plugin that the directory lists with an icon shows that icon in My items, and a configured connector whose address matches exactly one directory record with an icon shows that record's icon. The row does not move when an icon arrives.
- **C7 · The image requests this landing adds are the existing route's, and only so** (binding 13; ruled point 5). Drawing My items and the session's `/plugins` rows asks `catalog.icon` only for an icon URL that a directory record names, and main asks the network for it only as code, 7 says: a plugin's icon at most once ever, a connector's icon when no copy is kept and again by the first draw after its copy is a day old, a failed request not again inside five minutes. No request is made for an item the directory does not list, and none to any host but the two the icon routes already name; `CATALOG_EGRESS` is unchanged. (Discover's own traffic, its sources and its cards' icons, is as today and is not this line's.)
- **C8 · Discover, All** (O-14). The home is the Featured plugin and three shelves, Plugins, Skills, Connectors; a shelf's "See all" chooses that kind in Show. A search or a chip turns the page into one grid across kinds, in which each card says Plugin or Connector beside its name; a connector's `+` there opens the connector sheet and a plugin's the install sheet. No Category menu and no sort control are drawn under All.
- **C9 · This Mac only** (bindings 9 and 14). The page lists this machine's projects and folders and nothing of another machine's; with a project of another machine in front it is the user configuration's page; every command it sends names this machine or is one of main's own. No command this landing adds or changes can be sent to another machine.
- **C10 · Nothing stored, nothing on the wire** (UC-14). This landing adds no layout key, no settings key, no file of a new kind, and no command, event or property between builds: `WIRE_MINOR` and the wire's manifest are not in its diff.
- **C11 · U11g's action, and the narrow page.** "Add custom connector…" stands at the head's right in My items under Connectors and under All, opens U11g's sheet, and its tests pass moved. At 400 px the head stacks as the item's "Narrow" gives it and the four Show choices stay on one line.
- **C12 · An ended operation leaves only its line** (the architect's ruling). Once an operation has ended, the page's book holds its outcome and the few fields its line and that line's controls read, and no longer the request: after a custom add ends, nothing the book holds contains the URL, the command or an argument that was typed, except where the engine's own words on the line quote one (§D).

## Constraints that bind every milestone

- **The build brief binds.** No typecheck, lint, vitest, install, Electron or build on the MacBook; every check runs on the build VM in a checkout of the pushed head (Concrete Steps). The VM is shared with two other landings: a slow or timed-out check is read against its load first. A test that fails must fail in bounded time.
- **No engine fact is added.** This landing reads no new thing from the engine, sends it nothing new and runs none; the engine facts X-184 needed left with it.
- **Privacy** (UC-11, the architect's rule). A fault is never reproduced by reading the content of a person's session, settings file, configuration file or plugin folder: structure and counts only, and none of it enters the repository. Every name in a test, a fixture or a scene is invented, plugin, connector and skill names included. Nothing is copied from the drawn example beyond what the child's file says and what the architect ruled (point 7).
- **Nothing stored, nothing in a settings file, nothing on the wire** (UC-14). §H is the whole list. A milestone that finds it must store something, or change a command the engine host, the services or `mawsd` answer, stops and reports.
- **This Mac only** (bindings 9 and 14). Every read and operation of the page keeps `{ machine: ipc.localMachine }`; no offer row, capability or `remote-unavailable` entry is added.
- **Every request MAWS makes goes through a declared egress rule, and the window fetches nothing** (binding 13). `src/shared/net/egress.ts`, `src/main/catalog/icons.ts` and `fetch.ts` are not edited. An icon is drawn only as image data in an `<img>` (`IMAGE_DATA` in today's `CatalogIcon`, kept).
- **Tokens only** (law 7). The tile's colours are `author-1` to `author-8`; no new token. In renderer source a ticket is written in words ("ticket 476"), never with a number sign; run `test/support/tokens-guard.test.ts` with every milestone that adds renderer source.
- **Keep means keep** (law 8; A15). What a row can do, what a sheet writes and what the session's dialogs do are not changed: a kind's body is moved whole. The connector list's rows, its coverage note and the lists before a chat starts are today's. A milestone that finds a behaviour of a row, a sheet or a dialog changing beyond the images, the word "Filter" and what this document names stops and reports.
- **Files other children own** (UC-8). Named insertions only: in U7's `destination/` (M2: `DestinationPage.tsx`, `customize.ts`, `discover.ts` and `DestinationPage.test.tsx`: the page passes its two fields, and the three stand-ins of "The table's columns" go); in U13's sense of `customize/CustomizeView.tsx`, the current project read (`useCurrentRow`) is kept as it is; in `e2e/cross-build.spec.ts` (the P5 work's) nothing. `composer/plus-menu/PlusMenu.tsx` (U4's) is **not** edited: `openCustomize` keeps taking the names it passes. In a file no child holds: `src/shared/ipc/routes.json` (one name, for main's new command; made again after the last merge of master).
- **Merge, never rebase or force-push.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e.
- If a command fails with "No space left on device": stop, report, delete nothing.

## Plan of Work

Five milestones. M1 draws the images into rows and cards that M2 then moves and does not rewrite; M2 is the move itself, and is reviewed before M3 and M4 build on the page; M3 and M4 each add one view of All; M5 is the record and the whole checks. Until M3 (for My items) and M4 (for Discover), the Show value All draws what Plugins draws, as U7b left it, and no test asserts All's content.

**Size**, counted from the code (changed lines, tests included; files with the overlap between milestones counted once in the total):

| | changed lines | files |
|---|---|---|
| M1 | about 650 | about 20 |
| M2 | about 2,150 | about 33 |
| M3 | about 600 | about 11 |
| M4 | about 650 | about 14 |
| M5 | about 400 | about 11 |
| the landing | about 4,450 | about 63 |

### M1 — One image component, the letter tile, the directory's icons on installed items

**At its end** every row and card of a plugin, a skill, a connector and a built-in mod draws `ItemImage` (§C), in today's three sections and in the session's `/plugins` and `/skills` dialogs: the directory's icon where there is one, else the letter tile. Nothing moves yet.

**Touches.** New `src/renderer/src/customize/image/` (the component, the tile's rule, their tests). `customize/discover/CatalogIcon.tsx` (retired into the component), `read.ts`, `CatalogCard.tsx`, `CatalogDetail.tsx`, `DiscoverHome.tsx`; `widgets/plugins/PluginRow.tsx`, `LoadedView.tsx`, `PluginDetail.tsx`, `BuiltInMods.tsx`, `MyItems.tsx`; `widgets/skills/SkillsLibrary.tsx`; `customize/connectors/ConnectorsSection.tsx` (the row's image). In main: `src/shared/ipc/schema/catalog.ts` with the new command's name, route and grade rows where `catalog.postures` has its own; `src/main/catalog/index.ts`, `join.ts`, `postures.ts` and their tests (`icons.test.ts` gains cases and `icons.ts` is not edited). The tests that pin today's tiles: `customize/discover/Discover.test.tsx` (the icon's mark), `widgets/PluginsWidget.test.tsx`, `widgets/SkillsWidget.test.tsx`, `widgets/plugins/BuiltInMods.test.tsx`, `customize/CustomizeView.test.tsx`. The new command is named in `src/shared/ipc/names/catalog.ts` and taken by `routes.json` in its `machine-wide` class, beside `catalog.icon`; `routes.ts` is not edited (Decision Log, 2026-11-15, M1); it joins no test's list of commands (G-11).

**Interfaces.** Exposes §C. Consumes `monogramOf` (unchanged), `useCatalogIcon`, `catalog.postures`.

**Decisions.**
- *`catalog.pluginIcons` reads the held copy and nothing else* (code, 7 and 8): `store.loaded()`, then a join of the network data with no engine view, built once per revision of the store; it never calls `ready()`, never asks the machine for the engine's view and never refreshes. So the session's `/plugins` dialog still causes no catalog read of the engine. A plugin installed from a marketplace that is not one of the seeds has no route in that join and gets its tile.
- *The postures' `iconUrl`* is the icon of the one directory record a configured connector's address matches, by the match `posturesOf` already makes; null for none and for several. It is read from the held copy, as the posture is.
- *One read per list, not per row*: the list asks for the ids it draws; a row takes its URL from that answer.
- *The seed* (§C) decides both the letter and the colour, so that an item is the same in My items and in Discover: a Discover card's letter comes from its install name where it has one, no longer from its display name.
- *The "/" tile of an invocable skill goes* (the item); "Use in chat" says it.
- *No image* in the Connectors dialog, in its rows before a chat starts, in the "+" submenu or on the Connectors card (the item's "Not included").
- *Pitfall.* Tailwind sees a class only where its whole name is written: the eight colour pairs are one table of literal class names (§C). The component's mark changes (`data-item-image`), so the e2e assertions on `data-catalog-icon` change in M5.

**Does not touch.** The structure of the page. `src/shared/net/egress.ts`, `src/main/catalog/icons.ts`, `fetch.ts`. The engine host, the services and the wire. The four code headers that cite the aggregator spec's Decision Log 7(b) (U11d rewords them with the reversal).

**Proves** C6 and C7. Its tests pin:
- the tile's rule: the vectors of §C; the same seed gives the same letter and colour for a row, a card and a detail;
- **held open**: with the icons' read out, every row is drawn with its tile; when the read answers, the icon stands in the same box and no row is added, removed or reordered; when the read fails or answers null the tile stays;
- an installed plugin whose id a route of the held copy installs, and whose record names an icon on an approved address, draws that icon in My items and in the session's `/plugins` dialog; one with no record, or with an icon elsewhere, draws its tile and asks `catalog.icon` nothing;
- a configured connector whose address matches exactly one record with an icon draws it; two records, or none, draw the tile;
- in main: `catalog.pluginIcons` with a store whose refresh and whose machine read would count: neither is called; an id no route installs answers null; more than 512 ids are refused;
- **the requests the new askers cause** (C7), in main with `CatalogIcons`' `get` recording and a clock the test moves, for the URLs `catalog.pluginIcons` and the postures hand out: no kept copy: one request, however many rows ask together; **a kept copy that is old but present**: a plugin icon's copy of any age causes none; a connector icon's copy older than 24 hours causes one, and when that request fails the old copy is still drawn and no second request is made inside five minutes; a copy younger than 24 hours causes none; a URL off the two routes causes none; and the same sequence seen from the window: a row drawn again inside the window's own periods asks main nothing;
- `CATALOG_EGRESS` is deep-equal to what it was (a snapshot of its routes in the test);
- an SVG icon's script and external reference neither run nor load (today's case, kept on the new component).

### M2 — The page: My items and Discover outside, Show inside, one place that holds what a person started

**At its end** the head is the item's two rows, the three section tabs are gone, each kind's body is drawn under its Show value in each view as it is today, and what a person started is held by the page for its place (§D), an ended operation keeping only what its line needs. U11g's action stands in the head. The connector's row is a component of its own (§E). All still draws Plugins.

**Touches.** `customize/CustomizeView.tsx` and the files the executor cuts from it (the head; where the page is and its in-memory state, `customize/page.ts`); `customize/open.ts`; U7's `destination/DestinationPage.tsx`, `destination/customize.ts` (removed), `destination/discover.ts` (left with `customizePlace`); `widgets/PluginsWidget.tsx`; `widgets/plugins/LibraryHeader.tsx`, `manage.tsx`, `MyItems.tsx`, `operation.ts`, `present.ts`; `widgets/WidgetFrame.tsx` (the embedded variant goes if nothing draws it); `widgets/copy.ts` (`LIBRARY.show`); `customize/connectors/ConnectorsSection.tsx`, with `ConnectorRow.tsx` and `rows.ts` cut from it; `customize/connectors/ConnectorSheet.tsx` and `CustomConnectorSheet.tsx` with a new `customize/connectors/sheet-parts.tsx` (the cycle, below), and the type import of their two tests; `customize/discover/SkillsDiscover.tsx`, `DiscoverPane.tsx`, `DiscoverToolbar.tsx`; `customize/connectors/copy.ts` and `customize/discover/copy.ts` for §G. Tests: `customize/CustomizeView.test.tsx`, `customize-machine.test.tsx`, `customize/discover/Discover.test.tsx`, `destination/DestinationPage.test.tsx`, `widgets/PluginsWidget.test.tsx`, `widgets/WidgetFrame.test.tsx`, `widgets/plugins/LibraryHeader.test.tsx`, `widgets/before-start.test.tsx` (code, 11), and the tests of `operation.ts`.

**Interfaces.** Exposes §D and §E's row. Consumes U7b's `openDestination`, `Destination` and the page's Esc rule (a search field marked `data-escape-clears` clears first, then the page closes), U13a's `useCurrentRow`, U11g's sheet and action (G-1 to G-9).

**Decisions.**
- *The move, not a rewrite.* `MyItems`, `PluginDetail`, the loaded line, `SkillsLibrary`, `Configured` with its live list, `DiscoverPane` and the sheets keep their code; what changes is who mounts them and who holds the state above them. The session's `/plugins` dialog keeps its head and its look: `LibraryBody` is cut into the reads and the list that both use, the dialog that only the session uses, and nothing else.
- *What the page holds, and for how long* (§D). One kept book per place, `customize:<folder or 'user'>`, for all three kinds, in place of the two kept books and the one that was not kept (code, 2). So a connector's line now outlives a change of project and the page being left, as a plugin's does. Lost: lifting the three states as they are. One grid that mixes kinds (M4) needs one `ask` and one set of lines (code, 4), and a book that is kept for two kinds and not for the third cannot be one book.
- *An ended operation keeps only what its line needs* (the architect's ruling; §D). Because a line now lives for the run of the app, the book drops the request when the operation ends and keeps the five fields code, 12 lists as read. It is the book's rule for every action, in the session's dialogs too, not a case for a custom add.
- *The sheets and the marketplace dialogs* are drawn by that one place, over the page, and a change of project closes them (the bodies and the place's state stay keyed by the folder; code, 2). A change of view or Show cannot happen under an open sheet, which is modal.
- *Search* (§D): My items has one text, the page's, held for the run. The bodies that read the library store take it in the store's place; Filter and Sort stay the store's, shared with the session's dialog as today. A body's "Reset filters" clears the page's text. Discover keeps its choices per Show value in `useDiscoverStore`, as today: its chips, category and sort mean different things per kind.
- *A detail hides the tools.* While a plugin's or a skill's detail is open the head's second row keeps Show and draws no tools, as the library's head does today; pressing the view shown, or a Show value, returns to the list.
- *The word "Filter"*: `LIBRARY.show` reads "Filter", in Customize and in the session's `/plugins`.
- *Ways in* (§D): `openCustomize()` with no section opens My items, All; with a section, that kind. **The request store for Discover goes, with no export left behind for its old readers** (the architect's ruling): the view is a field of the page. The one test outside Customize that read it (code, 11) keeps its case and its assertion that the session's dialog closes, and asserts in the store's place that the page is open on Discover, Plugins (`{ kind: 'customize', view: 'discover', show: 'plugins' }`) and that its place is the user configuration, chosen explicitly (`useCustomizeProject` holds `{ projectId: null }`).
- *The custom sheet's opening read moves whole* (G-3). What `useConnectorManage` does at a custom opening (the read begun after the opening, `Asking.read`, `configuredSinceOpening`) is the page's one place's from now on, over the page's one inventory read, with its code and U11g's four held-open cases kept; `env.place` is the page's.
- *The two sheets stop importing each other* (the tracker row U11g left to this landing). Today `ConnectorSheet.tsx` imports `CustomConnectorSheet` to hand it a custom add, and `CustomConnectorSheet.tsx` imports `Configured`, `Problem`, `Unresolved` and `ConnectorSheetEnv` back from `ConnectorSheet.tsx`. The four move to a file of their own, `customize/connectors/sheet-parts.tsx`, which both sheets import and which imports neither; `ConnectorSheet` keeps handing a custom add to `CustomConnectorSheet`, so the sheets' tests keep mounting as they do and change one type import. No re-export is left behind. The tracker row closes with this landing. Lost: moving the hand-over out of `ConnectorSheet` into the page's place; it ends the cycle too, and would re-mount every case of the custom sheet's test.
- *The connector's row* is cut out of `ConnectorsSection.tsx` as `ConnectorRow`, over `ConnectorRowModel`, with its code kept and nothing a person sees changed; the model is a union with one member, so that U11h adds a second without reshaping the first (§E).
- *Pitfalls.* The page region's Esc and focus rules are U7b's and are not edited: the search field keeps `data-widget-search` and `data-escape-clears`, and `/` focuses it. `customizePlace` stays the one rule of the place. The "Live session" picker's change must not reset what was typed or chosen on disk (today's test "keeps the plugin session picker… without resetting disk choices"). Leaving a detail returns the keyboard to the row it was opened from (`data-row-open`), as today.

**Does not touch.** What any row, sheet or dialog does. `composer/plus-menu/PlusMenu.tsx`. The layout store and its schema. `customize/InventoryState.tsx` and the coverage note. `widgets/McpWidget.tsx`, `widgets/connector-menu.ts`. All's own list (M3), Discover's All (M4).

**Proves** C1, C2, C3, C9, C11, C12 and the keeps. Its tests pin:
- the head's two rows and their order; Show is a radio group named "Show" with four choices, one checked; no element of role `tab` named Plugins, Skills or Connectors; the tools drawn for each of the eight pairs of view and Show (§D's table), and none while a detail is open;
- a change of view keeps Show, and a change of Show keeps the view; each writes the page's fields through `openDestination` and nothing else of the layout;
- each kind's body under its Show value draws what its section drew: the cases of today's `CustomizeView.test.tsx`, `Discover.test.tsx` and `PluginsWidget.test.tsx` that open a section are kept with their assertions and reach it by Show and the view switch; the connector list's rows, their order, their words and the coverage note are today's;
- **held open** (C2): an install is confirmed on a Discover card and its receipt comes with no `done`; the view is changed to My items and Show to Connectors and back; the line still reads its progress on the card; `done` arrives while another Show value is drawn; back on the card the result reads; the same with an add-then-install whose second step starts while My items shows; the same across a change of project and back (today's case, kept);
- **held open**: a connector's Remove is confirmed and runs; Show is changed; the project is changed and chosen again; its line is at the head of the connector rows;
- **held open**: Sign in is pressed on a configured row; `starting` is heard before the receipt; Show is changed and changed back; the steps read on the row and Cancel reaches the operation;
- a change of project closes an open sheet and resets an open detail;
- **what the book holds** (C12): while an operation runs its entry holds the request; at its `done`, with a success and with a failure, and at a refused send, the entry holds the five fields of §D and nothing else of the request; for a custom add typed with a marked URL, a marked command and a marked argument, no value the book holds after the end contains a mark, with the `done` event's words free of them; and what reads those fields still works after the end: the reload report's scope word, "Remove marketplace" after an install whose marketplace was added first and that then failed, a removed connector's name at the head of its list, a withdrawn catalog item's name; an add-then-install's second step and a marketplace-declared command's second sheet, which run before the end, are unchanged;
- each way in of C3, by the page's stored fields and what is drawn; the case of `before-start.test.tsx` as "Ways in" gives it; **held open**: a card that reads "Installed" is opened while the plugin list has not answered: My items, Plugins shows; when the list answers with the plugin, its detail opens; when the person opens another row first, or changes Show, the request is dropped;
- U11g's action: drawn in My items under Connectors and under All, not under Plugins or Skills, not in Discover; U11g's six cases of "Connectors › Add custom connector" pass with the action found in the head, its held-open cases of the opening's read among them, and under All as well as under Connectors;
- no two modules of `customize/connectors/` import each other: one small test beside the sheets that reads the folder's own source for its relative imports (the repository's lint has no rule for cycles), failing today on the two sheets and passing after;
- the session's `/plugins` dialog: its head, its Open Discover and its cases unchanged, but for the word "Filter";
- this Mac only (`customize-machine.test.tsx`, extended): with a project of another machine in front and a session of another machine ready, the page is the user configuration's and lists and attaches nothing of that machine; and in a walk through both views and the four Show values every command the page sends either names this machine or is one of main's own, which name none.

### M3 — My items, All; one search

**At its end** the Show value All in My items draws the one list of §E, the openers' default is All, and the search narrows every part.

**Touches.** `customize/` (the All list as its own file; `CustomizeView.tsx`, `open.ts`, `page.ts`); `widgets/plugins/PluginRow.tsx`, `BuiltInMods.tsx`, `widgets/skills/SkillsLibrary.tsx`, `customize/connectors/ConnectorRow.tsx` (the kind word's cell, drawn only under All); `widgets/plugins/library.ts` and `widgets/skills/skills.ts` only for an order or a filter exported; their tests and `customize/CustomizeView.test.tsx`.

**Interfaces.** Exposes §E. Consumes M2's page and row.

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
- M2's held-open sign-in, with Show changed to All in the middle.

### M4 — Discover, All

**At its end** the Show value All in Discover draws the home and the grid of §F.

**Touches.** `src/shared/ipc/schema/catalog.ts` (the tab `all`, the shelf kind); `src/main/catalog/query.ts` and its tests in `catalog.test.ts`; `customize/discover/` (`DiscoverPane.tsx`, `DiscoverHome.tsx`, `DiscoverToolbar.tsx`, `DiscoverGrid.tsx`, `CatalogCard.tsx`, `store.ts`, `add.ts`, `copy.ts`, `Discover.test.tsx`).

**Interfaces.** Exposes §F. Consumes M2's one `ask`.

**Decisions.** §F holds them. `catalog.home` and `catalog.query` are main's commands and are not on the wire between builds, so the tab's new value is no wire change.

**Does not touch.** A kind's own Discover. The catalog's sources, store and join.

**Proves** C8. Its tests pin:
- in main: the home for `all` is the Plugins home's Featured, three shelves in order with each kind's first items in that kind's own order, no community item, no card of the Plugins shelf repeated on the Skills shelf, each shelf's total the kind's whole count, and no categories; the query for `all` holds both kinds, name matches before description matches, then by name, ties by id, the same across a page boundary, whatever `sort` is sent;
- in the window: the three shelves; "See all" writes that kind as the page's `show`; no Category menu and no sort control; a search draws one grid with "Plugin" or "Connector" beside each name, and a shelf's cards carry no kind word;
- a connector's `+` in the grid opens the connector sheet and a plugin's the install sheet; **held open**: one of each is confirmed and both run; each line reads on its own card; the search is cleared and the lines read on the shelves' cards;
- a card that reads "Installed" opens My items with its own kind chosen.

### M5 — The record, the e2e scenes written, the whole checks, the hand-back

**At its end** the e2e scenes that crossed the moved sections find the new head, the new scenes are written and typechecked, the record is in the branch, and the acceptance has been run as far as an executor can run it.

**Touches.** The specs under "The e2e groups"; the documents of "The record"; code comments that describe the retired structure (`destination/`'s headers, `customize/open.ts`, `widgets/PluginsWidget.tsx`'s header); this document.

**Decisions.**
- *The scenes follow the structure and keep what they prove.* A helper that opened a section by its tab and a view by the section's switch opens the view by the head's switch and the kind by Show; the locators that scoped to a tab panel scope to the page's region. No scene is deleted; one is renamed, because its premise was the three rows of controls (`e2e/ux2-shell.spec.ts`, "Chrome: live Customize keeps scopes on its two control rows and loaded feedback on the third": it becomes the head's two rows and the loaded line under them, with the same measures).
- *No spec file is added* (the gate's script tests pin their number and groups); the new scenes are cases of existing files.
- *No time bound is asserted* in a scene but in a form `.github/scripts/gate-plan.test.mjs` lists.

**Proves** by running, on the VM: the whole typecheck, lint, the whole unit suite once, the scan and the script tests (Concrete Steps, 4). What only a Mac shows is Proof P1.

### The e2e groups whose scenes cross the moved sections

By the group's name in `package.json`. "Changes" means the scene's selectors or expectations are edited in M5; "kept" means it is read again and expected to pass unedited.

| group | file | scenes |
|---|---|---|
| `e2e:discover` | `e2e/discover.spec.ts` | Every scene opens Customize through the helpers `openDiscover`, `chooseProject`, `library` and `pane`, which change. "home: Featured, the shelves, All…" (also the icon's mark on Featured); "labels: search over both names…"; "install: + adds the marketplace and installs…" (its step "installed: … My items" reads the switch's state and opens the Skills and Plugins tabs); "projects: installed at project scope in A…"; "offline: without the directory…" (the monogram's mark; the Connectors tab); "agents: a session started after Discover was browsed…". **New case** "all: My items lists the three kinds in one list; Discover's home has a shelf per kind; a search mixes them": after an install and an add in its scratch home, C4's order and kind words, a plugin's menu and a connector's Remove from All, then C8's shelves, "See all", and one search with a plugin and a connector in the grid. |
| `e2e:discover` | `e2e/discover-connectors.spec.ts` | The helpers `panel`, `row` and `openConnectors` change, and with them "add: Linear from Discover…" (its step under "Configured on disk"), "sign-in: S1 then S2…", "dynamic: a plugin's connector and one of MAWS's own list signed in from the Connectors dialog, a second of the list from Customize" (its Customize steps reach My items, Connectors by the head; nothing is added to it here), and U11g's "custom: a local command for all projects and a remote one shared in the project, added from My items through the real CLI; a name taken meanwhile refused on the line", whose action, sheet and `[data-connector-adding]` line are found from the head and the page's region. |
| `e2e:settings` | `e2e/settings.spec.ts` | "Customize and Projects are reachable without a chat, at desktop and narrow widths": its three tab clicks, the tab panel that holds "Inventory coverage", and its screenshots at four widths change; it gains the head at 620 px against C11. `e2e/accounts.spec.ts`, "the ring", opens Customize by the sidebar only: kept. |
| `e2e:layout` | `e2e/ux2-shell.spec.ts` | "Chrome measurements: document, deck and live Customize at both desktop sizes" (it captures the tab list named "Customize sections" and the embedded library's header) and the renamed "Chrome: live Customize…" change. It gains **one step** for C6: with the catalog fixtures named in the launch (`MAWS_CATALOG_FIXTURES`) and the stub CLI's installed list holding the id of a fixture plugin whose record has an icon, that plugin's row in My items draws an image of data and a plugin with no record draws its tile. |
| `e2e:layout` | `e2e/shell.spec.ts` | "a page beside the sidebar", "⌘⇧\ under a page", "the Overview over a page": they read the page's region and the stored `destination` by its kind: kept. |
| `e2e:widgets` | `e2e/widgets.spec.ts` | The button named "Show" in `/plugins` becomes "Filter" ("reads render their fixtures…", "My items on an owner-shaped registry…"); the helpers `customizeLibrary`, `openDiscover` and `toMyItems` change, and with them "install at user scope from a Discover card…", "Stop on a CLI that ignores SIGTERM…", "install at project and at local scope…", "an engine error is the engine's words…", "a plugin that declares a dependency…", "Discover on an owner-shaped registry…"; "lists the engine's plugins and marketplaces; the catalogue is read only once Open Discover shows it" changes through the same helpers and keeps its claim: it is the scene that shows M1's icon read causes no catalog read of the engine. "a New chat lists its folder's connectors, skills and plugins before the first message…": kept. |
| `e2e:library` | `e2e/library.spec.ts` | "a replayed session's transcript keeps its scroll offset across a page and Back": kept. |
| `e2e:cross-build` | `e2e/cross-build.spec.ts` | "(destinations, both ways)" reads the page's kind: kept, not edited. |
| `e2e:discover-live`, `e2e:plugins-live`, `e2e:plugins-library-live` | `e2e/discover-live.spec.ts`, `e2e/plugins-live.spec.ts`, `e2e/plugins-library-live.spec.ts` | The tab, tab panel, "Show" and switch selectors change. They run a real engine or the real network: edited and typechecked here, run at a live sitting. |
| `default` (`e2e`) | | Run because the renderer changed; no scene of it opens Customize's sections. |

### The record (in the same pull request, UC-10)

- **The ruling this landing reverses** (the child's "Rulings reversed", O-14, the structure): one dated line under P4's Decision Log 88 in `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` and one under "Discover, per tab" in `docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md`, each: "2026-11-14, UX wave U11 (O-14), the owner's answer of 2026-11-12: Customize's outer level is My items and Discover; the kind (plugins, skills, connectors) is a filter inside each, with All. (`docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md`)". The reversal about icons is U11d's, with the fetch.
- **U11g's execution document**, under its M2: "2026-11-14, UX wave U11c: the action stands in the page's head while Show is Connectors or All; an add's line is kept for the place and no longer dropped when the project changes; once the add has ended the page's book holds its outcome and name and no longer its request."
- At landing, by the architect: the register's row for O-14. X-184's row and the tracker row of 2026-10-24 are U11h's.

## Concrete Steps

From the worktree of branch `ux-wave/U11c`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11c --`. The VM is shared: read a slow or timed-out check against its load before reading it as a failure.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Master holds U11g since `93905c9ef` (`grep -n "data-connector-add-custom" src/renderer/src/customize/connectors/ConnectorsSection.tsx` prints a line), and this document's statements about it were checked there ("Progress"). Then, for each file this document names that the merge changed (`git diff --name-only c7b62e48b origin/master`), read it again against "What the code says today" before building on it.

2. **Each milestone**, tests first where a test can fail first. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U11c
       vmcheck 'timeout 900 pnpm exec vitest run <the milestone's paths, below>'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'   # main and shared code
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'    # the renderer; tsconfig.e2e.json for e2e/
       vmcheck 'timeout 600 pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11c at <short sha>` and then the command's output; its exit status is the command's (do not pipe it without `set -o pipefail`). At a tests-first commit vitest fails on the new assertions; at the milestone's head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing. The paths:

   | | vitest | typecheck |
   |---|---|---|
   | M1 | `src/renderer/src/customize src/renderer/src/widgets src/main/catalog src/shared/ipc test/support/cross-build-samples.test.ts test/support/tokens-guard.test.ts` | node and web |
   | M2 | `src/renderer/src/customize src/renderer/src/widgets src/renderer/src/destination src/renderer/src/settings-tab/SettingsView.test.tsx src/renderer/src/sidebar src/renderer/src/composer test/support/tokens-guard.test.ts` (`settings-tab`, `sidebar` and `composer` hold the callers of `customize/open.ts`; `sidebar/Sidebar.test.tsx` can fail under the VM's load and pass alone) | web |
   | M3 | `src/renderer/src/customize src/renderer/src/widgets test/support/tokens-guard.test.ts` | web |
   | M4 | `src/main/catalog src/shared/ipc src/renderer/src/customize test/support/tokens-guard.test.ts` | node and web |

   After a merge of master inside a milestone, run that milestone's set again, not the whole suite.

3. **M1, the one new command.** `catalog.pluginIcons` is a command of main: after its schema, name, grade and route rows are written, make the route snapshot again on the VM and bring the result back:

       vmcheck "MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; git diff -- src/shared/ipc/routes.json; git checkout -- src/shared/ipc/routes.json" > /tmp/u11c-routes.patch
       sed -n '/^diff --git/,$p' /tmp/u11c-routes.patch | git apply

   Expect one added name, in `machine-wide` (its input names no path, so it is not one of `routes.ts`'s `PATH_COMMANDS`, which `routes.test.ts` pins to the computed path class; `routes.ts` is not edited). Then `vmcheck 'timeout 900 pnpm exec vitest run src/shared/ipc src/shared/machine'` passes with `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json` and `src/shared/machine/address-paths.json` unchanged (`git status --short` names none of them): a command of main is not on the wire between builds and names no session. A change in any of the four means something an engine host or `mawsd` answers was edited: stop and report (C10).

4. **M5, master again, then the whole checks.**

       git fetch origin master && git merge origin/master

   If the merge changed `routes.json`, keep master's side and run step 3's regeneration again. Then:

       vmcheck 'timeout 900 pnpm typecheck'
       vmcheck 'timeout 900 pnpm exec eslint src/shared/ipc src/main/catalog src/renderer/src/customize src/renderer/src/widgets src/renderer/src/destination e2e'
       vmcheck 'timeout 2400 pnpm test'
       vmcheck 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck 'timeout 600 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       git diff --stat origin/master -- src/shared/ipc/wire.ts src/shared/ipc/wire-manifest.json src/shared/ipc/schema/layout.ts src/shared/settings src/engine-host src/services src/endpoint src/shared/net/egress.ts

   The last command prints nothing (C7's rule, C9, C10). Then the acceptance's own tests, named, so that the hand-back can quote one result for C1 to C12:

       vmcheck 'timeout 1200 pnpm exec vitest run src/main/catalog src/shared/ipc src/renderer/src/customize src/renderer/src/widgets src/renderer/src/destination test/support/tokens-guard.test.ts'

   It prints `Test Files … passed` with no failure. C7 is shown by `src/main/catalog` and the image component's tests; C1 to C6, C8, C9, C11 and C12 by the three renderer folders. `pnpm typecheck` takes about five minutes and prints no error. In `pnpm test` the files the build brief lists as failing on master too are not this landing's; any other failure is. The script tests pass: this landing adds no spec file and no time bound to a scene. Look at a run in the background before its limit has passed twice; a log that has stopped growing beside a process at full CPU is a loop, and a finding.

5. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e, engine or probe. The hand-back says: what exists, with the command and result that showed it; the master the branch stands on; what is not verified (every e2e scene); the decisions made; anything that contradicts this document; the residue. Residue known at authoring, each a row for the debt tracker at landing:
   - an installed plugin from a marketplace that is not a seed shows its tile even where the directory has an icon for it, since the held copy alone cannot tie the two (code, 8); so does one installed from the engine's own directory marketplace, whose routes come only from the engine's listing (M1's discovery);
   - a connector row and its Discover card show one tile only where the configured name is the name the directory's add proposes (§C, the seed);
   - My items can now cause the icon route's requests: a matched connector's icon again by the first draw after its copy is a day old (code, 7);
   - a line of an ended operation stays on its row or at the head of its part for the run of the app, for connectors now as for plugins before, and it keeps the engine's own words (§D);
   - `e2e/discover-live.spec.ts`, `e2e/plugins-live.spec.ts` and `e2e/plugins-library-live.spec.ts` are edited and typechecked and run only at a live sitting.

6. **The architect's, after the hand-back.** Proof P1 to P5.

## Interfaces and Dependencies

The sections keep the letters of this document's first version, which the rulings cite. **§A** (a plugin's connectors in the inventory) and **§B** (the sign-in of a plugin's connector from its row) were X-184's and left with it for U11h.

### §C. The image (M1; consumed by every row and card, by U11d and by U11h)

    // src/renderer/src/customize/image/tile.ts (pure)
    export type ItemKind = 'plugin' | 'skill' | 'connector' | 'mod';
    export function tileOf(kind: ItemKind, seed: string): { letter: string; colour: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 };

    // src/renderer/src/customize/image/ItemImage.tsx
    export function ItemImage(props: { kind: ItemKind; seed: string; iconUrl: string | null; size: 'row' | 'card' | 'head' | 'detail' }): JSX.Element;   // 'head': the plugin's and the skill's detail heads in My items and the session's dialogs (44 px today); 'detail': Discover's detail and Featured (56 px today)

    // src/renderer/src/customize/discover/read.ts
    export function usePluginIcons(ids: readonly string[]): ReadonlyMap<string, string | null>;   // id → the directory's icon URL; one request for the list

    // src/shared/ipc/schema/catalog.ts
    // each row of catalog.postures' `servers` gains
    iconUrl: z.string().max(2048).nullable(),     // the icon of the one directory record the address matches; null for none or several

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
| a connector: a configured row | the server's name |
| a connector: a Discover card or detail | the name its add proposes (the route's `name`) |
| a built-in mod | its registry name |

**What it draws.** A box of fixed size per `size` (each place keeps the box it has today), marked `data-item-image="icon" | "tile"`, `data-item-kind` and, for a tile, `data-tile-colour`; `aria-hidden`. The tile at once; when `iconUrl` is given and `catalog.icon` answers image data (`IMAGE_DATA`'s rule, kept), the image in the same box. U11d's place: one prop, `site`, and one read between the two, marked `data-item-image="site"`; the box and the callers' layout do not change.

**Where the bytes come from, and what can be asked.** Every image's bytes come from main's `catalog.icon`, whose rule is code, 7's and is not edited; the URL is always one a directory record names.

| what is drawn | where its URL comes from | when a request can leave, and how often |
|---|---|---|
| the directory's icon on a Discover card or detail | the catalog item (`iconUrl`) | as today |
| a plugin's directory icon on its row in My items and in the session's `/plugins` (**new askers**) | `catalog.pluginIcons`, which reads the held copy and asks nothing | a plugin icon's URL names its content: asked once, when no copy is kept, and never again once one is (a copy Discover already kept serves these rows too); a failed request is tried again by a draw no sooner than five minutes later |
| a configured connector's directory icon on its row in My items (**new asker**) | `catalog.postures`, which reads the held copy and asks nothing | a server icon: asked when no copy is kept, and again by the first draw after its copy is 24 hours old; while that request fails the old copy is drawn; a failed request is tried again no sooner than five minutes later |
| a skill, a built-in mod, and any item with no record or with an icon off the two routes | nowhere: the tile is computed in the window from the seed | never |
| a site's icon | not in this landing | never |

Four requests run at a time, and rows that ask for one URL together cause one request. The window asks main again for an icon it holds only after a day, and for a miss after five minutes (`useCatalogIcon`), so a list drawn again inside those periods asks main nothing. Under e2e the catalog's sources and icons are fixtures or offline (`src/main/catalog/fetch.ts`), so no scene reaches the network.

### §D. The page (M2)

**Where it is.** The two fields of U7b's `destination`; `openDestination({ kind: 'customize', view, show })` is the one writer. `DestinationPage` passes them to `CustomizeView`:

    // src/renderer/src/customize/CustomizeView.tsx
    export function CustomizeView(props: { view: 'mine' | 'discover'; show: 'all' | 'plugins' | 'skills' | 'connectors' }): JSX.Element;

    // src/renderer/src/customize/open.ts
    export type CustomizeSection = 'plugins' | 'skills' | 'mcp';   // the composer's names, kept
    export function openCustomize(section?: CustomizeSection, projectId?: ProjectId | null): void;   // no section: My items, All
    export function openDiscover(cwd: string | null): void;        // Discover, Plugins, on that folder's page (the session's `/plugins`)
    export function openMine(show: 'plugins' | 'skills' | 'connectors', item?: { pluginId?: string; search?: string }): void;   // on the page's own place: a card that reads "Installed"

    // src/renderer/src/customize/page.ts: held for the run, never stored
    export const useCustomizePage: UseBoundStore<StoreApi<{ search: string }>>;   // My items' one search text

`openMine` with a `pluginId` opens that plugin's detail once the plugin list holds it, and leaves the list where it does not; the request ends when the person opens another row or changes where the page is. With `search` it sets the page's text (a Skills card names its plugin, as today).

**The head**, two rows, in an element that keeps `data-customize-header`:

- *First row:* the view switch (today's `LibrarySwitch`: a radio group named "Library", My items | Discover); at the right "Showing" with the project select, as today; beside it, in My items only (the approved drawing; ruled point 7), "Live session" with its select while a session MAWS runs on this Mac is ready in exactly that folder.
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
- the reads the bodies share: the inventory (one query, as today), the plugin list with its marketplaces and manifests, the attached session's status, the postures;
- the read at a custom sheet's opening, which was the connector section's (G-3): a read of that same inventory begun after the opening, and the sheet's `configured` from it.

A change of project gives a new place: sheets close and details reset, and the book of the place left is found again on return.

**What the book keeps of an ended operation** (the architect's ruling). A kept book lives for the run of the app, and U11g masks only a header's and a variable's value: a URL, a command and its arguments are kept as typed, and a person can put a token in those. So the request is the book's only while the operation runs:

    // src/renderer/src/widgets/plugins/operation.ts
    export interface EndedRequest {
      action: RunnerAction;
      scope: PluginsScope;                                    // `scopeOf(request)`: the reload report's scope word
      target: string;                                         // `targetOf(request)`: a plugin's id, a connector's or a marketplace's name; the name a result with no row is drawn under, a failed add's among them (G-4)
      afterAdd?: { marketplace: string; scope: PluginsScope };   // the marketplace an install added first: its sentence and "Remove marketplace"
      catalogName?: string;                                   // the catalog item's display name, for a result whose card has gone
    }
    // PluginOperationEntry: `request` is the whole request while the state is `working`, and an EndedRequest from the `done` event or a refused send on

That is every field a line or a control on a line reads today (code, 12), and the readers take them from the ended form. The book's rule, for every action and for the session's dialogs' own books too. What stays beside it is the operation's state: the `done` event or the refused send's words, which are what the line draws.

*Where a typed URL, command or argument can still stand after the end:* only in those words. The line of an ended add draws the engine host's `done` event (G-4): on a failure, the CLI's own line where it holds no value slot's content. The URL, the command and the arguments are not value slots in U11g's rule, so a CLI line that quotes one of them is forwarded and drawn, and is held as long as its line. Nothing re-uses them: no control on the line reads them, and a second add is typed again (G-8). This is reported to the architect and not changed here: the words are the engine host's to pass or withhold (U11g's §C), and the book cannot tell a quoted URL from any other word.

**What the session's dialogs keep.** `/plugins`, `/skills` and the Connectors dialog are drawn as today: their own head, their own book (not kept, and under the same rule for an ended operation), the library store's search, Filter and Sort.

### §E. A connector's row, and My items, All (M2, M3)

    // src/renderer/src/customize/connectors/rows.ts
    export type ConnectorRowModel =
      | { kind: 'configured'; key: string; name: string; scope: 'app' | 'user' | 'project' | 'local'; path: string; transport: string };
    export const connectorRowKey: (row: Pick<CustomizationServer, 'name' | 'scope' | 'path'>) => string;   // today's `serverKey`: `connector:<scope>:<name>:<path>`
    export function connectorRows(inventory: Pick<Inventory, 'servers'>): ConnectorRowModel[];   // the configured rows, in the inventory's order

    // src/renderer/src/customize/connectors/ConnectorRow.tsx
    export function ConnectorRow(props: { row: ConnectorRowModel; kindWord?: boolean; … }): JSX.Element;

**The row** is today's `ServerRow`, cut out with its code kept: the image, the configured name, "<scope> scope · <transport>", the state, Cancel, Sign in or its sentence, Remove, the file's path on the second line, the operation's line; `data-connector="<name>"` and `data-connector-scope="<scope>"`. A person sees no difference but the image. Two things are shaped for what comes after:

- *The model is a union with one member.* Everything in the row that depends on what kind of connector it is (what follows the name, the second line, which sign-in it sends, whether it has Remove) is decided on `row.kind`, in one place, so that U11h adds a member and its branch and changes nothing else. `connectorRows` takes the inventory, not a list of servers, for the same reason.
- *The row's parts are named:* the image first, then `data-connector-main` (the name, what follows it, the state), `data-connector-trailing` (Cancel, Sign in or its sentence, Remove), and after it, only under All, the kind word.

**My items, All.** One scrolling list, no heading:

1. *Plugins*: the installed plugins that have an installation here or at user scope (every identity whose `group` is not null), by the name their row shows; the library store's Filter and Sort do not apply. Then MAWS's built-in mods, by name.
2. *Skills*: every skill of the inventory, by the label its row shows, with no group heading.
3. *Connectors*: `connectorRows`, by the name each row shows, ties in the inventory's order.

Each row is its kind's row with the kind word: "Plugin", "Mod", "Skill", "Connector", in one cell of one width (the widest word's), marked `data-kind-word`, before the row's last control (a plugin's menu, the mod's switch) and as the last cell of a skill's and a connector's row, where an empty cell of the last control's width follows so that the words line up. Not drawn under All: the plugins' loaded line and group headings, the skills' groups, the connectors' live list and its sentence, each kind's menus.

*The search* narrows each part by its kind's own rule: a plugin and a mod as My items' search does today, a skill as `skillsView` does, a connector by the name it shows.

*Part states.* A part is drawn when its read has answered. While the plugin list is out its place is empty; when it fails, its place holds today's failure ("Couldn’t load your plugins.", the read's words, Retry) and the built-in mods under it. The skills and the connectors share the inventory: its reading line and its failure with Retry stand once, where the skills would be, and its folded notes (today's, the coverage note among them) stand under the list. *Empty*: when every read has answered and there is no plugin with an installation here, no skill and no connector, and the search is empty, the list is "Nothing here yet." with "Find plugins, skills and connectors in Discover." under it and the button "Open Discover", which opens Discover with All kept; the built-in mods are then not drawn here (ruled point 7). With a search that matches nothing: "Nothing matches these filters." and Reset, today's words.

*Results with no row* (a removal's, an uninstall's, U11g's add while it works or has failed) stand at the head of their kind's part under All, and where they stand today under the kind's own Show value.

### §F. Discover, All (M4)

    // src/shared/ipc/schema/catalog.ts
    export const CatalogTabSchema = z.enum(['plugins', 'skills', 'connectors', 'all']);
    // CatalogShelfSchema.kind gains 'kind'; its key is `kind:plugins`, `kind:skills` or `kind:connectors`

- *The home for `all`* (`homeOf`): `featured` is the Plugins home's; `shelves` are three, in that order, titled "Plugins", "Skills", "Connectors"; each holds that kind's items that are not community items (the earlier ruling carried forward; ruled point 7), in that kind's own shelf order, its first twelve (`SHELF_ITEMS`), and the Skills shelf leaves out every item among the Plugins shelf's twelve; each `total` is the kind's whole count, community items included, which is what "See all" leads to; `categories` is empty. No All grid stands under the shelves.
- *The query for `all`* (`queryOf`): every item; the chips, Not installed and the text as today; `category` ignored; one order whatever `sort` is sent: a match on a name before a match on the description only, then by name, ties by id; `reverse` and the cursor as today.
- *The window:* the filter row without the Category menu; a shelf's "See all" is `openDestination({ kind: 'customize', view: 'discover', show: <that kind> })`; a search, a chip or Not installed turns the page into one grid headed by the count, with no sort control; a card in that grid carries "Plugin" or "Connector", muted, beside its name, and a shelf's card none; the Skills note is not drawn. `+` asks the page's one `ask`; a card on the Skills shelf asks as a Skills card does today (its sheet names the skills), every other card as its own kind's. A card that reads "Installed" calls `openMine` with the item's own kind. Discover's choices for All are a fourth entry of `useDiscoverStore`.
- *A kind's own Discover* is unchanged, community items and Category included.

### §G. Words

New or changed strings; every other string is today's, the coverage note and the lines before a chat starts among them.

| where | words |
|---|---|
| `LIBRARY.show` (`widgets/copy.ts`) | "Filter" |
| the Show row | "Show:"; "All", "Plugins", "Skills", "Connectors" |
| the kind word | "Plugin", "Mod", "Skill", "Connector" |
| the search field | "Search my items" (All); "Search connectors"; "Search plugins" and "Search skills" as today |
| All, empty | "Nothing here yet." / "Find plugins, skills and connectors in Discover." / "Open Discover" (`DISCOVER.openDiscover`) |
| the shelves of Discover › All | "Plugins", "Skills", "Connectors" |

### §H. What is stored or sent, and what build F does with it

**Stored: nothing new.** Per value:

| value | where | build F; this build after F; this build, then F, then this build |
|---|---|---|
| the view and Show | U7b's layout key `destination`, written by `openDestination` | The key, its version and its schema are U7b's and unchanged; this landing only writes values the schema already admits (`show: 'all'`; `view: 'discover'` with any Show). F never asks for the key and keeps it through its writes. After a stay on F, U7b's rules decide the page at the start (a Customize tab F left in front opens My items at that tab's kind; otherwise the stored page while the tabs have this build's shape). A build of the wave from before this landing reads `all` as Plugins. |
| My items' search text; Discover's choices; an open detail; an open sheet; the book and its lines | memory, for the run | not stored |
| a tile's letter and colour | computed from the seed | not stored |
| a directory icon's copy | `<userData>/catalog/icons/<sha256 of the URL>.json`, written by `CatalogIcons` as today | The same file, form and writer as F's; more URLs may be kept, each one a URL F would keep the same way. |

No layout key, no settings key, no file of a new kind, no field on a stored tab: the cross-build coverage table (U13a's M5) gains no row, and the scene "(destinations, both ways)" of `e2e/cross-build.spec.ts` stays the proof of the key. Shown by: `LayoutKeySchema` and both settings schemas are not in the diff (Concrete Steps, 4).

**Sent between builds: nothing, and no minor.** `catalog.pluginIcons`, the postures' `iconUrl` and the catalog's tab `all` are between this window and this main, which are always one build; `WIRE_MINOR`, the wire's manifest and its fingerprint are not in the diff (Concrete Steps, 3 and 4). So at its chain merge this landing's minor is master's own (47 with U11g at this writing): it and the master it lands on speak one wire. Build F's engine host and `mawsd` are asked nothing they are not asked today.

**The two-build proof under an equal wire.** A landing that stores a form and takes no minor has no peer a minor apart for the gate to pick, and its two-build scene must run, not skip, when both builds speak one wire (the gate's `--peer-exact` for the build the machines run; `e2e/cross-build.spec.ts`, "An equal wire"). This landing stores no new form: the one stored value it writes is U7b's `destination`, in U7b's schema. Its proof is U7b's scene "(destinations, both ways)", which this landing does not edit; that scene's own skips are on what the peer's layout schema names (a peer that already knows `destination`, or that keeps no tab sets), not on the wire, so with build F named by `--peer-exact f1852de3a` it runs. This landing adds no two-build scene of its own, so it adds none that could skip. If a milestone finds it must store a form after all, it stops and reports (Constraints), and the scene it would add is written to that rule.

### §I. Routes (law 5), and other machines

Customize is not a session surface, and it is this Mac's (bindings 9 and 14). What the page shows for another machine: nothing. Its project list is this machine's; a project of another machine in front makes the page the user configuration's (today's rule, pinned by `customize-machine.test.tsx`); every read and operation is sent with `{ machine: ipc.localMachine }`.

What this landing sends, and to whom:

| command | new or changed | where it goes | holds |
|---|---|---|---|
| `catalog.pluginIcons` | new | this Mac's main | the ids of plugins installed here; answered from the held copy; nothing leaves the Mac |
| `catalog.postures` | one more field per row | this Mac's main | as today |
| `catalog.home`, `catalog.query` | one more value of `tab` | this Mac's main | as today |
| `catalog.icon` | unchanged; asked from more rows | this Mac's main, and from there one of the two icon routes by code, 7's rule | a URL a directory record names; nothing of the person's configuration |

Each is a command of main, which no other machine can be sent and none can send here: no offer row, capability or `remote-unavailable` entry is added or changed, and `src/endpoint/`, `src/engine-host/` and `src/services/` are not in the diff. M2's walk (`customize-machine.test.tsx`) shows that no command the page sends names another machine.

The session surfaces this landing touches are the images in two dialogs:

| route | `/plugins` and `/skills` |
|---|---|
| a session MAWS runs on this Mac | the rows gain their image; a plugin's directory icon by `catalog.pluginIcons` for this Mac's plugin ids |
| a terminal session on this Mac | the same rows and images |
| a session on another machine | `/plugins` keeps its one sentence and draws no row; `/skills` draws that machine's skills with tiles, which are computed from each row's own name and read nothing, so nothing of this Mac is shown as that machine's |

The lists before a chat starts are not touched on any route.

### §J. What U11h adds, and what the connector-switch landing reads from each

Named so that both build on this page and neither rebuilds it. Nothing here is a plugin's row, a switch, a column or a record.

**What U11h adds to what this landing builds** (its draft is kept outside the repository until its probe has answered):

| this landing builds | U11h adds |
|---|---|
| `ConnectorRowModel`, one member, `kind: 'configured'` | the member `kind: 'plugin'`, with a plugin's connector's three names (the key it is installed by, the manifest's name, the engine's name) |
| `connectorRows(inventory)`, the configured rows | the plugin's rows after them, from the inventory's new list |
| `ConnectorRow`, its branch on `row.kind`, its named parts | the plugin kind's branch: "from <plugin>", no file line, no Remove, its sign-in, its state lines |
| `connectorRowKey` for a configured row | a plugin row's key |
| `ItemImage` and its seeds; the postures' `iconUrl` | the seed of a plugin's connector; `iconUrl` on its posture |
| the connectors' part of My items, All; the one search | its rows in that part, found by their plugin's name too |
| `openMine('plugins', { pluginId })` | "from <plugin>", which calls it |
| nothing: today's coverage note, today's lists before a chat starts, nothing on the wire | the note's new words, a plugin's connectors in those lists, the wire's minor, the engine host's and the services' part |

**What the connector-switch landing (board ticket 476) reads:**

- *From this landing:* the row, `ConnectorRow`, with its named parts (two switch cells go between `data-connector-trailing` and the kind word; the column words go once above the list that `Configured` draws); the list's source, `connectorRows(inventory)` over the page's one `useCustomizationInventory(cwd)` read with `catalog.postures` beside it, which is also where a connector that is off will come from; a configured row's identity, `connectorRowKey(row)`, whose `name` is the name the engine reports; the page's place (`customizePlace`) and its "Showing" select; the head's second row, for a sentence above the list while Show is Connectors; `useManage()`, for an act's line on a row.
- *From U11h:* a plugin's connector's row and its identity. That identity, and which of a plugin's names the engine reports, is U11h's to state once its probe has answered; this landing states nothing about it.

### §K. Dependencies on other landings

Consumed, by the name each is exposed under. **U7b**: `Destination`, `openDestination`, `DestinationPage`'s region and its Esc rule (a field marked `data-escape-clears`), `customizePlace`; its three stand-ins end here. **U11a**: `useCustomizationInventory`, `serverKey`, `signInViewOf`, `signInSessionOf`, `ownSignInSessionOf`, `startSignIn`, `startSignInDynamic`, `useSignIns` and the rest of today's connector row, moved and not changed. **U11g**: `CONNECTORS.addCustom` and the action's mark, `CUSTOM_ADD`, `CustomConnectorSheet`, `ConnectorSheetEnv`, `configuredSinceOpening`, `customAddKey`, `addLineShown`, `Adding`, `shownRequestOf` ("Statements about U11g's code"). **U13a**: `useCurrentRow`, the current project the page is about; the cross-build coverage table, to which no row is added. **U6a, U8a, U3a, U9, U8b**: nothing; no action id or chord, no working-folder selector, no arrival, no act on a session or offer, no card or tab of the side column.

Exposed: `ItemImage`, `tileOf`, `usePluginIcons`, `catalog.pluginIcons`, the postures' `iconUrl` (U11d adds `site` beside it); `CustomizeView`'s two props, `openCustomize`, `openDiscover`, `openMine`, `useCustomizePage`; the page's one `Manage`; `EndedRequest`; `ConnectorRow`, `ConnectorRowModel`, `connectorRows`, `connectorRowKey`; the catalog's tab `all`.

## Proof that an executor does not run

| | what | when | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **The e2e scenes**, on a Mac under the load rule | after M5's hand-back; a milestone's new case alone as soon as it is pushed | the new case of `e2e/discover.spec.ts` and the new step of `e2e/ux2-shell.spec.ts` alone first; then `e2e:discover`, `e2e:settings`, `e2e:layout`, `e2e:widgets`, `e2e:library` and `default`. This landing adds no engine sign-in and no Keychain write to any scene; the scenes of `e2e:discover` that make one are today's and run where they run today. No scene reads a person's configuration: each has its scratch home | verdicts by group, and screenshots of the head at 1512, 900, 620 and 400 px beside the drawn frames. A red scene goes back as a fix |
| P2 | **The branch review** | after M5 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11c` (Decision Log, with its lenses) | a verdict and findings; the fixes are one wave |
| P3 | **Class 1a** | on the head handed back; again on the final head if the review changed the branch | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11c`, in the background | the run's id, which the pull request names |
| P4 | **The owner's look at the built page** | at the wave's sitting | the page on the wave's build, with ruled point 7's six differences beside the drawn frames, the kind shelves without community items named among them | each difference kept or changed; a change is a fix in the place the point names |
| P5 | **The live groups** | at a live sitting | `e2e:discover-live`, `e2e:plugins-live`, `e2e:plugins-library-live` | that their edited selectors find the new head |

No cross-build run is needed for this landing's own content: §H stores nothing new and sends nothing between builds. Whether the chain's rule (UC-10, the final Mac runs) asks for the cross-build group on this head is the architect's. No engine probe belongs to this landing; the one the first version named is U11h's gate.

## The owner's look

The owner has seen the page drawn and answered its three choices (the child's "Waiting", 2026-11-13); this document builds to the file. No new drawing is needed before the build: what differs from the drawn frames is the six differences of ruled point 7, each small and each in one named place. They are shown to the owner on the built page (P4).

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, landing U11c" and the parent pin; names its class 1a run, its review verdict and its residue (Concrete Steps 5, with what the milestones add); says what it leaves to U11h, to U11d and to the connector-switch landing; and lists the dated lines it carries ("The record"). It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

- Observation: the directory's icon on an installed item is not free of the network, and the route that hands it out has three periods, not one: a plugin icon is kept for good, a server icon is fetched again after a day, a failure is retried after five minutes.
  Evidence: `CatalogIcons.resolve` in `src/main/catalog/icons.ts` (`CONTENT_ADDRESSED`, `REFRESH_AGE_MS`, `RETRY_MS`); `icons.test.ts`, "refetches a server icon a day old, keeping its copy when that fails; a plugin icon is named by its content and kept". `catalog.postures` and the new `catalog.pluginIcons` read `store.loaded()` and fetch nothing.
- Observation: the three sections' operations do not have one lifetime today: two books are kept by name and the connectors' is not; and a kept book holds each whole request for the run of the app.
  Evidence: `usePluginOperations(base.keep)` in `widgets/plugins/manage.tsx` against `usePluginOperations()` in `customize/connectors/ConnectorsSection.tsx`; `PluginOperationEntry.request` in `widgets/plugins/operation.ts`, read after the end only for the fields of code, 12.
- Observation: the request store this landing retires is read by a test outside Customize.
  Evidence: `src/renderer/src/widgets/before-start.test.tsx`, its import of `useDiscoverRequest` and its case "opens Customize for the user configuration from Open Discover when no folder is chosen".
- Observation: U7b is on master, so the item's "while Customize is still a stored tab" has no build left to describe, and the two fields are already in the stored schema.
  Evidence: `DestinationSchema` in `src/shared/ipc/schema/layout.ts`; `RETIRED_KINDS` holds `customize`.
- Observation: X-184 could not be built as the item words it (a fifth value of the inventory's `scope`, a reworded coverage sentence), and its sign-in rests on an engine fact no fixture holds; the adversarial review also found that a row looked up by the engine's name alone could authenticate another plugin's server.
  Evidence: `src/shared/ipc/wire.ts`'s rule on enum members; `customize/InventoryState.tsx`'s comparison by equality; `cli.pretty.js:474719-474727` and `:477037-477041` (2.1.322), as the architect read them. All of it is U11h's now.

- Observation: U11g put the read at its sheet's opening in the connector section's manage hook, not in the sheet, and its two sheets import each other.
  Evidence: `useConnectorManage` in `customize/connectors/ConnectorsSection.tsx` (`Asking.read`, `configuredSinceOpening`); `ConnectorSheet.tsx` importing `CustomConnectorSheet` and `CustomConnectorSheet.tsx` importing `Configured`, `Problem`, `Unresolved` and `ConnectorSheetEnv` back.
- Observation (M1): the window's ipc client validates every command's answer against its schema, so a scripted `catalog.postures` answer without the new `iconUrl` field fails the read and its rows lose their sign-in states.
  Evidence: every scripted postures answer in `customize/CustomizeView.test.tsx` gained `iconUrl: null` at `1b929e709`; a later test that scripts postures must include the field.
- Observation (M1): `catalog.pluginIcons` has no path in its input, so the route snapshot puts it in `machine-wide`, not beside `catalog.postures` (a path command because its input carries `cwd`); this document's first words had `routes.ts` take it by hand.
  Evidence: `src/shared/ipc/routes.test.ts` pins `PATH_COMMANDS` to the computed path class; `routes.json` at `905e51c7a`.
- Observation (M2): Radix's single ToggleGroup root is drawn as `role="radiogroup"` in this repository's version, so the view switch ("Library") and Show are radio groups with no role added.
  Evidence: `customize/CustomizeHead.tsx` at `346071e46`; the role override first added was removed (`871f68b74`).
- Observation (M2): an outer `act(() => innerAct())` that returns the inner act's thenable leaves React's act scope open for the rest of the file, and every later case renders an empty element. An `act` callback that calls `act` returns nothing.
  Evidence: `customize/CustomizePage.test.tsx` at `871f68b74`.
- Observation (M2): the place's state is held per place, so the setter a sheet opener captured belonged to the place left: after a change of project a new ask was dropped. ESLint's exhaustive-deps warning in `widgets/plugins/manage.tsx` showed it.
  Evidence: the red case "a change of project closes an open sheet and resets an open detail, and a sheet asked for then opens on the new place" (`3d91faa89`), green at `346071e46`.

## Decision Log

- Decision: the verification this landing gets. This document gets an adversarial review before an executor starts; the architect dispatches it, and sends the document back once for the pass over "Statements about U11g's code" when U11g is on master. Each milestone is reviewed at its boundary; M2's before M3 and M4 build on the page. The branch gets `doperpowers:review-code` at the xhigh panel: it is of panel size twice over, by its lines (about 4,450 against the wave's two thousand) and by its files (about 63 against twenty), and the child's table already gave it the panel "by size (it moves three sections and their state)". The panel's lenses: (1) nothing lost in the move: every act of a kind's list from its own Show value and from All; an operation, a sheet and a sign-in across a change of view, of Show and of project; the session's three dialogs unchanged but for the images and one word; the connector list and its note as today; (2) what is held and what is sent: an ended operation's entry holds no request; no command to another machine; `CATALOG_EGRESS` untouched, and the icon requests the new askers cause are code, 7's and no others; (3) nothing stored and nothing on the wire: the diff's absent files; (4) the head by keyboard and by assistive technology, and narrow: two radio groups, the search field's Esc before the page's, the keyboard back on the row a detail was opened from, the four widths; (5) the tests: each "held open" case holds its sequence open and would fail on the final state alone. Class 1a on GitHub Actions is the gate of record.
  Rationale: the root gives the panel to a branch of panel size (UC-10); the lenses follow where a move of this size goes wrong unseen.
  Date/Author: 2026-11-14, the author of this document; the sizes and the second and third lenses restated at the revision below.
- Decision (the architect's, 2026-11-14 UTC): **the cut. X-184 leaves this landing** and becomes its own, U11h, built after U11c and after an engine probe. U11c keeps the images, the page and both All views. What moved out: the inventory's plugin connectors, the row's sign-in, the lists before a chat starts, the coverage note's words, the wire's minor, the engine host's and the services' part (the first version's M1 and M4, §A, §B, the plugin part of §E, part of §G and §H, its reported points 1 to 4 and 6, its probe). Here the connector list draws configured rows under today's note; `ConnectorRow`, `ConnectorRowModel`, `connectorRows` and `connectorRowKey` are built for the configured kind, shaped for U11h's second kind (§E, §J).
  Rationale: the row's sign-in rests on an engine fact no fixture holds (law 6), and the review found a way a row could authenticate another plugin's server; a protocol-and-authentication proof should not ride in a renderer move of this size.
  Alternative rejected: the cut this document first offered, X-184 as a second pull request after the page's move with the document otherwise as it stood; it is not a cut after a milestone, since the images and All leaned on X-184's rows.
  Date/Author: 2026-11-14 (UTC), the architect; revised by the author of this document.
- Decision (the architect's rulings on the adversarial review, 2026-11-14 UTC; five findings, each checked by the architect in the code and accepted). What stays in this landing:
  - *The icon disclosure (finding 4).* The first version said a kept copy "else the URL". The route does more, and code, 7, §C and C7 now say it as it is: a plugin icon is kept for good, a server icon is fetched again after 24 hours, a failure is retried after five minutes. M1's tests gain the old-but-present copy. C7 is worded as the image requests this landing adds on My items and the session's `/plugins` rows, not as all of the page's traffic. Reported point 5 stands on that statement: the existing route, no new host, no new route.
  - *The request store's other reader (finding 5).* `widgets/before-start.test.tsx` imports `useDiscoverRequest`. Its opener case migrates in M2 to the new destination and the explicit user-configuration place, keeping its assertion that the session's dialog closes. No compatibility export.
  - *What is held longer (the reviewer's note).* The kept book makes a line live for the run of the app, and U11g masks only header and variable values. The book keeps, for an ended operation, only what its line draws and what a control on that line reads; the request is dropped at the end (§D, C12, M2's test). Where a typed URL, command or argument can still stand, the engine's own words on a failed add's line, is said in §D and reported.
  - Findings 1, 2 and 3 (the lookup by engine name, the probe as a gate, "Not in the attached session" as information) are about X-184 and are written into U11h's draft as its open list.
  Date/Author: 2026-11-14 (UTC), the architect; revised by the author of this document.
- Decision (the architect's rulings on the points this document reported, 2026-11-14 UTC). Points 1, 2, 3, 4 and 6 stand with conditions and go with U11h. Point 5 stands as above. **Point 7: all six stand**, two recorded more exactly: the "Live session" picker in My items only follows the approved drawing where the child's head names no view, and is not the child's own reading; no community items on All's kind shelves is the earlier ruling carried forward, and is listed among what the owner sees at the look of the built page (P4). Point 8 is the cut.
  Date/Author: 2026-11-14 (UTC), the architect; recorded by the author of this document.
- 2026-11-14 (UTC): this document revised once to the three entries above. Milestones renumbered (five: the images, the page, My items All, Discover All, the record), acceptance renumbered (C1 to C12), sizes recounted; the interface sections keep their letters.

- 2026-11-15 (UTC): the one pass over "Statements about U11g's code", on master `93905c9ef` merged into this branch. G-1 and G-4 to G-10 hold, G-4 and G-9 with the code's names added; G-2, G-3 and G-11 are restated. Corrected to them: M1's touched files (no test's list of commands); M2 (the opening's read moves whole; the two sheets' import cycle ends through `sheet-parts.tsx`, closing the tracker row U11g left; one more reader of an ended entry's request); §D; §H (no minor at the chain merge; the two-build proof under an equal wire); the e2e table (U11g's scene by name); sizes (M2 about 2,150 lines, the landing about 4,450). No decision changed.

- 2026-11-15 (UTC), the architect's rulings after the document's last pass, recorded by the executor before M1 is dispatched; each names the milestone that builds it.
  - *Ruling 1 (M1, M2).* The author's three restatements stand as written: the action opens through `askIn` (G-2); the opening's read is `useConnectorManage`'s and moves whole to the page's one place, with its held-open cases kept (G-3, M2); main's new command joins neither command-list test (G-11, M1).
  - *Ruling 2 (M2, closed in M5's record).* The two connector sheets import each other today. M2 ends it as written: `Configured`, `Problem`, `Unresolved` and `ConnectorSheetEnv` move to `customize/connectors/sheet-parts.tsx`, which both sheets import and which imports neither; no re-export is left; M2's test over the folder's relative imports stays. The tracker row U11g left for this closes in M5's record.
  - *Ruling 3 (every milestone; M1 first, where the one new command is written).* No wire minor and no new stored form: `WIRE_MINOR` and the wire's manifest are not in the diff. A milestone that finds it must store or send something stops and reports; nobody takes a minor to get past a check.
  - *Ruling 4 (M2).* If M2's builder finds it is two reviewable pieces (the move of the bodies; the one place that holds what a person started), it may build and commit them in that order as two steps of one milestone. It does not change what M2 proves, and M2 is reviewed whole before M3 and M4 start.
  - *Red before green (C2 in M2, C12 in M2, C7 in M1).* Where today's code lacks the behaviour and a test can show it failing first, the test is committed and run red on the VM before the code; the failing case names are quoted in the milestone's report.
- 2026-11-15 (UTC), M1, the executor's decisions as folded by the controller. `catalog.pluginIcons` is a `machine-wide` command of main, taken by `routes.json`; `routes.ts` is not edited and no grade row is added (the catalog's grade covers its namespace); the window still sends it with `{ machine: ipc.localMachine }`. Main hands the new askers (`catalog.pluginIcons`, the postures' `iconUrl`) only URLs `isIconUrl` admits, so an icon off the two routes draws the tile and the window asks nothing. One `catalog.pluginIcons` read per list, over every identity it holds (sorted, deduped, capped at 512), so a search or a filter does not change its key; `PluginDetail` reads its own one id until M2's one place can hand it the list's answer. Loaded-only rows and built-in mods draw tiles only. A skill's seed is its row's label; a mod's is its registry name. The tile's strength is 15. `ItemImage` mounts no query for an item with no URL (a row's box is a new node when its URL arrives, at the same place and size). `CatalogDeps.now?` is the icons' test clock. The aggregator spec's Decision Log 7(b) header moved from `CatalogIcon.tsx` to `ItemImage.tsx`, one of the four U11d rewords.
- 2026-11-15 (UTC), M1, the controller: **the image has four boxes, not three.** §C's "each place keeps the box it has today" binds, and today there are two detail boxes: 44 px on the plugin's and the skill's detail heads (My items and the session's dialogs) and 56 px on Discover's detail and Featured. The executor drew both at 56 px, a size change a person sees that the document does not name; §C's union gains `'head'` (44 px) for the first, and `'detail'` stays Discover's. Lost: one size for a plugin's icon in its two details, which the document never asked for.
- 2026-11-15 (UTC), M2, the executor's decisions as folded by the controller. The page is not remounted on a change of project (the Project select keeps focus); what is asked (a sheet, a marketplace dialog) is held per place (`usePlaceHeld`), closed by the change and not drawn again on return, and the bodies are keyed by the place, so details reset. The place is `customize/place.tsx` (`CustomizePlace`, `usePlace()`), the bodies `customize/bodies.tsx` (`CustomizeBody`), the head `customize/CustomizeHead.tsx`, the page's words `customize/copy.ts` (`PAGE`), the connector manage hook `customize/connectors/manage.tsx`. Bodies are not kept mounted across Show values: what must outlive them is the place's and the kept book's. The connector search narrows the configured rows by name, case-insensitively, and with nothing matching shows `LIBRARY.noMatch` with Reset filters, the plugins' and skills' words. A plugin row with no line of its own shows the line of a Discover install whose target is its id (C2's "once installed, on its row"). `/` focuses the head's search only from inside the page, never from a sheet over it. The `openMine` request is dropped by `CustomizeView` when the view, Show or place differs, and by a row opened first. `PluginDetail` keeps its own one-id icon read (a move, not a rewrite). Ruling 4's two steps were not used: the move and the one place landed together (`360623516`). The page test changes the place under an open sheet through `useCustomizeProject`, as an opener's write does, since the sheet is modal.
- 2026-11-15 (UTC), M2, the controller on the task review's findings. (1) §D's "no tools while a detail is open" and "a press of the view shown or a Show value returns to the list" hold for a Discover card's detail too, with its scroll and focus back on the card kept. (2) Under the `customize` container's 24rem a plugin row's version and date are hidden by a container-scoped utility; the session's `/plugins` is unchanged. (3) What the place holds (a sheet, a dialog) belongs to one visit of a place, not to its folder, so a continuation begun on an earlier visit to the same folder opens nothing on a later one (A → B → A). (4) **Reversed: M2's decision 6.** The one `Manage` does not hand every kind the attached session's `reloadMods`: a line keeps the controls its kind's line offered, so "Reload again" stays a plugin's line's, and Skills Discover and the connector bodies get none. One consequence of the one book, by design: a catalog item's operation is one entry, so an install from its Skills card also reads on its Plugins card. (5) §E restated: the image stands first in the row, before `data-connector-main`, which names the name, what follows it and the state; putting the image inside would have needed an absolute box standing in for its column, a layout risk no unit test sees, for a name only.
- 2026-11-15 (UTC), the architect, on M2's four choices a person sees: each accepted. (a) A line keeps its kind's controls: "Reload again" is a plugin line's only. (b) Under the `customize` container's 24rem a plugin row hides its version and date. (c) The connector row's image stands before `data-connector-main`. (d) A catalog item's install reads on both its Skills and its Plugins card: one book, one entry.
- 2026-11-15 (UTC), the architect: **M5's order changes.** When M4 is pushed and reviewed, M5 does the `e2e:discover` part first (the helpers of `e2e/discover.spec.ts` and `e2e/discover-connectors.spec.ts` moved to the head's switch and Show; the new case of `e2e/discover.spec.ts` with screenshots of the head at 1512, 900, 620 and 400 px), typechecks the e2e project, pushes and reports the head, so that the architect runs that group on a Mac while the rest of M5 is built, and a red scene comes back before the review. Also before M5's hand-back: **C2's cases shown red by name**, over a tree where the book's hold is taken out (the smallest revert that makes exactly C2's cases fail), since M2's red run of them was only the page suite failing to import.
- 2026-11-15 (UTC), M3, the executor's decisions as folded by the controller. The list is `customize/MineAll.tsx` (`MineAll`); the kind word is `customize/KindWord.tsx` (`KindWord`, `NoLastControl`), its words in `PAGE`; its one width is the widest word's, from an invisible zero-height "Connector" under it, and a row with no last control ends in an empty cell as wide as the plugin menu and the mod switch. The connector rows' facts are one hook (`useConnectorRowFacts`) shared by the Connectors list and All; the mod row is a component of its own (`BuiltInModRow`), drawn under All by name once the plugin list has answered or failed. A plugin's or a skill's detail opens in the list's place under All and its Back reads "My items" (`SkillDetail` gained `backTo`; under Show: Skills it still reads "Skills"). Lines of results whose row has gone stand above the empty state. For the user configuration before the engine's config home is known, the plugins' place is empty while that read is out, and holds its failure with Retry if it fails. The plugins part keeps My items' two warning lines (a stale list, unread manifests). Skill rows carry `data-skill-key` (the row's unique key), by which Back finds the row it was opened from, in All and in Show: Skills (two skills of one name in two files).
- 2026-11-15 (UTC), M3, the controller on the task review: **the empty state belongs to the place, the words to the search.** "Nothing here yet." stands when every read has answered with nothing, none is in error, and the search is empty; a read in error shows its own part state, a failed refresh after an empty answer included. Whether the place holds anything is decided without the search, so on an empty place no built-in mod is drawn whatever is typed, and a search there reads "Nothing matches these filters." with Reset; on a place that holds an item a search still finds a mod. The mods also stand under the plugins' failure (§E); with only the inventory failing on an empty place none is drawn.
- 2026-11-15 (UTC), M4, the executor's decisions as folded by the controller. The window's tests of All are a file of their own (`customize/discover/DiscoverAll.test.tsx`). A card is always drawn as one kind's (`CatalogKindTab`): Featured and the Plugins shelf as Plugins, the Skills shelf as Skills (its sheet names the skills), the Connectors shelf as Connectors, a grid card as its own kind (`cardTabOf`), a detail as the kind of the card it was opened from. "Reload again" is decided per card under All (`KindLines` in `DiscoverGrid.tsx`, over the place's `WithoutReload`), and a result whose card has gone gets the same rule by its action. "Installed" opens My items on the item's own kind (`item.kind`), a Skills-shelf card's included. All's one order is main's name sort with name matches first, carried by the cursor. The grid card's kind word is a muted span (`data-kind-word`) beside the name, and cards drawn without it keep their markup. Main always answers three shelves.
- 2026-11-15 (UTC), M4, the controller on the task review: **a shelf of Discover › All is drawn while its kind's `total` is above 0**, with its heading and "See all" even where the Plugins shelf took all its preview cards, and is left out only at total 0 (replacing the executor's "no empty shelf").

## Outcomes & Retrospective

Pending — written at finish.
