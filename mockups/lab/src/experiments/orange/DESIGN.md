# Orange

Round 2 synthesis `orange` (order 4), asked for by the owner after the other three were dispatched: "using #FD780F
(with no other claude-desktop style orange colors) for background, and making all main transcript, right panel, left
panel, tabspace with floating components with Liquid glass". Values live in `tokens.module.css` (per scheme),
`world.ts` (per scheme and per position of the Orange knob) and `paint.ts` (the ground); this file says what each is
for, where each part came from, what was measured, and what the idea costs.

## 0. Thesis

The window is the owner's orange itself, and everything stands on it as a floating pane of glass: the sidebar, the
tab capsule, the transcript, the side column, the composer. Five components, each on the ground, none on another.
The transcript is read on glass. Because the world is orange, no mark is: what waits for the person is said by the
one opaque thing among glass.

If a decision is ever ambiguous, choose the option that keeps the orange the owner's orange, at the hue they named.

No stance was derived and no sampler run: the owner's choices in ROUND2.md are the brief. The designer plugin was
used for its craft rules, its QA and the glass guideline's laws; section 7 lists the laws this idea breaks.

## 1. One hue

The owner's orange is `#FD780F`: HSL hue 26.5, OKLCH hue 49.4. "No other claude-desktop style orange" is read as a
rule about hue: terracotta and clay (`#c9663f`, `#d97757`, `#c6613f`) sit at HSL 15 to 17, OKLCH 39 to 41, redder
and greyer. So nothing in this synthesis is redder than the owner's orange, anywhere:

- Lighter steps are the orange mixed with white on encoded values. That holds the HSL hue at 26.5 and moves the
  OKLCH hue toward apricot (59 to 63), away from red. (Lightening at a constant OKLCH hue was tried on paper and
  rejected: it lands at HSL 21, on the way to salmon.)
- Deeper steps hold the OKLCH hue (`#d66204`, `#d96405`, `#8f4003`; HSL 26 to 27).
- No mark, icon, focus ring, button or text is orange. The traffic lights keep their system colours.

Every body of glass and the ground were read back from rendered pixels by `measure.mjs` (median pixel of each
surface, 1440 x 900, DPR 2). Chromatic surfaces all read HSL 25.2 to 27.6:

| surface | light, Full | dark, Full | light, Deepened | dark, Deepened |
|---|---|---|---|---|
| ground, in the margin | `#fa7810` 26.7 | `#f97710` 26.5 | `#d86405` 27.0 | `#8c3f03` 26.3 |
| sidebar | `#fdc496` 26.8 | `#4e2d13` 26.4 | `#efb98d` 26.9 | `#361f0d` 26.3 |
| side column | `#fcc396` 26.5 | `#4e2c13` 25.4 | `#eeb98d` 27.2 | `#351e0d` 25.5 |
| tab capsule | `#fdc599` 26.4 | `#543012` 27.3 | `#efbc92` 27.1 | `#3b200c` 25.5 |
| transcript | `#fee0c9` 26.0 | `#3d2512` 26.5 | `#f7dbc4` 27.1 | `#2d1b0e` 25.2 |
| composer | `#fecea8` 26.5 | `#53341a` 27.4 | `#f5bf94` 26.6 | `#3f230d` 26.4 |

With Orange on "As light" the surfaces are near neutral (OKLCH chroma under 0.02), so their hue is not meaningful;
the composer, which stands on the brightest pool, reads `#fde0ca`, HSL 25.9.

### Why no surface is drawn by the glass library

Round 1's Windows found the library returns a saturated orange about 13 degrees redder. It was measured again here,
on this ground, before any surface was drawn (`x=lib` in the address draws the probe; `measure.mjs` reads it):

| drawn by | light body | dark body |
|---|---|---|
| library, WebGPU, texture path: capsule 36 / composer 110 / pane 272 | `#ffd8c5` 19.7 / `#ffd0c2` 13.8 / `#ffd1c3` 14.0 | `#b18b77` 20.7 / `#9a6959` 14.8 / `#9a6a59` 15.7 |
| library, its CSS tier | 27.9 / 19.3 / 20.0 | not read |
| library with a corrective tint, `rgb(255 144 0 / 30%)` | `#fbc08a` 28.7 / `#faba88` 26.3 / `#fbbb89` 26.3 | `#c88c54` 29.0 / `#b8753e` 27.0 / `#b8763e` 27.5 |
| this synthesis (CSS: blur, a veil on encoded values) | `#fcc295` 26.2 | `#4d2b11` 26.0 |

The library's body is a neutral plate composited with the blurred backdrop in linear light, and a linear mix of this
orange with white is salmon: HSL 14, OKLCH 37, which is exactly the family the owner excluded. Its dark body over a
bright orange comes out a dusty clay at encoded level 0.46, inside the band where neither of its inks carries text.
`bodyChromaRetention` (the material's own leaf for this) was tried at 0 and 1 and moved nothing. A tint seed does
correct the light hue, at the cost of a tinted surface everywhere (the guideline allows one per view), and in dark it
gives a mustard body at level 0.51, still unreadable. Painting a deep patch under each footprint with a low hint got
the dark body to `#513c34` (HSL 16.6): readable, and clay again.

So the path taken is the CSS path, for every surface, in both schemes, and it is the same path for the large panes
(where round 1 found the two indistinguishable) and the small controls (where the library's lens would have shown).
What that gives up is in section 9.

## 2. The ground

A flat orange gives glass nothing to work on, so the ground is the orange, lit: one canvas (`paint.ts`), painted
once per size and world, fixed to the window.

- Broad: seven soft volumes. Three lift (the orange 38 % toward white, `rgb(254 172 106)`), from the upper left,
  low in the middle where the composer stands, and the right edge; four shade (`#d66204`) in the opposite corners
  and behind the transcript. Most of the plane stays the flat `#FD780F`; the margin reads `#f37919` to `#fa7810`.
- Fine: contour lines, the level sets of those same volumes (Field's technique), lighter on the lifted side and
  deeper on the shaded side, so they are the ground's own relief and not a pattern laid over it.
- Nothing in it moves and nothing in it means anything.

The Orange knob changes what this canvas is (section 8).

## 3. Parts: where each came from, and what changed

| part | lifted from | changed, and why |
|---|---|---|
| Sidebar pane | Field: one pane, 272 wide, a continuous 20 px corner (26 px squircle), the traffic lights on it, the current row lifted | 12 px margin instead of 8, so the ground reads as ground and not as a seam. Drawn with CSS, not the library (section 1). |
| Sidebar content | Quiet, whole: 34 px title-only rows, the trailing slot where state gives way to actions, the hover card after 420 ms that then follows the pointer, folding projects, shortcut on hover, usage rings, settings as its index | Ink at alpha instead of ink mixed with a ground (the body behind is not one colour). Hover and current are lighter fills, not darker ones: on glass a lift reads as light. The orange glyph became the solid disc (section 5). |
| Tabs | Instrument: a separate capsule of glass, 36 tall, tabs as 30 px fills inside it, 3 px inset | It stands on the ground above the reading pane instead of floating over the transcript (glass does not stand on glass here). The tab's slot is Quiet's (state, then close under the pointer) and its marks are Quiet's glyphs. Settings appears as a tab, as in Instrument. |
| Composer | Windows' placement (outside the reading surface, on the coloured ground), Quiet's contents (queued message as a chip inside, plus, model chip that opens the rest, context ring, one end button) | The stop button is a quiet fill, not solid ink (section 5). |
| Tool-run caption and card | Quiet, unchanged in behaviour: the caption, its chevron and duration under the pointer or when open, the rounded card of verb, target, result | The card gained a lighter fill under Quiet's ring: code is read on the calmer step of the pane. |
| Transcript | Quiet: bubble, captions, edit card, running command | Prose is sans (no serif, as the owner ruled): 15/24 at weight 460. Read on glass (section 7). |
| Side column | Windows' construction (a rounded pane of glass, the toggle in its corner), Quiet's four plain lists | Content left plain on purpose; the owner judges the container. |
| Approval | Quiet: the capsule of glyphs at the top right, the card from the waiting row, answering is real | The capsule and the glyphs are solid instead of orange. Approve is solid. |
| New chat | Quiet's layout | No pane at all: the line stands on the ground in the ground's own ink, the composer is the one sheet of glass. The line is sans, 28/34 at 560 (Field's). |
| Settings | Quiet's page (one 620 px column of 54 px rows parted by hairlines, section titles, the sidebar as index, the help sentence waiting in the right margin for hover or focus, a long path shown as its version) | Instrument's controls: lists stay visible as pills with a tick that grows in; the switch knob and the segmented thumb travel on Instrument's spring; controls are capsules; a button that says what it does has no label beside it. The menu is a platter of glass. Quiet's Help-text knob is gone: the owner confirmed the hover reading. |

## 4. Where parts collided

1. Instrument's tabs float over the transcript; here the transcript is itself glass. The tab capsule gave way: it
   moved off the reading surface into its own row on the ground. Cost: 48 px of height. The composer did the same,
   which is also where the owner saw and liked it (Windows).
2. Windows' three windows 65 px apart. The gaps gave way, not the windows: with every surface on the CSS path no
   sampling gap exists, so panes stand 12 px apart and the reading pane is 832 x 683 at 1440 x 900 (Windows: 754 x
   574). At 1280 x 800 it is 672 x 583; at 1728 x 1117, 1120 x 900.
3. Quiet's one accent ("orange means your move") in a world that is orange. Orange gave way (section 5).
4. Quiet's solid-ink stop button and switches against a solid that now has one meaning. The stop button gave way
   (a 12 % fill with an ink square); a switch that is on keeps an ink track at 84 %, told apart by its shape.
5. Quiet's "no fill on a transcript card" against code read on tinted glass. The rule gave way to a lighter fill.
6. Field's and Quiet's toggles sit in different places. Each pane's toggle stays where it is when its pane is put
   away, and a puck of glass materialises under it; the left one reaches back under the traffic lights, which
   otherwise stand on bare orange (the amber light all but disappears there).

## 5. What says "this needs you"

Every round-1 experiment reserved orange for it. Here it is the solid: the only fully opaque things in the window.

- A solid disc carrying Quiet's shape (hand, question mark, checklist): 20 px in a sidebar row, 18 px in a tab.
- The capsule at the top right: the same shapes on one solid capsule, standing on the ground.
- Approve, and Send once there is text.
- Light scheme: solid ink `#1d150d` with `#fff4e8` on it (16.6:1). Dark scheme: solid light `#fff4e8` with ink on
  it, a lamp among smoked glass.
- Agent's business stays quiet: a breathing 7 px dot (running), a small ink dot with a heavier title (unread).

Rejected: white as the solid in light (a white disc on a peach pane is 1.4:1 as a shape); a second hue (blue is the
complement and would be found fastest, but the owner asked for one colour).

## 6. Glass inventory

Every surface takes the CSS path: `backdrop-filter: blur()`, a veil of the scheme's neutral, a 1 px rim that is
brightest at the upper left, a shadow made of deeper orange (never grey), and a bevel: the veil is laid in two steps
so the last 8 to 12 px before the edge are thinner and the ground comes through most there.

| surface | role | shape | veil (light / dark) | blur |
|---|---|---|---|---|
| sidebar | window | 272 wide, r 26 squircle | 0.54 / 0.76 | 30 |
| transcript (settings page) | window | r 26 squircle | 0.76 / 0.84; Veil 0.90 / 0.93; Opaque: the ground candidate | 30 |
| side column | window | 288 wide, r 26 squircle | 0.54 / 0.76 | 30 |
| tab capsule | ornament | capsule, 36 | 0.56 / 0.74 | 14 |
| composer | ornament | r 26 squircle, 133 tall (93 on new chat) | 0.56 / 0.74 | 14 |
| toggle pucks (a pane is away) | control | capsule, 36 | 0.56 / 0.74 | 14 |
| menus, hover card, waiting list | platter | r 16 | 0.86 / 0.90 | 30 |

Light veil `rgb(255 255 255)`, dark veil `rgb(24 19 15)`; with Orange on "As light" the light veils drop to 0.50 /
0.56 / 0.66. The controls blur less than the panes so the contour lines stay legible as soft bands under them.
Nothing nests: inside a pane, lighter fills lift what is current or pressable (`--o-hover`, `--o-selected`,
`--o-lift`) and darker fills hold what was typed or is set apart (`--o-well`). Platters open over panes; with
`backdrop-filter` they sample the composite under them, which is what the eye expects there.

States of the material: the receded pose (window not in front) shortens every shadow and quiets the rim; Reduce
Transparency and engines without `backdrop-filter` get the opaque ground candidate; Increase Contrast makes the rim
solid ink and collapses the two quieter inks onto the first; forced colours removes the ground and the glass and
draws Canvas panels with CanvasText borders, the solid marks in Highlight. Reduce Motion cuts every transition.

## 7. Laws of the glass guideline this idea breaks

- Glass in the content layer, the transcript included. This is the spatial register (windows hold content,
  ornaments hold controls), named here as the assigned idea.
- Window count: three windows and two ornaments at rest; the register asks for one to three windows, so this is at
  its limit, and settings and new chat are under it.
- "No hand-rolled blur standing in for the material." All of it is hand-rolled, for the measured reason in
  section 1. The rim and the bevel are painted, not computed.
- The plane is ambience the page chose and does not change under the glass, so the transparency preserves no
  context (Field's cost, inherited).
- Platters open by scaling from the corner nearest their control with a fade, not by materialising.
- Not broken: no glass on glass, no tinted surface, one variant, text in regular through bold weights, the host
  still and the child scrolling with faded inner edges, colour kept in the environment.

## 8. Knobs

- **Orange** (the one that matters most): *Full* is the brief, `#FD780F` under everything in both schemes.
  *Deepened* is the same hue lower: `#d96405` in light, `#8f4003` in dark with the owner's orange surviving only as
  the lit volumes. *As light* is a plain ground (the Ground knob) with the orange only as pools of light.
- **What dark means.** Default: dark glass over the same orange. The seams stay at full brightness and the panes
  are smoked glass lit from behind (`#4e2d13`, `#3d2512`): undeniably brown, because that is what this orange is
  when it is dark. Flip Orange to Deepened for the other answer, an orange that deepens with the scheme.
- **Reading surface**: Glass, Veil, Opaque (the Ground candidate, no blur).
- **Typeface**: Figtree (default), Geist, the system face; Geist Mono for code except with the system face.
- **Plain ground**: the owner's candidates, paired; used by As light and by Opaque.

Address aids for captures, never design states: `x=top,tools,nosidebar,noside`, and `x=lib` for the probe.

## 9. Measured

`measure.mjs` reads every visible line of text and every icon against the pixels behind it (text hidden, one
capture, the line's tenth-percentile pixel). Floors 4.5 for text, 3 for icons and large text. 22 routes were run
after the last change to the material (both schemes; Orange full, deepened, as light on two grounds; three reading
surfaces; session at rest and scrolled to the top with a tool run open; settings; new chat; Geist and system), plus
six with a platter open. No reading is under its floor.

| line | light, Full | dark, Full | light, Deepened | dark, Deepened |
|---|---|---|---|---|
| transcript prose | 14.1 | 11.8 | 13.5 | 13.7 |
| the person's message (on a well) | 12.3 | 14.0 | 11.7 | 15.2 |
| diff code | 7.7 | 7.2 | 7.4 | 8.4 |
| captions, running output | 5.9 to 6.2 | 5.7 to 6.6 | 5.8 to 6.1 | 6.4 to 7.2 |
| sidebar titles at rest, group headings | 5.2 | 5.6 | 4.9 | 6.6 |
| side column, lowest line | 5.1 | 5.7 | 4.9 | 6.8 |
| diff counts on the side column | 5.5 to 5.6 | 6.2 to 7.3 | 4.9 to 5.1 | 7.8 to 9.2 |
| composer placeholder | 5.4 | 5.5 | 5.1 | 6.5 |
| tab labels | 7.5 | 6.4 | 7.0 | 8.0 |
| lowest icon on any route (a chevron in the composer) | 3.6 | 3.7 | 3.5 | 4.4 |
| words on the ground (new chat), lowest | 6.0 | 5.8 | 4.5 | 7.2 |
| prose with Reading on Veil / Opaque | 16.3 / 17.1 | 14.0 / 14.8 | | |
| text on an open platter, lowest | 6.5 | 7.5 | | |

Failed on the way, and what changed: diff counts on the side column read 4.39 (light) and 3.87 (deepened) with
Quiet's green and red, which were deepened to `#0f5530` and `#96180f`; the chips under the new-chat composer read
4.41 on the deepened ground where a shaded volume passed under them, so that ground's shade was eased; faint
icons read 2.3 to 2.9 at 46 % ink and were raised to 58 %. The session route also passes at 1280 x 800 and
1728 x 1117 (light, Full).

Not measured, so not claimed: lines inside a scroller's 20 px faded edge; text that appears only under the pointer
(shortcuts, durations, the margin note); marks drawn in CSS; frames during a transition; the receded pose (it
changes rim and shadow only); forced colours and Increase Contrast (looked at, not measured); Reduce Transparency
(written, never rendered: the capture tool cannot ask for it).

## 10. Tokens

| role | light | dark |
|---|---|---|
| ink | `rgb(29 21 13)` | `rgb(255 242 228)` at 96 % |
| second / muted / faint (marks) | 82 % / 70 % / 58 % | 80 % / 66 % / 54 % |
| hairline / strong | 10 % / 18 % | 11 % / 19 % |
| hover / current / card lift | white 30 % / 52 % / 34 % | ink 7 % / 14 % / 6 % |
| well | ink 6.5 % | black 24 % |
| solid, and on it | `#1d150d`, `#fff4e8` | `#fff4e8`, `#1d150d` |
| added / removed | `#0f5530` / `#96180f` | `#7fdca8` / `#ffa193` |
| shadow colour on the ground | `rgb(112 44 0)` (Full) | the same |

Type: interface 14/20, 13 in tabs, captions and the side column, 12 for group labels; prose 15/24; code 12/20;
section title 20/28 at 600. Weights 460 and 600 in Figtree (nothing lighter than 430 is on glass). Radii: panes 26
squircle, composer 26, platters 16, cards 16, rows and chips 11, bubble 20, capsules for the tab strip, tabs and
every settings control. Geometry: 12 px margin and gap, sidebar 272, side column 288, bar 36, measure 680.

Motion: Quiet's durations (90 press, 130 hover, 210 in and 130 out for platters, 300 folds) on
`cubic-bezier(0.22, 1, 0.36, 1)`; panes travel 380 ms on `cubic-bezier(0.32, 0.72, 0, 1)`; Instrument's spring on
the switch knob (420), the segmented thumb (440), pills and the solid capsule. At rest only the running dot and the
task spinner move.

## 11. Rejected

- The library for the small controls with a corrective tint: right hue in light, no usable dark, and two materials
  to keep matched.
- Tabs and composer floating over the reading pane: glass on glass, and platters over both.
- A lighter orange at constant OKLCH hue for the lit volumes: it reads pink beside the owner's orange.
- A neutral grey shadow: on orange it reads as dirt. Shadows are the orange, deeper.
- Desaturating what shows through dark glass to make it less brown: it stops being this orange.
- A wider margin so more ground shows: it turns the app into cards on a wallpaper, which is what the owner disliked
  in Windows.

## 12. What is weakest

- There is no lens. The owner asked for Liquid Glass and this is frosted CSS with a painted rim and bevel; on this
  ground the real material could not hold the hue (section 1). If the library gains a body that keeps a saturated
  backdrop's hue, the tab capsule and the composer are the two surfaces to move back to it.
- In the session scene the orange is seams and tint: about a tenth of the window is bare ground. The colour is felt
  as peach panes in light and brown panes in dark more than as `#FD780F`. New chat is where the brief looks like
  itself.
- A working day on peach. Reading contrast is high, but the page is never neutral; Veil, Opaque and As light exist
  so that cost can be felt.
- The solid is heavy: three black discs and a black capsule on a warm page. It is findable; it is not gentle.

## To ship this in the app

- **Shell.** Today the window, toolbar and sidebar paint one flat ground in a grid, with widths computed in
  TypeScript. This needs a full-window canvas under everything (the ground), and each region as an inset,
  rounded, fixed surface with a 12 px margin and gap; the 44 px toolbar goes and its controls move into the tab
  row and the panes. The main process's copy of the window background colour has to follow the ground, and the
  traffic lights move to about 26, 24.
- **Material.** No library, no window transparency and no vibrancy are needed: the ground is the app's own. The
  renderer has no `backdrop-filter` today and nothing in its content policy forbids it. One shared glass class
  (blur, two-step veil, rim, shadow) with the fallbacks of section 6. Native web views (the browser tool) sit
  above the page and cannot be under glass or behind a platter; they stay inside the reading pane's bounds and
  platters over them need the existing cover.
- **Tokens.** The terracotta accent pair is retired with no accent in its place; add the solid pair, ink at alpha
  steps, lift and well fills, the cast colour, per-surface veils, and the ground's five colours. The colour guard
  only scans for literals in the renderer and does not see `color-mix`, radii, shadows or durations.
- **Radii.** The one 6 px token used on nearly every row, button, chip and input splits into roles (pane, platter,
  card, control, bubble, capsule), and `-electron-corner-smoothing: system-ui` replaces `corner-shape: squircle`.
- **Tabs** are square cells parted by rules by structure; they are rebuilt as fills inside one capsule.
- **Sidebar rows** lose their second line and age (into the hover card) and gain the trailing slot; their pixel
  values live in the components, not in tokens.
- **Transcript** is the hand-written stylesheet and the largest piece: folded captions, lifted cards, prose at
  15/24. Syntax colours, the diff view, the terminal and charts bring their own palettes; each has to be chosen per
  scheme against the pane's body (`#fee0c9`, `#3d2512`) and measured.
- **Menus, popovers, dialogs** have no motion and are styled per call site; they need one shared platter wrapper.
- **Motion tokens** (durations, two curves, one spring) do not exist yet.
- **Fonts.** Bundle Figtree and Geist Mono (latin, variable); remote fonts cannot load. Korean falls to the system
  face.
- **Appearance settings** would gain the Orange position, the reading surface, and a Reduce Transparency switch.
- **Before trusting it:** run the measuring script against real sessions (long code, images, a 500-item
  transcript scrolling inside a blurred pane under load), and decide what a second split pane is, since a fourth
  window breaks the register's count.
