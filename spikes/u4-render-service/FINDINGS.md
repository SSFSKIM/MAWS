# U4: windowless Electron as the machine's render service — findings (2026-10-31)

> **Composite:** `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5), child O5, parent pin `f9e7dfc540683dae84d13135a3f849fd52b4bcdd`. **Unknown:** P5 §13 U4, "windowless Electron under a LaunchAgent and on a devcloud VM, and headless Chromium's fidelity for export on Linux; with them, one Electron process or two (§2's criterion)". **Execution document:** `docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md` (M1 closes the macOS half; M5 reads §1's packaging facts). The probes are beside this file: `linux/` (`main.cjs` the Electron probe, `fixture.html` the fidelity fixture, `run.sh`, `run2.sh`, `run3.sh` the three rounds, `evidence/` the pictures and round 3's summary), `macos/run.sh` (the mini's run, through CI-opt).

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

## 2. The macOS half: the mini through CI-opt (M1; not yet run)

`cd <worktree> && pnpm install --frozen-lockfile && bash spikes/u4-render-service/macos/run.sh`. It runs the same probe under three conditions: a shell in the GUI session (r1), `launchctl submit` into `gui/<uid>` (r2, a LaunchAgent-run `mawsd`'s child's condition) and the accessory activation policy (r3, `--accessory`: `app.setActivationPolicy('accessory')` before `ready`, `app.dock.hide()` after), then the idle footprint of a windowless Electron at `ready` (`idle-electron-ready.txt`: the tree's RSS and `footprint`'s physical footprint) and of Electron run as Node. To read: each run's `result.json` (`ready.dockVisible` false under `--accessory`; the three captures at 1280 wide with `nonBackgroundFraction` above 0.02; the PDFs with `pages` ≥ 3 and `fontFiles` ≥ 1; `errors` empty), r2's `result.json` present at all, and the idle lines. Expected from the Linux half and the app's own numbers: `ready` well above 100 MiB.

## 3. The verdict on P5 §2's criterion

**Two processes.** The criterion: the single-process shape wins if it runs reliably under a LaunchAgent and on a devcloud VM *and* its idle memory fits acceptance 14. The third clause fails on the numbers: a windowless Electron at `ready` is 137 MiB of working set on the VM (§1.5) where `mawsd` idles at 27 MiB on a Mac and the bound leaves 7.9 MiB of headroom (`e2e:daemon-idle` 91,235 of 99,145 KiB at master 33935b949); on Linux it would also make the pack carry Electron and Xvfb for every machine, rendering or not. The two-process shape pays that cost only while a render runs, keeps `mawsd` plain Node (P5 Decision Log 22 stays as it is: the machine key's holder is not an Electron process; the render host holds no key), and keeps the Linux pack's runtime the pinned Node, with Electron an optional component. The reliability clauses are met on the VM (§1.2, §1.3: under a transient systemd user service, with the sandbox) and are what M1 reads on the mini for the LaunchAgent's domain. The macOS reading is appended here at M1; the verdict does not wait on it.

## 4. Acceptance 10 on a VM (M5; not yet run)

## 5. U3: the agent's browser for a remote session (M6; not yet run)
