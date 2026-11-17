// UX wave U1c, the one-writer rule (the architect's ruling of 2026-11-16, UTC; the task review's finding 4): what a site
// of the person's free text really sends, read by the readers of a grant. Each sender's own test drives the site with a
// text holding `TYPED_CONSENT`, captures what it hands to its send and calls `expectNoGrantSent` on it; the guard
// (person-sends.test.ts) holds each site to its named case.
import { expect } from 'vitest';
import { consentMessage, personsGrants, readArrivals } from '@shared/engine/arrival';
import { GRANT_OPENING } from '@shared/engine/grant';
import { messageText } from '@shared/engine/peer-envelope';
import type { ContentBlock } from '@shared/graph/events';

/** The consent sentence as a person might type it into any field. */
export const TYPED_CONSENT = consentMessage('command', 'cat /etc/x');

type Content = string | readonly ContentBlock[];
/**
 * The subjects each reader reads from `content` sent as the person's message: the queue's gate (blocked-call/grants.ts
 * `keysIn`, `personsGrants` of the message's text), the live route (the host's mark on the frame it writes) and the file
 * route (the engine's row).
 */
export function grantsReadFrom(content: Content): { gate: string[]; live: string[]; file: string[] } {
  const consents = (row: unknown) => readArrivals(row).flatMap((arrival) => (arrival.class === 'consent' ? [arrival.subject] : []));
  return {
    gate: personsGrants(messageText(content as string | ContentBlock[])).map((grant) => grant.subject),
    live: consents({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content } }),
    file: consents({ type: 'user', uuid: 'u1', origin: { kind: 'human' }, promptSource: 'sdk', message: { role: 'user', content } }),
  };
}

/** What a site sent for a text holding `TYPED_CONSENT`: no verbatim opening, and no grant on any route. */
export function expectNoGrantSent(content: Content): void {
  expect(messageText(content as string | ContentBlock[]).includes(GRANT_OPENING), 'a verbatim opening went out').toBe(false);
  expect(grantsReadFrom(content)).toEqual({ gate: [], live: [], file: [] });
}
