// The app's hub connection (OX8; O11 M7) as a Node reference client: the routes an app calls and its three sockets, one
// per hub object — the Registry (state notices and listings), a Project (the log plane) and a Machine (channels). It
// authenticates as whatever `headers` say: against a deployed hub, the Access app token U9's route gives a native app
// (Access's CLI login transfer, sent as `cf-access-token`); against the local hub, the stand-in's test identity. The
// hub admits it as that person's member; the device is named only where the body names it, and proved only by the
// device's own signatures, which the hub and the machines verify against the org state.
import type { Listing, Signed, SignedOrgState } from '../src/types.ts';
import { RelayApp } from './machine-socket.ts';
import { ProjectSocket } from './project-socket.ts';
import { RegistrySocket } from './registry-socket.ts';
import type { Headers } from './socket.ts';

/** A Web Push subscription as `PushSubscription.toJSON()` gives it, bound to one of the member's devices. */
export type PushRegistration = { endpoint: string; keys: { p256dh: string; auth: string }; device?: string };
export type PushRecord = PushRegistration & { member: string; created: string };

/** An answer that was not 2xx: its status and the hub's `{error, message?}` (or Access's page, named so). */
export class HubRefusal extends Error {
  readonly status: number;
  readonly error: string;
  constructor(status: number, error: string, message?: string) {
    super(`${status} ${error}${message ? `: ${message}` : ''}`);
    this.status = status;
    this.error = error;
  }
}

/** A Cloudflare Access token as the hub's deployments take it from a native client (U9's chosen route). */
export const accessTokenHeaders = (token: string): Headers => ({ 'cf-access-token': token });

export class HubClient {
  readonly base: string;
  readonly headers: Headers;

  constructor(base: string, headers: Headers) {
    this.base = base.replace(/\/$/, '');
    this.headers = headers;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      redirect: 'manual',
      headers: { ...this.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      if (text.includes('Cloudflare Access') || response.status === 302) throw new HubRefusal(response.status, 'access', 'Cloudflare Access did not admit the request');
      let parsed: { error?: string; message?: string } = {};
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        parsed = { error: text.slice(0, 80) };
      }
      throw new HubRefusal(response.status, parsed.error ?? 'error', parsed.message);
    }
    return (text === '' ? undefined : JSON.parse(text)) as T;
  }

  /** Who the hub admitted this client as. */
  me(): Promise<{ org: { id: string; name: string }; member: { id: string; email: string; role: string } }> {
    return this.request('GET', '/api/me');
  }

  /** The org state's head, its transitions and certificates, and with `since` the chain after it. */
  orgState(since?: number): Promise<{ head: SignedOrgState | null; chain?: SignedOrgState[] }> {
    return this.request('GET', `/api/org/state${since === undefined ? '' : `?since=${since}`}`);
  }

  listings(project?: string): Promise<{ listings: Signed<Listing>[] }> {
    return this.request('GET', `/api/listings${project === undefined ? '' : `?project=${encodeURIComponent(project)}`}`);
  }

  projects(): Promise<{ projects: Array<{ id: string; name: string; kind: string; retired: boolean }> }> {
    return this.request('GET', '/api/projects');
  }

  /** Keeps a push subscription, bound to `device` when given (the hub pushes to it only while the head lists that device). */
  registerPush(registration: PushRegistration): Promise<{ subscription: PushRecord }> {
    return this.request('PUT', '/api/push/subscriptions', registration);
  }

  pushSubscriptions(): Promise<{ subscriptions: PushRecord[] }> {
    return this.request('GET', '/api/push/subscriptions');
  }

  deletePush(endpoint: string): Promise<{ deleted: boolean }> {
    return this.request('DELETE', '/api/push/subscriptions', { endpoint });
  }

  registry(): Promise<RegistrySocket> {
    return RegistrySocket.open(this.base, this.headers);
  }

  project(id: string): Promise<ProjectSocket> {
    return ProjectSocket.open(this.base, this.headers, id);
  }

  machine(nameOrRef: string): Promise<RelayApp> {
    return RelayApp.open(this.base, nameOrRef, this.headers);
  }
}
