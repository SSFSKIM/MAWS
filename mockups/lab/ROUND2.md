# Round 2: three syntheses

The owner looked at round 1's seven experiments and no single one was the answer. They named the parts they want
from each, and asked for a few attempts at putting those parts together. Read BRIEF.md first: its contract (scenes,
schemes, sizes, live motion, knobs, fonts, styles, building, handing back) holds for round 2 unchanged.

A synthesis is not a new design. The owner chose specific things they saw, so the work is to carry those things over
faithfully and to solve what happens where they meet. Lift the code of a chosen part from its experiment's folder
(`src/experiments/<id>/`, each with a DESIGN.md that records its values and reasons) and adapt it; do not redraw it
from a description. Look at the source experiment's captures in `shots/<id>/` before and after, and compare.

## What the owner chose

Out: Windows, Essential and Signal as wholes. Kept, paraphrasing what the owner said of each:

- **Left sidebar: Field's pane, Quiet's content.** The owner liked Field's side panel best as a component (its
  size, material and texture), and Quiet's for everything about the content: put Quiet's sidebar inside Field's
  component style, with its shorter sessions, motion, simpler session rows and the rest. A Liquid Glass left sidebar
  component works well.
- **Tabs: Instrument's.** Instrument's tab space was the best; making it a separate Liquid Glass component was a
  good move.
- **Composer: Liquid Glass.** The owner found a Liquid Glass composer very good-looking, said of Windows, whose
  composer sits outside the reading surface over the coloured environment.
- **Tool-run summary and its opened block: Quiet's** (the pill caption with its chevron and duration, and the
  rounded card listing the calls). The transcript's other content also follows Quiet.
- **No serif.** Quiet's serif prose is rejected: the owner will not use its formal typography.
- **Right column: a glass component, with more in it.** A Liquid Glass right sidebar also works very well, somewhat
  as Windows does it but not exactly: not Windows' style, only its way of building sidebar components from Liquid
  Glass and round geometry. Everything else there is too simple; blend in Desktop.
  Reading taken: Windows' construction (a rounded glass pane), Desktop's content and level of detail.
- **New chat: Quiet's**, and Liquid Glass suits new chat very well: Quiet's layout with the composer as glass.
- **Settings: Quiet's geometry, Instrument's motion and glass**, Instrument slightly ahead. Quiet's page folds away
  too much. Reading taken: lists (plugins, notify-for) stay visible as pills as in Instrument; a help sentence waits
  beside its row for hover or focus.
- **A suggestion to try:** carry Liquid Glass into the tool-use parts and blocks too, and beyond.

Answers the owner gave after this brief was first written (2026-11-14): the settings reading above is confirmed;
a waiting approval is answered Quiet's way in all three syntheses (a capsule of glyphs at the top right, a card from
the waiting sidebar row); the owner uses both colour schemes equally; and of the right column, not to worry much,
since what lands on main after ux-wave will be used anyway; the only note is that it should feel like a separate,
floating Liquid Glass component, so its content is plain and only its container is judged.

Not judged by the owner, so yours to decide and to make easy to compare: where a waiting approval is answered, the
user's message, diff and running-command blocks, the usage mark, what the composer carries, the dark scheme's
ground.

## What round 1 found, so you do not find it again

- A pane the size of a sidebar over soft colour looks almost the same drawn by the glass library and drawn with a
  CSS backdrop blur and a tint. Real refraction shows on small controls over content with detail.
- Glass over a white ground is nearly invisible at rest. It reads over colour, over dark, and over content passing
  beneath it.
- The library asks for about 65 px between two window-sized glass groups and reports overlap below that; small
  controls need far less. A page with a glass pane on each side, a glass tab capsule, a glass composer and glass
  popovers has to plan its groups, or draw its large panes with CSS and keep the library for the controls. Either
  is acceptable; the record says which path each surface took and what the library reported.
- The library's secondary ink measured under 4.5:1 on light panes: author the second level yourself. A host that
  moves without resizing must have its geometry invalidated for the length of the move. Hosts are portalled into the
  root's planes, so a CSS variable set on a wrapper does not reach them.
- `#FD780F` is about 2.6:1 on the light grounds: every experiment used it as a fill and darkened it for small marks
  and text in light. Every experiment reserved orange for "this needs you".
- `ui-rounded` does not resolve in Chrome.
- `tools/shot.mjs` now takes steps (`--do=hover:…`, `click:`, `scroll:`, `blur`) and `MOTION`, `CONTRAST`, `FORCED`.

## What the three have in common

- Knobs: field strength; ground (the owner's candidates for both schemes); typeface, so the owner can feel it on
  one layout: Field's (Figtree), Instrument's (Geist), and the system face; and one knob of your own.
- All three scenes: `session`, `settings`, `home`.
- `DESIGN.md` records, for every part above, which experiment it was lifted from and what you changed and why, the
  conflicts you met between parts and how you settled each, and the glass inventory with the path each surface took.

## What differs: where the reading happens, and how far glass goes into it

| id | name | the main space |
|---|---|---|
| `sheet` | Sheet | Field's structure kept: the colour field runs under the whole window; the transcript is read on an opaque rounded sheet; every control (sidebar pane, right pane, tab capsule, composer) is glass standing on the field around that sheet. |
| `open` | Open | No sheet: one ground, with the field as light that gathers under the panes and the composer and fades to the plain ground where text is read; the transcript runs under the floating glass tabs and composer. |
| `layers` | Layers | The owner's suggestion taken all the way: the field shows across the main space and the transcript's blocks (tool runs, diffs, running commands, the user's message) are glass components over it, prose between them; the right column is separate glass modules. |
