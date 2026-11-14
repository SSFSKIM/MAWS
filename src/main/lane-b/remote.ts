// Remote lane B (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M2 and Interfaces §J, §K): a lane B
// session on another machine, driven from this app over that machine's RL2 link (O7's `RemoteLink`, reached only through
// `Machines.remote(ref)`). The renderer keeps the local driver's commands and events; only this adapter knows the wire,
// and it opens no channel (O7's boundary.test.ts): every byte goes through the link's `call`, `act` and `subscribe`.
// Mirrors O9's remote lane A (src/main/lane-a/remote.ts).
//
// The composition root wraps the router's `remote` option (`routeLaneB` around `routeLaneA`): a name `handles` takes, for
// a machine `Machines.remote` answers, comes here with its link; every other command takes the manager's path, where a
// `list`- or `view`-graded one goes as a call (`dispatchOverLink`), which is how the pane's reads reach the machine.
//
// - Subscriptions follow the tabs (./remote-interest.ts): while a tab holds a session's address, its fold
//   (./remote-session.ts) reads its record and streams it; ten seconds after the last tab closed it is let go. A link the
//   roster drops ends its sessions (`closed`).
// - Acts are built here from typed fields and sealed by the link, in two shapes. An engine-host act (a send, a steer, an
//   interrupt, an answer, the queue's and the chips') names the session and carries the context of the last status its
//   stream delivered (`{lane: 'B', launchId, engineSessionId}`), its args the command's input (bare ids: the renderer
//   lowered them); an answer carries DX6's request digest over the pending request read with `session.pendingRequest`. A
//   `machine` act (`session.acquire`) carries neither a session nor a context: the machine places it by its args. An
//   engine-host act on a session with no `ready` status (released, opening, or its launch `exited` with the row kept)
//   resumes it first, `session.acquire` unless one is out, and is sealed with the first `ready` status the resumed launch
//   delivers; one whose launch is `starting` or `initializing` waits for its `ready`. An act on a session no tab holds is refused
//   `not-open`. Step-up is the link's `if-asked`.
// - Sends (`session.send`, `session.steer`) go one at a time per session: the next act is made at the one before's
//   outcome or at the pending bound, at most `sendQueueMax` waiting; an interrupt or an answer never waits behind them.
// - The pending bound. Every act answers at its outcome (./remote-outcomes.ts), never earlier, or at `sendPendingMs` from
//   its turn at the latest: an act the channel carried and whose answer was lost is queried by the link up to RL4's
//   horizon, so the renderer is answered `timeout` with the pending words, the act goes on querying and its late outcome
//   is logged. An act never put on a channel is past the bound only until the link's own hold ends it (`refused
//   offline`: A4's "Not sent").
// - Substitutes for two reads the pane makes that no offer row carries: `attention.request` from `session.pendingRequest`;
//   `engine.models` (machine-wide, graded `spawn`) from `session.listModels` of a live session there, the one in the asked
//   directory first, else the built-in list.
// - `session.events`, offered as a call, read in pages the channel carries when one answer would be too large
//   (./remote-history.ts): the pane's hydration of a long launch, or one holding large inline images; from M4, within the
//   machine's byte budget when its endpoint listed `rl2.events-budget`.
// - P5 O7 M4: the checkout. Its writes (`files.write`, the scm acts) are `machine` acts like `session.acquire`, so the
//   editor saves to an idle session's checkout without resuming it; `files.upload` crosses in parts, one upload at a time
//   per session (./remote-upload.ts); `session.spawn` is a `machine` act on the machine itself that always takes step-up
//   (the sheet and Touch ID), answered at its outcome within its own bound from the moment it went out. The checkout's
//   changes arrive on the session's feed and its watches are kept and given back across a reconnect
//   (./remote-checkout.ts). Every read of the checkout (`git.*`, `files.*`, `scm.*` reads) takes the manager's path as a
//   call, carrying the session it was made from (`MainContext.session`, sent as `call.session`).
// - P5 O7 M3: terminals and forwarded ports. A terminal of a session on the machine is a shell of its pty host: its acts
//   and its byte stream (./remote-pty.ts), across the link's channels; `pty.hostState` of the machine is its link's. A
//   loopback port of the machine is forwarded to a listener on this Mac's (./remote-forward.ts, `remote.forward.open`
//   and `.close`, which main's handlers bring here), each connection a stream.
// - P5 O7 M6: each machine's attention, on one machine-wide feed per link (./remote-attention.ts), which the badge and
//   the notifier read beside this Mac's (`attention`).
// - P5 O7 M5a: another machine's artifacts (./remote-artifacts.ts): their reads as calls, their writes as engine-host acts
//   on no session (the third act shape), the id-to-machine table, the `session.capabilities` substitute, the machine's
//   `artifacts` feed, and `remote.openCopy` and Save As's bytes, which main's handlers bring here (`artifacts`). P5 O7 M5b:
//   a document's `artifacts.open`, bridged to the window that asked (`ctx.client`) over a `document` stream.
// - P5 O7 M5c: O4's surfaces (./remote-connectors.ts): a page's leases, on the channel whose reset was said and under the
//   device's window report per machine (./remote-windows.ts); Connect and Sign in with a listener for their consent's
//   redirect, and the client port's answers (./remote-port.ts); Send to on the machine.
// - P5 O7 M8 ("The sitting's failures"; Interfaces §U): the MAWS ask's answer, the side question's clear and Reload
//   plugins are engine-host acts (an answer resumes a released session first, as a send does, and never waits behind
//   one); the sign-in by a server's name (`connectors.signInServer`) a consent's `machine` act. An operation's receipt
//   (`{opId}`) is handed to the session's fold, which asks the machine for its completion at each opening until it comes
//   (./remote-session.ts). A task list's read names the session it is of (`fs.tasks`' `appSessionId`: the input's, the
//   page's, else the open session whose list it is). An unfollow goes for a named agent; the session-wide one, which the
//   machine would take as every client's, goes as one per agent this device follows there (its `fs.agentEvents` reads). A send's `uploads` go only to an
//   endpoint that lists `rl2.upload-blocks` (the act `requires` it, so a later channel's older peer refuses rather than
//   misreads it); to any other the message goes with its `@` mention alone, as before. The machine's refusal of a send's
//   uploads, `malformed` with no reason, is the attachment's words.
// - The UX wave (U9, docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §1, §3): archive,
//   unarchive (`session.update {patch: {archived: false}}`), rename and a dismissal are `machine` acts, taking back a
//   waiting message and a pane's answer engine-host acts (the answer never resumes a session), and the archived sessions'
//   read a call by name; each goes only to an endpoint that lists `rl2.session-acts` (REMOTE_NEEDS), and a refusal of an
//   act with words says UC-7.5's sentence (./remote-outcomes.ts' `refusalResult`). M2: a fork in place is a `machine` act
//   with step-up (signed before its first copy goes; unasked on a machine the member owns, ../device/step-up.ts), not
//   through the spawn table, so two forks from one tab are two forks; its answer comes once the fork is `launching` on
//   the machine, waited for within the fork's command budget past the pending bound.
// - The UX wave (U9, M5, "The settled word"; Interfaces §9): one round per machine and generation of its link. At each
//   `up` the round settles, saying `remote.settled {machine, generation}` once, when none of the machine's lanes is
//   placing or awaiting (./remote-session.ts' `standing`), evaluated at the `up` and at every change of a lane's
//   standing, which the lane tells after what it said for it; at a `down` after `up` every subscription a lane keeps is
//   marked awaiting and the round ends, unsaid if it had not settled. The generation is counted here as the roster counts
//   it (src/main/machines/manager.ts: each reported `up`, per machine, never reset), a round attached at the roster's
//   word of the link (as the attention feed's is), or with the machine's first lane. A page that just subscribed is told
//   the settled generation again (`replay`). M5's three timing lines (./remote-timing.ts): a tab's open, here; a history
//   read, ./remote-history.ts; New chat's chooser, its two reads timed where the router routes them (`routeLaneB`).
import type { Socket } from 'node:net';
import type { MessageChannelMain } from 'electron';
import type { OpenAnswer } from '@shared/client/port';
import { requestDigestOf } from '@shared/host/request-digest';
import type { SessionEvent } from '@shared/graph/events';
import { ipcError, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import { PROJECT_ACTS_CAPABILITY } from '@shared/ipc/schema/session';
import { REMOTE_NEEDS } from '@shared/ipc/remote-unavailable';
import { validateCommandOutput } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { BUILTIN_MODELS } from '@shared/sessions/models';
import type { FilesUploadInput } from '@shared/ipc/schema/files';
import { REMOTE_UPLOAD_REFUSED_WORDS } from '@shared/ipc/schema/remote';
import { OPERATION_COMMANDS, type OperationCommand } from '@shared/engine/operations';
import { listenLoopback, type LocalListener } from '../forwards';
import type { MainContext, RemoteDispatch } from '../ipc/router';
import type { LayoutFileStore } from '../layout/store';
import type { LinkState } from '../machines/manager';
import { budgetedMs } from '../machines/budgets'; // U9 (M2): a fork's answer within its command's budget
import { peerLists } from '../machines/remote/capabilities';
import { needsProjectActs } from '../machines/project-acts-peer';
import { callOverLink, dispatchOverLink, refusalError } from '../machines/remote/dispatch';
import type { ActHandle, ActOutcome, RemoteLink } from '../machines/remote/link';
import { ArtifactMachines } from '../artifacts/machines';
import type { ClientWindowShown } from '../client/window-shown';
import type { ClientRef } from '@shared/ipc/client';
import { DOCUMENT_OPEN_MS } from '../artifacts/remote-open';
import { createRemoteArtifacts, type RemoteArtifacts } from './remote-artifacts';
import { createRemoteAttention, type RemoteAttention } from './remote-attention';
import { closeLease, createRemoteConnectors, MACHINE_CALLS, reportWindow, type MachineActOptions } from './remote-connectors';
import { createRemotePort, type CallbackServer, type CallbackHandler, type RemotePortTiming } from './remote-port';
import { createRemoteWindows } from './remote-windows';
import { createRemoteCheckout, WATCH_COMMANDS, type RemoteCheckoutTiming } from './remote-checkout';
import { readEventsInPages } from './remote-history';
import { createRemoteInterest } from './remote-interest';
import { outcomeAsResult, pendingResult, refusalResult } from './remote-outcomes';
import { RemoteSession, type RemoteSessionTiming } from './remote-session';
import { chooserTimings, openTiming, type ChooserRead, type OpenTiming } from './remote-timing';
import { createSpawnAttempts } from './remote-spawn';
import { readFileInPages } from './remote-files-read';
import { createRemoteForwards, REMOTE_FORWARDS_TIMING, type RemoteForwards, type RemoteForwardsTiming } from './remote-forward';
import { createRemotePty, PTY_NAMES, REMOTE_PTY_TIMING, type RemotePtyTiming } from './remote-pty';
import { uploadInParts } from './remote-upload';

export interface RemoteLaneBTiming extends RemoteSessionTiming, RemoteCheckoutTiming, RemotePtyTiming, RemoteForwardsTiming, Omit<RemotePortTiming, 'consentActMs'> {
  /** A closed tab's subscription outlives it this long. */
  unsubscribeLingerMs: number;
  /** An act answers the renderer by then: its outcome, or `timeout` with the pending words while it goes on querying. */
  sendPendingMs: number;
  /** Sends waiting behind the one in flight. */
  sendQueueMax: number;
  /** P5 O7 M4: a spawn answers by then from the moment it went out (after the sheet): the machine's own bound on it and a margin. */
  spawnPendingMs: number;
  /** M4c fix wave 2: how long a spawn's outcome no caller waited for is kept for the tab that asked (remote-spawn.ts). */
  spawnKeptMs: number;
  /** P5 O7 M5b: a document's open answers `timeout` when no stream opened by then (../artifacts/remote-open.ts). */
  documentOpenMs: number;
}

export const REMOTE_LANE_B_TIMING: RemoteLaneBTiming = {
  unsubscribeLingerMs: 10_000,
  recordRetryMs: [500, 1000, 2000, 4000],
  idleRetryMs: [1000, 30_000],
  // past the machine's park window (10 min by default) and its first tries: a try wakes a parked host (O5's audit)
  idleProbeMaxMs: 30 * 60_000,
  sendPendingMs: REMOTE_ACT_PENDING_MS, // shared with the renderer, whose waits are bounded above it
  sendQueueMax: 8,
  batchMax: 500,
  // the machine's own bound on a spawn (`session.spawn`'s command budget, 200 s: the configure gate, a git call, the
  // launch watchdog and a margin; src/services/command-budgets.ts) and ten seconds for the round trip
  spawnPendingMs: 210_000,
  // a day: a tombstone is a few bytes, and one let go too soon could let the tab's next Send start a second session
  spawnKeptMs: 24 * 60 * 60_000,
  feedRetryMs: [1000, 30_000],
  documentOpenMs: DOCUMENT_OPEN_MS, // P5 O7 M5b: a page's bound
  // P5 O7 M5c: a consent's listener from its act's acceptance, the machine's own bound on the flow and a round trip: a
  // Connect's owner action (OWNER_ACTION_DEADLINE_MS, 330 s, src/services/connectors/owner.ts: discovery, then the 120 s
  // callback wait from the flow's bind, which this side can't see), a sign-in's config and callback waits (CONFIG_MS and
  // CALLBACK_MS, 10 s and 5 min, src/services/connectors/sign-in.ts); remote-port.test.ts pins both against the services
  consentConnectMs: 330_000 + 1_000,
  consentSignInMs: 10_000 + 300_000 + 1_000,
  ...REMOTE_PTY_TIMING, // P5 O7 M3
  ...REMOTE_FORWARDS_TIMING,
};

export interface RemoteLaneBDeps {
  local: MachineRef;
  /** `main.tabs`: the addresses of RL2 machines are the interest. */
  layout: Pick<LayoutFileStore, 'get' | 'onChange'>;
  /** Machines.remote. */
  remote(machine: MachineRef): RemoteLink | null;
  /** Machines.onRemote: a link closed ends its sessions. */
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;
  /** emitFrom. */
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  /**
   * The lane the org rows list a machine's session in, or null for one they don't (yet): a tab of a lane A session is
   * O9's adapter's and is never placed here. A session not listed is taken as lane B (a session this app just resumed or
   * spawned may be listed later). `refresh` reads the tabs again once the rows changed.
   */
  laneOf?(machine: MachineRef, session: string): 'A' | 'B' | null;
  /** Board #525: whether the org rows list the machine's session as another member's (not the signed-in member's). */
  othersOf?(machine: MachineRef, session: string): boolean;
  /** P5 O7 M3: a forwarded port's local listener; src/main/forwards.ts's by default. */
  listen?(onConnection: (socket: Socket) => void): Promise<LocalListener>;
  /** P5 O7 M5a: which machine an artifact is on, written here alone (a table of its own by default). */
  artifactMachines?: ArtifactMachines;
  /** P5 O7 M5a: shell.openPath, for `remote.openCopy`'s copy (none opens without it). */
  openPath?(path: string): Promise<string>;
  /** P5 O7 M5a: where open copies go (os.tmpdir() by default). */
  tempDir?(): string;
  /** P5 O7 M5a: MAWS_E2E and MAWS_E2E_OPEN_LOG, the e2e's open seam. */
  env?: NodeJS.ProcessEnv;
  /** P5 O7 M5b: `new MessageChannelMain()`, a remote document's port pair (none opens without it). */
  docChannel?(): Pick<MessageChannelMain, 'port1' | 'port2'>;
  /** P5 O7 M5c: main's own `emit` (to every window, as main's word), which `connectors.reset {machine}` goes through. */
  emitOwn?(name: 'connectors.reset', payload: EventPayload<'connectors.reset'>): void;
  /** P5 O7 M5c: the window that shows a page (electronWindowShown), for the window report per machine; none shows any without it. */
  windowShown?(client: ClientRef): ClientWindowShown | null;
  /** P5 O7 M5c: a URL a machine's services asked this device to open (../open-external.ts's `openForMachine`); none opens without it. */
  openUrl?(url: string, machine: MachineRef): OpenAnswer;
  /** P5 O7 M5c: a consent's callback listener (./remote-port.ts's `listenCallback` by default). */
  listenCallback?(handle: CallbackHandler): Promise<CallbackServer>;
  timing?: Partial<RemoteLaneBTiming>;
  now?(): number;
  log(line: string): void;
}

export interface RemoteLaneB {
  /** Whether the adapter takes `name` for an RL2 machine: §L's lane B acts, the substitutes, the paged read and (M4) the checkout's watches. */
  handles(name: CommandName): boolean;
  dispatch(link: RemoteLink, name: CommandName, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>;
  /** The tabs read again: the org rows (`laneOf`) changed. */
  refresh(): void;
  /**
   * Says a held session's record, last parts and `remote.session` again, for a page that has just subscribed: the pane's
   * own `session.get` is that page's announcement (`routeLaneB`), made after it subscribed (C1's subscribe-then-read).
   */
  replay(machine: MachineRef, app: string): void;
  /** P5 O7 M3: `remote.forward.open` and `.close`, main's handlers' (Interfaces §K). */
  forward: {
    open(input: CommandInput<'remote.forward.open'>): Promise<CommandResult<'remote.forward.open'>>;
    close(input: CommandInput<'remote.forward.close'>): Promise<CommandResult<'remote.forward.close'>>;
    /** The in-app browser's reads of the listeners (src/main/browser/forwarded.ts). */
    listening: RemoteForwards['listening'];
    at: RemoteForwards['at'];
  };
  /** P5 O7 M6: every RL2 machine's attention, from its feed, for the badge and the notifier. */
  attention: Pick<RemoteAttention, 'machines' | 'machine' | 'onChange' | 'sayAgain'>;
  /** P5 O7 M5a: `remote.openCopy` (main's handler's) and a remote artifact's files for Save As (src/main/library/files.ts). */
  artifacts: Pick<RemoteArtifacts, 'openCopy' | 'files' | 'scheme' | 'assets'>; // P5 O7 M5b: scheme, assets
  /** Every subscription, feed, stream and forwarded port's listener closed: before the links, in the shutdown order. */
  stop(): void;
  /** M4c fix wave 2: the spawn attempts kept, by tab (tests): an act out, or its answer. */
  spawnsKept(): Array<{ key: string; state: 'out' | 'said' | 'unresolved' }>;
  /** The UX wave, U9 (M5): one of New chat's chooser reads of a machine answered (`routeLaneB` times them), for its timing line. */
  chooserRead(machine: MachineRef, read: ChooserRead, startedAt: number, answeredAt: number): void;
}

/** The engine-host acts §L offers for lane B, each sealed for the session's live launch. */
export const ENGINE_HOST_ACTS: ReadonlySet<CommandName> = new Set<CommandName>([
  'session.send', 'session.steer', 'session.interrupt', 'session.answer',
  'session.queue.edit', 'session.queue.promote', 'session.queue.setPaused', 'session.queue.hold', 'session.queue.remove',
  'session.setModel', 'session.setEffort', 'session.setThinking', 'session.setPermissionMode',
  'session.stopTask', 'session.sideQuestion', 'session.mcpToggle', 'session.mcpReconnect',
  'session.rewind', 'session.rewindFiles', 'session.forget', 'session.setKeep', 'session.generateTitle',
  'maws.ask.answer', 'side.question.clear', 'session.reloadPlugins', // P5 O7 M8 (§U)
  'session.steer.cancel', 'maws.pane.answer', // the UX wave (U9): behind `rl2.session-acts`; a pane's answer never resumes a session
]);
/** The `machine` acts §L offers for lane B: placed by their args (or, a spawn, on the machine), neither a session nor a context. */
export const MACHINE_ACTS: ReadonlySet<CommandName> = new Set<CommandName>([
  'session.acquire',
  // P5 O7 M4: the checkout's writes, an upload's parts and the spawn
  'files.write', 'files.upload', 'scm.stage', 'scm.unstage', 'scm.discard', 'scm.commit', 'scm.push', 'scm.pr.create', 'scm.remote.cancel',
  'session.spawn',
  // P5 O7 M5c: a page's two lease commands that run the owner's connector tools (`converse` by effect on the artifact);
  // Send to's send and cancel (`manage`); the owner's connections, sign-ins and grants (`machine-admin`, a step-up each)
  'connectors.call', 'connectors.refresh',
  'delivery.send', 'delivery.cancel',
  'connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect', 'connectors.signIn', 'connectors.signInCancel',
  'artifacts.grantConnectorTool', 'artifacts.revokeConnectorTool',
  'connectors.signInServer', // P5 O7 M8: the session's MCP widget's Sign in, the entry read on the machine
  'session.projects.addFolder', // P5 O7 M9: the remote setup's registration (`machine-admin`, the machine's owners')
  'session.projects.link', 'session.projects.relocate', 'session.projects.update', 'session.projects.remove', // the project registry (M9, §I's acts): the machine's owners' (`machine-admin`)
  'session.drafts.set', // P5 O8 M6a: the caller's own draft, kept per member on the machine (`converse`)
  // the UX wave (U9): behind `rl2.session-acts`; archive, unarchive and rename `manage`, a dismissal `converse`; M2: a fork
  // in place, the machine's owners', stepped up and answered within its command's budget, never through the spawn table
  'session.archive', 'session.update', 'session.rename', 'attention.acknowledge', 'session.fork',
]);
/**
 * The project registry (Interfaces §G, "Older peers"): what goes only to a machine whose RL2 handshake lists
 * `rl2.project-acts`. An older endpoint could pass by a field it does not know (`addFolder`'s `into`, `own`) and do a
 * plain add unsaid, so each is refused here before it goes, `not-offered`, as an older peer's missing offer reads.
 * `resolve` is the adapter's to send for that reason, as a call by name. The check at the command's start is not the
 * last: each act carries the capability as `requires` (judged at each transmission, so one waiting on Touch ID or resent
 * on the next channel follows that channel's peer), and `resolve` goes `oneChannel`, on the channel it was checked on.
 */
const PROJECT_CALLS: ReadonlySet<CommandName> = new Set<CommandName>(['session.projects.resolve']);
/**
 * The UX wave (U9; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §1): what `REMOTE_NEEDS`
 * names goes only to a machine whose handshake lists it. A current channel's peer that lacks it is refused here,
 * `not-offered`, nothing sent; with no channel current an act waits under the link's hold (no outbox, A4), carrying the
 * capability as `requires` for the channel it goes on to judge. The archived sessions' read (`session.list`) is the
 * adapter's to send for that reason, a call by name on the channel it was checked on.
 */
const SESSION_CALLS: ReadonlySet<CommandName> = new Set<CommandName>(['session.list']);
/** The capability an act carries as `requires`: the project registry's, else the one REMOTE_NEEDS names. */
const requiredBy = (name: CommandName, fields: Fields): string | undefined => (needsProjectActs(name, fields) ? PROJECT_ACTS_CAPABILITY : REMOTE_NEEDS[name]);
// `needsProjectActs` (../machines/project-acts-peer.ts) names what needs the capability; this Mac's daemon is checked by it too
/** Acts the endpoint always asks a step-up of, signed before the first copy goes (no round trip to be asked). */
const STEPPED_UP: ReadonlySet<CommandName> = new Set<CommandName>(['session.projects.addFolder', 'session.projects.link', 'session.projects.relocate', 'session.fork']);
/**
 * The UX wave (U9, M2): `machine` acts whose work on the machine outlasts the pending bound, answered up to their
 * command's budget past it (`answerMs`): a fork answers once its setup reached `launching`, as a spawn's bound has it.
 */
const BUDGETED_ACTS: ReadonlySet<CommandName> = new Set<CommandName>(['session.fork']);
// P5 O7 M5c ("O4's surfaces: the grade"): the six lease reads, sent as calls by name (./remote-connectors.ts)
export { MACHINE_CALLS } from './remote-connectors';
/** Reads the pane makes that no row offers, answered here from one that is. */
export const SUBSTITUTES: ReadonlySet<CommandName> = new Set<CommandName>(['attention.request', 'engine.models']);
/** Reads offered as calls that the adapter makes in pages the channel carries (./remote-history.ts). */
export const PAGED_READS: ReadonlySet<CommandName> = new Set<CommandName>(['session.events', 'files.read']); // files.read: M4's milestone review
/**
 * P5 O7 M8: calls the adapter gives a target before they go (`fs.tasks`' session, `fs.unfollow`'s agents), and the
 * follows it keeps track of for them (`fs.agentEvents`, m8-3's task review).
 */
export const TARGETED_CALLS: ReadonlySet<CommandName> = new Set<CommandName>(['fs.tasks', 'fs.unfollow', 'fs.agentEvents']);
const SENDS: ReadonlySet<CommandName> = new Set<CommandName>(['session.send', 'session.steer']);
const OPERATIONS: ReadonlySet<string> = new Set<string>(OPERATION_COMMANDS);
export const NOT_OPEN = 'open the session to drive it';
/** The remote drill-in: `fs.agentEvents` takes no byte budget, so an agent's disk window past the channel's bound can't cross. */
export const AGENT_TOO_LARGE = (machine: string) => `This agent’s transcript on ${machine} is too large to show here yet`;

// ---- harness: a stand-in for another machine's acts ---------------------------------------------------------------------
// The project registry's e2e (src/main/org/registry-fixture.ts, M11): a harness build's fixture answers some commands
// for machines that are not there, ahead of every link, step-up and send, as C5's `interceptCommand` answers a command
// for this Mac. Only a harness build's main installs one (app.ts's guard on `__MAWS_HARNESS_BUILD__`); otherwise none is
// set and `routeLaneB` is as before.
/** Answers a command for another machine, or undefined to leave it to the link. */
export type MachineStandIn = (machine: MachineRef, name: CommandName, input: unknown) => CommandResult<CommandName> | undefined;
let machineStandIn: MachineStandIn | null = null;
/** Installs the stand-in (one at a time); returns its removal. */
export function standInForMachines(standIn: MachineStandIn): () => void {
  if (machineStandIn !== null) throw new Error('a machine stand-in is already installed');
  machineStandIn = standIn;
  return () => {
    if (machineStandIn === standIn) machineStandIn = null;
  };
}

/**
 * The router's `remote`: a name the adapter handles, for a machine `remote` answers, goes to it; everything else to
 * `base`; `session.search` refused `not-offered` (an endpoint older than M6) is answered `host_unavailable`. A `session.get` of an RL2 machine's session is a pane's opening read, after its page subscribed: once answered,
 * the adapter says that session's state again, so a reloaded page or a second window has what was said before it listened.
 */
export function routeLaneB(base: RemoteDispatch, remote: (machine: MachineRef) => RemoteLink | null, laneB: RemoteLaneB): RemoteDispatch {
  const routed: RemoteDispatch = async (machine, name, input, ctx) => {
    const stood = machineStandIn?.(machine, name, input); // a harness build's fixture alone (above)
    if (stood !== undefined) return stood;
    const link = laneB.handles(name) ? remote(machine) : null;
    if (link !== null) return laneB.dispatch(link, name, input, ctx);
    const result = await base(machine, name, input, ctx);
    const app = (input as { appSessionId?: unknown } | null | undefined)?.appSessionId;
    if (name === 'session.get' && typeof app === 'string' && remote(machine) !== null) laneB.replay(machine, app);
    // P5 O7 M6 fix wave 1: an endpoint older than M6 offers no search; to the renderer's merge it is a machine left out, as
    // an offline one is
    if (name === 'session.search' && !result.ok && (result.error.issues as { refusal?: unknown } | undefined)?.refusal === 'not-offered' && remote(machine) !== null) {
      return { ok: false, error: ipcError('host_unavailable', `session.search: machine ${remote(machine)!.name} offers no search`) };
    }
    return result;
  };
  // the UX wave, U9 (M5): New chat's chooser reads a machine's projects and its home's first page together
  return async (machine, name, input, ctx) => {
    const read = chooserReadOf(name, input);
    if (read === null || remote(machine) === null) return routed(machine, name, input, ctx);
    const startedAt = Date.now();
    const result = await routed(machine, name, input, ctx);
    laneB.chooserRead(machine, read, startedAt, Date.now());
    return result;
  };
}

/** The read of New chat's chooser a command is (its projects, or its home's first page of folders), or null. */
function chooserReadOf(name: CommandName, input: unknown): ChooserRead | null {
  if (name === 'session.projects.list') return name;
  if (name !== 'machine.folders.list') return null;
  const fields = record(input) ?? {};
  return fields.path === undefined && fields.cursor === undefined && fields.open === undefined ? name : null;
}

type Fields = Record<string, unknown>;
type Send = { name: CommandName; fields: Fields; resolve(result: CommandResult<CommandName>): void };
/** One session's lane: its fold, whether a tab holds it, its sends, and the resume out for it. */
type Lane = { session: RemoteSession; open: boolean; sends: Send[]; sending: boolean; acquiring: Promise<CommandResult<CommandName>> | null };
type Context = { launchId: string; engineSessionId: string };

const record = (value: unknown): Fields | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null);
const failure = (code: IpcErrorCode, message: string, issues?: unknown): CommandResult<CommandName> => ({ ok: false, error: ipcError(code, message, issues) });
/** m8-3 review (C, round 2): a session's agent follows this device holds, and its agent reads still out (each may hold one). */
type Follows = { followed: Set<string>; reading: Map<Promise<unknown>, string> };
const withoutUploads = (fields: Fields): Fields => Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'uploads'));

export function createRemoteLaneB(deps: RemoteLaneBDeps): RemoteLaneB {
  const timing: RemoteLaneBTiming = { ...REMOTE_LANE_B_TIMING, ...deps.timing };
  const now = deps.now ?? Date.now;
  const machines = new Map<MachineRef, { link: RemoteLink; lanes: Map<string, Lane> }>();
  let revision = 0;
  const sessionOf = (machine: MachineRef, app: string) => machines.get(machine)?.lanes.get(app)?.session;
  // P5 O7 M6: one machine-wide attention feed per link; once it is fed (fix wave 5), the sessions' streams say no attention of
  // their own, and when it stops (no feed on the channel) they say theirs again (fix wave 1)
  const attention = createRemoteAttention({
    remote: deps.remote,
    onRemote: deps.onRemote,
    emit: deps.emit,
    timing,
    unfed: (machine) => {
      for (const lane of machines.get(machine)?.lanes.values() ?? []) lane.session.replayAttention();
    },
    streamItems: (machine) => [...(machines.get(machine)?.lanes.values() ?? [])].flatMap((lane) => lane.session.attentionItems()), // fix wave 3
    log: deps.log,
  });
  const checkout = createRemoteCheckout({
    remote: deps.remote,
    emit: deps.emit,
    timing,
    recordChanged: (machine, app, record) => sessionOf(machine, app)?.recordChanged(record),
    following: (machine, app) => sessionOf(machine, app)?.kick(),
    unfollowed: (machine, app) => sessionOf(machine, app)?.unfollowed(),
    log: deps.log,
  });
  /**
   * m8-3's task review (C): the agents this device follows per session, by link (each `fs.agentEvents` answered starts or
   * holds one, held by this device's channel on the machine), so a session-wide unfollow lets go of these alone.
   */
  const follows = new Map<RemoteLink, Map<string, Follows>>();
  /** Each session's upload in flight (machine and session): the next waits for it. */
  const uploads = new Map<string, Promise<unknown>>();
  /** P5 O7 M4: each New chat tab's spawn, kept by the tab it is made from (remote-spawn.ts). */
  const spawns = createSpawnAttempts({ now, log: deps.log, pendingMs: timing.spawnPendingMs, tombstoneMs: timing.spawnKeptMs, bounded: (handle, deadline) => bounded(handle, deadline) });
  // P5 O7 M3: terminals and forwarded ports
  const ptys = createRemotePty({ remote: deps.remote, emit: deps.emit, bounded: (handle, deadline) => bounded(handle, deadline), pendingMs: timing.sendPendingMs, timing, now, log: deps.log });
  const forwards = createRemoteForwards({ remote: deps.remote, listen: deps.listen ?? listenLoopback, bounded: (handle, deadline) => bounded(handle, deadline), pendingMs: timing.sendPendingMs, timing, now, log: deps.log });
  // P5 O7 M5c: the client port's answers and the consents' listeners; the window report per machine; the leases' gate
  const port = createRemotePort({
    remote: deps.remote,
    onRemote: deps.onRemote,
    openUrl: deps.openUrl ?? (() => ({ opened: false, reason: 'opening a URL is not wired in this process' })),
    ...(deps.listenCallback !== undefined && { listen: deps.listenCallback }),
    timing: { consentConnectMs: timing.consentConnectMs, consentSignInMs: timing.consentSignInMs, consentActMs: timing.sendPendingMs },
    log: deps.log,
  });
  const windows = createRemoteWindows({ windowShown: deps.windowShown ?? (() => null), report: reportWindow, close: (link, leaseId) => closeLease(link, leaseId, deps.log), log: deps.log });
  const connectors = createRemoteConnectors({
    remote: deps.remote,
    onRemote: deps.onRemote,
    emitOwn: deps.emitOwn ?? (() => {}),
    windows,
    port,
    act: (link, name, fields, options) => machineAct(link, name, fields, now() + timing.sendPendingMs, options),
    log: deps.log,
  });
  // P5 O7 M5a: artifacts
  const artifacts = createRemoteArtifacts({
    remote: deps.remote,
    onRemote: deps.onRemote,
    emit: deps.emit,
    machines: deps.artifactMachines ?? new ArtifactMachines(),
    bounded: (handle, deadline) => bounded(handle, deadline),
    pendingMs: timing.sendPendingMs,
    feedRetryMs: timing.feedRetryMs,
    ...(deps.docChannel !== undefined && { docChannel: deps.docChannel }),
    documentOpenMs: timing.documentOpenMs,
    heard: (machine, name, payload) => port.heard(machine, name, payload), // P5 O7 M5c: a consent's flow's end
    openPath: deps.openPath ?? (async () => 'opening a copy is not wired in this process'),
    ...(deps.tempDir !== undefined && { tempDir: deps.tempDir }),
    env: deps.env ?? {},
    now,
    log: deps.log,
  });

  // ---- Lanes, the tabs and the links -------------------------------------------------------------------------------------

  /** The machine's lanes under `link`; a new link for the machine (its roster entry made again) ends what the old one carried. */
  // P5 O15 M2b: each session's count of its stream's answers, kept across its records (a new link makes them again)
  const answerCounts = new Map<string, number>();
  const countAnswer = (machine: MachineRef, app: string): number => {
    const n = (answerCounts.get(`${machine}/${app}`) ?? 0) + 1;
    answerCounts.set(`${machine}/${app}`, n);
    return n;
  };

  function lanesOf(link: RemoteLink): Map<string, Lane> {
    const held = machines.get(link.machine);
    if (held !== undefined && held.link === link) return held.lanes;
    if (held !== undefined) for (const [app, lane] of held.lanes) end(link.machine, app, lane, 'closed');
    const lanes = new Map<string, Lane>();
    machines.set(link.machine, { link, lanes });
    roundOf(link, false); // the machine's first lane: the lane's start evaluates
    return lanes;
  }

  // ---- The settled word (the UX wave, U9, M5) ------------------------------------------------------------------------------

  /** One machine's round: its link, the state last read, and the generation settling or settled. */
  type Round = { link: RemoteLink; state: LinkState | null; settling: number | null; settled: number | null; off(): void };
  const rounds = new Map<MachineRef, Round>();
  /** Each machine's `up`s in this run, by its ref and never reset, as the roster's `generation` counts them. */
  const ups = new Map<MachineRef, number>();

  /** The machine's round under `link`; a link made again goes on counting the machine's `up`s. */
  function roundOf(link: RemoteLink, evaluateNow: boolean): Round {
    const held = rounds.get(link.machine);
    if (held?.link === link) return held;
    held?.off();
    const round: Round = { link, state: null, settling: null, settled: null, off: () => {} };
    rounds.set(link.machine, round);
    round.off = link.onState(() => roundMoved(round, true));
    roundMoved(round, evaluateNow);
    return round;
  }

  function roundMoved(round: Round, evaluateNow: boolean): void {
    const state = round.link.state();
    if (state === round.state) return; // a carrier or a refusal moved: the same generation
    const was = round.state;
    round.state = state;
    const machine = round.link.machine;
    if (state === 'up') {
      const generation = (ups.get(machine) ?? 0) + 1;
      ups.set(machine, generation);
      round.settling = generation;
      round.settled = null;
      for (const app of machines.get(machine)?.lanes.keys() ?? []) opens.get(`${machine}/${app}`)?.up();
      if (evaluateNow) settleRound(round);
      return;
    }
    if (was !== 'up') return;
    // main's word of the loss: a subscription kept across it awaits its next answer, before any `up` can be evaluated
    const held = machines.get(machine);
    if (held?.link === round.link) for (const lane of held.lanes.values()) lane.session.lost();
    round.settling = null;
    round.settled = null;
  }

  /** The round settles once no lane of its machine is placing or awaiting: said once for its generation. */
  function settleRound(round: Round): void {
    if (round.settling === null || rounds.get(round.link.machine) !== round) return;
    const held = machines.get(round.link.machine);
    if (held?.link === round.link) {
      for (const lane of held.lanes.values()) {
        const standing = lane.session.standing();
        if (standing === 'placing' || standing === 'awaiting') return;
      }
    }
    round.settled = round.settling;
    round.settling = null;
    deps.emit(round.link.machine, 'remote.settled', { machine: round.link.machine, generation: round.settled });
  }

  /** A lane's standing changed (told after what it said for it): its record had, for the open's line; its machine's round. */
  function standingChanged(machine: MachineRef, app: string): void {
    if (sessionOf(machine, app)?.state.record != null) opens.get(`${machine}/${app}`)?.record();
    const round = rounds.get(machine);
    if (round !== undefined) settleRound(round);
  }

  /** The UX wave, U9 (M5): each remote tab's open, from the moment its interest opened the session, for its timing line. */
  const opens = new Map<string, OpenTiming>();
  const chooser = chooserTimings(deps.log);

  function open(machine: MachineRef, app: string): void {
    const link = deps.remote(machine);
    if (link === null) return;
    const lanes = lanesOf(link);
    let lane = lanes.get(app);
    if (lane === undefined) {
      const session = new RemoteSession({
        machine,
        app,
        link,
        emit: deps.emit,
        timing,
        revision: () => (revision = Math.max(revision + 1, now())),
        subscribed: () => checkout.open(link, app), // P5 O7 M4: the checkout feed beside the stream
        followed: () => checkout.follows(machine, app), // its record, which an idle stream waits for
        attentionFed: () => attention.fed(machine), // fix waves 1, 5: the feed's items are the session's attention once fed
        attentionChanged: () => attention.streamsChanged(machine, app), // fix wave 4: the badge and the notifier hear them
        othersSession: () => deps.othersOf?.(machine, app) ?? false, // board #525: a refused read is a reader's grade only there
        nextAnswer: () => countAnswer(machine, app), // P5 O15 M2b
        standingChanged: () => standingChanged(machine, app), // the UX wave, U9 (M5): the settled word
        log: deps.log,
      });
      lanes.set(app, (lane = { session, open: false, sends: [], sending: false, acquiring: null }));
      opens.set(`${machine}/${app}`, openTiming(link.name, app, link.state() === 'up', now, deps.log));
    }
    lane.open = true;
    lane.session.start();
  }

  /** A lane's stream and feed closed, said as `ended` when given. */
  function end(machine: MachineRef, app: string, lane: Lane, ended?: string): void {
    lane.session.stop(ended);
    checkout.close(machine, app);
  }

  function close(machine: MachineRef, app: string): void {
    const lanes = machines.get(machine)?.lanes;
    const lane = lanes?.get(app);
    if (lane === undefined) return;
    lane.open = false;
    end(machine, app, lane);
    forget(machine, app, lane);
  }

  /** A lane no tab holds and with no send out is let go. */
  function forget(machine: MachineRef, app: string, lane: Lane): void {
    if (lane.open || lane.sending || lane.sends.length > 0) return;
    const lanes = machines.get(machine)?.lanes;
    if (lanes?.get(app) !== lane) return;
    lanes.delete(app);
    opens.delete(`${machine}/${app}`);
    const round = rounds.get(machine);
    if (round !== undefined) settleRound(round); // a lane let go waits for nothing
    if (lane.session.attentionItems().length > 0) attention.streamsChanged(machine, app); // fix wave 4: its items leave the streams'
  }

  const interest = createRemoteInterest({
    layout: deps.layout,
    local: deps.local,
    isRemote: (machine) => deps.remote(machine) !== null,
    isLaneA: (machine, session) => deps.laneOf?.(machine, session) === 'A',
    lingerMs: timing.unsubscribeLingerMs,
    open,
    close,
  });
  const offRemote = deps.onRemote((refs) => {
    for (const link of [...follows.keys()]) if (deps.remote(link.machine) !== link) follows.delete(link);
    spawns.linksChanged(deps.remote); // M4c fix wave 2: a spawn out on a link that ended can't be known
    ptys.linksChanged(); // P5 O7 M3: a terminal or a forward on a link that ended ends
    forwards.linksChanged();
    for (const [machine, { link, lanes }] of [...machines]) {
      if (deps.remote(machine) === link) continue;
      for (const [app, lane] of lanes) end(machine, app, lane, 'closed');
      machines.delete(machine);
    }
    // the UX wave, U9 (M5): a round per machine the roster lists, a machine with no lane at all included
    for (const [machine, round] of [...rounds]) {
      if (refs.includes(machine) && deps.remote(machine) !== null) continue; // its link, or the one made again below
      round.off();
      rounds.delete(machine);
    }
    for (const machine of refs) {
      const link = deps.remote(machine);
      if (link !== null) roundOf(link, true);
    }
    interest.refresh();
  });

  // ---- Acts ----------------------------------------------------------------------------------------------------------------

  /** The outcome, or `pending` at `deadline` once a copy of the act went out (one never sent waits for the link's hold). */
  function bounded(handle: ActHandle, deadline: number): Promise<ActOutcome | 'pending'> {
    return new Promise((resolve) => {
      let off = () => {};
      const timer = setTimeout(() => {
        if (handle.progress() !== 'waiting') return resolve('pending');
        off = handle.onProgress((progress) => {
          if (progress !== 'waiting') resolve('pending');
        });
      }, Math.max(0, deadline - now()));
      void handle.outcome.then((outcome) => {
        clearTimeout(timer);
        off();
        resolve(outcome);
      });
    });
  }

  async function settle(link: RemoteLink, name: CommandName, handle: ActHandle, deadline: number, what: string): Promise<CommandResult<CommandName>> {
    const outcome = await bounded(handle, deadline);
    if (outcome !== 'pending') return outcomeAsResult(name, link.name, outcome);
    deps.log(`lane B: ${name} on ${link.name}/${what} (${handle.opId}) unconfirmed at the pending bound; still querying`);
    void handle.outcome.then((late) => deps.log(`lane B: ${name} on ${link.name}/${what} (${handle.opId}) settled late: ${late.state}${'reason' in late ? ` ${late.reason}` : ''}`));
    return pendingResult(name, link.name);
  }

  /**
   * A `machine` act: placed by its args, no session, no context. A ready resume subscribes an idle session at once. P5 O7
   * M5c: one that names what only its channel holds goes `oneChannel`; one whose work outlasts the pending bound is answered
   * up to `answerMs` past it (its command's budget on the machine).
   */
  async function machineAct(link: RemoteLink, name: CommandName, fields: Fields, deadline: number, options: MachineActOptions = {}): Promise<CommandResult<CommandName>> {
    const handle = link.act({
      action: name,
      args: fields,
      executor: 'machine',
      sendBy: deadline,
      ...(options.oneChannel === true ? { oneChannel: true as const } : {}),
      ...(STEPPED_UP.has(name) ? { stepUp: 'required' as const } : {}),
      ...(requiredBy(name, fields) === undefined ? {} : { requires: requiredBy(name, fields) }), // judged at each transmission
    });
    options.onHandle?.(handle);
    const result = await settle(link, name, handle, deadline + (options.answerMs ?? 0), String(fields.appSessionId ?? fields.artifactId ?? ''));
    if (name === 'session.acquire' && result.ok && record(result.value)?.status === 'ready') machines.get(link.machine)?.lanes.get(String(fields.appSessionId))?.session.kick();
    return result;
  }

  /** `files.upload` in parts, after any upload to the same session before it (P5 O7 M4, "Uploads in parts"). */
  function upload(link: RemoteLink, fields: Fields): Promise<CommandResult<CommandName>> {
    const input = fields as unknown as FilesUploadInput;
    const key = `${link.machine}\n${input.appSessionId}`;
    const before = uploads.get(key) ?? Promise.resolve();
    const run = before.then(() =>
      uploadInParts(input, {
        part: (args) => machineAct(link, 'files.upload', args as unknown as Fields, now() + timing.sendPendingMs),
        progress: (file, name, sent, parts) => deps.emit(link.machine, 'remote.upload', { appSessionId: input.appSessionId, file, name, sent, parts }),
      }),
    );
    const settled = run.then(
      () => {},
      () => {},
    );
    uploads.set(key, settled);
    void settled.then(() => {
      if (uploads.get(key) === settled) uploads.delete(key);
    });
    return run;
  }

  /** The session resumed and its live context, or why not. */
  async function resumed(link: RemoteLink, app: string, lane: Lane, deadline: number): Promise<Context | CommandResult<CommandName>> {
    if (lane.acquiring === null) {
      const acquiring = machineAct(link, 'session.acquire', { appSessionId: app, reason: 'send' }, deadline);
      lane.acquiring = acquiring;
      void acquiring.then(() => {
        if (lane.acquiring === acquiring) lane.acquiring = null;
      });
    }
    const acquired = await lane.acquiring;
    if (!acquired.ok) return acquired;
    const status = record(acquired.value)?.status;
    if (status !== 'ready') return failure('internal', `${link.name} couldn’t resume the session (${String(status)}); nothing was sent`, { refusal: status });
    const context = await lane.session.whenContext(deadline, now);
    return context ?? failure('host_unavailable', `Not sent: ${link.name} didn’t resume the session in time`);
  }

  /** An engine-host act on the session's live launch, resuming it first when it has none. */
  async function engineAct(link: RemoteLink, lane: Lane, name: CommandName, fields: Fields, deadline: number): Promise<CommandResult<CommandName>> {
    const app = lane.session.state.app;
    let context = lane.session.context();
    const resuming = context === null;
    // U9: a pane's request died with the launch that asked it, so its answer resumes nothing and acquires nothing
    if (context === null && name === 'maws.pane.answer') return failure('internal', `${name}: the pane’s request ended with its session’s launch on ${link.name}`, { refusal: 'not-live' });
    if (context === null) {
      // A launch already on its way is waited for; one that ended (its row kept, `exited`) or none is resumed first.
      const resume = lane.session.launching()
        ? ((await lane.session.whenContext(deadline, now)) ?? failure('host_unavailable', `Not sent: ${link.name} didn’t resume the session in time`))
        : await resumed(link, app, lane, deadline);
      if ('ok' in resume) return resume;
      context = resume;
    }
    let requestDigest: NonNullable<ReturnType<typeof requestDigestOf>> | undefined;
    if (name === 'session.answer') {
      const read = await dispatchOverLink(link, 'session.pendingRequest', { appSessionId: app, requestId: fields.requestId });
      if (!read.ok) return read;
      const event = (read.value as { event: SessionEvent | null }).event;
      if (event === null) return { ok: true, value: { outcome: 'not_pending' } } as CommandResult<CommandName>;
      const digest = requestDigestOf(app, event);
      if (digest === null) return failure('internal', `${name}: the request on ${link.name} has no digest to answer it by`);
      requestDigest = digest;
    }
    // One bound from the act's turn: what the resume (or the request's read) spent is not given back, so an act made at
    // the deadline is not made, and one made before it goes out by it or not at all (`sendBy`: no outbox, A4).
    if (now() >= deadline) return resuming ? failure('host_unavailable', `Not sent: ${link.name} didn’t resume the session in time`) : outcomeAsResult(name, link.name, { state: 'refused', reason: 'offline' });
    // P5 O7 M8: a send's uploads only to an endpoint that reads them. A channel current now that lists none takes the
    // mention alone; with none current (m8-3's task review, D) the act carries them and `requires` the capability, so the
    // channel it goes on judges it, and one an older peer refused as not offered (nothing ran) goes again without them;
    // a not-offered from a peer that lists the capability is the send's own error.
    const uploads = name === 'session.send' && fields.uploads !== undefined;
    const blocks = uploads && (link.peerCapabilities() === null || peerLists(link, 'rl2.upload-blocks'));
    if (uploads && !blocks) deps.log(`lane B: session.send on ${link.name}/${app}: its endpoint lists no rl2.upload-blocks; the uploads go as their mentions alone`);
    const since = lane.session.openings(); // the opening the act is made under: a receipt heard after a later one is asked of the machine
    const needs = REMOTE_NEEDS[name]; // U9: judged at each transmission, as the uploads' capability is
    const make = (args: Fields, requires: boolean) =>
      settle(link, name, link.act({ action: name, session: app, context: { lane: 'B', ...context }, args, executor: 'engine-host', sendBy: deadline, ...(requestDigest !== undefined && { requestDigest }), ...(requires ? { requires: 'rl2.upload-blocks' } : needs !== undefined ? { requires: needs } : {}) }), deadline, app);
    let result = await make(blocks || !uploads ? fields : withoutUploads(fields), blocks);
    const refusal = result.ok ? null : (result.error.issues as { refusal?: unknown } | undefined)?.refusal;
    // m8-3 review round 2: only when the channel it went on lists no `rl2.upload-blocks`; any other not-offered is the send's error
    if (blocks && refusal === 'not-offered' && link.peerCapabilities() !== null && !peerLists(link, 'rl2.upload-blocks') && now() < deadline) {
      deps.log(`lane B: session.send on ${link.name}/${app}: the channel it went on lists no rl2.upload-blocks; sent again with the uploads as their mentions alone`);
      result = await make(withoutUploads(fields), false);
    } else if (blocks && refusal === 'malformed') return failure('invalid_input', REMOTE_UPLOAD_REFUSED_WORDS, { refusal: 'malformed', uploads: 'refused' });
    const opId = result.ok && OPERATIONS.has(name) ? record(result.value)?.opId : undefined;
    if (typeof opId === 'string') lane.session.awaitOperation(opId, name as OperationCommand, since);
    return result;
  }

  /**
   * P5 O7 M8: `fs.tasks` naming its session; `fs.unfollow` for a named agent, the session-wide one (m8-3's task review)
   * as one per agent this device follows there, since the machine stops every client's follows for it; each a call.
   */
  async function targeted(link: RemoteLink, name: CommandName, fields: Fields, ctx: MainContext): Promise<CommandResult<CommandName>> {
    const app = String(fields.appSessionId);
    const of = () => {
      const bySession = follows.get(link) ?? new Map<string, Follows>();
      follows.set(link, bySession);
      const held = bySession.get(app) ?? { followed: new Set<string>(), reading: new Map<Promise<unknown>, string>() };
      bySession.set(app, held);
      return held;
    };
    if (name === 'fs.agentEvents') {
      const reading = dispatchOverLink(link, name, fields, ctx.session);
      const agentId = typeof fields.agentId === 'string' ? fields.agentId : null;
      if (agentId !== null) of().reading.set(reading, agentId);
      const result = await reading;
      of().reading.delete(reading);
      // the remote drill-in (2026-11-06): an answer past the channel's bound was refused after the machine took the hold
      const tooLarge = !result.ok && (result.error.issues as { refusal?: unknown } | undefined)?.refusal === 'too-large';
      if ((result.ok || tooLarge) && agentId !== null) of().followed.add(agentId);
      if (tooLarge) return failure('internal', AGENT_TOO_LARGE(link.name), { refusal: 'too-large' });
      return result;
    }
    if (name === 'fs.unfollow') {
      let agents: string[];
      if (typeof fields.agentId === 'string') agents = [fields.agentId];
      else {
        // m8-3 review round 2: a read still out may hold its follow already (the machine takes the hold before it
        // answers), so the reads made before this one are waited for and their agents let go of too, answered or not
        const out = [...of().reading];
        await Promise.allSettled(out.map(([reading]) => reading));
        // each is possibly followed from here, kept until its own unfollow succeeds (m8-3 review round 3)
        for (const [, agentId] of out) of().followed.add(agentId);
        agents = [...of().followed];
      }
      for (const agentId of agents) {
        const result = await dispatchOverLink(link, name, { appSessionId: app, agentId });
        if (!result.ok) return result;
        of().followed.delete(agentId);
      }
      return { ok: true, value: undefined } as CommandResult<CommandName>;
    }
    const listId = String(fields.listId);
    const session = typeof fields.appSessionId === 'string' ? fields.appSessionId : (ctx.session ?? [...lanesOf(link).values()].find((lane) => lane.session.taskList() === listId)?.session.state.app);
    if (session === undefined) return failure('internal', `fs.tasks: no open session on ${link.name} has the task list ${listId}`, { refusal: 'no-target' });
    return dispatchOverLink(link, name, { ...fields, appSessionId: session });
  }


  /** The session's sends, one at a time: the next act is made only at the one before's answer. */
  async function pump(link: RemoteLink, lane: Lane): Promise<void> {
    if (lane.sending) return;
    lane.sending = true;
    try {
      for (let head = lane.sends[0]; head !== undefined; head = lane.sends[0]) {
        lane.session.state.sends = lane.sends.length - 1;
        head.resolve(await engineAct(link, lane, head.name, head.fields, now() + timing.sendPendingMs));
        lane.sends.shift();
      }
    } finally {
      lane.sending = false;
      lane.session.state.sends = 0;
      forget(link.machine, lane.session.state.app, lane);
    }
  }

  function send(link: RemoteLink, lane: Lane, name: CommandName, fields: Fields): Promise<CommandResult<CommandName>> {
    if (lane.sends.length - (lane.sending ? 1 : 0) >= timing.sendQueueMax) return Promise.resolve(failure('internal', `${name}: too many messages waiting for ${link.name}`, { refusal: 'busy' }));
    return new Promise((resolve) => {
      lane.sends.push({ name, fields, resolve });
      void pump(link, lane);
    });
  }

  // ---- The substitutes -------------------------------------------------------------------------------------------------------

  /** `engine.models` from a live session on the machine, the one in the asked directory first. */
  async function models(link: RemoteLink, fields: Fields): Promise<CommandResult<CommandName>> {
    const live = [...lanesOf(link).values()].filter((lane) => lane.session.context() !== null);
    const directory = (lane: Lane) => [lane.session.state.status?.cwd, lane.session.state.record?.directory];
    const chosen = live.find((lane) => fields.cwd !== undefined && directory(lane).includes(fields.cwd)) ?? live[0];
    if (chosen !== undefined) {
      const read = await dispatchOverLink(link, 'session.listModels', { appSessionId: chosen.session.state.app });
      const listed = read.ok ? record(read.value)?.models : undefined;
      if (Array.isArray(listed)) return validateCommandOutput('engine.models', { models: listed, source: 'live', at: new Date(now()).toISOString() }) as CommandResult<CommandName>;
      deps.log(`lane B: engine.models on ${link.name}: session.listModels of ${chosen.session.state.app} didn’t answer; the built-in list`);
    }
    return { ok: true, value: { models: [...BUILTIN_MODELS], source: 'builtin', at: null } } as CommandResult<CommandName>;
  }

  async function run(link: RemoteLink, name: CommandName, fields: Fields, ctx: MainContext): Promise<CommandResult<CommandName>> {
    const deadline = now() + timing.sendPendingMs;
    if (needsProjectActs(name, fields)) {
      const peers = link.peerCapabilities();
      if (peers === null) return failure('host_unavailable', `${name}: machine ${link.name} is not reachable`);
      if (!peers.includes(PROJECT_ACTS_CAPABILITY)) return refusalError(name, link.name, { code: 'not-offered' });
      // only on the channel checked: one that ends fails it `offline`, never carried to the next channel's peer unchecked
      if (PROJECT_CALLS.has(name)) return callOverLink(link, name, fields, { oneChannel: true });
    }
    const needs = REMOTE_NEEDS[name];
    if (needs !== undefined) {
      const peers = link.peerCapabilities();
      if (peers !== null && !peers.includes(needs)) return refusalResult(name, link.name, 'not-offered');
      if (SESSION_CALLS.has(name)) return peers === null ? failure('host_unavailable', `${name}: machine ${link.name} is not reachable`) : callOverLink(link, name, fields, { oneChannel: true });
    }
    if (artifacts.handles(name)) return artifacts.dispatch(link, name, fields, ctx.client); // P5 O7 M5a; M5b: the window a document opens in
    if (PTY_NAMES.has(name)) return ptys.dispatch(link, name, fields);
    if (WATCH_COMMANDS.has(name)) return checkout.dispatch(link, name, fields, ctx);
    if (name === 'files.upload') return upload(link, fields);
    // the tab it is made from (the envelope's session), and the page asking: an answer to a page gone isn't taken
    if (name === 'session.spawn') return spawns.spawn(link, fields, ctx.session, ctx.client);
    if (name === 'attention.request') return dispatchOverLink(link, 'session.pendingRequest', { appSessionId: fields.appSessionId, requestId: fields.requestId });
    if (name === 'engine.models') return models(link, fields);
    if (name === 'files.read') return readFileInPages(link, fields, deps.log); // an answer past the channel, in ranged reads
    if (name === 'session.events') {
      const app = String(fields.appSessionId);
      const opened = fields.before === undefined && fields.seek === undefined ? opens.get(`${link.machine}/${app}`) : undefined; // M5: the open's history read
      opened?.asked();
      const read = await readEventsInPages(link, fields, {
        budget: peerLists(link, 'rl2.events-budget'), // P5 O7 M4: the architect's ruling, the field only to a peer that reads it
        launch: () => lanesOf(link).get(app)?.session.state.launch ?? null,
        gap: (launchId, at) => deps.emit(link.machine, 'remote.gap', { appSessionId: app as EventPayload<'remote.gap'>['appSessionId'], launchId, at }),
        tooLarge: (window) => deps.emit(link.machine, 'remote.historyTooLarge', { appSessionId: app as EventPayload<'remote.historyTooLarge'>['appSessionId'], window }),
        log: deps.log,
      });
      if (read.ok) opened?.rows();
      return read;
    }
    if (connectors.handles(name)) return connectors.dispatch(link, name, fields, ctx.client); // P5 O7 M5c
    if (MACHINE_CALLS.has(name)) return callOverLink(link, name, fields); // P5 O7 M9: the remote setup's two reads
    if (TARGETED_CALLS.has(name)) return targeted(link, name, fields, ctx); // P5 O7 M8
    if (BUDGETED_ACTS.has(name)) return machineAct(link, name, fields, deadline, { answerMs: budgetedMs(link.budgets, name) ?? 0 });
    if (MACHINE_ACTS.has(name)) return machineAct(link, name, fields, deadline);
    const lane = lanesOf(link).get(String(fields.appSessionId));
    if (lane === undefined || !lane.open) return failure('internal', `${name}: ${NOT_OPEN}`, { refusal: 'not-open' });
    if (SENDS.has(name)) return send(link, lane, name, fields);
    return engineAct(link, lane, name, fields, deadline);
  }

  return {
    handles: (name) => ENGINE_HOST_ACTS.has(name) || MACHINE_ACTS.has(name) || PROJECT_CALLS.has(name) || SESSION_CALLS.has(name) || MACHINE_CALLS.has(name) || SUBSTITUTES.has(name) || PAGED_READS.has(name) || TARGETED_CALLS.has(name) || WATCH_COMMANDS.has(name) || PTY_NAMES.has(name) || artifacts.handles(name),
    async dispatch(link, name, input, ctx) {
      try {
        return await run(link, name, record(input) ?? {}, ctx);
      } catch (error) {
        deps.log(`lane B: ${name} for ${link.name} failed: ${(error as Error).message}`);
        return failure('internal', (error as Error).message);
      }
    },
    refresh: () => interest.refresh(),
    forward: {
      open: async (input) => {
        try {
          return await forwards.open(input);
        } catch (error) {
          deps.log(`lane B: remote.forward.open of port ${input.port} on ${input.machine} failed: ${(error as Error).message}`);
          return failure('internal', (error as Error).message) as CommandResult<'remote.forward.open'>;
        }
      },
      close: async (input) => (forwards.close(input), { ok: true, value: undefined }),
      listening: (machine, port) => forwards.listening(machine, port),
      at: (localPort) => forwards.at(localPort),
    },
    spawnsKept: () => spawns.kept(),
    chooserRead(machine, read, startedAt, answeredAt) {
      chooser(deps.remote(machine)?.name ?? machine, read, startedAt, answeredAt);
    },
    artifacts: { openCopy: (input) => artifacts.openCopy(input), files: (machine) => artifacts.files(machine), scheme: artifacts.scheme, assets: (machine) => artifacts.assets(machine) },
    attention: { machines: () => attention.machines(), machine: (machine) => attention.machine(machine), onChange: (listener) => attention.onChange(listener), sayAgain: () => attention.sayAgain() },
    replay(machine, app) {
      const lane = machines.get(machine)?.lanes.get(app);
      if (lane?.open === true) lane.session.replay();
      attention.replay(machine, app); // fix waves 1, 5: the feed's items, which the stream's replay leaves out while it is fed
      // the UX wave, U9 (M5): the generation settled, for the page that has just subscribed to a session held here
      const round = rounds.get(machine);
      if (lane?.open === true && round?.settled != null && round.link.state() === 'up') deps.emit(machine, 'remote.settled', { machine, generation: round.settled });
    },
    stop() {
      interest.stop();
      offRemote();
      checkout.stop();
      attention.stop();
      spawns.stop();
      ptys.stop();
      forwards.stop();
      artifacts.stop();
      connectors.stop(); // P5 O7 M5c
      windows.stop();
      port.stop();
      for (const { lanes } of machines.values()) for (const lane of lanes.values()) lane.session.stop();
      machines.clear();
      follows.clear();
      for (const round of rounds.values()) round.off();
      rounds.clear();
    },
  };
}
