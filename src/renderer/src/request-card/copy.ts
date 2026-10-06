// The request card's copy that lives outside its components (the repository's copy convention). E1 M4b: the card of a
// blocking `maws` ask (`variants/Ask.tsx`, and the title `RequestCard.tsx` reads for it).
export const ASK_CARD = {
  untitled: 'Questions from the agent',
  count: (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`,
  open: 'Open the Question sheet',
} as const;
