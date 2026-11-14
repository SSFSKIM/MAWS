# Viewer frame spike: can untrusted Word, PowerPoint and Excel files be drawn inside a host that contains them?

Spike for the preview host (l6-artifacts-01). The specification is the architect's list of acceptance conditions
(conditions 1 to 15, architecture B with B1 to B3, and the rule for what the result selects). Run 2026-11-14 on a Linux
build VM: Electron 44.4.5 (Chromium 152.0.7977.130), docx-preview 0.4.1, @aiden0z/pptx-renderer 1.4.0,
@extend-ai/react-xlsx 0.23.0, sample files of invented content (not committed).

**In short.** Shipped script loads under a policy with no inline script, and all three libraries draw with zero CSP
violations, in both architectures (1 to 4). As specified, neither architecture passes its list.

- **A** fails four conditions:
  - 10, WebRTC: Chromium 152 does not recognize `webrtc 'block'`, and a TURN-over-TCP connection reaches the listener.
  - 10, DNS: `<link rel="dns-prefetch">` sends a DNS query, for a hostname the page chooses, out of the machine.
  - 11: `Notification.requestPermission()` returns `granted`.
  - 14: main's `input-event` never fires for input given inside the frame.

  Condition 12 cannot be exercised as written: a `file:` window page never shares a process with its frame, whatever
  the isolation switches say.
- **B** passes everything but the same DNS prefetch (10) and B1, which cannot be judged on this display.

Three main-side settings close WebRTC and permissions in A: the app's existing `disable_non_proxied_udp`, a proxy that
reaches nothing on the window's session, and the app's permission refusal. Nothing scoped to the viewer closes DNS
prefetch. Only the app-wide `--host-resolver-rules` switch does.

## Run

```
cd spikes/viewer-frame
pnpm install                                   # if node_modules/electron/dist is missing, run.mjs runs Electron's install.js
node run.mjs                                   # build, listeners, every suite (A, then B); one line per condition at the end
node run.mjs --only=basic,egress               # some suites (names in run.mjs)
node run.mjs --variant=rtcpolicy+deadproxy+perms        # A with main-side layers added (Variants below)
node run.mjs --only=shared --variant=appscheme          # condition 12's variant
node run.mjs --only=egress '--switches=--host-resolver-rules=MAP * ~NOTFOUND'   # extra Chromium switches for every suite
```

- **Suites.** Each suite is its own Electron launch (`main.mjs --suite=…`) and prints `RESULT {json}` lines. `run.mjs`
  merges them into one line per condition: FAIL if any part fails, NOT RUN if a part could not be exercised, PASS
  otherwise. Controls and observations are `record` parts and do not decide.
- **Evidence.** Each run keeps the listeners' log, the DNS capture, the main-side events and the per-attempt results
  under `runs/<time>/` (ignored by git).
- **Linux.** Without a display, `run.mjs` reruns itself under `xvfb-run`. The real-input conditions (6, 14, 15) use
  `xdotool`, B1 to B3 capture frames with `ffmpeg` x11grab, and the DNS capture uses `sudo -n tcpdump`. Each is used
  only when present. On a host whose kernel restricts unprivileged user namespaces (Ubuntu 24.04:
  `kernel.apparmor_restrict_unprivileged_userns = 1`), Chromium's sandbox needs the setuid helper:
  `sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`.
- **Sandbox.** The sandbox was on in every run (`--no-sandbox` never passed). The frame and view renderer processes run
  under a seccomp-bpf filter (`/proc/<pid>/status` Seccomp 2), and they are not dumpable, so main cannot read their
  namespaces: the setuid sandbox's signature.
- **Samples.** The samples are read from `~/preview-probe/samples` (or `--samples=<dir>`, or `VIEWER_SPIKE_SAMPLES`).

The files:

- `main.mjs`: the harness.
- `viewer/`: the page. `viewer.js` is its one module script, `hook.js` the test hook running inside it, and
  `docx.js`, `pptx.js`, `xlsx.js` the three libraries' entries.
- `window/`: the window page.
- `listeners.mjs`: the listeners of condition 10.
- `build.mjs`: bundles the page into its fixed file list.

The scheme answers only the files in `out/viewer/manifest.json`, fixed at build time. Beyond the specification's page,
two chunks and one `.wasm`, the list holds the libraries' bundles and esbuild's split chunks.

## Results

Linux, Xvfb (1600×1000, no window manager, software GL), 8 cores. The as-specified columns come from one full
`node run.mjs`. Condition 10's DNS rows come from the egress reruns made after the DNS capture was fixed (the full run's
capture was written only after each suite had read it). Cells say what decided them; the sections below say what was
seen.

| # | Condition | A as specified | A + variant layers | B as specified |
|---|---|---|---|---|
| 1 | module script | pass | pass | pass |
| 2 | dynamic import | pass | pass | pass |
| 3 | WebAssembly | pass | pass | pass |
| 4 | script boundary, 3 libraries, 0 violations | pass | pass | pass |
| 5 | own process | pass | pass | pass (by construction, pids recorded) |
| 6 | loop contained and ended | pass | pass | pass |
| 7 | hang after `drawn` detected | pass | pass | pass |
| 8 | death handled (SIGKILL, OOM) | pass | pass (SIGKILL; OOM not rerun) | pass |
| 9 | metrics by pid | pass | pass | pass |
| 10 | nothing leaves: WebRTC | **fail** (TURN-TCP and STUN/UDP reach the listeners) | pass (`rtcpolicy+deadproxy`) | pass |
| 10 | nothing leaves: the rest | **fail** (a dns-prefetch query leaves; all else silent) | **fail** (dns-prefetch); passes only with the app-wide `--host-resolver-rules` | **fail** (dns-prefetch) |
| 11 | app out of reach | **fail** (Notification `granted`) | pass (`perms`) | pass |
| 12 | shared process seen and refused | **not run** (a `file:` page is never shared) | pass (`appscheme`) | holds by construction |
| 13 | hand-over, DecompressionStream | pass | pass | pass |
| 14 | input scoped to the viewer | **fail** (no `input-event` for the frame's input) | fail (no layer fixes it; see Variants) | not required |
| 15 | chords (record) | Ctrl+W, Ctrl+K, F6 reach the app | same | not run |
| B1 | view follows its rectangle | | | **fail as measured, not judgeable here** (drag clean; resize overlap equals the page's own lag) |
| B2 | hidden and shown within one frame | | | pass |
| B3 | zoom 80 % and 125 % | | | pass |

The A + variant column is `--variant=rtcpolicy+deadproxy+perms` (the egress row also with `nodnsprefetch`, which
changed nothing). The `--host-resolver-rules` cell is a separate run with that switch, and 12's cell is
`--variant=appscheme`.

## Per condition

**1. Module script.** The window is a `file:` page under the app's production CSP with `frame-src` extended by
`maws-viewer:`; the harness checks that it is in force, and an inline script in the window is refused. The frame is
`<iframe sandbox="allow-scripts" src="maws-viewer://<32 hex>/viewer.html?format=docx">`. The page's
`<script type="module" src="viewer.js">` ran and posted `ready`. The frame reports origin `null` and
`isSecureContext` true. The scheme log shows `viewer.html` then `viewer.js` from the frame's host.

**2. Dynamic import.** `import('./chunk.js')` from the hook resolved, and the hook itself arrived by `import()` too.
B: the same.

**3. WebAssembly.**
- Under the Excel policy, `WebAssembly.instantiateStreaming(fetch(own-host engine.wasm))` returned the module's `add` (5),
  and `WebAssembly.compile` of the fetched bytes worked.
- Under the Word policy, `WebAssembly.compile` of inline bytes, `new WebAssembly.Module` and `instantiateStreaming` were
  each refused with `CompileError: … 'unsafe-eval' is not an allowed source of script … "script-src maws-viewer:"`, and
  a `securitypolicyviolation` with `script-src` / `wasm-eval`. A plain fetch of the `.wasm` is refused by
  `connect-src 'none'`.

The policy is what admits the compile. B: the same.

**4. The script boundary, and the libraries.** Under both policies, 20 attempts were made in the frame and none ran.

- Seen as violations:
  - `script-src-elem inline`: inline `<script>`, inline module `<script>`, a `javascript:` URL on an anchor and on
    `location`, and `createContextualFragment` with a `<script>`.
  - `script-src-attr inline`: an `on…=` attribute, `<img onerror>` set as an attribute, `<img onerror>` through
    `innerHTML`, through `DOMParser` (nodes adopted into the document) and through `setHTMLUnsafe`.
  - `script-src eval`: `eval`, `new Function`, `setTimeout(string)`.
  - `script-src-elem data` and `blob`: a `data:` or `blob:` `<script src>`, and `import()` of either.
- No-ops by HTML's own rules: a `<script>` inside `innerHTML` or `DOMParser` text, and `<svg onload>` through `innerHTML`.
- `document.write` of a `<script>` and an `<img onerror>` after load: neither ran. No violation event was seen, because
  the document was opened anew.

The libraries drew their samples, by `postMessage` hand-over after `ready`, with zero CSP violations, from the page's
own event and from the console alike. A screenshot of each was checked by eye:

| Library | Sample | Policy | Time | Drawn |
|---|---|---|---|---|
| docx-preview 0.4.1 | sample.docx | Word | 123 ms | 710 chars of text |
| @aiden0z/pptx-renderer 1.4.0 (`pdfjs: false`) | sample.pptx | Word | 309 ms | 2 SVGs |
| @extend-ai/react-xlsx 0.23.0, vanilla API | sample.xlsx | Excel | 2.2 s | 2 sheets, 9 canvases |
| @extend-ai/react-xlsx 0.23.0, vanilla API | sample-recalc.xlsx | Excel | 2.2 s | 2 sheets, 9 canvases |

react-xlsx ran with `useWorker: false` and `setWasmSource(new URL('duke_sheets_wasm_bg.wasm', import.meta.url))`.
B: the same, the bytes fetched once from the view's own host.

**5. Own process.** The window's main frame, a frame, and a frame of another host each had their own pid. Two frames
of the same host shared one process. The frame's pid runs under the seccomp filter. Linux and macOS use the same process
model here (site isolation on desktop).

**6. A loop.** The frame entered `while (true) {}` after `ready`. Over about 3.5 s of typing:
- The window's 100 ms timer fired 35 times; its longest gap was 100 ms.
- Real X11 key events (xdotool, XTEST) typed `abc123xyz` into the window's field; all of it landed.

Removing the iframe element: the pid left `getAppMetrics()` 1 ms after the removal was seen, and the OS process was
gone in 25 ms. B: the same, through `removeChildView` and `webContents.close()` (28 ms).

**7. A hang after `drawn`.** The page said `drawn`, answered one ping, then looped. The window pinged every 500 ms with
a 3 s bound (the design's bound is 30 s; shortened): 2 pings, 1 answered, and the bound tripped at 3.5 s. Removal ended
the process as in 6. B: the isolated-world ping (`executeJavaScriptInIsolatedWorld(999, …)`) with a 3 s bound tripped
at 3.0 s, after the first ping was answered by fragment.

**8. The process dying.** The kill was SIGKILL from main; the out-of-memory death came from a page allocating until
V8's heap limit (B's took 81 s).

- **A.** Electron emits no event for a frame's process: neither `render-process-gone` (app or webContents) nor
  `child-process-gone` fired, in both cases. What main can see within 2 s, all about 23 ms after the kill:
  - the pid leaves `getAppMetrics()`;
  - the frame's `WebFrameMain.isDestroyed()` turns true;
  - its `detached` turns true.

  So the design must poll one of these on its watchdog tick. The window's page saw nothing: no message, no event on the
  iframe element. It then removed the frame, and a fresh frame (new host) drew.
- **B.** `render-process-gone` fires on the view's webContents and on the app: `killed` at 9 ms, `crashed` for the
  out-of-memory death. A fresh view drew.

**9. Metrics by pid.** The frame's pid has an entry of type `Tab`:
- `memory.workingSetSize` went from 97 MiB to 709 MiB after the page held 600 MiB.
- `cpu.percentCPUUsage` went from 0.0 to 12.5 over a 2 s loop.

On Linux that figure is a share of all 8 cores (12.5 = one core at 100 %); a watchdog's threshold must allow for that.
B: the same.

**10. Nothing leaves.** The listeners (`listeners.mjs`): an HTTP server, a WebSocket server, a raw TCP listener
standing for a TURN server, a UDP listener and a raw TCP listener for preconnects. Each was up on 127.0.0.1 and on the
VM's non-loopback address, and each logs every connection, request and packet. Alongside them:
- a `tcpdump` of port 53 caught any DNS query carrying the run's token;
- the `maws-artifact:` handler logged requests.

Every attempt in the list was made from inside the page, against both addresses, under both policies:
- fetch (cors, no-cors, keepalive), XHR, `sendBeacon`, WebSocket, EventSource, WebTransport;
- `<img>`, a stylesheet link, CSS `url()` for an image and a font, `@import`;
- `<link rel=preconnect|dns-prefetch|prefetch|modulepreload>`;
- `<script src>`, `import()`, `window.open`, `<a ping>`, `<iframe>`, `<object>`/`<embed>`, `<video>`, SVG `<image>`;
- Worker (remote and own host), SharedWorker, service-worker registration;
- fetch of `file:`, and fetch and `<img>` of `maws-artifact:`.

The navigations each ran in a frame of their own: `location =`, `top.location =`, a form submit (`_self` and `_top`),
meta refresh, `<a target=_top>`, `<a target=_blank>` and a click on `<a download>`. Named hosts (`<token>-….example.com`)
were tried too, so that the DNS capture shows whether an attempt resolved its host: dns-prefetch, dns-prefetch after a
page-set `x-dns-prefetch-control: on`, fetch, `<img>`, WebSocket, an anchor hover and a TURN server by name.

- **Control** (the same page with no policy and no sandbox attribute): the listeners saw fetch, XHR, beacon, WebSocket,
  EventSource, image, stylesheet, fonts, `@import`, prefetch, modulepreload, script, import, `window.open`, ping,
  iframe, object, embed, video, SVG image and UDP packets, on both addresses. DNS queries left for every named host. So
  a silent listener means something.
  - Two attempts reached nothing even in the control: `<link rel=preconnect>` (no connection to the preconnect
    listener) and remote/shared workers (refused as cross-origin). Their silence below proves nothing.
  - Navigations: the window's own `frame-src` blocked every frame navigation to http, even in the control. `top`
    navigation from a cross-origin frame without activation is refused.
- **A as specified, all but WebRTC.** The listeners saw nothing, and neither did the `maws-artifact:` handler. Every
  attempt was refused, by a CSP violation (connect-src, img-src, style-src, font-src, script-src, default-src for
  prefetch, media-src, object-src, frame-src) or by the sandbox (`window.open`: "allow-popups … not set"; storage;
  workers: SecurityError). Two observations:
  - `sendBeacon` returned `true`, but the request was refused by CSP and never arrived.
  - `<a download>` without `allow-downloads` becomes a navigation of the frame, which the window's `frame-src` blocks:
    the frame is replaced by an error page, and the viewer is gone.

  The window stayed on its page through every navigation.
- **But DNS leaves.** The capture shows queries for `<token>-word-lo-dnsprefetch.example.com` and the rest, so a hostname
  the page builds reaches the resolver and, from there, the network: a DNS exfiltration channel that CSP does not
  govern.
  - What does not stop it: Blink's `X-DNS-Prefetch-Control: off` response header (variant `nodnsprefetch`), which governs
    automatic anchor prefetch, not an explicit `<link rel=dns-prefetch>`; and the proxy that reaches nothing.
  - What does not leak: blocked fetch, image and WebSocket by name resolve nothing, because CSP refuses them first.
  - A TURN server named by hostname is resolved too, as specified. Under the `deadproxy` layer it is not.
- **WebRTC** was run twice, with and without `webrtc 'block'`, plus a control, against both addresses. The page built
  `new RTCPeerConnection({ iceServers: [{ urls: 'turn:<addr>:<tcp port>?transport=tcp', username, credential }],
  iceTransportPolicy: 'relay' })` with a data channel, `createOffer` and `setLocalDescription`. It did the same with a
  `stun:` server (policy `all`) and with TURN over UDP.
  - Chromium logs `Unrecognized Content-Security-Policy directive 'webrtc'.` and ignores the directive.
    `RTCPeerConnection` is a function in the sandboxed frame.
  - **The listeners' own logs** (`runs/<time>/listeners.jsonl`), with and without the directive alike (both are
    therefore what holds), and the same in the control: on each address the TURN listener logs `{"listener":"tcp-turn","event":"connection"}`
    and then `{"event":"data","head":"00030008…"}`, a TURN Allocate request over TCP. The UDP listener logs STUN Binding
    requests (`0001…`) and TURN-UDP Allocates (`0003…`).

  The WebRTC part, a hard condition, **fails in A as specified**. In B (its own session, the proxy that reaches nothing,
  `disable_non_proxied_udp`) both listeners stay silent, with and without the directive. That is the WebRTC-over-TCP
  residual the app's existing HTML frame already carries: `docs/tech-debt-tracker.md`, row 2026-10-06 (E2) "Residual
  egress from a deliverable frame", amended on this branch with this spike's results.

**11. The app out of reach** (A, the frame focused by script, without a gesture).
- **Held:**
  - `parent.document` throws SecurityError, and `top.maws` throws.
  - The preload's `maws`, `require` and `process` are undefined.
  - `localStorage`, `sessionStorage`, `document.cookie`, IndexedDB and Cache Storage all throw (sandboxed, opaque
    origin).
  - `clipboard.readText` and `clipboard.writeText` are refused: "The Clipboard API has been blocked because of a
    permissions policy".
  - `getUserMedia` is refused with "Invalid security origin". That was under `--use-fake-device-for-media-stream`; with
    no device it says NotFoundError, which decides nothing.
  - Geolocation is refused: "disabled in this document by permissions policy".
- **Not held:** `Notification.requestPermission()` resolves `granted`. A as specified installs no permission handler,
  and Electron grants every request by default. The app's own `guardPermissions('store-frames')` exists for this.

B, with every permission refused on its session: all held. The clipboard is refused by permission ("Read permission
denied"), Notification `denied`, geolocation "User denied".

**12. A shared process.** With `--disable-site-isolation-trials`, with
`--disable-features=SitePerProcess,IsolateSandboxedIframes,IsolateOrigins,OriginKeyedProcessesByDefault`, and with
`--process-per-tab` added, the frame kept a process of its own. Chromium does not put another site's frame in a `file:`
page's process. The check said `shared: false`, and the bytes were handed (correctly). So the condition cannot be
exercised as written: **not run**.
- The variant `appscheme` loads the window page from a standard scheme of its own (`maws-app://app/index.html`) under
  the same CSP. Without the switch, frames still get their own processes. With `--disable-site-isolation-trials`, the
  frame's pid equals the main frame's; main's check (`maws.checkFrame`, comparing `WebFrameMain.osProcessId` with the
  main frame's) said `shared: true`; the window handed over no bytes; the frame never said `drawn`.
- A `file:` window page is itself a guard against this failure.

**13. The hand-over.** A 25 MiB `ArrayBuffer`, transferred by `postMessage(msg, '*', [buffer])`, arrived whole: the same
length and the same checksum. The sender's buffer was detached (byteLength 0). The `postMessage` call took 0.2 to 1.9
ms, and post to arrival in the frame 64 to 76 ms. `DecompressionStream('deflate-raw')` exists in the frame: the page
inflated a 16 MiB stream, counted 4 MiB in 64 chunks, then cancelled the reader (the next read says `done`). B: the 25
MiB file was fetched once from the view's own host in 218 to 401 ms, and a second fetch got 404.

**14. Input scoped to the viewer** (real X11 input through xdotool).
- From the window: `mouseenter` and `mouseleave` on the iframe element fire. After a click in the frame,
  `document.activeElement === iframe`; after a click on the window's field, it is not. The frame's own keydowns saw
  `q`, `z`.
- **But main's `input-event` fires for none of the input given inside the frame.** As a control, the same mouse and keys
  over the window outside the frame give `mouseMove`, `rawKeyDown`, `char`, `keyUp`. Electron attaches `input-event` to
  the main frame's widget only.
- `before-input-event` does see the keys typed inside the frame (`q`, `z`). Fails as specified.

**15. Chords with the keyboard in the frame** (recorded). On Linux, `CmdOrCtrl` is Ctrl.

| Chord | App menu accelerator | `before-input-event` | Frame's keydown | Window's keydown |
|---|---|---|---|---|
| Ctrl+W | fired | yes | yes | no |
| Ctrl+K | fired | yes | yes | no |
| F6 | fired | yes | yes | no |
| Super+W, Super+K (the Cmd key's position) | no | yes | yes | no |

So the app's accelerators reach the app from inside the frame, and the frame also sees the key.

**B1. The view follows its rectangle.** The window page reports the slot's rectangle in CSS pixels, and main sets the
view's bounds to it times the zoom factor. Frames were captured from the display at 60 per second (ffmpeg x11grab, one
row through the slot) and classified by colour: the side column, the edge, the slot, the view, and a right-hand panel
that a lagging view would cover.
- **Edge drag** (xdotool: 95 moves at about 16 ms, the edge to 582 px and back to 142 px): 240 frames, 0 with the view
  over anything else, 2 with the slot exposed behind it.
- **Window resize** (setBounds 1400 → 1000 → 1400 px in 10 px steps at about 16 ms): 42 frames overlapping, 33 exposing
  the slot.
- **Control** (the same resize with the view hidden): 41 frames in which the window page itself had not caught up.

On this display, a resize's overlap cannot be told apart from the window page's own lag. Fail as measured, not
judgeable here. In an earlier run the view-to-control figures were 44 to 19. With the variant `anchor` (main moves the
view on the window's own `resize`, keeping the last reported margins) they were 24 to 40.

**B2. Hidden and shown within one frame.** A menu of the window spans the side column and the view's rectangle; main
calls `setVisible` on the window's IPC. Over 10 opens and closes: 0 frames with the menu drawn but the view still over
it, 0 with the menu gone and the view not yet back, 182 consistent open frames, 268 consistent closed frames.

**B3. Zoom.** At 80 %, 100 % and 125 %, the view's drawn edges lie within 0.2 px of the slot's rectangle in DIPs
(`setZoomFactor` and the page's report times the factor), with 0 slot pixels exposed.

## Variants (separate from the result as specified)

Each is a layer added to A's setup (`--variant=a+b+…`). Only the layers that change a result are listed.

| Variant | Condition | What it does | Result |
|---|---|---|---|
| `rtcpolicy` | 10 WebRTC | the window's `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` (what the app's `guardFrames` already sets) | UDP silent; **TURN-TCP still connects** (the tracker's residual) |
| `deadproxy` | 10 WebRTC | `session.setProxy({ proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9;socks=127.0.0.1:9', proxyBypassRules: '<-loopback>' })` on the window's session (`<-loopback>` removes the implicit loopback bypass) | TURN-TCP silent; **STUN and TURN-UDP still reach** |
| `rtcpolicy+deadproxy` | 10 WebRTC | both | **both listeners silent** on both addresses, with and without `webrtc 'block'`; all other conditions unchanged (the libraries still draw: the custom schemes are not proxied) |
| `perms` | 11 | permission request and check handlers that refuse a request from a `maws-viewer:` URL or the opaque origin `null` (the app's `guardPermissions('store-frames')`, adapted) | Notification `denied`; 11 passes |
| `nodnsprefetch` | 10 DNS | `X-DNS-Prefetch-Control: off` on the viewer's answers | **no effect** on `<link rel=dns-prefetch>` |
| switch `--host-resolver-rules=MAP * ~NOTFOUND` | 10 DNS | the app-wide resolver answers nothing | **no DNS query leaves**. But it is app-wide, every session included: the in-app browser and anything else resolving through Chromium would stop working. A reference point, not a fix |
| `--disable-blink-features=RTCPeerConnection` | 10 WebRTC | | no effect (RTCPeerConnection still a function) |
| `appscheme` | 12 | the window page from `maws-app:` instead of `file:` | 12 exercisable, and passes |
| (none found) | 14 | | No setting makes `input-event` fire for an out-of-process frame. What the measurements give instead: `before-input-event` (keys, from inside the frame) together with the window page's own `mouseenter`/`mouseleave` and `activeElement` reported over its preload. |
| `anchor` | B1 | main re-anchors the view on the window's `resize` | fewer overlapping frames (24) than the page's own lag (40) on this display; to be judged on a Mac |

The `deadproxy` layer's cost: the window's session (the default session in this setup) reaches no network over HTTP.
The app's page needs none (its CSP has `connect-src 'self'`). But anything in main using that session's networking
(`net.fetch`, `net.request`) would fail too. Putting the app window on a partition of its own keeps the default session
for main; that partition change has its own costs (storage moves).

## What the result selects, by the specification's own rule

- **A as specified does not pass all of 1 to 14.** It fails 10 (WebRTC and DNS), 11 and 14, and 12 cannot be run.
- **The rule for the separate view does not apply.** It needs A to fail *only* containment conditions (5, 6, 7, 8, 10,
  12), and B to pass its list. A also fails 11 and 14. B fails 10 (DNS prefetch), and B1 cannot be judged here.
- **"Nothing is built" does not apply.** It needs 1 to 4 to fail in both; they pass in both.
- **"No preview ships" does not apply.** It needs 10's WebRTC part to fail in both; B passes it, and so does A with the
  `rtcpolicy+deadproxy` layers.

So the specification's rules select nothing: the result goes back to the architect. What the architect has to decide:

1. **The DNS-prefetch channel.** It is open in both architectures, and nothing scoped to the viewer closed it. It is a
   containment failure the rule list did not anticipate, so the architect decides whether it blocks a preview, as
   10's WebRTC part would. The app's existing HTML frame very likely has the same channel; not measured here.
2. **A with three main-side layers.** With `disable_non_proxied_udp`, the proxy that reaches nothing and the permission
   refusal, A passes everything but 14 and 10's DNS part. For 14, the window's own pointer and focus events plus main's
   `before-input-event` give the same knowledge as main's `input-event` would, except mouse input inside the frame.
3. **B adds no containment over that A.** It passes the same conditions as that A, adds a compositor-level layout
   problem (B1) that this display cannot judge, and fails the same DNS part.

## What remains to be confirmed on a Mac

Run `node run.mjs` there (no xvfb).

- **Real input.** The harness has a real input source only on Linux (xdotool). On macOS:
  - 6 falls back to `sendInputEvent`: synthetic events delivered through the browser, which do not prove that real
    keyboard focus stays with the window while the frame loops.
  - 14 and 15 report not run.
  - B1 to B3 report not run: they need frame capture from the screen.
  - These need a real input driver (for example cua) and a screen recorder.
- **15.** Cmd-W and Cmd-K on macOS go through NSMenu key equivalents before the renderer, unlike Ctrl on Linux; F6 too.
  This is the one most likely to differ.
- **B1 to B3.** On macOS a WebContentsView is its own NSView and CALayer, composited by the window server, not drawn in
  Chromium's compositor as on Linux; the frame-by-frame behaviour of setBounds and setVisible against the window
  page's own frames may differ either way. Retina (scale 2) also changes B3's rounding.
- **8.** The out-of-memory path differs: macOS memory pressure and V8 limits. Check that the same main-side signals
  (`isDestroyed`, `detached`, pid gone) arrive within 2 s.
- **9.** Whether `percentCPUUsage` is normalized the same way on macOS, and what `workingSetSize` (resident) reads there.
- **11.** On macOS a real Notification Center, camera and microphone exist. Run 11 as specified there to see what
  `granted` actually allows (a visible notification), and confirm `perms` refuses it.
- **The sandbox** is the macOS seatbelt, not seccomp. `getAppMetrics()[].sandboxed` reports it there; the harness
  prints it in 5.
- **10.** It should not depend on the OS: proxy resolution, ICE gathering and the DNS prefetch are Chromium's own.
  But macOS may have a system resolver cache between the page and the network, and the capture there needs
  `tcpdump` with privileges. The harness reports `DNS capture: not running` without them.
