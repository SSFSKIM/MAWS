// One scrim for every modal layer (board 523, UX wave U11a M3; the execution document's Interfaces §E). A sheet or a dialog
// dims the window behind it with `SCRIM`, and where one opens over another only the top layer's backdrop paints: the
// window is dimmed once, by the one value, however many layers are open, and the top backdrop also dims the dialog under
// it, which then reads as behind. The top layer is the one mounted last. Pitfall: mount order stands for stacking order,
// so a layer that would open a lower z-index dialog over a sheet must raise its own z-index; the stack is not the place.
import { useLayoutEffect, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { SCRIM } from './ui';

/** The backdrops mounted now, oldest first; the last is the top layer. */
let layers: readonly object[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const top = () => layers.at(-1);

/** The class of one modal layer's backdrop: SCRIM while it is the top layer, 'bg-transparent' while another has opened over it. Each backdrop calls it once and counts as a layer for as long as it is mounted. */
export function useScrim(): string {
  const [layer] = useState(() => ({}));
  // A layout effect: a layer opened over another takes the paint before the browser paints either.
  useLayoutEffect(() => {
    layers = [...layers, layer];
    changed();
    return () => {
      layers = layers.filter((other) => other !== layer);
      changed();
    };
  }, [layer]);
  const current = useSyncExternalStore(subscribe, top);
  return current === undefined || current === layer ? SCRIM : 'bg-transparent';
}

/**
 * A modal layer's backdrop element, marked `data-scrim`: a Radix overlay renders it through `asChild`
 * (`<Dialog.Overlay asChild><Backdrop className="fixed inset-0 z-40" /></Dialog.Overlay>`), so it mounts, and counts as a
 * layer, exactly while its dialog is open. Its own classes place it; the scrim is added.
 */
export function Backdrop({ className = '', ...props }: ComponentProps<'div'>) {
  const scrim = useScrim();
  return <div data-scrim="" {...props} className={`${className} ${scrim}`} />;
}
