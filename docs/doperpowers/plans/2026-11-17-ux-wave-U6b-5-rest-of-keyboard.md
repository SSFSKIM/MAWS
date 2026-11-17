# UX wave · U6, the fifth landing of U6b (U6b-5): the rest of the keyboard

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), its landing **U6b-5** (board ticket 674, under ticket 592). **Parent pin:** the branch head `bdbfe863e6b2f59031c10f0c51873c4a0210b00b`, the commit every statement about the code below was checked against: master as it stood on 2026-11-17 (`77af813a4`; the branch's merge base `5d4a8d3a0` differs from it by one line of the debt tracker) plus the eight landings of the chain's fourth batch, which are in review and not on master. The root and the child's file are read at that commit.
>
> **What is settled before this document:** the cut, `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, section "U6b-5", its Decision Log 6, 7 and 9 and its "Points reported to the architect, and ruled" (X2, X3, X4, X6, X8), cited below as *the cut*. This document carries the constraints and the milestones; the design is the child's file and the cut. Where the code at the pin contradicts either, the point is in "Reported to the architect, for ruling" with the default that is built and the one place a ruling changes.
>
> **Branch:** `ux-wave/U6b-5`, from `bdbfe863e`. **Not in this landing:** Go to file and its row `files.goToFile` (U6b-3, which is not in the chain yet); links, notices and "Open in" (U6b-4); a bottom drawer; a printable sheet; history across relaunches; pinch to zoom; a size per session or per surface.
>
> **Before an executor starts:** the adversarial review of this document; the architect's rulings on P1 to P10; the architect's word on one pull request or two ("Size and review"). The four cards hold nothing: each has a built default.

## Purpose

After this landing the keyboard reaches what the wave built and comes back from it. A side surface shown by its key has the keyboard, and hidden by its key gives the keyboard back to the composer. Text selected in a terminal goes into the chat of that terminal's session with ⇧⌘L or from the terminal's menu, as one pasted block, and is never sent by itself. ⌘[ and ⌘] walk the places the window has shown. ⌘= and ⌘− make the whole window larger and smaller, View ▸ Actual Size returns to 100 %, and the size survives a relaunch. ⌘K opens on what was used last and finds artifacts. A change of the permission mode with ⇧Tab is said to a screen reader. The shortcut sheet has its six missing rows.

How to see it working: the acceptance below, B1 to B14. The unit half runs on the build VM; the scenes run on a Mac, and three checks are the owner's own.

## Progress

- [x] (2026-11-17 07:30Z) The cut's section, the child's items and the ticket read against the branch head; the named question answered from the code; three reference readings made (the window's coordinate crossings with main, the tests and scenes that pin today's behaviour, Claude Desktop `app-5.1231.2` for the five acts).
- [x] (2026-11-17 07:44Z) This document written: ten points for ruling, each with its built default; four cards; seven milestones.
- [ ] The adversarial review of this document, and the architect's rulings on P1 to P10 and on one pull request or two.
- [ ] M1 — Spike: what Chromium keeps of a window's zoom, and where the six placements land (the harness on the build VM; the probe scenes on a Mac, run by the architect). Its verdict gates M6 and nothing else.
- [ ] M2 — The keyboard on show and hide, and the mode said aloud.
- [ ] M3 — "Attach selection to chat".
- [ ] M4 — Back and Forward.
- [ ] M5 — The palette: Recent, Artifacts, ranking, no row that cannot run.
- [ ] M6 — Zoom (after M1's verdict).
- [ ] M7 — The scenes, the cross-build row, the record, and the acceptance run.

## Words used in this document

- **Build F, build M.** The two older builds that bind (root UC-14, and the architect's rule for this wave's later landings that two older builds bind, not one): build F is `f1852de3a`, kept as the build to go back to; build M is `2c7044231`, the build every machine runs. Both are read with `git show <sha>:<path>`. Both run Electron 44.4.5, as this branch does.
- **A side surface, the side column.** A tool shown beside the transcript (Terminal, Review, Files, Browser and the others), as a tab of the side column (`src/renderer/src/panel/`).
- **A focus request.** The counter by which the side column asks a tab to take the keyboard (`requestFocus` in `panel/host.ts`; `PanelToolContext.focusRequest` in `panel/tool.ts`). A tool answers it or not.
- **F6's stop.** The element F6 lands on for a region (`regionStops` in `src/renderer/src/keymap/shell-navigation.ts`): for a side tab, the first control of its panel, else the panel.
- **A pasted block.** The composer's atom for pasted text (`PASTED`, `pastedNode` in `src/renderer/src/composer/editor/doc.ts`): one chip in the box, sent to the agent in the terminal's pasted tags.
- **The store path.** How a pasted block reaches a session whose composer is not mounted: it is appended to the session's stored draft (`session.drafts.get`, `session.drafts.set`) and nothing is said before the store has answered.
- **A cleared draft.** What a send or a clear leaves in the draft store: a row with no document and a stamp of its own (`CLEARED` in `src/services/index/drafts.ts`). The window's read of a session on this Mac answers it as "no draft", without the stamp.
- **The claim form.** The value `DRAFT_CLAIM` of `session.drafts.set`'s `replaces`: the save is taken only where no draft with a document is kept, whether none was ever written or one was cleared. Build M's store knows it; build F's reads it as a revision it does not hold and refuses the save as stale.
- **A place.** What Back and Forward walk: a main tab, a page (Customize, Projects, the Library), or the Overview over one of these. A side surface, a file open beside the chat and the Settings dialog are not places (the child's file, l7-shell-09).
- **The record.** The list of places the window has shown in this run, with the entry the window is at. It lives in the window's memory and is never stored.
- **A step.** One Back or one Forward.
- **The factor.** The window's zoom: 1 at 100 %. **A window point** is the unit native placement takes (`setBounds`, a native menu's position); **a CSS pixel** is the unit the page measures in. At factor f one CSS pixel of the app's page is f window points.
- **Isolated zoom.** Electron's zoom mode in which a web contents zooms by itself and shares its level with no other page of its origin (`webContents.setZoomMode('isolated')`, and `zoomMode` in a window's `webPreferences`).
- **The chain's fourth batch.** The eight landings on this branch that are not on master yet. "Statements to check again" lists what this document assumes of them.

## The landing's edge

**In.**

| the child's item | what this landing builds of it | acceptance |
|---|---|---|
| l5-code-08, its rest | a surface shown by its key takes the keyboard on every path and gives it back to the composer when hidden; "Attach selection to chat" in the terminal's menu and on ⇧⌘L | B1 to B5 |
| l7-shell-06 | ⌘K: Recent, Artifacts, ranking, no row that cannot run | B6 |
| l7-shell-09 | Go ▸ Back and Forward, ⌘[ and ⌘]; the file editor gives up the two chords | B7, B8 |
| l7-shell-13, its rest | the mode change said aloud | B9 |
| l7-shell-08 | zoom, its stored factor, the six placements that follow it | B10 to B12 |
| UC-6's six rows | `terminal.attachSelection`, `go.back`, `go.forward`, `zoom.in`, `zoom.out`, `zoom.reset` | B13, B14 |

**Not in**, beyond the header's list: any change to which tab the strip shows after a close (U13's model; card K1); any change to what Esc or the page's own Back does (U7's; card K2); a control on screen for the zoom (the child's "Not included"; card K3); any change to how a pasted block reads to the agent (board ticket 733, whose design is not written).

**Left over, each for a ticket or a later landing.** ⌘+ (⇧⌘=) is not Zoom In: a row has one chord (UC-6), and Claude Desktop's second accelerator for it would be a second list of keys. The layout's breakpoints read the window in CSS pixels, so a zoomed window meets them at a wider size in points (card K3 shows it); the window's minimum size does not follow the factor. The label of an attached block is a paste's ("Pasted text #1"); naming it by its terminal waits for ticket 733's design of pasted content.

## What the code holds today

Each statement was read at the pin. "The cut" names the cut's decision of that number in its section "U6b-5".

| # | what the cut or the child's file says | what the code holds | where |
|---|---|---|---|
| 1 | The six rows are missing | So. The table's test already names their chords under "U6b" and holds a row to them from the landing that adds it; its comment "U6b adds its seven" counts `files.goToFile`, which is U6b-3's | `WAVE_DEFAULTS` and `LANDED` in `src/shared/keymap/actions.test.ts` |
| 2 | None of the six takes a rebinding while build F can be gone back to | So: none is in build F's list, and `isRebindable` reads that list | `src/shared/keymap/build-f.ts`; `isRebindable` in `actions.ts` |
| 3 | Terminal and Review take the keyboard when the column opens (the cut, 7) | **Only Terminal does**, and a mod's pane. Review reads its scope again on a focus request and takes no keyboard. Files answers no focus request. The request is made when the column goes from hidden to shown and by `panelHost.selectTab`; `toggleSurface` on an open column calls `showSurfaceTab` and asks nothing | `takeFocusRequest` in `tools/terminal/TerminalView.tsx`; `ReviewShell.tsx` (the effect over `focusRequest`); `engine-surface/PaneTool.tsx`; `connectPanelHost` in `panel/host.ts`; `toggleSurface` in `panel/SurfaceRow.tsx` |
| 4 | Nothing gives the keyboard back | So. Hiding with a surface's key hides the whole column (`hideSurfaces`), both groups | `toggleSurface` |
| 5 | A chord pressed in a page of the in-app browser must name its action in `SHELL_FOCUS_ACTIONS` to move the keyboard | So; the list holds no `surface.*` id | `src/main/menu.ts` |
| 6 | The terminal's menu has four items; a new one needs one read on the renderer interface | So: Copy, Paste, Select all, Clear. The interface has `hasSelection` and `getSelection`; its probe reads a row of the whole buffer but not where the viewport stands, so "what the screen shows" has no reader | `ContextMenu` in `TerminalView.tsx`; `TerminalRenderer` and `TerminalProbe` in `src/renderer/src/terminal/renderer.ts` |
| 7 | A terminal belongs to a session | So: the registry's entry holds `info.appSessionId`, given at `terminals.open`. Which terminal holds the keyboard is read today only for Select All, by the entry whose container holds `document.activeElement` | `ensureTerminal` in `tools/terminal/index.ts`; `selectAllFocused` in `terminal/registry.ts` |
| 8 | Since U4a a paste under 20,000 characters stays inline, and the atom's maker is private (the cut, 6) | So: `classifyText`, `PASTE_INLINE_MAX_CHARS = 20_000`; `insertPasted(text, name)` is a private method that does nothing while a submission is in flight and answers nothing | `composer/editor/paste.ts`, `controller.ts` |
| 9 | The attach reads the stored draft, appends, and saves naming the draft it replaces (the cut, 6) | **The read hides what the save must name.** For a session on this Mac `session.drafts.get` answers a cleared draft as none, without its stamp, and a save naming none is refused as stale wherever a draft was ever cleared, which is every session that has sent a message. The claim form is the value that means "no document kept". Over the machine link the read answers the cleared draft with its stamp | `register('session.drafts.get', …)` in `src/services/index/register.ts`; `DraftStore.set` in `src/services/index/drafts.ts`; `readKept` in `src/renderer/src/lane-b/remote-drafts.ts` |
| 10 | A composer exists for each session (the child's file, "Routes") | A composer is mounted only for the tab in front of a pane, the split's card and the floating card: `Pane` mounts its active tab's body alone. A pinned terminal beside another session belongs to a session with no composer mounted | `TabBody` in `src/renderer/src/main/Pane.tsx`; `focusTargets` in `stores/composer.ts` |
| 11 | Nothing records places; one subscriber over the place in front (the cut, 2) | So. `placeOf` answers `'settings'`, `'page:<kind>'` or the id of the tab in front; the tab in front changes when the other pane of a split is focused, which the cut says records nothing | `placeOf`, `frontOf` in `stores/layout.ts` |
| 12 | The page's own title-bar Back becomes this Back (the cut, 2) | The button calls `closeDestination`; its comment says U6b's history takes it over. **Three cases keep it from being a step:** a page restored at a relaunch is the record's first entry and has nothing before it; a page opened from a page would step to that page while Esc, which the button's title names ("Back · Esc"), shows the tabs; and a scene pins that the button under an open Overview closes the page and leaves the Overview | `PageTitle` in `app/Toolbar.tsx`; `e2e/shell.spec.ts`, "the Overview over a page" |
| 13 | The Overview is a dialog over the strip (the cut, 3) | So: `overviewOpen`, set by the toolbar's button, by `tab.overview` and by Esc; an act inside it that changes the strip closes it in a second store write | `setOverviewOpen` in `stores/layout.ts`; `overview/OverviewPanel.tsx` |
| 14 | The file editor's `defaultKeymap` holds the two chords | So, whole: `keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])`. No unit test and no scene presses them in a file | `tools/code/editor/editing.ts` |
| 15 | The palette lists actions it cannot run, greyed, from a table of reasons in which U1 and U4 have entries (the cut, 8) | So, and U11a has one too (`channel.open`). Sessions are found by the sidebar's rule, actions by a substring of the title; nothing is ranked | `UNAVAILABLE`, `paletteEntries` in `palette/CommandPalette.tsx` |
| 16 | Artifacts are asked with `library.list`'s `query`; nothing new is sent (the cut, 8) | So, at this build, build M and build F alike: the filter's `query` and the offer exist in all three | `LibraryFilterSchema` in `src/shared/ipc/schema/library.ts`; `src/endpoint/offers.ts` |
| 17 | Where an artifact link opens it | A main tab that already shows it is brought forward; else it opens beside the chat of the link's session. The side column reads an artifact on the session's machine when the session is on another machine | `showOpenArtifactTab` in `library/actions.ts`; `openArtifactInPanel`; `sessionArtifactMachine` in `artifacts/machines.ts` |
| 18 | ⇧Tab changes the mode and nothing announces it | So. The composer has no `aria-live` region; its `role="status"` lines say other things (the setup's phase, a send on its way, the prompt history). `mode.set` answers when the change has been answered | `Composer.tsx` (the binding of `composer.cycleMode`); `ChipBinding.set` in `composer/frame/bindings.ts` |
| 19 | Four placements assume a CSS pixel is a window point (the cut, 4) | **Six do.** The four, and: the traffic lights, placed in window points in a toolbar 44 CSS pixels high, with 78 CSS pixels kept clear for them; and the device-size box of the in-app browser (U12a), which sizes the page's element in CSS pixels to give the page a viewport of that many window points. Mark up's still already multiplies by the page's factor. No shared helper exists | the table in Interfaces §G |
| 20 | The in-app browser's view is placed again when its rectangle changes | The window sends a rectangle only when it differs from the last one sent, so a change of factor that leaves a pane's CSS rectangle as it was sends nothing | `Placement.measure` in `tools/browser/placement.ts` |
| 21 | The presenter's window and the repair window load the app's own origin and would inherit the zoom (the cut, 4) | In a build the three pages are three `file:` URLs in the default session (the window's page, the same page with another query, another file); in a development run all three are on one host. Whether they share a zoom is not shown by any file of the repository: M1 measures it | `createWindow` in `src/main/window.ts`; `openPresentWindow`; `repairLaunch` |
| 22 | Whether Chromium keeps the zoom by itself is not known (the cut, 5) | Not known. What the cut did not have: Electron 44.4.5 has isolated zoom, which is not shared by origin. No code of the app's own page sets or stores a zoom today; the in-app browser's tabs store theirs in their own file and never apply it at a restore | `electron.d.ts` (`setZoomMode`, `zoomMode`); `Navigator.zoom` in `src/main/browser/navigation.ts` |
| 23 | Zoom cannot be stored in `window.main` (the cut's X2) | So: both older builds parse it strictly. Both keep every key of `layout.json` through their own writes, list keys as plain strings, and refuse the window a key their schema does not name | `WindowStateSchema`; `LayoutFileStore` in `src/main/layout/store.ts`, at `f1852de3a` and `2c7044231` |
| 24 | F6 needs nothing (the cut, 10) | So | `regionStops` |

## The named question: can a terminal belong to a session that has not started?

**Yes, in two ways, and for one of them lastingly.**

A session has not started while the window holds a setup intent for it and not both a record and an engine status (`useSetupIntent` in `src/renderer/src/sessions/useSetupIntent.ts`). Its draft is then kept in the intent and not in the draft store (`useDraftPort` in `composer/Composer.tsx`).

1. *Before any start, no.* The Terminal surface can be shown on a tab that has not started: the side column knows any session the layout retains, and a tab with an intent is retained (`retainsTab` in `sessions/connect.ts`). But a Terminal tab starts its shell only once it has a folder, which is the record's working folder (`ensureTerminal`: `cwd = params.cwd ?? workingFolder(shown.session).path`), and a session with no record has none. The tab reads "terminal pending" and holds no terminal, so there is nothing to select.
2. *While it starts, yes.* The setup makes the record at its `launching` step, before the engine is launched ("the record first", `createForLaunch` in `src/services/sessions/setup.ts`), and removes the intent only at `finishBinding`, after the engine is ready and the first message is handed over. From the record's arrival until the engine's first status the session has a record, so its Terminal tab starts a shell, and it still counts as not started.
3. *After a start that failed, yes, and it stays so.* When a launch fails before a transcript exists, the rollback removes the record and keeps the intent (`rollbackIntent`, step 2). The window drops a removed session's side tabs only when nothing retains its tab (`!currentTabRetention()?.retains(id)` in `src/renderer/src/ipc/events.ts`), and the intent retains it. So the shell that started in case 2 keeps running, in a tab of a session that has not started and has no record again.

**What is built** (the cut's Decision Log 9, as ruled): on the store path an attach for a session that has not started is refused with a sentence, and nothing is confirmed. Where that session's composer is mounted, the attach is what a paste there is: the composer's own editor takes the block, and its draft goes where that composer keeps it (the intent). That second half is point P3.

## Reported to the architect, for ruling

Each point has the evidence, the default this document builds, and the one place a ruling changes. None waits for the owner; what is the owner's is a card.

| # | The point | Evidence | The default that is built | The one place |
|---|---|---|---|---|
| P1 | **Review takes no keyboard on a focus request**, and Files takes none; the cut says Terminal and Review do. Giving Review the keyboard in its own element is an insertion in U5's `ReviewShell.tsx` that no table names | row 3 above | A surface shown by its key gets the keyboard in two steps: the tool's own answer to the focus request where it has one (Terminal; Files, written here in U6's own `FilesTool.tsx`; a mod's pane), and else F6's stop for that tab. Review, Browser and the rest land where F6 lands today. No file of U5's is edited | `focusShown` in `panel/SurfaceRow.tsx` (Interfaces §B) |
| P2 | **The cut's store path names a value the store refuses.** On this Mac a save naming "none kept" is stale on any session whose draft was ever cleared | row 9 above | The save names the revision of what the read answered: a draft's, or over the link a cleared draft's stamp. Where the read answers none, it names none over the link (there "none" means never written, in all three builds) and the claim form on this Mac (where "none" also hides a cleared draft). A daemon of build F on this Mac answers the claim form as stale, twice, and the line says the selection was not added; that pairing lasts only while an updated app still meets the older daemon | `replacesOf` in `composer/attach-pasted.ts` (Interfaces §C) |
| P3 | **The named question's answer is yes**, and the ruling's refusal is read here as the store path's: a mounted composer of a session that has not started takes the block as it takes a paste | "The named question" | Refused on the store path only | `notStarted` in `attach-pasted.ts` |
| P4 | **A mounted composer's save is not always the store's answer.** For a session on another machine the composer's port takes an ordinary save in hand and sends it in the session's order; its answer is "taken", not "kept" | `rememberingRemoteDrafts.save` in `composer/editor/drafts.ts` | Where the composer is mounted and its box is covered by a card, the line is shown once the composer's own port has answered the save: the store's answer on this Mac, the port's on another machine. A reload inside that machine's round trip can lose the block, as it can lose text typed there. The store path always waits for the store | `confirmed` in `attach-pasted.ts` |
| P5 | **The title-bar Back cannot become a step** in three cases | row 12 above | The button keeps its act (it closes its page), and the record reads a page or the Overview that closes onto the entry before it as a step back. In the plain case the button, Esc and ⌘[ then leave the same record: the page is one Forward away. What differs is card K2 | `PageTitle`'s `onClick` in `app/Toolbar.tsx`; `seen`'s second rule in `keymap/places.ts` (Interfaces §D) |
| P6 | **Six placements, not four**, in files of U12, of U7 and of no child; and the browser's view must be placed again by main when the factor changes | rows 19 and 20 | All six are built, each as one multiplication or division at the narrowest place, behind one function of main's (`zoomOf`) | Interfaces §G, the table |
| P7 | **Isolated zoom changes the cut's decision 5.** If M1 shows that an isolated zoom is kept nowhere outside `window.zoom`, build F and build M show 100 % after any exit, forced or not, with no reset at quit to depend on; and the presenter's and the repair window stay at 100 % by themselves | row 22 | The window's page is made with `zoomMode: 'isolated'`; the factor is applied from `window.zoom` at every launch and after every load of the page. M1's rows decide whether anything more is needed, before M6 is built | `zoomMode` in `createWindow` (`src/main/window.ts`); M1's table |
| P8 | **`terminal.attachSelection` has a handler only while a terminal holds the keyboard.** The menu cannot see focus, and the palette holds the keyboard itself, so a row that is always enabled would be listed in ⌘K and do nothing there (A8: no row that cannot run) | `layout.setEnabledActions`; A8 | The handler is registered while a terminal holds the keyboard. Edit ▸ "Attach selection to chat" is drawn disabled elsewhere, and ⌘K never lists it | `connectTerminalAttach` in `tools/terminal/attach.ts` |
| P9 | **The palette's table of reasons goes whole**, with U1's two entries, U4's two and U11a's one, and their cases in `CommandPalette.test.tsx` | row 15 | A row is listed when it has a handler and the table lets the palette run it (not `fixed`; not a `renderer` row of scope `pane` or `composer`). "Project channel" is absent while the tab in front has no project with a channel; New chat is absent where no session can be made | `listable` in `palette/CommandPalette.tsx` |
| P10 | **The cut's size is too small.** Counted from the code: about 4,700 changed lines over about 88 files, tests and scenes included (the cut: 2,600 over 55) | "Size and review" | Written as one document whose zoom milestones (M1, M6 and M7's zoom part) can be cut off as a second pull request with no edit to the others | "Size and review" |

## Decisions settled at authoring

Each is a means the child's file and the cut leave open, with its reason and what it beat. The shapes they name are in Interfaces.

**The keyboard on show and hide (M2).**

1. **One rule for every way a surface is shown.** `toggleSurface` is the one entry of a surface's icon, its menu rows and its `surface.*` action, and it gives the keyboard the same way from each. All nine `surface.*` ids join `SHELL_FOCUS_ACTIONS`, not the three with default chords: the six others are rows of build F's list, so a person can bind them, and a chord bound to Source control would otherwise show it and leave the keyboard in a web page. It beat the cut's three ids.
2. **Showing: the tool's answer, then F6's stop** (P1). `focusShown(tabId)` asks the tab (`requestFocus`) and, two animation frames later, puts the keyboard on F6's stop for that tab unless the keyboard is already inside the tab's surface. It moves nothing when the tab is no longer in view by then, when a dialog holds the keyboard, or when the person has put the keyboard somewhere else in between.
3. **Hiding: the composer, when the keyboard was in the column or nowhere.** After `hideSurfaces`, if the element that held the keyboard was inside the side column, or nothing held it, the composer of the session on screen takes it (`focusFocused`); where the pane in front holds no composer, the pane does (`focusPaneElement`). A keyboard that was in the sidebar or in the main area stays where it was. With a page open and the tool already in view behind it, the key only leaves the page, as today, and moves no keyboard; a tool the key brings into view from behind a page is shown and given the keyboard as any other.
4. **Files answers a focus request in its own file.** The file's view when the tab holds a file (the editor for text; else the file's body), else the tree: its selected row, else its first row, else the tree itself.
5. **The mode is said once per press, with the mode that resulted.** One visually hidden `aria-live="polite"` region, mounted for the composer's whole life (a region that mounts with its text is not read). The sentence is "Permission mode: <the label the mode chip shows>". It is written for a change made with ⇧Tab and for no other route: the chip's menu says its own selection, and a change the engine makes by itself is not the person's press. It beat `role="status"` on the chip, which would speak on every route. The order of events is in "The sequences that must hold", S4.

**"Attach selection to chat" (M3).**

6. **What is attached.** The selection as the terminal gives it (`getSelection`), unchanged. With nothing selected, from the chord only: the rows the terminal's viewport shows now, a soft-wrapped line as one line, each row without its trailing spaces, without blank lines at the start and the end (`screenText`, new on the renderer interface). This is Claude Desktop's reading of "what the screen shows" (`web/app/v1/c6bf19e8f-FP4iLEoJ.js:3563-3584`: the viewport's rows, not the scrollback). Text that is empty or only blank attaches nothing and says so.
7. **One pasted block, made at one place.** `pastedBlock(text)` in `src/renderer/src/composer/editor/pasted-block.ts` (new) is the only maker of a text block: a paste over the threshold, a dropped text file and the attach all call it. The block is today's, attribute for attribute, so both older builds draw it as their own. This is the one place board ticket 733 meets.
8. **Three ways in, by where the session's composer is** (Interfaces §C): where its box can take the keyboard, it takes the block and the keyboard and nothing is said; mounted where it cannot (a maximized side column covers its pane, or a card holds its box), it takes the block, saves at once, and the line follows the save's answer (P4); not mounted, the store path. The composer itself says which of the first two it is: it knows its own element and its own card.
9. **A composer that mounts while a store write is out waits for it.** `useDraftPort`'s `load` awaits `pendingAttach(session)` before it reads. Without it a composer mounting between the read and the write would load the draft without the block and, at its next ordinary save, which names no revision, write over it after "Added to …" was shown. It beat handing the block to the composer that mounted: that composer may have loaded after the write, and would hold the block twice.
10. **The handler follows the keyboard** (P8). Registered while a terminal holds the keyboard, by `focusin` and `focusout` on the window.
11. **The selection is never cleared**, added or not.

**Back and Forward (M4).**

12. **The record is a pure model with one reader of the layout** (`keymap/places.ts`, `keymap/visits.ts`). The reader runs once per turn of the event loop, in a microtask after the first change, and compares the layout it last read with the layout now: an act that changes the strip and closes the Overview in two store writes is one visit, not two.
13. **What is a visit.** The place in front changed, and the change is more than the keyboard moving to the other pane of a split (only `focusedPane` differs). Whose act it was is not asked: a tab an agent brings forward is a visit when it comes to be in front; behind an open page it is not in front, and it becomes a visit when the page closes.
14. **Leaving a page or the Overview for the place before it is a step back** (P5; card K2). It completes the cut's decision 3, which says such a close records nothing and does not say where the record then stands.
15. **A step shows the place and nothing else.** A tab: `activateTab`. A page: `openDestination` with the page as it was left (its view and filter are kept in the entry while it is the entry in front). The Overview: the place it was over, then `setOverviewOpen(true)`. The Settings dialog is closed first. The record's position is set before the layout is written, so the reader finds the layout equal to the entry it stands at and records nothing.
16. **The ends by registration.** `go.back` has a handler while there is an entry before, `go.forward` while there is one after (the cut, 1).
17. **The file editor's keymap is CodeMirror's without the two bindings**, filtered by key (`Mod-[`, `Mod-]`) where `editing.ts` builds it. Tab and ⇧Tab indent as before.

**The palette (M5).**

18. **Recent reads the same module as the record.** Sessions and artifacts that came to be in front as main tabs, and artifacts shown beside the chat. The second is read from the layout, with no edit in U10's files: the Artifacts tool writes `{ target, machine }` under its tab's `panelParams` when it shows an artifact, and a change of that value after hydration is an artifact opened beside the chat.
19. **Ranking orders what today's rule admits; it admits nothing new.** Sessions are found by the sidebar's rule as today, so the two still agree, and are then ordered by `fuzzyScore` of the query against the title; a session found by its project or folder alone has no score and follows. Projects, actions and artifacts likewise. It beat matching by the scorer's subsequence rule, under which three letters match most of the list.
20. **The order of groups.** Nothing typed: Recent, Projects, Channels, Actions. Text typed: Sessions, Artifacts (one group per machine when more than one has matches), Projects, Channels, Actions, then the one row "Search the Library for “…”". The notice about the first 50 shows only with text typed.
21. **Artifacts are asked as conversations are.** 150 ms after the last keystroke, this Mac and each machine `searchedMachines` names, each with `library.list { filter: { query } }`. An answer for a query that is no longer the query is dropped. A machine that does not answer is left out and nothing is said: the Library says its own errors, and the last row leads there.
22. **Enter on an artifact** follows the artifact link's rule with the session on screen in the link's place (Interfaces §E).

**Zoom (M6).**

23. **`window.zoom` is the truth; Chromium's own memory is not read.** `{ version: 1, factor }`, main's own key, absent at 100 %. Absent at 100 % so that a profile that was never zoomed holds no new key, and the scenes that pin the exact list of stored keys stand as they are.
24. **The steps are the in-app browser's**, between 50 % and 200 %: `stepZoom` over `ZOOM_PRESETS` (`src/main/browser/navigation.ts`, imported, not edited), held to 0.5 and 2.
25. **One command and one event of main's** (`layout.zoom`, `layout.zoomChanged`). A menu click reaches the window as every action does, and the window's handler asks main. It beat running the three ids in main's menu code: the palette and the sheet read the window's handlers, and a row with none would not be listed.
26. **Isolated zoom** (P7).
27. **Main keeps the CSS rectangle and multiplies when it places**, and applies every placement of a window again when its factor changes (row 20).
28. **Every app window has the one factor**, applied where a window is made.
29. **`zoom.in` has no handler at 200 %, `zoom.out` none at 50 %, `zoom.reset` none at 100 %.** The child's file asks it of Actual Size; Claude Desktop greys all three (`main-process/index.chunk-BV3uOqbK.js:327946-327949`), and the mechanism is the same registration.

## The sequences that must hold

**S1 · The store path** (decision 8's third way). Events: the press; the read's answer; a writer in between; the write's answer; a composer mounting.

| step | what happens | when it fails or another act comes in between |
|---|---|---|
| 0 | The session has not started: refused, nothing read | |
| 1 | `pendingAttach` holds the session from here to step 5, in the same turn as the check that no composer is mounted | a composer that mounts now waits at its `load` |
| 2 | The read: on this Mac `session.drafts.get`; on another machine the newest draft this run holds for it, else that machine's read (`unsavedRemoteDraft`, `readRemoteDraft` in `lane-b/remote-drafts.ts`). A machine that keeps no drafts for this member (`readerRowsOf(session) === 'refused'`) is refused here: its drafts live in this window's memory | the read fails: nothing is written; the outcome names the cause (`unknown`, `unreachable`, `failed`) |
| 3 | `appendPasted(read, text, now)`: the document read, with one block appended; nothing else of the draft changes (its attachments, and the names of attachments another machine kept back, go back as read) | |
| 4 | The write: `session.drafts.set` naming `replacesOf(read, overLink)`; on another machine through `saveRemoteDraftOnce`, which sends it once, in the order of that session's other saves | refused as stale, or "a draft with a document is kept": once more from step 2; a second such refusal is `changed`. Refused because a message is being taken back: `taking-back`, no second round. Any other failure: its cause |
| 5 | `pendingAttach` lets go. **Only now, and only after an accepted write, is "Added to …" shown** | the write never answers: main answers every command within its own bound, as `timeout`; that is `unreachable`. Nothing here adds a timer |

The linearization point is the store's transaction of step 4, which compares the named revision and writes in one step (`DraftStore.set`).

**S2 · The record** (Interfaces §D holds the rules). Events: the layout changed (read once per turn); a tab left the strip; a step. A step sets the position, then writes the layout. A tab that leaves takes its entries with it before the next read, so the neighbour the strip then shows is recorded against a record that no longer holds the closed tab.

**S3 · A change of the factor.** In main, for `layout.zoom { to }`, in this order: the next factor from the stored one; the key written, or removed at 100 % (a write that fails ends the command with the error and nothing changes on screen); the factor set on every app window's page; each window's placements applied again, its lights placed, an open extension popup placed again; `layout.zoomChanged` sent to every app page; the answer. Two presses are two commands, handled in order. The window's handlers follow the event, so between a press at an end and its event a second press can arrive: main holds the factor to its bounds and answers the factor it has.

**S4 · The mode said aloud.** Events: a press of ⇧Tab that asks for a change (P); its answer (A, taken or refused); the chip's mode read after the press (V). The sentence is written once per press, at the later of A and the first render after A, with the mode the chip shows then. A refused answer writes the mode in force at once. A taken answer whose mode has not reached the chip yet writes when it does; if the engine then reports another mode than the one asked (it refused Auto and set a fallback), that mode is the one said. A second press before the first is answered supersedes it: only the last press is said. A press while the chip takes no change (`mode.disabled !== null`) asks nothing and says nothing, as today.

**S5 · Artifacts in ⌘K.** Events: a keystroke; the 150 ms; each machine's answer; Enter. Enter runs the row that is selected when it is pressed. An answer that arrives later adds its rows and does not move the selection (the list is selected by value). An answer for an older query is dropped.

## What is stored and sent, and what each older build does with it

Neither settings file changes (root UC-14). No stored tab, `main.tabs`, `regions` or stored side surface gains a field. The wire's minor does not move: `layout.*` is traffic between a window and its own main, which the wire's manifest leaves out (`src/shared/ipc/wire.ts`, its header).

| what | this build | build F (`f1852de3a`) | build M (`2c7044231`) | this build, after a stay on either |
|---|---|---|---|---|
| **`window.zoom`** in `layout.json`, `{ version: 1, factor }`, absent at 100 % | written by main alone when the factor changes; never crosses to the window | never reads it. Keeps it: its layout store reads every key of the file into one map and writes the map whole (`LayoutFileStore`). Its window cannot ask for it: `LayoutKeySchema` does not name it. What F draws is what Chromium kept of the zoom, which M1 measures (P7 expects 100 %) | the same, by the same code | reads the key it wrote and applies it. A value that does not parse reads as 100 % and is left as found until the next change |
| **A session's stored draft** with one more `pasted` node | the node as `pastedNode` makes it today | its composer has the same node with the same attributes (`PastedAttrs`); it opens the draft and draws the chip. Its own threshold for a paste is lower (1,024 characters), which changes nothing for a block that already is one | the same node; the same threshold as this build | reads its own draft back, with whatever the older build's composer saved over it |
| **`session.drafts.get`, `session.drafts.set { replaces }`**, to this Mac's daemon and, for a session on another machine, to that machine. Both commands and the key exist in all three builds | names the revision read; where the read answers none, `null` over the link and the claim form on this Mac | a store of F takes a save that names the kept revision, and one that names none where none was ever kept: an attach to a session on a machine of build F works. It reads the claim form as a revision it does not hold: on this Mac, while an updated app still meets a daemon of F, an attach to an off-screen session with no draft is answered stale twice and the line says "not added" | takes every form | no stored form differs |
| **`library.list { filter: { query } }`**, to this Mac and to each machine the conversation search asks | sent with text typed in ⌘K | the offer and the filter's `query` exist | the same | nothing is stored |
| **Action ids** | none is stored: the six rows are not in build F's list, so no route stores a rebinding of one and Settings › Keyboard draws no control | its reader of `settings.json` never meets one | the same; M has the same guard | nothing to read |
| **`layout.zoom`, `layout.zoomChanged`** | a window and its own main | not sent to it | not sent to it | — |
| **The record, Recent** | this window's memory, for the run | — | — | starts again at the restored tab |

The cross-build coverage table (the comment block U13a's M5 began in `e2e/cross-build.spec.ts`) gains one row, "U6b-5: the window's zoom (`window.zoom`, main's own key)", and one scene, **"(zoom, both ways)"**, described in M7. The draft needs no row: no stored form is new (a pasted block in a stored draft is what a paste over the threshold leaves there today).

## Acceptance

Each item is a behaviour a person can check. "Unit" runs on the build VM; a scene runs on a Mac and is the architect's to start. A menu chord cannot be pressed through the scenes' driver (`e2e/support/menu.ts`), so a scene clicks the menu's item by its id; that the key itself reaches the item is the owner's hands (B13).

- **B1** (A7's first sentence, its rest). With the keyboard in the composer, View ▸ Terminal shows the Terminal surface and typing goes to its shell; again, the column hides and typing goes to the composer. The same for Review and Files, each landing where "The keyboard on show and hide" says. With the column open on Review, View ▸ Terminal shows the terminal and gives it the keyboard. With the keyboard in a page of the in-app browser, View ▸ Terminal moves it to the terminal.
- **B2** (A7). Select text in a terminal and choose "Attach selection to chat" from its menu, or Edit ▸ Attach selection to chat: the composer of that terminal's session holds one pasted block whose text is the selection, the composer has the keyboard, and nothing was sent. A selection of three characters is a block too.
- **B3**. With nothing selected the menu's item is drawn disabled, and Edit ▸ Attach selection to chat attaches what the terminal's screen shows.
- **B4** (the cut's Decision Log 7). A terminal kept open for every session, beside another session's chat: after Attach the line "Added to <its session's title>" appears. Reload the window before opening that session, then open it: its box holds the block.
- **B5**. Where the store does not take it (the session has not started; a message is being taken back; the session is no longer known; its machine does not answer, or keeps no drafts for this member; its draft changed twice in between), the line says the selection was not added, no draft holds a block, and the selection is still selected.
- **B6** (A8). ⌘K with nothing typed lists "Recent" first: the sessions and artifacts opened last in this run, newest first, eight at most, filled with the sessions most recently active; no line about the first 50. Typing an artifact's title lists it under "Artifacts", and Enter opens it beside the chat. The last row opens the Library on the typed text. No row is drawn disabled.
- **B7** (A11). Open session A, then session B, then the Customize page. Go ▸ Back shows B, again shows A; Go ▸ Forward goes forward again. With the Settings dialog open over B, Back closes the dialog and shows A. Back is disabled at the first place and Forward at the last. Closing a tab takes it out: Back never reopens it.
- **B8**. In an editable file ⌘[ and ⌘] change nothing in the text; Tab and ⇧Tab indent. In a plugin's detail ⌘[ returns to its list and the place in front does not change.
- **B9** (A12's rest). ⇧Tab in the composer changes the permission mode and the composer's live region reads "Permission mode: Plan" (the new mode's name). On a session MAWS runs and on a terminal session alike.
- **B10** (A10). View ▸ Zoom In and Zoom Out make the whole window larger and smaller along the steps; Actual Size returns to 100 % and is disabled there; Zoom In is disabled at 200 % and Zoom Out at 50 %. Quit and relaunch: the size is as left. In a page of the in-app browser the keys zoom that page alone, as today.
- **B11** (A10, "stays exactly under its frame"). At 80 %, 125 % and 200 %: the in-app browser's view covers its pane to the point; an extension's popup opens under its icon; the bookmarks menu opens under its button; a comment's pin sits on the picked element; the traffic lights stand centred in the title bar and clear of its controls; a page at the Mobile size reads 375 wide.
- **B12** (root UC-14). After this build at 125 %, build F and build M on the same profile each show 100 %, keep `window.zoom` through their own write, and this build then shows 125 % again. The presenter's window, the repair window, a deck's export, a screenshot of an artifact and Mark up's still are the same at 150 % as at 100 %.
- **B13** (A13, A9). `src/shared/keymap/actions.test.ts` holds the six rows to the wave's chords; `src/main/menu.test.ts` finds Back and Forward leading Go, the three zoom items in View outside any submenu, and "Attach selection to chat" after the Edit menu's own items; the sheet lists the six under those groups. By hand, on the owner's machines: ⇧⌘L in a terminal attaches and no Service takes it; the six chords work under the Korean input source (the child's probe 6).
- **B14** (UC-6, "Stored rebindings"). Settings › Keyboard lists the six rows with no control to change them, and `settings.json` holds none of their ids after any act.

## Constraints that bind every milestone

- **The build brief binds** (the wave's common brief for building a child): nothing is typechecked, linted, tested, built or started on the owner's MacBook (root UC-10); every check runs on the build VM in a checkout of the pushed head; the gate runs Node 22 where the VM runs a newer one; the known VM failures are read against the brief's list and never edited away.
- **Laws 1, 3, 5 and 8 of the root**, and its contracts: UC-6 (a key is a row of `ACTIONS` and is written nowhere else; a component handles no ⌘ key of its own), UC-8 (every edit in a file another child owns is the insertion Interfaces §H names, and nothing more), UC-11 (public repository: invented names, paths and text in every test, fixture and scene), UC-12 (a step that shows a tab closes the page and the dialog through the store's own acts; nothing here writes the strip), UC-14 (the table above).
- **No stored rebinding of the six rows** while build F can be gone back to: no id is added to `BUILD_F_ACTION_IDS`.
- **Tokens only** in renderer source; a ticket or item number is written in words there (the tokens guard reads `#` and digits as a colour).
- **No wall time is asserted.** No test or scene of this landing holds an upper bound on a time. A scene waits on a state it names; a unit test that needs the 150 ms of the artifact search or two animation frames uses the suite's fake timers.
- **A test that asserts an absence** (no row, no block, no entry, no key, no sentence) over input it builds by hand carries a control in the same test: the same reader, given the form that should be found, finds it.
- **An act that awaits** has a test that holds the awaited answer open and acts in between, not only a test of the end state. S1, S4 and S5 list the orders.
- **A cause read from code is measured before its fix is built**: M6 builds no placement before M1 has recorded it off by the factor in the direction Interfaces §G gives.
- **Other packages read the app's source.** `apps/desk-web` imports files of `src/renderer/src` and `src/shared` by path. Each milestone lists the importers outside the project it changed, following imports until no new file appears, and where there is one adds that package's typecheck, build and test project to its proof. `src/shared/ipc/schema/layout.ts` is reached through `schema.ts` (U6b-2's finding): M6 runs them.
- **Merge, never rebase or force-push.** Never push master.

## Plan of Work

Seven milestones. M1 is a spike whose verdict gates M6 alone; M2 to M5 do not wait for it. M5 consumes M4's module. If the architect cuts zoom off as a second pull request, it is M1, M6 and the zoom part of M7, with no edit to M2 to M5 ("Size and review").

### M1 — Spike: what Chromium keeps of a window's zoom, and where the six placements land

**A prototyping milestone.** Its deliverable is `spikes/zoom-probe/FINDINGS.md`, with a results file per run, and four probe scenes that record and assert nothing. Nothing of it is imported by the product. **Its verdict gates M6.**

**The questions.** (1) Whether a zoom set on the app's page is kept by Chromium outside `window.zoom`, in each zoom mode, across an ordinary quit and a forced exit: this decides what build F and build M show after this build was zoomed (the cut's X3), and whether P7's design stands. (2) Whether an isolated zoom survives a reload, and how a factor is in force before the first paint. (3) Whether the presenter's and the repair window's pages take the window's zoom. (4) That each of the six placements is off by the factor today, in the direction Interfaces §G gives.

**What to build.**

*The harness*, in the shape of `spikes/file-frame/`: `main.mjs` (an Electron main, the product's Electron version, that opens a `file:` page sandboxed and context-isolated as `createWindow` makes a window, on a scratch `userData` given on the command line), `page/` (one page with text; a second file), `run.mjs` (one launch per row, `RESULT {json}` lines gathered into `runs/<time>/results.json`; under Linux with no display it runs itself under `xvfb-run`, as `spikes/viewer-frame/run.mjs` does), `FINDINGS.md`. It runs on the repository's own Electron and has no dependency of its own, as that harness does, and it imports nothing from `src/`. "The stand-in" below is the same harness making no zoom call and setting no zoom mode, launched on the same `userData` and the same file URL: it is what a build that knows no zoom does.

| row | what is done | what is recorded | what it decides |
|---|---|---|---|
| a | default mode; `setZoomFactor(1.5)`; `app.quit()`; then the stand-in | the stand-in's `getZoomFactor()` after its page loaded; the zoom entries of the profile's `Preferences` file, by key | whether a default-mode zoom is kept, and under which key (the host, or the whole URL) |
| b | as a, ended by SIGKILL at once, and again 15 s after the zoom was set | the same, twice | whether a forced exit differs |
| c | the window made with `zoomMode: 'isolated'`; `setZoomFactor(1.5)`; `app.quit()`; the stand-in | the same | **P7:** whether an isolated zoom is kept anywhere |
| d | as c, ended by SIGKILL at once and 15 s later | the same, twice | **P7**, for a forced exit |
| e | isolated; 1.5; then `webContents.reload()`; then a load of the same file with another query | `getZoomFactor()` after each load | whether the factor is applied again after every load (`applyAfterLoad`, Interfaces §G) |
| f | isolated, with `webPreferences.zoomFactor: 1.5` at creation and no call | the factor at the first `dom-ready` and at `ready-to-show`; a capture of the window at `ready-to-show` beside one at 1.0 | how the factor is in force before the first paint (`openAt`: the option, or a call at `dom-ready`) |
| g | three windows as a build opens them: the page; the same file with another query (the presenter's shape); another file (the repair page's shape). The first at 1.5, once in default mode, once isolated | the other two's factors | whether `present.ts` and `repair/index.ts` need a call that holds them at 1 |
| h | isolated at 1.5, with a `WebContentsView` of another partition attached to the window (the in-app browser's shape) | that view's factor | expected 1; anything else is a stop |

*The probe scenes*, run on a Mac by the architect, each skipped unless `MAWS_ZOOM_PROBE=1` and each ending in `record([...])` lines, never in an assertion:

- **"(zoom probe)"** in `e2e/cross-build.spec.ts`, beside "(export folder)" and with its helpers (`withScratch`, `s.launch({}, peer.root)`, `s.quit`, `s.killApp`). This build's page is set to 1.5 through `app.evaluate` on its first window's `webContents`, in the mode rows c and d chose and once in the other mode; then an ordinary quit, the peer launched on the profile, and the peer's `getZoomFactor()` read through `app.evaluate`; then the same after `s.killApp`. It waits on each launch's `s.ready(page)` and on nothing else. Run twice: `--peer-exact f1852de3a` and `--peer-exact 2c7044231`.
- **"zoom probe: the placements"** in `e2e/browser.spec.ts`, **"zoom probe: the popup"** in `e2e/browser-chrome.spec.ts` and **"zoom probe: the pin"** in `e2e/browser-comment.spec.ts`: with the page's factor set through `app.evaluate` to 0.8, 1.25 and 2, each records the native rectangle (`__maws_browser.tab(id).bounds`; `__maws_browser.extensions.popup().bounds`; the pin's position as the card is drawn) beside the DOM rectangle it should cover (`paneRect`, the icon's box, the picked element's box). Each waits on the DOM rectangle having changed after the factor was set (the pane's width in CSS pixels differs from its width before), then on two frames.
- **A look**, by the architect, at 50 %, 80 % and 200 %: where the traffic lights stand in the title bar; whether the title bar still drags the window over its whole height; whether a terminal's text is sharp. For it the placements' probe, run with `MAWS_ZOOM_PROBE_HOLD=1` and the window shown (`MAWS_E2E_QUIET=0`), stops at each factor until it is resumed (`page.pause()`).

**Promote or discard.** The harness and the findings stay under `spikes/zoom-probe/`; the probe scenes are replaced by M7's asserting scenes. The verdict, routed into Surprises & Discoveries:

- Rows c and d read 1 in the stand-in, and "(zoom probe)" reads 1 in both peers after both exits: P7 stands; M6 is built as written; nothing resets at quit.
- Row c or d, or the peers' read, shows a kept zoom under isolated mode: **stop.** The record goes to the architect with rows a and b beside it. The fallback this document names and does not build without a ruling: the page is set to 1 when its window closes (`leaveAtActualSize`), which leaves a forced exit as a residue the owner would have to accept.
- Row e: the factor is lost at a reload: `applyAfterLoad` is built; kept: it is left out.
- Row f: the option holds at first paint: `openAt` uses it; else the call at `dom-ready`.
- Row g: a window takes the zoom: its maker gains the one call; none does: nothing is edited there.
- Row h reads anything but 1: stop.
- A placement that the probe records as already under its frame, or off in the other direction: that row of Interfaces §G is wrong; stop for that row and report.
- The harness and the Mac scene disagree on a kept zoom: the Mac scene, which runs the real builds, is the one believed, and the difference is reported.

**What it does not touch.** Anything under `src/`.

### M2 — The keyboard on show and hide, and the mode said aloud

**What exists at its end.** B1 and B9, by their unit halves: a surface shown from any of its controls has the keyboard; hidden, the composer has it; ⇧Tab's change is in the composer's live region.

**What it touches.** `src/renderer/src/panel/SurfaceRow.tsx` (U8's; Interfaces §H); `src/renderer/src/keymap/shell-navigation.ts`; `src/renderer/src/tools/code/files/FilesTool.tsx`; `src/main/menu.ts` (`SHELL_FOCUS_ACTIONS`); `src/renderer/src/composer/Composer.tsx` (U4's: the live region and its writer); their tests (`panel/surface-row.test.ts`, `app/Shell.test.tsx`'s "the side column's acts with a page open", `keymap/shell-navigation.test.tsx`, `tools/code/files/files.test.tsx`, `main/menu.test.ts`'s `it.each` of the focus actions, `composer/Composer.test.tsx`).

**Interfaces.** Exposes §B (`focusShown`, `focusSurfaceStop`) and §F. Consumes `requestFocus` (`panel/host.ts`), `focusFocused` (`composer/ComposerAppKeys.tsx`), `focusPaneElement`, `MODE_OPTIONS` (`statusline`).

**Decisions.** 1 to 5; S4.

**What it does not touch.** `tools/code/review/` (P1); how a tool answers a focus request other than Files; `panelHost.selectTab`; the chip's menu.

**What it proves.**
- Shown from a hidden column, from a column open on another tool, and brought into view from behind a page, the tab is asked for focus on each path (the open-column path is the one that asked nothing before); a tool that answers keeps the keyboard, and one that does not gets it at F6's stop two frames later.
- Held open between the request and the second frame: the person focuses the sidebar's field, and the keyboard stays there; the tab is hidden again, and nothing is focused.
- Hidden with the keyboard inside the column, and with nothing holding it: the composer's editor has it. Hidden with the keyboard in the sidebar: it stays (the control: the same assertion finds the composer focused in the first case).
- With a page open and the tool in view behind it, the key leaves the page and focuses nothing (the three cases of `Shell.test.tsx` stand).
- A Files tab that holds a file gives its view the keyboard; one that holds none, its tree's selected row, else its first.
- Every `surface.*` id moves the keyboard out of a web page's view (`menu.test.ts`).
- S4, each order held open: the answer before the chip's mode; the chip's mode before the answer; a refused answer; a taken answer and another mode reported; two presses; a press while the chip takes no change says nothing (the control: the same reader hears the sentence after a press that changes the mode). A repeat of one sentence is written again.

### M3 — "Attach selection to chat"

**What exists at its end.** B2 to B5 by their unit halves, and the row `terminal.attachSelection` in the table, the Edit menu and the sheet.

**What it touches.** `src/shared/keymap/actions.ts` (the row); `src/renderer/src/terminal/renderer.ts`, `xterm.ts`, `renderer.fake.ts`, `registry.ts`; `src/renderer/src/tools/terminal/TerminalView.tsx`, `copy.ts`, `attach.ts` (new); `src/renderer/src/composer/editor/pasted-block.ts` (new), `composer/editor/controller.ts`, `composer/attach-pasted.ts` (new), `composer/Composer.tsx`, `stores/composer.ts` (Interfaces §H for the last five); `src/renderer/src/App.tsx` (one mount); the tests beside each, and `main/menu.test.ts` ("puts an edit row after the Edit menu's own items", which today ends on "no edit row today"), `settings-tab/keymap.test.ts` (the `Edit` group now stands before "Edit › Sample"; the list of rows that take no rebinding gains the id where it stands in the table), `tools/terminal/terminal.test.tsx` ("offers Copy, Paste, Select all and Clear from its context menu").

**Interfaces.** Exposes §C. Consumes `DRAFT_CLAIM`, `STALE_DRAFT_WORDS`, `DRAFT_KEPT_WORDS`, `STAGED_DRAFT_WORDS` (`src/shared/ipc/schema/session.ts`); `readRemoteDraft`, `saveRemoteDraftOnce`, `unsavedRemoteDraft` (`lane-b/remote-drafts.ts`); `readerRowsOf` (`lane-b/reader-rows.ts`); `available` (`keymap/shell-navigation.ts`, exported by this milestone); `toast` (`stores/notices.ts`); `displayTitle`.

**Decisions.** 6 to 11; S1; P2, P3, P4, P8.

**What it does not touch.** `queueComposerAttachment` (not used: it keeps its items in the window's memory); the threshold of a paste; how a block is sent; the draft store; any command's schema. No site of the guard of who sends as the person changes (`test/support/person-sends.test.ts`): the attach hands nothing to a send.

**What it proves.**
- `screenText`: a viewport scrolled up reads the rows it shows, not the buffer's end; a soft-wrapped line is one line; trailing spaces and blank edge lines are dropped; an empty screen reads empty. In `xterm.test.ts` and against the fake.
- `pastedBlock` makes the node a paste over the threshold makes, attribute for attribute; a paste over the threshold and a dropped text file still make it (the controller calls it).
- A composer whose box can take the keyboard: one block in the editor, the editor focused, no line, nothing saved by the attach itself. While a submission is in flight: `busy`, and the editor's document is unchanged (the control: the same read finds the block after an accepted attach).
- A composer under a card, and one whose pane a maximized side column covers: the block, a save at once, the line after the port's answer and not before (held open); the port answering false is `unsaved`, with its own sentence.
- S1, each order held open with a client whose answers the test releases: a writer between the read and the write (the second round appends to the newer draft and names its revision); a draft's revision where the read answers one; where it answers none, the claim form on this Mac and `null` over the link; a cleared draft read over the link names its stamp; a stage kept (`taking-back`, one write, no second round); two stale answers (`changed`); a session with no row (`unknown`); the link's `host_unavailable` and `timeout` (`unreachable`); a machine that keeps no drafts (`no-store`, nothing sent). In every refusal no `session.drafts.set` is accepted and no line says "Added" (the control: the accepted case in the same file).
- A composer that mounts while the write is out loads after it and holds the block once.
- A session that has not started, by each of the three ways of "The named question": refused on the store path with nothing read; taken by its mounted composer.
- The handler is registered while a terminal holds the keyboard and at no other time; the menu's item is disabled without a selection and the chord's path attaches the screen.
- A store of build F (`DraftStore` at `f1852de3a`, read with `git show`, its one rule restated in the test as a fake store): a save naming a kept revision is taken, one naming none where none was kept is taken, and the claim form is stale twice, which is `changed` with nothing written.

### M4 — Back and Forward

**What exists at its end.** B7 and B8 by their unit halves; the rows `go.back` and `go.forward`.

**What it touches.** `src/shared/keymap/actions.ts`; `src/main/menu.ts` (the two ids join `SHELL_FOCUS_ACTIONS`); `src/renderer/src/keymap/places.ts` and `visits.ts` (new); `src/renderer/src/app/shell-actions.ts`; `src/renderer/src/tools/code/editor/editing.ts`; `src/renderer/src/App.tsx` (one mount); tests beside each, `main/menu.test.ts` ("reads View and Go in groups"), `settings-tab/keymap.test.ts`, `tools/code/editor/editor.test.tsx`.

**Interfaces.** Exposes §D. Consumes the layout store as it is (`placeOf`'s parts: `destination`, `main`, `overviewOpen`, `hydrated`; `activateTab`, `openDestination`, `setOverviewOpen`, `closeSettings`): no line of `stores/layout.ts` is edited.

**Decisions.** 12 to 17; S2; P5.

**What it does not touch.** `PageTitle` in `app/Toolbar.tsx` and Esc on a page (P5's default); which tab a close shows; `tab.reopen`; the in-app browser's own ⌘[ and ⌘] (`src/main/browser/keys.ts`); the deck's stage; `backOnChord`.

**What it proves.**
- The model, as a table of cases over `seen`, `gone` and `target`: A11's walk; a new place after a step back drops what was ahead; the fiftieth-and-first entry drops the oldest; a closed tab's entries and the Overview entries over it leave, and neighbours that became the same are one; the position when the entry in front leaves.
- Rule 2 of `seen`: the Overview closed onto the place it was opened over, and a page closed onto the tab before it, are steps back with the entry kept ahead; a page closed onto another tab is a new visit; a tab clicked while on a tab is a new visit, never a step back.
- The reader: an act inside the Overview that changes the strip and closes the Overview in two writes is one visit (held: the read happens once, after both). A change of `focusedPane` alone records nothing (the control: a tab activated in that other pane, in the same test, is recorded). A tab brought forward inside `quietly` behind a page is recorded when the page closes. Nothing is recorded before `hydrated`; the first entry is the restored place.
- A step sets the position before the layout is written and records nothing; with the Settings dialog open it closes the dialog and shows the place; a step to the Overview shows what it was over and opens it; a step whose tab left the strip in the same turn shows nothing and the entry is dropped at the next read.
- `go.back` and `go.forward` have handlers exactly while there is an entry on that side.
- The file editor's keymap holds no binding for `Mod-[` or `Mod-]` and still holds Tab's and ⇧Tab's (the control: the same search finds `Mod-/`).

### M5 — The palette: Recent, Artifacts, ranking, no row that cannot run

**What exists at its end.** B6 by its unit half.

**What it touches.** `src/renderer/src/palette/CommandPalette.tsx`, `recent.ts` and `artifacts.ts` (new), `keymap/visits.ts` (the opened list's sources), `palette/CommandPalette.test.tsx` and new tests beside the two modules.

**Interfaces.** Exposes §E. Consumes M4's `useVisits`; `fuzzyScore` (`src/shared/composer/fuzzy.ts`); `searchedMachines` (`palette/search.ts`); `library.list`, `library.get`; `showOpenArtifactTab`, `openArtifactTab` (`library/actions.ts`); `openArtifactInPanel`, `canShowArtifactInPanel`, `sessionArtifactMachine`, `recordArtifactMachine`; `setLibraryView` (`library/view.ts`); `openArtifacts` (`main/artifacts.ts`); `focusedSession` (`composer/ComposerAppKeys.tsx`).

**Decisions.** 18 to 22; S5; P9.

**What it does not touch.** The Conversations scope and `searchConversations`; the sidebar's matching rule; any file of `library/`, `tools/artifacts/` or `channel/`.

**What it proves.**
- Nothing typed: Recent first, newest first, eight at most, sessions and artifacts mixed; fewer than eight opened are filled with the sessions most recently active, none twice, none archived; a recent artifact that no longer exists is not listed (the control: one that exists is, by the same read); no Sessions group and no notice about 50.
- Recent's sources: a session's tab and an artifact's tab that came to be in front; an artifact shown beside the chat, read from `panelParams`; a side tab restored at hydration is not an opening (the control: the same tab shown a second artifact after hydration is).
- Text typed: sessions found by the sidebar's rule and ordered by the scorer, one found by its folder alone after those found by title; "dark" still lists exactly Appearance: Dark, and a word in no action's title lists no action (the two cases that stand today).
- No row that cannot run: a row with no handler is absent, and so is a `renderer` row of scope `pane` or `composer` whether or not it has one (the control: registering the handler of a listable row makes it appear in the same test). The cases that asserted a greyed row and its reason are rewritten to this; "Project channel" is absent while the tab in front has no project with a channel.
- S5, held open: Enter runs the row selected when it is pressed, and an answer released afterwards changes nothing; an answer for the older of two queries released last is dropped; a machine that answers `host_unavailable` is left out and no line is drawn; one group "Artifacts" for one machine with matches, one per machine by name for two.
- Enter on an artifact, by Interfaces §E's four steps, one case each; the last row sets the Library's query and opens its page.

### M6 — Zoom

Starts on the architect's word after M1's verdict.

**What exists at its end.** B10 to B12 by their unit halves; the rows `zoom.in`, `zoom.out`, `zoom.reset`.

**What it touches.** `src/shared/keymap/actions.ts`; `src/shared/ipc/schema/layout.ts` (the key, its schema, the command, the event), `src/shared/ipc/names/layout.ts`, `src/shared/ipc/routes.json`; `src/main/zoom.ts` (new), `src/main/layout/store.ts` (`MAIN_KEYS`), `src/main/app.ts`, `src/main/window.ts`; the six placements of Interfaces §G, in `src/main/browser/` (U12's), `src/main/window.ts`, `src/renderer/src/tools/browser/viewport.ts` (U12's) and `src/renderer/src/app/Toolbar.tsx` (U7's); `src/main/browser/inspect.ts` (the seam's menu anchor); `src/renderer/src/stores/zoom.ts` (new), `app/shell-actions.ts`, `App.tsx`; `src/main/menu.ts` (the comment "No zoom roles" is rewritten: the three items are the app's own rows, not roles); tests beside each, `shared/ipc/schema/layout.test.ts` ("accepts the key grammar and nothing else"), `main/layout/store.test.ts` ("main's own keys"), `main/browser/view.test.ts`, `main/menu.test.ts`, `settings-tab/keymap.test.ts`.

**Interfaces.** Exposes §G. Consumes `ZOOM_PRESETS`, `stepZoom` (`src/main/browser/navigation.ts`); `appWindows` (`src/main/windows.ts`); M1's verdict.

**Decisions.** 23 to 29; S3; P6, P7.

**What it does not touch.** The in-app browser's own zoom and its keys; `window.main` and `WindowStateSchema`; `src/main/presentations/` and `src/main/repair/` unless M1's row g says so; the layout's breakpoints and the window's minimum size; any zoom role of the menu (`menu-roles.test.ts` stands unedited).

**What it proves.**
- `nextFactor`: each step up and down the presets between 0.5 and 2; held at the ends; `actual` is 1; `current` changes nothing.
- The key: written at a change, removed at 100 % (the control for "no key": the same read finds it at 125 %); absent and invalid both read 1, and an invalid value is not rewritten until a change; listed by `layout.list`, refused to the window by `layout.get` and `layout.set`.
- S3's order: a write that throws leaves the factor, the page and the placements as they were and answers the error; two commands are applied in order.
- Each of the six placements, at 0.8, 1.25 and 2, against a fake of the native call: the numbers handed over are the CSS numbers times the factor (or, for the pin and the device box, divided), rounded as today at 1; at factor 1 every existing case of `view.test.ts` and of the popup's, the menu's and the pin's tests passes unedited.
- A change of factor applies again every placement of that window, also where the window sent no new rectangle (held: the window is silent, main re-places).
- The window's handlers: `zoom.in` absent at 2, `zoom.out` at 0.5, `zoom.reset` at 1, each present elsewhere; the root's `--app-zoom` follows the event.
- A second app window made while the factor is 1.25 opens at 1.25.

### M7 — The scenes, the cross-build row, the record, and the acceptance run

**What exists at its end.** Every scene of Interfaces §I written and typechecked; the coverage row and its scene; the record; the whole unit suite run once.

**What it touches.** The spec files of Interfaces §I and `e2e/support/browser-scene.ts`; `e2e/cross-build.spec.ts` (the P5 work's file: one scene, one row of the coverage comment, the probe scene removed); `docs/tech-debt-tracker.md`; this document.

**The record.** No ruling of the owner's is reversed by this landing; the child's "Rulings reversed" gives U6b-5 none. Two tracker rows move: the row of 2026-10-24 ("Lens 7 remainders not built") loses zoom, Back and Forward and the permission-mode announcement and keeps pop-out windows and the composer's reverse traversal; the row of 2026-10-27 (a follower at a zoom other than 100 %) is closed or kept by what the `e2e:transcript` scene shows, with that scene named. One row is added for each item of "Left over".

**"(zoom, both ways)"**, in `e2e/cross-build.spec.ts`, after "(export folder)" and with its helpers. This build sets 125 % through the menu's items, and `layout.json` holds `window.zoom` at 1.25; the peer is launched on the profile, opens a tab so that it writes its layout whole, and quits; the file still holds the key as written, and the peer's page read 1 (its `getZoomFactor()` through `app.evaluate`); this build again shows 1.25. It waits on `s.ready(page)` at each launch, on the stored key after the zoom (polled from the file), and on the peer's stored `main.tabs` naming the tab it opened. It skips only for a peer whose `LayoutKeySchema` names `window.zoom`, by a helper in the form of `namesExportFolder`. **It must pass, not skip, against four peers:** build F and build M (`--peer-exact f1852de3a`, `--peer-exact 2c7044231`, the runs of record), the master this landing merges into, and master at `b89d6d1d7`: none of the four names the key.

**What it proves.** Against the acceptance: B1, B2 to B4, B6 to B12 and B14 by the scenes of §I; B5 and B13's first half by the unit suites; B13's second half and the looks of "Proof that an executor does not run" by hand.

## Concrete Steps

Working directory for every command: the branch's worktree. The VM sees only what is pushed. Below, `vmcheck` stands for the wave's build-VM helper as the build brief gives it, called for this branch (`vmcheck.sh ux-wave/U6b-5 --`); it prints `vmcheck: ux-wave/U6b-5 at <short sha>`, then the command's output, and exits with the command's status. Its first call for the branch installs dependencies: allow 20 minutes. Every command there runs under `timeout <seconds>`; where every part's result is wanted, the remote command starts with `set +e;`.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b-5

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite), and read "Statements to check again" against what arrived.

2. **The tests before the modules** (M2 to M6). Commit the cases of the milestone's "What it proves" with the new exports naming nothing; push; run them; the cases that assert the new behaviour fail and those that assert what stays pass. Then build.

3. **While building**, after each push:

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck 'timeout 900 pnpm exec vitest run <the test files touched>'

   The web project for the renderer; the node project for main and for `src/shared/`.

4. **M1, on the VM, and the first stop.**

       vmcheck 'cd spikes/zoom-probe && timeout 900 node run.mjs'

   Expected: one line per row a to h, each `RECORD` with its values; `runs/<time>/results.json` (`runs/` is ignored by git; the values are copied into `FINDINGS.md` with the commands that made them). The probe scenes are typechecked, not run (step 6). Then **stop**: the controller gives the architect the findings and the names of the probe scenes; M6 waits for the architect's word. M2 to M5 go on.

5. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and `vmcheck 'timeout 1800 pnpm exec vitest run <the list>'` over:

   - M2: `src/renderer/src/panel src/renderer/src/keymap src/renderer/src/app src/renderer/src/tools/code/files src/renderer/src/composer src/main/menu.test.ts test/support/tokens-guard.test.ts`
   - M3: `src/renderer/src/terminal src/renderer/src/tools/terminal src/renderer/src/composer src/renderer/src/stores src/renderer/src/lane-b src/renderer/src/settings-tab src/renderer/src/keymap src/shared/keymap src/main/menu.test.ts test/support/person-sends.test.ts test/support/tokens-guard.test.ts`
   - M4: `src/renderer/src/keymap src/renderer/src/app src/renderer/src/destination src/renderer/src/tools/code/editor src/renderer/src/settings-tab src/renderer/src/channel src/shared/keymap src/main/menu.test.ts`
   - M5: `src/renderer/src/palette src/renderer/src/keymap src/renderer/src/channel src/shared/composer test/support/tokens-guard.test.ts`
   - M6: `src/main/zoom.test.ts src/main/layout src/main/browser src/main/menu.test.ts src/main/menu-roles.test.ts src/main/presentations src/shared/ipc src/shared/keymap src/renderer/src/stores src/renderer/src/app src/renderer/src/tools/browser src/renderer/src/settings-tab test/support/tokens-guard.test.ts`, then the desk's web app as the static gate runs it (`pnpm --filter desk-web typecheck`, `pnpm --filter desk-web build`, `pnpm exec vitest run --project desk-web`)

   Expected: every file passes but those the build brief lists as failing or timing out on the VM, each shown to pass alone or to fail on master there.

   *M6's one snapshot.* With the command's name pushed, `vmcheck 'MAWS_ROUTES_WRITE=1 timeout 300 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null || true; git diff -- src/shared/ipc/routes.json; git checkout -q -- src/shared/ipc/routes.json' | sed 1d > "$TMPDIR/u6b5-routes.patch"`, then `git apply` it in the worktree. Read the patch first: it holds the one name `layout.zoom` and nothing else. The wire's minor, its manifest and its fingerprint do not change; `vmcheck 'timeout 600 pnpm exec vitest run src/shared/ipc'` shows it.

6. **A scene is typechecked, not run** (M1's probes, M7's scenes):

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The second is the gate's own script tests. This landing adds no spec file, so the pinned count of specs stands; a scene added to an existing file needs no edit there.

7. **The acceptance run** (M7's last step), on the pushed head, after a last merge of master:

       vmcheck 'timeout 2400 pnpm typecheck'
       vmcheck 'timeout 1800 pnpm lint'
       vmcheck 'timeout 3600 pnpm test'
       vmcheck 'timeout 600 pnpm exec vitest run src/shared/machine'

   Expected: each exits 0, apart from the files the build brief lists; vitest's summary names no other failed file. The whole unit suite runs this once, by M7's executor, and by no earlier milestone.

8. **Stop and hand back.** M7's executor writes into Progress what ran and what is left, pushes, and stops. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the branch review, the Mac runs and the pull request are the architect's.

## Interfaces and Dependencies

No library is added. Names and shapes below are what must exist at the end of the milestone that makes them; a private helper's name is the executor's.

### §A. The six rows (M3, M4, M6; `src/shared/keymap/actions.ts`)

```ts
// Edit: after the Edit menu's own items (M3)
'terminal.attachSelection': { title: 'Attach selection to chat', chord: 'Cmd+Shift+L', sink: 'menu', menu: 'edit', scope: 'app' },
// Go: the two lead the menu, so they stand before 'palette.open' (M4)
'go.back':    { title: 'Back',        chord: 'Cmd+[', sink: 'menu', menu: 'go',   scope: 'app' },
'go.forward': { title: 'Forward',     chord: 'Cmd+]', sink: 'menu', menu: 'go',   scope: 'app' },
// View: after 'artifact.moveToTab' and before 'comments.expand', in no submenu (M6)
'zoom.in':    { title: 'Zoom In',     chord: 'Cmd+=', sink: 'menu', menu: 'view', scope: 'app' },
'zoom.out':   { title: 'Zoom Out',    chord: 'Cmd+-', sink: 'menu', menu: 'view', scope: 'app' },
'zoom.reset': { title: 'Actual Size', chord: null,    sink: 'menu', menu: 'view', scope: 'app' },
```

Each prefix (`terminal`, `go`, `zoom`) is new and so is a group of its own in the menu, with its separators (`group` in `src/main/menu.ts`); `GROUP_OF_PREFIX` gains nothing. The zoom rows do not stand beside `channel.open` (`channel/open-action.test.ts` pins its neighbours). They are rows, not menu roles: `MENU_ROLE_CHORDS` and `menu-roles.test.ts` stand. `LANDED` in `actions.test.ts` gains the six, and its comment says six of U6b's seven are here and `files.goToFile` is U6b-3's. `SHELL_FOCUS_ACTIONS` gains the nine `surface.*` ids (M2) and `go.back`, `go.forward` (M4).

### §B. The keyboard on show and hide (M2)

```ts
// src/renderer/src/panel/SurfaceRow.tsx
export function toggleSurface(toolId: string): void;   // as today; then focusShown(the tab it showed), or the keyboard's return when it hid the column
// src/renderer/src/keymap/shell-navigation.ts
export function focusSurfaceStop(tabId: string): boolean;   // F6's stop of the side group that shows this tab; false when no group shows it
```

`focusShown` and the return are private to `SurfaceRow.tsx`; their rules are decisions 2 and 3. What held the keyboard is read before `hideSurfaces` is called.

### §C. "Attach selection to chat" (M3)

```ts
// src/renderer/src/terminal/renderer.ts
interface TerminalRenderer { screenText(): string }            // decision 6; also in xterm.ts and renderer.fake.ts
// src/renderer/src/terminal/registry.ts
focused(): TerminalHandle | null;                               // the entry whose container holds document.activeElement

// src/renderer/src/composer/editor/pasted-block.ts (new): the one maker
export function pastedBlock(text: string): JSONContent;        // pastedNode({ id: atomId('pasted'), kind: 'text', name: 'Pasted text #1', lines, text })
export function appendPasted(read: Draft | null, text: string, updatedAt: string): Draft;   // the document read plus one block; a read with no document starts an empty one

// src/renderer/src/composer/editor/controller.ts
interface EditorHandle {
  // Once this mount's draft is restored: one block at the caret the editor left, else at the end. 'busy': a submission is in
  // flight, the editor is gone, or it takes no typing; nothing changes then. With `save`, the pending write is dropped and
  // the draft is saved now through the editor's port: 'taken' when the port answered true, 'unsaved' when false.
  attachPasted(text: string, options?: { save?: boolean }): Promise<'taken' | 'unsaved' | 'busy'>;
}
// src/renderer/src/stores/composer.ts
interface FocusTarget {
  // The composer decides where it stands, since only it knows. 'shown': its box could take the keyboard (its element is
  // available as F6 reads availability, and no card holds the box): the block is in, the editor has the keyboard.
  // 'kept': it could not: the block is in and the draft was saved at once, the port answering true. 'unsaved': the same,
  // the port answering false. 'busy': nothing changed.
  attachPasted?(text: string): Promise<'shown' | 'kept' | 'unsaved' | 'busy'>;
}
// src/renderer/src/keymap/shell-navigation.ts
export function available(element: HTMLElement): boolean;     // today's private rule, exported: no ancestor hidden, inert or aria-hidden

// src/renderer/src/composer/attach-pasted.ts (new)
export type AttachRefusal = 'not-started' | 'busy' | 'unsaved' | 'taking-back' | 'changed' | 'unknown' | 'unreachable' | 'no-store' | 'failed';
export type AttachOutcome = { kind: 'taken' } | { kind: 'added' } | { kind: 'refused'; why: AttachRefusal };
export function attachPasted(appSessionId: AppSessionId, text: string, client?: MawsBridge): Promise<AttachOutcome>;
export function pendingAttach(appSessionId: AppSessionId): Promise<void> | null;   // awaited by useDraftPort's load (decision 9)

// src/renderer/src/tools/terminal/attach.ts (new)
export function attachFromTerminal(id: TerminalId, source: 'menu' | 'chord'): Promise<void>;   // reads the text, calls attachPasted for info.appSessionId, says the outcome
export function connectTerminalAttach(): () => void;          // the handler's registration by the keyboard (P8); mounted once from App.tsx
```

`attachPasted`, by where the session's composer is:

| the session's composer | what happens | the outcome |
|---|---|---|
| mounted, and it answers `shown` | the block is in its editor, which has the keyboard | `taken` |
| mounted, and it answers `kept` (a card holds its box, or a maximized or floating side column covers its pane) | the block is in its editor and its draft was saved at once | `added` |
| mounted, and it answers `unsaved` or `busy` | as it says | that refusal |
| not mounted (no focus target is registered for the session) | S1 | `added`, or the refusal S1 names |

`replacesOf(read, overLink)` is the read's `updatedAt` when it answered a draft or, over the link, a cleared draft with its stamp; when it answered none it is `null` over the link and `DRAFT_CLAIM` on this Mac (P2). `notStarted(session)` is `useSetupIntent`'s rule read outside React: an intent, and not both a record and an engine status. `taken` says nothing; `added` and every refusal say one line (`toast`, level `info` for `added`, `warning` otherwise), from the one table `ATTACH` in `tools/terminal/copy.ts` ("The sentences a person reads").

The terminal's menu becomes: Copy, Paste, Select all, Clear, a separator, "Attach selection to chat" (enabled while `hasSelection()`). The fifth item is last and not first as in Claude Desktop, so that the four a hand already knows keep their places.

### §D. The record (M4; `src/renderer/src/keymap/places.ts`, pure, and `visits.ts`)

```ts
export type Under = { kind: 'tab'; id: string } | { kind: 'page'; destination: Destination };
export type Place = Under | { kind: 'overview'; over: Under };
export interface PlaceRecord { entries: readonly Place[]; at: number }   // at: the entry the window is at; -1 while empty
export const PLACES_MAX = 50;

export function samePlace(a: Place, b: Place): boolean;   // a tab by its id; a page by its kind; the Overview by what it is over
export function seen(record: PlaceRecord, place: Place): PlaceRecord;
export function gone(record: PlaceRecord, tabIds: ReadonlySet<string>): PlaceRecord;
export function target(record: PlaceRecord, delta: 1 | -1): { place: Place; at: number } | null;

// visits.ts
export type Opened = { kind: 'session'; appSessionId: AppSessionId } | { kind: 'artifact'; artifactId: string; machine: MachineRef };
export const useVisits: UseBoundStore<StoreApi<{ record: PlaceRecord; opened: readonly Opened[] }>>;   // opened: newest first, each once
export function connectVisits(): () => void;   // the reader, the two handlers; mounted once from App.tsx after the layout's persistence is connected
```

`seen(record, place)`, the first rule that applies:

1. `place` is the entry at `at`: that entry is replaced by `place` (a page's view and filter follow) and nothing else changes.
2. The entry at `at` is the Overview over `place`, or is a page while `place` is a tab; and `place` is the entry before it: `at` moves back by one. No entry leaves.
3. Otherwise the entries after `at` leave, `place` is appended and `at` is on it. Past `PLACES_MAX` the oldest entry leaves.

`gone(record, tabIds)`: every tab entry with such an id leaves, and every Overview entry over one; two neighbours that are then the same place become one entry; `at` stays on its entry when that survives, else moves to the nearest entry before it that does (-1 when none).

The reader's place for a layout: the page when one is open, else the tab in front; the Overview over that when `overviewOpen`. An empty pane in front is no place. The Settings dialog is not read. Per read, in this order: `gone` for the tab ids the strip no longer holds; then, unless the read differs from the last one in `focusedPane` alone, `seen` for the place.

`opened` gains an entry when a session's tab or an artifact's tab comes to be the place in front (by any route, a step included), and when a side tab's `panelParams` come to name another artifact after hydration (decision 18).

### §E. The palette (M5)

```ts
// src/renderer/src/palette/recent.ts
export const RECENT_MAX = 8;
// src/renderer/src/palette/artifacts.ts
export interface ArtifactSearch { query: string; groups: { machine: MachineRef; rows: LibraryRow[] }[] }   // machines that answered, this Mac first
export function searchArtifacts(client: MawsBridge, query: string, machines: readonly MachineRef[]): Promise<ArtifactSearch>;
export function openPaletteArtifact(artifactId: string, machine: MachineRef): void;
```

`listable(id, table)` in `CommandPalette.tsx`: the row is not `fixed`, and is not a `renderer` row whose scope is `pane` or `composer`. A row is drawn when it is listable and has a handler. `UNAVAILABLE` and `ActionItem`'s disabled form go.

`openPaletteArtifact`, the artifact link's rule with the session on screen (`focusedSession()`) in the link's place:

1. `recordArtifactMachine(artifactId, machine, local)`.
2. A session is on screen and `showOpenArtifactTab(session, artifactId)` answers true: done.
3. A session is on screen, `canShowArtifactInPanel(session)`, and `sessionArtifactMachine(session, artifactId, local)` is `machine`: `openArtifactInPanel(session, artifactId)`.
4. Otherwise `openArtifactTab(artifactId, undefined, machine)`. This is the case of no session on screen, and of a session on another machine than the artifact's, beside whose chat the side column would read the artifact on the wrong machine.

A recent artifact's row is drawn with the title `library.get` answers for it; a row whose answer is null, or has not come, is not drawn. Sessions' rows are drawn at once. "Search the Library for “…”" calls `setLibraryView({ view: 'all', query, kind: null, spaceId: null, machine: null })` and `openArtifacts()`.

### §F. The mode said aloud (M2; `composer/Composer.tsx`)

One element, `data-mode-announcement`, `aria-live="polite"`, visually hidden (Radix's `VisuallyHidden`, as the palette's title is), rendered on every render of the composer. Its text is empty or `Permission mode: <label>`, the label from `MODE_OPTIONS`. S4 gives when it is written.

### §G. Zoom (M6)

```ts
// src/shared/ipc/schema/layout.ts
export const WindowZoomSchema = z.strictObject({ version: z.literal(1), factor: z.number().min(0.5).max(2) });   // key `window.zoom`, main only, never crosses IPC
'layout.zoom': { input: z.strictObject({ to: z.enum(['in', 'out', 'actual', 'current']) }), output: z.strictObject({ factor: z.number() }), owner: 'main' }
'layout.zoomChanged': z.strictObject({ factor: z.number() })   // an event, to every app page

// src/main/zoom.ts (new; `nextFactor` and `readFactor` import no Electron)
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export function nextFactor(current: number, to: 'in' | 'out' | 'actual' | 'current'): number;   // stepZoom over ZOOM_PRESETS, held to the two bounds
export function readFactor(stored: unknown): number;                                            // 1 for an absent or invalid value
export function zoomOf(contents: WebContents): number;   // the factor of the app window that hosts these contents (its own page, or a view attached to it); 1 for any other

// src/renderer/src/stores/zoom.ts (new)
export const useZoom: UseBoundStore<StoreApi<{ factor: number }>>;
export function connectZoom(client?: MawsBridge): () => void;   // reads `layout.zoom { to: 'current' }`, follows the event, sets --app-zoom on the root, registers the three handlers by the factor
```

`'window.zoom'` joins `LayoutKeySchema` and `MAIN_KEYS`. It is written at once, as `library.exportFolder` is; only `window.main` is debounced.

How the factor comes to be in force, each a private function of `zoom.ts` whose form M1 decides: `openAt` (before the first paint of a window being made: M1's row f), `applyAfterLoad` (after a load of the page: row e), and, only on a ruling after a failed row c or d, `leaveAtActualSize`.

The six placements. "Multiply" and "divide" are by `zoomOf` of the app page concerned; at factor 1 each is what it is today.

| # | what is placed | the narrowest place | today | under the factor | owner |
|---|---|---|---|---|---|
| 1 | the in-app browser's view | `ViewManager` in `src/main/browser/view.ts`: the placement keeps the CSS rectangle `browser.view.place` sent; `attach` and every later `setBounds` of it multiply. A function of the manager applies every placement of one window again, called from S3 | `setBounds(rect)` as sent | multiply | U12 |
| 2 | an extension's popup | the head of `ExtensionPopups.open` in `src/main/browser/extensions/popup.ts`, where the anchor arrives; the kept anchor stays in CSS pixels and `preferred-size-changed` and S3 place from it | the anchor mixed with window points | multiply the anchor | U12 |
| 3 | the bookmarks menu, an extension's action menu, the puzzle's menu | where `NativeMenus` hands a menu to its presenter (`present` in `src/main/browser/bookmarks/menu.ts`), which all three reach: before the presenter, so that the e2e seam, which stands in for the native call, records the point handed over | `popup({ window, x, y })` as sent | multiply | U12 |
| 4 | the comment's pin | the call of `pickPosition` in `src/main/browser/comment/mode.ts`: its factor becomes the tab's over the app's | the tab's window points, drawn by the window as CSS pixels | divide | U12 |
| 5 | the traffic lights | `src/main/window.ts`: `setWindowButtonPosition({ x: 16, y: Math.round(22 * factor - 7) })` at a window's making and in S3; in `app/Toolbar.tsx` the 78 px kept clear becomes `calc(78px / var(--app-zoom, 1))` | `{ x: 16, y: 15 }` in a toolbar 44 CSS pixels high | the lights stay centred in the toolbar's height and clear of its controls | no child (`window.ts`); U7 (`Toolbar.tsx`) |
| 6 | the device-size box of the in-app browser | `pageBox` in `src/renderer/src/tools/browser/viewport.ts` | the page's element sized in CSS pixels by the tab's own zoom | divide by `useZoom`'s factor, so the page's viewport is the size named | U12 |

The e2e seam gains what a scene needs to read placement 3: `__maws_browser.menu` records the point the last menu was presented at, in window points (`NativeMenuSeam` in `bookmarks/menu.ts`, read through `src/main/browser/inspect.ts`).

### §H. Files other children own, or that no table names (root UC-8)

| file | owner | the insertion | named by |
|---|---|---|---|
| `src/renderer/src/panel/SurfaceRow.tsx` | U8 | in `toggleSurface`: the two calls after it showed or hid (§B) | the cut's X8 |
| `src/renderer/src/composer/Composer.tsx` | U4 | the live region and its writer (§F); one `await pendingAttach(…)` at the head of `useDraftPort`'s `load`; `attachPasted` in the focus target it registers | the root's table (the live region); the cut's X8 (the rest) |
| `src/renderer/src/composer/editor/controller.ts` | U4 | `attachPasted` on `EditorHandle`; `insertPasted` builds its node through `pastedBlock` | the cut's X8 |
| `src/renderer/src/composer/editor/pasted-block.ts`, `composer/attach-pasted.ts` | new, in U4's directory | whole (§C) | the cut's X8 |
| `src/renderer/src/stores/composer.ts` | no child | one optional member of `FocusTarget` (§C) | new here |
| `src/renderer/src/tools/terminal/` | **in no row of the root's table** (the row gives U6 `terminal/` only); the child's item names `TerminalView.tsx` | the fifth item; `ATTACH` in `copy.ts`; `attach.ts` | new here: the table should name the directory |
| `src/main/browser/view.ts`, `extensions/popup.ts`, `bookmarks/menu.ts`, `comment/mode.ts` | U12 | placements 1 to 4 (§G) | the cut's X8 |
| `src/main/browser/inspect.ts` (with `NativeMenuSeam` in `bookmarks/menu.ts`), `src/renderer/src/tools/browser/viewport.ts` | U12 | the seam's point; placement 6 | new here |
| `src/renderer/src/app/Toolbar.tsx` | U7 | one class: the lights' clearance (placement 5). `PageTitle` is not edited (P5) | new here |
| `src/main/window.ts`, `src/main/app.ts`, `src/main/layout/store.ts`, `src/shared/ipc/names/layout.ts`, `src/shared/ipc/routes.json`, `src/renderer/src/App.tsx` | no child | `zoomMode` and placement 5; the zoom's start and its command; `MAIN_KEYS`; one name; one name; three mounts | new here |
| `src/shared/ipc/schema/layout.ts` | by key | the key `window.zoom`, its schema, one command, one event | the root's row ("a child adds a key of its own") |
| `e2e/cross-build.spec.ts` | the P5 work | one scene, one row of the coverage comment | the root's row (U13a's scenes beside the update scene; each landing since has added its own) |
| `palette/CommandPalette.tsx`, its test | U6 | U1's two entries, U4's two and U11a's one leave with `UNAVAILABLE`, and their cases are rewritten (P9) | the cut, 8 (U11a's is new here) |

Not edited, though the cut or the child's file leads one to expect it: `stores/layout.ts` and `stores/layout-model.ts` (U13's; the record only reads); `tools/code/review/` (U5's; P1); `tools/artifacts/`, `library/` (U10's; decision 18); `src/main/presentations/`, `src/main/repair/` (unless M1's row g); the transcript's scroll code (U3's; only if the `e2e:transcript` scene fails, and then on a ruling).

### §I. The scenes (M7), by group, each with what it waits on

No spec file is added. Every scene reads a state it polls for; none reads a position or a count after an act it did not wait for.

| group, file | the scene | what it waits on |
|---|---|---|
| `e2e:layout`, `e2e/ux2-shell.spec.ts` | reworked, "U6a: ⌘J, ⇧⌘D and ⇧⌘F show and hide …": after each menu click, where the keyboard is (B1), the open-column path included; the Edit, Go and View menus and the sheet hold the six rows in their places (B13) | the element holding the keyboard being inside the surface, then inside the composer (polled); the menu item's `enabled` read from the application menu (polled) |
| the same file | new, "U6b-5: Back and Forward walk the places the window showed" (B7): A, B, Customize; back twice, forward; the dialog over B; the ends; a closed tab | the tab in front by its `aria-selected`, the page by its region, the menu items' `enabled` |
| `e2e` and `e2e:layout`, `e2e/shell.spec.ts` | reworked, the palette's step ("Item 8"): the rows listed are those that can run, none `aria-disabled`; Recent first with nothing typed. "The Overview over a page" stands unedited and must pass: it pins P5's default. One step added to "a page beside the sidebar": after Esc, Go ▸ Forward is enabled | the option count after the dialog's list is drawn; the menu item's `enabled` |
| `e2e`, `e2e/palette.spec.ts` | reworked, the two reveal scenes: End no longer lands on the project (the last row is the Library's); they select the project's row by its value. New, "an artifact found by its title opens beside the chat" (B6) | the Artifacts group's option for the typed title; the side column's tab that shows the artifact |
| `e2e:terminal`, `e2e/terminal.spec.ts` | new, "Attach selection to chat": the menu's fifth item with a selection (B2), the screen with none (B3), a pinned terminal beside another session with a reload before its session is opened (B4). Where the group's harness draws no composer for a session, the three scenes go to `e2e/composer.spec.ts` | the composer's pasted chip and its text; the line's text; after the reload, the session's box holding the chip. "Nothing was sent" is read from the transcript's rows, with a send at the scene's end as the control |
| the same file | new, "zoom: the grid refits and a selection is under the pointer at 125 %" (the child's probe 3) | the pty's reported size after the zoom; the selection's text |
| `e2e:composer`, `e2e/composer.spec.ts`; `e2e:lane-a`, `e2e/lane-a.spec.ts` | new step, "⇧Tab says the mode" (B9), on each route | the live region's text |
| `e2e:code`, `e2e/code-editor.spec.ts` | new, "⌘[ and ⌘] change nothing in a file" (B8): the keys pressed in the editor on an indented line | the line's text unchanged after a frame, with ⇧Tab un-indenting it as the control |
| `e2e:widgets`, `e2e/widgets.spec.ts` | "My items on an owner-shaped registry" stands; one assertion added: after ⌘[ in the detail, the tab in front is the same | the list's return |
| `e2e:settings`, `e2e/settings.spec.ts` | new step: Settings › Keyboard lists the six rows with no control (B14) | the rows |
| `e2e:browser`, `e2e/browser.spec.ts` | new, "zoom: the page stays under its frame at 80 %, 125 % and 200 %" (B10, B11; the child's probe 2): the view against its pane, with a menu open over it, and at the Mobile size; Zoom In disabled at 200 %, Actual Size disabled after it is chosen; Mark up's still of the pane at 150 % covering what it covers at 100 %. `expectOnPane` in `e2e/support/browser-scene.ts` takes the factor | the window's zoom store reading the factor, then the view's bounds equal to the pane's rectangle times the factor (polled); the menu items' `enabled` |
| `e2e:browser-chrome`, `e2e/browser-chrome.spec.ts` | new: a popup under its icon and the bookmarks menu under its button at 125 % | the popup's bounds; the seam's point |
| `e2e:browser-comment`, `e2e/browser-comment.spec.ts` | new: the pin on the picked element at 80 % and 125 % | the card's box against the element's |
| `e2e:presentations`, `e2e/presentations-present.spec.ts`, `presentations-export.spec.ts`; `e2e:render-host`, `e2e/render-host.spec.ts` | new: the presenter's window at 100 % while the app is at 150 %; an export made at 150 % equal to one made at 100 %; an artifact's capture the same size at both (the child's probe 5). `e2e:render-host` is a group the cut did not list | the presenter's `getZoomFactor()`; the two exports' page sizes; the two captures' sizes |
| `e2e:transcript`, `e2e/transcript.spec.ts` | new: at 110 % and 80 % a streaming transcript keeps following while a key is pressed in a side surface (the child's probe 4). A group the cut did not list | the follower at the end after each appended row |
| `e2e:cross-build`, `e2e/cross-build.spec.ts` | "(zoom, both ways)" (M7) | as M7 says |

### §J. What a later landing may rely on, by name

- **`pastedBlock`** (`composer/editor/pasted-block.ts`): the one maker of a text block in the composer. Board ticket 733 changes pasted content there and nowhere else.
- **`FocusTarget.attachPasted`** (`stores/composer.ts`) and **`attachPasted(session, text)`** (`composer/attach-pasted.ts`): the way any surface puts text it did not get from the person's typing into a session's box as a block, with the store path behind it.
- **`useVisits`** (`keymap/visits.ts`): the record and the opened list. U13's groups, if they draw a most-recent order, read it here.
- **`zoomOf`** (`src/main/zoom.ts`), **`useZoom`** and the root's **`--app-zoom`** (`stores/zoom.ts`): the factor, for any code that hands a CSS rectangle to a native call or sizes something in window points. A landing that adds such a crossing multiplies or divides by it and adds its row to the table of §G.
- **`focusSurfaceStop`**, **`available`** (`keymap/shell-navigation.ts`).
- **`layout.zoom`**, **`layout.zoomChanged`**; the key **`window.zoom`**.

## The look

Little of this landing is drawn. The terminal's menu gains a row; a line is the app's own toast; the palette's two new groups are rows of the kinds it draws today. No drawn example is needed before the build. The frame below goes to the owner with the cards, for the palette's order; all of its names are invented.

    ⌘K, nothing typed                         ⌘K, "quarter" typed
    ┌──────────────────────────────────┐      ┌──────────────────────────────────┐
    │ Search sessions, projects and …  │      │ quarter                          │
    ├──────────────────────────────────┤      ├──────────────────────────────────┤
    │ Recent                           │      │ Sessions                         │
    │  ● Fix the importer      2m      │      │  ● Quarterly numbers     1h      │
    │  ▤ Launch notes          5m      │      │ Artifacts                        │
    │  ● Draft the changelog   1h      │      │  ▤ Quarter in review             │
    │ Projects                         │      │  ▤ Plan for the quarter          │
    │  atlas                           │      │ Actions                          │
    │ Actions                          │      │  (none matches)                  │
    │  New chat                 ⌘N     │      │ Search the Library for “quarter” │
    │  Back                     ⌘[     │      └──────────────────────────────────┘
    └──────────────────────────────────┘

## The sentences a person reads

One table per surface, each at one place.

**The terminal's attach** (`ATTACH` in `src/renderer/src/tools/terminal/copy.ts`). `<title>` is the session's title as its tab reads.

| outcome | the sentence that is built | card K4's recommended wording |
|---|---|---|
| `added` | Added to <title> | the same |
| `not-started`, `taking-back`, `changed`, `unknown`, `unreachable`, `no-store`, `failed`, `busy` | The selection was not added to <title>. | Not added: <title> has not started. · Not added: <title> is taking a message back. · Not added: <title>'s draft changed. Attach again. · Not added: this terminal's session is no longer known. · Not added: <machine> is not answering. · Not added: <machine> keeps no drafts for this window. · The selection was not added to <title>. · Not added: <title> is sending a message. |
| `unsaved` | <title> has the selection, but its draft could not be saved. | the same |
| nothing to attach | Nothing on this terminal's screen to attach. | the same |

The menu's row and the action's title: "Attach selection to chat" (the child's file).

**The palette** (`palette/CommandPalette.tsx`): the headings "Recent" and "Artifacts" (with two machines, "Artifacts · <machine>"); the last row, "Search the Library for “<the text typed>”".

**The live region** (`composer/Composer.tsx`): "Permission mode: <label>".

**The menus**: the six titles of Interfaces §A.

## The cards for the owner

Each is in the form it could be put to the owner. Each has a default that is built at one named place, so none holds the build.

### K1 · After you close a tab, where does ⌘[ go?

You looked at session A, then at session B. In the strip B stands last, after a tab C you were not looking at. You close B. MAWS shows C, the tab beside it, as it does today.

| | what happens | what it means in use |
|---|---|---|
| **1. The strip decides what a close shows; Back follows what was shown** (built; recommended) | You are on C. ⌘[ shows A. B is gone from Back's list, and Reopen closed tab brings it back | Closing a tab works exactly as today. Back sometimes starts from a tab you did not choose |
| 2. Closing a tab goes back | Closing B shows A, the place you were at before it | What a close shows changes for every tab, with or without ⌘[: the strip's own rule, which you looked at with the one strip, is replaced |

Recommended: 1. The one place: `gone` in `keymap/places.ts` (option 2 would also change `closeTab` in U13's model, which this landing does not edit).

### K2 · You press Esc on a page. Was that Back?

On session A you open Customize, then press Esc, or the page's own Back button. You are on A again.

| | ⌘] then | ⌘[ then | what it means in use |
|---|---|---|---|
| **1. Esc was a step back** (built; recommended) | opens Customize again | shows what you looked at before A | Esc, the page's Back and ⌘[ are one act. The Overview closed with Esc behaves the same |
| 2. Esc is a new step | does nothing | opens Customize again, the page you just closed | Back always undoes the last thing you did, a close included |
| 3. The page's Back and Esc become Back itself | as 1 | as 1 | The same as 1 from a page opened from a tab. From a page opened from another page, Esc shows that page and not your tabs; after a relaunch that restored a page, its Back button has nowhere to go |

Recommended: 1. The one place: rule 2 of `seen` in `keymap/places.ts`; option 3 would also change `PageTitle` in `app/Toolbar.tsx` and the page's Esc (U7's).

### K3 · How far zoom goes, and what tells you the size

The steps are the in-app browser's: 50, 67, 75, 80, 90, 100, 110, 125, 150, 175 and 200 %. Claude Desktop goes from 25 % to 500 % in steps of about 10 % and shows a small line, "Zoom 125%", with a Reset button, for a second and a half.

The layout reads the window's width in CSS pixels (`shellGeometry`): under 1,100 it moves the sidebar aside while a side surface is open, and under 700 it draws the side surface over the chat. A window 1,440 points wide has 1,152 at 125 %, 960 at 150 % and 720 at 200 %:

    100 %, 1,440 points wide                       200 %, the same window
    ┌────────┬─────────────────────┬──────────┐    ┌─────────────────────┬────────────┐
    │ atlas  │ Fix the importer    │ Terminal │    │ ☰ Fix the importer  │ Terminal   │
    │  ● Fix │                     │ $ _      │    │                     │ $ _        │
    │  ● Dra │ > run the tests     │          │    │ > run the tests     │            │
    │        │                     │          │    │                     │            │
    │        │ [ composer        ] │          │    │ [ composer        ] │            │
    └────────┴─────────────────────┴──────────┘    └─────────────────────┴────────────┘

| | what you get | what it means in use |
|---|---|---|
| **A. 50 % to 200 %, nothing on screen** (built) | View ▸ Actual Size is enabled away from 100 %, and that is the only sign | Nothing new on screen. After two presses you cannot read which size you are at |
| B. The same range, and a line for a second and a half (recommended) | "Zoom 125 %" in the app's own line, no button, also said to a screen reader | You see the step you landed on. One short line per press |
| C. Claude Desktop's line with its Reset button | as B, with a button that returns to 100 % | One more control, for an act the View menu already has |

A second choice, on any of the three: hold the top at 150 % instead of 200 %. At 200 % a window under 1,400 points wide draws the side surface over the chat; at 150 % that starts under 1,050.

Recommended: B, with 200 % kept. The one place for the range: `ZOOM_MIN` and `ZOOM_MAX` in `src/main/zoom.ts`; for the line: `connectZoom` in `stores/zoom.ts`.

### K4 · What MAWS says when a selection could not be added

You attach a selection from a terminal that is kept open for every session. Its own session is not on screen, and the selection cannot be put in that session's draft.

| | what you read | what it means in use |
|---|---|---|
| **A. One sentence for every cause** (built) | "The selection was not added to <title>." | You know it failed and that the selection is still selected. You do not know whether to try again |
| B. The cause in the sentence (recommended) | the second column of "The sentences a person reads" | You know what to do: open the session, wait, or try again |
| C. B, with one button where there is an act | B, and "Open <title>" on the line for a session that has not started | One click to the place where the attach will work |

Recommended: B. The one place: `ATTACH` in `tools/terminal/copy.ts`.

## Proof that an executor does not run

Each is a step with what it needs, handed to the architect.

| # | what | when | what it needs | what comes back, and the one place it changes |
|---|---|---|---|---|
| 1 | **M1's probe scenes on real builds** | after M1 is pushed | A Mac under the load rule. `MAWS_ZOOM_PROBE=1` with the cross-build group and `--peer-exact f1852de3a`, then `--peer-exact 2c7044231`, for "(zoom probe)"; the three placement probes alone in their groups (`e2e:browser`, `e2e:browser-chrome`, `e2e:browser-comment`) | The recorded lines: the peer's factor after an ordinary quit and after a forced exit, in each mode (`zoomMode` in `createWindow`; P7); each placement's rectangle beside its DOM rectangle at three factors (that row of Interfaces §G) |
| 2 | **M1's look** | with 1 | The same Mac: the placements' probe with `MAWS_ZOOM_PROBE_HOLD=1` and `MAWS_E2E_QUIET=0`, which stops with the window shown at each factor | Where the lights stand and whether the title bar drags over its whole height (placement 5; a band that does not follow is reported, not fixed here); whether a terminal's text is sharp (the child's probe 3: if not, the terminal is told the factor, which is a ruling) |
| 3 | **The scenes of Interfaces §I** | after M7 | A Mac. The new and reworked scenes alone first, then each group whole: `e2e`, `e2e:layout`, `e2e:terminal`, `e2e:composer`, `e2e:lane-a`, `e2e:code`, `e2e:widgets`, `e2e:settings`, `e2e:browser`, `e2e:browser-chrome`, `e2e:browser-comment`, `e2e:presentations`, `e2e:render-host`, `e2e:transcript` | Each group's result. `e2e:transcript`'s zoom scene failing is the tracker's row of 2026-10-27 made reachable: its fix is one comparison in U3's scroll code, on a ruling |
| 4 | **The cross-build run of record** | on the final head | `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`; and the group as the gate crosses it, against the master this landing merges into and against master at `b89d6d1d7` | "(zoom, both ways)" passed, not skipped, in all four. A skip is not evidence |
| 5 | **The owner's hands** (the child's probe 6) | on the wave's build, on the owner's machines | About ten minutes | ⇧⌘L in a terminal attaches and "Search With Google" does not open; with a terminal holding the keyboard, Edit ▸ Attach selection to chat opened with the mouse is enabled (P8 rests on the menu bar not taking the page's focus, which no scene can press); under the Korean input source ⌘[, ⌘], ⌘=, ⌘−, ⇧⌘L work and ⌘J, ⇧⌘D, ⇧⌘F still do |
| 6 | **The owner's ears** | with 5 | VoiceOver on | ⇧Tab in the composer is heard as "Permission mode: Plan" |
| 7 | **The owner's look at zoom** | with 5 | A page open in the in-app browser, a terminal, a transcript | At 80 %, 125 % and 200 %: the page under its frame, text sharp, nothing cut |
| 8 | **The branch review** | after M7 | `doperpowers:review-code`, the rung "Size and review" names | A verdict and findings; the fixes are one wave through the controller |
| 9 | **Class 1a** | once, on the head the pull request will carry | `scripts/ci-gate.sh` with the static, unit and probe gates | The run's id |

No unit case of this landing is guarded to macOS. No paid live group is touched: no scene of `p1-live` crosses this change.

## Size and review

Counted from the code at the pin, tests and scenes included. The cut's figure for the whole landing was 2,600 lines over 55 files.

| milestone | changed lines, about | files, about |
|---|---|---|
| M1 the spike | 450 | 9 |
| M2 show and hide, the mode | 400 | 11 |
| M3 attach | 950 | 19 |
| M4 Back and Forward | 750 | 11 |
| M5 the palette | 700 | 6 |
| M6 zoom | 900 | 28 |
| M7 scenes and record | 550 | 20 |
| **the landing** | **4,700** | **88** (some files are counted in two milestones) |

**One pull request or two: two is the recommendation.** The cut names the line: zoom apart from the rest.

| | what it holds | what it proves alone | size | what it waits for |
|---|---|---|---|---|
| **U6b-5a, the keyboard** | M2 to M5, and M7's scenes, row-test edits and record for them | B1 to B9, B13 and B14 for three rows (`terminal.attachSelection`, `go.back`, `go.forward`) | about 3,200 lines over 55 files | nothing of M1 |
| **U6b-5b, zoom** | M1, M6, and M7's zoom scenes, the coverage row and "(zoom, both ways)" | B10 to B12, and B13 and B14 whole | about 1,500 lines over 38 files | M1's verdict from a Mac; U6b-5a on its head (both add rows to `actions.ts` and cases to the same three row tests) |

Why two. One review would read 88 files of which 28 are the zoom's, in main and in U12's files, with a verification of their own (every proof of zoom is on a Mac, and its first step waits for a measurement on real builds). The keyboard's half is already past the panel's mark by itself. Zoom shares no module with the rest: its only common files are the action table and its three tests. Cut off, a late answer from M1 holds zoom alone and not the four items the owner asked for by name.

What one pull request would buy: one set of Mac runs for the groups both halves touch (`e2e:layout`, `e2e:terminal`), and one stay in the chain.

If two: U6b-5b is a branch cut from U6b-5a's head, carrying M1's commits; this document serves both, and its Progress marks which milestones belong to which. Nothing else in it changes.

**Review.** U6b-5a: the xhigh panel, by size (55 files, past both marks). U6b-5b: the xhigh panel as well, by its file count (38) and because it edits placement code in U12's files that every scene of the in-app browser rests on. As one pull request: the panel.

## Statements to check again once the chain's fourth batch is on master

This document is written against a head that holds eight landings in review. Before an executor starts on a master that holds them, and after any merge that brings a change to one of these places, each statement is read again; one that no longer holds is a stop for the controller.

| # | the statement | where it was read | what would move it |
|---|---|---|---|
| 1 | The composer's text block has one maker, private, and a paste becomes a block only past 20,000 characters | `insertPasted`, `classifyText` | **Board ticket 733** (a paste that holds a line or more goes to the agent marked as pasted content; its design is not written). The meeting point is `pastedBlock` in `composer/editor/pasted-block.ts`: whatever 733 makes of a pasted block it makes of an attached one, there. To check at its design: that a block made by the attach is treated as a paste is (its marking for the agent; how a consent sentence inside it is read, since a terminal's output can hold text a model wrote); whether the block's label should name its terminal |
| 2 | `useDraftPort`'s `load` and `save`, and the focus target's members | `composer/Composer.tsx` | U4b's integrations, any later composer landing |
| 3 | `session.drafts.get` answers a cleared draft as none on this Mac and with its stamp over the link; the claim form's rule | `src/services/index/register.ts`, `drafts.ts` | a change to the draft store |
| 4 | `readRemoteDraft`, `saveRemoteDraftOnce`, `unsavedRemoteDraft` and the order of a session's saves | `lane-b/remote-drafts.ts` | U4b |
| 5 | Only Terminal and a mod's pane take the keyboard on a focus request; Review reads its scope again | `ReviewShell.tsx` | U5b-2, which is on this branch and edits that effect |
| 6 | Files answers no focus request; a Files tab holds a file or none; a frame's body can take the keyboard | `FilesTool.tsx`, `FileBody` | U6b-2 (on this branch), U6b-3 |
| 7 | `toggleSurface` hides the whole column and shows by `showSurfaceTab` | `panel/SurfaceRow.tsx` | a landing of U8 |
| 8 | The table has no `menu: 'edit'` row, so `menu.test.ts` ends the Edit menu on Select All and `keymap.test.ts` finds "Edit › Sample" right after File | the two tests | U3b's Find rows, if they reach the table before this landing: the two cases then change there, and M3 only adds its row |
| 9 | `files.goToFile` is not a row; Go leads with the palette | `actions.ts` | U6b-3: Go to file then stands after the palette, and Back and Forward still lead |
| 10 | `UNAVAILABLE` has ten entries, of U1, U4, U11a and the first build | `CommandPalette.tsx` | any landing that adds an entry: it is removed with the rest, and its row is listed by `listable`'s rule |
| 11 | The palette's reveal scenes press End to reach a project's row | `e2e/palette.spec.ts` | — (reworked here) |
| 12 | The Artifacts tool writes `{ target, machine }` under its tab's `panelParams` when it shows an artifact | `tools/artifacts/ArtifactsTool.tsx` | U10b |
| 13 | An artifact link opens by `showOpenArtifactTab`, else `openArtifactInPanel` | `library/actions.ts` | U6d, U10b |
| 14 | `placeOf`, `commitShown`, `quietly`, `closeDestination`, `setOverviewOpen` as read; the page's Back calls `closeDestination` | `stores/layout.ts`, `app/Toolbar.tsx` | a landing of U7 or U13 |
| 15 | "The Overview over a page" pins that the page's Back leaves the Overview open | `e2e/shell.spec.ts` | — |
| 16 | The six placements, their files and their directions; `Placement.measure` sends only a changed rectangle; `pageBox` sizes by the tab's zoom | Interfaces §G | any landing of U12 |
| 17 | `ZOOM_PRESETS` and `stepZoom` are exported | `src/main/browser/navigation.ts` | U12 |
| 18 | `MAIN_KEYS` holds two keys; two scenes pin the exact list of stored keys, which this landing does not lengthen at 100 % | `src/main/layout/store.ts`; `e2e/shell.spec.ts` | a landing that adds a key |
| 19 | The count of spec files the gate pins is 109, and this landing adds none | `.github/scripts/e2e-default-specs.test.mjs` | — |
| 20 | Build M is `2c7044231` and knows the claim form; build F is `f1852de3a` and does not. All three builds run Electron 44.4.5 | `git show` at each | a new build in use; an Electron bump, which would send M1's harness to be run again |
| 21 | No site of the guard of who sends as the person changes | `test/support/person-sends.test.ts` | — |

## The pull request

The body is the short form the owner chose on 2026-11-17: the proof, what differs from the plan, what is left over.

## Surprises & Discoveries

Found while this document was written; each changed a decision above.

- Observation: the window's read of a draft on this Mac hides a cleared draft, so the cut's "save naming the draft it replaces" is refused on every session that has sent a message.
  Evidence: `register('session.drafts.get', …)` answers `index.drafts.get` unless the request came over the link; `DraftStore.set` compares `(kept?.updated_at ?? null) !== replaces`, and a cleared row keeps a stamp (`src/services/index/drafts.ts`).
- Observation: a terminal can belong to a session that has not started, and stay so.
  Evidence: `createForLaunch` runs at `launching`, before the engine; `rollbackIntent` removes the record and keeps the intent; `events.ts` drops a removed session's side tabs only when nothing retains its tab.
- Observation: Review takes no keyboard on a focus request.
  Evidence: `ReviewShell.tsx`'s effect over `focusRequest` calls `useReview.getState().refresh(target)` and focuses nothing.
- Observation: six placements assume a CSS pixel is a window point, and the browser's view is not sent again when its CSS rectangle is unchanged.
  Evidence: `TRAFFIC_LIGHTS = { x: 16, y: 15 }` with `pl-[78px]` in `Toolbar.tsx`; `pageBox` in `tools/browser/viewport.ts`; `if (same(rect, this.sent)) return;` in `tools/browser/placement.ts`.
- Observation: Electron 44.4.5 has a zoom mode that is not shared by origin.
  Evidence: `setZoomMode(mode: 'default' | 'isolated' | 'manual' | 'disabled')` and `zoomMode?: string` in `electron.d.ts`: "`isolated` - Zoom changes are handled automatically but on a per-webContents basis."
- Observation: the table's test already holds the six chords, and its count of U6b's rows includes U6b-3's.
  Evidence: `WAVE_DEFAULTS` under "// U6b"; "each must exist (U6b adds its seven; U11a its one)".
- Observation: Claude Desktop `app-5.1231.2`, read for the five acts. It zooms by level in half steps between 25 % and 500 %, stores no zoom of its own, disables Actual Size at 100 % and shows a line with the percentage (`main-process/index.chunk-BV3uOqbK.js:327946-327999`, `:328474-328478`; `web/app/v1/ccce0aa9f-CEzQPX52.js:281-411`). Its Back and Forward are the main view's own navigation history, so they give MAWS's record no model. Its attach makes a snippet labelled with the terminal's tab, takes the viewport's rows when nothing is selected, and says nothing when it cannot attach (`web/app/v1/c03935b01-nTCeq8MH.js:8441-8475`, `c6bf19e8f-FP4iLEoJ.js:3563-3584`). Its palette hides what cannot run and lists recent items of mixed kinds, artifacts among them (`web/app/v1/c2771e1f6-CK6VDvCi.js:7759-7787`, `:8335-8337`). It has no ⇧Tab for the mode and no announcement of it: MAWS's sentence is its own.
  Evidence: the lines cited, read in the build's readable tree.

## Decision Log

1. **2026-11-17 (UTC) · The verification call.** This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets `doperpowers:review-code` at the xhigh panel, by size, for either pull request if there are two ("Size and review"). Class 1a on GitHub Actions is the gate of record. The cross-build runs of record are `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`.

## Outcomes & Retrospective

Pending — written at finish.
