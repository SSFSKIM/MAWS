import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankPaths } from './fuzzy';

describe('the subsequence scorer', () => {
  it('matches a subsequence case-insensitively and refuses anything else', () => {
    expect(fuzzyScore('mn', 'Main')).not.toBeNull();
    expect(fuzzyScore('nm', 'main')).toBeNull();
    expect(fuzzyScore('mains', 'main')).toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('prefers a match at a segment boundary and consecutive characters', () => {
    expect(fuzzyScore('main', 'src/main.ts')!).toBeGreaterThan(fuzzyScore('main', 'src/domain.ts')!);
    expect(fuzzyScore('main', 'src/main.ts')!).toBeGreaterThan(fuzzyScore('main', 'src/m_a_i_n.ts')!);
    expect(fuzzyScore('sm', 'src/main.ts')!).toBeGreaterThan(fuzzyScore('sm', 'assembly.ts')!);
    expect(fuzzyScore('ar', 'app/readme')!).toBeGreaterThan(fuzzyScore('ar', 'bar')!); // two boundaries beat one run in a word's middle
  });

  it('ranks by score, then the shorter path, then alphabetically, deterministically', () => {
    const paths = ['docs/main-notes.md', 'src/domain.ts', 'src/main.ts', 'README.md', 'lib/main.ts'];
    expect(rankPaths('main', paths)).toEqual(['lib/main.ts', 'src/main.ts', 'docs/main-notes.md', 'src/domain.ts']);
    expect(rankPaths('main', [...paths].reverse())).toEqual(rankPaths('main', paths));
    expect(rankPaths('', ['b/c.ts', 'a.ts', 'b/']).slice(0, 3)).toEqual(['b/', 'a.ts', 'b/c.ts']);
  });
});
