# Spike: what Chromium keeps of a window's zoom, and where the six placements land (UX wave U6b-5b, M1)

The execution document is `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md`, M1. This spike's verdict decides
whether M2 starts. This file has two parts. The first says how the evidence is made: the harness here, the four probe
scenes, and the look. The second holds the results of each run, copied in with the command that produced them.

## The harness (rows a to j)

`node run.mjs [--only=<row,row>] [--setuid-sandbox]`, run from this folder. Each part of a row is one launch of
`main.mjs`, run on the repository's own Electron (44.4.5 at the pin) with a scratch profile of its own under
`runs/<time>/profiles/`. `runs/` is ignored by git. The harness imports nothing from `src/` and has no dependency of
its own. Its window is made the way `createWindow` makes the app's: a `file:` page, sandboxed, context-isolated, with
no Node. On Linux with no display, `run.mjs` runs itself again under `xvfb-run`.

It prints one line per row:

    RECORD <row> <PASS|FAIL|RECORD|NOT RUN> {the row's decisive values}

`runs/<time>/results.json` holds every part in full. Each launch's own output is in `runs/<time>/<label>.log`.

| row | the launches | the verdict |
|---|---|---|
| a | default mode, the page set to 1.5, `app.quit()`; then the stand-in (no zoom mode, no zoom call, the same file URL) on that profile | RECORD: the stand-in's factor; each `zoom` key of the profile's `Preferences` after the zooming launch and after the stand-in |
| b | as a, ended by SIGKILL at the `ZOOMED` line, and again 15 s after it | RECORD, the same, twice |
| c | as a, the window made with `zoomMode: 'isolated'` | PASS when the stand-in opens at 1 (by `getZoomFactor()` and by the page's own `devicePixelRatio`) |
| d | as c, ended by SIGKILL at once and 15 s later | PASS, as c, for both |
| e | isolated, at 0.5 and at 2: a reload, then a load of the same file with another query | RECORD: the factor after each load (`applyAfterLoad` is built when it is lost) |
| f | isolated, at 0.5 and at 2: f1 `webPreferences.zoomFactor`; f2 a call at `dom-ready`; f3 a call at `ready-to-show` and the window shown at the next painted frame; f0, the control at 1 | PASS when a way has the factor in force at the show and the capture taken at the show has the red line's ink at the factor times f0's height, within 10 %, at both factors; `openAt` is the first such way. FAIL (a stop) when no way passes |
| g | the page at 1.5, once in default mode and once isolated, beside the same file with another query (the presenter's shape) and another file (the repair page's shape), each opened before the zoom and again after it | RECORD: the other windows' factors |
| h | isolated, at 0.5 and at 2: a `WebContentsView` of another partition placed over the page's box by decision 27's rule | PASS when the view's factor is 1, its bounds are the box times the factor edge by edge, and its page is that many CSS pixels wide |
| i | isolated | PASS when `setZoomMode` is a function and, where `getZoomMode` exists, it answers `isolated` |
| j | row h's window at 1.25, moved to a display of another scale and back | NOT RUN without such a display; otherwise PASS when the app's factor stays 1.25 and the view stays on the box times the factor. `devicePixelRatio` is recorded but not judged |

The 15 s before a forced exit is a wait the run makes. It is not a bound the run asserts.

## The probe scenes (placements 1 to 6, and the peers)

Each scene below is skipped unless `MAWS_ZOOM_PROBE=1`. Each sets the app window's zoom in main
(`webContents.setZoomFactor`) at 0.5, 0.8, 1.25 and 2, and waits until the app's page is laid out at that factor. It
then waits on the observation the document names for each placement, and ends in lines of the form
`[zoom-probe] RECORD {json}`. The same lines go into the test's annotations as `zoom-probe`. Every line carries `off`,
which is the document's condition for that placement, computed from the numbers beside it. No line asserts anything.

| scene | file | what it waits on |
|---|---|---|
| "zoom probe: the view, the lights, the device box" | `e2e/browser.spec.ts` | `placedOn` (main's acknowledgment of the pane's rect); for the device box, `placedOn` after Mobile is chosen |
| "zoom probe: the popup and the menu" | `e2e/browser-chrome.spec.ts` | the seam's `popup()` answering; the menu record changing (`menuAfter`), then `at()` |
| "zoom probe: the pin" | `e2e/browser-comment.spec.ts` | the card for the pick being drawn, and its caret naming the pick's position |
| "(zoom probe) …" | `e2e/cross-build.spec.ts` | each launch's `s.ready(page)` |

The look: run the first scene with `MAWS_ZOOM_PROBE_HOLD=1 MAWS_E2E_QUIET=0`. At each factor it stops with the window
shown (`page.pause()`) on a page of 48 numbered cells (`/cells.html`). After you resume, the next line records which
cells took the presses made at the frame's corners.

## Results

### Build VM (Linux)

2026-11-17, at `c701fbafc`, command `cd spikes/zoom-probe && timeout 900 node run.mjs`. **Not run.** The run stopped before
any Electron started, at the sandbox helper check:

    chrome-sandbox at <the VM's checkout>/node_modules/electron/dist/chrome-sandbox is not setuid root; pass --setuid-sandbox to set it with sudo -n

The VM has no `DISPLAY` but has `xvfb-run`, which `run.mjs` would have used. `--setuid-sandbox` was not passed: it
changes the VM's checkout, which was not ruled for this run. Both files pass `node --check`.

### Mac

Pending the architect's run ("Proof that an executor does not run", rows 2 to 4).
