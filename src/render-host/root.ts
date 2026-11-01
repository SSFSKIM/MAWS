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
// (P5 O5 M4: each export's request carries what `mawsd` holds, else the exporters' defaults) and the engine host's link
// generation `mawsd` posts as its restart count (a dashboard export captured again once across a restart, as the app's);
// its exports are written under the profile's store, `<profile>/artifacts`, as the app writes them.
//
// P5 O17 M4 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4): the tab engine (tab-engine.ts), composed at the
// first `browserEngine.request`: offscreen views (offscreen-views.ts) in Electron's partitions, the per-session sockets in
// `renderCuaSocketDir`, the peer check's addon as the app loads it (the packaged app's Resources, else the development app
// root this binary was started on), named for its machine as `mawsd` names it. No trusted root and no stand-in addon: only
// `mawsd`'s relay is admitted, on darwin; elsewhere the uid is the boundary.
import { writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { app, session } from 'electron';
import { renderCuaSocketDir } from '@shared/daemon/files';
import { machineName } from '@shared/machine/identity';
import { loadPeerAddon, peerAddonPath } from '../main/browser/cua/peer';
import { buildIdOf } from '../engine-host/supervisor-files';
import { CAPTURE_PARTITION } from '../render/capture';
import { composeRender } from '../render/compose';
import { installRenderSeams } from '../render/e2e-seams';
import { guardPermissions, installFramePolicies } from '../render/policies';
import { serveArtifactsThrough, type ContentLookup } from '../render/scheme';
import { EXIT_FAILED, RENDER_HOST_DIR, sandboxRefusal, startRenderHost } from './host';
import { OffscreenViews } from './offscreen-views';
import { startTabEngine } from './tab-engine';

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
    sandbox: () => sandboxRefusal({ platform: process.platform, argv: process.argv, hasSwitch: (name) => app.commandLine.hasSwitch(name) }), // P5 O5 M6
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
    compose(call, profile, hostGeneration) {
      const content: ContentLookup = (input) => call('artifacts.content', input);
      installRenderSeams({ content, env: process.env });
      return composeRender({ call, content, root: join(profile, 'artifacts'), env: process.env, hostGeneration });
    },
    browser: (link, paths) =>
      startTabEngine({
        ...link,
        views: (partitions) => new OffscreenViews(partitions),
        fromPartition: (partition) => session.fromPartition(partition),
        socketDir: renderCuaSocketDir(paths.profileDir),
        userData: join(paths.dir, RENDER_HOST_DIR),
        peer: { addon: loadPeerAddon(peerAddonPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appRoot: app.getAppPath() })) },
        machine: machineName(process.env, hostname()),
        version: app.getVersion(),
        log: (line) => console.error(line),
      }),
    log: (line) => console.error(line),
    exit: (code) => app.exit(code),
  }).catch(fatal);
}
