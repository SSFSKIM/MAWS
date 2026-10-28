// The signature ledger (O10 M6; RL §5.7; Interfaces §E's `signatures/<project id>.jsonl`): what the endpoint signed for
// each of this machine's own events, kept so an event goes up signed once and is resent byte for byte. ECDSA is
// randomized, so a second signature over the same body would be different bytes, which the hub refuses as a conflict
// at a position it holds; the ledger keeps the first.
//
// An own event is handled in one deterministic upload form: the event as sminos stored it (`ts`, no `created`), with
// `created` derived from its own `ts`: verbatim when it has milliseconds, `.000` added to a whole second from an older
// log; never the upload time, which would change a resend's bytes. An event that already carries another `created`, or
// whose `ts` is neither form, has no upload form (`malformed`). Signing, the ledger's body hash, a resend's rebuild,
// `words?`'s comparison and the echo check all use the upload form, so one body has one hash wherever it is met.
//
// One line per signed position: `{writer, seq, hash, sig, attest?, mac?}`, appended and fsynced before the event leaves.
// A torn last line is left out on reading, which only means the position is signed again (it never left).
import { createHash } from 'node:crypto';
import { canonicalize, isSig, type Sig } from 'org-protocol';
import type { Attest } from 'org-protocol';
import { appendLines, readLines } from '../state/files';

const TS_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TS_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The `created` an own event is signed with, derived from its `ts`; null for a `ts` of neither form. */
export function createdOf(ts: unknown): string | null {
  if (typeof ts !== 'string') return null;
  if (TS_MILLIS.test(ts)) return ts;
  if (TS_SECONDS.test(ts)) return `${ts.slice(0, -1)}.000Z`;
  return null;
}

/** What the endpoint adds to an own event as it goes up, and what an echo of it carries back beside the upload form. */
export const ENDPOINT_ADDS = ['sig', 'attest', 'mac'] as const;

export type Event = Record<string, unknown> & { writer: string; seq: number };

/**
 * The upload form of an own event (the event with `created` derived from its `ts`, sminos's `verified` verdict and what
 * the endpoint adds left out), or null when it has none: a `ts` of neither form, or a `created` other than the derived.
 */
export function uploadForm(event: Record<string, unknown>): Record<string, unknown> | null {
  const created = createdOf(event.ts);
  if (created === null || ('created' in event && event.created !== created)) return null;
  const form: Record<string, unknown> = { ...event, created };
  delete form.verified;
  for (const field of ENDPOINT_ADDS) delete form[field];
  return form;
}

/** SHA-256 of the upload form's canonical JSON, base64url: the ledger's body hash. Throws for a value JSON can't hold. */
export function bodyHash(form: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(form)).digest('base64url');
}

export type Signature = { hash: string; sig: Sig; attest?: Attest; mac?: { nonce: string; value: string } };
type Line = Signature & { writer: string; seq: number };

/** A project id as a file name: what sminos and the hub use (a UUID, a machine project's), nothing that leaves the directory. */
export const isProjectFileName = (project: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(project);

const key = (writer: string, seq: number) => `${writer}\n${seq}`;

export class SignatureLedger {
  readonly #dir: () => string;
  readonly #projects = new Map<string, Map<string, Signature>>();

  /** `dir` gives `signatures/` (made private on first use). */
  constructor(dir: () => string) {
    this.#dir = dir;
  }

  /** What was signed at `(project, writer, seq)`, or null. */
  get(project: string, writer: string, seq: number): Signature | null {
    return this.#load(project).get(key(writer, seq)) ?? null;
  }

  /** Each writer's highest signed `seq` in `project`. */
  reach(project: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const k of this.#load(project).keys()) {
      const at = k.lastIndexOf('\n');
      const writer = k.slice(0, at);
      const seq = Number(k.slice(at + 1));
      if (seq > (out.get(writer) ?? 0)) out.set(writer, seq);
    }
    return out;
  }

  /** Drops what was read: `signatures/` was moved aside (an enrollment under another authority), and is read anew. */
  forget(): void {
    this.#projects.clear();
  }

  /** Keeps what was signed at a position, on disk before it returns. */
  put(project: string, writer: string, seq: number, signature: Signature): void {
    const line: Line = { writer, seq, ...signature };
    appendLines(this.#dir(), `${project}.jsonl`, [JSON.stringify(line)]);
    this.#load(project).set(key(writer, seq), signature);
  }

  #load(project: string): Map<string, Signature> {
    if (!isProjectFileName(project)) throw new Error(`no ledger for a project id that is no file name (${project.slice(0, 64)})`);
    let held = this.#projects.get(project);
    if (held !== undefined) return held;
    held = new Map();
    for (const raw of readLines(this.#dir(), `${project}.jsonl`)) {
      const line = raw as Partial<Line> | null;
      if (typeof line?.writer !== 'string' || !Number.isSafeInteger(line.seq) || typeof line.hash !== 'string' || !isSig(line.sig)) continue;
      // The first signature at a position is the one that went up; a later line there (none is written) is ignored.
      if (!held.has(key(line.writer, line.seq as number))) {
        held.set(key(line.writer, line.seq as number), { hash: line.hash, sig: line.sig, ...(line.attest === undefined ? {} : { attest: line.attest }), ...(line.mac === undefined ? {} : { mac: line.mac }) });
      }
    }
    this.#projects.set(project, held);
    return held;
  }
}
