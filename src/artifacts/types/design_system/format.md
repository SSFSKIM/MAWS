# Design system: format reference

A project's committed visual law: a stance, a token file and DESIGN.md, which the documents, decks and designs that reference it must obey.

## Structure

A system is one set of files, sent whole to `artifact_create` and in part to `artifact_publish`:

| Path | What it is | Who writes it |
|---|---|---|
| `DESIGN.md` | The law: usage, in nine sections. Wins for usage. | You or the user, before any token |
| `tokens.tokens.json` | The values, in W3C DTCG 2025.10 with the roles below. Wins for values. | You or the user |
| `layouts/<name>.html` | A slide layout: one `<section id="<name>">` in the slide dialect, with placeholders | You |
| `components/<name>.html` | A component: one root element in the slide dialect (a status mark, a callout, a table) | You |
| `components/document.css` | How documents look under this system | You |
| `assets/<name>` | Fonts and logos, uploaded with `artifact_upload_asset` | You |
| `tokens.css`, `office-theme.json` | Generated from the token file; read them, never send them | MAWS |

## The token file

DTCG 2025.10: a JSON tree of groups and tokens. A token has `$value` and a `$type`, its own or inherited from a group. A group's base token is named `$root` (`color.accent.$root`), referenced as `"{color.accent.$root}"`. An alias `"{path}"` may stand for any value or any part of a composite. `$description`, `$deprecated` and `$extensions` are kept as written.

Values (MAWS writes the object forms and reads the short ones too):

- `color`: `{"colorSpace": "srgb", "components": [r, g, b], "alpha"?: a, "hex"?: "#rrggbb"}`; a `"#rrggbb"` string reads as the same.
- `dimension`: `{"value": 16, "unit": "px" | "rem"}`; `"16px"` reads as the same.
- `fontFamily`: a name or a list of names, first choice first.
- `fontWeight`: 1 to 1000, or a name such as `"bold"`.
- `typography`: `{"fontFamily", "fontSize", "fontWeight", "lineHeight" (a number), "letterSpacing"?}`.
- `shadow`: one layer or a list of `{"color", "offsetX", "offsetY", "blur", "spread", "inset"?}`.
- `duration`, `cubicBezier`, `number`, `strokeStyle`, `border`, `transition`, `gradient`: as DTCG defines them.

**The roles.** Every system defines these paths; each becomes the CSS name `--ds-` plus its segments joined by `-`, with `$root` dropped:

| Path | `$type` | CSS name |
|---|---|---|
| `color.bg.$root`, `color.bg.raised` | color | `--ds-color-bg`, `--ds-color-bg-raised` |
| `color.text.$root`, `color.text.muted` | color | `--ds-color-text`, `--ds-color-text-muted` |
| `color.accent.$root`, `color.accent.text` | color | `--ds-color-accent`, `--ds-color-accent-text` |
| `color.border` | color | `--ds-color-border` |
| `color.status.ok`, `warn`, `error`, `info` | color | `--ds-color-status-ok` … `-info` |
| `font.display`, `font.body`, `font.mono` | fontFamily | `--ds-font-display`, `-body`, `-mono` |
| `type.title`, `subtitle`, `h1`, `h2`, `h3`, `body`, `caption`, `quote` | typography | `--ds-type-<role>-size`, `-line`, `-weight`, and the class `.ds-type-<role>` |
| `space.1` … `space.8` | dimension | `--ds-space-1` … `-8` |
| `radius.sm`, `md`, `lg`, `full` | dimension | `--ds-radius-sm` … `-full` |
| `shadow.sm`, `md`, `lg` | shadow | `--ds-shadow-sm` … `-lg` |

Further tokens (`color.highlight`, `motion.fast`) are allowed and become `--ds-<path>`; documents may use them, slides never do. One system has one theme: its colours do not follow the app's light or dark mode.

**MAWS's extensions:**

- On the root, `$extensions["dev.maws.office"]`: `{"theme"?: {dk1, lt1, dk2, lt2, accent1…accent6, hlink, folHlink}, "fonts"?: {"major": {"latin", "ea"?, "cs"?}, "minor": {…}}}`. The 12 Office theme colours (each a colour or an alias) and the faces Word and PowerPoint name, major for headings and minor for body, `ea` the East Asian face. Whatever is left out is derived from the roles. Name faces present on Windows and Mac Office (Segoe UI, Cambria, Malgun Gothic, Batang).
- On the root, `$extensions["dev.maws.page"]`: `{"size": "letter" | "a4", "margin": <dimension>}`, the default page for documents and their exports. Letter is the default.
- On the root, `$extensions["dev.maws.css"]`: `{"wordBreak": "keep-all" | "normal" | …}`, the type classes' line breaking (`keep-all` when absent, so Hangul breaks between words).
- On each `type.<role>`, `$extensions["dev.maws.deck"]`: `{"fontSize": <dimension>, "lineHeight"?: <number>}`, the role's size on a 1920×1080 slide. Inside a deck the `--ds-type-<role>-size` and `-line` names carry these values.

## The law: DESIGN.md

The designer skill's nine sections, as `## 0.` to `## 8.` headings in this order (the words after the number are free; sections after 8 are allowed), about 300 lines, every rule checkable against a diff:

0. **Stance commitment**: the one idea, what it is not, and a tiebreaker ("if a decision is ever ambiguous, choose the more … option"); `persona: <name>` on its own line first when a persona governs; the axis position (density, criticality, energy, type, material model, colour commitment, accent job, ground lightness, ground temperature), one reason each; the rejected coordinate vector, the rejected accent hue and the rejected ground, one line each (or "adopted from <system>" in their place); the type derivation; the signature element.
1. **Palette, with usage rules**: which role does which job, which token is the accent and what it may mark, what is forbidden.
2. **Typography roles, with placement rules**: each role's face, document and deck sizes, where it may appear.
3. **Canvas, texture and material**: the ground, the material model (printed, tonal, elevated, glass), where shadows may appear.
4. **Layout system**: the six composition lines, their consequences, the ledger, the chosen and rejected candidates, the page size and margins, spacing.
5. **Component canon**: every file under `layouts/` and `components/`, by path, with its use and the build order.
6. **Voice**: tone, case, dates and numbers, how actions and errors are written.
7. **Motion**: what moves, how, and under reduced motion.
8. **Hard don'ts**: one bullet per rule. A rule MAWS can check carries a tag at its end:

| Tag | Checks |
|---|---|
| `[check: literal-color]` | No colour literal whose value is not a token value. |
| `[check: font-family]` | No family outside `font.*`. |
| `[check: no-gradient]` | No gradient. |
| `[check: no-shadow]` | No `box-shadow` outside `shadow.*`. |
| `[check: accent-max:<n>]` | At most n elements painted with the accent per slide or component. |
| `[check: radius-max:<px>]` | No radius above the given px. |
| `[check: type-scale]` | No font size outside the type roles' sizes. |
| `[check: max-words:<n>]` | No more than n words per slide or component. |
| `[check: contrast:<ratio>]` | No declared text and ground pair below the ratio. |

A rule may carry several tags. An unknown tag is reported, not ignored; an untagged rule is listed for a person to judge.

## The canon

- **A layout** (`layouts/<name>.html`) is exactly one `<section id="<name>">` in the slide dialect (the presentation kind's format reference), on 1920×1080 with 128 px margins. Elements to be filled carry `data-ph="<role>"`: `title`, `subtitle`, `body`, `image`, `caption`, `notes`, or a name the law's §5 defines. A new slide made from the layout fills them and drops the attribute.
- **A component** (`components/<name>.html`) is one root element in the slide dialect.
- **`components/document.css`** styles document blocks only under `.ds-doc`, with element and attribute selectors (`.ds-doc h1`, `.ds-doc table`, `.ds-doc blockquote`, `.ds-doc [data-callout-tone="warn"]`), and takes colours, faces, sizes and spacing only as `var(--ds-*)`. `@font-face` rules for the system's own fonts may load from `assets/`.
- In every canon file: inline styles only in layouts and components; `var()` only of `--ds-*` names; no script; no URL outside `assets/`.
- The slide dialect's shape holds in layouts and components: text sits in a text element (`h1` to `h3`, `p`, `ul`, `ol`), never directly in a `div`; an `li` holds only plain text and the inline set (`b`, `i`, `u`, an https `a`, a colour `span`, `br`); `display`, `gap` and alignment go on a `section` or `div`; a table cell takes only `width`, `height`, `padding`, `text-align` and `color` (and `font-weight` on a `th`), a row only a `background`, and the table carries the face, the size and the rules.

## Limits

- 512 tokens in a system, and 64 tokens per group.
- 256 KB for `DESIGN.md`.
- 64 canon files of at most 64 KB each.

## Examples

A whole token file in the short forms MAWS reads (it writes them back as objects):

```json
{
  "$description": "Field notes: a lab notebook's grid paper and pencil, one green for the step in progress.",
  "$extensions": {
    "dev.maws.office": { "fonts": { "major": { "latin": "Segoe UI", "ea": "Malgun Gothic" }, "minor": { "latin": "Segoe UI", "ea": "Malgun Gothic" } } },
    "dev.maws.page": { "size": "letter", "margin": { "value": 72, "unit": "px" } }
  },
  "color": {
    "$type": "color",
    "bg": { "$root": { "$value": "#fbfbf8" }, "raised": { "$value": "#ffffff" } },
    "text": { "$root": { "$value": "#22262a" }, "muted": { "$value": "#5a6068" } },
    "accent": { "$root": { "$value": "#1d7a4c" }, "text": { "$value": "#ffffff" } },
    "border": { "$value": "#c9cdd2" },
    "status": { "ok": { "$value": "#1d7a4c" }, "warn": { "$value": "#9a5b00" }, "error": { "$value": "#b3261e" }, "info": { "$value": "#2a5f9e" } }
  },
  "font": {
    "$type": "fontFamily",
    "display": { "$value": ["Avenir Next", "Apple SD Gothic Neo", "Segoe UI", "Malgun Gothic", "sans-serif"] },
    "body": { "$value": ["Avenir Next", "Apple SD Gothic Neo", "Segoe UI", "Malgun Gothic", "sans-serif"] },
    "mono": { "$value": ["SF Mono", "Menlo", "Consolas", "monospace"] }
  },
  "type": {
    "$type": "typography",
    "title": { "$value": { "fontFamily": "{font.display}", "fontSize": "32px", "fontWeight": 700, "lineHeight": 1.25 }, "$extensions": { "dev.maws.deck": { "fontSize": "96px" } } },
    "subtitle": { "$value": { "fontFamily": "{font.display}", "fontSize": "18px", "fontWeight": 500, "lineHeight": 1.45 }, "$extensions": { "dev.maws.deck": { "fontSize": "48px" } } },
    "h1": { "$value": { "fontFamily": "{font.display}", "fontSize": "24px", "fontWeight": 700, "lineHeight": 1.3 }, "$extensions": { "dev.maws.deck": { "fontSize": "72px" } } },
    "h2": { "$value": { "fontFamily": "{font.display}", "fontSize": "20px", "fontWeight": 700, "lineHeight": 1.35 }, "$extensions": { "dev.maws.deck": { "fontSize": "56px" } } },
    "h3": { "$value": { "fontFamily": "{font.display}", "fontSize": "17px", "fontWeight": 600, "lineHeight": 1.45 }, "$extensions": { "dev.maws.deck": { "fontSize": "44px" } } },
    "body": { "$value": { "fontFamily": "{font.body}", "fontSize": "16px", "fontWeight": 400, "lineHeight": 1.65 }, "$extensions": { "dev.maws.deck": { "fontSize": "40px", "lineHeight": 1.45 } } },
    "caption": { "$value": { "fontFamily": "{font.body}", "fontSize": "13px", "fontWeight": 400, "lineHeight": 1.5 }, "$extensions": { "dev.maws.deck": { "fontSize": "28px" } } },
    "quote": { "$value": { "fontFamily": "{font.body}", "fontSize": "17px", "fontWeight": 400, "lineHeight": 1.65 }, "$extensions": { "dev.maws.deck": { "fontSize": "48px" } } }
  },
  "space": {
    "$type": "dimension",
    "1": { "$value": "4px" }, "2": { "$value": "8px" }, "3": { "$value": "12px" }, "4": { "$value": "16px" },
    "5": { "$value": "24px" }, "6": { "$value": "32px" }, "7": { "$value": "48px" }, "8": { "$value": "64px" }
  },
  "radius": {
    "$type": "dimension",
    "sm": { "$value": "4px" }, "md": { "$value": "6px" }, "lg": { "$value": "10px" }, "full": { "$value": "9999px" }
  },
  "shadow": {
    "$type": "shadow",
    "sm": { "$value": { "color": "#22262a14", "offsetX": "0px", "offsetY": "1px", "blur": "2px", "spread": "0px" } },
    "md": { "$value": { "color": "#22262a1f", "offsetX": "0px", "offsetY": "4px", "blur": "12px", "spread": "0px" } },
    "lg": { "$value": { "color": "#22262a29", "offsetX": "0px", "offsetY": "16px", "blur": "40px", "spread": "0px" } }
  }
}
```

The shape of a law (each section filled with the system's own rules):

```markdown
# Field notes

## 0. Stance commitment
A lab notebook's grid paper and pencil … If a decision is ever ambiguous, choose the plainer option.
- Density: standard, because …
(the nine axis lines, the rejected vector and values, the type derivation, the signature element)

## 1. Palette, with usage rules
- `color.accent` is the accent role: it marks the step in progress, one per page …

## 2. Typography roles, with placement rules
## 3. Canvas, texture and material
## 4. Layout system
## 5. Component canon
- `layouts/title.html`: the opening slide.
- `components/document.css`: every document block under `.ds-doc`.
## 6. Voice
## 7. Motion
## 8. Hard don'ts
- No colour literal in canon. [check: literal-color]
- No more than one accent-painted element per slide. [check: accent-max:1]
- No headline in the accent.
```

A layout:

```html
<section id="title" style="background:var(--ds-color-bg);padding:128px;display:flex;flex-direction:column;justify-content:flex-end;gap:32px">
  <h1 data-ph="title" style="font-family:var(--ds-font-display);font-size:var(--ds-type-title-size);line-height:var(--ds-type-title-line);font-weight:var(--ds-type-title-weight);color:var(--ds-color-text)">Week 6: Titration</h1>
  <p data-ph="subtitle" style="font-family:var(--ds-font-display);font-size:var(--ds-type-subtitle-size);line-height:var(--ds-type-subtitle-line);font-weight:var(--ds-type-subtitle-weight);color:var(--ds-color-text-muted)">CHEM 1210 · Section 3 · Tuesday, October 13</p>
</section>
```

A document stylesheet's first rules:

```css
.ds-doc { background: var(--ds-color-bg); color: var(--ds-color-text); font-family: var(--ds-font-body); font-size: var(--ds-type-body-size); line-height: var(--ds-type-body-line); }
.ds-doc h1 { font-family: var(--ds-font-display); font-size: var(--ds-type-h1-size); line-height: var(--ds-type-h1-line); font-weight: var(--ds-type-h1-weight); }
.ds-doc [data-callout-tone="warn"] { border-left: 3px solid var(--ds-color-status-warn); padding: var(--ds-space-3) var(--ds-space-4); }
```
