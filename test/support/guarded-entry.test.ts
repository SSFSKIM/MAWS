// The guarded-entry rule (guarded-entry.ts) both ways, over a scratch `out/` of hand-written CommonJS: a chunk the
// build emitted beside the entry is admitted, deferred or not; a bare specifier deferred, a path out of `out/`, a chunk
// that isn't there, a computed specifier and an external no list allows are refused, and so is any deferred load where
// the entry admits none.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { guardedEntryProblems, loadsOf } from './guarded-entry';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

/** A scratch out/main with `files` (relative path → text); answers the entry's path and the root. */
function built(files: Record<string, string>): { entry: string; root: string } {
  dir = mkdtempSync(join(tmpdir(), 'guarded-'));
  const root = join(dir, 'out');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, 'main', name, '..'), { recursive: true });
    writeFileSync(join(root, 'main', name), text);
  }
  return { entry: join(root, 'main', 'entry.js'), root };
}

const deferredLoad = (specifier: string) => `return new Lazy(() => Promise.resolve().then(() => require("${specifier}")));`;

describe('the guarded-entry rule', () => {
  it('reads each load as at start or deferred, and counts computed ones', () => {
    const { loads, computed } = loadsOf('/o/e.js', ['const a = require("node:fs");', deferredLoad('./chunks/b.js'), 'import("./chunks/c.js");', ' * import("../in-a-comment.js")', 'const d = require(name);'].join('\n'));
    expect(loads).toEqual([
      { file: '/o/e.js', specifier: 'node:fs', deferred: false },
      { file: '/o/e.js', specifier: './chunks/b.js', deferred: true },
      { file: '/o/e.js', specifier: './chunks/c.js', deferred: true },
    ]);
    expect(computed).toBe(1);
  });

  it('admits builtins, allowed externals and chunks the build emitted beside the entry, deferred ones and theirs included', () => {
    const out = built({
      'entry.js': ['const fs = require("node:fs");', 'const path = require("path");', 'const zod = require("zod");', 'const shared = require("./chunks/shared-1.js");', deferredLoad('./chunks/endpoint-2.js')].join('\n'),
      'chunks/shared-1.js': 'const net = require("node:net");',
      'chunks/endpoint-2.js': ['const shared = require("./shared-1.js");', 'const ws = require("./ws-3.js");'].join('\n'),
      'chunks/ws-3.js': 'const tls = require("tls");',
    });
    expect(guardedEntryProblems({ ...out, externals: (name) => name === 'zod', deferred: true })).toEqual([]);
  });

  it('refuses a deferred bare specifier, a path out of out/, a chunk that isn’t there, a computed load and an external not allowed', () => {
    const out = built({
      'entry.js': [deferredLoad('ws'), 'import("electron");', deferredLoad('../../elsewhere/x.js'), deferredLoad('./chunks/missing.js'), 'const m = require(name);', 'const pty = require("node-pty");'].join('\n'),
    });
    const problems = guardedEntryProblems({ ...out, externals: (name) => name === 'zod', deferred: true });
    expect(problems).toHaveLength(6);
    expect(problems).toContain("main/entry.js: 1 load(s) of a computed specifier, which can't be judged");
    expect(problems).toContain('main/entry.js: a deferred load of ws: deferred, only a chunk beside the entry, by a relative path');
    expect(problems.filter((p) => p.startsWith('main/entry.js: a deferred load of ../../elsewhere/x.js: outside '))).toHaveLength(1);
    expect(problems).toContain('main/chunks/missing.js: not a file this build emitted');
    expect(problems).toContain('main/entry.js: a deferred load of electron: deferred, only a chunk beside the entry, by a relative path');
    expect(problems).toContain('main/entry.js: a load of node-pty: neither a Node builtin nor an allowed external');
  });

  // A load is judged only when its whole argument is one string literal; anything else (a concatenation, a template
  // literal, a variable) is refused as unjudgeable rather than read as no load at all.
  it('refuses a load whose argument is not one string literal, deferred or at start', () => {
    for (const line of ['import("./chunks/" + name);', 'Promise.resolve().then(() => require("./chunks/" + name));', 'const m = require(`./chunks/${name}.js`);', 'const n = require(`./chunks/a.js`);', "const o = require('./a.js' + suffix);"]) {
      expect(loadsOf('/o/e.js', line), line).toEqual({ loads: [], computed: 1 });
      const out = built({ 'entry.js': line });
      expect(guardedEntryProblems({ ...out, deferred: true }), line).toEqual(["main/entry.js: 1 load(s) of a computed specifier, which can't be judged"]);
    }
  });

  it('refuses every deferred load where the entry admits none, its chunk beside it included', () => {
    const out = built({ 'entry.js': deferredLoad('./chunks/endpoint-2.js'), 'chunks/endpoint-2.js': '' });
    expect(guardedEntryProblems({ ...out, deferred: false })).toEqual(['main/entry.js: a deferred load of ./chunks/endpoint-2.js: this entry admits no deferred load']);
  });
});
