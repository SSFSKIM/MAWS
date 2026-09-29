// C11's routing footer in C7's usage popover (C11 execution document, Interfaces "Gateway", *Routing facts*; M4 refresh
// task "the popover footer as C7 asked"): in the footer's left slot, beside C7's `Updated <ago>`, the route sentence
// (without the account, which C7's popover body names), the pace line, then `Open ClaudeUsage ↗`, `Accounts`, `Session
// info` and the switch. §5.4 as amended: the route is stated here and in Session info, never around the composer.
import { useShallow } from 'zustand/react/shallow';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { SETTINGS_DEFAULTS_V3 } from '@shared/settings/defaults';
import { runAction } from '../keymap/actions-runtime';
import { panelHost } from '../panel/host';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { useSessionWindows, useUsage } from '../stores/usage';
import { FOOTER, ROUTE, SWITCH } from './copy';
import { paceLine, routingFacts } from './routing-facts';
import { useGateway } from './store';
import { switchRoute } from './switch-route';

const LINK = 'rounded-sm px-1 py-0.5 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';

export function UsageFooter({ appSessionId }: { appSessionId: AppSessionId }) {
  const { record, status } = useSessions(useShallow((s) => ({ record: s.records.get(appSessionId) ?? null, status: s.engine.get(appSessionId) ?? null })));
  if (!record) return <span />;
  return <Footer appSessionId={appSessionId} record={record} status={status} />;
}

function Footer({ appSessionId, record, status }: { appSessionId: AppSessionId; record: SessionRecord; status: EngineSessionStatus | null }) {
  const now = useNow(POPOVER_TICK_MS);
  const snapshot = useUsage((s) => s.snapshot);
  const settings = useSettings((s) => s.state?.settings) ?? SETTINGS_DEFAULTS_V3;
  const login = useGateway((s) => s.directLogin.get(appSessionId) ?? null);
  const switching = useGateway((s) => s.switching.get(appSessionId) ?? null);
  const shown = useSessionWindows(record, status);
  const facts = routingFacts(record, status, snapshot, settings, login);
  const pace = facts.route === 'direct' || !shown.windows ? [] : [paceLine(shown.windows.sevenDay, 'weekly', now), paceLine(shown.windows.fiveHour, 'fiveHour', now)].filter((l) => l !== null);
  const busy = switching !== null && switching.phase !== 'done' && switching.phase !== 'failed';

  return (
    <div data-routing-footer className="flex min-w-0 flex-col gap-1">
      <p className="m-0 text-ui-sm text-fg">
        {facts.line}
        {facts.note && <span className="text-fg-muted"> · {facts.note}</span>}
      </p>
      {pace.map((line) => (
        <p key={line} className="m-0 text-ui-sm text-warning">
          {line}
        </p>
      ))}
      {busy && (
        <p role="status" className="m-0 text-ui-sm text-fg-muted">
          {SWITCH.phase[switching.phase]}
        </p>
      )}
      {switching?.phase === 'failed' && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {switching.error}
        </p>
      )}
      {facts.refusal && <p className="m-0 text-ui-sm text-fg-muted">{facts.refusal}</p>}
      <div className="-ml-1 flex flex-wrap items-center gap-x-1">
        {facts.route !== 'direct' && (
          <button type="button" className={LINK} onClick={() => runAction('gateway.openClaudeUsage')}>
            {FOOTER.openClaudeUsage}
          </button>
        )}
        <button type="button" className={LINK} onClick={() => runAction('accounts.open')}>
          {FOOTER.accounts}
        </button>
        <button type="button" className={LINK} onClick={() => panelHost.addTool('session-info', { appSessionId })}>
          {FOOTER.sessionInfo}
        </button>
        {facts.targets.map((target) => (
          <button
            key={target}
            type="button"
            className={LINK}
            disabled={busy}
            onClick={() => void switchRoute(appSessionId, target)}
          >
            {switching?.phase === 'failed' && switching.target === target ? `${SWITCH.retry} · ${ROUTE.switchTo[target]}` : ROUTE.switchTo[target]}
          </button>
        ))}
      </div>
    </div>
  );
}
