# Validating a MAWS change

`devenv validate maws` runs `.devbox/validate.sh`: `pnpm typecheck`, `pnpm lint` and `pnpm test`
(the unit suites, about two minutes; no Electron window, no model calls).

- [ ] `devenv validate maws` passes.
- [ ] For a UI change: `devenv start maws`, check the change in the app window, `devenv stop maws`.
- [ ] For a change the end-to-end suites cover: the matching `pnpm e2e:*` script (`package.json`;
      each builds the app and drives Electron through Playwright).
- [ ] Engine-host changes that touch the wire: `MAWS_LIVE=1 pnpm test:live` (needs the relay and
      spends model calls) — run it deliberately, not by default.
