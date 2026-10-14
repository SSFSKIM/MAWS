# Presentation: guide

A slide deck: one HTML section per slide on a 1920 by 1080 canvas, in a closed dialect, presented and exported to PPTX and PDF.

## When to use this kind

Make a presentation when the user wants slides: a talk, a pitch, a lesson, a review to present or hand out as PPTX or PDF. The deck is Claude's Slides format, so a deck and a slides skill move between Claude and MAWS. For prose meant to be read, make a document; for a one-off interactive page, an html artifact.

## Creating one

Call `artifact_create` with `kind: "presentation"` and a `title`:

- **From files**, the usual way: `files` maps `project/deck.json` (the index: `title`, `cover`, `order`, optional `sections` and `faces`) and one `project/slides/<id>.html` per slide, each exactly one `<section id="<id>">` whose id is its file name. Plan the outline first, then write every slide in one create.
- **Empty**, with no `files`: the deck starts as one cover slide (`cover`) titled from `title`, styled by the design system's roles. Read it, then publish your slides.

The answer carries the format reference: the elements, attributes and CSS the dialect takes, its limits, and examples. Write only what it lists: anything else is dropped with a warning or holds the slide.

## Reading and editing

`artifact_read` returns the deck's files and its `revision`. In what you read, every addressable slide element carries an `id`: the section and every text, `div`, picture, table row, shape, icon, connector, line, `svg` and embed. Table cells carry none, because they are positional. List items and inline markup (`b`, `i`, `u`, `a`, `span`, `br`) carry none either, because they are part of their text element. Keep the ids when you edit. Comments, history and the owner's selection follow an element by its id, and an element you rewrite without one may become a new element. Files come back normalized (attribute and declaration order, colours, numbers, whitespace), so compare them by meaning, not by bytes.

To change the deck, call `artifact_publish` with the `baseRevision` your last read (or create, or publish) returned and only the files you changed: a slide's whole new text, `null` to remove a slide, `project/deck.json` when the order, sections or title change. A new slide goes into `order` where it belongs; a slide file the order leaves out shows last. Several files in one publish land together at one revision or not at all, so change a deck-wide property in one publish.

The publish follows the three layers of Claude's protocol:

1. **Your read must be the latest one you made.** A `baseRevision` other than your last read's is refused (`staleBase`, naming the live revision): read again.
2. **What nobody else touched merges.** The owner may be editing the same deck. Your changes are compared property by property with what you read and with the live deck: a property, a text or a slide's place that only you changed is applied, and everything the owner changed is kept.
3. **What both of you changed is refused.** When the owner changed the same property, text or order since your read, the whole publish is refused (`conflict`) and nothing is written. Each conflict names the file and what changed, such as `project/slides/plan.html (element title: font-size changed since your read)`, `text of title: changed since your read`, or `order: changed since your read`. Read again, apply your change to what you read, and publish again: the owner's edit is the newer intent. Use `force: true` only when the user asked you to overwrite their edits. It overwrites exactly the conflicting properties.

A publish that changes nothing writes nothing.

## Held slides and warnings

A publish or read answer may carry two more fields:

- **`warnings`**: what the loader dropped, each naming the file, the slide, the element and the property (an unsupported property, an unknown attribute, a value out of range), plus pictures and faces the deck cannot draw. A dropped value is not in the deck: fix the slide if it mattered. `notes` counts the heals to an equivalent (`pt` to `px`, `<strong>` to `<b>`), which need nothing from you.
- **`held`**: slides that failed structurally (text directly in a `div`, a tag out of place, a limit passed, an image URL), each with its reasons. Nothing of a held slide changes. The owner sees it read-only, and its file reads back as you sent it. Fix every reason and publish the slide again: your next valid file for it clears the hold. Never leave a deck with a held slide.

## Assets and faces

- **Pictures** are uploaded files. Call `artifact_upload_asset` with the file (under the working directory), then use the `ref` it returns, `assets/<name>`, as the `src`. A URL or a `data:` URI holds the slide. Claude's `/_blob/<id>` and `project/ds/<folder>/<file>` are kept but draw as placeholders until you upload the file and use its `assets/` ref. A picture whose asset is missing draws as a placeholder and is named in `warnings`.
- **Faces**: prefer the design system's (`var(--ds-font-display)`, `var(--ds-font-body)`). A face of your own goes in `deck.json`'s `faces`, at most four. An uploaded font file is `{"family", "src": "assets/<name>"}`. A Google Fonts `href` is named but never fetched, so it draws only when the Mac has the face installed, else as its generic. Upload the font file when the face matters.

## Working with a design system

A design system governs every deck: the deck's own, else its Space's default, then the user's, then the house system. `artifact_create` returns the governing system's `DESIGN.md`, or `artifact_describe_type` does. Read it first: its hard don'ts bind the deck.

- **Style by token, not by value.** Use `var(--ds-color-*)`, `var(--ds-font-display|body|mono)`, `var(--ds-space-1…8)`, `var(--ds-radius-*)` and `var(--ds-shadow-*)` with a fallback, such as `var(--ds-color-accent, #2b7a78)`. A token change or a system switch then restyles the deck. Another `--ds-` name works only where the system defines it, so always give it a fallback.
- **Set type by role.** For a title, heading, body, caption or quote, take the role's family, size, line height and weight: `font-size: var(--ds-type-h2-size, 64px); line-height: var(--ds-type-h2-line, 1.15); font-weight: var(--ds-type-h2-weight, 600)`. Inside a deck, the role sizes are the deck's larger scale.
- **Build from the system's layouts.** The system's `layouts/*.html` (read the system with `artifact_read`) are slides with `data-ph` placeholders. Copy one as a new slide, give it the new slide's id, fill the placeholders, drop the `data-ph` attributes, and keep its structure.
- **Overrides belong to the deck.** When the brief asks this deck for a different value, set it in `deck.json`'s `dsOverrides` (`--ds-*` name to value). Do not edit the system for one deck's sake.

## Before you finish

- Read the deck back. No slide is held, and every warning is resolved or deliberate.
- Every slide id is in `order`, `cover` names the first slide, and the slides read as the outline you planned.
- Text stays at 24px or more, inside the 128px margins, and fits its box. A sized box shrinks its text to fit (to 60 % at most, then clips), so shorten text rather than rely on it.
- Check the deck against the design system's hard don'ts and contrast rules, and say which you checked.
- Tell the user what you made or changed, by slide.
