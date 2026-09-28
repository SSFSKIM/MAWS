/// <reference types="electron-vite/node" />
// electron-vite's import suffixes (`?modulePath`) above; below, what electron.vite.config.ts defines for main and the
// host entries bundled with it.
// The per-launch CSP nonce under `electron-vite dev`, null in a build.
declare const __MAWS_DEV_CSP_NONCE__: string | null;
// The app's `package.json` version; what the hosts report as `hostVersion` in their pings.
declare const __MAWS_VERSION__: string;
