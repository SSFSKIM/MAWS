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

const P = 'p1' as ProjectId;
const hasTab = () => useLayout.getState().main.panes.some((p) => p.tabs.some((t) => t.kind === 'session' && t.appSessionId === ID));

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
    expect(screen.getByRole('heading', { name: 'New session in maws' })).toBeTruthy();
    expect(container.children).toHaveLength(1); // the heading; no card waits
    expect(container.textContent).toBe('New session in maws');
  });

  it('names the directory when the intent has no project', () => {
    putIntent(intent());
    render(<NewSessionEmptyState appSessionId={ID} />);
    expect(screen.getByRole('heading', { name: 'New session in repo' })).toBeTruthy();
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
