import { describe, expect, it, vi } from 'vitest';
import { endableClientRef } from '../ipc/client';
import { clientGoneRelay, remoteClients } from './client-refs';

// P5 O1 M5: an ended client identity never comes back on a link: the sender posts its clientGone once per link, and
// the receiver hands every later request naming it a ref already gone.
describe('client refs across a host link (P5 O1 M5)', () => {
  it('posts one clientGone per client per link, however many requests carried it', () => {
    const posted: unknown[] = [];
    const relay = clientGoneRelay((message) => void posted.push(message));
    const page = endableClientRef('page:7.1');
    relay.carry(page);
    relay.carry(page);
    expect(posted).toEqual([]);
    page.end();
    relay.carry(page); // a request for the ended page, sent later on the same link
    relay.carry(page);
    expect(posted).toEqual([{ t: 'clientGone', client: 'page:7.1' }]);
  });

  it('keeps an ended client ended for its connection, and a new link starts afresh', () => {
    const clients = remoteClients(1);
    const first = clients.refFor('page:7.1');
    expect(clients.refFor('page:7.1')).toBe(first);
    const gone = vi.fn();
    first.onGone(gone);
    clients.gone('page:7.1');
    expect(gone).toHaveBeenCalledOnce();
    const later = clients.refFor('page:7.1');
    expect(later.id).toBe('1/page:7.1');
    const late = vi.fn();
    later.onGone(late);
    expect(late).toHaveBeenCalledOnce();
    clients.gone('page:7.1'); // a repeat changes nothing
    expect(gone).toHaveBeenCalledOnce();
    clients.end();
    const next = remoteClients(2).refFor('page:7.1');
    const fresh = vi.fn();
    next.onGone(fresh);
    expect(fresh).not.toHaveBeenCalled(); // a new connection never saw it end
  });

  // The held requests of an ended page flushed after a restart: req, clientGone, req, req on one new link.
  it('gives every request of a flushed, ended page a gone ref and posts its clientGone once', () => {
    const clients = remoteClients(3);
    const lines: ({ t: 'req'; client: string } | { t: 'clientGone'; client: string })[] = [];
    const relay = clientGoneRelay((message) => void lines.push(message));
    const page = endableClientRef('page:7.1');
    page.end(); // the page closed while its requests were held
    const handed: ReturnType<typeof clients.refFor>[] = [];
    for (let i = 0; i < 3; i++) {
      lines.push({ t: 'req', client: page.id }); // the supervisor's send: the request, then its carry
      relay.carry(page);
    }
    expect(lines.map((line) => line.t)).toEqual(['req', 'clientGone', 'req', 'req']);
    for (const line of lines) {
      if (line.t === 'clientGone') clients.gone(line.client);
      else handed.push(clients.refFor(line.client));
    }
    for (const ref of handed) {
      const gone = vi.fn();
      ref.onGone(gone);
      expect(gone).toHaveBeenCalledOnce();
    }
  });
});
