import { describe, expect, it } from 'vitest';
import { instrTerms, matchExpression, parseQuery, type QueryTerm } from './search-query';

const word = (text: string): QueryTerm => ({ text, phrase: false });
const phrase = (text: string): QueryTerm => ({ text, phrase: true });

describe('parseQuery: the words of an artifact search', () => {
  it('takes every whitespace-separated word as a term, Korean and English alike', () => {
    expect(parseQuery('Q3 로드맵 budget')).toEqual({ terms: [word('Q3'), word('로드맵'), word('budget')] });
    expect(parseQuery('  로드맵\t\n회의  ')).toEqual({ terms: [word('로드맵'), word('회의')] });
  });

  it('takes the text inside double quotes as one phrase, an unclosed quote running to the end', () => {
    expect(parseQuery('budget "design review" 2027')).toEqual({ terms: [word('budget'), phrase('design review'), word('2027')] });
    expect(parseQuery('roadmap "design review')).toEqual({ terms: [word('roadmap'), phrase('design review')] });
    expect(parseQuery('a"b c"d')).toEqual({ terms: [word('a'), phrase('b c'), word('d')] }); // a quote ends the word before it
  });

  it('collapses the whitespace inside a phrase and trims it', () => {
    expect(parseQuery('"  design \t\n review  "')).toEqual({ terms: [phrase('design review')] });
  });

  it('normalises to NFC, so a decomposed query matches composed text', () => {
    const decomposed = '로드맵 회의'.normalize('NFD');
    expect(decomposed).not.toBe('로드맵 회의');
    expect(parseQuery(decomposed)).toEqual({ terms: [word('로드맵'), word('회의')] });
  });

  it('drops empty terms and keeps a duplicate once, case-insensitively, as first written', () => {
    expect(parseQuery('""  "   " ')).toEqual({ terms: [] });
    expect(parseQuery('')).toEqual({ terms: [] });
    expect(parseQuery('Roadmap roadmap ROADMAP "roadmap"')).toEqual({ terms: [word('Roadmap')] });
    expect(parseQuery('"Design Review" design  review "design review"')).toEqual({ terms: [phrase('Design Review'), word('design'), word('review')] });
  });
});

describe('matchExpression and instrTerms: the two halves of the SQL', () => {
  it('sends a term of three or more code points to MATCH as an FTS5 phrase, joined by AND', () => {
    expect(matchExpression(parseQuery('회의 로드맵 "design review" budget').terms)).toBe('"로드맵" AND "design review" AND "budget"');
    expect(matchExpression(parseQuery('abc').terms)).toBe('"abc"');
  });

  it('is null when no term is long enough for the trigram index', () => {
    expect(matchExpression(parseQuery('회의 Q3 a').terms)).toBeNull();
    expect(matchExpression([])).toBeNull();
  });

  it('counts code points, not UTF-16 units', () => {
    expect(matchExpression([word('😀😀')])).toBeNull(); // two code points, four units
    expect(instrTerms([word('😀😀')])).toEqual(['😀😀']);
    expect(matchExpression([word('a😀b')])).toBe('"a😀b"');
  });

  it('escapes every term as a phrase: quotes doubled, FTS5 operators inert', () => {
    expect(matchExpression([word('say"so'), phrase('a "b" c')])).toBe('"say""so" AND "a ""b"" c"');
    expect(matchExpression(parseQuery('NOT foo* -bar NEAR(x) col:val ^abc').terms)).toBe('"NOT" AND "foo*" AND "-bar" AND "NEAR(x)" AND "col:val" AND "^abc"');
  });

  it('gives the short terms to instr, lowered as SQLite lower() lowers (ASCII only)', () => {
    expect(instrTerms(parseQuery('회의 Q3 roadmap Ab').terms)).toEqual(['회의', 'q3', 'ab']);
    expect(instrTerms([word('ΑΒ'), word('Éa')])).toEqual(['ΑΒ', 'Éa']); // Greek and accented capitals stay as written
    expect(instrTerms(parseQuery('roadmap budget').terms)).toEqual([]);
  });
});
