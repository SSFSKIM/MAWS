// The partitioned (CHIPS) route (E4b Design §8; A-33 item 8): the import view in the partition, E4a's TabDebugger with
// no observer, every row through `send('Network.setCookie')`, one `Network.getAllCookies` to verify, the view destroyed
// on every exit. The rows come from the synthetic profile's decoder, so what reaches CDP is what an import would send.
import { createCipheriv } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildChromeUserData, type ChromeUserData } from '../../../../test/support/chrome-profile';
import { TabDebugger } from '../debugger';
import { deriveKey, hostHash } from './chrome/crypto';
import { decodeCookieRow, readCookieRows, type ChromeCookieRow, type NetworkSetCookieParams } from './chrome/cookies';
import { importPartitionedCookies, type ImportView, type PartitionedCookie } from './chips-import';

vi.mock('electron', () => ({
  WebContentsView: class {
    constructor(readonly options: unknown) {}
  },
}));

const PARTITION = 'persist:maws-chrome-Default';
let root: string;
let fixture: ChromeUserData;
let rows: ChromeCookieRow[];
let version: number;
let key: Buffer;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-e4b-chips-'));
  fixture = buildChromeUserData(join(root, 'Chrome'));
  key = deriveKey(fixture.password);
  const db = new DatabaseSync(fixture.profiles.Default.cookies.file);
  try {
    ({ rows, storeVersion: version } = readCookieRows(db));
  } finally {
    db.close();
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const v10 = (plaintext: Buffer) => {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()]);
};
afterEach(() => {
  vi.restoreAllMocks();
});

// A partitioned decode of the fixture's `__Host-part` row, or of a variant of it.
// A row on another host_key is encrypted again, since a version-24 value carries SHA-256(host_key).
function partitioned(over: Partial<ChromeCookieRow> = {}): PartitionedCookie {
  const encryptedValue = over.hostKey === undefined ? {} : { encryptedValue: v10(Buffer.concat([hostHash(over.hostKey), Buffer.from('e4b-sentinel-cookie-variant')])) };
  const decode = decodeCookieRow({ ...rows.find((row) => row.name === '__Host-part')!, ...over, ...encryptedValue }, key, version);
  if (decode.kind !== 'partitioned') throw new Error(`expected a partitioned decode, got ${decode.kind}`);
  return { cdp: decode.cdp, host: decode.host };
}

interface CdpCookie {
  name: string;
  domain: string;
  path: string;
  partitionKey?: { topLevelSite: string; hasCrossSiteAncestor: boolean } | string;
}

// A fake view: its debugger answers Page.getFrameTree (the TabDebugger's attach), records Network.setCookie, and lists
// what was set for Network.getAllCookies (as Chromium does: a host-only cookie under its host, undotted).
function fakeView({
  refuse = () => false,
  list = (set) => set.map((params) => ({ name: params.name, domain: params.domain ?? new URL(params.url).hostname, path: params.path, partitionKey: params.partitionKey })),
  failLoad = false,
  failList = false,
}: {
  refuse?: (params: NetworkSetCookieParams) => boolean;
  list?: (set: NetworkSetCookieParams[]) => CdpCookie[];
  failLoad?: boolean;
  failList?: boolean;
} = {}) {
  const set: NetworkSetCookieParams[] = [];
  const sent: string[] = [];
  let attached = false;
  let destroyed = false;
  const dbg = {
    attach: vi.fn(() => void (attached = true)),
    isAttached: () => attached,
    detach: vi.fn(() => void (attached = false)),
    on: vi.fn(),
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (destroyed) throw new Error('target closed');
      sent.push(method);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } };
      if (method === 'Network.setCookie') {
        if (refuse(params as unknown as NetworkSetCookieParams)) throw new Error('Sanitizing cookie failed');
        set.push(params as unknown as NetworkSetCookieParams);
        return { success: true };
      }
      if (method === 'Network.getAllCookies') {
        if (failList) throw new Error('getAllCookies failed');
        return { cookies: list(set) };
      }
      throw new Error(`unexpected ${method}`);
    }),
  };
  const webContents = {
    debugger: dbg as unknown as Electron.Debugger,
    isDestroyed: () => destroyed,
    loadURL: vi.fn(async () => {
      if (failLoad) throw new Error('ERR_FAILED');
    }),
    close: vi.fn(() => void (destroyed = true)),
  };
  const view: ImportView = { webContents };
  const createView = vi.fn<(partition: string) => ImportView>(() => view);
  return { createView, webContents, dbg, set, sent };
}

const run = (cookies: PartitionedCookie[], view: ReturnType<typeof fakeView>, signal = new AbortController().signal) =>
  importPartitionedCookies({ partition: PARTITION, cookies, createView: view.createView, signal, progress: () => {} });

describe('importPartitionedCookies', () => {
  it('sets the fixture’s __Host- row through Network.setCookie, host-only (no domain), and verifies it', async () => {
    const view = fakeView();
    const cookie = partitioned();
    const result = await run([cookie], view);
    expect(view.createView).toHaveBeenCalledWith(PARTITION);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('about:blank');
    expect(view.set).toEqual([
      {
        name: '__Host-part',
        value: fixture.profiles.Default.cookies.entries.find((entry) => entry.name === '__Host-part')!.value,
        url: 'https://embed.test/',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'None',
        expires: expect.any(Number),
        partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: true },
      },
    ]);
    expect(view.set[0]).not.toHaveProperty('domain');
    expect(view.sent).toEqual(['Page.getFrameTree', 'Network.setCookie', 'Network.getAllCookies']);
    expect(result).toEqual({ imported: 1, verified: 1, rejected: [], notVerified: [], cancelled: 0, error: null });
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    expect(view.dbg.detach).toHaveBeenCalled();
  });

  it('keeps `domain` for a dotted host_key, maps SameSite to CDP’s words, and sends none for Chrome’s unspecified', async () => {
    const view = fakeView();
    const cookies = [
      partitioned({ name: 'dotted', hostKey: '.embed.test', sameSite: 1 }),
      partitioned({ name: 'strict', sameSite: 2 }),
      partitioned({ name: 'unspecified', sameSite: -1 }),
    ];
    const result = await run(cookies, view);
    expect(view.set.map((params) => [params.name, params.domain, params.sameSite])).toEqual([
      ['dotted', '.embed.test', 'Lax'],
      ['strict', undefined, 'Strict'],
      ['unspecified', undefined, undefined],
    ]);
    expect(view.set[2]).not.toHaveProperty('sameSite');
    expect(result.verified).toBe(3);
  });

  it('verifies dot-insensitively on name, domain, path and the partition’s top-level site', async () => {
    const cookies = [partitioned({ name: 'a', hostKey: '.embed.test' }), partitioned({ name: 'b' }), partitioned({ name: 'c' }), partitioned({ name: 'd' })];
    const view = fakeView({
      list: (set) => [
        { name: 'a', domain: 'embed.test', path: '/', partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: true } }, // dot dropped
        { name: 'b', domain: '.embed.test', path: '/', partitionKey: 'https://example.test' }, // an older CDP's string key
        { name: 'c', domain: 'embed.test', path: '/', partitionKey: { topLevelSite: 'https://other.test', hasCrossSiteAncestor: true } }, // another partition
        { name: 'd', domain: 'embed.test', path: '/' }, // unpartitioned: not this row
      ].filter((cookie) => set.some((params) => params.name === cookie.name)),
    });
    const result = await run(cookies, view);
    expect(result).toEqual({ imported: 4, verified: 2, rejected: [], notVerified: ['embed.test', 'embed.test'], cancelled: 0, error: null });
  });

  it('counts a row Chromium refuses as rejected, by its host, and carries on', async () => {
    const view = fakeView({ refuse: (params) => params.name === 'bad' });
    const result = await run([partitioned({ name: 'bad' }), partitioned({ name: 'good' })], view);
    expect(result).toMatchObject({ imported: 1, verified: 1, rejected: ['embed.test'], cancelled: 0, error: null });
  });

  it('counts a set row not listed by Network.getAllCookies as not verified', async () => {
    const view = fakeView({ list: () => [] });
    expect(await run([partitioned()], view)).toEqual({ imported: 1, verified: 0, rejected: [], notVerified: ['embed.test'], cancelled: 0, error: null });
  });

  it('destroys the view when the verification throws, the set rows left unverified', async () => {
    const view = fakeView({ failList: true });
    expect(await run([partitioned()], view)).toEqual({ imported: 1, verified: 0, rejected: [], notVerified: ['embed.test'], cancelled: 0, error: 'importViewFailed' });
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
  });

  it('destroys the view when it cannot load, every row rejected', async () => {
    const view = fakeView({ failLoad: true });
    expect(await run([partitioned(), partitioned({ name: 'b' })], view)).toEqual({
      imported: 0, verified: 0, rejected: ['embed.test', 'embed.test'], notVerified: [], cancelled: 0, error: 'importViewFailed',
    });
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
    expect(view.sent).toEqual([]);
  });

  it('on abort stops at the next row, counts the rest cancelled, skips the verification and destroys the view at once', async () => {
    const controller = new AbortController();
    const view = fakeView({
      refuse: (params) => {
        if (params.name === 'first') controller.abort(); // the owner cancels while the first row is in flight
        return false;
      },
    });
    const result = await run([partitioned({ name: 'first' }), partitioned({ name: 'second' }), partitioned({ name: 'third' })], view, controller.signal);
    expect(result).toEqual({ imported: 1, verified: 0, rejected: [], notVerified: ['embed.test'], cancelled: 2, error: null });
    expect(view.sent).not.toContain('Network.getAllCookies');
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
  });

  it('never observes the debugger’s commands (no row reaches a log)', async () => {
    const observe = vi.spyOn(TabDebugger.prototype, 'onCommand');
    await run([partitioned()], fakeView());
    expect(observe).not.toHaveBeenCalled();
  });

  it('creates the real import view in the partition, sandboxed and without a preload', async () => {
    const { createImportView } = await import('./chips-import');
    const view = createImportView(PARTITION) as unknown as { options: unknown };
    expect(view.options).toEqual({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  });
});
