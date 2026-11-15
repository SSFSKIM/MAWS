// The spike's Electron main: one suite per launch (`--suite=<name>`), each printing `RESULT {json}` lines (a row, a part,
// a status, what was observed) and `REC {json}` lines (the ordered record of both ends, and main's own record).
//   electron . --suite=<gen|a|bc|d|e|f|g|hi|hi-reversed> --runs=<dir> --media=<dir> [--lang=ko]
import { app, protocol, session } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { records, result } from './record.mjs';
import { ownFilters } from './policies.mjs';
import { descendants, frameOf, frameTree, viewerFramesOf, lastSeq, mount, openerLines, openWindow, ownerRule, page, picture, probeViewer, screenShot, serve, setupSession, since, sleep, stateOf, tokens, waitDrawn, within, xWindows, PDF_VIEWER, exists } from './harness.mjs';
import { hostilePdfs, largePdf, pagesPdf } from './pdf.mjs';

const argv = Object.fromEntries(process.argv.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; }));
const suite = argv.suite;
const out = join(argv.runs, suite);
mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'profile')); // a fresh profile per launch: no viewer state carried between suites

// As src/render/scheme.ts registers the store's scheme, and as main's entry sets Chromium's switches (ticket 662 and
// P3-F1 fix 3).
protocol.registerSchemesAsPrivileged([{ scheme: 'maws-artifact', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: true, stream: true } }]);
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('blink-settings', 'dnsPrefetchingEnabled=false');

const noFragment = (url) => url.split('#')[0];
const HTML_PAGE = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><title>page</title></head><body><p id="t">waiting</p><script>document.getElementById("t").textContent = "script ran";</script></body></html>');

function wav(seconds = 3, rate = 22050) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return b;
}
const media = (name) => readFileSync(join(argv.media, name));

// For each kind's URL, walk the ordered record: per method, the handler's entries never outnumber the listener's passed
// decisions so far, and every passed decision carries the owner's id.
function walk(recs, url, owner) {
  const open = new Map();
  const o = { entries: 0, passes: 0, cancels: 0, entryWithoutPass: 0, passWithOtherId: 0, ids: [], ranges: [] };
  const ids = new Set();
  for (const r of recs) {
    if (noFragment(r.url ?? '') !== url) continue;
    if (r.end === 'decision') {
      ids.add(r.webContentsId === null ? 'none' : r.webContentsId);
      if (r.decision === 'pass') {
        o.passes++;
        if (r.webContentsId !== owner) o.passWithOtherId++;
        open.set(r.method, (open.get(r.method) ?? 0) + 1);
      } else o.cancels++;
    } else if (r.end === 'entry') {
      o.entries++;
      o.ranges.push(r.range);
      const left = (open.get(r.method) ?? 0) - 1;
      open.set(r.method, left);
      if (left < 0) o.entryWithoutPass++;
    }
  }
  o.ids = [...ids];
  return o;
}

async function waitMedia(win, id, ms = 8000) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) {
    s = await stateOf(win, id);
    if (s?.events?.includes('loadedmetadata') || s?.error) return s;
    await sleep(200);
  }
  return s;
}
async function frameText(url, code = 'JSON.stringify({ cs: document.characterSet, t: (document.getElementById("t") || {}).textContent ?? null, title: document.title })') {
  const f = frameOf(url);
  if (!f) return { error: 'no frame' };
  const r = await within(f.executeJavaScript(code, false), 4000, null);
  return typeof r === 'string' ? JSON.parse(r) : { error: r?.error ?? 'no answer' };
}

const suites = {
  // Row g's clips, made by Chromium (MediaRecorder): the build VM has no ffmpeg.
  async gen() {
    const win = await openWindow({ page: 'gen.html', width: 400, height: 300 });
    const dir = argv.media;
    mkdirSync(dir, { recursive: true });
    const candidates = ['video/webm;codecs=vp8,opus', 'video/x-matroska;codecs=avc1,opus', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=vp9,opus', 'video/mp4'];
    const supported = await page(win, `gen.supported(${JSON.stringify(candidates)})`);
    const made = {};
    const record = async (type, names) => {
      const r = await page(win, `gen.record(${JSON.stringify(type)})`);
      if (!r || r.error) return null;
      for (const n of names) writeFileSync(join(dir, n), Buffer.from(r.base64, 'base64'));
      for (const n of names) made[n] = { recordedAs: r.type, bytes: r.size };
      return r;
    };
    await record('video/webm;codecs=vp8,opus', ['clip.webm']);
    const mkv = supported.find((s) => s.type.startsWith('video/x-matroska') && s.supported);
    if (mkv) await record(mkv.type, ['clip.mkv']);
    else await record('video/webm;codecs=vp8,opus', ['clip.mkv']); // WebM is a subset of Matroska
    const mp4 = supported.find((s) => s.type.startsWith('video/mp4') && s.supported);
    if (mp4) await record(mp4.type, ['clip.mp4', 'clip.mov']); // the same ISO-BMFF bytes under both names
    writeFileSync(join(dir, 'tone.wav'), wav());
    made['tone.wav'] = { recordedAs: 'audio/wav (written by the harness)', bytes: 44 + 3 * 22050 * 2 };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ supported, made }, null, 1));
    result('g', 'generate', 'record', `MediaRecorder: ${supported.map((s) => `${s.type} ${s.supported ? 'yes' : 'no'}`).join('; ')}; made ${Object.entries(made).map(([n, m]) => `${n} (${m.recordedAs}, ${m.bytes} B)`).join(', ')}`, { supported, made });
  },

  // Row a: the large PDF streamed in pages, once answering ranges and once answering every request whole; and, as a
  // control that does not decide, the ranged load with no owner's check in the listener.
  async a() {
    const bytes = largePdf();
    const win = await openWindow({ width: 1000, height: 900 });
    for (const [part, ranges, owner, status] of [['ranges', true, true, null], ['whole', false, true, null], ['ranges-without-owner-check', true, false, 'record']]) {
      serve.ranges = ranges;
      ownerRule.on = owner;
      const t = tokens.issue({ owner: win.webContents.id, name: 'large.pdf', mime: 'application/pdf', bytes, kind: 'pdf' });
      const seq = lastSeq();
      await mount(win, { id: part, kind: 'pdf', url: t.url, width: 800, height: 700 });
      const d = await waitDrawn(t.url, 40000, 5);
      await sleep(2500);
      const st = await stateOf(win, part);
      const pic = await picture(win, join(out, `a-${part}.png`), st?.rect);
      const w = walk(since(seq), t.url, win.webContents.id);
      const box = d.probe ? (d.probe.embed ?? d.probe.plugin) : null;
      const ok = d.ok && pic.colours > 50;
      result('a', part, status ?? (ok ? 'pass' : 'fail'), `drawn: ${ok ? 'yes' : 'no'} (viewer frames ${d.probes.length}; plugin box ${box ? `${box.w}x${box.h}` : 'none'}; pages ${d.probe?.docLength ?? '?'}; picture ${pic.width}x${pic.height}, ${pic.colours} colours); requests ${w.entries}: ${w.ranges.join(', ')}; decisions pass ${w.passes}, cancel ${w.cancels} (ids ${w.ids.join(',')}); ${bytes.length} B`, { walk: w, probes: d.probes, picture: pic, frameTree: frameTree() });
      await page(win, `spike.unmount(${JSON.stringify(part)})`);
      tokens.release(t.token);
      await sleep(500);
    }
    serve.ranges = true;
    ownerRule.on = true;
  },

  // Row a's control, which does not decide: Chromium's PDF loader with its partial loading turned on
  // (--enable-features=PdfPartialLoading, which the app does not set) and slow pages, to show whether the viewer then
  // asks ranges of its own and whether each passes the listener.
  async 'a-partial'() {
    const bytes = largePdf();
    const win = await openWindow({ width: 1000, height: 900 });
    serve.pauseMs = 400;
    const t = tokens.issue({ owner: win.webContents.id, name: 'large.pdf', mime: 'application/pdf', bytes, kind: 'pdf' });
    const seq = lastSeq();
    await mount(win, { id: 'partial', kind: 'pdf', url: t.url, width: 800, height: 700 });
    const d = await waitDrawn(t.url, 40000, 5);
    await sleep(3000);
    const w = walk(since(seq), t.url, win.webContents.id);
    result('a', 'partial-loading-control', 'record', `with PdfPartialLoading and 400 ms between pages: ${d.ok ? 'drawn' : 'NOT drawn'}; requests ${w.entries}: ${w.ranges.join(', ')}; decisions pass ${w.passes}, cancel ${w.cancels} (ids ${w.ids.join(',')}); entries without a passed decision before them ${w.entryWithoutPass}`, { walk: w });
    serve.pauseMs = 20;
  },

  // Rows b and c, in one launch: c asks again, from elsewhere, the URLs b loaded.
  async bc() {
    const w1 = await openWindow({ width: 1400, height: 900 });
    const owner = w1.webContents.id;
    const kinds = {
      pdf: tokens.issue({ owner, name: 'large.pdf', mime: 'application/pdf', bytes: largePdf(), kind: 'pdf' }),
      html: tokens.issue({ owner, name: 'page.html', mime: 'text/html', bytes: HTML_PAGE, kind: 'html' }),
      video: tokens.issue({ owner, name: 'clip.webm', mime: 'video/webm', bytes: media('clip.webm'), kind: 'video' }),
      audio: tokens.issue({ owner, name: 'tone.wav', mime: 'audio/wav', bytes: media('tone.wav'), kind: 'audio' }),
    };
    const sizes = { pdf: [640, 600], html: [400, 300], video: [320, 240], audio: [300, 54] };
    for (const [k, t] of Object.entries(kinds)) await mount(w1, { id: k, kind: k, url: t.url, width: sizes[k][0], height: sizes[k][1] });
    const d = await waitDrawn(kinds.pdf.url, 40000, 5);
    const v = await waitMedia(w1, 'video');
    const au = await waitMedia(w1, 'audio');
    await page(w1, 'spike.seek("video", 0.9)');
    await page(w1, 'spike.seek("audio", 2.5)');
    await sleep(2000);
    const html = await frameText(kinds.html.url);
    await picture(w1, join(out, 'b-window.png'));
    const shown = { pdf: d.ok ? `drawn, ${d.probe.docLength} pages` : 'not drawn', html: html.t === 'script ran' ? 'script ran' : `not run (${JSON.stringify(html)})`, video: v?.error ? `error ${v.error.code}` : (v?.events ?? []).join('/'), audio: au?.error ? `error ${au.error.code}` : (au?.events ?? []).join('/') };
    const recsB = records.filter((r) => r.partition === 'default');
    let bFail = false;
    for (const [k, t] of Object.entries(kinds)) {
      const w = walk(recsB, t.url, owner);
      const ok = w.entryWithoutPass === 0 && w.passWithOtherId === 0 && w.entries > 0;
      if (!ok) bFail = true;
      result('b', k, ok ? 'pass' : 'fail', `${shown[k]}; entries ${w.entries}, passed ${w.passes}, cancelled ${w.cancels}, entries without a passed decision before them ${w.entryWithoutPass}, passes with another id ${w.passWithOtherId}; ids ${w.ids.join(',')} (window ${owner}); ranges ${w.ranges.join(', ')}`, { walk: w });
    }
    result('b', 'frame-tree', 'record', 'where Chromium put the viewer', { frameTree: frameTree(), probes: d.probes });

    // Row c. W1's elements removed (its tokens kept), so any entry for these URLs from here on is another asker's.
    await page(w1, 'spike.clear()');
    await sleep(1500);
    const urls = Object.values(kinds).map((t) => t.url);
    const entriesFor = (seq, partition) => since(seq).filter((r) => r.end === 'entry' && urls.includes(noFragment(r.url)) && (!partition || r.partition === partition));
    const decisionsFor = (seq) => since(seq).filter((r) => r.end === 'decision' && urls.includes(noFragment(r.url)));
    const mountAll = async (win) => {
      for (const [k, t] of Object.entries(kinds)) {
        await mount(win, { id: `${k}-frame`, kind: k === 'html' ? 'html' : 'pdf', url: t.url, width: 300, height: 200 });
        if (k === 'video' || k === 'audio') await mount(win, { id: `${k}-media`, kind: k, url: t.url, width: 300, height: 120 });
      }
      await sleep(4000);
    };
    const cParts = [];
    let seq = lastSeq();
    const w2 = await openWindow({ width: 1000, height: 700 });
    await mountAll(w2);
    cParts.push(['second-window', seq, w2.webContents.id]);
    seq = lastSeq();
    const w3 = await openWindow({ width: 1000, height: 700, own: () => false }); // its own filter cancels nothing
    await mountAll(w3);
    cParts.push(['own-filter', seq, w3.webContents.id]);
    seq = lastSeq();
    const fetched = [];
    for (const u of urls) fetched.push(await within(session.defaultSession.fetch(u).then((r) => `status ${r.status}`, (e) => `failed: ${String(e.message ?? e).slice(0, 80)}`), 8000, 'no answer'));
    await sleep(500);
    cParts.push(['no-web-contents', seq, 'none']);
    seq = lastSeq();
    const w4 = await openWindow({ width: 1000, height: 700, partition: 'file-frame-second' });
    await mountAll(w4);
    cParts.push(['second-partition', seq, w4.webContents.id]);
    for (let i = 0; i < cParts.length; i++) {
      const [part, from, asker] = cParts[i];
      const to = cParts[i + 1]?.[1] ?? lastSeq();
      const slice = (rs) => rs.filter((r) => r.seq <= to);
      const entries = slice(entriesFor(from));
      const ds = slice(decisionsFor(from));
      const d2 = { by: {} };
      for (const r of ds) d2.by[`${r.decision}/${r.branch}/${r.webContentsId ?? 'none'}`] = (d2.by[`${r.decision}/${r.branch}/${r.webContentsId ?? 'none'}`] ?? 0) + 1;
      const passed = ds.filter((r) => r.decision === 'pass').length;
      const ok = entries.length === 0;
      result('c', part, ok ? 'pass' : 'fail', `asker ${asker}: handler entries for the four URLs ${entries.length}; decisions ${ds.length} (passed ${passed}; ${Object.entries(d2.by).map(([k2, n]) => `${k2} ${n}`).join(', ')})${part === 'no-web-contents' ? `; fetch: ${fetched.join(' | ')}` : ''}`, { entries, decisions: ds.length });
    }
    // The second partition's control: tokens of its own window answer there, each entry after its listener passed it.
    seq = lastSeq();
    const own4 = Object.fromEntries(Object.entries(kinds).map(([k, t]) => [k, tokens.issue({ owner: w4.webContents.id, name: t.name, mime: t.mime, bytes: t.bytes, kind: k })]));
    await page(w4, 'spike.clear()');
    for (const [k, t] of Object.entries(own4)) await mount(w4, { id: `own-${k}`, kind: k, url: t.url, width: sizes[k][0], height: sizes[k][1] });
    await waitDrawn(own4.pdf.url, 30000, 5);
    await sleep(2500);
    const recs2 = since(seq).filter((r) => r.partition === 'second');
    let ok2 = true;
    const per = [];
    for (const [k, t] of Object.entries(own4)) {
      const w = walk(recs2, t.url, w4.webContents.id);
      if (w.entryWithoutPass !== 0 || w.passWithOtherId !== 0) ok2 = false;
      per.push(`${k} entries ${w.entries}/passed ${w.passes}/without a pass ${w.entryWithoutPass}`);
    }
    const strayOnSecond = since(cParts[3][1]).filter((r) => r.partition === 'second' && r.end === 'entry' && urls.includes(noFragment(r.url))).length;
    result('c', 'second-partition-control', ok2 && strayOnSecond === 0 ? 'pass' : 'fail', `tokens of the second partition's own window: ${per.join('; ')}; entries there for the first window's tokens ${strayOnSecond}`);
    ownFilters.clear();
  },

  // Row d: a token of 32 digits and no letter, beside an ordinary one.
  async d() {
    const win = await openWindow({ width: 1000, height: 600 });
    const digits = tokens.issue({ owner: win.webContents.id, name: 'page.html', mime: 'text/html', bytes: HTML_PAGE, kind: 'html', token: '12345678901234567890123456789012' });
    const lettered = tokens.issue({ owner: win.webContents.id, name: 'page.html', mime: 'text/html', bytes: HTML_PAGE, kind: 'html' });
    const seq = lastSeq();
    await mount(win, { id: 'digits', kind: 'html', url: digits.url, width: 400, height: 200 });
    await mount(win, { id: 'lettered', kind: 'html', url: lettered.url, width: 400, height: 200 });
    await sleep(3000);
    const rs = since(seq);
    const about = (t) => {
      const mine = rs.filter((r) => (r.url ?? '').includes(t.token));
      return { decisions: mine.filter((r) => r.end === 'decision').length, entries: mine.filter((r) => r.end === 'entry').length, text: null };
    };
    const a = about(digits);
    const b = about(lettered);
    a.text = await frameText(digits.url);
    b.text = await frameText(lettered.url);
    const fails = rs.filter((r) => r.type === 'did-fail-load').map((r) => `${r.errorCode} ${r.errorDescription}`);
    const src = await page(win, 'JSON.stringify([...document.querySelectorAll("iframe")].map((f) => f.src))');
    const loads = a.entries > 0 && a.text?.t === 'script ran';
    const frames = frameTree().flatMap((w) => w.frames.map((f) => f.url)).filter((u) => !u.startsWith('file:'));
    result('d', 'all-digit token', 'record', `${loads ? 'loads' : 'does not load'}: decisions ${a.decisions}, handler entries ${a.entries}, frame ${JSON.stringify(a.text)}; the iframe's src as the page reads it ${src}; failed loads ${fails.join('; ') || 'none'}; the window's frames other than its page ${JSON.stringify(frames)}; control (lettered token): decisions ${b.decisions}, entries ${b.entries}, frame ${JSON.stringify(b.text)}`);
    await picture(win, join(out, 'd-window.png'));
  },

  // Row e: one PDF per behaviour, each in a fresh window; main's own record before and after, and two pictures (the
  // window's contents, and the whole screen, where a native dialog would be).
  async e() {
    const pdfs = hostilePdfs();
    const openedFile = process.env.FILE_FRAME_OPENED;
    const electronExe = process.execPath;
    const baseline = {};
    // In the viewer's own frame, as main (a user gesture): the positive controls of main's record. They are not part of
    // R4's test; they show that each kind of act would have been seen.
    const inViewer = (code) => async (_win, t) => {
      const f = viewerFramesOf(t.url)[0];
      if (f) await within(f.executeJavaScript(code, true), 3000);
      await sleep(2000);
    };
    const deep = (sel) => `(() => { const find = (root) => { const hit = root.querySelector(${JSON.stringify(sel)}); if (hit) return hit; for (const el of root.querySelectorAll('*')) { const r = el.shadowRoot && find(el.shadowRoot); if (r) return r; } return null; }; const el = find(document); if (el) el.click(); return !!el; })()`;
    const clickLink = async (win, t) => {
      win.focus();
      win.webContents.focus();
      const st = await stateOf(win, t.name.replace(/\.pdf$/, ''));
      const x = st.rect.x + Math.round(st.rect.width / 2) + 150; // right of the viewer's sidebar, on the page
      const y = st.rect.y + 300;
      win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
      await sleep(300);
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await sleep(1500);
    };
    const cases = [
      ...Object.entries(pdfs).map(([name, bytes]) => [name, bytes, name === 'control-click-link' ? clickLink : null]),
      ['detector-frame-navigation', pdfs.baseline, inViewer('location.href = "https://example.com/viewer-navigation"')],
      ['detector-window-navigation', pdfs.baseline, inViewer('window.top.location.href = "https://example.com/window-navigation"')],
      ['detector-request', pdfs.baseline, inViewer('fetch("https://example.com/viewer-fetch").catch(() => 0)')],
      ['detector-window-open', pdfs.baseline, inViewer('window.open("https://example.com/viewer-window")')],
      ['detector-viewer-save', pdfs.baseline, inViewer(deep('#save'))],
    ];
    for (const [name, bytes, act] of cases) {
      const win = await openWindow({ width: 1000, height: 900 });
      await sleep(500);
      const before = { x: new Set(xWindows().filter((w) => w.mapped).map((w) => w.id)), procs: new Set(descendants().map((p) => p.pid)), opened: openerLines(openedFile).length, seq: lastSeq() };
      const t = tokens.issue({ owner: win.webContents.id, name: `${name}.pdf`, mime: 'application/pdf', bytes, kind: 'pdf' });
      await mount(win, { id: name, kind: 'pdf', url: t.url, width: 900, height: 800 });
      const d = await waitDrawn(t.url, 15000);
      await page(win, 'spike.frames(120)');
      await sleep(1500);
      if (act) await act(win, t);
      const probes = await probeViewer(t.url);
      const pic = await picture(win, join(out, `e-${name}.png`));
      const screen = screenShot(join(out, `e-${name}-screen.png`));
      const xAfter = xWindows();
      const newX = xAfter.filter((w) => w.mapped && !before.x.has(w.id));
      // Chromium's own processes: Electron's metrics name them, and a sandboxed one cannot be read (its exe is null).
      const chromium = new Set(app.getAppMetrics().map((m) => m.pid));
      const procs = descendants().filter((p) => !before.procs.has(p.pid) && !chromium.has(p.pid) && p.exe !== null && p.exe !== electronExe).map((p) => `${p.comm} (${p.exe})`);
      const opened = openerLines(openedFile).slice(before.opened);
      const rs = since(before.seq);
      const expected = (url) => noFragment(url) === noFragment(t.url) || url.startsWith(PDF_VIEWER) || url === 'about:blank' || url.startsWith('chrome://');
      const navs = rs.filter((r) => ['will-frame-navigate', 'will-navigate', 'did-frame-navigate'].includes(r.type) && !expected(r.url));
      const navHappened = navs.filter((r) => r.type === 'did-frame-navigate' || r.blocked === false);
      const navBlocked = navs.filter((r) => r.blocked === true);
      const nonNetwork = (u) => u.startsWith('file:') || u.startsWith(PDF_VIEWER) || u.startsWith('chrome://') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('devtools:');
      const network = rs.filter((r) => r.end === 'request' && !nonNetwork(r.url));
      const scheme = rs.filter((r) => r.end === 'decision' && noFragment(r.url) !== noFragment(t.url));
      const downloads = rs.filter((r) => r.type === 'download');
      const opens = rs.filter((r) => r.type === 'window-open' || r.type === 'did-create-window');
      const created = rs.filter((r) => r.type === 'web-contents-created');
      const consoles = rs.filter((r) => r.type === 'console');
      if (name === 'baseline') Object.assign(baseline, { created: created.length });
      const happened = [
        ...newX.map((w) => `a native window "${w.name}" ${w.width}x${w.height}`),
        ...procs.map((p) => `a process ${p}`),
        ...opened.map((l) => `an opener ran: ${l.split(' ')[0]}`),
        ...navHappened.map((r) => `a navigation ${r.type} ${r.url}`),
        ...network.filter((r) => r.decision === 'pass').map((r) => `a network request passed ${r.url}`),
        ...downloads.filter((r) => r.policy === 'allowed').map((r) => `a download allowed ${r.url}`),
        ...opens.filter((r) => r.type === 'did-create-window').map((r) => `a window made ${r.url}`),
        ...(created.length > (baseline.created ?? 0) ? [`${created.length} web contents created (baseline ${baseline.created})`] : []),
      ];
      const asked = [
        ...navBlocked.map((r) => `${r.type} to ${r.url} (blocked)`),
        ...network.filter((r) => r.decision === 'cancel').map((r) => `a request for ${r.url} (cancelled, ${r.branch})`),
        ...scheme.map((r) => `a request in the scheme for ${r.url} (${r.decision})`),
        ...downloads.filter((r) => r.policy === 'cancelled').map((r) => `a download of ${r.url} (cancelled)`),
        ...opens.filter((r) => r.type === 'window-open').map((r) => `a window for ${r.url} (denied)`),
      ];
      const viewer = probes.find((p) => p.probe && !p.probe.error)?.probe;
      const control = name === 'baseline' || name.startsWith('control') || name.startsWith('detector');
      result('e', name, control ? 'record' : happened.length ? 'fail' : 'pass', `${d.ok ? 'drawn' : 'NOT drawn'}; page ${viewer?.pageInput ?? '?'} of ${viewer?.docLength ?? '?'}; happened: ${happened.join('; ') || 'nothing'}; asked and refused: ${asked.join('; ') || 'nothing'}; console lines ${consoles.length}; pictures e-${name}.png (${pic.colours} colours)${screen ? ` and e-${name}-screen.png` : ', no screen picture'}`, { newX, procs, opened, navs, network, scheme, downloads, opens, created: created.length, consoles: consoles.map((c) => `${c.level} ${c.message}`).slice(0, 20), xAfter });
      win.destroy();
      await sleep(700);
      const left = xWindows().filter((w) => w.mapped && !before.x.has(w.id));
      if (left.length) result('e', `${name}-left-open`, 'record', `windows still mapped after the case's window closed: ${left.map((w) => `"${w.name}" ${w.width}x${w.height}`).join(', ')}`);
    }
    // Positive controls for the native-window reading: an alert of the window's own page, and the window's print.
    for (const [name, act] of [['detector-alert', (w) => void w.webContents.executeJavaScript('alert("Invented alert of the window")', true)], ['detector-print', (w) => w.webContents.print({}, () => {})]]) {
      const win = await openWindow({ width: 600, height: 400 });
      await sleep(500);
      const beforeX = new Set(xWindows().filter((w) => w.mapped).map((w) => w.id));
      act(win);
      await sleep(2500);
      const newX = xWindows().filter((w) => w.mapped && !beforeX.has(w.id));
      const screen = screenShot(join(out, `e-${name}-screen.png`));
      result('e', name, 'record', `native windows that appeared: ${newX.map((w) => `"${w.name}" ${w.width}x${w.height}`).join(', ') || 'none'}${screen ? `; picture e-${name}-screen.png` : ''}`, { newX });
      win.destroy();
      await sleep(700);
    }
  },

  // Row f: the same UTF-8 text served bare and labelled, and a windows-1252 page that declares itself.
  async f() {
    const text = 'Café naïve — “quoted” 한국어 텍스트';
    const text1252 = 'Café naïve — “quoted” £5';
    const page8 = Buffer.from(`<!doctype html><html><head><title>f</title></head><body><p id="t">${text}</p></body></html>`, 'utf8');
    const map1252 = { 'é': 0xe9, 'ï': 0xef, '—': 0x97, '“': 0x93, '”': 0x94, '£': 0xa3 };
    const body1252 = `<!doctype html><html><head><meta charset="windows-1252"><title>f</title></head><body><p id="t">${text1252}</p></body></html>`;
    const page1252 = Buffer.from([...body1252].map((c) => map1252[c] ?? c.charCodeAt(0)));
    const win = await openWindow({ width: 1400, height: 400 });
    const lang = argv.lang ?? 'default';
    const cases = [
      ['utf8-bare', page8, 'text/html', text],
      ['utf8-labelled', page8, 'text/html; charset=utf-8', text],
      ['declared-1252', page1252, 'text/html', text1252],
    ];
    const ts = cases.map(([name, bytes, mime]) => tokens.issue({ owner: win.webContents.id, name: `${name}.html`, mime, bytes, kind: 'html' }));
    for (let i = 0; i < cases.length; i++) await mount(win, { id: cases[i][0], kind: 'html', url: ts[i].url, width: 440, height: 120 });
    await sleep(2500);
    const locale = { appLocale: app.getLocale(), system: app.getPreferredSystemLanguages?.() ?? null, page: await page(win, 'spike.language()') };
    result('f', `${lang}: locale`, 'record', JSON.stringify(locale));
    for (let i = 0; i < cases.length; i++) {
      const [name, , mime, expect] = cases[i];
      const r = await frameText(ts[i].url);
      const right = r.t === expect;
      result('f', `${lang}: ${name}`, name === 'utf8-bare' ? 'record' : right ? 'pass' : 'fail', `served ${mime}: decoded as ${r.cs}; text ${right ? 'reads right' : `reads wrong (${JSON.stringify(r.t)})`}`, { read: r });
    }
    await picture(win, join(out, `f-${lang}.png`));
  },

  // Row g: the clips with the type the files service answers for each name (src/shared/files/mime.ts).
  async g() {
    const win = await openWindow({ width: 1400, height: 400 });
    const manifest = JSON.parse(readFileSync(join(argv.media, 'manifest.json'), 'utf8'));
    for (const [name, mime] of [['clip.mov', 'video/quicktime'], ['clip.mkv', 'video/x-matroska'], ['clip.webm', 'video/webm'], ['clip.mp4', 'video/mp4']]) {
      if (!exists(join(argv.media, name))) {
        result('g', name, 'record', `not made: no MediaRecorder container for it (${JSON.stringify(manifest.supported)})`);
        continue;
      }
      const t = tokens.issue({ owner: win.webContents.id, name, mime, bytes: media(name), kind: 'video' });
      await mount(win, { id: name, kind: 'video', url: t.url, width: 320, height: 240 });
      const s = await waitMedia(win, name, 6000);
      const played = s?.error ? null : await page(win, `spike.play(${JSON.stringify(name)})`);
      const can = await page(win, `spike.canPlayType("video", ${JSON.stringify(mime)})`);
      result('g', name, 'record', `served ${mime} (${manifest.made[name]?.recordedAs}); canPlayType "${can}"; ${s?.error ? `element error ${s.error.code} ${s.error.message ?? ''}` : played?.played ? `plays (at ${played.currentTime.toFixed(2)} s)` : `does not play (${JSON.stringify(played)})`}; events ${(s?.events ?? []).join('/')}`);
    }
    await picture(win, join(out, 'g-window.png'));
  },

  async hi() {
    await toolbarAndSidebar([['h', 'plain', 360, ''], ['h', 'toolbar=0', 360, '#toolbar=0'], ['i', 'plain', 700, ''], ['i', 'navpanes=0', 700, '#navpanes=0'], ['i', 'plain-1000', 1000, '']]);
  },
  // The same with the fragment first, in a profile of its own: what was seen does not depend on the order.
  async 'hi-reversed'() {
    await toolbarAndSidebar([['h', 'toolbar=0 (first)', 360, '#toolbar=0'], ['h', 'plain (second)', 360, ''], ['i', 'navpanes=0 (first)', 700, '#navpanes=0'], ['i', 'plain (second)', 700, '']]);
  },
};

// Rows h and i: the viewer's toolbar and its sidebar, read from the viewer's own elements twice after it drew.
const visible = (box) => !!box && box.w > 0 && box.h > 0 && box.display !== 'none' && box.visibility !== 'hidden' && !box.hidden;
async function toolbarAndSidebar(list) {
  const bytes = pagesPdf();
  for (const [row, part, width, fragment] of list) {
    const win = await openWindow({ width: width + 120, height: 800 });
    const t = tokens.issue({ owner: win.webContents.id, name: 'several-pages.pdf', mime: 'application/pdf', bytes, kind: 'pdf' });
    const id = `${row}-${part}`;
    await mount(win, { id, kind: 'pdf', url: t.url + fragment, width, height: 640 });
    const d = await waitDrawn(t.url, 20000);
    await sleep(1500);
    const first = drawnProbe(await probeViewer(t.url));
    await sleep(2500);
    const second = drawnProbe(await probeViewer(t.url));
    const st = await stateOf(win, id);
    const pic = await picture(win, join(out, `${row}-${part.replace(/[^a-z0-9]+/gi, '-')}.png`), st?.rect);
    const say = (p) => p ? `toolbar ${p.toolbar ? `${p.toolbar.w}x${p.toolbar.h}${visible(p.toolbar) ? '' : ' (not shown)'}` : 'absent'}; sidenav ${p.sidenav ? `${p.sidenav.w}x${p.sidenav.h} at x ${p.sidenav.x}${visible(p.sidenav) ? '' : ' (not shown)'}` : 'absent'}; sidenav container ${p.sidenavContainer ? `${p.sidenavContainer.w}x${p.sidenavContainer.h}` : 'absent'}; plugin ${(p.embed ?? p.plugin) ? `${(p.embed ?? p.plugin).w}x${(p.embed ?? p.plugin).h} at x ${(p.embed ?? p.plugin).x}` : 'absent'}; viewer attrs ${JSON.stringify(p.viewerAttrs)}` : 'no viewer read';
    result(row, part, 'record', `frame ${width}x640${fragment ? ` ${fragment}` : ''}: ${d.ok ? 'drawn' : 'NOT drawn'}; at +1.5 s: ${say(first)}; at +4 s: ${say(second)}; picture ${pic.width}x${pic.height}`, { first, second, dump: d.probe?.dump ?? null });
    win.destroy();
    await sleep(500);
  }
}
const drawnProbe = (probes) => probes.find((p) => p.probe && !p.probe.error)?.probe ?? null;

app.on('window-all-closed', () => {}); // a case closes its window; the suite, not Electron's default, ends the app
app.whenReady().then(async () => {
  setupSession(session.defaultSession, 'default');
  setupSession(session.fromPartition('file-frame-second'), 'second');
  try {
    await suites[suite]();
  } catch (error) {
    result('setup', suite, 'fail', `the suite threw: ${error?.stack ?? error}`);
  }
  app.exit(0);
});
