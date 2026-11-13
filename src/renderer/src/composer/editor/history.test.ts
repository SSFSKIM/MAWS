import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@shared/composer/history-entry';
import type { MessageUuid } from '@shared/graph/ids';
import type { Row, TurnActivity } from '../../transcript';
import { docOf, paragraph, textNode, type ComposerDoc } from './doc';
import { findMatch, historyNavigation, matchPlace, recallDoc, recallEntries, recallLine, recallText, searchKeyOf, searchLine, type HistoryNav } from './history';
import { bodiesByPlaceholder, historyEntryToDoc, prefillToDoc } from './recall';
import { serializeDraft } from './serialize';

const ctx = { sessionId: 's-1', cwd: '/repo' };
const doc = (text: string): ComposerDoc => docOf([paragraph(textNode(text))]);
const plain = (d: ComposerDoc) => serializeDraft(d, ctx).display;

describe('history navigation restores the draft and ends on edit', () => {
  const entries = ['a', 'b', 'c'];
  const step = (nav: HistoryNav, action: 'up' | 'down' | 'edit', current: ComposerDoc) => historyNavigation(nav, action, entries.length, current);

  it('walks back to the oldest, stops there, walks forward and restores the draft past the newest', () => {
    let nav: HistoryNav = { index: null, draft: null };
    const shown: string[] = [];
    let current = doc('d');
    const press = (action: 'up' | 'down') => {
      const next = step(nav, action, current);
      nav = next.nav;
      if (next.show?.kind === 'entry') current = doc(entries[next.show.index]);
      else if (next.show?.kind === 'draft') current = next.show.doc;
      shown.push(plain(current));
    };
    ['up', 'up', 'up', 'up', 'down', 'down', 'down'].forEach((a) => press(a as 'up' | 'down'));
    expect(shown).toEqual(['c', 'b', 'a', 'a', 'b', 'c', 'd']);
    expect(nav).toEqual({ index: null, draft: null });
  });

  it('ends navigation on an edit, keeping the edited text as the draft', () => {
    let nav: HistoryNav = { index: null, draft: null };
    nav = step(nav, 'up', doc('d')).nav;
    nav = step(nav, 'up', doc('c')).nav;
    expect(nav.index).toBe(1);
    const edited = step(nav, 'edit', doc('b!'));
    expect(edited).toEqual({ nav: { index: null, draft: null }, show: null });
    expect(step(edited.nav, 'down', doc('b!')).show).toBeNull();
  });

  it('does nothing with no entries', () => {
    expect(historyNavigation({ index: null, draft: null }, 'up', 0, doc('x'))).toEqual({ nav: { index: null, draft: null }, show: null });
  });
});

const userRow = (id: string, turn: string, text: string, attachments: Row extends infer R ? (R extends { kind: 'user'; attachments: infer A } ? A : never) : never = []): Row =>
  ({ id: `user:${id}`, turnId: turn, at: '2026-09-29T10:00:00.000Z', kind: 'user', messageUuid: id as MessageUuid, text, attachments, lines: 1, editable: true, steer: false, dropped: false }) as Row;
const turn = (id: string, origin: TurnActivity['origin']) => ({ turnId: id, origin }) as TurnActivity;
const entry = (display: string, pastedContents: HistoryEntry['pastedContents'] = {}, at = '2026-09-28T10:00:00.000Z'): HistoryEntry => ({ display, at, source: 'maws', sessionId: null, pastedContents });
const textBody = (id: number, content: string | null) => ({ id, type: 'text' as const, content, contentHash: null, mediaType: null, filename: null });

describe('history recall rebuilds pasted atoms and marks unresolved ones', () => {
  it("rebuilds a pasted atom from a resolved body and an unavailable one from an unresolved body; [Image #n] is always unavailable", () => {
    const d = historyEntryToDoc(entry('see [Pasted text #1 +2 lines] and [Pasted text #2 +40 lines] [Image #3]', { '1': textBody(1, 'x\ny'), '2': textBody(2, null) }));
    const atoms = (d.content ?? []).flatMap((p) => p.content ?? []).filter((n) => n.type === 'pasted').map((n) => n.attrs);
    expect(atoms.map((a) => [a?.kind, a?.name, a?.lines, a?.text])).toEqual([
      ['text', 'Pasted text #1', 2, 'x\ny'],
      ['text', 'Pasted text #2', 40, null],
      ['image', 'Image #3', 0, null],
    ]);
    const s = serializeDraft(d, ctx);
    expect(s.omitted).toBe(2);
    expect(s.content).not.toContain('[Pasted text #2');
    expect(s.display).toBe('see [Pasted text #1 +2 lines] and [Pasted text #2 +40 lines] [Image #3]');
  });

  it('re-parses @ tokens into mention chips and keeps paragraphs', () => {
    const d = historyEntryToDoc(entry('read @src/a.ts and @"docs/a b.md"\nask @agent-Explore, not me@example.com'));
    const nodes = (d.content ?? []).map((p) => (p.content ?? []).map((n) => (n.type === 'mention' ? `<${n.attrs?.kind}:${n.attrs?.id}>` : n.text)).join(''));
    expect(nodes).toEqual(['read <file:src/a.ts> and <file:docs/a b.md>', 'ask <agent:Explore>, not me@example.com']);
    expect(serializeDraft(d, ctx).content).toBe('read @src/a.ts and @"docs/a b.md"\nask @agent-Explore, not me@example.com');
  });

  it('rebuilds a prefill: pasted bodies in placeholder order, a missing one unavailable, images re-attached', () => {
    const d = prefillToDoc({ text: 'fix\n[Pasted text #1 +3 lines]\nand [Pasted text #2 +1 lines]', pasted: [{ name: 'Pasted text #1', text: 'a\nb\nc' }], images: [{ name: 'i.png', mediaType: 'image/png', data: 'iVBO' }] });
    const s = serializeDraft(d, { sessionId: 'e', cwd: '/' });
    expect(s.display).toBe('fix\n[Pasted text #1 +3 lines]\nand [Pasted text #2 +1 lines] [Image #3]');
    expect(s.omitted).toBe(1);
    expect(s.pastedContents['1']?.content).toBe('a\nb\nc');
    expect(Array.isArray(s.content) && s.content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png', data: 'iVBO' } });
  });

  // W3 (B6): a bubble edited in place may lose or move a placeholder, so its bodies are bound to what each one names
  it('rebuilds an edited text by what each placeholder names: a deleted or moved one takes no other’s body, an unknown one is unavailable', () => {
    const bodies = bodiesByPlaceholder({ text: 'a [Pasted text #1 +1 lines] b [Pasted text #2 +2 lines]', pasted: [{ name: 'Pasted text #1', text: 'one' }, { name: 'Pasted text #2', text: 't\nwo' }] });
    expect(bodies).toEqual({ '[Pasted text #1 +1 lines]': 'one', '[Pasted text #2 +2 lines]': 't\nwo' });
    const s = serializeDraft(prefillToDoc({ text: '[Pasted text #9 +1 lines] b [Pasted text #2 +2 lines]', bodies }), ctx);
    expect(s.display).toBe('[Pasted text #1 +1 lines] b [Pasted text #2 +2 lines]'); // renumbered as the composer numbers atoms
    expect(s.omitted).toBe(1);
    expect(Object.values(s.pastedContents).map((p) => p.content)).toEqual(['t\nwo']);
  });

  it("lists the session's human prompts newest last, then earlier history not already among them", () => {
    const rows = [
      userRow('u1', 't1', 'first'),
      userRow('u2', 't2', 'from a peer'),
      userRow('u3', 't3', 'second'),
      userRow('u4', 't4', 'second'),
      userRow('u5', 't5', 'see <\\pasted_content>\n[Pasted text #1 +2 lines]\nok', [{ kind: 'text', name: 'Pasted text #1', bytes: 3, dataUrl: null, mediaType: 'text/plain', text: 'p\nq' }]),
    ];
    const activity = [turn('t1', 'human'), turn('t2', 'peer'), turn('t3', 'human'), turn('t4', 'human'), turn('t5', 'human')];
    const listed = [
      entry('from the terminal', {}, '2026-09-27T10:00:00.000Z'),
      entry('first'),
      entry('see <pasted_content>[Pasted text #1 +2 lines]\nok', { '1': textBody(1, 'p\nq') }), // the same prompt, as MAWS's history keeps it
    ];
    const recalled = recallEntries(rows, activity, listed).map((r) => plain(recallDoc(r)));
    expect(recalled).toEqual(['from the terminal', 'first', 'second', 'see <pasted_content>[Pasted text #1 +2 lines]\nok']);
  });

  it('keeps two entries with the same display and different bodies apart', () => {
    const listed = [entry('[Pasted text #1 +40 lines]', { '1': textBody(1, 'one') }), entry('[Pasted text #1 +40 lines]', { '1': textBody(1, 'two') })];
    const recalled = recallEntries([], [], listed).map((r) => serializeDraft(recallDoc(r), ctx).pastedContents['1']?.content);
    expect(recalled).toEqual(['one', 'two']);
  });
});

// UX wave U4a M6 (l3-input-12; decision 22): the line under the text while recalling, and the prompt-history search
describe('the history line says where the recall is, 1 the most recent', () => {
  it('reads the place of the newest, a middle and the oldest of twelve entries', () => {
    expect(recallLine(11, 12)).toBe('History 1/12 · ↓ to restore your draft');
    expect(recallLine(9, 12)).toBe('History 3/12 · ↓ to restore your draft');
    expect(recallLine(0, 12)).toBe('History 12/12 · ↓ to restore your draft');
  });
});

describe('the history search finds, counts and words its match', () => {
  // newest first, as the search reads the list ↑ walks
  const texts = ['Deploy the docs', 'fix the build', 'Read the BUILD log', 'deploy again', 'notes'];

  it('finds the text anywhere in a prompt, case ignored, from a place in either direction', () => {
    expect(findMatch(texts, 'build', 0, 1)).toBe(1);
    expect(findMatch(texts, 'build', 2, 1)).toBe(2);
    expect(findMatch(texts, 'build', 3, 1)).toBeNull();
    expect(findMatch(texts, 'deploy', 3, -1)).toBe(3);
    expect(findMatch(texts, 'deploy', 2, -1)).toBe(0);
    expect(findMatch(texts, 'deploy', -1, -1)).toBeNull();
    expect(findMatch(texts, 'zzz', 0, 1)).toBeNull();
    expect(findMatch(texts, '', 4, 1)).toBe(4); // an empty search holds every prompt
  });

  it('counts the prompts that hold the text and the match’s place among them, newest first', () => {
    expect(matchPlace(texts, 'build', 2)).toEqual({ place: 2, total: 2 });
    expect(matchPlace(texts, 'deploy', 0)).toEqual({ place: 1, total: 2 });
    expect(matchPlace(texts, 'zzz', null)).toBeNull();
    expect(matchPlace(texts, 'build', 4)).toBeNull(); // what is shown does not hold the text
    expect(matchPlace(texts, 'build', null)).toBeNull();
  });

  it('words the line with the typed text and the match, or no match', () => {
    expect(searchLine('build', { place: 2, total: 40 })).toBe('Search history: build — match 2 of 40');
    expect(searchLine('zzz', null)).toBe('Search history: zzz — no match');
    expect(searchLine('', null)).toBe('Search history:');
  });

  it('reads a key as Desktop’s handler does: the moves, the restore, the take, what ends it for the editor, the typing', () => {
    const key = (k: string, over: Partial<KeyboardEvent> = {}) => searchKeyOf({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...over });
    expect(key('ArrowUp')).toEqual({ kind: 'older' });
    expect(key('ArrowDown')).toEqual({ kind: 'newer' });
    expect(key('Escape')).toEqual({ kind: 'restore' });
    expect(key('Backspace')).toEqual({ kind: 'erase' });
    for (const k of ['Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) expect(key(k), k).toEqual({ kind: 'take' });
    expect(key('a', { isComposing: true })).toEqual({ kind: 'yield' }); // a composition goes on in the box
    expect(key('Process')).toEqual({ kind: 'yield' });
    expect(key('Dead')).toEqual({ kind: 'yield' });
    expect(key('v', { metaKey: true })).toEqual({ kind: 'yield' }); // a paste or a cut is the box's
    expect(key('x', { metaKey: true })).toEqual({ kind: 'yield' });
    expect(key('b')).toEqual({ kind: 'type', char: 'b' });
    expect(key('B')).toEqual({ kind: 'type', char: 'B' });
    expect(key(' ')).toEqual({ kind: 'type', char: ' ' });
    expect(key('a', { metaKey: true })).toEqual({ kind: 'ignore' });
    expect(key('a', { ctrlKey: true })).toEqual({ kind: 'ignore' });
    expect(key('Shift')).toEqual({ kind: 'ignore' });
  });

  it('searches a recall by the text it shows', () => {
    expect(recallText({ source: 'history', entry: entry('from [Pasted text #1 +3 lines]') })).toBe('from [Pasted text #1 +3 lines]');
    expect(recallText({ source: 'session', prefill: { text: 'typed here' } })).toBe('typed here');
  });
});
