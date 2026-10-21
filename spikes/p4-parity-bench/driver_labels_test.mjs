import { readFileSync } from 'node:fs';
globalThis.nodeRepl = { write() {} };
globalThis.cua = {};
const src = readFileSync(process.argv[2], 'utf8');
(0, eval)(src);
const L = globalThis.bench.L;
// lines read live from Desktop 3.1623.0 in Part A (2026-10-21)
const cases = {
  modeCode: '13 라디오 버튼 Description: Code, Value: 1',
  modeClaude: '12 라디오 버튼 Description: Claude, Value: 0',
  newSession: '122 버튼 새로 생성',
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
};
const negatives = {
  permissionAuto: '72 팝업 버튼 수동',
  sendCode: '67 버튼 메시지 보내기',
  modelOpusExtra: '69 팝업 버튼 모델: Opus 5.5 높음',
  effortExtraItem: '220 노력 엑스트라',
  openFolder: '157 팝업 버튼 Description: 폴더: ~/Documents/GitHub/doperpowers',
  modelOpusItem: '208 팝업 버튼 모델: Opus 5.5 엑스트라',
};
let bad = 0;
for (const [k, line] of Object.entries(cases)) if (!L[k].some((p) => p.test(line))) { bad++; console.log('MISS', k, line); }
for (const [k, line] of Object.entries(negatives)) if (L[k].some((p) => p.test(line))) { bad++; console.log('FALSE', k, line); }
console.log(bad ? `${bad} wrong` : `all ${Object.keys(cases).length} labels match, ${Object.keys(negatives).length} near misses refused`);
process.exit(bad ? 1 : 0);
