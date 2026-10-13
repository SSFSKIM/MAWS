# MAWS

The house design system: MAWS's own look, carried from the app into the documents and decks made in it. This is the
system a document or deck uses when nothing else is chosen. The token file (`tokens.tokens.json`) wins for every
value; this law wins for usage. When the canon and this law disagree, fix the canon.

## 0. Stance commitment

MAWS writes working documents the way the app looks: a warm, quiet ground, a white sheet lifted off it, ink in a
neutral sans, and one terracotta mark for the reader's one action. It is a working paper, not a brochure: no hero
bands, no colour blocks, no decoration that does not carry a meaning. It is also not the app's chrome: no sidebars,
pills or toolbars appear inside a document. If a decision is ever ambiguous, choose the quieter option.

**Axis position** (adopted from MAWS's app tokens; the two constraints are the brief's, the seven coordinates are the
app's own, read off `src/renderer/src/styles/tokens.css`):

- Density: **standard**, because the owner's documents are lesson plans, notes and memos read at a desk.
- Criticality: **transactional**, because a wrong date or room costs a class period, and a reissue undoes it.
- Energy: **composed**, because the documents sit beside the agent's work and must not be louder than it.
- Type: **neutral sans** (SF Pro with Apple SD Gothic Neo), the app's own faces, so a document reads as made in MAWS.
- Material model: **tonal**, because the app parts its surfaces by a lightness step and a soft lift, never a heavy line.
- Colour commitment: **restrained**, chromatic surface under a twentieth of any page.
- Accent job: **directional**, terracotta marks the reader's one action and nothing else.
- Ground lightness: **light**, the owner works in daylight and prints.
- Ground temperature: **warm-neutral**, the app's `#faf9f6`, a warm grey, not the cream band.

**Adopted from MAWS's app tokens.** The values are the app's (ground, sheet, ink, terracotta, status set, radii, the
strip, composer and float shadows), so there is no rejected vector and no rejected value: a house system that drifted
from the house would defeat its purpose.

**Type derivation.** SF Pro Display sets the title and headings, SF Pro Text the body, because the pair is optically
sized for the two jobs and is what the app sets. Apple SD Gothic Neo carries Hangul in the same weights. On Windows the
stack falls to Segoe UI and Malgun Gothic, which are also the Office faces.

**Signature element.** The white sheet on the warm ground: on screen a document is a raised sheet (`shadow.sm`) on
`color.bg`; in print the sheet is the paper and the shadow drops. The risk is spent there and nowhere else.

## 1. Palette, with usage rules

- `color.bg` is the ground behind every sheet and every slide. Nothing else is a page ground.
- `color.bg.raised` is the sheet: the document page, a slide's card, a table's head row when one is tinted.
- `color.text` is all body ink. `color.text.muted` (4.6 : 1 on the ground) is for captions, metadata, table heads and
  attributions; never for a sentence the reader must act on.
- **`color.accent` is the accent role.** Terracotta marks the reader's one action on a page or slide: the disc beside
  "To do", a 2 px underline under the action phrase, or one figure on a slide. One mark per page or slide.
- `color.accent` measures 3.7 : 1 on the ground, so it sets text only at 24 px, or 19 px bold, and above. A body-size
  action stays in ink and takes the underline.
- `color.accent.text` (3.9 : 1 on the accent) appears only on an accent fill, at the same large sizes.
- `color.border` is the hairline between rows and under a table head's rule; never a control's only edge.
- The status set (`color.status.ok`, `warn`, `error`, `info`) is the only other colour. Each is a mark or a word's
  colour, always beside the word ("On track", "Late"), never colour alone.
- Forbidden: a second accent, the accent on headings, rules, panels, links or status, and any colour literal in canon.

## 2. Typography roles, with placement rules

| Role | Face | Document (px / line / weight) | Deck on 1920×1080 | Where |
|---|---|---|---|---|
| `type.title` | `font.display` | 34 / 1.3 / 700 | 96 / 1.2 | The document's or slide's one title |
| `type.subtitle` | `font.display` | 19 / 1.55 / 500 | 44 / 1.4 | The line under the title: course, date, room |
| `type.h1` | `font.display` | 26 / 1.35 / 700 | 72 / 1.25 | A section; a slide's heading |
| `type.h2` | `font.display` | 21 / 1.45 / 700 | 56 / 1.3 | A subsection |
| `type.h3` | `font.display` | 17 / 1.55 / 600 | 44 / 1.35 | A run-in group heading |
| `type.body` | `font.body` | 16 / 1.7 / 400 | 40 / 1.5 | Paragraphs, lists, table cells |
| `type.caption` | `font.body` | 13 / 1.55 / 400 | 28 / 1.45 | Captions, metadata, a slide's footer |
| `type.quote` | `font.body` | 17 / 1.75 / 400 | 48 / 1.45 | A quoted voice, set muted with an indent |

- Every text element takes one of these eight roles through its `.ds-type-<role>` class or its `--ds-type-<role>-*`
  properties. No other font size appears in canon.
- `font.mono` sets code, file paths and measured values in tables only; never a heading or a sentence.
- Figures in tables and on slides are tabular (`font-variant-numeric: tabular-nums`).
- Hangul breaks between words (`word-break: keep-all`, the token file's default).
- A deck's quote is set at weight 400 like the document's; the token file has no deck weight.

## 3. Canvas, texture and material

- Material model: **tonal**. Surfaces part by the step from `color.bg` to `color.bg.raised`, then by `shadow.sm`.
- On screen, a document is one raised sheet on the ground; a slide's cards are raised sheets on the slide's ground.
- `shadow.md` and `shadow.lg` belong to MAWS's own floating UI over a document (menus, dialogs), never to content.
- Print drops every shadow and prints the ground white; nothing may depend on either to be read.
- No texture, grain, gradient or image ground anywhere.

## 4. Layout system

**Composition lines** (for the system's typical artifact, a teacher's working document and its slides):

1. Posture: **narrative**, a document is read in the author's order, start to finish.
2. Dominant activity: **read**, then act on one thing; success is the reader doing the to-do.
3. Unit and relation: the section, in **sequence**; tables hold a sequence of stages.
4. Co-visibility: **none**, one column; a slide shows one idea.
5. Temporal structure: **scheduled**, plans with dates and durations, so dates and times are set exactly.
6. Volume and homogeneity: **few, heterogeneous**, a handful of titled sections of unlike shape.

**Compiled consequences.** One column at a readable measure; the title block leads; sections stack in order; density
lives in tables; the one action sits as a callout near the top; chrome (page numbers, course line) stays in captions.

**Ledger.**

| Brief evidence | Relationship | Constraint | Rendered assertion | Forbidden move |
|---|---|---|---|---|
| Plans are read in order | sequence | one column | no side-by-side text columns in a document | a two-column document body |
| One thing must be done | the action leads | callout after the goal | the to-do callout sits in the first third | an action buried in the last section |
| Stages and times | sequence of stages | a ruled table | stages in a table, never a card grid | three equal cards for three stages |
| A slide is spoken over | one idea per slide | one heading, at most one row of peers | a slide has one `type.h1` | a slide with two headings |

**Candidates.** Chosen: one column of sections with the action as a callout. Rejected: a summary sidebar, because a
plan has no overview to hold beside its detail.

**Prior adopted:** list beside detail is declined; **center stage** for slides, earned by "one idea per slide".
**Defaults overridden by name:** the three-up card grid (only for three measured figures, never for prose), the stat
row, the sidebar, the headline band with an empty right half.

**Mechanics.**

- The page is US Letter (the token file's `dev.maws.page`; A4 selectable), with 72 px (0.75 in) margins.
- The document's text column is the page's; nothing bleeds.
- Sections part by `space.7` above an `h1` and `space.6` above an `h2` or `h3`; no rule between sections.
- Slides are 1920×1080 with 128 px margins; the footer sits in the bottom margin in `type.caption`.
- Slide spacing is the document scale times 2.5 (60, 80, 120 px), written as px, because the token file carries one
  spacing scale.

## 5. Component canon

Build order for a new document: title block, goal, the to-do callout, the stage table, a quote if a student's voice
matters, a caption for materials. For a deck: title, content, figures, quote.

- `layouts/title.html`: the opening slide (caption, title, subtitle).
- `layouts/content.html`: a heading with a short list, the default slide.
- `layouts/figures.html`: up to three measured figures as raised cards; only the result may take the accent.
- `layouts/quote.html`: a quoted voice with its attribution.
- `components/todo.html`: the one action callout, the accent disc beside "To do".
- `components/status.html`: the only status mark, a status-coloured disc beside its word.
- `components/table.html`: the stage table, an ink rule under the head and hairlines between rows.
- `components/document.css`: every document block under `.ds-doc` (headings, lists, quote, table, callouts).

Placeholders are `data-ph="title"`, `subtitle`, `body` and `caption`, plus `figures`, this law's name for the row of
measured figures. Reuse these; a new component is added here before it is used.

## 6. Voice

- Plain, direct, warm; complete sentences in body, fragments only in tables and captions.
- Sentence case everywhere; title case never.
- Dates are written out (Monday, October 19, 2026); times as 8:15 a.m.; durations as "15 min".
- Names are real people's names with their role (Mr. Patel, ext. 2140), never "Teacher A".
- An action says who, what and by when: "Reserve six balances by Friday, October 16."
- No exclamation marks, no emoji.

## 7. Motion

- Documents do not move.
- Slides may use `data-transition="fade"` between sections only; no builds on body text.
- In MAWS's own UI over a document, colour and opacity change on hover in 120 ms; nothing slides or scales.
- Under reduced motion, every transition is cut.

## 8. Hard don'ts

- No colour literal in canon; every colour is a `var(--ds-color-*)`. [check: literal-color]
- No font family outside `font.display`, `font.body` and `font.mono`. [check: font-family]
- No gradient, in any surface. [check: no-gradient]
- No shadow except `shadow.sm`, `shadow.md` and `shadow.lg`. [check: no-shadow]
- No more than one accent-painted element per slide or component. [check: accent-max:1]
- No font size outside the eight type roles. [check: type-scale]
- No slide or component over 60 words. [check: max-words:60]
- No declared text and ground pair below 3 : 1; body text pairs are 4.5 : 1 by the palette. [check: contrast:3]
- No accent on a heading, a rule, a panel, a link or a status.
- No body-size text set in the accent.
- No status shown by colour alone.
- No second column of text in a document.
- No lorem ipsum or round placeholder numbers in canon or samples.
