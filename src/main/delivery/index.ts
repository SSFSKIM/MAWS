// P4-B5: the owner's Send to, main's service (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7 and P4-B5; the
// schema src/shared/ipc/schema/delivery.ts). The owner's two rules hold for both targets: a send takes no Claude turn
// (no session is started, no prompt is sent), and MAWS holds no Google credential of its own.
//
// - Notion: the shown artifact exported in Notion's enhanced Markdown (X31's `notion` dialect, a file of its own,
//   removed once read) and made into a page by Notion's `notion-create-pages` through MAWS's own connection (route D,
//   ../connectors/owner-delivery.ts), whose sign-in is the one route D seals; the host admits the write.
// - Drive: the export in the owner's format uploaded by the gws CLI the owner installed (./gws.ts), run with the owner's
//   login-shell environment; the CLI keeps its own sign-in, which its own login makes (MAWS opens the URL it prints).
//   MAWS stores nothing of it.
// - A run is the window's (`runId`): cancelled until it writes, never after (a request that may have reached the service
//   is never called back, and a failure after it says so: `maybeSent`); its signal is read again after every await, the
//   last read and the write one synchronous step. One run per artifact and target at a time.
// - A located source is named back by its handle; one main no longer keeps is refused (`source`), never found afresh,
//   so a send goes through the server the sheet showed or not at all.
// - A receipt is main's memory for its life: the latest of each artifact and target, broadcast as it is made, for the
//   header and the library's row. No delivery record persists.
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import type { CommandInput, CommandOutput, CommandResult, EventPayload } from '@shared/ipc/schema';
import type { DirectSource } from '@shared/ipc/schema/connectors';
import type { DeliveryConnectAnswer, DeliveryFailure, DeliveryReceipt, DeliverySendAnswer, DeliveryStatus, DriveStatus, NotionStatus } from '@shared/ipc/schema/delivery';
import type { DeliverySource, OwnerDelivery } from '../connectors/owner-delivery';
import type { DirectSendAnswer } from '../connectors/direct-route';
import type { registerMainHandler } from '../ipc/router';
import { findGws, gwsLogin, gwsUpload, readGwsState, type GwsState } from './gws';
import { NOTION_CONTENT_MAX_BYTES, NOTION_HOSTS, NOTION_TOOL, notionArguments, notionTitle, readNotionAnswer } from './notion';

export const DELIVERY_STATUS_DEADLINE_MS = 30_000; // the sheet's read of a target
export const DELIVERY_SOURCE_LIMIT = 64; // located sources' handles kept
export const DELIVERY_RECEIPT_LIMIT = 1_000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const WORDS_MAX = 300;

const MIME: Record<ArtifactExportFormat, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  pngs: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  html: 'text/html',
  claude: 'application/zip',
};

type Export = (input: CommandInput<'artifacts.export'>, options?: { dialect?: 'notion' }) => Promise<CommandOutput<'artifacts.export'>>;
export interface GwsDriver {
  find: typeof findGws;
  state: typeof readGwsState;
  login: typeof gwsLogin;
  upload: typeof gwsUpload;
}

export interface DeliveryDeps {
  register: typeof registerMainHandler;
  emit(name: 'delivery.receipt', payload: EventPayload<'delivery.receipt'>): boolean;
  exportArtifact: Export; // X31's export service, as the library exports
  call(name: 'artifacts.get', input: CommandInput<'artifacts.get'>): Promise<CommandResult<'artifacts.get'>>; // the engine host's
  connectors: OwnerDelivery | null; // route D's owner delivery; null: no route D
  shellEnv(): Promise<Record<string, string>>; // the owner's login-shell environment (the one capture main makes)
  openExternal(url: string): boolean; // the scheme-checked opener
  gws?: GwsDriver; // tests
  readFile?: (path: string) => Promise<string>; // tests: the Notion export's read
  now?: () => number;
  log?: (line: string) => void;
}

interface Run {
  controller: AbortController;
  written: boolean; // its request may have reached the service: no longer cancelled
}

const failure = (why: DeliveryFailure, extra: { maybeSent?: boolean; message?: string } = {}): DeliverySendAnswer => ({ ok: false, why, ...(extra.maybeSent && { maybeSent: true }), ...(extra.message && { message: extra.message.slice(0, WORDS_MAX) }) });
const words = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, WORDS_MAX);

// Route D's closed reasons as the sheet words them; after the write (or past it, unknown), `maybeSent`.
function notionFailure(answer: Extract<DirectSendAnswer, { ok: false }>): DeliverySendAnswer {
  // P4-B5 review: ended with no typed answer; it may have reached Notion only if its command went out
  if (answer.reason === 'lost') return answer.credential === false ? failure('unauthorized') : answer.sent ? failure('failed', { maybeSent: true }) : failure('unavailable');
  if (answer.failure === 'refused') return failure('deleted');
  switch (answer.reason) {
    case 'unauthorized':
    case 'credential':
      return failure('unauthorized');
    case 'source':
    case 'changed':
      return failure('source');
    case 'toolMissing':
    case 'taskRequired':
      return failure('toolMissing');
    case 'cancelled':
      return failure('cancelled');
    case 'timeout':
      return failure('timeout', { maybeSent: true });
    case 'transport':
    case 'notJson':
      return failure('transport', { maybeSent: true });
    case 'tooLarge':
      return failure('transport', { maybeSent: true }); // the answer was too large to carry: the page was likely made
    default: // connection, capacity, store, grant
      return failure('unavailable');
  }
}

function driveStatusOf(state: GwsState): DriveStatus {
  switch (state.state) {
    case 'ready':
      return { target: 'drive', state: 'ready', ...(state.user && { user: state.user.slice(0, 320) }) };
    case 'noDrive':
      return { target: 'drive', state: 'noDrive', ...(state.user && { user: state.user.slice(0, 320) }) };
    case 'expired':
      return { target: 'drive', state: 'expired', ...(state.message && { message: state.message.slice(0, WORDS_MAX) }) };
    case 'failed':
      return { target: 'drive', state: 'failed', ...(state.message && { message: state.message.slice(0, WORDS_MAX) }) };
    default:
      return { target: 'drive', state: state.state };
  }
}

export function startDelivery(deps: DeliveryDeps): { stop(): void } {
  const gws: GwsDriver = deps.gws ?? { find: findGws, state: readGwsState, login: gwsLogin, upload: gwsUpload };
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line: string) => console.warn(`[delivery] ${line}`));
  const readExport = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const sources = new Map<string, DirectSource>(); // a located source's handle, the window's to name back
  const receipts = new Map<string, DeliveryReceipt>(); // by artifact and target
  const runs = new Map<string, Run>(); // by run id
  const active = new Set<string>(); // artifact and target with a run under way
  const stopping = new AbortController(); // main's going: every run ends
  let stopped = false;

  const keep = (source: DirectSource): string => {
    const key = randomUUID();
    sources.set(key, source);
    if (sources.size > DELIVERY_SOURCE_LIMIT) sources.delete(sources.keys().next().value as string);
    return key;
  };
  const deadline = (ms: number) => AbortSignal.any([stopping.signal, AbortSignal.timeout(ms)]);

  // ── status ──
  async function notionStatus(artifactId: string): Promise<NotionStatus> {
    if (!deps.connectors) return { target: 'notion', state: 'unavailable' };
    const found = await deps.connectors.find({ tool: NOTION_TOOL, urlHosts: NOTION_HOSTS, artifactId }, deadline(DELIVERY_STATUS_DEADLINE_MS));
    if (found === null) return { target: 'notion', state: 'unavailable' };
    const first = found.sources[0];
    if (!first) return { target: 'notion', state: 'none', why: found.live === 0 ? 'noSession' : 'notFound' };
    const source = { key: keep(first.source), server: first.source.server, scope: first.source.scope, transport: first.source.transport, file: first.source.path };
    switch (first.connection) {
      case 'connected':
      case 'local':
      case 'open':
        return { target: 'notion', state: 'ready', connection: first.connection, source };
      case 'signIn':
      case 'reconnect':
      case 'busy':
        return { target: 'notion', state: first.connection, source };
      default:
        return { target: 'notion', state: 'unavailable' };
    }
  }

  async function driveState(signal: AbortSignal): Promise<{ bin: string | null; env: Record<string, string>; state: GwsState }> {
    const env = await deps.shellEnv();
    const bin = await gws.find(env);
    if (bin === null) return { bin, env, state: { state: 'absent' } };
    return { bin, env, state: await gws.state(bin, env, { signal }) };
  }

  // A source the window named by its handle (`unknown`: not kept, as once evicted), else, when it named none, the first
  // one found now that can send.
  async function sourceFor(key: string | undefined, artifactId: string, signal: AbortSignal): Promise<DeliverySource | DirectSource | 'unknown' | null> {
    if (key !== undefined) return sources.get(key) ?? 'unknown';
    const found = await deps.connectors?.find({ tool: NOTION_TOOL, urlHosts: NOTION_HOSTS, artifactId }, signal);
    return found?.sources[0] ?? null;
  }
  const directOf = (found: DeliverySource | DirectSource): DirectSource => ('source' in found ? found.source : found);

  // ── runs ──
  function begin(runId: string): Run | null {
    if (stopped || runs.has(runId)) return null;
    const run: Run = { controller: new AbortController(), written: false };
    runs.set(runId, run);
    return run;
  }
  const signalOf = (run: Run) => AbortSignal.any([run.controller.signal, stopping.signal]);

  async function connect({ runId, target, artifactId, source }: CommandInput<'delivery.connect'>): Promise<DeliveryConnectAnswer> {
    const run = begin(runId);
    if (!run) return { ok: false, why: 'busy' };
    const signal = signalOf(run);
    try {
      if (target === 'notion') {
        if (!deps.connectors) return { ok: false, why: 'unavailable' };
        const found = await sourceFor(source, artifactId, signal);
        if (found === 'unknown') return { ok: false, why: 'source' };
        if (!found) return { ok: false, why: signal.aborted ? 'cancelled' : 'none' };
        const made = await deps.connectors.connect(directOf(found), signal);
        if (made.ok) return { ok: true };
        if (made.why === 'cancelled') return { ok: false, why: 'cancelled' };
        if (made.why === 'timeout') return { ok: false, why: 'timeout' };
        if (made.why === 'denied') return { ok: false, why: 'denied' };
        if (made.why === 'busy') return { ok: false, why: 'busy' };
        if (made.why === 'refused') return { ok: false, why: 'refused' };
        return { ok: false, why: 'failed' };
      }
      const { bin, env, state } = await driveState(signal);
      if (bin === null) return { ok: false, why: 'absent' };
      if (state.state === 'needsSetup') return { ok: false, why: 'needsSetup' };
      // a sign-in that lacks Drive keeps what it had and adds Drive; a first one asks for Drive alone
      const scopes = state.state === 'noDrive' ? [...new Set([...state.scopes, DRIVE_SCOPE])] : undefined;
      const login = await gws.login(bin, env, { ...(scopes && { scopes }), openUrl: (url) => void deps.openExternal(url), signal });
      if (login.ok) return { ok: true };
      return { ok: false, why: login.why, ...(login.message && { message: login.message.slice(0, WORDS_MAX) }) };
    } catch (error) {
      log(`the ${target} sign-in failed: ${words(error)}`);
      return { ok: false, why: signal.aborted ? 'cancelled' : 'failed' };
    } finally {
      runs.delete(runId);
    }
  }

  async function send(input: CommandInput<'delivery.send'>): Promise<DeliverySendAnswer> {
    const { runId, target, artifactId, format, versionId, board, destination } = input;
    const slot = `${artifactId}\0${target}`;
    if (active.has(slot)) return failure('busy');
    const run = begin(runId);
    if (!run) return failure('busy');
    active.add(slot);
    const signal = signalOf(run);
    // the run's last read of its signal and its write, one synchronous step: a cancel answered `cancelled` sends nothing
    const writes = (): boolean => {
      if (signal.aborted) return false;
      run.written = true;
      return true;
    };
    let path: string | null = null;
    try {
      const got = await deps.call('artifacts.get', { artifactId, prepare: false });
      if (signal.aborted) return failure('cancelled');
      if (!got.ok) return failure('unavailable');
      const artifact = got.value.artifact;
      if (!artifact) return failure('deleted');
      if (target === 'notion' && format !== 'md') return failure('invalid');
      // Notion's connector, or gws, before anything is exported
      let notion: DirectSource | null = null;
      let drive: { bin: string; env: Record<string, string> } | null = null;
      if (target === 'notion') {
        if (!deps.connectors) return failure('unavailable');
        const found = await sourceFor(input.source, artifactId, signal);
        if (signal.aborted) return failure('cancelled');
        if (found === 'unknown') return failure('source');
        if (!found) return failure('none');
        notion = directOf(found);
      } else {
        // gws's own sign-in, read first: past it the CLI would reach another identity's credentials (./gws.ts)
        const { bin, env, state } = await driveState(signal);
        if (signal.aborted) return failure('cancelled');
        if (bin === null) return failure('absent');
        if (state.state === 'needsSetup') return failure('needsSetup');
        if (state.state !== 'ready') return failure(state.state === 'failed' ? 'failed' : 'auth', state.state === 'failed' && state.message ? { message: state.message } : {});
        drive = { bin, env };
      }
      let exported: CommandOutput<'artifacts.export'>;
      try {
        exported = await deps.exportArtifact({ artifactId, format, ownFile: true, ...(versionId !== undefined && { versionId }), ...(board !== undefined && { board }) }, target === 'notion' ? { dialect: 'notion' } : undefined);
      } catch (error) {
        return signal.aborted ? failure('cancelled') : failure('export', { message: words(error) });
      }
      path = exported.path;
      if (signal.aborted) return failure('cancelled');
      const name = notionTitle(artifact.title);
      const receipt = (url: string | null, arrivedAs: string): DeliveryReceipt => ({ artifactId, target, at: now(), name: arrivedAs.slice(0, 2_000), url, format, revision: exported.revision, ...(versionId !== undefined && { versionId }), destination });
      if (notion) {
        const content = await readExport(path);
        if (signal.aborted) return failure('cancelled');
        if (Buffer.byteLength(content) > NOTION_CONTENT_MAX_BYTES) return failure('tooLarge');
        const args = notionArguments({ title: artifact.title, content, ...(destination.kind === 'inside' && { parent: destination.id }) });
        if (!writes()) return failure('cancelled'); // from here the request may reach Notion: no cancel calls it back (route D admits it at its write)
        const answer = await deps.connectors!.send(notion, { artifactId, tool: NOTION_TOOL, arguments: args }, stopping.signal);
        if (!answer.ok) return notionFailure(answer);
        const read = readNotionAnswer(answer.result);
        if (!read.ok) return failure('toolError', { message: read.message });
        return made(receipt(read.url, read.name ?? name));
      }
      const fileName = `${name}${extname(path)}`;
      if (!writes()) return failure('cancelled'); // the upload is one request once gws runs: never called back
      const uploaded = await gws.upload(drive!.bin, drive!.env, { file: path, name: fileName, mime: MIME[format], ...(destination.kind === 'inside' && { parent: destination.id }), signal: stopping.signal });
      if (uploaded.ok) return made(receipt(uploaded.link ?? null, uploaded.name));
      switch (uploaded.why) {
        case 'timeout':
        case 'failed':
          return failure(uploaded.why, { maybeSent: true, ...(uploaded.message && { message: uploaded.message }) });
        case 'cancelled':
          return failure('cancelled', { maybeSent: true });
        default:
          return failure(uploaded.why, uploaded.message ? { message: uploaded.message } : {});
      }
    } catch (error) {
      if (signal.aborted && !run.written) return failure('cancelled'); // a read the cancel ended (gws's state)
      log(`the ${target} delivery of ${artifactId} failed: ${words(error)}`);
      return failure('failed', { maybeSent: run.written });
    } finally {
      active.delete(slot);
      runs.delete(runId);
      if (path !== null) await rm(path, { force: true }).catch(() => log(`an export sent to ${target} was not removed`));
    }
  }

  function made(receipt: DeliveryReceipt): DeliverySendAnswer {
    const key = `${receipt.artifactId}\0${receipt.target}`;
    receipts.delete(key);
    receipts.set(key, receipt);
    if (receipts.size > DELIVERY_RECEIPT_LIMIT) receipts.delete(receipts.keys().next().value as string);
    deps.emit('delivery.receipt', receipt);
    return { ok: true, receipt };
  }

  deps.register('delivery.status', async ({ target, artifactId }): Promise<DeliveryStatus> => {
    if (target === 'notion') return notionStatus(artifactId);
    try {
      return driveStatusOf((await driveState(deadline(DELIVERY_STATUS_DEADLINE_MS))).state);
    } catch (error) {
      return { target: 'drive', state: 'failed', message: words(error) };
    }
  });
  deps.register('delivery.connect', (input) => connect(input));
  deps.register('delivery.send', (input) => send(input));
  deps.register('delivery.cancel', ({ runId }) => {
    const run = runs.get(runId);
    if (!run || run.written) return { cancelled: false };
    run.controller.abort();
    return { cancelled: true };
  });
  deps.register('delivery.receipts', () => ({ receipts: [...receipts.values()] }));

  return {
    stop: () => {
      stopped = true;
      stopping.abort();
    },
  };
}
