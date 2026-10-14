// Bytes on disk for the artifact store (the P3-A document's Decision Log 2, 7 and M3): a byte kind's writes and every
// artifact's assets, under `<userData>/artifacts/<artifactId>/`. An `html` write is immutable at
// `content/<seq>/<name>`; an asset is content-addressed at `assets/<sha256>`. Each file is written to a temp file,
// fsynced and renamed into place before the row that names it commits, so a committed row never names a missing or
// partial file (a crash leaves at most an orphan file no row names). A `file` artifact's content stays where it is
// (send_file's rule): only its name, size and hash are recorded.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';

export interface ContentRef {
  name: string;
  sha256: string;
  size: number;
  path: string; // `html`: relative to the artifact's directory; `file`: the absolute path of the file in place
}

// A file name as a single safe path segment, or null when nothing usable is left.
export function safeName(name: string): string | null {
  const base = basename(name.replaceAll('\\', '/')).trim();
  if (base === '' || base === '.' || base === '..' || base.includes('\u0000')) return null;
  return base;
}

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class ArtifactFiles {
  constructor(readonly root: string) {}

  dirOf(artifactId: string): string {
    return join(this.root, artifactId);
  }

  // Durably writes `bytes` to a temp file inside the artifact's directory; answers its path and hash.
  stage(artifactId: string, bytes: Uint8Array): { temp: string; sha256: string; size: number } {
    const dir = join(this.dirOf(artifactId), 'tmp');
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, randomUUID());
    const fd = openSync(temp, 'w');
    try {
      for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return { temp, sha256: sha256Of(bytes), size: bytes.length };
  }

  // Moves a staged file to `relative` (inside the artifact's directory), replacing an orphan left there by a crash.
  place(artifactId: string, temp: string, relative: string): string {
    const target = join(this.dirOf(artifactId), relative);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(temp, target);
    return target;
  }

  discard(temp: string): void {
    rmSync(temp, { force: true });
  }

  // An `html` write's place: immutable per log row.
  static contentPath(seq: number, name: string): string {
    return join('content', String(seq), name);
  }

  static assetPath(sha256: string): string {
    return join('assets', sha256);
  }

  // The absolute path of a stored content ref.
  resolve(artifactId: string, ref: ContentRef): string {
    return isAbsolute(ref.path) ? ref.path : join(this.dirOf(artifactId), ref.path);
  }

  read(artifactId: string, ref: ContentRef): Uint8Array {
    return readFileSync(this.resolve(artifactId, ref));
  }

  readAsset(artifactId: string, sha256: string): Uint8Array {
    return readFileSync(join(this.dirOf(artifactId), ArtifactFiles.assetPath(sha256)));
  }

  exists(artifactId: string, relative: string): boolean {
    return existsSync(join(this.dirOf(artifactId), relative));
  }

  // Deletes a byte-kind write's stored file (its `content/<seq>/` directory); a `file` artifact's referenced file is
  // never the store's to delete.
  removeContent(artifactId: string, ref: ContentRef): void {
    if (isAbsolute(ref.path) || !ref.path.startsWith(`content${sep}`)) return;
    rmSync(join(this.dirOf(artifactId), dirname(ref.path)), { recursive: true, force: true });
  }

  // Deletes everything stored for an artifact no committed row names (a copy or an import whose write was taken back).
  removeAll(artifactId: string): void {
    rmSync(this.dirOf(artifactId), { recursive: true, force: true });
  }

  // A `file` artifact's referenced file described in place, streamed: each chunk is read asynchronously, so a large file
  // hashes without holding the event loop. Run before a write's synchronous commit path, which takes the digest
  // (`ByteContent`'s `digest`); size and hash are of the same bytes read.
  async describeStreamed(path: string): Promise<{ name: string; sha256: string; size: number }> {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 }) as AsyncIterable<Buffer>) {
      hash.update(chunk);
      size += chunk.length;
    }
    return { name: basename(path), sha256: hash.digest('hex'), size };
  }

  // A `file` artifact's referenced file, described in place synchronously (hashed in chunks: it may be large), for a
  // write given no digest.
  describe(path: string): { name: string; sha256: string; size: number } {
    const size = statSync(path).size;
    const hash = createHash('sha256');
    const fd = openSync(path, 'r');
    try {
      const chunk = new Uint8Array(1024 * 1024);
      for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) hash.update(chunk.subarray(0, read));
    } finally {
      closeSync(fd);
    }
    return { name: basename(path), sha256: hash.digest('hex'), size };
  }
}
