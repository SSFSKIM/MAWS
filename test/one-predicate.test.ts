// One predicate of waiting (UX wave U1, contract UC-1, acceptance A17): outside the engine host, which moves items
// through their states, no file says whether an attention item waits but through `waits` or `waitsOnAnswer`
// (src/shared/attention/kinds.ts). This test reads every .ts and .tsx file under src/ but the suites, and fails on one
// that imports the old two-state predicate `isOpen` from the attention kinds (or the derivations that re-exported it),
// or that compares a state with `'delivered'`, either way round or as the two-state list. A comparison spread over
// statements or made through other names it cannot see, and the rule holds there all the same.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const ENGINE_HOST = 'src/engine-host/';

const IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const KINDS = /(?:^|\/)attention\/(?:kinds|derive)$/;
const COMPARISONS = [
  /\.state\s*[!=]==?\s*['"]delivered['"]/g, // x.state === 'delivered'
  /['"]delivered['"]\s*[!=]==?\s*[\w$.?]*\.state\b/g, // 'delivered' !== x.state
  /\[\s*['"]pending['"]\s*,\s*['"]delivered['"]\s*\]/g, // new Set(['pending', 'delivered'])
];

function importsIsOpen(text: string): number {
  let n = 0;
  for (const m of text.matchAll(IMPORT)) if (KINDS.test(m[2]) && /\bisOpen\b/.test(m[1])) n += 1;
  return n;
}
const comparisons = (text: string): number => (text.includes('delivered') ? COMPARISONS.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0) : 0);

// A file whose `state` is not an attention item's. Adding one is an edit here, with its count and its reason.
const EXCEPTIONS: Record<string, { count: number; why: string }> = {
  'src/renderer/src/owner/report/QuestionCard.tsx': { count: 2, why: "an owner-channel question's own state (src/shared/owner/state.ts), not an attention item's" },
  'src/services/channel/lane-b.ts': { count: 1, why: "an owner mark's question state, not an attention item's" },
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative(ROOT, path).split('\\').join('/')] : [];
  });
}

describe('the recogniser', () => {
  it.each([
    "import { isOpen } from '@shared/attention/kinds';",
    "import { isActionable, isOpen } from '../attention/derive';",
    "import {\n  isActionable as a,\n  isOpen as b,\n} from '@shared/attention/kinds';",
  ])('counts one import of the old predicate in %j', (text) => expect(importsIsOpen(text)).toBe(1));

  it.each([
    "import { isOpen } from '../stores/layout-model';", // another thing with the same name
    "import { waits } from '@shared/attention/kinds';",
  ])('counts none in %j', (text) => expect(importsIsOpen(text)).toBe(0));

  it.each([
    "item.state === 'pending' || item.state === 'delivered'",
    "if (current.state !== 'delivered') return;",
    "'delivered' === item?.state",
    "const WAITING = new Set(['pending', 'delivered']);",
  ])('counts one comparison in %j', (text) => expect(comparisons(text)).toBe(1));

  it.each([
    "if (outcome === 'delivered') setPhase('sent');",
    "result.value.outcome !== 'delivered'",
    "item.state === 'pending'",
  ])('counts none in %j', (text) => expect(comparisons(text)).toBe(0));
});

describe('one predicate of waiting', () => {
  it('no file outside the engine host imports the old predicate or compares a state with delivered, but the exceptions', () => {
    const found: Record<string, number> = {};
    for (const file of sources(join(ROOT, 'src'))) {
      if (file.startsWith(ENGINE_HOST)) continue;
      const text = readFileSync(join(ROOT, file), 'utf8');
      const n = importsIsOpen(text) + comparisons(text);
      if (n > 0) found[file] = n;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(EXCEPTIONS).map(([file, { count }]) => [file, count])));
  });
});
