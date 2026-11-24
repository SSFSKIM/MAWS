// @vitest-environment happy-dom
// The question sheet's components as a consumer imports them (the composite's X5; the C3 plan's §G and M3): through
// MAWS's `src/renderer/src/sheet` alone, in the desk's own test project, which bundles MAWS's renderer modules as they
// stand. A pinned fixture is drawn as a session's sheet, and its Markdown's links reach only what the sheet's policy
// lets them: a web link the injected host, a path naming one of the question's references that reference's viewer, and
// nothing else (the composite's §8.2, third rule).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SheetModel } from '@shared/sheet/model';
import { EMPTY_MEMORY, SessionSheet } from '../../../src/renderer/src/sheet';
import { fixtureHost } from '../../../src/renderer/src/sheet/test-support/fixture-host';
import { pinModel } from '../../../src/renderer/src/sheet/test-support/pin';

afterEach(cleanup);
const REFERENCES = pinModel('references', 'before')!;

describe('the sheet in the desk', () => {
  it('draws a pinned fixture as a session’s sheet', () => {
    render(<SessionSheet model={REFERENCES} memory={EMPTY_MEMORY} onMemory={() => {}} host={fixtureHost({ by: 'desk' })} />);
    expect([...document.querySelectorAll('[data-sheet-question]')].map((card) => card.getAttribute('data-sheet-question'))).toEqual(REFERENCES.open.map((question) => question.id));
    expect(screen.getByRole('button', { name: /src\/auth\.ts/ })).toBeTruthy();
  });

  it("sends a link only where the sheet's policy lets it go, through the injected host", async () => {
    const context = [
      'See [the provider](https://example.com/oauth),',
      '[the check](src/auth.ts#L41),',
      '[another file](src/other.ts),',
      '[the team](mailto:someone@example.com) and',
      '[the deck](maws-artifact:5f0c7a52-0000-4000-8000-000000000001).',
    ].join(' ');
    const model: SheetModel = { ...REFERENCES, open: REFERENCES.open.map((question, i) => (i === 0 ? { ...question, context } : question)) };
    const host = fixtureHost({ by: 'desk', body: () => Promise.resolve({ kind: 'text', text: 'export const expiry = 3600;\n' }) });
    render(<SessionSheet model={model} memory={EMPTY_MEMORY} onMemory={() => {}} host={host} />);

    fireEvent.click(screen.getByRole('link', { name: 'the provider' }));
    expect(host.links).toEqual(['https://example.com/oauth']);

    for (const name of ['another file', 'the team', 'the deck']) fireEvent.click(screen.getByText(name));
    expect(host.links).toEqual(['https://example.com/oauth']);
    expect(host.files).toEqual([]);
    expect(host.bodies).toEqual([]);

    fireEvent.click(screen.getByText('the check'));
    await waitFor(() => expect(screen.getByRole('button', { name: /src\/auth\.ts/ }).getAttribute('aria-expanded')).toBe('true'));
    const auth = model.open[0].references.find((reference) => reference.path === 'src/auth.ts')!;
    expect(host.bodies).toEqual([{ ref: auth.sha256 }]);
    await waitFor(() => expect(screen.getByText('export const expiry = 3600;')).toBeTruthy());
  });
});
