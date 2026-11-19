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

### Mac (the run of record for rows 2 and 3; 2026-11-19, at `76d0bbc9d`)

**Row 2, the harness** (manual gate `76d0bbc9de40-20261119T113742Z`, on the Mac mini's host: darwin arm64, one display at
scale 2, Electron 44.4.5, exit 0). The verdicts match the VM's run of record; f3 passed at 2 here.

    RECORD a RECORD [{"end":"quit","valid":true,"standin":1.5,"prefs":{"Preferences":[{"key":"partition.per_host_zoom_levels","value":{"14321395447377900560":{"<harness>/page/index.html":2.223901085741545}}}]}}]
    RECORD b RECORD [{"end":"kill-now","valid":true,"standin":1,"prefs":{}},{"end":"kill-15s","valid":true,"standin":1.5,"prefs":{"Preferences":[{"key":"partition.per_host_zoom_levels","value":{"1121364126665634805":{"<harness>/page/index.html":2.223901085741545}}}]}}]
    RECORD c PASS [{"end":"quit","valid":true,"standin":1,"prefs":{"Preferences":[]}}]
    RECORD d PASS [{"end":"kill-now","valid":true,"standin":1,"prefs":{}},{"end":"kill-15s","valid":true,"standin":1,"prefs":{"Preferences":[]}}]
    RECORD e RECORD [{"at":"factor 0.5","afterReload":0.5,"afterLoad":0.5},{"at":"factor 2","afterReload":2,"afterLoad":2}]
    RECORD f PASS {"openAt":"f1","ways":[{"way":"f0 (the control, at 1)","stood":true,"atDomReady":1,"atShow":1},{"way":"f1 at 0.5","stood":true,"atDomReady":0.5,"atShow":0.5,"inkRatio":0.482,"ok":true},{"way":"f1 at 2","stood":true,"atDomReady":2,"atShow":2,"inkRatio":1.964,"ok":true},{"way":"f2 at 0.5","stood":true,"atDomReady":0.5,"atShow":0.5,"inkRatio":0.482,"ok":true},{"way":"f2 at 2","stood":true,"atDomReady":2,"atShow":2,"inkRatio":1.964,"ok":true},{"way":"f3 at 0.5","stood":true,"atDomReady":1,"atShow":0.5,"inkRatio":0.482,"ok":true},{"way":"f3 at 2","stood":true,"atDomReady":1,"atShow":2,"inkRatio":1.964,"ok":true}]}
    RECORD g RECORD [{"mode":"default","established":true,"control":{"by":"first, at its own URL","took":true,"factor":1.5},"first":1.5,"openBefore":{"present":1,"repair":1},"openedAfter":{"present":1,"repair":1}},{"mode":"isolated","established":true,"control":{"by":"a twin at a third file","took":true,"factor":1.5},"first":1.5,"openBefore":{"present":1,"repair":1},"openedAfter":{"present":1,"repair":1}}]
    RECORD h PASS [{"at":"factor 0.5","viewFactor":1,"want":{"x":20,"y":60,"width":200,"height":120},"bounds":{"x":20,"y":60,"width":200,"height":120},"inner":{"width":200,"height":120}},{"at":"factor 2","viewFactor":1,"want":{"x":80,"y":240,"width":800,"height":480},"bounds":{"x":80,"y":240,"width":800,"height":480},"inner":{"width":800,"height":480}}]
    RECORD i PASS {"part":"api","setZoomMode":"function","getZoomMode":"function","mode":"isolated","electron":"44.4.5"}
    RECORD j NOT RUN {"part":"move","notRun":true,"displays":[{"id":5,"scale":2}]}

**Row 3, the placement probes** (manual gate `76d0bbc9de40-20261119T121210Z`).

`e2e:browser` (host), "zoom probe: the view, the lights, the device box", passed, with 20 lines:

    {"probe":"view","placement":1,"factor":0.5,"appFactor":0.5,"pane":{"x":1173,"y":141,"width":1380,"height":1492},"bounds":{"x":1173,"y":141,"width":1380,"height":1492},"paneTimesFactor":{"x":587,"y":71,"width":690,"height":746},"placed":{"rect":{"x":1173,"y":141,"width":1380,"height":1492},"count":2},"off":true}
    {"probe":"pointer","factor":0.5,"frameNotView":444436,"viewNotFrame":1988656,"edges":{"left":586,"top":70,"right":1276,"bottom":816},"off":true}
    {"probe":"lights","placement":5,"factor":0.5,"lights":{"x":16,"y":15},"assumed":{"diameter":14,"span":54},"toolbarPt":22,"lightsCentrePt":22,"toolbarCentrePt":11,"lightsRightPt":70,"clearPt":39,"off":true}
    {"probe":"look: the cells pressed","factor":0.5,"cells":[]}
    {"probe":"view","placement":1,"factor":0.8,"appFactor":0.8,"pane":{"x":789,"y":140,"width":804,"height":878},"bounds":{"x":789,"y":140,"width":804,"height":878},"paneTimesFactor":{"x":631,"y":112,"width":643,"height":702},"placed":{"rect":{"x":789,"y":140,"width":804,"height":878},"count":3},"off":true}
    {"probe":"pointer","factor":0.8,"frameNotView":124496,"viewNotFrame":379022,"edges":{"left":158,"top":28,"right":319,"bottom":204},"off":true}
    {"probe":"lights","placement":5,"factor":0.8,"lights":{"x":16,"y":15},"assumed":{"diameter":14,"span":54},"toolbarPt":35.1953125,"lightsCentrePt":22,"toolbarCentrePt":17.59765625,"lightsRightPt":70,"clearPt":62.400000000000006,"off":true}
    {"probe":"look: the cells pressed","factor":0.8,"cells":[]}
    {"probe":"view","placement":1,"factor":1.25,"appFactor":1.25,"pane":{"x":415,"y":158,"width":602,"height":491},"bounds":{"x":415,"y":158,"width":602,"height":491},"paneTimesFactor":{"x":519,"y":198,"width":752,"height":613},"placed":{"rect":{"x":415,"y":158,"width":602,"height":491},"count":4},"off":true}
    {"probe":"pointer","factor":1.25,"frameNotView":236378,"viewNotFrame":70984,"edges":{"left":-104,"top":-40,"right":-254,"bottom":-162},"off":true}
    {"probe":"lights","placement":5,"factor":1.25,"lights":{"x":16,"y":15},"assumed":{"diameter":14,"span":54},"toolbarPt":55,"lightsCentrePt":22,"toolbarCentrePt":27.5,"lightsRightPt":70,"clearPt":97.5,"off":true}
    {"probe":"look: the cells pressed","factor":1.25,"cells":[]}
    {"probe":"view","placement":1,"factor":2,"appFactor":2,"pane":{"x":29,"y":203,"width":604,"height":200},"bounds":{"x":29,"y":203,"width":604,"height":200},"paneTimesFactor":{"x":58,"y":406,"width":1208,"height":400},"placed":{"rect":{"x":29,"y":203,"width":604,"height":200},"count":5},"off":true}
    {"probe":"pointer","factor":2,"frameNotView":483200,"viewNotFrame":120800,"edges":{"left":-29,"top":-203,"right":-633,"bottom":-403},"off":true}
    {"probe":"lights","placement":5,"factor":2,"lights":{"x":16,"y":15},"assumed":{"diameter":14,"span":54},"toolbarPt":88,"lightsCentrePt":22,"toolbarCentrePt":44,"lightsRightPt":70,"clearPt":156,"off":true}
    {"probe":"look: the cells pressed","factor":2,"cells":[]}
    {"probe":"device box","placement":6,"factor":0.5,"workArea":{"x":0,"y":30,"width":2560,"height":1358},"sheet":false,"sheetRoom":null,"ampleBy":"the separator","room":440,"ample":true,"straddles":true,"placed":{"x":4706,"y":159,"width":375,"height":812},"element":{"read":375,"predicted":375},"frameDrawnPt":{"read":187.5,"predicted":187.5},"view":{"read":375,"predicted":375},"innerWidth":{"read":375,"predicted":375},"chip":{"read":"375 × 812","predicted":"375 × …"},"offers":[{"room":370,"offered":false,"predicted":false},{"room":380,"offered":true,"predicted":true}],"off":{"viewNotItsFrame":true,"offerIgnoresFactor":true}}
    {"probe":"device box","placement":6,"factor":0.8,"workArea":{"x":0,"y":30,"width":2560,"height":1358},"sheet":false,"sheetRoom":null,"ampleBy":"the separator","room":439.755859375,"ample":true,"straddles":true,"placed":{"x":2786,"y":158,"width":375,"height":812},"element":{"read":375,"predicted":375},"frameDrawnPt":{"read":300,"predicted":300},"view":{"read":375,"predicted":375},"innerWidth":{"read":375,"predicted":375},"chip":{"read":"375 × 812","predicted":"375 × …"},"offers":[{"room":369.755859375,"offered":false,"predicted":false},{"room":379.755859375,"offered":true,"predicted":true}],"off":{"viewNotItsFrame":true,"offerIgnoresFactor":true}}
    {"probe":"device box","placement":6,"factor":1.25,"workArea":{"x":0,"y":30,"width":2560,"height":1358},"sheet":false,"sheetRoom":null,"ampleBy":"the separator","room":440.4000244140625,"ample":true,"straddles":true,"placed":{"x":1634,"y":158,"width":375,"height":812},"element":{"read":375,"predicted":375},"frameDrawnPt":{"read":468.75,"predicted":468.75},"view":{"read":375,"predicted":375},"innerWidth":{"read":375,"predicted":375},"chip":{"read":"375 × 812","predicted":"375 × …"},"offers":[{"room":370.4000244140625,"offered":false,"predicted":false},{"room":380.4000244140625,"offered":true,"predicted":true}],"off":{"viewNotItsFrame":true,"offerIgnoresFactor":true}}
    {"probe":"device box","placement":6,"factor":2,"workArea":{"x":0,"y":30,"width":2560,"height":1358},"sheet":false,"sheetRoom":null,"ampleBy":"the separator","room":440,"ample":true,"straddles":true,"placed":{"x":866,"y":159,"width":375,"height":513},"element":{"read":375,"predicted":375},"frameDrawnPt":{"read":750,"predicted":750},"view":{"read":375,"predicted":375},"innerWidth":{"read":375,"predicted":375},"chip":{"read":"375 × 513","predicted":"375 × …"},"offers":[{"room":370,"offered":false,"predicted":false},{"room":380,"offered":true,"predicted":true}],"off":{"viewNotItsFrame":true,"offerIgnoresFactor":true}}

`e2e:browser-comment` (host), "zoom probe: the pin", failed at 200 %, after its lines at 0.5, 0.8 and 1.25. The hover
outline never showed (`expect(maws-comment-overlay).toBeVisible()`, "hidden" for 5 s). This was a probe fault: the
view did not grow with the factor (placement 1), so the tab's page at 200 % was too short for the button at 275 CSS
pixels, and the hover landed outside the page's viewport. Fixed after this run (Decision Log 13).

    {"probe":"pin","placement":4,"factor":0.5,"pane":{"x":1173,"y":141,"width":1380,"height":1492},"viewBounds":{"x":1173,"y":141,"width":1380,"height":1492},"button":{"x":37,"y":275.4921875,"width":87.2734375,"height":31.5},"position":{"x":81,"y":307},"caretCentreX":1254,"caretTopY":1409.1397705078125,"caretAttr":"81","drawnAt":{"x":2507.2734375,"y":895.984375},"undivided":{"x":1254,"y":448},"off":true}
    {"probe":"pin","placement":4,"factor":0.8,"pane":{"x":789,"y":140,"width":804,"height":878},"viewBounds":{"x":789,"y":140,"width":804,"height":878},"button":{"x":37,"y":275.4921875,"width":87.2734375,"height":31.5},"position":{"x":81,"y":307},"caretCentreX":869.619140625,"caretTopY":798.336669921875,"caretAttr":"81","drawnAt":{"x":1087.0458984375,"y":558.740234375},"undivided":{"x":870,"y":447},"off":true}
    {"probe":"pin","placement":4,"factor":1.25,"pane":{"x":415,"y":158,"width":602,"height":491},"viewBounds":{"x":415,"y":158,"width":602,"height":491},"button":{"x":37,"y":275.4921875,"width":87.2734375,"height":31.5},"position":{"x":81,"y":307},"caretCentreX":495.8000030517578,"caretTopY":427.3396911621094,"caretAttr":"81","drawnAt":{"x":396.509375,"y":371.99375},"undivided":{"x":496,"y":465},"off":true}

`e2e:browser-chrome` (guest; again on the host, `76d0bbc9de40-20261119T200651Z`), "zoom probe: the popup and the
menu", failed before any factor was set: no `[data-extension-action]` in the main tab's chrome, which showed only the
puzzle ("Extensions"). This was a probe fault: with the panel's Browser beside the main tab, the chrome folded its
actions. Fixed after this run (Decision Log 13). No popup or menu line exists yet.

**Row 3, the peers' probe** (manual gate `76d0bbc9de40-20261119T121640Z`, in the guest, `--peer-exact f1852de3a`;
passed, six lines). The peer at `2c7044231` has not run.

    [cross-build] (zoom probe) isolated mode, quit: this build was at {"factor":1.5,"mode":"isolated"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1 on the same zoom key, P7’s same-URL observation; Preferences' zoom keys after this build's run: []
    [cross-build] (zoom probe) isolated mode, kill after the control wrote: not established: the write control's key never reached Preferences within 60 s, so the kill's timing shows nothing; Preferences' zoom keys: []
    [cross-build] (zoom probe) isolated mode, kill at once (an extra): this build was at {"factor":1.5,"mode":"isolated"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1 on the same zoom key, P7’s same-URL observation; Preferences' zoom keys after this build's run: null
    [cross-build] (zoom probe) default mode, quit: this build was at {"factor":1.5,"mode":"default"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1.5 on the same zoom key, the control (a kept default-mode zoom shows here): established; Preferences' zoom keys after this build's run: [{"key":"partition.per_host_zoom_levels","value":{"15030877753294440317":{"<this build>/out/renderer/index.html?e2e=1":2.223901085741545}}}]
    [cross-build] (zoom probe) default mode, kill after the control wrote: not established: the write control's key never reached Preferences within 60 s, so the kill's timing shows nothing; Preferences' zoom keys: []
    [cross-build] (zoom probe) default mode, kill at once (an extra): this build was at {"factor":1.5,"mode":"default"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1 on the same zoom key, the control (a kept default-mode zoom shows here): NOT established; Preferences' zoom keys after this build's run: null

What the Mac says:

- **P7 stands.** In isolated mode, nothing of the zoom was kept after a quit or after a forced exit: in the harness
  (rows c and d, including the SIGKILL 15 s after the call, when the default-mode control of row b had its key on
  disk), and in the real app (this build relaunched at 1 on its own page's zoom key, after a quit and after a kill at
  once).
- **Neither peer read speaks to P7.** Build F loads its own renderer file, a different zoom key from this build's, so
  its reading of 1 is recorded as "another zoom key: not P7 evidence". The same-URL reading is this build relaunched.
- **The default-mode control was established on a quit:** this build relaunched at 1.5, its key under
  `partition.per_host_zoom_levels` for `<this build>/out/renderer/index.html?e2e=1`. After a kill at once it read 1,
  with no Preferences file, as row b predicts.
- **"Kill after the control wrote" was not established in either mode in this run** (the reruns below establish it in default mode). Nothing reached Preferences within 60 s, not
  even the app's own default-mode key. The control was right to refuse. The likely cause is Chromium's delayed commit
  of Preferences in a quiet (transparent, never key) e2e window open to App Nap, against the harness's visible
  windows, whose key was on disk within 15 s. The probe now holds the app out of App Nap during the wait, up to
  120 s (Decision Log 13). The cause is not verified.
- **Placement 1 (the view) is off at every factor, as Interfaces §G predicts:** its bounds equal the pane's CSS
  rectangle, not that rectangle times the factor. The pointer's mismatch is the same fault.
- **Placement 5 (the lights) is off at every factor:** they stay at `{ x: 16, y: 15 }`, centred at 22 points, while
  the toolbar's centre is 11, 17.6, 27.5 and 44 points, and at 0.5 and 0.8 they pass the clear width.
- **Placement 6 (the device box) matches what the pin's code predicts at every factor.** The element, the view and
  `innerWidth` read 375, and the frame as drawn is 375 times the factor. The menu offers Mobile from 375 CSS pixels at
  every factor, so its offer does not follow the factor. At 200 % the chip read `375 × 513`, because the room's height
  was short.
- **Placement 4 (the pin) is off at every factor:** the caret stands at the pick's position undivided (the 200 %
  reading is in the reruns below).
- **Placements 2 and 3** are measured in the run at `e458d10c1` below.
- **Row j and the look have not run.** Both are owed to the owner (Decision Log 16).

### Mac, the reruns after the probe fixes (2026-11-19, at `ef018d192`)

**`e2e:browser-comment` (host; manual gate `ef018d1921f2-20261119T211042Z`), "zoom probe: the pin": passed**, with one
line at each of the four factors. These replace the earlier run's three lines.

    {"probe":"pin","placement":4,"factor":0.5,"pane":{"x":2197,"y":141,"width":2916,"height":2568},"viewBounds":{"x":2197,"y":141,"width":2916,"height":2568},"viewport":{"width":2916,"height":2568},"button":{"x":37,"y":275.4921875,"width":87.2734375,"height":31.5},"position":{"x":81,"y":307},"caretCentreX":2278,"caretTopY":2485.1396484375,"caretAttr":"81","drawnAt":{"x":4555.2734375,"y":895.984375},"undivided":{"x":2278,"y":448},"off":true}
    {"probe":"pin","placement":4,"factor":0.8,"pane":{"x":1429,"y":140,"width":1764,"height":1551},"viewBounds":{"x":1429,"y":140,"width":1764,"height":1551},"viewport":{"width":1764,"height":1551},"button":{"x":37,"y":275.4921875,"width":87.2734375,"height":31.5},"position":{"x":81,"y":307},"caretCentreX":1509.619140625,"caretTopY":1470.836669921875,"caretAttr":"81","drawnAt":{"x":1887.0458984375,"y":558.740234375},"undivided":{"x":1510,"y":447},"off":true}
    {"probe":"pin","placement":4,"factor":1.25,"pane":{"x":968,"y":140,"width":1073,"height":940},"viewBounds":{"x":968,"y":140,"width":1073,"height":940},"viewport":{"width":1073,"height":940},"button":{"x":37,"y":275.4921875,"width":87.2734375,"height":31.5},"position":{"x":81,"y":307},"caretCentreX":1048.800048828125,"caretTopY":857.73974609375,"caretAttr":"81","drawnAt":{"x":838.909375,"y":357.59375},"undivided":{"x":1049,"y":447},"off":true}
    {"probe":"pin","placement":4,"factor":2,"pane":{"x":661,"y":159,"width":612,"height":513},"viewBounds":{"x":661,"y":159,"width":612,"height":513},"viewport":{"width":612,"height":513},"button":{"x":37,"y":240.9921875,"width":87.2734375,"height":31.5},"position":{"x":81,"y":272},"caretCentreX":742,"caretTopY":446.13970947265625,"caretAttr":"81","drawnAt":{"x":370.818359375,"y":215.74609375},"undivided":{"x":742,"y":431},"off":true}

- **Placement 4 is off at every factor, 200 % included.** The caret stands at the pick's position undivided (742 at
  200 %, where the element is drawn at 370.8).
- **The button's 34.5 CSS pixels higher at 200 % (y 240.99 against 275.49) is the tab page's own scroll, not a
  placement.** The probe scrolls the button to the centre of the page's viewport (`scrollIntoView({ block: 'center' })`).
  At 200 % the viewport is 513 tall, so centring the button's middle (275.49 + 15.75 = 291.24) needs a scroll of
  291.24 − 256.5 = 34.74, which Chromium snaps to the device pixel: 34.5 at scale 2. At the other factors the
  viewport is at least 940 tall, the scroll needed is negative and is held at 0, and the button stays at 275.49. The
  pick's position follows the button: (81, 272) is the bottom of a box at 240.99 + 31.5. Nothing in it points to a
  placement fault.

**`e2e:cross-build` against `--peer-exact f1852de3a` (guest; manual gate `ef018d1921f2-20261119T211314Z`): passed**,
with six lines. These replace the earlier run's six.

    [cross-build] (zoom probe) isolated mode, quit: this build was at {"factor":1.5,"mode":"isolated"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1 on the same zoom key, P7’s same-URL observation; Preferences' zoom keys after this build's run: []
    [cross-build] (zoom probe) isolated mode, kill after the control wrote: not established: the write control's key never reached Preferences within 120 s (the app held out of App Nap: true), so the kill's timing shows nothing; Preferences' zoom keys: []
    [cross-build] (zoom probe) isolated mode, kill at once (an extra): this build was at {"factor":1.5,"mode":"isolated"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1 on the same zoom key, P7’s same-URL observation; Preferences' zoom keys after this build's run: null
    [cross-build] (zoom probe) default mode, quit: this build was at {"factor":1.5,"mode":"default"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1.5 on the same zoom key, the control (a kept default-mode zoom shows here): established; Preferences' zoom keys after this build's run: [{"key":"partition.per_host_zoom_levels","value":{"11389987517603032168":{"<this build>/out/renderer/index.html?e2e=1":2.223901085741545}}}]
    [cross-build] (zoom probe) default mode, kill after the control wrote (the write control’s key was in Preferences; the app held out of App Nap: true): this build was at {"factor":1.5,"mode":"default"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1.5 on the same zoom key, the control (a kept default-mode zoom shows here): established; Preferences' zoom keys after this build's run: [{"key":"partition.per_host_zoom_levels","value":{"3974075007774293422":{"<this build>/out/renderer/index.html?e2e=1":2.223901085741545,"<scratch>/zoom-control.html":1.2239010857415449}}}]
    [cross-build] (zoom probe) default mode, kill at once (an extra): this build was at {"factor":1.5,"mode":"default"} on <this build>/out/renderer/index.html?e2e=1; the peer (wire 3.33) opened at 1 on <the peer>/out/renderer/index.html?e2e=1, another zoom key: not P7 evidence; this build relaunched opened at 1 on the same zoom key, the control (a kept default-mode zoom shows here): NOT established; Preferences' zoom keys after this build's run: null

- **The default-mode write control is now established.** With the app held out of App Nap, the control's key
  (`<scratch>/zoom-control.html`, at level 1.2239, that is 1.25) and this build's own key were both in `Preferences`
  before the kill. This build relaunched at 1.5. So a forced exit after a write keeps a default-mode zoom, as
  expected. This supports the App Nap reading of the earlier failure, though it does not prove it.
- **In isolated mode the control was still not established, and that row is not answered by this run.** The control
  is a default-mode window, so its zoom should have been written whatever mode this build's window was in. In this
  cycle nothing reached `Preferences` in 120 s, the control's key included. So the cycle cannot tell "an isolated
  zoom writes nothing" from "no write happened at all". It cannot be read as "isolated keeps no zoom across a kill,
  by design".
- **P7 is answered by the other evidence.** That is the harness's rows c and d on this Mac, including the SIGKILL 15 s
  after the call, beside row b's default-mode key on disk at 15 s. It is also this build relaunched at 1 on its own
  page's zoom key, after a quit and after a kill at once.
- **An observation left open:** in the cycle where this build's window was isolated, a default-mode window's zoom of
  the same session did not reach `Preferences` within 120 s, where the same control did in the default cycle. It does
  not bear on P7, since P7 wants nothing kept. A harness row could separate the two readings: an isolated window
  beside a default-mode one, killed once the default one's key is on disk. The architect ruled it not built (Decision
  Log 16).

### Mac, the popup and the menus (2026-11-19, at `e458d10c1`)

**`e2e:browser-chrome` (host; manual gate `e458d10c170e-20261119T214214Z`), "zoom probe: the popup and the menu":
passed**, with 12 lines: placement 2 and both menus of placement 3, at each of the four factors.

    {"probe":"popup","placement":2,"factor":0.5,"icon":{"x":4638.921875,"y":80,"width":24,"height":24},"anchor":{"x":4639,"y":80,"width":24,"height":24},"content":{"width":2560,"height":1358},"bounds":{"x":2535,"y":104,"width":25,"height":25},"predictedUnscaled":{"x":2535,"y":104,"width":25,"height":25},"predictedScaled":{"x":2307,"y":52,"width":25,"height":25},"unscaledClamped":true,"off":true}
    {"probe":"menu: bookmarks folder","placement":3,"factor":0.5,"chip":{"x":331.984375,"y":112,"width":40.875,"height":24},"at":{"x":332,"y":136},"corner":{"x":332,"y":136},"cornerTimesFactor":{"x":166,"y":68},"off":true}
    {"probe":"menu: extension action","placement":3,"factor":0.5,"icon":{"x":4638.921875,"y":80,"width":24,"height":24},"at":{"x":4650,"y":92},"press":{"x":4651,"y":92},"pressTimesFactor":{"x":2326,"y":46},"off":true}
    {"probe":"popup","placement":2,"factor":0.8,"icon":{"x":2719.7265625,"y":79.990234375,"width":23.994140625,"height":23.994140625},"anchor":{"x":2720,"y":80,"width":24,"height":24},"content":{"width":2560,"height":1358},"bounds":{"x":2535,"y":104,"width":25,"height":25},"predictedUnscaled":{"x":2535,"y":104,"width":25,"height":25},"predictedScaled":{"x":2170,"y":83,"width":25,"height":25},"unscaledClamped":true,"off":true}
    {"probe":"menu: bookmarks folder","placement":3,"factor":0.8,"chip":{"x":331.923828125,"y":111.9921875,"width":40.859375,"height":23.994140625},"at":{"x":332,"y":136},"corner":{"x":332,"y":136},"cornerTimesFactor":{"x":266,"y":109},"off":true}
    {"probe":"menu: extension action","placement":3,"factor":0.8,"icon":{"x":2719.7265625,"y":79.990234375,"width":23.994140625,"height":23.994140625},"at":{"x":2731,"y":91},"press":{"x":2732,"y":92},"pressTimesFactor":{"x":2186,"y":74},"off":true}
    {"probe":"popup","placement":2,"factor":1.25,"icon":{"x":1567.3250732421875,"y":80,"width":24,"height":24},"anchor":{"x":1567,"y":80,"width":24,"height":24},"content":{"width":2560,"height":1358},"bounds":{"x":1566,"y":104,"width":25,"height":25},"predictedUnscaled":{"x":1566,"y":104,"width":25,"height":25},"predictedScaled":{"x":1964,"y":130,"width":25,"height":25},"unscaledClamped":false,"off":true}
    {"probe":"menu: bookmarks folder","placement":3,"factor":1.25,"chip":{"x":331.9750061035156,"y":112,"width":40.868743896484375,"height":24},"at":{"x":332,"y":136},"corner":{"x":332,"y":136},"cornerTimesFactor":{"x":415,"y":170},"off":true}
    {"probe":"menu: extension action","placement":3,"factor":1.25,"icon":{"x":1567.3250732421875,"y":80,"width":24,"height":24},"at":{"x":1579,"y":92},"press":{"x":1579,"y":92},"pressTimesFactor":{"x":1974,"y":115},"off":true}
    {"probe":"popup","placement":2,"factor":2,"icon":{"x":798.9296875,"y":80,"width":24,"height":24},"anchor":{"x":799,"y":80,"width":24,"height":24},"content":{"width":2560,"height":1358},"bounds":{"x":798,"y":104,"width":25,"height":25},"predictedUnscaled":{"x":798,"y":104,"width":25,"height":25},"predictedScaled":{"x":1621,"y":208,"width":25,"height":25},"unscaledClamped":false,"off":true}
    {"probe":"menu: bookmarks folder","placement":3,"factor":2,"chip":{"x":331.97265625,"y":112,"width":40.8671875,"height":24},"at":{"x":332,"y":136},"corner":{"x":332,"y":136},"cornerTimesFactor":{"x":664,"y":272},"off":true}
    {"probe":"menu: extension action","placement":3,"factor":2,"icon":{"x":798.9296875,"y":80,"width":24,"height":24},"at":{"x":810,"y":92},"press":{"x":811,"y":92},"pressTimesFactor":{"x":1622,"y":184},"off":true}

- **Placement 2 (the extension's popup) is off at every factor:** main places it from the icon's CSS rectangle taken
  as window points.
  - At 1.25 and 2 the anchor is not clamped, and the popup stands exactly at the icon's CSS corner: its right edge on
    the icon's (1566 + 25 = 1567 + 24 at 1.25, 798 + 25 = 799 + 24 at 2) and its top at the icon's bottom (104 =
    80 + 24). The corner times the factor would put it at (1964, 130) and (1621, 208).
  - At 0.5 and 0.8 the icon's CSS x (4639 and 2720) lies beyond the window's 2560 points of content, so `popupBounds`
    holds the popup to the content's right edge (x 2535), both as it stands and in the unscaled prediction. The
    reading there rests on y: 104 is the CSS bottom, where the factor predicts 52 and 83.
  - The popup is 25 × 25 at every factor, Chrome's minimum: under Playwright the page reports no preferred size, as
    the action bar's own scene records. Its size says nothing about the factor.
- **Placement 3 (the native menus) is off at every factor:** the point handed to the presenter is the CSS point,
  whatever the factor.
  - The bookmarks folder's menu is handed (332, 136), the chip's bottom-left corner in CSS pixels, at all four
    factors. The corner times the factor is (166, 68), (266, 109), (415, 170) and (664, 272).
  - The extension action's menu is handed the press point in CSS pixels (`clientX`, `clientY`), within the one pixel
    of the probe's own rounding of the icon's centre. Times the factor it would be (2326, 46) at 0.5 and
    (1622, 184) at 2.
- With this run every placement of Interfaces §G has been measured on the Mac, each off in the direction §G gives:
  placement 1 and the pointer, 2, 3, 4 and 5. Placement 6 matches the pin's code as predicted, and its menu offer
  does not follow the factor.
