import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Markdown } from './Markdown';

afterEach(cleanup);

it.each([false, true])('preserves the agent’s single line breaks without flattening markdown (live: %s)', (live) => {
  const { container } = render(<Markdown markdown={'First **line**.\nSecond line.\nThird line.\nFourth line.\nFifth line.\nSixth line.\n\n- One\n- Two\n\n```text\nalpha\nbeta\n```'} live={live} />);
  const paragraph = container.querySelector('p')!;
  expect(paragraph.querySelectorAll('br')).toHaveLength(5);
  expect(paragraph.querySelector('[data-streamdown="strong"]')?.textContent).toBe('line');
  expect(container.querySelectorAll('li')).toHaveLength(2);
  expect(container.querySelector('code')?.textContent).toContain('alpha');
  expect(container.querySelector('code')?.textContent).toContain('beta');
  expect(container.querySelector('code br')).toBeNull();
});
