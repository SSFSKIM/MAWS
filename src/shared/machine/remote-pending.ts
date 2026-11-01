// How long main waits on another machine for a remote act (P5 O7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md):
// one bound shared by main's remote lane B (`sendPendingMs`, src/main/lane-b/remote.ts) and the renderer, which bounds its
// own waits above main's so main's typed answer always comes first.
//
// - An act answers at its outcome or, past `REMOTE_ACT_PENDING_MS`, with the pending words (a non-owner may be at the
//   sheet and Touch ID for all of it).
// - A remote `pty.attach` is an act, then the ring's bytes over the pty's stream, each phase under its own bound
//   (src/main/lane-b/remote-pty.ts): at most `REMOTE_ATTACH_PENDING_MS` in all.
export const REMOTE_ACT_PENDING_MS = 60_000;
export const REMOTE_ATTACH_PENDING_MS = 2 * REMOTE_ACT_PENDING_MS;
