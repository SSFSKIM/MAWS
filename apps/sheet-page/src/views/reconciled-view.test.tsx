// @vitest-environment happy-dom
// The page gives SessionSheet its own reconcile of the stored memory (§P, "What a tab writes of `reconcile`"), on the
// ground that C3's reconcile answers the same object when nothing changes and is idempotent, so the component's own
// reconcile finds nothing to do and every `onMemory` it calls is the person's or a Send's. Held here over every model
// of the pin, before and after, against a memory with a draft and a sent act for each of its questions.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetModel } from '@shared/sheet/model';
import { EMPTY_MEMORY, reconcile, SessionSheet, type SentAct, type SheetMemory } from '../../../../src/renderer/src/sheet';
import { fixtureHost } from '../../../../src/renderer/src/sheet/test-support/fixture-host';
import { PIN_CASES } from '../../../../src/renderer/src/sheet/test-support/pin';

afterEach(cleanup);

// A draft for every open question, and an act in flight for every key the model holds a verdict for
function memoryFor(model: SheetModel): SheetMemory {
  const drafts = new Map(model.open.map((question) => [question.id, { revision: question.revision, picks: [], text: `on ${question.id}`, images: [] }]));
  const acts: SentAct[] = model.sent.map((entry) => {
    const id = 'id' in entry && typeof entry.id === 'string' ? entry.id : null;
    return { key: entry.key, kind: 'answer', id, draft: id === null ? null : (drafts.get(id) ?? null), sentAt: 1, state: 'sending', note: null };
  });
  return { ...EMPTY_MEMORY, drafts, acts };
}

const models = PIN_CASES.flatMap((pin) => [pin.before, pin.after].filter((model): model is SheetModel => model !== null).map((model) => [pin.name, model] as const));

describe('a reconciled view', () => {
  it.each(models)('is its own reconcile (%s)', (_, model) => {
    const view = reconcile(memoryFor(model), model);
    expect(reconcile(view, model)).toBe(view);
  });

  it.each(models)('asks SessionSheet for no change of its own (%s)', async (_, model) => {
    const onMemory = vi.fn();
    const view = reconcile(memoryFor(model), model);
    await act(async () => void render(<SessionSheet model={model} memory={view} onMemory={onMemory} host={fixtureHost()} />));
    expect(onMemory).not.toHaveBeenCalled();
  });
});
