// The near-limit banner (§5.5 "once per window, not above every composer"; C7 execution document, "Status line
// popovers and usage"): every account window at or over the threshold whose reset is still ahead is posted once, in
// C5's banner host, keyed by (account, window, reset time); a key the owner dismissed is written to the layout key
// `usage.banners` and never posted again, across every composer and across reloads.
import type { MawsBridge } from '@shared/ipc/schema';
import { UsageBannersSchema } from '@shared/ipc/schema/layout';
import type { Settings } from '@shared/ipc/schema/settings';
import type { UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { ipc } from '../ipc/client';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { useUsage } from '../stores/usage';
import { resetsIn } from './format';

export const DEFAULT_NEAR_LIMIT_PERCENT = 90;
const MAX_DISMISSED = 50; // UsageBannersSchema's bound; the oldest dismissals go first
const REFRESH_MS = 60_000; // a shown banner's countdown, and its withdrawal once the window resets

export interface NearLimitBanner {
  key: string;
  text: string;
  resetsAtMs: number; // this reading's reset time, which the adapter remembers for the key
}

// ClaudeUsage records a window's `resetsAt` from the rate-limit headers, which move by a second between readings
// (`07:49:59Z`, then `07:50:00Z`). One window is an account, a limit key and reset times within 90 s of each other,
// measured reading to reading: its key carries the first reset time seen for it, and a later reading finds that key
// again within 90 s of the key's latest reading (the adapter's `lastSeen`; the key's own time before any), so a reset
// time that drifts a little at every reading stays one window. After a reload the dismissed keys in `usage.banners`
// are the anchors; a dismissal whose window has drifted past half the tolerance is re-recorded at the current reading.
export const SAME_WINDOW_MS = 90_000;

export function bannerKey(accountUuid: string, limitKey: string, resetsAt: string): string {
  return `usage:${accountUuid}:${limitKey}:${new Date(Date.parse(resetsAt)).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

const KEY = /^usage:([^:]+):([^:]+):(.+)$/;

const keyTime = (key: string): number => Date.parse(KEY.exec(key)?.[3] ?? '');

// The same window's key at another reset time.
const reanchored = (key: string, resetsAtMs: number): string => {
  const [, account, limit] = KEY.exec(key)!;
  return bannerKey(account, limit, new Date(resetsAtMs).toISOString());
};

// The key among `known` that names this window, if any: its latest reading (`lastSeen`), else its own reset time, within
// the tolerance of this one.
function knownKey(known: readonly string[], accountUuid: string, limitKey: string, resetsAt: string, lastSeen: ReadonlyMap<string, number>): string | undefined {
  const at = Date.parse(resetsAt);
  return known.find((key) => {
    const m = KEY.exec(key);
    return m !== null && m[1] === accountUuid && m[2] === limitKey && Math.abs((lastSeen.get(key) ?? Date.parse(m[3])) - at) <= SAME_WINDOW_MS;
  });
}

// C11's `settings.usage.nearLimitPercent` (50–100, settings v3 validates it); 90 before the settings are read.
export function thresholdFrom(settings: Settings | null): number {
  return settings?.usage.nearLimitPercent ?? DEFAULT_NEAR_LIMIT_PERCENT;
}

interface WindowOptions {
  thresholdPercent?: number;
  now?: number;
  lastSeen?: ReadonlyMap<string, number>; // each known key's latest reset time read
}

// Every banner the snapshot warrants at `now`, each keyed by the `known` key that already names its window, else by
// its own reset time. Pure.
export function nearLimitWindows(snapshot: UsageSnapshot, known: readonly string[], opts: WindowOptions = {}): NearLimitBanner[] {
  if (!snapshot.available) return [];
  const threshold = opts.thresholdPercent ?? DEFAULT_NEAR_LIMIT_PERCENT;
  const now = opts.now ?? Date.now();
  const lastSeen = opts.lastSeen ?? new Map<string, number>();
  const banners: NearLimitBanner[] = [];
  for (const account of snapshot.accounts) {
    const windows: [string, string, UsageWindow | null][] = [
      ['session', '5-hour', account.windows.fiveHour],
      ['weekly_all', 'Weekly', account.windows.sevenDay],
      ...account.windows.scoped.map(({ model, window }): [string, string, UsageWindow] => [`weekly_scoped#${model}`, `Weekly ${model}`, window]),
    ];
    for (const [limitKey, label, window] of windows) {
      if (!window || window.percent < threshold) continue;
      const left = Date.parse(window.resetsAt) - now;
      if (!(left > 0)) continue;
      const key = knownKey(known, account.uuid, limitKey, window.resetsAt, lastSeen) ?? bannerKey(account.uuid, limitKey, window.resetsAt);
      banners.push({ key, text: `${label} window at ${Math.round(window.percent)}% for ${account.email} · resets in ${resetsIn(left)}`, resetsAtMs: Date.parse(window.resetsAt) });
    }
  }
  return banners;
}

// Every banner the snapshot warrants at `now`, less the windows `dismissed` names. Pure.
export function nearLimitBanners(snapshot: UsageSnapshot, dismissed: Iterable<string>, opts: WindowOptions = {}): NearLimitBanner[] {
  const skip = [...dismissed];
  return nearLimitWindows(snapshot, skip, opts).filter((b) => !skip.includes(b.key));
}

export interface NearLimitDeps {
  client: MawsBridge;
  usage: typeof useUsage;
  notices: typeof useNotices;
  settings: typeof useSettings;
}

// The adapter over C5's notices store: posts through `banner()` with the key as the notice id (so a re-post would be
// a no-op in C5's store as well), refreshes a shown banner's countdown every minute, withdraws it when its window
// resets or leaves the threshold, and records the banner host's dismiss control in `usage.banners`. Nothing is posted
// before the dismissed keys are read, so a reload never flashes a dismissed banner.
export function connectNearLimitBanners(deps: NearLimitDeps = { client: ipc, usage: useUsage, notices: useNotices, settings: useSettings }): () => void {
  const { client, usage, notices, settings } = deps;
  let dismissed: string[] | null = null; // newest last, as layout.json keeps them
  const posted = new Set<string>(); // every key posted in this run: never posted again
  const withdrawing = new Set<string>(); // keys this adapter removes itself, which are not dismissals
  const lastSeen = new Map<string, number>(); // each key's latest reset time read in this run
  let live = true;

  const shown = () => new Set(notices.getState().notices.map((n) => n.id));

  const evaluate = () => {
    const snapshot = usage.getState().snapshot;
    if (!live || dismissed === null || !snapshot) return;
    // keyed by what was dismissed and what this run posted, so a jittered reset time finds its window's key again
    const opts = { thresholdPercent: thresholdFrom(settings.getState().state?.settings ?? null), now: Date.now(), lastSeen };
    const windows = nearLimitWindows(snapshot, [...dismissed, ...posted], opts);
    for (const { key, resetsAtMs } of windows) lastSeen.set(key, resetsAtMs);
    // a dismissal whose window has drifted past half the tolerance is recorded again at this reading, so a reload
    // (which has only the keys' own times) still finds it
    const moved = new Map(windows.filter((b) => dismissed!.includes(b.key) && Math.abs(b.resetsAtMs - keyTime(b.key)) > SAME_WINDOW_MS / 2).map((b) => [b.key, reanchored(b.key, b.resetsAtMs)]));
    if (moved.size > 0) {
      for (const [, key] of moved) lastSeen.set(key, keyTime(key));
      writeDismissed(dismissed.map((key) => moved.get(key) ?? key));
    }
    const skip = dismissed;
    const current = windows.filter((b) => !moved.has(b.key) && !skip.includes(b.key));
    const onScreen = shown();
    for (const { key, text } of current) {
      const held = notices.getState().notices.find((n) => n.id === key);
      if (posted.has(key) && !held) continue; // dismissed a moment ago, or withdrawn
      if (held?.text === text) continue;
      posted.add(key);
      notices.getState().banner({ id: key, level: 'warning', text, actions: [], dismissible: true });
    }
    const due = new Set(current.map((b) => b.key));
    for (const key of posted) {
      if (due.has(key) || !onScreen.has(key)) continue;
      withdrawing.add(key);
      notices.getState().dismiss(key);
    }
  };

  const writeDismissed = (next: string[]) => {
    dismissed = next.slice(-MAX_DISMISSED);
    void client.invoke('layout.set', { key: 'usage.banners', value: dismissed }).then((result) => {
      if (!result.ok) console.error('[usage] layout.set usage.banners failed', result.error);
    });
  };

  // Recorded at the window's latest reading when it has drifted from its key, so a reload before the next reading finds it.
  const recordDismissal = (key: string) => {
    if (dismissed === null) return;
    const at = lastSeen.get(key);
    const anchored = at !== undefined && Math.abs(at - keyTime(key)) > SAME_WINDOW_MS / 2 ? reanchored(key, at) : key;
    if (dismissed.includes(anchored)) return;
    if (at !== undefined) lastSeen.set(anchored, at);
    writeDismissed([...dismissed, anchored]);
  };

  const offNotices = notices.subscribe((state, before) => {
    if (state.notices === before.notices) return;
    const now = new Set(state.notices.map((n) => n.id));
    for (const n of before.notices) {
      if (now.has(n.id) || !posted.has(n.id)) continue;
      if (withdrawing.delete(n.id)) continue;
      recordDismissal(n.id);
    }
  });
  const offUsage = usage.subscribe((state, before) => state.snapshot !== before.snapshot && evaluate());
  const offSettings = settings.subscribe((state, before) => state.state !== before.state && evaluate());
  const timer = setInterval(evaluate, REFRESH_MS);

  void client.invoke('layout.get', { key: 'usage.banners' }).then((result) => {
    if (!live) return;
    const parsed = result.ok ? UsageBannersSchema.safeParse(result.value.value ?? []) : null;
    if (!result.ok) console.warn('[usage] layout.get usage.banners failed; no banner was dismissed before', result.error);
    else if (!parsed?.success) console.warn('[usage] usage.banners is not a list of keys; starting empty');
    dismissed = parsed?.success ? parsed.data : [];
    evaluate();
  });

  return () => {
    live = false;
    clearInterval(timer);
    offNotices();
    offUsage();
    offSettings();
  };
}
