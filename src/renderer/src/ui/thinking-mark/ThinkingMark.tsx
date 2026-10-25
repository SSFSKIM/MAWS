// The thinking mark (triquetra.ts) as an inline element: a decorative canvas beside the live thinking label.
import { useEffect, useRef } from 'react';
import { mountMark } from './triquetra';

export function ThinkingMark({ size = 22 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? mountMark(ref.current, size) : undefined), [size]);
  return <canvas ref={ref} className="thinking-mark" data-thinking-mark="" aria-hidden="true" style={{ width: size, height: size }} />;
}
