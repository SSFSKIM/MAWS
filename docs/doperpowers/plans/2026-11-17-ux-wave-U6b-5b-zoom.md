# UX wave · U6, the fifth landing of U6b, second half (U6b-5b): zoom

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), its landing **U6b-5b** (board ticket 674, under ticket 592). **Parent pin:** `bdbfe863e6b2f59031c10f0c51873c4a0210b00b`, the commit every statement about the code below was checked against: master as it stood on 2026-11-17 (`77af813a4`) plus the eight landings of the chain's fourth batch, which are in review and not on master.
>
> **What is settled before this document:** the cut, `docs/doperpowers/plans/2026-11-14-ux-wave-U6b-cut.md`, section "U6b-5" (its decisions 4 and 5, its ruled points X2, X3 and X8), cited below as *the cut*; and, on the first writing of U6b-5 as one document (`8d1235ea6`), the adversarial review of 2026-11-17 and the architect's rulings (Decision Log 2 to 4). This document carries the constraints and the milestones; the design is the child's file (l7-shell-08) and the cut.
>
> **This document is one of two.** The first writing was ruled into two landings. U6b-5a, the keyboard, is `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md`. **U6b-5b is zoom:** its spike (M1), its build (M2), its scenes and the cross-build row of `window.zoom` (M3), and three of UC-6's six rows. Decisions, sequences, points and acceptance items keep the first writing's numbers (decisions 23 to 29, S3, P6 and P7, B10 to B12), so that the review and the rulings can be followed; 34 to 36 are new with the review.
>
> **Revision 3 (2026-11-17).** A delta review of revision 2 (`ee20c0074`; one reviewer, medium rung) closed findings 7 and 8 for this half and left 9 partly closed, with two findings of the second rank on this document. The architect read each cited place and ruled (Decision Log 5). What moved: what M1 records for the device size, and when row j is a stop.
>
> **Revision 4 (2026-11-17).** The owner answered card K3 (Decision Log 6): the range stays 50 % to 200 %, and after each zoom act a line says the size reached. That was not the default the earlier revisions built; decision 37, M2 and the scenes now hold it.
>
> **Branch: `ux-wave/U6b-5b`**, cut from the head of `ux-wave/U6b-5` that carries this revision. M1 is a spike that stands on nothing of U6b-5a: it is built there at once, and may run and be reviewed while U6b-5a is built. Before M2, U6b-5a's head is merged into the branch; "What this landing stands on" says what of U6b-5a M2 and M3 need. **Order in the chain:** after U6b-5a, last of U6b. **Not in this landing:** everything of U6b-5a; pinch to zoom; a size per session or per surface; a button or any other control on screen for the size (card K3, as answered: a line that says the size, and no button).

## Purpose

After this landing ⌘= and ⌘− make the whole window larger and smaller in steps, View ▸ Actual Size returns to 100 %, and the size survives a relaunch. A page shown in the in-app browser stays exactly under its frame at every step, with everything else that is placed natively over the window: an extension's popup, the browser's menus, a comment's pin, the traffic lights, a page held at a device's size. With the keyboard in a web page the same keys zoom that page only, as today. A build from before this one, started on the same profile, shows 100 % and loses nothing.

How to see it working: the acceptance below, B10 to B12, B13 and B14. All of its proof beyond the unit suites is on a Mac, and its first step is a measurement.

## Progress

- [x] (2026-11-17 08:05Z) The first writing of U6b-5 as one document (`8d1235ea6`).
- [x] (2026-11-17) The adversarial review and the architect's rulings: two landings; findings 7, 8 and 9 bind this one; P6 and P7 accepted, as the findings correct them.
- [x] (2026-11-17) This document written.
- [x] (2026-11-17) The delta review of revision 2 and the architect's rulings on its two findings here; revision 3.
- [x] (2026-11-17) The owner's answer to K3; revision 4.
- [ ] (2026-11-17) M1 built on `ux-wave/U6b-5b` (`366e995bf` to the head): the seam's two additions, `placedOn`, the harness and the four probe scenes. On the build VM the node and e2e typechecks, `src/main/browser`, eslint and the gate's script tests are green, and the harness's rows a to i have run (j: not run, one display). The task review's fix wave is `d78e60abf`; the independent review's nine findings, as ruled, are `c9343eb08` and `ca7d21a89`, with the harness's run of record at `ca7d21a89`. The architect's review and the Mac runs are still to come.
- [ ] (2026-11-19) M1's Mac rows 2 and 3 ran at `76d0bbc9d`. The harness and `e2e:browser` measured; the pin probe failed at 200 % and the chrome probe failed before any factor, both probe faults, fixed (Decision Log 13). The peers' probe passed against build F; build M is still to run. FINDINGS.md holds the run of record. The reruns at `ef018d192` and `e458d10c1` measured the pin, the popup and the menus, and the peers' probe established its default-mode control against build F. Every placement is now measured on the Mac (Decision Log 15, 16).
- [ ] M1 — Spike: what Chromium keeps of a window's zoom, and where the six placements land (the harness on the build VM; the probe scenes on a Mac, run by the architect). Its verdict gates M2.
- [ ] M2 — Zoom (on the architect's word after M1's verdict; on a head that holds U6b-5a).
- [ ] M3 — The scenes, the cross-build row, the record, and the acceptance run.

## Words used in this document

- **Build F, build M.** The two older builds that bind (root UC-14, and the architect's rule for this wave's later landings that two older builds bind, not one): build F is `f1852de3a`, kept as the build to go back to; build M is `2c7044231`, the build every machine runs. Both are read with `git show <sha>:<path>`. Both run Electron 44.4.5, as the pin does.
- **The factor.** The window's zoom: 1 at 100 %. Below it is also called the app's factor, to tell it from **a tab's zoom**, which is the in-app browser's own zoom of one page and is not changed here.
- **A window point** is the unit native placement takes (`setBounds`, a native menu's position, the traffic lights' position). **A CSS pixel** is the unit the app's page measures in. At factor f one CSS pixel of the app's page is f window points.
- **A placement.** A place where a number measured in one of the two units is handed to code that reads it in the other. There are six (Interfaces §G).
- **Isolated zoom.** Electron's zoom mode in which a web contents zooms by itself and shares its level with no other page of its origin (`webContents.setZoomMode('isolated')`, and `zoomMode` in a window's `webPreferences`).
- **The room.** The box a pane of the in-app browser has for its page, in CSS pixels (`Room` in `src/renderer/src/tools/browser/viewport.ts`).
- **Published.** Said of a layout key: the store's map and the file hold the new value together, or neither does.
- **The acknowledgment of a placement.** Main's own word, through the e2e seam, of the last rectangle it was handed for a tab. A scene that has changed the layout reads native bounds only after that word matches what the page now measures.

## The landing's edge

**In.**

| the child's item | what this landing builds of it | acceptance |
|---|---|---|
| l7-shell-08 | View ▸ Zoom In, Zoom Out, Actual Size; the stored factor; the six placements that follow it | B10 to B12 |
| three of UC-6's six rows | `zoom.in`, `zoom.out`, `zoom.reset` | B13, B14 |

**What this landing stands on, of U6b-5a.** M2 and M3 are built on a head that holds it, and need from it:

- the action table with its three rows, and `LANDED`, `menu.test.ts` and `settings-tab/keymap.test.ts` as that landing leaves them: this landing adds its three ids to each exact list, where they stand in the table;
- `listable` in `palette/CommandPalette.tsx`: a row is drawn in ⌘K while it has a handler, so the three zoom rows are listed, each while it can run, with no edit there;
- `src/renderer/src/App.tsx` with that landing's two mounts, beside which `connectZoom` is mounted;
- the scenes it reworked in `e2e/ux2-shell.spec.ts`, `e2e/terminal.spec.ts` and `e2e/settings.spec.ts`, to which this landing adds its own.

It needs no module of that landing: zoom shares none with the record, the attach or the palette. M1 needs nothing of it at all.

**The files both halves edit**, each its own lines:

| file | U6b-5a | this half (U6b-5b) |
|---|---|---|
| `src/shared/keymap/actions.ts` | the rows `terminal.attachSelection`, `go.back`, `go.forward` | the rows `zoom.in`, `zoom.out`, `zoom.reset` |
| `src/shared/keymap/actions.test.ts` | `LANDED` gains its three | `LANDED` gains these three and no other |
| `src/main/menu.ts` | `SHELL_FOCUS_ACTIONS` | the comment "No zoom roles" is rewritten: the three items are the app's own rows, not roles. No code |
| `src/main/menu.test.ts` | the Edit menu's case, Go's lead, the focus actions | the three items' place in View, outside any submenu |
| `src/renderer/src/settings-tab/keymap.test.ts` | the `Edit` group; three ids | three more ids in the list of rows that take no rebinding |
| `src/renderer/src/App.tsx` | two mounts | one mount: `connectZoom` |
| `e2e/ux2-shell.spec.ts` | the keyboard, Back and Forward, Edit and Go | View's three items and their enabled ends; three rows of the sheet |
| `e2e/terminal.spec.ts` | the attach scenes | the grid at 125 % |
| `e2e/settings.spec.ts` | three rows with no control | three more |
| `docs/tech-debt-tracker.md` | its rows | the row of 2026-10-24 loses zoom; the row of 2026-10-27; new rows (M3) |

`src/renderer/src/app/shell-actions.ts` is edited by neither half: the three handlers are registered by `connectZoom`. Neither half moves the wire's minor.

**Left over, each for a tracker row (M3).** ⌘+ (⇧⌘=) is not Zoom In: a row has one chord (UC-6), and Claude Desktop's second accelerator for it would be a second list of keys. The layout's breakpoints read the window in CSS pixels, so a zoomed window meets them at a wider size in points (card K3 shows it); the window's minimum size does not follow the factor. At 200 % a device size of an odd width reads one pixel wider than its name (decision 35).

## What the code holds today

Each statement was read at the pin. "The cut" names the cut's decision of that number in its section "U6b-5".

| # | what the cut or the child's file says | what the code holds | where |
|---|---|---|---|
| 1 | The three rows are missing | So. The table's test already names their chords under "U6b" (`Cmd+=`, `Cmd+-`, none) and requires every id its list of landed rows names to be a row. The chord vocabulary has both keys | `WAVE_DEFAULTS`, `LANDED` in `src/shared/keymap/actions.test.ts`; `PUNCTUATION` in `chord.ts` |
| 2 | Four placements assume a CSS pixel is a window point (the cut, 4) | **Six do.** The four, and: the traffic lights, placed in window points in a toolbar 44 CSS pixels high, with 78 CSS pixels kept clear for them; and the device-size box of the in-app browser (U12a). Mark up's still already multiplies by the page's factor (`cropRect`). No shared helper exists | the table in Interfaces §G |
| 3 | The device-size box is one number | It is three computations in one file, read by three callers: the box the pane sizes its page element to (`pageBox`), what the page then reads (`pageBox`'s `reads`, which the chip shows), and which sizes fit the room (`fits`, which the chip's menu disables by). All three use the tab's zoom and none the app's | `src/renderer/src/tools/browser/viewport.ts`; `chrome/ViewportChip.tsx`; `Pane.tsx` |
| 4 | The in-app browser's view is placed again when its rectangle changes | The window sends a rectangle only when it differs from the last one sent, so a change of factor that leaves a pane's CSS rectangle as it was sends nothing. The reports are sent from the page's own measuring, apart from any frame a scene can count | `Placement.measure` in `tools/browser/placement.ts` (`if (same(rect, this.sent)) return;`); `Pane.tsx` |
| 5 | The e2e seam shows where things are placed | For a tab's view and an extension's popup, yes (`bounds`). For a native menu it records the items and not the point; and nothing says which rectangle main last received for a tab | `src/main/browser/inspect.ts`; `NativeMenuSeam` in `bookmarks/menu.ts` |
| 6 | The presenter's window and the repair window load the app's own origin and would inherit the zoom (the cut, 4) | In a build the three pages are three `file:` URLs in the default session (the window's page, the same page with another query, another file); in a development run all three are on one host. Whether they share a zoom is not shown by any file of the repository: M1 measures it | `createWindow` in `src/main/window.ts`; `openPresentWindow`; `repairLaunch` |
| 7 | Whether Chromium keeps the zoom by itself is not known (the cut, 5) | Not known. Electron 44.4.5 declares isolated zoom: `setZoomMode('default' \| 'isolated' \| 'manual' \| 'disabled')` and the `zoomMode` web preference (the architect checked the declaration in the installed package on the build VM; no tracked file of the repository shows it). **Its behaviour is not known and is M1's to measure.** No code of the app's own page sets or stores a zoom today; the in-app browser's tabs store theirs in their own file and never apply it at a restore | `Navigator.zoom` in `src/main/browser/navigation.ts` |
| 8 | The window is shown when it is ready | On `ready-to-show`, once; nothing sets a zoom before it. So a factor that is not in force by then is seen changing | `createWindow` (`win.once('ready-to-show', …)`) |
| 9 | Zoom cannot be stored in `window.main` (the cut's X2) | So: both older builds parse it strictly. Both keep every key of `layout.json` through their own writes, list keys as plain strings, and refuse the window a key their schema does not name | `WindowStateSchema`; `LayoutFileStore` in `src/main/layout/store.ts`, at `f1852de3a` and `2c7044231` |
| 10 | A layout key that cannot be written leaves the layout as it was | **No.** `LayoutFileStore.set` puts the value in its map and then writes the file; `delete` removes it and then writes. A write that throws leaves the map changed, and the next write of any key puts the changed value in the file | `set`, `delete`, `write` in `src/main/layout/store.ts` |
| 11 | `MAIN_KEYS` holds main's own keys; two scenes pin the exact list of stored keys | So: `window.main` and `library.exportFolder`. Only `window.main` is debounced | `src/main/layout/store.ts`; `e2e/shell.spec.ts` |

## The points reported, and ruled

Reported with the first writing; ruled by the architect on 2026-11-17 (UTC) (Decision Log 3). P1 to P5, P8 and P9 are U6b-5a's and are in its document.

| # | The point | The ruling | What is built, and the one place |
|---|---|---|---|
| P6 | **Six placements, not four**, in files of U12, of U7 and of no child; and the browser's view must be placed again by main when the factor changes | **Accepted, as findings 8 and 9 correct it** | All six, each at the narrowest place, behind one function of main's (`zoomOf`); the device-size box by one formula for its three computations (decision 35); none before M1 has recorded it off. Interfaces §G, the table |
| P7 | **Isolated zoom changes the cut's decision 5.** If an isolated zoom is kept nowhere outside `window.zoom`, build F and build M show 100 % after any exit, forced or not, with no reset at quit to depend on; and the presenter's and the repair window stay at 100 % by themselves | **Accepted; M1's rows decide** | The window's page is made with `zoomMode: 'isolated'`; the factor is applied from `window.zoom` at every launch. `zoomMode` in `createWindow` (`src/main/window.ts`); M1's table |
| P10 | **The cut's size is too small** | **Two landings**; this is the second | "The landing's edge"; "Size and review" |

## The adversarial review's findings, and the rulings

The review of the first writing (`8d1235ea6`) is the adversarial review of 2026-11-17. The architect read every place it cites and accepted all nine findings (Decision Log 2). Three bind this half; findings 1 to 6 are U6b-5a's.

| # | The finding | The ruling | Where it is designed |
|---|---|---|---|
| 7 | **The zoom's write-failure proof assumed a store that takes a write whole or not at all**; the layout store changes its map before it writes | The zoom key is published atomically, map and file; proven with the real store and an injected failing writer: an unrelated later layout write, a new window and the next zoom command all keep the factor from before the failure | row 10; decision 34; S3; M2; Interfaces §G |
| 8 | **Scaling `pageBox` alone leaves the device choices and the size label wrong** | One formula with the app's factor for the page's box, the fit test and the size label, and their callers in the ownership table; the rounding stated; tests at both bounds | row 3; decision 35; M2; Interfaces §G and §H |
| 9 | **M1 could not deliver the verdict that gates the build**: no measurement for the menus' point or the device box; a wait on frames, not on main; a first-paint fallback that was not itself measured; no factor 0.5, no pointer, no move between displays | M1 gives a measurable observation before the fix for each of the six placements, waits on an acknowledgment that main processed the placement, has a verified first-paint fallback or an explicit stop, and its matrix includes factor 0.5, pointer targeting over the native view and a move between displays of different scale | M1; decision 36; Interfaces §G (the seams) |

The review also noted that the Electron API the design rests on is in no tracked file. The architect checked it on the build VM: the installed Electron 44.4.5 declares `setZoomMode` with its four modes and the `zoomMode` web preference. M1 therefore does not treat the API's existence as unknown; its behaviour is still M1's to measure (row i of the harness records that the call exists and what mode a window made with the preference reports).

## Decisions settled at authoring

Each is a means the child's file and the cut leave open, with its reason and what it beat. The numbers are the first writing's (1 to 22 and 30 to 33 are U6b-5a's); 34 to 36 are new with revision 2, and 37 with the owner's answer to K3.

23. **`window.zoom` is the truth; Chromium's own memory is not read.** `{ version: 1, factor }`, main's own key, absent at 100 %. Absent at 100 % so that a profile that was never zoomed holds no new key, and the scenes that pin the exact list of stored keys stand as they are. The zoom's module keeps no copy of the factor: every reader asks the store, so there is one value to be wrong about.
24. **The steps are the in-app browser's**, between 50 % and 200 %: `stepZoom` over `ZOOM_PRESETS` (`src/main/browser/navigation.ts`, imported, not edited), held to 0.5 and 2.
25. **One command and one event of main's** (`layout.zoom`, `layout.zoomChanged`). A menu click reaches the window as every action does, and the window's handler asks main. It beat running the three ids in main's menu code: the palette and the sheet read the window's handlers, and a row with none would not be listed.
26. **Isolated zoom** (P7).
27. **Main keeps the CSS rectangle and multiplies when it places**, and applies every placement of a window again when its factor changes (row 4). Each edge of a rectangle (left, top, right, bottom) is multiplied and rounded to a point, and its size is the difference, so two rectangles that touch in CSS pixels touch in points.
28. **Every app window has the one factor**, applied where a window is made.
29. **`zoom.in` has no handler at 200 %, `zoom.out` none at 50 %, `zoom.reset` none at 100 %.** The child's file asks it of Actual Size; Claude Desktop greys all three (`main-process/index.chunk-BV3uOqbK.js:327946-327949`), and the mechanism is the same registration.
34. **The zoom key is published, not set** (finding 7). The layout store gains one act, `publish(key, value)`: it puts the value in the map (or removes the key) and writes the file, and when the write throws it puts the map back to what it held for that key before the call and throws on. Only the zoom uses it. It beat giving `set` and `delete` the same rule for every key: that changes what a failed write of any layout key leaves, in every caller, which is no part of this landing.
35. **One formula for the device size, with the app's factor** (finding 8). With W the size named, z the tab's zoom and a the app's factor: the page's element is `min(round(W × z ÷ a), the room)` CSS pixels; the size the page then reads is `round(element × a ÷ z)`; a size fits when `W × z ÷ a` is no more than the room. The same for the height. The element is rounded to a whole CSS pixel, as today, and main rounds its edges to points (decision 27), so the page can read one pixel off the name: at 200 % and a tab at 100 %, 375 is 188 CSS pixels, 376 points. The chip says what the page reads (376), never the name. It beat sending main the unrounded rectangle, which changes the schema of the command every pane's placement uses.
36. **A scene reads native bounds only after main's acknowledgment** (finding 9). The e2e seam says which rectangle main last received for a tab; a scene that has changed the factor or the layout waits until that rectangle is the one the page now measures, and only then reads the view's bounds. Two frames are not a wait: the window sends its rectangle from its own measuring, at a time no frame count names.
37. **After each zoom act a line says the size reached** (card K3, as the owner answered it). "Zoom 125 %": the step reached as a whole percent, a space before the sign. It is the app's own line, a toast (`toast` in `stores/notices.ts`): level `info`, no action, no button to dismiss it, on screen for `ZOOM_LINE_MS` (1,500 ms, the toast's own `durationMs`). One line at a time: a press while a line shows takes that line away (`dismiss`) and shows a new one, with its own full time; replacing the text in place would leave the second press only what was left of the first one's time. It is shown for a change of the factor that an act made, Actual Size included ("Zoom 100 %"), and not for the factor a window opens with. It is said to a screen reader by the toast host itself, which announces every toast it draws; no live region is added. A press at an end changes nothing and shows nothing: the item has no handler there (decision 29). Nothing of `stores/notices.ts` or `app/ToastHost.tsx` is edited. One consequence is the toast host's own rule and is not changed here: while a line lies over a page of the in-app browser, that page is drawn as its still, as under any toast.

## The sequences that must hold

**S3 · A change of the factor.** In main, for `layout.zoom { to }`, in this order:

| step | what happens | when it fails |
|---|---|---|
| 1 | The next factor, from the factor the store holds now (`readFactor(store.get('window.zoom'))`) and `to`. The same as now: answer it and stop | |
| 2 | The key is published: the new value, or the key's removal at 100 % (decision 34) | The write throws: the store holds what it held, the command answers the error, and nothing below runs. The page, the placements, the next command and the next window all still have the old factor |
| 3 | The factor is set on every app window's page | |
| 4 | Each window's placements are applied again; its lights are placed; an open extension popup is placed again from its kept anchor | |
| 5 | `layout.zoomChanged` is sent to every app page | |
| 6 | The answer: the factor | |

Two presses are two commands, handled in order. The window's handlers follow the event, so between a press at an end and its event a second press can arrive: main holds the factor to its bounds and answers the factor it has. A window being made reads the store at its making (`openAt`).

## What is stored and sent, and what each older build does with it

Neither settings file changes (root UC-14). No stored tab, `main.tabs`, `regions` or stored side surface gains a field. The wire's minor does not move: `layout.*` is traffic between a window and its own main, which the wire's manifest leaves out (`src/shared/ipc/wire.ts`, its header).

| what | this build | build F (`f1852de3a`) | build M (`2c7044231`) | this build, after a stay on either |
|---|---|---|---|---|
| **`window.zoom`** in `layout.json`, `{ version: 1, factor }`, absent at 100 % | published by main alone when the factor changes; never crosses to the window | never reads it. Keeps it: its layout store reads every key of the file into one map and writes the map whole (`LayoutFileStore`). Its window cannot ask for it: `LayoutKeySchema` does not name it. What F draws is what Chromium kept of the zoom, which M1 measures (P7 expects 100 %) | the same, by the same code | reads the key it wrote and applies it. A value that does not parse reads as 100 % and is left as found until the next change |
| **Action ids** | none is stored: the three rows are not in build F's list, so no route stores a rebinding of one and Settings › Keyboard draws no control | its reader of `settings.json` never meets one | the same; M has the same guard | nothing to read |
| **`layout.zoom`, `layout.zoomChanged`** | a window and its own main | not sent to it | not sent to it | — |

The cross-build coverage table (the comment block U13a's M5 began in `e2e/cross-build.spec.ts`) gains one row, "U6b-5b: the window's zoom (`window.zoom`, main's own key)", and one scene, **"(zoom, both ways)"**, described in M3.

## Acceptance

Each item is a behaviour a person can check, numbered as in the first writing (B1 to B9 are U6b-5a's). "Unit" runs on the build VM; a scene runs on a Mac and is the architect's to start. A menu chord cannot be pressed through the scenes' driver (`e2e/support/menu.ts`), so a scene clicks the menu's item by its id; that the key itself reaches the item is the owner's hands (B13).

- **B10** (A10). View ▸ Zoom In and Zoom Out make the whole window larger and smaller along the steps; Actual Size returns to 100 % and is disabled there; Zoom In is disabled at 200 % and Zoom Out at 50 %. Quit and relaunch: the size is as left, and is in force when the window is first shown. After each act a line, "Zoom 125 %" with the step reached, shows for a second and a half and is said to a screen reader; a second press replaces it. In a page of the in-app browser the keys zoom that page alone, as today, and show no such line. When the size cannot be stored, nothing changes and no line shows: the window, the next press and the next launch all have the size from before.
- **B11** (A10, "stays exactly under its frame"). At 50 %, 80 %, 125 % and 200 %: the in-app browser's view covers its pane to the point, and a press lands on the page wherever the frame draws it and on the app everywhere else; an extension's popup opens under its icon; the bookmarks menu opens under its button; a comment's pin sits on the picked element; the traffic lights stand centred in the title bar and clear of its controls; a page at the Mobile size reads 375 wide (at 200 %, 375 or 376, and the chip says which), the chip's menu offers exactly the sizes that fit, and the chip says what the page reads. The same after the window is moved to a display of another scale; where M1's row j could not be run for want of a second display, that last sentence is not proven, and the tracker says so (M3).
- **B12** (root UC-14). After this build at 125 %, build F and build M on the same profile each show 100 %, keep `window.zoom` through their own write, and this build then shows 125 % again. The presenter's window, the repair window, a deck's export, a screenshot of an artifact and Mark up's still are the same at 150 % as at 100 %.
- **B13** (A13, A9), for this half's three rows. `src/shared/keymap/actions.test.ts` holds them to the wave's chords and lists them as landed; `src/main/menu.test.ts` finds the three zoom items in View outside any submenu; the sheet lists them under View. By hand, on the owner's machines: ⌘= and ⌘− work under the Korean input source (the child's probe 6).
- **B14** (UC-6, "Stored rebindings"). Settings › Keyboard lists the three rows with no control to change them, and `settings.json` holds none of their ids after any act.

## Constraints that bind every milestone

- **The build brief binds** (the wave's common brief for building a child): nothing is typechecked, linted, tested, built or started on the owner's MacBook (root UC-10); every check runs on the build VM in a checkout of the pushed head; the gate runs Node 22 where the VM runs a newer one; the known VM failures are read against the brief's list and never edited away.
- **Laws 1, 3 and 8 of the root**, and its contracts: UC-6 (a key is a row of `ACTIONS` and is written nowhere else), UC-8 (every edit in a file another child owns is the insertion Interfaces §H names, and nothing more), UC-11 (public repository: invented names, paths and text in every test, fixture, scene and probe page), UC-14 (the table above).
- **No stored rebinding of the three rows** while build F can be gone back to: no id is added to `BUILD_F_ACTION_IDS`.
- **Only this half's ids join `LANDED`**.
- **Tokens only** in renderer source; a ticket or item number is written in words there.
- **No wall time is asserted.** No test or scene of this landing holds an upper bound on a time. The harness's 15 s before a forced exit is a wait it makes, not a bound it asserts.
- **A test that asserts an absence** (no key, no change, no placement) over input it builds by hand carries its control in the same test: the same reader, given the form that should be found, finds it.
- **A cause read from code is measured before its fix is built.** M2 builds no placement before M1 has recorded it off by the factor, in the direction Interfaces §G gives, with the observation M1's table names for it. For the device size (placement 6) M1 records what the pin's code shows beside what the code predicts, and the formula of decision 35 is proven by M2's unit cases, not by M1.
- **A scene waits on main's acknowledgment** before it reads a native rectangle (decision 36), never on a number of frames.
- **Other packages read the app's source.** `apps/desk-web` reaches `src/shared/ipc/schema/layout.ts` through `schema.ts` (U6b-2's finding): M2 adds that package's typecheck, build and test project to its proof, and lists any other importer it finds by following imports until no new file appears.
- **Merge, never rebase or force-push.** Never push master.

## Plan of Work

Three milestones. M1 is a spike whose verdict gates M2. M1 stands on nothing of U6b-5a and is written to be built, reviewed and run by itself while that landing is built.

### M1 — Spike: what Chromium keeps of a window's zoom, and where the six placements land

**A prototyping milestone.** Its deliverable is `spikes/zoom-probe/FINDINGS.md`, with a results file per run; two additions to the in-app browser's e2e seam, which M2's scenes keep; and four probe scenes that record and assert nothing. **Its verdict gates M2.** Its diff is small enough for one reviewer on the medium rung, before its Mac run.

**The questions.** (1) Whether a zoom set on the app's page is kept by Chromium outside `window.zoom`, in each zoom mode, across an ordinary quit and a forced exit: this decides what build F and build M show after this build was zoomed (the cut's X3), and whether P7's design stands. (2) Whether an isolated zoom survives a reload, and how a factor is in force before the window is first shown. (3) Whether the presenter's and the repair window's pages take the window's zoom. (4) For each of the six placements, a number that shows it off by the factor today, in the direction Interfaces §G gives. (5) Whether any of it changes when the window moves to a display of another scale.

**What to build.**

*The seam's two additions* (`src/main/browser/`, U12's files, read only under the e2e switch, as the rest of the seam is):

- `__maws_browser.tab(id).placed`: the last rectangle `browser.view.place` handed main for that tab, as received, and how many it has processed; null before the first. Kept in `ViewManager`, read through `inspect.ts`.
- `__maws_browser.menu`'s record gains `at`: the point the last native menu was handed to its presenter with (`NativeMenuSeam` in `bookmarks/menu.ts`).

`e2e/support/browser-scene.ts` gains `placedOn(s, tabId, pane)`: it polls until `placed.rect` equals the pane's DOM rectangle as the window rounds it (`paneRect`). That is the acknowledgment of decision 36; every probe and every later scene that reads a view's bounds calls it first.

*The harness*, in the shape of `spikes/file-frame/`: `main.mjs` (an Electron main that opens a `file:` page sandboxed and context-isolated as `createWindow` makes a window, on a scratch `userData` given on the command line), `page/` (one page with text and one framed box; a second file), `run.mjs` (one launch per row, `RESULT {json}` lines gathered into `runs/<time>/results.json`; under Linux with no display it runs itself under `xvfb-run`, as `spikes/viewer-frame/run.mjs` does), `FINDINGS.md`. It runs on the repository's own Electron and has no dependency of its own, and it imports nothing from `src/`. "The stand-in" below is the same harness making no zoom call and setting no zoom mode, launched on the same `userData` and the same file URL: it is what a build that knows no zoom does. The harness is run on the build VM by the executor, and once on a Mac by the architect, since what a window paints first and what a second display does are the platform's.

| row | what is done | what is recorded | what it decides |
|---|---|---|---|
| a | default mode; `setZoomFactor(1.5)`; `app.quit()`; then the stand-in | the stand-in's `getZoomFactor()` after its page loaded; the zoom entries of the profile's `Preferences` file, by key | whether a default-mode zoom is kept, and under which key (the host, or the whole URL) |
| b | as a, ended by SIGKILL at once, and again 15 s after the zoom was set | the same, twice | whether a forced exit differs |
| c | the window made with `zoomMode: 'isolated'`; `setZoomFactor(1.5)`; `app.quit()`; the stand-in | the same | **P7:** whether an isolated zoom is kept anywhere |
| d | as c, ended by SIGKILL at once and 15 s later | the same, twice | **P7**, for a forced exit |
| e | isolated; 0.5 and 2; then `webContents.reload()`; then a load of the same file with another query | `getZoomFactor()` after each load | whether the factor is applied again after every load (`applyAfterLoad`) |
| f | three ways of having the factor in force before the window is shown, each at 0.5 and at 2, the window isolated: **f1** `webPreferences.zoomFactor` at creation and no call; **f2** a `setZoomFactor` call at the page's `dom-ready`; **f3** the window not shown at `ready-to-show`: the call made there, and the window shown at the page's next painted frame after it | for each: the factor at `dom-ready` and at the moment of showing; a capture of the window at that moment, and the height of the page's one line of text in it against the same capture at 1 | which way `openAt` is built: the first of f1, f2, f3 whose capture at showing is already at the factor. **None: stop** |
| g | three windows as a build opens them: the page; the same file with another query (the presenter's shape); another file (the repair page's shape). The first at 1.5, once in default mode, once isolated | the other two's factors | whether `present.ts` and `repair/index.ts` need a call that holds them at 1 |
| h | isolated at 0.5 and at 2, with a `WebContentsView` of another partition attached to the window (the in-app browser's shape), placed by decision 27's rule over the page's framed box | that view's own factor; its bounds against the box's DOM rectangle times the factor | the view's factor is expected 1 and anything else is a stop; the rule holds or decision 27 is wrong |
| i | the window made with `zoomMode: 'isolated'` | `typeof webContents.setZoomMode`; `getZoomMode()` | the call exists and the preference took; either failing is a stop |
| j | on a Mac with two displays of different scale only: row h's window at 1.25, moved to the other display and back | before, on the other display and after: the page's factor; its `devicePixelRatio`, which is expected to change with the display and is recorded, not judged; the view's bounds against the box times the factor, in points, at each scale | whether the app's factor changes across the move, and whether the view still stands on the box as drawn. With one display, or one scale: recorded as **not run** |

*The probe scenes*, run on a Mac by the architect, each skipped unless `MAWS_ZOOM_PROBE=1`, each at the factors 0.5, 0.8, 1.25 and 2 set through `app.evaluate` on the window's `webContents`, each ending in `record([...])` lines and never in an assertion. The pages they load are invented.

| scene | placement | what it waits on | what it records, and what "off" is |
|---|---|---|---|
| **"zoom probe: the view, the lights, the device box"** in `e2e/browser.spec.ts` | 1, the view | `placedOn`: main has the rectangle the pane now measures | the view's `bounds` beside the pane's rectangle and beside that rectangle times the factor. Off: the bounds equal the first and not the second |
| | the pointer | the same | the area, in window points, that belongs to the frame as drawn and not to the view, and the reverse (the two rectangles' differences): a press there goes to the wrong surface. Off: either is more than a point's rounding |
| | 5, the lights | nothing: both numbers are at rest | `getWindowButtonPosition()` beside the toolbar's height in points (its DOM height times the factor) and the 78 CSS pixels in points. Off: the lights' centre is not the toolbar's, or their span passes the clear width |
| | 6, the device box | `placedOn`, after Mobile is chosen | Five numbers, each beside what the pin's code predicts for it (the tab at its own 100 %, the room ample): the page element's width in CSS pixels (predicted 375); the frame's width as drawn, in points (375 times the factor); the view's width (375: `setBounds` takes the window's rectangle as sent); the page's own `innerWidth`, read in the tab (375); the chip's text (375). And which sizes the chip's menu offers, with the room set once just under and once just over 375 CSS pixels (predicted: Mobile is offered from 375 CSS pixels up at every factor, where a view of 375 points needs 375 divided by the factor). Off, as M1 can see it: the view is not the width of its frame, which is placement 1's fault showing here; and the menu's offer does not move with the factor. That the page reads 375 today is two faults cancelling, and M1 says so; it does not show that placement 6 is right |
| **"zoom probe: the popup and the menu"** in `e2e/browser-chrome.spec.ts` | 2, the popup | the seam's `popup()` answering | its `bounds` beside the icon's box and beside that box times the factor. Off: it stands by the first |
| | 3, the menus | the seam's menu record changing | `at` beside the button's corner and beside that corner times the factor, for the bookmarks menu and an extension's action menu. Off: `at` is the first |
| **"zoom probe: the pin"** in `e2e/browser-comment.spec.ts` | 4, the pin | the card for that pick being drawn | the card's box beside where the picked element is drawn (the view's bounds and the element's box in the tab, in points, divided by the factor). Off: the card stands at that point undivided |
| **"(zoom probe)"** in `e2e/cross-build.spec.ts`, beside "(export folder)", with its helpers (`withScratch`, `s.launch({}, peer.root)`, `s.quit`, `s.killApp`) | — | each launch's `s.ready(page)` | the peer's `getZoomFactor()`, read through `app.evaluate`, after this build's page was set to 1.5 in the mode rows c and d chose and once in the other mode, and the profile was left by an ordinary quit, and again by `s.killApp`. Run twice: `--peer-exact f1852de3a` and `--peer-exact 2c7044231` |

*A look*, by the architect, with the first probe run under `MAWS_ZOOM_PROBE_HOLD=1` and the window shown (`MAWS_E2E_QUIET=0`), which stops at each factor until it is resumed (`page.pause()`): where the traffic lights stand; whether the title bar still drags the window over its whole height; whether a terminal's text is sharp; a press at each corner of the browser's frame, on a page of numbered cells that shows which cell took it; and, where a second display of another scale is at hand, the window moved onto it.

**Promote or discard.** The harness and the findings stay under `spikes/zoom-probe/`; the two seam additions and `placedOn` stay; the probe scenes are replaced by M3's asserting scenes. The verdict, routed into Surprises & Discoveries:

- Rows c and d read 1 in the stand-in, and "(zoom probe)" reads 1 in both peers after both exits: P7 stands; M2 is built as written; nothing resets at quit.
- Row c or d, or the peers' read, shows a kept zoom under isolated mode: **stop.** The record goes to the architect with rows a and b beside it. The fallback this document names and does not build without a ruling: the page is set to 1 when its window closes (`leaveAtActualSize`), which leaves a forced exit as a residue the owner would have to accept.
- Row e: the factor is lost at a reload: `applyAfterLoad` is built; kept: it is left out.
- Row f: `openAt` is the first way that passes, on the Mac's run. None passes: **stop**; a window that is seen changing size at every launch is not built without a ruling.
- Row g: a window takes the zoom: its maker gains the one call; none does: nothing is edited there.
- Row h or i fails: stop.
- Row j: the app's factor changes across the move, or the view no longer stands on the box as drawn at the new scale: stop, with the numbers. A changed `devicePixelRatio` alone is what a display of another scale gives, and is no stop. Not run: said so in the findings; B11 names the gap, the tracker gains its row, and M2 may start (ruled, Decision Log 5).
- Placement 6: the five numbers and the menu's offer match what the pin's code predicts: M2 builds decision 35's formula with placement 1, and its unit cases are the formula's proof. A number that does not match its prediction: the reading of `viewport.ts`, `Pane.tsx` or `ViewManager.place` in this document is wrong; stop for that row and report.
- A placement the probe records as already under its frame, or off in the other direction: that row of Interfaces §G is wrong; stop for that row and report. A placement whose "off" the probe could not observe (the wait never came true): the probe is wrong; fix it before the verdict, not the design.
- The harness and the Mac scene disagree on a kept zoom: the Mac scene, which runs the real builds, is the one believed, and the difference is reported.

**What it does not touch.** Anything of the product but the two seam additions.

### M2 — Zoom

Starts on the architect's word after M1's verdict, on a head that holds U6b-5a and M1.

**What exists at its end.** B10 to B12 by their unit halves; the rows `zoom.in`, `zoom.out`, `zoom.reset`.

**What it touches.** `src/shared/keymap/actions.ts` and `actions.test.ts` (`LANDED`); `src/shared/ipc/schema/layout.ts` (the key, its schema, the command, the event), `src/shared/ipc/names/layout.ts`, `src/shared/ipc/routes.json`; `src/main/zoom.ts` (new), `src/main/layout/store.ts` (`MAIN_KEYS`, `publish`, the writer it is given), `src/main/app.ts`, `src/main/window.ts`; the six placements of Interfaces §G, in `src/main/browser/` (U12's), `src/main/window.ts`, `src/renderer/src/tools/browser/viewport.ts`, `chrome/ViewportChip.tsx` and `Pane.tsx` (U12's) and `src/renderer/src/app/Toolbar.tsx` (U7's); `src/renderer/src/stores/zoom.ts` (new), `App.tsx`; `src/main/menu.ts` (the comment); tests beside each, `shared/ipc/schema/layout.test.ts` ("accepts the key grammar and nothing else"), `main/layout/store.test.ts` ("main's own keys"), `main/browser/view.test.ts`, `main/menu.test.ts`, `settings-tab/keymap.test.ts`.

**Interfaces.** Exposes §G. Consumes `ZOOM_PRESETS`, `stepZoom` (`src/main/browser/navigation.ts`); `appWindows` (`src/main/windows.ts`); `toast` and the store's `dismiss` (`src/renderer/src/stores/notices.ts`, unedited); M1's seam and its verdict; from U6b-5a what "What this landing stands on" lists.

**Decisions.** 23 to 29 and 34 to 37; S3; P6, P7; card K3.

**What it does not touch.** The in-app browser's own zoom and its keys; `window.main` and `WindowStateSchema`; what `set` and `delete` of the layout store do for any other key; `src/main/presentations/` and `src/main/repair/` unless M1's row g says so; the layout's breakpoints and the window's minimum size; any zoom role of the menu (`menu-roles.test.ts` stands unedited); `app/shell-actions.ts`.

**What it proves.**
- `nextFactor`: each step up and down the presets between 0.5 and 2; held at the ends; `actual` is 1; `current` changes nothing.
- The key: published at a change, removed at 100 % (the control for "no key", in that test: the same read finds it at 125 %); absent and invalid both read 1, and an invalid value is not rewritten until a change; listed by `layout.list`, refused to the window by `layout.get` and `layout.set`.
- **A write that fails (finding 7), with the real `LayoutFileStore` on a scratch file and a writer the test gives it that throws once.** After Zoom In from 100 % fails: the command answered the error; `store.get('window.zoom')` is what it was; an unrelated key set afterwards writes a file that holds no changed zoom (the control, in that test: after a publish that succeeds the same read of the file finds the factor); a window made afterwards opens at the old factor; the next Zoom In steps from the old factor, to 110 % and not past it. The same from 125 %, where the old value is a stored one, and for Actual Size, where the failed act is a removal.
- S3's order: two commands are applied in order; nothing of steps 3 to 5 runs after a failed step 2.
- Each of the six placements, at 0.5, 0.8, 1.25 and 2, against a fake of the native call: the numbers handed over are the CSS numbers times the factor (or, for the pin, divided), edge by edge as decision 27 rounds them; at factor 1 every existing case of `view.test.ts` and of the popup's, the menu's and the pin's tests passes unedited.
- **The device size (finding 8), in `viewport.test.ts` and in the chip's and the pane's tests.** At a = 2 and a = 0.5, with z = 1 and z = 1.25: the element's size, what the page reads and whether the size fits, all from the one formula. The review's two cases: at a = 2 a room of 300 CSS pixels offers Mobile (it needs 188); at a = 0.5 a room of 500 does not (it needs 750). A size cut by its room: the element is the room and `reads` is the room times a ÷ z, rounded. 375 at a = 2 reads 376 and the chip says 376. A change of the factor redraws the chip and the pane without any other change (they read `useZoom`).
- A change of factor applies again every placement of that window, also where the window sent no new rectangle (held: the window is silent, main re-places).
- The window's handlers: `zoom.in` absent at 2, `zoom.out` at 0.5, `zoom.reset` at 1, each present elsewhere; the root's `--app-zoom` follows the event.
- **The line (card K3), in `stores/zoom.test.ts` against the real notices store.** After `layout.zoomChanged` with 1.25 the store holds one toast whose text is "Zoom 125 %", with no action, not dismissible, `durationMs` equal to `ZOOM_LINE_MS`; for 0.67 the text is "Zoom 67 %", for 1 "Zoom 100 %". A second event while the first line is held: the first is gone from the store and one line with the new size is there (the control for "gone", in that test: before the second event the same read finds the first). The factor read at the start (`current`) shows no line (the control, in that test: an event after it does). A command that answers an error shows none. With the toast host mounted and the suite's fake clock: the line's text is in the host's announcement for a screen reader; just under `ZOOM_LINE_MS` after it was drawn the store still holds it, and just over, it does not. That is an assertion of state at two points of a clock the test moves, not of a time measured.
- A second app window made while the factor is 1.25 opens at 1.25.

### M3 — The scenes, the cross-build row, the record, and the acceptance run

**What exists at its end.** Every scene of Interfaces §I written and typechecked; the coverage row and its scene; the record; the whole unit suite run once.

**What it touches.** The spec files of Interfaces §I and `e2e/support/browser-scene.ts`; `e2e/cross-build.spec.ts` (the P5 work's file: one scene, one row of the coverage comment, the probe scene removed); `docs/tech-debt-tracker.md`; this document.

**The record.** No ruling of the owner's is reversed. In the debt tracker: the row of 2026-10-24 ("Lens 7 remainders not built") loses zoom; the row of 2026-10-27 (a follower at a zoom other than 100 %) is closed or kept by what the `e2e:transcript` scene shows, with that scene named; one row is added for each item of "Left over", and one for row j when it was not run.

**"(zoom, both ways)"**, in `e2e/cross-build.spec.ts`, after "(export folder)" and with its helpers. This build sets 125 % through the menu's items, and `layout.json` holds `window.zoom` at 1.25; the peer is launched on the profile, opens a tab so that it writes its layout whole, and quits; the file still holds the key as written, and the peer's page read 1 (its `getZoomFactor()` through `app.evaluate`); this build again shows 1.25. It waits on `s.ready(page)` at each launch, on the stored key after the zoom (polled from the file), and on the peer's stored `main.tabs` naming the tab it opened. It skips only for a peer whose `LayoutKeySchema` names `window.zoom`, by a helper in the form of `namesExportFolder`. **It must pass, not skip, against four peers:** build F and build M (`--peer-exact f1852de3a`, `--peer-exact 2c7044231`, the runs of record), the master this landing merges into, and master at `b89d6d1d7`: none of the four names the key.

**What it proves.** Against the acceptance: B10 to B12 and B14 by the scenes of §I; B13's first half by the unit suites; B13's second half and the owner's look by hand.

## Concrete Steps

Working directory for every command: the worktree of `ux-wave/U6b-5b`. The VM sees only what is pushed. Below, `vmcheck` stands for the wave's build-VM helper as the build brief gives it, called for this branch (`vmcheck.sh ux-wave/U6b-5b --`); it prints `vmcheck: ux-wave/U6b-5b at <short sha>`, then the command's output, and exits with the command's status. Its first call for the branch installs dependencies: allow 20 minutes. Every command there runs under `timeout <seconds>`; where every part's result is wanted, the remote command starts with `set +e;`.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6b-5b

   A merge, never a rebase or a force-push. Before M2, also `git fetch origin ux-wave/U6b-5 && git merge origin/ux-wave/U6b-5`, when U6b-5a's branch is complete (the architect says when). After a merge that brought changes, run the previous milestone's proof again, and read "Statements to check again" against what arrived.

2. **M1, on the VM, and the first stop.**

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec vitest run src/main/browser'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck 'cd spikes/zoom-probe && timeout 900 node run.mjs'

   Expected: the seam's two additions typecheck and the browser's suites pass with no case edited; the probe scenes typecheck; one line per row a to i, each `RECORD` with its values (row j: `not run` on the VM); `runs/<time>/results.json` (`runs/` is ignored by git; the values are copied into `FINDINGS.md` with the commands that made them). Then **stop**: the controller gives the architect the findings and the names of the probe scenes. M2 waits for the architect's word.

3. **The tests before the modules** (M2). Commit the cases of "What it proves" with the new exports naming nothing; push; run them; the cases that assert the new behaviour fail and those that assert what stays pass. Then build.

4. **While building**, after each push:

       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck 'timeout 900 pnpm exec vitest run <the test files touched>'

5. **M2's proof** is the typecheck of both projects, eslint on its changed files, and

       vmcheck 'timeout 1800 pnpm exec vitest run src/main/zoom.test.ts src/main/layout src/main/browser src/main/menu.test.ts src/main/menu-roles.test.ts src/main/presentations src/shared/ipc src/shared/keymap src/renderer/src/stores src/renderer/src/app src/renderer/src/tools/browser src/renderer/src/settings-tab test/support/tokens-guard.test.ts'

   then the desk's web app as the static gate runs it (`pnpm --filter desk-web typecheck`, `pnpm --filter desk-web build`, `pnpm exec vitest run --project desk-web`). Expected: every file passes but those the build brief lists as failing or timing out on the VM.

   *The one snapshot.* With the command's name pushed, `vmcheck 'MAWS_ROUTES_WRITE=1 timeout 300 pnpm exec vitest run src/shared/ipc/routes.test.ts >/dev/null || true; git diff -- src/shared/ipc/routes.json; git checkout -q -- src/shared/ipc/routes.json' | sed 1d > "$TMPDIR/u6b5b-routes.patch"`, then `git apply` it in the worktree. Read the patch first: it holds the one name `layout.zoom` and nothing else. The wire's minor, its manifest and its fingerprint do not change; `vmcheck 'timeout 600 pnpm exec vitest run src/shared/ipc'` shows it.

6. **A scene is typechecked, not run** (M3): the third and fourth commands of step 2. This landing adds no spec file.

7. **The acceptance run** (M3's last step), on the pushed head, after a last merge of master:

       vmcheck 'timeout 2400 pnpm typecheck'
       vmcheck 'timeout 1800 pnpm lint'
       vmcheck 'timeout 3600 pnpm test'
       vmcheck 'timeout 600 pnpm exec vitest run src/shared/machine'

   Expected: each exits 0, apart from the files the build brief lists; vitest's summary names no other failed file. The whole unit suite runs this once, by M3's executor.

8. **Stop and hand back.** M3's executor writes into Progress what ran and what is left, pushes, and stops. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the branch review, the Mac runs and the pull request are the architect's.

## Interfaces and Dependencies

No library is added. Names and shapes below are what must exist at the end of the milestone that makes them; a private helper's name is the executor's.

### §A. The three rows (M2; `src/shared/keymap/actions.ts`)

```ts
// View: after 'artifact.moveToTab' and before 'comments.expand', in no submenu
'zoom.in':    { title: 'Zoom In',     chord: 'Cmd+=', sink: 'menu', menu: 'view', scope: 'app' },
'zoom.out':   { title: 'Zoom Out',    chord: 'Cmd+-', sink: 'menu', menu: 'view', scope: 'app' },
'zoom.reset': { title: 'Actual Size', chord: null,    sink: 'menu', menu: 'view', scope: 'app' },
```

The prefix `zoom` is new and so is a group of its own in the menu, with its separators (`group` in `src/main/menu.ts`). The rows do not stand beside `channel.open` (`channel/open-action.test.ts` pins its neighbours). They are rows, not menu roles: `MENU_ROLE_CHORDS` and `menu-roles.test.ts` stand. `LANDED` in `actions.test.ts` gains these three ids.

### §G. Zoom (M1 for the seam; M2 for the rest)

```ts
// src/shared/ipc/schema/layout.ts
export const WindowZoomSchema = z.strictObject({ version: z.literal(1), factor: z.number().min(0.5).max(2) });   // key `window.zoom`, main only, never crosses IPC
'layout.zoom': { input: z.strictObject({ to: z.enum(['in', 'out', 'actual', 'current']) }), output: z.strictObject({ factor: z.number() }), owner: 'main' }
'layout.zoomChanged': z.strictObject({ factor: z.number() })   // an event, to every app page

// src/main/layout/store.ts
interface LayoutStore {
  // Decision 34. The value (null: the key's removal) is in the map and in the file, or in neither: when the write throws,
  // the map holds for this key what it held before the call, and the error is thrown on.
  publish(key: LayoutKey, value: unknown | null): void;
}
// LayoutFileStore's constructor takes the file's writer as its second argument, by default today's (`atomicWriteFileSync`),
// so that a test gives the real store a writer that fails.

// src/main/zoom.ts (new; `nextFactor` and `readFactor` import no Electron)
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export function nextFactor(current: number, to: 'in' | 'out' | 'actual' | 'current'): number;   // stepZoom over ZOOM_PRESETS, held to the two bounds
export function readFactor(stored: unknown): number;                                            // 1 for an absent or invalid value
export function zoomOf(contents: WebContents): number;   // the factor of the app window that hosts these contents (its own page, or a view attached to it); 1 for any other. Read from the store each time

// src/renderer/src/stores/zoom.ts (new)
export const useZoom: UseBoundStore<StoreApi<{ factor: number }>>;
export function connectZoom(client?: MawsBridge): () => void;   // reads `layout.zoom { to: 'current' }`, follows the event, sets --app-zoom on the root, registers the three handlers by the factor, and shows decision 37's line for each event
export const ZOOM_LINE_MS = 1_500;                              // the line's time on screen (card K3)

// src/renderer/src/tools/browser/viewport.ts: decision 35; `app` is the app's factor
export function pageBox(viewport: BrowserViewport | null, zoom: number, room: Room, app: number): PageBox | null;
//   width = min(round(viewport.width * zoom / app), room.width); height likewise;
//   reads = { width: round(width * app / zoom), height: round(height * app / zoom) }
export function fits(viewport: BrowserViewport, zoom: number, room: Room, app: number): boolean;   // viewport.width * zoom / app <= room.width
```

`'window.zoom'` joins `LayoutKeySchema` and `MAIN_KEYS`. `pageBox`'s and `fits`'s callers pass `useZoom`'s factor and so are drawn again when it changes: `Pane.tsx` (the page's element) and `chrome/ViewportChip.tsx` (the label, from `reads`; the menu's choices, from `fits`).

How the factor comes to be in force, each a private function of `zoom.ts` whose form M1 decides: `openAt` (before a window being made is shown: M1's row f, the first of its three ways that passes), `applyAfterLoad` (after a load of the page: row e), and, only on a ruling after a failed row c or d, `leaveAtActualSize`.

The six placements. "Multiply" and "divide" are by `zoomOf` of the app page concerned; at factor 1 each is what it is today.

| # | what is placed | the narrowest place | today | under the factor | owner |
|---|---|---|---|---|---|
| 1 | the in-app browser's view | `ViewManager` in `src/main/browser/view.ts`: the placement keeps the CSS rectangle `browser.view.place` sent; `attach` and every later `setBounds` of it multiply, edge by edge (decision 27). A function of the manager applies every placement of one window again, called from S3 | `setBounds(rect)` as sent | multiply | U12 |
| 2 | an extension's popup | the head of `ExtensionPopups.open` in `src/main/browser/extensions/popup.ts`, where the anchor arrives; the kept anchor stays in CSS pixels and `preferred-size-changed` and S3 place from it | the anchor mixed with window points | multiply the anchor | U12 |
| 3 | the bookmarks menu, an extension's action menu, the puzzle's menu | where `NativeMenus` hands a menu to its presenter (`present` in `src/main/browser/bookmarks/menu.ts`), which all three reach: before the presenter, so that the e2e seam, which stands in for the native call, records the point handed over | `popup({ window, x, y })` as sent | multiply | U12 |
| 4 | the comment's pin | the call of `pickPosition` in `src/main/browser/comment/mode.ts`: its factor becomes the tab's over the app's | the tab's window points, drawn by the window as CSS pixels | divide | U12 |
| 5 | the traffic lights | `src/main/window.ts`: `setWindowButtonPosition({ x: 16, y: Math.round(22 * factor - 7) })` at a window's making and in S3; in `app/Toolbar.tsx` the 78 px kept clear becomes `calc(78px / var(--app-zoom, 1))` | `{ x: 16, y: 15 }` in a toolbar 44 CSS pixels high | the lights stay centred in the toolbar's height and clear of its controls | no child (`window.ts`); U7 (`Toolbar.tsx`) |
| 6 | the device-size box of the in-app browser | `pageBox` and `fits` in `src/renderer/src/tools/browser/viewport.ts`, and their two callers (decision 35) | the element, the label and the choices by the tab's zoom alone | divide by the app's factor in all three | U12 |

The e2e seam (M1): `__maws_browser.tab(id).placed` (`{ rect, count }`, the last rectangle main received for the tab and how many it has processed) and `at` on `__maws_browser.menu`'s record (the point the last menu was handed to its presenter with, in window points once placement 3 is built). `placedOn(s, tabId, pane)` in `e2e/support/browser-scene.ts` is decision 36's wait; `expectOnPane` takes the factor and calls it first.

### §H. Files other children own, or that no table names (root UC-8)

| file | owner | the insertion | named by |
|---|---|---|---|
| `src/main/browser/view.ts`, `extensions/popup.ts`, `bookmarks/menu.ts`, `comment/mode.ts` | U12 | placements 1 to 4 (§G) | the cut's X8 |
| `src/main/browser/view.ts`, `bookmarks/menu.ts`, `inspect.ts` | U12 | M1's two seam additions | finding 9, as ruled |
| `src/renderer/src/tools/browser/viewport.ts`, `chrome/ViewportChip.tsx`, `Pane.tsx`, their tests | U12 | placement 6: the two functions' fourth argument and the two callers that pass it | P6; finding 8, as ruled |
| `src/renderer/src/app/Toolbar.tsx` | U7 | one class: the lights' clearance (placement 5) | P6 |
| `src/main/layout/store.ts`, its test | no child | `MAIN_KEYS`; `publish`; the writer given to the constructor | P6; finding 7, as ruled |
| `src/main/window.ts`, `src/main/app.ts`, `src/shared/ipc/names/layout.ts`, `src/shared/ipc/routes.json`, `src/renderer/src/App.tsx` | no child | `zoomMode` and placement 5; the zoom's start and its command; one name; one name; one mount | P6, P7 |
| `src/shared/ipc/schema/layout.ts` | by key | the key `window.zoom`, its schema, one command, one event | the root's row ("a child adds a key of its own") |
| `e2e/cross-build.spec.ts` | the P5 work | one scene, one row of the coverage comment; M1's probe scene while it lasts | the root's row (each landing since U13a has added its own) |

Not edited: `src/main/presentations/`, `src/main/repair/` (unless M1's row g); the transcript's scroll code (U3's; only if the `e2e:transcript` scene fails, and then on a ruling); `app/shell-actions.ts`; `PaneRectSchema` and the command `browser.view.place` (decision 35).

### §I. The scenes (M3), by group, each with what it waits on

No spec file is added. Every scene reads a state it polls for; a scene that reads a native rectangle calls `placedOn` first (decision 36).

| group, file | the scene | what it waits on |
|---|---|---|
| `e2e:layout`, `e2e/ux2-shell.spec.ts` | new step in the menus' scene: View holds Zoom In, Zoom Out and Actual Size outside any submenu; Actual Size disabled at 100 %, Zoom In at 200 %, Zoom Out at 50 %; after a click the line "Zoom 110 %" is drawn, and after the next it is "Zoom 125 %" alone; the sheet lists the three under View (B10, B13) | the window's zoom store reading the factor after each click; the line's text being drawn, and the earlier line being gone (polled; no time is asserted); the menu items' `enabled` read from the application menu (polled) |
| `e2e:browser`, `e2e/browser.spec.ts` | new, "zoom: the page stays under its frame at 50 %, 80 %, 125 % and 200 %" (B11; the child's probe 2): the view against its pane, the two rectangles' differences no more than a point, with a menu open over it; the lights' position against the toolbar; at the Mobile size what the page reads, what the chip says and what its menu offers; Mark up's still of the pane at 150 % covering what it covers at 100 % | the zoom store reading the factor; then the zoom's line being gone, since a toast over the pane puts the page's still in the view's place while it shows; then `placedOn`; then the view's bounds equal to the pane's rectangle times the factor (polled) |
| `e2e:browser-chrome`, `e2e/browser-chrome.spec.ts` | new: a popup under its icon and the bookmarks menu's point under its button, at 50 % and 125 % | the seam's `popup()`; the menu record's `at` |
| `e2e:browser-comment`, `e2e/browser-comment.spec.ts` | new: the pin on the picked element at 50 %, 80 % and 125 % | the card for that pick being drawn |
| `e2e:terminal`, `e2e/terminal.spec.ts` | new, "zoom: the grid refits and a selection is under the pointer at 125 %" (the child's probe 3) | the pty's reported size after the zoom; the selection's text |
| `e2e:presentations`, `e2e/presentations-present.spec.ts`, `presentations-export.spec.ts`; `e2e:render-host`, `e2e/render-host.spec.ts` | new: the presenter's window at 100 % while the app is at 150 %; an export made at 150 % equal to one made at 100 %; an artifact's capture the same size at both (the child's probe 5; B12). `e2e:render-host` is a group the cut did not list | the presenter's `getZoomFactor()`; the two exports' page sizes; the two captures' sizes |
| `e2e:transcript`, `e2e/transcript.spec.ts` | new: at 110 % and 80 % a streaming transcript keeps following while a key is pressed in a side surface (the child's probe 4). A group the cut did not list | the follower at the end after each appended row |
| `e2e:settings`, `e2e/settings.spec.ts` | new step: Settings › Keyboard lists the three rows with no control (B14) | the rows |
| `e2e:cross-build`, `e2e/cross-build.spec.ts` | "(zoom, both ways)" (M3; B10's relaunch, B12) | as M3 says |

That the size is in force when the window is first shown (B10) is M1's row f on a Mac and the owner's look; no scene can see a first paint.

### §J. What a later landing may rely on, by name

- **`zoomOf`** (`src/main/zoom.ts`), **`useZoom`** and the root's **`--app-zoom`** (`stores/zoom.ts`): the factor, for any code that hands a CSS rectangle to a native call or sizes something in window points. A landing that adds such a crossing multiplies or divides by it and adds its row to the table of §G.
- **`LayoutStore.publish`**: a key written with its map, or not at all.
- **`placedOn`**, **`tab(id).placed`**, the menu record's **`at`**: the acknowledgment of a placement, for any scene of the in-app browser.
- **`layout.zoom`**, **`layout.zoomChanged`**; the key **`window.zoom`**.

## The card for the owner

Answered (2026-11-17; Decision Log 6). It is kept as it was put, with the question as the owner read it, the answer in the owner's words, and the places it is built. K1, K2 and K4 are U6b-5a's.

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
| A. 50 % to 200 %, nothing on screen (the first default) | View ▸ Actual Size is enabled away from 100 %, and that is the only sign | Nothing new on screen. After two presses you cannot read which size you are at |
| **B. The same range, and a line for a second and a half** (recommended; chosen; built) | "Zoom 125 %" in the app's own line, no button, also said to a screen reader | You see the step you landed on. One short line per press |
| C. Claude Desktop's line with its Reset button | as B, with a button that returns to 100 % | One more control, for an act the View menu already has |

A second choice, on any of the three: hold the top at 150 % instead of 200 %. At 200 % a window under 1,400 points wide draws the side surface over the chat; at 150 % that starts under 1,050.

Recommended: B, with 200 % kept. The one place for the range: `ZOOM_MIN` and `ZOOM_MAX` in `src/main/zoom.ts`; for the line: `connectZoom` in `stores/zoom.ts`.

**Answered, 2026-11-17.** The question as put: "MAWS gets ⌘= / ⌘− / ⌘0 to zoom the whole window (landing U6b-5b), in the in-app browser's steps: 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200 %. The layout reads width after zoom: a 1,440-point-wide window has 960 at 150 % and 720 at 200 %, and under 700 the side surface (terminal, files) is drawn over the chat; at 200 % that happens for any window under 1,400 points wide (at 150 %, under 1,050). Which range, and what shows the size?" The owner's answer: "Up to 200 %, a brief line (Recommended)". This is option B with 200 % kept. It was not the default the earlier revisions built: decision 37 is the line, at `connectZoom`, and the range is unchanged.

One thing in the question as put is not what is built, and is no part of the answer: it names ⌘0 among the keys. ⌘0 is the Overview, and Actual Size has no chord (the child's file, l7-shell-08; UC-6's table).

## Proof that an executor does not run

Each is a step with what it needs, handed to the architect.

| # | what | when | what it needs | what comes back, and the one place it changes |
|---|---|---|---|---|
| 1 | **M1's review** | after M1 is pushed | One reviewer on the medium rung, over M1's commits on `ux-wave/U6b-5b`: the seam's two additions, the harness, the probe scenes | A verdict, before the Mac run |
| 2 | **M1's harness on a Mac** | with 3 | A Mac; `node run.mjs` in `spikes/zoom-probe/`; for row j, a second display of another scale if one is at hand (with one, the row is recorded as not run and holds nothing) | Rows a to j as the platform gives them: row f decides `openAt`; row j, run or said not to be |
| 3 | **M1's probe scenes on real builds** | after 1 | A Mac under the load rule. `MAWS_ZOOM_PROBE=1` with the cross-build group and `--peer-exact f1852de3a`, then `--peer-exact 2c7044231`, for "(zoom probe)"; the three placement probes alone in their groups (`e2e:browser`, `e2e:browser-chrome`, `e2e:browser-comment`) | The recorded lines: the peer's factor after an ordinary quit and after a forced exit, in each mode (`zoomMode` in `createWindow`; P7); for each of the six placements its observation at four factors (that row of Interfaces §G) |
| 4 | **M1's look** | with 3 | The first probe with `MAWS_ZOOM_PROBE_HOLD=1` and `MAWS_E2E_QUIET=0`, which stops with the window shown at each factor | Where the lights stand and whether the title bar drags over its whole height (placement 5; a band that does not follow is reported, not fixed here); whether a terminal's text is sharp (the child's probe 3: if not, the terminal is told the factor, which is a ruling); which cell takes a press at each corner of the frame; the window on a second display |
| 5 | **The word to start M2** | after 2 to 4 | The findings read against "Promote or discard" | M2 starts, or one of its stops is ruled |
| 6 | **The scenes of Interfaces §I** | after M3 | A Mac. The new scenes alone first, then each group whole: `e2e:layout`, `e2e:browser`, `e2e:browser-chrome`, `e2e:browser-comment`, `e2e:terminal`, `e2e:presentations`, `e2e:render-host`, `e2e:transcript`, `e2e:settings` | Each group's result. `e2e:transcript`'s zoom scene failing is the tracker's row of 2026-10-27 made reachable: its fix is one comparison in U3's scroll code, on a ruling |
| 7 | **The cross-build run of record** | on the final head | `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`; and the group as the gate crosses it, against the master this landing merges into and against master at `b89d6d1d7` | "(zoom, both ways)" passed, not skipped, in all four. A skip is not evidence |
| 8 | **The owner's hands and look** (the child's probe 6) | on the wave's build, on the owner's machines | About ten minutes: a page open in the in-app browser, a terminal, a transcript | ⌘= and ⌘− under the Korean input source; at 80 %, 125 % and 200 %: the page under its frame, text sharp, nothing cut; the line with the size after each press, heard with VoiceOver on, and what a page of the in-app browser looks like under it for that second and a half; after a relaunch the window is at its size from the first moment it is seen |
| 9 | **The branch review** | after M3 | `doperpowers:review-code`, the xhigh panel | A verdict and findings |
| 10 | **Class 1a** | once, on the head the pull request will carry | `scripts/ci-gate.sh` with the static, unit and probe gates | The run's id |

No unit case of this landing is guarded to macOS. No paid live group is touched.

## Size and review

Counted from the code at the pin, tests and scenes included, after the review's additions. The first writing gave this half about 1,500 lines over 38 files; the seam and the wider matrix add to M1, and the store's `publish`, the device size's three computations and their callers add to M2.

| milestone | changed lines, about | files, about |
|---|---|---|
| M1 the spike | 650 | 16 |
| M2 zoom | 1,200 | 34 |
| M3 scenes, the cross-build row, the record | 350 | 11 |
| **U6b-5b** | **2,200** | **48** (some files are counted in two milestones) |

These are estimates from reading, not a diff. M2's count moves with M1's verdict: a `leaveAtActualSize`, or a call in the presenter's and the repair window's makers, each adds a file or two.

**Review.** M1 alone, on its commits: one reviewer, medium rung (a harness, two seam fields read only under the e2e switch, probes that assert nothing). The landing: the xhigh panel, by its file count (well past twenty), and because it edits the placement code every scene of the in-app browser rests on and adds an act to the layout store.

**The other half.** U6b-5a is about 4,050 lines over 58 files, with the panel as well. The two are sequential ("The landing's edge").

## Statements to check again on the head this landing is built on

This document was written against the pin. M1 is built on the chain's head; M2 and M3 on a head that holds U6b-5a. Before each, and after any merge that brings a change to one of these places, each statement is read again; one that no longer holds is a stop for the controller.

| # | the statement | where it was read | what would move it |
|---|---|---|---|
| 1 | The action table, `LANDED`, `menu.test.ts` and `keymap.test.ts` are as U6b-5a leaves them, and `listable` draws a row while it has a handler | U6b-5a's document, Interfaces §A and §E | U6b-5a as built: read its Outcomes |
| 2 | The six placements, their files and their directions | Interfaces §G; M1's findings | any landing of U12 |
| 3 | `Placement.measure` sends only a changed rectangle; the reports come from the page's own measuring | `tools/browser/placement.ts`, `Pane.tsx` | any landing of U12 |
| 4 | `pageBox` and `fits` are the only computations of a device size, and `Pane.tsx` and `ViewportChip.tsx` their only callers | `tools/browser/viewport.ts` | U12 |
| 5 | `ZOOM_PRESETS` and `stepZoom` are exported | `src/main/browser/navigation.ts` | U12 |
| 6 | `LayoutFileStore.set` and `delete` change the map before they write; `MAIN_KEYS` holds two keys | `src/main/layout/store.ts` | a landing that adds a key or changes the store |
| 7 | Two scenes pin the exact list of stored keys, which this landing does not lengthen at 100 % | `e2e/shell.spec.ts` | a landing that adds a key |
| 8 | The window is shown at `ready-to-show`; the three pages are three `file:` URLs in the default session | `src/main/window.ts`, `present.ts`, `repair/index.ts` | a change to how windows are made |
| 9 | The count of spec files the gate pins, and that this landing adds none | `.github/scripts/e2e-default-specs.test.mjs` | a landing before this that adds a spec |
| 10 | Build M is `2c7044231`, build F is `f1852de3a`, and neither names `window.zoom`; all three builds run Electron 44.4.5 | `git show` at each; `package.json` | a new build in use; an Electron bump, which sends M1's harness to be run again and its verdict to be read again |

## The pull request

The body is the short form the owner chose on 2026-11-17: the proof, what differs from the plan, what is left over.

## Surprises & Discoveries

Found while this document was written and reviewed; each changed a decision above.

- Observation: six placements assume a CSS pixel is a window point, and the browser's view is not sent again when its CSS rectangle is unchanged.
  Evidence: `TRAFFIC_LIGHTS = { x: 16, y: 15 }` with `pl-[78px]` in `Toolbar.tsx`; `pageBox` in `tools/browser/viewport.ts`; `if (same(rect, this.sent)) return;` in `tools/browser/placement.ts`.
- Observation: Electron 44.4.5 declares a zoom mode that is not shared by origin.
  Evidence: `setZoomMode(mode: 'default' | 'isolated' | 'manual' | 'disabled')` and the `zoomMode` web preference in the installed package's declarations (checked by the architect on the build VM); in no tracked file.
- Observation (the adversarial review, finding 7): the layout store is not all-or-nothing for a key.
  Evidence: `set` runs `this.values.set(key, value)` and then `this.write()`.
- Observation (finding 8): a device size is three computations with three callers.
  Evidence: `pageBox`, its `reads`, and `fits` in `viewport.ts`; `ViewportChip.tsx` and `Pane.tsx`.
- Observation (finding 9): a scene cannot count frames to know main has placed a view.
  Evidence: `Placement.measure` reports from the page's own measuring and skips an unchanged rectangle.
- Observation: Claude Desktop `app-5.1231.2`, read for zoom. It zooms by level in half steps between 25 % and 500 %, stores no zoom of its own, disables Actual Size at 100 % and the two others at their limits, moves its window controls with the factor, and shows a line with the percentage and a Reset button for a second and a half (`main-process/index.chunk-BV3uOqbK.js:327946-327999`, `:328474-328478`, `:197293-197308`; `web/app/v1/ccce0aa9f-CEzQPX52.js:281-411`).
  Evidence: the lines cited, read in the build's readable tree.

- Observation (M1, 2026-11-17): the harness runs on the build VM only with Chromium's setuid sandbox helper set. The architect ruled `--setuid-sandbox` for that VM's checkout, and the run of record is at `d78e60abf`.
  Evidence: `spikes/zoom-probe/FINDINGS.md`, "Build VM".
- Observation (M1, the VM run; the Mac decides): an isolated zoom is kept nowhere after a quit or a forced exit (rows c and d PASS), so P7 stands on Linux. A default-mode zoom is kept under `partition.per_host_zoom_levels`, keyed by the page's whole `file:` URL, and written on a quit or within 15 s. `webPreferences.zoomFactor` (f1) has the factor in force at the first show. A call at `ready-to-show` (f3) failed at 2 in two of three runs, with a frame painted before the show. Row g's propagation control was established in both modes, and no other window took the zoom.
  Evidence: `spikes/zoom-probe/FINDINGS.md`, "Build VM", the RECORD lines.

## Decision Log

1. **2026-11-17 (UTC) · The verification call.** The first writing got an adversarial review (revision 2 got a delta review, Decision Log 5; there is no second adversarial read). M1's commits get one reviewer on the medium rung before its Mac run; the landing's branch gets `doperpowers:review-code` at the xhigh panel ("Size and review"). Class 1a on GitHub Actions is the gate of record. The cross-build runs of record are `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`.
2. **2026-11-17 (UTC) · Ruled on the adversarial review.** Nine findings on the first writing (`8d1235ea6`), each read by the architect at the cited place: all accepted. Findings 7 to 9 bind this document: the zoom key is published atomically and proven on the real store (7); one formula with the app's factor for the page's box, the fit test and the label, with their callers (8); M1 measures each of the six placements before its fix, waits on main's acknowledgment, verifies a first-paint way or stops, and covers factor 0.5, the pointer and a move between displays (9). The architect checked on the build VM that the installed Electron 44.4.5 declares `setZoomMode` and `zoomMode`; their behaviour is M1's to measure. Findings 1 to 6 bind U6b-5a.
3. **2026-11-17 (UTC) · Ruled on the points.** P6 accepted as findings 8 and 9 correct it. P7 accepted; M1's rows decide. (P1 to P5, P8 and P9 are in U6b-5a's document.) The card K3 stays the owner's with its built default.
4. **2026-11-17 (UTC) · Ruled: two landings (P10).** U6b-5b, zoom: this document; a branch cut from U6b-5a's head, with M1 as a spike that may run and be reviewed while U6b-5a is built. The halves are sequential; each adds only its own ids to `LANDED`, has its own acceptance, proof, scene groups and tracker rows; neither takes a wire minor. Order in the chain: U6b-3b, then U6b-5a, then U6b-5b.
5. **2026-11-17 (UTC) · Ruled on the delta review of revision 2.** One reviewer on the medium rung read `ee20c0074`; the session that keeps master had ruled a delta review, and there is no second adversarial read. For this document it closed findings 7 and 8 and left 9 partly closed. Its two findings here, each read by the architect at the cited place, both accepted. (i) Placement 6 at M1: as the pin's code runs, the page is not "375 times the factor"; M1 records the element's size, the frame's size, the view's, the page's `innerWidth`, the chip's text and the menu's fit choices at each factor, each beside the value the code predicts; the formula's verdict is M2's unit proof. No separate diagnostic configuration is built for it: the choice was the author's to make, and a build made only to show one placement fixed alone would be product code written for a probe. (ii) Row j: a changed `devicePixelRatio` is expected between displays of different scale and is recorded; the row is a stop only when the app's factor changes across the move or the view no longer stands on the frame as drawn. Also ruled: M1 is built on `ux-wave/U6b-5b`, cut from the head that carries this revision, and U6b-5a's head is merged into it before M2; with one display row j is recorded as not run, B11 names the gap, and M2 may start; the pointer's row stands as arithmetic with the press by hand in the look; `publish` for the zoom key only and a 375 size that reads 376 at 200 % are accepted, the reviewer having found each sound. The reviewer also confirmed that `window.zoom` is a new stored key that both older builds keep.
6. **2026-11-17 (UTC) · The owner's answer to K3** (recorded verbatim on board ticket 674, with the question as put; quoted under the card). "Up to 200 %, a brief line (Recommended)", which was not the built default: the range stays 50 % to 200 %, and after each zoom act a line "Zoom 125 %" (the step reached) shows for a second and a half in the app's own line, with no button, also said to a screen reader, at `connectZoom` in `stores/zoom.ts` (decision 37). M2 gains the line and its unit cases, the time held by state on a fake clock; the menus' scene draws it, and the browser's scene waits for it to be gone before it reads a view. It edits no file another landing owns: the notices' store and the toast host are called and drawn as they are.

7. **2026-11-17 (UTC) · M1: the menu seam's `at` is a method beside `last()`** (ruled by the architect on the executor's report). The document says the menu's "record gains `at`". There is no record object: `NativeMenuSeam.last()` answers a bare array, which every scene compares whole. So the seam gains `at(): { x, y } | null`, the point the last menu was handed to its presenter with. A pick does not clear it, and it is recorded on the e2e path only. Interfaces §G's "`at` on `__maws_browser.menu`'s record" is this method.
8. **2026-11-17 (UTC) · M1: `tab(id).placed` counts only the reports `place` acts on** (ruled by the architect on the executor's report). These are the owner's report, a claim, and the owner's release (`rect: null`). Each rect is kept as received. A report that `place` ignores, from another pane or an unknown window, is neither kept nor counted, since the acknowledgment must mean that the view took the rect. The record is a `WeakMap` in `ViewManager` (`placedOf`), which the e2e inspector reads through an optional dependency. In the product the map is written and nothing reads it: it is inert. Step 2 of Concrete Steps says the browser's suites pass "with no case edited". That holds for every case but one: the case in `index.test.ts` that pins the seam's whole shape (`toEqual` on `tab()`) now reads `placed: null`, because the seam's shape is the thing M1 changes.
9. **2026-11-17 (UTC) · M1: how the probes measure.** (i) The app window's zoom is set in main on the visible window (`setZoomFactor`), the window the scenes' other helpers use. A probe waits until the page's `devicePixelRatio` equals the display's scale times the factor, which is a state of the page, not a number of frames. (ii) Electron reports only the position of the traffic lights. Their size is taken as macOS's standard (three 14-point buttons, a 54-point span) and named as assumed in every line, and the look confirms it. (iii) For the device box, the room is dragged by the panel's separator towards 440, 370 and 380 CSS pixels. Every line records the room's actual width, since the panel's bounds can stop a drag short. (iv) The look's page of numbered cells is `/cells.html` on the scenes' test server. (v) The cross-build probe uses a fresh profile for each mode and each way of exiting. This build's window has no zoom mode, so the isolated mode is set at run time with `setZoomMode('isolated')`. (vi) In the harness, row f's capture is judged by the vertical extent of a red line of text against the control at factor 1, within 10 %. The `Preferences` file is read by every key whose name holds "zoom".

10. **2026-11-17 (UTC) · M1: the independent review's nine findings, as the architect ruled them.**
    - The cross-build probe:
      - It names each build's page URL and whether they match. A peer on another URL is not P7 evidence.
      - This build relaunched is the same-URL reading: the control in default mode, P7's observation in isolated mode.
      - The forced exit is taken after a default-mode write control's key reaches `Preferences`, bounded, and is "not established" otherwise. The kill at once stays as a labelled extra.
    - The harness:
      - Row h needs the page laid out at the factor, and f3 needs a painted frame before the show. Either failing is an experiment that did not stand.
      - Row g's 500 ms is replaced by a propagation control.
      - Windows show inactive unless `--look`.
    - The popup's predictions go through `popupBounds`' clamp. It is mirrored in the e2e, which loads no main code; that mirror is what we used, not an unclamped anchor.
    - The device box takes its ample room by Expand surface where the separator or the sheet cannot give it.
    - Paths: every printed record replaces the builds' roots, the scratch and the home folder by placeholders, and is refused if a path of the machine is left. `scrub.test.mjs` holds the harness's scrub to that, and `record` checks each probe line.
    - The placement map's running outside the e2e stands as accepted and is stated plainly. Decision Log 8's "inert" means only that nothing reads it.

11. **2026-11-17 (UTC) · M1: the same-URL test compares Chromium's zoom key, which keeps the query.** For a hostless (`file:`) page in the default mode, Chromium keys the zoom by the whole spec less the fragment (Electron 44.4.5's zoom controller; `HostZoomMap`'s host-or-spec helper). The cross-build probe therefore compares the URLs with the query kept. On another key, the relaunch is labelled neither the control nor P7 evidence. This is the task review's finding on the second fix wave. Its other finding there, that `popupPlace` in the e2e duplicates `popupBounds`, is left as Decision Log 10 rules: extracting the pure clamp into a module both can load would edit U12's `popup.ts`, which M1 must not touch (it changes nothing of the product but the two seam additions). The architect decides whether M2 or M3 extracts it.

12. **2026-11-17 (UTC) · Ruled by the architect: M2 extracts `popupBounds`' clamp** into one module that main and the e2e both load, and the e2e mirror `popupPlace` (`e2e/support/zoom-probe.ts`) is removed then. M2 already changes popup placement (placement 2), so the extraction belongs there. This closes the finding Decision Log 11 deferred. M1's review loop stops at `76d0bbc9d`: a later find goes to the tracker unless it makes a measurement invalid. M2 starts on the architect's word, once M1's Mac rows are in and U6b-5a's head is merged.

13. **2026-11-19 (UTC) · M1: the Mac run's two reds are probe faults, and the write control's "not established" is the control working.**
    - **The pin at 200 %:** the hover outline never showed. Today's view does not grow with the factor, so the tab's page is too short for its target at 200 %, and the hover landed outside the page's viewport. The probe now gives the window its display's work area and scrolls the target into the page's viewport. A target that still does not fit is recorded as not established.
    - **The popup and the menu:** the main tab's chrome folded its actions into the puzzle, because the panel's Browser stood beside it. The probe now hides that surface and gives the window its work area. At any factor where the actions are still folded, or the folder chip sits in », the probe records that and does not assert it.
    - **The cross-build write control:** nothing reached Preferences within 60 s, the app's own default-mode key included, so the control was right to refuse. The likely cause is App Nap's throttling of a quiet e2e window. The probe now holds the app out of App Nap (`powerSaveBlocker`'s prevent-app-suspension) for up to 120 s and records that it did. The cause is not verified.
    - None of this changes a verdict. P7's evidence on the Mac is the harness's rows c and d and this build's same-URL relaunch.
    - The view, the lights and the device box were measured and are recorded in FINDINGS.md.

14. **2026-11-19 (UTC) · M1: the chrome probe's premise names one element.** The rerun at `ef018d192` (manual gate `ef018d1921f2-20261119T210723Z`) stopped at the premise "the bookmarks bar is drawn" before any line was recorded. `folder.or(moreIn(main))` matched the chip F and » together, which is a strict-mode violation. The premise is now the bar itself (`[data-bookmarks-bar]`). The actions' premise takes `.first()`, because an inline action and the puzzle can also be drawn together. The extension's id still comes from the fixture (`chrome.extensions.probe.id`), which differs with each unpacked path.

15. **2026-11-19 (UTC) · M1: the reruns at `ef018d192`.**
    - The pin probe measured placement 4 off at all four factors. Its button sits 34.5 px higher at 200 % because of the tab page's own scroll, not a placement.
    - Against build F, the default-mode write control was established once the app was held out of App Nap, and a kill after the write kept the default-mode zoom.
    - In isolated mode the control was still not established: nothing reached `Preferences` in 120 s, the control's default-mode key included. That cycle therefore does not answer "kill after a write" for isolated mode. P7 rests on the harness's rows c and d and on this build's same-key relaunches.
    - The isolated-cycle write is left as an open observation in FINDINGS.md, with the harness row that would settle it.

16. **2026-11-19 (UTC) · M1: the popup and the menus measured, and the architect's rulings on what stays open.**
    - The rerun at `e458d10c1` measured placements 2 and 3 off at every factor: main took the CSS anchor and the CSS point as window points. At 0.5 and 0.8 the popup's x is held by the clamp at the content's edge, so there the reading rests on its y.
    - Every placement of Interfaces §G now has its Mac observation, in the direction §G gives (FINDINGS.md).
    - Ruled: no harness row for the isolated "kill after a write" cycle, since it does not bear on P7.
    - Ruled: the peers' probe against `2c7044231` is dropped.
    - Ruled: rows 4 (the look) and j (a second display) are owed to the owner.
    - M2 waits for U6b-5a's merged head.

## Outcomes & Retrospective

Pending — written at finish.
