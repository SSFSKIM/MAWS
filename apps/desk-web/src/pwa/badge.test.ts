import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from 'desk-hub/protocol';
import { orgWaiting, showBadge } from './badge';

const project = (id: string, waiting: number, online = 1): ProjectSummary => ({ id, name: id, kind: 'hub', machines: 1, machines_online: online, working: 0, waiting, live: 0 });

describe('orgWaiting', () => {
  it("is the grid's waiting count summed over the org's projects", () => {
    expect(orgWaiting([project('a', 2), project('b', 0), project('c', 3)])).toBe(5);
    expect(orgWaiting([])).toBe(0);
  });
});

describe('showBadge', () => {
  it('sets the count, and clears the badge at 0, so an answered request clears it', async () => {
    const calls: Array<['set', number] | ['clear']> = [];
    const nav = { setAppBadge: async (n: number) => void calls.push(['set', n]), clearAppBadge: async () => void calls.push(['clear']) };
    await showBadge(nav, 4);
    await showBadge(nav, 0);
    expect(calls).toEqual([['set', 4], ['clear']]);
  });

  it('does nothing where the platform has no badge, and lets a refusal go', async () => {
    await expect(showBadge({}, 3)).resolves.toBeUndefined();
    await expect(showBadge({ setAppBadge: () => Promise.reject(new Error('not allowed')) }, 3)).resolves.toBeUndefined();
  });
});
