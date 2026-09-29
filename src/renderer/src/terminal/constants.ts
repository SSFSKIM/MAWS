// Terminal constants (C9 residue decisions): the scrollback bound, the renderer side of flow control, the pending
// bound, the WebGL budget and the checkpoint and resize cadences.

// Residue *Scrollback and memory*: 10,000 lines, at most 12 × cols × 10,000 bytes in xterm.js.
export const SCROLLBACK_LINES = 10_000;

// Residue *PTY stream and flow control*: the renderer acknowledges parsed bytes in one `pty.ack` per 32 KiB, or 16 ms
// after the last parse; a hidden terminal acknowledges at most 1 MiB/s (256 KiB per 250 ms tick), so a runaway
// program in a background tab blocks on its own output instead of starving the UI thread.
export const ACK_COALESCE_BYTES = 32 * 1024;
export const ACK_COALESCE_MS = 16;
export const HIDDEN_ACK_TICK_MS = 250;
export const HIDDEN_ACK_BYTES_PER_TICK = 256 * 1024;

// The host keeps 512 KiB of each pty's output (twice its 256 KiB high watermark). Chunks the registry holds for a pty
// it has not bound yet are bounded to the same size: anything older is in the replay.
export const PENDING_BYTES = 512 * 1024;

// Residue *WebGL policy*: at most this many terminals hold a WebGL context at once (Chromium's cap is 16 per renderer
// process); the rest draw with the DOM renderer.
export const WEBGL_BUDGET = 8;

// Residue *Reattach checkpoint*: a terminal with bytes parsed since its last checkpoint is checkpointed after this much
// quiet, never on a byte count.
export const CHECKPOINT_QUIESCENCE_MS = 500;

// A container's size changes reach the pty through a trailing debounce; the lossy reattach's repaint nudge spaces its
// two resizes by the same interval so the program sees two SIGWINCHes.
export const RESIZE_DEBOUNCE_MS = 50;
