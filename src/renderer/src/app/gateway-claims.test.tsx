// C4 gives every session it discovers on disk `gateway.routed: null` (X1 amended in wave 1: unknown, no verification ran;
// until then it was a default `true`, C5 document, Decision Log "rebase signal"). Routing may be presented only from a
// live engine status whose `gateway.verified` is `routed` or `direct`, or from a record whose flag is not null. The shell
// presents routing nowhere today; this pins that a discovered record never surfaces as a claim in the sidebar, an
// Overview card or the status line, whatever its flag says.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { Overview } from '../overview/Overview';
import { SessionPane } from '../session/SessionPane';
import { Sidebar } from '../sidebar/Sidebar';
import { useSessions } from '../stores/sessions';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';

const CLAIM = /gateway|routed|relay|direct/i;

function claims(root: HTMLElement): string[] {
  const texts = [root.textContent ?? ''];
  for (const el of root.querySelectorAll('[aria-label], [title]')) texts.push(el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '');
  return texts.filter((text) => CLAIM.test(text));
}

beforeEach(() => {
  resetShellStores();
  window.maws = fakeClient({ 'attention.request': { event: null } }).client;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

describe('gateway routing is never read from the record', () => {
  it.each([null, true])('a discovered record with routed: %s and no engine status makes no routing claim anywhere', (routed) => {
    const nine = scenarioFile('nine-sessions');
    const discovered = nine.sessions.map((r) => ({ ...r, gateway: { routed, baseUrl: null, autoModeServer: 'unknown' as const } }));
    fillStores({ ...nine, sessions: discovered });
    expect(useSessions.getState().engine.size).toBe(0);
    const working = discovered.find((r) => r.title.text === 'Charter + research')!.appId;
    const { container } = render(
      <>
        <Sidebar />
        <Overview paneIndex={0} />
        <SessionPane appSessionId={working} paneIndex={0} />
      </>,
    );
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('article').length).toBeGreaterThan(0);
    expect(claims(container)).toEqual([]);
  });
});
