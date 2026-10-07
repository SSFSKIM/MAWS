// E10 (§Design 2): in detached mode the engine host's events cross a Unix socket as JSON lines, and JSON has no
// `undefined`: a key whose value is `undefined` disappears, and a key typed `z.unknown()` is required by its schema
// (`permission.requested.input`, `hook.callback_*`, `tool.use.input`, `dialog.*`…), so such an event would fail X2 on
// the far side and drop its whole batch. Every event the normaliser draws from the recorded fixtures, and every event
// the disk backfill draws from the transcript fixtures, must survive `JSON.parse(JSON.stringify(...))` and validate
// again as a `session.eventBatch`.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { validateEventPayload } from '@shared/ipc/validate';
import type { JournalRow } from '@shared/wire/journal';
import type { TranscriptRecord } from '@shared/wire/transcript';
import {
  FIXTURE_PASSES,
  listJournals,
  listSyntheticJournals,
  listTranscripts,
  loadJournal,
  loadSyntheticJournal,
  loadSyntheticTranscript,
  loadTranscript,
  loadTranscriptFixture,
  TEST_FIXTURE_DIR,
  TRANSCRIPT_FIXTURE_DIR,
} from '../../../test/support/fixtures';
import { createBackfillContext, recordToEvents } from '../fs/backfill';
import { Normalizer } from '../normalizer';
import { sessionIdOf } from './harness';

function normalised(journal: JournalRow[]): SessionEvent[] {
  const normalizer = new Normalizer({ appSessionId: 'app-json' as never, launchId: 'JSONWIRE', sessionId: sessionIdOf(journal) });
  return journal.flatMap((row) => normalizer.push(row));
}

// The events whose JSON copy no longer validates, with the issues, so a failure names the kind and the key.
function failuresAfterJson(events: SessionEvent[]): string[] {
  const failures: string[] = [];
  for (const event of events) {
    const copy = JSON.parse(JSON.stringify(event)) as unknown;
    const checked = validateEventPayload('session.eventBatch', { appSessionId: 'app-json', events: [copy] } as never);
    if (!checked.ok) failures.push(`${event.kind} ${event.id}: ${JSON.stringify(checked.issues).slice(0, 300)}`);
  }
  return failures;
}

const journals = [
  ...FIXTURE_PASSES.flatMap((pass) => listJournals(pass).map((name) => ({ label: `${pass}/${name}`, load: () => loadJournal(pass, name) }))),
  ...listSyntheticJournals().map((name) => ({ label: `synthetic/${name}`, load: () => loadSyntheticJournal(name) })),
];

// The protocol probe's sidecars, C4's store copies (test/fixtures/transcripts) and the transcript-shaped synthetic files.
const transcripts: { label: string; load: () => TranscriptRecord[] }[] = [
  ...listTranscripts().map((path) => ({ label: path, load: () => loadTranscript(path) })),
  ...readdirSync(TRANSCRIPT_FIXTURE_DIR)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.slice(0, -'.jsonl'.length))
    .map((name) => ({ label: `transcripts/${name}`, load: () => loadTranscriptFixture(name) })),
  ...readdirSync(TEST_FIXTURE_DIR)
    .filter((file) => /^transcript-.*\.jsonl$/.test(file))
    .map((file) => file.slice(0, -'.jsonl'.length))
    .map((name) => ({ label: name, load: () => loadSyntheticTranscript(name) })),
];

describe('the engine host’s events survive a JSON wire', () => {
  it('finds the fixtures', () => {
    expect(journals.length).toBeGreaterThan(100);
    expect(transcripts.length).toBeGreaterThan(25);
  });

  it('every normalised event of every recorded journal validates after a JSON round trip', () => {
    const kinds = new Set<string>();
    let count = 0;
    const failures: string[] = [];
    for (const { label, load } of journals) {
      const events = normalised(load());
      count += events.length;
      for (const event of events) kinds.add(event.kind);
      failures.push(...failuresAfterJson(events).map((failure) => `${label}: ${failure}`));
    }
    expect(count).toBeGreaterThan(1_000);
    // the kinds whose `z.unknown()` keys a missing frame field would empty are among those checked
    for (const kind of ['tool.use', 'tool.result', 'permission.requested', 'permission.resolved', 'hook.callback_requested', 'hook.callback_resolved', 'usage.sample']) expect(kinds).toContain(kind);
    expect(failures).toEqual([]);
  });

  it('the check catches a required unknown-typed key that JSON drops (a negative control)', () => {
    let probe: SessionEvent | undefined;
    for (const { load } of journals) if ((probe = normalised(load()).find((event) => event.kind === 'tool.use'))) break;
    if (!probe) throw new Error('no fixture yields a tool.use');
    expect(failuresAfterJson([probe])).toEqual([]);
    expect(failuresAfterJson([{ ...probe, input: undefined } as SessionEvent])).toHaveLength(1);
  });

  it('every backfilled event of every transcript fixture validates after a JSON round trip', () => {
    let count = 0;
    const failures: string[] = [];
    for (const { label, load } of transcripts) {
      const records = load();
      const sessionId = (records.find((r) => typeof (r as { sessionId?: unknown }).sessionId === 'string') as { sessionId?: string } | undefined)?.sessionId ?? 'json-wire';
      const ctx = createBackfillContext({ sessionId: sessionId as SessionId, agent: null });
      const events = records.flatMap((record) => recordToEvents(record, ctx));
      count += events.length;
      failures.push(...failuresAfterJson(events).map((failure) => `${label}: ${failure}`));
    }
    expect(count).toBeGreaterThan(400);
    expect(failures).toEqual([]);
  });
});
