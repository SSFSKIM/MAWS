# Quiet

The control experiment of the lab: the redesign with no material at all.

## 0. Stance

One flat ground. Every boundary is a hairline of the ink at low alpha, every corner is continuous and rounder than
today, and exactly one object floats: the composer. Words are kept off the screen until asked for; state is said with
a glyph, and orange is spent only where the next move is the person's. It works in the manner of Claude Desktop (a
flush sidebar, ink-alpha borders, title-only rows, folded tool runs, short settings rows) with values derived for
this product rather than taken from that one.

It is not glass, not tonal (no white sheet lifted off a tinted ground), and not a card layout.

If a decision is ever ambiguous, choose the option that puts less on the screen.

| Axis | Position | Reason |
|---|---|---|
| Density | standard, leaning spacious | 34 px rows and a 680 px measure: supervision needs a scannable list, reading needs air |
| Criticality | consequential | an approval pushes code; nothing may look like a state the system is not in |
| Energy | quiet | the agents are the busy part; the app should be the still part |
| Type | neutral system sans for the app, a reading serif for the assistant only | the split says who is speaking without a label |
| Material | printed: one ground, hairlines, two shadow recipes | this is the question the experiment asks |
| Colour commitment | monochrome ink on the ground, one accent | so that the accent is noticed when it appears |
| Accent job | "it is your move", and nothing else | the app's scarce event is a session waiting on the person |
| Ground lightness | light default, dark designed | the owner's stated default |
| Ground temperature | faintly warm light, neutral dark | the owner's candidates; warmth is carried by type and orange |

Rejected on the way: the app's present terracotta as accent (the owner named `#FD780F`); a white sidebar or white
content sheet on the warm ground (adds the surface step the experiment exists to remove). The sampler offered
vernacular, swiss and luxury-fashion with geometric or script type and a two-tone canvas; the brief names its manner
explicitly, so all were declined, swiss being the nearest in spirit.

**Signature element.** The trailing slot of a row. It is 28 px, it holds the state glyph at rest, and under the pointer
the glyph steps aside for the row's actions in the same place. The same glyphs, gathered into one orange capsule at
the top right, are the whole "what needs me" indicator: no count, no word.

## 1. Colour

Each scheme has two inputs, a ground and an ink. Every neutral is a mix of the two, so a ground can be swapped (the
Ground knob does this) and the whole interface follows.

| Role | Light | Dark |
|---|---|---|
| ground (knob) | `#faf9f5` · `#ffffff` | `#191919` · `#191c19` · `#1f1f1f` · `#000000` |
| ink | `#1b1a17` | `#f4f2ed` |
| text | ink | ink 93 % |
| secondary text | ink 76 % | ink 74 % |
| muted text (smallest text allowed) | ink 62 %, 4.8 : 1 on the warm ground | ink 58 %, 6.0 : 1 |
| faint (marks only, never text) | ink 42 % | ink 40 % |
| hairline / strong hairline | ink 9 % / 16 % alpha | ink 10 % / 16 % alpha |
| hover / selected / well | ink 4.5 % / 7.5 % / 5.5 % alpha | ink 6 % / 10 % / 7.5 % alpha |
| raised (composer, popovers, segmented thumb) | `#ffffff` | ink 7 % over the ground |
| accent fill | `#fd780f` with `#2a1300` text (6.6 : 1) | same |
| accent mark (glyphs) | `#d95f06` (3.6 : 1) | `#fd780f` (6.6 : 1) |
| accent text | `#b84a00` (5.0 : 1) | `#ff8a2b` |
| diff added / removed | `#23794a` / `#c0392b` | `#6fcf97` / `#f08a7e` |

Rules:
- The owner's orange is 2.5 : 1 on the light ground, so it is used there as a fill only; glyphs and text take the two
  deeper steps of the same hue. This is the one place the brief's value is bent.
- Orange appears on: the glyph of a session waiting on the person, the waiting capsule, the Approve button, the Send
  button once there is text, and the focus ring. Nowhere else. Switches, checks, selection and running state are ink.
- Grey means the agent's business (a breathing 7 px dot: running). Solid ink means something new to read (a dot and
  a heavier title: finished, unread). Orange with a shape means the person's move (hand: approval, question mark:
  question, checklist: plan). Shape carries the meaning without the colour.
- Diff green and red are the only other hues, and only on changed lines and their counts.

## 2. Type

| Role | Face | Size / line |
|---|---|---|
| Interface | `system-ui` (SF Pro; Apple SD Gothic Neo for Korean) | 14 / 20; 13 in tabs, captions, side column; 12 for group labels |
| Assistant prose | Literata variable (latin `woff2`), then `ui-serif` | 15.5 / 25, weight 380 light and 350 dark, old-style figures |
| The person's message | interface sans | 15 / 22 |
| Code, paths, commands | `ui-monospace` | 12 / 18–20 |
| Section title (settings) | interface sans 600 | 20 / 28 |
| New-chat question | the serif | 27 / 34 |

The serif belongs to the assistant: its prose, and the one line the app says in the assistant's voice on the new-chat
page. Labels, buttons, captions and the person's own messages never use it. The Prose knob sets the same transcript in
the sans, for judging whether the serif earns its place. Literata was chosen over Newsreader (too fine at this size,
thin on dark), Source Serif 4 (sound but plainer) and the system serif (narrow and bookish) after setting the same
paragraph in each. Weights drop in dark so light text does not swell.

## 3. Ground, lines, elevation

- The sidebar, tab row, transcript and side column paint the same ground. The sidebar and side column are parted from
  the centre by one 0.5 px hairline each; there is no rule under the tab row and none above the composer.
- The transcript fades out at both ends through a mask on the scroll area. A painted gradient would band on a flat
  ground, so nothing is painted.
- Shadows: `float` for the composer (a 0.5 px ring, 1 px contact, 28 px ambient at 10 %), `pop` for anything opened
  (ring, 6 px, 36 px at 18 %). Dark uses black at higher alpha. Nothing else has a shadow.
- A card in the transcript (an edit, a running command, an opened tool run) is a 0.5 px inset ring on the ground. It
  has no fill and no shadow.
- Corners are continuous (`corner-shape: squircle` here, `-electron-corner-smoothing: system-ui` in the app). Full
  circles and capsules stay circular.

| Radius | Today | Rounder (default) | Roundest |
|---|---|---|---|
| control: row, tab, button, chip, input | 6 | 11 | capsule |
| item inside a popover | 6 | 9 | 15 |
| popover (item + 5 px gutter) | 10 | 14 | 20 |
| transcript card | 14 | 18 | 26 |
| message bubble | 22 | 22 | 26 |
| composer | 22 | 26 | 32 |

## 4. Layout

Composition lines: posture, a desk tool left open all day; dominant activity, reading one transcript and answering;
unit, a session (a row) and a turn (prose with its work folded under it); co-visibility, every session's state beside
the transcript, and what waits for the person from anywhere; temporal structure, live, with the newest line at the
bottom; volume, tens of like rows in the sidebar, a handful of unlike blocks in the side column.

- Sidebar 272 px, side column 296 px, both collapsible; the transcript column is 680 px, centred in what is left. At
  1440 px that is 872 px of centre to 272 of sidebar, 3.2 : 1.
- 48 px tab row. Traffic lights at 16 / 18 px; the sidebar toggle sits beside them and stays when the sidebar closes,
  when the tab row moves right to clear both.
- Sidebar rows are a title and the slot. The second line, the branch, the machine and the age are in a card that
  appears beside the row after 420 ms and then follows the pointer from row to row without waiting again.
- Side column: four unframed lists (tasks, changes, agents, background), each a 12 px grey label and 30 px lines.
- Settings is a page, not a dialog: the sidebar becomes its index, one 620 px column of rows, 54 px each, parted by
  hairlines. The right margin is kept empty on purpose: it is where a row's sentence appears.

Forbidden moves: a second raised surface at rest; a fill on a transcript card; a status word in a row; a count badge.

## 5. Components

- **Row** (sidebar, settings index): 34 px, control radius, hover 4.5 % ink, selected 7.5 %. Unread rows are 560
  weight; idle rows are muted. Titles that do not fit fade out; there is no ellipsis.
- **Slot**: see the signature. Tabs use the same exchange (state or file glyph gives way to close).
- **Caption**: a folded run of work is one 13 px muted line. Its chevron and duration exist only under the pointer.
  It opens in place into a ringed list of verb, target, result.
- **Composer**: the floating object. A queued message rides inside it as a chip above the field. One button at the
  end: a stop square in ink while a turn runs, an orange arrow once there is text. Model, effort, mode, folder and
  branch are behind the single model chip. Context is a ring; its number is in the tooltip.
- **Popover**: raised colour, pop shadow, 5 px gutter, items one step less round than the shell.
- **Approval**: the command in a well, one sentence, Deny and Approve. It is answerable from the row's card and from
  the waiting capsule; answering turns the session grey and removes its orange everywhere.
- **Switch** 38 × 22, ink when on. **Segmented**: a well with one raised thumb that slides. **Check**: 18 px, ink.
- **Tooltip**: inverted, 12 px, after 480 ms. It carries every word that was taken off the screen.
- **Usage**: two nested rings in the sidebar foot; the numbers are one click away.

## 6. Words

At rest the session window prints: session and project names, the transcript, and the side column's own content. Cut
or moved behind hover: status words, ages, branches in rows, the composer's five chips, the usage percentages, tool
durations, the full Claude Code path (its version stays), "Sidebar"-style labels on icons.

Settings help is a knob with three answers. **On hover** (default): rows are label and control only, and the full text
appears in the right margin beside the row under the pointer or holding focus. **One sentence**: the first sentence of
the text under the label. **Expander**: a chevron after the label opens the full text below. Six plugin switches and
six notification checks are folded to "5 of 6" until opened.

Sentence case everywhere. No uppercase labels, no exclamation marks.

## 7. Motion

Nothing appears or leaves without moving, and nothing bounces.

| What | Duration | Curve |
|---|---|---|
| press | 90 ms | scale to 0.92–0.97 |
| hover, slot exchange fade | 130 ms | linear fade; the entering glyph scales 0.8 → 1 over 210 ms |
| popover, tooltip, card in | 210 ms | `cubic-bezier(0.22, 1, 0.36, 1)`, from 0.95 scale at the corner nearest its anchor |
| popover out | 130 ms | ease-in, to 0.97 |
| fold open and close, switch, segmented thumb | 300 ms | same curve; height by `grid-template-rows` |
| sidebar, side column, scene change | 340 ms | same curve; width with the content sliding 28 px and fading |

The running dot breathes over 1.8 s; it is the only continuous motion besides the two spinners. The hover card
re-anchors over 200 ms instead of closing and reopening. Under `prefers-reduced-motion` every transition and animation
is cut to 1 ms and all state changes still happen.

## 8. Hard don'ts

- No `backdrop-filter`, translucency, gradient fill or texture anywhere.
- No shadow except `float` on the composer and `pop` on something opened.
- No orange that is not the person's move or the focus ring.
- No text in the faint tone; nothing smaller than 12 px.
- No status word, count or timestamp in a row at rest.
- No colour literal outside `tokens.module.css` (mask stops and the three traffic lights excepted).
- No serif on anything the app says in its own voice, apart from the one new-chat line.

## What was tried and dropped

- A second line under each session title: it doubles the sidebar's ink for information wanted on one row at a time.
- The queued message as a tab riding on top of the composer: it read as a second object and broke "one thing floats".
- A count on the waiting capsule: three glyphs already say three, and say which kind.
- Painted fades over the transcript ends: visible banding on the flat ground.
- Orange switches and checks: they made a settings page look like it needed attention.

## What the experiment found

Roundness, room and subtraction carry most of "refined, simple, intuitive" without any material, and the serif plus
the orange carry most of "warm". What does not arrive is "modern-futuristic": with no depth, no light and no
translucency the result reads as calm and well made rather than new. On `#ffffff` and `#000000` the sidebar has only
its hairline to stand on and the window starts to look unstructured; the warm and `#191919` grounds hold up better
only because the eye reads their slight tint as a surface. Hover-only help depends on a pointer and on the empty
margin; below roughly 1280 px of width the margin note runs out of room.

## To ship this in the app

Nothing here needs the main process, a transparent window, vibrancy or a library; it is a token change plus a set of
shared primitives the renderer does not have yet.

1. **Tokens.** Replace the values in the renderer's token sheet with the table in §1 (ground `#faf9f5` / `#191919`,
   ink mixes, the three orange steps instead of the terracotta pair) and keep the main process's copy of the window
   background colour in step. Express neutrals as mixes of ground and ink so the dark candidates can be A/B-tested.
2. **Radii.** Today one 6 px token serves nearly every row, button, chip and input. Split it into the roles of §3
   (control, item, popover, card, bubble, composer) before changing any value, or the popover and its items cannot be
   made concentric. Turn on `-electron-corner-smoothing: system-ui` globally, exempting capsules and circles.
3. **Tabs.** They are square cells parted by rules by structure, not by token; they have to be rebuilt as separate
   rounded items with a gap.
4. **Motion.** There are no duration or easing tokens and no overlay has entry or exit motion. Add the six durations
   and one curve of §7 as tokens, then one shared wrapper for menu, popover, dialog and tooltip content that applies
   them, since each call site carries its own class string today. Honour reduced motion in that wrapper.
5. **Sidebar rows.** Remove the second line and the age from the row, add the trailing slot with the glyph-to-actions
   exchange, and move the removed text into the existing hover card. The row's literal pixel values live in the
   component, not in tokens, so this is an edit to the row and section components.
6. **Transcript.** Fold tool runs and thinking under a caption by default, drop the fills on tool and edit cards in
   favour of the inset ring, and set assistant prose in the serif at 15.5 / 25. This is the hand-built transcript
   stylesheet, and it is the largest single piece of work.
7. **Font.** Bundle Literata's variable latin file with the app (remote fonts are blocked by its content policy) and
   add a prose-font setting with the sans as the alternative.
8. **Composer.** Collapse the chips into the model chip's popover, move the queued message inside the frame, and make
   the end button's state (stop, send) the only use of ink and orange in it.
9. **Settings.** Reduce each row to label and control, move the help text to the margin note with the expander as the
   narrow-window fallback, and fold the plugin and notification lists.
10. **Waiting capsule.** New: a toolbar item fed by the same pending-request data the sidebar already has, with the
    approval answerable in its popover.
11. **Guard.** The colour-literal test does not see radii, shadows or durations; extend it, or the roles above will
    drift back into literals.
