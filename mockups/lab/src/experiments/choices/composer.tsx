// What the composer holds. One composer with four switches (the queued message, the model picker, the context mark,
// send and stop); each page turns one switch and holds the other three at Layers' own, so a part is judged alone.
// The first position of every switch is Layers' markup on Layers' classes.
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, ChevronRight, CornerDownRight, Folder, GitBranch, Paperclip, Plus, Square, X } from 'lucide-react';
import { composer } from '../../content/fixtures';
import { cx, Fold, GBtn, Ring } from '../layers/parts';
import { Block, Menu, useBoard, useDismiss, useOpen, Variant, type MenuPlace } from './board';
import { LETTERS } from './parts';

type Queued = 'none' | 'chip' | 'above' | 'field' | 'mark';
type Model = 'chip' | 'approach' | 'words' | 'plus';
type Context = 'ring' | 'away' | 'chip' | 'number';
type Send = 'solid' | 'hollow' | 'two';
interface Opts {
  queued: Queued;
  model: Model;
  context: Context;
  send: Send;
}
const TODAY: Opts = { queued: 'none', model: 'chip', context: 'ring', send: 'solid' };

const pct = `${Math.round(composer.context * 100)}%`;

/** Everything the model chip folds away: the model, its effort and mode, and where the session works. */
function ModelRows({ attach, context }: { attach?: boolean; context?: boolean }) {
  return (
    <>
      {attach && (
        <>
          <button type="button" className="xl-item">
            <Paperclip size={15} strokeWidth={1.75} />
            <span>Attach</span>
          </button>
          <div className="xl-sep" />
        </>
      )}
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
      {context && (
        <div className="xl-item">
          <span>Context</span>
          <span className="xl-item-value">{pct}</span>
          <Ring value={composer.context} size={15} />
        </div>
      )}
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

export function Composer({ o, follow }: { o: Opts; follow: boolean }) {
  const board = useBoard();
  const state = board.part.id === 'send' ? board.state : 'running';
  const running = state.startsWith('running');
  const preset = state.endsWith('typed');
  const [text, setText] = useState(preset ? composer.queued : '');
  useEffect(() => setText(preset ? composer.queued : ''), [preset]);
  const [held, setHeld] = useState(true);
  const inMenu = o.context === 'away' || o.context === 'chip';
  // On the context page only the variants that keep the number in the menu open it.
  const [open, toggle, close] = useOpen(follow && (board.part.id === 'model' || inMenu));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useDismiss(anchor, open, close);

  const typed = text.trim().length > 0;
  const kind = typed ? 'go' : running ? 'stop' : 'idle';
  const menu = (place: MenuPlace, attach?: boolean) => (
    <Menu open={open} place={place} label="Model and mode">
      <ModelRows attach={attach} context={inMenu} />
    </Menu>
  );

  let chip: ReactNode = null;
  if (o.model !== 'plus') {
    chip = (
      <span className="xc-anchor" ref={setAnchor}>
        <button type="button" data-menu-anchor="" className={cx('xl-chip', o.model === 'approach' && 'xc-approach')} aria-expanded={open} onClick={toggle}>
          {o.context === 'chip' && <Ring value={composer.context} size={15} />}
          {o.model === 'words' ? (
            <>
              {composer.model}
              <i className="xc-mid" />
              {composer.effort}
              <i className="xc-mid" />
              {composer.mode}
            </>
          ) : (
            composer.model
          )}
          {o.context !== 'chip' && <ChevronDown size={13} strokeWidth={2} />}
        </button>
        {menu('above-end')}
      </span>
    );
  }

  return (
    <div className="xc-composer-wrap">
      {o.queued === 'above' && held && (
        <div className="xc-wait" title="Sends when this turn ends">
          <span>{composer.queued}</span>
          <button type="button" className="xl-queued-x" aria-label="Remove the queued message" onClick={() => setHeld(false)}>
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      )}
      <Block className="xc-composer" radius={26} data-open={open}>
        {o.queued === 'chip' && (
          <Fold open={held}>
            <div className="xl-queued" title="Sends when this turn ends">
              <CornerDownRight size={13} strokeWidth={1.75} />
              <span className="xl-fade">{composer.queued}</span>
              <button type="button" className="xl-queued-x" aria-label="Remove the queued message" onClick={() => setHeld(false)}>
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          </Fold>
        )}
        <div className="xc-field-wrap">
          <textarea className="xl-field" rows={1} placeholder={o.queued === 'field' && held ? undefined : composer.placeholder} aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />
          {o.queued === 'field' && held && !typed && (
            <div className="xc-in-field" title="Sends when this turn ends">
              <CornerDownRight size={14} strokeWidth={1.75} />
              <span className="xl-fade">{composer.queued}</span>
              <button type="button" className="xl-queued-x" aria-label="Remove the queued message" onClick={() => setHeld(false)}>
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
        <div className="xl-tools">
          {o.model === 'plus' ? (
            <span className="xc-anchor" ref={setAnchor}>
              <button type="button" data-menu-anchor="" className="xl-gbtn" aria-label="Attach, model and mode" aria-expanded={open} onClick={toggle}>
                <Plus size={17} strokeWidth={1.75} />
              </button>
              {menu('above-start', true)}
            </span>
          ) : (
            <GBtn label="Attach" tip="Attach" data-tip-at="above-start">
              <Plus size={17} strokeWidth={1.75} />
            </GBtn>
          )}
          <span className="xl-grow" />
          {o.queued === 'mark' && held && (
            <button type="button" className="xl-gbtn xc-queue-mark" aria-label={`Queued: ${composer.queued}`} data-tip={composer.queued} data-tip-at="above">
              <CornerDownRight size={15} strokeWidth={1.75} />
              <i />
            </button>
          )}
          {chip}
          {o.context === 'ring' && (
            <GBtn label={`${pct} of the context window is in use`} tip={`${pct} of context used`} data-tip-at="above" data-shown={(board.part.id === 'context' && board.open) || undefined}>
              <Ring value={composer.context} size={17} />
            </GBtn>
          )}
          {o.context === 'number' && (
            <button type="button" className="xl-chip xc-pct" aria-label={`${pct} of the context window is in use`} data-tip={`${pct} of context used`} data-tip-at="above" data-shown={(board.part.id === 'context' && board.open) || undefined}>
              {pct}
            </button>
          )}
          {o.send === 'two' && running && (
            <button type="button" className="xl-gbtn xc-stop-ghost" aria-label="Stop" data-tip="Stop" data-tip-at="above">
              <Square size={11} strokeWidth={0} fill="currentColor" />
            </button>
          )}
          <button
            type="button"
            className={cx('xl-send', o.send === 'hollow' && 'xc-send-hollow')}
            data-kind={o.send === 'two' && kind === 'stop' ? 'idle' : kind}
            aria-label={kind === 'stop' && o.send !== 'two' ? 'Stop' : 'Send'}
            disabled={kind === 'idle' || (o.send === 'two' && kind === 'stop')}
          >
            {kind === 'stop' && o.send !== 'two' ? <Square key="stop" size={11} strokeWidth={0} fill="currentColor" /> : <ArrowUp key="go" size={17} strokeWidth={2.25} />}
          </button>
        </div>
      </Block>
    </div>
  );
}

const QUEUED = ['chip', 'above', 'field', 'mark'] as const;
const MODEL = ['chip', 'approach', 'words', 'plus'] as const;
const CONTEXT = ['ring', 'away', 'chip', 'number'] as const;
const SEND = ['solid', 'hollow', 'two'] as const;

/** The composer a set of letters describes, with a message queued in it, as the session on screen has. */
export function optsFor(letters: Record<string, string>): Opts {
  const at = (id: string) => Math.max(0, LETTERS.indexOf(letters[id] ?? 'A'));
  return { queued: QUEUED[at('queued')] ?? 'chip', model: MODEL[at('model')] ?? 'chip', context: CONTEXT[at('context')] ?? 'ring', send: SEND[at('send')] ?? 'solid' };
}

const PAGES: Record<string, Opts[]> = {
  queued: (['chip', 'above', 'field', 'mark'] as const).map((queued) => ({ ...TODAY, queued })),
  model: (['chip', 'approach', 'words', 'plus'] as const).map((model) => ({ ...TODAY, model })),
  context: (['ring', 'away', 'chip', 'number'] as const).map((context) => ({ ...TODAY, context })),
  send: (['solid', 'hollow', 'two'] as const).map((send) => ({ ...TODAY, send })),
};

export function ComposerPage() {
  const { part } = useBoard();
  const follow = part.id === 'model' || part.id === 'context';
  return (
    <>
      {PAGES[part.id]!.map((o, n) => (
        <Variant n={n} key={`${part.id}:${n}`}>
          <Composer o={o} follow={follow} />
        </Variant>
      ))}
    </>
  );
}
