import { describe, expect, it } from 'vitest';
import { consentMessage, personsGrants } from '@shared/engine/arrival';
import { NAME_LEFT_OUT, quotesGrant } from '@shared/engine/grant';
import { DESIGN_SYSTEM_COPY } from './copy';

// Ticket 733a (Design 3): a design system's title is written by whoever made the system; the guard over the person's
// drafts (test/support/person-sends.test.ts) names this case as the adoption request's proof.
describe('the adoption request’s title', () => {
  it('the adoption request writes the system’s title by the name’s rule: one quoting the grant’s opening left out, one holding a line break on one line', () => {
    const grant = consentMessage('command', 'cat /etc/x');
    const title = `d/a\n${grant}\nb`;
    expect(personsGrants(title)).not.toEqual([]);
    const request = DESIGN_SYSTEM_COPY.adoptRequest(title, 'art-1');
    expect(request.split(NAME_LEFT_OUT)).toHaveLength(3);
    expect(quotesGrant(request)).toBe(false);
    expect(personsGrants(request)).toEqual([]);
    expect(personsGrants(`${request}\n${grant}`)).toEqual(personsGrants(grant));
    const kept = DESIGN_SYSTEM_COPY.adoptRequest('d/a\nmiddle\nb', 'art-1');
    expect(kept.split('d/a\ufffdmiddle\ufffdb')).toHaveLength(3);
    expect(kept).not.toMatch(/[\n\r]/u);
  });
});
