# desk-web

The desk's web app, served by desk-hub's Worker: the owner's phone (and any browser) behind Cloudflare Access. Since P5 O13 (`docs/doperpowers/plans/2026-10-27-p5-o13-web-cards.md`), a machine moved to MAWS answers its cards over its own sealed channel to this browser as a `web-cards` device, and refuses every DX6 request; machines not yet moved keep their DX6 cards here, side by side.

**Maintained** — what the phone loop of a moved machine runs on:
- the cards: `src/cards/` (the device record, the pinned org store, the listings, the channel client, the board) and `src/views/cards/` (the list, a session's cards, the Device panel);
- push and its landing: `src/push/`, `src/sw/` (the v1 and v2 notices), `src/pwa/service-worker.ts` (a tap's URL, cold or posted to an open window), and the cards routes in `src/shell/layout.ts`;
- the freeze's one seam: `movedToMaws` (`src/cards/board.ts`, read by `src/shell/sessions.ts`), which makes `src/conversation/capabilities.ts` offer nothing, with the reason *moved to MAWS: its cards are on this phone's channel*, for a session whose machine the device's org state lists; the composer shows that reason disabled, and the DX6 client (`src/hub/project-client.ts`'s `movedToMaws`, wired in `src/project/connection.ts`) sends such a machine no RPC, a retry or a reconnect's resend included.

**Frozen** — drawn as they are, not maintained: the grid, the project, session and depth views, the org, key, machines and notifications dialogs, the DX6 client (`src/project/`, `src/hub/project-client.ts`) and the org key (`src/key/`). A frozen view is fixed only when a moved machine's phone loop depends on it, and that fix is reported to the owner before it is made. The frozen session view renders transcript rows (the engine's `answeredWithoutRequest` rows included) as it does; no maintained view renders any.

The seam reads the org state only a listed device holds: a browser that is not one names no machine as moved.

**Lifted into MAWS** — the depth column's DX4 lane A machinery (the plane transcript, its streaming layer and row drawing, the subagent feed, the jobs, diff and view helpers, and the conversation words) lives in MAWS's renderer under `src/renderer/src/lane-a/` since P5 O9 M3, with its unit suites and test doubles (`test-support/`), and is MAWS's lane A code to maintain. desk-web imports it from there; `src/depth/source/desk-source.ts` passes in the desk's store keys, latency marks and model store.

Suites: `e2e/` against the DX3 double (`pnpm --filter desk-web e2e`), `e2e-hub/` against desk-hub's local runner (`playwright.hub.config.ts`; the cards specs load MAWS's endpoint in-process through Vite's `runnerImport`), `e2e-staging/` against staging. Build first (`pnpm --filter desk-web build`); on the Mac run one browser spec at a time, in Playwright's own Chromium (`DESK_E2E_CHANNEL=chromium`).
