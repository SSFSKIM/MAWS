// UX wave U3b (decisions 7 to 9): a fenced block and a table keep the text column. Streamdown draws them; the
// transcript's stylesheet restyles its markup. happy-dom has no layout, so these cases hold structure: which of
// Streamdown's elements the stylesheet's rules reach and what they set on them, at any depth under the prose. The
// widths, the wrapped lines, the control's box against the first line's text and the clipboard are the Electron scenes'.
// Streamdown's own Tailwind classes are not loaded here, so only what the stylesheet itself sets is read: the borders and
// grounds it takes away from Streamdown's inner boxes are the scenes' too.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const style = document.createElement('style');
beforeAll(() => {
  style.textContent = readFileSync(resolve(__dirname, '../../../styles/tokens.css'), 'utf8') + readFileSync(resolve(__dirname, '../transcript.css'), 'utf8');
  document.head.append(style);
});
afterAll(() => style.remove());
afterEach(cleanup);

const LONG_LINE = `const readings = [${Array.from({ length: 60 }, (_, i) => `${i}`.padStart(2, '0')).join(', ')}];`.padEnd(300, ' // offsets');
const FENCE = ['```js', LONG_LINE, 'const second = readings.length;', 'const third = second * 2;', '```'].join('\n');
const TABLE = ['| Gauge | Offset before (mm) | Offset after (mm) | Checked by | Next check |', '|---|---|---|---|---|', '| north | 0.42 | 0.03 | the bench rig | Friday |'].join('\n');

async function drawn(markdown: string, live = false) {
  const view = render(
    <div className="transcript-answer">
      <Markdown markdown={markdown} live={live} />
    </div>,
  );
  await waitFor(() => expect(view.container.querySelector('[data-streamdown="code-block-body"], [data-streamdown="table"]')).not.toBeNull());
  return view.container;
}

const css = (element: Element) => getComputedStyle(element);

describe('a code block (decision 7; R6, R7, R9)', () => {
  it('draws no header; the copy control’s row takes no height, so the code starts where the frame’s padding ends', async () => {
    const root = await drawn(FENCE);
    const block = root.querySelector('[data-streamdown="code-block"]')!;
    const header = block.querySelector('[data-streamdown="code-block-header"]')!;
    expect(css(header).display).toBe('none');
    const controls = block.querySelector('[data-streamdown="code-block-actions"]')!.parentElement!;
    expect(controls.previousElementSibling).toBe(header); // the sticky row Streamdown puts after its header
    expect(css(controls).marginTop).toBe('0px'); // not pulled over the header any more
    expect(css(controls).marginBottom).toBe('-40px'); // its 32 px and the frame's 8 px gap
  });

  it('wraps its lines in the one frame instead of scrolling sideways, and keeps 32 px at the end of the first two source lines', async () => {
    const root = await drawn(FENCE);
    const body = root.querySelector('[data-streamdown="code-block-body"]')!;
    expect(css(body).overflowX).toBe('hidden');
    const pre = body.querySelector('pre')!;
    expect(css(pre).whiteSpace).toBe('pre-wrap');
    expect(css(pre).overflowWrap).toBe('break-word');
    const lines = [...pre.querySelector('code')!.children];
    expect(lines.map((line) => line.textContent)).toEqual([LONG_LINE, 'const second = readings.length;', 'const third = second * 2;']);
    expect(lines.map((line) => css(line).paddingRight)).toEqual(['32px', '32px', '0px']);
  });

  it('gives the copy control a 24 px target, enabled once the fence is complete and disabled while it streams', async () => {
    const complete = (await drawn(FENCE)).querySelector<HTMLButtonElement>('[data-streamdown="code-block-copy-button"]')!;
    expect(css(complete).padding).toBe('5px'); // 14 px icon
    expect(complete.disabled).toBe(false);
    cleanup();
    const streaming = (await drawn(FENCE.slice(0, FENCE.lastIndexOf('\n```')), true)).querySelector<HTMLButtonElement>('[data-streamdown="code-block-copy-button"]')!;
    expect(streaming.disabled).toBe(true);
  });
});

describe('a table (decision 8; R9, R10)', () => {
  it('has one frame: its copy control’s row takes no height and sits at the frame’s top right, shown on hover or focus within', async () => {
    const root = await drawn(TABLE);
    const frame = root.querySelector('[data-streamdown="table-wrapper"]')!;
    const [controls, scroller] = [...frame.children];
    expect(scroller.querySelector('[data-streamdown="table"]')).not.toBeNull();
    expect(css(frame).position).toBe('relative');
    const placed = css(controls);
    expect({ position: placed.position, top: placed.top, right: placed.right, opacity: placed.opacity }).toEqual({ position: 'absolute', top: '8px', right: '8px', opacity: '0' });
    const copy = controls.querySelector('button')!;
    expect(copy.title).toBe('Copy table');
    expect(css(copy).padding).toBe('5px');
    copy.focus();
    expect(css(controls).opacity).toBe('1');
  });
});

describe('the width rule (decision 9)', () => {
  it('holds a table and a code block to the column at any depth under the prose, with nothing breaking out', async () => {
    const root = await drawn(`${TABLE}\n\n${FENCE}`);
    for (const block of root.querySelectorAll('[data-streamdown="table-wrapper"], [data-streamdown="code-block"]')) {
      expect(css(block).maxWidth).toBe('100%');
      expect(['', 'none']).toContain(css(block).transform);
    }
    cleanup();
    // A message's blocks sit a level deeper (its ink wrapper), and a streaming answer wraps each block once more.
    const nested = render(
      <div className="transcript-answer">
        <div className="transcript-prose">
          <div dir="auto">
            <div className="owner-message-ink">
              <div data-streamdown="table-wrapper" />
              <div data-streamdown="code-block" />
            </div>
          </div>
        </div>
      </div>,
    ).container;
    for (const block of nested.querySelectorAll('[data-streamdown]')) {
      expect(css(block).maxWidth).toBe('100%');
      expect(['', 'none']).toContain(css(block).transform);
    }
  });
});
