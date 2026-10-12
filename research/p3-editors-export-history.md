# P3 editors, export, version history, design system, agent editing: research

2026-10-12, for P3's co-work layer (`docs/charter.md`). Package facts are from `npm view` and the GitHub API on this date. Electron 44.4.5 is Chromium 152 ([releases](https://releases.electronjs.org/releases.json)). Not repeated here: `research/p3-yjs-store.md` (store, ids, history substrate) and `research/p3-claude-artifacts-suite.md` (Claude's artifacts, read from the clients). "Vault note" is the owner's `Claude Docs study` note: Claude's self-report from a test drive, not verified internals.

## 1. The slide canvas editor

**Canvas frameworks fail both hard requirements:** every element must stay selectable and restyleable, and the deck must round-trip to the HTML dialect.

| Route | Licence, Oct 2026 | Fit |
|---|---|---|
| tldraw 5.5.2 | [Licence](https://github.com/tldraw/tldraw/blob/main/LICENSE.md): development only. Production needs a [key](https://tldraw.dev/sdk-features/license-key): a 100-day trial, a commercial key quoted by sales (reportedly about [US$6k/yr](https://biggo.com/news/202509190115_tldraw_SDK_4.0_Licensing_Debate)), or a discretionary hobby key that keeps the watermark. Without a key, production stops rendering after 5 s. | Infinite whiteboard with its own shape store |
| Excalidraw 0.18.1 | MIT | Hand-drawn whiteboard; no rich text or CSS layout |
| Polotno 4.15.3 | Commercial, [by quote](https://polotno.com/sdk/pricing), [from US$249/mo](https://polotno.com/sdk/product/compare/polotno-sdk-vs-konvajs) | Canva-like, on Konva, with a JSON model |
| Fabric.js 7.4 | MIT | Text editing on the canvas; no flex or grid |
| Konva 10.7 | MIT | Good transform handles; [no text editing](https://konvajs.org/docs/sandbox/Editable_Text.html) |
| Reveal.js 6.0 | MIT | A presenter, not an editor |
| DOM + react-moveable / interact.js / dnd-kit | MIT | react-moveable has rotate, group and guideline snapping, but its last release was Dec 2023, its last push Jun 2024, and 454 issues are open. interact.js is pointer plumbing only. dnd-kit reorders lists. |

A canvas scene graph cannot hold flex or grid: import would flatten it to absolute boxes for good. Canvas text is missing or not ProseMirror. In the DOM, the dialect renders as itself.

**The DOM route is bounded work.** [PPTist](https://github.com/pipipi-pikachu/PPTist) (AGPL-3.0, Vue, 9.4k stars, active) is a DOM slide editor with ProseMirror text and pptxgenjs export. Its whole transform layer is about 1,450 lines of hooks: drag with alignment snapping 377, scale 667, rotate 99, marquee 174, select 127. Read it for design only, because its licence is AGPL.

**What Google Slides has that a minimal editor needs** ([arrange](https://support.google.com/docs/answer/1696521), [text fitting](https://support.google.com/docs/answer/10364036), [themes](https://support.google.com/docs/answer/1705254), [API inheritance](https://developers.google.com/workspace/slides/api/concepts/page-elements)):
- **Snap to guides**, on by default: coloured lines show edge and centre alignment with objects and the slide. Grid, user guides and rulers are optional.
- **Arrange:** order, align, distribute, centre, rotate and flip, group, and multi-select by shift-click or marquee.
- **Per-box text fitting:** none; "Shrink text on overflow" (placeholder default); "Resize shape to fit text" (text-box default).
- **Themes** (colours, fonts, backgrounds, layouts) edited in Theme builder. Slides inherit placeholders from a layout, layouts from the master; 12 colour slots, editable on the master.
- Speaker notes, filmstrip reordering, crop, present mode.

**Recommendation: a DOM editor with a transform layer of our own.**
- **Model.** Render the dialect itself. Edit an id-keyed element model that serialises canonically to and from it (`p3-yjs-store.md` §6). A `data-id` on every element anchors comments and agent edits.
- **Free elements** (absolute) get handles writing left, top, width, height and rotate. **In-flow elements** (flex or grid children) restyle the same way but move by reordering within their container, as in Figma's auto layout; "Detach" makes one absolute at its measured rect. A group is an absolute div; z-order is DOM order.
- **Handles** go in an overlay outside the scaled slide, so they keep their size at any zoom. Snapping covers slide edges and centres, sibling edges and centres, and equal gaps. Borrow moveable's MIT math rather than take on the unmaintained package.
- **Text.** One Tiptap instance mounts into a box on double-click, with a schema restricted to the dialect. Text fitting is a `data-fit` attribute (none, shrink or grow), measured at render time.
- **Undo** is one deck-level stack: one entry per gesture, and one per text session.
- **Layouts** are design-system templates with `data-ph` placeholders.
- **dnd-kit** is for the filmstrip only.

## 2. PPTX export

**pptxgenjs 4.0.1** (MIT, [docs](https://gitbrent.github.io/PptxGenJS/), last released 2025-06):
- **Units.** Inches for geometry and points for type; EMU (914,400 per inch) internally. `LAYOUT_WIDE` is 13.333 × 7.5 in.
- **Text** is an array of runs, each with its own bold, italic, underline, strike, colour, face, size, highlight, `charSpacing`, super/subscript and link, plus bullets, line spacing, `margin` and rotation.
- **Shrink-to-fit does not work.** `fit:'shrink'` writes an empty `<a:normAutofit/>`. The source says "Shrink does not work automatically - PowerPoint calculates the `fontScale` value dynamically upon resize", so text overflows until it is edited in PowerPoint.
- **Shapes.** About 200 presets, `custGeom`, dashes, flips and shadows. Fills are solid only.
- **Also:** native tables (spans, auto-paging); SVG, which renders only in current PowerPoint and so needs a PNG fallback; native editable charts (embedded `.xlsx`); plain-text `addNotes`; `defineSlideMaster`. The theme sets only heading and body fonts (colours are hard-coded to Office's). **No font embedding.**
- **More traps** ([Anthropic's pptx skill](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md)): no `#` in hex; option objects are mutated in place; a negative shadow offset corrupts the file; use `charSpacing`, not `letterSpacing`.

**Prior art for measured geometry:**
- **[dom-to-pptx](https://github.com/atharva9167j/dom-to-pptx) 2.1.2** (MIT, Sept 2026). It "measures computed layout from the browser (getBoundingClientRect) and maps positions/sizes precisely to PPTX inches", so flex and grid export correctly.
  - It handles rich-text runs, gradients (as vector SVG), shadows, per-corner radius, tables and `data-pptx-notes`.
  - For rotated elements it uses `offsetWidth` about the rect's centre.
  - It **embeds fonts**: EOT data written to `ppt/fonts/*.fntdata`, listed in `<p:embeddedFontLst>`.
- **Anthropic's html2pptx** (anthropics/skills, Oct–Dec 2025, proprietary). Playwright renders and pptxgenjs writes. It used a constrained dialect (text only in p, h1–h6 and lists; backgrounds and borders only on divs; chart placeholders) and validated overflow. It was replaced in Feb 2026 by plain pptxgenjs scripts.
- **[agent-skill-html2pptx](https://github.com/460707300-tech/agent-skill-html2pptx)** bakes decorative layers into one background image and checks output by render-and-compare.
- **Claude Slides** keeps "a limited kind of HTML … set up so it can turn into real slides" (vault note); its PowerPoint export offers "Current fonts", "Basic fonts" and "Slides as pictures" (`p3-claude-artifacts-suite.md` §1).

**Fidelity limits:**
- **Wrapping:** PowerPoint's metrics can break a line one word earlier. Embed fonts, zero the margin, set exact line spacing, add 1–2 % width slack; an optional "lock lines" mode inserts soft breaks where `Range.getClientRects()` ends each line (exact, but no reflow).
- **Autofit** is never recomputed: write explicit sizes.
- **Gradients, filters, blend modes, `clip-path`, backdrop blur:** rasterise (`capturePage(rect)`) or use SVG. Per-side borders become separate lines.

**Recommendation: an in-house measured-geometry mapper over pptxgenjs, in a hidden 1920×1080 BrowserWindow.**
1. Await `document.fonts.ready`.
2. Use `LAYOUT_WIDE`, so that 1 CSS px = 6,350 EMU = 0.5 pt exactly.
3. Map one-to-one:
   - text containers → text boxes with runs;
   - styled divs → shapes;
   - `img` → pictures;
   - `svg` → SVG with a PNG fallback;
   - `table` → native tables;
   - chart elements → native charts;
   - notes → `addNotes`.
4. Set each `shapeName` to the element's `data-id`.
5. Post-process the zip: embed fonts (dom-to-pptx's MIT EOT module) and write the design system's 12 colours into `theme1.xml`.

A closed dialect deserves a deterministic mapping rather than dom-to-pptx's generic heuristics. Computed styles make `var(--ds-*)` free at export. Gate the exporter with a LibreOffice render-and-compare test.

## 3. DOCX, PDF and Markdown

**DOCX.**
- **[docx](https://github.com/dolanmiu/docx) 9.10.0** (MIT, Node and browser, released 2026-10-10): styles, numbering, tables, images, headers, sections, footnotes, a TOC field, **comments**, **tracked changes** (`InsertedTextRun`/`DeletedTextRun` with author and date), **font embedding** and a **document theme** (12 colours, heading and body fonts).
- **[prosemirror-docx](https://github.com/curvenote/prosemirror-docx) 0.6.1** (MIT, last released 2025-07) is a node and mark serializer over docx, in prosemirror-markdown's style. It is write-only.
- **Tiptap's Export DOCX** is Pro, on a private registry.

**Recommendation for DOCX:** an in-house serializer over `docx`, modelled on prosemirror-docx.
- Map the design system to the Word theme and named styles (Title, Heading 1–3, Normal, Quote, Code), so the file restyles in Word.
- Export anchored comments as Word comments.
- Offer "export changes since version N" as tracked changes.

**PDF.**
- **[`printToPDF`](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)** takes `pageSize` (named, or inches), `margins` (inches), `preferCSSPageSize`, `printBackground`, header and footer templates (`date`, `title`, `url`, `pageNumber`, `totalPages`), and the experimental `generateDocumentOutline` and `generateTaggedPDF`.
- **Chromium 152 supports** `@page` size, margins, named pages and `break-*`. Margin boxes with `counter(page)` and `counter(pages)` arrived in [Chrome 131](https://developer.chrome.com/blog/print-margins).
- **Chromium still [lacks](https://github.com/pagedjs/pagedjs/issues/248)** `string-set`, running elements, `target-counter()` (so a TOC cannot show page numbers) and footnotes.
- **Decks:** `@page {size: 1920px 1080px; margin: 0}` and `section {break-after: page}`.

**Recommendation for PDF:** one hidden-window print path for both kinds.
- Running heads and page numbers go in margin boxes, styled from tokens.
- `generateDocumentOutline` gives bookmarks.
- No TOC page numbers in v1; paged.js (MIT) can add them if wanted.

**Markdown.** The candidates are prosemirror-markdown 1.13.8 (MIT, on markdown-it) and @tiptap/markdown 3.31.4 (MIT, on Marked, where each extension declares its own markdown; labelled an "early release"). `p3-yjs-store.md` §3 round-tripped a sample through @tiptap/markdown byte-identical.

**Recommendation for Markdown:** use @tiptap/markdown as the single serializer, in two modes:
- export: GFM with the ids stripped;
- agent: ids kept (§6).

## 4. Version history: behaviour to match

**Google Docs** ([help](https://support.google.com/docs/answer/190843), [Zapier](https://zapier.com/blog/google-docs-revision-history/), [HowToGeek](https://www.howtogeek.com/733388/how-to-check-version-history-in-google-slides/), [Ask Dave Taylor](https://www.askdavetaylor.com/how-to-track-edits-changes-revisions-google-docs/)):
- **Entry points.** The clock "Last edit" icon at top right (hover: who and when; a **blue dot** means changed since you last viewed), File › Version history › See version history (⌘⌥⇧H), and Name current version.
- **The right panel**, newest first, "Current version" on top. Rows show a timestamp or name and the editors' colour dots; close versions fold under an Expand arrow; "Only show named versions" filters. The ⋮ menu: Name this version, Restore this version, Make a copy, and (owner) Delete this and older versions. Up to 40 named versions.
- **The preview** is read-only. With **Show changes** ticked, edits since the previous version are highlighted in each editor's colour, with deletions struck through. A "Total: N edits" counter with ↑ and ↓ steps through them.
- **Restore.** The "Restore this version" button sits beside the title and asks for confirmation. Back returns to the live document.
- **Show editors.** Right-clicking a selection lists the people who edited that range, each with the time of their latest edit.
- **[Compare documents](https://workspaceupdates.googleblog.com/2019/06/compare-docs.html).** Choose a document and fill in "Attribute differences to". The result is a new document showing the differences as suggestions under that name.
- **Since your last view,** there is only the blue dot, plus Gemini's "[Catch me up](https://workspaceupdates.googleblog.com/2025/06/catch-me-up-in-google-drive.html)" summary.

**Google Slides** uses the same panel. In the preview, changed objects are boxed in each editor's colour ([description](https://bazroberts.com/2016/06/12/google-slides-revision-history/), [CustomGuide](https://www.customguide.com/course/google-slides/version-history-google-slides)). No source confirms that the filmstrip marks changed slides; check it live before claiming parity.

**[Notion](https://www.notion.com/help/duplicate-delete-and-restore-content).** ••• › Version history. The preview highlights changes, though Notion says it "won't capture every single change". Restore is reversible. A version is recorded every 10 minutes of active editing, and again 2 minutes after the last edit. Retention is 7, 30 or 90 days, and unlimited on Enterprise.

**Claude Docs.**
- "Every change is attributed to whoever made it, whether that's a person or Claude." The history panel opens beside the text ([help](https://support.claude.com/en/articles/16923645-get-started-with-claude-docs)).
- The shell lists versions as "Version {n} · {when} · by {name}". It offers "Save version" with a Label ("e.g. Draft to legal") and a "What changed" note.
- The shell has no restore button and no diff (`p3-claude-artifacts-suite.md` §7).

**Recommendation, as a spec:**
1. **Automatic versions** at 2 minutes of human idle and every 10 minutes of activity, **at the end of every agent turn that touched the artifact** (authored by that session), and before any restore or import.
2. **Named versions:** "Save version" with a name and a what-changed note; any automatic version can also be named.
3. **The list.**
   - Grouped by Today, Yesterday and dates, with runs of automatic versions folded.
   - Each row shows author chips (the human, or an agent session in its own colour) and a one-line summary (the turn's summary, or "+n −m blocks").
   - A "Named only" filter.
4. **The preview** is read-only, with Show changes on by default: inserts in the author's colour, deletions struck through, added and removed blocks marked in the gutter, and "N changes" with ↑ and ↓.
5. **Restore** creates a new version, "Restored from …". It is never destructive. Make a copy sits beside it.
6. **Compare** any two versions by shift-clicking a second row.
7. **"See N new changes."** A pill opens compare(last seen, current) whenever an agent changed the artifact since the owner last looked. This beats Google's blue dot.
8. **Slides:** changed slides get an author-coloured edge in the filmstrip; changed elements are outlined in the author's colour and deleted ones ghosted; notes diffs sit below the slide.

The substrate is `p3-yjs-store.md` §1 and §7.

## 5. The design system object

**Claude Design** ([launch](https://www.anthropic.com/news/claude-design-anthropic-labs), [guide](https://getpushtoprod.substack.com/p/everything-you-need-to-know-about)):
- Built from codebases, design files, decks, PDFs, logos and web captures; extracts colours, typography, components and layout patterns; Draft/Published, a Default, several per team.
- **The artifact's files:** `design-system.json`, a README guide, `tokens.json`, and a README per component. `tokens.css` is generated. Claude reads the default system's README (`p3-claude-artifacts-suite.md` §4). [Community packages](https://github.com/VoltAgent/awesome-claude-design) add `colors_and_type.css`, preview cards, a UI kit and a `SKILL.md`.
- **Claude Docs has "one built-in look"**: design systems are for Slides and Design (vault note). Applying one to docs is a MAWS differentiator.

**Canva Brand Kit** ([guide](https://www.canva.com/help/brand-kit-best-practices/)): logos (PNG and SVG, per background), labelled palettes ("Primary background") with colour themes, fonts as Title, Subtitle and Body styles (size and weight only), brand voice and Brand Templates. Brand Kit Builder extracts a kit from a website or PDF.

**Google Slides theme.** Colours, fonts, backgrounds and layouts, with 12 colour slots: dark1, light1, dark2, light2, accent1–6, hyperlink and followed hyperlink ([API](https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations.pages)). The Office theme in PPTX and DOCX has the same 12 slots, plus major and minor fonts.

**[W3C DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/)** (first stable, 2025-10-28; a Community Group report): `$value`, `$type`, `$description`, `$extensions`, `$deprecated`, group `$extends`; aliases `{a.b}` or `$ref`; base types colour (`{colorSpace, components, alpha, hex}`), dimension (`{value, unit}`), fontFamily, fontWeight, duration, cubicBezier, number; composites typography, shadow, border, gradient, transition, strokeStyle; files `.tokens.json`.

**[DESIGN.md](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)** (Google Labs, Apache-2.0, alpha): YAML front matter (`colors`, `typography`, `rounded`, `spacing`, `components` with `{path}` references), then fixed sections from Overview to Do's and Don'ts. It is "inspired by" DTCG.

**Recommendation: one directory per design system.**
- `tokens.tokens.json`, in DTCG and the only source:
  - semantic roles: `color.bg/text/accent.*`, `type.title/subtitle/h1–h3/body/caption/quote`, `space.*`, `radius.*` and `shadow.*`;
  - an `$extensions["dev.maws.office"]` entry mapping the 12 Office slots and both fonts, for native theming in PPTX and DOCX.
- `tokens.css`, generated: `--ds-*` properties and type classes.
- `DESIGN.md`, the agent's guide. Its front matter is generated from the tokens.
- `layouts/*.html` and `components/*.html`: dialect snippets with placeholders.
- `assets/`: logos and **font files**, which embedding and PDF both need.

**Owner decision.** The dialect's "px-only inline styles" leaves no way to restyle a deck. Permit `var(--ds-*)` for colours, fonts and spacing, so a restyle becomes a token swap. Export reads computed values and is unaffected.

## 6. Block ids and an agent editing format

**Notion:**
- **The [block API](https://developers.notion.com/reference/patch-block-children):** UUIDs; appends of at most 100 children, two levels deep, at `start`, `end` or `after_block`; no moves.
- **The [markdown API](https://developers.notion.com/guides/data-apis/working-with-markdown-content)'s `update_content`** takes `{old_str, new_str, replace_all_matches?}` pairs. Matching is case-sensitive, and each `old_str` must match exactly one place or the call fails. `allow_deleting_content` guards child pages, and "start…end" selections are now legacy. Ordinary blocks show no ids.
- **The [rationale](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look):** markdown gives "efficient content density per LLM token", where hierarchical JSON had cost tokens and calls.

**[Google Docs API](https://developers.google.com/workspace/docs/api/concepts/structure).** There are **no stable paragraph ids**.
- Positions are zero-based `startIndex`/`endIndex` in UTF-16 code units, per segment and per tab.
- Writes go in [descending index order](https://developers.google.com/workspace/docs/api/how-tos/best-practices).
- `requiredRevisionId` rejects a write after any change; `targetRevisionId` merges it.
- `replaceAllText` and named ranges are the only stable handles.

**Claude Docs connector** (vault note): "a tree of blocks … Each block has its own ID". It is read as "a short XML-like outline" and written as "Markdown with small markers where the chips go". "I can replace a sentence by quoting its exact words, insert a section after a heading, or edit one table cell." Its tools are `read`, `create`, `batch`, `update` and `delete` (`p3-claude-artifacts-suite.md` §3).

**[Tiptap AI Toolkit](https://tiptap.dev/docs/ai/ai-toolkit/client/agents/tools)** (paid) reads chunks with `_hash` node ids and replaces or inserts around them.

**Prior art for quoted-text edits:** Anthropic's [`str_replace`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) (exact, whitespace included; errors "No match found" and "Found 3 matches … provide more context"), Claude Code's Edit (`replace_all`), [Aider](https://aider.chat/docs/more/edit-formats.html)'s SEARCH/REPLACE blocks, and Notion's `update_content`.

**Recommendation: the read format.** GFM, with ids in Obsidian's `^id` syntax: at the end of the block's line, or on its own line after a table, code block or quote.
- **Short ids.** `p3-yjs-store.md` §4 proposes 8-character nanoids; per-document base36 ids of 3–4 characters are cheaper still.
- **List items and table rows** carry their own ids.
- **Chips** are written as `<chip …/>` markers.
- **Ranged reads**, such as "from `^h7`, 40 blocks".

```
## Risks ^h7
Hiring slips to **Q4** if the offer stalls. ^p9
- Budget approval ^l2
```

**Recommendation: the write tool, one atomic batch, `doc_edit(doc, base_revision, ops[])`.**
- **Ops:**
  - `replace_text {block?, old, new, all?}`: exact and unique within the block, or within the document if no block is given. On failure, the error lists the candidate block ids.
  - `replace_block {id, markdown}`
  - `insert {after|before, markdown}`
  - `delete {id}`
  - `move {id, after}`
  - `set_cell {table, row, col, markdown}`
- **Conflicts are per block.** An op fails only if its own target changed since `base_revision`, and the failure returns that block's current text, so human typing elsewhere never fails the agent.
- **The response** carries new ids and one line per op, not the whole document.
- **Attribution.** Every op carries its session as author, which feeds §4.
- **Slides.** The agent edits the slide HTML directly, as Claude Slides does, and the editor reconciles by `data-id`.
