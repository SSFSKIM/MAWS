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

  it('passes on the sources under src/engine-host/fs', () => {
    const { files, violations } = scanFilesystemService();
    expect(files).toEqual(expect.arrayContaining(['discovery.ts', 'holders.ts', 'service.ts', 'sidecars.ts', 'watcher.ts', 'chain-follower.ts']));
    expect(files.some((file) => file.endsWith('.test.ts'))).toBe(false);
    expect(violations).toEqual([]);
  });
});
