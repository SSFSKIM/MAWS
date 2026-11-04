// The offer audit's contract (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 "The offer audit
// and its contract"): every command addressed by an app session that crosses a machine link (the link surface,
// src/main/machines/link-surface.ts) reaches a session on another machine one way or is drawn disabled there with its
// reason. One way is a row of the machine's offer table (src/endpoint/offers.ts), or main's adapters answering it
// themselves (the lane B adapter's substitutes; lane A's adapter, which takes every `laneA.*`); the other is
// `REMOTE_UNAVAILABLE` (src/shared/ipc/remote-unavailable.ts). Nothing is both.
//
// Started by m8-2b with the set's half; m8-5 completes it with the adapter's half (every act row in its `handles`).
import { describe, expect, it } from 'vitest';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { REGISTRY } from '@shared/ipc/registry';
import { routeOf } from '@shared/ipc/routes';
import type { CommandName } from '@shared/ipc/schema';
import { addressedPaths } from '@shared/machine/address';
import { OFFERS } from '../../src/endpoint/offers';
import { SUBSTITUTES } from '../../src/main/lane-b/remote';
import { onLink } from '../../src/main/machines/link-surface';

const NAMES = Object.keys(REGISTRY.commands) as CommandName[];
/** Whether every valid input names an app session (an `addressed` command with an `AppSessionId` among its ids). */
const bySession = (name: CommandName) => routeOf(name) === 'addressed' && addressedPaths(REGISTRY.commands[name].input, 'lower').some((path) => path.split(' ')[1]!.split('|').includes('AppSessionId'));
const offered = (name: string) => Object.hasOwn(OFFERS.commands, name);
const declared = (name: string) => Object.hasOwn(REMOTE_UNAVAILABLE, name);
/** Answered by main's adapters with no row of their own: the lane B adapter's substitutes, and lane A's adapter's `laneA.*`. */
const handledInMain = (name: CommandName) => SUBSTITUTES.has(name) || name.startsWith('laneA.');

describe('every session command across a machine link', () => {
  it('is offered, answered by main’s adapters, or declared remote-unavailable', () => {
    const neither = NAMES.filter((name) => onLink(name) && bySession(name) && !offered(name) && !handledInMain(name) && !declared(name));
    expect(neither).toEqual([]);
  });

  it('is never both offered (or answered by main) and declared', () => {
    expect(Object.keys(REMOTE_UNAVAILABLE).filter((name) => offered(name) || handledInMain(name as CommandName))).toEqual([]);
  });

  it('declares only registry commands that cross a link, each with the words its control shows', () => {
    for (const [name, words] of Object.entries(REMOTE_UNAVAILABLE)) {
      expect(onLink(name), name).toBe(true);
      expect(words, name).toMatch(/^Not on another machine yet: \S/);
    }
  });

  it('declares the machine-wide `mods.list`, which names no one session', () => {
    expect(bySession('mods.list')).toBe(false);
    expect(REMOTE_UNAVAILABLE['mods.list']).toBeDefined();
  });
});
