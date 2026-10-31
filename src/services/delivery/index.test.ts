// P4-B5: the owner's Send to (./index.ts) over scripted seams: the owner delivery and the gws driver are doubles, the
// export a real file planted where main's export would leave it. What it proves: no session or prompt exists in its
// reach (its deps have none); Notion takes the export's text and `notion-create-pages` with the title and a parent when
// named; Drive takes the owner's format through gws with the file's own name; a cancel before the write sends nothing,
// after it is refused; a failure that may follow a write says so; receipts are kept per artifact and target and
// broadcast; and the CLI's absence and a refused login are answered as such.
//
// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §G; D14, D15, D38): the machine's, over the
// bus. Main exports and hands the path to `delivery.deliver` (main-only), which admits only the artifact's own export
// under `<profile>/artifacts/<artifactId>/exports/` in the export grammar for the format and revision, sends it and
// removes it whatever the answer; a path it does not admit is left where it is, nothing sent. A cancel that arrives
// before its run is a tombstone the run consumes; one for an ended run answers false.
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import type { DirectSource } from '@shared/ipc/schema/connectors';
import { artifactExportName, type ArtifactExportFormat } from '@shared/maws/tools';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import type { OwnerDelivery } from '../connectors/owner-delivery';
import { admitExport, DELIVERY_RECEIPT_LIMIT, DELIVERY_SOURCE_LIMIT, startDelivery, type DeliveryDeps, type GwsDriver } from '.';

const ART = '11111111-1111-4111-8111-111111111111';
const OTHER_ART = '33333333-3333-4333-8333-333333333333';
const RUN = () => crypto.randomUUID();
const CLIENT = endableClientRef('page:1.1'); // the page asking
const source: DirectSource = { directory: '/repo', sourceId: '22222222-2222-4222-8222-222222222222', generation: 1, server: 'notion', scope: 'user', transport: 'http', path: '/h/.claude.json', entryPath: ['mcpServers', 'notion'], observedAt: '2026-10-19T00:00:00.000Z', resourceUrl: 'https://mcp.notion.com/mcp' };
const PAGE = { content: [{ type: 'text', text: JSON.stringify({ pages: [{ id: 'abc', url: 'https://www.notion.so/Quarterly-memo-0123456789abcdef0123456789abcdef', properties: { title: 'Quarterly memo' } }] }) }] };

let dir: string;
let artifactsRoot: string;
let bus: FakeBus;
let planted: string[];
let connectors: { [K in keyof OwnerDelivery]: ReturnType<typeof vi.fn> };
let gws: { [K in keyof GwsDriver]: ReturnType<typeof vi.fn> };
let dispatch: ReturnType<typeof vi.fn>;
let stop: () => void;
let artifact: { title: string } | null;

function start(overrides: Partial<DeliveryDeps> = {}) {
  bus = fakeBus();
  stop = startDelivery({
    bus,
    hosts: { dispatch: dispatch as never },
    connectors: connectors as unknown as OwnerDelivery,
    shellEnv: async () => ({ PATH: '/scratch/bin', HOME: '/scratch/home' }),
    port: { openExternal: vi.fn(async () => ({ opened: true as const })) },
    artifactsRoot,
    gws: gws as unknown as GwsDriver,
    now: () => 1_000,
    log: () => {},
    ...overrides,
  }).stop;
}

// Main's export, as it leaves it: the artifact's own file under its exports directory, in the export grammar.
function plant(format: ArtifactExportFormat, revision = 7, artifactId = ART, body = format === 'md' ? '# Notion body' : 'bytes'): string {
  const exports = join(artifactsRoot, artifactId, 'exports');
  mkdirSync(exports, { recursive: true });
  const path = join(exports, artifactExportName(revision, format, crypto.randomUUID()));
  writeFileSync(path, body);
  planted.push(path);
  return path;
}

// A command as main (the main-only `delivery.deliver`) or a client asks it, its answer's value
async function call(name: CommandName, input?: unknown, client = CLIENT): Promise<unknown> {
  const answer = await bus.main(name, input, client);
  if (!answer.ok) throw new Error(`${name} failed: ${JSON.stringify(answer.error).slice(0, 400)}`);
  return answer.value;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-b5-delivery-'));
  artifactsRoot = join(dir, 'profile', 'artifacts');
  planted = [];
  artifact = { title: 'Quarterly memo' };
  dispatch = vi.fn(async (owner: string, name: string) => {
    if (owner !== 'engine-host' || name !== 'artifacts.get') throw new Error(`unexpected ${owner} ${name}`);
    return { ok: true, value: { artifact } };
  });
  connectors = {
    find: vi.fn(async () => ({ sources: [{ source, connection: 'connected' }], live: 1 })),
    connect: vi.fn(async () => ({ ok: true })),
    send: vi.fn(async () => ({ ok: true, result: PAGE })),
  };
  gws = {
    find: vi.fn(async () => '/scratch/bin/gws'),
    state: vi.fn(async () => ({ state: 'ready', user: 'owner@example.com' })),
    login: vi.fn(async () => ({ ok: true })),
    upload: vi.fn(async (_bin, _env, opts: { name: string }) => ({ ok: true, id: 'f1', name: opts.name, link: 'https://drive.google.com/file/d/f1/view' })),
  };
  start();
});
afterEach(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

const deliver = (target: 'notion' | 'drive', format: ArtifactExportFormat, extra: Record<string, unknown> = {}) =>
  call('delivery.deliver', { runId: RUN(), target, artifactId: ART, format, destination: { kind: 'default' }, exportPath: plant(format), revision: 7, title: 'Quarterly memo', ...extra });
const sendNotion = (extra: Record<string, unknown> = {}) => deliver('notion', (extra.format as ArtifactExportFormat | undefined) ?? 'md', extra);
const sendDrive = (extra: Record<string, unknown> = {}) => deliver('drive', (extra.format as ArtifactExportFormat | undefined) ?? 'docx', extra);
const removed = () => planted.every((path) => !existsSync(path));

describe('the Notion target', () => {
  it('answers ready with the connector it found, its handle naming that source for the send', async () => {
    const status = (await call('delivery.status', { target: 'notion', artifactId: ART })) as { state: string; source: { key: string; server: string; file: string } };
    expect(status).toMatchObject({ target: 'notion', state: 'ready', connection: 'connected', source: { server: 'notion', scope: 'user', transport: 'http', file: '/h/.claude.json' } });
    await sendNotion({ source: status.source.key });
    expect(connectors.find).toHaveBeenCalledTimes(1); // the handle, not a second search
    expect(connectors.send.mock.calls[0]![0]).toEqual(source);
  });

  it('offers and sends an app-configured connector from a cold app, preserving its truthful scope across IPC', async () => {
    const appSource = { ...source, scope: 'app', path: '/app/settings.json', entryPath: ['engine', 'mcpServers', 'name=notion'] };
    connectors.find.mockResolvedValueOnce({ sources: [{ source: appSource, connection: 'connected' }], live: 0 });
    const status = await call('delivery.status', { target: 'notion', artifactId: ART }) as { source: { key: string } };
    expect(status).toMatchObject({ state: 'ready', source: { scope: 'app', file: '/app/settings.json' } });
    await sendNotion({ source: status.source.key });
    expect(connectors.send.mock.calls[0]![0]).toEqual(appSource);
    expect(connectors.send).toHaveBeenCalledTimes(1);
  });

  it('says no session runs to report one, or that none of their reports names one', async () => {
    connectors.find.mockResolvedValueOnce({ sources: [], live: 0 }).mockResolvedValueOnce({ sources: [], live: 2 });
    expect(await call('delivery.status', { target: 'notion', artifactId: ART })).toEqual({ target: 'notion', state: 'none', why: 'noSession' });
    expect(await call('delivery.status', { target: 'notion', artifactId: ART })).toEqual({ target: 'notion', state: 'none', why: 'notFound' });
  });

  it('sends the export as one page titled as main named it, private by default, inside a named page, and removes it', async () => {
    const answer = await sendNotion();
    expect(connectors.send).toHaveBeenCalledTimes(1);
    expect(connectors.send.mock.calls[0]![1]).toEqual({ artifactId: ART, tool: 'notion-create-pages', arguments: { pages: [{ properties: { title: 'Quarterly memo' }, content: '# Notion body' }], allow_async: false } });
    expect(answer).toEqual({ ok: true, receipt: { artifactId: ART, target: 'notion', at: 1_000, name: 'Quarterly memo', url: 'https://www.notion.so/Quarterly-memo-0123456789abcdef0123456789abcdef', format: 'md', revision: 7, destination: { kind: 'default' } } });
    await sendNotion({ destination: { kind: 'inside', id: '0123456789abcdef0123456789abcdef' }, versionId: 3 });
    expect(connectors.send.mock.calls[1]![1].arguments.parent).toEqual({ type: 'page_id', page_id: '0123456789abcdef0123456789abcdef' });
    expect(connectors.send).toHaveBeenCalledTimes(2);
    expect(removed()).toBe(true); // each export's own file removed
  });

  it('keeps the latest receipt per artifact and target and broadcasts each', async () => {
    await sendNotion();
    await sendDrive();
    expect(bus.emitted.map((event) => event.name)).toEqual(['delivery.receipt', 'delivery.receipt']);
    const { receipts } = (await call('delivery.receipts', undefined)) as { receipts: { target: string }[] };
    expect(receipts.map((receipt) => receipt.target)).toEqual(['notion', 'drive']);
  });

  it('reads the tool’s own error, and words route D’s reasons, a failure that may follow the write as maybeSent', async () => {
    connectors.send.mockResolvedValueOnce({ ok: true, result: { isError: true, content: [{ type: 'text', text: 'Could not find page with ID' }] } });
    expect(await sendNotion()).toEqual({ ok: false, why: 'toolError', message: 'Could not find page with ID' });
    connectors.send.mockResolvedValueOnce({ ok: false, failure: 'unavailable', reason: 'unauthorized' });
    expect(await sendNotion()).toEqual({ ok: false, why: 'unauthorized' });
    connectors.send.mockResolvedValueOnce({ ok: false, failure: 'unavailable', reason: 'timeout' });
    expect(await sendNotion()).toEqual({ ok: false, why: 'timeout', maybeSent: true });
    connectors.send.mockResolvedValueOnce({ ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' });
    expect(await sendNotion()).toEqual({ ok: false, why: 'deleted' });
    // P4-B5 review: an end with no typed answer may have reached Notion only if its command went out
    connectors.send.mockResolvedValueOnce({ ok: false, failure: 'unavailable', reason: 'lost', message: 'the engine host is not streaming its events yet', sent: false });
    expect(await sendNotion()).toEqual({ ok: false, why: 'unavailable' });
    connectors.send.mockResolvedValueOnce({ ok: false, failure: 'unavailable', reason: 'lost', message: 'no credential could be prepared', sent: false, credential: false });
    expect(await sendNotion()).toEqual({ ok: false, why: 'unauthorized' });
    connectors.send.mockResolvedValueOnce({ ok: false, failure: 'failed', reason: 'lost', message: 'directTake failed', sent: true });
    expect(await sendNotion()).toEqual({ ok: false, why: 'failed', maybeSent: true });
    expect(bus.emitted).toEqual([]);
    expect(removed()).toBe(true);
  });

  it('refuses a format other than Markdown, a deleted artifact, and a second run of the same artifact meanwhile', async () => {
    expect(await sendNotion({ format: 'pdf' })).toEqual({ ok: false, why: 'invalid' });
    artifact = null;
    expect(await sendNotion()).toEqual({ ok: false, why: 'deleted' });
    artifact = { title: 'Quarterly memo' };
    let release!: () => void;
    connectors.send.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true, result: PAGE }))));
    const first = sendNotion();
    await vi.waitFor(() => expect(connectors.send).toHaveBeenCalled());
    expect(await sendNotion()).toEqual({ ok: false, why: 'busy' });
    release();
    expect(await first).toMatchObject({ ok: true });
  });

  it('a cancel before the write sends nothing; after it the send is not called back', async () => {
    let reading!: () => void;
    dispatch.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (reading = resolve));
      return { ok: true, value: { artifact } };
    });
    const runId = RUN();
    const pending = sendNotion({ runId });
    await vi.waitFor(() => expect(reading).toBeTypeOf('function'));
    expect(await call('delivery.cancel', { runId })).toEqual({ cancelled: true });
    reading();
    expect(await pending).toEqual({ ok: false, why: 'cancelled' });
    expect(connectors.send).not.toHaveBeenCalled();
    expect(removed()).toBe(true);

    let release!: () => void;
    connectors.send.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true, result: PAGE }))));
    const later = RUN();
    const sending = sendNotion({ runId: later });
    await vi.waitFor(() => expect(connectors.send).toHaveBeenCalled());
    expect(await call('delivery.cancel', { runId: later })).toEqual({ cancelled: false });
    release();
    expect(await sending).toMatchObject({ ok: true });
  });

  // P4-B5 review: the run's signal is read again after the export's read, its last read and the write one step
  it('a cancel while the Notion export is read sends nothing', async () => {
    let reading!: () => void;
    start({
      readFile: async () => {
        await new Promise<void>((resolve) => (reading = resolve));
        return '# Notion body';
      },
    });
    const runId = RUN();
    const pending = sendNotion({ runId });
    await vi.waitFor(() => expect(reading).toBeTypeOf('function'));
    expect(await call('delivery.cancel', { runId })).toEqual({ cancelled: true });
    reading();
    expect(await pending).toEqual({ ok: false, why: 'cancelled' });
    expect(connectors.send).not.toHaveBeenCalled();
    expect(removed()).toBe(true);
  });

  // P4-B5 review: a handle main no longer keeps (the oldest evicted) is refused, never a fresh search's first source
  it('refuses a source handle it no longer keeps, for a send and a Connect alike', async () => {
    const first = (await call('delivery.status', { target: 'notion', artifactId: ART })) as { source: { key: string } };
    for (let i = 0; i < DELIVERY_SOURCE_LIMIT; i++) await call('delivery.status', { target: 'notion', artifactId: ART });
    connectors.find.mockClear();
    expect(await sendNotion({ source: first.source.key })).toEqual({ ok: false, why: 'source' });
    expect(await call('delivery.connect', { runId: RUN(), target: 'notion', artifactId: ART, source: first.source.key })).toEqual({ ok: false, why: 'source' });
    expect(connectors.find).not.toHaveBeenCalled();
    expect(connectors.send).not.toHaveBeenCalled();
    expect(connectors.connect).not.toHaveBeenCalled();
    expect(removed()).toBe(true);
    await sendNotion(); // no handle named: the source found now
    expect(connectors.find).toHaveBeenCalledTimes(1);
  });

  it('connects the source the sheet named through the owner delivery', async () => {
    const status = (await call('delivery.status', { target: 'notion', artifactId: ART })) as { source: { key: string } };
    expect(await call('delivery.connect', { runId: RUN(), target: 'notion', artifactId: ART, source: status.source.key })).toEqual({ ok: true });
    expect(connectors.connect.mock.calls[0]![0]).toEqual(source);
    expect(connectors.connect.mock.calls[0]![2]).toBe(CLIENT); // P5 O1 M3: the consent opens on the asking client
    connectors.connect.mockResolvedValueOnce({ ok: false, why: 'denied' });
    expect(await call('delivery.connect', { runId: RUN(), target: 'notion', artifactId: ART, source: status.source.key })).toEqual({ ok: false, why: 'denied' });
  });

  it('with no route D, is unavailable', async () => {
    start({ connectors: null });
    expect(await call('delivery.status', { target: 'notion', artifactId: ART })).toEqual({ target: 'notion', state: 'unavailable' });
    expect(await sendNotion()).toEqual({ ok: false, why: 'unavailable' });
  });
});

describe('the Drive target (gws)', () => {
  // D38: main reads `absent` first and exports nothing; a delivery that arrives anyway sends nothing and removes it
  it('reports gws absent, and never exports or uploads without it', async () => {
    gws.find.mockResolvedValue(null);
    expect(await call('delivery.status', { target: 'drive', artifactId: ART })).toEqual({ target: 'drive', state: 'absent' });
    expect(await sendDrive()).toEqual({ ok: false, why: 'absent' });
    expect(await call('delivery.connect', { runId: RUN(), target: 'drive', artifactId: ART })).toEqual({ ok: false, why: 'absent' });
    expect(removed()).toBe(true);
    expect(gws.upload).not.toHaveBeenCalled();
    expect(gws.login).not.toHaveBeenCalled();
  });

  it('reports gws’s own state, with the owner’s login-shell environment', async () => {
    gws.state.mockResolvedValueOnce({ state: 'signedOut' });
    expect(await call('delivery.status', { target: 'drive', artifactId: ART })).toEqual({ target: 'drive', state: 'signedOut' });
    expect(gws.state.mock.calls[0]!.slice(0, 2)).toEqual(['/scratch/bin/gws', { PATH: '/scratch/bin', HOME: '/scratch/home' }]);
  });

  it('runs gws’s own login for Drive, its URL opened by MAWS; a refused login answers refused and stores nothing', async () => {
    gws.state.mockResolvedValue({ state: 'signedOut' });
    gws.login.mockImplementationOnce(async (_bin, _env, opts: { openUrl(url: string): void }) => {
      opts.openUrl('https://accounts.google.com/o/oauth2/auth?x=1');
      return { ok: false, why: 'refused', message: 'OAuth flow failed: access_denied' };
    });
    const openExternal = vi.fn(async () => ({ opened: true as const }));
    start({ port: { openExternal } });
    expect(await call('delivery.connect', { runId: RUN(), target: 'drive', artifactId: ART })).toEqual({ ok: false, why: 'refused', message: 'OAuth flow failed: access_denied' });
    expect(openExternal).toHaveBeenCalledWith(CLIENT, { url: 'https://accounts.google.com/o/oauth2/auth?x=1' }); // the asking client's browser
    expect(gws.login.mock.calls[0]![2]).not.toHaveProperty('scopes'); // a first sign-in asks for Drive alone (-s drive)
  });

  it('a sign-in lacking Drive keeps its scopes and adds Drive; one needing setup is not started', async () => {
    gws.state.mockResolvedValueOnce({ state: 'noDrive', scopes: ['https://www.googleapis.com/auth/gmail.modify'] });
    await call('delivery.connect', { runId: RUN(), target: 'drive', artifactId: ART });
    expect(gws.login.mock.calls[0]![2].scopes).toEqual(['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/drive']);
    gws.state.mockResolvedValueOnce({ state: 'needsSetup' });
    expect(await call('delivery.connect', { runId: RUN(), target: 'drive', artifactId: ART })).toEqual({ ok: false, why: 'needsSetup' });
    expect(gws.login).toHaveBeenCalledTimes(1);
  });

  it('a cancel ends a login under way', async () => {
    gws.login.mockImplementationOnce((_bin, _env, opts: { signal: AbortSignal }) => new Promise((resolve) => opts.signal.addEventListener('abort', () => resolve({ ok: false, why: 'cancelled' }))));
    const runId = RUN();
    const pending = call('delivery.connect', { runId, target: 'drive', artifactId: ART });
    await vi.waitFor(() => expect(gws.login).toHaveBeenCalled());
    expect(await call('delivery.cancel', { runId })).toEqual({ cancelled: true });
    expect(await pending).toEqual({ ok: false, why: 'cancelled' });
  });

  it('uploads the owner’s format under the artifact’s title, into a named folder, and removes the export', async () => {
    const answer = await sendDrive({ destination: { kind: 'inside', id: '1AbCdEfGhIjKlMn' } });
    expect(gws.upload).toHaveBeenCalledTimes(1);
    const [bin, env, opts] = gws.upload.mock.calls[0]!;
    expect([bin, env]).toEqual(['/scratch/bin/gws', { PATH: '/scratch/bin', HOME: '/scratch/home' }]);
    expect(opts).toMatchObject({ file: expect.stringMatching(/\/artifacts\/11111111-1111-4111-8111-111111111111\/exports\/7-docx-[0-9a-f-]{36}\.docx$/), name: 'Quarterly memo.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parent: '1AbCdEfGhIjKlMn' });
    expect(answer).toMatchObject({ ok: true, receipt: { target: 'drive', name: 'Quarterly memo.docx', url: 'https://drive.google.com/file/d/f1/view', format: 'docx' } });
    expect(answer).toMatchObject({ receipt: { revision: 7 } }); // the revision main exported, as it named it
    expect(removed()).toBe(true);
  });

  it('uploads a design’s PNG under its own type (P4-B5 review)', async () => {
    await sendDrive({ format: 'png', board: 'b2' });
    expect(gws.upload.mock.calls[0]![2]).toMatchObject({ mime: 'image/png', name: 'Quarterly memo.png' });
  });

  it('uploads only from gws’s own ready sign-in: signed out, expired or without Drive is auth, the export removed', async () => {
    for (const state of [{ state: 'signedOut' }, { state: 'expired' }, { state: 'noDrive', scopes: [] }]) {
      gws.state.mockResolvedValueOnce(state);
      expect(await sendDrive()).toEqual({ ok: false, why: 'auth' });
    }
    gws.state.mockResolvedValueOnce({ state: 'needsSetup' });
    expect(await sendDrive()).toEqual({ ok: false, why: 'needsSetup' });
    expect(removed()).toBe(true);
    expect(gws.upload).not.toHaveBeenCalled();
  });

  it('words gws’s failures; one that may follow the upload as maybeSent', async () => {
    gws.upload.mockResolvedValueOnce({ ok: false, why: 'auth', message: 'Token expired' });
    expect(await sendDrive()).toEqual({ ok: false, why: 'auth', message: 'Token expired' });
    gws.upload.mockResolvedValueOnce({ ok: false, why: 'notFound', message: 'File not found: folder' });
    expect(await sendDrive()).toEqual({ ok: false, why: 'notFound', message: 'File not found: folder' });
    gws.upload.mockResolvedValueOnce({ ok: false, why: 'timeout' });
    expect(await sendDrive()).toEqual({ ok: false, why: 'timeout', maybeSent: true });
  });
});

// P5 O4 M2 (Interfaces §G, D14): what main hands over is admitted only as the artifact's own export
describe('the export’s admission', () => {
  const handOver = (exportPath: string, extra: Record<string, unknown> = {}) =>
    call('delivery.deliver', { runId: RUN(), target: 'drive', artifactId: ART, format: 'docx', destination: { kind: 'default' }, exportPath, revision: 7, title: 'Quarterly memo', ...extra });
  const elsewhere = (name: string) => {
    mkdirSync(join(dir, 'elsewhere'), { recursive: true });
    const path = join(dir, 'elsewhere', name);
    writeFileSync(path, 'bytes');
    return path;
  };

  it('admits the artifact’s own export in the grammar for its format and revision, by its canonical path', async () => {
    const path = plant('docx');
    expect(await admitExport(artifactsRoot, { artifactId: ART, format: 'docx', revision: 7, exportPath: path })).toMatch(/\/exports\/7-docx-[0-9a-f-]{36}\.docx$/);
  });

  it.each([
    ['outside the exports directory', () => elsewhere(artifactExportName(7, 'docx', crypto.randomUUID()))],
    ['another artifact’s export', () => plant('docx', 7, OTHER_ART)],
    ['a name outside the export grammar', () => { const path = join(plant('docx'), '..', 'notes.docx'); writeFileSync(path, 'bytes'); return path; }],
    ['a name for another format', () => plant('pdf')],
    ['a name for another revision', () => plant('docx', 6)],
    ['a path that is not normal', () => { const path = plant('docx'); return path.replace('/exports/', '/exports/../exports/'); }],
    ['a name with no export id', () => { const path = join(artifactsRoot, ART, 'exports', '7-docx.docx'); mkdirSync(join(artifactsRoot, ART, 'exports'), { recursive: true }); writeFileSync(path, 'bytes'); return path; }],
    ['a link in place of the file', () => {
      const target = elsewhere('secret.docx');
      mkdirSync(join(artifactsRoot, ART, 'exports'), { recursive: true });
      const path = join(artifactsRoot, ART, 'exports', artifactExportName(7, 'docx', crypto.randomUUID()));
      symlinkSync(target, path);
      return path;
    }],
    ['a link in place of the exports directory', () => {
      mkdirSync(join(dir, 'elsewhere', 'exports'), { recursive: true });
      mkdirSync(join(artifactsRoot, ART), { recursive: true });
      symlinkSync(join(dir, 'elsewhere', 'exports'), join(artifactsRoot, ART, 'exports'));
      const path = join(artifactsRoot, ART, 'exports', artifactExportName(7, 'docx', crypto.randomUUID()));
      writeFileSync(path, 'bytes');
      return path;
    }],
    ['a directory', () => { const path = join(artifactsRoot, ART, 'exports', artifactExportName(7, 'docx', crypto.randomUUID())); mkdirSync(path, { recursive: true }); return path; }],
    ['nothing at all', () => join(artifactsRoot, ART, 'exports', artifactExportName(7, 'docx', crypto.randomUUID()))],
  ])('refuses %s: answers export, sends nothing and leaves the path alone', async (_why, make) => {
    const path = make();
    const before = existsSync(path);
    expect(await handOver(path)).toEqual({ ok: false, why: 'export' });
    expect(gws.upload).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(before);
  });
});

// P5 O4 M2 (D15): main's hand-off is under way when the owner cancels; the run's start answers for it
describe('a cancel ahead of its run', () => {
  it('is a tombstone: the run that arrives answers cancelled, sends nothing, and its export is removed', async () => {
    const runId = RUN();
    expect(await call('delivery.cancel', { runId })).toEqual({ cancelled: true });
    expect(await sendNotion({ runId })).toEqual({ ok: false, why: 'cancelled' });
    expect(connectors.send).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(removed()).toBe(true);
  });

  it('is consumed by its run: the same run id runs afterwards', async () => {
    const runId = RUN();
    await call('delivery.cancel', { runId });
    expect(await sendDrive({ runId })).toEqual({ ok: false, why: 'cancelled' });
    expect(await sendDrive({ runId })).toMatchObject({ ok: true });
  });

  it('holds for a Connect too', async () => {
    const runId = RUN();
    await call('delivery.cancel', { runId });
    expect(await call('delivery.connect', { runId, target: 'drive', artifactId: ART })).toEqual({ ok: false, why: 'cancelled' });
    expect(gws.login).not.toHaveBeenCalled();
  });

  it('a cancel for a run that already ended answers false and leaves no tombstone', async () => {
    const runId = RUN();
    expect(await sendDrive({ runId })).toMatchObject({ ok: true });
    expect(await call('delivery.cancel', { runId })).toEqual({ cancelled: false });
  });

  it('keeps a bounded number of tombstones, the oldest dropped first', async () => {
    const first = RUN();
    await call('delivery.cancel', { runId: first });
    for (let i = 0; i < DELIVERY_RECEIPT_LIMIT; i++) await call('delivery.cancel', { runId: RUN() });
    expect(await sendDrive({ runId: first })).toMatchObject({ ok: true }); // its tombstone was dropped
  });

  it('after the stop, tombstones are gone and a cancel answers false', async () => {
    const runId = RUN();
    await call('delivery.cancel', { runId });
    stop();
    expect(await call('delivery.cancel', { runId: RUN() })).toEqual({ cancelled: false });
  });
});
