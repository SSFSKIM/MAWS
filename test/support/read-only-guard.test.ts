import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWriteApis, scanFilesystemService } from './read-only-guard';

const apis = (source: string) => findWriteApis(source).map((v) => v.api);

describe('filesystem service never imports a write API', () => {
  it.each(['writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'mkdir', 'truncate', 'writeFileSync', 'createWriteStream', 'copyFile', 'chmod', 'utimes', 'symlink'])(
    'fails on a named import of %s',
    (api) => {
      expect(apis(`import { readFile, ${api} } from 'node:fs/promises';`)).toEqual([api]);
      expect(apis(`import { ${api} as quiet } from 'fs';`)).toEqual([api]);
    },
  );

  it('fails on a write API reached through a namespace, default or promises import', () => {
    expect(apis(`import * as fs from 'node:fs';\nfs.writeFileSync(p, 'x');`)).toEqual(['writeFileSync']);
    expect(apis(`import fs from 'fs';\nawait fs.promises.rename(a, b);`)).toEqual(['rename']);
    expect(apis(`import { promises as fsp } from 'node:fs';\nawait fsp.unlink(a);`)).toEqual(['unlink']);
  });

  it("fails on open(…, 'w' | 'a') and on an open whose flags it cannot read", () => {
    expect(apis(`import { open } from 'node:fs/promises';\nawait open(join(dir, name), 'w');`)).toEqual(["open(…, 'w')"]);
    expect(apis(`import { open } from 'node:fs/promises';\nawait open(path, "a+");`)).toEqual(["open(…, 'a+')"]);
    expect(apis(`import { openSync } from 'node:fs';\nopenSync(path, flags);`)).toEqual(['open(…, flags)']);
    expect(apis(`import * as fs from 'node:fs/promises';\nawait fs.open(path, 'r+');`)).toEqual(["open(…, 'r+')"]);
  });

  it('fails on a require or dynamic import of fs, which it cannot inspect', () => {
    expect(apis(`const fs = require('node:fs');`)).toEqual(['require(fs)']);
    expect(apis(`const fs = await import('fs/promises');`)).toEqual(['import(fs)']);
  });

  it("passes on reads, watches, open(…, 'r'), type imports and comments that name a write API", () => {
    const source = [
      `// never writeFile, rename or unlink here; open(p, 'w') is forbidden`,
      `/* fs.rm(dir) */`,
      `import { open, readdir, readFile, stat } from 'node:fs/promises';`,
      `import { watch } from 'node:fs';`,
      `import type { Stats } from 'node:fs';`,
      `const handle = await open(join(dir, name), 'r');`,
      `const again = await open(path);`,
      `const label = 'rename';`,
    ].join('\n');
    expect(findWriteApis(source)).toEqual([]);
  });

  it('fails on a write API taken out of fs by destructuring', () => {
    expect(apis(`import * as fs from 'node:fs';\nconst { readFileSync, writeFileSync } = fs;`)).toEqual(['writeFileSync']);
    expect(apis(`import fs from 'fs';\nconst { unlink: drop } = fs.promises;\nawait drop(p);`)).toEqual(['unlink']);
    expect(apis(`import { promises } from 'node:fs';\nconst { rename, readFile } = promises;`)).toEqual(['rename']);
    expect(apis(`import * as fs from 'node:fs';\nconst { promises: p } = fs;\nawait p.rm(dir);`)).toEqual(['rm']);
    expect(apis(`import * as fsp from 'node:fs/promises';\nconst { open } = fsp;\nawait open(path, 'w');`)).toEqual(["open(…, 'w')"]);
    expect(apis(`import * as fs from 'node:fs';\nconst { stat, readdir } = fs.promises;\nconst { open } = fs.promises;\nawait open(p, 'r');`)).toEqual([]);
  });

  it('fails on fs members it cannot name (a computed access)', () => {
    expect(apis(`import * as fs from 'node:fs';\nfs[method](p);`)).toEqual(['fs[…]']);
  });

  it('fails on every child_process spawn, imported by name, namespace, destructuring, require or dynamic import', () => {
    expect(apis(`import { execFile } from 'node:child_process';\nexecFile('/bin/rm', ['-rf', dir]);`)).toEqual(['execFile']);
    expect(apis(`import { exec as run, spawnSync } from 'child_process';\nrun('touch x');\nspawnSync('mv', [a, b]);`)).toEqual(['exec', 'spawnSync']);
    expect(apis(`import * as cp from 'node:child_process';\ncp.spawn('cp', [a, b]);\ncp.execSync('rm x');\ncp.fork(script);`)).toEqual(['spawn', 'execSync', 'fork']);
    expect(apis(`import cp from 'node:child_process';\nconst { execFileSync } = cp;`)).toEqual(['execFileSync']);
    expect(apis(`import { execFile } from 'node:child_process';\nconst run = promisify(execFile);`)).toEqual(['execFile']);
    expect(apis(`const cp = require('child_process');`)).toEqual(['require(child_process)']);
    expect(apis(`const cp = await import('node:child_process');`)).toEqual(['import(child_process)']);
    expect(apis(`import type { ChildProcess } from 'node:child_process';`)).toEqual([]);
  });

  describe("the one allowlisted spawn: holders.ts's /bin/ps", () => {
    const tree = (files: Record<string, string>) => {
      const root = mkdtempSync(join(tmpdir(), 'maws-guard-'));
      for (const [name, source] of Object.entries(files)) writeFileSync(join(root, name), source);
      try {
        return scanFilesystemService(root).violations.map((v) => `${v.file}:${v.api}`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
    const ps = `import { execFile } from 'node:child_process';\nexecFile(ps, ['-o', 'pid=,lstart=', '-p', pids], { env }, done);\n`;

    it('passes on one execFile in holders.ts', () => {
      expect(tree({ 'holders.ts': ps })).toEqual([]);
    });

    it('fails on a second spawn in holders.ts, on another spawn API there, and on the same call anywhere else', () => {
      expect(tree({ 'holders.ts': `${ps}execFile('/bin/rm', [p]);\n` })).toEqual(['holders.ts:execFile']);
      expect(tree({ 'holders.ts': `import { execFile, spawn } from 'node:child_process';\nexecFile(ps, []);\nspawn('touch', [p]);\n` })).toEqual(['holders.ts:spawn']);
      expect(tree({ 'discovery.ts': ps })).toEqual(['discovery.ts:execFile']);
    });
  });

  it('passes on the sources under src/engine-host/fs', () => {
    const { files, violations } = scanFilesystemService();
    expect(files).toEqual(expect.arrayContaining(['discovery.ts', 'holders.ts', 'service.ts', 'sidecars.ts', 'watcher.ts', 'chain-follower.ts', 'follow.ts', 'subagents.ts', 'workflows.ts', 'tasks.ts', 'artifacts.ts']));
    expect(files.some((file) => file.endsWith('.test.ts'))).toBe(false);
    expect(violations).toEqual([]);
  });
});
