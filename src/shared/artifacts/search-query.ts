// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "The query parser"; ledger X33): the words of an
// artifact search, shared so the host's `artifact_search` and, later, main's library search read a query alike. Every
// term must appear (AND). A term of 3 or more code points is matched through the trigram FTS5 index (`MATCH`); a shorter
// one, which the trigram tokenizer cannot match, through `instr(lower(column), ?)`.

export interface QueryTerm {
  text: string;
  phrase: boolean; // written inside double quotes: matched as one run of text, spaces included
}

const MATCH_TERM_MIN = 3; // code points: a trigram's length

const codePoints = (text: string): number => [...text].length;
const isMatchTerm = (term: QueryTerm): boolean => codePoints(term.text) >= MATCH_TERM_MIN;

// NFC and trimmed; the text inside "…" one phrase term (an unclosed quote runs to the end), every other
// whitespace-separated word one term; whitespace inside a term collapsed; empty terms dropped; a duplicate
// (case-insensitively) kept once, as first written.
export function parseQuery(query: string): { terms: QueryTerm[] } {
  const terms: QueryTerm[] = [];
  const seen = new Set<string>();
  const add = (raw: string, phrase: boolean) => {
    const text = raw.replace(/\s+/gu, ' ').trim();
    const key = text.toLowerCase();
    if (text === '' || seen.has(key)) return;
    seen.add(key);
    terms.push({ text, phrase });
  };
  // split on the quote: the even pieces are outside quotes, the odd ones inside
  query
    .normalize('NFC')
    .trim()
    .split('"')
    .forEach((piece, index) => {
      if (index % 2 === 1) add(piece, true);
      else for (const word of piece.split(/\s+/u)) add(word, false);
    });
  return { terms };
}

// The `MATCH` terms as FTS5 phrases (quotes doubled, so no term is read as an operator) joined by AND; null when none.
export function matchExpression(terms: readonly QueryTerm[]): string | null {
  const phrases = terms.filter(isMatchTerm).map((term) => `"${term.text.replaceAll('"', '""')}"`);
  return phrases.length > 0 ? phrases.join(' AND ') : null;
}

// The short terms, lowered as SQLite's `lower()` lowers (ASCII only), for `instr(lower(column), ?) > 0`.
export function instrTerms(terms: readonly QueryTerm[]): string[] {
  return terms.filter((term) => !isMatchTerm(term)).map((term) => term.text.replace(/[A-Z]/g, (c) => c.toLowerCase()));
}
