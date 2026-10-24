// The installed phone app's reader owns the scroll position during a live answer. These cases run the real desk
// session view, streaming DX4 chunks continuously through the fake machine, not a paused stream followed by a scroll.
import type { Locator, Page } from '@playwright/test';
import { loadRecording, SESSION_VIEW } from 'desk-hub/fake-machine';
import type { HubDouble } from '../test/double/hub-double';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

let fm: FakeMachineReplay | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
test.afterEach(() => {
  if (timer) clearInterval(timer);
  timer = null;
  fm?.stop();
  fm = null;
});

async function openStream(page: Page, hub: HubDouble) {
  await stageProject(hub);
  const base = loadRecording(SESSION_VIEW);
  const prompt = { type: 'user', uuid: 'scroll-prompt', parentUuid: null, isSidechain: false, timestamp: '2026-10-22T10:00:00.000Z', sessionId: base.session, origin: { kind: 'human' }, message: { role: 'user', content: 'Explain the streaming scroll investigation in detail.' } };
  const recording = { ...base, rows: { main: [prompt], agents: {} }, meta: {}, steps: [] };
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: 'fake' }, { recording, producer: 'dc8' }));
  hub.setMachines(PROJECT, [{ machine: 'fake', online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] }]);
  await hub.append(PROJECT, { writer: `fake/${replay.session}`, kind: 'joined', session: replay.session, alias: 'scroll-reader', name_source: 'user', machine: 'fake', cwd: recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.depth.apply({ at: 0, k: 'row', agentId: null, row: prompt });
  replay.depth.apply({ at: 0, k: 'presence', record: { status: 'busy' } });
  replay.sendPresence();
  await seedKey(page, hub);
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  const view = page.getByTestId('session-view');
  const scroller = view.locator('[data-transcript-scroller]');
  await expect.poll(() => replay.subscriptions()).toBe(1);
  let chunkIndex = 0;
  let sent = 0;
  let block = 0;
  const chunk = (body: Record<string, unknown>) => replay.depth.apply({ at: 0, k: 'chunk', agentId: null, turnId: 'scroll-turn', step: 0, chunkIndex: chunkIndex++, chunk: body as never });
  const paragraph = (n: number) => `\n\nReading marker ${n}. The transcript must leave the reader here while the answer continues below. The streaming transport is still delivering text.`;
  chunk({ kind: 'text', index: 0, text: `<message>${Array.from({ length: 35 }, (_, i) => paragraph(i)).join('')}` });
  await expect(view.locator('[data-row-id^="desk-stream:"]')).toContainText('Reading marker 34');
  await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(1);
  timer = setInterval(() => {
    chunk({ kind: 'text', index: block, text: paragraph(35 + sent++) });
  }, 20);
  return {
    view, scroller, replay, sent: () => sent,
    appendBlock: () => {
      chunk({ kind: 'text', index: block, text: '</message>' });
      block++;
      chunk({ kind: 'text', index: block, text: '<message>The next answer block streams as a new row.' });
    },
  };
}

const bottomGap = (scroller: Locator) => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);

/** Sample every frame, not only the final offset: a snap followed by another gesture must not look like a hold. */
async function holdWhileStreaming(scroller: Locator) {
  return scroller.evaluate(async (el) => {
    const initial = el.scrollTop;
    let drift = 0;
    const start = performance.now();
    while (performance.now() - start < 650) {
      await new Promise(requestAnimationFrame);
      drift = Math.max(drift, Math.abs(el.scrollTop - initial));
    }
    return drift;
  });
}

for (const input of ['wheel', 'touch-like'] as const) {
  test(`@layout scrolling up with ${input} during a continuous answer holds the reader until Jump to latest`, async ({ page, hub, browserName }) => {
    test.skip(input === 'wheel' && browserName === 'webkit', 'Mobile WebKit has no Playwright mouse wheel support');
    const { view, scroller, sent, appendBlock } = await openStream(page, hub);
    // Capture the baseline at the input itself: streaming may advance the tail during mouse/CDP setup.
    await scroller.evaluate((el, event) => {
      el.addEventListener(event, () => {
        el.setAttribute('data-e2e-gesture-top', String(el.scrollTop));
        let previous = el.scrollTop;
        let movedUp = false;
        el.addEventListener('scroll', () => {
          const next = el.scrollTop;
          if (next < previous) movedUp = true;
          else if (!movedUp) el.setAttribute('data-e2e-gesture-top', String(next));
          if (movedUp && next > previous + 1) el.setAttribute('data-e2e-pulled-down', String(next - previous));
          previous = next;
        }, { passive: true, capture: true });
      }, { once: true, capture: true });
    }, input === 'wheel' ? 'wheel' : 'touchstart');
    const start = sent();
    if (input === 'wheel') {
      const box = (await scroller.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // A trackpad/wheel gesture is a series of small deltas, not a single teleport past the follow threshold.
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -32);
        await page.waitForTimeout(20);
      }
    } else if (browserName === 'chromium') {
      // Chromium exposes trusted native touch input through CDP. The same case uses a touch-like gesture below on
      // WebKit, whose Playwright mobile driver exposes neither a swipe API nor constructible Touch objects.
      const box = (await scroller.boundingBox())!;
      const cdp = await page.context().newCDPSession(page);
      const point = (n: number) => [{ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 90 + n * 16) }];
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) });
        for (let i = 1; i <= 20; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(i) });
          await page.waitForTimeout(20);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await cdp.detach();
      }
    } else {
      // WebKit has no Playwright swipe API. Touch events plus per-frame native scroll offsets model a finger's small
      // moves on both engines, including their ordering with the stream and ResizeObserver. No app handler is mocked.
      await scroller.evaluate(async (el) => {
        const touch = (name: string, y: number, active = true) => {
          const event = new Event(name, { bubbles: true });
          const point = { identifier: 1, target: el, clientX: 160, clientY: y };
          Object.defineProperties(event, { touches: { value: active ? [point] : [] }, changedTouches: { value: [point] } });
          el.dispatchEvent(event);
        };
        touch('touchstart', 300);
        for (let i = 1; i <= 16; i++) {
          await new Promise(requestAnimationFrame);
          touch('touchmove', 300 + i * 20);
          el.scrollBy(0, -20);
        }
        touch('touchend', 620, false);
      });
    }
    await expect(view.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    // Real wheel input has a short native animation after mouse.wheel returns. Let that input settle without stopping
    // the stream; the following frame sampler then measures application movement, not the tail of the gesture.
    await scroller.evaluate(async (el) => {
      const start = performance.now();
      let last = start;
      let previous = el.scrollTop;
      while (performance.now() - start < 2000) {
        await new Promise(requestAnimationFrame);
        if (el.scrollTop !== previous) last = performance.now();
        previous = el.scrollTop;
        if (performance.now() - last >= 100) return;
      }
      throw new Error('The reader never stopped moving while the answer streamed');
    });
    const before = await scroller.getAttribute('data-e2e-gesture-top');
    expect(before, 'the browser delivered the upward input').not.toBeNull();
    expect(await scroller.evaluate((el) => el.scrollTop), 'the gesture moved up despite incoming chunks').toBeLessThan(Number(before) - 150);
    expect(await holdWhileStreaming(scroller), 'streaming text does not move the reader').toBeLessThanOrEqual(1);
    const held = await scroller.evaluate((el) => el.scrollTop);
    appendBlock();
    await expect(view.locator('[data-row-id^="desk-stream:"]')).toHaveCount(2);
    expect(await scroller.evaluate((el) => el.scrollTop), 'a new streaming row does not pull the reader down').toBeCloseTo(held, 0);
    expect(await holdWhileStreaming(scroller), 'the new row keeps streaming below the reader').toBeLessThanOrEqual(1);
    expect(sent() - start, 'the answer streamed throughout the gesture and holds').toBeGreaterThan(40);
    expect(await scroller.getAttribute('data-e2e-pulled-down'), 'no streaming snap during the gesture or either hold').toBeNull();
    await view.getByRole('button', { name: 'Jump to latest' }).click();
    await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(1);
    await expect(view.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
    const followingAt = await scroller.evaluate((el) => el.scrollTop);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(followingAt + 100);
    await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(1);
  });
}

for (const toolCount of [2, 16]) {
  test(`@layout upward input in ${toolCount === 2 ? 'a fitting' : 'an overflowing'} internal-activity group belongs to the group, not transcript follow`, async ({ page, hub, browserName }) => {
    const { view, scroller, replay } = await openStream(page, hub);
    if (timer) clearInterval(timer);
    timer = null;
    replay.depth.apply({ at: 0, k: 'step-end', body: { turnId: 'scroll-turn', agentId: null, step: 0 } });
    // UX1-C tool summaries no longer have a nested group fold; internal activity retains the bounded scroller.
    const calls = Array.from({ length: toolCount }, (_, i) => ({ type: 'tool_use', id: `toolu_scroll_${i}`, name: 'TaskGet', input: { taskId: `scroll-task-${i}` } }));
    const row = {
      uuid: 'scroll-group-calls', parentUuid: 'scroll-prompt', isSidechain: false, timestamp: '2026-10-22T10:01:00.000Z', sessionId: replay.session,
      type: 'assistant', message: { id: 'msg_scroll_group', role: 'assistant', type: 'message', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Earlier investigation.\n\n'.repeat(40) }, ...calls], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
    };
    replay.depth.apply({ at: 0, k: 'row', agentId: null, row: row as never });
    await view.locator('.transcript-group-header').click();
    const cells = view.locator('.transcript-group-cells');
    await expect(cells).toBeVisible();
    if (toolCount === 16) await expect.poll(() => cells.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
    else await expect.poll(() => cells.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    const jump = view.getByRole('button', { name: 'Jump to latest' });
    if (await jump.count()) await jump.click();
    await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(1);
    for (const input of toolCount === 16 ? ['wheel', 'touch', 'keyboard'] : ['wheel', 'touch']) {
      if (input === 'wheel' && browserName === 'webkit') continue;
      await cells.evaluate((el) => { el.scrollTop = 150; });
      if (input === 'wheel') {
        // The full box can extend under the composer while disclosure motion settles. Playwright's hit-tested hover
        // chooses a visible point and waits for stability instead of wheeling at a clipped bounding-box midpoint.
        await cells.evaluate((el) => { el.addEventListener('wheel', () => el.setAttribute('data-e2e-wheel', 'received'), { once: true }); });
        await cells.hover();
        await page.mouse.wheel(0, -64);
        await expect(cells).toHaveAttribute('data-e2e-wheel', 'received');
      } else if (input === 'keyboard') {
        await cells.focus();
        await page.keyboard.press('ArrowUp');
      } else {
        await cells.evaluate((el) => {
          for (const [type, y] of [['touchstart', 200], ['touchmove', 250], ['touchend', 250]] as const) {
            const event = new Event(type, { bubbles: true });
            Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ identifier: 1, clientY: y }] });
            el.dispatchEvent(event);
            if (type === 'touchmove') el.scrollBy(0, -50);
          }
        });
      }
      // Mobile WebKit delivers the key but does not scroll this box from synthetic hardware-key input. The ownership
      // assertion still runs there; native keyboard scrolling is not the app behavior under test.
      if (toolCount === 16 && (input !== 'keyboard' || browserName !== 'webkit')) await expect.poll(() => cells.evaluate((el) => el.scrollTop), `${input} reaches the nested scroller`).toBeLessThan(150);
      await expect(jump, `${input} consumed by group cells must not detach the transcript`).toHaveCount(0);
      await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(1);
    }
    // A real new row still follows after the nested-input paths, including a contained box with nothing to scroll.
    replay.depth.apply({ at: 0, k: 'row', agentId: null, row: { ...row, uuid: 'scroll-after-group', parentUuid: row.uuid, message: { ...row.message, id: 'msg_scroll_after_group', content: [{ type: 'text', text: 'The transcript still follows after scrolling the tool group.' }] } } as never });
    await expect(view.getByText('The transcript still follows after scrolling the tool group.', { exact: true })).toBeInViewport();
    await expect(jump).toHaveCount(0);
  });
}

test.describe('fractional browser geometry', () => {
  test.use({ deviceScaleFactor: 2 });
  test('@layout returning to the end resumes follow at DPR 2 and 110% zoom, then follows later measured growth', async ({ page, hub }) => {
    const { view, scroller, appendBlock } = await openStream(page, hub);
    await page.evaluate(() => { document.documentElement.style.zoom = '1.1'; });
    await scroller.evaluate((el) => { el.style.height = '463.25px'; });
    await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(1);
    await scroller.dispatchEvent('wheel', { deltaY: -200 }); // the reader owns this move; the clamp below tests geometry
    await scroller.evaluate((el) => { el.scrollTop -= 200; });
    const jump = view.getByRole('button', { name: 'Jump to latest' });
    await expect(jump).toBeVisible();
    // Clamp once to the real maximum; let the scroll/measurement handlers resume following before reading the end.
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(jump).toHaveCount(0);
    await expect.poll(async () => Math.abs(await bottomGap(scroller)), 'the resumed transcript settles at its end').toBeLessThanOrEqual(1);
    appendBlock();
    await expect(view.locator('[data-row-id^="desk-stream:"]')).toHaveCount(2);
    const at = await scroller.evaluate((el) => el.scrollTop);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(at + 100);
    await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(1);
    await expect(jump).toHaveCount(0);
  });
});
