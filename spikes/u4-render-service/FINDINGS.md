# U4: windowless Electron as the machine's render service — findings (2026-10-31)

> **Composite:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child O5, parent pin `f9e7dfc540683dae84d13135a3f849fd52b4bcdd`. **Unknown:** P5 §13 U4, "windowless Electron under a LaunchAgent and on a devcloud VM, and headless Chromium's fidelity for export on Linux; with them, one Electron process or two (§2's criterion)". **Execution document:** `docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md` (M1 closed the macOS half on 2026-10-31; M6 reads §1's packaging facts). The probes are beside this file: `linux/` (`main.cjs` the Electron probe, `fixture.html` the fidelity fixture, `run.sh`, `run2.sh`, `run3.sh` the three rounds, `evidence/` the pictures and round 3's summary), `macos/{run.sh,parent.cjs}` (the mini's runs, through CI-opt).

The probe is one small Electron app that does what `src/main/artifacts/capture.ts` and `export.ts` do: registers a privileged scheme and serves a fixture from memory (the fixture's Korean serif face inlined as a `data:` URL, as the product's exporters inline a design system's faces), renders it in an offscreen window with capture.ts's `webPreferences`, captures the viewport and the whole page, prints a PDF with the page's own `@page` size, repeats the capture and the print through the hidden-window fallback (`capturePage(…, {stayHidden: true})`, and `printHtmlToPdf`'s JavaScript-off window), then reads the process tree's memory at `ready`, right after the renders and 10 s later. Every step's timing and outcome is in each run's `result.json`.

## 1. The Linux half: a devcloud VM (done 2026-10-31, `dc-u4render-9c94`, deleted)

Ubuntu 24.04.5, kernel 7.0.0-1014-gcp, 4 vCPU, 8 GB, no display, the user `new` with lingering on; Electron 44.4.5 linux-x64 from GitHub's release (`SHASUMS256.txt` checked), Node 24.21.0 inside it. Three rounds, each a script in `linux/`, 09:24Z to 09:38Z.

### 1.1 What the zip needs from the system

`ldd electron` on the bare image lacked three libraries: `libcups.so.2`, `libgtk-3.so.0`, `libpango-1.0.so.0`. After `apt-get install libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgbm1 libgtk-3-0t64 libasound2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libpango-1.0-0 libcairo2 libatspi2.0-0t64 libxshmfence1 fontconfig` nothing is missing (round 1's `ldd-after.txt`). The zip is 123 MB and unpacks to about 290 MB. The packages of this list the image did not already carry are a few tens of MiB; the exact set a package install needs is what `ldd` names, so `mawsd render install` checks `ldd` rather than carrying a list.

### 1.2 The display condition: GTK, not Chromium, decides

- **Round 1, no display at all.** Every variant (`--headless`; `--headless --no-sandbox`; `--headless --disable-gpu`; `--ozone-platform=headless`; under `systemd-run --user`) reached `app.whenReady()` and then aborted at the first `new BrowserWindow(…)` with `Gtk-ERROR **: Can't create a GtkStyleContext without a display connection` (SIGTRAP, exit 133; `--ozone-platform=headless` alone segfaulted). Electron's window creation initialises GTK on Linux whatever Chromium's headless flag says. An Electron that only reaches `ready` and opens no window runs fine with no display (the idle readings of §1.5 were taken that way).
- **Round 2, Xvfb.** Under `xvfb-run -a -s "-screen 0 1280x800x24 -nolisten tcp"` every variant reached `ready` and captured the 1280×800 viewport (paint-settled, 11.5% of pixels not background). The whole-page capture (the window resized to 1280×2348 and captured again) then failed with `UnknownVizError` under Chromium's own GL fallback, under `--disable-gpu`, under the unit and with `--no-sandbox`; it worked with `--headless` beside Xvfb (x4: capture 576 ms, whole page 353 ms, PDF 262 ms) and with SwiftShader (`--use-gl=angle --use-angle=swiftshader`, x3: 1058 ms, 813 ms, 538 ms). The probe then exited 0 after its offscreen window was destroyed: Electron quits on `window-all-closed` on Linux, which a render host that opens and destroys a window per request has to handle (one line: `app.on('window-all-closed', () => {})`).
- **Round 3, the candidate whole:** `xvfb-run … electron --headless --hide-scrollbars main.cjs`, the SUID sandbox on. From a shell (y1, y4) and under `systemd-run --user …` (y2) every step passed with no error: offscreen capture at 1.2 s from the process start (the first window's cost; the viewport settle hit its 500 ms timer rather than a paint event under `--headless`, so a render host keeps capture.ts's settle as it is), whole-page capture 0.65 s, `printToPDF` 0.28 s, the hidden-window capture 1.1 s, the hidden-window JavaScript-off print 1.2 s; the process exited by itself at the end. SwiftShader without `--headless` (y3) passed every step too, 10 to 50% slower per step, and is the named alternate.
- **Scrollbars.** Round 2's viewport capture carried a classic 15 px scrollbar at the right edge (`evidence/round2-x4-offscreen.png`); macOS hides its overlay scrollbars. `--hide-scrollbars` removes it (`evidence/round3-unit-offscreen.png`, `-whole.png`).
- **The hidden window is 1279×799 under X**, one pixel short of the asked content size on both axes, in every round-3 run; the offscreen window is exact. A render host on Linux uses the offscreen path, as the product does by default, and the hidden-window fallback would need its size read back.

**The condition for the render host on Linux:** a virtual X display for GTK (Xvfb, `xvfb` package; 15.5 MiB RSS for the server), `--headless` for Chromium's software compositing, `--hide-scrollbars`, the sandbox as §1.3. Rejected: a Wayland compositor (`weston --backend=headless`) for the same display need at more cost; a CDP-driven headless Chromium, which would need a second render implementation beside the Electron one.

### 1.3 The sandbox

Ubuntu 24.04 restricts unprivileged user namespaces (`/proc/sys/kernel/apparmor_restrict_unprivileged_userns` reads 1), so Chromium's namespace sandbox is unavailable, and the zip's `chrome-sandbox` is not setuid: as shipped, Electron aborts at once with `The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now. You need to make sure that …/chrome-sandbox is owned by root and has mode 4755` (round 1, r2; 254 ms). After `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` the sandbox works under the shell and under the unit (round 3: `noSandbox: false` in every `ready` step, the zygote started through `chrome-sandbox`). `--no-sandbox` also runs (round 2, x6) and is never the product's flag: artifact HTML is model-authored and runs scripts.

### 1.4 Fonts

A bare devcloud VM carries DejaVu alone (3 families): `fc-match` answered `DejaVu Sans` for `sans-serif`, `serif`, `monospace`, `system-ui`, `:lang=ko`, `:lang=ja`, `:lang=zh` and `emoji`, so CJK and emoji would draw as tofu. With `fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji` installed: `sans-serif → Noto Sans`, `serif → Noto Serif`, `monospace → DejaVu Sans Mono`, `:lang=ko → Noto Sans CJK KR`, `:lang=ja → Noto Sans CJK JP`, `emoji → Noto Color Emoji`. The pictures show sans, serif and mono as distinct faces, Korean through the bundled `Noto Serif KR` (loaded from the `data:` URL: `document.fonts` reads `Noto Serif KR: loaded`, its line 757 px wide against the fallback's 735) and through Noto Sans CJK, Japanese and Chinese glyphs, colour emoji, gradients, an inline SVG, a canvas drawn by script, shadows and a table. The PDFs (both paths, every round-3 run) are A4 (594.96 × 841.92 pt, the fixture's `@page`), 4 pages, Skia/PDF m152, with every face embedded and subset: NotoSans-Regular and -Bold, NotoSerif-Regular, DejaVuSansMono, NotoSerifKR-Regular, NotoSansCJKjp-Regular, NotoColorEmoji (Type 3), DejaVuSans; `pdftotext` recovers the text. Fidelity for export on Linux is a packaging matter (the fonts), not a rendering one. Round 2 also showed the fixture's first attempt to load the face from the scheme blocked by the frame policy (`font-src data: blob:`), which is the product's policy too: a design system's faces reach a render inlined, as the exporters already do.

### 1.5 The idle cost of each shape

Read with `ps` (RSS summed over the tree) and, inside the probe, `app.getAppMetrics()` (working set per Chromium process), on the VM:

| What | RSS / working set |
|---|---|
| Plain Node holding a timer (the Linux pack's `mawsd` runtime) | 43 MiB |
| Electron 44.4.5 run as Node (`ELECTRON_RUN_AS_NODE=1`, what a Mac's `mawsd` runs on) | 98 MiB |
| Xvfb alone | 15.5 MiB |
| Windowless Electron at `ready`, no window yet (a single-process `mawsd` at all times) | 137 MiB working set (the browser process alone); 263 MiB RSS over the tree with the zygote and the network service (round 1, no display) |
| The same after one render, windows destroyed, 10 s idle | 450 MiB working set: browser 219, GPU 148, network service 83 (the GPU process stays once a window existed) |
| During a render | about 710 MiB: a renderer 160 and the print compositor 100 beside the above |

A cold start to the first capture is about 1.2 s; the render host's own life (spawned at a request, ended when quiet) is the shape that keeps a machine's idle at the plain-Node figure.

### 1.6 What a render host carries from this

`xvfb-run -a -s "-screen 0 1280x800x24 -nolisten tcp" <electron> --headless --hide-scrollbars <entry> --render-host <profile>`; the SUID helper set at install; `window-all-closed` handled; the offscreen path (never the hidden window's size); the Noto packages beside `fonts-dejavu-core`; the libraries of §1.1; the idle cost paid only while a render host lives.

## 2. The macOS half: the mini through CI-opt (M1)

`cd <worktree> && pnpm install --frozen-lockfile && bash spikes/u4-render-service/macos/run.sh`, run by CI-opt on the mini host (macOS 27.0 arm64, the repository's pinned Electron 44.4.5, Chrome 152) as a transient agent bootstrapped into `gui/501` (`launchctl managername` inside reads `Aqua`). The probe runs the same fixture and steps as the Linux half under four conditions: a shell in the GUI session (r1); the production tree under launchd (r2: a plain-Node parent, Electron run as Node as a LaunchAgent-run `mawsd` is, a one-shot job in `gui/<uid>`, spawning the Electron probe as its windowless child without `ELECTRON_RUN_AS_NODE`, `macos/parent.cjs`); the fallback tree (r2b: the Electron probe itself as the job, adopted by the seam only if r2 fails and r2b passes); and the accessory activation policy from a shell (r3, `--accessory`: `app.setActivationPolicy('accessory')` before `ready`, `app.dock.hide()` after); then the idle footprint of a windowless Electron at `ready` and of Electron run as Node.

### 2.1 The first run (master b17354c0a, 10:30Z to 10:33Z): r1, r3 and the idle numbers conclusive, the launchd runs not

- **r1 and r3**: exit 0, nine steps, no error. The offscreen capture settles by paint at 0.8 s (r1) and 0.36 s (r3) from the process start, with `Noto Serif KR: loaded`; the whole-page capture at 1280×2348 (0.1 to 0.26 s); the offscreen `printToPDF` 4 pages and 3 embedded font files (0.4 to 1.5 s); the hidden-window capture and the JavaScript-off print pass. Under `--accessory` `dockVisible` reads false at `ready` (r3), true without it (r1).
- **The hidden-window fallback captures device pixels on a Retina Mac**: 2560×1600 for a 1280×800 window (`devicePixelRatio` 2), where the offscreen window captures 1280×800 at scale 1, as `capture.ts` says of offscreen's default. The render host keeps the offscreen path; a hidden-window fallback would have to divide by the scale factor.
- **Memory** (`app.getAppMetrics`, working set, the browser process's RSS beside it): at `ready` before any window, 128 MiB (the browser process alone, no helper yet); right after the renders with the windows destroyed, about 1.5 GiB across the tree (a renderer of 817 MiB and the print compositor of 304 MiB still winding down); 10 s later 319 to 348 MiB: the browser 203 to 218 MiB, the GPU helper 75 to 83 MiB, the network service 41 to 46 MiB. Idle at `ready` under the accessory policy for 15 s: the tree's RSS 218,432 KiB (the browser 115,952, the GPU helper 59,728, the network service 42,752); `phys_footprint`, acceptance 14's reader, 26 MB for the browser process and 6.4 MB for the network service, the GPU helper's line unparsed by the first reader (fixed at b7a2865ab, below). Electron run as Node idles at 56,144 KiB RSS on the mini (`mawsd`'s own footprint there reads about 27 MiB, P5 Risks).
- **r2 and r2b were inconclusive because of the harness, not launchd**: `launchctl submit` makes a keep-alive job, so each run was relaunched about every 13 s (five `codesign_util task_name_for_pid failure (5)` lines 13 s apart in r2's stderr); r2's `parent.json` records its first child exiting 0 after 12.9 s with six steps done, while the run's `result.json` belongs to a later relaunch that the script's `launchctl remove` SIGTERMed mid-run (`GPU process exited unexpectedly: exit_code=15`). Every relaunch reached `ready`, the accessory policy and six steps under launchd's GUI domain, which already says the domain renders offscreen; the one-shot proof is the rerun's.
- The probe used Electron's default `userData` (`~/Library/Application Support/Electron`, a directory an unpackaged Electron run had made on the mini on 2026-10-20), writing into its caches; fixed at b7a2865ab, each run keeping its profile under its own result directory.

### 2.2 The rerun (b7a2865ab, PR #393; 10:39:59Z to 10:41:30Z): the production tree holds, once

One-shot launchd jobs (a plist bootstrapped into `gui/501` with `RunAtLoad` and `KeepAlive` false, booted out after the result), each run's Chromium profile under its own result directory, the footprint reader on each process's `phys_footprint:` line. `run.sh` exited 0 and raised no dialog; the mini's `~/Library/Application Support/Electron` was not touched.

- **All four runs**: nine steps, no error, `ready` first and `memory idle 10 s after the renders` last; wall times r1 14 s, r3 13 s, r2 16 s, r2b 16 s. Under launchd (r2, r2b) the steps read as the shell's: `ready` at about 50 ms with the accessory policy and `dockVisible` false, the offscreen capture settled by paint at 0.37 s with `Noto Serif KR: loaded`, the whole-page capture at 0.46 s, the offscreen `printToPDF` (4 pages, 3 embedded font files) at 0.88 s, the hidden-window capture (2560×1600, device pixels) at 1.7 s, the JavaScript-off print at 2.8 s.
- **r2, the production tree**, ran exactly once: `launchctl print` reads `runs = 1`, `last exit code = 0`; `parent.json` reads `parentIsNode: true`, the child's `code: 0`, 12,931 ms. Its stderr holds one Electron line from the child of the Node parent, `ERROR:electron/shell/common/mac/codesign_util.cc:79 task_name_for_pid: (os/kern) failure (5)` (Electron's code-signature check of a parent it cannot inspect from launchd's domain), which affected no step; r2b's stderr is empty. The fallback (r2b) also passes and is not needed.
- **Memory**: at `ready` 128 MiB working set (the browser process alone); 10 s after the renders 356 MiB (the browser 218, the GPU helper 92, the network service 47). Idle at `ready` under the accessory policy for 15 s, the number acceptance 14's reader takes: a tree physical footprint of **43,393 KiB** (the browser 26,624, the GPU helper 10,240, the network service 6,529), the tree's RSS 217,456 KiB. Electron run as Node: 13 MB of physical footprint, 56,160 KiB RSS.

### 2.3 What the render host carries from the macOS half

The production tree (a Node parent in launchd's GUI domain spawning the Electron child without `ELECTRON_RUN_AS_NODE`) is the spawn; `launchctl submit` is never used for a one-shot child (it keeps the job alive); `app.setActivationPolicy('accessory')` before `ready` and `app.dock.hide()` after keep the Dock empty; the offscreen path captures at scale 1 while a hidden window captures device pixels; `userData` is the host's own directory; the one `codesign_util` line under launchd is expected noise.

## 3. The verdict on P5 §2's criterion

**Two processes.** The criterion: the single-process shape wins if it runs reliably under a LaunchAgent and on a devcloud VM *and* its idle memory fits acceptance 14. The reliability clauses hold on both platforms: on the VM under a transient systemd user service with the sandbox (§1.2, §1.3), and on the mini under a one-shot job in launchd's GUI domain with the Dock hidden (§2.2). The third clause fails on the numbers, on the platform the bound is read on: a windowless Electron at `ready` under the accessory policy holds a physical footprint of 43,393 KiB on the mini (§2.2), 5.5 times the 7,910 KiB of headroom under the bound (`e2e:daemon-idle` 91,235 of 99,145 KiB at master 33935b949), where `mawsd` as Electron run as Node idles at about 27 MiB (13 MB of footprint on the mini for the bare runtime); the VM reads the same shape at 137 MiB of working set (§1.5). On Linux the single-process shape would also make the pack carry Electron and Xvfb for every machine, rendering or not. The two-process shape pays the render host's cost only while a render runs, keeps `mawsd` plain Node (P5 Decision Log 22 stays as it is: the machine key's holder is not an Electron process; the render host holds no key), and keeps the Linux pack's runtime the pinned Node, with Electron an optional component. Recorded in O5's execution document (Decision Log) and in P5's Decision Log 164; U4 is closed.

## 4. Acceptance 10 on a VM (M5; not yet run)

## 5. U3: the agent's browser for a remote session (M7; the Linux half run 2026-10-31 on a VM, the macOS half 2026-11-01 on the mini)

The probe is `spikes/u3-remote-browser/` (its own unknown, U3, beside U4's probes): a windowless Electron in the M1 probe's shape (`host/main.ts`: its own `userData`, the accessory policy on macOS, `window-all-closed` kept open) that composes the in-app browser's main side from `src/main/browser/` unmodified, bundled by `build.mjs` (20 of the bundle's 127 inputs: the `TabStore`, `createTabView` and the `Partitions` with the permission guard, the `Navigator`, `guardPage`, `attachWindowOpen`, the input seams, and cua's primitive server `startCuaBackend` with its connection, filter, claims and peer check); it opens one tab on a text page that the driver serves on the machine's loopback, serves one cua connection on the session's socket, and serves a screencast channel (`host/screencast.ts`, `lib/wire.mjs`) on a second unix socket. The driver (`driver.mjs`, plain Node as `mawsd` is) spawns it in a process group of its own, plays cua's host (`lib/cua-client.mjs`, the fake host's client) and a remote app's view: frames are recorded with their sizes and arrival times and acked end to end (the host acks Chromium only when the viewer acks), and clicks go back as `Input.dispatchMouseEvent` through the tab's `TabDebugger`. Four tab modes: `hidden` (a hidden `BaseWindow` holding the view, the app's `tabWebPreferences` with `backgroundThrottling: true`), `hidden-unthrottled` (the same with `setBackgroundThrottling(false)`), `offscreen` (the view made with `offscreen: true`, still in a hidden window, which gives it its size), and on Linux `shown` (the window shown without focus on the render host's own Xvfb, which nobody sees). `linux/run.sh` and `macos/run.sh` each write `results/summary.json`; the Linux runs' summaries and per-mode `driver.json` are under `linux/evidence/`, the mini's under `macos/evidence/` (each `driver.json` carries the host's own `result.json` as `host` and its stderr's tail).

### 5.1 The Linux half (devcloud VM `dc-u3browser-985c`, made 22:53Z, deleted 23:23Z)

Ubuntu 24.04.5, kernel 7.0.0-1014-gcp, 4 vCPU, 8 GB; Electron 44.4.5 linux-x64 (Chrome 152) from GitHub's release (SHASUMS checked), under §1.6's line: `xvfb-run -a -s "-screen 0 1280x800x24 -nolisten tcp" electron --headless --hide-scrollbars`, the SUID `chrome-sandbox` root:root 4755 (`noSandbox: false` in every run). Two rounds: round 1 (23:01Z to 23:08Z) found the offscreen view unsized (no window: the page read 0×0 and painted nothing) and the cua phase all-or-nothing; round 2 (23:13Z to 23:21Z, `linux/evidence/round2-*`) is the reading below. Every run reached `READY` in 0.73 to 0.81 s from the spawn, the host exited 0 on the driver's `exit`, and no host error was recorded.

**The tab engine and cua.** In every mode the cua socket answered its hello in 3 to 7 ms, `tabs.query` listed the tab, `debugger.attach` took 2 to 6 ms, `Runtime.evaluate` 2 to 5 ms, an agent's click through the primitive server 7 to 8 ms (and landed), `tabs.create` opened a second tab that the store placed in a hidden window of its own and that loaded in about 80 to 100 ms, and `tabs.remove` closed it. The difference is the page's visibility:

| Mode | `document.visibilityState` | `Page.captureScreenshot` through cua | The vendor's screencast screenshot | A 10 Hz timer runs at | Screencast frames |
|---|---|---|---|---|---|
| `hidden` (the app's preferences) | hidden | never answers (`Command cancelled: deadline` at 8 s, both tabs) | 118 ms (the start's first frame) | 0.6 Hz | the first only; the viewer's click (a move, a press, a release) takes 5 s to dispatch, though cua's press and release take 7 ms |
| `hidden-unthrottled` | hidden | never answers (deadline, both tabs) | 122 ms | 10 Hz | yes |
| `offscreen` | visible | 119 ms (179 KB PNG); the second tab 134 ms | 43 ms | 10 Hz | yes |
| `shown` (Linux Xvfb only) | visible | 108 ms; the second tab 135 ms | 43 ms | 10 Hz | yes |

A hidden window is the wrong home for an agent's tab: Chromium treats the page as hidden, so `Page.captureScreenshot` (what cua's host sends for a screenshot when the screencast start yields no frame, and what its other captures send) waits for a frame that never comes, and with the app's throttling the page's timers and input stall too. An offscreen view (OSR) paints regardless of any window, which is what capture.ts already relies on for renders, and is the mode that is the same on both platforms; `shown` is a Linux-only equivalent.

**The screencast** (`Page.startScreencast {format: 'jpeg', quality: 60, everyNthFrame: 1, maxWidth: 1280, maxHeight: 800}`, every frame 1280 wide), the three painting modes:

| Reading | `hidden-unthrottled` | `offscreen` | `shown` |
|---|---|---|---|
| A static text page | 1 frame in 4 s (the start's) | 1 | 2 |
| Text page, a clock redrawn at 10 Hz: frames per second, median interval | 10.0, 100 ms (p95 105) | 10.0, 100 ms (p95 103) | 10.0, 100 ms (p95 103) |
| Same: bytes per second (median frame) | **1,403,773 B/s** (140,376 B) | **1,403,784 B/s** (140,393 B) | **1,403,585 B/s** (140,385 B) |
| The whole viewport scrolling every 16 ms: fps, bytes per second (median frame) | 59.6, 8.97 MB/s (150,117 B) | 39.6, 5.96 MB/s (149,980 B) | 51.5, 7.75 MB/s (150,091 B) |
| Click to paint, 20 clicks: median, p95 (min to max) | 44, 53 ms (36 to 56) | 56.5, 65 ms (47 to 66) | 47.5, 55 ms (40 to 57) |
| Host to viewer per frame (median) | 1 ms | 1 ms | 1 ms |

A screencast sends a frame only when the page paints, so its cost is the page's change rate times the frame's size: a still page costs nothing, a page changing at 10 Hz costs 1.40 MB/s at quality 60 for this dense serif article (every frame a whole 1280×800 JPEG of about 140 KB), and continuous scrolling 6 to 9 MB/s. Only the CDP source is flow-controlled: the driver acks each CDP frame and the host acks Chromium only then (`driver.mjs`'s frame handler, `host/screencast.ts`'s `ack`), so that stream can be paced to what a channel carries. The subscription source has no acks: the host encodes every frame and writes it with no regard for the socket's backpressure (`host/screencast.ts`'s `send` and the `beginFrameSubscription` callback). The subscription readings establish frame size, cadence and continuity, not that its stream adapts to a slower channel; on a local socket nothing was slow. The click-to-paint round trip is local (no channel in it): dispatch, the page's handler, the paint and the frame's delivery.

**The viewer's screencast and the agent's share one CDP attachment, and collide.** The tab has one `TabDebugger` (one CDP session) that cua's lease and any other user share. Two faults, in every painting mode: the agent's plain screenshot (a screencast start, one frame, a stop) ends the viewer's stream (10 fps before, 0.3 fps in the 3 s after, back to 10 only when the viewer restarts it); and cua's connection forwards every event of its leased tab to cua's host (`connection.ts` `forward`, a `'*'` listener), so the viewer's frames reached the agent's host while it held the lease: 525 to 706 `Page.screencastFrame` events, 104 to 141 MB, in the 45 s of the screencast phases. Electron's own frame subscription (`webContents.beginFrameSubscription`, encoded with `toJPEG(60)` in the host) uses no CDP session and gives the same stream: 10.0 fps, 100 ms median interval, 1,403,580 to 1,403,772 B/s at a 10 Hz page in the three painting modes, click to paint 46.5 to 48.5 ms median (p95 54 to 59 ms). In `hidden` it delivers nothing either.

**Memory, the render host's process tree with one tab** (RSS from `ps` per process; Xvfb, about 15.5 MiB by §1.5, outside it):

| Mode | At `ready`, no tab (browser process alone) | One tab loaded, idle | Streaming | 10 s after the screencast stopped |
|---|---|---|---|---|
| `hidden` | 138,672 KiB | 512,952 KiB | 555,304 KiB | 554,212 KiB |
| `hidden-unthrottled` | 138,372 KiB | 363,156 KiB (no GPU process yet) | 599,692 KiB | 575,296 KiB |
| `offscreen` | 138,592 KiB | 543,948 KiB | 628,556 KiB | 604,092 KiB |
| `shown` | 138,216 KiB | 527,380 KiB | 623,692 KiB | 570,948 KiB |

In `offscreen` with the stream stopped: the browser 181,920 KiB, the GPU process 197,700, the network service 90,928, the tab's renderer 133,544. A held tab on a machine with no app keeps about 0.53 to 0.60 GiB resident on Linux, the order §1.5's after-render reading predicted.

### 5.2 The macOS half (the mini through CI-opt, 2026-11-01 03:25:59Z to 03:31:53Z)

CI-opt ran `pnpm install --frozen-lockfile && bash spikes/u3-remote-browser/macos/run.sh` on the mini host (macOS 27.0 arm64, GUI session Aqua; Electron 44.4.5, Chrome 152; Node 26.4.0 for the driver) at a3a0d7c87, after one fix to the probe: `host/linux-peer.ts` read `/proc/stat` when the bundle loaded it, which threw on darwin before `READY` in every mode of the first attempt at dec050198 (it now reads it at its first lookup). The host ran with the accessory policy (`dockVisible: false`) and the committed darwin-arm64 peer addon, the driver as the trusted root; three modes, `hidden`, `hidden-unthrottled`, `offscreen` (no `shown`: a shown window is on a person's screen on a Mac). Every mode reached `READY` in 0.63 to 1.21 s from the spawn and the host exited 0 (`macos/evidence/run.txt`, `<mode>-driver.json` `ready`, `hostExit`). The only stderr line is one in `hidden`, `sandbox_extension_issue_file failed for …/Electron Helper.app/Contents/Resources: 1 (Operation not permitted)` (`hidden-driver.json` `hostStderrTail`), which affected no step: nonblocking noise from the repository's unsigned Electron helper under a worktree path, coinciding with no step failure.

**The tab engine and cua** (`<mode>-driver.json`, phase `cua primitives`). Every primitive answered in every mode: hello 1 ms, attach 1 to 27 ms, `Runtime.evaluate` 0 to 1 ms, the agent's click 2 to 41 ms and landed, `tabs.create` loaded in 72 to 107 ms in a hidden window of its own. Unlike Linux, `Page.captureScreenshot` answers on macOS from a hidden window too: 614 ms the first time in `hidden` and 80 ms for the second tab, 81 and 99 ms in `hidden-unthrottled`, 62 and 74 ms in `offscreen`; the vendor's screencast screenshot 59, 14 and 26 ms. The page reads `visibilityState` `hidden` in both hidden modes and `visible` offscreen; `devicePixelRatio` is 2 in a hidden window and 1 offscreen (`tab loaded` step).

**`hidden`, the app's preferences** (`hidden-driver.json`): as on Linux, the page's 10 Hz timer runs at 0.6 Hz, a screencast sends its start frame and nothing more (1 frame in the static phase, 0 in the tick, scroll and subscription windows), and the viewer's clicks all landed (20 of 20, `isTrusted`) with none painted to the viewer (20 of 20 missing), each taking 5,200 ms to dispatch (median; the subscription run's 5,196 ms).

**The screencast** (quality 60, every frame 1280 wide although the hidden window's page is at `devicePixelRatio` 2):

| Reading | `hidden-unthrottled` | `offscreen` | File and phase |
|---|---|---|---|
| A static text page | 1 frame in 4 s (127,208 B) | 1 (126,494 B) | `screencast static` |
| Text page, the 10 Hz clock: fps, median interval | 5.7, 192.5 ms (p95 251) | 6.4, 180 ms (p95 210) | `text page ticking at 10 Hz (cdp)` |
| Same: the page's own timer ran at | 5.7 Hz | 6.4 Hz | `pageTicksPerSecond` |
| Same: median frame, bytes per second measured, at 10 fps | 128,217 B; 730,671 B/s; **1,282,170 B/s** | 127,549 B; 816,147 B/s; **1,275,485 B/s** | `medianFrameBytes`, `bytesPerSecond`, `bytesPerSecondAt10fps` |
| Scrolling every 16 ms: fps, bytes per second (median frame) | 60.0, 8.68 MB/s (143,900 B) | 54.9, 7.93 MB/s (143,513 B) | `text page scrolling (cdp)` |
| Click to paint, 20 clicks: median, p95 (min to max) | 49, 62 ms (35 to 63) | 120.5, 177 ms (47 to 177) | `click to paint (cdp)` |
| The frame subscription at the 10 Hz clock: fps, at 10 fps | 6.2, 1,241,745 B/s | 6.0, 1,275,445 B/s | `subscription: text page ticking at 10 Hz` |
| The subscription's click to paint: median, p95 | 55.5, 69 ms | 94, 179 ms | `subscription: click to paint` |

Two macOS differences, both in the page's clock rather than in the stream. The page's 100 ms `setInterval` ran at 5.7 to 6.4 Hz in both painting modes and with either frame source, and the frame rate equals it exactly (`fps` = `pageTicksPerSecond` in every tick window): the screencast sent a frame for every paint, and the page painted at 6 Hz; the 16 ms scroll timer, by contrast, ran at 57 to 61.6 Hz. A windowless accessory app's slow timers being stretched while it idles between them is the signature of macOS timer coalescing (App Nap); the probe did not test that cause (Electron's `powerSaveBlocker.start('prevent-app-suspension')` is the candidate). The bytes-at-10-fps figure is therefore the measured median frame times ten, and the frames are smaller than Linux's (128 KB against 140 KB for the same page). Second, offscreen's click-to-paint samples are a sawtooth (`samples`: 170, 158, 120, 85, 60, 63, 177, 177, 156, 138, 123, 97, 83, 78, 47, 159, …): each click 500 ms after the last lands at a later phase of a paint clock of about 180 ms, the same period as the stretched timer, so an offscreen page that is idle on macOS paints at about 5.5 Hz and the first click after idle waits up to one period; `hidden-unthrottled` shows no such pattern (35 to 63 ms), nor does Linux offscreen (47 to 66 ms).

**The collision row** (`collision with the agent screenshot`): `hidden-unthrottled` 17 fps before, the agent's screenshot 21 ms, 0.3 fps in the 3 s after, 6.4 fps after the viewer restarted its screencast; `offscreen` 16, 27 ms, 0, 7. cua's host received the viewer's frames while it held the lease: 662 and 610 `Page.screencastFrame` events, 125.8 and 116.2 MB. What it means is §5.4.

**Memory, the render host's process tree with one tab** (each process's `phys_footprint`, acceptance 14's reader, and RSS; host steps `memory …`):

| Mode | At `ready`, no tab (browser alone) | One tab loaded, idle | Streaming | 10 s after the screencast stopped |
|---|---|---|---|---|
| `hidden` | 33,792 KiB (RSS 123,280) | **86,257 KiB** (RSS 374,784) | 144,529 (423,808) | 135,313 (425,328) |
| `hidden-unthrottled` | 33,792 (123,328) | **137,361** (397,088) | 278,881 (506,544) | 171,361 (455,920) |
| `offscreen` | 33,792 (123,264) | **134,449** (400,272) | 219,617 (519,152) | 176,609 (495,680) |

In `offscreen` streaming: the browser 71,680 KiB of footprint, the GPU helper 114,688, the network service 7,649, the tab's renderer 25,600. A render host holding one tab on a Mac with no app keeps 134,449 to 176,609 KiB of physical footprint in the painting modes (about 131 to 172 MiB), against M1's 43,393 KiB for the host at `ready` with no window (§2.2) and 7.7 MiB of headroom under acceptance 14's bound: a held tab is background work the idle scene must exclude, as M8's paragraph already plans.

### 5.3 What the probe needed beyond `src/main/browser/` as it stands

Nothing in `src/main/browser/` was changed, and nothing of the renderer is involved: the primitive server, the store and the page guards ran as bundled. Four things were added or set around them, each a product decision for M8: a placement for each tab's view (`host/headless-views.ts`, 56 lines, standing for the app's `ViewManager`, which places views in the app's windows from the renderer's pane rects), where the view must be offscreen (or, on Linux only, shown on the host's own display) rather than in a hidden window; the browser preload not registered (find, comments, extension pages: the person's chrome, not cua's); on Linux a peer check that admits by uid, since the cua server refuses every peer without the darwin-arm64 addon and no Linux build exists (`host/linux-peer.ts`, a stand-in that reads `/proc` but cannot read the peer's pid; O2's rule for Linux is the uid); and the viewer's frames taken outside the tab's CDP attachment (Electron's frame subscription), since the attachment is the agent's.

### 5.4 The collision row, explained

The row is `driver.mjs`'s phase `collision with the agent screenshot`. It switches the page to the clock, waits 1.5 s, reads the viewer's frames over the last second ("before"), has cua's host take a plain screenshot the vendor's way through the primitive server (`Page.startScreencast` at quality 80, the first frame, its ack, `Page.stopScreencast`), reads the 3 s after ("after"), then asks the host to start the viewer's screencast again and reads 2 s from 300 ms later ("after restart").

- **It measures the CDP source, not Electron's frame subscription.** The viewer's `start {source: 'cdp'}` is sent in `screencast static` and stopped only in `screencast stopped, idle`, after the collision; the two subscription phases come later and contain no agent screenshot. Nothing in either run measured the subscription across an agent's screenshot.
- **The agent never detaches in it.** cua's lease on the tab is taken in `cua primitives` and released in `cua release`, the last phase; in between the agent only starts and stops a screencast.
- **The drop is real, deterministic and the same on both platforms.** The tab has one CDP session (its `TabDebugger`, which cua's lease and the viewer share), and a screencast is a state of that session: the agent's `Page.startScreencast` re-parameterises the one screencast and its `Page.stopScreencast` ends it, the viewer's with it. Linux read 10 fps before, 0.3 after, 10 after the restart in all three painting modes (`linux/evidence/round2-*-driver.json`); the mini read 0 to 0.3 after in both (`macos/evidence/*-driver.json`). The same shared session is why cua's host received the viewer's 104 to 141 MB (Linux) and 116 to 126 MB (macOS) of frames: `connection.ts` forwards every event of a leased tab.
- **The mini's "before" of 16 to 17 fps is a measurement artifact, and its "6 to 7 after restart" is full recovery.** On the mini the page's clock ticks at 5.7 to 6.4 Hz (§5.2), and the restart reads 6.4 and 7, that rate; Linux's before reads exactly its clock's 10 Hz. The extra frames in the mini's before-second are paints the clock did not cause, in the window 0.5 to 1.5 s after the scroll phase stopped. The likeliest source is macOS's overlay scrollbar fading out after the scroll (the macOS line runs without `--hide-scrollbars`, which Linux's carries); the driver keeps no per-frame times, so that cause is inferred, not shown.

So the viewer's stall is a property of the CDP source, which §5.3 already rules out for the viewer, not a stall of the frame subscription and not a platform difference. What neither run shows is the subscription's stream across the agent's screenshot and across the agent's detach and re-attach. The smallest probe change that shows it: one more phase in `driver.mjs` after `subscription: click to paint`. With the subscription running and the page on its clock, the phase waits 3 s (the scrollbar settled), reads 2 s before, runs `vendorScreenshot`, reads 3 s, sends cua's `debugger.detach` for the tab and reads 3 s, sends `debugger.attach` and reads 3 s. It also counts cua's `Page.screencastFrame` notifications over the phase, which should be the agent's one frame only. `cua release` then skips its detach. About 25 lines, plus an optional `U3_MODES` list in `macos/run.sh` (`offscreen` alone takes about 1.5 minutes on the mini, all three about 7). Built at 6b3fab2df and run as the mini's pass 3: §5.5.

### 5.5 The mini's pass 3: the subscription across the agent's acts, and the throttle (2026-11-01 03:47:28Z to 03:51:42Z)

CI-opt ran `U3_MODES=offscreen,offscreen-psb,offscreen-nothrottle` through `macos/run.sh` at 6b3fab2df (load quiet, mean 2.50). Each variant changes one factor against plain `offscreen` (`host/main.ts` `VARIANTS`):
- `-psb` holds `powerSaveBlocker.start('prevent-app-suspension')` in the render host's browser process from `ready` to the exit;
- `-nothrottle` makes each tab's offscreen view with `backgroundThrottling: false`.

The evidence is `macos/evidence/pass3/` (`run.txt`, `summary.json`, `<variant>-driver.json`). Every variant was `READY` in 0.61 to 0.79 s from the spawn and exited 0 with no error. The only stderr line is a `viz` `ERROR` "Frame latency is negative: -0.002 ms" in `offscreen` (`offscreen-driver.json` `hostStderrTail`): nonblocking noise, coinciding with no step failure (that variant's every phase completed).

**The variants took effect** (`tab loaded` and the blocker steps in each `driver.json`'s `host.steps`):
- `offscreen-psb`: the blocker started at 115 ms, held by pid 72754 (the render host's browser process; `started: true`), was still active when the tab loaded, and was released at the exit after **84,106 ms** (`power save blocker held` / `released`).
- `offscreen-nothrottle`: the tab reads `getBackgroundThrottling()` false; the other two read true.

**The subscription across the agent's acts** (phase `subscription: collision with the agent screenshot and release`). The page is on its clock, 3 s settled first. The table gives fps for 2 s before, then 3 s after each of: the agent's plain screenshot through cua, cua's `debugger.detach` (the tab's only lease, so the debugger detaches), and its `debugger.attach`.

| Variant | Before | After the screenshot | After the detach | After the re-attach | cua's `Page.screencastFrame` events in the phase |
|---|---|---|---|---|---|
| `offscreen` | 6.0 | 6.7 | 6.0 | 6.0 | 1 |
| `offscreen-psb` | 5.0 | 6.7 | 6.0 | 6.3 | 1 |
| `offscreen-nothrottle` | 6.5 | 7.0 | 7.0 | 6.3 | 1 |

The frame subscription holds the page's own rate through every act of the agent's on the tab's CDP session. cua's host sees only its own screenshot frame (the agent's screenshot 23 to 36 ms, detach 1 to 3 ms, re-attach 1 to 4 ms). In the same run the CDP-source collision repeats §5.4's shape in all three variants (`collision with the agent screenshot`: 0 fps after the agent's stop, 5.9 to 7.6 after the restart, 598 to 630 frames and 114 to 120 MB forwarded to cua's host).

**The throttle:**

| Reading (file phase) | `offscreen` | `offscreen-psb` | `offscreen-nothrottle` |
|---|---|---|---|
| The 10 Hz clock (`text page ticking at 10 Hz (cdp)`): fps; the page's own tick rate | 6.2; 6.3 Hz | 6.7; 6.7 Hz | 6.6; 6.6 Hz |
| Same: median and p95 frame interval | 187, 204 ms | 169.5, 203 ms | 180, 208 ms |
| The subscription at the clock: fps, median interval | 6.4, 184 ms | 6.6, 180 ms | 6.0, 184 ms |
| Click to paint (`click to paint (cdp)`): median, p95 (min to max) | 113.5, 154 ms (33 to 189) | 108, 157 ms (38 to 172) | 108.5, 141 ms (40 to 154) |
| The subscription's click to paint: median, p95 | 96, 151 ms | 81, 177 ms | 106.5, 154 ms |
| Scrolling on a 16 ms timer: fps; the page's tick rate | 53.5; 57.2 Hz | 56.9; 59 Hz | 57.4; 59.5 Hz |
| Median frame at the clock; at 10 fps | 127,554 B; 1,275,540 B/s | 127,552 B; 1,275,520 B/s | 127,563 B; 1,275,625 B/s |

Neither factor lifts the clock. The page's 100 ms timer runs at 6.3 to 6.7 Hz with the blocker held and with throttling off, as it does without them. Click to paint stays a sawtooth of 33 to 189 ms with a median of 108 to 113.5 ms. So App Nap is not the cause, and neither is the view's `backgroundThrottling`. The slowdown is specific to the timer's period. In the same views the 16 ms `setInterval` that drives the scroll phase runs at 57 to 59.5 Hz and the screencast follows it at 53.5 to 57.4 fps, while the 100 ms `setInterval` of the clock is held near 6 Hz (about 150 to 180 ms per tick), and the next paint after an idle page is touched waits on the same slow cadence. A short timer running near its rate beside a long one stretched by half or more points at the timer alignment or wake-up batching Chromium applies to longer timers in a frame it does not count as foreground, more than at a cap on painting. `requestAnimationFrame` was not measured: the fixture drives both modes with `setInterval` (`page.html`).

**Memory, physical footprint with one tab idle:** 140,497 KiB (`offscreen`), 134,369 KiB (`offscreen-psb`) and 134,369 KiB (`offscreen-nothrottle`). Streaming: 215,393, 315,793 and 254,337 KiB. Ten seconds after the stream stopped: 172,385, 177,553 and 177,537 KiB (host steps `memory …`). The blocker adds nothing measurable at idle, and is not needed.

### 5.6 The criterion (P5 §13 U3, O5 M7), both halves and pass 3

- **The primitive server runs in the render host without a renderer rewrite: holds.** `src/main/browser/` ran unchanged on both platforms, and no renderer code is involved. Four things had to be added around it (§5.3).
  - In `offscreen` every primitive answered on both platforms; `Page.captureScreenshot` took 108 to 135 ms on Linux and 62 to 74 ms on the mini.
  - A hidden window fails on Linux, where captures never answer. On macOS a hidden window answers captures, but a person's view of it never paints.
- **Under 1.5 MB/s at 10 fps for a text page: holds.** A dense 1280×800 article at quality 60 costs 140 KB per frame on Linux, measured at 10.0 fps as 1,403,585 to 1,403,784 B/s, a 7% margin. On the mini it costs 128 KB per frame, 1,275,485 to 1,282,170 B/s at 10 fps; the mini's page painted at only 5.7 to 6.4 fps, so that figure is the median frame times ten. The subscription source reads the same within 4%. A still page costs nothing, continuous scrolling costs 6 to 9 MB/s, and a denser page or a higher quality would cross the line. A remote channel slower than the page's rate must be absorbed by flow control: the CDP source has it (end-to-end acks), while the subscription source as probed has none (§5.1), which condition 2 adds.
- **The three sides under about 3,000 new or changed lines: holds at the estimate's centre, about 2,540 (range about 1,900 to 3,200), with flow control counted.** The estimate is a judgement, not a count. Its derivation follows so it can be checked.
  - **Reused unchanged, and not counted:**
    - the in-app browser's main side the probe ran as is (`src/main/browser/` `tabs.ts`, `view.ts`'s `createTabView`, `partition.ts`, `permissions.ts`, `navigation.ts`, `window-open.ts`, `input.ts`, `debugger.ts`, and `cua/` whole);
    - the render host's root and `machine.sock` client (`src/render-host/`, 754 lines with tests);
    - the render seam's spawn, hold, quiet clock and backoff (`src/mawsd/render-seam.ts`, 661 lines);
    - M5's per-session cua socket and relay;
    - O7's §N stream mechanics (credit, `streamData`, `streamControl`, the stream's authorization);
    - the renderer's Browser tool shell (`src/renderer/src/tools/browser/`, 2,845 lines).
  - **The render host's tab engine, about 1,315:**
    - the composition in the render host, about 120 (the probe's `host/main.ts` composes it in about 70);
    - the offscreen placement, about 50 (the probe's `host/headless-views.ts`, 56);
    - the frame source with bounded flow control, about 140: the subscription, the JPEG encode, latest-frame-wins or credits, and the open, close and input ops (the probe's `host/screencast.ts` is 160 with its CDP path and no flow control);
    - the uid peer policy on Linux in `cua/peer.ts` and `cua/index.ts`, about 35;
    - cua's event forwarding scoped to the agent's own commands, about 30;
    - the seam's tab-engine role, about 260: the start on an accepted cua connection, the hold bounded by cua's hello wait, the handover when an app attaches, the lifetime with held tabs, and the relay target switched between the app and the render host;
    - the wire, about 80: the render host's tab-engine hello capability, the frame feed's names, and the capability's `viewed`;
    - unit tests, about 450: the placement, the peer policy, the frame source with its slow-viewer case (about 120), and the seam's trigger, handover and lifetime (about 250);
    - `e2e:browser-cua`'s no-app scene extended to the render host, about 150.
  - **The RL2 kind, about 580:**
    - the kind and its capability in the protocol package, about 40;
    - the endpoint's stream: open under the session's grade, fed from `mawsd`'s frame feed over `machine.sock`, about 150;
    - the stream's credits mapped onto the frame source's flow control, about 40;
    - the device adapter's open and its delivery to the renderer, about 100;
    - tests, about 250.
  - **The renderer's screencast view with input, about 640:**
    - the frame painter (decode and draw on a canvas), about 80;
    - mouse, wheel and keys mapped and scaled to the tab's viewport, with focus, about 160;
    - the Browser tool's branch for a remote session's tab, with a minimal tab strip fed over the link, about 150;
    - tests, about 250.

  The first, coarser figure (about 2,550 without itemised flow control) and this one agree. The range is about ±25%: the seam's handover and the remote tab strip are the least certain items. The high end crosses the ~3,000 line, so M8's re-plan counts again against its own design.

Other readings the criterion does not bar:
- **Latency.** The local click-to-paint median is 44 to 56.5 ms on Linux in every painting mode. On the mini it is 49 ms in `hidden-unthrottled` but 108 to 120.5 ms in `offscreen` (pass 2 and pass 3, p95 141 to 177), from the roughly 180 ms clock of an idle offscreen page, which neither the power save blocker nor `backgroundThrottling: false` lifts (§5.5); a 16 ms timer in the same view runs near its rate.
- **Memory.** One tab costs about 0.5 to 0.6 GiB RSS on Linux. On the mini it costs 134,369 to 140,497 KiB of physical footprint idle and up to 177,553 KiB after streaming, across both passes.
- **The collision.** It belongs to the CDP source (§5.4). The frame subscription is unaffected (§5.5).

**Verdict: promote.** **Mode: `offscreen`.**
- It is the one mode that is the same on both platforms. The page is visible, so captures and input behave as in a shown tab.
- `hidden` is out: no frames, 0.6 Hz timers, 5 s input.
- `hidden-unthrottled` captures nothing on Linux.
- `shown` exists only on Linux's Xvfb.
- The CDP collision is settled for the viewer by condition 2 (§5.5: the frame subscription holds its rate through the agent's screenshot, detach and re-attach).
- The macOS clock is a bounded probe for M8, not a gate (condition 3).

M8's re-plan must carry these conditions, each with its test:
1. **Offscreen tab views** in the render host, never hidden windows.
2. **The viewer's frames from Electron's frame subscription** (or the offscreen view's own paint), never a CDP screencast on the attachment cua's lease shares. Settled on the mini by pass 3: the subscription kept the page's rate through the agent's screenshot, detach and re-attach, and cua's host saw only its own frame. M8's test repeats that scene. The subscription stream also needs bounded flow control, which the probe did not have: latest-frame-wins (at most one frame encoded and in flight per viewer, a newer one replacing an unsent one) or credits refunded by the viewer, never an unbounded queue. A slow-viewer test shows it: a viewer reading at a fraction of the page's rate sees the newest frame within a bound, and the host's memory and queue stay flat.
3. **One bounded probe of the macOS offscreen clock.** A slow page timer runs at about 6 Hz in place of 10, and an idle page's next paint waits up to about 180 ms. App Nap and the view's background throttling are ruled out (§5.5). The probe's candidates:
   - what `document.visibilityState` and the frame's occlusion read inside an offscreen view over time;
   - offscreen rendering's `setFrameRate` and BeginFrame pacing when nothing is invalidated;
   - Chromium's timer alignment for frames it treats as hidden or occluded (a 16 ms timer near its rate beside a 100 ms one near 6 Hz points here);
   - `requestAnimationFrame`'s rate in an offscreen view, which the fixture did not exercise.

   If the clock cannot be lifted cheaply, M8 records the known limit on macOS: about 110 ms click to paint offscreen (Linux 56.5 ms), and a page's 100 ms timers running near 6 Hz; a 16 ms timer, and scrolling driven by it, ran at 54 to 57 fps; `requestAnimationFrame` is unmeasured and the probe measures it.
4. **No power save blocker.** It does not lift the clock (§5.5), so it never enters the idle scene.
5. **A uid peer policy for the cua server on Linux**, which today refuses every peer without the darwin-arm64 addon.
6. **cua's event forwarding scoped to what the agent asked for.** A leased tab's attachment otherwise carries every other user's events to the agent's host; the CDP-source collision forwarded 104 to 141 MB.
7. **A held tab's footprint counted as background work** and excluded from the idle scene, as M8's paragraph already plans: about 134,000 to 178,000 KiB on a Mac, 0.5 to 0.6 GiB RSS on Linux.
