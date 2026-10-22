// The loads, each written once against a surface (surfaces.mjs) so the desk and claude.ai/code run the same steps. A
// load's repetition returns `ctx.result(...)`: its start mark, each visible effect's ms after it, and what else explains
// the time (the frames' hops, the desk's own samples, a cold load's timeline).
//
// Opens (`app`, `project`, `session`) end at "useful": the content drawn and the controls that act on it usable. Each
// runs in a cohort (`config.cohort`):
//   cold       a navigation: the page from nothing (its HTTP cache as it is; `cache: 'off'` bypasses it), timed from the
//              navigation's start; the timeline of its gates comes along (resources, the desk's app.* and view.* marks)
//   warm       an in-app move to it, the app already loaded: a click from where the owner would come from
//   reconnect  in place: the network taken away until the app shows it lost the hub (or `offlineMs` passes), then given
//              back; timed from the browser's `online` until useful again, which a return is only once its content is
//              fresh too (`untilFresh`)
// An action (send, steer, interrupt, permission, question, spawn, resume) runs warm; `cohort: 'reconnect'` makes it
// act the moment the network is back and its control usable again.
const S_TIMEOUT = 60_000;

export function makeLoads(S) {
  /** A token unique to the repetition, which the prompt asks the reply to carry. */
  const token = (i) => `lat${i}${Math.random().toString(36).slice(2, 6)}`;

  async function prompt(ctx, text) {
    const box = ctx.page.locator(S.composer).first();
    await box.click();
    await box.fill(text);
  }

  async function pressEnter(ctx) {
    return ctx.act('keydown', () => ctx.page.locator(S.composer).first().press('Enter'));
  }

  async function click(ctx, spec) {
    return ctx.act('click', () => ctx.domClick(spec));
  }

  async function idleFirst(ctx, session) {
    if (!(await ctx.until(S.idle(session), ctx.config.idleTimeoutMs ?? 120_000))) ctx.note(`rep began with the session still working (${session})`);
  }

  /**
   * The network lost: every socket the page holds closed and new connections failing (Chrome's offline emulation alone
   * leaves open sockets open), until the app shows it lost the hub or `offlineMs` passes; then `back()` gives the
   * network back, its start mark the browser's `online`.
   */
  async function dropAndReturn(ctx, down) {
    const { page, config } = ctx;
    const closed = await page.evaluate(() => window.__deskLat.dropSockets());
    if (closed === 0) ctx.note('no socket to close: the probe came after the page opened its sockets (open the page with navigate())');
    await page.context().setOffline(true);
    const shown = down ? await ctx.until(down, config.offlineMs ?? 10_000) : (await ctx.sleep(config.offlineMs ?? 10_000), false);
    if (shown && config.downMs) await ctx.sleep(config.downMs); // held down a while longer, as a longer outage would be
    return {
      shown,
      closed,
      back: async () => ctx.act('online', () => page.context().setOffline(false)),
    };
  }

  /** Opens `url` with the probe in before the page's own code, so its sockets are known (a reconnect can close them). */
  async function navigate(ctx, url) {
    const init = await ctx.page.addInitScript(deskLatProbe);
    try {
      await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: S_TIMEOUT });
    } finally {
      await init?.dispose?.().catch?.(() => null);
    }
    await ctx.probe();
  }

  /** The desk's raw samples and the frames' hops since `startWall` (in `session`, where frames name one), joined to a result. */
  async function extras(ctx, result, kind, startWall, session = ctx.config.session) {
    if (startWall == null) return result;
    const samples = await ctx.deskSamples(startWall - 1);
    if (samples) result.inApp = samples;
    const hops = S.hops(ctx.net, startWall - 5, kind, session);
    if (hops) {
      result.net = msFrom(hops.times, startWall);
      result.ids = hops.ids;
    }
    return result;
  }

  /** A cold open: the navigation to `url`, the specs armed by the init script before any of the page's own code runs. */
  async function coldOpen(ctx, url, specs, need, session) {
    const { page, config } = ctx;
    const names = Object.keys(specs);
    // The specs go over the origin's sessionStorage: be on that origin first.
    if (new URL(page.url()).origin !== new URL(url).origin) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: S_TIMEOUT });
    await page.evaluate((list) => sessionStorage.setItem('deskLat.cold', JSON.stringify(list)), names.map((n) => specs[n]));
    let cdp = null;
    if (config.cache === 'off') {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    }
    const init = await page.addInitScript(deskLatProbe);
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: S_TIMEOUT });
      let ids = null;
      for (let i = 0; i < 400 && !ids; i++) {
        ids = await page.evaluate(() => window.__deskLat?.coldIds ?? null).catch(() => null);
        if (!ids) await ctx.sleep(25);
      }
      if (!ids) throw new Error('the init script armed nothing before the page ran: addInitScript refused here? (README: calibration)');
      const armed = Object.fromEntries(names.map((n, i) => [n, ids[i]]));
      const marks = await ctx.wait(armed, { need, timeoutMs: config.timeoutMs ?? S_TIMEOUT });
      const clock = await ctx.clock();
      const result = ctx.result({ type: 'navigation', t: 0, trusted: true }, marks, clock, need);
      result.nav = await page.evaluate(navTiming).catch(() => null);
      const samples = await ctx.deskSamples(0);
      if (samples) {
        result.inApp = samples;
        result.timeline = coldTimeline(samples, clock.origin);
      }
      const hops = S.hops(ctx.net, clock.origin - 5, 'open', session);
      if (hops) {
        result.net = msFrom(hops.times, clock.origin);
        result.ids = hops.ids;
      }
      return result;
    } finally {
      await init?.dispose?.().catch?.(() => null);
      if (cdp) {
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => null);
        await cdp.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => null);
        await cdp.detach().catch(() => null);
      }
    }
  }

  /** A warm open: an in-app click (no pointer move, no hover prefetch) on `target`, until the specs paint. */
  async function warmOpen(ctx, target, specs, need, session) {
    const armed = await ctx.arm(specs);
    const clock = await ctx.clock();
    const start = await click(ctx, target);
    const marks = await ctx.wait(armed, { need });
    return extras(ctx, ctx.result(start, marks, clock, need), 'open', clock.origin + start.t, session);
  }

  /**
   * A reconnect: the drop shown, then the network back, until the specs paint again and the view is fresh. Its `useful`
   * is the later of the DOM's (kept as `controls`) and the proof of fresh content (`fresh`).
   */
  async function reconnectOpen(ctx, view, need, session) {
    const drop = await dropAndReturn(ctx, view.down);
    const specs = { useful: view.useful, content: view.content, ...(ctx.config.busy && { current: S.changed }) };
    const armed = await ctx.arm(specs);
    const clock = await ctx.clock();
    const start = await drop.back();
    const startWall = clock.origin + start.t;
    const { marks, freshWall } = await untilFresh(ctx, view, armed, need, startWall);
    const result = ctx.result(start, freshEnd(marks, 'useful', 'controls', freshWall, clock), clock, need);
    result.dropShown = drop.shown;
    result.socketsClosed = drop.closed;
    if (!drop.shown) ctx.note('the app did not show the drop before the network came back');
    return extras(ctx, result, 'open', startWall, session);
  }

  /**
   * Waits for `armed` as `ctx.wait` does, and for the surface's proof that the view's content is fresh after
   * `startWall` (`S.freshAt`: the desk's own sample of the return, claude.ai/code's frames). A drop leaves the old rows
   * and tiles in place and a socket shows open before its backlog is in, so the DOM alone is met on stale content.
   */
  async function untilFresh(ctx, view, armed, need, startWall) {
    let freshWall = null;
    const marks = await ctx.wait(armed, { need, done: async () => (freshWall ??= await S.freshAt(ctx, view.fresh, startWall)) !== null });
    return { marks, freshWall };
  }

  /**
   * `marks` with its mark `name` made to need fresh content too: the DOM's mark kept as `dom`, the proof of fresh
   * content at `freshWall` (wall ms) as `fresh`, and `name` the later of the two (missing while either is).
   */
  function freshEnd(marks, name, dom, freshWall, clock) {
    const shown = marks[name];
    const fresh = { armed: shown.armed, seen: null, paint: null, already: false, error: null };
    if (freshWall !== null) fresh.seen = fresh.paint = freshWall - clock.origin;
    const end = shown.paint == null || fresh.paint == null ? { ...shown, seen: null, paint: null } : fresh.paint > shown.paint ? fresh : shown;
    return { ...marks, [dom]: shown, fresh, [name]: end };
  }

  /** Runs one open in the configured cohort. `view` is the surface's { content, useful, down, extra, fresh }. */
  async function open(ctx, view, url, warm, i, session = null) {
    const cohort = ctx.config.cohort ?? 'cold';
    const need = ctx.config.need ?? ['useful'];
    const specs = { content: view.content, useful: view.useful, ...view.extra };
    if (cohort === 'cold') return { cohort, ...(await coldOpen(ctx, url, specs, need, session)) };
    if (cohort === 'warm') {
      await warm.before(ctx, i);
      return { cohort, ...(await warmOpen(ctx, warm.target(i), specs, need, session)) };
    }
    if (cohort === 'reconnect') return { cohort, ...(await reconnectOpen(ctx, view, need, session)) };
    throw new Error(`no cohort "${cohort}" (cold, warm or reconnect)`);
  }

  /**
   * Before a reconnect-cohort action: the drop, then the network back (`online`, its start), and a wait until the
   * action's control is usable again (`ready`: a disabled button takes no click), so the action is taken the moment it
   * can be. `readyMs` is from the network back until then (0 when the control stayed usable; null with no control to
   * wait for, or one that never came back).
   */
  async function maybeDrop(ctx, down, ready) {
    if (ctx.config.cohort !== 'reconnect') return null;
    const drop = await dropAndReturn(ctx, down);
    const armed = ready ? await ctx.arm({ ready }) : null;
    const clock = await ctx.clock();
    const online = await drop.back();
    const at = armed ? (await ctx.wait(armed, { timeoutMs: ctx.config.timeoutMs ?? S_TIMEOUT })).ready?.paint : null;
    return { shown: drop.shown, online: round(clock.origin + online.t), readyMs: at == null ? null : round(Math.max(0, at - online.t)) };
  }

  /** An action's result with its reconnect: whether the drop showed, the network back, and `actionable` (ms after it). */
  function withDrop(result, drop) {
    if (!drop) return result;
    const actionable = drop.readyMs === null ? {} : { actionable: { ms: drop.readyMs, wall: round(drop.online + drop.readyMs), from: 'online' } };
    return { ...result, dropShown: drop.shown, online: drop.online, marks: { ...result.marks, ...actionable } };
  }

  const sessionOf = (ctx) => {
    if (!ctx.config.session) throw new Error('this load needs config.session');
    return ctx.config.session;
  };

  const loads = {
    app: {
      reps: 30,
      pauseMs: 1000,
      async setup(ctx) {
        if (ctx.config.cohort === 'warm' && !S.toApp) throw new Error(`${S.name} has no in-app way home to time warm`);
        if (ctx.config.cohort === 'reconnect') {
          await navigate(ctx, S.urls.app);
          if (!(await ctx.until(S.app.useful, 60_000))) throw new Error('the app never became useful');
        }
      },
      rep: (ctx, i) =>
        open(ctx, S.app, S.urls.app, {
          before: async (c) => {
            // From a project back to the grid: open the project first.
            if (!(await c.until(S.toProject, 15_000))) {
              await navigate(c, S.urls.app);
              await c.until(S.toProject, 30_000);
            }
            await c.domClick(S.toProject);
            await c.until(S.project.content, 30_000);
          },
          target: () => S.toApp,
        }, i),
    },

    project: {
      reps: 30,
      pauseMs: 1500, // past the 1 s a left project's connection lingers: each warm open starts its socket again
      async setup(ctx) {
        if (!S.project) throw new Error(`${S.name} has no project view`);
        if (ctx.config.cohort !== 'cold') {
          await navigate(ctx, S.urls.project);
          if (!(await ctx.until(S.project.useful, 60_000))) throw new Error('the project never became useful');
        }
      },
      rep: (ctx, i) =>
        open(ctx, S.project, S.urls.project, {
          before: async (c) => {
            await c.domClick(S.toApp);
            await c.until(S.app.useful, 30_000);
            await c.sleep(c.config.lingerMs ?? 1500);
          },
          target: () => S.toProject,
        }, i),
    },

    session: {
      reps: 30,
      pauseMs: 1000,
      async setup(ctx) {
        const cohort = ctx.config.cohort ?? 'cold';
        const others = ctx.config.sessions ?? [];
        if (cohort === 'warm' && others.length < 2) throw new Error('warm sessions need config.sessions: two or more sessions to switch between');
        if (cohort !== 'cold') {
          const first = cohort === 'warm' ? others[0] : sessionOf(ctx);
          await navigate(ctx, S.urls.session(first));
          if (!(await ctx.until(S.session(first, ctx.config.variant).useful, 60_000))) throw new Error(`session ${first} never became useful`);
          // Warm every one of them: each opened once before the timed switches.
          if (cohort === 'warm')
            for (const s of others.slice(1)) {
              await ctx.domClick(S.toSession(s));
              await ctx.until(S.session(s, ctx.config.variant).useful, 60_000);
            }
        }
      },
      rep: (ctx, i) => {
        const cohort = ctx.config.cohort ?? 'cold';
        const sessions = ctx.config.sessions ?? [];
        // Setup left the last of them open: each switch is to another, already opened once.
        const target = cohort === 'warm' ? sessions[i % sessions.length] : sessionOf(ctx);
        const view = S.session(target, ctx.config.variant, cohort);
        return open(ctx, view, S.urls.session(target), { before: async () => {}, target: () => S.toSession(target) }, i, target).then((r) => ({ session: target, ...r }));
      },
    },

    'older-page': {
      reps: 10,
      pauseMs: 500,
      async setup(ctx) {
        await navigate(ctx, S.urls.session(sessionOf(ctx)));
        if (!(await ctx.until(S.session(sessionOf(ctx)).content, 60_000))) throw new Error('the session drew no rows');
        await ctx.sleep(1000);
      },
      async rep(ctx) {
        // The reader's wheel, up to the top (a list that follows its tail takes a scroll set from script back down): again
        // if the list put the reader back while it settled its rows' heights; the last wheel that reached the top starts it.
        const box = await ctx.page.locator(S.scroller.selector).first().boundingBox();
        if (!box) throw new Error('no transcript scroller');
        await ctx.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const armed = await ctx.arm({ grew: { ...S.scroller, grows: true } });
        const clock = await ctx.clock();
        const where = () => ctx.page.evaluate((s) => ({ top: document.querySelector(s)?.scrollTop ?? 0, height: document.querySelector(s)?.scrollHeight ?? 0 }), S.scroller.selector);
        const before = await where();
        let start = null;
        for (let tries = 0; tries < 5; tries++) {
          start = await ctx.act('wheel', () => ctx.page.mouse.wheel(0, -1e6));
          await ctx.sleep(200);
          const now = await where();
          if (now.top <= 100 || now.height > before.height) break; // at the top, or the page already in (its rows keep the reader's place)
        }
        const marks = await ctx.wait(armed, { timeoutMs: ctx.config.timeoutMs ?? 15_000 });
        return extras(ctx, ctx.result(start, marks, clock), 'older', clock.origin + start.t);
      },
    },

    send: {
      reps: 20,
      pauseMs: 1000,
      async setup(ctx) {
        await openForAction(ctx);
      },
      async rep(ctx, i) {
        const session = sessionOf(ctx);
        await idleFirst(ctx, session);
        const tk = token(i);
        await prompt(ctx, (ctx.config.prompt ?? 'Reply with exactly {token} and nothing else.').replaceAll('{token}', tk));
        const drop = await maybeDrop(ctx, S.session(session).down, S.sendReady);
        const specs = { echo: S.echo(tk), row: S.row(tk), firstToken: S.firstToken, ...(S.firstActivity && { firstActivity: S.firstActivity }), reply: S.reply(tk), ...(S.delivered && { delivered: S.delivered(tk) }) };
        const armed = await ctx.arm(specs);
        const clock = await ctx.clock();
        const start = await pressEnter(ctx);
        const need = ctx.config.need ?? ['echo', 'reply'];
        const marks = await ctx.wait(armed, { need });
        const result = await extras(ctx, ctx.result(start, marks, clock, need), 'send', clock.origin + start.t);
        return { token: tk, ...withDrop(result, drop) };
      },
    },

    steer: {
      reps: 15,
      pauseMs: 1000,
      async setup(ctx) {
        await openForAction(ctx);
      },
      async rep(ctx, i) {
        const session = sessionOf(ctx);
        await idleFirst(ctx, session);
        const tk = token(i);
        await longTurn(ctx, tk);
        await prompt(ctx, `steer ${tk}: when the sleep ends, reply with exactly ${tk}-steered instead.`);
        // Both apps echo a steer at once; `steered` is it delivered: on the desk its row in the transcript, which the
        // session's bridge appended (a machine round trip), on claude.ai/code its row read (calibrate), or else the frame
        // of the steer consumed (`net.consumed`). The wait ends at the delivery, whichever shows it first, not the echo.
        const armed = await ctx.arm({ echo: S.echo(`steer ${tk}`), steered: S.steered(`steer ${tk}`) });
        const clock = await ctx.clock();
        const start = await pressEnter(ctx);
        const startWall = clock.origin + start.t;
        const need = ctx.config.need ?? (S.name === 'desk' ? ['echo', 'steered'] : ['echo']);
        const delivered = (marks) => marks.steered?.paint != null || S.hops(ctx.net, startWall - 5, 'steer')?.times.consumed != null;
        const marks = await ctx.wait(armed, { need, done: delivered });
        const result = await extras(ctx, ctx.result(start, marks, clock, need), 'steer', startWall);
        await idleFirst(ctx, session);
        return { token: tk, ...result };
      },
    },

    interrupt: {
      reps: 20,
      pauseMs: 1000,
      async setup(ctx) {
        await openForAction(ctx);
      },
      async rep(ctx, i) {
        const session = sessionOf(ctx);
        await idleFirst(ctx, session);
        const tk = token(i);
        await longTurn(ctx, tk);
        const drop = await maybeDrop(ctx, S.session(session).down, S.stopReady);
        const armed = await ctx.arm({ stopped: S.stopped, idle: S.idle(session) });
        const clock = await ctx.clock();
        const start = await click(ctx, S.stop);
        const need = ctx.config.need ?? ['stopped'];
        const marks = await ctx.wait(armed, { need });
        const result = await extras(ctx, ctx.result(start, marks, clock, need), 'rpc', clock.origin + start.t);
        return { token: tk, ...withDrop(result, drop) };
      },
    },

    permission: {
      reps: 20,
      pauseMs: 1000,
      async setup(ctx) {
        await openForAction(ctx);
      },
      async rep(ctx, i) {
        const session = sessionOf(ctx);
        await idleFirst(ctx, session);
        const tk = token(i);
        const card = await raiseCard(ctx, S.card, (ctx.config.prompt ?? 'Run the Bash command `touch /tmp/desk-lat/{token}`, then reply with exactly {token}-done.').replaceAll('{token}', tk));
        if (!card.ok) return { token: tk, phase: 'raise', ...card };
        const clock = await ctx.clock();
        const id = S.cardId((await ctx.query({ ...S.card, fresh: false, last: true })).attrs);
        await ctx.sleep(ctx.config.cardDwellMs ?? 450); // past claude.ai's 400 ms guard on a card's first moments (P:371), on both sides
        // The decision: its click until the card is gone, and until the turn ends.
        const deny = ctx.config.decision === 'deny' || (ctx.config.decision === 'alternate' && i % 2 === 1);
        const armed = await ctx.arm({ gone: S.cardGone(id), idle: S.idle(session) });
        const start = await click(ctx, deny ? S.deny(id) : S.allow(id));
        const need = ctx.config.need ?? ['gone'];
        const marks = await ctx.wait(armed, { need });
        const decided = await extras(ctx, ctx.result(start, marks, clock, need), 'rpc', clock.origin + start.t);
        return {
          token: tk,
          request: id,
          decision: deny ? 'deny' : 'allow',
          ok: decided.ok,
          start: decided.start,
          marks: { ...(card.marks.card && { 'raise.card': card.marks.card }), ...prefixed('decide', decided.marks) },
          raise: raiseHops(ctx, card.start),
          ...(decided.missing && { missing: decided.missing }),
          inApp: decided.inApp,
          net: decided.net,
          ids: decided.ids,
        };
      },
    },

    question: {
      reps: 20,
      pauseMs: 1000,
      async setup(ctx) {
        await openForAction(ctx);
      },
      async rep(ctx, i) {
        const session = sessionOf(ctx);
        await idleFirst(ctx, session);
        const tk = token(i);
        const label = ctx.config.option ?? 'red';
        const cardSpec = S.questionCard ? S.questionCard(label) : S.card;
        const card = await raiseCard(ctx, cardSpec, (ctx.config.prompt ?? 'Use the AskUserQuestion tool to ask me one question, "Which colour for {token}?", with the two options red and blue. Then reply with exactly {token}- followed by my answer.').replaceAll('{token}', tk));
        if (!card.ok) return { token: tk, phase: 'raise', ...card };
        const clock = await ctx.clock();
        const id = S.cardId((await ctx.query({ ...S.card, fresh: false, last: true })).attrs);
        await ctx.sleep(ctx.config.cardDwellMs ?? 450);
        const opt = S.option(id, label);
        await ctx.domClick(opt);
        const gone = S.questionGone ? S.questionGone(label) : S.cardGone(id);
        const armed = await ctx.arm({ gone, reply: S.reply(`${tk}-${label}`) });
        const start = await click(ctx, S.submit(id));
        const need = ctx.config.need ?? ['gone'];
        const marks = await ctx.wait(armed, { need });
        const answered = await extras(ctx, ctx.result(start, marks, clock, need), 'rpc', clock.origin + start.t);
        return { token: tk, request: id, ok: answered.ok, start: answered.start, marks: { ...(card.marks.card && { 'raise.card': card.marks.card }), ...prefixed('answer', answered.marks) }, raise: raiseHops(ctx, card.start), ...(answered.missing && { missing: answered.missing }), inApp: answered.inApp, net: answered.net, ids: answered.ids };
      },
    },

    wake: {
      reps: 10,
      pauseMs: 2000,
      async setup(ctx) {
        await openForAction(ctx);
      },
      async rep(ctx) {
        const session = sessionOf(ctx);
        const view = S.session(session, ctx.config.variant);
        // Hidden behind another tab of the same window, as the owner leaves it; the session goes on working meanwhile.
        // Every mark waits for the page shown again and takes the page as it is then: a change while hidden is not
        // `current`, and controls usable as it is shown are `useful` at that moment. `down` is the app showing the hub
        // lost once it is shown: a wake that needs a reconnect.
        const armed = await ctx.arm({ current: { ...S.changed, afterVisible: true }, useful: { ...view.useful, afterVisible: true }, down: { ...view.down, afterVisible: true } });
        const clock = await ctx.clock();
        let other;
        try {
          other = await ctx.page.context().newPage();
        } catch (error) {
          throw new Error(`no second tab could be opened here (${String(error?.message ?? error)}): wake by hand (README, the owner's hands)`);
        }
        await other.goto('about:blank').catch(() => null);
        await ctx.sleep(ctx.config.hiddenMs ?? 30_000);
        let start;
        try {
          start = await ctx.act('visibility:visible', async () => {
            await ctx.page.bringToFront();
            await other.close();
          });
        } catch {
          throw new Error('the page never went hidden and back (a headless browser keeps every tab visible): wake runs in a headed browser, or by hand');
        }
        const need = ctx.config.need ?? ['current', 'useful'];
        // A wake that needed a reconnect is current only once caught up after it (the old rows stay in place until
        // then): once the app has shown the drop, the wait is for that proof too, and `current` is the later of the
        // DOM's change (kept as `changed`) and it. A wake that needed none is taken with the proof if one came.
        const startWall = clock.origin + start.t;
        let freshWall = null;
        const fresh = async () => (freshWall ??= await S.freshAt(ctx, S.wakeFresh, startWall));
        const marks = await ctx.wait(armed, { need, timeoutMs: ctx.config.timeoutMs ?? 30_000, done: async (m) => m.down?.paint == null || (await fresh()) !== null });
        await fresh();
        const final = freshWall === null && marks.down?.paint == null ? marks : freshEnd(marks, 'current', 'changed', freshWall, clock);
        return extras(ctx, ctx.result(start, final, clock, need), 'open', startWall);
      },
    },

    spawn: {
      reps: 10,
      pauseMs: 2000,
      async setup(ctx) {
        if (S.name === 'desk') {
          await navigate(ctx, S.urls.project);
          if (!(await ctx.until(S.project.useful, 60_000))) throw new Error('the project never became useful');
        } else if (!ctx.config.environment) throw new Error('an RC spawn needs config.environment (the bridge environment id)');
      },
      rep: (ctx, i) => (S.name === 'desk' ? deskSpawn(ctx, i) : rcSpawn(ctx, i)),
    },

    resume: {
      reps: 5,
      pauseMs: 2000,
      async setup(ctx) {
        if (S.name !== 'desk') throw new Error('claude.ai/code offers no Resume of a Remote Control session from the web (README)');
        if (!(ctx.config.sessions ?? []).length) throw new Error('resume needs config.sessions: ended sessions, one per repetition');
      },
      async rep(ctx, i) {
        const session = ctx.config.sessions[i % ctx.config.sessions.length];
        await navigate(ctx, S.urls.session(session));
        if (!(await ctx.until(S.session(session, 'ended').useful, 60_000))) throw new Error(`${session} shows no Resume (not ended, or retired)`);
        // Live again: listed among the live sessions, its header offering Retire where it offered Resume.
        const armed = await ctx.arm({
          rpc: { selector: DESK.headerRpcDone },
          live: { selector: DESK.liveSessionRow(session) },
          useful: { all: [{ selector: DESK.liveSessionRow(session) }, { selector: DESK.headerButton, text: 'Retire' }, { selector: DESK.headerButton, text: 'Resume', gone: true }] },
        });
        const clock = await ctx.clock();
        const start = await click(ctx, { selector: DESK.headerButton, text: 'Resume' });
        const need = ctx.config.need ?? ['useful'];
        const marks = await ctx.wait(armed, { need, timeoutMs: ctx.config.timeoutMs ?? 90_000 });
        return { session, ...(await extras(ctx, ctx.result(start, marks, clock, need), 'rpc', clock.origin + start.t)) };
      },
    },

    watch: {
      reps: 1,
      async rep(ctx) {
        // Passive: every drop the app shows and its return to useful, for `durationMs` — a deploy, a hub stream's recycle,
        // the network — with the desk's samples and the sockets' opens and closes.
        const { config } = ctx;
        const view = config.session ? S.session(config.session, config.variant) : S.app;
        const until = Date.now() + (config.durationMs ?? 15 * 60_000);
        const clock = await ctx.clock();
        const since = clock.origin + clock.now;
        const drops = [];
        while (Date.now() < until) {
          const down = await ctx.arm({ down: view.down });
          const d = await ctx.wait(down, { timeoutMs: until - Date.now() });
          if (d.down?.paint == null) break;
          const up = await ctx.arm({ useful: view.useful });
          const u = await ctx.wait(up, { timeoutMs: Math.max(0, until - Date.now()) + 60_000 });
          drops.push({ down: Math.round(clock.origin + d.down.paint), useful: u.useful?.paint == null ? null : Math.round(clock.origin + u.useful.paint), ms: u.useful?.paint == null ? null : Math.round(u.useful.paint - d.down.paint) });
        }
        const sockets = ctx.net ? ctx.net.since(since).filter((e) => e.dir === 'ws-open' || e.dir === 'ws-close') : null;
        return { ok: true, start: { type: 'watch', wall: Math.round(since) }, marks: {}, drops, sockets, inApp: await ctx.deskSamples(since) };
      },
    },

    'probe-page': {
      reps: 1,
      async rep(ctx) {
        // Calibration: what the page is made of and what it says on the network while the operator works it for
        // `observeMs` — the test ids, roles and labels to write selectors from, and every endpoint and frame type seen.
        const clock = await ctx.clock();
        const since = clock.origin + clock.now;
        await ctx.sleep(ctx.config.observeMs ?? 20_000);
        const dom = await ctx.page.evaluate(outline);
        return { ok: true, start: { type: 'observe', wall: Math.round(since) }, marks: {}, url: ctx.page.url(), dom, net: ctx.net ? ctx.net.summary() : null };
      },
    },
  };

  /**
   * The raise: the prompt's send until its card is drawn (the machine's half, from its tool_use row, is the joiner's).
   * With `raise: false`, the card already pending is taken as it is, untimed (a replayed session's, on the stand-in).
   */
  async function raiseCard(ctx, spec, text) {
    if (ctx.config.raise === false) {
      if (!(await ctx.until({ ...spec, fresh: false }, ctx.config.timeoutMs ?? S_TIMEOUT))) return { ok: false, missing: ['card'], marks: {} };
      return { ok: true, start: { type: 'pending', wall: Date.now() }, marks: {} };
    }
    await prompt(ctx, text);
    const raised = await ctx.arm({ card: spec });
    const clock = await ctx.clock();
    const sent = await pressEnter(ctx);
    const raise = await ctx.wait(raised, { need: ['card'] });
    return ctx.result(sent, raise, clock, ['card']);
  }

  async function openForAction(ctx) {
    const session = sessionOf(ctx);
    await navigate(ctx, S.urls.session(session));
    if (!(await ctx.until(S.session(session).content, 60_000))) throw new Error(`session ${session} drew nothing`);
    if (!(await fullTranscript(ctx, 10_000))) throw new Error('the session view offers no Transcript view');
  }

  /**
   * The desk's session view switched to its whole transcript, where an answer streams visibly as it does on
   * claude.ai/code (its Report view may fold it unseen); false when the view offers none within `timeoutMs`. The
   * choice holds for the session for the page's life.
   */
  async function fullTranscript(ctx, timeoutMs) {
    if (!S.fullView) return true;
    if (!(await ctx.until(S.fullView, timeoutMs))) return false;
    await ctx.domClick(S.fullView);
    if (!(await ctx.until(S.fullViewShown, 5_000))) throw new Error('the session view did not switch to its transcript');
    return true;
  }

  /** Starts a turn that keeps working for `sleepS` seconds (a Bash sleep), and waits until the app shows it running. */
  async function longTurn(ctx, tk) {
    const seconds = ctx.config.sleepS ?? 20;
    await prompt(ctx, (ctx.config.longPrompt ?? 'Run the Bash command `sleep {seconds}`, then reply with exactly {token}-slept.').replaceAll('{token}', tk).replaceAll('{seconds}', String(seconds)));
    await pressEnter(ctx);
    if (!(await ctx.until(S.running, 60_000))) throw new Error('the turn never showed as running');
    await ctx.sleep(ctx.config.settleMs ?? 1500); // into the tool call, past the turn's first moments
  }

  async function deskSpawn(ctx, i) {
    const { page, config } = ctx;
    const tk = token(i);
    await ctx.domClick(DESK.spawnButton, '+ Session');
    if (!(await ctx.until({ selector: DESK.spawnBrief }, 10_000))) throw new Error('no spawn dialog');
    if (config.machine) await page.selectOption(DESK.spawnMachine, config.machine);
    if (config.checkout) await page.selectOption(DESK.spawnCheckout, config.checkout);
    await page.fill(DESK.spawnBrief, (config.prompt ?? 'Reply with exactly {token} and nothing else.').replaceAll('{token}', tk));
    if (config.model) await page.fill(DESK.spawnModel, config.model);
    if (config.mode) await page.selectOption(DESK.spawnMode, config.mode);
    const armed = await ctx.arm({ rpc: { selector: DESK.spawnDone }, listed: { selector: DESK.anySessionRow, fresh: true } });
    const clock = await ctx.clock();
    const start = await click(ctx, { selector: DESK.spawnStart, text: 'Start' });
    const first = await ctx.wait(armed, { need: ['rpc'] });
    let opened = null;
    let session = null;
    if (first.rpc?.paint != null) {
      // "Open it", as the owner would the moment it shows, the view switched to its transcript as soon as it offers it
      // (a session just spawned serves its transcript a moment later): the session's first row and its reply.
      const view = await ctx.arm({ row: { selector: DESK.row, fresh: true }, firstActivity: S.firstActivity, firstToken: S.firstToken, reply: S.reply(tk) });
      await ctx.domClick('[role="dialog"] button', 'Open it');
      if (!(await fullTranscript(ctx, config.timeoutMs ?? 90_000))) ctx.note('the spawned session view never offered its Transcript view');
      opened = await ctx.wait(view, { need: ctx.config.need ?? ['row', 'reply'], timeoutMs: config.timeoutMs ?? 90_000 });
      session = (await ctx.query({ selector: '[data-testid="session-view"]' })).attrs?.['data-session'] ?? null;
    }
    const result = ctx.result(start, { ...first, ...(opened ?? {}) }, clock, ctx.config.need ?? ['rpc', 'row', 'reply']);
    const out = await extras(ctx, result, 'rpc', clock.origin + start.t, session);
    if (config.retire !== false && session) await retireOpen(ctx);
    if (first.rpc?.paint == null) await ctx.page.keyboard.press('Escape').catch(() => null);
    return { token: tk, session, ...out };
  }

  async function retireOpen(ctx) {
    try {
      await ctx.domClick(DESK.headerButton, 'Retire…');
      await ctx.until({ selector: DESK.headerButton, text: 'Retire' }, 5_000);
      await ctx.domClick(`${DESK.headerButton}.text-danger`, 'Retire');
      await ctx.until({ selector: '[data-testid="retired-by"]' }, 30_000);
    } catch (error) {
      ctx.note(`retire after spawn: ${String(error?.message ?? error)}`);
    }
  }

  async function rcSpawn(ctx, i) {
    const { page, config } = ctx;
    const tk = token(i);
    await navigate(ctx, `${S.base}${RC.newSessionUrl(config.environment)}`);
    if (!(await ctx.until(RC.composer, 30_000))) throw new Error('no composer on the new-session view');
    await prompt(ctx, (config.prompt ?? 'Reply with exactly {token} and nothing else.').replaceAll('{token}', tk));
    const armed = await ctx.arm({ echo: S.echo(tk), firstToken: S.firstToken, reply: S.reply(tk) });
    const clock = await ctx.clock();
    const start = await pressEnter(ctx);
    const need = ctx.config.need ?? ['reply'];
    const marks = await ctx.wait(armed, { need, timeoutMs: config.timeoutMs ?? 90_000 });
    const result = await extras(ctx, ctx.result(start, marks, clock, need), 'send', clock.origin + start.t);
    return { token: tk, url: page.url(), ...result };
  }

  return loads;
}

/** The raise's frames, from the send that asked for it: when the request reached the page. */
function raiseHops(ctx, start) {
  const hops = ctx.S?.hops?.(ctx.net, start.wall - 5, 'raise', ctx.config.session) ?? null;
  return hops ? { start, net: msFrom(hops.times, start.wall), ids: hops.ids } : { start };
}

/** Wall times as ms after `from` (null stays null). */
function msFrom(times, from) {
  return Object.fromEntries(Object.entries(times).map(([k, v]) => [k, v === null ? null : Math.round((v - from) * 10) / 10]));
}

function prefixed(prefix, marks) {
  return Object.fromEntries(Object.entries(marks).map(([k, v]) => [`${prefix}.${k}`, v]));
}

/** The navigation's own timing and the resources it fetched, in ms from its start (run in the page). */
export function navTiming() {
  const r = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);
  const n = performance.getEntriesByType('navigation')[0];
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, r(p.startTime)]));
  const resources = performance
    .getEntriesByType('resource')
    .filter((e) => /\/api\/|\/v1\/|\.js(\?|$)|\.css(\?|$)/.test(e.name))
    .slice(0, 60)
    .map((e) => {
      let name = e.name;
      try {
        name = new URL(e.name).pathname;
      } catch {
        // keep the whole name
      }
      return { name, type: e.initiatorType, start: r(e.startTime), end: r(e.responseEnd), bytes: e.transferSize };
    });
  return n ? { type: n.type, responseStart: r(n.responseStart), dcl: r(n.domContentLoadedEventEnd), load: r(n.loadEventEnd), bytes: n.transferSize, paint, resources } : { paint, resources };
}

/**
 * A cold load's gates, in ms from the navigation's start, from the desk's own samples (each at its end; a sample's start
 * is its time less its ms): /api/me, the device key, the project's connection and catch-up, the subscription, its
 * snapshot and first rows, the grid.
 */
export function coldTimeline(samples, origin) {
  const first = (path) => samples.find((s) => s.path === path) ?? null;
  const end = (s) => (s ? Math.round((s.at - origin) * 10) / 10 : null);
  const begin = (s) => (s ? Math.round((s.at - s.ms - origin) * 10) / 10 : null);
  const caught = first('project.caught-up');
  const rows = first('view.first-rows');
  return {
    me: end(first('app.me')),
    key: end(first('app.key')),
    grid: end(first('app.grid')),
    projectStart: begin(caught),
    caughtUp: end(caught),
    subscribed: begin(rows),
    snapshot: end(first('view.snapshot')),
    rows: end(rows),
  };
}

/** The page's outline for calibration (run in the page): every element a selector could name, compactly. */
export function outline() {
  const out = [];
  const attrs = new Map();
  for (const el of document.querySelectorAll('[data-testid], [aria-label], [role], [contenteditable="true"], textarea, button, a[href*="/code/"]')) {
    if (out.length >= 600) break;
    const data = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name);
    for (const name of data) attrs.set(name, (attrs.get(name) ?? 0) + 1);
    out.push({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute('data-testid'),
      aria: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      editable: el.getAttribute('contenteditable'),
      href: el.getAttribute('href'),
      cls: (el.getAttribute('class') ?? '').slice(0, 80),
      text: (el.textContent ?? '').trim().slice(0, 50),
      data,
    });
  }
  return { url: location.href, elements: out, dataAttributes: Object.fromEntries([...attrs].sort((a, b) => b[1] - a[1])) };
}
