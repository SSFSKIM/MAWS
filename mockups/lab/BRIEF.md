# The design lab: what an experiment is

MAWS is a macOS desktop app for supervising Claude Code agent sessions: many sessions at once in a sidebar, and one
session in depth (transcript, composer, a side column of tools). Its owner wants to renew the whole design system
and, before committing to a direction, to look at many different ones. This lab is where those are drawn. Each
experiment is one complete idea of what the redesign should treat as central, shown on the same invented content, so
that the owner's reaction to each tells us what they value. An experiment that hedges between ideas teaches nothing;
one that commits and turns out wrong is useful.

## What the owner asked for (paraphrased)

- A design that is warm and humane yet modern, even futuristic: refined, intuitive, simple and premium at once.
- Glass material laid over the colours, rounder geometry, smoother animation, and sidebars made of glass.
- Dark ground candidates: `#191919`, `#191c19`, `#000000`, or the lighter `#1f1f1f`. Light ground: `#faf9f5` or
  `#FFFFFF`. Theme orange: `#FD780F`.
- Possibly the Vitrea Liquid Glass library (installed here as `@vitreajs/vitrea-react` 0.29.0).
- On words: there are far too many words on screen today, most of them unnecessary, and nothing should add to the
  screen without need; elements that look hard and gauge-like should become round, soft and friendly;
  information should survive through progressive disclosure (text that appears on expanding or on hover) and through
  graphical meaning (geometry, ground and object, finish and colour) instead of dense description. Claude Desktop is
  the owner's reference for being less descriptive and more intuitive.

These are a proposal with an intent, not a specification. Where an experiment's idea needs to bend one of them (a
different orange for text contrast, no glass at all), bend it and say so in the record.

## The app today, so an experiment knows what it departs from

Light ground `#faf9f6` with white raised surfaces, dark ground `#131313`; one terracotta accent (`#c9663f` light,
`#d97757` dark); radii 6 / 10 / 14 / 22 px, with 6 px on nearly every row, button, chip and input; square tabs parted
by hairlines; 13 px interface text and 14 px / 1.625 transcript prose in the system font; 30 px rows and a 44 px
toolbar; hand-drawn 16 px stroke icons; the sidebar, toolbar and window all paint the same flat ground; no blur or
translucency anywhere; menus, popovers and dialogs appear with no motion at all. The window is a standard macOS
window with the traffic lights inset at the top left. Pictures of it: `../shots/` (early mockups) and the settings
page the owner called crowded is reproduced in `src/content/fixtures.ts` (`help` is the text printed under each
setting today).

## Contract

An experiment lives in `src/experiments/<id>/` and touches nothing outside it.

- `meta.ts` exports `experiment: Experiment` (`src/lab/types.ts`): id, order, name, a one-sentence thesis, notes on
  what to look at, the scenes it draws, its knobs, and a lazy `Component`. `src/experiments/smoke/` is a working
  example with a glass root, a painted texture plane and a state readout.
- The component fills the browser viewport and is the app window's content. Draw the traffic lights so the top-left
  clearance is honest. It receives `scene`, `scheme` (`light` | `dark`) and the current knob values.
- Content comes from `src/content/fixtures.ts` and from nowhere else; do not invent other sessions or settings. You
  decide what of it is on screen at rest, on hover, on expanding, or not at all.
- Scenes. `session` (required): the whole window with the sidebar (destinations, pinned, projects, sessions in every
  state, usage), tabs, the transcript with every item kind, the composer, the side column, and the waiting approval
  made findable. `settings` (required): the settings page, at least Engine, Appearance and Notifications. `home`
  (optional): the new-chat state. `overview` and `file` (optional, added after round 2 and drawn by Layers alone so
  far, section 18 of its DESIGN.md): every live or unread session across projects with the waiting ones answerable
  in place, and a changed file opened as a tab beside its session. `artifacts` and `customize` (optional, also
  Layers alone, its section 21): the library of what sessions made, and what Claude has been given in one place.
- Both colour schemes, each designed, at 1280×800 through 1728×1117 (1440×900 is the size captures use).
- It is a live page, and motion is one of the things being judged. These work for real, with the motion the
  experiment argues for: collapsing the sidebar, opening one menu, expanding a folded tool run, hover and focus and
  pressed states, the switches and segmented controls on the settings page.
- Knobs are for choices the owner should flip while looking: always the ground candidates that fit your idea, plus
  whatever your idea turns on (strength of an effect, how much text shows at rest). Three or four knobs at most.
- Styles are CSS modules or carry a `.x-<id>` prefix: the build inlines every experiment into one page.
- Fonts: the macOS system families (`system-ui`, `ui-rounded`, `ui-serif`, `ui-monospace`) or one of the installed
  `@fontsource-variable/*` packages, declared with your own `@font-face` on the package's latin `woff2` only. The
  real app cannot load remote fonts. Text can be Korean; leave the system fallback in the stack. Icons: `lucide-react`
  or your own.
- Corners: the real app runs on Electron 44, which draws continuous (squircle) corners with
  `-electron-corner-smoothing: system-ui`; the lab's Chrome shows the same shape with `corner-shape: squircle`. Use
  it or not as your stance decides.
- Dependencies are installed already and several agents share this folder, so run no install: work with what is
  there and name what you lacked when you hand back.

## Building and looking

Other experiments are being built in this folder at the same time, so always build your own alone:

    ONLY=<id> OUT=dist-<id> npx vite build
    OUT=dist-<id> node tools/shot.mjs shots/<id> '<id>/session' '<id>/session?scheme=dark' '<id>/settings' …

`shot.mjs` drives the installed Chrome headless with WebGPU on and prints console warnings and errors beside each
capture; open the PNGs with the Read tool. Captures are how you see your own work: look, judge it as a designer
would, and revise, several times, before handing back. The machine is heavily loaded, so capture a few routes per
round, not everything every time. Typecheck with `npx tsc --noEmit` (it covers every experiment; errors outside your
folder are someone else's work in progress).

## How to design it

Load the designer plugin's skill (your dispatch gives its path) and follow its practice, with the persona and
sampler rules as it states them, and the references it routes to. When your experiment uses glass, read the same
plugin's `skills/materialist/SKILL.md` end to end before drawing a surface, and its `references/vitrea.md`; the
library's own README is in `node_modules/@vitreajs/vitrea-react/`. The
materialist's laws say where glass has a job and where it does not. An experiment whose assigned idea breaks a law
(for example, text on glass windows) keeps the idea and records which law it breaks and what that costs: finding
out whether the owner likes it anyway is the point.

Write `DESIGN.md` in your folder: the thesis, the stance lines with reasons, the glass inventory if any, the token
values, the signature element, what you rejected, and a last section "To ship this in the app" naming what the real
renderer would need (use "The app today" above). Keep it to what a later reader needs to rebuild the look.

## Handing back

Report: what the experiment argues; the capture paths; the two or three things the owner should look at first; what
you think is weakest in it; anything the lab or the glass library got in your way with. Do not commit or stage
anything: several agents share this checkout, and the dispatcher commits.
