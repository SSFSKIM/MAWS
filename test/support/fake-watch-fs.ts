// An in-memory filesystem for the watch tree's tests (P5 O3-E M1, src/shared/fs/watch-tree.ts) and the two watchers that
// take it: the `fs` the tree injects (`watch`, `lstatSync`, `readdir`, `lstat`), with directories, files and links held by absolute
// path, every non-recursive watch recorded, events delivered by hand, a watch call made to fail on demand and a
// directory's listing held until the test releases it.
import { join } from 'node:path';
import type { WatchTreeOptions } from '../../src/shared/fs/watch-tree';

type Kind = 'dir' | 'file' | 'link';
type Listener = (event: string, filename: string | null) => void;

export interface FakeDirWatch {
  path: string;
  listener: Listener;
  closed: boolean;
  errors: ((error: NodeJS.ErrnoException) => void)[];
}

export function errno(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${path}`), { code, path, syscall: 'watch' });
}

export class FakeWatchFs {
  private readonly nodes = new Map<string, { kind: Kind; ino: number }>();
  private nextIno = 1;
  readonly watches: FakeDirWatch[] = [];
  watchCalls = 0;
  listings = 0;
  lstats: string[] = []; // the paths lstat was asked, in order
  lstatSyncs: string[] = []; // the paths lstatSync was asked, in order
  // Answers the error a watch call throws, by its path and the call's ordinal (1-based), or null to let it open.
  failWatch: (path: string, call: number) => NodeJS.ErrnoException | null = () => null;
  private readonly gates = new Map<string, { promise: Promise<void>; open: () => void }>();

  constructor(readonly root = '/r') {
    this.nodes.set(root, { kind: 'dir', ino: this.nextIno++ });
  }

  abs(rel: string): string {
    return rel === '' ? this.root : join(this.root, rel);
  }

  // Every missing ancestor is made too, as `mkdir -p` does.
  mkdir(rel: string): void {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = this.abs(parts.slice(0, i).join('/'));
      if (!this.nodes.has(path)) this.nodes.set(path, { kind: 'dir', ino: this.nextIno++ });
    }
  }

  write(rel: string, kind: 'file' | 'link' = 'file'): void {
    const slash = rel.lastIndexOf('/');
    if (slash > 0) this.mkdir(rel.slice(0, slash));
    this.nodes.set(this.abs(rel), { kind, ino: this.nextIno++ });
  }

  // The entry and everything beneath it.
  rm(rel: string): void {
    const path = this.abs(rel);
    for (const key of [...this.nodes.keys()]) if (key === path || key.startsWith(`${path}/`)) this.nodes.delete(key);
  }

  // The listing of `rel` waits until `release` is called.
  hold(rel: string): () => void {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    this.gates.set(this.abs(rel), { promise, open });
    return () => {
      this.gates.delete(this.abs(rel));
      open();
    };
  }

  // An event delivered to every open watch on the directory `rel`, naming `name` (a child's name, or null).
  fire(rel: string, event: string, name: string | null): void {
    for (const watch of this.watches) if (watch.path === this.abs(rel) && !watch.closed) watch.listener(event, name);
  }

  // The root-relative directories with an open watch, in the order they were opened.
  watched(): string[] {
    return this.watches.filter((watch) => !watch.closed).map((watch) => (watch.path === this.root ? '' : watch.path.slice(this.root.length + 1)));
  }

  readonly fs = {
    watch: (path: string, _options: unknown, listener: Listener) => {
      const call = ++this.watchCalls;
      const failure = this.failWatch(path, call);
      if (failure) throw failure;
      if (this.nodes.get(path)?.kind !== 'dir') throw errno('ENOENT', path);
      const watch: FakeDirWatch = { path, listener, closed: false, errors: [] };
      this.watches.push(watch);
      const handle = {
        close: () => void (watch.closed = true),
        on: (_event: 'error', errorListener: (error: NodeJS.ErrnoException) => void) => {
          watch.errors.push(errorListener);
          return handle;
        },
      };
      return handle;
    },
    readdir: async (path: string) => {
      this.listings++;
      await this.gates.get(path)?.promise;
      const node = this.nodes.get(path);
      if (node === undefined) throw errno('ENOENT', path);
      if (node.kind !== 'dir') throw errno('ENOTDIR', path);
      return [...this.nodes.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(([key, child]) => ({ name: key.slice(path.length + 1), isDirectory: () => child.kind === 'dir', isSymbolicLink: () => child.kind === 'link' }));
    },
    lstatSync: (path: string) => {
      this.lstatSyncs.push(path);
      const node = this.nodes.get(path);
      return node === undefined ? undefined : { isDirectory: () => node.kind === 'dir', isSymbolicLink: () => node.kind === 'link', dev: 1, ino: node.ino };
    },
    lstat: async (path: string) => {
      this.lstats.push(path);
      const node = this.nodes.get(path);
      if (node === undefined) throw errno('ENOENT', path);
      return { isDirectory: () => node.kind === 'dir', isSymbolicLink: () => node.kind === 'link', dev: 1, ino: node.ino };
    },
  };

  get options(): NonNullable<WatchTreeOptions['fs']> {
    return this.fs as unknown as NonNullable<WatchTreeOptions['fs']>;
  }
}

// Drains every promise the fake's async calls left ready (they resolve by microtasks alone).
export function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
