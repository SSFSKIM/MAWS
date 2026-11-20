// The table of file frames' tokens (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §C, "Who owns a token"): a token is issued to one page, answers its owner's web contents alone, is released
// by that page or at its end, and closes its source when it goes. Every name here is invented.
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import { FRAME_TOKEN } from '@shared/files/framed';
import { STORE_FRAME_CSP } from '../../services/artifacts/scheme/scheme-handler';
import { copySource, type ByteSource } from './source';
import { createFrameTokens, FRAME_TOKENS_MAX, type FrameFixed } from './tokens';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A source that records its close. */
function source(): ByteSource & { closed: number } {
  const made = {
    closed: 0,
    read: async () => ({ bytes: new Uint8Array(), size: 0, identity: 'one' }),
    close: async () => void made.closed++,
  };
  return made;
}
const fixed = (made: ByteSource = source(), name = 'report.pdf'): FrameFixed => ({ name, framed: 'pdf', mime: 'application/pdf', csp: null, source: made });
const page = (n: number) => endableClientRef(`page:${n}.1`);

describe('issue', () => {
  it('issues a token of the frame’s shape that holds a letter, recorded with its owner and what was fixed', () => {
    const tokens = createFrameTokens();
    const owner = page(1);
    const made = fixed(source(), 'notes.html');
    const issued = tokens.issue(owner, 7, { ...made, framed: 'html', mime: 'text/html', csp: STORE_FRAME_CSP });
    if (typeof issued === 'string') throw new Error(`not issued: ${issued}`);
    expect(FRAME_TOKEN.test(issued.token)).toBe(true);
    expect(issued.token).toMatch(/[a-f]/);
    expect(issued).toMatchObject({ owner, contentsId: 7, name: 'notes.html', framed: 'html', mime: 'text/html', csp: STORE_FRAME_CSP });
    expect(tokens.get(issued.token)).toBe(issued);
    expect(tokens.ownerOf(issued.token)).toBe(7);
  });

  it('a token is drawn again while it holds no letter, or is already held', () => {
    const digits = '01234567890123456789012345678901';
    const a = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const b = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const draws = [digits, a, digits, a, b];
    const tokens = createFrameTokens(() => draws.shift()!);
    const first = tokens.issue(page(1), 1, fixed());
    const second = tokens.issue(page(1), 1, fixed());
    expect(first).toMatchObject({ token: a });
    expect(second).toMatchObject({ token: b });
    expect(draws).toEqual([]);
  });

  it('an issue past the bound fails', () => {
    const tokens = createFrameTokens();
    const owner = page(1);
    for (let n = 0; n < FRAME_TOKENS_MAX; n++) expect(typeof tokens.issue(owner, 1, fixed())).toBe('object');
    const past = source();
    expect(tokens.issue(owner, 1, fixed(past))).toBe('full');
    expect(past.closed).toBe(0); // the caller closes it
    expect(typeof tokens.issue(page(2), 2, fixed())).toBe('object'); // the bound is per page
  });

  it('an issue whose page ended meanwhile records nothing', () => {
    const tokens = createFrameTokens(() => 'cccccccccccccccccccccccccccccccc');
    const owner = page(1);
    owner.end();
    const made = source();
    expect(tokens.issue(owner, 1, fixed(made))).toBe('gone');
    expect(tokens.get('cccccccccccccccccccccccccccccccc')).toBeNull();
    expect(tokens.ownerOf('cccccccccccccccccccccccccccccccc')).toBeNull();
    expect(made.closed).toBe(0); // the caller closes it
  });
});

describe('ownerOf', () => {
  it('answers undefined for a host of no token’s shape, null for a token nobody holds, else the owner’s web contents', () => {
    const tokens = createFrameTokens();
    const issued = tokens.issue(page(1), 9, fixed());
    if (typeof issued === 'string') throw new Error(issued);
    expect(tokens.ownerOf('00000000-0000-4000-8000-000000000001')).toBeUndefined();
    expect(tokens.ownerOf(issued.token.toUpperCase())).toBeUndefined();
    expect(tokens.ownerOf('dddddddddddddddddddddddddddddddd')).toBeNull();
    expect(tokens.ownerOf(issued.token)).toBe(9);
  });
});

describe('release', () => {
  it('a release by its owner ends the token and closes its source', () => {
    const tokens = createFrameTokens();
    const owner = page(1);
    const made = source();
    const issued = tokens.issue(owner, 1, fixed(made));
    if (typeof issued === 'string') throw new Error(issued);
    expect(tokens.release(issued.token, owner)).toBe(true);
    expect(tokens.get(issued.token)).toBeNull();
    expect(tokens.ownerOf(issued.token)).toBeNull();
    expect(made.closed).toBe(1);
    expect(tokens.release(issued.token, owner)).toBe(false);
  });

  it('a release by another page fails and the token still serves', () => {
    const tokens = createFrameTokens();
    const owner = page(1);
    const made = source();
    const issued = tokens.issue(owner, 1, fixed(made));
    if (typeof issued === 'string') throw new Error(issued);
    expect(tokens.release(issued.token, page(2))).toBe(false);
    expect(tokens.release(issued.token, endableClientRef('page:1.2'))).toBe(false); // the same window, reloaded
    expect(tokens.get(issued.token)).toBe(issued);
    expect(tokens.ownerOf(issued.token)).toBe(1);
    expect(made.closed).toBe(0);
  });

  it('a release of an unknown token fails with the same words', () => {
    const tokens = createFrameTokens();
    const owner = page(1);
    const issued = tokens.issue(owner, 1, fixed());
    if (typeof issued === 'string') throw new Error(issued);
    const byAnother = tokens.release(issued.token, page(2));
    const unknown = tokens.release('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', owner);
    expect(unknown).toBe(byAnother);
    expect(unknown).toBe(false);
  });

  it('a page’s end releases every token it owns and closes every copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maws-frame-tokens-'));
    dirs.push(dir);
    await writeFile(join(dir, 'copy'), 'copied bytes');
    const handle = await open(join(dir, 'copy'), 'r');
    const tokens = createFrameTokens();
    const owner = page(1);
    const other = page(2);
    const copy = tokens.issue(owner, 1, fixed(copySource(handle, 12)));
    const local = source();
    const second = tokens.issue(owner, 1, fixed(local));
    const kept = tokens.issue(other, 2, fixed());
    if (typeof copy === 'string' || typeof second === 'string' || typeof kept === 'string') throw new Error('not issued');
    owner.end();
    expect(tokens.get(copy.token)).toBeNull();
    expect(tokens.get(second.token)).toBeNull();
    expect(local.closed).toBe(1);
    await expect.poll(() => handle.fd).toBe(-1); // the copy's descriptor closed: it has no name, so this is its end
    expect(tokens.get(kept.token)).toBe(kept);
    // and the page's place is free again: a new instance of the window issues afresh
    expect(typeof tokens.issue(endableClientRef('page:1.2'), 1, fixed())).toBe('object');
  });

  it('releaseAll releases a page’s tokens, and releaseEverything every token', () => {
    const tokens = createFrameTokens();
    const one = page(1);
    const two = page(2);
    const a = source();
    const b = source();
    const c = source();
    const first = tokens.issue(one, 1, fixed(a));
    const second = tokens.issue(two, 2, fixed(b));
    const third = tokens.issue(two, 2, fixed(c));
    if (typeof first === 'string' || typeof second === 'string' || typeof third === 'string') throw new Error('not issued');
    tokens.releaseAll(one);
    expect(tokens.get(first.token)).toBeNull();
    expect(tokens.get(second.token)).toBe(second);
    tokens.releaseEverything();
    expect(tokens.get(second.token)).toBeNull();
    expect(tokens.get(third.token)).toBeNull();
    expect([a.closed, b.closed, c.closed]).toEqual([1, 1, 1]);
  });
});
