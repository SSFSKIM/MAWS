# Filed as https://github.com/xtermjs/xterm.js/issues/6195

The report as filed on 2026-09-29 (title and body below).

**Title:** SU (`CSI Ps S`) in a scroll region anchored at the top row discards the scrolled-out rows instead of adding them to scrollback

**Version:** `@xterm/xterm` 6.0.0 (also `@xterm/headless` 6.0.0). The same code is in 6.1.0-beta.304 (`src/common/InputHandler.ts`, `scrollUp`).

## Isolated reproduction

In a 40-row terminal:

```sh
seq 1 60; printf '\e[1;39r\e[10S\e[r'
```

The sequence sets the scroll region to rows 1 to 39, scrolls it up 10 rows, then resets the region.

**Expected** (tmux 3.7b, iTerm2, kitty):
- The 10 rows that leave the top of the region go into scrollback, so all of `1` to `60` can still be scrolled to.
- Row 40, outside the region, is unchanged.
- The region's bottom 10 rows are blank, with the current background.

**Observed** (xterm.js 6.0.0):
- The visible screen is the same as tmux's.
- The 10 rows are gone: they are not in scrollback. After the sequence, the buffer holds 50 of the 60 numbers.

**Control:** the same bytes in tmux 3.7b, in a 189×40 pane with `history-limit 10000`, keep all 60 rows (`tmux capture-pane -p -S -`).

## Cause

`InputHandler.scrollUp` (6.0.0, `src/common/InputHandler.ts` lines 1429 to 1438) runs this for every step:

```ts
this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1);
this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
```

This deletes the top row of the region whatever the region's top is. The line-feed path (`BufferService.scroll`) already treats `scrollTop === 0` specially: it inserts after the region's bottom and advances `ybase`, so the row enters scrollback. SU with `scrollTop === 0` on the normal buffer could take the same path, `Ps` times (clamped to the region's height).

## Why it matters

Codex CLI's inline TUI (0.155.1, also reported in openai/codex #27644 against 0.139.0) pushes finished transcript lines and the shell rows above it out of its viewport with exactly `CSI 1;B r` `CSI k S` `CSI r`. Codex expects those rows to land in scrollback and never repaints them, so in xterm.js hosts (the VS Code terminal, Electron embeds) they are lost:
- Starting codex and quitting at once, in a 189×40 terminal after `seq 1 60`, loses 17 of the 60 rows.
- Longer conversations get permanent gaps in the transcript.

## Workaround used downstream

An embedder registers `terminal.parser.registerCsiHandler({ final: 'S' }, …)`. On the normal buffer with the scroll region's top at row 1, it scrolls through the core's line-feed scroll with SU's erase attributes and returns `true`; otherwise it returns `false`. This needs private members (`_core._bufferService.scroll`, `_core._inputHandler._eraseAttrData`), which is why a fix in xterm.js is preferable.
