// The submit button's glyphs (UX wave U4a, l3-input-15): one function per glyph the submit table decides, drawn in
// currentColor on the app's 16 px icon grid, so a change to a shape is a change to this file alone. The fills are the
// owner's answers on the drawn example (2026-11-12): the arrow and the square filled by the button's tone, the queue
// mark ("Arrow under a bar") an outline.
import type { ReactNode } from 'react';
import { Icon } from '../../app/IconButton';
import type { SubmitGlyph } from './submit-state';

const ArrowGlyph = () => (
  <Icon>
    <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />
  </Icon>
);
const SquareGlyph = () => (
  <Icon className="size-4">
    <rect x="4.5" y="4.5" width="7" height="7" rx="1" className="fill-current" />
  </Icon>
);
// the arrow under a short bar: this message will wait
const QueueGlyph = () => (
  <Icon>
    <path d="M4.5 2.75h7M8 13.5V6.5M4.5 10 8 6.5l3.5 3.5" />
  </Icon>
);
const PlayGlyph = () => (
  <Icon>
    <path d="M5.5 3.75v8.5L12 8z" className="fill-current" />
  </Icon>
);
const SpinnerGlyph = () => (
  <Icon className="size-4 animate-spin">
    <path d="M8 2.75A5.25 5.25 0 1 1 2.75 8" />
  </Icon>
);

export const GLYPHS: Record<SubmitGlyph, () => ReactNode> = {
  arrow: ArrowGlyph,
  square: SquareGlyph,
  queue: QueueGlyph,
  play: PlayGlyph,
  spinner: SpinnerGlyph,
};
