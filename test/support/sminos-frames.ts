// What the harness's fake sminos says on a machine's RL10 socket to list one lane B session (P5 O7 M2's §Q pattern,
// e2e/support/fake-sminos.ts; P5 O7 M7's live bench agent, test/support/remote-bench-agent.ts): the hello with the
// endpoint's token, per project its `machine` presence (its checkouts) and its log-plane `hello`, and each session's
// `member` frame as sminos's lane B observer would restate it. Frames only: the connection is the caller's.

/** One lane B session's record, as sminos's `member` frame carries it (src/endpoint/rl10/members.ts's `Member`). */
export interface LaneBMember {
  engine: string; // the engine session id, which sminos keys its members by
  alias: string;
  title: string;
  cwd: string;
  owners: string[];
  state?: string; // `idle` unless given
}

const POLICY = { read_only: false, ceiling: 'settings' };

export const helloFrame = (token: string, version: string) => ({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token, sminos: { version }, policy: POLICY });
export const restatedFrame = () => ({ t: 'restated' });

/** A project's `machine` presence on `machine` and its log-plane `hello`, so the endpoint relays it and lists its sessions. */
export const projectFrames = (project: string, machine: string, checkouts: readonly string[]) => [
  { t: 'session', message: { project, machine, session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: POLICY, checkouts: checkouts.map((path) => ({ path, branch: 'main' })), desk: {} } } },
  { t: 'hello', project, name: machine, have: {} },
];

export const memberFrame = (project: string, m: LaneBMember) => ({ t: 'member', session: m.engine, alias: m.alias, project, lane: 'B', state: m.state ?? 'idle', title: m.title, cwd: m.cwd, owners: m.owners, ownersProof: [], origin: { kind: 'maws' }, access: 'listed' });
export const goneFrame = (engine: string) => ({ t: 'member', session: engine, gone: true });
