# Official

A system for an institution's paperwork: letters to families, notices, permission slips, memos and the packets
projected in staff meetings. The token file (`tokens.tokens.json`) wins for every value; this law wins for usage. When
the canon and this law disagree, fix the canon.

## 0. Stance commitment

Official is one ink on white Letter paper: a serif to read, a sans to find, ruled tables, and no hue at all. The
reader's one required action (return by a date, a decision needed) is set reversed, white out of the ink. It is not a
brand: it carries no emblem colour and imitates no letterhead mark, because those belong to an institution, not to a
system. If a decision is ever ambiguous, choose the option that survives a monochrome laser printer, a copier and a
scanner unchanged.

**Axis position** (two constraints the brief fixed, seven coordinates chosen):

- Density: **standard, leaning dense**, because a family member or a colleague reads closely and a packet is tabular.
- Criticality: **transactional**, because consent, money and deadlines are at stake.
- Energy: **quiet**, because an official page asks to be trusted, not noticed.
- Type: **characterful serif body with sans headings**, so a letter reads straight through and its parts are found.
- Material model: **printed**, because the page lives in a copy chain: printer, copier, scanner, filing cabinet.
- Colour commitment: **restrained**, to the point of none: ink, white and one light grey.
- Accent job: **none, a monochrome language**: the accent token holds the ink and is used reversed.
- Ground lightness: **light**, laser paper.
- Ground temperature: **neutral**, so a scan and an original look the same.

**Rejected coordinate vector.** An institutional letterhead (an emblem colour on headings and rules, a display serif
title, a tinted ground): the school has no emblem colour, and colour that carries meaning falls out somewhere along
the copy chain.

**Rejected values.** Navy was weighed for the accent and lost: it reads as an institution's identity colour, which
this system must not invent, and it prints as a muddy black anyway. An off-white bond ground was weighed and lost:
laser paper is white, and a tinted page reads as a scan of a scan.

**Type derivation.** Body: Charter, with the bundled Noto Serif KR for Hangul (Regular and Bold, `assets/`, SIL OFL
1.1), because a serif carries a long letter and AppleMyungjo has one weight and loose Hangul. Headings, table heads,
labels, captions and the signature block: SF Pro Display with Apple SD Gothic Neo. In Office the body is Cambria with
Batang and the headings Segoe UI with Malgun Gothic; Office names faces and never embeds them.

**Signature element.** The ruled table with a light grey head column, bounded by heavy ink rules, separated by
hairlines: the one shape every official page shares, and the reason it survives a photocopy.

## 1. Palette, with usage rules

- `color.bg` (white) is every page and slide ground.
- `color.bg.raised` (light grey) is a table's head column or head row, and nothing else.
- `color.text` is all ink: body, headings, rules that bound a table, the signature line.
- `color.text.muted` (7.0 : 1) is for the letterhead line, the date line, captions and the signer's title.
- **`color.accent` is the accent role, and it is the ink** (an alias of `color.text`). It is used only reversed: an
  accent fill with `color.accent.text` (white) on it, for the one thing the reader must do or decide. One reversed
  block per page or slide.
- `color.border` (2.0 : 1) is the hairline between table rows and the cut line; never a control's only edge. A box to
  tick or a line to sign is drawn in `color.text`.
- The status set is for a packet's status column only, always as symbol and word: ✓ Done (`ok`), ▲ Scheduled
  (`warn`), ✕ Not started (`error`). `info` is unused on paper.
- Forbidden: any hue on headings, rules or panels; an emblem colour; any colour literal in canon.

## 2. Typography roles, with placement rules

| Role | Face | Document (px / line / weight) | Deck on 1920×1080 | Where |
|---|---|---|---|---|
| `type.title` | `font.display` | 26 / 1.3 / 700 | 76 / 1.25 | The letter's or memo's subject |
| `type.subtitle` | `font.display` | 15 / 1.55 / 500 | 36 / 1.45 | The document type, date and office |
| `type.h1` | `font.display` | 19 / 1.4 / 700 | 56 / 1.3 | A numbered section; a slide's heading |
| `type.h2` | `font.display` | 17 / 1.45 / 700 | 44 / 1.35 | A subsection ("What to bring") |
| `type.h3` | `font.display` | 15 / 1.55 / 700 | 36 / 1.4 | A run-in label |
| `type.body` | `font.body` (serif) | 15 / 1.7 / 400 | 36 / 1.55 | The letter's text, table cells |
| `type.caption` | `font.display` | 12 / 1.5 / 400 | 26 / 1.45 | Letterhead line, notes, the signer's title |
| `type.quote` | `font.body` (serif) | 15 / 1.7 / 400 | 40 / 1.5 | A quoted policy or rule |

- On paper the body is serif and everything that is found rather than read is sans: headings, table heads, labels,
  the signature name, a reversed action.
- **On a slide the body is sans**: slides set body and quote text in `font.display`, because thin serif strokes wash
  out on a projector. The token file has one body face, so the canon applies this rule.
- Bold inside body text is set in `font.display`.
- Figures are lining and tabular in tables; money is written $28, dates in full.
- No size outside the eight roles appears in canon.

## 3. Canvas, texture and material

- Material model: **printed**. Parts are separated by rules and by the grey head column, never by a shadow or a card.
- `shadow.sm` frames the Letter sheet on screen only; `shadow.md` and `shadow.lg` are for MAWS's own menus and dialogs
  over the document. Print carries no shadow.
- No texture, no gradient, no watermark, no image ground.

## 4. Layout system

**Composition lines** (for a letter to families with a detachable slip, and a meeting packet slide):

1. Posture: **narrative**, a letter is read in the writer's order, then the slip is filled.
2. Dominant activity: **read**, then **decide**; success is a signed slip returned by the date.
3. Unit and relation: the letter's facts as a **set** of labelled values; the slip as a sequence of fields.
4. Co-visibility: **none**, one column; the slip follows the letter below a cut line.
5. Temporal structure: **scheduled**, a date of the event, a date to return, a date to pay.
6. Volume and homogeneity: **few, heterogeneous**: a letter, one fact table, a list, a signature, a slip.

**Compiled consequences.** One column; the letterhead line and the date lead; the subject is the title; the facts sit
in one ruled table of label and value; the signature block closes the letter; the cut line and the slip follow; the
return date is the one reversed block.

**Ledger.**

| Brief evidence | Relationship | Constraint | Rendered assertion | Forbidden move |
|---|---|---|---|---|
| Facts a family must find | label → value | one ruled table, grey head column | date, place, cost, payment are table rows | facts scattered through paragraphs |
| One date that matters | the action | one reversed block | exactly one accent fill on the page | a second reversed block or a coloured date |
| A slip is detached | sequence after a cut | a dashed cut line, then the slip | the slip sits below "Detach and return" | the slip on a second page |
| Copied and scanned | survival | ink rules and grey only | no meaning carried by hue | a coloured status without its symbol |

**Candidates.** Chosen: one column with a fact table. Rejected: a two-column letter with a facts sidebar, because a
sidebar is lost when the page is copied at reduced size or read on a phone.

**Prior adopted:** list beside detail is declined; the **ruled fact table** is this system's prior, earned by "facts
a family must find". **Defaults overridden by name:** the coloured letterhead band, the card of key dates, the icon
row, the centred title block.

**Mechanics.**

- The page is US Letter (`dev.maws.page`; A4 selectable), with 72 px (0.75 in) margins.
- The letterhead line sits over a 2 px ink rule; tables are bounded by 2 px ink rules and divided by 1 px hairlines.
- Sections part by `space.5`; the signature block by `space.6`; the cut line by `space.7` above it.
- Slides are 1920×1080 with 128 px margins; slide spacing is the document scale times 2.5 (50, 70, 100 px) and rules
  double (4 px bounding, 2 px hairlines), written as px, because the token file carries one spacing scale.

## 5. Component canon

Build order for a letter: letterhead line, date, title, salutation, body, fact table, lists, signature block, cut
line, slip, the reversed return date. For a packet: title, content, table, decision.

- `layouts/title.html`: the opening slide (meeting line, title, date and room).
- `layouts/content.html`: a heading over a short list, set in sans.
- `layouts/table.html`: a ruled table slide, the packet's main form, with a status column.
- `layouts/decision.html`: a heading and the one reversed "Decision needed" band.
- `components/fact-table.html`: the ruled label and value table with a grey head column.
- `components/action.html`: the one reversed block, "Return by Friday, October 23".
- `components/status.html`: symbol and word, the only status form.
- `components/signature.html`: the closing, the signature line, the name and title.
- `components/document.css`: every letter block under `.ds-doc`, with the Noto Serif KR faces from `assets/`.

Placeholders are `data-ph="title"`, `subtitle`, `body` and `caption`, plus `table` and `decision`, this law's names.
Reuse these; a new component is added here before it is used.

## 6. Voice

- A US institution's register: courteous, complete sentences, no contractions in a letter, plain words.
- Open with "Dear Families," or the recipient's role; close with "Sincerely," and the signer's full name and title.
- Dates in full (Friday, October 23, 2026); times as 8:15 a.m.; money as $28 with what it covers.
- Every request says what, by when, to whom: "Return the slip by Friday, October 23, to your student's teacher."
- Numbered sections where a reader will refer back; no exclamation marks, no emoji.

## 7. Motion

- Paper does not move.
- Packet slides change with no transition or a fade; nothing builds.
- Under reduced motion, nothing changes.

## 8. Hard don'ts

- No colour literal in canon; every colour is a `var(--ds-color-*)`. [check: literal-color]
- No font family outside `font.display`, `font.body` and `font.mono`. [check: font-family]
- No gradient, watermark or tinted band. [check: no-gradient]
- No shadow outside `shadow.*`, and none on paper. [check: no-shadow]
- No radius above 6 px. [check: radius-max:6]
- No font size outside the eight type roles. [check: type-scale]
- No declared text and ground pair below 4.5 : 1. [check: contrast:4.5]
- No more than one reversed block per page or slide.
- No hue on a heading, a rule or a panel; no emblem colour.
- No status without its symbol and word.
- No serif body text on a slide.
- No table without its bounding ink rules.
