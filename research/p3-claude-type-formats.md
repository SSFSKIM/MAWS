# Claude's artifact type formats, read from the server (U1 input to P3)

Read on 2026-10-12 through the owner's logged-in Chrome, GET only, for P3 §4.12 U1 (`docs/doperpowers/plans/2026-10-12-p3-co-work.md`).

- **Citation roots.** `T/` is `~/claude-desktop-re/artifact-types/2026-10-12/`, kept outside the repository; `T/MANIFEST.md` lists every URL with its status, size and sha256. `CC:<n>` is line `<n>` of `~/claude-code-bundle/2.1.292/cli.pretty.js`.
- **The catalog.** `GET /api/frame/types?org=…` (a 404 without `org`) lists five Anthropic types: Dashboard, Design, Design System, Docs and Slides.
- **Slugs.** The live slugs are the second UUID of each pair in Desktop's table; Desktop labels the first one `staging`.

## Slides

**Files** (`T/slides/SKILL.md:26-48`; `T/slides/artifact-type/reference/deck-files.md`).

The index `project/deck.json` is `{"v":4, "createdOnFiles":{"v":1,"at"}, "lists":"css", "title", "cover", "order", "sections", "faces", "designSystems"}`:
- `cover` is the cover slide's id.
- `sections` maps a key to `{description, start}`; an empty section has `before` in place of `start`.
- `faces` holds at most 4 entries, keyed by the family lowercased with spaces as `-`. Each is `{family, href}` (a Google Fonts css2 link) or `{family, src}` (`/_blob/<id>` or a `project/ds/…` path), never `data:`.
- `lists` appears only in an index the agent creates (meaning undocumented).
- An edit keeps "every key you are not changing, named here or not".

Each `project/slides/<id>.html` is "EXACTLY ONE `<section id="<id>" …>` … no `<html>`, `<head>`, `<title>`, `<link>`, `<style>` or `<body>`":
- The id matches `[A-Za-z0-9_-]{1,64}` and equals the file name.
- A file that `order` omits shows last.
- Notes are plain text in one trailing `<aside>`, at most 4,000 characters, readable by every viewer.

A deck holds at most 512 files and 256 MB, and one call carries at most 16 MB.

**Canvas** (`SKILL.md:79-98`; `format.md:72`; `styles.md:23`).
- 1920×1080 with 128px margins, so the content area is 1664×824.
- The section always paints a `background` and holds the text defaults and the layout.
- Children flow, or are pinned with `position:absolute`. A `position:relative` div can host at most 24 pinned children.
- Paint order is source order, with no z-index, and "all flow content paints as ONE layer where the first flow child sits": backdrops come first.

**The closed CSS list** is one generated table, `T/slides/artifact-type/reference/format.md:9-67`. Each line gives a property, its value grammar, its range and the elements it applies to.
- Lengths are `Npx` or a bare number, "no em rem vw vh %". `%` is allowed only where the table says (offsets, pinned sizes, flex shares, radius), and `letter-spacing` also takes `Nem`.
- Colours are `#hex | rgb[a]() | hsl[a]() | named | transparent — no currentcolor, var()`.
- The table covers:
  - layout: position, offsets, sizes, flex and grid (at most 24 tracks; no minmax or areas; `span INT` only), aspect-ratio, padding and overflow;
  - type: the font properties, line-height, letter-spacing, alignment, transform, white-space, decoration, tabular numbers and text stroke;
  - paint: colour, a background or one 2-to-8-stop gradient, `background-clip:text`, borders ("one style+color"), radius, box and text shadows, opacity, transforms (scale 0.5 to 2, skew up to ±60°), filter, backdrop-filter, mix-blend-mode and object-fit.
- `margin`, `box-sizing` and `grid-template` are "accepted as no-ops only" (0, border-box, none).

**Elements.**
- Text: `h1 h2 h3 p ul ol li br`.
- Inline: only `<b> <i> <u> <a href="https://…"> <span style="color:…">`, with "no sizes or fonts on spans".
- `div`.
- `img`: `alt`; `src` is `/_blob/<id>` or a `project/ds/…` path, never a URL; optional `data-crop`.
- `table`: at most 100×24, no colspan or rowspan, background on `tr` only.
- Inline `svg`: at most 52 KB, `aria-label` as its alt, no script or URLs, `<text>` warned.
- `hr`.
- `x-shape kind`: ellipse, diamond, four arrows or a line; SKILL adds rect and rounded.
- `x-icon name`: 30 fixed names.
- `x-connector x1 y1 x2 y2 head route from`.
- `x-embed`: a direct pinned child of the section, a sandboxed `allow-scripts` iframe with no network, at most 16 KB and at most 8 per slide. It is flattened in PPTX and PDF.

**Recognised attributes.**
- On the section: `data-transition` (fade, push or magic; magic move matches equal `id`s) and `hidden`.
- On pinned children: `data-build-in` and `data-build-out` (an effect, an order, `auto`).
- `data-fit`: none, shrink (the default: down to 60% or 8px, then clip) or grow.
- `data-group`: a group the user made.
- `data-video*` on an `img`.
- Every other `class` or `data-*` is "ignored".

**Limits** (`format.md:95`): 15 nested divs; 20,000 characters or 100 inline marks of text; 4,000 table cells or 200 elements per slide; 500 slides.

**Errors and normalization.**
- The skill's build sorts problems into errors, warnings (blocking unless `--allow-warnings`), notes (equivalent heals, such as `pt`→`px`) and advisory layout lints.
- In a deck made from the type, "nothing checks here; the page drops X or holds the slide read-only" (`SKILL.md:125`). A held slide is reported as `slideHeld` and `slideHeldWhy` (`view-state.md:66`).
- "The editor re-saves your file normalized … check differences by what they mean, not by comparing bytes" (`styles.md:41`).

**Fonts** (`fonts.md`).
- Two families are the norm and four the cap.
- The basic faces are Arial, Verdana, Tahoma, Trebuchet MS, Georgia, Times New Roman, Courier New and Brush Script MT. An unknown family falls back to its generic.
- PPTX "either names your faces … or, downloaded with basic fonts, uses each stack's basic face", or exports "slides as pictures"; it never embeds fonts.
- "px = pt × 2" (`craft.md:37`).

**Design systems** (`deck-files.md:17-27`).
- An install copies `tokens.json`, and the fonts and pictures the deck uses, to `project/ds/<folder>/` (the folder matches `[a-z0-9][a-z0-9_-]{0,63}`).
- It adds a record `{title, namespace, artifact, version, copiedAt[, unpinned]}` to `designSystems`, at most four of them.
- The Theme, colour and Text style menus "offer a system only when the tokens file and the record are both there". Slides keep literal values.

**The view context** given to the agent is `{mode, deck, slideId, slideTitle, slideIndex, slideCount, dirty, selected, selection, edits}` (`view-state.md:58-76`). Elements are named by their own `id` or a minted `e<n>-<hash>`; flow children are named by `/index` paths.

## Design (canvas)

**`project/canvas.json`** is `{"v":3, createdOnFiles, title, launch, pages, boards, order, notes, designSystems}` (`T/design/SKILL.md:33`).
- `boards` maps an artboard path to a frame `{x,y,w,h}` (40 to 8000 px). Optional keys: `title`, `page`, `expand:"fill"` (a page), `print`, `paper`, `is_interactive`, `guides` (up to 6), `radius`.
- `notes` holds at most 200 titles or stickies.

**An artboard** is a whole HTML document, `project/<name>.dc.html` (`T/design/artifact-type/reference/format.md`):
- `<script src="./support.js">` kept exactly;
- an `<x-dc>` root, and `<helmet><style>` only for page basics;
- inline styles, which are what the properties panel edits;
- `{{dotted.path}}` holes, never expressions;
- events as `onClick="{{fn}}"`;
- `<sc-for>`, `<sc-if>` and `<dc-import>`;
- a `<script type="text/x-dc" data-dc-script data-props='…'>` holding `class Component extends DCLogic { renderVals() }`.

Its `data-props` entries become Tweaks controls ("levers, not copy"). It may not load from the network (except Google Fonts and `/_blob/` uploads), use `iframe`, or build UI from script.

**Design-system components** mount as `<x-import component-from-global-scope="Ns.Comp">` over React 18 (`design-system-components.md`). Unlike Slides, a Design install also copies the system's stylesheets, scripts and `tokens.css`, so artboards may use its `var(--…)` tokens.

## Design System

**The index** is `project/design-system.json`: `{"v":3, "layout":"files", createdOnFiles, title, namespace, libraries, sections, groups, assetGroups, blobs, docs}`. It is written in the last call (`T/design-system/SKILL.md:18-39`).

**Files under `project/`:**
- `README.md`, the brand book, plus other `*.md` sections;
- `tokens.json`;
- `components/bundle.js`, one script assigning `window.<namespace>`, with `bundle.css`, `index.d.ts` and `lib/*.js`;
- per component, `components/<Comp>/README.md` and `preview.html` (line 1 is `<!-- @dsCard … -->`);
- a Cover preview;
- `fonts/`;
- `assets/<Group>/` (uploads).

The page generates `tokens.css`, `manifest.json` and the `api/` cards. A system holds at most 1,008 files and 256 MiB.

**`tokens.json` is not DTCG.** "A name-to-value MAP (the DTCG / W3C token format …) is valid JSON the page CANNOT read" (`SKILL.md:99-113`; grammar `format.md:73-118`). The shape:
- Every family is `{note?, tokens:[{name, value, usage}]}`.
- `color` adds `themes`. A value is a string or a theme→value map, and a missing theme inherits the first.
- `type` is `{fonts:[{family,file,weight,style}], families:{key: stack}, groups:[{name, family, styles:[{name, fontSize, lineHeight, fontWeight, …}]}]}`.
- Names match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` and share one `--name` namespace.
- Colour values: hex, `rgb/hsl/oklch/…()` with numeric arguments, or the alias `"{token}"`. Named colours, `var()` and `color-mix()` are not allowed.

## Docs

**The type holds no content.** A doc lives in the Claude Docs service and is read and written only through its connector (`T/pages/SKILL.md`). The viewer is Tiptap 3: the readable part of `pm-schema-*.js` is Tiptap's `code` and `codeBlock` extensions with Tiptap 3's markdown hooks.

**The connector.** `https://api.anthropic.com/v1/pages/mcp`, protocol `2026-07-28` (`T/pages/connector/`). Its eight tools:

| tool | what it does |
|---|---|
| `read` | reads an object; `ref {object: project\|file\|node\|utterance\|enum\|blob, id}` with `container {kind, id, version}` |
| `create` | creates a `file` (tab), `node`, `utterance` (comment), `enum` or `blob` |
| `batch` | creates a doc, "or apply several operations to one doc atomically" |
| `update` | edits; `answering: <root comment id>` for a comment-driven edit |
| `delete` | deletes; "a doc keeps at least one tab" |
| `query` | reads comment history |
| `export` | markdown, text, html, docx, pdf or notion; at most 11 MB |
| `guide` | returns topics: editing, tabs, comments, charts, diagram, uploads and more |

The schemas are loose: `payload` is typed `object | string`.

**The server instructions** give the write syntax.
- A doc is born as `batch(container={"kind":"project","create":{"name","doc":{"blocks":{"s1":{"type":"pending","intent":"…"},"me":{"type":"mention","user":"me"},…},"markdown":"# <title>\n\n<?claude block me?>\n\n<?claude block s1?>"}}})`. Markdown carries `<?claude block k?>` markers bound to typed blocks.
- `pending` placeholders are later replaced section by section.
- Every read and write returns a per-tab `rev`, and a `sinceRev` read shows what changed.
- A comment turn names `f-<tab>#<node>/<block>;thread=<root>` and is answered in the doc's own thread.

## Dashboard

**Storage.** A dashboard is db documents written with `write_db`; it publishes no files (`T/dashboard/SKILL.md`):
- `dash/meta {title}`;
- `dash/params {name: default}`;
- `datasets/<id> {title, description, source, updated:{at,by}, schedule?, staleAfterHours?}`. A `source` is either `{kind:"query", connector, tool, args}`, run on each reader's own connection with `{{param}}` substitution, or `{kind:"file", url:"/_blob/<id>", name, format}` for CSV, TSV or JSON up to 8 MB;
- `files/index.html {text}`.

A document holds at most 256 KB, and a batch at most 50 writes or 1 MB. A reader's page writes `data/users/me/runs` with its failures.

**The page.**
- It runs inside `#dash-root` with d3 v7 and no network, modules or storage.
- Every figure is marked with `data-source`, `data-field` and `data-where` or `data-row`; tables add `data-row-key`.
- Marks are filled in `dash.onData`; derived values come from `dash.calc` and `dash.loader`.
- Colours come from theme tokens (`--color-fg` …) and type from `--font-anthropic-sans`/`-serif`.

## Differences from the P3 spec's §4.5

**Right:**
- the deck.json plus slide-file split, with one `<section id>` per file and no `html/head/style/body`;
- 1920×1080 and a closed list of inline styles;
- flex, grid and absolute positioning;
- no classes, style blocks, margin, z-index, em or `var()`;
- the four custom elements, the embed's 16 KB and 8 per slide;
- the trailing `<aside>` for notes and inline SVG;
- `data-fit` none/shrink/grow, exactly Claude's attribute;
- z-order as DOM order, and drag-out-of-flow making an element absolute;
- 1 px = 0.5 pt, SVG rasterized for PPTX, PDF by print;
- menus reading the design system.

**Wrong or imprecise:**
1. *Colours "hex or rgb".* Claude also takes `hsl[a]()`, named colours and `transparent`; named colours are skipped in PPTX with a warning. *Lengths "px".* Bare numbers are px, `%` works where listed, and `letter-spacing` takes `em`.
2. *"No margin".* Margin is accepted as a no-op at 0, so it should be dropped silently at 0.
3. *The closed list.* §4.5 names only categories. Adopt `format.md:9-67` property for property as the starting list, and diverge only by decision.
4. *Elements.* §4.5 is missing `li`, `br`, `u`, `hr`, `tr/th/td`, `aside` and `section`. Inline formatting is only b, i, u, an https link and a colour span, so the slide-text Tiptap schema must be no wider.
5. *"Dropped on load and reported as warnings."* Claude has errors, warnings and notes, and it holds an unreadable slide read-only (`slideHeld`) instead of trimming it. Recommend: drop and warn for unknown properties; hold the slide for structural failures.
6. *Byte-identical round-trip.* Claude normalizes and says to compare meaning, not bytes. Recommend idempotent normalization: `serialize(parse(x))` is a fixed point. P3-C's acceptance "round-trips byte-identically" holds only for a corpus already in canonical form.
7. *deck.json.* Claude writes `v`, `createdOnFiles`, `cover` and `lists`; nothing mentions `attachments`. `designSystems` is a list of up to four records, not one "design system".
8. *Element identity.* Claude ignores unknown `data-*`, so `data-id` (and the PPTX `shapeName = data-id`) would not survive a Claude re-save. Claude keys elements on `id`. Recommend that Y.Map ids serialize as `id`.
9. *Fonts "embedded" in PPTX.* Claude never embeds. It names faces, substitutes basic faces or exports pictures, from at most 4 Google or uploaded families. Recommend those three variants as the baseline; embedding is extra and fragile.
10. *Decision Log 12 (`var(--ds-*)`).* The ruling stands, but Claude's grammar forbids `var()`. A token-using deck will not open cleanly in Claude Slides, so an export meant for Claude must resolve tokens to literal values.

**Missed:**
- transitions, including magic move;
- builds;
- hidden slides;
- video;
- `data-crop`;
- `src`-less `<img>` placeholders;
- `position:relative` hosts;
- the single flow paint layer;
- `<div data-group>` as the group form, not "absolute divs";
- every numeric limit above;
- the view-context record, a model for MAWS's "this slide" grounding.

Layouts with placeholders, per-slide history and the presenter window do not exist in Claude's type; they are MAWS's own.

**Beyond §4.5.**
- §4.6's "W3C DTCG 2025.10, the only source" is the opposite of Claude's list-shaped `tokens.json`, which rejects DTCG maps. If systems and skills are to transfer, D needs at least import and export of Claude's shape.
- §4.4's agent syntax is close to the Docs connector's: markdown with typed markers (`<?claude block k?>` against MAWS's `<chip/>` and `^id`), atomic batches and per-tab revisions. Claude's `pending` blocks and its `answering` link from an edit to a comment are worth adopting.

## What could not be fetched, and why

- **Sheets and Whiteboard.** `GET /api/frame/types/{prod slug}` returned 404: they are not in this account's catalog. Their staging slugs were not tried.
- **The Docs connector endpoint.** It is on api.anthropic.com, cross-origin from claude.ai, and Claude Code sends it with an Authorization header (`CC:865252`, `CC:898132-898139`). It was not called, and no POST was sent.
  - The tool list came from claude.ai's own `GET /api/organizations/{org}/mcp/servers/{uuid}/tools/list`; `…/remote_servers/{uuid}/tools` returned 404.
  - The server instructions came from the web app's `GET …/mcp/v2/bootstrap` event stream, filtered in the page to the Docs server's event; nothing about other connectors was kept.
- **The `guide` topics** need a `tools/call`, so they were not read. They hold the full Docs block vocabulary.
- **Type code.** The files endpoint truncates large files: `pm-schema-*.js` arrived as 20,739 of 229,810 bytes. No `app.js` or `index.html` was fetched, and editor behaviour (snapping, undo, the PPTX writer) is not described in any type file.
- **Named but not served:** `editor-and-saving.md`, `reference/store.md`, and the appifact-slides skill's `make.ts` and `validate-content.ts`, which hold the actual validator.
