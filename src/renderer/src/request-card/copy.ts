// The request card's copy that lives outside its components (the repository's copy convention). E1 M4b: the card of a
// blocking `maws` ask (`variants/Ask.tsx`, and the title `RequestCard.tsx` reads for it).
export const ASK_CARD = {
  untitled: 'Questions from the agent',
  count: (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`,
  open: 'Answer…', // the word cut (C108): the action, where it said "Open the Question sheet"
} as const;

// The word cut (M2 task 3; `docs/doperpowers/specs/2026-11-16-word-cut/session.md`, the request cards). Where the card
// draws a mark or a spinner in place of words, the words stay here as what a screen reader hears (`…Name`).
export const CARD_WORDS = {
  loadingName: 'Loading the request…', // C86: the quiet spinner's name while the request is read
  positionName: (step: number, count: number) => `${step} of ${count}`, // C103: a question's dots, in words
  requiredName: ' (required)', // C116: after a required field's label, which draws an asterisk
  cannotDraw: 'MAWS can’t show this prompt · answer it in a terminal, or deny', // C93
  cannotAnswer: 'MAWS can’t answer this prompt; it will time out', // C114
  declined: (model: string, category: string | null) => `${model} declined to continue${category ? ` · ${category}` : ''}`, // C112: the declined card's one title
} as const;

// C99: every long preview of a card (a command, a diff, a plan) opens and folds with the same two words.
export const SHOW = { all: 'Show all', less: 'Show less' } as const;

// N111, N113: "Waiting for you" and a bare count, the number's meaning its name and its tooltip.
export const WAITING = {
  title: 'Waiting for you',
  countName: (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`,
} as const;
