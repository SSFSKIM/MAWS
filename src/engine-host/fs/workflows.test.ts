import { readFileSync } from 'node:fs';
import { appendFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { WorkflowJournalRowSchema } from '@shared/wire/store';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionId } from '@shared/graph/ids';
import { SessionEventSchema } from '@shared/graph/events';
import { FIXTURE_DIR } from '../../../test/support/fixtures';
import { StoreFixture } from '../../../test/support/store-fixture';
import { WorkflowReader, workflowProgressEvent, workflowProgressId } from './workflows';

const S1 = 'bac6130b-8eb8-499e-aeb1-89e7624a52cd' as SessionId;
const RUN = 'wf_7cacbb2d-902';
const WORKFLOW_DISK = join(FIXTURE_DIR, 'pass2/workflow-disk');
const disk = (name: string) => readFileSync(join(WORKFLOW_DISK, name), 'utf8');

describe('workflow runs are read from the snapshot and the journal', () => {
  let fixture: StoreFixture;
  let sessionDir: string;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    const transcript = await fixture.addTranscript('/private/tmp/maws-probe2-1RzDNs', S1, ['{"type":"queue-operation"}']);
    sessionDir = join(dirname(transcript), S1);
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  async function copyWorkflowDisk() {
    await fixture.addSidecar(S1, `workflows/${RUN}.json`, disk(`${RUN}.json`));
    await fixture.addSidecar(S1, `workflows/scripts/maws-probe-${RUN}.js`, disk(`maws-probe-${RUN}.js`));
    await fixture.addSidecar(S1, `subagents/workflows/${RUN}/journal.jsonl`, disk('journal.jsonl'));
    await fixture.addSidecar(S1, `subagents/workflows/${RUN}/agent-a014f6be436bed86b.meta.json`, disk('agent-a014f6be436bed86b.meta.json'));
  }

  it('lists the fixture run with its whole snapshot and five journal rows', async () => {
    await copyWorkflowDisk();
    const runs = await new WorkflowReader().list(sessionDir);
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe(RUN);
    expect(runs[0].snapshot).toMatchObject({ runId: RUN, agentCount: 2, status: 'completed', taskId: 'wayue3on6', workflowName: 'maws-probe' });
    expect(runs[0].journal.map((row) => row.type)).toEqual(['launched', 'started', 'started', 'result', 'result']);
  });

  it('reads the journal leniently, lists a run whose snapshot is not written yet, and keeps the last whole snapshot', async () => {
    await fixture.addSidecar(S1, `subagents/workflows/${RUN}/journal.jsonl`, `${disk('journal.jsonl').split('\n')[0]}\n{"type":"star`);
    const reader = new WorkflowReader();
    expect(await reader.list(sessionDir)).toEqual([{ runId: RUN, snapshot: null, journal: [{ type: 'launched' }] }]);

    const snapshot = await fixture.addSidecar(S1, `workflows/${RUN}.json`, disk(`${RUN}.json`));
    expect((await reader.list(sessionDir))[0].snapshot?.agentCount).toBe(2);
    await writeFile(snapshot, '{"runId":"wf_7cacbb2d-902","agentCou');
    expect((await reader.list(sessionDir))[0].snapshot?.agentCount).toBe(2);
  });

  it('parses only appended journal rows across progress ticks, and invalidates rewrites and replacements', async () => {
    const rows = Array.from({ length: 5000 }, (_, n) => JSON.stringify({ type: 'started', agentId: `a${n}` }) + '\n').join('');
    const path = await fixture.addSidecar(S1, `subagents/workflows/${RUN}/journal.jsonl`, rows);
    const snapshot = await fixture.addSidecar(S1, `workflows/${RUN}.json`, disk(`${RUN}.json`));
    const reader = new WorkflowReader();
    const parses = vi.spyOn(WorkflowJournalRowSchema, 'safeParse');
    try {
      expect((await reader.read(sessionDir, RUN)).journal).toHaveLength(5000);
      parses.mockClear();
      for (let tick = 0; tick < 20; tick++) {
        await writeFile(snapshot, JSON.stringify({ runId: RUN, durationMs: tick }));
        expect((await reader.read(sessionDir, RUN)).snapshot?.durationMs).toBe(tick);
      }
      expect(parses).toHaveBeenCalledTimes(0); // previously 100,000 historical row parses
      await appendFile(path, '{"type":"result","agentId":"a0"}\n');
      expect((await reader.read(sessionDir, RUN)).journal).toHaveLength(5001);
      expect(parses).toHaveBeenCalledTimes(1);
      await writeFile(path, '{"type":"launched"}\n');
      expect((await reader.read(sessionDir, RUN)).journal).toEqual([{ type: 'launched' }]);
      await writeFile(path, '{"type":"started "}\n'); // same size, changed mtime; unknown types remain readable
      await utimes(path, new Date(1000), new Date(1000));
      expect((await reader.read(sessionDir, RUN)).journal).toEqual([{ type: 'started ' }]);
      await writeFile(`${path}.new`, '{"type":"result"}\n');
      await rename(`${path}.new`, path);
      expect((await reader.read(sessionDir, RUN)).journal).toEqual([{ type: 'result' }]);
      await rm(path);
      expect((await reader.read(sessionDir, RUN)).journal).toEqual([]);
    } finally {
      parses.mockRestore();
    }
  });

  it('repairs a torn journal tail without duplicating the completed rows', async () => {
    const path = await fixture.addSidecar(S1, `subagents/workflows/${RUN}/journal.jsonl`, '{"type":"launched"}\n{"type":"star');
    const reader = new WorkflowReader();
    expect((await reader.read(sessionDir, RUN)).journal).toEqual([{ type: 'launched' }]);
    await appendFile(path, 'ted"}\n');
    expect((await reader.read(sessionDir, RUN)).journal).toEqual([{ type: 'launched' }, { type: 'started' }]);
  });

  it('lists nothing for a session with no workflows', async () => {
    expect(await new WorkflowReader().list(sessionDir)).toEqual([]);
  });

  it('turns a snapshot into the wire-shaped workflow.progress, the whole progress array as one event', async () => {
    await copyWorkflowDisk();
    const [run] = await new WorkflowReader().list(sessionDir);
    const event = workflowProgressEvent(S1, run.snapshot!, 1);
    expect(SessionEventSchema.parse(event)).toEqual(event);
    expect(event).toMatchObject({ kind: 'workflow.progress', taskId: 'wayue3on6', workflowName: 'maws-probe', seq: null, agentId: null, parentToolUseId: null });
    expect(event.progress).toEqual(JSON.parse(disk(`${RUN}.json`)).workflowProgress);
    expect(event.at).toBe('2026-09-28T09:59:32.358Z'); // the snapshot's own timestamp
    // The id names the progress it carries: the same progress has the same id in any follow, a different one never
    // does (a consumer deduplicating by id across an unfollow and a re-follow must not keep a stale progress), and a
    // progress delivered again within one follow (A, B, A) is a new occurrence.
    expect(event.id).toBe(workflowProgressId(run.snapshot!));
    expect(event.id).toMatch(new RegExp(`^workflow:${RUN}:[0-9a-f]{12}$`));
    expect(workflowProgressId({ ...run.snapshot!, workflowProgress: [] })).not.toBe(event.id);
    expect(workflowProgressId({ ...run.snapshot!, durationMs: 1 })).toBe(event.id); // bookkeeping is not progress
    expect(workflowProgressEvent(S1, run.snapshot!, 3).id).toBe(`${event.id}@3`);
  });
});
