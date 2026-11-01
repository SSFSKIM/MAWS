import { readFileSync } from 'node:fs';
import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
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

// `update` answers what `list` would, from the changed files alone: each case changes the tree, updates the listing
// from before with the paths the watcher would report, and compares it with a walk of the tree after.
describe('a subagent listing is updated from the changed agent files alone', () => {
  let fixture: StoreFixture;
  let sessionDir: string;
  let reader: SubagentReader;
  const metaOf = (description: string, toolUseId = `toolu_${description}`) => ({ agentType: 'general-purpose', description, toolUseId, spawnDepth: 1 });
  const prompt = (text: string) => `${JSON.stringify({ type: 'user', uuid: `u-${text}`, parentUuid: null, timestamp: '2026-10-31T10:00:00.000Z', message: { role: 'user', content: text } })}\n`;
  const addAgent = async (rel: string, id: string, description = id) => {
    await fixture.addSidecar(S1, `${rel}/agent-${id}.jsonl`, prompt(`do ${id}`));
    await fixture.addSidecar(S1, `${rel}/agent-${id}.meta.json`, metaOf(description));
  };
  // The listing `update` gives after `change`, beside the walk's of the tree it left.
  const afterChange = async (change: () => Promise<unknown>, changed: string[]) => {
    const before = await reader.list(sessionDir);
    await change();
    return { before, updated: await reader.update(sessionDir, before, changed), walked: await new SubagentReader().list(sessionDir) };
  };

  beforeEach(async () => {
    fixture = await StoreFixture.create();
    const transcript = await fixture.addTranscript('/work/a', S1, [prompt('parent').trimEnd()]);
    sessionDir = join(dirname(transcript), S1);
    reader = new SubagentReader();
    await addAgent('subagents', 'b1');
    await addAgent('subagents', 'b3');
    await addAgent('subagents/workflows/wf_one', 'w1');
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('a new agent takes its place in the walk\'s order, from its transcript and then its meta', async () => {
    const transcriptOnly = await afterChange(() => fixture.addSidecar(S1, 'subagents/agent-b2.jsonl', prompt('do b2')), ['subagents/agent-b2.jsonl']);
    expect(transcriptOnly.updated).toEqual(transcriptOnly.walked);
    expect(transcriptOnly.updated!.map((a) => [a.agentId, a.meta])).toEqual([['b1', metaOf('b1')], ['b2', null], ['b3', metaOf('b3')], ['w1', metaOf('w1')]]);

    const withMeta = await afterChange(() => fixture.addSidecar(S1, 'subagents/agent-b2.meta.json', metaOf('b2')), ['subagents/agent-b2.meta.json']);
    expect(withMeta.updated).toEqual(withMeta.walked);
    expect(withMeta.updated![1].meta).toEqual(metaOf('b2'));

    const inRun = await afterChange(() => addAgent('subagents/workflows/wf_one', 'w0'), ['subagents/workflows/wf_one/agent-w0.jsonl', 'subagents/workflows/wf_one/agent-w0.meta.json']);
    expect(inRun.updated).toEqual(inRun.walked);
    expect(inRun.updated!.map((a) => [a.agentId, a.runId])).toEqual([['b1', null], ['b2', null], ['b3', null], ['w0', 'wf_one'], ['w1', 'wf_one']]);
  });

  it('a changed meta is read again, and every agent it did not name is the same entry as before', async () => {
    const { before, updated, walked } = await afterChange(() => fixture.addSidecar(S1, 'subagents/agent-b3.meta.json', { ...metaOf('b3'), stoppedByUser: true }), ['subagents/agent-b3.meta.json']);
    expect(updated).toEqual(walked);
    expect(updated![1].meta).toMatchObject({ stoppedByUser: true });
    expect(updated![0]).toBe(before[0]);
    expect(updated![2]).toBe(before[2]);
  });

  it('an appended transcript takes its new size and time', async () => {
    const { before, updated, walked } = await afterChange(() => appendFile(join(sessionDir, 'subagents/agent-b1.jsonl'), prompt('more')), ['subagents/agent-b1.jsonl']);
    expect(updated).toEqual(walked);
    expect(updated![0].size).toBeGreaterThan(before[0].size);
  });

  it('a deleted agent leaves the listing, its transcript and meta reported in either order or alone', async () => {
    for (const changed of [['subagents/agent-b1.meta.json', 'subagents/agent-b1.jsonl'], ['subagents/agent-b3.jsonl']]) {
      const id = changed.at(-1)!.slice('subagents/agent-'.length, -'.jsonl'.length);
      const { updated, walked } = await afterChange(async () => {
        await rm(join(sessionDir, `subagents/agent-${id}.jsonl`));
        await rm(join(sessionDir, `subagents/agent-${id}.meta.json`));
      }, changed);
      expect(updated).toEqual(walked);
      expect(updated!.map((a) => a.agentId)).not.toContain(id);
    }
  });

  it('a meta whose transcript is gone, or not written yet, lists nothing; its meta is read when the transcript arrives', async () => {
    await rm(join(sessionDir, 'subagents/agent-b1.jsonl'));
    const metaAlone = await afterChange(() => fixture.addSidecar(S1, 'subagents/agent-b9.meta.json', metaOf('b9')), ['subagents/agent-b1.meta.json', 'subagents/agent-b9.meta.json']);
    expect(metaAlone.updated).toEqual(metaAlone.walked);
    expect(metaAlone.updated!.map((a) => a.agentId)).toEqual(['b3', 'w1']);
    const transcript = await afterChange(() => fixture.addSidecar(S1, 'subagents/agent-b9.jsonl', prompt('do b9')), ['subagents/agent-b9.jsonl']);
    expect(transcript.updated).toEqual(transcript.walked);
    expect(transcript.updated![1]).toMatchObject({ agentId: 'b9', meta: metaOf('b9') });
  });

  it('a relocated agent moves to its new place, with the run its new directory names', async () => {
    const moved = ['agent-b1.jsonl', 'agent-b1.meta.json'];
    const { updated, walked } = await afterChange(async () => {
      await mkdir(join(sessionDir, 'subagents/workflows/wf_two'), { recursive: true });
      for (const name of moved) await rename(join(sessionDir, 'subagents', name), join(sessionDir, 'subagents/workflows/wf_two', name));
    }, moved.flatMap((name) => [`subagents/${name}`, `subagents/workflows/wf_two/${name}`]));
    expect(updated).toEqual(walked);
    expect(updated!.map((a) => [a.agentId, a.runId])).toEqual([['b3', null], ['w1', 'wf_one'], ['b1', 'wf_two']]);
  });

  it('an agent deeper than the walk looks is not listed, as the walk does not list it', async () => {
    const deep = 'subagents/a/b/c/d';
    const { before, updated, walked } = await afterChange(() => addAgent(deep, 'deep'), [`${deep}/agent-deep.jsonl`, `${deep}/agent-deep.meta.json`]);
    expect(updated).toEqual(walked);
    expect(updated).toEqual(before);
  });

  it('answers null where only a walk can settle the change: a path naming no agent file, or a directory under an agent transcript\'s name', async () => {
    const before = await reader.list(sessionDir);
    expect(await reader.update(sessionDir, before, ['subagents/workflows/wf_one'])).toBeNull();
    expect(await reader.update(sessionDir, before, ['custom-title.json'])).toBeNull();
    await mkdir(join(sessionDir, 'subagents/agent-odd.jsonl'));
    expect(await reader.update(sessionDir, before, ['subagents/agent-odd.jsonl'])).toBeNull();
  });
});
