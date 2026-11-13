// U12a (docs/doperpowers/plans/2026-11-12-ux-wave-U12a-browser-computer-use-delivery.md, M1; Interfaces §H): the one key
// this landing adds to the wire between the app and the engine host, `page` in `maws.pane.answer`'s `ok: true` branch,
// against build F (`f1852de3a`, root UC-14), whose kept engine host may still be serving a window of this build after an
// update. F's host reads a command's input with the tolerant reader; F's window sends no `page`.
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { AppSessionIdSchema, RequestIdSchema } from '../graph/ids';
import { validateCommandInput } from './validate';
import { readTolerant } from './tolerant';

// `maws.pane.answer`'s input at f1852de3a, copied (src/shared/ipc/schema/maws.ts and src/shared/maws/tools.ts there), so a
// later change of this build's schema cannot move it.
const F_SHOW_PANE_OPENED = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('panel-tool'), toolId: z.string(), tabId: z.string(), title: z.string() }),
  z.strictObject({ kind: z.literal('main-tab'), tabId: z.string(), path: z.string(), line: z.number().int().nullable() }),
]);
const F_PANE_ANSWER_RESULT = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), opened: F_SHOW_PANE_OPENED }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
const F_PANE_ANSWER_INPUT = z.strictObject({ appSessionId: AppSessionIdSchema, requestId: RequestIdSchema, result: F_PANE_ANSWER_RESULT });

const opened = { kind: 'panel-tool', toolId: 'browser', tabId: 'browser:1', title: 'Browser' } as const;
const answer = (result: Record<string, unknown>) => ({ appSessionId: 'app-1', requestId: 'r1', result });

describe('maws.pane.answer’s page against build F (U12a)', () => {
  it('F’s host accepts this build’s answer with that key alone dropped', () => {
    const read = readTolerant(F_PANE_ANSWER_INPUT, answer({ ok: true, opened, page: 'reloaded' }));
    expect(read).toEqual({ ok: true, value: answer({ ok: true, opened }), dropped: ['result.page'] });
  });

  it('F’s window’s answer, with no page, parses under this build’s schema', () => {
    expect(validateCommandInput('maws.pane.answer', answer({ ok: true, opened })).ok).toBe(true);
    expect(validateCommandInput('maws.pane.answer', answer({ ok: false, error: 'show_pane: refused' })).ok).toBe(true);
  });
});
