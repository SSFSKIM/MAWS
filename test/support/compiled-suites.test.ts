// The renderer suites run again under the React Compiler (test/support/compiled-suites.ts; P3-F, the tracker's
// compiled-include row), over the repository's own files and its vitest config: every component and hook suite is
// selected, `.ts` hook suites included, the Node-run and timing suites left to their projects; and vitest's
// `renderer-compiled` project runs exactly that selection through the compiler plugin.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';
import { compiledRendererSuites } from './compiled-suites';

const ROOT = resolve(__dirname, '..', '..');
const TIMING = ['src/renderer/src/App.test.tsx', 'src/renderer/src/sessions/resource.test.tsx'];
const selected = compiledRendererSuites(ROOT, TIMING);
const all = (dir: string) => readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' }).map((rel) => `${dir}/${rel}`);

describe('the compiled renderer suites', () => {
  it('include the hook and element suites written as .ts, the motivating library hook first', () => {
    for (const file of ['src/renderer/src/library/export.test.ts', 'src/renderer/src/tools/browser/settings.test.ts', 'src/renderer/src/tools/browser/cover.test.ts']) expect(selected, file).toContain(file);
  });

  it('include every .tsx suite of the renderer project, main’s DOM suite among them, but the timing ones', () => {
    const tsx = [...all('src/renderer').filter((f) => f.endsWith('.test.tsx')), ...all('src/main/artifacts').filter((f) => f.endsWith('.dom.test.tsx'))];
    expect(tsx.length).toBeGreaterThan(190);
    for (const file of tsx) expect(selected.includes(file), file).toBe(!TIMING.includes(file));
  });

  it('leave out the terminal’s Node-run suites and a .ts suite that touches no React (a DOM createElement is not React’s)', () => {
    expect(selected.filter((f) => f.endsWith('.node.test.ts'))).toEqual([]);
    expect(selected).not.toContain('src/renderer/src/terminal/registry.test.ts');
    expect(selected).not.toContain('src/renderer/src/stores/composer.test.ts');
  });

  it('are what vitest’s renderer-compiled project runs, through the React Compiler', () => {
    const projects = (config.test?.projects ?? []) as unknown as { test?: { name?: string; include?: string[]; env?: Record<string, string> }; plugins?: unknown[] }[];
    const project = projects.find((p) => typeof p === 'object' && p.test?.name === 'renderer-compiled')!;
    expect(project.test!.include).toEqual(expect.arrayContaining(selected));
    expect(project.test!.env).toEqual({ MAWS_REACT_COMPILER: '1', LC_ALL: 'ko_KR.UTF-8', LANG: 'ko_KR.UTF-8' }); // P4-W2L: under the owner's Korean locale
    expect(JSON.stringify(project.plugins?.flat(Infinity).map((p) => (p as { name?: string }).name))).toContain('vite:react-babel');
  });

  it('have the portable artifact layer’s React suites beside them, under the same compiler and locale (P4 W2-D)', () => {
    const projects = (config.test?.projects ?? []) as unknown as { test?: { name?: string; include?: string[]; env?: Record<string, string> }; plugins?: unknown[] }[];
    const project = projects.find((p) => typeof p === 'object' && p.test?.name === 'artifacts-dom-compiled')!;
    expect(project.test!.include).toEqual(['src/artifacts/**/*.dom.test.tsx']);
    expect(project.test!.env).toEqual({ MAWS_REACT_COMPILER: '1', LC_ALL: 'ko_KR.UTF-8', LANG: 'ko_KR.UTF-8' });
    expect(JSON.stringify(project.plugins?.flat(Infinity).map((p) => (p as { name?: string }).name))).toContain('vite:react-babel');
  });
});
