# Word cut: Artifact editors

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

159 items: 132 cut, 4 reworded, 23 stay. Of the 136 that change, the owner saw 15 in a picture or ruled on them; 121 follow the pattern and were not seen.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin.

## Document editor

### Document editor, toolbar

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G330 | the paste variant of the toolbar error, when the document turned read-only mid-paste | Couldn’t paste: the document stopped taking edits while the images were copied | cut | A paste the document refused mid-copy now reads "Couldn’t paste: the document is read-only". | pattern | `src/artifacts/document/editor/asset-paste.ts:83` |
| G331 | eight word buttons that appear in the toolbar strip while the caret is in a table: Add row above, Add row below, Add column left, Add column right, Delete row, Delete column, Header row, Delete table | Add row above | cut | With the caret in a table the toolbar shows one "Table ▾" button; its menu holds the eight row, column, header and delete commands. | pattern | `src/artifacts/document/editor/Toolbar.tsx:234` |
| G332 | the right end of the toolbar, a word button | Add comment | cut | Add comment is a comment-plus line glyph; its tooltip reads "Add comment (⌘⌥M)". | seen | `src/artifacts/document/editor/Toolbar.tsx:390` |
| G333 | the right end of the toolbar: a word button with the open-comment count after it | Comments 3 | cut | Comments is a speech-bubble line glyph with the open count beside it; the tooltip still reads "Comments (3 open)". | seen | `src/artifacts/document/editor/Toolbar.tsx:394` |
| G335 | the right end of the toolbar, a word button (tooltip 'Version history') | History | cut | History is a clock line glyph; its tooltip reads "Version history". | seen | `src/artifacts/document/editor/Toolbar.tsx:425` |
| G336 | the last button of the toolbar | Find | cut | Find is a magnifier line glyph; its tooltip reads "Find (⌘F)". | seen | `src/artifacts/document/editor/Toolbar.tsx:429` |
| G337 | every button whose visible words are repeated word for word as its own tooltip: Insert, Add comment, Find, the eight table buttons; near-repeats on History ('Version history') and Comments ('Comments (3 open)'); in the version preview bar Restore this version, Make a copy, Name this version, Back to document, and Cancel/Restore in its confirm and Cancel in its name form | Add comment | cut | Tooltips that repeated a button’s words are gone: Insert ▾ and Table ▾ have none, the table commands sit in a menu, the comment, history and find buttons are glyphs whose tooltips are now their only words; in the version preview bar Restore, and Cancel/Restore in its confirm and Cancel in the name form, have no tooltip. | pattern | `src/artifacts/document/editor/Toolbar.tsx:446` |

### Document editor, page

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G345 | while the document opens, in the page area | Loading… | cut | While the document opens the page area shows a small turning ring and no words. | pattern | `src/artifacts/document/editor/DocumentEditor.tsx:418` |
| G346 | banner across the top of the editor after a version was restored, with a word button | Restored from Draft · Dismiss | stays | Stays. Dismiss becomes ×; the owner brought back Dismiss on questions (C106), where × and Dismiss do different jobs; on a banner they may be the same job \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/document/editor/DocumentEditor.tsx:370` |
| G347 | a floating pill over the page when an agent changed the document since the person last looked; × beside it | See 3 new changes | cut | The floating pill reads "3 new changes" (or "New changes" while the count is unknown). | pattern | `src/artifacts/document/editor/DocumentEditor.tsx:487` |
| G351 | banner above the page during a suggestion review when the selected change cannot be accepted or rejected | This change cannot be resolved to a review range. | cut | The review banner reads "This change can’t be accepted or rejected here." | pattern | `src/artifacts/document/editor/Suggestions.tsx:258` |
| G353 | a coloured tag above the text an agent is streaming into the page | Claude is writing… | cut | The coloured tag over text an agent is streaming shows just the agent’s name ("Claude"). | pattern | `src/artifacts/document/editor/chrome.css:719` |
| G354 | a coloured tag over each dashboard chart whose dataset an agent is rebinding | Claude is updating sales… | cut | The coloured tag over a chart being rebound shows just the agent’s name ("Claude"). | pattern | `src/artifacts/document/editor/provisional.ts:210` |
| G357 | a dropdown in the header of every callout block on the page (Note, Tip, Warn, Danger) | Note | stays | Stays. a callout's tone label (Note, Tip, Warn, Danger) shows only on pointing; the label is also what kind of callout it is \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/document/editor/nodes/views.ts:206` |

### Document editor, Show editors

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G359 | heading of the small popover that lists who edited the selection | Editors of the selection | cut | The editors popover heading reads "Editors". | pattern | `src/artifacts/document/editor/history/ShowEditors.tsx:77` |
| G360 | the popover while it reads | Reading the history… | cut | While the editors popover reads the history it shows a small turning ring. | pattern | `src/artifacts/document/editor/history/ShowEditors.tsx:83` |
| G361 | the popover when nobody is recorded | No edits recorded for this selection. | cut | An empty editors popover reads "No edits recorded". | pattern | `src/artifacts/document/editor/history/ShowEditors.tsx:87` |

### Document editor, version history rail

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G363 | heading at the top of the rail (opened by the toolbar's History) | Version history | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/artifacts/document/editor/history/HistoryRail.tsx:76` |
| G364 | tooltip on the rail's × (the × is a glyph); the comments panel's × says 'Close comments' | Close version history | cut | The history rail’s × tooltip reads "Close". | pattern | `src/artifacts/document/editor/history/HistoryRail.tsx:77` |
| G368 | tooltip on every version row | Click to preview; Shift-click to compare with the selected version | cut | A version row’s tooltip reads "Shift-click to compare". | pattern | `src/artifacts/document/editor/history/HistoryRail.tsx:124` |
| G369 | an Export word button on every version card in the list | Export | stays | Stays. version history: "Export" stays on every version | brought back | `src/artifacts/document/editor/history/HistoryRail.tsx:143` |
| G371 | a line under the controls while a version is being loaded for preview, and the list's own placeholder before it arrives | Loading the version… / Loading versions… | cut | While a version loads the status line under the controls shows a small turning ring, and the list shows one before the versions arrive; no words. (Partly applied on the scratch branch: The ring sits in the status line, not on the row being opened, and the list placeholder is a ring, not a skeleton list.) | pattern | `src/artifacts/document/editor/history/HistoryRail.tsx:93` |
| G373 | the list when empty, with or without Named only | No versions yet. / No named versions yet. | cut | An empty history list reads "No versions" or "No named versions". | pattern | `src/artifacts/document/editor/history/HistoryRail.tsx:100` |
| G374 | the Save version form that opens under the controls: two placeholders, Cancel, Save | Name, e.g. Draft to legal · What changed (optional) | cut | The Save version form’s placeholders read "Name" and "Note (optional)"; the Name this version form’s placeholder reads "Name" too. | pattern | `src/artifacts/document/editor/history/HistoryRail.tsx:182` |

### Document editor, version preview bar

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G377 | a sentence after the tab name when the shown tab was deleted, beside the label that already ends '(deleted)' | This tab was deleted. | cut | The preview bar no longer adds "This tab was deleted."; the tab label’s "(deleted)" remains. | pattern | `src/artifacts/document/editor/history/HistoryBar.tsx:90` |
| G379 | four word buttons at the right of the bar when a single version is shown | Restore this version · Make a copy · Name this version · Back to document | cut | The preview bar ends with "Restore", a "…" menu holding Make a copy and Name this version, and a × that goes back to the document (tooltip "Back to document"). | pattern | `src/artifacts/document/editor/history/HistoryBar.tsx:118` |
| G380 | confirmation under the bar after Restore this version, with Cancel and Restore | Restore this version? The document goes back to it as a new version; everything since stays in history, and comment conversations are kept. | stays | Stays. kept: consent | consent | `src/artifacts/document/editor/history/HistoryBar.tsx:138` |

### Document editor, comment card (shared with slides and designs)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G384 | every comment card, in the margin, a pin popover and the comments panel: a word button at the card's foot (Reopen on a resolved one) | Resolve | cut | Resolve (Reopen on a resolved card) shows only on the card under the pointer, the card with the keyboard or the active card, over the card’s top right; at rest a card is its messages alone. Shared card: the deck and design pin popovers show the same. | pattern | `src/artifacts/comments/ThreadCard.tsx:161` |
| G385 | on the active card in the margin, and on every open card in the comments panel at rest: the reply field and its word button | Reply… · Reply | cut | Every card, the comments panel’s included, shows the reply field only once it is active; its Reply button is an up-arrow send glyph (tooltip "Reply"). Shared card: the deck and design pin popovers already showed the field on the active card only; their send button is the glyph too. | pattern | `src/artifacts/comments/ThreadCard.tsx:220` |
| G388 | a muted line on a card whose passage is gone (the comments panel and the deck/design popovers) | The commented passage was removed. | cut | A card whose passage is gone shows its quote struck through (the panel) or a small "Removed" tag (the deck and design popovers); the full sentence is the tooltip. | pattern | `src/artifacts/comments/ThreadCard.tsx:150` |

### Document editor, comments panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G390 | heading at the top of the panel (opened by the toolbar's Comments) | All comments | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/artifacts/document/editor/comments/CommentsPanel.tsx:122` |
| G391 | tooltip on the panel's × (the × is a glyph) | Close comments | cut | The comments panel’s × tooltip reads "Close". | pattern | `src/artifacts/document/editor/comments/CommentsPanel.tsx:123` |
| G393 | second row of filters, two segments, shown even when the document has only one tab | This tab · All tabs | cut | The This tab / All tabs filter shows only when the document has two or more tabs (with one tab the filter is All tabs). | pattern | `src/artifacts/document/editor/comments/CommentsPanel.tsx:54` |
| G394 | the panel's search field | Search comments | cut | The comments search field’s placeholder reads "Search". | pattern | `src/artifacts/document/editor/comments/CommentsPanel.tsx:130` |
| G395 | a toggle row at the top of the list when some comments point at deleted text | Show deleted-target comments / Hide deleted-target comments | cut | The toggle for comments on deleted text reads "Deleted (2)", drawn darker while on. | pattern | `src/artifacts/document/editor/comments/CommentsPanel.tsx:135` |
| G397 | the list when nothing is open; it tells the person to choose 'Comment', a control the toolbar labels 'Add comment' | No open comments. Select text and choose Comment. | reword | The document's empty open-comments list reads "No open comments. Select text and choose Add comment." | pattern | `src/artifacts/document/editor/comments/CommentsPanel.tsx:117` |
| G398 | the list under the Resolved filter or a search with no hits | No resolved comments. / No comments match the search. | cut | The empty lists read "No resolved comments" and "No matches". | pattern | `src/artifacts/document/editor/comments/CommentsPanel.tsx:117` |

## Slides editor

### Presentation editor, toolbar

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G400 | zoom menu at the right end of the toolbar, as it reads at rest | Fit (42%) | cut | The zoom menu reads the bare percentage (42%) while Fit is chosen, and Fit under the pointer; when another zoom is chosen the first item reads Fit. (Partly applied on the scratch branch: A native select shows the chosen item's own label in the open list too, so with Fit chosen the open list's first item reads 42% rather than a ticked "Fit"; Fit stays reachable as the select's tooltip.) | seen | `src/artifacts/slides/editor/DeckEditor.tsx:491` |
| G402 | toolbar, the History button (named "Version history" for assistive technology) | History | cut | The History button is a clock glyph; "Version history" shows on hover and stays its accessible name. | seen | `src/artifacts/slides/editor/DeckEditor.tsx:434` |
| G403 | toolbar, shown when the deck can take comments; disabled until exactly one element is selected | Add comment | cut | Add comment is a speech bubble with a plus; the tooltip keeps "Comment on the selected element (⌥⌘M)" and its accessible name stays "Add comment". | seen | `src/artifacts/slides/editor/comments/copy.ts:4` |
| G404 | toolbar, the comments rail toggle, with the open count | Comments 3 | cut | The Comments toggle is a speech bubble with the open count as a small corner badge (no badge at zero); "Comments" on hover. | seen | `src/artifacts/slides/editor/comments/CommentButtons.tsx:21` |
| G401 | toolbar, the Inspector toggle (History, Add comment and Comments have rows of their own; Arrange ▾ stays a word, as no arrange glyph is conventional) | Inspector | cut | The Inspector toggle is a side-panel glyph; "Inspector" shows on hover and stays its accessible name. | seen | `src/artifacts/slides/editor/ElementBar.tsx:65` |
| G411 | Insert ▸ Table submenu, each size | 2 × 3 table | cut | Insert ▸ Table lists bare sizes (2 × 3); each keeps "2 × 3 table" as its accessible name. | pattern | `src/artifacts/slides/editor/copy.ts:75` |
| G413 | the notice at the toolbar's right, shown for six seconds after a refused insert, group, paste or move; it ellipsizes on one line | only pinned elements group; detach flow elements first | cut | A refused insert, group, ungroup, detach, duplicate, paste, move, layout or text style shows a short plain refusal ("These can't be grouped", "Can't paste this here"); the model's own reason shows on hover over the notice. | pattern | `src/artifacts/slides/writers-elements.ts:333` |
| G414 | toolbar notice, after dragging or resizing an element whose transform is a design-system token (two variants) | This element’s transform is a design-system token: Detach transform, in the inspector, replaces it with its fallback value, which can then be rotated and resized. | cut | Dragging or resizing a token-transformed element shows "Set by the design system: Detach it in the inspector" (or "Set by the design system: change it there" when there is nothing to detach to). | pattern | `src/artifacts/slides/editor/copy.ts:87` |
| G415 | toolbar notice while an inserted image uploads, and after | Uploading the image… | cut | The toolbar notice reads "Uploading…" while an inserted image uploads. | pattern | `src/artifacts/slides/editor/copy.ts:85` |
| G416 | toolbar notice when an upload finished after the deck turned read-only (also the inspector's Replace image, and a layout whose pictures were being copied) | The image was uploaded but not placed: the deck stopped taking edits here while it uploaded | cut | An upload that finished after the deck turned read-only says "Not placed: the deck became read-only" (toolbar and the inspector's Replace); a layout whose pictures were being copied says "Not added: the deck became read-only". | pattern | `src/artifacts/slides/editor/copy.ts:92` |

### Presentation editor, filmstrip

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G421 | From layout menu, while the design system's layouts are read, when it has none, or when they fail | Reading the design system’s layouts… | cut | The From layout menu reads "Loading…", "No layouts", or "Layouts could not be read: {reason}". | pattern | `src/artifacts/slides/editor/menus/copy.ts:36` |
| G423 | red line under New slide once the deck holds 500 slides (New slide is greyed out too) | A deck holds at most 500 slides: delete one to add another. | cut | At 500 slides New slide is greyed with no red line; the limit sentence shows on hover over it. | pattern | `src/artifacts/slides/editor/copy.ts:38` |
| G424 | corner badge on a hidden slide's thumbnail, which is also drawn at 40% opacity | Hidden | cut | A hidden slide's thumbnail carries an eye-with-slash glyph in its corner instead of the word Hidden (still dimmed; the thumbnail's accessible name still says hidden). | pattern | `src/artifacts/slides/editor/copy.ts:29` |
| G425 | red badge on a thumbnail whose file does not load (the thumbnail also gets a dashed red border) | Held | stays | Stays. "Held" becomes a red warning glyph (the dashed border stays); an exception's word turned mark, less ambiguous than the dot at G523 \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/slides/editor/copy.ts:28` |
| G428 | slide menu, behind the ⋯ that appears on a thumbnail at hover | Duplicate slide | cut | The slide menu reads Duplicate / Hide / Show / New section here / Delete. | pattern | `src/artifacts/slides/editor/copy.ts:17` |
| G429 | beside every section title in the filmstrip, two controls always shown | Rename | cut | A section title shows no buttons at rest; a pencil and × appear on hover or focus (as the thumbnail ⋯ does), and a double-click on the title renames it. | pattern | `src/artifacts/slides/editor/copy.ts:25` |

### Presentation editor, stage

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G431 | banner across the top of the stage when the shown slide's file does not load, with a bulleted list of the loader's reasons under it | This slide’s file does not load, so it shows its last good version, read-only. The agent’s next valid file for it clears this. | cut | The held banner reads "Showing the last good version (read-only). The agent's next valid file fixes it." | pattern | `src/artifacts/slides/editor/copy.ts:31` |
| G432 | bulleted list under the held banner | <aside> (the notes) is not the section’s last child | cut | The loader's reasons sit behind a "Details" disclosure in the held banner instead of a bulleted list under it. | pattern | `src/artifacts/slides/parse.ts:222` |
| G433 | stage of a deck with no slides | This deck has no slides yet. | cut | An empty deck's stage reads "No slides yet". | pattern | `src/artifacts/slides/editor/copy.ts:39` |

### Presentation editor, speaker notes

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G436 | the notes field, empty, once opened | Speaker notes | cut | The opened, empty notes field has no placeholder (the disclosure above it already says Speaker notes). | pattern | `src/artifacts/slides/editor/copy.ts:34` |
| G437 | red line under the notes field when the notes pass 4,000 characters | Speaker notes hold at most 4,000 characters; these have 4,312. Shorten them to save. | cut | Notes past the limit show "Too long to save: 4,312 / 4,000". | pattern | `src/artifacts/slides/editor/copy.ts:35` |
| G438 | red line under the notes field, when kept text came back after the notes changed elsewhere | These speaker notes are not saved yet: they were too long until the notes changed elsewhere. | cut | Kept notes that came back after a change elsewhere show "Not saved yet". | pattern | `src/artifacts/slides/editor/copy.ts:36` |

### Presentation editor, inspector

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G439 | top of the inspector card, then the inspector's own heading right under it | Inspector | cut | The inspector card's header is the selection's name ("Heading 1", "Slide", "3 selected") with its ×; the word Inspector and the second heading are gone (the panel's accessible name stays Inspector). | pattern | `src/artifacts/slides/editor/DeckEditor.tsx:447` |
| G442 | small captions over number fields that repeat their section's heading: Shadow X, Shadow Y, Shadow blur, Shadow spread; Border width, Border style; Font size, Font weight; Line width, Line style; Gradient angle, Stop 1 position; Image fit, Text fit | Shadow blur | cut | Field captions read X, Y, Blur, Spread; Width, Style; Size, Weight; Width, Style; Angle, Position; Fit, Fit under their section headings; the full names stay the fields' accessible names. | pattern | `src/artifacts/slides/editor/inspector/copy.ts:59` |
| G445 | Text section, the weight list | 400 Regular | cut | The weight list reads Thin … Regular … Black without the numbers. | pattern | `src/artifacts/slides/editor/inspector/sections.tsx:385` |
| G446 | option labels that carry the CSS mechanism in parentheses: Fill (cover), Fit (contain) for an image; None (clip) for text fit; Other (as written) for a fill | Fill (cover) | cut | Options read Fill, Fit (image), Clip (text fit), Other (fill) without the CSS keyword in parentheses. | pattern | `src/artifacts/slides/editor/inspector/copy.ts:80` |
| G447 | hover on each colour swatch under a colour field (eleven per field) | Accent (--ds-color-accent) | cut | Hover on a colour swatch shows the role name only ("Accent"). | pattern | `src/artifacts/slides/editor/inspector/fields.tsx:231` |
| G448 | placeholder and hover title of a number field whose value is a design-system token | Body · hover: Body (--ds-type-body-size) | cut | A token-valued number field (and a token-valued choice in a list) shows only the friendly name on hover ("Body"). | pattern | `src/artifacts/slides/editor/inspector/fields.tsx:128` |
| G449 | Arrange section, a note under Rotation when the selection's transform is a design-system token (four variants: one or several, with or without a fallback) | This transform is a design-system token. Detach transform replaces the token with its fallback value, 12deg, which can then be rotated. | cut | The token-transform note under Rotation is gone; its sentence shows on hover over the greyed Rotation field and over Detach transform. | pattern | `src/artifacts/slides/editor/inspector/copy.ts:33` |
| G450 | Shadow section, a note under the fields when the shape is not a rectangle (Spread and Inset are greyed out) | This shape’s shadow is drawn from its outline, which casts no inset shadow and no spread. | cut | The outline-shadow note is gone; its sentence shows on hover over the greyed Spread and Inset. | pattern | `src/artifacts/slides/editor/inspector/copy.ts:65` |
| G453 | Image section buttons and alt text | Reset crop Replace image Alt text | cut | The Image section's buttons read Reset crop, Replace, and the Alt text row stays; Replace keeps "Replace image" as its accessible name. | pattern | `src/artifacts/slides/editor/inspector/copy.ts:86` |
| G455 | Image section, under Replace image when the upload answers something unexpected | The upload answered "x", which is not an assets/ file | cut | An unexpected upload answer under Replace reads "The image could not be replaced". | pattern | `src/artifacts/slides/editor/inspector/copy.ts:89` |

### Presentation editor, Theme panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G460 | Theme panel section headings | Design system Colours Faces | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/artifacts/slides/editor/menus/copy.ts:9` |
| G461 | under "Default" in the system list, when Default is not the chosen one | The Space’s or your default | cut | Default in the system list has no grey caption unless it is chosen (then it still shows the governing system's name). | pattern | `src/artifacts/slides/editor/menus/copy.ts:7` |
| G463 | Faces section, the two rows | Display face Body face | cut | The Faces rows read Display and Body; the selects keep "Display face" and "Body face" as their accessible names. | pattern | `src/artifacts/slides/editor/menus/Theme.tsx:51` |
| G465 | Faces section, a caption and then one line per font the deck carries, each with its state | Saved in this deck (Google Fonts, OFL) | cut | The deck's font list shows each family alone when it draws (saved or uploaded); only exceptions carry words. | pattern | `src/artifacts/slides/editor/menus/copy.ts:22` |
| G466 | Faces section, a font's state when it cannot draw yet | Draws as its fallback until MAWS reaches Google Fonts | cut | A font that cannot draw yet reads "Waiting for Google Fonts" or "No font file". | pattern | `src/artifacts/slides/editor/menus/copy.ts:23` |
| G468 | bottom of the Theme panel, once any colour or face is overridden | Use the system’s colours and faces | cut | The Theme panel's reset reads "Reset all". | pattern | `src/artifacts/slides/editor/menus/copy.ts:13` |

### Presentation editor, Check panel

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G471 | top of the Check panel beside the stage (opened from the header's Check) | Check against the design system | cut | The Check panel's title reads "Check". | pattern | `src/artifacts/slides/editor/menus/copy.ts:47` |
| G472 | the Check panel's summary line, or its whole body when the system has nothing to check | The deck keeps every checked rule (12). | cut | The Check summary reads "No issues · 12 rules" or "3 issues", and a system with nothing to check reads "Nothing to check". | pattern | `src/artifacts/slides/editor/menus/copy.ts:50` |
| G473 | each issue row: the message, then a monospace element path, then the rule's words with "[check: rule-id]" | [check: accent-max] | cut | Each issue row shows the message and the rule's words; the monospace element path and "[check: rule-id]" are gone (the row's accessible name still names the element). | pattern | `src/artifacts/slides/editor/menus/Check.tsx:85` |
| G475 | section headings for rules the app cannot check automatically | To judge by hand Tags MAWS cannot run | cut | The manual sections are headed "Check by hand" and "Unknown checks". | pattern | `src/artifacts/slides/editor/menus/copy.ts:54` |
| G476 | whole body of the Check panel while it reads the system | Reading the design system… | cut | The Check panel reads "Checking…" while it reads the system. | pattern | `src/artifacts/slides/editor/menus/copy.ts:48` |

### Presentation editor, comments rail

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G478 | the rail's body when nothing is open | No open comments. Select an element and choose Add comment. | reword | The deck's empty comments rail reads "No open comments. Select an element and choose Add comment." | pattern | `src/artifacts/slides/editor/comments/copy.ts:10` |
| G479 | top of the rail, a toggle shown once any comment's element was deleted | Show deleted-target comments | cut | The rail's toggle reads "Show deleted" / "Hide deleted"; the accessible name keeps the longer words. | pattern | `src/artifacts/slides/editor/comments/CommentsRail.tsx:75` |
| G481 | under a thread whose element was deleted | The commented element was deleted. | cut | Under a thread whose element was deleted: "Element deleted". | pattern | `src/artifacts/slides/editor/comments/copy.ts:15` |
| G482 | each open thread: a reply field and a Reply button beside it (Enter also posts) | Reply… Reply | cut | The reply button is a send-arrow glyph (Reply on hover and as its name); the placeholder keeps "Reply…". | pattern | `src/artifacts/slides/editor/comments/copy.ts:16` |

### Presentation editor, text formatting bar

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G486 | the link or colour row's submit button | Apply link / Apply colour | cut | The link and colour rows' submit button reads "Apply"; its accessible name stays Apply link / Apply colour. | pattern | `src/artifacts/slides/editor/TextBox.tsx:515` |

### Presentation editor, version preview

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G489 | version bar, the change count and position, with ↑ ↓ (hover: Previous change, Next change) | 2 of 5 changes | cut | Stepping through changes, the version bar reads "2 / 5" beside ↑ ↓. | pattern | `src/artifacts/slides/editor/history/HistoryBar.tsx:25` |
| G490 | version bar, buttons at its right end | Restore this version Make a copy Name this version Back to presentation | cut | The version bar's buttons read Restore, Make a copy, Name, Done; their full names show on hover and stay their accessible names. | pattern | `src/artifacts/slides/editor/history/copy.ts:9` |
| G492 | Name this version form, the empty field | Name, e.g. Before the review | cut | The Name this version field's placeholder reads "Version name". | pattern | `src/artifacts/slides/editor/history/copy.ts:17` |
| G494 | hover on a changed element's outline on the version's slide | background, border-radius — Ana · 2:14 PM | cut | Hover on a changed element's outline names the change as a person knows it ("Fill, corners — Ana · 2:14 PM"). | pattern | `src/artifacts/slides/editor/history/copy.ts:61` |
| G495 | under the version's slide, when it has no notes | No speaker notes. | stays | Stays. a version's slide with no notes shows an empty notes area (see G506) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/slides/editor/history/copy.ts:28` |

### Presentation editor, version history

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G498 | hover on the pill's ↻ (shown only when counting failed) | {raw error message} | cut | Hover on the pill's ↻ shows "Count the new changes again" instead of the raw error. | pattern | `src/artifacts/slides/editor/DeckEditor.tsx:369` |
| G500 | status lines the version rail shows after an action (the rail itself is the document editor's) | Saved “Before the review”. | cut | Saving or naming a version shows no status line; the new or renamed row is the confirmation. (Partly applied on the scratch branch: "A copy of this version was made." stays: the copy lands outside this list, so nothing on screen confirms it.) | pattern | `src/artifacts/slides/editor/history/controller.ts:260` |

### Presentation editor, presenter view

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G502 | presenter bar: elapsed time, slide position | Slide 3 of 12 | cut | The presenter bar reads "3 / 12" (accessible name "Slide 3 of 12"). | pattern | `src/artifacts/slides/editor/present/copy.ts:4` |
| G506 | the next pane at the last slide; the notes pane of a slide with none | End of the show. No notes for this slide. | stays | Stays. "End of the show" becomes "End" (plain), but a slide with no notes now shows an empty notes pane in the presenter view \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/slides/editor/present/copy.ts:15` |

### Presentation editor, export

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G508 | wherever the header's Export reports an error, for Export for Claude while any slide does not load | the presentation cannot be exported for Claude while slides are held: slide k3x is held (…); fix or remove them first | cut | Export for Claude with a slide that does not load reports "Can't export: slide 3 does not load. Fix or remove it first." (slides by filmstrip number). | pattern | `src/artifacts/slides/export/claude.ts:56` |

## Design workbench

### Design editor, toolbar

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G510 | the boards toggle's tooltip; it reads "Show boards" also while the rail is open and the press would hide it | Show boards | cut | The boards toggle's tooltip reads "Boards" in both states. | pattern | `src/artifacts/design/editor/copy.ts:24` |
| G511 | two word buttons after the element tools, at rest whenever commenting is offered | Add comment | cut | Add comment is a speech-bubble-plus glyph in the toolbar; its tooltip names the act and shortcut (see G513/G514) and its accessible name stays "Add comment". | seen | `src/artifacts/design/editor/comments.tsx:150` |
| G512 | the second of the two word buttons, with the open count after it ("Comments 3"); the header above has its own Comments icon toggling the same rail, and its own open count | Comments 3 | cut | The toolbar no longer has its own "Comments 3" button; the header's Comments icon with its count opens the rail. | seen | `src/artifacts/design/editor/comments.tsx:154` |
| G513 | tooltip on Add comment when an element is selected (or nothing, while disabled) | Comment on the selected element, or on the board when no element is selected (⌥⌘M) | cut | Add comment's tooltip reads "Comment (⌥⌘M)". | pattern | `src/artifacts/design/editor/copy.ts:57` |
| G514 | tooltip on Add comment when a board, not an element, is selected | Comment on board Hero (⌥⌘M) | cut | With a board selected, Add comment's tooltip reads "Comment on Hero (⌥⌘M)". | pattern | `src/artifacts/design/editor/copy.ts:58` |
| G516 | first item in the zoom menu; the header's icon for the same act is named "Zoom to fit" | Fit all (⇧1) | stays | Stays. skipped: a rename, not applied in this cut | not a cut | `src/artifacts/design/editor/DesignWorkbench.tsx:636` |
| G518 | the same toolbar status slot when a board edit is refused (a limit, a held board); the text is the writer's own, board id first | board hero: its file does not load (held), so there is nothing to copy | cut | A refused board edit shows a sentence in the person's terms with no id, e.g. "Can’t duplicate a board that doesn’t load". | pattern | `src/artifacts/design/writers.ts:95` |

### Design editor, boards rail

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G522 | each board row, at rest: its name, then its size in faint figures | 1,440 × 1,024 | cut | Each board row shows its name alone; the size appears when the row is hovered or focused. | seen | `src/artifacts/design/editor/BoardList.tsx:240` |
| G523 | red badge after a board's name in the row when its file does not load (it is shown read-only at its last good version) | Held | stays | Stays. an exception's word badge ("Held") turned into a dot, like the "New" badge the owner brought back (G214) | pattern | `src/artifacts/design/editor/BoardList.tsx:238` |
| G524 | red badge after a board's name when the design names it but its file never arrived | File not received | stays | Stays. an exception's word badge ("File not received") turned into a dot (G214) | pattern | `src/artifacts/design/editor/BoardList.tsx:239` |
| G525 | the ⋯ button on a row, shown on hover; its menu | Zoom to board · Rename · Duplicate board · Move up · Move down · Delete board | reword | The board row's ⋯ menu reads Zoom to board · Rename · Duplicate · Move up · Move down · Delete. | pattern | `src/artifacts/design/editor/BoardList.tsx:250` |
| G526 | in the rail and in the empty canvas at once, when a design has no boards | This design has no boards yet. | cut | With no boards, only the canvas says "This design has no boards yet."; the rail shows its header and + alone. | pattern | `src/artifacts/design/editor/copy.ts:47` |
| G527 | under the list when the design reaches its board limit | A design holds at most 200 boards: delete one to add another. | cut | At the limit the rail's note reads "200 boards is the most". | pattern | `src/artifacts/design/editor/copy.ts:40` |

### Design editor, canvas

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G528 | above each board on the canvas, at rest: its name, and its size once the board is wide enough on screen; the tooltip repeats both ("Hero, 1,440 × 1,024") | Hero 1,440 × 1,024 | cut | A board's canvas title shows its name alone; the size appears on hover or while the board is selected, and the tooltip still gives both. | pattern | `src/artifacts/design/editor/World.tsx:631` |
| G529 | red badge in a board's canvas title when its file does not load | Held | cut | A held board's canvas title has no "Held" badge; the board keeps its dashed red outline. | pattern | `src/artifacts/design/editor/World.tsx:632` |
| G532 | a numbered disc where several comment pins merge at low zoom; its tooltip | 3 comments here; zoom to them | cut | A merged pin's tooltip reads "3 comments". | pattern | `src/artifacts/design/editor/copy.ts:60` |

### Design editor, banners

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G533 | a banner under the toolbar while the selected board's file does not load, followed by a bulleted list of the loader's reasons | This board’s file does not load, so it shows its last good version, read-only. The agent’s next valid file for it clears this. | cut | The held banner is one line, "This board’s file doesn’t load; showing its last good version.", with the reasons folded under it. | pattern | `src/artifacts/design/editor/copy.ts:45` |
| G534 | the reasons list under the held banner, one bullet per loader problem | (the loader's reasons, e.g. a parse error per line) | cut | The loader's reasons are folded inside the held banner; pressing the banner's sentence (a disclosure) opens them. | pattern | `src/artifacts/design/editor/DesignWorkbench.tsx:505` |
| G535 | a banner under the toolbar while the selected board's file never arrived | The design names this board but its file never arrived, so it has nothing to edit yet. The agent’s file for it fills it. | cut | The missing banner reads "This board’s file hasn’t arrived yet." | pattern | `src/artifacts/design/editor/copy.ts:46` |

### Design editor, board inspector

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G536 | top of the right rail when a board, not an element, is selected: the board's name as a heading, then a section heading "Board", then a field captioned "Board name" holding the same name | Hero / Board / Board name | stays | Stays. design inspector keeps the board heading, the "Board" section and "Board name" | brought back | `src/artifacts/design/editor/BoardInspector.tsx:64` |
| G538 | the select under the position and size fields, captioned "Board size"; it shows a preset ("Desktop 1,440 × 1,024") or Custom | Board size | cut | The size select's caption reads "Size". | seen | `src/artifacts/design/editor/BoardInspector.tsx:76` |
| G539 | a red line under the fields when a size is refused; the writer's words, id first | board hero: w is 20000 px (over 16384 px a side) | cut | A refused size reads "At most 16,384 px a side" under the field. | pattern | `src/artifacts/design/canvas.ts:79` |
| G541 | tooltip on Move to board… | Move the selected elements to another board (they take new ids there; their comments go with them) | cut | Move to board…'s tooltip reads "Move to another board". | pattern | `src/artifacts/design/editor/copy.ts:62` |

### Design editor, comments rail

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G542 | the comments rail when nothing is open; the button it names reads "Add comment", not "Comment" | No open comments. Select a board or an element and choose Comment. | reword | The design's empty comments rail reads "No open comments. Select a board or an element and choose Add comment." | pattern | `src/artifacts/design/editor/copy.ts:65` |
| G543 | the small line above each thread's quote naming where it sits: a board's own thread reads "Board Hero", an element's thread reads just the board name | Board Hero | cut | A board's own thread is located by the board's name alone ("Hero"). | pattern | `src/artifacts/design/editor/copy.ts:66` |
| G545 | a note under a thread whose board or element was deleted | The commented board was deleted. / The commented element was deleted. | cut | A thread whose board was deleted shows only its location line "A deleted board", no second note. | pattern | `src/artifacts/design/editor/copy.ts:70` |

### Design editor, version preview

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G546 | the toolbar row while a past version shows: its title, a "Show changes" checkbox, the change count with ↑ ↓, then Restore this version, Make a copy, Name this version, Back to design, all as word buttons | Restore this version · Make a copy · Name this version · Back to design | stays | Stays. version buttons shortened to "Restore · Copy · Name · Back"; "Copy" and "Name" lose what they do (copy what? name what?) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/design/editor/history.tsx:98` |
| G548 | a confirmation under the bar after pressing Restore this version, with Cancel and Restore | The design goes back to it as a new version: its boards, their places and sizes, their content and the design’s settings. Everything since stays in history, and comment conversations are kept. | stays | Stays. kept: consent | consent | `src/artifacts/design/editor/copy.ts:74` |
| G549 | the left rail while a version shows, its heading; each row repeats name, size and a New or Deleted badge | Boards in this version | cut | The version preview's board list is headed "Boards". | pattern | `src/artifacts/design/editor/history.tsx:202` |

### Design editor, header

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G556 | a sheet when an export is larger than the format allows (host) | “Hero” is 9000 × 6000 px. A PNG can be at most 8192 px on a side, so MAWS exports the whole board at 91.02% (8192 × 5461 px); nothing is cropped. | cut | Same sheet as T632: no pixel figures, a whole-number percentage ("91%"), body "Too large for a PNG at full size." | pattern | `src/renderer/src/tools/design/exports.ts:110` |
| G557 | the whole editor area while the design opens (host) | Opening the design… | cut | While a design opens its editor area is blank, then a small spinner. | pattern | `src/renderer/src/tools/design/DesignBody.tsx:116` |

## Design system page

### Design system page, header

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G558 | the header row above the page (its host), right side, at rest: three word buttons, since none has an icon; other editors' headers show icons here | Check against law · Set as my default · Delete design system… | cut | The header's three actions are icon buttons (a ticked circle for Check against law, a star for Set as my default, a bin for Delete design system…); each label is the button's tooltip and accessible name. (Partly applied on the scratch branch: The preferred route (Set as my default and Delete into More actions, leaving Check against law) needs src/renderer/src/panel/PanelHeader.tsx, which folds actions into More only past three; took the reader's alternative, icons, from within my folder.) | seen | `src/renderer/src/artifacts/design-system/DesignSystemBody.tsx:87` |
| G562 | the page area while the system opens, then (a moment later) inside the page while its content loads | Opening the design system… / Loading the design system… | cut | Both loading moments (the tab opening the system, then the page loading its content) show the same muted ellipsis; screen readers still hear 'Opening/Loading the design system'. | pattern | `src/renderer/src/artifacts/design-system/copy.ts:14` |

### Design system page, top

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G565 | under the title when tokens fail to resolve: a count, then every failing path with its message, joined by semicolons | 2 tokens do not resolve: color.accent ({color.brand} not found); … | cut | Under the title, one red line 'N tokens don't resolve' that opens (a native disclosure) to the list of each path and its message. | pattern | `src/artifacts/design-system/page/DesignSystemPage.tsx:66` |

### Design system page, Palette

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G568 | under the swatches, at rest: four contrast rows, each a pair name, the ratio, and a verdict | Text on ground 12.6 : 1 meets 4.5 : 1 | cut | Each contrast row shows the pair name and its ratio; a failing pair adds a ✕ (its border was already red); the threshold verdict ('meets/below 4.5 : 1') is on hover. | seen | `src/artifacts/design-system/page/Palette.tsx:84` |

### Design system page, Type

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G571 | three column heads above the type specimens, at rest | Role · Document · Deck (shown at half size) | stays | Stays. design system Type table keeps "Deck (shown at half size)" | brought back | `src/artifacts/design-system/page/TypeScale.tsx:65` |

### Design system page, Canon

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G575 | under the Canon heading when the system has no canon files | No layouts, components or document styles yet. | cut | An empty Canon section says 'None yet'. | pattern | `src/artifacts/design-system/page/Canon.tsx:98` |
| G577 | under the document styles preview | document.css on a sample handout | cut | The document styles preview is captioned 'document.css'. | pattern | `src/artifacts/design-system/page/Canon.tsx:122` |

### Design system page, Law

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G579 | the Law section when the system has no law yet, above the Ask button | No law yet. A system’s law is written, never generated: ask the agent to adopt this system, and it writes DESIGN.md from what it reads. | cut | A system without law shows 'No law yet' above the Ask the agent to adopt it button. | pattern | `src/artifacts/design-system/page/Law.tsx:33` |
| G582 | a toast after Ask, when the request has been put into the chat's message box | The request is in the chat’s message box; send it when it reads right. | cut | After Ask, the toast reads 'Request added to the message box'. | pattern | `src/renderer/src/artifacts/design-system/copy.ts:32` |

### Design system page, Check against law

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G584 | one line under the heading, at rest: the result of checking the canon against the law's hard don'ts | The canon keeps every checked rule (7). | cut | When the canon passes, the line under Check against law is a muted '✓ 7' (the sentence on hover and as its accessible name); the sentence shows only when something fails. | pattern | `src/artifacts/design-system/page/Check.tsx:27` |
| G585 | each violation: the file, the element, the message, then the law's own words with a bracketed tag | … Accent on more than one element per slide [check: accent-max] | cut | Each violation ends with the law's words alone; the '[check: accent-max]' tag is on hover. | pattern | `src/artifacts/design-system/page/Check.tsx:60` |
| G586 | sub-headings for rules the app cannot test, each with a list | To judge by hand · Tags MAWS cannot run | cut | One sub-heading 'By hand' with one list; the separate 'Tags MAWS cannot run' list is gone. | pattern | `src/artifacts/design-system/page/Check.tsx:78` |
| G587 | the line in the unknown-tag list | MAWS does not know the check "contrast-max"; judge this don’t by hand | cut | A don't whose tag MAWS cannot run is listed under 'By hand' by its words, with no explanation line. | pattern | `src/artifacts/design-system/check.ts:420` |

### Design system page, delete sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G591 | the select's first option in the in-use sheet | Their defaults (the Space’s, else yours) | cut | The in-use sheet's first option reads 'Their default system'. | pattern | `src/renderer/src/artifacts/design-system/copy.ts:25` |
| G592 | a confirmation when closing the tab with unsaved edits | Discard unsaved changes to “Tidewater”? — Some edits are not saved to the artifact store yet. Cancel keeps the tab open until they save; discarding loses them. | stays | Stays. kept: consent | consent | `src/renderer/src/artifacts/design-system/copy.ts:12` |

## Dashboard editor

### Dashboard editor, chart tile

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G594 | under every tile, at rest: a button line naming the dataset, its file or server and tool, when and by whom it was last updated in UTC, and any stale or paused state, joined by middle dots | Sales · from sales.csv · updated 2026-10-16 08:30 UTC by You · stale since 2026-10-16 09:30 UTC | stays | Stays. a tile's source line keeps file and age but drops who updated it; the owner brought back "Edited now by You" on library rows (G299) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/dashboard/states.ts:49` |
| G595 | the state fragments the source line appends when a live query cannot refresh | paused: no live session · paused: not allowed · paused: changed since it was allowed · paused: the tool may change data · paused: too many live tools are open · paused: the last refresh did not reach the dashboard · not fetched | stays | Stays. why a dataset is paused or stale becomes one amber "!"; whether the chart is live is a fact a person reads the tile for \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/dashboard/states.ts:12` |
| G596 | a line under the source line, at rest, joining every warning about what the view could not draw as asked, by middle dots | 2 rows have no revenue; not drawn · some category labels are shortened; the source table has them whole · unknown key "colour" ignored | stays | Stays. what the chart could not draw as asked becomes a small ⚠; at rest the chart may mislead without a word \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/dashboard/states.ts:24` |
| G597 | the warning when a spec carries a key the renderer does not know (shown in the line above) | unknown key "colour" ignored / invalid "x" ignored | cut | Spec warnings (unknown key, invalid value) no longer show on the tile at all, not even in the ⚠ hover. | pattern | `src/artifacts/dashboard/spec.ts:61` |
| G598 | a validation note under the tile when a column holds values of the wrong type | 3 of 120 values in revenue are not number | cut | A column's wrong-type note no longer shows under the tile; the tile carries the ⚠ mark (the note in its hover) and the source sheet shows it as before. | pattern | `src/artifacts/dashboard/states.ts:9` |
| G599 | inside a tile whose view cannot be drawn: a framed box with the reason, and a second muted line | (reason) / The caption, comments and edits on this block are kept. | cut | A tile that cannot be drawn shows only its framed reason; the 'caption, comments and edits are kept' line is gone (exports too, since they share the renderer). | pattern | `src/artifacts/dashboard/states.ts:42` |
| G603 | in a pie chart's warning line when it folds slices | 12 slices; the five largest are shown individually and the rest are drawn as one | cut | A folded pie's note reads 'Top 5 of 12 slices; the rest as “other”' (now inside the ⚠ hover). | pattern | `src/artifacts/dashboard/states.ts:40` |
| G604 | inside a tile while its data loads for the first time | Loading Sales… | cut | A tile loading for the first time shows a muted ellipsis; screen readers hear 'Loading Sales'. | pattern | `src/artifacts/dashboard/editor/chart-view.ts:173` |

### Dashboard editor, source sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G608 | the sheet's header: the dataset's title (or "Datasets"), and a word button to close it | Close | cut | The source sheet closes with a × glyph button (tooltip and accessible name 'Close'). | pattern | `src/artifacts/dashboard/editor/SourceSheet.tsx:72` |
| G609 | a select under the header when the dashboard has several datasets, captioned "Dataset"; each option is title then id in parentheses | Dataset Sales (sales) | cut | The dataset picker is the select alone, options by title; the id shows on hover of an option and in the text only when two titles collide. | pattern | `src/artifacts/dashboard/editor/SourceSheet.tsx:77` |
| G612 | two toggle buttons when the sheet was opened from a view | This view’s rows (42) · All source rows (300) | cut | The two toggles read 'This view (42)' and 'All rows (300)'. | pattern | `src/artifacts/dashboard/editor/SourceSheet.tsx:182` |
| G613 | the actions row: a count, then Copy rows and Download | Sales by month: 42 rows [Copy rows] [Download] | cut | The actions row reads '42 rows [Copy] [Download]' (Copy keeps the accessible name 'Copy rows'). | pattern | `src/artifacts/dashboard/editor/SourceSheet.tsx:190` |
| G615 | the sheet when no dataset is bound | No data is bound to this dashboard yet. An agent binds a file with artifact_dataset. | cut | With no dataset bound, the sheet says 'No data yet'. | pattern | `src/artifacts/dashboard/editor/SourceSheet.tsx:90` |
| G616 | in place of the rows, one of these when they cannot show | This query has not been fetched yet; there are no rows to show. · This snapshot is no longer available; open the source again to see the current one. · The rows could not be read: (reason) · This view cannot be drawn: (reason) · Reading the rows… | cut | In place of rows: 'Not fetched yet', 'Snapshot gone; reopen to see the current one', the two errors unchanged, and a muted ellipsis while rows are read. | pattern | `src/artifacts/dashboard/editor/SourceSheet.tsx:211` |

### Dashboard editor, live query block

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| G618 | a block in the source sheet for a query-backed dataset: a heading, the server · tool line, the permission state and the schedule sentence side by side, then buttons Allow / Revoke / Refresh | Live query · github · list_issues · Allowed to read · Refreshes every 5 minutes while this dashboard is on screen | stays | Stays. "Allowed to read" becomes a bare ✓ in the live-query block; a permission fact, near consent \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/dashboard/editor/LiveQuery.tsx:66` |
| G620 | a note when the tab is hidden | Refresh is available while this dashboard is on screen. | stays | Stays. Refresh is disabled with no reason while the tab is hidden \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/artifacts/dashboard/editor/live.ts:147` |
| G621 | a note with a Show latest button when newer rows arrived after the sheet opened | Newer rows were fetched at 2026-10-16 09:35 UTC; the rows here are the ones captured when the source opened. | cut | When newer rows arrive the note reads 'Newer rows at 09:35 [Show latest]', the full UTC time on hover. | pattern | `src/artifacts/dashboard/editor/live.ts:150` |
| G622 | the block when the query was replaced after the sheet opened, with Show current | This query was replaced or removed after the source opened, so it cannot be refreshed from here. | cut | A replaced query's block reads 'Query changed since opening [Show current]'. | pattern | `src/artifacts/dashboard/editor/live.ts:148` |
