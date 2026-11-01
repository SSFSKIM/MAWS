// A remote session's `files.read` in answers the channel carries (P5 O7 M4, the milestone review): one call when it
// fits; else ranged reads from the offset asked, a page refused `too-large` halved, assembled into one answer; with the
// hash, pages that disagree on it read again.
import { describe, expect, it } from 'vitest';
import { FakeLink } from '../../../test/lane-b/fake-link';
import { readFileInPages, REMOTE_READ_PAGE_BYTES, REMOTE_READ_TRIES } from './remote-files-read';

const APP = 'app-1';

/** A machine holding `file`, answering files.read as the files service does; `too-large` past `max` JSON bytes. */
function machine(file: () => string, max: number, hashOf: () => string | null = () => null) {
  const link = new FakeLink();
  const asked: Array<{ offset?: number; length?: number }> = [];
  link.answers.set('files.read', (input) => {
    asked.push({ offset: input.offset as number | undefined, length: input.length as number | undefined });
    const text = file();
    const offset = (input.offset as number | undefined) ?? 0;
    const content = text.slice(offset, offset + ((input.length as number | undefined) ?? 1024 * 1024));
    const output = { encoding: 'utf8', content, bytes: text.length, offset, length: content.length, truncated: offset + content.length < text.length, mime: 'text/plain', hash: input.hash === true ? hashOf() : null, utf8: input.hash === true ? true : null };
    if (JSON.stringify(output).length > max) return { ok: false, error: { code: 'too-large' } };
    return { ok: true, output };
  });
  return { link, asked };
}

describe('readFileInPages', () => {
  it('answers with one call when it fits', async () => {
    const { link, asked } = machine(() => 'hello', 4096);
    expect(await readFileInPages(link, { appSessionId: APP, path: '/r/a.txt' }, () => {})).toMatchObject({ ok: true, value: { content: 'hello', length: 5, truncated: false } });
    expect(asked).toHaveLength(1);
  });

  it('reads past a refused whole in ranged pages, halving a page that is still refused, and assembles the range asked', async () => {
    const text = '"'.repeat(3 * REMOTE_READ_PAGE_BYTES); // each quote escapes to two bytes: a full page doesn't fit
    const { link, asked } = machine(() => text, REMOTE_READ_PAGE_BYTES + 1024);
    const read = await readFileInPages(link, { appSessionId: APP, path: '/r/q.txt', offset: 10, length: 2 * REMOTE_READ_PAGE_BYTES }, () => {});
    expect(read).toMatchObject({ ok: true, value: { offset: 10, length: 2 * REMOTE_READ_PAGE_BYTES, truncated: true, bytes: text.length } });
    expect((read as { value: { content: string } }).value.content).toBe(text.slice(10, 10 + 2 * REMOTE_READ_PAGE_BYTES));
    expect(asked[1]).toEqual({ offset: 10, length: REMOTE_READ_PAGE_BYTES }); // the first page, refused: halved
    expect(asked[2]).toEqual({ offset: 10, length: REMOTE_READ_PAGE_BYTES / 2 });
  });

  it('reads again when the pages answer different hashes (the file changed under them), and gives up after its tries', async () => {
    let version = 0;
    const text = 'x'.repeat(2 * REMOTE_READ_PAGE_BYTES);
    const steady = machine(() => text, REMOTE_READ_PAGE_BYTES + 1024, () => `${version++ < 2 ? 'a' : 'b'}`.repeat(64));
    // the whole read hashes 'a', the first page 'a', the second 'b': changed; the next read's pages all answer 'b'
    const read = await readFileInPages(steady.link, { appSessionId: APP, path: '/r/x.txt', offset: 0, length: text.length, hash: true }, () => {});
    expect(read).toMatchObject({ ok: true, value: { hash: 'b'.repeat(64), length: text.length, truncated: false } });

    let n = 0;
    const moving = machine(() => text, REMOTE_READ_PAGE_BYTES + 1024, () => String(n++ % 10).repeat(64));
    expect(await readFileInPages(moving.link, { appSessionId: APP, path: '/r/x.txt', offset: 0, length: text.length, hash: true }, () => {})).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(moving.asked.length).toBe(1 + 2 * REMOTE_READ_TRIES);
  });
});
