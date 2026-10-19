// The linked-directory mirror's writers (the P3-L document, Decision Log 12; the P3 interface ledger §7): per kind,
// the files an artifact in a Space linked to a project directory is mirrored as, read-only, under
// `<linkedDir>/artifacts/`, so an agent's grep finds it. The engine host's mirror (src/engine-host/library/mirror.ts)
// runs the writer after each change settles, writes what it returns and owns every file through its manifest. `html`
// and `file` are written here; B registers `document` → `<slug>.md`, C `presentation` → a deck folder, D may register
// `design_system`; a kind without a writer is mirrored as nothing. Portable (§4.10): a writer is a pure function of what
// the host read, so it runs wherever the host does.
import type { Doc } from '@artifacts/yjs';
import type { Artifact, ArtifactKind } from '@shared/artifacts/entity';

// One of an artifact's assets as the store lists it (`artifacts.assets`'s shape): its ref (`assets/<name>`, what a format
// names it by), its name, type and size.
export interface MirrorAsset {
  ref: string;
  name: string;
  mime: string;
  size: number;
}

// What the host read for one artifact: a document kind's doc (a fresh replica of the committed state, destroyed after
// the writer returns), an html page's bytes, or (P3-F F10) a File artifact's `path`, its file in place, whose bytes the
// host copies through the file system and the writer never holds; and the content's file name. M6b (Decision Log 35,
// 37b): the artifact's assets, listed, and `readAsset`, which reads one asset's bytes by its ref when the writer asks (a
// design system's fonts land in its directory; an asset the writer does not need is never read); it throws for a ref
// the artifact does not hold.
export interface MirrorInput {
  artifact: Artifact;
  doc?: Doc;
  bytes?: Uint8Array;
  path?: string; // P3-F (F10)
  name?: string;
  assets?: MirrorAsset[];
  readAsset?(ref: string): Uint8Array;
}

// Paths relative to `<linkedDir>/artifacts/`, `/`-separated (a deck is a folder); each one named by the artifact's
// `mirrorSlug`, so two artifacts never claim one file.
export interface MirrorOutput {
  files: Record<string, string | Uint8Array | MirrorCopy | MirrorCopyFrom>;
}

// P3-F (F10, tracker L142): a file copied from `copyFrom`, a File artifact's file in place, by the host: through memory
// within its in-memory cap, cloned by the file system over it (no buffer, no time, no space), and mirrored as nothing
// only when an oversized file's clone fails.
export interface MirrorCopyFrom {
  copyFrom: string;
}
export const isMirrorCopyFrom = (data: unknown): data is MirrorCopyFrom => typeof data === 'object' && data !== null && typeof (data as MirrorCopyFrom).copyFrom === 'string';

// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 37 (1); the final review's A14): a copy, a
// file whose bytes never change under its name (a content-addressed asset: a ref names one content for good). The host
// keeps one already in place and calls `read` only to write one the mirror lacks, so a large asset is not read and
// rewritten at every change of the artifact.
export interface MirrorCopy {
  read(): Uint8Array;
}
export const isMirrorCopy = (data: unknown): data is MirrorCopy => typeof data === 'object' && data !== null && !(data instanceof Uint8Array) && typeof (data as MirrorCopy).read === 'function';

// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 29; the P3 spec's Decision Log 69): `inputs`,
// a writer's dependency fingerprint beyond the artifact's revision (a deck's: the governing design system and that
// system's revision, whose tokens its files resolve). The host keeps it in the artifact's manifest entry and holds the
// entry current only while both match; a kind without it is current on its revision alone. Read inside the host's
// commit barrier, so it is a pure function of committed state.
export type MirrorWriter = ((input: MirrorInput) => MirrorOutput) & { inputs?(artifact: Artifact): string };

const SLUG_MAX = 64; // characters of the title kept

// A name that is safe as one path segment on macOS, Linux and Windows: no separators, reserved or control characters,
// no leading dot (never a hidden file), one form of each character (NFC).
function segment(text: string): string {
  const printable = Array.from(text.normalize('NFC'), (char) => (char < ' ' || char === '\u007f' ? '-' : char)).join('');
  return printable
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
}

/** P3-E (E2 M5; E's Decision Log 32): the same sanitiser for a writer's own segments (a dashboard's snapshot names). */
export const mirrorSegment = segment;

// The title made path-safe, suffixed with the id's first 8 characters: what every writer names an artifact's files by.
export function mirrorSlug(artifact: Pick<Artifact, 'id' | 'title'>): string {
  const title = [...segment(artifact.title)].slice(0, SLUG_MAX).join('').replace(/[.-]+$/, '');
  return `${title || 'untitled'}-${artifact.id.slice(0, 8)}`;
}

const htmlWriter: MirrorWriter = ({ artifact, bytes }) => ({ files: bytes ? { [`${mirrorSlug(artifact)}.html`]: bytes } : {} });

const fileWriter: MirrorWriter = ({ artifact, path, name }) => ({ files: path ? { [`${mirrorSlug(artifact)}-${segment(name ?? '') || 'file'}`]: { copyFrom: path } } : {} }); // P3-F (F10)

// Per kind, its registrations in order, each its own object (one function registered twice is two registrations);
// the last one is the writer. The built-ins sit at the bottom of their kind's.
const registrations = new Map<ArtifactKind, { writer: MirrorWriter }[]>([
  ['html', [{ writer: htmlWriter }]],
  ['file', [{ writer: fileWriter }]],
]);

// Registers `writer` for `kind`; the last registration wins. The returned function removes this registration only
// (the one before it is the writer again) and does nothing the second time.
export function registerMirrorWriter(kind: ArtifactKind, writer: MirrorWriter): () => void {
  const registration = { writer };
  const list = registrations.get(kind) ?? [];
  registrations.set(kind, list);
  list.push(registration);
  return () => {
    const at = list.indexOf(registration);
    if (at !== -1) list.splice(at, 1);
  };
}

export function mirrorWriterFor(kind: ArtifactKind): MirrorWriter | undefined {
  return registrations.get(kind)?.at(-1)?.writer;
}
