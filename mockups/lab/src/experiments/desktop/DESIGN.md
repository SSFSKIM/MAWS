# Desktop

Experiment `desktop` of the MAWS design lab. The contract is `mockups/lab/BRIEF.md`; this file is the record a later
reader needs to rebuild the look or to judge it against its own rules.

## 0. Stance

An opaque, calm Mac window in the system face on the owner's ground, interrupted by one pane that is not the app's at
all: the sidebar is the Mac's own sidebar material and shows the desktop behind the window. The app paints no colour
field, no gradient and no glass of its own. Its one colour is the owner's orange, placed where AppKit places an
accent. Menus and popovers are the only other translucent thing, as they are on a Mac.

It is not Liquid Glass: nothing refracts, nothing floats over content, and the glass library (vitrea) is not used.
It is the macOS 15 behind-window sidebar material in the inset, concentric shape macOS 26 gave sidebars.

If a decision is ever ambiguous, choose what a native Mac app would do, and between two native options the calmer one.

Axis position:

- density: standard, leaning dense in the sidebar (32 px rows): many sessions are supervised at once, one is read in depth.
- criticality: transactional with one consequential act (approving a push), so that act is opaque about what it runs.
- energy: quiet. The work is long and the person looks at this all day.
- type: neutral sans, the platform's own (SF through the system stack), because the stance is "a native Mac app".
- material model: tonal everywhere, plus exactly one behind-window material (the pane) and the platform's menus.
- colour commitment: restrained. Chromatic surface the app owns is under 2%; the pane's colour is the user's.
- accent job: directional, in AppKit's sense: where a person acts or is waited on, switch on-state, the default button, focus.
- ground lightness: both, designed separately; light is the default as in the app today.
- ground temperature: the owner's candidates, warm `#faf9f5` and `#191919` by default; neutrals are the ink at an alpha.

Rejected vector: lively / characterful display face / glass over an app-owned colour field / committed colour /
atmospheric accent. That is the modal answer to "glass on top of the colours" and other experiments draw it; it lost
here because the assignment is that the colours under the glass are the user's.

Rejected values: the accent `systemBlue` (most native, but a second colour that is not the owner's) and a darkened
orange `#d9620a` for text contrast (unneeded: the accent never carries text; a label on it is dark ink, 6.9:1). The
ground `windowBackgroundColor` (`#ececec` / `#1e1e1e`), the most native ground, lost to the owner's candidates.

Sampled ingredients: "hairline everything" (luxury-fashion) is adopted as the 0.5 px rule for every edge. Declined in
one line each: y2k gloss (contradicts an opaque calm window), Bauhaus blocking (the `essential` experiment owns it),
an old-style serif or humanist sans (the assignment fixes the system face), paper texture (nothing is painted on the ground).

Signature: the pane. A rounded hole, concentric with the window corner, through which the desktop shows; the same
window is a different colour on every Mac.

## 1. Palette

Tokens live at the top of `desktop.module.css` and nowhere else.

| role | light | dark |
|---|---|---|
| `--ground` (knob) | `#faf9f5` or `#ffffff` | `#191919`, `#191c19`, `#000000`, `#1f1f1f` |
| `--ink` | `#1b1a18` | `#edece8` |
| `--t1` text | ink | ink |
| `--t2` grey text | ink 64% on the sheet, 70% on the pane | ink 64% |
| `--fill-1/2/3` hover, selected, pressed | ink 4.5 / 8 / 13% | same |
| `--line`, `--line-2` | ink 10 / 18%, drawn 0.5 px | same |
| `--raised` composer, cards, side card | `#ffffff` | ground + white 5.5% |
| `--accent` | `#fd780f`, label on it `#1f1204` | same |
| `--ok`, `--bad` (diff counts and lines only) | `#1d7a3e`, `#c2362a` | `#5fc47e`, `#f2786b` |

Rules: every grey is the ink at an alpha, never a solid grey, so greys take the hue of what is behind them on the
sheet and on the material alike. The accent appears only on: the dot of a session that waits on the person, the
waiting capsule and its Approve button, a switch that is on, the focus ring. It never colours text, icons, headings
or selection; selection is `--fill-2`. Unread is an ink dot and a heavier title, not the accent. Green and red exist
only in diffs. No other hue is written anywhere; the wallpaper file is the desktop, not the app.

## 2. Type

One family, the system's: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Apple SD Gothic Neo'`;
mono is `ui-monospace, 'SF Mono', Menlo`. Weights 400, 500, 600 only.

| role | size / line | weight | where |
|---|---|---|---|
| interface | 13 / 18 | 400 | rows, tabs, menus, settings labels, side card |
| quiet | 12 / 16 | 400, `--t2` | second lines, paths, counts' captions |
| section heading | 11 / 14 | 600, `--t2`, sentence case | sidebar and side-card groups |
| prose | 15 / 24 | 400 | transcript, user bubble (15 / 23), composer (15 / 22) |
| title | 15 / 20 | 600 | settings section titles, the approval's title |
| code | 12.5 / 20 mono | 400 | diffs, commands, branch and file targets |

Mono is for things typed into a shell or a file; never for labels. No uppercase, no letter-spaced labels.

## 3. Canvas and material

The window is opaque ground. Surfaces on it are tonal: one raised step (composer, code and settings cards, the side
card), parted from the ground by a 0.5 px ink line; the only shadow in the window is the composer's soft lift, and
menus cast the platform's menu shadow. Corners are continuous (`corner-shape: squircle` here,
`-electron-corner-smoothing: system-ui` in the app); capsules and circles stay round.

### The material record

```
register: neither of the materialist's two. This is the macOS 15 behind-window sidebar material, a blur of the
  desktop under a system tint, not Liquid Glass. Drawn without vitrea, by assignment.
plane: the person's desktop. Not designed, not chosen, not known: that is the experiment. The lab paints three
  stand-ins (Wallpaper.tsx): Dunes and Tide have a day and a night picture, as the Mac's dynamic wallpapers do;
  Poster is one fixed picture in black, white and red with shapes 100 to 400 px across, which no blur averages away.
inventory: (1) the sidebar pane, 256 px wide, full height less the 8 px gutter, navigation and the session list;
  (2) one menu or popover at a time (usage, model, the approval, a setting's "?", a select). Everything else is
  opaque and tonal.
drawn as: backdrop-filter blur(44px) saturate(1.7) over the painted wallpaper, under a tint. System: rgb(246 246 246
  / .70) light, rgb(30 30 30 / .68) dark. Thin: the same at .42 / .40. Dense: System with the ground at 64% over it,
  the way an app covers a material to make it its own. Menus: rgb(250 250 250 / .78) or rgb(42 42 42 / .74) with
  blur(30px) saturate(1.8). These are an imitation from memory of the system material, not a measurement of it.
shape: the pane is a hole in the body, set flush: a 0.5 px rim and a faint shade under its top edge, and no outer
  shadow, because a hole casts none. It does not float and nothing passes under it.
pose: when the window is not the active one the material is not drawn; the pane becomes ground + ink 5% (ground +
  white 5% in dark) and the traffic lights go grey. The same opaque pane serves prefers-reduced-transparency and
  engines without backdrop-filter; forced colours gives Canvas with a CanvasText border.
motion: the pane never moves. Collapsing slides the opaque sheet over it. Menus grow from their control (scale .9
  to 1 with opacity, 190 ms) and fade out (110 ms).
```

Where this breaks the materialist's laws, on purpose, and what it costs:

- "The backdrop is designed, not inherited." Here it is inherited by definition. Cost: the measured table below.
- "No glass on a list read in place." The pane holds the session list with its states, which is content as much as
  navigation. Cost: the list's grey text is the first thing an unhelpful desktop takes.
- "No hand-rolled blur standing in for the material." True of the lab page only; in the app the system draws it.
- "Glass materialises, never fades." Menus scale and fade, as CSS menus do; nothing here can materialise.
- "Controls float over content that reaches the edges." The pane sits beside the content. That is the older macOS
  model and it is what the cheapest version buys.
- Check 20 (a native capture beside the page's): not made. The nearest Apple surface is Finder's sidebar on macOS 15
  for the material and on macOS 26 for the inset shape.

### Contrast on the pane, measured on rendered pixels

Method: at 1440×900, ground `a`, the pane's contents, the traffic lights and the sidebar toggle are hidden and the
bare material is captured; every fourth pixel of the pane's whole area is a backdrop sample. "primary" and "grey"
are the pane's computed `--t1` and `--t2` composited over each sample; the share is how much of the pane's area puts
grey text under 4.5:1. "dot" is the orange against the material under the three waiting rows. The selected row's
fill is not in these numbers; it holds a title only.

| wallpaper · material | light: primary, grey (area under 4.5), dot | dark: primary, grey (area under 4.5), dot |
|---|---|---|
| Dunes · Thin | 7.4–15.1, **4.09**–5.99 (15%), 1.9–2.2 | 12.1–15.4, 5.84–6.83, 5.4–6.4 |
| Dunes · System | 10.9–15.6, 5.10–6.10, 2.1–2.3 | 13.2–14.8, 6.23–6.71, 5.8–6.3 |
| Dunes · Dense | 14.3–16.3, 5.85–6.21, 2.4–2.5 | 14.3–14.9, 6.58–6.74, 6.4–6.5 |
| Tide · Thin | 6.4–15.7, **3.76**–6.10 (24%), 1.6–2.0 | 12.2–15.6, 5.87–6.89, 5.4–5.8 |
| Tide · System | 10.3–15.9, 4.93–6.14, 2.0–2.2 | 13.2–15.1, 6.24–6.77, 5.9–6.1 |
| Tide · Dense | 14.0–16.5, 5.78–6.25, 2.3–2.4 | 14.4–14.9, 6.59–6.74, 6.4 |
| Poster · Thin | **3.4**–16.0 (31% under 4.5), **2.47**–6.16 (55%), 1.2–2.3 | **2.3**–15.7 (41%), **1.73**–6.92 (60%), **1.1**–3.8 |
| Poster · System | 8.0–16.1, **4.28**–6.18 (29%), 1.4–2.4 | 5.2–15.0, **3.15**–6.76 (43%), 2.4–5.2 |
| Poster · Dense | 12.9–16.4, 5.56–6.23, 2.1–2.5 | 10.6–15.0, 5.35–6.76, 4.8–6.2 |

Reading: System holds on the two calm desktops in both schemes and loses grey text on Poster, over 29% of the pane
in light and 43% in dark; titles stay readable. Thin loses grey text on a calm desktop in light and loses titles on
Poster. Dense holds everywhere and shows little of the desktop. The orange is 2.5:1 on the light ground itself, so
in light the dot is under 3:1 on every desktop: it carries a darker rim of its own hue and is never the only signal
(a waiting row is two lines tall and states its reason). In dark it holds except on Poster. Grey text on the pane is
ink 70% in light, against 64% on the sheet, for this reason. Menus over the pane were not measured.

## 4. Layout

Composition lines: posture operational, a workstation used all day. Dominant activity: read one session and answer
it. Unit and relation: a list of sessions (peers, grouped by project) beside one session in depth beside that
session's facts. Co-visibility: the list, the transcript and the composer are needed at once; the side facts are
glanced at. Temporal structure: a live stream that rests at its newest line. Volume: about ten sessions, a
transcript of mixed item kinds, a handful of facts.

Consequences: three columns, list 264 px (8 px gutter + 256 px pane), reading column flexible with a 720 px measure,
facts 300 px in a card; the reading column is dominant by width and by being the only one with body-size type. The
prior is list beside detail beside inspector, adopted because it is the Mac's own three-pane window; no other
candidate fit a native stance, and a two-pane variant (facts folded into the transcript) was rejected because the
facts change while the person reads.

Geometry, all derived from one anchor, the window corner (26 px, to be measured on the real window):

| thing | inset from its container | radius |
|---|---|---|
| window | | 26 |
| pane; side card | 8 from the window edge | 26 − 8 = 18 |
| rows in the pane and the card; tabs; segmented track | 8 from the pane edge | 18 − 8 = 10 |
| composer; user bubble | free-standing | 18, to rhyme with the pane |
| code, tool and settings cards; menus | free-standing | 14 |
| menu items; blocks inside a menu | 5 from the menu edge | 14 − 5 = 9 |
| buttons, fields, selects; segmented thumb | | 8 |
| capsules: waiting capsule, chips, switches, checks | | half the height |

The traffic lights sit at 22, 22, so their centre line is 28 px down; the sidebar toggle, the tabs, the waiting
capsule and the side card's branch line all centre on that line. Rows are 32 px, menu items 28, controls 28 to 30.

Ledger:

| brief evidence | constraint | forbidden |
|---|---|---|
| "sidebars to glass"; the native reading | exactly one translucent pane | a second translucent region, a tinted toolbar |
| "nothing unnecessarily adds stuff to screen" | a row is its title; the reason shows only where the person is waited on | status words, ages and branches at rest |
| "hard and gauge-like" things | shares are rings (usage, context); working is the Mac's spokes | bars, percentages at rest |
| the waiting approval made findable | orange dot in the list and the tab, an orange capsule on the title line that opens the approval | a banner over the transcript |
| settings called crowded | label and control; help behind a "?" shown when the row is pointed at or focused | printed help under a setting |

## 5. Components

- Row (sidebar, 32 px, radius 10): mark slot 16 px, title, trailing meta that appears on hover. A waiting row adds a
  second line and is the only tall row. Selected is `--fill-2`.
- Marks: orange dot 8 px (waits on you), ink dot 6 px (unread), eight turning spokes (working), nothing (idle).
  Rings only ever mean a share of a whole.
- Tab: a 32 px rounded pill; the active one is filled; the close mark covers the title's end on hover and takes no room.
- Quiet line: one grey sentence for a thought, a folded tool run or agents starting; a tool run opens by growing.
- Block: raised card, radius 14, 38 px head, for a diff or a running command.
- Composer: raised, radius 18, the only lifted thing; queued message as an inner row; ink send or stop circle.
- Menu / popover: one component (`Popover` in `ui.tsx`), one open at a time, drawn above the window.
- Settings: grouped cards; `Switch` (36×22, the knob stretches while pressed), `Segmented` (the thumb slides),
  select, field, check chips; `Help` is the round "?".

## 6. Voice

The fixtures' words, unchanged. The interface adds almost none: "Queued", "Deny", "Approve", "Settings", "Five
hours", "This week". What the app prints today and this hides is still reachable: a row's line, branch and age in
its tooltip, a tool run's duration on hover, a setting's help behind "?".

## 7. Motion

One curve, `cubic-bezier(0.32, 0.72, 0, 1)`, and four durations: 80–120 ms (hover, press, reveal), 240 ms (switch,
segmented thumb, chevrons), 320 ms (folds), 380 ms (sidebar). Press is a 3 to 8% scale-down, never a colour swap.
Nothing moves at rest except the marks of things that are running. `prefers-reduced-motion` removes all of it.

## 8. Hard don'ts

- No second translucent surface; no `backdrop-filter` outside `.pane` and `.pop`.
- No colour painted behind the pane by the app, and no gradient anywhere in the window.
- No accent on text, icons, headings, selection or decoration.
- No solid grey; no hex outside the token block (the wallpaper file excepted).
- No shadow on anything but the composer and menus; no border heavier than 0.5 px.
- No radius outside the table in section 4.
- No status word at rest in the sidebar; no bar or gauge.
- No motion at rest except a running mark.

## What was rejected, and what was found

- An edge-to-edge sidebar strip (macOS 11 to 15): the most literal native reading, but it has no geometry to be
  concentric with and reads as a tinted column. The inset pane makes the one translucent thing an object.
- A material frame around an opaque content card (the common Electron reading): more desktop on screen, so an
  unhelpful one would surround the work; and it is not what a Mac does.
- A pane that floats with a shadow, as macOS 26 sidebars do: a pane that shows what is behind the window cannot
  also float above it.
- Found: the idea is weaker than it sounds in the window alone. Filling the screen, the pane is a softly tinted
  column and the rest is a quiet tonal app; the effect only becomes the point when the window is seen on its desktop
  (the View knob), which is how the owner will actually meet it. And it is not robust: the system's own strength
  fails grey text on a hard picture, most in dark, and the remedy (Dense) is close to no glass.

## To ship this in the app

The app today paints one flat ground on the window, the sidebar and the toolbar, sets an opaque window background
colour, and has no blur, vibrancy or overlay motion; radii are 6 / 10 / 14 / 22 with 6 on nearly everything.

1. Main process: create the window with `vibrancy: 'sidebar'`, `visualEffectState: 'followWindow'` and a
   transparent background colour, stop re-asserting the opaque colour on theme change, and move the traffic lights to
   22, 22. The material, its inactive state and Reduce Transparency then come from the system for free. This needs a
   short spike on the real window: resize behaviour, the first paint, and the window's true corner radius, which is
   the anchor for every other radius here.
2. Renderer: the page background and the shell root become transparent; every region except the pane paints the
   ground. The sidebar needs its own role tokens (tint over the material, grey text strength on it), which do not
   exist today because the sidebar shares the ground token. The lab's `backdrop-filter` on the pane is dropped; only
   the tint layer stays, and Dense is that tint at a higher value.
3. Shape: a window-radius token and radii derived from it (18 / 14 / 10 / 8 and capsules), with
   `-electron-corner-smoothing: system-ui`; today's single small radius on rows, buttons, chips and inputs has to be
   split by role. Tabs become pills instead of hairline-parted squares.
4. Menus: one shared menu and popover primitive with the translucent fill and the grow-in motion; today each call
   site styles its own and none animates. Over the app's native browser views a web blur cannot see the page, so the
   existing cover-with-a-picture path stays.
5. Motion tokens (one curve, four durations) do not exist yet and are needed by the sidebar, folds, menus, switches.
6. A setting, "Sidebar: translucent / solid", is worth shipping with it, because the measured table says some
   desktops need the solid one.
