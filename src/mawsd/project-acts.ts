// `maws` aimed at another machine (docs/doperpowers/plans/2026-11-10-project-registry.md, M12, Interfaces §K): the front's
// broker between a terminal's `projects.forward` and the attached app, which alone can sign an act for another machine.
// The request is posted as `projects.act.request` to the app's machine.sock connection whose hello lists
// `machine.project-acts` (`app()`, routed as the client port routes a request with no asking client), and the app's
// `projects.act.answer` with that id is the terminal's answer. Nothing waits on an app that cannot answer: with none the
// answer is `no-app` at once, and the app's connection ending settles what it was asked `no-app`. The wait has no
// deadline of its own, since a person confirms it; it lasts while both connections live. A terminal that leaves drops
// its request, which is withdrawn from the app (`projects.act.withdrawn`, Decision Log 22), and its later answer is
// refused as not asked; the daemon's stop withdraws every waiting request the same way before answering its terminal.
// A pending request holds nothing but its entry.
import { randomBytes } from 'node:crypto';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { ProjectForward, ProjectForwardResult } from '@shared/ipc/schema/projects';
import { notRunningHere } from '@shared/machine/maws-words';

/** A connection the broker can post the request to: false when it could not be posted (the connection is gone). */
export interface ActApp {
  send(name: 'projects.act.request' | 'projects.act.withdrawn', payload: unknown): boolean;
}

export interface FrontProjectActs {
  /** A terminal's `projects.forward`: settled by the app's answer, or `no-app`. `asker` is its connection. */
  forward(asker: object, input: ProjectForward): Promise<ProjectForwardResult>;
  /** The app's `projects.act.answer`, from `from`: refused for an id it was not asked, or one no terminal waits for. */
  answer(from: object, input: { id: string; result: ProjectForwardResult }): void;
  /** A connection ended: the requests asked of it are refused `no-app`, those it asked are dropped and withdrawn. */
  gone(connection: object): void;
  /** The daemon stops: every waiting request withdrawn from its app, its terminal answered `no-app`. */
  close(): void;
}

type Pending = { app: ActApp; asker: object; input: ProjectForward; settle(result: ProjectForwardResult): void };

const noApp = (input: ProjectForward): ProjectForwardResult => ({ ok: false, code: 'no-app', text: notRunningHere(input) });

export function createProjectActs(options: { app(): ActApp | null }): FrontProjectActs {
  const pending = new Map<string, Pending>();
  // ids no other life of the daemon used: a page that decided `pa-…-1` keeps it, so a restart must not ask under it
  const life = randomBytes(6).toString('base64url');
  let next = 0;
  return {
    forward(asker, input) {
      const app = options.app();
      if (app === null) return Promise.resolve(noApp(input));
      return new Promise((resolve) => {
        const id = `pa-${life}-${++next}`;
        pending.set(id, {
          app,
          asker,
          input,
          settle: (result) => {
            if (pending.delete(id)) resolve(result);
          },
        });
        if (!app.send('projects.act.request', { id, ...input })) pending.get(id)?.settle(noApp(input));
      });
    },
    answer(from, { id, result }) {
      const entry = pending.get(id);
      if (entry === undefined || entry.app !== from) throw new HostCommandError(ipcError('invalid_input', `no project act request ${id} is outstanding for this client`));
      entry.settle(result);
    },
    gone(connection) {
      for (const [id, entry] of [...pending]) {
        if (entry.app === connection) entry.settle(noApp(entry.input));
        else if (entry.asker === connection) {
          pending.delete(id); // its answer goes nowhere: refused as not asked
          entry.app.send('projects.act.withdrawn', { id });
        }
      }
    },
    close() {
      for (const [id, entry] of [...pending]) {
        entry.app.send('projects.act.withdrawn', { id });
        entry.settle(noApp(entry.input));
      }
    },
  };
}
