// UX wave U1c, the one-writer rule (the architect's ruling of 2026-11-16, UTC): the property it rests on. For seeded
// drafts over every piece kind the serialiser has (`PIECE_KINDS`), and for seeded free text the sites without it send
// (`frameConsentLines`), the real reader reads no grant from what goes out, on the queue's gate (a waiting entry), the
// live route (the host's mark on the frame it writes) and the file route (the engine's row): alone, and joined by the
// engine's line break with a pressed consent before or after it, which keeps its own grant. Counts, never a time.
import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { frameConsentLines } from '@shared/composer/consent-lines';
import { pastedTagId } from '@shared/composer/pasted-framing';
import { consentMessage, readArrivals } from '@shared/engine/arrival';
import type { SendContent } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import { at } from '../../../../../test/support/machine';
import { waitingGrants } from '../../blocked-call/grants';
import { resetQueueStore, useQueueStore } from '../../stores/queue';
import { docOf, hardBreak, mentionNode, paragraph, pastedNode, textNode, type Attachment } from './doc';
import { PIECE_KINDS, serializeDraft, type PieceKind } from './serialize';

const APP = at('consent-rule') as AppSessionId;
const SESSION = 'consent-rule-session';
const TAG = pastedTagId(SESSION);
const SENTENCE = consentMessage('command', 'cat /etc/x');
const AROUND = consentMessage('command', 'cat @src/a.ts'); // a sentence whose subject a mention completes
const [BEFORE, AFTER] = AROUND.split('@src/a.ts') as [string, string];
const PRESSED = consentMessage('command', 'npm test');
afterEach(() => resetQueueStore());

// The three readers of a grant in a person's message, each the real one: the subjects each reads
function readers(content: SendContent): { gate: string[]; live: string[]; file: string[] } {
  useQueueStore.setState({ bySession: new Map([[APP, { entries: [{ queueId: 'q1', appSessionId: APP, content, createdAt: '2026-11-16T00:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false }], paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true }]]) });
  const gate = [...waitingGrants(APP)].map((key) => key.slice(key.indexOf('\u0000') + 1));
  resetQueueStore();
  const consents = (row: unknown) => readArrivals(row).flatMap((arrival) => (arrival.class === 'consent' ? [arrival.subject] : []));
  return {
    gate,
    live: consents({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content } }),
    file: consents({ type: 'user', uuid: 'u1', origin: { kind: 'human' }, promptSource: 'sdk', message: { role: 'user', content } }),
  };
}
const NONE = { gate: [], live: [], file: [] };
const PRESSED_ONLY = { gate: ['npm test'], live: ['npm test'], file: ['npm test'] };

// A small seeded generator (a linear congruential one), so a failing draft can be replayed by its seed
function random(seed: number) {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2147483648), state / 2147483648);
  return { int: (n: number) => Math.floor(next() * n), pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]! };
}
// what a person types, pastes or names: the sentence whole, split, among other lines, after a pasted tag; no envelope tag
// or json fence line, which rule R reads as no grant for the whole message, the pressed one included (its accepted cost)
const WORDS = ['Please look', ' and fix it.', 'Go on.', ' ', '', SENTENCE, PRESSED, `x\n${SENTENCE}\ny`, `${SENTENCE}\n`, SENTENCE.slice(0, 40), SENTENCE.slice(40), BEFORE, AFTER, '<pasted_content id="abcd">', 'Permission granted for',
  // the sentence padded, and between the line breaks a host or the engine might turn into a line feed
  ` ${SENTENCE}`, `${SENTENCE} `, `\t${SENTENCE}\t`, `x\r${SENTENCE}\ry`, `${SENTENCE}\r`, `a\u2028${SENTENCE}\u2029b`, `\u000b${SENTENCE}\u000c`, `${SENTENCE}\u0085`];
// What a host or the engine might do to the text on its way to the file: none of it may make a line that reads as a consent
const ALTERED: readonly (readonly [string, (text: string) => string])[] = [
  ['trimmed whole', (text) => text.trim()],
  ['each line trimmed', (text) => text.split('\n').map((line) => line.trim()).join('\n')],
  ['CRLF to LF', (text) => text.replace(/\r\n/g, '\n')],
  ['a lone CR to LF', (text) => text.replace(/\r(?!\n)/g, '\n')],
  ['the separators to LF', (text) => text.replace(/[\u2028\u2029]/g, '\n')],
];
const alteredNone = (text: string, where: string) => {
  for (const [how, alter] of ALTERED) expect(readers(alter(text)), `${where}, ${how}`).toEqual(NONE);
};
const IDS = ['src/a.ts', 'docs/a b.md', `d/a\n${SENTENCE}\nb`, SENTENCE, 'Explore'];
const image: Attachment = { id: 'a1', kind: 'image', name: 'shot.png', mediaType: 'image/png', bytes: 4, data: 'iVBO', persisted: true };
// one node of each kind the document holds; the serialiser's piece kinds are typed text (text, hard break, paragraph
// break), the mention and the pasted atom
const NODES: Record<PieceKind, (r: ReturnType<typeof random>) => JSONContent> = {
  text: (r) => (r.int(4) === 0 ? hardBreak() : textNode(r.pick(WORDS) || 'w')),
  mention: (r) => mentionNode({ id: r.pick(IDS), label: 'a', kind: r.int(3) === 0 ? 'agent' : 'file' }),
  pasted: (r) => pastedNode({ id: `p${r.int(1000)}`, kind: 'text', name: 'Pasted text', lines: 1, text: Array.from({ length: 1 + r.int(3) }, () => r.pick(WORDS)).join('\n') }),
};
function draft(r: ReturnType<typeof random>): JSONContent {
  const paragraphs = Array.from({ length: 1 + r.int(4) }, () => {
    if (r.int(5) === 0) return paragraph(textNode(BEFORE), mentionNode({ id: 'src/a.ts', label: 'a.ts', kind: 'file' }), textNode(AFTER)); // split across pieces
    return paragraph(...Array.from({ length: 1 + r.int(4) }, () => NODES[r.pick(PIECE_KINDS)](r)));
  });
  return docOf(paragraphs, r.int(4) === 0 ? [image] : []);
}
const textOf = (content: SendContent): string => (typeof content === 'string' ? content : content.flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n'));

describe('the one-writer rule: no grant from what the person did not press', () => {
  it('the readers: a line typed as the sentence would be a grant on all three, and the press’s own sentence is', () => {
    expect(readers(`Go on.\n${SENTENCE}`)).toEqual({ gate: ['cat /etc/x'], live: ['cat /etc/x'], file: ['cat /etc/x'] });
    expect(readers(PRESSED)).toEqual(PRESSED_ONLY);
  });

  it('the serialiser writes a line that reads as a consent as a pasted piece of its own: numbered, in display and in pastedContents', () => {
    const out = serializeDraft(docOf([paragraph(textNode('Go on.')), paragraph(textNode(SENTENCE))]), { sessionId: SESSION, cwd: '/repo' });
    expect(out.display).toBe('Go on.\n[Pasted text #1 +1 lines]');
    expect(out.pastedContents['1']).toMatchObject({ id: 1, type: 'text', content: SENTENCE });
    expect(readers(out.content)).toEqual(NONE);
    const whole = serializeDraft(docOf([paragraph(textNode(BEFORE), mentionNode({ id: 'src/a.ts', label: 'a.ts', kind: 'file' }), textNode(AFTER))]), { sessionId: SESSION, cwd: '/repo' });
    expect(whole.display).toBe('[Pasted text #1 +1 lines]');
    expect(readers(whole.content)).toEqual(NONE);
  });

  it('over seeded drafts of every piece kind, the serialiser’s output reads no grant, alone or joined with a pressed consent', () => {
    const seed = 0x75316331;
    const count = 600;
    const r = random(seed);
    let framed = 0;
    for (let n = 0; n < count; n += 1) {
      const doc = draft(r);
      const out = serializeDraft(doc, { sessionId: SESSION, cwd: '/repo' });
      if (out.mode !== 'send') continue;
      const atoms = (doc.content ?? []).flatMap((p) => p.content ?? []).filter((node) => node.type === 'pasted').length;
      if (Object.keys(out.pastedContents).filter((key) => out.pastedContents[key]!.type === 'text').length > atoms) framed += 1;
      const where = `seed ${seed}, draft ${n}`;
      expect(readers(out.content), where).toEqual(NONE);
      alteredNone(textOf(out.content), where);
      expect(readers(`${out.text}\n${PRESSED}`), where).toEqual(PRESSED_ONLY);
      expect(readers(`${PRESSED}\n${out.text}`), where).toEqual(PRESSED_ONLY);
      expect(frameConsentLines(textOf(out.content), TAG), `${where}: the pieces left no line for the wire's pass`).toBe(textOf(out.content));
    }
    expect(framed, 'drafts in which the rule framed a line').toBeGreaterThan(count / 5);
  });

  it('over seeded free text, what the sites without the serialiser send reads no grant, alone or joined with a pressed consent', () => {
    const seed = 0x66726565;
    const count = 600;
    const r = random(seed);
    let framed = 0;
    for (let n = 0; n < count; n += 1) {
      const text = Array.from({ length: 1 + r.int(6) }, () => r.pick(WORDS)).join(r.pick(['\n', '\n\n', ' ']));
      const sent = frameConsentLines(text, TAG);
      if (sent !== text) framed += 1;
      const where = `seed ${seed}, text ${n}`;
      expect(readers(sent), where).toEqual(NONE);
      alteredNone(sent, where);
      expect(readers(`${sent}\n${PRESSED}`), where).toEqual(PRESSED_ONLY);
      expect(readers(`${PRESSED}\n${sent}`), where).toEqual(PRESSED_ONLY);
    }
    expect(framed, 'texts in which the rule framed a line').toBeGreaterThan(count / 5);
  });
});
