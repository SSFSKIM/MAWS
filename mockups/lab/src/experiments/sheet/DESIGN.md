# Sheet

Design record for the round 2 synthesis `sheet` (order 1). Values live in `sheet.css` and `paint.ts`; this file
says where each part came from, what changed when the parts met, and what the glass runtime reported.

## 0. Thesis

Field's structure, kept whole: a warm colour field runs under the entire window and the transcript is read on one
opaque rounded sheet. Everything that is a control is glass standing on the field around that sheet: the left pane,
a right pane, the tab capsule and the composer. The sheet is only the reading surface. Glass never sits on the
sheet, because there it would have only the sheet behind it; what opens over the sheet is paper.

If a decision is ever ambiguous: glass on the field, paper on the sheet, and the colour goes where the glass is.

## 1. Stance

This is a synthesis, so no sampler was run and no new stance derived: the owner's choices are the brief. The lines
below are read off the experiments the parts came from.

| line | position | from, and why it holds here |
|---|---|---|
| Density | standard: 34 px rows, 680 px measure, 15/24 prose | Quiet. Many sessions are scanned, one is read at length. |
| Criticality | consequential | An approval pushes code: it is never hue alone (a hand, a card with the command, a labelled button). |
| Energy | quiet | The agents are the busy part. Nothing moves at rest except a breathing dot and a spinner, which are state. |
| Type | one neutral sans and its mono; no serif | The owner rejected Quiet's serif. The face is a knob (Figtree, Geist, system); sizes do not change with it. |
| Material | glass over a painted plane for controls; printed paper for reading | Field's two-surface model, with the control layer widened from one pane to five surfaces. |
| Colour | restrained on the sheet, committed in the field | Field. The field is the only chromatic surface. |
| Accent job | "it is your move", and Send once there is text | Quiet. `#FD780F` as a fill; deeper steps of the hue for marks in light. |
| Ground | both schemes designed, neither secondary | The owner uses both. The sheet takes the owner's ground candidates (knob). |
| Temperature | warm, carried by the field | Field. The sheet is white or `#faf9f5`, never a cream band of its own. |

Signature: the composer on its pool of colour. The one mass of the field that is not fixed follows the composer, so
on a new chat the colour gathers in the middle of the window under a single piece of glass.

## 2. Parts: where each came from and what changed

| part | lifted from | changed here, and why |
|---|---|---|
| The field | Field `paint.ts` | Masses may be wider than tall. The right edge got its own three masses (it is now a pane's ground, not a frame). A low amber band runs along the top so the tab capsule stands over colour. The pool under the composer is new (see 3.2). |
| Left pane: the surface | Field (`Pane`, 272 wide, radius 20, thickness 8, 8 px from the window edge, texture path) | Unchanged. The level under its own box is now declared (Windows' method) instead of left to the whole painting's average. |
| Left pane: the content | Quiet `Sidebar.tsx` (title-only 34 px rows, the trailing slot that swaps the state glyph for the row's actions, the card that follows the pointer, 12 px group labels, usage as two rings, the settings index with its back row) | Fills are Field's lifts of light, not Quiet's ink washes: ink at 7.5 % on a pane tinted by a dusk reads as dirt. Ink is the runtime's. Row radius 12 (the pane's 20 minus its 8 inset). |
| State glyphs | Quiet `glyphs.tsx` | The orange mark is deepened once more on the light pane (`#c95404`), because the pane behind it is tinted, not white. |
| Tab capsule | Instrument (one glass capsule 36 tall, tabs as fills at radius 15 three pixels in, the current tab an ink wash at 10 %, 13 px medium, `useGlassPress`) | It stands on the field above the sheet (texture path), not over the transcript (DOM path): nothing passes under it. Its state marks are Quiet's glyphs, and Quiet's glyph-to-close exchange is added, so the window has one state vocabulary. |
| Composer: contents | Quiet (`Composer`: queued message as a token inside, one model chip, the context ring, a button that is a stop square while a turn runs and an orange arrow once there is text) | Every fill is a lift on glass; the button is solid ink. |
| Composer: the surface | Windows (glass, outside the reading surface, over colour); radius 26 from Quiet and Instrument | It leaves the sheet and sits below it on the field. Its width is the reading measure plus its own padding, so its text starts where the prose starts. |
| Transcript | Quiet `Session.tsx` (bubble, captions, ring cards, diff, running command) | Prose set in the interface face at 15/24 (Quiet's own sans setting); the serif is gone everywhere. |
| Tool-run summary and block | Quiet (the pill caption with chevron and duration; the ringed card of calls) | Unchanged, and not glass (see 3.6). |
| Right pane: the surface | Windows (a rounded glass pane on the texture path, sliding with the layout) | Radius 20 and the 8 px margin of the left pane. It is as tall as the sheet, not the window (see 3.4). |
| Right pane: the content | Quiet `Aside` (four plain lists) | The owner said the app's own side column will be used and not to spend effort here, so Desktop's richer column was not brought in. Diff counts take the ink on glass. |
| Approval | Quiet (a capsule of glyphs at the top right, one per waiting session, opening a list with the approval answerable in place; the card from the waiting sidebar row) | The capsule is glass with the one tint; the list and the card are paper. Answering sends the session back to work and removes its orange everywhere. |
| New chat | Quiet's layout (a line, the composer, where it runs) on Windows' material | No sheet at all (see 3.3). Folder and branch ride inside the composer. |
| Settings: the page | Quiet (the pane becomes the index with a back row, a 620 px column, 54 px rows, hairlines, 20/28 titles, the sentence in the right margin, the path cut to its version) | Unfolded: lists are on the page. |
| Settings: the controls | Instrument (pills with a check that grows in, a switch and a segmented thumb on a spring, a filled input, capsule buttons, a select that opens a glass platter, the Settings tab in the capsule) | Laid in Quiet's rows. A button keeps its label on the left, as Quiet has it. |
| Overlays | Quiet `overlay.tsx` (`Pop`, `Fold`) | The side card starts clear of the pane's edge, on the sheet. |
| Pane toggles | Quiet's position beside the traffic lights; Instrument's and Windows' small glass capsule | See 3.5. |

## 3. Conflicts between parts, and how each was settled

1. **Where the sheet stands in depth.** Field stacked its sheet above the glass so the pane's shadow never touched
   the page. Here four pieces of glass surround the sheet and the owner asked that the right one feel like it
   floats, so the sheet lies under the glass planes and their shadows fall on its edges. Field's clean edge gave way.
2. **A still field against a composer that wants colour under it.** Field's rule was that the painting never
   changes in use. The owner liked the composer over gathered colour (Windows), and the composer is in a different
   place in each scene. Settled: every mass is still except one pool, which takes its position from the composer
   and is repainted over 520 ms while the composer travels; it has no weight on the settings page, where there is
   no composer. Field's stillness gave way for that one mass. Its other rule held: nothing in the field means
   anything.
3. **New chat on a structure whose only non-glass surface is for reading.** With nothing to read there is no sheet:
   the line sits on the field and the composer is the one object. Quiet's row of folder and branch chips under the
   composer gave way, since a text chip on bare field is a control that is not glass and a second glass capsule
   ten pixels under the composer breaks the group gap. The two chips ride in the composer's own row on that scene.
4. **A right pane that should float, beside a left pane that is a column.** Two full-height panes read as two
   columns. The right pane is therefore a card exactly as tall as the sheet: it starts under the top row and ends
   where the sheet ends, so the field is open on all four of its sides and the bottom band under it is empty
   colour. It gives up about 180 px of height for that.
5. **Where a pane's toggle lives.** Quiet's toggle sits beside the traffic lights, which here is on the pane, and a
   glass control cannot sit on glass. The left toggle is one host in the overlay plane, absent (no material, a
   plain button with a fill) while the pane is under it and materialised into a 32 px capsule when the pane leaves.
   The right toggle stands in the top row as glass at all times, because the right pane starts below that row.
6. **The owner's suggestion of glass tool blocks.** Not taken in this synthesis. A block on the sheet has only the
   sheet behind it, and round 1 found glass over a white ground nearly invisible. The blocks stay as Quiet drew
   them: a caption that opens a card drawn as a 0.5 px ring.
7. **Two kinds of menu.** Everything Quiet opens (row menu, side card, waiting list, model menu, usage) is paper.
   The select on the settings page is Instrument's glass platter, kept because the owner named Instrument's glass
   there and a platter over rows is the material's legitimate case. In light it is close to invisible (white glass
   over a white sheet); in dark it reads. Both kinds are on screen so they can be compared.
8. **Quiet's ink levels on glass.** Quiet's muted text is ink at 62 % of a known ground. On a pane the ground is
   whatever the field is, so the lower levels are authored from the runtime's primary: 82 % and 70 % in light,
   92 % and 84 % in dark (70 % measured 4.1 on the dark pane at Vivid). The steps between unread, normal and idle
   rows are smaller than Quiet's, most of all in dark.
9. **The selected row in dark.** Field's lift of 15 % put the row's body at 0.40 to 0.41, inside the band where
   neither ink carries text. It is 11.5 %.
10. **The waiting capsule.** Quiet's is a soft orange fill with orange glyphs. As glass it takes the page's one
    tint (`rgb(253 120 15 / 30%)`) and its glyphs take a deeper step (`#8f3800` light, `#ffe1c4` dark).
11. **One button shape.** Quiet's buttons were 11 px squircles and Instrument's were capsules. Buttons, pills,
    switches, segmented controls and the select are capsules everywhere, the card's Deny and Approve included,
    to agree with the glass family. Captions, rows and cards inside the sheet keep Quiet's ladder (11 / 18 / 22).
12. **Group spacing.** The library asks for about 65 px between window-sized groups in one plane. The panes are in
    the base plane, far apart with the sheet between them; the top row and the composer are in the overlay plane,
    spaced by the gap the runtime derives for capsules (`useGlassSamplingGap`: 24 px light, 25 px dark, read as
    `--xs-og`). Every group samples the field texture, never another group's pixels. Reported overlaps: none.

## 4. Glass inventory

```
register: instrument by job (every surface is navigation, a session's tools, or a control), composed around one
  opaque reading surface on a plane the app paints.
plane: `xs-plane`, one canvas fixed to the window, handed to the root as the texture `xs-field`. Broad frequency:
  eight fixed masses and a pool of two. Fine frequency: 1 px contours, the level sets of the same masses, painted
  into the canvas.
family: thickness 8 everywhere. Panes radius 20; composer 26; capsules at span 36 and 32; the settings platter 20.
  Anchor: the window corner at an 8 px margin. Rows on a pane 12; fills in the tab capsule 15 at a 3 px inset.
tint: one, on the waiting capsule.
scheme and pose: the root's scheme follows the lab's; window activation is left on auto.
```

| surface | role | path | plane | shape | what is under it |
|---|---|---|---|---|---|
| Left pane | navigation | vitrea, texture | base | radius 20, 272 wide | the dusk: amber, orange, coral, plum |
| Right pane | a session's tools | vitrea, texture | base | radius 20, 296 wide, as tall as the sheet | amber, rose |
| Tab capsule | control | vitrea, texture | overlay | capsule, 36 | the amber top band |
| Waiting capsule | control, tinted | vitrea, texture | overlay | capsule, 36 | the top band |
| Left toggle | control | vitrea, texture | overlay | capsule, 32; present only while the left pane is away | the top band |
| Right toggle | control | vitrea, texture | overlay | capsule, 32 | the top band |
| Composer | control | vitrea, texture | overlay | radius 26, about 91 to 130 tall | the pool |
| Select platter (settings) | platter | vitrea, DOM path with a declared level | overlay | radius 20 | the sheet and its rows |
| Sheet, cards, bubbles | content | opaque | below the planes | squircle 26 / 18 / 22 | - |
| Row menu, side card, waiting list, model menu, usage, tooltips | paper overlay | opaque, raised | above the planes | squircle 14 | - |

Nothing was drawn with a CSS backdrop blur: all eight glass surfaces went through the library.

What the runtime reported (1440×900, DPR 2, both schemes): all seven texture groups `webgpu`, sampling
`gpu-texture`, refraction `true`, analysis `exact`, health `ok`. The select's groups `webgpu`, `css-backdrop`,
refraction `approximate`, analysis `hint`. Dev-mode diagnostics: zero on every captured route. Asked for the CSS
tier on purpose (`x=css`): every group `css`, refraction `none`, `cssBody` `collapsed`; it is the same design, as
round 1 found.

Laws of the glass guideline this structure bends, and what it costs:

- **Glass over a field that has no job.** The field is ambience and nothing passes under any surface, so the
  transparency preserves no context. This is Field's bend, now across five surfaces instead of one.
- **Content reaches the edges and controls float over it.** Here controls stand beside the content. The reading
  surface is never under glass, which is what keeps it readable, and it is also why the lens has nothing to do.
- **A surface carries one short line.** Both panes carry lists of labels. All of it is measured below.
- **No motion of the page's own.** Hosts slide on CSS (460 ms, one curve) with the root asked to re-measure every
  frame; the field's pool is repainted while the composer travels.
- **Declared levels.** Each group's level is re-read after a layout change has landed, not during the 460 ms of
  travel.
- Not verified: the receded pose (a capture after a blur event looked the same as the active one), Reduce
  Transparency and Increase Contrast. Forced colours was looked at: panels with system borders, structure intact;
  the absent left toggle draws its ring on the pane there. No native comparison was made; the nearest Apple
  surface is a macOS 27 window with a sidebar and inspector over a tinted wallpaper.

### Contrast, read on rendered pixels

Sixteen routes (session, new chat and settings; Whisper, Warm and Vivid; both panes away at the widest frame;
Figtree), each line's own ink composited over the pixels behind it with the text hidden, tenth-percentile pixel.
Floors 4.5 for text and 3 for icons and marks. Nothing read under its floor.

| line | light | dark |
|---|---|---|
| pane row title | 5.2 to 7.7 | 4.7 to 6.4 |
| pane group label | 5.2 to 5.4 | 5.1 to 6.6 |
| pane icons | 5.2 to 7.7 | 3.7 to 6.6 |
| needs-you glyph on the pane | 3.6 to 4.1 | 3.9 to 5.3 |
| tab title | 7.8 to 8.0 | 5.4 to 6.5 |
| tab glyph | 3.9 to 4.1 | 4.1 to 4.9 |
| waiting glyphs on the tint | 5.1 to 5.3 | 4.5 to 6.0 |
| composer placeholder, chips | 5.1 to 5.4 | 5.0 to 6.6 |
| queued message | 7.9 to 8.2 | 4.8 to 6.2 |
| right pane text, labels, counts | 5.3 to 5.5 | 6.5 to 8.0 |
| the new-chat line, on the bare field | 10.2 to 11.6 | 10.3 to 12.2 |

Bodies as drawn (encoded level): light panes and composer 0.89 to 0.98; dark panes 0.13 to 0.29, the dark
selected row up to 0.38, the dark composer 0.20 to 0.30. The dark pool was deepened twice to keep the composer
there: at its first strength the composer's body read 0.37 at Vivid and its placeholder 3.35. Not measured: text
on the settings platter, text that appears on hover, frames during a transition, the 1280 and 1728 sizes.

## 5. Tokens

| role | light | dark |
|---|---|---|
| sheet (knob, paired) | `#ffffff` · `#faf9f5` | `#191919` · `#191c19` · `#1f1f1f` · `#000000` |
| ink | `#1b1a17` | `#f4f2ed` |
| text / secondary / muted / faint on the sheet | ink, 76 %, 62 %, 42 % (marks only) | 93 %, 74 %, 58 %, 40 % |
| hairline / strong | ink 9 % / 16 % | 10 % / 16 % |
| hover / selected / well on the sheet | ink 4.5 % / 7.5 % / 5.5 % | 6 % / 10 % / 7.5 % |
| ink on glass: primary / second / third | the runtime's, 82 %, 70 % | the runtime's, 92 %, 84 % |
| lift on glass: hover / current / well | white 42 % / 78 % / 50 % | white 7 % / 11.5 % / 8 % |
| accent fill, text on it | `#fd780f`, `#2a1300` | same |
| accent mark: on the sheet / on a pane / on the tint | `#d95f06` / `#c95404` / `#8f3800` | `#fd780f` / `#ff8a2b` / `#ffe1c4` |
| added / removed | `#23794a` / `#c0392b` | `#6fcf97` / `#f08a7e` |
| field base | `#f1ede7` | `#0e0d0c` |

Field: Whisper 0.14, Soft 0.36, Warm 0.64 (default), Vivid 1, as a gain on every mass.

Type: 14/20 interface; 13 tabs, captions and the right pane; 12 group labels; 15/24 prose; 15/22 the person's
message and the composer; 20/28 semibold section titles; 27/34 medium the new-chat line; mono 12 (12.5 for Geist
Mono) for code, paths and commands only. Typeface knob: Figtree with Geist Mono (Field's), Geist with Geist Mono
(Instrument's), the system face with the system mono (default: most of the chosen parts were seen in it and the
app can ship it with no font file). Korean falls through to the system face in all three.

Geometry: window margin 8; panes 272 and 296; top row 36; sheet corner 26 (squircle, the same visible curve as the
panes' continuous 20); composer 26; the frame knob sets the distance between the sheet and the glass around it to
8 (Hairline, Field's own), 16 (Band) or 28 (Frame).

Motion: 90 ms press; 130 ms hover and the slot exchange; 210 ms in and 130 ms out for paper overlays, from the
corner nearest their control; 300 ms folds; 460 ms on `cubic-bezier(0.32, 0.72, 0, 1)` for panes, sheet, capsules
and composer, each of which leaves the window by its nearest edge and never fades; one spring for the switch knob,
the segmented thumb and a button's release; the platter materialises. Under Reduce Motion every transition is cut
to 1 ms and the field repaints in one step.

## 6. Layout

At 1440×900: left pane 8 to 280; centre column 288 to 1128 (840 wide); right pane 1136 to 1432. Top row at 8,
36 tall: tab capsule left-aligned with the sheet, then the waiting capsule and the right toggle at the window's
right. Sheet from 52 to where the composer begins less 8. Composer 720 wide, centred on the sheet's axis, 8 from
the bottom; the sheet's bottom follows the composer's measured height. Settings: no composer and no right pane, so
the sheet runs to the bottom and the right. New chat: no sheet, no tabs; the composer 680 wide at 54 % of the
height. Under 1100 px the right pane leaves; under 860 px the left one does.

## 7. Don'ts

- No glass on the sheet, apart from the settings platter recorded above. No text for reading on glass.
- No meaning in the field. Only the pool moves, and only with the composer.
- No orange that is not the person's move, Send with text, or the focus ring.
- No background, border, shadow or opacity on a glass host; fills go on children; a host leaves by sliding off.
- No serif. No second tint. No colour literal outside the token block, the traffic lights and shadows.

## 8. Rejected on the way

- The right pane at the window's full height, like the left one: two columns, and nothing floats.
- The composer as wide as the sheet: three stacked slabs, and no field left beside it for the pool to show in.
- The top band left as bare ground: the tab capsule was white glass on near-white and could not be found.
- An orange tint at 46 % on the waiting capsule: it read as a painted button, not glass.
- A glass capsule of folder and branch under the new-chat composer (group gap), and glass tool blocks (3.6).

## 9. Address aids for captures (never design states)

`x=tools` opens the last tool run, `x=top` rests the transcript at its start, `x=nopane`, `x=noside`,
`x=waiting` (the waiting list open), `x=css` (the CSS tier). `window.__xsGroups` and `__xsDiagnostics` hold what
the runtime resolved and reported.

## To ship this in the app

- **Ground roles.** Today the window, toolbar and sidebar paint one flat ground. This needs a canvas behind
  everything (the field), an opaque inset container for the main area (the sheet), and transparent shell regions.
  The window background the main process sets would become the field's base colour per scheme.
- **The glass.** One vitrea root in the renderer with a WebGPU request (Electron 44 has it; the CSS tier is the
  fallback and looks nearly the same at rest), the field canvas as its texture, and seven hosts: both panes, the
  tab capsule, the waiting capsule, two toggles, the composer. Sidebar and side-column widths are computed in
  TypeScript today, so every resize, collapse and scene change must tell the root to re-read its hosts and must
  re-declare each group's level.
- **Shell geometry.** The 44 px toolbar band and the square, hairline-parted tabs go; tabs become fills inside one
  capsule that stands above the main area. The composer leaves the transcript's column and is positioned by the
  shell under the sheet, with the sheet's bottom edge following its height. The side column becomes a pane with
  its own top and bottom rather than a full-height grid track.
- **Native views.** The embedded browser's pages are native views above the page: they can live inside the sheet's
  bounds and nowhere under a pane, a capsule, the composer or a platter.
- **Radii.** The single 6 px radius splits into roles: capsule for single-row controls, 12 for rows on a pane,
  11 / 18 / 22 for captions, cards and bubbles, 20 and 26 for panes, sheet and composer.
  `-electron-corner-smoothing: system-ui` replaces `corner-shape: squircle`.
- **Colour.** Terracotta is replaced by `#fd780f` with the job narrowed to "your move"; add the deeper mark values
  for light. Ink on glass is read from the runtime, with the two authored lower levels per scheme. Syntax colours
  and anything else drawn with its own palette stay on the sheet, so they need no second palette.
- **Type.** 13 px interface text becomes 14, prose 14/1.625 becomes 15/24. The system face needs no file; Figtree
  or Geist would be bundled as local variable fonts.
- **Motion.** Duration and easing tokens (there are none today), entry and exit motion for every menu, popover
  and dialog, and one shared overlay wrapper in place of per-call-site class strings.
- **Words.** Sidebar rows lose their second line, age and branch to the side card; settings rows lose their
  printed explanation to the margin note; the composer's chips fold into the model chip.
- **New.** The waiting capsule (fed by the pending requests the sidebar already has), the field painter with its
  travelling pool, and an Appearance setting for field strength with a Reduce Transparency switch beside it.
- **To measure before trusting it.** Contrast on the real sidebar's longest lists and on the real side column;
  the cost of repainting a full-window canvas for half a second on each layout change; the unfocused window.
