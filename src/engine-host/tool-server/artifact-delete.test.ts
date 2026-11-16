// UX wave U10b (M4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.1): `artifact_delete` over the real
// store. It deletes a draft the calling session, or the session a side thread was opened from, made and only agents
// wrote to; anything else is refused with the reason, each refusal's sentence word for word and followed by its JSON
// (`reason: 'invalid'` and the `why` the transcript's row reads); a replayed call answers the first answer and deletes
// nothing twice.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { TOOL_ERRORS, type ArtifactDeleteResult } from '@shared/maws/tools';
import { artifactDeleteTool } from './artifact-delete';
import { HUMAN, jsonOf, openWorld, SELF, textOf, type World } from './artifact-world.fixture';

const PARENT = 'app-parent' as AppSessionId;
const OTHER = 'app-other' as AppSessionId;
const session = (appSessionId: AppSessionId): Actor => ({ kind: 'session', appSessionId });

let world: World;
beforeEach(() => {
  world = openWorld();
});
afterEach(() => world.close());

async function made(by: Actor, title = 'Draft plan', kind: 'document' | 'design_system' = 'document'): Promise<string> {
  const { id } = await world.store.create({ kind, title }, by);
  if (kind === 'document') await world.service.writeAs(id, by, (doc) => doc.get('root').insert(0, 'Written by an agent.'));
  return id;
}
const call = (args: unknown, over: Parameters<World['ctx']>[0] = {}, deps: Parameters<World['deps']>[0] = {}) => artifactDeleteTool(world.deps(deps)).call(args, world.ctx(over));
const refusal = (why: string) => ` {"reason":"invalid","why":"${why}"}`;

describe('artifact_delete', () => {
  it('deletes a draft this session made and answers its id, kind and title', async () => {
    const id = await made(session(SELF));
    const answer = jsonOf<ArtifactDeleteResult>(await call({ artifact: id }));
    expect(answer).toEqual({ status: 'deleted', artifactId: id, kind: 'document', title: 'Draft plan' });
    expect(world.store.get(id)).toBeNull();
    expect(world.store.deletion(id)).toEqual({ title: 'Draft plan', kind: 'document', undoable: true });
  });

  it('deletes, from a side thread, a draft the session it was opened from made', async () => {
    const id = await made(session(PARENT));
    expect(jsonOf<ArtifactDeleteResult>(await call({ artifact: id }, {}, { artifactScope: [PARENT] }))).toMatchObject({ status: 'deleted', artifactId: id });
  });

  it('refuses an artifact another session made, one the user made, one the user edited and one MAWS cannot vouch for, each word for word', async () => {
    const theirs = await made(session(OTHER), 'Their draft');
    const refused = await call({ artifact: theirs });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe(TOOL_ERRORS.deleteOtherSession('Their draft') + refusal('otherSession'));
    expect(TOOL_ERRORS.deleteOtherSession('Their draft')).toBe('artifact_delete: "Their draft" was created by another session; ask the user to delete it in the Library');

    const mine = await made(HUMAN, 'User notes');
    expect(textOf(await call({ artifact: mine }))).toBe(TOOL_ERRORS.deleteByUser('User notes') + refusal('byUser'));
    expect(TOOL_ERRORS.deleteByUser('User notes')).toBe('artifact_delete: "User notes" was created by the user; ask them to delete it in the Library');

    const edited = await made(session(SELF), 'Shared draft');
    await world.service.writeAs(edited, HUMAN, (doc) => doc.get('root').insert(0, 'The user typed. '));
    expect(textOf(await call({ artifact: edited }))).toBe(TOOL_ERRORS.deleteEdited('Shared draft') + refusal('edited'));
    expect(TOOL_ERRORS.deleteEdited('Shared draft')).toBe('artifact_delete: the user has edited "Shared draft"; ask them to delete it in the Library');

    const older = await made(session(SELF), 'Older draft');
    world.storage.db.prepare('DELETE FROM meta WHERE key = ?').run(`agentDraft:${older}`); // as a draft an older build made
    expect(textOf(await call({ artifact: older }))).toBe(TOOL_ERRORS.deleteUnknown('Older draft') + refusal('unknown'));
    expect(TOOL_ERRORS.deleteUnknown('Older draft')).toBe('artifact_delete: MAWS cannot tell that only agents have written to "Older draft"; ask the user to delete it in the Library');

    for (const id of [theirs, mine, edited, older]) expect(world.store.get(id), id).not.toBeNull();
  });

  it('refuses a design system still in use, as the person’s delete is refused, the row’s key beside it', async () => {
    const system = await made(session(SELF), 'House draft', 'design_system');
    const styled = await world.store.create({ kind: 'document', title: 'Styled', designSystemId: system }, session(SELF));
    const text = textOf(await call({ artifact: system }));
    expect(text).toBe(`artifact_delete: the design system governs 1 artifact(s) ${JSON.stringify({ reason: 'invalid', artifactIds: [styled.id], why: 'designSystemInUse' })}`);
    expect(world.store.get(system)).not.toBeNull();
  });

  it('answers a replayed call with the first answer and deletes nothing twice', async () => {
    const id = await made(session(SELF));
    const toolUseId = 'toolu_delete_once' as ToolUseId;
    const deletes: string[] = [];
    world.store.onChange((change) => void (change.change === 'deleted' && deletes.push(change.artifactId)));
    const first = jsonOf(await call({ artifact: id }, { toolUseId }));
    const again = jsonOf(await call({ artifact: id }, { toolUseId }));
    expect(again).toEqual(first);
    expect(deletes).toEqual([id]);
  });

  it('refuses arguments the schema does not take, and an artifact the session cannot name', async () => {
    expect(textOf(await call({}))).toMatch(/^artifact_delete: invalid arguments: artifact/);
    expect(textOf(await call({ artifact: 'draft', also: 1 }))).toMatch(/^artifact_delete: invalid arguments/);
    expect(textOf(await call({ artifact: 'no-such-draft' }))).toBe(TOOL_ERRORS.noArtifact('artifact_delete', 'no-such-draft'));
  });
});
