// Source control reads and changes nothing; one diff viewer (UX wave U5, acceptance S2 and S12, and A19's guard beside
// test/one-working-folder.test.ts; docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §H and M11).
// The owner's answer of 2026-11-13: the window does not stage, discard, commit, push or open a pull request. This test
// reads this build's product source under src/, suites and comments included, and fails while
//   1. a file under src/renderer/src/tools/scm/ or src/renderer/src/tools/code/review/ names one of the commands that
//      change a repository or follow such a run (the services, the schema and their tests still serve them for a window
//      of an older build, and are not read here);
//   2. a file outside src/renderer/src/tools/code/review/ imports the stack's file body, `FileBody`, or a module named
//      `ReviewView` (after M11 none is, under src/: the desk's web app keeps its own copy beside its diff pane);
//   3. a file under src/renderer/ spells one of the acting pane's markers (its rows, its groups, its acts), so no element
//      can carry them.
// Nothing under e2e/ is read: the two-build spec drives an older build's acting pane by that pane's own locators.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCM = 'src/renderer/src/tools/scm/';
const REVIEW = 'src/renderer/src/tools/code/review/';

const ACTS = ['scm.stage', 'scm.unstage', 'scm.discard', 'scm.commit', 'scm.push.plan', 'scm.push', 'scm.pr.plan', 'scm.pr.create', 'scm.remote.cancel', 'scm.remote.last', 'scm.remote.output'];
const ACT = new RegExp(String.raw`\b(?:${ACTS.map((name) => name.replaceAll('.', String.raw`\.`)).join('|')})(?![\w.])`, 'g');
const acts = (text: string): string[] => [...new Set(text.match(ACT) ?? [])];

// An import of a module whose last path part is FileBody or ReviewView: `from '…'`, `import('…')`, `vi.mock('…')`.
const VIEW = String.raw`['"](?:[^'"]*/)?(?:FileBody|ReviewView)(?:\.tsx?)?['"]`;
const VIEW_IMPORT = new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.mock\(\s*)${VIEW}`, 'g');
const viewImports = (text: string): number => text.match(VIEW_IMPORT)?.length ?? 0;

const MARKER = /\bdata-scm-(?:action|row|group)(?![\w-])/g;
const markers = (text: string): string[] => [...new Set(text.match(MARKER) ?? [])];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(?:tsx?|css)$/.test(entry.name) ? [relative(ROOT, path).split('\\').join('/')] : [];
  });
}
const text = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');
const SRC = sources(resolve(ROOT, 'src'));

describe('the recognisers', () => {
  it.each([
    ["window.maws.invoke('scm.stage', { directory, paths })", ['scm.stage']],
    ["call('scm.push.plan', input); call('scm.push', plan)", ['scm.push.plan', 'scm.push']],
    ['// follows scm.remote.output until the run ends', ['scm.remote.output']],
    ["main.answers['scm.pr.create'] = ok", ['scm.pr.create']],
  ])('finds the acts in %j', (source, found) => {
    expect(acts(source)).toEqual(found);
  });

  it.each(["invoke('scm.status', { directory })", "usePrState('scm.pr.state')", 'scm.pushed', 'scm.commits', "SCM_COPY.commitsPart"])('finds no act in %j', (source) => {
    expect(acts(source)).toEqual([]);
  });

  it.each([
    "import ReviewView from '../code/review/ReviewView';",
    "const ReviewView = lazy(() => import('../code/review/ReviewView'));",
    "const FileBody = lazy(() => import('./FileBody'));",
    "import type { DiffBlockData } from './FileBody';",
    "vi.mock('../review/FileBody.tsx', () => ({}));",
  ])('counts one import in %j', (source) => {
    expect(viewImports(source)).toBe(1);
  });

  it.each(["import { FileSection } from './FileSection';", '// the successor of the old one-file viewer', "import { reviewLayout } from './measure';"])('counts none in %j', (source) => {
    expect(viewImports(source)).toBe(0);
  });

  it.each([
    ['<button data-scm-action="stage">', ['data-scm-action']],
    ["document.querySelectorAll('[data-scm-row]')", ['data-scm-row']],
    ['<ul data-scm-group={group.key}>', ['data-scm-group']],
    ['<div data-scm-groups data-scm-commit-group data-scm-row-count>', []],
  ])('finds the markers in %j', (source, found) => {
    expect(markers(source)).toEqual(found);
  });
});

describe('Source control reads only (S2)', () => {
  it('finds no command that changes a repository under tools/scm/ or tools/code/review/', () => {
    const found = SRC.filter((file) => file.startsWith(SCM) || file.startsWith(REVIEW)).flatMap((file) => {
      const names = acts(text(file));
      return names.length > 0 ? [`${file}: ${names.join(', ')}`] : [];
    });
    expect(found, "Source control and Review read and change nothing (the owner's answer of 2026-11-13): these files name a command that changes a repository or follows such a run").toEqual([]);
  });

  it("finds none of the acting pane's markers under src/renderer/", () => {
    const found = SRC.filter((file) => file.startsWith('src/renderer/')).flatMap((file) => {
      const names = markers(text(file));
      return names.length > 0 ? [`${file}: ${names.join(', ')}`] : [];
    });
    expect(found, "the acting pane's rows, groups and acts are gone: these files still spell their markers").toEqual([]);
  });
});

describe('one diff viewer (S12)', () => {
  it("finds the stack's file body imported only inside tools/code/review/, and no ReviewView imported under src/", () => {
    const found = SRC.filter((file) => !file.startsWith(REVIEW) && viewImports(text(file)) > 0);
    expect(found, "Review's stack is the renderer's one diff viewer: these files outside tools/code/review/ import its file body or a ReviewView").toEqual([]);
  });
});
