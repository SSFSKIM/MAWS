// The stub-retirement gate (C6 execution document, "Replay stub, synthetic fixtures and harness"): over every
// conformance journal of the three passes and every synthetic journal, the replay stub and C3's normaliser yield the
// same events in the same order, field by field except `id`, over the kinds the stub emits other than `frame.unknown`
// (C3's other kinds filtered out). A mismatch names the journal, seq, kind and field with both values.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PASSES, listJournals, listSyntheticJournals, loadJournal, loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { Normalizer } from '../../../../engine-host/normalizer';
import { journalToEvents } from './replay-stub';

const STUB_KINDS: ReadonlySet<string> = new Set([
  'api.retry', 'assistant.block.complete', 'assistant.block.delta', 'boundary.compaction', 'boundary.reset', 'boundary.retraction', 'boundary.rewind',
  'command.lifecycle', 'dialog.requested', 'dialog.resolved', 'elicitation.requested', 'elicitation.resolved', 'hook.callback_requested',
  'hook.callback_resolved', 'hook.finished', 'hook.started', 'notice.posted', 'permission.requested', 'permission.resolved', 'plan.requested',
  'plan.resolved', 'process.exited', 'question.answered', 'question.requested', 'session.commands', 'session.init', 'session.state',
  'subagent.finished', 'subagent.progress', 'subagent.started', 'task.notification', 'task.started', 'task.updated', 'tasks.snapshot',
  'tool.progress', 'tool.result', 'tool.safeguard', 'tool.use', 'turn.ended', 'turn.started', 'user.message', 'workflow.progress',
]);

const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical)
  : typeof value === 'object' && value !== null ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
  : value;
const json = (value: unknown) => JSON.stringify(canonical(value));

function mismatches(label: string, rows: JournalRow[]): string[] {
  const stub = journalToEvents(rows).filter((event) => event.kind !== 'frame.unknown');
  const normalizer = new Normalizer({ appSessionId: 'gate' as AppSessionId, launchId: 'GATE', sessionId: null });
  const c3 = rows.flatMap((row) => normalizer.push(row)).filter((event) => STUB_KINDS.has(event.kind));
  const found: string[] = [];
  for (let i = 0; i < Math.max(stub.length, c3.length); i += 1) {
    const [a, b] = [stub[i], c3[i]] as (SessionEvent | undefined)[];
    if (!a || !b || a.kind !== b.kind || a.seq !== b.seq) {
      found.push(`${label} event ${i}: stub ${a ? `${a.kind}@${a.seq}` : 'none'}, C3 ${b ? `${b.kind}@${b.seq}` : 'none'}`);
      break; // order diverged; later positions would only repeat it
    }
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (field === 'id') continue;
      const [x, y] = [(a as Record<string, unknown>)[field], (b as Record<string, unknown>)[field]];
      if (json(x) !== json(y)) found.push(`${label} seq ${a.seq} ${a.kind}.${field}: stub ${json(x)}, C3 ${json(y)}`);
    }
  }
  return found;
}

describe('replay stub equivalence with C3’s normaliser', () => {
  for (const pass of FIXTURE_PASSES) {
    for (const name of listJournals(pass)) it(`${pass}/${name}`, () => expect(mismatches(`${pass}/${name}`, loadJournal(pass, name))).toEqual([]));
  }
  for (const name of listSyntheticJournals()) it(`transcript/${name}`, () => expect(mismatches(`transcript/${name}`, loadSyntheticJournal(name))).toEqual([]));

  it('covers the 51 conformance journals', () => expect(FIXTURE_PASSES.flatMap((pass) => listJournals(pass))).toHaveLength(51));
});
