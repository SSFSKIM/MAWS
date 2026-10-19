// The linked-directory mirror (the P3-L document, Decision Log 12; parent §4.1 and Decision Log 8): every live artifact
// in a Space linked to a project directory is written read-only under `<linkedDir>/artifacts/` by its kind's writer
// (`@artifacts/library/mirror`), so an agent's grep finds it. It runs here, in the engine host, so it follows every
// save with every window closed and main absent (detached mode).
//
// - A change is written once it settles: MIRROR_SETTLE_MS after the artifact's last change event (the store's own feed
//   coalesces a document's commits to one per 250 ms), and no later than MIRROR_MAX_WAIT_MS after the first one of an
//   unbroken run. A Space change reconciles every linked directory at once.
// - Each file is written atomically (a temp file in the same directory, made 0444, renamed over the target).
// - P3-F (F10, tracker L142): a File artifact's file is copied through memory within MIRROR_FILE_MAX_BYTES, as before;
//   one over it is cloned into the temp by the file system (`cloneFile`: no buffer, no time, no space), and mirrored as
//   nothing (logged) only when that clone fails, so the cap bounds the in-memory path, not what is mirrored.
// - The manifest `<linkedDir>/artifacts/.maws-mirror.json` names every file the mirror wrote, per artifact, with the
//   revision and slug it wrote them at. A rename, a move out of the Space, a delete or an unlink removes exactly those
//   files; a file at a target name that the manifest does not own is left alone (logged), never overwritten. An
//   artifact whose revision and slug match its entry, with its files present (regular files, not links), is not
//   rewritten. A name that the volume resolves to the very entry of one the mirror owns (on APFS: by case or Unicode
//   normalization, ß and SS, a final sigma) is that file, so such a rename keeps it; any other name, an owner's hard
//   link included, is not.
// - Something at the manifest's path that is not a MAWS manifest (another file, a link, dangling or not) is the
//   owner's: the directory is refused (logged, as a failing one) and that entry never rewritten or removed.
// - Two Spaces linked to one directory share its manifest (the desired set is per directory). A directory is known by
//   its real path, so two spellings of it (through a link, or by case on a case-insensitive volume) are one. A Space
//   whose path comes to reach another directory (a link on it restored or retargeted) is reconciled after the first
//   step that sees it, whichever Space's artifact that step was for.
// - A directory that fails (gone, unwritable, a link) is logged per Space and tried again at the next change, which
//   reconciles the whole directory once it loads again; what the mirror owns there stays owned meanwhile. The linked
//   directory itself is never created, and no write or removal, the manifest's included, passes through a link inside it
//   (a removal refused so is a failed one: the file stays owned).
// - At start every linked directory is reconciled against its manifest: what changed while the host was down.
// - P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 29; the P3 spec's Decision Log 69): a writer
//   that declares `inputs` (what its output depends on beyond the revision) has them kept in the entry beside the
//   revision, and the entry is current only while both match (an entry without them is rewritten once); `refresh`
//   schedules artifacts as their own change does, for a change elsewhere that their `inputs` may tell.
//
// Reads go through P3-A's public store methods behind the commit barrier (the mirror never writes a row its batch may
// yet take back); the only durable state is the manifest in the linked directory (ruling 18(a)).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMirrorCopy, isMirrorCopyFrom, mirrorSlug, mirrorWriterFor, type MirrorOutput } from '@artifacts/library/mirror';
import { applyV2, newDoc } from '@artifacts/yjs';
import { isDocKind, type Artifact, type Space } from '@shared/artifacts/entity';
import { byteContentOf, fileBytes, type LibraryDocuments } from './reads';
import { datasetRefsOf } from '../documents/retention'; // E3

export const MIRROR_SETTLE_MS = 1_000;
export const MIRROR_MAX_WAIT_MS = 10_000;
export const MIRROR_FILE_MAX_BYTES = 64 * 1024 * 1024; // P3-F (F10): a File artifact larger than this is cloned, not read
// P3-F (F10): a clone takes milliseconds whatever the size (2 GiB in under 10 ms on this Mac's APFS, a spawn of cp or of
// stat about 3 ms); each spawn of one that hangs (a file system that stalls) holds the host no longer than this, and is a
// failed clone
export const MIRROR_CLONE_TIMEOUT_MS = 2_000;
export const MIRROR_MANIFEST = '.maws-mirror.json';
const MIRROR_DIR = 'artifacts';

interface ManifestEntry {
  revision: number;
  inputs?: string; // P3-C: the writer's `inputs` it was written at, when its kind declares them (version 1, optional)
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
  cloneFile?: (from: string, to: string) => void; // P3-F (F10): `cloneFile` below unless a test stands in for it
}

// One artifact's content as read inside the barrier; the writer runs after it.
type ContentRead = { state: Uint8Array } | { bytes: Uint8Array; name: string } | { path: string; name: string } | null;
// M6b: the artifact's assets as the store listed them inside the barrier; their bytes are read only when a writer asks.
type AssetsRead = { ref: string; name: string; mime: string; size: number; sha256: string }[];
// What one artifact's mirror pass read inside the barrier, or null when its entry is current or it is gone (E3: named).
type MirrorRead = { artifact: Artifact; revision: number; inputs: string | undefined; content: ContentRead; assets: AssetsRead } | null;

export class LibraryMirror {
  private readonly log: (line: string) => void;
  private readonly settleMs: number;
  private readonly maxWaitMs: number;
  private readonly maxFileBytes: number;
  private readonly cloneFile: (from: string, to: string) => void;
  private readonly timers = new Map<string, { timer: ReturnType<typeof setTimeout>; since: number }>();
  private readonly manifests = new Map<string, Manifest>(); // by the linked directory's key (`keyOf`), as loaded or written
  private readonly realDirs = new Map<string, string>(); // per resolved linked directory, its real path when last found
  private readonly failing = new Set<string>(); // linked directories whose last load failed
  private readonly unlinked = new Set<string>(); // directories no Space links whose mirror is not yet fully removed
  private readonly saved = new Map<string, string>(); // per directory, the manifest as last written
  private spaceKeys = new Map<string, string>(); // P4 (tracker L254): per linked Space, its directory's key at the last step
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
    this.cloneFile = options.cloneFile ?? cloneFile;
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

  // P3-C (Decision Log 29): schedules each artifact as its change would; one whose entry is current (its revision and its
  // writer's `inputs` unchanged) is not rewritten, so a caller may name more than changed.
  refresh(artifactIds: Iterable<string>): void {
    for (const artifactId of artifactIds) this.schedule(artifactId);
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
      void this.enqueue(() => this.syncArtifact(artifactId));
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
    const { linked } = this.linkedNow(spaces); // a key moved since is reconciled by this pass itself
    this.track(linked);
    for (const [dir, target] of linked) {
      const members = artifacts.filter((artifact) => artifact.spaceId !== undefined && target.spaceIds.has(artifact.spaceId));
      let manifest: Manifest;
      try {
        manifest = this.load(dir);
      } catch (error) {
        this.log(`the Space ${target.names.join(', ')} could not be mirrored to ${dir}: ${reasonOf(error)}`);
        this.failing.add(dir); // a cached manifest stays: if the Space is unlinked meanwhile, its files are still known
        continue;
      }
      try {
        for (const artifactId of Object.keys(manifest.artifacts)) {
          if (members.some((artifact) => artifact.id === artifactId)) continue;
          try {
            this.remove(dir, manifest, artifactId);
          } catch (error) {
            this.log(`${artifactId} could not be removed from the mirror in ${dir}: ${reasonOf(error)}`);
          }
        }
        for (const artifact of members) {
          if (this.stopped) return;
          try {
            await this.upsert(dir, manifest, artifact.id);
          } catch (error) {
            this.log(`${artifact.id} could not be mirrored to ${dir}: ${reasonOf(error)}`);
          }
          await new Promise((resolve) => setImmediate(resolve)); // a reconciliation of many never holds the host's loop
        }
      } finally {
        this.saveLogged(dir, manifest);
      }
    }
  }

  // The linked directories by their keys now, each Space's kept for the next step. P4 (tracker L254): `moved` when a
  // Space linked at the last step has another key now (its link restored, retargeted or removed), since nothing else
  // loads the directory it reaches until a step for that Space's own artifacts, so its other artifacts would wait; a
  // Space not linked at the last step is not compared, as linking it was a Space change, which reconciles.
  private linkedNow(spaces: Space[]): { linked: ReturnType<typeof linkedDirs>; moved: boolean } {
    const linked = linkedDirs(spaces, (dir) => this.keyOf(dir));
    const keys = new Map<string, string>();
    for (const [dir, { spaceIds }] of linked) for (const spaceId of spaceIds) keys.set(spaceId, dir);
    const moved = [...keys].some(([spaceId, key]) => (this.spaceKeys.get(spaceId) ?? key) !== key);
    this.spaceKeys = keys;
    return { linked, moved };
  }

  // The head of every step: each directory this run knows, by its key now (one it knew by another, as one away since the
  // start is known by its resolved path, carries its manifest and its state over, so one directory never holds two
  // manifests), those no Space links pending removal (a directory that failed its first load included: its manifest may
  // name files), and their removals tried.
  private track(linked: Map<string, unknown>): void {
    for (const old of new Set([...this.manifests.keys(), ...this.failing, ...this.unlinked])) {
      const key = this.keyOf(old);
      if (key === old) continue;
      const manifest = this.manifests.get(old);
      const into = this.manifests.get(key);
      if (manifest && into) {
        for (const [artifactId, entry] of Object.entries(manifest.artifacts)) {
          const other = into.artifacts[artifactId];
          // named by both: every file stays owned, at a revision none matches, so the next write removes what it no longer produces
          into.artifacts[artifactId] = other ? { ...entry, revision: -1, files: [...new Set([...other.files, ...entry.files])] } : entry;
        }
      } else if (manifest) {
        this.manifests.set(key, manifest);
        const saved = this.saved.get(old);
        if (saved !== undefined) this.saved.set(key, saved);
      }
      this.manifests.delete(old);
      this.saved.delete(old);
      if (this.failing.delete(old)) this.failing.add(key);
      if (this.unlinked.delete(old)) this.unlinked.add(key);
    }
    for (const dir of new Set([...this.manifests.keys(), ...this.unlinked, ...this.failing])) if (!linked.has(dir)) this.unlinked.add(dir);
    for (const dir of linked.keys()) this.unlinked.delete(dir); // linked again: reconciled as any linked one
    this.cleanUnlinked();
  }

  // A linked directory's key: its real path; while the path reaches nothing, the real path it last reached if that is
  // away too (the directory itself is away), else its resolved path (never found this run, or a link on it removed or
  // retargeted, so a directory the path no longer reaches is never written).
  private keyOf(linkedDir: string): string {
    const resolved = resolve(linkedDir);
    try {
      const real = realpathSync.native(resolved); // a link above it followed, the case as the volume spells it
      this.realDirs.set(resolved, real);
      return real;
    } catch {
      const real = this.realDirs.get(resolved);
      return real !== undefined && !existsSync(real) ? real : resolved;
    }
  }

  // The directories no Space links any more: every file their manifests name removed. One stays pending (in memory
  // only, so until the host restarts) until its removals and its manifest's removal have all succeeded, and is tried
  // again at every later step.
  private cleanUnlinked(): void {
    for (const dir of [...this.unlinked]) {
      let manifest: Manifest;
      try {
        manifest = this.load(dir);
      } catch (error) {
        // kept pending: a directory that is away (an unmounted volume, a moved folder) may come back with the files
        if (existsSync(dir)) this.log(`the unlinked directory ${dir} could not be cleaned: ${reasonOf(error)}`);
        continue;
      }
      for (const artifactId of Object.keys(manifest.artifacts)) {
        try {
          this.remove(dir, manifest, artifactId);
        } catch (error) {
          this.log(`${artifactId} could not be removed from the unlinked directory ${dir}: ${reasonOf(error)}`);
        }
      }
      if (this.saveLogged(dir, manifest) && Object.keys(manifest.artifacts).length === 0) {
        this.unlinked.delete(dir);
        this.manifests.delete(dir);
        this.failing.delete(dir);
      }
    }
  }

  // One artifact: written where its Space is linked, removed from every other directory this run knows it in.
  private async syncArtifact(artifactId: string): Promise<void> {
    const { store } = this.documents;
    const { artifact, spaces } = await store.readCommitted(() => ({ artifact: store.get(artifactId), spaces: store.listSpaces() }));
    const space = artifact?.spaceId === undefined ? undefined : spaces.find((candidate) => candidate.id === artifact.spaceId);
    const { linked, moved } = this.linkedNow(spaces);
    this.track(linked);
    if (moved) void this.reconcile(); // after this step
    const dir = artifact && space?.linkedDir !== undefined ? this.keyOf(space.linkedDir) : null;
    for (const [known, manifest] of this.manifests) {
      if (known === dir || this.unlinked.has(known) || !manifest.artifacts[artifactId]) continue;
      try {
        this.load(known); // a directory away or refused keeps the entry, removed by the reconciliation its next load starts
      } catch (error) {
        this.failing.add(known);
        this.log(`${artifactId} could not be removed from the mirror in ${known}: ${reasonOf(error)}`);
        continue;
      }
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
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): the dashboard snapshots the read state names are
  // held from that read until the files are written (`captureWithAssets`: the read and its hold in one synchronous turn,
  // released only after writing), so a refresh's collection meanwhile never leaves a half-written mirror.
  private async upsert(dir: string, manifest: Manifest, artifactId: string): Promise<void> {
    const root = join(dir, MIRROR_DIR);
    const captured = await this.documents.store.captureWithAssets(artifactId, () => {
      const value = this.readNow(root, manifest, artifactId);
      const listed = new Set(value?.assets.map((asset) => asset.ref));
      return { value, refs: value?.content && 'state' in value.content ? datasetRefsOf(value.content.state).filter((ref) => listed.has(ref)) : [] };
    });
    try {
      this.write(root, manifest, artifactId, captured.value);
    } finally {
      captured.release();
    }
  }

  // What `upsert` writes from, read inside the barrier: null when the entry is current or the artifact is gone.
  private readNow(root: string, manifest: Manifest, artifactId: string): MirrorRead {
    const { store, service } = this.documents;
    const artifact = store.get(artifactId);
    if (!artifact) return null; // deleted since: its event removes it
    const revision = store.revision(artifactId);
    const writer = mirrorWriterFor(artifact.kind);
    const inputs = writer?.inputs?.(artifact); // P3-C (Decision Log 29)
    const entry = manifest.artifacts[artifactId];
    // current; P4 (tracker L249): each file a regular one, so a link put in a file's place is written over at the next step
    if (entry && entry.revision === revision && entry.inputs === inputs && entry.slug === mirrorSlug(artifact) && entry.files.every((file) => isFile(join(root, file)))) return null;
    if (!writer) return { artifact, revision, inputs, content: null, assets: [] };
    const assets = store.listAssets(artifactId).map(({ ref, name, mime, size, sha256 }) => ({ ref, name, mime, size, sha256 }));
    if (isDocKind(artifact.kind)) return { artifact, revision, inputs, content: { state: service.readState(artifactId).state }, assets };
    return { artifact, revision, inputs, content: byteContentOf(store, artifactId), assets };
  }

  // The files of what `readNow` read, written synchronously.
  private write(root: string, manifest: Manifest, artifactId: string, read: MirrorRead): void {
    const entry = manifest.artifacts[artifactId];
    if (!read || (read.content === null && !entry)) return; // current, gone, or nothing to write and nothing written
    const { artifact, revision, inputs, content } = read;
    const files = content === null ? {} : this.produce(artifact, content, read.assets);
    const owned = new Set(Object.values(manifest.artifacts).flatMap((other) => other.files));
    const mine = new Set(entry?.files ?? []);
    const reached = entries(root);
    const written: string[] = [];
    let failure: { error: unknown } | null = null;
    for (const [file, data] of Object.entries(files)) {
      if (!isMirrorPath(file)) {
        this.log(`${artifactId}: ${JSON.stringify(file)} is not a path the mirror writes`);
        continue;
      }
      const target = join(root, file);
      // one of this artifact's own names spelled another way (a rename the volume folds to one name: by case only on a
      // case-insensitive volume, ß to SS on APFS)
      const sameAs = mine.has(file) ? undefined : [...mine].find((own) => aliases(root, file, own, reached.of));
      if (!mine.has(file) && sameAs === undefined && (owned.has(file) || occupied(target))) {
        this.log(`${artifactId}: ${target} is not the mirror's file; not written`);
        continue;
      }
      try {
        if (!realDirsUnder(root, file)) {
          this.log(`${artifactId}: ${target} lies under a link; not written`);
          continue;
        }
        // P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md Decision Log 37 (1)): a copy already in place keeps
        // its bytes (they never change under its name); one the mirror lacks is read now
        if (isMirrorCopy(data) && mine.has(file) && isFile(target)) {
          written.push(file);
          continue;
        }
        reached.forget(file, sameAs); // their entry is replaced below
        if (sameAs !== undefined) renameSync(join(root, sameAs), target); // the entry takes the new name's case first
        if (isMirrorCopyFrom(data)) {
          if (!this.copyFrom(root, file, data.copyFrom, artifactId)) continue; // mirrored as nothing: what it had there goes as a leftover
        } else writeReadOnly(root, file, isMirrorCopy(data) ? data.read() : data);
      } catch (error) {
        failure ??= { error };
        break;
      }
      written.push(file);
    }
    // The entry names every file of the artifact the mirror has on disk: what it just wrote, and what it no longer
    // produces but could not remove (all of it, after a write that failed half-way). Any failure leaves the entry at
    // revision -1, which no revision matches, so the next change tries again.
    // P4 (tracker L136): what each name reaches read afresh, the writes done; an old spelling that still reaches what was
    // written is that file, so its removal would remove it
    const now = entries(root);
    const leftover: string[] = [];
    for (const file of mine) {
      if (written.includes(file) || written.some((done) => aliases(root, file, done, now.of))) continue; // the name now reaches what was written
      if (failure) {
        leftover.push(file);
        continue;
      }
      try {
        removeFile(root, file);
      } catch (error) {
        failure = { error };
        leftover.push(file);
      }
    }
    const kept = [...new Set([...written, ...leftover])].sort();
    if (kept.length > 0) manifest.artifacts[artifactId] = { revision: failure ? -1 : revision, ...(inputs !== undefined && { inputs }), slug: mirrorSlug(artifact), files: kept }; // P3-C: inputs
    else delete manifest.artifacts[artifactId];
    if (failure) throw failure.error;
  }

  // The kind's writer over what was read; a document's replica lives only for the call. M6b: the assets listed, each
  // read from the store's content-addressed file when the writer asks (a failed read fails this artifact's write, which
  // the next change retries, as any write does).
  private produce(artifact: Artifact, content: Exclude<ContentRead, null>, listed: AssetsRead): MirrorOutput['files'] {
    const writer = mirrorWriterFor(artifact.kind)!;
    const byRef = new Map(listed.map((asset) => [asset.ref, asset]));
    const assets = {
      assets: listed.map(({ ref, name, mime, size }) => ({ ref, name, mime, size })),
      readAsset: (ref: string): Uint8Array => {
        const asset = byRef.get(ref);
        if (!asset) throw new Error(`${artifact.id} has no asset ${ref}`);
        return this.documents.store.files.readAsset(artifact.id, asset.sha256);
      },
    };
    if ('bytes' in content) return writer({ artifact, bytes: content.bytes, name: content.name, ...assets }).files;
    if ('path' in content) return writer({ artifact, path: content.path, name: content.name, ...assets }).files; // P3-F (F10): `copyFrom` copies it
    const doc = newDoc();
    try {
      applyV2(doc, content.state);
      return writer({ artifact, doc, ...assets }).files;
    } finally {
      doc.destroy();
    }
  }

  // P3-F (F10, tracker L142): a File artifact's file copied in as `file`: within the cap through memory, as before (a small
  // file never spawns a clone); over it cloned into the temp. False, logged, when it is mirrored as nothing: over the cap
  // (or unreadable) and its clone failed, its temp and any folder made for it removed (one that cannot be is named in the
  // line). A failure after the clone throws, as any write's does.
  private copyFrom(root: string, file: string, from: string, artifactId: string): boolean {
    const bytes = fileBytes(from, this.maxFileBytes);
    if (bytes) {
      writeReadOnly(root, file, bytes);
      return true;
    }
    const step = { cloning: false };
    try {
      writeReadOnly(root, file, (temp) => {
        step.cloning = true;
        this.cloneFile(from, temp);
        step.cloning = false;
      });
      return true;
    } catch (error) {
      if (!step.cloning) throw error; // its chmod or its rename: a failed write, the entry at -1
      this.log(`${artifactId}: ${from} is over ${this.maxFileBytes} bytes or cannot be read, and its clone failed (${reasonOf(error)}); mirrored as nothing`);
      removeEmpty(root, dirname(join(root, file))); // the folders made for its temp
      return false;
    }
  }

  // Removes the artifact's files; the entry keeps the ones whose removal failed (at revision -1) and the first failure
  // is thrown after it is recorded.
  private remove(dir: string, manifest: Manifest, artifactId: string): void {
    const entry = manifest.artifacts[artifactId];
    if (!entry) return;
    let failure: { error: unknown } | null = null;
    const left = entry.files.filter((file) => {
      try {
        removeFile(join(dir, MIRROR_DIR), file);
        return false;
      } catch (error) {
        failure ??= { error };
        return true;
      }
    });
    if (left.length > 0) manifest.artifacts[artifactId] = { ...entry, revision: -1, files: left };
    else delete manifest.artifacts[artifactId];
    if (failure) throw (failure as { error: unknown }).error;
  }

  // The directory's manifest, cached once read. The linked directory must exist; its `artifacts/` need not yet.
  private load(dir: string): Manifest {
    if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`); // checked every time: never recreated
    const root = join(dir, MIRROR_DIR);
    if (!realDirsUnder(root, MIRROR_MANIFEST)) throw new Error(`${root} is not a directory of its own (a link, or a file)`);
    const manifest = this.manifests.get(dir) ?? readManifest(join(root, MIRROR_MANIFEST));
    this.manifests.set(dir, manifest);
    if (this.failing.delete(dir)) void this.reconcile(); // working again: the changes it missed, after this step
    return manifest;
  }

  private saveLogged(dir: string, manifest: Manifest): boolean {
    try {
      this.save(dir, manifest);
      return true;
    } catch (error) {
      this.log(`the mirror manifest in ${dir} could not be written: ${reasonOf(error)}`);
      return false;
    }
  }

  // Writes the manifest when it names a file, removes it (and an emptied `artifacts/`) when it names none.
  private save(dir: string, manifest: Manifest): void {
    const root = join(dir, MIRROR_DIR);
    if (!realDirsUnder(root, MIRROR_MANIFEST)) throw new Error(`${root} is not a directory of its own (a link, or a file); nothing is written through it`); // relinked since it loaded
    const path = join(root, MIRROR_MANIFEST);
    const present = occupied(path); // a link there too, dangling or not
    if (present && (!lstatSync(path).isFile() || this.saved.get(dir) !== readFileSync(path, 'utf8'))) readManifest(path); // not ours since: left alone
    if (Object.keys(manifest.artifacts).length === 0) {
      if (present) removeFile(root, MIRROR_MANIFEST);
      this.saved.delete(dir);
      return;
    }
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    if (this.saved.get(dir) === json && present) return; // unchanged: a no-op change writes nothing
    ensureRoot(root);
    const temp = join(root, `.${MIRROR_MANIFEST}.${randomUUID().slice(0, 8)}.tmp`);
    writeFileSync(temp, json);
    renameSync(temp, path);
    this.saved.set(dir, json);
  }
}

// Per linked directory (by its key), the Spaces linked to it.
function linkedDirs(spaces: Space[], keyOf: (linkedDir: string) => string): Map<string, { spaceIds: Set<string>; names: string[] }> {
  const dirs = new Map<string, { spaceIds: Set<string>; names: string[] }>();
  for (const space of spaces) {
    if (space.linkedDir === undefined) continue;
    const dir = keyOf(space.linkedDir);
    const entry = dirs.get(dir) ?? { spaceIds: new Set<string>(), names: [] };
    entry.spaceIds.add(space.id);
    entry.names.push(space.name);
    dirs.set(dir, entry);
  }
  return dirs;
}

// The manifest at `path` as read from the directory, which anyone may have edited: none there is an empty one; an entry
// whose shape is wrong is dropped and a file name that is not a mirror path is never trusted (so nothing outside
// `artifacts/` is ever removed). A file that is not a MAWS manifest at all is the owner's: it throws, so the directory
// is refused rather than the file overwritten or removed.
function readManifest(path: string): Manifest {
  let entry;
  try {
    entry = lstatSync(path); // never followed: a link there is not the mirror's, dangling or not
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, artifacts: {} };
    throw error;
  }
  if (!entry.isFile()) throw new Error(`${path} is not a MAWS mirror manifest (not a regular file); it is left alone`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not a MAWS mirror manifest (${reasonOf(error)}); it is left alone`, { cause: error });
  }
  const { version, artifacts } = (parsed ?? {}) as Partial<Manifest>;
  if (version !== 1 || typeof artifacts !== 'object' || artifacts === null || Array.isArray(artifacts)) throw new Error(`${path} is not a MAWS mirror manifest (not version 1); it is left alone`);
  const entries: Record<string, ManifestEntry> = {};
  for (const [artifactId, entry] of Object.entries(artifacts as Record<string, Partial<ManifestEntry>>)) {
    if (typeof entry?.revision !== 'number' || typeof entry.slug !== 'string' || !Array.isArray(entry.files)) continue;
    entries[artifactId] = { revision: entry.revision, ...(typeof entry.inputs === 'string' && { inputs: entry.inputs }) /* P3-C */, slug: entry.slug, files: entry.files.filter((file): file is string => typeof file === 'string' && isMirrorPath(file)) };
  }
  return { version: 1, artifacts: entries };
}

// True when `artifacts/` and every folder between it and `file` is a real directory or does not exist yet: never a link
// (a linked directory is the owner's project, possibly a clone, and a link inside it must not carry a write or a
// removal elsewhere). A folder that cannot be inspected throws, so the caller fails rather than skipping.
function realDirsUnder(root: string, file: string): boolean {
  let dir = root;
  for (const segment of ['', ...file.split('/').slice(0, -1)]) {
    dir = join(dir, segment);
    let stat;
    try {
      stat = lstatSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; // missing: everything below it is the mirror's to make
      throw error; // not inspectable (no permission): a failure of the write or removal, never a "no"
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

// A name is taken when anything is there, a dangling link included (`existsSync` follows links and would say no).
function occupied(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

// A regular file is at `path`, never followed: a link in the place of a file the mirror owns is not that file.
function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

// Two mirror paths that are one directory entry spelled two ways (a volume that folds case or Unicode normalization, as
// APFS does): one file that is not a link (one device and inode, by `reached`), reached through no link inside the
// mirror, and one canonical entry (`realpath`, which spells an alias as the entry's own name but keeps a hard link's
// own). P4 (tracker L136): the volume decides, not a fold of the mirror's own (lowercasing after NFC told ß from SS, a
// final sigma from σ, a ligature from its letters, each one name on APFS, and no fold matches every volume's). An
// owner's hard link under another name, by case only on a case-sensitive volume included, is not an alias; anything
// that cannot be resolved is not either. `a` is read first, so a name that reaches nothing reads no other.
function aliases(root: string, a: string, b: string, reached: (file: string) => string | undefined): boolean {
  const entry = reached(a);
  if (entry === undefined || reached(b) !== entry) return false;
  try {
    return realDirsUnder(root, a) && realDirsUnder(root, b) && realpathSync.native(join(root, a)) === realpathSync.native(join(root, b));
  } catch {
    return false;
  }
}

// P4 (tracker L136): what each mirror path reaches, by lstat (never followed) once per pass, so comparing every old name
// with every new one costs a read per name, not per pair: its device and inode, or undefined when nothing is there, a
// link is, or it cannot be read. `forget` drops names whose entry the pass replaces, read again when next asked.
function entries(root: string): { of: (file: string) => string | undefined; forget: (...files: (string | undefined)[]) => void } {
  const read = new Map<string, string | undefined>();
  const of = (file: string): string | undefined => {
    if (read.has(file)) return read.get(file);
    let entry: string | undefined;
    try {
      const stat = lstatSync(join(root, file));
      entry = stat.isSymbolicLink() ? undefined : `${stat.dev}:${stat.ino}`;
    } catch {
      entry = undefined;
    }
    read.set(file, entry);
    return entry;
  };
  const forget = (...files: (string | undefined)[]): void => {
    for (const file of files) if (file !== undefined) read.delete(file);
  };
  return { of, forget };
}

// `artifacts/` is made in the linked directory only while that exists: never the linked directory itself.
function ensureRoot(root: string): void {
  if (!existsSync(root)) mkdirSync(root);
}

// `data` written at a temp beside the target (P3-F F10: or put there by `data` itself, a clone), made 0444 and renamed
// over it. A failure removes the temp and throws; a temp that cannot be removed is named in what is thrown, beside the
// failure, never in its place.
function writeReadOnly(root: string, file: string, data: string | Uint8Array | ((temp: string) => void)): void {
  const target = join(root, file);
  ensureRoot(root);
  mkdirSync(dirname(target), { recursive: true }); // a writer's folders, under `artifacts/`
  const temp = join(dirname(target), `.mirror-${randomUUID().slice(0, 8)}.tmp`);
  try {
    if (typeof data === 'function') data(temp);
    else writeFileSync(temp, data);
    chmodSync(temp, 0o444);
    renameSync(temp, target); // over a read-only file too: replacing a name needs the directory's permission only
  } catch (error) {
    try {
      rmSync(temp, { force: true });
    } catch (cleanup) {
      throw new Error(`${reasonOf(error)}; and its temp ${temp} could not be removed: ${reasonOf(cleanup)}`, { cause: cleanup });
    }
    throw error;
  }
}

let apfs: number | undefined; // P3-F (F10): the file system type of `/`, read once

/**
 * P3-F (F10, tracker L142): clones the regular file `from` as the new file `to`, sharing its blocks (no buffer, no time,
 * no space), or throws. On macOS by APFS's clonefile(2) through `/bin/cp -c`, since Node's COPYFILE_FICLONE_FORCE answers
 * ENOSYS there (Node 22 and Electron 44's Node 24); `cp -c` falls back to a byte copy where the clone fails, so it runs
 * only where the clone cannot: `from` on the volume of `to`'s folder, an APFS one (the file system of `/`, APFS on every
 * macOS MAWS runs on), and carrying no BSD file flag. clonefile copies the flags, so a locked (`uchg`) or append-only
 * source would clone as a temp that neither chmod nor rm can touch; Node reads no flags, so `stat -L -f %f` does (of
 * the file a link names, which `cp` follows too), one spawn of about 3 ms. Elsewhere a reflink (COPYFILE_FICLONE_FORCE), refused where the file system has none.
 */
export function cloneFile(from: string, to: string): void {
  const [source, folder] = [statSync(from), dirname(to)];
  if (!source.isFile()) throw new Error(`${from} is not a regular file`);
  if (process.platform !== 'darwin') return copyFileSync(from, to, constants.COPYFILE_FICLONE_FORCE);
  if (source.dev !== statSync(folder).dev) throw new Error(`${from} is on another volume than ${folder}`);
  if (statfsSync(folder).type !== (apfs ??= statfsSync('/').type)) throw new Error(`${folder} is on a volume that cannot clone (not APFS)`);
  const flags = execFileSync('/usr/bin/stat', ['-L', '-f', '%f', '--', from], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: MIRROR_CLONE_TIMEOUT_MS }).trim();
  if (flags !== '0') throw new Error(`${from} carries file flags (${flags}: locked or append-only, perhaps), which its clone would copy`);
  execFileSync('/bin/cp', ['-c', '--', from, to], { stdio: ['ignore', 'ignore', 'pipe'], timeout: MIRROR_CLONE_TIMEOUT_MS });
}

// Removes one file, then each parent folder it leaves empty, up to (and including) `artifacts/` itself. P4 (tracker
// L249): one under a link is refused, as a failed removal (thrown), so its name stays owned at revision -1 rather than
// being dropped as removed; the file is the mirror's again if the owner puts the original folder back in place.
function removeFile(root: string, file: string): void {
  if (!realDirsUnder(root, file)) throw new Error(`${join(root, file)} lies under a link; not removed`);
  rmSync(join(root, file), { force: true });
  removeEmpty(root, dirname(join(root, file)));
}

// Removes `dir` and each parent it leaves empty, up to (and including) `artifacts/` itself.
function removeEmpty(root: string, dir: string): void {
  for (; dir.startsWith(root); dir = dirname(dir)) {
    try {
      rmdirSync(dir);
    } catch {
      return; // not empty, or gone
    }
    if (dir === root) return;
  }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
