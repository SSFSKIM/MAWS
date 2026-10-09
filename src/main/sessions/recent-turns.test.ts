// P2-D (the P2 spec, child P2-D, G4): the resume chooser's preview read over real engine transcripts
// (test/fixtures/transcripts/, recorded on the engine) and small synthesised ones for the edges.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECENT_TURN_PROMPT_MAX, RecentTurnsSchema } from '@shared/ipc/schema/session';
import { NO_TURNS, readRecentTurns, recentTurnsOf } from './recent-turns';

const ROOT = join(__dirname, '../../..');
const fixture = (name: string) => join(ROOT, 'test/fixtures/transcripts', `${name}.jsonl`);
const text = (name: string) => readFileSync(fixture(name), 'utf8');
const brief = (name: string, limit = 20) =>
  recentTurnsOf(text(name), limit, false).turns.map((t) => ({ prompt: t.prompt?.text ?? null, answer: t.answer?.text ?? null, tools: t.toolCalls }));

// A minimal chain: user, assistant, user, assistant…, each record's parent the one before.
function chain(entries: { type: 'user' | 'assistant'; content: unknown }[], from: string | null = null): string {
  let parent = from;
  return entries
    .map((entry, i) => {
      const uuid = `u-${i}-${entry.type}`;
      const record = { type: entry.type, uuid, parentUuid: parent, sessionId: 's-1', timestamp: `2026-10-09T10:00:${String(i).padStart(2, '0')}.000Z`, message: { role: entry.type, content: entry.content } };
      parent = uuid;
      return JSON.stringify(record);
    })
    .join('\n');
}

describe('recentTurnsOf', () => {
  it('one turn per human prompt, its last answer and its tool calls (a steer the engine took folds into its turn)', () => {
    expect(brief('w1-steer-next-disk')).toEqual([{ prompt: expect.stringMatching(/^Count to 8 with separate Bash sleep 1 calls/), answer: 'COUNTED', tools: 8 }]);
  });

  it('keeps the current chain: a rewound branch drops out', () => {
    expect(brief('rewind-real')).toEqual([
      { prompt: 'Remember the word APPLE. Reply OK.', answer: 'OK', tools: 0 },
      { prompt: expect.stringMatching(/^List every word I asked you to remember/), answer: 'APPLE', tools: 0 },
    ]);
  });

  it('reads a slash command as typed and says history precedes a compaction boundary', () => {
    const answer = recentTurnsOf(text('w1-compact'), 20, false);
    expect(answer.turns.map((t) => t.prompt?.text)).toEqual(['/compact', 'Reply TWO']);
    expect(answer.earlier).toBe(true);
  });

  it('an engine-initiated turn (a task notification) shows its answer with no prompt', () => {
    const turns = brief('subagent-parent');
    expect(turns[0]).toMatchObject({ prompt: expect.stringMatching(/^Dispatch two general-purpose Agent subagents/), tools: 2 });
    expect(turns.slice(1).map((t) => t.prompt)).toEqual([null, null]);
    expect(turns.at(-1)?.answer).toMatch(/^Both agents finished/);
  });

  it('the last `limit` turns, oldest first, and `earlier` when more precede them', () => {
    const all = recentTurnsOf(text('torn-tail'), 20, false);
    const two = recentTurnsOf(text('torn-tail'), 2, false);
    expect(two.turns).toEqual(all.turns.slice(-2));
    expect(all.earlier).toBe(false);
    expect(two.earlier).toBe(true);
  });

  it('a window cut mid-file whose chain does not reach a root has earlier turns', () => {
    const tail = chain([{ type: 'user', content: 'later' }, { type: 'assistant', content: [{ type: 'text', text: 'done' }] }], 'u-missing');
    expect(recentTurnsOf(tail, 5, true)).toEqual({ turns: [{ prompt: { text: 'later', at: '2026-10-09T10:00:00.000Z' }, answer: { text: 'done', at: '2026-10-09T10:00:01.000Z' }, toolCalls: 0 }], earlier: true, source: 'transcript' });
    expect(recentTurnsOf(chain([{ type: 'user', content: 'first' }]), 5, true).earlier, 'a chain rooted in the window').toBe(false);
  });

  it('the answer is owner-aware (no raw marks) and the prompt capped; an image-only prompt reads [Image]', () => {
    const answer = recentTurnsOf(
      chain([
        { type: 'user', content: 'x'.repeat(RECENT_TURN_PROMPT_MAX + 50) },
        { type: 'assistant', content: [{ type: 'text', text: 'Working notes\n<to-human>\nThe build is green.\n</to-human>' }] },
        { type: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }] },
      ]),
      5,
      false,
    );
    expect(answer.turns[0].prompt?.text).toHaveLength(RECENT_TURN_PROMPT_MAX);
    expect(answer.turns[0].answer?.text).toBe('The build is green.');
    expect(answer.turns[1].prompt?.text).toBe('[Image]');
    expect(RecentTurnsSchema.safeParse(answer).success).toBe(true);
  });

  it('an empty or unparsable text has no turns', () => {
    expect(recentTurnsOf('', 5, false)).toEqual({ turns: [], earlier: false, source: 'transcript' });
    expect(recentTurnsOf('{"type":"user", torn', 5, true).turns).toEqual([]);
  });
});

describe('readRecentTurns', () => {
  it('no path or no file answers none', async () => {
    expect(await readRecentTurns(null, 5)).toEqual(NO_TURNS);
    expect(await readRecentTurns(join(tmpdir(), 'maws-no-such-transcript.jsonl'), 5)).toEqual(NO_TURNS);
  });

  it('reads the tail only: a window smaller than the file drops the turns before it and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-recent-'));
    const path = join(dir, 't.jsonl');
    const turns = Array.from({ length: 40 }, (_, i) => [{ type: 'user' as const, content: `prompt ${i} ${'p'.repeat(200)}` }, { type: 'assistant' as const, content: [{ type: 'text', text: `answer ${i}` }] }]).flat();
    writeFileSync(path, `${chain(turns)}\n`);
    const whole = await readRecentTurns(path, 20);
    expect(whole.turns.at(-1)?.answer?.text).toBe('answer 39');
    expect(whole.earlier).toBe(true); // forty turns, twenty asked
    const window = await readRecentTurns(path, 20, undefined, 2_000);
    expect(window.turns.length).toBeLessThan(20);
    expect(window.turns.at(-1)?.answer?.text).toBe('answer 39');
    expect(window.earlier).toBe(true);
  });
});
