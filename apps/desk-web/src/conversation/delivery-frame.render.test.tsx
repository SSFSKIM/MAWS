// @vitest-environment happy-dom
// A peer's "From <name>" label drawn through MAWS's own Markdown (the renderer every user bubble goes through): the name
// is text, whatever it holds. MAWS's Markdown carries the math plugin with double-dollar math on, so a name holding
// `$$…$$` must draw as the characters it is, never as math.
import { cleanup, render } from '@testing-library/react';
import type { JsonObject } from 'desk-hub/protocol';
import { afterEach, expect, it } from 'vitest';
import { Markdown } from '../../../../src/renderer/src/transcript/view/markdown/Markdown';
import { deliveryAsDrawn } from './delivery-frame';

afterEach(cleanup);

const delivered = (text: string): JsonObject => ({
  uuid: '00000000-0000-4000-8000-000000000001',
  parentUuid: null,
  timestamp: '2026-10-17T10:00:00.000Z',
  sessionId: 'sess-1',
  isSidechain: false,
  type: 'user',
  origin: { kind: 'plugin', name: 'doperpowers', asUser: true },
  message: { role: 'user', content: text },
});

it("draws a peer's name literally, math delimiters and Markdown syntax included", () => {
  const name = 'a$$x^2$$b *c* $y$';
  const drawn = deliveryAsDrawn(delivered(`[sminos chat MAWS ab12cd34:3 from ${name} → @you]\nhi`));
  const { container } = render(<Markdown markdown={(drawn.message as { content: string }).content} live={false} />);
  expect(container.querySelector('.katex, math')).toBeNull();
  expect(container.querySelector('em')?.textContent).toBe(`From ${name}`);
  expect(container.textContent).toContain('hi');
});
