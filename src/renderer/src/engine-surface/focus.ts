import { useLayoutEffect, type RefObject } from 'react';
import type { ScrollSite, SurfaceElement } from '@shared/engine/surface';
import { focus as sendFocus, type Site } from './actions';

const elementOf = (target: HTMLElement | null): SurfaceElement | null => {
  const element = target?.closest('[data-plugin][data-key]');
  return element ? { plugin: element.getAttribute('data-plugin')!, key: element.getAttribute('data-key')! } : null;
};
const controlOf = (target: HTMLElement | null): HTMLElement | null => target?.matches('button, input, select') ? target : target?.querySelector<HTMLElement>('input, select, button') ?? null;

// Native focus reaches us after it moved. Reconcile the engine's answer without turning the correction (or a push)
// into another person gesture. A newer gesture, push, site identity or unmount invalidates every older reply.
export function useSiteFocus(ref: RefObject<HTMLDivElement | null>, site: Site & { component: ScrollSite }): void {
  const { client, appSessionId, component, instanceId } = site;
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    // PaneBody is the panel's keyboard entry stop; the band has its own stop.
    const host = container.closest<HTMLElement>('[data-plugin-pane]') ?? container;
    const address = { client, appSessionId, component, instanceId };
    let generation = 0;
    let applying = false;
    let accepted: HTMLElement | null = null;
    const resolve = (element: SurfaceElement) => controlOf(container.querySelector<HTMLElement>(`[data-plugin="${CSS.escape(element.plugin)}"][data-key="${CSS.escape(element.key)}"]`));
    const place = (target: HTMLElement | null) => {
      applying = true;
      try {
        if (target?.isConnected) target.focus({ preventScroll: true });
        else if (host.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      } finally { applying = false; }
    };
    const request = (held: boolean, target: HTMLElement | null, previous: HTMLElement | null, by: 'person' | 'auto') => {
      const version = ++generation;
      const element = held ? elementOf(target) : null;
      void sendFocus(address, held, element, by).then((answer) => {
        if (!answer || version !== generation) return;
        // The answer names the engine's current holder even when this move was denied.
        const holder = answer.element ? resolve(answer.element) : null;
        if (!answer.moved || answer.deny !== null) {
          accepted = holder ?? previous;
          place(accepted);
          return;
        }
        // A null identity covers native stops too; only a redirect off a keyed stop means the host.
        accepted = held ? (answer.element ? holder : element ? host : target) : null;
        if (held) place(accepted);
      });
    };
    const take = (target: HTMLElement, previous: HTMLElement | null) => {
      const auto = (target === host || target === container) && !host.contains(previous) ? controlOf(container.querySelector<HTMLElement>('[data-autofocus]')) : null;
      request(true, auto ?? target, accepted ?? previous, auto ? 'auto' : 'person');
    };
    const onFocus = (event: FocusEvent) => {
      if (applying) return;
      take(event.target as HTMLElement, event.relatedTarget as HTMLElement | null);
    };
    const onBlur = (event: FocusEvent) => {
      if (applying || host.contains(event.relatedTarget as Node | null)) return;
      request(false, null, accepted ?? event.target as HTMLElement, 'person');
    };
    host.addEventListener('focusin', onFocus);
    host.addEventListener('focusout', onBlur);
    const off = client.on('session.eventBatch', (batch) => {
      if (batch.appSessionId !== appSessionId) return;
      for (const event of batch.events) {
        if (event.kind !== 'plugin.focus' || event.component !== component || event.instanceId !== instanceId) continue;
        generation += 1;
        const target = resolve(event);
        if (target) { accepted = target; place(target); }
      }
    });
    // The panel may have taken the keyboard while its first render answer was still in flight.
    if (host === document.activeElement) take(host, null);
    return () => {
      generation += 1;
      off();
      host.removeEventListener('focusin', onFocus);
      host.removeEventListener('focusout', onBlur);
    };
  }, [ref, client, appSessionId, component, instanceId]);
}
