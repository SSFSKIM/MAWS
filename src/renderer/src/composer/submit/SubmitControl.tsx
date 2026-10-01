// The submit control (C7 execution document, "Submit control and queue"): the primary button reads the decision's label
// (Send, Queue, Hold, Stop, Resume, Run, Save to memory, Starting…) with its reason, or what it does when the label
// alone would not say (`!` while busy runs now, inside the turn), as the tooltip and description, a Stop beside it
// while a turn runs under a message, and a caret menu with Queue, Hold until the turn ends and Send now while busy,
// each saying what it does (W1). It sits beside the editor and outside the composer key sink, so it is ordinary pane
// content for C5's dispatcher. ⌥ held over the control, or while focus is in the box, turns Queue into Hold live.
import { DropdownMenu } from 'radix-ui';
import type { SubmitDecision, SubmitMenuItem } from './submit-state';

export interface SubmitControlProps {
  decision: SubmitDecision;
  multiline: boolean; // Enter breaks lines once the document has more than one (§5.8), so the tooltip names ⌘Enter
  onPrimary(): void;
  onStop(): void;
  onMenu(id: SubmitMenuItem['id']): void;
  onHover(over: boolean): void;
}

const PRIMARY =
  'inline-flex h-7 items-center rounded-lg px-3 text-ui font-medium outline-accent focus-visible:outline-2 disabled:bg-bg-hover disabled:text-fg-faint';
const TONE: Record<SubmitDecision['primary'], string> = {
  send: 'bg-accent text-bg hover:opacity-90',
  queue: 'bg-accent text-bg hover:opacity-90',
  hold: 'bg-accent text-bg hover:opacity-90',
  stop: 'bg-fg text-bg hover:opacity-90',
  resume: 'bg-accent text-bg hover:opacity-90',
};
const SMALL = 'inline-flex h-7 items-center rounded-lg px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';
const ITEM = 'flex cursor-default flex-col rounded-sm px-2 py-1 outline-none select-none data-highlighted:bg-bg-hover data-disabled:text-fg-faint';

function tooltip(d: SubmitDecision, multiline: boolean): string {
  if (d.reason) return d.reason;
  switch (d.primary) {
    case 'stop':
      return 'Stop the running turn (⌘.)';
    case 'resume':
      return 'Resume the paused queue';
    case 'hold': // while a turn runs ⌥ makes it; idle with messages waiting it is what Enter does
      return d.detail ? `${d.detail} (⌥Enter)` : `${d.label} (${multiline ? '⌘Enter' : 'Enter'})`;
    default:
      return `${d.detail ?? d.label} (${multiline ? '⌘Enter' : 'Enter'})`;
  }
}

export function SubmitControl({ decision, multiline, onPrimary, onStop, onMenu, onHover }: SubmitControlProps) {
  return (
    <div className="flex shrink-0 items-center gap-1" onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      {decision.secondaryStop && (
        <button type="button" aria-label="Stop" title="Stop the running turn (⌘.)" onClick={onStop} className={SMALL}>
          Stop
        </button>
      )}
      <div className="flex items-center">
        <button
          type="button"
          data-submit-state={decision.primary}
          title={tooltip(decision, multiline)}
          aria-description={decision.detail ?? undefined}
          disabled={!decision.enabled}
          onClick={onPrimary}
          className={`${PRIMARY} ${TONE[decision.primary]} ${decision.menu.length > 0 ? 'rounded-r-none' : ''}`}
        >
          {decision.label}
        </button>
        {decision.menu.length > 0 && (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger aria-label="More ways to send" className={`${PRIMARY} ${TONE[decision.primary]} rounded-l-none border-l border-bg px-1.5`}>
              ⌄
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" side="top" sideOffset={4} className="z-50 min-w-64 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
                {decision.menu.map((item) => (
                  <DropdownMenu.Item key={item.id} disabled={!item.enabled} onSelect={() => onMenu(item.id)} className={ITEM}>
                    <span className="flex items-center gap-2">
                      <span className="flex-1">{item.label}</span>
                      {item.chord && <span className="text-ui-sm text-fg-faint">{item.chord}</span>}
                    </span>
                    <span className="text-ui-sm text-fg-muted">{item.detail}</span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </div>
  );
}
