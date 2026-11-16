// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md; the Decision Log's ruling of 2026-11-16 on the branch
// panel's findings): whether a person's message is MAWS's answer envelope is read in one place, the split's module
// (`answerEnvelopeOf`, beside `splitPersonsMessage`), so no reader records an answer, hides a message or passes one over
// by a parse of its own. This guard reads the source tree for the calls that parse an envelope and allows them only at
// the sites below, each with its reason. A new reader calls `answerEnvelopeOf`, or `splitPersonsMessage`; a site added
// here says why it cannot.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const SCANNED = ['src', 'apps'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '.vite', '.turbo']);
const isSource = (name: string) => /\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.(test|spec)\.[a-z]+$/.test(name);

/** The calls that read an envelope from a text: the envelope's own checks, the reader's slicing, and the reader's answers. */
const PARSE = /\b(parseAskSteer|answeredBlock|envelopeSlices|readAnswerEnvelopes?)\s*\(/g;

/** Each allowed file, the names it may call, and why. */
const ALLOWED: Record<string, { names: string[]; why: string }> = {
  'src/shared/maws/ask.ts': { names: ['answeredBlock', 'parseAskSteer'], why: 'the envelope’s own checks are defined here; parseAskSteer reads through answeredBlock (Interfaces A)' },
  'src/shared/engine/arrival.ts': {
    names: ['envelopeSlices', 'readAnswerEnvelopes', 'readAnswerEnvelope'],
    why: 'the reader: envelopeSlices and readAnswerEnvelopes are defined here; readAnswerEnvelope is the whole-text form of the split’s reading, which answerEnvelopeOf calls (the split’s module imports this one, never the reverse); personsText is the reader’s rule 3, whose `answer` arrivals for MAWS’s own envelope every producer treats as the person’s message and acts on no further',
  },
  'src/shared/engine/persons-message.ts': { names: ['envelopeSlices', 'readAnswerEnvelope'], why: 'the split and answerEnvelopeOf, the one reading of a person’s message' },
  'src/engine-host/fs/search-text.ts': {
    names: ['envelopeSlices'],
    why: 'the search text’s worker runs from a source string and can import nothing: it gets the reader’s own functions interpolated and reads a person’s text with them (decision 8)',
  },
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sources(join(dir, entry.name));
    return entry.isFile() && isSource(entry.name) ? [join(dir, entry.name)] : [];
  });
}

it('no source outside the named sites parses an answer envelope from a message: every reader asks the split’s module', () => {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const file of SCANNED.flatMap((dir) => sources(join(ROOT, dir)))) {
    const path = relative(ROOT, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(PARSE)) {
      const name = match[1]!;
      if (ALLOWED[path]?.names.includes(name)) {
        seen.add(`${path} ${name}`);
        continue;
      }
      found.push(`${path}:${text.slice(0, match.index).split('\n').length} ${name}`);
    }
  }
  expect(found).toEqual([]);
  // every allowance is still used, so none outlives its reason
  expect([...seen].sort()).toEqual(Object.entries(ALLOWED).flatMap(([path, { names }]) => names.map((name) => `${path} ${name}`)).sort());
});
