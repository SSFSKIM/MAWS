// UX wave U2b (panel finding 4): a text's ask reads its turn's live text blocks from an index built once for each live
// map, with the same answers as the walk over the blocks it replaced (kept here as the reference, as it stood). Seeded
// turns: several API messages, blocks out of order, blocks sharing a message uuid (the qualified ids), blocks with no uuid
// or no API message, thoughts and calls among them, a block that delivered no text of its own.
import { describe, expect, it } from 'vitest';
import type { ApiMessageId, MessageUuid } from '@shared/graph/ids';
import type { LiveBlock, TurnState } from '../model/reduce';
import { rowId } from '../model/keys';
import type { Row } from '../model/rows';
import { assistantInput } from './adapters';

type TextRow = Extract<Row, { kind: 'assistant_text' }>;

// The walk as it stood before the index (adapters.ts at the panel's range), for the ask's two reads of the turn.
function reference(row: TextRow, turn: TurnState | undefined) {
  if (!row.markdown.trim()) return null;
  const identity = row.id.slice(row.id.indexOf(':') + 1);
  const api = identity.slice(0, identity.lastIndexOf(':'));
  const peers = [...(turn?.live.values() ?? [])].filter((b) => b.blockType === 'text' && b.apiMessageId === api);
  const firstIndex = peers.length ? Math.min(...peers.map((b) => b.blockIndex)) : row.blockIndex;
  const sameMessage = peers.filter((b) => b.messageUuid === row.messageUuid);
  const firstMessageBlock = sameMessage.length ? Math.min(...sameMessage.map((b) => b.blockIndex)) : row.blockIndex;
  const instanceId = row.messageUuid === null ? row.id : row.blockIndex === firstMessageBlock ? row.messageUuid : `${row.messageUuid}:text:${row.blockIndex}`;
  const text = peers.find((block) => block.rowId === row.id)?.sourceText ?? row.markdown;
  return { instanceId, props: { text, isFirstOfReply: row.blockIndex === firstIndex } };
}

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededTurn(seed: number): { turn: TurnState; rows: TextRow[] } {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const apis = ['msg_a', 'msg_b', 'msg_c'].map((a) => a as ApiMessageId);
  const uuids = ['uuid-1', 'uuid-2', 'uuid-3'].map((u) => u as MessageUuid);
  const live = new Map<string, LiveBlock>();
  const rows: TextRow[] = [];
  const count = 1 + Math.floor(next() * 12);
  for (let n = 0; n < count; n += 1) {
    const api = next() < 0.1 ? null : pick(apis);
    const blockIndex = Math.floor(next() * 8);
    const blockType = pick(['text', 'text', 'text', 'thinking', 'tool_use'] as const);
    const messageUuid = next() < 0.2 ? null : pick(uuids);
    const rowFor = rowId.text(api ?? pick(apis), next() < 0.1 ? blockIndex + 1 : blockIndex);
    const sourceText = next() < 0.2 ? undefined : `delivered ${n}`;
    live.set(`${api}:${blockIndex}:${n}`, { apiMessageId: api, blockIndex, blockType, buffer: '', sourceText, rowId: rowFor, completed: true, markerEventId: null, completeEventId: null, completedAt: null, messageUuid, model: null });
    rows.push({ kind: 'assistant_text', id: rowFor, turnId: null, messageUuid: next() < 0.15 ? null : pick(uuids), blockIndex, markdown: next() < 0.1 ? '  ' : `drawn ${n}`, live: false, phase: 'commentary', model: null } as TextRow);
  }
  // rows whose API message holds no block of the turn's
  rows.push({ kind: 'assistant_text', id: rowId.text('msg_z' as ApiMessageId, 2), turnId: null, messageUuid: uuids[0]!, blockIndex: 2, markdown: 'alone', live: false, phase: 'answer', model: null } as TextRow);
  return { turn: { live } as TurnState, rows };
}

describe('the ask’s reads of the turn’s text blocks', () => {
  it('give the walk’s answers on every seeded turn, with no turn too', () => {
    let compared = 0;
    let qualified = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const { turn, rows } = seededTurn(seed);
      for (const row of rows) {
        expect(assistantInput(row, turn), `seed ${seed}, ${row.id}`).toEqual(reference(row, turn));
        expect(assistantInput(row, undefined), `seed ${seed}, ${row.id}, no turn`).toEqual(reference(row, undefined));
        if (assistantInput(row, turn)?.instanceId.includes(':text:')) qualified += 1;
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(2000);
    expect(qualified).toBeGreaterThan(0); // the seeds reach the qualified ids
  });
});
