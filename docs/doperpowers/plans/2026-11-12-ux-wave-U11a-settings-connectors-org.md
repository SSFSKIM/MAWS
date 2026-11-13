# UX wave · U11a · Settings, connectors and the Org pages (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U11**, first landing (**U11a**), parent pin `e0df32e3f` (branch `ux-wave-spec`).
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U11-settings-connectors-org.md`: its ten items that have a design section (l8-settings-01, l8-settings-04, l8-settings-03, l8-settings-06, #540, #523, #505, #456, S-09, S-10), acceptance A1 to A15, "Probes and checks" and "Rulings reversed". In the root: Purpose, the wave's laws, UC-1, UC-6, UC-7, UC-8, UC-10, UC-11, UC-12, UC-14 and "Ordering and dependency map". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code says today, the decisions the section left open, and the execution. Twelve points where the code contradicts the section, or where a decision would change what the owner sees beyond the section's words, are reported to the wave's architect ("Reported to the architect"); each has a default this document builds, written so that a ruling changes one named place. **Branch:** `ux-wave/U11a`, from master `48619c824`; master is merged in before anything is built (Concrete Steps, 1). **Board:** #583 (the wave's epic is #573).

## Purpose

After this landing four smaller surfaces stop getting in the way.

A connector that says "Sign in needed" can be signed in from the chat that uses it, whichever kind it is: one a configuration file names (as today), one a plugin brings, or one added under Settings › Sessions › MCP servers. The dialog that lists a chat's connectors is called Connectors, shows one line per connector, and says once what its switch reaches. A new chat shows its plugins, connectors and skills before the first message.

Settings opens on everyday preferences; its Engine section is split into Sessions, Engine and Background; every row reads in one line with the rest behind "More"; and "Search settings" finds a row by its words.

On the Org pages every refusal says what to do next or who can act, every sheet dims the window by the same amount, and the project Channel says "Offline · retrying" when it is, lines up under classic scrollbars, cuts names in one order, and opens from the command palette and the View menu.

How to see it working: the unit tests named under each milestone fail before its change and pass after; the e2e scenes each milestone writes are run by the architect on a Mac ("Proof that an executor does not run"); and in a running build the scenes of Acceptance read as written there.

## Progress

- [x] (2026-11-12) Execution document written; the ten sections checked against the code at `48619c824` and against build F (`f1852de3a`); twelve points reported to the wave's architect.
- [ ] The architect's rulings on the twelve points folded in (Decision Log).
- [ ] Adversarial review of this document; its findings folded in.
- [ ] Master merged into the branch; U6a on master confirmed (Concrete Steps, 1).
- [ ] M1 — the sign-in probe's two questions written; handed to the architect for the gate job on the mini.
- [ ] M2 — Org sheets: refusals that name a next step; the grant sheet's read; the paused live query.
- [ ] M3 — one scrim; the Channel's gutter and names.
- [ ] M4 — the Channel says it is offline.
- [ ] M5 — the Channel from the palette and the View menu.
- [ ] M6 — the Connectors dialog.
- [ ] M7 — Plugins, Connectors and Skills before the first message.
- [ ] M8 — Sign in for a dynamic connector (starts after M1's verdict).
- [ ] M9 — Settings regrouped, its notes on one line (starts after the owner's look).
- [ ] M10 — Search settings.
- [ ] M11 — the record, the whole checks, the hand-back.
- [ ] The architect's: the e2e runs, class 1a, the xhigh panel, the pull request.

## The landing's edge

One pull request holds the ten items. They are independent of each other, each is small, and together they are about 105 files and 6,400 changed lines, inside what the wave's panels already hold (U8b: 115 files, 9,000 lines). Splitting by surface was weighed and lost. Only two things can hold part of the landing back, the owner's look (M9, M10) and the mini's probe (M8), and the order of the milestones answers both: what waits on nobody is built first, and the cut below is there if a wait is long. A second pull request would cost its own gate, panel and board ticket for nothing else.

| part of U11 | in this landing | left, and to what |
|---|---|---|
| l8-settings-01, a session MAWS runs on this Mac; Customize's row for MAWS's own list | in full (A1 for this Mac, A2) | — |
| l8-settings-01, a session MAWS runs on another machine | Sign in on a dynamic connector is drawn disabled with one sentence (Interfaces §A, "The route to another machine") | **U11b**, after U9 has landed: the offer row, the name in the adapter's machine acts and consent commands, the capability with its `REMOTE_NEEDS` entry and RL2 minor, the act's words, the entry removed from `REMOTE_UNAVAILABLE`, and the tests U9's document lists (its Interfaces 2). U9 reviews it. A1's clause "and for a session MAWS runs on another machine" is proved there. |
| l8-settings-04, "After, now" | in full (A3) | "After, once the #476 probe has answered": its own design |
| l8-settings-03, "After, now" | in full (A4) | "After, once #476 is designed" |
| l8-settings-06 | in full (A5, A6, A7), as a tab until U7's dialog lands | U7's Usage section and its dialog |
| #540, #523, #505, #456, S-09, S-10 | in full (A8 to A14) | S-09's fix in main, only if the reproduction shows the open's answer was late (Proof, P4) |
| A15 (keeps) | proved by tests that are not edited where they pin a write (Constraints) | — |
| "Rulings reversed": the five entries | amended in the documents that hold them (M11) | — |
| "Waiting": O-14, X-184, l8-settings-05, l8-settings-07, l8-settings-11, #455, #476, l8-settings-12, #342 | nothing | later landings of U11, the visual renewal |

**A cut the architect may take.** The milestones that wait on nobody come first, and each leaves the tree green. If the mini's probe (P1) or the owner's look (P5) is late, M2 to M7 with the amendments of #505, S-09 and l8-settings-04 are a pull request by themselves, and M8 to M10 follow as a second from the same branch. Nothing in this document changes for that but M11's list.

**Where the owner's four answers of 2026-11-12 find their place.** They are built by a later landing; this landing leaves the place.

- *Customize's outer level becomes My items / Discover.* Settings names no kind of Customize item: its index ends in one link, "Customize ›", and the search has one result for it with the kinds as other words. The link opens Customize where Customize opens by default, so the later landing changes no word in Settings.
- *A switch for fetching connector icons, starting on.* It is an App preference about how items are drawn: a row "Connector icons" at the end of **Appearance**, with what the fetch tells Google behind its More. The row table (Interfaces §G) takes a row whose value is not in a settings file, which this one needs: by UC-14 it is stored under a layout key of its own.
- *"Make this the default" writes the Claude Code user settings.* If that landing adds rows for the default model and mode, their place is **Engine**, after Config home, not Sessions: the line under Sessions' heading says "your Claude Code settings files are not changed", and it stays true only if those rows sit elsewhere. The child's file says a waiting item's rows "join Sessions"; that sentence is the later design's to settle (reported, point 12). The index's footer stays as it is here.
- *An administrator reads another machine's connector list without Touch ID.* No row of Settings is involved. The `machine-admin` line this landing writes (#540) names no Touch ID and stays true.

## Words used here

- **Dynamic connector:** an MCP server the engine reports with scope `dynamic`: one a plugin brings (the engine names it `plugin:<plugin>:<server>`) or one of **MAWS's own list** (the HTTP servers under Settings › MCP servers, passed to every session MAWS runs at launch). A **file-scope** connector is one a configuration file names (scope `user`, `project` or `local`).
- **The inventory:** what is configured on disk for a folder, read with no session running (`customization.inventory`, answered by the engine host; this Mac only).
- **An unstarted tab:** a New chat with nothing sent. It has a setup intent (`useSetupIntent(id)` is non-null exactly then) and no session record or engine.
- **The services:** `src/services/`, the part of the machine's daemon (`mawsd`) that runs a sign-in. **The endpoint** (`src/endpoint/`) is the door of that daemon to other machines; its **offer table** (`OFFERS` in `src/endpoint/offers.ts`) lists the acts it accepts over the machine link.
- **The wire:** the commands and events between the app and the machine's daemon and engine host. `src/shared/ipc/wire-manifest.json` records it; a change within a major must be additive and moves `WIRE_MINOR` (`src/shared/ipc/wire.ts`).
- **A note** is the muted sentence under a Settings row's control. **A state line** is a line that reports a condition the person must act on (a supervisor waiting on an older version, a helper not found, a permission off); it is not a note and is never cut.
- **Reach** (S-09): whether the channel's own connection to the hub is being tried or has failed, said while the channel is not live.

## What the code says today, beyond the section

Checked at `48619c824`; build F is an ancestor and none of the files named here differs from F in a line that matters, except where said. Only what the section does not say, or says wrongly, is listed; the rest of each "Today" paragraph was read against the code and holds.

**l8-settings-01.**
- A new machine command enters six tables besides its handler: `src/shared/ipc/names/connectors.ts`, `schema/connectors.ts`, `grades/connectors.ts`, the generated `src/shared/ipc/routes.json` and `src/shared/machine/address-paths.json`, and the wire (`WIRE_MINOR` and the two generated wire files). `test/lane-b/offer-coverage.test.ts` fails unless a command addressed by a session is offered, answered by main, or declared in `REMOTE_UNAVAILABLE` (`src/shared/ipc/remote-unavailable.ts`, U9's file).
- A sign-in's progress is the event `connectors.signInChanged`, sent to every client of the machine and, over the machine link, to a member holding `machine-admin` there. Its `name` is `McpServerNameSchema`: at most 128 characters and the engine's rule for a configured name, which a plugin server's colons fail. The manifest shows that field as `{type: string, maxLength: 128}`: the rule is a refinement the manifest cannot render, and the wire's rule makes a changed length bound a major (`classifyWireChange` in `wire.ts`).
- Every reader of an event drops one that does not validate and logs a line, at head and at F alike: `src/shared/host/host-supervisor.ts` ("dropped … invalid"), `src/main/machines/socket-link.ts`, `src/main/lane-b/remote-artifact-feed.ts` ("doesn't read; left out").
- The renderer never holds a configured server's address: `CustomizationServerSchema` carries name, scope, path and transport, and the address stays in main and the engine host because it may carry a token (`src/shared/ipc/schema/customization.ts`). The renderer binds a sign-in's events by the operation id of its receipt, never by name (`customize/connectors/sign-in.ts`).
- `signInSessionOf` (`customize/connectors/present.ts`) answers null for scope `app`, and a ready session's status in the sessions store lists its servers by name and status only.
- The spike that proved the engine's sign-in (`spikes/p4-aggregator/m4-signin-spike.mjs`, run from `e2e/discover-connectors.spec.ts` under `MAWS_SIGNIN_SPIKE=1`) asked its questions of servers added with `claude mcp add --scope user`; none completed a return for a `--mcp-config` server or a plugin's.

**l8-settings-04.**
- The palette's description of `/mcp` is in `composer/mentions/widgets.ts`, but `slashItems` (`composer/mentions/items.ts`) shows the engine's own description for every name the engine's catalogue lists, and it lists `mcp` ("Manage MCP servers", `spikes/protocol-probe/fixtures/reads.jsonl`). Both files are U4's.
- `present` and `McpServerView` (`widgets/McpWidget.tsx`) are also read by Session info (`tools/session-info/model.ts`).
- A `failed` row today shows "On · not connected · <error>" under it with no act taken, and the error again in its detail.
- The engine records the switch under its own `projects` key: the nearest ancestor folder holding a `.git` directory, else the session's folder (seen on the wire for a repository root, a child folder and a folder outside any repository; `src/engine-host/connectors/local-key.ts`). For a linked worktree (a `.git` file) the key was read in the engine's source and never seen.
- The Connectors card of the card column (`panel/summary/Connectors.tsx`, U8's) shows the engine's raw status and is titled "Manage this session's MCP servers".

**l8-settings-03.**
- The sentence "Available once the session starts" is `NOT_YET` in `composer/submit/submit-state.ts` (U4's), read in about ten other places through `availabilityRefusal`; `e2e/composer.spec.ts` pins it on the submit control. It is not changed.
- The Plugins dialog's loaded line also draws it for an unstarted tab, beside "Not observed yet" (`widgets/plugins/LoadedLine.tsx` through `DormantGesture`).
- A new chat set to another machine is not in the setup intent, which holds no machine. It is `useSpawnTarget(appSessionId, projectKey)` in `sessions/remote-spawn.ts`, as `composer/Composer.tsx` computes it; the tab's own id stays this Mac's.
- `locationPath` answers a folder that does not exist yet for a worktree not yet made; `settingsDirectoryOf(location)` (`sessions/useSetupIntent.ts`) answers the repository's root there and is what `engine.models` already reads.
- The plugin reads need a folder: with none chosen Customize passes the engine's config home (`plugins.env`'s `configHome`).
- Customize's skill rows are built with no invocation on purpose ("only a verified invocation earns the slash", `widgets/skills/SkillsLibrary.tsx`): no fixture shows that a skill's name on disk is the name the engine lists. The fixtures do show the form `<plugin>:<skill>` for a plugin's skill.
- The inventory lists a name once per scope that configures it, and does not list a plugin's connectors. Its query has no stale time and Customize holds it inline (`customize/CustomizeView.tsx`).

**l8-settings-06.**
- The stored tab's `section` is a closed list of ten names in `src/shared/ipc/schema/layout.ts`, the same at F. `SettingsSection` is derived from it today.
- Nothing opens Settings at the supervisor's rows. The callers that name a section are `settings.open` with a number (`SETTINGS_SECTIONS` in `gateway/actions.ts`: engine, gateway, keyboard, appearance, notifications; one caller, the engine notice, asks for engine) and two callers in the browser's chrome that ask for `browser`.
- The supervisor's rows are a `role="group"` named by an `h4`, "Background supervisor", which also takes the keyboard when a pressed control leaves (`SupervisorSettings.tsx`); `e2e/supervisor.spec.ts` finds the rows by that group's name.
- The body is at most 760 px wide and a row's note sits in its second column, 580 px wide at that width, in 12 px type: about 90 characters with a More button at its end. The default window (1280 px, sidebar 240 px, no side surface) and U7's dialog (960 px) both give the body its 760 px.
- The Voice shortcut is unbound by default, and a test pins that the row then points at the microphone.
- `delivery/copy.ts` (U12's) is the one piece of copy outside Settings that names a moved row.
- The cross-build scene of both settings files (U13a's M5) changes the theme and the supervisor's idle time through this build's Settings.

**#540.**
- The table has fifteen keys, `grantsDamaged` among them; all exist and are plain strings.
- Main's details repeat the sheet's line for more reasons than the four the item names: in the grant sheet `busy`, `invalid` and `no-change` whole, and `refused`, `stale` and `storage` in their last clause; in the enroll sheet `machine-name-taken` and `certified-machine` whole, and `hub`, `cancelled` and `no-machine` in part.
- `storage` is refused on two paths: before anything is sent ("…: nothing was sent"), and after the machine answered when the outcome could not be recorded (`unrecorded` in `src/main/org/grants.ts`).
- Two of `ledger-unread`'s three details name the machine by its ref, not its name.
- The offer table gives a member holding `machine-admin` nine acts: the machine's connectors (list, connect, reconnect, disconnect, the two sign-ins and cancel) and the connector tools a dashboard may use. Settings, plugins, marketplaces and restarts are graded `machine-admin` (`src/shared/ipc/grades/`) and are not offered.
- `enrollProblems` lines are also drawn on the machine rows (`MachineRow.tsx`, `MachinesGroup.tsx`), which offer Show…, not Start over.
- The grant sheet's read: `reload()` keeps the held view, so during a retry the earlier line and Retry stay; only the last read's answer lands.

**#523.**
- Ten overlays dim a window today. The item's seven: `Sheet`, `sidebar/AddProject.tsx` (already `bg-bg-active`), and the five. Three of the five (`WidgetDialog.tsx`, `InlineEdit.tsx`, `resume/host.tsx`) put `opacity-60` on the element, so the class cannot be swapped alone. Not named: the document editor's delete-tab confirm (`.doc-confirm-overlay` in `src/artifacts/document/editor/chrome.css`, U10's, plain CSS), and two dismiss backdrops that are not dialogs (`app/Shell.tsx`, `panel/PanelRegion.tsx`). The command palette is a modal with no overlay.
- `keymap/KeyboardShortcuts.tsx` is U6's by UC-8 and the child's list of insertions does not name it.
- `REFUSALS['not-supported']` is also the words of main's refusal of a save, so the new sentence shows there too.

**#456.** `LiveQuery.tsx` and `live.ts` are under `src/artifacts/`, which the root's UC-8 gives to U10 (the child's file says no child owns the folder). Hiding Allow needs to tell the not-offered pause from `failed` and `watchLimit`, where Allow stays, so `live.ts` exports two names, not one.

**#505.**
- `scrollbar-gutter` acts only on a scroll container, and neither footer is one.
- The transcript's scroller is one component for every transcript (a session's, an agent's, a drill-in), most with no composer under them. It is a query container, so a reserved gutter narrows its wide blocks by a scrollbar's width under classic scrollbars.
- The to-human header does not use `Party` and keeps its chip from shrinking.
- `e2e/channel.spec.ts` launches with classic scrollbars and has one test, with no comparison of edges and no narrow column.

**S-09.**
- The channel's answer and its change event go from main to this app's own windows and nowhere else (`org.*` is graded `client`); both ends are one build, and neither is in the wire manifest.
- The open awaits the cache and nothing of the hub; the unit case that pins it resolves the attestations at once, so it does not pin an answer while they hang.
- `asOf` is null until the channel first catches up and is kept in the cache: "never read on this Mac" is an open channel with no entries and `asOf` null.
- The retry waits 1, 2, 4, 8, 16 then 30 s (±20 %), the handshake and the attestation read time out at 10 s, and nothing listens for the network's return.
- A close code that ends the channel (4401, 4403, 4404) arrives before the welcome.

**S-10.**
- An action is enabled in the menu and the palette exactly while a handler is registered for it; the menu has no way to say a sentence beside a greyed item, and the palette has one (`UNAVAILABLE` in `palette/CommandPalette.tsx`).
- U6a's guard makes a row build F does not know not rebindable, so "bound to a chord in Settings › Keyboard" waits until F is retired.
- The rule for "has a channel" is written inline twice in `sidebar/menus.tsx`.
- `waitsOnAnswer` exists in `src/shared/attention/kinds.ts` and the Channel's waiting list already reads it, so U1a's change reaches the count with no edit.

## Reported to the architect

Each point is built at its default until ruled; a ruling changes the one place named.

| # | item | the point | the default this document builds | the one place |
|---|---|---|---|---|
| 1 | l8-settings-01 | The section gives the new command's `name` 1 to 256 characters. The event that carries its progress bounds a name at 128, and changing that bound is a major of the wire. | `name` is 1 to 128 characters. The event keeps its bound and loses the configured-name rule, which the manifest does not show; a reader on an older build drops such an event, as it drops any it cannot read. | Interfaces §A, the two schemas |
| 2 | l8-settings-01 | "For a press from a Customize row of MAWS's own list the listed server's address must also be the entry's": the press cannot carry the address (the renderer never holds one) and the command as written cannot tell that press from the dialog's. | One optional field, `entry: 'app'`. The services read the entry's address themselves and compare it with the session's. | Interfaces §A, the command's input |
| 3 | l8-settings-01 | Until U9 lands the new command must be declared in `REMOTE_UNAVAILABLE` or the coverage test fails: one entry in U9's file, with words the section does not give. | The entry reads "Not on another machine yet: signing in to a connector from a plugin or from MAWS's own list". | Interfaces §A, "The route to another machine" |
| 4 | l8-settings-04 | "The palette's description of `/mcp` reads …" takes two insertions in U4's `composer/mentions/` that the section does not name, because the engine's description wins in a started chat. | Both insertions, for the one name `mcp`. | Interfaces §C, "Names" |
| 5 | l8-settings-04 | "Off here is off for every session in <place>" names the project for a session in a linked worktree; where the engine records the switch for such a session was never seen (law 6). | The section's rule, and a wire probe before M6's sentence ships (Proof, P2). If the engine keys a worktree by itself, the place of a worktree session is its folder. | Interfaces §C, "<place>" |
| 6 | l8-settings-03 | "Choosing a skill inserts `/<name> `" rests on a skill's name on disk being the engine's name for it, which no fixture shows and which the code today treats as unverified. | Insert `/<name> ` for a project's and a person's skill and `/<plugin>:<name> ` for a plugin's, after a wire probe confirms both (Proof, P3). Where it does not, that group is listed without "Use in chat". | Interfaces §D, "Skills" |
| 7 | #540 | The `machine-admin` line, "Change its settings, connectors and plugins, and restart it", names what the right is graded for. Over the link a holder of the right can act on connectors only. | "Connect, sign in and disconnect its connectors, and choose the connector tools its dashboards may use." | Interfaces §B, the copy table |
| 8 | #540 | (a) A8's "no line says the same thing twice" fails for reasons the item does not name. (b) `storage`'s new line says "so nothing was sent", which is false when the outcome could not be recorded after the machine answered. (c) Two enroll lines say "Start over" where they are also drawn on a row that has no such button. | (a) The rule is applied to every reason of both sheets (Interfaces §B, the details table). (b) The line drops that clause and main's detail, which says which of the two happened, stays. (c) As the table gives them; the row's Show… opens the sheet that has Start over. A re-enrollment's `machine-names`, where no other name can be chosen, is residue. | Interfaces §B |
| 9 | #523, #456 | (a) "Every sheet and dialog" does not reach the document editor's confirm, in U10's plain CSS. (b) The scrim in `keymap/KeyboardShortcuts.tsx` is an insertion in U6's file the section does not list. (c) `src/artifacts/dashboard/editor/` is U10's by the root's UC-8, and #456 needs two exports from `live.ts`. | (a) One declaration in U10's `chrome.css`, the same value by its token. (b) and (c) are named as insertions (Constraints). The palette and the two dismiss backdrops stay as they are. | Constraints, "Insertions" |
| 10 | #505 | (a) "The element under it reserves the same gutter" needs that element to clip (`overflow: hidden`), or the property does nothing. (b) A class on the transcript's scroller reaches every transcript, not only the session pane's. | (a) The footer clips; what the composer draws past its box is fixed or a portal, and an e2e screenshot checks the frame's shadow. (b) The rule is scoped from the session pane, so U3's `Transcript.tsx` is not edited and U1's `SessionPane.tsx` takes two tokens. | Interfaces §E |
| 11 | S-10 | (a) "Greyed, with 'This project has no channel'": the menu cannot say a sentence. (b) "Bound to a chord in Settings › Keyboard" does not hold while build F stands (ruled with U6a). (c) The row's place in View is not given, and a row of its own id prefix stands between separators. | (a) The menu item is greyed and the palette's row says the sentence. (b) Nothing; the row is not rebindable yet. (c) After the Tabs rows and before "Split / move to other pane": Overview, Artifacts, Tabs ▸ │ Project channel │ Split … | Interfaces §F |
| 12 | l8-settings-06 | (a) "The supervisor's own deep link lands on Background": there is none. (b) "The open's real target is held in memory": no caller can ask for Background, so there is nothing to hold. (c) The table gives one line and one More for Binary, Update and Voice › Shortcut, which each have a second state the words do not fit. (d) Some lines, three of them not in the table, may not fit one line at 760 px. (e) Sessions' heading line and where a later landing's default model and mode rows go. | (a), (b) The stored list is untouched and nothing is held in memory; `background` is a section the index, the search and U7's `openSettings` reach. (c) The words of Interfaces §G, "States the table does not give". (d) The drawn example measures every note; the fallbacks are in §G. (e) Reported for the later design; nothing built. | Interfaces §G |

## Acceptance

The child's A1 to A15, as this landing proves them. A unit test is named by the behaviour it asserts and runs on the VM. An e2e scene is written and typechecked by the executor and run by the architect on a Mac ("Proof that an executor does not run").

| | what is seen | proved by |
|---|---|---|
| A1 | In a session MAWS runs on this Mac whose plugin brings a connector that needs a sign-in, the Connectors dialog shows the row as "Sign in needed" with Sign in; after consent it reads Connected with its tool count. In a terminal session the dialog lists connected servers only and points at the terminal's `/mcp`. For a session on another machine the same row's Sign in is disabled with §A's sentence. | M8's unit tests; M8's scene in `e2e/discover-connectors.spec.ts`, in a gate job on the mini (P1). The clause for another machine is U11b's. |
| A2 | The same for a server of MAWS's own list; Customize › Connectors › My items offers Sign in on that server's row while a session MAWS runs on this Mac holds it, and "Open a session, then sign in" while none does. | M8's unit tests; the same scene. |
| A3 | With five connectors the dialog shows five one-line rows (switch, name, status in words, tool count); transport, source, scope and tool names only when a row is opened; the switch's reach once, in the head; "Connectors" in the menu entry, the title and Customize. A terminal session's dialog has the title and the status words. | M6's unit tests; the edited scenes of `e2e/widgets.spec.ts` and `e2e/c11-live.spec.ts`. |
| A4 | In New chat with a project chosen and nothing sent, the Plugins dialog lists the installed plugins, "+" › Connectors lists the configured connectors, `/skills` lists the skills on disk and choosing one puts its slash name in the composer. None reads "Available once the session starts" or stays blank. A new chat set to another machine says the lists show once the chat starts there. | M7's unit tests; M7's scene in `e2e/widgets.spec.ts`. |
| A5 | The index shows three groups and the sections of §G's table; Engine holds three rows; no row is a paragraph with no control. | M9's unit tests; the edited `e2e/settings.spec.ts`; the owner's look (P5). |
| A6 | At the default window no note of Settings outside the Org page takes more than one line; a row with more ends in "More", which opens the rest in place and closes again; every sentence a note had is on the line, behind More, under its section's heading, or listed as dropped. | M9's unit tests (the table's bound; More); M9's scene in `e2e/settings.spec.ts`, which measures each note's height; §G's table of where each note went, read by the milestone's reviewer. |
| A7 | "mcp", "hook", "theme" and "shortcut" each list their rows as "row in section"; choosing one scrolls to the row and marks it; a word behind a More finds the row and opens its More; no match reads "No matching settings"; Esc clears the field. | M10's unit tests; M10's scene in `e2e/settings.spec.ts`. |
| A8 | Each of the fifteen keys reads as §B gives it in the grant sheet, the enroll sheet and the machine row, and no refusal of either sheet says a thing twice. | M2's unit tests. |
| A9 | On a machine every member owns, a grants read that is out reads "Reading <machine>'s grants…", one that failed shows its line and Retry, and "Everyone in the org owns this machine…" shows only once the grants are known. | M2's unit test, which holds the read open. |
| A10 | In the light theme the window behind any sheet or dialog is dimmed by the same amount; the Share sheet names the remedy and the machine; hovering the Share or Add owner subtitle shows the whole title and machine name. | M3's unit tests; `e2e/share.spec.ts` (its pin holds) and the screenshots it attaches. |
| A11 | With classic scrollbars the Channel's footer and a stream row have the same left and right edges, and so do the session pane's composer and a transcript row. At the default window and in a column about 420 px wide no Channel row overflows, and names give way in §E's order. | M3's scenes in `e2e/channel.spec.ts` and `e2e/composer.spec.ts`; M3's unit tests for the tooltip and the removed cap. |
| A12 | A live query paused because its machine does not offer connectors shows "Connectors on <machine> need its app", offers no Allow and has Refresh disabled. | M2's DOM test. |
| A13 | With the network off a Channel tab shows what this Mac holds; its footer reads "Offline · retrying" with "As of <time>" once the channel's first attempt fails; the composer returns when the channel is live; a Channel never read on this Mac says so. | M4's unit tests, which hold each sequence of §F open; the edited `e2e/channel.spec.ts`; the reproduction (P4). |
| A14 | ⌘K, then "channel" or a project's name, lists "<project> · channel" for each project that has one, with "N waiting"; Enter opens the tab. View › Project channel opens the Channel of the focused tab's project. Nothing is added to the sidebar. | M5's unit tests; M5's scene in `e2e/channel.spec.ts`. |
| A15 | The Gateway section, the launch profile's switches and what they write, and the plugin library inside a session behave as before. | No assertion on a `settings.set` payload, a command's input or the plugin library's rows changes in the tests M9 and M7 edit (Constraints, law 8). |

## Constraints that bind every milestone

- **The design binds.** The child's file and the root, at the places the header names. Stop and hand the point back to the architect with the evidence where the code contradicts a statement the work rests on beyond the twelve points above, where the work needs an edit in another child's file beyond the insertions listed here, where a contract or another child would have to change, or where the owner would see something neither the section nor this document says. Everything else is decided in the spirit of the section and recorded in the Decision Log.
- **Laws.** Law 3: no setting is added and one row is removed. Law 5: each connector item behaves as its section says on each route; "not on this route" is the section's, not the executor's. Law 6: nothing depends on an engine behaviour not seen. M8 starts after P1's verdict. M6's head sentence and M7's "Use in chat" are built at their defaults and stand only once P2 and P3 have answered, before M11; each outcome changes the one place its row of Proof names. Law 7: today's tokens only; no new token for the scrim or the gutter. Law 8: l8-settings-08, -09 and -10 are `keep`. Moving the launch profile's rows and shortening notes changes no behaviour; in `LaunchProfileSettings.test.tsx`, `McpServersSettings.test.tsx`, the Gateway cases of `SettingsView.test.tsx` and the plugin library's tests, an assertion on what is written or sent is not edited. An executor who finds it must be stops and reports.
- **The child's binds 6 to 11.** No reset for a damaged grants record. Nothing changes in what the Share sheet sends or how it authorises. One sign-in per connector at a time. Customize reads and changes this Mac only, and nothing shows this Mac's configuration as another machine's. The slash name stays `/mcp`. **Every engine sign-in and every Keychain write a test makes runs only in a gate job on the Mac mini runner.** An executor never runs `pnpm e2e:discover`, the spike script, or anything that starts an engine with an OAuth server, on the MacBook, on the VM or anywhere.
- **UC-8, insertions in files other children own.** Each is the smallest that does it. "Named" means the child's file or the root names it; "reported" means it is a point above and waits for its ruling.

  | owner | file (under `src/renderer/src/` unless it starts with `src/`) | the insertion | milestone | |
  |---|---|---|---|---|
  | U4 | `composer/plus-menu/PlusMenu.tsx` | the two entry labels; the Connectors submenu's rows and its empty line come from one hook of `widgets/`; the Plugins submenu's "unavailable" sentence goes | M6, M7 | named |
  | U4 | `composer/WidgetDialog.tsx`, `composer/InlineEdit.tsx` | the overlay's class from the exported name | M3 | named |
  | U4 | `composer/mentions/widgets.ts`, `composer/mentions/items.ts` | the description of `mcp`, and that one name's declared description winning over the engine's | M6 | reported, 4 |
  | U3 | `transcript/view/rows/Divider.tsx` | the overlay's class | M3 | named |
  | U3 | `transcript/view/Transcript.tsx` | none: the gutter is scoped from the session pane | — | named, not needed |
  | U1 | `session/SessionPane.tsx` | two tokens: the scope on the transcript's wrapper, the gutter on the composer's wrapper | M3 | named (one line each) |
  | U6 | `src/shared/keymap/actions.ts`, `actions.test.ts` | the row `channel.open`; its id in the test's `LANDED` list, as U6a's document asks of a landed child | M5 | named |
  | U6 | `palette/CommandPalette.tsx` and its test | the channel entries; one entry of `UNAVAILABLE` | M5 | named |
  | U6 | `keymap/KeyboardShortcuts.tsx` | the overlay's class | M3 | reported, 9 |
  | U9 | `src/shared/ipc/remote-unavailable.ts` | one entry | M8 | reported, 3 |
  | U10 | `src/artifacts/dashboard/editor/LiveQuery.tsx`, `live.ts`, `live-views.dom.test.tsx` | #456: two exports, the sheet's test of a pause, one case | M2 | reported, 9 |
  | U10 | `src/artifacts/document/editor/chrome.css` | one declaration of `.doc-confirm-overlay` | M3 | reported, 9 |
  | U12 | `delivery/copy.ts` | "Settings › Engine › MCP servers" becomes "Settings › Sessions › MCP servers" | M9 | named |
  | U13 | `e2e/cross-build.spec.ts` | only if its settings scene finds this build's rows through the Engine region; then the locator by the row's own label, which both builds draw | M9 | this document |

  In files UC-8 gives nobody: `resume/host.tsx` (the overlay's class), `App.tsx` (one mount, M5), `gateway/actions.ts` (one comment, M9), the connectors' names, schema and grades under `src/shared/ipc/`, and the wire's files. Not edited, and left as residue for their owners: the Connectors card (`panel/summary/Connectors.tsx`, U8), `sidebar/AddProject.tsx` and `sidebar/menus.tsx` (U7).
- **UC-14.** Neither settings file changes its schema or its version; no setting moves between the files; every row writes the field it writes today. The stored tab's list of sections is not changed (§G). This landing adds no layout key. §H says, per thing stored or sent, what build F does with it.
- **UC-7.** At this landing the new command is declared unavailable for a session on another machine: its control is drawn disabled with one sentence, and nothing is sent.
- **The wire.** Additive only: one new command. `WIRE_MINOR` takes the next number after the merge of Concrete Steps 1, with its comment; the four generated files are rewritten on the VM and brought back as a patch (Concrete Steps 4). The architect tells the session that keeps master of the wire files.
- **Copy.** The words of the child's tables and of Interfaces are exact, apostrophes as each file writes them. A sentence not given by either is not added.
- **UC-11, the repository is public.** Nothing of the owner's enters code, tests, fixtures, comments, commit messages, documents or pull-request text. Fixtures use invented names, paths and text.
- **Where checks run (UC-10).** The worktree on the MacBook carries no `node_modules`; nothing is installed, typechecked, linted, tested, built or launched there. Every check runs on the wave's build VM in a checkout of the pushed head. Class 1a on GitHub Actions, every Electron e2e run and every engine probe are the architect's.
- **Git.** Commit as you go and push `ux-wave/U11a`. Merge master, never rebase or force-push. Never commit to master or to `ux-wave-spec`, and never edit the spec's files. No attribution trailer but the `Sminos-Session:` line the dispatch gives, which ends every commit message.

## Plan of Work

Eleven milestones. Each is one executor's from this document, the child's file and the code, is reviewed at its boundary, and leaves typecheck, lint and the unit suite green. A milestone carries the e2e edits its change forces and the scenes it adds; they are written and typechecked there and run by the architect. The order puts first what waits on nobody: M1 hands the architect a probe to run while M2 to M7 are built; M8 waits for that probe's verdict; M9 and M10 wait for the owner's look at the drawn example. M5 needs U6a on master (Concrete Steps 1).

What consumes what: M7 and M8 consume M6's row and status words; M10 consumes M9's row table; nothing else crosses milestones.

Expected size, lines added plus removed: M1 250, M2 450, M3 450, M4 450, M5 350, M6 650, M7 750, M8 900, M9 1,500, M10 700, M11 100. About 6,400 lines over about 105 files.

### M1 — The probe: a dynamic connector's sign-in through MAWS's redirect (prototyping)

**The question.** For a server of the launch's own list (`--mcp-config`) and for a plugin's server: does `mcp_authenticate` with MAWS's redirect answer the `custom` scheme, do `mcp_oauth_callback_url` and then `mcp_reconnect` take the server's name (`plugin:<plugin>:<server>` for the second), does `mcp_status` then read connected, and does a later engine process that loads the same server read it connected?

**What is built.** Two questions, `dynamic` and `plugin`, in `spikes/p4-aggregator/m4-signin-spike.mjs`, each in its own engine process, shaped as the script's `custom` question is. The second loads a scratch plugin whose `.mcp.json` names the OAuth fixture's resource; how a plugin folder is given to the engine is read in the engine's bundle and in MAWS's own launch (`src/engine-host/launch.ts`). The existing case "spike: …" of `e2e/discover-connectors.spec.ts`, which owns the fixture, the scratch config home and the Keychain custody, prints the two answers with the others. No product code.

**How it is run, and by whom.** The architect, in a gate job on the mini (Proof, P1). The executor writes and typechecks; it does not run the script.

**What is observed, and the criteria.** Per question: the scheme answered, each step's answer, the final status, and the next process's status.
- *Promote, as designed:* both kinds complete with the `custom` scheme. M8 is built as §A writes it.
- *Promote, with the engine's own listener:* for a kind the engine answers another scheme, or refuses the callback or the reconnect by that name. M8 gives that kind no redirect (§A, "The redirect"), and the operation's existing path for the engine's own listener carries it.
- *Discard for a kind:* `mcp_authenticate` refuses the name. That kind gets no Sign in in M8, and the architect takes A1 or A2 back to the design.

**Its proof** is the verdict, written as a dated part of `spikes/p4-aggregator/findings-m4.txt` with the engine's version and the run's id, and routed into Surprises & Discoveries with the criteria applied.

### M2 — Org sheets: each refusal names a next step; the grant sheet's read; a paused live query says why

**What exists at its end.** The fifteen lines read as §B gives them. No refusal in the grant or the enroll sheet says a thing twice. The grant sheet with nobody to grant to shows the read's own state. The LiveQuery sheet shows why a query is paused when its machine does not offer connectors, offers no Allow and disables Refresh.

**What it touches.** `settings-tab/copy.ts` (the `ORG` keys of §B), `settings-tab/org/GrantSheet.tsx`, `EnrollSheet.tsx` and their tests, `MachinesGroup.test.tsx`; `src/main/org/grants.ts`, `enroll.ts` and their tests (the cut clauses of §B); U10's `src/artifacts/dashboard/editor/LiveQuery.tsx`, `live.ts`, `live-views.dom.test.tsx`.

**Interfaces.** §B. Exposes nothing.

**Decisions.**
- What follows each line is §B's details table, for every reason main gives to the two sheets' refusal lines (`RefusedLine`, which the re-grant sheet shares, and the enroll sheet's line for a refused start). A reason main gains later shows its detail until the table says otherwise. The approval's refusals in the enroll sheet are worded by `ORG.signReasons`, are not among the fifteen keys and are not changed.
- *The grant sheet with nobody to grant to* (`choices` empty): no read has answered yet, and none failed: "Reading <machine>'s grants…" (`ORG.grantReading`). A read was refused or the first read failed: its line and Retry, the component the other branch already draws. Grants known: `ORG.grantNobody`, or the person picker when an owner still holds a grant. While a retry is out the earlier line and Retry stay, as in the other branch today; a second press starts another read and only the last answer lands.
- *#456.* `live.ts` exports `concrete` and `notOfferedOn`. The sheet's test is: no route, as today, or whatever `concrete` calls concrete. Allow is not offered and Refresh is disabled only for the not-offered pause; `failed` and `watchLimit` keep theirs.
- Main's strings change only by losing a clause the sheet's line says; no reason, code or order of checks changes.

**What it does not touch.** What is signed, sent or refused. `MachineRow.tsx`'s logic. The People rows. A reset or repair of a damaged record. The other pause lines.

**What it proves.** A8, A9, A12. Tests assert: each of the fifteen keys' text; for every reason of each sheet, given the detail as main words it after this milestone, the exact text drawn (§B's details table); main's tests, the details as cut; the `ineligible` list drawn once; the nobody state through this sequence, the read held open: reading, a refused read's line with Retry, Retry pressed and held (the line stays), the answer (the nobody sentence, and in a second case the picker); the not-offered pause's line with no Allow and Refresh disabled, and Allow kept for `failed`.

### M3 — One scrim for every sheet; the Channel's gutter and names

**What exists at its end.** Every sheet and dialog dims the window with one class from one name. The Share sheet's line names the remedy and the machine, and the Share and Add owner subtitles show the whole title and machine name on hover. Under classic scrollbars the Channel's footer lines up with its rows and the session pane's composer with its transcript. Every Channel row lets names give way in one order and never overflows.

**What it touches.** `sessions/Sheet.tsx`, `sessions/share/ShareSheet.tsx`, `AddOwnerSheet.tsx`, `sessions/share/copy.ts` and their tests; the overlays of the Constraints table and `resume/host.tsx`; `styles/app.css`; `channel/ChannelView.tsx`, `parts.tsx`, `Exchange.tsx`, `Entries.tsx`, `ToHumanEntry.tsx` and their tests; U1's `session/SessionPane.tsx`; `e2e/channel.spec.ts`, `e2e/composer.spec.ts`. `e2e/share.spec.ts` is not edited: its pin of the scrim's class holds and its sentence follows the copy.

**Interfaces.** §E. Exposes `SCRIM` and the gutter classes.

**Decisions.**
- `Sheet`'s `scrim` prop goes and its overlay keeps `data-sheet-scrim`, which `e2e/share.spec.ts` reads. The three overlays that carry `opacity-60` lose it with the swap, or the dim would be 0.6 of 0.08.
- `sidebar/AddProject.tsx` already draws the value and is not edited. The command palette keeps no overlay, and the two dismiss backdrops (`app/Shell.tsx`, `panel/PanelRegion.tsx`) are not dialogs.
- The remedy sentence replaces `REFUSALS['not-supported']`, so main's refusal of a save in the same words reads it too. `REFUSALS.unsupported` is another sentence and stays.
- The gutter and the order of names are §E's. The order is by shrink weights far apart, so it is exact in practice and approximate in principle; the e2e scene at 420 px is its proof, since jsdom measures nothing.
- The say row's recipients and owners labels stand after the title and before the chip in the order.

**What it does not touch.** What the Channel shows or folds. The transcript's rows or its scroller's file. A new token. What the Share sheet sends. `sidebar/`.

**What it proves.** A10, A11. Unit tests assert: `Sheet`'s overlay class is `SCRIM` and no caller passes a scrim; the Share sentence with a machine's name; both subtitles' tooltip "<title> · <machine>"; an alias with no 24-character cap; a party's tooltip holding alias, title and machine; the to-human header's chip able to shrink. The e2e scenes measure: the footer's and a stream row's left and right edges equal under classic scrollbars; the session pane's composer and a transcript row the same (a scene of `e2e/composer.spec.ts` launched with classic scrollbars); no row overflowing in a 420 px column with a long alias, title and machine; a screenshot of each footer under classic and overlay scrollbars, for the frame's shadow.

### M4 — The Channel says it is offline

**What exists at its end.** The channel's answer and its changes carry the channel's own reach while it is not live. The footer reads signed out, a sign-in that ended or is not admitted, "Offline · retrying", or "Connecting…", in that order, after "As of <time>". A channel never read on this Mac says so.

**What it touches.** `src/shared/ipc/schema/org.ts` (the two open shapes), `src/main/org/channel/channel.ts` and `channel.test.ts`, `channel/state.ts`, `ChannelView.tsx`, `channel/copy.ts` and their tests, `e2e/channel.spec.ts`.

**Interfaces.** §F, "The channel's reach": the field, the events, the table of transitions and the footer's order, fixed before the code.

**Decisions.**
- Reach is told as a change whenever it moves while the channel is not live, also when nothing else changed. `ChannelsDeps.reach` already names the network-path object in `channel.ts`; the new state takes another name inside.
- A close that ends the channel (its code is one of the terminal ones) is not a failure of reach; the footer's earlier lines speak for it.
- Sign-out, a new hub and a released channel start again at `connecting`, so a stale "Offline" never shows after signing back in.
- The composer's return follows the channel's own retry, up to about 36 s after the network is back; no listener for the network is added (the section's "Not included" rules out a Retry; this is the same choice).
- If P4 shows the open's answer itself was late, its cause is fixed in main here, under a dated Decision Log entry that names what the open waited on. Without P4's result the milestone is complete as written, and A13's first clause waits for P4.

**What it does not touch.** The hub notice in the sidebar and `org-session.ts`. The channel's retry timing. The cache file. X-194.

**What it proves.** A13. Main's tests hold these sequences open with a held attestations promise and the fake socket: (a) attestations held: the open answers at once from the cache with `reach: 'connecting'`; (b) attestations fail: a change to `unreachable`; a socket error before the welcome leaves it; welcome then caught-up: live, no reach; (c) live, then a close after the welcome: `connecting`; the next socket fails before its welcome: `unreachable`; (d) a second open during (b) answers `unreachable` and opens no second socket; (e) sign-out and back in: `connecting`; (f) released during the backoff: no socket afterwards; (g) a terminal close code: not `unreachable`; (h) a wake that drops a live socket: `connecting`. The renderer's tests assert the footer for each pair of org status and reach, the composer back on live, and the "no copy" sentence for an open channel with no entries and no `asOf`.

### M5 — The Channel opens from the command palette and the View menu

**What exists at its end.** The palette lists "<project> · channel" for each project that has one, with "N waiting"; Enter opens or brings forward its tab. View › Project channel opens the Channel of the focused tab's project and is greyed where that project has none.

**What it touches.** U6's `src/shared/keymap/actions.ts` (one row) and `palette/CommandPalette.tsx` with its test; `channel/project.ts` and its test; a new `channel/open-action.ts` with its test; one mount in `App.tsx`; `e2e/channel.spec.ts`.

**Interfaces.** §F, "The Channel's entries". Consumes U6a's table (§I).

**Decisions.**
- The row's place and the greyed item's words are §F's (reported, 11).
- "Has a channel" becomes one function in `channel/project.ts` that answers what the sidebar's two menus answer today; a test holds it equal to both on the same fixtures. `sidebar/menus.tsx` is not edited.
- The count on an entry is the length of the Channel's own waiting list for that project (`waitingFor`), so it reads UC-1's predicate and nothing else.
- With a Channel tab in front the action's project is that tab's, so the action stays enabled there.
- The row is not rebindable while build F stands (U6a's guard); this landing does nothing for that.

**What it does not touch.** `src/main/menu.ts`, the dispatcher, the shortcut sheet. The sidebar and the project row. A default chord.

**What it proves.** A14. Tests assert: an entry per project with a channel and none for a project without; matching by the project's name and by "channel"; "N waiting" from the waiting list and no count at zero; Enter opening the tab and, with it open, bringing it forward without a second tab; the action registered while the front's project has a channel and unregistered when the front changes to one without; the palette's sentence for the unregistered action. The e2e scene presses the menu item by its id and opens the Channel from the palette.

### M6 — The Connectors dialog: one line per connector, one name, the switch's reach said once

**What exists at its end.** The dialog a chat opens is titled "Connectors" with "MCP servers" muted beside it. Each connector is one line: the switch, the name, the status in words, the tool count; opening a row shows the rest. Sign in and Reconnect sit on the line of a row that needs a sign-in or failed. The head says once what the switch reaches. The "+" menu's entries read "Connectors in this chat…" and "Plugins in this chat…".

**What it touches.** `widgets/McpWidget.tsx`, `McpDriven.tsx`, `WidgetFrame.tsx`, `widgets/copy.ts` and their tests; a new `widgets/connector-status.ts`; `customize/CustomizeView.tsx` (the live list's call); U4's `PlusMenu.tsx`, `composer/mentions/widgets.ts` and `items.ts`; `e2e/widgets.spec.ts`, `e2e/c11-live.spec.ts`.

**Interfaces.** §C. Exposes `connectorStatusWords` and the row to M7 and M8.

**Decisions.**
- One body. `McpBody`'s default branch goes and the compact row gains the actions; Customize's live list is the same row with no actions. Where no switch is drawn, a disabled connector reads "Off".
- No control sits inside the row's `summary`: the switch stands before the disclosure and the line's actions after it, so a press on either never opens the row.
- Reconnect is on the line for `needs-auth` and `failed`, and in the opened part for every other status.
- The line under a row is the answer of a toggle or a reconnect, and "Read again" when the switch is unconfirmed. A failed row with nothing done shows "Failed" on its line and its error in the opened part, not the idle line it has today.
- Session info reads `present`; its shape does not change.
- A row's switch and Reconnect stay disabled while either of that row's operations is out, as today. The answer lands under its row whether the person opened or closed the row meanwhile, and an answer that never comes leaves the operation's own words there, as today.
- The head's sentence and its `<place>` are §C's; P2 confirms or corrects `<place>` before M11 (law 6).

**What it does not touch.** `toggleView` and the rule that the switch is read back. The terminal dialog's commands. Customize's own connector rows. The Connectors card. Per-chat switches.

**What it proves.** A3. Tests assert: five servers draw five rows with name, words and count, and no transport, source, scope or tool name until a row is opened; the words for each status of §C and the engine's own word for any other; the head's sentence once and on no row; a press on the switch or on Sign in leaving the row closed; Reconnect on the line of a failed row and inside a connected one; the toggle's and the reconnect's answer under their row; held open: a toggle that is out disables that row's switch and Reconnect, the row is closed, and the answer still lands under it; the terminal dialog's title and words; the live list's "Off"; the two menu labels; the palette's description of `/mcp` in a started and an unstarted chat.

### M7 — Plugins, Connectors and Skills before the first message

**What exists at its end.** In an unstarted tab on this Mac the Plugins dialog manages the plugins of the tab's folder, the Connectors submenu and dialog list the folder's configured connectors, and `/skills` lists the skills on disk. A tab set to another machine says the lists show once the chat starts there.

**What it touches.** A new `widgets/tab-place.ts`; `widgets/PluginsWidget.tsx`, `widgets/plugins/LoadedLine.tsx`, `McpWidget.tsx`, `SkillsWidget.tsx`, `widgets/copy.ts` and their tests; a new `customize/inventory.ts` taken out of `CustomizeView.tsx`; U4's `PlusMenu.tsx`; `e2e/widgets.spec.ts`.

**Interfaces.** §D. Consumes M6's row and words.

**Decisions.**
- The three dialogs branch before the frame's own read; `NOT_YET` and `availabilityRefusal` are not changed.
- The folder, the remote target and the three states a dialog can be in are §D's.
- The submenu reads the inventory only for a tab that has a setup intent. A menu drawn with no session id reads nothing, as `CustomizeView.test.tsx` pins.
- The inventory's query moves to one hook with a stale time, so opening the submenu twice reads once; its key is unchanged, so Customize and the dialogs share the answer.
- The Connectors list shows, per name, the entry the engine will use (`shadowedBy` of `customize/connectors/present.ts`), with its scope in Customize's words.
- An inventory read that fails shows its words with Retry in the list's place, as Customize's page does; one that is slow ends at the engine host's own bound (seven seconds) with the host's warning. The plugin reads fail as they fail in Customize.
- When the chat starts while a dialog is open, the dialog draws what a started chat's dialog draws, the frame's "Starting…" first; the two are not mixed. When the tab leaves for another machine, the dialog closes.

**What it does not touch.** `composer/submit/submit-state.ts`. Customize's page. Choosing connectors before the start (#476). Reading another machine's configuration.

**What it proves.** A4. Tests assert, for an unstarted tab: the Plugins dialog reading the folder of §D (a project's, a worktree not yet made, none chosen) and its loaded line reading "Not observed yet" alone; the Connectors dialog's rows with no switch, Reconnect or Sign in under its line; the submenu's rows with scopes; the Skills dialog's three groups, its lead line, no Reload, and the text a choice inserts; none of the three drawing "Available once the session starts"; a remote target drawing only its sentence and reading nothing. Held open: a read out when the folder changes (the old answer is not drawn); a dialog open when the chat starts (rows, then "Starting…", then live rows); a dialog open when the tab leaves for another machine (it closes).

### M8 — Sign in for a plugin's connector and for MAWS's own list

Starts after M1's verdict is recorded.

**What exists at its end.** A dynamic connector that needs a sign-in offers Sign in in the Connectors dialog of a session MAWS runs on this Mac, and a row of MAWS's own list offers it in Customize while a ready session holds that server. The steps, Cancel and the ways it ends are today's. For a session on another machine the control is disabled with §A's sentence.

**What it touches.** `src/shared/ipc/names/connectors.ts`, `schema/connectors.ts`, `grades/connectors.ts`, `wire.ts`, the four generated files, and the two lists of the machine's commands that tests hold (`test/support/spine-lists.ts`, `src/services/machine-ops.test.ts`); U9's `src/shared/ipc/remote-unavailable.ts`; `src/services/connectors/sign-in.ts`, `sign-in-entry.ts` and their tests; `customize/connectors/sign-in.ts`, `present.ts`, `ConnectorsSection.tsx` and their tests; `widgets/McpWidget.tsx` and its test; `e2e/discover-connectors.spec.ts`.

**Interfaces.** §A. Exposes `connectors.signInDynamicServer` to U11b and to X-184.

**Decisions.**
- The command, its check, its identity and its route to another machine are §A's.
- The check runs inside the operation, in the services, on the status of the session the act then uses; nothing at the door decides it. No remote caller reaches the command at this landing: it has no offer row.
- A dynamic server is never read from a file later, so the wait the operation gives a just-added server ("Server not found", up to ten seconds) does not apply to it: that answer fails the operation at once in the engine's words.
- An older daemon on this Mac answers `unknown_command`; the row reads it as a sign-in that did not finish, in the transport's words. No capability is added for this Mac's own daemon: that state lasts until the daemon is replaced when idle.
- M1's verdict sets the redirect per kind (§A).

**What it does not touch.** `src/endpoint/`, `src/main/lane-b/`, `apps/org-protocol/` (U11b). `connectors.signIn` and `connectors.signInServer`. Settings › MCP servers' rows. MAWS's own credential store. Plugin connectors in Customize (X-184).

**What it proves.** A1 and A2 on this Mac. Services tests assert: each refusal of `dynamicRefusal` with its words; the `entry: 'app'` comparison on transport and address; a dynamic sign-in through every state to connected; one at a time across two sessions. Held open: a second press from another session while the first waits for its callback (the first ends cancelled, the second goes on); a cancel while the check's read is out (no `mcp_authenticate` is sent); the session leaving while the entry's address is being read (it ends `session_exited`, nothing sent). Renderer tests assert: Sign in on a dynamic row and the command it sends; no Sign in for `claudeai` and managed scopes; the disabled control and its sentence for a session on another machine, with a file-scope row beside it still enabled; Customize's own-list row choosing the attached session, then any ready one that lists the name, then "Open a session, then sign in"; a dialog's finished result not shown on Customize's row. `wire.test.ts` holds the manifest: one command added, the event's entry unchanged. The mini's scene signs in a plugin's connector and one of MAWS's own list from the dialog, and the second from Customize.

### M9 — Settings regrouped, its notes on one line

Starts after the owner's look (P5) and the architect's word on it.

**What exists at its end.** The index shows three groups; the body is in the index's order and opens at Appearance; Engine holds Binary, Update and Config home; Sessions and Background hold what §G's table gives them; the Plugins paragraph row is gone. Every row is drawn from one declaration; a note is one line and the rest is behind "More".

**What it touches.** `settings-tab/SettingsView.tsx`, `copy.ts`, `parts.tsx`, `EngineSection.tsx`, `SessionsSection.tsx`, a new `BackgroundSection.tsx` and `rows.ts`, `SupervisorSettings.tsx`, `BudgetSettings.tsx`, `LaunchProfileSettings.tsx`, `McpServersSettings.tsx`, the other sections' files where a note changes, and their tests; `settings-tab/index.ts`; `gateway/actions.ts` (a comment); U12's `delivery/copy.ts`; `e2e/settings.spec.ts`, `e2e/supervisor.spec.ts` and `e2e/cross-build.spec.ts` only if a locator breaks.

**Interfaces.** §G. Exposes `SettingsSection`, the section table and the row table to M10 and U7.

**Decisions.**
- The words are the child's table with §G's additions. Any change the look brings is written into §G before the milestone starts.
- The supervisor's rows keep their group, named by `aria-label` "Background supervisor", and lose the visible `h4`; the keyboard's fallback moves to the section's heading. So `e2e/supervisor.spec.ts` and the supervisor's tests keep their locator.
- A state line is marked as one and is never cut or put behind More.
- A More that is closed is not exposed to a screen reader; its button carries `aria-expanded` and reads "Less" while open.
- Below 32rem the index's row of links drops the group headings and keeps the order.
- Law 8 holds as Constraints say.

**What it does not touch.** Either settings schema, a setting's default, or what a row writes. The Org page's rows. `KeymapSection.tsx` and `keymap.ts` beyond a row's declaration. The stored tab's schema.

**What it proves.** A5, A6. Tests assert: the index's groups and order; each section's rows in §G's order; Engine's three; no Plugins paragraph; every declared row drawn in its section or revealed by another, and every drawn row declared; every declared line at most the bound of §G; a More opening in place and closing; a state line whole; the stored list of sections equal to build F's ten; `delivery/copy.ts`'s sentence. The e2e scene measures every note's height at the default window. A6's last sentence is not a test: the milestone's reviewer reads §G's table of where each old note went against the diff, since a test could only restate that table.

### M10 — Search settings

**What exists at its end.** "Search settings" at the top of the index lists matching rows as "row in section" in place of the sections, with Up, Down and Enter; choosing one scrolls to the row, marks it, opens its More when the match was there, and gives the row's control the keyboard. ⌘F inside Settings focuses the field; Esc clears it.

**What it touches.** A new `settings-tab/search.ts` and its test; `SettingsView.tsx`, `rows.ts`, `copy.ts` and their tests; `e2e/settings.spec.ts`.

**Interfaces.** §G, "Search".

**Decisions.**
- Matching is a pure function over the row table, the keyboard's rows and the Org page's group headings, so the same words are drawn and found.
- ⌘F is taken by the Settings view while it holds the keyboard and by nothing else, so it needs no row in U6's table and keeps working when U3's Find lands.
- The field carries `data-escape-clears`; while Settings is a tab, Esc in an empty field does nothing.
- The field is drawn once the settings are read, with the rows. Choosing a second result while the first is still marked takes the first mark away at once.

**What it does not touch.** `src/shared/keymap/`. A fuzzy match or a ranking. The Org page's rows.

**What it proves.** A7. Tests assert: the four queries of A7 and their results; every word required and case ignored; a section's name and an Org group as results; a keyboard binding found by its action's title; a word that is only behind a More; a row not drawn leading to the row that reveals it; "No matching settings"; the keyboard in the list; the mark going after its moment, and at once when another result is chosen; Esc clearing; ⌘F focusing the field and reaching nothing outside Settings.

### M11 — The record, the whole checks, the hand-back

**What exists at its end.** The five reversed rulings are amended where they stand. The branch has passed typecheck, lint on what changed and the whole unit suite on the VM. The hand-back is written.

**What it touches.** The documents of "The record"; this document's Progress, Surprises & Discoveries and Decision Log.

**What it does not touch.** Product code, unless a check shows a defect; then the fix goes to that milestone's owner through the controller. The register, the board, the tracker.

**What it proves.** Parent-level acceptance 4 for U11's five entries; that the tree is green before the architect's gate.

### The record (in the same pull request, UC-10)

Each is a dated addition where the earlier words stand; the earlier words stay. The sentences are the child's, under "Rulings reversed".

- l8-settings-06: `docs/doperpowers/plans/2026-09-28-c11-palette-settings-gateway-usage.md`, under "Settings tab", and the comment that opens `settings-tab/copy.ts`.
- l8-settings-01: the entry "M4's review fixes" in the Decision Log of `docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md`, and the paragraph "Sign in from the session's MCP widget" of `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md`.
- l8-settings-04: the `mcp` row of the widget table in the same C11 document.
- #505: residue 35 to 37 of `docs/doperpowers/plans/2026-10-28-p5-o8-report.md`.
- S-09: M7a's "At its end" in `docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md`.

The tracker rows of 2026-10-21, 2026-11-08 and 2026-11-12 that close with this landing, the register's rows and the board are the architect's at landing.

## Concrete Steps

From the worktree of branch `ux-wave/U11a`. `vmcheck` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U11a --`.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Then check what the merge brought: `git log --oneline -1 origin/master`, and whether U6a is in it: `git grep -n "BUILD_F_ACTION_IDS" origin/master -- src/shared/keymap/ | head -1`. If that prints nothing, M5 waits and every other milestone goes on. Whether U13a's selector is there decides one import of M5 (§F): `git grep -n "export function sessionRow" origin/master -- src/renderer/src/keymap/actions-runtime.ts`. For each file this document names that the merge changed (`git diff --name-only 48619c824 origin/master`), read it again against "What the code says today" before building on it. If master already holds U7's Settings dialog (no `settings` tab kind in `src/shared/ipc/schema/layout.ts`), stop and report: §G's paragraph on the stored section then does not apply.

2. **Each milestone**, tests first where a test can fail first. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U11a
       vmcheck 'pnpm exec vitest run <the test files the milestone names>'
       vmcheck 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'     # the renderer; tsconfig.node.json for main, services and shared code; tsconfig.e2e.json for e2e/
       vmcheck 'pnpm exec eslint <the paths the milestone changed>'

   Each call prints `vmcheck: ux-wave/U11a at <short sha>` and then the command's output; its exit status is the command's. At a tests-first commit the run fails on the new assertions; at the milestone's head vitest prints `Test Files … passed` with no failure, `tsc` prints nothing and eslint prints nothing.

3. **M1** adds no test. `vmcheck 'node --check spikes/p4-aggregator/m4-signin-spike.mjs'` prints nothing, and the e2e project typechecks. Then stop on M1 and hand the architect P1.

4. **M8, the wire.** After the schema, names and grades are edited, take the next `WIRE_MINOR` after the merged master's, then regenerate on the VM and bring the result back:

       G='src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json src/shared/ipc/routes.json src/shared/machine/address-paths.json'
       vmcheck "pnpm wire:manifest >/dev/null; MAWS_ROUTES_WRITE=1 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null; MAWS_ADDRESS_PATHS_WRITE=1 pnpm exec vitest run src/shared/machine/coverage.test.ts >/dev/null; git diff -- $G; git checkout -- $G" > /tmp/u11a-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u11a-wire.patch | git apply

   The last `git checkout` leaves the VM's checkout clean for the next call.

   Expect the patch to add `commands.connectors.signInDynamicServer` and the minor to the manifest, one name to each of the other two files, and nothing under `events.connectors.signInChanged`; `wire-fingerprint.json` does not change (the command is the machine's, not the engine host's). A line under the event means the event's bound moved: undo it. Then `vmcheck 'pnpm exec vitest run src/shared/ipc src/shared/machine test/lane-b/offer-coverage.test.ts'` passes.

5. **M11, the whole checks.**

       vmcheck 'pnpm typecheck'
       vmcheck 'pnpm exec eslint src/renderer/src/settings-tab src/renderer/src/customize src/renderer/src/channel src/renderer/src/widgets src/renderer/src/sessions src/renderer/src/palette src/renderer/src/composer src/services/connectors src/main/org src/shared/ipc src/artifacts/dashboard/editor e2e'
       vmcheck 'pnpm test'
       vmcheck 'node --test .github/scripts/maws-app-scan.test.mjs'

   `pnpm typecheck` takes about five minutes and prints no error. In `pnpm test` the files the build brief lists fail on master too and are not this landing's; any other failure is. The scan passes: this landing adds no recorded file, and the scan is run because M1 and M8 touch fixtures' neighbours.

6. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e or engine. The hand-back says: what exists, with the command and result that showed it; what is not verified (every e2e scene, P1 to P5); the decisions made; anything that contradicts the spec; the residue. Residue known at authoring: the Connectors card still shows the engine's raw status and says "MCP servers" (U8's file); a re-enrollment's `machine-names` line names a remedy that does not apply; a `storage` refusal after the machine answered still opens with "Not signed"; a file-scope server and a dynamic one of the same name and address are two connectors to the one-at-a-time rule though the engine keeps one credential; the composer's return after an outage waits for the channel's own retry; the document editor's confirm if ruling 9 leaves it out.

7. **The architect's, after the hand-back.** The e2e runs of "Proof that an executor does not run"; class 1a on the head handed back, in the background (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u11a`); the xhigh panel; class 1a again on the final head if the panel changed the branch; the pull request.

## Interfaces and Dependencies

Paths under `src/renderer/src/` unless they start with `src/` or `e2e/`. A name here is what later milestones and siblings code against; an executor who must change one stops and reports. Everything not named here is the executor's.

### §A. The sign-in of a dynamic connector (M8; consumed by U11b and X-184)

**The command and the event** (`src/shared/ipc/schema/connectors.ts`; reported, points 1 and 2):

    'connectors.signInDynamicServer': machine(z.strictObject({
      name: z.string().min(1).max(128),      // as the session's mcp_status reports it
      appSessionId: AppSessionIdSchema,
      entry: z.literal('app').optional(),    // the press came from a row of MAWS's own list
      ...Callback,                           // a remote asker's port: no caller sends it until U11b
    }), OperationReceiptSchema),

    // ConnectorSignInChangedSchema: every field as it is, but
    name: z.string().max(128),               // was McpServerNameSchema: the same bound, without the configured-name rule

Graded `machine-admin`, as the two sign-ins beside it. A dynamic connector whose name is longer than 128 characters is offered no Sign in. `connectors.signIn` and `connectors.signInServer` keep `McpServerNameSchema` for their input.

Lost: a second event for a dynamic sign-in. It is additive by the letter of the wire's rule, where loosening a refinement is a change the manifest cannot see; it lost because one operation would then speak on two events, every reader and both feed lists would carry both, and the only reader that refuses the loosened value is an older build that could never have started the operation it belongs to (§H). If the architect or the session that keeps master rules for the letter, the event becomes `connectors.dynamicSignInChanged` with the same shape and this paragraph is the place.

**The connector's identity.** A dynamic connector is its machine and its name:

    // src/services/connectors/sign-in.ts
    export interface ConnectorConfiguration { name: string; scope: 'user' | 'project' | 'local' | 'dynamic'; cwd: string | null }   // dynamic: cwd null
    // connectorKey: 'dynamic' is keyed as 'user' is, with no folder

    // customize/connectors/sign-in.ts
    export type SignInScope = PluginsScope | 'dynamic';
    export type SignInServer = { name: string; scope: SignInScope; cwd: string | null; machine?: MachineRef | null };   // signInKeyOf: 'dynamic' as 'user', no folder
    export function startSignInDynamic(server: { name: string; entry?: 'app' }, fingerprint: string | null, appSessionId: AppSessionId, bridge?: MawsBridge): Promise<void>;

`startSignInDynamic` binds its receipt as `startSignInByName` does. The dialog passes no fingerprint; Customize passes the row's (`catalog.postures` answers one for an entry of MAWS's own list), so a finished result shows on Customize's row only for the configuration it was started for, and a running one shows on both.

**The check** (`src/services/connectors/sign-in-entry.ts`), run by the operation before anything else, in the services, on the status of the session the operation then drives:

    /** Why the session cannot sign this dynamic server in, in words, or null. `own`: MAWS's own entry of the name when the press named one (null: the list has none now). */
    export function dynamicRefusal(requested: { name: string; own?: { transport: string; url: string | null } | null }, live: readonly LiveServer[]): string | null;

| the session's `mcp_status` | answer (the operation then fails `other_entry` with these words) |
|---|---|
| lists no server of the name | `that session has no <name> server` |
| lists it with a scope that is not `dynamic` | `this session uses a different <name>; start a new session to sign in` |
| `entry: 'app'`, and MAWS's list has no entry of the name now, or the listed server's transport or address is not the entry's (compared as `entryRefusal` compares a file entry's: `streamable-http` is `http`; an address written with `${…}` is not compared) | the same sentence |
| otherwise | null |

For `entry: 'app'` the services read the entry themselves (`customization.serverEndpoints`, the entries of scope `app`); the renderer never holds an address. The engine is the last check: `mcp_authenticate` looks the name up among the session's loaded servers, so a server that left between the check and the call (a plugin reloaded) ends the operation in the engine's words.

**The redirect** is one constant in `sign-in.ts`, set from M1's verdict:

    const DYNAMIC_REDIRECT: { plugin: 'maws' | 'engine'; own: 'maws' | 'engine' } = { plugin: 'maws', own: 'maws' };

`maws`: MAWS's loopback listener, as for a file-scope connector. `engine`: `mcp_authenticate` is sent with no redirect, the engine keeps its own `localhost` listener, and the operation's existing path for that scheme watches the status. A plugin's server is one whose name starts `plugin:`.

**Who offers Sign in.**
- *The Connectors dialog* (a session MAWS runs): a row whose status is `needs-auth` and whose scope is `user`, `project`, `local` (through `connectors.signInServer`, unchanged) or `dynamic` (through the new command). Not for `claudeai` or a managed scope.
- *Customize › Connectors › My items*, a row of MAWS's own list (`scope === 'app'`), when `signInViewOf` offers a sign-in for it: Sign in while a session is chosen, else `CONNECTORS.openSession(null)`, "Open a session, then sign in". The session chosen: the page's attached session when it is ready and its status lists the name; else the first ready session MAWS runs on this Mac whose status lists the name, one in the page's folder first, then by id. The services' check decides; this choice only picks whom to ask.
- Settings › MCP servers offers none.

**The route to another machine, until U11b** (reported, point 3). One entry in U9's `REMOTE_UNAVAILABLE`:

    'connectors.signInDynamicServer': notYet('signing in to a connector from a plugin or from MAWS’s own list'),

so the control reads "Not on another machine yet: signing in to a connector from a plugin or from MAWS’s own list", disabled, through `useRemoteUnavailable(appSessionId, 'connectors.signInDynamicServer')`; nothing is sent, and `test/lane-b/offer-coverage.test.ts` passes. A file-scope row beside it keeps its Sign in, and the words a machine's own listener gives ("sign in on <machine>") are today's. A machine reached over a socket link (development and `e2e/machines.spec.ts`) is not greyed by that helper and takes the command or answers `unknown_command`. U11b removes the entry and makes the insertions U9's document lists (its Interfaces 2), with UC-7.5's update sentence for a machine that does not list the capability.

### §B. Org copy (M2)

`ORG` in `settings-tab/copy.ts`, exact, with the file's typographic apostrophes:

| key | reads |
|---|---|
| `grantRefusals['signed-out']` | This Mac isn’t signed in to the org. Sign in under Org, then try again. |
| `grantRefusals.damaged` | This Mac’s record of the grants it issued is damaged and can’t be repaired here, so it signs no grant. Sign from another device of the machine’s owner (an admin’s, for a machine the org owns). |
| `grantsDamaged` | Grants can’t be signed on this Mac: its record of the grants it issued is damaged. Sign them from another device of the machine’s owner. |
| `grantRefusals.storage` | The grant couldn’t be saved on this Mac. Try again; if it keeps failing, check the disk’s free space. *(reported, 8b; the child's line adds ", so nothing was sent")* |
| `grantRefusals.invalid` | The rights were sent wrongly (one was named twice). Close this sheet and choose them again. |
| `grantRefusals.ineligible` | This Mac can’t sign this grant. Sign it from another device of the machine’s owner, or resolve: |
| `grantRefusals['ledger-unread']` | The machine’s grants for this person couldn’t be read, so nothing was signed. Try again in a moment. |
| `grantRefusals.refused` | The signed grant didn’t verify against the org state held now. Nothing was kept or sent: sign again. |
| `enrollProblems['not-yours']` | Another admin started this enrollment, and the hub answers only to them. Ask them to finish it, or Start over to enroll the machine yourself. |
| `enrollProblems['machine-names']` | That name is bound to another machine for the life of the org. Start over with a different name. |
| `enrollRefusals.shape` | A machine name is up to 63 letters, digits, dots, hyphens or underscores, starts with a letter or digit, and is not "hub" or "legacy". |
| `enrollRefusals['prefix-names-machine']` | That name starts with a delegation’s prefix, which is kept for the machines that delegation certifies. Choose a name outside it. |
| `enrollRefusals['no-machine']` | The org no longer lists this machine. Close this sheet and enroll it as a new machine. |
| `enrollRefusals.refused` | The hub refused the enrollment. Try again; if it is refused again, sign in to the hub again under Org. |
| `rightLines['machine-admin']` | Connect, sign in and disconnect its connectors, and choose the connector tools its dashboards may use. *(reported, 7; the child's line: "Change its settings, connectors and plugins, and restart it.")* |

**What follows a refusal's line.** The line, then main's detail unless the table says otherwise; `ineligible`'s list is drawn once, after its line. Main's string changes only where the last column says.

| sheet | reason | after the line | main's string |
|---|---|---|---|
| grant, re-grant | `signed-out`, `damaged`, `cancelled` | nothing (main gives none) | — |
| | `busy`, `invalid`, `no-change`, `stale`, `none` | nothing: the detail repeats the line | unchanged |
| | `ineligible` | the list | unchanged |
| | `ledger-unread` | the detail: which ledger, and why | loses ": try again shortly" at its one site |
| | `refused` | the verdict's code | becomes the code alone |
| | `storage` | the detail: what could not be written, and whether anything was sent | unchanged |
| enroll (a refused start) | `not-root`, `not-admin` | nothing, as today | — |
| | `shape`, `machine-name-taken`, `certified-machine`, `no-machine`, `cancelled` | nothing: the detail repeats the line | unchanged |
| | `busy` | the detail: which attempt is running | unchanged |
| | `hub` | the detail: the sign-in ended, or the hub was not reached | loses ": sign in again to enroll" at its two sites |
| | `prefix-names-machine` | the detail: which prefix | loses its second clause (from ": a name there")  |
| | `refused` | the hub's status and code | loses its lead, "the hub refused the enrollment: " |

Every refusal still opens with `ORG.notSigned` or stands alone as today; that prefix is not changed.

### §C. The Connectors dialog (M6; its row and words consumed by M7 and M8)

**Names** (`widgets/copy.ts` unless said):

| where | reads |
|---|---|
| `WIDGET_TITLE.mcp` | Connectors |
| the frame's head, muted, after the title | MCP servers |
| `MCP.none` | No connectors |
| `MCP.list` (the list's accessible name) | Connectors |
| "+" › Connectors, the entry to the dialog (U4's `PlusMenu.tsx`) | Connectors in this chat… |
| "+" › Plugins, the entry to the dialog | Plugins in this chat… |
| the palette's description of `/mcp` (U4's `composer/mentions/widgets.ts`; `items.ts` lets this one name's declared description win over the engine's) | Connectors in this chat (MCP servers) |
| the head's sentence, once | Off here is off for every session in <place>. |
| its tooltip | The engine records it in ~/.claude.json. |

`MCP_ACTIONS.persisted` goes. The `/mcp` beside the title stays.

**Status words**, one function, read by the dialog, the terminal session's dialog, the "+" › Connectors submenu and Customize's live list:

    // widgets/connector-status.ts
    export function connectorStatusWords(status: string, opts?: { switchDrawn?: boolean }): string;

| status | words |
|---|---|
| `connected` | Connected |
| `needs-auth` | Sign in needed |
| `failed` | Failed |
| `pending` | Connecting… |
| `disabled` | nothing where a switch is drawn; "Off" where none is |
| any other | the engine's own word |

The first, second and fourth are `CONNECTORS.connected`, `.needed` and `.connecting` of `customize/connectors/copy.ts`, read from there so the words have one home. `signInViewOf` and Customize's own rows are not changed.

**The row.** One line: the switch, the name as the engine reports it, the status words, `MCP.tools(n)` when it has tools. Opened: the transport (the full command as its tooltip), `MCP.from(source)`, `MCP.scope(scope)`, an error, the tool names. `WidgetFrame` gains two optional props for the head, a muted subtitle and one line of note; both are this dialog's alone at this landing.

**`<place>`** (reported, point 5): the project's name when the session's record names a project, else the session's folder with the home abbreviated (`homeAbbreviated`), the folder being what the dialog reads today (`engine.cwd`, else the record's directory). P2 decides whether a session in a worktree reads its worktree's folder in place of the project's name; this sentence is the one place.

### §D. Before the first message (M7)

    // widgets/tab-place.ts
    export type TabPlace =
      | { kind: 'started' }                                        // the dialogs read the session, as today
      | { kind: 'remote'; machine: string }                        // an unstarted tab set to another machine: that machine's name
      | { kind: 'local'; folder: string | null; place: string };   // an unstarted tab on this Mac
    export function useTabPlace(appSessionId: AppSessionId): TabPlace;

    // customize/inventory.ts
    export function useCustomizationInventory(cwd: string | null, opts?: { enabled?: boolean }): /* the query Customize holds today, same key, with a stale time */;

- *Unstarted* is `useSetupIntent(appSessionId) !== null`. *Remote* is a spawn target for the tab (`useSpawnTarget`, as `composer/Composer.tsx` computes it) or an id whose machine is not this Mac.
- `folder` is `settingsDirectoryOf(location)` for a chosen location: the folder itself, or the repository's root for a worktree not yet made. With no location it is null: the inventory then reads the user configuration (`cwd: null`) and the plugin reads take the engine's config home, as Customize does.
- `place` is the project's name (`intentProjectName`), else the folder with the home abbreviated, else "your user configuration".

**Words** (`widgets/copy.ts`):

| where | reads |
|---|---|
| the Connectors dialog's line | Configured for <place>. Connection state, and connectors from plugins, show once the chat starts. |
| the Skills dialog's line | On disk for <place>. The chat may load more once it starts. |
| each of the three dialogs, and the Connectors submenu, for a remote tab | Shown once the chat starts on <machine> |
| the Connectors submenu or dialog with nothing configured | `MCP.none` |

**Connectors.** One row per name: the entry the engine will use (`shadowedBy`), its scope in Customize's words (`CONNECTORS.scopeOf`) where a started chat's row has its status words. No switch, no Reconnect, no Sign in.

**Skills** (reported, point 6). Customize's three groups under their headings there. "Use in chat" inserts `/<name> ` for a project's and a person's skill and `/<plugin>:<name> ` for a plugin's, `<plugin>` being the installed plugin's key up to its `@`. P3 confirms each form against the engine's own list; a group whose form it does not confirm is listed without "Use in chat", and this paragraph is the one place. No Reload.

**Plugins.** The dialog reads `folder` (the config home when null), so My items and its management work as in Customize. Its loaded line reads `FRESHNESS.notObserved` alone for an unstarted tab. The "+" › Plugins submenu keeps its two entries and lists no rows before the start.

### §E. One scrim; the gutter; names (M3)

    // sessions/ui.ts
    export const SCRIM = 'bg-bg-active';   // what every sheet and dialog dims the window with (#523); the renewal owns a scrim token

Read by `Sheet` and by the overlays of `composer/WidgetDialog.tsx`, `composer/InlineEdit.tsx`, `resume/host.tsx`, `transcript/view/rows/Divider.tsx` and `keymap/KeyboardShortcuts.tsx`. U10's `.doc-confirm-overlay` takes `background: var(--bg-active)` with no opacity (reported, 9). U7's Settings dialog reads `SCRIM`.

| where | reads |
|---|---|
| `REFUSALS['not-supported']` (`sessions/share/copy.ts`) | <machine>'s sminos can't keep a session's reach yet. Update sminos on <machine>, then open this again. |
| the Share and Add owner subtitle's tooltip | <title> · <machine> |

**The gutter** (reported, point 10), in `styles/app.css`, `@layer components`:

    .scroll-gutter { scrollbar-gutter: stable; }                                    /* a scroller with a footer aligned under it */
    .scroll-gutter-under { overflow: hidden; scrollbar-gutter: stable; }            /* that footer: it clips, so the property applies */
    .scroll-gutter-scope [data-transcript-scroller] { scrollbar-gutter: stable; }   /* the session pane's transcript, from its wrapper */

The Channel's stream takes the first and its footer the second. In `session/SessionPane.tsx` the transcript's wrapper takes the third and the composer's wrapper the second. If the e2e measurement shows Electron's Chromium reserves no gutter for a clipped box, `.scroll-gutter-under` becomes `overflow: auto` with the same property, and that is the one change.

**Names, one order** for say rows, exchange rows and to-human headers. As a row narrows: the session's title gives way first, to nothing; then the recipients' and owners' labels; then the machine chip, which keeps up to 24 characters while there is room; then the alias, drawn whole where there is room and never under 12 characters. The chevron, the count's words, "and", "to everyone" and the time never shrink. A row that cannot hold the minimums wraps to a second line. Pitfall: `flex-wrap` on the row breaks lines before any item shrinks, so the wrap must be the fixed parts moving under the names, not the names wrapping among themselves. A party's tooltip is its alias, title and machine in full, joined with " · ", a missing one left out.

### §F. The Channel's reach, entries and action (M4, M5)

**The field** (`src/shared/ipc/schema/org.ts`, on the channel's open answer and on its change, after `live`):

    reach: z.enum(['connecting', 'unreachable']).optional(),   // present exactly while the answer is open and `live` is false

**Events and transitions**, per channel in main. Reach is told with every open answer and as a change whenever it moves while the channel is not live.

| event | reach after |
|---|---|
| the channel is made; the sign-in or the hub changes; a released channel is opened again | `connecting` |
| the attestation read fails | `unreachable` |
| the socket errors, or closes before its welcome, with a code that does not end the channel | `unreachable` |
| the socket's headers do not resolve, or a close code ends the channel | unchanged |
| the socket is welcomed but has not caught up | unchanged |
| the channel becomes live | absent |
| a live channel loses its socket (a close, a missed pong, a wake) | `connecting` |

So `unreachable` stays through every retry until the channel is live, and the footer does not flicker.

**The footer**, while not live, after "As of <time>" when there is one, the first that holds:

| condition | words |
|---|---|
| not signed in | Signed out |
| the org's hub status is `expired` | The hub sign-in has ended. (with its button) |
| it is `denied` | The hub no longer admits you. |
| reach is `unreachable`, or the hub status is `unreachable` | Offline · retrying |
| otherwise | Connecting… |

`CHANNEL.offline.unreachable` becomes "Offline · retrying" and `CHANNEL.offline.connecting` "Connecting…". An open channel with no entries and no `asOf` reads `CHANNEL.noCopy`, "This Mac has no copy of this channel yet.", where `CHANNEL.empty` stands today.

**The Channel's entries** (`channel/project.ts`; parameters as `sidebar/menus.tsx` reads the same stores today):

    export function channelProjects(...): { project: string; name: string }[];   // every project that has a channel: a project of the hub
    export function channelOfRow(row: RowKey, ...): string | null;               // that project's channel id, or null

The palette's `PaletteEntries` gains `channels: { project: string; name: string; waiting: number }[]`, drawn as a group "Channels" after Projects and listed with an empty query as Projects are. An entry reads "<name> · channel", with "N waiting" as its muted detail when N is not zero, and matches a query that is part of that text, case ignored. Enter runs `openTab({ kind: 'channel', project })`.

**The action** (reported, point 11):

    // src/shared/keymap/actions.ts, after the rows of the Tabs submenu and before pane.split
    'channel.open': { title: 'Project channel', chord: null, sink: 'menu', menu: 'view', scope: 'app' },

View then reads: Overview, Artifacts, Tabs ▸ │ Project channel │ Split / move to other pane, … Its handler is registered exactly while the tab in front names a project that has a channel: a Channel tab's own project, or a session tab's row. That row is `sessionRow(id)` of `keymap/actions-runtime.ts` when the merged master has it (U13a), else `sessionSetKey` of `stores/org-projects.ts` as `ipc/events.ts` calls it today; the two are the same computation. Unregistered, the menu item is greyed and the palette's row reads `UNAVAILABLE['channel.open']`, "This project has no channel".

### §G. Settings (M9, M10; consumed by U7)

    // settings-tab/SettingsView.tsx
    export const SETTINGS_SECTIONS = ['appearance', 'notifications', 'keyboard', 'voice', 'browser', 'artifacts', 'sessions', 'gateway', 'engine', 'background', 'org'] as const;
    export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
    export const SECTION_TABLE: readonly { group: 'app' | 'sessions' | 'org'; section: SettingsSection }[];   // the index's and the body's order
    export function SettingsView(props: { section: SettingsSection | null }): JSX.Element;                    // fills its host; null opens at Appearance

    // settings-tab/rows.ts
    export interface SettingsRow {
      id: string;                    // '<section>.<row>': the search's result and the row's mark in the page (data-settings-row)
      section: SettingsSection;
      label: string;
      line?: string;                 // the note: one line
      more?: string;                 // behind More
      keywords?: readonly string[];  // other words people use
      revealedBy?: string;           // the row whose control makes this one drawn
    }
    export const SETTINGS_ROWS: readonly SettingsRow[];

A row whose words depend on its state declares one entry per state under the same id, so the bound and the search see every state.

**Groups and sections.** `INDEX.groups`: App; Sessions and engine; Org. `SECTIONS.background`: Background. The rows of each section, in order, are the child's table. The link reads "Customize" with the chevron beside it, and the footer is unchanged. U7 adds `{ group: 'sessions', section: 'usage' }` after Gateway and its rows to `SETTINGS_ROWS`.

**The stored section** (reported, point 12). The list in `src/shared/ipc/schema/layout.ts` is not edited and stays build F's ten. `SettingsSection` is no longer derived from it; the stored ten are all members of it, so every caller and the tab's host compile unchanged. No caller opens the tab at `background`: it is reached by the index and the search, which move the view without writing the tab, and by U7's `openSettings`, which is held for the run only. So no value F does not know can be stored, and nothing is held in memory.

**A note.** `NOTE_LINE_MAX = 86`: a declared line is at most that many characters, a state's sample values included. It stands for one line at the 580 px a note has when the body is 760 px wide; the e2e scene is the measurement, and the owner's look may move the constant. A state line is declared as one and is exempt.

**Lines and Mores** are the child's table, with these additions.

*States the table does not give:*

| row, state | the line | behind More |
|---|---|---|
| Binary, a chosen binary | New sessions start on the binary you chose. | Running sessions keep the binary they started on. MAWS was verified against Claude Code <version>. |
| Update, installed | Runs claude update in a terminal tab. | New sessions start on the new version; running sessions keep theirs. |
| Update, a chosen binary | Runs claude update in a terminal tab. | New sessions stay on your chosen binary until Use installed. Running sessions keep theirs. |
| Voice › Shortcut, unbound (the default) | Click the microphone in the composer's toolbar to start dictating, and again to stop. | A shortcut, once bound, dictates into the focused composer while you hold it. |
| Limit, a limit set | Default: 25% of physical memory. | Past it the least recently used idle session is released. Send resumes a released session. |
| Exit when idle, never | Never · the supervisor keeps running after its last session ends. | Even with MAWS closed. |

*Lines that may not fit.* A line over the bound moves its last sentence or clause behind More, words unchanged but for the capital and the full stop the cut needs. Applied at authoring, to be confirmed by the look:

| row | the line | joins More, first |
|---|---|---|
| Limit, default | Default: 25% of physical memory (<size>). | Past it the least recently used idle session is released. |
| Messages to you | Agents message you and ask questions you answer in place. | A session reads as their report. |
| Per-session Direct (not in the child's table) | The relay card's Run direct stays either way. | Direct is the fallback when the relay is unreachable. |
| Browser › Profile (not in the child's table) | Applies to tabs opened from now on. | The address bar shows which profile a tab browses with. |

*Where each old note went*, for the reviewer of M9: every note of today's `copy.ts` is in the child's table or the two tables above, or keeps its words on one line. Said once under Sessions' heading, "For sessions MAWS runs. Terminal sessions and your Claude Code settings files are not changed.", and so gone from each note: that a setting never reaches a terminal session, and that the person's own settings files are never changed. Dropped: Config home's "MAWS reads them and keeps its own index elsewhere" (the chip says it), and the Plugins paragraph row with its sentence.

**More.** A text button at the line's end, "More", "Less" while open, with `aria-expanded`. Closed, its text is not in the page. The search reads the table, not the page.

**Search** (`settings-tab/search.ts`):

    export interface SettingsResult { id: string; label: string; section: SettingsSection; target: string; openMore: boolean }
    export function searchSettings(query: string, input: { rows: readonly SettingsRow[]; bindings: readonly { id: string; title: string }[]; orgGroups: readonly string[] }): SettingsResult[];

Every word of the query must be found, case ignored. A row matches by its label, line, More, keywords, its section's name and its group's name. A section's name is a result of its own and stands before its rows. A key binding is a result by its action's title alone, so the word "keyboard" lists the section and its two rows, not sixty bindings. An Org group's heading is a result by its own words. The Customize link is a result, with plugins, skills, connectors and marketplace as its other words. Results stand in the page's order and read "<label> in <section>", "in <section>" muted. `target` is the row to scroll to: the row itself, or the row that reveals it. `openMore` is true when the query's words are found only with the More's text. No match reads `INDEX.noMatch`, "No matching settings". The field's label and placeholder are `INDEX.search`, "Search settings".

Keywords at least: connectors, integrations and tools for MCP servers; shortcut and hotkey for the key bindings; dark and light for Theme; relay, account and direct for the Gateway rows; RAM for the memory budget.

### §H. What is stored or sent, and what build F does with it

This landing stores no new key, so it adds no row to the cross-build coverage table (U13a's M5). It moves a row that table's settings scene drives (Constraints; Proof, P7).

| stored or sent | this landing | build F meeting this landing's value | this landing meeting F's value | this build, then F, then this build |
|---|---|---|---|---|
| `settings.json`, `machine-settings.json` | no key, value, default or version changes; a moved row writes the field it wrote | reads and writes them as master's | the same | unchanged at every step |
| `layout.json`, the Settings tab's `section` | writes only the ten values F knows, by the unchanged callers | parses it | every one of F's ten is a section here | unchanged |
| the command `connectors.signInDynamicServer`; the wire's minor, one higher | sent by this build's app to this Mac's daemon | a daemon on F answers `unknown_command`: the row reads a sign-in that did not finish, in the transport's words. An app on F never sends it. F reads no minor. | — | a daemon outlives the app that started it until it is idle, so each pairing can occur; both are covered by this row |
| the event `connectors.signInChanged`, its `name` now any string up to 128 | emitted by this build's daemon with a dynamic connector's name | every reader on F drops an event whose name fails F's rule and logs one line (`host-supervisor.ts`, `socket-link.ts`, `remote-artifact-feed.ts`). F cannot have started that operation, so it has nothing to bind the event to. It can occur when F's app starts within the five minutes a sign-in this build began is still waiting. | F emits only configured names, which read here | no state is left by a dropped event |
| the engine's credential for a signed-in connector | the engine writes it to the Keychain, keyed by the server's name, type, address and headers; MAWS stores nothing | F's sessions run the same engine and read it connected | the same | unchanged |
| `~/.claude.json`, a disabled connector | the engine's `mcp_toggle`, as today | as today | as today | unchanged |
| the channel's `reach` | from main to this app's own windows, one build at both ends; not stored, not on the wire | never sees it | — | the channel's cache file is not touched |
| `channel.open`, a rebinding | not storable: U6a's guard keeps an id F does not know out of `settings.json` | — | — | — |
| the machine link (RL2) | nothing new crosses it | — | — | U11b's |

A member who holds `machine-admin` on this machine and is connected from another device hears the sign-in event as today. It can now carry a plugin connector's name, which that member can already list (`connectors.servers`).

### §I. Dependencies on other landings

Consumed, by the name each is exposed under:

- **U6a** (must be on master before M5): the row's shape and "table order is menu order" (its Interfaces A, B, G); `paletteEntries(query, input, table)`; `WAVE_DEFAULTS`, which already holds `'channel.open': null`, and `LANDED`; `isRebindable`, by which the new row takes no rebinding and this landing does nothing for that; its insertions in this child's files, which M9 keeps as they are (`KeymapRow.rebindable` and the one condition in `KeymapSection.tsx`; `KEYBOARD.hint` without its first clause); and UC-6's focus-first rule as that document builds it, by which a region that handles a menu row's chord itself keeps it (M10's ⌘F).
- **U13a** (either order): `activeTab(state.main)`, and `openTab(target)` bringing an open tab forward (its §F); `sessionRow` when it is on master (§F above); its insertion in `customize/CustomizeView.tsx`, the file M7 takes the inventory's query out of (whoever lands second merges); its cross-build settings scene, which must find the idle-time row by the row's own label, since this landing moves it from Engine to Background (whoever lands second sees to it).
- **U9** (either order; before U11b): `REMOTE_UNAVAILABLE` and `useRemoteUnavailable`, whose signature its document keeps. If U9 has landed, its `disabledWords` answers a declared command's words first, so §A's sentence reads the same.
- **U8a**: nothing consumed. Its tree test fails on a new spelling of a session's folder: M6 and M7 read the folder as the dialogs do today (`engine.cwd`, else the record's directory, a spelling the test counts as zero) or through `useWorkingFolder`, and add no other.
- **U3a, U8b**: nothing consumed. `transcript/view/Transcript.tsx` is not edited; U8's Connectors card is not edited.

Exposed to siblings: `SCRIM`; `SETTINGS_SECTIONS`, `SettingsSection`, `SECTION_TABLE`, `SETTINGS_ROWS` and `SettingsView` (U7); the search field's `data-escape-clears` mark (U7's dialog lets a field that holds text clear first); `connectors.signInDynamicServer`, `startSignInDynamic` and `SignInScope` (U11b, X-184); `connectorStatusWords` (U8's card may adopt it); `useTabPlace` and `useCustomizationInventory` (#476's lists); the three gutter classes; `channel.open`.

When U3's Find lands, ⌘F is a menu row's chord; its scene "while the Settings dialog is open ⌘F focuses its own search" is where the pair is proved together.

## Proof that an executor does not run

Each line has an owner other than an executor. The controller writes into Progress when a line's precondition is met.

| | what | when it can start | what it needs | what comes back, and what it decides |
|---|---|---|---|---|
| P1 | **A dynamic connector's sign-in through MAWS's redirect** (law 6; the child's Probes) | after M1 is pushed | The `discover` e2e group in a gate job on the Mac mini runner, with `MAWS_SIGNIN_SPIKE=1` in the job's environment so that the case "spike: …" runs (the case is skipped without it, and the gate has no way to set it today: that is the architect's to arrange with the session that keeps master). Engine 2.1.322 on the runner. Never the MacBook, in any form. | For `dynamic` and for `plugin`: the scheme answered, each step's answer, the final status and the next process's status; the run's id. M1's criteria give the verdict, which sets §A's `DYNAMIC_REDIRECT` or takes a kind back to the design. M8 starts after it. |
| P2 | **Where the engine records a switched-off connector for a session in a linked worktree** (law 6; point 5) | any time before M11 | A wire probe on the wave's probe VM, engine 2.1.322, scratch config home: a scratch repository with one linked worktree, a session in each, `mcp_toggle` off, then the key of `projects` in the scratch `.claude.json` that holds `disabledMcpServers`. No Keychain is involved. | The key for each case. The repository's root for both: §C's `<place>` stands. The worktree's own folder: a session in a worktree reads its folder as `<place>`. Anything else: back to the architect. |
| P3 | **A skill's name on disk against the engine's name for it** (law 6; point 6) | any time before M11 | A wire probe on the same VM: a person's skill and a project's skill, each once with a front-matter name equal to its folder's and once different, and a plugin's skill; the engine's own skills list read beside the inventory's rows. | Per group, whether §D's inserted form is the engine's name. A group it does not confirm loses "Use in chat" before the first message. |
| P4 | **The 45 seconds of "Reading the channel…"** (S-09; the child's Probes) | after M4 is pushed | A Mac other than the MacBook on this branch's build, signed in to an org, the network turned off: one Channel tab that has a cache and one that has none; the time `org.channel.open` takes to answer, and what the body and the footer read. An agent on the mini, or U14's sitting. | The answer comes at once: A13 as built. It is late: what it waited on, which M4 then fixes in main (its last decision). |
| P5 | **The owner's look at the regrouped Settings** (root, "Looks the owner is asked for") | now; M9 waits for it | The drawn example of the next section, built by the architect. | The owner's answers to its seven questions. A change of order, of a group's name, of a line or of the bound is written into §G before M9 starts. |
| P6 | **The e2e scenes** on a Mac under the load rule | after M11's hand-back; a milestone's own scenes as soon as it is pushed | The new and reworked scenes alone first: in `e2e/channel.spec.ts` the edges, the 420 px column, the footer's words and the palette and menu scene; in `e2e/composer.spec.ts` the session pane's edges under classic scrollbars; in `e2e/share.spec.ts` the scrim and the sentence; in `e2e/widgets.spec.ts` the three edited Connectors scenes and the unstarted-tab scene; in `e2e/settings.spec.ts` the regrouped page, each note's height, More and the search. Then the groups that hold what this change reaches: `settings` (which also runs the org page, the Channel, Share and the registry), `widgets`, `composer`, `layout`, `supervisor-daemon`, `machines`, `default`. `e2e/c11-live.spec.ts` has no gate group: its edits are typechecked and run at the next live sitting. | Verdicts by group, and the screenshots the scenes attach (the footers under both scrollbar settings; the grant sheet; the Share sheet). A red scene goes back to the controller as a fix. |
| P7 | **M8's sign-in scene, and the cross-build settings scene** | after M8 and M9 are pushed | M8's scene: the `discover` group in a gate job on the mini, with its Keychain custody as the existing sign-in case has it. The cross-build scene: one `e2e:cross-build` run with build `f1852de3a` as the peer, because M9 moves the idle-time row that scene changes through this build's Settings. | The run ids; the scene named as run and green. A skipped scene is not evidence. |
| P8 | **The branch review** | after M11 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U11a` (Decision Log). | A verdict and findings; the fixes are one wave through the controller. |
| P9 | **Class 1a** | on the head handed back; again on the final head if the panel changed the branch | Concrete Steps 7. | The run's id, which the pull request names. |

## The drawn example for the owner's look (P5)

Built by the architect before M9, as a page the owner opens, with the app's own tokens (`src/renderer/src/styles/tokens.css`) and Settings' real measures, so that whether a note fits one line is seen and not guessed: the index 148 px wide, a row's label column 168 px, the body at most 760 px, 12 px for notes. Every label, path and name in it is invented (UC-11). The words are the child's table and §G's.

**Widths.** (1) The 960 px box U7's dialog gives Settings, which is where the owner will meet it. (2) The Settings tab at the default window, 1280 px wide with the sidebar open, which is what this landing ships until U7 lands. (3) A pane about 300 px wide, a 50/50 split, where the index becomes a row of links.

**Frames.**

1. *The index and the top of the body* at widths 1 and 2, light theme: the three group headings, small and muted; the eleven sections; "Customize ›"; the footer; the body opened at Appearance. Once more in the dark theme, for the headings' contrast.
2. *Sessions*: the line under its heading; its six rows with every note closed; then the same with MCP servers' More open, which is the longest.
3. *Engine*, three rows, with the installed binary and once with a chosen binary.
4. *Background*: the supervisor running; the supervisor waiting on an older version, whose line and "Restart now" are a state and stay whole; the memory budget off; the memory budget on, with Limit and Stateful MCP servers shown.
5. *The longest lines, side by side at 760 px*: Hooks in sessions; Messages to you; Limit with its size; Update with a chosen binary; Per-session Direct; Browser › Profile; Exit when idle set to never. Each as the child's table words it, and beside it as §G's fallback cuts it, so the owner sees what one line costs.
6. *The search*: the field empty above the index; "mcp" typed, with its results in place of the sections ("MCP servers in Sessions", "Stateful MCP servers in Background"); a result chosen, its row marked; "PATH" typed and chosen, which opens Binary's More; a query with no match.
7. *Width 3*: the index as a row of links without group headings, and two rows stacked.
8. *Where later rows would sit*, drawn and marked "not in this landing": "Connector icons" as the last row of Appearance; a default model and mode under Engine.

**What the look should answer.**

1. Everyday preferences first and the engine last, or the engine first as today?
2. The three groups and their names; Org is a group of one section with the same name: keep it as a group, or let Org stand without a heading?
3. What Sessions holds, and the one line under its heading.
4. "Background" as the name for the supervisor and the memory budget.
5. One line and "More" in place: for the lines of frame 5, the cut, or shorter words?
6. A result reading "row in section", and what choosing one does.
7. The two places of frame 8.

## The pull request

Opened by the architect after the gate. Its body opens with the root's path, "U11, first landing (U11a)" and the parent pin; names its class 1a run, its review verdict and its residue (Concrete Steps 6, with what the milestones add); says that U11b holds the sign-in of a dynamic connector on another machine and waits for U9; and lists the five dated amendments it carries ("The record"). It ends with the `Sminos-Session:` line.

## Surprises & Discoveries

Found while checking the sections against the code at `48619c824`. Each is carried by a point of "Reported to the architect" or by a decision above.

- Observation: the sign-in's progress event bounds a server's name at 128 characters and holds it to a configured name's rule, which a plugin connector's name fails; the bound is on the wire's manifest and the rule is not.
  Evidence: `ConnectorSignInChangedSchema` in `src/shared/ipc/schema/connectors.ts`; `events.connectors.signInChanged` in `wire-manifest.json` reads `"name": {"type": "string", "maxLength": 128}`; `classifyWireChange` calls a changed length bound breaking.
- Observation: the renderer cannot send a configured server's address, so the check the section asks for a press from Customize has to read the entry in the services.
  Evidence: `CustomizationServerSchema` has no address; the comment above `CustomizationEndpointSchema`: "a configured URL may carry a token, so it never reaches the renderer".
- Observation: a command addressed by a session fails a tree test unless it is offered, answered by main or declared.
  Evidence: `test/lane-b/offer-coverage.test.ts`, "is exactly one of offered, answered by main, or declared remote-unavailable".
- Observation: the engine's own description of `/mcp` wins in the palette once its catalogue has arrived.
  Evidence: `slashItems` in `composer/mentions/items.ts` takes `WIDGET_COMMANDS` only for names the engine does not list; `fixtures/reads.jsonl` lists `mcp` with "Manage MCP servers".
- Observation: "Available once the session starts" is one constant read in about ten places, and the Plugins dialog's loaded line draws it too.
  Evidence: `NOT_YET` in `composer/submit/submit-state.ts`; `availabilityRefusal`'s callers; `widgets/plugins/LoadedLine.tsx` through `DormantGesture`.
- Observation: a new chat set to another machine is not in the tab's setup intent.
  Evidence: the intent's fields in `src/shared/sessions/intent.ts`; `useSpawnTarget` in `sessions/remote-spawn.ts`, as `composer/Composer.tsx` reads it.
- Observation: over the machine link a holder of `machine-admin` can act on connectors and nothing else.
  Evidence: the nine `machineAdmin` rows of `src/endpoint/offers.ts`; "A name not here is `not-offered`, graded or not".
- Observation: main's details repeat the sheets' lines for more reasons than the four the item names, and `storage` is refused both before a send and after a delivery.
  Evidence: `src/main/org/grants.ts` (`busy`, `invalid`, `no-change`, `refused`, `stale`, `storage`, and `unrecorded`); `src/main/org/enroll.ts` (`hub`, `machine-name-taken`, `certified-machine`, `cancelled`).
- Observation: ten overlays dim a window, not seven, and three of the five carry their own opacity.
  Evidence: `.doc-confirm-overlay` in `src/artifacts/document/editor/chrome.css`; `bg-bg opacity-60` in `WidgetDialog.tsx`, `InlineEdit.tsx` and `resume/host.tsx`.
- Observation: `scrollbar-gutter` does nothing on the Channel's footer or the composer's column as they are, and the transcript's scroller is shared by every transcript.
  Evidence: neither wrapper sets `overflow`; `[data-transcript-scroller]` is one element of `transcript/view/Transcript.tsx`, and `transcript.css` makes it a query container.
- Observation: nothing opens Settings at the supervisor's rows, and no caller could store a section build F does not know.
  Evidence: the callers of `openTab({ kind: 'settings', … })` and `SETTINGS_SECTIONS` in `gateway/actions.ts`; clicking the index sets the view's own state and writes no tab.
- Observation: the application menu cannot say why an item is greyed, and a row added after build F takes no rebinding.
  Evidence: `connectActions` reports the registered handlers and nothing else; U6a's document, decision 11.
- Observation: several lines of the child's table, and three notes it does not list, are longer than one line at 760 px.
  Evidence: at 12 px a note's 580 px holds about 90 characters less the More button; Update with a chosen binary is 98 characters, Limit with its size about 100, Per-session Direct 99, Messages to you 91, Browser › Profile 91.

## Decision Log

- Decision: verification for this landing. This document gets an adversarial review before an executor starts; the wave's architect dispatches it. Each milestone is reviewed at its boundary by the controller's reviewer before a milestone that consumes it starts. The branch gets `doperpowers:review-code` at the xhigh panel: it is expected to change about 105 files and 6,400 lines (about 55 product files, 38 unit-test files, 8 e2e files, 5 documents), well past the mark of twenty files or two thousand lines. The root calls nothing in U11 delicate; three parts still want a lens of their own: the sign-in's check and the wire (M8, §A and §H), the channel's reach (M4, §F's table), and the regrouped Settings against the three `keep` items (M9). Class 1a on GitHub Actions (`static,unit,probes`) is the gate of record, run by the architect on the head handed back and again on the final head if the panel changed the branch. The pull request's body names its class 1a run, its review verdict and its residue, and carries the dated amendments of the five rulings this landing reverses.
  Rationale: the root's UC-10 and the common brief of the wave's execution documents.
  Date/Author: 2026-11-12, the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
