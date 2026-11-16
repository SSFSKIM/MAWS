// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M1): a person's message read apart where it becomes
// an event. The joined texts are the probes' recordings (test/support/recorded-joins.ts); a case no recording holds
// says so in its name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framePasted, PASTED_BLOCK } from '@shared/composer/pasted-content';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { answeredBlock, askSteerOpening, askSteerText, parseAskSteer } from '@shared/maws/ask';
import type { AskQuestion } from '@shared/maws/tools';
import { FIXTURE_DIR, loadUxwaveTranscript, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { PROBE_JOINS, recordedJoin, U4B_JOINS, type RecordedJoin } from '../../../test/support/recorded-joins';
import { consentMessage, envelopeSlices, readAnswerEnvelopes, readArrivals } from './arrival';
import { answerOutsideTranscript, flatPersonsWords, personsParts, personsWords, splitPersonsMessage, type UserMessage } from './persons-message';

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
const TAGGED_ENVELOPE = askSteerText('ask-7', [TAGGED], [{ id: 'q1', question: TAGGED.question, status: 'answered', value: ['Star'] }]);
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

// A function as the search text's worker gets it: its own source evaluated with nothing of its module in scope
const isolated = <F>(fn: F): F => new Function(`return (${String(fn)});`)() as F;

describe('envelopeSlices', () => {
  it.each(PROBE_JOINS.filter((name) => !name.startsWith('u704-end-image')))('%s: one member per envelope, its text the envelope member’s frame content byte for byte, and the rest the prompt', (name) => {
    const { joined, envelopes, prompt } = recordedJoin(name);
    const { members, rest } = envelopeSlices(joined.content as string, askSteerOpening, PASTED_BLOCK, parseAskSteer);
    expect(members.map((member) => member.text)).toEqual(envelopes);
    expect(members.map((member) => member.read)).toEqual(envelopes.map((envelope) => parseAskSteer(envelope)));
    expect(rest).toBe(prompt ?? '');
  });

  it.each(['u704-end-image-1', 'u704-end-image-2'])('%s: the envelope’s text block gives the envelope byte for byte and an empty rest', (name) => {
    const { joined, envelopes } = recordedJoin(name);
    const { members, rest } = envelopeSlices(textOf((joined.content as ContentBlock[])[0]), askSteerOpening, PASTED_BLOCK, parseAskSteer);
    expect(members.map((member) => member.text)).toEqual(envelopes);
    expect(rest).toBe('');
  });

  it('readAnswerEnvelopes is envelopeSlices with the writer’s opening, the pasted segment and parseAskSteer, over the whole corpus', () => {
    for (const text of READER_CORPUS) {
      const { members, rest } = envelopeSlices(text, askSteerOpening, PASTED_BLOCK, parseAskSteer);
      expect(readAnswerEnvelopes(text)).toEqual({ envelopes: members.map((member) => member.read), rest });
    }
  });

  it('envelopeSlices, answeredBlock, askSteerOpening and answerOutsideTranscript run from their own source, nothing else in scope, and read the corpus as the module does', () => {
    const [slices, block, opening, outside] = [isolated(envelopeSlices), isolated(answeredBlock), isolated(askSteerOpening), isolated(answerOutsideTranscript)];
    let read = 0;
    for (const text of READER_CORPUS) {
      const own = slices(text, opening, PASTED_BLOCK, block);
      expect(own).toEqual(envelopeSlices(text, askSteerOpening, PASTED_BLOCK, answeredBlock));
      own.members.forEach((member) => expect(outside(member.text)).toBe(answerOutsideTranscript(member.text)));
      read += own.members.length;
    }
    expect(read).toBeGreaterThan(READER_CORPUS.length / 2); // the corpus holds envelopes, not only plain texts
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
