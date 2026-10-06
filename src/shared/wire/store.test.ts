import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../../test/support/fixtures';
import {
  JobStateSchema,
  LiveSessionRecordSchema,
  PersistedTaskSchema,
  SubagentMetaSchema,
  TranscriptSummarySchema,
  WorkflowJournalRowSchema,
  WorkflowSnapshotSchema,
} from './store';

const WORKFLOW_DISK = join(FIXTURE_DIR, 'pass2/workflow-disk');

describe('store record schemas accept the owner\'s shapes', () => {
  it('parses a live-session registry record and keeps unknown fields', () => {
    const record = LiveSessionRecordSchema.parse({
      pid: 78212,
      sessionId: 'bdb23713-2f6c-40f3-8b18-b41a667a64e3',
      cwd: '/Users/new/Developer/GitHub/MAWS',
      kind: 'interactive',
      startedAt: 1790589615861,
      procStart: 'Mon Sep 28 08:31:32 2026',
      status: 'idle',
      waitingFor: '',
      name: 'maws',
      entrypoint: 'cli',
      futureField: { nested: true },
    });
    expect(record.kind).toBe('interactive');
    expect(record.futureField).toEqual({ nested: true });
    const bg = LiveSessionRecordSchema.parse({ pid: 1, sessionId: 's', kind: 'bg', jobId: 'bdb23713' });
    expect(bg.jobId).toBe('bdb23713');
    // kind and status are open: a value the engine adds later must not drop the record (and with it a holder)
    expect(LiveSessionRecordSchema.parse({ pid: 1, sessionId: 's', kind: 'future', status: 'some-new-status' })).toMatchObject({ kind: 'future', status: 'some-new-status' });
    expect(LiveSessionRecordSchema.safeParse({ sessionId: 's' }).success).toBe(false); // pid comes from the file name and is required
    expect(LiveSessionRecordSchema.safeParse({ pid: 1, spare: false }).success).toBe(false); // `spare` is either absent or true
  });

  it('parses a job state with only the fields C4 reads named', () => {
    const job = JobStateSchema.parse({
      state: 'working',
      sessionId: 'bdb23713-2f6c-40f3-8b18-b41a667a64e3',
      linkScanPath: '/Users/new/.claude/projects/-x/bdb23713.jsonl',
      template: 'bg',
      cwd: '/x',
      name: 'job',
      somethingElse: 1,
    });
    expect(job.state).toBe('working');
    expect(job.somethingElse).toBe(1);
    expect(JobStateSchema.safeParse({ state: 'done' }).success).toBe(false);
  });

  it('parses a persisted task and rejects an unknown status', () => {
    const task = PersistedTaskSchema.parse({
      id: '1', subject: 'Do a thing', description: 'longer', activeForm: 'Doing a thing', owner: 'me',
      status: 'in_progress', blocks: ['2'], blockedBy: [], metadata: { _internal: false },
    });
    expect(task.status).toBe('in_progress');
    expect(PersistedTaskSchema.safeParse({ ...task, status: 'nope' }).success).toBe(false);
  });

  it('parses the pass-2 workflow snapshot and every journal row from disk', () => {
    const snapshotFile = readdirSync(WORKFLOW_DISK).find((name) => /^wf_.*\.json$/.test(name));
    expect(snapshotFile).toBeDefined();
    const snapshot = WorkflowSnapshotSchema.parse(JSON.parse(readFileSync(join(WORKFLOW_DISK, snapshotFile as string), 'utf8')));
    expect(snapshot.runId).toBe('wf_7cacbb2d-902');
    expect(snapshot.agentCount).toBe(2);
    expect(Array.isArray(snapshot.workflowProgress)).toBe(true);
    const rows = readFileSync(join(WORKFLOW_DISK, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((line) => WorkflowJournalRowSchema.parse(JSON.parse(line)));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.type)).toEqual(['launched', 'started', 'started', 'result', 'result']);
    expect(rows[1].agentId).toBe('a014f6be436bed86b');
  });

  it('parses both sidecar meta shapes: an Agent tool call\'s and a workflow agent\'s, which names no tool use', () => {
    const tool = SubagentMetaSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, 'subagent-sidecars/agent-ad286defbc77bc090.meta.json'), 'utf8')));
    expect(tool).toMatchObject({ agentType: 'general-purpose', toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB', requestShape: 'background' });
    const workflow = SubagentMetaSchema.parse(JSON.parse(readFileSync(join(WORKFLOW_DISK, 'agent-a014f6be436bed86b.meta.json'), 'utf8')));
    expect(workflow).toMatchObject({ agentType: 'workflow-subagent', description: 'alpha', workflowPhase: 'Echo' });
    expect(workflow.toolUseId).toBeUndefined();
    // SPEC 35.11.1: agentType is the one field the engine requires; a record without it is not a meta
    expect(SubagentMetaSchema.safeParse({ description: 'x' }).success).toBe(false);
  });

  it('types the lineage, name and stopped keys real sidecar metas carry (C8b\'s ask)', () => {
    // The three shapes quoted in the C4 document's Surprises entry, read from the owner's sidecars (elisions filled in).
    const nested = SubagentMetaSchema.parse({ agentType: 'general-purpose', description: 'Audit removed behavior', toolUseId: 'call_0123', parentAgentId: 'af96b76372097d464', spawnDepth: 2 });
    const stopped = SubagentMetaSchema.parse({ agentType: 'doperpowers:plan-executor', description: 'Execute M2', toolUseId: 'toolu_01', spawnDepth: 1, requestShape: 'background', requestNonInteractive: true, stoppedByUser: true });
    const named = SubagentMetaSchema.parse({ agentType: 'general-purpose', description: '/code-review high', name: 'code-review', spawnDepth: 1, stoppedByUser: true });
    const parentAgentId: string | undefined = nested.parentAgentId;
    const stoppedByUser: boolean | undefined = stopped.stoppedByUser;
    const name: string | undefined = named.name;
    expect({ parentAgentId, stoppedByUser, name }).toEqual({ parentAgentId: 'af96b76372097d464', stoppedByUser: true, name: 'code-review' });
    expect(named.toolUseId).toBeUndefined();
    expect(SubagentMetaSchema.safeParse({ agentType: 'x', stoppedByUser: 'yes' }).success).toBe(false);
    expect(SubagentMetaSchema.safeParse({ agentType: 'x', parentAgentId: 7 }).success).toBe(false);
    expect(SubagentMetaSchema.safeParse({ agentType: 'x', name: null }).success).toBe(false);
  });

  it('keeps the transcript summary strict: an unknown key is rejected', () => {
    const summary = {
      sessionId: '9a1d4262-0b43-46ad-acb9-5982f31d209c', transcriptPath: '/p/x.jsonl', slug: '-p',
      directory: '/p', relocatedCwd: null, size: 10, mtimeMs: 1,
      firstRecordAt: null, lastRecordAt: null, customTitle: null, aiTitle: null, firstPrompt: null, lastAssistantText: null,
      gitBranch: null, engineVersion: null, entrypoint: null, sessionKind: null, hasMessages: false, leafUuid: null,
      rootUuid: null, birthtimeMs: 0, // E3
    };
    expect(TranscriptSummarySchema.parse(summary)).toEqual(summary);
    expect(TranscriptSummarySchema.safeParse({ ...summary, extra: 1 }).success).toBe(false);
    expect(TranscriptSummarySchema.safeParse({ ...summary, sessionKind: 'interactive' }).success).toBe(false);
  });
});
