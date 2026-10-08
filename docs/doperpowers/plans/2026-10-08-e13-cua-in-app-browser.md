# E13: the in-app browser driven by cua_repl (execution pointer)

> **Parent:** `docs/charter.md` (§19 line 982 and §16 line 614 are amended at M4) and the P1 extension
> `docs/doperpowers/plans/2026-10-05-p1-extension.md` (A-19, A-42, A-43, X9). Board issue #13 in the cua repository.

The living spec of this work is in the cua repository:
`docs/doperpowers/specs/2026-10-08-maws-in-app-browser-design.md` (cua worktree `/Users/new/Developer/GitHub/cua-wt-13`,
branch `maws-in-app-browser-13`). It owns the design, the acceptance, the Decision Log and Surprises & Discoveries for
both repositories; this file only keeps MAWS's convention that execution documents live under `plans/`.

MAWS branch: `e13-cua-in-app-browser` (worktree `/Users/new/Developer/GitHub/MAWS-wt-13`), from `master` at `aa1fa4ff`.

Milestones in MAWS (M1 is cua's: the host's client mode, discovery, `profiles_list`'s `maws` entry):

- **M2** — the primitive server over `TabStore` and `TabDebugger` (`src/main/browser/cua/`), debugger leases, the launch
  environment (`CUA_BROWSER_BACKENDS`), parking by lease, an e2e case with an in-repo fake host; spikes S1 (dialogs) and
  S2 (file chooser) under `spikes/cua-backend/`. Bindings: A-51 (amends A-19) and A-52 (amends A-43).
- **M3** — takeover, cursor, activity rows, agent downloads, dialogs and file chooser per the spikes, the "agent" badge;
  A-42 amended at its start.
- **M4** — the six `maws` browser tools and the Playwright driver removed; X9 amended at its start; charter §19 and §16.
- **M5** — live acceptance against the built app and the real vendor runtime; evidence under `docs/evidence/`.
