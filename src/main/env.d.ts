/// <reference types="electron-vite/node" />
// electron-vite's import suffixes (`?modulePath`) above; below, what electron.vite.config.ts defines for main and the
// host entries bundled with it.
// The per-launch CSP nonce under `electron-vite dev`, null in a build.
declare const __MAWS_DEV_CSP_NONCE__: string | null;
// The app's `package.json` version; what the hosts report as `hostVersion` in their pings.
declare const __MAWS_VERSION__: string;
// E11 §2.7: main's build stamp, the commit (`unknown` outside a checkout) and the build's ISO time.
declare const __MAWS_BUILD__: { commit: string; builtAt: string };
// P5 O8 M4a Task 8: true in a harness build (MAWS_HARNESS=1, or the dev server), false in every other; unit tests leave it
// undefined, so a reader guards with `typeof` and a build folds the guard and drops what it keeps out.
declare const __MAWS_HARNESS_BUILD__: boolean;
