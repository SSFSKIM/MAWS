// The linked-directory mirror (the P3-L document, Decision Log 12; parent §4.1 and Decision Log 8): every live artifact
// in a Space linked to a project directory is written read-only under `<linkedDir>/artifacts/` by its kind's writer
// (`@artifacts/library/mirror`), so an agent's grep finds it. It runs here, in the engine host, so it follows every
// save with every window closed and main absent (detached mode).
//
// - A change is written once it settles: MIRROR_SETTLE_MS after the artifact's last change event (the store's own feed
//   coalesces a document's commits to one per 250 ms), and no later than MIRROR_MAX_WAIT_MS after the first one of an
//   unbroken run. A Space change reconciles every linked directory at once.
// - Each file is written atomically (a temp file in the same directory, made 0444, renamed over the target).
// - The manifest `<linkedDir>/artifacts/.maws-mirror.json` names every file the mirror wrote, per artifact, with the
//   revision and slug it wrote them at. A rename, a move out of the Space, a delete or an unlink removes exactly those
//   files; a file at a target name that the manifest does not own is left alone (logged), never overwritten. An
//   artifact whose revision and slug match its entry, with its files present, is not rewritten.
// - Two Spaces linked to one directory share its manifest (the desired set is per directory).
// - A directory that fails (gone, unwritable, a link) is logged per Space and tried again at the next change, which
//   reconciles the whole directory once it loads again; the linked directory itself is never created, and no write or
//   removal passes through a link inside it.
// - At start every linked directory is reconciled against its manifest: what changed while the host was down.
//
// Reads go through P3-A's public store methods behind the commit barrier (the mirror never writes a row its batch may
// yet take back); the only durable state is the manifest in the linked directory (ruling 18(a)).
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mirrorSlug, mirrorWriterFor } from '@artifacts/library/mirror';
import { applyV2, newDoc } from '@artifacts/yjs';
import { isDocKind, type Artifact, type Space } from '@shared/artifacts/entity';
import { byteContentOf, fileBytes, type LibraryDocuments } from './reads';

export const MIRROR_SETTLE_MS = 1_000;
export const MIRROR_MAX_WAIT_MS = 10_000;
export const MIRROR_FILE_MAX_BYTES = 64 * 1024 * 1024; // a File artifact larger than this is mirrored as nothing
export const MIRROR_MANIFEST = '.maws-mirror.json';
const MIRROR_DIR = 'artifacts';

interface ManifestEntry {
  revision: number;
  slug: string;
  files: string[]; // relative to `<linkedDir>/artifacts/`
}
interface Manifest {
  version: 1;
  artifacts: Record<string, ManifestEntry>;
}

export interface MirrorOptions {
  log?: (line: string) => void;
  settleMs?: number;
  maxWaitMs?: number;
  maxFileBytes?: number;
}

// One artifact's content as read inside the barrier; the writer runs after it.
type ContentRead = { state: Uint8Array } | { bytes: Uint8Array; name: string } | { path: string; name: string } | null;

export class LibraryMirror {
  private readonly log: (line: string) => void;
  private readonly settleMs: number;
  private readonly maxWaitMs: number;
  private readonly maxFileBytes: number;
  private readonly timers = new Map<string, { timer: ReturnType<typeof setTimeout>; since: number }>();
  private readonly manifests = new Map<string, Manifest>(); // by the resolved linked directory, as loaded or written
  private readonly failing = new Set<string>(); // linked directories whose last load failed
  private readonly saved = new Map<string, string>(); // per directory, the manifest as last written
  private chain: Promise<void> = Promise.resolve();
  private reconcileQueued = false;
  private offs: (() => void)[] = [];
  private stopped = false;

  constructor(
    private readonly documents: LibraryDocuments,
    options: MirrorOptions = {},
  ) {
    this.log = options.log ?? ((line) => console.warn(`[library] ${line}`));
    this.settleMs = options.settleMs ?? MIRROR_SETTLE_MS;
    this.maxWaitMs = options.maxWaitMs ?? MIRROR_MAX_WAIT_MS;
    this.maxFileBytes = options.maxFileBytes ?? MIRROR_FILE_MAX_BYTES;
  }

  // Follows the store's changes and reconciles every linked directory; resolves when that reconciliation is done.
  start(): Promise<void> {
    const { store } = this.documents;
    this.offs = [store.onChange(({ artifactId }) => this.schedule(artifactId)), store.onSpaceChange(() => void this.reconcile())];
    return this.reconcile();
  }

  // Writes every pending change now rather than at its settle; resolves when the mirror is idle.
  async flush(): Promise<void> {
    for (;;) {
      for (const [artifactId, { timer }] of this.timers) {
        clearTimeout(timer);
        this.timers.delete(artifactId);
        void this.enqueue(() => this.syncArtifact(artifactId));
      }
      const chain = this.chain;
      await chain;
      if (chain === this.chain && this.timers.size === 0) return;
    }
  }

  close(): void {
    this.stopped = true;
    for (const off of this.offs.splice(0)) off();
    for (const { timer } of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  // ---- scheduling ----------------------------------------------------------------------------------------------------

  private schedule(artifactId: string): void {
    if (this.stopped) return;
    const now = Date.now();
    const slot = this.timers.get(artifactId);
    if (slot) clearTimeout(slot.timer);
    const since = slot?.since ?? now;
    const delay = Math.max(0, Math.min(this.settleMs, since + this.maxWaitMs - now));
    const timer = setTimeout(() => {
      this.timers.delete(artifactId);
      this.enqueue(() => this.syncArtifact(artifactId));
    }, delay);
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(artifactId, { timer, since });
  }

  // Every step runs on one chain, so the manifests are only ever touched by one step at a time.
  private enqueue(step: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.stopped) return;
      try {
        await step();
      } catch (error) {
        if (!this.stopped) this.log(`the mirror failed a step: ${reasonOf(error)}`);
      }
    });
    return this.chain;
  }

  private reconcile(): Promise<void> {
    if (this.reconcileQueued) return this.chain;
    this.reconcileQueued = true;
    return this.enqueue(async () => {
      this.reconcileQueued = false;
      await this.reconcileAll();
    });
  }

  // ---- the work ------------------------------------------------------------------------------------------------------

  // Every linked directory (and every one this run mirrored into, now unlinked) against its desired set.
  private async reconcileAll(): Promise<void> {
    const { store } = this.documents;
    const { spaces, artifacts } = await store.readCommitted(() => ({ spaces: store.listSpaces(), artifacts: store.list() }));
    const linked = linkedDirs(spaces);
    for (const dir of new Set([...linked.keys(), ...this.manifests.keys()])) {
      const target = linked.get(dir);
      const members = target ? artifacts.filter((artifact) => artifact.spaceId !== undefined && target.spaceIds.has(artifact.spaceId)) : [];
      let manifest: Manifest;
      try {
        manifest = this.load(dir);
      } catch (error) {
        this.log(target ? `the Space ${target.names.join(', ')} could not be mirrored to ${dir}: ${reasonOf(error)}` : `the unlinked directory ${dir} could not be cleaned: ${reasonOf(error)}`);
        this.manifests.delete(dir);
        if (target) this.failing.add(dir);
        continue;
      }
      try {
        for (const artifactId of Object.keys(manifest.artifacts)) if (!members.some((artifact) => artifact.id === artifactId)) this.remove(dir, manifest, artifactId);
        for (const artifact of members) {
          if (this.stopped) return;
          try {
            await this.upsert(dir, manifest, artifact.id);
          } catch (error) {
            this.log(`${artifact.id} could not be mirrored to ${dir}: ${reasonOf(error)}`);
          }
          await new Promise((resolve) => setImmediate(resolve)); // a reconciliation of many never holds the host's loop
        }
      } catch (error) {
        this.log(`the mirror in ${dir} could not be brought up to date: ${reasonOf(error)}`);
      } finally {
        this.saveLogged(dir, manifest);
      }
      if (!target) this.manifests.delete(dir);
    }
  }

  // One artifact: written where its Space is linked, removed from every other directory this run knows it in.
  private async syncArtifact(artifactId: string): Promise<void> {
    const { store } = this.documents;
    const { artifact, space } = await store.readCommitted(() => {
      const found = store.get(artifactId);
      return { artifact: found, space: found?.spaceId === undefined ? undefined : store.listSpaces().find((candidate) => candidate.id === found.spaceId) };
    });
    const dir = artifact && space?.linkedDir !== undefined ? resolve(space.linkedDir) : null;
    for (const [known, manifest] of this.manifests) {
      if (known === dir || !manifest.artifacts[artifactId]) continue;
      try {
        this.remove(known, manifest, artifactId);
      } catch (error) {
        this.log(`${artifactId} could not be removed from the mirror in ${known}: ${reasonOf(error)}`);
      } finally {
        this.saveLogged(known, manifest);
      }
    }
    if (!dir || !artifact || !space) return;
    let manifest: Manifest;
    try {
      manifest = this.load(dir);
    } catch (error) {
      this.failing.add(dir);
      return this.log(`the Space ${space.name} could not be mirrored to ${dir}: ${reasonOf(error)}`);
    }
    try {
      await this.upsert(dir, manifest, artifactId);
    } catch (error) {
      this.log(`${artifactId} could not be mirrored to ${dir} (the Space ${space.name}): ${reasonOf(error)}`);
    } finally {
      this.saveLogged(dir, manifest);
    }
  }

  // Writes the artifact's files as it stands now unless its entry is current; removes the files it no longer produces.
  private async upsert(dir: string, manifest: Manifest, artifactId: string): Promise<void> {
    const { store, service } = this.documents;
    const root = join(dir, MIRROR_DIR);
    const read = await store.readCommitted((): { artifact: Artifact; revision: number; content: ContentRead } | null => {
      const artifact = store.get(artifactId);
      if (!artifact) return null; // deleted since: its event removes it
      const revision = store.revision(artifactId);
      const entry = manifest.artifacts[artifactId];
      if (entry && entry.revision === revision && entry.slug === mirrorSlug(artifact) && entry.files.every((file) => existsSync(join(root, file)))) return null; // current
      if (!mirrorWriterFor(artifact.kind)) return { artifact, revision, content: null };
      if (isDocKind(artifact.kind)) return { artifact, revision, content: { state: service.readState(artifactId).state } };
      return { artifact, revision, content: byteContentOf(store, artifactId) };
    });
    const entry = manifest.artifacts[artifactId];
    if (!read || (read.content === null && !entry)) return; // current, gone, or nothing to write and nothing written
    const { artifact, revision, content } = read;
    const files = content === null ? {} : this.produce(artifact, content);
    const owned = new Set(Object.values(manifest.artifacts).flatMap((other) => other.files));
    const mine = new Set(entry?.files ?? []);
    const written: string[] = [];
    let failure: { error: unknown } | null = null;
    for (const [file, data] of Object.entries(files)) {
      if (!isMirrorPath(file)) {
        this.log(`${artifactId}: ${JSON.stringify(file)} is not a path the mirror writes`);
        continue;
      }
      const target = join(root, file);
      if (!mine.has(file) && (owned.has(file) || existsSync(target))) {
        this.log(`${artifactId}: ${target} is not the mirror's file; not written`);
        continue;
      }
      if (!realDirsUnder(root, file)) {
        this.log(`${artifactId}: ${target} lies under a link; not written`);
        continue;
      }
      try {
        writeReadOnly(root, file, data);
      } catch (error) {
        failure = { error };
        break;
      }
      written.push(file);
    }
    // The entry names every file of the artifact the mirror has on disk, so a write that failed half-way leaves no file
    // unowned; it keeps the old files and is retried at the next change (no revision matches -1).
    const stale = failure ? [] : [...mine].filter((file) => !written.includes(file));
    for (const file of stale) removeFile(root, file);
    const kept = [...new Set([...written, ...[...mine].filter((file) => !stale.includes(file))])].sort();
    if (kept.length > 0) manifest.artifacts[artifactId] = { revision: failure ? -1 : revision, slug: mirrorSlug(artifact), files: kept };
    else delete manifest.artifacts[artifactId];
    if (failure) throw failure.error;
  }

  // The kind's writer over what was read; a document's replica lives only for the call.
  private produce(artifact: Artifact, content: Exclude<ContentRead, null>): Record<string, string | Uint8Array> {
    const writer = mirrorWriterFor(artifact.kind)!;
    if ('bytes' in content) return writer({ artifact, bytes: content.bytes, name: content.name }).files;
    if ('path' in content) {
      const bytes = fileBytes(content.path, this.maxFileBytes);
      if (!bytes) this.log(`${artifact.id}: ${content.path} is too large to mirror (over ${this.maxFileBytes} bytes) or cannot be read; mirrored as nothing`);
      return writer({ artifact, name: content.name, ...(bytes ? { bytes } : {}) }).files;
    }
    const doc = newDoc();
    try {
      applyV2(doc, content.state);
      return writer({ artifact, doc }).files;
    } finally {
      doc.destroy();
    }
  }

  private remove(dir: string, manifest: Manifest, artifactId: string): void {
    for (const file of manifest.artifacts[artifactId]?.files ?? []) removeFile(join(dir, MIRROR_DIR), file);
    delete manifest.artifacts[artifactId];
  }

  // The directory's manifest, cached once read. The linked directory must exist; its `artifacts/` need not yet.
  private load(dir: string): Manifest {
    if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`); // checked every time: never recreated
    const root = join(dir, MIRROR_DIR);
    if (!realDirsUnder(root, MIRROR_MANIFEST)) throw new Error(`${root} is not a directory of its own (a link, or a file)`);
    if (this.failing.delete(dir)) void this.reconcile(); // working again: the changes it missed, after this step
    const cached = this.manifests.get(dir);
    if (cached) return cached;
    const path = join(root, MIRROR_MANIFEST);
    const manifest: Manifest = { version: 1, artifacts: {} };
    if (existsSync(path)) {
      try {
        Object.assign(manifest.artifacts, manifestEntries(JSON.parse(readFileSync(path, 'utf8'))));
      } catch (error) {
        this.log(`the mirror manifest ${path} is unreadable (${reasonOf(error)}); the files it named are left as the owner's`);
      }
    }
    this.manifests.set(dir, manifest);
    return manifest;
  }

  private saveLogged(dir: string, manifest: Manifest): void {
    try {
      this.save(dir, manifest);
    } catch (error) {
      this.log(`the mirror manifest in ${dir} could not be written: ${reasonOf(error)}`);
    }
  }

  // Writes the manifest when it names a file, removes it (and an emptied `artifacts/`) when it names none.
  private save(dir: string, manifest: Manifest): void {
    const root = join(dir, MIRROR_DIR);
    const path = join(root, MIRROR_MANIFEST);
    if (Object.keys(manifest.artifacts).length === 0) {
      if (existsSync(path)) removeFile(root, MIRROR_MANIFEST);
      this.saved.delete(dir);
      return;
    }
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    if (this.saved.get(dir) === json && existsSync(path)) return; // unchanged: a no-op change writes nothing
    ensureRoot(root);
    const temp = join(root, `.${MIRROR_MANIFEST}.${randomUUID().slice(0, 8)}.tmp`);
    writeFileSync(temp, json);
    renameSync(temp, path);
    this.saved.set(dir, json);
  }
}

// Per resolved linked directory, the Spaces linked to it.
function linkedDirs(spaces: Space[]): Map<string, { spaceIds: Set<string>; names: string[] }> {
  const dirs = new Map<string, { spaceIds: Set<string>; names: string[] }>();
  for (const space of spaces) {
    if (space.linkedDir === undefined) continue;
    const dir = resolve(space.linkedDir);
    const entry = dirs.get(dir) ?? { spaceIds: new Set<string>(), names: [] };
    entry.spaceIds.add(space.id);
    entry.names.push(space.name);
    dirs.set(dir, entry);
  }
  return dirs;
}

// A manifest's entries as read from the directory, which anyone may have edited: an entry whose shape is wrong is
// dropped and a file name that is not a mirror path is never trusted (so nothing outside `artifacts/` is ever removed).
function manifestEntries(parsed: unknown): Record<string, ManifestEntry> {
  const { version, artifacts } = (parsed ?? {}) as Partial<Manifest>;
  if (version !== 1 || typeof artifacts !== 'object' || artifacts === null) throw new Error('not a version 1 manifest');
  const entries: Record<string, ManifestEntry> = {};
  for (const [artifactId, entry] of Object.entries(artifacts as Record<string, Partial<ManifestEntry>>)) {
    if (typeof entry?.revision !== 'number' || typeof entry.slug !== 'string' || !Array.isArray(entry.files)) continue;
    entries[artifactId] = { revision: entry.revision, slug: entry.slug, files: entry.files.filter((file): file is string => typeof file === 'string' && isMirrorPath(file)) };
  }
  return entries;
}

// True when `artifacts/` and every folder between it and `file` is a real directory or does not exist yet: never a link
// (a linked directory is the owner's project, possibly a clone, and a link inside it must not carry a write or a
// removal elsewhere).
function realDirsUnder(root: string, file: string): boolean {
  let dir = root;
  for (const segment of ['', ...file.split('/').slice(0, -1)]) {
    dir = join(dir, segment);
    let stat;
    try {
      stat = lstatSync(dir);
    } catch {
      return true; // missing: everything below it is made by the mirror
    }
    if (!stat.isDirectory()) return false;
  }
  return true;
}

// A writer's path: relative, `/`-separated, every segment a plain name, never the manifest.
function isMirrorPath(file: string): boolean {
  const segments = file.split('/');
  return file !== MIRROR_MANIFEST && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\') && !segment.includes('\u0000'));
}

// `artifacts/` is made in the linked directory only while that exists: never the linked directory itself.
function ensureRoot(root: string): void {
  if (!existsSync(root)) mkdirSync(root);
}

function writeReadOnly(root: string, file: string, data: string | Uint8Array): void {
  const target = join(root, file);
  ensureRoot(root);
  mkdirSync(dirname(target), { recursive: true }); // a writer's folders, under `artifacts/`
  const temp = join(dirname(target), `.mirror-${randomUUID().slice(0, 8)}.tmp`);
  try {
    writeFileSync(temp, data);
    chmodSync(temp, 0o444);
    renameSync(temp, target); // over a read-only file too: replacing a name needs the directory's permission only
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

// Removes one file, then each parent folder it leaves empty, up to (and including) `artifacts/` itself.
function removeFile(root: string, file: string): void {
  if (!realDirsUnder(root, file)) return;
  rmSync(join(root, file), { force: true });
  for (let dir = dirname(join(root, file)); dir.startsWith(root); dir = dirname(dir)) {
    try {
      rmdirSync(dir);
    } catch {
      return; // not empty, or gone
    }
    if (dir === root) return;
  }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
