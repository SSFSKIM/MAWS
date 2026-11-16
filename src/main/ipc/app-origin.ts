// Whether a frame's URL is at the app's origin (moved out of ./router.ts's sender check for UX wave U6e's guard,
// docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, decision 9): `file:` for the built app, the
// dev server's origin under `pnpm dev`. Electron-free, so the guard's predicate (src/main/files/open-file.ts) reads the
// same test the router's sender check reads.
export function atAppOrigin(url: string, appUrl: string): boolean {
  try {
    const frame = new URL(url);
    const app = new URL(appUrl);
    return app.protocol === 'file:' ? frame.protocol === 'file:' : frame.origin === app.origin;
  } catch {
    return false;
  }
}
