import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import { project, record } from '../../../../test/support/builders';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { ID, intent, putIntent, resetSetupStore } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { NewSessionEmptyState } from './NewSessionEmptyState';
import { useSetup } from './store';
import { currentSet } from '../stores/layout-model';

const P = 'p1' as ProjectId;
const hasTab = () => currentSet(useLayout.getState().main).panes.some((p) => p.tabs.some((t) => t.kind === 'session' && t.appSessionId === ID));

beforeEach(() => {
  resetShellStores();
  resetSetupStore();
  useSessions.setState({ projects: new Map([[P, project('p1', 0, { name: 'maws' })]]) });
  useLayout.getState().openTab({ kind: 'session', appSessionId: ID });
});
afterEach(cleanup);

describe('the unstarted empty state', () => {
  it('renders one heading naming the project and nothing else', () => {
    putIntent(intent({ projectId: P }));
    const { container } = render(<NewSessionEmptyState appSessionId={ID} />);
    expect(screen.getByRole('heading', { name: 'New chat in maws' })).toBeTruthy();
    expect(container.children).toHaveLength(1); // the heading; no card waits
    expect(container.textContent).toBe('New chat in maws');
  });

  // New chat (2026-10-01): until the project row chooses a project, and for a chat that works in no project
  it('reads "New chat" with no project chosen, and with no project at all', () => {
    putIntent(intent({ location: null }));
    const { unmount } = render(<NewSessionEmptyState appSessionId={ID} />);
    expect(screen.getByRole('heading', { name: 'New chat' })).toBeTruthy();
    unmount();
    putIntent(intent({ projectId: null }));
    render(<NewSessionEmptyState appSessionId={ID} />);
    expect(screen.getByRole('heading', { name: 'New chat' })).toBeTruthy();
  });

  it('names the directory when the project is one the index no longer lists', () => {
    putIntent(intent({ projectId: 'gone' as ProjectId }));
    render(<NewSessionEmptyState appSessionId={ID} />);
    expect(screen.getByRole('heading', { name: 'New chat in repo' })).toBeTruthy();
  });

  it('closes a restored tab whose id has neither a record nor an intent', () => {
    render(<NewSessionEmptyState appSessionId={ID} />);
    expect(hasTab()).toBe(false);
  });

  it('keeps a tab this window opened while its intent is on its way, and one whose record exists', () => {
    useSessions.getState().addUnstarted(ID, { projectId: P, createdAt: '2026-09-29T10:00:00.000Z' });
    const { unmount } = render(<NewSessionEmptyState appSessionId={ID} />);
    expect(hasTab()).toBe(true);
    unmount();
    act(() => useSessions.setState({ unstarted: new Map(), records: new Map([[ID, record(ID)]]) }));
    render(<NewSessionEmptyState appSessionId={ID} />);
    expect(hasTab()).toBe(true);
  });

  it('waits for the intent snapshot before deciding', () => {
    useSetup.setState({ loaded: false });
    render(<NewSessionEmptyState appSessionId={ID} />);
    expect(hasTab()).toBe(true);
  });
});
