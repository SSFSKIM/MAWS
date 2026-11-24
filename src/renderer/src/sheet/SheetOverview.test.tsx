// The sessions of a machine that have something on their sheet (the C3 plan's §G, "The overview"; C4's `/`): stopped
// sessions grouped apart, each with its counts and its oldest question's age, a row a real anchor where the host gives
// an address.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetSummary } from '@shared/sheet/model';
import { SheetOverview } from './SheetOverview';

afterEach(cleanup);
const summary = (session: string, extra: Partial<SheetSummary> = {}): SheetSummary => ({
  session, appSessionId: null, title: null, live: true, seq: 1, open: 1, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false, ...extra,
});
const RUNNING = summary('5eed0000-0000-4000-8000-0000000000a1', { title: 'Winter timetable import', open: 3, oldestAskedAt: new Date(Date.now() - 5 * 60_000).toISOString().replace(/\.\d+Z$/, '.000Z') });
const STOPPED = summary('5eed0000-0000-4000-8000-0000000000a2', { title: 'Fare table cleanup', live: false, open: 2, queued: 1 });
const UNKNOWN = summary('5eed0000-0000-4000-8000-0000000000a3', { live: null, open: 0, pending: 1 });
const NOTHING = summary('5eed0000-0000-4000-8000-0000000000a4', { open: 0 });

describe('SheetOverview', () => {
  it('lists the sessions with something on their sheet, the stopped ones apart, a session not in the index with the running', () => {
    render(<SheetOverview sessions={[STOPPED, RUNNING, UNKNOWN, NOTHING]} onOpen={() => {}} />);
    const running = screen.getByRole('list', { name: 'Running' });
    const stopped = screen.getByRole('list', { name: 'Stopped' });
    expect(within(running).getAllByRole('listitem').map((row) => row.getAttribute('data-sheet-session'))).toEqual([RUNNING.session, UNKNOWN.session]);
    expect(within(stopped).getAllByRole('listitem').map((row) => row.getAttribute('data-sheet-session'))).toEqual([STOPPED.session]);
    expect(screen.queryByText(/a4/)).toBeNull();
  });

  it("draws each session's title, counts and oldest question's age", () => {
    render(<SheetOverview sessions={[RUNNING, STOPPED, UNKNOWN]} onOpen={() => {}} />);
    const row = (session: string) => document.querySelector<HTMLElement>(`[data-sheet-session="${session}"]`)!;
    expect(row(RUNNING.session).textContent).toContain('Winter timetable import');
    expect(row(RUNNING.session).textContent).toContain('3 questions');
    expect(row(RUNNING.session).textContent).toContain('5m');
    expect(row(STOPPED.session).textContent).toContain('1 queued');
    expect(row(UNKNOWN.session).textContent).toContain('Session 5eed0000');
    expect(row(UNKNOWN.session).textContent).toContain('1 accepted');
  });

  it('opens a session through onOpen, as a button without hrefOf', () => {
    const onOpen = vi.fn();
    render(<SheetOverview sessions={[RUNNING]} onOpen={onOpen} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Winter timetable import/ }));
    expect(onOpen).toHaveBeenCalledWith(RUNNING.session);
  });

  it('draws each row as a real anchor with the href hrefOf gives, still opening through onOpen on a plain click', () => {
    const onOpen = vi.fn();
    render(<SheetOverview sessions={[RUNNING, STOPPED]} onOpen={onOpen} hrefOf={(session) => `/s/${session}`} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([`/s/${RUNNING.session}`, `/s/${STOPPED.session}`]);
    expect(fireEvent.click(links[0])).toBe(false); // default prevented: the page routes through onOpen
    expect(onOpen).toHaveBeenCalledWith(RUNNING.session);
    expect(fireEvent.click(links[1], { metaKey: true })).toBe(true); // a ⌘-click is the browser's
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says so when no session has anything on its sheet', () => {
    render(<SheetOverview sessions={[NOTHING]} onOpen={() => {}} />);
    expect(screen.getByText('No session has open questions')).toBeTruthy();
  });
});
