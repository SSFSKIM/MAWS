// The S2 measurements, run against a Playwright Browser obtained by connectOverCDP (over the remote-debugging port,
// the webContents.debugger bridge, or Playwright's own Electron launcher). The same code runs for each route so the
// routes can be compared on the same numbers.
import { performance } from 'node:perf_hooks';

const now = () => performance.now();
const round = (n) => Math.round(n * 10) / 10;
function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const pick = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, min: round(s[0]), median: round(pick(0.5)), p95: round(pick(0.95)), max: round(s[s.length - 1]) };
}
async function timed(fn) {
  const t = now();
  const value = await fn();
  return { ms: now() - t, value };
}
async function repeat(n, fn) {
  const samples = [];
  let last;
  for (let i = 0; i < n; i++) {
    const r = await timed(() => fn(i));
    samples.push(r.ms);
    last = r.value;
  }
  return { ...stats(samples), last };
}

// Parses an `ariaSnapshot({ mode: 'ai' })` YAML into { indent, role, name, ref, line } rows.
export function parseSnapshot(yaml) {
  const rows = [];
  for (const line of yaml.split('\n')) {
    const m = /^(\s*)- ([a-zA-Z]+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/.exec(line);
    if (!m) continue;
    // 1.63 refs are `f<frame>e<n>` (e.g. f5e20); older builds used bare `e<n>`.
    const ref = /\[ref=([a-z0-9]+)\]/.exec(m[4])?.[1] ?? null;
    rows.push({ indent: m[1].length, role: m[2], name: m[3] ?? null, ref, line: line.trim() });
  }
  return rows;
}
export function refOf(rows, role, name) {
  return rows.find((r) => r.role === role && r.name === name)?.ref ?? null;
}
// The ancestor chain of a row by indentation, rendered like the preload's a11yPath.
export function a11yPathFromSnapshot(rows, role, name) {
  const idx = rows.findIndex((r) => r.role === role && r.name === name);
  if (idx < 0) return null;
  const chain = [rows[idx]];
  let indent = rows[idx].indent;
  for (let i = idx - 1; i >= 0 && indent > 0; i--) {
    if (rows[i].indent < indent) { chain.unshift(rows[i]); indent = rows[i].indent; }
  }
  return chain.map((r) => (r.name ? `${r.role} "${r.name}"` : r.role)).join(' > ');
}

export async function findProbePage(browser, pageUrlPrefix, { timeoutMs = 5000, diagnostics = null } = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().startsWith(pageUrlPrefix)) return p;
    if (now() > deadline) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // The client's page.url() can lag or stay empty (seen through the debugger bridge); ask the page itself.
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      let href = null;
      let title = null;
      try { href = await p.evaluate(() => location.href); title = await p.title(); } catch (e) { href = `error: ${e.message.split('\n')[0]}`; }
      diagnostics?.push({ clientUrl: p.url(), mainFrameUrl: p.mainFrame().url(), href, title });
      if (typeof href === 'string' && href.startsWith(pageUrlPrefix)) return p;
    }
  }
  return null;
}

export function inventory(browser) {
  return {
    version: browser.version(),
    contexts: browser.contexts().map((c) => ({ pages: c.pages().map((p) => p.url()) })),
    pageCount: browser.contexts().reduce((n, c) => n + c.pages().length, 0),
  };
}

export async function runDriver({ browser, page, pageUrl, cssPathSource, log, sendInputEvent = null }) {
  const out = { pageUrl };
  page.setDefaultTimeout(5000);

  // (b) snapshot with refs
  const snap1 = await timed(() => page.ariaSnapshot({ mode: 'ai' }));
  out.snapshot = { ms: round(snap1.ms), chars: snap1.value.length, lines: snap1.value.split('\n').length, head: snap1.value.split('\n').slice(0, 40).join('\n') };
  let rows = parseSnapshot(snap1.value);
  out.refCount = rows.filter((r) => r.ref).length;
  const incRef = refOf(rows, 'button', 'Increment');
  const nameRef = refOf(rows, 'textbox', 'Name');
  const flavourRef = refOf(rows, 'combobox', 'Flavour');
  const agreeRef = refOf(rows, 'checkbox', 'I agree');
  out.refs = { increment: incRef, name: nameRef, flavour: flavourRef, agree: agreeRef };
  if (!incRef || !nameRef) throw new Error(`snapshot has no refs for the form: ${JSON.stringify(out.refs)}\n${snap1.value.slice(0, 2000)}`);

  // (b)+(c) act by ref, timed
  const byRef = (ref) => page.locator(`aria-ref=${ref}`);
  out.click = await repeat(10, () => byRef(incRef).click());
  out.click.countAfter = await page.locator('#count').textContent();
  out.fill = await repeat(10, (i) => byRef(nameRef).fill(`Ada ${i}`));
  out.fill.valueAfter = await page.locator('#name').inputValue();
  out.selectOption = await repeat(3, (i) => byRef(flavourRef).selectOption(['vanilla', 'mint', 'coffee'][i]));
  out.selectOption.valueAfter = await page.locator('#flavour').inputValue();
  out.check = await timed(() => byRef(agreeRef).check());
  out.check = { ms: round(out.check.ms), checked: await page.locator('#agree').isChecked() };
  out.evaluate = await repeat(10, () => page.evaluate(() => ({ title: document.title, count: document.getElementById('count').textContent })));
  out.screenshotPage = await repeat(3, () => page.screenshot({ type: 'png' }));
  out.screenshotPage.bytes = out.screenshotPage.last.length;
  delete out.screenshotPage.last;
  out.screenshotElement = await repeat(3, () => byRef(incRef).screenshot({ type: 'png' }));
  out.screenshotElement.bytes = out.screenshotElement.last.length;
  delete out.screenshotElement.last;
  out.snapshotRepeat = await repeat(5, () => page.ariaSnapshot({ mode: 'ai' }));
  const rowsRepeat = parseSnapshot(out.snapshotRepeat.last);
  out.snapshotRepeat.incrementRefStable = refOf(rowsRepeat, 'button', 'Increment') === incRef;
  delete out.snapshotRepeat.last;
  out.snapshotDefault = await timed(() => page.ariaSnapshot());
  out.snapshotDefault = { ms: round(out.snapshotDefault.ms), hasRefs: /\[ref=/.test(out.snapshotDefault.value) };
  out.snapshotBoxes = await timed(() => page.ariaSnapshot({ mode: 'ai', boxes: true }));
  out.snapshotBoxes = { ms: round(out.snapshotBoxes.ms), sampleLine: parseSnapshot(out.snapshotBoxes.value).find((r) => r.role === 'button' && r.name === 'Increment')?.line ?? null };

  // (d) refs across a DOM mutation (insert three buttons before Increment) without and with a fresh snapshot
  rows = parseSnapshot(await page.ariaSnapshot({ mode: 'ai' }));
  const incBefore = refOf(rows, 'button', 'Increment');
  await byRef(refOf(rows, 'button', 'Insert siblings')).click();
  let staleResolves;
  try {
    staleResolves = await byRef(incBefore).evaluate((el) => el.id, null, { timeout: 1500 });
  } catch (e) {
    staleResolves = `error: ${e.message.split('\n')[0]}`;
  }
  const rowsAfterMutation = parseSnapshot(await page.ariaSnapshot({ mode: 'ai' }));
  out.mutation = {
    refBefore: incBefore,
    oldRefResolvesWithoutResnapshot: staleResolves,
    refAfterResnapshot: refOf(rowsAfterMutation, 'button', 'Increment'),
    insertedRefs: rowsAfterMutation.filter((r) => r.role === 'button' && /^Inserted/.test(r.name ?? '')).map((r) => `${r.name}=${r.ref}`),
    sameRef: refOf(rowsAfterMutation, 'button', 'Increment') === incBefore,
  };

  // (d) refs across a reload
  const incPreReload = refOf(rowsAfterMutation, 'button', 'Increment');
  await page.reload();
  await page.waitForLoadState('load');
  let afterReloadWithoutSnapshot;
  try {
    afterReloadWithoutSnapshot = await byRef(incPreReload).evaluate((el) => el.id, null, { timeout: 1500 });
  } catch (e) {
    afterReloadWithoutSnapshot = `error: ${e.message.split('\n')[0]}`;
  }
  const rowsAfterReload = parseSnapshot(await page.ariaSnapshot({ mode: 'ai' }));
  out.reload = {
    refBefore: incPreReload,
    oldRefResolvesWithoutResnapshot: afterReloadWithoutSnapshot,
    refAfterResnapshot: refOf(rowsAfterReload, 'button', 'Increment'),
    sameNumber: refOf(rowsAfterReload, 'button', 'Increment') === incPreReload,
    note: 'after a reload the DOM is new; equal numbers mean numbering is deterministic (traversal order), not that identity survived',
  };

  // (e) the human's pick -> the agent's ref, and back
  out.pick = [];
  for (const target of [{ role: 'button', name: 'Increment' }, { role: 'button', name: 'Act' }, { role: 'textbox', name: 'Name' }, { role: 'link', name: 'local link' }]) {
    // A fresh page-level snapshot per target: the previous target's rooted snapshot may have invalidated page refs.
    rows = parseSnapshot(await page.ariaSnapshot({ mode: 'ai' }));
    const ref = refOf(rows, target.role, target.name);
    const box = await byRef(ref).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const t0 = now();
    const readPick = () => page.evaluate(() => globalThis.__mawsProbe?.lastPick() ?? null);
    const before = (await readPick())?.at ?? 0;
    const fresh = (p) => p && p.at > before;
    // Three ways to synthesize the human's option-click; the first that reaches the preload wins.
    let synthesizedBy = null;
    let picked = null;
    await page.mouse.click(cx, cy, { modifiers: ['Alt'] });
    if (fresh(picked = await readPick())) synthesizedBy = 'playwright mouse.click modifiers:[Alt]';
    if (!synthesizedBy) {
      await page.keyboard.down('Alt');
      await page.mouse.click(cx, cy);
      await page.keyboard.up('Alt');
      if (fresh(picked = await readPick())) synthesizedBy = 'playwright keyboard.down(Alt) + mouse.click';
    }
    if (!synthesizedBy && sendInputEvent) {
      await sendInputEvent(cx, cy);
      await new Promise((r) => setTimeout(r, 150));
      if (fresh(picked = await readPick())) synthesizedBy = 'webContents.sendInputEvent modifiers:[alt]';
    }
    if (!synthesizedBy) picked = null;
    const pickMs = now() - t0;
    const pickDebug = { synthesizedBy, ...(await page.evaluate(() => ({ exposed: typeof globalThis.__mawsProbe, pageLogTail: document.getElementById('log')?.textContent.trim().split('\n').slice(-4) }))) };
    let refViaCss = null;
    let rootedSnapshot = null;
    let cssFromRef = null;
    let mapMs = null;
    let pageRefAfterRootedSnapshot = null;
    if (picked?.css) {
      const t1 = now();
      // agent side, from the human's CSS: a snapshot rooted at the picked element names its ref
      rootedSnapshot = await page.locator(picked.css).ariaSnapshot({ mode: 'ai' });
      refViaCss = parseSnapshot(rootedSnapshot)[0]?.ref ?? null;
      mapMs = now() - t1;
      // do page-level refs survive a rooted snapshot? (the picked element's own ref, and one outside the rooted subtree)
      const otherRef = refOf(rows, 'button', 'Insert siblings');
      pageRefAfterRootedSnapshot = {};
      for (const [label, r] of [['picked', ref], ['outsideSubtree', otherRef]]) {
        try {
          pageRefAfterRootedSnapshot[label] = await byRef(r).evaluate((el) => el.id || el.tagName, null, { timeout: 1000 });
        } catch (e) {
          pageRefAfterRootedSnapshot[label] = `error: ${e.message.split('\n')[0]}`;
        }
      }
      // the other direction: the agent's ref -> the human's CSS, with the same selector function
      const freshRef = refOf(parseSnapshot(await page.ariaSnapshot({ mode: 'ai' })), target.role, target.name);
      cssFromRef = await byRef(freshRef).evaluate(new Function('el', `${cssPathSource}; return cssPath(el);`));
    }
    out.pick.push({
      target: `${target.role} "${target.name}"`,
      agentRef: ref,
      agentA11yPath: a11yPathFromSnapshot(rows, target.role, target.name),
      humanPick: picked ? { css: picked.css, a11y: picked.a11y, role: picked.role, name: picked.name } : null,
      refViaHumanCss: refViaCss,
      rootedSnapshotFirstLine: rootedSnapshot?.split('\n')[0] ?? null,
      cssViaAgentRef: cssFromRef,
      pageRefAfterRootedSnapshot,
      agree: { ref: refViaCss === ref, css: cssFromRef === picked?.css, roleName: picked ? picked.role === target.role && picked.name === target.name : false },
      pickMs: round(pickMs),
      mapMs: mapMs == null ? null : round(mapMs),
      pickDebug,
    });
  }

  // navigation sanity
  const nav = await timed(async () => { await page.goto(new URL('/second.html', pageUrl).href); await page.goBack(); return page.url(); });
  out.navigate = { ms: round(nav.ms), urlAfterBack: nav.value };
  return out;
}
