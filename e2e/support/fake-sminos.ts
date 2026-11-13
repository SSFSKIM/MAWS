// sminos on a machine's RL10 socket, for e2e:remote's scene (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-
// lane-b.md, Interfaces §Q): the endpoint holds no lane B records or listings of its own, both come only from sminos's
// `member` frames, so the scene plays sminos with the endpoint harness's fake (test/endpoint/rl10/fake-sminos.ts, which
// imports only `node:net` and `desk-hub/protocol`). It connects to the socket `<profile>/mawsd/endpoint/rl10.json`
// names and says hello with that file's token; then, per project, states its `machine` presence (its checkouts) and
// opens it on the log plane (its `hello`), so the endpoint relays it and lists its sessions at the hub; and each `member`
// frame is one session's record as sminos's lane B observer would restate it.
//
// 2026-11-06 (the remote lane A drill-in): a terminal session of the machine's (`laneA`): its `member` frame, a lane A
// record as sminos restates one, and its session plane as sminos's daemon serves it on RL10 (sminos_plane.py): each
// upstream `subscribe` of its main transcript (`agentId` null) or of one subagent's answered with that transcript's
// snapshot at n 0 (its newest rows, newest first, `more` when older ones remain; the session's subagent tree on the main
// one), `rows` with the page before a row, `read status` with the bridge's status, and what the scene appends or ends
// numbered on each upstream of that transcript.
//
// The harness's module imports `desk-hub/protocol` by its TypeScript source, which Playwright's CommonJS transform
// cannot load, so it is bundled with esbuild first, to CommonJS, and required (local-org.ts's pattern).
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { goneFrame, helloFrame, memberFrame, projectFrames, restatedFrame, type LaneBMember } from '../../test/support/sminos-frames';

const REPO_ROOT = resolve(__dirname, '../..');
const FAKE_SMINOS = join(REPO_ROOT, 'test/endpoint/rl10/fake-sminos.ts');

type Frame = { t: string } & Record<string, unknown>;
type Harness = { send(frame: object): void; close(): void; closed: boolean; received: Frame[] };
type FakeSminosModule = { FakeSminos: { open(path: string): Promise<Harness> } };

/** A row of a transcript, as sminos's plane carries one. */
export type PlaneRow = Record<string, unknown> & { uuid: string };
/** A lane A session as sminos holds it: its record, its transcripts (oldest first), and how many rows a snapshot carries. */
export interface LaneASession {
  engine: string;
  title: string;
  cwd: string;
  owners: string[];
  launch: string;
  main: PlaneRow[];
  /** Each subagent's own transcript, by its agent id. */
  agents: Record<string, PlaneRow[]>;
  /** The main snapshot's subagent tree (DX4 `SubagentMeta`s). */
  subagents: Array<Record<string, unknown>>;
  /** UX wave U8b M9: the main snapshot's jobs (DX4 `Job`s), the loop's background tasks sminos derives from its rows
   * (sminos_jobs.py's `derive`, whose body the plane spreads into a snapshot); none when absent. */
  jobs?: Array<Record<string, unknown>>;
  /** The newest rows a snapshot carries of a subagent's transcript (all, when absent); the main one's carries all. */
  agentWindow?: number;
}
export interface LaneAPlane {
  /** A row the transcript gains (`agentId` null: the main one), numbered on each upstream of it open now. */
  append(agentId: string | null, row: PlaneRow): void;
  /** sminos ends each upstream of the transcript open now (`end {discontinuity}`), as its bridge's stream does at a gap. */
  end(agentId: string | null): void;
  /** The upstream subscriptions the endpoint asked of the transcript, in order. */
  subscribes(agentId: string | null): Frame[];
  /** The `rows` the endpoint asked of the transcript, in order. */
  pages(agentId: string | null): Frame[];
  /** UX wave U8b M9 (X-168): the session's presence changed, as sminos's plane says one (sminos_plane.py's `presence`):
   * a session-wide `presence` message (no `sub`, no `n`), which B's endpoint carries on each main subscription of the
   * session. `record` null is the session's process gone, the plane's not-running body `{record: null, bridge: false}`;
   * a record is a live process again, `{record, bridge: true, launch}`. Each later snapshot carries the same presence,
   * as the plane draws a snapshot's from the session's state at that moment. */
  presence(record: Record<string, unknown> | null): void;
}

export interface FakeSminos {
  /** A project's `machine` presence (its checkouts here) and its log-plane `hello`, so the endpoint relays it and lists
   * its sessions at the hub; once per project. */
  project(project: string, checkouts: string[]): void;
  /** A session's `member` frame in `project`: the endpoint joins it to its appSessionId through `engine.sessions` and
   * lists it. */
  member(project: string, member: LaneBMember): void;
  /** The session left (`member {gone: true}`): its listing is withdrawn. */
  gone(engine: string): void;
  /** A terminal session of the machine's, listed and served on the session plane (2026-11-06). */
  laneA(project: string, session: LaneASession): LaneAPlane;
  /** What the endpoint wrote, for a failure to quote. */
  said(): string;
  close(): void;
}

/**
 * sminos connected to the endpoint whose `rl10.json` is `info` (`{socket, token}`) as machine `machine`, welcomed, its
 * restatement closed with no session yet. The bundle is written under `scratch`.
 */
export async function startFakeSminos(scratch: string, info: { socket: string; token: string }, machine: string): Promise<FakeSminos> {
  const outfile = join(scratch, 'fake-sminos.cjs');
  await build({ entryPoints: [FAKE_SMINOS], outfile, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'error', alias: { '@shared': join(REPO_ROOT, 'src/shared') } });
  const { FakeSminos } = createRequire(__filename)(outfile) as FakeSminosModule;
  const s = await FakeSminos.open(info.socket);
  s.send(helloFrame(info.token, 'e2e-remote'));
  await expect.poll(() => s.received.some((frame) => frame.t === 'welcome'), { timeout: 15_000, message: 'the endpoint’s welcome' }).toBe(true);
  s.send(restatedFrame());
  const present = new Set<string>();
  // The lane A plane: each session's transcripts, the upstreams open on them, and the frames read so far.
  const sessions = new Map<string, { project: string; spec: LaneASession; presence: Record<string, unknown> }>();
  const upstreams = new Map<string, { session: string; agentId: string | null; n: number }>();
  let read = 0;
  const envelope = (project: string, session: string, kind: string, sub: string | null, n: number | null, body: unknown) => ({ t: 'session', message: { project, machine, session, kind, sub, n, body } });
  const transcriptOf = (spec: LaneASession, agentId: string | null) => (agentId === null ? spec.main : (spec.agents[agentId] ?? []));
  const numbered = (sub: string, kind: string, body: unknown) => {
    const up = upstreams.get(sub);
    const held = up === undefined ? undefined : sessions.get(up.session);
    if (up === undefined || held === undefined) return;
    up.n += 1;
    s.send(envelope(held.project, up.session, kind, sub, up.n, body));
  };
  const pump = () => {
    for (; read < s.received.length; read++) {
      const f = s.received[read];
      const sub = typeof f.sub === 'string' ? f.sub : '';
      if (f.t === 'subscribe') {
        const held = sessions.get(String(f.session));
        if (held === undefined) continue;
        const agentId = typeof f.agentId === 'string' ? f.agentId : null;
        upstreams.set(sub, { session: held.spec.engine, agentId, n: 0 });
        const rows = transcriptOf(held.spec, agentId);
        const shown = agentId === null ? rows : rows.slice(-(held.spec.agentWindow ?? rows.length));
        s.send(envelope(held.project, held.spec.engine, 'snapshot', sub, 0, { rows: [...shown].reverse(), more: shown.length < rows.length, subagents: agentId === null ? held.spec.subagents : [], ...(agentId === null && held.spec.jobs !== undefined && { jobs: held.spec.jobs }), presence: held.presence, streaming: [] }));
      } else if (f.t === 'unsubscribe') {
        upstreams.delete(sub);
      } else if (f.t === 'rows') {
        const up = upstreams.get(sub);
        const held = up === undefined ? undefined : sessions.get(up.session);
        if (up === undefined || held === undefined || f.agentId !== up.agentId) continue; // sminos pages a sub's own transcript
        const rows = transcriptOf(held.spec, up.agentId);
        const at = rows.findIndex((row) => row.uuid === f.before);
        const from = Math.max(0, at - Number(f.limit));
        numbered(sub, 'rows', { rows: at <= 0 ? [] : rows.slice(from, at).reverse(), before: f.before, more: from > 0, offChain: [] });
      } else if (f.t === 'read') {
        const up = upstreams.get(sub);
        const held = up === undefined ? undefined : sessions.get(up.session);
        if (up === undefined || held === undefined) continue;
        const answer = up.agentId !== null ? { error: { code: 'unsupported', message: "a read is the session's: ask it on the main loop's subscription" } } : { result: { version: { version: '2.1.312' }, model: 'claude-opus-5-5', cwd: held.spec.cwd, root: held.spec.cwd, repo: null, surfaces: [], override: null } };
        numbered(sub, 'read', { id: f.id, what: f.what, ...answer });
      }
    }
  };
  const pumping = setInterval(pump, 10);
  return {
    project(project, checkouts) {
      if (present.has(project)) return;
      present.add(project);
      for (const frame of projectFrames(project, machine, checkouts)) s.send(frame);
    },
    member: (project, m) => s.send(memberFrame(project, m)),
    gone: (engine) => s.send(goneFrame(engine)),
    laneA(project, spec) {
      const held = { project, spec, presence: { record: { status: 'busy' }, bridge: true, launch: spec.launch } as Record<string, unknown> };
      sessions.set(spec.engine, held);
      s.send({ t: 'member', session: spec.engine, alias: spec.engine.slice(0, 8), project, lane: 'A', state: 'busy', title: spec.title, cwd: spec.cwd, launch: spec.launch, owners: spec.owners, ownersProof: [], origin: { kind: 'terminal' }, access: 'listed' });
      const open = (agentId: string | null) => [...upstreams].filter(([, up]) => up.session === spec.engine && up.agentId === agentId).map(([sub]) => sub);
      const asked = (t: string, agentId: string | null) => s.received.filter((f) => f.t === t && f.session === spec.engine && (f.agentId ?? null) === agentId);
      return {
        append(agentId, row) {
          transcriptOf(spec, agentId).push(row);
          for (const sub of open(agentId)) numbered(sub, 'row', { row, agentId });
        },
        end(agentId) {
          for (const sub of open(agentId)) {
            numbered(sub, 'end', { reason: 'discontinuity', message: 'the bridge’s stream lost its place' });
            upstreams.delete(sub);
          }
        },
        subscribes: (agentId) => asked('subscribe', agentId),
        pages: (agentId) => asked('rows', agentId),
        presence(record) {
          held.presence = record === null ? { record: null, bridge: false } : { record, bridge: true, launch: spec.launch };
          s.send(envelope(project, spec.engine, 'presence', null, null, held.presence));
        },
      };
    },
    said: () => s.received.map((frame) => JSON.stringify(frame).slice(0, 300)).join('\n'),
    close: () => {
      clearInterval(pumping);
      s.close();
    },
  };
}
