# Spike: what Chromium keeps of a window's zoom, and where the six placements land (UX wave U6b-5b, M1)

The execution document is `docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md`, M1. This spike's verdict decides
whether M2 starts. This file has two parts. The first says how the evidence is made: the harness here, the four probe
scenes, and the look. The second holds the results of each run, copied in with the command that produced them.

## The harness (rows a to j)

`node run.mjs [--only=<row,row>] [--setuid-sandbox]`, run from this folder. Each part of a row is one launch of
`main.mjs`, run on the repository's own Electron (44.4.5 at the pin) with a scratch profile of its own under
`runs/<time>/profiles/`. `runs/` is ignored by git. The harness imports nothing from `src/` and has no dependency of
its own. Its window is made the way `createWindow` makes the app's: a `file:` page, sandboxed, context-isolated, with
no Node. Every window is shown inactive (`showInactive`), so a run on a shared Mac never takes the keyboard; `--look`
shows them in front for a person looking. On Linux with no display, `run.mjs` runs itself again under `xvfb-run`. What
it prints and stores names this folder `<harness>`, the checkout `<checkout>` and the home folder `<home>`, and a record
that would still hold a path of the machine stops the run (`scrub.mjs`, held by `node --test scrub.test.mjs`).

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
| f | isolated, at 0.5 and at 2: f1 `webPreferences.zoomFactor`; f2 a call at `dom-ready`; f3 a call at `ready-to-show` and the window shown at the next painted frame; f0, the control at 1 | PASS when a way stood (f3: a frame was painted after the call before the show; a show after the wait's bound is a fixed delay, so f3 did not stand) and has the factor in force at the show, with the capture taken at the show holding the red line's ink at the factor times f0's height, within 10 %, at both factors; `openAt` is the first such way. FAIL (a stop) when no way passes |
| g | the page at 1.5, once in default mode and once isolated, beside the same file with another query (the presenter's shape) and another file (the repair page's shape), each opened before the zoom and again after it; and a propagation control: in default mode a window at the page's own URL, which the zoom must reach; in isolated mode a default-mode window of a third file zoomed through a twin at its URL | RECORD: the other windows' factors, read once the control's page has reached 1.5 (bounded); a control that never does is `FAIL (an experiment did not stand)` |
| h | isolated, at 0.5 and at 2: a `WebContentsView` of another partition placed over the page's box by decision 27's rule | PASS when the page laid out at the factor (else `FAIL (an experiment did not stand)`), the view's factor is 1, its bounds are the box times the factor edge by edge, and its page is that many CSS pixels wide |
| i | isolated | PASS when `setZoomMode` is a function and `getZoomMode()` answers `isolated`; without the getter the preference is not shown to have taken: FAIL |
| j | row h's window at 1.25, moved to a display of another scale and back | NOT RUN only when the launch reports no such display (a launch with no answer is a FAIL); otherwise, once the window has reached each display and the page has settled at 1.25 there, PASS when the app's factor stays 1.25 and the view stays on the box times the factor. `devicePixelRatio` is recorded but not judged |

Rows a to d stand only when the zooming launch set 1.5 in the mode asked (`set`, read right after the call) and ended the way asked: a quit with exit 0, or a SIGKILL timed from the `ZOOMED` mark, which is printed right after the call and before the renderer's layout is observed. A part that does not stand makes its row `FAIL (an experiment did not stand)`, never a PASS. The 15 s before a forced exit is a wait the run makes. It is not a bound the run asserts.

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
| "(zoom probe) …" | `e2e/cross-build.spec.ts` | each launch's `s.ready(page)`; for the kill after a write, the write control's key in `Preferences` (bounded; "not established" when it never comes) |

The cross-build probe names each build's page URL (by placeholder: `<this build>`, `<the peer>`) and whether its zoom
key is this build's: a default-mode zoom of a file page is keyed by its whole URL less the fragment, query included,
so the peer's factor is P7 evidence only on the same key, and the relaunch is a same-URL reading only on it. This build relaunched on the profile is the same-URL reading: the control in default mode (1.5 shows a kept zoom
can be seen), P7's own observation in isolated mode. The forced exit at once is a labelled extra. The device box's
ample room is taken by the separator, by the sheet as it stands, or by Expand surface; the menu's threshold needs a
separator and is otherwise recorded as one sample, unestablished. The popup's two predictions go through
`popupBounds`' clamp, mirrored in `e2e/support/zoom-probe.ts` (`popupPlace`), with the popup's real size and the
window's content size.

**The seams.** `tab(id).placed` is written in the product too: `ViewManager` keeps its `WeakMap` for every placement it
acts on, whether or not the e2e runs, and only the e2e inspector reads it (Decision Log 8, accepted). The menu seam's
`at()` is recorded only on the e2e path.

The look: run the first scene with `MAWS_ZOOM_PROBE_HOLD=1 MAWS_E2E_QUIET=0`. At each factor it stops with the window
shown (`page.pause()`) on a page of 48 numbered cells (`/cells.html`). After you resume, the next line records which
cells took the presses made at the frame's corners.

## Results

### Build VM (Linux)

**2026-11-17, at `ca7d21a89`, the run of record.** Linux x64 under Xvfb, one display at scale 1, Electron 44.4.5. The
command was `vmcheck 'cd spikes/zoom-probe && timeout 900 node run.mjs --setuid-sandbox'`, run on the wave's build VM 7.
Both `sudo -n` acts on the checkout's own `chrome-sandbox` succeeded. It exited 0 and printed:

    RECORD a RECORD [{"end":"quit","valid":true,"standin":1.5,"prefs":{"Preferences":[{"key":"partition.per_host_zoom_levels","value":{"2173999853352618532":{"<harness>/page/index.html":2.223901085741545}}}]}}]
    RECORD b RECORD [{"end":"kill-now","valid":true,"standin":1,"prefs":{}},{"end":"kill-15s","valid":true,"standin":1.5,"prefs":{"Preferences":[{"key":"partition.per_host_zoom_levels","value":{"1619945040490033073":{"<harness>/page/index.html":2.223901085741545}}}]}}]
    RECORD c PASS [{"end":"quit","valid":true,"standin":1,"prefs":{"Preferences":[]}}]
    RECORD d PASS [{"end":"kill-now","valid":true,"standin":1,"prefs":{}},{"end":"kill-15s","valid":true,"standin":1,"prefs":{"Preferences":[]}}]
    RECORD e RECORD [{"at":"factor 0.5","afterReload":0.5,"afterLoad":0.5},{"at":"factor 2","afterReload":2,"afterLoad":2}]
    RECORD f PASS {"openAt":"f1","ways":[{"way":"f0 (the control, at 1)","stood":true,"atDomReady":1,"atShow":1},{"way":"f1 at 0.5","stood":true,"atDomReady":0.5,"atShow":0.5,"inkRatio":0.485,"ok":true},{"way":"f1 at 2","stood":true,"atDomReady":2,"atShow":2,"inkRatio":1.939,"ok":true},{"way":"f2 at 0.5","stood":true,"atDomReady":0.5,"atShow":0.5,"inkRatio":0.485,"ok":true},{"way":"f2 at 2","stood":true,"atDomReady":2,"atShow":2,"inkRatio":1.939,"ok":true},{"way":"f3 at 0.5","stood":true,"atDomReady":1,"atShow":0.5,"inkRatio":0.485,"ok":true},{"way":"f3 at 2","stood":true,"atDomReady":1,"atShow":2,"inkRatio":1,"ok":false}]}
    RECORD g RECORD [{"mode":"default","established":true,"control":{"by":"first, at its own URL","took":true,"factor":1.5},"first":1.5,"openBefore":{"present":1,"repair":1},"openedAfter":{"present":1,"repair":1}},{"mode":"isolated","established":true,"control":{"by":"a twin at a third file","took":true,"factor":1.5},"first":1.5,"openBefore":{"present":1,"repair":1},"openedAfter":{"present":1,"repair":1}}]
    RECORD h PASS [{"at":"factor 0.5","viewFactor":1,"want":{"x":20,"y":60,"width":200,"height":120},"bounds":{"x":20,"y":60,"width":200,"height":120},"inner":{"width":200,"height":120}},{"at":"factor 2","viewFactor":1,"want":{"x":80,"y":240,"width":800,"height":480},"bounds":{"x":80,"y":240,"width":800,"height":480},"inner":{"width":800,"height":480}}]
    RECORD i PASS {"part":"api","setZoomMode":"function","getZoomMode":"function","mode":"isolated","electron":"44.4.5"}
    RECORD j NOT RUN {"part":"move","notRun":true,"displays":[{"id":60,"scale":1}]}

What the VM can say:

- **P7 stands on Linux (rows c and d).** An isolated zoom is kept nowhere: after a quit, after an immediate SIGKILL,
  and after a SIGKILL 15 s later, the stand-in opened at 1 and `Preferences` held no zoom key.
- **A default-mode zoom is kept (rows a and b), and keyed by the page's file URL, not by a host.** The key is
  `partition.per_host_zoom_levels.<hash>.<the page's file URL>`, at level 2.2239 (1.2 to that power is 1.5). It is
  written on a quit and within 15 s of the call. It is not written before an immediate SIGKILL, which leaves no
  `Preferences` file at all.
- **Row e: an isolated zoom survives a reload and a load of the same file with another query,** at 0.5 and at 2.
  `applyAfterLoad` is not needed, if the Mac agrees.
- **Row f: `openAt` is f1** (`webPreferences.zoomFactor` at creation). f1 and f2 have the factor in force at the show
  and the capture at the factor, at both factors, in all three runs (`e641ef3e7`, `d78e60abf`, `ca7d21a89`). f3 is not
  reliable: at 2 it failed in two of the three runs, both times with a painted frame before the show (`stood`) and
  `getZoomFactor()` reading 2, while the capture taken at the show still had its ink at 1.0. What a window paints
  first is the platform's, so the Mac's run decides.
- **Row g: no other window takes the zoom, in either mode, and the propagation control was established in both.**
  Neither the same file with another query nor another file takes it, whether opened before the zoom or after it. In
  default mode, a window at the page's own URL took 1.5; in isolated mode, a twin's zoom reached a window of a third
  file. Both were read before the others.
- **Row h: a child view of another partition keeps its own factor at 1,** and takes decision 27's bounds as given,
  with its page that many CSS pixels wide.
- **Row i: Electron 44.4.5 has `setZoomMode` and `getZoomMode`,** and a window made with `zoomMode: 'isolated'` reads
  back as isolated.
- **Not applicable on the VM:** row j (one display, at one scale), the traffic lights and the title bar, and whether
  a first paint on macOS matches the capture.

Earlier runs: at `e641ef3e7` the lines' labels were overwritten by a bug in `run.mjs`, fixed in `d78e60abf`. At
`d78e60abf` every row read as here, except f3 at 2, which passed. At `ca7d21a89` the rows gained their controls: f3's
and h's `stood`, and g's propagation control.

### Mac

Pending the architect's run ("Proof that an executor does not run", rows 2 to 4).
