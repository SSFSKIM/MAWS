// Where acceptance 5's pushes land (O11 M8): a push service as the hub meets one, an https endpoint per subscription
// that answers 201, standing in for the browser's push service. The acceptance run holds the subscription's private key
// and auth secret, as a user agent does, so it decrypts what arrived and reads the notice the hub sent.
//
// Live, the sink is a local HTTP server that a public https URL reaches (the operator's tunnel, `--push-url`); against
// the local hub it is the runtime's own record of its outbound pushes (test/support/local.ts `pushes`).
import { createServer } from 'node:http';
import { decrypt, userAgent, type UserAgent } from '../test/support/push';

export type PushSink = {
  /** The https endpoint of a subscription named `name` at the sink. */
  endpoint(name: string): string;
  /** The bodies pushed to `endpoint`, in arrival order. */
  received(endpoint: string): Uint8Array[];
  close(): Promise<void>;
};

/** A user agent's subscription at `endpoint` (its key pair and auth secret), and the payloads it reads from bodies. */
export { userAgent, type UserAgent };
export async function readPush(ua: Pick<UserAgent, 'keys' | 'privateKey'>, body: Uint8Array): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await decrypt(ua, body))) as unknown;
}

/**
 * A sink listening on `127.0.0.1:<port>`, reached from the hub at `publicBase` (an https URL the operator forwards to
 * that port): each POST is kept under its path and answered 201, anything else 404.
 */
export async function httpPushSink(port: number, publicBase: string): Promise<PushSink> {
  const base = new URL(publicBase);
  if (base.protocol !== 'https:') throw new Error(`--push-url must be https (a push endpoint is): ${publicBase}`);
  const bodies = new Map<string, Uint8Array[]>();
  const server = createServer((request, response) => {
    if (request.method !== 'POST') return void response.writeHead(404).end();
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = new URL(request.url ?? '/', 'http://sink').pathname;
      bodies.set(path, [...(bodies.get(path) ?? []), new Uint8Array(Buffer.concat(chunks))]);
      response.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const prefix = base.pathname.replace(/\/$/, '');
  return {
    endpoint: (name) => `${base.origin}${prefix}/${encodeURIComponent(name)}`,
    received: (endpoint) => bodies.get(new URL(endpoint).pathname) ?? [],
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
