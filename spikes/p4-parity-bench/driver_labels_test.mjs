import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const written = [];
globalThis.nodeRepl = { write(s) { written.push(s); } };
let screen = null; // the fake Desktop the flows below drive
globalThis.cua = { getApp: async () => screen };
const src = readFileSync(process.argv[2], 'utf8');
(0, eval)(src);
const { bench } = globalThis;
const L = bench.L;
// lines read live from Desktop 3.1623.0 in Part A (2026-10-21)
const cases = {
  modeCode: '13 라디오 버튼 Description: Code, Value: 1',
  modeClaude: '12 라디오 버튼 Description: Claude, Value: 0',
  newSession: '122 버튼 새로 생성',
  codeNewItem: '141 항목 새 세션, Value: 1',
  pageUrl: '3 HTML 콘텐츠 새 세션 - Claude, URL: claude.ai/new',
  cloudNewPage: '3 HTML 콘텐츠 새 세션 - Claude, URL: claude.ai/new',
  folderPopup: '206 팝업 버튼 Description: 폴더: /private/tmp/maws-parity-bench/MAWS parity bench, Help: /private/tmp/maws-parity-bench/MAWS parity bench',
  openFolder: '185 폴더 열기…',
  panelPath: '87 텍스트 필드 (settable) Value: /Users/new/x, ID: PathTextField',
  panelOpen: '132 버튼 열기, ID: OKButton',
  trust: '108 버튼 작업 공간 신뢰',
  permissionAuto: '207 팝업 버튼 권한: 자동',
  permissionAutoItem: '77 자동 Claude가 자체적으로 실행되며 안전하지 않아 보이는 것이 있으면 일시 중지하고 확인합니다., Value: 0',
  modelOpusExtra: '208 팝업 버튼 모델: Opus 5.5 엑스트라',
  modelOpusItem: '76 Opus 5.5 복잡한 작업과 일상 업무를 위해, Value: 1',
  effortItem: '79 노력 높음',
  effortExtraItem: '86 엑스트라, Value: 0',
  promptCode: '202 텍스트 엔트리 영역 (settable) Description: 프롬프트, Value: ',
  promptCloud: '61 텍스트 엔트리 영역 (settable) Description: Claude에게 프롬프트를 입력하세요., Value: ',
  sendCode: '121 버튼 보내기',
  sendCloud: '67 버튼 메시지 보내기',
  stop: '150 버튼 중지',
  // P4-A3 hold (b), 2026-10-21 21:12Z: the Code tab's New and its folder pop-up before a folder is chosen
  newSessionNow: '16 버튼 새로 만들기',
  folderPopupUnset: '129 팝업 버튼 폴더: 폴더 선택…',
  // §7c: the Claude tab's recent list, a row's button and its menu button beside it (read live in Part B)
  recentItem: '58 팝업 버튼 Autumn Workshops 2026 slide deck에 대한 더 많은 옵션',
};
const PROBE_PAGE = '3 HTML 콘텐츠 Available tools and system info - Claude, URL: claude.ai/chat/55cfb041-2381-476f-939b-a5078f7f0e4d';
const negatives = {
  permissionAuto: ['72 팝업 버튼 수동'],
  sendCode: ['67 버튼 메시지 보내기'],
  modelOpusExtra: ['69 팝업 버튼 모델: Opus 5.5 높음'],
  effortExtraItem: ['220 노력 엑스트라'],
  openFolder: ['157 팝업 버튼 Description: 폴더: ~/Documents/GitHub/doperpowers'],
  modelOpusItem: ['208 팝업 버튼 모델: Opus 5.5 엑스트라'],
  // an existing session on screen: another session's item selected, or the new one not selected; a chat's page
  codeNewItem: ['141 항목 Available tools inventory, Value: 1', '141 항목 새 세션, Value: 0'],
  cloudNewPage: [PROBE_PAGE, '3 HTML 콘텐츠 Claude, URL: claude.ai/newsletter'],
  recentItem: ['141 항목 새 세션, Value: 1', '57 버튼 Autumn Workshops 2026 slide deck', '122 버튼 새로 생성'],
  newSession: ['23 팝업 버튼 템플릿으로 새로 만들기', '31 버튼 afleet 섹션에서 새 세션'],
};
let bad = 0;
const fail = (...why) => { bad++; console.log(...why); };
const LABEL_OF = { newSessionNow: 'newSession', folderPopupUnset: 'folderPopup' };
for (const [k, line] of Object.entries(cases)) if (!L[LABEL_OF[k] ?? k].some((p) => p.test(line))) fail('MISS', k, line);
for (const [k, ls] of Object.entries(negatives)) for (const line of ls) if (L[k].some((p) => p.test(line))) fail('FALSE', k, line);
const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail('WRONG', what, JSON.stringify(got), '!=', JSON.stringify(want)); };

// The page's URL and the new-session sign on whole trees.
eq('pageUrl', bench.pageUrl(`1 창 Claude\n${PROBE_PAGE}\n40 HTML 콘텐츠 Slides, URL: claude.ai/artifact/CVsiKk2utAxFxm8aNrwmaA`), 'claude.ai/chat/55cfb041-2381-476f-939b-a5078f7f0e4d');
eq('isNewSession cowork', [bench.isNewSession(cases.cloudNewPage, 'cowork'), bench.isNewSession(PROBE_PAGE, 'cowork')], [true, false]);
eq('isNewSession code', [bench.isNewSession(`${cases.codeNewItem}\n142 항목 Available tools inventory, Value: 0`, 'code'), bench.isNewSession(negatives.codeNewItem[0], 'code')], [true, false]);

// The recent list's rows: a button with the menu button for the same title beside it, never another button.
const RECENTS = ['2 버튼 새로 생성', '57 버튼 Autumn Workshops 2026 slide deck', '58 팝업 버튼 Autumn Workshops 2026 slide deck에 대한 더 많은 옵션',
  '59 버튼 Available tools and system info', '60 팝업 버튼 Available tools and system info에 대한 더 많은 옵션', '61 버튼 보내기',
  '70 버튼 Orphan title', '72 팝업 버튼 Another title에 대한 더 많은 옵션'].join('\n');
eq('recentItems', bench.recentItems(RECENTS).map((r) => r.index), [57, 59]);

// The hand-over's Download: the last after the line naming the .jsonl file, else the last; never an earlier card's.
const FILE = '40 텍스트 3f9a2c1e-7b4d-4e8a-9c61-0f4d2b7a8e13.jsonl';
const pick = (...ls) => bench.pickDownload(ls.join('\n'))?.index ?? null;
eq('pickDownload after the file', pick('20 텍스트 Send me ... the most recently modified .jsonl file under ~/.claude/projects/.', '30 버튼 다운로드', FILE, '41 버튼 다운로드'), 41);
eq('pickDownload, no file line', pick('30 버튼 다운로드', '41 버튼 다운로드'), 41);
eq('pickDownload, none after the file', pick('30 버튼 다운로드', FILE), 30);
eq('pickDownload, the reply names the file after its card', pick('30 버튼 다운로드', '41 버튼 다운로드', '50 텍스트 Sent /root/.claude/projects/-home-claude/3f9a.jsonl'), 41);
eq('pickDownload, no button', pick(FILE), null);

// The flows, on a fake Claude tab: a page, the controls set, a prompt field, Send that starts a turn, the sidebar's
// recent chats, and the hand-over's cards.
function claudeTab({ page, newWorks = true, chats = [], cards = [], savePanel = false }) {
  const st = { page, field: '', stopRenders: 0, saveShown: false, clicks: [], sent: [] };
  const fake = {
    st,
    async getAXState() {
      const running = st.stopRenders > 0;
      if (running) st.stopRenders--;
      return ['1 라디오 버튼 Description: Claude, Value: 1', '2 버튼 새로 생성', `3 HTML 콘텐츠 Claude, URL: ${st.page}`, '4 팝업 버튼 권한: 자동',
        '5 팝업 버튼 모델: Opus 5.5 엑스트라', `6 텍스트 엔트리 영역 (settable) Description: Claude에게 프롬프트를 입력하세요., Value: ${st.field}`,
        running ? '7 버튼 중지' : '7 버튼 메시지 보내기', ...chats.flatMap((c, i) => [`${20 + 2 * i} 버튼 ${c.title}`, `${21 + 2 * i} 팝업 버튼 ${c.title}에 대한 더 많은 옵션`]),
        ...cards, ...(st.saveShown ? ['90 버튼 저장, ID: OKButton'] : [])].join('\n');
    },
    async click(i) {
      st.clicks.push(i);
      if (i === 2 && newWorks) st.page = 'claude.ai/new';
      if (i === 7 && st.stopRenders === 0) {
        st.sent.push(st.field);
        st.field = '';
        st.stopRenders = 2;
        if (st.page === 'claude.ai/new') st.page = `claude.ai/chat/sent-${st.sent.length}`;
      }
      if (i >= 20 && i < 20 + 2 * chats.length) st.page = i % 2 === 0 ? chats[(i - 20) / 2].url : st.page; // a menu button opens no chat
      if (cards.some((c) => c.startsWith(`${i} `)) && savePanel) st.saveShown = true;
      if (i === 90) st.saveShown = false;
    },
    async paste(text) { st.field = text; },
    async pressKey() {},
    async setValue() {},
  };
  return fake;
}
Object.assign(bench.T, { fresh: 50, savePanel: 50, sessionUrl: 50, reopenSettle: 50, turnSettle: 0, turn: 10_000 });
const PROMPT = 'Make a new slide deck with the Artifact tool, titled "Autumn Workshops 2026".';
const throws = async (what, f, text) => {
  try { await f(); fail('NO THROW', what); } catch (e) { if (!String(e.message).includes(text)) fail('WRONG THROW', what, e.message); }
};

// New failing silently leaves the probe's chat on screen: the prompt is refused, never sent.
screen = claudeTab({ page: 'claude.ai/chat/55cfb041-2381-476f-939b-a5078f7f0e4d', newWorks: false });
await throws('send into an existing session', () => bench.send({ surface: 'cowork', prompt: PROMPT }), 'not a new one (the page is claude.ai/chat/55cfb041');
await throws('rep into an existing session', () => bench.rep({ surface: 'cowork', prompt: PROMPT }), 'not a new one');
eq('nothing sent into the existing session', [screen.st.sent, screen.st.clicks.includes(7)], [[], false]);

// send: a new session, the prompt sent, back once Stop appears with the chat's URL.
screen = claudeTab({ page: 'claude.ai/chat/55cfb041-2381-476f-939b-a5078f7f0e4d' });
const sent = await bench.send({ surface: 'cowork', prompt: PROMPT });
eq('send', [sent.url, screen.st.sent], ['claude.ai/chat/sent-1', [PROMPT]]);

// reopen: the recent items clicked in turn until the page is the one asked for; the first eight only.
const chats = Array.from({ length: 10 }, (_, i) => ({ title: 'Autumn Workshops 2026', url: `claude.ai/chat/c${i}` }));
screen = claudeTab({ page: 'claude.ai/new', chats });
eq('reopen', await bench.reopen('https://claude.ai/chat/c3/'), 'claude.ai/chat/c3');
eq('reopen clicked', screen.st.clicks.filter((i) => i >= 20), [20, 22, 24, 26]);
screen = claudeTab({ page: 'claude.ai/new', chats });
await throws('reopen of a session not among the first eight', () => bench.reopen('claude.ai/chat/c9'), 'no recent item of the first eight');
eq('reopen gave up after eight', screen.st.clicks.filter((i) => i >= 20).length, 8);

// handOver: the transcript's card downloaded, Save clicked if a save panel comes, the file left for newest to confirm.
const CARDS = ['30 버튼 다운로드', FILE, '41 버튼 다운로드'];
for (const savePanel of [false, true]) {
  screen = claudeTab({ page: 'claude.ai/chat/c0', cards: CARDS, savePanel });
  const h = await bench.handOver();
  eq(`handOver (save panel ${savePanel})`, [h.downloaded, h.button, screen.st.clicks.filter((i) => i >= 30)], ['unconfirmed', '41 버튼 다운로드', savePanel ? [41, 90] : [41]]);
}

// probe({save}): the report and the whole tree written under the run's ax/ by the driver itself (§7a's rule).
const ax = mkdtempSync(join(tmpdir(), 'bench-ax-'));
try {
  screen = claudeTab({ page: 'claude.ai/new', chats: chats.slice(0, 2) });
  const probed = await bench.probe({ save: join(ax, 'ax'), note: 'hold start' });
  const files = readdirSync(join(ax, 'ax'));
  eq('probe saved one file', [files.length, probed.saved === join(ax, 'ax', files[0])], [1, true]);
  const kept = JSON.parse(readFileSync(join(ax, 'ax', files[0]), 'utf8'));
  eq('probe file', [kept.note, kept.report.recentItem, kept.recentItems.length, kept.tree.includes('20 버튼 Autumn Workshops 2026')], ['hold start', '21 팝업 버튼 Autumn Workshops 2026에 대한 더 많은 옵션', 2, true]);
  eq('probe without save writes nothing', [(await bench.probe()).saved, readdirSync(join(ax, 'ax')).length], [undefined, 1]);
} finally {
  rmSync(ax, { recursive: true, force: true });
}

console.log(bad ? `${bad} wrong` : `all ${Object.keys(cases).length} labels match, ${Object.values(negatives).flat().length} near misses refused, the flows hold`);
process.exit(bad ? 1 : 0);
