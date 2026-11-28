// @vitest-environment happy-dom
// A press the browser's storage will not keep is never sent (T19; memory.ts): drawn over the page's own sheet, with the
// session's stored memory in a store that is full and has nothing it may give up.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureHost } from '../../../../src/renderer/src/sheet/test-support/fixture-host';
import { CLASH, sheetOf } from '../../../../src/renderer/src/sheet/test-support/questions';
import { SEND } from '../copy';
import { CREDENTIAL_KEY } from '../credential';
import { readMemory } from '../memory';
import { testStorage } from '../test-support/storage';
import { SheetView } from './SheetView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const S = '5eed0000-0000-4000-8000-0000000000aa';

describe('a press with no room in storage', () => {
  it('sends nothing, leaves the draft as it was and editable, and says why', async () => {
    const model = sheetOf([CLASH], { session: S });
    const picked = { revision: 1, picks: ['Keep the earlier sailing'], text: '', images: [] };
    const store = testStorage({
      [CREDENTIAL_KEY]: JSON.stringify({ v: 1, id: '0a1b2c3d', credential: 'A'.repeat(43) }),
      [`maws.sheet.draft.${S}.q4`]: JSON.stringify({ v: 1, touchedAt: 1, draft: picked }),
      [`maws.sheet.seen.${S}.q4`]: JSON.stringify({ v: 1, touchedAt: 1, revision: 1, marked: false }),
    });
    store.quota = Object.entries(store.entries()).reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    vi.stubGlobal('localStorage', store);
    const host = fixtureHost();
    const outline = { wide: false, open: false, toggle: () => {}, close: () => {} };
    await act(async () =>
      void render(<SheetView shown={{ session: S, model, fresh: true, settled: false, baseline: null }} door={null} connection="connected" host={host} outline={outline} navigate={() => {}} adopted={() => {}} />),
    );
    expect(screen.queryByText(SEND.noRoom)).toBeNull();

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^Send/ })));
    expect(host.sent).toEqual([]); // no put
    expect(readMemory(S, store).drafts.get('q4')).toEqual(picked);
    expect(readMemory(S, store).sending).toBeNull();
    expect(screen.getByText(SEND.noRoom)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Send/ }).hasAttribute('disabled')).toBe(false); // the draft is free to change, and to send again
  });
});
