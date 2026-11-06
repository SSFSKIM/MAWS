// The channel references each page holds (P5 O8 M7a, Interfaces §N): `org.channel.open` holds a project's channel for
// the asking page and `org.channel.close` lets one of its holds go. A page instance that ends (a reload, a navigation,
// its window destroyed: src/main/ipc/clients.ts) lets go of every hold it still has, so a tab that never sent its close
// keeps no channel open until quit. A close the page holds nothing for is ignored: it can't let go of another page's.
//
// Electron-free.
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { ChannelAnswer } from '@shared/ipc/schema/org';

export interface ChannelHolds {
  open(client: ClientRef, project: string): Promise<ChannelAnswer>;
  close(client: ClientRef, project: string): void;
}

export function channelHolds(channels: { open(project: string): Promise<ChannelAnswer>; release(project: string): void }): ChannelHolds {
  /** Each live page's holds, by project. */
  const pages = new Map<ClientId, Map<string, number>>();

  /** The page's holds; null for a page already gone. */
  function holdsOf(client: ClientRef): Map<string, number> | null {
    const known = pages.get(client.id);
    if (known !== undefined) return known;
    pages.set(client.id, new Map());
    client.onGone(() => {
      const ending = pages.get(client.id);
      pages.delete(client.id);
      for (const [project, count] of ending ?? []) for (let i = 0; i < count; i++) channels.release(project);
    }); // at once for a page already gone
    return pages.get(client.id) ?? null;
  }

  return {
    async open(client, project) {
      const holds = holdsOf(client);
      if (holds === null) {
        const answer = await channels.open(project);
        channels.release(project);
        return answer;
      }
      holds.set(project, (holds.get(project) ?? 0) + 1); // before the open, so an end while it reads lets it go
      return channels.open(project);
    },
    close(client, project) {
      const holds = pages.get(client.id);
      const count = holds?.get(project) ?? 0;
      if (holds === undefined || count === 0) return;
      if (count === 1) holds.delete(project);
      else holds.set(project, count - 1);
      channels.release(project);
    },
  };
}
