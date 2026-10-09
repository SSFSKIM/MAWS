// P2-E1 (M2): the card's thread helpers (P2-E1 document, D6). Where the thread's own rows begin (the last prompt framed
// as this thread's anchored comment); what the needs-you strip says, first source first; and how the human send seam's
// answer reads in the card (D6's disposition table, in one place).
import { describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AttentionKind } from '@shared/graph/enums';
import type { Lineage } from '@shared/graph/session';
import { item, T0 } from '../../../../../test/support/builders';
import type { Row } from '../../transcript/model/rows';
import { needsYouOf, replyOutcomeOf, threadStartOf } from './thread';
import { RELAY_FIRST, TRUST_FIRST } from '../../sessions/acquire'; // P2-A

// P2-C may add its two kinds to the actionable set (and so may a later child add another): the card's strip must
// still keep C's out, and name a tier-1 kind it has no words for generically.
vi.mock('@shared/attention/kinds', async (original) => {
  const real = await original<typeof import('@shared/attention/kinds')>();
  const ACTIONABLE = new Set<string>([...real.ACTIONABLE_KINDS, 'async_input', 'essential_unread', 'future_kind']);
  return { ...real, isActionable: (i: { kind: string }) => ACTIONABLE.has(i.kind) };
});

const CHILD = 'c1111111-1111-4111-8111-111111111111';
const ANCHOR: Anchor = { kind: 'artifact-element', locator: '#hero', label: 'Dashboard v1 › h1#hero “Sales overview”', pageUrl: 'maws://deliverable/x/y/1' };
const lineage = (over: Partial<Lineage> = {}): Lineage => ({ kind: 'side-thread', parentAppSessionId: 'a1111111-1111-4111-8111-111111111111' as never, parentEngineSessionId: null, anchor: ANCHOR, openedBy: 'comment', ...over });

let n = 0;
const user = (over: Partial<Extract<Row, { kind: 'user' }>> = {}): Row =>
  ({ id: `u${++n}`, turnId: null, at: T0, kind: 'user', messageUuid: null, text: 'text', attachments: [], placeholders: [], lines: 1, editable: true, steer: false, dropped: false, ...over }) as Row;
const answer = (): Row => ({ id: `a${++n}`, turnId: null, at: T0, kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown: 'reply', live: false, phase: 'answer', model: null }) as Row;
const anchored = (anchor: Anchor = ANCHOR, destination: 'thread' | 'main' = 'thread') => user({ anchor, anchorFrame: { destination, screenshot: false } });

describe('threadStartOf', () => {
  const start = threadStartOf(lineage());

  it('a live thread starts at its anchored prompt', () => {
    expect(start([anchored(), answer()], true)).toBe(0);
  });

  it('a thread read from disk starts after the parent’s copied history, at its anchored prompt', () => {
    expect(start([user(), answer(), user(), answer(), anchored(), answer()], true)).toBe(4);
  });

  it('a thread of a thread (its parent’s anchored prompt copied first, the same anchor) starts at the last one', () => {
    expect(start([user(), anchored(), answer(), anchored(), answer()], true)).toBe(3);
  });

  it('reads the anchor on kind, locator and label, and only a prompt framed for a thread', () => {
    const rows = [anchored({ ...ANCHOR, locator: 'p.lead' }), anchored({ ...ANCHOR, label: 'Other' }), anchored(ANCHOR, 'main'), anchored({ ...ANCHOR, screenshot: { path: '/s.png', width: 1, height: 1 } }), answer()];
    expect(start(rows, true)).toBe(3);
  });

  it('a promotion (no lineage anchor) starts at 0', () => {
    expect(threadStartOf(lineage({ anchor: undefined, openedBy: 'btw' }))([user(), answer()], true)).toBe(0);
    expect(threadStartOf(null)([user()], false)).toBe(0);
  });

  it('nothing loaded and no match yet: nothing to show (null)', () => {
    expect(start([], false)).toBeNull();
    expect(start([user(), answer()], false)).toBeNull();
  });

  it('loaded with no match: everything, from 0 (hiding the thread is worse than showing too much)', () => {
    expect(start([user(), answer()], true)).toBe(0);
  });
});

describe('needsYouOf', () => {
  const none = { card: undefined, failed: false, holder: null, pending: [] };
  const at = (k: number) => new Date(Date.parse(T0) + k * 1000).toISOString();
  const waiting = (kind: string, k = 0) => item(CHILD, kind as AttentionKind, at(k));
  const trust = { kind: 'trust', trust: {} as never, message: null } as const;
  const relay = { kind: 'relay', health: {} as never, message: null } as const;

  it('nothing waits: no strip', () => {
    expect(needsYouOf(none)).toBeNull();
    expect(needsYouOf({ ...none, holder: { kind: 'self' } })).toBeNull();
  });

  it('first match wins: a setup card, then a failed start, then a holder, then attention', () => {
    const all = { card: trust, failed: true, holder: { kind: 'terminal', pid: 42 } as const, pending: [waiting('permission')] };
    expect(needsYouOf(all)).toEqual({ kind: 'setup-card', text: 'Waiting for you to trust this folder', tabOnly: false });
    expect(needsYouOf({ ...all, card: undefined })).toEqual({ kind: 'setup-failed', text: 'Could not start', tabOnly: false });
    expect(needsYouOf({ ...all, card: undefined, failed: false })).toEqual({ kind: 'held', text: 'Held by terminal · 42', tabOnly: true });
    expect(needsYouOf({ ...all, card: undefined, failed: false, holder: null })).toEqual({ kind: 'attention', text: 'Waiting for your permission', tabOnly: false });
  });

  it('a relay card, and a background job holding the thread', () => {
    expect(needsYouOf({ ...none, card: relay })?.text).toBe('The relay is not answering');
    expect(needsYouOf({ ...none, holder: { kind: 'background_job', pid: 7, jobId: 'ab12', command: 'claude' } as never })).toEqual({ kind: 'held', text: 'Held by bg · ab12', tabOnly: true });
  });

  it('names every tier-1 kind by its oldest item', () => {
    const texts: Record<string, string> = {
      permission: 'Waiting for your permission',
      question: 'Asked you a question',
      plan: 'Waiting for you to review a plan',
      dialog: 'Waiting for your input',
      elicitation: 'Waiting for your input',
      error: 'Hit an error',
      interrupted: 'Was interrupted',
      auto_mode_unavailable: 'Auto mode is unavailable',
    };
    for (const [kind, text] of Object.entries(texts)) expect(needsYouOf({ ...none, pending: [waiting(kind)] })?.text, kind).toBe(text);
    expect(needsYouOf({ ...none, pending: [waiting('question', 2), waiting('plan', 1)] })?.text, 'the oldest').toBe('Waiting for you to review a plan');
  });

  it('a tier-1 kind it has no words for reads "Waiting for you"; held peer messages (tier 2) raise none', () => {
    expect(needsYouOf({ ...none, pending: [waiting('future_kind')] })?.text).toBe('Waiting for you');
    expect(needsYouOf({ ...none, pending: [waiting('held_peer_message')] })).toBeNull();
  });

  it('P2-C’s async_input and essential_unread raise none (the card’s rows and Reply carry them), even beside another item', () => {
    expect(needsYouOf({ ...none, pending: [waiting('async_input')] })).toBeNull();
    expect(needsYouOf({ ...none, pending: [waiting('essential_unread')] })).toBeNull();
    expect(needsYouOf({ ...none, pending: [waiting('async_input', 0), waiting('permission', 1)] })?.text).toBe('Waiting for your permission');
  });

  it('an item no longer open raises none', () => {
    expect(needsYouOf({ ...none, pending: [{ ...waiting('permission'), state: 'confirmed' }] })).toBeNull();
  });
});

describe('replyOutcomeOf (X22’s answer as the card reads it)', () => {
  it('sent, steered and queued: delivered, the transcript draws the rest', () => {
    expect(replyOutcomeOf({ disposition: 'sent', started: false, messageUuid: 'm' as never })).toEqual({ kind: 'delivered' });
    expect(replyOutcomeOf({ disposition: 'steered', started: false })).toEqual({ kind: 'delivered' });
    expect(replyOutcomeOf({ disposition: 'queued', started: false, queueId: 'q1' })).toEqual({ kind: 'delivered' });
  });

  // P2-A's final shape: the seam starts the thread first and then sends, so a started reply is already with the host
  it('a reply that started the thread reads by its disposition: delivered', () => {
    expect(replyOutcomeOf({ disposition: 'sent', started: true, messageUuid: 'm' as never })).toEqual({ kind: 'delivered' });
    expect(replyOutcomeOf({ disposition: 'queued', started: true, queueId: 'q1' })).toEqual({ kind: 'delivered' });
  });

  it('refused: the reason, kept for the field', () => {
    expect(replyOutcomeOf({ disposition: 'refused', started: false, reason: 'The session has ended' })).toEqual({ kind: 'refused', reason: 'The session has ended' });
    expect(replyOutcomeOf({ disposition: 'refused', started: false })).toEqual({ kind: 'refused', reason: 'The reply was not sent' });
  });

  it('held (a card took the text, which only a composer send hands it) reads as a refusal naming the card', () => {
    expect(replyOutcomeOf({ disposition: 'held', started: false, reason: 'trust' })).toEqual({ kind: 'refused', reason: TRUST_FIRST });
    expect(replyOutcomeOf({ disposition: 'held', started: false, reason: 'relay' })).toEqual({ kind: 'refused', reason: RELAY_FIRST });
  });
});
