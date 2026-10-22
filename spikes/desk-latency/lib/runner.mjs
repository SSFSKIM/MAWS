// The loop every load runs in, and the helpers a load's repetition is written with. A repetition takes a start mark
// (the input event the app acts on, in the page), arms the visible effects it waits for, acts through Playwright, and
// reads each effect's paint; every mark is turned into ms from the start and into wall-clock time (the page's
// performance.timeOrigin plus the mark), so the joiner can line it up with the machine's log. The desk's own raw
// samples (`window.deskLatency.samples`) taken during the repetition come along where the page has them.
//
// Runs inside playwright-cli's run-code sandbox: no require, no console, no performance; Date, timers, URL and fetch only.
export async function runHarness(page, config, loads, classify, surface = null) {
  const out = {
    harness: 'desk-latency',
    version: 1,
    target: config.target,
    load: config.load,
    variant: config.variant ?? null,
    config: { ...config, prompts: undefined },
    started: new Date().toISOString(),
    url: page.url(),
    reps: [],
    notes: [],
  };
  const load = loads[config.load];
  if (!load) throw new Error(`no load "${config.load}" for ${config.target}; loads: ${Object.keys(loads).join(', ')}`);
  const net = config.net === false ? null : await startNet(page, classify, { streams: config.streamUrls ? new RegExp(config.streamUrls) : undefined });
  const ctx = makeContext(page, config, net, out);
  ctx.S = surface;
  const reps = config.reps ?? load.reps ?? 20;
  try {
    // A hidden page (another tab in front, a locked screen or a sleeping display) paints nothing: every mark would time out.
    if ((await page.evaluate(() => document.visibilityState)) === 'hidden') throw new Error('the page is hidden (another tab in front, a locked screen, a sleeping display): nothing paints, so no load runs');
    await ctx.probe();
    if (load.setup) await load.setup(ctx);
    let failed = 0;
    for (let i = 0; i < reps; i++) {
      const rep = { rep: i, at: new Date().toISOString() };
      const t0 = Date.now();
      try {
        Object.assign(rep, await load.rep(ctx, i));
      } catch (error) {
        rep.ok = false;
        rep.error = String(error?.message ?? error).slice(0, 2000);
      }
      rep.wallMs = Date.now() - t0;
      out.reps.push(rep);
      failed = rep.ok === false ? failed + 1 : 0;
      if (failed >= (config.maxFailures ?? 3)) {
        out.notes.push(`stopped after ${failed} failed repetitions in a row`);
        break;
      }
      if (i < reps - 1 && (config.pauseMs ?? load.pauseMs)) await sleep(config.pauseMs ?? load.pauseMs);
    }
  } catch (error) {
    out.error = String(error?.stack ?? error).slice(0, 4000);
  } finally {
    try {
      if (load.teardown) await load.teardown(ctx);
    } catch (error) {
      out.notes.push(`teardown: ${String(error?.message ?? error)}`);
    }
    if (net) {
      out.net = net.summary();
      await net.stop();
    }
  }
  out.ended = new Date().toISOString();
  out.summary = summarize(out.reps);
  return out;
}

export function makeContext(page, config, net, out) {
  const probeIn = async () => page.evaluate(deskLatProbe);
  const ctx = {
    page,
    config,
    net,
    note: (text) => out.notes.push(text),
    sleep,
    /** Installs the probe in the page as it is now (after a navigation, again). */
    async probe() {
      return probeIn();
    },
    /** The page's clock now (performance.now()) and its origin, to turn marks into wall time. */
    async clock() {
      return page.evaluate(() => ({ now: performance.now(), origin: performance.timeOrigin }));
    },
    /** Arms each named spec in the page: { name: spec }. */
    async arm(specs) {
      const names = Object.keys(specs);
      const ids = await page.evaluate((list) => list.map((spec) => window.__deskLat.arm(spec)), names.map((n) => specs[n]));
      return Object.fromEntries(names.map((n, i) => [n, ids[i]]));
    },
    /**
     * Waits until each of `need` (names of `armed`, all by default) has painted, and `done(marks)` (when given: what else
     * ends the wait, a frame or a sample, polled each round and maybe async) is true, or `timeoutMs` passed; then returns
     * every armed mark: { seen, paint, already, error } on the page's clock (null where it never came).
     */
    async wait(armed, { need, timeoutMs, done } = {}) {
      const names = Object.keys(armed);
      const required = need ?? names;
      const limit = Date.now() + (timeoutMs ?? config.timeoutMs ?? 60_000);
      let marks;
      for (;;) {
        const read = await page.evaluate((ids) => window.__deskLat?.read(ids) ?? null, names.map((n) => armed[n]));
        if (read === null) throw new Error('the probe is gone from the page (it navigated): arm again after a navigation');
        marks = Object.fromEntries(names.map((n, i) => [n, read[i]]));
        if (required.every((n) => marks[n]?.paint != null) && (!done || (await done(marks)))) break;
        if (Date.now() > limit) break;
        await sleep(config.pollMs ?? 50);
      }
      await page.evaluate((ids) => window.__deskLat?.drop(ids), names.map((n) => armed[n])).catch(() => null);
      return marks;
    },
    /**
     * Does `act` (a Playwright action) and returns its start mark: the first input of `type` the page saw from just
     * before the action on ('click', 'keydown', 'pointerdown', 'visibility:visible', 'online'), on the page's clock.
     */
    async act(type, act) {
      const before = await page.evaluate(() => performance.now());
      await act();
      let input = null;
      for (let i = 0; i < 40 && !input; i++) {
        const seen = await page.evaluate((t) => window.__deskLat?.inputs(t) ?? [], before);
        input = seen.find((e) => e.type === type) ?? null;
        if (!input) await sleep(25);
      }
      if (!input) throw new Error(`no ${type} reached the page after the action`);
      return { type, t: input.t, trusted: input.trusted };
    },
    /**
     * Clicks, in the page itself (no pointer move, so no hover and no prefetch on it), the first element of a spec — a
     * selector with the `text` it contains or its aria-label, or a `textMatch` — or of `selector` and `text` given apart.
     */
    async domClick(target, text) {
      const spec = typeof target === 'string' ? { selector: target, text: text ?? null } : target;
      const ok = await page.evaluate((s) => {
        const re = s.textMatch != null ? new RegExp(s.textMatch) : null;
        const el = [...document.querySelectorAll(s.selector)].find((e) => {
          const t = (e.textContent || '').trim();
          if (re) return re.test(t);
          return s.text == null || t.includes(s.text) || e.getAttribute('aria-label') === s.text;
        });
        if (!el) return false;
        el.click();
        return true;
      }, { selector: spec.selector, text: spec.text ?? null, textMatch: spec.textMatch ?? null });
      if (!ok) throw new Error(`nothing to click: ${spec.selector}${spec.text ? ` with "${spec.text}"` : ''}${spec.textMatch ? ` matching /${spec.textMatch}/` : ''}`);
    },
    /**
     * Whether `spec` is met now, and what it matches (the probe's `query`). A page between documents (a navigation under
     * way) has no answer yet: not met, and the probe is put back once the new one is in.
     */
    async query(spec) {
      try {
        const answer = await page.evaluate((s) => window.__deskLat?.query(s) ?? null, spec);
        if (answer) return answer;
        await ctx.probe();
      } catch {
        // the document was replaced under the call
      }
      return { met: false, n: 0, text: null, attrs: null };
    },
    /** Waits until `spec` is met — matched, or for a `gone` spec unmatched (or `timeoutMs` passes); true when it was. */
    async until(spec, timeoutMs = 30_000) {
      const limit = Date.now() + timeoutMs;
      for (;;) {
        if ((await ctx.query(spec)).met) return true;
        if (Date.now() > limit) return false;
        await sleep(100);
      }
    },
    /** The desk's raw samples since `sinceWall` (ms since the epoch), or null on a page without them. */
    async deskSamples(sinceWall) {
      return page.evaluate((since) => window.deskLatency?.samples?.(since) ?? null, sinceWall).catch(() => null);
    },
    /**
     * A repetition's result from its start and marks: each mark's ms after the start (paint, and seen), its wall time, and
     * whether it was already met when armed; `ok` when every one of `need` painted.
     */
    result(start, marks, clock, need = Object.keys(marks)) {
      const out = { ok: true, start: start ? { type: start.type, wall: round(clock.origin + start.t), trusted: start.trusted } : null, marks: {} };
      for (const [name, m] of Object.entries(marks)) {
        if (!m) continue;
        const from = start ? start.t : m.armed;
        out.marks[name] = {
          ms: m.paint == null ? null : round(m.paint - from),
          seenMs: m.seen == null ? null : round(m.seen - from),
          wall: m.paint == null ? null : round(clock.origin + m.paint),
          ...(m.already && { already: true }),
          ...(m.error && { error: m.error }),
        };
        if (need.includes(name) && (m.paint == null || m.already)) out.ok = false;
      }
      if (!out.ok) out.missing = need.filter((n) => marks[n]?.paint == null || marks[n]?.already);
      return out;
    },
  };
  return ctx;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function round(ms) {
  return Math.round(ms * 10) / 10;
}

/** Per mark, the n, p50, p95 and max of its ms over the repetitions that measured it. */
export function summarize(reps) {
  const by = {};
  for (const rep of reps) for (const [name, m] of Object.entries(rep.marks ?? {})) if (m.ms != null && !m.already) (by[name] ??= []).push(m.ms);
  return { reps: reps.length, ok: reps.filter((r) => r.ok).length, marks: Object.fromEntries(Object.entries(by).map(([name, v]) => [name, describe(v)])) };
}
