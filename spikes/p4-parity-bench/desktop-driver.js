// The parity bench's Desktop driver (P4-A1): the GUI half of one Desktop repetition, for `cua_repl` on the Mac mini,
// where Claude Desktop runs signed in to the owner's account (findings.txt §7a; `devices_use mini`). Timing never comes
// from here: the parser reads the engine's own records, so the driver's latency drops out. Its duties are to start a
// fresh session with the arm's controls, send the task's prompt verbatim, wait for the turn to end and, for a cloud
// Cowork session, have the session hand over its own transcript and download it on the mini.
//
// Desktop 3.1623.0 (read live in Part A, 2026-10-21) has two surfaces the bench uses:
//   code   the Code tab: a local Claude Code session on the mini in a folder (engine 2.1.304, records under the mini's
//          ~/.claude/projects). The documents' cells, and the decks' fallback (c), plain deck.html.
//   cowork the Claude tab: Cowork in Anthropic's cloud (CLAUDE_CODE_ENTRYPOINT=remote_cowork, a Linux VM, engine 2.1.305)
//          with the Slides deck kind (`Artifact`); the Mac mini is attached as a device. Its transcript lives in the VM
//          (/root/.claude/projects/-home-claude/<id>.jsonl) and reaches the mini only by the hand-over below.
//
// One repetition, by the agent holding the GUI:
//   1. Bash:     python3 -I spikes/p4-parity-bench/desktop-prep.py before <task> <rep> --out <run> [--surface code|cowork]
//                  [--seed next]   (a cloud deck of the record: its seed deck, named in the prompt by its url)
//   2. cua_repl: this file's text once per kernel (it defines globalThis.bench), then
//                await bench.rep({ surface: 'code', folder: '<printed folder>', prompt: '<printed prompt>' })
//                await bench.rep({ surface: 'cowork', prompt: '<printed prompt>' })   then   await bench.handOver()
//                (rep's permissionsAnswered counts the permission cards it had to answer)
//   3. Bash:     python3 -I spikes/p4-parity-bench/desktop-prep.py after <task> <rep> --out <run>
//                  --permissions-answered <step 2's permissionsAnswered> [--transcript newest]   (a Cowork turn: its hand-over)
// Cowork seeds, four side by side: bench.send({ surface: 'cowork', prompt: <desktop-prep.py seed-prompt> }) four times,
// keeping each returned url; then for each, bench.reopen(url), bench.handOver() and desktop-prep.py seed-add newest
// --out <run>. (One seed at a time: bench.rep, bench.handOver, seed-add.)
//
// Every step observes, acts, then verifies; a step whose verification fails throws with the lines it saw, and the
// repetition is redone from step 1. Before any prompt is sent the session on screen must be a new, empty one (the Code
// tab's selected sidebar item 새 세션, the Claude tab's page claude.ai/new): a New click that failed silently would
// put the prompt into an existing session, with its context and cache. The labels are 3.1623.0's Korean UI (the
// owner's Desktop runs ko-KR, input source ABC), with English beside some; `bench.probe()` reports which of them the
// live tree shows, and `bench.probe({ save: '<run>/ax' })` keeps the report with the whole tree there (§7a's rule).
// The Claude tab's recent list (read live in Part B, §7c; P4-A3): a row is "버튼 <title>" with "팝업 버튼 <title>에 대한
// 더 많은 옵션" beside it, so a row is a button whose title a menu button beside it names (`recentItems`).

const L = {
  modeCode: [/라디오 버튼 Description: Code/],
  modeClaude: [/라디오 버튼 Description: Claude/],
  newSession: [/^\s*\d+\s+버튼 새로 만들기$/, /버튼 새로 생성/, /button New/], // P4-A3: 새로 만들기 since the web UI of 2026-10-21 evening
  // the session on screen is a new one: the Code tab's sidebar item for it, selected; the Claude tab's page
  codeNewItem: [/^\s*\d+\s+항목 새 세션, Value: 1(,|$)/],
  pageUrl: [/HTML 콘텐츠 .*, URL: [^\s,]+/],
  cloudNewPage: [/HTML 콘텐츠 .*, URL: (https:\/\/)?claude\.ai\/new\/?([?#][^\s,]*)?(,|$)/],
  recentItem: [/^\s*\d+\s+팝업 버튼 .+에 대한 더 많은 옵션$/], // a recent row's menu button; the row is the button before it
  folderPopup: [/팝업 버튼 (Description: )?폴더:/], // P4-A3: without Description while no folder is chosen
  openFolder: [/^\s*\d+\s+폴더 열기…/, /Open folder…/],
  panelPath: [/텍스트 필드 \(settable\).*ID: PathTextField/],
  panelOpen: [/버튼 열기, ID: OKButton/, /button Open, ID: OKButton/],
  trust: [/버튼 작업 공간 신뢰/, /button Trust workspace/],
  permissionAuto: [/팝업 버튼 (권한: )?자동$/, /popup button (Permission: )?Auto$/],
  permissionPopup: [/팝업 버튼 (권한: )?(자동|수동|편집 수락|계획)/],
  permissionAutoItem: [/^\s*\d+\s+자동( |,|$)/],
  modelPopup: [/팝업 버튼 모델:/],
  modelOpusExtra: [/팝업 버튼 모델: Opus 5\.5 엑스트라/],
  modelOpusItem: [/^\s*\d+\s+Opus 5\.5( |,)/],
  effortItem: [/^\s*\d+\s+노력 /],
  effortExtraItem: [/^\s*\d+\s+엑스트라, Value/],
  promptCode: [/텍스트 엔트리 영역 \(settable\) Description: 프롬프트/],
  promptCloud: [/텍스트 엔트리 영역 \(settable\)( Description: Claude에게 프롬프트를 입력하세요\.)?/],
  sendCode: [/버튼 보내기$/],
  sendCloud: [/버튼 메시지 보내기$/],
  stop: [/버튼 (응답 )?중지$/, /button Stop$/],
  alwaysAllow: [/버튼 항상 허용/, /button Always allow/],
  download: [/버튼 다운로드/, /button Download/],
  save: [/버튼 저장, ID: OKButton/, /button Save, ID: OKButton/],
};

// The waits, in ms (a test shortens them).
const T = { fresh: 5_000, savePanel: 5_000, sessionUrl: 15_000, reopenSettle: 5_000, turnSettle: 3_000, turn: 600_000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = (state) => state.split('\n');
function findAll(state, patterns) {
  const out = [];
  for (const line of lines(state)) {
    const m = /^\s*(\d+)\s/.exec(line);
    if (m && patterns.some((p) => p.test(line))) out.push({ index: Number(m[1]), line: line.trim() });
  }
  return out.sort((x, y) => x.index - y.index);
}
function find(state, patterns, after = -1) {
  for (const p of patterns) {
    for (const line of lines(state)) {
      const m = /^\s*(\d+)\s/.exec(line);
      if (m && Number(m[1]) > after && p.test(line)) return { index: Number(m[1]), line: line.trim() };
    }
  }
  return null;
}
const has = (patterns) => (s) => find(s, patterns) !== null;
const lacks = (patterns) => (s) => find(s, patterns) === null;
const tree = (a) => a.getAXState({ emit: false, disableDiffing: true });

// The page's URL: the first web area's in the tree (the page itself; a frame inside it comes later).
function pageUrl(state) {
  const hit = find(state, L.pageUrl);
  return hit ? /, URL: ([^\s,]+)/.exec(hit.line)[1] : null;
}
const bareUrl = (u) => u.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const sameUrl = (x, y) => typeof x === 'string' && typeof y === 'string' && bareUrl(x) === bareUrl(y);

// The session on screen is a new, empty one, read on the surface's own sign.
function isNewSession(state, surface) {
  if (surface === 'code') return has(L.codeNewItem)(state);
  const page = find(state, L.pageUrl);
  return page !== null && L.cloudNewPage.some((p) => p.test(page.line));
}

// The hand-over's file card: the last Download button after the line naming the .jsonl file, else the last one (an
// earlier card, a deck's among them, is never the transcript's).
function pickDownload(state) {
  const buttons = findAll(state, L.download);
  let file = -1;
  for (const line of lines(state)) {
    const m = /^\s*(\d+)\s/.exec(line);
    if (m && /[\w.-]+\.jsonl\b/.test(line) && !L.download.some((p) => p.test(line))) file = Math.max(file, Number(m[1]));
  }
  const after = buttons.filter((b) => b.index > file);
  return (file >= 0 && after.length ? after : buttons).at(-1) ?? null;
}

// The recent list's rows: each button whose title the menu button right after it names, in tree order.
function recentItems(state) {
  const all = lines(state);
  const out = [];
  for (let i = 0; i + 1 < all.length; i++) {
    const row = /^\s*(\d+)\s+버튼 (.+)$/.exec(all[i]);
    const menu = /^\s*\d+\s+팝업 버튼 (.+)에 대한 더 많은 옵션$/.exec(all[i + 1]);
    if (row && menu && row[2] === menu[1]) out.push({ index: Number(row[1]), line: all[i].trim() });
  }
  return out;
}

async function app() {
  return cua.getApp('com.anthropic.claudefordesktop');
}

// Click the first element matching `patterns`, then wait up to `ms` for `until` (a predicate over the new tree).
async function clickUntil(a, name, patterns, until, ms = 10_000) {
  const before = await tree(a);
  const hit = find(before, patterns);
  if (!hit) throw new Error(`${name}: nothing matched ${patterns.map(String).join(' or ')}\n${lines(before).slice(0, 60).join('\n')}`);
  await a.click(hit.index);
  const deadline = Date.now() + ms;
  for (;;) {
    const s = await tree(a);
    if (!until || until(s)) return s;
    if (Date.now() > deadline) throw new Error(`${name}: clicked [${hit.index}] ${hit.line} and the expected state did not come within ${ms} ms`);
    await sleep(300);
  }
}

// The model at Opus 5.5 with effort Extra, checked on the pop-up's own text; the effort submenu opens with Right.
async function opusExtra(a) {
  if (has(L.modelOpusExtra)(await tree(a))) return;
  await clickUntil(a, 'the model pop-up', L.modelPopup, has(L.modelOpusItem));
  await clickUntil(a, 'Opus 5.5', L.modelOpusItem, null);
  if (has(L.modelOpusExtra)(await tree(a))) return;
  await clickUntil(a, 'the model pop-up again', L.modelPopup, has(L.effortItem));
  await clickUntil(a, 'effort', L.effortItem, null);
  await a.pressKey('Right');
  await clickUntil(a, 'Extra', L.effortExtraItem, null);
  if (!has(L.modelOpusExtra)(await tree(a))) throw new Error('the model pop-up does not read Opus 5.5 엑스트라 after setting it');
}

// The permission mode at Auto, checked on the pop-up's own text.
async function auto(a) {
  if (has(L.permissionAuto)(await tree(a))) return;
  await clickUntil(a, 'the permission pop-up', L.permissionPopup, has(L.permissionAutoItem));
  await clickUntil(a, 'Auto', L.permissionAutoItem, has(L.permissionAuto));
}

// A fresh Code session in `folder`: the Code tab, New, the folder through the system panel (⇧⌘G, the path, Open), the
// workspace trusted once, then Auto and Opus 5.5 at Extra.
async function newCodeSession(a, folder) {
  await clickUntil(a, 'the Code tab', L.modeCode, has(L.newSession));
  await clickUntil(a, 'New', L.newSession, has(L.folderPopup));
  const current = find(await tree(a), L.folderPopup);
  if (!current.line.includes(folder)) {
    await clickUntil(a, 'the folder pop-up', L.folderPopup, has(L.openFolder));
    await clickUntil(a, 'Open folder…', L.openFolder, has(L.panelOpen));
    await a.pressKey('super+shift+g');
    let s = await tree(a);
    const path = find(s, L.panelPath);
    if (!path) throw new Error('the Go to Folder field did not open');
    await a.setValue(path.index, folder);
    await a.pressKey('Return');
    await clickUntil(a, 'Open', L.panelOpen, lacks(L.panelOpen));
    s = await tree(a);
    if (has(L.trust)(s)) await clickUntil(a, 'Trust workspace', L.trust, lacks(L.trust));
    const now = find(await tree(a), L.folderPopup);
    if (!now || !now.line.includes(folder.replace(/^\/tmp\//, '/private/tmp/')) && !now.line.includes(folder)) throw new Error(`the folder pop-up reads ${now && now.line}`);
  }
  await auto(a);
  await opusExtra(a);
}

// A fresh cloud Cowork session: the Claude tab, New, Auto and Opus 5.5 at Extra.
async function newCloudSession(a) {
  await clickUntil(a, 'the Claude tab', L.modeClaude, has(L.newSession));
  await clickUntil(a, 'New', L.newSession, has(L.promptCloud));
  await auto(a);
  await opusExtra(a);
}

// A new session on the surface with its controls set, and verified new and empty just before anything is sent: else
// the prompt is refused, since it would land in an existing session.
async function newSession(a, surface, folder) {
  if (surface === 'code') await newCodeSession(a, folder);
  else if (surface === 'cowork') await newCloudSession(a);
  else throw new Error(`surface is code or cowork, not ${surface}`);
  const deadline = Date.now() + T.fresh;
  for (;;) {
    const s = await tree(a);
    if (isNewSession(s, surface)) return;
    if (Date.now() > deadline) {
      const seen = surface === 'code' ? 'no selected 새 세션 item in the sidebar' : `the page is ${pageUrl(s)}, not claude.ai/new`;
      throw new Error(`the session on screen is not a new one (${seen}): the prompt is not sent\n${lines(s).filter((l) => /항목 |HTML 콘텐츠/.test(l)).slice(0, 20).join('\n')}`);
    }
    await sleep(300);
  }
}

// The prompt pasted whole (its quotes unchanged), checked in the field, then sent; verified by Stop appearing.
async function sendPrompt(a, surface, prompt) {
  const s = await tree(a);
  const field = find(s, surface === 'code' ? L.promptCode : L.promptCloud);
  if (!field) throw new Error('no prompt field');
  await a.click(field.index);
  await a.paste(prompt, { format: 'text' });
  const typed = await tree(a);
  if (!typed.includes(prompt.slice(-40)) && !typed.includes(prompt.split('\n')[0].slice(0, 60))) throw new Error('the prompt did not land in the field whole');
  await clickUntil(a, 'Send', surface === 'code' ? L.sendCode : L.sendCloud, has(L.stop), 30_000);
}

// The turn's end: Stop gone for T.turnSettle. A permission card is answered Always allow and counted (a human stop).
async function waitTurn(a) {
  const deadline = Date.now() + T.turn;
  let goneSince = null;
  const answered = [];
  for (;;) {
    const s = await tree(a);
    const allow = find(s, L.alwaysAllow);
    if (allow) {
      answered.push(allow.line);
      await a.click(allow.index);
    }
    goneSince = has(L.stop)(s) ? null : (goneSince ?? Date.now());
    if (goneSince !== null && Date.now() - goneSince > T.turnSettle) return { permissionsAnswered: answered.length, permissionCards: answered };
    if (Date.now() > deadline) throw new Error(`the turn did not end within ${T.turn / 60_000} minutes`);
    await sleep(500);
  }
}

// The untimed hand-over that follows a cloud turn in the same session (the one on screen; a turn still running there,
// a reopened seed's, is waited out first): the session sends its own transcript file, and its card's Download is
// clicked on the mini (~/Downloads), with Save if a save panel comes within T.savePanel. Whether the file arrived is
// not seen from here: desktop-prep's `newest` confirms it. The hand-over's records come after the timed turn's, so the
// parser's turn window leaves them out.
const HAND_OVER = 'Send me this session\'s own transcript file with SendUserFile: the most recently modified .jsonl file under ~/.claude/projects/. Make no other change and call no other tool except to find that file.';
const CONFIRM = 'desktop-prep.py after --transcript newest (or seed-add newest) confirms the file';
async function handOver() {
  const a = await app();
  if (has(L.stop)(await tree(a))) await waitTurn(a);
  await sendPrompt(a, 'cowork', HAND_OVER);
  const turn = await waitTurn(a);
  const s = await tree(a);
  const card = pickDownload(s);
  if (!card) return { ...turn, downloaded: false, note: 'no download button in the tree: download the file card by hand and say so', lines: lines(s).filter((l) => /jsonl|다운로드|Download|파일/.test(l)).slice(-12) };
  await a.click(card.index);
  const deadline = Date.now() + T.savePanel;
  for (;;) {
    const t = await tree(a);
    const save = find(t, L.save);
    if (save) {
      await a.click(save.index);
      return { ...turn, downloaded: 'unconfirmed', via: 'the save panel, Save clicked', button: card.line, note: CONFIRM };
    }
    if (Date.now() > deadline) return { ...turn, downloaded: 'unconfirmed', via: `no save panel within ${T.savePanel} ms`, button: card.line, note: CONFIRM };
    await sleep(500);
  }
}

// A Claude-tab session reopened from the sidebar's recent list: the recent items clicked in turn, each from a fresh
// tree, until the page's URL is the given one; the first eight only.
async function reopen(url) {
  const a = await app();
  let s = await clickUntil(a, 'the Claude tab', L.modeClaude, has(L.newSession));
  if (sameUrl(pageUrl(s), url)) return pageUrl(s);
  const tried = [];
  for (let i = 0; i < 8; i++) {
    const item = recentItems(s)[i];
    if (!item) break;
    const before = pageUrl(s);
    await a.click(item.index);
    const deadline = Date.now() + T.reopenSettle;
    do {
      await sleep(300);
      s = await tree(a);
    } while (pageUrl(s) === before && Date.now() < deadline);
    const now = pageUrl(s);
    if (sameUrl(now, url)) return now;
    tried.push(`${item.line} -> ${now}`);
  }
  throw new Error(`no recent item of the first eight opened ${url}:\n${tried.join('\n')}`);
}

globalThis.bench = {
  L,
  T,
  pageUrl,
  isNewSession,
  pickDownload,
  recentItems,
  // What the live tree shows of each label (the hold's first step, and whenever a step throws); with `save`, a
  // directory (the run's ax/), the report, the recent rows and the whole tree are written there as probe-<time>.json,
  // so a label is fixed from saved lines (§7a). `note` says what was on screen.
  async probe({ save, note } = {}) {
    const s = await tree(await app());
    const report = {};
    for (const [key, patterns] of Object.entries(L)) report[key] = find(s, patterns)?.line ?? null;
    const result = { report };
    if (save) {
      const fs = await import('node:fs');
      fs.mkdirSync(save, { recursive: true });
      const file = `${save.replace(/\/+$/, '')}/probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), note: note ?? null, report, recentItems: recentItems(s), tree: s }, null, 2)}\n`);
      result.saved = file;
    }
    nodeRepl.write(JSON.stringify({ ...result, ...(result.saved && { tree: undefined }) }, null, 2));
    return { ...report, ...(result.saved && { saved: result.saved }) };
  },
  // One timed repetition: a fresh session on the surface, the prompt sent, the turn waited out.
  async rep({ surface, folder, prompt }) {
    const a = await app();
    await newSession(a, surface, folder);
    const sentAt = new Date().toISOString();
    await sendPrompt(a, surface, prompt);
    const result = await waitTurn(a);
    nodeRepl.write(JSON.stringify({ surface, sentAt, endedAt: new Date().toISOString(), ...result }));
    return result;
  },
  // A prompt sent in a fresh session, not waited out (cloud seeds side by side): returns once Stop appears, with the
  // page's URL (for the Claude tab, once it has left claude.ai/new) for bench.reopen.
  async send({ surface, folder, prompt }) {
    const a = await app();
    await newSession(a, surface, folder);
    const sentAt = new Date().toISOString();
    await sendPrompt(a, surface, prompt);
    const deadline = Date.now() + T.sessionUrl;
    let s = await tree(a);
    while (surface === 'cowork' && isNewSession(s, surface) && Date.now() < deadline) {
      await sleep(500);
      s = await tree(a);
    }
    const url = pageUrl(s);
    const result = { surface, sentAt, url };
    if (surface === 'cowork' && isNewSession(s, surface)) Object.assign(result, { url: null, note: `the page was still claude.ai/new ${T.sessionUrl} ms after the send: hand this session over now, while it is on screen` });
    nodeRepl.write(JSON.stringify(result));
    return result;
  },
  reopen,
  handOver,
};
nodeRepl.write('bench driver loaded (Desktop 3.1623.0): bench.probe(), bench.rep({ surface: "code"|"cowork", folder, prompt }), bench.send({ surface, folder, prompt }), bench.reopen(url), bench.handOver()');
