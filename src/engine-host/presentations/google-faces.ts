// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the P4 spec's §4.4 "Google Fonts (row 176)" and
// §4.10 R-8; the executor's Decision Log 9 amendment): the engine host fetches a Google Fonts face a deck or a design
// names, once, into the artifact's assets, when its licence is OFL; after that every reader draws it offline from the
// assets (deck.ts's `faceFiles`). The portable rules (the canonical request, the repository directory, METADATA.pb, the
// CSS2 parser, the record) are src/artifacts/slides/google-faces.ts; the network is the `google-fonts` egress rule
// (src/shared/net/egress.ts), the only one this module reaches.
//
// - When. On any commit and on a document's load, for each `href` face of a deck or a design whose canonical request no
//   host record answers. A link refused by its own shape (another family, several, a `text=` subset) is never fetched:
//   its readers name the refusal from the face alone. The publish never waits: the work starts after the commit.
// - One family at a time, deduped in flight: the decks naming one request wait on one fetch, each written from it.
// - The licence. `ofl/<dir>/METADATA.pb` must answer 200 with a top-level `name:` equal to the family and
//   `license: "OFL"`; then its `OFL.txt` is fetched and stored beside the faces. A miss probes `apache/` and `ufl/` only
//   to name the refusal (`Apache-2.0`, `UFL-1.0`), or `unlisted` when no directory holds the family.
// - The files. The CSS2 answer under the unsliced user agent, refused if sliced and then asked again with none (the TTF
//   form); each file's first bytes checked, each under the asset limit (the egress cap), the family under 32 MB.
// - The write. One `writeWithAssets` (E3's refresh is the precedent) of the licence, the files and the face's record,
//   as the human (X29 has no system actor; the fetch is the owner's, automatic by Decision Log 4). Its `prepare`
//   discards the result when the face no longer asks for this request or already holds a record (an agent's edit, a
//   restore's carry). A refusal writes its record alone.
// - Errors. A network failure, a timeout, a 5xx, a redirect or an answer of the wrong type writes nothing: the request
//   stays pending in memory, retried on the next commit or load of a deck naming it (no sooner than `retryAfterMs`
//   after the last attempt) and by a bounded backoff while the host runs.
import { googleRecord, type DeckFace } from '@artifacts/slides/deck';
import {
  FAMILY_MAX_BYTES,
  fileAssetName,
  fontType,
  googleRequest,
  licenceAssetName,
  licenceName,
  parseCss2,
  readMetadata,
  REFUSED_REASONS,
  repositoryUrl,
  UNSLICED_USER_AGENT,
  type Css2Answer,
  type GoogleRequest,
} from '@artifacts/slides/google-faces';
import * as Y from '@artifacts/yjs/slides';
import type { Actor } from '@shared/artifacts/actor';
import type { Documents } from '../documents';
import { ArtifactStoreError } from '../documents/errors';
import { mainOf } from '../documents/service';
import { egressBase, egressGet, EgressError, GOOGLE_FONTS_EGRESS, type EgressGet } from '@shared/net/egress';

const KINDS = new Set(['presentation', 'design']);
const HUMAN: Actor = { kind: 'human' };
/** A commit or a load retries a pending request no sooner than this after its last attempt. */
export const RETRY_AFTER_MS = 10_000;
/** The backoff between attempts while the host runs, its last step repeating. */
export const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000] as const;

/** What one fetch of a family came to. */
export type Fetched =
  | { kind: 'saved'; licence: Uint8Array; files: { bytes: Uint8Array; mime: string; ext: string; weight: string; style: 'normal' | 'italic' }[] }
  | { kind: 'refused'; refused: string; detail: string }
  | { kind: 'pending'; detail: string };

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** One family's licence and files through the egress rule; never throws (an unexpected failure is pending). */
export async function fetchFamily(request: GoogleRequest, get: EgressGet, signal?: AbortSignal): Promise<Fetched> {
  const { family, dir } = request;
  const refused = (why: string, detail: string): Fetched => ({ kind: 'refused', refused: why, detail });
  const pending = (detail: string): Fetched => ({ kind: 'pending', detail });
  let asking = '';
  const ask = (url: string, userAgent?: string) => {
    asking = url;
    return get(url, { ...(userAgent && { userAgent }), ...(signal && { signal }) });
  };
  try {
    // the licence, from the repository's directory (never from CSS2, which serves Apache families too)
    const ofl = await ask(repositoryUrl('ofl', dir, 'METADATA.pb'));
    const oflMeta = ofl.bytes ? readMetadata(text(ofl.bytes)) : null;
    if (ofl.status !== 200 && ofl.status !== 404) return pending(`ofl/${dir}/METADATA.pb answered ${ofl.status}`);
    if (oflMeta?.name === family && oflMeta.license !== 'OFL') return refused(licenceName(oflMeta.license ?? 'unknown'), `ofl/${dir}/METADATA.pb says ${oflMeta.license}`);
    if (oflMeta?.name !== family) {
      for (const other of ['apache', 'ufl'] as const) {
        const answer = await ask(repositoryUrl(other, dir, 'METADATA.pb'));
        if (answer.status === 404) continue;
        if (answer.status !== 200) return pending(`${other}/${dir}/METADATA.pb answered ${answer.status}`);
        const meta = readMetadata(text(answer.bytes!));
        if (meta.name === family) return refused(licenceName(meta.license ?? (other === 'apache' ? 'APACHE2' : 'UFL')), `${other}/${dir}/METADATA.pb`);
      }
      return refused(REFUSED_REASONS.unlisted, `no ofl/, apache/ or ufl/${dir}/METADATA.pb names ${family}`);
    }
    const licence = await ask(repositoryUrl('ofl', dir, 'OFL.txt'));
    if (licence.status === 404) return refused(REFUSED_REASONS.unreadable, `ofl/${dir} has no OFL.txt`);
    if (licence.status !== 200) return pending(`ofl/${dir}/OFL.txt answered ${licence.status}`);

    // the files: the unsliced answer, else the TTF form
    let parsed: Css2Answer | null = null;
    for (const userAgent of [UNSLICED_USER_AGENT, undefined]) {
      const css = await ask(request.url, userAgent);
      if (css.status === 400) return refused(REFUSED_REASONS.unserved, `CSS2 answered 400 for ${request.url}`);
      if (css.status !== 200) return pending(`CSS2 answered ${css.status}`);
      parsed = parseCss2(text(css.bytes!), family);
      if (parsed.ok || !parsed.sliced) break;
    }
    if (!parsed!.ok) return refused(REFUSED_REASONS.unreadable, parsed!.problem);
    let total = licence.bytes!.length;
    const files: Extract<Fetched, { kind: 'saved' }>['files'] = [];
    for (const file of parsed!.files) {
      const answer = await ask(file.url);
      if (answer.status !== 200) return pending(`${file.url} answered ${answer.status}`);
      const type = fontType(answer.bytes!);
      if (!type) return refused(REFUSED_REASONS.unreadable, `${file.url} is not a font file`);
      total += answer.bytes!.length;
      if (total > FAMILY_MAX_BYTES) return refused(REFUSED_REASONS.tooLarge, `over ${FAMILY_MAX_BYTES} bytes`);
      files.push({ bytes: answer.bytes!, ...type, weight: file.weight, style: file.style });
    }
    return { kind: 'saved', licence: licence.bytes!, files };
  } catch (error) {
    if (error instanceof EgressError && error.failure === 'tooLarge') return asking.startsWith('https://fonts.gstatic.com/') ? refused(REFUSED_REASONS.tooLarge, error.message) : refused(REFUSED_REASONS.unreadable, error.message);
    if (error instanceof EgressError && error.failure === 'notAdmitted') return refused(REFUSED_REASONS.unreadable, error.message);
    return pending(error instanceof Error ? error.message : String(error));
  }
}

export interface GoogleFacesOptions {
  /** The guarded GET (the `google-fonts` rule over the network by default). */
  get: EgressGet;
  now?: () => number;
  log?: (line: string) => void;
  retryAfterMs?: number;
  backoffMs?: readonly number[];
  /** Arms a retry; the default an unref'd setTimeout. */
  setTimer?: (run: () => void, ms: number) => { cancel(): void };
}

export interface GoogleFaces {
  close(): void;
  /** Resolves once nothing is queued or running (the tests). */
  idle(): Promise<void>;
}

interface Target {
  artifactId: string;
  key: string;
}
interface Waiting {
  request: GoogleRequest;
  targets: Map<string, Target>;
  attempts: number;
  lastAt: number;
  timer: { cancel(): void } | null;
}

const targetKey = (t: Target) => `${t.artifactId}\u0000${t.key}`;

/** Whether `face` still asks the host for `request`: its canonical request is it, and no record answers it. */
function asks(face: unknown, request: GoogleRequest): boolean {
  if (!face || typeof face !== 'object') return false;
  const f = face as DeckFace;
  if (typeof f.href !== 'string' || typeof f.family !== 'string') return false;
  const asked = googleRequest(f.family, f.href);
  return asked.ok && asked.request.url === request.url && googleRecord(f) === null;
}

class Discarded extends Error {}
/** A record the write's refs would leave unreadable: the write is taken back and the request waits as a failure does. */
class Unrecordable extends Error {}

export function startGoogleFaces(documents: Pick<Documents, 'store' | 'service'>, options: GoogleFacesOptions): GoogleFaces {
  const { store, service } = documents;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(`[google-fonts] ${line}`));
  const retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_MS;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const setTimer =
    options.setTimer ??
    ((run: () => void, ms: number) => {
      const handle = setTimeout(run, ms);
      handle.unref?.();
      return { cancel: () => clearTimeout(handle) };
    });
  const jobs = new Map<string, { request: GoogleRequest; targets: Map<string, Target> }>(); // queued or fetching, by request
  const queue: string[] = [];
  const waiting = new Map<string, Waiting>(); // pending after a failed attempt, by request
  const noted = new Set<string>();
  const aborter = new AbortController();
  let pumping: Promise<void> | null = null;
  let noting: ReturnType<typeof setImmediate> | null = null;
  let closed = false;

  // A commit or a load names an artifact; its faces are read after the turn (a load runs inside whatever opened it).
  const note = (artifactId: string) => {
    if (closed || mainOf(artifactId) !== null) return;
    noted.add(artifactId);
    noting ??= setImmediate(() => {
      noting = null;
      const ids = [...noted];
      noted.clear();
      for (const id of ids) {
        try {
          consider(id);
        } catch (error) {
          log(`${id}'s faces could not be read: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  };

  function consider(artifactId: string): void {
    if (closed) return;
    const artifact = store.get(artifactId);
    const doc = artifact && KINDS.has(artifact.kind) ? service.loaded(artifactId) : null;
    if (!doc) return;
    for (const [key, face] of Object.entries(Y.deckEntries(doc, 'faces') ?? {})) {
      const f = face as unknown as DeckFace;
      if (!face || typeof face !== 'object' || typeof f.href !== 'string' || typeof f.family !== 'string' || googleRecord(f)) continue;
      const asked = googleRequest(f.family, f.href);
      if (asked.ok) want(asked.request, { artifactId, key });
    }
  }

  function want(request: GoogleRequest, target: Target): void {
    const job = jobs.get(request.url);
    if (job) return void job.targets.set(targetKey(target), target);
    const pendingOne = waiting.get(request.url);
    if (pendingOne) {
      pendingOne.targets.set(targetKey(target), target);
      if (now() - pendingOne.lastAt >= retryAfterMs) retry(request.url);
      return;
    }
    enqueue(request, new Map([[targetKey(target), target]]));
  }

  function enqueue(request: GoogleRequest, targets: Map<string, Target>): void {
    jobs.set(request.url, { request, targets });
    queue.push(request.url);
    pumping ??= pump().finally(() => (pumping = null));
  }

  function retry(url: string): void {
    const pendingOne = waiting.get(url);
    if (!pendingOne || closed) return;
    pendingOne.timer?.cancel();
    pendingOne.timer = null;
    enqueue(pendingOne.request, pendingOne.targets); // `waiting` keeps its attempts until the job settles
  }

  // The live face of a target, read from a doc loaded (or loaded now) for a live artifact; undefined when it is gone.
  function liveFace(target: Target): unknown {
    const artifact = store.get(target.artifactId);
    if (!artifact || !KINDS.has(artifact.kind)) return undefined;
    return Y.deckEntries(service.loaded(target.artifactId) ?? service.live(target.artifactId), 'faces')?.[target.key];
  }

  async function pump(): Promise<void> {
    while (queue.length > 0 && !closed) {
      const url = queue.shift()!;
      const job = jobs.get(url)!;
      // the targets that still ask for it (an earlier job's write, an edit or a deletion since may have answered them)
      for (const [k, target] of job.targets) {
        let still = false;
        try {
          still = asks(liveFace(target), job.request);
        } catch (error) {
          log(`${target.artifactId} could not be read for ${job.request.family}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!still) job.targets.delete(k);
      }
      if (job.targets.size === 0) {
        jobs.delete(url);
        settle(url, null);
        continue;
      }
      const fetched = await fetchFamily(job.request, options.get, aborter.signal);
      jobs.delete(url); // a target asking from here on starts a new job, which re-checks before it fetches
      if (closed) return;
      const family = job.request.family;
      if (fetched.kind === 'pending') {
        log(`${family}: pending (${fetched.detail})`);
        settle(url, job);
        continue;
      }
      log(fetched.kind === 'saved' ? `${family}: saved ${fetched.files.length} file(s) under OFL` : `${family}: refused ${fetched.refused} (${fetched.detail})`);
      const unwritten = new Map<string, Target>();
      for (const [k, target] of job.targets) if (!(await land(target, job.request, fetched))) unwritten.set(k, target);
      // never a loop: a target its write could not record waits out the backoff, its attempts counted on (a commit or load
      // past the pause retries); the request's wait ends once every target is written, discarded or gone
      settle(url, unwritten.size > 0 ? { request: job.request, targets: unwritten } : null);
    }
  }

  // After a job: pending re-arms the backoff over its targets; anything else ends the request's wait.
  function settle(url: string, failed: { request: GoogleRequest; targets: Map<string, Target> } | null): void {
    const was = waiting.get(url);
    was?.timer?.cancel();
    if (!failed) return void waiting.delete(url);
    const attempts = (was?.attempts ?? 0) + 1;
    const targets = new Map([...(was?.targets ?? []), ...failed.targets]);
    const entry: Waiting = { request: failed.request, targets, attempts, lastAt: now(), timer: null };
    entry.timer = setTimer(() => retry(url), backoff[Math.min(attempts - 1, backoff.length - 1)]!);
    waiting.set(url, entry);
  }

  // Whether the target is settled: written, discarded, or gone; false when the record could not be written.
  async function land(target: Target, request: GoogleRequest, fetched: Exclude<Fetched, { kind: 'pending' }>): Promise<boolean> {
    const { artifactId, key } = target;
    const assets =
      fetched.kind === 'saved'
        ? [{ bytes: fetched.licence, name: licenceAssetName(request.dir), mime: 'text/plain' }, ...fetched.files.map((file) => ({ bytes: file.bytes, name: fileAssetName(request.dir, file, file.ext), mime: file.mime }))]
        : [];
    try {
      await store.writeWithAssets(
        artifactId,
        HUMAN,
        assets,
        (doc, refs) => {
          const face = Y.deckEntries(doc, 'faces')![key] as unknown as DeckFace;
          const google =
            fetched.kind === 'saved'
              ? { request: request.url, licence: 'OFL', licenceSrc: refs[0]!.ref, files: fetched.files.map((file, i) => ({ src: refs[i + 1]!.ref, weight: file.weight, style: file.style })) }
              : { request: request.url, refused: fetched.refused };
          const next = { ...face, google };
          if (!googleRecord(next)) throw new Unrecordable(`the refs ${refs.map((r) => r.ref).join(', ')} make no record the readers take`);
          Y.setDeckEntry(doc, 'faces', key, next as unknown as Y.Json);
        },
        {
          prepare: () => {
            if (closed) throw new Discarded();
            if (!asks(Y.deckEntries(service.live(artifactId), 'faces')?.[key], request)) throw new Discarded();
          },
        },
      );
    } catch (error) {
      if (error instanceof Discarded || (error instanceof ArtifactStoreError && error.code === 'notFound')) return true;
      log(`${request.family} could not be written into ${artifactId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    return true;
  }

  const offs = [service.onCommitted(({ artifactId }) => note(artifactId)), service.onLoad(note)];
  return {
    close: () => {
      closed = true;
      for (const off of offs) off();
      if (noting) clearImmediate(noting);
      for (const entry of waiting.values()) entry.timer?.cancel();
      waiting.clear();
      aborter.abort();
    },
    idle: async () => {
      for (;;) {
        await new Promise((resolve) => setImmediate(resolve)); // the noted faces read, the jobs they asked for queued
        if (!pumping && !noting) return;
        await pumping;
      }
    },
  };
}

/** The host's wiring (beside registerPresentations and registerDesigns): the `google-fonts` rule over the network, or
 * the e2e's fixtures under MAWS_E2E=1. */
export function registerGoogleFaces({ documents, env = process.env }: { documents: Pick<Documents, 'store' | 'service'> | null; env?: Record<string, string | undefined> }): { close(): void } {
  if (!documents) return { close: () => {} };
  return startGoogleFaces(documents, { get: egressGet(GOOGLE_FONTS_EGRESS, egressBase(env)) });
}
