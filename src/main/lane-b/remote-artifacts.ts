// Another machine's artifacts from this Mac (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5's
// "What crosses, as what", "Artifact writes are engine-host acts with no session", "Which machine an artifact is on",
// "Open a copy, and Save As of a remote artifact", "The capability lists"): remote lane B's artifact half, reached by the
// router through `routeLaneB` for the names `handles` takes (./remote.ts).
//
// - Reads keyed by an artifact, and the two listings whose rows name artifacts, cross as calls (`dispatchOverLink`;
//   `artifacts.export` waits its command's budget, ../machines/budgets.ts); `library.read` in the pages the channel
//   carries (./remote-files-read.ts). The id-to-machine table (../artifacts/machines.ts) is written here alone: the
//   artifact each request names, at its dispatch, and every row or record a link answers (`artifacts.get`, `.list`,
//   `library.list`, `library.get`, what `create` and `duplicate` answer, and the feed's changes).
// - Writes cross as engine-host acts on no session and with no context, the third act shape
//   (`link.act({action, args, executor: 'engine-host', sendBy})`), needing the peer's `rl2.artifacts`: the endpoint
//   places the artifact by the `artifact` rule and the engine host runs it under `host.artifactOp`. One the machine took
//   and then refused `unavailable` met an engine host that predates `host.artifactOp`, said in O17's words for an
//   engine host replaced when idle. Refused here, before any act: a `copyAsset` whose two artifacts the table doesn't
//   place both on the act's machine (`invalid_input`), an `uploadAsset` or a `create` whose bytes are past the channel
//   (`REMOTE_INLINE_MAX_BYTES`, M2's words; parts for assets are a follow-up), a `create` from a path (a path on this
//   Mac, `malformed`), and `artifacts.open` (the document's port over the link is M5b's).
// - `session.capabilities` (the tools: `artifact_screenshot`, `artifact_export`, `browser`) is read from the session's
//   machine; for a machine that predates it (`not-offered`) and while the link is down the adapter answers every tool
//   unavailable with the reason, as M2 substitutes `attention.request`, so the reader always holds a reading. Its changes
//   come on the session's checkout feed (./remote-checkout.ts).
// - The machine's `artifacts` feed (./remote-artifact-feed.ts), and open-a-copy and Save As's bytes (./remote-copy.ts).
import { tmpdir } from 'node:os';
import { toWire } from '@shared/host/json-bytes';
import { ipcError, type IpcError, type IpcErrorCode } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import { REMOTE_INLINE_MAX_BYTES, type RemoteCopySource } from '@shared/ipc/schema/remote';
import { SESSION_CAPABILITY_TOOLS } from '@shared/ipc/schema/session-capabilities';
import type { MachineRef } from '@shared/machine/ref';
import type { ArtifactMachines } from '../artifacts/machines';
import { CommandFailure } from '../ipc/router';
import type { RemoteLibraryFiles } from '../library/files';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { ActHandle, ActOutcome, RemoteLink } from '../machines/remote/link';
import { createRemoteArtifactFeed } from './remote-artifact-feed';
import { fetchToFile, openCopy, type ArtifactSource } from './remote-copy';
import { readInPages } from './remote-files-read';
import { outcomeAsResult, pendingResult, TOO_LARGE_WORDS } from './remote-outcomes';

/** Reads offered as calls under the `artifact` rule, and the listings whose rows the table takes. */
export const ARTIFACT_CALLS: ReadonlySet<CommandName> = new Set<CommandName>([
  'artifacts.get', 'artifacts.list', 'artifacts.versions', 'artifacts.versionState', 'artifacts.attributions', 'artifacts.readDataset',
  'artifacts.datasetFiles', 'artifacts.connectorGrants', 'artifacts.markViewed', 'artifacts.export',
  'library.get', 'library.list', 'library.content', 'library.read',
]);
/** Writes offered as engine-host acts under the `artifact` rule. */
export const ARTIFACT_ACTS: ReadonlySet<CommandName> = new Set<CommandName>([
  'artifacts.update', 'artifacts.delete', 'artifacts.duplicate', 'artifacts.saveVersion', 'artifacts.nameVersion', 'artifacts.restore',
  'artifacts.pruneVersions', 'artifacts.acceptSuggestion', 'artifacts.rejectSuggestion', 'artifacts.uploadAsset', 'artifacts.copyAsset',
  'artifacts.rereadDatasetFile', 'artifacts.create',
]);
/** Answered here for an RL2 machine whatever it offers: an edit's port (M5b's), the session's tools (the substitute). */
const ANSWERED_HERE: ReadonlySet<CommandName> = new Set<CommandName>(['artifacts.open', 'session.capabilities']);

export const COPY_BETWEEN_MACHINES = 'an asset can’t be copied between machines yet';
export const editNextLanding = (machine: string) => `editing an artifact on ${machine} arrives with the next landing`;
export const predatesArtifactOp = (machine: string) => `${machine}’s engine host predates remote artifact edits; it is replaced when idle`;
export const predatesCapabilities = (machine: string) => `${machine} predates session capabilities; update it`;
export const offline = (machine: string) => `${machine} is offline`;

export interface RemoteArtifactsDeps {
  remote(machine: MachineRef): RemoteLink | null;
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  machines: ArtifactMachines;
  /** The adapter's pending bound (./remote.ts's `bounded`): the outcome, or `pending` at the deadline once a copy went out. */
  bounded(handle: ActHandle, deadline: number): Promise<ActOutcome | 'pending'>;
  pendingMs: number;
  feedRetryMs: readonly [number, number];
  /** shell.openPath, for an open copy. */
  openPath(path: string): Promise<string>;
  tempDir?(): string;
  env: NodeJS.ProcessEnv;
  now(): number;
  log(line: string): void;
}

export interface RemoteArtifacts {
  handles(name: CommandName): boolean;
  dispatch(link: RemoteLink, name: CommandName, fields: Record<string, unknown>): Promise<CommandResult<CommandName>>;
  /** `remote.openCopy`, main's handler's. */
  openCopy(input: CommandInput<'remote.openCopy'>): Promise<CommandResult<'remote.openCopy'>>;
  /** A remote artifact's stored files and exports, for Save As (../library/files.ts); null while no link reaches it. */
  files(machine: MachineRef): RemoteLibraryFiles | null;
  stop(): void;
}

type Result = CommandResult<CommandName>;
const failure = (code: IpcErrorCode, message: string, issues?: unknown): Result => ({ ok: false, error: ipcError(code, message, issues) });
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const idOf = (value: unknown): string | null => (isObject(value) && typeof value.id === 'string' ? value.id : null);

export function createRemoteArtifacts(deps: RemoteArtifactsDeps): RemoteArtifacts {
  const tempDir = deps.tempDir ?? tmpdir;
  const feed = createRemoteArtifactFeed({ remote: deps.remote, onRemote: deps.onRemote, emit: deps.emit, machines: deps.machines, retryMs: deps.feedRetryMs, log: deps.log });

  /** The artifacts an answer names, each on the machine that answered. */
  function recordAnswer(machine: MachineRef, name: CommandName, value: unknown): void {
    const rows = !isObject(value) ? [] : name === 'artifacts.list' ? value.artifacts : name === 'library.list' ? value.rows : name === 'library.get' ? [value.row] : [value.artifact];
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = idOf(row);
      if (id !== null) deps.machines.record(id, machine);
    }
  }
  const ANSWERS_ROWS: ReadonlySet<CommandName> = new Set<CommandName>(['artifacts.get', 'artifacts.list', 'library.list', 'library.get', 'artifacts.create', 'artifacts.duplicate']);

  /** The artifact a request names, recorded as it goes to its machine. */
  function recordRequest(machine: MachineRef, fields: Record<string, unknown>): void {
    if (typeof fields.artifactId === 'string') deps.machines.record(fields.artifactId, machine);
  }

  async function call(link: RemoteLink, name: CommandName, fields: Record<string, unknown>): Promise<Result> {
    recordRequest(link.machine, fields);
    const result = name === 'library.read' ? await readInPages(link, 'library.read', fields, deps.log) : await dispatchOverLink(link, name, fields);
    if (result.ok && ANSWERS_ROWS.has(name)) recordAnswer(link.machine, name, result.value);
    return result;
  }

  /** Why the write can't go to `link`'s machine as asked, or null. */
  function refusal(link: RemoteLink, name: CommandName, fields: Record<string, unknown>): Result | null {
    if (name === 'artifacts.copyAsset' && (deps.machines.machineOf(String(fields.from)) !== link.machine || deps.machines.machineOf(String(fields.to)) !== link.machine)) return failure('invalid_input', COPY_BETWEEN_MACHINES);
    const content = name === 'artifacts.create' && isObject(fields.content) ? fields.content : null;
    if (content !== null && 'path' in content) return failure('internal', `artifacts.create: a path names a file on this Mac, not on ${link.name}`, { refusal: 'malformed' });
    if ((name === 'artifacts.uploadAsset' || content !== null) && Buffer.byteLength(JSON.stringify(toWire(fields))) > REMOTE_INLINE_MAX_BYTES) return failure('invalid_input', TOO_LARGE_WORDS);
    return null;
  }

  async function act(link: RemoteLink, name: CommandName, fields: Record<string, unknown>): Promise<Result> {
    const refused = refusal(link, name, fields);
    if (refused !== null) return refused;
    recordRequest(link.machine, fields);
    const deadline = deps.now() + deps.pendingMs;
    const handle = link.act({ action: name, args: fields, executor: 'engine-host', sendBy: deadline, requires: 'rl2.artifacts' });
    // taken: the endpoint accepted it, so a refusal after is the engine host's (an older one's `unknown_command`)
    let taken = handle.progress() === 'accepted';
    const off = handle.onProgress((progress) => void (taken ||= progress === 'accepted'));
    const outcome = await deps.bounded(handle, deadline);
    off();
    if (outcome === 'pending') {
      deps.log(`lane B: ${name} on ${link.name} (${handle.opId}) unconfirmed at the pending bound; still querying`);
      return pendingResult(name, link.name);
    }
    if (outcome.state === 'refused' && outcome.reason === 'unavailable' && taken) return failure('host_unavailable', predatesArtifactOp(link.name));
    const result = outcomeAsResult(name, link.name, outcome);
    if (result.ok && ANSWERS_ROWS.has(name)) recordAnswer(link.machine, name, result.value);
    return result;
  }

  /** Every tool unavailable for `reason`. */
  const unavailable = (reason: string): Result => ({ ok: true, value: Object.fromEntries(SESSION_CAPABILITY_TOOLS.map((tool) => [tool, { available: false, reason }])) }) as Result;

  async function capabilities(link: RemoteLink, fields: Record<string, unknown>): Promise<Result> {
    if (link.state() === 'down') return unavailable(offline(link.name));
    const read = await dispatchOverLink(link, 'session.capabilities', fields);
    if (read.ok) return read;
    if ((read.error.issues as { refusal?: unknown } | undefined)?.refusal === 'not-offered') return unavailable(predatesCapabilities(link.name));
    if (link.state() !== 'up') return unavailable(offline(link.name)); // the link went down while it was asked
    return read;
  }

  /** The link that reaches `machine`, or the refusal to answer. */
  const linkOf = (machine: MachineRef, name: string): RemoteLink => {
    const link = deps.remote(machine);
    if (link === null) throw new CommandFailure(ipcError('host_unavailable', `${name}: machine ${machine} is not connected`));
    return link;
  };
  const required = <T>(result: { ok: true; value: T } | { ok: false; error: IpcError }): T => {
    if (!result.ok) throw new CommandFailure(result.error);
    return result.value;
  };

  return {
    handles: (name) => ARTIFACT_CALLS.has(name) || ARTIFACT_ACTS.has(name) || ANSWERED_HERE.has(name),
    async dispatch(link, name, fields) {
      if (name === 'artifacts.open') return failure('host_unavailable', editNextLanding(link.name));
      if (name === 'session.capabilities') return capabilities(link, fields);
      if (ARTIFACT_ACTS.has(name)) return act(link, name, fields);
      return call(link, name, fields);
    },
    async openCopy(input) {
      const { machine, source } = input as { machine: MachineRef; source: RemoteCopySource }; // validated at the boundary
      const link = deps.remote(machine);
      if (link === null) return failure('host_unavailable', `remote.openCopy: machine ${machine} is not connected`) as CommandResult<'remote.openCopy'>;
      if ('artifactId' in source) deps.machines.record(source.artifactId, machine);
      return openCopy(link, source, { openPath: deps.openPath, tempDir, env: deps.env, log: deps.log });
    },
    files(machine) {
      if (deps.remote(machine) === null) return null;
      return {
        async get(artifactId) {
          const link = linkOf(machine, 'library.saveAs');
          return (required(await call(link, 'artifacts.get', { artifactId, prepare: false })) as CommandOutput<'artifacts.get'>).artifact;
        },
        async content(input) {
          const link = linkOf(machine, 'library.saveAs');
          return required(await call(link, 'library.content', input)) as CommandOutput<'library.content'>;
        },
        async fetch(source: ArtifactSource, to: string) {
          const link = linkOf(machine, 'library.saveAs');
          deps.machines.record(source.artifactId, machine);
          required(await fetchToFile(link, source, to, Infinity, deps.log));
        },
      };
    },
    stop: () => feed.stop(),
  };
}
