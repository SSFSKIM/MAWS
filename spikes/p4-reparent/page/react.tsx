// Suite 2, React level (the repo's React 19): the reverse portal. A keeper renders the child through createPortal into
// a host element it owns; two panes each mount a placeholder only while the body is their active tab (keyed, as MAWS's
// main pane mounts only its active tab's body), and the placeholder's layout effect moves the host in with moveBefore;
// its cleanup parks the host in a connected parking element before React removes the placeholder. Measures mounts and
// cleanups, the child's state, focus and iframe across moves, which React ancestors see a bubbling click and a
// capture-phase pointerdown (the keeper's position or the destination pane's), what native DOM listeners on the
// destination see, and which context value the child reads. A second run leaves out the parking to show the hazard.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { el, errText, frames, sleep } from './util';

const Ctx = createContext('root');

interface Probe {
  log: string[];
  counts: Record<string, number>;
  ctxSeen: string[];
  registered: string[];
  moveErrors: string[];
  moves: string[];
}

export async function reactSuite() {
  const guarded = (park: boolean) => run(park).catch((e: unknown) => ({ error: errText(e), stack: (e as Error).stack }));
  return { withParking: await guarded(true), withoutParking: await guarded(false) };
}

async function run(park: boolean) {
  const probe: Probe = { log: [], counts: {}, ctxSeen: [], registered: [], moveErrors: [], moves: [] };
  const bump = (k: string) => (probe.counts[k] = (probe.counts[k] ?? 0) + 1);
  const container = el('div', { id: `react-root-${park}` });
  document.body.append(container);
  const parking = el('div', { class: 'parking-off', id: `parking-${park}` });
  document.body.append(parking);
  const host = el('div', { id: `rp-host-${park}` }); // the keeper's, made detached (as a keeper would before any pane shows it)

  const place = (into: HTMLElement, label: string) => {
    try {
      const connected = host.isConnected; // moveBefore throws for a node outside the document (suite 1)
      if (connected) (into as HTMLElement & { moveBefore(n: Node, c: Node | null): void }).moveBefore(host, null);
      else into.appendChild(host);
      probe.moves.push(`${label}:${connected ? 'moveBefore' : 'append'}`);
    } catch (e) {
      probe.moveErrors.push(`${label}: ${errText(e)}`);
      into.appendChild(host);
    }
  };

  function Child({ surface }: { surface: string }) {
    const ctx = useContext(Ctx);
    probe.ctxSeen.push(`${surface}:${ctx}`);
    const [clicks, setClicks] = useState(0);
    useEffect(() => {
      bump('child.effect.mount');
      return () => bump('child.effect.cleanup');
    }, []);
    useLayoutEffect(() => {
      bump('child.layout.mount');
      return () => bump('child.layout.cleanup');
    }, []);
    useEffect(() => {
      probe.registered.push(`register ${surface}`); // a header registered under {surface, tabId}
      return () => void probe.registered.push(`unregister ${surface}`);
    }, [surface]);
    return (
      <div id={`child-${park}`}>
        <button
          id={`child-btn-${park}`}
          onPointerDownCapture={() => probe.log.push('child react capture')}
          onClick={() => {
            probe.log.push('child react bubble');
            setClicks((c) => c + 1);
          }}
        >
          clicks {clicks}
        </button>
        <input id={`child-input-${park}`} onFocus={() => bump('input.onFocus')} onBlur={() => bump('input.onBlur')} />
        <iframe id={`child-iframe-${park}`} srcDoc="<!doctype html><script>window.counter=0</script>" onLoad={() => bump('iframe.onLoad')} />
      </div>
    );
  }

  function Keeper({ surface }: { surface: string }) {
    return (
      <Ctx.Provider value="keeper">
        <div id={`keeper-zone-${park}`} onPointerDownCapture={() => probe.log.push('keeper-zone react capture')} onClick={() => probe.log.push('keeper-zone react bubble')}>
          {createPortal(<Child surface={surface} />, host)}
        </div>
      </Ctx.Provider>
    );
  }

  function Placeholder({ pane }: { pane: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      place(ref.current!, `into ${pane}`);
      return () => {
        if (park) place(parking, `park from ${pane}`);
      };
    }, [pane]);
    return <div id={`ph-${pane}-${park}`} ref={ref} />;
  }

  function Pane({ id, show, children }: { id: string; show: boolean; children?: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const node = ref.current!;
      const cap = () => probe.log.push(`pane-${id} native capture`);
      const bub = () => probe.log.push(`pane-${id} native bubble`);
      node.addEventListener('pointerdown', cap, true);
      node.addEventListener('click', bub);
      return () => {
        node.removeEventListener('pointerdown', cap, true);
        node.removeEventListener('click', bub);
      };
    }, [id]);
    return (
      <Ctx.Provider value={`pane-${id}`}>
        <div className="pane" id={`pane-${id}-${park}`} ref={ref} onPointerDownCapture={() => probe.log.push(`pane-${id} react capture`)} onClick={() => probe.log.push(`pane-${id} react bubble`)}>
          {show && <Placeholder key={`tab-${id}`} pane={id} />}
          {children}
        </div>
      </Ctx.Provider>
    );
  }

  let setTarget: (t: 'A' | 'B' | 'none') => void = () => {};
  function App() {
    const [target, set] = useState<'A' | 'B' | 'none'>('A');
    setTarget = set;
    return (
      <>
        <Keeper surface={target === 'A' ? 'panel' : 'main'} />
        <Pane id="A" show={target === 'A'} />
        <Pane id="B" show={target === 'B'} />
      </>
    );
  }

  const root = createRoot(container);
  flushSync(() => root.render(<App />));
  await frames(2);
  const btn = () => host.querySelector(`#child-btn-${park}`) as HTMLButtonElement;
  const input = () => host.querySelector(`#child-input-${park}`) as HTMLInputElement;
  const iframe = () => host.querySelector(`#child-iframe-${park}`) as HTMLIFrameElement;
  await sleep(100);
  (iframe().contentWindow as unknown as { counter: number }).counter = 7;
  const iframeWindow = iframe().contentWindow;

  const click = () => {
    probe.log.length = 0;
    btn().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    btn().click();
    return [...probe.log];
  };
  const state = (label: string) => ({
    label,
    hostParent: host.parentElement?.id ?? null,
    hostConnected: host.isConnected,
    counts: { ...probe.counts },
    buttonText: btn().textContent,
    sameButton: btn() === buttonNode,
    inputValue: input().value,
    activeElementIsInput: document.activeElement === input(),
    iframe: { sameWindow: iframe().contentWindow === iframeWindow, counter: (iframe().contentWindow as unknown as { counter?: number })?.counter ?? null },
    ctxSeenLast: probe.ctxSeen.at(-1),
  });

  const buttonNode = btn();
  const out: Record<string, unknown> = {};
  out.clickAtA = click();
  input().focus();
  input().value = 'typed';
  out.atA = state('at A');

  flushSync(() => setTarget('B'));
  await frames(2);
  await sleep(150);
  out.atB = state('moved A to B');
  out.clickAtB = click();
  await frames(1);
  out.afterClickAtB = state('after click at B (state update renders in the moved DOM)');

  flushSync(() => setTarget('none')); // no pane shows the body: the host waits in the parking (or is dropped)
  await frames(2);
  await sleep(150);
  out.atNone = state('no pane shows it');

  flushSync(() => setTarget('A'));
  await frames(2);
  await sleep(150);
  out.backAtA = state('back at A');

  out.moves = probe.moves;
  out.moveErrors = probe.moveErrors;
  out.registered = probe.registered;
  out.ctxSeen = [...new Set(probe.ctxSeen)];
  root.unmount();
  out.afterUnmount = { counts: { ...probe.counts } };
  container.remove();
  parking.remove();
  return out;
}
