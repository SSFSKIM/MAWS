// A notification's landing on a `<message>` in the session view (DC9 M6): the log's `message` event names its
// transcript row and span (`src`, `<row uuid>#<span>`), and the view jumps to that row's text as MAWS's own mark anchors
// do (its store's `jumpToMessage`, by message uuid and block index). An async question's `question` event names its call
// (`src`, the tool-use id), and the view jumps to the row MAWS keys by that id; so does a `message` sent through a
// message tool, whose `src` is its call's id.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { callRow, landingStep, messageAnchor } from './landed-message';

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

describe("a landing's call row", () => {
  it("is the row MAWS keys by the call's id: the ask mod's question row, MAWS's own ask capsule", () => {
    const asks = assistant([
      { type: 'text', text: 'Asking.' },
      { type: 'tool_use', id: 'toolu_mod', name: 'mcp__doperpowers__AskUserQuestion', input: {} },
      { type: 'tool_use', id: 'toolu_maws', name: 'mcp__maws__ask', input: {} },
    ]);
    expect(callRow('toolu_mod', [asks])).toBe('question:toolu_mod');
    expect(callRow('toolu_maws', [asks])).toBe('ask:toolu_maws');
  });

  it("is the message's row for a message tool's call, MAWS's and the to-human plugin's alike (a `message` landing by tool-use id)", () => {
    const messages = assistant([
      { type: 'tool_use', id: 'toolu_mawsmsg', name: 'mcp__maws__message', input: { text: 'Stage 1 is done.' } },
      { type: 'tool_use', id: 'toolu_pluginmsg', name: 'mcp__to-human__message', input: { text: 'Stage 2 is done.' } },
    ]);
    expect(callRow('toolu_mawsmsg', [messages])).toBe('to-human:toolu_mawsmsg');
    expect(callRow('toolu_pluginmsg', [messages])).toBe('to-human:toolu_pluginmsg');
    expect(messageAnchor('toolu_pluginmsg', [messages])).toBeNull(); // its src names no span: the landing reads the call
  });

  it('is none while no held row holds the call', () => {
    expect(callRow('toolu_mod', [])).toBeNull();
    expect(callRow('toolu_mod', [assistant([{ type: 'tool_use', id: 'toolu_other', name: 'mcp__maws__ask', input: {} }])])).toBeNull();
    expect(callRow('toolu_mod', [{ uuid: UUID, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_mod', content: 'x' }] } }])).toBeNull();
  });
});

describe("a landing's next step", () => {
  it('jumps once the row is held and the store is live; waits while it hydrates', () => {
    expect(landingStep({ held: true, live: true, more: true, loadingOlder: false })).toBe('jump');
    expect(landingStep({ held: true, live: false, more: false, loadingOlder: false })).toBe('wait');
  });
  it('pages toward a row not held while older rows exist, waits while a page is out, and is missing once none are left', () => {
    expect(landingStep({ held: false, live: true, more: true, loadingOlder: false })).toBe('page');
    expect(landingStep({ held: false, live: true, more: true, loadingOlder: true })).toBe('wait');
    expect(landingStep({ held: false, live: true, more: false, loadingOlder: false })).toBe('missing');
    expect(landingStep({ held: false, live: false, more: false, loadingOlder: false })).toBe('wait'); // not in yet
  });
});
