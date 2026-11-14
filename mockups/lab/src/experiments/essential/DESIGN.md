# Essential

persona: essentialist

The designer plugin's essentialist persona (Bauhaus after 1923, Rams, Ive) governs this experiment in place of a
sampled stance. Its four questions were asked of every element: does it serve the use, what can still go, did the cut
cost meaning, and if in doubt, leave it out. Its laws are project law here; the accessibility floor still binds.

## 0. Thesis and stance

**Thesis.** A supervisor of many agents needs one answer before any other: *is anything waiting for me?* So the
window is one body in one typeface, every state is drawn with one primitive (a circle), and there is one colour,
which appears only where a session waits for the person. Everything else that the app prints today either became
geometry, moved behind a hover or a click, or was cut.

It is not a glass design, not a warm-paper design, and not a dense instrument. If a decision is ever ambiguous,
choose the more restrained option.

**Axis position** (the persona supplies the coordinates; reasons cite its laws).

- Density: standard. 32 px rows and 13 px interface text; the task is supervising, with long reading in the transcript.
- Criticality: consequential. An approval pushes code. No state is carried by hue alone; the accent never means success or danger.
- Energy: quiet. "Neutral and restrained, not expressive."
- Type: neutral sans, one family. The system face, because it is drawn for 12 px, covers Korean, and is already what the app loads.
- Material: flat, one ground. No steps of surface colour; a fill is the ink at an alpha. Shadow only under the two things that float.
- Colour commitment: restrained. Under 1% of the window is chromatic at rest.
- Accent job: status only, one meaning: *your turn*. Actions are carried by ink, weight and position.
- Ground lightness: both schemes, from one role set. Light is the default the app ships.
- Ground temperature: neutral ground, warm ink. White is the default; warmth lives in the ink (`#1b1a17`) and in the orange.

**Hue audit.** The accent is the owner's orange `#FD780F`, used as given on dark grounds (6.2:1 or better). On the
light grounds a dot of it reaches only 2.5 to 2.7:1, under the 3:1 floor for a mark, so light uses the same hue
darkened to `#eb6902` (3.0:1 on both light grounds). Weighed and rejected: today's terracotta `#c9663f`, which at
dot size on a dark ground reads as a brown close to the ink and is the look being left; and no accent at all, which
leaves "waiting" and "unseen" differing only by two pixels of dot size. Also rejected: putting the orange on Send or
on selection. A colour that means "your turn" cannot also mean "this is the primary button".

**Ground.** Default `#FFFFFF` in light and `#191919` in dark. The persona asks for an achromatic ground and names
off-white as valid, so `#faf9f5` is a knob rather than the default: it is today's look and sits in the cream band.
`#191c19` is offered because the owner listed it; its green cast is the one candidate the persona would refuse.

**Tension with the persona, recorded.** The persona's home radii are 2 to 6 px ("nothing rounded to read as
friendly"). The owner's brief asks for round, soft geometry, and a brief instruction wins per surface. The persona
governs *how* it is round: no radius is chosen by eye. A single-line control is a capsule, a holder's radius is its
item's radius plus the gutter between them, and the composer's 24 px is its 16 px control plus the 8 px inset. The
Corners knob shows the same design at the persona's home radii.

**Glass inventory.** None. The persona's mechanical subset bans `backdrop-filter` and any simulated material, and
the decision function agrees: nothing in this window floats over content that changes beneath it except a menu and
a card, which are opaque so their text keeps its contrast. This bends the owner's "glass on top of the colours".

**Signature.** The mark. One 16 px circle says every state in the app:

| drawn as | means |
|---|---|
| nothing | at rest, seen |
| small solid dot, ink | finished, not seen yet (the title is also semibold) |
| solid dot, orange | waiting for you: an approval, a question, a plan (title semibold) |
| quarter arc turning on a faint ring | working |
| hollow ring | not yet: a task not started, a member switched off, a switch that is off |
| solid disc with a tick | done, or on |
| ring filled from the top | a quantity: usage, context |

A queued message uses the same grammar at another scale: it is an outline until the agent takes it, then a solid
bubble. The Stop button is hollow and Send is solid for the same reason.

**Clone test.** Another supervising tool would share the constraints and perhaps the coordinates. It would not
share the mark grammar, the single meaning of the orange, or the radii derived from nesting.

## 1. Tokens (values live in `essential.css`, at the top of `.x-essential`)

| role | light | dark |
|---|---|---|
| `--ground` (knob) | `#ffffff` / `#faf9f5` | `#191919` / `#1f1f1f` / `#000000` / `#191c19` |
| `--ink` | `#1b1a17` | `#edebe7` |
| `--ink-2` secondary text | ink 64% into ground (5.1:1 or better) | ink 62% (6.1:1 or better) |
| `--ink-3` marks and glyphs, never text | ink 48% (3.1:1) | ink 42% (3.5:1) |
| `--fill-1` hover, code | ink 4% | ink 6% |
| `--fill-2` selected, said by you, tracks | ink 7% | ink 10% |
| `--line` / `--line-2` | ink 10% / 20% | ink 11% / 22% |
| `--raised` menu, card | `#ffffff` | ground + 8% white |
| `--accent` / `--on-accent` | `#eb6902` / ink | `#fd780f` / `#1b1a17` |

Rules. Every tone is the ink mixed with the ground, so a new ground needs no other edit. Colour literals outside
the token block: the three traffic lights (platform chrome) and the black of the scroll mask. Nothing else.

- Radii: `--r1` 10 (row, item), `--r2` 14 (menu, card, code; r1 + 4), `--r3` 24 (composer, your message), capsule for
  any single-line control. Rounded rectangles take `corner-shape: squircle`; capsules and circles stay circular.
- Spacing steps: 2, 4, 8, 12, 16, 20, 24, 32, 48. Rows are 32 px, or 48 px with a second line. Bays are 256 px: the
  sidebar, the side column, and the label and note columns of settings are all one bay.
- Shadow: one, `--shadow-pop`, on the menu and the card. The composer has a ring, not a shadow: it does not float.
- Type: one family (`system-ui`) and its mono for code, paths and commands only. Two weights, 400 and 600. Three
  sizes: 12 (meta, mono), 13 (interface), 15/24 (prose, your message, the composer, section titles at 600).
  Semibold means one of two things: a heading, or "there is something here for you".
- Motion: 100 ms hover and press; 150 ms menu, card, note, switch colour; 220 ms for things that move (fold, thumb,
  sidebar). `cubic-bezier(0.4, 0, 0.2, 1)` and, for movers, `cubic-bezier(0.32, 0.72, 0, 1)`. No overshoot. The only
  continuous motion is the turning arc, which is a state. `prefers-reduced-motion` stops all of it.

## 2. Composition

Lines: workspace posture; the first read is *monitor* (who waits) and then *read* (the transcript); the unit is a
session inside a project (hierarchy, shown by a label and a gap, never a nested box); list and detail are peer panes
with a supporting column; live; many units in six states.

Consequences. Three bays: 256 / fluid / 256, so the transcript is never less than 3 times a side bay at 1280.
The sidebar is earned by four destinations and nine sessions. Rows never reorder when state changes: the orange gathers the waiting
ones by eye without moving anything under the pointer. The transcript opens at its latest line because the session
is working. The request is answered where it is noticed: pointing at (or clicking, or focusing) a waiting row or
tab opens its card beside it with the command, the reason and the two answers.

Rejected: an inbox group that lifts waiting sessions to the top (rows would move as state changes, and colour
already does the gathering); a banner or toast for the approval (a second place to look, and it would cover the
session being read); tasks inline in the transcript with no side column (progress must stay visible while reading).

Not built: an automatic collapse below 1280. Both side bays collapse by their own buttons.

## 3. What is on screen, and what is not

At rest a session row is a mark and a title. A waiting row adds one line: what it needs. Age, shortcuts, tool-run
durations, an agent's current line, the branch and the machine appear on hover or focus, in a fixed slot or in the
card, without moving anything. Settings prints label and control; a row's note appears in the right margin when the
row is pointed at or focused. The "Words at rest" knob moves this line: Titles only, What needs you, Everything.

Cut outright: section labels ("Pinned", "Projects": the pin glyph and the project names say it), state words
(the mark says it; the words remain as accessible names), tab separators, per-tool icons, the red and green of
diff counts and lines (the sign says it), the label on a row whose control is a labelled button, the composer's row
of chips (one control opens model, effort, mode, context and branch).

**Removal pass.** Tried and reversed: with titles only, three orange dots say *that* three sessions wait but not
what for, and the row has to be opened to learn it; the second line stayed, on waiting rows only. The context ring
was removed from the composer, where it sat beside the turning mark and read as a second spinner; the quantity
came back inside the model menu with its number. Also built and withdrawn: usage as two filled discs (it read as a
theme toggle), a solid Stop button (the heaviest object in the window for the least wanted action), and the session
title and age repeated inside the card. Weighed and kept without building the alternative: the hairline between
the bays, and the three headings of the side column, whose tasks and agents are drawn with the same marks.

**Gloss check.** One gradient exists: a 16 to 24 px mask at the two edges of the transcript, which says the text
continues past the edge. No decorative shadow, tint or texture.

## 4. Components

Mark and Dial (`parts.tsx`); row (32 or 48); project label with fold; tab (capsule; its mark becomes a close glyph
on hover); card; menu with 32 px items; composer; send / stop; switch (hollow off, solid on); segmented control with
a sliding key; member (a circle that is hollow or solid, replacing both checkbox lists and small switch lists);
field; quiet, ring and accent buttons. The accent button exists once: the answer to a request.

## 5. Voice

Sentence case, no exclamation, no status adjectives. A second line states a need ("Which events should retry?").
Tooltips are numbers with their unit. Nothing reassures, counts down or congratulates.

## 6. Hard don'ts

- No second chromatic colour; no orange on anything that is not a waiting session or the answer to one.
- No `backdrop-filter`, no simulated material, no `text-shadow`, no gradient other than the scroll mask.
- No third weight, no second interface family, no mono in prose or labels.
- No shadow on anything that does not float. No nested boxes for hierarchy.
- No radius or gap outside the scales above.
- No motion that is not a state change; no overshoot.

## 7. To ship this in the app

The app today is cream and white with a terracotta accent, 6 px on nearly every control, square tabs, 30 px rows, a
44 px toolbar, and no motion on overlays. To get from there to this:

- **Tokens.** The role names can stay; the values change, and three roles are missing: a ground for what floats that
  differs per scheme, a "your turn" colour separate from the general accent (today one accent does selection, focus
  and brand), and motion durations and easings, which are not tokens at all today. Deriving every tone from ink and
  ground with `color-mix` would replace the two hand-kept value lists.
- **Radius.** One small radius token is applied to rows, buttons, chips, tabs and inputs alike. This design needs
  the roles split (row, holder, composer, capsule) before any value changes, and tabs rebuilt as capsules, since
  today they are square by structure, not by token. Electron 44 draws the continuous corner with
  `-electron-corner-smoothing: system-ui`.
- **The mark.** A single state-mark component used by the sidebar, tabs, tasks, agents and background work, in
  place of the separate hand-drawn status icons and words. The switch, the checkbox lists and the usage readout
  adopt the same grammar. Diff colours and per-tool icons are removed from the transcript's own stylesheet.
- **Disclosure.** A shared hover/focus card for a row or tab, and the settings note column. The settings page needs
  its help strings kept as data but moved out of the flow; several rows need no note at all.
- **Menus.** There is no shared menu or popover primitive; each call site styles its own. Entry motion, the raised
  surface and the nested radii belong in one component, which has to be written first.
- **Geometry.** Bay widths, the toolbar height and the traffic-light clearance live in TypeScript and literal
  utility classes, not in tokens; the 256 px bays and the 48 px bar are edits there. The window's own background
  colour is set in the main process and must follow the ground.
- **Guard.** The existing lint that forbids colour literals would also need to forbid radii, shadows and durations
  written in place, or the scales above will not hold.
