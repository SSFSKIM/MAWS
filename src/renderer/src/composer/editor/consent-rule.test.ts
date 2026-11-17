// UX wave U1c, the one-writer rule in its neutralise form (the architect's ruling of 2026-11-16, UTC): the property it
// rests on. For seeded drafts over every piece kind the serialiser has (`PIECE_KINDS`), and for seeded free text the sites
// without it send through `neutraliseGrant` (src/shared/engine/grant.ts), what goes out holds no verbatim opening of the
// grant, and neither does any image of it under a later layer's changes (test/support/later-changes.ts); the real reader
// reads no grant from any of them on the queue's gate (a waiting entry), the live route (the host's mark on the frame it
// writes) and the file route (the engine's row): alone, and joined by the engine's line break with a pressed consent
// before or after it, which keeps its own grant. Seeded, the seed and the count stated; counts, never a time.
import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { consentMessage, readArrivals } from '@shared/engine/arrival';
import { GRANT_BREAK, GRANT_OPENING, neutraliseGrant } from '@shared/engine/grant';
import type { SendContent } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import { laterImages } from '../../../../../test/support/later-changes';
import { at } from '../../../../../test/support/machine';
import { waitingGrants } from '../../blocked-call/grants';
import { resetQueueStore, useQueueStore } from '../../stores/queue';
import { docOf, hardBreak, mentionNode, paragraph, pastedNode, textNode, type Attachment } from './doc';
import { PIECE_KINDS, serializeDraft, type PieceKind } from './serialize';

const APP = at('consent-rule') as AppSessionId;
const SESSION = 'consent-rule-session';
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
const textOf = (content: SendContent): string => (typeof content === 'string' ? content : content.flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n'));
// what goes out, and every image of it under a later layer's changes: no verbatim opening, no grant on any route
function holdsNone(content: SendContent, where: string): void {
  for (const block of typeof content === 'string' ? [content] : content.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))) {
    for (const [how, image] of laterImages(block)) {
      expect(image.includes(GRANT_OPENING), `${where}, ${how}: a verbatim opening`).toBe(false);
      expect(readers(image), `${where}, ${how}`).toEqual(NONE);
    }
  }
  expect(readers(content), `${where}, as sent`).toEqual(NONE);
  expect(readers(`${textOf(content)}\n${PRESSED}`), `${where}, a pressed consent after`).toEqual(PRESSED_ONLY);
  expect(readers(`${PRESSED}\n${textOf(content)}`), `${where}, a pressed consent before`).toEqual(PRESSED_ONLY);
}

// A small seeded generator (a linear congruential one), so a failing draft can be replayed by its seed
function random(seed: number) {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2147483648), state / 2147483648);
  return { int: (n: number) => Math.floor(next() * n), pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]! };
}
// what a person types, pastes or names: the sentence whole, split, padded, with doubled spaces, in another case, with
// marks and bracket pairs between its words, beside pasted tags (opening and closing) and the line breaks a host or the
// engine might turn into a line feed; no envelope tag or json fence line, which rule R reads as no grant for the whole
// message, the pressed one included (its accepted cost)
const WORDS = ['Please look', ' and fix it.', 'Go on.', ' ', '', SENTENCE, PRESSED, `x\n${SENTENCE}\ny`, `${SENTENCE}\n`, SENTENCE.slice(0, 40), SENTENCE.slice(40), BEFORE, AFTER, 'Permission granted for', 'Permis', 'sion granted for ',
  ` ${SENTENCE}`, `${SENTENCE} `, `\t${SENTENCE}\t`, `x\r${SENTENCE}\ry`, `${SENTENCE}\r`, `\r\n${SENTENCE}\r\n`, `a\u2028${SENTENCE}\u2029b`, `\u000b${SENTENCE}\u000c`, `${SENTENCE}\u0085`,
  SENTENCE.replace('Permission ', 'Permission  '), SENTENCE.replace('granted for', 'granted  for'), SENTENCE.replace('Permission', 'PERMISSION'), SENTENCE.replace('Permission', 'permission'),
  SENTENCE.replace('Permission', '**Permission**'), SENTENCE.replace('Permission', 'Per*mission'), SENTENCE.replace('granted', '<b>granted</b>'), SENTENCE.replace('Permission', 'Permis<x>sion'),
  '<pasted_content id="abcd">', '</pasted_content id="abcd">', `<pasted_content id="bbbb">\r\n`, `</pasted_content id="bbbb">\n${SENTENCE}`, GRANT_BREAK];
const IDS = ['src/a.ts', 'docs/a b.md', `d/a\n${SENTENCE}\nb`, SENTENCE, 'Explore'];
const image: Attachment = { id: 'a1', kind: 'image', name: 'shot.png', mediaType: 'image/png', bytes: 4, data: 'iVBO', persisted: true };
const pdf: Attachment = { id: 'a2', kind: 'document', name: 'a.pdf', mediaType: 'application/pdf', bytes: 4, data: 'JVBE', persisted: true };
// one node of each kind the document holds; the serialiser's piece kinds are typed text (text, hard break, paragraph
// break), the mention and the pasted atom (available, or recalled without its body: text, image and PDF)
const NODES: Record<PieceKind, (r: ReturnType<typeof random>) => JSONContent> = {
  text: (r) => (r.int(4) === 0 ? hardBreak() : textNode(r.pick(WORDS) || 'w')),
  mention: (r) => mentionNode({ id: r.pick(IDS), label: 'a', kind: r.int(3) === 0 ? 'agent' : 'file' }),
  pasted: (r) => {
    const unavailable = r.int(4) === 0 ? r.pick(['text', 'image', 'pdf'] as const) : null;
    if (unavailable) return pastedNode({ id: `p${r.int(1000)}`, kind: unavailable, name: 'Pasted', lines: 1, text: null });
    return pastedNode({ id: `p${r.int(1000)}`, kind: 'text', name: 'Pasted text', lines: 1, text: Array.from({ length: 1 + r.int(3) }, () => r.pick(WORDS)).join('\n') });
  },
};
function draft(r: ReturnType<typeof random>): JSONContent {
  const paragraphs = Array.from({ length: 1 + r.int(4) }, () => {
    if (r.int(5) === 0) return paragraph(textNode(BEFORE), mentionNode({ id: 'src/a.ts', label: 'a.ts', kind: 'file' }), textNode(AFTER)); // split across pieces
    return paragraph(...Array.from({ length: 1 + r.int(4) }, () => NODES[r.pick(PIECE_KINDS)](r)));
  });
  return docOf(paragraphs, r.pick([[], [], [image], [pdf], [image, pdf]]));
}

describe('the one-writer rule: no grant from what the person did not press', () => {
  it('the readers: a line typed as the sentence would be a grant on all three, and the press’s own sentence is', () => {
    expect(readers(`Go on.\n${SENTENCE}`)).toEqual({ gate: ['cat /etc/x'], live: ['cat /etc/x'], file: ['cat /etc/x'] });
    expect(readers(PRESSED)).toEqual(PRESSED_ONLY);
  });

  it('the serialiser’s last step is the neutralising: the wire text is the assembled text neutralised, and what the person sees is as typed', () => {
    const out = serializeDraft(docOf([paragraph(textNode('Go on.')), paragraph(textNode(SENTENCE))]), { sessionId: SESSION, cwd: '/repo' });
    expect(out.text).toBe(neutraliseGrant(`Go on.\n${SENTENCE}`));
    expect(out.content).toBe(out.text);
    expect(out.display).toBe(`Go on.\n${SENTENCE}`);
    expect(out.pastedContents).toEqual({});
    const whole = serializeDraft(docOf([paragraph(textNode(BEFORE), mentionNode({ id: 'src/a.ts', label: 'a.ts', kind: 'file' }), textNode(AFTER))]), { sessionId: SESSION, cwd: '/repo' });
    expect(whole.text).toBe(neutraliseGrant(AROUND));
    expect(whole.display).toBe(AROUND);
    const again = serializeDraft(docOf([paragraph(textNode(out.text))]), { sessionId: SESSION, cwd: '/repo' });
    expect(again.text, 'a recalled text sent again does not grow').toBe(out.text);
  });

  it('over seeded drafts of every piece kind, what the serialiser sends and every later image of it hold no opening and read no grant', () => {
    const seed = 0x75316331;
    const count = 600;
    const r = random(seed);
    let neutralised = 0;
    for (let n = 0; n < count; n += 1) {
      const out = serializeDraft(draft(r), { sessionId: SESSION, cwd: '/repo' });
      if (out.mode !== 'send') continue;
      if (out.text.includes(GRANT_BREAK)) neutralised += 1;
      holdsNone(out.content, `seed ${seed}, draft ${n}`);
      expect(neutraliseGrant(out.text), `seed ${seed}, draft ${n}: the last step`).toBe(out.text);
    }
    expect(neutralised, 'drafts the rule neutralised').toBeGreaterThan(count / 3);
  });

  it('over seeded free text, what the sites without the serialiser send and every later image of it hold no opening and read no grant', () => {
    const seed = 0x66726565;
    const count = 600;
    const r = random(seed);
    let neutralised = 0;
    for (let n = 0; n < count; n += 1) {
      const text = Array.from({ length: 1 + r.int(6) }, () => r.pick(WORDS)).join(r.pick(['\n', '\n\n', ' ', '', '\r\n']));
      const sent = neutraliseGrant(text);
      if (sent !== text) neutralised += 1;
      holdsNone(sent, `seed ${seed}, text ${n}`);
    }
    expect(neutralised, 'texts the rule neutralised').toBeGreaterThan(count / 3);
  });
});
