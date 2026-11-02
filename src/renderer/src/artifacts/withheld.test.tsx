// The withheld session (P5 O7 M5a2 fix wave 1, apps/org-protocol/src/withheld.ts): a machine writes org-protocol's
// reserved WITHHELD_SESSION in an artifact answer's actor fields for every session the member can't view. The page shows
// it as the untitled agent ("Claude") and treats it as no session wherever an actor's session is looked up: no title, no
// session to open or resume, no link.
import { cleanup, render, screen } from '@testing-library/react';
import { WITHHELD_SESSION } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { actorSessionOnPage } from '../ipc/machine';
import { useSessions } from '../stores/sessions';
import { preloadOf } from '../test-support/preload-of';
import { libraryRow } from '../test-support/remote-artifacts';
import { documentWindowDeps } from '../tools/document';
import { Row } from '../library/Row';
import { artifactSessionContext } from './session-context';

const WITHHELD_HERE = at(WITHHELD_SESSION as AppSessionId);
const WITHHELD_THERE = addressOf(OTHER_MACHINE, WITHHELD_SESSION) as AppSessionId;

afterEach(() => {
  cleanup();
  useSessions.setState({ records: new Map() });
});

describe('the withheld session', () => {
  it('is no session on the page, bare or addressed; any other id is its address', () => {
    expect(actorSessionOnPage(WITHHELD_SESSION)).toBeNull();
    expect(actorSessionOnPage(WITHHELD_HERE)).toBeNull();
    expect(actorSessionOnPage(WITHHELD_THERE)).toBeNull();
    expect(actorSessionOnPage('app-a')).toBe(at('app-a'));
    expect(actorSessionOnPage(addressOf(OTHER_MACHINE, 'app-b'))).toBe(addressOf(OTHER_MACHINE, 'app-b'));
  });

  it('has no title in a history’s author lookup, so it shows as the untitled agent', () => {
    // even a record the window held under that id (none can exist: the id is never minted) names nothing
    window.maws = preloadOf(fakeClient()); // the window's artifact host listens on it
    useSessions.setState({ records: new Map([[WITHHELD_HERE, record(WITHHELD_HERE)]]) });
    expect(documentWindowDeps().sessionTitle(WITHHELD_SESSION)).toBeUndefined();
  });

  it('is no session context for an artifact it created', () => {
    const facts = { records: new Map([[WITHHELD_THERE, { projectId: null }]]), spaces: [], projects: new Map() };
    expect(artifactSessionContext({ createdBy: { kind: 'session', appSessionId: WITHHELD_THERE }, sessions: [] }, facts)).toEqual({ kind: 'none' });
  });

  it('reads as Claude in a library row, which names and links no session for it', () => {
    const row = libraryRow(1, { title: 'Shared deck', lastEditor: { kind: 'session', appSessionId: WITHHELD_THERE } });
    render(<Row row={row} stop menuOpen={false} onMenuOpen={() => {}} onFocus={() => {}} onFocusWithin={() => {}} onKeyDown={() => {}} />);
    expect(screen.getByText(/by Claude/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(WITHHELD_SESSION);
  });
});
