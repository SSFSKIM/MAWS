// The relay-down card body (C10 execution document, "The unstarted session", RelayCard; mockup 05 vignette 03 for the
// content; D-19; C11's asks (2) and (7)): the relay's health, "Open ClaudeUsage, then start" (C11's
// `gateway.openClaudeUsage`, disabled with no further words until C11 registers it; the host polls the relay while the card is docked and
// starts routed by itself once it answers), "Run direct" (`onAccept`), Retry and Cancel (`onDecline`). Under C11's
// `relayUnreachable: 'wait'` the primary is the ClaudeUsage path; under `ask` both are offered.
// P5 O7 M9 ("The relay check and the features"): on the machine's own route the check is advisory, because the machine's
// settings, not MAWS, chose the relay: `onStartAnyway` offers Start anyway, the primary under `ask`.
import type { RelayHealth } from '@shared/engine/relay-health';
import { formatAgo } from '@shared/app/date-format';
import { PRIMARY, QUIET, SECONDARY } from './ui';

export const RELAY_CARD_TITLE = 'Relay not answering';
export type RelayPolicy = 'ask' | 'wait';

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
  const open = (
    <button key="open" type="button" disabled={openClaudeUsage === null} onClick={() => openClaudeUsage?.()} className={policy === 'wait' ? PRIMARY : SECONDARY}>
      Open ClaudeUsage, then start
    </button>
  );
  const direct = (
    <button key="direct" type="button" disabled={gatewayModel} title={gatewayModel ? 'Pick a Claude model first' : undefined} onClick={onAccept} className={policy === 'wait' || onStartAnyway ? SECONDARY : PRIMARY}>
      Run direct
    </button>
  );
  const anyway = onStartAnyway && (
    <button key="anyway" type="button" onClick={onStartAnyway} className={policy === 'wait' ? SECONDARY : PRIMARY}>
      Start anyway
    </button>
  );
  return (
    <div className="flex flex-col gap-2.5 text-ui text-fg">
      <p className="m-0">ClaudeUsage’s relay is not answering</p>
      <p className="m-0 text-ui-sm text-fg-muted">
        {policy === 'wait' ? `Waiting for the relay · checked ${age}` : `Checked ${age}`} · <span className="font-mono">{health.url}/api/hello</span> · {reason}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui-sm text-fg-muted">
        {onStartAnyway && <li>Start anyway: this machine’s own settings send it there; the session starts and says what it reached.</li>}
        <li>Open ClaudeUsage, then start: starts {onStartAnyway ? 'on this route' : 'routed'} as soon as the relay answers.</li>
        <li>Run direct: the engine’s own login for this session; no gateway models, and switching back later restarts the session.</li>
      </ul>
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
