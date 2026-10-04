// R3 / waves plan K2: the row outcomes of Desktop's message wrapper, implemented over MAWS's tree renderer.
// The native subtree keeps one portal container for its lifetime: moving between the row and a mod's engine slot
// does not reset an editor, question selection, or disclosure. Concealed native content is inert and inaccessible.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { parseTranscriptProps, type TranscriptProps, type TranscriptSite } from '@shared/engine/surface-rows';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import type { SiteAnswer } from './registry';
import { useSurfaceAttached, useSurfaceHooked, useSurfaceSite } from './site';
import { SurfaceBoundary } from './SurfaceBoundary';
import { SurfaceTree } from './SurfaceTree';
import { drawsEngine, firstEngineRef, hasInk, type SurfaceNode } from './tree';

export interface SurfaceRowProps<C extends TranscriptSite> {
  appSessionId: AppSessionId | null;
  component: C;
  instanceId: string;
  props: TranscriptProps[C];
  enabled?: boolean;
  children: (props: TranscriptProps[C], state: { concealed: boolean; ink: boolean }) => ReactNode;
  placeholder?: ReactNode;
  onlyRewrites?: boolean;
  frameInkOnly?: boolean;
  drawingOnly?: boolean;
  onRewrite?: (props: TranscriptProps[C]) => void;
  onInk?: (ink: boolean) => void; // applied drawing, after any gesture hold; pending remounts report nothing
  client?: MawsBridge;
}

const warned = new Set<TranscriptSite>();
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
}
const hasClient = (tree: SurfaceNode | null): boolean => tree !== null && typeof tree !== 'string' && (tree.type === 'Client' || ('children' in tree && tree.children.some(hasClient)));

export function SurfaceRow<C extends TranscriptSite>({ appSessionId, component, instanceId, props, enabled = true, children, placeholder = '…', onlyRewrites = false, frameInkOnly = false, drawingOnly = false, onRewrite, onInk, client = ipc }: SurfaceRowProps<C>) {
  const attached = useSurfaceAttached(appSessionId);
  const hooked = useSurfaceHooked(appSessionId, component);
  const answer = useSurfaceSite({ appSessionId, component, instanceId, props, enabled, client });
  const active = enabled && attached && appSessionId !== null;
  const incoming = useMemo(() => ({ answer, props, pending: active && hooked === true && answer === null }), [answer, props, active, hooked]);
  const [drawn, onPointerDownCapture] = useGestureDrawing(incoming, `${appSessionId}:${component}:${instanceId}:${active}`);
  const [failed, setFailed] = useState<SiteAnswer | null>(null);
  const current = active && drawn.answer !== failed ? drawn.answer : null;
  const ignored = !current?.hooked || (onlyRewrites && (!current.rewritten || equal(current.props, drawn.props)));
  const parsed = useMemo(() => current?.rewritten && !ignored ? parseTranscriptProps(component, current.props, drawn.props) : drawn.props, [component, current, drawn.props, ignored]);
  const refused = !ignored && parsed === null;
  const accepted = !ignored && !refused ? current : null;
  const rewritten = accepted?.rewritten && parsed !== null && !equal(parsed, drawn.props) ? parsed : null;
  useEffect(() => {
    if (refused && !warned.has(component)) {
      warned.add(component);
      console.warn(`[engine-surface] ${component}: a row hook answered props outside the documented shape; its tree was refused`);
    }
  }, [component, refused]);
  const reported = useRef<SiteAnswer | null>(null);
  useEffect(() => {
    if (rewritten && onRewrite && accepted !== reported.current) {
      reported.current = accepted;
      onRewrite(rewritten);
    }
  }, [accepted, rewritten, onRewrite]);

  const tree = accepted?.tree ?? null;
  const ink = hasInk(tree);
  useEffect(() => {
    if (!active || drawn.answer !== null) onInk?.(ink);
  }, [active, drawn.answer, ink, onInk]);
  const slot = firstEngineRef(tree) !== null || hasClient(tree);
  const nativeOnly = accepted === null || drawsEngine(tree) || (frameInkOnly && slot && !ink);
  const pending = useInitialPending(active && drawn.pending && !drawingOnly, `${appSessionId}:${component}:${instanceId}`);
  const concealed = !drawingOnly && (pending || (!nativeOnly && !slot));
  const delayed = useWithheld(pending, `${appSessionId}:${component}:${instanceId}`);
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.style.display = 'contents';
    return element;
  });
  const own = <NativeMount host={host} />;
  const effective = active && parsed !== null && accepted ? parsed : props;
  const showDrawing = active && accepted !== null && !nativeOnly && (!drawingOnly || ink);
  // A drawing-only ToolGroup has its native group beside this mount. Engine slots in that drawing stay empty.
  return (
    <div data-surface-row={component} style={{ display: 'contents' }} onPointerDownCapture={onPointerDownCapture}>
      <SurfaceBoundary key={`${appSessionId}:${component}:${instanceId}`} answer={drawn.answer} name={`${component} ${instanceId}`} onError={setFailed}>
      {showDrawing && appSessionId !== null && <div data-plugin-drawn={component} style={{ display: 'contents' }}>
        <SurfaceTree tree={tree!} site={{ appSessionId, component, instanceId, client }} engine={drawingOnly ? null : own} />
      </div>}
      </SurfaceBoundary>
      {!drawingOnly && (!showDrawing || !slot) && <div style={{ display: delayed || (concealed && !pending) ? 'none' : 'contents' }} aria-hidden={concealed || undefined} inert={concealed || undefined}>{own}</div>}
      {/* Mount the host before native layout effects resolve their enclosing focus/shortcut owner. */}
      {!drawingOnly && createPortal(
        <div data-engine-native={component} aria-hidden={concealed || undefined} inert={concealed || undefined} style={{ display: 'contents', visibility: concealed ? 'hidden' : undefined }}>
          {children(effective, { concealed, ink })}
        </div>, host,
      )}
      {delayed && <div data-engine-withheld="" style={{ display: 'contents' }}>{placeholder}</div>}
    </div>
  );
}

function NativeMount({ host }: { host: HTMLDivElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current!.appendChild(host);
    return () => { host.remove(); };
  }, [host]);
  return <div data-engine-slot="" ref={ref} style={{ display: 'contents' }} />;
}

// Once this row has exposed native content (or received an answer), another instance learning that the
// component is hooked must not hide it. A newly mounted known-hooked row alone starts withheld.
function useInitialPending(candidate: boolean, identity: string): boolean {
  const [state, setState] = useState({ identity, permitted: candidate });
  if (state.identity !== identity) {
    setState({ identity, permitted: candidate });
    return candidate;
  }
  if (!candidate && state.permitted) setState({ identity, permitted: false });
  return candidate && state.permitted;
}

function useWithheld(pending: boolean, identity: string): boolean {
  const [elapsedFor, setElapsedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setElapsedFor(identity), 5000);
    return () => clearTimeout(timer);
  }, [pending, identity]);
  if (elapsedFor !== null && (!pending || elapsedFor !== identity)) setElapsedFor(null);
  return pending && elapsedFor === identity;
}

// Retain the drawing until pointer-up/cancel/blur, then apply in the next task so the click itself reaches the
// element the person pressed. A native select is exempt, matching Desktop's browser-owned selection interaction.
function useGestureDrawing<T>(incoming: T, scope: string): [T, (event: PointerEvent) => void] {
  const [held, setHeld] = useState(false);
  const [state, setState] = useState({ scope, value: incoming });
  let value = state.value;
  if (state.scope !== scope || (!held && state.value !== incoming)) {
    value = incoming;
    setState({ scope, value });
    if (state.scope !== scope && held) setHeld(false);
  }
  useEffect(() => {
    if (!held) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => { clearTimeout(timer); timer = setTimeout(() => setHeld(false), 0); };
    const move = (event: globalThis.PointerEvent) => { if (event.buttons === 0) release(); };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('pointermove', move, true);
    window.addEventListener('blur', release);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('pointermove', move, true);
      window.removeEventListener('blur', release);
    };
  }, [held]);
  return [value, (event) => { if (event.button === 0 && !(event.target as HTMLElement).closest('select')) setHeld(true); }];
}
