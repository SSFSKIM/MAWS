# Design: guide

A design canvas: boards of any size (phone, tablet and desktop screens, posters) laid out on one canvas, each board an HTML section in the presentation dialect, exported to PNG and PDF.

## When to use this kind

Make a design when the user wants screens or visual pieces seen side by side: an app flow across phone and desktop, a landing page with its mobile view, a poster with its social crops. Each board is its own size, so a 390px phone screen sits beside a 1440px desktop one. For a talk or a sequence meant to be presented, make a presentation; for a live interactive page, an html artifact.

## Creating one

Call `artifact_create` with `kind: "design"` and a `title`:

- **From files**, the usual way: `files` maps `project/canvas.json` (the manifest: `title`, each board's `x`, `y`, `w`, `h` and `title`, and `order`) and one `project/boards/<id>.html` per board, each exactly one `<section id="<id>">` whose id is its file name. Plan the boards and their sizes first, then write them all in one create.
- **Empty**, with no `files`: the design starts as one blank desktop board (`desktop`, 1440×1024). Read it, then publish your boards.

Lay boards out left to right with a gap (100px reads well), related screens in a row. Common sizes: phone 390×844, tablet 834×1194, desktop 1440×1024, slide 1920×1080. The answer carries the format reference; boards take the presentation dialect, whose element and CSS tables `artifact_describe_type` with `kind: "presentation"` returns.

## Reading and editing

`artifact_read` returns the manifest, every board's file and the `revision`. Every element carries an `id`; keep the ids when you edit, since comments, history and the owner's selection follow an element by its id. Files come back normalized, so compare them by meaning, not bytes.

To change the design, call `artifact_publish` with the `baseRevision` your last read (or create, or publish) returned and only the files you changed: a board's whole new text, `project/canvas.json` when a board's place, size, title or the order changes, and `null` to remove a board. Leaving a board out of the manifest does not remove it. Every file in one publish lands together at one revision or none does, so restyle across boards in one publish.

The publish follows Claude's three layers:

1. **Your read must be your latest.** Any other `baseRevision` is refused (`staleBase`): read again.
2. **What nobody else touched merges.** The owner may be moving boards and editing elements while you work. Your changes are compared key by key and property by property with what you read: the owner moving a board and you restyling an element on it both land.
3. **What both of you changed is refused.** When the owner changed the same board key, element property, text or order, the whole publish is refused (`conflict`) and nothing is written. Each conflict names the file and what changed, such as `project/canvas.json (board hero: x changed since your read)` or `project/boards/hero.html (element title: color changed since your read)`. Read again, apply your change to what you read, and publish again. Use `force: true` only when the user asked you to overwrite their edits.

## Held boards and warnings

- **`warnings`** name what the loader dropped (an unsupported property, an unknown attribute), defaults it filled (a board placed or sized for you), and pictures the design's assets do not hold. A dropped value is not in the design: fix the board if it mattered.
- **`held`** names boards that failed structurally, with their reasons. Nothing of a held board changes; the owner sees it read-only, and your next valid file for it clears the hold. A common cause on a busy board is more than 24 pinned (`position:absolute`) children in one host: group them into a few pinned `div`s, each holding up to 24.
- **Refusals** name the problem and write nothing: a frame over 16,384px a side or 8,192 squared in area, more than 200 boards, a malformed manifest, or `sections` in `canvas.json` (a deck's outline; a design has none).

A manifest entry whose file you have not sent is kept as an empty board with no source; send its file to fill it, or `null` to remove it.

## Assets and faces

Pictures are uploaded files: call `artifact_upload_asset`, then use the `assets/<name>` ref it returns as a `src` or in a `url(…)`. A URL or `data:` URI holds the board. Faces go in `canvas.json`'s `faces`, at most four, as a deck's do; prefer the design system's. A Google Fonts `href` naming that family alone is fetched once into the design's assets when its licence is OFL, and draws offline from then on; any other licence is refused by name in `warnings`, and the face draws as its fallback. Leave the `google` key MAWS adds to a face alone.

## Comments

The user comments on an element or on a whole board. `artifact_comments` lists the threads, each naming the board as `slideId` and the element as `elementId` (empty for a comment on the board itself), quoting the element's text or the board's title. A thread whose element was deleted is orphaned and keeps its last text. When a comment asks for a change, publish it, then answer in the thread with `artifact_reply`. Resolve with `artifact_resolve` only when the user asked or the thread is yours.

## Working with a design system

A design system governs every design: its own, else its Space's default, then the user's, then the house system. `artifact_create` returns the governing system's `DESIGN.md`; read it first, since its hard don'ts bind every board. Style by token with a fallback (`var(--ds-color-accent, #2b7a78)`) so a theme change restyles every board; on a board the type roles (`var(--ds-type-body-size, 16px)`) are the system's screen sizes. Text you do not size takes the screen defaults: body 16px at line height 1.5, `h1` 32px, `h2` 24px, `h3` 20px, headings at 600. Put a design-only change in `canvas.json`'s `dsOverrides`, never in the system.

## Exporting

`artifact_export` never crops a board and never fits it to a paper size:

- **PNG** is one board: `board` names it (the first in `order` by default), drawn at its native size. A side over 8,192px is refused naming the board, its size and the largest `scale` that fits; export again with that `scale` (0.1 to 4).
- **PDF** has one page per board at the board's own size: `boards` lists them (all, in order, by default). A page side over 19,200px is refused unless you give a `scale` that brings it under.

A held board, or one with no source, is refused by name: fix it first. Designs export only to PNG and PDF.

## Before you finish

- Read the design back: no board held, every warning resolved or deliberate, every board in `order`.
- Check the boards against the design system's hard don'ts and contrast rules, and say which you checked.
- Answer the comments you were sent in their threads.
- Tell the user what you made or changed, by board.
