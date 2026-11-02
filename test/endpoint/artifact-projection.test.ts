// A member learns nothing of a session they can't view, in any artifact answer (P5 O7 M5a2 fix wave 1; the architect's
// ruling on the task review's first finding). An artifact the member views may name sessions they don't: its creator, its
// last editor (linked to it or not), the sessions that touched it, a version's author. Every metadata-bearing answer of
// the artifact rows goes through one projection as it is sent: a hidden session in an actor field becomes the one
// withheld session (WITHHELD_SESSION, the same for every hidden session, so none can be counted or told apart, and never
// the human), and leaves every list of sessions with nothing in its place, its title with it. A machine owner's answer goes
// whole. What the member may view widens and narrows as their rights move. The scene: S1 (`visible`), B's own; S2
// (`private`), the machine's, the creator and last editor; B holds `view` on an artifact linked to both.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { WITHHELD_SESSION } from 'org-protocol';
import { commands } from '@shared/ipc/schema';
import { OFFERS } from '../../src/endpoint/offers';
import { SESSION_NAMING } from '../../src/endpoint/session-safe';
import { act, done, makeOrg, openRemote, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const outputOf = async (r: Remote, name: string, input: unknown) => {
  const answer = await call(r, name, input);
  expect(answer).toMatchObject({ ok: true });
  return answer.output as Record<string, unknown>;
};
const session = (appSessionId: string) => ({ kind: 'session', appSessionId });
const WITHHELD = session(WITHHELD_SESSION);

/** Every place `value` holds the string `needle`, as a path of keys. */
function pathsOf(value: unknown, needle: string, path: string[] = []): string[][] {
  if (value === needle) return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => pathsOf(v, needle, [...path, String(i)]));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => pathsOf(v, needle, [...path, k]));
  return [];
}

/** S1 B's own, S2 the machine's (and the creator and last editor of an artifact linked to both); a third, unlinked. */
async function scene(f?: Fixture) {
  f ??= await startEndpoint(org, started);
  for (const [app, owners] of [['visible', [org.B]], ['private', ['@machine']], ['third', ['@machine']]] as const) {
    const s = f.host.add(app);
    f.spine.set(app, s.engineSessionId, { appId: app });
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [...owners], access: 'private' }, app);
  }
  const id = randomUUID();
  const row = f.host.artifact(id, ['private', 'visible'], { createdBy: session('private') });
  const libraryRow = (lastEditor = 'private') => ({
    ...row,
    lastEditor: session(lastEditor),
    lastEditedAt: 5,
    lastEditorTitle: lastEditor === 'visible' ? 'Visible work' : 'Secret acquisition',
    sessions: [
      { appSessionId: 'private', title: 'Secret acquisition', roles: ['created'], lastAt: 5 },
      { appSessionId: 'visible', title: 'Visible work', roles: ['edited'], lastAt: 3 },
    ],
  });
  f.spine.handle('library.get', () => ({ row: libraryRow() }));
  f.spine.handle('library.list', () => ({ rows: [libraryRow()], counts: { document: 1 } }));
  f.host.reads.set('artifacts.versions', () => ({
    versions: [
      { id: 3, seq: 3, at: 5, actor: session('private'), kind: 'turn', assetRefs: [] },
      { id: 2, seq: 2, at: 4, actor: session('third'), kind: 'turn', assetRefs: [] },
      { id: 1, seq: 1, at: 3, actor: session('visible'), kind: 'turn', assetRefs: [] },
      { id: 4, seq: 4, at: 6, actor: { kind: 'human' }, kind: 'named', label: 'Mine', assetRefs: [] },
    ],
  }));
  const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];
  return { f, id, row, libraryRow, a, b };
}

describe('an artifact answer to a member who can’t view all its sessions', () => {
  it('goes through the projection for every artifact row whose answer’s schema names a session (its bytes aside)', () => {
    const rows = Object.entries(OFFERS.commands).filter(([name, row]) => row.target === 'artifact' || name === 'library.list');
    const naming = rows.map(([name]) => name).filter((name) => JSON.stringify(z.toJSONSchema(commands[name as keyof typeof commands].output as z.ZodType, { unrepresentable: 'any' })).includes('appSessionId'));
    expect(naming.sort()).toEqual([...SESSION_NAMING].sort());
  });

  it('withholds a hidden creator in `artifacts.get` and `artifacts.list`', async () => {
    const { id, b, a } = await scene();
    expect(await outputOf(b, 'artifacts.get', { artifactId: id })).toMatchObject({ artifact: { id, createdBy: WITHHELD } });
    expect(await outputOf(a, 'artifacts.get', { artifactId: id })).toMatchObject({ artifact: { createdBy: session('private') } }); // an owner: whole
  });

  it('cuts a library row to the sessions the member views, the hidden last editor withheld with no title', async () => {
    const { id, b, a, libraryRow } = await scene();
    const row = (await outputOf(b, 'library.get', { artifactId: id })).row as Record<string, unknown>;
    expect(row).toMatchObject({ createdBy: WITHHELD, lastEditor: WITHHELD, sessions: [{ appSessionId: 'visible', title: 'Visible work', roles: ['edited'], lastAt: 3 }] });
    expect(row.sessions).toHaveLength(1);
    expect(row).not.toHaveProperty('lastEditorTitle');
    expect(JSON.stringify(row)).not.toContain('Secret acquisition');
    expect(JSON.stringify(row)).not.toContain('private');
    expect((await outputOf(a, 'library.get', { artifactId: id })).row).toEqual(libraryRow());
  });

  it('does the same to every row of `library.list`', async () => {
    const { b } = await scene();
    const listed = await outputOf(b, 'library.list', {});
    expect(listed).toMatchObject({ rows: [{ createdBy: WITHHELD, lastEditor: WITHHELD, sessions: [{ appSessionId: 'visible' }] }], counts: { document: 1 } });
    expect(JSON.stringify(listed)).not.toMatch(/private|Secret acquisition/);
  });

  it('withholds each hidden version author as the same session, and keeps the viewed one’s and the human’s', async () => {
    const { id, b } = await scene();
    const { versions } = (await outputOf(b, 'artifacts.versions', { artifactId: id })) as { versions: Array<{ actor: unknown }> };
    // Two hidden sessions (`private` and `third`, never linked) are one withheld actor: none can be told from another.
    expect(versions.map((v) => v.actor)).toEqual([WITHHELD, WITHHELD, session('visible'), { kind: 'human' }]);
  });

  it('withholds a hidden creator in an act’s result and in a query of it', async () => {
    const { f, id, b } = await scene();
    const action = b.device.action({ machine: f.ref, action: 'artifacts.update', args: { artifactId: id, title: 'renamed' } });
    const from = b.inbox.length;
    expect(await act(b, action)).toBe('ok');
    expect(await done(b, action, from)).toMatchObject({ state: 'done', result: { artifact: { title: 'renamed', createdBy: WITHHELD } } });
    await b.channel.send({ t: 'query', opId: action.opId, opCreated: action.opCreated, executor: 'engine-host' });
    const queried = await waitFor(b, (m) => m.t === 'queried' && m.opId === action.opId, 'the query');
    expect(queried.outcome).toMatchObject({ state: 'done', result: { artifact: { createdBy: WITHHELD } } });
  });

  it('puts the withheld session in actor fields alone, and in no list of sessions', async () => {
    const { id, b } = await scene();
    const answers = [
      await outputOf(b, 'artifacts.get', { artifactId: id }),
      await outputOf(b, 'library.get', { artifactId: id }),
      await outputOf(b, 'library.list', {}),
      await outputOf(b, 'artifacts.versions', { artifactId: id }),
    ];
    const ACTOR_FIELDS = ['createdBy', 'lastEditor', 'actor'];
    for (const answer of answers) {
      for (const path of pathsOf(answer, WITHHELD_SESSION)) expect([path.at(-1), ACTOR_FIELDS.includes(path.at(-2)!)]).toEqual(['appSessionId', true]);
    }
  });

  it('widens as the member comes to view a hidden session, and narrows again as that goes', async () => {
    const { f, id, b } = await scene();
    expect(await outputOf(b, 'artifacts.get', { artifactId: id })).toMatchObject({ artifact: { createdBy: WITHHELD } });
    f.records.set({ lane: 'B', session: 'eng-private', owners: ['@machine'], access: 'private', shares: [{ member: org.B, grade: 'view' }] }, 'private');
    expect(await outputOf(b, 'artifacts.get', { artifactId: id })).toMatchObject({ artifact: { createdBy: session('private') } });
    expect(((await outputOf(b, 'library.get', { artifactId: id })).row as { sessions: unknown[] }).sessions).toHaveLength(2);
    f.records.set({ lane: 'B', session: 'eng-private', owners: ['@machine'], access: 'private' }, 'private');
    expect(await outputOf(b, 'artifacts.get', { artifactId: id })).toMatchObject({ artifact: { createdBy: WITHHELD } });
  });

  it('withholds a last editor that is linked to nothing the member views', async () => {
    const { f, id, b, libraryRow } = await scene();
    f.spine.handle('library.get', () => ({ row: { ...libraryRow('third'), sessions: [{ appSessionId: 'visible', title: 'Visible work', roles: ['edited'], lastAt: 3 }] } }));
    expect((await outputOf(b, 'library.get', { artifactId: id })).row).toMatchObject({ lastEditor: WITHHELD, sessions: [{ appSessionId: 'visible' }] });
  });

  it('answers the artifacts feed’s events with nothing of any session in them', async () => {
    const { f, id, b } = await scene();
    await b.channel.send({ t: 'sub', sub: 'art', feed: 'artifacts', cursor: null, credit: 1024 * 1024 });
    await waitFor(b, (m) => m.t === 'subbed' && m.sub === 'art', 'the feed');
    f.host.emitHost('artifacts.changed', { artifactId: id, kind: 'document', revision: 2, change: 'updated' });
    const ev = await waitFor(b, (m) => m.t === 'ev' && m.sub === 'art', 'the change');
    expect(ev.body).toEqual({ name: 'artifacts.changed', payload: { artifactId: id, kind: 'document', revision: 2, change: 'updated' } });
  });
});

describe('a session id, never a capability', () => {
  it('answers a session read and a session’s stream the same for a hidden id, the withheld one and one nobody minted', async () => {
    const { b } = await scene();
    for (const appSessionId of ['private', WITHHELD_SESSION, randomUUID()]) {
      expect([appSessionId, (await call(b, 'session.get', { appSessionId })).error]).toEqual([appSessionId, { code: 'grade' }]);
      expect([appSessionId, (await call(b, 'session.status', { appSessionId })).error]).toEqual([appSessionId, { code: 'grade' }]);
      const sub = `s-${appSessionId}`;
      await b.channel.send({ t: 'sub', sub, session: { lane: 'B', id: appSessionId }, cursor: null, credit: 1024 });
      const answered = await waitFor(b, (m) => (m.t === 'ended' || m.t === 'subbed') && m.sub === sub, `the stream of ${appSessionId}`);
      expect([appSessionId, answered.t, answered.reason]).toEqual([appSessionId, 'ended', 'grade']);
      expect([appSessionId, (await call(b, 'artifacts.list', { filter: { appSessionId } })).error]).toEqual([appSessionId, { code: 'grade' }]);
    }
  });

  it('lists nothing by a session the member doesn’t view, as by one nobody minted, though it touched an artifact they view', async () => {
    const { f, b, libraryRow } = await scene();
    // The index answers the rows linked to the session the filter names: `private` touched the artifact B views.
    f.spine.handle('library.list', (input) => (['private', 'visible', undefined].includes((input as { filter?: { appSessionId?: string } }).filter?.appSessionId) ? { rows: [libraryRow()], counts: { document: 1 } } : { rows: [], counts: { document: 0 } }));
    for (const appSessionId of ['private', WITHHELD_SESSION, randomUUID()]) {
      expect([appSessionId, await outputOf(b, 'library.list', { filter: { appSessionId } })]).toEqual([appSessionId, { rows: [], counts: { document: 0 } }]);
    }
    expect(((await outputOf(b, 'library.list', { filter: { appSessionId: 'visible', lineage: true } })).rows as unknown[]).length).toBe(1); // B's own
    expect(((await outputOf(b, 'library.list', {})).rows as unknown[]).length).toBe(1);
  });
});
