// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M1): a person's message read apart where it becomes
// an event. The joined texts are the probes' recordings (test/support/recorded-joins.ts); a case no recording holds
// says so in its name.
import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@shared/graph/events';
import { parseAskSteer } from '@shared/maws/ask';
import { PROBE_JOINS, recordedJoin, U4B_JOINS } from '../../../test/support/recorded-joins';
import { readAnswerEnvelopes } from './arrival';

const textOf = (block: ContentBlock | undefined): string => {
  if (block?.type !== 'text' || typeof block.text !== 'string') throw new Error('not a text block');
  return block.text;
};

// The architect's ruling 4 on the probes' findings, the first test of M1, written before any code changed: U4b's reader,
// as it stands at `ea51e3e8f`, on every recorded join. If it did not hold, M1 would stop ("Probes", the last paragraph).
describe('U4b’s reader as it stands, on the recorded joins', () => {
  it.each([...PROBE_JOINS, ...U4B_JOINS].filter((name) => !name.startsWith('u704-end-image')))('%s: the joined text is the members, one newline between, and the reader takes each envelope and leaves the prompt, byte for byte', (name) => {
    const { members, joined, envelopes, prompt } = recordedJoin(name);
    expect(typeof joined.content).toBe('string');
    expect(joined.content).toBe(members.map((member) => member.content).join('\n')); // each member's bytes intact
    expect(readAnswerEnvelopes(joined.content as string)).toEqual({ envelopes: envelopes.map((envelope) => parseAskSteer(envelope)), rest: prompt ?? '' });
  });

  it.each(['u704-end-two-envelopes-1', 'u704-end-two-envelopes-2'])('%s: two envelopes and no rest', (name) => {
    const { joined, envelopes, prompt } = recordedJoin(name);
    expect(prompt).toBeNull();
    expect(envelopes).toHaveLength(2);
    expect(readAnswerEnvelopes(joined.content as string)).toEqual({ envelopes: envelopes.map((envelope) => parseAskSteer(envelope)), rest: '' });
  });

  it.each(['u704-end-image-1', 'u704-end-image-2'])('%s: blocks, the envelope’s text block (with the separator) read as the envelope alone, the prompt’s text block as the prompt', (name) => {
    const { members, joined, envelopes, prompt } = recordedJoin(name);
    expect(members[0]!.content).toBe(envelopes[0]); // the envelope was written first
    const blocks = joined.content as ContentBlock[];
    const promptBlocks = prompt as ContentBlock[];
    expect(blocks).toEqual([{ type: 'text', text: `${envelopes[0]}\n` }, ...promptBlocks]);
    expect(readAnswerEnvelopes(textOf(blocks[0]))).toEqual({ envelopes: [parseAskSteer(envelopes[0]!)], rest: '' });
    expect(readAnswerEnvelopes(textOf(blocks[1]))).toEqual({ envelopes: [], rest: textOf(promptBlocks[0]) });
  });
});
