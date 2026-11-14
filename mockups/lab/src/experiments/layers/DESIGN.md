# Layers

Design record for the round 2 synthesis `layers` (order 3). The contract is `mockups/lab/BRIEF.md` and
`mockups/lab/ROUND2.md`. Values live in `layers.css` (tokens at the top) and `paint.ts` (the field); this file says
what each part was lifted from, what happened where two parts met, what the idea breaks and what that costs.

## 0. Thesis

The owner's suggestion taken all the way: "use tool use parts, tool use blocks and more, to liquid glass too." One
colour field runs under the whole window. Prose is read directly on it. Every block of the transcript (an opened
tool run, a diff, a running command, the person's own message) is a piece of glass standing over the field, and so
is every control around it: the pane, the tab capsule, the composer, the waiting capsule, and four separate modules
in place of a side column.

It is not a sheet set into a field (that is `sheet`), not one ground with light gathered under the controls (that is
`open`), and not a card layout painted to look translucent: the blocks are drawn by the glass runtime, with a lens,
over a plane that stays still while they move.

If a decision is ever ambiguous, choose the option that keeps the words readable over the one that shows more glass.

## 1. Stance

This round the owner's choices are the brief, so no sampler was run and no new stance derived. The nine lines are
read off the chosen parts.

| line | position | from |
|---|---|---|
| Density | standard: 34 px rows, 680 px measure, 15/24 prose | Quiet |
| Criticality | consequential: an approval pushes code, so it states its command and is never colour alone | Quiet |
| Energy | composed; nothing moves at rest except a running mark | Field, Quiet |
| Type | one humanist sans and its mono; no serif anywhere (the owner's ruling) | Field's face, Quiet's sizes |
| Material | glass over one painted plane, in the spatial register, extended to content | the assignment |
| Colour commitment | the field is the only chromatic surface; ink is one warm neutral | Field |
| Accent job | "it is your move", and nothing else | Quiet |
| Ground lightness | both schemes designed and measured to the same standard | the owner uses both |
| Ground temperature | warm; the owner's ground candidates are the paper the field is painted on | Field |

Signature: a block of the transcript crossing the field. The field does not move; the block's rim bends its contour
lines as it passes, and the block thins to nothing before it can reach the tabs or the composer.

## 2. Parts: where each came from, and what changed

Code was lifted from the source experiment's folder and adapted, not redrawn.

| part | lifted from | changed, and why |
|---|---|---|
| The field | Field `paint.ts` | The base is the ground candidate (there is no sheet to carry it). A second set of four masses reaches across the main space at about a third of the edge level, because here prose is read on the field. Contour levels are a little denser (0.05) so a block always has a line to cross. |
| Pane: size, material, corner, position | Field: 272 wide, radius 20, 8 px from the window, the lights on it, the same glass surface on the same texture | Its exterior shadow is CSS (section 4). It slides away on Field's curve. |
| Pane content | Quiet `Sidebar.tsx`: a row is a title and one trailing slot; state is a glyph; the glyph steps aside for the row's actions; the second line, branch, machine and age wait in a card that follows the pointer; usage is two nested rings; the pane becomes the settings index | Fills are the glass pair (section 6). Ink is the runtime's primary with two authored levels under it. Row radius is 12 (20 minus the 8 px inset) instead of 11. |
| Tabs | Instrument: one glass capsule, 36 tall, fills of radius 15 inside it, the plus inside it | The marks inside are Quiet's glyphs, so pane, tabs and waiting capsule speak one vocabulary, and Quiet's exchange (the mark steps aside for the close button) replaces a separate close button. It samples the field, not the page: nothing passes under it here (section 5). It stands over the reading column's left edge. |
| Composer | Windows for the material (glass, outside the reading surface, over colour); Quiet for the content (the queued message as a chip inside, one model chip, a context ring, one round button that is stop, then send) | Radius 26, as wide as the reading column. |
| Tool-run summary and its opened card | Quiet: a grey caption whose chevron and duration appear under the pointer; it opens in place into a list of verb, target, result | The card is glass. Quiet's ring is gone, since the glass has its own edge. |
| Diff, running command, the person's message | Quiet's layouts | Each stands on glass. Quiet's ring and well are gone. |
| Assistant prose | Quiet's sans variant, 15/24 | Set directly on the field, never on glass. |
| Waiting approval | Quiet (the owner's answer, received while building): a capsule of glyphs at the top right, one per waiting session, and a card with the command and Approve that opens from the waiting row | The capsule is the page's one tinted piece of glass, with authored dark ink on the tint. It stands above the side column. |
| Side column | Windows for the idea (round glass, floating); the owner's note: plain content, "separate Liquid Glass component floating feeling" | Four modules, one per section (changes, agents, to do, background), 12 px apart, each its own surface with its own shadow. Content is Quiet's lists, unchanged. |
| New chat | Quiet's layout (one line, the composer, two chips under it) | The line is the sans at 27/34, weight 560. The composer is glass. |
| Settings: geometry | Quiet: one 620 px column, 54 px rows parted by hairlines, 20/28 titles, the right margin kept for a row's sentence, a long path replaced by its version | Read directly on the field. |
| Settings: controls and motion | Instrument: lists stay visible as pills, a switch and a segmented thumb on a light spring, a select whose list is a glass platter, Settings as a tab in the capsule | The help sentence appears beside its row on hover or focus (both experiments agreed on that). |

## 3. Where parts met

1. **Field's sheet against glass blocks.** Field read everything on an opaque sheet; the assignment removes it. The
   field gave way: it is regraded so that the main space sits at about a third of the level under the pane. Prose
   holds 10:1 or better on it at every strength and ground (section 7).
2. **Quiet's ringed cards against glass.** A ring on glass is an authored border beside the material's own edge.
   The ring gave way.
3. **Instrument's "content slides under the composer" against "blocks are glass".** A glass block under a glass bar
   is glass on glass. Instrument's signature gave way: content thins out before it reaches a bar (section 5).
4. **Quiet's lighter hover fill against light glass.** Glass this size is nearly white in the light scheme
   (0.95 and up), so a lighter fill is light on light. Hover became the ink at 5 %; what is current stays Field's
   white chip with a contact shadow. Dark takes the lighter pair for both.
5. **The runtime's shadow against thirteen surfaces close together.** The runtime clips each surface's exterior
   shadow to its sampling padding. Under a 680 px card or four modules 12 px apart the shadow is wider than the
   padding and ended in a visible seam beside every surface. The runtime's shadow gave way on both roots
   (`materialProfile`, the six occlusion anchors at zero); shadows are drawn in CSS, on the block for content and on
   a pseudo-element behind a host's content for controls, and are removed in the receded pose.
6. **The library's host model against a transcript in flow.** A glass host is portalled into its root's plane and
   cannot follow a flow. So a block stays an ordinary element in the transcript, and `glass.tsx` draws one
   decorative surface beneath it from its measured box (the same for the modules). The block's words are real
   text in reading order, and the Veil and Opaque materials reuse the same markup. Because the block's own corner
   clips its fills and casts its shadow, these surfaces use the circular corner profile, which CSS matches
   exactly; the pane, the bars and the composer keep the continuous corner.
7. **Quiet's hover card against the library's popover.** Quiet's card re-anchors from row to row in 200 ms; a
   morph does not follow an anchor. The card, the row menu, the usage and model popovers and the waiting list are
   one CSS platter (a backdrop blur and a tint). Round 1 found the two hard to tell apart at this size.
8. **Two state vocabularies.** Instrument's dots and Quiet's glyphs. Quiet's won everywhere.
9. **Instrument's margin help against Quiet's.** The same idea in both; Quiet's geometry, Instrument's timing.

## 4. Material: the record

```
register: spatial, extended to content on the owner's word. Glass holds the transcript's blocks, which the
  guideline's first law forbids ("Don't use Liquid Glass in the content layer"); section 8 lists what breaks.
plane: `xl-plane`, one viewport-fixed canvas painted once per size, scheme, ground and strength, supplied to both
  roots as a texture with `live: false` (read once per painting, never per frame). Broad frequency: eleven radial
  masses, seven at the edges and four across the main space. Fine frequency: 1 px contour lines, the level sets of
  the same masses, painted into the same canvas. Nothing in it moves or means anything.
roots: two. The window root is viewport-attached and holds everything that stays put. The transcript root is
  attached to the scrolling column (`attachment="container"`), so the compositor carries the blocks' glass with
  their content; in a viewport root it trails the scroll by a frame.
groups, all on the texture: xl-pane; xl-lead (overlay plane; the sidebar toggle, present only while the pane is
  away); xl-tabs; xl-composer; xl-side (the waiting capsule, the side toggle and the four modules: neighbours,
  one tint among plain members); xl-blocks (transcript root); one more per open select menu.
family: thickness 8 everywhere. Pane 272 wide, r 20. Modules 296 wide, r 20. Blocks r 18, the message r 22.
  Composer r 26. Bars are capsules at span 36. Anchor: the window corner, at an 8 px margin. Rows inside a pane
  or module are r 12 (20 minus 8); fills inside a capsule are r 15 (18 minus 3).
tint: one seed, #fd780f, on the waiting capsule. Glyphs on it are authored #2a1300; receded, the tint loses its
  chroma and the glyphs return to the runtime's ink.
ink: on a host, the runtime's primary on children, with two authored levels under it (86 % and 76 % light, 92 %
  and 86 % dark). On a block or a module the words are not inside the host, so the page's own ink is used and
  every line is measured (section 7).
room: derived, never typed. `useGlassSamplingGap` answers 62 px for the pane beside a bar; the layout reads it as
  `--xl-room` and keeps the largest value seen. It is spent between the pane and the tab capsule and between
  the tab capsule and the side column. At 1280 wide the composer comes within 32 px of the modules; the runtime
  reported nothing there, and nothing was done about it.
motion: section 9.
scheme and pose: the roots' scheme follows the lab's; window activation is left on auto (`pose=` pins it).
```

What the runtime reported (1440 by 900, `dev=1`):

- Every group on every route, both schemes: renderer `webgpu`, refraction `true`, analysis `exact`, health `ok`.
- One diagnostic, on every session route with glass blocks, by design: `backdrop-root-at-container`. The scroll
  edge is a mask on the scroller, which re-roots the backdrop around the attached root, so its glass cannot
  sample the page behind the column. It samples the field texture instead, so nothing is lost.
- Nothing else at rest, with either pane away, at 1280 by 800, after a round trip of the side column, or with a
  tool run, the row card, the waiting list or a select open. Three findings were met and removed on the way: the
  tab capsule nearer the pane than the room (`group-proxy-overlap`), a module group with its merge distance forced
  to zero (`merge-distance-below-padding`), and dematerialised modules left registered where the composer came to
  stand (`same-plane-overlap`).
- CSS tier (`tier=css`), looked at on purpose in both schemes: the same layout with frost and no lens.
- Receded pose (`pose=inactive`), looked at and measured: bodies grey, the tint drains, CSS shadows go.
- Forced colours: Canvas panels with CanvasText borders, the field hidden, selection as a Highlight outline.

Path each surface took:

| surface | path |
|---|---|
| pane, tab capsule, composer, sidebar toggle, waiting capsule, side toggle | library glass, the host is the element |
| four modules, transcript blocks | library glass, a decorative surface placed under an element in flow |
| settings select list | library glass platter (`GlassMenu`), materialises beside its control |
| row card, row menu, waiting list, usage and model popovers | CSS: `backdrop-filter: blur(30px) saturate(1.7)` under a 74 to 78 % tint, a hairline and a shadow; they grow from their anchor and fade, which glass should not |
| every exterior shadow | CSS (section 3, item 5) |
| blocks under the Veil and Opaque knob positions | CSS: a 50 to 66 % tint with a blur, or the raised colour; no surface is registered and the transcript root is not mounted |

## 5. The scroll rule

- The field is fixed to the window. Blocks and prose travel over it.
- The transcript's scroller carries one mask. From each bar's measured far edge (`useGlassBarInset`) plus 4 px,
  content rises from nothing to full strength across 32 px. So nothing is under the tab capsule or the composer at
  any scroll position: glass never passes under glass, and the bars' own backdrop is always the field.
- The mask thins a block's glass with its words, because the transcript root's planes are inside the scroller.
- At rest (a live session is read from its end) the last block clears the composer by the mask's depth.
- The pane and the modules are outside the reading column, so no block can reach them. Between the column and
  either of them there is at least 32 px at 1280 wide and 88 px at 1440.
- A transient platter (the row card, the waiting list) may cover a block. It is a CSS platter at 74 % or more, so
  it occludes what is under it; it does not show glass through glass.

## 6. Tokens

| role | light | dark |
|---|---|---|
| ground under the field (knob) | `#faf9f5`, `#ffffff` | `#191919`, `#191c19`, `#1f1f1f`, `#000000` |
| ink | `rgb(31 27 22)` | `rgb(241 237 232)` |
| ink 2 / 3 / 4 (marks only) | 80 % / 70 % / 42 % | 80 % / 68 % / 42 % |
| hairline / strong | ink 10 % / 17 % | ink 11 % / 18 % |
| on the field: hover / selected / well | ink 5.5 % / 9 % / 6 % | white 7 % / 11.5 % / 8 % |
| on glass: hover / current / well | ink 5 % / white 80 % with a contact shadow / ink 5.5 % | white 7.5 % / white 15 % / black 20 % |
| accent fill | `#fd780f`, text on it `#2a1300` | same |
| accent mark (glyphs) | `#c84c00` | `#fd780f` |
| solid (send, switch on) | ink | `rgb(241 237 232)` |
| added / removed | `#1a6b40` / `#b03424` | `#74d3a3` / `#f6a092` |

The owner's orange is about 2.6:1 on the light surfaces, so it is a fill there and glyphs take the deeper step;
this bends the brief's value in light only, as every round 1 experiment did.

Type: Figtree and Geist Mono by default (the Typeface knob sets Geist or the system face on the same layout).
Interface 14/20 at 450; tabs, captions and modules 13/18; labels 12/16 at 550; prose 15/24; the message 15/22;
code 12/18 to 20; settings titles 20/28 at 600; the new-chat line 27/34 at 560. Nothing lighter than 450 on glass
in Figtree and Geist; the system face is set at its own steps, 400, 500 and 600.

Radii: 20 pane and modules; 18 blocks; 22 the message; 26 composer; 18 and 22 popovers; 12 rows; capsules for
every single-row control.

Layout: pane 272, side column 296, reading column `min(680px, space - 64px)` centred in what the panes leave, tab
capsule over the column's left edge, composer as wide as the column, 16 px from the bottom. Under 1180 px wide the
side column and its toggle leave.

## 7. Legibility, measured

`measure.mjs` in this folder reads every visible line of text and every icon against the pixels behind it (one
capture with text hidden; the line's tenth-percentile pixel). Floors: 4.5 for text, 3 for large text and icons.
1440 by 900 at 2x, WebGPU. "Worst" is Field strength Vivid on the ground that hurts most (`#ffffff` in light,
`#1f1f1f` in dark). No reading in any run below is under its floor.

Drawn body level (encoded, p10 to p90). The ink dead band is 0.39 to 0.49.

| | light | dark | light, receded | dark, receded |
|---|---|---|---|---|
| transcript blocks | 0.95 to 0.99 | 0.19 to 0.26 | 0.89 to 0.92 | 0.19 to 0.22 |
| modules | 0.96 to 0.99 | 0.19 to 0.26 | 0.91 to 0.92 | 0.17 to 0.24 |
| pane | 0.92 to 0.98 | 0.20 to 0.28 | 0.88 to 0.90 | 0.28 to 0.30 |
| tab capsule | 0.96 to 0.99 | 0.21 to 0.35 | 0.92 to 0.98 | 0.22 to 0.31 |
| composer | 0.90 to 0.98 | 0.16 to 0.27 | 0.86 to 0.91 | 0.21 to 0.26 |
| waiting capsule (tinted) | 0.57 | 0.58 | 0.80 | 0.38 |

Contrast, default strength then worst:

| line | light | dark |
|---|---|---|
| prose on the field | 13.3, 12.8 | 12.1, 10.0 |
| grey caption on the field (13 px) | 5.4, 5.2 | 6.0, 5.1 |
| the person's message, on glass | 15.8, 15.7 | 9.6, 8.5 |
| diff: file name / folder | 15.5, 15.2 / 6.1, 6.1 | 9.8, 8.6 / 5.5, 5.0 |
| diff: code and signs (the sign is the lowest) | 5.7, 5.6 | 6.3, 5.5 |
| tool-run card: verb / target / result | 6.0, 5.9 / 15.5, 15.2 / 6.2, 6.1 | 5.5, 4.9 / 9.9, 8.7 / 5.6, 5.0 |
| running command: command / tail / time | 15.8, 15.6 / 6.1, 6.0 / 6.2, 6.1 | 9.9, 8.7 / 5.5, 5.0 / 5.6, 5.0 |
| modules: text / quiet text / counts | 6.2, 6.2 / 6.2, 6.1 / 5.8, 5.7 | 5.5, 5.0 / 5.5, 5.0 / 5.6, 4.9 |
| pane: row titles / headings (12 px) | 5.5, 5.4 / 6.4, 6.3 | 5.2, 4.9 (the current row, on its fill) / 6.4, 5.7 |
| tabs | 9.3, 9.3 | 5.7, 5.2 |
| composer: placeholder / queued | 6.5, 6.5 / 8.6, 8.4 | 6.4, 5.8 / 8.2, 7.5 |
| glyphs on the waiting capsule | 6.4 | 6.6 |
| row card and waiting list (CSS platter): lowest line | 6.0 (Vivid) | 5.5 (Vivid, `#1f1f1f`) |
| settings on the field: lowest line (a placeholder) | 5.3 (Vivid) | 5.0 (Vivid, `#1f1f1f`) |

In the receded pose the lowest text lines are the diff signs in light (4.9) and the quiet module lines in dark
(5.4); nothing is under its floor there either.

Lines that failed on the way, and what changed: the green diff sign in the light receded pose (4.30; the hue was
deepened to `#1a6b40`), removed-line counts in dark on `#1f1f1f` at Vivid (4.17; lightened to `#f6a092`), the
empty to-do circle in light (2.61 as an icon; its extra opacity was removed), the chips under the new-chat composer
at Vivid (2.92 as icons; opacity raised). Idle rows on the dark pane read 4.5 at Vivid on `#1f1f1f`, on the floor
with no margin, so the third ink level on a dark host was raised from 82 % to 86 % of the runtime's primary.

Not measured, so not claimed: the lines inside the 36 px edge bands (one to four per route), text that appears
only on hover (durations, shortcuts, the margin note), marks drawn in CSS (dots, the switch), frames during a
transition, Reduce Transparency, and forced colours (looked at). The dark waiting capsule recedes to 0.38, one
step outside the dead band; its glyphs read 4.7 there as icons and would not carry words.

## 8. What the idea breaks, and what it costs

Laws of the glass guideline broken on purpose:

- **Content is not glass.** The transcript's blocks are. This is the experiment.
- **One to three windows.** At rest 13 surfaces are drawn: the pane, four modules, four blocks and four controls
  (14 are registered, counting the sidebar toggle that waits absent while the pane is there), and one more for
  each tool run that is open.
- **No shadow authored where the runtime draws one.** Every exterior shadow is CSS (section 3, item 5). It no
  longer follows the material's measured law: it is a fixed recipe per span, it is alpha black-brown and not
  multiplicative, and it leaves in the receded pose by a rule of the page.
- **Glass materialises, never fades.** The CSS platters scale and fade. The library surfaces do materialise.
- **Prose is not on glass, but lists are.** A diff and a list of tool calls are collections read in place.
- **No native comparison** was made. The nearest Apple surface is a visionOS window with ornaments; nothing Apple
  ships puts a scrolling column of glass cards over a still environment.

Costs:

- **Legibility.** Nothing measures under its floor, but the margin is thin exactly where content is densest: the
  12 and 13 px quiet lines on dark glass sit at 4.9 to 5.0 at Vivid on `#1f1f1f`, and they depend on the field
  staying graded. A field with a bright mass in the main space would put dark glass bodies toward the dead band. The
  opaque material holds 5.5 or better with no dependence on the field.
- **Calm.** A page of prose with five cards has five more edges, rims and shadows than Quiet's ringed cards had,
  and in the light scheme a block is nearly white (0.95 and up): it reads as a frosted white card with a soft
  shadow, and the glass shows only at its rim and while it moves. The dark scheme is where the blocks read as
  glass. Flip Blocks to Opaque to see how little is lost at rest.
- **Performance.** Two WebGPU roots, each with its own device and four window-sized canvases (eight canvases of
  2880 by 1800 at 2x, beside the field). The field is imported once per painting, not per frame. A layer
  re-reads every block's box on a resize and for up to 0.9 s of frames after anything that moves blocks. Scrolling
  the transcript end to end held the main thread's frame interval (240 frames in 4 s, median 16.7 ms, none over
  20 ms) with glass, veil and opaque alike, in headless Chrome on a loaded machine; GPU time was not measured and
  is where the cost would be. With Veil or Opaque the second root is not mounted at all.
- **Scale.** The lab's transcript is ten items. A real one is virtualised and hundreds of items long; glass
  surfaces would be registered only for rows in view, and a block entering during a fast scroll can be cut short
  for a frame (the library's stated limit for attached roots).

## 9. Motion

- Layout (the pane, the main space, the composer, the tabs): 460 ms on Field's curve, `cubic-bezier(0.32, 0.72, 0, 1)`.
  The window root is asked to re-measure on its own frames while a transition runs.
- The side column: the modules leave one after another (30 ms apart), each dematerialising as its content slides
  36 px and fades; only then does the main space take the room (320 ms later). Arriving is the reverse: the room
  is made, then the modules materialise 55 ms apart.
- A tool run opens by height over 300 ms on Quiet's curve; its glass is absent until 10 px of card show, then
  materialises and grows with it.
- Quiet's: the slot exchange (130 ms fade, the entering mark scales from 0.8), popovers and the row card (210 ms
  in from the anchor's corner, 130 ms out; the card re-anchors in 200 ms), press (90 ms scale).
- Instrument's: the switch knob and the segmented thumb on a light spring (420 to 440 ms), pills (220 ms).
- The runtime's: press on the bars (light and compression), the select platter, presence.
- At rest only a running mark moves (a 1.8 s breath, one spinner). Under Reduce Motion every page transition is
  1 ms and the runtime's springs lose their bounce.

## 10. Knobs and address aids

Knobs: Blocks (Glass, Veil, Opaque: this synthesis's own); Field strength (Whisper, Soft, Warm, Vivid); Ground
(the two light and four dark candidates, paired); Typeface (Figtree, Geist, System).

Address aids for captures, never design states: `x=tools,top,mid,card,waiting,nopane,noside`, `pose=inactive`,
`tier=css`, `rt=1`, `dev=1` (the runtime's checks and what each group resolved, in the console).

## 11. Rejected

- Settings sections as glass cards. The owner chose Quiet's unframed rows; a form is not a transcript block.
- Glass under prose. The assignment keeps prose on the ground, and a 600-word answer on a lens is the failure
  round 1's Windows measured.
- The trailing controls inside the main space beside the tabs: at 1440 the tabs ran out of room. They stand above
  the side column instead.
- Modules spaced by the derived room (62 px): honest to the letter, but four modules no longer fit a 900 px
  window. They share one group, where 12 px is allowed.
- The library's clearer material document for light blocks. It ships in a package this lab does not list as a
  dependency, so it could not be tried.
- Raising the body's chroma retention so light blocks take more of the field's hue: the shipped material is
  already at the value tried; nothing changed.

## To ship this in the app

What the real renderer would need, against "The app today" in the brief.

- **A plane under everything.** Today the window, toolbar and sidebar paint one flat ground and the window has an
  opaque background colour. This needs one canvas behind the shell painted from the theme (ground candidate,
  strength), and every region above it transparent. No window transparency or vibrancy is involved: the field is
  the app's own.
- **Two glass roots.** One for the shell (pane, bars, composer, modules), one attached to the transcript's
  scrolling content. The transcript is a virtualised list with its own hand-built stylesheet; glass can be
  registered only for rows in view, and each tool, edit and command row needs the "element in flow, surface
  beneath" arrangement of `glass.tsx`, fed by the virtualiser's measured rows instead of a `ResizeObserver` per
  block. This is the largest piece of work and the riskiest: the open questions are a transcript of hundreds of
  items under load, rows entering during a fast scroll, and streaming rows that grow every frame.
- **Shell geometry.** The side column is one raised rounded card today and the sidebar's width lives in
  TypeScript; the column becomes separate surfaces stacked with a gap, the 44 px toolbar goes, the tabs become
  fills in one capsule and the traffic lights sit on the pane at about 24, 22. Every resize and collapse has to
  tell the roots to re-measure.
- **Tokens.** New roles: the field's parameters, ink at four strengths, two fill sets (on the field, on glass),
  one status accent with a deeper mark step for light, shadow recipes per span, a radius ladder (12 / 18 / 20 /
  22 / 26 and capsules) in place of 6 px on nearly everything, and motion tokens, of which there are none today.
  The colour-literal guard would need to learn radii, shadows and durations.
- **A material setting.** Ship Blocks as a setting (Glass, Veil, Opaque), defaulting to Opaque wherever WebGPU is
  missing, Reduce Transparency is on, or a session is long. The same markup serves all three.
- **Things that draw their own colours** have to follow the ink pole and be measured on glass: syntax colours in
  code blocks and diffs (the transcript's highlighter brings its own themes), the terminal, charts. Here only two
  diff hues do.
- **Native views.** The browser tool's pages are native views composited above the page; they cannot sit under
  the pane, a module or a platter, so they stay inside the main space and the existing cover-with-a-picture path
  is used when a platter opens over them.
- **Menus and popovers** get one shared primitive with entry and exit motion (today each call site styles its own
  and none animates), drawn as the CSS platter or as library glass, chosen once.
- **Fonts.** Figtree and Geist Mono bundled as local variable files; remote fonts cannot load. Korean falls to the
  system face.
- **Measurement in CI.** `measure.mjs` should run against real content in both schemes before a field or a ground
  is changed: on this design a palette change is a legibility change.
