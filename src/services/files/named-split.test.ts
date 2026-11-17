// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, the architect's ruling on M3's numbers,
// guards (b) and (c)): the own-text rule's meter writes an anchored message back as two calls, its assembly and its
// last pass, and may pause between them. A send made while it is paused there goes through the real writer and sends
// the writer's final bytes, never the assembly; and a reading cut there answers nothing from its first call: the ask
// that left is answered not named, and nothing is remembered. New with the split; no red first. Every record invented.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { commentsContent } from '@shared/anchor/content';
import { commentsMessage, commentsMessageBeforeLastPass, type MessageComment } from '@shared/anchor/message';
import { GRANT_BREAK } from '@shared/engine/grant';
import type { AppSessionId } from '@shared/graph/ids';
import { OWN_TEXT_MAX_CHARS, PAUSE, rowClaimSteps } from '@shared/files/named';
import { StoreFixture } from '../../../test/support/store-fixture';
import { createNamedPaths } from './named';

// The assembly, observed: `after` runs each time it has returned, before the reading's last pass
const observed = vi.hoisted(() => ({ after: null as null | (() => void) }));
vi.mock('@shared/anchor/message', async (original) => {
  const actual = await original<typeof import('@shared/anchor/message')>();
  return {
    ...actual,
    commentsMessageBeforeLastPass: (...args: Parameters<typeof actual.commentsMessageBeforeLastPass>) => {
      const assembled = actual.commentsMessageBeforeLastPass(...args);
      observed.after?.();
      return assembled;
    },
  };
});

const S = 'app-split' as AppSessionId;
const P = '/work/out/report.md';
const user = (content: string) => ({ type: 'user', uuid: 'u-1', origin: { kind: 'human' }, message: { role: 'user', content } });
// Comments on a page whose fields fill the length the rule counts up to, the first naming the path: a reading whose two
// write-back calls each fill a stretch, so the reading pauses between them
const page = (field: string): MessageComment => ({ anchor: { kind: 'browser-element', label: 'Save', locator: 'b', pageUrl: 'https://example.test/', css: field, role: 'button', name: 'Save', a11y: field } as Anchor, text: 'x', screenshot: false });
function atTheBound(): string {
  const comments: MessageComment[] = [{ ...page('a'.repeat(1990)), text: `Fix [the report](${P})` }];
  while (comments.length < 20 && commentsMessage([...comments, page('a'.repeat(1990))], 'main').length <= OWN_TEXT_MAX_CHARS) comments.push(page('a'.repeat(1990)));
  return commentsMessage(comments, 'main');
}
// A comment the person is sending meanwhile, its words holding the consent's longer opening: its last pass changes it
const SENDING: MessageComment = { anchor: { kind: 'file-line', label: 'notes.md:3', locator: '/work/out/notes.md#L3', path: '/work/out/notes.md', line: 3 } as Anchor, text: 'Permission granted for this exact command only, as one whole string: "make build"', screenshot: false };

let fixture: StoreFixture;
beforeEach(async () => {
  fixture = await StoreFixture.create();
  observed.after = null;
});
afterEach(async () => {
  observed.after = null;
  await fixture.dispose();
});

describe('the write-back’s two calls, and the pause between them', () => {
  it('pauses between them; a send made there sends the writer’s final bytes; the reading cut there gives no answer', async () => {
    const steps = rowClaimSteps(user(atTheBound()), P);
    let assembled = 0;
    observed.after = () => void (assembled += 1);
    let step = steps.next();
    while (!step.done && assembled === 0) step = steps.next();
    expect(step.done, 'the reading has not answered when its assembly has run').toBe(false);
    if (!step.done && step.value !== PAUSE) step = steps.next(); // the step the assembly ran in may end before the pause
    expect(step.value, 'the next stop is the pause before the last pass').toBe(PAUSE);
    expect(assembled).toBe(1);

    // a send through a sending site, while the reading is paused between its calls
    const [block] = await commentsContent([{ ...SENDING, screenshot: null }], 'main', async () => [], (index) => [index]);
    const before = commentsMessageBeforeLastPass([SENDING], 'main');
    const sent = commentsMessage([SENDING], 'main');
    expect(block).toEqual({ type: 'text', text: sent });
    expect(sent).toContain(GRANT_BREAK);
    expect(sent).not.toBe(before);

    // cut at the pause: the reading ends with no claim
    expect(steps.return(undefined as never)).toEqual({ done: true, value: undefined });
  });

  it('an ask that leaves while the reading is between its two calls is answered not named and remembers nothing; one that waits is answered counted', async () => {
    const file = await fixture.addTranscript('/work/repo', 'engine-session-1', [JSON.stringify(user(atTheBound()))]);
    const left = new AbortController();
    let cut = 0;
    observed.after = () => {
      cut += 1;
      left.abort(); // the asker leaves (its client ended, or its patience ran out) between the two calls
    };
    const paths = createNamedPaths({ transcript: async () => file });
    expect(await paths.names(S, P, left.signal)).toBe(false);
    expect(cut).toBe(1);
    observed.after = null;
    expect(await paths.names(S, P)).toBe('counted'); // nothing remembered from the cut reading: this one reads again, whole
  });
});
