// The linked-directory mirror's writers (the P3-L document, Decision Log 12; the P3 interface ledger §7): per kind,
// the files an artifact in a Space linked to a project directory is mirrored as, read-only, under
// `<linkedDir>/artifacts/`, so an agent's grep finds it. The engine host's mirror (src/engine-host/library/mirror.ts)
// runs the writer after each change settles, writes what it returns and owns every file through its manifest. `html`
// and `file` are written here; B registers `document` → `<slug>.md`, C `presentation` → a deck folder, D may register
// `design_system`; a kind without a writer is mirrored as nothing. Portable (§4.10): a writer is a pure function of what
// the host read, so it runs wherever the host does.
import type { Doc } from '@artifacts/yjs';
import type { Artifact, ArtifactKind } from '@shared/artifacts/entity';

// What the host read for one artifact: a document kind's doc (a fresh replica of the committed state, destroyed after
// the writer returns), a byte kind's content and its file name. `bytes` is absent when the host did not read the
// content (a file too large to mirror).
export interface MirrorInput {
  artifact: Artifact;
  doc?: Doc;
  bytes?: Uint8Array;
  name?: string;
}

// Paths relative to `<linkedDir>/artifacts/`, `/`-separated (a deck is a folder); each one named by the artifact's
// `mirrorSlug`, so two artifacts never claim one file.
export interface MirrorOutput {
  files: Record<string, string | Uint8Array>;
}

export type MirrorWriter = (input: MirrorInput) => MirrorOutput;

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

// The title made path-safe, suffixed with the id's first 8 characters: what every writer names an artifact's files by.
export function mirrorSlug(artifact: Pick<Artifact, 'id' | 'title'>): string {
  const title = [...segment(artifact.title)].slice(0, SLUG_MAX).join('').replace(/[.-]+$/, '');
  return `${title || 'untitled'}-${artifact.id.slice(0, 8)}`;
}

const htmlWriter: MirrorWriter = ({ artifact, bytes }) => ({ files: bytes ? { [`${mirrorSlug(artifact)}.html`]: bytes } : {} });

const fileWriter: MirrorWriter = ({ artifact, bytes, name }) => ({ files: bytes ? { [`${mirrorSlug(artifact)}-${segment(name ?? '') || 'file'}`]: bytes } : {} });

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
