import { describe, expect, it, vi } from 'vitest';
import { withIgnoredAcks } from './ack-filter';

type Sender = { tabId: string | undefined };
const tabOf = (sender: Sender) => sender.tabId;

describe('withIgnoredAcks (the e2e seam’s preload-less tab)', () => {
  it('drops the arm’s acknowledgement from a tab marked ignored, and passes everything else through', () => {
    const ignored = new Set<string>(['t-1']);
    const receive = vi.fn();
    const listen = withIgnoredAcks(ignored, tabOf, receive);
    const ack = { type: 'armed', epoch: 1 };
    const report = { type: 'picked', epoch: 1 };

    listen({ tabId: 't-1' }, ack);
    expect(receive).not.toHaveBeenCalled();

    listen({ tabId: 't-1' }, report); // only the acknowledgement is withheld
    listen({ tabId: 't-2' }, ack); // another tab's is not
    listen({ tabId: undefined }, ack); // no tab: the gate decides (it drops a foreign sender)
    expect(receive.mock.calls).toEqual([
      [{ tabId: 't-1' }, report],
      [{ tabId: 't-2' }, ack],
      [{ tabId: undefined }, ack],
    ]);
  });

  it('reads the set at each message, so clearing a tab lets its next acknowledgement through', () => {
    const ignored = new Set<string>(['t-1']);
    const receive = vi.fn();
    const listen = withIgnoredAcks(ignored, tabOf, receive);
    ignored.delete('t-1');
    listen({ tabId: 't-1' }, { type: 'armed', epoch: 2 });
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it('never resolves a sender while no tab is ignored (the production path costs nothing)', () => {
    const resolve = vi.fn(tabOf);
    const receive = vi.fn();
    withIgnoredAcks(new Set<string>(), resolve, receive)({ tabId: 't-1' }, { type: 'armed', epoch: 1 });
    expect(resolve).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledTimes(1);
  });
});
