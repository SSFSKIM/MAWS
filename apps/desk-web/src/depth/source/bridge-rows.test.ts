// The rows the doperpowers plugin appends, a closed set (`bridge-rows.ts`): a steer, known by its own first line from
// doperpowers 7.180.0, a delivery, the interrupt's marker, note and older record, a stop's note, the `/secret` mod's
// record, and an older bridge's steer, known by exclusion. Every such row in the doperpowers fixtures MAWS vendors has
// its kind pinned here by its whole text, so a fixture re-vendored with a new kind of row fails here until that kind is
// named, rather than drawing as the owner's words. Each kind is then read off DX5's own texts, and a steer is drawn as
// the owner's prompt queued into the running turn, as MAWS draws one there, without its line.
import { readFileSync } from 'node:fs';
import { loadRecording, SESSION_VIEW, TWO_SUBAGENTS } from 'desk-hub/fake-machine';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { isBridgeRow } from '../../conversation/delivery-frame';
import { bridgeRowKind, isMirrorLine, markedSteerWords, STEER_LINE, steerAsDrawn, type BridgeRowKind } from './bridge-rows';
import { freshSource, subagentLookupOf } from './desk-transcript';

/** The doperpowers fixtures MAWS vendors: DX4's vectors (written by doperpowers' `tests/sminos/dx4-jobs.gen.py`). */
const VECTORS = new URL('../../../../desk-hub/fake-machine/dx4/dx4-jobs.json', import.meta.url);

/** Every row the plugin appended, anywhere in a fixture, in file order. */
function appendedRows(value: unknown, out: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(value)) for (const item of value) appendedRows(item, out);
  else if (typeof value === 'object' && value !== null) {
    if (isBridgeRow(value as JsonObject)) out.push(value as JsonObject);
    else for (const item of Object.values(value)) appendedRows(item, out);
  }
  return out;
}
const textOf = (row: JsonObject) => ((row.message as JsonObject).content as Array<{ text: string }>).map((block) => block.text).join('\n');

const STOP = (task: string, from: string) => `Task ${task}, a background task, was stopped from ${from}: it is not running.`;
const STOPPED = (task: string) => `Task ${task}, the Bash command the interrupt moved to the background, was then stopped: it is not running, and no notification will come for it.`;
const RUNNING = (task: string) => `Task ${task}, the Bash command the interrupt moved to the background, could not be stopped: it may still be running.`;

let n = 0;
const appended = (text: string): JsonObject => ({
  uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  parentUuid: null,
  timestamp: '2026-10-17T10:00:00.000Z',
  sessionId: 'sess-1',
  isSidechain: false,
  type: 'user',
  isMeta: true,
  origin: { kind: 'plugin', name: 'doperpowers' },
  message: { role: 'user', content: [{ type: 'text', text }] },
});

describe("the plugin's appended rows", () => {
  it('pins the kind of every one in the vendored doperpowers fixtures: a new kind fails here, not drawn as the owner’s words', () => {
    const rows = [
      ...appendedRows(JSON.parse(readFileSync(VECTORS, 'utf8'))),
      ...[SESSION_VIEW, TWO_SUBAGENTS].flatMap((dir) => appendedRows(loadRecording(dir).rows)),
    ];
    // DX4's case 18: the bridge's notes and marker, then rows a person steered that only quote a note.
    expect(rows.map((row) => [textOf(row), bridgeRowKind(row)])).toEqual([
      [STOP('bdesk0001', 'the desk'), 'stop-note'],
      [STOP('bmon00002', 'outside the terminal'), 'stop-note'],
      ['[Request interrupted by user]', 'interrupt-marker'],
      [['The interrupt came from the desk.', STOPPED('bmove0003'), RUNNING('bstuck004')].join('\n'), 'interrupt-note'],
      [`please stop: ${STOP('btyped005', 'the desk')}`, 'steer'],
      [`\`\`\`\n${STOP('btyped005', 'the desk')}\n\`\`\``, 'steer'],
      [`${STOP('btyped005', 'the desk')}\n`, 'steer'],
      [['The interrupt came from the desk.', STOPPED('btyped005'), 'thanks'].join('\n'), 'steer'],
    ]);
  });

  it("reads each kind off DX5's texts, and any other text as a steer", () => {
    const kinds: Array<[string, BridgeRowKind]> = [
      // A steer from 7.180.0, its own first line, whatever its words: the interrupt's marker or a note quoted whole, a
      // delivery's frame, the line again.
      [`${STEER_LINE}\nuse the split store`, 'steer'],
      [`${STEER_LINE}\n[Request interrupted by user]`, 'steer'],
      [`${STEER_LINE}\n${STOP('bk3x9a1', 'the desk')}`, 'steer'],
      [`${STEER_LINE}\n${['The interrupt came from the desk.', STOPPED('bk3x9a1')].join('\n')}`, 'steer'],
      [`${STEER_LINE}\n[sminos message from human id=5e551e17]\nRe-run the suites.`, 'steer'],
      [`${STEER_LINE}\n${STEER_LINE}`, 'steer'],
      ['[sminos chat MAWS hub/5e55e5e5:12 from human → @you]\nRun the suites.', 'delivery'],
      ['[sminos message from human id=5e551e17]\nRe-run the suites.', 'delivery'],
      ['[Request interrupted by user]', 'interrupt-marker'],
      ['[Request interrupted by user for tool use]', 'interrupt-marker'],
      ['The interrupt came from the desk.', 'interrupt-note'],
      [['The interrupt came from outside the terminal.', STOPPED('bk3x9a1'), RUNNING('b_7-q')].join('\n'), 'interrupt-note'],
      [STOP('bk3x9a1', 'the desk'), 'stop-note'],
      [STOP('bk3x9a1', 'outside the terminal'), 'stop-note'],
      ['[Request interrupted by user from the desk]', 'interrupt-record'],
      [['[Request interrupted by user from outside the terminal]', STOPPED('bk3x9a1')].join('\n'), 'interrupt-record'],
      ['The person stored a secret under OPENAI_API_KEY. You never see its value. In a shell command, read it as "$(cat ~/.config/claude-secrets/OPENAI_API_KEY)", never printing it.', 'secret-note'],
      ['use the split store', 'steer'],
      ['[sminos chat MAWS hub/5e55e5e5:12 from human → @you]', 'steer'], // a frame line with nothing after it is no delivery
      ['The interrupt came from the desk. Thanks', 'steer'],
      ['The person stored a secret under A. You never see its value. In a shell command, read it as "$(cat ~/.config/claude-secrets/B)", never printing it.', 'steer'],
      [STEER_LINE, 'steer'], // the line with no words after it marks nothing: an older bridge's steer of those words
      [` ${STEER_LINE}\nuse the split store`, 'steer'],
    ];
    expect(kinds.map(([text]) => [text, bridgeRowKind(appended(text))])).toEqual(kinds);
    // Only a row that opens with the whole line, words after it, is marked; the rest are steers by exclusion.
    expect(kinds.map(([text]) => markedSteerWords(appended(text)) !== null)).toEqual([true, true, true, true, true, true, ...kinds.slice(6).map(() => false)]);
    expect(markedSteerWords({ ...appended(`${STEER_LINE}\nuse the split store`), origin: { kind: 'plugin', name: 'another' } })).toBeNull();
    // Nothing the plugin did not append is one of its rows.
    expect(bridgeRowKind({ ...appended('use the split store'), origin: { kind: 'plugin', name: 'another' } })).toBeNull();
    expect(bridgeRowKind({ ...appended('use the split store'), isMeta: false })).toBeNull();
    expect(bridgeRowKind({ ...appended('use the split store'), origin: { kind: 'human' } })).toBeNull();
    // The engine's companion beside a turn: a plugin skill's body, loaded for a command the plugin ran, with the plugin's
    // origin (local transcripts, 2.1.272–2.1.277). Never a steer, never drawn.
    const skill = { ...appended('Base directory for this skill: /Users/new/.claude/plugins/cache/doperpowers/doperpowers/7.120.0/skills/kairos\n\nYou are in kairos mode.'), turnCompanion: true, queuePriority: 'later' };
    expect(bridgeRowKind(skill)).toBeNull();
    expect(steerAsDrawn(skill)).toBe(skill);
  });

  it('reads the rows of a bridge running in either plugin, doperpowers before the roll or sminos after, and its mirror lines', () => {
    // The sminos plugin (doperpowers' sminos plugin design, §11): the engine names an appended row, and the notice of its
    // `$.ui.log`, by the plugin that wrote it.
    for (const name of ['doperpowers', 'sminos']) {
      const under = (text: string) => ({ ...appended(text), origin: { kind: 'plugin', name } });
      expect(markedSteerWords(under(`${STEER_LINE}\nuse the split store`)), name).toBe('use the split store');
      expect(bridgeRowKind(under('[Request interrupted by user]')), name).toBe('interrupt-marker');
      expect(bridgeRowKind(under(STOP('bk3x9a1', 'the desk'))), name).toBe('stop-note');
      expect(bridgeRowKind(under('use the split store')), name).toBe('steer');
      for (const kind of ['steer', 'delivered']) {
        expect(isMirrorLine({ type: 'system', subtype: 'informational', content: `${name}: ${kind}: use the split store`, level: 'notice' }), `${name} ${kind}`).toBe(true);
      }
    }
    expect(isMirrorLine({ type: 'system', subtype: 'informational', content: 'another: steer: use the split store', level: 'notice' })).toBe(false);
  });

  it('draws a steer as the owner’s prompt queued into the running turn, under its row’s uuid; the others as they are', () => {
    const steer = appended('use the split store');
    expect(steerAsDrawn(steer)).toEqual({
      uuid: steer.uuid, parentUuid: null, timestamp: steer.timestamp, sessionId: 'sess-1', isSidechain: false, type: 'attachment',
      attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'use the split store' }], commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: steer.uuid },
    });
    for (const text of ['[Request interrupted by user]', 'The interrupt came from the desk.', STOP('bk3x9a1', 'the desk'), '[sminos chat MAWS hub/5e55e5e5:12 from human → @you]\nRun the suites.']) {
      const row = appended(text);
      expect(steerAsDrawn(row), text).toBe(row);
    }
  });

  it('draws a marked steer without its line, but keeps the line on words MAWS would read as an interrupt marker', () => {
    const steer = appended(`${STEER_LINE}\nuse the split store\nand the tests`);
    expect((steerAsDrawn(steer).attachment as JsonObject).prompt).toEqual([{ type: 'text', text: 'use the split store\nand the tests' }]);
    for (const words of ['[Request interrupted by user]', ' [Request interrupted by user for tool use]', '[Request interrupted by user from the desk]']) {
      const row = appended(`${STEER_LINE}\n${words}`);
      expect((steerAsDrawn(row).attachment as JsonObject).prompt, words).toEqual([{ type: 'text', text: `${STEER_LINE}\n${words}` }]);
    }
  });
});

describe('a steer through MAWS’s backfill and projection', () => {
  const SESSION = 'sess-1';
  const at = (second: number) => `2026-10-17T10:00:${String(second).padStart(2, '0')}.000Z`;
  const envelope = (second: number) => ({ uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, parentUuid: null, timestamp: at(second), sessionId: SESSION, isSidechain: false });
  const prompt = (text: string, second = 0): JsonObject => ({ ...envelope(second), type: 'user', origin: { kind: 'human' }, promptId: 'p1', message: { role: 'user', content: text } });
  const assistant = (content: JsonObject[], second: number): JsonObject => ({ ...envelope(second), type: 'assistant', message: { id: `msg_${n}`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content, stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  const call = (id: string, second: number) => assistant([{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }], second);
  const result = (id: string, second: number): JsonObject => ({ ...envelope(second), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'a.txt', is_error: false }] }, toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false, isImage: false } });
  const atSecond = (row: JsonObject, second: number): JsonObject => ({ ...row, timestamp: at(second) });

  async function drawn(rows: JsonObject[]): Promise<{ rows: Row[]; turns: number }> {
    const store = createTranscriptStore();
    await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
    const entry = store.getState().entries.fresh;
    return { rows: entry.rows, turns: entry.state.order.length };
  }
  const users = (rows: Row[]) => rows.filter((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user');

  it('is the owner’s bubble in the turn it entered, "Sent during this turn", keyed by its row’s uuid, opening no turn', async () => {
    const steer = atSecond(appended('use the split store'), 2);
    const { rows, turns } = await drawn([prompt('List the files.'), call('toolu_s1', 1), result('toolu_s1', 2), steer, assistant([{ type: 'text', text: 'Switching to the split store.' }], 3)]);
    expect(users(rows).map((u) => [u.text, u.steer])).toEqual([
      ['List the files.', false],
      ['use the split store', true],
    ]);
    expect(users(rows)[1].messageUuid).toBe(steer.uuid);
    expect(turns).toBe(1);
  });

  it('marked, is drawn the same: the owner’s words in their bubble, the line not drawn; words that are the interrupt’s marker end no turn', async () => {
    const steer = atSecond(appended(`${STEER_LINE}\nuse the split store`), 2);
    const { rows, turns } = await drawn([prompt('List the files.'), call('toolu_s3', 1), result('toolu_s3', 2), steer, assistant([{ type: 'text', text: 'Switching to the split store.' }], 3)]);
    expect(users(rows).map((u) => [u.text, u.steer, u.messageUuid])).toEqual([
      ['List the files.', false, expect.any(String)],
      ['use the split store', true, steer.uuid],
    ]);
    expect(turns).toBe(1);
    const marker = atSecond(appended(`${STEER_LINE}\n[Request interrupted by user]`), 2);
    const quoted = await drawn([prompt('List the files.'), call('toolu_s4', 1), result('toolu_s4', 2), marker, assistant([{ type: 'text', text: 'Still listing.' }], 3)]);
    expect(users(quoted.rows).map((u) => [u.text, u.steer])).toEqual([
      ['List the files.', false],
      [`${STEER_LINE}\n[Request interrupted by user]`, true],
    ]);
    expect(quoted.rows.find((r) => r.kind === 'divider')).toMatchObject({ state: 'working' });
  });

  it("draws none of the bridge's records beside it: the interrupt's marker and note, a stop's note", async () => {
    const records = [appended('[Request interrupted by user]'), appended(['The interrupt came from the desk.', STOPPED('bk3x9a1')].join('\n')), appended(STOP('bk3x9a1', 'the desk'))].map((row) => atSecond(row, 3));
    const { rows } = await drawn([prompt('List the files.'), call('toolu_s2', 1), result('toolu_s2', 2), ...records]);
    expect(users(rows).map((u) => u.text)).toEqual(['List the files.']);
  });
});
