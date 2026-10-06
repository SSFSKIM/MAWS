// The `ListAgents` result's listing, parsed (SPEC 38 §38.26.3; E7 execution document, Design §4 and Decision Log 24):
// the self line, then up to three sections `"<Section> (<count>):"` of rows `"  " + [primary, ...extras].join("  ·  ")`,
// the primary `name [ref]` or a bare name, joined by blank lines. Everything else (the overflow line, the parenthesised
// notes, the empty and messaging-off states, a text of no known shape) is a note, so nothing the engine said is lost.
// Pure.

export type ListingSectionTitle = 'Subagents' | 'Teammates' | 'Peer sessions';

export interface ListingRow {
  name: string;
  ref: string | null;
  extras: string[];
}

export interface ListingSection {
  title: ListingSectionTitle;
  count: number; // the header's count: the engine's pre-slice total, so a truncated section still says how many exist
  rows: ListingRow[];
}

export interface Listing {
  self: string | null; // the session's own `name [ref]` as the self line prints it (the main session's, for a subagent caller)
  sections: ListingSection[];
  notes: string[];
}

const SELF = /^This (?:session|process's main session) is (.+?) — /;
const HEADER = /^(Subagents|Teammates|Peer sessions) \((\d+)\):$/;
const ROW = /^ {2}(?! )(.*)$/;
const OVERFLOW = /^\(… \d+ more not shown\)$/;
const NAMED = /^(.*) \[([^\]\s]+)\]$/;
const SEPARATOR = '  ·  ';

export function parseListing(text: string): Listing {
  const listing: Listing = { self: null, sections: [], notes: [] };
  let section: ListingSection | null = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      section = null;
      continue;
    }
    const self = listing.self === null && listing.sections.length === 0 ? SELF.exec(line) : null;
    if (self) {
      listing.self = self[1]!;
      continue;
    }
    const header = HEADER.exec(line);
    if (header) {
      section = { title: header[1] as ListingSectionTitle, count: Number(header[2]), rows: [] };
      listing.sections.push(section);
      continue;
    }
    const row = section === null ? null : ROW.exec(line);
    if (section !== null && row && !OVERFLOW.test(row[1]!)) {
      const [primary, ...extras] = row[1]!.split(SEPARATOR);
      const named = NAMED.exec(primary!);
      section.rows.push({ name: named ? named[1]! : primary!, ref: named ? named[2]! : null, extras });
      continue;
    }
    listing.notes.push(line.trim());
  }
  return listing;
}
