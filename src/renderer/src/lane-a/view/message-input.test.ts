// A message tool's input read while it streams (`message-input.ts`): every cut of the arguments' JSON draws a beginning
// of the message, never a character it does not hold, and the whole input draws the whole message.
import { describe, expect, it } from 'vitest';
import { streamingMessageText } from './message-input';

/** The input as the model writes it (the P4-R7 probe's `{"text": "…"}`), escapes included, and the message it holds. */
const INPUT = String.raw`{"text": "Stage 2 of 4 is \"done\".\nCalls 0412 and 0977 could not be restored:\n\n- caf\u00e9 \ud83d\ude00 \\ and /\tend"}`;
const MESSAGE = 'Stage 2 of 4 is "done".\nCalls 0412 and 0977 could not be restored:\n\n- café 😀 \\ and /\tend';

describe("a message tool's streaming input", () => {
  it('reads the whole input as the whole message, as JSON reads it', () => {
    expect(JSON.parse(INPUT).text).toBe(MESSAGE);
    expect(streamingMessageText(INPUT)).toBe(MESSAGE);
  });

  it('reads every cut of the input as a beginning of the message, an escape or a surrogate pair cut in half left out', () => {
    let longest = 0;
    for (let cut = 0; cut <= INPUT.length; cut++) {
      const text = streamingMessageText(INPUT.slice(0, cut));
      if (text === null) continue;
      expect(MESSAGE.startsWith(text), `cut at ${cut}: ${JSON.stringify(text)}`).toBe(true);
      expect(text.length).toBeGreaterThanOrEqual(longest); // it only grows as the input does
      longest = text.length;
    }
    expect(streamingMessageText(INPUT.slice(0, INPUT.indexOf('\\u00e9') + 3))).toBe('Stage 2 of 4 is "done".\nCalls 0412 and 0977 could not be restored:\n\n- caf');
    expect(streamingMessageText(INPUT.slice(0, INPUT.indexOf('\\ude00')))).toMatch(/café $/); // the high half alone is not drawn
  });

  it('draws nothing before the text starts, or while it is only whitespace', () => {
    for (const json of ['', '{', '{"', '{"te', '{"text"', '{"text":', '{"text": ', '{"text": "', '{"text": "  \\n ']) expect(streamingMessageText(json)).toBeNull();
    expect(streamingMessageText('{"text": "H')).toBe('H');
    expect(streamingMessageText(' {\n  "text" :\t"Hi"\n}')).toBe('Hi'); // JSON's whitespace anywhere between its tokens
  });

  it('draws nothing for an input whose first key is not a string `text`', () => {
    expect(streamingMessageText('{"note": "x", "text": "Hi"}')).toBeNull();
    expect(streamingMessageText('{"text": 3}')).toBeNull();
    expect(streamingMessageText('["text", "Hi"]')).toBeNull();
  });

  it("draws nothing for a copy a resync cut to its tail: where the text starts is lost", () => {
    const long = JSON.stringify({ text: `${'{"text": "not the start" '.repeat(4)}and the end` });
    for (let cut = 1; cut < long.length; cut++) expect(streamingMessageText(long.slice(cut)), `tail from ${cut}`).toBeNull();
  });
});
