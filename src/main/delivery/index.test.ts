// P4-B5: main's Send to service (./index.ts) over scripted seams: the export service writes a real file of its own, the
// owner delivery and the gws driver are doubles. What it proves: no session or prompt exists in its reach (its deps
// have none); Notion takes the Notion dialect and `notion-create-pages` with the title and a parent when named; Drive
// takes the owner's format through gws with the file's own name; a cancel before the write sends nothing, after it is
// refused; a failure that may follow a write says so; the export's file is removed whatever happened; receipts are
// kept per artifact and target and broadcast; and the CLI's absence and a refused login are answered as such.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import type { DirectSource } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import type { OwnerDelivery } from '../connectors/owner-delivery';
import { DELIVERY_SOURCE_LIMIT, startDelivery, type DeliveryDeps, type GwsDriver } from '.';

const ART = '11111111-1111-4111-8111-111111111111';
const RUN = () => crypto.randomUUID();
const source: DirectSource = { directory: '/repo', sourceId: '22222222-2222-4222-8222-222222222222', generation: 1, server: 'notion', scope: 'user', transport: 'http', path: '/h/.claude.json', entryPath: ['mcpServers', 'notion'], observedAt: '2026-10-19T00:00:00.000Z', resourceUrl: 'https://mcp.notion.com/mcp' };
const PAGE = { content: [{ type: 'text', text: JSON.stringify({ pages: [{ id: 'abc', url: 'https://www.notion.so/Quarterly-memo-0123456789abcdef0123456789abcdef', properties: { title: 'Quarterly memo' } }] }) }] };

let dir: string;
let handlers: Map<string, (input: unknown) => unknown>;
let emitted: unknown[];
let exported: { input: Record<string, unknown>; options?: { dialect?: string }; path: string }[];
let connectors: { [K in keyof OwnerDelivery]: ReturnType<typeof vi.fn> };
let gws: { [K in keyof GwsDriver]: ReturnType<typeof vi.fn> };
let stop: () => void;
let artifact: { title: string } | null;

function start(overrides: Partial<DeliveryDeps> = {}) {
  handlers = new Map();
  stop = startDelivery({
    register: ((name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as never,
    emit: (name, payload) => (emitted.push({ name, payload }), true),
    exportArtifact: async (input, options) => {
      const path = join(dir, `1-${input.format}-${crypto.randomUUID()}.${input.format}`);
      writeFileSync(path, options?.dialect === 'notion' ? '# Notion body' : 'bytes');
      exported.push({ input: input as never, ...(options && { options }), path });
      return { path, revision: 7, exportId: 'e' };
    },
    call: (async () => ({ ok: true, value: { artifact } })) as never,
    connectors: connectors as unknown as OwnerDelivery,
    shellEnv: async () => ({ PATH: '/scratch/bin', HOME: '/scratch/home' }),
    openExternal: vi.fn(() => true),
    gws: gws as unknown as GwsDriver,
    now: () => 1_000,
    log: () => {},
    ...overrides,
  }).stop;
}

async function call(name: CommandName, input: unknown): Promise<unknown> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}: ${JSON.stringify(checked.error)}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-b5-delivery-'));
  emitted = [];
  exported = [];
  artifact = { title: 'Quarterly memo' };
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

const sendNotion = (extra: Record<string, unknown> = {}) => call('delivery.send', { runId: RUN(), target: 'notion', artifactId: ART, format: 'md', destination: { kind: 'default' }, ...extra });
const sendDrive = (extra: Record<string, unknown> = {}) => call('delivery.send', { runId: RUN(), target: 'drive', artifactId: ART, format: 'docx', destination: { kind: 'default' }, ...extra });

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

  it('sends the Notion dialect as a page titled by the artifact, private by default, inside a named page', async () => {
    const answer = await sendNotion();
    expect(exported[0]).toMatchObject({ input: { artifactId: ART, format: 'md', ownFile: true }, options: { dialect: 'notion' } });
    expect(connectors.send.mock.calls[0]![1]).toEqual({ artifactId: ART, tool: 'notion-create-pages', arguments: { pages: [{ properties: { title: 'Quarterly memo' }, content: '# Notion body' }], allow_async: false } });
    expect(answer).toEqual({ ok: true, receipt: { artifactId: ART, target: 'notion', at: 1_000, name: 'Quarterly memo', url: 'https://www.notion.so/Quarterly-memo-0123456789abcdef0123456789abcdef', format: 'md', revision: 7, destination: { kind: 'default' } } });
    await sendNotion({ destination: { kind: 'inside', id: '0123456789abcdef0123456789abcdef' }, versionId: 3 });
    expect(connectors.send.mock.calls[1]![1].arguments.parent).toEqual({ type: 'page_id', page_id: '0123456789abcdef0123456789abcdef' });
    expect(exported[1]!.input.versionId).toBe(3);
    expect(exported.every(({ path }) => !existsSync(path))).toBe(true); // each export's own file removed
  });

  it('keeps the latest receipt per artifact and target and broadcasts each', async () => {
    await sendNotion();
    await sendDrive();
    expect(emitted.map((event) => (event as { name: string }).name)).toEqual(['delivery.receipt', 'delivery.receipt']);
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
    expect(emitted).toEqual([]);
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
    let exporting!: () => void;
    start({
      exportArtifact: async (input) => {
        await new Promise<void>((resolve) => (exporting = resolve));
        const path = join(dir, 'held.md');
        writeFileSync(path, 'x');
        exported.push({ input: input as never, path });
        return { path, revision: 1 };
      },
    });
    const runId = RUN();
    const pending = call('delivery.send', { runId, target: 'notion', artifactId: ART, format: 'md', destination: { kind: 'default' } });
    await vi.waitFor(() => expect(exporting).toBeTypeOf('function'));
    expect(await call('delivery.cancel', { runId })).toEqual({ cancelled: true });
    exporting();
    expect(await pending).toEqual({ ok: false, why: 'cancelled' });
    expect(connectors.send).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'held.md'))).toBe(false);

    start();
    let release!: () => void;
    connectors.send.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true, result: PAGE }))));
    const later = RUN();
    const sending = call('delivery.send', { runId: later, target: 'notion', artifactId: ART, format: 'md', destination: { kind: 'default' } });
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
    const pending = call('delivery.send', { runId, target: 'notion', artifactId: ART, format: 'md', destination: { kind: 'default' } });
    await vi.waitFor(() => expect(reading).toBeTypeOf('function'));
    expect(await call('delivery.cancel', { runId })).toEqual({ cancelled: true });
    reading();
    expect(await pending).toEqual({ ok: false, why: 'cancelled' });
    expect(connectors.send).not.toHaveBeenCalled();
    expect(exported.every(({ path }) => !existsSync(path))).toBe(true);
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
    expect(exported).toEqual([]);
    await sendNotion(); // no handle named: the source found now
    expect(connectors.find).toHaveBeenCalledTimes(1);
  });

  it('connects the source the sheet named through the owner delivery', async () => {
    const status = (await call('delivery.status', { target: 'notion', artifactId: ART })) as { source: { key: string } };
    expect(await call('delivery.connect', { runId: RUN(), target: 'notion', artifactId: ART, source: status.source.key })).toEqual({ ok: true });
    expect(connectors.connect.mock.calls[0]![0]).toEqual(source);
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
  it('reports gws absent, and never exports or uploads without it', async () => {
    gws.find.mockResolvedValue(null);
    expect(await call('delivery.status', { target: 'drive', artifactId: ART })).toEqual({ target: 'drive', state: 'absent' });
    expect(await sendDrive()).toEqual({ ok: false, why: 'absent' });
    expect(await call('delivery.connect', { runId: RUN(), target: 'drive', artifactId: ART })).toEqual({ ok: false, why: 'absent' });
    expect(exported).toEqual([]);
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
    const openExternal = vi.fn(() => true);
    start({ openExternal });
    expect(await call('delivery.connect', { runId: RUN(), target: 'drive', artifactId: ART })).toEqual({ ok: false, why: 'refused', message: 'OAuth flow failed: access_denied' });
    expect(openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?x=1');
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
    expect(exported[0]).toMatchObject({ input: { format: 'docx', ownFile: true } });
    expect(exported[0]).not.toHaveProperty('options');
    const [bin, env, opts] = gws.upload.mock.calls[0]!;
    expect([bin, env]).toEqual(['/scratch/bin/gws', { PATH: '/scratch/bin', HOME: '/scratch/home' }]);
    expect(opts).toMatchObject({ file: exported[0]!.path, name: 'Quarterly memo.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parent: '1AbCdEfGhIjKlMn' });
    expect(answer).toMatchObject({ ok: true, receipt: { target: 'drive', name: 'Quarterly memo.docx', url: 'https://drive.google.com/file/d/f1/view', format: 'docx' } });
    expect(existsSync(exported[0]!.path)).toBe(false);
  });

  it('exports a design’s PNG at the board the sheet names (P4-B5 review)', async () => {
    await sendDrive({ format: 'png', board: 'b2' });
    expect(exported[0]!.input).toMatchObject({ format: 'png', board: 'b2' });
    expect(gws.upload.mock.calls[0]![2]).toMatchObject({ mime: 'image/png' });
  });

  it('uploads only from gws’s own ready sign-in: signed out, expired or without Drive is auth, with nothing exported', async () => {
    for (const state of [{ state: 'signedOut' }, { state: 'expired' }, { state: 'noDrive', scopes: [] }]) {
      gws.state.mockResolvedValueOnce(state);
      expect(await sendDrive()).toEqual({ ok: false, why: 'auth' });
    }
    gws.state.mockResolvedValueOnce({ state: 'needsSetup' });
    expect(await sendDrive()).toEqual({ ok: false, why: 'needsSetup' });
    expect(exported).toEqual([]);
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
