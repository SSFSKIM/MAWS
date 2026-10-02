import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { hasCompletedReply, waitForSeedTranscript } from './live-seed';

const prompt = 'Reply with exactly READY';
const user = { type: 'user', message: { role: 'user', content: prompt } };
const assistant = { type: 'assistant', isSidechain: false, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'READY' }] } };
const jsonl = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

test('only a completed main assistant reply to the seed prompt counts', () => {
  expect(hasCompletedReply(jsonl(user), prompt, 'READY')).toBe(false);
  expect(hasCompletedReply(jsonl(user, { ...assistant, message: { ...assistant.message, stop_reason: null } }), prompt, 'READY')).toBe(false);
  expect(hasCompletedReply(jsonl(user, { ...assistant, isSidechain: true }), prompt, 'READY')).toBe(false);
  expect(hasCompletedReply(jsonl(user, { ...assistant, message: { ...assistant.message, stop_reason: 'tool_use' } }), prompt, 'READY')).toBe(false);
  expect(hasCompletedReply(jsonl(assistant), prompt, 'READY')).toBe(false);
  expect(hasCompletedReply(jsonl(user, assistant), prompt, 'READY')).toBe(true);
  expect(hasCompletedReply(jsonl(user, assistant), prompt, 'OTHER')).toBe(false);
  expect(hasCompletedReply(jsonl(user) + JSON.stringify(assistant).slice(0, -5), prompt, 'READY')).toBe(false);
});

test('a captured pinned-engine transcript provides completed-turn evidence', () => {
  const fixture = readFileSync(join(import.meta.dirname, '../fixtures/transcripts/sdk-unended.jsonl'), 'utf8');
  expect(hasCompletedReply(fixture, 'reply with exactly: ok', 'ok')).toBe(true);
});

test('an echoed prompt and existing transcript cannot seed a session; a later completed reply can', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maws-seed-test-'));
  const dir = join(root, 'transcripts');
  mkdirSync(dir);
  writeFileSync(join(dir, 'old.jsonl'), jsonl(user, assistant));
  writeFileSync(join(dir, 'new.jsonl'), jsonl(user));
  try {
    await expect(waitForSeedTranscript(dir, new Set(['old.jsonl']), prompt, 'READY', 30, 5)).rejects.toThrow('completed');
    const timer = setTimeout(() => writeFileSync(join(dir, 'new.jsonl'), jsonl(user, assistant)), 10);
    try {
      await expect(waitForSeedTranscript(dir, new Set(['old.jsonl']), prompt, 'READY', 1000, 5)).resolves.toBe('new');
    } finally { clearTimeout(timer); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
