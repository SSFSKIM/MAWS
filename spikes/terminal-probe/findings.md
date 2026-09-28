# Terminal spike findings (C9 M1, renderer phase)

Execution document: `docs/doperpowers/plans/2026-09-28-c9-terminal.md` (child C9 of `docs/charter.md`, parent pin
`87f8c7881119ea670901205dae35917d3751459c`; charter §7.2 and C9 G1). Run on the owner's Mac (macOS 25.6, Apple
silicon, 120 Hz display) on 2026-09-28 from the C9 worktree at the M1 head, `pnpm build` then
`node spikes/terminal-probe/run.mjs` (steps `smoke,measure,items`, then `tui` on xterm for each TUI, then `replay`).

Candidates, both behind `src/renderer/src/terminal/renderer.ts` on the `#probe` page, each on its own pty over C1's
string `pty.data` (no backpressure; M1 is the renderer phase):

- **xterm**: `@xterm/xterm` 6.0.0 with `@xterm/addon-webgl` 0.19.0 (acquired while visible), fit 0.11.0, web-links
  0.12.0, unicode-graphemes 0.4.0, serialize 0.14.0. Pane 93×40 at the default split.
- **ghostty**: `ghostty-web` 0.4.0-next.20.g1858a59 (the registry's `next` tag), Canvas 2D renderer, WASM loaded
  through `init()`. Pane 86×48 at the same split (its cell metrics differ; see item 15 for the CSP sources it needed).

Workloads: `workloads.mjs`; the TUIs are `claude` 2.1.283 (`/Users/new/.local/share/claude/versions/2.1.283`) and
`codex` 0.155.1 (`/Users/new/.codex/packages/standalone/current/bin/codex`), started from the probe's zsh in
`/tmp/maws-harness/a` (`$SHELL` spawned without `-l`: M1 has no login-shell default yet, that is M2's; zsh still read the
owner's `.zshrc`, hence the powerline prompt) and recorded with `script -q -r` (`recordings/`, redacted with `redact-recording.mjs`, 0 hits).
Model usage: one "count to 20" turn per TUI on xterm (codex twice: the first driver run hung on the driver's own
`idle()` wait, not on codex). Ghostty saw both TUIs only through `script -p` replays (its leg stopped at the first
renderer-item failure, as the execution document's bounded-share rule allows), plus `less`.

The driver answers only two identified screens, each by its exact wording: Claude Code's "Do you trust the files in
this folder?" (Enter takes the preselected "Yes, proceed") and codex's "Update available!" prompt, moved to its
"Skip" option before Enter and never to the install option (the first conversation run had pressed Enter on that
screen while "Update now" was selected; `codex --version` stayed 0.155.1 and `~/.codex/packages` was untouched, so
nothing ran). Any other question-like screen, and any mid-turn permission request, stops the run with a screenshot.

Phase legend: **M1** = judged here on C1's transport; **M2 gate** = observed here, judged at the transport gate that
closes M2 (items 6 browser half and 9 pass/fail).

## xterm (`@xterm/xterm` 6.0.0 + WebGL)

| # | Item | Workload | Observed | Verdict (phase) | Evidence |
|---|---|---|---|---|---|
| 1 | Alternate screen | `less /etc/services` then `q`; `claude` then `/exit`; `codex` then `/quit` (the `exit-check` step: start, then exit, no prompt sent, six prior rows of `seq 1 5` above the command) | `less`: alternate screen on while open, every line above the command's prompt row identical after `q`, the only residue the new prompt. `claude`: uses the alternate screen (`CSI ? 1049 h` once, `l` once, one `CSI 2 J` inside it, no `CSI 3 J`); after `/exit` all six prior rows are identical (`priorScrollbackIntact: true`, `firstDifference: -1`) and 0 TUI rows are left in scrollback. (The conversation run's JSON says `priorScrollbackIntact: false` because that run used the earlier whole-buffer comparison, which counted the prompt row the command was typed on; the reproduction settles it.) `codex`: runs inline and **does not restore**: after `/quit` the six prior rows are gone (`firstDifference: 0`), and its captured stream shows why: no alternate screen, no `CSI 2 J`/`3 J`, but 256 absolute cursor positions (`CSI r;c H`), 7 `CSI J` and 60 `CSI K`: its inline viewport repositions to the top rows and erases there, overwriting what was on the screen. That is codex 0.155.1's own redraw (the same bytes erase those rows in any terminal), not a renderer failure; the conversation run's `priorScrollbackIntact: true` for codex was vacuous (a fresh shell has no rows above its first prompt). Codex also shuts down slowly on a cold start ("Shutting down…" for ~60 s while its model still loads). | **pass** for the alternate-screen programs (`less`, `claude`); codex erases its rows itself (recorded, not counted against the renderer) (M1) | `xterm-01-less-alt.png`, `xterm-01-less-restored.png`, `xterm-01-claude-exit-check-open.png`, `xterm-01-claude-exit-check-restored.png`, `xterm-01-codex-exit-check-open.png`, `xterm-01-codex-exit-check-restored.png`, `xterm-codex-still-open.png` (the slow shutdown); `results/xterm-exit-claude.json`, `results/xterm-exit-codex.json` (before/after lines and `sequences`), `results/xterm-items.json`, `results/xterm-tui-*.json` |
| 2 | Synchronized output | `claude` with `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` (the shipped environment), once through `(unset CLAUDE_CODE_FORCE_SYNC_OUTPUT; exec claude)`; `codex` streaming | `?2026h` count: claude 3 at startup and 89 during the "count to 20" turn with the variable; **0** without it (xterm 6.0.0 does not answer XTVERSION; both TUIs queried it, neither got an answer). Codex: 105 at startup, 308 during its turn. Frames visibly whole in every screenshot. | **pass** (M1) | `xterm-11-claude-streamed.png`, `xterm-02-claude-nosync.png`, `xterm-11-codex-streamed.png`; `results/xterm-tui-claude.json` (`startup.syncFrames`, `conversation.syncFramesDuringTurn`, `noSync`) |
| 3 | CJK and emoji width | `fixtures/width.json` (12 strings) printed with `CSI 6 n`, reply parsed from the terminal's own answer | Reported column minus one equals the expected width for all 12: ASCII 11, `한글 입력` 9, `日本語` 6, `中文` 4, `😀` 2, `👍🏽` 2, `👨‍👩‍👧‍👦` 2, `🇰🇷` 2, `é` 1 (both forms), `┌─┐` 3, tab 8. Claude's and codex's borders align around the Korean and Japanese composer text. | **pass** (M1) | `xterm-03-width.png`, `xterm-04-*-korean-japanese.png`; `results/xterm-width.json` |
| 4 | IME | Korean and Japanese committed into each TUI's composer through Playwright's `insertText` | `한글 입력 にほんご` appears exactly in claude's and codex's composer and in `probe().line()`; nothing duplicated or dropped. **Composition itself (the underline while composing, the 2-set Korean keyboard) cannot be driven from Playwright**: pending the owner's manual run at M5 (steps below). | **pass on committed text; composition pending owner (M5)** | `xterm-04-claude-korean-japanese.png`, `xterm-04-codex-korean-japanese.png` |
| 5 | Selection and copy | drag across two wrapped lines, ⌘C, paste into the page's text field; ⌥-drag inside each TUI (mouse tracking `any` in claude) | Selection 111 characters, clipboard text equals the selection, the pasted field equals it. ⌥-drag inside claude selected 87 characters, inside codex 122. | **pass** (M1) | `xterm-05-selection.png`; `results/xterm-items.json` (`selection`), `results/xterm-tui-*.json` (`altDrag`) |
| 6 | Hyperlinks | OSC 8 `printf` and a bare `https://example.org`, ⌘-clicked | M1 half: the adapter's link handler fired with `https://example.com` and `https://example.org`, exact, shown in the debug strip; nothing opened. The delivered event is `mouseup` with `metaKey false` under Playwright's `click({ modifiers: ['Meta'] })` (xterm activates on a plain click; the ⌘ requirement is the registry's, M3). Browser half needs `pty.openLink`. | **pass** (M1 half); **M2 gate** (browser half) | `xterm-06-links.png`; `results/xterm-items.json` (`links`) |
| 7 | Scrollback | `seq 1 20000` at the prompt, wheel to the top | Buffer holds exactly 10,040 lines (10,000 + 40 rows); the first line is `9962` (the document's formula gives 9961: the final prompt row occupies one buffer line, so one more `seq` line scrolled out). Wheel scroll reaches the top. After `claude` exits, none of its frames are in scrollback. | **pass** (M1) | `xterm-07-scrollback-top.png`; `results/xterm-items.json` (`scrollback`) |
| 8 | Resize and reflow | pane divider dragged to 30 % and back with a shell, and while `claude` and `codex` run; `stty size` after | Shell: `stty size` reads `36 54` at 30 % and `40 93` back, matching the pane both times. Claude relaid out to 58×39 with the frame whole; codex likewise. Wrapped shell lines reflow. | **pass** (M1) | `xterm-08-claude-resized.png`, `xterm-08-claude-resized-back.png`, `xterm-08-codex-resized*.png`; `results/xterm-items.json` (`resize`) |
| 9 | Sustained output | W1, W2, W3 at 20 MB of output (M1), `/bin/sh -c` as the pty's program | Every run received exactly the program's 20,000,000 output bytes and the expected line feeds; the last line is right (`2638888` for W3). MB/s and frames in the measurements table. (Full workloads at the gate.) | **informational** (M1); **M2 gate** | `xterm-09-W3-end.png`; `results/xterm-W{1,2,3}.json` |
| 10 | Sleep and resume | `simulateContextLoss` (WEBGL_lose_context); `pmset sleepnow` | Context loss: `webgl` → `dom` in 3.0 s (the addon's own restore wait), the buffer intact, `echo after-loss-ok` answered, hide-and-show returned `webgl`. **`pmset sleepnow` is pending the owner's manual run at M5.** | **pass on simulated loss; sleep pending owner (M5)** | `xterm-10-after-context-loss.png`; `results/xterm-items.json` (`contextLoss`) |
| 11 | Both TUIs, end to end | one "count to 20" conversation in each, from the probe's shell in the scratch cwd | Both start, draw, stream the answer, take input and exit cleanly; claude's frame, composer and status bars are whole throughout; codex's welcome box, tip and transcript draw without misalignment. | **pass** (M1) | `xterm-11-claude-frame.png`, `xterm-11-claude-streamed.png`, `xterm-11-codex-frame.png`, `xterm-11-codex-streamed.png`; `recordings/{claude,codex}.rec` |
| 12 | Mouse wheel over `claude` (research) | wheel up 300 px and back over the TUI (mouse tracking `any`) | No `CSI < … M` sequences in any buffer line, composer clean. Same over codex. | **pass** (M1) | `xterm-12-claude-after-wheel.png`, `xterm-12-codex-after-wheel.png`; `results/xterm-tui-*.json` (`wheel`) |
| 13 | Codex scroll-region inserts (research) | `codex` in its default (inline) mode, one turn of history; plus a synthetic DECSTBM + IL/DL screen | No gaps in codex's transcript; the synthetic scroll-region screen matches its expected nine rows exactly. Codex 0.155.1 was run in its default mode only; the 20-turn stress was not bought (one turn per TUI was the budget). | **pass on what was observed** (M1) | `xterm-13-scroll-region.png`, `xterm-11-codex-streamed.png`; `results/xterm-scroll-region.json` |
| 14 | Kitty keyboard (research) | start each TUI; Shift+Enter, ⌥←, ⌃← through `cat` | Both TUIs sent `CSI ? u`; xterm 6.0.0 never answered (no `CSI ? flags u` seen on the input side), so both fell back to legacy keys. Shift+Enter arrives as `\r` (plain Enter), ⌥← as `CSI 1;3 D`, ⌃← as `CSI 1;5 D`. | **recorded** (informational) | `results/xterm-items.json` (`keys`), `results/xterm-tui-*.json` (`startup.kitty*`) |
| 15 | Bytes and CSP (research) | console under the harness CSP | Not applicable to xterm (no WASM). | — | `results/smoke.json` |
| 16 | Input echo latency (measurement) | `cat`, 100 single characters | p50 0.3 ms, p95 1.0 ms, max 4.9 ms (typed through `pty.write`, echoed by the tty, polled through `probe().line()`). | **recorded**; p95 ≤ 30 ms | `results/xterm-latency.json` |

## ghostty (`ghostty-web` 0.4.0-next.20.g1858a59)

| # | Item | Workload | Observed | Verdict (phase) | Evidence |
|---|---|---|---|---|---|
| 1 | Alternate screen | `less /etc/services` then `q` | Alternate screen on while open; prior lines intact after `q`, residue the new prompt only. TUIs only replayed (see 11). | **pass** (M1, `less` only) | `ghostty-01-less-alt.png`, `ghostty-01-less-restored.png`; `results/ghostty-items.json` |
| 2 | Synchronized output | replay of the claude and codex recordings | `ghostty-web`'s renderer draws on its own animation frame regardless of mode 2026 (the sequence is parsed and ignored); no measurement of tearing was possible on a replay. Not judged. | **not judged** (leg stopped at 7) | `ghostty-11-*-replay-*.png` |
| 3 | CJK and emoji width | as xterm | All 12 fixtures reported the expected width (same table as xterm). | **pass** (M1) | `ghostty-03-width.png`; `results/ghostty-width.json` |
| 4 | IME | — | Not run: the leg stopped at item 7 (and coder/ghostty-web #119, Korean IME, is the known open defect on this package). | **not judged** | — |
| 5 | Selection and copy | drag across two wrapped lines, ⌘C | Selection 106 characters and the clipboard equals it; the paste into the page's text field did **not** equal the selection (ghostty's `InputHandler` intercepts ⌘V at the document level, so the field never received the paste). | **partial** (copy passes, paste half fails) | `ghostty-05-selection.png`; `results/ghostty-items.json` (`selection`) |
| 6 | Hyperlinks | OSC 8 `printf` and a bare URL, ⌘-clicked on the canvas cell | The adapter's link handler never fired for either URL (the wrapped `OSC8LinkProvider` and `UrlRegexProvider` produced no activation; `getHyperlinkUri()` returning null is coder/ghostty-web #137). | **fail** (M1 half) | `ghostty-06-links.png`; `results/ghostty-items.json` (`links: { osc8: null, bare: null }`) |
| 7 | Scrollback | `seq 1 20000` at the prompt | With `scrollback: 10000` the buffer held **822** lines (774 of scrollback + 48 rows), first line `19180` (`results/ghostty-items-scrollback-10000.json`, the decisive run, recovered verbatim from that run's driver log); the option is passed to Ghostty's core as `scrollbackLimit`, which is a **byte** budget (`max-scrollback`), not a line count: at `100_000_000` the same run kept all 20,034 lines (`results/ghostty-items.json`, the diagnostic run). The item asks for exactly `10000 + rows` lines; a byte budget cannot promise a line count. Wheel scroll works; also, every `write` scrolls the viewport to the bottom, so scrolling up while output streams is impossible. | **fail** (M1) — the first renderer-item failure | `ghostty-07-scrollback-top.png`; `results/ghostty-items-scrollback-10000.json` (`scrollback`), `results/ghostty-items.json` (diagnostic) |
| 8 | Resize and reflow | divider to 30 % and back, `stty size` | `stty size` reads `48 122` and `48 86`, matching the pane each time. | **pass** (M1) | `results/ghostty-items.json` (`resize`) |
| 9 | Sustained output | W1, W2, W3 at 20 MB | Every run received exactly the program's 20,000,000 output bytes and the expected line feeds; last line right. Frames p50 25 ms during W1/W2 (its Canvas 2D full-redraw loop), p95 33 to 42 ms. | **informational** (M1) | `ghostty-09-W3-end.png`; `results/ghostty-W{1,2,3}.json` |
| 10 | Sleep and resume | — | Canvas 2D holds no WebGL context (nothing to lose); sleep pending the owner. Not judged. | **not judged** | — |
| 11 | Both TUIs | `script -p` replays of the xterm recordings | Frames draw (claude's logo and status bars, codex's boxes) but the pane was 86 columns against recordings made at 93, so long lines wrap in the replay; that is the replay's, not the renderer's. No live TUI was bought for this leg. | **not judged** | `ghostty-11-claude-replay-early.png`, `ghostty-11-codex-replay-end.png` |
| 12 | Wheel over `claude` | — | Not run (no live TUI). | **not judged** | — |
| 13 | Scroll-region inserts | synthetic DECSTBM + IL/DL screen | Matches the expected nine rows exactly. | **pass** (M1, synthetic only) | `ghostty-13-scroll-region.png`; `results/ghostty-scroll-region.json` |
| 14 | Kitty keyboard | Shift+Enter, ⌥←, ⌃← through `cat` | Same bytes as xterm (`\r`, `CSI 1;3 D`, `CSI 1;5 D`); its Kitty encoder is not wired. | **recorded** | `results/ghostty-items.json` (`keys`) |
| 15 | Bytes and CSP | console under the harness CSP | Loads only with `script-src 'wasm-unsafe-eval'` **and** `connect-src data:`: `init()` fetches the WASM as an inlined `data:application/wasm;base64,…` URL and compiles it. With those two sources the console shows no CSP refusal (`results/smoke.json`, `cspRelated: []`; the one console line, Chromium's `task queue exceeded allotted deadline` warning, is known noise present on the empty page). A production promotion would have needed both in C1's CSP, or the package's `ghostty-vt.wasm` served from `'self'` through `Ghostty.load(path)`. | **recorded** | `results/smoke.json` |
| 16 | Input echo latency | `cat`, 100 characters | p50 0.4 ms, p95 1.3 ms, max 13.6 ms. | **recorded** | `results/ghostty-latency.json` |

Also observed on ghostty, outside the list: the theme toggle did not recolour its pane (the `options.theme` assignment
is accepted but the canvas kept the light background, `ghostty-10-palette-dark.png`), and `reset()` leaves the
previous screen in place (the probe clears explicitly after it).

## Measurements (M1, C1's string transport, 20 MB of output per flood; `results/*.json`)

Bytes are PTY bytes (the program's output plus one CR per line feed under `onlcr`). "Extra CR" is the tty's own
duplication of a carriage return when its output queue fills mid-translation (seen under plain node-pty too: three
W3 runs gave 22,638,889 / 22,638,888 / 22,638,889 PTY bytes for the same 20,000,000 output bytes); the byte-count
assertion therefore requires the output bytes and the line feeds to match exactly and tolerates surplus CRs.
`blockedInputEvents` is the count of physical wheel, key and touch events the probe cancelled during the run
(coordinator's addition, 2026-09-28); every run below was 0.

| Renderer | Workload | Output bytes (expected = received) | Line feeds | Extra CR | Seconds | MB/s (PTY bytes) | Frame p50 / p95 ms | Frames > 33 ms / > 50 ms | Long tasks | Echo p50 / p95 ms | Blocked input events |
|---|---|---|---|---|---|---|---|---|---|---|---|
| xterm | W1 `yes … \| head -c 20000000` | 20,000,000 | 363,636 | 0 | 1.495 | 13.62 | 8.3 / 9.3 | 0 / 0 | 0 | — | 0 |
| xterm | W2 `base64 -b 120 -i /dev/urandom \| head -c 20000000` | 20,000,000 | 165,289 | 0 | 0.916 | 22.02 | 8.3 / 9.3 | 0 / 0 | 0 | — | 0 |
| xterm | W3 `seq -f '%.0f' 1 20000000 \| head -c 20000000` | 20,000,000 | 2,638,888 | 16 | 2.897 | 7.82 | 8.3 / 9.3 | 0 / 0 | 0 | — | 0 |
| xterm | latency (`cat`, 100 chars) | — | — | — | 0.347 | — | 8.3 / 9.4 | 0 / 0 | 0 | 0.3 / 1.0 (max 4.9) | 0 |
| ghostty | W1 | 20,000,000 | 363,636 | 0 | 0.994 | 20.49 | 24.9 / 33.4 | 8 / 0 | 0 | — | 0 |
| ghostty | W2 | 20,000,000 | 165,289 | 0 | 0.928 | 21.73 | 25.0 / 41.6 | 13 / 0 | 0 | — | 0 |
| ghostty | W3 | 20,000,000 | 2,638,888 | 29 | 2.520 | 8.98 | 15.7 / 16.8 | 0 / 0 | 0 | — | 0 |
| ghostty | latency | — | — | — | 0.371 | — | 8.3 / 9.3 | 0 / 0 | 0 | 0.4 / 1.3 (max 13.6) | 0 |

An earlier pass of the same runs (before the input guard existed) measured xterm at 22.5 / 25.4 / 10.4 MB/s and
ghostty at 23.3 / 25.2 / 10.6 MB/s; the spread between passes is the host's load, not the renderer (the M1 numbers
are informational; the gate re-measures on the binary stream). Heap after each run: 48 MB (`performance.memory`).
Ghostty's core parses as fast as xterm's here, but its Canvas 2D full redraw costs 25 ms frames under a flood where
xterm's WebGL renderer holds 8.3 ms (120 Hz).

## Verdict (M1, renderer items; final after the M2 gate)

**xterm.js ships.** `@xterm/xterm` 6.0.0 with the WebGL addon passed every renderer item judged in M1 (1 for the
alternate-screen programs `less` and `claude`, reproduced without a prompt; 2, 3, 5, 7, 8, 10 simulated, 11, 12, 13,
16 and the M1 halves of 4 and 6); the two halves that need a human, Korean IME composition (4) and `pmset sleepnow`
(10), are pending the owner's run at M5 and were not marked passed here. Codex does not restore the screen after
`/quit` because its inline viewport overwrites the rows above it with absolute positioning and erase-line sequences
(row 1); that is recorded as the program's behaviour, not counted for or against the renderer, and it is what the
Terminal tab will show for codex in any terminal. Its transport rows (6 browser half, 9 pass/fail) are the M2 gate's.

**ghostty-web is discarded at the end of M1**, per the charter's switch rule (G1) and the execution document's
promote-or-discard rule: its **first renderer-item failure is item 7, scrollback** (a byte budget in place of a line
count: 822 lines held where 10,048 were required), with item 6's M1 half (the link handler never fires) and the paste
half of item 5 failing beside it, and items 2, 4, 10 to 12 left unjudged once the leg had its bounded share (the
throughput numbers were taken). Both failures are structural in the package (Ghostty's `max-scrollback` semantics
passed through unchanged; `getHyperlinkUri()` null, #137), not tuning. `ghostty.ts`, the `ghostty-web` devDependency
and the harness-only CSP sources (`'wasm-unsafe-eval'`, `connect-src data:`) are removed in the verdict commit; the
`RendererKind` seam and this probe page stay so a maintained libghostty package can re-run the same spike.

xterm.js weak spots and the mitigations chosen: XTVERSION and the Kitty keyboard protocol are unanswered in 6.0.0, so
`CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` stays in the terminal environment (item 2: 0 synchronized frames without it) and both
TUIs run on legacy keys (Shift+Enter is a plain Enter; deferred, as Residue *Renderer* says); link activation fires on
a plain click with the delivered `mouseup` event, so the ⌘ requirement of Residue *Copy, paste and links* is applied in
the registry's handler (M3), which also decides what to do with a plain click. The scrollback formula in item 7 of
the execution document counts one prompt row short (first line 9962, not 9961, at 40 rows).

Manual items pending the owner (M5), exact steps:

1. IME composition (item 4): on `#probe` (`MAWS_HARNESS=1 pnpm dev`, click `#probe`, click `shell`), switch the input
   source to 2-Set Korean, type `한글 입력` at the prompt and watch the composition underline; press Enter; then click
   `claude` (or type the absolute path at the prompt), type `한글 입력` in the composer, then switch to Japanese
   Hiragana and type `にほんご`. Expected: the composition underline shows while composing, the committed text is exact
   in the shell line and in the composer, nothing duplicated or dropped. Record pass or fail in the M5 Progress entry.
2. Sleep and resume (item 10): with `claude` open on `#probe`, run `pmset sleepnow` from Terminal.app, wake after
   30 s. Expected: the terminal draws and takes input; the debug strip reads `webgl` or, after a context loss, `dom`
   with input still working. Record the acceleration read after wake.

## Evidence

`evidence/`: `00-probe-page.png`, `xterm-01-less-alt.png`, `xterm-01-less-restored.png`, `xterm-01-claude-exited.png`,
`xterm-01-codex-exited.png`, `xterm-02-claude-nosync.png`, `xterm-03-width.png`, `xterm-04-claude-korean-japanese.png`,
`xterm-04-codex-korean-japanese.png`, `xterm-05-selection.png`, `xterm-06-links.png`, `xterm-07-scrollback-top.png`,
`xterm-08-claude-resized.png`, `xterm-08-claude-resized-back.png`, `xterm-08-codex-resized.png`,
`xterm-08-codex-resized-back.png`, `xterm-09-W3-end.png`, `xterm-10-after-context-loss.png`,
`xterm-10-palette-light.png`, `xterm-10-palette-dark.png`, `xterm-11-claude-frame.png`, `xterm-11-claude-streamed.png`,
`xterm-11-codex-frame.png`, `xterm-11-codex-streamed.png`, `xterm-11-claude-replay-early.png`,
`xterm-11-claude-replay-end.png`, `xterm-11-codex-replay-early.png`, `xterm-11-codex-replay-end.png`,
`xterm-12-claude-after-wheel.png`, `xterm-12-codex-after-wheel.png`, `xterm-13-scroll-region.png`,
`xterm-01-claude-exit-check-open.png`, `xterm-01-claude-exit-check-restored.png`, `xterm-01-codex-exit-check-open.png`,
`xterm-01-codex-exit-check-restored.png`, `xterm-codex-still-open.png` (codex's slow cold-start shutdown, from a run
whose wait was too short),
`ghostty-01-less-alt.png`, `ghostty-01-less-restored.png`, `ghostty-03-width.png`, `ghostty-05-selection.png`,
`ghostty-06-links.png`, `ghostty-07-scrollback-top.png`, `ghostty-09-W3-end.png`, `ghostty-10-palette-light.png`,
`ghostty-10-palette-dark.png`, `ghostty-11-claude-replay-early.png`, `ghostty-11-claude-replay-end.png`,
`ghostty-11-codex-replay-early.png`, `ghostty-11-codex-replay-end.png`, `ghostty-13-scroll-region.png`.

`results/`: `smoke.json`, `console.json`, `xterm-W1.json`, `xterm-W2.json`, `xterm-W3.json`, `xterm-width.json`,
`xterm-latency.json`, `xterm-scroll-region.json`, `xterm-items.json`, `xterm-tui-claude.json`, `xterm-tui-codex.json`,
`xterm-replay-claude.json`, `xterm-replay-codex.json`, `xterm-exit-claude.json`, `xterm-exit-codex.json` (the
item-1 reproductions: before/after lines and the program's screen-control sequence counts), `ghostty-W1.json`,
`ghostty-W2.json`, `ghostty-W3.json`, `ghostty-width.json`, `ghostty-latency.json`, `ghostty-scroll-region.json`,
`ghostty-items-scrollback-10000.json` (the decisive item-7 run at the real option value, recovered from its driver
log), `ghostty-items.json` (the 100,000,000 diagnostic run, labelled inside), `ghostty-replay-claude.json`,
`ghostty-replay-codex.json`.

`recordings/`: `claude.rec` (24,690 bytes), `codex.rec` (761,257 bytes); `script -q -r` at 93×40, replay with
`script -p <file>` in a 93-column terminal.
