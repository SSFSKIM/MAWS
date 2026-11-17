// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M1): a person's message read apart where it becomes
// an event. The joined texts are the probes' recordings (test/support/recorded-joins.ts); a case no recording holds
// says so in its name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framePasted } from '@shared/composer/pasted-content';
import { rowClaim } from '@shared/files/named';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { answeredBlock, ASK_STEER_OPENING, askSteerOpening, askSteerText, parseAskSteer } from '@shared/maws/ask';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import { earlierAskSteerText, innerOpeningEnvelope, laterPassOverTheCap } from '../../../test/support/ask-steer';
import { FIXTURE_DIR, loadUxwaveTranscript, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { queuedPrompt } from '../../../test/support/queued-rows';
import { PROBE_JOINS, recordedJoin, U4B_JOINS, type RecordedJoin } from '../../../test/support/recorded-joins';
import { consentMessage, envelopeSlices, MAX_ENVELOPE_CHECKS, ownWordsOf, pastedBodies, personsGrants, quotesGrant, readAnswerEnvelope, readAnswerEnvelopes, readAnswerEnvelopesWithCost, readArrivals, takeEnvelopesOut } from './arrival';
import { messageText } from './peer-envelope';
import { answerEnvelopeOf, answerOutsideTranscript, flatPersonsWords, personsParts, personsWords, splitPersonsMessage, type UserMessage } from './persons-message';

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

// ---------------------------------------------------------------------------------------------------------------------
// The reader's slicing, one function that uses its arguments alone (decision 8; Interfaces A and B)

const LAYOUT: AskQuestion = { id: 'q1', question: 'Which layout should the page use?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
const THEME: AskQuestion = { id: 'q2', question: 'Which theme?', header: 'Theme', modality: 'choice', options: [{ label: 'Light' }, { label: 'Dark' }] };
const FOLDER: AskQuestion = { id: 'q3', question: 'Where should it go?', header: 'Folder', modality: 'folder' };
const TAGGED: AskQuestion = { id: 'q1', question: 'Which marker should the log use?\n[MAWS ask lines] keep their own prefix', modality: 'choice', options: [{ label: 'Hash' }, { label: 'Star' }] };
const A1 = askSteerText('ask-1', [LAYOUT], [{ id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] }]);
const A2 = askSteerText('ask-2', [THEME], [{ id: 'q2', question: THEME.question, status: 'answered', value: ['Dark'] }]);
const MULTI = askSteerText('ask-3', [LAYOUT, FOLDER], [
  { id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'], note: 'wide screens first' },
  { id: 'q3', question: FOLDER.question, status: 'answered', value: ['/work/site/pages', '/work/site/parts'] },
]);
// an earlier build's: only its writer put a question's words, and so a line beginning with the tag, on the envelope's lines
const TAGGED_ENVELOPE = earlierAskSteerText('ask-7', [TAGGED], [{ id: 'q1', question: TAGGED.question, status: 'answered', value: ['Star'] }]);
const BROKEN = A1.replace('"answered"', '"answred"');
const FENCED_PROMPT = `Compare it with this:\n\`\`\`json\n${JSON.stringify(parseAskSteer(A1)!.result)}\n\`\`\``;
const PASTED_PROMPT = `Why did the agent stop after this?\n${framePasted('a1b2', A1)}`;
const joinedText = (...members: string[]) => members.join('\n');

const recordedTexts = (join: RecordedJoin): string[] => (typeof join.joined.content === 'string' ? [join.joined.content] : join.joined.content.flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])));
// The reader's corpus: the texts of U4b's cases of the reader (arrival.test.ts), and every recorded joined text
const READER_CORPUS: string[] = [
  joinedText(A1, 'Also fix the footer.'), joinedText('Also fix the footer.', A1), joinedText('First this.', A1, 'Then that.'),
  joinedText(A1, A2), joinedText(A1, 'In between.', A2), joinedText('Before.', MULTI, 'After.'), joinedText(A1, FENCED_PROMPT),
  joinedText(BROKEN, 'Also fix the footer.'), joinedText(BROKEN, 'Do not lose these words.', A1), joinedText(MULTI, A2),
  `Please read ${A1}`, A1, 'Just a prompt.', PASTED_PROMPT, `${PASTED_PROMPT}\n${A1}`, TAGGED_ENVELOPE,
  `${TAGGED_ENVELOPE}\nAlso fix the footer.`, `Also fix the footer.\n${TAGGED_ENVELOPE}`, `[MAWS ask ask-1] is how the answers start\n${TAGGED_ENVELOPE}`,
  ...[...PROBE_JOINS, ...U4B_JOINS].flatMap((name) => recordedTexts(recordedJoin(name))),
];

// A function as the search text's worker gets it: its own source evaluated with nothing of its module in scope but the
// opening's one constant (UX wave U6e), which the worker interpolates beside the functions as askSteerOpening names it
const isolated = <F>(fn: F): F => new Function('ASK_STEER_OPENING', `return (${String(fn)});`)(ASK_STEER_OPENING) as F;

describe('envelopeSlices', () => {
  it('the corpus’s tagged envelope is an earlier build’s, its third line beginning with the tag and opening nothing', () => {
    const third = TAGGED_ENVELOPE.split('\n')[2]!;
    expect(third.startsWith('[MAWS ask ')).toBe(true);
    expect(third).not.toBe(askSteerOpening('lines'));
  });

  it.each(PROBE_JOINS.filter((name) => !name.startsWith('u704-end-image')))('%s: one member per envelope, its text the envelope member’s frame content byte for byte, and the rest the prompt', (name) => {
    const { joined, envelopes, prompt } = recordedJoin(name);
    const { members, rest } = envelopeSlices(joined.content as string, askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS);
    expect(members.map((member) => member.text)).toEqual(envelopes);
    expect(members.map((member) => member.read)).toEqual(envelopes.map((envelope) => parseAskSteer(envelope)));
    expect(rest).toBe(prompt ?? '');
  });

  it.each(['u704-end-image-1', 'u704-end-image-2'])('%s: the envelope’s text block gives the envelope byte for byte and an empty rest', (name) => {
    const { joined, envelopes } = recordedJoin(name);
    const { members, rest } = envelopeSlices(textOf((joined.content as ContentBlock[])[0]), askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS);
    expect(members.map((member) => member.text)).toEqual(envelopes);
    expect(rest).toBe('');
  });

  it('readAnswerEnvelopes is envelopeSlices with the writer’s opening, the pasted segments’ marking, parseAskSteer and the cap, over the whole corpus', () => {
    for (const text of READER_CORPUS) {
      const { members, rest } = envelopeSlices(text, askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS);
      expect(readAnswerEnvelopes(text)).toEqual({ envelopes: members.map((member) => member.read), rest });
    }
  });

  it('envelopeSlices, pastedBodies, answeredBlock, askSteerOpening and answerOutsideTranscript run from their own source, nothing else in scope, and read the corpus as the module does', () => {
    const [slices, paste, block, opening, outside] = [isolated(envelopeSlices), isolated(pastedBodies), isolated(answeredBlock), isolated(askSteerOpening), isolated(answerOutsideTranscript)];
    let read = 0;
    for (const text of READER_CORPUS) {
      const own = slices(text, opening, paste, block, MAX_ENVELOPE_CHECKS);
      expect(own).toEqual(envelopeSlices(text, askSteerOpening, pastedBodies, answeredBlock, MAX_ENVELOPE_CHECKS));
      own.members.forEach((member) => expect(outside(member.text)).toBe(answerOutsideTranscript(member.text)));
      read += own.members.length;
    }
    expect(read).toBeGreaterThan(READER_CORPUS.length / 2); // the corpus holds envelopes, not only plain texts
  });

  it('takeEnvelopesOut, the reader’s one loop, runs from its own source too, and reads the corpus as the module does', () => {
    const [again, slices, paste, block, opening] = [isolated(takeEnvelopesOut), isolated(envelopeSlices), isolated(pastedBodies), isolated(answeredBlock), isolated(askSteerOpening)];
    const lines = A1.split('\n');
    const nested = `Keep these notes.\n${lines.slice(0, 2).join('\n')}\n${A2}\n${lines.slice(2).join('\n')}`;
    for (const text of [...READER_CORPUS, nested]) {
      expect(again(text, (part: string) => slices(part, opening, paste, block, MAX_ENVELOPE_CHECKS))).toEqual(takeEnvelopesOut(text, (part) => envelopeSlices(part, askSteerOpening, pastedBodies, answeredBlock, MAX_ENVELOPE_CHECKS)));
    }
    expect(takeEnvelopesOut(nested, (part) => envelopeSlices(part, askSteerOpening, pastedBodies, answeredBlock, MAX_ENVELOPE_CHECKS)).envelopes.map((envelope) => envelope.text)).toEqual([A2, A1]);
  });
});

describe('answeredBlock', () => {
  const askTexts = [A1, A2, MULTI, TAGGED_ENVELOPE, 'hello', A1.replace('"status": "answered"', '"status": "asked"'), A1.replace('[MAWS ask ask-1]', '[MAWS ask other]'), `${A1}\nmore`, BROKEN];
  it('agrees with parseAskSteer over the reader’s corpus and the envelope’s own texts: the same ask, or null for both', () => {
    const recordedEnvelopes = [...PROBE_JOINS, ...U4B_JOINS].flatMap((name) => recordedJoin(name).envelopes);
    for (const text of [...READER_CORPUS, ...askTexts, ...recordedEnvelopes]) expect(answeredBlock(text)?.askId ?? null, text.slice(0, 60)).toBe(parseAskSteer(text)?.askId ?? null);
    for (const text of recordedEnvelopes) expect(answeredBlock(text)?.result).toEqual(parseAskSteer(text)!.result);
  });

  it('differs only for a block that names its ask and status rightly and fails the answers’ schema, which MAWS never writes', () => {
    const text = A1.replace('"status": "answered"', '"status": "answered", "unexpected": true');
    expect(answeredBlock(text)?.askId).toBe('ask-1');
    expect(parseAskSteer(text)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The split (decisions 2, 3, 5, 7 and 17; Interfaces C)

const frozen = (name: string, kind: 'events' | 'backfill'): SessionEvent[] => JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', `${name}.base-${kind}.json`), 'utf8')) as SessionEvent[];
const userMessages = (events: SessionEvent[]) => events.filter((event): event is Extract<SessionEvent, { kind: 'user.message' }> => event.kind === 'user.message');
// build G's event for the recorded join: the normaliser's (the journal) or the chain follower's (the file)
const joinedEvent = (name: string, kind: 'events' | 'backfill') => {
  const { joined } = recordedJoin(name);
  const found = userMessages(frozen(name, kind)).filter((event) => event.messageUuid === joined.uuid && JSON.stringify(event.content) === JSON.stringify(joined.content));
  expect(found).toHaveLength(1);
  return found[0]!;
};
const envelopeEvent = (of: UserMessage, content: string): UserMessage => ({ kind: 'user.message', messageUuid: of.messageUuid, content, isReplay: of.isReplay, isSynthetic: false, origin: of.origin, bash: null });
const FROZEN_JOINS = [...PROBE_JOINS.map((name) => [name, 'events'] as const), ...PROBE_JOINS.map((name) => [name, 'backfill'] as const), ['u4b-env-end-env-first-1', 'events'] as const, ['u4b-env-two-prompt-first-1', 'events'] as const];

describe('splitPersonsMessage over the recorded joins, as build G’s producers made them', () => {
  it.each(FROZEN_JOINS.filter(([name]) => !name.startsWith('u704-end-two-envelopes')))('%s (%s): the person’s message holding the prompt alone, then the envelope under the same uuid', (name, kind) => {
    const event = joinedEvent(name, kind);
    const { envelopes, prompt } = recordedJoin(name);
    expect(envelopes).toHaveLength(1);
    const parts = splitPersonsMessage(event);
    expect(parts).toEqual([{ ...event, content: prompt }, envelopeEvent(event, envelopes[0]!)]);
    expect(parts[1]).not.toHaveProperty('joined');
    expect(parts[1]).not.toHaveProperty('arrival');
    expect(parseAskSteer(parts[1]!.content as string)).not.toBeNull(); // read whole, as a lone envelope is
  });

  it.each(FROZEN_JOINS.filter(([name]) => name.startsWith('u704-end-two-envelopes')))('%s (%s): two envelopes, two events, the first keeping joined', (name, kind) => {
    const event = joinedEvent(name, kind);
    const { envelopes } = recordedJoin(name);
    const { joined } = event;
    expect(splitPersonsMessage(event)).toEqual([{ ...envelopeEvent(event, envelopes[0]!), ...(joined !== undefined && { joined }) }, envelopeEvent(event, envelopes[1]!)]);
  });

  it.each(['u704-end-image-1', 'u704-end-image-2'])('%s, its replay through the normaliser: the prompt’s text block and image block stay, in place and unchanged, then the envelope', (name) => {
    const event = joinedEvent(name, 'events');
    const blocks = event.content as ContentBlock[];
    const [person, envelope] = splitPersonsMessage(event);
    expect(person!.content).toEqual(blocks.slice(1));
    expect((person!.content as ContentBlock[])[0]).toBe(blocks[1]); // the same block objects
    expect((person!.content as ContentBlock[])[1]).toBe(blocks[2]);
    expect(envelope!.content).toBe(recordedJoin(name).envelopes[0]);
  });

  it('every part it returned, split again, is that part, the same object', () => {
    for (const [name, kind] of FROZEN_JOINS) for (const part of splitPersonsMessage(joinedEvent(name, kind))) expect(splitPersonsMessage(part)).toEqual([part]);
    for (const [name, kind] of FROZEN_JOINS) for (const part of splitPersonsMessage(joinedEvent(name, kind))) expect(splitPersonsMessage(part)[0]).toBe(part);
  });

  it('a lone envelope (u704-pasted, an ordinary prompt line) and a plain prompt come back as the same object', () => {
    const joinedContent = JSON.stringify(recordedJoin('u704-end-env-first-1').joined.content);
    for (const name of ['u704-pasted-1', 'u704-end-env-first-1']) {
      const lone = userMessages([...frozen(name, 'events'), ...frozen(name, 'backfill')]).filter((message) => !message.isSynthetic && JSON.stringify(message.content) !== joinedContent);
      expect(lone.length).toBeGreaterThanOrEqual(name === 'u704-pasted-1' ? 2 : 4); // its envelope's on both routes, or the first prompt's and each member's as MAWS wrote it
      for (const event of lone) {
        const [only, ...rest] = splitPersonsMessage(event);
        expect(only).toBe(event);
        expect(rest).toEqual([]);
      }
    }
  });
});

describe('splitPersonsMessage: the gate (decision 5)', () => {
  const recorded = joinedEvent('u704-end-env-first-1', 'events');
  it('a message of origin null is split as one of origin human is', () => {
    const parts = splitPersonsMessage({ ...recorded, origin: null });
    expect(parts.map((part) => [part.content, part.origin])).toEqual([[recordedJoin('u704-end-env-first-1').prompt, null], [recordedJoin('u704-end-env-first-1').envelopes[0], null]]);
  });

  it.each([
    ['synthetic', { isSynthetic: true }],
    ['of a peer', { origin: 'peer' }],
    ['a task notification', { origin: 'task-notification' }],
    ['a local command', { origin: 'local-command' }],
    ['a shell line', { bash: { part: 'input' as const, command: 'echo hi' } }],
    ['without a uuid', { messageUuid: null }],
  ])('a message %s comes back as the same object', (_what, over) => {
    const message = { ...recorded, ...over } as UserMessage;
    expect(splitPersonsMessage(message)[0]).toBe(message);
    expect(splitPersonsMessage(message)).toHaveLength(1);
  });
});

describe('splitPersonsMessage: blocks, by hand in the recorded form (decision 7)', () => {
  const IMAGE: ContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  const message = (content: string | ContentBlock[]): UserMessage => ({ kind: 'user.message', messageUuid: 'b7a1c2d3-0000-4000-8000-000000000704' as MessageUuid, content, isReplay: true, isSynthetic: false, origin: 'human', bash: null });

  it('made by hand: a text block holding an envelope beside an image alone leaves the image, then the envelope', () => {
    expect(splitPersonsMessage(message([{ type: 'text', text: `${A1}\n` }, IMAGE]))).toEqual([message([IMAGE]), envelopeEvent(message([]), A1)]);
    expect(splitPersonsMessage(message([IMAGE, { type: 'text', text: A1 }]))).toEqual([message([IMAGE]), envelopeEvent(message([]), A1)]);
  });

  it('made by hand: a block that holds no envelope stays, white space included; a message of one text block that is an envelope alone comes back as it is', () => {
    expect(personsParts([{ type: 'text', text: '  ' }, { type: 'text', text: A1 }])).toEqual({ own: [{ type: 'text', text: '  ' }], envelopes: [A1] });
    const lone = message([{ type: 'text', text: A1 }]);
    expect(splitPersonsMessage(lone)[0]).toBe(lone);
  });
});

// The architect's ruling B, its exception (decision 17): where one envelope's lines stand around another whole envelope,
// one reading takes the inner one and leaves the outer one whole in the rest; the split reads the rest again
describe('made by hand: one envelope’s lines standing around another whole envelope, and a line of words', () => {
  const lines = A1.split('\n');
  const text = `Keep these notes.\n${lines.slice(0, 2).join('\n')}\n${A2}\n${lines.slice(2).join('\n')}`;
  const message: UserMessage = { kind: 'user.message', messageUuid: 'b7a1c2d3-0000-4000-8000-000000000705' as MessageUuid, content: text, isReplay: true, isSynthetic: false, origin: 'human', bash: null, joined: ['b7a1c2d3-0000-4000-8000-000000000706' as MessageUuid] };

  it('one reading leaves the outer envelope whole in the rest', () => {
    expect(readAnswerEnvelopes(text)).toEqual({ envelopes: [parseAskSteer(A2)], rest: `Keep these notes.\n${A1}` });
  });

  it('the split gives the words and both envelopes, in the order they were taken; each part split again is that part', () => {
    const parts = splitPersonsMessage(message);
    expect(parts).toEqual([{ ...message, content: 'Keep these notes.' }, envelopeEvent(message, A2), envelopeEvent(message, A1)]);
    for (const part of parts) expect(splitPersonsMessage(part)[0]).toBe(part);
    expect(personsParts(text)).toEqual({ own: 'Keep these notes.', envelopes: [A2, A1] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The engine's own copies of a message's text (decision 9)

describe('personsWords', () => {
  it.each(PROBE_JOINS.filter((name) => !name.startsWith('u704-end-image')))('%s: the joined text gives the prompt, or nothing where only envelopes were joined', (name) => {
    const { joined, prompt } = recordedJoin(name);
    expect(personsWords(joined.content as string)).toBe(prompt);
  });
});

describe('flatPersonsWords, over the recorded last-prompt rows', () => {
  const lastPrompt = (row: unknown): string => {
    const { type, lastPrompt: line } = row as { type: string; lastPrompt: string };
    expect(type).toBe('last-prompt');
    return line;
  };
  const transcriptLine = (name: string, line: number) => lastPrompt(loadUxwaveTranscript(name)[line - 1]);
  const p1Line53 = () => lastPrompt(JSON.parse(readFileSync(join(TEST_FIXTURE_DIR, 'transcripts', 'p1-maws-ask-async.jsonl'), 'utf8').split('\n')[52]!));

  it('envelope first (a lone envelope’s, p1-maws-ask-async line 53; the joined ones of u704-end-image-1 L59, -2 L57 and u704-end-two-envelopes-1 L55): nothing of the person’s is left', () => {
    for (const line of [p1Line53(), transcriptLine('u704-end-image-1', 59), transcriptLine('u704-end-image-2', 57), transcriptLine('u704-end-two-envelopes-1', 55)]) {
      expect(line.startsWith('[MAWS ask ')).toBe(true);
      expect(flatPersonsWords(line)).toBeNull();
    }
  });

  it('prompt first (the rewind’s row, u704-rewind-1 L54, cut inside the opening sentence): the person’s words', () => {
    const line = transcriptLine('u704-rewind-1', 54);
    expect(line.endsWith('The user answered the questions you as…')).toBe(true); // the engine's cut falls inside the opening sentence
    expect(flatPersonsWords(line)).toBe(recordedJoin('u704-rewind-1').prompt);
  });

  // The task review of M1: the engine's cut can fall anywhere in the tag or the opening sentence, the bracket included
  it('made by hand: a line closed with `…` at every cut position through the tag and the opening sentence gives the words, or nothing at the line’s start', () => {
    const opening = askSteerOpening('toolu_01UXWNoSuchAskInThisSession');
    for (let length = 1; length <= opening.length; length++) {
      const head = `${opening.slice(0, length)}…`;
      expect(flatPersonsWords(`Keep these notes. ${head}`), head).toBe('Keep these notes.');
      expect(flatPersonsWords(head), head).toBeNull();
    }
    expect(flatPersonsWords('Keep these notes. [MAWS ask ask-1]…')).toBe('Keep these notes.');
  });

  it('made by hand: a line not closed with `…` that holds a head of the opening sentence is unchanged', () => {
    const opening = askSteerOpening('ask-1');
    for (const length of [1, 10, 15, 16, 17, opening.length - 1]) {
      const line = `Keep these notes. ${opening.slice(0, length)}`;
      expect(flatPersonsWords(line), line).toBe(line);
    }
    expect(flatPersonsWords('Keep these notes. [MAWS ask ask-1] The user answered the questions you as… and more')).toBe('Keep these notes. [MAWS ask ask-1] The user answered the questions you as… and more');
  });

  it('a line without the opening sentence is unchanged, the tag mid-word or alone included', () => {
    for (const line of ['Run the tests and tell me what failed.', 'Please read [MAWS ask ask-1] as a label', 'notes[MAWS ask ask-1] The user answered the questions you asked: none']) expect(flatPersonsWords(line)).toBe(line);
  });

  it('made by hand: the whole opening sentence after the person’s words, the line not cut', () => {
    expect(flatPersonsWords(`Also fix the footer. ${A1.replaceAll('\n', ' ')}`)).toBe('Also fix the footer.');
  });
});

describe('answerOutsideTranscript (ruling A)', () => {
  it('an answer reads as nothing outside the transcript', () => {
    expect(answerOutsideTranscript(A1)).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// personsText (decision 12; the reader's rule 3)

describe('the arrivals of a person’s row that holds envelopes', () => {
  const joinedLine = (name: string) => loadUxwaveTranscript(name).find((row) => (row as { mergedSendUuids?: unknown }).mergedSendUuids !== undefined)!;
  it.each(PROBE_JOINS)('%s: the file’s joined line gives one answer per envelope, its summary the envelope’s text', (name) => {
    const { envelopes } = recordedJoin(name);
    expect(readArrivals(joinedLine(name))).toEqual(envelopes.map((envelope) => {
      const steer = parseAskSteer(envelope)!;
      return { class: 'answer', tool: 'maws', call: steer.askId, summary: envelope, answers: steer.result.answers, dismissed: false };
    }));
  });

  it('a consent message reads as before', () => {
    const row = { type: 'user', uuid: 'c0c0c0c0-0000-4000-8000-000000000704', origin: { kind: 'human' }, message: { role: 'user', content: consentMessage('command', 'pnpm test') } };
    expect(readArrivals(row)).toEqual([{ class: 'consent', kind: 'command', subject: 'pnpm test' }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// answerEnvelopeOf: the one reading of "this content is an answer envelope" (the Decision Log's ruling of 2026-11-16 on
// the branch panel's findings)

describe('answerEnvelopeOf: a content is an answer envelope only where the split reads it as one envelope alone', () => {
  const IMAGE: ContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  const text = (value: string): ContentBlock => ({ type: 'text', text: value });
  const message = (content: string | ContentBlock[]): UserMessage => ({ kind: 'user.message', messageUuid: 'b7a1c2d3-0000-4000-8000-000000000707' as MessageUuid, content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  const askOf = (content: string | ContentBlock[]) => {
    const answer = answerEnvelopeOf(content);
    return answer === null ? null : { askId: answer.call, answers: answer.answers };
  };
  const recordedEnvelopes = [...PROBE_JOINS, ...U4B_JOINS].flatMap((name) => recordedJoin(name).envelopes);
  // made by hand: the tag of a held ask and a closing answered block of no answers, around words that are not the
  // writer's first line
  const LOG = `[MAWS ask ask-1] Please explain this log:\n\`\`\`json\n${JSON.stringify({ status: 'answered', askId: 'ask-1', answers: [] }, null, 2)}\n\`\`\``;
  const cut = A1.indexOf('\n```json');
  const [HEAD, TAIL] = [A1.slice(0, cut), A1.slice(cut + 1)];

  it('a text, or a single text block, that is one envelope whole gives its ask and its answers: the recorded envelopes and the hand-made ones', () => {
    for (const envelope of [...recordedEnvelopes, A1, MULTI, TAGGED_ENVELOPE]) {
      const steer = parseAskSteer(envelope)!;
      expect(askOf(envelope)).toEqual({ askId: steer.askId, answers: steer.result.answers });
      expect(askOf([text(envelope)])).toEqual({ askId: steer.askId, answers: steer.result.answers });
    }
  });

  it('made by hand: a text that opens with the tag but not with the writer’s whole first line is none, though parseAskSteer reads it', () => {
    expect(parseAskSteer(LOG)).not.toBeNull();
    expect(answerEnvelopeOf(LOG)).toBeNull();
    expect(answerEnvelopeOf([text(LOG)])).toBeNull();
  });

  it('made by hand: an envelope spread over two text blocks, beside an image or not, is none; so is a whole envelope beside any other block, or beside anything at all', () => {
    expect(parseAskSteer(`${HEAD}\n${TAIL}`)).not.toBeNull();
    for (const content of [[text(HEAD), text(TAIL), IMAGE], [text(HEAD), text(TAIL)], [text(A1), IMAGE], [IMAGE, text(A1)], [text(A1), text('')], `${A1}\n`, `Also this.\n${A1}`, joinedText(A1, A2), '', []]) {
      expect(answerEnvelopeOf(content as string | ContentBlock[]), JSON.stringify(content).slice(0, 60)).toBeNull();
    }
  });

  it('holds for a message the split returns as it is for being one envelope alone, and for every envelope it splits out; never for the person’s part, nor for a message that holds no envelope', () => {
    const contents: (string | ContentBlock[])[] = [...READER_CORPUS, `${A1}\n`, LOG, joinedText(LOG, A1)].flatMap((value) => [value, [text(value)], [text(value), IMAGE]]);
    let envelopes = 0;
    for (const content of contents) {
      const before = message(content);
      const parts = splitPersonsMessage(before);
      const { own, envelopes: read } = personsParts(content);
      if (parts.length === 1 && parts[0] === before) {
        expect(answerEnvelopeOf(content) !== null, JSON.stringify(content).slice(0, 60)).toBe(read.length > 0);
        continue;
      }
      parts.forEach((part, at) => {
        const isEnvelope = own === null || at > 0;
        expect(answerEnvelopeOf(part.content) !== null, JSON.stringify(part.content).slice(0, 60)).toBe(isEnvelope);
        if (isEnvelope) expect(answerEnvelopeOf(part.content)!.call).toBe(parseAskSteer(part.content as string)!.askId);
        if (isEnvelope) envelopes += 1;
      });
    }
    expect(envelopes).toBeGreaterThan(contents.length / 3); // the corpus splits envelopes out, not only plain texts
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// U1c's grant readers at the chain's merge (the UX wave's U1c, "Approve and retry", met this landing at the merge of the
// chain head): the grants in a person's message are read in the part the split leaves the person, so a grant is never
// read on an envelope's line, and the envelopes beside it are the answers the split splits out. Made by hand (no
// recording holds a grant joined with an envelope): the grant is the sentence U1c sends, the envelopes MAWS's own.

// The grant readers read the whole joined text by rule R (ticket 704, the architect's ruling 1 of 2026-11-16), never the
// part the split draws as the person's; the split's parts and the answers it records stand beside them
describe('the grant readers (rule R, the whole joined text) beside the split', () => {
  const GRANT = consentMessage('command', 'pnpm test');
  const consent = { class: 'consent', kind: 'command', subject: 'pnpm test' };
  const answerOf = (envelope: string) => {
    const steer = parseAskSteer(envelope)!;
    return { class: 'answer', tool: 'maws', call: steer.askId, summary: envelope, answers: steer.result.answers, dismissed: false };
  };
  const row = (content: string | ContentBlock[]) => ({ type: 'user', uuid: 'c0c0c0c0-0000-4000-8000-000000000708', origin: { kind: 'human' }, message: { role: 'user', content } });
  const message = (content: string): UserMessage => ({ kind: 'user.message', messageUuid: 'c0c0c0c0-0000-4000-8000-000000000708' as MessageUuid, content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });

  it('an answer, the grant and an answer again: three parts for the split, the grant rule R reads, and an answer each for the envelopes', () => {
    const text = joinedText(A1, GRANT, A1); // the tracker's A + G + A: the same envelope again
    expect(splitPersonsMessage(message(text)).map((part) => part.content)).toEqual([GRANT, A1, A1]);
    expect(personsParts(text)).toEqual({ own: GRANT, envelopes: [A1, A1] });
    expect(personsGrants(text)).toEqual([consent]);
    expect(readArrivals(row(text))).toEqual([answerOf(A1), answerOf(A1), consent]);
  });

  // a question of the agent's may hold any line, the grant's sentence among them: in its envelope that line is the
  // envelope's, whatever surrounds it. Since board ticket 711 only an earlier build's envelope holds the question's words
  // (this build's writes none), so the envelope that quotes it is an earlier build's
  const ASKED: AskQuestion = { id: 'q1', question: `Which of these should run?\n${GRANT}\nPick one.`, modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
  const QUOTING = earlierAskSteerText('ask-8', [ASKED], [{ id: 'q1', question: ASKED.question, status: 'answered', value: ['Grid'] }]);

  it('this build’s envelope for that question holds no line of the grant’s sentence', () => {
    expect(quotesGrant(askSteerText('ask-8', [ASKED], [{ id: 'q1', question: ASKED.question, status: 'answered', value: ['Grid'] }]))).toBe(false);
  });

  it('a grant’s sentence on a line of an envelope is no grant, the envelope alone or joined with words', () => {
    expect(QUOTING.split('\n')).toContain(GRANT);
    for (const text of [QUOTING, joinedText('Keep these notes.', QUOTING)]) {
      expect(personsGrants(text), text.slice(0, 40)).toEqual([]);
      expect(readArrivals(row(text)).filter((arrival) => arrival.class === 'consent')).toEqual([]);
    }
  });

  it('made by hand: where that envelope’s lines stand around another whole envelope, the split takes both out, and rule R reads no grant', () => {
    const lines = QUOTING.split('\n');
    const text = `Keep these notes.\n${lines.slice(0, 2).join('\n')}\n${A2}\n${lines.slice(2).join('\n')}`;
    expect(personsParts(text)).toEqual({ own: 'Keep these notes.', envelopes: [A2, QUOTING] });
    expect(personsGrants(text)).toEqual([]);
    expect(readArrivals(row(text))).toEqual([answerOf(A2), answerOf(QUOTING)]);
  });
  // The split reads each text block by itself and does not read an envelope spread over two (decision 7), so such a text
  // is the person's own for the split and records no answer. Rule R reads the whole joined text: where the joined
  // blocks make this build's envelope whole, it is taken out strictly and the grant beside it is read; an earlier
  // build's envelope fails closed (ruling 1 of 2026-11-16; the cascade reviews' A2 is gone)
  it('made by hand: an envelope spread over two text-only blocks is the person’s text for the split, no answer read of it; rule R reads the joined text: the grant beside this build’s envelope, none in the earlier build’s quoting one', () => {
    const block = (text: string): ContentBlock => ({ type: 'text', text });
    const [head, tail] = [A1.split('\n').slice(0, 2).join('\n'), A1.split('\n').slice(2).join('\n')];
    const spread = [block(head), block(`${tail}\n${GRANT}`)];
    expect(personsParts(spread)).toEqual({ own: spread, envelopes: [] });
    expect(readArrivals(row(spread)), 'the envelope spread over the blocks is no answer; the grant beside it, rule R’s').toEqual([consent]);
    const quoting = QUOTING.split('\n');
    const quoted = [block(`Keep these notes.\n${quoting.slice(0, 3).join('\n')}`), block(quoting.slice(3).join('\n'))];
    expect(quoting[2]).toBe(GRANT); // the grant's sentence is the head block's last line
    expect(personsParts(quoted)).toEqual({ own: quoted, envelopes: [] });
    expect(readArrivals(row(quoted)), 'the sentence quoted on a line of the spread envelope is no grant').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Board ticket 711, at its cascade merge into this landing (2026-11-16): this build's writer writes the envelope's new
// form (a question by its number, `q<n>` in the block, a pick as `option <k>`, the block's `question` empty: no text the
// model wrote); a session read now may hold an earlier build's (`earlierAskSteerText`). The first line is the same in
// both, so the split and the exact reader read either alike; only the block differs. Every envelope here is written by
// the real writers, with invented questions and answers.

type Writer = (askId: string, questions: readonly AskQuestion[], answers: readonly AskAnswer[]) => string;
const FORMS: [string, Writer][] = [['the new form', askSteerText], ['an earlier build’s form', earlierAskSteerText]];
const TONE: AskQuestion = { id: 'tone', question: 'Which tone should the copy take?', header: 'Tone', modality: 'choice', options: [{ label: 'Plain' }, { label: 'Warm' }] };
const FOOTER: AskQuestion = { id: 'footer', question: 'What should the footer say?', modality: 'text' };
const SIZE: AskQuestion = { id: 'size', question: 'How large should the tiles be?', header: 'Size', modality: 'choice', options: [{ label: 'Small' }, { label: 'Large' }] };
// a choice with a note, a text answer and a skipped one
const ANSWERED: AskAnswer[] = [
  { id: 'tone', question: TONE.question, status: 'answered', value: ['Warm'], note: 'for the landing page' },
  { id: 'footer', question: FOOTER.question, status: 'answered', value: 'Made with care' },
  { id: 'size', question: SIZE.question, status: 'skipped' },
];
const envelopeIn = (write: Writer, askId = 'toolu_n1') => write(askId, [TONE, FOOTER, SIZE], ANSWERED);
const secondIn = (write: Writer) => write('toolu_n2', [TONE], [{ id: 'tone', question: TONE.question, status: 'answered', value: ['Plain'] }]);
const NEW_FORM_GRANT = consentMessage('command', 'pnpm test');
const NEW_FORM_WORDS = 'Also fix the footer.';
const joinedMessage = (content: string): UserMessage => ({
  kind: 'user.message', messageUuid: 'd1d1d1d1-0000-4000-8000-000000000711' as MessageUuid, content, isReplay: true, isSynthetic: false, origin: 'human', bash: null,
  joined: ['d1d1d1d1-0000-4000-8000-000000000712' as MessageUuid],
});
const contentsOf = (parts: UserMessage[]) => parts.map((part) => part.content);
// anything of an envelope, of either form: its tag, its block's fence or status, a pick by its place, a numbered line
const holdsEnvelopeText = (text: string) => text.includes('[MAWS ask') || text.includes('```') || text.includes('"answered"') || /option \d/.test(text) || /^\d+\./m.test(text);

describe('the envelope’s new form (board ticket 711): the split and the exact reader read it as the earlier form', () => {
  it('the new form keeps the earlier form’s first line; its lines are a question’s number, a pick by its place, a text answer as a JSON string, a skipped one and a note; its block’s questions are empty', () => {
    const [fresh, earlier] = FORMS.map(([, write]) => envelopeIn(write).split('\n'));
    expect(fresh![0]).toBe(askSteerOpening('toolu_n1'));
    expect(earlier![0]).toBe(fresh![0]);
    expect(fresh!.slice(1, 5)).toEqual(['1. option 2', '   note: "for the landing page"', '2. "Made with care"', '3. skipped']);
    expect(parseAskSteer(fresh!.join('\n'))!.result.answers.map((answer) => [answer.id, answer.question, answer.value ?? null])).toEqual([['q1', '', ['option 2']], ['q2', '', 'Made with care'], ['q3', '', null]]);
    expect(fresh!.join('\n')).not.toContain(TONE.question);
    expect(earlier!.join('\n')).toContain(TONE.header);
  });

  describe.each(FORMS)('%s', (_, write) => {
    const E = envelopeIn(write);
    const F = secondIn(write);

    it('an envelope alone: the same object from the split, and the exact reader’s answer, its ask and its block’s answers', () => {
      const lone = joinedMessage(E);
      expect(splitPersonsMessage(lone)).toEqual([lone]);
      expect(splitPersonsMessage(lone)[0]).toBe(lone);
      const answer = { class: 'answer', tool: 'maws', call: 'toolu_n1', summary: E, answers: parseAskSteer(E)!.result.answers, dismissed: false };
      expect(readAnswerEnvelope(E)).toEqual(answer);
      expect(answerEnvelopeOf(E)).toEqual(answer);
      expect(answerEnvelopeOf([{ type: 'text', text: E }])).toEqual(answer);
    });

    it('the person’s words and an envelope, in either order: the words, then the envelope byte for byte under the same uuid, `joined` on the first', () => {
      for (const text of [joinedText(NEW_FORM_WORDS, E), joinedText(E, NEW_FORM_WORDS)]) {
        const message = joinedMessage(text);
        const parts = splitPersonsMessage(message);
        expect(contentsOf(parts)).toEqual([NEW_FORM_WORDS, E]);
        expect(parts.map((part) => [part.messageUuid, part.joined ?? null])).toEqual([[message.messageUuid, message.joined], [message.messageUuid, null]]);
        expect(answerEnvelopeOf(parts[1]!.content)?.call).toBe('toolu_n1');
        for (const part of parts) expect(splitPersonsMessage(part)[0]).toBe(part);
      }
    });

    it('an answer, a grant and the answer again: the split draws the grant, then each envelope; rule R reads the grant in this build’s form, none in an earlier build’s', () => {
      const text = joinedText(E, NEW_FORM_GRANT, E);
      expect(contentsOf(splitPersonsMessage(joinedMessage(text)))).toEqual([NEW_FORM_GRANT, E, E]);
      expect(personsGrants(text)).toEqual(write === askSteerText ? [{ class: 'consent', kind: 'command', subject: 'pnpm test' }] : []);
    });

    it('two envelopes: one event each, the first keeping `joined`', () => {
      const parts = splitPersonsMessage(joinedMessage(joinedText(E, F)));
      expect(contentsOf(parts)).toEqual([E, F]);
      expect(parts.map((part) => part.joined ?? null)).toEqual([joinedMessage(E).joined, null]);
    });

    // the landing's case (b): an envelope joined with the person's own words in one row
    it('the person’s part holds nothing of the envelope', () => {
      for (const text of [joinedText(NEW_FORM_WORDS, E), joinedText(E, NEW_FORM_WORDS), joinedText('First this.', E, 'Then that.'), joinedText(E, NEW_FORM_GRANT, F)]) {
        const own = personsParts(text).own as string;
        expect(holdsEnvelopeText(own), own).toBe(false);
        expect(personsWords(text)).toBe(own);
        expect(ownWordsOf(text)).toBe(own);
      }
    });

    // the landing's case (c), U1c's Decision Log 56: the consent sentence the person typed as a text answer is a JSON
    // string on the envelope's line and inside its block, never a line of their own words. This pins the writer only:
    // the writer quotes the sentence, so no line holds it and no reader is put to the test
    it('a typed text answer that holds the consent sentence: no grant, the envelope alone or beside the person’s words', () => {
      const typed = write('toolu_n3', [FOOTER], [{ id: 'footer', question: FOOTER.question, status: 'answered', value: NEW_FORM_GRANT }]);
      expect(typed.split('\n')).not.toContain(NEW_FORM_GRANT);
      const lone = joinedMessage(typed);
      expect(splitPersonsMessage(lone)[0]).toBe(lone);
      for (const text of [typed, joinedText(NEW_FORM_WORDS, typed), joinedText(typed, NEW_FORM_WORDS)]) {
        const parts = splitPersonsMessage(joinedMessage(text));
        expect(contentsOf(parts).at(-1)).toBe(typed);
        for (const part of parts) expect(personsGrants(messageText(part.content)), String(part.content).slice(0, 40)).toEqual([]);
        expect(personsGrants(text)).toEqual([]);
      }
    });
  });
});

// U3b's reader of a person's own words (`ownWordsOf`, landing 1's readers, at the cascade): MAWS's envelopes taken out as
// the split takes them, through the reader's one loop
describe('ownWordsOf reads a person’s words as the split does', () => {
  it.each(FORMS)('made by hand, %s: where one envelope’s lines stand around another whole envelope, ownWordsOf takes both out, as the split does', (_, write) => {
    const outer = envelopeIn(write).split('\n');
    const text = `Keep these notes.\n${outer.slice(0, 2).join('\n')}\n${secondIn(write)}\n${outer.slice(2).join('\n')}`;
    expect(personsWords(text)).toBe('Keep these notes.');
    expect(ownWordsOf(text)).toBe(personsWords(text));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The inputs the cascade reviews' A2 pinned (a person's part that still holds an envelope's opening line), read by
// rule R (ticket 704, the architect's ruling 1 of 2026-11-16): the one reader of grants, on the whole joined text, never
// on the part the split draws as the person's. A2's defence at the grant readers is gone; rule R fails closed on an
// opening line it cannot read strictly, on an earlier build's envelope, and on an envelope's tag left anywhere.

describe('rule R on the inputs A2 pinned: the grants of the whole joined text', () => {
  const GRANT = consentMessage('command', 'make deploy');
  const DEPLOY = { class: 'consent', kind: 'command', subject: 'make deploy' };
  const row = (content: string) => ({ type: 'user', uuid: 'c0c0c0c0-0000-4000-8000-000000000709', origin: { kind: 'human' }, message: { role: 'user', content } });
  const consents = (text: string) => readArrivals(row(text)).filter((arrival) => arrival.class === 'consent');
  // an earlier build's envelope whose question holds the sentence and another ask's opening line on lines of their own
  const INNER = innerOpeningEnvelope('toolu_A', GRANT);
  // decision 7's limit: an envelope cut before its block is no envelope, and its opening line stays in the text
  const CUT = A1.slice(0, A1.indexOf('\n```json'));

  it('made by hand: the brief’s envelope, its question holding the consent sentence and another ask’s opening line, alone or beside the person’s words: no grant, no consent', () => {
    expect(INNER.split('\n')).toEqual(expect.arrayContaining([GRANT, askSteerOpening('toolu_inner')]));
    for (const text of [INNER, joinedText('Keep these notes.', INNER), joinedText(INNER, 'Keep these notes.')]) {
      expect(personsGrants(text), text.slice(0, 40)).toEqual([]);
      expect(consents(text), text.slice(0, 40)).toEqual([]);
    }
  });

  it('made by hand: an envelope cut before its block, beside a grant line in either order: its opening line does not read strictly, so no grant', () => {
    expect(personsParts(CUT)).toEqual({ own: CUT, envelopes: [] });
    for (const text of [joinedText(GRANT, CUT), joinedText(CUT, GRANT)]) {
      expect(personsGrants(text), text.slice(0, 40)).toEqual([]);
      expect(consents(text), text.slice(0, 40)).toEqual([]);
    }
  });

  it('an answer, the grant and the answer again: the grant in this build’s form, none in an earlier build’s (rule R’s accepted cost)', () => {
    for (const [form, write] of FORMS) {
      const answer = envelopeIn(write);
      const expected = write === askSteerText ? [DEPLOY] : [];
      expect(personsGrants(joinedText(answer, GRANT, answer)), form).toEqual(expected);
      expect(consents(joinedText(answer, GRANT, answer)), form).toEqual(expected);
    }
  });

  it('a grant beside a pasted segment that holds an envelope: the grant beside this build’s envelope, taken out strictly; none beside the brief’s envelope, its tag left over failing closed, pasted or not (rule R’s accepted cost)', () => {
    const pastedCurrent = joinedText(GRANT, framePasted('a1b2', A1));
    expect(personsGrants(pastedCurrent)).toEqual([DEPLOY]);
    expect(consents(pastedCurrent)).toEqual([DEPLOY]);
    const pastedEarlier = joinedText(framePasted('a1b2', INNER), GRANT);
    expect(personsGrants(pastedEarlier)).toEqual([]);
    expect(consents(pastedEarlier)).toEqual([]);
  });
});

// Ticket 704, the architect's ruling 7 of 2026-11-16: the earlier review's finding (an earlier build's envelope whose
// question holds the consent sentence and a whole opening line for another ask) read by the save rule and by rule R, as
// a row the person wrote and as a prompt they queued. The sentence's command and the words beside it link a path, so a
// text the save rule counted would name it (the control); this one is read only, its envelope's tag a form MAWS writes
// (`rowClaim`), and yields no grant. Made by hand: no recording holds such a question.
describe('made by hand: the earlier review’s envelope names nothing for a save outside a session’s folders and yields no grant', () => {
  const P = '/work/out/report.md';
  const LINK = `[r](${P})`;
  const INNER = innerOpeningEnvelope('toolu_A', consentMessage('command', `open ${LINK}`));
  const user = (content: string) => ({ type: 'user', uuid: 'c0c0c0c0-0000-4000-8000-000000000712', origin: { kind: 'human' }, message: { role: 'user', content } });
  const consents = (row: unknown) => readArrivals(row).filter((arrival) => arrival.class === 'consent');

  it('the person’s own words that link the path name it, at rest and queued (the control)', () => {
    expect(rowClaim(user(`Open ${LINK}`), P)).toEqual({ names: true });
    expect(rowClaim(queuedPrompt(`Open ${LINK}`), P)).toEqual({ names: true });
  });

  it.each([
    ['alone', INNER],
    ['after the person’s words that link the path', joinedText(`Open ${LINK}`, INNER)],
    ['before them', joinedText(INNER, `Open ${LINK}`)],
  ])('%s, at rest and queued: not the person’s naming of the path, and no grant', (_, text) => {
    expect(INNER.split('\n')).toEqual(expect.arrayContaining([askSteerOpening('toolu_A'), askSteerOpening('toolu_inner')]));
    for (const row of [user(text), queuedPrompt(text)]) {
      expect(rowClaim(row, P), JSON.stringify(row).slice(0, 80)).toEqual({ names: false, pending: [], other: true });
      expect(consents(row)).toEqual([]);
    }
    expect(personsGrants(text)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The reader's bound kept from U4b (a slice ends before the next opening line), with the reading past it (the cascade
// reviews' A) dropped by the architect's ruling 2 of 2026-11-16: with rule R carrying the grants, that reading only
// redrew forged earlier-form envelopes. An earlier build's envelope whose question holds another ask's whole opening
// line is bounded out and stays text. Made by hand: no recording holds such a question.

describe('made by hand: the reader’s bound, with no reading past it', () => {
  const GRANT = consentMessage('command', 'make deploy');
  const INNER = innerOpeningEnvelope('toolu_A', GRANT);
  const WORDS = 'Keep these notes.';
  const message = (content: string): UserMessage => ({ kind: 'user.message', messageUuid: 'c0c0c0c0-0000-4000-8000-000000000710' as MessageUuid, content, isReplay: true, isSynthetic: false, origin: 'human', bash: null });
  const slicesOf = (text: string) => envelopeSlices(text, askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS);
  const loop = (text: string) => takeEnvelopesOut(text, slicesOf);

  it('the brief’s envelope stays text, alone or beside the person’s words: no answer, the message as it came, and no grant', () => {
    expect(INNER.split('\n').filter((line) => line.startsWith('[MAWS ask '))).toEqual([askSteerOpening('toolu_A'), askSteerOpening('toolu_inner')]);
    expect(answerEnvelopeOf(INNER)).toBeNull();
    for (const text of [INNER, joinedText(WORDS, INNER), joinedText(INNER, WORDS)]) {
      expect(loop(text), text.slice(0, 40)).toEqual({ own: text, envelopes: [] });
      const lone = message(text);
      expect(splitPersonsMessage(lone)[0]).toBe(lone);
      expect(personsGrants(text)).toEqual([]);
    }
  });

  it('decision 17’s nested case: the inner envelope taken, then the outer; where the outer one is the brief’s envelope, the inner one alone', () => {
    const lines = A1.split('\n');
    const nested = `${WORDS}\n${lines.slice(0, 2).join('\n')}\n${A2}\n${lines.slice(2).join('\n')}`;
    expect(slicesOf(nested).members.map((member) => member.text)).toEqual([A2]);
    expect(loop(nested).envelopes.map((envelope) => envelope.text)).toEqual([A2, A1]);
    const outer = INNER.split('\n');
    const around = `${WORDS}\n${outer.slice(0, 2).join('\n')}\n${A2}\n${outer.slice(2).join('\n')}`;
    expect(loop(around)).toEqual({ own: joinedText(WORDS, INNER), envelopes: [{ text: A2, read: parseAskSteer(A2) }] });
  });

  it('a later valid member is never swallowed: a malformed member, words, then a valid one, for another ask or the same', () => {
    for (const [broken, valid] of [[BROKEN, A2], [BROKEN, A1]] as const) {
      const text = joinedText(broken, WORDS, valid);
      expect(loop(text), text.slice(0, 40)).toEqual({ own: joinedText(broken, WORDS), envelopes: [{ text: valid, read: parseAskSteer(valid) }] });
    }
  });

  it('an opening line followed by lines and a block naming another ask stays text', () => {
    const head = `${askSteerOpening('toolu_X')}\n1. Layout — Grid\n${A1.slice(A1.indexOf('```json'))}`;
    for (const text of [head, joinedText(WORDS, head)]) {
      expect(parseAskSteer(text)).toBeNull();
      expect(loop(text), text.slice(0, 40)).toEqual({ own: text, envelopes: [] });
      expect(personsGrants(text)).toEqual([]);
    }
  });

  it('a pasted segment never opens or ends one: an envelope pasted whole, and its opening outside a segment that holds its block', () => {
    const lines = A1.split('\n');
    const pastedWhole = joinedText(WORDS, framePasted('a1b2', A1));
    const pastedTail = joinedText(lines.slice(0, 2).join('\n'), framePasted('a1b2', lines.slice(2).join('\n')));
    for (const text of [pastedWhole, pastedTail]) expect(loop(text), text.slice(0, 40)).toEqual({ own: text, envelopes: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The reader's one loop reads at most 16 passes (ticket 704, the architect's ruling 4 of 2026-11-16), pinned by a count
// of the slicer's calls. Made by hand: no recording nests one envelope inside another.

describe('made by hand: takeEnvelopesOut reads at most 16 passes', () => {
  const WORDS = 'Keep these notes.';
  const slicesOf = (text: string) => envelopeSlices(text, askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS);
  const answerOf = (n: number) => askSteerText(`ask-n${n}`, [LAYOUT], [{ id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] }]);
  // `depth` envelopes after the person's words, each one's first two lines and its block around the next one, so a pass
  // takes the innermost whole envelope and leaves the one around it whole for the next pass
  const nested = (depth: number) => {
    let inner = answerOf(depth);
    for (let n = depth - 1; n >= 1; n -= 1) {
      const lines = answerOf(n).split('\n');
      inner = [...lines.slice(0, 2), inner, ...lines.slice(2)].join('\n');
    }
    return joinedText(WORDS, inner);
  };
  const counting = <T>(slice: (text: string) => { members: { text: string; read: T }[]; rest: string }) => {
    const count = { calls: 0 };
    return { count, slice: (text: string) => {
      count.calls += 1;
      if (count.calls > 64) throw new Error('the loop read past 64 passes'); // a failing case fails in bounded time
      return slice(text);
    } };
  };
  const message = (content: string): UserMessage => ({ kind: 'user.message', messageUuid: 'c0c0c0c0-0000-4000-8000-000000000711' as MessageUuid, content, isReplay: true, isSynthetic: false, origin: 'human', bash: null });

  it('15 envelopes nested: each taken, the innermost first, in 16 passes, the last of which takes nothing', () => {
    const { count, slice } = counting(slicesOf);
    const read = takeEnvelopesOut(nested(15), slice);
    expect(read.own).toBe(WORDS);
    expect(read.envelopes.map((envelope) => envelope.text)).toEqual(Array.from({ length: 15 }, (_, i) => answerOf(15 - i)));
    expect(count.calls).toBe(16);
  });

  it('16 envelopes nested: the 16th pass still takes one, so the text is over the bound and left whole, no envelope taken; the split hands the message on as it came', () => {
    const text = nested(16);
    const { count, slice } = counting(slicesOf);
    expect(takeEnvelopesOut(text, slice)).toEqual({ own: text, envelopes: [] });
    expect(count.calls).toBe(16);
    expect(personsParts(text)).toEqual({ own: text, envelopes: [] });
    const lone = message(text);
    expect(splitPersonsMessage(lone)).toEqual([lone]);
    expect(splitPersonsMessage(lone)[0]).toBe(lone);
  });

  it('a slicer that takes a member on every pass and never shortens the text: called 16 times, the text left whole', () => {
    const { count, slice } = counting((text: string) => ({ members: [{ text: 'taken', read: 1 }], rest: text }));
    expect(takeEnvelopesOut('a text', slice)).toEqual({ own: 'a text', envelopes: [] });
    expect(count.calls).toBe(16);
  });

  it('the bound holds from the loop’s own source too, as the search text’s worker runs it', () => {
    const again = isolated(takeEnvelopesOut);
    const { count, slice } = counting((text: string) => ({ members: [{ text: 'taken', read: 1 }], rest: text }));
    expect(again('a text', slice)).toEqual({ own: 'a text', envelopes: [] });
    expect(count.calls).toBe(16);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The frontier review's input (ticket 704): a pass after the first goes over the slicer's cap of checks. Over either
// bound, the cap in a pass or the loop's 16 passes, the text is left whole and no envelope is taken, so what is read
// does not depend on which pass gave up. Made by hand: no recording holds such a text.

describe('made by hand: a later pass over the slicer’s cap leaves the text whole', () => {
  const text = laterPassOverTheCap();
  const slicesOf = (part: string) => envelopeSlices(part, askSteerOpening, pastedBodies, parseAskSteer, MAX_ENVELOPE_CHECKS);
  const IMAGE: ContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  const message = (content: string | ContentBlock[]): UserMessage => ({ kind: 'user.message', messageUuid: 'c0c0c0c0-0000-4000-8000-000000000712' as MessageUuid, content, isReplay: true, isSynthetic: false, origin: 'human', bash: null });

  it('the premise: the first pass takes the inner envelope in one check, and the second, on what it leaves, stops at the cap', () => {
    const first = readAnswerEnvelopesWithCost(text);
    expect(first.cost.checks).toBe(1);
    expect(first.envelopes.map((envelope) => envelope.askId)).toEqual(['inner']);
    const second = readAnswerEnvelopesWithCost(first.rest);
    expect(second.cost.checks).toBe(MAX_ENVELOPE_CHECKS);
    expect(second).toMatchObject({ envelopes: [], rest: first.rest });
  });

  it('the loop takes no envelope and leaves the text whole, from the module and from its own source as the search text’s worker runs it', () => {
    expect(takeEnvelopesOut(text, slicesOf)).toEqual({ own: text, envelopes: [] });
    const [again, slices, paste, block, opening] = [isolated(takeEnvelopesOut), isolated(envelopeSlices), isolated(pastedBodies), isolated(answeredBlock), isolated(askSteerOpening)];
    expect(again(text, (part: string) => slices(part, opening, paste, block, MAX_ENVELOPE_CHECKS))).toEqual({ own: text, envelopes: [] });
  });

  it('the reader and the split hand the message on as it came, as a text and as a text block beside an image', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text }, IMAGE];
    expect(personsParts(text)).toEqual({ own: text, envelopes: [] });
    expect(personsParts(blocks)).toEqual({ own: blocks, envelopes: [] });
    expect(personsWords(text)).toBe(text);
    for (const content of [text, blocks]) {
      const lone = message(content);
      expect(splitPersonsMessage(lone)).toEqual([lone]);
      expect(splitPersonsMessage(lone)[0]).toBe(lone);
    }
  });
});
