# UX wave · U12, first landing (U12a): the in-app browser as the agent's browser, device sizes, and computer use in the session

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U12, first landing (**U12a**). **Parent pin:** `510a6d15e`, the head of branch `ux-wave-spec` that carries the owner's three answers of 2026-11-12 and the deferral of the Drive item in the child's file.
>
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U12-browser-computer-use-delivery.md`, cited below as *section* (its acceptance items as A1 to A9, its items by their register ids, its probes as probe 1 to probe 6). This document carries the constraints, the milestones and the interfaces, and nothing of the design. Until the spec's corrections are on master, the root and the section are read on branch `ux-wave-spec`.
>
> **Branch:** `ux-wave/U12a`. **Board:** #584, under epic #573. **Items:** l9-browser-delivery-01 (with the agent's tab, A9), l9-browser-delivery-02, l9-browser-delivery-06, l9-browser-delivery-07. **Not in this landing:** #435, a pane the agent opens appearing on the device that sent the turn, which is a later landing after U9's ("The landing's edge" says what is left for it). l9-browser-delivery-09 (Send to Drive) was deferred out of the wave by the owner on 2026-11-12, board ticket #603.

## Purpose

Today an agent asked to open a page "in the app's browser" and test it opens the page with MAWS's pane tool, tests it somewhere else, and asks the person to click. When it shows a page it has just fixed, the Browser keeps the old page until the person reloads. When the Browser opens by itself because the agent started working in a page, it shows whatever tab was selected before and not the agent's. While an agent drives the Mac through computer use, nothing in the session says so and the row of the call reads the plugin's id. The Browser has no device size and no way to copy what it shows.

After this landing a session MAWS launches with its browser is told, in MAWS's own words, that the Browser pane is its browser. `show_pane` on a page already open reloads it, unless the person is using that tab, and tells the agent which happened. The Browser that opens by itself shows the agent's tab, unless the person is using theirs. The Browser's options menu has Viewport (Responsive, Mobile, Tablet) and Copy screenshot. While a computer-use call runs, the top of the session reads "Computer use running" with Stop, the call's row reads "Used computer use", and the plugin's on-screen cursor carries the session's title. The two changes only the computer-use plugin can make leave this document as two ticket texts ("Hand-off").

**How to see it working.** In the suites: the unit tests named under each milestone, and the e2e scenes of M5. By hand on this branch's build: in a new session, ask the agent to open a local page in the app's browser and test a button, and watch it drive the Browser pane; edit the page and have the agent show it again; choose Viewport › Mobile; ask the agent to act in an app and watch the line at the top of the session.

## Progress

- [x] (2026-11-13 00:40Z) Document written against master `6e8c72738`; the section checked against the code at that head ("What the code holds today"), and the points that need a ruling listed ("Reported to the architect").
- [ ] Adversarial review of this document (the architect dispatches it), and the architect's rulings on R1 to R9, folded in.
- [ ] Probe 1 (Stop during a running cell), which can run today on any build ("Proof that an executor does not run"); its result settles R3 before M4 is built.
- [ ] Step 0 on master (U6a and U8a both landed); this branch merges master. U8a is on master at this writing and U6a is not.
- [ ] M1 — What the agent is told, and `show_pane` on a page already open.
- [ ] M2 — The agent's tab comes forward.
- [ ] M3 — Device sizes and Copy screenshot.
- [ ] M4 — Computer use in the session.
- [ ] M5 — The e2e scenes, the record, and the acceptance run.
- [ ] The proof an executor does not run: `unit:darwin`, the new scenes alone and then the e2e groups, probe 4, probe 6, the hands-on check of the cursor's label, the branch review, class 1a on the final head.
- [ ] The two tickets filed on the computer-use plugin's board (the architect), and the pull request opened on the architect's word.

## The landing's edge

**In.** l9-browser-delivery-01: the paragraph of instructions for a session with a browser backend, the `note` in `show_pane`'s browser answer, and the agent's tab coming forward (A1, A9). l9-browser-delivery-02: the reload, its three outcomes and the changed description (A2). l9-browser-delivery-06: the Viewport submenu, the chip, the sized page, Copy screenshot; site permissions stay as they are (A3, A4). l9-browser-delivery-07: the strip with Stop, the row's title, the cursor's label at launch (A6). The `keep` checks of A8. The e2e scenes for these, and the dated lines of the two records this landing amends (X9; row A-54 of the P1 spec's Decision log).

**Out.** Everything the section lists under "Not in this child" (the browser's comment items are U5's; localhost links and "Open in" are U6's; how tool runs are grouped is U2's). Scaled or custom sizes, touch and user-agent emulation, a full-page capture, a site-permission prompt. The app's name anywhere in the strip, a sidebar mark, stopping a cell that is already running (Ticket 2). Any change to the keymap table. The register and the board, which the architect updates at landing.

**Deferred by the owner.** l9-browser-delivery-09 (Send to Drive makes a Google Doc or Slides file; the sheet's one-line sign-in states) was deferred out of the wave by the owner on 2026-11-12 and is board ticket #603; this landing touches nothing under `src/services/delivery/` or `src/renderer/src/delivery/`.

**Left for #435's landing** (after U9's; A5 and probe 5 are its):
- the two device marks the engine host keeps per session (`src/engine-host/ops.ts`, `session-maws.ts`), and the rule for which device is asked;
- the one-shot request on the client port with a capability of its own (`src/endpoint/client-port.ts`, `src/main/lane-b/remote-port.ts`), and `maws.pane.answer` leaving `REMOTE_UNAVAILABLE` (U9's row);
- the refusal where the request fans out, in place of the engine host's `hasClient`, which this landing leaves as it is;
- the third `note` ("Shown in the user's MAWS on another device, …") and the refusal for a loopback page that cannot be forwarded, with their own dated line under X9, and the dated line under P5 §6 "Pane display";
- the reload on the device: this landing's `reload` flag and `page` answer (Interfaces §B) are what that landing sends through a forwarded open;
- probe 5 (`e2e/remote.spec.ts`, each of the seven panes) and A5's scenes.

The Browser opening by itself on another device stays under the section's "Waiting".

## Words used here

- **The computer-use plugin** (in code and in its own documents: cua): a Claude Code plugin whose MCP server `cua_repl` gives the agent a tool named `js`. A **cell** is the JavaScript of one `js` call; it runs in a REPL that keeps its handles between calls. In the engine's output the tool is `mcp__plugin_cua_cua_repl__js` or `mcp__cua_repl__js` (`CUA_JS_TOOLS`, `src/renderer/src/transcript/model/classify.ts`).
- **The in-app browser:** MAWS's Browser side surface, a native view per tab laid over a pane of the window (`src/main/browser/`, `src/renderer/src/tools/browser/`). A session's **browser backend** is the Unix socket MAWS gives the session's engine in the settings environment as `CUA_BROWSER_BACKENDS` (`extraSettingsOf`, `src/services/sessions/launch-mapping.ts`); through it the plugin's `cua.getBrowser()` with no id is that session's in-app browser.
- **A lease:** the agent's hold on one browser tab between the plugin's `debugger.attach` and its detach (`src/main/browser/cua/connection.ts`). An **acting command** is one that changes the page (a navigation, an input), as `commandClass` in `cua/filter.ts` classes it; a read is not.
- **The engine host:** the process that launches the engine and serves the `maws` MCP server to it (`src/engine-host/`). The **pane bridge** is how `show_pane` asks a window to open a pane and waits for its answer (`src/engine-host/tool-server/panes.ts`; the window's side is `src/renderer/src/tools/maws/panes/connect.ts`).
- **The person uses a tab:** the tab reads "You have the page" (its `control` is `human`), or the person's last input in it was within three seconds. Interfaces §C gives the function; it is not today's `personHolds` (R1).
- **The daemon's tab engine:** the headless browser `mawsd` runs for a session with no app attached (`src/render-host/tab-engine.ts`); it shares `src/main/browser/cua/` with the app.
- **Build F:** commit `f1852de3a`, the build on the owner's machines, which may run again on the same profile and beside this build (root UC-14).
- **The VM:** the wave's build VM, reached through `~/.local/share/maws-ux-wave/tools/vmcheck.sh`; it is Linux.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the VM in a checkout of the pushed head. An executor runs no `scripts/ci-gate.sh`, starts no Electron e2e and opens no pull request. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.
2. **The `maws` texts are frozen** (charter X9; root UC-15). The strings of Interfaces §A are used exactly as written and change nothing else of the server's texts. `src/shared/maws/tools.test.ts` keeps pinning the tool list by name and order; this landing adds no tool.
3. **The engine and the plugin are not changed** (D-1; the section's first "Binds"). What only the plugin can do is the two tickets.
4. **What is stored or sent** (root UC-14). Interfaces §H is the whole list. This landing writes no key to `layout.json`, to either settings file or to `<userData>/browser/tabs.json`, adds no tab kind, and adds nothing to the machine link: no row in `OFFERS`, no capability in `ENDPOINT_CAPABILITIES`, and `RL2_PROTOCOL.minor` does not move. It adds one optional key to one command on the wire between the app and the engine host, with `WIRE_MINOR` and the two generated files (M1).
5. **Files other children own** (root UC-8). This landing owns `src/main/browser/`, `src/renderer/src/tools/browser/` outside `comment/`, and the new directory `src/renderer/src/computer-use/`. Its edits elsewhere are the insertions of Interfaces §J and no others, each the smallest that does the job. An executor that finds a further file of another child must change, beyond a fixture's shape, stops and reports it.
6. **Keep means keep** (law 8; A8). The acting dot, the plain activity rows and the takeover (l9-browser-delivery-04), Send to (l9-browser-delivery-10) and the browser's first open with no modal (l9-browser-delivery-11) behave as before. `src/main/browser/permissions.test.ts`, `src/renderer/src/transcript/model/browser-activity.test.ts` and the assertions of `src/renderer/src/tools/browser/agent/connect.test.ts` pass unchanged. `git diff origin/master...HEAD -- src/services/delivery src/renderer/src/delivery` prints nothing.
7. **No chord** (root UC-6). `src/shared/keymap/actions.ts` is not edited; Viewport and Copy screenshot are rows of the Browser's own options menu.
8. **Laws 3 and 7.** No setting is added. The strip, the chip and the sized page use today's tokens and shapes; light theme is the default.
9. **The repository is public** (root UC-11). Fixtures, test titles and test session titles are invented.
10. **Page text and titles are data.** A page's title or address is shown as text. The session's title that goes into `CUA_CURSOR_LABEL` goes into the launch's settings environment and nowhere else: no new log line carries it.
11. **Base.** No executor starts before master holds step 0: `git cat-file -e origin/master:src/shared/sessions/working-folder.ts && git cat-file -e origin/master:src/shared/keymap/build-f.ts && echo step-0-landed` prints `step-0-landed`. This landing consumes nothing from either; they come first because the root's ordering lands them before any other child branches. The branch takes master by merge and is never rebased or force-pushed, because reviewers pin ranges on it.
12. **Nothing gated gets worse** (root acceptance 5). What the strip reads from the transcript is memoised per turn object, as `turnSpanOf` is, so an event batch that changes no turn costs it nothing.

## What the code holds today (master `6e8c72738`)

Each statement the section rests on was read at this head. Where the code says otherwise, the point is under "Reported to the architect" below.

**The instructions and `show_pane`.**
- `MAWS_SERVER_INSTRUCTIONS` (`src/shared/maws/instructions.ts`) is one paragraph of 699 characters. `MawsToolServer` answers it at `initialize` for every session, from a direct import (`src/engine-host/tool-server/server.ts`); the server is built in `SessionMaws`'s constructor (`src/engine-host/session-maws.ts`), which `EngineSession` builds from its options, where the launch spec is `opts.spec` (`src/engine-host/session.ts`). The spec's `extraSettings.env.CUA_BROWSER_BACKENDS` is the browser backend when the launch has one.
- `show_pane`'s description (508 characters) and `ShowPaneResultSchema`, a strict object of `status`, `pane` and `opened`, are in `src/shared/maws/tools.ts`. The result is parsed in two more places, both strict: the normalizer's `mapMawsAnswer` (`src/engine-host/normalizer-controls.ts`), which emits `maws.pane.shown` from it, and the row's label (`paneLabel`, `src/renderer/src/transcript/model/cells.ts`).
- The window's answer is `MawsPaneAnswerResultSchema` (`src/shared/ipc/schema/maws.ts`), the input of `maws.pane.answer`, a command the engine host owns and therefore an entry of the wire manifest (`src/shared/ipc/wire-manifest.json`, `commands.maws.pane.answer`). `WIRE_MINOR` is 36; build F's is 33.
- `showBrowser` (`src/renderer/src/tools/maws/panes/connect.ts`) validates the address, opens the Browser tool with `{ target, appSessionId, requestId }` and answers at once. The tab is opened by `BrowserHandle.open` (`src/renderer/src/tools/browser/BrowserTool.tsx`), which invokes `browser.tabs.open` with `reuse: 'url'` and drops the answer.
- `TabStore.open` (`src/main/browser/tabs.ts`) answers a `requestId` repeated within 10 s (`REQUEST_ID_MS`) with the first call's tab; with `reuse: 'url'` it selects the session's tab at the same normalised address and loads it only when it has no view. `Navigator.navigate(tabId, 'reload')` (`src/main/browser/navigation.ts`) is the one reload, and it already handles a crashed tab and a failed load.
- The engine cuts a server's instructions at 4,096 characters by default (probe 3, below).

**The agent's tab.**
- `CuaConnection.acting` (`src/main/browser/cua/connection.ts`) runs at a lease's first acting command, before the takeover gate, and emits `browser.agent.acting` through `ctx.emit`; it selects nothing. The app passes `emit` to `startCuaBackend` (`src/main/browser/index.ts`); the daemon's tab engine passes none (`src/render-host/tab-engine.ts`), and its inventory tells viewers the store's `selected`.
- `connectBrowserAgent` (`src/renderer/src/tools/browser/agent/connect.ts`) opens the shown session's Browser tool once per turn when none is open, and sends no tab id.
- `personHolds(entry, now)` (`src/main/browser/agent/control.ts`) is true only within three seconds of the person's last input, or of the moment the tab became theirs when no input is recorded. A tab that reads "You have the page" with its last input older than that answers false (cua #103 separated the visible ownership from the grace). R1.

**The Browser's chrome and pane.**
- `OverflowMenu` (`src/renderer/src/tools/browser/chrome/OverflowMenu.tsx`) has the nine rows the section lists; find and zoom are enabled only while the tab is live and this chrome's pane holds the view. Copy URL confirms with `urlCopied`, a notice kind of the chrome's own (`ChromeNoticeKind`, `tools/browser/store.ts`).
- `PlacedPane` (`tools/browser/Pane.tsx`) is a column: the page element (`[data-browser-pane]`, what the placement measures) over the comment card's strip, beside the floating card's reserved column. The view's bounds follow the element through `browser.view.place`.
- `captureTabView` (`src/main/browser/capture.ts`) lets only the window the tab is placed in take a still, and encodes it under the comment crop's caps (the longer edge at most 1,568 pixels).
- `BrowserTabSchema` (`src/shared/browser/tab.ts`) is strict and crosses only between main and the windows of one build. `PersistedTabSchema` (`src/main/browser/persist.ts`) picks ten named fields from it, so a field added to the tab does not reach `tabs.json`. A tab no pane shows is parked at 1280 × 800.
- A lease's letting go clears a device-metrics override the agent set and waits until the page reads its view's size (`undoCommands`, `readsViewSize`, `viewSizeRead`), reading the view's bounds at each poll.

**Computer use.**
- `cellLabel`'s `generic` case (`src/renderer/src/transcript/model/copy.ts`) titles any MCP call `Used <server> · <tool>`. No test, snapshot or fixture pins that title for the two `js` names.
- `turnSpansOf` (`transcript/model/browser-activity.ts`) reads a turn's own events only. A subagent's events are in the turn's `children` map (`transcript/model/reduce.ts`), so a subagent's `js` call is found there and not in the spans.
- The transcript store keeps, per key, whether the process behind it is live (`live`, `ticks`; `src/renderer/src/stores/transcript.ts`), and the key of a session's main transcript is its app session id on every route. A terminal session's file can leave a turn open that nothing ends, which is why `TranscriptSlot` draws such turns closed while the controls port says no turn runs (`controls.turn()`).
- A permission request's attention item carries the call's tool-use id on both routes (`shapeOf` in `src/engine-host/broker.ts`; `laneAEntryOf` in `src/shared/lane-a/attention-entry.ts`). An MCP elicitation's item carries none.
- A call withdrawn by an interrupt gets, on the live wire, an error `tool.result` whose `denial` is `user-rejected`, and then the engine's interruption marker as a user row (the recorded `pass3/p1-maws-ask-interrupt` shows both after an interrupt during an MCP call). Rows read from a transcript file carry no denial (`src/engine-host/fs/backfill.ts` writes `denial: null`), so on a terminal session the marker is the evidence; `wasInterrupted` in `transcript/model/reduce.ts` reads either.
- The composer's Stop is `controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })` (`src/renderer/src/composer/Composer.tsx`).
- `extraSettingsOf` sets `CUA_BROWSER_BACKENDS` and nothing else of the plugin's. A setup intent has no title; a record's is `title: { text, source }` with source `none` when it has none.
- The plugin reads `CUA_CURSOR_LABEL` when the engine starts, removes control characters and cuts it to 24 characters with an ellipsis (`src/runtime/cursor-identity.mjs` at the plugin's `main`, `9020bb18`).

**Probe 3, done by reading: how long may the server instructions be?** In the 2.1.322 bundle (`cli.pretty.js`) the cap is `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`, else 4,096 (`nPr`), in the function that answers both (`MB`, with 16,384 for its other argument). An SDK-hosted server's instructions pass through `ii(instructions, name)`, which cuts at that number and appends "… [truncated]"; MAWS sets no such variable. This landing's paragraph is 343 characters and joins the first with a blank line, so a session with a browser backend is given 1,044 characters: 345 added, inside the wave's own bound of 2,048 with 1,004 to spare for U6's sentence. **The outcome that holds: the paragraph stays in the instructions**, and the fallback of moving it into `show_pane`'s description is not used.

**Tests that pin today's behaviour and change.** The section's list, corrected against the code:
- as the section names: `src/shared/maws/tools.test.ts` (`show_pane`'s description, word for word), `src/engine-host/session-maws.test.ts` and `src/engine-host/tool-server/server.test.ts` (the `initialize` answer), `src/main/browser/tabs.test.ts` (reuse by address), `src/renderer/src/tools/maws/panes/connect.test.ts` (the params the Browser tool is opened with, and the answer), `src/renderer/src/transcript/model/copy.test.ts` (a new case; the generic title stays pinned for other tools);
- `src/shared/maws/search-tools.test.ts`: the first paragraph's word-for-word test stays as it is; the test of the probe's snapshot changes only through the snapshot (M1);
- not named by the section: `src/main/browser/cua/retained.test.ts` (the agent's tab stays unselected; macOS-guarded, so the VM skips it), `e2e/browser-cua.spec.ts` (the scene "the Browser panel follows the agent …"), `src/renderer/src/tools/browser/chrome/chrome.test.tsx` (two exact lists of the menu's disabled items), `src/services/sessions/launch-mapping.test.ts` (the exact `extraSettings` of a resume), `src/main/catalog/agents.test.ts` (the list of texts MAWS gives the model), `src/shared/ipc/schema.test.ts` (`browser.tabs.open`'s input), `src/shared/ipc/wire.test.ts` and `wire-fingerprint.test.ts` (through the generated files), and the fixtures that build a whole `BrowserTab` (`src/renderer/src/test-support/browser.ts` and four test files);
- named by the section and not changed by this landing: `src/renderer/src/tools/browser/BrowserTool.test.tsx` (the window makes `show_pane`'s open itself, so `BrowserHandle.open` keeps its behaviour and that file is the pin that a link reloads nothing), and `test/lane-b/offer-coverage.test.ts` (it changes with #435; the two commands this landing adds name a tab and no session, so the audit does not count them).

**E2e specs that cross the code this landing touches.** `e2e/browser.spec.ts` (`show_pane` for one request from two windows; the cover; placement; the floating card's column; Mark up; the page's guards), `e2e/browser-cua.spec.ts` (a fake plugin host through the socket; the app as a tab engine; the panel following the agent), `e2e/browser-chrome.spec.ts` and `e2e/browser-comment.spec.ts` (the options menu by item name; the comment dock), `e2e/maws-tools.spec.ts`, `e2e/agent-tools.spec.ts` and `e2e/deliverables.spec.ts` (`show_pane`'s result for the other panes, which keeps its shape), `e2e/remote.spec.ts` and `e2e/render-host.spec.ts` (the session pane and the Browser of a session on another machine; the daemon's tab engine).

## Reported to the architect

Each point is a place where the code contradicts the section, or where a decision would change what the owner sees or what a contract says beyond the section's words. Each has a default the milestones are written at, and a ruling changes the one place named.

| | the point | evidence | the default | the one place |
|---|---|---|---|---|
| R1 | `personHolds` is not the rule the section and the owner's answer state. It has no "or it reads 'You have the page'". | `src/main/browser/agent/control.ts`: `last = lastHumanAt ?? (control === 'human' ? controlSince : null)`, true only while `now - last` is under three seconds; its comment, "visible human ownership outlasts that takeover grace" (cua #103). | A second predicate, `personUses`, beside it: the tab's control is `human`, or `personHolds`. The reload and the selection read `personUses`. `personHolds` is not changed: the takeover gate, the dialog route and the resource caps read it. | `personUses` (Interfaces §C) |
| R2 | The section's mechanism for the agent's tab reaches further than the owner's sentence. Main selects at every lease's first acting command, so a Browser that is already open on a tab the person is only reading also moves to the agent's tab, and it can happen more than once in a turn (once per tab the agent starts acting in). The owner's sentence speaks of the Browser opening by itself. | The section, l9-browser-delivery-01, "The agent's tab"; `CuaConnection.acting` runs per lease, and the renderer's once-per-turn rule is about opening the tool, not about the selection. | As the section's mechanism says, in the app only: the daemon's tab engine selects nothing, since no person is there and its `selected` is what viewers on other devices are told. | `CuaConnection.acting` (Interfaces §C, M2) |
| R3 | Probe 1 can be answered by reading, and the answer is "the cell goes on". The hands-on check is still to be run. | The plugin's REPL host at its `main` (`9020bb18`), `src/repl-host/supervisor.mjs`: "running + cancellation: nothing is stopped; the eventual result still settles (the vendor's behaviour)" and "a running cell is never stopped by a cancellation". | The "goes on" branch of the section is built: after a call the strip showed is withdrawn, the strip reads "Computer use may still be finishing a step" until the call's deadline. Ticket 2's text says so. | `lingerUntil` (Interfaces §E, M4) |
| R4 | Stop on the strip for a session on another machine: the section says the button is absent where the session cannot be interrupted; root UC-7 says a control whose act cannot work is drawn disabled with one sentence. The root binds. | Root UC-7, first sentences; the section, l9-browser-delivery-07, "Stop" and A6. | For a session on another machine the button is drawn disabled with the sentence `useRemoteUnavailable(appSessionId, 'session.interrupt')` gives. It is absent only where the session has no controls port, or its port says interrupt is not available (a terminal session whose bridge cannot interrupt). | The strip's Stop (Interfaces §E) |
| R5 | The chip: A3 says it "returns to Responsive in one click"; the section's "After" says it "opens the same three choices", which is two clicks. | The section, A3 and l9-browser-delivery-06. | The chip opens the three choices. | `ViewportChip` (M3) |
| R6 | UC-8 names `tool-server/panes.ts`, `session-maws.ts` and `ops.ts` as this child's insertions in the engine host. The paragraph's gate also needs `src/engine-host/tool-server/server.ts` (U10's directory): the instructions become a dependency of the server. `ops.ts` is not touched by this landing; it is #435's. | `server.ts` imports the constant and answers it. | The insertion is made and listed (Interfaces §J). | Root UC-8's table |
| R7 | Where X9's dated line is written: the section gives the P1 spec's Decision log; root UC-15 gives the charter's X9 record. The section's sentence also names the refusal for a loopback page, which #435's landing builds. | The section, "Rulings reversed"; root UC-15. | Both places are written, and the charter's Decision log gets its entry. This landing's sentence leaves the refusal out; #435's landing adds its own line. | M5, "The record" |
| R8 | The `note` is gated like the paragraph. The section says it is present for the browser pane; in a session launched without a browser backend its sentence ("cua.getBrowser() with no id is this browser") would be false. | The same gate as the paragraph's: the launch spec. | A session without a browser backend gets `page` and no `note`. | `PaneBridge` (Interfaces §A) |
| R9 | A `browser.tabs.open` that main refuses is still answered "shown", without `page`, as today, where the open's failure is not seen at all. Saying it to the agent would be a second new refusal text under X9. | `BrowserHandle.open` warns and drops a refusal today. | No new refusal. The window logs the refusal, opens the tool and answers without `page`. | `showBrowser` (M1) |

Smaller things the section does not word, decided here and listed for the architect's eye:
- **Two notice lines.** Copy screenshot confirms with `Screenshot copied to clipboard`, beside Copy URL's "URL copied to clipboard"; when nothing could be captured the chrome says `Couldn’t copy a screenshot of this page` as a warning line (Copy URL's failure is silent today).
- **A device size applies where a pane holds the tab's view.** A tab no pane shows keeps its parked size, so A3's sentence on the agent's screenshot holds for a tab on screen. And the chip reads the view's real size, so in a pane under 812 points tall Mobile reads `375 × <the pane's height>`; A3's `375 × 812` needs a pane that tall.
- **A plugin approval raised as an MCP form mid-call does not hide the strip.** Its attention item carries no tool-use id, so it cannot be tied to the call. The section expects such approvals to be answered inside the engine.
- **The strip appears 250 ms after a call starts.** A permission request reaches the window by another channel than the call's row, and without the wait every call that asks first would flash the strip.
- **`unit:darwin` is needed.** The test that pins the selection through a real lease is macOS-guarded, so the VM skips it.

## Plan of Work

Five milestones. M1 produces the predicate M2 reads; M3 and M4 are independent of both and of each other; M5 writes the e2e scenes and the record once the behaviour exists. Each leaves the tree green on the VM (typecheck, lint of the changed paths, the whole unit suite) and is reviewed at its boundary before the next starts. The exact texts, shapes and tables are in Interfaces and Dependencies; a milestone points at them.

### M1 — What the agent is told, and `show_pane` on a page already open

**What exists at its end.** A session launched with a browser backend is given two paragraphs of instructions by the `maws` server, and a session without one is given the first alone (A1's test that fails before). `show_pane` with the browser pane and an address already open in the session reloads that tab, unless the person is using it, and its answer says `"page":"opened"`, `"reloaded"` or `"kept"` with a `note`; a link, the address bar and the person's own opens reload nothing (A2).

**What it touches.** `src/shared/maws/instructions.ts`, `src/shared/maws/tools.ts`, `src/shared/browser/tab.ts`, `src/shared/ipc/schema/maws.ts`, `src/shared/ipc/schema/browser.ts`, `src/shared/ipc/wire.ts` with the two generated files beside it; `src/engine-host/tool-server/server.ts`, `tool-server/panes.ts`, `src/engine-host/session-maws.ts`, `src/engine-host/session.ts`; `src/main/browser/tabs.ts`, `src/main/browser/agent/control.ts`, and the place the store is given its dependencies (`src/main/browser/index.ts`); `src/renderer/src/tools/maws/panes/connect.ts`; `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json`; the tests beside each, `src/main/catalog/agents.test.ts`, `src/shared/ipc/schema.test.ts`, and one new test file for the wire addition.

**Interfaces.** Exposes §A (the texts and `mawsServerInstructions`), §B (`reload`, `page`, the rule's table), §C's `personUses` to M2. Consumes nothing.

**Decisions.**
- **The gate is the launch spec.** `EngineSession` reads whether the spec carries a browser backend (a non-empty `extraSettings.env.CUA_BROWSER_BACKENDS`) and hands `SessionMaws` one boolean; `MawsToolServer` takes the instructions as a dependency in place of its import. The handshake begins before the engine's first frame, so nothing later than the spec can decide it (the section's advice). Rejected: asking the browser module whether a socket exists, which the engine host cannot reach and which could differ from what the engine was told.
- **The window makes the open itself.** `showBrowser` invokes `browser.tabs.open` with `select: true`, `reuse: 'url'`, `reload: true` and the request's id, waits for the answer, then opens the Browser tool for the session with no target and answers with the open's `page`. Rejected: making `BrowserHandle.open` awaitable, because `panelHost.addTool` returns a tab id and not the tool's state, so the answer would have to be fished out of the tool; and because every other caller of that method must keep its fire-and-forget behaviour. With no target the tool opens as today and the answer has no `page`.
- **Order: the open first, then the tool.** Main has selected the tab before the panel mounts, so the panel never shows the previous tab for a frame. While the open is unanswered nothing has opened and nothing is answered; if it never comes, the pane bridge's own eight seconds answer the call with its existing timeout text. A refused open: R9.
- **Main decides, once, in one tick.** `TabStore.open` reads `personUses` and commands the reload in the same call, through one optional dependency the store is given (the navigator's reload, which handles a crashed tab and a failed load; the daemon's tab engine gives none and is never asked to reload); the outcome is remembered with the request id beside the tab, so a second window's call within ten seconds reloads nothing more and answers the first outcome. `reloaded` means the reload was commanded; the answer does not wait for the page to load. A tab that is suspended is loaded as today and reads `reloaded`.
- **`page` crosses the wire as one optional key.** `MawsPaneAnswerResultSchema`'s `ok: true` branch gains `page`; that is an additive change of an engine-host command, so `WIRE_MINOR` goes up by one, taken against master as merged at this milestone's start, with its comment, and `pnpm wire:manifest` rewrites the two generated files on the VM (Concrete Steps 3). The `note` never crosses: the engine host writes it. Build F on the other side: Interfaces §H.
- **The note's two texts live with the other X9 texts** in `src/shared/maws/tools.ts`, and `PaneBridge.request` adds one to a browser answer when the session has a browser backend (R8): the `kept` text for `page: 'kept'`, the other text otherwise. The keys of the result are written in the order `status`, `pane`, `opened`, `page`, `note`.
- **The probe's snapshot is edited by hand, one string.** `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json` holds `show_pane`'s description; replace that one string with the new description. Do not regenerate the file with `MAWS_WRITE_PROBE_TOOLS=1`: the snapshot still lists the retired `message` tool on purpose (the tracker's row of 2026-10-27, P4-R7z), `search-tools.test.ts` and `fixtures.test.mjs` both assert that it does, and a regenerated file drops it. No assertion compares `show_pane`'s description between the snapshot and the recorded fixtures, so nothing is recorded again.
- **`personUses` is added here** because the reload reads it; M2 reads it too.

**What it does not touch.** `BrowserHandle.open` and `forward.ts` (a link's open and a forwarded link's open stay as they are). The pane bridge's `hasClient` and the events it sends. The journaled `maws.pane.shown` event's shape. Any other tool's text. `test/lane-b/offer-coverage.test.ts`.

**What it proves.** A1's unit half and A2's. Behaviours its tests pin beyond the acceptance's words:
- `mawsServerInstructions`: without a backend it is the first constant byte for byte; with one it is the first, a blank line and the second; the second is pinned word for word, names no `mcp__maws__` tool, and the whole is under 2,048 characters;
- `initialize` for a spec with a browser backend carries both paragraphs, and for a spec without one the first alone, at the server and through a scripted session;
- `show_pane`'s description, word for word;
- the store: the four rows of §B's table each with its `page`; a tab whose control is `human` with its last input ten seconds old is `kept` (the case that tells `personUses` from `personHolds`); a loaded tab reused without `reload` is selected, not reloaded, and answers no `page` (today's behaviour, which nothing pinned); a repeated request id answers the same tab and the same `page` and commands no second reload; a crashed tab and a tab whose load failed at that address are loaded again and read `reloaded`; another session's tab at the address is never reused;
- the window, with the open held unanswered: no tool is open and no `maws.pane.answer` has been sent; once it answers, the tool opens and the answer carries `page`; two handlers given one request both answer alike; a refused address answers `navigationRefused` and invokes nothing; no target invokes no open and answers without `page`; a refused open is logged, opens the tool and answers without `page`;
- the bridge: a browser answer carries `page` and the matching note, in §A's key order; with no backend no note; another pane's answer has neither;
- the normalizer emits `maws.pane.shown` with its shape unchanged from a result that carries `page` and `note`, and the row's label reads what opened from such a result;
- the wire addition against build F's shape, in a new test: an answer with `page`, read by `readTolerant` with the command's input schema as it stands at `f1852de3a` (copied into the test), is accepted with `result.page` alone dropped; an answer without `page`, as F's window sends, parses under this build's schema;
- `agents.test.ts` runs its check over the new paragraph too.

### M2 — The agent's tab comes forward

**What exists at its end.** At a lease's first acting command the app selects the agent's tab in its session, unless the person is using the selected tab; the windows are told as before, so a Browser that opens by itself opens on the agent's tab (A9).

**What it touches.** `src/main/browser/cua/connection.ts` (the server's context gains the store's `select`), `src/main/browser/agent/control.ts`; `src/renderer/src/tools/browser/agent/connect.ts` and its test (comments only: both say the tab is not selected); `src/main/browser/cua/retained.test.ts`, `src/main/browser/agent/control.test.ts`, `src/render-host/tab-engine.test.ts`.

**Interfaces.** Consumes `personUses` (M1). Exposes `agentTabComesForward` (§C).

**Decisions.**
- **The decision is a pure function in `control.ts`,** `agentTabComesForward`, so that it is tested on the VM: the tests that drive a real lease are macOS-guarded. `CuaConnection.acting` calls it and then `store.select`, before it tells the windows, in the same tick as the acting command's arrival and before the takeover gate.
- **Only where the windows are told.** The selection is made only when the connection has an `emit` (the app). The daemon's tab engine selects nothing (R2).
- **Per lease, as `acting` already is.** A second tab the agent starts acting in comes forward in its turn. A side thread acting in its parent's tab selects in the session that owns the tab.
- **The renderer does not change.** `connectBrowserAgent` still sends no tab id; the tool it opens shows the session's selection, which main has just set. Its test's assertions pass unchanged, and only its header and the source's header are reworded, since both describe the rule this milestone reverses.
- **A pitfall seen in the code:** selecting a tab places its view in the pane, so its size changes from the parked 1280 × 800 to the pane's. That is the same change a person makes today by clicking the agent's chip or dragging the panel's edge, and the plugin takes a fresh look before each step. The scenes of `e2e/browser-cua.spec.ts` that read the parked size launch with no session shown and are not affected; M5 re-reads them.

**What it does not touch.** `personHolds` and the takeover gate. `src/render-host/tab-engine.ts`. The once-per-turn rule of the Browser tool's opening.

**What it proves.** A9's unit half.
- `agentTabComesForward`: no tab selected, yes; the agent's tab already selected, no; the person typed in the selected tab within three seconds, no; the selected tab reads "You have the page" with older input, no; the selected tab idle and untouched, yes; the selected tab closed meanwhile, yes.
- Through a real lease (`retained.test.ts`, run by `unit:darwin`): the first acting command selects the agent's tab and tells the windows once, and a read does neither; with the person's input in the selected tab inside three seconds the selection stands; with that tab's control `human` it stands; a second lease's first acting command selects its tab; a side thread acting in its parent's tab selects there.
- The daemon's tab engine: an acting command leaves its `selected` as it was (one added case in `tab-engine.test.ts`; the file's other cases pass unchanged).

### M3 — Device sizes and Copy screenshot

**What exists at its end.** Browser options › Viewport offers Responsive, Mobile and Tablet. A device size draws the page at that size, centred and top-aligned in the pane, with a chip in the navigation row; the page's own `innerWidth` reads the size; it survives the agent's own viewport override and is gone after a relaunch (A3). Copy screenshot puts what the pane shows on the clipboard at device pixels and says so (A4).

**What it touches.** `src/shared/browser/tab.ts`, `src/shared/ipc/schema/browser.ts` and the command lists beside it (`src/shared/ipc/names/browser.ts`, and whatever table must name a new main command, as `browser.tabs.zoom` and `browser.view.capture` are named); `src/main/browser/tabs.ts`, `register.ts`, `capture.ts`; `src/renderer/src/tools/browser/`: `Pane.tsx`, `chrome/OverflowMenu.tsx`, `chrome/NavRow.tsx`, a new `chrome/ViewportChip.tsx`, a new `viewport.ts`, `actions.ts`, `store.ts`, `chrome/Notices.tsx`, `copy.ts`; `src/renderer/src/test-support/browser.ts` and the other fixtures that build a whole tab; the tests beside each.

**Interfaces.** Exposes §D. Consumes nothing from M1 or M2.

**Decisions.**
- **The size is the view's size, never emulation** (the section's "Why this, not that"). The pane sizes the page element; the placement the pane already reports carries it to the view. Nothing is sent to the tab's debugger.
- **The structure U5 codes against stays.** `[data-browser-pane]` stays the page element and what the placement measures. It gains one wrapper, `[data-browser-page-box]`, which takes the page element's place in the column (it is the flexible child) and draws the surround; the comment card's strip stays the column's last child under it, and the reserved column stays beside the column. With no device size the wrapper is filled by the page element and the page element's box is exactly today's.
- **The numbers are one pure function,** `pageBox` in `tools/browser/viewport.ts` (§D), used by the pane, the menu and the chip, so the three cannot disagree. The room it is given is the wrapper's client size, which the pane observes and publishes per tab in the browser store beside the placeholders; the menu and the chip read it there.
- **The choice is main's.** The menu sends `browser.tabs.setViewport` and draws its radio from the tab's `viewport` as main last sent it; there is no optimistic state, so two surfaces showing one tab agree and a refused command leaves the old mark. Main refuses the command for an extension's options tab; the menu does not offer it there.
- **Never persisted.** `viewport` is not added to `PersistedTabSchema`'s pick, and a restored tab starts at `null`. A test pins the persisted file's keys to the ten build F's reader knows.
- **Copy screenshot is main's write.** `browser.view.copyScreenshot` keeps `captureTabView`'s rule for who may ask, captures with `capturePage` and writes the image to the clipboard whole. It does not use `capturedImage`, whose caps are for a still sent to the model. It answers `{ copied }`; the chrome raises `screenshotCopied` on true and `screenshotFailed` on false or on a refusal. The capture works while the open menu still covers the page, as the comment crop's does.
- **The menu's order** is the section's: Viewport after the zoom group, Copy screenshot after Copy URL. Both are enabled where find and zoom are (a live page in the chrome whose pane holds the view).

**What it does not touch.** The comment dock's files and `CommentCardHost` (U5's). The remote picture of an agent's tab on another machine (`remote/View.tsx`), which has its own navigation row and no options menu. `src/main/browser/permissions.ts`. `src/main/browser/persist.ts`. The debugger and `cua/filter.ts`.

**What it proves.** A3's and A4's unit halves.
- `pageBox`: Responsive answers no box; Mobile in a roomy pane is 375 × 812; at zoom 1.25 the element is 469 × 1015 and the page's size still reads 375 × 812; a pane narrower or shorter than the size cuts that side to the room and the reading follows; `fits` is false for Tablet under 768 points of room at zoom 1 and under 960 at zoom 1.25.
- The store: `setViewport` sets the record and tells the windows; an unknown tab and an extension's options tab are refused; a suspended tab keeps its choice; a restored tab has none; the file written with a Mobile tab has exactly the persisted keys of today.
- The pane: with a device size the page element has the box's size, centred, top-aligned, and the placement reports that rect; a pane made narrower narrows it and widening restores it; the strip stays under the page and the reserved column beside it; with none, the existing cases of `Pane.test.tsx` pass unchanged.
- The menu and the chip: three radio items with the section's hints, the mark following the tab's `viewport`; Tablet disabled with "Wider than this pane" when it does not fit; the submenu and Copy screenshot disabled where find is; the two exact lists of disabled items updated; a choice sends the command and the mark moves only when main's change arrives (the command held unanswered); the chip is absent in Responsive, reads the page's real size, and opens the three choices.
- The capture: a window that does not hold the tab is refused; a tab not on show, a destroyed view, an empty image and a throwing capture answer `{ copied: false }` and write nothing; a capture writes the whole image once. With the capture held unanswered no notice is raised; each outcome raises its line.

### M4 — Computer use in the session

**What exists at its end.** While a computer-use call runs in a session, a line across the top of its full pane reads "Computer use running" with Stop, through the pauses between calls, on all three routes; it is not drawn while the call waits for a permission answer; Stop ends the turn as the composer's does. After a call the strip showed is withdrawn, the line reads "Computer use may still be finishing a step" until the call's deadline (R3). The call's row reads "Used computer use". A resumed session's launch carries its title as `CUA_CURSOR_LABEL` (A6).

**What it touches.** New `src/renderer/src/computer-use/` (`reading.ts`, `strip-state.ts`, `Strip.tsx`, `copy.ts` and their tests); one line in `src/renderer/src/session/SessionPane.tsx`; one case in `src/renderer/src/transcript/model/copy.ts` and its test; `src/services/sessions/launch-mapping.ts` and its test.

**Interfaces.** Exposes §E and §F. Consumes, as master exports them: `TranscriptState` and `TurnState` (`transcript/model/reduce.ts`), `isCuaJsTool` (`transcript/model/classify.ts`), `isInterruptionMarker` (`transcript/model/user-text.ts`), `useTranscriptStore` and `ticks` (`stores/transcript.ts`), `selectPendingOf` and `waitsOnAnswer` (`stores/attention.ts`, `src/shared/attention/kinds.ts`), `useSessionControls` (`session/controls/controls-for.ts`), `useRemoteUnavailable` (`lane-b/remote-unavailable.ts`).

**Decisions.**
- **A directory of its own.** The strip's reading of the transcript does not go into `transcript/model/`, where UC-3 gives this child one string and no more. It reads the model's state and imports its types.
- **Its own reading, not `turnSpansOf`.** The spans leave out a subagent's calls, and widening them would change where the browser's activity rows attach, which `browser-activity.test.ts` holds. `readComputerUse` scans the turn's events and its `children` lists, memoised per turn object.
- **Whether the turn runs is read where the transcript already reads it:** the turn is open and accepted, the store's `ticks` does not say the process is gone, and the controls port does not say the turn is at rest. A terminal session's file can leave a turn open for ever; without the last two the strip would never leave such a session.
- **States, events and timers are fixed in §E** before any code: the table there is the contract. What the strip remembers (when it first saw a call in flight, which calls it showed) lives with the mounted pane; a pane mounted mid-call starts from what the transcript shows, and every deadline is counted on this window's clock from what this window saw, never from a row's timestamp, because a row can come late (a terminal session's file) or from another machine's clock.
- **The permission wait is UC-1's predicate by tool-use id:** a waiting item of the session, of kind `permission`, whose `request.toolUseId` is the call's, under `waitsOnAnswer`, which U1a redefines over `waits` without an edit here.
- **A bound, stated.** A terminal session with no live bridge raises no attention item, so nothing tells this window that a call is waiting for approval in the terminal: there the strip follows the call's row alone, and a call denied in the terminal is read as withdrawn. The section's routes say the strip is drawn from the transcript's rows on that route; this is what those rows can and cannot say.
- **Stop is the composer's Stop,** `controls.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })`, pressed once: the button is disabled and marked busy while the command is unanswered; a refusal enables it again; an answer leaves it busy until the turn ends. It keeps no state past its turn. Where it is drawn: R4.
- **The mount is one line** in `StartedPane`, inside the full pane only (not `compact`), directly above the transcript's wrapper: `Strip` is a zero-height element whose line is positioned over the transcript's top edge, so nothing below it moves. Law 2's later step (the plugin drawing its own state as a mod surface) changes that one line.
- **The row's title** is one early return in `cellLabel`'s `generic` case, for both names of the tool, before the MCP pattern.
- **The label** is §F: set on a resume of a record that has a title, with or without a browser backend, cleaned and bounded; an intent's first launch and the trust bootstrap set nothing.

**What it does not touch.** `transcript/model/browser-activity.ts`, `classify.ts`, the grouping of tool rows. The composer. The sidebar and the card column. `src/services/delivery/`.

**What it proves.** A6's unit half.
- The reading: the main agent's call in flight, and a subagent's (in `children`); a result ends it; a closed turn ends it; a prompt not yet accepted is no running turn; a waiting permission item that names the call makes it `waiting`; an item for another call does not; `timeout_ms` read from the input, 30,000 without one; a result whose denial is `user-rejected`, an error result followed by the interruption marker (as a transcript file gives it, with no denial), and a turn closed before the result, each make the call `withdrawn`; an error result with no marker is `done`; a port at rest, and `ticks` false, give no running turn; both tool names; rows mapped from a terminal session's transcript file give the same reading as the live wire's.
- The states, with fake timers: nothing at 249 ms and the line at 250; after the call's result the line stays to 9,999 ms and is gone at 10,000; a next call inside the pause keeps the line without a gap; the turn ending normally removes it at once; a turn interrupted while a shown call ran changes it to the lingering line until first-seen plus the call's deadline; a new call in flight during the linger returns to running; a call that waited for permission and was denied is never shown and never lingers; unmounting clears every timer; another session's id resets everything.
- Stop: one `interrupt` with the composer's arguments; disabled and busy while it is held unanswered; enabled again on a refusal; no button without a controls port, or with a port that says interrupt is not available; disabled with the helper's sentence for a session on another machine that has one; the strip is not mounted in the compact pane.
- The title: "Used computer use" for both names; "Used docs · search" still.
- The label: a resume of a titled record sets it, beside a socket and without one; a record whose title source is `none`, or whose text is empty after cleaning, sets nothing; an intent's launch and the bootstrap set nothing; control characters are removed and the text is cut at 64 characters; the owner channel's merge of the environment keeps it.

### M5 — The e2e scenes, the record, and the acceptance run

**What exists at its end.** The e2e specs say what the build now does and hold the new scenes. The two records are amended where they stand. The branch has passed typecheck, lint and the whole unit suite on the VM, and the hand-over for the runs an executor does not start is written into Progress.

**What it touches.** `e2e/browser.spec.ts`, `e2e/browser-cua.spec.ts`, a new `e2e/computer-use.spec.ts` with its journal builder under `e2e/support/`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-05-p1-extension.md`, `docs/tech-debt-tracker.md`; this document's Progress.

**Interfaces.** Consumes everything above. Exposes nothing.

**Decisions.**
- **`e2e/browser.spec.ts`, three new scenes.**
  - *(reload)* A2. A page whose server answers a different marker on every request is open in the session's Browser. `show_pane` for the same address under a new request id: the tab is selected and shows the next marker. The person types in a field of the page and `show_pane` comes again within three seconds: the marker and the typed text are unchanged. A click on a transcript-style link to the same address (the Browser tool opened with that target, as a link opens it) changes no marker. The existing scene "show_pane opens one tab for two windows' worth of one request …" keeps passing: one request id still makes one tab.
  - *(device sizes)* A3 and probe 4. Viewport › Mobile in a pane at least 812 points tall and wider than 375: the page's `innerWidth` is 375, the page element is 375 wide and centred, the chip reads `375 × 812`; with the options menu open over the page, the frozen picture's box equals the page element's; at page zoom 125% `innerWidth` is still 375; with a comment card open the strip is under the page and the page is shorter by the strip; with the floating session card up, its column is beside the pane's column; in a pane narrower than 768 points Tablet is disabled with "Wider than this pane"; a fake plugin host that sets and then clears a device-metrics override on the tab leaves `innerWidth` at 375 again; the chip opens the three choices and Responsive removes it. It attaches a screenshot of the sized page with the chip.
  - *(copy screenshot)* A4. Copy screenshot, then the clipboard holds an image whose size is the view's size at device pixels, and the notice line shows. The existing scene of the page's guards (a camera request denied with its line) keeps passing unchanged.
- **`e2e/browser-cua.spec.ts`.** The scene "the Browser panel follows the agent: … and the agent's tab is not selected; …" becomes A9's: after the lease's first acting command the Browser is open and the session's selected tab is the agent's. Two further steps in it, each with a fresh agent tab and lease: with the person having clicked in the selected tab inside three seconds (a person's input made as the spec's takeover scenes make one), the selection stands and the agent's tab is in the strip; with the selected tab reading "You have the page", the same. Its last part, the activity listed after a restart, stays. Re-read, expecting no edit: "a fake cua host drives a session's tabs through its socket …" (it reads the parked size after a detach, with no session shown) and "the app as a tab engine: …" (its agent tab is now the session's selection, and the inventory's `selected` names it; the scene asserts the listed tabs and their visibility).
- **`e2e/computer-use.spec.ts`, new, collected by the default group.** It launches on the replay seam, as `e2e/support/library-session.ts` does, with a journal its builder writes from recorded frames (the shape of `e2e/support/to-human-replay.ts`): a turn whose assistant message calls `mcp__plugin_cua_cua_repl__js` and is left running. The line "Computer use running" and Stop show at the top of the session; the call's row reads "Used computer use". Stop writes the interrupt the composer's Stop writes (the replay holds at it); the journal then plays the engine's rows after an interrupt (the rejected result, the marker, the result); the line reads "Computer use may still be finishing a step" and leaves at the call's deadline, which the journal's call sets to two seconds. A second session's journal has the call waiting on a permission request: no line while it waits. It attaches a screenshot of the line. No scene is added for a terminal session or a session on another machine: the reading is the same function over the same model on every route, and M4's unit test feeds it rows mapped from a transcript file (law 4).
- **The record** (root UC-10, "The record"; the section, "Rulings reversed"; R7). Each sentence is added where the record stands and nothing is removed; each is dated the day its commit is made.
  - Row A-54 of the P1 spec's Decision log (`docs/doperpowers/plans/2026-10-05-p1-extension.md`, §7), after its amendment of 2026-10-08: "Reversed 2026-11-12 (UX wave, U12; the owner's answer 'Yes, unless I use mine'): when the Browser opens by itself because the agent started acting in a page, it shows the agent's tab, except when the person is using the selected tab (they typed or clicked in it within the last three seconds, or it reads 'You have the page')."
  - The same row, after that sentence, and the charter's X9 paragraph (`docs/charter.md`, §13, "X9 — the `maws` tool server"), at its end: "Amended <the commit's date> (UX wave, U12): the `maws` server's instructions gain a paragraph on the in-app browser for sessions with a browser backend; `show_pane`'s description says a page already open is reloaded unless the user is using that tab; its result gains optional `page` and `note`."
  - One new entry at the end of the charter's §19 Decision log, naming both: the amendment of X9 with its three parts, and the reversal of the choice of 2026-10-08, each with the path of this document.
  - The tracker's row of 2026-10-27 (P4-R7z) gains one clause: the probe's snapshot now carries `show_pane`'s description of this landing, which the recorded fixtures predate.
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
   - M1: `vmcheck 'pnpm exec vitest run src/shared/maws src/shared/ipc src/engine-host/tool-server src/engine-host/session-maws.test.ts src/engine-host/normalizer.test.ts src/main/browser/tabs.test.ts src/main/browser/agent src/main/catalog/agents.test.ts src/renderer/src/tools/maws/panes src/renderer/src/tools/browser/BrowserTool.test.tsx src/renderer/src/transcript/model'` and `vmcheck 'pnpm test:probes'`
   - M2: `vmcheck 'pnpm exec vitest run src/main/browser src/render-host src/renderer/src/tools/browser/agent'`
   - M3: `vmcheck 'pnpm exec vitest run src/shared/browser src/shared/ipc src/main/browser src/renderer/src/tools/browser'`
   - M4: `vmcheck 'pnpm exec vitest run src/renderer/src/computer-use src/renderer/src/session src/renderer/src/transcript/model src/services/sessions src/services/owner'`

   Expect each to pass whole. On the VM the macOS-guarded cases report as skipped (`src/main/browser/cua/retained.test.ts` and `index.test.ts` among them): that is expected there and is why `unit:darwin` is on the architect's list. The suites build-common names as failing on master on the VM are not this branch's.

3. **M1, the wire's generated files.** After the merge of step 1, read `WIRE_MINOR` in `src/shared/ipc/wire.ts` and take the next number, with its comment naming `maws.pane.answer`'s `page`. After the schema is edited and pushed:

       vmcheck 'pnpm wire:manifest >/dev/null; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' > /tmp/u12a-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u12a-wire.patch | git apply

   Expect a patch that touches those two files only, with one added optional property under `commands.maws.pane.answer`. Commit them with the change and push; `wire.test.ts` and `wire-fingerprint.test.ts` pass only with them. If another landing has taken the same minor on master by the time this branch merges it again, take the next and regenerate.

4. **At each milestone's end:** `vmcheck 'pnpm typecheck'` and `vmcheck 'pnpm test'` (the whole unit suite). Expect no error and no failed file beyond build-common's list. M1 changed a recorded file, so it also runs `vmcheck 'node --test .github/scripts/maws-app-scan.test.mjs'`; M5 runs it again for its e2e support. The controller then has the milestone reviewed and ticks Progress.

5. **The acceptance run** (M5), on the pushed head:

       vmcheck 'pnpm typecheck'
       vmcheck 'pnpm lint'
       vmcheck 'pnpm test'
       vmcheck 'pnpm test:probes'
       git diff origin/master...HEAD --stat -- src/services/delivery src/renderer/src/delivery src/shared/keymap/actions.ts src/main/browser/permissions.ts src/main/browser/persist.ts

   Expected: each check exits 0; vitest's summary names no failed file beyond build-common's list; the last command prints nothing (constraints 6 and 7, and the two files M3 must not touch). `pnpm typecheck` covers `e2e/`, which is the only check an executor has on the scenes of M5.

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

    // src/shared/ipc/schema/maws.ts: the `ok: true` branch of MawsPaneAnswerResultSchema
    z.strictObject({ ok: z.literal(true), opened: ShowPaneOpenedSchema, page: BrowserOpenPageSchema.optional() })

The agent reads the result as JSON with its keys in the order `status`, `pane`, `opened`, `page`, `note`. `browserKept` goes with `page: 'kept'`; `browser` with any other browser answer. The third text of the section, for a pane shown on another device, and the refusal for a loopback page are #435's and are not defined by this landing.

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

Main's rule, for a request with `reuse: 'url'` and `reload: true`, over the session's tab at the same normalised address:

| the tab | what main does | `page` |
|---|---|---|
| none at that address | opens a new tab and selects it | `opened` |
| suspended (no view) | selects and loads it, as today | `reloaded` |
| loaded, and the person does not use it (§C) | selects it and commands the reload | `reloaded` |
| loaded, and the person uses it | selects it, reloads nothing | `kept` |

A request id seen within `REQUEST_ID_MS` answers the first call's tab and the first call's `page`, and does nothing else. Without `reload` the call behaves and answers exactly as today.

### §C. Who is using a tab, and when the agent's tab comes forward (M1, M2)

    // src/main/browser/agent/control.ts
    /** The person is using the tab: it reads "You have the page" (control `human`), or `personHolds` (their last input
     *  within BROWSER_HANDBACK_IDLE_MS). The one statement of this rule; the takeover gate keeps reading `personHolds`. */
    export function personUses(entry: TabEntry, now: number): boolean;

    /** Whether a lease's first acting command on `acting` selects it in its session: not when it is the selected tab
     *  already, and not when the person uses the selected one. `selected` is the session's selected tab's entry, or
     *  null when it has none or that tab is gone. */
    export function agentTabComesForward(selected: TabEntry | null, acting: TabEntry, now: number): boolean;

`CuaConnection.acting`, for a lease's first acting command and only where the connection tells the windows: if `agentTabComesForward`, `store.select(owner, tabId)` with the tab's owning session; then `browser.agent.acting` as today. Both happen in the tick the command arrives, before the takeover gate.

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
    export interface PageBox { width: number; height: number; reads: { width: number; height: number } }
    /** The page element's size in the pane's own pixels for a device size, and what the page then reads as its size.
     *  width = min(round(viewport.width * zoom), room.width), and the same for height; reads = each side divided by
     *  zoom, rounded. Null for Responsive, where the element fills its room as today. */
    export function pageBox(viewport: BrowserViewport | null, zoom: number, room: { width: number; height: number }): PageBox | null;
    /** Whether a device size's width fits the room now: viewport.width * zoom <= room.width. */
    export function fits(viewport: BrowserViewport, zoom: number, room: { width: number; height: number }): boolean;

The pane's DOM, which U5's comment dock and the e2e scenes read:

    [data-browser-column]                      the column, as today
      [data-browser-page-box]                  new: the flexible child; draws the surround; its client size is the room
        [data-browser-pane]                    the page element, as today: what the placement measures
      (the comment card's strip)               as today, the column's last child
    [data-browser-reserved-column]             as today, beside the column

The chip is `[data-browser-viewport-chip]` in the navigation row, before the options menu. The menu's three radio items carry `data-viewport="responsive" | "mobile" | "tablet"`.

### §E. The strip: what it reads, its states and its timers (M4)

    // src/renderer/src/computer-use/reading.ts
    export interface ComputerUseCall { toolUseId: ToolUseId; timeoutMs: number; state: 'flight' | 'waiting' | 'done' | 'withdrawn' }
    export interface ComputerUseReading { turnId: TurnId | null; calls: readonly ComputerUseCall[] }
    /** The session's computer-use calls in the turn that matters now: the running turn, else the latest turn that has
     *  one. `turnId` is the running turn's id, or null when no turn runs. `waiting` holds the tool-use ids of the
     *  session's waiting permission requests; `runs` is false when the store or the controls port says the turn is
     *  not running. */
    export function readComputerUse(state: TranscriptState | null, waiting: ReadonlySet<ToolUseId>, runs: boolean): ComputerUseReading;

    // src/renderer/src/computer-use/strip-state.ts
    export const COMPUTER_USE_SETTLE_MS = 250;
    export const COMPUTER_USE_PAUSE_MS = BROWSER_AGENT_IDLE_MS;     // 10 s, the Browser's "Agent is browsing" interval
    export const COMPUTER_USE_DEFAULT_TIMEOUT_MS = 30_000;          // the plugin's default for a `js` call with no timeout_ms
    export type StripState = { kind: 'absent' } | { kind: 'running'; turnId: TurnId } | { kind: 'lingering' };
    export function useComputerUse(appSessionId: AppSessionId): StripState;
    /** When the lingering line for a withdrawn call ends: the moment this window first saw the call in flight, plus
     *  its timeout. R3's one place: under the other ruling it answers null and the lingering state is never entered. */
    export function lingerUntil(firstSeenAt: number, call: ComputerUseCall): number | null;

    // src/renderer/src/computer-use/Strip.tsx
    export function ComputerUseStrip(props: { appSessionId: AppSessionId }): ReactNode;   // null while absent

A call's state: `flight` from its `tool.use` until its `tool.result` or its turn's close; `waiting` instead of `flight` while a waiting permission item names it; `done` at an ordinary result; `withdrawn` at a result whose `denial` is `user-rejected`, at an error result that the engine's interruption marker follows in the turn (`isInterruptionMarker`; a transcript file's rows carry no denial), or at its turn's close with no result. A call can therefore read `done` for one batch and `withdrawn` at the next, when the marker's row arrives after the result's; the states below follow the reading as it stands. `timeoutMs` is the input's `timeout_ms` when it is a positive integer, else the default.

| state | what is drawn | entered | left |
|---|---|---|---|
| `absent` | nothing | at mount; and as below | |
| `running` | a pulsing dot, "Computer use running", Stop (where R4 draws it) | from `absent` or `lingering`: a call of the running turn has been in `flight` for `COMPUTER_USE_SETTLE_MS` without a break | to `absent`: the running turn ends or stops running without a call the strip showed becoming `withdrawn` by it; or no call has been in `flight` for `COMPUTER_USE_PAUSE_MS`; or a call of the turn is `waiting` and none is in `flight`. To `lingering`: a call the strip showed becomes `withdrawn` (each call once). |
| `lingering` | a still dot, "Computer use may still be finishing a step", no button | from `running` only | to `absent`: at `lingerUntil`. To `running`: as `running` is entered. |

"A call the strip showed" is one that was in `flight` while the state was `running`. Every time in the table is counted on this window's clock from what this window saw. Stop's own state (idle, busy) belongs to the `running` state of one turn and is dropped when that state is left.

### §F. The cursor's label (M4)

    // src/services/sessions/launch-mapping.ts: LaunchInput gains
    cursorLabel?: string | null;     // the session's title for the plugin's on-screen cursor; null: none

`resumeLaunchSpec` gives it from the record: the title's text when its source is not `none`, with control characters removed, trimmed, and cut at 64 characters; null when nothing is left. `intentLaunchSpec` and `bootstrapSpec` give none. `extraSettingsOf` writes it as `env.CUA_CURSOR_LABEL`, beside `CUA_BROWSER_BACKENDS` when there is one and alone when there is not. The plugin cuts it to 24 characters with its own ellipsis and picks the colour; the bound of 64 only keeps a long title out of the engine's argument list.

### §G. Copy

- The strip: `Computer use running`; its button `Stop`; the lingering line `Computer use may still be finishing a step`. The strip is a status region; the busy button keeps its label and is disabled with `aria-busy`.
- The row: `Used computer use`.
- The menu: `Viewport`; its items `Responsive`, `Mobile` with the hint `375 × 812`, `Tablet` with the hint `768 × 1024`; a size that does not fit is disabled with the hint `Wider than this pane` in place of its numbers; `Copy screenshot`.
- The chip: `<width> × <height>` from `pageBox`'s `reads`, with the accessible name `Viewport: <width> × <height>`. The sign is U+00D7 with a space on each side.
- The notices: `Screenshot copied to clipboard` (info); `Couldn’t copy a screenshot of this page` (warning).

### §H. What this landing stores or sends, and what build F does with it

| what | where it goes | build F meeting this build's value | this build meeting F's | this build, then F, then this build |
|---|---|---|---|---|
| `result.page` in `maws.pane.answer` | from a window to the engine host, which may be F's while F's kept host is still serving after an update | F's host reads a command's input tolerantly: it drops `page`, logs it once, and answers the call with F's result (no `page`, no `note`). The tab was still reloaded by this build's main. | F's window sends no `page`: this build's host answers without `page`, with the `browser` note when the session has a backend; F's window reloaded nothing, and the answer does not say it did. | Nothing is stored. |
| `page` and `note` in `show_pane`'s result | to the engine, and so into the engine's transcript and MAWS's journal as the call's result text | F's strict reader of the result does not parse it: the pane's row reads the pane's name without what opened. The journaled `maws.pane.shown` event has its old shape and reads as before. | F's results have neither key and parse. | Each build draws the row from the same stored text by its own rule; nothing is rewritten. |
| The second paragraph of instructions | to the engine at the server's handshake; the engine keeps the instructions a session was first given across resumes | A session first launched by this build keeps the paragraph when F resumes it. It stays true there: F has the in-app browser and the same backend. | A session first launched by F has no paragraph when this build resumes it (A1's checks use a new session). | As the first two columns. |
| `CUA_CURSOR_LABEL` | the engine's settings environment at a launch | Not stored. An engine launched by this build keeps its label until it exits, whichever build's window is attached. | F's launches set none; the plugin falls back as today. | Not stored. |
| `BrowserTab.viewport`; `browser.tabs.setViewport`; `browser.view.copyScreenshot`; `reload` and `page` on `browser.tabs.open` | between main and the windows of one build | F never meets them: they are not written to `tabs.json` (the file's keys are pinned by a test), not on the wire to a host, and a build's preload bridges only its own commands. | — | A tab's device size is gone at a relaunch under either build. |
| `WIRE_MINOR` + 1 and the manifest's one added property | the hello between an app and a host | Additive within the wire's major, as every minor since F's 33. | — | — |

This landing writes no layout key, no settings key and no tab kind, so it adds no row to the cross-build coverage table (U13a's M5 holds it) and no cross-build scene. What F does with the one wire addition is held by M1's test against F's schema.

### §I. Consumed from other landings, and exposed to them

**Consumed.**
- **U6a** (`…-U6a-keymap.md`): nothing. This landing adds no action id and no chord; the two menu rows are the Browser's own.
- **U8a** (`…-U8a-working-folder.md`): nothing is read from `workingFolder`. Its tree test scans `src/`; no file of this landing spells the session's folder.
- **U3a** (`…-U3a-arrivals.md`): nothing by name. M4 reads the transcript model's state as master exports it and inserts one case in `transcript/model/copy.ts`; both are made on a master that holds U3a's landing if it is there (root UC-3).
- **U13a** (`…-U13a-one-strip.md`): nothing. No tab of the main strip is opened or brought forward by new code, so `commitShown` is not called, and no row joins its coverage table (§H).
- **U9** (`…-U9-other-machines.md`): `useRemoteUnavailable(appSessionId, 'session.interrupt')`, under the signature master has today, which U9 keeps while making its answers follow the link's phase. Stop on the strip is `session.interrupt`, an act U9's offers already carry; this landing adds no act on a session.
- **U8b** (`…-U8b-column-and-tabs.md`): `panelHost.addTool` as it is called today (its §C.7: one optional `group`, otherwise unchanged; a tool opened with `activate` comes into view in its group and opens the column as today). The window's `show_pane` handler and the Browser's own opening call it with the arguments they pass today.
- **U1a** (root UC-1): `waitsOnAnswer` from `src/shared/attention/kinds.ts`, which U1a redefines over `waits`; M4 follows without an edit.

**Exposed.**
- To **#435's landing**: `ShowPaneResultSchema`'s `page` and `note` and `SHOW_PANE_NOTES` (it adds the third note and the refusal); `reload` and `page` on `browser.tabs.open` (what the device's forwarded open passes); `personUses`.
- To **U6's second landing**: `mawsServerInstructions`, and the budget as it stands after this landing (1,044 of 2,048 for a session with a browser backend, 699 without).
- To **U5**: §D's DOM. The comment dock stays the last child of `[data-browser-column]`; the page element is still `[data-browser-pane]`.
- To **U1 and U2**: the one line in `StartedPane`, directly above the transcript's wrapper; it has no height.
- To whoever takes law 2's later step: `useComputerUse` and the mount.

### §J. Insertions in files other children own (root UC-8)

| file (owner) | the insertion | named by |
|---|---|---|
| `src/renderer/src/session/SessionPane.tsx` (U1) | one line in `StartedPane` mounting `ComputerUseStrip`, and its import | the section |
| `src/renderer/src/transcript/model/copy.ts` (UC-3) | one case in `cellLabel`'s `generic` case, with its import | the section |
| `src/shared/maws/instructions.ts` (UC-15) | the second constant and the join | the section |
| `src/shared/maws/tools.ts` (UC-15) | one clause of `show_pane`'s description; two optional keys of its result; the two note texts | the section |
| `src/engine-host/tool-server/panes.ts`, `src/engine-host/session-maws.ts` (U10; UC-8 gives them to U12 for the pane bridge) | the result's `page` and `note`; one boolean passed in | the section |
| `src/engine-host/tool-server/server.ts` (U10) | the instructions as a dependency in place of the import | R6 |
| `src/main/catalog/agents.test.ts`, `src/render-host/tab-engine.test.ts` (no child's) | one name in a list; one added case | this document |
| `e2e/browser.spec.ts`, `e2e/browser-cua.spec.ts` (no child's; U5's work may edit the first) | M5's scenes | this document |

`src/engine-host/session.ts`, `src/services/sessions/launch-mapping.ts`, `src/renderer/src/tools/maws/panes/connect.ts` and the shared schema files belong to no child in UC-8's table. `src/engine-host/ops.ts`, which UC-8 names for this child, is not touched by this landing.

### §K. Who may ask, checked where the act runs

- **The reload.** Main's `open` decides on the tab's own entry, with `personUses`, in the call that commands the reload. Only a window of this build can set `reload`: `browser.tabs.open` is a command of main that no machine link carries (the router answers it on this device for a session of any machine). An agent reaches it only through `show_pane`, and the store reuses only a tab whose `appSessionId` is the session named.
- **The selection.** Main decides at the acting command, on the entries it chooses between. A connection reaches its own session's tabs and its parent's and no other (`reaches`), so the tab selected is one the agent could already drive.
- **`browser.tabs.setViewport`.** Any window of the app, by tab id, as `browser.tabs.zoom`; main refuses it for an extension's options tab.
- **`browser.view.copyScreenshot`.** Main checks, on the entry it captures, that the sender's window is the one the tab is placed in and that the tab's own page is on show. The image goes to the clipboard of the machine that window is on. A page cannot ask: the command belongs to the app's renderer, and the page's preload does not carry it.
- **Stop.** `session.interrupt` through the session's controls port. For a session on another machine the endpoint's offer and its grade decide, as for the composer's Stop; this landing adds nothing there.
- **The label.** A title the launching machine's own record holds, given to the engine on that machine.
- **A remote caller** sees nothing new: nothing of this landing crosses a machine link.

## Acceptance

The acceptance is the section's A1 to A4, A6, A8 and A9, as written there. A5 is #435's landing's and A7 is withdrawn. "Unit" is run by the milestone's executor on the VM and again by class 1a; "unit:darwin", "e2e" and "by hand" are the architect's ("Proof that an executor does not run").

| item | proved by | milestone |
|---|---|---|
| A1 the agent drives the in-app browser itself, with no tool named in the prompt | unit: the `initialize` answer with and without a browser backend (the test that fails before). By hand: probe 6, in a new session on this branch's build | M1 |
| A2 `show_pane` on a page already open reloads it; a tab the person is typing in is kept; a link and the address bar reload nothing | unit (the store's four rows, the window's held open, the bridge's note); e2e, the *(reload)* scene of `browser.spec.ts` | M1, M5 |
| A3 Mobile draws 375 wide with the chip; Tablet disabled in a narrow pane; the agent's screenshot and its own viewport reset see the device size | unit (`pageBox`, the pane, the menu, the chip); e2e, the *(device sizes)* scene, which is probe 4, run alone first. The chip's `375 × 812` holds in a pane at least 812 points tall | M3, M5 |
| A4 Copy screenshot, then paste into a composer; a camera request still blocked | unit (the capture and its refusals; `permissions.test.ts` unchanged); e2e, the *(copy screenshot)* scene and the unchanged guards scene. The paste into a composer is the composer's existing image paste, seen at the owner's sitting | M3, M5 |
| A6 the strip with Stop on all three routes; not while a permission answer is waited for; the row's title; the cursor's label | unit (the reading over live rows and over a transcript file's rows, the states under fake timers, Stop, the title, the launch's environment); e2e, `computer-use.spec.ts`. By hand: the pill's label on a Mac where the plugin draws its cursor, and probe 1. Under R3's default the strip does not simply leave after a Stop that withdrew a running call: it reads the lingering line until the call's deadline | M4, M5 |
| A8 the three `keep` items | `browser-activity.test.ts`, `permissions.test.ts` and `agent/connect.test.ts`'s assertions unchanged; the existing takeover scenes and the first-open scene of the browser's e2e groups green; Concrete Steps 5's last command prints nothing for the delivery folders | M5 |
| A9 the Browser that opens by itself shows the agent's tab, unless the person is using theirs | unit (`agentTabComesForward`); unit:darwin (through a real lease); e2e, the reworked scene of `browser-cua.spec.ts` | M2, M5 |

## Proof that an executor does not run

Each line has an owner other than an executor. The controller writes into Progress when a line's precondition is met.

| what | when it can start | what it needs | what comes back, and what it changes |
|---|---|---|---|
| **The adversarial review of this document** | now | The architect dispatches it. | Findings; a revision of this document before any executor starts. |
| **Probe 1: does Stop halt a running cell?** (the section's probe 1; root, U14's list) | now: it needs nothing of this branch, since the composer's Stop on any build is the same interrupt | A Mac where computer use may act, with the plugin installed; a session MAWS runs; a scratch document with invented content in a text editor. The agent runs one `js` cell that types one character a second into the document for thirty seconds (`timeout_ms` of 60,000); Stop is pressed at five seconds; the characters are counted at forty. | The count. About five: the cell stopped, R3's default is reversed before M4 is built (`lingerUntil` answers null; the lingering state, its line and its tests are not built; Ticket 2's sentence on that line goes). Thirty, or clearly more than five: the default stands. Either way the count is added to Ticket 2 as a comment. |
| **`unit:darwin`** | after M2, and again on the final head | The Mac runner: `scripts/ci-gate.sh "$PWD" --gates unit:darwin --runner macos --label u12a-darwin`. | The run's id. `src/main/browser/cua/retained.test.ts` holds A9 through a real lease, and the VM skips it. |
| **Probe 4, the device-sizes scene, run alone** (root UC-10: a new e2e scene runs alone on a Mac before the final gate) | after M5 is pushed | A Mac under the load rule: the *(device sizes)* scene of `e2e/browser.spec.ts` by itself, in a window tall enough for a pane of 812 points. | A verdict for each of its checks (the frozen picture, zoom at 125%, the comment strip, the floating card's column, Tablet's hint, the agent's override). A failure is fixed in the pane's layout through the controller, never by adding emulation. |
| **The other new and reworked scenes alone, then the e2e groups** | after M5 is pushed | The *(reload)* and *(copy screenshot)* scenes, the reworked scene of `browser-cua.spec.ts`, and `computer-use.spec.ts`, each alone first. Then the groups that hold the specs this change reaches: `e2e:browser`, `e2e:browser-cua`, `e2e:browser-chrome`, `e2e:browser-comment`, `e2e:tools`, `e2e:agents`, `e2e:deliverables`, `e2e:transcript`, `e2e:render-host`, `e2e:remote`, `e2e:default` (which collects the new spec). | Verdicts by group. A red scene goes back to the controller as a fix. The two screenshots the scenes attach (the sized page with the chip; the strip) are there for the architect to show. |
| **Probe 6: did the agent find the browser?** (A1) | after M1, on a build of this branch | A Mac with that build under a scratch config home, the computer-use plugin installed (its version noted), tool search on, an engine login (one short paid turn), and a local page with a button served on localhost (invented content). In a new session: "open `<the page's address>` in the app's browser and test the button". | The turn's tool calls in order, whether "Navigated to…" and "Clicked…" appeared under the `js` call, whether the Browser opened, and whether the reply asked the person to do anything. Found: A1 is met. Not found (a browser skill of the person's can still win the agent's choice): reported with the tool calls; Ticket 1 is the next lever, and nothing more is added to MAWS's instructions without the owner. |
| **The cursor's label, by hand** (A6's last sentence) | after M4, with probe 1's sitting if the build is at hand | A Mac where the plugin draws its agent cursor; a session with a title, resumed on this branch's build, running one computer-use step. | Whether the pill reads the session's title (cut by the plugin at 24 characters). |
| **A cross-build run with F as the peer** | the architect's call | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u12a-xb`. This landing stores nothing new and adds no scene; the run would show only that the group's existing scenes still pass with the wire's minor one higher. | The run's id, if it is run. |
| **The owner's look** | not before the build | No drawn example is asked for: the strip's form and words, the menu's rows and the chip are fixed by the section, follow Claude Desktop's banner and menu, and are each one line or one row. The owner sees them at the sitting (root acceptance 2); the scenes' two screenshots, with fixture content, can be shown earlier if the architect wants a word on the strip's place or the sized page's surround. | The owner's word, if asked. |
| **The branch review** | after M5 | `doperpowers:review-code`, the xhigh panel, from the architect's session over `origin/master...ux-wave/U12a` (Decision Log). | A verdict and findings; the fixes are one wave through the controller. |
| **Class 1a** | once, on the head the pull request will carry, after the review's fixes | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u12a`, in the background. | The run's id. |
| **The two tickets** | Ticket 1 now; Ticket 2 now, or after probe 1 so that its text and its comment go together | The texts under "Hand-off", filed on the computer-use plugin's board through its tracker scripts. | The two ticket numbers, written into the section's table and the pull request. |

## Hand-off: the two tickets for the computer-use plugin's board

The texts below are final and each stands alone. They were checked against the plugin's source at its `main`, `9020bb18`. Ticket 2's sentence on the line MAWS shows after a Stop follows R3's default and goes if probe 1 shows that the cell stops.

### Ticket 1

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

### Ticket 2

Suggested labels: enhancement, priority P2, ready for an architect.

> **Title:** For a host such as MAWS: say what computer use is doing (task open, app in use), and stop the running cell when its call is cancelled
>
> **Background.** MAWS is a macOS desktop app that runs Claude Code sessions and shows each one's conversation. It launches the engine itself and reads the engine's stream-json output, and it renders the surfaces mods draw. When an agent in such a session drives the Mac through cua, the person watching MAWS wants to know which session is doing it, what it is acting on, and how to stop it.
>
> **What a host can and cannot do today.**
> - *State.* From the engine's output a host sees a `js` call start, with its code, and end. It cannot see whether a task is open, which app the cell acts on, or whether the cell touches the screen at all: handles persist between cells, the engine's stream-json output forwards no progress notification from an MCP server (read in Claude Code 2.1.322), and approvals are answered by the plugin's Elicitation hook inside the engine. So MAWS can show only "Computer use running" while a `js` call is in flight.
> - *Stop.* A host can interrupt the turn. The engine then withdraws the call (`notifications/cancelled`), and the REPL host does not stop the cell: `src/repl-host/supervisor.mjs` says "running + cancellation: nothing is stopped; the eventual result still settles (the vendor's behaviour)", and the host notes tell the agent "Only timeout_ms stops a running cell, not cancelling" (`GENERAL_NOTES`, `src/mcp/surface.mjs`). After the person presses Stop, the cell may go on acting until its `timeout_ms`, with nobody reading its result.
>
> **Asked for.**
> 1. *The state, told to the host.* Per session: a task opened or closed; the app (or "browser") a cell is acting on, by name; the kind of each acting step (click, type, key, drag), never its content. Either of two shapes would serve, and MAWS can use both:
>    - a mod surface the plugin draws itself (a band such as "Using `<app>` · Stop") in clients that render mods; MAWS prefers this where mods can draw;
>    - a machine-readable report for where no mod draws (a session in a terminal that MAWS only watches, a session on another machine): over the session's existing MAWS backend connection, or to a path the host passes in the launch environment. If it rides the backend connection it must not count as browser demand: MAWS's broker for a session whose browser has not started treats every request it does not know as demand and starts the session's headless browser.
> 2. *Stop.* A cancelled `js` call stops its running cell and releases held input (a pressed button, a held key), or the plugin gives the host another way to stop the session's running cell.
> 3. *Smaller, optional.* The agent cursor's label is read once from `CUA_CURSOR_LABEL` when the engine starts (#235). MAWS sets it to the session's title at each launch; a label that follows a later rename would need the plugin to read it again at a task's start. The README says MAWS also sets `CUA_CURSOR_COLOR`; MAWS sets the label only and leaves the colour to the plugin's own pick.
>
> **Constraints.** No typed text, page content, secret or screenshot leaves the plugin on this channel: names of apps and kinds of step only. Nothing changes for a client that asks for none of it.
>
> **Acceptance.**
> - In a MAWS session, while a cell clicks in an app, the host can show that app's name within a second of the first step, and shows nothing of the kind for a cell that only computes.
> - Stop pressed during a cell that acts once a second for thirty seconds leaves no further step after the cancel is delivered, and no input stays held.
>
> **What MAWS does on its side, without waiting for this.** A line across the top of the session, "Computer use running" with Stop, inferred from the call in flight; Stop as a turn interrupt; after a Stop that withdrew a running call, the line "Computer use may still be finishing a step" until the call's `timeout_ms`; the call's row titled "Used computer use"; `CUA_CURSOR_LABEL` set at launch. When this ticket lands, MAWS shows the plugin's own surface where mods draw, uses the report elsewhere, and drops the "may still be finishing" line.
>
> **To be added as a comment when it has run.** MAWS's hands-on check: a cell that types one character a second into a scratch document for thirty seconds, Stop pressed at five seconds, the characters counted at forty.
>
> **Context.** #235 (the agent cursor and its label); `docs/doperpowers/specs/2026-10-08-maws-in-app-browser-design.md` (the backend connection).

## The pull request

Opened on the architect's word, not by an executor. Its body:
- opens with the composite's path, the child id (U12, first landing) and the parent pin `510a6d15e`, and names the items (l9-browser-delivery-01 with the agent's tab, -02, -06, -07) and the board ticket #584;
- names its class 1a run by id, on the head it carries, and its `unit:darwin` run;
- names the branch review's verdict and what was done with each finding;
- names its residue: what is not verified (probe 6 and the cursor's label until they are run), what waits (#435's landing; Tickets 1 and 2 by their numbers; the Drive item, #603), the rulings on R1 to R9 as they were given, and anything logged as debt;
- says which e2e scenes ran alone and which groups ran, and where; gives probe 1's count and probe 4's verdicts;
- ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.

The pull request carries the dated lines of the two records this landing amends, where they stand (M5, "The record"): the reversal under row A-54 of the P1 spec's Decision log, and X9's amendment there and in the charter.

## Surprises & Discoveries

- Observation: `personHolds` is narrower than the rule the section and the owner's answer state. A tab that reads "You have the page" is not held once its last input is three seconds old.
  Evidence: `src/main/browser/agent/control.ts`, `personHolds` and its comment (cua #103); before E13 the function read `control === 'human' || lastHumanAt within the window` (`git show 368b460e1^:src/main/browser/agent/control.ts`). R1.
- Observation: the plugin's own source says a cancelled call never stops its cell, which is probe 1's "goes on" outcome.
  Evidence: the plugin's `src/repl-host/supervisor.mjs` at `9020bb18`: "running + cancellation: nothing is stopped; the eventual result still settles (the vendor's behaviour)"; "a running cell is never stopped by a cancellation". R3.
- Observation: the cap on a server's instructions in engine 2.1.322 is 4,096 characters, not the 2,048 the plugin's source records.
  Evidence: `cli.pretty.js`: `MB(e = !1) { return i.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH ?? (e ? g4i : nPr) }` with `nPr = 4096, g4i = 16384`; an SDK server's instructions pass through `ii(ae, b)`, whose default bound is `MB()`. Probe 3.
- Observation: the tests that hold the agent's tab unselected through a real lease are macOS-guarded, so the VM cannot run them.
  Evidence: `src/main/browser/cua/retained.test.ts`, `describe.skipIf(process.platform !== 'darwin')` on the block "the Browser panel follows the agent …".
- Observation: the daemon's tab engine runs the same `acting` code as the app, without an `emit`.
  Evidence: `src/render-host/tab-engine.ts` calls `startCuaBackend` with no `emit`; `connection.ts` tells the windows through `this.ctx.emit?.`. A selection made there would change the `selected` its inventory tells viewers. R2.
- Observation: the probe's served snapshot cannot be regenerated by its switch without breaking two tests.
  Evidence: `src/shared/maws/search-tools.test.ts` expects the snapshot's only unknown tool to be `message`; `spikes/protocol-probe/fixtures.test.mjs` expects `message` among the always-loaded tools; `MAWS_WRITE_PROBE_TOOLS=1` writes the list without it (the tracker's row of 2026-10-27, P4-R7z).
- Observation: a subagent's computer-use call is not in the spans the section names for the strip.
  Evidence: `turnSpanOf` iterates `turn.events`; a child agent's events are pushed to `turn.children` (`applyChild`, `pushChild` in `transcript/model/reduce.ts`).
- Observation: a withdrawn call cannot be told by its denial on every route.
  Evidence: `src/engine-host/fs/backfill.ts` writes `denial: null` for rows read from a transcript file ("denial kinds are not recorded on disk in a parseable form"); the live wire carries `tool_result_meta[].non_execution_kind` (`pass3/p1-maws-ask-interrupt`, the row after the interrupt). §E reads the interruption marker as well.
- Observation: `maws.pane.answer` is on the wire between the app and the engine host, so `page` moves the wire's minor.
  Evidence: `src/shared/ipc/wire-manifest.json`, `commands.maws.pane.answer`; `src/shared/ipc/wire.ts`'s rule that an added optional key is additive and bumps `WIRE_MINOR`.

## Decision Log

- **2026-11-13 · Verification** (the one entry written at authoring). This document gets an adversarial review before any executor starts; the architect dispatches it. Each milestone is reviewed at its boundary by the controller's reviewer before the next starts. The branch gets `doperpowers:review-code` at the xhigh panel, on size: about seventy files and about 2,700 changed lines, over the threshold of about twenty files or two thousand lines. Neither the root's UC-10 nor the section calls this landing delicate; the panel is asked for a lens on the browser's takeover rule (`personUses` beside `personHolds`, and the selection at an acting command) and one on the texts and shapes under X9 with the wire's addition. A new or reworked e2e scene runs alone on a Mac before the groups. Class 1a on GitHub Actions is the gate of record, on the head the pull request carries; `unit:darwin` runs beside it because the VM skips the macOS-guarded cases this landing changes.

## Outcomes & Retrospective

Pending — written at finish.
