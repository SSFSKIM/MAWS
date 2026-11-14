// Attention does not change when a file says what kind of refusal a result was (UX wave U2, the U2a execution document's
// M1, the architect's ruling R3 of 2026-11-13). The file reader now reads a refused row's `toolDenialKind`, so a file's
// history and a rebuild from the transcript carry `automode-unavailable` where they carried no kind; the service raises
// `auto_mode_unavailable` only for a result that came over the wire as its own frame (`seq` set, not `reseeded`). Each
// case asserts every `attention.changed` the service emits and every write to its store, not the final list alone; the
// notifications are the notifier's test beside it (`src/main/attention/file-denial.test.ts`: this library imports
// nothing of main).
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName } from '@shared/ipc/schema';
import { batchingsOf, fileBackfillEvents, REFUSED_CALL, reseedEvents, wireEvents } from '../../../test/support/file-denial';
import { startAttentionService, type AttentionServiceDeps } from './service';
import type { AttentionStore } from './store';

const APP = 'app-file-denial' as AppSessionId;

/** The service over a store that records every write, its `attention.changed` emits recorded. */
async function serviceOver() {
  const writes: { op: 'replace' | 'retire'; items?: AttentionItem[] }[] = [];
  const store: AttentionStore = {
    list: async () => [],
    replaceForSession: async (_id, items) => void writes.push({ op: 'replace', items }),
    retireForSession: async () => void writes.push({ op: 'retire' }),
  };
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const emits: { appSessionId: string; items: AttentionItem[] }[] = [];
  const service = startAttentionService({
    onEvent: ((name: EventName, listener: (payload: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => {};
    }) as AttentionServiceDeps['onEvent'],
    onState: () => () => {},
    dispatch: async () => ({ ok: true as const, value: { event: null } }),
    store,
    emit: ((name: EventName, payload: unknown) => {
      if (name === 'attention.changed') emits.push(payload as { appSessionId: string; items: AttentionItem[] });
      return true;
    }) as AttentionServiceDeps['emit'],
    register: (() => {}) as AttentionServiceDeps['register'],
    log: () => {},
  });
  await service.ready;
  const batch = (events: SessionEvent[]) => listeners.get('session.eventBatch')?.forEach((listener) => listener({ appSessionId: APP, events }));
  return { service, writes, emits, batch };
}

describe('a call refused as automode-unavailable, read from the transcript, raises no attention', () => {
  const routes = [
    { route: 'a file’s backfill (`seq: null`)', events: fileBackfillEvents() },
    { route: 'a rebuild from the transcript (`transcript_reseed`: a `seq`, `reseeded`)', events: reseedEvents() },
  ];

  it('the file reader now gives the refused result its kind on both routes, which is what the service reads', () => {
    for (const { route, events } of routes) {
      const refused = events.find((e) => e.kind === 'tool.result' && e.toolUseId === REFUSED_CALL);
      expect(refused, route).toMatchObject({ kind: 'tool.result', denial: 'automode-unavailable' });
    }
    expect(fileBackfillEvents().every((e) => e.seq === null)).toBe(true);
    expect(reseedEvents().every((e) => e.seq !== null && e.reseeded === true)).toBe(true);
  });

  for (const { route, events } of routes) {
    for (const { name, batches } of batchingsOf(events)) {
      it(`${route}, ${name}: nothing is published and nothing is written, at any point`, async () => {
        const { service, writes, emits, batch } = await serviceOver();
        for (const events of batches) {
          batch(events);
          expect(service.list().filter((item) => item.kind === 'auto_mode_unavailable')).toEqual([]);
        }
        await service.settled();
        expect(emits).toEqual([]);
        expect(writes).toEqual([]);
        service.stop();
      });
    }
  }
});

describe('the same refusal over the wire raises its item, as today', () => {
  it('one `attention.changed` with the item, and one write of it', async () => {
    const { service, writes, emits, batch } = await serviceOver();
    const events = wireEvents();
    expect(events.find((e) => e.kind === 'tool.result')).toMatchObject({ denial: 'automode-unavailable', seq: 2 });
    batch(events);
    await service.settled();
    expect(emits.map((e) => e.items.map((item) => [item.kind, item.request.toolUseId]))).toEqual([[['auto_mode_unavailable', REFUSED_CALL]]]);
    expect(writes.map((w) => [w.op, w.items?.map((item) => item.kind)])).toEqual([['replace', ['auto_mode_unavailable']]]);
    service.stop();
  });
});
