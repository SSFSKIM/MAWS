// A delivered send's frame line, as the session view draws its row (DC9 M6, the owner's review of M4): the first line
// sminos writes for a delivery names its event, which the session read and the tail matched; the owner's own send drops
// it from view (its bubble already says who wrote it), and a peer's keeps who sent it as a label. The text the session
// read is unchanged otherwise, and a row that marks no delivery's provenance is never touched.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../src/renderer/src/transcript/model/rows';
import { freshSource, subagentLookupOf } from '../depth/source/desk-transcript';
import { deliveryFrame, withoutDeliveryFrame } from './delivery-frame';

const SESSION = 'sess-1';
const BRIDGE = { kind: 'plugin', name: 'doperpowers', asUser: true };
let n = 0;
const row = (content: string | JsonObject[], origin: JsonObject | null, extra: JsonObject = {}): JsonObject => ({
  uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  parentUuid: null,
  timestamp: '2026-10-17T10:00:00.000Z',
  sessionId: SESSION,
  isSidechain: false,
  type: 'user',
  ...(origin && { origin }),
  message: { role: 'user', content },
  ...extra,
});
const queued = (prompt: string, kind: string): JsonObject => ({
  uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  parentUuid: null,
  timestamp: '2026-10-17T10:00:00.000Z',
  sessionId: SESSION,
  type: 'attachment',
  attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind } },
});
const OWN = '[sminos chat MAWS hub/5e55e5e5:12 from human → @you]';
const PEER = '[sminos chat MAWS ab12cd34:3 from fakepeer → @you | unread 2]';
const MESSAGE = '[sminos message from human id=5e551e17]';
const text = (r: JsonObject): unknown => (r.message as JsonObject | undefined)?.content ?? (r.attachment as JsonObject).prompt;

describe('a delivered send’s frame line', () => {
  it('names who sent it: the owner (`human`) or a peer, in either form sminos writes', () => {
    expect(deliveryFrame(row(`${OWN}\nRun the suites.`, BRIDGE))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(row(`${PEER}\nI read it.`, BRIDGE))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(row(`${MESSAGE}\nRe-run the suites.`, BRIDGE))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(row([{ type: 'text', text: `${PEER}\nI read it.` }], BRIDGE))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(queued(`${PEER}\nI read it.`, 'peer'))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(row('[sminos chat My Project ab12cd34:7 from a → b → @all]\nhi', BRIDGE))).toEqual({ from: 'a → b', own: false });
  });

  it('is drawn without its frame line, the rest of what the session read unchanged', () => {
    expect(text(withoutDeliveryFrame(row(`${OWN}\nRun the suites.\n\nThen tell me.`, BRIDGE)))).toBe('Run the suites.\n\nThen tell me.');
    expect(text(withoutDeliveryFrame(row([{ type: 'text', text: `${PEER}\nI read it.` }, { type: 'text', text: 'More.' }], BRIDGE)))).toEqual([
      { type: 'text', text: 'I read it.' },
      { type: 'text', text: 'More.' },
    ]);
    expect(text(withoutDeliveryFrame(queued(`${MESSAGE}\nRe-run the suites.`, 'plugin')))).toBe('Re-run the suites.');
  });

  it('is never read off a row that marks no delivery: typed, origin-less, another plugin’s meta row, a queued prompt typed at the terminal', () => {
    for (const r of [
      row(`${OWN}\nRun the suites.`, { kind: 'human' }),
      row(`${OWN}\nRun the suites.`, null),
      row(`${OWN}\nRun the suites.`, { kind: 'plugin', name: 'doperpowers' }, { isMeta: true }),
      queued(`${OWN}\nRun the suites.`, 'human'),
    ]) {
      expect(deliveryFrame(r)).toBeNull();
      expect(withoutDeliveryFrame(r)).toBe(r);
    }
  });

  it('is never a lookalike: a cut, unclosed, or quoted frame, or one past the first line', () => {
    for (const content of [
      '[sminos chat MAWS hub/5e55e5e5:12 from human]\nhi',
      '[sminos chat MAWS hub/5e55e5e5:12 from human → @you\nhi',
      'Look: [sminos chat MAWS hub/5e55e5e5:12 from human → @you]\nhi',
      `hi\n${OWN}`,
      '[sminos message from human]\nhi',
    ]) {
      const r = row(content, BRIDGE);
      expect(deliveryFrame(r)).toBeNull();
      expect(withoutDeliveryFrame(r)).toBe(r);
    }
  });

  it('through MAWS’s backfill and projection: the owner’s send is a bubble of its words alone, a peer’s too', async () => {
    const store = createTranscriptStore();
    const rows = [row(`${OWN}\nRun the suites.`, BRIDGE), row(`${PEER}\nI read it.`, BRIDGE)];
    await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
    const users = store.getState().entries.fresh.rows.filter((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user');
    expect(users.map((u) => u.text)).toEqual(['Run the suites.', 'I read it.']);
  });
});
