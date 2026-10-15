# Classroom

A system for handouts, labs, worksheets and lecture slides for high-school and university students. The token file
(`tokens.tokens.json`) wins for every value; this law wins for usage. When the canon and this law disagree, fix the
canon.

## 0. Stance commitment

Classroom is white paper and dark ink that survive the school copier and the lecture-room projector, set in a
humanist sans whose l, I and 1 never collide, with one solid cobalt tab marking the part of the work the room is on.
It is written for older students in a mature register: no rounded faces, no stickers, no pastel fills, no cartoon
icons. It is not a brand page and not a children's worksheet. If a decision is ever ambiguous, choose the option that
still reads after a black-and-white photocopy and from the back of a lecture room.

**Axis position** (two constraints the brief fixed, seven coordinates chosen):

- Density: **standard, leaning spacious**, because a student reads, writes in the margins, and reads slides from the
  back of a lecture room.
- Criticality: **exploratory**, because a handout is a place to try; a mistake is crossed out, not costly.
- Energy: **composed**, because the work, not the page, should hold a student's attention.
- Type: **humanist sans**, on three criteria: l, I and 1 distinct (HCl, 1 L), a large x-height, tabular figures.
- Material model: **printed**, because the artifact is copier paper and a projected slide; nothing floats.
- Colour commitment: **restrained**, one filled colour on a page, the rest ink on white.
- Accent job: **directional**, the cobalt tab marks the current part or step.
- Ground lightness: **light**, paper and a projector in a lit room.
- Ground temperature: **cool, ink-tinted**, so the raised surface reads as the ink's own tint, not a colour.

**Rejected coordinate vector.** Playful, rounded and warm (a rounded display face, pastel part fills, a cream
ground, high energy): it suits an elementary classroom and loses to this reader, whom it would talk down to.

**Rejected values.** Marker red was weighed for the accent and lost: on a handout red reads as a grading mark, and the
status set already needs it for errors. A manila or cream paper ground was weighed and lost: the copier turns a tint
into grey speckle, and a projector washes it to white anyway.

**Type derivation.** Seravek, with Apple SD Gothic Neo for Hangul: its tailed l keeps l, I and 1 apart in chemistry
text, and its x-height holds at 13 px captions. On Windows and in Office the stand-in is Trebuchet MS, which has the
same tailed l, with Malgun Gothic for Hangul.

**Signature element.** The square cobalt part tab: a solid block with a white letter (A, B, C on paper; the step
number on a slide). It prints as a dark block on a copier and is the only filled colour anywhere.

## 1. Palette, with usage rules

- `color.bg` (white) is every page and slide ground.
- `color.bg.raised` is the tip panel and a table's tinted head; no other panel exists.
- `color.text` is all ink. `color.text.muted` is held at 7.8 : 1, because room light roughly halves a projector's
  contrast; nothing lighter than it sets text.
- **`color.accent` is the accent role.** Cobalt fills the part tab and the current step's tab, nothing else: never a
  heading, a word, a rule or a link. One filled tab per slide or component; on paper one per part.
- `color.accent.text` is the tab's letter or number, on the accent fill only (6.7 : 1).
- `color.border` (3.1 : 1) draws write-in boxes, answer lines, check boxes and table cells, because a box to write in
  is a control and must survive the copier.
- The status set (`ok`, `warn`, `error`, `info`) colours a word ("Tip", "Check", "Careful") or a mark beside a word.
  `color.status.info` sets the "Tip" label; nothing carries meaning by colour alone.
- Forbidden: a second accent, any tint carrying meaning, any colour literal in canon.

## 2. Typography roles, with placement rules

| Role | Face | Document (px / line / weight) | Deck on 1920×1080 | Where |
|---|---|---|---|---|
| `type.title` | `font.display` | 30 / 1.25 / 700 | 112 / 1.15 | The handout's or lecture's title |
| `type.subtitle` | `font.display` | 17 / 1.45 / 400 | 52 / 1.3 | The course and lab line |
| `type.h1` | `font.display` | 23 / 1.3 / 700 | 80 / 1.2 | A part (beside its tab); a slide's heading |
| `type.h2` | `font.display` | 19 / 1.35 / 700 | 64 / 1.25 | A table's or section's heading |
| `type.h3` | `font.display` | 16 / 1.45 / 700 | 52 / 1.3 | A question's prompt |
| `type.body` | `font.body` | 16 / 1.65 / 400 | 48 / 1.4 | Instructions, questions, slide text |
| `type.caption` | `font.body` | 13 / 1.45 / 400 | 36 / 1.4 | Constants, footers, name lines |
| `type.quote` | `font.body` | 17 / 1.55 / 400 | 56 / 1.35 | A student's question quoted |

- Every text element takes one of these eight roles; no other size appears in canon.
- Slide body is never below 48 px (24 pt) and nothing on a slide goes below 36 px (18 pt).
- Figures, units and equations are tabular; subscripts are real characters (Cl₂), not shrunken text.
- `font.mono` is for code in a computing course only.
- The approved deck specimen sets body, caption, subtitle and quote at 500 on slides; the token file has no deck
  weight, so slides keep the document weights until it does.

## 3. Canvas, texture and material

- Material model: **printed**. Surfaces part by a rule or by `color.bg.raised`, never by a shadow.
- Handouts and slides carry no shadow: a copier turns it into a grey smear and a projector into nothing.
  `shadow.*` exists only for MAWS's own floating editing UI over a classroom document.
- No texture, no gradient (an answer line is a bottom border, not a gradient), no image ground.
- Every meaning survives a black-and-white copy: the tab prints as a dark block with a white letter.

## 4. Layout system

**Composition lines** (for a lab handout and a lecture deck):

1. Posture: **transient**, a handout is a bounded task a student passes through once, part by part.
2. Dominant activity: **operate**, read an instruction and write an answer; success is every box filled.
3. Unit and relation: the part (A, B, C), in **sequence**; inside a part, questions in sequence.
4. Co-visibility: **none**, one column; the data table sits inside its part.
5. Temporal structure: **static** on paper; on a slide, the current step is "now".
6. Volume and homogeneity: **few, heterogeneous**, three to five parts of unlike shape.

**Compiled consequences.** One column; the name line leads at the top right; each part opens with its tab and an
`h1`; write-in space follows each question at the size an answer needs; on a slide, steps stack with the current one
filled and the others outlined and muted.

**Ledger.**

| Brief evidence | Relationship | Constraint | Rendered assertion | Forbidden move |
|---|---|---|---|---|
| Work is done in parts | sequence | a tab per part | each part opens with one tab and an `h1` | parts told apart by colour alone |
| Students write answers | answer follows question | a box after every question | no question without write-in space | lined space shared by two questions |
| Read from the back row | legibility | deck sizes | slide body ≥ 48 px | a dense slide at document sizes |
| Copied in black and white | survival | border at 3.1 : 1 | write-in boxes are `color.border`, 1.5 px | a light grey box that vanishes |

**Candidates.** Chosen: one column of tabbed parts. Rejected: a two-column worksheet with questions left and answer
boxes right, because answers of unequal length break the grid.

**Prior adopted:** sequence with a marked "now", earned by "the part the room is on". **Defaults overridden by name:**
the card grid of activities, the coloured section band, the sidebar of key terms, the icon row.

**Mechanics.**

- The page is US Letter (`dev.maws.page`; A4 selectable), with 72 px (0.75 in) margins.
- Parts part by `space.6` above and a 1 px ink rule over the tab row.
- Slides are 1920×1080 with 128 px margins; slide spacing is the document scale times 3 (36, 60, 84, 120 px), written
  as px, because the token file carries one spacing scale.

## 5. Component canon

Build order for a handout: name line, title, subtitle, then each part (tab, heading, instruction, answer space), a
tip where a mistake is common. For a lecture: title, part, steps, content.

- `layouts/title.html`: the opening slide (course line, title, subtitle).
- `layouts/part.html`: a part's opening slide, the tab beside its heading, one instruction.
- `layouts/steps.html`: up to four numbered steps; the current one filled, the rest outlined and muted.
- `layouts/content.html`: a heading with a short list.
- `components/part-tab.html`: the part tab with its heading; the only accent fill.
- `components/tip.html`: the tip panel, "Tip" in `color.status.info` on `color.bg.raised`.
- `components/data-table.html`: a write-in data table, quantity, an empty cell and its unit.
- `components/status.html`: a check mark beside its word, for a checklist.
- `components/document.css`: every handout block under `.ds-doc`.

Placeholders are `data-ph="title"`, `subtitle`, `body` and `caption`, plus `tab` (the part letter or step number) and
`steps`, this law's names. Reuse these; a new component is added here before it is used.

## 6. Voice

- Direct and respectful; second person ("Record each mass to 0.01 g."); imperative for instructions.
- Sentence case; units with a space (5.00 L, 0.01 g); constants given with their units where they are used.
- Questions end with a question mark or an imperative, never both.
- Real course names and numbers (AP Chemistry, Lab 3.4; CHEM 1210, Lecture 14); real dates.
- No jokes in instructions, no exclamation marks, no emoji.

## 7. Motion

- Handouts do not move.
- A step slide may build its steps with `data-build-in` one at a time; nothing else builds.
- Transitions between slides are `fade` or none.
- Under reduced motion, builds show at once.

## 8. Hard don'ts

- No colour literal in canon; every colour is a `var(--ds-color-*)`. [check: literal-color]
- No font family outside `font.display`, `font.body` and `font.mono`. [check: font-family]
- No gradient, including for answer lines. [check: no-gradient]
- No shadow outside `shadow.*`, and none at all on a handout or slide. [check: no-shadow]
- No more than one accent-filled element per slide or component. [check: accent-max:1]
- No radius above 12 px. [check: radius-max:12]
- No font size outside the eight type roles. [check: type-scale]
- No slide or component over 45 words. [check: max-words:45]
- No declared text and ground pair below 4.5 : 1. [check: contrast:4.5]
- No accent on a heading, a word, a rule or a link.
- No rounded display face, pastel fill, sticker or cartoon icon.
- No meaning carried by a tint or by colour alone.
- No question without its write-in space.
- No slide body below 48 px.
