// The bundle's table (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §M; T13). At the chunk's load
// the bundle's directory is listed once into a map from URL path to file, regular files only and no link followed; a
// request is a lookup in that map, so no path a requester writes is ever joined to a directory. Types come from a fixed
// list of extensions, and a file whose extension is not on it is not in the table. An SVG here is a file of the build,
// served as what it is; rule 4 is about bodies an agent chose, which never pass through this table.
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

export interface BundleFile {
  type: string;
  etag: string;
  read(): Promise<Buffer>;
}

export interface BundleTable {
  shell: BundleFile; // index.html: what a navigation gets at / and under /s/
  get(path: string): BundleFile | null;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export async function readBundle(dir: string): Promise<BundleTable> {
  const files = new Map<string, BundleFile>();
  const visit = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await visit(path); // a Dirent is the link itself: a linked directory is neither
      else if (entry.isFile() && Object.hasOwn(TYPES, extname(entry.name))) {
        const { size, mtimeMs } = await stat(path);
        files.set(`/${relative(dir, path).split(sep).join('/')}`, { type: TYPES[extname(entry.name)]!, etag: `"${size.toString(16)}${Math.trunc(mtimeMs).toString(16)}"`, read: () => readFile(path) });
      }
    }
  };
  await visit(dir);
  const shell = files.get('/index.html');
  if (shell === undefined) throw new Error('the bundle holds no index.html');
  return { shell, get: (path) => files.get(path) ?? null };
}
