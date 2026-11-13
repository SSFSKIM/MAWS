# UX wave · U12, first landing (U12a): the in-app browser as the agent's browser, device sizes, and computer use in the session

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U12, first landing (**U12a**). **Parent pin:** `510a6d15e`, the head of branch `ux-wave-spec` that carries the owner's three answers of 2026-11-12 and the deferral of the Drive item in the child's file.
>
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U12-browser-computer-use-delivery.md`, cited below as *section* (its acceptance items as A1 to A9, its items by their register ids, its probes as probe 1 to probe 6). This document carries the constraints, the milestones and the interfaces, and nothing of the design. Until the spec's corrections are on master, the root and the section are read on branch `ux-wave-spec`.
>
> **Branch:** `ux-wave/U12a`. **Board:** #584, under epic #573. **Items:** l9-browser-delivery-01 (with the agent's tab, A9), l9-browser-delivery-02, l9-browser-delivery-06, l9-browser-delivery-07. **Not in this landing:** #435, a pane the agent opens appearing on the device that sent the turn, which is a later landing after U9's ("The landing's edge" says what is left for it). l9-browser-delivery-09 (Send to Drive) was deferred out of the wave by the owner on 2026-11-12; Drive delivery is board ticket #400.

## Purpose

Today an agent asked to open a page "in the app's browser" and test it opens the page with MAWS's pane tool, tests it somewhere else, and asks the person to click. When it shows a page it has just fixed, the Browser keeps the old page until the person reloads. When the Browser opens by itself because the agent started working in a page, it shows whatever tab was selected before and not the agent's. While an agent drives the Mac through computer use, nothing in the session says so and the row of the call reads the plugin's id. The Browser has no device size and no way to copy what it shows.

After this landing a session MAWS launches with its browser is told, in MAWS's own words, that the Browser pane is its browser. `show_pane` on a page already open reloads it, unless the person is using that tab, and tells the agent which happened. The Browser that opens by itself shows the agent's tab, unless the person is using theirs. The Browser's options menu has Viewport (Responsive, Mobile, Tablet) and Copy screenshot. While a computer-use call runs, the top of the session reads "Computer use running" with Stop; after a Stop that withdrew a running call it says that computer use may still be finishing a step, until there is evidence that it has or the person dismisses the line. The call's row reads "Used computer use", and the plugin's on-screen cursor carries the session's title. The two changes only the computer-use plugin can make leave this document as two ticket texts ("Hand-off").

**How to see it working.** In the suites: the unit tests named under each milestone, and the e2e scenes of M5. By hand on this branch's build: in a new session, ask the agent to open a local page in the app's browser and test a button, and watch it drive the Browser pane; edit the page and have the agent show it again; choose Viewport › Mobile; ask the agent to act in an app and watch the line at the top of the session.

## Progress

- [x] (2026-11-13 00:40Z) Document written against master `6e8c72738`; the section checked against the code at that head ("What the code holds today"), and the points that need a ruling listed ("Reported to the architect, and ruled").
- [x] (2026-11-13 01:15Z) Revision 2: the adversarial review's five findings and the architect's rulings on R1 to R9 are folded in, with the reload's rule for a page the person has typed in (Decision Log). No milestone was added or removed.
- [x] (2026-11-13 01:30Z) Revision 3: revision 2 is accepted with one amendment, the architect's ruling of the same day. The protection of a page the person has typed in is withdrawn; `show_pane` reloads unless the person is using the tab (Decision Log).
- [ ] Probe 1 (Stop during a running cell), which can run today on any build ("Proof that an executor does not run"); its count goes onto Ticket 2.
- [x] (2026-11-13 03:13Z) Step 0 on master (U6a and U8a both landed, master `be663d261`); constraint 11's line prints `step-0-landed`; this branch merged master at `e1c92a4dc`. The merge changed none of the files the milestones touch.
- [x] (2026-11-13 04:25Z) M1 — What the agent is told, and `show_pane` on a page already open. Commits `850c9e25b`..`e45db9b44`; reviewed clean. On the VM: `tsc` of the node and web projects, eslint of the changed paths, vitest over the touched folders and their importers (1,338 files passed; the one failure, `test/artifacts/portability.test.ts`, is on build-common's list), `pnpm test:probes` (346 passed), the maws-app scan (8 of 8). Probe 6's precondition (a build of this branch with M1) is met.
- [x] (2026-11-13 05:05Z) M2 — The agent's tab comes forward. Commits `9132ad824`..`e21655049`; reviewed clean. On the VM: `tsc` of the node and web projects, eslint of the nine changed files, vitest over the touched folders and their importers (208 files passed; the one failure, `src/shared/machine/git-reads.test.ts`, is on build-common's list). The e2e scene of `browser-cua.spec.ts` that M5 reworks asserts the old behaviour until then.
- [x] (2026-11-13 06:20Z) M3 — Device sizes and Copy screenshot. Commits `2f6f45281`..`3e6bff9a5`; reviewed clean. On the VM: `tsc` of the web and node projects, eslint of the thirty changed files, vitest over the touched folders and their importers (286 files passed, 2 skipped; 4,144 tests, 49 skipped as macOS-guarded). `unit:darwin` passed after it (proof table). Open until M5's scenes and the owner's sitting: the view's real size and `innerWidth`, the agent's override reset, and the screenshot pasting as an image.
- [x] (2026-11-13 08:10Z) M4 — Computer use in the session. Commits `bccada3e3`..`75b3a4609`, review fix `f80c764b2`..`cac28dc4b` (a dropped queued prompt is no turn the engine took); reviewed clean. On the VM: the full `pnpm typecheck`, eslint of the changed files, vitest over the touched folders and their importers (429 files passed, 3 skipped), and after the fix `src/renderer/src/computer-use`, `session` and `transcript/model` (76 files passed, 1 skipped). The hands-on check of the cursor's label can run now.
- [x] (2026-11-13 08:24Z) M5 — The e2e scenes, the record, and the acceptance run. Commits `556208412`..`09ed42e96`, review fixes `d91a43b8f` and `e7b4c7f79` (the copy-screenshot scene restores the person's clipboard when an assertion fails, reads its image without waiting for the notice, and its cleanup cannot hide the first failure); reviewed clean. The acceptance run on the VM (Concrete Steps 5): the whole unit suite at `77bfcba2c` (2,524 files: 2,492 passed, 26 skipped, 6 failed, exactly build-common's list; 1,480 s); at `09ed42e96` the full `pnpm typecheck` (node, web, e2e and the three workspace packages) exit 0, `pnpm lint` exit 0, `pnpm test:probes` 346 passed and 1 skipped, the maws-app scan 8 of 8; the `git diff origin/master...HEAD --stat` over the delivery folders, `keymap/actions.ts`, `permissions.ts`, `persist.ts` and `cua/connection.ts` prints nothing; at `d91a43b8f` e2e `tsc` and eslint exit 0. Master `c0e7b2ae8` (U10a's landing, the spec's batches 5 and 6, `ci-gate --peer-exact`) merged at `41a095e99`, the tracker keeping both landings' rows; after it, on the VM, the full `pnpm typecheck` exit 0, `pnpm lint` exit 0, and vitest over this landing's folders (452 files: 449 passed, 3 skipped; 7,015 tests: 6,961 passed, 54 skipped). No scene has run: Electron e2e is the architect's.
- [x] (2026-11-13) The branch review's fix wave (the xhigh panel's seven findings as ruled, and the three scene faults of the first Mac run, 43393240279): commits `9265acbf0` (failing-first tests, 31 failed), `cb181f6a6`, `677a74208`, `c015f1c6e` (scenes), `70ad30f89` (item 3 as ruled); task-reviewed clean. On the VM: `tsc` of web and node, eslint of the changed files, vitest over `computer-use`, `tools/browser`, `main/browser`, `shared/ipc` and their importers (4,000 passed, 49 skipped; the one failure, `Sidebar.test.tsx`, is on build-common's list and passed alone), `computer-use` again at `70ad30f89` (85 passed), e2e `tsc` and eslint at `c015f1c6e`. The scenes to run again: "U12a (device sizes" (`e2e:browser`), `e2e/computer-use.spec.ts` (`e2e:default`), the A9 scene (`e2e:browser-cua`).
- [ ] The proof an executor does not run (the hand-over, at the head `41a095e99`; each line's precondition is met unless it says otherwise):
  - `unit:darwin`: passed after M3 at `1d540e733` (run 43370236296, affected paths, `cua/retained.test.ts` among them); again on the final head with the landing's gate.
  - Probe 4, the *(device sizes)* scene of `e2e/browser.spec.ts` alone (`U12a (device sizes`): can start. It grows the window so the panel's page box is at least 812 points tall and fails naming the display if it cannot.
  - The other new and reworked scenes alone: `U12a (reload` and `U12a (copy screenshot` in `e2e/browser.spec.ts` (the second needs the Mac's pasteboard under the clipboard lock), the reworked `the Browser panel follows the agent (A9)` in `e2e/browser-cua.spec.ts`, and the three scenes of the new `e2e/computer-use.spec.ts`; then the groups `e2e:browser`, `e2e:browser-cua`, `e2e:browser-chrome`, `e2e:browser-comment`, `e2e:tools`, `e2e:agents`, `e2e:deliverables`, `e2e:transcript`, `e2e:render-host`, `e2e:remote`, `e2e:default` (which collects `computer-use.spec.ts`): can start. The places a first run is most likely to trip are listed in M5's report: the seam's typing into the marker page's field, the comment strip's height against the room's loss, a single `js` call's row drawn on its own, the approval card for a plugin's `can_use_tool`, and the options menu covering a centred page.
  - Probe 1 (Stop during a running cell): could start at any time; unchanged.
  - Probe 6 (did the agent find the browser): can start since M1.
  - The cursor's label by hand: can start since M4.
  - The branch review (the xhigh panel over `origin/master...ux-wave/U12a`): can start.
  - Class 1a: after the review's fixes, on the head the pull request carries.
- [x] (2026-11-13 03:13Z) The two tickets filed on the computer-use plugin's board by the architect: Ticket 1 is `SSFSKIM/cua#368`, Ticket 2 is `SSFSKIM/cua#369`.
- [ ] The pull request, opened on the architect's word.

## The landing's edge

**In.** l9-browser-delivery-01: the paragraph of instructions for a session with a browser backend, the `note` in `show_pane`'s browser answer, and the agent's tab coming forward (A1, A9). l9-browser-delivery-02: the reload, its three outcomes and the changed description (A2). l9-browser-delivery-06: the Viewport submenu, the chip, the sized page, Copy screenshot; site permissions stay as they are (A3, A4). l9-browser-delivery-07: the strip with Stop, the row's title, the cursor's label at launch (A6). The `keep` checks of A8. The e2e scenes for these, and the dated lines of the two records this landing amends (X9; row A-54 of the P1 spec's Decision log), and the rows this landing adds to the debt tracker.

**Out.** Everything the section lists under "Not in this child" (the browser's comment items are U5's; localhost links and "Open in" are U6's; how tool runs are grouped is U2's). Scaled or custom sizes, touch and user-agent emulation, a full-page capture, a site-permission prompt. The app's name anywhere in the strip, a sidebar mark, stopping a cell that is already running (Ticket 2). Any change to the keymap table. The register and the board, which the architect updates at landing.

**Deferred by the owner.** l9-browser-delivery-09 (Send to Drive makes a Google Doc or Slides file; the sheet's one-line sign-in states) was deferred out of the wave by the owner on 2026-11-12, and Drive delivery is board ticket #400 (#603 was closed as its duplicate); this landing touches nothing under `src/services/delivery/` or `src/renderer/src/delivery/`.

**Left for #435's landing** (after U9's; A5 and probe 5 are its):
- the two device marks the engine host keeps per session (`src/engine-host/ops.ts`, `session-maws.ts`), and the rule for which device is asked;
- the one-shot request on the client port with a capability of its own (`src/endpoint/client-port.ts`, `src/main/lane-b/remote-port.ts`), and `maws.pane.answer` leaving `REMOTE_UNAVAILABLE` (U9's row);
- the refusal where the request fans out, in place of the engine host's `hasClient`, which this landing leaves as it is;
- the `note` for a pane shown on another device ("Shown in the user's MAWS on another device, …") and the refusal for a loopback page that cannot be forwarded, with their own dated line under X9, and the dated line under P5 §6 "Pane display"; that landing must tell the page's device from the session's own browser by what was asked and answered, not by the launch having a backend;
- the reload on the device: this landing's `reload` flag and `page` answer (Interfaces §B) are what that landing sends through a forwarded open;
- probe 5 (`e2e/remote.spec.ts`, each of the seven panes) and A5's scenes.

The Browser opening by itself on another device stays under the section's "Waiting".

## Words used here

- **The computer-use plugin** (in code and in its own documents: cua): a Claude Code plugin whose MCP server `cua_repl` gives the agent a tool named `js`. A **cell** is the JavaScript of one `js` call; it runs in a REPL that keeps its handles between calls. In the engine's output the tool is `mcp__plugin_cua_cua_repl__js` or `mcp__cua_repl__js` (`CUA_JS_TOOLS`, `src/renderer/src/transcript/model/classify.ts`).
- **The in-app browser:** MAWS's Browser side surface, a native view per tab laid over a pane of the window (`src/main/browser/`, `src/renderer/src/tools/browser/`). A session's **browser backend** is the Unix socket MAWS gives the session's engine in the settings environment as `CUA_BROWSER_BACKENDS` (`extraSettingsOf`, `src/services/sessions/launch-mapping.ts`); through it the plugin's `cua.getBrowser()` with no id is that session's in-app browser.
- **A lease:** the agent's hold on one browser tab between the plugin's `debugger.attach` and its detach (`src/main/browser/cua/connection.ts`). An **acting command** is one that changes the page (a navigation, an input), as `commandClass` in `cua/filter.ts` classes it; a read is not.
- **The engine host:** the process that launches the engine and serves the `maws` MCP server to it (`src/engine-host/`). The **pane bridge** is how `show_pane` asks a window to open a pane and waits for its answer (`src/engine-host/tool-server/panes.ts`; the window's side is `src/renderer/src/tools/maws/panes/connect.ts`).
- **The person uses a tab:** the tab reads "You have the page" (its `control` is `human`), or the person's last input in it was within three seconds. Interfaces §C gives the function; it is not today's `personHolds` (R1).
- **The Browser opens by itself:** a window opens the shown session's Browser tool because the agent started acting in a tab, which it does once in a turn and only when that session's panel has no Browser tool open (`connectBrowserAgent`, `src/renderer/src/tools/browser/agent/connect.ts`).
- **The daemon's tab engine:** the headless browser `mawsd` runs for a session with no app attached (`src/render-host/tab-engine.ts`); it shares `src/main/browser/cua/` with the app.
- **Build F:** commit `f1852de3a`, the build on the owner's machines, which may run again on the same profile and beside this build (root UC-14).
- **The VM:** the wave's build VM, reached through `~/.local/share/maws-ux-wave/tools/vmcheck.sh`; it is Linux.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the VM in a checkout of the pushed head. An executor runs no `scripts/ci-gate.sh`, starts no Electron e2e and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The `maws` texts are frozen** (charter X9; root UC-15). The strings of Interfaces §A are used exactly as written and change nothing else of the server's texts. `src/shared/maws/tools.test.ts` keeps pinning the tool list by name and order; this landing adds no tool.
3. **The engine and the plugin are not changed** (D-1; the section's first "Binds"). What only the plugin can do is the two tickets.
4. **What is stored or sent** (root UC-14). Interfaces §H is the whole list. This landing writes no key to `layout.json`, to either settings file or to `<userData>/browser/tabs.json`, adds no tab kind, and adds nothing to the machine link: no row in `OFFERS`, no capability in `ENDPOINT_CAPABILITIES`, and `RL2_PROTOCOL.minor` does not move. It adds one optional key to one command on the wire between the app and the engine host, with `WIRE_MINOR` and the two generated files (M1), and one value to the launch spec's open `extraSettings` record, which the engine host stores (M4; §H).
5. **Files other children own** (root UC-8). This landing owns `src/main/browser/`, `src/renderer/src/tools/browser/` outside `comment/`, and the new directory `src/renderer/src/computer-use/`. Its edits elsewhere are the insertions of Interfaces §J and no others, each the smallest that does the job. An executor that finds a further file of another child must change, beyond a fixture's shape, stops and reports it.
6. **Keep means keep** (law 8; A8). The acting dot, the plain activity rows and the takeover (l9-browser-delivery-04), Send to (l9-browser-delivery-10) and the browser's first open with no modal (l9-browser-delivery-11) behave as before. `src/main/browser/permissions.test.ts`, `src/renderer/src/transcript/model/browser-activity.test.ts` and `src/main/browser/cua/retained.test.ts` pass unchanged: `personHolds`, the takeover gate and what main does at an acting command are not touched, and the reload `show_pane` asks for is never read as the person's input (M1). `git diff origin/master...HEAD -- src/services/delivery src/renderer/src/delivery` prints nothing.
7. **No chord** (root UC-6). `src/shared/keymap/actions.ts` is not edited; Viewport and Copy screenshot are rows of the Browser's own options menu.
8. **Laws 3 and 7.** No setting is added. The strip, the chip and the sized page use today's tokens and shapes; light theme is the default.
9. **The repository is public** (root UC-11). Fixtures, test titles and test session titles are invented.
10. **Page text and titles are data.** A page's title or address is shown as text. The session's title in `CUA_CURSOR_LABEL` goes where the launch's settings go, and §H lists each place: the session's state file, the engine's argument list and through it the session's journal, the plugin, and a remote computer-use device the session selects. This landing adds no log line that carries it and no redaction: the journal keeps the owner-only posture it has. Any evidence that leaves the machine (an e2e artifact, a screenshot, a fixture, a journal quoted in a pull request) uses invented titles.
11. **Base.** No executor starts before master holds step 0: `git cat-file -e origin/master:src/shared/sessions/working-folder.ts && git cat-file -e origin/master:src/shared/keymap/build-f.ts && echo step-0-landed` prints `step-0-landed`. This landing consumes nothing from either; they come first because the root's ordering lands them before any other child branches. The branch takes master by merge and is never rebased or force-pushed, because reviewers pin ranges on it.
12. **Nothing gated gets worse** (root acceptance 5). What the strip reads from the transcript is memoised per turn object, as `turnSpanOf` is, so an event batch that changes no turn costs it nothing.

## What the code holds today (master `6e8c72738`)

Each statement the section rests on was read at this head. Where the code says otherwise, the point is under "Reported to the architect, and ruled" below.

**The instructions and `show_pane`.**
- `MAWS_SERVER_INSTRUCTIONS` (`src/shared/maws/instructions.ts`) is one paragraph of 699 characters. `MawsToolServer` answers it at `initialize` for every session, from a direct import (`src/engine-host/tool-server/server.ts`); the server is built in `SessionMaws`'s constructor (`src/engine-host/session-maws.ts`), which `EngineSession` builds from its options, where the launch spec is `opts.spec` (`src/engine-host/session.ts`). The spec's `extraSettings.env.CUA_BROWSER_BACKENDS` is the browser backend when the launch has one.
- `show_pane`'s description (508 characters) and `ShowPaneResultSchema`, a strict object of `status`, `pane` and `opened`, are in `src/shared/maws/tools.ts`. The result is parsed in two more places, both strict: the normalizer's `mapMawsAnswer` (`src/engine-host/normalizer-controls.ts`), which emits `maws.pane.shown` from it, and the row's label (`paneLabel`, `src/renderer/src/transcript/model/cells.ts`).
- The window's answer is `MawsPaneAnswerResultSchema` (`src/shared/ipc/schema/maws.ts`), the input of `maws.pane.answer`, a command the engine host owns and therefore an entry of the wire manifest (`src/shared/ipc/wire-manifest.json`, `commands.maws.pane.answer`). Its `{ ok: false, error }` branch is carried to the agent as the tool's error by `PaneBridge.request`. `WIRE_MINOR` is 36; build F's is 33.
- `showBrowser` (`src/renderer/src/tools/maws/panes/connect.ts`) validates the address, opens the Browser tool with `{ target, appSessionId, requestId }` and answers at once. The tab is opened by `BrowserHandle.open` (`src/renderer/src/tools/browser/BrowserTool.tsx`), which invokes `browser.tabs.open` with `reuse: 'url'` and drops the answer.
- `TabStore.open` (`src/main/browser/tabs.ts`) answers a `requestId` repeated within 10 s (`REQUEST_ID_MS`) with the first call's tab; with `reuse: 'url'` it selects the session's tab at the same normalised address and loads it only when it has no view.
- `Navigator.navigate(tabId, 'reload')` (`src/main/browser/navigation.ts`) is the one reload, and it handles a crashed tab and a failed load. Every call of `navigate` first stamps the tab's input seam with `{ kind: 'chrome', source: 'human' }`, because every caller today is the person; `TabControls.input` turns a tab the agent controls to `human` at that stamp. So the reload `show_pane` asks for cannot go through `navigate` as it is (review finding 2).
- The engine cuts a server's instructions at 4,096 characters by default (probe 3, below).

**The agent's tab.**
- `CuaConnection.acting` (`src/main/browser/cua/connection.ts`) runs at a lease's first acting command, before the takeover gate, and emits `browser.agent.acting` with the tab's id; it selects nothing, and `src/main/browser/cua/retained.test.ts` holds that.
- `connectBrowserAgent` (`src/renderer/src/tools/browser/agent/connect.ts`) opens the shown session's Browser tool once per turn when the session's panel has none (a pinned one counts), and sends no tab id.
- A session's selected tab is one value in main (`TabStore`), which every window's panel of that session follows; a main tab of kind `browser` shows its own tab whatever is selected. A tab's `placedIn` says which pane holds its view and on which surface (`panel` or `main`).
- `personHolds(entry, now)` (`src/main/browser/agent/control.ts`) is true only within three seconds of the person's last input, or of the moment the tab became theirs when no input is recorded. A tab that reads "You have the page" with its last input older than that answers false (cua #103 separated the visible ownership from the grace). R1.

**The Browser's chrome and pane.**
- `OverflowMenu` (`src/renderer/src/tools/browser/chrome/OverflowMenu.tsx`) has the nine rows the section lists; find and zoom are enabled only while the tab is live and this chrome's pane holds the view. Copy URL confirms with `urlCopied`, a notice kind of the chrome's own (`ChromeNoticeKind`, `tools/browser/store.ts`).
- `PlacedPane` (`tools/browser/Pane.tsx`) is a column: the page element (`[data-browser-pane]`, what the placement measures) over the comment card's strip, beside the floating card's reserved column. The view's bounds follow the element through `browser.view.place`.
- One tab can be mounted twice, in a main tab and in the panel, each a `BrowserView` with its own chrome and pane, at different sizes; only one pane holds the view and the other draws "Shown in another pane". `BrowserView` already keeps, per mount, whether its pane holds the view (`owns`, told by the pane through `onOwns`).
- `captureTabView` (`src/main/browser/capture.ts`) lets only the window the tab is placed in take a still, and encodes it under the comment crop's caps (the longer edge at most 1,568 pixels).
- `BrowserTabSchema` (`src/shared/browser/tab.ts`) is strict and crosses only between main and the windows of one build. `PersistedTabSchema` (`src/main/browser/persist.ts`) picks ten named fields from it, so a field added to the tab does not reach `tabs.json`. A tab no pane shows is parked at 1280 × 800.
- A lease's letting go clears a device-metrics override the agent set and waits until the page reads its view's size (`undoCommands`, `readsViewSize`, `viewSizeRead`), reading the view's bounds at each poll.

**Computer use.**
- `cellLabel`'s `generic` case (`src/renderer/src/transcript/model/copy.ts`) titles any MCP call `Used <server> · <tool>`. No test, snapshot or fixture pins that title for the two `js` names.
- `turnSpansOf` (`transcript/model/browser-activity.ts`) reads a turn's own events only. A subagent's events are in the turn's `children` map (`transcript/model/reduce.ts`), so a subagent's `js` call is found there and not in the spans.
- The transcript store keeps, per key, whether the process behind it is live (`live`, `ticks`; `src/renderer/src/stores/transcript.ts`), and the key of a session's main transcript is its app session id on every route. A terminal session's file can leave a turn open that nothing ends, which is why `TranscriptSlot` draws such turns closed while the controls port says no turn runs (`controls.turn()`).
- A permission request's attention item carries the call's tool-use id on both routes (`shapeOf` in `src/engine-host/broker.ts`; `laneAEntryOf` in `src/shared/lane-a/attention-entry.ts`). An MCP elicitation's item carries none.
- A call withdrawn by an interrupt gets, on the live wire, an error `tool.result` whose `denial` is `user-rejected`, and then the engine's interruption marker as a user row (the recorded `pass3/p1-maws-ask-interrupt` shows both after an interrupt during an MCP call). Rows read from a transcript file carry no denial (`src/engine-host/fs/backfill.ts` writes `denial: null`), so on a terminal session the marker is the evidence; `wasInterrupted` in `transcript/model/reduce.ts` reads either.
- The composer's Stop is `controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })` (`src/renderer/src/composer/Composer.tsx`). For a session on another machine the same call goes through `laneBControls`, `session.interrupt` is an offered act, and `useRemoteUnavailable(appSessionId, 'session.interrupt')` answers null while it can work and a sentence when it cannot.
- A session MAWS runs has a status that lists the engine's MCP servers with their state (`mcpServers`, `src/shared/engine/status.ts`).
- `extraSettingsOf` sets `CUA_BROWSER_BACKENDS` and nothing else of the plugin's. A setup intent has no title; a record's is `title: { text, source }` with source `none` when it has none. The launch spec's `extraSettings` is an open record; the engine host keeps the spec in the session's state file (`saveLaunchSpec`, `src/engine-host/store/file-session-state-store.ts`) and writes the engine's whole argument list, the `--settings` JSON with its values included, into the session's journal (`spawnMeta`, `src/engine-host/launch.ts`).
- The plugin, read at its `main` (`9020bb18`; the repository is `SSFSKIM/cua`):
  - it reads `CUA_CURSOR_LABEL` when the engine starts, removes control characters and cuts it to 24 characters with an ellipsis (`src/runtime/cursor-identity.mjs`), and sends the resolved label to a remote device the session selects, in that device session's `initialize` as `cua/cursor` (`src/remote/client.mjs`);
  - a cancelled call never stops its cell (`src/repl-host/supervisor.mjs`: "running + cancellation: nothing is stopped; the eventual result still settles");
  - a call's `timeout_ms` is a budget, not a wall-clock deadline: it is suspended around approvals and a helper's start and resumes with what was left (`executionBudget`, `src/repl-host/budget.mjs`; `elicit` in `supervisor.mjs`);
  - calls run one after another (`enqueue` in `supervisor.mjs`), so a later call's result means the earlier cell is over;
  - the server's other tools are `js_reset`, which resets the REPL, and `end_task`, which returns once nothing runs.

**Probe 3, done by reading: how long may the server instructions be?** In the 2.1.322 bundle (`cli.pretty.js`) the cap is `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`, else 4,096 (`nPr`), in the function that answers both (`MB`, with 16,384 for its other argument). An SDK-hosted server's instructions pass through `ii(instructions, name)`, which cuts at that number and appends "… [truncated]"; MAWS sets no such variable. This landing's paragraph is 343 characters and joins the first with a blank line, so a session with a browser backend is given 1,044 characters: 345 added, inside the wave's own bound of 2,048 with 1,004 to spare for U6's sentence. **The outcome that holds: the paragraph stays in the instructions**, and the fallback of moving it into `show_pane`'s description is not used.

**Tests that pin today's behaviour and change.** The section's list, corrected against the code:
- as the section names: `src/shared/maws/tools.test.ts` (`show_pane`'s description, word for word), `src/engine-host/session-maws.test.ts` and `src/engine-host/tool-server/server.test.ts` (the `initialize` answer), `src/main/browser/tabs.test.ts` (reuse by address), `src/renderer/src/tools/maws/panes/connect.test.ts` (the params the Browser tool is opened with, and the answer), `src/renderer/src/transcript/model/copy.test.ts` (a new case; the generic title stays pinned for other tools);
- `src/shared/maws/search-tools.test.ts`: the first paragraph's word-for-word test stays as it is; the test of the probe's snapshot changes only through the snapshot (M1);
- `src/renderer/src/tools/browser/agent/connect.test.ts`: the section lists it as passing unchanged, and it cannot. The window now asks main for the agent's tab before it opens the tool, so each case awaits that answer, and its first case's meaning is reversed (M2);
- not named by the section: `e2e/browser-cua.spec.ts` (the scene "the Browser panel follows the agent …"), `src/main/browser/navigation.test.ts` (new cases), `src/renderer/src/tools/browser/chrome/chrome.test.tsx` (two exact lists of the menu's disabled items), `src/services/sessions/launch-mapping.test.ts` (the exact `extraSettings` of a resume), `src/main/catalog/agents.test.ts` (the list of texts MAWS gives the model), `src/shared/ipc/schema.test.ts` (`browser.tabs.open`'s input), `src/shared/ipc/wire.test.ts` and `wire-fingerprint.test.ts` (through the generated files), and the fixtures that build a whole `BrowserTab` (`src/renderer/src/test-support/browser.ts` and the tests that build a whole tab);
- named by the section and not changed by this landing: `src/renderer/src/tools/browser/BrowserTool.test.tsx` (the window makes `show_pane`'s open itself, so `BrowserHandle.open` keeps its behaviour and that file is the pin that a link reloads nothing), and `test/lane-b/offer-coverage.test.ts` (it changes with #435; the three commands this landing adds name a tab and no session, so the audit does not count them);
- unchanged on purpose: `src/main/browser/cua/retained.test.ts`, whose case "… the tab stays unselected" now holds the ruling on R2 (main selects nothing at an acting command).

**E2e specs that cross the code this landing touches.** `e2e/browser.spec.ts` (`show_pane` for one request from two windows; the cover; placement; the floating card's column; Mark up; the page's guards), `e2e/browser-cua.spec.ts` (a fake plugin host through the socket; the app as a tab engine; the panel following the agent), `e2e/browser-chrome.spec.ts` and `e2e/browser-comment.spec.ts` (the options menu by item name; the comment dock), `e2e/maws-tools.spec.ts`, `e2e/agent-tools.spec.ts` and `e2e/deliverables.spec.ts` (`show_pane`'s result for the other panes, which keeps its shape), `e2e/remote.spec.ts` and `e2e/render-host.spec.ts` (the session pane and the Browser of a session on another machine; the daemon's tab engine).

## Reported to the architect, and ruled

Nine points were reported at authoring, each a place where the code contradicts the section or where a decision would change what the owner sees or what a contract says. The architect ruled on each on 2026-11-13, after the adversarial review; the Decision Log has each ruling with what it rejected. The milestones are written at the rulings.

| | the point | the ruling | where it is built |
|---|---|---|---|
| R1 | `personHolds` is not the rule the section and the owner's answer state: it has no "or it reads 'You have the page'" (`control.ts`, since cua #103). | A second predicate, `personUses`: the tab's control is `human`, or `personHolds`. `personHolds` is not changed. | §C; M1 |
| R2 | The section's mechanism for the agent's tab, main selecting at every lease's first acting command, reaches further than what the owner was asked. | Narrowed to the question on the owner's card. The agent's tab is selected only together with an actual opening of the Browser by itself, unless the person uses the selected tab; at most once in a turn; no later lease selects; a Browser that is already open is never moved. Main selects nothing at an acting command. | §C; M2 |
| R3 | Probe 1 can be answered by reading: the plugin's host never stops a cancelled cell. | "The cell goes on" is built, with no deadline: review finding 1 showed that the call's `timeout_ms` is not a time the window can count. | §E; M4 |
| R4 | Stop on the strip for a session on another machine: the section says absent where it cannot interrupt; root UC-7 says disabled with one sentence. | Replaced by review finding 3. A session on another machine is not by itself unable to stop: the button is enabled or disabled from the helper's sentence and the port's interrupt capability. | §E; M4 |
| R5 | The chip: A3's "returns to Responsive in one click" against "opens the same three choices". | The chip opens the three choices. | M3 |
| R6 | UC-8 does not name `src/engine-host/tool-server/server.ts`, which the paragraph's gate must touch; `ops.ts`, which it names, is #435's. | The insertion stands; the architect adds it to UC-8. | §J |
| R7 | Where X9's dated line is written. | The P1 spec's row and the charter's X9 paragraph, plus an entry in the charter's §19; the session that keeps master checks the charter's lines at the pull request. | M5 |
| R8 | The `note` in a session launched without a browser backend. | Gated like the paragraph: such a session gets `page` and no `note`. | §A; M1 |
| R9 | A `browser.tabs.open` that main refuses. | Reversed from this document's first default: it is answered as a refusal, through the `{ ok: false, error }` branch that exists, and nothing is opened. Answering "shown" would tell the agent its page is there. | §A; M1 |

**The limit of the reload's protection** (the architect's ruling of 2026-11-13, on revision 2). A reload by the agent discards what was typed in the page, as any reload does, and the only protection is `personUses`: a tab the person gave input within the last three seconds, or one that reads "You have the page", is kept. A page the person typed in earlier and has left is reloaded like any other. That is the item's own main case, a person who tested a page and asked for a fix, and A2's first sentence must hold there. Revision 2 kept such a page on a conditional ruling (main can tell a person's key in a page cheaply); the ruling was withdrawn for that reason, and because an agent told the page was kept would reload it through the plugin anyway. A2's second sentence, a tab kept while the person is typing in it, is `personUses` and stands as written.

**Where the section's words now differ.** The architect corrects the section; until then this document holds for these places, each by a ruling above.
- l9-browser-delivery-01, "The agent's tab": it names `personHolds` as the rule (it is `personUses`) and has main select at a lease's first acting command (the window asks at its own opening; main selects nothing at an acting command). A9's "or showing a tab the person is not using" is not built.
- "Advice", the tests: `agent/connect.test.ts` is listed as passing unchanged and changes; `cua/retained.test.ts` is the file that passes unchanged; `BrowserTool.test.tsx` and `offer-coverage.test.ts` are listed as changing and do not.
- l9-browser-delivery-02: the rule's table names `personHolds` (it is `personUses`; the four rows stand). "`note` is present for the browser pane" holds only with a browser backend. One refusal text is added, for a page MAWS could not open. A2 stands as written.
- l9-browser-delivery-07: the strip is not derived from `turnSpansOf` (its own reading covers subagents). It does not always leave at once when the turn ends: after a withdrawn call it lingers. Probe 1's "until the call's own deadline (`timeout_ms` in the call's input)" is replaced by evidence or Dismiss. A6's "absent where it cannot" is: disabled with its sentence where the helper or the port gives one, absent only without a controls port. "The cursor": the label is also kept in the session's state file and journal.
- l9-browser-delivery-06 and A3: the chip opens the three choices; "returns to Responsive in one click" is not built.
- "Contracts", UC-8: `src/engine-host/tool-server/server.ts` is an insertion; `ops.ts` is not touched by this landing.
- "Rulings reversed", X9's sentence: this landing's line names the refusal for a page MAWS could not open, and not the loopback refusal.
- "Probes and checks", probe 3: the paragraph is 343 characters, not about 370.
- The two ticket texts: the final ones are under "Hand-off".
- The Drive sentences: the ticket is #400.

Smaller things the section does not word, decided here and listed for the architect's eye:
- **Two notice lines.** Copy screenshot confirms with `Screenshot copied to clipboard`, beside Copy URL's "URL copied to clipboard"; when nothing could be captured the chrome says `Couldn’t copy a screenshot of this page` as a warning line (Copy URL's failure is silent today).
- **Texts beyond the section's.** One under X9: the refusal for a page MAWS could not open (R9; §A). One on the strip: `Dismiss` on the lingering line (§G).
- **A device size applies where a pane holds the tab's view.** A tab no pane shows keeps its parked size, so A3's sentence on the agent's screenshot holds for a tab on screen. And the chip reads the view's real size, so in a pane under 812 points tall Mobile reads `375 × <the pane's height>`; A3's `375 × 812` needs a pane that tall.
- **A plugin approval raised as an MCP form mid-call does not hide the strip.** Its attention item carries no tool-use id, so it cannot be tied to the call. The section expects such approvals to be answered inside the engine.
- **The strip appears 250 ms after a call starts.** A permission request reaches the window by another channel than the call's row, and without the wait every call that asks first would flash the strip.
- **The session's selected tab is one value for every window.** A window cannot keep its own. So that another window's Browser is not moved by this window's opening, main leaves the selection alone while any panel is showing the selected tab; the window that opens by itself then opens on that tab (§C).

## Plan of Work

Five milestones. M1 produces the predicate M2 reads; M3 and M4 are independent of both and of each other; M5 writes the e2e scenes and the record once the behaviour exists. Each leaves the tree green on the VM (typecheck, lint of the changed paths, the whole unit suite) and is reviewed at its boundary before the next starts. The exact texts, shapes and tables are in Interfaces and Dependencies; a milestone points at them.

### M1 — What the agent is told, and `show_pane` on a page already open

**What exists at its end.** A session launched with a browser backend is given two paragraphs of instructions by the `maws` server, and a session without one is given the first alone (A1's test that fails before). `show_pane` with the browser pane and an address already open in the session reloads that tab, unless the person is using it, and its answer says `"page":"opened"`, `"reloaded"` or `"kept"` with a `note`; a page MAWS could not open is answered as a refusal; a link, the address bar and the person's own opens reload nothing (A2).

**What it touches.** `src/shared/maws/instructions.ts`, `src/shared/maws/tools.ts`, `src/shared/browser/tab.ts`, `src/shared/ipc/schema/maws.ts`, `src/shared/ipc/schema/browser.ts`, `src/shared/ipc/wire.ts` with the two generated files beside it; `src/engine-host/tool-server/server.ts`, `tool-server/panes.ts`, `src/engine-host/session-maws.ts`, `src/engine-host/session.ts`; `src/main/browser/tabs.ts`, `src/main/browser/navigation.ts`, `src/main/browser/agent/control.ts`, and the place the store is given its dependencies (`src/main/browser/index.ts`); `src/renderer/src/tools/maws/panes/connect.ts`; `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json`; the tests beside each, `src/main/catalog/agents.test.ts`, `src/shared/ipc/schema.test.ts`, and one new test file for the wire addition.

**Interfaces.** Exposes §A (the texts and `mawsServerInstructions`), §B (`reload`, `page`, the rule's table, the reload that is not the person's), §C's `personUses`. Consumes nothing.

**Decisions.**
- **The gate is the launch spec.** `EngineSession` reads whether the spec carries a browser backend (a non-empty `extraSettings.env.CUA_BROWSER_BACKENDS`) and hands `SessionMaws` one boolean; `MawsToolServer` takes the instructions as a dependency in place of its import. The handshake begins before the engine's first frame, so nothing later than the spec can decide it (the section's advice). Rejected: asking the browser module whether a socket exists, which the engine host cannot reach and which could differ from what the engine was told.
- **The window makes the open itself.** `showBrowser` invokes `browser.tabs.open` with `select: true`, `reuse: 'url'`, `reload: true` and the request's id, waits for the answer, then opens the Browser tool for the session with no target and answers with the open's `page`. Rejected: making `BrowserHandle.open` awaitable, because `panelHost.addTool` returns a tab id and not the tool's state, so the answer would have to be fished out of the tool; and because every other caller of that method must keep its fire-and-forget behaviour. With no target the tool opens as today and the answer has no `page`.
- **Order: the open first, then the tool.** Main has selected the tab before the panel mounts, so the panel never shows the previous tab for a frame. While the open is unanswered nothing has opened and nothing is answered; if it never comes, the pane bridge's own eight seconds answer the call with its existing timeout text.
- **A refused open is a refusal** (R9 as ruled). When main refuses `browser.tabs.open`, the window opens nothing and answers `{ ok: false, error: TOOL_ERRORS.browserOpenFailed(target, message) }` with the target as the agent gave it and main's message; the bridge carries it to the agent as the tool's error, as it carries every refusal. Rejected: answering "shown" without `page`, which tells the agent its page is there while the pane shows an old or different tab.
- **Main decides, once, in one tick.** `TabStore.open` reads `personUses` and commands the reload in the same call; the outcome is remembered with the request id beside the tab, so a second window's call within ten seconds reloads nothing more and answers the first outcome. `reloaded` means the reload was commanded; the answer does not wait for the page to load. A tab that is suspended is loaded as today and reads `reloaded`.
- **The reload is not the person's input** (review finding 2). `Navigator` gains `reloadForAgent(tabId)`: the body of today's `'reload'` case (the failed address after a load error, the tab's own after a crash or with no view, else the document's reload), reached without the stamp on the input seam. `navigate(tabId, 'reload')` keeps stamping and then runs the same body, so the chrome's Reload, the context menu's and ⌘R are exactly as they are. The store reaches `reloadForAgent` through one optional dependency; the daemon's tab engine gives none and is never asked to reload. Under a lease the reload is told to the windows as the agent's "Navigated to …", which it is. Rejected: calling `navigate`, which makes `show_pane` itself produce "You have the page" on a tab the agent controls, starts the takeover grace and turns the next request into `kept`.
- **What the reload does not protect** (the architect's ruling of 2026-11-13). A reload by the agent discards what was typed in the page, as any reload does; the only protection is `personUses`. A page the person typed in earlier is reloaded like any other: the item exists so that a person who tested a page and asked for a fix sees the new page without reloading it themselves, and that person has almost always typed in the page. Rejected: keeping a page the person has typed in since it loaded, which revision 2 built on a conditional ruling: it made A2's first sentence false in the item's main case, and an agent told the page was kept would reload it through the plugin anyway. The input seam is not changed.
- **`page` crosses the wire as one optional key.** `MawsPaneAnswerResultSchema`'s `ok: true` branch gains it; that is an additive change of an engine-host command, so `WIRE_MINOR` goes up by one, taken against master as merged at this milestone's start, with its comment, and `pnpm wire:manifest` rewrites the two generated files on the VM (Concrete Steps 3). That one key is all the minor carries. The `note` never crosses: the engine host writes it. Build F on the other side: Interfaces §H.
- **The notes live with the other X9 texts** in `src/shared/maws/tools.ts`, and `PaneBridge.request` adds one to a browser answer when the session has a browser backend (R8): `browserKept` for a page kept because the person is using the tab, `browser` otherwise. The keys of the result are written in the order `status`, `pane`, `opened`, `page`, `note`.
- **The probe's snapshot is edited by hand, one string.** `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json` holds `show_pane`'s description; replace that one string with the new description. Do not regenerate the file with `MAWS_WRITE_PROBE_TOOLS=1`: the snapshot still lists the retired `message` tool on purpose (the tracker's row of 2026-10-27, P4-R7z), `search-tools.test.ts` and `fixtures.test.mjs` both assert that it does, and a regenerated file drops it. No assertion compares `show_pane`'s description between the snapshot and the recorded fixtures, so nothing is recorded again.

**What it does not touch.** `BrowserHandle.open` and `forward.ts` (a link's open and a forwarded link's open stay as they are). `personHolds`, the takeover gate, the input seam (`src/main/browser/input.ts`) and `navigate`'s stamp. The pane bridge's `hasClient` and the events it sends. The journaled `maws.pane.shown` event's shape. Any other tool's text. `test/lane-b/offer-coverage.test.ts`.

**What it proves.** A1's unit half and A2's. Behaviours its tests pin beyond the acceptance's words:
- `mawsServerInstructions`: without a backend it is the first constant byte for byte; with one it is the first, a blank line and the second; the second is pinned word for word, names no `mcp__maws__` tool, and the whole is under 2,048 characters;
- `initialize` for a spec with a browser backend carries both paragraphs, and for a spec without one the first alone, at the server and through a scripted session;
- `show_pane`'s description, word for word; the two notes and the new refusal, word for word;
- the store: the four rows of §B's table each with its `page`; a tab whose control is `human` with its last input ten seconds old is `kept` (the case that tells `personUses` from `personHolds`); a tab the person typed in a minute ago and has left is `reloaded` (the limit, pinned); a loaded tab reused without `reload` is selected, not reloaded, and answers no `page` (today's behaviour, which nothing pinned); a repeated request id answers the same tab and the same `page` and commands no second reload; a crashed tab and a tab whose load failed at that address are loaded again and read `reloaded`; another session's tab at the address is never reused;
- the reload: `reloadForAgent` leaves `lastHumanAt` and the tab's control as they were, on an idle tab and on a tab the agent controls, and `navigate(tabId, 'reload')` stamps as before; two `show_pane` requests under different ids, one after the other, on a tab the agent controls both read `reloaded`;
- the window, with the open held unanswered: no tool is open and no `maws.pane.answer` has been sent; once it answers, the tool opens and the answer carries `page`; two handlers given one request both answer alike; a refused address answers `navigationRefused` and invokes nothing; no target invokes no open and answers without `page`; a refused open opens no tool and answers `browserOpenFailed` with main's message;
- the bridge: a browser answer carries `page` and the note that matches it, in §A's key order; with no backend no note; another pane's answer has neither; a refusal reaches the agent as the tool's error;
- the normalizer emits `maws.pane.shown` with its shape unchanged from a result that carries `page` and `note`, and the row's label reads what opened from such a result;
- the wire addition against build F's shape, in a new test: an answer with `page`, read by `readTolerant` with the command's input schema as it stands at `f1852de3a` (copied into the test), is accepted with that key alone dropped; an answer without it, as F's window sends, parses under this build's schema;
- `agents.test.ts` runs its check over the new paragraph too.

### M2 — The agent's tab comes forward

**What exists at its end.** When a window opens the Browser by itself because the agent started acting in a tab, the Browser opens on the agent's tab, unless the person is using the selected tab. A Browser that is already open is not moved, and nothing selects a second time in the turn (A9, as the architect corrects it).

**What it touches.** `src/renderer/src/tools/browser/agent/connect.ts` and its test; `src/shared/ipc/schema/browser.ts` and the command lists beside it; `src/main/browser/register.ts` and its test; `src/main/browser/agent/control.ts` and its test.

**Interfaces.** Consumes `personUses` (M1). Exposes `browser.agent.show` and `agentTabComesForward` (§C).

**Decisions.**
- **The window asks, main decides** (R2 as ruled). Only a window knows that it is about to open the Browser by itself; only main knows whether the person is using the selected tab. So `connectBrowserAgent`, at the point where it opens the tool today, first invokes a new command of main, `browser.agent.show`, with the acting tab's id from the event, and main selects that tab in its session when `agentTabComesForward` says so. Rejected: main selecting at each lease's first acting command (the section's mechanism), which can move the selection several times in a turn, changes a tab the person is reading in a Browser that is already open, and changes another window's panel.
- **Once in a turn, with the opening, and never over an open Browser.** The window's existing rules decide whether it opens at all, and they run first and unchanged: the session is the one shown, the turn has not had its one opening, the session's panel has no Browser tool (a pinned one counts). Only then is main asked. So a later lease in the turn asks nothing, and a Browser tool that is open, in view or behind another tool of the panel, is never moved: the agent's tab keeps its badge and its acting dot and is one click away.
- **Order: main first, then the tool.** The window waits for `browser.agent.show`'s answer and then opens the tool, so the panel mounts on the selection main has just made. The answer's value changes nothing of what follows: selected or not, and after a refusal (the tab closed meanwhile), the tool opens as today. After the wait the window checks again that the session is still shown and still has no Browser tool; if the person opened one meanwhile, nothing more is done. The turn's one opening is recorded before the wait, so a second event during it asks and opens nothing. If the answer never comes the tool is not opened.
- **Another window's Browser.** The selected tab is one value per session in main, so a window cannot keep its own. Main therefore does not select while any panel is showing the session's selected tab (`placedIn.surface` is `panel`), which is the case of a second window with that session's Browser in view; the window that opens by itself then opens on the same tab the other shows. A main tab showing the selected tab does not hold the selection back, since a main tab shows its own tab whatever is selected. What stays: a second window whose Browser tool is open but hidden behind another tool follows the selection, and shows the agent's tab when the person next looks at it.
- **Main's acting command is untouched.** `CuaConnection.acting` still tells the windows and selects nothing; `src/main/browser/cua/retained.test.ts` passes unchanged and now holds that as the ruling. The daemon's tab engine is not involved: it tells no window, so nothing asks it.
- **The decision is a pure function in `control.ts`,** `agentTabComesForward`, tested without Electron; the command's handler reads the session from the tab's own record, so the command names a tab and no session and is routed as `browser.tabs.zoom` is.
- **A pitfall seen in the code:** selecting a tab places its view in the pane, so its size changes from the parked 1280 × 800 to the pane's. That is the change a person makes today by clicking the agent's chip, and the plugin takes a fresh look before each step.

**What it does not touch.** `src/main/browser/cua/`. `personHolds` and the takeover gate. `src/render-host/`. The rules for when the Browser tool opens by itself.

**What it proves.** A9's unit half.
- `agentTabComesForward`: no tab selected, yes; the agent's tab already selected, no; the person's input in the selected tab within three seconds, no; the selected tab reading "You have the page" with older input, no; the selected tab on show in a panel, no; the selected tab on show in a main tab only, yes; the selected tab idle and unshown, yes.
- The command: it selects in the session that owns the tab and answers whether the tab is then the selected one; an unknown tab is refused as other tab commands refuse one; a side thread's acting tab, which is its parent's, is selected in the parent's session.
- The window, with the command held unanswered: no tool is open; once it answers, the tool opens, activated; a second acting event during the wait invokes nothing more and opens one tool; the person opening the Browser during the wait leaves one tool and no second activation; the shown session changing during the wait opens nothing; a refusal still opens the tool. A Browser tool already open, in view or not, and a pinned one: nothing is invoked. A later acting event of the same turn: nothing is invoked. The file's existing cases keep their meaning, each awaiting the answer; its first case now asserts that the command was invoked with the event's tab and that the window itself sends no `browser.tabs.select`.

### M3 — Device sizes and Copy screenshot

**What exists at its end.** Browser options › Viewport offers Responsive, Mobile and Tablet. A device size draws the page at that size, centred and top-aligned in the pane, with a chip in the navigation row; the page's own `innerWidth` reads the size; it survives the agent's own viewport override and is gone after a relaunch (A3). Copy screenshot puts what the pane shows on the clipboard at device pixels and says so (A4).

**What it touches.** `src/shared/browser/tab.ts`, `src/shared/ipc/schema/browser.ts` and the command lists beside it (`src/shared/ipc/names/browser.ts`, and whatever table must name a new main command, as `browser.tabs.zoom` and `browser.view.capture` are named); `src/main/browser/tabs.ts`, `register.ts`, `capture.ts`; `src/renderer/src/tools/browser/`: `View.tsx`, `Pane.tsx`, `chrome/Chrome.tsx`, `chrome/OverflowMenu.tsx`, `chrome/NavRow.tsx`, a new `chrome/ViewportChip.tsx`, a new `viewport.ts`, `actions.ts`, `store.ts` (the two notice kinds), `chrome/Notices.tsx`, `copy.ts`; `src/renderer/src/test-support/browser.ts` and the other fixtures that build a whole tab; the tests beside each.

**Interfaces.** Exposes §D. Consumes nothing from M1 or M2.

**Decisions.**
- **The size is the view's size, never emulation** (the section's "Why this, not that"). The pane sizes the page element; the placement the pane already reports carries it to the view. Nothing is sent to the tab's debugger.
- **The structure U5 codes against stays.** `[data-browser-pane]` stays the page element and what the placement measures. It gains one wrapper, `[data-browser-page-box]`, which takes the page element's place in the column (it is the flexible child) and draws the surround; the comment card's strip stays the column's last child under it, and the reserved column stays beside the column. With no device size the wrapper is filled by the page element and the page element's box is exactly today's.
- **The choice is the tab's; the room is the pane's** (review finding 4). One tab can be mounted in a main tab and in the panel at different sizes, so the room a device size has to fit is a fact of one mount, not of the tab. The pane that holds the view tells its own `BrowserView` its room through a callback, as it tells it `owns` today, and the view hands the room to its chrome, which gives it to the menu and the chip. A pane that does not hold the view tells null, so its chrome offers no size and draws no chip. Nothing about the room is put in the browser store. Rejected: one room per tab in the store, where two mounts of one tab write one entry and the chrome that holds the view can read the other pane's width.
- **The numbers are one pure function,** `pageBox` in `tools/browser/viewport.ts` (§D), used by the pane, the menu and the chip, so the three cannot disagree.
- **The choice is main's.** The menu sends `browser.tabs.setViewport` and draws its radio from the tab's `viewport` as main last sent it; there is no optimistic state, so two surfaces showing one tab agree and a refused command leaves the old mark. Main refuses the command for an extension's options tab; the menu does not offer it there.
- **Never persisted.** `viewport` is not added to `PersistedTabSchema`'s pick, and a restored tab starts at `null`. A test pins the persisted file's keys to the ten build F's reader knows.
- **Copy screenshot is main's write.** `browser.view.copyScreenshot` keeps `captureTabView`'s rule for who may ask, captures with `capturePage` and writes the image to the clipboard whole. It does not use `capturedImage`, whose caps are for a still sent to the model. It answers `{ copied }`; the chrome raises `screenshotCopied` on true and `screenshotFailed` on false or on a refusal. The capture works while the open menu still covers the page, as the comment crop's does.
- **The menu's order** is the section's: Viewport after the zoom group, Copy screenshot after Copy URL. Both are enabled where find and zoom are (a live page in the chrome whose pane holds the view).

**What it does not touch.** The comment dock's files and `CommentCardHost` (U5's). The remote picture of an agent's tab on another machine (`remote/View.tsx`), which has its own navigation row and no options menu. `src/main/browser/permissions.ts`. `src/main/browser/persist.ts`. The debugger and `cua/filter.ts`.

**What it proves.** A3's and A4's unit halves.
- `pageBox`: Responsive answers no box; Mobile in a roomy pane is 375 × 812; at zoom 1.25 the element is 469 × 1015 and the page's size still reads 375 × 812; a pane narrower or shorter than the size cuts that side to the room and the reading follows; `fits` is false for Tablet under 768 points of room at zoom 1 and under 960 at zoom 1.25.
- The store: `setViewport` sets the record and tells the windows; an unknown tab and an extension's options tab are refused; a suspended tab keeps its choice; a restored tab has none; the file written with a Mobile tab has exactly the persisted keys of today.
- The pane: with a device size the page element has the box's size, centred, top-aligned, and the placement reports that rect; a pane made narrower narrows it and widening restores it; the strip stays under the page and the reserved column beside it; with none, the existing cases of `Pane.test.tsx` pass unchanged.
- One tab mounted in a main tab and in the panel, at unequal widths (finding 4's case): the mount that holds the view offers Tablet by its own pane's width and its chip reads its own size, whatever the other pane's width; the other mount offers no size and draws no chip; after "Show here" moves the view to the other pane, that mount's chrome reads its own room and the first has none; unmounting the pane that gave the view up changes nothing in the other.
- The menu and the chip: three radio items with the section's hints, the mark following the tab's `viewport`; Tablet disabled with "Wider than this pane" when it does not fit; the submenu and Copy screenshot disabled where find is; the two exact lists of disabled items updated; a choice sends the command and the mark moves only when main's change arrives (the command held unanswered); the chip is absent in Responsive, reads the page's real size, and opens the three choices.
- The capture: a window that does not hold the tab is refused; a tab not on show, a destroyed view, an empty image and a throwing capture answer `{ copied: false }` and write nothing; a capture writes the whole image once. With the capture held unanswered no notice is raised; each outcome raises its line.

### M4 — Computer use in the session

**What exists at its end.** While a computer-use call runs in a session, a line across the top of its full pane reads "Computer use running" with Stop, through the pauses between calls, on all three routes; it is not drawn while the call waits for a permission answer; Stop ends the turn as the composer's does, is disabled with its reason where it cannot work, and says why when it fails. After a call the strip showed is withdrawn, the line reads "Computer use may still be finishing a step" with Dismiss, and stays until there is evidence that the cell is over or the person dismisses it (R3 as ruled). The call's row reads "Used computer use". A resumed session's launch carries its title as `CUA_CURSOR_LABEL` (A6).

**What it touches.** New `src/renderer/src/computer-use/` (`reading.ts`, `strip-state.ts`, `Strip.tsx`, `copy.ts` and their tests); one line in `src/renderer/src/session/SessionPane.tsx`; one case in `src/renderer/src/transcript/model/copy.ts` and its test; `src/services/sessions/launch-mapping.ts` and its test; one new case in `src/engine-host/store/file-session-state-store.test.ts`.

**Interfaces.** Exposes §E and §F. Consumes, as master exports them: `TranscriptState` and `TurnState` (`transcript/model/reduce.ts`), `isCuaJsTool` (`transcript/model/classify.ts`), `isInterruptionMarker` (`transcript/model/user-text.ts`), `useTranscriptStore` and `ticks` (`stores/transcript.ts`), `selectPendingOf` and `waitsOnAnswer` (`stores/attention.ts`, `src/shared/attention/kinds.ts`), `useSessions` for the session's status (`stores/sessions.ts`), `useSessionControls` (`session/controls/controls-for.ts`), `useRemoteUnavailable` (`lane-b/remote-unavailable.ts`), `toast` (`stores/notices.ts`).

**Decisions.**
- **A directory of its own.** The strip's reading of the transcript does not go into `transcript/model/`, where UC-3 gives this child one string and no more. It reads the model's state and imports its types.
- **Its own reading, not `turnSpansOf`.** The spans leave out a subagent's calls, and widening them would change where the browser's activity rows attach, which `browser-activity.test.ts` holds. `readComputerUse` scans the turn's events and its `children` lists, memoised per turn object. It reads the plugin's three tools: `js`, which the strip draws, and `js_reset` and `end_task`, which it draws nothing for and reads only as evidence that nothing runs any more.
- **Whether the turn runs is read where the transcript already reads it:** the turn is open and accepted, the store's `ticks` does not say the process is gone, and the controls port does not say the turn is at rest. A terminal session's file can leave a turn open for ever; without the last two the strip would never leave such a session.
- **States and events are fixed in §E** before any code: the table there is the contract. What the strip remembers (which calls it showed, which withdrawn call is unresolved) lives with the mounted pane; a pane mounted mid-call starts from what the transcript shows. The two timers it has (the 250 ms before it appears, the ten-second pause) are counted on this window's clock from what this window saw, never from a row's timestamp, because a row can come late (a terminal session's file) or from another machine's clock.
- **No deadline for a withdrawn call** (review finding 1). The window cannot know when a cancelled cell has ended: the call's `timeout_ms` is a budget the plugin suspends around approvals and a helper's start, and a call can wait in the plugin's queue before its budget begins, so a deadline counted from the call's row can pass while the cell still acts. The lingering line therefore has no timer. It leaves on evidence (§E gives the list: a later computer-use call of the session has an ordinary result, the session's process is known gone, the session's status no longer lists a connected computer-use server) or when the person presses Dismiss, the one control on that line. Rejected: first-seen plus `timeout_ms`, the first version of this document, which takes the warning away while the pointer may still move.
- **The permission wait is UC-1's predicate by tool-use id:** a waiting item of the session, of kind `permission`, whose `request.toolUseId` is the call's, under `waitsOnAnswer`, which U1a redefines over `waits` without an edit here.
- **A bound, stated.** A terminal session with no live bridge raises no attention item, so nothing tells this window that a call is waiting for approval in the terminal: there the strip follows the call's row alone, and a call denied in the terminal is read as withdrawn. The section's routes say the strip is drawn from the transcript's rows on that route; this is what those rows can and cannot say.
- **Stop** (review finding 3) is the composer's Stop, `controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })`. It is drawn wherever the session has a controls port, and absent without one. It is disabled, with the sentence as its tooltip and its accessible description, when `useRemoteUnavailable(appSessionId, 'session.interrupt')` gives a sentence or the port's `capability('interrupt')` is not available (its `reason`); otherwise it is enabled, and a session being on another machine changes nothing by itself. Pressed once: disabled and marked busy while the command is unanswered; a refusal enables it again and shows the refusal's own message as a warning toast; an answer leaves it busy until the turn ends. It keeps no state past its turn. Rejected: disabling it for every session on another machine, which removes a control that works; and absence where the port names a reason, which leaves the person without the sentence UC-7 asks for.
- **The mount is one line** in `StartedPane`, inside the full pane only (not `compact`), directly above the transcript's wrapper: `Strip` is a zero-height element whose line is positioned over the transcript's top edge, so nothing below it moves. Law 2's later step (the plugin drawing its own state as a mod surface) changes that one line.
- **The row's title** is one early return in `cellLabel`'s `generic` case, for both names of the tool, before the MCP pattern.
- **The label** is §F: set on a resume of a record that has a title, with or without a browser backend, cleaned and bounded; an intent's first launch and the trust bootstrap set nothing. Where it then is, is §H's row (review finding 5): the session's state file, the engine's argument list and the journal's `spawn` row, the plugin, and a remote device the session selects. Nothing is redacted and no log line is added. Build F meets it in a stored launch spec, whose `extraSettings` is an open record at F as it is today; a test holds that such a spec is saved and read back whole.

**What it does not touch.** `transcript/model/browser-activity.ts`, `classify.ts`, the grouping of tool rows. The composer. The sidebar and the card column. `src/engine-host/launch.ts` and the journal's rows. `src/services/delivery/`.

**What it proves.** A6's unit half.
- The reading: the main agent's call in flight, and a subagent's (in `children`); a result ends it; a closed turn ends it; a prompt not yet accepted is no running turn; a waiting permission item that names the call makes it `waiting`; an item for another call does not; a result whose denial is `user-rejected`, an error result followed by the interruption marker (as a transcript file gives it, with no denial), and a turn closed before the result, each make the call `withdrawn`; an error result with no marker is `done`; `js_reset` and `end_task` calls are read with their tool and never as `js`; a port at rest, and `ticks` false, give no running turn; both server names; rows mapped from a terminal session's transcript file give the same reading as the live wire's.
- The states, with fake timers: nothing at 249 ms and the line at 250; after the call's result the line stays to 9,999 ms and is gone at 10,000; a next call inside the pause keeps the line without a gap; the turn ending normally removes it at once; a turn interrupted while a shown call ran changes it to the lingering line; a call that waited for permission and was denied is never shown and never lingers; unmounting clears every timer; another session's id resets everything.
- The lingering line has no clock (finding 1's two cases, and its leaving): a call whose `timeout_ms` is 30,000 is withdrawn seventy seconds after it was first seen, as when an approval suspended its budget for forty, and the line is still there one hour of fake time later; after a withdrawal a second call starts, as one queued behind the first, the line reads running, that call is withdrawn too and the line lingers for it; a later `js` call's ordinary result removes it, and so do an `end_task` result and a `js_reset` result; a result that came before the withdrawn call in the same turn does not; the store saying the process is gone removes it; a status that lists no connected computer-use server removes it, and a status with the server connected does not; Dismiss removes it and it does not come back for that call.
- Stop: one `interrupt` with the composer's arguments; a session on another machine whose helper answers null has an enabled button that sends it; a session whose helper gives a sentence has the button disabled with that sentence; a port whose interrupt capability names a reason, the same with that reason; no button without a controls port; with the command held unanswered the button is disabled and busy, and when it is then refused the button is enabled again and the refusal's message is shown; the strip is not mounted in the compact pane.
- The title: "Used computer use" for both names; "Used docs · search" still.
- The label: a resume of a titled record sets it, beside a socket and without one; a record whose title source is `none`, or whose text is empty after cleaning, sets nothing; an intent's launch and the bootstrap set nothing; control characters are removed and the text is cut at 64 characters; the owner channel's merge of the environment keeps it. A launch spec whose `extraSettings.env` carries the label is saved by the file session-state store and read back equal.

### M5 — The e2e scenes, the record, and the acceptance run

**What exists at its end.** The e2e specs say what the build now does and hold the new scenes. The two records are amended where they stand and the debt rows are in the tracker. The branch has passed typecheck, lint and the whole unit suite on the VM, and the hand-over for the runs an executor does not start is written into Progress.

**What it touches.** `e2e/browser.spec.ts`, `e2e/browser-cua.spec.ts`, a new `e2e/computer-use.spec.ts` with its journal builder under `e2e/support/`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-05-p1-extension.md`, `docs/tech-debt-tracker.md`; this document's Progress.

**Interfaces.** Consumes everything above. Exposes nothing.

**Decisions.**
- **`e2e/browser.spec.ts`, three new scenes.**
  - *(reload)* A2. A page whose server answers a different marker on every request is open in the session's Browser. `show_pane` for the same address under a new request id: the tab is selected and shows the next marker, and the chrome does not read "You have the page". The person types in a field of the page (a person's input made as the takeover scenes of `e2e/browser-cua.spec.ts` make one) and `show_pane` comes again within three seconds: the marker and the typed text are unchanged, which is A2's second sentence. More than three seconds after that input, `show_pane` again: the next marker shows and the field is empty, which is the limit M1 states. A click on a transcript-style link to the same address (the Browser tool opened with that target, as a link opens it) changes no marker. The existing scene "show_pane opens one tab for two windows' worth of one request …" keeps passing: one request id still makes one tab.
  - *(device sizes)* A3 and probe 4. Viewport › Mobile in a pane at least 812 points tall and wider than 375: the page's `innerWidth` is 375, the page element is 375 wide and centred, the chip reads `375 × 812`; with the options menu open over the page, the frozen picture's box equals the page element's; at page zoom 125% `innerWidth` is still 375; with a comment card open the strip is under the page and the page is shorter by the strip; with the floating session card up, its column is beside the pane's column; in a pane narrower than 768 points Tablet is disabled with "Wider than this pane"; a fake plugin host that sets and then clears a device-metrics override on the tab leaves `innerWidth` at 375 again; the chip opens the three choices and Responsive removes it. It attaches a screenshot of the sized page with the chip.
  - *(copy screenshot)* A4. Copy screenshot, then the clipboard holds an image whose size is the view's size at device pixels, and the notice line shows. The existing scene of the page's guards (a camera request denied with its line) keeps passing unchanged.
- **`e2e/browser-cua.spec.ts`.** The scene "the Browser panel follows the agent: … and the agent's tab is not selected; …" becomes A9's, in two steps. With the Browser closed and the person's tab the selection, a lease's first acting command opens the Browser, and the session's selected tab is the agent's. Then, in a new turn of the scene, with the Browser open on the person's tab and a second agent tab, that lease's first acting command changes nothing: the selected tab is still the person's and the agent's tab is in the strip with its badge. Its last part, the activity listed after a restart, stays. The case of a person using the selected tab is held by M2's unit tests: with the Browser closed there is no page in the panel to click in. Re-read, expecting no edit: "a fake cua host drives a session's tabs through its socket …" and "the app as a tab engine: …", which launch with no session shown, so no window opens a Browser and nothing is selected.
- **`e2e/computer-use.spec.ts`, new, collected by the default group.** It launches on the replay seam, as `e2e/support/library-session.ts` does, with a journal its builder writes from recorded frames (the shape of `e2e/support/to-human-replay.ts`), under a session title invented for the scene: a turn whose assistant message calls `mcp__plugin_cua_cua_repl__js` and is left running. The line "Computer use running" and Stop show at the top of the session; the call's row reads "Used computer use". Stop writes the interrupt the composer's Stop writes (the replay holds at it); the journal then plays the engine's rows after an interrupt (the rejected result, the marker, the result); the line reads "Computer use may still be finishing a step" with Dismiss and is still there after the scene has waited past the call's `timeout_ms`, which the journal sets to two seconds. A second turn's `js` call with an ordinary result takes the line away after the pause. In a second session the same withdrawal is followed by Dismiss, which takes the line away at once. A third session's journal has the call waiting on a permission request: no line while it waits. It attaches a screenshot of each line. No scene is added for a terminal session or a session on another machine: the reading is the same function over the same model on every route, and M4's unit test feeds it rows mapped from a transcript file (law 4).
- **The record** (root UC-10, "The record"; the section, "Rulings reversed"; R7 as ruled). Each sentence is added where the record stands and nothing is removed; each is dated the day its commit is made.
  - Row A-54 of the P1 spec's Decision log (`docs/doperpowers/plans/2026-10-05-p1-extension.md`, §7), after its amendment of 2026-10-08: "Reversed 2026-11-12 (UX wave, U12; the owner's answer 'Yes, unless I use mine'): when the Browser opens by itself because the agent started acting in a page, it shows the agent's tab, except when the person is using the selected tab (they typed or clicked in it within the last three seconds, or it reads 'You have the page')."
  - The same row, after that sentence, and the charter's X9 paragraph (`docs/charter.md`, §13, "X9 — the `maws` tool server"), at its end: "Amended <the commit's date> (UX wave, U12): the `maws` server's instructions gain a paragraph on the in-app browser for sessions with a browser backend; `show_pane`'s description says a page already open is reloaded unless the user is using that tab; its result gains optional `page` and `note`; one refusal is added for a page MAWS could not open."
  - One new entry at the end of the charter's §19 Decision log, naming both: the amendment of X9 with its four parts, and the reversal of the choice of 2026-10-08, each with the path of this document.
  - The tracker's row of 2026-10-27 (P4-R7z) gains one clause: the probe's snapshot now carries `show_pane`'s description of this landing, which the recorded fixtures predate.
- **The five debt rows** are added to `docs/tech-debt-tracker.md` in its table's form, dated the day of the commit, source "UX wave U12a":
  1. After a Stop that withdrew a running computer-use call, MAWS cannot tell when the cell has ended; the line "Computer use may still be finishing a step" stays until a later computer-use call settles, the session ends, the server is gone, or the person dismisses it. Where: `src/renderer/src/computer-use/strip-state.ts`. Goes when: the computer-use plugin stops a cancelled cell or tells the host when one has ended (Ticket 2, `SSFSKIM/cua#369`).
  2. The computer-use strip cannot see an approval that carries no tool-use id: a plugin approval raised as an MCP form mid-call, and an approval waited for in a terminal session with no live bridge. The strip reads "Computer use running" through such a wait. Where: `src/renderer/src/computer-use/reading.ts`. Goes when: the plugin reports its state (Ticket 2, `SSFSKIM/cua#369`).
  3. A session's selected browser tab is one value for every window, so a second window whose Browser tool is open but not in view follows the agent's tab when another window opens its Browser by itself. Where: `TabStore`'s selection; `agentTabComesForward`. Goes when: a window keeps its own shown tab, if two windows on one session become common.
  4. A device size applies only where a pane holds the tab's view; a tab no pane shows is parked at 1280 × 800, and that is the size the agent sees there. Where: `src/main/browser/view.ts` (parking); `tools/browser/viewport.ts`. Goes when: scaled or emulated sizes are taken up (the section's "Not included").
  5. The cursor's label is the session's title at launch: it does not follow a rename until the next launch, and it is kept wherever the launch's settings are (the session's state file and the journal's `spawn` row). Where: `extraSettingsOf`. Goes when: the plugin reads a label at a task's start (Ticket 2, `SSFSKIM/cua#369`, point 3).
- The acceptance run is Concrete Steps 5. Class 1a is not M5's.

**What it does not touch.** Product code, unless a scene shows a defect; then the fix goes to the milestone's owner through the controller. `e2e/remote.spec.ts` (probe 5 is #435's). The register and the board.

**What it proves.** It writes the e2e halves of A2, A3, A4, A6 and A9; they are proved when the architect's runs are green. It proves by its own run that typecheck (which covers `e2e/`), lint and the unit suite pass on the branch.

## Concrete Steps

Working directory for every command: the worktree of branch `ux-wave/U12a`. `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U12a --`; each call tests the pushed head, prints `vmcheck: ux-wave/U12a at <short sha>` and then the command's own output, and exits with the command's status, so each is its own call. The first call for the branch installs dependencies and takes a few minutes.

1. **Base** (the controller, before M1 and again before M4 and M5):

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U12a

   Merge, never rebase, never force-push. Before M1, check constraint 11's line prints `step-0-landed`; if it does not, stop: no executor starts. Before M4, if master holds a landing of U1, U2 or U3 by then, the insertions in `session/SessionPane.tsx` and `transcript/model/copy.ts` are made on the merged tree; before M3, the same for U5 and `tools/browser/Pane.tsx`.

2. **While a milestone is built**, after each push: one TypeScript project at a time (`vmcheck 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'` for the renderer; `-p tsconfig.node.json` for `src/shared`, `src/engine-host`, `src/main`, `src/services` and `test/`), `vmcheck 'pnpm exec eslint <the changed paths>'`, and the milestone's suites:
   - M1: `vmcheck 'pnpm exec vitest run src/shared/maws src/shared/ipc src/engine-host/tool-server src/engine-host/session-maws.test.ts src/engine-host/normalizer.test.ts src/main/browser src/main/catalog/agents.test.ts src/renderer/src/tools/maws/panes src/renderer/src/tools/browser/BrowserTool.test.tsx src/renderer/src/transcript/model'` and `vmcheck 'pnpm test:probes'`
   - M2: `vmcheck 'pnpm exec vitest run src/shared/ipc src/main/browser src/renderer/src/tools/browser/agent'`
   - M3: `vmcheck 'pnpm exec vitest run src/shared/browser src/shared/ipc src/main/browser src/renderer/src/tools/browser'`
   - M4: `vmcheck 'pnpm exec vitest run src/renderer/src/computer-use src/renderer/src/session src/renderer/src/transcript/model src/services/sessions src/services/owner src/engine-host/store'`

   Expect each to pass whole. On the VM the macOS-guarded cases report as skipped (those of `src/main/browser/index.test.ts` and of `src/main/browser/cua/` among them): that is expected there and is why `unit:darwin` is on the architect's list. The suites build-common names as failing on master on the VM are not this branch's.

3. **M1, the wire's generated files.** After the merge of step 1, read `WIRE_MINOR` in `src/shared/ipc/wire.ts` and take the next number, with its comment naming `maws.pane.answer`'s `page`. After the schema is edited and pushed:

       vmcheck 'pnpm wire:manifest >/dev/null; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' > /tmp/u12a-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u12a-wire.patch | git apply

   Expect a patch that touches those two files only, with one added optional property under `commands.maws.pane.answer`. Commit them with the change and push; `wire.test.ts` and `wire-fingerprint.test.ts` pass only with them. If another landing has taken the same minor on master by the time this branch merges it again, take the next and regenerate.

4. **At each milestone's end:** `vmcheck 'pnpm typecheck'` and, at M5 only, `vmcheck 'pnpm test'` (the whole unit suite; M1 to M4 run vitest over the directories they touched and the test folders that import what they changed, named in the report: the build rule of 2026-11-13, Decision Log). Expect no error and no failed file beyond build-common's list. M1 changed a recorded file, so it also runs `vmcheck 'node --test .github/scripts/maws-app-scan.test.mjs'`; M5 runs it again for its e2e support. The controller then has the milestone reviewed and ticks Progress.

5. **The acceptance run** (M5), on the pushed head:

       vmcheck 'pnpm typecheck'
       vmcheck 'pnpm lint'
       vmcheck 'pnpm test'
       vmcheck 'pnpm test:probes'
       git diff origin/master...HEAD --stat -- src/services/delivery src/renderer/src/delivery src/shared/keymap/actions.ts src/main/browser/permissions.ts src/main/browser/persist.ts src/main/browser/cua/connection.ts

   Expected: each check exits 0; vitest's summary names no failed file beyond build-common's list; the last command prints nothing (constraints 6 and 7, the two files M3 must not touch, and the file M2's ruling leaves alone). `pnpm typecheck` covers `e2e/`, which is the only check an executor has on the scenes of M5.

6. **The executor stops here and hands back.** It writes into Progress what exists, what each command printed, and what is not verified. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. What follows is the architect's ("Proof that an executor does not run"):

       scripts/ci-gate.sh "$PWD" --gates unit:darwin --runner macos --label u12a-darwin
       scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u12a

## Interfaces and Dependencies

Texts in §A and §G are exact. Signatures are what must exist at the end of the milestone named; the bodies are the executor's.

### §A. The texts under X9 and UC-15 (M1)

    // src/shared/maws/instructions.ts
    export const MAWS_SERVER_INSTRUCTIONS = /* unchanged: 699 characters */;
    export const MAWS_BROWSER_INSTRUCTIONS =
      "This session has MAWS's in-app browser: the Browser pane, which the user watches and can take over. It is your browser too. With cua_repl's js tool, cua.getBrowser() with no id is this browser, so open, click, type, reload and check pages there yourself instead of asking the user to; use Chrome or another browser only when the user names it.";
    /** The first paragraph; for a session with a browser backend, then a blank line ("\n\n") and the second. */
    export function mawsServerInstructions(session: { inAppBrowser: boolean }): string;

The second paragraph is 343 characters; a session with a browser backend is given 1,044, and this landing's share of UC-15's budget is 345. A later child's sentence goes into the constant it belongs to, and `mawsServerInstructions` stays the one place the paragraphs are joined.

`show_pane`'s description changes in one clause: `a URL for browser` becomes `a URL for browser (a page already open is reloaded, unless the user is using that tab)`. Everything else of the string stays (577 characters after the change).

    // src/shared/browser/tab.ts
    export const BROWSER_OPEN_PAGES = ['opened', 'reloaded', 'kept'] as const;
    export const BrowserOpenPageSchema = z.enum(BROWSER_OPEN_PAGES);

    // src/shared/maws/tools.ts
    export const ShowPaneResultSchema = z.strictObject({
      status: z.literal('shown'), pane: PaneSchema, opened: ShowPaneOpenedSchema,
      page: BrowserOpenPageSchema.optional(),   // the browser pane with a target
      note: z.string().optional(),              // the browser pane, in a session with a browser backend
    });
    export const SHOW_PANE_NOTES = {
      browser: "This page is in the session's in-app browser, which the user sees. To act on it, use cua_repl's js tool: cua.getBrowser() with no id is this browser.",
      browserKept: "The user is using this tab, so it was shown without reloading. To act on it, use cua_repl's js tool: cua.getBrowser() with no id is this browser.",
    } as const;
    // TOOL_ERRORS gains (R9 as ruled):
    browserOpenFailed: (target: string, message: string) => `show_pane: MAWS could not open "${target}" in its browser: ${message}`,

    // src/shared/ipc/schema/maws.ts: the `ok: true` branch of MawsPaneAnswerResultSchema
    z.strictObject({ ok: z.literal(true), opened: ShowPaneOpenedSchema, page: BrowserOpenPageSchema.optional() })

The agent reads the result as JSON with its keys in the order `status`, `pane`, `opened`, `page`, `note`. The note for a browser answer: `browserKept` with `page: 'kept'`; `browser` otherwise. The two notes and the description's clause are the section's words; `browserOpenFailed` is this document's, by the ruling on R9. The section's text for a pane shown on another device and its refusal for a loopback page are #435's and are not defined by this landing.

    // src/engine-host/tool-server/server.ts: MawsToolServerDeps gains
    instructions: string;                        // answered at `initialize`
    // src/engine-host/session-maws.ts: SessionMawsHost gains
    inAppBrowser: boolean;                       // the launch spec carried a browser backend
    // src/engine-host/tool-server/panes.ts: PaneBridge's deps gain
    inAppBrowser?: boolean;                      // absent: false

### §B. The open, and the rule for a page already open (M1)

    // src/shared/ipc/schema/browser.ts, 'browser.tabs.open'
    input:  … reload: z.literal(true).optional()            // show_pane's path alone sets it
    output: … page: BrowserOpenPageSchema.optional()        // present exactly when `reload` was asked

    // src/main/browser/tabs.ts: OpenRequest gains `reload?: true`; `open` answers `page` with it
    // src/main/browser/navigation.ts
    /** The reload `show_pane` asks for: what `navigate(tabId, 'reload')` does after its stamp (the failed address after
     *  a load error, the tab's own after a crash or with no view, else the document's reload), without the stamp. It is
     *  not the person's input: `lastHumanAt` and the tab's control are left as they are. */
    reloadForAgent(tabId: string): boolean;

Main's rule, for a request with `reuse: 'url'` and `reload: true`, over the session's tab at the same normalised address:

| the tab | what main does | `page` |
|---|---|---|
| none at that address | opens a new tab and selects it | `opened` |
| suspended (no view) | selects and loads it, as today | `reloaded` |
| loaded, and the person does not use it (§C) | selects it and commands `reloadForAgent` | `reloaded` |
| loaded, and the person uses it | selects it, reloads nothing | `kept` |

**The limit.** A reload by the agent discards what was typed in the page, as any reload does. The only protection is `personUses`: a tab the person gave input within the last three seconds, or one that reads "You have the page", is kept. A page the person typed in earlier and has left is reloaded like any other.

A request id seen within `REQUEST_ID_MS` answers the first call's tab and the first call's `page`, and does nothing else. Without `reload` the call behaves and answers exactly as today.

### §C. Who is using a tab, and when the agent's tab comes forward (M1, M2)

    // src/main/browser/agent/control.ts
    /** The person is using the tab: it reads "You have the page" (control `human`), or `personHolds` (their last input
     *  within BROWSER_HANDBACK_IDLE_MS). The one statement of this rule; the takeover gate keeps reading `personHolds`. */
    export function personUses(entry: TabEntry, now: number): boolean;

    /** Whether the Browser's opening by itself selects `acting` in its session: not when it is the selected tab
     *  already, not when the person uses the selected tab, and not when a panel is showing the selected tab
     *  (`placedIn.surface === 'panel'`). `selected` is the session's selected tab's entry, or null when it has none. */
    export function agentTabComesForward(selected: TabEntry | null, acting: TabEntry, now: number): boolean;

    // src/shared/ipc/schema/browser.ts
    'browser.agent.show': { input: { tabId }, output: z.strictObject({ selected: z.boolean() }), owner: 'main' }

`browser.agent.show` reads the session from the tab's own record, selects the tab there when `agentTabComesForward`, and answers whether the tab is then the session's selected one. It is the only new thing that selects: `CuaConnection.acting` is as it is.

The window's sequence in `connectBrowserAgent`, on `browser.agent.acting`:

1. As today, and in this tick: the event's session is the one shown; the turn has not had its opening (recorded now); the session's panel has no Browser tool and the tool is registered. Otherwise nothing.
2. Invoke `browser.agent.show` with the event's `tabId`, and wait for its answer, whatever it is.
3. If the session is still the one shown and still has no Browser tool, open the tool as today (`addTool` with the session, activated). Otherwise nothing.

The rule as built, in three lines:
- The agent's tab is selected only when a window opens the Browser by itself for the agent's acting, which it does once in a turn and never while that session's panel already has a Browser tool.
- Main then selects the agent's tab unless the person is using the selected tab (input in it within three seconds, or it reads "You have the page") or a panel in some window is showing the selected tab.
- Nothing else selects: not an acting command in main, not a later lease, not a Browser that is already open.

### §D. Device sizes and the screenshot (M3)

    // src/shared/browser/tab.ts
    export const BROWSER_VIEWPORTS = [
      { id: 'mobile', width: 375, height: 812 },
      { id: 'tablet', width: 768, height: 1024 },
    ] as const;
    export const BrowserViewportSchema = z.strictObject({ width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) });
    // BrowserTabSchema gains, never persisted:
    viewport: BrowserViewportSchema.nullable(),             // null: Responsive, the pane's size

    // src/shared/ipc/schema/browser.ts
    'browser.tabs.setViewport':    { input: { tabId, viewport: BrowserViewportSchema.nullable() }, output: z.void(), owner: 'main' }
    'browser.view.copyScreenshot': { input: { tabId }, output: z.strictObject({ copied: z.boolean() }), owner: 'main' }

    // src/renderer/src/tools/browser/viewport.ts
    export interface Room { width: number; height: number }
    export interface PageBox { width: number; height: number; reads: { width: number; height: number } }
    /** The page element's size in the pane's own pixels for a device size, and what the page then reads as its size.
     *  width = min(round(viewport.width * zoom), room.width), and the same for height; reads = each side divided by
     *  zoom, rounded. Null for Responsive, where the element fills its room as today. */
    export function pageBox(viewport: BrowserViewport | null, zoom: number, room: Room): PageBox | null;
    /** Whether a device size's width fits the room now: viewport.width * zoom <= room.width. */
    export function fits(viewport: BrowserViewport, zoom: number, room: Room): boolean;

    // src/renderer/src/tools/browser/Pane.tsx: BrowserPaneProps gains, beside `onOwns`
    onRoom?(room: Room | null): void;   // the page box's client size while this pane holds the view; null when it does not, and at unmount

The room is one mount's: `BrowserView` keeps it in its own state beside `owns` and passes it to its `Chrome`, which gives it to the options menu and the chip. A chrome with no room offers no size and draws no chip. The tab's `viewport` is the tab's and is the same in every mount.

The pane's DOM, which U5's comment dock and the e2e scenes read:

    [data-browser-column]                      the column, as today
      [data-browser-page-box]                  new: the flexible child; draws the surround; its client size is the room
        [data-browser-pane]                    the page element, as today: what the placement measures
      (the comment card's strip)               as today, the column's last child
    [data-browser-reserved-column]             as today, beside the column

The chip is `[data-browser-viewport-chip]` in the navigation row, before the options menu. The menu's three radio items carry `data-viewport="responsive" | "mobile" | "tablet"`.

### §E. The strip: what it reads, its states and its evidence (M4)

    // src/renderer/src/computer-use/reading.ts
    export interface ComputerUseCall {
      toolUseId: ToolUseId;
      tool: 'js' | 'reset' | 'end';                                  // the plugin's js, js_reset and end_task, under either server name
      state: 'flight' | 'waiting' | 'done' | 'withdrawn';
    }
    export interface ComputerUseReading { turn: TurnId | null; running: boolean; calls: readonly ComputerUseCall[] }
    /** The session's computer-use calls of the turn that matters now, in the order they started: the running turn,
     *  else the latest turn that has one. `running` says whether `turn` is the running turn. `waiting` holds the
     *  tool-use ids of the session's waiting permission requests; `runs` is false when the store or the controls port
     *  says the turn is not running. */
    export function readComputerUse(state: TranscriptState | null, waiting: ReadonlySet<ToolUseId>, runs: boolean): ComputerUseReading;

    // src/renderer/src/computer-use/strip-state.ts
    export const COMPUTER_USE_SETTLE_MS = 250;
    export const COMPUTER_USE_PAUSE_MS = BROWSER_AGENT_IDLE_MS;     // 10 s, the Browser's "Agent is browsing" interval
    export type StripState = { kind: 'absent' } | { kind: 'running'; turnId: TurnId } | { kind: 'lingering'; toolUseId: ToolUseId };
    export function useComputerUse(appSessionId: AppSessionId): { state: StripState; dismiss(): void };

    // src/renderer/src/computer-use/Strip.tsx
    export function ComputerUseStrip(props: { appSessionId: AppSessionId }): ReactNode;   // null while absent

A call's state: `flight` from its `tool.use` until its `tool.result` or its turn's close; `waiting` instead of `flight` while a waiting permission item names it; `done` at an ordinary result; `withdrawn` at a result whose `denial` is `user-rejected`, at an error result that the engine's interruption marker follows in the turn (`isInterruptionMarker`; a transcript file's rows carry no denial), or at its turn's close with no result. A call can therefore read `done` for one batch and `withdrawn` at the next, when the marker's row arrives after the result's; the states below follow the reading as it stands. Only `js` calls are drawn; a `reset` or an `end` call is read for the evidence below and for nothing else.

What the strip remembers while its pane is mounted: the `js` calls it showed (in `flight` while the state was `running`), and the *unresolved* call, which is the latest call it showed that became `withdrawn` and for which none of the evidence below has come.

| state | what is drawn | entered | left |
|---|---|---|---|
| `absent` | nothing | at mount; and as below | |
| `running` | a pulsing dot, "Computer use running", Stop | from `absent` or `lingering`: a `js` call of the running turn has been in `flight` for `COMPUTER_USE_SETTLE_MS` without a break | to `lingering`: no `js` call is in `flight` and there is an unresolved call, which includes the moment a call the strip showed becomes `withdrawn`. To `absent`, with no unresolved call: the running turn ends or stops running; or no `js` call has been in `flight` for `COMPUTER_USE_PAUSE_MS`; or a `js` call of the turn is `waiting` and none is in `flight`. |
| `lingering` | a still dot, "Computer use may still be finishing a step", Dismiss | from `running` only | to `running`: as `running` is entered; the unresolved call stays unresolved. To `absent`: the unresolved call is resolved. No timer leaves this state. |

**The evidence that resolves the unresolved call,** any one of:
- a computer-use call of the session (`js`, `reset` or `end`) that started after it has an ordinary result (`done`): later in the same turn, or in a later turn. The plugin runs calls one after another, so a later call's result means the earlier cell is over;
- the session's process is known to be gone: the transcript store says so for the session's key (`live[key] === false`);
- the session has a status and it lists no connected computer-use server (neither `plugin:cua:cua_repl` nor `cua_repl` with the state `connected`);
- the person presses Dismiss.

A call's `timeout_ms` is not evidence and is not read: the plugin suspends that budget around approvals and a helper's start, and a queued call's budget starts later than its row. The two timers are counted on this window's clock from what this window saw. Stop's own state (idle, busy) belongs to the `running` state of one turn and is dropped when that state is left.

**Stop.** Drawn in `running` wherever the session has a controls port; absent without one. Disabled, with the sentence as its tooltip and its accessible description, when `useRemoteUnavailable(appSessionId, 'session.interrupt')` gives a sentence, or else when the port's `capability('interrupt')` is not available (its `reason`). Otherwise enabled, on this machine and on another alike. A press sends `controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })` once and makes the button disabled and busy; a refusal enables it again and shows the refusal's `error.message` through `toast` at level `warning`; an answer leaves it busy until the state is left.

### §F. The cursor's label (M4)

    // src/services/sessions/launch-mapping.ts: LaunchInput gains
    cursorLabel?: string | null;     // the session's title for the plugin's on-screen cursor; null: none

`resumeLaunchSpec` gives it from the record: the title's text when its source is not `none`, with control characters removed, trimmed, and cut at 64 characters; null when nothing is left. `intentLaunchSpec` and `bootstrapSpec` give none. `extraSettingsOf` writes it as `env.CUA_CURSOR_LABEL`, beside `CUA_BROWSER_BACKENDS` when there is one and alone when there is not. The plugin cuts it to 24 characters with its own ellipsis and picks the colour; the bound of 64 only keeps a long title short in the engine's argument list. Where the value then is: §H.

### §G. Copy

- The strip: `Computer use running`; its button `Stop`; the lingering line `Computer use may still be finishing a step`; its button `Dismiss`. The strip is a status region; the busy Stop keeps its label and is disabled with `aria-busy`.
- The row: `Used computer use`.
- The menu: `Viewport`; its items `Responsive`, `Mobile` with the hint `375 × 812`, `Tablet` with the hint `768 × 1024`; a size that does not fit is disabled with the hint `Wider than this pane` in place of its numbers; `Copy screenshot`.
- The chip: `<width> × <height>` from `pageBox`'s `reads`, with the accessible name `Viewport: <width> × <height>`. The sign is U+00D7 with a space on each side.
- The notices: `Screenshot copied to clipboard` (info); `Couldn’t copy a screenshot of this page` (warning).
- A Stop that was refused shows the refusal's own message, and a disabled Stop the helper's or the port's own sentence; this landing words neither.

### §H. What this landing stores or sends, and what build F does with it

| what | where it goes | build F meeting this build's value | this build meeting F's | this build, then F, then this build |
|---|---|---|---|---|
| `result.page` in `maws.pane.answer` | from a window to the engine host, which may be F's while F's kept host is still serving after an update | F's host reads a command's input tolerantly: it drops `page`, logs it once, and answers the call with F's result (no `page`, no `note`). The tab was still reloaded, or kept, by this build's main. | F's window sends no `page`: this build's host answers without `page`, with the `browser` note when the session has a backend; F's window reloaded nothing, and the answer does not say it did. | Nothing is stored. |
| `page` and `note` in `show_pane`'s result; the new refusal's text | to the engine, and so into the engine's transcript and MAWS's journal as the call's result text | F's strict reader of the result does not parse a result with the new keys: the pane's row reads the pane's name without what opened. The journaled `maws.pane.shown` event has its old shape and reads as before. A refusal is an error text, which F draws as any refusal. | F's results have neither key and parse. | Each build draws the row from the same stored text by its own rule; nothing is rewritten. |
| The second paragraph of instructions | to the engine at the server's handshake; the engine keeps the instructions a session was first given across resumes | A session first launched by this build keeps the paragraph when F resumes it. It stays true there: F has the in-app browser and the same backend. | A session first launched by F has no paragraph when this build resumes it (A1's checks use a new session). | As the first two columns. |
| `CUA_CURSOR_LABEL`, the session's title | (1) the launch spec's `extraSettings.env`, which the engine host keeps in the session's state file (`saveLaunchSpec`); (2) the engine's argument list, as part of the `--settings` JSON, which other processes of the same user can read and which the journal's `spawn` row records whole; (3) the engine's environment, and from it the plugin's server and its worker; (4) a remote computer-use device the session selects, in that device session's `initialize` as `cua/cursor`; and on screen, in the cursor's pill | F reads a stored launch spec carrying it: `extraSettings` is an open record at F as today (`src/shared/engine/launch-spec.ts` and the state store have no difference from `f1852de3a`), and a test holds the round trip. F's own launches set none. A journal row is text F does not interpret. | F's stored specs carry none; the plugin falls back as today. | A session resumed by F loses the label at that launch and gets it back at this build's next one. |
| `BrowserTab.viewport`; `browser.tabs.setViewport`; `browser.view.copyScreenshot`; `browser.agent.show`; `reload` and `page` on `browser.tabs.open` | between main and the windows of one build | F never meets them: they are not written to `tabs.json` (the file's keys are pinned by a test), not on the wire to a host, and a build's preload bridges only its own commands. | — | A tab's device size is gone at a relaunch under either build. |
| `WIRE_MINOR` + 1 and the manifest's one added property, `page` | the hello between an app and a host | Additive within the wire's major, as every minor since F's 33. | — | — |

This landing writes no layout key, no settings key and no tab kind, so it adds no row to the cross-build coverage table (U13a's M5 holds it) and no cross-build scene. What F does with the wire addition is held by M1's test against F's schema, and what it does with a stored launch spec by M4's.

### §I. Consumed from other landings, and exposed to them

**Consumed.**
- **U6a** (`…-U6a-keymap.md`): nothing. This landing adds no action id and no chord; the two menu rows are the Browser's own.
- **U8a** (`…-U8a-working-folder.md`): nothing is read from `workingFolder`. Its tree test scans `src/`; no file of this landing spells the session's folder.
- **U3a** (`…-U3a-arrivals.md`): nothing by name. M4 reads the transcript model's state as master exports it and inserts one case in `transcript/model/copy.ts`; both are made on a master that holds U3a's landing if it is there (root UC-3).
- **U13a** (`…-U13a-one-strip.md`): nothing. No tab of the main strip is opened or brought forward by new code, so `commitShown` is not called, and no row joins its coverage table (§H).
- **U9** (`…-U9-other-machines.md`): `useRemoteUnavailable(appSessionId, 'session.interrupt')`, under the signature master has today, which U9 keeps while making its answers follow the link's phase: null while Stop can work, a sentence when it cannot. Stop on the strip is `session.interrupt`, an act U9's document lists as offered since P5; this landing adds no act on a session.
- **U8b** (`…-U8b-column-and-tabs.md`): `panelHost.addTool` as it is called today (its §C.7: one optional `group`, otherwise unchanged; a tool opened with `activate` comes into view in its group and opens the column as today). The window's `show_pane` handler and the Browser's own opening call it with the arguments they pass today. Whether a session's panel "has a Browser tool" is read as `connectBrowserAgent` reads it today, over whatever U8b makes of the panel's tabs.
- **U1a** (root UC-1): `waitsOnAnswer` from `src/shared/attention/kinds.ts`, which U1a redefines over `waits`; M4 follows without an edit.

**Exposed.**
- To **#435's landing**: `ShowPaneResultSchema`'s `page` and `note`, `SHOW_PANE_NOTES` and `browserOpenFailed` (it adds the note for another device and the loopback refusal); `reload` and `page` on `browser.tabs.open` (what the device's forwarded open passes); `reloadForAgent`; `personUses`.
- To **U6's second landing**: `mawsServerInstructions`, and the budget as it stands after this landing (1,044 of 2,048 for a session with a browser backend, 699 without).
- To **U5**: §D's DOM. The comment dock stays the last child of `[data-browser-column]`; the page element is still `[data-browser-pane]`.
- To **U1 and U2**: the one line in `StartedPane`, directly above the transcript's wrapper; it has no height.
- To whoever takes law 2's later step, or reads the plugin's report when Ticket 2 lands: `useComputerUse` and the mount; the lingering state is the part a signal from the plugin replaces.

### §J. Insertions in files other children own (root UC-8)

| file (owner) | the insertion | named by |
|---|---|---|
| `src/renderer/src/session/SessionPane.tsx` (U1) | one line in `StartedPane` mounting `ComputerUseStrip`, and its import | the section |
| `src/renderer/src/transcript/model/copy.ts` (UC-3) | one case in `cellLabel`'s `generic` case, with its import | the section |
| `src/shared/maws/instructions.ts` (UC-15) | the second constant and the join | the section |
| `src/shared/maws/tools.ts` (UC-15) | one clause of `show_pane`'s description; two optional keys of its result; two note texts; one refusal | the section; the ruling on R9 |
| `src/engine-host/tool-server/panes.ts`, `src/engine-host/session-maws.ts` (U10; UC-8 gives them to U12 for the pane bridge) | the result's `page` and `note`; one boolean passed in | the section |
| `src/engine-host/tool-server/server.ts` (U10) | the instructions as a dependency in place of the import | R6 as ruled |
| `src/main/catalog/agents.test.ts`, `src/engine-host/store/file-session-state-store.test.ts` (no child's) | one name in a list; one added case | this document |
| `e2e/browser.spec.ts`, `e2e/browser-cua.spec.ts` (no child's; U5's work may edit the first) | M5's scenes | this document |
| `docs/tech-debt-tracker.md` | five rows, and one clause in an existing row | this document |

`src/engine-host/session.ts`, `src/services/sessions/launch-mapping.ts`, `src/renderer/src/tools/maws/panes/connect.ts` and the shared schema files belong to no child in UC-8's table. `src/engine-host/ops.ts`, which UC-8 names for this child, is not touched by this landing.

### §K. Who may ask, checked where the act runs

- **The reload.** Main's `open` decides on the tab's own entry, with `personUses`, in the call that commands the reload. Only a window of this build can set `reload`: `browser.tabs.open` is a command of main that no machine link carries (the router answers it on this device for a session of any machine). An agent reaches it only through `show_pane`, and the store reuses only a tab whose `appSessionId` is the session named.
- **The selection.** `browser.agent.show` names a tab; main reads the session from the tab's own record and decides on the entries it chooses between. It can do no more than `browser.tabs.select`, which every window already has, and less: it does not select over a tab the person is using or a panel is showing. Only the app's renderer can send it.
- **`browser.tabs.setViewport`.** Any window of the app, by tab id, as `browser.tabs.zoom`; main refuses it for an extension's options tab.
- **`browser.view.copyScreenshot`.** Main checks, on the entry it captures, that the sender's window is the one the tab is placed in and that the tab's own page is on show. The image goes to the clipboard of the machine that window is on. A page cannot ask: the command belongs to the app's renderer, and the page's preload does not carry it.
- **Stop.** `session.interrupt` through the session's controls port. For a session on another machine the endpoint's offer and its grade decide, as for the composer's Stop; this landing adds nothing there.
- **The label.** A title the launching machine's own record holds, given to the engine on that machine. The plugin shows it on that machine's screen and sends it to a remote device only when the session itself selects one.
- **A remote caller** sees nothing new: nothing of this landing is added to a machine link.

## Acceptance

The acceptance is the section's A1 to A4, A6, A8 and A9, as written there. A5 is #435's landing's and A7 is withdrawn. "Unit" is run by the milestone's executor on the VM and again by class 1a; "unit:darwin", "e2e" and "by hand" are the architect's ("Proof that an executor does not run").

| item | proved by | milestone |
|---|---|---|
| A1 the agent drives the in-app browser itself, with no tool named in the prompt | unit: the `initialize` answer with and without a browser backend (the test that fails before). By hand: probe 6, in a new session on this branch's build | M1 |
| A2 `show_pane` on a page already open reloads it; a tab the person is typing in is kept; a link and the address bar reload nothing | unit (the store's four rows, the reload that is not the person's input, the window's held open, the bridge's notes and the refusal); e2e, the *(reload)* scene of `browser.spec.ts`. A2 is built as written: a page the person typed in earlier is reloaded with what they typed, and a tab they are typing in now is kept | M1, M5 |
| A3 Mobile draws 375 wide with the chip; Tablet disabled in a narrow pane; the agent's screenshot and its own viewport reset see the device size | unit (`pageBox`, the pane, the menu, the chip); e2e, the *(device sizes)* scene, which is probe 4, run alone first. The chip's `375 × 812` holds in a pane at least 812 points tall | M3, M5 |
| A4 Copy screenshot, then paste into a composer; a camera request still blocked | unit (the capture and its refusals; `permissions.test.ts` unchanged); e2e, the *(copy screenshot)* scene and the unchanged guards scene. The paste into a composer is the composer's existing image paste, seen at the owner's sitting | M3, M5 |
| A6 the strip with Stop on all three routes; not while a permission answer is waited for; the row's title; the cursor's label | unit (the reading over live rows and over a transcript file's rows, the states under fake timers, the lingering line with no clock, Stop enabled and disabled, the title, the launch's environment); e2e, `computer-use.spec.ts`. By hand: the pill's label on a Mac where the plugin draws its cursor, and probe 1. By R3's ruling the strip does not simply leave after a Stop that withdrew a running call: it reads the lingering line until evidence or Dismiss. Where Stop cannot work it is drawn disabled with its sentence, and it is absent only without a controls port | M4, M5 |
| A8 the three `keep` items | `browser-activity.test.ts`, `permissions.test.ts` and `cua/retained.test.ts` unchanged; the takeover's own tests in `agent/control.test.ts` unchanged beside the new cases; the existing takeover scenes and the first-open scene of the browser's e2e groups green; Concrete Steps 5's last command prints nothing for the delivery folders | M5 |
| A9 the Browser that opens by itself shows the agent's tab, unless the person is using theirs | unit (`agentTabComesForward`, the command, the window's sequence with the command held); `retained.test.ts` unchanged (main selects nothing at an acting command); e2e, the reworked scene of `browser-cua.spec.ts`. A9's clause "or showing a tab the person is not using" is not built: a Browser that is already open is not moved (R2 as ruled) | M2, M5 |

## Proof that an executor does not run

Each line has an owner other than an executor. The controller writes into Progress when a line's precondition is met.

| what | when it can start | what it needs | what comes back, and what it changes |
|---|---|---|---|
| **The adversarial review of this document** | done 2026-11-13 | The architect dispatched it. | Needs-attention with five findings, all accepted; revision 2 folds them in (Decision Log). No executor starts before the architect has this revision. |
| **Probe 1: does Stop halt a running cell?** (the section's probe 1; root, U14's list) | now: it needs nothing of this branch, since the composer's Stop on any build is the same interrupt | A Mac where computer use may act, with the plugin installed; a session MAWS runs; a scratch document with invented content in a text editor. The agent runs one `js` cell that types one character a second into the document for thirty seconds (`timeout_ms` of 60,000); Stop is pressed at five seconds; the characters are counted at forty. | The count, added to Ticket 2 as a comment. Thirty, or clearly more than five: what the plugin's source says, and M4 is built as ruled. About five: the cell stopped, against the plugin's own source; that comes back to the architect before M4, since the lingering state would then warn of nothing. |
| **`unit:darwin`** | after M3, and again on the final head | The Mac runner: `scripts/ci-gate.sh "$PWD" --gates unit:darwin --runner macos --label u12a-darwin`. | The run's id. The VM skips the macOS-guarded cases: those of `src/main/browser/index.test.ts`, whose subject M1 and M3 rewire, and `src/main/browser/cua/retained.test.ts`, whose case "… the tab stays unselected" must pass unchanged as the pin of R2's ruling. After M3: passed at `1d540e733`, run 43370236296 (affected paths, the 61 changed since the merge base; `cua/retained.test.ts` among them). Again with the landing's gate on the final head. |
| **Probe 4, the device-sizes scene, run alone** (root UC-10: a new e2e scene runs alone on a Mac before the final gate) | after M5 is pushed | A Mac under the load rule: the *(device sizes)* scene of `e2e/browser.spec.ts` by itself, in a window tall enough for a pane of 812 points. | A verdict for each of its checks (the frozen picture, zoom at 125%, the comment strip, the floating card's column, Tablet's hint, the agent's override). A failure is fixed in the pane's layout through the controller, never by adding emulation. |
| **The other new and reworked scenes alone, then the e2e groups** | after M5 is pushed | The *(reload)* and *(copy screenshot)* scenes, the reworked scene of `browser-cua.spec.ts`, and `computer-use.spec.ts`, each alone first. Then the groups that hold the specs this change reaches: `e2e:browser`, `e2e:browser-cua`, `e2e:browser-chrome`, `e2e:browser-comment`, `e2e:tools`, `e2e:agents`, `e2e:deliverables`, `e2e:transcript`, `e2e:render-host`, `e2e:remote`, `e2e:default` (which collects the new spec). | Verdicts by group. A red scene goes back to the controller as a fix. The screenshots the scenes attach (the sized page with the chip; the strip's two lines) are there for the architect to show. |
| **Probe 6: did the agent find the browser?** (A1) | after M1, on a build of this branch | A Mac with that build under a scratch config home, the computer-use plugin installed (its version noted), tool search on, an engine login (one short paid turn), and a local page with a button served on localhost (invented content). In a new session: "open `<the page's address>` in the app's browser and test the button". | The turn's tool calls in order, whether "Navigated to…" and "Clicked…" appeared under the `js` call, whether the Browser opened, and whether the reply asked the person to do anything. Found: A1 is met. Not found (a browser skill of the person's can still win the agent's choice): reported with the tool calls; Ticket 1 is the next lever, and nothing more is added to MAWS's instructions without the owner. |
| **The cursor's label, by hand** (A6's last sentence) | after M4, with probe 1's sitting if the build is at hand | A Mac where the plugin draws its agent cursor; a session with a title, resumed on this branch's build, running one computer-use step. | Whether the pill reads the session's title (cut by the plugin at 24 characters). |
| **A cross-build run with F as the peer** | the architect's call | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u12a-xb`. This landing stores nothing new and adds no scene; the run would show only that the group's existing scenes still pass with the wire's minor one higher. | The run's id, if it is run. |
| **The owner's look** | not before the build | No drawn example is asked for: the strip's form and words, the menu's rows and the chip are fixed by the section, follow Claude Desktop's banner and menu, and are each one line or one row. The one thing the owner has not seen in words is the lingering line with its Dismiss, which the rulings added. The owner sees all of it at the sitting (root acceptance 2); the scenes' screenshots, with fixture content, can be shown earlier if the architect wants a word on the lingering line, the strip's place or the sized page's surround. | The owner's word, if asked. |
| **The branch review** | after M5 | `doperpowers:review-code`, the xhigh panel, from the architect's session over `origin/master...ux-wave/U12a` (Decision Log). | A verdict and findings; the fixes are one wave through the controller. |
| **Class 1a** | once, on the head the pull request will carry, after the review's fixes | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u12a`, in the background. | The run's id. |
| **The two tickets** | Ticket 1 now; Ticket 2 now, or after probe 1 so that its text and its comment go together | The texts under "Hand-off", filed on the computer-use plugin's board (the repository `SSFSKIM/cua`) through its tracker scripts. | The two ticket numbers, written into the section's table, the tracker's rows 1, 2 and 5 and the pull request. Filed 2026-11-13: Ticket 1 `SSFSKIM/cua#368`, Ticket 2 `SSFSKIM/cua#369`. |

## Hand-off: the two tickets for the computer-use plugin's board

The texts below are final and each stands alone. They were checked against the plugin's source at its `main`, `9020bb18` (the repository `SSFSKIM/cua`), by this document's author and by the adversarial review. Ticket 2 was amended in revision 2: a host cannot count a cancelled cell's end from its `timeout_ms`, so the ticket asks for a cell that stops on cancellation or, failing that, a signal that says when a cancelled cell has ended.

### Ticket 1 (filed as `SSFSKIM/cua#368`)

Suggested labels: enhancement, priority P2, ready for an implementer.

> **Title:** In a MAWS session, name the in-app browser where the agent looks first (the `js` tool's search hint and rules, the host notes)
>
> **Background.** MAWS is a macOS desktop app that runs Claude Code sessions. Each session it runs has a browser pane beside the conversation, the *in-app browser*, which the person watches and can take over. MAWS gives each session's engine a Unix socket in `CUA_BROWSER_BACKENDS`; with it set, `cua.getBrowser()` with no id is that session's in-app browser (key `maws`), since #13. For the agent this browser is a third surface of the computer-use tool, beside the Mac's screen and the user's Chrome.
>
> **What is wrong.** An agent in such a session does not learn this unless it loads `profiles_list`. The one text that says it is `MAWS_RULE` (`src/mcp/surface.mjs`), which is written only into `profiles_list`'s description. Under Claude Code's tool search `profiles_list` is deferred, so an agent can find and call `js` without ever reading it.
>
> **Seen.** In a MAWS session with tool search on, an agent asked to open a local page "in the app's built-in browser" and test a button opened the page with MAWS's own pane tool, tested it in a separate headless browser, reported that it could not act inside the pane, and asked the person to click. Told to use `cua_repl`, it drove the pane correctly. `MAWS_RULE` had shipped two weeks before.
>
> **Why it is so today.** Every text the agent reads before `profiles_list` points away from the in-app browser:
> - `js`'s search hint with both surfaces on is "control macos apps and the user's chrome browser profiles: click, type, fill forms, read, screenshot" (`BROWSER_HINTS`, `src/mcp/surface.mjs`). Tool search matches on it.
> - The host notes with the computer surface on open with "Use when a macOS app's GUI is the only way" (`COMPUTER_HEAD`) and say nothing of a browser.
> - `js`'s own rules end with a pointer to `profiles_list`'s description, for Chrome (`BROWSER_POINTER`); `jsRulesFor` is not told whether a MAWS backend is configured.
> - The vendor's paragraph on an in-app browser is removed from `js`'s description (`BROWSER_EDITS`, `src/repl-host/instructions.mjs`). That is right, since it describes another product's browser, but nothing replaces it.
>
> **Asked for,** only when a MAWS backend is configured (`inAppBrowser` is true in `modelTools`):
> 1. `js`'s search hint names the in-app browser first, for example: "control macos apps, this session's MAWS in-app browser and the user's chrome profiles: click, type, fill forms, read, screenshot".
> 2. `js`'s rules carry the rule itself and not only a pointer: "In MAWS: cua.getBrowser() with no id is this session's in-app browser (key maws), the pane the user watches; use it for any page unless the user names a Chrome profile. No profiles_list call is needed for it."
> 3. The host notes gain one line saying the same, inside the 2,048 characters the plugin's tests hold them to.
> 4. Optional: one line for the in-app browser in the browser documentation the first `js` call returns, in place of the removed vendor text.
>
> **Unchanged.** With no MAWS backend configured every text is byte for byte what it is today.
>
> **Acceptance.**
> - `tools/list` on a connection with a MAWS backend shows the new hint and the new rule on `js`; the `initialize` answer's instructions carry the new host note and stay within 2,048 characters.
> - The existing tests for a connection without a MAWS backend pass unchanged.
> - In a new MAWS session with tool search on, the prompt "open `<a local page>` in the app's built-in browser and test the button", which names no tool, ends with the agent driving the in-app browser through `js`.
>
> **What MAWS does on its side, without waiting for this.** MAWS adds a paragraph to its own MCP server's instructions for sessions that have the in-app browser ("… With cua_repl's js tool, cua.getBrowser() with no id is this browser, so open, click, type, reload and check pages there yourself instead of asking the user to …"), and its pane tool's answer for a browser page says the same. That reaches an agent that reads MAWS's texts; this ticket reaches the agent whose tool search lands on `js`.
>
> **Context.** #13 (the adapter that shipped `MAWS_RULE`); `docs/doperpowers/specs/2026-10-08-maws-in-app-browser-design.md`.

### Ticket 2 (filed as `SSFSKIM/cua#369`)

Suggested labels: enhancement, priority P2, ready for an architect.

> **Title:** For a host such as MAWS: say what computer use is doing (task open, app in use), and stop the running cell when its call is cancelled, or say when it has ended
>
> **Background.** MAWS is a macOS desktop app that runs Claude Code sessions and shows each one's conversation. It launches the engine itself and reads the engine's stream-json output, and it renders the surfaces mods draw. When an agent in such a session drives the Mac through cua, the person watching MAWS wants to know which session is doing it, what it is acting on, and how to stop it.
>
> **What a host can and cannot do today.**
> - *State.* From the engine's output a host sees a `js` call start, with its code, and end. It cannot see whether a task is open, which app the cell acts on, or whether the cell touches the screen at all: handles persist between cells, the engine's stream-json output forwards no progress notification from an MCP server (read in Claude Code 2.1.322), and approvals are answered by the plugin's Elicitation hook inside the engine. So MAWS can show only "Computer use running" while a `js` call is in flight.
> - *Stop.* A host can interrupt the turn. The engine then withdraws the call (`notifications/cancelled`), and the REPL host does not stop the cell: `src/repl-host/supervisor.mjs` says "running + cancellation: nothing is stopped; the eventual result still settles (the vendor's behaviour)", and the host notes tell the agent "Only timeout_ms stops a running cell, not cancelling" (`GENERAL_NOTES`, `src/mcp/surface.mjs`). After the person presses Stop, the cell may go on acting, with nobody reading its result.
> - *When it is over.* A host cannot tell that either. `timeout_ms` is a budget and not a deadline: `executionBudget` (`src/repl-host/budget.mjs`) is suspended around approvals and a helper's start and resumes with what was left, and a call queued behind another (`enqueue`, `supervisor.mjs`) starts its budget later than the host saw the call. So a host that warns "computer use may still be acting" has no time at which it may stop warning. MAWS keeps that warning until a later call of the session settles, the session ends, the plugin's server is gone, or the person dismisses it.
>
> **Asked for.**
> 1. *The state, told to the host.* Per session: a task opened or closed; the app (or "browser") a cell is acting on, by name; the kind of each acting step (click, type, key, drag), never its content. Either of two shapes would serve, and MAWS can use both:
>    - a mod surface the plugin draws itself (a band such as "Using `<app>` · Stop") in clients that render mods; MAWS prefers this where mods can draw;
>    - a machine-readable report for where no mod draws (a session in a terminal that MAWS only watches, a session on another machine): over the session's existing MAWS backend connection, or to a path the host passes in the launch environment. If it rides the backend connection it must not count as browser demand: MAWS's broker for a session whose browser has not started treats every request it does not know as demand and starts the session's headless browser.
> 2. *Stop.* A cancelled `js` call stops its running cell and releases held input (a pressed button, a held key), or the plugin gives the host another way to stop the session's running cell. Failing both: a signal the host can read when a cancelled cell has ended (its code settled, its budget ran out, or its kernel was reset), so that the host knows when to stop warning.
> 3. *Smaller, optional.* The agent cursor's label is read once from `CUA_CURSOR_LABEL` when the engine starts (#235). MAWS sets it to the session's title at each launch; a label that follows a later rename would need the plugin to read it again at a task's start. The README says MAWS also sets `CUA_CURSOR_COLOR`; MAWS sets the label only and leaves the colour to the plugin's own pick.
>
> **Constraints.** No typed text, page content, secret or screenshot leaves the plugin on this channel: names of apps and kinds of step only. Nothing changes for a client that asks for none of it.
>
> **Acceptance.**
> - In a MAWS session, while a cell clicks in an app, the host can show that app's name within a second of the first step, and shows nothing of the kind for a cell that only computes.
> - Stop pressed during a cell that acts once a second for thirty seconds leaves no further step after the cancel is delivered, and no input stays held. If the cell is not stopped: the host is told within a second of the cell's end that it has ended, also when an approval had suspended its budget and when it had waited behind another call.
>
> **What MAWS does on its side, without waiting for this.** A line across the top of the session, "Computer use running" with Stop, inferred from the call in flight; Stop as a turn interrupt; after a Stop that withdrew a running call, the line "Computer use may still be finishing a step", which stays until a later computer-use call of the session settles, the session ends, the plugin's server is gone, or the person dismisses it; the call's row titled "Used computer use"; `CUA_CURSOR_LABEL` set at launch. When this ticket lands, MAWS shows the plugin's own surface where mods draw, uses the report elsewhere, and ends the "may still be finishing" line on the plugin's word.
>
> **To be added as a comment when it has run.** MAWS's hands-on check: a cell that types one character a second into a scratch document for thirty seconds, Stop pressed at five seconds, the characters counted at forty.
>
> **Context.** #235 (the agent cursor and its label); `docs/doperpowers/specs/2026-10-08-maws-in-app-browser-design.md` (the backend connection).

## The pull request

Opened on the architect's word, not by an executor. Its body:
- opens with the composite's path, the child id (U12, first landing) and the parent pin `510a6d15e`, and names the items (l9-browser-delivery-01 with the agent's tab, -02, -06, -07) and the board ticket #584;
- names its class 1a run by id, on the head it carries, and its `unit:darwin` run;
- names the branch review's verdict and what was done with each finding;
- names its residue: what is not verified (probe 6 and the cursor's label until they are run), what waits (#435's landing; Tickets 1 and 2 by their numbers; Drive delivery, #400), and the five debt rows it adds to the tracker;
- says which e2e scenes ran alone and which groups ran, and where; gives probe 1's count and probe 4's verdicts;
- ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.

The pull request carries the dated lines of the two records this landing amends, where they stand (M5, "The record"): the reversal under row A-54 of the P1 spec's Decision log, and X9's amendment there and in the charter, whose lines the session that keeps master checks.

## Surprises & Discoveries

- Observation: `personHolds` is narrower than the rule the section and the owner's answer state. A tab that reads "You have the page" is not held once its last input is three seconds old.
  Evidence: `src/main/browser/agent/control.ts`, `personHolds` and its comment (cua #103); before E13 the function read `control === 'human' || lastHumanAt within the window` (`git show 368b460e1^:src/main/browser/agent/control.ts`). R1.
- Observation: the navigator's reload is always the person's. Every `navigate` stamps the tab's input seam as human input first, so an agent's reload sent through it would read "You have the page".
  Evidence: `src/main/browser/navigation.ts`, `navigate`: `entry.input.emit({ kind: 'chrome', source: 'human', … })` and the comment above it ("Every caller is the person"); `TabControls.input` in `agent/control.ts`. Found by the adversarial review, 2026-11-13.
- Observation: main can tell a person's key in a page from their other input, and hears each new document, so "typed in since it loaded" would cost one field. Revision 2 built a protection on it; the architect withdrew it the same day (Decision Log), and nothing in this landing reads it.
  Evidence: `src/main/browser/input.ts`, `classify` (`before-input-event` keyDown is the person's key; Esc and taken chords are marked `activation: false`) and `TabInputSeam.emit`; `src/main/browser/tabs.ts`, the main-frame `did-navigate` handler that sets `committed`.
- Observation: the plugin's own source says a cancelled call never stops its cell, which is probe 1's "goes on" outcome.
  Evidence: the plugin's `src/repl-host/supervisor.mjs` at `9020bb18`: "running + cancellation: nothing is stopped; the eventual result still settles (the vendor's behaviour)"; "a running cell is never stopped by a cancellation". R3.
- Observation: a `js` call's `timeout_ms` is not a time a host can count. The plugin suspends that budget around approvals and a helper's start, and runs calls one after another.
  Evidence: the plugin's `src/repl-host/budget.mjs` (`executionBudget`: "suspensions nest, and the budget resumes, with what was left of it, only when the last one ends"); `supervisor.mjs`, `elicit` (`budget.suspend()`) and `enqueue(() => runJs(…))`. Found by the adversarial review, 2026-11-13.
- Observation: the cap on a server's instructions in engine 2.1.322 is 4,096 characters, not the 2,048 the plugin's source records.
  Evidence: `cli.pretty.js`: `MB(e = !1) { return i.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH ?? (e ? g4i : nPr) }` with `nPr = 4096, g4i = 16384`; an SDK server's instructions pass through `ii(ae, b)`, whose default bound is `MB()`. Probe 3.
- Observation: a session's selected browser tab is one value in main for every window, and the daemon's tab engine runs the same `acting` code as the app. A selection made at an acting command would move every window's panel and the `selected` the daemon's inventory tells viewers.
  Evidence: `TabStore`'s `selected` map by session and `browser.tabs.changed` to every window; `src/render-host/tab-engine.ts` calls `startCuaBackend` with no `emit`. R2.
- Observation: the launch's settings are stored in two places and travel further than the engine's environment.
  Evidence: `src/engine-host/store/file-session-state-store.ts`, `saveLaunchSpec` (it leaves out four keys and keeps `extraSettings`); `src/engine-host/launch.ts`, `spawnMeta` (`args` whole, with the `--settings` JSON; only the process environment is listed by key names); the plugin's `src/remote/client.mjs` (`cua/cursor` in a device session's `initialize`). Found by the adversarial review, 2026-11-13.
- Observation: one browser tab can be mounted in two panes at once, at different sizes.
  Evidence: `src/renderer/src/tools/browser/chrome/Chrome.tsx` ("a main tab and the panel may both show it while only one pane holds its view"); `PlacedPane`'s `elsewhere` mode in `Pane.tsx`. Found by the adversarial review, 2026-11-13.
- Observation: the probe's served snapshot cannot be regenerated by its switch without breaking two tests.
  Evidence: `src/shared/maws/search-tools.test.ts` expects the snapshot's only unknown tool to be `message`; `spikes/protocol-probe/fixtures.test.mjs` expects `message` among the always-loaded tools; `MAWS_WRITE_PROBE_TOOLS=1` writes the list without it (the tracker's row of 2026-10-27, P4-R7z).
- Observation: a subagent's computer-use call is not in the spans the section names for the strip.
  Evidence: `turnSpanOf` iterates `turn.events`; a child agent's events are pushed to `turn.children` (`applyChild`, `pushChild` in `transcript/model/reduce.ts`).
- Observation: a withdrawn call cannot be told by its denial on every route.
  Evidence: `src/engine-host/fs/backfill.ts` writes `denial: null` for rows read from a transcript file ("denial kinds are not recorded on disk in a parseable form"); the live wire carries `tool_result_meta[].non_execution_kind` (`pass3/p1-maws-ask-interrupt`, the row after the interrupt). §E reads the interruption marker as well.
- Observation: `maws.pane.answer` is on the wire between the app and the engine host, so `page` moves the wire's minor.
  Evidence: `src/shared/ipc/wire-manifest.json`, `commands.maws.pane.answer`; `src/shared/ipc/wire.ts`'s rule that an added optional key is additive and bumps `WIRE_MINOR`.
- Observation: Concrete Steps 3's regeneration leaves the VM's checkout of the branch dirty, so the next `vmcheck` aborts at its checkout.
  Evidence: M1's executor, 2026-11-13; it reset the two files over `devcloud vm ssh`. The recipe now ends with a `git checkout` of the two files.
- Observation: the `maws` server writes a tool's result as indented JSON (`toolText`, `JSON.stringify(value, null, 2)`); the key order `status`, `pane`, `opened`, `page`, `note` holds in it.
  Evidence: M1's executor, 2026-11-13; `src/engine-host/session-maws.test.ts` reads it so.
- Observation: Electron 44's `clipboard` has no `writeImage`; it writes through the W3C-shaped `write(ClipboardItem[])`, and its documentation does not say that an `image/png` item reaches the macOS pasteboard as an image another app's paste reads.
  Evidence: `node_modules/electron/electron.d.ts` of `electron@44.4.5` on the VM (`write(data: ClipboardItem[]): Promise<void>`, `class ClipboardItem`). M3's executor, 2026-11-13. The *(copy screenshot)* scene of M5 and the owner's paste into a composer are what show it.
- Observation: a replay journal's `system/init` must list the plugin's server as connected, or a withdrawn call's lingering line resolves at once: the session status's MCP server list is set only from `system/init`'s `mcp_servers`, and the recorded inits list none.
  Evidence: `src/engine-host/session-status.ts` (the `mcp_servers` read at init); `pass2/auto-routed` seq 9 (`mcp_servers: []`). M5's executor, 2026-11-13; `e2e/support/computer-use-replay.ts` sets `[{ name: 'plugin:cua:cua_repl', status: 'connected' }]`. In a real session this is §E's evidence rule working as designed.

## Decision Log

- **2026-11-13 · Verification** (the one entry written at authoring). This document gets an adversarial review before any executor starts; the architect dispatches it. Each milestone is reviewed at its boundary by the controller's reviewer before the next starts. The branch gets `doperpowers:review-code` at the xhigh panel, on size: about seventy files and about 2,700 changed lines, over the threshold of about twenty files or two thousand lines. Neither the root's UC-10 nor the section calls this landing delicate; the panel is asked for a lens on the browser's takeover rule (`personUses` beside `personHolds`, and the selection at an acting command) and one on the texts and shapes under X9 with the wire's addition. A new or reworked e2e scene runs alone on a Mac before the groups. Class 1a on GitHub Actions is the gate of record, on the head the pull request carries; `unit:darwin` runs beside it because the VM skips the macOS-guarded cases this landing changes.

- **2026-11-13 · Revision 2: the architect's rulings on R1 to R9, the adversarial review's five findings, and the reload of a page the person has typed in.** The review's verdict was needs-attention; its five findings are all adopted. It found sound, with no change: the launch-spec gate and the paragraph's 343 characters, the additive wire keys against build F, the hand-edited probe snapshot, the wrapper U5a expects, the consumed names, Copy screenshot, the assignment of the macOS-only tests, and both tickets' grounding in the plugin's source. No milestone was added or removed. The size becomes about 3,000 changed lines over about 75 files; the rung stays the xhigh panel, and its first lens now reads `personUses` and `personTyped` beside `personHolds`, the reload that is not the person's input, and the window's sequence for the agent's tab.
  - Decision (R1, stands): a new `personUses`, the tab's control is `human` or `personHolds`; `personHolds` is not changed.
    Rationale: the owner's answer names both conditions and today's function has only the grace. Rejected: widening `personHolds` itself, which the takeover gate reads, so a command held for the person would no longer resume when the grace ends while the tab still reads "You have the page" (what cua #103 fixed).
    Date/Author: 2026-11-13, the architect's ruling.
  - Decision (R2, narrowed): the agent's tab is selected only together with a window's own opening of the Browser, by a command the window sends first (`browser.agent.show`), under main's guard; main selects nothing at an acting command; `src/main/browser/cua/` is not touched (§C, M2).
    Rationale: the owner was asked about the Browser opening by itself and answered "Yes, unless I use mine". Rejected: main selecting at each lease's first acting command, this document's first default and the section's mechanism, which can move the selection several times in a turn, changes a tab the person is reading in a Browser that is already open, and changes another window's panel. Also rejected: opening the tool first and asking main after, which mounts the panel on the previous tab for a frame; and a selection kept per window, a new piece of state for an arrangement (two windows on one session) that the placement guard already covers where it matters.
    Date/Author: 2026-11-13, the architect's ruling; the mechanism and the placement guard are the author's.
  - Decision (R3 and review finding 1): "the cell goes on" is built with no deadline. The lingering line leaves on evidence (a later computer-use call's ordinary result, the session's process gone, no connected computer-use server in the session's status) or at Dismiss; `lingerUntil` and the default timeout constant are gone (§E, M4). Ticket 2 asks for a cell that stops on cancellation or, failing that, a signal when a cancelled cell has ended.
    Rationale: the call's `timeout_ms` is a budget the plugin suspends around approvals and a helper's start, and a queued call's budget starts after its row, so a deadline counted in the window can pass while the cell still acts. Rejected: first-seen plus `timeout_ms`; and subtracting the permission waits the window knows of, since an approval raised as an MCP form cannot be tied to a call.
    Date/Author: 2026-11-13, the architect's ruling on the review's finding 1.
  - Decision (R4, replaced by review finding 3): Stop is enabled or disabled from `useRemoteUnavailable`'s sentence and the port's interrupt capability, never from the session being on another machine; disabled, it carries the sentence; a refused interrupt shows its own message; it is absent only without a controls port (§E, M4).
    Rationale: `session.interrupt` is offered over the link and the helper answers null while it can work, so the first default disabled a control that works and had no sentence to show. Rejected: disabling it for every session on another machine; absence where the port names a reason; enabling it again after a refusal without saying why.
    Date/Author: 2026-11-13, the architect's ruling on the review's finding 3.
  - Decision (R5, stands): the chip opens the three choices.
    Rationale: the section's "After". Rejected: A3's one click back to Responsive, with which the chip could not change between Mobile and Tablet.
    Date/Author: 2026-11-13, the architect's ruling.
  - Decision (R6, stands): the insertion in `src/engine-host/tool-server/server.ts`; the architect adds it to root UC-8.
    Rationale: the server answers the instructions and must be given them. Rejected: keeping the server's import and choosing the text inside it from a flag of its own, which would put the gate's rule in a file of U10's.
    Date/Author: 2026-11-13, the architect's ruling.
  - Decision (R7, stands): X9's dated line is written in the P1 spec's row and in the charter's X9 paragraph, with an entry in the charter's §19; the session that keeps master checks the charter's lines at the pull request. With R9 reversed the line names one refusal, for a page MAWS could not open; the loopback refusal stays #435's.
    Rationale: the section names one place and root UC-15 the other. Rejected: one place only.
    Date/Author: 2026-11-13, the architect's ruling.
  - Decision (R8, stands): no `note` in a session launched without a browser backend.
    Rationale: the note's sentence would be false there. Rejected: the note for every browser answer, as the section words it.
    Date/Author: 2026-11-13, the architect's ruling.
  - Decision (R9, reversed): a `browser.tabs.open` that main refuses is answered `{ ok: false, error }` with the new text `browserOpenFailed`, and nothing is opened (§A, M1).
    Rationale: the refusal's branch and its carriage to the agent exist. Rejected: this document's first default, "shown" without `page`, which tells the agent its page is there while the pane shows an old or different tab.
    Date/Author: 2026-11-13, the architect's ruling.
  - Decision (review finding 2): `show_pane`'s reload goes through a new `Navigator.reloadForAgent`, the reload's body without the stamp on the input seam; `navigate` is unchanged for the person's callers; `src/main/browser/navigation.ts` joins M1.
    Rationale: `navigate` stamps every call as the person's input, so the agent's reload would turn a tab the agent controls to "You have the page" and make the next request `kept`. Rejected: a flag on `navigate`, which every one of the person's callers would then pass through; and removing the stamp after the fact, which the control's listener has already acted on.
    Date/Author: 2026-11-13, the author, on the review's finding 2.
  - Decision (review finding 4): the room a device size must fit is told by the pane that holds the view to its own `BrowserView`, beside `owns`, and passed to that mount's chrome; nothing of it is in the browser store (§D, M3).
    Rationale: one tab can be mounted in a main tab and in the panel at different sizes, and a per-tab entry lets one pane's width decide the other's menu. Rejected: the per-tab entry of the first version; and a store map keyed by pane, which works but has a single reader, the mount's own chrome.
    Date/Author: 2026-11-13, the author, on the review's finding 4.
  - Decision (review finding 5): the label's places are listed as they are (the session's state file, the engine's arguments and the journal's `spawn` row, the plugin, a remote device, the screen); nothing is redacted; evidence that leaves the machine uses invented titles; a test holds that a stored launch spec carrying the label is saved and read back whole, which is what build F's reader, the same file, does with it (constraint 10, §F, §H, M4).
    Rationale: the first version said "in the environment and nowhere else" and "not stored", and both were false. Rejected: redacting the journal's argument list, a change to a row whose whole content is its record, which no ruling asked for; and carrying the label another way, since the settings environment is the one way a launch adds a variable for the engine.
    Date/Author: 2026-11-13, the author, on the review's finding 5.
  - Decision (the architect's question on a half-filled form; withdrawn by revision 3, below): `show_pane` does not reload a page the person has pressed a key in since its document loaded; the answer is `kept` and the note `browserTyped` says why. `TabInputSeam.lastHumanTypedAt` and `personTyped` carry it; `held` tells the engine host which note to write (§A, §B, §C, M1).
    Rationale: main can tell it for the cost of one field in a hook that already runs for every key, and the three-second rule alone lets a form left half-filled be reloaded. Rejected: stating the limit and reloading; and asking the page whether it has unsaved input, which is new plumbing and runs the page's code on an agent's request. Its cost is stated where the rulings are listed: a key that types nothing keeps the page, and so does a page the person typed in while testing it; the agent reads why and can reload through the plugin.
    Date/Author: 2026-11-13, the author, on the architect's instruction.
  - Without a change of decision: the Drive sentences cite board ticket #400, of which #603 was closed as a duplicate. `unit:darwin` stays on the architect's list for another reason than at authoring: no macOS-guarded case changes any more; `retained.test.ts` must pass unchanged, and `src/main/browser/index.ts`, whose tests are partly guarded, is rewired by M1 and M3. M5 adds six rows to the debt tracker.

- **2026-11-13 · Revision 3: the typed-page protection is withdrawn.** The architect accepted revision 2 with this one amendment. Everything else of revision 2 stands, among it `browser.agent.show`, `Navigator.reloadForAgent`, the room by pane, the lingering line with no timer and its Dismiss, Stop from the helper's sentence, the refusal for a page MAWS could not open, and both ticket texts.
  - Decision: `show_pane` on an address already open reloads the tab unless `personUses` holds for it (input in that tab within three seconds, or it reads "You have the page"). A page the person typed in earlier is reloaded like any other. Removed from the document: the fifth row of §B's table, the note `browserTyped`, the optional `held` beside `page` on `browser.tabs.open` and on `maws.pane.answer`, `TabInputSeam.lastHumanTypedAt` and `personTyped`, the second debt row, and their tests; `src/main/browser/input.ts` leaves M1. The limit is stated where the rule is (§B; M1): a reload by the agent discards what was typed in the page, as any reload does, and the only protection is `personUses`. The wire's one minor now carries one optional key, `page`, in `maws.pane.answer`'s `ok: true` branch.
    Rationale: the item exists so that a person who tested a page and asked for a fix sees the new page without reloading it themselves, and that person has almost always typed in the page. Rejected: keeping a page the person has typed in since it loaded, which revision 2 built on the architect's conditional ruling (main can tell it cheaply): it made A2's first sentence false in the item's own main case, and an agent told the page was kept would reload it through the plugin anyway. A2's second sentence, a tab kept while the person is typing in it, is `personUses` and stands as written.
    Date/Author: 2026-11-13, the architect's ruling; revision 2's entry on the half-filled form is superseded by this one.
  - Without a change of decision: M5's debt rows are five, and the rows the tickets resolve are 1, 2 and 5. The review panel's first lens reads `personUses` beside `personHolds`, the reload that is not the person's input, and the window's sequence for the agent's tab.

- **2026-11-13 · Execution begins (the controller).** The plan runs under subagent-driven execution: a fresh executor per milestone, each milestone reviewed clean before the next is dispatched, as the Plan of Work asks. The reviews run one after another and never beside an executor, because two `vmcheck.sh` calls on one branch collide on the VM checkout's git lock. The branch merged master `be663d261` (step 0) at `e1c92a4dc`; nothing in the files this landing touches moved since `6e8c72738`, so the statements under "What the code holds today" stand and no interface needed re-pinning. The two tickets' numbers are written where this document names them (Progress, the Hand-off headings, M5's debt rows 1, 2 and 5). The whole-branch review and the pull request stay the architect's, as the Decision Log's first entry says.

- **2026-11-13 · The build rule changes (the architect).** The whole unit suite runs once per landing, at M5, before the hand-back; M1 to M4 prove themselves by the typecheck of each project changed, eslint on the files changed, and vitest over the directories touched plus the test folders that import what changed, named in the milestone's report. Nine landings share three build VMs, and two whole-suite runs on one VM time out every other check there. Concrete Steps 4 is amended to match.
  Date/Author: 2026-11-13, the architect's rule (`~/.local/share/maws-ux-wave/briefs/build-common.md`).

- **2026-11-13 · M1's executor decisions** (folded by the controller; each the means the document left open).
  - A store with no `reloadForAgent` (the daemon's tab engine) answers `kept` for a loaded tab under `reload`, so it never says `reloaded` for a reload it cannot make. Nothing sends `reload` there today.
  - A repeated request id answers the first call's `page` when the first call had one.
  - After the window's own open, the Browser tool is opened with params `{ appSessionId }` and no `requestId`: the dedup by request id is the open's, and the session is kept so a pinned Browser switches to the session.
  - The backend test is `hasInAppBrowser` in `src/engine-host/session.ts`: only a non-empty string `CUA_BROWSER_BACKENDS` counts.
  - `MawsToolServerDeps.instructions` is required, as §A writes it; tests that build the server pass it.
  - `reloaded` means the reload was commanded: the store does not read `reloadForAgent`'s boolean, as for the suspended-tab row.
  - The test of the wire addition against build F's schema is `src/shared/ipc/pane-answer-page.test.ts`.

- **2026-11-13 · M2's executor decisions** (folded by the controller).
  - `browser.agent.show`'s handler reads the session's selected tab through `store.list(...).selected`, so `src/main/browser/tabs.ts` is not edited by M2.
  - `BrowserHandlerDeps` gains an optional `now()` clock (default `Date.now`) for the handler's tests; `src/main/browser/index.ts` is not edited.
  - Outside a turn (the e2e route), one ask per session at a time: an acting event during the wait asks nothing more there either.
  - An ask that rejects outright is treated as a refusal: the tool opens as before, so the opening cannot stay stuck. After the wait the window also checks it is still connected; a disconnect during the wait opens nothing.
  - The command's schema entry sits after `browser.agent.activities.list`, outside E13's block markers.
  - Until M5 reworks it, the e2e scene "the Browser panel follows the agent: … and the agent's tab is not selected" asserts what M2 reverses.

- **2026-11-13 · M3's executor decisions** (folded by the controller).
  - `[data-browser-page-box]` is always present, as §D's DOM block draws it; two assertions of `Pane.test.tsx` that read the column's first child now read the box with the page element inside, with their meaning kept.
  - The room is the page box's `getBoundingClientRect`, rounded down to whole points. The placement is reported again whenever the room or the size changes, because a centred element can move without resizing.
  - A device size applies while a pane is claiming or holds the view, never while it draws "Shown in another pane".
  - An extension's options tab is refused twice: `TabStore.setViewport` answers false and the handler turns that into `invalid_input`.
  - Viewport is the last item of the zoom group and Copy screenshot follows Copy URL; the two commands sit after `browser.agent.show`.
  - The chip is drawn whenever a size is on and this mount has room. One `ViewportChoices` component serves the menu and the chip; choosing the size already marked sends nothing.
  - Copy screenshot writes one `image/png` `ClipboardItem` from `toPNG()` (Electron 44 has no `writeImage`; Surprises); `writeImage` is a required dependency of the handler.
  - The surround of a sized page is the `bg-bg-active` token.

- **2026-11-13 · M4's executor decisions** (folded by the controller; the third to fifth are readings of §E's words).
  - The strip's states are a `StripTracker` behind `useComputerUse`, read through `useSyncExternalStore`, with one timer, cleared at unmount.
  - The running turn is the session's last turn the engine accepted, and only while it is open and neither the store nor the controls port says it is not running; any other open turn is read as closed, so its unanswered calls read `withdrawn`. Corrected at M4's review (2026-11-13): it first read the last turn accepted *or closed*, so a queued prompt cancelled, discarded or refused behind a running call became the latest turn and the call read `withdrawn`, taking Stop away while it ran. A prompt dropped before it starts receives no engine events, so leaving it out loses nothing.
  - A turn's own calls and its subagents' calls are merged by their start, which is used only to tell which call came later (the evidence's "started after it").
  - A subagent's error result is `withdrawn` when the interruption marker follows it in its own list or appears anywhere in the turn's own events.
  - When several calls the strip showed are withdrawn, the latest is the unresolved one and the earlier count as resolved; a call withdrawn while the strip is `absent` never makes the line linger. An accepted limit: a withdrawal and a new turn's start in one event batch leave no lingering line.
  - "Used computer use" is written in `transcript/model/copy.ts` itself, so the transcript model imports nothing from `computer-use/`.
  - The cursor label drops control characters, trims, and is cut at 64 code points. The launch tests not about the label (E13's socket case, P4-A2's profile block) now resume an untitled record and keep their meaning; the label has its own block.

- **2026-11-13 · M5's executor decisions** (folded by the controller).
  - A replay journal that plays a computer-use call lists `plugin:cua:cua_repl` as a connected server in its `system/init` (Surprises): without it the status lists no connected computer-use server, which is §E's evidence that the cell is over, and the lingering line resolves the moment it would show. Any later scene or fixture that needs the lingering line carries the same init.
  - The record's dates are the commit's day in UTC, 2026-11-13, as this document's times are; the reversal's fixed sentence keeps "Reversed 2026-11-12", the day of the owner's answer.
  - The *(reload)* scene reads main's outcome by a second `browser.tabs.open` under the same request id after the window's own call has visibly landed, which answers the remembered `page` and does nothing else (what a second window does). A transcript link is stood in for by the request `BrowserHandle.open` sends for a target (no `reload`), since the app has no seam that opens a panel tool with a target; `BrowserTool.test.tsx` pins that the handle sends none. "Kept" is made visible by selecting another tab before `show_pane`, so the selection's return proves main handled the request, with the three-second window checked explicitly.
  - The *(copy screenshot)* scene asserts what `clipboard.read()` gives back (an `image/png` kind, a PNG signature, a decode, the size at device pixels within a pixel); whether macOS reports `public.png` is attached as an annotation, not asserted.
  - The computer-use journals have their own builder, `e2e/support/computer-use-replay.ts`, rather than an extension of `SideJournal`, whose writer is shared by the side, library and remote specs. It records no `get_status` after a result, since a recorded one the host did not send would hold the replay. Each of the three scenes launches once.

- **2026-11-13 · The branch review's seven findings, ruled by the architect; one fix wave.** The xhigh panel over `c0e7b2ae8..03805fc20` confirmed seven findings (all P2) and refuted one (a withdrawal and a new turn's start in one batch: the accepted limit above). The rulings:
  - The computer-use line's evidence. The rule they share: where two readings are possible, the line stays, because a line kept until Dismiss is the lesser fault and a line cleared while a step may still run is the greater one.
    1. A later call's result is evidence only when it shows that call's cell ran: a later computer-use call whose result is not an error (or, if the plugin's answers given before a cell is queued are not error results, a reader that tells them apart by the plugin's own sentences, cited at its pin).
    2. An interruption marker withdraws only the calls the interruption cut: the error results between the marker and the last event before it that is not a tool result; in a child's list, only its trailing error results.
    3. Nothing is settled for good by a result that can still be read differently: the later-result evidence is derived from the current reading at each look; only the process gone, the server gone and Dismiss are kept.
    4. The process is gone only when something says it exited: a failed turn with a live process leaves the line.
  - The agent's tab coming forward. The person's act wins.
    5. `agentTabComesForward` also answers no while a panel in any window shows any tab of the session. No stamp of the person's input is added to the chrome's selection.
    6. An opening that waits for `browser.agent.show`'s answer is dropped when, in the meantime, this window adds or removes the session's Browser tool or changes the session it shows.
    7. The tool opens by the agent only once this window's list of tabs holds the selection main answered with; `browser.agent.show`'s answer names the session's selected tab. When the agent's tab did not come forward, the opening is as before.
  Date/Author: 2026-11-13, the architect's rulings on the panel's findings.

- **2026-11-13 · The panel's fix wave as built** (the executor's decisions, folded by the controller).
  - Item 1 took the first form. At the plugin's pin `9020bb18`, every answer given without running a cell is an error result: `src/mcp/results.mjs` makes each sentence answer an error by default, the empty-source answer in `src/repl-host/supervisor.mjs` is returned before the queue, and `rejectionResult`, `noMoreWork` and "Unknown tool" in `src/mcp/server.mjs` are errors. The answers that are not errors (`js_reset`, `end_task`) come after the earlier cell has settled. The reading gains a state `failed` beside `done`; only `done` is evidence. No plugin sentence is copied into MAWS. Not probed: that an MCP JSON-RPC error reaches the transcript as an error result; either way such a call cannot read `done`.
  - Item 2: a marker withdraws the unbroken run of tool results right before it; in a subagent's list, its trailing run when the turn holds a marker. Checked against `spikes/protocol-probe/fixtures/queue-and-interrupt.jsonl` and `pass3/p1-maws-ask-interrupt.jsonl`, by a test that replays both through the normalizer and the reducer.
  - Item 3: the tracker keeps every withdrawn call the line showed, each with the calls after it as last read, refreshed at each look; the line names the latest one no `done` resolves and leaves when none is left. Kept for good: only the process exited, the server gone and Dismiss, which settle every entry at once. Corrected at the wave's task review (`70ad30f89`, the controller's ruling, accepted by the architect): the wave first also settled the earlier calls for good when a later shown call was withdrawn, which the ruling's list excludes. Rejected: a rebuild from the current reading alone, under which a next turn with no computer-use call would bring the line back for a cell that is over; each entry keeps its last-read calls across turns instead.
  - Item 4: the datum is `processGoneOf`: the session's engine status says `process: 'exited'`, or its digest phase is `exited`. `failed`, `foreign` and the transcript's `ticks` are left out. So a turn the store says has stopped ticking now turns a shown call's line into the lingering one instead of clearing it.
  - Item 5: `agentTabComesForward` takes the session's tabs as a fourth parameter, built in the handler; `tabs.ts` is not edited.
  - Item 6: the window watches the layout store while the answer is out. Rejected: a value compared at the answer, which cannot see an open-then-close.
  - Item 7: `browser.agent.show` answers `{ selected: BrowserTab | null }`, and the window writes that selection into its own list (`agentTabSelected`) before it opens the tool. Rejected: waiting for main's list to arrive, which can leave a wait that opens the Browser minutes later. The command is between main and the windows only, so no `WIRE_MINOR` moves.
  - Nothing under `e2e/` changed. The scenes these reach: the three of `e2e/computer-use.spec.ts` and the A9 scene of `e2e/browser-cua.spec.ts`.

- **2026-11-13 · Three scene faults from the first Mac run (run 43393240279, at `03805fc20`), fixed in the scenes.** The product was right in all three. (1) The *(device sizes)* scene asserted `375 × 812` at page zoom 125%, where the zoomed Mobile size (1,015 points) is taller than the runner's pane and the page reads `375 × 627`. §D already settles it: each side of the page box is limited to the room, and `reads`, what the chip shows, is that side divided by the zoom, so the chip states what the page's `innerWidth` and `innerHeight` read at every zoom. The scene now compares the chip with the page's own size when zoomed, and keeps `375 × 812` only at 100%, where it has made the room tall enough. (2, 3) The two `computer-use.spec.ts` scenes took a screenshot of the session pane's `<section>`, which is `display: contents` and has no box; they now take its `[role="tabpanel"]` body after asserting it is visible. Their bodies were re-read against the panel's rulings 1 to 4 and hold.

- **2026-11-13 · Class 1a at `c6d4b03dd` (run 43404914399) red in three text and pinned-list checks; fixed as the architect ruled** (commits `80653df37`, `e67008215`, `2e4ee4f64`, `0c5eea5b1`).
  - `src/shared/machine/address-paths.json` gains `commands.browser.agent.show.output.selected.appSessionId`. Reviewed: only this machine's sessions reach that answer. The command names a tab, its one caller passes no machine, and it asks only after `browser.agent.acting`, which only this machine's computer-use connections send. So the id is a bare local id, and the renderer's client lifts it to the local machine as it does for the neighbouring `browser.*` paths. If the command ever serves another machine's sessions, its handler needs the bare-id step `browser.tabs.open` takes; today's caller cannot reach that case.
  - `.github/scripts/e2e-default-specs.test.mjs` pins 109 spec files, and `e2e/computer-use.spec.ts` is in `e2e:default`'s own list.
  - The *(reload)* scene's three-second window is staged, not bounded. Each try counts from just before the first key to main's answer, and only a try under 3 s asserts `kept`. A try outside the window is repeated from a clean state made by the product's own reload, at most `KEPT_TRIES` (3) times. When no try lands inside, the case is skipped with a reason naming the runner's load. The later marker and hit counts are counted from the loads after the loop. The guard is unchanged.
  - On the VM: `node --test .github/scripts/*.test.mjs scripts/*.test.mjs` 556 of 556; `vitest run src/shared/machine` 12 of 13 files, the one failure `git-reads.test.ts` on build-common's list; e2e `tsc` and eslint on `e2e/browser.spec.ts` exit 0. Under `src/`, only `address-paths.json` changed since `c6d4b03dd`.

- **2026-11-13 · The chain merge of `90a91001e` (`origin/ux-wave/U7`), at `74866d867`.** The wave's landings reach master as a chain, each branch holding the ones before it. `90a91001e` holds master with U13a and the moved-transcript landing, U1a (requests) and U7a (sidebar), and this landing's class 1a and Mac set run once on the merged tree.
  - Four conflicts, each one where both sides added, resolved by keeping both with the chain head's first:
    - the charter's §19 entries;
    - the tracker's last rows;
    - `WIRE_MINOR`;
    - the wire fingerprint.
  - `WIRE_MINOR` is 38. The chain head's 37 is U1a's: `laneA.accepted`, a remote lane A state's `accepted`, and a plan answer's mode. This landing's `maws.pane.answer` `page` takes 38, and the history note names both. The auto-merged manifest held the union of both sides at 37. The wire test refuses a minor bump when nothing has changed since the manifest's minor, so the manifest and the fingerprint were regenerated from the chain head's manifest (`747a82d5d`), and 38 records what this landing adds.
  - `address-paths.json` needed no rewrite. The merged file lists both sides' paths, and `coverage.test.ts` passes. The one path new against the chain head is this landing's `browser.agent.show` answer, reviewed in the class 1a fix wave.
  - U1a redrew the request card as one button per scope. The computer-use permission scene answered its card with the old radio and Allow; it now presses `Allow once` (`ec73a220e`), as the merged helper `allowNext` does. No other scene of this landing answers a request card.
  - On the VM at `ec73a220e`:
    - the `tsc` of node, web and e2e, and eslint on the files both sides changed: all pass;
    - vitest over `session`, `tools/browser`, `shared/ipc` and `shared/machine`: 126 of 127 files pass; the one failure, `git-reads.test.ts`, is on build-common's list;
    - the gate's script tests: 556 of 556, so the spec-file count holds on the merged tree.

## Outcomes & Retrospective

**2026-11-13, at the executors' end (before the architect's runs).** The five milestones are built and each was reviewed clean at its boundary; the branch review, the Mac runs and class 1a are the architect's and are not in this entry.

What exists. M1: a session MAWS launches with a browser backend is given the second paragraph (343 characters; 1,044 in all), and `show_pane` on an address already open reloads it through `Navigator.reloadForAgent`, never as the person's input, unless `personUses` holds; the answer carries `page` and, with a backend, the note; a refused open is a refusal; `WIRE_MINOR` is 37 for the one key on `maws.pane.answer`. M2: the window asks `browser.agent.show` before its own opening of the Browser, and main selects the agent's tab under `agentTabComesForward`; nothing selects at an acting command. M3: Viewport (Responsive, Mobile, Tablet) and Copy screenshot in the options menu, the chip, the page box with the room per mount, never persisted. M4: the computer-use strip with Stop and the lingering line that leaves only on evidence or Dismiss, "Used computer use", and `CUA_CURSOR_LABEL` at a resume. M5: the scenes for A2, A3 (probe 4), A4, A6 and A9, the record (X9 amended in the charter and in the P1 spec's row A-54, which is also reversed; the charter's §19) and five debt rows naming `SSFSKIM/cua#369` where it resolves them.

Against the purpose. Every acceptance item's unit half is in and green on the VM; none of the e2e halves has run, so A2, A3, A4, A6 and A9 are written, not proved. A1 waits for probe 6. Whether Copy screenshot pastes as an image in another app is open: Electron 44 writes through `clipboard.write` with an `image/png` item, and the *(copy screenshot)* scene's read-back is the first evidence.

What the reviews changed. Two Important findings, both fixed by the milestone's own executor and re-reviewed: M4's reading took a queued prompt cancelled behind a running call for the engine's turn, which took Stop away while the call ran; M5's copy-screenshot scene did not restore the person's clipboard when an assertion failed (two rounds: the first fix still waited for the notice before it knew its image). The deferred Minor findings are all test output that is not this landing's: the known VM failures of build-common's list, `[browser]` warnings from unchanged `src/main/browser/index.test.ts` cases, and concurrent-rendering errors naming a missing terminal token that master prints too.

Lessons. The first is about the process; the other three are facts about the code. (1) A recipe that regenerates files on a shared build checkout must leave it clean; Concrete Steps 3 now does. (2) A replay journal that plays a computer-use call must list the plugin's server as connected in its init, or the lingering line resolves at once (Surprises). (3) "The turn the engine took" is an accepted turn, never merely a closed one: a dropped prompt closes a turn too. (4) The build rule changed mid-run (the whole suite once, at the last milestone); it saved four whole-suite runs, and the milestone reviews still caught what they caught.

