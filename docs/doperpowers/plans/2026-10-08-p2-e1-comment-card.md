# P2-E1 — Comments behave like comments: the card and the deliverable

> **Parent:** `docs/doperpowers/plans/2026-10-08-p2-daily-driver.md` (the P2 composite spec), child id **P2-E1**, parent pin git blob `8814d733db1b3c50798b9d3ec766985b29e05420`. **Interface ledger:** `docs/doperpowers/plans/2026-10-08-p2-interface-ledger.md`, blob `d523aeffd58ae81f0e8bea06cd9bfd2647d810bc`, plus the coordinator's X22 amendment of 2026-10-09 (spec Decision Log 16: the seam's disposition union gains `'queued'` with a `queueId` and no `messageUuid`) and the seam's names as the ledger's §1 row now records them from P2-0's implementation pin `a3379850` (branch `worktree-agent-a41c75eb52e5315b4`, not merged at this writing). **Grain:** plan (M). **Edges:** blocked-by P2-0 for the card's Reply (M2); conditional-on P2-A G1 for Reply on a thread whose engine exited without a budget release; blocks P2-E2; soft: P2-C's presentation module replaces the forced local presenter when C lands. **Consumes:** X10 (the anchor and the composer seam), X11 (lineage), X9 and X12 (the artifact tools and records), X22 (the human send seam), X18's presentation once C lands. **Owns:** X21. **Amends:** X10, X9, X12 (proposed text in the hand-back, §H).

## Purpose

After this child, a comment on a delivered HTML artifact behaves like a comment. The owner clicks Comment in the Deliverables viewer, clicks the heading of the page, and a small card (300 px wide, Claude Desktop's measure) opens beside the heading inside the viewer: the element's name at its top, a comment field, the Side thread or Send to main choice. They type "Make the heading larger" and press Enter. The card stays where it is and becomes the thread: their comment, then the side thread's reply streaming in under it, then a Reply field. The main conversation is not touched, no Side tab takes over the panel, and no main tab opens. When the thread's agent rewrites the page, it calls `artifact_update` on the page's own id and the viewer shows the next version of the same artifact, the card still open beside it. If the agent needs a permission (to edit the file, to call `artifact_update`), the request card appears in the thread inside the card and Allow answers it there; a strip above Reply names what waits, with one click to the Side pane or a tab for the person who wants the full view. Close or Escape dismisses the card; the thread lives on in the Side pane's listing, from which "Show in deliverable" brings the card back.

Today the same click opens a 560 px modal sheet; Send forks the session and the right panel's single Side tab replaces the Deliverables tab on screen with a full session view (`SessionPane`), and the forked agent's `artifact_update` on the page fails with "no artifact in this session" and writes a fresh artifact instead (the owner's vault note of 2026-10-08, `docs/doperpowers/evidence/p2-cut/owner-vault-note-2026-10-08.txt`: "a comment behaves like a comment, a small comment chat UI, not a new tab"; tracker row of 2026-10-08, E2 · E3).

To see it working once landed: `pnpm -C <worktree> dev`, open a session that delivered an HTML artifact (or ask one to `artifact_create` a page), open Deliverables in the right panel, open the artifact, press Comment, click an element.

What does not change (the owner's "NO change in backend"): the fork (`side.thread.open`, X11), Send to main (`side.sendToMain`), lineage, the anchored text the agent receives, the Sheet for the code gutter, PR lines and browser pages (the browser's card is P2-E2's).

## Progress

- [x] (2026-10-09) Grounding against this branch's base 7462fe28 (master's 285c0356 changed only the spec's tracking map and the ledger's record): the composer seam, E3's sheet, actions and Side pane, the deliverables viewer, frame and bridge script, the transcript's surface rows and the local presenter, the attention and setup stores, main's fork and Send to main, the launcher and the deliverable store, the artifact tools, the capture bridge, the wire fingerprint; Claude Desktop 2.16120.0's card placement read at the source.
- [x] (2026-10-09) This document written.
- [x] (2026-10-09) Independent review of this document (adversarial reviewer on Opus, design and buildability in one round): 1 blocking, 6 should-fix, 7 minor, all folded (Decision Log).
- [x] (2026-10-09) Refresh pass before execution (executor of the Plan of Work, branch `worktree-agent-aebcc33c93831f363` from master 9e942f25): re-pinned to the parent `docs/doperpowers/plans/2026-10-08-p2-daily-driver.md`, child id P2-E1, blob `a7e7d4cf1084391d3b95aef232bb9b3de95295a5`, and the ledger `docs/doperpowers/plans/2026-10-08-p2-interface-ledger.md`, blob `226bb2586cefa6234112c6027b8df046ec2bda50`; no source file changed between this document's base 7462fe28 and 9e942f25; the names this document uses are the ledger's §1, §5 and §6 rows as resolved; the architect's H6 correction folded (D5, H5).
- [ ] M1 — The card in the deliverable viewer: the seam's placement hint, the card store and host, placement, the composer half.
- [ ] M2 — The thread in the card: rows from the anchored prompt, the forced local presenter, Reply through X22, the needs-you state, the dock rules (after P2-0 lands).
- [ ] M3 — Re-dock and re-pin: "Show in deliverable" from the Side pane, the bridge's locate message, the card across version changes.
- [ ] M4 — The artifact scope (G4): a side thread sees and edits its ancestors' artifacts (parallel to M1 to M3).
- [ ] M5 — End to end: the reworked e2e groups, the live case, both themes, the acceptance run, the whole-branch review.

## Terms

- **Card** (`CommentCard`, X21): the small non-modal panel this child adds. Two phases: *composing* (the comment form) and *thread* (the side thread's rows and a Reply field). One card per window at a time.
- **Host**: the surface a card is drawn in, a `CommentCardHost` placed by the producer's view. E1 builds the deliverable viewer's host (layout *anchored*: floating at the picked element). P2-E2 adds the browser pane's (layout *docked*: a strip in the pane's own box).
- **Placement hint** (`placement`): the additive field on `openCommentComposer`'s context that says how to present a comment: a card in a named host, or the sheet. Absent means the sheet.
- **Pin**: the point the card attaches to, derived from the picked element's rectangle (its bottom-left corner, with its top edge for the flip). **Re-pin**: finding the element again in a fresh frame by its selector. **Re-dock**: moving a thread from the Side pane back into a card.
- **Sheet**: E3's comment composer (`src/renderer/src/side/CommentComposer.tsx`), a 560 px modal; it stays for every producer without a host.
- **Needs-you state**: a one-line strip above the card's Reply field when the thread waits on the person (a request, a trust or relay card, a failed start, a terminal holding the thread), with one click to the Side pane or a tab. A request the transcript draws as C7's inline request card is also answerable in the card itself; the setup cards and the holder are not.
- **Forced local presenter**: the card's thread rows draw the owner channel's marks (`to-human`, `essential`, `insight`, `need-input`) through MAWS's own presenter (`src/renderer/src/owner/to-human/Presenter.tsx`), whatever the engine surface's attachment, until P2-C's module replaces it.
- **Ancestor chain** (G4): a session's side-thread ancestors, nearest first, ending at the **family root**, the first ancestor that is not itself a side thread. A root session or a fork (`lineage.kind === 'fork'`) has an empty chain.
- **X22 dispositions**: `sendHumanPrompt(appSessionId, content, {origin})` answers `sent`, `steered`, `queued` (with `queueId`, no `messageUuid` yet), `started` (A's acquisition, and today the `released` resume) or `refused` (with `reason`: the composer's `STARTING` or `ENDED` words, or a refused resume). A host error on the send or steer itself is thrown, not answered (P2-0 keeps the composer's existing Retry path), so every caller catches it.

## Pre-landed design (the parent's, not re-litigated)

Binding inheritance, as the parent marks it:

- **§4.7 [binding on the seam, the shared component and the artifact scope; advisory on dimensions].** One `CommentCard` behind X10's seam, chosen by an additive `placement` hint; the sheet stays for the code gutter. The card holds the composer (anchor label, screenshot thumbnail, the destination control) and, once a thread exists, the thread: its rows from the anchored prompt on, drawn through MAWS's transcript rows and the owner channel's presentation, a Reply field sending through §4.3, a needs-you state (one click to the Side pane or a tab), Close and Escape; "Open as tab" stays. The Side pane keeps its listing and re-docks the card. The fork and both sends are unchanged. In the deliverable viewer the card is positioned from the pick's `rect` inside the viewer body (renderer DOM, no cover protocol) and follows the viewer's scale. The card's rows draw the owner channel through MAWS's presentation whatever the attachment state (the local presenter forced on until C's module lands). Decided by the owner 2026-10-08 (Decision Log 9, yes): a side thread sees its parent's artifacts; `artifact_update` on the parent's id creates the parent's next version and `artifact_list` lists them (A-39's tab-sharing rule applied to artifacts); versions append in arrival order under the store's write serialisation whoever writes them; a thread of a thread resolves through the family root; a `/btw` thread follows the same rule.
- **§4.3 [binding]** the human send seam (X22). **§4.6 [binding on ownership]** MAWS owns the owner-channel presentation on every surface.
- **P2-E1's section (§5)**: G1 to G4 as written; the e2e groups `e2e:deliverables`, `e2e:side` and the live case at `e2e/p1-live.spec.ts:563` reworked, not skipped.
- **Advisory**: report E §2 (Desktop's card: 300 px, clamped, flipping, replies, Close, Escape, Resolve) and §3 (`docs/doperpowers/evidence/p2-cut/E-comments.txt`); E3's Design 6 and its line 46 are the intent this child replaces (`docs/doperpowers/plans/2026-10-06-e3-side-threads.md`).
- **Out of scope (parent §9):** stored comment threads, persistent pins and Resolve (P3); the card on the code gutter; the deliverables viewer's fit, zoom and actual size for images and video (P2-F's first wave; review-1 finding 13: only HTML artifacts are commentable, so the card and that work never meet).

## Acceptance

Observable on the branch head; M5 runs every item. "The harness" is the e2e harness (`MAWS_HARNESS=1`, engine replay where noted).

1. **The card opens beside the element (G1, G2).** In the Deliverables viewer (panel and deliverable main tab alike), Comment then a click on an element of an HTML artifact opens a card, not the sheet: `[data-comment-card]` with `data-anchor-kind="artifact-element"` and `data-anchor-locator` equal to the pick's selector, inside the viewer body, 300 px wide when the body is at least 316 px wide. Its top edge sits 4 px under the element's bottom edge and its left edge at the element's left (clamped so the card's right edge stays 8 px inside the body). With an element near the bottom of the body (less than 320 px below it and more room above its top than below its bottom) the card opens above the element, its bottom edge 4 px over the element's top. No `[data-comment-composer]` sheet exists; no Side tab is added to the panel; the main view's tabs are unchanged.
2. **The composer half.** The card's header names the anchor's label; the field (named "Comment") takes focus; the destination is the sheet's two radios ("Side thread", "Send to main", each with its `data-destination`) and the button is "Send", so every locator written for the sheet's form finds the card's; Enter sends, Shift+Enter breaks a line, an IME composition's Enter does not send; Side thread is selected; Send to main is disabled with its reason while the parent is not ready (today's rule). A producer screenshot shows as the thumbnail with Remove (exercised through the seam in a unit test; deliverable picks carry none). Close and Escape (focus inside the card) dismiss it and return focus to the viewer's Comment button.
3. **The thread in the card (G3).** Side thread forks the parent exactly as today (the `side.thread.open` payload is byte-identical to the sheet's for the same anchor and text) and the card turns into the thread: the person's comment as the first row (its anchor chip), the thread's reply streaming in under it, rows from the thread's anchored prompt on (none of the parent's copied history), the owner channel's marks drawn by MAWS's presenter (no raw `<to-human>` tag text, no "Resume this session to answer." line), and a Reply field. Reply sends through X22 with origin `'comment'`: idle, the reply appears as the thread's next user row; mid-turn, as the pending `next` steer bubble; held by the host queue, as the held bubble ("Sends when this turn ends") until the host submits it; to a thread the memory budget released, as a pending bubble with "Starting…" until the resumed thread delivers it, and a start that fails puts the text back in the card's field (never into the thread's composer draft). On a refusal the text stays in the field and the reason shows under it with Retry. The parent's transcript gains only E3's side-thread summary row; the parent's written prompts are unchanged.
4. **Needs you.** When the thread raises a permission (or an AskUserQuestion, a plan, a dialog or elicitation), C7's request card appears in the card's thread (`group "Approval needed"` for a permission) and Allow there answers it: the thread continues and the card stays open. Above the Reply field one strip names what waits ("Waiting for your permission"), with "Open in Side pane" and "Open as tab"; each moves the thread there (the card closes) with the request card on screen. A start that waits on a trust or relay card, a failed start, or a terminal holding the thread shows the strip alone, since those cards live in the full view. Answering in the Side pane and choosing "Show in deliverable" brings the card back on the same thread.
5. **Dock rules.** "Open as tab" opens the thread as a main tab and closes the card; the card also closes when its thread becomes drawn by the Side pane or by a main tab, when its viewer goes away, or when a new pick replaces it. A Side thread send whose card has closed before the fork answered reveals the thread as the sheet does (E3's Side pane and toast), so a thread is never created unseen. A thread shown in a card on screen clears its unread mark as the Side pane does, and its requests count as on screen for attention navigation (no in-app toast for a request the card already shows).
6. **Re-dock and re-pin.** In the Side pane, a thread opened from an artifact element has "Show in deliverable" in its header: the parent's Deliverables tool opens on that artifact (at its latest version) and the card opens in thread phase pinned at the element, found again by its selector; an element the page no longer has docks the card at the body's top-right corner. When the viewer switches version (the thread's own update included) the card stays open and re-pins to the element in the new frame.
7. **The artifact scope (G4).** A side thread's `artifact_update` on its parent's artifact id writes the parent's record's next version (`<userData>/deliverables/<parent>/<recordId>/v<n+1>.html`, the record's `versions` one longer, no new record under the thread); `artifact_list` from the thread lists its own artifacts, then its ancestors' with `ownerAppSessionId`; `artifact_screenshot` captures an ancestor's artifact; `artifact_create` with an id an ancestor holds is refused with the new text (§D10). A parent update and a thread update racing on one artifact produce two consecutive versions in arrival order. A thread of a thread updates the family root's artifact. A `/btw`-promoted thread follows the same rule; a `kind: 'fork'` session does not see its source's artifacts. The thread's transcript row "Updated artifact … · v<n+1>" opens the parent's record at that version; the viewer showing the latest moves to it with the card still open.
8. **Nothing else moved.** The code gutter, PR lines and browser pages still open the sheet with E3's behaviour (`e2e:code`, `e2e:side` cases 1 to 8, `e2e:browser-comment` green); the agent-facing anchored text, lineage and the index are unchanged; no settings, index or state-file version is taken.

## Design of the residue

### D1. Orientation

```
producer (Viewer.tsx pick) ──openCommentComposer(anchor, {appSessionId, placement})──► seam (tools/code/anchor/anchor.ts)
        │                                                                                 │ registered opener (side/register.ts)
        │                                                     placement.kind === 'card' ──┴── else ──► E3's Sheet (unchanged)
        ▼                                                                 │
CommentCardHost (inside the viewer body) ◄── claims ── useCommentCard store (side/card/store.ts)
        │ draws
        ▼
CommentCard ── composing: sendComment (side/actions.ts, unchanged sends; no reveal) ──► main: side.thread.open / side.sendToMain
            └─ thread: TranscriptSlot(child, {startAt, presentation:'local'}) + Reply ──► sendHumanPrompt (X22, P2-0)
                       needs-you from useAttention + useSetup + the record's holder

G4: main resolves the ancestor chain at launch ──session.launch {spec, artifactScope}──► engine host:
    the artifact tools resolve [self, ...chain]; writes run on the owner's chain, shared by every session in the host
```

### D2. The seam and the placement hint

`openCommentComposer(anchor, context)` gains `context.placement?: CommentPlacement` (shape in Interfaces). `{kind: 'card', host, hostId?, rect?}` asks for a card in the named host kind; `hostId` names the exact host instance (the viewer that picked); `rect` is the element's box in the host frame's viewport CSS pixels as the pick reported it. `{kind: 'sheet'}` or no placement opens the sheet. The placeholder sheet (`showAnchor`, used when nothing registered) ignores placement.

**Where the rect lives (decided).** The rect rides the placement, not the anchor: `artifactElementAnchor` (`src/renderer/src/tools/deliverables/comment/pick.ts`) is unchanged and the viewer passes the pick message's own `rect`. The X10 anchor is the agent-facing, persisted shape: its fields are written into the `<maws_anchor …/>` tag (`src/shared/anchor/message.ts` `TAG_FIELDS`, `box` included) and into lineage in the index, and `AnchorBoxSchema` takes whole positive pixels of the *document*, while the pick's rect is fractional *viewport* pixels valid only for the frame that produced it. Keeping it on the anchor would either change the text the agent receives for every artifact comment or need a tag exclusion, and the stored copy would be stale the moment the frame scrolls; a card re-docked later finds the element by its selector instead (D8). This revises the ledger's wording "`artifactElementAnchor` keeps the pick's `rect`" (hand-back H1). Alternative rejected: `box` on artifact-element anchors (the agent would read a meaningless viewport box, and every anchored prompt's bytes would change).

**Who decides placement.** The producer: the deliverable viewer passes a card placement; the code gutter (`CodeView.tsx`), PR lines and the browser comment connect (`tools/browser/comment/connect.ts`) pass none and keep the sheet. P2-E2 later passes `{kind: 'card', host: 'browser', …}` from the browser connect.

### D3. The card store and its hosts

`useCommentCard` (`src/renderer/src/side/card/store.ts`) holds at most one open card per window (`OpenCard` in Interfaces); a new open replaces the old one, as the sheet's latest anchor wins today. A replaced composing card loses its draft, as the sheet does (Desktop also keeps one draft card).

A card's **target** is derived from its anchor: an `artifact-element` anchor's `pageUrl` parses with `parseDeliverableUrl` (`src/shared/maws/deliverable.ts`) into `{appSessionId, deliverableId, version}`; the browser target is reserved for P2-E2. A card opened with a `hostId` is drawn by that host only. A card opened without one (the re-dock, D7) carries `claimMode` (the host mode the re-dock opened: `'panel'`) and is **claimed** by the first mounted host whose `accepts(card)` returns true: the deliverable viewer accepts a card whose target names its record and whose `claimMode` is its own mode, so a main-tab viewer of the same record already mounted elsewhere never takes a card the re-dock meant for the panel it just activated. The claim is one store update, so two viewers cannot both draw it. A card still unclaimed 5 s after it opened is closed (`CLAIM_DEADLINE_MS`): the record turned out gone (the tool shows its list with the notice), or the person navigated away before the viewer mounted; the thread stays in the Side pane, and a stale card never pops up later in some other viewer of the record.

`CommentCardHost` (`src/renderer/src/side/card/CardHost.tsx`) is the only thing a producer's view mounts: an overlay layer over the view's body (absolute, full size, pointer events only on the card itself) that draws the store's card when it is this host's, with its layout: *anchored* (D4) or *docked* (the card in flow at the host's bottom edge, full width minus 16 px; built here with a unit test so P2-E2 only places a host and supplies its rect). The host receives the frame mapping `{scale, offset}` (the deliverable viewer passes scale 1 and offset 0, its frame filling the body; whoever adds zoom to the HTML viewer passes the zoom, which is the "follows the viewer's scale" of G2) and a `locate(selector)` function (D8), and reports whether it is on screen (`visible`: the Deliverables panel tool's `ctx.visible`, a deliverable main tab's active state).

**Close rules** (decided; every one keeps the thread, which stays listed in the Side pane): Close; Escape with focus inside the card (handled on the card, `preventDefault`ed so the viewer's picking listener, which skips prevented Escapes, never sees it; an IME composition's Escape is ignored); a new card replacing it; its host unmounting (Back to the list, another deliverable, the tab closed, the panel switching session); "Open as tab" or "Open in Side pane" from the card; and, in thread phase, its thread becoming drawn elsewhere: a main tab of the thread open (`isOpen(main, sessionTab(child))`) or the Side pane drawing it (`hostedInSidePane(child)`). The last rule is E3's "one place draws a session with an input" applied to the card: the Side pane's `SessionPane` has the full composer and the request card, and two inputs for one thread would race the seam. Alternative rejected: keep the card open in a "Shown elsewhere" state (more state, and the person already chose the other view).

The card closes on none of: a click in the artifact, the agent working, the frame reloading. It is non-modal (`role="dialog"`, `aria-modal` absent, no focus trap), since the person reads the page while the thread works.

### D4. Placement (anchored layout)

Claude Desktop's card placement (`readable/app-2.16120.0/web/app/v1/frame-shell-chrome-CXu04DiJ.js:17530-17583`, function `GT` with `RT = 320`, `zT = 48`, `BT = 240`, `VT(h) = max(320, round(0.6·h))`), adapted to a host box and an element rectangle instead of a click point. Pure function in `src/renderer/src/side/card/placement.ts`, in the host's own coordinates (top-left 0,0; width `W`, height `H`):

| Step | Rule |
|---|---|
| Width | `width = min(300, W − 16)` |
| Minimum height | `MIN = 120` (the composer half's height, and the least a thread with a Reply field needs; Desktop's 48 is a one-line draft) |
| Too small a host | `width < 200` or `H < 160`: docked layout (full width minus 16 px at the bottom, `maxHeight = min(320, H − 16)`); never hidden, since a hidden card would lose the draft |
| Cap | `cap = max(320, round(0.6·H))` |
| No pin (re-dock with no element found, or a rect with a non-finite value) | top-right corner: card `left = W − width − 8`, card `top = 8`, `maxHeight = min(cap, H − 16)` |
| Pin | `pinOf(rect, {scale, offset})`: `pin.x = rect.x·scale + offset.x`; `pin.y = (rect.y + rect.height)·scale + offset.y` (the element's bottom); `pin.top = rect.y·scale + offset.y` (its top); then `pin.x` clamped to `[0, max(0, W − width − 8)]`, `pin.y` to `[0, H]`, `pin.top` to `[0, pin.y]` |
| Rooms | `below = H − (pin.y + 4)`, `above = pin.top − 4` |
| Flip | below when `below ≥ 320`; otherwise above when `above > below` and `above ≥ MIN`; otherwise below |
| Below | card `left = pin.x`, card `top = clamp(pin.y + 4, 0, max(0, H − MIN))` (so at least `MIN` fits, overlapping the element when it sits near the bottom), `maxHeight = min(cap, H − card top)`, the top-left corner squared (Desktop's touch at the pin) |
| Above | card `left = pin.x`, card `bottom = H − (pin.top − 4)` measured from the host's bottom edge, `maxHeight = min(cap, above)`, the bottom-left corner squared |

Desktop's middle case (both rooms between 240 and 320, flip only if the room above the element's top is at least 240) collapses into "the side with more room" here because MAWS pins at the element's bottom rather than at a click point inside it, so flipping above the pin would cover the element. The card is re-placed when the host box resizes (a `ResizeObserver` on the host) from the stored rect; it does not follow the frame's scroll (Desktop's card is `position: fixed` too; a stored pin that follows the content is P3's). A page-supplied rect is validated by the pick schema already (finite numbers) and the clamps make any value safe.

### D5. The composer half

The sheet's form at card size, in `src/renderer/src/side/card/CommentCard.tsx`: a header (the anchor's label, one line, truncated with the full label and the locator as its `title`; Close), the screenshot thumbnail when the producer gave one (E3's `ScreenshotThumbnail`, moved to a shared module in `side/` so both presentations use it), an autosizing textarea (1 to 6 lines, `SIDE_COPY.composer.placeholder`), and one row with the destination as a compact two-segment control and Send. The control keeps the sheet's accessible structure exactly: two radios named "Side thread" and "Send to main", each label carrying `data-destination` (`thread`, `main`), the textbox named "Comment" (`SIDE_COPY.composer.field`), the button "Send"; only the captions move into each segment's `title`, Send to main disabled with its reason exactly as today. Live case 3 (`e2e/p1-live.spec.ts`, Send to main) and every other locator written for the sheet's form then find the card's. The phase machine is the sheet's (`editing`, `sending`, `refused` with Retry and "Send to main instead"), shared by extracting the sheet's form logic into one hook both presentations call, so the two cannot drift. A refusal that arrives after the card closed is the sheet's toast.

**The sends are unchanged.** `sendComment` (`src/renderer/src/side/actions.ts`) gains one option, `reveal` (whether to reveal the new thread as E3 does; by default yes, the sheet's behaviour), and answers the adopted thread's id: the card asks it not to reveal, so no Side pane is opened or activated and no toast says where the thread went (it is in the card). If the card's serial is gone when the fork answers (Close or Escape during "Starting…", a new pick replacing it, its host unmounting), the card falls back to `revealNewThread` for that thread, so a thread is never created unseen; `sendComment` therefore takes `reveal` as a function evaluated at answer time (`reveal: () => cardGone(serial)`), not a constant. The sheet keeps `revealNewThread` exactly as E3 built it (a code-gutter comment has no other place to show its thread).

**Send to main stays `side.sendToMain`** (decided; an open question for the architect, §H6). §4.3 names Send to main among the seam's callers, and §4.7 says both sends are unchanged. The two meet here: main's `sendToMain` (`src/main/side/send-to-main.ts`) already applies X22's policy (a `next` steer while a turn runs, a send when idle) in main, because only main can build the anchored content with the screenshot's image block under its root checks (`commentContent`, `screenshotRoots`); routing it through the renderer seam would need the image bytes in the renderer or a new content read. The card wraps the answer into X22's result shape (`steered`, `sent`, `queued`) so both destinations read alike; on success the card closes and only `queued` toasts (today's copy). When P2-A lands, acquisition for Send to main runs in the renderer's shared comment form before `side.sendToMain` (A's document §5.6, A's dated block in the form logic this child extracts; the architect's correction of 2026-10-09, spec Decision Log 18), so the sheet and the card inherit it alike and nothing acquires inside main's `sendToMain`; the extracted form hook leaves that place for A's block. Until then Send to main is disabled while the parent is not ready, as today.

### D6. The thread half

**The rows.** The card draws the thread through `TranscriptSlot` (`src/renderer/src/transcript/view/TranscriptSlot.tsx`), the shell's own session transcript (registered actions, the request renderer, the host queue's held rows at the tail, withdrawn steers, effort), with three additive props passed through to `Transcript`:

- `actions?: Partial<TranscriptActions>`, merged over the registered ones. The card overrides one: `openDeliverable` for the card's own record goes to its host viewer's version (`CardFrame.showVersion`, the viewer's `onVersion`, with `null` when the version is the latest so the viewer keeps following new ones), since the registered action always targets the panel's tool and sets an explicit version; any other record goes to the registered action.

- `startAt(rows) → number | null`: the index of the first row to show. The card passes `threadStartOf(lineage)`: the last `user` row whose `anchor` equals the lineage's anchor on `kind`, `locator` and `label` and whose `anchorFrame.destination` is `'thread'`. The last such row is the thread's own (a thread of a thread copies its parent's anchored prompt first; E3's `promotionQuestionOf` uses the same rule for promotions). `null` (not arrived yet) shows nothing but the echo below; a thread whose rows are loaded (`phase` ready) with no match falls back to index 0, since showing too much is recoverable and hiding the thread is not. A thread with no lineage anchor (a promotion) starts at 0. This also closes E3's deferred "a thread reloaded from disk begins with the parent's copied history" for the card.
- `presentation: 'local'`: carried on the transcript context; `useAssistantInput` in `src/renderer/src/transcript/surface/Rows.tsx` then treats the transcript as unattached for assistant text, so marks draw through `assistantPresentation` and any other assistant text through the ordinary row, never through an engine-surface site. Tool, user and command rows are untouched. The presenter's `need-input` line "Resume this session to answer." is omitted when the drawing says `answerable` (the card has a Reply field under it): `Presenter.tsx`'s drawing gains `answerable?: boolean`, passed from the context. When P2-C lands, its module replaces `assistantPresentation` behind the same option (C owns that change; ledger §5 row 3). The card's transcript shares the child's store entry with any other view of the thread (the store attaches by key): follow state is per view, but expanded and collapsed turns and assistant ink are the entry's. Under the forced option `reportInk` records local ink, which `clearAssistantInk(key, 'surface')` keeps, so after the card closes a surface view of the same thread still treats a block carrying a mark as ink. That is accepted and pinned by a test: the two ink sources agree that a marked block is for the person, and a block without a mark reports no ink either way.

While the thread is starting (no record yet, or no anchored row yet) the card shows an **echo**: the comment as typed in a user bubble with "Starting…" under it, replaced by the transcript once `startAt` returns an index. The card's thread region is a bounded scroll container (the transcript list is virtualised and needs a definite height): in thread phase the card takes its placement's `maxHeight` (decided for v1; growing with the content is a taste question, §H6).

**Reply.** A plain textarea (1 to 4 lines; Enter sends, Shift+Enter breaks, IME guarded; no attachments, no slash commands, as E3's comment field: a comment is short and the composer's typed slash seam must not run here) and a send button, through `sendHumanPrompt(child, text, {origin: 'comment'})` (X22; no `display`, which is the composer's pasted-segment markers). A thrown host error is treated as `refused` with the error's message. By disposition:

| Disposition | The field | What the thread shows |
|---|---|---|
| `sent` | cleared | the thread's next user row (the delivered prompt) |
| `steered` | cleared | the transcript's pending `next` steer bubble, which becomes the user row when the engine takes it |
| `queued` (`queueId`, no `messageUuid`) | cleared | the host queue's held bubble at the transcript's tail ("Sends when this turn ends", W1's `heldRow`), keyed by the queue entry; when the host submits the entry it mints the uuid (`QueueEntry.messageUuid`, set at `submitting`) and the user row with that uuid replaces the bubble |
| `started` | cleared | a **pending reply** (the card's `pendingReply: {text, at}`) drawn as a dimmed user bubble with "Starting…" at the transcript's end, until a user row of the thread newer than `at` arrives; main's resume sends the reply only once the engine is ready, so no transcript row or queue entry exists meanwhile. If the start fails, C10 hands the message back through `returnMessage` (`src/renderer/src/sessions/message-return.ts`); while a card holds a pending reply for the thread it claims that return (`holdMessageReturn(child, fn)`, below), so the text goes back into the card's field with the failure in the strip, never into the thread's unseen composer draft (P2-0's `released` resume today; A's acquisition later) |
| `refused` | kept | the reason under the field with Retry; while the thread's engine has exited without a budget release (until A lands), the reason plus "Open in Side pane", where Resume is |

`holdMessageReturn(appSessionId, fn) → dispose` is an additive per-session claim in C10's `message-return.ts`: `returnMessage` calls the session's holder when one is registered, else the registered return as today. The card registers it only while it holds a pending reply and disposes it when the reply is delivered, the card closes, or the claim fires; the composer's registration is untouched.

Beyond the pending reply, the card keeps no delivery state of its own: queued and delivered are the transcript's rows, the same source the Side pane and a main tab read, so the three views can never disagree. This is how the card owns the `queued` state the seam cannot observe (a host-queued send has no uuid until the host submits it): the held bubble is the queue entry itself, drawn from `useQueueStore` for the child, which `TranscriptSlot` already attaches; the entry disappears when the host submits it, and the delivered user row (the replayed uuid, the same event `waitForHumanPromptDelivery` waits on) takes its place. A held bubble the person removes from the queue (`session.queue.remove`) simply disappears, with nothing in the card to reconcile. If a later need arises for an explicit delivered mark (Desktop's "Sent to Claude"), it correlates `queueId` to the entry's minted `messageUuid` through `useQueueStore`, then calls P2-0's `waitForHumanPromptDelivery(child, messageUuid, {signal})` with the card's lifetime as the signal; this child does not add it. The field is disabled with a placeholder while the thread is starting (no record) and while a terminal holds it.

**The header** in thread phase: the anchor's label, "Open as tab" (`openTab({kind: 'session', appSessionId: child})`, then the card closes), Close. The thread's phase glyph (the sidebar's `GlyphMark`) sits before the label so a working or failed thread reads at a glance.

**Requests in the card.** A request the thread raises is a `request_slot` row in its open turn, and `TranscriptSlot`'s registered renderer (`renderSessionRequest`, `src/renderer/src/request-card/inline.tsx`) draws C7's full inline `RequestCard` for it whenever no composer has that request docked, which in the card is always (the card closes when a composer draws the thread). So a permission, an AskUserQuestion, a plan, a dialog or an elicitation is answered inside the card, as C8b's drill-in answers a child's requests (decided). This keeps the Purpose scene whole in the owner's ordinary permission mode: the thread's Edit and its `artifact_update` each ask, and closing the card for each would defeat "the card still open beside it". The inline card at the card's ~284 px content width is checked by an e2e assertion (Allow inside the card's box, clickable) and the M5 shots in both themes; a request kind whose inline card proves unusable at that width (a long plan, a form) still has the strip's one click to the Side pane. Alternative rejected: suppressing the inline card in the card and sending every request to the Side pane (every default-mode permission would close the card).

**The needs-you state.** One strip above the Reply field, computed by `needsYouOf` (`src/renderer/src/side/card/thread.ts`) from four sources, first match wins:

| Source | Strip text (copy, D12) |
|---|---|
| `useSetup` card for the child: `trust` / `relay` | "Waiting for you to trust this folder" / "The relay is not answering" |
| the setup's failure for the child (`failureOf`) | "Could not start" |
| the record's holder is a terminal or background job | "Held by <holder words>" (the existing `holder-words` text), with "Open as tab" only |
| `waitingItem(selectPendingOf(attention, child))` at tier 1, by the oldest item's kind | permission "Waiting for your permission"; question "Asked you a question"; plan "Waiting for you to review a plan"; dialog, elicitation "Waiting for your input"; error "Hit an error"; interrupted "Was interrupted"; auto_mode_unavailable "Auto mode is unavailable" |

Actions: "Open in Side pane" (the parent's Side pane on this thread, activated, through `revealPane`'s path in `side/actions.ts`; the card closes) and "Open as tab". For a request the strip is a pointer beside the inline card (the parent's "one click to the Side pane or a tab"); for the setup cards, a failure and a holder it is the only way on, since those cards live in `SessionPane`. Tier-2 items (held peer messages) raise no strip. P2-C's two kinds, `async_input` and `essential_unread`, raise none either (the card's Reply answers a question and its rows show the essential); any other tier-1 kind not in the table reads "Waiting for you".

**Visibility.** While its host is on screen and the window is active, a thread-phase card publishes its thread through its own store field (`useCommentCard`'s `shownThread`), read in two places, each one marked block: `visibleSessions` (`src/renderer/src/session/visibility.ts`), so the thread's unread mark clears as the Side pane's does; and `requestOnScreen` (`src/renderer/src/attention/navigation.ts`), so a request the card already shows inline raises no in-app toast, exactly as for a thread the Side pane draws. It deliberately does not reuse the Side store's `shownChild`, which also means "hosted in the Side pane" (`hostedInSidePane`, read by `/btw`'s inline questions and by the card's own close rule).

### D7. The Side pane

The listing, its chips and the thread view are E3's. Two changes:

- **"Show in deliverable"** in the thread view's header (`src/renderer/src/side/ThreadView.tsx`), beside "Open as tab", for a thread whose lineage anchor is `artifact-element` with a parseable `pageUrl`. It opens the Deliverables tool in the target's session on the record at its latest version, not the anchored one (`openDeliverable` in `src/renderer/src/tools/maws/actions.ts` with no version, which activates the tool; the thread may have written versions since the comment, and a viewer on the latest follows the thread's next ones), then opens a card in thread phase on this thread with no `hostId`, no rect and `claimMode: 'panel'`, which that panel viewer's host claims (D3) and re-pins by locate (D8). Like "Open as tab", the action is hidden while a main tab shows the thread (`inMain`), where the card's own close rule would shut it at once. Re-dock lives in the header rather than on the chip (decided; §H6): the chip's click selects the thread as today, and a second target on a 220 px chip is fiddly.
- Nothing else. A card's Side thread send adds no Side tab (decided; §H6): the thread is discoverable through the parent's transcript summary row (whose Open shows it in the Side pane), the sidebar's nesting, and the Side pane's listing. Adding the tab inactive would put an unrequested tab in the strip, which is the opposite of the owner's note.

### D8. Re-pin: the bridge's locate message

The bridge script (`src/main/deliverables/bridge-script.ts`) answers one more message from its parent: `{type: 'maws:locate', selector}` is answered with `{type: 'maws:located', selector, rect: {x, y, width, height} | null}`, the rect from `getBoundingClientRect` of `document.querySelector(selector)` (null when the selector is invalid or matches nothing; a throwing selector is caught). It listens to `window.parent` only, like `maws:pick`, and posts with `'*'` (the frame has an opaque origin). `src/renderer/src/tools/deliverables/comment/pick.ts` gains the message builder and the `maws:located` schema. `HtmlFrame.tsx` tracks its own frame's `load` (the frame is an opaque origin, so a message posted before the load reaches the blank or previous document and is lost) and hands its parent an imperative handle through a new `onFrame(handle | null)` prop: `handle.locate(selector): Promise<CardRect | null>` waits for the current load, posts, and resolves on the matching `maws:located` from its own `contentWindow`, or null 1 s after the post (a page that blocks its main thread, or a non-artifact frame without the bridge). It listens for `maws:located` whether or not picking is on. The page can answer with any rect it likes; the clamps make that harmless, as with picks.

The host re-pins: when it claims a card with no rect (re-dock), and when its frame changes, it calls `locate(card.anchor.locator)`; a rect re-pins, null keeps the current position (or the top-right corner when the card has none). "The frame changes" is `CardFrame.key` changing: the viewer passes `Shown`'s existing `frame` string (`<appSessionId>/<id>/<version>#<reloads>`), which changes on a version switch, a Reload and the thread's own update moving the viewer to the latest. The card survives these frame swaps because the host is a sibling of `Body` inside the viewer body, not inside `Body`, which a Reload remounts.

### D9. What the deliverable viewer changes

`src/renderer/src/tools/deliverables/Viewer.tsx`: a stable `hostId` per viewer instance (`useId`); `onPick` passes `{kind: 'card', host: 'deliverable', hostId, rect: message.rect}`; the body container (`relative min-h-0 flex-1`) gains `CommentCardHost` beside `Body`, with `accepts` matching its record and its mode (`claimMode`, D3), the frame `{scale: 1, offset: {x: 0, y: 0}, key: frame, locate, showVersion}` (`locate` from the HTML frame's handle, only when the body is `html`; `showVersion` the viewer's `onVersion`, whose type widens from `number` to `number | null` with null meaning the latest: `DeliverableTab`'s `setVersion` already holds `number | null`, and `DeliverablesHandle.setVersion` in `DeliverablesTool.tsx` widens with it), and `visible` from the viewer's caller (a new `visible` prop on `DeliverableViewer`, true by default; `DeliverablesTool` passes `ctx.visible`, the deliverable tab its active state). Picking, Escape while picking and the one-pick-per-Comment rule are unchanged; a pick while a card is open replaces the card.

### D10. G4: the artifact scope

**Resolution in main.** `artifactScopeOf(sessions, lineage)` (new, `src/main/sessions/artifact-scope.ts`) walks `lineage` while it is `kind: 'side-thread'`: it collects `parentAppSessionId`, reads that parent's record, and continues with the parent's lineage, nearest first; it stops at a parent that is not a side thread (that parent is the family root and is included), at a parent missing from the index (the chain ends with the last one found), after 16 links, or on a repeated id. It answers `[]` for a root or a fork. The chain is not just the root (decided): A-39 lets a thread reach its parent, and a thread of a thread should still reach the artifacts its parent thread created; nearest-first resolution then finds the root's artifact through the chain, which is "resolves through the family root".

**Transport (decided).** The chain travels as a sibling of the spec in the launch command, `session.launch {spec, artifactScope?: AppSessionId[]}`, never inside `LaunchSpec`. The host stores the spec in each session's strictly parsed state file (`src/engine-host/store/file-session-state-store.ts`), and a key an older build does not know makes that build move the file aside with its queue and grants (the review-1 hazard P2-0's tolerant reader addresses, ledger §3: no new stored key before that reader is in the owner's running build). A sibling is never stored, so G4 has no edge to the owner's build. Nothing reads the stored spec back (`loadLaunchSpec` has no caller), and every launch comes from main, which resolves the chain each time. Main's two launch sites that can launch a side thread pass it: the intent launch (`src/main/sessions/setup.ts`, the intent's lineage) and the resume (`src/main/sessions/resume.ts`, the record's lineage; C3's one automatic retry goes through it too). The bootstrap launch has no lineage. Alternatives rejected: a `LaunchSpec` key (the stored-file hazard), a host→main question at call time (fails with no app connected, and X13 requires create, update and list to serve a session with no renderer), a host-side family file (a second persisted format for one list).

**In the host.** `createLauncher` (`src/engine-host/launcher.ts`) passes the scope into the `EngineSession` options and on to `SessionMaws` (`src/engine-host/session-maws.ts`) and the artifact tools (`src/engine-host/tool-server/tools.ts`, `artifacts.ts`), which resolve over `[self, ...scope]`:

| Tool | Behaviour in a session with a scope |
|---|---|
| `artifact_update` | the nearest session in `[self, ...scope]` holding the id owns the write; inside `exclusive(owner, …)` the record is read again, the version is `versions.length + 1`, the copy goes to the owner's directory, the record is rewritten whole; the result is today's plus `ownerAppSessionId` when the owner is not self |
| `artifact_list` | self's artifacts, then each ancestor's in chain order, an id already listed nearer skipped; ancestors' rows carry `ownerAppSessionId` |
| `artifact_screenshot` | resolves like update (read only); the capture request carries `ownerAppSessionId` when not self, and main reads the record from it (`src/main/deliverables/capture.ts`); the answer still routes by the requesting session |
| `artifact_create` | refused with `artifactExistsInParent(id)` when any ancestor holds the id; otherwise created in self's scope as today (A-39: a thread's own artifacts stay its own, and the parent does not see them) |

`artifact_screenshot` is included though the parent names only update and list (decided): "a side thread sees its parent's artifacts" means a thread that updated the page can verify it, and the tracker's incident was exactly an agent that could not reach the page it was asked to change. `show_pane` with a deliverable target is not changed (its session semantics are a window's, and nothing in the comment flow needs it). The tool descriptions are not changed (decided): the thread inherited the parent's history and knows the artifact's id (the tracker's incident shows the agent calls `artifact_update` on it unprompted), and a description change churns every `tools/list` the conformance fixtures pin.

**Write serialisation.** Today each `EngineSession` builds its own `FileDeliverableStore`, so each has its own `SessionChains` and a parent and a thread writing one record would not be serialised. The launcher creates one `SessionChains` per host process and hands it to every session's store (the store's constructor takes it as an option; its default stays a private chain for tests and the memory store), so `exclusive(owner, task)` from any session queues behind every earlier task for that owner. That is the "store's write serialisation whoever writes them": versions append in the order the calls entered the owner's chain. The owner's chain exists whether or not the owner's engine is live.

**Announcements and the renderer.** The store's `onWritten` already announces `deliverables.changed` with the record's own `appSessionId`, so the parent's lists, the viewer and the version switcher refresh with no change. The transcript's artifact row in the thread must open the parent's record: `maws.delivery.artifact` (`src/shared/graph/events.ts`, mapped by `src/engine-host/normalizer-controls.ts` from the answer) gains `ownerAppSessionId` (optional, absent for self), copied from the result, so a journal rebuild reproduces it. The row must not depend on the event alone: `session.events` answers from disk with no host events for a session without a live stream (after a supervisor restart, or once an exited session's stream is dropped; `src/engine-host/ipc.ts`), and there `derive.ts` fills the row from the tool result only (`resultOfArtifact`). So `resultOfArtifact` copies `ownerAppSessionId` from the parsed result too, and the event refines it as it refines the version. The artifact row (`src/renderer/src/transcript/model/rows.ts`) carries it and `src/renderer/src/transcript/view/rows/Artifact.tsx` opens and chips against `row.ownerAppSessionId ?? useRowSession()`. An old or budget-released thread's row, the common case, thereby opens the parent's record. The parent's own rows are unchanged.

**The card's artifact reloading.** The viewer showing the latest version moves to the new version when `deliverables.changed` arrives (existing behaviour: the deliverables store re-reads every looked-up record on its change event, `src/renderer/src/tools/deliverables/store.ts` `applyChanged`, and a viewer with no explicit version draws the latest; reached now through the owner's id); a viewer pinned to an explicit older version stays, and the thread's "Updated artifact … · v<n>" row inside the card shows that version in the card's own viewer through the card's `openDeliverable` override (D6; null when it is the latest, so the viewer keeps following). The card stays open and re-pins (D8).

**Records stay as they are.** `DeliverableRecordSchema` is strict and persisted; a version written by a thread is recorded exactly as one written by the owner (its `toolUseId` names the thread's call, which nothing in the deliverables UI dereferences), so no record field is added and an older build reads every record.

**A wire change.** `session.launch`'s input, the `maws.artifact.capture` event and the session event schema are host-wire shapes, so E10's wire fingerprint (`src/shared/ipc/wire-fingerprint.ts`) changes with this child, as with P2-C's launch change: an app of this build meeting an older detached supervisor shows E10's other-wire state until that supervisor is replaced. Nothing beyond E10's existing handling is needed.

### D11. What stays and what is not taken

The sheet, its store and its tests stay for every producer without a host. The fork, lineage, the anchored text, the index and `side.thread.open` / `side.sendToMain` are unchanged. No settings version, no index migration, no state-file key (§4.9: "D and E1 none expected" holds). Nothing under `~/.claude`.

### D12. Copy

All strings through `SIDE_COPY` (`src/renderer/src/side/copy.ts`) in a new `card` group, except the tool refusal (X9's `TOOL_ERRORS`). Exact strings, the person's words, no provenance:

| Key | Text |
|---|---|
| `card.title(label)` (the dialog's accessible name) | `Comment on ${label}` (the sheet's own) |
| `card.close` | `Close` |
| `card.replyField` / `card.replyPlaceholder` | `Reply` / `Reply to this thread` |
| `card.send` / `card.sendReply` (button labels) | `Send` / `Send reply` |
| `card.starting` | `Starting…` |
| `card.openInSidePane` / `card.openAsTab` | `Open in Side pane` / `Open as tab` |
| `card.needs.*` | the strip texts in D6's table, and `Waiting for you` for any other tier-1 kind |
| `pane.showInDeliverable` | `Show in deliverable` |
| `TOOL_ERRORS.artifactExistsInParent(id)` | `artifact_create: an artifact "${id}" already exists in the conversation this side thread was opened from; use artifact_update` |

## Execution

### Constraints binding every milestone

- **Inheritance:** §4.7 [binding on the seam, the component and the artifact scope], §4.3 and X22 [binding], §4.6 [binding on ownership]; contracts X10, X11, X9, X12, X21, X22 as above; the ledger's names, with this document's proposals (§H1) used once the architect records them (code against the proposed names; a rename at reconciliation is mechanical). One proposal departs from the binding X21 text and G2's parenthesis ("the pick's `rect` kept by `artifactElementAnchor`"): D2 keeps the rect on the placement instead. That reading is the architect's to record (§H1, §H4) before P2-E2 is dispatched against X21; E1 builds it as proposed, since nothing outside E1 reads the rect until E2.
- **Files shared with siblings** (ledger §6): `src/renderer/src/transcript/surface/Rows.tsx` is P2-C's; E1 adds one marked block (`// P2-E1 start … // P2-E1 end`) reading the forced presentation, and whichever of C and E1 lands second adapts. `src/renderer/src/tools/deliverables/Viewer.tsx` is also P2-F's first fix wave's (images and video fit, zoom and actual size); E1's changes stay in the HTML body's container and the pick. `src/shared/ipc/schema/session.ts` is shared by A, C and D: E1 edits only the `session.launch` entry's input, marked. `src/shared/graph/events.ts`: one optional field inside E2's `maws.delivery.artifact` entry, with a dated comment (an in-place change of E2's line, listed in the hand-back as a §6 exception).
- **Engine and host rules (CLAUDE.md, D-1):** the engine is never patched; X13: create, update and list serve a session with no renderer; nothing writes under `~/.claude`.
- **Tokens only, light theme first;** both themes shot at M5. The card uses the existing popover surface tokens (`bg-bg-raised`, `border-border-strong`, the popover shadow the console chip's popover uses).
- **Copy** through `SIDE_COPY`; D12's strings exact.
- **Machine discipline:** at most one e2e group at a time, each through the slot script (Concrete Steps); a timing-only failure is retried once alone and both results recorded. The live case runs once, within its existing allocation.
- **Commits:** plain messages, no attribution of any kind; never amend, reset or force-push.

### Interfaces and Dependencies

Renderer seam, `src/renderer/src/tools/code/anchor/anchor.ts`:

```ts
export interface CardRect { x: number; y: number; width: number; height: number } // the host frame's viewport CSS px
export type CommentPlacement =
  | { kind: 'card'; host: 'deliverable' | 'browser'; hostId?: string; rect?: CardRect }
  | { kind: 'sheet' };
export interface CommentContext { appSessionId: AppSessionId; placement?: CommentPlacement }
export type CommentComposerOpener = (anchor: Anchor, context: CommentContext) => void;
export function openCommentComposer(anchor: Anchor, context: CommentContext): void; // unchanged dispatch: the latest registration, else the placeholder
```

Card store, `src/renderer/src/side/card/store.ts`:

```ts
export type CardTarget = { kind: 'deliverable'; appSessionId: AppSessionId; deliverableId: string; version: number }; // P2-E2 adds { kind: 'browser'; … }
export type CardPhase = { kind: 'composing' } | { kind: 'thread'; child: AppSessionId; echo: string | null };
export interface OpenCard {
  serial: number;               // a new open is a new card
  parent: AppSessionId;         // the producer's appSessionId: the session the comment is about
  anchor: Anchor;
  host: 'deliverable' | 'browser';
  hostId: string | null;        // null until claimed (re-dock)
  claimMode: 'panel' | 'tab' | null; // for an unclaimed card: the host mode that may claim it (the re-dock passes 'panel')
  openedAt: number;             // for CLAIM_DEADLINE_MS
  target: CardTarget | null;    // targetOf(anchor); null when the anchor names none
  rect: CardRect | null;        // null: locate, else the corner
  phase: CardPhase;
}
export const CLAIM_DEADLINE_MS = 5_000;                              // an unclaimed card closes after this
export const useCommentCard: UseBoundStore<StoreApi<{ open: OpenCard | null; shownThread: { parent: AppSessionId; child: AppSessionId } | null }>>;
export function openCard(anchor: Anchor, context: CommentContext & { phase?: CardPhase; claimMode?: 'panel' | 'tab' }): void;
export function cardGone(serial: number): boolean;                    // the card was closed or replaced
export function claimCard(serial: number, hostId: string): boolean;   // first claimer wins
export function closeCard(serial?: number): void;                    // only that card, when given
export function enterThread(serial: number, child: AppSessionId, echo: string): void;
export function targetOf(anchor: Anchor): CardTarget | null;          // artifact-element: parseDeliverableUrl(anchor.pageUrl)
```

Host and card, `src/renderer/src/side/card/CardHost.tsx` and `CommentCard.tsx`:

```ts
export interface CardFrame {
  scale: number; offset: { x: number; y: number };
  key: string;                                            // changes when the frame is replaced (the viewer's `frame` string)
  locate?(selector: string): Promise<CardRect | null>;    // the HTML frame's handle
  showVersion?(version: number | null): void;             // the host viewer's onVersion; null: the latest
}
export function CommentCardHost(props: { hostId: string; host: 'deliverable' | 'browser'; mode: 'panel' | 'tab'; layout: 'anchored' | 'docked'; accepts(card: OpenCard): boolean; frame: CardFrame; visible: boolean }): ReactNode;
// src/renderer/src/tools/deliverables/frames/HtmlFrame.tsx, additive prop
onFrame?(handle: { locate(selector: string): Promise<CardRect | null> } | null): void;
// src/renderer/src/sessions/message-return.ts, additive
export function holdMessageReturn(appSessionId: AppSessionId, fn: MessageReturn): () => void; // consulted before the registered return
```

Placement, `src/renderer/src/side/card/placement.ts` (D4's table):

```ts
export interface CardPin { x: number; y: number; top: number }
export type CardStyle =
  | { mode: 'below'; left: number; top: number; width: number; maxHeight: number }
  | { mode: 'above'; left: number; bottom: number; width: number; maxHeight: number }
  | { mode: 'docked'; width: number; maxHeight: number };
export function pinOf(rect: CardRect, frame: Pick<CardFrame, 'scale' | 'offset'>): CardPin;
export function placeCard(box: { width: number; height: number }, pin: CardPin | null): CardStyle;
```

Thread helpers, `src/renderer/src/side/card/thread.ts`:

```ts
export function threadStartOf(lineage: Lineage | null): (rows: readonly Row[], loaded: boolean) => number | null;
export type NeedsYou = { kind: 'setup-card' | 'setup-failed' | 'held' | 'attention'; text: string; tabOnly: boolean } | null;
export function needsYouOf(input: { card: WaitingCard | undefined; failed: boolean; holder: SessionHolder | null; pending: AttentionItem[] }): NeedsYou;
```

Transcript options (ledger §5 row 3), `src/renderer/src/transcript/view/TranscriptSlot.tsx`, `Transcript.tsx`, `context.tsx`:

```ts
// TranscriptSlotProps and TranscriptProps, additive:
startAt?: (rows: readonly Row[], loaded: boolean) => number | null; // null: nothing yet
presentation?: 'local';                                            // on the context as `presentation`
// TranscriptSlotProps only, additive (Transcript already takes `actions`):
actions?: Partial<TranscriptActions>;                              // merged over the registered actions
// Presenter.tsx's drawing, additive: answerable?: boolean
```

Sends, `src/renderer/src/side/actions.ts`:

```ts
export async function sendComment(destination: CommentDestination, input: CommentInput, options?: { reveal?: () => boolean /* asked when the fork answers; default () => true */ }, client?: MawsBridge):
  Promise<{ ok: true; child?: AppSessionId; disposition?: 'sent' | 'steered' | 'queued' } | { ok: false; error: string }>;
```

X22, consumed (P2-0's names as the ledger's §1 row records them from pin `a3379850`):

```ts
// src/renderer/src/composer/submit/send-human-prompt.ts
sendHumanPrompt(appSessionId: AppSessionId, content: SendContent, options: { origin: HumanPromptOrigin; display?: string }, client: MawsBridge = ipc):
  Promise<{ disposition: 'sent' | 'steered' | 'queued' | 'started' | 'refused'; messageUuid?: MessageUuid; queueId?: string; reason?: string }>
// throws on a host error of the send or steer itself; the card catches it as a refusal
// src/renderer/src/composer/submit/human-prompt-delivery.ts (not called by this child; D6 names when it would be)
waitForHumanPromptDelivery(appSessionId, messageUuid, { signal? } = {}, client = ipc): Promise<user.message event>
```

Bridge messages (`pick.ts`, `bridge-script.ts`): `{type: 'maws:locate', selector: string}` → `{type: 'maws:located', selector: string, rect: CardRect | null}`.

G4, host wire and tools:

```ts
// src/shared/ipc/schema/session.ts
'session.launch': host(z.strictObject({ spec: LaunchSpecSchema, artifactScope: z.array(AppSessionIdSchema).max(16).optional() }), LaunchResultSchema)
// src/main/sessions/artifact-scope.ts
export function artifactScopeOf(sessions: Pick<SessionStore, 'get'>, lineage: Lineage | null): AppSessionId[];
// src/engine-host/deliverables/store.ts
export class SessionChains { run<T>(appSessionId: AppSessionId, task: () => Promise<T>): Promise<T> }   // exported; one per host process
new FileDeliverableStore(userData, { onWritten, chains })
// src/shared/maws/tools.ts (additive, optional)
ArtifactUpdateResultSchema += { ownerAppSessionId?: AppSessionId }
ListedArtifactSchema       += { ownerAppSessionId?: AppSessionId }
ArtifactScreenshotResultSchema += { ownerAppSessionId?: AppSessionId }
TOOL_ERRORS.artifactExistsInParent(id)
// src/shared/ipc/schema/maws.ts
MawsArtifactCaptureSchema += { ownerAppSessionId?: AppSessionId }   // the record's session; absent: appSessionId
// src/shared/graph/events.ts, inside E2's entry
'maws.delivery.artifact' += { ownerAppSessionId?: AppSessionId }
// renderer row
{ kind: 'artifact'; …; ownerAppSessionId?: AppSessionId }
```

### Plan of Work

M1 to M3 are renderer work in sequence; M4 is host, main and the transcript's artifact row, independent of them and runnable in parallel by a second executor (it shares no file with M1 to M3: the artifact row's files are M4's alone, and M4 adds no e2e case). The new `e2e/side.spec.ts` cases are owned one each: 9 and 10 by M2, 11 by M3, 12 by M5 (it needs M2's card and M4's scope). M2 starts only after P2-0 is merged to master and rebased in (check that `src/renderer/src/composer/submit/send-human-prompt.ts` exists); M1, M3's bridge work and M4 do not wait. M5 starts when M1 to M4 are reviewed.

### M1 — The card in the deliverable viewer (composer half)

**At its end:** in the Deliverables viewer a pick opens the card beside the element, clamped and flipping per D4, with the composer half (D5); Side thread forks and, in this interim, closes the card and reveals the thread in the Side pane exactly as the sheet does (so the milestone is a valid state on its own); Send to main works; Close and Escape dismiss; every other producer still opens the sheet.

**Touches:** `src/renderer/src/tools/code/anchor/anchor.ts` (placement types); `src/renderer/src/side/register.ts` (one registered opener dispatching by placement); `src/renderer/src/side/card/store.ts`, `placement.ts`, `CardHost.tsx`, `CommentCard.tsx` (new); `src/renderer/src/side/CommentComposer.tsx` (the form logic extracted into a hook in `side/card/` or `side/comment-form.ts`, the thumbnail into a shared component; the sheet's behaviour unchanged); `src/renderer/src/side/copy.ts`; `src/renderer/src/side/actions.ts` (`reveal` option, the answer's `child` and `disposition`); `src/renderer/src/tools/deliverables/Viewer.tsx` and its two callers (`DeliverablesTool.tsx`, `DeliverableTab.tsx`) for `hostId`, the host, `visible` and `onVersion`'s widening to `number | null`; the App's mount of `CommentComposerHost` is unchanged.

**Interfaces:** produces `CommentPlacement`, `useCommentCard`/`openCard`/`claimCard`/`closeCard`/`targetOf`/`CLAIM_DEADLINE_MS`, `CommentCardHost` and `CardFrame` (with `key` and `showVersion` wired by the viewer; `locate` arrives in M3), `placeCard`/`pinOf`, `sendComment`'s `reveal` option.

**Decisions:** D2, D3, D4, D5, D9. `sendComment` gains its `reveal` option here, but the card still calls it with the default in this milestone (the interim above); M2 switches the card to `reveal: () => cardGone(serial)` when the thread phase exists. The claim rules (`claimMode`, `CLAIM_DEADLINE_MS`) are built and unit-tested here; their first caller is M3's re-dock. The card's DOM carries `data-comment-card`, `data-anchor-kind`, `data-anchor-locator`, `data-card-phase` and `data-placement` (`below`, `above`, `docked`) for tests. Escape is handled on the card element. Focus moves to the field on open and back to the viewer's Comment button on close (to the frame's iframe element when the button is gone).

**Does not touch:** the sends' IPC, main, the bridge script, the transcript, the Side pane, `CodeView.tsx`, the browser comment connect.

**Proves:** acceptance 1, 2, and 8's sheet half. Tests: `placement.test.ts` pins every row of D4's table (below with room; above when the element is near the bottom; below when neither side has 48 px; left clamp at the right edge; the docked fallback under 200 px; the corner with no pin; the max height cap at 60 %; the scale and offset mapping). `CommentCard.test.tsx` (new) and the reworked `CommentComposer.test.tsx`: the dispatch by placement (a card placement opens no sheet, none opens the sheet), the composer half's phases shared with the sheet (the existing sheet cases unchanged), the card's Side thread and Send to main sending exactly the payloads the sheet sends for the same anchor and text, the thumbnail, Close and Escape, focus return, one card per window (a second open replaces, a refusal after close toasts). `actions.test.ts`: `reveal: false` adds no Side tool and no toast; `reveal` default keeps E3's behaviour. `deliverables.test.tsx`: the pick passes the card placement with the pick's rect and the viewer's `hostId`, in the panel and in a deliverable main tab; the host draws only its own card; an unhosted card is claimed only by a host of its record and its `claimMode`, and closes unclaimed after `CLAIM_DEADLINE_MS` (fake timers). `e2e/deliverables.spec.ts` "comment mode" reworked: the click opens `[data-comment-card]` with the anchor attributes and `data-placement="below"`, its box 4 px under the heading's box and inside the viewer body; a second seeded page with the element near the bottom opens `data-placement="above"`; Escape dismisses it; no `[data-comment-composer]`; the Deliverables tab stays selected; the same pick in the record's deliverable main tab (Open in tab) opens the card inside that tab's viewer; shot `comment-card`.

### M2 — The thread in the card

**At its end:** after Side thread the card becomes the thread (D6): the echo, then the rows from the anchored prompt streaming, the forced local presenter, requests answered inline, Reply through X22 with the disposition table and the pending reply, the needs-you strip, "Open as tab" and "Open in Side pane", the close rules for a thread drawn elsewhere, the fallback reveal for a thread whose card is gone, the visibility and on-screen signal. No Side tab is opened by a card send (M1's interim reveal removed).

**Touches:** `src/renderer/src/side/card/CommentCard.tsx`, `thread.ts` (new), `store.ts` (`enterThread`, `shownThread`, `cardGone`); `src/renderer/src/transcript/view/TranscriptSlot.tsx` (`startAt`, `presentation`, `actions`), `Transcript.tsx`, `context.tsx` (`startAt`, `presentation`); `src/renderer/src/transcript/surface/Rows.tsx` (one marked block); `src/renderer/src/owner/to-human/Presenter.tsx` (`answerable`); `src/renderer/src/sessions/message-return.ts` (`holdMessageReturn`); `src/renderer/src/session/visibility.ts` and `src/renderer/src/attention/navigation.ts` (one marked block each reading `useCommentCard`'s `shownThread`); `src/renderer/src/side/copy.ts`; `e2e/support/side-replay.ts` (a permission request, below).

**Interfaces:** consumes X22 (`sendHumanPrompt`), `useCommentCard`, `CommentCardHost` and `CardFrame.showVersion` from M1; produces `threadStartOf`, `needsYouOf`, the transcript's `startAt`, `presentation` and `actions` options (ledger §5 row 3, which P2-C consumes), `holdMessageReturn`.

**Decisions:** D6. The forced option changes `useAssistantInput`'s `attached` for assistant text only; it must not alter what the Side pane or a main tab draws for the same session (the option is per mounted transcript, on its context). The card's transcript shares the child's store entry with any other view: follow state is per view, expanded and collapsed turns and ink are shared (D6 records the ink consequence). The inline request card is `TranscriptSlot`'s registered renderer, unchanged; the card adds nothing to C7. The needs-you strip reads the oldest tier-1 item's kind; its copy table is D6's. `Open in Side pane` reuses `side/actions.ts`'s pane-opening path with activation, which already handles a parent that is not the shown session (it waits in that panel with E3's toast). The replay harness gains `SideJournal.permission(toolName, input)`: an outbound `control_request` `can_use_tool` and its expected `control_response`, the frame shapes borrowed from the `can_use_tool` rows of `spikes/protocol-probe/fixtures/pass3/p1-maws-artifacts.jsonl` (the ones `e2e/deliverables.spec.ts`'s `allowNext` answers); the anchored thread's journal is built with an `artifact-element` anchor, and the artifact is seeded with `seedArtifact` after `startParent` (the parent's app session id is minted at runtime).

**Does not touch:** main, the host, the sends' IPC, C7's request card, the Side pane's own components.

**Proves:** acceptance 3, 4 (its last sentence is M3's) and 5. Tests: `thread.test.ts`: `threadStartOf` on a live thread (the anchored row first), a disk thread (copied history then the anchored row: starts at the anchored row), a thread of a thread (two anchored rows with the same anchor: the last), a promotion (0), nothing loaded yet (null), loaded with no match (0); `needsYouOf` precedence and every kind's text. `Rows` test: with `presentation: 'local'` an attached session's assistant text with a `<to-human>` span draws `[data-owner-report]`, and without the option it draws through the surface as today; `answerable` omits the resume line. `CommentCard.test.tsx`: each X22 disposition's field and status (a fake seam), the refusal with Retry, a thrown host error shown as a refusal with its message, a `queued` reply drawn as the held bubble from a fake queue entry and replaced by the user row once the entry is submitted, the echo until the anchored row arrives, a `started` reply's pending bubble until a newer user row arrives, a failed start returning the text to the card's field through `holdMessageReturn` (and not to the registered return), the strip with a pending permission (beside the inline request card) and with a docked trust card (alone), an unknown tier-1 kind reading "Waiting for you", `async_input` raising none, Open as tab and Open in Side pane close the card, the card closes when the Side pane publishes the same child or a main tab opens it, a Side thread send answered after the card closed reveals the thread as the sheet does, the artifact row's Open for the card's own record calling `showVersion` (null for the latest). `message-return.test.ts`: a holder takes the return for its session only and its disposer restores the registered path. `SideTool.test.tsx`: a card send adds no Side tool. `visibility.test.ts` and `navigation.test.ts`: a card-shown thread is visible while its host is on screen, and `requestOnScreen` is true for its requests then and false once the card closes. `Rows` test: with the forced option, a block with a mark reports local ink and a block without reports none. `e2e/side.spec.ts` new case 9 (replay): pick, Side thread, the card shows the comment row and the replayed reply with no parent history above it, the Deliverables tab still selected and no Side tab in the strip, Reply while idle delivers a user row to the thread (`writtenUsers(maws, child)` gains it) and nothing to the parent; case 10: a replayed permission in the thread draws the request card inside the card (`group "Approval needed"` within `[data-comment-card]`'s box) with the strip "Waiting for your permission"; Allow there resolves it and the replayed turn continues with the card open; a second replayed permission, then "Open in Side pane": the pane shows the request card and the card is gone.

### M3 — Re-dock and re-pin

**At its end:** "Show in deliverable" in the Side pane's thread header re-docks the card in the parent's viewer, pinned at the element found by locate; a version switch, a Reload and a new version keep the card open and re-pin it.

**Touches:** `src/main/deliverables/bridge-script.ts` (the locate answer); `src/renderer/src/tools/deliverables/comment/pick.ts` (locate builder and schema); `src/renderer/src/tools/deliverables/frames/HtmlFrame.tsx` (its own `load` tracking, the `onFrame` handle, `maws:located` heard whether or not picking is on); `src/renderer/src/tools/deliverables/Viewer.tsx` (the handle passed up from `Body` to the host's `CardFrame.locate`); `src/renderer/src/side/card/CardHost.tsx` (re-pin on claim and on `CardFrame.key` change); `src/renderer/src/side/ThreadView.tsx` (the header action, hidden while `inMain`); `src/renderer/src/side/copy.ts`.

**Interfaces:** produces the bridge messages, `HtmlFrame`'s `onFrame` handle and `CardFrame.locate`; consumes `openCard` (with `phase: thread`, no `hostId`, `claimMode: 'panel'`), `claimCard`, `targetOf`, `CLAIM_DEADLINE_MS` from M1.

**Decisions:** D7, D8. The bridge stays one line when served (its source is written so that joining lines changes nothing: no `//` comments, every statement ended by a semicolon; see the file's header). A locate never starts picking and leaves nothing in the page. A locate is posted only after the current frame's `load`, and its 1 s timeout starts at the post. The header action shows only for an `artifact-element` anchor whose `pageUrl` parses, and not while a main tab shows the thread.

**Does not touch:** the pick protocol's existing messages, the Sheet, main beyond the bridge's source string.

**Proves:** acceptance 6 and the last sentence of 4. Tests: `bridge-script` unit (the served string still one line; a jsdom or the existing harness check that `maws:locate` answers a rect for a present selector and null for an absent or invalid one); `pick.test.ts` (the located schema refuses malformed rects); `HtmlFrame` (a locate asked before the load is posted after it; it resolves on its own window's answer, ignores another window's, times out to null); `CardHost` (a claimed card with no rect locates and re-pins; a `CardFrame.key` change, standing for a version switch, locates again in the new frame and keeps the card open; a null answer keeps the position); `SideTool.test.tsx` (the header action's presence by anchor kind and its absence while `inMain`; its click opens the Deliverables tool on the target at the latest version and a thread-phase card with no host and `claimMode: 'panel'`). `e2e/deliverables.spec.ts` "the bridge script picks …" extended with a locate round trip on the real Chromium; `e2e/side.spec.ts` case 11: after case 9's flow, Open in Side pane, then "Show in deliverable": the Deliverables tab is selected, the card is in thread phase with `data-placement="below"` under the heading; a Reload keeps it open and pinned.

### M4 — The artifact scope (G4)

**At its end:** a side thread's artifact tools see and edit its ancestors' artifacts per D10; writes from any session to one record are serialised on the owner's chain; the thread's artifact row opens the owner's record; the tracker row of 2026-10-08 "a comment's side thread cannot update the artifact it comments on" is closed by its tests.

**Touches:** `src/main/sessions/artifact-scope.ts` (new), `src/main/sessions/setup.ts` and `src/main/sessions/resume.ts` (pass `artifactScope`); `src/shared/ipc/schema/session.ts` (`session.launch` input); `src/engine-host/ipc.ts` (pass through), `src/engine-host/launcher.ts` (one `SessionChains`, the scope into the session), `src/engine-host/session.ts` (the option), `src/engine-host/session-maws.ts`, `src/engine-host/tool-server/tools.ts`, `src/engine-host/tool-server/artifacts.ts`, `src/engine-host/deliverables/store.ts` (`SessionChains` exported and injectable); `src/shared/maws/tools.ts` (result fields, the refusal); `src/shared/ipc/schema/maws.ts` and `src/main/deliverables/capture.ts` (the capture's owner); `src/shared/graph/events.ts` and `src/engine-host/normalizer-controls.ts` (the event field); `src/renderer/src/transcript/model/rows.ts`, `derive.ts`, `reduce.ts` if it copies the event's fields, and `src/renderer/src/transcript/view/rows/Artifact.tsx` (the owner).

**Interfaces:** produces `artifactScopeOf`, `session.launch`'s `artifactScope`, `SessionChains` injection, the `ownerAppSessionId` fields, `artifactExistsInParent`.

**Decisions:** D10. The resolution reads records with the store's `list`, outside any chain, to find the owner; the write then re-reads inside `exclusive(owner, …)` so a concurrent writer's version is seen. A thread's own artifact with the same id as an ancestor's cannot arise (create refuses it); one created before this child landed (the tracker's "rounded-field" kind of copy) is found first, being nearest, which keeps such a thread consistent with its own history. The memory store and the tests keep their private chain by default. The launch with `artifactScope` on a non-side-thread is impossible by construction (main answers `[]`), and the host does not check lineage (it has none).

**Does not touch:** the record schema, the tool descriptions, `show_pane`, `send_file`, the renderer's card, lineage, the index.

**Proves:** acceptance 7. Tests: `artifact-scope.test.ts` (a root and a fork answer `[]`; a thread its parent; a `/btw`-promoted thread (`openedBy: 'btw'`) its parent; a thread of a thread `[parentThread, root]`; a thread whose parent thread is a fork's side thread stops at that fork; a missing parent ends the chain; a cycle and the 16-link cap). `artifacts.test.ts` extended with two sessions on one `SessionChains` and one memory or temp-dir store: the thread updates the parent's artifact (the parent's record gains v2, the result names `ownerAppSessionId`, nothing under the thread); list order and marks; screenshot's capture request carries the owner; create of an ancestor's id refused with the exact text; two concurrent updates (parent and thread, the first held on a deferred copy) yield v2 then v3 in call order with both copies present; a root session's behaviour byte-identical to today's (results without the field). `launcher` test: two sessions of one launcher share the chain. Main tests: the intent launch and the resume of a side thread send `artifactScope`; a root's launch sends none. `normalizer` test: the event copies the field; `derive` tests: the row carries the owner from the event, and from the tool result alone with no event (the disk path); `Artifact` view test: Open goes to the owner. `capture` test: the record is read from the owner and the answer routed by the requester. Wire fingerprint: its pinned value, if a test pins one, is updated with a note. M4's end-to-end proof is M5's case 12, which needs M2's card; M4 adds no e2e case of its own, so it shares no file with M2 and M3 while running beside them.

### M5 — End to end

**At its end:** every acceptance item observed on the branch head; the e2e groups this child touches and the neighbours it could break green; the live case reworked and run once; both themes shot; the whole-branch review closed.

**Touches:** `e2e/side.spec.ts` case 12 (replay, after M2 and M4: `SideJournal` gains `mawsToolCall(name, input, answer)`, an assistant `tool_use` of `mcp__maws__<name>`, the engine's `mcp_message` `tools/call` and its `tool_result`, the frame shapes borrowed from `pass3/p1-maws-artifacts.jsonl`; the replay transport answers host responses by request id only, so the real host serves the call against the seeded record; the HTML file is rewritten under the scratch repository root, which `SideJournal` makes the init's cwd, before the call is allowed; the thread updates the parent's seeded artifact: the parent's viewer shows v2 with the card still open and re-pinned, the thread's row "Updated artifact … · v2" in the card shows v2 in the same viewer, the parent's record lists two versions and the thread's deliverables directory has none) and case 8 (themes) extended with the card's phases, the inline request card and the needs-you strip; `e2e/p1-live.spec.ts`: `pickTitle` returns the card (the sheet's accessible names hold, D5), case 2 (the thread answers in the card; a permission the thread raises is answered in the card itself by the existing `drive` scoped to `[data-comment-card]`; the thread's prompt also asks it to change the title text and call `artifact_update` on the artifact's id; the parent's record gains the next version; the card shows the reply containing `ANCHORED`; the parent's turns and written prompts unchanged) and case 3 (Send to main from the card, otherwise as today); evidence under `docs/doperpowers/evidence/p2-e1/` (`gates.txt`, `live.txt`, `shots/`).

**Decisions:** the live run uses the existing allocations (`FORK_ALLOCATION_USD` for case 2, case 3's own) and a scratch config home as P1's live cases do; one run of cases 1 to 3 (case 1 creates the artifact the others comment on); cost and outcome go to `live.txt`. If the engine on the machine differs from `TESTED_ENGINE_VERSION`, record both.

**Proves:** acceptance 1 to 8 together (Concrete Steps), and §2 item 5's card half on the integrated branch.

### Concrete Steps

Working directory: the executor's worktree (`git rev-parse --show-toplevel`), written `<wt>` below. Every e2e group runs alone through the slot:

```
pnpm -C <wt> typecheck                      # exit 0
pnpm -C <wt> lint                           # exit 0
pnpm -C <wt> test --maxWorkers=4            # all files pass; the new files named per milestone among them
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <wt> e2e:deliverables
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <wt> e2e:side
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <wt> e2e:code              # the gutter's sheet unchanged
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <wt> e2e:browser-comment   # the browser's sheet unchanged
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <wt> e2e:transcript        # the transcript options inert by default
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C <wt> e2e:panel
```

Expected: every group reports its full count passed (record the counts in `gates.txt`; `e2e:side` gains cases 9 to 12, `e2e:deliverables` keeps its count with the comment case reworked). The live cases, once, at M5: `pnpm -C <wt> e2e:p1-live --grep "^(1 artifacts|2 a comment|3 Send to main)"` with the scratch home the spec's harness sets (case 1 creates the artifact cases 2 and 3 comment on); expected "case 2: PASS" in its note with the thread's lineage, its reply containing `ANCHORED` drawn in the card and the parent's record one version longer, case 3's steer drawn as the anchored prompt row, and the spend within the allocations.

Manual check (owner-equivalent, on `pnpm -C <wt> dev`): D1's scene end to end, including a narrow panel (the docked fallback) and a dark-theme pass.

## Files touched

| Area | Files | Milestone |
|---|---|---|
| Seam | `src/renderer/src/tools/code/anchor/anchor.ts` | M1 |
| Card | `src/renderer/src/side/card/{store,placement,CardHost,CommentCard,thread}.ts(x)` (new), `src/renderer/src/side/{register,actions,copy,CommentComposer,ThreadView}.ts(x)` | M1, M2, M3 |
| Viewer | `src/renderer/src/tools/deliverables/{Viewer,DeliverablesTool,DeliverableTab}.tsx`, `frames/HtmlFrame.tsx`, `comment/pick.ts` | M1, M3 |
| Bridge | `src/main/deliverables/bridge-script.ts` | M3 |
| Transcript | `src/renderer/src/transcript/view/{TranscriptSlot,Transcript,context}.tsx`, `surface/Rows.tsx` (marked block), `src/renderer/src/owner/to-human/Presenter.tsx` | M2 |
| Visibility, navigation, message return | `src/renderer/src/session/visibility.ts`, `src/renderer/src/attention/navigation.ts` (a marked block each), `src/renderer/src/sessions/message-return.ts` (`holdMessageReturn`) | M2 |
| Replay harness | `e2e/support/side-replay.ts` (`permission`, `mawsToolCall`) | M2, M5 |
| Scope (main) | `src/main/sessions/artifact-scope.ts` (new), `setup.ts`, `resume.ts`, `src/main/deliverables/capture.ts` | M4 |
| Scope (host) | `src/engine-host/{ipc,launcher,session,session-maws,normalizer-controls}.ts`, `tool-server/{tools,artifacts}.ts`, `deliverables/store.ts` | M4 |
| Shared shapes | `src/shared/ipc/schema/session.ts`, `src/shared/ipc/schema/maws.ts`, `src/shared/maws/tools.ts`, `src/shared/graph/events.ts` | M4 |
| Artifact row | `src/renderer/src/transcript/model/{rows,derive}.ts` (and `reduce.ts` if it copies event fields), `view/rows/Artifact.tsx` | M4 |
| Tests | the unit files named per milestone; `e2e/deliverables.spec.ts`, `e2e/side.spec.ts`, `e2e/p1-live.spec.ts`, `e2e/support/*` helpers as needed | all |
| Evidence | `docs/doperpowers/evidence/p2-e1/` | M5 |

## Risks

- **P2-0 slips.** M2's Reply needs the seam. Mitigation: M1, M3 and M4 do not wait; M2 starts when `send-human-prompt.ts` is on master. If P2-0's final signature differs from the ledger's, M2 adapts at its start (one call site).
- **P2-C lands first, or second.** Both touch `Rows.tsx`. Mitigation: E1's change is one marked block keyed to a context option; C's module replaces what the option selects; the second to land adapts (ledger §6).
- **The forced presenter shows less than the surface.** A plugin mod's other rewrites of assistant text do not draw in the card. Accepted: the card is compact and MAWS owns the owner channel (§4.6); the full view is one click away.
- **A stalled thread unseen.** The card drops `SessionPane`'s docked request and setup cards (parent §8). Mitigation: requests draw inline in the card's thread (C7's inline card) and the needs-you strip names every tier-1 kind and the setup states with one click to the full view; once the card closes, the Needs-you list and notifications navigate as for any thread.
- **C7's inline request card at 300 px.** Built for a transcript column; a long plan or a form may be cramped. Mitigation: M2's e2e asserts Allow inside the card's box; M5's shots in both themes show it; the strip's Side pane link remains for any kind that proves unusable, and P2-F's taste sitting sees it beside Desktop's card.
- **A version written by a thread renders as "registering" on an older build.** An older normaliser's strict parse of an `artifact_update` answer carrying `ownerAppSessionId` fails, so a journal rebuilt by an older build of the owner's (development and packaged builds share `userData`) shows that one row without its version. Mitigation: the field appears only on an ancestor's artifact; the record itself is unchanged and readable by every build.
- **The wire fingerprint changes** (D10). An older detached supervisor reads as another wire until replaced; E10 handles it; P2-C changes the same command in the same phase.
- **A page answering locate with nonsense.** The clamps bound any rect; a hostile page could only misplace the card inside its own viewer.
- **Viewer.tsx contention with P2-F's first wave.** Mitigation: E1's changes are confined to the HTML body's container, the pick and the props; F's are the image and video bodies.
- **Load on the machine.** One e2e group at a time through the slot; the live case once.

## H. Hand-back to the architect

### H1. Ledger proposals (P2 interface ledger)

§5 X21, replacing the first row's text:

> `openCommentComposer(anchor, {appSessionId, placement?})` with `CommentPlacement = {kind: 'card', host: 'deliverable' | 'browser', hostId?: string, rect?: {x, y, width, height}} | {kind: 'sheet'}` (`src/renderer/src/tools/code/anchor/anchor.ts`; `rect` in the host frame's viewport CSS pixels, from the pick message, never on the X10 anchor; `hostId` the producing view's host). `CommentCard`, `CommentCardHost({hostId, host, mode, layout: 'anchored' | 'docked', accepts, frame: {scale, offset, key, locate?, showVersion?}, visible})`, the store `useCommentCard` (`openCard` with an optional `claimMode`, `claimCard`, `closeCard`, `cardGone`, `targetOf`, `CLAIM_DEADLINE_MS`) and `placeCard` in `src/renderer/src/side/card/`. `CardTarget` reserves a `{kind: 'browser', …}` member for P2-E2, which adds a host with its own `accepts` and passes `placement` from the browser comment connect. The bridge's `maws:locate {selector}` → `maws:located {selector, rect | null}`. Owner P2-E1; consumer P2-E2.

§5, the X9 row:

> A side thread's `artifact_list`, `artifact_update` and `artifact_screenshot` resolve over its own artifacts, then its side-thread ancestors' to the family root, nearest first (`artifactScopeOf` in `src/main/sessions/artifact-scope.ts`, sent as `session.launch {spec, artifactScope?: AppSessionId[]}`, a sibling of the spec, never stored); `artifact_create` refuses an ancestor's id (`TOOL_ERRORS.artifactExistsInParent`); results naming an ancestor's artifact carry `ownerAppSessionId`, as do `maws.artifact.capture` and `maws.delivery.artifact`; one `SessionChains` per host process serialises every session's writes to a record on its owner's chain. X12 versions so written belong to the ancestor's record, which gains no field.

§5, the forced-presenter row:

> `TranscriptSlot`/`Transcript` options `startAt?: (rows, loaded) => number | null` and `presentation?: 'local'` (on the transcript context), and `TranscriptSlot`'s `actions?` override; `Presenter`'s drawing `answerable?: boolean`. P2-C's module replaces what `presentation: 'local'` selects. Also `holdMessageReturn(appSessionId, fn)` in C10's `src/renderer/src/sessions/message-return.ts` (a per-session claim on a failed start's returned message).

§1: `session.launch` input gains `artifactScope?` (P2-E1; a host-wire change, E10's fingerprint).

§6, shared files: `src/renderer/src/transcript/surface/Rows.tsx` (C; E1 one marked block in `useAssistantInput`); `src/renderer/src/session/visibility.ts` and `src/renderer/src/attention/navigation.ts` (E1, one marked block each); `src/renderer/src/sessions/message-return.ts` (E1, one additive export); `src/renderer/src/tools/deliverables/Viewer.tsx` (E1 the HTML body's host and the pick; F's first wave the image and video bodies); `src/shared/ipc/schema/session.ts` (E1 the `session.launch` input); a dated exception: E1 adds `ownerAppSessionId` inside E2's `maws.delivery.artifact` entry in `src/shared/graph/events.ts` and inside E2's result schemas in `src/shared/maws/tools.ts`.

§4, versions: P2-E1 takes none (confirmed).

### H2. Charter lines at E1's landing (§13 and §19)

- **X10** (dated line appended): "<landing date> (P2-E1): the one composer gains a second presentation behind the same seam. `openCommentComposer(anchor, {appSessionId, placement?})`: a `{kind: 'card'}` placement opens the comment card (X21) in the producer's host, beside the element; `{kind: 'sheet'}` or none opens the sheet (the code gutter, PR lines, browser pages until P2-E2). The destination control, both sends, the anchor and its serialisation are unchanged."
- **X9** (sentence appended): "Since P2-E1, a side thread's `artifact_list`, `artifact_update` and `artifact_screenshot` resolve its own artifacts, then its side-thread ancestors' up to the family root, nearest first; `artifact_update` on an ancestor's id writes that ancestor's next version; `artifact_create` refuses an id an ancestor holds; a result naming an ancestor's artifact carries `ownerAppSessionId` (the owner's decision of 2026-10-08, P2 Decision Log 9)."
- **X12** (replacing "Artifacts are registered per session: a comment's side thread cannot update its parent's artifact (a design boundary, tracker 2026-10-08)."): "Artifacts are registered per session and seen by that session's side threads (A-39's rule applied to artifacts, P2 Decision Log 9): a version a side thread writes belongs to its ancestor's record, appended in arrival order on that record's write chain, which every session in the engine host shares."
- **§19**: "<landing date> (architect, P2-E1 landed): … E3's design line 'The composer is a sheet; the pane never switches the main view' (E3 document line 46) and Design 6's thread view as a comment's only view are superseded for producers with a host: a comment on an artifact element opens the comment card beside the element and its thread lives in the card; the Side pane lists the thread and hosts it on request ('Show in deliverable' re-docks it); the sheet stays for the code gutter and PR lines, and for browser pages until P2-E2."

### H3. Tracker

- Close the row of 2026-10-08 (E2 · E3) "Design boundary: a comment's side thread cannot update the artifact it comments on" with: "Closed by P2-E1 G4 (the owner chose the family-shared registry, P2 Decision Log 9): `artifacts.test.ts`'s thread-update and concurrency cases and `e2e/side.spec.ts` case 12; live in `p1-live` case 2 (`docs/doperpowers/evidence/p2-e1/live.txt`)."
- Rows E1 expects to add (debt, not blocking): the card does not follow the artifact's scroll (a stored, content-anchored pin is P3); a reply's explicit delivered mark (Desktop's "Sent to Claude") not shown, the transcript's rows standing in; `show_pane` with a deliverable target from a side thread still names only the thread's own deliverables.

### H4. Parent Decision Log lines (proposed, under P2-E1)

- "<landing date> (P2-E1, residue): the pick's rect rides the placement hint, not the X10 anchor (the anchor is agent-facing and persisted); a re-docked card finds its element by selector (`maws:locate`). The side-thread artifact scope travels as a sibling of the launch spec (never stored), resolves over the ancestor chain nearest first, includes `artifact_screenshot`, and refuses `artifact_create` of an ancestor's id; one write chain per host process. Send to main from the card stays `side.sendToMain` (main builds the content and applies X22's policy); acquisition for it lands inside main's `sendToMain` with P2-A. The thread's requests are answered inside the card through C7's inline request card, the needs-you strip pointing to the full view beside them."

### H5. Notes for siblings

- **P2-0:** the card calls `sendHumanPrompt(child, text, {origin: 'comment'})` without `display`, where no composer of the child is mounted (the card closes when the Side pane or a main tab draws the thread); it reads only the disposition and the reason, and catches the seam's throw on a host error as a refusal. It does not call `waitForHumanPromptDelivery`: queued and delivered are drawn by the transcript's held rows and user rows.
- **P2-A:** acquisition for Send to main stays in the renderer's shared comment form before `side.sendToMain` (A's §5.6; corrected by the architect 2026-10-09, spec Decision Log 18), which the card shares with the sheet through the extracted form hook; nothing acquires inside main's `src/main/side/send-to-main.ts`. An acquisition that reuses `runResume` (`src/main/sessions/resume.ts`) carries a side thread's `artifactScope` with no change of A's; a launch path that bypassed it would need to pass the scope as it passes `browserBackend`.
- **P2-C:** `presentation: 'local'` is the switch your module takes over inside the card; `answerable` tells a presentation that a Reply field sits under it (a `need-input` card's own Reply and choices then apply inside the card too). The card's needs-you strip ignores `async_input` and `essential_unread`, since the card's rows and Reply carry them; if you add them to `ACTIONABLE_KINDS`, that rule keeps them out of the strip.
- **P2-E2:** add a `CommentCardHost` with `layout: 'docked'` in the browser pane, a `CardTarget` browser member with its `accepts`, and pass `placement: {kind: 'card', host: 'browser', hostId, rect}` from `tools/browser/comment/connect.ts` (`rect` from your `position` field when present); nothing in the card changes.

### H6. Open questions for the architect (each with the recommendation taken; nothing here blocks execution)

> Answered by the architect 2026-10-09 (the P2 spec's Decision Log 18; the ledger's §1, §5 and §6 rows record the names): items 1 to 8 as recommended, with one correction to H5's note for P2-A: acquisition for Send to main stays in the renderer's shared comment form before `side.sendToMain` (A's §5.6), inherited by the sheet and the card alike; nothing acquires inside main's `sendToMain`.

1. **Send to main and §4.3's letter.** §4.3 lists Send to main among the seam's callers; §4.7 says both sends are unchanged. Taken: Send to main stays on `side.sendToMain` (main builds the image block under its root checks and already applies X22's steer-or-send), the card mapping its answer to X22's dispositions, and P2-A adds acquisition inside main's `sendToMain`. Alternative if you hold to the letter: a main read that builds the comment content (`side.comment.content`) and the renderer sends it through the seam, at the cost of shipping the screenshot's bytes through the renderer.
2. **The re-dock control.** Taken: "Show in deliverable" in the Side pane's thread header beside "Open as tab". Alternative: an icon on the thread's chip (the parent's wording "its chip re-docking the card"); the chip is 220 px wide and already a selection target.
3. **The card's height in thread phase.** Taken: the placement's max height, fixed (the virtualised list needs a bounded box). Alternative: grow with the content up to the max (Desktop's), which needs a measured list height; worth it if the owner finds a one-reply card too tall.
4. **Requests answered inside the card, and the strip's look and copy** (D6). Taken: C7's inline request card draws in the card's thread and answers there, with a one-line strip (glyph, text, two buttons) above Reply as the pointer to the full view. The parent's text reads as if the strip were the only route ("one click to the Side pane or a tab"); answering in place is what keeps the card open through a default-mode permission. Worth showing the owner at P2-F's taste sitting beside Desktop's card, which has no permission prompts inside its card.
5. **No Side tab on a card send.** Taken: none added, active or inactive; the summary row, the sidebar and the Side pane's listing are the trail. Alternative: add it inactive for discoverability.
6. **`artifact_screenshot` and the create refusal** go beyond the parent's literal "update and list" (D10's reasons). Confirm, since X9's exact texts change only by a dated line.
7. **The ancestor chain rather than the root alone** for a thread of a thread (D10). Confirm the reading of "resolves through the family root".
8. **The rect's home (D2) against X21's binding text.** The ledger row and G2 say `artifactElementAnchor` keeps the rect; D2 keeps it on the placement instead (the anchor is agent-facing and persisted). Record the reading (H1, H4) before P2-E2 is dispatched against X21.

## Surprises & Discoveries

- Observation: each engine session builds its own `FileDeliverableStore`, so the store's per-session write chain is per session object; a parent and its thread writing one record would not be serialised without a shared chain.
  Evidence: `src/engine-host/launcher.ts`, the `EngineSession` options: `deliverables: (onWritten) => new FileDeliverableStore(deps.userData, { onWritten })`; `src/engine-host/deliverables/store.ts` `private readonly chains = new SessionChains()`.
- Observation: the stored launch spec is write-only: nothing reads it back, yet its strict schema still makes an older build move the whole state file aside. A field that rides beside the spec in `session.launch` avoids the hazard entirely.
  Evidence: `loadLaunchSpec` is defined in `src/engine-host/store/file-session-state-store.ts` and `memory-session-state-store.ts` and called nowhere else; `session.launch` is `host(z.strictObject({ spec: LaunchSpecSchema }), …)` in `src/shared/ipc/schema/session.ts`.
- Observation: X10's anchor already carries a `box` (E4d), but it is serialised into the agent's `<maws_anchor>` tag and requires whole document pixels; the pick's rect is fractional viewport pixels. Putting the rect on the anchor would change every artifact comment's agent-facing bytes.
  Evidence: `src/shared/anchor/message.ts` `TAG_FIELDS = [… 'box']`; `src/shared/anchor/anchor.ts` `AnchorBoxSchema` (`int()`, `positive()`); `src/main/deliverables/bridge-script.ts` posts `getBoundingClientRect()` values.
- Observation: the Side store's `shownChild` drives read-state, attention navigation's "request on screen" and "hosted in the Side pane" (read by `/btw`'s inline questions), so the card publishes its thread through a field of its own and is added explicitly to the first two.
  Evidence: `src/renderer/src/attention/navigation.ts` `requestOnScreen`: `if (panelOpen && shown !== null && sideChildrenShown().get(shown) === appSessionId) return true;`; `src/renderer/src/side/store.ts` `hostedInSidePane`; `src/renderer/src/side/btw.ts` line 17.
- Observation (the document's review): a transcript with no composer draws C7's full inline request card for every open request, so the card's thread answers permissions in place; the first draft's "the card does not draw the request card" was false as built, and suppressing it would have closed the card at every default-mode permission.
  Evidence: `src/renderer/src/request-card/inline.tsx` `SlotCard`: `if (docked) return <InlinePointer …/>; return <RequestCard item={item} request={null} placement="inline" paneIndex={null} />;` with `docked` true only while a composer of the session docks the request; `TranscriptSlot.tsx` passes the registered renderer.
- Observation (the document's review): a session without a live stream reads its events from disk with no host events, so a row that relies on `maws.delivery.artifact` alone loses what only the event carries.
  Evidence: `src/renderer/src/transcript/model/derive.ts` `resultOfArtifact` fills `deliverableId`, `version` and `title` from the parsed tool result when no event announced them.
- Observation: main's `side.sendToMain` already implements X22's policy server-side (steer `next` while a turn runs, send when idle, `queued` from the host queue).
  Evidence: `src/main/side/send-to-main.ts` lines 20-26.
- Observation: Desktop's card placement is a pure function of the frame rect and a click point, with constants 300 (width), 320 (room below that never flips), 240, 48 and a max height of `max(320, 60 % of the viewport)`.
  Evidence: `~/claude-desktop-re/readable/app-2.16120.0/web/app/v1/frame-shell-chrome-CXu04DiJ.js:17530-17583` (`RT = 320, zT = 48, BT = (RT * 3) / 4`, `function GT`, `function VT`).
- Observation: a change to any host-wire `strictObject` changes E10's wire fingerprint, so `session.launch`'s new field is a wire change.
  Evidence: `src/shared/ipc/wire-fingerprint.ts` header: "one changed `strictObject` on the wire changes it".
- Observation (M1): a header line that appears while picking reflows the frame, so the rect a pick reports is stale by the line's height once the line disappears; any viewer chrome that changes height with picking moves the page under a stored pin.
  Evidence: e2e:deliverables run 2 at 41e7f758, a card above a fixed footer at 749 against 773; fixed in 22bf6e3b by floating the hint.

## Decision Log

- Decision: the verification call. This document gets one independent review round by the `doperpowers:adversarial-reviewer` agent on Opus (the astra route limited until 2026-10-13, P1 P-26), covering the design residue and the execution section's buildability together; findings are verified against the code and folded or dismissed with a reason. Execution runs under `doperpowers:subagent-driven-execution` with a task review at each milestone boundary (M4's review before M5 consumes it); the branch ends with `doperpowers:reviewer-high` (on Opus while astra is limited), since the change alters X9's semantics and the host's write serialisation beside a renderer surface.
  Rationale: a plan child with five milestones, a host-side contract change and a new UI surface; P1's children of the same grain took the same council (E3, E4d).
  Date/Author: 2026-10-09, P2-E1 author.
- Decision: residue rulings R1 to R14, recorded where they shape the design: R1 the rect on the placement, not the anchor (D2); R2 one card per window, latest wins (D3); R3 hosts claim unhosted cards by target (D3); R4 the close rules, including closing when the Side pane or a main tab draws the thread (D3); R5 Desktop's placement adapted to an element rectangle, never hidden, a docked fallback under 200 px (D4); R6 one form logic shared by the sheet and the card, `sendComment`'s `reveal` option (D5); R7 Send to main stays `side.sendToMain` (D5, §H6 item 1); R8 the thread through `TranscriptSlot` with `startAt` and `presentation: 'local'`, no delivery state in the card, `queued` shown by the transcript's held rows (D6, the coordinator's X22 amendment of 2026-10-09); R9 the needs-you sources, precedence and copy (D6); R10 the card's own visibility signal, never `shownChild` (D6); R11 re-dock in the thread header, no Side tab on a card send (D7); R12 the bridge's locate and re-pin across frame swaps (D8); R13 the artifact scope's transport beside the spec, the ancestor chain nearest first, screenshot included, create refused, descriptions unchanged (D10); R14 one write chain per host process (D10).
  Rationale: each section carries its reason and the alternative rejected.
  Date/Author: 2026-10-09, P2-E1 author.
- Decision: the document's adversarial review round folded (Opus; 1 blocking, 6 should-fix, 7 minor; every finding verified against the code; none dismissed). Changed: requests are answered inside the card through C7's inline request card, the strip now a pointer beside it (D6, acceptance 4, Purpose); the card's requests count as on screen for attention navigation (D6, acceptance 5); `resultOfArtifact` carries the owner on the disk path (D10, M4); the card keeps the sheet's accessible names and live case 3 is reworked and run with case 2 (D5, M5); a `started` reply has a pending bubble and its failed start returns the text to the card through `holdMessageReturn` (D6, acceptance 3); a thread whose card closed before the fork answered is revealed as the sheet does (D5, acceptance 5); unclaimed re-dock cards carry `claimMode` and close after `CLAIM_DEADLINE_MS`, and "Show in deliverable" hides while a main tab shows the thread and opens the latest version (D3, D7); the ink sharing documented and pinned (D6); the card's row Open routed to its own viewer's version (D6, D10); placement's minimum height 120 and the docked threshold 160 (D4); locate's load and handle plumbing and `CardFrame.key` named (D8, D9); a fallback strip text and C's two kinds excluded (D6); proofs added for the main-tab host and re-pin on a version switch (M1, M3); e2e case ownership assigned, case 12 moved to M5, the replay harness's two methods named (M2, M5); the rect's departure from X21's text made an explicit gate for the architect before P2-E2 (Constraints, §H6 item 8).
  Rationale: the blocking finding changed the card's core flow (a default-mode permission would otherwise have closed the card in the Purpose scene); the rest closed gaps an executor would have hit.
  Date/Author: 2026-10-09, P2-E1 author.

- Decision: refresh pass at execution start. Parent re-pinned to blob a7e7d4cf1084 (spec Decision Log 16 to 20 now present: 18 answers this document's H6, items 1 to 8 as recommended), ledger to blob 226bb2586cef (its §1, §5 and §6 rows record this document's names unchanged). One correction folded: acquisition for Send to main lives in the renderer's shared comment form before `side.sendToMain` (A's §5.6), not inside main (D5, H5). X22's final shape (A's M1, spec Decision Log 17: `started: boolean` beside a `sent | steered | queued | held | refused` disposition) is noted for M2: the card reads P2-0's interim `started` disposition as landed and treats the final shape's `started: true` with `sent` or `queued` by its disposition, a `held` like `refused` (the card is not the composer origin).
  Rationale: the document was written against 7462fe28; the parent and ledger moved since, with no code change under src or e2e.
  Date/Author: 2026-10-09, P2-E1 executor.
- Decision: M1's executor decisions, folded. `CommentCardHost` takes an optional `restoreFocus?()` (focus return to the viewer's Comment button, else the frame; proposed for X21's row); the host checks `claimMode` against its own `mode` and the viewer's `accepts` checks only the record; `DeliverableTab` keeps `visible` true by default (the pane mounts only the active tab); the host is mounted only for an HTML body; a card is closed on host unmount after a microtask, so StrictMode's effect replay does not close it; `openCard` without a card placement takes the target's kind as its host; only the rect's four numbers are kept; `cardGone` lands in M1, `enterThread` and `shownThread` in M2. The form logic lives in `src/renderer/src/side/comment-form.ts` (`useCommentForm`) with its parts in `side/CommentFormParts.tsx`; P2-A's acquisition block for Send to main therefore goes in `useCommentForm`'s `send`, at the marked place before `sendComment`, not in `CommentComposer.tsx` (hand-back: ledger §6's line for A). The picking hint now floats as a pill over the body's top instead of a header line (a header line reflowed the frame by 24 px on pick, so a pick's rect went stale; a card above a bottom element sat 28 px off).
  Rationale: each keeps D3 to D5 and D9 as designed; the hint's move is the one visible change to E2's viewer, required for acceptance 1's 4 px.
  Date/Author: 2026-10-09, P2-E1 executor (M1).
- Decision: M3 also re-pins through `locate` when the host box resizes (not only on claim and on `CardFrame.key`), since a stored rect goes stale on any reflow of the frame (an element fixed to the frame's viewport moves with the frame's height). D4's "re-placed from the stored rect on resize" stays the fallback when no `locate` is available.
  Rationale: M1's executor observed the stale rect directly (e2e run 2); one extra locate per resize is cheap and the clamps already bound any answer.
  Date/Author: 2026-10-09, P2-E1 executor.

## Outcomes & Retrospective

Pending — written at finish.
