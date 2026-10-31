// P5 O5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §E): main's entry, out/main/index.js (package.json's
// `main`). It runs the bootstrap every mode of the binary shares, then loads the mode's root by a deferred import: the
// app's composition (./app, out/main/app.js) today; the render host's root joins it on `--render-host` (O5 M3). ESM
// imports hoist, so a branch inside one module could not run before the app's imports evaluate: the bootstrap's own
// imports are kept to what it calls, none of which opens a window, touches the profile or loads a host's native module.
import { app } from 'electron';
import { guardStdio } from './stdio-guard'; // cua board #97
import { disableChromiumFeatures, STARTUP_DISABLED_FEATURES } from './chromium-features'; // P3-F1 fix 3
import { registerStoreSchemes } from '../render/scheme'; // P5 O5 M2: the scheme's Electron half

// cua board #97: before any log line, so a launcher's closed pipe or terminal never turns a console call into a crash.
guardStdio([process.stdout, process.stderr]);
// Socket peer authentication (cua spec 2026-10-09-maws-socket-peer-auth-design.md, Decision Log 2026-10-10): without a
// listener, a same-user SIGUSR1 opens a Node inspector on 127.0.0.1:9229 whose code runs inside main, a route around the
// cua socket's peer check. A listener of its own keeps Node from starting one; `--inspect` still works (the e2e harness).
process.on('SIGUSR1', () => {});

// A fresh profile for the end-to-end smoke (and anyone else who wants one); must be set before the app is ready.
if (process.env.MAWS_USER_DATA) app.setPath('userData', process.env.MAWS_USER_DATA);
// The smoke runs unattended, so nothing may wait on a person: Chromium keeps its storage key in a mock keychain
// instead of asking the login keychain, whose access prompt an unsigned or re-signed build can raise.
if (process.env.MAWS_E2E) app.commandLine.appendSwitch('use-mock-keychain');
// P3-F1 fix 3: no mDNS responder on *:5353 when a frame gathers ICE candidates (see chromium-features.ts); one merged switch.
disableChromiumFeatures(app.commandLine, STARTUP_DISABLED_FEATURES);
// E2: the store's scheme is privileged before the app is ready (protocol.registerSchemesAsPrivileged); P3-A M7: the
// artifact store's; P3-L M6b: the deliverable store's no more
registerStoreSchemes();

// The root loads in this script's own turn, before Electron's `ready`. A root that throws while loading fails as it did
// when its code was this file's: an uncaught exception, never a quietly rejected promise.
import('./app').catch((error: unknown) => {
  setImmediate(() => {
    throw error;
  });
});
