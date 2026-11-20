# Windows

Design law for the `windows` experiment. Values live in `windows.css` (tokens at the top) and `env.ts` (the
environment); this file says what each is for, what was measured, and what the idea breaks.

## 0. Stance

Everything is glass. The interface is three windows (sessions, the session, its overview) standing in one painted
environment, with the tab strip and the composer hung outside the session window as ornaments. Nothing is opaque
except the fills inside a window. It is not a page with translucent cards, not a dark neon dashboard, and not a
frosted sidebar beside a flat sheet (that is `field`). If a decision is ever ambiguous, choose the option that
keeps the text readable on the glass over the one that shows more of the environment.

Axis position:

- density: medium-high, fixed by the brief (a sidebar of nine sessions, a transcript, a side column).
- criticality: high for the approval, ordinary elsewhere; fixed by the brief.
- energy: calm. A person reads here for hours, so nothing moves at rest except a running mark.
- type: one rounded sans at heavy text weights, because glass wants medium or heavier and the brief asks for the
  soft end.
- material model: glass over one plane, spatial register (windows hold content, ornaments hold controls).
- colour commitment: one hue. The environment owns it; the windows are untinted.
- accent job: the thing that waits for the person (the approval), and "on" (a switch, a check, send).
- ground lightness: both, each printed separately; light is the scheme the idea works in.
- ground temperature: warm in light (the orange reaches every body), near neutral in dark.

Rejected vector: calm / system grotesque / glass controls over an opaque sheet / colour in the content / accent on
the primary action / light / warm. That is the instrument register, the safer and more correct reading, and it is
what `instrument` and `field` draw; this experiment exists to find out whether the owner wants the radical one.

Derivation:

- Accent `#FD780F`, the owner's. Rejected: the app's terracotta, which reads as brown under glass. The orange is
  never text: on a light body it measures about 2.6:1.
- Ground: the owner's candidates, as the paper the environment is painted on (knob). Rejected: the ground alone as
  the environment. A flat field gives the lens nothing to bend; Orbit is the closest honest version of it.
- Type: Nunito (variable, the installed latin woff2), then `ui-rounded`, then the system face. Chrome does not
  resolve `ui-rounded` (it fell through to the browser default when tested alone), so the system's rounded face
  cannot be the first family in this lab or in Electron. Korean falls to the system face, which is not rounded.
- Sampler ingredients: geometric sans taken (Nunito). "Gradient or mesh background" declined as painted, since a
  mesh has no fine frequency: the scenes are stepped forms with painted lines. The three sampled stances declined
  because the brief names its own aesthetic.

Signature: the sun under the composer. The environment is a light source and the layout stands on its axis: the
composer sits in the core, the transcript rises out of it, and the rings show in every gap between windows.

Clone test: another agent workstation would share the density and the three columns. It would not share an
environment graded per colour scheme to a measured body level, or a composer hung outside its window.

## 1. Palette

- `--x-orange` is the accent. Jobs: the tinted approval capsule and its platter, switch on, check on, send, the
  approval and running state marks, the focus ring, usage at 80% or more. Never a heading, an icon or body text.
- `--x-ink` is the runtime's published ink, read on children. `--x-ink-2` is authored from it (80% in light, 88%
  in dark) because the runtime's own second level has no margin at window scale. `--x-ink-3` (46%) is for marks
  and rules only, never words.
- Fills inside a window: `--x-lift` and `--x-lift-2` (lighter) mean pressable, selected or current;
  `--x-well` and `--x-well-2` (darker) separate a section or hold an input. Never a lift on a lift.
- `--x-add` and `--x-del` are the only other hues, for diff counts and signs.
- No colour literal outside `windows.css` tokens and `env.ts`, except the traffic lights.

## 2. Type

| role | size / line | weight |
|---|---|---|
| interface | 13.5 / 1.4 | 600 |
| transcript prose, user message, composer | 15 / 1.62 | 600 |
| secondary line | 12 to 13 | 600 to 650 |
| section label | 11.5 to 12, tracking 0.035em | 750 to 800 |
| titles (settings, approval) | 15.5 to 20 | 800 |
| code, paths, commands | JetBrains Mono 12 / 1.62 | 500 to 600 |

Nothing lighter than 500 is on glass. Mono is for code, paths and commands only. Text that does not fit thins out
over its last 16 px instead of ending in dots.

## 3. Material: the record

```
register: spatial. The assigned idea: the product's surfaces are the interface and the world is their environment.
  It breaks the instrument register's first law (no glass in the content layer); this register is what permits
  reading on glass, on ten conditions, and section 8 lists the ones still broken.
environment: one viewport-fixed canvas (`env.ts`), painted at its own box and handed to the root as a texture.
  Three scenes: Sun (stepped rings around a point under the bottom edge), Dunes (six ridges under a calm sky),
  Orbit (ground, thin rings, three small bodies). Broad frequency: the steps. Fine frequency, painted into the
  plane: one bright line per step, hairlines between, and grain. Light print: owner's orange at the core, an amber
  ten degrees yellower, a cream, the ground. Dark print: the amber at encoded 0.21 falling to the ground, with the
  exact orange in the lines only. Nothing in it moves.
windows: sidebar (window, 248 wide, r 28), session (window, r 28, the transcript in a child scroller), overview
  (window, 280 wide, r 28), settings (window, replaces session and overview), new chat (window, 680 x 150).
  Ornaments of the session window: tab strip (capsule, 44 tall, overlay plane, above), composer (r 28, 124 tall,
  overlay plane, below, no wider than the window). Controls: the approval (tinted capsule that morphs into its
  platter); a capsule that appears only while a side window is put away, to bring it back. Platter: the composer's
  options menu. Environment visible around every one.
groups: one per host, all on the environment texture. Each declares the luminance measured under its own box
  (a 192 px copy of the canvas, re-read on paint, resize, layout change and 620 ms after one). Not re-read during
  the 460 ms slide, and the menu's group declares nothing (whole-source average): two lapses.
gaps: derived, never typed: `useGlassSamplingGap` gives 65 px between windows and to ornaments (73 under Reduce
  Transparency) and 24 to 26 between ornament-row groups (40). The largest value seen is kept, so a preference
  opens the layout and never closes it.
family: thickness 8 everywhere. Windows r 28 fixed; capsules at span 44; platters r 22 to 24. Anchor: the window
  corner, 28. Inner radii: 20 at an 8 px inset, 16 at 12, 12 at 16; rows are capsules (16 at 32 tall).
tint: one seed, `rgb(253 120 15 / 82%)`, on the approval capsule and the platter it becomes.
scheme and pose: colorScheme from the lab; windowActivation auto (`pose=` pins it for a capture).
motion: section 7.
tier: WebGPU, refraction true, analysis exact, health ok on every capture. On the CSS tier the body is
  `collapsed` at DPR 1 and 2 (glass covers about three quarters of the viewport); looked at, measured, same design.
fidelity: Apple's macOS material composed in Apple's visionOS way. Spans of 574 to 872 are far past the measured
  bed (160): extrapolated laws, not visionOS glass. Nearest Apple surface: a visionOS window with a tab ornament
  and a toolbar ornament. No native capture was made, so no comparison.
```

### What was measured

`measure.mjs` in this folder reads every visible text line and icon against the pixels behind it (text hidden,
one capture, the line's tenth-percentile pixel). 1440 x 900 at DPR 2 unless said. Floors 4.5 text, 3 large and icons.

Bodies as drawn (encoded level, p10 to p90). The ink dead band is 0.39 to 0.49.

| | windows | composer | approval capsule |
|---|---|---|---|
| light, active | 0.86 to 0.98 | 0.86 to 0.89 | 0.64 |
| light, receded | 0.80 to 0.93 | 0.79 to 0.84 | 0.83 |
| dark, active | 0.18 to 0.26 | 0.29 (Sun), 0.31 (Dunes), 0.20 (Orbit) | 0.51 |
| dark, receded | 0.18 to 0.23 | 0.27 | 0.26 |

Over a strip probe (`probe=1`) the light body never fell under 0.76. The dark body, given a mid-grey footprint,
sat at 0.42 to 0.53: inside the dead band. That is why the dark scheme has its own print.

The full run has no reading under its floor: 16 light routes and 19 dark routes (three scenes, three
environments, four grounds, both poses, scrolled to top with a tool run open, approval open, menu open, Veil,
Sheet, Tight, CSS tier, Reduce Transparency), plus seven routes at 1280 x 800 and 1728 x 1117. It was taken one build before the last three
edits (forced-colours marks, when the gap is set, the console readout); five routes re-run on the last build agree.

| line | light | dark |
|---|---|---|
| transcript prose | 12.5 | 7.2 to 8.0 |
| user message (on a darker fill) | 11.4 | 9.4 |
| diff code | 12.6 | 8.7 |
| sidebar second line | 7.4 | 6.6 |
| composer placeholder, model pill | 6.3 to 6.8 | 5.0 to 5.5 |
| lowest text line | 4.70, a diff plus sign, receded | 4.56, an unselected tab |
| lowest icon | 5.7 | 3.29, the tick in a done mark |
| prose with Reading on Veil / Sheet | 13.7 / 14.8 | 9.6 / 12.0 |

Every line that failed on the way, and what changed:

1. Dark, first print (the orange at 0.29 under the composer): composer body 0.35 to 0.36. Placeholder 3.96 and the
   model pill 3.99. The environment was reprinted at 0.21.
2. Dark, Dunes, after the reprint: the same two lines at 4.47 with the second ink at 80%. Raised to 88% in dark: 5.03.
3. Dark, approval platter (tint settles at 0.52): the runtime's ink read 4.08 to 4.10 on three lines and 3.10 on
   the command in a darker fill; "Allow" read 1.01 (an authoring mistake, ink on ink). The tinted surface now
   carries one authored ink, `#221002`, with lighter fills: 4.62 at worst.
4. Dark, the same platter receded: the tint goes grey (0.25) and the authored dark ink read 1.71 to 1.80. The
   authored ink is keyed to the pose the runtime reports; receded it returns to the runtime's ink: 5.6 at worst.
5. Dark, menu: the highlighted row's value on a 13% lift read 4.13. A dark menu highlights with the 7.5% lift: 5.25.

Not measured, so not claimed: the six to nine lines per route inside a scroller's 22 px faded edge; text that
appears on hover (ages, shortcuts, durations, the usage reset); marks drawn in CSS; frames during a transition;
forced colours (looked at, not measured). A reading is a tenth-percentile pixel, not a worst pixel.

Found by eye and not fixed by any check:

- The material gives a saturated orange back about thirteen degrees redder (`probe=hue`: hue 26 in, hue 13 out), so
  the centre of a light window over the sun is salmon. The amber print reduces it; it is still there.
- At window scale the lens is close to invisible. What the eye gets is a milky pane with a soft shadow and a faint
  rim. Thickness 14 was tried (`thick=14`) and changed nothing visible, so it is not a knob.

## 4. Layout

Composition lines: posture, seated and long; dominant activity, reading the transcript and answering it; unit and
relation, one session in focus among nine listed; co-visibility, the list, the transcript and the session's state
together; temporal structure, a stream that grows downward and opens at its latest turn; volume, nine sessions and
ten transcript items of seven kinds, not homogeneous.

Consequences: the session window is the dominant region and stands on the sun's axis; the sidebar and the overview
are fixed-width peers at the edges; the composer hangs under the window, centred, at most 760 wide; the thread is at
most 728 wide. Only one candidate fit the assignment (three windows and two ornaments are given), so none was rejected.

The cost of the register: at 1440 x 900 with the derived gaps the session window is 754 x 574, a third of the
viewport. The Tight knob (16 and 12 px) shows the layout an eye would draw, with a session window of about
850 x 670; the runtime reports four `group-proxy-overlap` pairs for it.

Putting a side window away slides it past the viewport edge, the session window widens, and a 44 px capsule appears
in the ornament row to bring it back. The traffic lights sit inside the sidebar window at 34, 30 and stay when it leaves.

## 5. Component canon

- State mark: running (ring with an orange arc, turning), approval (orange dot with a halo), question (ink disc
  with a question mark), plan (ink rounded square, outlined), unread (small ink dot), idle (nothing). Shape and
  colour together; the word lives in the accessible name.
- Row: 32 tall capsule; hover is `--x-lift`, current is `--x-lift-2`.
- Fold: one disclosure for the tool run, a project, a setting's help, a quiet session's second line.
- Pill, round button, soft button, chip, toggle chip, switch, segmented control with one travelling thumb.
- Platter: vitrea's popover (approval, morphs from its capsule) and menu (composer options, attached).

What is on screen at rest, against the app today: a session's second line only when it waits for the person (three
of nine), its age on hover; no "Pinned" or "Projects" headings; usage as two rings, the numbers on hover; the
composer shows the model, with effort, mode, folder and branch in its menu and context as a ring; tool-run and
thinking durations on hover; none of the fourteen help sentences on the settings page (each opens from a mark
that appears on its row), and a long path replaced by its version badge.

## 6. Voice

Sentence case, no full stops on labels, no status words where a mark says it. Numbers are tabular.

## 7. Motion

- The runtime's: the approval morphs out of its capsule; the menu platter materialises; the put-away capsule
  materialises and dematerialises (`present`), never fades; press on glass controls is light and compression.
- The page's, on children only: layout slide 460 ms `cubic-bezier(0.32, 0.72, 0, 1)`; fold 380 ms; hover fills
  140 ms; press on fills, a 2 to 8% scale on `cubic-bezier(0.3, 1.36, 0.5, 1)`; switch 380 ms and segmented thumb
  420 ms on the same spring.
- Idle: only the running marks turn (1.1 s). The environment is still.
- Reduce Motion: every page transition collapses to 1 ms and the marks stop.

## 8. What the idea breaks, kept on the record

- Glass in the content layer, the transcript included. The whole experiment.
- Condition 10, no added motion: the page slides its own windows (CSS on the hosts' position, with the root asked
  to re-measure each frame) because a window changing size has no runtime morph.
- Platters over a window on the texture path: the approval platter and the menu open across the session window or
  the composer and sample the environment, not the glass under them.
- A text control and an icon control in one group: the plus button lives in the tab strip.
- A second, small elevation: a 1 px shadow under selected rows and thumbs in light. The windows' own shadow is the
  material's.
- With Reading on Veil or Sheet the window is a pane with an almost opaque sheet on it: no longer reading on
  glass. That is the comparison the knob is for.
- With Room on Tight: the derived gap, as above.

## 9. Hard don'ts

- No background, border, shadow, filter or opacity on a host (`.x-windows-host`) or on any ancestor of the root.
- No orange text. No second tinted surface. No tinted window.
- No type lighter than 500 and no `--x-ink-3` on words.
- No typed gap between groups; no environment that moves; no CSS overlay on the environment.
- No content outside `src/content/fixtures.ts`.

## 10. Knobs and address aids

Knobs: Environment (Sun, Dunes, Orbit); Ground (the four dark and two light candidates, paired); Reading (Glass,
Veil, Sheet); Room between windows (Derived, Tight). Address aids for captures, never design states:
`x=approval,menu,tools,top,help,nosidebar,noside`, `pose=inactive`, `tier=css`, `rt=1`, `dev=1` (the runtime's
checks, the derived gaps and what drew, in the console), `probe=1` and `probe=hue`, `thick=14`.

## To ship this in the app

- The shell. Today the sidebar, toolbar and window paint one flat ground in a grid. This needs a painted canvas
  under everything and each region as a fixed-position glass host, so the shell's geometry (now computed in
  TypeScript) has to publish the window boxes and take the derived gaps as an input. The 44 px toolbar goes; its
  controls move into the windows and the ornament row. The traffic lights move to about 34, 30.
- The material. Vitrea in the renderer with WebGPU on Electron 44, one root, the environment as its texture. No
  window transparency or vibrancy is needed, since the environment is the app's own. The measuring script has to
  run against the real content before a scheme is trusted.
- Tokens. New roles: ink from the runtime with an authored second level, two lifts, two wells, a rule, the tint
  seed, and a radius family (28 / 20 / 16 / 12, capsules) in place of 6 px on nearly everything. Motion needs
  tokens; there are none today.
- Type. Nunito bundled as a local woff2 (remote fonts cannot load), and a decision about Korean, which has no
  rounded face in the stack.
- Menus, popovers and dialogs become glass platters that open from their control; today they appear with no
  motion, each styled at its call site.
- What draws its own colours has to follow the ink pole: syntax colours in code and diffs, the terminal, charts.
  Here only two diff hues do, each chosen per scheme and measured.
- Opaque things stay opaque: a web page in the browser tool, an image, a video sit in a concentric frame inside a
  window and cannot be under glass.
- Appearance settings would gain the environment and a Reduce Transparency switch (the engine cannot always answer
  that query, and the gap and the frost both follow it).
- Open questions for the real app: a transcript of hundreds of items scrolling inside a glass window under load;
  two split panes (a fourth window breaks the register's count); what the environment is when the window is small.
