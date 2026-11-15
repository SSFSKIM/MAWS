# File-frame spike: both ends of a request for a token host, and Chromium's PDF viewer on one

Milestone M1 of `docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md` (UX wave U6b-2), its table "What the
spike measures", rows a to i. Findings only: nothing here is imported by the product, and the harness imports nothing
from `src/` (the policies, the store's range rule and frame policy are copied from `281ef5a6c`, with the document's
owner's check added as the listener's first question).

**Run of record:** 2026-11-15, the build VM (Linux, Xvfb 1600x1000, no window manager, software GL, 8 cores, load
average about 7.6 from other landings), Electron 44.4.5 (the repository's own), Chromium's sandbox on (setuid helper),
head `f10672d24`:

    vmcheck 'cd spikes/file-frame && timeout 900 node run.mjs --setuid-sandbox'

Wherever an earlier run of the same day reached a row (heads `d1884e34d` to `05e0b310d`, while the harness was
fixed and row e's controls were added), its verdict was the same.

## In short

| row | verdict | what decides it |
|---|---|---|
| a | **PASS** | the 5 MiB, 5-page PDF is drawn from `maws-artifact://<token>/large.pdf`, streamed in 1 MiB pages, both when the answer offers ranges and when it answers whole; one request each time, with no `Range` |
| b | **PASS** | for each of the four kinds, no handler entry without a passed decision before it, and every passed decision carries the window's id: PDF 1/1, page 1/1, video 1/1, sound 2/2 (entries/passes) |
| c | **PASS** | a second window, a web contents with its own filter, a request with no web contents and a second partition: 0 handler entries for the four URLs; 22 decisions, all `cancel` by the owner's check |
| d | RECORD | a host of 32 digits does not load: Chromium blocks the frame (`about:blank#blocked`) before any request; 0 decisions, 0 entries. Decision 10 stands |
| e | **PASS** | none of the eleven hostile documents made a native dialog, a print dialog, a process, a navigation, a request, a download or a window; nothing was even asked and refused. The controls say why (see e) |
| f | **PASS** | the page served `text/html; charset=utf-8` reads right under en-US and under `--lang=ko`; the declared windows-1252 page is decoded by its declaration under both. The bare UTF-8 page is decoded as windows-1252 under both languages |
| g | RECORD | `.mov` (as `video/quicktime`), `.mkv` (as `video/x-matroska`), `.webm` and `.mp4` all play |
| h | **PASS** | `#toolbar=0` is honoured: no toolbar at 360 px, in both orders, at both reads |
| i | **PASS** | at 700 px the thumbnail sidebar opens by itself (301 px) and `#navpanes=0` keeps it closed, in both orders, at both reads |

Nothing in rows a, b, c or e calls for the architect's stop. Three facts the document did not foresee are under
"Surprises" below: the PDF viewer asks nothing of its own; PDFium runs no document script in this Electron; Electron
decodes an unlabelled page as windows-1252 whatever the interface language.

## Run

    cd spikes/file-frame
    node run.mjs [--only=<suite,suite>] [--setuid-sandbox]

- **Suites**, each its own Electron launch with a fresh profile (`main.mjs --suite=…`): `gen` (the clips, always run
  first), `a`, `a-partial`, `bc`, `d`, `e`, `f`, `f-ko` (the same suite with `--lang=ko`, `LANGUAGE=ko`,
  `LANG=ko_KR.UTF-8`), `g`, `hi`, `hi-reversed`. Each prints `RESULT {json}` (a row, a part, a status, what was seen)
  and `REC {json}` lines (the ordered record).
- **Verdicts.** `run.mjs` prints one line per row: FAIL if a deciding part fails, PASS if every deciding part passes,
  RECORD when the row has only observations. Rows h and i are judged in `run.mjs` from both suites' reads.
- **Evidence**, under `runs/<time>/` (ignored by git): `results.json` (every part, and per suite the ordered record of
  both ends with main's own record), the pictures, each suite's log, `media/` (the clips), `opened.txt` (row e's
  opener scripts; empty in every run).
- **Linux.** Without a display `run.mjs` reruns itself under `xvfb-run`. On Ubuntu 24.04 (unprivileged user namespaces
  restricted) Chromium's sandbox needs its setuid helper: `--setuid-sandbox` sets it on the repository's
  `node_modules/electron/dist/chrome-sandbox` with `sudo -n`; without it the run stops. The sandbox is never turned
  off. The VM has no X tools and no ffmpeg: `xwin.py` lists the display's top-level windows and pictures the screen
  through libX11, and the clips are recorded by Chromium's MediaRecorder (`window/gen.js`).

The files: `main.mjs` (the suites), `harness.mjs` (sessions, windows, main's record, the viewer's readers),
`policies.mjs` (the request filter and the frame policies, copied, with the owner's check), `responder.mjs` (the token
table and the responder, headers of the document's Interfaces §C), `record.mjs` (the one ordered record), `pdf.mjs`
(every PDF, built from text), `window/` (the window page and the clip generator), `preload.cjs`, `xwin.py`, `run.mjs`.

**How the harness stands in for the app.** The scheme is registered with the store's privileges (standard, secure,
streamed, no fetch, CORS); main sets `dnsPrefetchingEnabled=false` and turns off `WebRtcHideLocalIpsWithMdns`; the
window is sandboxed, context-isolated, `plugins: true`, with a preload, and loads a `file:` page under
`PRODUCTION_CSP` (as a header and a meta); the frames are `PdfFrame`'s (no sandbox), `HtmlFrame`'s
(`sandbox="allow-scripts"`) and `Media`'s elements (`controls`, `preload="metadata"`). The partition's one
`onBeforeRequest` listener has the product's three branches in order: the owner's check (cancel a token host unless
the request's `webContentsId` is the token's owner; cancel when there is none), a web contents' own filter, the frame
policies. The navigation guard, the window-open refusal, the download filter, the permission handlers and the WebRTC
policy are the product's. The handler answers a token's one path from bytes in memory, 1 MiB per pull with a pause
between pages (20 ms; 400 ms in `a-partial`).

**The ordered record.** One counter numbers both ends. The listener writes, for every token-host request: `seq`, URL,
method, `webContentsId`, `resourceType`, the frame's URL, `initiatorOrigin`, the branch and the decision. The handler
writes at its entry, before anything else: `seq`, URL, method, `Range`. Main's own record (navigations, window opens,
downloads, permissions, console lines, web contents made) shares the counter.

## Results

### a. A large PDF from a token host, streamed — PASS

5,186,993 bytes, 5 pages (a picture of noise on each, so the bytes do not compress away), frame 800x700.

| part | drawn | requests at the handler | decisions |
|---|---|---|---|
| answering ranges (`Accept-Ranges: bytes`, 206 for a `Range`) | yes: the viewer frame beneath the token frame, its plugin element 499x644, 5 pages, the picture 2,253 distinct colours | 1, no `Range` | 1 pass (window 1) |
| answering every request whole (200, no `Accept-Ranges`) | yes, the same | 1, no `Range` | 1 pass |
| control, no owner's check in the listener | yes, the same | 1, no `Range` | 1 pass |
| control, `--enable-features=PdfPartialLoading`, 400 ms between pages | yes | 1, no `Range` | 1 pass |

The plugin is 499 px wide in an 800 px frame because the thumbnail sidebar opened by itself (row i).

### b. Both ends, for each kind, from the owning window — PASS

Window 1 holds four tokens: the 5 MiB PDF (frame 640x600), a self-contained page (its inline script ran: the frame's
text read back "script ran"), a WebM clip and a two-minute WAV (10.6 MB). The video was seeked to 0.9 s and the sound to
110 s.

| kind | handler entries | passed decisions | cancelled | entries without a pass before them | passes with another id | `Range` at the handler |
|---|---|---|---|---|---|---|
| PDF | 1 | 1 | 0 | 0 | 0 | none |
| page | 1 | 1 | 0 | 0 | 0 | none |
| video | 1 | 1 | 0 | 0 | 0 | `bytes=0-` |
| sound | 2 | 2 | 0 | 0 | 0 | `bytes=0-`, then `bytes=9699328-` (the seek) |

The two frame loads are `resourceType: subFrame` with no frame yet (`details.frame` null at that point) and initiator
`file://`; the media loads are `resourceType: media` from the window's page. Every one carried `webContentsId` 1.

Where Chromium put the viewer (Electron 44.4.5, the out-of-process PDF viewer): every frame is in the window's own web
contents, and no other web contents exists:

    file: window page
    └─ maws-artifact://<token>/large.pdf
       └─ chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html
          └─ maws-artifact://<token>/large.pdf   (the plugin's frame: it got the bytes with no request of its own)

### c. The same URLs from elsewhere — PASS

Window 1's elements removed, its four tokens kept live; each asker mounted every URL as a frame, and the video's and the
sound's also as media elements (6 requests per asker).

| asker | handler entries for the four URLs | decisions |
|---|---|---|
| a second app window (id 2) | 0 | 6 cancel, owner's check, id 2 |
| a web contents with its own filter, a filter that cancels nothing (id 3) | 0 | 6 cancel, owner's check, id 3: decided before its own filter was asked |
| no web contents (`session.fetch` from main) | 0 | 4 cancel, owner's check, id none; each fetch failed `net::ERR_BLOCKED_BY_CLIENT` |
| a window on a second partition with the listener and a handler (id 4) | 0 | 6 cancel, owner's check, id 4 |
| control: four tokens of window 4's own, on the second partition | 4 entries there | 4 passes, each before its entry; 0 entries there for window 1's tokens |

### d. A token of 32 digits — RECORD: does not load

`maws-artifact://12345678901234567890123456789012/page.html` in a frame: 0 decisions, 0 handler entries, no load failure
reported; the frame is `about:blank#blocked`. The page still reads the `src` as given. The lettered control beside it:
1 decision, 1 entry, its script ran. **Decision 10 stands** (a token is drawn again while it holds no letter).

### e. A hostile PDF's own script and actions — PASS

Each document in a fresh window (frame 900x800), its action given both as the document's `OpenAction` and as its first
page's open action (`/AA /O`). After the viewer drew it: 120 animation frames and 1.5 s more; then a picture of the
window (`e-<case>.png`) and of the whole screen (`e-<case>-screen.png`, where a native dialog would show).

| case | what the document does by itself | happened | asked and refused |
|---|---|---|---|
| alert | `app.alert(…)` | nothing | nothing |
| print | `this.print()` | nothing | nothing |
| submit | a SubmitForm action to `https://example.com/…` | nothing | nothing |
| submit-script | `this.submitForm("https://example.com/…")` | nothing | nothing |
| launch | a Launch action of a file | nothing | nothing |
| goto-other-relative | GoToR `other.pdf` | nothing | nothing |
| goto-other-absolute | GoToR `/tmp/file-frame-other.pdf` | nothing | nothing |
| uri-action | a URI action to `https://example.com/…` | nothing | nothing |
| uri-script | `app.launchURL("https://example.com/…", true)` | nothing | nothing |
| attachment | an embedded file, opened by `this.exportDataObject({ nLaunch: 2 })` | nothing | nothing |

"Happened" is any of: a new mapped top-level window on the display (a dialog), a new process outside Chromium's own, a
line from an opener script on the PATH (`xdg-open`, `gio`, `lp`, `lpr` and fifteen more), a navigation that committed
or was not blocked, a network request the filter passed, a download the policy allowed, a window made. "Asked and
refused" is a blocked navigation, a cancelled request, a cancelled download or a denied window. Console lines: 0 in
every case.

**The controls** (record; they decide nothing but say what the PASS rests on):

| control | result |
|---|---|
| `OpenAction` script `this.pageNum = 2` | stays on page 1 of 3 |
| document-level script (the `JavaScript` name tree) `this.pageNum = 2` | page 1 of 3 |
| first page's open-action script `this.pageNum = 2` | page 1 of 3 |
| `OpenAction` destination page 3 | page 1 of 3 |
| first page's open action GoTo page 3 | **page 3 of 3**: the viewer runs a page's open action |
| a link over the whole page, clicked with `sendInputEvent` | nothing at all: the input did not reach the plugin under Xvfb, so this control is not exercised |
| main's record, acted in the viewer's frame as main: `location.href = https://example.com/…` | `will-frame-navigate`, blocked |
| the same with `window.top.location` | `will-frame-navigate`, blocked |
| `fetch("https://example.com/…")` | request seen, cancelled by the frame policies |
| `window.open("https://example.com/…")` | window-open seen, denied |
| the viewer's Save button | a download of the token's URL, cancelled by the download filter |
| an `alert` of the window's own page | a native window appeared (249x83) |
| the window's `print()` | a native window "Print" appeared (614x518) |

So the reading of main's record sees each kind of act the stop names, and the hostile documents produced none. Of the
document's own behaviour, scripts are not run at all in this build (four ways tried, none moved the page), an
`OpenAction` destination is not followed, and a page's open action is: its non-script actions (URI, Launch, GoToR,
SubmitForm) produced nothing either, and nothing was asked.

### f. An unlabelled UTF-8 page, and the charset — PASS

Text: Latin with accents, an em dash, curly quotes, and Korean; read back from each frame by main
(`document.characterSet` and the paragraph's text).

| language | `app.getLocale()` | page served bare `text/html` (recorded) | served `text/html; charset=utf-8` | windows-1252 page declaring its charset, served `text/html` |
|---|---|---|---|---|
| default | `en-US` | decoded as windows-1252: reads wrong (mojibake) | UTF-8, reads right | windows-1252, reads right |
| `--lang=ko` | `ko` (navigator.language `ko`) | decoded as windows-1252: reads wrong | UTF-8, reads right | windows-1252, reads right |

Pictures: `f/f-default.png`, `f-ko/f-ko.png`.

### g. Clips by their type — RECORD

Clips recorded by Chromium's MediaRecorder on the VM, about a second each. MediaRecorder offered WebM (VP8, Opus),
Matroska (H.264, Opus), MP4 (H.264 or VP9, Opus); not MP4 with AAC.

| file | bytes | served as | `canPlayType` | result |
|---|---|---|---|---|
| clip.mov | MP4 (H.264, Opus), the same bytes as clip.mp4 | `video/quicktime` | "" | plays |
| clip.mkv | Matroska (H.264, Opus) | `video/x-matroska` | "maybe" | plays |
| clip.webm | WebM (VP8, Opus) | `video/webm` | "maybe" | plays |
| clip.mp4 | MP4 (H.264, Opus) | `video/mp4` | "maybe" | plays |

The `.mov` is ISO-BMFF bytes under a QuickTime name and type, not a file a QuickTime tool wrote; a real `.mov` was not
available on the VM.

### h. `#toolbar=0` at 360 px — PASS (honoured)

A 6-page PDF, frame 360x640, read from the viewer's own elements at 1.5 s and 4 s after it drew, in a fresh profile per
suite, in both orders (plain first in `hi`, fragment first in `hi-reversed`): 8 reads.

| URL | `viewer-toolbar#toolbar` | plugin element (`embed#plugin`) |
|---|---|---|
| no fragment | 360x56, shown; its centre group (page number, zoom) `display: none` at this width | 360x584 at y 56 |
| `#toolbar=0` | `hidden` attribute set, `display: none`, 0x0 | 360x640 at y 0: the whole frame |

### i. The thumbnail sidebar at 700 px, and `#navpanes=0` — PASS (opens by itself; the fragment stops it)

The same PDF, frame 700x640, the same reads and orders.

| URL | `#sidenav-container` | `viewer-pdf-sidenav` | plugin element |
|---|---|---|---|
| no fragment, 700 px | 301x584, shown | 300x584 at x 0 | 399x584 at x 301 |
| no fragment, 1000 px (record) | 301x584 | 300x584 at x 0 | 699x584 at x 301 |
| no fragment, 800 px (row a) | 301x644 | 300x644 | 499x644 at x 301 |
| `#navpanes=0`, 700 px | 1x584 at x -1, `visibility: hidden` | 300x584 at x -1, `visibility: hidden` | 699x584 at x 1 |

With the fragment the container keeps a 1 px edge (hidden) and the page gets 699 of 700 px.

**How robust rows h and i are.** Each element was read, not inferred from a picture, at two times and in both orders,
each suite in a fresh profile: no read disagreed. The names read (`viewer-toolbar`, `#sidenav-container`,
`viewer-pdf-sidenav`, `embed#plugin`) are Chromium's internal ones in Electron 44.4.5; a new Electron pin can rename
them, and then `probeViewer` reads absent elements rather than wrong ones. This is Linux; the fragments are parsed by
the viewer's own script, the same on macOS, and the toolbar's narrow-width layout is the viewer's CSS, so a Mac is
expected to agree, but it was not run there. The pictures (`hi/*.png`, `hi-reversed/*.png`) show the same.

## Surprises

1. **The PDF viewer asks the route for nothing of its own.** In every configuration (ranges offered or not, partial
   loading forced on, slow pages) a PDF costs exactly one request: the frame's navigation, from the owning window. The
   viewer's plugin frame (a second frame with the token's URL, beneath the extension's) is handed the bytes without a
   request. So the owner's check sees the PDF's only request; "the viewer's own range requests" did not occur. Not
   tried: a linearized PDF (the VM has no tool to linearize, and the harness builds its PDFs from text); Chromium's
   partial loading may only start for one. The scene of record on a Mac counts whatever occurs there.
2. **PDFium runs no document script in Electron 44.4.5.** None of four scripts (the open action, the document-level
   name tree, a page's open action, each setting the page) ran, and nothing an `app.alert`, `this.print`,
   `submitForm`, `launchURL` or `exportDataObject` asks happened, while a page's non-script open action did run. Row e
   would need running again if an Electron pin turned PDF script on.
3. **Electron decodes an unlabelled page as windows-1252 whatever the interface language.** Under `--lang=ko`
   (`app.getLocale()` answered `ko`) the bare UTF-8 page was still windows-1252, not EUC-KR as the drawn example saw in
   a browser. The page reads wrong under both, so decision 18 is needed as written; only its reason is narrower.
4. **The viewer's Save is a download of the token's URL** (not a `blob:`), which the existing download filter cancels:
   B10's "Download a blocked download" holds by the filter's scheme rule.
5. **The viewer titles itself with the URL's last part**: row e's pictures show the file's name in the viewer's
   toolbar (`control-script.pdf` in one looked at), as decision 14 relies on.
