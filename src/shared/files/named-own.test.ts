// UX wave U6e, board ticket 675 (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, the write
// rule's line 1, and the architect's ruling D): the person's own text is what the person wrote. A `user` row or a
// queued prompt of the person's origin can carry text MAWS, the engine host or a plugin put there; such text names a
// path for a read only (`other`), never for a save. By position, only the content's string or its first text block can
// be the person's; by content, that text counts only when no reader of a form MAWS writes claims any part of it. Each
// case writes its form through the real writer. Every path is invented.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { anchoredMessage, commentsMessage, promotionMessage } from '@shared/anchor/message';
import { wrapPasted } from '@shared/composer/pasted-framing';
import { consentMessage } from '@shared/engine/arrival';
import { bashEcho, planPrompt } from '@shared/engine/host-prompts';
import { askSteerText } from '@shared/maws/ask';
import { answerText } from '@shared/owner/answer';
import { withLinkedReads } from '../../engine-host/linked-reads';
import { relayText } from '../../renderer/src/tools/agents/model/relay';
import type { AgentId } from '@shared/graph/ids';
import { OWN_TEXT_PASSES, PAUSE, rowClaim, rowClaimSteps } from './named';

const P = '/work/out/notes.md';
const LINK = `[the notes](${P})`;
const NAMES = { names: true };
const OTHER = { names: false, pending: [], other: true };
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
const attached = async (words: string) => (await withLinkedReads(words, async (_link, admit) => admit(readLinking))).content;

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
    expect(both(planPrompt(`1. Update the schedule in ${LINK}`))).toEqual([OTHER, OTHER]);
  });

  it('the bash echo fails whole: a link in the output, and one in the typed command', () => {
    expect(both(bashEcho('cat notes.md', `<bash-stdout>See ${LINK}</bash-stdout><bash-stderr></bash-stderr>`))).toEqual([OTHER, OTHER]);
    expect(both(bashEcho(`echo ${LINK}`, '<bash-stdout></bash-stdout><bash-stderr></bash-stderr>'))).toEqual([OTHER, OTHER]);
  });
});

describe('the person’s own text: what the window composes around a model’s words', () => {
  it('an owner question’s answer line, a picked option or a typed reply', () => {
    expect(both(answerText('Which file holds the schedule?', LINK))).toEqual([OTHER, OTHER]);
    expect(both(answerText(`Is it ${LINK}?`, 'yes'))).toEqual([OTHER, OTHER]);
  });

  it('a side question promoted to a thread: the model’s answer in it', () => {
    expect(both(promotionMessage([{ question: 'Where is the schedule?', response: `In ${LINK}.` }], 'Go on.'))).toEqual([OTHER, OTHER]);
  });

  it('a relay to an agent or a peer: the whole instruction, the person’s words in it included', () => {
    const agent = relayText({ agentId: 'a1b2c3' as AgentId, name: null }, `Read ${LINK}`);
    const peer = relayText({ kind: 'peer', address: 'session:7ef6ac00', name: null, mode: 'message' }, `Read ${LINK}`);
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

  it('C: a typed slash command’s arguments, typed or as the engine records them, name it for a read only', () => {
    expect(both(`/compact keep ${LINK}`)).toEqual([OTHER, OTHER]);
    expect(both(`<command-message>notes</command-message>\n<command-name>/notes</command-name>\n<command-args>${LINK}</command-args>`)).toEqual([OTHER, OTHER]);
  });

  it('C: a message that opens with a path is no command', () => {
    expect(both(`/work/out/notes.md has the wrong dates, see ${LINK}`)).toEqual([NAMES, NAMES]);
  });
});

// Decision Log 24's meter: the readers of the person's own text are charged against it, one pass each, with a step
// between passes at which the daemon's search can give the event loop back
describe('the person’s own text: the readers’ cost is metered', () => {
  it('a long own text pauses once more for each reader pass than the link scan alone', () => {
    const long = `${'word '.repeat(200_000)}${LINK}`;
    const pauses = (row: unknown) => [...rowClaimSteps(row, P)].filter((step) => step === PAUSE).length;
    const scanOnly = pauses({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [text(long)] } });
    expect(rowClaim(user(long), P)).toEqual(NAMES);
    expect(OWN_TEXT_PASSES).toBeGreaterThan(0);
    expect(pauses(user(long)) - 2 * scanOnly).toBeGreaterThanOrEqual(OWN_TEXT_PASSES);
  });
});
