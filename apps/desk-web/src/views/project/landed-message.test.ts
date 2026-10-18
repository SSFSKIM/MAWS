// A notification's landing on a `<message>` in the session view (DC9 M6): the log's `message` event names its
// transcript row and span (`src`, `<row uuid>#<span>`), and the view jumps to that row's text as MAWS's own mark anchors
// do (its store's `jumpToMessage`, by message uuid and block index).
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { landingStep, messageAnchor } from './landed-message';

const UUID = '97c46522-2127-4fe7-a56d-1e9c5c006b95';
const assistant = (content: JsonObject[], extra: JsonObject = {}): JsonObject => ({ uuid: UUID, type: 'assistant', message: { id: 'msg_1', role: 'assistant', content }, ...extra });

describe("a landing's message anchor", () => {
  it('is the row named by the src, at the block holding the mark', () => {
    expect(messageAnchor(`${UUID}#0`, [assistant([{ type: 'text', text: '<message>You chose blue.</message>' }])])).toEqual({ messageUuid: UUID, blockIndex: 0 });
    expect(messageAnchor(`${UUID}#1`, [assistant([{ type: 'thinking', thinking: '' }, { type: 'text', text: 'a <message>b</message> <message>c</message>' }])])).toEqual({ messageUuid: UUID, blockIndex: 1 });
  });

  it("counts the block from the row's place in its API message, as MAWS's backfill does", () => {
    expect(messageAnchor(`${UUID}#0`, [assistant([{ type: 'text', text: '<message>x</message>' }], { apiBlockIndex: 2 })])).toEqual({ messageUuid: UUID, blockIndex: 2 });
  });

  it("is the block holding the span the src counts, the row's marked spans counted across its text blocks as sminos counts them", () => {
    const row = assistant([
      { type: 'text', text: '<message>first</message> then <essential>second</essential>' },
      { type: 'tool_use', id: 't', name: 'Bash', input: {} },
      { type: 'text', text: 'see `<message>quoted</message>` and <message>third</message>' },
    ]);
    expect(messageAnchor(`${UUID}#0`, [row])).toEqual({ messageUuid: UUID, blockIndex: 0 });
    expect(messageAnchor(`${UUID}#1`, [row])).toEqual({ messageUuid: UUID, blockIndex: 0 }); // the alias is a span too
    expect(messageAnchor(`${UUID}#2`, [row])).toEqual({ messageUuid: UUID, blockIndex: 2 }); // the quoted tag in code is not
    expect(messageAnchor(`${UUID}#3`, [row])).toBeNull(); // no such span
    expect(messageAnchor(`${UUID}#1`, [assistant([{ type: 'text', text: '<message>a</message>' }], { apiBlockIndex: 1 }), assistant([{ type: 'text', text: '<message>b</message>' }], { uuid: 'other' })])).toBeNull();
  });

  it('is none while the row is not held, for a src naming no row, or a row with no text', () => {
    expect(messageAnchor(`${UUID}#0`, [])).toBeNull();
    expect(messageAnchor('toolu_01ptPa1uE4qkTexQaiwjlnsO', [assistant([{ type: 'text', text: 'x' }])])).toBeNull();
    expect(messageAnchor(`${UUID}#0`, [assistant([{ type: 'tool_use', id: 't', name: 'Bash', input: {} }])])).toBeNull();
  });
});

describe("a landing's next step", () => {
  const anchor = { messageUuid: UUID as never, blockIndex: 0 };
  it('jumps once the row is held and the store is live; waits while it hydrates', () => {
    expect(landingStep({ anchor, live: true, more: true, loadingOlder: false })).toBe('jump');
    expect(landingStep({ anchor, live: false, more: false, loadingOlder: false })).toBe('wait');
  });
  it('pages toward a row not held while older rows exist, waits while a page is out, and is missing once none are left', () => {
    expect(landingStep({ anchor: null, live: true, more: true, loadingOlder: false })).toBe('page');
    expect(landingStep({ anchor: null, live: true, more: true, loadingOlder: true })).toBe('wait');
    expect(landingStep({ anchor: null, live: true, more: false, loadingOlder: false })).toBe('missing');
    expect(landingStep({ anchor: null, live: false, more: false, loadingOlder: false })).toBe('wait'); // not in yet
  });
});
