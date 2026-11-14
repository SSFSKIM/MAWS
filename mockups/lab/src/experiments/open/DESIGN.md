# Open

Round 2 synthesis `open`, order 2. The parts are the owner's choices from round 1 (ROUND2.md); what is designed
here is the structure they stand in and what happens where they meet. Values live in `open.css` (tokens at the
top) and `field.ts` (the light); this file says where each was lifted from, what changed, and why.

## 0. Thesis

No sheet. The window is one plain ground. The colour field is not a surface under the window; it is light that
gathers where glass stands (under the left pane, under the right pane, around the composer, a breath under the
tabs) and is the plain ground again a hand's width past the glass. The transcript runs on that ground between two
panes and passes under two floating bars, the tab capsule and the composer.

If a decision is ever ambiguous: keep the ground plain where text is read, and give the colour to the glass.

Position, adopted from the owner's choices rather than derived:

| line | position | from |
|---|---|---|
| Density | standard: 34 px rows, 15/24 prose, a 744 px reading column | Quiet |
| Criticality | consequential: an approval pushes code, so state is a shape before it is a colour | all of round 1 |
| Energy | quiet; one thing in the window is orange | Quiet, Instrument |
| Type | one sans and its mono, no serif (the owner's ruling); the family is a knob | Field, Instrument, Quiet |
| Material | glass over a ground that is plain where read and lit where glass stands | this synthesis |
| Colour | monochrome ink; colour lives in the light and in one tinted control | Field, Instrument |
| Accent job | "it is your move" and nothing else | every experiment |
| Ground | the owner's candidates in both schemes, each scheme designed | the brief |

Signature: the reading column with glass standing on its edges. The tab capsule starts on the column's left edge,
the waiting capsule ends on its right edge, the composer is exactly as wide as the column, and the two panes keep
one fixed distance from it. That distance is not typed; it is what the glass runtime says two bodies of glass owe
each other (62 px here), so the layout's main rhythm and the material's rule are the same number.

## 1. The parts, and what changed in each

| part | lifted from | kept | changed, and why |
|---|---|---|---|
| Left pane, the component | Field (`Field.tsx` `Pane`, `field.css`) | One sheet of glass, 272 wide, a 20 px continuous corner, thickness 8, 8 px from the window, traffic lights on it; rows at radius 12 (20 minus the 8 px inset); lighter fills lift (hover white 40 %, current white 76 %; dark 7 % and 15 %); the texture path with no declared hint; the slide on Field's long curve with the runtime re-reading the box each frame. | Field's field ran under the whole window; here only the part under the pane is painted, with Field's own masses in the places they fell at 1440 wide and Field's base under them (section 3). The toggle moved onto the pane beside the lights (Quiet's place for it). |
| Left pane, the content | Quiet (`Sidebar.tsx`) | Title-only rows at 34 px; the trailing slot where the state glyph steps aside for the row's actions; idle rows quieter and unread rows heavier; group labels whose caret waits for the pointer; the fold; two nested usage rings with the numbers one click away; the settings index with its back row; the card that waits 420 ms and then follows the pointer. | Ink is the runtime's, read on children, with a second and a third level authored from it (section 4), because Quiet's three text tones were mixes with an opaque ground. The row menu and the usage popover became platters of the same glass. The hairline between sidebar and transcript is gone: the pane is the separation. |
| Tabs | Instrument (`Instrument.tsx` `Tabs`, `.tabs`, `.tab`) | One capsule of glass 36 tall, 3 px padding, fills at radius 15 inside it, the current tab an ink fill, the plus button, content passing under it with a soft scroll edge. | State marks are Quiet's glyphs, and under the pointer the glyph gives way to a close mark (Quiet's exchange). The capsule moved from the sidebar's edge to the reading column's left edge (conflict 1). The current tab keeps its whole title; the others thin out when room is short. |
| Composer | Instrument's host (`.composer`, radius 26, thickness 8, the transcript sliding under it) with Quiet's content (`Session.tsx` `Composer`) | Quiet: the queued message as a token above the field, attach, one model chip holding effort, mode, folder and branch, the context ring, one button that stops while a turn runs and turns orange to send. | Every control is a fill on the glass (Instrument's rule) and presses the glass it stands on; the model menu is a platter. Quiet's raised white sheet is gone. |
| Transcript | Quiet (`Session.tsx`, `quiet.module.css`) | The pill caption with its chevron and duration, the rounded card listing the calls, the ringed edit and running cards, the bubble, the agents line; every size and spacing. | Prose is the sans at 15/24 (Quiet's own Sans setting): the owner rejected the serif. |
| Right pane, the construction | Windows (a rounded glass pane on the texture path) | Glass, round, made over its own light. | Not a full-height window at 14 px with a 28 px corner: it joins the left pane's family (22 px corner, 8 px from the window), is as tall as its content, and grows out of a round button at the top right (section 6). |
| Right pane, the content | Desktop (`Session.tsx` `Side`) | Branch and totals at the head, files, agents, background, to do; its sizes. | Drawn plainly, on the owner's word that this column's content will come from the app. Marks are this design's (breathing dot, check). |
| Waiting approval | Quiet (`Quiet.tsx` `Waiting`, `Session.tsx` `Ask`, the row card) | A capsule at the top right holding one glyph per waiting session; it opens the list with the approval answerable in place; the card on the waiting row carries the command, one sentence and Deny / Approve; answering turns the session grey everywhere. | Capsule, list and card are glass, since all three float over the transcript (conflicts 4 and 5). |
| New chat | Quiet (`Home`) | The line, the composer, the two chips under it, left aligned on one edge. | The composer is glass in the one pool of light the scene has, on the texture path. The line is the sans (28/34, 560). |
| Settings, geometry | Quiet (`Settings.tsx`) | One 620 px column, 54 px rows parted by hairlines, 20/28 section titles, the sidebar as index, the right margin kept empty for the sentence. | Nothing folded: lists are pills. |
| Settings, controls, motion, glass | Instrument (`Settings.tsx`, `.switch`, `.seg`, `.pill`, `.select`) | Switch and segmented thumb on one light spring, pills for every list, the select's list as a glass platter, a button that says what it does with no label beside it, the full path shown. | The help sentence waits beside its row for hover or focus (both experiments had this; the timing is Quiet's). |

## 2. Conflicts between parts, and how each was settled

1. **Where the tabs stand.** Instrument's capsule stood 14 px from a printed sidebar. Here the sidebar is glass, and
   glass that size asks for 62 px before the next body of glass. The capsule moved to the reading column's left
   edge, which is that far from the pane anyway. Instrument's position gave way; its capsule did not change.
2. **Fills on glass.** Field lifts with lighter fills, Instrument with ink at a low alpha. Each kept its rule on its
   own surface: white lifts on the two panes, which stand on colour; ink fills on the bars and platters, which
   stand over the reading ground, where a white lift on white glass cannot be seen.
3. **State marks.** Instrument's tabs used a ring and dots, Quiet's rows use glyphs (a hand, a question mark, a
   checklist). One vocabulary: Quiet's, because the waiting capsule is made of the same glyphs.
4. **The waiting capsule's colour.** Quiet's is a soft orange fill with orange glyphs. As glass it is the one
   tinted control of the view (the orange at 46 % in light, 62 % in dark), and its glyphs take the runtime's ink:
   orange marks on orange glass do not hold 3:1, and a tint belongs on the body, not the label. The tint leaves
   when the capsule grows into the list, so the list is read on plain glass (Instrument's move).
5. **"One thing floats."** Quiet allowed a shadow on the composer and on things opened, and nothing else. In this
   structure the panes, the bars and every platter float. Quiet's rule gave way; what survives of it is that
   nothing in the transcript is raised by default.
6. **The field.** Field's ran under the window and showed as a frame around a sheet. With no sheet a whole field
   would sit under the text, so it was cut down to gatherings (section 3). Field's rule that the field means
   nothing is kept.
7. **Two kinds of glass path.** Field's pane bends real pixels (a texture); Instrument's bars sample the page,
   because text must pass under them. Both are kept, each where its part came from, and the new-chat composer
   takes the texture path because nothing passes under it (section 4).
8. **The right pane's family.** Windows' pane and Field's pane differ in corner and margin. Two panes in one
   window read as one material only if they share both, so the right pane took Field's.
9. **Motion.** Quiet moves everything on one decelerating curve and nothing bounces; Instrument puts a light
   spring on small round things. The owner chose Instrument's motion for settings, so the spring is on the switch,
   the segmented thumb, the pills and the send button, and nowhere else. Panes travel on Field's curve at 460 ms.
   The glass itself moves only as the runtime moves it.
10. **Type.** Quiet was seen in the system face, Field in Figtree, Instrument in Geist. The knob holds all three on
    this layout. The default is Figtree: the pane is the component the owner liked most, and it was seen in it.
    Sizes are Quiet's.

## 3. The light: how much colour the ground keeps under each control

The risk this structure carries is Instrument's finding: in light, glass over a plain ground is a soft shadow and
little else. So each control keeps some of the field under it, enough to be seen as glass and no more than its
text can carry. `field.ts` paints one canvas per gathering, with Field's painting (soft masses in five-stop
falloffs, and 1 px contour lines that are the level sets of the same masses), cut by a blurred copy of the
surface's own shape so the light ends about 80 to 210 px past the glass.

| surface | share of the pane's strength | palette | why this much |
|---|---|---|---|
| left pane | 1.00 | Field's four masses: amber, the theme orange, coral, plum, top to bottom | It is the part the owner chose as seen. |
| right pane | 0.86 | amber at its top right, rose and plum under its foot | A second pane should not outshine the first; its foot glows on the ground below it, which is most of what says "this floats". |
| composer | 0.80 | the same dusk laid left to right, the orange kept under its foot | Typed text and a placeholder sit on it, and the orange send button must stay the most orange thing near it. |
| tabs | 0.36, no contours | amber to coral | Text passes under it; a breath is enough for the capsule to be seen at rest in light. |
| new-chat composer | 0.95 | all four | It is the scene's only light. |
| waiting capsule, row card, menus, the two small buttons | 0 | none | The capsule has its tint; platters open over transcript text, which is where glass shows best; the small buttons are where the cost shows (section 9). |

Under each gathering lies Field's base (a warm grey under the light scheme's light, near black under the dark
scheme's embers). In dark that base is what keeps the embers saturated: painted straight onto `#191919` the same
masses turn grey. On `#000000` the base is lighter than the ground and works as the neutral floor that keeps the
body from turning a faint colour tail into a wash. The Field strength knob scales all of it with Field's four
gains (0.14, 0.36, 0.64, 1); Warm is the default, as in Field.

## 4. Material: the record

```
register: instrument. Every glass surface is navigation, a control or a transient platter, except as listed in
  section 9.
plane: the ground, plain, with the gatherings of section 3 painted under the glass; the transcript on it.
inventory, standing: left pane (navigation); tab capsule; waiting capsule (the one tint); composer; right pane
  (a control that opens: the round button and the pane are one surface). With the left pane away, one more: the
  36 px button that brings it back.
inventory, transient: the waiting list (grows out of its capsule); the row card; the row menu; the usage
  popover; the model menu; the select menu on the settings page.
family: thickness 8 everywhere. Spans 36 (capsules), about 93 to 133 (composer), 272 and 288 (panes): the family
  straddles the 32 to 96 band. Radii: panes 20 and 22, composer 26, platters 16 to 22, capsules; rows on a pane
  12, fills in a capsule 15. Anchor: the window corner, at 8 px.
tint: one seed, the theme orange at part strength, on the waiting capsule; it leaves when the capsule opens.
scheme and pose: the root's scheme is the lab's; window activation is left on auto.
tier: WebGPU on every capture. Address aids, never design states: `tier=css` draws the CSS tier (looked at in
  both schemes: the same layout with frost and no lens); `clear=1` selects the clearer of the two measured
  macOS 27 bodies (tried: it warms dark glass a little and changes the left pane from what the owner saw, so it is
  not the default).
```

The path each surface took, and what the runtime resolved for it:

| surface | path | resolved | backdrop statement |
|---|---|---|---|
| left pane | texture: its own gathering's canvas, with the ground painted under the light | `webgpu`, `gpu-texture`, refraction `true`, analysis `exact` | none declared, as in Field: the canvas is little more than the pane's footprint |
| right pane, and its button | texture: its gathering's canvas, repainted plain 340 ms after the pane has gone, so the button is not made over light the page no longer shows | the same | the level read back from the painted canvas under its own box |
| new-chat composer | texture: the scene's pool, opaque for 60 px past the composer and transparent on the page beyond | the same | the level under its box |
| tab capsule, session composer | the page, sampled (text has to pass under them) | `webgpu`, `css-backdrop`, refraction `approximate`, analysis `hint` | computed: the ground and its light under the bar, read back from the painted gatherings, plus the transcript blocks under it by area (each block states the share of its box that is inked; Instrument's method), halved under a soft scroll edge; re-read on scroll, resize, repaint and through a layout change |
| waiting capsule, the button that brings the left pane back | the page, sampled | the same | the level under its box |
| platters | the page, sampled | the same | the ground with about 5 % ink, or the pane's level where one opens over the pane |
| tool blocks with the knob on Glass | CSS: one backdrop blur, one translucent body, a rim, a shadow that follows the span | not the runtime's | none; section 7 |

Why the panes are on the texture path: sampled from the page, the dark material's body is a neutral veil and the
embers under a pane come out grey. Made over a texture the body keeps the backdrop's hue, which is how Field's
dark pane looked. A side-by-side of this pane and Field's at the same strength is the check that was used.

What the runtime reported:

- Dev-mode diagnostics: zero at rest on every captured route, both schemes, and zero through every pane
  transition run in sequence (left away and back, right away and back, both away).
- Derived room: 62 px between a pane and a bar (the layout's `--xo-air`), 24 px (light) and 25 px (dark) between
  two small controls (`--xo-seam`). Both are read from `useGlassSamplingGap` and spent as variables.
- Three things had to be worked around, each found as a diagnostic first:
  1. A popover's closed trigger is glass placed by the popover, and it re-reads where its slot stands when it
     renders, not while a CSS transition carries the slot. The waiting capsule froze mid-slide and the tab capsule
     ran into it (`same-plane-overlap`). The capsule now renders on the root's frames for the length of a move.
  2. A morph mounted open reported `group-proxy-overlap` against the far pane in its first frame. The right pane
     is mounted as its button and opened 150 ms later, which is also its arrival.
  3. When the right pane closes, the layout closes up 300 ms after it, and when it opens, the room is made first;
     the control in front of a move leaves 90 ms before the one behind. Otherwise the waiting capsule slid
     through the pane while it was still glass.

Contrast, measured on rendered pixels (each line's tenth-percentile pixel, text hidden for the capture; 1440 by
900, WebGPU, active pose, Warm). Floors: 4.5 for text, 3 for icons.

| | light | dark |
|---|---|---|
| drawn body: left pane / right pane | 0.93 to 0.95 / 0.96 to 0.97 | 0.22 to 0.23 / 0.20 to 0.21 |
| drawn body: tabs / composer / waiting capsule | 0.88 to 0.98 / 0.91 to 0.97 / 0.79 | 0.29 to 0.35 / 0.22 to 0.27 / 0.46 |
| rows on the left pane (the quietest is an idle row) | 5.0 | 5.0 |
| group labels on the left pane | 5.0 | 5.8 |
| tab titles | 7.5 | 5.2 |
| composer placeholder / queued message | 7.4 / 10.0 | 6.6 / 6.1 |
| right pane: names / second lines | 13.9 / 5.1 | 8.7 / 6.2 |
| row card: title / line and meta | 14.0 / 7.5 | 6.2 / 5.3 |
| glyphs on the waiting capsule (icons) | 10.0 | 4.3 |
| lowest text line on the ground | 4.64, the running card's tail | 5.85 |
| lowest icon | 3.5, a group label's caret | 4.3, the waiting capsule's glyphs |

Every gated line passes on these routes, both schemes: session at rest, scrolled to the top with a tool run
open, with the row card open, with the waiting list open, with Tool blocks on Glass; new chat; settings; Vivid;
the pure grounds. The ink levels on glass are authored from the runtime's primary: 80 % and 68 % in light, 88 %
and 80 % in dark (round 1 measured the runtime's own second level under 4.5 on light panes).

Not measured, so not claimed: the state glyphs in the sidebar's slots (the measuring script cannot see through
the slot's hidden action; by the tokens they are about 3.3:1 in light and 4.2 in dark, against a 3:1 floor);
text that appears on hover; lines inside a scroll edge; the unfocused pose; Reduce Transparency; Increase
Contrast; forced colours (rules are written and unverified). One reading sits in the band where neither ink
carries body text: the dark waiting capsule's body at 0.46. It carries three glyphs and no words.

No native capture was made. The nearest Apple surface is a macOS 27 window with a glass sidebar, a floating tab
capsule and an inspector.

## 5. Tokens

Colour is Quiet's scheme of two inputs (a ground from the knob and an ink), every neutral on the ground a mix of
the two.

| role | light | dark |
|---|---|---|
| ground (knob) | `#faf9f5` · `#ffffff` | `#191919` · `#191c19` · `#1f1f1f` · `#000000` |
| ink | `#1b1a17` | `#f4f2ed` |
| text / secondary / muted / faint (marks only) | ink, 76 %, 62 %, 42 % | 93 %, 74 %, 58 %, 40 % |
| hairline / strong | ink 9 % / 16 % alpha | 10 % / 16 % |
| hover / selected / well, on the ground | ink 4.5 % / 7.5 % / 5.5 % | 6 % / 10 % / 7.5 % |
| ink on glass: primary / second / third | the runtime's, 80 %, 68 % | the runtime's, 88 %, 80 % |
| fills on a pane: hover / current | white 40 % / 76 % | white 7 % / 15 % |
| fills on a bar or platter: hover / current / well | glass ink 8 % / 11 % / 7 % | the same |
| accent fill, text on it | `#fd780f`, `#2a1300` | the same |
| accent mark (glyphs) | `#d95f06` | `#fd780f` |
| solid (stop, switch on) | ink | `#f4f2ed` on `#191919` |
| diff added / removed | `#1f7345` / `#c0392b` | `#6fcf97` / `#f08a7e` |

The owner's orange is about 2.6:1 on the light grounds, so in light it is a fill, and the glyphs take the deeper
step. Orange appears on: the glyph of a session that waits on the person, the waiting capsule's body, Approve,
Send once there is text, and the focus ring.

Type: one family and its mono. Interface 14/20; tabs, captions and the right pane 13; group labels 12; prose and
the composer field 15/24 and 15/22; code 12.5/20; settings titles 20/28; the new-chat line 28/34. Weights: 450
(Figtree), 420 (Geist), 400 (system); emphasis 560 to 620. Mono is Geist Mono, or the system mono with the system
face. Korean falls through to the system face.

Geometry: left pane 272, right pane 288 (256 and 264 under 1340 px wide), reading column and composer 744 at
most, bars at 12 px from the top and 36 tall. Radii: rows on a pane 12, controls 11, items in a platter 10 to
11, transcript cards 18, the bubble 22. Drawn rectangles use the continuous corner; circles and capsules stay
round; the glass draws its own.

Motion: on the ground and for fills, Quiet's durations (press 90 ms, hover 130, platter content 210, fold 300) on
`cubic-bezier(0.22, 1, 0.36, 1)`; panes and everything that travels with them 460 ms on
`cubic-bezier(0.32, 0.72, 0, 1)`; Instrument's spring on the settings controls and the send button. Nothing moves
at idle except the breathing dot of a running session. Reduced motion collapses every authored transition.

## 6. The right pane

The owner's note was that it should feel like a separate, floating piece of Liquid Glass. Four decisions carry
that, in order of weight:

- It is as tall as its content and no taller. Below it is ground, and its own light falls on that ground past its
  foot: the shadow and the glow under a free edge are what read as floating. A full-height pane reads as a column.
- It arrives and leaves as one surface. Closed, it is a round 36 px button at the top right; open, the same piece
  of glass has grown down and left into the pane (the runtime's matched-geometry morph), and the button that
  closes it sits where the round button was. Its content fades in over the last two thirds of the growth.
- Its distance from the window (8 px) is the left pane's, and its distance from the reading column is the same
  derived 62 px, so it is placed by the rule everything else is placed by, not attached to an edge.
- Its light goes out on the page as it leaves and comes back as it returns.

## 7. The knob of this synthesis: tool blocks as glass

The owner suggested trying the tool-run card, the diff and the running command as glass. Default is Quiet's ring
on the ground. With Tool blocks on Glass the same three cards take a translucent body, a rim, a soft shadow and a
pool of the dusk under each. They are drawn on the CSS path, because they scroll with the page and pass under the
runtime's bars; the runtime's own scrolling glass was not tried. Text on a tinted card steps up one ink level so
the quiet tones still hold 4.5:1.

What it is, honestly: the blur has nothing moving under it, so at rest a glass block over its own light is a
softly lit card. It reads as glass at its edges and when it passes under a bar. It breaks the rule this layout
otherwise keeps (no glass in the content layer); the knob exists so the owner can see what that buys.

## 8. Rejected

- A whole field under the window with the transcript on it: colour under every line of prose.
- A hairline or a tonal step between panes and transcript: the gap and the pane's shadow already part them.
- Tabs aligned to the pane at 14 px: the runtime reports the pair, and the row then has two alignments.
- The right pane at full height, and the right pane sliding in from the edge: both make it a column.
- The clearer material as the default, and a faint tint on the dark bars to warm them: the first changes a part
  the owner chose as seen, the second spends a second tint.
- Orange glyphs on the orange capsule; an orange primary button anywhere but Approve and Send.
- The serif, anywhere.

## 9. Laws bent, and what it costs

- **Glass over a plain ground.** With the left pane away its small button stands over bare ground, and so does the
  right pane's button when the pane is closed. In light each is a soft shadow and a faint disc. They were left
  without light of their own on purpose: a pool under a 36 px button is decoration.
- **Content under a bar at rest.** A live session is read from its end, so the top of the transcript is under the
  tabs when the window opens (Instrument's cost, kept). The soft scroll edge thins it; the bottom clears the
  composer by its measured inset.
- **A pane carries a list.** About twenty short labels on the left pane and a column of rows on the right. They
  are navigation and status, set in the runtime's ink on children and measured. Field's cost, kept.
- **Platters with a few lines of reading.** The row card and the waiting list hold a title, a line, a command and
  a sentence, over transcript text. Regular glass, primary ink, measured at 5:1 and up.
- **Dark bars are neutral.** Sampled from the page, the dark body does not keep the hue of the light under it, so
  the dark composer and tabs are grey glass with embers around them, while the panes and the new-chat composer
  (texture path) carry the colour through. In light all of them carry it.

## What was found

- The structure holds in both schemes, and the place it is most itself is where text slides under the composer.
- In light the bars need their breath of colour: with Field strength on Whisper the tab capsule is close to
  Instrument's white on white. The panes do not have this problem at any strength.
- The room the runtime asks for between large glass and its neighbours (62 px) is the same as a comfortable
  margin for a reading column. Planning the groups and composing the page turned out to be one act; under about
  1340 px wide the column is what pays (620 px at 1280).
- Weakest: the two small buttons on bare ground in light, and the dark bars' neutral body beside coloured panes.

## To ship this in the app

- **The shell.** Today the toolbar, the tab strip, the sidebar and the window paint one flat ground in a grid, with
  a 44 px toolbar band. This needs the ground alone as the bottom layer, the transcript scrolling the full height
  of the window, and the sidebar, tab strip, composer and side column as fixed, floating hosts over it. The
  toolbar band and the hairlines beside the sidebar and the side column go. The column widths, which live in
  TypeScript today, have to publish the pane boxes and take the runtime's derived room as an input.
- **The glass.** One root of the glass runtime around the shell, WebGPU requested (Electron 44's Chromium has
  it), the CSS tier as the fallback with no further work. Two paths in one root: the panes over painted canvases
  as textures, the bars sampling the page with a level declared from the virtualised transcript's row kinds. No
  window transparency or vibrancy is needed: the light is the app's own.
- **The light.** A small painter (one canvas per pane, one under the composer, one under the tabs), repainted on
  resize, scheme and strength, and an Appearance setting for its strength with an off position.
- **Tabs** are square cells parted by rules by structure. They become fills inside one floating capsule.
- **The side column** becomes a surface that opens from a control and is as tall as its content; the tools it
  hosts need to state a natural height.
- **Tokens.** Neutrals as mixes of ground and ink so the dark candidates can be compared; three orange steps in
  place of the terracotta pair, with the accent's job narrowed to "your move"; ink on glass read from the runtime
  with two authored levels; two fill models (lifts on panes, ink on bars). The single 6 px radius splits into the
  roles of section 5. Continuous corners through `-electron-corner-smoothing: system-ui`.
- **Motion.** There are no duration or easing tokens and no overlay has entry motion. Add the durations and
  curves of section 5; menus, popovers and the approval move onto the runtime's presentations, which gives each
  one an entrance.
- **Menus and popovers** are styled at each call site today. They need one shared platter and item, or the glass
  has to be applied at every site.
- **Rows.** The sidebar row loses its second line and age at rest and gains the trailing slot; the removed text
  moves to the card. The settings rows lose their printed help, which moves to the margin.
- **Fonts.** Bundle the chosen family and Geist Mono locally (remote fonts cannot load).
- **Native views.** An embedded browser view is composited above the page and cannot sit under a bar, a pane or a
  platter. A tab that hosts one needs the bars to stand clear of it, or the existing cover-with-a-picture path
  whenever glass overlaps it.
- **Accessibility.** An app-level Reduce Transparency switch (the engine cannot always answer that query), and a
  pass over the authored fills under forced colours, which this lab wrote rules for and did not verify.
