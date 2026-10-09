import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { recordDownload } from './downloads';
import { MemoryDeliverableStore } from './store';

const A = 'app-1' as AppSessionId;
const at = () => '2026-10-08T10:00:00.000Z';
const download = { appSessionId: A, tabId: 'b_000000000001', path: '/Users/x/Downloads/cua-report.pdf', filename: 'cua-report.pdf', url: 'http://127.0.0.1:5000/report.pdf', bytes: 7741 };

describe('recordDownload (E13: an agent\'s finished download as a file deliverable)', () => {
  it('writes one file record for the path, titled with the filename, the source URL kept, and announces it', async () => {
    const written: string[] = [];
    const store = new MemoryDeliverableStore({ onWritten: (record, change) => written.push(`${record.kind}:${change}`) });
    expect(await recordDownload(store, download, { now: at, id: () => '00000000-0000-4000-8000-000000000001' })).toBe('recorded');
    expect(store.records).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001', appSessionId: A, kind: 'file', path: download.path, title: 'cua-report.pdf',
        versions: [{ path: download.path, at: at() }], createdAt: at(), sourceUrl: download.url,
      },
    ]);
    expect(written).toEqual(['file:created']);
  });

  it('records a path once: a second report of the same path is a duplicate and writes nothing', async () => {
    const store = new MemoryDeliverableStore();
    expect(await recordDownload(store, download, { now: at })).toBe('recorded');
    expect(await recordDownload(store, { ...download, tabId: 'b_000000000002' }, { now: at })).toBe('duplicate');
    expect(store.records).toHaveLength(1);
  });

  it('two reports of one path at once still record it once (the session\'s write chain)', async () => {
    const store = new MemoryDeliverableStore();
    const outcomes = await Promise.all([recordDownload(store, download, { now: at }), recordDownload(store, download, { now: at })]);
    expect(outcomes.sort()).toEqual(['duplicate', 'recorded']);
    expect(store.records).toHaveLength(1);
  });

  it('keeps no source URL that is not an http(s) URL of sane length (a data: or blob: download)', async () => {
    const store = new MemoryDeliverableStore();
    await recordDownload(store, { ...download, url: `data:application/pdf;base64,${'A'.repeat(64)}` }, { now: at });
    await recordDownload(store, { ...download, path: '/Users/x/Downloads/b.pdf', url: `https://example.com/${'a'.repeat(3000)}` }, { now: at });
    expect(store.records.map((record) => record.sourceUrl)).toEqual([undefined, undefined]);
  });
});
