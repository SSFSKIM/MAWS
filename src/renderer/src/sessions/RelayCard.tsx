// The relay-down card body (C10 execution document, "The unstarted session", RelayCard; mockup 05 vignette 03 for the
// content; D-19; C11's asks (2) and (7)): the relay's health, "Open ClaudeUsage, then start" (C11's
// `gateway.openClaudeUsage`, disabled with no further words until C11 registers it; the host polls the relay while the card is docked and
// starts routed by itself once it answers), "Run direct" (`onAccept`), Retry and Cancel (`onDecline`). Under C11's
// `relayUnreachable: 'wait'` the primary is the ClaudeUsage path; under `ask` both are offered.
// P5 O7 M9 ("The relay check and the features"): on the machine's own route the check is advisory, because the machine's
// settings, not MAWS, chose the relay: `onStartAnyway` offers Start anyway, the primary under `ask`.
import type { RelayHealth } from '@shared/engine/relay-health';
import { formatAgo } from '@shared/app/date-format';
import type { ReactElement } from 'react';
import { Tip, UNAVAILABLE_LOOK, unavailableClickProps } from '../ui/tip';
import { PRIMARY, QUIET, SECONDARY } from './ui';

export const RELAY_CARD_TITLE = 'Relay not answering';
export type RelayPolicy = 'ask' | 'wait';

// The word cut (W96, W97, W98): the card's title says what failed, so no first line repeats it; the grey line is when it
// was checked, the address and the answer its tooltip; what each button does is that button's tooltip and description,
// and a greyed Run direct keeps its reason, its owner still taking the keyboard.
export const RELAY_WORDS = {
  checked: (age: string) => `Checked ${age}`,
  where: (url: string, reason: string) => `${url}/api/hello · ${reason}`,
  open: (onThisRoute: boolean) => `Starts ${onThisRoute ? 'on this route' : 'routed'} as soon as the relay answers.`,
  direct: 'The engine’s own login for this session; no gateway models, and switching back later restarts the session.',
  anyway: 'This machine’s own settings send it there; the session starts and says what it reached.',
  directRefused: 'Pick a Claude model first',
} as const;

// A greyed control drawn as its kind is drawn disabled, for one drawn `aria-disabled`
const greyedLook = (look: string) => (look === PRIMARY ? 'aria-disabled:cursor-default aria-disabled:border-fg-faint aria-disabled:bg-fg-faint aria-disabled:hover:bg-fg-faint' : UNAVAILABLE_LOOK);

// A button whose explanation is its tooltip and description (with `refused`, its reason, greyed and still focusable)
function Explained({ why, refused = null, children }: { why: string; refused?: string | null; children: ReactElement }) {
  const said = refused ?? why;
  return (
    <Tip content={said} description={said} {...unavailableClickProps(refused)}>
      {children}
    </Tip>
  );
}

export function RelayCard({
  health,
  policy,
  now,
  gatewayModel,
  openClaudeUsage,
  onAccept,
  onDecline,
  onRecheck,
  onStartAnyway,
}: {
  health: RelayHealth;
  policy: RelayPolicy;
  now: number;
  gatewayModel: boolean; // the launch would use a `claude/*` model, which the direct route cannot serve
  openClaudeUsage: (() => void) | null; // C11's action; null until it registers
  onAccept(): void;
  onDecline(): void;
  onRecheck(): void;
  onStartAnyway?: () => void; // P5 O7 M9: the machine's own route
}) {
  const age = formatAgo(Math.max(0, now - Date.parse(health.checkedAt)), { seconds: true });
  const reason = health.error ?? (health.status === null ? 'no answer' : `HTTP ${health.status}`);
  const where = RELAY_WORDS.where(health.url, reason);
  const open = (
    <Explained key="open" why={RELAY_WORDS.open(onStartAnyway !== undefined)}>
      <button type="button" disabled={openClaudeUsage === null} onClick={() => openClaudeUsage?.()} className={policy === 'wait' ? PRIMARY : SECONDARY}>
        Open ClaudeUsage, then start
      </button>
    </Explained>
  );
  const directLook = policy === 'wait' || onStartAnyway ? SECONDARY : PRIMARY;
  const direct = (
    <Explained key="direct" why={RELAY_WORDS.direct} refused={gatewayModel ? RELAY_WORDS.directRefused : null}>
      <button type="button" onClick={onAccept} className={`${directLook} ${greyedLook(directLook)}`}>
        Run direct
      </button>
    </Explained>
  );
  const anyway = onStartAnyway && (
    <Explained key="anyway" why={RELAY_WORDS.anyway}>
      <button type="button" onClick={onStartAnyway} className={policy === 'wait' ? SECONDARY : PRIMARY}>
        Start anyway
      </button>
    </Explained>
  );
  return (
    <div className="flex flex-col gap-2.5 text-ui text-fg">
      <Tip content={where} description={where}>
        <p tabIndex={0} className="m-0 w-fit rounded-sm text-ui-sm text-fg-muted outline-accent focus-visible:outline-2">
          {RELAY_WORDS.checked(age)}
        </p>
      </Tip>
      <div className="flex items-center gap-2">
        {policy === 'wait' ? [open, anyway, direct] : [anyway, direct, open]}
        <button type="button" onClick={onRecheck} className={QUIET}>
          Retry
        </button>
        <button type="button" onClick={onDecline} className={`${SECONDARY} ml-auto`}>
          Cancel
        </button>
      </div>
    </div>
  );
}
