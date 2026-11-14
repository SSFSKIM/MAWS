# Signal

Experiment `signal`, order 50. One idea: **the colour under the sidebar's glass is the state of each session.** The
sidebar is a pane of glass over a field the app paints. The field is warm behind a session that needs the person, cool
and slowly travelling behind one that is running, and plain ground behind one that rests. In exchange the status
sentence leaves the row: a row is a title and a small mark, and the sentence comes back on hover or focus.

## 0. Stance

A quiet warm-neutral workspace with monochrome marks, interrupted by one field of light whose colour is information.
If a decision is ever ambiguous, choose the option that removes a word and keeps a shape.

| axis | position | why |
|---|---|---|
| density | standard | Supervising many sessions wants many rows, but a row must be tall enough (38 px) to hold a pool of light and to reveal a second line without moving its neighbours. The app today is 30. |
| criticality | transactional, one consequential action | Approving a push is not reversible. So state is never hue alone, the approval is an opaque card, and nothing overshoots when it opens or confirms. |
| energy | composed | Roundness and one saturated hue are the two loud channels; type and motion stay quiet. Overshoot: only the settings controls (switch and segmented thumbs, a chip's check). |
| type | one round-terminal sans, plus the system mono | The beads are circles; a face with round bowls and a wide weight axis lets weight become a state channel (500 resting, 620 lit). |
| material | glass over planes, one glass surface; tonal everywhere else | The sidebar is the only thing that sits over something that changes. The work area is an opaque sheet with one raised step. |
| colour commitment | restrained on the sheet, committed inside the pane | Under 3 % of the work area is chromatic, so colour in the sidebar has nothing to compete with. |
| accent job | status only | Orange means "this needs you" and nothing else. The one orange control is Approve, which is the same sentence. Every other primary action is ink. |
| ground lightness | both, light first | The app's rule. Dark is a second design: pools glow on it, where on light they stain. |
| ground temperature | warm neutral | The owner's `#faf9f5` sits in the cream band on purpose; the Ground knob offers `#ffffff` beside it. |

Rejected vector: directional orange (send button, selected tab, switches) on an elevated, shadowed sheet. It lost
because orange that also means "press here" appears where nothing needs the person, and then the field means nothing.

Rejected values: **green** for running (it reads as "done" and collides with the diff's added lines) and **violet**
(cool enough, but with orange it becomes the generic assistant gradient). Blue was kept because orange against blue is
the pair that survives red-green colour blindness. **A grey sidebar ground** a step darker than the sheet, as native
sidebars have, lost because any tone in the ground dulls the pools; the pane is separated by its rim and shadow instead.

Sampler draw: deco, kinetic, editorial; Didone, geometric sans; textured paper. Taken: the geometric sans, and from
kinetic the one idea that motion is information (the field is the only thing that moves). Declined: deco's stepped
metal and the Didone (nothing here is display type), and paper grain, although grain under the glass would have given
the lens something to bend (see the record, "plane").

**Signature:** the field. Clone test: another supervision tool could share every axis line above; it would not arrive
at pools keyed to row boxes, painted hotter than they are seen and held back at the pane's edge.

## 1. Colour

One file holds the values: the token block at the top of `signal.css`, and the field palette in `Signal.tsx`.

| role | light | dark | job |
|---|---|---|---|
| `--ground` (knob) | `#faf9f5` · `#ffffff` | `#191919` · `#000000` · `#191c19` · `#1f1f1f` | sheet, and the field's base |
| `--raised` | `#ffffff` | ground + 7 % white | composer, cards, popovers, the selected tab |
| `--ink` / `-2` / `-3` | `#1d1b18` / 68 % / 50 % | `#efece7` / 70 % / 50 % | text (`-2` is 5.8:1 on the light ground); `-3` is 3.3:1 there, so marks only, never text |
| `--line` / `--line-2` | ink 9 % / 16 % | white 9 % / 17 % | rings (as 1 px shadows), never solid greys |
| `--fill-1` / `--fill-2` | ink 4.5 % / 8 % | white 5.5 % / 10 % | hover, wells, the user bubble |
| `--signal` / `--on-signal` | `#fd780f` / `#1d1b18` | same | needs-you beads off the pane; the Approve button. White on this orange is 2.7:1, so its label is ink (6.4:1). |
| `--live` / `--live-ink` | `#2aa8de` / `#0b6f9a` | `#46c6ee` / `#58cdf2` | running marks off the pane; the running command's tint |
| `--pane-ink` / `-2` / `-lit` | ink / 68 % / `#14120f` | ink / 80 % / `#ffffff` | text on the pane; `-lit` is every mark of a row that has a pool under it |
| `--add` / `--del` | `#1f7a45` / `#b23a33` | `#5fc98a` / `#f0857c` | diff counts only |

Field palette (canvas, sRGB, peak alpha before the strength knob; an alpha above 1 clips into a plateau, so a stronger
pool grows wider instead of whiter):

| | need | core (under the bead) | live | ember (unread) | spill outside the pane |
|---|---|---|---|---|---|
| light | 255 146 0 × 1.35 | 252 118 0 × 1.2 | 20 150 232 × 1.3 | need × 0.8 | 0.24 |
| dark | 253 120 15 × 1.0 | 255 150 44 × 0.9 | 48 136 255 × 1.25 | need × 0.6 | 0.45 |

The pools are painted hotter than they are meant to be seen, because the glass thins what is under it; where a pool
passes the pane's edge it is held back to `spill`, so the strip of sheet beside the sidebar gets a faint halo and not
a stripe. On `#000000` the pane's footprint gets a base of 3.5 % white: the glass restores a backdrop's chromaticity
whatever its level, so over pure black the faintest tail of a pool comes back as a brown wash with a hard edge.
Field strength knob: × 0.45, 1, 1.38. With no glass (Lens knob) the field is painted at × 0.5 light, × 0.25 dark.

Rules. The field or the bead carries the colour, never both: on the pane beads are ink and the light is under them;
off the pane (tabs, side column, transcript) there is no field, so the bead takes the hue. Orange and blue appear
nowhere as decoration. State is always said three ways: the pool, the bead's shape, and the title's weight.

## 2. Type

Figtree variable (latin subset, bundled), then `system-ui`, then Apple SD Gothic Neo for Korean; `ui-monospace` for
paths, commands and code. Rejected: `ui-rounded` (reads as a toy at 13 px), the system face (what the app has; no
roundness to meet the beads), Nunito (its fully round terminals smear at 11.5 px).

| role | size / line | weight |
|---|---|---|
| interface, row titles | 13.5 / 18 | 500; 620 when the row is lit |
| hover sentence, ages | 11.5 / 14 | 500 |
| project names, side headings | 12 | 600 |
| prose | 15 / 1.62 | 420 |
| user message | 15 / 1.5 | 450 |
| settings label / section / page | 14 / 15 / 20 | 500 / 650 / 650 |
| mono | 12.5 | 400, 600 for the running command |

No uppercase labels, no tracking tricks. Titles end in a mask fade, not an ellipsis.

## 3. Material: the glass record

```
register: instrument. The pane is navigation, the surface Apple itself names for this material.
plane: a canvas 348 px wide on the window's left edge, painted by the app: the ground colour and one pool per lit
  row, positioned from the row's own box every frame that anything changes. Texture path, so the glass samples the
  pixels the page shows. It has the broad frequency (pools) and NO fine one: every mark in the field has to mean
  something, so there is no grain or grid for the lens to displace. Phase where it goes flat: no session lit.
inventory: one surface, the sidebar pane (base plane). Everything else is opaque and tonal: the sheet, and one raised
  step for the composer, cards, the selected tab, menus and the approval card. Popovers are opaque because they open
  over the flat sheet, where glass would have nothing behind it.
groups: signal-pane, one member, texture signal-field, no declared hint (the pane covers the strip, so the
  runtime's reading of the whole source is the level under the glass).
family: thickness 8. One span: 264 wide, radius 18 fixed (52 wide as the rail). Anchor: the window corner, 26;
  pane 8 inside it = 18; rows 6 inside the pane = 12.
tint: none.
scheme and pose: the lab's scheme; windowActivation auto.
motion: nothing morphs or materialises. The pane's width follows the collapse (460 ms). The field eases (below).
tier: WebGPU texture path, refraction "true". The CSS tier draws the same page; the pools show through its blur.
accessibility: follows the system. With transparency reduced the body frosts and stops carrying hue, so the pools
  fade and the beads and weights carry the state alone. Reduce Motion stops the running pool where it is.
ink: the app's own, on children, not the library's published ink: the field under the pane is ours, so each line
  is held to a measured ratio over it.
tuning: two leaves of the macOS 27 document are changed, in Signal.tsx. The body's own tint drops to the system's
  "clearer glass" value (0.30 light, 0.70 dark; shipped 0.46 and 0.90). The share of the backdrop's chroma the body
  keeps rises to 0.83 light and 0.95 dark, inside the band measured on Apple's material, which the library ships
  lower and lists as an open gap. Without both, a pane this wide turns the field into a faint wash.
native comparison: none made. Nearest Apple surface: a macOS 26 sidebar over a window's content.
```

Laws of the glass guideline this breaks, and what each costs:

1. *A composition must never depend on the hue seen through glass.* This one does, by assignment. Cost: the hue is
   the first thing the material gives up (CSS tier, Reduce Transparency, the unfocused window), so the bead and the
   weight are not a courtesy here; they are the fallback the design stands on.
2. *No glass over a flat field; the lens needs fine structure.* The field is soft pools on a flat ground. The lens
   has nothing to bend, so the glass contributes haze, rim and shadow, and no refraction anyone will see.
3. *One size family straddling 32 to 96.* There is one surface, far above 96.
4. *No idle motion.* The running pool travels along its row, once every 7.6 s. It is the only thing that moves at
   rest, it exists only while a turn is in flight, and it is how running differs from needing without relying on hue.

Contrast, measured on rendered pixels. Every text line and bead on the pane (44 at rest, 48 with a project folded)
was read with its computed ink against every pixel under its own box, captured with the text hidden at four phases of
the travelling pool, with the sentences printed. The number is the worst pixel of the worst line. Floors: 4.5 for
text, 3 for beads and icons. No line is under its floor in any row of this table.

| case | light | dark |
|---|---|---|
| Full strength, default ground | 5.54 | 6.17 |
| Vivid, every row carrying its hover fill | 5.45 | 4.83 |
| Vivid, window unfocused (receded pose) | 4.94 | 6.95 |
| Vivid, atlas-api folded (light gathered in the project row) | 5.47 | 4.60 |
| Vivid + hover fill on `#ffffff` / `#000000` | 5.43 | 5.01 |
| Vivid + hover fill on `#1f1f1f` / `#191c19` | n/a | 4.68 / 4.76 |
| Vivid + hover fill, CSS tier | 5.42 | 4.84 |
| Vivid + hover fill, transparency reduced | 5.74 | 5.28 |
| Vivid + hover fill, Lens knob at "No glass" | 5.26 | 5.75 |

Two things bought these numbers. A row with a pool under it draws every mark in the pole of the ink (`--pane-ink-lit`),
and the dark pane's secondary ink is 80 % where the sheet's is 70 %. With no glass the dark field is painted at a
quarter of its strength, because white text on a stronger orange falls under 4.5. Not measured: Increase Contrast,
forced colours, the 38 px hover layout (the printed layout stands in for it), and the knockout inside a bead.
Dev-mode diagnostics: none on the WebGPU tier, the CSS tier or with the glass removed.

## 4. Layout

Posture: workspace. Activity: monitor (which session needs me), then read and operate (the transcript). Unit: the
session, in a hierarchy of projects. Co-visibility: peer panes (list and session), plus a supporting column for what
is held while reading (files, agents, plan). Temporal: live. Volume: many like rows; a few unlike blocks beside.

Consequences. The transcript dominates: a 720 px column against a 264 px pane (2.7:1) and a 292 px column (2.5:1).
Rows never move when their state changes: a live list keeps position, so the exception is lit in place instead of
sorted to the top. A folded project gathers its sessions' light and marks into its own row, so folding loses nothing.
The collapsed sidebar is a 52 px rail of beads and light; a row's words come out beside it on hover.

Rejected: a "needs you" tray pinned above the projects (rows would jump on every state change, and each would exist
twice); the field behind the whole window (colour would stop pointing at a row).

Sizes: traffic lights at 16, 15; pane inset 8; rows 38 (46 with printed sentences), destinations 32, project heads
28; tabs 30 in a 44 band; composer up to 728 wide, 16 from the bottom. Radii: pane 18, rows 12, tabs and wells 10,
cards 14 to 16, bubbles 20, composer 24; buttons, pills, switches, segments and chips are capsules. Fixed radii use
continuous corners (`corner-shape: squircle`).

## 5. Parts

- **Bead** (`glyphs.tsx`), 18 px box. Needs you: a solid disc with the kind knocked out (pause for an approval, a
  question mark, three lines for a plan). Running: a play mark, the pair of the pause. Unread: a dot. Resting: nothing.
- **Row**: bead slot, title, and a second line (sentence, machine, age) that slides in on hover, focus, or while its
  card is open. The row's height never changes.
- **Pool** (`field.ts`): an ellipse with a bell falloff, so it has no edge to read as a highlighted row.
- **Pop**: the one popover. Opaque, raised, scales from 0.94 at the point it came from.
- **Usage**: two nested rings (week outside, five hours inside); the numbers on hover.
- Switch, segmented control, toggle chip (for the plugin and notification lists), pill, quiet button.

## 6. Words

At rest the sidebar says four destinations, project names and session titles. On hover or focus: the status sentence,
the machine, the age, a destination's shortcut, the usage numbers. In the transcript a tool run is one sentence and
its seconds appear on hover; in the composer only the model is named, with effort and mode inside its menu and the
context window as a ring. On the settings page a row is a label and a control: the explanation appears in the right
margin beside the row the pointer or focus is on, and a badge that repeats the path it sits next to is dropped.
The Sentences knob prints every status sentence, for the comparison.

## 7. Motion

One curve, `cubic-bezier(0.32, 0.72, 0, 1)`. Hover and press 160 ms (press is a 1.5 to 8 % scale, never a colour
swap). Reveal of a second line 240 ms after a 70 ms delay. Folds 420 ms; the shell (collapse, side column) 460 ms.
Popovers 280 ms. Thumbs overshoot: switch 340 ms, segmented 380 ms. The field warms and cools exponentially with a
340 ms time constant, about a second to settle: a filament, not a switch. Under Reduce Motion every transition is
immediate and the running pool stands still.

## 8. Don'ts

No orange or blue that is not a session's state. No second glass surface. No border or fill on the pane. No row that
changes height or position on hover or on a state change. No status said by colour alone. No uppercase micro-labels.
No motion at rest other than the running pool.

## 9. What was found

- The coarse split (needs me, running, nothing) reads from the light alone, down to a thumbnail of the sidebar. The
  fine split (approval, question, plan) does not: that is the bead's job, and no amount of colour will take it over.
- Unread is the weakest signal: a small ember and a dot. It is deliberately below "needs you", and may be too far below.
- On a light ground "bright" is not available; the pools are warm stains. On dark they glow, and the idea is stronger.
- Glass is not what makes this work. A sidebar-sized pane is the most opaque body the material draws: untuned, it
  passed so little of the field that the idea disappeared, and tuned it still needs pools painted past full strength
  and held back at the pane's edge. What the glass adds is diffusion, which makes the pools read as light rather than
  as highlighted rows, and an edge that makes the sidebar an object. The Lens knob shows the same field with no glass;
  the information is all still there.

## To ship this in the app

- **No main-process change.** The field is the app's own, so the window stays opaque; this is not vibrancy.
- **A plane and a glass root in the renderer.** A canvas behind the sidebar region and one glass surface around the
  sidebar, in place of the flat ground and hairline the sidebar paints today. New dependency: the glass library;
  WebGPU where the adapter allows, its CSS tier otherwise. The painter reads row boxes, so a virtualised list works
  as it is: only mounted rows have lamps; it repaints on scroll, fold, resize and state change.
- **Rows.** The session row loses its status line at rest and gains a lamp attribute derived from the state it
  already has; the sentence moves into a hover and focus reveal. Project rows gather their sessions' lamps when folded.
- **Tokens.** New roles (pane inks, signal, live, the field palette, which the painter must read from tokens because
  the colour guard forbids literals elsewhere). The radius scale is replaced; today one 6 px token does every job, so
  rows, tabs, wells and cards need their own roles before any of them can round. Motion tokens do not exist yet.
  The terracotta accent becomes `#fd780f` and narrows to status only; primary buttons become ink.
- **Corners.** `-electron-corner-smoothing: system-ui` where the lab writes `corner-shape: squircle`.
- **Type.** Figtree's latin file bundled with the app (remote fonts are blocked); Korean stays on the system face.
- **Primitives.** One popover and menu component carrying the entrance motion; today each call site styles its own
  and none of them moves. Square, hairline-parted tabs become separate rounded tabs.
- **Settings.** Help in the margin needs about 260 px beside the column; narrower than that it has to fall back to a
  disclosure under the row.
- **Preferences.** Pass the app's own Reduce Transparency setting to the glass root as a boolean.
- **Not measured.** The cost of re-uploading the field texture on every frame while a session runs. If it shows,
  drop the travel to 30 frames a second or pause it while the window is unfocused.
