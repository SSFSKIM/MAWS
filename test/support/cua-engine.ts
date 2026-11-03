// The cua engine stub and its connector as a scene uses them (P5 O17 M8; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// M8): the shell wrapper MAWS_E2E_ENGINE_BIN names (test/support/cua-engine-stub.mjs on this Node, with the switches a
// launch cannot carry, since it passes the engine no `MAWS_*` key), the connector's report, and the connector's control
// socket, through which a scene acts as the agent's cua host does (test/support/cua-connector.mjs).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';

export const CUA_ENGINE_STUB = join(__dirname, 'cua-engine-stub.mjs');
export const CUA_CONNECTOR = join(__dirname, 'cua-connector.mjs');
export const CONNECTOR_REPORT = 'cua-connector.json'; // in the session's working directory
export const CONNECTOR_CONTROL = 'cua-connector.sock'; // beside it

export interface CuaEngineOptions {
  ready?: boolean; // the engine comes ready (the ordinary start path), else it never answers initialize
  retry?: boolean; // the connector retries a lost or unreachable socket, as cua's host does
  retryMs?: number; // its interval (cua's CLIENT_RETRY_MS is 5,000)
  lease?: boolean; // it takes a lease after each hello
  control?: boolean; // a scene drives it over its control socket
  lifeMs?: number; // how long the connector lives (two minutes unless named)
  respawn?: boolean; // a connector that ends is started again by its engine
}

// The wrapper at `path`: this Node on the stub, the pinned version for --version and the switches; the engine's own
// arguments after
export function writeCuaEngine(path: string, options: CuaEngineOptions = {}): string {
  const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
  const env: Record<string, string> = { MAWS_CUA_STUB_VERSION: FIXTURE_ENGINE_VERSION };
  if (options.ready) env.MAWS_CUA_STUB_READY = '1';
  if (options.respawn) env.MAWS_CUA_STUB_RESPAWN = '1';
  if (options.retry) env.MAWS_CUA_CONNECTOR_RETRY = '1';
  if (options.retryMs !== undefined) env.MAWS_CUA_CONNECTOR_RETRY_MS = String(options.retryMs);
  if (options.lease) env.MAWS_CUA_CONNECTOR_LEASE = '1';
  if (options.control) env.MAWS_CUA_CONNECTOR_CONTROL = '1';
  if (options.lifeMs !== undefined) env.MAWS_CUA_CONNECTOR_LIFE_MS = String(options.lifeMs);
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`).join(' ');
  writeFileSync(path, `#!/bin/sh\n${assignments} exec ${quote(process.execPath)} ${quote(CUA_ENGINE_STUB)} "$@"\n`, { mode: 0o755 });
  return path;
}

export interface ConnectorReport {
  pid: number;
  hello: Record<string, unknown> | null;
  closed: boolean;
  socket?: string;
  refused?: number;
  hellos?: number;
  closes?: number;
  connected?: boolean;
  leases?: number;
  control?: string;
  events?: Record<string, number>; // cua's debugger.event notifications by CDP method
}

// The connector's report in a session's working directory, or null before its first
export function connectorReport(cwd: string): ConnectorReport | null {
  const path = join(cwd, CONNECTOR_REPORT);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ConnectorReport) : null;
}

export type ControlAnswer<T = unknown> = { ok: true; result: T; ms: number } | { ok: false; error: string; ms: number; steps?: SequenceStep[] };
export interface SequenceStep {
  method: string;
  ms: number;
  error?: string;
}
export interface Created {
  tabId: number;
  windowId: number | null;
  screenshotBytes: number;
  steps: SequenceStep[];
}

export interface ConnectorControl {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<ControlAnswer<T>>;
  sequence(url: string): Promise<ControlAnswer<Created>>; // cua's creation sequence, timed
  probe(path: string): Promise<ControlAnswer<{ hello: Record<string, unknown> | null; closed: boolean }>>; // another socket, dialled from the connector's process
  state(): Promise<ConnectorReport>;
  close(): void;
}

// The control socket of the connector reporting in `cwd`, connected; refused while none listens
export function connectorControl(cwd: string): Promise<ConnectorControl> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(join(cwd, CONNECTOR_CONTROL));
    const waiting = new Map<number, (answer: ControlAnswer<never>) => void>();
    let next = 0;
    let text = '';
    const ask = <T>(line: Record<string, unknown>) =>
      new Promise<ControlAnswer<T>>((answered, failed) => {
        if (socket.destroyed) return failed(new Error('the connector’s control socket is closed'));
        const id = ++next;
        waiting.set(id, answered as (answer: ControlAnswer<never>) => void);
        socket.write(`${JSON.stringify({ id, ...line })}\n`);
      });
    socket.on('data', (chunk) => {
      text += String(chunk);
      for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n')) {
        const { id, ...answer } = JSON.parse(text.slice(0, at)) as { id: number } & ControlAnswer<never>;
        text = text.slice(at + 1);
        waiting.get(id)?.(answer as ControlAnswer<never>);
        waiting.delete(id);
      }
    });
    socket.once('error', reject);
    socket.on('close', () => {
      for (const answered of waiting.values()) answered({ ok: false, error: 'the connector’s control socket closed', ms: 0 });
      waiting.clear();
    });
    socket.once('connect', () =>
      resolve({
        call: (method, params = {}) => ask({ call: { method, params } }),
        sequence: (url) => ask<Created>({ sequence: { url } }),
        probe: (path) => ask({ probe: { path } }),
        state: async () => {
          const answer = await ask<ConnectorReport>({ state: true });
          if (!answer.ok) throw new Error(answer.error);
          return answer.result;
        },
        close: () => socket.destroy(),
      }),
    );
  });
}
