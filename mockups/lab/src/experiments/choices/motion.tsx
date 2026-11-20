// The pane's parts and the two motion parts: the usage mark in the pane's foot, how the pane collapses and returns,
// and how a menu opens and closes. Motion plays on arrival and again on Replay.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassMenuTrigger } from '@vitreajs/vitrea-react';
import { ChevronDown, ChevronRight, Folder, GitBranch, Maximize2, Plus, Settings as Gear, Square } from 'lucide-react';
import { composer, projects, usage } from '../../content/fixtures';
import { PLANE, THICKNESS } from '../layers/glass';
import { Ring } from '../layers/parts';
import { Block, Menu, useBoard, useDismiss, useOpen, Variant, type MenuMotion } from './board';

export type PaneMotion = 'slide' | 'rail' | 'melt';

const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---- the usage mark ------------------------------------------------------------------------------------------------

/** One round thing that fills as a limit nears: a share as a level in a small round glass, not as an arc. */
function Drop({ value, size = 18 }: { value: number; size?: number }) {
  const id = `xc-drop-${Math.round(value * 1000)}-${size}`;
  const top = 18.5 - 13 * value;
  return (
    <svg className="xl-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <clipPath id={id}>
        <circle cx="12" cy="12" r="6.5" />
      </clipPath>
      <circle cx="12" cy="12" r="9.75" fill="none" stroke="currentColor" strokeOpacity="0.38" strokeWidth="1.75" />
      <rect x="0" y={top} width="24" height={24 - top} fill="currentColor" clipPath={`url(#${id})`} />
    </svg>
  );
}

function Usage({ kind }: { kind: 'rings' | 'drop' | 'time' }) {
  const [open, toggle, close] = useOpen();
  const [el, setEl] = useState<HTMLElement | null>(null);
  useDismiss(el, open, close);
  // The limit that will bite first is the one to show when only one is shown.
  const nearer = Math.max(usage.week, usage.fiveHour);
  const mark = (v: number, size: number) => (kind === 'drop' ? <Drop value={v} size={size} /> : <Ring value={v} size={size} />);
  const label = `Usage: ${pct(usage.fiveHour)} of the five-hour limit, ${pct(usage.week)} of the week`;
  return (
    <Block className="xc-foot" radius={20}>
      <div className="xl-group-head">
        <span>{projects[projects.length - 1]!.name}</span>
        <ChevronRight className="xl-caret" size={13} strokeWidth={2} />
      </div>
      <span className="xl-grow" />
      <div className="xl-pane-foot">
        <span className="xl-icon" aria-hidden>
          <Gear size={17} strokeWidth={1.75} />
        </span>
        <span className="xc-anchor" ref={setEl}>
          {kind === 'time' ? (
            <button type="button" data-menu-anchor="" className="xc-time" aria-expanded={open} aria-label={label} onClick={toggle}>
              {usage.resetsIn}
            </button>
          ) : (
            <button type="button" data-menu-anchor="" className="xl-icon" aria-expanded={open} aria-label={label} onClick={toggle}>
              {kind === 'rings' ? <Ring value={usage.week} inner={usage.fiveHour} /> : <Drop value={nearer} />}
            </button>
          )}
          <Menu open={open} place="above-end" label="Usage" className="xl-usage">
            <div className="xl-usage-row">
              {mark(usage.fiveHour, 16)}
              <span>5 hours</span>
              <span className="xl-num">{pct(usage.fiveHour)}</span>
            </div>
            <div className="xl-usage-row">
              {mark(usage.week, 16)}
              <span>Week</span>
              <span className="xl-num">{pct(usage.week)}</span>
            </div>
            <div className="xl-usage-note">Resets in {usage.resetsIn}</div>
          </Menu>
        </span>
      </div>
    </Block>
  );
}

export function UsagePage() {
  return (
    <>
      {(['rings', 'drop', 'time'] as const).map((kind, n) => (
        <Variant n={n} key={kind}>
          <Usage kind={kind} />
        </Variant>
      ))}
    </>
  );
}

// ---- how the pane collapses and returns ---------------------------------------------------------------------------------

/**
 * The three ways side by side, as small drawings of the window that move together, so they can be compared without
 * memory; under each, a button that plays it on the real pane at full size, which is where it is judged.
 */
export function PanePage({ play }: { play: (how: PaneMotion) => void }) {
  const { replay } = useBoard();
  const [away, setAway] = useState(false);
  useEffect(() => {
    const t = [window.setTimeout(() => setAway(true), 700), window.setTimeout(() => setAway(false), 2500)];
    return () => t.forEach((x) => window.clearTimeout(x));
  }, [replay]);
  return (
    <>
      {(['slide', 'rail', 'melt'] as const).map((how, n) => (
        <Variant n={n} key={how}>
          <div className="xc-stage" data-how={how} data-away={away} aria-hidden>
            <div className="xc-stage-pane">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="xc-stage-toggle" />
            <div className="xc-stage-main">
              <b />
              <i />
              <i />
              <i style={{ width: '62%' }} />
              <b className="xc-stage-composer" />
            </div>
          </div>
          <button type="button" className="xc-full" onClick={() => play(how)}>
            <Maximize2 size={13} strokeWidth={2} />
            Play on the real pane
          </button>
        </Variant>
      ))}
    </>
  );
}

// ---- how a menu opens and closes -----------------------------------------------------------------------------------------

function Rows() {
  return (
    <>
      {(
        [
          ['Model', composer.model],
          ['Effort', composer.effort],
          ['Mode', composer.mode],
        ] as const
      ).map(([label, value]) => (
        <button type="button" key={label} className="xl-item">
          <span>{label}</span>
          <span className="xl-item-value">{value}</span>
          <ChevronRight size={13} strokeWidth={2} />
        </button>
      ))}
      <div className="xl-sep" />
      <div className="xl-item">
        <Folder size={15} strokeWidth={1.75} />
        <span>{composer.folder}</span>
      </div>
      <div className="xl-item">
        <GitBranch size={15} strokeWidth={1.75} />
        <span>{composer.branch}</span>
      </div>
    </>
  );
}

/** A composer's lower edge, which is where the session view's most used menu opens from. */
function Strip({ children }: { children: ReactNode }) {
  return (
    <Block className="xc-strip" radius={26}>
      <span className="xl-gbtn" aria-hidden>
        <Plus size={17} strokeWidth={1.75} />
      </span>
      <span className="xl-grow" />
      {children}
      <span className="xl-send" data-kind="stop" aria-hidden>
        <Square size={11} strokeWidth={0} fill="currentColor" />
      </span>
    </Block>
  );
}

function CssMenu({ motion, open, set }: { motion: MenuMotion; open: boolean; set: (v: boolean) => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const close = useCallback(() => set(false), [set]);
  useDismiss(el, open, close);
  return (
    <Strip>
      <span className="xc-anchor" ref={setEl}>
        <button type="button" data-menu-anchor="" className="xl-chip" aria-expanded={open} onClick={() => set(!open)}>
          {composer.model}
          <ChevronDown size={13} strokeWidth={2} />
        </button>
        <Menu open={open} motion={motion} place="above-end" label="Model and mode">
          <Rows />
        </Menu>
      </span>
    </Strip>
  );
}

/** The library's own menu: a platter of real glass that materialises beside its control. */
function GlassOne({ open, set }: { open: boolean; set: (v: boolean) => void }) {
  const { scheme } = useBoard();
  return (
    <Strip>
      <GlassMenu groupProps={{ backdrop: PLANE }} open={open} onOpenChange={(v) => set(v)}>
        <GlassMenuTrigger surface="fill" className="xl-chip" aria-label="Model and mode">
          {composer.model}
          <ChevronDown size={13} strokeWidth={2} />
        </GlassMenuTrigger>
        <GlassMenuContent aria-label="Model and mode" placement="top-end" gap={8} radius={18} thickness={THICKNESS} className="xl-platter xl-menu xc-glass-menu" data-scheme={scheme}>
          {(
            [
              ['Model', composer.model],
              ['Effort', composer.effort],
              ['Mode', composer.mode],
            ] as const
          ).map(([label, value]) => (
            <GlassMenuItem key={label} className="xl-menu-item xc-glass-item" closeOnAction={false}>
              <span>{label}</span>
              <span className="xc-glass-value">{value}</span>
              <ChevronRight size={13} strokeWidth={2} />
            </GlassMenuItem>
          ))}
          <GlassMenuSeparator className="xl-sep" />
          <GlassMenuItem className="xl-menu-item xc-glass-item" closeOnAction={false}>
            <Folder size={15} strokeWidth={1.75} />
            <span>{composer.folder}</span>
          </GlassMenuItem>
          <GlassMenuItem className="xl-menu-item xc-glass-item" closeOnAction={false}>
            <GitBranch size={15} strokeWidth={1.75} />
            <span>{composer.branch}</span>
          </GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
    </Strip>
  );
}

export function MenuPage() {
  const { replay } = useBoard();
  const [open, setOpen] = useState([false, false, false, false]);
  const set = (i: number) => (v: boolean) => setOpen((prev) => prev.map((x, j) => (j === i ? v : x)));
  // On arrival and on Replay all four open together, hold, and close together.
  useEffect(() => {
    const t = [
      window.setTimeout(() => setOpen([true, true, true, true]), 600),
      window.setTimeout(() => setOpen([false, false, false, false]), 2900),
      // The library's menu hands focus back to its control when it closes; a play nobody asked for by keyboard
      // should not leave a focus ring behind it.
      window.setTimeout(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.closest('.xc-strip')) el.blur();
      }, 3250),
    ];
    return () => t.forEach((x) => window.clearTimeout(x));
  }, [replay]);
  return (
    <>
      {(['corner', 'unroll', 'become'] as const).map((motion, n) => (
        <Variant n={n} key={motion}>
          <CssMenu motion={motion} open={open[n]!} set={set(n)} />
        </Variant>
      ))}
      <Variant n={3}>
        <GlassOne open={open[3]!} set={set(3)} />
      </Variant>
    </>
  );
}
