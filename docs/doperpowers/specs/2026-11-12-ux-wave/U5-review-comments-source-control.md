# U5 · Review, comments and source control

> **A child of the UX wave.** Root: `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`. Read it first: it holds the wave's purpose, its laws (law 1 to law 8), the contracts UC-1 to UC-15, the ordering and the record. This file is this child's section of that document. Where this file and a contract's statement in the root differ, the root binds; report the difference. **Grain:** plan. Items are named by their ids in the register, `docs/doperpowers/evidence/ux-wave-2026-11/register.md`.

- **Purpose:** After this child lands the owner reads an agent's whole change in one scroll, comments on any line of it, and sends those comments together to the session that made the change. A comment anywhere (a passage of a document, an element of an HTML page, a line of a diff, an element of a page in the in-app browser) is written in the same small card, with one checkbox for where it goes, and typed text is no longer lost when the card goes away. A comment can be sent for a terminal session and for a session on another machine, where today it cannot be sent at all. New files are counted, "This branch" means the same thing for every session, and Review comes back to the place the owner left. Staging and discarding a file happen where the diff is read. Commit, Push and Create PR are one click that asks the agent to do it, with the forms kept, smaller, for doing it by hand.

- **Acceptance:**
  - **A1** (O-45; UC-5). On a document's passage, an element of an HTML page, and an element of a page in the in-app browser, the comment card shows one checkbox, "Send to main", unchecked, and no two-segment control; the sheet a file viewer's line opens shows the same. Unchecked, Send opens a side thread and the card becomes that thread. The next card starts unchecked again, whatever the last one sent. Routes: for a session MAWS runs both states work; for a terminal session unchecked works and ticked works while its bridge is live; for a session on another machine the checkbox is ticked and locked, its title saying side threads are not available there yet, until U9's fork works there.
  - **A2** (l6-artifacts-05; UC-5). Ticked, Send puts the comment in the receiving session's transcript and the card's place reads "Sent to <session title>" for about four seconds; during a turn the note says the comment is read at the agent's next step. Holds on all three routes. When the receiving session is not the one the main area shows, the card names it ("Session: <title>") before anything is sent.
  - **A3** (l6-artifacts-05). A document's comment count does not move when a comment card opens and is closed unsent; it rises by one when the comment is sent.
  - **A4** (X-218, l9-browser-delivery-05; UC-5). On a browser page: type a comment and press Escape, and the text is still in the card; pick a second element, and the first comment is a line in the new card and Send reads "Send 2 comments"; switch the side surface away and back, and a chip under the page reads "2 unsent comments" and reopens the card with its text. Send delivers one message: the receiving session's transcript shows one message holding both comments in the order made, each with its element's chip, and the agent runs one turn. The same pass on an HTML page behaves the same.
  - **A5** (X-216). With a comment card open on a browser page, make the window shorter, close the card, and make the window shorter again: the page does not scroll. A unit test of the page-side script fails on today's code and passes after.
  - **A6** (l5-code-01; UC-5). In Review, pointing at a line of a diff shows an add-comment button; a click opens the card under that line with "Send to main" ticked. Send puts the comment in the session's transcript with a chip naming the file and line and the commented line quoted; a comment on a removed line says "before the change". Comments on two lines go as one message ("Send 2 comments"). Unticked, the side thread opens in the Side pane. Holds for a session MAWS runs, a terminal session, and a session on another machine (ticked only, as A1).
  - **A7** (l5-code-05). Review shows every changed file of the scope in one scroll. Each file has a header that stays at the top of the scroller while its diff is under it, carrying the path, a kind badge, the counts, Viewed, "Open file ↗" and a menu. A click on the header folds the file; "Collapse all" folds every file into a list of headers. Marking a file Viewed folds it. A binary file reads "Binary file" and is never an empty body; a pure rename is a header reading "old → new". A diff opened as a main tab shows the same stack.
  - **A8** (l5-code-05). In a scope of 200 changed files, only the files within about two screens of the scroll position hold a drawn diff (a test counts them), and scrolling to the last file does not freeze the window. A scope over 8 MiB opens with every file folded, and unfolding one loads it.
  - **A9** (l5-code-15, a `keep`). "Showing hunk n of m" counts across the files of the stack and its ↑ and ↓ cross from one file to the next. The turn's Undo in the work divider's menu is untouched.
  - **A10** (X-072). Scroll into the middle of the third file, show another side surface and return, then resize the window: Review shows the same file at the same line. A regression test (late highlighting, a resize, a zoom change) fails on today's code and passes after.
  - **A11** (l5-code-03). For a session in the main checkout on a feature branch, the "This branch" chip is enabled; its list includes a committed change, an uncommitted edit and a new file; the footer reads "<branch> · Since origin/<default branch>". For a session in a worktree the base is the same default branch, not whatever the main checkout has checked out. The same holds for a session on another machine (read there).
  - **A12** (l5-code-04). A new file of twelve lines the agent wrote shows "+12" beside its "Untracked" badge on its header, is in the header's totals, and is listed under "This branch".
  - **A13** (l5-code-12). In Last turn the paths are relative to the repository like every other scope's. At the narrowest side column the kind badge is whole and the path is what shortens. The "Last turn" chip is always listed: off, with a reason, before any turn has changed a file. With a remote that is not on GitHub, the Environment card shows no pull request line and no raw `gh` error.
  - **A14** (l5-code-06). A file's menu in Review offers Stage, Unstage and "Discard changes…" as git's status allows; Discard asks for the acknowledgement it asks today; a staged file's header carries a "Staged" badge. Source control shows no file list and no diff. Holds on another machine at the grade the machine requires, refused in words below it.
  - **A15** (l5-code-02). Source control shows Commit, Push and Create PR. Each sends the session one sentence (the exact strings are in the item) that appears in the transcript as the person's message; none of them runs git in MAWS. While the session is working all three are off, with the reason as their title. The Environment card shows the one next step (Commit, then Push, then Create PR) as a button. Holds for a session MAWS runs, a terminal session and a session on another machine.
  - **A16** (l5-code-02). Under "By hand" in Source control: with nothing staged, Commit commits every change instead of stopping at "Nothing staged"; "Open PR…" on a branch that is not pushed pushes first and then creates; the exact command sits behind a disclosure.
  - **A17** (l6-artifacts-19). After the agent answers a document comment with an edit, the commented passage is tinted once and fades; nothing else on the page moves or flashes. In a document body under 720 px the card, which floats over the text there, folds to the passage's mark when the answer arrives; in a wider body the card stays in the margin.
  - **A18** (l6-artifacts-20, X-105). The agent's reply in a comment thread reads in the agent's words, in the card, in the margin and in the Word export; no line such as "replaced 1 occurrence(s) in ^…" appears there. After a relaunch the export dialog opens in the folder of the last export (this last sentence only if the owner confirms it: the same day's `keep` on "Export always starts in Downloads" is the register's question `export-folder`).
  - **A19** (UC-4). No file under `src/renderer/src/tools/code/review/` or `src/renderer/src/tools/scm/` reads `record.worktree?.path ?? record.directory` (a lint rule or a test holds it); once U8's live signal lands, Review and Source control show the folder the agent moved into.

- **Edges:**
  - **Blocked by:** `registry-app` on master (UC-10); U8's first pull request, the working folder's selector with today's behaviour (UC-4).
  - **Rebases onto:** U3's landing, for the transcript row of a message that carries several comments (UC-3; see "Contracts"); U8's trim of the Environment card (l5-code-16), for the next-step button; U9's fork for a session on another machine, which unlocks the unchecked state there (UC-7).
  - **Blocks:** U10 and U12, which code their card hosts against UC-5; U14's fix for O-46, which builds on the card's session line.
  - **Two pull requests.** The comment card and its sends (UC-5; O-45, l6-artifacts-05, -19, -20, l9-browser-delivery-05, X-216, X-218) come first, because two other children code against them. Review and source control follow (l5-code-05, X-072, -03, -04, -12, -01, -06, -02).
  - **Outside conditions:** probes P1 and P7 before the comment sends are built, P2 before the stack is built; the owner's look at the stacked Review on a real change before the second pull request lands, since it replaces a surface the owner uses daily.

- **Contracts:**

  **UC-5 · One comment card (owned).** The content, written once.

  *Names.* The seam every surface calls stays `openCommentComposer(anchor, context)` (`src/renderer/src/tools/code/anchor/anchor.ts`). The card, its host and its store stay `CommentCard`, `CommentCardHost` and `useCommentCard` (`src/renderer/src/side/card/`); the form stays `useCommentForm` and `CommentFormParts` (`src/renderer/src/side/`). The text an agent receives is written and read in `src/shared/anchor/message.ts`. New names: the *pass* (below), kept in the card's store; `sendComments`, which replaces `sendComment` in `src/renderer/src/side/actions.ts`.

  *Shapes.*

  ```ts
  // what a surface passes when a comment starts (two additions)
  interface CommentContext {
    appSessionId: AppSessionId;        // the session that receives the comment
    placement?: CommentPlacement;      // card hosts 'artifact' | 'artifact-page' | 'browser' | 'review' (new); a document's margin; the sheet
    destination?: 'thread' | 'main';   // what the checkbox starts on; absent means 'thread'
    quote?: string;                    // new: the commented text when the anchor cannot carry it (Review: the diff line); one line, at most 400 characters
  }

  // one unsent comment
  interface PassComment { id: string; anchor: Anchor; quote: string | null; text: string; screenshot: AnchorScreenshot | null }

  // the pass: every unsent comment one surface holds for one receiving session, oldest first
  interface CommentPass { host: CardHostKind; subject: string; appSessionId: AppSessionId; comments: PassComment[]; toMain: boolean }

  // a host's frame, as today, plus:
  interface CardFrame {
    holds?: 'one' | 'many';            // absent means 'many'; an editor that keeps one unsent comment says 'one'
    onClosed?(card: OpenCard): void;   // the host's card went, for whatever reason
  }
  ```

  `subject` is what the host shows: an artifact's id, a browser tab's id, a session's Review. `CommentCardHost` gains a fourth layout, `inline` (the card in flow in a row the surface gives it), beside `anchored`, `docked` and `margin`.

  *The card's parts,* top to bottom: (1) a header with the anchor's label, the host's own actions (a document's Resolve) and Close; (2) "Session: <title>", only when the receiving session is not the one the main area shows; (3) the pass's other comments, one line each (label, first words, Remove; a click edits that one and moves the card to it), only when there are any; (4) the surface's screenshot as a thumbnail with Remove; (5) the field, one to six lines; (6) one row with the checkbox "Send to main" and the button "Send", which reads "Send N comments" when the pass holds more than one; (7) a refused send's reason with Retry and, where it applies, "Send to main instead".

  *The draft model.*
  1. One card is open per window. It edits one comment of one pass.
  2. Only the person drops typed text: Close on the card discards that comment; a card whose field is empty is discarded when the keyboard leaves it; Remove on a line discards that line's comment. Everything else that takes the card away keeps the comment in its pass: Escape (the card stays and the keyboard goes back to the surface), another comment being opened, the surface being hidden or drawn again, the side column showing another session.
  3. A pass that holds comments while no card is open shows a chip in its host, "1 unsent comment" or "N unsent comments"; a click opens the card on the newest.
  4. Opening a comment while the pass holds others adds to the pass where the host says `many`. Where it says `one`, the surface returns the person to the unsent comment instead, as documents, decks and designs do today.
  5. Send sends every comment of the pass that has text, oldest first, as one message, to one destination: the checkbox's. The pass then ends; the next one starts with the checkbox at its surface's default.
  6. A pass lives in the window's memory until its subject closes (the browser tab, the artifact's view, the session). It is not kept across a relaunch. A document's tab asks before it closes over an unsent comment, as today.

  *The checkbox.* Label "Send to main". Its title says what a tick does now: "Sent now", or the composer's own words for a message sent during a turn, or why it cannot be ticked. It is not remembered between passes.

  | surface | starts |
  |---|---|
  | a document, deck, design or dashboard; an HTML page; a page in the in-app browser; a file viewer's line (the sheet) | unchecked |
  | a line of a diff in Review | ticked |
  | a session started blank for the comment (it has no conversation a side thread could fork) | ticked |

  | receiving session | unchecked: a side thread | ticked: the main conversation |
  |---|---|---|
  | a session MAWS runs | a fork of the session answers; allowed while a turn runs | the composer's own send: at once when idle, at the agent's next step during a turn; a session that is not running is started first |
  | a terminal session | a fork of its conversation, run by MAWS | through the bridge, as a typed message; when no bridge drives the terminal the checkbox is off, "Held by …" |
  | a session on another machine | not available until U9's fork works there (UC-7): the checkbox is ticked and locked, the reason as its title | the same send the composer uses for that session |
  | archived, or no conversation yet | off, with today's reason | off, with today's reason |

  When neither state can send, Send is off and the reason is a line in the card.

  *How a comment is sent.* Ticked, the message goes through `sendToSession(appSessionId, content, {origin: 'comment'})` (`src/renderer/src/session/controls/controls-for.ts`), the one path for a person's words from outside the composer; it is what makes the tick work on all three routes, and it follows whatever U4 decides a plain Enter does during a turn. Main still builds the message's content on this Mac, because that is where a screenshot's file is and where its path is checked (`src/services/side/content.ts`, `screenshot.ts`). The command `side.sendToMain` is retired with its row in `src/shared/ipc/remote-unavailable.ts`. Unchecked, `side.thread.open` takes the pass's comments (one to twenty) where it takes one today; the thread is named for its first comment, "and N more".

  *What a sent comment says.* One comment is today's text, to the byte:

  ```
  Comment on "<label>" (<where>):
  <the comment>

  <maws_anchor …/>
  ```

  A side thread's preamble paragraph stands before the tag, as today. A comment with a `quote` carries it fenced between the first line and the comment. Several comments are that block repeated, one blank line between blocks, the preamble once, in the last block. Screenshots travel as image blocks before the text, in the comments' order. The reader that replaces `parseAnchoredText` returns every comment of a message (`{comments: {anchor, text}[], destination}`); a line that is exactly a valid tag ends a block; a message of one comment reads as before, so older transcripts draw unchanged. The transcript draws a message of several comments as one bubble, each comment under its own chip.

  *After a send.* To the main conversation: the card's place shows one line for about four seconds, then nothing: "Sent to <title>"; during a turn "Sent to <title>; read at the next step"; when the app's queue holds it "Queued for <title>; it sends when the queue resumes". The line is drawn by the card's host, not as a toast, because a toast over the in-app browser freezes the page. To a side thread: the card becomes the thread, as today; in Review, whose card sits inside the diff, the thread opens in the Side pane instead.

  *What each surface supplies, and gets back.*

  | surface | anchor (X10) | host, layout | holds | the chip sits | gets back |
  |---|---|---|---|---|---|
  | document, deck, design, dashboard | `artifact-comment`: the artifact, the thread, the quoted passage | `artifact`; `margin` in a wide document, else `anchored` | one | where the card would be | `onSending` and its settle, to record the comment in the artifact's thread (today's) |
  | HTML page | `artifact-element`: the page's address and the element | `artifact-page`, `anchored` | many | the page's top right corner | nothing more |
  | page in the in-app browser | `browser-element`: the page's address, the element, its box; a cropped screenshot | `browser`, `docked` under the page | many | the strip under the page | `onClosed`, to tell the page its card went (X-216) |
  | line of a diff in Review | `file-line`: the absolute path and the line; `side: 'old'` for a removed line; the line's text as `quote` | `review`, `inline` under the line | many | Review's toolbar | the pass, to draw each unsent comment under its line |
  | file viewer's line | `file-line` | the sheet | one | none (the sheet is modal) | nothing more |

  **UC-4 (consumed).** Review (`ReviewTool.tsx`) and Source control (`ScmTool.tsx`) take the session's folder from U8's selector. The folder is part of the key of Review's body, its viewed marks and its scroll anchor, so a change of folder starts those again for the new folder; unsent Review comments belong to the session and stay.

  **UC-7 (consumed).** Each act of this child on a session is stated per route in its item. Two insertions in U9's files, made by this child's own pull requests and reviewed by U9 (UC-7.6): the first pull request removes the `side.sendToMain` row from `remote-unavailable.ts` when the command retires; the second, once U9's fork has landed, adds the offer for `side.thread.open` (a side thread is a fork with the thread's lineage and its first message), under Fork's authorisation: the machine's owners. Until that offer exists, and for a member who is not an owner of the machine, the checkbox is ticked and locked for a session on another machine.

  **UC-3 and UC-8 (consumed).** This child edits four files it does not own, each by the smallest insertion and after its owner lands: the user row in `src/renderer/src/transcript/model/user-text.ts` and its view (U3), to draw several comments in one message; `src/renderer/src/panel/summary/PushState.tsx` (U8), to mount the next-step button; `src/shared/ipc/remote-unavailable.ts` (U9), one row removed; `src/shared/maws/document-tools.ts`, one parameter and one sentence. Of `src/renderer/src/tools/code/`, which UC-8 gives to this child whole, it works in `review/` and `anchor/` only; U6's Files work is in `files/`, `viewer/` and `editor/`. The files it changes that UC-8 names no owner for are the rest of `src/renderer/src/side/` (not the /btw files, U4's), `src/renderer/src/tools/scm/`, `src/shared/anchor/`, the browser's comment files (`src/preload/browser-comment.ts`, `src/shared/browser/comment-protocol.ts`, `src/renderer/src/tools/browser/comment/`), the document editors' comment binding (`src/renderer/src/tools/document/comments.tsx`, `src/artifacts/document/`) and `src/main/library/files.ts`.

  **UC-6 (consumed).** This child adds no chord. The card keeps Enter and ⌘Enter for Send, Shift+Enter for a new line and Escape as the draft model says.

- **Design inheritance:**
  - **Binds.**
    - The owner on comments: "default to 'seperate thread' (today's side thread)" and "make 'send to main' a chekcbox, thus nothing like today's toggle is needed"; on the artifact card, "agreed on making it simpler".
    - The owner on source control: "every commit, push, Opening PRs, and most merging PRs are done by agents anyway. Source control is mostly for human reviewing and occasionally confirming with actions."
    - The hunk counter and the turn's mechanical Undo are `keep` (l5-code-15).
    - No hunk staging (out of scope, standing). No generated commit message.
    - The draft rule the owner already has in documents (Escape keeps, an empty card is discarded when the keyboard leaves it; the P4 interface ledger's X36) is the rule for every card.
    - Laws 1, 3, 4 and 5 as each item states them; law 7: today's tokens and shapes, nothing new in visual language.
  - **Advice.**
    - The form's logic is already one hook for the card and the sheet; change the destination there once. Every test and e2e locator for the destination reads two radios named "Side thread" and "Send to main" with `data-destination`; they all change: `side/card/CommentCard.test.tsx`, `side/CommentComposer.test.tsx`, `side/actions.test.ts`, `tools/document/comments.test.tsx`, `comment-session.test.tsx`, and e2e `side`, `document`, `document-standalone`, `browser-comment`, `deliverables`, `p1-live`.
    - `src/shared/anchor/message.ts` is a persisted format: the engine's transcripts hold these texts. Keep the one-comment text byte-identical; `message.test.ts` and `anchor.test.ts` pin it. `test/lane-b/offer-coverage.test.ts` holds the rule that retiring `side.sendToMain` must satisfy.
    - A terminal session's bridge takes four files a message (`FILES_MAX` in `session/controls/lane-a.ts`); a pass with more screenshots than the route carries sends the first ones and the card says how many were left out before it sends.
    - Review's diff refreshes 250 ms after every change git reports; an open inline card and the unsent rows are keyed by path, side and line in the store, not by the drawn row, and a comment whose line is gone from the diff stays in the pass and in the chip.
    - `@git-diff-view/react` 0.1.7 gives one open widget row per diff and `extendData` rows per line; that is enough for a one-line comment and its unsent row, and it is why a comment on a range is not included.
    - `git.worktree.branch` also feeds the worktree clean-up dialog's ahead and merged state (`src/shared/sessions/worktree.ts`); change what Review reads, not what that command means.
    - `review.test.tsx` (1,153 lines) asserts the one-file body, the `mainWorktreeBranch` reason and the untracked row; `held-diffs.test.ts`, e2e `code-tools` and `code-tools-live` pin the rest. Source control's `ScmShell.test.tsx`, `groups.test.ts`, `view-state.test.ts`, `ScmTool.test.tsx`, `CommitForm.test.tsx`, `PrSheet.test.tsx`, `PushSheet.test.tsx`, `remote-actions.test.ts`, `services/scm/plans.test.ts` and e2e `scm` pin the list, the diff and the forms.
    - `patch-writer.batch.test.ts` and `engine-host/tool-server/documents.test.ts` pin the reply made of result lines; `main/library/files.test.ts` pins the export folder kept for one run only.

- **Required:** required for the wave's acceptance. Two parts are conditional: the unchecked state for a session on another machine, on U9's fork; Review and Source control following the agent into a worktree, on U8's probe and live signal. **Status:** not dispatched.

## O-45 · the two-way control becomes a "Send to main" checkbox
- **Today:** `DestinationControl` (`src/renderer/src/side/CommentFormParts.tsx`) draws two radios as segments, "Side thread" and "Send to main", in the card and in the sheet; the form already starts on Side thread (`useCommentForm`, `src/renderer/src/side/comment-form.ts`). A send to main is the command `side.sendToMain`, built and sent in main (`src/services/side/send-to-main.ts`); a side thread is `side.thread.open`. Both commands are listed in `src/shared/ipc/remote-unavailable.ts`, so for a session on another machine both segments are greyed and no comment can be sent. For a terminal session "Send to main" is greyed with "Held by …".
- **After:** UC-5's checkbox, its defaults and its two tables. A session MAWS runs: both states, as today's two segments. A terminal session: unchecked forks its conversation as today; ticked now works, through the bridge. A session on another machine: ticked works; unchecked waits for U9. The refusal row keeps "Send to main instead".
- **Why this, not that:** the owner's words give the shape. Claude Desktop's artifact comments have the same control: a checkbox "Send to Claude" beside an icon-only send button, off by default (`readable/app-5.1231.2/web/app/v1/frame-shell-chrome-DV8q7Xxq.js:36103-36145`, and `toClaude: c = !1` at `:25278`). MAWS departs in one thing, on the owner's word: Desktop's unchecked comment reaches no agent and is only posted on the artifact; MAWS's opens a side thread. The finding's own proposal, choosing the destination from whether the session is idle, lost to the owner's later sentence. Sending a ticked comment through the composer's path, rather than adding offers for `side.sendToMain`, was chosen because a second path for the same act would still do nothing for a terminal session.
- **Not included:** remembering the checkbox; a Send label that follows the checkbox; any change to what a side thread is.

## l6-artifacts-05 · a note that the comment went, and a count that ignores drafts
- **Today:** a send to main closes the card and shows nothing unless the app's queue held it (`CardComposer` in `side/card/CommentCard.tsx`; the one toast is in `side/actions.ts`). For documents, decks and designs the editor writes the thread and its mark when the card opens and withdraws them if nothing is sent (`src/renderer/src/tools/document/comments.tsx`), and the count of open comments includes that empty thread (`documentCommentCounts`, `src/artifacts/document/comment-counts.ts`), so the count rises before a word is typed.
- **After:** UC-5's line in the card's place after a send to main, on every surface and route. A thread counts as a comment once it holds a message; the editors' counts for decks, designs and dashboards follow the same rule.
- **Why this, not that:** the card closes and nothing else on screen changes, so the person cannot tell a send from a dismissal. The proposal's "working · Stop" state at the pin lost: a side thread's card already shows the thread working, and for the main conversation the session's own row and tab show it. Writing the thread only on Send lost: the early write is how the editor holds the mark while the person types, and the count is the only visible cost of it.
- **Not included:** the card beside the element for decks and HTML pages (they keep floating); a working state in the artifact.

## l6-artifacts-19 · the answered passage is shown once; the card folds in a narrow window
- **Today:** a document's card sits in the margin beside the page while the margin draws; in a body under 720 px the margin is off (`DocumentEditor.tsx`) and the card floats over the text, including over the passage the agent has just changed. Nothing marks what changed.
- **After:** when the agent's answer to a comment arrives (its edit names the thread, or the side thread's turn ends, whichever is first), the commented passage is tinted with today's highlight token for about 1.5 s and fades; with reduced motion it shows and goes without a fade. Only that passage, once, and only if the document is on screen then; the page is not scrolled. In a body under 720 px the floating card closes to the passage's mark at that moment, unless the keyboard is in the card; a click on the mark opens the thread again. In the margin the card stays.
- **Why this, not that:** the owner agreed with the proposal; the recommended reading of it is the smallest one. Highlighting every edit of the agent's lost: it adds motion to every turn for a small gain.
- **Not included:** decks and designs (their card always floats; the same fold can follow if the owner asks); a change list.

## l6-artifacts-20 (with X-105) · the agent's reply in its own words; the export folder is remembered
- **Today:** `artifact_edit` takes `answering: <thread id>` and posts the edit's result lines as the thread's message (`plan()` in `src/artifacts/document/edit-plan.ts`: `body: this.results.map(line).join('\n')`), so the thread, the margin and the Word export read "replaced 1 occurrence(s) in ^…" while the card shows the side session's chat reply. The export dialog remembers the last folder only until the app quits (`lastExportDirectory` in `src/main/library/files.ts`); the first export of a launch opens in Downloads. The authors' names were fixed earlier (`964664ea8`).
- **After:** `artifact_edit` gains an optional `reply` (1 to 2,000 characters) beside `answering`; its description gains one sentence: with `answering`, give `reply`, one or two sentences in your own words saying what you changed; it is posted as your reply in the thread. The thread's message is `reply`; without one it is the fixed sentence "Edited this passage." The result lines the tool returns to the agent do not change. The last export folder is kept across launches; with none yet, the dialog opens in the artifact's Space's linked folder, else the folder of the session that made it, else Downloads, taking only a folder that exists on this Mac.
- **Why this, not that:** one optional parameter is the smallest change to the tool (X9) and leaves every older call valid; the alternative, `answering: {thread, reply}`, changes the type of a field older transcripts hold. Posting the side session's chat reply into the thread lost: the edit and its reply are one write on purpose, so the thread never shows an answer without its edit.
- **Not included:** tracked changes in the Word export (X-076 stays in the tracker); `artifact_reply`, which already takes words.

## l5-code-01 · line comments in Review
- **Today:** Review's diff is read-only: `ReviewView.tsx` draws `DiffView` with no widget. The only line comment is the file viewer's gutter, which opens the sheet (`CodeView.tsx`).
- **After:** pointing at a line of a diff, on either side, shows the library's add button; a click opens UC-5's card in a row under that line, "Send to main" ticked. The comment's anchor is X10's `file-line` (absolute path, line number, `side: 'old'` for a removed line) and the line's text travels as the quote, so the agent can find the line after later edits move it and can read a line that no longer exists. Each unsent comment shows as a compact row under its line (its text, a click to edit, Remove). Send delivers the pass as one message. Unticked, one side thread takes the pass and opens in the Side pane. In Last turn, where each edit's lines are numbered as that edit found the file, the quote is what locates the line. Routes: as UC-5's table; the diff itself is read on the session's machine already.
- **Why this, not that:** the cut's decision is one card everywhere, ticked in Review, because a review comment is an instruction to the agent that did the work. Claude Desktop reaches the same end by another control: in its diff, Enter saves a comment that rides the next message and ⌘Enter sends at once, and the agent receives "In `path` at line N", the snippet fenced, then the comment (`readable/app-5.1231.2/web/app/v1/cb39f8c62-h3Gl6FTr.js:195-211` for the keys, `c9543da06-DAeewRbi.js:2014-2071` for the text). MAWS departs by using its own card and anchor, so a Review comment is drawn in the transcript like every other comment and can go to a side thread; it keeps Desktop's quoted snippet. Comments riding the composer's next message lost: it puts Review's state into the composer (U4's) for the same result as "Send N comments".
- **Not included:** a comment on a range of lines; comments posted to a pull request on GitHub; keeping sent comments drawn in the diff.

## l9-browser-delivery-05 · several comments on a page go as one message
- **Today:** each page comment is sent on its own and each becomes a turn; a second pick replaces the card and its text (`openCard` in `side/card/store.ts`: "the latest open winning").
- **After:** UC-5's pass on the browser's host and on an HTML page's: a second pick adds to the pass, the card lists the others, Send sends them together, and each comment keeps its own cropped screenshot. Comment mode still ends after each pick; the next comment starts from the Comment button or the page's context menu, as today.
- **Why this, not that:** Claude Desktop collects several selected elements of its browser into one message (`readable/app-5.1231.2/web/app/v1/c2fd10b8d-BK3CLwQH.js:6153`, "more selected elements were sent to Claude"); MAWS keeps its card, so each element also carries the person's words. Numbered pins drawn in the page lost: the page-side script is built to put two nodes in a page and nothing else, pins must follow elements through scrolls and reflows, and the card's list already says what will be sent. Keeping comment mode armed lost: an armed page takes every click, so the person could not reach another state of the page between comments.
- **Not included:** pins in the page; one destination per comment; several comments in one pass on documents, decks and designs, whose editors keep one unsent comment (UC-5, `holds: 'one'`).

## X-218 · the browser's card keeps its draft
- **Today:** only documents, decks and designs opt into the draft rule (`draftRule` in `tools/document/comments.tsx`); in the browser Escape closes the card and the text is gone, and so does anything that unmounts the pane's card host (`CommentCardHost` closes its card when it unmounts).
- **After:** UC-5's draft model is every card host's, not an opt-in: the browser, HTML pages and Review get it by being hosts. Closes tracker row 222 for the browser; the row's other half, the file viewer's sheet, stays as it is (a modal sheet has no card to keep).
- **Why this, not that:** one rule in the shared host replaces a flag each surface must remember to set.
- **Not included:** a close guard on a browser tab; closing the tab drops its unsent comments.

## X-216 · the page stops scrolling by itself after its card closed
- **Today:** the page-side script keeps the picked element in view while the strip under the page is open, and learns that the card closed only by guessing from the page's height (`onViewport` in `src/preload/browser-comment.ts`); a window made shorter while the card is open keeps the old element as its subject, so a later resize scrolls the page with no card open.
- **After:** the page is told when its card opens and when it closes (the host's `onClosed`, carried to the page on the comment channel in `src/shared/browser/comment-protocol.ts`), and keeps an element in view only between the two. The height guess is removed. With several comments in a pass, the subject is the open card's element.
- **Why this, not that:** it is the fix the tracker row names; anything inferred from height fails again at the next layout change.
- **Not included:** any change to the owner's ruling that the picked element stays in view while the strip is open.

## l5-code-05 · Review as one stacked list of files
- **Today:** `ReviewShell.tsx` draws a file list (at most 40% of the height) above one file's diff (`FileSection`, `ReviewView.tsx`); the mode toggles, the hunk counter and the previous and next file buttons belong to that one file. A binary can be selected first and shows an empty body.
- **After:** one scroller holds every file of the scope as a section, in the list's order. This is the design:
  - **Toolbar** (one line under the scope chips): the totals ("N files changed · +A −R · <scope>"), the unsent-comments chip, "Collapse all" (which becomes "Expand all"), the hunk counter with ↑ and ↓, and a menu holding Unified, Split and Wrap. These settings are the stack's, not a file's.
  - **A section's header** sticks to the top of the scroller while its body is under it: a fold mark, the path (repository-relative; the folder part shortens first; a rename reads "old → new"), a kind badge (Added, Deleted, Renamed, Binary, Untracked, Conflict), a "Staged" badge when the index holds the file, the counts, Viewed, "Open file ↗" and a menu (l5-code-06). A click on the header folds or unfolds the section.
  - **A section's body** is the file's diff as today, one block per edit in Last turn. A binary reads "Binary file". A file past the per-file cap keeps "Diff too large to display. Open the file". A rename with no change has no body.
  - **Folding.** A scope within the 8 MiB cap opens unfolded, except files marked Viewed. A scope past the cap opens folded, and unfolding a file loads it (today's per-file read). Marking a file Viewed folds it; a mark still drops when the file changes, as today.
  - **Drawing.** A section's diff is drawn only while the section is unfolded and within about two screens of the scroll position; outside that it is a spacer of its last height. This bounds the work for a large scope without virtualising rows.
  - **The hunk counter** counts the hunks of every loaded file not marked Viewed, in stack order; ↑ and ↓ scroll to the previous and next hunk across files and unfold a folded file they land in; scrolling by hand moves the count.
  - **A request to open Review at a file** (a receipt's "Review changes", the Environment card's change line, `show_pane`) scrolls to that file's section and unfolds it.
  - **No separate file list, and no previous and next file buttons:** "Collapse all" is the list.
  - A diff opened as a main tab (`DiffTab.tsx`) is the same stack without the scope chips.
  - **Routes.** Review reads git on the session's machine, from the session's working folder, so the stack is the same for a session MAWS runs, a terminal session and a session on another machine. A session the window holds no record for (a terminal session on another machine is listed without one) keeps Review's "no session" sentence; this child does not change which sessions have a record.
- **Why this, not that:** reading an agent's change in one scroll is what this surface is for, and Claude Desktop stacks every changed file with foldable headers and a per-file "Mark as viewed" (`readable/app-5.1231.2/web/app/v1/c44d00c7f-CP6SmyJb.js:15799-15831`, the files mapped into one scroll region; `:13049`, "Files are collapsed for large diffs. Select a file to expand it."; `:5118`, "Mark as viewed"). MAWS departs in three things. It keeps no file rail: Desktop's "Changed files" rail (`:11728`, hidden and shown at `:15398-15400`) sits beside a wide diff, and MAWS's Review is a narrow side column where folded headers do the same job in one click. It keeps the hunk counter, which Desktop does not have and the owner marked `keep`. It does not expand unchanged lines: that needs both whole versions of every file, read over the machine link for a session on another machine, for a secondary gain (law 4). Keeping one file at a time with the small fixes lost: it leaves the main defect, that a change cannot be read without clicking through it.
- **Not included:** "N unmodified lines" expanders and "Show whole file"; image before and after; a file tree or rail; word-level diff and hide-whitespace switches; new chords for hunks.

## X-072 · Review returns to the same file and place
- **Today:** `ReviewView.tsx` assigns the saved `scrollTop` once when it mounts; late highlighting, a resize or a zoom change then leaves the person somewhere else.
- **After:** the stack saves an anchor, the file at the top of the scroller and the offset inside its section, per session, folder and scope. On return it scrolls to that anchor and applies it again whenever a section above changes height, until the person's first scroll, key or pointer input in Review.
- **Why this, not that:** the stack needs its own restore anyway, and a pixel offset cannot survive sections that load late.
- **Not included:** restoring across a relaunch.

## l5-code-03 · "This branch" against the default branch, for every session
- **Today:** the base is `git.worktree.branch`'s `base`, the branch the main checkout has checked out (`lookupBase` in `review-store.ts`; `branch()` in `src/services/git/worktrees.ts`). A session in the main checkout therefore has the chip off ("Session runs on <branch>, the main worktree's branch"), and a worktree session is compared with whatever the main checkout happens to be on. The diff is `git diff <base>...HEAD` (`src/services/git/service.ts`), so uncommitted and new files are not in it. Source control computes a different base, the remote's default branch (`defaultBase` in `src/services/scm/service.ts`).
- **After:** one rule for the default branch, read on the session's machine and used by Review's base and by the pull request form's Base: the remote's HEAD branch (the remote chosen as today: the branch's upstream remote, else `origin`, else the only one), else `<remote>/main`, else `<remote>/master`, else local `main`, else local `master`. The base is the remote-tracking ref when it exists, else the local branch. "This branch" is the working tree, new files included, against the merge base of that ref and HEAD. The footer reads "<branch> · Since <base ref>". The chip is off, with the reason as its title, only when no default branch is found, or when the base found is the session's own branch and no remote-tracking ref exists for it. A detached HEAD is compared like any other. The rule for which scope Review opens on does not change.
- **Why this, not that:** reviewing an agent's work means everything it changed against where it started, committed or not; Claude Desktop's "All changes" does this, resolving `origin/<base>` before the local branch and including untracked files (`readable/app-5.1231.2/main-process/index.chunk-CgUL8Fja.js:592-606` and `:416-445`). On the default branch itself, comparing with the remote's copy shows what is not pushed yet, which is the useful reading of "this branch" there.
- **Not included:** a "Compare against" picker (Desktop has one; it can follow); single-commit scopes; opening Review on "This branch" by default.

## l5-code-04 · new files are counted, and are part of "This branch"
- **Today:** since `aa8cea562` an untracked file draws as added when selected, but its row says "Untracked" with no counts, the totals leave it out (`gitScopeFiles` adds it with zeros, `totals` sums them), and it is listed in Uncommitted only. `ReviewShell.tsx`'s opening comment still says Review reads no untracked file.
- **After:** the scope's read returns added-line counts for untracked text files, up to 200 files and the per-file size cap; the header shows "+N" beside the "Untracked" badge and the totals include it. Past the caps a file is listed with the badge and no count, and the totals say so ("+A −R, and N untracked files not counted"). Untracked files are listed in "This branch" as well as Uncommitted. An untracked folder keeps its note.
- **Why this, not that:** the remainder of a fix already made; Claude Desktop counts untracked, non-ignored files in its totals and caps how many it reads (`readable/app-5.1231.2/main-process/index.chunk-CgUL8Fja.js:416-445`, `:572-590`).
- **Not included:** untracked files in the Staged and Last turn scopes.

## l5-code-12 · four small slips
- **Today:** (a) Last turn lists absolute paths (`turnScopeFiles`) while the git scopes list repository-relative ones; (b) the file header is one truncating span, "path · kind", so the kind is cut first; (c) the "Last turn" chip exists only after Review was opened from a receipt (`turnId` in `view-state.ts`); (d) for a remote that is not on GitHub the Environment card prints `gh`'s raw error, because `readPrView` (`src/services/scm/pr-state.ts`) returns its stderr as the reason while the plan path already maps the same stderr to `no_remote`.
- **After:** (a) Last turn shows a path relative to the repository when the file is inside it, the absolute path otherwise; the file's identity stays absolute. (b) The kind is a badge in the stacked header and the path is what shortens. (c) The chip is always listed; chosen without a receipt it shows the latest turn that changed files; before any such turn, or where the transcript's rows carry no file list for the session, it is off with the reason "No turn has changed files yet". (d) The pull request state answers `no_remote` for that stderr, which hides the line.
- **Why this, not that:** each is the plain fix; (a) to (c) are part of the stack's header and chips.
- **Not included:** rewording other Review copy.

## l5-code-06 · Stage and Discard move into Review; Source control's own list goes
- **Today:** Source control lists files in four groups with file and group actions and draws its own diff (`ScmShell.tsx`, `FileRow.tsx`, `groups.ts`, `ScmDiff.tsx`); Review shows the same changes and can act on none. The commands take paths (`scm.stage`, `scm.unstage`, `scm.discard`, grade `manage`).
- **After:** in every git scope of Review a file that git's status lists as changed has, in its header's menu: Stage (it has unstaged changes or is untracked), Unstage (the index holds changes of it) and "Discard changes…" (restores a tracked file, deletes an untracked one, behind today's Discard sheet and its acknowledgement). A refusal is a line under Review's toolbar. An untrusted folder has the three items off with today's reason. Source control loses its groups, its rows and its diff; in their place one line gives the totals and opens Review. A `show_pane` for Source control that names a file opens Review at that file. For a session on another machine the commands run there as today and a refusal at the member's grade is said in words.
- **Why this, not that:** one place to read a change and act on a file of it, and one diff viewer instead of two. Claude Desktop has no staging at all (a file's actions in `readable/app-5.1231.2/web/app/v1/c44d00c7f-CP6SmyJb.js` are Mark as viewed, Open file, Attach as context and a menu; nothing stages or reverts); MAWS keeps file-level Stage and Discard because the commands exist and "By hand" (l5-code-02) needs something to commit. Hunk staging lost, as the cut says: it serves a person curating commits, which the owner's agents do.
- **Not included:** hunk or line staging; "Stage all" and "Discard all" (with nothing staged, the manual Commit takes everything); a conflict resolver (a conflicted file carries its badge and opens in the editor's merge view as today).

## l5-code-02 · Commit, Push and Create PR ask the agent
- **Today:** Source control's commit form refuses with "Nothing staged" until the person stages by hand; Push and "Open PR" open sheets that plan and run git and `gh` in MAWS (`CommitForm.tsx`, `PushSheet.tsx`, `PrSheet.tsx`, `RemoteActions.tsx`); "Open PR" is off with "Push first" until the branch is pushed.
- **After:** three buttons at the top of Source control, each sending the session one sentence through `sendToSession`, drawn in the transcript as the person's message:

  | button | the sentence |
  |---|---|
  | Commit | `Commit the working tree changes with a sensible message.` |
  | Push | `Push this branch to its remote.` |
  | Create PR | `Create a pull request for this branch: commit anything uncommitted, push the branch, open the pull request with gh against <base>, and tell me its URL. If this branch already has one, push to it and tell me that URL instead.` ("against <base>" is left out when no default branch is known) |

  | button | on when | off, with this title |
  |---|---|---|
  | Commit | git's status lists a change | "No changes to commit" |
  | Push | the branch has commits its upstream lacks, or no upstream of its own name | today's words: nothing to push, a detached HEAD, no remote |
  | Create PR | on a branch other than the default one, with a remote, and no open pull request (then today's link "PR #n ↗" stands in its place) | "Already on the default branch"; a detached HEAD; no remote |
  | all three | | while the session is working: "The agent is working; wait for the turn to finish"; when the session cannot take a message: the reason its send gives |

  A session that is not running is started by the click, as a typed message would start it. The Environment card's push row shows one of the three as a button, the next step: Commit while there are changes, else Push while there is something to push, else Create PR while its conditions hold, else none.

  The forms stay under a folded "By hand" section of Source control: the message field with "Skip hooks" and Commit, which commits what is staged or, with nothing staged, every change ("Commit all"); "Push…" and "Open PR…", opening today's sheets with the exact command behind a "Command" disclosure; "Open PR…" on a branch that is not pushed runs the push and then the create in one submit, stopping at the first refusal. The latest run's Output stays.

  Routes: a message, so the same for a session MAWS runs, a terminal session (through the bridge) and a session on another machine; the manual forms run on the session's machine at its grade, as today.
- **Why this, not that:** the owner's note on this item is that agents do the commits, and Claude Desktop does exactly this: its button sends "Commit the working tree changes with a sensible message." and the app runs no git for a local session (`readable/app-5.1231.2/web/app/v1/c96d752d0-CjYhuD9j.js:14483-14487`); its one button changes between commit and create-PR and is off while "Claude is working" (`:14454`). MAWS takes the commit sentence verbatim. It departs on the pull request: Desktop sends a long tagged prompt (`<create-pr-command>`, `readable/app-5.1231.2/web/app/v1/c06cf64bb-DOE498Hm.js:3066-3081`) that its own transcript shortens to "/create-pr" (`:3090-3100`) and that asks for the URL in a `<pr-created>` tag for a status card; MAWS has neither that shortening nor that card and reads the pull request's state from `gh` already, so it sends one plain sentence. Push by the agent is MAWS's own; Desktop has a direct Push of its own for some sessions (`readable/app-5.1231.2/web/app/v1/c96d752d0-CjYhuD9j.js:11680-11706`) and no sentence for it. The accepted proposal, a commit dialog that writes the message, lost to the owner's own note: the agent already writes the message and can judge what belongs in the commit, and generating one in MAWS needs an engine side query MAWS has no seam for.
- **Not included:** a generated commit message; "Commit and push" in one manual step; a draft pull request from the button (the form has Draft); merging.

- **Probes and checks:**
  - **P1 · several images in one message (law 6).** Does engine 2.1.322 keep a message of several image blocks and one text block when it is sent idle, sent as a steer during a turn, and given as a fork's first message? The fixtures cover one image (`spikes/protocol-probe/fixtures/pass3/p1-side-thread-live*.jsonl`). A new probe. If a steer drops or reorders images, a pass sent during a turn carries the first screenshot only and the card says so before sending.
  - **P2 · the diff library in a stack.** In `@git-diff-view/react` 0.1.7: does a widget row hold the card (focus, an input method's composition) in unified and split mode, do `extendData` rows survive a refresh of the diff, and what does drawing a section cost when it re-enters the two-screen band? A harness page. If a widget row cannot keep the keyboard through a refresh, the card docks under the file's header instead of under the line.
  - **P3 · the three sentences.** One run of each on the pinned engine in a scratch repository with a remote: does the agent commit, push, and open a pull request and report its URL without asking back? Reword Push and Create PR by what is seen; the Commit sentence is Claude Desktop's and changes only if it fails.
  - **P4 · `reply`.** One comment answered by an edit on a scratch document: does the agent give `reply` from the description alone? If not, the description's sentence is tightened before the fallback sentence is relied on.
  - **P5 · the cost of "This branch".** Time the read (merge base, working-tree diff, untracked counts) on the owner's largest repository, locally and over the machine link. It sets the untracked cap (200 files is the starting value).
  - **P6 · O-46's reproduction** (U14), below under Waiting.
  - **P7 · a terminal session takes the comment text.** Does the bridge's `laneA.send` deliver a text of several lines with blank lines and a `<maws_anchor …/>` line intact, and how long may it be? If the tag does not arrive intact, a comment to a terminal session is sent as its first line and words without the tag, and is drawn as a plain message.

- **Rulings reversed:**
  - **O-45** reverses contract X10's "one shared comment composer … with the destination control (Side thread default, Send to main)" (`docs/charter.md`, the X10 line of §13). Record there: "2026-11 (UX wave, U5, O-45): the destination control is one checkbox, 'Send to main', unchecked except in Review; unchecked opens a side thread. A send to main goes through the composer's send path, and `side.sendToMain` is retired. The owner's observation O-45."
  - **l5-code-02** reverses the owner's acceptance of the proposed commit dialog with a generated message (the mark on l5-code-02; its row in `docs/doperpowers/evidence/ux-wave-2026-11/register.md`). Record there: "Reversed by the owner's own note on the same mark: Commit, Push and Create PR ask the agent, as Claude Desktop does; the forms stay as the manual route; no message is generated."
  - **l6-artifacts-20**, once the owner confirms it (the register's `export-folder`), reverses the "keep" on the export dialog starting in Downloads (candidate 50, "Owner: keep", in `docs/doperpowers/evidence/p4/wr/reconcile-2026-10-23.md` and the "No work" line of `docs/doperpowers/ledgers/2026-10-23-P4-WR.md`). Record there: "Reversed by the owner's later `fix` on l6-artifacts-20: the dialog opens in the last export folder, kept across launches."
  - **Contracts amended, each with a dated line where it is written.** X10 (`docs/charter.md`): a `file-line` anchor may carry `side`; a message may carry several comments; a comment may carry a quote. X21 (`docs/charter.md`): the host `review`, the layout `inline`, the pass, `holds` and `onClosed`. X9 (`docs/charter.md`): `artifact_edit` gains `reply`. X36 (`docs/doperpowers/plans/2026-10-19-p4-interface-ledger.md`): the draft rule is every card host's; one unsent comment per artifact stays the editors' rule. The C8c and E6 execution documents (`docs/doperpowers/plans/2026-09-28-c8c-code-tools.md`, `2026-10-06-e6-source-control.md`): Review is a stack with no file list and gains file actions; Source control has no list and no diff.

- **Waiting:**
  - **Open questions.** The register (`docs/doperpowers/evidence/ux-wave-2026-11/register.md`, "Questions still open") is the one list of what is asked of the owner for this child's items, each with its recommended answer and when it is asked; where a sentence in this file differs from it, the register holds.
  - **O-46 · a comment on an HTML page goes to the session that made the page, not the one on screen.** The fix is decided: the page's comment goes to the session the main area shows, by the rule documents and decks use (`useArtifactCommentTarget`), and the card names the session when it is another one. It follows a reproduction on the owner's build (U14): open an HTML page another session made from a different session's side column, comment with each state of the checkbox, and see which transcript gains the row. Until then UC-5's "Session: <title>" line already shows where such a comment will go, and the sent note names where it went. If the reproduction shows a different cause, the fix is re-decided from what it shows.
  - Three questions of this child are in the register, asked when it starts: collecting comments in one pass; where the three buttons that ask the agent sit; and which of the owner's two words of 2026-10-23 holds for the export folder.

- **Not in this child:**
  - The live working folder and the Environment card's own rows (U8: l5-code-14, l5-code-16).
  - The file viewer, the Files tree and where a file opens (U6); the file viewer's line comment keeps its sheet.
  - The side question card for /btw (U4, O-20), which shares `src/renderer/src/side/`.
  - How a message sent during a turn is delivered (U4); a ticked comment follows it.
  - Fork and other acts for a session on another machine (U9); this child only consumes the fork.
  - Hunk staging, a bottom terminal drawer and the other standing exclusions of the wave.
  - Tracker rows that stay: a message typed into a comment's side thread from another composer is not recorded in the artifact's thread (row 149, X-088); a file viewer with no session has no line comments (X-069); no tracked changes in the Word export (X-076).
