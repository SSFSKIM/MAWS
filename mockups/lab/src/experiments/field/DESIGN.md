# Field

Design record for the lab experiment `field` (order 10). Values live in `field.css` and `paint.ts`; this file says
what each is for and why.

## 0. Stance

**One pane of real glass over a warm field the app paints for itself; everything that is read sits on an opaque
sheet set into the window.** The field is ambience and means nothing: no state, no project, no time of day. The
question the experiment answers is whether glass over an app-owned colour field feels warm and premium or merely
decorative.

Commitment: a quiet tonal sheet in one warm ink, interrupted by a single pane of glass that lets a dusk through.
If a decision is ever ambiguous, choose the option that leaves the sheet quieter and gives the colour to the field.

Axis position:

- Density: standard. Many sessions are supervised, but the owner asked for fewer things on screen; 32 px rows and
  controls, 15/24 prose.
- Criticality: transactional with one consequential act (approving a push). So the approval is never hue alone: a
  haloed dot, a bolder title and a line of words, and its action is a labelled button.
- Energy: composed. Rounded and soft, nothing bounces.
- Type: neutral sans, humanist tradition. Criteria: open apertures and round bowls so 13 px secondary lines stay
  warm rather than technical; x-height near half the em; a variable weight axis with usable steps between 450 and
  600; tabular figures; a mono that is its sibling in roundness. Chosen at build time: Figtree, with Geist Mono for
  code and paths. Korean falls through to the system face.
- Material: glass over a plane, for one surface and its platters; the sheet is tonal (wells are the ink at 3.5 % and
  7 % of the ground, never a border).
- Colour commitment: restrained on the sheet (accent under 1 % of it), committed in the field. The field is the
  only chromatic surface.
- Accent job: status-only. The theme orange marks "needs you" and fills the one Approve button. Selection, primary
  action and switches are ink. Weighed and rejected for the accent job: orange as the primary-action fill
  everywhere; over an orange field it would stop meaning anything.
- Ground lightness: both schemes designed; light is the default scene (a desk in daylight, the app open all day).
- Ground temperature: warm. The sheet stays the owner's candidates (`#FFFFFF` default, `#faf9f5`); the warmth lives
  in the field and the ink (`rgb(31 27 22)`), not in a cream page. Rejected ground: a tinted cream sheet, which
  would compete with the field and make the pane read as more of the same.

Rejected vector: quiet / neutral grotesque / elevated / restrained / directional orange / light / neutral: the
category's modal answer, and the lab's `quiet` experiment already tests it.

Sampler draw: topographic, kinetic, archival; Didone, neo-grotesque; heavily coloured canvas. The assignment fixes
the aesthetic, so the draw could change one or two decisions only. Taken: topographic, as the field's fine
structure (contour lines that are the level sets of its own colour masses, so they are not a pattern laid on top).
Taken: heavily coloured, as the far end of the strength knob. Declined: both type traditions (the assignment asks
for a humanist sans), kinetic and archival.

Signature: the pane. One tall sheet of glass with a 20 px continuous corner, the traffic lights on it, the dusk
running down it from amber through the theme orange and coral to plum.

Clone test: another session manager would share density and criticality. It would not share a painted field whose
contours come from its own masses, an accent withheld from every action but one, or the pane-and-sheet pair.

## 1. Palette and usage

| role | light | dark | job |
|---|---|---|---|
| `--xf-sheet` | `#ffffff` / `#faf9f5` (knob) | `#191919` / `#191c19` / `#1f1f1f` / `#000000` (knob) | the reading ground |
| `--xf-ink` | `rgb(31 27 22)` | `rgb(241 237 232)` | text |
| `--xf-ink-2` / `-3` / `-4` | 72 % / 66 % / 36 % of ink | 74 % / 58 % / 36 % | secondary text / quiet text / decoration only |
| `--xf-well`, `--xf-well-2` | ink 3.5 % / 7 % into the sheet | white 4.5 % / 9 % | tonal steps: code, side column, bubbles, selected tab |
| `--xf-raised` | `#ffffff` | white 9 % into the sheet | the composer, buttons, the segmented pill |
| `--xf-accent` | `#fd780f` | `#fd780f` | the Approve fill |
| `--xf-accent-mark` | `#dc5408` | `#fd780f` | the needs-you dot and the focus ring |
| `--xf-add`, `--xf-del` | `#1c7c4f`, `#b6402f` | `#74d3a3`, `#f08d7f` | diff counts only |

Rules. The accent appears only on a needs-you mark, the Approve button and the focus ring. `#fd780f` measures
2.7:1 on white, so the small mark and the ring use the same hue deepened to `#dc5408` (3.4 to 4.0:1 on the light
sheet, wells and pane); dark keeps the pure value (6.2:1 and up). This bends the owner's orange for contrast, in
light only. Text on the accent is `#2b1400` (6.5:1), never white (2.7:1). Borders are the ink at 8 % or 14 %; no
solid greys. No colour literal outside `field.css`'s token block except the traffic lights, the switch thumb, the text
selection tint and shadows.

## 2. Type

One family and its mono. 14/20 at weight 450 for interface text; 15/24 for transcript prose; 12.5/18 for second
lines, group headings (600) and metadata; 20/28 at 600 for settings section titles; 28/34 at 560 for the new-chat
line. Emphasis is weight (540 to 600), never colour. Mono (12.5) is for paths, commands, code and diffs only.
Figures are tabular. No uppercase, no letter-spaced labels.

## 3. Material

The glass record.

```
register: instrument by job (the pane is navigation), composed as one window in an environment.
plane: `xf-plane`, a canvas the app paints once per size, scheme and strength; fixed to the window. Broad
  frequency: seven radial colour masses. Fine frequency: 1 px contour lines, the level sets of those masses,
  painted into the same canvas. It never changes while in use.
inventory: (1) the sidebar pane, base plane, navigation; (2) a row's ⋯ menu, overlay, transient platter;
  (3) the approval popover, overlay, transient platter. Nothing else. Opaque and tonal: the sheet (tabs,
  transcript, composer, side column, settings), which is content and keeps its own fill and shadow.
groups: `xf-pane` (the pane), plus one group per open platter, all on the texture `xf-plane`. No hint is
  declared: the runtime reads the texture.
family: thickness 8 everywhere. Pane 272 wide, radius 20 fixed; platters radius 16 and 18; rows on the pane
  radius 12 (20 minus the 8 px inset); controls are capsules. Anchor: the window corner, at an 8 px margin.
tint: none. The glass takes its colour from the field.
scheme and pose: the root's scheme follows the lab's scheme; window activation is left on auto.
motion: platters materialise beside their trigger (the trigger stands on glass, so it is a fill and the library
  chooses "attached"); the pane travels with the layout on `left`, and the runtime re-reads its box each frame
  until the transition ends. Nothing moves at idle except the turning arc of a running mark, which is state.
tier: WebGPU with true refraction in the lab's captures (zero dev-mode diagnostics). On the CSS tier the pane is
  the same frost with no bend.
accessibility: the runtime follows the system. Under forced colours the glass is removed and selection, switches
  and the sheet take system-colour outlines; state marks keep their own colour.
```

Laws of the glass guideline this idea bends, and the cost:

- "No glass over a field that has no job." The plane is ambience the page chose, and it does not change under the
  pane, so the transparency preserves no context. This is the experiment's assigned question, kept on purpose.
  Cost: the glass has to earn its place by feel alone.
- "Content reaches the window's edges and controls float over it." Here the sheet sits beside the pane, inset by
  8 px. The pane therefore never covers reading content, and never reveals any.
- "A surface carries one short line." The pane carries a list of about twenty short lines. They are navigation
  labels, set in the runtime's primary ink on child elements, and measured (below).
- The pane's second ink level is authored, not the runtime's: the published secondary measured 4.35 to 4.45:1 on
  the light pane, under the floor for 12.5 px text. It is the primary at 78 % (same pole, so it follows the
  material).

Contrast on the pane, measured on rendered pixels (WebGPU, active pose, 1440×900, each element's own box):

| line | light, Whisper → Vivid | dark, Whisper → Vivid |
|---|---|---|
| row title | 14.0 → 12.9 | 8.8 → 8.0 |
| row title on the current row's fill | 14.7 → 14.4 | 5.8 → 5.7 |
| second line, group heading (12.5 px) | 7.0 → 6.7 | 6.0 → 5.8 |
| icons, usage disc | 14.1 → 12.9 | 8.8 → 7.9 |
| needs-you mark (3:1 floor) | 3.6 → 3.2 | 4.7 → 4.6 |

The dark pane's drawn body sits at encoded 0.20 to 0.30 and the current row's fill at up to 0.38, just under the
band where neither ink carries text; the dark field's masses are kept deep for that reason and must stay so. Not
measured: the unfocused pose and Reduce Transparency (captured, looked the same, and the captures could not
confirm either state had taken effect), and text on the platters.

Sheet and pane share one corner. The pane's is the runtime's continuous curve at 20 px; the sheet's is
`corner-shape: squircle` at 26 px, which draws the same visible curve. Wells and cards are 16, rows and the side
column 12, the composer 24, every single-row control a capsule.

The sheet is stacked above the glass planes (`z-index` 1001 against the runtime's 1000), so the pane's shadow
falls on the field and never on the page.

## 4. Layout

- Posture: workspace. Activity: operate one session while monitoring the others. Unit and relation: sessions in a
  hierarchy (project, session); transcript items in a sequence. Co-visibility: peer panes (list, transcript, a
  supporting column). Temporal: live. Volume: few projects, many homogeneous rows; the transcript is unbounded.
- Consequences: the transcript dominates (about 58 % of the window at 1440); the pane is 272, the side column 296,
  the measure 768. Density lives in the pane's list and the diff. Chrome is conventional: traffic lights top left
  on the pane, tabs along the sheet's top, the composer docked at the bottom of the thread.
- Rest state. A sidebar row shows a mark and a title. A second line appears only on rows that need the person.
  Age and ⋯ arrive on hover at the trailing edge, and the title fades under them instead of moving. Project
  chevrons show on hover or when closed. Usage is one filled disc; its two figures and the reset time slide out
  on hover. Tool runs and thoughts are one grey line; elapsed time shows on hover or when open. Context is a disc;
  its figure appears on hover. Model, effort and mode are one control that opens a menu. Settings show a label and
  a control; the explanation unfolds when the label is clicked.
- Cut entirely: branch and machine in rows (moved into the ⋯ platter), "now" as an age, the folder and branch
  chips of the composer (the side column and the tab already say them).
- Narrow windows: under 1100 px the side column leaves; under 860 px the pane leaves and the sheet takes the window.
- Rejected: glass tabs or a glass composer (reading and typing would sit on glass); a wider field frame (it turns
  the app into a card on a wallpaper); the field showing through the side column.

## 5. Components

One state mark for sessions, tabs, agents and todos: a turning arc (running), a haloed orange dot (needs you), a
small dot (unread), a filled check (done), nothing (idle). One row, one capsule tab, one fold (grid rows 0fr to
1fr), one chip for every on/off list, one switch (40×24, ink when on), one segmented control with a sliding pill,
one share disc for usage and context. Icons are lucide at 16 px, stroke 1.75.

## 6. Voice

Sentence case, no terminal punctuation on labels, no status words where a mark says it. The only words added to
the fixtures are control names (Approve, Deny, Pin, Rename, Mark as unread, Archive, Queued) and the new-chat line.

## 7. Motion

One curve, `cubic-bezier(0.32, 0.72, 0, 1)`, three speeds: 120 ms for hover, press and reveals; 240 ms for
chevrons, switches and popovers; 460 ms for the pane, the sheet and the side column. Folds take 320 ms. Press is a
2 to 8 % scale-down; a switch's thumb widens while pressed. The sheet's own menu grows from its trigger (scale
0.94, 6 px rise). No overshoot anywhere. Under Reduce Motion every transition is immediate and the running arc
stops.

## 8. Don'ts

- No glass anywhere on the sheet. No text for reading on glass; the pane holds labels only.
- No meaning in the field: it does not change with state, project or time.
- No orange on anything but a needs-you mark, the Approve button and the focus ring.
- No border where a tonal step will do; no elevation shadow except on the sheet, the composer and the sheet's menu
  (thumbs, pills and buttons keep a 1 to 3 px contact shadow).
- No background, border, shadow or opacity on a glass host; fills go on its children.
- No square corner, no uppercase label, no second accent.

## What was found

At rest the lens contributes little. Regular glass blurs a soft field into a soft gradient, so a still of the
WebGPU pane and a still of the CSS-tier pane are hard to tell apart; the bend shows only at the rim and while the
pane travels. What reads as warm and premium is the colour coming through, the shared corner of pane and sheet,
and the type. So the idea survives a cheap implementation, and the real glass is a refinement on top of it rather
than its carrier. At Whisper the field is too faint to matter and the pane is a plain frosted panel; at Vivid the
light scheme turns sweet. Warm is the default because it is the lowest strength at which the dusk is legible as a
dusk.

## To ship this in the app

- Ground roles. Today the sidebar, toolbar and window paint one flat ground. This needs separate roles: the field
  (a canvas behind everything), the sheet, wells, raised. The window, toolbar and sidebar regions become
  transparent over the canvas; the sheet becomes a rounded, inset container holding tabs, panes and the side column.
- The glass. One vitrea root in the renderer with a WebGPU request, the field canvas as its texture, the sidebar
  as its one surface, row menus and the approval as its platters. Electron 44's Chromium has WebGPU; the CSS tier
  is the fallback and looks nearly the same at rest. The sidebar's width lives in TypeScript today, so its resize
  and collapse must tell the runtime to re-read the pane's box.
- Anything composited natively above the page (an embedded browser view) cannot sit under the pane or a platter;
  keep such views inside the sheet's bounds.
- Geometry. The single 6 px radius used almost everywhere becomes a ladder: capsule for single-row controls, 12 for
  rows, 16 for wells and cards, 24 for the composer, 20/26 continuous for pane and sheet. Tabs become capsules
  with no dividing hairlines. Rows and controls go from 30 to 32 px, the toolbar from 44 to 48.
  `-electron-corner-smoothing: system-ui` replaces `corner-shape: squircle`.
- Colour. Terracotta is replaced by `#fd780f` with the job narrowed to status; primary actions and selection move
  to ink. Add the light-only mark value `#dc5408`.
- Type. Bundle Figtree and Geist Mono (latin, variable) with the app; interface text goes from 13 to 14 px and
  prose from 14/1.625 to 15/24.
- Motion. Add duration and easing tokens (120 / 240 / 460 ms, one curve) and entry motion for menus, popovers and
  dialogs, which have none today.
- Words. The settings page prints its explanations at rest; they move behind the label. Sidebar rows drop their
  status words, ages and branch names at rest.
- The traffic lights sit at 24 px from the window's corner here (16 px inset inside the pane's 8 px margin).
