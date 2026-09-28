// Terminal constants (C9 residue decisions). M1 needs the scrollback bound; later milestones add the watermarks,
// ack coalescing, WebGL budget and checkpoint quiescence beside it.

// Residue *Scrollback and memory*: 10,000 lines, at most 12 × cols × 10,000 bytes in xterm.js.
export const SCROLLBACK_LINES = 10_000;
