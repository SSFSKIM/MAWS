// The near-limit banner (§5.5 "once per window, not above every composer"; C7 execution document, "Status line
// popovers and usage"): every account window at or over the threshold whose reset is still ahead is posted once, in
// C5's banner host, keyed by (account, window, reset time); a key the owner dismissed is written to the layout key
// `usage.banners` and never posted again, across every composer and across reloads.
import type { MawsBridge } from '@shared/ipc/schema';
import { UsageBannersSchema } from '@shared/ipc/schema/layout';
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
}

// ClaudeUsage records a window's `resetsAt` from the rate-limit headers, which move by a second between readings
// (`07:49:59Z`, then `07:50:00Z`); the key rounds it to the minute so one window keeps one key.
export function bannerKey(accountUuid: string, limitKey: string, resetsAt: string): string {
  const minute = new Date(Math.round(Date.parse(resetsAt) / 60_000) * 60_000).toISOString().replace('.000Z', 'Z');
  return `usage:${accountUuid}:${limitKey}:${minute}`;
}

// C11's `settings.usage.nearLimitPercent` (50–100) once C11 lands it; 90 until then. `settings` is SettingsState's
// `settings` member (the persisted settings), not the state around it.
export function thresholdFrom(settings: unknown): number {
  const percent = (settings as { usage?: { nearLimitPercent?: unknown } } | null)?.usage?.nearLimitPercent;
  return typeof percent === 'number' && percent >= 50 && percent <= 100 ? percent : DEFAULT_NEAR_LIMIT_PERCENT;
}

// Every banner the snapshot warrants at `now`, less the `dismissed` keys. Pure.
export function nearLimitBanners(snapshot: UsageSnapshot, dismissed: Iterable<string>, opts: { thresholdPercent?: number; now?: number } = {}): NearLimitBanner[] {
  if (!snapshot.available) return [];
  const threshold = opts.thresholdPercent ?? DEFAULT_NEAR_LIMIT_PERCENT;
  const now = opts.now ?? Date.now();
  const skip = new Set(dismissed);
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
      const key = bannerKey(account.uuid, limitKey, window.resetsAt);
      if (skip.has(key)) continue;
      banners.push({ key, text: `${label} window at ${Math.round(window.percent)}% for ${account.email} · resets in ${resetsIn(left)}` });
    }
  }
  return banners;
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
  let live = true;

  const shown = () => new Set(notices.getState().notices.map((n) => n.id));

  const evaluate = () => {
    const snapshot = usage.getState().snapshot;
    if (!live || dismissed === null || !snapshot) return;
    const current = nearLimitBanners(snapshot, dismissed, { thresholdPercent: thresholdFrom(settings.getState().state?.settings ?? null), now: Date.now() });
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

  const recordDismissal = (key: string) => {
    if (dismissed === null || dismissed.includes(key)) return;
    dismissed = [...dismissed, key].slice(-MAX_DISMISSED);
    void client.invoke('layout.set', { key: 'usage.banners', value: dismissed }).then((result) => {
      if (!result.ok) console.error('[usage] layout.set usage.banners failed', result.error);
    });
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
