// The law, `DESIGN.md` (D5): the designer skill's nine sections (references/guidelines-authoring.md), read so the page
// can show them, the library can show the persona, and the check can run the hard don'ts. A section is found by its
// heading's number, in order, so the title words are the author's; `## 0. Stance commitment`, `## 0 — Stance` and
// `## §0 Stance` all open section 0. The level of the first numbered heading is the sections' level; a numbered heading
// deeper than it (`### 2.1 …`) and an unnumbered one before §8 stay inside the section they sit in. After §8 every
// heading at the sections' level or above opens an extra section, as the skill allows. Headings inside fenced code
// blocks are text. Only ATX headings (`#`) count. Portable (§4.10).

/** The nine sections' names, for messages (the author's own titles are kept on each section). */
export const LAW_SECTION_NAMES = [
  'Stance commitment',
  'Palette',
  'Typography',
  'Canvas, texture and material',
  'Layout system',
  'Component canon',
  'Voice',
  'Motion',
  'Hard don’ts',
] as const;

/** D12's bound: a law readable in one `artifact_read`. */
export const LAW_LIMIT_BYTES = 256 * 1024;

export interface LawSection {
  /** 0 to 8 for the nine; an extra section's own number (9, …) or null when its heading has none. */
  number: number | null;
  /** The heading's words after the number. */
  title: string;
  /** The heading line as written. */
  heading: string;
  /** 1-based line of the heading. */
  line: number;
  /** The section's markdown up to the next section, without its heading, trimmed. */
  body: string;
}

/** One `[check: …]` rule: `accent-max:1` is `{name: 'accent-max', param: '1'}`. The vocabulary is check.ts's. */
export interface CheckTag {
  raw: string;
  name: string;
  param: string | null;
}

/** One bullet of §8. */
export interface HardDont {
  /** Its position among the don'ts, from 0. */
  index: number;
  /** The rule's words, continuation lines joined, the tags removed. */
  text: string;
  tags: CheckTag[];
  /** 1-based line of the bullet. */
  line: number;
}

export interface LawProblem {
  message: string;
  /** 1-based line, when the problem sits at one. */
  line?: number;
}

export interface Law {
  /** The first `#` heading before section 0. */
  title: string | null;
  /** The value of the `persona:` line in section 0, when a persona governs. */
  persona: string | null;
  /** What precedes section 0, trimmed. */
  preamble: string;
  /** The numbered sections 0 to 8 found, in the order written. */
  sections: LawSection[];
  /** The sections after 8, and a repeated section's second copy. */
  extras: LawSection[];
  donts: HardDont[];
  problems: LawProblem[];
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const NUMBERED = /^(?:§\s*)?(\d+)(?:\s*[.):]|\s+[—–-])?(?:\s+(.*))?$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TAG = /\[check:([^\]]*)\]/gi;

interface Heading {
  index: number; // 0-based line index
  level: number;
  text: string;
  number: number | null;
  title: string;
}

/** The lines that are not inside a fenced code block, by index. */
function unfenced(lines: readonly string[]): boolean[] {
  const out: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line)?.[1];
    if (open === null) {
      if (fence) open = fence;
      out.push(fence === undefined);
    } else {
      if (fence && fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null;
      out.push(false);
    }
  }
  return out;
}

/** Removes matching wrappers (`code`, **bold**, __bold__) from both ends. */
function unwrap(text: string): string {
  let out = text.trim();
  for (;;) {
    const match = /^(`+|\*\*|__)([\s\S]*)\1$/.exec(out);
    if (!match) return out;
    out = match[2]!.trim();
  }
}

function personaOf(body: string): string | null {
  const lines = body.split('\n');
  const plain = unfenced(lines);
  for (let i = 0; i < lines.length; i++) {
    if (!plain[i]) continue;
    const line = unwrap(lines[i]!.trim().replace(/^[-*+][ \t]+/, ''));
    const match = /^(?:\*\*|__|`)?persona(?:\*\*|__|`)?\s*:\s*(?:\*\*|__)?\s*([\s\S]+)$/i.exec(line);
    if (match) {
      const value = unwrap(match[1]!);
      if (value) return value;
    }
  }
  return null;
}

function tagsOf(text: string): { text: string; tags: CheckTag[] } {
  const tags: CheckTag[] = [];
  const stripped = text.replace(TAG, (_, inner: string) => {
    for (const part of inner.split(',')) {
      const raw = part.trim();
      if (!raw) continue;
      const colon = raw.indexOf(':');
      tags.push(colon < 0 ? { raw, name: raw, param: null } : { raw, name: raw.slice(0, colon).trim(), param: raw.slice(colon + 1).trim() });
    }
    return ' ';
  });
  return { text: stripped.replace(/\s+/g, ' ').trim(), tags };
}

/** §8's top-level list items, each with its continuation lines and nested items. */
function dontsOf(body: string, firstLine: number): HardDont[] {
  const lines = body.split('\n');
  const plain = unfenced(lines);
  const items: { line: number; parts: string[] }[] = [];
  let current: { line: number; parts: string[]; content: number } | null = null;
  let blank = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const item = plain[i] && !THEMATIC_BREAK.test(line) ? LIST_ITEM.exec(line) : null;
    if (item && (!current || indent < current.content)) {
      const content = item[1]!.length + item[2]!.length + Math.max(1, item[3]!.length);
      current = { line: firstLine + i, parts: [item[4]!], content };
      items.push(current);
    } else if (current && (indent >= current.content || !blank)) {
      current.parts.push(line.trim());
    } else {
      current = null; // a paragraph after the list
    }
    blank = false;
  }
  return items.map((item, index) => ({ index, line: item.line, ...tagsOf(item.parts.join(' ')) }));
}

/** Splits `DESIGN.md` into its nine sections and extras, reads the persona and the hard don'ts, and names what is off. */
export function parseLaw(markdown: string): Law {
  const lines = markdown.split(/\r?\n/);
  const plain = unfenced(lines);
  const headings: Heading[] = [];
  lines.forEach((line, index) => {
    const match = plain[index] ? ATX.exec(line) : null;
    if (!match) return;
    const text = (match[2] ?? '').trim();
    const numbered = NUMBERED.exec(text);
    headings.push({ index, level: match[1]!.length, text, number: numbered ? Number(numbered[1]) : null, title: numbered ? (numbered[2] ?? '').trim() : text });
  });

  const problems: LawProblem[] = [];
  const size = new TextEncoder().encode(markdown).length;
  const level = headings.find((h) => h.number !== null && h.number <= 8)?.level;
  // Each section start: a heading at the sections' level (or above) that opens a section or an extra.
  const starts: { heading: Heading; extra: boolean }[] = [];
  if (level !== undefined) {
    const seen = new Set<number>();
    let last = -1;
    let afterEight = false;
    for (const heading of headings) {
      if (heading.level > level) continue;
      const n = heading.number;
      if (n !== null && n <= 8 && !afterEight) {
        if (seen.has(n)) {
          problems.push({ line: heading.index + 1, message: `section ${n} appears twice; the second is kept as an extra section` });
          starts.push({ heading, extra: true });
          continue;
        }
        if (n < last) problems.push({ line: heading.index + 1, message: `section ${n} (${LAW_SECTION_NAMES[n]}) comes after section ${last}; the sections run 0 to 8 in order` });
        seen.add(n);
        last = Math.max(last, n);
        afterEight = n === 8;
        starts.push({ heading, extra: false });
      } else if ((n !== null && n > 8) || afterEight) {
        starts.push({ heading, extra: true });
      }
    }
  }

  const sections: LawSection[] = [];
  const extras: LawSection[] = [];
  starts.forEach(({ heading, extra }, i) => {
    const end = starts[i + 1]?.heading.index ?? lines.length;
    const section: LawSection = {
      number: heading.number,
      title: heading.title,
      heading: lines[heading.index]!.trim(),
      line: heading.index + 1,
      body: lines.slice(heading.index + 1, end).join('\n').trim(),
    };
    (extra ? extras : sections).push(section);
  });

  const found = new Set(sections.map((s) => s.number));
  for (let n = 0; n <= 8; n++) if (!found.has(n)) problems.push({ message: `section ${n} (${LAW_SECTION_NAMES[n]}) is missing` });
  const eight = sections.find((s) => s.number === 8);
  const donts = eight ? dontsOf(eight.body, eight.line + 1 + leadingBlankLines(lines, eight.line)) : [];
  if (eight && donts.length === 0) problems.push({ line: eight.line, message: 'section 8 lists no hard don’ts; each bullet there is one forbidden rule' });
  if (size > LAW_LIMIT_BYTES) problems.push({ message: `the law is ${size} bytes; a law holds at most ${LAW_LIMIT_BYTES}` });

  const preambleEnd = starts[0]?.heading.index ?? lines.length;
  const preambleLines = lines.slice(0, preambleEnd);
  const title = headings.find((h) => h.index < preambleEnd && h.level === 1)?.text ?? null;
  const zero = sections.find((s) => s.number === 0);
  return {
    title,
    persona: zero ? personaOf(zero.body) : null,
    preamble: preambleLines.join('\n').trim(),
    sections,
    extras,
    donts,
    problems,
  };
}

/** How many blank lines follow the heading at 1-based `line` (the body is trimmed, so its first line sits past them). */
function leadingBlankLines(lines: readonly string[], line: number): number {
  let n = 0;
  while (line + n < lines.length && !lines[line + n]!.trim()) n++;
  return n;
}
