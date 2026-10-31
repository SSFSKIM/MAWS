// The render host's composition root (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §E): the
// app's own binary run windowless by `mawsd` as `<binary> [<app root>] --render-host <profile>`, loaded by main's entry
// (src/main/index.ts) after the bootstrap every mode shares, in place of the app's root. Named `root.ts`, not `index.ts`,
// so its chunk is never an `index-<hash>.js` the bundle guard counts among main's host bundles; its graph reads no
// `__dirname` (the bundle guard holds every `__dirname` read to out/main/app.js), since its chunk lands under chunks/.
//
// Its life is host.ts's; this supplies the Electron side and the render library. The accessory activation policy keeps
// it out of the Dock and the app switcher (M1's probe), `window-all-closed` is guarded so the process outlives each
// render's window (FINDINGS §1.2), the capture partition takes the app's store frame policies and the scheme proxy to
// `mawsd`'s artifact endpoint (the only session a render loads from), and the default session refuses every permission.
// The library is composed over the `machine.sock` link's engine-host commands, with no Word comment authors of its own
// (the exporters' defaults) and no restart count (a dashboard export is not captured twice); its exports are written
// under the profile's store, `<profile>/artifacts`, as the app writes them.
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { app, session } from 'electron';
import { buildIdOf } from '../engine-host/supervisor-files';
import { CAPTURE_PARTITION } from '../render/capture';
import { composeRender } from '../render/compose';
import { installRenderSeams } from '../render/e2e-seams';
import { guardPermissions, installFramePolicies } from '../render/policies';
import { serveArtifactsThrough, type ContentLookup } from '../render/scheme';
import { EXIT_FAILED, startRenderHost } from './host';

// A windowless process must never raise Electron's error dialog, which an uncaught exception in main shows, modal: it
// would hold the render host (before `ready`, Chromium's start with it) with nothing said. The failure is written to
// stderr at once, synchronously since an asynchronous pipe write would not outlive the exit, and ends the process.
function fatal(error: unknown): void {
  writeSync(2, `[render-host] failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  app.exit(EXIT_FAILED);
}

export function runRenderHost(entryDir: string): Promise<void> {
  process.on('uncaughtException', fatal);
  return startRenderHost({
    argv: process.argv,
    // main's hello names its build by mawsd.js beside the entry (src/main/hosts/index.ts), so the render host does too.
    // The entry names its directory: `require.main` is unset under Playwright's loader, and the build id read from a
    // relative 'mawsd.js' failed there (P5 O5 M3's first gate run)
    build: () => buildIdOf(join(entryDir, 'mawsd.js')),
    userData(dir) {
      app.setPath('userData', dir);
      app.setActivationPolicy?.('accessory');
      app.on('window-all-closed', () => {}); // between requests no window is open, and the host stays
    },
    async ready() {
      await app.whenReady();
      app.dock?.hide();
    },
    sessions(paths) {
      const capture = session.fromPartition(CAPTURE_PARTITION);
      installFramePolicies(capture, process.env); // no app page here, so no origin is trusted beyond the artifact's own
      guardPermissions(capture, 'all');
      guardPermissions(session.defaultSession, 'all');
      serveArtifactsThrough(capture, { socketPath: paths.artifactsSocket });
    },
    compose(call, profile) {
      const content: ContentLookup = (input) => call('artifacts.content', input);
      installRenderSeams({ content, env: process.env });
      return composeRender({ call, content, root: join(profile, 'artifacts'), env: process.env });
    },
    log: (line) => console.error(line),
    exit: (code) => app.exit(code),
  }).catch(fatal);
}
