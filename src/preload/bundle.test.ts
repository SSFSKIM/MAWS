// The built preloads (E4a execution document, Interfaces "The preload"): out/preload/ holds one file per preload entry
// (the app window's index.js, the browser view's browser.js, P5 O15 M2's repair window's repair.js) and nothing any one
// would have to `require` beside it. A
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
    // every entry is there: a build from before a preload existed is stale, and must not pass vacuously
    expect(files).toEqual(expect.arrayContaining(['index.js', 'browser.js', 'repair.js']));
    const offenders = files.filter((name) => /\brequire\(\s*["']\.\.?\//.test(readFileSync(join(OUT, name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
