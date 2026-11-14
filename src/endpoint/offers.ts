// The endpoint's offer table (O10 M5; Interfaces §G; P5 Decision Log 45): the only names that cross from a remote caller.
// Each row names its executor, whether it is a `call` (a read, list or view) or an `act` (an RL4 action), and its
// target rule; a by-effect command's rule is its row in by-effect.ts. A name not here is `not-offered`, graded or not,
// so every command that crosses has had its input, its target and its effect read for remote use. O7, O8 and O9 add
// rows when they open remote surfaces, sharing and lane A control, each with its own tests.
//
// A registry command takes its grade from O1's declaration (`gradeOf`, `ungraded` when its namespace declares none) and
// its input is held to the registry's schema. Lane A's actions are sminos's RPC names, `sminos.<rpc>`, graded here
// (§G's table); the endpoint's own take no grade (`null`): the grant's or the state's own signatures are the authority.
import type { Feed, ReadStreamKind } from 'org-protocol';
import { parseArtifactUrl } from '@shared/artifacts/scheme';
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
 * holding `manage` on every one: targets.ts, artifacts.ts), or `task-list` (P5 O7 M8: a task list's read, `fs.tasks`: the
 * input's `appSessionId` names the session, placed as an `appSessionId`, and its `listId` must be that session's own
 * list: targets.ts), or `record` (P5 O8 M6b: a session's record act, `record.*`, naming exactly one of `session`, a lane A
 * engine session id, or `appSessionId`, a lane B app session id, placed through RL10's members join: targets.ts).
 */
export type TargetRule = 'appSessionId' | 'session' | 'machine' | 'checkout' | 'each-session' | 'artifact' | 'task-list' | 'record';

/** Who runs an authorized request (M7 routes acts by it, M8 calls): a lane, the endpoint itself, or one of mawsd's hosts. */
export type OfferExecutor = 'engine-host' | 'sminos' | 'endpoint' | 'machine' | 'pty-host' | 'main';

/**
 * `kind`: a `call` (a read, list or view), an `act` (an RL4 action), or (P5 O7 M5b) a `stream`, the read open of the
 * stream kind `stream` names: a `streamOpen` with no `op`, authorized as a call is, by authorization's eight steps at the
 * row's grade with the open's kind fields as the input (authorize.ts), and run by the endpoint's stream planes (streams.ts).
 */
export type OfferRow = {
  kind: 'call' | 'act' | 'stream';
  executor: OfferExecutor;
  target: TargetRule;
  /** The grade, for a name outside the registry; `null` for the endpoint's signed actions. Absent: the registry's. */
  grade?: GradeSpec | null;
  /**
   * The input a name outside the registry takes (P5 O7 M3: `forward.open`), held to it at authorization's step 2 as a
   * registry command's is to its schema (`malformed`). Absent for such a name: its executor reads its input (sminos's RPCs,
   * the endpoint's signed actions). P5 O7 M8: on a registry command's row, what of its schema's inputs a remote caller may
   * send, held at step 2 after the schema (`fs.unfollow`: an agent named, never the session-wide form).
   */
  accepts?(input: unknown): boolean;
  /** P5 O7 M5b: the stream kind a `stream` row admits (its open's kind fields are the row's input). */
  stream?: ReadStreamKind;
  /**
   * P5 O7 M9: the machine's owners' alone (the remote setup's rows): checked before the grade (authorize.ts), anyone else,
   * a grant-holder included, refused `owners-only`.
   */
  owners?: true;
  /**
   * P5 O8 M6b: the capability the machine's sminos must advertise in its RL10 hello for the row to be offered (`record`):
   * without it the request is refused `not-offered` before anything is read or sent, and with no sminos connected
   * `unavailable` (the machine's condition, asked again later).
   */
  sminos?: 'record';
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
/**
 * P5 O7 M5b: the read open's name for each of its kinds, the stream row that admits it (an endpoint name, not a
 * registry command: its `accepts` reads the open's kind fields).
 */
export const READ_OPENS: Readonly<Record<ReadStreamKind, string>> = { http: 'artifacts.fetch', document: 'documents.open', 'browser.screencast': 'browser.screencast' };
const isFields = (input: unknown, keys: readonly string[]): input is Readonly<Record<string, unknown>> =>
  typeof input === 'object' && input !== null && !Array.isArray(input) && Object.keys(input).every((key) => keys.includes(key));
/** An `http` open's fields: a URL exactly of the artifact scheme's shape (scheme.ts; anything else `malformed`), a GET or a HEAD, a range header. */
const isHttpOpen = (input: unknown): boolean =>
  isFields(input, ['url', 'method', 'range']) &&
  typeof input.url === 'string' &&
  parseArtifactUrl(input.url) !== null &&
  (input.method === 'GET' || input.method === 'HEAD') &&
  (input.range === undefined || (typeof input.range === 'string' && input.range !== '' && input.range.length <= 256));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A `document` open's fields: the artifact (a UUID, as the store's document channel takes it), the mode, the suggestions' document. */
const isDocumentOpen = (input: unknown): boolean =>
  isFields(input, ['artifactId', 'mode', 'doc']) && typeof input.artifactId === 'string' && UUID.test(input.artifactId) && (input.mode === 'edit' || input.mode === 'view') && (input.doc === undefined || input.doc === 'suggestions');
/**
 * P5 O17 M9a: a `browser.screencast` open's fields: the session (an appSessionId, which the `appSessionId` rule places),
 * the epoch and the tab (the feed seam's to read: a tab it doesn't hold, or another epoch, is its refusal), and a
 * controlling open's act; nothing else.
 */
const isBrowserOpen = (input: unknown): boolean =>
  isFields(input, ['appSessionId', 'epoch', 'tabId', 'control']) &&
  typeof input.appSessionId === 'string' &&
  typeof input.epoch === 'string' &&
  input.epoch !== '' &&
  typeof input.tabId === 'string' &&
  input.tabId !== '' &&
  (input.control === undefined || (isFields(input.control, ['op']) && typeof input.control.op === 'string'));
/** P5 O17 M9a: `machine.browserControl`'s args: exactly the session and the epoch the grant is bound to. */
const isBrowserControlArgs = (input: unknown): boolean =>
  isFields(input, ['appSessionId', 'epoch']) && typeof input.appSessionId === 'string' && typeof input.epoch === 'string' && input.epoch !== '' && input.epoch.length <= 256;
/** P5 O7 M5c: `client.windowShown`'s input: exactly whether the device shows a page holding a lease on this machine. */
const isWindowShown = (input: unknown): boolean => isFields(input, ['shown']) && typeof input.shown === 'boolean';
/** P5 O7 M5c: the owner's connector and grant management on the machine (`machine-admin`, a step-up each), under `machine.op`. */
const machineAdmin: OfferRow = { kind: 'act', executor: 'machine', target: 'machine' };
/**
 * P5 O7 M9: the remote setup's rows, the machine's owners' alone. The folder list and the trust read are calls at `list`
 * (an owner reads their own machine's folder names and trust state without a step-up per page; their registry grade is
 * `spawn`); the registration is a `machine-admin` act, a step-up each, held to the setup policy (policy.ts), never to the
 * spawn guard.
 */
const ownersCall: OfferRow = { kind: 'call', executor: 'machine', target: 'machine', grade: 'list', owners: true };
/**
 * The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, M9's offers; design §3): the project acts
 * on a machine's own folders, `machine-admin` and the machine's owners' alone, as `addFolder` is; `resolve` an owners'
 * read of the rule, as the folder list is.
 */
const projectAct: OfferRow = { kind: 'act', executor: 'machine', target: 'machine', grade: 'machine-admin', owners: true };
/** Over the network a rename takes a name alone: a row's order is its own machine's. */
const isRenameArgs = (input: unknown): boolean =>
  isFields(input, ['id', 'patch']) && isFields(input.patch, ['name']) && typeof (input.patch as { name?: unknown }).name === 'string';
/** P5 O7 M8: `fs.unfollow` from another machine names the agent whose follow it lets go of. */
const namesAnAgent = (input: unknown): boolean => typeof input === 'object' && input !== null && typeof (input as { agentId?: unknown }).agentId === 'string';
/**
 * UX wave U1a §F (Reported 2, ruled): a plan's answer from another machine names no mode. An answer is graded `approve`
 * and a mode change `manage` (by-effect.ts, the registry's grades), so a mode inside an answer would let a caller set a
 * mode it may not; it is refused here, on the input the engine host would act on. Carrying it is a debt row: a by-effect
 * grade of `manage` held to the ceiling, behind a capability.
 */
const answersWithoutMode = (input: unknown): boolean => {
  const answer = typeof input === 'object' && input !== null ? (input as { answer?: unknown }).answer : undefined;
  return !(typeof answer === 'object' && answer !== null && (answer as { kind?: unknown }).kind === 'plan' && Object.hasOwn(answer, 'mode'));
};
/** `forward.open`'s args: exactly a port. */
const isForwardArgs = (input: unknown): boolean =>
  typeof input === 'object' && input !== null && !Array.isArray(input) && Object.keys(input).length === 1 && Number.isInteger((input as { port?: unknown }).port) && (input as { port: number }).port >= 1 && (input as { port: number }).port <= 65535;

/**
 * P5 O8 M6b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b and Interfaces §Q, agreed with the desk track):
 * the record acts, a session's general access, its shares and (M5b's) an owner added. Each act names its target in its
 * `args`, exactly one of `session` (lane A's engine session id) or `appSessionId` (lane B's), beside the change, and
 * carries no `session` and no `context`: a record act doesn't depend on how the session was launched.
 */
export const RECORD_ACTS = ['record.access', 'record.shares', 'record.owners'] as const;
/** The call that reads the policies the record acts change (`{session?}`: one session, by its listing's id). */
export const RECORD_POLICY = 'record.policy';
const RECORD_ACCESS: readonly string[] = ['private', 'listed', 'org-view', 'org-converse'];
const SHARE_GRADES: readonly unknown[] = ['list', 'view', 'converse', 'approve', null];
const isRecordId = (value: unknown): boolean => typeof value === 'string' && value !== '' && value.length <= 512;
/** A record act's args: exactly one target key, a non-empty id, and exactly the change's own keys, each by `change`'s rule. */
const isRecordArgs =
  (change: Readonly<Record<string, (value: unknown) => boolean>>) =>
  (input: unknown): boolean => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
    const fields = input as Readonly<Record<string, unknown>>;
    const targets = ['session', 'appSessionId'].filter((key) => Object.hasOwn(fields, key));
    if (targets.length !== 1 || !isRecordId(fields[targets[0]])) return false;
    const keys = Object.keys(fields).filter((key) => key !== targets[0]);
    return keys.length === Object.keys(change).length && keys.every((key) => Object.hasOwn(change, key) && change[key](fields[key]));
  };
/** `record.policy`'s input: none, or exactly the one session it names. */
export const isPolicyInput = (input: unknown): boolean => input === null || input === undefined || (isFields(input, ['session']) && (input.session === undefined || isRecordId(input.session)));
const recordAct = (change: Readonly<Record<string, (value: unknown) => boolean>>): OfferRow => ({ kind: 'act', executor: 'sminos', target: 'record', grade: 'manage', accepts: isRecordArgs(change), sminos: 'record' });
/**
 * The UX wave (U9, UC-7.4; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §1): `session.update`
 * from another machine is an unarchive alone, its patch exactly `{archived: false}` (the services' handler checks it
 * again, src/services/index/register.ts); and the archived sessions' read is exactly `{includeArchived: true}`.
 */
const isUnarchive = (input: unknown): boolean => isFields(input, ['appSessionId', 'patch']) && isFields(input.patch, ['archived']) && Object.keys(input.patch as object).length === 1 && (input.patch as { archived?: unknown }).archived === false;
const isArchivedList = (input: unknown): boolean => isFields(input, ['includeArchived']) && (input as { includeArchived?: unknown }).includeArchived === true;
/**
 * The UX wave (U9, M2): a fork from another machine is in place alone (a new worktree's sheet checks names and branches
 * on the asking Mac); its `rewindTo` and first message are as the schema has them.
 */
const isInPlaceFork = (input: unknown): boolean => isFields(input, ['appSessionId', 'target', 'message', 'rewindTo']) && isFields(input.target, ['kind']) && (input.target as { kind?: unknown }).kind === 'inPlace';

/** P5 O8 M4b: the call that reads the machine's grant ledger back (grants.ts), and its input: none. */
export const ENDPOINT_GRANTS = 'endpoint.grants';
export const isGrantsInput = (input: unknown): boolean => input === null || input === undefined;

export const OFFERS: Offers = {
  commands: {
    // Lane B's conversation, through the engine host's ledger (M7's `host.op`), and its reads (M8).
    'session.send': laneB('act'),
    'session.steer': laneB('act'),
    'session.interrupt': laneB('act'),
    'session.answer': { ...laneB('act'), accepts: answersWithoutMode },
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
    // P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): the caller's own reading and
    // draft, kept per member on the machine (readers.ts): pinned, last seen and unread (`list`, answered as `ReaderState`,
    // never the record), and the composer's draft, read at `view` and written at `converse` under the services' ledger.
    // `session.update` (the record's `title` and `archived`, the owners') is offered as an unarchive alone (below).
    'session.reader.update': laneBMachine('call'),
    'session.drafts.get': laneBMachine('call'),
    'session.drafts.set': laneBMachine('act'),
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
    // A child agent's events, the engine host's read. P5 O7 M8: the follow it starts is held by the channel's client, and
    // ends with the channel or that client's unfollow of the agent it names (the engine host lets go of its own hold
    // alone); the session-wide unfollow (`agentId: null`) would stop every client's follow of the session and is refused.
    'fs.agentEvents': laneB('call'),
    'fs.unfollow': { ...laneB('call'), accepts: namesAnAgent },
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
    // P5 O7 M9: "+ Session" on a machine with no checkout of the project: its folders, the chosen one registered, its trust
    // read for the trust card (whose answer goes as `session.spawn`'s `trust`), each the machine's owners' alone.
    'machine.folders.list': ownersCall,
    'session.trust.check': ownersCall,
    'session.projects.addFolder': projectAct,
    // The project registry (M9): a link set or cleared, a location pointed at its folder's new path, a rename and a
    // removal; `link` and `relocate` always step up as `addFolder` does, `update` and `remove` never (step-up.ts).
    // `relocate` and `resolve` name a directory, held to the setup policy as `addFolder` is (policy.ts).
    'session.projects.link': projectAct,
    'session.projects.relocate': projectAct,
    'session.projects.update': { ...projectAct, accepts: isRenameArgs },
    'session.projects.remove': projectAct,
    'session.projects.resolve': ownersCall,
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
    // P5 O8 M6b (Interfaces §Q): a session's reach, changed by its owners through sminos's executors (`set_visibility`)
    // as an RL10 `rpc` carrying the act as its proof, on either lane (rl10/link.ts), each with a step-up (step-up.ts:
    // every `record.*`); offered only while the machine's sminos advertises `record`. And the policies they change, read
    // from sminos's member frames for the sessions the caller owns (record-policy.ts): admitted at `list` on the machine,
    // its answer cut to `manage`, as an `each-session` row's is to its grade (a call graded above `view` is an act).
    'record.access': recordAct({ access: (value) => typeof value === 'string' && RECORD_ACCESS.includes(value) }),
    'record.shares': recordAct({ member: isRecordId, grade: (value) => SHARE_GRADES.includes(value) }),
    'record.owners': recordAct({ add: (value) => value === true, member: isRecordId }),
    'record.policy': { kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list', accepts: isPolicyInput },
    // The endpoint's own, and mawsd's content-free reads (O2 grades `daemon.status` `list`; O6's is `ungraded` until it lands).
    'endpoint.grant': { kind: 'act', executor: 'endpoint', target: 'machine', grade: null },
    'endpoint.state': { kind: 'act', executor: 'endpoint', target: 'machine', grade: null },
    'endpoint.listings': { kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' },
    // P5 O8 M4b (Interfaces §R): the machine's grant ledger read back, admitted at `list` as `endpoint.listings` is, its
    // answer cut as it goes to the caller's own entry, or every member's for an owner of the machine (grants.ts); no
    // sminos gate, as `record.policy` has none.
    'endpoint.grants': { kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list', accepts: isGrantsInput },
    'daemon.status': { kind: 'call', executor: 'machine', target: 'machine' },
    'machine.identity': { kind: 'call', executor: 'machine', target: 'machine' },
    // P5 O7 M6: the machine's attention items and conversation search, each answering for every session. `list` admits any
    // member (as `endpoint.listings`); the answer keeps only the sessions the caller holds the registry's grade (`view`) on.
    'attention.list': eachSession,
    'session.search': eachSession,
    // P5 O8 M7b: a project's to-human entries (the journal's `channel.history`), each kept for a caller who views its
    // session, ranked lane by lane (channel-view.ts): to-human text is the session's content.
    'channel.history': eachSession,
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
    // P5 O7 M5b: the read open's rows, both on the `artifact` rule: an artifact page's request (`view`, the artifact from
    // the open's URL), and its document channel, `view` by effect, an `edit` open taking `manage` (by-effect.ts).
    'artifacts.fetch': { kind: 'stream', stream: 'http', executor: 'endpoint', target: 'artifact', grade: 'view', accepts: isHttpOpen },
    'documents.open': { kind: 'stream', stream: 'document', executor: 'endpoint', target: 'artifact', grade: { floor: 'view', byEffect: true }, accepts: isDocumentOpen },
    // P5 O7 M5c (A13, A14): O4's surfaces. A page's lease on the `artifact` rule, `view` by effect (by-effect.ts): its reads
    // as calls, the two that run the owner's connector tools (`converse`) as `machine.op` acts; a lease is named by its id
    // after its open, which the channel's own table places (leases.ts), and re-authorized while it lives.
    'connectors.open': artifact('call', 'machine'),
    'connectors.declare': artifact('call', 'machine'),
    'connectors.watch': artifact('call', 'machine'),
    'connectors.unwatch': artifact('call', 'machine'),
    'connectors.visibility': artifact('call', 'machine'),
    'connectors.close': artifact('call', 'machine'),
    'connectors.call': artifact('act', 'machine'),
    'connectors.refresh': artifact('act', 'machine'),
    // Send to: the target's state at `view`, the receipts at `list` cut per row to the artifacts the member views (calls.ts),
    // a send and its cancel at `manage` (a cancel names its run, which the channel's own send placed).
    'delivery.status': artifact('call', 'machine'),
    'delivery.receipts': { kind: 'call', executor: 'machine', target: 'machine', grade: 'list' },
    'delivery.send': artifact('act', 'machine'),
    'delivery.cancel': artifact('act', 'machine'),
    // The owner's connections, sign-ins and grants: `machine-admin`, as O4 graded them.
    'connectors.servers': machineAdmin,
    'connectors.connect': machineAdmin,
    'connectors.reconnect': machineAdmin,
    'connectors.disconnect': machineAdmin,
    'connectors.signIn': machineAdmin,
    'connectors.signInCancel': machineAdmin,
    // P5 O7 M8: Sign in from a session's MCP widget, the server named as the engine reports it (no entry file)
    'connectors.signInServer': machineAdmin,
    'artifacts.grantConnectorTool': machineAdmin,
    'artifacts.revokeConnectorTool': machineAdmin,
    // A consent's redirect relayed from this device's loopback listener (`list`), run by the flow its own channel armed
    // for the port (the machine keys it by the asker's ref, which the call carries).
    'connectors.callback': { kind: 'call', executor: 'machine', target: 'machine' },
    // The device's window report, the endpoint's own call (no registry name: `connectors.windowShown` is main-only),
    // answered under the channel's ref (calls.ts).
    'client.windowShown': { kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list', accepts: isWindowShown },
    // M5c round 3 (`rl2.asset-holds`): a remote dashboard's snapshot holds, the engine host's main-only E3 commands asked
    // by the device's main (never a window: `holdDatasets` and `releaseDatasets` are not offered), kept per channel by
    // the endpoint (asset-holds.ts). A hold at `view` on its artifact, decided again while it lives; a release at `list`,
    // which names only a hold of the asking channel's own (any other id releases nothing).
    'artifacts.holdAssets': { kind: 'call', executor: 'endpoint', target: 'artifact', grade: 'view' },
    'artifacts.releaseAssets': { kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' },
    // P5 O17 M9a (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K; R2, accepted by O10): the agent's
    // browser on a lane B session. A viewer's stream of one tab, the read open's third kind, `view` by effect (a
    // controlling open, naming its grant, takes `approve`: by-effect.ts), so every re-check reads the standing it needs;
    // and the grant itself, the endpoint's own act bound to the session and the epoch, `approve` on the session (a step-up
    // for a member who doesn't own it), its result `{appSessionId, epoch}`, which a controlling open names by its opId.
    // The session's tabs as they change ride its `browser.inventory` feed (plane-feeds.ts), at `view`.
    'browser.screencast': { kind: 'stream', stream: 'browser.screencast', executor: 'endpoint', target: 'appSessionId', grade: { floor: 'view', byEffect: true }, accepts: isBrowserOpen },
    'machine.browserControl': { kind: 'act', executor: 'endpoint', target: 'appSessionId', grade: 'approve', accepts: isBrowserControlArgs },
    // P5 O7 M8 (Interfaces §U): what a remote session's panels read and do as a local one's do. The MAWS ask (its list at
    // `view`, its answer plain `converse`, as `session.answer`'s for a question), the side question's log and its new
    // conversation, Reload plugins (`manage`), the agents panel's reads, and the outcomes the engine host keeps by opId,
    // which a device asks for the operations its waiters hold at each reopen.
    'maws.asks.list': laneB('call'),
    'maws.ask.answer': laneB('act'),
    'side.question.list': laneB('call'),
    'side.question.clear': laneB('act'),
    'session.reloadPlugins': laneB('act'),
    'fs.subagents': laneB('call'),
    'fs.workflows': laneB('call'),
    'session.operations': laneB('call'),
    // A task list names no session: the call names it too, and the list must be that session's own (the `task-list` rule).
    'fs.tasks': { kind: 'call', executor: 'engine-host', target: 'task-list' },
    // The offer audit's session-scoped `view` reads: the engine's dialogs and reads of the session (the family of
    // `session.getSettings` and `getStatus`), its prompt history, and Session info's facts and the recent turns from the
    // machine's services. Every other unoffered session-scoped command is declared remote-unavailable (m8-2b).
    'session.getHooksListing': laneB('call'),
    'session.getMemoryDialog': laneB('call'),
    'session.getSkillsDialog': laneB('call'),
    'session.getSandboxDialog': laneB('call'),
    'session.exportConversation': laneB('call'),
    'session.getBinaryVersion': laneB('call'),
    'session.promptHistory': laneB('call'),
    'session.observedFacts': laneBMachine('call'),
    'session.recentTurns': laneBMachine('call'),
    // The UX wave (U9, UC-7.4), behind `rl2.session-acts` (capabilities.ts): a session MAWS runs archived (which ends its
    // process), unarchived (`session.update` narrowed to that patch, graded `manage` by its rule, by-effect.ts) and renamed,
    // each `manage`, through the services' ledger with no launch context, so they work with no tab open; the archived
    // sessions' read, admitted at `list` and cut to the records the caller holds `manage` on (calls.ts); an attention
    // item dismissed (`converse`); and, on the session's live launch, a waiting message taken back and a pane's answer
    // (`converse`). The services' handlers run them as for this machine's own window.
    'session.archive': laneBMachine('act'),
    'session.update': { ...laneBMachine('act'), accepts: isUnarchive },
    'session.rename': laneBMachine('act'),
    'session.list': { kind: 'call', executor: 'machine', target: 'each-session', grade: 'list', accepts: isArchivedList },
    'attention.acknowledge': laneBMachine('act'),
    'session.steer.cancel': laneB('act'),
    'maws.pane.answer': laneB('act'),
    // M2: a fork in place (graded `spawn`, a right on the machine), the machine's owners' alone, who must also view the
    // source (authorize.ts): a fork names no starter, so it is the owners'. Composed by the services under the operation,
    // answered at its setup's `launching` and held there to the machine's ceiling on the record it copies its mode from.
    'session.fork': { kind: 'act', executor: 'machine', target: 'appSessionId', owners: true, accepts: isInPlaceFork },
  },
  subscriptions: ['A', 'B'],
  // P5 O7 M5a: the machine's `artifacts` feed (artifacts-feed.ts). P5 O17 M9a: a session's `browser.inventory`. P5 O8 M7b:
  // a project's `channel` (channel-feed.ts).
  feeds: ['checkout', 'attention', 'artifacts', 'browser.inventory', 'channel'],
};
