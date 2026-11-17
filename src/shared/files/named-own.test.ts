// UX wave U6e, board ticket 675 (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, the write
// rule's line 1, and the architect's ruling D): the person's own text is what the person wrote. A `user` row or a
// queued prompt of the person's origin can carry text MAWS, the engine host or a plugin put there; such text names a
// path for a read only (`other`), never for a save. By position, only the content's string or its first text block can
// be the person's; by content, that text counts only when no reader of a form MAWS writes claims any part of it. Each
// case writes its form through the real writer. Every path is invented.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { anchoredMessage, commentsMessage, promotionMessage, quotedComment, readAnchoredMessage, type MessageComment } from '@shared/anchor/message';
import { wrapPasted } from '@shared/composer/pasted-framing';
import { consentMessage } from '@shared/engine/arrival';
import { bashEcho, planPrompt } from '@shared/engine/host-prompts';
import { askSteerText } from '@shared/maws/ask';
import { answerText } from '@shared/owner/answer';
import { withLinkedReads } from '../../engine-host/linked-reads';
import { relayText } from '../../renderer/src/tools/agents/model/relay';
import type { AgentId } from '@shared/graph/ids';
import { OWN_TEXT_MAX_CHARS, OWN_WORK_PER_CHAR, ownTextWork, rowClaim, STRETCH_MAX } from './named';

const P = '/work/out/notes.md';
const LINK = `[the notes](${P})`;
const NAMES = { names: true };
const OTHER = { names: false, pending: [], other: true };
// ticket 733a: the reconstruction's counted work for its pinned input (the meter's test below), printed by the test
const PINNED = { length: 29_296, work: 1_486_245, pauses: 15 }; // 15 since the write-back's two calls: a pause falls between them
const text = (value: string) => ({ type: 'text', text: value });
// A `user` row and a queued prompt of the person's origin, as the engine writes them (test/fixtures/transcripts/)
const user = (content: string | object[]) => ({ type: 'user', uuid: 'u1', origin: { kind: 'human' }, message: { role: 'user', content } });
const queued = (prompt: string | object[]) => ({ type: 'attachment', uuid: 'q1', attachment: { type: 'queued_command', prompt, source_uuid: 's1', commandMode: 'prompt', origin: { kind: 'human' } } });
const both = (content: string | object[]) => [rowClaim(user(content), P), rowClaim(queued(content), P)];

// The recorded linked read (spikes/protocol-probe/fixtures/p4/p4-a3-linked-read.jsonl): the probe's `sent` row holds the
// person's words and the artifact_read answer the host attached
const FIXTURE = fileURLToPath(new URL('../../../spikes/protocol-probe/fixtures/p4/p4-a3-linked-read.jsonl', import.meta.url));
const sent = readFileSync(FIXTURE, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { frame: Record<string, unknown> }).frame).find((frame) => frame.event === 'sent') as { words: string; read: string };
// The artifact's read with a link to an outside path in its content: text the agent can write
const readLinking = (() => {
  const read = JSON.parse(sent.read) as { markdown: string };
  return JSON.stringify({ ...read, markdown: `${read.markdown}\nSee ${LINK} for the schedule. ^n0tes001\n` }, null, 2);
})();
const attached = async (words: string) => (await withLinkedReads(words, async (_link, admit) => admit(readLinking), 'ab12')).content;

describe('the person’s own text: the linked read (the finding)', () => {
  it('the host attaches the read after the person’s words, as recorded', async () => {
    const content = (await attached(sent.words)) as { type: string; text: string }[];
    expect(content.map((block) => block.type)).toEqual(['text', 'text']);
    expect(content[0]!.text).toBe(sent.words);
    expect(content[1]!.text).toContain(LINK);
  });

  it('a path only the attached read links names it for a read only, as a user row and as a queued prompt', async () => {
    expect(both(await attached(sent.words))).toEqual([OTHER, OTHER]);
  });

  it('the person’s own words linking the same path in the same message still name it', async () => {
    expect(both(await attached(`${sent.words} The dates are in ${LINK}.`))).toEqual([NAMES, NAMES]);
  });
});

describe('the person’s own text: what the engine host composes as the person’s', () => {
  it('the plan handed back after a clear names it for a read only', () => {
    expect(both(planPrompt(`1. Update the schedule in ${LINK}`, 'ab12'))).toEqual([OTHER, OTHER]);
  });

  it('the bash echo fails whole: a link in the output, and one in the typed command', () => {
    expect(both(bashEcho('cat notes.md', `<bash-stdout>See ${LINK}</bash-stdout><bash-stderr></bash-stderr>`, 'ab12'))).toEqual([OTHER, OTHER]);
    expect(both(bashEcho(`echo ${LINK}`, '<bash-stdout></bash-stdout><bash-stderr></bash-stderr>', 'ab12'))).toEqual([OTHER, OTHER]);
  });
});

describe('the person’s own text: what the window composes around a model’s words', () => {
  it('an owner question’s answer line, a picked option or a typed reply', () => {
    expect(both(answerText('Which file holds the schedule?', LINK))).toEqual([OTHER, OTHER]);
    expect(both(answerText(`Is it ${LINK}?`, 'yes'))).toEqual([OTHER, OTHER]);
  });

  it('a side question promoted to a thread: the model’s answer in it', () => {
    expect(both(promotionMessage([{ question: 'Where is the schedule?', response: `In ${LINK}.` }], 'Go on.', 'ab12'))).toEqual([OTHER, OTHER]);
  });

  it('a relay to an agent or a peer: the whole instruction, the person’s words in it included', () => {
    const agent = relayText({ agentId: 'a1b2c3' as AgentId, name: null }, `Read ${LINK}`);
    const peer = relayText({ kind: 'peer', address: 'session:7ef6ac00', name: null, mode: 'message' }, `Read ${LINK}`)!;
    expect([...both(agent), ...both(peer)]).toEqual([OTHER, OTHER, OTHER, OTHER]);
  });
});

describe('the person’s own text: joined messages fail closed whole', () => {
  const envelope = (value: string) => askSteerText('toolu_j', [{ question: 'Which file?', header: 'File', modality: 'text' }], [{ id: 'q1', question: 'Which file?', status: 'answered', value }]);
  // An earlier build's envelope (test/fixtures/transcripts/p1-maws-ask-async.jsonl line 42), its question's words inline,
  // one run of them replaced by a link
  const earlier = (() => {
    const row = readFileSync(fileURLToPath(new URL('../../../test/fixtures/transcripts/p1-maws-ask-async.jsonl', import.meta.url)), 'utf8').split('\n')[41]!;
    const words = (JSON.parse(row) as { message: { content: string } }).message.content;
    expect(words).toContain('1. Proceed? — Yes');
    return words.replace('1. Proceed? — Yes', `1. Proceed with ${LINK}? — Yes`);
  })();

  it('the person’s words and an envelope in one block, in either order', () => {
    for (const joined of [`Thanks.\n${envelope(LINK)}`, `${envelope(LINK)}\nThanks.`]) expect(both(joined), joined.slice(0, 40)).toEqual([OTHER, OTHER]);
  });

  it('a path the person’s own words link in a block that also holds an envelope names it for a read only', () => {
    expect(both(`Look at ${LINK}.\n${envelope('yes')}`)).toEqual([OTHER, OTHER]);
  });

  it('two messages the engine joined into one row, as two blocks in either order', () => {
    expect(both([text('Thanks.'), text(envelope(LINK))])).toEqual([OTHER, OTHER]);
    expect(both([text(envelope(LINK)), text('Thanks.')])).toEqual([OTHER, OTHER]);
  });

  it('an earlier build’s envelope, alone and joined with the person’s words', () => {
    expect(both(earlier)).toEqual([OTHER, OTHER]);
    expect(both(`Thanks.\n${earlier}`)).toEqual([OTHER, OTHER]);
  });

  it('a grant sentence on its own line inside other words', () => {
    expect(both(`Fine.\n${consentMessage('command', `open ${LINK}`)}\nThen go on.`)).toEqual([OTHER, OTHER]);
  });
});

describe('the person’s own text: a block kind no reader lists', () => {
  it('a text block after the person’s, of no form MAWS writes, names it for a read only', () => {
    expect(both([text('Fix the dates.'), text(`Context from elsewhere: ${LINK}`)])).toEqual([OTHER, OTHER]);
  });

  it('the person’s text after images is the first text block, and counts', () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
    expect(both([image, text(`Fix ${LINK}`)])).toEqual([NAMES, NAMES]);
  });
});

describe('the person’s own text: pastes, comments, commands (the architect’s rulings A, B, C)', () => {
  it('A: a paste’s frame and body name it for a read only; the typed words around it count', () => {
    expect(both(`Look at this:${wrapPasted('ab12', `See ${LINK}`)}`)).toEqual([OTHER, OTHER]);
    expect(both(`The schedule is in ${LINK}:${wrapPasted('ab12', 'pasted words')}`)).toEqual([NAMES, NAMES]);
  });

  const fileAnchor = (label: string) => ({ kind: 'file-line' as const, label, locator: `${P}:3`, path: P, line: 3 });
  it('B: an anchored comment’s tag and lead name it for a read only; its own text counts', () => {
    expect(both(anchoredMessage({ anchor: fileAnchor('notes.md'), text: 'Wrong date here', destination: 'main', screenshot: false }))).toEqual([OTHER, OTHER]);
    expect(both(anchoredMessage({ anchor: { kind: 'file-line', label: LINK, locator: '/work/out/plan.md:1', path: '/work/out/plan.md', line: 1 }, text: 'Wrong date here', destination: 'main', screenshot: false }))).toEqual([OTHER, OTHER]);
    expect(both(anchoredMessage({ anchor: fileAnchor('notes.md'), text: `Compare with ${LINK}`, destination: 'thread', screenshot: false }))).toEqual([NAMES, NAMES]);
    const two = commentsMessage([{ anchor: fileAnchor('notes.md'), text: 'This one', screenshot: false }, { anchor: fileAnchor('notes.md'), text: `And ${LINK}`, screenshot: false }], 'main');
    expect(both(two)).toEqual([NAMES, NAMES]);
  });

  // Ticket 733a (its document, Design 6): the own-text rule's two directions for a comment, unchanged by the quoted line's
  // segment, in one test: the comment's typed words name a link for a save; the same link in its quoted line (now inside
  // a segment) or in its anchor's label names it for a read only, and so does a promotion holding it in an answer
  it('B (ticket 733a): a comment’s typed words name a save; its quoted line, its label and a promotion’s answer a read only', () => {
    const anchor = fileAnchor('notes.md');
    const words = (quote: string | null, text: string) => quotedComment(anchor, quote, text, 'ab12');
    for (const destination of ['main', 'thread'] as const) {
      expect(both(commentsMessage([{ anchor, text: words('const total = rows.length;', `Compare with ${LINK}`), screenshot: false }], destination)), destination).toEqual([NAMES, NAMES]);
      expect(both(commentsMessage([{ anchor, text: words(`See ${LINK}`, 'Wrong date here'), screenshot: false }], destination)), destination).toEqual([OTHER, OTHER]);
      expect(both(commentsMessage([{ anchor: { ...anchor, label: LINK }, text: words('const total = rows.length;', 'Wrong date here'), screenshot: false }], destination)), destination).toEqual([OTHER, OTHER]);
    }
    expect(both(promotionMessage([{ question: 'Where is the schedule?', response: `In ${LINK}.` }], 'Go on.', 'ab12'))).toEqual([OTHER, OTHER]);
  });

  it('C: a typed slash command’s arguments, typed or as the engine records them, name it for a read only', () => {
    expect(both(`/compact keep ${LINK}`)).toEqual([OTHER, OTHER]);
    expect(both(`<command-message>notes</command-message>\n<command-name>/notes</command-name>\n<command-args>${LINK}</command-args>`)).toEqual([OTHER, OTHER]);
  });

  it('C: a message that opens with a path is no command', () => {
    expect(both(`/work/out/notes.md has the wrong dates, see ${LINK}`)).toEqual([NAMES, NAMES]);
  });
});

// The closing wave's item 2: an anchored message counts only as a whole reading, one the writer gives back byte for
// byte; text before it, or a second message joined to it, leaves the lead (the label, the locator, the passage, which
// a page or an artifact controls) inside what a partial reading would take for the comment's words
describe('the person’s own text: an anchored message counts only when read whole', () => {
  const linkedLabel = { kind: 'file-line' as const, label: LINK, locator: '/work/out/plan.md:1', path: '/work/out/plan.md', line: 1 };
  const plain = { kind: 'file-line' as const, label: 'plan.md', locator: '/work/out/plan.md:2', path: '/work/out/plan.md', line: 2 };
  const one = (anchor: typeof plain) => anchoredMessage({ anchor, text: 'Wrong date here', destination: 'main', screenshot: false });
  it.each([
    ['other words, then an anchored message', () => `Look at this.\n${one(linkedLabel)}`],
    ['two anchored messages joined by a newline', () => `${one(linkedLabel)}\n${one(plain)}`],
    ['other words, then a framed message of several comments', () => `Look.\n${commentsMessage([{ anchor: linkedLabel, text: 'This', screenshot: false }, { anchor: plain, text: 'That', screenshot: false }], 'main')}`],
    ['a newline before an anchored message', () => `\n${one(linkedLabel)}`],
    ['a space before an anchored message', () => ` ${one(linkedLabel)}`],
    // the same anchor's message twice reads as led and writes back to the byte: the first's tag and the second's lead
    // fall inside the comment's words
    ['the same anchor’s message joined to itself by a newline', () => `${one(linkedLabel)}\n${one(linkedLabel)}`],
    ['the same anchor’s message joined to itself by a blank line', () => `${one(linkedLabel)}\n\n${one(linkedLabel)}`],
  ])('a link only in the lead names it for a read only: %s', (_, text) => {
    expect(both(text())).toEqual([OTHER, OTHER]);
  });

  it('the same messages whole still count the comments’ own words', () => {
    expect(both(anchoredMessage({ anchor: plain, text: `Compare ${LINK}`, destination: 'main', screenshot: false }))).toEqual([NAMES, NAMES]);
    expect(both(commentsMessage([{ anchor: plain, text: `Compare ${LINK}`, screenshot: true }, { anchor: linkedLabel, text: 'That', screenshot: false }], 'thread'))).toEqual([NAMES, NAMES]);
  });
});

// Decision Log 24's meter, the closing wave's item 3: every reader of the person's own text is linear by construction and
// charged for the work it does; a pause can fall inside a long text; a text over OWN_TEXT_MAX_CHARS does not count for
// a save at all; and the work past the own pass's budget fails closed
describe('the person’s own text: the readers’ work is metered and bounded', () => {
  const near = (filler: string, head = `Fix ${LINK} `) => head + filler.repeat(Math.floor((OWN_TEXT_MAX_CHARS - head.length) / filler.length));

  it('a text at the length bound counts; one character past it names the path for a read only', () => {
    const at = `${LINK} ${'a'.repeat(OWN_TEXT_MAX_CHARS - LINK.length - 1)}`;
    expect(at.length).toBe(OWN_TEXT_MAX_CHARS);
    expect(both(at)).toEqual([NAMES, NAMES]);
    expect(both(`${at}a`)).toEqual([OTHER, OTHER]);
    expect(ownTextWork(`${at}a`).refused).toBe('length');
  });

  // the architect's ruling on NFKC: the bound holds for the folded text too, decided before any reader that folds runs
  const WIDE = '\uFDFA'; // one character that compatibility folding makes many
  const WIDE_FOLD = WIDE.normalize('NFKC').length;
  it('a text whose compatibility fold passes the bound names the path for a read only, refused for length', () => {
    const wide = `${LINK} ${WIDE.repeat(OWN_TEXT_MAX_CHARS - LINK.length - 1)}`;
    expect(wide.length).toBe(OWN_TEXT_MAX_CHARS);
    expect(WIDE_FOLD).toBeGreaterThan(1);
    expect(both(wide)).toEqual([OTHER, OTHER]);
    expect(ownTextWork(wide).refused).toBe('length');
  });

  it('a text just within the bound after folding counts, its work within one stretch', () => {
    const head = `${LINK} `;
    const count = Math.floor((OWN_TEXT_MAX_CHARS - head.length) / WIDE_FOLD);
    const under = `${head}${WIDE.repeat(count)}${'a'.repeat(OWN_TEXT_MAX_CHARS - head.length - count * WIDE_FOLD)}`;
    expect(under.normalize('NFKC').length).toBe(OWN_TEXT_MAX_CHARS);
    expect(both(under)).toEqual([NAMES, NAMES]);
    const read = ownTextWork(under);
    expect(read.refused).toBeNull();
    expect(read.longest).toBeLessThanOrEqual(STRETCH_MAX);
    expect(read.work).toBeLessThanOrEqual(OWN_WORK_PER_CHAR * OWN_TEXT_MAX_CHARS); // the budget follows the folded length
  });

  it('the over-budget branch runs and fails closed', () => {
    expect(ownTextWork(`Fix ${LINK}`)).toMatchObject({ texts: [`Fix ${LINK}`], refused: null });
    expect(ownTextWork(`Fix ${LINK}`, 1)).toMatchObject({ texts: [], refused: 'budget' });
  });

  it.each([
    ['unclosed paste openers', () => near('<pasted_content id="ab12">\n')],
    ['many < with no >', () => near('<')],
    ['alternating < and >', () => near('<>')],
    ['plain words', () => near('word ')],
    ['many answer-shaped lines', () => near('Answering "x\n')],
    ['many anchor-tag openings', () => near('\n<maws_anchor kind="x"')],
    // ticket 733a: the characters the grant's test costs most on, which case mapping lengthens
    ['a capital I with a dot above', () => near('\u0130')],
    ['a sharp s', () => near('\u00df')],
    ['an iota with dialytika and tonos', () => near('\u0390')],
  ])('linear work, bounded between pauses, with a pause inside the text: %s', (_, shape) => {
    const textOf = shape();
    expect(textOf.length).toBeLessThanOrEqual(OWN_TEXT_MAX_CHARS);
    const read = ownTextWork(textOf);
    expect(read.refused).not.toBe('budget');
    expect(read.work).toBeLessThanOrEqual(OWN_WORK_PER_CHAR * textOf.length);
    expect(read.longest).toBeLessThanOrEqual(STRETCH_MAX);
    expect(read.pauses).toBeGreaterThanOrEqual(2);
  });

  // ticket 733a: the costliest text counted, an anchored comment at the length bound in the character the grant's test
  // costs most on; it counts, within the budget and one stretch between pauses
  it('an anchored comment at the length bound, in a capital I with a dot above, counts within the budget', () => {
    const anchor = { kind: 'file-line' as const, label: 'notes.md', locator: `${P}:3`, path: P, line: 3 };
    const words = near('\u0130', `Compare ${LINK} `).slice(0, OWN_TEXT_MAX_CHARS - 200);
    const textOf = anchoredMessage({ anchor, text: words, destination: 'main', screenshot: false });
    expect(textOf.length).toBeLessThanOrEqual(OWN_TEXT_MAX_CHARS);
    const read = ownTextWork(textOf);
    expect(read.refused).toBeNull();
    expect(read.texts).toHaveLength(1);
    expect(read.work).toBeLessThanOrEqual(OWN_WORK_PER_CHAR * textOf.length);
    expect(read.longest).toBeLessThanOrEqual(STRETCH_MAX);
  });

  // Ticket 733a (its document, Design 1, "The own-text rule's meter"; acceptance 11): the reconstruction writes the read
  // comments back with their writer, which slots each anchor's fields and passes the whole through the writer's last
  // step; the meter charges it what the writer counts, beside the read's fixed 16 a character. Long comments on a page
  // whose selector and accessible path fill the text: the counted work and the pauses pinned, within one stretch.
  const page = (field: string): MessageComment => ({ anchor: { kind: 'browser-element', label: 'Save', locator: 'b', pageUrl: 'https://example.test/', css: field, role: 'button', name: 'Save', a11y: field }, text: 'x', screenshot: false });
  const fieldsAt = (ch: string, length: number) => {
    const comments: MessageComment[] = [{ ...page(ch.repeat(1990)), text: `Fix ${LINK}` }];
    while (comments.length < 20 && commentsMessage([...comments, page(ch.repeat(1990))], 'main').length <= length) comments.push(page(ch.repeat(1990)));
    return commentsMessage(comments, 'main');
  };
  it('the reconstruction is charged what the writer counts: long comments on a page’s fields, their work and pauses pinned', () => {
    const textOf = fieldsAt('a', 30_000);
    expect(textOf.length).toBe(PINNED.length);
    const written = { steps: 0 };
    const read = readAnchoredMessage(textOf)!;
    expect(commentsMessage(read.comments, read.destination!, written)).toBe(textOf);
    const meter = ownTextWork(textOf);
    expect(meter).toMatchObject({ refused: null, work: PINNED.work, pauses: PINNED.pauses });
    expect(meter.texts).toHaveLength(read.comments.length);
    expect(meter.longest).toBeLessThanOrEqual(STRETCH_MAX);
    // the read's 16 a character and the writer's own count are both in the meter's
    expect(meter.work).toBeGreaterThan(16 * textOf.length + written.steps);
    expect(written.steps).toBeGreaterThan(8 * textOf.length); // the fixed charge it replaces fell short
  });

  it('the costliest text counted, comments on a page’s fields in a capital I with a dot above at the length bound, counts within the budget and one stretch', () => {
    const textOf = fieldsAt('\u0130', OWN_TEXT_MAX_CHARS);
    expect(textOf.length).toBeGreaterThan(OWN_TEXT_MAX_CHARS - 4000);
    const read = ownTextWork(textOf);
    expect(read.refused).toBeNull();
    expect(read.texts.length).toBeGreaterThan(1);
    expect(read.work).toBeLessThanOrEqual(OWN_WORK_PER_CHAR * textOf.length);
    expect(read.longest).toBeLessThanOrEqual(STRETCH_MAX);
    expect(both(textOf)).toEqual([NAMES, NAMES]);
  });

  // Ticket 733a (the architect's ruling on M3's numbers): the write-back runs as two calls, its assembly and its last
  // pass, so the length a text counts up to stays 65,536 characters and no call of the reading, the write-back's two
  // among them, passes one stretch at that length, on the characters that cost each part most and on ASCII
  it.each([
    ['U+1FB7 (the last pass’s costliest)', '\u1FB7'],
    ['U+0130 (the fields’ test’s costliest)', '\u0130'],
    ['ASCII', 'a'],
  ])('no single call of the reading passes STRETCH_MAX at the length bound: comments on a page’s fields in %s', (_, ch) => {
    expect(OWN_TEXT_MAX_CHARS).toBe(65_536);
    const textOf = fieldsAt(ch, OWN_TEXT_MAX_CHARS);
    expect(textOf.length).toBeGreaterThan(OWN_TEXT_MAX_CHARS - 4000);
    const read = ownTextWork(textOf);
    expect(read.refused).toBeNull();
    expect(read.longest).toBeLessThanOrEqual(STRETCH_MAX); // the most work between two pauses bounds every call
    expect(read.work).toBeLessThanOrEqual(OWN_WORK_PER_CHAR * textOf.length);
  });

  it('a paste opener with no closer makes the text not count', () => {
    expect(both(`Fix ${LINK}\n\n<pasted_content id="ab12">\nnever closed`)).toEqual([OTHER, OTHER]);
  });
});
