// The clock probe's one-page reading (P5 O17 M8): each variant's results/<variant>.json (probe.cjs) reduced to its rAF
// rate, 16 ms and 100 ms timer rates, click-to-paint median and p95, the page's visibility, the host's visibility as main
// sees it and the supported-API booleans, plus a `verdict` computed mechanically against baseline. The verdict states a
// comparison only; which remedy, if any, enters the product is the human's call.
//
//   node spikes/u3-remote-browser/macos/clock/summarize.mjs <results dir> > <results dir>/summary.json
//
// run.sh calls it after the variants (`pnpm install --frozen-lockfile && bash spikes/u3-remote-browser/macos/clock/run.sh`).
// A measurement, not a gate; no product code imports it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { median, percentile } from '../../lib/stats.mjs';

export const VARIANTS = ['baseline', 'fps30', 'fps60', 'beginframe'];
// a variant qualifies when its click-to-paint median is at least this far below baseline's, its 100 ms timer reaches
// TIMER100_HZ, and it lost no more than MAX_MISSING of its clicks (a median over few landed clicks reads too well)
export const CLICK_GAIN = 0.3;
export const TIMER100_HZ = 9;
export const MAX_MISSING = 0.1;

const round = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);

// callbacks per second over a window of windowMs, and the spacing between them
export function rate(times, windowMs) {
  if (!Array.isArray(times) || !(windowMs > 0)) return { n: 0, hz: null, medianIntervalMs: null, p95IntervalMs: null };
  const sorted = [...times].sort((a, b) => a - b);
  const intervals = sorted.slice(1).map((at, i) => at - sorted[i]);
  return { n: sorted.length, hz: round(sorted.length / (windowMs / 1000)), medianIntervalMs: round(median(intervals)), p95IntervalMs: round(percentile(intervals, 95)) };
}

// clicks: probe.cjs's [{toPaintMs, toHandlerMs}]; a click without a paint showing its colour is missing
export function clickStats(clicks) {
  const list = Array.isArray(clicks) ? clicks : [];
  const landed = list.map((c) => c.toPaintMs).filter((ms) => typeof ms === 'number');
  const handler = list.map((c) => c.toHandlerMs).filter((ms) => typeof ms === 'number');
  return {
    clicks: list.length,
    landed: landed.length,
    missing: list.length - landed.length,
    medianMs: round(median(landed)),
    p95Ms: round(percentile(landed, 95)),
    minMs: landed.length ? Math.min(...landed) : null,
    maxMs: landed.length ? Math.max(...landed) : null,
    toHandlerMedianMs: round(median(handler)),
  };
}

export function summarizeVariant(raw) {
  const clocks = raw.clocks ?? {};
  const windowMs = clocks.windowMs;
  const main = raw.main?.clockWindow ?? {};
  return {
    done: raw.done === true,
    errors: (raw.errors ?? []).map((e) => e.name),
    versions: raw.versions ?? null,
    setup: { frameRate: raw.setup?.frameRate ?? null, frameRateBefore: raw.setup?.frameRateBefore ?? null, frameRateAfter: raw.setup?.frameRateAfter ?? null, invalidateHz: raw.setup?.invalidateHz ?? null },
    rafHz: rate(clocks.raf, windowMs).hz,
    timer16Hz: rate(clocks.t16, windowMs).hz,
    timer100Hz: rate(clocks.t100, windowMs).hz,
    clocks: { requestedMs: clocks.requestedMs ?? null, windowMs: windowMs ?? null, raf: rate(clocks.raf, windowMs), t16: rate(clocks.t16, windowMs), t100: rate(clocks.t100, windowMs) },
    main: { paints: rate(main.paints, main.windowMs), timer100: rate(main.timer100, main.windowMs), invalidates: rate(main.invalidates, main.windowMs), paintImage: raw.main?.paintImage ?? null },
    clickToPaint: clickStats(raw.clicks),
    page: {
      visibilityState: raw.clocks?.before?.visibilityState ?? raw.page?.beforeClocks?.visibilityState ?? null,
      hidden: raw.clocks?.before?.hidden ?? raw.page?.beforeClocks?.hidden ?? null,
      hasFocus: raw.clocks?.before?.hasFocus ?? null,
      size: raw.page?.beforeClocks ? `${raw.page.beforeClocks.innerWidth}x${raw.page.beforeClocks.innerHeight}@${raw.page.beforeClocks.devicePixelRatio}` : null,
      visibilityChanges: raw.page?.afterClicks?.visibilityChanges ?? raw.clocks?.after?.visibilityChanges ?? null,
      clicksTrusted: Array.isArray(raw.page?.afterClicks?.trusted) ? raw.page.afterClicks.trusted.every(Boolean) : null,
    },
    host: raw.host?.beforeClocks ?? raw.host?.loaded ?? null,
    hostAfterClicks: raw.host?.afterClicks ?? null,
    supported: raw.supported ?? null,
  };
}

// variants: { name: summarizeVariant(...) }
export function verdict(variants) {
  const rule = `qualifies: click-to-paint median >= ${CLICK_GAIN * 100}% below baseline's, 100 ms timer >= ${TIMER100_HZ} Hz, <= ${MAX_MISSING * 100}% of clicks missing`;
  const base = variants.baseline;
  const baseMedian = base?.clickToPaint?.medianMs ?? null;
  if (baseMedian === null) return { rule, baseline: null, variants: {}, qualifying: [], best: null, reading: 'no baseline click-to-paint median: nothing to compare against' };
  const compared = {};
  for (const [name, v] of Object.entries(variants)) {
    if (name === 'baseline') continue;
    const c = v?.clickToPaint;
    const medianMs = c?.medianMs ?? null;
    const gain = medianMs === null ? null : (baseMedian - medianMs) / baseMedian;
    const missingShare = c && c.clicks > 0 ? c.missing / c.clicks : 1;
    const timer100Hz = v?.timer100Hz ?? null;
    const qualifies = gain !== null && gain >= CLICK_GAIN && timer100Hz !== null && timer100Hz >= TIMER100_HZ && missingShare <= MAX_MISSING;
    compared[name] = { clickMedianMs: medianMs, clickGainPct: round(gain === null ? null : gain * 100), timer100Hz, missing: c?.missing ?? null, qualifies };
  }
  const qualifying = Object.keys(compared).filter((name) => compared[name].qualifies);
  const best = qualifying.length ? qualifying.reduce((a, b) => (compared[b].clickMedianMs < compared[a].clickMedianMs ? b : a)) : null;
  const reading = best
    ? `${best} qualifies (click median ${compared[best].clickMedianMs} ms against baseline ${baseMedian} ms, 100 ms timer ${compared[best].timer100Hz} Hz)${qualifying.length > 1 ? `; also ${qualifying.filter((n) => n !== best).join(', ')}` : ''}`
    : `no variant qualifies; the limit stands (baseline click median ${baseMedian} ms, 100 ms timer ${base.timer100Hz} Hz, rAF ${base.rafHz} Hz)`;
  return { rule, baseline: { clickMedianMs: baseMedian, timer100Hz: base.timer100Hz ?? null, rafHz: base.rafHz ?? null }, variants: compared, qualifying, best, reading };
}

export function summarize(dir) {
  const variants = {};
  for (const name of VARIANTS) {
    const file = join(dir, `${name}.json`);
    if (!existsSync(file)) {
      variants[name] = { missing: true };
      continue;
    }
    try {
      variants[name] = summarizeVariant(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
      variants[name] = { unreadable: error instanceof Error ? error.message : String(error) };
    }
  }
  return { generatedAt: new Date().toISOString(), variants, verdict: verdict(variants) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node summarize.mjs <results dir>');
    process.exit(64);
  }
  process.stdout.write(JSON.stringify(summarize(dir), null, 2) + '\n');
}
