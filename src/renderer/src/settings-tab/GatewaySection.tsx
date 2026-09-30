// The Gateway section (C11 execution document, Interfaces "Settings tab" Gateway; D-19; mockup 06 vignette 04): the
// route new sessions start on, what a first send does when ClaudeUsage's relay is unreachable, whether the status line
// offers the per-session Direct switch, the engine's own login as a Direct session last reported it, and the relay.
import { useEffect, useState } from 'react';
import type { Settings } from '@shared/ipc/schema';
import { relayLine } from '../accounts/model';
import { useGateway } from '../gateway/store';
import { runAction } from '../keymap/actions-runtime';
import { POPOVER_TICK_MS, useNow } from '../statusline/use-now';
import { GATEWAY } from './copy';
import { INPUT, Segment, Setting, Switch, TEXT_ACTION, writeSettings } from './parts';

const ROUTES = (['gateway', 'direct'] as const).map((value) => ({ value, label: GATEWAY.routes[value] }));
const POLICIES = ['ask', 'wait', 'direct'] as const;

export function GatewaySection({ settings }: { settings: Settings }) {
  const { defaultRoute, relayUnreachable, offerDirect } = settings.gateway;
  return (
    <>
      <Setting label={GATEWAY.defaultRoute} note={GATEWAY.defaultRouteNote}>
        <Segment label={GATEWAY.defaultRoute} value={defaultRoute} options={ROUTES} onChange={(next) => void writeSettings({ gateway: { defaultRoute: next } })} />
        <span className="text-ui-sm text-fg-muted">127.0.0.1:8641</span>
      </Setting>
      <Setting label={GATEWAY.policy} note={relayUnreachable === 'direct' ? GATEWAY.policyDirectNote : undefined}>
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
      <Setting label={GATEWAY.offerDirect} note={GATEWAY.offerDirectNote}>
        <Switch checked={offerDirect} label={GATEWAY.offerDirectLabel} onChange={(next) => void writeSettings({ gateway: { offerDirect: next } })} />
        <span>{GATEWAY.offerDirectLabel}</span>
      </Setting>
      <DirectLogin />
      <Relay />
    </>
  );
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
    <Setting
      label={GATEWAY.directLogin}
      note={
        <>
          {GATEWAY.directLoginNote} <span className="text-fg">{GATEWAY.signIn}</span>
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
    <Setting label={GATEWAY.relay}>
      <span className={relay && !relay.ok ? 'text-warning' : ''}>{relayLine(relay, now)}</span>
      <button type="button" className={TEXT_ACTION} onClick={() => runAction('gateway.openClaudeUsage')}>
        {GATEWAY.openClaudeUsage}
      </button>
    </Setting>
  );
}
