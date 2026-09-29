import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_DIR, TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import { StoreFixture } from '../../../test/support/store-fixture';
import { SubagentReader, subagentLookup } from './subagents';

const S1 = '9a1d4262-0b43-46ad-acb9-5982f31d209c';
const SIDECARS = join(FIXTURE_DIR, 'subagent-sidecars');
const WORKFLOW_DISK = join(FIXTURE_DIR, 'pass2/workflow-disk');
const read = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8');

describe('subagent sidecars are listed with their metas', () => {
  let fixture: StoreFixture;
  let sessionDir: string;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    const transcript = await fixture.addTranscript('/private/tmp/maws-probe-WmHZ2j', S1, [read(TRANSCRIPT_FIXTURE_DIR, 'subagent-parent.jsonl').trimEnd()]);
    sessionDir = join(dirname(transcript), S1);
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('lists tool-call agents and workflow agents, parses both meta shapes, and reads each prompt from the head', async () => {
    for (const id of ['ad286defbc77bc090', 'ae75ba6ce5d866acc']) {
      await fixture.addSidecar(S1, `subagents/agent-${id}.jsonl`, read(SIDECARS, `agent-${id}.jsonl`));
      await fixture.addSidecar(S1, `subagents/agent-${id}.meta.json`, read(SIDECARS, `agent-${id}.meta.json`));
    }
    await fixture.addSidecar(S1, 'subagents/workflows/wf_7cacbb2d-902/agent-a014f6be436bed86b.jsonl', '');
    await fixture.addSidecar(S1, 'subagents/workflows/wf_7cacbb2d-902/agent-a014f6be436bed86b.meta.json', read(WORKFLOW_DISK, 'agent-a014f6be436bed86b.meta.json'));
    await fixture.addSidecar(S1, 'subagents/workflows/wf_7cacbb2d-902/journal.jsonl', read(WORKFLOW_DISK, 'journal.jsonl'));

    const reader = new SubagentReader();
    const agents = await reader.list(sessionDir);
    expect(agents.map((a) => [a.agentId, a.runId])).toEqual([
      ['ad286defbc77bc090', null],
      ['ae75ba6ce5d866acc', null],
      ['a014f6be436bed86b', 'wf_7cacbb2d-902'],
    ]);
    expect(agents[0]).toMatchObject({
      meta: { agentType: 'general-purpose', toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB' },
      transcriptPath: join(sessionDir, 'subagents/agent-ad286defbc77bc090.jsonl'),
      size: 89807,
    });
    expect(agents[2].meta).toMatchObject({ agentType: 'workflow-subagent', description: 'alpha' });

    const lookup = subagentLookup(() => agents, reader);
    expect(lookup.byToolUseId('toolu_01A8AmiXuRTeJwjQEsaPE2DM')).toMatchObject({ agentId: 'ae75ba6ce5d866acc', meta: { description: 'Read and report two.txt content' } });
    expect(lookup.byToolUseId('toolu_01CYiK6ncgQLFUQ2iqC1b4oB')?.prompt).toMatch(/^Read the file \/private\/tmp\/maws-probe-WmHZ2j\/one\.txt/);
    expect(lookup.byToolUseId('toolu_unknown')).toBeNull();
  });

  it('lists an agent whose meta is not written yet with meta null, and keeps the last whole meta across a torn rewrite', async () => {
    await fixture.addSidecar(S1, 'subagents/agent-ad286defbc77bc090.jsonl', read(SIDECARS, 'agent-ad286defbc77bc090.jsonl'));
    const reader = new SubagentReader();
    expect((await reader.list(sessionDir))[0].meta).toBeNull();

    const meta = await fixture.addSidecar(S1, 'subagents/agent-ad286defbc77bc090.meta.json', read(SIDECARS, 'agent-ad286defbc77bc090.meta.json'));
    expect((await reader.list(sessionDir))[0].meta).toMatchObject({ toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB' });

    await writeFile(meta, '{"agentType":"general-pur'); // a torn write that never completes within the retry schedule
    expect((await reader.list(sessionDir))[0].meta).toMatchObject({ toolUseId: 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB' });
  });

  it('lists nothing for a session without a sidecar directory', async () => {
    expect(await new SubagentReader().list(sessionDir)).toEqual([]);
  });
});
