// The answer's form (X18; the P2-C document, Design §1): `Answering "<head>": <answer>`, ported character for character
// from the doperpowers mod (`hooks/mods/to-human.tsx`, `answerText` and `answersOf`), because its exact behaviour is the
// legacy contract: an answer given in a terminal through the mod, and one sent from MAWS's card, read the same.

/**
 * The prompt an answer is: the question's head, then the answer, so the model reads which question it settles without
 * a table to look it up in, and a reader of the transcript sees the same. A multi-line answer keeps its newlines.
 */
export function answerText(head: string, answer: string): string {
  return `Answering "${head}": ${answer}`;
}

// An answer's line, wherever it stands in the prompt, one per question answered; what the person wrote on other lines
// is theirs and not echoed. A head carries no double quote (`questionHead`), so the first `":` closes it and the answer
// may hold anything.
const ANSWER = /^Answering "([^"\n]*)": ?(.*)$/gm;

/** Every answer a prompt carries, in the order of its lines. */
export function answersOf(text: string): { head: string; answer: string }[] {
  return Array.from(text.matchAll(ANSWER), (match) => ({ head: match[1], answer: match[2].trim() }));
}
