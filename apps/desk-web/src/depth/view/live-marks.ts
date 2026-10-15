// A streaming answer's to-human marks (`<message>`, and the old `<to-human>`, `<essential>`, `<need-input>`,
// `<insight>` read as it), drawn as MAWS draws a settled row's. MAWS's row hands its text to the to-human Presenter
// through the grammar's strict `parse`, where a mark still open is unbalanced and its tag literal; the grammar's
// `parseLive` reads it open, but only a stored row's path reaches the Presenter. So the column hands the row the text
// a stored row of the same words would be once its marks close: a tag still arriving dropped (as `parseLive` drops
// one, and `<message>`'s too, which its list predates), a fence still open closed, and each mark still open closed
// after it. The result is checked against `parseLive` — the same marks in the same order — and a text where they
// differ (a reading this does not reproduce) is drawn as it was written. Tags in code stay literal, as the grammar has
// them.
import { codeRegions, insideCode, parse, parseLive } from '@shared/owner/to-human-parser';

const MARK = /<(\/?)(message|to-human|essential|need-input|insight)>/g;
// The grammar's streaming tags (`parseLive`): a text ending in a prefix of one of these has a tag still arriving.
const STREAMING_TAGS = ['message', 'to-human', 'essential', 'need-input', 'insight', 'choice'].flatMap((name) => [`<${name}>`, `</${name}>`]).concat('<choice recommended>');

const kinds = (parts: ReturnType<typeof parse>) => parts.map((part) => part.kind).join(' ');

export function liveMarkdown(text: string): string {
  const tail = text.lastIndexOf('<');
  const suffix = tail === -1 ? '' : text.slice(tail);
  const arriving = suffix !== '' && STREAMING_TAGS.some((tag) => tag.length > suffix.length && tag.startsWith(suffix)) && !insideCode(codeRegions(text))(tail);
  const body = arriving ? text.slice(0, tail) : text;

  const regions = codeRegions(body);
  const inCode = insideCode(regions);
  const open: string[] = [];
  for (const token of body.matchAll(MARK)) {
    if (inCode(token.index)) continue;
    if (!token[1]) open.push(token[2]);
    else if (open.at(-1) === token[2]) open.pop();
    else open.length = 0; // crossing marks are unbalanced, as the grammar reads them
  }
  if (open.length === 0) return body;

  // A fence still open runs to the end of the text, and a closing tag inside it would be code: close the fence first.
  const fence = openFence(body, regions.at(-1));
  const closed = `${body}${fence ? `\n${fence}` : ''}\n${open.reverse().map((name) => `</${name}>`).join('')}`;
  return kinds(parse(closed)) === kinds(parseLive(text)) ? closed : body;
}

/**
 * The fence run of a fenced block still open at the end of the text, or null. A code region reaching the end may also
 * be a fence closed on the text's last line, or an inline span: neither is open.
 */
function openFence(text: string, region: readonly [number, number] | undefined): string | null {
  if (region === undefined || region[1] !== text.length) return null;
  const [first, ...rest] = text.slice(region[0]).split('\n');
  const opening = /^(`{3,}|~{3,})(.*)$/.exec(first);
  if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) return null; // an inline span, not a fence
  const run = opening[1];
  const closing = new RegExp(`^[ \\t]*\\${run[0]}{${run.length},}[ \\t]*$`);
  return rest.some((line) => closing.test(line)) ? null : run;
}
