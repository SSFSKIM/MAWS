// No notification for a refusal read from the transcript (UX wave U2, the U2a execution document's M1, the architect's
// ruling R3 of 2026-11-13): the attention service's own test beside it (`src/services/attention/file-denial.test.ts`)
// holds what it publishes; this one drives that service and the notifier together, every publication of the service
// handed to the notifier's view as the spine hands it, and counts what the notifier raises. A call refused as
// `automode-unavailable` read from a file's backfill or a rebuild from the transcript, in one batch or split after the
// refused result, raises nothing; the same refusal over the wire raises its notification, as today.
import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName } from '@shared/ipc/schema';
import type { ClientPort, NotifyRequest } from '@shared/client/port';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { record } from '../../../test/support/builders';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { batchingsOf, fileBackfillEvents, reseedEvents, wireEvents } from '../../../test/support/file-denial';
import { startAttentionService, type AttentionServiceDeps } from '../../services/attention/service';
import { startNotifier } from './notifier';

const APP = 'app-file-denial' as AppSessionId;

async function serviceAndNotifier() {
  const view = fakeSpineView({ records: [record(APP, { title: { text: 'Preview build', source: 'user' } })] });
  const posted: NotifyRequest[] = [];
  const port: Pick<ClientPort, 'notify' | 'badge' | 'focus'> = {
    notify: (_client, request) => {
      posted.push(request);
      return { close: () => {} } as unknown as ReturnType<ClientPort['notify']>;
    },
    badge: vi.fn(),
    focus: vi.fn(),
  };
  const stopNotifier = startNotifier(view, { port, isFocused: () => false, isViewing: () => false, navigate: vi.fn(), failure: vi.fn(), settings: () => SETTINGS_DEFAULTS_V21, emit: vi.fn(() => true) });
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const published: AttentionItem[][] = [];
  const service = startAttentionService({
    onEvent: ((name: EventName, listener: (payload: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => {};
    }) as AttentionServiceDeps['onEvent'],
    onState: () => () => {},
    dispatch: async () => ({ ok: true as const, value: { event: null } }),
    store: { list: async () => [], replaceForSession: async () => {}, retireForSession: async () => {} },
    emit: ((name: EventName, payload: unknown) => {
      if (name !== 'attention.changed') return true;
      const change = payload as { appSessionId: AppSessionId; items: AttentionItem[]; silent?: AttentionItem['id'][] };
      published.push(change.items);
      view.setAttention(change.appSessionId, change.items, change.silent ?? []);
      return true;
    }) as AttentionServiceDeps['emit'],
    register: (() => {}) as AttentionServiceDeps['register'],
    log: () => {},
  });
  await service.ready;
  const batch = (events: SessionEvent[]) => listeners.get('session.eventBatch')?.forEach((listener) => listener({ appSessionId: APP, events }));
  const stop = () => {
    service.stop();
    stopNotifier();
  };
  return { batch, posted, published, stop };
}

describe('a refusal read from the transcript notifies nothing', () => {
  for (const { route, events } of [{ route: 'a file’s backfill', events: fileBackfillEvents() }, { route: 'a rebuild from the transcript', events: reseedEvents() }]) {
    for (const { name, batches } of batchingsOf(events)) {
      it(`${route}, ${name}`, async () => {
        const { batch, posted, published, stop } = await serviceAndNotifier();
        for (const events of batches) {
          batch(events);
          expect(posted).toEqual([]);
        }
        expect(published).toEqual([]);
        stop();
      });
    }
  }
});

describe('the same refusal over the wire notifies, as today', () => {
  it('one notification, for its item', async () => {
    const { batch, posted, published, stop } = await serviceAndNotifier();
    batch(wireEvents());
    expect(published.map((items) => items.map((item) => item.kind))).toEqual([['auto_mode_unavailable']]);
    expect(posted).toHaveLength(1);
    stop();
  });
});
