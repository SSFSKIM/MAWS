// The built preloads (E4a execution document, Interfaces "The preload"): out/preload/ holds one file per preload entry
// (the app window's index.js, the browser view's browser.js) and nothing either one would have to `require` beside it. A
// sandboxed preload's `require` loads only `electron`, `events`, `timers` and `url`, so if two entries ever share a
// module and Rollup splits it into a chunk, both preloads fail to load: this test fails first. It reads a build, so it
// runs only where one exists (`electron-vite build` writes out/).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const OUT = resolve(__dirname, '../../out/preload');
const built = existsSync(OUT);

describe.skipIf(!built)('the built preloads (needs `electron-vite build`)', () => {
  it('no preload requires a sibling chunk', () => {
    const files = readdirSync(OUT, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((name) => /\brequire\(\s*["']\.\.?\//.test(readFileSync(join(OUT, name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
