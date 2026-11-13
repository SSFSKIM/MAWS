# UX wave · U5a: the one comment card and its sends (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave, a composite), child **U5**, first pull request (**U5a** in the root's "Ordering and dependency map"). **Parent pin:** `e0df32e3f` (branch `ux-wave-spec`). A further batch of corrections was staged on that branch while this document was written; it writes the owner's three answers of 2026-11-12 into the child's file (comments are collected; the export folder is remembered; no button asks the agent to commit, push or open a pull request). This document is written at those answers.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U5-review-comments-source-control.md`: Contracts → "UC-5 · One comment card (owned)", acceptance A1 to A5, A17 and A18, and the items O-45, l6-artifacts-05, l6-artifacts-19, l6-artifacts-20 (with X-105), l9-browser-delivery-05, X-218 and X-216. Where that file and a contract's statement in the root differ, the root binds. This document carries the constraints and the milestones, and of the design only what the child's file leaves open.
> **Binding on this landing:** UC-5 (owned), UC-3 (the transcript's model has one writer at a time), UC-7 (an act works on another machine or says why not), UC-8 (who owns which files), UC-10, UC-11, UC-14 (what is stored, build F can still read), UC-15 (the `maws` tool texts); laws 1, 3, 4, 5, 6 and 7.
> **Branch:** `ux-wave/U5a`, from master `7e5f2016c` (which holds U8a). **Board:** #589. **Written against** that commit; master moved to `6e8c72738` (the probes' pull request) while this was written, which touches none of the files named here. Build F is `f1852de3a`.
> **Revised 2026-11-12,** once, on the architect's rulings (R1 to R6: every default stands), the adversarial review's five findings and the drawn example's points: Decision Log 2 to 20; and entry 21, the architect's amendment of the same day (the pending send is found by its key).

## Purpose

Today a comment on a document, an HTML page or a page in the in-app browser is written in a small card with a two-way switch, "Side thread" or "Send to main". A comment for a session on another machine cannot be sent at all, a comment to a terminal session can only open a side thread, a second comment on a browser page throws the first one away, Escape in the browser's card loses what was typed, and after a send to the main conversation the card closes without a word.

After this landing the card has one checkbox, "Send to main". Unchecked, Send opens a side thread; ticked, the comment goes into the session's own conversation by the same path a typed message takes, so it works for a terminal session and for a session on another machine. Typed text is kept when the card goes away for any reason but the person's own Close. On a browser page and an HTML page several comments are collected and sent as one message, and the transcript draws that message as one bubble with a chip per comment. After a send to main the card's place says where the comment went. A document's comment count ignores a card that was opened and closed unsent, the passage an agent answered is tinted once, the agent's reply in a thread is in its own words, and the export dialog opens in the folder of the last export, also after a relaunch.

How to see it working, on the wave's build: open a page in the in-app browser beside a session, comment on an element, press Escape, comment on a second element, and see the first as a line in the card and the button read "Send 2 comments"; switch the side surface away and back and see "2 unsent comments" under the page; tick "Send to main", send, and see one message with two chips in the transcript and "Sent to <title>" where the card was. Do the same for a terminal session whose bridge is live. In the suites: the unit tests named under each milestone and the e2e scenes of M8.

## Progress

- [x] (2026-11-12) Document written against master `7e5f2016c`; the child's statements about today's code checked (see "What the code holds today").
- [x] (2026-11-12) The adversarial review (needs attention, five findings, all accepted) and the architect's rulings on R1 to R6 (all six defaults stand); the document revised once on them and on the drawn example (Decision Log 2 to 20).
- [x] (2026-11-12) P7's live run (the architect): intact in every state, 12 of 12 rows equal to the sent text by SHA-256 in §A's framed format (findings on branch `ux-wave/probe2-text-defaults` at `de7261796`, `spikes/protocol-probe/findings-uxwave-u5-terminal-text.txt`); step 5 (65,536 units over the machine link) not run. M2 stands at "intact"; the fallback is not built (Decision Log 23).
- [ ] The owner's look at the drawn example (`~/.local/share/maws-ux-wave/examples/u5-comments/`, outside the repository): one question, where the screenshots sit in a message of several comments. A is written here (decision 13); B changes decision 13, §H and M5's tests only.
- [ ] M1 — What a comment says, and what the machine takes
- [ ] M2 — The checkbox and the one send path
- [ ] M3 — The pass: drafts that stay, and several comments in one send
- [ ] M4 — The page is told when its card opens and closes
- [ ] M5 — The transcript's row for several comments (starts only once U3a is on master)
- [ ] M6 — The agent's reply in its own words, and the export folder
- [ ] M7 — A document's count, and the answered passage
- [ ] M8 — The e2e scenes, the record, and the acceptance run
- [ ] The branch review (xhigh panel), class 1a, the cross-build run with F, the e2e groups on a Mac (the architect).

## The landing's edge

**In.** UC-5's card on the four surfaces that host it today (a document, deck, design or dashboard; an HTML page; a page in the in-app browser; the sheet a file viewer's line opens), with its checkbox, its draft model, the pass, its sends on the three routes, the text a sent comment carries and its reader, and the transcript's row for a message of several comments. The items O-45, l6-artifacts-05, l6-artifacts-19, l6-artifacts-20 (both halves: the reply's words and the export folder; the child puts the item in the first pull request, so the export folder is here and not in U5b), l9-browser-delivery-05, X-218, X-216. Acceptance A1 to A5, A17, A18.

**Left to U5b, item by item.**

| the child's item or contract part | what U5b does | what this landing leaves ready for it |
|---|---|---|
| l5-code-01, line comments in Review (A6) | the host kind `review`, the layout `inline`, `CommentContext.quote` and `PassComment.quote`, a quote fenced in the sent text, `side: 'old'` on a `file-line` anchor with the lead's "before the change", the unsent rows under their lines, the toolbar's chip, a side thread that opens in the Side pane | the pass, `sendPass`, the chip and the card's parts, which take a new host kind without a change of their own; the names above are the contract's and are not used for anything else here |
| l5-code-05, X-072, l5-code-03, -04, -12, -06 (A7 to A14) | all of it | nothing |
| A19 (no reader of the record's folder under `tools/code/review/` and `tools/scm/`) | all of it | nothing; this landing reads no folder |
| UC-7's second insertion, the offer for `side.thread.open` over the machine link | after U9's fork | the checkbox is ticked and locked for a session on another machine |
| O-46 (an HTML page's comment goes to the session the main area shows) | after U14's reproduction | the "Session: <title>" line, which names the receiving session whenever it is not the one on screen |

**Not built by either landing.** l5-code-02: no button asks the agent to commit, push or open a pull request, in Source control or on the Environment card (the owner's answer of 2026-11-12, recorded in the register). Nothing here prepares for it: no insertion in `src/renderer/src/panel/summary/PushState.tsx`, no sentence, no probe P3.

**Not in this landing either:** numbered pins drawn in a page; one destination per comment; a close guard on a browser tab; remembering the checkbox; any change to what a side thread is, to the file viewer's sheet beyond its checkbox, or to `/btw` (U4's files in `src/renderer/src/side/`).

## What the siblings code against

Stated early because U10 and U12 are writing their documents now. Signatures are in "Interfaces and Dependencies".

- **The seam is unchanged:** `openCommentComposer(anchor, context)` in `src/renderer/src/tools/code/anchor/anchor.ts`, with `CommentContext { appSessionId; placement?; destination?: 'thread' | 'main' }`. `destination` is what the checkbox starts on; absent means unchecked.
- **A host mounts `CommentCardHost`** (`src/renderer/src/side/card/CardHost.tsx`) with its present props and one new required prop, **`subject: string`**: what the host shows (an artifact's id, a browser tab's id). The host draws three things by itself, in the card's place: the card, the chip "N unsent comments" when its pass holds comments and no card is open, and for about four seconds the line "Sent to <title>". A host supplies nothing for the chip or the line. `CardFrame` gains `holds?: 'one' | 'many'`, `onClosed?(card)` and `onDiscarded?(comment)`, and loses the four opt-ins `onDraft`, `draftOf`, `keepDraftOnEscape` and `discardOnBlurEmpty` (the draft rule is every host's) and `namesParent` (the session line follows one rule, below).
- **U12** (the in-app browser's pane, `src/renderer/src/tools/browser/Pane.tsx`): the structure it relies on stands. The page's element is what the placement measures; the comment dock is the last child of `[data-browser-column]`, in flow under the page, marked `[data-card-dock]`; it holds the card, or the chip (`[data-unsent-chip]`, one line high), or the sent line, or nothing. U12's device-size box wraps the page's element and leaves the dock outside it. This landing's edit in `Pane.tsx` is the dock's host props and nothing else, and `tools/browser/store.ts` is not edited: the end of a tab is read by a subscription in `tools/browser/comment/connect.ts` (decision 22).
- **U10** (the chat over an artifact as a bar, or hidden): a ticked comment is sent by `sendToSession(appSessionId, content, { origin: 'comment' })` from the stores, never through a mounted composer, so it is delivered whether the chat is a card, a bar or hidden. A comment is not a request and opens nothing. The card shows "Session: <title>" exactly when the receiving session is not `shownSession()` (`src/renderer/src/panel/host.ts`), so a comment made while the chat is hidden still names where it goes when that is another session.
- **U3** (the transcript's rows): `readAnchoredMessage(text)` in `src/shared/anchor/message.ts` returns every comment of a message, each with whether its lead announces a screenshot; M5 is the insertion in U3's files that uses it.
- **U9:** this landing reads `useRemoteUnavailable(appSessionId, 'side.thread.open')` and nothing else of U9's, and edits none of U9's files (see R1 for the row the child's file wanted removed).
- **U4:** the ticked send follows whatever `sendToSession` does with a message during a turn; the note under the card is worded from the result's `disposition`, so a change of U4's inside the send needs no edit here. One insertion in U4's file: `HumanPromptResult` gains `pendingKey?` (Constraint 6).

## Words used here

- **Card:** the small non-modal panel a comment is written in (`CommentCard`). **Sheet:** the modal form a file viewer's line opens (`CommentComposer.tsx`); it has the same checkbox and is not a card host.
- **Host:** the component a surface mounts to draw the card (`CommentCardHost`), of a *kind* (`artifact`, `artifact-page`, `browser`) and a *layout* (`anchored` over the surface, `docked` in a strip under a native page, `margin` in a document's margin).
- **Pass:** every unsent comment one surface holds for one receiving session, oldest first. It lives in the card's store, in the window's memory, and ends when it is sent or its subject closes.
- **Subject:** what a host shows and a pass belongs to: a browser tab's id, an artifact's id.
- **Flight:** the comments one Send carries, from the click until the send is answered.
- **Ticked / unchecked:** the state of "Send to main". Ticked sends to the main conversation; unchecked opens a side thread (a fork of the session that answers the comment beside the main conversation).
- **The three routes** (root law 5): a session MAWS runs (in code, lane B); a terminal session (lane A, driven through the sminos bridge while its bridge is live); a session on another machine (either kind, over the machine link).
- **The port:** the object every control of a session goes through, `sessionControls(appSessionId)` in `src/renderer/src/session/controls/controls-for.ts`; `sendToSession` is its `send`.
- **Build F:** `f1852de3a`, the build on the owner's machines, which may run on the same profile after this build (root UC-14).

## Constraints that bind every milestone

1. **The build brief binds** (`~/.local/share/maws-ux-wave/briefs/build-common.md`): no typecheck, lint, test, install, build or Electron on the MacBook; every check on the build VM through `vmcheck.sh`; no pull request and no `scripts/ci-gate.sh` by an executor; commits end with the session line the brief gives and carry no other attribution.
2. **The repository is public (UC-11).** Fixtures, tests, e2e pages and drawn examples use invented titles, paths, URLs and comment text.
3. **One comment's text does not move by a byte.** `commentsMessage` with one comment equals today's `anchoredMessage` output for the same input; `src/shared/anchor/message.test.ts` and `anchor.test.ts` pin it and are not edited to make a test pass. The engine's transcripts hold these texts, and build F reads them.
4. **The wire changes only by addition** (`src/shared/ipc/wire.ts`: a removed command, a new union member or a new required key takes a major, and a major breaks the link to a machine on build F). This landing adds one optional key to one command's input and bumps `WIRE_MINOR` by one; it removes nothing from the registry.
5. **Neither settings file changes** (UC-14). The one thing this landing stores is a layout key of its own, `library.exportFolder`.
6. **Files other children own (UC-8).** The insertions are these and no others; each is the smallest that does the job.
   - U3's: `src/renderer/src/transcript/model/user-text.ts`, `rows.ts`, `schema.ts`, `derive.ts` and `src/renderer/src/transcript/view/rows/User.tsx` (M5: the row of several comments), after U3a is on master.
   - U10's: `src/shared/maws/document-tools.ts` (one parameter, one sentence) and `src/artifacts/document/edit-plan.ts` (the thread's message), which UC-8 names; and, by R2 and R4: `src/engine-host/tool-server/documents.ts` (the parameter passed through), `src/artifacts/document/comment-counts.ts`, `src/artifacts/slides/comment-counts.ts` and the design workbench's count (the count rule), `src/artifacts/document/editor/comments/surface.ts` and the editor's decoration (one `flash`).
   - U12's: `src/renderer/src/tools/browser/Pane.tsx` (the dock's host props), which UC-8 names; and, by R3, `src/main/browser/comment/index.ts` and `mode.ts` (one handler, one message to the page). `src/renderer/src/tools/browser/store.ts` is not edited (decision 22).
   - U4's: `src/renderer/src/composer/submit/send-human-prompt.ts`, one optional field on `HumanPromptResult`, `pendingKey?: DeliveryKey`, set only with `disposition: 'unconfirmed'` (decision 8; §D), with U4's review. U4a edits the same folder: whoever merges second keeps both changes. `submit-state.ts` is read for `SENDS_AT_NEXT_STEP` and `STARTS`, as today.
   - U9's: none.
   - `src/shared/ipc/schema/layout.ts`: one key added (UC-8: "a child adds a key of its own").
7. **Law 7:** today's tokens and shapes. The checkbox is the app's existing checkbox style, the chip the existing chip style, the sent line `text-ui-sm text-fg-muted`.
8. **Copy** goes through `SIDE_COPY` (`src/renderer/src/side/copy.ts`); the strings are in Interfaces §E.

## What the code holds today

Checked at `7e5f2016c`. Build F's copies of `src/renderer/src/side/`, `src/shared/anchor/`, `src/services/side/`, the browser's comment files, `src/main/browser/comment/`, `tools/document/comments.tsx`, `src/main/library/files.ts`, `src/shared/ipc/schema/side.ts`, `remote-unavailable.ts`, `transcript/model/user-text.ts`, `document-tools.ts` and `edit-plan.ts` are identical to master's (`git diff --stat f1852de3a HEAD -- <those paths>` is empty), so for them "today" is also what F does.

- **The control.** `DestinationControl` (`side/CommentFormParts.tsx`) draws two radios, labels `data-destination="thread"` and `"main"`. `useCommentForm` (`side/comment-form.ts`) starts on `thread`, keeps the text in React state, and keeps a send that outlives its mount in a module map by `sendKey`.
- **The sends.** `sendComment` (`side/actions.ts`) invokes `side.sendToMain` or `side.thread.open`. Both are served on the machine side (`src/services/sessions/service.ts`, `src/services/side/`), which builds `[image?, text]` with `commentContent` and reads the screenshot through `readScreenshotBlock` under `<userData>` and the session's directories. `side.sendToMain` steers at `next` while a turn runs and otherwise sends through the app queue. Both commands and `side.screenshot.preview` are in `REMOTE_UNAVAILABLE` (`src/shared/ipc/remote-unavailable.ts`), so for a session on another machine both segments are greyed. For a session a terminal holds, "Send to main" is greyed with "Held by …" (`availabilityRefusal`).
- **`sendToSession`** exists with `origin: 'comment'` among `HumanPromptOrigin` (`composer/submit/send-human-prompt.ts`); the card's thread Reply already uses it. It returns `disposition: 'sent' | 'steered' | 'queued' | 'held' | 'refused' | 'unconfirmed'`. For a terminal session it sends base64 image blocks first as files (`laneA.media`, at most `FILES_MAX = 4`, closed for a session on another machine) and then the text (`laneA.send`). For a session MAWS runs on another machine it refuses content whose JSON is past `REMOTE_INLINE_MAX_BYTES`.
- **The only producer of a comment's screenshot** is the in-app browser's crop, written by the app's main process under `<userData>/browser/crops/` (`src/main/browser/comment/crop.ts`), at most 3.5 MiB.
- **The store** (`side/card/store.ts`) holds one open card per window; `openCard` replaces it ("the latest open winning"). `CommentCardHost` closes its card when it unmounts. Only documents, decks and designs pass `draftRule: true` (`tools/document/DocumentPanel.tsx`, `presentation/DeckBody.tsx`, `design/DesignBody.tsx`), which keeps a typed draft in `tools/document/comment-drafts.ts`.
- **The hosts:** `tools/document/comments.tsx` (`artifact`; `margin` or `anchored`), `tools/artifacts/viewers/ByteViewer.tsx` (`artifact-page`, `anchored`), `tools/browser/Pane.tsx` (`browser`, `docked`; its host id is a `useId` of the mount, and `accepts` matches the page's URL).
- **The page-side script** (`src/preload/browser-comment.ts`) keeps the latest pick as `subject` and drops it only when the viewport grows back to its height at the pick (`onViewport`). Its messages from main are `arm`, `disarm` and `pickAt` (`src/shared/browser/comment-protocol.ts`); nothing tells it that a card opened or closed.
- **The reader.** `parseAnchoredText` (`src/shared/anchor/message.ts`) reads the last non-empty line as the tag and strips the first line only when it equals the lead regenerated from that tag. Its one product caller is `userTextOf` (`transcript/model/user-text.ts`); the row carries `anchor` and `anchorFrame`, and `User.tsx` draws one `AnchorChip`.
- **The reply.** `plan()` in `src/artifacts/document/edit-plan.ts` posts `this.results.map((result) => result.line).join('\n')` as the thread's message when `answering` is given; `patch-writer.batch.test.ts` and `engine-host/tool-server/documents.test.ts` pin it.
- **The export folder.** `lastExportDirectory` is a variable of `createLibraryFiles` (`src/main/library/files.ts`), null at each launch; the dialog's default is `lastExportDirectory ?? deps.downloads()`.
- **The count.** `documentCommentCounts` (`src/artifacts/document/comment-counts.ts`) counts every open thread whose passage lives, including the empty thread the editor writes when a card opens.
- **Layout storage.** `<userData>/layout.json` is one JSON object of keys; main's own key `window.main` lives there. Build F loads every key into a map, reads only the keys it names, and writes the whole map back (`git show f1852de3a:src/main/layout/store.ts`), so a key it does not know survives it.
- **A terminal send whose fate is not known.** `laneA.send` answers `unconfirmed` when the bridge took the words and had not said whether they entered (every post lost or answered 503 or 504, or no fate within five seconds: `src/services/lane-a/deliveries.ts`). The port then keeps the text under its delivery key (`holdPendingSend`, `src/renderer/src/stores/lane-a.ts`), and the only place that shows it, with "Send again" and "Dismiss", is `PendingSends` inside `Composer` (`src/renderer/src/composer/PendingSends.tsx`), which is not mounted while that session's tab is not in front.
- **The dock's room.** A docked card may be as high as half the column less 16 px and never over 320 px (`stripCard`, `stripMax`, `DOCK_MAX` in `src/artifacts/comments/placement.ts`), and a composing card scrolls as a whole (`overflow-y-auto` in `CommentCard.tsx`). The window is at least 600 px high (`src/main/window.ts`), which leaves a docked card about 224 px.
- **The browser's tabs in the window.** `browser` (`src/renderer/src/tools/browser/store.ts`) is a plain store any module can subscribe to; `setSessions` there replaces a session's tabs for both a change and a full list. `connectBrowserComment` is mounted once by `App.tsx`, not by a pane.

**Tests that pin today's behaviour and change:** `side/card/CommentCard.test.tsx`, `side/card/CardHost.test.tsx`, `side/card/store.test.ts`, `side/CommentComposer.test.tsx`, `side/actions.test.ts`, `tools/document/comments.test.tsx` and `comment-session.test.tsx`, `tools/browser/comment/connect.test.ts`, `src/preload/browser-comment.test.ts`, `src/shared/anchor/message.test.ts` (additions only), `src/services/sessions/side-thread.test.ts`, `src/shared/ipc/schema.test.ts`, `src/shared/ipc/wire.test.ts` (the manifest), `transcript/model/user-text.test.ts` and `side-thread.test.ts`, `transcript/view/rows/side.test.tsx`, `src/artifacts/document/patch-writer.batch.test.ts`, `src/engine-host/tool-server/documents.test.ts`, `src/main/library/files.test.ts`. **Tests that must pass unchanged:** `src/services/side/send-to-main.test.ts`, `src/services/sessions/service-register.test.ts` (its `side.sendToMain` cases), `test/lane-b/offer-coverage.test.ts`, `test/endpoint/by-effect.test.ts`, `test/one-working-folder.test.ts`.

**E2e specs that cross this code** (run on a Mac by the architect, edited in M8): `side`, `browser-comment`, `deliverables`, `document-standalone`, `library`, `p1-live` and `code-editor` (all seven locate the two radios, by role and name or by `data-destination`); `presentations-comments` and `design-comments` (each resolves and reopens a thread nothing was said in and expects "1 open comment", which M7's rule makes none); `document`, `document-margin`, `document-narrow`, `dashboard-comments` (cards and counts); `cross-build` (the stored key).

## Reported to the architect

Each is a place where the code contradicts the child's file, or a file's owner is not the one the section assumed. Each has a default this document is written at, and the one place a different ruling changes. **Ruled 2026-11-12: all six defaults stand** (Decision Log 2 to 7).

| | what the section says | what the code shows | default written here | a different ruling changes |
|---|---|---|---|---|
| **R1** | "The command `side.sendToMain` is retired with its row in `src/shared/ipc/remote-unavailable.ts`"; UC-7's first insertion removes that row | The command is owned by `machine`, so it is in the wire manifest. `classifyWireChange` calls a removed command breaking, and `wire.test.ts` ("fails a breaking change in every mode") refuses it unless `WIRE_MAJOR` rises, which ends the link to a machine on build F. While the command is registered, `test/lane-b/offer-coverage.test.ts` requires its `REMOTE_UNAVAILABLE` row. | The window stops calling it. The command, its handler (`src/services/side/send-to-main.ts`), its row, its grade and their tests stay as they are. The charter's X10 line says "no caller in the window from this build; removed at the next wire major", and M8 logs that removal as debt. No file of U9's is edited. | Constraint 4 and M2's "does not touch" |
| **R2** | The document editors' comment binding under `src/artifacts/document/` is among "the files UC-8 names no owner for" | The root's UC-8 table gives `src/artifacts/` to U10 and names only `edit-plan.ts` and `document-tools.ts` for U5 | U5a makes the insertions listed under Constraint 6 (the count rule, one `flash`), U10 reviews them | Constraint 6; M7 |
| **R3** | The browser's comment files are U5's: `preload/browser-comment.ts`, `shared/browser/comment-protocol.ts`, `tools/browser/comment/` | X-216 needs main to carry "the card opened, the card closed" to the page, in `src/main/browser/comment/`, which is under `src/main/browser/` (U12's) | One handler in `index.ts` and one message in `mode.ts`, by U5a, reviewed by U12 | Constraint 6; M4 |
| **R4** | `artifact_edit`'s `reply` is "one parameter and one sentence" in `document-tools.ts`, and the message in `edit-plan.ts` | The parameter reaches the plan through `src/engine-host/tool-server/documents.ts` (U10's by UC-8, not named for U5) | The pass-through line is a named insertion | Constraint 6; M6 |
| **R5** | The tracking map has U5a wait for step 0 only; the child's file has the transcript row merge after U3's landing | U3a's milestones edit `user-text.ts`, `rows.ts`, `schema.ts`, `derive.ts` and `User.tsx`, the same files as M5's insertion | M5 starts only once U3a is on master. If every other milestone is reviewed first, the controller stops and asks: the default is that the landing waits, since A4's last sentence cannot be shown without M5 | M5's precondition; Concrete Steps 1 |
| **R6** | `artifact_edit`'s description "gains one sentence" | With `reply`, the description's older words "answering: a comment thread id posts the result into that thread" are no longer what happens | The description changes exactly as probe P4 ran it (ten of ten): the one sentence added, nothing else reworded | Interfaces §I |

Two findings that are not contradictions but bound the design, both from reading the code for P7 (see "Probes"): a message to a terminal session **on another machine** may be at most 65,536 UTF-16 units (`SEND_TEXT_MAX`, `src/endpoint/rl10/link.ts`), and attachments to such a session are closed. Decisions 9 and 10 answer them.

## Decisions settled at authoring

Means the child's file leaves open. Each says why, and what lost.

1. **`quote`, the host kind `review` and the layout `inline` are U5b's.** No surface of this landing can supply a quote or mount an inline card, so nothing here could prove them; the contract's names are kept free for U5b. A fenced quote added later sits inside a comment's text, so a reader from before it (this landing's, or build F's) draws it as a code block and nothing breaks. Declaring the fields now with no writer lost: an unused field in a persisted format is a decision nobody tested.
2. **A ticked comment's content is built by one new command, `side.comment.content`,** owned by the app's main process, graded `client`, whose input names no session and whose only root for a screenshot is `<userData>`. Main builds `[images…, text]` and the window hands it to `sendToSession`. Why: the screenshot's file is on this Mac whatever machine the session is on, so the builder must run here and must not be routed by the session's address; a `client` command is never on the machine link, so no remote caller can reach it and build F never meets it; it is not in the wire manifest. The session's own directories leave the allowed roots for this path because the only producer writes under `<userData>/browser/crops/`; a narrower root is the safer one. Lost: a machine-owned command addressed by the session (the router would send it to the session's machine, where the file is not); a machine-owned command with a path (a wire addition and a cross-build case, for nothing); building in the window from `side.screenshot.preview` (unavailable for a session on another machine, and two builders of one text).
3. **A side thread takes the pass through one optional key,** `more`, on the `comment` member of `side.thread.open`'s `from`. An optional key inside a union member is an addition to the wire; a new member or a changed `anchor` field is not. The machine side builds the thread's first message as today, with today's roots.
4. **The pass, and each comment's typed text, live in the card's store; a send is an act on the store,** not a mounted component's state. A card can then unmount with its host, move to another comment, or be closed while a send is on its way, and nothing typed depends on what is mounted. `useCommentForm`'s module map of sends by `sendKey` goes.
5. **A send removes exactly the comments it carried, and only once it has gone** (the *flight*). A comment opened while a send is on its way joins the same pass and stays editable; a refused send leaves every comment where it was. One flight per pass at a time. From the moment it sets out a flight owns its comments, each host's settlement callback and whatever that callback holds (a document's replica), independently of the pass: nothing that later happens to the pass or its subject takes them from it (decision 17). The alternative, freezing the surface until the send answers, lost: a start of a session can take a long time, and the person would lose a pick meanwhile.
6. **Whether a tick can send comes from the session's port** (`sessionControls(appSessionId)?.capability('send')`, else `heldWords`), the same answer the composer draws. That is what makes one rule cover the three routes; the form's own table of `ready`, `mainBlocked` and `useRemoteUnavailable(…, 'side.sendToMain')` goes.
7. **Unchecked is off before Send** where the window already knows the reason: an archived session (the availability's words), a record with no engine session id ("This session has no conversation to fork yet"), a session on another machine (`useRemoteUnavailable(appSessionId, 'side.thread.open')`). A conversation whose transcript file is missing is still found only by the machine side and comes back as a refusal, as today.
8. **"Sent to <title>" is said only for a confirmed delivery.** A terminal session's send can answer `unconfirmed`: the bridge took the words and has not said whether they entered. The comments then leave the pass, because from that moment the words belong to the pending send the port made under its delivery key (`holdPendingSend`), which is the one authority for their recovery and which the send's result names (`pendingKey`, set by the terminal port from the key `laneA.send` answered): nothing in the comment code sends them again by itself, at any time. The card's place shows a line that follows that pending send by its key and does not leave by itself: the strip's own words for its state (§E), and one action, Show, which brings that session's tab to the front, where `PendingSends` holds the text with "Send again" and "Dismiss". When the delivery's fate under that key is `entered`, the line becomes "Sent to <title>" and leaves after four seconds; when the person dismisses or resends the entry in the strip, the line leaves with it. A document's comment is recorded in its thread at the hand-off (the callback is told `true`): the message carries the thread's anchor and may have arrived, so the thread must exist. An `unconfirmed` result that carries no key (the bridge named none, so no pending send was made) is a refused send ("The session did not confirm the message") and the comments stay. Reading `unconfirmed` as sent, as first written, lost: neither a lost post nor an unknown outcome shows receipt, and the recovery sits in a composer that this landing lets a person comment without seeing.
9. **Screenshots a route cannot carry are left out by count, said before the send.** A terminal session on this Mac takes four files a message (`FILES_MAX`); one on another machine takes none (its `media` control is closed). While "Send to main" is ticked and the pass holds more screenshots than that, the card shows "N screenshots are left out: <the route's reason>" and the send carries the first ones, in the comments' order. The line sits under the row with the checkbox and Send, where a refused send's reason sits, and reads the count and then the sentence the composer already uses for that session (one sentence for one fact, wherever it is said; the architect's decision on the drawn example). On a route whose room is 0 the screenshot can never go (unchecked is locked there too), so the card shows no thumbnail and no "Remove screenshot" for it: the line alone says it. A size the route refuses (a session MAWS runs on another machine, past `REMOTE_INLINE_MAX_BYTES`; any send past the engine host's bounds) comes back as a refused send with the route's own words, and the person removes a screenshot and retries. P1 showed the engine keeps several images in order in every state, so no "first screenshot only" branch exists.
10. **A message to a terminal session on another machine is checked against 65,536 UTF-16 units before it goes** and refused in the card with "Too long for a terminal session on another machine: send fewer comments at a time". The endpoint would refuse it as `malformed`, which says nothing to the person. A test pins the window's constant to `SEND_TEXT_MAX`.
11. **A side thread of several comments is titled "<first label> and N more"** by reading the count from its first message with `readAnchoredMessage` where the title is made (`src/services/sessions/setup.ts`, both calls of `sideThreadTitle`). Nothing is added to `Lineage`: it is a strict schema, stored in the index and carried in events, and build F refuses a field it does not know. The side-thread row in the parent's transcript keeps the first comment's label alone.
12. **The page keeps an element in view from the pick for two seconds, and beyond that only while it has been told a card is open.** The pick must count at once because the dock's growth can reach the page before the word that a card opened; the two seconds bound a pick that opens no card (a tab with no dock opens the sheet). Interfaces §G has the table.
13. **A row of several comments draws each screenshot under its own comment, and is not offered Edit.** *Pending the owner's look at the drawn example (frame 5, A against B); B, the screenshots together after the comments, changes this decision, §H and M5's tests only.* The pairing needs nothing from the engine: `readAnchoredMessage` says for each comment whether its lead announces a screenshot, and the images of a message are in the comments' order, so the k-th image is the k-th such comment's. When the counts differ (a terminal session's files travel apart from its words; a route left screenshots out) nothing is paired and the images are drawn together after the comments, as a message's attachments are today. The reason first written for "together", that a steered message's images are stored apart, was wrong: P1 shows the row keeps them, in order. Edit is not offered because the edit field holds one text and the resend seam frames one anchor (`anchoredTextOf`), so an edit would drop the other comments' framing. Copy and the markdown export give each comment's lead and text.
14. **The last export folder is the layout key `library.exportFolder`,** value `{ path: string }`, main's own key as `window.main` is: added to `LayoutKeySchema` for the store's type, and refused to the window's `layout.get` and `layout.set` by the same guard in `registerLayoutHandlers` (`src/main/layout/store.ts`). UC-14 forbids a settings key; build F keeps a layout key it does not know. The folder is used only if it still is a directory on this Mac. With none: the artifact's Space's linked folder, else `workingFolder(record).path` of the session that made the artifact, else Downloads, each only for an artifact of this Mac and only if it is a directory.
15. **`parseAnchoredText` keeps its body until M8.** Its product caller moves to the new reader in M5; M8 moves its test and e2e importers and deletes it. Changing it in place lost: it is the reader of a persisted format and its tests are the proof that old transcripts draw unchanged.
16. **"Session: <title>" follows one rule on every host:** shown when the receiving session is not `shownSession()`. `CardFrame.namesParent` goes.
17. **An editor's thread for an unsent comment lives exactly as long as the comment is in the pass.** It is recorded as the thread's message when the send goes, and withdrawn when the person discards the comment or the artifact's tab closes; a host that unmounts because its surface was hidden no longer withdraws it (only the active body of a tab is mounted, so today a hidden document loses its draft). At a tab's close no editor is mounted, so the tab's state withdraws the thread itself through the replica it holds (`discardThread` in `src/artifacts/document/threads.ts`), before the pass is dropped. **A comment in flight is not part of that:** closing the tab withdraws the threads of ordinary drafts at once, and leaves the thread, the replica hold and the settlement callback of every comment in flight to the flight (decision 5). When the flight settles, success records the comment in its thread, which then stays as a sent comment; a refusal, with the pass gone, withdraws the abandoned empty thread; and each callback and each release of the replica runs exactly once. Withdrawing at the close without that exception, as first written, lost: the thread is still empty while the send is on its way, so the agent would receive an anchor naming a thread that no longer exists. `tools/document/comment-drafts.ts` keeps its exports as readers over the pass, so the editor's `draft()` and the tab's close guard read the same text the card shows. **A known limit:** a quit or a crash with an unsent comment leaves its empty thread and mark in the document, as a crash with a card open does today. Nothing sweeps such a thread at the next launch, because an empty thread may be another window's or another member's comment being written; it does not count (M7), and the pull request names it as residue.
18. **A refusal that arrives with no card open** makes the mounted host open the card on the newest refused comment, so the reason is read where the text is; with no host mounted it is today's warning toast, "The comment was not sent: <reason>".
19. **The sheet shows the checkbox as the card does,** its caption as the title only (law 3); the two-line captions under each segment go with the segments.
20. **"The agent's answer arrives"** (l6-artifacts-19) is the first of: the thread gains a message whose author is a session, or the turn of the card's side thread ends. Both are read in `tools/document/comments.tsx`.
21. **Every e2e edit is M8's.** From M2 to M8 the seven specs that locate the radios, and from M7 the two count scenes, are stale; nobody runs e2e in between, and the architect's runs follow M8.
22. **The end of a browser tab is read where the comment code is connected,** not in the browser's store: `connectBrowserComment` subscribes to `browser` and calls `dropSubject('browser', tabId)` for every tab id a change or a full list no longer holds. It is mounted once for the window, so a removal received while no pane is mounted is seen. An insertion in `setSessions` lost: that file is U12's, and a subscription needs no edit there.
23. **The card keeps its checkbox row in view at every height.** The header and the row with the checkbox and Send (with the left-out line or a refusal under it) never scroll; the list of the other comments, the thumbnail and the field are one region between them that shrinks and scrolls; and the list itself shows at most three lines (72 px) and scrolls within itself. Measured in the drawn example: a card of one comment with its thumbnail is 190 px, the second comment of a pass 270 px, against a dock that allows 320 px at most and about 224 px in the smallest window. Leaving the whole card to scroll, as today, lost: Send would leave the screen at the fifth comment or in a short window.
24. **A message of several comments opens with a line no single comment ever opened with, and escapes what could split it** (§A). Telling several comments from one by leads and tags alone, as first written, lost: two comments on the same element are byte for byte one older comment whose words hold a tag, a blank line and a lead, so no test of those can keep both promises (a message of one reads as before; a message of several reads whole).

## Plan of Work

Eight milestones. M1 produces what M2, M3 and M5 consume; M2 before M3; M4 after M3 (it uses `onClosed`); M5 after M1 and after U3a is on master; M6 stands alone; M7 after M3; M8 last. Each ends with the tree green on the VM (typecheck, lint of what changed, the whole unit suite) and a review at its boundary.

### M1 — What a comment says, and what the machine takes

**What exists at its end.** A message of several comments can be written and read: `commentsMessage` and `readAnchoredMessage` in `src/shared/anchor/message.ts`, the first byte-identical to `anchoredMessage` for one comment. The machine side opens a side thread from one to twenty comments. Main answers `side.comment.content` with the content of a send to the main conversation. No window code calls any of it yet, and nothing the person sees changes.

**What it touches.** `src/shared/anchor/message.ts` and `message.test.ts`; `src/services/side/content.ts` (the builder for a list) and `screenshot.ts` (unchanged checks, reused); `src/services/sessions/service.ts` (`openSideThread`), `src/services/sessions/setup.ts` and `src/services/side/side-threads.ts` (the title); `src/shared/ipc/schema/side.ts`, `names/side.ts`, `grades/side.ts`, and the registry's pinned lists that a new command and a new key move (`src/shared/ipc/schema.test.ts`, `routes.json` and its test, `wire.ts`'s minor, `wire-manifest.json` and `wire-fingerprint.json`, generated on the VM); a new handler in the app's main process for `side.comment.content`, registered where main's own handlers are (`src/main/app.ts` or a module of `src/main/` it calls) with `userData`; tests beside each.

**Interfaces.** Exposes §A and §B.1 to §B.3 to M2, M3 and M5. Consumes nothing.

**Decisions.** 2, 3, 11, 24. The framing and the reader's rule are §A's and are the subtle part: a message is read as several comments only when its first line is the framing's and the whole structure checks; everything else, which is every message a single-comment writer ever produced, is read by `parseAnchoredText`'s rule, unchanged. The side thread's size check (`sendContentRefusal`) stays where it is, on the built message. A refused screenshot names its place in the input (`from.screenshot`, or `from.more.<i>.screenshot`; for `side.comment.content`, `comments.<i>.screenshot`), as `relaySide` does today for one.

**What it does not touch.** `parseAnchoredText` and `anchoredMessage` (bodies unchanged); `side.sendToMain`, its handler and its tests; `REMOTE_UNAVAILABLE`; any renderer file.

**What it proves.** Constraint 3 (a table test: for each fixture of `message.test.ts`, `commentsMessage` of one equals `anchoredMessage`, and `readAnchoredMessage` of that text gives one comment equal to `parseAnchoredText`'s answer). **The review's counterexample, as a regression test:** `anchoredMessage` of one comment whose text is `A`, a blank line, that anchor's own tag, a blank line, that anchor's own lead, and `B` is read as one comment with that text whole, though it is byte for byte the blocks of two comments on one element. The format for two and for twenty comments, to main and to a thread (the framing line first, the plural preamble once, in the last block). The escape, both ways: a comment whose own lines begin with `<maws_anchor`, with `\<maws_anchor` and with two backslashes round-trips exactly and never splits. The reader's refusals, each read as one comment by the old rule: a framing line whose count is not the number of blocks; a block whose lead is not its tag's; a framing line over a message of one block; text after the last tag. A `/btw` promotion and a lead with the screenshot sentence, as before. What build F's reader makes of a framed message (`parseAnchoredText`, kept until M8, is F's reader to the byte): the last comment's anchor, and the framing line, the earlier blocks and the last lead as text. `side.thread.open` with `more`: the content's images in the comments' order before one text block, the lineage's anchor the first comment's, the title "… and 2 more", an input of twenty-one refused. `side.comment.content`: a file outside `<userData>` refused naming its comment; no session read. The wire: `wire.test.ts` passes with the minor one past master's and the manifest regenerated, and classifies the change as additive.

### M2 — The checkbox and the one send path

**What exists at its end.** On every surface that opens the card or the sheet, the two segments are gone and one checkbox, "Send to main", stands in their place, unchecked unless the surface asked for main. Ticked, Send delivers the comment through `sendToSession` on all three routes, and once the delivery is confirmed the card's place reads "Sent to <title>" for about four seconds; a terminal session's send that is not confirmed says so instead and stays (decision 8). For a session on another machine the checkbox is ticked and locked. The card still holds one comment at a time, and a second comment still replaces the first (M3 changes that).

**What it touches.** `src/renderer/src/side/CommentFormParts.tsx` (the checkbox replaces `DestinationControl`), `comment-form.ts`, `actions.ts` (`sendComments` replaces `sendComment`), `copy.ts`, `CommentComposer.tsx`, `side/card/CommentCard.tsx`, `CardHost.tsx` (the place's line) and `store.ts` (its record, `notes`); `src/renderer/src/session/controls/controls-for.ts` (`screenshotRoom`) and `lane-a.ts` (`FILES_MAX` exported; `pendingKey` on its `unconfirmed` result) with `lane-a.test.ts`; `src/renderer/src/composer/submit/send-human-prompt.ts` (U4's: the one field); their tests, and `tools/document/comments.test.tsx` where it asserts the radios.

**Interfaces.** Consumes §A, §B.2. Exposes §D's `sendComments` and §E's copy to M3.

**Decisions.** 6, 7, 8, 9, 10, 16, 19. The card's Enter, ⌘Enter, Shift+Enter and Escape stay the form's own key handler; no row is added to the keymap (UC-6). A session that is not running is started by the send itself, inside `sendToSession`; the form's own `acquireSession(parent, 'side')` before a send to main goes, and the button reads "Starting…" while the result's promise is pending for a session whose process is not ready. An error `sendToSession` throws (a host error) is a refused send with the error's message. The locators change with the DOM: one `input[type=checkbox]` named "Send to main", carrying `data-send-to-main`, in the card and in the sheet.

**What it does not touch.** The pass (one comment per card still); `side.thread.open`'s caller keeps sending one comment; the page-side script; the editors' draft opt-ins; `remote-unavailable.ts`.

**What it proves.** A1 and A2 for a card that holds one comment, by unit tests on the three routes with a stubbed port: unchecked by default and after a send; ticked from `destination: 'main'`; ticked and locked with the reason as title for a session on another machine; off with "Held by …" for a terminal session with no live bridge; both off, Send off and the reason as a line for an archived session. A ticked send calls `side.comment.content` then `sendToSession` with `origin: 'comment'` and never `side.sendToMain`. The note's wordings by disposition for a confirmed delivery. A sequence test that holds the content's promise open and then the send's: the field is disabled, a second Send does nothing, Close closes the card and the answer still lands; a refusal after Close is a toast. Screenshots left out by count for a terminal session, with the line shown before the send. The 65,536 check. "Session: <title>" only when the receiving session is not the one the main area shows. **An unconfirmed hand-off, two held sequences** (decision 8). Lost posts: `laneA.send` answers `unconfirmed` with a key; the comment leaves the pass, the place shows the strip's words for that pending send and not "Sent to", and with every timer advanced `laneA.send` has been invoked once; the fate `entered` then turns the line into "Sent to <title>", which leaves after four seconds. A late refusal with the composer hidden: the session's tab is not in front, the fate `refused` arrives, the line reads "Not entered in <title>: <reason>" and stays; Show brings the session's tab to the front, where the strip lists the entry with its text; nothing was sent again. The line follows the pending send of the result's key and no other: with two pending sends of the same text for the session, the line and Show are the second one's. An `unconfirmed` result with no key is a refused send and the comment stays. On a route whose room for screenshots is 0 the card draws no thumbnail and no "Remove screenshot", and the left-out line is under the checkbox row.

### M3 — The pass: drafts that stay, and several comments in one send

**What exists at its end.** UC-5's draft model on every host. Escape leaves the card and its text; an empty card goes when the keyboard leaves it; Close discards that comment; a host that unmounts, a surface that hides, the side column showing another session and a second comment being opened all keep what was typed. On a browser page and an HTML page a second comment joins the first: the card lists the others, the button reads "Send N comments", and one send carries them all, to the main conversation or into one side thread. A pass with comments and no open card shows the chip. Documents, decks and designs still keep one unsent comment per artifact.

**What it touches.** `side/card/store.ts`, `CardHost.tsx`, `CommentCard.tsx`, `comment-form.ts`, `actions.ts` (`sendPass`), `register.ts`; the three hosts: `tools/document/comments.tsx` with `comment-drafts.ts`, `tools/artifacts/viewers/ByteViewer.tsx`, `tools/browser/Pane.tsx` (U12's: the dock's props) with `tools/browser/comment/connect.ts` and `dock.ts`; where each subject closes (the subscription of decision 22 in `tools/browser/comment/connect.ts`, the artifact tab state's disposal, the session store's removal); their tests, including `side/card/store.test.ts`, `CardHost.test.tsx`, `tools/document/comment-send-move.test.tsx` and `comments-editor.test.tsx`.

**Interfaces.** Consumes §A, §B.1, §D. Exposes §C and §F to M4, M7 and to U5b, U10 and U12.

**Decisions.** 4, 5, 17, 18, 22, 23. The state table of a pass's send is §D's and is fixed before any code. The browser host's `accepts` no longer compares the page's URL for a composing card: the pass belongs to the tab, and a comment keeps its own page address in its anchor; a thread-phase card re-docked from the Side pane keeps today's match by URL. A host registers `{ kind, subject, holds }` with the store while mounted, so the seam's opener finds the pass from the placement's `hostId`. A `one` host handed a second passage while its pass holds a comment (the editor asks `draft()` first, so this is a race) withdraws the thread just written and returns the person to the unsent comment.

**What it does not touch.** The message format; the machine side; the page-side script (M4); the editors themselves under `src/artifacts/`; the Review host.

**What it proves.** A4 but for its transcript sentence (M5) and its last e2e form (M8): unit tests of the store and the card for Escape, blur, Close, Remove, a second open on a `many` host and on a `one` host, a host's unmount and remount with the text back, the chip's count and its click, "Send N comments", the send's content call carrying the comments oldest first, the pass ending and the next one starting at the surface's default. §D's table row by row, each with the awaited promise held open: a comment added during a flight survives its success and its refusal; Remove and the field are off for a comment in flight; a subject that closes during a flight; a host that unmounts during a flight and one that mounts after the refusal. A document's unsent comment survives its tab being hidden and shown, its thread is withdrawn only on discard, and the tab's close guard still asks. **A document tab closed during a flight, on a real document** (decision 17; a test beside `tools/document/comments-editor.test.tsx`, not only at the store): with the tab closed while each route's promise is held open (`side.comment.content`, then the send, for a ticked comment; `side.thread.open` for an unchecked one), a success leaves the thread holding the comment's message and its mark, a refusal leaves neither thread nor mark, an ordinary draft of the same tab is withdrawn at the close, and the replica is released and each callback called exactly once. A browser tab removed while no pane is mounted, by a change and by a full list, ends its pass (decision 22). The card's structure (decision 23): the header and the checkbox row are outside the scrolling region, and the list of others is capped at three lines.

### M4 — The page is told when its card opens and closes

**What exists at its end.** A page in the in-app browser keeps a picked element in view only while its comment card is open. After the card closed, no resize scrolls the page.

**What it touches.** `src/shared/browser/comment-protocol.ts` (one message), `src/preload/browser-comment.ts` and its test, `src/shared/ipc/schema/browser.ts` and `names/browser.ts` (one command), `src/main/browser/comment/index.ts` and `mode.ts` (U12's, R3: the handler and the forward), `tools/browser/comment/` (the caller) and `tools/browser/Pane.tsx` (the dock's `onClosed`).

**Interfaces.** Consumes §C's `onClosed`. Exposes §B.4 and §G.

**Decisions.** 12. The height comparison in `onViewport` is removed; nothing is inferred from the viewport's height any more. The css the page is given is the open comment's own (`anchor.css`); a selector that matches nothing, or throws, leaves no subject.

**What it does not touch.** The pick, the crop, comment mode's arming; the owner's ruling that the picked element stays in view while the strip is open.

**What it proves.** A5: a unit test of the page-side script that fails on today's code (pick; the viewport shrinks for the dock; the window is made shorter; the card closes, which grows the viewport by less than it had lost; the window is made shorter again; the page must not scroll) and passes after. §G's table row by row, with a fake clock for the two seconds. Main forwards the message only to a live tab's own page.

### M5 — The transcript's row for several comments

**Precondition.** U3a is on master: `git cat-file -e origin/master:src/shared/engine/arrival.ts`. If it is not when every other milestone but M8 is reviewed, the controller stops and reports (R5).

**What exists at its end.** A message of several comments is one bubble: each comment's chip over its own text and its own screenshot, in the order made (decision 13, pending the owner's look). A message of one comment draws exactly as before.

**What it touches.** U3's files, by the smallest insertion: `transcript/model/user-text.ts` (`userTextOf` calls `readAnchoredMessage`; `copiedUserText`), `rows.ts` and `schema.ts` (one optional field), `derive.ts` (the field carried; `editable` false for such a row), `transcript/view/rows/User.tsx` (the comments drawn); their tests.

**Interfaces.** Consumes §A. Exposes §H.

**Decisions.** 13. The row keeps `anchor` and `anchorFrame` for one comment, untouched, so the chip, Edit and the resend seam (`composer/resubmit-seam.ts`, U4's, not edited) behave as today.

**What it does not touch.** Anything of U3a's arrival rows; the resubmit seam; `side_thread` rows.

**What it proves.** The last sentence of A4 at unit level: a `user.message` whose text is `commentsMessage` of two draws two chips and two texts in order, from the live prompt, from a queued steer and from a held entry; the row offers no Edit; Copy gives both leads. The pairing: two comments that each announce a screenshot and two images draw each image under its comment; one image for two announcing comments, and images with no announcing comment, draw together after the comments. Every existing case of `user-text.test.ts`, `side-thread.test.ts` and `side.test.tsx` passes unchanged.

### M6 — The agent's reply in its own words, and the export folder

**What exists at its end.** When an agent answers a document comment with an edit, the thread's message is the agent's `reply`, or "Edited this passage." when it gave none; the card, the margin and the Word export read that. The export dialog opens in the folder of the last export, also after a relaunch.

**What it touches.** `src/shared/maws/document-tools.ts`, `src/artifacts/document/edit-plan.ts`, `src/engine-host/tool-server/documents.ts` (R4), their tests and `src/shared/maws/tools.test.ts` if it pins the description; `src/main/library/files.ts` and its test, `src/shared/ipc/schema/layout.ts` (the key), `src/main/layout/store.ts` (the guard), and where `createLibraryFiles` is given its dependencies (the layout store's `get` and `set`, and the reads the fallback needs).

**Interfaces.** Exposes §I. Consumes `workingFolder(record)` from `src/shared/sessions/working-folder.ts` (U8a, on master).

**Decisions.** 14, and R6. The result lines the tool returns to the agent do not change. A failed write of the key is logged and never fails the save. The key is written after the copy succeeded, as `lastExportDirectory` is set today. The e2e seam (`MAWS_E2E_SAVE_PATH`) keeps bypassing the dialog and still records the folder.

**What it does not touch.** `artifact_reply`; tracked changes in the export; the server's instructions (`MAWS_SERVER_INSTRUCTIONS`: this landing adds 0 characters to them; `artifact_edit`'s description grows by the one sentence and stays far under the engine's 4,096 cut).

**What it proves.** A18: the thread's message is `reply`, and the fixed sentence without one; an edit without `answering` ignores `reply`; `reply` of 0 or 2,001 characters is refused by the schema; the tool's result is byte-identical to before. The dialog's default path: the stored folder; a stored folder that no longer exists falls through; each step of the fallback; an artifact of another machine skips the two machine-side folders. A second `createLibraryFiles` over the same layout store (a relaunch) opens in the folder the first one saved to. `main/library/files.test.ts`'s case "kept for one run only" is rewritten to the new rule.

### M7 — A document's count, and the answered passage

**What exists at its end.** A document's, deck's, design's or dashboard's count of open comments does not move when a card opens and closes unsent, and rises by one when the comment is sent. When the agent's answer to a comment arrives, the commented passage is tinted once for about a second and a half; in a document body under 720 px the floating card closes to the passage's mark at that moment unless the keyboard is in it.

**What it touches.** U10's files (R2): the two readers of open threads, `src/artifacts/document/comment-counts.ts` (documents and dashboards) and `src/artifacts/slides/comment-counts.ts` (decks), and the design workbench's count where it does not already read one of them; `src/artifacts/document/editor/comments/surface.ts` (`flash`) and the editor's decoration for it; `tools/document/comments.tsx` (the trigger and the fold); their tests.

**Interfaces.** Consumes §C. Exposes nothing.

**Decisions.** 20. A thread counts once it holds a message. The tint uses today's highlight token, shows only if the document is on screen then, never scrolls the page, and under reduced motion shows and goes with no fade. It is asked once per answer: a thread that already flashed for a message does not flash again for the same message when the overlay remounts. The fold closes the card and nothing else; the thread is then opened by the editor's own activation of a mark, as today. In the margin the card stays. Decks and designs get the count rule and the tint's trigger is not wired for them (the child's "Not included").

**What it does not touch.** The margin's layout, the threads rail, the Word export.

**What it proves.** A3 (the count before, with an unsent card, after Close, after a send) for each of the four kinds. A17: the flash is asked once on the first of the two signals and not on the second; not asked when the document is hidden; the fold under 720 px, not with the keyboard in the card, not in the margin.

### M8 — The e2e scenes, the record, and the acceptance run

**What exists at its end.** The e2e specs follow the new DOM and hold the new scenes; the documents this landing amends carry their dated lines; `parseAnchoredText` is gone; the acceptance section has been run as written, as far as an executor can run it.

**What it touches.** `e2e/side.spec.ts`, `browser-comment.spec.ts`, `deliverables.spec.ts`, `document-standalone.spec.ts`, `library.spec.ts`, `p1-live.spec.ts`, `document.spec.ts`, `document-narrow.spec.ts`, `code-editor.spec.ts`, `presentations-comments.spec.ts`, `design-comments.spec.ts`, `cross-build.spec.ts`; `src/shared/anchor/message.ts` and the importers of `parseAnchoredText`; `docs/charter.md` (X10, X21, X9), `docs/doperpowers/plans/2026-10-19-p4-interface-ledger.md` (X36), `docs/doperpowers/evidence/p4/wr/reconcile-2026-10-23.md` and `docs/doperpowers/ledgers/2026-10-23-P4-WR.md` (candidate 50), `docs/tech-debt-tracker.md` (R1's removal at the next wire major; decision 17's limit); this document's Progress.

**Decisions.** 15, 21. The scenes, each with invented content:
- `side`: the sheet shows the checkbox unchecked with the title "Sent now"; ticked, the engine receives one text block equal to today's text for that anchor; during a turn it is a steer; unchecked opens the thread as before.
- `browser-comment`: A4 whole (two picks; Escape keeps the text; the second card lists the first; "Send 2 comments"; the side surface switched away and back shows "2 unsent comments" and the card with its text; the send is one frame of two images and one text; the transcript's bubble has two chips), then "Sent to <title>" in the dock, and **the page does not move when that line leaves** (its scroll position and the picked element's box are the same before and after); **the window at its smallest height** (600 px) with a pass of five comments and a six-line text: the Send button's box lies wholly inside the card's and the dock's; and the existing scenes with the checkbox in place of the radios.
- `deliverables`: the same pass on an HTML page, with the chip at the page's top right.
- `document-standalone`, `library`, `p1-live`, `code-editor` (the sheet's "Side thread" radio): the locators.
- `presentations-comments`, `design-comments`: the scene that resolves and reopens a thread sends its comment first, so that "1 open comment" counts a posted comment; a thread nothing was said in counts as none.
- `document`: A3's count, A2's note in a document's card, and the "Session: <title>" line; `document-narrow`: A17's fold.
- `cross-build`: one scene for `library.exportFolder` (§J), skipped unless the peer lacks the key in its `LayoutKeySchema`; a skipped scene is not evidence. It reads the dialog's `defaultPath` by replacing Electron's `dialog.showSaveDialog` in the main process, as `e2e/widgets.spec.ts` and `e2e/c11-live.spec.ts` do; `MAWS_E2E_SAVE_PATH` is left unset, because it skips the calculation under test.

**The record,** in the same pull request (UC-10), each a dated line where the ruling or contract stands:
- `docs/charter.md`, X10: the child's sentence for O-45, with R1's wording for `side.sendToMain` ("no caller in the window from this build; the command stays on the wire until the next wire major"); and "a message may carry several comments".
- `docs/charter.md`, X21: the pass, `holds`, `onClosed`, `subject`; the draft rule is every host's.
- `docs/charter.md`, X9: `artifact_edit` gains `reply`.
- The P4 interface ledger, X36: the draft rule is every card host's; one unsent comment per artifact stays the editors' rule.
- Candidate 50 in the two P4 WR documents: "Reversed by the owner's later `fix` on l6-artifacts-20: the dialog opens in the last export folder, kept across launches."
- The amendments the child lists for Review, Source control, `side`, the `review` host, `inline` and `quote` are U5b's.
- `docs/tech-debt-tracker.md`: the rows of "The pull request".

**What it proves.** The acceptance section, and that the e2e and node projects typecheck and lint with the scenes in place.

## Concrete Steps

Commands run from the worktree of branch `ux-wave/U5a`; `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U5a --`. Each call tests the pushed head, and each is its own call so that its exit status is read (never piped into `tail` or `head`).

1. **Base** (the controller: before M1, before M5, before M8): `git fetch origin master && git merge origin/master` (merge, never rebase or force-push), then push. Before M1: `git cat-file -e origin/master:src/shared/sessions/working-folder.ts && echo u8a-landed` prints `u8a-landed`. Before M5: `git cat-file -e origin/master:src/shared/engine/arrival.ts && echo u3a-landed`; if it does not print, M5 does not start (R5).
2. **While a milestone is built:** one TypeScript project at a time, `vmcheck 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'` for the renderer and `-p tsconfig.node.json` for `src/shared`, `src/services`, `src/main`, `src/preload`, `src/artifacts`, `src/engine-host` and `test/`; `vmcheck 'pnpm exec eslint <the changed paths>'`; and the milestone's suites:
   - M1: `vmcheck 'pnpm exec vitest run src/shared/anchor src/shared/ipc src/services/side src/services/sessions test/lane-b/offer-coverage.test.ts test/endpoint'`
   - M2: `vmcheck 'pnpm exec vitest run src/renderer/src/side src/renderer/src/session/controls src/renderer/src/tools/document'`
   - M3: `vmcheck 'pnpm exec vitest run src/renderer/src/side src/renderer/src/tools/document src/renderer/src/tools/presentation src/renderer/src/tools/design src/renderer/src/tools/artifacts src/renderer/src/tools/browser'`
   - M4: `vmcheck 'pnpm exec vitest run src/preload src/shared/browser src/main/browser src/renderer/src/tools/browser src/shared/ipc'`
   - M5: `vmcheck 'pnpm exec vitest run src/renderer/src/transcript src/renderer/src/composer/resubmit-seam.test.ts src/renderer/src/side'`
   - M6: `vmcheck 'pnpm exec vitest run src/artifacts/document src/engine-host/tool-server src/shared/maws src/main/library src/shared/ipc/schema'`
   - M7: `vmcheck 'pnpm exec vitest run src/artifacts src/renderer/src/tools/document src/renderer/src/tools/presentation src/renderer/src/tools/design src/renderer/src/tools/dashboard'`

   Expect each to pass whole. A suite outside the list that fails on the VM after a milestone, and is not one of the VM's known failures the build brief lists, is that milestone's to fix before its review.
3. **M1's wire files.** After the merge of step 1, read `WIRE_MINOR` in `src/shared/ipc/wire.ts` and take the next number, with its comment. After `side.thread.open`'s input is edited, regenerate the two generated files on the VM and bring them back:

       vmcheck 'pnpm wire:manifest >/dev/null; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json' > /tmp/u5a-wire.patch
       sed -n '/^diff --git/,$p' /tmp/u5a-wire.patch | git apply

   Expect a patch that touches those two files only, and whose manifest diff is one entry, `commands.side.thread.open`, and the minor. If `wire.test.ts` says "breaking change", a schema moved that must not: stop and re-read Constraint 4. If a later merge of master moves the minor, take the next number and regenerate.
4. **At each milestone's end:** `vmcheck 'pnpm typecheck'` and `vmcheck 'pnpm test'` (the whole unit suite). Expect no error beyond the VM's known failures. The controller then has the milestone reviewed and ticks Progress.
5. **M8:** `vmcheck 'pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'` and `vmcheck 'pnpm exec eslint e2e'`; `vmcheck 'node --test .github/scripts/maws-app-scan.test.mjs'` if any fixture or recorded file was added; then step 4 once more, and both audits of stale names print nothing: `grep -rn "parseAnchoredText\|data-destination\|sendComment\b" src e2e test` and `grep -rnE "radio.*(Side thread|Send to main)" src e2e test` (the radios are located by role as well as by attribute).
6. **The executor then stops and hands back** what exists and how it was verified, what is not verified, its decisions, and anything that contradicts this document. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the branch review, the e2e runs, the cross-build run and the pull request are the architect's ("Proof that an executor does not run").

## Interfaces and Dependencies

### §A. The text (`src/shared/anchor/message.ts`; M1)

```ts
export interface MessageComment { anchor: Anchor; text: string; screenshot: boolean }

/** The text of one message carrying `comments` (1 to 20), oldest first. */
export function commentsMessage(comments: readonly MessageComment[], destination: Destination): string;

/** Every comment of a message MAWS wrote, else null. */
export function readAnchoredMessage(text: string): { comments: { anchor: Anchor; text: string; screenshot: boolean }[]; destination: Destination | null } | null;
```

**Written, one comment.** `<lead>\n<the comment, trimmed>\n\n<tag>`, with a thread's preamble paragraph before the tag: `anchoredMessage`'s output to the byte, by calling it.

**Written, two to twenty comments.** A first line that names the count, a blank line, then one block a comment, a blank line between blocks, and the last line of the message still a tag:

```
2 comments, in the order made:

Comment on "<label 1>" (<where 1>):
<comment 1>

<maws_anchor …1/>

Comment on "<label 2>" (<where 2>):
<comment 2>

You are in a side thread forked from the main conversation to handle these comments. Address them here; the main conversation continues separately and is not waiting on you.

<maws_anchor …2/>
```

- **The framing line** is exactly `<N> comments, in the order made:` with N in decimal, 2 to 20. No single-comment writer ever opened a message with it: `anchoredMessage` opens with a lead, which begins `Comment`, and a promotion with its own head.
- **A block** is `anchorLead(anchor, screenshot)`, the comment trimmed, a blank line, `anchorTag(anchor)`, as in a message of one.
- **The escape.** Inside a framed message, every line of a comment that begins with `<maws_anchor` after zero or more backslashes is written with one more backslash in front. So the only lines of the message that begin with a bare `<maws_anchor` are the blocks' own tags, and no words of a person's can end a block. The reader takes one backslash off each such line, which gives the comment back exactly.
- **A thread's preamble** stands once, in the last block, between its comment and its tag, and for several comments it is its own constant, `SIDE_THREAD_PREAMBLE_MANY`, the sentence in the example above; a message to the main conversation has none. A person's last paragraph that is exactly the preamble is taken for it, the limit a message of one has today.
- The framing is plain words on purpose: the agent reads the line as what it says.

**Read.** `readAnchoredMessage` first tries the framed reading, and takes it only if all of this holds:
1. the first line is the framing line, with N from 2 to 20;
2. after it the message is exactly N blocks, each found by reading on to the next line that is an exact tag (`parseTag`, unchanged; an escaped line is not one);
3. each block's first non-blank line equals `anchorLead` of its own tag, with or without the screenshot sentence, which also gives that comment's `screenshot`;
4. nothing but blank lines follows the last tag.

Then each comment's text is what lies between its lead and its tag, unescaped and trimmed; in the last block the plural preamble, when it is the paragraph before the tag, is taken off and gives `destination: 'thread'`, else `'main'`.

**Otherwise the message is read as one comment, exactly as `parseAnchoredText` reads it today** (the last tag alone; lead and preamble stripped only on an exact match; `destination` null when neither matched). That covers every message a single-comment writer produced, whatever its words hold, so an older transcript draws unchanged. The case that forced the framing (Decision Log 13): one comment whose words are `A`, a blank line, its own tag, a blank line, its own lead and `B` is byte for byte the two blocks of two comments on that element; with no framing line it is one comment, as it always was.

**What build F's reader does with a framed message** (its `parseAnchoredText` is this file's, unchanged): the last line is a tag, so it reads that anchor; the first line is not a lead, so nothing is taken off the top. F draws one chip, the last comment's, and the framing line, the earlier blocks (lead, comment, tag), the last lead and, in a thread, the plural preamble as text in the bubble, with the destination unknown. Nothing is lost.

### §B. Commands

1. **`side.thread.open`** (`src/shared/ipc/schema/side.ts`; machine-owned, on the wire; M1). The `comment` member of `SideThreadFromSchema` gains one optional key:

   ```ts
   more: z.array(z.strictObject({ anchor: AnchorSchema, text: CommentTextSchema, screenshot: AnchorScreenshotSchema.nullable() })).min(1).max(19).optional()
   ```

   The first comment stays in `anchor`, `text` and `screenshot`. Absent, the input and the built message are today's to the byte. The lineage's `anchor` is the first comment's.
2. **`side.comment.content`** (new; M1). Owner `main`, grade `client` (`src/shared/ipc/grades/side.ts`), not main-only. A namespace may hold commands of both owners, as `library.saveAs` (main's) stands beside `library.content` (the machine's).

   ```ts
   input:  z.strictObject({ comments: z.array(z.strictObject({ anchor: AnchorSchema, text: CommentTextSchema, screenshot: AnchorScreenshotSchema.nullable() })).min(1).max(20) })
   output: z.strictObject({ content: z.array(ContentBlockSchema) })   // [image…, { type: 'text', text }]
   ```

   The text is `commentsMessage(comments, 'main')`; the images are the comments' screenshots in order, each read by `readScreenshotBlock(path, [userData])`. A refusal is `invalid_input` naming `comments.<i>.screenshot` and the reason, as `ScreenshotRefused` words it. The route test (`src/shared/ipc/routes.test.ts` and `routes.json`) must show it in the `client` class.
3. **`side.sendToMain`** is unchanged and has no caller in the window (R1).
4. **`browser.comment.card`** (new; M4). Owner `main`; `browser.*` is uniformly `client`.

   ```ts
   input:  z.strictObject({ tabId: BrowserTabIdSchema, open: z.strictObject({ css: z.string().min(1).max(2000) }).nullable() })
   output: z.void()
   ```

   Main forwards `{ type: 'card', open: boolean, css?: string }` on `COMMENT_CHANNEL.toPreload` to the tab's own page, and does nothing for a tab it does not hold or whose view is gone.

**Authorisation and what a remote caller can see.** `side.comment.content` and `browser.comment.card` are `client`: the router refuses a `client` command aimed at another machine before any handler, they are not on the link surface, and no endpoint offers them. `side.comment.content` opens one kind of path, the screenshot's, and checks it where it is opened, on the realpath it reads, against `<userData>` alone. The comment's words then cross to a session's machine only inside `session.send`, `session.steer` or `laneA.send`, each authorised by its own row at the grade `converse`, on the content it carries. `side.thread.open` with `more` is checked on the machine that runs it, as today: the same handler, the same roots, the same size bound on the built message. A member whose grade a machine refuses gets the send's own refusal, which the card shows.

### §C. The store and the host (`src/renderer/src/side/card/`; M2, M3)

```ts
// store.ts
export interface PassComment {
  id: string;                               // stable for the comment's life
  anchor: Anchor;                           // without its screenshot
  text: string;
  screenshot: AnchorScreenshot | null;
  rect: CardRect | null;                    // the pick's rect, for an anchored card
  flight: number | null;                    // the send it is part of, else null
  refused: { toMain: boolean; error: string } | null;
}
export interface CommentPass {
  host: CardHostKind;                       // 'browser' | 'artifact-page' | 'artifact'
  subject: string;
  appSessionId: AppSessionId;
  comments: PassComment[];                  // oldest first
  toMain: boolean;                          // the checkbox
}
export const passKey = (host: CardHostKind, subject: string, appSessionId: AppSessionId): string;

// useCommentCard's state gains:
//   passes: ReadonlyMap<string, CommentPass>
//   notes:  ReadonlyMap<string, PlaceNote>                         // the line a host draws in the card's place, by pass key
// OpenCard's composing phase gains { pass: string; comment: string } and loses `destination`.

export function setCommentText(pass: string, comment: string, text: string): void;
export function setPassToMain(pass: string, toMain: boolean): void;
export function removeScreenshot(pass: string, comment: string): void;
export function discardComment(pass: string, comment: string): void;        // Close, Remove, a blur with an empty field
export function editComment(pass: string, comment: string): void;           // the open card moves to it
export function leaveCard(serial?: number): void;                           // the card goes, every comment stays
export function dropSubject(host: CardHostKind, subject: string): void;     // the subject closed: its passes end
export function dropSession(appSessionId: AppSessionId): void;
export const SENT_NOTE_MS = 4_000;

export type PlaceNote =
  | { kind: 'sent'; text: string; at: number }                                    // a confirmed delivery: leaves after SENT_NOTE_MS
  | { kind: 'pending'; appSessionId: AppSessionId; key: DeliveryKey; title: string }; // follows the pending send under `key` (decision 8): never leaves by itself
```

`closeCard(serial)` keeps its name and its meaning for a thread-phase card; for a composing card the person's Close calls `discardComment` and everything else calls `leaveCard`. `openCard(anchor, context)` adds a comment to the pass of the placement's host (creating the pass with `toMain = context.destination === 'main'`) and opens the card on it. Where the host says `one` and its pass already holds a comment, it opens the card on that comment instead and adds nothing.

```ts
// CardHost.tsx
interface Props { hostId; host; mode; layout; accepts; frame; visible; restoreFocus?;   // as today
  subject: string }                                                                      // new, required

export interface CardFrame {
  scale; offset; key; locate?; showVersion?; actions?; onSending?;                       // as today
  holds?: 'one' | 'many';                 // absent means 'many'
  onClosed?(card: OpenCard): void;        // the host's card went, for whatever reason
  onDiscarded?(comment: PassComment): void; // the person dropped a comment (a document withdraws its thread)
}
```

`onSending(card, { text, destination })` keeps its shape and is called once per comment as a send sets out; the call it returns is told whether the send went. A document records its comment in the thread from it, as today.

**What the host draws,** in the card's place: the open card when it is this host's; else its `PlaceNote`: the sent line for `SENT_NOTE_MS`, or the pending line for as long as its pending send exists (§E); else, when a pass of `(host, subject)` holds comments, the chip, a button whose click opens the card on the newest comment. More than one pass for a subject (two receiving sessions) gives one chip with the total; its click opens the pass whose comment is newest.

| layout | the chip and the line sit |
|---|---|
| `docked` (the browser) | in the dock's strip under the page, one line high |
| `anchored`, kind `artifact-page` | the top right corner of the host's box |
| `anchored`, kind `artifact` | where the card would be: at the passage's rect |
| `margin` | in the margin's entry of that thread |

**The card's parts,** top to bottom, are the contract's seven. Part 3, the pass's other comments, is one line each: the anchor's label, the first words of the text, Remove; a click edits that comment. **Layout** (decision 23): parts 1 and 6, and under 6 the left-out line and part 7, never scroll; parts 3, 4 and 5 are one region between them (`[data-card-scroll]`) that shrinks and scrolls when the card meets the height its host allows; part 3 is at most three lines high (72 px) and scrolls within itself. Part 4 is not drawn on a route whose room for screenshots is 0 (decision 9). Part 7, a refused send, shows the reason with Retry and, when the refused send was unchecked and a tick can send, "Send to main instead".

**Markers the tests and e2e use:** `[data-comment-card]` (kept), `input[data-send-to-main]`, `[data-pass-comment="<id>"]` on a line of part 3, `[data-unsent-chip]`, `[data-sent-note]`, `[data-pending-note]`, `[data-card-scroll]`, `[data-card-dock]` (kept).

### §D. The send (`src/renderer/src/side/actions.ts`; M2, M3)

```ts
// composer/submit/send-human-prompt.ts (U4's file; the one field this landing adds), set by session/controls/lane-a.ts beside holdPendingSend
//   HumanPromptResult.pendingKey?: DeliveryKey   // only with disposition 'unconfirmed': the pending send that holds the words

export type SendOutcome =
  | { ok: true; to: 'main'; disposition: 'sent' | 'steered' | 'queued' }
  | { ok: true; to: 'main'; disposition: 'unconfirmed'; pending: DeliveryKey }   // handed to the bridge, fate unknown (decision 8)
  | { ok: true; to: 'thread'; child: AppSessionId }
  | { ok: false; error: string };

/** Sends `comments` (1 to 20, oldest first) to one destination. Replaces `sendComment`. */
export function sendComments(parent: AppSessionId, comments: readonly CommentInput[], toMain: boolean, options?: { reveal?: () => boolean }, client?: MawsBridge): Promise<SendOutcome>;

/** Sends every comment of the pass that has text, as one flight. */
export function sendPass(pass: string, client?: MawsBridge): Promise<void>;
```

`sendComments`, ticked: (1) the route's room for screenshots, `screenshotRoom(parent)` (`controls-for.ts`: `FILES_MAX` for a terminal session on this Mac, 0 for one on another machine, else unbounded), drops the screenshots past it; (2) `side.comment.content`; (3) for a terminal session on another machine, the text's length against 65,536; (4) `sendToSession(parent, content, { origin: 'comment' })`. A result of `refused` is `{ ok: false, error: reason ?? 'The comment was not sent' }`; `held` cannot occur for this origin and is treated as refused; `unconfirmed` is answered with the result's `pendingKey`, and with none it is the refusal "The session did not confirm the message"; a thrown error is refused with its message. Unchecked: `side.thread.open` with the first comment and `more`, then `adoptFork` with the message `commentsMessage(comments, 'thread')` as the thread's first message, then the reveal rule of today.

**A pass's send: the events, the states and what each does.** The state is the store's alone: `flight` on each comment, `refused` on each comment, the open card, the `sent` line.

| event | condition | what happens |
|---|---|---|
| Send (the button, Enter, ⌘Enter) | no comment of the pass is in flight, at least one has text, and the checkbox's state can send | the comments with text are marked with a new flight id; comments with no text are discarded; the send starts with the pass's `toMain` as it is now |
| Send | a flight is on its way, or nothing has text, or the state cannot send | nothing |
| the person types in, removes, or drops the screenshot of a comment in flight | | not offered: its field, its Remove and its screenshot's Remove are disabled, and Close on it leaves the card without discarding |
| the person opens another comment, edits a comment not in flight, changes the checkbox | during a flight | allowed; it changes nothing of the flight |
| the flight is answered **ok, to main**, confirmed (`sent`, `steered`, `queued`) | | its comments leave the pass; each host callback from `onSending` is told `true`; the place's note is the sent line; the card closes if it was on one of them; a pass left empty is removed |
| the flight is answered **ok, to main, `unconfirmed`** | | the same, except the note: the pending line under the answer's key, which stays while that pending send exists and becomes the sent line when the delivery under that key is `entered`. Nothing here sends the words again: Send again and Dismiss are the strip's, in the session's composer, which Show brings to the front |
| the flight is answered **ok, to a thread** | the open card is on one of its comments | the comments leave; the card becomes the thread (`enterThread`) |
| | no card is on them | the comments leave; the thread is revealed in the parent's Side pane (today's rule for a card that went) |
| the flight is **refused** | a card is open on one of its comments | `flight` is cleared, each comment gets `refused`, callbacks are told `false`; the card shows part 7 |
| | no card is open on them and a host of the pass is mounted | the same, and the host opens the card on the newest refused comment |
| | no host of the pass is mounted | the same, and a warning toast "The comment was not sent: <reason>" |
| the subject closes, or the session is removed | during a flight | the pass is dropped: its comments not in flight are discarded at once (a document withdraws their threads). The flight keeps its own comments, callbacks and holds (decisions 5 and 17) and settles as it would have: an ok tells each callback `true` (a document records the comment in its thread) and is otherwise silent, since the transcript has the message; a refusal tells each `false`, which withdraws a document's abandoned empty thread, and is the toast. Each callback runs once |
| the awaited call never answers | | the flight stays; the button reads "Sending…" or "Starting…"; Close leaves the card; nothing is retried. `sendToSession` and `side.thread.open` carry their own bounds and refusals (the link's hold, an acquisition's outcome), so the wait ends in the route's words |

Retry sends the pass again by the first row. "Send to main instead" sets the checkbox and sends.

### §E. Copy (`SIDE_COPY`, `src/renderer/src/side/copy.ts`)

| | words |
|---|---|
| the checkbox | `Send to main` |
| its title, ticking sends now | `Sent now` |
| its title during a turn | `SENDS_AT_NEXT_STEP` (the composer's own words) |
| its title when the send starts the session | `STARTS` (the composer's own words) |
| its title when it cannot be ticked | the port's reason (`capability('send')`), or `Held by <holder>` |
| its title when locked for a session on another machine | `A side thread is not available on <machine> yet` |
| unchecked cannot send: no conversation | `This session has no conversation to fork yet` |
| neither state can send | the reason as a line under the field; Send off |
| the button | `Send`; with more than one comment that has text, `Send <N> comments`; while sending, `Sending…` or `Starting…` as today |
| the chip | `1 unsent comment`, `<N> unsent comments` |
| a line of part 3, Remove | `Remove comment` (accessible name) |
| the sent line, for a confirmed delivery only | `Sent to <title>`; during a turn `Sent to <title>; read at the next step`; queued `Queued for <title>; it sends when the queue resumes` |
| the pending line (decision 8), by the pending send's state | `sending`: `Not confirmed yet in <title>`; `unconfirmed`: `May not have arrived in <title>`; `refused`: `Not entered in <title>: <reason>`. The words are `PENDING_SEND`'s (`composer/PendingSends.tsx`) with the session named. One action, `Show`, brings that session's tab to the front |
| an `unconfirmed` result with no `pendingKey` | `The session did not confirm the message` (a refused send) |
| screenshots left out (a line under the checkbox row) | `1 screenshot is left out: <reason>`, `<N> screenshots are left out: <reason>`; the reason is `A terminal session takes at most 4 images or PDFs in one message` or `Attachments to a session on another machine wait for uploads across machines` (`LANE_A_WORDS`) |
| too long for a remote terminal session | `Too long for a terminal session on another machine: send fewer comments at a time` |
| a side thread of several | title `<first label> and <N> more` |
| the fixed reply (M6) | `Edited this passage.` |

`<title>` is `displayTitle(record)` (`src/renderer/src/sessions/title.ts`). The disposition gives the line: `steered` is "read at the next step", `queued` is "Queued", `sent` is the plain one, and `unconfirmed` is never a sent line. `composer.thread`, `composer.destination`, `composer.threadCaption` and `composer.queued` (the toast) go.

### §F. What each surface supplies (M3)

| surface | host kind, layout | `subject` | `holds` | supplies beyond the props |
|---|---|---|---|---|
| a document, deck, design, dashboard (`tools/document/comments.tsx`) | `artifact`; `margin` or `anchored` | the artifact's id | `one` | `onSending` (record the comment in its thread), `onDiscarded` (withdraw the thread and its mark), `actions` (Resolve) |
| an HTML page (`ByteViewer.tsx`) | `artifact-page`, `anchored` | the artifact's id | `many` | nothing |
| a page in the in-app browser (`Pane.tsx`) | `browser`, `docked` | the tab's id | `many` | `onClosed` (M4) |
| a file viewer's line (`CodeView.tsx`) | the sheet | none | one, by being modal | nothing; the sheet keeps today's behaviour for its text |

A pass ends when its subject closes: `connectBrowserComment`'s subscription to `browser` calls `dropSubject('browser', tabId)` for a tab a change or a full list no longer holds (decision 22); an artifact's tab state disposed calls `dropSubject` for both artifact kinds; a session removed from the session store calls `dropSession`.

### §G. The page's subject (`src/preload/browser-comment.ts`; M4)

`ToPreload` gains `{ type: 'card'; open: boolean; css?: string }`. `PICK_GRACE_MS = 2_000`.

| event | what the page does |
|---|---|
| a pick (armed, or `pickAt`) | the picked element becomes the subject, `held` false; a timer of `PICK_GRACE_MS` starts |
| `card`, open, with `css` | the subject is the element the selector finds (the current subject kept when it is that element, so an area pick keeps its marquee), `held` true; the timer is cancelled. No element found: no subject |
| `card`, not open | no subject; the timer is cancelled |
| the timer fires | no subject, unless `held` |
| the viewport gets shorter | with a subject that showed, what showed is brought back into view (today's `reveal`); else nothing |
| the viewport gets taller | nothing but the bookkeeping of what shows |

The window sends `browser.comment.card` from the browser host's frame: `open` with the open comment's `anchor.css` when its card shows a composing comment or moves to another, and `null` from `onClosed`. A call that fails (the tab closed) is ignored. A message that never reaches the page costs at most the two seconds of the pick.

### §H. The transcript's row (M5; U3's files)

The `user` row (`transcript/model/rows.ts`) gains `comments?: { anchor: Anchor; text: string; attachment?: number }[]`, set only for a message of two or more comments, with `schema.ts` to match. `attachment` is the index, in the row's `attachments`, of that comment's screenshot, set by decision 13's pairing: when the row's image attachments are as many as the comments whose lead announces a screenshot, the k-th image is the k-th such comment's; otherwise no comment has one. Such a row has no `anchor` and no `anchorFrame`, `text` is the comments' texts joined by a blank line (what find and the fold measure), and `editable` is false. `User.tsx` draws each comment as its `AnchorChip`, its text and its image, and after the comments the attachments no comment claimed. `copiedUserText` gives each comment's lead and text, a blank line between. A row of one comment is today's row. *Pending the owner's look (decision 13): under B the field `attachment` and the pairing go, and every image is drawn after the comments.*

### §I. `artifact_edit` (M6)

`ArtifactEditInputSchema` gains `reply: z.string().min(1).max(2000).optional()`. The description gains one sentence, placed right after the `answering` sentence, exactly as probe P4 ran it:

    With answering, give reply: one or two sentences in your own words saying what you changed; it is posted as your reply in the thread.

The thread's message is `reply` when given, else `Edited this passage.`; `reply` without `answering` is ignored. The result the tool returns is unchanged. Charter X9 records the parameter by a dated line (M8).

### §J. What this landing stores and sends, and what build F does with it

| what | this build writes or sends | build F with it | this build with what F wrote | this build, then F, then this build |
|---|---|---|---|---|
| layout key `library.exportFolder`, `{ path }` | after each export that saved, by main | Does not name the key: loads it with the file and writes it back whole with its own keys. Its export dialog opens in Downloads at each launch, as F does | F never writes the key; with none, the fallback of decision 14 | The folder this build stored is still there and is used |
| the text of a comment in an engine transcript, one comment | byte-identical to F's | reads and draws it as its own | the same | unchanged |
| the text of a message of several comments | new: the framing line, then the blocks (§A) | `parseAnchoredText` takes the last tag: F draws one chip, the last comment's, and the framing line, the earlier blocks (lead, comment, tag) and the last lead as text in the bubble, with the destination unknown, so an Edit on F resends the text and that one tag. Nothing is lost; it reads untidily on F | F never writes one | unchanged |
| `side.thread.open` with `more`, to an engine host or daemon of build F on this Mac | only when the pass holds more than one comment | F's strict schema refuses the unknown key as `invalid_input`; the card shows it as a refused send and nothing is lost. The app restarts a daemon of another build at its build check, so this is a transient | — | — |
| the same, to a machine on F over the link | never: unchecked is locked for a session on another machine | — | — | — |
| `side.sendToMain` | never sent | F's window still sends it to a wave-build host, which answers as today (R1) | — | — |
| a ticked comment to a session on a machine on F | `session.send`, `session.steer` or `laneA.send`, commands F offers | Takes it as a typed message. The transcript there draws it by F's reader (one comment: as its own) | — | — |
| `artifact_edit` with `reply` | part of the tool's schema in a session this build's engine host serves | F's engine host does not advertise it, so an agent there does not send it; F posts the result lines as before. A thread message written by this build is plain text F draws | F's result-line messages stay as they were written | unchanged |
| a document thread kept for an unsent comment | an empty thread and its mark, kept while the comment is in the pass (decision 17), where master withdraws it once the host is gone | A thread with no message is drawn by F as F draws its own before a send, and F's count includes it, as F counts its own | — | A quit with an unsent comment leaves the empty thread in the document under either build; neither sweeps it (decision 17's limit) |
| both settings files | not touched | — | — | — |

The cross-build coverage table (U13a's M5 holds it) gains one row, `library.exportFolder`, and one scene: this build exports once into a scratch folder; F launches on the profile, changes any tab and quits; this build launches and its export dialog's default path is under the scratch folder (read from the `defaultPath` Electron's `dialog.showSaveDialog` is called with, replaced in the main process as `e2e/widgets.spec.ts` does; `MAWS_E2E_SAVE_PATH` stays unset, since it bypasses the calculation). The scene is skipped unless the peer's `LayoutKeySchema` lacks the key.

### §K. Dependencies on other landings

| landing | what this one consumes, by the name it is exposed under | until it lands |
|---|---|---|
| U8a (on master) | `workingFolder(record)` in `src/shared/sessions/working-folder.ts`, for the export folder's fallback | — |
| U3a | The transcript's model has one writer at a time (UC-3): M5's insertion in `user-text.ts`, `rows.ts`, `schema.ts`, `derive.ts`, `User.tsx` goes onto U3a's versions. X1's `arrival` field and `readArrivals` are not read by this landing | M5 does not start; M1 to M4, M6 and M7 do |
| U4a | One insertion in U4's `composer/submit/send-human-prompt.ts` (`pendingKey?` on `HumanPromptResult`, Constraint 6); U4a edits the same folder, and whoever merges second keeps both changes. Nothing else by name: the ticked send is `sendToSession`, and what a plain send does during a turn is U4's; the note is worded from the result's `disposition` | today's behaviour: a steer at the next step |
| U9 | `useRemoteUnavailable(appSessionId, 'side.thread.open')` (`src/renderer/src/lane-b/remote-unavailable.ts`, signature unchanged by U9). The offer for `side.thread.open` is U5b's insertion | the checkbox is ticked and locked for a session on another machine |
| U8b | Nothing. The card does not sit in the card column or in a side-column slot | — |
| U6a | Nothing: no action id is added (UC-6) | — |
| U13a | The cross-build coverage table and its spec `e2e/cross-build.spec.ts`, which M8 extends | if U13a's M5 is not on master at M8, the scene is written against master's spec and the row is handed to the architect to place |
| U12, U10 | none; they consume this landing ("What the siblings code against") | — |

## Probes

**P1 · several images in one message.** Done 2026-11-12 (`spikes/protocol-probe/findings-uxwave-u5-images.txt`, on master since the probes' pull request #602, which the first merge of Concrete Steps 1 brings in): engine 2.1.322 kept three images and a text whole and in order idle, as a steer at `next` and at `now`, and as a fork's first message. Nothing is left to settle; decision 9 follows from it. Two things it saw that this landing relies on or leaves alone: a steer's text is placed before its images by the engine, and a steer with images is stored as a queued-command attachment, which the transcript already reads.

**P7 · a terminal session takes the comment text.** The question: does `laneA.send` deliver a text of several lines, with blank lines and a `<maws_anchor …/>` line, intact, and how long may it be?

*Settled by reading the code and the engine bundle while this document was written* (the window's `session/controls/lane-a.ts`, `src/services/lane-a/driver.ts` and `deliveries.ts`, the sminos bridge 1.46.3, `~/claude-code-bundle/2.1.322/cli.pretty.js`, `src/endpoint/rl10/link.ts`):
- No hop trims the text, changes its newlines, escapes or strips a tag, or folds it as a paste. The bridge passes it as JSON; idle, it is submitted as the person's prompt with no wrapper; during a turn it is appended as a user row with the text verbatim.
- The stored row keeps the text in a form the reader parses: the last non-empty line is the tag.
- Length: no bound on this Mac but the bridge's 32 MiB body and the model's context. For a terminal session on another machine the endpoint refuses a text past 65,536 UTF-16 units (decision 10).
- A text that starts with `/` goes the command route; a comment's text starts with "Comment", so it never does.

*Left for a live run, handed to the architect* (it needs a terminal session with a live sminos bridge on engine 2.1.322, off the MacBook; one sitting of about half an hour). Send through `laneA.send` a message of two comment blocks **in §A's framing: the first line `2 comments, in the order made:`, and in one comment a line that begins `<maws_anchor`, which the writer sends as `\<maws_anchor…`** (what the framing adds to the first format is that one line of digits, letters, a comma and a colon, and a backslash at the start of such a line; a pass run with the first format settles everything but those two), with a blank line inside a comment, `&gt;` in a tag's attribute, one non-ASCII letter and one emoji, and compare the SHA-256 of what was sent with the text of the row on disk:
1. idle: the delivery reports `entered`; the row on disk equals what was sent; the transcript draws the chip;
2. during a turn (a `sleep 30` shell call): the appended row equals what was sent; ask the model to quote the last line, to see what it read;
3. after an Esc, then a send: the same checks as 2;
4. a text of about 70,000 characters, idle: `entered`, and the row whole;
5. on a second machine: 65,536 units accepted, 65,537 refused;
6. note which other mods with a prompt or session-append hook were loaded, since one could rewrite a text.

It should be recorded as `spikes/protocol-probe/findings-uxwave-u5-terminal-text.txt`. **If the tag does not arrive intact** in any state, the child's fallback applies and is one place: in `sendComments`, for a terminal session, the content's text is each comment's first line and words without the tag, and the transcript draws a plain message. M2 is built at "intact", which the reading supports; its review waits for the run.

## Acceptance

Each is checked as written. "Unit" names the milestone whose tests hold it; "e2e" the M8 scene the architect runs on a Mac.

- **A1** (the child's). Unit: M2 (the checkbox on the card and the sheet; unchecked each time; the three routes; locked for another machine). E2e: `side`, `document-standalone`, `browser-comment`.
- **A2.** Unit: M2 (the wordings for a confirmed delivery; the pending line and its two held sequences; the session line). E2e: `document` and `browser-comment`. The terminal route and the route to another machine are held by unit tests over the port with stubbed `laneA.*` and remote sends, and by P7's run; an e2e of a live terminal session is not part of this landing.
- **A3.** Unit: M7, for each of the four kinds. E2e: `document`.
- **A4.** Unit: M1 (the framing and its regression test), M3 (the pass) and M5 (the bubble). E2e: `browser-comment` whole, with the page that does not move when the line leaves and the window at its smallest height; `deliverables` for an HTML page.
- **A5.** Unit: M4's test, red on today's code. E2e: none needed; the existing strip scenes of `browser-comment` must stay green.
- **A17.** Unit: M7. E2e: `document-narrow`.
- **A18.** Unit: M6. E2e: `cross-build` for the folder across builds; the export scenes (`presentations-export`, `design-export`, `dashboard-export`) must stay green.
- **Unchanged on purpose:** a message of one comment, to the byte (M1); every `keep` the card touches, namely the picked element staying in view while the strip is open (M4) and the one-draft rule of documents (M3).
- **The whole unit suite** passes on the VM at the branch's head, and `pnpm typecheck` with it (Concrete Steps 4).

## Proof that an executor does not run

Each line has an owner other than an executor.

| what | when it can start | what it needs | what comes back |
|---|---|---|---|
| **The adversarial review of this document** | now | the architect's dispatch | findings; this document revised on the rulings |
| **The rulings on R1 to R6** | done 2026-11-12 | — | every default stands (Decision Log 2 to 7) |
| **P7's live run** | now; before M2's review | "Probes": a terminal session with a live bridge on engine 2.1.322, off the MacBook, and a second machine for step 5 | the findings file and the verdict "intact" or the fallback |
| **The owner's look at the drawn example** | drawn 2026-11-12; before M5 is built | the page `~/.local/share/maws-ux-wave/examples/u5-comments/index.html` (outside the repository; six frames, invented content) with its one question: where the screenshots sit in a message of several comments | the owner's word: A stands, or B changes decision 13, §H and M5's tests only |
| **The e2e scenes** on a Mac under the load rule | after M8 is pushed | the new and reworked scenes alone first (`browser-comment`'s pass scene, `deliverables`' pass scene, `side`'s and `code-editor`'s checkbox scenes, `document`'s count and note, `document-narrow`'s fold, the reworked count scenes of `presentations-comments` and `design-comments`); then the groups that hold `code-editor` (`e2e:code`), `side`, `browser-comment`, `deliverables`, `document*`, `library`, `presentations-comments`, `design-comments`, `dashboard-comments`, and `p1-live` where the live group is run | verdicts by scene and group; a red scene comes back as a fix |
| **The cross-build run with F** | after M8 is pushed and U13a's M5 is on master | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer f1852de3a --label u5a-xb`, in the background | the run's id and the `library.exportFolder` scene named as run and green; skipped is not evidence |
| **An input method in the card** | with the e2e sitting | a person typing a composition in the browser's card, pressing Escape during it and after it | the composition's Escape is the input method's; the card's Escape keeps the text |
| **The branch review** | after M8 | `doperpowers:review-code`, the xhigh panel, over `origin/master...ux-wave/U5a` | a verdict and findings; the fixes are one wave through the controller |
| **Class 1a** | once, on the head the pull request will carry, after the review's fixes | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u5a`, in the background | the run's id |

## The pull request

Opened on the architect's word, not by an executor. Its body opens with the composite's path, the child id (U5, first pull request) and the parent pin, names the items (O-45, l6-artifacts-05, l6-artifacts-19, l6-artifacts-20 with X-105, l9-browser-delivery-05, X-218, X-216) and the board ticket #589. It names its class 1a run by id, the branch review's verdict and what was done with each finding, the cross-build run by id, which e2e scenes and groups ran and where, P7's verdict, and its residue: what is not verified, `side.sendToMain` left on the wire (R1), the empty thread a quit leaves (decision 17), the limits of §J, and anything logged as debt. **Debt rows it files in `docs/tech-debt-tracker.md`:** (1) `side.sendToMain` is registered and uncalled; remove the command, its handler, its `REMOTE_UNAVAILABLE` row, its grade and their tests at the next wire major (R1). (2) A quit or a crash with an unsent comment on a document leaves its empty thread and mark; nothing sweeps it (decision 17). (3) Build F draws a message of several comments as one chip and text (§J); it ends when F is no longer a build to go back to. (4) `SIDE_THREAD_PREAMBLE`'s words say "this one comment"; a thread of several uses a second constant, and both are persisted texts the reader matches exactly. It carries the dated amendments of M8's record. It closes tracker row 222's browser half (X-218) and the rows of X-216 and X-105. It ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution.

## Surprises & Discoveries

- Observation: `side.sendToMain` cannot be retired in this landing. It is machine-owned, so it is in the wire manifest, and a removed command is a breaking change that needs a wire major.
  Evidence: `src/shared/ipc/wire.ts`, `classifyWireChange`: `else if (now === undefined) change.breaking.push(name)`; `wire.test.ts`, "fails a breaking change in every mode". R1.
- Observation: a ticked send through `sendToSession` cannot build its content on the session's machine, because the screenshot is a file of this Mac; and no existing command builds it here without a session's address.
  Evidence: `src/main/browser/comment/crop.ts` writes under `<userData>/browser/crops/`; `side.screenshot.preview` is in `REMOTE_UNAVAILABLE`. Decision 2.
- Observation: a terminal session on another machine takes a text of at most 65,536 UTF-16 units and no attachments.
  Evidence: `src/endpoint/rl10/link.ts`, `SEND_TEXT_MAX = 65_536`; `session/controls/lane-a.ts`, `REMOTE_GAPS.media`. Decisions 9 and 10.
- Observation: the files under `src/artifacts/` and `src/main/browser/` that three items need are owned by U10 and U12 in the root's UC-8 table, though the child's file lists them as unowned or as U5's.
  Evidence: root, UC-8, the rows of U10 and U12. R2, R3, R4.
- Observation: build F reads a message of several comments as one comment, the last, and shows the earlier blocks as text.
  Evidence: `git show f1852de3a:src/shared/anchor/message.ts`, `parseAnchoredText` (identical to master's). §J.

- Observation: leads and tags alone cannot tell two comments from one. Two comments on one element are byte for byte one older comment whose words hold that element's tag, a blank line and its lead (the adversarial review computed it).
  Evidence: `anchoredMessage` writes `<lead>\n<text>\n\n<tag>`; with text `A\n\n<tag>\n\n<lead>\nB` the result equals the two blocks. §A's framing line; Decision Log 13.
- Observation: a document's thread is empty while its comment is being sent, so a withdrawal at the tab's close would delete a thread the agent is about to be told of.
  Evidence: `onSending` in `tools/document/comments.tsx` records the message only when its settlement is told `true`; today the overlay holds the replica until then. Decision 17; Decision Log 14.
- Observation: a terminal send can end `unconfirmed` with no evidence of receipt, and its recovery is drawn only inside that session's composer.
  Evidence: `src/services/lane-a/deliveries.ts` (three failed posts make a send `unconfirmed`); `composer/PendingSends.tsx`. Decision 8; Decision Log 15.
- Observation: in the drawn example a card of one comment is 190 px high and the second comment of a pass 270 px, against a dock that allows at most 320 px and about 224 px in the smallest window.
  Evidence: measured in `examples/u5-comments/index.html` at the app's own sizes; `stripCard` and `DOCK_MAX` in `src/artifacts/comments/placement.ts`; `minHeight: 600` in `src/main/window.ts`. Decision 23.
- Observation: the end of a browser tab can be read without an edit in the browser's store.
  Evidence: `browser` is exported from `tools/browser/store.ts` as a plain store; `App.tsx` mounts `connectBrowserComment` once. Decision 22.

## Decision Log

1. **2026-11-12 (the author, at writing): the verification call.**
   - This document gets an adversarial review before any executor starts; the architect dispatches it.
   - Each milestone is reviewed at its boundary by the controller's reviewer before the next starts.
   - The branch gets `doperpowers:review-code` at the **xhigh panel**. It is panel-size, and it holds parts that each want a lens: a persisted text format and its reader (M1, M5), a new path that opens a file for a window's request (`side.comment.content`), a wire addition met by build F (§B.1, §J), and an asynchronous send over a store that outlives its components (§D). Expected size, as revised under entries 2 to 21: about **82 files** and about **6,200 changed lines**, a little under half of them tests; by milestone, M1 about 16 files, M2 16, M3 19, M4 9, M5 8, M6 9, M7 10, M8 17 (twelve of them e2e specs).
   - A new or reworked e2e scene runs alone on a Mac before the groups. The cross-build run with F as the peer is the proof UC-14 asks for and is the architect's to run.
   - Class 1a on GitHub Actions is the gate of record, on the head the pull request carries.
   - The pull request's body names its class 1a run, its review verdict and its residue, and carries the dated amendments of the rulings this landing reverses (O-45 in the charter's X10; l6-artifacts-20 in the two P4 WR documents).

**2026-11-12, the one revision after the adversarial review** (needs attention; five findings, all accepted) **and the architect's rulings.** Each entry: what was decided, why, and what was rejected.

2. **R1 (the architect's ruling): `side.sendToMain` stays registered and uncalled.** Removing a machine-owned command is a breaking change of the wire and ends the link to a machine on build F. Rejected: retiring it in this landing, as the child's file says. A debt row.
3. **R2 (ruling): the count rule and the one `flash` under `src/artifacts/` are named insertions by this landing, reviewed by U10.** Rejected: waiting for U10 to make them, which would split one item across two landings.
4. **R3 (ruling): one handler and one forward in `src/main/browser/comment/`, reviewed by U12.** Rejected: guessing the card's state in the page, which is the defect X-216 removes.
5. **R4 (ruling): `reply` passes through `src/engine-host/tool-server/documents.ts` as a named insertion.** Rejected: none; the parameter cannot reach the plan another way.
6. **R5 (ruling): M5 starts only on a master that holds U3a.** Rejected: writing the row against today's files and rebasing it over U3a's edits of the same five files.
7. **R6 (ruling): `artifact_edit`'s description changes exactly as probe P4 ran it.** Rejected: rewording the older "posts the result" sentence, which no probe has run.
8. **The empty thread a quit leaves is accepted as debt** (ruling; the review agrees it is inside UC-5's drafts that live in memory). Rejected: a sweep at launch, which cannot tell an abandoned thread from another member's comment being written.
9. **The drawing's question 1 goes to the owner; A is written as the decision** (decision 13, §H, M5): each screenshot under its own comment by the reader's per-comment `screenshot`, together when the counts differ. The reason first written for "together" was wrong. Rejected for now: B, which stays one named change if the owner chooses it.
10. **The drawing's question 2 is the architect's: the left-out line reads the count, then the sentence the composer already uses for that session** (decision 9, §E). Rejected: shorter words of its own, which would be a second sentence for one fact.
11. **On a route whose room for screenshots is 0 the card shows no thumbnail and no "Remove screenshot"; the left-out line sits under the checkbox row** (decision 9, §C). Rejected: the thumbnail beside a line saying it is left out, as the first text implied.
12. **The card keeps its checkbox row in view at every height the dock allows; the list of others is at most three lines and scrolls within itself** (decision 23, §C; a structure test in M3 and a scene at the smallest window in M8). Rejected: the whole card scrolling, as today. **And M8's browser scene asserts the page does not move when the sent line leaves** (the drawing's fourth point). Rejected: leaving it to the unit test of the page-side script alone.
13. **Review, finding 1: a message of several comments carries an explicit framing line and an escape** (decision 24, §A, M1's regression test). Rejected: the lead-and-tag test first written, which read one old comment as two; a count of lines in each block's lead, which the agent would read as noise; an encoding of the comments, which the agent could not read plainly.
14. **Review, finding 2: a flight keeps its thread, its replica hold and its settlement callbacks independently of the pass** (decisions 5 and 17, §D, a document-backed test in M3). Rejected: withdrawing every thread of the pass at the tab's close.
15. **Review, finding 3: "Sent to" is said only for a confirmed delivery; an unconfirmed hand-off has its own line, stays, and leads to the pending send's own recovery** (decision 8, §C, §D, §E, two held sequences in M2). Rejected: reading `unconfirmed` as sent; keeping the comments in the pass, which would make the card's Send a second, unkeyed authority for the same words.
16. **Review, finding 4: M8 gains `e2e/code-editor.spec.ts`, `presentations-comments.spec.ts` and `design-comments.spec.ts`; the count scenes send a real comment; the stale-name audit covers radios located by role.** Rejected: changing M7's rule so that a reopened empty thread counts.
17. **Review, finding 5: the end of a browser tab is read by a subscription in `tools/browser/comment/connect.ts`** (decision 22; a test for a removal while no pane is mounted). Rejected: a call in the browser store's `setSessions`, a file of U12's that Constraint 6 does not name.
18. **Review: the cross-build scene reads the export dialog's `defaultPath` from a replaced `dialog.showSaveDialog`** (§J, M8). Rejected: `MAWS_E2E_SAVE_PATH`, which bypasses the calculation the scene is for.
19. **A thread of several comments has its own preamble constant, in the plural** (§A). The author's, at this revision: the framing made a second constant free of cost, and "this one comment" over several is wrong for the agent. Rejected: one preamble for both.
20. **Self-review after the revision:** every place the entries above name was re-read against the others (decisions 5, 8, 9, 13, 17, 22 to 24; M1, M2, M3, M5, M8; §A, §C to §F, §H, §J; Probes; Acceptance; the proof table; the pull request's debt rows). Nothing else changed.
21. **2026-11-12, the architect's amendment: the pending line finds its pending send by key.** `HumanPromptResult` gains one optional field, `pendingKey`, carried only by an `unconfirmed` outcome and set by the terminal port from the key it gives `holdPendingSend` (decision 8, §D, Constraint 6: an insertion in U4's `composer/submit/send-human-prompt.ts`, with U4's review). Rejected: finding the pending send by its text, as entry 15's first wording had it, to avoid an edit in U4's file: two pending sends of the same text would make the line follow, and Show reveal, the wrong one, and the key is the one authority for recovery.
22. **2026-11-12, the controller, before M1: the refresh.** Master merged (`62ceb75d7`, the probes' pull request; `WIRE_MINOR` there is 36, so M1 takes 37). The parent is re-pinned to `510a6d15e` (branch `ux-wave-spec`): its one commit since `e0df32e3f` writes into the child's file the owner's answers this document was already written at (A15 and A16 not built; A18's folder remembered; "Merges after" U3 and U9), and changes nothing this landing builds. The interfaces consumed were re-read on the merged base: `workingFolder(record)`, `useRemoteUnavailable(appSessionId, ...commands)`, `sendToSession` (in `session/controls/controls-for.ts`) and `HumanPromptResult` (in `composer/submit/send-human-prompt.ts`) stand as named; no file under the paths this landing edits moved since `7e5f2016c`. U3a is not on master, so M5 waits (R5).
23. **2026-11-12, the controller, on P7's result: "intact" stands, and three facts of the run checked against the code.** The fallback in `sendComments` is not built. (1) The stored row's form follows the session's state: idle and long texts are a prompt row (string content, origin `{kind: 'plugin', name: 'sminos', asUser: true}`); during a turn and after an Esc an `isMeta` row of one text block, origin plugin `sminos` without `asUser`. Both reach `userTextOf` through `derive.ts`'s `userRow` (the busy form is drawn as a steer, the after-Esc form as the wake turn's prompt: `derive.test.ts`, "a sminos delivery into a running turn, from disk" and "… while no turn runs"), so the chip is drawn for both today, and M5's reader change covers both by the same path. M5's tests include both forms, with rows shaped as P7's `.rows.jsonl`. (2) The bridge's `system`/`informational` row `sminos: delivered: <text, newlines as spaces>` is not drawn: `isMirrorLine` in `src/renderer/src/lane-a/source/bridge-rows.ts` drops `<plugin>: steer: ` and `<plugin>: delivered: ` lines, and `derive.test.ts` asserts no row holds "sminos: delivered", so a person does not see the comment's text twice. (3) After an Esc the fate still reads `submitted`, `entered` though the bridge appended the text rather than submitting it; M2's fate handling keys only on `entered` under the result's `pendingKey`, so an appended delivery turns the pending line into "Sent to <title>" as a submitted one does. The wake row that follows (origin peer, "sminos bridge") holds none of the comment and is not a comment's row.


## Outcomes & Retrospective

Pending — written at finish.
