# Design: format reference

A design canvas: boards of any size (phone, tablet and desktop screens, posters) laid out on one canvas, each board an HTML section in the presentation dialect, exported to PNG and PDF.

## Structure

A design is files under `project/`:

| Path | What it is |
|---|---|
| `project/canvas.json` | The manifest: the design's title, every board's place and size, the boards' order |
| `project/boards/<id>.html` | One board: exactly one `<section id="<id>">`, nothing before or after it |

**The manifest**, `project/canvas.json`, with its keys in this order:

| Key | What it holds |
|---|---|
| `v` | `1` |
| `title` | The design's name |
| `boards` | Board id → `{"x", "y", "w", "h", "title"?}`: the board's top-left corner on the canvas and its size, in CSS px, and the name the board list shows |
| `order` | The board ids back to front (the board list's order); a board it leaves out keeps its place, with a warning |
| `faces` | At most 4 typefaces, as a deck's (`{"family", "href"}` with a Google Fonts link MAWS fetches once when its licence is OFL, or `{"family", "src": "assets/<name>"}`); MAWS's `google` key on a face is its record of the fetch: leave it alone |
| `designSystems` | Claude's design-system install records, kept as they are |
| `dsOverrides` | The design's design-system overrides, `--ds-*` name → CSS value; the Theme menu writes it |

Any other key, at the top or in a board's entry, is kept as you sent it. `sections` is refused: it is a deck's outline, and a design has none.

**A board's frame.** `x` and `y` are any finite numbers. `w` and `h` are more than 0 and at most 16,384, and `w × h` is at most 67,108,864 (8,192 squared). A frame outside these limits refuses the publish, naming the board; nothing is clamped. A board whose entry has no size takes its file's `data-size="<w>x<h>"` on the section if it has one, else 1920×1080, and a board with no position goes after the right-most board, each with a warning. `data-size` is read only for that and then dropped; the manifest holds the size.

**A board** is a slide of the presentation dialect, without the slide's canvas: it is as wide and tall as its frame, with no 128px margins. Ids follow the dialect's rule (`[A-Za-z0-9_-]{1,64}`, the board id equal to its file name; every element's id unique in its board); keep them when you edit. A cross-board move made in the workbench gives the element a new id, and its comments follow it there; a move you make by publishing gives the element no history of where it came from, so its comments stay with its old board as orphans.

**Loading.** A board loads as a slide does: a property, value or attribute outside the dialect is dropped with a warning naming the board, the element and the property; a heal to an equivalent is a note; a board that fails structurally is held, read-only with its reasons, its file reading back as you sent it, until your next valid file for it. A manifest entry whose file never arrived is kept as a board with no source: the owner sees an empty labelled frame, `artifact_read` returns no file for it, and publishing the file fills it.

## Elements and attributes

Boards take exactly the presentation dialect's elements, attributes and CSS: call `artifact_describe_type` with `kind: "presentation"` for its tables. What differs on a board:

- **Screen type defaults.** Text you do not size takes the screen's, not the slide's: body text 16px at line height 1.5, `h1` 32px, `h2` 24px, `h3` 20px, headings at weight 600. Size text for its screen; the slide guide's 24px floor does not apply.
- **The design system's document medium.** `var(--ds-type-*)` roles resolve to the system's document sizes, not its deck sizes, so a role reads as screen type on a 390px phone.
- **Ignored on a board:** `data-transition`, `hidden`, `data-section`, builds and speaker notes are kept in the file but do nothing.

## Limits

| Per board | Limit | Past it |
|---|---|---|
| Width, height | more than 0, at most 16,384 px each | the publish refused |
| Area | at most 67,108,864 px | the publish refused |
| Elements (rows and cells apart) | 200 | held |
| Pinned children of the section or of one div | 24 (group them under sibling hosts) | held |
| Everything else in a board | as a presentation slide | held |

| Per design | Limit |
|---|---|
| Boards | 200 |
| Files | 512 |
| One publish | 16 MB |
| Faces in `canvas.json` | 4 |

| Export | Limit |
|---|---|
| PNG, one board | each side at most 8,192 px at the scale asked (native by default); `scale` from 0.1 to 4 |
| PDF, one page per board | each side at most 19,200 px at the scale asked |

## Examples

The manifest of a three-board design (a phone screen, a desktop screen and a tall poster):

```json
{
  "v": 1,
  "title": "Launch",
  "boards": {
    "signin": {
      "x": 0,
      "y": 0,
      "w": 390,
      "h": 844,
      "title": "Sign in"
    },
    "home": {
      "x": 490,
      "y": 0,
      "w": 1440,
      "h": 1024,
      "title": "Home"
    },
    "poster": {
      "x": 2030,
      "y": 0,
      "w": 1080,
      "h": 9600,
      "title": "Poster"
    }
  },
  "order": [
    "signin",
    "home",
    "poster"
  ]
}
```

A phone screen in the design system's tokens (`project/boards/signin.html`):

```html
<section id="signin" style="display:flex; flex-direction:column; gap:24px; padding:32px 24px; color:var(--ds-color-text, #1a1a1a); background:var(--ds-color-bg, #ffffff)">
  <h1 id="title" style="font-size:var(--ds-type-h1-size, 32px); font-weight:600">Sign in</h1>
  <p id="lead" style="font-size:16px; line-height:1.5; color:var(--ds-color-text-muted, #6a7179)">Use the email you signed up with.</p>
  <div id="field" style="padding:12px 16px; border:1px solid var(--ds-color-border, #d0d4d2); border-radius:var(--ds-radius-md, 8px)">
    <p id="field-label" style="font-size:16px">name@example.com</p>
  </div>
  <div id="button" style="padding:14px 16px; background:var(--ds-color-accent, #2b7a78); border-radius:var(--ds-radius-md, 8px)">
    <p id="button-label" style="font-size:16px; font-weight:600; text-align:center; color:var(--ds-color-accent-text, #ffffff)">Continue</p>
  </div>
</section>
```

A tall poster whose pinned cards sit in a group, so the section itself keeps few pinned children (`project/boards/poster.html`):

```html
<section id="poster" style="color:#ffffff; background:#0f1720">
  <h1 id="headline" style="position:absolute; left:120px; top:240px; width:840px; font-size:120px; font-weight:700; line-height:1.05">Launch day</h1>
  <div id="cards" data-group="" style="position:absolute; left:120px; top:1200px; width:840px; height:2400px">
    <div id="card-1" style="position:absolute; left:0px; top:0px; width:840px; height:720px; background:#1c2733; border-radius:24px"></div>
    <div id="card-2" style="position:absolute; left:0px; top:840px; width:840px; height:720px; background:#1c2733; border-radius:24px"></div>
  </div>
</section>
```
