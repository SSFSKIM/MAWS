// Every caller of the client port (OX4; P5 O1 M3) against a port that answers `noClient`, as mawsd's will when no
// client is reachable: each call settles at once with the degraded answer M3's table names, and none waits for a client.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { CommandName, CommandResult, Settings } from '@shared/ipc/schema';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { artifactExportName } from '@shared/maws/tools';
import { NO_CLIENT, type ClientPort, type NotifyEvent } from '@shared/client/port';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import { item, project, record } from '../../../test/support/builders';
import { SessionHarness } from '../../../test/support/session-harness';
import { zipFiles } from '../design-systems/zip';
import { createAssetDownload } from '../dashboard/download';
import { startDelivery, type GwsDriver } from '../delivery';
import { gwsLogin } from '../delivery/gws';
import { createFilesService } from '../files/service';
import { pickFiles } from '../files/pick';
import { saveTextFile } from '../files/save-text';
import { createLibraryFiles, type LibraryFilesDeps } from '../library/files';
import { revealPath } from '../settings/reveal';
import { openOwnerBrowser } from '../connectors/oauth-root';
import { listenLoopback } from '../connectors/oauth-callback';
import { createSignIn } from '../connectors/sign-in';
import { SessionReadModel, type ReadModelWriter } from '../sessions/read-model';
import { startNotifier } from '../attention/notifier';

const CLIENT: ClientRef = { id: 'page:1.1' as ClientId, onGone: () => () => {} };
const ID = '00000000-0000-4000-8000-000000000001';

// A port with no client to reach: every member answers noClient.
function noClientPort(): ClientPort {
  return {
    pick: vi.fn(async () => NO_CLIENT),
    save: vi.fn(async () => NO_CLIENT),
    confirm: vi.fn(async () => NO_CLIENT),
    reveal: vi.fn(async () => NO_CLIENT),
    openExternal: vi.fn(async () => NO_CLIENT),
    notify: vi.fn(() => NO_CLIENT),
    badge: vi.fn(() => NO_CLIENT),
    focus: vi.fn(() => NO_CLIENT),
  };
}

// Settles within a bound well under any wait a client could impose; a caller that waited for one fails here.
async function settles<T>(promise: Promise<T>, withinMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('did not settle without a client')), withinMs)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

let dir: string;
let port: ClientPort;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-no-client-'));
  port = noClientPort();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// The library's reach to a stored file, over one artifact whose content is `stored` and whose exports live under root.
function library(stored: { kind: 'file' | 'presentation'; name: string; path: string }, over: Partial<LibraryFilesDeps> = {}) {
  const call = async <N extends CommandName>(name: N): Promise<CommandResult<N>> => {
    if (name === 'artifacts.get') return { ok: true, value: { artifact: { id: ID, kind: stored.kind, title: 'Quarterly', revision: 3 } } } as never;
    if (name === 'artifacts.content') return { ok: true, value: { revision: 3, kind: stored.kind, name: stored.name, size: 1, sha256: 'x', path: stored.path } } as never;
    throw new Error(`unexpected ${name}`);
  };
  return createLibraryFiles({
    call,
    exporters: { get: () => undefined },
    root: join(dir, 'artifacts'),
    downloads: () => join(dir, 'Downloads'),
    port,
    readFile: vi.fn(),
    env: {},
    ...over,
  });
}

describe('dialogs answer as cancelled', () => {
  it('layout.pickFiles answers no files', async () => {
    expect(await settles(pickFiles({ kind: 'files', directory: null, multiple: true }, CLIENT, { port }))).toEqual({ files: [] });
    expect(port.pick).toHaveBeenCalledOnce();
  });

  it('layout.saveTextFile saves nothing', async () => {
    expect(await settles(saveTextFile({ defaultName: 'a.txt', text: 'x' }, CLIENT, { port, downloads: dir }))).toEqual({ saved: false });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('library.saveAs saves nothing', async () => {
    const stored = join(dir, 'report.pdf');
    writeFileSync(stored, 'pdf');
    expect(await settles(library({ kind: 'file', name: 'report.pdf', path: stored }).saveAs({ artifactId: ID, source: { content: {} } }, CLIENT))).toEqual({ saved: false });
  });

  it('artifacts.downloadAsset saves nothing', async () => {
    const asset = join(dir, 'sales.csv');
    writeFileSync(asset, 'a,b\n');
    const call = (async () => ({ ok: true, value: { revision: 1, kind: 'dashboard', name: 'sales.csv', size: 4, sha256: 'x', path: asset } })) as never;
    const download = createAssetDownload({ call, downloads: () => join(dir, 'Downloads'), port, env: {} });
    expect(await settles(download.downloadAsset({ artifactId: ID, ref: 'assets/sales.csv' }, CLIENT))).toEqual({ path: null });
  });

  it('the library’s Replace-folder question replaces nothing', async () => {
    const exports = join(dir, 'artifacts', ID, 'exports');
    mkdirSync(exports, { recursive: true });
    writeFileSync(join(exports, artifactExportName(7, 'pngs')), zipFiles({ 'slide-01.png': Uint8Array.from([1, 2]) }));
    const chosen = join(dir, 'chosen', 'Quarterly slides');
    mkdirSync(chosen, { recursive: true });
    writeFileSync(join(chosen, 'old.png'), 'old');
    port.save = vi.fn(async () => ({ path: chosen })); // the dialog chose an existing folder; the question has no client
    const files = library({ kind: 'presentation', name: 'deck.html', path: join(dir, 'unused') });
    expect(await settles(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pngs' } } }, CLIENT))).toEqual({ saved: false });
    expect(port.confirm).toHaveBeenCalledOnce();
    expect(readdirSync(chosen)).toEqual(['old.png']);
  });
});

describe('opens and reveals answer not opened, saying there is no client', () => {
  const A = 'A' as AppSessionId;
  const files = () => createFilesService({ records: (id) => (id === A ? { directory: dir, additionalDirectories: [], worktree: null } : null), port, env: {} });

  it('files.openExternal and files.reveal', async () => {
    writeFileSync(join(dir, 'doc.pdf'), 'x');
    chmodSync(join(dir, 'doc.pdf'), 0o644);
    const service = files();
    try {
      expect(await settles(service.openExternal(A, join(dir, 'doc.pdf'), CLIENT))).toEqual({ opened: false, message: 'no client' });
      expect(await settles(service.reveal(A, join(dir, 'doc.pdf'), CLIENT))).toEqual({ revealed: false, message: 'no client' });
    } finally {
      service.dispose();
    }
  });

  it('library.openExternally and library.reveal', async () => {
    const stored = join(dir, 'report.pdf');
    writeFileSync(stored, 'pdf');
    const files = library({ kind: 'file', name: 'report.pdf', path: stored });
    expect(await settles(files.openExternally({ artifactId: ID }, CLIENT))).toEqual({ opened: false, message: 'no client' });
    expect(await settles(files.reveal({ artifactId: ID }, CLIENT))).toEqual({ revealed: false, message: 'no client' });
  });

  it('settings.reveal', async () => {
    writeFileSync(join(dir, 'settings.json'), '{}');
    expect(await settles(revealPath(join(dir, 'settings.json'), CLIENT, { configHome: () => dir, sessionDirectories: () => [], port }))).toEqual({ revealed: false });
  });

  it('session.revealPath fails', async () => {
    const h = await new SessionHarness({ port }).start();
    try {
      h.index.projects.add(h.work);
      await expect(settles(h.service.revealPath(h.work, CLIENT))).rejects.toThrow('no client');
    } finally {
      h.dispose();
    }
  });
});

describe('browser hand-offs take their flow’s could-not-open path', () => {
  it('connector sign-in fails as the engine’s URL not opened', async () => {
    const events: ConnectorSignInChanged[] = [];
    const host = {
      async call(name: string, input: { redirectUri: string }) {
        if (name === 'session.mcpStatus') return { ok: true, value: { mcpServers: [{ name: 'linear', status: 'needs-auth' }] } };
        if (name === 'session.mcpAuthenticate') return { ok: true, value: { ok: true, answer: { authUrl: `http://127.0.0.1:9/authorize?redirect_uri=${encodeURIComponent(input.redirectUri)}`, requiresUserAction: true, callbackExpected: true, redirectScheme: 'custom', state: 's' } } };
        throw new Error(`unexpected ${name}`);
      },
    };
    const signIn = createSignIn({ host: host as never, listen: listenLoopback, port, emit: (event) => events.push(event), ready: () => true, onSessionGone: () => () => {}, check: async () => null });
    try {
      const { opId } = signIn.start({ name: 'linear', scope: 'user', cwd: null, path: '/cfg/.claude.json', appSessionId: 'app-1' }, CLIENT);
      await settles(vi.waitFor(() => expect(events.filter((e) => e.opId === opId).at(-1)?.state).toBe('failed')));
      expect(events.at(-1)).toMatchObject({ state: 'failed', reason: 'engine', message: 'the authorization URL was not opened: no client' });
    } finally {
      signIn.stop();
    }
  });

  it('the OAuth flow’s browser hand-off rejects', async () => {
    await expect(settles(openOwnerBrowser(port, 'https://auth.example/authorize?state=s', CLIENT))).rejects.toThrow('the authorization URL was not opened: no client');
  });

  it('delivery’s gws login stops as could not open the sign-in page', async () => {
    // a gws stand-in that prints its Google URL and waits for the browser, as `gws auth login` does
    const bin = join(dir, 'gws');
    writeFileSync(bin, '#!/bin/sh\necho "Open https://accounts.google.com/o/oauth2/auth?client_id=x"\nsleep 30\n');
    chmodSync(bin, 0o755);
    const handlers = new Map<string, (input: unknown, ctx: { client: ClientRef }) => unknown>();
    const gws: GwsDriver = { find: async () => bin, state: async () => ({ state: 'signedOut' }), login: gwsLogin, upload: vi.fn() };
    const delivery = startDelivery({
      register: ((name: string, handler: (input: unknown, ctx: { client: ClientRef }) => unknown) => void handlers.set(name, handler)) as never,
      emit: () => true,
      exportArtifact: vi.fn(),
      call: vi.fn(),
      connectors: null,
      shellEnv: async () => ({ PATH: '/usr/bin:/bin', HOME: dir }),
      port,
      gws,
      log: () => {},
    });
    try {
      // a real process starts first, slow on a loaded run: 10 s, still a third of the stand-in's wait for the browser
      const answer = await settles(Promise.resolve(handlers.get('delivery.connect')!({ runId: 'r1', target: 'drive', artifactId: ID }, { client: CLIENT })), 10_000);
      expect(answer).toEqual({ ok: false, why: 'failed', message: 'could not open the sign-in page: no client' });
    } finally {
      delivery.stop();
    }
  }, 20_000);
});

describe('the notifier', () => {
  const SESSION = 'app-1' as AppSessionId;
  function notifier(over: Partial<ClientPort> = {}) {
    Object.assign(port, over);
    const model = new SessionReadModel('index');
    let writer!: ReadModelWriter;
    model.register({ start: (w) => ((writer = w), () => {}) });
    writer.observeProject(project('maws', 0, { name: 'MAWS' }));
    writer.observeRecord(record(SESSION, { projectId: 'maws' as never }));
    const emit = vi.fn(() => true);
    const navigate = vi.fn();
    const settings: Settings = SETTINGS_DEFAULTS_V19;
    const stop = startNotifier(model, { port, isFocused: () => false, isViewing: () => false, navigate, failure: vi.fn(), settings: () => settings, emit });
    return { writer, emit, navigate, stop };
  }

  it('notify falls back to the dock bounce, whose own noClient is ignored; the badge’s is ignored', () => {
    const n = notifier();
    try {
      n.writer.observeAttention(SESSION, [item(SESSION, 'permission', '2026-10-27T10:00:00Z')]);
      expect(port.notify).toHaveBeenCalledOnce();
      expect(port.focus).toHaveBeenCalledExactlyOnceWith(null, 'request');
      expect(n.emit).toHaveBeenCalledExactlyOnceWith('attention.notified', expect.objectContaining({ appSessionId: SESSION, delivery: 'fallback' }));
      expect(port.badge).toHaveBeenLastCalledWith(null, 1);
    } finally {
      n.stop();
    }
  });

  it('a click’s focus is ignored and its navigation still goes', () => {
    let fire: (event: NotifyEvent) => void = () => {};
    const n = notifier({ notify: vi.fn((_client, _request, onEvent) => ((fire = onEvent), { close: () => {} })) });
    try {
      n.writer.observeAttention(SESSION, [item(SESSION, 'permission', '2026-10-27T10:00:00Z')]);
      fire({ kind: 'clicked' });
      expect(port.focus).toHaveBeenCalledExactlyOnceWith(null, 'bring');
      expect(n.navigate).toHaveBeenCalledOnce();
    } finally {
      n.stop();
    }
  });
});
