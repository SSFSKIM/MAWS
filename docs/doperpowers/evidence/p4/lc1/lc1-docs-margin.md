# LC-1 — Google Docs' comment margin, measured (P4-B1)

Run: 2026-10-19 PDT (2026-10-20 UTC), owner's Chrome, profile Default (the owner's Google account), one tab of its own via the Playwright extension.
Approval: P4 Decision Log 25 (`docs/doperpowers/plans/2026-10-19-p4-smoothing.md`).
List measured: B1's "LC-1 — Docs' margin geometry" (`docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md` at e57a0fb91).

## Environment log
- 19:52 attached; Docs UI language Korean (ko); page size A4 (21 cm, 793 CSS px at 100 %).
- 19:57 folder "MAWS UX check" created at My Drive's top level (a search for it found none before). Test document created in it.
- 19:59:34 the Mac's screen locked (ioreg CGSSessionScreenIsLocked=Yes, frontmost app loginwindow). The tab went `hidden`: requestAnimationFrame stopped (0 frames in 8 s) and Chrome's intensive timer throttling set in (a 10 ms setTimeout chain did not finish 8 steps in 90 s).
- 20:19:13 the owner unlocked the Mac; the tab rendered again (120 frames/s, ProMotion) and work resumed: the owner's view state read, the document written, 12 comments made.
- 20:31 the display slept after 10 min without HID input (`pmset displaysleep 10`) and the screen locked again; the page then froze (every `Runtime.evaluate` hung). First hand-back at 21:08.
- 04:53Z (resumed) the coordinator had started `caffeinate -d -t 4500` at about 04:35Z with the owner at the Mac; the tab drew at 120 frames/s without a reload. Items 2, 3, 6, 7 (Hide, Minimize) and 9 were run under the 1920 × 1080 emulation (item 2 at the owner's 1512 width), then the clean-up from 05:29Z. Input through the extension slowed sharply from about 05:15Z (a typed character took seconds), which cost items 4, 5 and 8.

## Setup as built
- Viewport: the owner's window as it is, 1512 × 723 CSS px at devicePixelRatio 2 (the brief's 1920 × 1080 emulation not yet applied). Zoom 100 %. Print layout on, ruler on, the document-tabs sidebar open (Docs' default for a new document). UI language Korean.
- Page: `.kix-page-paginated`, A4, 794 CSS px wide. Text Arial 11 pt, line spacing 1.15: line pitch 19.5 px, caret height 16.86 px (a Heading 1 caret 30.66 px).
- The margin's DOM: Docs draws text and highlights on a canvas, but the comment margin is DOM. Cards are `.docos-anchoreddocoview` (class `docos-anchoreddocoview-active` while active), absolutely placed by inline `left`/`top` inside `.kix-discussion-plugin` (`left: 1096px; top: 15px`), which sits inside the editor's scroller `.kix-appview-editor` (so the cards scroll with the page natively). Off-screen cards are `display: none` but keep their laid `top` (Docs virtualises the column). The anchor line's top is read from the caret (`.kix-cursor-caret`) placed at the passage's first character; the highlight's top from screenshot pixels.
- Passages (one document, page 1–2): three consecutive one-line paragraphs (Alpha, Bravo, Charlie); a one-line passage; a passage wrapping three lines; a passage spanning two paragraphs; a Heading 1; a bulleted list item; the right-hand cell of a 2 × 1 table; a passage beginning at the first word of a paragraph's second visual line (a soft wrap); an image (inserted through Insert › Image › Web search); spare passages for items 5 and 9. Page 3 has a line for item 3 mid-page; page 4 ends with a line for item 4's ten comments. Page 1's first line is reserved for item 4's six comments (not yet commented, so it pushes nothing).

## Results

### 1. Card top against the anchor (confirms `passageRect`'s first-line rule)
State: each passage commented once, no card active, cards not pushed (each card's top is more than its predecessor's bottom + the gap).
Measured: card top − the passage's first line top (caret top at its first character, in `.kix-discussion-plugin` coordinates; the caret's top is an integer, so ±0.5 px):

| State | Line top | Card top | Difference |
|---|---|---|---|
| one-line passage | 427 | 430.72 | +3.7 |
| passage wrapping three lines | 562 | 566.48 | +4.5 |
| passage spanning two paragraphs | 756 | 760.43 | +4.4 |
| starting in a Heading 1 | 938 | 942.26 | +4.3 |
| bulleted list item | 1308 | 1311.58 | +3.6 |
| table, right-hand cell | 1917 | 1920.83 | +3.8 |
| beginning at a soft wrap (2nd visual line) | 1463 | 1466.74 | +3.7 |
| block comment on an image | — | — | not measured (see below) |

Screenshot check (one-line passage, `10-item1-oneline-card-and-selection.png`, 2× pixels): the selection's highlight spans CSS y 518.5–538.5 (the full 20 px line box) and the card's visible top edge is at 522.5, so card top − highlight top = 4.0 px; the caret's top coincides with the highlight's top within 0.5 px.
Finding: Docs puts every card's top 4 px (3.6–4.5) below the top of the passage's first line box, whatever the line's font size (the heading's 31 px caret gives the same +4), the block it starts in (list, table cell) or whether the passage runs over lines or paragraphs. The soft-wrap passage's card sits on the line holding the passage's first character (the paragraph's second visual line: its caret top 1463 is one line pitch, 19.4 px, below the paragraph's first line, which the neighbouring paragraphs' anchors put at about 1443.5), not on the line before the wrap. `passageRect`'s first-line rule is confirmed; Docs adds a constant +4 px.
Evidence: `11-anchors-caret-tops.json`, `12-cards-tops-20-31.json`, `10-item1-oneline-card-and-selection.png`.
Not measured in item 1: the block comment on an image. The image was inserted (Insert › Image › By URL kept its Insert button disabled for two public URLs; Web search worked), but the screen locked before it was commented.

### 2. Gap, active shift, animation (re-bases `MARGIN_GAP_PX`, `MARGIN_ACTIVE_SHIFT_PX`, 200 ms and its easing, edit-caused moves) — resumed run, 04:53Z on
State: Alpha, Bravo, Charlie commented on three consecutive lines, no card active (caret on a blank line); then Bravo's card clicked; then a paragraph typed above the three, then one Enter. Measured with a requestAnimationFrame sampler (120 frames/s) reading every card's rect and inline `top`, and `document.getAnimations()` for the transitions Docs creates.
- **Gap: 10 px** in both walks. Upward (Charlie pinned): tops 30.16, 143.16, 256.16 with 103 px cards. Downward (Bravo active, its card grown to 157 px by its reply field): Charlie's top = Bravo's top + 157 + 10 (403.77 = 236.77 + 167).
- **Active shift: 0 px.** The active card keeps `left: 25px` and x = 1121 (1222 at 1920 wide); Docs marks it by a white raised surface with a shadow (inactive cards are tinted grey), a darker highlight on its passage, and the reply field it grows. No horizontal offset at all (`20-item2-bravo-active.png`).
- **Animation: `top` 350 ms `ease`.** Every card carries `transition: top 0.35s` (computed easing `ease`), and the activation created a `CSSTransition` on `top`, duration 350, easing `ease`. Charlie's sampled path on Bravo's activation: 441.8 → 495.8 from t = 19 ms to 368 ms, 78 % of the way at 167 ms (CSS `ease` gives 0.80 at x = 0.48). The reply field's button row fades in by an `opacity` transition 250 ms `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Edit-caused moves animate, after a delay.** Typing above: no card's `top` changed while typing; about 600 ms after the last key (one Enter pressed at t ≈ 200 ms, `top`s rewritten at t = 822 ms) the cards below moved with the same 350 ms `ease` transition. And cards that were already above their new anchors did not move at all: after three lines were inserted above, Alpha stayed 152 px above its passage (see item 3).
Evidence: `20-item2-activation.json`, `20-item2-bravo-active.png`, `21-item2-edit-above.json`, `21-item2-after-typing-above.png`, `22-item2-enter-above-timeline.json`, `12-cards-tops-20-31.json`.

### 3. Deselect (re-bases D2's relax-versus-stay)
State: six comments on one passage ("Sixline carries", page 3, anchor 3865), the last (c-s6) clicked active, so the stack is walked up from it: tops 3303.51, 3416.51, 3529.51, 3642.51, 3755.51, 3868.51. Then a click on an uncommented blank line five lines above (caret at 3768, no card active).
Measured: after the click every top is unchanged (read at 05:16Z). **The stack stays where the active pin left it; Docs does not relax to the downward walk.** The same holds for the Alpha/Bravo/Charlie stack across two runs and for edits above it (item 2).
Evidence: `42-item3-deselect.json`, `40-item3-six-last-active.png`, `41-item3-after-plain-click.png`.

### 4. Overflow
Not measured (stopped for the clean-up at 05:29Z). Item 6's sweep and item 3 bear on it: the column is part of the editor's scroll content, and below the least card width it overflows sideways (horizontal scrolling) instead of shrinking further.

### 5. Keys and the caret (re-bases D5's caret rule, Esc and U)
Not measured as specified (arrow keys into and out of a passage; Esc then U on a focused card). What there is: putting the caret inside a passage by keyboard (⌘F, Escape, which selects the match, then ArrowLeft) made its card active in 10 of 12 passages within 350 ms; the two that did not had the caret on the first character of a passage that does not start its paragraph. Clicking a card puts the caret at its passage's start and activates it; a click on an uncommented blank line clears the active card (item 3).
Evidence: `11-anchors-caret-tops.json` (`active` per passage), `20-item2-bravo-active.png`.

### 6. Narrow widths (re-bases `CARD_MAX`, `CARD_MIN`, the icon breakpoint, and settles the 26 px gutter and the page shift)
State: the 1920 × 1080 emulation, Expand, no card active, Alpha/Bravo/Charlie in view; swept 1920, then 1600 → 600 in 20 px steps (viewport emulation, 650 ms settle per step), twice: with the document-tabs sidebar open (Docs' default, 280 px) and collapsed (73 px), then the sidebar reopened. Read per step: the scroller's client width W, the page's x, the card's x and width.
Measured (identical rules in both sidebar states):
- **Gutter page → card: 26 px** at every width (`.kix-discussion-plugin` at the page's right edge + 1, the card at `left: 25px`). **Gutter card → scroller edge: 25 px** whenever the card is between its bounds. The 26 px is Docs' rule, not the sidebar's.
- **`CARD_MAX`: Docs' widest card is 417 px** (417.4 measured; at W = 1904 it stops there with 265 px free on its right). **`CARD_MIN`: 282 px.** Between them the card's width is W − card x − 25.
- **Page position: Docs centres the page plus 308 px (the 26 px gutter and the 282 px least card) as one unit**: page x = (W − 794 − 307)/2, exact at every unclamped step (W 1904 → 401.5, 1584 → 241.5, 1304 → 101.5, sidebar collapsed). The card then grows from 282 px into whatever is free on its right, up to 417. **The page's left edge never goes under the sidebar**: it stops 5 px right of it (x = 301 with the sidebar open, 94 collapsed). With the sidebar open that clamp holds from W = 1584 down, which is the whole of the first run's 1512 window: **the 39 px shift there was the clamp against the tabs sidebar, not a rule of its own.**
- **Below the least width Docs does not switch to icons**: from W ≈ 1221 (sidebar collapsed; ≈ 1428 open) down to 600 the card stays 282 px and the column runs off the right edge, the editor scrolling sideways. No icon tier appears in Expand at any width swept. Icons appear only when the user picks Minimize (item 7).
Evidence: `31-item6-sweep.json` (sidebar open), `34-item6-sweep-sidebar-collapsed.json`, `30-item6-w{1600,1200,1000,800,600}.png`, `32-item6-sidebar-collapsed-w1920.png`, `33-item6-collapsed-w*.png`.

### 7. Hide and Minimize (re-bases the highlight-under-Hide choice and the icon merge distance)
The owner's state, read before any change: View › Comments with Expand checked, Hide, Minimize and Show all comments unchecked (`02-owner-view-state.json`).
- **Hide removes the passage highlights too.** With Hide on, no card is drawn, no passage carries its yellow highlight, the page re-centres alone (x 544 at 1920), the toolbar's comments button shows a struck-through icon, and a toast says "Comments hidden" with Undo (`60-item7-hide.png`).
- **Minimize: one 32 × 32 px avatar per thread (the author's picture), laid out by the same stack as the cards, not merged.** Alpha/Bravo/Charlie on adjacent lines (19.5 px apart) gave three separate icons at tops 348, 394, 440: a 46 px pitch, so a 14 px gap, the first at its anchor + 4.5. Highlights stay drawn in Minimize, and the page keeps the Expand position (x 401 at 1920). Whether icons ever merge into a count was not observed: three threads on adjacent lines did not merge (`61-item7-minimize.png`).
- Persistence after a reload, and per user versus per document: not measured. The second-document half was out of reach anyway under the one-document rule.
- Put back: View › Comments was set to Expand again and read back from the DOM at 05:29Z: Expand `aria-checked=true`, Hide, Minimize and Show all comments false, as found.

### 8. Compose (re-bases the Add comment button's y, C4 to C7)
Not measured as specified. One sample, from the first run: with a one-line selection Docs draws a floating pill (Add comment, Add emoji reaction) in the text column, its left edge at about the selection's end and its top at the selected line's bottom, not in the margin (`10-item1-oneline-card-and-selection.png`). Leaving the document at the clean-up raised a `beforeunload` "leave site?" dialog. A compose card had been left open by an interrupted step at 05:11Z, so this may be Docs warning about an unsent comment draft, but which draft or edit raised it was not established.

### 9. Orphan and undo (confirms Z3)
State: "Orphanpass is a sentence to delete whole." with its comment (card top 1703.95), selected whole and deleted with Backspace, then ⌘Z.
Measured: on deletion the card leaves the margin (its element stays, `display: none`, no text drawn); Docs shows no wording in the margin. On undo the passage, its highlight and the card come back at the same top (1703.95) beside it. Whether the All comments panel words the orphan was not checked.
Evidence: `50-item9-orphan-undo.json`, `51-item9-after-undo.png`.

### 1, the image state
Not measured: the image is in the document but was never commented.

## Against B1's D-rules
- **D2, deselect relaxes to L1: contradicted.** Docs keeps the stack where the active pin left it after the thread deactivates (item 3, in its own state), and leaves cards that already sit above their moved anchors where they are after an edit (item 2). Overleaf's sticky pin, which D2 rejected, is Docs' behaviour.
- **D2, `MARGIN_ACTIVE_SHIFT_PX = 12`: contradicted.** Docs shifts the active card by 0 px; it marks it by elevation (a white raised surface with a shadow against grey inactive cards), a darker passage highlight and the reply field it grows.
- **D4, 200 ms `cubic-bezier(.4,0,.2,1)`, and edit-caused moves not animated: both contradicted.** Docs animates `top` 350 ms `ease` on every move, including those an edit causes (about 600 ms after the last key). MAWS may keep its no-animation-on-edit rule for R4's sake; that would then be a deliberate departure from Docs.
- **D3, the tiers: contradicted in three places.**
  1. Docs never falls back to icons as the window narrows. Under its 282 px least card the column overflows sideways, and icons come only from Minimize.
  2. Docs' bounds are 282 to 417 px with gutters of 26 px (page side) and 25 px (edge side), against D3's 200 to 300 px with an 8 px G.
  3. Hide drops the highlights, against D3's "highlights kept".
  
  D3's Minimize rule, "icons closer than one icon's height merged into a count", was not seen either: Docs stacked three 32 px avatars at a 14 px gap on adjacent lines.
- **D1 and N6, page and column centred as one unit: confirmed with a refinement.** The unit Docs centres is page + 26 + the least card (308 px), not the drawn column. The card then widens into the free space on its right, and the page never slides under the left sidebar (5 px clear).
- **D5, caret activation: consistent** (incidental readings only; the arrow-key state and Esc/U were not run).
- **D11 and Z3, orphan and undo: consistent**: the card leaves the margin and returns on undo.
- `passageRect`'s first-line rule: confirmed, with Docs' constant +4 px (item 1).

## Clean-up and state left
- 05:31Z the document "MAWS LC-1 test" moved to the Trash from inside the folder (Drive's toast: "File moved to trash"). 05:32Z the folder "MAWS UX check" moved to the Trash from My Drive ("Folder moved to trash"). 05:33Z Drive's search for "MAWS UX check" and for "MAWS LC-1 test" both answer "no files or folders match", and neither item is on the page (`90-cleanup-search-empty.png`). The Trash was left as it is.
- View › Comments: Expand, as found (read back 05:29Z). The document-tabs sidebar, collapsed for the second sweep, was reopened before the deletion.
- 05:33Z the session's one tab was closed (`tab-close`; the session listed only that tab) and the session `lc1` is gone (`playwright-cli list`: no browsers). No other tab was read or touched; no sign-in, 2FA or permission prompt appeared.
- An interrupted step at 05:06Z to 05:11Z (input sent at a 600 px viewport) cut a line of the test text short and anchored five stray comments in the wrong places; it affected no measurement reported here (item 3 was redone on a fresh passage) and went with the document.
