import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { connectVisibility } from './visibility';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;

let fake: FakeClient;
let stop: () => void;
let focused = true;
let visibility: DocumentVisibilityState = 'visible';

const sent = () => fake.invoked('session.setVisible');

beforeEach(() => {
  resetShellStores();
  useSessions.setState({ records: new Map([[A, record('app-a')], [B, record('app-b')]]) });
  focused = true;
  visibility = 'visible';
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  fake = fakeClient({ 'session.setVisible': undefined });
  stop = connectVisibility(fake.client);
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe('session visibility', () => {
  it('is sent true once when a session tab becomes active, and false when another tab takes over', () => {
    expect(sent()).toEqual([]);
    useLayout.getState().openSession(A);
    expect(sent()).toEqual([{ appSessionId: A, visible: true }]);
    useLayout.getState().setSidebar({ width: 260 }); // an unrelated change sends nothing
    useLayout.getState().activateTab(`session:${A}`);
    expect(sent()).toHaveLength(1);
    useLayout.getState().openSession(B);
    expect(sent().slice(1)).toEqual([
      { appSessionId: A, visible: false },
      { appSessionId: B, visible: true },
    ]);
  });

  it('is false for every visible session when the window blurs, and true again on focus', () => {
    useLayout.getState().openSession(A);
    useLayout.getState().openSession(B, { split: true });
    expect(sent()).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: B, visible: true },
    ]);
    focused = false;
    window.dispatchEvent(new Event('blur'));
    expect(sent().slice(2)).toEqual([
      { appSessionId: A, visible: false },
      { appSessionId: B, visible: false },
    ]);
    focused = true;
    window.dispatchEvent(new Event('focus'));
    expect(sent().slice(4)).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: B, visible: true },
    ]);
  });

  it('is false when the page hides', () => {
    useLayout.getState().openSession(A);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent()).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: A, visible: false },
    ]);
  });

  it('is false while the right panel is maximized over the main region', () => {
    useLayout.getState().openSession(A);
    useLayout.getState().setPanel({ maximized: true });
    expect(sent().at(-1)).toEqual({ appSessionId: A, visible: false });
  });

  it('reports an unstarted session only once its record arrives', () => {
    const NEW = 'app-new' as AppSessionId;
    useLayout.getState().openSession(NEW);
    expect(sent()).toEqual([]);
    useSessions.getState().applyChanged({ record: record('app-new'), cause: 'live', revision: 5 } as never);
    expect(sent()).toEqual([{ appSessionId: NEW, visible: true }]);
  });
});
