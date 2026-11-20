# Instrument

Experiment `instrument`, order 40. The materialist guideline's instrument register, applied strictly.

## Thesis

Everything a person reads is ink on one pure ground, edge to edge. The only objects on the screen are a few pieces
of glass, and each one is a control with content passing under it. Glass is used where it has a job and nowhere
else.

The question it answers: when glass is used only where it has a job, is there enough of it for someone who asked
for a glass interface? What the build found is at the end of this file.

## Stance

| line | position | reason |
|---|---|---|
| Density | standard, toward dense | Many sessions are supervised at once, so rows stay 30 px; prose gets 15/24 because it is read at length. |
| Criticality | consequential | An approval pushes code. Task surfaces are opaque, state is never colour alone, the approve action is ink and not the accent. |
| Energy | quiet | An instrument is looked through. One loud thing per view: the control that waits for the person. |
| Type | neutral grotesque, one family and its mono | "Precise" is carried by even stroke, tabular figures and tight tracking at size, not by a display face. |
| Material | glass over a printed plane | Only the floating layer is glass. Beneath it nothing is raised: no cards, no panels, no shadows. |
| Colour | restrained | Monochrome ink at four strengths. Chroma appears in content (a diff, a state) and once in the chrome. |
| Accent job | status only | `#FD780F` means "needs you" and nothing else. Primary actions are solid ink. |
| Ground | pure: `#FFFFFF`, `#000000` | The assignment's. A pure ground makes ink sharpest and gives the glass the most honest test. |
| Temperature | neutral | Warmth is left to the roundness and to the one orange; a warm ground is offered as a knob. |

Commitment: quiet printed ink on a pure ground, interrupted by a handful of glass capsules that content slides
beneath.

Rejected vector: a tonal layout (sidebar a shade off the ground, the side column a raised card). It is what the app
has today and it is the look glass is usually pasted onto; here it would give the glass a band of grey to sit in,
which is the failure the guideline names first.

Rejected values: an orange primary button (the accent would then mean both "press" and "waiting"); `#faf9f5` as
the default light ground (kept as a knob: it makes light glass slightly more visible, and it is the cream the app
already has).

## Composition

Workspace posture; the activity is reading one session while monitoring the others. Three columns on one ground
with no dividing lines: sidebar 264, transcript column 728 (centred in what remains), side column 292. The
transcript is first in the document and dominant. Nothing is a card. The floating layer sits above all three.

Below 1340 px wide the two side columns narrow to 244 and 264. Collapsing the sidebar is the intended narrow
layout: the transcript re-centres and the sidebar becomes the rail.

## The sidebar

Docked, the sidebar is print: rows of ink on the same ground as everything else, with no fill, no hairline and no
shadow. Nothing lies behind it, so glass there would be glass over a flat field. Its separation from the transcript
is the gap alone.

Collapsed, it leaves the plane and becomes a floating glass rail (44 wide, capsule) holding the four destinations,
one mark per session that is not idle, and the usage meter. The rail is glass because it now floats over the
ground the transcript has re-centred into. The rail materialises through the runtime's `present`; it does not fade.

A session row shows its title and a mark. A second line appears only when the session needs the person, because
that line is then an instruction ("Wants to push fix/upload-retry"). The age replaces the mark on hover.

State marks are shapes first: a thin turning ring (running), an 8 px orange dot (needs you: approval, question,
plan), a 6 px ink dot with a bold title (unread), nothing (idle). The usage meter is a fat ring so that it cannot be
read as the turning one.

## Glass inventory

At rest, four; five with the sidebar collapsed. Transient platters open from two of them.

| surface | role | shape | span | what is under it |
|---|---|---|---|---|
| Window group (sidebar toggle, search) | control | capsule | 36 | empty ground; the sidebar list when it scrolls |
| Tabs | control | capsule | 36 | the transcript, passing under while it scrolls |
| Approval ("Approve…") | control, tinted | capsule | 36 | empty ground |
| Composer | control | radius 26 | about 130 | the transcript, passing under while it scrolls |
| Rail (sidebar collapsed) | control | capsule | 44 | empty ground |
| Approval platter | platter | radius 24 | about 270 | the side column |
| Select menu (settings) | platter | radius 20 | about 170 | the rows of the page |

One thickness, 8, across the family. Spans 36 / 44 / 130 straddle the 32 to 96 band. The concentric anchor is the
window corner. Inner controls are fills at radius 15 inside the 18 px capsule (3 px gap); the composer's inner row
is 18 inside 26 (8 px gap).

Each surface is its own sampling group, since each stands alone. Nothing nests: buttons on glass are fills that
press the glass they sit on (`useGlassPress`). No host carries a background, border, shadow or blur of its own.

Tint: one, on the approval, because it is the single thing that must be found before anything is read. The tint
leaves the platter when it opens, so that the question is read on plain glass and the orange stays a mark of
status. The orange dots on tabs and rows are fills, the same hue, the same meaning.

## What the runtime reported

- GPU tier requested and drawn: every group resolves `webgpu`, sampling `css-backdrop`, analysis `hint`, health
  `ok`. Refraction resolves `approximate`, not `true`: true refraction needs a texture plane, and this plane is live
  DOM text. That is the DOM path's ceiling and it is the path the assignment names.
- Dev-mode diagnostics: zero, on every captured route, both schemes. `window.__xiDiagnostics`, `__xiGroups` and
  `__xiLevels` hold the findings, the resolved state and the declared levels for a check from the console; none of
  it is drawn.
- CSS tier (no GPU adapter): looked at on purpose in both schemes. It is the same layout with frost and no lens,
  and nothing is lost. The only diagnostic there is `webgpu-unavailable`, which is information.

### Backdrop hints

The DOM path cannot read pixels, so the level under each bar is declared, and it is computed rather than typed:
each transcript block states the mean level of its own box (ground or fill, with the share its glyphs ink), a bar's
footprint takes the blocks under it by area, and the soft scroll edge halves what is under a bar that sits in it.
Fills are blended on encoded values, as CSS blends them. The hint is re-read on scroll and resize. Bars over empty
ground declare the ground.

Declared against measured (mean relative luminance of the footprint, glass hidden, 1440×900):

| phase | tabs declared / measured | composer declared / measured |
|---|---|---|
| light, at the end | 0.96 / 0.93 | 1.00 / 1.00 |
| light, scrolled | 0.91 / 0.95 | 0.95 / 0.95 |
| dark, at the end | 0.04 / 0.03 | 0.00 / 0.00 |
| dark, scrolled | 0.04 / 0.01 | 0.02 / 0.01 |

### Label contrast, measured on rendered pixels

| label | light | dark |
|---|---|---|
| current tab | 11.5 | 5.3 |
| other tabs, composer chips, placeholder | 6.5 to 6.8 | 5.3 to 8.4 |
| approval label on the tint | 6.6 | 6.7 |
| icons in the window group | 18.9 | 15.1 |

Readings were taken at the end of the transcript and with prose passing under the tabs, and agree to 0.3; a bubble or the diff under the tabs was not measured. Secondary labels on glass use the
primary ink at 76 % (light) and 86 % (dark), because the runtime's secondary token measured under 4.5 here.

## Laws bent, and what it costs

- **Glass over a flat field.** The window group, the approval and the rail sit over empty ground and never have
  content under them at this window size. In the light scheme they are a soft shadow and a faint body and no more.
  The pure ground is the assignment; a designed backdrop would be a different experiment (Field).
- **Content under a bar at rest.** A live session is read from its end, so the top of the transcript is already
  under the tabs when the window opens. The bottom clears the composer by the measured inset.
- **Scroll edge.** Soft at both edges: content thins as it goes under a bar. This protects the labels, and it also
  removes most of what the lens would bend at the top. A hard edge would give the glass less still.
- **The select menu** is opened by a fill in the content layer, so its platter materialises beside the control
  rather than growing out of it. The approval platter does grow out of its button.
- **Not checked:** the receded (unfocused) pose, Reduce Transparency, Increase Contrast and forced colours were not
  captured; a headless page keeps focus. Forced-colour rules for authored fills are written and unverified.
- **No native comparison** was made. The nearest Apple surface is a macOS 27 toolbar over a scrolling document.

## Tokens

Defined on `.light` / `.dark` in `instrument.module.css`; components use tokens only.

| role | light | dark |
|---|---|---|
| ground | `#FFFFFF` (knob: `#faf9f5`) | `#000000` (knob: `#191919`, `#191c19`, `#1f1f1f`) |
| ink | `10 10 10` | `245 245 245` |
| ink, secondary / tertiary | 68 % / 56 % | 70 % / 56 % |
| hairline | 9 % | 12 % |
| hover / selected row | 4.5 % / 7.5 % | 7 % / 11.5 % |
| code block / user bubble | 3.5 % / 7 % | 6 % / 13 % |
| solid (send, approve, switch on) | `#0a0a0a` on white | `#f5f5f5` on black |
| added / removed | `#15803d` / `#be2626` | `#4ade80` / `#f87171` |
| accent, status only | `#FD780F` | `#FD780F` |

Type: Geist Variable and Geist Mono Variable (latin woff2, bundled), system fallback behind for Korean. Interface
13/18 at 400 to 500; prose 15/24; composer field 15/22; code 12.5/20; section title 20/26 at 600 with -0.02em.
Figures are tabular wherever they change.

Radii: glass capsules; fills on glass 15; rows and inputs 10; code blocks 14; bubbles 21; composer 26; platters
20 and 24. Opaque shapes use the continuous corner (`corner-shape: squircle`); capsules stay round.

Motion: one ease for layout, `cubic-bezier(0.32, 0.72, 0, 1)`, at 120 / 220 / 380 ms; one light spring for small
round things (switch knob, segmented thumb, press). The sidebar slides out as the transcript re-centres and the
rail materialises. A folded tool run opens by height, and its calls arrive one after another, 28 ms apart. The
glass moves only as the runtime moves it: press, morph, materialise. Nothing moves at idle except the ring of a
turn in flight. Reduced motion collapses every authored transition.

## Signature

The transcript sliding under the composer: one sheet of glass, the size of a hand, with the page moving beneath it.

## Words

At rest a row is its title. Timings, ages, the reset time, shortcuts and the tool calls appear on hover, focus or
expanding. Settings rows are a label and a control; the sentence the app prints under each one waits in the right
margin and appears when the row is pointed at or focused. Rows of checkboxes and switches became pills. A button
that says what it does has no label beside it.

## Rejected

- A glass sidebar. Nothing is behind it.
- A toolbar band behind the tabs. A bar in its own strip of background is a page wearing the material.
- Solid ink user bubbles. They gave the glass something dramatic to pass over and made the person's own words the
  loudest thing on the page.
- The clearer of the two measured macOS 27 materials. On a pure ground it was indistinguishable from the default.
- A home scene. The idea has nothing to add there: an empty ground and a composer.

## What the build found

In the dark scheme the answer is yes. On black, each capsule is a lit object with a rim, the composer is plainly a
sheet of glass, and content darkening and blurring beneath it is visible at reading distance.

In the light scheme the answer is closer to no. White glass over a white ground is a soft shadow; the material
shows only in the seconds when a diff or a bubble is under a bar. Someone who asked for a glass interface would
see a clean white app with round controls. The opaque composer knob makes the point: in light, switching it changes
almost nothing at rest.

So this register gives a refined instrument and, in daylight, very little glass. If light glass must be seen, the
plane has to carry something for it to bend, which is the idea the Field and Signal experiments test.

## To ship this in the app

- Add the glass runtime (`@vitreajs/vitrea-react`) and mount one root around the shell. Chromium in Electron has
  WebGPU, so the GPU tier is available; the CSS tier is the fallback and needs no extra work.
- The shell must stop painting the toolbar as a band. Toolbar, tab strip and composer become fixed, floating
  hosts over a transcript that scrolls the full height of the window; their insets come from `useGlassBarInset`
  and the scroll edges from `useGlassScrollEdge`. The 44 px toolbar row and its hairline go.
- Tabs change structurally: from square cells parted by hairlines to fills inside one capsule.
- The traffic lights stay native; the window group starts at their trailing edge (84 px here).
- New role tokens: a pure ground per scheme, ink at alpha steps, one status accent. The terracotta accent is
  retired from actions; `#FD780F` takes the status job only. The 6 px radius that does every job today splits into
  the scale above.
- Backdrop hints need the app's real geometry: the level under each bar from the transcript's rows, updated on
  scroll. The computation here is a model for it and would be fed by the virtualised transcript's row kinds.
- Menus, popovers and the approval card move onto the runtime's presentations, which also gives every one of them
  an entry motion; today they have none.
- Native browser views cannot sit under glass. Any tab that hosts one needs the bars to fall back to their opaque
  form over it, or the view to end below the bars.
- Fonts: bundle Geist and Geist Mono; no remote loading is needed.
- Motion tokens (three durations, one ease, one spring) do not exist in the app yet and would be added.
