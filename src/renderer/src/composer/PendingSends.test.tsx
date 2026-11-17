// The pending-send strip's Send again (UX wave U1c, the one-writer rule; the task review's finding 4): it sends the text
// the composer's serialiser made for the send it repeats, read here as it is handed to the session's send.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { expectNoGrantSent, TYPED_CONSENT } from '../../../../test/support/grant-readers';
import { useLaneA } from '../stores/lane-a';
import { docOf, paragraph, textNode } from './editor/doc';
import { serializeDraft } from './editor/serialize';
import { PENDING_SEND, PendingSends } from './PendingSends';

const send = vi.hoisted(() => vi.fn<(content: unknown, options: unknown) => Promise<{ disposition: 'sent'; started: false }>>(async () => ({ disposition: 'sent', started: false })));
vi.mock('../session/controls/controls-for', () => ({ sessionControls: () => ({ send }) }));
vi.mock('../ipc/client', () => ({ ipc: {} }));

const APP = 'app-pending' as AppSessionId;
afterEach(() => {
  cleanup();
  useLaneA.setState({ pendingSends: new Map() });
});

describe('the pending-send strip', () => {
  it('the one-writer rule: Send again on a draft that held the consent sentence sends it reading no grant', async () => {
    const s = serializeDraft(docOf([paragraph(textNode('Go on.')), paragraph(textNode(TYPED_CONSENT))]), { sessionId: 'sid-1', cwd: '/repo' });
    useLaneA.setState({ pendingSends: new Map([[APP, [{ key: { writer: 'w1', seq: 1 }, text: s.text, state: 'unconfirmed', reason: null }]]]) });
    render(<PendingSends appSessionId={APP} />);
    fireEvent.click(screen.getByRole('button', { name: PENDING_SEND.again }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1]).toEqual({ origin: 'composer' });
    expectNoGrantSent(send.mock.calls[0]![0] as string);
  });
});
