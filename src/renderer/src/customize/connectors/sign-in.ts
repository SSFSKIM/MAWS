// The renderer's side of a connector sign-in (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Signing in"): main owns the operation; `connectors.signInChanged` is heard for the window's life (App.tsx), so a
// sign-in started in Customize keeps its state while the page shows something else.
// - A result is the configured server's it was started for: its name, its scope, and the page's directory for a project
//   or local server (a name is the person's own, so two projects may each configure a different `linear`), recorded with
//   the session that signed in, when it was heard, and the configuration's fingerprint at the press (main's opaque hash
//   of its endpoint and transport, `catalog.postures`), so a row shows a finished result only for that configuration
//   (./present.ts `resultFor`). Removing or replacing the configuration through MAWS forgets it (`forgetSignIn`). Main's events carry only the operation and the name, so an event
//   is bound to its server by the receipt `connectors.signIn` answers; the ones heard before it (main says `starting`
//   before it answers) wait for it.
// - Per server, the latest event of its newest operation: a second press cancels the first in main, and the first's
//   events stop counting once the second's receipt is bound. A refused invoke reads as a failed sign-in.
// - P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"): an operation is its
//   machine's, the one its session is on, and is heard from that machine alone: another machine's `signInChanged` (its
//   artifacts feed carries them to a member holding `machine-admin` there) never binds to, or crowds out, this one's. Such
//   a machine's failure says its own words (`sign in on <machine>` for a sign-in its engine keeps a listener for, the busy
//   words for a callback port this Mac already waits on there), shown as they are. A server's result is its machine's too
//   (the task review's finding 4): the same server signing in on this Mac and on another machine are two servers here,
//   each with its own newest operation, and a row shows the one of the machine its Sign in runs on (`signInMachineOf`).
// - UX wave U11a M8 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, §A): a dynamic connector,
//   a plugin's or one of MAWS's own list, is its machine and its name (`dynamic`, keyed as `user` is, with no folder, and
//   apart from a file-scope server of the name). The dialog signs it in by name; Customize's row of MAWS's own list also
//   sends the revision of the configuration it was drawn with, and keeps its fingerprint here, which decides as for any
//   row that a finished result shows only on the row of the configuration it was started for; a running one shows on both.
import { create } from 'zustand';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import type { PluginsScope } from '@shared/plugins/cli';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../../ipc/client';
import { transportWords } from '../../widgets/read';

export interface SignInTarget {
  name: string;
  scope: PluginsScope; // a configuration file's; MAWS's own (`app`) servers sign in as dynamic connectors (`startSignInDynamic`)
  cwd: string | null; // the page's directory: part of a project or local server's identity
  path: string; // the file the entry is in: main signs in only from a session whose engine uses this entry (scalpel-2#1)
}

export interface SignInRecord {
  event: ConnectorSignInChanged; // the latest of the server's newest operation
  appSessionId: string; // the session it signs in
  at: number; // when the renderer heard it (ms)
  fingerprint: string | null; // the configuration's, when Sign in was pressed; null: not read then
}

// P5 O7 M5c: a machine as the bookkeeping keys it: this Mac's, or a bare id's (sent to this Mac), as ''
const machineKey = (machine: MachineRef | null): string => (machine === null || machine === ipc.localMachine ? '' : machine);

/** The scope a sign-in is kept under: a configured file's, or a dynamic connector's (U11a M8). */
export type SignInScope = PluginsScope | 'dynamic';
/** A server on a machine (absent or null: this Mac's). */
export type SignInServer = { name: string; scope: SignInScope; cwd: string | null; machine?: MachineRef | null };

// `dynamic` is keyed as `user` is, with no folder
export const signInKeyOf = ({ name, scope, cwd, machine = null }: SignInServer): string => [machineKey(machine), scope, scope === 'user' || scope === 'dynamic' ? '' : (cwd ?? ''), name].join('\u0000');

/** The longest name `connectors.signInDynamicServer` takes: a dynamic connector of a longer name is offered no Sign in. */
const DYNAMIC_NAME_MAX = 128;
export const signsInDynamic = (name: string): boolean => name.length > 0 && name.length <= DYNAMIC_NAME_MAX;

interface SignIns {
  byServer: ReadonlyMap<string, SignInRecord>;
}

export const useSignIns = create<SignIns>()(() => ({ byServer: new Map() }));

const UNBOUND_KEPT = 32; // operations heard without a receipt (another window's), per machine: its oldest dropped past this
// an operation by its machine and opId
const opKeyOf = (machine: MachineRef | null, opId: string): string => `${machineKey(machine)}\u0000${opId}`;
const bound = new Map<string, { key: string; appSessionId: string; fingerprint: string | null }>(); // live operations by op key
const newest = new Map<string, string>(); // server key → its newest operation's op key
// by machine, then op key → events heard before its receipt (one machine's crowd never pushes out another's)
const unbound = new Map<string, Map<string, { event: ConnectorSignInChanged; at: number }[]>>();
const unboundOf = (machine: MachineRef | null) => {
  const own = unbound.get(machineKey(machine)) ?? new Map<string, { event: ConnectorSignInChanged; at: number }[]>();
  unbound.set(machineKey(machine), own);
  return own;
};

const TERMINAL: ReadonlySet<ConnectorSignInChanged['state']> = new Set(['done', 'failed', 'cancelled']);

function record(key: string, owner: { appSessionId: string; fingerprint: string | null }, event: ConnectorSignInChanged, at: number): void {
  useSignIns.setState(({ byServer }) => ({ byServer: new Map(byServer).set(key, { event, appSessionId: owner.appSessionId, at, fingerprint: owner.fingerprint }) }));
}

// `machine`: the machine that said it (null: a bare id's)
export function heard(event: ConnectorSignInChanged, at = Date.now(), machine: MachineRef | null = null): void {
  const op = opKeyOf(machine, event.opId);
  const owner = bound.get(op);
  if (owner === undefined) {
    const own = unboundOf(machine);
    const waiting = own.get(op) ?? [];
    own.delete(op);
    own.set(op, [...waiting, { event, at }]);
    if (own.size > UNBOUND_KEPT) own.delete(own.keys().next().value!);
    return;
  }
  if (TERMINAL.has(event.state)) bound.delete(op);
  if (newest.get(owner.key) !== op) return; // an older operation's
  record(owner.key, owner, event, at);
}

export function connectSignInEvents(bridge: MawsBridge = ipc): () => void {
  return bridge.on('connectors.signInChanged', (event, from) => heard(event, Date.now(), from.machine));
}

// The machine a session's operation runs on (null: a bare id, which names none)
const machineOfSession = (appSessionId: string): MachineRef | null => (isAddress(appSessionId) ? machineOf(appSessionId) : null);
/** The machine a sign-in from `appSessionId` runs on, whose result a row shows (null: this Mac's, or no session). */
export const signInMachineOf = (appSessionId: string | null): MachineRef | null => (appSessionId === null ? null : machineOfSession(appSessionId));

export async function startSignIn(target: SignInTarget, fingerprint: string | null, appSessionId: string, bridge: MawsBridge = ipc): Promise<void> {
  const answer = await bridge.invoke('connectors.signIn', { name: target.name, scope: target.scope, cwd: target.cwd, path: target.path, appSessionId: appSessionId as AppSessionId });
  bindReceipt(target, fingerprint, appSessionId, answer);
}

/**
 * P5 O7 M8 ("Sign in from the session's MCP widget"): a server known by its name and scope alone (the session's
 * `mcp_status`), signed in through `connectors.signInServer`, whose entry the session's machine reads itself (that
 * machine's `customization.serverEndpoints` is its own). Its result is recorded as Customize's is, with no fingerprint:
 * the widget shows the server the session's engine holds, not a configuration.
 */
export async function startSignInByName(server: Omit<SignInTarget, 'path'>, appSessionId: AppSessionId, bridge: MawsBridge = ipc): Promise<void> {
  const answer = await bridge.invoke('connectors.signInServer', { name: server.name, scope: server.scope, cwd: server.cwd, appSessionId });
  bindReceipt(server, null, appSessionId, answer);
}

/**
 * UX wave U11a M8 (§A): a dynamic connector, by the name the session's mcp_status reports, through
 * `connectors.signInDynamicServer`. `revision`: the configuration a row of MAWS's own list was drawn with, which the
 * services check the entry against; the dialog passes none, and no fingerprint. Bound as `startSignInByName` binds.
 */
export async function startSignInDynamic(server: { name: string; revision?: string }, fingerprint: string | null, appSessionId: AppSessionId, bridge: MawsBridge = ipc): Promise<void> {
  const answer = await bridge.invoke('connectors.signInDynamicServer', { name: server.name, appSessionId, ...(server.revision !== undefined && { entry: { revision: server.revision } }) });
  bindReceipt({ name: server.name, scope: 'dynamic', cwd: null }, fingerprint, appSessionId, answer);
}

// A sign-in's receipt bound to its server, the events heard before it applied; a refused invoke is a failed sign-in.
function bindReceipt(target: Omit<SignInServer, 'machine'>, fingerprint: string | null, appSessionId: string, answer: CommandResult<'connectors.signIn' | 'connectors.signInServer' | 'connectors.signInDynamicServer'>): void {
  const machine = machineOfSession(appSessionId); // the session's address names where it went
  const key = signInKeyOf({ ...target, machine });
  if (!answer.ok) {
    newest.set(key, `refused:${key}`);
    record(key, { appSessionId, fingerprint }, { opId: `refused:${key}`, name: target.name, state: 'failed', reason: 'engine', message: transportWords(answer.error), where: null }, Date.now());
    return;
  }
  const op = opKeyOf(machine, answer.value.opId);
  bound.set(op, { key, appSessionId, fingerprint });
  newest.set(key, op);
  const own = unboundOf(machine);
  const waiting = own.get(op) ?? [];
  own.delete(op);
  for (const { event, at } of waiting) heard(event, at, machine);
}

// `appSessionId`: the session the operation signs in, whose machine runs it
export function cancelSignIn(opId: string, appSessionId: string, bridge: MawsBridge = ipc): void {
  const machine = machineOfSession(appSessionId);
  void bridge.invoke('connectors.signInCancel', { opId }, machine === null ? undefined : { machine });
}

/** A server's result forgotten, and the rest of an operation still running for it dropped: MAWS removed or replaced its
 * configuration, so nothing that operation says is about what is configured now (the server's machine's alone). */
export function forgetSignIn(target: SignInServer): void {
  const key = signInKeyOf(target);
  newest.delete(key);
  useSignIns.setState(({ byServer }) => {
    if (!byServer.has(key)) return { byServer };
    const next = new Map(byServer);
    next.delete(key);
    return { byServer: next };
  });
}

/** Every record and binding dropped (tests). */
export function resetSignIns(): void {
  bound.clear();
  newest.clear();
  unbound.clear();
  useSignIns.setState({ byServer: new Map() });
}

/** The latest sign-in of a server that is still under way, for Cancel. */
export const RUNNING: ReadonlySet<ConnectorSignInChanged['state']> = new Set(['starting', 'waiting_browser', 'waiting_callback', 'watching_status', 'submitting']);
