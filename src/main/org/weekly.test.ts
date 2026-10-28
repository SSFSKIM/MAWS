// The weekly successor's asking (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "The weekly
// successor" and Proves; Interfaces §K; Q6): due only when this device may sign, nothing is pending and the held head is
// a week old; Touch ID asked at the first focus while due, `lastAsked` written first, never twice a day; a notification
// an hour's check sends only while no window is focused, once a day, `lastNotified` written first; "Re-sign now".
//
// The signing store is the real one over a temporary profile's files and a commit queue, as the session composes it;
// the signer is a fake that records what it was asked and what the store held at that moment. No prompt, no
// notification and no window: focus, the focused window and `notify` are injected.
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import { orgFiles, SIGNING_FILE, type SigningFile } from './files';
import type { Edit, OrgSigner, SignOutcome } from './signer';
import { createSigningStore, type SigningStore } from './signing-store';
import { startWeekly } from './weekly';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const START = Date.parse('2026-10-28T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const profiles: string[] = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await Promise.all(profiles.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Polls `check` until it holds, on the real clock (the weekly check's interval is shortened, never faked). */
async function until(check: () => boolean, what: string, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

type Asked = { edit: Edit; lastAsked: string | null; onDisk: string | null };

async function harness(options: { headAgeDays?: number; checkMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'maws-weekly-'));
  profiles.push(dir);
  const files = orgFiles({ userData: dir, log: () => {} });
  expect(await files.ensure()).toEqual({ ok: true });
  let commits: Promise<unknown> = Promise.resolve();
  const commit = <T>(body: () => Promise<T>): Promise<T> => {
    const turn = commits.then(body);
    commits = turn.catch(() => {});
    return turn;
  };
  const registration: { signing?: true } = {};
  const store: SigningStore = await createSigningStore({ files, commit, registration: () => registration, markRegistration: async () => void (registration.signing = true) });
  const disk = (): SigningFile | null => {
    try {
      return JSON.parse(readFileSync(join(dir, 'org', SIGNING_FILE), 'utf8')) as SigningFile;
    } catch {
      return null;
    }
  };

  const clock = { now: START };
  const head = { issued: iso(START - (options.headAgeDays ?? 9) * DAY) };
  const asked: Asked[] = [];
  const notes: Array<{ text: string; lastNotified: string | null }> = [];
  const focus = new Set<() => void>();
  const signerListeners = new Set<() => void>();
  const t = {
    dir,
    clock,
    head,
    store,
    disk,
    asked,
    notes,
    focused: false,
    maySign: true,
    pending: null as ReturnType<OrgSigner['pending']>,
    answer: { ok: false, reason: 'cancelled' } as SignOutcome,
    /** Runs while the person is asked, before the answer. */
    during: null as (() => Promise<void>) | null,
    focus: () => [...focus].forEach((listener) => listener()),
  };
  const signer: Pick<OrgSigner, 'maySign' | 'pending' | 'sign' | 'onChanged'> = {
    maySign: () => t.maySign,
    pending: () => t.pending,
    async sign(edit) {
      const file = store.get();
      asked.push({ edit, lastAsked: file === 'damaged' ? null : file.lastAsked, onDisk: disk()?.lastAsked ?? null });
      await t.during?.();
      return t.answer;
    },
    onChanged(listener) {
      signerListeners.add(listener);
      return () => void signerListeners.delete(listener);
    },
  };
  const weekly = startWeekly({
    signer,
    head: () => ({ state: { version: 4, issued: head.issued } }) as unknown as SignedOrgState,
    store,
    focused: () => t.focused,
    onFocus(listener) {
      focus.add(listener);
      return () => void focus.delete(listener);
    },
    notify(text) {
      const file = disk();
      notes.push({ text, lastNotified: file?.lastNotified ?? null });
    },
    timing: { WEEKLY_CHECK_MS: options.checkMs ?? 10 },
    now: () => clock.now,
    log: () => {},
  });
  stops.push(() => weekly.close());
  return { ...t, weekly, t, focusListeners: focus };
}

describe('due', () => {
  it('only while this device may sign, nothing is pending, and the held head is at least seven days old', async () => {
    const h = await harness({ headAgeDays: 7 });
    expect(h.weekly.due()).toBe(true);
    expect(h.weekly.ageDays()).toBe(7);

    h.head.issued = iso(START - 7 * DAY + 1);
    expect(h.weekly.due()).toBe(false);
    expect(h.weekly.ageDays()).toBe(6);

    h.head.issued = iso(START - 12 * DAY);
    expect(h.weekly.due()).toBe(true);
    h.t.maySign = false; // not a root, unmarked, or signing.json damaged: the signer's word
    expect(h.weekly.due()).toBe(false);
    h.t.maySign = true;
    h.t.pending = { version: 5, exposed: true, fork: false, hash: 'pending-5', refused: null };
    expect(h.weekly.due()).toBe(false);
    h.t.pending = null;
    expect(h.weekly.due()).toBe(true);
  });
});

describe('asking at a focus', () => {
  it('asks once at the first focus while due, `lastAsked` written to disk before Touch ID asks', async () => {
    const h = await harness();
    expect(h.disk()).toBeNull();
    h.focus();
    await until(() => h.asked.length === 1, 'the ask');
    expect(h.asked[0].edit.summary).toBe('re-sign the org state (no change)');
    expect(h.asked[0].lastAsked).toBe(iso(START));
    expect(h.asked[0].onDisk).toBe(iso(START));
  });

  it('does not ask again at a second focus the same day, and asks again a day later', async () => {
    const h = await harness();
    h.focus();
    await until(() => h.asked.length === 1, 'the first ask');
    h.clock.now = START + 23 * HOUR;
    h.focus();
    await settle();
    expect(h.asked).toHaveLength(1);
    h.clock.now = START + DAY;
    h.focus();
    await until(() => h.asked.length === 2, 'the next day’s ask');
    expect(h.disk()?.lastAsked).toBe(iso(START + DAY));
  });

  it('asks once for focuses that arrive together', async () => {
    const h = await harness();
    h.focus();
    h.focus();
    h.focus();
    await until(() => h.asked.length === 1, 'the ask');
    await settle();
    expect(h.asked).toHaveLength(1);
  });

  it('a cancel ends it for the day: no second ask, and the quiet line stays due', async () => {
    const h = await harness();
    h.t.answer = { ok: false, reason: 'cancelled' };
    h.focus();
    await until(() => h.asked.length === 1, 'the ask');
    await settle();
    expect(h.weekly.due()).toBe(true);
    h.clock.now = START + 2 * HOUR;
    h.focus();
    await settle();
    expect(h.asked).toHaveLength(1);
    expect(h.disk()?.lastAsked).toBe(iso(START));
  });

  it('neither asks nor writes anything at a focus while not due', async () => {
    const h = await harness({ headAgeDays: 3 });
    h.focus();
    h.t.maySign = false;
    h.head.issued = iso(START - 9 * DAY);
    h.focus();
    await settle();
    expect(h.asked).toEqual([]);
    expect(h.disk()).toBeNull();
  });
});

describe('the notification', () => {
  it('goes out on the hourly check only while no window is focused, once a day, `lastNotified` written first', async () => {
    const h = await harness({ headAgeDays: 9 });
    h.t.focused = true;
    await settle();
    expect(h.notes).toEqual([]);

    h.t.focused = false;
    await until(() => h.notes.length === 1, 'the notification');
    expect(h.notes[0]).toEqual({ text: 'The org state is 9 days old. MAWS will ask for Touch ID when you next open it.', lastNotified: iso(START) });
    await settle();
    expect(h.notes).toHaveLength(1);

    h.clock.now = START + DAY;
    await until(() => h.notes.length === 2, 'the next day’s notification');
    expect(h.notes[1].text).toBe('The org state is 10 days old. MAWS will ask for Touch ID when you next open it.');
    // The notification never asks: Touch ID waits for a focus.
    expect(h.asked).toEqual([]);
  });

  it('is not sent while not due', async () => {
    const h = await harness({ headAgeDays: 6 });
    await settle();
    h.head.issued = iso(START - 9 * DAY);
    h.t.pending = { version: 5, exposed: false, fork: false, hash: 'pending-5', refused: null };
    await settle();
    expect(h.notes).toEqual([]);
  });
});

describe('Re-sign now', () => {
  it('signs the no-change successor at once, whatever the day’s asking', async () => {
    const h = await harness();
    h.focus();
    await until(() => h.asked.length === 1, 'the ask');
    h.t.answer = { ok: true, version: 5 };
    expect(await h.weekly.resign()).toEqual({ ok: true, version: 5 });
    expect(h.asked).toHaveLength(2);
    expect(h.asked[1].edit.summary).toBe('re-sign the org state (no change)');
  });
});

describe('changes and the end', () => {
  it('tells listeners when it turns due, and stops checking and listening at close', async () => {
    const h = await harness({ headAgeDays: 6 });
    h.t.focused = true;
    let told = 0;
    h.weekly.onChanged(() => told++);
    h.clock.now = START + DAY;
    await until(() => told === 1, 'the change to due');
    expect(h.weekly.due()).toBe(true);

    h.weekly.close();
    expect(h.focusListeners.size).toBe(0);
    h.t.focused = false;
    await settle();
    expect(h.notes).toEqual([]);
  });
});
