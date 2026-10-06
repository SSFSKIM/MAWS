// What every modality's control receives (E1 M4): the question, its draft, whether the form is held (Submit in flight),
// and the one way to change the draft.
import type { AskQuestion } from '@shared/maws/tools';
import type { Draft } from '../draft';

export interface ModalityProps {
  question: AskQuestion;
  draft: Draft;
  disabled: boolean;
  edit(change: (draft: Draft) => Draft): void;
}
