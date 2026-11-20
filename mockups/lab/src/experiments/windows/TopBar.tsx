import { useEffect, useState } from 'react';
import { FileCode2, Hand, PanelLeft, PanelRight, Plus, Settings as Gear } from 'lucide-react';
import { GlassPopover, GlassPopoverClose, GlassPopoverContent, GlassPopoverTrigger } from '@vitreajs/vitrea-react';
import { approval, tabs } from '../../content/fixtures';
import { ENV, Glass, StateMark, TransientGlass, goScene, stateWord, useFootprintHint, useShell } from './shell';

/** The orange seed: the page's one tint, spent on the thing that waits for the person. */
const SEED = 'rgb(253 120 15 / 82%)';

/**
 * The approval another session waits on. It is the one tinted surface in the window, a capsule in the ornament
 * row that grows into its platter; nothing else in the interface takes the orange as glass.
 */
function Approval() {
  const shell = useShell();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hint = useFootprintHint(anchor);
  const [open, setOpen] = useState(false);
  // A capture aid: a platter opens from its control, so even here it opens after the capsule has mounted.
  const auto = shell.flag('approval');
  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => setOpen(true), 500);
    return () => window.clearTimeout(t);
  }, [auto]);
  return (
    <div className="x-windows-approval-anchor" ref={setAnchor}>
      <GlassPopover
        open={open}
        onOpenChange={setOpen}
        groupProps={{ id: 'x-windows-approval', backdrop: ENV, hint, tint: SEED }}
      >
        <GlassPopoverTrigger capsule className="x-windows-approval-trigger x-windows-ink" aria-label={`Approval waiting ${approval.waited}: ${approval.title}`}>
          <Hand size={15} strokeWidth={2.4} />
          <span>Approval</span>
          <span className="x-windows-num" style={{ fontWeight: 650 }}>
            {approval.waited}
          </span>
        </GlassPopoverTrigger>
        <GlassPopoverContent placement="bottom-end" radius={24} gap={10} aria-label={approval.title} className="x-windows-approval x-windows-ink">
          <p>{approval.session}</p>
          <h3>{approval.title}</h3>
          <pre className="x-windows-mono">{approval.command}</pre>
          <p>{approval.why}</p>
          <div className="x-windows-approval-actions">
            <GlassPopoverClose className="x-windows-btn">Deny</GlassPopoverClose>
            <GlassPopoverClose className="x-windows-btn" data-kind="ink">
              Allow
            </GlassPopoverClose>
          </div>
        </GlassPopoverContent>
      </GlassPopover>
    </div>
  );
}

/**
 * The ornament row above the session window: the tab strip and the waiting approval. A window that has been put
 * away leaves its switch here, as a control of its own, since a text control and an icon control never share a
 * group; while the window is open its switch is a plain button inside it.
 */
export function TopBar({ mode }: { mode: 'session' | 'settings' | 'home' }) {
  const shell = useShell();
  return (
    <>
      <TransientGlass show={!shell.sidebar} id="x-windows-orn-sb" role="control" label="Sidebar" className="x-windows-orn x-windows-orn-sb" capsule plane="overlay" interactive>
        <button className="x-windows-orn-hit" aria-label="Show the sidebar" onClick={() => shell.setSidebar(true)}>
          <PanelLeft size={17} strokeWidth={2.2} />
        </button>
      </TransientGlass>

      {mode !== 'home' && (
        <Glass id="x-windows-tabs" role="ornament" label="Tabs" className="x-windows-orn x-windows-tabs" capsule plane="overlay">
          <div role="tablist" aria-label="Open tabs" style={{ display: 'contents' }}>
            {tabs.map((t) => {
              const selected = mode === 'session' && 'active' in t && t.active === true;
              return (
                <button
                  key={t.id}
                  role="tab"
                  className="x-windows-tab"
                  data-kind={t.kind}
                  aria-selected={selected}
                  aria-label={'state' in t && t.state ? `${t.title}. ${stateWord[t.state]}` : t.title}
                  onClick={mode === 'settings' && t.id === 's1' ? () => goScene('session') : undefined}
                >
                  {t.kind === 'file' ? <FileCode2 size={14} strokeWidth={2.2} /> : <StateMark state={('state' in t && t.state) || 'idle'} />}
                  <span className="x-windows-clip">{t.title}</span>
                </button>
              );
            })}
            {mode === 'settings' && (
              <button role="tab" className="x-windows-tab" aria-selected="true">
                <Gear size={14} strokeWidth={2.2} />
                <span className="x-windows-clip">Settings</span>
              </button>
            )}
            <button className="x-windows-tab-plus" aria-label="New tab" onClick={() => goScene('home')}>
              <Plus size={16} strokeWidth={2.4} />
            </button>
          </div>
        </Glass>
      )}

      <Approval />

      <TransientGlass show={mode === 'session' && !shell.side} id="x-windows-orn-side" role="control" label="Side column" className="x-windows-orn x-windows-orn-side" capsule plane="overlay" interactive>
        <button className="x-windows-orn-hit" aria-label="Show the side column" onClick={() => shell.setSide(true)}>
          <PanelRight size={17} strokeWidth={2.2} />
        </button>
      </TransientGlass>
    </>
  );
}
