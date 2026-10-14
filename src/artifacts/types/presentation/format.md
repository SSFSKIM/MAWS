# Presentation: format reference

A slide deck: one HTML section per slide on a 1920 by 1080 canvas, in a closed dialect, presented and exported to PPTX and PDF.

## Structure

A deck is files under `project/`, in the shape of Claude's Slides type, so decks and skills move between the two:

| Path | What it is |
|---|---|
| `project/deck.json` | The index: the deck's title, its slides' order, sections, faces and design system |
| `project/slides/<id>.html` | One slide: exactly one `<section id="<id>">`, nothing before or after it |

**The index**, `project/deck.json` (version 4), with its keys in this order:

| Key | What it holds |
|---|---|
| `v` | `4` |
| `createdOnFiles` | `{"v": 1, "at": "<RFC 3339 time>"}`, written once when the deck is made |
| `lists` | `"css"` in an index you create for an empty deck; never added to one that has slides |
| `title` | The deck's name |
| `cover` | The cover slide's id |
| `order` | The slide ids in deck order; a slide file it leaves out shows last |
| `sections` | Your outline: any key → `{"description": "<one sentence>", "start": "<its first slide's id>"}`, or `"before"` in place of `"start"` for a section with no slides yet |
| `faces` | At most 4 typefaces the slides name, keyed by the family lowercased with spaces as `-`: `{"family", "href"}` with a `https://fonts.googleapis.com/css2?…` link (named, never fetched: the face draws when the Mac has it, else its generic) or `{"family", "src"}` with an uploaded font (`assets/<name>`) |
| `designSystems` | Claude's design-system install records, at most 4, kept as they are |
| `dsOverrides` | MAWS's: the deck's design-system overrides, `--ds-*` name → CSS value; the Theme menu writes it |

Every key is kept when you publish, the ones named here or not: change only the keys you mean to. An entry that breaks its rule (a face with a plain URL, a section without a slide id) is dropped with a warning.

**A slide** is a `<section id>` on a fixed 1920×1080 canvas with 128px margins (1664×824 inside). The id is `[A-Za-z0-9_-]{1,64}` and equals the file name. On the section: a `background` always, the text defaults (`font-family`, `color`) and the layout (`display:flex; flex-direction:column` or `display:grid`, `padding:128px`, `gap`, `align-items`, `justify-content`); without `display` a section or div is a column. Children flow; `position:absolute` pins a child to the slide, or to a `position:relative` div, by `left`/`top`/`right`/`bottom`/`width`/`height`. Paint order is source order with all flow content one layer where the first flow child sits, so a pinned backdrop listed before the first flow child paints under the text and one listed after it over the text. There is no `z-index`.

**Identity.** Every element carries an `id` (`[A-Za-z0-9_-]{1,64}`, unique in its slide); what you read has them all. Keep them when you edit: comments, history and links follow an element by its id, and a magic-move transition matches equal ids on two slides. An element you write without one takes the id of the element at its place in the slide you read, else a new `e<n>-<hash>` id. Table cells carry no id: they are positional.

**Loading.** MAWS reads a slide as Claude does. A property, value or attribute outside this reference is dropped with a warning naming the slide, the element and the property; a heal to an equivalent (`pt` to `px`, `<strong>` to `<b>`, `padding-top` folded into `padding`) is a note. A slide that fails structurally (a tag out of place, text directly in a div, a limit passed, an image URL) is held: nothing of it changes, its file reads back as you sent it, the owner sees it read-only with its reasons, and your next valid file for it clears the hold. Files are saved normalized (attributes, declarations, colours, numbers and whitespace in one canonical form); compare them by meaning, not bytes.

## Elements and attributes

| Element | What it is |
|---|---|
| `<h1>` `<h2>` `<h3>` `<p>` | Text; set `font-size` yourself (at least 24px). h1 to h3 do not inherit `font-size` and `font-weight` |
| `<ul>` `<ol>` of `<li>` | A list of plain items, one level |
| `<br>`, `<b>` `<i>` `<u>`, `<a href="https://…">`, `<span style="color:…">` | Inside text only; a span carries a colour and nothing else (`font-weight:600` or more becomes `<b>`) |
| `<div>` | A flex row or column, or a grid; invisible unless it has a `background`, `border` or `box-shadow`; at most 15 deep. `data-group` marks a group the owner made |
| `<img src alt>` | A picture: `src` is `assets/<name>` (upload it with `artifact_upload_asset`), `/_blob/<id>` or `project/ds/<folder>/<file>`, never a URL or a `data:` URI; no `src` is a placeholder. `data-crop="ZOOM X% Y%"` (zoom 1 to 50) is the owner's crop; `data-video*` is kept |
| `<table>` of `<tr>` with `<th>`/`<td>` | Plain-text cells, at most 100 rows by 24 columns, no `colspan` or `rowspan`; a row may carry a `background` colour |
| `<svg>` | One opaque graphic (charts, curves): paths, shapes, gradients, local `#id` references; no script, `on*=`, `foreignObject` or URLs; `aria-label` is its alt; `<text>` draws without the deck's fonts, so labels are `<p>`s over it |
| `<hr>` | A line: `border-top` is its stroke, else `color` |
| `<x-shape kind>` | `rect`, `rounded`, `ellipse`, `diamond`, `arrow-right`, `arrow-left`, `arrow-up`, `arrow-down` or `line`, filling its box; holds no content |
| `<x-icon name>` | One of Activity Book Chart Chat Check CheckCircle Clock Cloud Code Database Globe GraduationCap Home Key Lightbulb Lightning Link Lock PaperPlane Play Search Settings Star ThumbsUp Tool Trust Users Verified Warning Wrench |
| `<x-connector x1 y1 x2 y2>` | A line with heads (`head="end"`, `"both"` or `"none"`; `head-start`/`head-end` `"none"`, `"open"` or `"filled"`; `route` `"straight"`, `"hv"`, `"vh"` or `"elbow"`) in the coordinates of the section or of a `position:relative` div (px or %), all four or none; without coordinates it is a sized flow child drawn corner to corner from `from="tl"` (or `tr`, `bl`, `br`) |
| `<x-embed>` | A small live page in a sandboxed frame (`allow-scripts`, no network): a pinned direct child of the section; flattened to a picture in PPTX and PDF |
| `<aside>` | The speaker notes: plain text, the section's last child |

**Attributes.** On the section: `data-transition` `fade`, `push` or `magic` (how the slide leaves), `hidden` (skipped when presenting), `data-section="<one sentence>"`. On any element: `data-fit` `shrink`, `grow` or `none` (shrink, the default for a sized text box, scales its text down to 60 % or 8px, then clips), `data-ph="<role>"` (a layout's placeholder: `title`, `subtitle`, `body`, …; a slide made from a layout drops it). On a pinned element: `data-build-in` and `data-build-out`, an effect (`fade`, `rise`, `drop`, `left`, `right`, `scale` or `pop`), then an order from 1 to 50, then `auto`, the last two optional. Any other attribute is dropped with a warning (`class` and other `data-*` with a note).

### Supported CSS

Every style is inline, in `style=""`, from exactly this table: one line per property, its values and ranges, then after `·` the elements it applies to. `text` is h1 to h3, p, ul and ol, and a text line set on the section or a div inherits down; `div child` and `grid child` are flow children of a div (the section counts) or a grid; `pinned` is `position:absolute`. `padding-*`, `border-*-radius`, `background-color` and `font` are folded into the lines that hold them.

```
LEN = Npx or bare N (px) — no em rem vw vh %
PCT = N%
N, INT = number, whole number
COLOR = #hex | rgb[a]() | hsl[a]() | named | transparent — no currentcolor
ANGLE = Ndeg | Nturn | Nrad
ALIGN = start | center | end | stretch | baseline (flex-* forms ok)
FAMILY = 'Declared Face', Basic, generic — a family of deck.json's faces, a basic face, then serif | sans-serif | monospace | cursive | system-ui
IMG = assets/NAME (an uploaded asset) | /_blob/ID | project/ds/FOLDER/PATH — never a URL or data:
VAR = var(--ds-NAME[, FALLBACK]) — a design-system token in any value position (MAWS); FALLBACK follows the property's grammar; no other var()

position: absolute | relative · any; absolute pins to the slide or a position:relative div
left top right bottom: LEN | PCT | auto; left/top also calc(PCT ± LEN) · pinned only (relative does not offset)
width height: LEN | auto | PCT (pinned, td/th, or along a flex row/column = that share) · any
min-width: LEN | min-content | max-content · div child
min-height max-width max-height: LEN · div child
display: flex | grid | none (no display = column) · section div
flex-direction: row | column [-reverse] · flex box
flex-wrap: wrap | nowrap · row div
gap: LEN 0–512, one value · section div
align-items: ALIGN · section div
justify-content: start | center | end | space-between | space-around | space-evenly · flex box, not grid
justify-items: ALIGN, no baseline · grid box
align-self: ALIGN | auto · div child
justify-self: ALIGN | auto, no baseline · grid child
flex: none | auto | N [N] [LEN | 0% | auto] (flex:1 = equal share; empty div + flex:1 = spacer) · div child
flex-grow flex-shrink: N · div child
flex-basis: LEN | auto · div child
grid-template-columns grid-template-rows: (LEN | Nfr | auto | repeat(INT, …))+ ≤24 tracks — no minmax, auto-fill, names, areas · grid box
grid-column grid-row: span INT only (cells fill in source order) · grid child
aspect-ratio: N | N / N · div child
padding: LEN 0–256 ×1–4 · section div text table; td/th: one per table, ≤64
overflow: hidden | visible · div
font-family: FAMILY · text table; on body/section/div it inherits
font-size: LEN 8–400 (Npt converts) · text table; inherits into p/li, not h1–h3
font-weight: 100–900 (whole hundreds) | normal | bold · text th; span (≥600 = bold)
font-style: normal | italic · text span
font: [italic] [weight] LEN[/N] FAMILY · text
line-height: N | PCT | LEN (0.5–4× the font-size) · text
letter-spacing: LEN | Nem (−24–32px) | normal · text
text-align: left | center | right | justify (not td) · text td/th
text-transform: none | uppercase | lowercase | capitalize · text
white-space: normal | nowrap · text
text-decoration: none | underline | line-through [solid | double | dotted | dashed | wavy] [COLOR] · text; span: underline only
font-variant-numeric: normal | tabular-nums · text
-webkit-text-stroke: LEN 0–8 COLOR · text
color: COLOR · text span td/th x-icon x-connector hr; table (it inherits, as the Tables paragraph says)
background: COLOR | [repeating-]linear-gradient(ANGLE | to SIDE, COLOR [PCT [PCT]], … 2–8 stops; repeating: px stops) | radial-gradient([circle|ellipse] [at X% Y%], …); one gradient[, COLOR under it] · section div text img table x-icon; tr: COLOR; x-shape/hr = flat fill
background-clip: text (+ -webkit-text-fill-color: transparent): glyphs take the gradient | url(IMG) [center / cover|contain]; color = fallback; span: -webkit-text-fill-color: currentcolor · text
border: [LEN 0–16, else 1] solid | dashed | dotted | double | none [COLOR, else black] — one stroke; the style word is required · div text img table x-icon; = the stroke on x-shape hr x-connector (≤32)
border-top -right -bottom -left: as border | none; one style+color, any widths · div text img table x-icon; hr: border-top = its stroke
border-width: LEN 0–32 · x-connector (MAWS: its stroke, 2px default)
border-style: solid | dashed | dotted | double | none · x-connector (MAWS)
border-radius: LEN | PCT ×1–4 (TL TR BR BL); 50%=pill · div text img table; rect x-shape
box-shadow: [inset] LEN LEN [LEN [LEN]] COLOR, … ≤8 (x y ±64, blur ≤160, spread ±32) · div text img table x-icon x-shape
text-shadow: LEN LEN [LEN] COLOR, … ≤8 (blur ≤64) · text table
opacity: N 0–1 · any
transform: translate(LEN[, LEN]) | translateX|Y(LEN | -50%), rotate(ANGLE), scale(N 0.5–2), skew[X|Y](ANGLE ±60) — any subset in that order, each once · any but x-connector; x-shape: rotate only
filter backdrop-filter: blur(LEN ≤20) brightness|contrast(N 0–2) saturate(N 0–3) grayscale|sepia|invert(N 0–1) hue-rotate(ANGLE) — any subset · div text img x-shape
mix-blend-mode: normal | multiply | screen | overlay | darken | lighten · div text img x-shape
object-fit: cover | contain · img
accepted as no-ops only: margin | box-sizing | grid-template | position (0, border-box, none, static)
```

**Design-system tokens (MAWS).** `var(--ds-<name>)` may stand for any value or part of one, so a design-system change restyles the deck. Every system defines these names: `--ds-color-bg`, `--ds-color-bg-raised`, `--ds-color-text`, `--ds-color-text-muted`, `--ds-color-accent`, `--ds-color-accent-text`, `--ds-color-border`, `--ds-color-status-ok` (and `-warn`, `-error`, `-info`), `--ds-font-display`, `--ds-font-body`, `--ds-font-mono`, `--ds-type-<role>-size`, `-line` and `-weight` for the roles `title`, `subtitle`, `h1`, `h2`, `h3`, `body`, `caption` and `quote`, `--ds-space-1` to `--ds-space-8`, `--ds-radius-sm`, `-md`, `-lg` and `-full`, and `--ds-shadow-sm`, `-md` and `-lg`. Another `--ds-` name works where the system defines it: give it a fallback, `var(--ds-color-highlight, #f5d90a)`. The mirror and the For Claude export replace every token with its value.

## Limits

| Per slide | Limit | Past it |
|---|---|---|
| Elements (rows and cells apart) | 200 | held |
| Table cells; rows by columns | 4,000; 100 by 24 | held |
| Nested `<div>`s | 15 | held |
| Pinned children of the section or of one div | 24 (split them across sibling hosts) | held |
| Text | 20,000 characters or 100 marked runs | held |
| Speaker notes | 4,000 characters | held |
| An `<svg>` | 52 KB | held |
| `<x-embed>`s | 8, each at most 16 KB | held |

| Per deck | Limit |
|---|---|
| Slides | 500 |
| Files | 512 |
| One publish | 16 MB |
| Faces in `deck.json` | 4 |
| Design-system records | 4 |

## Examples

The index of a three-slide deck:

```json
{
  "v": 4,
  "createdOnFiles": {
    "v": 1,
    "at": "2026-10-14T09:00:00Z"
  },
  "lists": "css",
  "title": "Q3 review",
  "cover": "cover",
  "order": [
    "cover",
    "plan",
    "flow"
  ],
  "sections": {
    "s1": {
      "description": "Where we are and what changes.",
      "start": "cover"
    }
  },
  "faces": {
    "source-serif-4": {
      "family": "Source Serif 4",
      "href": "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700&display=swap"
    }
  },
  "designSystems": []
}
```

A cover in the design system's roles (`project/slides/cover.html`):

```html
<section id="cover" style="display:flex; flex-direction:column; gap:var(--ds-space-5, 32px); justify-content:flex-end; padding:128px; background:var(--ds-color-bg, #ffffff)">
  <h1 id="title" style="font-family:var(--ds-font-display); font-size:var(--ds-type-title-size, 96px); font-weight:var(--ds-type-title-weight, 600); line-height:var(--ds-type-title-line, 1.1); color:var(--ds-color-text, #1a1a1a)">Q3 review</h1>
  <p id="subtitle" style="font-family:var(--ds-font-body); font-size:var(--ds-type-subtitle-size, 40px); color:var(--ds-color-text-muted, #6a7179)">Where we are and what changes</p>
</section>
```

A content slide with a card row, a picture and a pinned footer (`project/slides/plan.html`):

```html
<section id="plan" data-transition="fade" style="display:flex; flex-direction:column; gap:48px; justify-content:space-between; padding:128px 128px 160px; font-family:Georgia, serif; color:#1a1a1a; background:#fbfbf8">
  <h2 id="heading" style="font-family:'Source Serif 4', Georgia, serif; font-size:72px; font-weight:400; line-height:1.1">Changes</h2>
  <div id="row" style="display:flex; gap:32px">
    <div id="card" style="display:flex; flex-direction:column; gap:12px; flex:1; padding:40px; background:#ffffff; border:1px solid #e3e6e4; border-radius:16px">
      <h3 id="card-title" style="font-size:32px; font-weight:600">One path</h3>
      <ul id="card-list" style="font-size:28px; line-height:1.4">
        <li>One onboarding path for <b>every</b> team</li>
        <li>Ramp in six weeks</li>
      </ul>
    </div>
    <img id="hq" alt="The new office" src="assets/hq.jpg" style="width:480px; height:360px; border-radius:16px; object-fit:cover">
  </div>
  <p id="source" style="position:absolute; left:128px; bottom:64px; font-size:24px; color:#6a7179">Source: People Ops, Q3 survey</p>
  <aside>Open with the ramp time; the office comes last.</aside>
</section>
```

A diagram pinned in a host, with a band under the flow text and a connector (`project/slides/flow.html`):

```html
<section id="flow" style="display:flex; flex-direction:column; gap:40px; padding:128px; background:#ffffff">
  <div id="band" style="position:absolute; left:0px; top:0px; width:1920px; height:96px; background:#eef2f1"></div>
  <h2 id="flow-title" style="font-size:64px">From brief to deck</h2>
  <div id="host" style="position:relative; width:1664px; height:600px">
    <div id="brief" style="position:absolute; left:0px; top:240px; width:320px; height:120px; padding:24px; background:#ffffff; border:2px solid #2b7a78; border-radius:16px">
      <p id="brief-label" style="font-size:28px">Brief</p>
    </div>
    <div id="deck" style="position:absolute; left:672px; top:240px; width:320px; height:120px; padding:24px; background:#ffffff; border:2px solid #2b7a78; border-radius:16px">
      <p id="deck-label" style="font-size:28px">Deck</p>
    </div>
    <x-connector id="brief-deck" x1="320" x2="672" y1="300" y2="300" style="color:#2b7a78; border-width:3px"></x-connector>
  </div>
</section>
```
