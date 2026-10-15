// One project (DX3's server side): browsers' WebSockets, accepted with the Hibernation API. Each socket carries its
// member in its attachment, so a woken object knows whose it is. The log (M2), the session plane, and the pending set
// (M3) are added here.
import { DurableObject } from 'cloudflare:workers';
import { MEMBER_HEADER, PROJECT_HEADER, type Env } from '../env';
import type { ProjectDown } from '../protocol/browser';

export type SocketAttachment = { member: string; visible: boolean; subs: string[] };

export class Project extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/socket') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const member = request.headers.get(MEMBER_HEADER) ?? '';
    const project = request.headers.get(PROJECT_HEADER) ?? '';
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ member, visible: false, subs: [] } satisfies SocketAttachment);
    server.send(JSON.stringify({ t: 'welcome', project, member, head: 0 } satisfies ProjectDown));
    return new Response(null, { status: 101, webSocket: client });
  }
}
