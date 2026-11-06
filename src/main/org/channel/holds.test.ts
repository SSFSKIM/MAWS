// The channel references each page holds (P5 O8 M7a, Interfaces §N): a page's `org.channel.open` holds the project's
// channel and its `org.channel.close` lets one go; a page that reloads or is destroyed lets go of every one it still
// holds, so a tab that never sent its close keeps no socket open until quit.
import { describe, expect, it } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import { PROJECT } from '../../../../test/org/channel-world';
import { channelHolds } from './holds';

const OTHER = '2f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';

function harness() {
  const calls: string[] = [];
  const holds = channelHolds({
    open: async (project) => {
      calls.push(`open ${project}`);
      return { ok: false, reason: 'signed-out' };
    },
    release: (project) => calls.push(`release ${project}`),
  });
  return { calls, holds };
}

describe("a page's channel holds", () => {
  it('opens and lets go per call, and a page that ends lets go of what it still holds', async () => {
    const { calls, holds } = harness();
    const page = endableClientRef('page:1.1');
    expect(await holds.open(page, PROJECT)).toEqual({ ok: false, reason: 'signed-out' });
    await holds.open(page, PROJECT);
    await holds.open(page, OTHER);
    holds.close(page, PROJECT);
    calls.length = 0;
    page.end();
    expect(calls.sort()).toEqual([`release ${PROJECT}`, `release ${OTHER}`]);
    page.end();
    expect(calls).toHaveLength(2);
  });

  it("lets go only of what the page holds: another page's, or a close with no open, are left", async () => {
    const { calls, holds } = harness();
    const a = endableClientRef('page:1.1');
    const b = endableClientRef('page:2.1');
    await holds.open(a, PROJECT);
    holds.close(b, PROJECT); // b never opened it
    holds.close(a, PROJECT);
    holds.close(a, PROJECT); // a second close of one open
    expect(calls).toEqual([`open ${PROJECT}`, `release ${PROJECT}`]);
    await holds.open(b, PROJECT);
    a.end();
    expect(calls.at(-1)).toBe(`open ${PROJECT}`);
  });

  it('answers a page already gone and holds nothing for it', async () => {
    const { calls, holds } = harness();
    const gone = endableClientRef('page:1.1');
    gone.end();
    await holds.open(gone, PROJECT);
    expect(calls).toEqual([`open ${PROJECT}`, `release ${PROJECT}`]);
  });
});
