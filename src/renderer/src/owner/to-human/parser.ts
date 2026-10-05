// Stored-text grammar mirrors doperpowers 7.135.0's to-human mod, not an HTML/Markdown parser. In particular,
// balanced tag mentions inside code still count. S0 differs from the live mod: unbalanced marks stay literal.
// The shell hook's ANSI headers are display-only; stored messages retain the original tags.
export type Kind = 'to-human' | 'essential' | 'need-input' | 'insight';
export type Choice = { text: string; recommended: boolean };
export type Part = { kind: 'plain'; text: string } | { kind: Kind; text: string; choices?: Choice[] };

export function parse(text: string): Part[] {
  const tokens = [...text.matchAll(/<(\/?)(to-human|essential|need-input|insight)>/g)];
  const stack: number[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i][1]) stack.push(i);
    else if (stack.length && tokens[stack.at(-1)!][2] === tokens[i][2]) {
      paired.add(stack.pop()!); paired.add(i);
    } else {
      // Crossing marks are unbalanced, not an implicit close of a different kind.
      stack.length = 0;
    }
  }
  const parts: Part[] = [];
  const open: Kind[] = [];
  let last = 0;
  const take = (piece: string) => {
    if (piece === '') return;
    const kind = open.at(-1) ?? 'plain';
    const previous = parts.at(-1);
    if (previous?.kind === kind) previous.text += piece;
    else parts.push({ kind, text: piece });
  };
  for (let i = 0; i < tokens.length; i++) {
    if (!paired.has(i)) continue;
    const token = tokens[i];
    take(text.slice(last, token.index));
    last = token.index + token[0].length;
    if (token[1]) open.pop();
    else open.push(token[2] as Kind);
    // A nested mark is a new contiguous run even when it repeats the outer kind.
    parts.push({ kind: open.at(-1) ?? 'plain', text: '' });
  }
  take(text.slice(last));
  for (const part of parts) {
    if (part.kind === 'need-input') {
      const choices: Choice[] = [];
      part.text = part.text.replace(/<choice( recommended)?>([\s\S]*?)<\/choice>\n?/g, (_, flag: string | undefined, body: string) => {
        if (body.trim()) choices.push({ text: body.trim(), recommended: flag !== undefined });
        return '';
      });
      if (choices.length) part.choices = choices;
    }
    if (part.kind !== 'plain') part.text = part.text.trim();
  }
  return parts.filter((part) => part.text !== '');
}
