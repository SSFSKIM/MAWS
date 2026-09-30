// The *Pasted content* rule (C7's contract, verbatim in the C6 execution document): extraction with the engine's own
// grammar before anything markdown-shaped sees the text; the C4-backfill half of C7's test is in disk.test.ts.
import { framePasted, PASTED_BLOCK } from '@shared/composer/pasted-content';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rowsOf } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { serializeRows } from './serialize';
import { builder, uuid } from './test-events';
import { splitPastedSegments, untaggedUserText, userTextOf } from './user-text';

// The golden fixture: one 40-line block wrapped exactly as the grammar frames it, typed text before and after.
const fixture = JSON.parse(readFileSync(join(__dirname, '../../../../../test/fixtures/composer/pasted-40-lines.json'), 'utf8')) as { typed: string; pasted: { id: string; body: string }[]; sent: string };
const BODY = fixture.pasted[0].body;
const TYPED = fixture.typed;
const SENT = fixture.sent;

describe('pasted content', () => {
  it('the grammar is the engine’s: same four-hex id on both tags, up to two newlines consumed on either side', () => {
    expect(PASTED_BLOCK.source).toBe('\\n{0,2}<pasted_content id="([0-9a-f]{4})">\\n([\\s\\S]*?)\\n<\\/pasted_content id="\\1">\\n{0,2}');
    expect(PASTED_BLOCK.flags).toBe('g');
    expect(TYPED).toBe('see <\\pasted_content> below');
    expect(SENT).toBe(`${TYPED}\n${framePasted('1f3a', BODY)}\nthanks`);
    expect(BODY.split('\n')).toHaveLength(40);
    expect(splitPastedSegments('a\n<pasted_content id="abcd">\nx\n</pasted_content id="abcd">\nb')).toEqual({
      text: 'a\n[Pasted text #1 +1 lines]\nb',
      placeholders: [2],
      attachments: [{ kind: 'text', name: 'Pasted text #1', bytes: 1, dataUrl: null, mediaType: 'text/plain', text: 'x' }],
    });
    expect(splitPastedSegments('<pasted_content id="abcd">\nx\n</pasted_content id="beef">')).toEqual({ text: '<pasted_content id="abcd">\nx\n</pasted_content id="beef">', attachments: [], placeholders: [] }); // ids differ: plain text
    expect(splitPastedSegments('<pasted_content id="abcd">\nx')).toEqual({ text: '<pasted_content id="abcd">\nx', attachments: [], placeholders: [] }); // no close
    expect(splitPastedSegments('see <\\pasted_content> here')).toEqual({ text: 'see <\\pasted_content> here', attachments: [], placeholders: [] }); // neutralised
  });

  it('numbers matches in order and counts bytes in UTF-8', () => {
    const two = splitPastedSegments('<pasted_content id="0001">\né\n</pasted_content id="0001">\n\nmid\n\n<pasted_content id="0002">\na\nb\n</pasted_content id="0002">');
    expect(two.text).toBe('[Pasted text #1 +1 lines]\nmid\n[Pasted text #2 +2 lines]');
    expect(two.attachments.map((a) => [a.name, a.bytes, a.text])).toEqual([['Pasted text #1', 2, 'é'], ['Pasted text #2', 3, 'a\nb']]);
  });

  it('a user message with a 40-line block yields one text attachment, the placeholder in the text, lines counted after replacement', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: SENT, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.text('m1', 0, 'Got it.');
    b.end(['u1']);
    const rows = rowsOf(applyEvents(createState(null, null), b.events));
    const user = rows.find((row): row is Extract<Row, { kind: 'user' }> => row.kind === 'user')!;
    expect(user.attachments).toEqual([{ kind: 'text', name: 'Pasted text #1', bytes: Buffer.byteLength(BODY, 'utf8'), dataUrl: null, mediaType: 'text/plain', text: BODY }]);
    expect(user.attachments[0].text!.split('\n')).toHaveLength(40);
    expect(user.text).toBe(`${TYPED}\n[Pasted text #1 +40 lines]\nthanks`);
    expect(user.lines).toBe(3);
    // The replay path: the same events applied again to a fresh state yield the same row.
    const again = rowsOf(applyEvents(createState(null, null), b.events)).find((row) => row.kind === 'user');
    expect(again).toEqual(user);
    // Copy and serialisation emit the untagged body in place of the placeholder.
    const markdown = serializeRows(rows);
    expect(markdown).toContain(`${TYPED}\n${BODY}\nthanks`);
    expect(markdown).not.toContain('pasted_content id=');
    expect(markdown).not.toContain('[Pasted text #1');
  });

  it('userTextOf keeps image and document blocks as attachments after the text ones', () => {
    const out = userTextOf([{ type: 'text', text: '<pasted_content id="00ff">\nbody\n</pasted_content id="00ff">' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
    expect(out.attachments.map((a) => a.kind)).toEqual(['text', 'image']);
    expect(out.text).toBe('[Pasted text #1 +1 lines]');
    expect(out.lines).toBe(1);
  });

  // Debt wave 4: only the places extraction put a placeholder are pasted blocks; the same shape typed by the human stays
  // as typed in copy, export and the bubble, before or after the real one, and with or without a pasted block at all.
  it('leaves placeholder-shaped text the human typed alone, and replaces only the recorded placeholders', () => {
    const typed = '[Pasted text #1 +3 lines]';
    const b = builder();
    for (const [u, content] of [['u1', `I typed ${typed} before\n${framePasted('00aa', 'real\nbody')}\nand ${typed} after`], ['u2', `only ${typed}`]] as const) {
      b.emit('turn.started', { userMessageUuid: uuid(u), origin: 'human' });
      b.emit('user.message', { messageUuid: uuid(u), content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
      b.text(`m${u}`, 0, 'Ok.');
      b.end([u]);
    }
    const rows = rowsOf(applyEvents(createState(null, null), b.events));
    const [first, second] = rows.filter((row): row is Extract<Row, { kind: 'user' }> => row.kind === 'user');
    expect(first.text).toBe(`I typed ${typed} before\n[Pasted text #1 +2 lines]\nand ${typed} after`);
    expect(first.placeholders).toEqual([first.text.indexOf('[Pasted text #1 +2 lines]')]);
    expect(untaggedUserText(first.text, first.attachments, first.placeholders)).toBe(`I typed ${typed} before\nreal\nbody\nand ${typed} after`);
    expect(untaggedUserText(second.text, second.attachments, second.placeholders)).toBe(`only ${typed}`);
    const markdown = serializeRows(rows);
    expect(markdown).toContain(`I typed ${typed} before\nreal\nbody\nand ${typed} after`);
    expect(markdown).toContain(`only ${typed}`);
  });
});
