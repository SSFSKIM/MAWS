// One captured file on a card (the C3 plan's §G, "References"): collapsed until opened, its body asked for only then,
// a text drawn with its line numbers and an image only from the bytes the host supplied.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SheetBody } from '@shared/sheet/model';
import { ReferenceView } from './ReferenceView';
import { fixtureHost } from './test-support/fixture-host';
import { IMAGE_REFERENCE, PIXEL, TEXT_REFERENCE } from './test-support/references';

afterEach(cleanup);
const SESSION = '5eed0000-0000-4000-8000-0000000000aa';
const answering = (body: SheetBody) => fixtureHost({ body: () => Promise.resolve(body), openFile: true });

describe('ReferenceView', () => {
  it('is one line at rest: the path, its range, and whether the file changed since asked; nothing is fetched', () => {
    const host = answering({ kind: 'text', text: 'a\nb\nc\n' });
    render(<ReferenceView session={SESSION} reference={TEXT_REFERENCE} host={host} />);
    const line = screen.getByRole('button', { name: /src\/auth\.ts/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(line.textContent).toContain(':40–42');
    expect(screen.getByText('Changed since asked')).toBeTruthy();
    expect(host.bodies).toEqual([]);
  });

  it('says nothing of a change where the reader could not know it (changed: null)', () => {
    render(<ReferenceView session={SESSION} reference={IMAGE_REFERENCE} host={answering({ kind: 'gone' })} />);
    expect(screen.queryByText('Changed since asked')).toBeNull();
  });

  it('asks for the body when opened, once, and draws its lines numbered from where the capture starts', async () => {
    const host = answering({ kind: 'text', text: 'const a = 1;\nconst b = 2;\nconst c = 3;\n' });
    const { container } = render(<ReferenceView session={SESSION} reference={TEXT_REFERENCE} host={host} />);
    fireEvent.click(screen.getByRole('button', { name: /src\/auth\.ts/ }));
    await waitFor(() => expect(screen.getByText('const b = 2;')).toBeTruthy());
    expect([...container.querySelectorAll('[data-line-number]')].map((cell) => cell.textContent)).toEqual(['40', '41', '42']);
    fireEvent.click(screen.getByRole('button', { name: /src\/auth\.ts/ }));
    fireEvent.click(screen.getByRole('button', { name: /src\/auth\.ts/ }));
    expect(host.bodies).toEqual([{ ref: TEXT_REFERENCE.sha256 }]);
  });

  it("draws an image from the host's bytes as a data: URL, and from nothing else", async () => {
    const { container } = render(<ReferenceView session={SESSION} reference={IMAGE_REFERENCE} host={answering({ kind: 'image', mediaType: 'image/png', data: PIXEL })} />);
    fireEvent.click(screen.getByRole('button', { name: /docs\/berth\.png/ }));
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect([...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([`data:image/png;base64,${PIXEL}`]);
  });

  it('says a body the record no longer holds is gone', async () => {
    render(<ReferenceView session={SESSION} reference={TEXT_REFERENCE} host={answering({ kind: 'gone' })} />);
    fireEvent.click(screen.getByRole('button', { name: /src\/auth\.ts/ }));
    await waitFor(() => expect(screen.getByText('No longer available')).toBeTruthy());
  });

  it("opens the file as it is now through the host, at the capture's first line, and offers no control without one", () => {
    const host = answering({ kind: 'gone' });
    render(<ReferenceView session={SESSION} reference={TEXT_REFERENCE} host={host} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    expect(host.files).toEqual([{ abs: TEXT_REFERENCE.abs, line: 40 }]);
    cleanup();
    render(<ReferenceView session={SESSION} reference={TEXT_REFERENCE} host={fixtureHost()} />);
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull();
  });

  it('is opened by its card when a link names it', async () => {
    const host = answering({ kind: 'text', text: 'x\n' });
    render(<ReferenceView session={SESSION} reference={TEXT_REFERENCE} host={host} open onOpenChange={() => {}} />);
    await waitFor(() => expect(host.bodies).toHaveLength(1));
  });
});
