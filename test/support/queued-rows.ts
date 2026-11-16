// Queued prompts as the engine records them in a transcript (`queued_command` attachments: a message sent while a turn
// runs), shaped on recorded rows, every string of the recorded words replaced by invented ones and every mark kept.
import { loadTranscriptFixture, loadUxwaveTranscript } from './fixtures';

// Every string of `value` with each run of `words` replaced by `by`
function replaced(value: unknown, words: string, by: string): unknown {
  if (typeof value === 'string') return value.split(words).join(by);
  if (Array.isArray(value)) return value.map((item) => replaced(item, words, by));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaced(item, words, by)]));
  return value;
}
function recorded(row: unknown, words: string, by: string, where: string): object {
  if (!JSON.stringify(row).includes(JSON.stringify(words).slice(1, -1))) throw new Error(`${where} does not hold ${words}`);
  return replaced(row, words, by) as object;
}

/** The person's message queued in a running turn (origin `human`, mode `prompt`): test/fixtures/transcripts/w1-terminal-queued.jsonl. A MAWS answer or consent text is queued the same way. */
export function queuedPrompt(prompt: string): object {
  const row = loadTranscriptFixture('w1-terminal-queued').find((record) => (record as { uuid?: unknown }).uuid === '8c90e999-71e5-4ae8-9aa6-7599cd807bf0');
  return recorded(row, 'Reply TERMINAL_QUEUED', prompt, 'w1-terminal-queued');
}

/**
 * A peer session's message the inbox queued (origin `peer`, a meta row): u3-sminos-r1-maws's line 59, which recorded the
 * person's own words sminos delivered; its frame here names a session, as a peer's does (U3a's reader, arrival.ts).
 */
export function queuedPeerMessage(words: string): object {
  const own = recorded(loadUxwaveTranscript('u3-sminos-r1-maws')[58], 'UXW owner busy: also say THREE.', words, 'u3-sminos-r1-maws:59');
  return replaced(own, 'from human id=90624e56', 'from session:7ef6ac00 id=90624e56') as object;
}

/** A background task's notification queued (mode `task-notification`): u3-tasks-r2's line 132; `words` replaces its summary. */
export function queuedNotification(words: string): object {
  return recorded(loadUxwaveTranscript('u3-tasks-r2')[131], 'Background command "uxw busy fail" failed with exit code 1', words, 'u3-tasks-r2:132');
}
