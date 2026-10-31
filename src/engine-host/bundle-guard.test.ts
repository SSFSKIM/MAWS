// E10 (§Design 6): the app's binary may be replaced under a running supervisor; the running process keeps its loaded
// modules, so the engine-host chunk must load everything at start: no dynamic `import()`, and nothing required but
// Node's builtins and `zod` (and, P3-HD, the pinned MCP SDK's own modules). Reads the built chunk under `out/main` when
// a build is present and is skipped otherwise; the E10 gates run it after `pnpm build`, which makes it mandatory there.
//
// P5 O2 M5 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The build"): `mawsd` runs under the same rule, outliving
// the binary that started it, and runs as plain Node where no Electron is installed: `out/main/mawsd.js` and every chunk
// it requires require only Node's builtins and the externals the engine host allows; the pty host's chunk, which `mawsd`
// spawns, adds `node-pty`.
//
// P5 O10 M10 (the architect's ruling on acceptance 14): each is a guarded entry (test/support/guarded-entry.ts, the rule
// O3's hosts reuse). `mawsd` loads its endpoint (the module, `ws`, org-protocol) only when it is needed, a deferred load
// of a chunk the same build emits beside it; the hosts admit none.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { guardedEntryProblems, runPathOf } from '../../test/support/guarded-entry';
import { describe, expect, it } from 'vitest';
// P5 O10 start
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { runInThisContext } from 'node:vm';
import { parseAst } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
// P5 O10 end

const OUT = resolve(__dirname, '../../out/main');
const MARKER = 'the engine host needs MAWS_USER_DATA'; // index.ts's own refusal, unique to the engine-host chunk

function engineHostChunk(): string | null {
  if (!existsSync(OUT)) return null;
  for (const name of readdirSync(OUT).filter((file) => file.endsWith('.js'))) {
    const text = readFileSync(join(OUT, name), 'utf8');
    if (text.includes(MARKER)) return text;
  }
  return null;
}

const chunk = engineHostChunk();

describe.skipIf(chunk === null)('the built engine-host chunk', () => {
  // P3-A: the inlined Yjs sources keep their JSDoc, whose type annotations read `import('../ynode.js')`; a comment line
  // (one starting with `*`, `/*` or `//`) is not code.
  it('has no dynamic import()', () => {
    const code = chunk!.split('\n').filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line));
    expect(code.filter((line) => /\bimport\s*\(/.test(line))).toEqual([]);
  });

  it('requires only Node builtins and zod', () => {
    const required = [...new Set([...chunk!.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]))];
    expect(required.length).toBeGreaterThan(0);
    // P3-D: a builtin's bare name too (electron-vite's `?asset` imports emit `require("path")`)
    // P3-HD (architect's E10 ruling): the pinned MCP SDK stays an external production dependency, required at the
    // chunk's top level like zod; nothing else joins it.
    const sdk = (name: string) => name === '@modelcontextprotocol/sdk' || name.startsWith('@modelcontextprotocol/sdk/');
    expect(required.filter((name) => !name.startsWith('node:') && !builtinModules.includes(name) && name !== 'zod' && !sdk(name))).toEqual([]);
  });
});

// P5 O2 M5 start
const MAWSD = join(OUT, 'mawsd.js');
const PTY_MARKER = 'the pty host runs as a utility process (process.parentPort) or detached'; // its index.ts's own refusal
const REQUIRES = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

// An entry and every chunk it requires, transitively, by path
function graphOf(entry: string): Map<string, string> | null {
  if (!existsSync(entry)) return null;
  const graph = new Map<string, string>();
  const visit = (file: string) => {
    if (graph.has(file)) return;
    const text = readFileSync(file, 'utf8');
    graph.set(file, text);
    for (const [, name] of text.matchAll(REQUIRES)) if (name.startsWith('.')) visit(resolve(dirname(file), name));
  };
  visit(entry);
  return graph;
}

const ENGINE_MARKER = MARKER;
// The built file whose text holds `marker`, by path
function hostFile(marker: string): string | null {
  if (!existsSync(OUT)) return null;
  for (const name of readdirSync(OUT).filter((file) => file.endsWith('.js'))) if (readFileSync(join(OUT, name), 'utf8').includes(marker)) return join(OUT, name);
  return null;
}

function ptyHostChunk(): string | null {
  if (!existsSync(OUT)) return null;
  for (const name of readdirSync(OUT).filter((file) => file.endsWith('.js'))) {
    const text = readFileSync(join(OUT, name), 'utf8');
    if (text.includes(PTY_MARKER)) return text;
  }
  return null;
}

const externals = (text: string) => [...new Set([...text.matchAll(REQUIRES)].map((match) => match[1]))].filter((name) => !name.startsWith('.'));
const allowed = (name: string, extra: readonly string[] = []) =>
  name.startsWith('node:') || builtinModules.includes(name) || name === 'zod' || name === '@modelcontextprotocol/sdk' || name.startsWith('@modelcontextprotocol/sdk/') || extra.includes(name);
const code = (text: string) => text.split('\n').filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line));

const graph = graphOf(MAWSD);
const pty = ptyHostChunk();

describe.skipIf(graph === null)('the built mawsd’s run path', () => {
  // The architect's lever (a): an unenrolled mawsd doesn't pay for the endpoint, `ws` or org-protocol; each is in a
  // chunk its run path never names, loaded at start only when an enrollment is on disk (endpoint-seam.ts).
  it('keep the endpoint, ws and org-protocol off the run path, in chunks loaded when needed', () => {
    const markers = { endpoint: 'endpoint: refusing its state', ws: 'Sec-WebSocket-Key', 'org-protocol': 'smns-rl2-v1' };
    const run = runPathOf(MAWSD);
    for (const [what, marker] of Object.entries(markers)) {
      expect([...run].filter(([, text]) => text.includes(marker)).map(([file]) => file), what).toEqual([]);
      expect([...graph!].some(([, text]) => text.includes(marker)), `${what} beside it`).toBe(true);
    }
  });

  // P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, M2's Proves): the spine is composed from the
  // services chunk, loaded at its first trigger (spine-seam.ts), so the library's code is on no file the run path holds
  // and is in the deferred graph. The markers are definitions: the seam itself names `startSpine` as the entry's member.
  // P5 O3-D M6 (fix round 1): a running daemon never reads its command line, so the CLI (cli.ts, and the installer,
  // the release step and the bare machine.sock client it alone reaches) is a chunk loaded at the first command
  it('keep the command line off the run path, in the chunk a command loads', () => {
    const markers = { runCli: /\basync function runCli\(/, reachMachine: /\bfunction reachMachine\(/ };
    const run = runPathOf(MAWSD);
    for (const [what, marker] of Object.entries(markers)) {
      expect([...run].filter(([, text]) => marker.test(text)).map(([file]) => file), what).toEqual([]);
      expect([...graph!].some(([, text]) => marker.test(text)), `${what} beside it`).toBe(true);
    }
  });

  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, acceptance 9): the checkouts compose inside the
  // spine's root, so git, scm and files load with the spine, never at mawsd's start
  it('keep the services library off the run path, in the chunk the spine seam loads', () => {
    const markers = {
      startSpine: /\bfunction startSpine\(/, IndexSessionSource: /\bclass IndexSessionSource\b/,
      GitService: /\bclass GitService\b/, createFilesService: /\bfunction createFilesService\(/, ScmService: /\bclass ScmService\b/, FileLister: /\bclass FileLister\b/,
    };
    const run = runPathOf(MAWSD);
    for (const [what, marker] of Object.entries(markers)) {
      expect([...run].filter(([, text]) => marker.test(text)).map(([file]) => file), what).toEqual([]);
      expect([...graph!].some(([, text]) => marker.test(text)), `${what} beside it`).toBe(true);
    }
  });
});

describe.skipIf(graph === null)('the built mawsd’s run path (P5 O5)', () => {
  // P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, acceptance 8): the artifact endpoint's handler (the
  // scheme library, its HTTP server, the bridge script) is a chunk the endpoint loads at its first use, never at start;
  // the listener on artifacts.sock, which is, costs one bound socket. The markers are definitions.
  it('keep the artifact endpoint’s handler off the run path, in the chunk the endpoint loads at its first use', () => {
    const markers = { createSchemeHandler: /\bfunction createSchemeHandler\(/, serveOverHttp: /\bfunction serveOverHttp\(/, endpointLibrary: /\bfunction endpointLibrary\(/ };
    const run = runPathOf(MAWSD);
    for (const [what, marker] of Object.entries(markers)) {
      expect([...run].filter(([, text]) => marker.test(text)).map(([file]) => file), what).toEqual([]);
      expect([...graph!].some(([, text]) => marker.test(text)), `${what} beside it`).toBe(true);
    }
    expect([...run].some(([, text]) => /\bfunction createArtifactsEndpoint\(/.test(text)), 'the listener is on the run path').toBe(true);
  });
});

// P5 O5 M3 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3; Interfaces §E): main's entry loads one of two roots.
// The render host's root is a chunk the entry requires only on `--render-host`, deferred, which nothing of the app's
// requires and which is never an `index-<hash>.js` (the host bundles' name, counted above); the app's root is out/main/
// app.js, beside the entry, because its modules join `__dirname` to the preloads, the renderer's page and mawsd.js. A
// module of the app's that a chunk shared with the render host took would read chunks/ for out/main/, so every chunk's
// `__dirname` join names only a host bundle beside the entry (`?modulePath`'s, which the bundler rewrites for chunks/).
const ENTRY = join(OUT, 'index.js');
const APP = join(OUT, 'app.js');
describe.skipIf(!existsSync(ENTRY) || !existsSync(APP))('main’s entry and its two roots (P5 O5 M3)', () => {
  const entry = existsSync(ENTRY) ? readFileSync(ENTRY, 'utf8') : '';
  const rootChunk = /\brequire\("\.\/chunks\/(root-[A-Za-z0-9_-]+\.js)"\)/.exec(entry)?.[1] ?? null;

  it('loads the render host’s root only on --render-host, deferred, from a chunk that is no host bundle’s name', () => {
    expect(rootChunk).not.toBeNull();
    expect(rootChunk!.startsWith('index-')).toBe(false);
    expect(code(entry).filter((line) => line.includes(rootChunk!))).toEqual([expect.stringMatching(/process\.argv\.includes\("--render-host"\) \? Promise\.resolve\(\)\.then\(\(\) => require\("\.\/chunks\/root-/)]);
    expect([...graphOf(APP)!.keys()]).not.toContain(join(OUT, 'chunks', rootChunk!));
    const renderHost = graphOf(join(OUT, 'chunks', rootChunk!))!;
    expect([...renderHost.keys()]).not.toContain(APP);
    expect([...renderHost.values()].some((text) => /\bfunction composeRender\(/.test(text)), 'the render library in its graph').toBe(true);
  });

  it('keeps every hand-written __dirname join in out/main/app.js: a chunk joins it only to a host bundle beside the entry', () => {
    const chunks = readdirSync(join(OUT, 'chunks')).filter((name) => name.endsWith('.js'));
    const joins = chunks.flatMap((name) => [...readFileSync(join(OUT, 'chunks', name), 'utf8').matchAll(/\bjoin\(__dirname,\s*"([^"]+)"\)/g)].map((match) => `${name}: ${match[1]}`));
    expect(joins.filter((found) => !/: \.\.\/index-[A-Za-z0-9_-]+\.js$/.test(found))).toEqual([]);
    expect(readFileSync(APP, 'utf8')).toMatch(/\bjoin\(__dirname, "\.\.\/preload\/index\.js"\)/);
  });
});

describe.skipIf(graph === null)('the built mawsd and its chunks', () => {
  it('are a guarded entry: Node builtins and the engine host’s externals at start, never electron, and deferred only chunks beside it', () => {
    expect(guardedEntryProblems({ entry: MAWSD, root: resolve(OUT, '..'), externals: (name) => allowed(name), deferred: true })).toEqual([]);
  });

  it('require only Node builtins and the engine host’s externals, never electron', () => {
    for (const [file, text] of graph!) expect(externals(text).filter((name) => !allowed(name)), file).toEqual([]);
  });

  // P5 O10 M10: the bundler stands an empty object in for an optional dependency that is not installed (`ws`'s
  // `bufferutil` and `utf-8-validate`), which a `try { require(...) }` takes as present: `ws` then masks its first frame
  // of 48 bytes or more with a `mask` that isn't there. electron.vite.config.ts's defines keep `ws` off both, in mawsd's
  // graph and in main's (its remote links bundle `ws` too).
  it('carry no stand-in for an optional dependency, nor does main', () => {
    for (const [file, text] of [...graph!, ...graphOf(join(OUT, 'index.js'))!]) expect(code(text).filter((line) => line.includes('__viteOptionalPeerDep_')), file).toEqual([]);
  });

  it('name the host bundles main names (one build, one build id)', () => {
    // `?modulePath` emits `path.join(__dirname, "<relative>/index-<hash>.js")`
    const hostFiles = (of: Map<string, string>) =>
      [...new Set([...of].flatMap(([file, text]) => [...text.matchAll(/["']((?:\.\.?\/)*index-[A-Za-z0-9_-]+\.js)["']/g)].map((match) => resolve(dirname(file), match[1]))))].sort();
    const mawsd = hostFiles(graph!);
    expect(mawsd).toHaveLength(2); // the engine host's and the pty host's
    for (const file of mawsd) expect(existsSync(file), file).toBe(true);
    expect(hostFiles(graphOf(join(OUT, 'index.js'))!)).toEqual(mawsd);
  });
});

// P5 O3-C start (docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §E; D13, D26): the services
// entry (`out/main/services.js`, main's third input) is what O3-D's `mawsd` will compose the spine from, so it is held to
// mawsd's rule: a guarded entry (P5 Decision Log 114: a deferred load only of a chunk the same build emits beside it, by
// a relative literal path), requiring only Node's builtins, zod and the MCP SDK, never electron.
const SERVICES = join(OUT, 'services.js');
const services = graphOf(SERVICES);

describe.skipIf(services === null)('the built services entry and its chunks', () => {
  it('are a guarded entry: Node builtins, zod and the MCP SDK at start, never electron, and deferred only chunks beside it', () => {
    expect(guardedEntryProblems({ entry: SERVICES, root: resolve(OUT, '..'), externals: (name) => allowed(name), deferred: true })).toEqual([]);
  });

  it('require only Node builtins, zod and the MCP SDK, never electron', () => {
    for (const [file, text] of services!) expect(externals(text).filter((name) => !allowed(name)), file).toEqual([]);
  });
});
// P5 O3-C end

describe.skipIf(chunk === null || pty === null)('the built hosts as guarded entries', () => {
  it('load nothing deferred, the engine host only builtins, zod and the MCP SDK, the pty host node-pty besides', () => {
    expect(guardedEntryProblems({ entry: hostFile(ENGINE_MARKER)!, root: resolve(OUT, '..'), externals: (name) => allowed(name), deferred: false })).toEqual([]);
    expect(guardedEntryProblems({ entry: hostFile(PTY_MARKER)!, root: resolve(OUT, '..'), externals: (name) => allowed(name, ['node-pty']), deferred: false })).toEqual([]);
  });
});

describe.skipIf(pty === null)('the built pty-host chunk', () => {
  it('has no dynamic import()', () => {
    expect(code(pty!).filter((line) => /\bimport\s*\(/.test(line))).toEqual([]);
  });

  it('requires only Node builtins, zod and node-pty', () => {
    expect(externals(pty!).filter((name) => !allowed(name, ['node-pty']))).toEqual([]);
  });
});
// P5 O2 M5 end

// P5 O10 start: `ws` as the build emits it. Where `ws`'s optional `bufferutil` is not installed, Vite stands an empty
// object in for it, which `ws` takes as present: unless electron.vite.config.ts's defines keep `ws` on its own code, the
// built `ws` masks a frame of 48 bytes or more (and unmasks one of 32 or more) with a function that isn't there. The
// source `ws` never meets the stand-in, so the emitted module is what runs here: each built file of main's graph or
// mawsd's that carries `ws` gives up its client and server (the top-level statements they reach, as emitted), and
// frames either side of those sizes cross each against the source `ws`.
type Ast = { type: string; start: number; end: number; [key: string]: unknown };

// The names a node reads: every identifier but a non-computed member, key or label. Rollup deconflicts every local
// that a top-level name would shadow, so a name read here that a top-level statement declares is that declaration.
function namesRead(root: Ast): Set<string> {
  const names = new Set<string>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (typeof node !== 'object' || node === null || typeof (node as Ast).type !== 'string') continue;
    const ast = node as Ast;
    if (ast.type === 'Identifier') names.add(ast.name as string);
    if (ast.type === 'MetaProperty') continue;
    for (const [key, child] of Object.entries(ast)) {
      if (key === 'property' && ast.type === 'MemberExpression' && !ast.computed) continue;
      if (key === 'key' && /^(Property|MethodDefinition|PropertyDefinition)$/.test(ast.type) && !ast.computed) continue;
      if (key === 'label') continue;
      stack.push(child);
    }
  }
  return names;
}

// The built `ws` in one emitted file: the top-level statements its two entry points reach, in the file's order
type BundledWs = { WebSocket: typeof WebSocket; WebSocketServer: typeof WebSocketServer };
function bundledWs(file: string, text: string): BundledWs {
  const body = (parseAst(text) as unknown as { body: Ast[] }).body;
  const declaring = new Map<string, number>();
  body.forEach((statement, index) => {
    if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') declaring.set((statement.id as Ast).name as string, index);
    if (statement.type === 'VariableDeclaration') for (const declarator of statement.declarations as Ast[]) for (const name of namesRead(declarator.id as Ast)) declaring.set(name, index);
  });
  const taken = new Set<number>();
  const pending = ['requireWebsocket', 'requireWebsocketServer'];
  for (const name of pending) expect(declaring.has(name), `${file} declares ${name}`).toBe(true);
  while (pending.length > 0) {
    const index = declaring.get(pending.pop()!);
    if (index === undefined || taken.has(index)) continue;
    taken.add(index);
    pending.push(...namesRead(body[index]));
  }
  // the statements left out kept as their newlines, so a stack names the emitted file's own lines
  let source = '';
  let at = 0;
  for (const index of [...taken].sort((a, b) => a - b)) {
    source += text.slice(at, body[index].start).replace(/[^\n]+/g, '') + text.slice(body[index].start, body[index].end);
    at = body[index].end;
  }
  const run = runInThisContext(`(function (require, __dirname, __filename) {"use strict";${source}\nreturn { WebSocket: requireWebsocket(), WebSocketServer: requireWebsocketServer() };\n})`, { filename: file });
  return (run as (...args: unknown[]) => BundledWs)(createRequire(file), dirname(file), file);
}

const carriesWs = ([, text]: [string, string]) => text.includes('function requireWebsocket()');
const mainGraph = graph === null ? null : graphOf(join(OUT, 'index.js'))!;
const builtWs = graph === null ? [] : [...new Map([...mainGraph!, ...graph])].filter(carriesWs);

// Each payload sent over a fresh connection from `Client` to `Server`, as the server received them
async function across(Client: typeof WebSocket, Server: typeof WebSocketServer, payloads: Buffer[]): Promise<Buffer[]> {
  const server = new Server({ host: '127.0.0.1', port: 0 });
  try {
    await once(server, 'listening');
    const received: Buffer[] = [];
    const all = new Promise<void>((done, fail) => {
      server.on('connection', (socket) => {
        socket.on('error', fail);
        socket.on('close', () => fail(new Error(`closed with ${received.length} of ${payloads.length} frames received`)));
        socket.on('message', (data) => void (received.push(data as Buffer), received.length === payloads.length && done()));
      });
    });
    const client = new Client(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
    try {
      const sent = once(client, 'open').then(() => payloads.forEach((payload) => client.send(payload)));
      await Promise.all([sent, all]); // either's failure is the case's, the other's then observed too
    } finally {
      client.terminate();
    }
    return received;
  } finally {
    server.close();
  }
}

describe.skipIf(graph === null)('the built ws', () => {
  // the sizes either side of the native helpers' thresholds (mask from 48 bytes, unmask from 32), and a large one
  const payloads = [31, 32, 47, 48, 64, 70_000].map((size) => randomBytes(size));

  it('is in main’s graph (its remote links)', () => {
    expect([...mainGraph!].filter(carriesWs)).not.toEqual([]);
  });

  const cases = builtWs.map(([file, text]) => [file.slice(OUT.length + 1), () => bundledWs(file, text)] as const);

  it.each(cases)('%s: its client masks frames of every size intact', async (_name, built) => {
    expect(await across(built().WebSocket, WebSocketServer, payloads)).toEqual(payloads);
  });

  it.each(cases)('%s: its server unmasks frames of every size intact', async (_name, built) => {
    expect(await across(WebSocket, built().WebSocketServer, payloads)).toEqual(payloads);
  });
});
// P5 O10 end

// Main-process bundles as Latin-1 text (scripts/latin1-bundles.ts, which fails the build itself): this holds the build's
// config to it, so a change that drops the plugin from main's or the preloads' output is caught where the build passes.
// Node keeps a loaded file's source in the heap, at two bytes a character for the whole file if one is above U+00FF.
describe.skipIf(!existsSync(OUT))('the built main, host and preload files', () => {
  it('hold no character above U+00FF', () => {
    const files = [OUT, resolve(OUT, '../preload')].flatMap((dir) =>
      existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.js')).map((name) => join(dir, name)) : [],
    );
    expect(files.length).toBeGreaterThan(2);
    expect(files.filter((file) => /[\u0100-\uffff]/.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
