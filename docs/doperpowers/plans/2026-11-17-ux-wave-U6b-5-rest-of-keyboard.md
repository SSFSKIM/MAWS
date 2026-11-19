# UX wave · U6, the fifth landing of U6b, first half (U6b-5a): the rest of the keyboard

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), its landing **U6b-5a** (board ticket 674, under ticket 592). **Parent pin:** `bdbfe863e6b2f59031c10f0c51873c4a0210b00b`, the commit every statement about the code below was checked against: master as it stood on 2026-11-17 (`77af813a4`; the merge base `5d4a8d3a0` differs from it by one line of the debt tracker) plus the eight landings of the chain's fourth batch, which are in review and not on master. The root and the child's file are read at that commit.
>
> **What is settled before this document:** the cut, `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, section "U6b-5", its Decision Log 6, 7 and 9 and its ruled points X4, X6 and X8, cited below as *the cut*; and, on this document's first writing (`8d1235ea6`), the adversarial review of 2026-11-17 and the architect's rulings on it and on the ten points (Decision Log 2 to 4). This document carries the constraints and the milestones; the design is the child's file and the cut.
>
> **Revision 2 (2026-11-17).** The first writing was one document for the whole of U6b-5. The architect ruled it into two landings. **This document is U6b-5a, the keyboard:** the keyboard on show and hide, "Attach selection to chat", Back and Forward, the palette, the mode said aloud, and three of the six rows. **U6b-5b, zoom,** is `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md`: its spike, its build, its scenes, the stored key and the other three rows. What moved here: the six findings of the review that bind this half are designed in ("The adversarial review's findings, and the rulings"); the milestones are numbered again, M1 to M5 (the first writing's M2 to M5, and its M7 for this half); decisions, sequences, points and acceptance items keep the first writing's numbers, so that the review and the rulings can be followed, and the gaps in them are the other half's.
>
> **Revision 3 (2026-11-17).** A delta review of revision 2 (`ee20c0074`; one reviewer, medium rung) closed findings 1, 4, 5 and 6 for this half and left 2 and 3 partly closed, with one finding of the first rank and three of the second on this document. The architect read each cited place and ruled (Decision Log 6). What moved: S1 waits for every send of the session, counts an unaccounted write at every end, and ends its last round on a read; M2 follows M1.
>
> **Revision 4 (2026-11-17).** A narrow re-check of S1 (`37074c0b6`; one reviewer, medium rung) found the send's row closed and three gaps in what "accounted for" and `changed` mean. The architect ruled on them and added a bound on the whole hand-over (Decision Log 7). With this the review of S1 stops: what is found while building goes to a tracker row unless it loses a block.
>
> **Revision 5 (2026-11-17).** The owner answered this half's three cards (Decision Log 8). K1 and K2: the built defaults. K4: the cause in the sentence, which was not the default; the sentences that are built are now those.
>
> **Branch:** `ux-wave/U6b-5`. **Order in the chain:** after U6b-3b, before U6b-5b. It is built on a head that holds every landing before it in the chain; "Statements to check again" lists what is read again on that head. **Not in this landing:** zoom (U6b-5b); Go to file (U6b-3); links, notices and "Open in" (U6b-4); a bottom drawer; a printable sheet; history across relaunches.

## Purpose

After this landing the keyboard reaches what the wave built and comes back from it. A side surface shown by its key has the keyboard, and hidden by its key gives the keyboard back to the composer. Text selected in a terminal goes into the chat of that terminal's session with ⇧⌘L or from the terminal's menu, as one pasted block, and is never sent by itself. ⌘[ and ⌘] walk the places the window has shown. ⌘K opens on what was used last and finds artifacts. A change of the permission mode with ⇧Tab is said to a screen reader. The shortcut sheet has three of its six missing rows; zoom's three come with U6b-5b.

How to see it working: the acceptance below, B1 to B9, B13 and B14. The unit half runs on the build VM; the scenes run on a Mac, and two checks are the owner's own.

## Progress

- [x] (2026-11-17 07:30Z) The cut's section, the child's items and the ticket read against the pin; the named question answered from the code.
- [x] (2026-11-17 08:05Z) The first writing (`8d1235ea6`): ten points for ruling, four cards, seven milestones for the whole of U6b-5.
- [x] (2026-11-17) The adversarial review of the first writing (two findings of the first rank, seven of the second; all nine accepted) and the architect's rulings: every point accepted, four of them as the findings correct them; two landings.
- [x] (2026-11-17) Revision 2: this document for U6b-5a; the six findings that bind it designed in.
- [x] (2026-11-17) The delta review of revision 2 and the architect's rulings on its four findings here; revision 3.
- [x] (2026-11-17) The re-check of S1 and the architect's four rulings; revision 4. The review of S1 is closed.
- [x] (2026-11-17) The owner's answers to K1, K2 and K4; revision 5.
- [x] (2026-11-18) `origin/ux-wave/U6b-3b` (`6ee3382a7`, holding U6b-3a) merged (`74baf7950`); the twenty statements of "Statements to check again" read on that head (Decision Log 9). Master is not merged during M1 to M4: the chain's and master's merges before the landing are the architect's.
- [ ] M1 — The keyboard on show and hide, and the mode said aloud. Built `a3c55fb0f`..`9cec26264` (Decision Log 10); its review is pending.
- [ ] M2 — "Attach selection to chat".
- [ ] M3 — Back and Forward. Built `b1b1e755d`..`14a54bb50` (Decision Log 11); its review is pending.
- [ ] M4 — The palette: Recent, Artifacts, ranking, no row that cannot run.
- [ ] M5 — The scenes, the record, and the acceptance run.

## Words used in this document

- **Build F, build M.** The two older builds that bind (root UC-14, and the architect's rule for this wave's later landings that two older builds bind, not one): build F is `f1852de3a`, kept as the build to go back to; build M is `2c7044231`, the build every machine runs. Both are read with `git show <sha>:<path>`.
- **A side surface, the side column.** A tool shown beside the transcript (Terminal, Review, Files, Browser and the others), as a tab of the side column (`src/renderer/src/panel/`).
- **A focus request.** The counter by which the side column asks a tab to take the keyboard (`requestFocus` in `panel/host.ts`; `PanelToolContext.focusRequest` in `panel/tool.ts`). A tool answers it or not.
- **F6's stop.** The element F6 lands on for a region (`regionStops` in `src/renderer/src/keymap/shell-navigation.ts`): for a side tab, the first control of its panel, else the panel.
- **A pasted block.** The composer's atom for pasted text (`PASTED`, `pastedNode` in `src/renderer/src/composer/editor/doc.ts`): one chip in the box. Each has an `id`.
- **An attach.** One press of "Attach selection to chat". It mints one block with one id of its own, and that id is how every later step knows whether the block is already where it should be.
- **The authority over a session's draft.** While a composer is mounted for the session, its editor: it saves its whole document over the store, and on this Mac names no revision when it does. While none is mounted, the store (`session.drafts.get`, `session.drafts.set`).
- **The hand-over.** What an attach is from its press until its block is held, once, by the authority: a loop that asks the authority of the moment and starts again when the authority changes under it (S1).
- **A cleared draft.** What a send or a clear leaves in the draft store: a row with no document and a stamp of its own (`CLEARED` in `src/services/index/drafts.ts`). The window's read of a session on this Mac answers it as "no draft", without the stamp.
- **The claim form.** The value `DRAFT_CLAIM` of `session.drafts.set`'s `replaces`: the save is taken only where no draft with a document is kept, whether none was ever written or one was cleared. Build M's store knows it; build F's reads it as a revision it does not hold and refuses the save as stale.
- **A send in flight.** A submission of the session's box that has been handed over and has not settled (`submissions` in `composer/editor/controller.ts`). It outlives its composer: when it settles it writes the session's draft (a clear when it was accepted, the text back when it was refused), whether or not the composer that started it is still mounted.
- **A definite answer.** An answer to a write that the store itself worded: accepted, or refused with one of its own sentences. A `timeout`, or any failure of the route, is not definite: the write may still land.
- **A place.** What Back and Forward walk: a main tab, a page (Customize, Projects, the Library), or the Overview over one of these. A side surface, a file open beside the chat and the Settings dialog are not places (the child's file, l7-shell-09).
- **The record.** The list of places the window has shown in this run, with the entry the window is at. It lives in the window's memory and is never stored.
- **The navigation projection.** The part of the layout the record reads, and nothing else of it: the page that is open, whether the Overview is open, each pane's tab in front, which pane has the keyboard, and the ids of the tabs in the strip. A layout write that changes none of these is invisible to the record.
- **A step.** One Back or one Forward.
- **The chain's fourth batch.** The eight landings on the pin that are not on master yet.

## The landing's edge

**In.**

| the child's item | what this landing builds of it | acceptance |
|---|---|---|
| l5-code-08, its rest | a surface shown by its key takes the keyboard on every path and gives it back to the composer when hidden; "Attach selection to chat" in the terminal's menu and on ⇧⌘L | B1 to B5 |
| l7-shell-06 | ⌘K: Recent, Artifacts, ranking, no row that cannot run | B6 |
| l7-shell-09 | Go ▸ Back and Forward, ⌘[ and ⌘]; the file editor gives up the two chords | B7, B8 |
| l7-shell-13, its rest | the mode change said aloud | B9 |
| three of UC-6's six rows | `terminal.attachSelection`, `go.back`, `go.forward` | B13, B14 |

**Not in**, beyond the header's list: any change to which tab the strip shows after a close (U13's model; card K1); any change to what Esc or the page's own Back does (U7's; card K2); any change to how a pasted block's text leaves the composer, on a send or in a side question (board ticket 733; finding 1).

**The two halves are sequential, not independent.** U6b-5b is cut from this landing's head. They edit some of the same files, each its own lines:

| file | this half (U6b-5a) | U6b-5b |
|---|---|---|
| `src/shared/keymap/actions.ts` | the rows `terminal.attachSelection`, `go.back`, `go.forward` | the rows `zoom.in`, `zoom.out`, `zoom.reset` |
| `src/shared/keymap/actions.test.ts` | `LANDED` gains these three ids and no other: the test requires every id it lists to be a row | `LANDED` gains its three |
| `src/main/menu.ts` | `SHELL_FOCUS_ACTIONS` gains the nine `surface.*` ids and the two `go.*` ids | the comment "No zoom roles" is rewritten; no code |
| `src/main/menu.test.ts` | the Edit menu's case, Go's lead, the `it.each` of the focus actions | the zoom items' place in View |
| `src/renderer/src/settings-tab/keymap.test.ts` | the `Edit` group; three ids in the list of rows that take no rebinding | three more ids in that list |
| `src/renderer/src/App.tsx` | two mounts: `connectVisits`, `connectTerminalAttach` | one mount: `connectZoom` |
| `e2e/ux2-shell.spec.ts` | the keyboard's place after each surface key; Back and Forward; the Edit and Go menus; three rows of the sheet | View's three zoom items; three rows of the sheet |
| `e2e/terminal.spec.ts` | the attach scenes | the zoom scene of the grid |
| `e2e/settings.spec.ts` | three rows with no control | three more |
| `docs/tech-debt-tracker.md` | the row of 2026-10-24 loses Back and Forward and the mode's announcement; new rows (M5) | the same row loses zoom; the row of 2026-10-27; new rows |

`src/renderer/src/app/shell-actions.ts`, which the first writing listed for both, is edited by neither: this half's two handlers are registered by `connectVisits` and the other's three by `connectZoom`. Neither half moves the wire's minor.

**Left over, each for a tracker row (M5).** A write in the claim form whose answer was lost can land after a later clear of that draft and put its block back; the hand-over then ended `unconfirmed` or `added`, never "not added" (S1). It needs this Mac's own daemon to answer late by more than a clear, and loses nothing. Review does not take the keyboard in an element of its own when shown by its key: it lands on F6's stop (P1, as ruled). The label of an attached block is a paste's ("Pasted text #1"); naming it by its terminal waits for ticket 733's design of pasted content.

## What the code holds today

Each statement was read at the pin. "The cut" names the cut's decision of that number in its section "U6b-5".

| # | what the cut or the child's file says | what the code holds | where |
|---|---|---|---|
| 1 | The six rows are missing | So. The table's test already names their chords under "U6b" and holds a row to them from the landing that adds it. Its list of landed rows requires every id it names to be a row, so a landing adds only its own ids to it; its comment "U6b adds its seven" counts `files.goToFile`, which is U6b-3's | `WAVE_DEFAULTS` and `LANDED` in `src/shared/keymap/actions.test.ts` |
| 2 | None of the six takes a rebinding while build F can be gone back to | So: none is in build F's list, and `isRebindable` reads that list | `src/shared/keymap/build-f.ts`; `isRebindable` in `actions.ts` |
| 3 | Terminal and Review take the keyboard when the column opens (the cut, 7) | **Only Terminal does**, and a mod's pane. Review reads its scope again on a focus request and takes no keyboard. Files answers no focus request. The request is made when the column goes from hidden to shown and by `panelHost.selectTab`; `toggleSurface` on an open column calls `showSurfaceTab` and asks nothing | `takeFocusRequest` in `tools/terminal/TerminalView.tsx`; `ReviewShell.tsx` (the effect over `focusRequest`); `engine-surface/PaneTool.tsx`; `connectPanelHost` in `panel/host.ts`; `toggleSurface` in `panel/SurfaceRow.tsx` |
| 4 | Nothing gives the keyboard back | So. Hiding with a surface's key hides the whole column (`hideSurfaces`), both groups | `toggleSurface` |
| 5 | A chord pressed in a page of the in-app browser must name its action in `SHELL_FOCUS_ACTIONS` to move the keyboard | So; the list holds no `surface.*` id | `src/main/menu.ts` |
| 6 | The terminal's menu has four items; a new one needs one read on the renderer interface | So: Copy, Paste, Select all, Clear. The interface has `hasSelection` and `getSelection`; its probe reads a row of the whole buffer but not where the viewport stands, so "what the screen shows" has no reader | `ContextMenu` in `TerminalView.tsx`; `TerminalRenderer` and `TerminalProbe` in `src/renderer/src/terminal/renderer.ts` |
| 7 | A terminal belongs to a session | So: the registry's entry holds `info.appSessionId`, given at `terminals.open`. Which terminal holds the keyboard is read today only for Select All, by the entry whose container holds `document.activeElement` | `ensureTerminal` in `tools/terminal/index.ts`; `selectAllFocused` in `terminal/registry.ts` |
| 8 | Since U4a a paste under 20,000 characters stays inline, and the atom's maker is private (the cut, 6) | So: `classifyText`, `PASTE_INLINE_MAX_CHARS = 20_000`; `insertPasted(text, name)` is a private method that does nothing while a submission is in flight and answers nothing | `composer/editor/paste.ts`, `controller.ts` |
| 9 | The attach reads the stored draft, appends, and saves naming the draft it replaces (the cut, 6) | **The read hides what the save must name.** For a session on this Mac `session.drafts.get` answers a cleared draft as none, without its stamp, and a save naming none is refused as stale wherever a draft was ever cleared, which is every session that has sent a message. The claim form is the value that means "no document kept". Over the machine link the read answers the cleared draft with its stamp | `register('session.drafts.get', …)` in `src/services/index/register.ts`; `DraftStore.set` in `src/services/index/drafts.ts`; `readKept` in `src/renderer/src/lane-b/remote-drafts.ts` |
| 10 | A composer exists for each session (the child's file, "Routes") | A composer is mounted only for the tab in front of a pane, the split's card and the floating card: `Pane` mounts its active tab's body alone. A pinned terminal beside another session belongs to a session with no composer mounted | `TabBody` in `src/renderer/src/main/Pane.tsx`; `focusTargets` in `stores/composer.ts` |
| 11 | A selection waits in the session's draft until its composer opens (the cut, 6) | **A composer that mounts does not wait for anything, and writes over the store.** It restores the stored draft only if nothing was typed or prefilled since it mounted and its box is empty; from its first change its writer saves its whole document, and on this Mac that save names no revision, so it lands over whatever the store holds. A send clears the stored draft when it settles as accepted, and does so after its composer has unmounted too: the clear is the controller's, not the editor's, and only the editor's own tidying is skipped for an unmounted one. So a block written to the store while a composer mounts and is typed in is overwritten by that composer's next save (finding 2), and one the store holds while a send is in flight is cleared when that send settles (the delta review) | `mount`, `saveDraft`, `submit` and `followSubmission` in `composer/editor/controller.ts`; `createDraftWriter` in `composer/editor/drafts.ts`; `ipcDrafts` |
| 12 | The store path works for a session on another machine as on this Mac (the cut, 6) | The window keeps two things apart for such a session: the newest document it has not yet got the machine to take (`unsavedRemoteDraft`), and the revision the machine last answered (`readKept`, kept in the module's own memory). A save the machine did not answer in time "may still land". The helper that sends one save once takes a revision as a string and cannot name "none" | `lane-b/remote-drafts.ts`: `unsavedRemoteDraft`, `readKept`, `saveOnce`'s comment on `timeout`, `saveRemoteDraftOnce(client, appSessionId, draft, replaces: string)` |
| 13 | One pasted block is how the selection reads to the agent (the child's file) | On a send, yes: a pasted block's text goes inside the terminal's pasted tags (`wrapPasted`). In a box whose text begins `/btw` it does not: the question asked is the document's plain text, a block's text in place and unframed (`plainTextOf`). A side question is a one-shot call with no tools and no transcript record (`docs/doperpowers/plans/2026-10-06-e3-side-threads.md`). Promoting side questions into a side thread writes each exchange into that thread's first message (`promotionMessage`) | `serializeDraft` and `plainTextOf` in `composer/editor/serialize.ts`; `submit` in `controller.ts`; `src/shared/anchor/message.ts` |
| 14 | Nothing records places; one subscriber over the place in front (the cut, 2) | So. `placeOf` answers `'settings'`, `'page:<kind>'` or the id of the tab in front. The tab in front changes when the other pane of a split is focused, which changes `focusedPane` alone and which the cut says records nothing. The layout store is also written for things that are no navigation at all (a side tab's stored parameters, a width, a fold) | `placeOf`, `frontOf`, `setPanelParams` in `stores/layout.ts`; `focusPane` in `stores/layout-model.ts` |
| 15 | The page's own title-bar Back becomes this Back (the cut, 2) | The button calls `closeDestination`; its comment says U6b's history takes it over. **Three cases keep it from being a step:** a page restored at a relaunch is the record's first entry and has nothing before it; a page opened from a page would step to that page while Esc, which the button's title names ("Back · Esc"), shows the tabs; and a scene pins that the button under an open Overview closes the page and leaves the Overview | `PageTitle` in `app/Toolbar.tsx`; `e2e/shell.spec.ts`, "the Overview over a page" |
| 16 | The Overview is a dialog over the strip (the cut, 3) | So: `overviewOpen`, set by the toolbar's button, by `tab.overview` and by Esc; an act inside it that changes the strip closes it in a second store write. **Showing a tab or opening a page does not close it:** `activateTab` closes the page and the Settings dialog and leaves `overviewOpen` as it is, and so does `openDestination` | `setOverviewOpen`, `commitShown`, `openDestination` in `stores/layout.ts`; `overview/OverviewPanel.tsx` |
| 17 | The file editor's `defaultKeymap` holds the two chords | So, whole: `keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])`. No unit test and no scene presses them in a file | `tools/code/editor/editing.ts` |
| 18 | The palette lists actions it cannot run, greyed, from a table of reasons in which U1 and U4 have entries (the cut, 8) | So, and U11a has one too (`channel.open`): ten entries. Sessions are found by the sidebar's rule, actions by a substring of the title; nothing is ranked | `UNAVAILABLE`, `paletteEntries` in `palette/CommandPalette.tsx` |
| 19 | Artifacts are asked with `library.list`'s `query`; nothing new is sent (the cut, 8) | So, at this build, build M and build F alike: the filter's `query` and the offer exist in all three | `LibraryFilterSchema` in `src/shared/ipc/schema/library.ts`; `src/endpoint/offers.ts` |
| 20 | Where an artifact link opens it | A main tab that already shows it is brought forward; else it opens beside the chat of the link's session. The side column reads an artifact on the session's machine when the session is on another machine | `showOpenArtifactTab` in `library/actions.ts`; `openArtifactInPanel`; `sessionArtifactMachine` in `artifacts/machines.ts` |
| 21 | ⇧Tab changes the mode and nothing announces it | So. The composer has no `aria-live` region; its `role="status"` lines say other things (the setup's phase, a send on its way, the prompt history). `mode.set` answers when the change has been answered | `Composer.tsx` (the binding of `composer.cycleMode`); `ChipBinding.set` in `composer/frame/bindings.ts` |
| 22 | F6 needs nothing (the cut, 10) | So | `regionStops` |

## The named question: can a terminal belong to a session that has not started?

**Yes, in two ways, and for one of them lastingly.** The adversarial review checked this answer in the source and found it sound, with the qualification written into item 1.

A session has not started while the window holds a setup intent for it and not both a record and an engine status (`useSetupIntent` in `src/renderer/src/sessions/useSetupIntent.ts`). Its draft is then kept in the intent and not in the draft store (`useDraftPort` in `composer/Composer.tsx`).

1. *Before any start, by the way a surface is ordinarily opened, no.* The Terminal surface can be shown on a tab that has not started: the side column knows any session the layout retains, and a tab with an intent is retained (`retainsTab` in `sessions/connect.ts`). But a Terminal tab opened by its key or its icon carries no folder of its own, and starts its shell only once the session's record gives it one (`ensureTerminal`: `cwd = params.cwd ?? workingFolder(shown.session).path`). A session with no record gives none: the tab reads "terminal pending" and holds no terminal. This is a statement about that path, not a proof that it cannot happen: the same function also takes a folder a caller names (`params.cwd`) and a shell it adopts again after a reload, and neither asks for a record. So the built rule does not rest on "it cannot arise": it asks, at the attach, whether the session has started.
2. *While it starts, yes.* The setup makes the record at its `launching` step, before the engine is launched ("the record first", `createForLaunch` in `src/services/sessions/setup.ts`), and removes the intent only at `finishBinding`, after the engine is ready and the first message is handed over. From the record's arrival until the engine's first status the session has a record, so its Terminal tab starts a shell, and it still counts as not started.
3. *After a start that failed, yes, and it stays so.* When a launch fails before a transcript exists, the rollback removes the record and keeps the intent (`rollbackIntent`, step 2). The window drops a removed session's side tabs only when nothing retains its tab (`!currentTabRetention()?.retains(id)` in `src/renderer/src/ipc/events.ts`), and the intent retains it. So the shell that started in case 2 keeps running, in a tab of a session that has not started and has no record again.

**What is built** (the cut's Decision Log 9, as ruled; P3, accepted): where the store is the authority, an attach for a session that has not started is refused with a sentence, and nothing is confirmed. Where that session's composer is mounted, the attach is what a paste there is: the composer's own editor takes the block, and its draft goes where that composer keeps it (the intent).

## The points reported, and ruled

Reported with the first writing; ruled by the architect on 2026-11-17 (UTC) (Decision Log 3). P6 and P7 are U6b-5b's and are in its document.

| # | The point | The ruling | What is built, and the one place |
|---|---|---|---|
| P1 | **Review takes no keyboard on a focus request**, and Files takes none; the cut says Terminal and Review do | **Accepted.** No edit in Review's file; a tracker row for Review's own answer to a focus request | A surface shown by its key gets the keyboard in two steps: the tool's own answer where it has one (Terminal; Files, written here in U6's own `FilesTool.tsx`; a mod's pane), and else F6's stop for that tab. `focusShown` in `panel/SurfaceRow.tsx` (Interfaces §B) |
| P2 | **The cut's store path names a value the store refuses**: on this Mac a save naming "none kept" is stale on any session whose draft was ever cleared | **Accepted, as finding 4 corrects it** | The save names the revision of what the store answered in that round: a draft's, or over the link a cleared draft's stamp; where it answered none, `null` over the link and the claim form on this Mac. Over the link the revision always comes from a read of the machine made in that round, never from the window's memory. `replacesOf` in `composer/attach-pasted.ts` (Interfaces §C) |
| P3 | **The named question's answer is yes**, and the refusal is the store's: a mounted composer of a session that has not started takes the block as it takes a paste | **Accepted** | `notStarted` in `attach-pasted.ts` |
| P4 | **A mounted composer's save is not always the store's answer**: for a session on another machine its port takes an ordinary save in hand | **Accepted, as findings 2 and 3 correct it** | A composer that takes a block where its box cannot have the keyboard saves at once, and the line follows its port's answer. That is one of the hand-over's ends; the others, and what is said when an answer never comes, are S1. `settle` in `attach-pasted.ts` |
| P5 | **The title-bar Back cannot become a step** in three cases (row 15) | **Accepted.** Card K2 stays the owner's | The button keeps its act, and the record reads a page or the Overview that closes onto the entry before it as a step back. `PageTitle`'s `onClick` in `app/Toolbar.tsx` (not edited); rule 2 of `seen` in `keymap/places.ts` (Interfaces §D) |
| P8 | **`terminal.attachSelection` has a handler only while a terminal holds the keyboard**: a row that is always enabled would be listed in ⌘K and do nothing there | **Accepted** | `connectTerminalAttach` in `tools/terminal/attach.ts` |
| P9 | **The palette's table of reasons goes whole**, with U1's two entries, U4's two and U11a's one, and their cases in `CommandPalette.test.tsx` | **Accepted** | A row is listed when it has a handler and the table lets the palette run it. `listable` in `palette/CommandPalette.tsx` |
| P10 | **The cut's size is too small** | **Two landings**, as the review's split verdict corrects the first writing: the halves are sequential, each with its own acceptance, proof, scene groups and tracker rows | "The landing's edge"; "Size and review" |

## The adversarial review's findings, and the rulings

The review of the first writing (`8d1235ea6`) is the adversarial review of 2026-11-17. The architect read every place it cites and accepted all nine findings (Decision Log 2). Six bind this half; findings 7 to 9 are U6b-5b's.

| # | The finding | The ruling | Where it is designed |
|---|---|---|---|
| 1 | **A pasted block's text is not framed on the `/btw` path**: a box that begins `/btw` asks its plain text, a block's included, so the first writing's sentence that ticket 733 could change pasted content "there and nowhere else" was stronger than the code | The route is not closed here. The stronger sentence is dropped, and what holds is stated. The rule for `/btw` is owned by ticket 733's documents (733b, to be written); this landing relies on it by name | row 13; decision 7; Interfaces §J; "Statements to check again", rows 1 and 2 |
| 2 | **Waiting in `load` does not keep an acknowledged block**: a composer that mounts while the write is out can be typed in, then refuses the restore and saves over the block | Required, not optional: a hand-over that covers restore, edit, save and send, with tests of a held write plus typing, plus sending, plus unmounting, each proving the person's edits and the block survive exactly once | decisions 9, 30 and 31; S1; M2; Interfaces §C |
| 3 | **A write that timed out may still land**, so "not added" can be false, and a second attach then doubles the block | A stable identity per attached block; a read that settles it where it can; a third outcome a person reads where it cannot. Card K4 gains that sentence; the test includes a write that landed with its answer lost | decisions 30 and 32; S1; "The sentences a person reads"; K4 |
| 4 | **The remote append used an interface and a revision it did not have** | The one-shot helper's signature is widened in this landing's own file list, with its tests; the document to keep is kept apart from the revision read from the machine; a stale answer forces a real read; tests for a remote draft never written and for a failed ordinary save before the attach | decision 33; S1, the store's round; M2; Interfaces §C and §H |
| 5 | **Back from the Overview never closed the Overview** | Applying a step's target sets the Overview both ways; tests in both directions over tabs and pages | decision 15; M3; Interfaces §D |
| 6 | **A focus-only move was recorded at the next unrelated layout write** | The record compares a navigation projection of the layout, not whole reads; tests for the separated case and the same-turn case, with a real tab activation as the control | decisions 12 and 13; M3; Interfaces §D |

The review's smaller notes are taken as well: the named question's first item is qualified as the default path of opening a surface (above); a control for an absence is in the same test, never merely in the same file (Constraints; M2); a scene that counts the palette's rows waits on the results it counts, not on the dialog being drawn (Interfaces §I).

## Decisions settled at authoring

Each is a means the child's file and the cut leave open, with its reason and what it beat. The numbers are the first writing's; 23 to 29 are U6b-5b's; 30 to 33 are new with revision 2. The shapes they name are in Interfaces.

**The keyboard on show and hide (M1).**

1. **One rule for every way a surface is shown.** `toggleSurface` is the one entry of a surface's icon, its menu rows and its `surface.*` action, and it gives the keyboard the same way from each. All nine `surface.*` ids join `SHELL_FOCUS_ACTIONS`, not the three with default chords: the six others are rows of build F's list, so a person can bind them, and a chord bound to Source control would otherwise show it and leave the keyboard in a web page. It beat the cut's three ids.
2. **Showing: the tool's answer, then F6's stop** (P1). `focusShown(tabId)` asks the tab (`requestFocus`) and, two animation frames later, puts the keyboard on F6's stop for that tab unless the keyboard is already inside the tab's surface. It moves nothing when the tab is no longer in view by then, when a dialog holds the keyboard, or when the person has put the keyboard somewhere else in between.
3. **Hiding: the composer, when the keyboard was in the column or nowhere.** After `hideSurfaces`, if the element that held the keyboard was inside the side column, or nothing held it, the composer of the session on screen takes it (`focusFocused`); where the pane in front holds no composer, the pane does (`focusPaneElement`). A keyboard that was in the sidebar or in the main area stays where it was. With a page open and the tool already in view behind it, the key only leaves the page, as today, and moves no keyboard; a tool the key brings into view from behind a page is shown and given the keyboard as any other.
4. **Files answers a focus request in its own file.** The file's view when the tab holds a file (the editor for text; else the file's body), else the tree: its selected row, else its first row, else the tree itself.
5. **The mode is said once per press, with the mode that resulted.** One visually hidden `aria-live="polite"` region, mounted for the composer's whole life (a region that mounts with its text is not read). The sentence is "Permission mode: <the label the mode chip shows>". It is written for a change made with ⇧Tab and for no other route: the chip's menu says its own selection, and a change the engine makes by itself is not the person's press. It beat `role="status"` on the chip, which would speak on every route. The order of events is S4.

**"Attach selection to chat" (M2).**

6. **What is attached.** The selection as the terminal gives it (`getSelection`), unchanged. With nothing selected, from the chord only: the rows the terminal's viewport shows now, a soft-wrapped line as one line, each row without its trailing spaces, without blank lines at the start and the end (`screenText`, new on the renderer interface). This is Claude Desktop's reading of "what the screen shows" (`web/app/v1/c6bf19e8f-FP4iLEoJ.js:3563-3584`: the viewport's rows, not the scrollback). Text that is empty or only blank attaches nothing and says so.
7. **One pasted block, made at one place; what that does and does not promise** (finding 1). `pastedBlock` in `src/renderer/src/composer/editor/pasted-block.ts` (new) is the only maker of a text block: a paste over the threshold, a dropped text file and the attach all call it. The block is today's node, attribute for attribute, so both older builds draw it as their own. What holds of its text once it is in a box: on a send it goes to the agent inside the pasted tags, as any paste does; in a box that begins `/btw` it is part of the question's text, unframed, in a one-shot call that has no tools and writes no transcript row; and a promotion of side questions frames whole exchanges, not blocks. This landing changes none of the three and makes no promise that a block's origin is visible to the agent on every route. The rule for `/btw` is owned by ticket 733: its first document exists (`docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md`, on its own branch) and does not hold it; it belongs to the second, 733b, which is not written. This landing relies on "the `/btw` rule of ticket 733b" by that name.
8. **Who takes the block is whoever is the authority over the session's draft** (Interfaces §C). A composer that is mounted takes it itself: where its box can have the keyboard, the block and the keyboard and nothing said; where it cannot (a maximized side column covers its pane, or a card holds its box), the block, a save at once, and the line after the save's answer (P4). The composer itself says which, since it knows its own element and its own card. Where none is mounted, the store takes it.
9. **Withdrawn: a composer that mounts waits in `load`** (finding 2). The first writing made a mounting composer wait for the store's write before reading its draft. That delays the restore and nothing else: the person can type in the box meanwhile, the restore is then refused, and the composer's next save, which names no revision, lands over the block after "Added to …" was shown. It also made the restore later for everything else in the stored draft. Decisions 30 and 31 replace it; `useDraftPort` is not edited.
10. **The handler follows the keyboard** (P8). Registered while a terminal holds the keyboard, by `focusin` and `focusout` on the window.
11. **The selection is never cleared**, added or not.
30. **A block has an identity, and every insertion is "unless it is already there"** (findings 2 and 3). An attach mints one id (`attach-` and a random UUID) and gives it to its block as the node's `id`. The editor inserts a block only when its document holds no block of that id, and the store's round writes only when the document it read holds none. So a block can be asked for again, after a lost answer, a changed authority or a refused save, and is never in a draft twice.
31. **An attach is a hand-over that ends only when the authority holds the block** (finding 2; S1). It asks the authority of the moment. A composer that mounts or unmounts while the store's round is out changes the authority, and the round is then not believed: the loop starts again and asks the new authority, which finds the block there already or puts it there once. "Added to …" is shown at that end and at no earlier point. **A send of the session in flight is a writer too, with or without its composer** (row 11): no turn of the loop begins while one is in flight, and a round of the store that one was in flight under is not believed. The loop waits for the send to settle, which is when its write of the draft has been handed over, and turns again; a composer that was sending takes the block then, into the box the send left. It beat a barrier that holds the mounting composer closed until the write is answered: for a session on another machine that is a box that takes no typing for as long as the link takes.
32. **A write whose answer is not definite is settled by a read, and where no read can settle it the person is told so** (finding 3). After a `timeout` the next round's read finds the block's id or does not. If it does not, the same block is written again, naming the revision that read gave: every form the save can name is a guard, so of two writes of one block naming one revision the store takes at most one. Where the read cannot be had either, the outcome is `unconfirmed`, with a sentence of its own: not "added", and not "not added". **An unaccounted write survives every exit:** while a write of the block is unaccounted for, no end of the loop is a refusal, whatever refused; it is `unconfirmed`. And the store's rounds end on a read, not on a write: when the third round has not ended the loop, one last read decides. Two limits on what a read or a later write can settle (the re-check): a write in the claim form that is unaccounted for stays so to the end, because the claim is a guard that can come true again after a clear, where a named revision cannot; and for a session on another machine only the machine's own answer, with no save of the session still out, says that the block is not there. **The whole hand-over has a deadline** (`attachDeadlineMs`): the store's own work at its worst and one more bound for a wait, after which it ends whatever it waits on.
33. **A session on another machine: the document to keep and the revision are two things** (finding 4). The document a round appends to is the newest this window holds for the session that the machine has not taken (`unsavedRemoteDraft`), else what the machine answered. The revision the save names is always what the machine answered in that same round (`readRemoteDraft`, which asks the machine), never the module's memory of it. A stale answer therefore leads to a new read of the machine. The save goes through `saveRemoteDraftOnce`, in the order of the session's other saves, and that helper is widened to name "none" (`replaces: string | null`), in U9's file, with its tests.

**Back and Forward (M3).**

12. **The record is a pure model with one reader, and the reader sees a navigation projection** (finding 6). `keymap/places.ts` is the model; `keymap/visits.ts` reads the layout once per turn of the event loop, in a microtask after the first change, and compares the projection it last held with the projection now. An act that changes the strip and closes the Overview in two store writes is one visit. A layout write that changes nothing of the projection (a side tab's parameters, a width, a fold) is no event at all.
13. **What is a visit, and what a move between the panes is.** A visit: the projection changed in more than `focusedPane`, and the place in front is another than the entry the record is at. Whose act it was is not asked: a tab an agent brings forward is a visit when it comes to be in front; behind an open page it is not in front, and it becomes a visit when the page closes. A change of `focusedPane` alone, with or without unrelated writes in the same turn, adds no visit, then or later: the entry the record is at is pointed at the tab now in front (`refocused`), so the record still stands on what the person looks at, and nothing is left over to be recorded by the next write. It beat keeping the entry on the other pane's tab, which makes the next Back a press that shows nothing.
14. **Leaving a page or the Overview for the place before it is a step back** (P5; card K2). It completes the cut's decision 3, which says such a close records nothing and does not say where the record then stands.
15. **A step applies its target whole, the Overview both ways** (finding 5). The Settings dialog is closed. For a tab or a page: the Overview is closed if it is open, then the tab is shown (`activateTab`) or the page opened as it was left (`openDestination`; its view and filter are kept in the entry while it is the entry in front). For the Overview: the place it was over is shown the same way, then the Overview is opened. All of it runs in one synchronous run, after the record's position is set and before the reader's next read, so the reader finds the projection equal to the entry it stands at and records nothing.
16. **The ends by registration.** `go.back` has a handler while there is an entry before, `go.forward` while there is one after (the cut, 1).
17. **The file editor's keymap is CodeMirror's without the two bindings**, filtered by key (`Mod-[`, `Mod-]`) where `editing.ts` builds it. Tab and ⇧Tab indent as before.

**The palette (M4).**

18. **Recent reads the same module as the record.** Sessions and artifacts that came to be in front as main tabs, and artifacts shown beside the chat. The second is read from the layout, with no edit in U10's files: the Artifacts tool writes `{ target, machine }` under its tab's `panelParams` when it shows an artifact, and a change of that value after hydration is an artifact opened beside the chat. A move between the panes of a split opens nothing.
19. **Ranking orders what today's rule admits; it admits nothing new.** Sessions are found by the sidebar's rule as today, so the two still agree, and are then ordered by `fuzzyScore` of the query against the title; a session found by its project or folder alone has no score and follows. Projects, actions and artifacts likewise. It beat matching by the scorer's subsequence rule, under which three letters match most of the list.
20. **The order of groups.** Nothing typed: Recent, Projects, Channels, Actions. Text typed: Sessions, Artifacts (one group per machine when more than one has matches), Projects, Channels, Actions, then the one row "Search the Library for “…”". The notice about the first 50 shows only with text typed.
21. **Artifacts are asked as conversations are.** 150 ms after the last keystroke, this Mac and each machine `searchedMachines` names, each with `library.list { filter: { query } }`. An answer for a query that is no longer the query is dropped. A machine that does not answer is left out and nothing is said: the Library says its own errors, and the last row leads there.
22. **Enter on an artifact** follows the artifact link's rule with the session on screen in the link's place (Interfaces §E).

## The sequences that must hold

**S1 · The hand-over of one attach** (decisions 8 and 30 to 33). One block B with its id, for session S. Events: the press; a composer for S mounting or unmounting; a send of S starting or settling; the store's read answering; the store's write answering, definitely or not.

The loop turns until it ends. Each turn takes the first row that applies. A turn with a composer and a wait for a send do not count; the store has three rounds, then one last read; and the whole of it has a deadline.

| state | what happens | where it goes |
|---|---|---|
| **The deadline has passed** (`attachDeadlineMs` since the press), whatever the loop is doing or waiting on | The loop stops. An answer that comes later is not read | **ends, `unconfirmed`** when any write of B was sent, accounted for or not; else **ends, refused**: `busy` when it was waiting on a send, `failed` otherwise |
| **A send of S is in flight**, from a composer that is mounted or from one that has since unmounted | Nothing is asked and nothing is read. The loop waits until that send has settled (`submissionOf(S)`): by then its own write of the draft has been handed over, ahead of anything the loop sends next | turns again. One exception, which waits for nothing: a press on a composer that is mounted and sending **ends, refused `busy`** (nothing of B has been written) |
| **A composer is mounted for S** | It is asked to take B (`FocusTarget.attachPasted`): by `press` when it was mounted at the press, by `hand-over` when it mounted later. It waits for its own restore, then inserts B unless its document holds B's id | `shown` (a press, and its box had the keyboard to give): **ends, `taken`**, nothing said. `kept` or `present`: **ends, `added`**. `unsaved`, `closed`: **ends**, refused, or `unconfirmed` (the row below). `busy` (a send began meanwhile) or `gone`: turns again |
| **None is mounted, and a round is left: the store's round** | 0. S has not started: **ends, refused `not-started`**, nothing read. 1. The count of S's composers coming and going is noted. 2. The read: on this Mac `session.drafts.get`; on another machine a read of the machine, and the document to keep (decision 33); a machine that keeps no drafts for this member (`readerRowsOf(S) === 'refused'`) is refused here. 3. The document holds B's id: nothing is written. Else 4. the write: the document with B appended (`appendPasted`; nothing else of the draft changes), naming `replacesOf` of step 2's answer | The read fails: **ends**, by its cause (`unknown`, `unreachable`, `no-store`, `failed`), or `unconfirmed` (the row below). The write is accepted, or step 3 found B: **the round is believed only if** the count of step 1 has not moved **and** no send of S is in flight at its end; believed, it **ends, `added`**; not believed, a composer or a send may have written over the store, and the loop turns again. Refused as stale, or "a draft with a document is kept": the next round. Refused because a message is being taken back, or by any other sentence of the store's: **ends** (`taking-back`, `unknown`, `failed`), or `unconfirmed` (the row below). Not definite (`timeout`, a failure of the route): B's write is unaccounted for; the next round, whose read settles it |
| **None is mounted, and the three rounds are spent: the last read** | Step 2's read, once more, and no write. On this Mac it is judged on what the store answered. On another machine it is judged on the machine's own answer and on nothing the window holds, and only when no save of S is still out in the window's queue (`unsavedRemoteDraft(S)` is undefined): a clear the window has not yet got the machine to take never stands in for a machine document that holds B | B is there, and the read is believed by the rule above: **ends, `added`**. B is not there: **ends, `changed`** when no write of B is unaccounted for, else **`unconfirmed`**. The read fails, or is not believed (a composer mounted during it, whatever it answered), or, on another machine, a save of S is still out: **ends, `unconfirmed`** |
| **Any end that is a refusal, while a write of B is unaccounted for** | | **ends, `unconfirmed`** instead: `closed`, `unsaved`, `taking-back`, `unknown`, `unreachable`, `no-store`, `failed`, `changed`, whichever it was. A refusal says "not added", and that cannot be said of a write that may still land |

A write of B is *unaccounted for* from an answer that was not definite. **A write that named a revision, or named none over the link,** is accounted for when a later read shows B's id or a later write of B is accepted: after either, it can no longer be taken, since the store no longer holds what it named and never will again. **A write in the claim form is never accounted for again in this hand-over:** the claim asks only that no document be kept now, and that can become true again after a clear. (W1, a claim, times out. W2 lands and is cleared by a composer's flush. The last read shows an empty draft. W1 then lands.) So with a claim unaccounted for, the only end that is not `unconfirmed` is `added`, from a round or a last read that is believed and shows B. A read that does not show B's id accounts for nothing: a write may land after that read.

**Only at an end that says `added` is "Added to …" shown, and it is shown once.** The linearization point is the moment the authority holds B with no writer left that began before it: the store's transaction, which compares the named revision and writes in one step (`DraftStore.set`), in a round that is believed; or the composer's insertion with its save answered.

*Why at most once.* The editor and the store each insert B only into a document that holds no block of B's id (decision 30). A composer that mounts restores a stored document that already holds B, and then answers `present`; or one that does not, and then inserts B once; and from then on its whole document is what it saves.

*Why the person's edits are kept.* No round of the store begins while a composer is mounted or a send is in flight, and a round that a composer came or went under, or a send was in flight under, is not believed: the loop turns again and asks that composer, or reads the store again after it. Nothing replaces an editor's document: B is added to it at its end, the caret and the keyboard where they were.

*Why `changed` leaves no block.* It is said only after a last read that did not show B, with no write of B unaccounted for: every write of B was then refused by the store, or was taken and has since been written over, and none can still land. For a session on another machine the read is the machine's own, with nothing of this window's still out, so a block that another device of the member keeps saving there is seen, and the end is then `added` and not `changed`.

*A session on another machine, after a send.* The send's clear goes out in that session's order of saves and may still be out when the loop turns again. The document a round judges and appends to is then the window's own newest (`unsavedRemoteDraft`), and a clear that is still out counts as a document with no block (decision 33): the round writes B, after the clear in the session's order, and a stale answer leads to the next round.

*What happens when an answer never comes.* Main answers every command within its own bound, as `timeout`; that is an answer that is not definite. What has no bound of its own is a wait: for a send to settle, for a composer to restore. The deadline is for those. It is `(2 × ATTACH_ROUNDS + 2)` times the bound of one command on the session's route: `REQUEST_TIMEOUT_MS` (`src/shared/host/host-supervisor.ts`, 10 s) for a session on this Mac, `REMOTE_ACT_PENDING_MS` (`src/shared/machine/remote-pending.ts`, 60 s) for one on another machine. Seven of those are the store's work at its worst, three rounds of a read and a write and the last read, each command at its bound, so the deadline never cuts off an answer that is still due inside its own bound; the eighth is what a wait gets. That is 80 s here and eight minutes there, reached only when everything that can time out does. `ATTACH_ROUNDS` stays the bound on the store's work.

**S2 · The record** (Interfaces §D holds the rules). Events: the projection changed (read once per turn); a tab left the strip; a step. A step sets the position, then writes the layout whole (decision 15). A tab that leaves takes its entries with it before the place is read, so the neighbour the strip then shows is recorded against a record that no longer holds the closed tab.

**S4 · The mode said aloud.** Events: a press of ⇧Tab that asks for a change (P); its answer (A, taken or refused); the chip's mode read after the press (V). The sentence is written once per press, at the later of A and the first render after A, with the mode the chip shows then. A refused answer writes the mode in force at once. A taken answer whose mode has not reached the chip yet writes when it does; if the engine then reports another mode than the one asked (it refused Auto and set a fallback), that mode is the one said. A second press before the first is answered supersedes it: only the last press is said. A press while the chip takes no change (`mode.disabled !== null`) asks nothing and says nothing, as today.

**S5 · Artifacts in ⌘K.** Events: a keystroke; the 150 ms; each machine's answer; Enter. Enter runs the row that is selected when it is pressed. An answer that arrives later adds its rows and does not move the selection (the list is selected by value). An answer for an older query is dropped.

## What is stored and sent, and what each older build does with it

Neither settings file changes (root UC-14). No stored tab, `main.tabs`, `regions` or stored side surface gains a field, and no layout key is added. The wire's minor does not move.

| what | this build | build F (`f1852de3a`) | build M (`2c7044231`) | this build, after a stay on either |
|---|---|---|---|---|
| **A session's stored draft** with one more `pasted` node, whose `id` begins `attach-` | the node as `pastedNode` makes it today; the `id` is a string, as every block's is | its composer has the same node with the same attributes (`PastedAttrs`, `id: string`); it opens the draft and draws the chip. Its own threshold for a paste is lower (1,024 characters), which changes nothing for a block that already is one | the same node; the same threshold as this build | reads its own draft back, with whatever the older build's composer saved over it |
| **`session.drafts.get`, `session.drafts.set { replaces }`**, to this Mac's daemon and, for a session on another machine, to that machine. Both commands and the key exist in all three builds | names the revision the round's read answered; where it answered none, `null` over the link and the claim form on this Mac | a store of F takes a save that names the kept revision, and one that names none where none was ever kept: an attach to a session on a machine of build F works. It reads the claim form as a revision it does not hold: on this Mac, while an updated app still meets a daemon of F, an attach for an off-screen session with no draft is answered stale in each round and, the last read showing no block, ends `changed` | takes every form | no stored form differs |
| **`library.list { filter: { query } }`**, to this Mac and to each machine the conversation search asks | sent with text typed in ⌘K | the offer and the filter's `query` exist | the same | nothing is stored |
| **Action ids** | none is stored: the three rows are not in build F's list, so no route stores a rebinding of one and Settings › Keyboard draws no control | its reader of `settings.json` never meets one | the same; M has the same guard | nothing to read |
| **The record, Recent, a hand-over in flight** | this window's memory, for the run | — | — | the record starts again at the restored tab; a hand-over that had not ended has said nothing |

No row is added to the cross-build coverage table by this half: no stored form is new (a pasted block in a stored draft is what a paste over the threshold leaves there today). Its one new row is U6b-5b's.

## Acceptance

Each item is a behaviour a person can check, numbered as in the first writing (B10 to B12 are U6b-5b's). "Unit" runs on the build VM; a scene runs on a Mac and is the architect's to start. A menu chord cannot be pressed through the scenes' driver (`e2e/support/menu.ts`), so a scene clicks the menu's item by its id; that the key itself reaches the item is the owner's hands (B13).

- **B1** (A7's first sentence, its rest). With the keyboard in the composer, View ▸ Terminal shows the Terminal surface and typing goes to its shell; again, the column hides and typing goes to the composer. The same for Review and Files, each landing where decisions 2 to 4 say. With the column open on Review, View ▸ Terminal shows the terminal and gives it the keyboard. With the keyboard in a page of the in-app browser, View ▸ Terminal moves it to the terminal.
- **B2** (A7). Select text in a terminal and choose "Attach selection to chat" from its menu, or Edit ▸ Attach selection to chat: the composer of that terminal's session holds one pasted block whose text is the selection, the composer has the keyboard, and nothing was sent. A selection of three characters is a block too.
- **B3**. With nothing selected the menu's item is drawn disabled, and Edit ▸ Attach selection to chat attaches what the terminal's screen shows.
- **B4** (the cut's Decision Log 7; finding 2). A terminal kept open for every session, beside another session's chat: after Attach the line "Added to <its session's title>" appears. Reload the window before opening that session, then open it: its box holds the block. And when that session is opened and typed in while the attach is still on its way: its box ends holding what was typed and the block, once, and the line appears only then. When what was typed is also sent, and the session closed again, before the attach has landed: the message goes without the block, and the session's draft then holds the block, once.
- **B5** (finding 3). Where the block cannot be put (the session has not started; a message is being taken back; the session is no longer known; its machine keeps no drafts for this member; its draft changed in every round), the line says the selection was not added and why, in the sentence for that cause, no draft holds the block and none can come to hold it, and the selection is still selected. Where MAWS cannot know (an answer was lost and no later read has shown the block; or the attach ran out of time after a write was sent), the line says that it could not confirm, whatever else went wrong after that, and a later look finds the block once or not at all, never twice. An attach always ends: within 80 seconds for a session on this Mac and eight minutes for one on another machine, and far sooner unless every answer is late.
- **B6** (A8). ⌘K with nothing typed lists "Recent" first: the sessions and artifacts opened last in this run, newest first, eight at most, filled with the sessions most recently active; no line about the first 50. Typing an artifact's title lists it under "Artifacts", and Enter opens it beside the chat. The last row opens the Library on the typed text. No row is drawn disabled.
- **B7** (A11; finding 5). Open session A, then session B, then the Customize page. Go ▸ Back shows B, again shows A; Go ▸ Forward goes forward again. With the Settings dialog open over B, Back closes the dialog and shows A. With the Overview open, Back closes it and shows the place before, and Forward opens it again over the same place. Back is disabled at the first place and Forward at the last. Closing a tab takes it out: Back never reopens it. Moving the keyboard between the two panes of a split adds nothing to Back.
- **B8**. In an editable file ⌘[ and ⌘] change nothing in the text; Tab and ⇧Tab indent. In a plugin's detail ⌘[ returns to its list and the place in front does not change.
- **B9** (A12's rest). ⇧Tab in the composer changes the permission mode and the composer's live region reads "Permission mode: Plan" (the new mode's name). On a session MAWS runs. On a terminal session the mode chip takes no change (its mode is changed in the terminal), so ⇧Tab asks nothing and nothing is said, as S4's last rule says (Decision Log 10).
- **B13** (A13, A9), for this half's three rows. `src/shared/keymap/actions.test.ts` holds them to the wave's chords and lists them as landed; `src/main/menu.test.ts` finds Back and Forward leading Go and "Attach selection to chat" after the Edit menu's own items; the sheet lists the three under those groups. By hand, on the owner's machines: ⇧⌘L in a terminal attaches and no Service takes it; ⌘[, ⌘] and ⇧⌘L work under the Korean input source (the child's probe 6).
- **B14** (UC-6, "Stored rebindings"). Settings › Keyboard lists the three rows with no control to change them, and `settings.json` holds none of their ids after any act.

## Constraints that bind every milestone

- **The build brief binds** (the wave's common brief for building a child): nothing is typechecked, linted, tested, built or started on the owner's MacBook (root UC-10); every check runs on the build VM in a checkout of the pushed head; the gate runs Node 22 where the VM runs a newer one; the known VM failures are read against the brief's list and never edited away.
- **Laws 1, 3, 5 and 8 of the root**, and its contracts: UC-6 (a key is a row of `ACTIONS` and is written nowhere else; a component handles no ⌘ key of its own), UC-8 (every edit in a file another child owns is the insertion Interfaces §H names, and nothing more), UC-11 (public repository: invented names, paths and text in every test, fixture and scene), UC-12 (a step that shows a tab closes the page and the dialog through the store's own acts; nothing here writes the strip), UC-14 (the table above).
- **No stored rebinding of the three rows** while build F can be gone back to: no id is added to `BUILD_F_ACTION_IDS`.
- **Only this half's ids join `LANDED`** (row 1): the three, and no zoom id.
- **Tokens only** in renderer source; a ticket or item number is written in words there (the tokens guard reads `#` and digits as a colour).
- **No wall time is asserted.** No test or scene of this landing holds an upper bound on a time. A scene waits on a state it names; a unit test that needs the 150 ms of the artifact search or two animation frames uses the suite's fake timers.
- **A test that asserts an absence** (no row, no block, no entry, no sentence, no write) over input it builds by hand carries its control **in the same test**: the same reader, given the form that should be found, finds it. A control elsewhere in the file does not count.
- **An act that awaits** has a test that holds the awaited answer open and acts in between, not only a test of the end state. S1, S4 and S5 list the orders; M2 names the held cases one by one.
- **Other packages read the app's source.** `apps/desk-web` imports files of `src/renderer/src` and `src/shared` by path. Each milestone lists the importers outside the project it changed, following imports until no new file appears, and where there is one adds that package's typecheck, build and test project to its proof.
- **Merge, never rebase or force-push.** Never push master.

## Plan of Work

Five milestones. M1 is first: M2 reads `available`, which M1 exports. After M1, M2 and M3 share no module and may be built in either order or beside each other; M4 consumes M3's module; M5 is last. Each milestone adds its own rows to the action table, and to `LANDED` only those.

### M1 — The keyboard on show and hide, and the mode said aloud

**What exists at its end.** B1 and B9, by their unit halves: a surface shown from any of its controls has the keyboard; hidden, the composer has it; ⇧Tab's change is in the composer's live region.

**What it touches.** `src/renderer/src/panel/SurfaceRow.tsx` (U8's; Interfaces §H); `src/renderer/src/keymap/shell-navigation.ts`; `src/renderer/src/tools/code/files/FilesTool.tsx`; `src/main/menu.ts` (`SHELL_FOCUS_ACTIONS`); `src/renderer/src/composer/Composer.tsx` (U4's: the live region and its writer); their tests (`panel/surface-row.test.ts`, `app/Shell.test.tsx`'s "the side column's acts with a page open", `keymap/shell-navigation.test.tsx`, `tools/code/files/files.test.tsx`, `main/menu.test.ts`'s `it.each` of the focus actions, `composer/Composer.test.tsx`).

**Interfaces.** Exposes §B (`focusShown`, `focusSurfaceStop`, `available`) and §F. Consumes `requestFocus` (`panel/host.ts`), `focusFocused` (`composer/ComposerAppKeys.tsx`), `focusPaneElement`, `MODE_OPTIONS` (`statusline`).

**Decisions.** 1 to 5; S4.

**What it does not touch.** `tools/code/review/` (P1); how a tool answers a focus request other than Files; `panelHost.selectTab`; the chip's menu.

**What it proves.**
- Shown from a hidden column, from a column open on another tool, and brought into view from behind a page, the tab is asked for focus on each path (the open-column path is the one that asked nothing before); a tool that answers keeps the keyboard, and one that does not gets it at F6's stop two frames later.
- Held open between the request and the second frame: the person focuses the sidebar's field, and the keyboard stays there; the tab is hidden again, and nothing is focused.
- Hidden with the keyboard inside the column, and with nothing holding it: the composer's editor has it. Hidden with the keyboard in the sidebar: it stays (the control, in that test: the same assertion finds the composer focused when the keyboard was in the column).
- With a page open and the tool in view behind it, the key leaves the page and focuses nothing (the three cases of `Shell.test.tsx` stand).
- A Files tab that holds a file gives its view the keyboard; one that holds none, its tree's selected row, else its first.
- Every `surface.*` id moves the keyboard out of a web page's view (`menu.test.ts`).
- S4, each order held open: the answer before the chip's mode; the chip's mode before the answer; a refused answer; a taken answer and another mode reported; two presses; a press while the chip takes no change says nothing (the control, in that test: the same reader hears the sentence after a press that changes the mode). A repeat of one sentence is written again.

### M2 — "Attach selection to chat"

**What exists at its end.** B2 to B5 by their unit halves, and the row `terminal.attachSelection` in the table, the Edit menu and the sheet.

**What it touches.** `src/shared/keymap/actions.ts` (the row) and `actions.test.ts` (`LANDED`); `src/renderer/src/terminal/renderer.ts`, `xterm.ts`, `renderer.fake.ts`, `registry.ts`; `src/renderer/src/tools/terminal/TerminalView.tsx`, `copy.ts`, `attach.ts` (new); `src/renderer/src/composer/editor/pasted-block.ts` (new), `composer/editor/controller.ts`, `composer/attach-pasted.ts` (new), `composer/Composer.tsx`, `stores/composer.ts`; `src/renderer/src/lane-b/remote-drafts.ts` (U9's: the helper's signature); `src/renderer/src/App.tsx` (one mount); the tests beside each (`lane-b/remote-drafts.test.ts` among them), and `main/menu.test.ts` ("puts an edit row after the Edit menu's own items", which today ends on "no edit row today"), `settings-tab/keymap.test.ts` (the `Edit` group now stands before "Edit › Sample"; the list of rows that take no rebinding gains the id where it stands in the table), `tools/terminal/terminal.test.tsx` ("offers Copy, Paste, Select all and Clear from its context menu"). Interfaces §H gives each insertion's owner.

**Interfaces.** Exposes §C. Consumes `DRAFT_CLAIM`, `STALE_DRAFT_WORDS`, `DRAFT_KEPT_WORDS`, `STAGED_DRAFT_WORDS` (`src/shared/ipc/schema/session.ts`); `REQUEST_TIMEOUT_MS` (`src/shared/host/host-supervisor.ts`) and `REMOTE_ACT_PENDING_MS` (`src/shared/machine/remote-pending.ts`), for the deadline; `readRemoteDraft`, `saveRemoteDraftOnce`, `unsavedRemoteDraft` (`lane-b/remote-drafts.ts`); `readerRowsOf` (`lane-b/reader-rows.ts`); `available` (M1, which is why M2 follows it); `toast` (`stores/notices.ts`); `displayTitle`.

**Decisions.** 6 to 11 and 30 to 33; S1; P2, P3, P4, P8. **After M1.**

**What it does not touch.** `useDraftPort` and every composer's `load` (decision 9); `queueComposerAttachment` (not used: it keeps its items in the window's memory); the threshold of a paste; `serializeDraft` and `plainTextOf`, so how a block is sent and how a `/btw` question reads (decision 7); the draft store; any command's schema. No site of the guard of who sends as the person changes (`test/support/person-sends.test.ts`): the attach hands nothing to a send.

**What it proves.** Every case below that holds an answer open uses a client whose answers the test releases, and a store that is a fake with the real store's rule for `replaces` (the three sentences of `DraftStore.set`), so that a write the test lets land changes what a later read answers. Every case ends on the same three assertions: the authority's final document holds exactly one block of the attach's id; it holds everything the person typed; "Added to …" was shown once, after the end, and not before.

- `screenText`: a viewport scrolled up reads the rows it shows, not the buffer's end; a soft-wrapped line is one line; trailing spaces and blank edge lines are dropped; an empty screen reads empty. In `xterm.test.ts` and against the fake.
- `pastedBlock` makes the node a paste over the threshold makes, attribute for attribute, with the id it is given; a paste over the threshold and a dropped text file still make it (the controller calls it).
- The editor's `attachPasted`: inserts a block whose id its document does not hold; a second call with the same id changes nothing and answers `present`; while a submission is in flight it answers `busy` and the document is unchanged (the control, in that test: the same read finds the block after the call that follows the send).
- By a press, a composer whose box can take the keyboard: one block, the editor focused, no line, nothing saved by the attach itself. A composer under a card, and one whose pane a maximized side column covers: the block, a save at once, the line after the port's answer and not before (held open); the port answering false is `unsaved`, with its own sentence.
- **The hand-over, held (finding 2).** With the store's write held open, each of these, and each again with the write released before the act instead of after it:
  - a composer mounts and nothing else happens;
  - a composer mounts and the person types in it;
  - a composer mounts, the person types, and sends: the message sent holds no block of this attach, and after the send has settled the box holds the block once;
  - a composer mounts, the person types, and the composer unmounts, its flush landing before the held write and, in a second case, after it;
  - **a send that outlives its composer** (the delta review): a composer mounts, the person types and starts a send, which the test holds; the composer unmounts; the attach's write is released and accepted; then the send is released and accepted. The loop said nothing while the send was held; the final draft holds the block once, and the sent text is no longer in it. The same with the send refused: the draft holds the text that came back and the block, once.
- **An answer that is not definite (finding 3).** The write lands in the fake and its answer is `timeout`: the next round's read finds the id, nothing is written again, the end is `added`. The write is lost and never lands: the next round writes it, once. The write's answer is `timeout` and every later read fails: the end is `unconfirmed`, its own sentence is shown, "Added" and "not added" are not, and the fake then holds the block once or not at all, never twice (both sub-cases). Two writes of one block naming one revision, released in either order: one is taken.
- **An unaccounted write at every exit (the delta review).** After a write whose answer was `timeout` and that no read has accounted for, each of these ends `unconfirmed` and never as a refusal: a composer mounts and answers `closed`; one mounts and answers `unsaved`; the next round's write is refused because a message is being taken back; the next round's read answers an unknown session. The control, in each test: the same refusal with no write unaccounted for ends as that refusal.
- **A claim that is unaccounted for (the re-check).** On this Mac, with a draft cleared before the attach: the first write, in the claim form, is answered `timeout` and held; the second round's write lands; a composer mounts and unmounts and its flush clears the draft; the last read shows an empty draft. The end is `unconfirmed`, not `changed`; the held claim is then released and lands, and the fake holds the block once. The control, in that test: the same sequence with the first write naming a revision ends `changed` once that write is refused as stale.
- **The last read on another machine (the re-check).** Another device of the member saves revisions that hold the block between this window's reads, so each of the three rounds is stale: the last read, the machine's own, shows the block, and the end is `added`. And with a clear still out in this window's queue while the machine's document holds the block: the end is `unconfirmed`, never `changed` (the control, in that test: with the queue empty and the machine's document without the block, `changed`).
- **A composer mounts during the last read (the re-check):** with that read answering the block, and with it answering none: both end `unconfirmed`.
- **A send that outlives its composer, for a session on another machine (the re-check),** through the real module of the remote draft's queue (`lane-b/remote-drafts.ts`) over a fake client and the suite's fake timers. The send's answer and the save the send makes when it settles are held apart: the clear after an accepted send, the save that puts the text back after a refused one. Each of the two with that save taken at once, answered `timeout` and landing late, and answered `timeout` and sent again by the queue (`REMOTE_DRAFT_RETRY_MS`). The assertions are made after every save still out and every resend has been released: the block once; the sent text gone after an accepted send, back after a refused one.
- **The deadline (the re-check),** with the fake clock. A composer mounts and starts a send that never settles, no write of the block having been sent: at `attachDeadlineMs` the end is refused `busy`, and nothing is said before. The same after a write of the block was sent: `unconfirmed`. The store's work with every answer held to just under its bound ends before the deadline (the control for the constant: the deadline cut nothing that was due).
- **The last read (the delta review).** Three rounds each answered stale: a fourth read is made and no fourth write; B absent there and no write unaccounted for ends `changed`, and the fake holds no block of B's id then or after every held answer is released; B present there ends `added`; the third round's write answered `timeout` and B absent at the last read ends `unconfirmed`; the last read failing ends `unconfirmed`.
- **The store's round.** A writer between the read and the write (the next round appends to the newer draft and names its revision); a draft's revision where the read answers one; where it answers none, the claim form on this Mac and `null` over the link; a stage kept (`taking-back`, one write, no further round); three stale answers and a last read that shows no block (`changed`); a session with no row (`unknown`); a machine that keeps no drafts (`no-store`, nothing sent). In every refusal no `session.drafts.set` is accepted and no line says "Added" (the control, in that test: the same fake, asked without the refusing condition, takes the write and the line is shown).
- **A session on another machine (finding 4).** A draft never written there: the read answers none, the save names `null`, and it is taken, by a fake with build F's rule and by one with this build's. An ordinary save that failed before the attach, so that the window holds a newer document than the machine: the block is appended to the window's document, the save names the revision the machine answered, it is taken in the first round, and the failed save is not sent again after it. A stale answer: the next round asks the machine again (the fake counts its reads: one per round), and does not read the module's memory. `saveRemoteDraftOnce` naming `null`, in `remote-drafts.test.ts`.
- A session that has not started, by each of the three ways of "The named question": refused where the store is the authority, with nothing read; taken by its mounted composer.
- **The sentences (card K4, as answered).** One case per row of `ATTACH`'s table in "The sentences a person reads": the outcome, by the cause that makes it, shows exactly that sentence with the session's title, or its machine's name, in it; `unreachable` shows this Mac's sentence for a session here and the machine's for one elsewhere; `unconfirmed` shows its sentence and no "Not added"; no outcome falls through to another's sentence (the table is total over `AttachRefusal`, held by the type).
- The handler is registered while a terminal holds the keyboard and at no other time; the menu's item is disabled without a selection and the chord's path attaches the screen.
- A store of build F (`DraftStore` at `f1852de3a`, read with `git show`, its one rule restated in the test as a fake): a save naming a kept revision is taken, one naming none where none was kept is taken, and the claim form is stale in each round, and the last read shows no block: `changed`, with nothing written.

### M3 — Back and Forward

**What exists at its end.** B7 and B8 by their unit halves; the rows `go.back` and `go.forward`.

**What it touches.** `src/shared/keymap/actions.ts` and `actions.test.ts` (`LANDED`); `src/main/menu.ts` (the two ids join `SHELL_FOCUS_ACTIONS`); `src/renderer/src/keymap/places.ts` and `visits.ts` (new); `src/renderer/src/tools/code/editor/editing.ts`; `src/renderer/src/App.tsx` (one mount); tests beside each, `main/menu.test.ts` ("reads View and Go in groups"), `settings-tab/keymap.test.ts`, `tools/code/editor/editor.test.tsx`.

**Interfaces.** Exposes §D. Consumes the layout store as it is (`destination`, `main`, `overviewOpen`, `hydrated`; `activateTab`, `openDestination`, `setOverviewOpen`, `closeSettings`): no line of `stores/layout.ts` is edited.

**Decisions.** 12 to 17; S2; P5.

**What it does not touch.** `PageTitle` in `app/Toolbar.tsx` and Esc on a page (P5); which tab a close shows; `tab.reopen`; the in-app browser's own ⌘[ and ⌘] (`src/main/browser/keys.ts`); the deck's stage; `backOnChord`; `app/shell-actions.ts`.

**What it proves.**
- The model, as a table of cases over `seen`, `refocused`, `gone` and `target`: A11's walk; a new place after a step back drops what was ahead; the fiftieth-and-first entry drops the oldest; a closed tab's entries and the Overview entries over it leave, and neighbours that became the same are one; the position when the entry in front leaves.
- Rule 2 of `seen`: the Overview closed onto the place it was opened over, and a page closed onto the tab before it, are steps back with the entry kept ahead; a page closed onto another tab is a new visit; a tab clicked while on a tab is a new visit, never a step back.
- **The projection (finding 6).** With A recorded and B in front of the other pane of a split: the keyboard moves to B's pane, and the record has no new entry and Recent no new item; then a side tab's parameters change in a later turn, and still none; and, in a second case, the focus move and the parameters' change in one turn, and none. The control, in each of those tests: a third tab activated in B's pane, by the same means the test used to change the layout, is recorded. After the focus move the entry the record is at is B's, so the next Back shows the place before, not a tab already in view.
- The reader: an act inside the Overview that changes the strip and closes the Overview in two writes is one visit (held: the read happens once, after both). A tab brought forward inside `quietly` behind a page is recorded when the page closes. Nothing is recorded before `hydrated`; the first entry is the restored place.
- **A step, the Overview both ways (finding 5).** From the Overview over tab A, Back shows A with the Overview closed, the record has no new entry, and Forward opens the Overview over A again. The same over a page. Back onto an Overview entry, from a tab and from a page, shows what it was over and opens it. In each, the layout after the step is read from the store (`overviewOpen`, the page, the tab in front), not from the record.
- A step sets the position before the layout is written and records nothing; with the Settings dialog open it closes the dialog and shows the place; a step whose tab left the strip in the same turn shows nothing and the entry is dropped at the next read.
- `go.back` and `go.forward` have handlers exactly while there is an entry on that side.
- The file editor's keymap holds no binding for `Mod-[` or `Mod-]` and still holds Tab's and ⇧Tab's (the control, in that test: the same search finds `Mod-/`).

### M4 — The palette: Recent, Artifacts, ranking, no row that cannot run

**What exists at its end.** B6 by its unit half.

**What it touches.** `src/renderer/src/palette/CommandPalette.tsx`, `recent.ts` and `artifacts.ts` (new), `keymap/visits.ts` (the opened list's sources), `palette/CommandPalette.test.tsx` and new tests beside the two modules.

**Interfaces.** Exposes §E. Consumes M3's `useVisits`; `fuzzyScore` (`src/shared/composer/fuzzy.ts`); `searchedMachines` (`palette/search.ts`); `library.list`, `library.get`; `showOpenArtifactTab`, `openArtifactTab` (`library/actions.ts`); `openArtifactInPanel`, `canShowArtifactInPanel`, `sessionArtifactMachine`, `recordArtifactMachine`; `setLibraryView` (`library/view.ts`); `openArtifacts` (`main/artifacts.ts`); `focusedSession` (`composer/ComposerAppKeys.tsx`).

**Decisions.** 18 to 22; S5; P9.

**What it does not touch.** The Conversations scope and `searchConversations`; the sidebar's matching rule; any file of `library/`, `tools/artifacts/` or `channel/`.

**What it proves.**
- Nothing typed: Recent first, newest first, eight at most, sessions and artifacts mixed; fewer than eight opened are filled with the sessions most recently active, none twice, none archived; a recent artifact that no longer exists is not listed (the control, in that test: one that exists is, by the same read); no Sessions group and no notice about 50.
- Recent's sources: a session's tab and an artifact's tab that came to be in front; an artifact shown beside the chat, read from `panelParams`; a side tab restored at hydration is not an opening (the control, in that test: the same tab shown a second artifact after hydration is).
- Text typed: sessions found by the sidebar's rule and ordered by the scorer, one found by its folder alone after those found by title; "dark" still lists exactly Appearance: Dark, and a word in no action's title lists no action (the two cases that stand today).
- No row that cannot run: a row with no handler is absent, and so is a `renderer` row of scope `pane` or `composer` whether or not it has one (the control, in that test: registering the handler of a listable row makes it appear). The cases that asserted a greyed row and its reason are rewritten to this; "Project channel" is absent while the tab in front has no project with a channel.
- S5, held open: Enter runs the row selected when it is pressed, and an answer released afterwards changes nothing; an answer for the older of two queries released last is dropped; a machine that answers `host_unavailable` is left out and no line is drawn; one group "Artifacts" for one machine with matches, one per machine by name for two.
- Enter on an artifact, by Interfaces §E's four steps, one case each; the last row sets the Library's query and opens its page.

### M5 — The scenes, the record, and the acceptance run

**What exists at its end.** Every scene of Interfaces §I written and typechecked; the record; the whole unit suite run once.

**What it touches.** The spec files of Interfaces §I; `docs/tech-debt-tracker.md`; this document.

**The record.** No ruling of the owner's is reversed by this landing; the child's "Rulings reversed" gives U6b-5 none. In the debt tracker: the row of 2026-10-24 ("Lens 7 remainders not built") loses Back and Forward and the permission-mode announcement, and keeps what is left (zoom until U6b-5b lands, pop-out windows, the composer's reverse traversal). Rows are added for: a late claim after a clear ("Left over"); Review's own answer to a focus request (P1's ruling); the label of an attached block (ticket 733); a block's text in a `/btw` question, pointing at ticket 733 (finding 1).

**What it proves.** Against the acceptance: B1, B2 to B4, B6 to B9 and B14 by the scenes of §I; B5 and B13's first half by the unit suites; B13's second half and the owner's hearing of B9 by hand ("Proof that an executor does not run").

## Concrete Steps

Working directory for every command: the branch's worktree. The VM sees only what is pushed. Below, `vmcheck` stands for the wave's build-VM helper as the build brief gives it, called for this branch (`vmcheck.sh ux-wave/U6b-5 --`); it prints `vmcheck: ux-wave/U6b-5 at <short sha>`, then the command's output, and exits with the command's status. Its first call for the branch installs dependencies: allow 20 minutes. Every command there runs under `timeout <seconds>`; where every part's result is wanted, the remote command starts with `set +e;`.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b-5

   A merge, never a rebase or a force-push. After a merge that brought changes, run the previous milestone's proof again (the same set, not the whole suite), and read "Statements to check again" against what arrived. Before M1, on the head that holds the chain up to U6b-3b: read every row of that table once.

2. **The tests before the modules** (M1 to M4). Commit the cases of the milestone's "What it proves" with the new exports naming nothing; push; run them; the cases that assert the new behaviour fail and those that assert what stays pass. Then build.

3. **While building**, after each push:

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck 'timeout 900 pnpm exec vitest run <the test files touched>'

   The web project for the renderer; the node project for main and for `src/shared/`.

4. **Each milestone's proof** is the typecheck of the projects it changed, eslint on its changed files, and `vmcheck 'timeout 1800 pnpm exec vitest run <the list>'` over:

   - M1: `src/renderer/src/panel src/renderer/src/keymap src/renderer/src/app src/renderer/src/tools/code/files src/renderer/src/composer src/main/menu.test.ts test/support/tokens-guard.test.ts`
   - M2: `src/renderer/src/terminal src/renderer/src/tools/terminal src/renderer/src/composer src/renderer/src/stores src/renderer/src/lane-b src/renderer/src/settings-tab src/renderer/src/keymap src/shared/keymap src/main/menu.test.ts test/support/person-sends.test.ts test/support/tokens-guard.test.ts`
   - M3: `src/renderer/src/keymap src/renderer/src/app src/renderer/src/destination src/renderer/src/tools/code/editor src/renderer/src/settings-tab src/renderer/src/channel src/shared/keymap src/main/menu.test.ts`
   - M4: `src/renderer/src/palette src/renderer/src/keymap src/renderer/src/channel src/shared/composer test/support/tokens-guard.test.ts`

   Expected: every file passes but those the build brief lists as failing or timing out on the VM, each shown to pass alone or to fail on master there.

5. **A scene is typechecked, not run** (M5):

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The second is the gate's own script tests. This landing adds no spec file, so the pinned count of specs stands; a scene added to an existing file needs no edit there.

6. **The acceptance run** (M5's last step), on the pushed head, after a last merge of master:

       vmcheck 'timeout 2400 pnpm typecheck'
       vmcheck 'timeout 1800 pnpm lint'
       vmcheck 'timeout 3600 pnpm test'
       vmcheck 'timeout 600 pnpm exec vitest run src/shared/machine'

   Expected: each exits 0, apart from the files the build brief lists; vitest's summary names no other failed file. The whole unit suite runs this once, by M5's executor, and by no earlier milestone.

7. **Stop and hand back.** M5's executor writes into Progress what ran and what is left, pushes, and stops. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the branch review, the Mac runs and the pull request are the architect's.

## Interfaces and Dependencies

No library is added. Names and shapes below are what must exist at the end of the milestone that makes them; a private helper's name is the executor's.

### §A. The three rows (M2, M3; `src/shared/keymap/actions.ts`)

```ts
// Edit: after the Edit menu's own items (M2)
'terminal.attachSelection': { title: 'Attach selection to chat', chord: 'Cmd+Shift+L', sink: 'menu', menu: 'edit', scope: 'app' },
// Go: the two lead the menu, so they stand before 'palette.open' (M3)
'go.back':    { title: 'Back',    chord: 'Cmd+[', sink: 'menu', menu: 'go', scope: 'app' },
'go.forward': { title: 'Forward', chord: 'Cmd+]', sink: 'menu', menu: 'go', scope: 'app' },
```

Each prefix (`terminal`, `go`) is new and so is a group of its own in the menu, with its separators (`group` in `src/main/menu.ts`); `GROUP_OF_PREFIX` gains nothing. `LANDED` in `actions.test.ts` gains these three ids, each in the milestone that adds its row, and no other: the test requires every id in that list to be a row, so zoom's three join it with U6b-5b. Its comment is corrected to say which of U6b's seven are rows. `SHELL_FOCUS_ACTIONS` gains the nine `surface.*` ids (M1) and `go.back`, `go.forward` (M3). The chord vocabulary already has the keys (`[`, `]` in `PUNCTUATION`, `src/shared/keymap/chord.ts`).

### §B. The keyboard on show and hide (M1)

```ts
// src/renderer/src/panel/SurfaceRow.tsx
export function toggleSurface(toolId: string): void;   // as today; then focusShown(the tab it showed), or the keyboard's return when it hid the column
// src/renderer/src/keymap/shell-navigation.ts
export function focusSurfaceStop(tabId: string): boolean;   // F6's stop of the side group that shows this tab; false when no group shows it
```

`focusShown` and the return are private to `SurfaceRow.tsx`; their rules are decisions 2 and 3. What held the keyboard is read before `hideSurfaces` is called. `available(element)`, today a private rule of `shell-navigation.ts` (no ancestor hidden, inert or `aria-hidden`), is exported; M2 reads it.

### §C. "Attach selection to chat" (M2)

```ts
// src/renderer/src/terminal/renderer.ts
interface TerminalRenderer { screenText(): string }            // decision 6; also in xterm.ts and renderer.fake.ts
// src/renderer/src/terminal/registry.ts
focused(): TerminalHandle | null;                               // the entry whose container holds document.activeElement

// src/renderer/src/composer/editor/pasted-block.ts (new): the one maker
export interface AttachedBlock { id: string; text: string }    // id: 'attach-' and a random UUID, minted once per attach
export function pastedBlock(text: string, id?: string): JSONContent;   // pastedNode({ id: id ?? atomId('pasted'), kind: 'text', name: 'Pasted text #1', lines, text })
export function holdsBlock(doc: unknown, id: string): boolean;         // a pasted node of that id anywhere in the document
export function appendPasted(doc: unknown, block: AttachedBlock): ComposerDoc;   // the document with one block appended; a missing document starts an empty one

// src/renderer/src/composer/editor/controller.ts
interface EditorHandle {
  // Waits for this mount's restore. Then, unless the document holds a block of this id ('present', nothing changes):
  // one block, at the caret the editor left or at the end, the caret and the keyboard untouched when `at` is 'end'.
  // 'busy': a submission is in flight. 'closed': the editor takes no typing. 'gone': it unmounted while waiting.
  // Nothing changes in those three. With `save`, the pending write is dropped and the draft is saved now through the
  // editor's port: 'taken' when the port answered true, 'unsaved' when false. Without it: 'taken'.
  attachPasted(block: AttachedBlock, options: { at: 'caret' | 'end'; save: boolean }): Promise<'taken' | 'present' | 'unsaved' | 'busy' | 'closed' | 'gone'>;
}

// The session's send in flight, mounted composer or not: settles when the send has, true when it was accepted. Null: none.
export function submissionOf(appSessionId: AppSessionId): Promise<boolean> | null;   // in controller.ts, over its `submissions`

// src/renderer/src/stores/composer.ts
interface FocusTarget {
  // The composer decides where it stands, since only it knows. By 'press' (it was mounted at the press): where its box
  // can take the keyboard (its element is `available`, and no card holds the box) the block goes in at the caret and
  // the editor has the keyboard: 'shown'. Where it cannot, and always by 'hand-over' (it mounted while an attach was on
  // its way): the block at the end, saved at once: 'kept'. The rest are the editor's own answers.
  attachPasted?(block: AttachedBlock, by: 'press' | 'hand-over'): Promise<'shown' | 'kept' | 'present' | 'unsaved' | 'busy' | 'closed' | 'gone'>;
}

// src/renderer/src/lane-b/remote-drafts.ts (U9's): the one-shot save may name "none"
export async function saveRemoteDraftOnce(client: MawsBridge, appSessionId: AppSessionId, draft: Draft | null, replaces: string | null): Promise<CommandResult<'session.drafts.set'> | { withheld: true }>;

// src/renderer/src/composer/attach-pasted.ts (new)
export const ATTACH_ROUNDS = 3;                                 // the store's rounds in one hand-over, each a read and at most one write; then one last read
export const ATTACH_DEADLINE_COMMANDS = 2 * ATTACH_ROUNDS + 2;  // seven commands of store work at their bounds, and one bound for a wait
export function attachDeadlineMs(overLink: boolean): number;    // ATTACH_DEADLINE_COMMANDS * (overLink ? REMOTE_ACT_PENDING_MS : REQUEST_TIMEOUT_MS)
export type AttachRefusal = 'not-started' | 'busy' | 'closed' | 'unsaved' | 'taking-back' | 'changed' | 'unknown' | 'unreachable' | 'no-store' | 'failed';
export type AttachOutcome = { kind: 'taken' } | { kind: 'added' } | { kind: 'unconfirmed' } | { kind: 'refused'; why: AttachRefusal };
export function attachPasted(appSessionId: AppSessionId, text: string, client?: MawsBridge): Promise<AttachOutcome>;   // S1, whole

// src/renderer/src/tools/terminal/attach.ts (new)
export function attachFromTerminal(id: TerminalId, source: 'menu' | 'chord'): Promise<void>;   // reads the text, calls attachPasted for info.appSessionId, says the outcome
export function connectTerminalAttach(): () => void;          // the handler's registration by the keyboard (P8); mounted once from App.tsx
```

How the loop of S1 learns what it waits on. That a composer for the session came or went: it reads `focusTargets` in the composer's store and counts its changes for that session; nothing is inserted where a composer registers. That a send of the session is in flight, and when it has settled: `submissionOf(session)`, which the controller exports over the map it already keeps of each session's send. The promise settles after the controller has handed over the send's own write of the draft, and it settles for a composer that has unmounted as for one that has not: it is the send's, not the editor's.

The store's round, by where the session is:

| | on this Mac | on another machine |
|---|---|---|
| the read | `session.drafts.get` | `readRemoteDraft`, which asks the machine every time; never the module's memory of the last revision |
| the document B is looked for in and appended to | what the read answered | the newest document this window holds that the machine has not taken (`unsavedRemoteDraft`), when there is one, a clear that is still out counting as a document with no block; else what the read answered |
| `replacesOf`, the revision the write names | the read's `updatedAt` when it answered a draft; `DRAFT_CLAIM` when it answered none | the read's `updatedAt` when it answered a draft or a cleared draft with its stamp; `null` when it answered none |
| the write | `session.drafts.set` | `saveRemoteDraftOnce`, sent once, in the order of that session's other saves; taken, it retires the session's older save that had not been taken, as a take-back's does |
| refused before any read | — | `readerRowsOf(session) === 'refused'`: `no-store` |

Which answers of a write are definite: accepted; a refusal whose message is one of the store's own (`STALE_DRAFT_WORDS`, `DRAFT_KEPT_WORDS`, `STAGED_DRAFT_WORDS`, an unknown session); a machine that does not offer the command. Everything else (`timeout`, a route's failure) is not.

`notStarted(session)` is `useSetupIntent`'s rule read outside React: an intent, and not both a record and an engine status. `taken` says nothing; `added`, `unconfirmed` and every refusal say one line (`toast`: level `info` for `added`, `warning` otherwise), from the one table `ATTACH` in `tools/terminal/copy.ts` ("The sentences a person reads").

The terminal's menu becomes: Copy, Paste, Select all, Clear, a separator, "Attach selection to chat" (enabled while `hasSelection()`). The fifth item is last and not first as in Claude Desktop, so that the four a hand already knows keep their places.

### §D. The record (M3; `src/renderer/src/keymap/places.ts`, pure, and `visits.ts`)

```ts
export type Under = { kind: 'tab'; id: string } | { kind: 'page'; destination: Destination };
export type Place = Under | { kind: 'overview'; over: Under };
export interface PlaceRecord { entries: readonly Place[]; at: number }   // at: the entry the window is at; -1 while empty
export const PLACES_MAX = 50;

// What the record reads of a layout, and all it reads (decision 12).
export interface Projection {
  page: Destination | null;          // the open page
  overview: boolean;
  fronts: readonly string[];         // each pane's tab in front, by pane; '' for an empty pane
  focusedPane: number;
  tabs: ReadonlySet<string>;         // every tab id of the strip
}
export function projectionOf(layout: Pick<LayoutState, 'main' | 'destination' | 'overviewOpen'>): Projection;
export function placeOf(p: Projection): Place | null;     // the page, else the focused pane's tab in front; the Overview over that when it is open; null for an empty pane in front

export function samePlace(a: Place, b: Place): boolean;   // a tab by its id; a page by its kind; the Overview by what it is over
export function seen(record: PlaceRecord, place: Place): PlaceRecord;
export function refocused(record: PlaceRecord, place: Place): PlaceRecord;
export function gone(record: PlaceRecord, tabIds: ReadonlySet<string>): PlaceRecord;
export function target(record: PlaceRecord, delta: 1 | -1): { place: Place; at: number } | null;

// visits.ts
export type Opened = { kind: 'session'; appSessionId: AppSessionId } | { kind: 'artifact'; artifactId: string; machine: MachineRef };
export const useVisits: UseBoundStore<StoreApi<{ record: PlaceRecord; opened: readonly Opened[] }>>;   // opened: newest first, each once
export function connectVisits(): () => void;   // the reader, the step, the two handlers; mounted once from App.tsx after the layout's persistence is connected
```

`seen(record, place)`, the first rule that applies:

1. `place` is the entry at `at`: that entry is replaced by `place` (a page's view and filter follow) and nothing else changes.
2. The entry at `at` is the Overview over `place`, or is a page while `place` is a tab; and `place` is the entry before it: `at` moves back by one. No entry leaves.
3. Otherwise the entries after `at` leave, `place` is appended and `at` is on it. Past `PLACES_MAX` the oldest entry leaves.

`refocused(record, place)`: the entry at `at` becomes `place`; if the entry before it or after it is then the same place, the two become one. No entry is added and none after `at` leaves.

`gone(record, tabIds)`: every tab entry with such an id leaves, and every Overview entry over one; two neighbours that are then the same place become one entry; `at` stays on its entry when that survives, else moves to the nearest entry before it that does (-1 when none).

The reader holds the last projection. Per read, with `next` the projection now, in this order:

1. `gone` for the tab ids of the last projection that `next.tabs` no longer holds.
2. `next` equals the last projection in `page`, `overview` and `fronts`: no visit. If `focusedPane` differs and `placeOf(next)` is a place, `refocused` with it; nothing joins `opened`.
3. Otherwise `seen(placeOf(next))` when it is a place, and `opened` gains the session or artifact of a tab that came to be in front.
4. The last projection becomes `next`.

A write that changes nothing of the projection leaves `next` equal to the last one in everything, so rules 2 and 3 do nothing: a move between the panes can never be recorded by a later write, and not by one in the same turn either, since only the projection is compared.

A step (decision 15), in one synchronous run: `target`; the record's `at` set to it; `closeSettings()`; then, for a tab or a page, `setOverviewOpen(false)` when it is open and `activateTab(id)` or `openDestination(destination)`; for the Overview, the same for what it is over and then `setOverviewOpen(true)`. After a step to a tab the pane in front takes the keyboard, as after ⌥⌘] (`stepMainTab`).

`opened` also gains an entry when a side tab's `panelParams` come to name another artifact after hydration (decision 18).

### §E. The palette (M4)

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

### §F. The mode said aloud (M1; `composer/Composer.tsx`)

One element, `data-mode-announcement`, `aria-live="polite"`, visually hidden (Radix's `VisuallyHidden`, as the palette's title is), rendered on every render of the composer. Its text is empty or `Permission mode: <label>`, the label from `MODE_OPTIONS`. S4 gives when it is written.

### §H. Files other children own, or that no table names (root UC-8)

| file | owner | the insertion | named by |
|---|---|---|---|
| `src/renderer/src/panel/SurfaceRow.tsx` | U8 | in `toggleSurface`: the two calls after it showed or hid (§B) | the cut's X8 |
| `src/renderer/src/composer/Composer.tsx` | U4 | the live region and its writer (§F); `attachPasted` in the focus target it registers. `useDraftPort` is not edited (decision 9) | the root's table (the live region); the cut's X8 (the rest) |
| `src/renderer/src/composer/editor/controller.ts` | U4 | `attachPasted` on `EditorHandle`; `insertPasted` builds its node through `pastedBlock`; the export `submissionOf` over `submissions` | the cut's X8 |
| `src/renderer/src/composer/editor/pasted-block.ts`, `composer/attach-pasted.ts` | new, in U4's directory | whole (§C) | the cut's X8 |
| `src/renderer/src/stores/composer.ts` | no child | one optional member of `FocusTarget` (§C) | the first writing; ruled with P4 |
| `src/renderer/src/lane-b/remote-drafts.ts`, its test | U9 | `saveRemoteDraftOnce` takes `replaces: string \| null`; nothing else of the module changes | finding 4, as ruled |
| `src/renderer/src/tools/terminal/` | **in no row of the root's table** (the row gives U6 `terminal/` only); the child's item names `TerminalView.tsx` | the fifth item; `ATTACH` in `copy.ts`; `attach.ts` | the first writing: the table should name the directory |
| `src/renderer/src/App.tsx` | no child | two mounts | the first writing |
| `palette/CommandPalette.tsx`, its test | U6 | U1's two entries, U4's two and U11a's one leave with `UNAVAILABLE`, and their cases are rewritten (P9) | the cut, 8 (U11a's: P9) |

Not edited, though the cut or the child's file leads one to expect it: `stores/layout.ts` and `stores/layout-model.ts` (U13's; the record only reads); `app/Toolbar.tsx` (U7's; P5); `tools/code/review/` (U5's; P1); `tools/artifacts/`, `library/` (U10's; decision 18); `composer/editor/serialize.ts` and `side/` (finding 1: the `/btw` route is ticket 733's); `app/shell-actions.ts`.

### §I. The scenes (M5), by group, each with what it waits on

No spec file is added. Every scene reads a state it polls for; none reads a position or a count after an act it did not wait for. A scene that counts the palette's rows waits on the rows themselves: on an option it expects, or on the asynchronous answer it depends on having been drawn, never on the dialog alone being on screen.

| group, file | the scene | what it waits on |
|---|---|---|
| `e2e:layout`, `e2e/ux2-shell.spec.ts` | reworked, "U6a: ⌘J, ⇧⌘D and ⇧⌘F show and hide …": after each menu click, where the keyboard is (B1), the open-column path included; the Edit and Go menus and the sheet hold this half's three rows in their places (B13) | the element holding the keyboard being inside the surface, then inside the composer (polled); the menu item's `enabled` read from the application menu (polled) |
| the same file | new, "U6b-5: Back and Forward walk the places the window showed" (B7): A, B, Customize; back twice, forward; the dialog over B; the Overview, out of it and into it again; the ends; a closed tab; a move between the panes of a split | the tab in front by its `aria-selected`, the page by its region, the Overview by its panel being drawn or gone, the menu items' `enabled` |
| `e2e` and `e2e:layout`, `e2e/shell.spec.ts` | reworked, the palette's step ("Item 8"): the rows listed are those that can run, none `aria-disabled`; Recent first with nothing typed. "The Overview over a page" stands unedited and must pass: it pins P5. One step added to "a page beside the sidebar": after Esc, Go ▸ Forward is enabled | an action's option the scene names being drawn, then the count; the Recent group's first option; the menu item's `enabled` |
| `e2e`, `e2e/palette.spec.ts` | reworked, the two reveal scenes: End no longer lands on the project (the last row is the Library's); they select the project's row by its value. New, "an artifact found by its title opens beside the chat" (B6) | the Artifacts group's option for the typed title, which is drawn only once this Mac's `library.list` has answered; the side column's tab that shows the artifact |
| `e2e:terminal`, `e2e/terminal.spec.ts` | new, "Attach selection to chat": the menu's fifth item with a selection (B2), the screen with none (B3), a pinned terminal beside another session with a reload before its session is opened (B4). Where the group's harness draws no composer for a session, the three scenes go to `e2e/composer.spec.ts` | the composer's pasted chip and its text; the line's text; after the reload, the session's box holding the chip. "Nothing was sent" is read from the transcript's rows, with a send at the scene's end as the control |
| `e2e:composer`, `e2e/composer.spec.ts`; `e2e:lane-a`, `e2e/lane-a.spec.ts` | new step, "⇧Tab says the mode" (B9): on the composer's route the sentence; on lane A's, nothing said (the chip takes no change there), with the composer's route as the control | the live region's text |
| `e2e:code`, `e2e/code-editor.spec.ts` | new, "⌘[ and ⌘] change nothing in a file" (B8): the keys pressed in the editor on an indented line | the line's text unchanged after a frame, with ⇧Tab un-indenting it as the control |
| `e2e:widgets`, `e2e/widgets.spec.ts` | "My items on an owner-shaped registry" stands; one assertion added: after ⌘[ in the detail, the tab in front is the same | the list's return |
| `e2e:settings`, `e2e/settings.spec.ts` | new step: Settings › Keyboard lists the three rows with no control (B14) | the rows |

The held cases of the hand-over (B4's second half, B5) are unit cases: a scene cannot hold a store's answer open.

### §J. What a later landing may rely on, by name

- **`pastedBlock`** (`composer/editor/pasted-block.ts`): the one maker of the composer's text block. It is where a block is made, and no more than that: how a block's text leaves the composer is `serializeDraft` for a send and `plainTextOf` for a side question (row 13), and neither is edited here.
- **`FocusTarget.attachPasted`** (`stores/composer.ts`) and **`attachPasted(session, text)`** (`composer/attach-pasted.ts`): the way any surface puts text it did not get from the person's typing into a session's box as a block, with the hand-over behind it.
- **`useVisits`** (`keymap/visits.ts`): the record and the opened list. U13's groups, if they draw a most-recent order, read it here.
- **`focusSurfaceStop`**, **`available`** (`keymap/shell-navigation.ts`).
- **`saveRemoteDraftOnce`** naming `null` (`lane-b/remote-drafts.ts`).

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

**The terminal's attach** (`ATTACH` in `src/renderer/src/tools/terminal/copy.ts`), as the owner chose on card K4: the cause in the sentence. `<title>` is the session's title as its tab reads; `<machine>` is the name of the session's machine as the sidebar names it.

| outcome | the sentence |
|---|---|
| `added` | Added to <title> |
| `unconfirmed` | MAWS could not confirm that the selection was added to <title>. Open it to look before attaching again. |
| refused, `not-started` | Not added: <title> has not started. |
| refused, `taking-back` | Not added: <title> is taking a message back. |
| refused, `changed` | Not added: <title>'s draft kept changing. Attach again. |
| refused, `unknown` | Not added: this terminal's session is no longer known. |
| refused, `unreachable`, a session on another machine | Not added: <machine> is not answering. |
| refused, `unreachable`, a session on this Mac | Not added: MAWS's service on this Mac is not answering. |
| refused, `no-store` | Not added: <machine> keeps no drafts for this window. |
| refused, `busy` | Not added: <title> is sending a message. |
| refused, `closed` | Not added: <title> takes no typing now. |
| refused, `failed` | The selection was not added to <title>. |
| refused, `unsaved` | <title> has the selection, but its draft could not be saved. |
| nothing to attach | Nothing on this terminal's screen to attach. |

"Not added" is said only where no write of the block can still land (S1); every other doubt is `unconfirmed`. The sentence for this Mac's own service is the cut's ruled wording for a service that does not answer (its X7), with "Not added:" before it: the card's column had one sentence with a machine's name in it, and this Mac has none to put there.

The menu's row and the action's title: "Attach selection to chat" (the child's file).

**The palette** (`palette/CommandPalette.tsx`): the headings "Recent" and "Artifacts" (with two machines, "Artifacts · <machine>"); the last row, "Search the Library for “<the text typed>”".

**The live region** (`composer/Composer.tsx`): "Permission mode: <label>".

**The menus**: the three titles of Interfaces §A.

## The cards for the owner

All three are answered (2026-11-17; Decision Log 8). Each is kept as it was put, with the question as the owner read it, the answer in the owner's words, and the one place it is built. K3 (how far zoom goes) is U6b-5b's.

### K1 · After you close a tab, where does ⌘[ go?

You looked at session A, then at session B. In the strip B stands last, after a tab C you were not looking at. You close B. MAWS shows C, the tab beside it, as it does today.

| | what happens | what it means in use |
|---|---|---|
| **1. The strip decides what a close shows; Back follows what was shown** (built; recommended) | You are on C. ⌘[ shows A. B is gone from Back's list, and Reopen closed tab brings it back | Closing a tab works exactly as today. Back sometimes starts from a tab you did not choose |
| 2. Closing a tab goes back | Closing B shows A, the place you were at before it | What a close shows changes for every tab, with or without ⌘[: the strip's own rule, which you looked at with the one strip, is replaced |

Recommended: 1. The one place: `gone` in `keymap/places.ts` (option 2 would also change `closeTab` in U13's model, which this landing does not edit).

**Answered, 2026-11-17.** The question as put: "MAWS gets ⌘[ / ⌘] to go Back and Forward between places you looked at (landing U6b-5a). Say you looked at session A, then at session B; in the tab strip B stands last, after a tab C you were not looking at. You close B, and MAWS shows C (the tab beside it), as it does today. What should ⌘[ do after that?" The owner's answer: "Strip decides, Back follows (Recommended)". This is option 1, which is what is built.

### K2 · You press Esc on a page. Was that Back?

On session A you open Customize, then press Esc, or the page's own Back button. You are on A again.

| | ⌘] then | ⌘[ then | what it means in use |
|---|---|---|---|
| **1. Esc was a step back** (built; recommended) | opens Customize again | shows what you looked at before A | Esc, the page's Back and ⌘[ are one act. The Overview closed with Esc behaves the same |
| 2. Esc is a new step | does nothing | opens Customize again, the page you just closed | Back always undoes the last thing you did, a close included |
| 3. The page's Back and Esc become Back itself | as 1 | as 1 | The same as 1 from a page opened from a tab. From a page opened from another page, Esc shows that page and not your tabs; after a relaunch that restored a page, its Back button has nowhere to go |

Recommended: 1. The one place: rule 2 of `seen` in `keymap/places.ts`; option 3 would also change `PageTitle` in `app/Toolbar.tsx` and the page's Esc (U7's).

**Answered, 2026-11-17.** The question as put: "With ⌘[ / ⌘] for Back and Forward: on session A you open a page such as Customize, then press Esc (or the page's own Back button), and you are on A again. Was that Esc a step back?" The owner's answer: "Esc was a step back (Recommended)". This is option 1, which is what is built.

### K4 · What MAWS says when a selection could not be added

You attach a selection from a terminal that is kept open for every session. Its own session is not on screen, and the selection cannot be put in that session's draft.

| | what you read | what it means in use |
|---|---|---|
| A. One sentence for every cause (the first default) | "The selection was not added to <title>." | You know it failed and that the selection is still selected. You do not know whether to try again |
| **B. The cause in the sentence** (recommended; chosen; built) | the table of "The sentences a person reads" | You know what to do: open the session, wait, or try again |
| C. B, with one button where there is an act | B, and "Open <title>" on the line for a session that has not started | One click to the place where the attach will work |

With any of the three there is one more sentence, for the rare case where MAWS cannot know (the session's machine took the write and its answer was lost, and the machine cannot be read): "MAWS could not confirm that the selection was added to <title>. Open it to look before attaching again." It is yours to word. It is never replaced by "not added": attaching again after a false "not added" would put the selection in twice.

Recommended: B. The one place: `ATTACH` in `tools/terminal/copy.ts`.

**Answered, 2026-11-17.** The question as put: "⇧⌘L attaches a terminal's selection to its session's chat even when that session is not on screen (landing U6b-5a). When it cannot be added, what should the one-line notice say? (Separately, in every option: when MAWS cannot know, it says "MAWS could not confirm that the selection was added to <title>. Open it to look before attaching again." Type in Other if you want that worded differently.)" The owner's answer: "The cause in the sentence (Recommended)". This is option B. It was not the default the earlier revisions built: the table of "The sentences a person reads" is now the cause sentences, and the sentence for what MAWS cannot confirm stands as worded.

## Proof that an executor does not run

Each is a step with what it needs, handed to the architect.

| # | what | when | what it needs | what comes back |
|---|---|---|---|---|
| 1 | **The scenes of Interfaces §I** | after M5 | A Mac under the load rule. The new and reworked scenes alone first, then each group whole: `e2e`, `e2e:layout`, `e2e:terminal`, `e2e:composer`, `e2e:lane-a`, `e2e:code`, `e2e:widgets`, `e2e:settings` | Each group's result |
| 2 | **The gate's crossing of older builds** | on the final head | Nothing of this half's own: it adds no cross-build scene and no stored form. The group runs as the gate runs it, against the master this landing merges into and against master at `b89d6d1d7`; no scene of this half must pass or may skip there | The group's result, unchanged by this landing |
| 3 | **The owner's hands** (the child's probe 6) | on the wave's build, on the owner's machines | About ten minutes | ⇧⌘L in a terminal attaches and "Search With Google" does not open; with a terminal holding the keyboard, Edit ▸ Attach selection to chat opened with the mouse is enabled (P8 rests on the menu bar not taking the page's focus, which no scene can press); under the Korean input source ⌘[, ⌘] and ⇧⌘L work and ⌘J, ⇧⌘D, ⇧⌘F still do |
| 4 | **The owner's ears** | with 3 | VoiceOver on | ⇧Tab in the composer is heard as "Permission mode: Plan" |
| 5 | **The branch review** | after M5 | `doperpowers:review-code`, the xhigh panel | A verdict and findings; the fixes are one wave through the controller |
| 6 | **Class 1a** | once, on the head the pull request will carry | `scripts/ci-gate.sh` with the static, unit and probe gates | The run's id |

No unit case of this landing is guarded to macOS. No paid live group is touched: no scene of `p1-live` crosses this change. No drawn example is needed before the build ("The look").

## Size and review

Counted from the code at the pin, tests and scenes included, after the review's additions. The first writing gave this half about 3,200 lines over 55 files; the hand-over, the block's identity, the settling of a lost answer, the remote helper and the projection add to M2 and M3.

| milestone | changed lines, about | files, about |
|---|---|---|
| M1 show and hide, the mode | 400 | 11 |
| M2 attach | 1,650 | 25 |
| M3 Back and Forward | 850 | 11 |
| M4 the palette | 700 | 7 |
| M5 scenes and record | 450 | 11 |
| **U6b-5a** | **4,050** | **58** (some files are counted in two milestones) |

These are estimates from reading, not a diff. M2 is the largest and the one whose size is least certain: two thirds of it are tests that hold answers open.

**Review: the xhigh panel.** By size (past both marks), and because M2 is a sequence over four writers of one draft (the editor, a send in flight, the store's round, another machine's queue) in files of U4 and U9. The review's lens for M2 is S1's three claims: at most once, the person's edits kept, nothing said before an end.

**The other half.** U6b-5b is about 2,200 lines over 48 files, with the panel as well; its document gives the count. The two are sequential: U6b-5b is cut from this landing's head, and "The landing's edge" names the files both edit. Its spike is written to run and be reviewed by itself while this half is built.

## Statements to check again on the head this landing is built on

This document was written against the pin, which holds eight landings in review. This landing is built later, on a head that holds the chain up to U6b-3b. Before M1, and after any merge that brings a change to one of these places, each statement is read again; one that no longer holds is a stop for the controller.

| # | the statement | where it was read | what would move it |
|---|---|---|---|
| 1 | The composer's text block has one maker, private, and a paste becomes a block only past 20,000 characters | `insertPasted`, `classifyText` | **Board ticket 733** (a paste that holds a line or more goes to the agent marked as pasted content; its design is not written). The meeting point for *making* a block is `pastedBlock`. To check at its design: that a block made by the attach is treated as a paste is; whether its label should name its terminal |
| 2 | **The `/btw` rule of ticket 733b.** A box that begins `/btw` asks its plain text, a block's text unframed; a side question is a one-shot call with no tools and no transcript record; a promotion frames whole exchanges | `plainTextOf`; E3's document; `promotionMessage` | Ticket 733's second document, 733b, which is not written and owns what a block's text may be on that route (its first, `docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md`, exists on its own branch and does not hold the rule). When 733b is written: read its rule, and name here the scene or test of it that covers an attached block in a `/btw` box. Until then this landing's tracker row stands (M5) |
| 3 | A composer restores its draft only if nothing was typed since it mounted and its box is empty; its saves on this Mac name no revision | `mount`, `saveDraft` in `controller.ts`; `ipcDrafts` | U4b, any later composer landing. S1 rests on both |
| 4 | A send is kept per session in one map from its hand-over until it settles; when it settles the controller writes the draft (a clear, or the text back) before it removes the send from the map and settles its promise, and does all of that for an unmounted composer too | `submit`, `followSubmission`, `submissions` in `controller.ts` | the same. S1's first row rests on the order: the write handed over, then the promise |
| 5 | `session.drafts.get` answers a cleared draft as none on this Mac and with its stamp over the link; every form of `replaces` is a guard (a revision, none, the claim form), and of the three only the claim form can come true again, after a clear. The bound of one command is `REQUEST_TIMEOUT_MS` on this Mac and `REMOTE_ACT_PENDING_MS` over the link | `src/services/index/register.ts`, `drafts.ts` | a change to the draft store |
| 6 | `readRemoteDraft` asks the machine; `unsavedRemoteDraft` is the newest document not taken; `saveRemoteDraftOnce` sends once in the session's order and retires the older save | `lane-b/remote-drafts.ts` | U4b; a landing of U9 |
| 7 | Only Terminal and a mod's pane take the keyboard on a focus request; Review reads its scope again | `ReviewShell.tsx` | U5b-2, which is on the pin and edits that effect |
| 8 | Files answers no focus request; a Files tab holds a file or none | `FilesTool.tsx`, `FileBody` | U6b-2 (on the pin); **U6b-3, which lands before this**: its filter for Go to file is its own entry and is not what a focus request lands on |
| 9 | `toggleSurface` hides the whole column and shows by `showSurfaceTab` | `panel/SurfaceRow.tsx` | a landing of U8 |
| 10 | The table has no `menu: 'edit'` row, so `menu.test.ts` ends the Edit menu on Select All and `keymap.test.ts` finds "Edit › Sample" right after File | the two tests | U3b's Find rows, if they reach the table first: the two cases then change there, and M2 only adds its row |
| 11 | `files.goToFile` is not a row; Go leads with the palette; `LANDED`'s comment counts seven | `actions.ts`, `actions.test.ts` | **U6b-3, which lands before this**: Go to file then stands after the palette, Back and Forward still lead, and the comment is corrected against what is there |
| 12 | `UNAVAILABLE` has ten entries, of U1, U4, U11a and the first build | `CommandPalette.tsx` | any landing that adds an entry: it is removed with the rest, and its row is listed by `listable`'s rule |
| 13 | The Artifacts tool writes `{ target, machine }` under its tab's `panelParams` when it shows an artifact | `tools/artifacts/ArtifactsTool.tsx` | U10b |
| 14 | An artifact link opens by `showOpenArtifactTab`, else `openArtifactInPanel` | `library/actions.ts` | U6d, U10b |
| 15 | `activateTab` and `openDestination` leave `overviewOpen` as it is; `closeDestination`, `setOverviewOpen`, `quietly` as read; the page's Back calls `closeDestination` | `stores/layout.ts`, `app/Toolbar.tsx` | a landing of U7 or U13 |
| 16 | The projection's five parts are all of the layout that navigation is: the page, `overviewOpen`, each pane's tab in front, `focusedPane`, the tabs | `stores/layout.ts`, `stores/layout-model.ts` | U13's groups, or any landing that adds a place |
| 17 | "The Overview over a page" pins that the page's Back leaves the Overview open | `e2e/shell.spec.ts` | — |
| 18 | The count of spec files the gate pins, and that this landing adds none | `.github/scripts/e2e-default-specs.test.mjs` | a landing before this that adds a spec |
| 19 | Build M is `2c7044231` and knows the claim form; build F is `f1852de3a` and does not | `git show` at each | a new build in use |
| 20 | No site of the guard of who sends as the person changes | `test/support/person-sends.test.ts` | — |

## The pull request

The body is the short form the owner chose on 2026-11-17: the proof, what differs from the plan, what is left over.

## Surprises & Discoveries

Found while this document was written and reviewed; each changed a decision above.

- Observation: the window's read of a draft on this Mac hides a cleared draft, so the cut's "save naming the draft it replaces" is refused on every session that has sent a message.
  Evidence: `register('session.drafts.get', …)` answers `index.drafts.get` unless the request came over the link; `DraftStore.set` compares `(kept?.updated_at ?? null) !== replaces`, and a cleared row keeps a stamp (`src/services/index/drafts.ts`).
- Observation: a terminal can belong to a session that has not started, and stay so.
  Evidence: `createForLaunch` runs at `launching`, before the engine; `rollbackIntent` removes the record and keeps the intent; `events.ts` drops a removed session's side tabs only when nothing retains its tab.
- Observation: Review takes no keyboard on a focus request.
  Evidence: `ReviewShell.tsx`'s effect over `focusRequest` calls `useReview.getState().refresh(target)` and focuses nothing.
- Observation (the adversarial review, finding 2): a mounting composer cannot be made safe by delaying its read.
  Evidence: `mount` in `controller.ts` restores only when `this.revision === revision` and the box is empty; `saveDraft` calls `this.drafts.save(draft)` with no revision.
- Observation (finding 1): a pasted block is unframed in a side question.
  Evidence: `plainTextOf` in `serialize.ts`, "pasted text in place and unframed (no `<pasted_content>` tags)", used by `submit` for a box whose text begins `/btw`.
- Observation (finding 3): the remote writer's own comment says a save answered `timeout` "may still land".
  Evidence: `saveOnce` in `lane-b/remote-drafts.ts`.
- Observation (the delta review): a send outlives its composer and writes the draft when it settles.
  Evidence: in `submit`, `if (accepted) { if (this.drafts.clearsOnSend?.() ?? true) this.saveDraft(null); }` runs before `submissions.delete(appSessionId)` with no test of `this.live`; `followSubmission` returns early for an unmounted editor only after that.
- Observation (finding 5): showing a tab does not close the Overview.
  Evidence: `commitShown` writes `{ destination: null, settings: null }` and nothing of `overviewOpen`.
- Observation: the table's test already holds the six chords, and requires every id it lists as landed to be a row.
  Evidence: `WAVE_DEFAULTS` under "// U6b"; `for (const id of LANDED) expect(id in table, id).toBe(true)`.
- Observation: Claude Desktop `app-5.1231.2`, read for this half's acts. Its Back and Forward are the main view's own navigation history, so they give MAWS's record no model (`main-process/index.chunk-BV3uOqbK.js:325366-325418`). Its attach makes a snippet labelled with the terminal's tab, takes the viewport's rows when nothing is selected, and says nothing when it cannot attach (`web/app/v1/c03935b01-nTCeq8MH.js:8441-8475`, `c6bf19e8f-FP4iLEoJ.js:3563-3584`). Its palette hides what cannot run and lists recent items of mixed kinds, artifacts among them (`web/app/v1/c2771e1f6-CK6VDvCi.js:7759-7787`, `:8335-8337`). It has no ⇧Tab for the mode and no announcement of it: MAWS's sentence is its own.
  Evidence: the lines cited, read in the build's readable tree.
- Observation (M1): a terminal session's mode chip takes no change, so B9's "on a terminal session alike" could not hold; ⇧Tab there asks nothing and says nothing.
  Evidence: `session/controls/lane-a.ts`, the mode is closed (`LANE_A_WORDS.mode`, "A terminal session's mode is changed in the terminal"); `mode.disabled !== null`.
- Observation (M1): the side column's host asks for the keyboard on every open of a tab (a link, a tree row, the agent's show), not only on a surface's key; Terminal and a mod's pane answer all of them, so an agent's show of a Terminal already takes the keyboard from the person. Existing behaviour, unchanged here; a tracker row (M5).
  Evidence: `requestFocus` from `connectPanelHost` and `panelHost.selectTab` in `panel/host.ts`; `takeFocusRequest` in `tools/terminal/TerminalView.tsx`.
- Observation (M1): Files' tree is a virtual list whose rows are drawn only after the tab's effect has run, so an answer made directly in that effect finds no row.
  Evidence: the M1 executor's failing case before `9cec26264`; the answer now goes through U6b-3b's request for the keyboard in `tools/code/files/finder.ts`.

## Decision Log

1. **2026-11-17 (UTC) · The verification call.** This document gets an adversarial review before an executor starts (done on its first writing; revision 2 got a delta review, Decision Log 6; there is no second adversarial read). The branch gets `doperpowers:review-code` at the xhigh panel ("Size and review"). Class 1a on GitHub Actions is the gate of record.
2. **2026-11-17 (UTC) · Ruled on the adversarial review.** Nine findings on the first writing (`8d1235ea6`), two of the first rank and seven of the second, each read by the architect at the cited place: all accepted. Findings 1 to 6 bind this document and are designed in as "The adversarial review's findings, and the rulings" says: the `/btw` route is not closed here and is ticket 733's by name (1); the hand-over replaces the wait in `load` (2); a block's identity, a settling read and the outcome `unconfirmed` (3); the remote round and the widened helper (4); a step sets the Overview both ways (5); the navigation projection (6). Findings 7 to 9 bind U6b-5b. The review's three smaller notes are taken.
3. **2026-11-17 (UTC) · Ruled on the points.** P1 accepted: no edit in Review's file, a tracker row for Review's own answer to a focus request. P2 accepted as finding 4 corrects it. P3 accepted. P4 accepted as findings 2 and 3 correct it. P5 accepted; K2 stays the owner's. P8 and P9 accepted. (P6 and P7 are in U6b-5b's document.) The cards K1, K2 and K4 stay the owner's with their built defaults.
4. **2026-11-17 (UTC) · Ruled: two landings (P10).** U6b-5a, the keyboard: this document, on `ux-wave/U6b-5`. U6b-5b, zoom: its own document and, later, a branch cut from this landing's head. The halves are sequential; each adds only its own ids to `LANDED`, has its own acceptance, proof, scene groups and tracker rows; neither takes a wire minor. Order in the chain: U6b-3b, then U6b-5a, then U6b-5b. U6b-5b's spike may run and be reviewed while this half is built.
5. **2026-11-17 (UTC) · Revision 2, in place.** The first writing's decision 9 is withdrawn and decisions 30 to 33 added; decisions 7, 8, 12, 13 and 15 are rewritten; S1 is new; S3 and decisions 23 to 29 moved to U6b-5b's document with M1, M6, B10 to B12, K3, P6 and P7. Milestones are numbered again (M1 to M5).
6. **2026-11-17 (UTC) · Ruled on the delta review of revision 2.** One reviewer on the medium rung read `ee20c0074`; the session that keeps master had ruled a delta review, and there is no second adversarial read. For this document it closed findings 1, 4, 5 and 6 and left 2 and 3 partly closed. Its four findings here, each read by the architect at the cited place, all accepted. (i) A send outlives its composer and clears the draft when it settles: the hand-over's settlement includes every send of the session in flight, from a mounted composer or not; no turn begins and no round is believed while one is in flight; a test holds the attach's write and a send across an unmount. (ii) An unaccounted write survives every exit: while one is unaccounted for, every refusal ends `unconfirmed`. (iii) The store's rounds end on one last read with no write: the block there is `added`, absent is `changed` only when no write is unaccounted for, and so `changed` leaves no block. (iv) M2 follows M1, which exports `available`. The four choices of revision 2 are accepted as the reviewer found them sound: the loop and not a barrier; a move between panes points the current entry at the tab in front; and, for U6b-5b, `publish` for the zoom key only and a 375 size that reads 376 at 200 %. The reviewer also confirmed that a block's id survives the draft's two passages (`draftOf`, `docOfDraft`) and that `replaces: string | null` on the window's helper is no change of the wire. The `/btw` rule is ticket 733b's, which is not written: statement 2 stays.
7. **2026-11-17 (UTC) · Ruled on the re-check of S1; the review of S1 stops here.** One reviewer on the medium rung read `37074c0b6`: the send's row is closed (`submissionOf` sees every send of the session, and a refused send's restoring save is covered). Three gaps in what "accounted for" and `changed` mean, each read by the architect at the cited place, all accepted, and one addition. (i) A write in the claim form that is unaccounted for stays so for the rest of the hand-over: a later accepted write does not retire it, since a claim can become eligible again after a clear; a write naming a revision is retired as before. Tested with the clear in between. (ii) For a session on another machine, `changed` at the last read needs the machine's own answer to lack the block and no save of the session still out in the window's queue; a clear the window still holds never masks a machine document that holds the block; otherwise the end is `unconfirmed`. Tested with another device of the member saving revisions that hold the block. (iii) Tests added: a send that outlives its composer, accepted and refused, for a session on another machine through the real remote queue, the send's own save held apart from its answer, with its timeout and its late landing; and a composer mounting during the last read. (iv) A deadline on the whole hand-over, `attachDeadlineMs`: eight times the bound of one command on the session's route (`REQUEST_TIMEOUT_MS`, `REMOTE_ACT_PENDING_MS`), seven for the store's work at its worst and one for a wait; at it the end is `unconfirmed` when any write of the block was sent, else a refusal by its cause; tested with a fake clock and a send that never settles. `ATTACH_ROUNDS` stays the bound on the store's work. After this, anything further found in S1 while building goes to a tracker row unless it loses a block.
8. **2026-11-17 (UTC) · The owner's answers to K1, K2 and K4** (recorded verbatim on board ticket 674, with each question as put; quoted under each card). K1: "Strip decides, Back follows (Recommended)", the built default. K2: "Esc was a step back (Recommended)", the built default. K4: "The cause in the sentence (Recommended)", which was not the built default: `ATTACH` in `tools/terminal/copy.ts` is the cause sentences of the card's recommended column, the sentence for what MAWS cannot confirm stands as worded, and M2 pins each sentence by a case. One sentence is added to the column so that it is total: a session on this Mac whose service does not answer has no machine's name to say, and reads "Not added: MAWS's service on this Mac is not answering."
9. **2026-11-18 (UTC) · The head after U6b-3b; the statements read again.** The branch merged `origin/ux-wave/U6b-3b` at `6ee3382a7` (it holds U6b-3a) as `74baf7950`. The merge touched none of the files statements 1 to 7, 9, 13 to 17, 19 and 20 rest on (the composer, `lane-b/remote-drafts.ts`, the draft store, `stores/layout*.ts`, `ReviewShell.tsx`, `panel/SurfaceRow.tsx`, `app/Toolbar.tsx`, `library/`, `tools/artifacts/`, `person-sends`): they hold as written. Statement 8 holds: U6b-3 grew `FilesTool.tsx` (the Go to file field and its finder) and still answers no focus request; decision 4's answer is written into that grown file, and the finder's field is not what it lands on. Statement 10 holds: no `menu: 'edit'` row. Statement 11 moved as foreseen: `files.goToFile` is a row directly after `palette.open` (`GROUP_OF_PREFIX` gained `files: 'palette'`), it joined `LANDED` and `SHELL_FOCUS_ACTIONS`, and `keymap.test.ts`'s list of rows with no rebinding now names it after `channel.open`; `LANDED`'s comment still says "U6b adds its seven" and is corrected by M2 or M3 as §A says. Back and Forward still lead Go, before `palette.open`, as their own group. Statement 12 holds: `UNAVAILABLE` has its ten entries; U6b-3b also gave the palette `modalHandoff` (`keymap/modal-handoff.ts`), through which a row that moves the keyboard (`sidebar.focus`, the region steps, `files.goToFile`) runs after the dialog has let go: M4 keeps that path for the rows it lists. Statement 18 holds: 125 spec files at the pin and on this head. No statement is a stop.
10. **2026-11-18 (UTC) · M1's decisions, folded from its executor.** (i) Decision 4 is narrowed: Files answers only the focus request whose counter value a surface's key made (`toggleSurface` records it), and a later request of the host, the tab being hidden or its unmounting withdraws the key's request if it still waits (`withdrawKeyboard` in `finder.ts`; refined by M1's review, findings 1 and 2), not the host's requests on every open of a Files tab (a link, a tree row, the agent's show), which would move the keyboard into a file the person did not ask to work in; those requests are used up with no answer, as before. The landing's edge is "a surface shown by its key", which this keeps whole. (ii) Files' answer goes through U6b-3b's request for the keyboard in `tools/code/files/finder.ts` (U6's own file, not in M1's list) with a new `tree` taker, since the tree's rows are drawn after the tab's effect. A Files tab whose tree stands in its file's place answers with the tree. (iii) The sentence's label is the chip's, `PERMISSION_MODE_LABELS` (§F's `MODE_OPTIONS` has no labels). (iv) Decision 2's "the person has put the keyboard somewhere else in between" is a keydown or a pointerdown between the request and the second frame, not a change of the focused element, which a Radix menu returning focus to its trigger would trip; and the F6 fallback also yields when a later focus request for the tab has superseded the key's (its counter moved past the key's value; M1's re-review). (v) On a hide the composer of the session on screen, else the pane in front, takes the keyboard in the next animation frame (not synchronously: the main region leaves `inert` only once React has committed the hide), and only when at the hide the keyboard was in the column or nowhere and at that frame nothing available outside the column holds it (amended 2026-11-18 by M1's review, finding 4). (vi) `sideSurfaceOf` is exported beside `focusSurfaceStop` and `available`; F6 and the key's fallback share one stop rule. (vii) S4's "taken, not yet on the chip" writes once the chip shows the mode the engine's answer named (`liveModeBinding` keeps `effective`; the mode asked where none is named), and a press supersedes only presses still unanswered (refined by M1's review, finding 5); presses answered with the same mode before the chip shows it are said once, when it does: a polite region that says one mode twice in a row tells the person nothing more, and the rule "a repeat of one sentence is written again" is for a press made after the last sentence was written (amended 2026-11-18 by M1's re-review); each sentence is a new node, so a repeat is read again. (viii) `panel/surface-row.test.ts` became `.tsx` to render the side column. (ix) B9 is corrected against the code: a terminal session's chip takes no change, so nothing is said there (S4's last rule); §I's lane A step asserts that, with the composer's route as its control.
11. **2026-11-18 (UTC) · M3's decisions, folded from its executor.** (i) A step onto a tab that left the strip in the same turn does nothing and does not move the record's position, so `activateTab` never closes a page for a tab it cannot show and the record never stands on a tab other than the one shown; the entry is dropped at the next read, as M3's proof says. (ii) `opened` gains a session or artifact tab only when it becomes the new place in front: a move between the panes, a change in the other pane alone, and the place restored at hydration open nothing; the list is capped at 50 (`PLACES_MAX`). (iii) The artifact shown beside the chat (`panelParams`, decision 18) is M4's, which owns the opened list's sources and their tests. (iv) `connectVisits` starts the record afresh when it connects: the record belongs to the run. (v) A page is compared by its whole value for rule 1 of `seen`, so a change of its view or filter updates its entry; when neighbours merge (`gone`, `refocused`), the entry the record is at wins when it is in the group, since it is what the window shows, else the newer (amended 2026-11-18 by M3's review, finding 2). (vi) `LANDED`'s comment is corrected to read true after M2 adds its row too. (viii) Decision 15 gains a hand-off of the keyboard (M3's review, finding 1): a step that opens the Overview over a tab first gives that tab's pane the keyboard, so the Overview's opener is in the right pane; and a step holds a short hand-off until a task after the next animation frame, the next step, or the person's next key or press, during which a change of `focusedPane` alone, away from the step's target, does not re-point the record and the keyboard goes back to the step's pane. The Overview's return of the keyboard to its opener in the other pane of a split can therefore no longer rewrite the record. (vii) With text typed, ⌘K's substring match lists "Back" and "Forward" while they can run (they are listable rows with handlers): M4's cases and M5's palette scenes expect that.
12. **2026-11-18 (UTC) · The Library keeps its latest view on a step.** M3's review found that decision 15's "its view and filter are kept in the entry" cannot hold for the Library: its `Destination` is its kind alone, and its query, view, filters and machine live in the Library's one store (`library/view.ts`, U10's). Ruled: a step back or forward onto a Library entry opens the Library as it stands now, with the query and filters the person last left in it; the record does not snapshot or restore them. Restoring an older query on a step would overwrite what was typed last, and would need writes into U10's store that no table names. A page whose `Destination` carries its view (Customize's) keeps it in the entry as decision 15 says.

## Outcomes & Retrospective

Pending — written at finish.
