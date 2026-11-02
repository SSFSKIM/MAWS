// The endpoint's offer table (O10 M5; Interfaces §G; P5 Decision Log 45): the only names that cross from a remote caller.
// Each row names its executor, whether it is a `call` (a read, list or view) or an `act` (an RL4 action), and its
// target rule; a by-effect command's rule is its row in by-effect.ts. A name not here is `not-offered`, graded or not,
// so every command that crosses has had its input, its target and its effect read for remote use. O7, O8 and O9 add
// rows when they open remote surfaces, sharing and lane A control, each with its own tests.
//
// A registry command takes its grade from O1's declaration (`gradeOf`, `ungraded` when its namespace declares none) and
// its input is held to the registry's schema. Lane A's actions are sminos's RPC names, `sminos.<rpc>`, graded here
// (§G's table); the endpoint's own take no grade (`null`): the grant's or the state's own signatures are the authority.
import type { Feed } from 'org-protocol';
import type { GradeSpec } from '@shared/ipc/grades';

/**
 * Where a request's session is read: `appSessionId` (lane B, mapped to the engine session through the spine's record,
 * `session.get`, else the engine host's `session.status`: targets.ts),
 * `session` (lane A: the engine session id, `args.session` in an action, as DX6 has it), none: the machine itself, or
 * `checkout` (P5 O7 M4: a path-class read of a lane B session's checkout: the call's own `session` names the session,
 * placed as an `appSessionId`, and the input's `directory` or `repoRoot` must lie in that session's roots or their
 * repositories: targets.ts), or `each-session` (P5 O7 M6: a machine-wide read whose answer is per session, admitted at the
 * row's own grade, `list`, and cut by `calls.ts` to the sessions the caller holds the registry's declared grade on), or
 * `artifact` (P5 O7 M5a: an artifact by its id, ranked the highest of its linked sessions' ranks, the machine's owners
 * holding `manage` on every one: targets.ts, artifacts.ts).
 */
export type TargetRule = 'appSessionId' | 'session' | 'machine' | 'checkout' | 'each-session' | 'artifact';

/** Who runs an authorized request (M7 routes acts by it, M8 calls): a lane, the endpoint itself, or one of mawsd's hosts. */
export type OfferExecutor = 'engine-host' | 'sminos' | 'endpoint' | 'machine' | 'pty-host' | 'main';

export type OfferRow = {
  kind: 'call' | 'act';
  executor: OfferExecutor;
  target: TargetRule;
  /** The grade, for a name outside the registry; `null` for the endpoint's signed actions. Absent: the registry's. */
  grade?: GradeSpec | null;
  /**
   * The input a name outside the registry takes (P5 O7 M3: `forward.open`), held to it at authorization's step 2 as a
   * registry command's is to its schema (`malformed`). Absent for such a name: its executor reads its input (sminos's RPCs,
   * the endpoint's signed actions).
   */
  accepts?(input: unknown): boolean;
};

/**
 * The table, the lanes a `sub` may name (M8: `full` or `cards` on either), and the feeds it may name (P5 O7 M4, §R: a
 * session's `checkout` feed; M6: the machine's `attention`).
 */
export type Offers = { commands: Readonly<Record<string, OfferRow>>; subscriptions: readonly ('A' | 'B')[]; feeds: readonly Feed[] };

const laneB = (kind: 'call' | 'act'): OfferRow => ({ kind, executor: 'engine-host', target: 'appSessionId' });
/** A lane B session's command the machine's services run (the spine: its record, its app events, the resume). */
const laneBMachine = (kind: 'call' | 'act'): OfferRow => ({ kind, executor: 'machine', target: 'appSessionId' });
/** A read of a lane B session's checkout by a path (`git.*`): the call names its session, the input a directory in it. */
const checkout: OfferRow = { kind: 'call', executor: 'machine', target: 'checkout' };
const laneA = (kind: 'call' | 'act', grade: GradeSpec): OfferRow => ({ kind, executor: 'sminos', target: 'session', grade });
/** A machine-wide read answered per session (P5 O7 M6): admitted at `list`, its answer cut per session (calls.ts). */
const eachSession: OfferRow = { kind: 'call', executor: 'machine', target: 'each-session', grade: 'list' };
/**
 * P5 O7 M5a: an artifact's read or write, by the `artifact` rule (targets.ts): the engine host's store, or the machine's
 * services (`artifacts.export`, the connectors' grants, the library's reads of a stored file).
 */
const artifact = (kind: 'call' | 'act', executor: 'engine-host' | 'machine' = 'engine-host'): OfferRow => ({ kind, executor, target: 'artifact' });
/** A terminal's act on the machine (`shell`, the registry's grade), under the pty host's ledger (`pty.op`). */
const pty: OfferRow = { kind: 'act', executor: 'pty-host', target: 'machine' };
/** `forward.open`'s args: exactly a port. */
const isForwardArgs = (input: unknown): boolean =>
  typeof input === 'object' && input !== null && !Array.isArray(input) && Object.keys(input).length === 1 && Number.isInteger((input as { port?: unknown }).port) && (input as { port: number }).port >= 1 && (input as { port: number }).port <= 65535;

export const OFFERS: Offers = {
  commands: {
    // Lane B's conversation, through the engine host's ledger (M7's `host.op`), and its reads (M8).
    'session.send': laneB('act'),
    'session.steer': laneB('act'),
    'session.interrupt': laneB('act'),
    'session.answer': laneB('act'),
    'session.queue.edit': laneB('act'),
    'session.queue.promote': laneB('act'),
    'session.queue.setPaused': laneB('act'),
    'session.status': laneB('call'),
    'session.events': laneB('call'),
    'session.pendingRequest': laneB('call'),
    'session.pendingItems': laneB('call'),
    'session.queue.list': laneB('call'),
    'session.catalog': laneB('call'),
    // P5 O7 M2: a remote pane's reads (each `view`), the queue's and the chips' acts through `host.op`, and the spine's
    // record, app events and history, and its resume behind a send to a released session (`machine.op`, P5 Decision Log
    // 36), which carries neither `session` nor `context`: the services' ledger claims no launch.
    'session.getContextUsage': laneB('call'),
    'session.getUsage': laneB('call'),
    'session.getWorkspaceDiff': laneB('call'),
    'session.getSettings': laneB('call'),
    'session.listModels': laneB('call'),
    'session.listPermissionRules': laneB('call'),
    'session.getStatus': laneB('call'),
    'session.mcpStatus': laneB('call'),
    'session.getSessionCost': laneB('call'),
    'session.get': laneBMachine('call'),
    'session.appEvents': laneBMachine('call'),
    'session.history.list': laneBMachine('call'),
    'session.queue.hold': laneB('act'),
    'session.queue.remove': laneB('act'),
    'session.setModel': laneB('act'),
    'session.setEffort': laneB('act'),
    'session.setThinking': laneB('act'),
    'session.setPermissionMode': laneB('act'),
    'session.stopTask': laneB('act'),
    'session.sideQuestion': laneB('act'),
    'session.mcpToggle': laneB('act'),
    'session.mcpReconnect': laneB('act'),
    'session.rewind': laneB('act'),
    'session.rewindFiles': laneB('act'),
    'session.forget': laneB('act'),
    'session.setKeep': laneB('act'),
    'session.generateTitle': laneB('act'),
    'session.acquire': laneBMachine('act'),
    // P5 O7 M4: a remote session's checkout. The files and scm reads name their session; the files service's allowlist
    // bounds their paths, and a watch is owned by the channel's `ClientRef`, so it ends with the channel. Their changes,
    // and git's, reach the device on the session's `checkout` feed (plane-feeds.ts).
    'files.list': laneBMachine('call'),
    'files.read': laneBMachine('call'),
    'files.watch': laneBMachine('call'),
    'files.unwatch': laneBMachine('call'),
    'scm.status': laneBMachine('call'),
    'scm.push.plan': laneBMachine('call'),
    'scm.pr.plan': laneBMachine('call'),
    'scm.remote.last': laneBMachine('call'),
    'scm.pr.state': laneBMachine('call'),
    // git's reads name a directory or a repository, which the git service answers for the whole repository: the call's
    // `session` names the session, whose roots and their repositories bound the path (the `checkout` rule).
    'git.status': checkout,
    'git.branches': checkout,
    'git.diff': checkout,
    'git.log': checkout,
    'git.watch': checkout,
    'git.unwatch': checkout,
    'git.lsFiles': checkout,
    'git.worktree.list': checkout,
    'git.worktree.status': checkout,
    'git.worktree.branch': checkout,
    // A child agent's events, the engine host's read.
    'fs.agentEvents': laneB('call'),
    // The checkout's writes, under the services' ledger (`machine.op`), placed by their session with no launch context,
    // so the editor saves to an idle session's checkout without resuming it.
    'files.write': laneBMachine('act'),
    'files.upload': laneBMachine('act'),
    'scm.stage': laneBMachine('act'),
    'scm.unstage': laneBMachine('act'),
    'scm.discard': laneBMachine('act'),
    'scm.commit': laneBMachine('act'),
    'scm.push': laneBMachine('act'),
    'scm.pr.create': laneBMachine('act'),
    'scm.remote.cancel': laneBMachine('act'),
    // A lane B session started here at a member's request (graded `spawn`, held to the spawn guard as `sminos.spawn` is),
    // and the projects "+ Session"'s machine menu lists (`list`).
    'session.spawn': { kind: 'act', executor: 'machine', target: 'machine' },
    'session.projects.list': { kind: 'call', executor: 'machine', target: 'machine' },
    // P5 O7 M3: a remote terminal's acts, each `shell` on the machine, under the pty host's ledger; the terminal's bytes go
    // over a stream opened under the spawn or the attach (streams.ts). `pty.listFor` is `pty.list` for one session, since an
    // act's args are an object and `pty.list` takes none.
    'pty.spawn': pty,
    'pty.attach': pty,
    'pty.kill': pty,
    'pty.listFor': pty,
    // A port of the machine's loopback forwarded to the device: the endpoint's own act (no registry name), `shell` on the
    // machine; its result names the forward, which a `tcp` stream names (forwards.ts).
    'forward.open': { kind: 'act', executor: 'endpoint', target: 'machine', grade: 'shell', accepts: isForwardArgs },
    // Lane A's bridge-fenced RPCs and spawn, through RL10 (M6); `resume`, `retire` and `stop` run outside the bridge's
    // fence and are not offered.
    'sminos.steer': laneA('act', 'converse'),
    'sminos.interrupt': laneA('act', 'converse'),
    'sminos.answer': laneA('act', 'converse'),
    'sminos.model': laneA('act', 'converse'),
    'sminos.btw': laneA('act', 'converse'),
    'sminos.tell': laneA('act', 'converse'),
    'sminos.media': laneA('act', 'converse'),
    'sminos.stop-agent': laneA('act', 'converse'),
    'sminos.decide': laneA('act', 'approve'),
    'sminos.compact': laneA('act', 'manage'),
    'sminos.command': laneA('act', { floor: 'converse', byEffect: true }),
    // A person's message, in either turn state (O9 M1; its Interfaces §E): graded by its text, as `session.send`'s.
    'sminos.send': laneA('act', { floor: 'converse', byEffect: true }),
    'sminos.spawn': { kind: 'act', executor: 'sminos', target: 'machine', grade: 'spawn' },
    'sminos.rows': laneA('call', 'view'),
    'sminos.diff': laneA('call', 'view'),
    'sminos.output': laneA('call', 'view'),
    'sminos.read': laneA('call', 'view'),
    // The endpoint's own, and mawsd's content-free reads (O2 grades `daemon.status` `list`; O6's is `ungraded` until it lands).
    'endpoint.grant': { kind: 'act', executor: 'endpoint', target: 'machine', grade: null },
    'endpoint.state': { kind: 'act', executor: 'endpoint', target: 'machine', grade: null },
    'endpoint.listings': { kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' },
    'daemon.status': { kind: 'call', executor: 'machine', target: 'machine' },
    'machine.identity': { kind: 'call', executor: 'machine', target: 'machine' },
    // P5 O7 M6: the machine's attention items and conversation search, each answering for every session. `list` admits any
    // member (as `endpoint.listings`); the answer keeps only the sessions the caller holds the registry's grade (`view`) on.
    'attention.list': eachSession,
    'session.search': eachSession,
    // P5 O7 M5a: a remote session's artifacts, by the `artifact` rule: the reads (`view`, O1's) as calls, the writes
    // (`manage`) as engine-host acts with no session (`host.artifactOp`, the claim naming the artifact: actions.ts);
    // `artifacts.list` only with the session it lists (`filter.appSessionId`), `copyAsset` on `to` with `view` on `from`
    // by effect, `create` the orphan form (the machine's owners). Bytes cross in the codec's tagged form, behind `rl2.bytes`.
    'artifacts.get': artifact('call'),
    'artifacts.versions': artifact('call'),
    'artifacts.versionState': artifact('call'),
    'artifacts.attributions': artifact('call'),
    'artifacts.readDataset': artifact('call'),
    'artifacts.datasetFiles': artifact('call'),
    'artifacts.markViewed': artifact('call'),
    'artifacts.list': artifact('call'),
    'artifacts.export': artifact('call', 'machine'),
    'artifacts.connectorGrants': artifact('call', 'machine'),
    'library.get': artifact('call', 'machine'),
    'library.content': artifact('call', 'machine'),
    'library.read': artifact('call', 'machine'),
    'artifacts.update': artifact('act'),
    'artifacts.delete': artifact('act'),
    'artifacts.duplicate': artifact('act'),
    'artifacts.saveVersion': artifact('act'),
    'artifacts.nameVersion': artifact('act'),
    'artifacts.restore': artifact('act'),
    'artifacts.pruneVersions': artifact('act'),
    'artifacts.acceptSuggestion': artifact('act'),
    'artifacts.rejectSuggestion': artifact('act'),
    'artifacts.uploadAsset': artifact('act'),
    'artifacts.copyAsset': artifact('act'),
    'artifacts.rereadDatasetFile': artifact('act'),
    'artifacts.create': artifact('act'),
    // The library's listing, each row kept for a caller who views its artifact (calls.ts, the `each-session` shape over
    // each row's own sessions; whole for a machine owner), and its Spaces (names and counts), at `list`.
    'library.list': eachSession,
    'library.spaces': { kind: 'call', executor: 'machine', target: 'machine', grade: 'list' },
    // O5's tools on a session (`view`); their changes ride the session's `checkout` feed (plane-feeds.ts).
    'session.capabilities': laneBMachine('call'),
  },
  subscriptions: ['A', 'B'],
  // P5 O7 M5a: the machine's `artifacts` feed (artifacts-feed.ts).
  feeds: ['checkout', 'attention', 'artifacts'],
};
