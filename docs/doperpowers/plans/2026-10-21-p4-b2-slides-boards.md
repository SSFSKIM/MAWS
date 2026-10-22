# P4-B2 — Slides and design boards (2026-10-21)

> **Parent:** `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` (the P4 composite spec), child **P4-B2** (§5 "P4-B2 — Slides and design boards — spike (S-IME), then plan"; §2 items 2, 3 and 4; §4.4, binding on the state machine's states and on the armed editor as the IME arrangement, advisory on thresholds and selection details; §4.3's canvas half; §4.10's S-IME and R-8; Decision Logs 4, 6, 15, 16, 17, 20, 24, 25, 39 and 40). **Parent pin:** blob `e8dcab899cfb0c7d0db61e41644d4e2014b71a01` at master `a98e0a75e`. **Consumes:** the spike's findings (`spikes/p4-click-model/findings.txt`, closed 2026-10-21), the P4 interface ledger (`docs/doperpowers/plans/2026-10-19-p4-interface-ledger.md`: X36's `ThreadCard` and draft rule as built at P4-B1's landing, `placeCard` and `pinOf` in `src/artifacts/comments/placement.ts`, X27's and X23's proposed rows, the shared-files rule that adds `src/main/menu.ts`), the prior art (`research/p4-ux-prior-art.md` §1.4 V1 to V15, §2.3 T1 to T22, §2.4 P1 to P12, K1 to K6, I1 to I5, A1 to A5), P3's Decision Log 108 (the 24 ms drag acceptance), and the tracker rows 293, 280, 253, 256, 231, 212, 182 and 176 (line numbers of the tracker at c395ff0d9). **Status:** the plan, written before implementation; implementation starts from master after the P4 integration (W2-B/C/D/L, W3-A, A2's launch profile, R9) lands, with the spike's branch merged into that base. **2026-10-22:** M0 to M8 done. The head at 4974ab394 is green in class 1a and on the Mac (Outcomes below), and the L1 to L7 slot is the one item left before landing.

## Purpose

Text on a slide or a design board is edited on the first gesture, as in Canva (the owner's select-first choice, Decision Log 6) and faster than Canva where the owner asked for it. A first click selects a text element and its editor is already focused underneath with the caret hidden (ARMED), so a printable key replaces the text and a Korean composition starts in place with its first syllable intact. A second click places the caret, a 3 px drag moves, and a double-click reaches the deepest text under the pointer in one gesture, grouped headings and table cells included. Comments on a slide or a board become a pin and a popover drawing the document's card (X36). A named Google Fonts face is fetched once into the deck and then renders offline everywhere. The drag stays inside its bound while an agent republishes. This plan covers §2 items 2, 3 and 4 and the tracker rows above, and it closes the IME spike's open questions as far as they can be closed without the owner's hands.

## Progress

- 2026-10-22 (M8's gates, on 4974ab394: 1589c3379 with origin/master bb5550529 merged in, a clean merge whose one shared file, `src/engine-host/documents/service.ts`, the two sides touch in different hunks). Class 1a green on the pool (run 39694322144). On the mini, each green:
  - run 39694759772: `e2e:presentations` 31 passed and 10 skipped (the nine live IME cases, and the history spec's heavy-preview bound), `e2e:design` 17 passed;
  - run 39694921482: `e2e:settings` and `e2e:default` (`--default-beside` the rest of the class-1 set, so default ran its own specs), the groups that read the Edit menu M2 changed;
  - run 39697010247: `e2e:presentations-drag`, measured and alone (settled in 31 s, admitted quiet at loads 4.09 and 4.31). Move to frame p95 in ms: the controls 19.1, 18.8, 18.9 and 19.2; the agent trials 19.4, 18.7, 18.8 and 19.1. The bound is met (the agent trials' best 18.7 against 24 at load 4.19); the 16 ms target is not (the control's best 18.8). Queue p95 is 15.4 to 16.6 in both kinds, handler 1.9 to 2.4 and paint 1.6 to 2.1.
  - The hold's assertion now proves the buffering. Every agent trial released 6 buffered frames, all at its 5 s cap (at 5052.3, 5060.6, 5063.8 and 5056.5 ms), with none held at the drop. Every control released none (the cap fired over its empty buffer at 5050.6 to 5066.2 ms). In the agent trials, 2 or 3 remote applies (the cap's merged flush and the live publishes after it) touched 1 to 3 moves.
  - The record is `docs/doperpowers/evidence/p4-b2/presentations-drag-39697010247.json`. The class-1 drag case in run 39694759772 read 20.1 ms at load 4.69 (logged, not asserted, Decision Log 15), its one agent trial releasing 6 frames.
- 2026-10-22 (M8's reviews). Round 1, three reviewer-highs over the branch from master's merge base adfe1f1ce, each with its own lens:
  - The whole branch: no findings.
  - The click state machine, composition, the gesture hold and the menu's claims: one P2, a ⌘-press or Ctrl-press on an armed heading or cell made a T3 candidate, so the click edited it and the arrows then moved the caret, not the element (fixed at cbb1673d4: the press records its deep select, and a deep press makes no candidate).
  - Comments, the inspector, fonts and egress, and the evidence harnesses: two P2s.
    - The popover's fallback to the newest thread after a resolution was never stored as the choice, so a thread an agent added next took the active card from the one the human was replying in (fixed at 58c0a8dda).
    - The drag harness passed an agent trial on "the cap fired", which the cap does over an empty buffer too (fixed at 1e7eedde5: `PortProvider.counts()` gains `released`, the buffered frames each clearing of a hold lets through, and the drag probe's `hold.released`; an agent trial must release at least one frame, a control none).
  - Round 2, one reviewer-medium over the fix wave (05186fc9f..1589c3379): no findings. The review converged there.
- 2026-10-21 (M6's measured A/B; run 39687958414 on dfe6d368a, green: `e2e:presentations-drag`, `e2e:presentations-scale`, `e2e:design-scale`, measured and alone). The drag group's four pairs, move to frame p95 in ms, the control's against the agent's: 18.6 against 19.9, 18.9 against 19.7, 18.4 against 19.7, 18.9 against 19.7 (the bound met, the agent trials' best 19.7 against 24 at load 2.13; queue 15.2 to 15.7 in the controls and 16.7 to 17.8 in the agent trials, handler 2.1 to 2.5 and paint 1.8 to 2.2 in both). The 5 s cap fired in every trial, the controls' too (the hold stands for the whole drag, nothing held in them): at 5054, 5062.9, 5062 and 5059.1 ms in the agent trials, which lasted 6528, 6178, 6547 and 5978 ms, so the hold covered 77, 82, 77 and 85 % of each agent trial's moves, and nothing was held at a drop. Inside that share no remote apply touched a move; after the cap the merged flush and the live publishes applied 3, 3, 3 and 2 times and touched 3, 1, 3 and 1 moves (before the hold, run 39681336919: 8 applied and 7 or 8 touched per agent trial). So over its share the hold keeps every agent publish off the moves, and it buys no p95: the agent trials read about 1 ms over the control in this run, inside the spread of the unheld agent trials before it (18.5 to 20.3), the difference in queue, not in handler or paint. The scale gate: row 2 18.4 with the agent, row 2c 18.6 with none; publish one slide 47.99 (met, load 2.3), whole deck 157.2. The design scale gate, every row met; its six stress trials (a pan or a pinch zoom during an owner's title drag while the agent republishes that board every 0.7 s, 18 to 24 publications in each 9.7 to 13.1 s window) passed their frame check (the dragged frame stands) and their fill check (the agent's last fill stands); about 7 to 8 publications each fall inside the cap's 5 s and apply as one (read from their host start times; the run records no merged count), the rest live; stress pan frame work p95 7.22 ms and stress zoom 7.35 ms against 10, 0 % dropped.
  - The A/B's own hold assertion did not prove the buffering: an agent trial passed on "the cap fired", which the cap does on an empty buffer too (the controls show it; M8's review). The reading stands on the per-move apply counts above. The first run whose assertion proves it is the one after M8's fix wave (the frames each release lets through, at least one in an agent trial and none in a control): run 39697010247, above.
- 2026-10-21 (D17's floor, confirmed; run 39681336919 on e6176cfd4, green, four pairs, every move written): move to frame p95 in ms, the control's then the agent's, with queue, handler and paint: pair 1, 18.6 (15.6, 2.2, 3.0) and 20.3 (16.7, 2.0, 2.8); pair 2, 20.0 (15.9, 2.5, 3.1) and 19.3 (17.0, 2.1, 3.0); pair 3, 18.6 (15.3, 2.0, 2.7) and 18.5 (15.3, 1.9, 2.6); pair 4, 18.4 (15.1, 2.1, 2.9) and 19.0 (16.1, 2.1, 2.7). The agent trials applied 8 remote updates each, touching 7 or 8 moves, and their untouched moves read as the whole. The bound is met (the agent trials' best 18.5 against 24, load 2.57); the 16 ms target is not (the control's best 18.4). The four pairs agree with the first: no per-frame levers. The scale gate in the same run: row 2 19.7 with the agent and row 2c 19.7 with none, publish one slide 46.18 (met, load 1.61, trials 29.9 to 50.5: A's margin, the second reading), whole deck 161.3, open cold 91.6, warm 81.8, preview 59.3, heavy preview 112 ms, renderer 349.8 MB. Row 212's first green `e2e:presentations-drag` with evidence is this run.
- 2026-10-21 (the Mac's e2e, two fix waves): `e2e:presentations` read 27 of 41 (39678714241), then 29 (39682822547) before the second wave; `e2e:design` 16 of 17 (39679407168). Of the seven failures six were the tests' (a loose locator twice, the popover's clamp D16 promises, the Escape that closes its own window, a click on the selected element that T3 now edits, a PDF's Type 3 font with no `/BaseFont`) and one the product's (M5's pins kept a quote that a rename or a republish changes with no write to the threads: 31960f633). M4 merged with one joint fix (eef3e1313: the Edit menu's claim takes the focused element node A3 gives).
- 2026-10-21 (D17's floor, the first readings; the architect's reading accepted). Move to frame p95, ms, on the mini under the load rule, the first pair of trials in each run (the later trials invalid: a harness drift of 160 px a trial took the picture off the slide drawn at the default chrome after two trials, and every later press missed it, 0 of 200 moves written; fixed at e6176cfd4 by dragging out and back within each trial):

  | Run | Trial | Move → frame | Queue | Handler | Paint | Remote applies (moves touched) | Untouched moves |
  |---|---|---|---|---|---|---|---|
  | 39675318425 | control | 16.6 | 13.6 | 1.9 | 2.7 | 0 | – |
  | 39675318425 | agent | 16.8 | 13.2 | 2.2 | 2.8 | 7 (5) | 16.8 |
  | 39678714241 | control | 19.7 | 15.9 | 2.1 | 3.0 | 0 | – |
  | 39678714241 | agent | 19.4 | 16.7 | 1.9 | 2.7 | 7 (6) | 19.5 |

  The 24 ms bound holds; 16 ms stays a recorded target. Queue (the event's timeStamp to its dispatch) is 13 to 17 ms of the p95 in the controls too: Chromium dispatches continuous pointer events aligned to the frame, and no renderer lever can show a move before the next frame, so the remainder is not B2's. The agent's publishes add nothing measurable (the untouched moves read as the touched). M6 goes on for the hold's correctness; the per-frame levers wait unless run 39681336919's four pairs contradict the first pair. The scale gate's publish-one-slide row read 50.04 ms (median, load 3.04) against its 50; master's last runs read 47.09 (39580192779, loads 1.75 to 1.91) and 47.31 (39599930074, load 1.92, two trials over 50), and the whole-deck row is unchanged (160.9 against 160.2 and 161.0): the host's publish path is A's and its margin, not this tree's.
- 2026-10-21 (M3, its e2e half): the IME spec runs on the unconditional ARMED (a3ded2ae8): I2 under T11, I3's bare jamo typed by the box, I4 and I5 polling the replica's held frames (`PortProvider.counts()`, the seam's `frames()`, row 256; the presentations spec's composition step polls them too), Q3 through K6's `edit.undo` and `edit.redo`. The presentations spec follows the click model and gains D12's grouped-heading, P7 and table-cell cases; the design spec gains T22's activation case (0f78ba27c). The live harness (2db158b60 and the gates after it) drives itself through cua's engine keystroke probe when `MAWS_IME_PROBE_CMD` is set: L0's r-then-k gate first, each case naming what it needs of the probe (`--ansi-keys`, `--keys`, the input-source probe), each call's outcome read from its JSON report. Its slot is booked after cua_repl's hold 2b (about 06:00 to 07:40Z, 2026-10-22), the GUI go the architect's.
- 2026-10-21 (Mac runs): master 8fae37963 merged (b77d33ce1), class 1a green on it (run 39674443689). Dispatched at 21:00Z under the architect's posture go, measured and alone on the mini: run 39675304866 (`e2e:presentations-drag,e2e:presentations`) and run 39675318425 (`e2e:presentations-drag,e2e:presentations-scale`). Still owed: `e2e:design` (T22) in a later drain.
- 2026-10-21 (M1's review): one reviewer-medium round; its one finding (P2: a double-click resolved its text from the whole painted stack, so an opaque cover's double-click edited the text under it) fixed at e7be96465, the deepest text, a container's child and a table's cell read from the frontmost hit's chain.
- 2026-10-21 (M0 and M2 handed back, merged at d856a07d5 and 61967c72a): M0's probe split, `e2e/support/deck-agent.ts` and row 212's host-faithful case, moved to its own `e2e/presentations-drag.spec.ts` (a `--grep` group would have broken `e2e:default`'s derivation); class 1a 39669907760. M2's K6: `edit.undo` and `edit.redo` app items, `layout.edit` sent to the target page alone (`emitTo`, not a broadcast, so a background window's deck never answers), the claimants; class 1a 39670789211; its e2e case in `e2e:presentations` (run 39675304866). M4 (the inspector, F6, A1 to A5) and M6 (the gesture hold, its levers waiting on the floor) dispatched to opus sub-workers.
- 2026-10-21 (M1 landed): the state machine, D1 to D9, at the commit after 23aaf7cbb. ARMED is unconditional (the prototype's switch and the seam's `armed()` gone; the seam's `editorState` carries `keyboard`), derived in the overlay from one selected text target while `session.keyboard` is `stage`; the box's acts are the registry's (`replace`, `editAll`, `markAll`, `focus`). T3 runs on `click` with count 1, T5 on `dblclick` (the deepest text, the word by `Intl.Segmenter`), D8's cells drag from a cell of the selected table, T16 and T17 in the box, F9's typed keys retired for D9's stray key through the armed box. The DOM cases P1 to P8, P10 to P12, K1 to K5, T11, T20, T22, the read-only stage and the keyboard's owner pass in both artifacts DOM projects (4053 tests over `src/artifacts` and the deck and design tools); `TextBox.tsx` and `Overlay.tsx` joined the React Compiler test. P9 (a triple press) is native in EDIT and left to the e2e. The departures are Decision Log 12 to 14.
- 2026-10-21 (M0 and M2 dispatched): the drag's measurement (D17's M0) and K6 (D10) to opus sub-workers in isolated worktrees off this branch at the integration merge.
- 2026-10-21 (the base): origin/master e7fdf0583 (the P4 integration) merged at 6b7d7bb71; M7 merged at badcfdd63; M5 (the pin popover, handed back with its fix wave at f0e220327) merged at c763363be, the overlay's `pins` prop meeting M1's `renderText(…, armed)` on one line as planned.
- 2026-10-19 to 2026-10-21: the spike S-IME (`spikes/p4-click-model/findings.txt`; branch `worktree-agent-a0ef27fba0a0f4b08`). The first phase built the ARMED prototype, the CDP harness and eight simulated cases. The mini's GUI hold passed L8, so Q3 holds on the real Mac. L0 stopped the run: cua's keys bypass the input method. The owner then skipped L0 to L7, so the IME verdict is "intact under simulation, the real input method unverified". LC-2 read Google Slides: a printable key on an object-selected box appends at the end of its text, and a first click on a box's text gives a caret. Canva's half waits on the owner's sign-in. Until then T10 stays as §4.4 writes it, one swappable transition.
- 2026-10-21 (M7 handed back): Google Fonts on `worktree-agent-a66fbdb8c0cc70268` at e2a582404 (14 commits on master a98e0a75e). Class 1a is green at the head (run 39661396013). Two reviewer-medium rounds each found one real issue, both fixed with tests: a reused upload's ref was rejected by the validator and caused a refetch loop, and the backoff reset. The e2e (`e2e/presentations-export.spec.ts`, "a named Google Fonts face with no network") waits on its Mac run. Departures recorded: the record stores the canonical identity as `google.request`; `refused` also names non-licence reasons (unlisted, unserved, too-large, unreadable); the host writes as the human, since X29 has no system actor; the For-Claude zip drops the record. Merged here at M0.
- 2026-10-21 (the outline accepted; Decision Log 8): M5 (the pin popover) and M7 (Google Fonts) dispatched to opus sub-workers in isolated worktrees off master; the rest waits for the integration's landing.
- 2026-10-21: the grounding read on master a98e0a75e. Four read-only opus agents covered the pin popover, Google Fonts with R-8, the drag remainder with rows 212 and 182, and accessibility with rows 280 and 253. The executor read the state machine's files. The design below rests on their reports.

## Scope and what the code says (grounding)

- **The click model today** (`src/artifacts/slides/editor/transform/selection.ts`, `Overlay.tsx`, `../TextBox.tsx`, `../session.ts`; `src/artifacts/design/editor/World.tsx`):
  - `pick` selects at the selection's level, and ⌘ deep-selects.
  - A double-click calls `drill`: one level into a selected container, or an edit of a selected text element.
  - Escape is `escapeUp`: up to the container, then nothing. Enter edits a text element or selects a container's first child.
  - The session holds `selection` and `editingText`, and the text box mounts only for `editingText`.
  - P3-F F9 types a printable key pressed on a selected text element into its edit once the box binds, excluding Hangul (`Overlay.tsx:55-58, 330`).
  - The World arbitrates presses before the overlay (a press on an inactive board activates it and selects the hit; `World.tsx:233-243, 603-614`), and passes every key it does not own to the overlay.
  - None of these files changed on master since the spike's base 48fec4bd1. The integration's R9 changes the Inspector (`pickedAt(…, version)` with `useDocVersion`) and the MarkBar (`useEditorState`).
- **The spike's prototype** (`armed.ts`, and the armed branches in `TextBox.tsx`, `Overlay.tsx`, `Stage.tsx`, `textbox.css`) is the mechanism this plan keeps:
  - The box mounts ARMED: focused, caret transparent, no mark bar.
  - Capture-phase key routing sends the element keys to `stageKey`; ⌘Z stays the box's; the clipboard events are the stage's.
  - `replace()` clears and carries the marks; a press the stage keeps gives the focus back.
  - The prototype's switch and the seam's `armed()` go. ARMED becomes unconditional.
- **Tables.** `th` and `td` are text tags and `table` and `tr` are containers (`ir.ts:79-83`). `tableRow` adds and removes rows (`writers-elements.ts:629`).
- **The Edit menu** holds Undo and Redo as role items (`src/main/menu.ts:117`). Its Select All is already an app item that runs the focused contents' command and emits `layout.selectAll` (`:30-44`), which is this plan's pattern for K6.
- **The e2e stage** draws the slide 256 px wide (scale 0.133) in the presentations specs' 1600 × 1000 window (findings, finding 4). Pointer cases need the sidebar and the panel collapsed, as the live harness does.

## Design (decided here)

The states are §4.4's, binding. Everything below them (thresholds, selection details, the files) is advisory and decided here. Each departure from the prior art is named, and the dated ones are listed in the Decision Log.

**D1. The states, as code.**
- **IDLE and SEL:** the session's `selection`.
- **EDIT(id):** `editingText`.
- **ARMED(id):** derived, never stored: one selected element on a writable slide, outside EDIT, which is itself a text target, while the stage owns the keyboard. The TextBox for it mounts armed, and the flip to EDIT is `session.editText(id, placement)` on the mounted box: no remount and no focus change.
- **The keyboard's owner** (`session.keyboard: 'stage' | 'away'`, the plan review's P2) is the input that makes ARMED and every other focus rule agree:
  - It becomes `stage` on a press on the stage's content or on focus of the stage surface or the box.
  - It becomes `away` on focus anywhere else: the inspector, the rail, the notes, a pin, the popover, F6's next region.
  - When it is `away`, the selection is kept and the armed box unmounts, so nothing takes the focus back. When it returns, the box mounts armed again.
  - A box takes the focus on mount only when armed with the keyboard on the stage, or in EDIT. The spike's prototype focused on every mount.
  - M1 builds this contract, M4's F6 and A3 read it, and M5's pins and popover only ever set `away`.
- **CELLS(table, a, b):** a selection of two or more `th`/`td` of one table, with the gesture's anchor cell kept by the overlay.
- **PRESS and DRAG:** the overlay's pending press and gesture. The session gains a `dragging` flag, which the gesture hold (D17) and the inspector's settled version (D13) read.
- **`composing`:** the box's `view.composing`, mirrored on the session so the overlay's keys and T20 can read it.

**D2. A text target is the selected element itself** (h1 to h3, p, ul, ol, th, td), never a container's single text descendant. This departs from tldraw's one-label guard, which the prior art's §2.3 names: under that guard a group holding one heading would arm on the first click, and P7 then fails (click 1 must select and move the group). A group arms only once its heading is selected (P7's click 2).

**D3. A press on the armed element is the stage's, and it moves no focus.**
- While armed, the editor root takes no pointer events (`.deck-stage[data-armed] .deck-textbox { pointer-events: none }`), so presses reach the element's node and the overlay's PRESS.
- `mousedown` on the armed element is cancelled, so the focus stays in the editor (I2: no focusin or focusout).
- A 3 px move is DRAG(move) (T2). A release without one is a candidate for T3, which acts on the `click` that follows it (below).
- A gesture the stage kept (a handle, a drag, a cancel) gives the focus back to the box at its end (the spike's `rearm`).

**D4. T1 and T3.**
- **T1:** the first press selects the outermost element at the current scope; a text target is then armed.
- **T3 on an already selected X:**
  - a text target gives EDIT with the caret at the point;
  - a group gives SEL of its child under the pointer, ARMED if that child is text;
  - a table gives EDIT of the cell under the pointer, caret at the point;
  - a press inside a multi-selection narrows it, as today.
- A press with `detail ≥ 2` defers to the dblclick (T4).
- **Where the click count comes from** (the plan review's P1). Pointer events carry no click count in Chromium, and the overlay's cancelled `pointerdown` suppresses the compatibility `mousedown`, so neither can be read for it.
  - T3 therefore runs on the `click` event. `click` still fires after a cancelled pointerdown and a captured pointerup. It acts only when its `detail` is 1, the press that preceded it made no drag, and X was selected before that press.
  - T5 runs on `dblclick`, as today.
  - A drag sets a flag that the next `click` reads, and then drops.
- **P12 is read as:** editing starts exactly once in a double-click, and from an unselected element no caret is drawn before the word.
  - From an unselected element, the first click only selects and arms, with the caret hidden.
  - From an already-armed element, the first `click` is T3 and places the caret, which the dblclick then extends to the word. That is the same single EDIT, and the same caret-then-word every macOS text view draws.
- These sequences are tested twice: in the DOM tests with constructed events, and in the e2e on the pinned Electron with Playwright's mouse (real `clickCount`).

**D5. T5: a double-click from any state edits the deepest text under the pointer** (the owner's departure from Canva's level entry, Decision Log 6).
- D is the deepest text target or cell among the hits, ignoring scope. If D exists: select it, then EDIT with the word at the point selected. A placeholder gets select-all, an empty element a caret, and the scope becomes D's parent. If no text target is hit, the gesture drills one level, as today.
- The word is found with `Intl.Segmenter(…, {granularity: 'word'})` over the block's text around `posAtCoords`, so a Hangul word is one word.
- P12 (no flash): the first click of the double-click already armed the element, so the second only sets the word's selection and then flips. The caret is transparent until the flip, so no caret is ever drawn before the word.
- On a design board, the first press of a double-click on an inactive board activates it and selects the hit (the World's existing rule). The dblclick then reaches the newly active board's overlay and applies T5: T22 in one gesture.

**D6. The keys on ARMED**, from the spike's capture-phase routing; every element key is gated on `!isComposing && keyCode !== 229`.
- **T10 (a printable key, no modifier):** clear the content and let the key insert natively. The text's marks are carried when it is one marked run (stored marks), as the spike built it.
  - It is one function, `armedPrintable`, with its policy in one constant (`ARMED_TYPING: 'replace' | 'append'`). Canva's reading, or the owner, may change it without touching another transition.
  - Under `append`, the box flips to EDIT with the caret at the end, and T11 follows the same policy.
- **T11 (a keyCode-229 keydown):** the same policy, applied in that keydown before the composition starts (findings, Q2). Then the flag flips with no remount, no focus change and no MAWS write near the composition.
- **T12 Enter:** EDIT with all selected, no newline. **T14 Backspace or Delete:** remove. **T15 Tab:** the next sibling, and past the end the focus leaves the stage. **T18 Escape:** the parent below the root, else IDLE.
- **Arrows** nudge by 1 px, 10 with Shift. **⌘D, ⌘G, ⌘A and the z-order keys** are the stage's. **⌘C, ⌘X and ⌘V** stay the Edit menu's, and their clipboard events are the stage's (L8). **⌘Z and ⇧⌘Z** are the box's, which is the deck's stack.
- **⌘B, ⌘I and ⌘U on ARMED** toggle the mark over the whole text and stay ARMED. This is Slides' behaviour for an object-selected box, and with no selection drawn there is nothing else for them to act on.

**D7. EDIT.**
- **T6 to T9 are native or today's:** a triple press selects the paragraph; a drag in the text selects text; a press on another element commits and runs T1; a press on the empty stage commits to IDLE.
- **T16, Tab in a cell:** the next or previous cell with its content selected. Tab in the last cell adds a row through `tableRow`, then enters its first cell.
- **T17, Escape:** commit, and go back to ARMED on the same mounted box, with the caret hidden and its armed selection. From a cell it goes to SEL of the table.
- **T19:** while composing, Esc, Enter, Backspace, the arrows and Tab are the input method's.
- **T20:** an element deleted by a remote replica drops the selection and unmounts the box. While composing, the replica's composition hold already buffers the deletion until `compositionend`.
- **T21 (⌘-click deep select)** is today's.

**D8. CELLS.**
- A press in a cell of the selected table, followed by a 3 px move, is DRAG(cells). The selection becomes the rectangle of cells between the anchor and the cell under the pointer, outlined as one range.
- On CELLS, the inspector's text styling applies to every cell, through its existing multi-selection.
- Backspace or Delete clears the cells' text in one step (Keynote's rule for a cell range). Escape goes to SEL of the table.

**D9. The stray key.** F9's typed-key path and its Hangul exclusion retire (§4.4).
- A key can still reach the stage with one text target selected, for example when something took the focus. In that case the stage gives the focus back to the armed box, and a non-composing printable key goes through T10.
- A keyCode-229 key arriving at the stage is lost, because no input method composed it there. That is the platform's limit, and the box's focus makes it rare.

**D10. K6: the Edit menu's Undo and Redo reach the focused editor** (Decision Log 24's ruling 3; finding 1).
- In `src/main/menu.ts`, Undo and Redo become app items with ids `edit.undo` and `edit.redo`, keeping ⌘Z and ⇧⌘Z as accelerators, following Select All's pattern.
  - If the focused contents is not an app page (a webview, DevTools), the item runs that contents' `undo()` or `redo()`, as the role did.
  - Otherwise it emits `layout.edit {op}`.
- The renderer keeps a registry of edit claimants (`registerEditClaimant({claims(el), undo(), redo()})`).
- A claimant claims by the editable surface that has focus, never by its root's containment (the plan review's P1). The deck editor and the design workbench claim only:
  - the stage surface;
  - the armed or edited text box;
  - the deck's notes field, whose typing is the deck's stack today.
- They claim nothing while read-only or while a history version is shown, the same conditions under which `DeckEditor`'s key handler steps aside. Inspector inputs, comment reply fields, the rail and any iframe stay native.
- An unclaimed op calls back `layout.nativeEdit {op}`, and main runs the focused contents' command, so inputs, the composer and the document editor behave as under the role.
- A ⌘Z the page cancels never reaches the item (Q3 on the real Mac, L8), so the editors' own keys are unchanged; the item serves the mouse and unhandled keys.
- Tests: a menu unit test for the two items; a renderer claimant test covering an inspector input, a reply textarea, a history preview and a focused iframe inside the claimed root, all native; and an e2e case that nudges an element, clicks `edit.undo` by id (`getMenuItemById(...).click()`) and reads the element back in place, then does the same inside the inspector's width field.

**D11. The IME cases** (I1 to I5; Decision Log 24's ruling 4: I2 replays the trace, I1, I3, I4 and I5 are simulated).
- `e2e/presentations-ime.spec.ts` is rewritten against the unconditional ARMED state, with no `armed(mode)` calls. It keeps the spike's Q2 and Q3 assertions; the Q3 Edit › Undo assertion flips to "undoes the deck step" once D10 lands.
- `e2e/fixtures/ime/l1-hangul.json` stays the cdp-synthetic stand-in. The live harness (`e2e/presentations-ime-live.spec.ts`, `spikes/p4-click-model/cua-live.js`) stays, skipped, for whoever types for real later.
- **Row 256:** the deck tab's provider counts the frames it holds and receives (`PortProvider.counts()`), the seam answers them for an open tab (`__maws_presentations.frames(artifactId)`), and the composition-hold steps in `e2e/presentations.spec.ts` and the IME spec poll the held count above zero before their negative check, in place of the fixed 300 ms wait.

**D12. The e2e cases** (§5's acceptance).
- `e2e/presentations.spec.ts` gains three cases: a grouped heading reached in one double-click and typed over; a table cell double-clicked and edited, then Tab to the next cell; and a single-click path through P7. Its composition-hold step is reworked as in D11.
- `e2e/design.spec.ts` gains a board-activation case: a double-click on an inactive board's heading edits it in one gesture (T22).
- These cases collapse the sidebar and the panel through the View menu's items, so the slide draws at least 800 px wide (a support helper shared with the live harness).

**D13. The inspector follows every gesture's end (row 280).**
- R9 already makes the read take the document's version. B2 adds `useSettledVersion(session, canvas)` beside `useDocVersion`. It advances on a document update or a canvas layout pass outside DRAG, and once at every gesture's end, commit or cancel. Keyboard nudges refresh on each key.
- The Inspector passes it to `pickedAt` and rebuilds `measure` per version, so the React Compiler keys on it.
- The fields show whole pixels for X, Y, W and H, and the model keeps its fractions:
  - an untouched field's Enter writes nothing;
  - the arrows step from the model's value;
  - "Mixed" compares rounded values.
- A cancelled gesture keeps what its frames wrote, as P3 does: the gestures write every frame and `end(false)` rolls nothing back, except a flow drag (the plan review's P2). Rollback on cancel is not this plan's change. So the inspector shows the model's value at the cancel, as at any gesture's end.
- Tests: in both the compiled and the uncompiled DOM projects, a real move and resize with the inspector mounted. X holds during the frames and shows the new whole number after the end; a cancel shows the model's value at the cancel; 1334.73 reads 1335 and an untouched Enter writes nothing; a layout pass alone updates W.

**D14. The stage's keyboard exit (row 253): F6 and ⇧F6 cycle the editor's regions**, keeping the selection.
- The deck's ring is the toolbar, the filmstrip, the stage, the inspector (its last field), the notes and the open rail. The board's ring is the toolbar, the board list, the world and the inspector. An absent region is skipped.
- The editors' root `onKeyDown` handles it, gated on not composing. It steps aside when the user's keymap binds F6, and the stage carries `aria-keyshortcuts="F6"`.
- Leaving the stage from ARMED drops to SEL and coming back re-arms (T23, new: a transition §4.4's list did not need until the stage had an exit that keeps the selection).
- Regression test: a middle element's selection reaches the inspector by F6, ⇧F6 returns, F6 does nothing while composing, and the board does the same.

**D15. Accessibility A1 to A5, bounded here, on the drawn nodes with no mirror.**
- The canvas already draws real, positioned DOM in the model's own tags, so Figma's mirror (which exists because its canvas is WebGL) would add a second tree and nothing else.
- **A1:** a `describe` option passed only for the stage's and the boards' canvases (never the thumbnails, the presenter or the previews) names the nodes. A group is `role="group"` with "Group, N items"; shapes, icons, connectors, svgs and embeds are `role="img"` named by kind; an image without alt is "Image". Text and tables keep their native semantics, and the model's own `alt`, `aria-label` and `role` win. Every element is `tabindex=-1`, and the model is never written.
- **A3, focus follows the selection:** the armed editor for one text target, the element's node for one other element, the stage for several or none. A `focusin` on a node selects it, so VoiceOver's focus and Delete agree.
- **A2:** a polite status speaks only what focus does not, "N elements selected". A single element's "n of total" goes into the focused node's `aria-description`. Nothing is announced during EDIT.
- **A4:** the editor carries `role="textbox"`, `aria-multiline` and the element's name.
- **A5:** whenever the focused node or editor goes, the focus goes to the stage, never to `body`.
- The names live in one module shared with the inspector's title (W1-C's L281 `nameOf`).
- The live VoiceOver run, coalesced move announcements and focusin activating an inactive board are routed to the decks round's known items, by a dated line.

**D16. The pin popover (§2 item 2, V1 to V15).**
- **The component:** a portable `src/artifacts/comments/ThreadPopover.tsx`. It draws the pin's open threads as compact X36 `ThreadCard`s, oldest first, focuses the newest one's reply field on opening, and closes on `onExit`.
- **The binding:** `src/artifacts/slides/editor/comments/PinPopover.tsx`, mounted in the comment frame (outside the stage surface) by both the deck's and the design's frames.
- **Placement:** `placeCard(box, pinOf(pinRect))` against the frame, re-placed in a layout effect and inside the stage's scroll handler so it never lags a frame. It is hidden while its pin is off the stage.
- **State:** one slot `popover: {slideId, elementId} | null` in `useDeckComments`, which makes V3 hold, and one reply-draft map per editor, shared with the rail, which makes V5 hold.
- **While open:**
  - A capture-phase pointerdown on the frame closes it on any stage press that is not on the popover or a pin. That press is consumed (it selects nothing, no marquee, no pan), and the focus goes to the pin.
  - Escape on the stage closes it before `escapeUp`.
  - A press outside the frame closes it without being consumed.
- **Closing on its own:** when its pin goes (the last thread resolved, the element deleted, the slide changed), the popover closes and the drafts stay. The deleted element's threads stay orphans in the rail (V9, today's).
- **The compose card:** P2's card adopts the draft rule on decks and boards (`draftRule: true`). Its `locate` answers the pin's rect, so ⌥⌘M opens at the pin (V12), and opening a popover hides the compose card without unmounting it. ⌥⌘⇧J hides and shows the pins.
- **Pins:** they read open threads at once (a `useSyncExternalStore`, as B1's Decision Log 11 did), in slide order for Tab (V13), with `aria-expanded`.
- **Boards:** one pin layer for all of a board's pins, clustered under 32 screen px by a pure `pin-clusters.ts`. A cluster click fits its members (V15).
- **The filmstrip:** badges a slide with open threads, orphans counted, as the header's count and B1's tab dot do (V10). Presenting mounts no pins (V14, a test).
- `{kind: 'pin'}` placement is retired by a dated ledger line: the anchored card placement with `locate` answering the pin's rect does the work with no X21 amendment.

**D17. The drag while an agent republishes (rows 231 and 212).** The grounding changed the premise.
- The host-faithful trials' move-to-frame p95 is 18.6 to 20.9 ms, but their move-to-transaction p95 is already 16.4 to 19.7 ms. Most of the p95 is input queueing before the handler runs, not the arriving publish: about 8 publishes fall across 167 written moves. The "about 4 ms" of row 231 was never isolated against a no-agent control.
- So the work is measure first, then the deferral, and 16 ms is not promised.
- **M0's measurement:**
  - The seam's `dragProbe` splits each move into queue, handler and paint, and counts remote applies during the moves and after the drop.
  - A new fast group `e2e:presentations-drag` alternates no-agent control trials with agent trials.
  - Two runs on the mini decide whether 16 ms is reachable at all.
- **The gesture hold:**
  - `DeckSession.beginDrag` and `endDrag` add a gesture reason to the replica's hold (one hold, two reasons, the provider unchanged). Awareness, acks, a host step 1 and X35 frames keep flowing.
  - At the drop, `endDrag(reassert)` releases the buffer before the step's closing cut, then rewrites the gesture's last values for any key a held remote write moved, so the owner's drop wins whatever the clientIDs.
  - The re-assert re-reads, after the flush, whether the session still takes writes and whether each target still exists on a writable, unheld slide or board (the plan review's P2). It skips any target that no longer qualifies. The release, the cut and the gesture's state run in a `finally`, so a throw cannot leave the hold set.
  - Tests: a remote write moving the dragged element, a held-board publish, and the element's deletion, each arriving under the hold.
  - The board drag in `World.tsx` uses the same calls.
  - The 5 s cap stays, and the probe records when it fires.
- **Row 212:** the renderer seam's stand-in agent (`agentRepublishing`) goes. The class-1 case drives the host's real `artifact_publish` through the presentations perf seam, as `e2e/presentations-scale.spec.ts` row 2 does, with a fidelity regression: rising revisions, the agent's frames integrated as remote, and its last font size in the read-back.
- **Acceptance:** p95 ≤ 24 ms under the hold, with the 16 ms target recorded as met, or its remainder attributed by the split and re-filed under the architect's ruling.
- If the no-agent control already sits at 16 ms or more, B2's own per-frame levers come next, because they live in files B2 touches: skipping `readDeckView` on a transaction with no deck-level key, and the thumbnail redraw at the drop.

**D18. Row 182 (the export page's copies of the canvas's drawing code) is re-deferred** with a dated line. B2 rewrites the gesture state machine, not the drawing. The two sides draw to different media (DOM nodes and markup strings), and the export's measure page must stay self-contained.

**D19. Google Fonts fetched once (§2 item 4, row 176, R-8).**
- **Where:** the engine host fetches. The portable logic lives in `src/artifacts/slides/google-faces.ts` (the request's canonical form, the repository directory rule, the `METADATA.pb` reader, the CSS2 parser) and the host module in `src/engine-host/presentations/google-faces.ts`. It covers decks and designs, which share `faces`.
- **When:** on any commit (`service.onCommitted`) and on a document's load (a new `service.onLoad`), for an `href` face with no host record answering it, one family at a time. The publish never waits on the network.
- **The request's identity** (the plan review's P2) is what is licensed, fetched, cached and checked for staleness, never the `href` alone.
  - The `href` must name exactly one family, equal to the entry's `family`.
  - A link naming other families, or a `text=` subset, is refused by name: a subset is not a face for the deck's text.
  - The identity is that family with its axis tuple (`wght`, `ital`), the other parameters dropped.
  - The CSS2 answer's `font-family` must equal it too.
  - Fixtures: a mismatched family, a multi-family link and a subset link.
- **The licence:**
  - The index file is `https://raw.githubusercontent.com/google/fonts/main/ofl/<dir>/METADATA.pb`, where `<dir>` is the family lowercased with everything outside `[a-z0-9]` removed.
  - It needs a top-level `name:` equal to the family and `license: "OFL"`.
  - Its `OFL.txt` is stored beside the faces.
  - A miss probes `apache/` and `ufl/` only to name the refusal. CSS2 also serves Apache families, so the licence never comes from it.
- **The files:**
  - The CSS2 answer is requested with a Firefox 40 user agent. That form is unsliced, one woff2 per style and weight, where a modern user agent gets 248 `unicode-range` blocks for Noto Sans KR.
  - The answer is validated (text/css, ≤ 64 KB, one gstatic source per block, no `unicode-range`). If it ever comes back sliced, the request falls back to the user-agent-less TTF form.
  - Each file is checked for its magic bytes and against the 16 MB asset limit; a family over about 32 MB is refused by name.
  - Everything is written with the face entry in one `writeWithAssets`. Its `prepare` discards a result whose `href` changed meanwhile.
- **The model (an X27 amendment, departing from the ledger's proposed shape):**
  - The face keeps its `href` and gains a host-owned record: `google: {href, licence: 'OFL', licenceSrc, files: [{src, weight, style}]}`, or `google: {href, refused}`.
  - Refs replace the ledger's `assetId` (refs are the model's currency, and versions pin ids already), and a family needs several files.
  - The loader strips `google` from what an agent sends, and the publish's faces merge carries the live record forward, so the host's write never turns the agent's next face edit into a conflict.
- **Rendering offline:** `faceFiles(face)` returns `[{src, weight?, style?}]` for uploaded and fetched faces alike. It replaces the single-`src` reads in the editor's and the presenter's face rules, the history preview, `deckAssetRefs` and `deckFacesCss` for the three exports, the folder mirror and the answer. No CSP changes. PPTX's `named` variant writes the family's name; `embedded` stays refused.
- **A refusal by name:** "Roboto Slab is Apache-2.0 on Google Fonts; MAWS fetches only OFL faces, so it draws as its fallback; upload a font file to use it". The agent's answer warns with it, and Theme ▸ Faces lists each face as saved, pending (offline) or refused.
- **R-8's answer: no egress rule exists today.** A new `src/engine-host/egress.ts` declares host rules as data, behind a guarded GET-only fetch (https, no redirects, timeouts, bounded bodies, injectable for tests). Its `google-fonts` rule admits `fonts.googleapis.com/css2`, `fonts.gstatic.com/s/` and `raw.githubusercontent.com/google/fonts/main/{ofl,apache,ufl}/<dir>/{METADATA.pb,OFL.txt}`. A source-guard test fails on any other `fetch(` in `src/engine-host` besides this module and route D's transport. This opens a second host egress door after route D, so it takes a charter Decision Log line (the architect's, listed under the approval ask).
- **The owner sees the fetch** in Theme ▸ Faces and in the agent's answer; no prompt (Decision Log 4 rules it automatic).

## Plan of Work

Milestones run in order where they share files, and in parallel where they do not. The executor owns the state machine and the merges. Sub-workers (opus, isolated worktrees off this branch, one commit per change, test-first where the logic is testable) take the independent milestones. One reviewer-medium per milestone at its pin, sol unless the quota refuses; reviewer-high over the whole branch before the hand-back.

### M0 — The base and the drag's first measurement
- **The base:** once the architect reports the integration landed, merge master into this branch. Strip the prototype's switch (`setArmedPrototype`, `useArmedMode`, the seam's `armed()`) so ARMED is unconditional, and keep the registry. The F9 cases are rewritten under M1, not deleted.
- **In parallel, a sub-worker on the drag's measurement (D17's M0):** the probe's split and counters, `e2e/support/deck-agent.ts`, and the class-1 drag case through the host seam with its no-agent control trials (`e2e:presentations-drag`). Two Mac runs, requested from the architect with the quiet flag (a measured group, P4 Decision Log 53). It reports the no-agent floor before M6 starts.

### M1 — The state machine (the executor)
D1 to D9 in `selection.ts` (the pure helpers: `isTextTarget`, `deepestText`, `cellRange`, `nextCell`, the layered Escape), `session.ts` (`editText(id, placement)`, `dragging`, `composing`), `TextBox.tsx` (armed mounting from the spike, the placements: caret at a point, the word at a point, all, the end) and `Overlay.tsx` (PRESS, DRAG and CELLS; T1 to T21; the armed key routing; the stray key), and `World.tsx`'s T22.
- Tests: `selection.dom.test.tsx` for the pure helpers; `transform.dom.test.tsx` and `TextBox.dom.test.tsx` extended to P1 to P12 and K1 to K5 (K6 in M2), the table rules, T20 and T22. F9's cases are rewritten as T10's.
- Gates: the artifacts DOM projects, compiled and uncompiled; typecheck; lint; the React Compiler test with `TextBox.tsx` and `Overlay.tsx` added to its list.

### M2 — K6: the Edit menu (a sub-worker, parallel to M1)
D10 in `src/main/menu.ts`, `src/shared/ipc/schema` (the two events), and the renderer's claimant registry. The deck's and the board's claims land with M1's merge. Menu unit tests, the claimant test, and the e2e case.

### M3 — The IME cases, row 256 and the e2e cases (the executor, after M1)
- D11: the IME spec against the state machine, the provider's counts, the seam's `frames()`, and the composition-hold steps polling.
- D12: the presentations and design e2e cases, with the stage-widening helper.
- Gate: `e2e:presentations` and `e2e:design` on the mini, with explicit `--gates` after the architect's go.

### M4 — The inspector, the stage's exit and accessibility (a sub-worker, after M1)
D13, D14 and D15 in `Inspector.tsx` and its fields, `use-doc-version.ts`, `DeckEditor.tsx`, `DesignWorkbench.tsx`, the canvas's `describe` option (`slide-canvas.ts`, `elements.ts`), a new `editor/a11y.ts`, the shared names module, `Stage.tsx`'s status, and `TextBox.tsx`'s editor attributes, the one line it shares with M1. A1 to A5's DOM tests in both projects.

### M5 — The pin popover (a sub-worker, parallel to M1 from the start)
D16 under `src/artifacts/comments/` and `src/artifacts/slides/editor/comments/`, plus the design's comment frame, the filmstrip's badge and the renderer's `draftRule` and close guards. The overlay gets only a `pins` prop, so M1 and M5 meet on one line.
- DOM tests V1 to V15 (`pin-popover.dom.test.tsx`, `ThreadPopover.dom.test.tsx`, `pin-clusters.test.ts`, the filmstrip and presenter cases).
- A popover case in `e2e/presentations-comments.spec.ts` and a pan-and-cluster case in `e2e/design-comments.spec.ts`.

### M6 — The gesture hold (a sub-worker, after M1 and M0's floor)
D17's hold and re-assert in `session.ts`, `gestures.ts` and `World.tsx`. The tests: the hold set during a drag and released before the cut, the composition reason surviving the gesture's release, and the owner winning against a higher clientID, red without the re-assert.
- The measured A/B/A/B on the mini, on the architect's posture go: `e2e:presentations-drag`, `e2e:presentations-scale` (row 2 with its control trials and the 16 ms line) and `e2e:design-scale`. Evidence under `docs/doperpowers/evidence/p4-b2/`.

### M7 — Google Fonts (a sub-worker, parallel from the start)
D19: `egress.ts` with its source-guard test, `google-faces.ts` (portable and host), the model's `google` record (deck.ts, publish.ts's merge, answer.ts, adapter.ts's restore carry, design/publish.ts), `faceFiles` in every renderer and exporter, and Theme ▸ Faces.
- Unit tests over recorded answers (unsliced Lora, the Source Serif 4 range, a sliced answer refused, the 400 page, `METADATA.pb` for ofl/lora and apache/robotoslab).
- An e2e with no network (`MAWS_GOOGLE_FONTS_FIXTURES`: any URL missing from the map fails as offline). Lora must load in the editor and the presenter and appear in the HTML export's `data:` face, the PDF's font descriptor (Skia writes the face as a Type 3 font, which carries no `/BaseFont`) and the PPTX's `typeface`; Roboto Slab must be refused by name.

### M8 — Reviews, gates and the hand-back
- reviewer-high over the branch, its findings verified and given to a fix wave.
- A full class 1a on the pool.
- The mini's set named by the files touched: `e2e:presentations`, `e2e:design`, the settings and smoke groups that read the Edit menu, and the measured groups of M6.
- The hand-back: the branch's head, the evidence per acceptance clause, the ledger names, the dated lines, and the residue rows.

## Acceptance (this child's share of §2 items 2, 3 and 4 and §5 B2)

1. The spike's findings carry the IME verdict: "intact under simulation, the real input method unverified" (the owner's ruling, 2026-10-21), its residue row written. T10 follows Canva's reading once it runs; until then it is as §4.4 writes it.
2. `selection.dom.test.tsx`, `transform.dom.test.tsx` and `TextBox.dom.test.tsx` pass P1 to P12 and K1 to K5, and K6's menu, claimant and e2e tests pass.
3. I2 replays the synthetic trace. I1, I3, I4 and I5 pass as simulations. The composition-hold steps poll the held count (row 256).
4. `e2e/presentations.spec.ts` passes the grouped-heading, table-cell and single-click cases, and `e2e/design.spec.ts` the board activation, on the mini.
5. The pin popover's DOM tests V1 to V15 pass, and the comments e2e cases pass on the mini (§2 item 2).
6. The host-faithful drag p95 is ≤ 24 ms with the gesture hold, the 16 ms target is recorded met or its remainder attributed, and row 212's seam drives the host's `artifact_publish` with its fidelity regression.
7. A deck naming Lora renders it offline in the editor, the presenter and the three exports, and Roboto Slab is refused by name, with no network in the e2e (§2 item 4).
8. A1 to A5's DOM tests pass under D15's bound, and the dated line routes the live VoiceOver run to the decks round.
9. The inspector refreshes at every gesture's end and shows whole pixels (row 280). F6 carries a middle element's selection to the inspector (row 253).

## Interface proposals (for the architect's ledger)

- **X27:** the face's host-owned `google` record (D19), replacing the proposed `{family, source, assetId, licence}`.
- **X23:** no schema change; the fetched faces and `OFL.txt` are ordinary asset rows.
- **X36 consumer:** `ThreadPopover` over `ThreadCard`. `{kind: 'pin'}` placement retired: the anchored card with `locate` answering the pin's rect.
- **New, under the host's egress:** `src/engine-host/egress.ts` and its `google-fonts` rule.
- **Shared files:**
  - `src/main/menu.ts` (D10: `edit.undo`, `edit.redo`, `layout.edit`, `layout.nativeEdit`);
  - `src/artifacts/provider/port.ts` (the hold reasons stay outside it; `counts()` is new);
  - `e2e/support/deck-agent.ts` (new; row 2 and the class-1 drag share it);
  - `.github/workflows/gate.yml`'s `MEASURED_E2E` gains `presentations-drag`. This is a lane file, so it is the architect's or CI-opt's edit, or theirs to approve.

## Decision Log

1. 2026-10-21 (the executor, at the plan): a text target is the selected element itself, never a single text descendant (D2), because P7 needs a group's first click to select and move the group.
2. 2026-10-21: ARMED is derived from the selection, not a stored state. The flip to EDIT is a placement on the mounted box (D1), so no state can disagree with what is mounted.
3. 2026-10-21: T10 and T11 share one policy constant, `ARMED_TYPING` (D6), so Canva's reading or the owner's choice swaps one transition.
4. 2026-10-21: A1's "mirror nodes" become the drawn nodes (D15). It is the same purpose with no second tree, because MAWS's canvas is DOM where Figma's is WebGL. A2 is reworded: focus speaks a single selection, and the status speaks only a multi-selection.
5. 2026-10-21: row 231's attribution is re-opened by measurement (D17), and 16 ms is a target, not a promise. Row 182 is re-deferred (D18).
6. 2026-10-21: the Google Fonts design departs from the ledger's proposed X27 shape (refs, files per style and weight, `href` kept beside the record) and from the repository's TTFs, which are rejected on size (NotoSerifKR's variable TTF is 23.8 MB, over the 16 MB asset limit).
7. 2026-10-21: the cluster click on a board fits its members. Figma's live check (prior art §1.5 item 10) never ran, and the fit's code exists.
10. 2026-10-21 (the owner, relayed by the architect after LC-2's Canva half): T10 stays replace, "바꿔 쓰기 유지". It is binding, and `ARMED_TYPING` is `replace`. Canva's result is recorded in the findings: a first click selects with a hidden editable input focused, a printable key is ignored, and Enter and a second click give a caret. The hosts split three ways (PowerPoint and Keynote replace, Slides appends, Canva ignores); the owner chose replace.
11. 2026-10-21 (the architect, on M7): history crediting the fetched faces to "You" is accepted, because the fetch follows the human's own choice of face; the system actor is a residue row. The three smaller departures are accepted: `google.request` as the canonical identity, `refused` with non-licence reasons, and the For-Claude zip dropping the record. M7's e2e case runs with the presentations group at M0's merge or in the landing set.
9. 2026-10-21 (the executor, at the plan's adversarial review; doperpowers:adversarial-reviewer, verdict needs-attention, six findings, each taken):
   - (P1) K6's claimants claim by the focused editable surface, never by root containment, and claim nothing read-only or in a preview.
   - (P1) T3 acts on `click`, since pointer events carry no click count, and P12 is read for the already-armed case.
   - (P2) ARMED needs the stage to own the keyboard (`session.keyboard`), a contract shared by M1, M4 and M5.
   - (P2) Google Fonts' licence, fetch, cache and staleness bind one canonical family identity, and multi-family and subset links are refused.
   - (P2) The gesture hold's re-assert re-checks writability and targets after the flush, in a `finally`.
   - (P2) A cancelled gesture keeps P3's committed frames, with no rollback, and the inspector shows the model's value.
8. 2026-10-21 (the architect, at the outline): the outline accepted; departures 1 (on the condition that T5 still reaches the deepest text or cell whatever the scope, the owner's Decision Log 6), 4, 5 (the acceptance stays p95 ≤ 24 ms, 16 ms a recorded target, M0's measured floor recorded) and 6 (as an X27 amendment, on the condition that decks with today's `faces` shape load and export unchanged, with a test; the ledger row's new text in the hand-back) accepted. R-8's egress approved, the charter's dated line the architect's at landing; its rule, which `egress.ts`'s tests hold: GET only to exactly fonts.googleapis.com/css2, fonts.gstatic.com/s/ and raw.githubusercontent.com/google/fonts/ (METADATA.pb and OFL.txt), no cookies or credentials, no redirect leaving the allowlist, a timeout, a size cap and a content-type check per response, called only when a deck names a Google Fonts face and never at render, a failure or a non-OFL licence refusing by the face's name. `e2e:presentations-drag` joins `MEASURED_E2E` on this branch (the workflow reads the branch's own gate.yml), the line reported to the architect. Every Mac run goes through the architect with what, how long and whether quiet. M5 and M7 start at once off master in isolated worktrees; M0, M1, M3, M4 and M6 wait for the integration's landing.

12. 2026-10-21 (the executor, at M1): T10 types the key itself, its default cancelled, rather than clearing and leaving the key to insert natively as D6 wrote it. The box's own key and the stage's stray key (D9, which has no default to rely on) then take one path, and a one-run text's marks apply through the same transaction. T11 is unchanged: a keyCode-229 keydown clears in that keydown and its default stays the input method's.
13. 2026-10-21 (the executor, at M1): Shift+Tab before the first element, from the armed box, focuses the stage before the browser's step, so the step lands before the stage and not on it (P3-F's no-keyboard-trap case). The box holding the focus made this a detail of T15.
14. 2026-10-21 (the executor, at M1): D3's selector is `[data-armed] .deck-textbox` on both surfaces, since the World's surface is not `.deck-stage`; the armed root takes no pointer events there too.

15. 2026-10-21 (the architect, at M0's merge): the class-1 drag case in `e2e:presentations` is measured-only. It asserts its behaviour and logs p95 as evidence; the 24 ms bound (16 ms recorded) is asserted in `e2e:presentations-drag` alone, since a class-1 group runs beside other jobs and every measured bound is the load rule's.
16. 2026-10-21 (the architect, with cua_repl): L1 to L7 run without the owner's hands. cua's engine keystroke probe, launched through LaunchServices, posts plain key codes at the HID tap, and passed Decision Log 39's r-then-k gate on the mini under 2-Set (20:33Z). The live harness drives it, L0 its gate; L6 and L7 need the probe's named keys (hold 2a's build), L3 the input-source probe with per-context input off; L7 is judged by its text, since no capture route is allowed.

17. 2026-10-21 (M6, accepted by the architect): D17's hold as built departs in five places. `PortProvider.counts()` gains `capped` (a counter only, before the cap's flush), the seam's `frames()` gains `capped` and `integrated`. A re-assert a composition put off runs after that composition's flush, in a step of its own. The re-assert rewrites every key whose value is not the drag's last (after a flush the same as the keys the flush touched, and it also restores a first-frame-only key changed after the cap). The fidelity regression reads the tab's `integrated` against the last publish's revision and at least one remote apply, since the held publishes apply as one merged update. Flow re-order, the marquee, cells and pan take no hold, since none writes a frame.

## Residue rows (proposed; Logged, Owner, Item, Evidence, Closes when)

- 2026-10-21 | P4-L decks round (or cua's HID probe) | The first Hangul syllable on ARMED through the real 2-Set input method is unverified: L0 to L7 skipped by the owner's ruling, and cua's keys skip the input method's composition on both Macs (ASCII on the mini, uncomposed jamo on the MacBook) | spikes/p4-click-model/findings.txt §4, §5; lc2-steps.txt Results | A real-typing run (the owner's hands, a HID-level poster, or cua once it composes) passes L1 to L7 on ARMED
- 2026-10-21 | P4-B2 (deferred) | The deck's threads rail keeps its own card, not X36's ThreadCard (it shares only the drafts map) | this plan D16; ThreadCard.tsx's fixed orphan note | The rail draws ThreadCard with an orphan note and a Show action
- 2026-10-21 | P4-B3's carry (or the next view-carry change) | Moving a deck between the panel and a main tab drops its reply drafts, as it does for documents (view-carry.ts carries none) | tools/document/view-carry.ts | A move carries the editor's reply drafts
- 2026-10-21 | The host's egress | No Settings view lists the declared egress rules | this plan D19 | Settings shows the host's egress rules
- 2026-10-21 | P4-B2 (the gesture hold) | A re-assert a composition put off (the composition outliving drag A's drop) joins drag B's undo step when the composition ends during B, so undoing B undoes it too | M6's review (logged); session.ts `hold()` | A put-off re-assert keeps its own undo step
- 2026-10-21 | X29 (with P4-B2) | The host's Google Fonts write is credited to the human ("You") in a deck's history, because X29 has no system actor | M7 at e2a582404; the architect's ruling (this plan's Decision Log 11) | X29 gains a host actor and the font write uses it

The milestones' hand-backs proposed more rows. These still stand at M8's gates (4974ab394):

- 2026-10-21 | P4-B2 (deferred) or the decks round | The design's board list shows no open-comment count per board, where the deck's filmstrip does (V10) | D16 ("optionally BoardList.tsx"); Filmstrip.tsx's badge; M5 | BoardList's row badges and names a board's open threads
- 2026-10-21 | The decks round | ⌥⌘⇧J hides and shows the pins only while the keyboard is in the comment frame (the stage or the popover), with no visible toggle or menu item | CommentFrame.tsx `commentKeys`; M5 | The key, or a toolbar or View item, reaches the pins from anywhere in the editor
- 2026-10-21 | A wave on the editors | The deck's and the design's comment frames are not compiled by the React Compiler: the surface's overlay is called in render with closures that read the frame's ref, as on master | the compiler's CompileError "Cannot access refs during render" for CommentFrame and DesignCommentFrame; M5 | The frames compile and join test/react-compiler.test.ts
- 2026-10-21 | The decks round | The pin popover's stacking against the narrow panel's rail sheet, and the panel's own Escape around the popover, are unverified. The popover's e2e case runs the panel at its widest, with no rail | e2e/presentations-comments.spec.ts's pin popover case; M5 | A case at the panel's default width opens the popover beside the rail sheet, or the z-order is fixed
- 2026-10-21 | P4-B2 (deferred) | A design pin kept apart after its popover closed stays apart if its pin goes and comes back before any focus change | design/editor/comments.tsx `WorldPins` kept; M5 | The kept pin is released when its pin is no longer drawn
- 2026-10-21 | The host's egress (P4-B2 deferred) | A CSS2 request with axes beyond `wght` and `ital` (opsz, wdth, custom) is untested against live answers, and a block whose font-stretch is not normal is refused as unreadable | src/artifacts/slides/google-faces.ts `parseCss2`; the grounding probed wght and ital only; M7 | A live probe of an opsz or wdth family records its unsliced answer, and the parser either reads it or names it
- 2026-10-21 | The decks surface | Theme ▸ Faces shows a pending face with no last failure and no retry-now action | Theme.tsx `DeckFaces`; the host keeps the reason in memory only; M7 | The panel shows why a face is pending and can ask the host to retry
- 2026-10-21 | The architect (the decks round) | A real unhandled ⌘Z in an inspector field, through `edit.undo` and back native, is unverified on the real Mac. The e2e drives the menu item by its id, since Playwright's keys never reach the menu | e2e/presentations.spec.ts "Edit ▸ Undo and Redo"; M2 | A live check on the Mac shows ⌘Z in an inspector field undoing the field's typing, and ⌘Z on the stage still undoing the deck
- 2026-10-21 | The owner | The deck's chrome (the filmstrip's thumbnails, the toolbar's buttons) answers ⌘Z through `onKeyDown`, but the menu's Undo stays native there. D10 claims only the stage, the text box and the notes | src/artifacts/slides/editor/edit-claim.ts; M2 | The owner rules whether the menu follows `onKeyDown`'s wider scope
- 2026-10-21 | The architect | While a native Save or Open panel is key, ⌘Z may reach `edit.undo` and run in the page behind it instead of the panel's field; Select All's app item shares this | `getFocusedWebContents` reads the page window's first responder, not whether the window is key; untested; M2 | A live check with a Save panel open shows ⌘Z undoing the filename field, or the item checks for a key panel
- 2026-10-21 | P3-A's owner (the presentations scale gate) | The scale gate's publish-one-slide row read 50.04 ms against its 50 (median, load 3.04, run 39678714241). The host's publish path is A's, and so is its margin: master's own runs read 47.09 and 47.31 with single trials at 51.2 and 52.1, and this branch's later runs read 46.18 and 47.99 | this plan's Progress (D17's floor, the first readings) | The row holds under 50 with a margin at the load rule's loads, or its bound is re-read

These closed by their own criteria before or at M8:
- M2: K6's e2e case had not run. It passes, last in run 39694759772.
- M2: the IME spec's Q3 expected the old Edit › Undo. M3 asserts the deck's step through `edit.undo`.
- M5: no compiled artifacts-dom project. P4-R9 added `artifacts-dom-compiled` on master (6d4821ff9), and every class 1a above runs it.
- M7: the Google Fonts e2e case had not run on a Mac. It passes, last in run 39694759772.
- M0: the class-1 drag case's timing bound with no quiet admission. Decision Log 15 makes it measured-only.
- M0: the probe's paint ends at the next animation-frame callback, not at the frame on screen. The split's readings make it moot: the remainder over 16 ms is queue (13 to 17 ms in the controls too), not paint.

## Approval ask (what the architect should see before implementation)

- The milestone outline above (M0 to M8) and the staffing: the executor on M1 and M3; sub-workers on M0's measurement, M2, M4, M5, M6 and M7.
- The departures in the Decision Log, items 1, 4, 5 and 6, and the egress line for the charter.
- The Mac runs: M0's two measured runs early; M3's functional groups; M6's measured A/B/A/B with the posture go.

## Outcomes & Retrospective

Written at M8, with the head at 4974ab394 (master bb5550529 merged in). Class 1a is green there (run 39694322144). So are the Mac's runs 39694759772 (`e2e:presentations`, `e2e:design`), 39694921482 (`e2e:settings`, `e2e:default`) and 39697010247 (`e2e:presentations-drag`, measured and alone).

Evidence per acceptance clause:

1. The IME verdict, "intact under simulation, the real input method unverified", is in `spikes/p4-click-model/findings.txt` §5, and its residue row is the first above. T10 is replace (Decision Log 10), the owner's choice after Canva's reading. The L1 to L7 slot, booked after cua's hold 2b, can close that row: cua's engine probe passed the r-then-k gate on the mini (Decision Log 16).
2. P1 to P12, K1 to K5 and the ⌘- and Ctrl-press case (T21, M8's fix) are in `src/artifacts/slides/editor/transform/selection.dom.test.tsx`, `transform.dom.test.tsx` and `src/artifacts/slides/editor/TextBox.dom.test.tsx`. Both artifacts DOM projects run them, compiled and uncompiled, in class 1a. K6 has three proofs: `src/main/menu-roles.test.ts`, `src/renderer/src/keymap/edit-claimants.test.tsx`, and the e2e "Edit ▸ Undo and Redo" in run 39694759772.
3. `e2e/presentations-ime.spec.ts` covers I1 to I5 as simulations, I2 replaying the synthetic trace. The composition-hold steps poll `PortProvider.counts()` and the seam's `frames()` (row 256). It runs in `e2e:presentations`, run 39694759772.
4. In run 39694759772, `e2e/presentations.spec.ts` passes the grouped-heading, table-cell and single-click cases, and `e2e/design.spec.ts` passes T22's board activation.
5. V1 to V15 are in `src/artifacts/comments/ThreadPopover.dom.test.tsx`, `src/artifacts/slides/editor/comments/pin-popover.dom.test.tsx` and `src/artifacts/comments/pin-clusters.test.ts`, with the filmstrip and presenter cases, in class 1a. The popover cases in `e2e/presentations-comments.spec.ts` and the pan-and-cluster case in `e2e/design-comments.spec.ts` pass in run 39694759772.
6. The drag clause, from run 39697010247 (record in `docs/doperpowers/evidence/p4-b2/presentations-drag-39697010247.json`):
   - The host-faithful drag's p95 is 18.7 ms against 24, with the hold, at load 4.19.
   - The 16 ms target is recorded not met: the control's best is 18.8. The remainder is attributed to queue, since Chromium dispatches continuous pointer events aligned to the frame (15.4 to 16.6 ms of the p95 with or without the agent). The architect accepted that reading.
   - The hold buffers: 6 frames released in every agent trial, none in a control.
   - Row 212's seam drives the host's `artifact_publish` with the fidelity regression (D17, Decision Log 17). It was first green with evidence in run 39681336919, and the class-1 case passes in run 39694759772.
7. The no-network case in `e2e/presentations-export.spec.ts` passes in run 39694759772. Lora is fetched once and drawn in the editor, the presenter and the three exports; the PDF's face is read from its font descriptor, Skia's Type 3 font carrying no `/BaseFont`. Roboto Slab is refused by name. The fetch is unit-tested in `src/artifacts/slides/google-faces.test.ts` and `src/engine-host/presentations/google-faces.test.ts`, and the egress rule in `src/engine-host/egress.test.ts`.
8. A1 to A5 are in `src/artifacts/slides/editor/a11y.dom.test.tsx`, in class 1a. The live VoiceOver run is routed to the decks round by a dated line, the architect's at landing (M4's text is in the hand-back).
9. `src/artifacts/slides/editor/Inspector.dom.test.tsx`'s "P4-B2 (D13)" covers the inspector's settle at every gesture's end and its whole pixels (row 280). F6 and ⇧F6 carry a middle element's selection to the inspector (D14, row 253).

What remains:
- The L1 to L7 slot on the mini after cua's hold 2b, on the architect's go.
- The residue rows above.
- The landing's records, all the architect's: the rulings, the ledger rows (X27, X23, X36's consumer and placement, the egress module, the shared files), the charter's R-8 egress line, `presentations-drag` in `MEASURED_E2E` (already on this branch's gate.yml), and the tracker rows.

Lessons:
- **Prove a mechanism by what only it moves.** A measured case passed on "the cap fired", which the cap does over an empty buffer too. Its assertion now reads a count only a held frame moves.
- **Measure the split before building levers.** D17 measured the drag first, and the measurement moved the work: queue, not handler or paint, was most of the p95. So the per-frame levers the plan held in reserve were never built.
- **Gate the instrument before the cases.** L0's r-then-k gate caught the relay route's keys bypassing the input method before any case was judged. It then passed for cua's engine probe.
- **Check every modifier that reroutes a press.** T3 checked Shift's toggle but not ⌘'s and Ctrl's deep select, and only a reviewer's state-machine lens caught it.
