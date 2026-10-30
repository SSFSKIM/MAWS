// @vitest-environment happy-dom
// Each push landing on a session's cards checks its machine again (P5 O13 M6b, review round 1): a tap on the same
// `/cards/<ref>/<session>` reuses the open view, and a machine its org state still does not resolve (a VM certified
// since the last read) is read for again at every landing, the org store's once-a-minute throttle alone bounding the
// reads. The device's part is stood in for: what is counted is what the view asks of it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../hub/me';
import { useCardsBoard } from '../../cards/board';
import { land } from '../../pwa/service-worker';
import { useDeskLayout } from '../../shell/layout';
import { ChannelCards } from './ChannelCards';

const refreshOrg = vi.hoisted(() => vi.fn());
vi.mock('../../cards/start', () => ({ refreshOrg, deviceOrgStore: () => null, listingsStore: () => null }));
vi.mock('../../cards/boot', () => ({ bootDevice: () => Promise.resolve() }));

const VM = 'dlg_b0Rj6m2xQ4uVv1n8T3kZfA';
const me = { org: { id: 'org-1', name: 'org' }, member: { id: 'm1', email: 'owner@example.com' } } as unknown as Me;
const landing = () => new URL(`https://desk.example/cards/${encodeURIComponent(VM)}/app-1`);
const readsFor = (reason: string) => refreshOrg.mock.calls.filter(([r]) => r === reason).length;

beforeEach(() => {
  refreshOrg.mockClear();
  useCardsBoard.setState({ watching: true, machines: [{ ref: 'ref-mini', name: 'mini', online: true, sessions: [] }] });
});
afterEach(() => {
  cleanup();
  useCardsBoard.setState({ watching: false, machines: [] });
});

describe("a push landing on a session's cards", () => {
  it('reads the org state for an unresolved machine at every landing, the same view open', () => {
    act(() => land(landing(), true));
    const route = useDeskLayout.getState().route;
    expect(route).toEqual({ view: 'cards', machine: VM, session: 'app-1' });
    render(<ChannelCards me={me} machine={VM} session="app-1" onDevice={() => {}} />);
    expect(readsFor(VM)).toBe(1);
    act(() => land(landing(), true)); // a second tap: the same view, its props unchanged
    expect(readsFor(VM)).toBe(2);
  });

  it('reads nothing at a landing on a machine the org state resolves', () => {
    render(<ChannelCards me={me} machine="ref-mini" session="la-1" onDevice={() => {}} />);
    act(() => land(new URL('https://desk.example/cards/ref-mini/la-1'), true));
    expect(readsFor('ref-mini')).toBe(0);
  });
});
