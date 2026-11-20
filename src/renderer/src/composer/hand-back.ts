// Ticket 733a, the branch's review (finding 1; docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 5):
// the one way an edit's text goes back into the composer (Cancel after a rewind, a rewind whose target was gone). It goes
// as its form's reader says (`composedPrefill`), exactly as a Send from the bubble sends it: drawn in place, a form's body
// holds no chip, so handed over as typed, what a model, a command or a page wrote in it would go out as the person's
// words. The composer's raw setter is reached from here and never from the seam (hand-back.test.ts holds every file that
// names it).
import type { AppSessionId } from '@shared/graph/ids';
import { prefillComposer, type InlineEdit } from '../stores/composer';
import { composedPrefill } from './composed-prefill';

export function handBackEdit(appSessionId: AppSessionId, edit: InlineEdit): void {
  prefillComposer(appSessionId, composedPrefill(edit));
}
