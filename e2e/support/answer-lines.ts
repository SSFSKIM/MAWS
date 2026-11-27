// A question's answer lines as they are drawn, "header→answer" each (the arrow is the line's own glyph): the question a
// header's tip shows (board ticket 815), held in its description and drawn at rest only where nothing can point, is no
// part of them.
import type { Locator } from '@playwright/test';

export const answerLines = (lines: Locator): Promise<string[]> =>
  lines.evaluateAll((elements) =>
    elements.map((line) => {
      const copy = line.cloneNode(true) as Element;
      copy.querySelectorAll('[hidden], [data-touch-fact]').forEach((element) => element.remove());
      return copy.textContent ?? '';
    }),
  );
