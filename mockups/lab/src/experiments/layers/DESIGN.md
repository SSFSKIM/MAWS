# Layers

Design record for the round 2 synthesis `layers` (order 0, first in the gallery). The contract is `mockups/lab/BRIEF.md` and
`mockups/lab/ROUND2.md`. Values live in `layers.css` (tokens at the top), `colour.ts` (everything a colouring
settles), `paint.ts` and `paper.ts` (the two field painters); this file says what each part was lifted from, what
happened where two parts met, what the idea breaks and what that costs.

The owner chose this synthesis as the style of the redesign and, in the same message, dropped its colour. Colour is
now a switch, and its record is section 12. Five calls about the result were still the owner's, and each of them is
a switch too: section 13. Four of them are answered and their answers are the design at rest, in the system face:
section 15. Paper has four warmer neighbours for the owner to choose among (section 14), and the painted form has a
fourth position with no drawing at all, Open's plain ground (section 16). Sections 0 to 11 are the experiment as it was built, under what is now
the switch's last position (Orange); where they name the orange, read "the colouring's accent".

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
| Colour commitment | the field is the only chromatic surface; ink is one neutral. Under Paper, the default colouring, there is no chromatic surface at all (section 12) | Field; the owner's picture |
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
tint: one seed, the colouring's accent (#fd780f under Orange), on the waiting capsule. Glyphs on it are the
  colouring's authored ink (#2a1300 under Orange); receded, the tint loses its chroma and the glyphs return to
  the runtime's ink. The runtime draws the seed itself in both schemes (drawn L, C and hue within 0.01, 0.005 and
  1 degree of the seed for every colouring), so a seed is chosen as a fill is: clear of the levels where neither
  ink holds.
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
| ink, accent fill, text on it, accent mark, focus, shadow tint | per colouring: section 12 | per colouring |
| under Orange: accent fill | `#fd780f`, text on it `#2a1300` | same |
| under Orange: accent mark (glyphs) | `#c84c00` | `#fd780f` |
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

This section is the Orange colouring's record, as measured before the Colour switch; every colouring's readings
are in section 12.6, on the same floors.

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

Knobs: Colour, first (section 12); Blocks (Glass, Veil, Opaque: this synthesis's own); Field strength (Whisper,
Soft, Full, Vivid; the third was labelled Warm until a colouring could be cool, and its value is still `warm`);
Ground (the two light and four dark candidates, paired; Paper and Cobalt bring their own ground and do not
consult it); Typeface (Figtree, Geist, System). That is five, one more than the brief's "three or four at most":
Colour was asked for by the owner and none of the other four could be folded into it. Section 13 adds five
more, one per call still open with the owner; each is meant to be answered and then removed. Four have been
answered (section 15), and their defaults are now the answers: Painted form on Out of focus, the New chat line in
the sans, Alignment on the column, Right column growing from its button, and Typeface on System.

Address aids for captures, never design states: `x=tools,top,mid,card,waiting,nopane,noside,field` (the last
shows the field alone), `pose=inactive`,
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
  dependency, so it could not be tried. (Tried later, for Paper, and not adopted: section 12.5.)
- Raising the body's chroma retention so light blocks take more of the field's hue: the shipped material is
  already at the value tried; nothing changed.

## 12. Colour

Added 2026-11-14, after the owner chose Layers as the style and dropped its colour ("for color I'll actually abandon
the strong orange #FD780F"). Colour is now the first knob. Sections 0 to 11 describe the experiment as it was built,
under what is now the last position, Orange; where they name a hue, read "the colouring's".

### 12.1 What a colouring is

In Layers colour does three jobs, and a position of the switch settles all three together, in both schemes:

1. **The field**: what is painted on the canvas and seen through every pane, block and module.
2. **The tint glass picks up from it**: the library carries the field's hue into each body by itself; the page's
   part is the ink's temperature and the tint under its CSS shadows (`--xl-shade-rgb`), because a brown shadow in a
   blue room reads as dirt.
3. **The mark that means "this session needs you"**: the waiting capsule's seed, the glyphs on waiting rows and
   tabs, Approve, the send button when there is something to send, and keyboard focus.

Each is one record in `colour.ts`: a field per scheme, six tokens per scheme (ink, shadow tint, accent, ink on the
accent, the accent as a stroke, focus), the mark's form, and optionally its own ground. Nothing else in the
experiment names a hue. The mark has two forms. `stroke` is Quiet's glyph drawn in the mark colour, as before.
`badge` is the same glyph reversed out of a 20 px disc of the accent (18 px in a tab), for an accent that cannot be
a 15 px stroke: the ink itself, which would be one more grey mark among the row's own. Inside the capsule a badge
goes back to a plain glyph, since the capsule is already the filled thing. In every form the state is a shape first
(a hand, a question mark, a list); no colouring says it by hue alone.

The owner's answers, in order, shaped the list: "Show me a range", "Softer warm", "A different hue"; then "also want
to try using full white and full black and other charecteristic color. if that could work"; then a picture, with
"How about using imagery a bit like this? To answer about colour". The picture is the answer, so it is the first
and default position and the others are the comparison set behind it.

| position | in a sentence | mark |
|---|---|---|
| **Paper** (default) | No hue. A painted still life under the window: paper lifting off an ivory floor and passing into clear glass. | ink, as a badge |
| Peach | Softer warm, the same family: Orange's dusk at about half its chroma. | apricot stroke |
| Honey | Softer warm, moved from orange toward gold: late afternoon light. | gold stroke |
| Rose | A different hue that is still warm: blush, rose, mauve. | raspberry stroke |
| Blue hour | A different hue that is cool: the sky after sunset, and the mark is the lit window. | amber stroke |
| Opal | Several soft hues at once: peach, rose, lilac, sky, mint. | ink, as a badge |
| Cobalt | Full white and full black with one characteristic colour, as light under the glass and as the mark. | cobalt stroke |
| Orange (was) | The dropped colouring, unchanged, for reference. | `#fd780f` |

### 12.2 Paper

**Source.** The owner's picture is outside the repository and nothing of it is in here; this is what it shows, in
words. A still, warm, almost colourless scene: a matte ivory ground; one sheet of paper that lifts in a slow curve
and, along the same curve, becomes clear glass; the paper's lit crest near the ground's own level and its shaded
underside a clear step below; one soft warm shadow on the floor; the glass nearly as light as the ground and
declared by a thin bright rim, a faint reflection inside it and that shadow, not by any tint; near-black ink; one
word in a light, high-contrast serif.

**What was taken from it.** Colour stops being a hue and becomes four materials: paper, glass, shadow, ink. And the
field stops being a wash and becomes a picture of that kind, painted by `paper.ts` on the same canvas the other
fields use, so both glass roots refract it like any field.

**The ground is the picture's ivory, and that is what makes the glass read.** `#e8e1db` (level 0.89), a shade
deeper and greyer than the app's `#faf9f5` (0.98). The library's light glass draws at 0.90 to 0.99 at these sizes.
On `#faf9f5` nothing separates the two, which is round 1's finding that glass over a pale flat ground is close to
invisible. On the ivory every pane, block and module is the lighter thing, with its rim and a warm shadow under it:
the picture's own answer, got by lowering the ground instead of colouring it. Measured, a body stands 0.04 to 0.08
from the field under it in OKLab (1.13 to 1.28:1; blocks and modules 0.05 to 0.06), against 0.03 to 0.05 for the
blocks and modules under Orange and 0.002 to 0.006 on pure white. It is a modest gain and a real one, and it is
linear: every 0.01 the ground comes down is 0.01 more. Paper therefore brings its ground and the Ground knob is not
consulted (dark `#181614`).

**The picture** (all coordinates are shares of the window, so it is the same picture at every size):

- *The arch.* A sheet lifts off the floor at the lower left. Its near edge is the crest: in at (−0.03, 0.815), up
  to its highest at (0.17, 0.74), then one long fall to the fold at (0.56, 0.958). Above the crest the sheet's top
  surface is a sliver that faces the light while the sheet rises and turns away past the crest (ground to
  `rgb(243 238 232)`), with a soft far edge. Below the crest is the underside, painted rung by rung: from
  `rgb(216 207 197)` near the left to `rgb(196 185 172)` at the fold, where the least light gets in; darkest just
  under the edge, lifted a little near the floor by what the floor sends back. The crest itself is one 1.25 px
  line of `rgb(251 248 244)`: the sheet's edge catching the light.
- *The fold and the leaf.* At the fold the sheet turns upward and is glass from there: a leaf that rises to its
  tip at (0.974, 0.122) and comes back down along a full belly. Paper passes into glass along the same curve:
  opaque at the fold, a quarter left 0.3 of the way to the tip, gone at 0.42. The glass has a veil of white at
  4 to 11 % (more toward the tip), a soft reflection that fills the upper leaf and ends on an edge of its own, a
  rim (1.5 px of white at 95 % on the rising edge, 1.1 px at 66 % on the belly, each with a fine warm-dark line
  beside it at 26 % so a white line holds on a ground nearly as light), and a heavier stroke where the two edges
  meet at the tip, which is the glass's thickness.
- *The shadows.* One contact shadow under the arch (`rgb(126 104 84)` at 30 %, blurred 20 px) and one thrown by
  the leaf to the lower right (24 %, 22 px), lighter because the thing is clear, with a streak of light laid
  inside it: what the glass gathers.
- *The room.* A broad pool of light from the upper left at 12 % (more would lift the ground back toward the glass)
  and a falloff of 10 % toward the far corner, so the ground is not flat; a grain of ±1.6 % over everything,
  because paper is matte and a lens needs something fine to displace everywhere.

**Composed for the window.** One strong form, placed where there is room. At 1440 by 900 the arch runs under the
pane's empty lower third and the left margin, the fold sits under the composer, and the leaf rises through the
right margin behind the modules. The reading column is ground and nothing else above y = 0.70; the only parts that
cross it are the leaf's rim (a bright hairline) low on the right, and the arch's top surface and the upper slope of
its underside behind the last lines of the transcript, where the scroll mask is already thinning them. New chat has
no column and no modules, so there the whole form stands free and the composer's right end crosses the leaf.
Settings has no side column and its rows are read on the field, so there the leaf's rim runs behind the controls;
it is the weak scene (12.7). Nothing in the picture moves.

**Field strength** is how far the shading departs from the ground: every depth above is multiplied by the knob
(Whisper 0.29, Soft 0.62, Full 1, Vivid 1.47, capped at 1.6), so Whisper is an almost flat ivory with a rim on it.

**Dark is the same room with the lamp low, not the light picture recoloured.** The ground is a warm near-black
(`#181614`); one low lamp at the left leaves a pool of light on the floor (`rgb(255 224 188)` at 15 %, centred
under the arch); the room falls off to black at 30 % toward the far corner. The paper is still ivory, so its top
surface is the brightest broad thing in the room (`rgb(104 95 84)`), its edge is the brightest line
(`rgb(196 184 168)`), and its underside sinks below the floor's own level (`rgb(52 47 42)` to `rgb(18 16 14)`).
The glass has almost no body left (a veil of 4.5 %); it is rim (62 %), a reflection (7.5 %) and the light it lays
on the floor (20 %). Rejected for dark: inverting the picture (black paper, which is a recolouring); moonlight (a
blue, which is a hue this colouring does not have); glass that glows (it would be the brightest thing behind dark
panes, where round 2 found text hard to read); and lighting the paper as brightly as by day (its top surface
would sit at 0.6 under the pane and the composer, in the band where neither ink reads).

**The mark is ink.** What stands out in a world of paper and glass is what stands out in the picture: the ink.
The capsule's seed is the ink (`rgb(33 30 27)`, drawn at level 0.12 on a field of 0.91: 12:1 against its ground,
the strongest mark of any colouring), its glyphs are paper (`#f4f0eb`), a waiting row carries an ink badge, and
Approve is an ink button. At night the ink is the colour the paper was (`rgb(232 225 219)`, the light ground
itself) and the capsule is a lit piece of paper. Weighed and not taken:

- *A seal.* Cinnabar on ivory is the oldest "this needs your approval" there is, and it would be handsome. It is
  also a strong red-orange between the orange the owner just dropped and the clay they ruled out before it, and
  it is within a few degrees of the red already spent on removed lines (`#b03424`).
- *Gold.* Foil on paper is premium in print; flat on a screen it is ochre, and at 15 px it has to be deepened to
  bronze to hold 3:1.
- *Blue-black ink.* The complement of the ivory and the most findable hue on it. It would be a fifth material in a
  picture that has four, and on a control it reads as a link or a selection.
- *Light.* A pane brighter than the paper is how the picture declares glass, and at night it works; by day white
  on ivory is 1.3:1.

What the ink costs: the mark shares its colour with the stop button, the switches and the unread dot, so it is
told apart by form (a glyph in a disc) and place, not by colour; this is the monochrome end of "never by hue
alone". If the owner wants one pigment in this world, the seal is the one to try first, with the removed-line red
moved to make room.

**One line of serif.** The new-chat line is set in Newsreader (installed; latin `woff2`, its optical-size axis at
72) at weight 300, 37/44, tracking −0.014em, under this colouring only. The picture's one word is a display
serif, and this is the one display line the app has. The owner's ruling against serif prose stands: nothing else
is set in it, at any size, and the Typeface knob does not reach it. It is offered for the owner to rule on.

**Tokens.** Ink `rgb(33 30 27)` light, `rgb(232 225 219)` dark. Shadow tint `rgb(84 62 42)`: the shadows under
panes and blocks are the picture's warm floor shadow. Accent, mark and focus are the ink.

### 12.3 The comparison set

All six keep Field's composition (seven masses at the edges, four across the main space at about a third of their
level, contour lines as the fine frequency) and change what the masses are. Fields are authored in OKLCH, because
the two limits a field has to hold are stated that way: how light the ground under prose stays, and how deep the
ground under dark glass stays. Each row gives the journey down the pane's column (top to bottom), then the mark.

| | field, light (L, C, hue) | field, dark | mark: fill, ink on it; as a stroke (light / dark) | why this mark |
|---|---|---|---|---|
| **Peach** | 0.88 0.075 70 → 0.82 0.09 52 → 0.82 0.085 25 → 0.78 0.06 335: Orange's four hues at 45 to 55 % of their chroma and a step lighter | 0.66 0.12 62 → 0.58 0.13 45 → 0.50 0.13 20 → 0.42 0.10 332: embers cooled to two thirds | `#f3ac75`, `#2a1605`; `#a95f23` / `#f3ac75` | The dropped orange with its chroma cut from 0.19 to 0.11 and its lightness raised: the same meaning said more quietly. It stays lighter and yellower than the clay the owner ruled out earlier (`#d97757`, hue 39). |
| **Honey** | 0.92 0.09 88 → 0.86 0.12 80 → 0.84 0.10 66 → 0.78 0.05 40 | 0.68 0.13 74 → 0.60 0.13 66 → 0.50 0.12 52 → 0.38 0.07 30 | `#f8bd2c`, `#271b00`; `#95680a` / `#f8bd2c` | Gold is warm without orange's heat, and amber is the long-standing colour of "attention, not alarm". |
| **Rose** | 0.86 0.09 35 → 0.76 0.15 8 → 0.74 0.13 350 → 0.66 0.11 315 | 0.62 0.17 15 → 0.52 0.18 5 → 0.46 0.16 350 → 0.38 0.13 315: wine | light `#cb2865` with white; dark `#f77f9e` with `#2b0614`; `#c41f5f` / `#fa89a5` | The field's own hue, deepened. A fill this dark takes white ink in light, so the two schemes get different fills, each clear of the level where neither ink holds. |
| **Blue hour** | 0.86 0.075 240 → 0.76 0.12 265 → 0.74 0.12 285 → 0.72 0.10 315; ink `rgb(22 25 34)` | 0.52 0.15 250 → 0.46 0.17 268 → 0.42 0.17 285 → 0.36 0.13 315; ink `rgb(234 237 244)` | `#faac27`, `#291a00`; `#9e620a` / `#fbb541` | The field's own hue cannot carry the mark: a blue capsule in a blue room is found by darkness alone, and blue on a control reads as a link. So the mark is the complement, one lit window at the blue hour, which is also where this colouring keeps its warmth. |
| **Opal** | peach 0.88 0.09 60 → rose 0.80 0.11 8 → lilac 0.78 0.10 305 → sky 0.80 0.09 240, with mint 0.88 0.07 185 at the upper right; ink `rgb(27 26 30)` | 0.60 0.14 50 → 0.50 0.17 5 → 0.42 0.16 305 → 0.42 0.13 245, teal 0.50 0.10 190 | the ink (`rgb(27 26 30)` with white; dark `rgb(240 238 242)` with `#17161a`), as a badge | With five hues in the room no hue can mean anything, so the mark steps out of colour: the darkest thing on a light page, the lightest on a dark one. |
| **Cobalt** | ground `#ffffff`. Eight placed masses of one blue, 0.80 0.11 258 to 0.66 0.19 264, under the pane, the modules, the composer and the tab capsule only; ink `rgb(12 13 17)` | ground `#000000`. The same masses at 0.40 to 0.50, C 0.15 to 0.22, over two broad floors of white at 5 %; ink `rgb(243 244 247)` | light `#194fe3`, dark `#2b62ef`, both with white; `#194fe3` / `#79abfd` | See 12.4. |

Shadow tints follow the room: Peach `90 50 20`, Honey `90 60 0`, Rose `90 20 45`, Blue hour `30 40 95`, Opal
`50 35 80`, Cobalt `10 30 110`. Focus is the accent where it can ring a white surface (Rose, Cobalt, the inks) and
the stroke colour a step lighter where it cannot (Peach, Honey, Blue hour).

### 12.4 Full white and full black: does it work?

The owner's question was honest ("if that could work"), so here is a plain answer for the best version found.

**What a field cannot do on a pure ground, the colour has to do.** On `#ffffff` light glass (0.92 to 1.00) has
nothing to differ from, so a room-wide wash would have to be strong to show a pane, and then it is no longer full
white. Cobalt therefore paints colour only under the glass (the pane, the modules, the composer, the tab capsule)
and leaves the reading column pure. The colour is blue for three reasons that are not taste: on white, blue is the
one hue that reads as shade and so as depth, where a pink or a yellow reads as a stain; saturated blue has the
lowest luminance of any hue, so dark glass over it stays far below the level where text fails (bodies 0.30 and
down); and it is the complement of the orange that was dropped. On `#000000` two broad floors of white at 5 % go
under the glass first (round 1's remedy for faint colour turning into a wash), and the blue is then let through
at full chroma on purpose: the pane is a slab of blue glass.

**Verdict.** In dark it works, and is the most striking position of the eight: prose on true black, glass drawn
by its rim and its lifted body, the pane lit blue. In light it half works: the pane, the modules and the composer
read as blue-lit glass, but a transcript block on pure white is a white card and its shadow, the experiment's own
idea (blocks of glass) is invisible exactly where it lives, and the distance from field to body there measured
0.002 to 0.006 in OKLab against 0.05 under Paper. What it costs besides: white ink on black for hours (the ink is
held at `rgb(243 244 247)`, not white, for that reason); a product that is no longer warm anywhere; and blue on a
control competing with every link and selection convention.

**The warm answer on pure grounds is not a field at all.** A yellow was built and dropped (12.5): as light under
glass on white it is sallow. The warm version of "full white and full black" is marks only, and the switch already
has it: Paper's picture is hueless, so the idea carries over; the Ground knob at `#ffffff · #000000` under any of
the four warm colourings shows the rest.

### 12.5 Rejected

- **Sun**: pure grounds with a yellow (`oklch(0.88 0.18 97)`). Built twice. As light under glass on white it
  yellows the panes without reading as sunlight; as marks only over neutral shade it is Paper with a louder
  badge. In dark it is Honey on a blacker ground.
- **Mono**: the owner's grounds with light and shade and no hue, and an amber mark. Built; it was the strongest
  of the first round, and then the owner's picture arrived, which is the same idea with a form in it. Paper
  replaces it.
- **A coral or vermilion mark**, for any colouring: in light its stroke lands on the removed-line red.
- **A violet mark** for the hueless and many-hued rooms: it would have been chosen because it was the one hue not
  yet spent, which is a reason about the palette and not about the product.
- **A cool mark in a cool room** (Blue hour in indigo): 12.3.
- **Per-colouring removed and added colours.** The two diff hues stay fixed across the switch, so a colouring is
  compared on the same content.
- **The clearer material document** (the Glass slider at 0.25), which section 11 could not try. Tried here for
  Paper by importing it from the library's web package by path. The pane shows a little more of the arch through
  it; at window size the difference is slight, one dark line fell to 4.45 at Vivid, and the import is a path into
  the package store. Not adopted, and no trace of the import remains.
- **A field that changes with the scene** (a larger form on New chat). The field is one painting; a form that
  jumped when a session opened would be motion at rest by another name.

### 12.6 Readings, per colouring

`measure.mjs`, same floors as section 7 (4.5 for text, 3 for large text and icons), 1440 by 900 at 2x, WebGPU, one
build. Fourteen routes per colouring: the session at default strength in both schemes, then at its strongest (Field
strength Vivid on the ground that hurts most, `#ffffff` in light and `#1f1f1f` in dark; Paper and Cobalt have
their own ground) the session at rest, with the waiting list open (which is where Approve is read), with the row
card open, and from the top with a tool run open, the settings page, and new chat. Of 11,680 gated readings none
is under its floor, for any colouring. "Bodies" is the range of the glass bodies' drawn level at the
strongest setting (the ink dead band is 0.39 to 0.49). "Turn" is how far the glass moved the hue it was given.
"Capsule" is its drawn level, its distance from the field under it in OKLab, and its contrast against that field.

| colouring | scheme | lowest text, default | lowest text, strongest | lowest icon | bodies | turn | capsule |
|---|---|---|---|---|---|---|---|
| Paper | light | 5.3 (caption on the field) | 4.88 (removed count, list open) | 3.3 | 0.90 to 0.99 | none | 0.12; 0.655; 12.1:1 |
| Paper | dark | 5.1 (command tail) | 5.02 (command tail) | 3.9 | 0.15 to 0.31 | none | 0.89; 0.707; 13.8:1 |
| Peach | light | 5.7 (caption on the field) | 4.98 (removed count, list open) | 3.3 | 0.92 to 0.99 | -3° at hue 70 | 0.72; 0.168; 1.6:1 |
| Peach | dark | 5.4 (pane row) | 4.74 (pane row, new chat) | 3.8 | 0.17 to 0.35 | -9° at hue 31 | 0.73; 0.445; 5.7:1 |
| Honey | light | 5.8 (caption on the field) | 5.07 (removed count, list open) | 3.3 | 0.92 to 1.00 | -4° at hue 88 | 0.74; 0.177; 1.5:1 |
| Honey | dark | 5.4 (pane row) | 4.66 (pane row, new chat) | 3.8 | 0.17 to 0.35 | -10° at hue 66 | 0.75; 0.476; 6.2:1 |
| Rose | light | 5.6 (caption on the field) | 4.84 (removed count, list open) | 3.3 | 0.92 to 0.99 | -5° at hue 356 | 0.37; 0.410; 4.2:1 |
| Rose | dark | 5.5 (pane row) | 4.97 (pane row, new chat) | 3.9 | 0.17 to 0.34 | -3° at hue 354 | 0.65; 0.408; 4.8:1 |
| Blue hour | light | 5.8 (caption on the field) | 4.92 (removed count, list open) | 3.3 | 0.92 to 1.00 | +6° at hue 277 | 0.70; 0.234; 1.6:1 |
| Blue hour | dark | 5.6 (pane row) | 5.15 (pane row, settings) | 4.0 | 0.17 to 0.33 | +10° at hue 247 | 0.71; 0.524; 6.7:1 |
| Opal | light | 5.8 (caption on the field) | 4.92 (removed count, list open) | 3.3 | 0.92 to 1.00 | -3° at hue 60 | 0.10; 0.691; 13.6:1 |
| Opal | dark | 5.6 (pane row) | 5.12 (pane row, new chat) | 3.9 | 0.16 to 0.33 | -9° at hue 52 | 0.94; 0.635; 10.9:1 |
| Cobalt | light | 5.8 (removed count) | 4.72 (removed count, list open) | 3.3 | 0.90 to 1.00 | +4° at hue 258 | 0.31; 0.485; 5.4:1 |
| Cobalt | dark | 5.8 (pane row) | 5.13 (Approve, list open) | 4.2 | 0.09 to 0.30 | +10° at hue 267 | 0.38; 0.371; 3.4:1 |
| Orange | light | 5.4 (caption on the field) | 4.87 (removed count, list open) | 3.3 | 0.90 to 0.99 | -9° at hue 70 | 0.57; 0.246; 2.1:1 |
| Orange | dark | 5.3 (pane row) | 4.53 (pane row, new chat) | 3.7 | 0.17 to 0.36 | -10° at hue 56 | 0.58; 0.349; 3.7:1 |

What the table says:

- **Text.** Every colouring holds its floors. The lowest line in light is the same for all of them, the removed
  count in the Changes module where the waiting list's shadow falls on it (4.7 to 5.1), so it is a property of
  that red and not of a field. The lowest in dark is a pane row on new chat or settings, where the pane stands
  over the field's brightest corner: Orange 4.53, Honey 4.66 and Peach 4.74 are the thin ones, because orange and
  yellow carry the most luminance for their chroma. Section 8's warning stands and is now located: the margin is
  in the dark pane, and it shrinks as the field moves toward yellow. Paper's dark pane holds 5.6; its lowest line
  (5.02) is the running command's tail, where a block stands over the arch's lit top.
- **The dead band.** No body is in it for any colouring: light bodies 0.90 and up, dark bodies 0.36 and down. Dark
  fields were built to this: every dark mass is kept at or under the level of Orange's, and the yellows are darker
  than their hue would suggest.
- **The turn of hue** (round 2's finding of about 10 degrees on orange). It is not particular to orange and it is
  not "toward red": every hue turns toward magenta. Warm fields move toward red by 9 to 10 degrees in dark and 3 to
  9 in light; blues move toward violet by 9 to 10 in dark and 4 to 6 in light; Rose, already near that pole, moves
  3 to 5. Consequences taken: Honey's dark field is authored at hue 74 to 30 where gold at 85 would have been
  drawn greener than brass and was (the first build read as olive); Blue hour starts at 240, bluer than the
  periwinkle it is meant to read as. Paper has no hue to turn.
- **The mark, found.** Against its own field the capsule stands 0.17 (Peach, light) to 0.71 (Paper, dark) apart
  in OKLab. The three pale fills (Peach, Honey, Blue hour's amber) are found in light by chroma, not by level:
  1.5 to 1.7:1 against the field, as the orange was at 2.1. The two inks and Rose are found by level as well
  (4.2:1 and up). The weakest is Peach in light, which is the price of the softness it was asked for.
- **Glass against its ground in light.** The least distance from any body to the field under it, at the strongest
  setting: Opal 0.006, Honey 0.015, Peach and Blue hour 0.019, Rose 0.022, Orange 0.030, Paper 0.039, and 0.000
  for Cobalt's blocks on pure white.

**Paper, receded** (`pose=inactive`, strongest setting), measured because it is where this colouring is thinnest.
Light: lowest text 4.90, lowest icon 3.2, bodies 0.82 to 0.98, which is the ivory's own level (0.89), and with no
hue to differ by a receded block had nothing left but its rim. So under Paper in light the CSS shadow does not
leave in the receded pose; it stays at about half strength (the one exception to section 3, item 5). The result
is the nearest the page comes to the owner's picture: glass as light as its ground, declared by a shadow. Dark:
lowest text 4.91, bodies 0.12 to 0.23 on a ground of 0.09, still told apart. The cost is the capsule: its ivory
seed recedes to level 0.20, 1.4:1 against the field, so in an unfocused dark window the mark at the top right is
nearly gone and the badges on the rows, which are not glass, carry it alone.

Looked at, not measured: Paper at 1280 by 800 and 1728 by 1117, with Blocks at Opaque, at Whisper and Vivid, with
the waiting list open, and the field alone in both schemes (`x=field`).

### 12.7 What the colour work showed to be fragile

1. **In light, a colouring barely reaches the glass.** Light glass draws at 0.92 to 1.00 whatever is under it, so
   the field shows between surfaces and faintly through the pane, and a block is a white card. Changing the hue
   changes the room, not the blocks. The only thing that made light glass read better was Paper's lower ground.
2. **The mark is a fill, and fills have a forbidden band.** The runtime draws the capsule's seed as given, in both
   schemes. A seed between about 0.55 and 0.70 in lightness takes neither ink at 4.5. The orange sat just above
   it. Rose and Cobalt needed a different fill per scheme, which the single `tint="#fd780f"` could not express.
3. **A pale accent cannot be a stroke.** Any accent lighter than about 0.6 has to be deepened for a 15 px glyph
   on light glass, and a deepened yellow or apricot is bronze: the hue's identity is gone in exactly the scheme
   where it is needed. Hence the second form, the badge.
4. **The warm red is taken.** The removed-line colour sits where a coral, a vermilion or a seal would go, so the
   natural warm alternatives to orange are closed unless that red moves.
5. **Shadows, contour ink and three inks were literals.** The CSS shadows were brown, which under a blue or
   hueless field reads as dirt; they are a token now. The same was true of the contours' ink and of the tooltip
   and solid colours in dark.
6. **The dark pane's margin** (above): 4.53 at the strongest setting under Orange, 4.66 under Honey.
7. **A picture field has a composition, and the layout can move under it.** Paper's form is placed for the
   session: there the column is glass blocks and the form stays under the pane, the composer and the modules. The
   settings page is the weak scene. Its rows are read directly on the field and scroll over the whole of it, so
   the leaf's rim runs behind the segmented controls and the arch's edge can pass through a heading. Every line
   still measures above its floor, and it is still lines behind words. The remedy to try, if the owner keeps the
   picture, is a lower strength on that scene only, or a settings column that stands on a surface.
8. **Five knobs.** The switch added one to an experiment that already had four.

### 12.8 What changed in the code

- `colour.ts` (new): the `Colouring` record, an OKLCH to sRGB conversion that gives up chroma until a colour is in
  gamut, Field's geometry, and the eight colourings. Orange's masses are the old literals, unconverted.
- `paper.ts` (new): the Paper field's painter. Splines in shares of the window, two lights (`DAY`, `NIGHT`).
- `paint.ts`: takes a field instead of a scheme; the mass tables moved to `colour.ts`; a field that names a
  picture is handed to its painter.
- `Layers.tsx`: reads the knob, writes seven variables on the root (`--xl-ground`, `--xl-ink-rgb`,
  `--xl-shade-rgb`, `--xl-accent`, `--xl-on-accent`, `--xl-accent-mark`, `--xl-focus`) and `data-colour`,
  `data-mark`; a colouring's own ground wins over the Ground knob; the capsule's seed is passed to `Waiting`.
- `Session.tsx`: `Waiting` takes its tint as a prop.
- `layers.css`: the shadow recipes, the current-row shadow, focus, selection, the Approve hover and the dark
  solid and tooltip colours are derived from those variables (Orange's values are the defaults in the sheet, so
  it stands without the knob); the badge form; the serif face and the one rule that uses it; the shadow kept at
  half under receded light glass for Paper; the `x=field` aid.
- `meta.ts`: the Colour knob, first; notes rewritten; Field strength's third label.
- `measure.mjs`: reads each glass body against the field painted under it (level, hue given and hue drawn,
  distance, contrast), and has a `BRIEF=1` mode of a few lines per route for a matrix like the one above.

Captures of record, in `shots/layers/`: for each colouring `layers-<scene>-colour-<id>.png` and
`layers-<scene>-scheme-dark-colour-<id>.png` with scene `session`, `home`, `settings`; for Paper also the field
alone, the two other window sizes, Whisper, Vivid, Opaque and the receded pose. The captures with no colour in
their name are older and show Orange, which was then the only colouring.

## 13. The five open calls

Added 2026-11-14. After the owner chose Layers and then Paper, five calls about it were still theirs, and they make
calls by looking. Each call is now a switch. Its first position is the design as it stood and is the default, so
the page at rest is the page of sections 0 to 12 (captured before and after: the only pixels that differ are the
breathing dots and the spinner). The switches follow Colour in the lab's panel, in the order below. Three of them
are about Paper and say so in their label; under another colouring they are not consulted.

| switch (`id`) | positions | what I would choose |
|---|---|---|
| Painted form (`form`) | Everywhere · Out of focus where you work · New chat only (and, since section 16, None: plain ground) | Out of focus where you work |
| New chat line (`line`) | Serif · Sans | Serif |
| "Needs you" mark (`mark`) | Ink badge · Soft disc · One gold | One gold |
| Alignment (`align`) | As it is · On the reading column | On the reading column |
| Right column (`side`) | Four modules · One card · Grows from a button | Grows from a button, with the column rule |

The five picks together are captured as `layers-<scene>-…-form-recede-mark-accent-align-column-side-button.png`.

Since this section was written the owner has answered four of the five, and the defaults follow their answers, not
the "as it stood" positions (section 15). The captures and readings below were taken under the earlier defaults
(the form everywhere, the earlier alignment, four modules, the serif, Figtree) unless a route names another.

### 13.1 How present the painted form is

The question put to the owner: this present everywhere, or mostly on New chat and quieter elsewhere? New chat has
the whole form in every position.

- **Everywhere** (as it is). One painting under every scene. It argues that the picture is the room, and a room
  does not change when you sit down to work. It costs what 12.7 item 7 recorded: on Settings the leaf's rim and
  the arch's edge are hairlines behind rows of words and their controls, and in a session the rim crosses the last
  lines of the column. Every line measures above its floor; it is still lines behind words.
- **Out of focus where you work.** On a session and on Settings the same form is still there, at 85 % of its depth
  and out of focus (a blur of 8 px on a window 1440 wide): the arch is a soft rise of shade, the leaf a breath of
  light, and no line is left anywhere in it. It argues that what hurts a word is an edge behind it, not a tone, so
  the edges go and the tone stays: glass still has light and shade under it to take up, and the picture is still
  recognisably the one New chat shows. Opening New chat brings it into focus over 620 ms, and leaving lets it go:
  one dissolve between two kept layers, on a decelerating curve, and nothing moves once it has settled. It costs a
  second and a third canvas the size of the window, and a field that is no longer one painting: 12.5 rejected "a
  field that changes with the scene" because a form that jumped would be motion at rest; this one does not jump and
  does not change its composition, only its focus, and it moves once per change of scene.
- **New chat only.** A session and Settings stand on the ground with its light alone (the pool, the falloff, the
  grain); the form, and the shadows it cast, are not there. It argues that work wants an empty desk. It costs the
  glass its backdrop: on those scenes every pane and block is over a field with nothing in it to bend, which the
  glass guideline calls a material with no job, and what declares a pane is then Paper's lower ground and its
  shadow alone. It also makes the picture a splash screen: seen once, on the one scene with nothing to do.

**What I would choose: out of focus.** It mends the scene 12.7 called weak without emptying the room. The second
position keeps the reason Paper was chosen (the room is a still life) on every scene and removes the one thing
that was wrong with it there.

Readings (`measure.mjs`, floors and method as in section 7; default strength, then Vivid):

| lowest text line (light / dark) | Everywhere | Out of focus | New chat only |
|---|---|---|---|
| session | 5.35 / 5.08 | 5.35 / 5.13 | 5.35 / 5.26 |
| session, Vivid | 5.38 / 5.02 | 5.38 / 5.07 | 5.38 / 5.14 |
| session, Vivid, from the top with a tool run open | (12.6) | 5.48 / 5.13 | not run |
| session, receded | (12.6: 4.90 / 4.91 at the strongest setting) | 4.95 / 5.37 | 4.90 / 5.62 |
| settings | 5.04 / 5.53 | 5.04 / 5.53 | 5.04 / 5.53 |
| settings, Vivid | 5.04 / 5.35 | 5.04 / 5.35 | 5.04 / 5.35 |

The light lines are a grey caption on the field and a placeholder in a settings input; the dark line is the running
command's tail, which stands over the arch's lit top and gains a little as the form recedes. Lowest icon: 3.2 to
3.3 in light (a caret on the pane), 3.9 to 4.6 in dark. Nothing is under its floor in any of the 22 routes.

An out-of-focus form is a mix of levels the sharp form already had, which is why no light reading moved and no
dark one moved by more than two tenths. What the table cannot say is what the positions are for: on Settings no
line of the picture is behind a word in the second and third, and that is seen, not measured.

### 13.2 The New chat line

- **Serif** (as it is): Newsreader 300, 37/44, optical size 72, tracking −0.014em. It argues that the app has one
  display line and the owner's picture has one voice for such a line. It costs a second family for six words, and
  it is the only place the typeface knob does not reach. A Korean line would not be set in it at all: Newsreader
  has no Hangul, and the stack falls to the system sans.
- **Sans**: the same words in the interface face (it follows the Typeface knob), at 420, 33/42, tracking −0.024em.
  The other colourings set this line at 560, 27/34; under Paper that weight reads as a label on a photograph, so
  Paper's sans is lighter and larger, near the serif's colour on the page. It argues one voice everywhere and the
  owner's "no serif" taken without exception. It costs the page its one moment of contrast in type: the line
  becomes the largest piece of interface text and nothing more.

**What I would choose: the serif.** One line, in the one place with nothing else to read, is what a display face
is for, and it is what ties the page to the picture the owner sent. The sans is the better pick if this line will
usually be read in Korean, or if the owner's ruling against the serif was about the family and not about prose.

Readings, as large text (floor 3): the sans line 12.8 in light and 12.7 in dark (12.9 and 12.2 at Vivid), the same
as the serif, since the field behind it is the same; with the Typeface knob on Geist and on System likewise.

### 13.3 The "needs you" mark under Paper

All three keep section 12.1's rule: the state is a shape first (a hand, a question mark, a checklist) in a disc of
20 px (18 in a tab), in the same three places: the waiting row in the pane, its tab, the capsule at the top.

- **Ink badge** (as it is). The disc is the ink and the glyph is paper; the capsule is glass tinted with the ink.
  The strongest mark of the three by level (12:1 against the field) and the heaviest thing on the page: at rest a
  session shows five solid discs and one black capsule, and they share their colour with the stop button, the
  switches and the unread dot.
- **Soft disc** (lighter, still no hue). The disc is the surface's own ink at 13 %, the glyph that ink at full
  strength. A small part of the badge's weight. Found by its shape (nothing else in a row's slot is a glyph in a
  disc) and by the glyph, the darkest mark in its column; not by the disc, which stands 1.3:1 from the pane. The
  weakest place is the tab, where a 18 px disc sits beside a file icon of the same ink.
- **One gold.** The disc is one pigment (`#e6b450` light, `#ecbf63` dark; OKLCH 0.80 0.13 82 and 0.83 0.12 84)
  with the glyph in near-black on it in both schemes, and a hairline of its own shade so the disc keeps an edge on
  light glass. It is the only chroma on the page, so it is found before anything is read. Gold and not another
  hue: it is 33 degrees of hue and a clear step of lightness from the orange that was dropped (0.72 0.19 49) and
  further from the clay of today's app (0.67 0.13 39); it leaves the warm red to removed lines (12.7 item 4); it
  is the lamp of Paper's own night scene; amber is the old colour of "attention, not alarm". It is spent on the
  mark and nowhere else: Approve, Send, focus and the switches stay ink, because the accent says where you are
  needed and the ink says what you do about it. It costs Paper its claim to have no hue, and in light it is found
  by chroma, not by level (1.7:1 against the pane; 7:1 in dark).

Under both alternatives the capsule is clear glass and holds the same discs the rows do, so the mark is one object
everywhere and none of it is glass. That mends three things section 12 recorded. The mark is no longer a seed the
runtime draws, so it has no forbidden band and needs no second fill per scheme (12.7 item 2). A pale accent never
has to be a stroke, so it is never deepened to bronze (item 3). And the mark keeps its strength when the window
loses focus, where the ink capsule's seed receded to 1.4:1 in dark (12.6): a supervising app is looked at most
when it is not the front window.

**What I would choose: the gold.** The ink badge answers "is it findable" and fails "is it refined": the page's
darkest, heaviest objects are its status marks. The soft disc is refined and asks the eye to search. The gold is
the lightest thing that is still found at a glance, it gives the state a colour nothing else on the page uses, and
it is the one warm note in a hueless room. If the owner wants Paper strictly without hue, the ink badge stays the
honest choice and the soft disc is not strong enough to replace it.

Readings. The glyph against its own disc, where the script can see it (the capsule and the open list; in a row
and a tab the glyph sits under the hidden action it trades places with, and the same two colours meet there):

| glyph on its disc (light / dark) | Ink badge | Soft disc | One gold |
|---|---|---|---|
| at rest | 14.8 / 13.4 | 11.2 / 6.0 | 8.5 / 10.0 |
| strongest field, list open | 14.6 / 13.2 | 11.2 / 5.9 | 8.4 / 9.9 |
| receded window | 11.7 / 8.8 | 10.2 / 8.2 | 8.5 / 10.0 |

The disc against the surface it stands on, sampled from captures in the pane row and the tab: the ink badge about
15:1 by its tokens; the soft disc 1.28:1 in light and 1.38:1 in dark; the gold 1.7:1 in light and 6.6 to 7.1:1 in
dark. In a receded window the gold disc reads 8.4:1 on the dark pane and the soft disc is unchanged, where the ink
capsule fell to 1.4:1 against the field. Twenty routes, none under its floor; the lowest text line (4.88) is the
removed count under the open list's shadow, the same line as in 12.6.

### 13.4 Alignment

- **As it is.** The tab capsule starts on the column's left edge when the room allows; the waiting capsule and the
  side toggle stand together above the side column; the composer is the column's width; the column is 680 at most
  and the panes are whatever is left away from it (88 px at 1440). On Settings the tabs start 28 px left of the
  settings column, which is centred by a different rule.
- **On the reading column** (Open's rule, lifted from `open.css`: `--xo-colm`, `.xo-tabs`, `.xo-wait-slot`). The
  column is the join. The panes stand one derived room from it (62 px, the runtime's answer), so the column takes
  what they leave, up to Open's 744; the tabs start on its left edge; the waiting capsule ends on its right edge,
  a seam after the tabs (24 px in light and 25 in dark, also derived); the composer is its width. The capsule leaves the side column's
  group for one of its own (`xl-wait`), since it is now the tabs' neighbour. When the row is short the current tab
  keeps its title and the others thin out (Open's). On Settings the tabs start on the settings column.

What the rule argues: one edge on each side of what is read, and everything floating over the column hangs from
those two edges; the sessions that wait sit beside the tabs that show them. What it costs: a longer measure (732 px
at 1440 against 680, about eight more characters a line); a tighter row under about 1340 px wide, where the column
is what pays (572 at 1280, and the tabs truncate); the side toggle left alone in its corner; and one transient
finding when the knob itself is flipped (`group-proxy-overlap` between the tabs and the capsule for the length of
the tabs' slide; none at rest or when a pane is toggled).

**What I would choose: the column.** It replaces three alignments in the top row with one and fixes the Settings
tabs, and the wider column suits a transcript that is half code.

Readings (light / dark): session 5.35 / 5.07, at Vivid 5.38 / 5.01; from the top with a tool run open 5.45 /
5.13; settings at Vivid 5.04 / 5.35; with the waiting list open 5.38 / 5.01. In light the list now opens over the
column and no longer lays its shadow on the Changes module, so the lowest light line of 12.6 (the removed count at
4.88) does not occur in this position. Ten routes, none under its floor.

### 13.5 The right column's container

Its content is plain and will come from the app; the owner's note is that it should have a "sort of separate
Liquid Glass component floating feeling". The content and its order are the same in all three.

- **Four modules** (as it is). Four surfaces 12 px apart, each with its own shadow. The most literal "separate
  components", and the busiest: four rims, four shadows, the field's lines showing in three gaps, and thirteen
  glass surfaces at rest against the guideline's one to three.
- **One card** (Sheet's container, `sheet.css` `.xs-side`). One surface from under the top row to the window's
  bottom margin, the four sections on it parted by space. Calm, and ten surfaces instead of thirteen. It costs the
  floating: a pane as tall as the window, mirrored by the pane on the left, reads as a column of the layout, and
  its lower third is empty glass at this content.
- **Grows from a button** (Open's container, section 6 of its record). Closed, the column is the round glass
  button at the top right. Open, the same piece of glass has grown down and to the left into the card, as tall as
  what it holds and no taller, so its foot is free and the ground shows under it: that free edge is what reads as
  floating. The button does not move; the glass grows out around it, and it closes the card from the same spot.
  The room is made first (the main space gives way, the capsule steps left), then the card grows over 500 ms on a
  curve that leaves rest slowly, with its words arriving over the last half. The capsule stands 12 px beside the
  card as it stood 12 px above the modules; under the column rule it is on the column instead, which is where
  Open had it and where this form looks most at home.

How the third was built, and what it is not. Open drew this with the library's matched-geometry morph, whose
content lives inside the host. Layers' side surfaces are "an element in flow with a decorative surface beneath"
(section 3, item 6), so the card here is that: the element's own box grows by a CSS transition and the layer keeps
the glass under it frame by frame, as it already did for a tool run that opens. It is one registered surface for
the pair's whole life and nothing cross-fades. What that path costs: the glass can trail its box by one frame
(the runtime draws before it calls its frame listeners, and offers no hook before the draw; the layer now asks
for its own frame first, which puts it ahead when the runtime was idle, and the curve starts slowly so a frame is
a pixel or two where it would have been forty); the closed button has no press light, only the scale every plain
button has, because a decorative surface is not interactive; and its motion is a curve, not the runtime's spring.
The library's morph was not tried here: its closed size is measured once and its open box does not follow its
content (the library's own notes), and the root's shadows are off (section 3, item 5), so a morph would have
needed a CSS shadow that follows a box the library animates. Seen in motion at 1x in both directions and at rest
in both schemes; no diagnostic at rest, open, closed, or through two round trips in each scheme.

**What I would choose: the card that grows from its button**, read together with the column rule. The owner asked
for one floating component, and a surface with a free foot that comes out of its own control is that; the four
modules are four components, and the tall card is a column. If the real content is usually taller than the
window, the difference between the second and third positions is gone and the tall card is the honest one.

Readings (light / dark). One card: 5.35 / 5.08, at Vivid 5.38 / 5.02, receded 4.95 / 5.31. The grown card: 5.35 /
5.08, at Vivid 5.38 / 5.02, with the column rule 5.38 / 5.01, receded 4.95 / 5.31, with the waiting list open
5.38 in light. The words on the card are the page's ink, as on a module, and the lowest lines are the same ones
in all three containers. Sixteen routes, none under its floor.

Across this section: 74 routes on the new positions and 10 on the design as it stands, 8,670 gated readings, none
under its floor; the lowest text line on a new position is 4.88 and the lowest icon 3.19 (the pane's caret, in a
receded light window).

### 13.6 What changed in the code

- `meta.ts`: five knobs after Colour (`form`, `line`, `mark`, `align`, `side`), each with today's design first;
  notes rewritten.
- `paper.ts`: `paintPaper` takes an optional `Presence` (`sharp`, `soft`, each a share). The painter is split into
  the room (always painted), the form, and the grain. At full presence the form is painted by the same calls in
  the same order as before. At any other presence it is laid over the room from two kept layers (the form, and
  the form out of focus), painted a margin past the window so the blur does not thin at an edge.
- `paint.ts`: `paintField` passes presence through, and sizes the canvas only when its size changes.
- `Layers.tsx`: reads the five knobs; `Plane` shows a change of presence as a dissolve and tells both roots to read
  the field on every frame for that long; `data-line`, `data-needs`, `data-align`, `data-sideform` and the three
  `--xl-pin` variables on the root; the capsule in its own group under the column rule; the side toggle absent
  where the card is its own button; `--xl-seam` derived beside `--xl-room`. New export: the `SideForm` type.
- `Session.tsx`: `Waiting`'s `tint` is optional (none is clear glass with the runtime's ink); `Modules` takes
  optional `form` and `onToggle`, and its four sections are one list drawn as modules, as parts of `OneCard`, or
  as parts of `Growing`. Every export keeps its name, and every prop that existed keeps its meaning and default.
- `glass.tsx`: a layer asks for its next frame before it writes (the paragraph above).
- `layers.css`: the sans line; the two mark forms and the clear capsule; the column rule; the one card; the
  growing card and the capsule's place beside it. A default is the absence of an attribute, so a root that sets
  none of the new ones draws the design as it was.

Address aids are unchanged; `x=noside` shows the third container closed.

Captures of record, in `shots/layers/`, named by switch and position as the address names them:
`layers-<scene>[-scheme-dark]-form-recede.png` and `-form-home.png` (session, settings); `layers-home[-scheme-dark]-line-sans.png`
and `-line-serif.png`; `layers-session[-scheme-dark]-mark-soft.png` and `-mark-accent.png`, with the list open
(`-x-waiting`), in a receded window (`-pose-inactive`), and on New chat and Settings; `layers-session[-scheme-dark]-align-column.png`,
`layers-settings[-scheme-dark]-align-column.png`, and with a pane away (`-x-noside`, `-x-nopane`);
`layers-session[-scheme-dark]-side-card.png`, `-side-button.png`, closed (`-side-button-x-noside`) and with the
column rule (`-side-button-align-column`); the five picks together on all three scenes in both schemes
(`-form-recede-mark-accent-align-column-side-button`), and at 1280 by 800 and 1728 by 1117. The lifted positions
were laid beside their sources (`shots/open/open-session.png`, `open-session-side-away.png`,
`shots/sheet/sheet-session.png`): the top row and the grown pane stand as Open's do, with Layers' 296 px side width
making the column 732 where Open's was 740; the tall card runs to the window's bottom margin where Sheet's stopped
at its sheet, because here there is no sheet to stop at.

### 13.7 Not done, and what would be next

- The form's focus does not follow the pane or the composer; it is one state per scene. A form that came into
  focus only in the open margins was considered and not built: at 1440 the open margins are 88 px wide.
- The out-of-focus layers are repainted on every resize event. A real renderer would paint them at half size.
- The gold was chosen by eye against three neighbours at 2x in both schemes (a duller brass `#d9ac5e`, a paler straw
  `#e9c877`, a deeper amber `#dfa63a` that leans back toward the orange); it was not tested with people, and not
  checked under simulated colour-vision filters, where the disc would be a pale grey and the glyph would carry it.
- The growing card's height follows its content at once when the content changes while it is open; real lists
  that change length would want that height on a spring.
- Ten knobs. 12.7 item 8 said five was one too many; the five new ones are meant to be answered and removed.

## 14. Warmer Papers

Added 2026-11-14, on the owner's reaction to Paper: "two that survies is open and layer. but I'd make color more
warmer perhaps by mixing older orange?" Paper reads too neutral to them. Paper itself is unchanged and is still
the default; four warmer Papers stand beside it in the Colour switch, so the owner chooses by looking.

"Older orange" is read as `#fd780f`, the strong orange they used and dropped as a ground (OKLCH 0.72 0.19 49).
Three positions are built on it. It could also mean the terracotta of today's app (`#c9663f`, `#d97757`; hue 39
to 41), which they earlier asked to keep out, so a fourth takes its warmth from that and is named for it.

### 14.1 What mixing in orange can and cannot do here

Four facts from sections 7 and 12 decide the values, and one found here.

- **Light glass draws 0.90 to 0.99 whatever is under it** (12.7 item 1). By day the warmth cannot reach a pane or
  a block through the field; it shows in the room between surfaces and as a faint cast in the panes (over Warm
  paper's ground, chroma 0.025, the bodies were drawn at 0.013 to 0.018). A warmer Paper by day is a warmer room,
  not warmer glass.
- **The quietest text bounds the lightness of anything it can cross.** Captions and placeholders are the ink at
  70 % by day and 68 % at night. Composited over a flat colour they hold 4.5:1 only where that colour is 0.82 or
  lighter by day and 0.38 or darker at night, whatever its hue (computed for hues 40 to 55 at chroma 0 to 0.19; it
  moves by less than 0.01). `#fd780f` is 0.72. So the orange as given cannot be a broad area anywhere text can
  scroll, by day or by night; it can be a small mark, a light, or a tint of itself at 0.79 and up.
- **So every warm position keeps Paper's lightness, value for value, and changes only what has a hue.** The
  ground stays 0.914, the sheet's face 0.95, its underside 0.86 to 0.79, the floor shadow 0.53. The readings of
  every line are then Paper's own to within a tenth, and the room is the same room.
- **Dark glass turns the hue under it about ten degrees toward red** (12.6), and a saturated orange under it was
  drawn redder still and lifted the body toward the band where neither ink reads (the `orange` synthesis's
  finding). So the night oranges are kept deep (0.38 and under) and authored a few degrees yellow (hue 56 to 58
  for 49). The turn itself could not be observed here: at this depth no dark body drew more than 0.012 of chroma
  (over a field of 0.02 to 0.03 under its footprint), which is under what the script reads a hue from. At night,
  too, the warmth is in the room and at the foot of the glass, not in its body.
- **Found here: Paper's own night picture puts a caption under its floor at one scroll position.** Section 12
  measured the session at rest, from the top, and with things open, never mid-scroll. At `x=mid` in dark the
  caption "Key migration check and Load profile started working" lies across the sheet's lit face (0.49) and its
  icon across the bright edge (0.79): 3.87:1 and 3.47:1 at default strength with the form everywhere, 2.78 for the
  icon at Vivid. The four warm Papers set those two values at 0.36 and 0.66 at night, the only places they leave
  Paper's lightness, and hold their floors there. Paper was to stay as it is, so it still has the failure; the
  readings are in 15.3 and the mend is two numbers.

### 14.2 The positions

| position (`colour=`) | where the warmth sits | the mark |
|---|---|---|
| **Warm paper** (`warmpaper`) | In the paper itself: ground, sheet, shade and shadow carry the orange at low chroma. | The orange, as a disc |
| **Orange light** (`orangelight`) | In the light: Paper's materials unchanged, the orange caught in the leaf and laid on the floor. | Ink (Paper's) |
| **Orange underside** (`underside`) | In a second material: the sheet's reverse is the orange. | Ink (Paper's) |
| **Clay paper** (`claypaper`) | In the paper itself, with the warmth taken from today's terracotta instead. | The terracotta, as a disc |

**Warm paper.** The literal answer: the same still life with the old orange mixed into every material at low
strength. Each of Paper's values keeps its lightness and takes hue 58 to 68 at two to three times its chroma:
ground `#f0dfd1` (0.914 0.027 62) where Paper's is `#e8e1db` (0.914 0.011 63); the sheet's face `rgb(249 236 224)`,
its edge `rgb(253 247 241)`, its underside `rgb(228 204 182)` to `rgb(214 179 152)`, the floor shadow
`rgb(139 98 67)`. Night: ground `#1c150f` (0.202 0.016 60), a lamp of `rgb(255 206 152)`, underside
`rgb(58 45 34)` to `rgb(21 15 11)`. Ink `rgb(36 29 23)` and `rgb(236 224 212)`; shadow tint `110 66 30`. The
first build was a shade more chromatic and a few degrees redder (0.032 at hue 60) and read as peach, not as warm
paper; it was pulled back. Its mark is the one place the orange appears as itself: `#fd780f` on the disc of
section 13.3, with `#2a1300` on it, the same in both schemes, on a clear capsule. On a disc it never has to be a
15 px stroke, so it is never deepened to `#c84c00`, which is where the old orange turned into the clay the owner
ruled out (12.7 item 3). Approve, Send and focus stay ink.

**Orange light.** Nothing in the room is orange; the light is. Paper's ground, sheet and shade are untouched. By
day the leaf of glass holds an amber reflection (`rgb(255 172 98)` at 30 % where Paper's is white at 17 %), the
line of light inside its shadow is orange, and three soft pools lie on the floor: in the leaf's shadow, under the
fold where the composer stands, and faintly behind the leaf's body. At night the lamp is the orange
(`rgb(255 150 56)` at 20 %, hue 56 for the reason above) and the same pools glow at about half strength. The
pools are part of the form, so they go out of focus with it and are gone where it is. Every pool is capped at
42 % however far Field strength is turned, which keeps the floor under it at about 0.83 or lighter. Its mark is Paper's
ink: a mark in the light's own colour would be one more glow, and the gold of 13.3 is 30 degrees from it.

**Orange underside.** The orange as a material: the sheet is paper on its face and the old orange on its reverse,
and the arch shows the reverse. It runs from apricot near the floor (`rgb(251 196 153)`, 0.86 0.085 60) to
tangerine at the fold (`rgb(253 161 102)`, 0.79 0.15 52): the orange as far toward itself as Paper's own
underside lightness lets it go. The floor shadow takes its hue (`rgb(150 93 57)`) and the leaf a faint warm
reflection. At night it is an ember, `rgb(100 52 3)` to `rgb(41 17 1)` (0.38 to 0.21). This is the strongest of
the four and the only one where the orange is plainly an object. With orange in the room the mark cannot be
orange (12.3's reasoning for Blue hour, turned round), so it is ink.

**Clay paper.** Warm paper's construction at hue 39 to 46: ground `#f5ddd3` (0.914 0.030 42) and `#1d1411`, the
sheet and shade in the same family, shadow tint `112 60 44`. Its mark is today's pair as the app has it: `#c9663f`
by day with paper on it (3.7:1 as a glyph), `#d97757` at night with ink on it (5.4:1). It is here so that the
owner can say "not that one" by looking, or the opposite.

The Mark switch (section 13.3) works under Orange light and Orange underside, whose mark is Paper's ink; Warm
paper and Clay paper bring their own pigment, so it does not apply to them. The other two Paper switches (the
painted form, the New chat line) work under all four.

### 14.3 Rejected

- **The orange underside at `#fd780f` itself.** At 0.72 a caption that scrolls across it reads 3.7:1 (computed).
  The tint at 0.79 is the deepest that holds.
- **An orange glass leaf** (the paper passing into amber glass). Considered, not built: it is Orange light with
  the cause removed, the same tint on the same floor, and a tinted object where the picture's point was that the
  glass is clear.
- **Tinting the app's own glass orange.** Considered, not built: one tinted control per view is the material's
  ration, and by day a tint on glass this size is drawn as a fill.
- **A mark in gold on Warm paper.** Considered, not built: twenty degrees from the room's own hue and nearly its
  lightness by day.
- **The orange as the ground.** That is the `orange` synthesis and the Orange colouring, both already in the lab.

### 14.4 Which to show first, readings, and what changed in the code

**Warm paper first.** It is what the owner's sentence says: the colour of Paper made warmer by mixing the old
orange in, with the orange itself back in one small place. Orange underside second: it is the only one where the
orange is an object, and New chat under it is the most changed page of the four. Orange light is the gentlest and
depends on the form being there. Clay paper is shown so it can be ruled in or out.

Readings for all four, in both schemes, are in 15.3, taken under the defaults the owner has since chosen. None of
the four has a line under its floor in 22 routes each.

Code. `colour.ts`: four colourings, reachable through `COLOURINGS` and `colouringOf` as the first eight are; the
optional `Field.light` (a colouring's own light for the still life) and `Colouring.pin` (a pigment for the mark
on a clear capsule). `paper.ts`: the light record is exported as `PaperLight`, with Paper's two as `PAPER_DAY`
and `PAPER_NIGHT`; `paintPaper` takes an optional light as its last parameter; a light may carry `glows`. Every
earlier export and parameter is as it was. `paint.ts` passes the light through. `Layers.tsx`: the Paper switches
are consulted for every colouring whose field is the still life (`data-paper` on the root beside `data-colour`),
and a colouring with a `pin` settles its own mark. `layers.css`: the rules that named `[data-colour='paper']`
name the family.

## 15. The owner's answers, and the design at rest

Added 2026-11-14. The owner answered four of section 13's five calls, and their answers are now the design at
rest. The switches stay, with every earlier position still reachable; what changed is which chip is the default in
`meta.ts` and what a missing knob means in `Layers.tsx`.

| call | the owner's answer | default now | was |
|---|---|---|---|
| Painted form | "Blurred behind text" | Out of focus where you work (`form=recede`) | Everywhere |
| Alignment | "Yes, line up" | On the reading column (`align=column`) | As it was (`align=layers`) |
| Right column | "Button that opens" | Grows from a button (`side=button`) | Four modules |
| New chat line | "i'd use from Quiet. the one that's used for layer is too round", with a picture of Quiet's message bubble | Sans (`line=sans`), and the Typeface default is System (`face=system`) | Serif; Figtree |
| "Needs you" mark | open; it waits for the colour | Ink badge (unchanged) | |

The fourth answer is wider than the question. Quiet's face is the system face, so what was refused is Figtree, for
the whole interface and not only for that line: the Typeface knob's default is System, and the New chat line is set
in that same sans. Section 13's sentence "its first position is the design as it stood and is the default" is true
of the first half only from here on; section 1's Type line and section 6's "Figtree and Geist Mono by default"
read "the system face and its mono". Figtree and Geist remain on the knob.

### 15.1 What had been tuned to Figtree

The page was looked at again in all three scenes and both schemes under the new defaults, since no earlier capture
showed this combination. One thing had been fitted to Figtree's widths, and it brought a second with it:

- **The tab row.** The system face sets the four tab titles about 5 px wider apiece (22 px in all). Under the
  column rule the row at 1440 had 16 px to spare with Figtree; with the system face three titles lost their last
  letter to an ellipsis. And once the tabs came that near the capsule the runtime's own check reported the pair
  (`group-proxy-overlap` at 26 px apart), although 24 px was the room it had derived for them; forced apart in
  steps, the pair is clean from 30. So the seam the layout spends is the derived answer and a quarter more (30 px
  by day, 32 at night), and under the system face a tab's trailing padding is 9 px where it was 13. The row is
  then 614 px of tabs, 34 px of air and the 84 px capsule in a 732 px column, with every title whole and no
  finding at rest or through two round trips of the side card.
- **The New chat line.** 13.2's sans (420, 33/42) was drawn in Figtree. In the system face it keeps its size and
  weight and is tracked at −0.02em where Figtree took −0.024em. The serif is one chip away.

Nothing else moved: rows are 34 px, prose 15/24, the settings column 620, and the system face's own weight steps
(400, 500, 600; section 6) were already designed for.

### 15.2 A line under its floor in Paper's night picture

Measuring at a scroll position section 12 never used (`x=mid`) found it, and it is in the design at rest. In dark,
the caption "Key migration check and Load profile started working" crosses the sheet's lit face:

| Paper, dark, mid-scroll | caption (floor 4.5) | its icon (floor 3) |
|---|---|---|
| form everywhere, default strength | 3.87 | 3.47 |
| form everywhere, Vivid | 3.69 | 2.78 to 3.39 over three runs |
| form out of focus (the default now), default strength | 4.16 | 3.96 |
| form out of focus, Vivid | 3.92 | 3.57 |
| plain ground, Vivid | 5.32 lowest line of the route | 4.17 |

It is Paper's, not the new defaults': the lit face is 0.49 in lightness and the quietest text needs 0.38 or
darker behind it (14.1). The four warmer Papers set the night face at 0.36 and its edge at 0.66 and hold their
floors at the same position. Paper was to stay as the owner chose it until they pick a colour, so the two values
were not changed there; if Paper is kept, they should be.

### 15.3 Readings under the new defaults

`measure.mjs`, floors and method as in section 7; every route carries the new defaults unless it names another
position. Eleven routes per scheme and colouring: the session at default strength; then at Vivid the session at
rest, with the waiting list open, mid-scroll, and receded; Settings; New chat; the session mid-scroll with the form
everywhere; and the plain ground of section 16 on the session mid-scroll, Settings and New chat.

| colouring | scheme | lowest text at the defaults | mid-scroll | mid-scroll, form everywhere | plain ground | lowest icon | bodies | least apart from the field: defaults / plain | under its floor |
|---|---|---|---|---|---|---|---|---|---|
| Paper | light | 4.95 (removed count) | 5.37 | 5.37 | 5.00 | 3.20 | 0.90 to 0.99 | 0.039 / 0.052 | 0 of 1083 |
| Paper | dark | 3.92 (caption on the field) | 3.92 | 3.69 | 5.32 | 3.39 | 0.15 to 0.31 | 0.025 / 0.092 | 2 of 1083 |
| Warm paper | light | 4.94 (removed count) | 5.42 | 5.42 | 5.04 | 3.20 | 0.90 to 0.99 | 0.045 / 0.052 | 0 of 1083 |
| Warm paper | dark | 5.04 (caption on the field) | 5.04 | 5.01 | 5.30 | 4.07 | 0.15 to 0.31 | 0.040 / 0.092 | 0 of 1083 |
| Orange light | light | 4.83 (removed count) | 5.35 | 5.35 | 5.07 | 3.20 | 0.90 to 0.99 | 0.041 / 0.051 | 0 of 1083 |
| Orange light | dark | 4.98 (caption on the field) | 4.98 | 4.93 | 5.35 | 4.03 | 0.15 to 0.32 | 0.040 / 0.098 | 0 of 1083 |
| Orange underside | light | 4.95 (removed count) | 5.37 | 5.37 | 5.07 | 3.20 | 0.90 to 0.99 | 0.039 / 0.050 | 0 of 1083 |
| Orange underside | dark | 5.03 (caption on the field) | 5.03 | 4.99 | 5.35 | 4.03 | 0.15 to 0.31 | 0.037 / 0.102 | 0 of 1083 |
| Clay paper | light | 4.91 (removed count) | 5.40 | 5.40 | 5.02 | 3.20 | 0.90 to 0.99 | 0.044 / 0.053 | 0 of 1083 |
| Clay paper | dark | 5.06 (caption on the field) | 5.06 | 5.03 | 5.27 | 4.08 | 0.15 to 0.31 | 0.041 / 0.094 | 0 of 1083 |

110 routes, 10,830 gated readings; two are under their floor, and both are the one caption of 15.2. Every light
row's lowest line is the removed count on the side card in a receded window, as in 13.5; every warm dark row's is
a caption on the field mid-scroll, which is the line the corrected night values were set for. "Bodies" is the
drawn level of every glass body in an active window (the ink's dead band is 0.39 to 0.49; nothing is near it).
"Least apart" is the smallest distance in OKLab between a body and the field painted under it, in an active
window: the measure of how well glass stands off its ground.

One route was run twice. The first session route of Warm paper was captured while the side card was still growing
(its words at part opacity, 44 lines "under"); run again it reads 5.40 with none under. The measuring script waits
a fixed time, and the grown card arrives 660 ms after the page; on a loaded machine that was not always enough.

Captures of record under the new defaults, in `shots/layers/`: `layers-<scene>[-scheme-dark]-defaults.png` for
Paper, and `layers-<scene>[-scheme-dark]-colour-<id>.png` for each warmer Paper (session, home, settings), with
`-form-everywhere` beside them for the whole picture and `-form-plain` for the plain ground.

## 16. The plain ground

Added 2026-11-14. Asked what Open has that they want to keep, the owner chose only "Plain ground": no drawing in
the background, only light gathered under the glass controls. They did not choose Open's calmer transcript. So
what is left between the two finalists is mostly the ground, and it is easiest to judge inside one design: the
Painted form switch has a fourth position, **None: plain ground** (`form=plain`). The default stays the blurred
drawing, as they answered.

### 16.1 What it is

No drawing on any page, New chat included. The ground is one plain colour, the colouring's own, with the paper's
grain (a surface, not a drawing). The only light and shade on it is what gathers where glass stands.

- **Under the glass that stays put**, the gathering is painted into the field, so the glass stands over it and
  takes it up: the pane, the side card or modules, the composer, and more faintly the tab capsule, the waiting
  capsule and the small round controls. The method is Open's (`open/field.ts`): each gathering is its surface's
  own shape, grown by three tenths of its reach and blurred by four tenths, so it ends a hand's width past the
  glass. So are Open's shares of the pane's strength: the side card 0.86, the composer 0.8, the tabs 0.4 (Open
  0.36, where text passes under them; here nothing does). A small control cannot spend a large reach, so reach is
  capped by the control's own span. Each pool deepens toward its foot, so a tall pane does not stand over one
  flat tone.
- **Under a block of the transcript**, which travels over a still field, the gathering travels with it: a second,
  wider shadow under the block in the gathering's own colour (CSS, as every exterior shadow in Layers is). The
  glass of a block does not take it up; it shows around the block's foot.
- **What gathers is the colouring's.** Under Paper by day it is shade, not light: Paper's own floor shadow
  (`rgb(126 104 84)`) at 26 % under the pane. Light glass on ivory is declared by the soft shadow it lays on the
  floor, as in the picture Paper was built from, and a pool lighter than the ground would take away the one thing
  the glass differs from. At night it is the lamp (`rgb(255 224 188)` at 15 %), which dark glass takes into its
  body. A warmer Paper names its own, and here that is where its warmth sits: Warm paper and Clay paper their
  warmer shadow and lamp; Orange light the orange (`rgb(253 136 44)` at 20 % by day, `rgb(255 150 56)` at 17 % at
  night); Orange underside, which has no sheet left to show a reverse, its tangerine (`rgb(253 161 102)` at 28 %)
  and its ember.
- **It follows the glass.** While a pane slides, the side card grows or a scene arrives, the field is repainted
  from where each piece of glass stands on that frame, for a second and a half, and both glass roots read it for
  that long. The pools are soft, so they are painted on a canvas a quarter of the window's size and scaled up. At
  rest nothing is repainted.
- **Strength is capped** at 30 % by day and 22 % at night, whatever Field strength says: under the cap the ground
  beside a control stays where the quietest text holds its floor.

### 16.2 What it costs Layers, and what it gains

Costs:

- **The picture.** Paper was chosen as a still life; here it is an ivory ground with shade on it. The form coming
  into focus on New chat, the one moment the picture had, is gone with it, and New chat is a composer on a plain
  page.
- **What the glass stands on.** Section 12.7 item 1: light glass is nearly white whatever is under it, so the
  field showed between surfaces and gave them a tone to differ from. The gatherings restore that under the fixed
  glass, and measurably (16.3). Under a block they cannot: the block's glass is over plain ground, a body of 0.95
  and up on 0.91, and its rim, its own shadow and the travelling pool are all that declare it. Paper's lower
  ground is what keeps this from being round 1's white on white; on `#faf9f5` it would be.
- **Something to bend.** The glass guideline asks for structure under glass. A soft pool and grain is the least
  there can be: the lens has an edge of tone to bend at each control's rim and nothing inside.
- **The warm colourings converge.** Without the sheet, Orange light and Orange underside differ only in how
  strong and how red their pools are, and Warm paper and Clay paper only in their ground.
- **A repaint while things move**, where the picture was painted once.

Gains:

- **Nothing behind a word, anywhere.** No line and no tone of a drawing under prose or a settings row; the
  failure of 15.2 cannot occur, in any colouring.
- **No composition to keep.** 12.7 item 7 (a picture has a composition, and the layout can move under it) is gone
  entirely: a gathering is wherever its glass is, at any window size, with either pane away.
- **Glass stands further from its ground where it matters most**: the pane, the card and the composer over their
  own pools (16.3).
- **It is Open's ground**, so the choice between the two finalists that is left after this is the transcript.

### 16.3 Readings

Vivid, both schemes, on the session mid-scroll, Settings and New chat (the last three text columns of 15.3 give
the lowest line per colouring: 5.00 to 5.15 by day, a caption beside the composer's pool; 5.27 to 5.35 at night).
No line is under its floor on the plain ground in any colouring.

How far glass stands from the field under it (least distance in OKLab over all bodies, active window):

| | the drawing out of focus | the plain ground |
|---|---|---|
| Paper, day: session / Settings / New chat | 0.040 / 0.039 / 0.049 | 0.052 / 0.069 / 0.089 |
| Paper, night | 0.025 to 0.068 | 0.092 to 0.094 |
| warmer Papers, day | 0.039 to 0.052 | 0.050 to 0.091 |
| warmer Papers, night | 0.037 to 0.084 | 0.092 to 0.104 |

By day the gain is the shade under each control. At night it is the reverse of what was first built: with the
lamp's light under the glass a body stood 0.009 to 0.029 from its ground (the pool lifted the floor to the glass's
own level), against 0.06 to 0.08 with no pool at all. So at night the light is kept out from under each piece of
glass and shows around its foot, and the bodies then stand 0.092 and more from the floor, further than in any
other position of the switch.

Diagnostics: none at rest in either scheme, and none through two round trips of the side card on the plain ground
at night. Seen at 1440 by 900 in both schemes under Paper and all four warmer Papers, with the side card closed
and with the pane away; at 1280 by 800 under Paper.

### 16.4 What changed in the code

- `plain.ts` (new): the painter (`paintPlain`), what gathers (`gatherOf`), and the `Gather` shape.
- `paint.ts`: `paintField` takes an optional list of gatherings; given one, a picture field paints the plain ground.
- `paper.ts`: `PaperLight.gather`, optional, for a colouring that names what gathers.
- `Layers.tsx`: `gatherings()` reads the glass from the page; `Plane` follows it for 1.5 s after anything moves and
  when a bar changes size; `data-ground='plain'` and the two `--xl-gather` variables on the root.
- `layers.css`: the travelling pool under a block.
- `meta.ts`: the fourth chip of Painted form.

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
- **A colouring is one record, and Paper is the one to ship.** The theme carries what `colour.ts` carries: a
  field, the ink, the shadows' tint, the accent with the ink on it and its stroke, focus, the mark's form, and
  the ground. Under Paper the app's grounds become `#e8e1db` and `#181614` (today `#faf9f6` and `#131313`), the
  accent becomes the ink, and a waiting row carries a badge. The terracotta goes with the orange.
- **The picture is code, not an asset.** `paper.ts` paints it at the window's size and pixel ratio on every
  resize and scheme change (a few hundred canvas operations, several of them blurred; measure it on a resize drag,
  and paint to a smaller canvas and scale if it costs a frame). Its composition is tied to the shell's geometry
  (the fold under the composer, the leaf behind the side column), so the two change together.
- **The serif**, if the owner keeps it: Newsreader's latin optical-size file bundled locally, used for the
  new-chat line and nothing else, with the system serif behind it for Korean.
- **The clearer glass**, if it is wanted for Paper later, needs `@vitreajs/vitrea-web` as a direct dependency:
  the React package names the material documents and exports none of them.
- **The five calls, once answered** (section 13). An out-of-focus form needs the field kept as layers (the room, the
  form, the form out of focus), painted at half size and composited on a change of scene, never per frame at rest.
  The mark as a disc is a token pair (`pin`, `on-pin`) and a clear capsule; nothing of it is a glass tint. The
  column rule is three variables (the column, the capsule's right edge, the tabs' right limit) fed by the derived
  room and seam, with the capsule in a group of its own. The grown card is one element in flow whose box
  transitions, with its height fed by its content's measured height and capped at the window's.
- **The plain ground, if it is chosen** (section 16). The field becomes a quarter-size canvas of pools placed from
  the shell's own boxes (pane, side surface, composer, bars), repainted when one of them moves; the picture, its
  composition and its out-of-focus layers go. Each transcript row that stands on glass carries the travelling pool
  as a second shadow. At night the pools are kept out from under the glass.
- **A warmer Paper, if one is chosen** (section 14). It is a light record beside the colouring (the values the
  painter reads) and, for two of them, a pigment for the mark; the night values of the sheet's face and edge
  (0.36, 0.66) belong in Paper too if Paper is kept.
- **Measurement in CI.** `measure.mjs` should run against real content in both schemes before a field or a ground
  is changed: on this design a palette change is a legibility change.
