// A Direct session's login as the engine last reported it (C11 execution document, M4 decisions: the footer and the
// Settings tab read `directLogin` from the gateway store, filled by the last `get_status` Session info or the status
// widget made): the `Login`, `Organization` and `Email` rows of `get_status`'s `Session` section, which only a direct
// session carries (`pass2/routing-flag-override.jsonl` seq 12). Every `session.getStatus` answer lands in TanStack's
// cache under C7's key, so one cache subscription hears both readers.
import type { QueryClient } from '@tanstack/react-query';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetStatusResponse } from '@shared/wire/control';
import type { DirectLogin } from './routing-facts';
import { useGateway, type GatewayStore } from './store';

export function directLoginOf(status: GetStatusResponse): DirectLogin | null {
  const session = status.sections.find((s) => s.title === 'Session');
  const row = (label: string) => session?.rows.find((r) => r.label === label)?.value ?? null;
  const login = row('Login');
  return login === null ? null : { login, organization: row('Organization'), email: row('Email') };
}

export function connectDirectLogin(client: QueryClient, gateway: GatewayStore = useGateway): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const [scope, command, input] = event.query.queryKey as [unknown, unknown, { appSessionId?: AppSessionId } | undefined];
    if (scope !== 'maws' || command !== 'session.getStatus' || !input?.appSessionId) return;
    const login = directLoginOf(event.action.data as GetStatusResponse);
    if (login === null) return;
    const id = input.appSessionId;
    gateway.setState((s) => ({ directLogin: new Map(s.directLogin).set(id, login) }));
  });
}
