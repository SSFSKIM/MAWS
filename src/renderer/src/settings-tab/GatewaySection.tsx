// The Gateway section (C11 execution document, Interfaces "Settings tab" Gateway; D-19; mockup 06 vignette 04): the
// route new sessions start on, what a first send does when ClaudeUsage's relay is unreachable, whether Session info (W2:
// no status line) offers the per-session Direct switch, the engine's own login as a Direct session last reported it, and the relay.
import { useEffect, useState } from 'react';
import type { Route } from '@shared/engine/route';
import type { Settings } from '@shared/ipc/schema';
import { relayLine } from '../accounts/model';
import { useGateway } from '../gateway/store';
import { runAction } from '../keymap/actions-runtime';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { toast } from '../stores/notices';
import { GATEWAY } from './copy';
import { chooseDefaultRoute, readDefaultRoute } from './default-route';
import { INPUT, Segment, Setting, Switch, TEXT_ACTION, writeSettings } from './parts';

const LEGACY_ROUTES = (['gateway', 'direct'] as const).map((value) => ({ value, label: GATEWAY.routes[value] }));
const ROUTES = (['machine', 'gateway', 'direct'] as const).map((value) => ({ value, label: GATEWAY.routes[value] })); // P5 O7 M9
const POLICIES = ['ask', 'wait', 'direct'] as const;

export function GatewaySection({ settings }: { settings: Settings }) {
  const { defaultRoute, relayUnreachable, offerDirect } = settings.gateway;
  const route = useMachineDefaultRoute(settings);
  return (
    <>
      <Setting row="gateway.defaultRoute" state={route.value === 'machine' ? 'machine' : 'default'}>
        {route.value === null ? (
          <Segment label={GATEWAY.defaultRoute} value={defaultRoute} options={LEGACY_ROUTES} onChange={(next) => writeSettings({ gateway: { defaultRoute: next } })} />
        ) : (
          <Segment label={GATEWAY.defaultRoute} value={route.value} options={ROUTES} onChange={route.choose} />
        )}
        <span className="text-ui-sm text-fg-muted">127.0.0.1:8641</span>
      </Setting>
      <Setting row="gateway.policy" state={relayUnreachable === 'direct' ? 'direct' : 'default'}>
        <select
          aria-label={GATEWAY.policy}
          value={relayUnreachable}
          onChange={(e) => void writeSettings({ gateway: { relayUnreachable: e.target.value as Settings['gateway']['relayUnreachable'] } })}
          className={`${INPUT} max-w-[200px]`}
        >
          {POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {GATEWAY.policies[policy]}
            </option>
          ))}
        </select>
      </Setting>
      <Setting row="gateway.offerDirect">
        <Switch checked={offerDirect} label={GATEWAY.offerDirectLabel} onChange={(next) => void writeSettings({ gateway: { offerDirect: next } })} />
        <span>{GATEWAY.offerDirectLabel}</span>
      </Setting>
      <DirectLogin />
      <Relay />
    </>
  );
}

// P5 O7 M9: the machine's resolved default route, read again whenever the settings change (main publishes a change of the
// machine half, a route-only one included); null while its daemon predates the machine route, or the read failed, when
// the legacy control stands (as it does until the first read answers).
function useMachineDefaultRoute(settings: Settings): { value: Route | null; choose(next: Route): Promise<void> } {
  const [value, setValue] = useState<Route | null>(null);
  useEffect(() => {
    let live = true;
    void readDefaultRoute().then((read) => live && setValue(read));
    return () => {
      live = false;
    };
  }, [settings]);
  const choose = async (next: Route) => {
    const answer = await chooseDefaultRoute(next);
    if (answer.ok) setValue(answer.route);
    else toast({ level: 'warning', text: answer.error, actions: [], dismissible: true });
  };
  return { value, choose };
}

function DirectLogin() {
  // A Direct session's login as its get_status last reported it (the gateway store keeps one per session). Every Direct
  // session runs on the same engine login, so any entry names it; the Map keeps first-insertion order (a re-read does not
  // move a session), so the last entry is the session first read most recently, not necessarily the freshest reading.
  const login = useGateway((s) => [...s.directLogin.values()].at(-1) ?? null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(GATEWAY.signInCommand);
      setCopied(true);
    } catch (error) {
      console.warn('[settings] copy failed', error);
    }
  };
  return (
    // U11a M9: the sign-in and its Copy stay on the row's line, after its sentence and before More
    <Setting
      row="gateway.directLogin"
      lineEnd={
        <>
          <span className="text-fg">{GATEWAY.signIn}</span>
          <button type="button" className={`${TEXT_ACTION} ml-1`} onClick={() => void copy()}>
            {copied ? GATEWAY.copied : GATEWAY.copy}
          </button>
        </>
      }
    >
      <span className={login ? '' : 'text-fg-muted'}>{login ? GATEWAY.directLoginKnown(login.login, login.email) : GATEWAY.directLoginUnknown}</span>
    </Setting>
  );
}

// The relay monitor's reading, checked once more when the section shows (the cached check; Refresh forces one).
function Relay() {
  const relay = useGateway((s) => s.relay);
  const now = useNow(POPOVER_TICK_MS);
  useEffect(() => {
    void useGateway
      .getState()
      .refreshRelay(false)
      .catch((error: unknown) => console.warn('[settings] relay check failed', error));
  }, []);
  return (
    <Setting row="gateway.relay">
      <span className={relay && !relay.ok ? 'text-warning' : ''}>{relayLine(relay, now)}</span>
      <button type="button" className={TEXT_ACTION} onClick={() => runAction('gateway.openClaudeUsage')}>
        {GATEWAY.openClaudeUsage}
      </button>
    </Setting>
  );
}
