// The ask mod's answer to an async question (doperpowers `hooks/mods/ask.tsx`), as the desk words it. Where it is read
// off the transcript's rows is `@shared/engine/ask-delivery` (moved there for the arrivals reader, UX wave U3, UC-2):
// MAWS's backfill draws the idle prompt as the owner's bubble, harness text and all, and the two attachments as nothing.
// Each is the answer to a question whose call the delivery names, so the desk reads them alike: the answers on the
// question's row (`asked.ts`), and the compact line `answered: …` where the answer reached the model
// (`depth/source/ask-answer.ts`). The held row stays verbatim.
// The answer's words are the transcript model's (`transcript/model/answered.ts`, moved there for the `answer` notice,
// UX wave U3); they are re-exported here for the readers that import them from this module.
export { answeredWords, CLARIFYING } from '../../transcript/model/answered';
export { askAnswers, isAnswerPrompt, type AskAnswer } from '@shared/engine/ask-delivery';
