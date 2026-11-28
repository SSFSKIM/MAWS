// The sheets, as the page server reaches them (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §N;
// T1): C3's service, in process, through the spine's root, never through the wire's `sheet.*` (whose `sheet.put` stamps
// every line `by: 'maws'`). On the daemon's run path, so it imports types and the spine seam's refusal and nothing else:
// the service itself is the spine's, loaded with it.
//
// The service is the boundary that holds a session to the engine's id form and confines every path; the page server
// passes on what the path gave it. A spine that cannot be had (refused, yielded to an older app, the daemon exiting) or a
// root with no service is `SheetsUnavailable`, which a request for data answers 503 and a live connection hears as
// `unavailable`.
import type { SheetService } from '../../services/sheet/service';
import { SpineUnavailable, type LazySpine } from '../spine-seam';

export type SheetsUnavailableWhy = 'refused' | 'yielded' | 'exiting' | 'no-service';

export class SheetsUnavailable extends Error {
  constructor(readonly why: SheetsUnavailableWhy) {
    super(`the sheets are not available: ${why}`);
  }
}

export interface SheetAccess {
  service(): Promise<SheetService>; // rejects with SheetsUnavailable
}

// The stand-in a page with no spine is given (a test's page server): every request for data is unavailable.
export const NO_SHEETS: SheetAccess = { service: () => Promise.reject(new SheetsUnavailable('no-service')) };

// `ensure('command')` loads a cold spine (a command's trigger) and answers its root; the root's `sheet` is absent in a
// run refused the spine.
export function sheetsOf(spine: Pick<LazySpine, 'ensure'>): SheetAccess {
  return {
    async service() {
      let root;
      try {
        root = await spine.ensure('command');
      } catch (error) {
        throw new SheetsUnavailable(error instanceof SpineUnavailable ? error.why : 'no-service');
      }
      if (root.sheet === undefined) throw new SheetsUnavailable('no-service');
      return root.sheet;
    },
  };
}

export const unavailableWhy = (error: unknown): SheetsUnavailableWhy => (error instanceof SheetsUnavailable ? error.why : 'no-service');
