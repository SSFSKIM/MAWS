import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { MemoryFileReader } from '../../../test/support/memory-reader';
import { ChainFollower } from './chain-follower';

const fixture = (name: string): Record<string, unknown>[] => readFileSync(join(TEST_FIXTURE_DIR, `transcript-fx8-${name}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const bytes = (records: Record<string, unknown>[]) => Buffer.from(records.map((r) => JSON.stringify(r) + '\n').join(''));
async function follow(records: Record<string, unknown>[], tail = false) {
  const reader = new MemoryFileReader(tail ? Buffer.alloc(0) : bytes(records));
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(reader, 'FX8' as SessionId, null, (e) => { if (e.t === 'events') events.push(...e.events); }, { holders: () => 2 });
  await follower.start();
  if (tail) for (const record of records) { reader.append(bytes([record])); await follower.poke(); }
  return { reader, follower, events };
}
const cuts = (events: SessionEvent[]) => events.filter((e) => e.kind === 'boundary.retraction' || e.kind === 'boundary.rewind');
const notices = (events: SessionEvent[]) => events.filter((e) => e.kind === 'notice.posted');
const delivery = fixture('delivery-tails');

describe('FX8 eligible response deliveries', () => {
  it.each([false, true])('retains diagnostic, meta, system, attachment and task tails in file order (tail=%s)', async (tail) => {
    const { follower, events } = await follow(delivery, tail);
    expect(cuts(events)).toEqual([]);
    expect(notices(events)).toEqual([]);
    expect(follower.snapshot().chain).toEqual(delivery.map((r) => r.uuid));
    expect(events.filter((e) => e.kind === 'tool.result').map((e) => e.toolUseId)).toEqual(['t1', 't2']);
    expect(events.filter((e) => e.kind === 'assistant.block.complete' && e.isApiErrorMessage)).toHaveLength(1);
  });

  it.each(['notification', 'system'])('adopts an incoming %s over a same-response sibling', async (kind) => {
    const incoming = { ...delivery[kind === 'notification' ? 7 : 5], parentUuid: 'a1', ...(kind === 'system' ? { subtype: 'local_command', content: '<local-command-stdout>Ready</local-command-stdout>' } : {}) };
    const records = [...delivery.slice(0, 3), incoming, ...delivery.slice(8)];
    const { follower, events } = await follow(records);
    expect(cuts(events)).toEqual([]);
    expect(notices(events)).toEqual([]);
    expect(follower.snapshot().chain).toEqual(records.map((r) => r.uuid));
  });

  it.each([
    { type: 'user', message: { content: 'A real prompt.' } },
    { type: 'assistant', message: { id: 'other-response', content: [{ type: 'text', text: 'A real answer.' }] } },
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'user', isCompactSummary: true, isMeta: true, message: { content: 'Compacted context.' } },
    { type: 'user', isMeta: true, agentId: 'other-agent', message: { content: 'Other agent context.' } },
    { type: 'user', isMeta: true, isSidechain: true, message: { content: 'Sidechain context.' } },
  ])('never crosses an ineligible $type tail', async (barrier) => {
    const { follower, events } = await follow([...delivery.slice(0, 3), { ...barrier, uuid: 'barrier', parentUuid: 'a2' }, delivery[8]]);
    expect(cuts(events)).toHaveLength(1);
    expect(follower.snapshot().chain).toEqual(['u', 'a1', 'r1']);
  });

  it('does not let a branched meta tail acquire the response group', async () => {
    const { events } = await follow([...delivery.slice(0, 3), { ...delivery[4], parentUuid: 'a1' }, delivery[8]]);
    expect(cuts(events)).toHaveLength(2);
  });

  it('retracts retained deliveries on a genuine earlier-prompt resume', async () => {
    const { events } = await follow([...delivery, { type: 'user', uuid: 'fork', parentUuid: 'u', message: { content: 'Resume here.' } }]);
    expect(cuts(events)).toMatchObject([{ kind: 'boundary.retraction', retractedMessageUuids: delivery.slice(1).map((r) => r.uuid) }]);
  });
});


describe('FX8 local-command-only cuts', () => {
  it.each([false, true])('swaps local bookkeeping without retracting its output (tail=%s)', async (tail) => {
    const { follower, events } = await follow(fixture('local-cuts'), tail);
    expect(cuts(events)).toEqual([]);
    expect(notices(events)).toEqual([]);
    expect(follower.snapshot().chain).toEqual(['u', 'a', 'next']);
    expect(events.filter((e) => e.kind === 'user.message' && e.origin === 'local-command').map((e) => e.messageUuid)).toContain('system-output');
  });

  it('absorbs only the deferred bare compact echo, with optional attachments', async () => {
    const base = fixture('local-cuts');
    const records = [...base.slice(0, 2), { type: 'user', uuid: 'compact', parentUuid: 'a', message: { content: '/compact' } }, { type: 'attachment', uuid: 'hook', parentUuid: 'compact', attachment: { type: 'hook_success' } }, base.at(-1)!];
    const { follower, events } = await follow(records);
    expect(cuts(events)).toEqual([]);
    expect(notices(events)).toEqual([]);
    expect(follower.snapshot().chain).toEqual(['u', 'a', 'next']);
  });

  it.each(['<command-name>/review</command-name><command-message>review</command-message>', '/review', '/compact keep the sample', 'A real prompt.', '<command-name>/review</command-name> extra prose'])('does not absorb a human or skill prompt: %s', async (content) => {
    const base = fixture('local-cuts');
    const { events } = await follow([...base.slice(0, 2), { type: 'user', uuid: 'human', parentUuid: 'a', message: { content } }, base.at(-1)!]);
    expect(cuts(events)).toMatchObject([{ kind: 'boundary.retraction', retractedMessageUuids: ['human'] }]);
  });

  it('keeps a genuine fork when a local command accompanies a real answer', async () => {
    const base = fixture('local-cuts');
    const { events } = await follow([...base.slice(0, -1), { type: 'assistant', uuid: 'answer', parentUuid: 'system-output', message: { id: 'real', content: [{ type: 'text', text: 'Another answer.' }] } }, base.at(-1)!]);
    expect(cuts(events)).toHaveLength(1);
  });
});


describe('FX8 synthetic no-response cuts', () => {
  it.each([false, true])('silently absorbs the exact synthetic assistant (tail=%s)', async (tail) => {
    const { follower, events } = await follow(fixture('no-response'), tail);
    expect(cuts(events)).toEqual([]);
    expect(notices(events)).toEqual([]);
    expect(follower.snapshot().chain).toEqual(['u', 'next']);
  });

  it.each(['real-model', 'api-error', 'extra-block', 'different-text'])('keeps %s as a real removal', async (shape) => {
    const records = fixture('no-response');
    const assistant = records[1];
    const message = assistant.message as { model: string; content: { type: string; text: string }[] };
    if (shape === 'real-model') message.model = 'sample-model';
    if (shape === 'api-error') assistant.isApiErrorMessage = true;
    if (shape === 'extra-block') message.content.push({ type: 'text', text: 'Real content.' });
    if (shape === 'different-text') message.content[0].text = 'A real answer.';
    const { events } = await follow(records);
    expect(cuts(events)).toMatchObject([{ kind: 'boundary.retraction', retractedMessageUuids: ['synthetic'] }]);
  });
});


it('FX8 E: a forward-parent continuation removes nothing and emits no boundary or notice', async () => {
  const records = fixture('empty-cut');
  const { reader, follower, events } = await follow(records.slice(0, -1));
  expect(follower.snapshot().rewind).toBeNull();
  expect(follower.snapshot().chain).toEqual(['u', 'late']);
  const before = events.length;
  reader.append(bytes(records.slice(-1)));
  await follower.poke();
  expect(cuts(events.slice(before))).toEqual([]);
  expect(notices(events.slice(before))).toEqual([]);
  expect(follower.snapshot().chain).toEqual(['u', 'late', 'early', 'next']);
  expect(follower.snapshot().rewind).toBeNull();
});
