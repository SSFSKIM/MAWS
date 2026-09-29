# Terminal probe (C9 M1 spike, kept as the performance harness)

Child C9 of `docs/charter.md` (§7.2, C9 G1); execution document `docs/doperpowers/plans/2026-09-28-c9-terminal.md`.
Both renderer candidates (`@xterm/xterm` 6.0.0 with the WebGL addon, `ghostty-web` 0.4.0-next.20.g1858a59) sat behind
one adapter (`src/renderer/src/terminal/renderer.ts`) on the `#probe` page of the harness, each on its own pty, under
the real `claude` and `codex` interfaces. `findings.md` is the verdict document: ghostty-web was discarded at the M1
verdict and its adapter and dependency removed; the page now runs the surviving candidate (`KINDS` in `Probe.tsx`)
and a second entry there re-opens the second pane for a future candidate.

## Run

```
pnpm build
node spikes/terminal-probe/run.mjs                       # smoke + measurements + shell-driven items, both renderers
node spikes/terminal-probe/run.mjs --steps tui           # the real TUIs (one short conversation each; costs model usage)
node spikes/terminal-probe/run.mjs --steps exit-check    # item 1 for each TUI: start, then /exit or /quit (no model usage)
node spikes/terminal-probe/run.mjs --steps replay        # script -p of recordings/*.rec into each renderer
node spikes/terminal-probe/run.mjs --phase m2-gate      # the transport gate closing M2: smoke, full W1-W3 and echo latency (judged), links through pty.openLink
MAWS_HARNESS=1 pnpm dev                                  # the page by hand: click #probe in the harness nav
```

Options: `--renderer xterm|ghostty|both`, `--steps smoke,measure,items,tui,exit-check,replay,links`, `--tui claude,codex`,
`--tui-renderer xterm|ghostty`, `--keep-open`. `MAWS_CLAUDE_BIN` and `MAWS_CODEX_BIN` override the TUI binaries
(defaults in `workloads.mjs`). Both TUIs run in the scratch directory `/tmp/maws-harness/a`, which main creates, typed into the probe's shell
(`$SHELL` spawned without `-l` in M1; since M2 the host starts the login shell, `$SHELL -l`, by default).

Since M2 the page is on the production transport: `pty.data` arrives as bytes with offsets, the pane acknowledges
what xterm has parsed (`pty.ack`, one per 32 KiB or 16 ms), and a link activation calls `pty.openLink`. The gate's
`links` step stubs main's `shell.openExternal` to record the URL, so the run opens no browser. Gate results carry a
`gate` judgement (counts exact, last line, frame p95 within 50 ms, MB/s against its floor) and the stream as the
page saw it (`chunks`, `acks`, `maxUnparsed`, `maxUnacked`, `pausedSeen` from `pty.list` sampled every 20 ms).

## Layout

- `workloads.mjs`: the workload table (shared with the page), expected PTY byte counts per phase, the width script.
- `fixtures/width.json`: strings with their expected column widths (item 3).
- `results/<renderer>-<workload>.json`: `Metrics` from `metrics.ts` (the floods W1 to W3 from the M2 gate; M1's
  20 MB runs kept as `xterm-W{1,2,3}-m1.json`); `<renderer>-items.json`, `<renderer>-tui-<tui>.json`,
  `<renderer>-links-m2-gate.json`.
- `results/m5/`: the C9 M5 acceptance run's evidence (Playwright JSON and logs, the scratch driver's JSON, the
  `pnpm test` / `pnpm verify` logs, the tmux controls for the `CSI S` finding), copied with every session id (UUID)
  zeroed at the same length.
- `evidence/<renderer>-<item>.png`: screenshots named by item number; `evidence/m5-*.png` from the M5 acceptance run.
  Screenshots are **not redacted**: they show local paths and, in TUI frames, local session ids and usage lines, never
  credentials.
- `recordings/<tui>.rec`: `script -r` recordings of the item-11 runs, redacted with `redact-recording.mjs`.
- `upstream-xterm-scrollup.md`: the draft report of xterm.js's `CSI S` behaviour (M5; not filed, the owner decides).
- `findings.md`: the tables, the numbers and the verdict.

## What the page exposes

`window.__maws_harness.probe`: `ready()`, `run(workloadId, renderer, phase)`, `spawn`, `type`, `kill`, `idle`,
`snapshot(renderer, from, to)` (the buffer through `TerminalProbe`, never library internals), `state` (the debug
counters: bytes handed and parsed, `?2026h` count, Kitty and XTVERSION exchanges, DSR replies, last link, last input),
`focus`, `selection`, `simulateContextLoss`, `geometry`, `setSplit`, `setVisible`, `setBins`, `screenshotReady`.
