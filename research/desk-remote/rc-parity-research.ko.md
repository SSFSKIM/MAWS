# 네이티브 Remote Control과 동등한 RC 클라이언트 — MAWS #52 설계를 위한 리서치 (2026-10-18)

**무엇을 위한 문서인가.** MAWS #52(desk를 web MAWS + Claude Code remote-control client로 키우는
단계)의 개발 세션들이 설계의 근거로 쓰는 리서치다. 질문은 하나다. **desk 위에서 네이티브 RC의
성능·기능·제어 폭·UX와 동등한 RC 클라이언트를 어떻게 만들 수 있는가.** 결정은 하지 않는다.
각 선택지가 어떤 근거 위에 서는지, 어디가 막혀 있는지, 무엇을 먼저 해야 하는지를 적는다.

**전제.**
- 공식 RC는 이 환경(자체 gateway, API key)에서 쓸 수 없다. 그래서 동등한 것을 직접 만든다.
- 터미널 세션 쪽은 desk Phase 1이 이미 상당 부분을 구현했다(2026-10-18 walk 통과).
- 목표는 공식보다 나은 도구다: 자체 호스팅, E2E 암호화, 여러 기기·여러 프로젝트를 웹 하나에서.

**출처와 인용 표기.**
- `cli:N` — Claude Code 2.1.300 리프린트 [cli.pretty.js](/Users/new/claude-code-bundle/2.1.300/cli.pretty.js)의 줄.
- `dts:N` — 같은 바이너리에 들어 있는 mod API 선언
  [claude-code.d.ts-7e7b76be.txt](/Users/new/claude-code-bundle/2.1.300/modules/claude-code.d.ts-7e7b76be.txt)의 줄.
- `SPEC36 §n` — [SPEC/36-remote-control-and-bridge.md](/Users/new/claude-code-bundle/2.1.300/SPEC/36-remote-control-and-bridge.md).
  한국어 지도는 [remote-control-client-overview.ko.md](remote-control-client-overview.ko.md).
- `spec:N` — desk 설계 [2026-10-15-desk-design.md](/Users/new/Developer/GitHub/MAWS/.claude/worktrees/smns-erb/docs/doperpowers/specs/2026-10-15-desk-design.md)의 줄,
  smns-erb `fbc3e13ea` 기준. 이 파일은 매일 바뀌므로 줄이 어긋나면 인용한 문구로 찾는다.
- `hub/`, `web/` — MAWS `apps/desk-hub/`, `apps/desk-web/` (smns-erb 트리, origin/master에 포함됨).
- `S/`, `M/` — doperpowers `skills/sminos/scripts/`, `hooks/mods/` (main `20263ae9`, 7.184.1).
- claude.ai 웹 클라이언트 — Claude Desktop app-2.42304.0에 번들된 웹앱의 읽기용 추출본
  (`~/claude-desktop-re/readable/app-2.42304.0/`). 전체 참조는
  [claude-ai-rc-client-protocol.md](claude-ai-rc-client-protocol.md).
- 엔진 쪽 주장은 2.1.300 기준이다. owner의 기계는 이미 2.1.301–302를 쓴다. 이름(함수·문자열·게이트)은
  빌드를 건너 유지되지만 줄 번호는 아니다.

---

## 0. 요약

1. **네이티브 RC의 네트워크 쪽은 재사용할 수 없다.** 코드로 확인했다(3.1절).
   - `--sdk-url`은 하드코딩된 Anthropic 호스트 목록 밖이면 시작 시 거부된다(cli:487359-487391, cli:995024-995028).
   - SDK 호스트용 `remote_control` 제어 요청은 work secret의 `api_base_url`을 무시하고 `ZD()`(Anthropic
     base URL)로 붙으며, claude.ai 구독 OAuth를 요구한다(cli:488846-488931, cli:653486-653512).
   - 따라서 동등성은 **네이티브 RC의 메커니즘을 우리 프로토콜로 재현**해서 얻는다. 엔진을 속이는 경로
     (DNS나 사설 CA로 `api.anthropic.com` 위장)는 고려 대상에서 뺀다.
2. **네이티브 RC는 두 프로그램이고, desk는 둘 다에 대응시킬 수 있다.**
   - REPL bridge(실행 중인 TUI 안에서 돈다) ↔ **desk의 bridge mod**(같은 프로세스 안에서 돈다).
   - headless 서버 `claude remote-control`은 자식 `claude --print --sdk-url … --input-format stream-json
     --output-format stream-json`을 띄운다(cli:366493) ↔ **데몬이 stream-json 자식을 띄우는 방식**
     (MAWS engine host가 이미 하는 일). 차이는 전송 계층(`--sdk-url` 대신 stdio)뿐이다.
3. **제어 폭: stdio로 소유한 세션은 네이티브 REPL bridge보다 넓다.** stdio 제어 프로토콜은 96개
   subtype을 받는다. REPL bridge가 받는 23개 중 plain stdio에서 안 되는 것은 둘이다: `set_color`(핸들러
   없음)와 `fork_conversation`(CCR + first-party 필요, `--fork-session`으로 대체). 네이티브 headless 서버의
   자식도 같은 stdio 프로세스이므로, 그쪽과는 같은 폭이다(3.2절). 터미널 세션은 mod로 거의 따라가지만
   고정된 격차가 몇 개 남는다(3.3절).
4. **성능: 네이티브 RC는 서버의 순번 세션 로그 덕에 열기·재접속·다중 시청이 worker 기계를 거치지
   않는다.** desk는 열 때마다 기계에 snapshot을 요청하고, 재접속마다 다시 받고, 브라우저마다 스트림을
   연다. 기계가 꺼지면 깊이 정보를 볼 수 없다.
   - 이 중 셋은 **원칙을 바꾸지 않고** 줄일 수 있다: cursor 기반 구독으로 재접속 시 재snapshot 제거
     (기계 쪽 plane은 파일별 offset 색인으로 이미 페이지를 만든다), 브라우저 쪽 행 캐시 + 꼬리 확인으로 빠른 재열기(claude.ai가
     하는 방식), 세션당 공유 스트림으로 다중 시청(desk 백로그에 있음).
   - hub 저장이 꼭 필요한 것은 **기계가 꺼졌을 때의 열람** 하나다. 이것은 "hub는 transcript를 저장하지
     않는다"는 binding 원칙을 바꾸는 owner 결정이다.
   - 암호화로 "hub가 읽지 못한다"를 약속하려면 웹 코드를 hub가 아닌 곳에서 받아야 한다. 지금은 같은
     Worker가 웹앱을 내려주므로, hub를 배포할 수 있는 사람은 키를 빼돌리는 JS를 내보낼 수 있다(5.2절).
5. **기능 격차 상위 다섯** (4절 표에서 추림):
   - slash 명령과 제어 요청의 폭 (`/clear`, 권한 모드 전환, rename, `@` 파일 제안, `read_file`, MCP);
   - 첨부와 파일 (앱→기기 첨부, 기기→앱 `SendUserFile`, 파일 뷰어);
   - 세션 상태 문서 (`external_metadata`에 해당하는 것: 대기 중 동작, 턴 요약, 모드, 폰에서도 보이는 컨텍스트);
   - 재접속과 다중 시청자 성능 (위 4번);
   - stdio로 호스팅된 세션의 제어. 지금은 시험되지 않았고, 파이프를 누가 쥐는지부터 정해야 한다(3.2절).
6. **claude.ai 웹 클라이언트는 브라우저 안의 SDK 호스트다**(6절). 실시간은 재생 없는 소켓, 이력과 빈
   구간은 서버 로그의 HTTP 페이지, 생존 여부는 폴링과 계정 watch에서 온다. web MAWS를 "브라우저 =
   stream-json 제어 프로토콜의 호스트"로 만들면 네이티브와 같은 구조가 된다. 배포된 웹은 RC 세션에 cloud보다
   적게 주므로(대기 메시지 취소 불가, 알림 제외, dialog 종류 미선언), 동등 클라이언트가 네이티브를 넘을 수
   있는 지점이 분명하다(6.11절).
7. **Desktop의 "self-hosted execution" 모드**가 네 번째 통합 경로다. 웹앱의 세션 API를 우리 호스트로
   전달하게 해서 네이티브 UI를 우리 세션의 클라이언트로 쓸 수 있다. Desktop 전용이고 프로필을 3P 모드로
   바꾸며 계약이 자주 바뀐다. 기준선 비교용 스파이크로 가치가 있다(6.10절).
8. **선행 사례 중 실행 중인 터미널 세션에 붙는 제3자 도구는 없다.** 나머지는 전부 직접 띄우거나
   PTY로 감싼다(7절). 엔진 안에서 도는 desk의 mod 방식은 그래서 드문 강점이다. 지켜야 한다.

---

## 1. "동등하다"의 정의

> **2026-10-19 재선언 (owner 결정, 같은 날 저녁 정정).** 기능 축의 기준은 **MAWS 자신**이다. MAWS는
> 이미 완결된 로컬 워크스페이스 앱으로 에이전트 제품 쪽 대부분을 갖고 있다. 웹의 과제는 (1) RC급 연결성
> (아주 낮은 지연, 빠른 동시성)과 (2) MAWS 기능의 최대 포팅이다. 네이티브 RC는 Desktop에서 가장 좁은
> 모드라 기능 기준이 될 수 없다. Claude Desktop의 SSH 모드(6.12절)는 기능 기준이 아니라 **로컬 기능
> 전체를 다른 기계로 옮기는 참조 설계**다: 기계 쪽 데몬이 프로세스를 소유하고 클라이언트는 교체 가능하다.
> MAWS의 E10 detached supervisor가 이미 같은 분할이다. 성능과 도달 범위 축은 그대로 네이티브 RC와
> claude.ai 클라이언트가 기준이다. 이 기준으로 다시 정리한 격차표와 결정 목록은
> [web-maws-remote-research.ko.md](web-maws-remote-research.ko.md)에 있다.
> 그 문서가 이 문서의 4절(격차표)과 8절(우선순위)을 대신한다. 이 문서의 엔진 제어 표면(3절), 성능
> 분석(5절), claude.ai UX(6절)는 그대로 유효하다.

네이티브 RC와의 동등성을 세 축으로 나눈다. #52 세션은 축마다 목표를 숫자나 체크리스트로 고정하는
것이 좋다.

| 축 | 네이티브 RC가 주는 것 | 측정 방법 제안 |
|---|---|---|
| 성능 | 세션 열기와 재접속이 즉시, 토큰 단위 스트리밍, 여러 기기에서 동시 시청, 기기가 꺼져도 기록 열람 | 열기→첫 행, 델타 지연, 재접속 복구 시간의 p95; 시청자 N명일 때 기계 쪽 부하 |
| 기능·제어 폭 | 제어 요청 23종 + 권한·dialog 중계 + 첨부 양방향 + slash 명령 + 상태 메타데이터 | 4절 표의 행 단위 체크 |
| UX | 양쪽에 뜨는 권한 프롬프트(먼저 답한 쪽 승리), 접속 시 대기 프롬프트 재전달, composer 자동완성, 푸시 | 6절 목록 |

**목표 환경 조건.**
- 자체 gateway나 API key 환경에서 동작해야 한다. desk는 이미 owner의 loopback gateway 뒤에서
  walk를 통과했다. API key만 있고 claude.ai 로그인이 없는 기계는 아직 검증되지 않았다.
- mod 로딩은 GrowthBook 게이트 `tengu_plugin_hooks_modules`에 걸려 있다. 코드 기본값은 true이고
  (cli:928801, cli:973204), 3P provider처럼 GrowthBook이 꺼진 환경에서는 코드 기본값이 쓰이므로 켜진다.
  서버가 끌 수 있다는 위험은 남는다. 조직 관리형 설치에서는 사용자 플러그인의 `PermissionRequest`
  hook이 돌지 않는다(spec:4211-4215).

---

## 2. 네이티브 RC가 성능과 UX를 내는 구조

RC의 핵심은 기능 목록이 아니라 **세션을 서버 쪽 객체로 만든 설계**다. 아래는 그 구성요소이고,
각각이 desk에서 무엇에 해당하는지를 함께 적는다.

### 2.1 세 주체

```
[client: 폰 앱 / claude.ai]  ⇄  [server: /v1/code/sessions/<id>]  ⇄  [worker: 로컬 Claude Code]
     이벤트 POST, 스트림 구독          세션 레코드 + 순번 로그 + 상태 문서        SSE 구독, 이벤트 배치 POST
```

worker와 client는 직접 만나지 않는다. 모든 것이 세션 레코드를 거친다.

### 2.2 서버의 순번 이벤트 로그 — 성능의 근원

- worker가 올린 이벤트는 `sequence_num`이 붙어 서버에 쌓인다. client는 열 때 서버에서 히스토리를
  페이지로 읽고(claude.ai는 최신 창 `events?limit=200&sort_order=desc`, 이후 500개씩, 6.2절), 그 뒤 실시간
  스트림을 받는다. RC 세션의 실시간 경로는 재생 없는 v1 WebSocket이고, 끊긴 구간은 같은 HTTP 페이지로
  채운다(6.1절). v2 SSE에서는 `from_sequence_num`부터 받고 너무 오래된 cursor엔 `catch_up_truncated`가 온다
  (SPEC36 §8, §9).
- **세션을 열거나 재접속할 때 worker 기계와 통신하지 않는다.** 기계가 잠들어 있어도 기록은 열린다.
- 스트리밍 델타(`stream_event`, 최대 60KB)는 ephemeral로 저장되지 않는다. transcript 이벤트만 남는다.
- worker 업로드는 배치(이벤트 100개 이하, 10MiB 이하)이고, 400/413/422면 ephemeral부터 버리고
  재시도한다. 2.1.300은 느린 링크에서 큰 배치를 나누고 크기에 비례한 타임아웃을 쓴다.
- desk 대응: **없음.** hub는 transcript를 저장하지 않는다(spec:444-450, binding). 세션 plane의
  구독마다 snapshot부터 시작하고, 재접속하면 다시 snapshot을 받는다(spec:2850-2851). 5절에서 다룬다.

### 2.3 worker 상태 문서 — 목록과 배지의 근원

- worker는 이벤트와 별개로 작은 상태 문서를 `PUT /worker`로 갱신한다:
  - `worker_status`: `idle | running | requires_action`, 그리고 `requires_action_details`;
  - `external_metadata`(키 단위 병합): `permission_mode`, `effort_level`, `context_usage`,
    `post_turn_summary`, `pending_action(s)`(최대 32), `current_branches`, `worktree_state`,
    `task_summary`, `rate_limit_info`.
- client의 세션 목록, "기다리는 중" 배지, 컨텍스트 미터, 모드 표시가 모두 이 문서에서 그려진다.
  이벤트 로그를 다시 읽지 않는다.
- 계정 단위 변경 스트림(`GET /v1/code/sessions/watch`, SSE)이 목록을 신선하게 유지한다
  (overview 22.1).
- desk 대응: presence(세션 레코드의 status, waitingFor, needs)와 pending 집합이 일부를 맡는다.
  컨텍스트·비용은 데스크톱 Info 탭에서 턴 단위로만, rate limit은 없음, 턴 요약은 없음.

### 2.4 전달과 영수증

- client가 보낸 이벤트는 worker가 SSE로 받고, `POST /worker/events/delivery`로 received/processed
  영수증을 보낸다. 보낸 쪽은 "전달됨"과 "처리됨"을 구별해 보여줄 수 있다.
- worker는 UUID 링으로 echo와 재전달을 거른다.
- desk 대응: log `human`의 delivery 결과는 있다. steer와 RPC에는 결과(`done`/`failed`)만 있다.
  `delivered.uuid`를 웹까지 보내는 일은 미완(#43).

### 2.5 worker 단일성

- 세션당 활성 worker는 하나다(`worker_epoch`). 새 worker가 등록하면 옛 worker의 요청은 409와
  `x-ccr-conflict-reason`을 받고 close 4090으로 물러난다.
- desk 대응: log는 feed마다 writer 하나를 강제한다. 세션 제어는 웹과 터미널의 공동 조작이 설계
  의도이고, 중복은 nonce·신선도·digest·at-most-once ledger로 막는다. hosted 세션을 도입하면
  "세션을 실행하는 프로세스는 하나"가 따로 필요하다(3.4절).

### 2.6 권한 중계

- 프롬프트가 뜨면 worker가 `can_use_tool` 제어 요청을 보내고 상태를 `requires_action`으로 올린다.
  로컬과 원격에 동시에 뜨고 먼저 답한 쪽이 이긴다. 이긴 뒤 `control_cancel_request`로 다른 모든
  client의 프롬프트를 닫는다.
- 접속 시 열린 프롬프트를 `pending_permission_requests`로 다시 보낸다(최대 200). 전달 못 한 답은
  1s, 5s, 15s, 45s 간격으로 재전송한다.
- 권한 프롬프트와 AskUserQuestion은 답할 때까지 열려 있고, 다른 dialog는 5분 뒤 만료된다
  (`dialogExpiry`, 공식 문서).
- desk 대응: **같은 동작을 구현했다**(walk 3, 4번 통과). 터미널이 먼저 답하면 웹 카드가 2초 안에
  사라지고 `settled`가 모든 소켓에 방송된다. 예외는 3.3절.

### 2.7 presence와 푸시

- client는 `POST /v1/code/sessions/{id}/client/presence`로 활동 펄스를 보낸다(5초 디바운스).
- 터미널에서 입력 중이거나 포커스가 있으면 푸시하지 않는다. `CLAUDE_CLIENT_PRESENCE_FILE`로 "기계 앞에
  있음"을 넓힐 수 있다.
- desk 대응: Web Push는 프로젝트 탭이 보이는 동안 보류된다. 터미널 쪽 presence로 푸시를 막는 동작은
  없다(sminos-hub 설계에 HID idle 기반안이 있었다).

### 2.8 연결 유지

- SSE keepalive 간격을 서버와 협상한다(`x-ccr-sse-keepalive-interval-seconds`). 기본 15초 + 여유
  30초 동안 프레임이 없으면 재연결하고, 재연결은 1초→30초 백오프로 무제한 시도한다.
- 복구 가능한 close는 401, 4091, 4093, 4094뿐이고 4090(다른 연결이 가져감)은 종료다.
- desk 대응: 기계 쪽은 SSE + POST, heartbeat 15초, lease 3 heartbeat. #57 기간 로그에 약 37시간 동안
  두 기계 합쳐 hub 측 끊김 53회가 있었고, 29회가 배포나 `wrangler tail`이었다(5.1절).

### 2.9 client 쪽 (claude.ai)

6절에서 다룬다. 요점: 브라우저가 SDK 호스트로 동작하고, 실시간 소켓 + 서버 로그의 HTTP 페이지 + 상태
폴링 + 계정 watch의 네 가지를 조합해 성능과 신선도를 낸다.

---

## 3. 쓸 수 있는 제어 수단

### 3.1 막힌 길 (코드로 확인)

| 경로 | 막는 코드 | 결론 |
|---|---|---|
| `--sdk-url`을 자체 서버로 | 호스트 allowlist `api.anthropic.com`, `api-staging.anthropic.com`, `ZWe`(cli:236560: staging beacon, fedstart 두 개). 밖이면 `--sdk-url rejected: … reserved for Remote Control worker processes connecting to Anthropic's backend`(cli:995024-995028). 우회 setter `replaceCcrSessionUrl`은 호출되지 않는다(cli:1038736) | 불가 |
| SDK 호스트의 `remote_control` 제어 요청 | base URL이 work secret의 `api_base_url`이 아니라 `ZD()` = `Lpe() ?? BASE_API_URL`이고 `Lpe()`는 `return;`으로 컴파일됨(cli:653486-653512). 자격 판정에 first-party, claude.ai 구독 OAuth, `allow_remote_control` 정책, trusted device 요구(cli:488846-488931) | 호출은 되지만 항상 Anthropic에 Anthropic 계정으로 붙는다 |
| `CLAUDE_BRIDGE_BASE_URL` 등 | 레지스트리에 선언만 있고 getter가 항상 undefined(overview 20절) | 불가 |
| Channels (MCP 서버가 세션에 메시지를 밀어 넣음) | first-party provider 전용, `tengu_harbor` 코드 기본값 false(cli:1082406-1082414), 제3자 채널은 관리형 `allowedChannelPlugins`나 `--dangerously-load-development-channels`(매 실행 경고 dialog, interactive 전용), 권한 중계는 `tengu_harbor_permissions` 기본 false(cli:308939) | owner 환경에선 사실상 불가. 들어오는 메시지는 `<channel>` 태그로 감싸져 사용자 발화가 아니다 |
| `claude daemon remote-control` | Anthropic environments API만 쓴다 | 불가 |

### 3.2 데몬이 소유한 세션: stdio 제어 프로토콜

**띄우는 방법.**
```
claude -p --input-format stream-json --output-format stream-json --verbose
  --permission-prompt-tool stdio --replay-user-messages
  [--include-partial-messages] [--include-hook-events]
  --resume <uuid> | --session-id <uuid>   --permission-mode <m>
```
`rewind_files`가 필요하면 `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`. 첫 프레임은 `initialize`이고,
여기서 hook 등록과 `supportedDialogKinds` 선언을 한다. MAWS engine host(`src/engine-host/launch.ts`)가
이미 거의 같은 방식으로 띄운다.

**받는 제어 요청.** 공유 표 `Be` 20종(cli:477038) + `else if` 체인 76종(cli:75597-77587) = 96종. 나머지는
unsupported로 답한다(cli:77589). RC 관점에서 중요한 것:

| 묶음 | subtype |
|---|---|
| 세션·턴 | `initialize`(재호출하면 열린 권한·dialog 요청을 다시 보낸다, cli:77939), `interrupt`, `end_session`, `cancel_async_message`, `rewind_conversation`, `rewind_files`(env 필요), `side_question`, `rename_session`, `generate_session_title`, `set_cwd`, `add_directory`(env 필요), `export_conversation` |
| 모델·모드 | `set_model`, `set_max_thinking_tokens`, `apply_flag_settings`, `set_permission_mode`(bypass는 `--dangerously-skip-permissions`로 시작한 세션만, auto는 자격 필요, cli:176643-176657), `get_settings`, `list_permission_rules` |
| 조회 | `get_status`, `get_context_usage`, `get_usage`, `get_session_cost`, `list_models`, `get_plan`, `get_workspace_diff`, `file_suggestions`, `read_file`, `get_task_output` |
| 작업 | `stop_task`, `background_tasks` |
| MCP | `mcp_status`, `mcp_reconnect`, `mcp_toggle`, `mcp_set_servers`, `mcp_call`, `mcp_authenticate`, `mcp_oauth_callback_url`, `mcp_clear_auth`, `mcp_read_resource` |
| 플러그인 | `reload_plugins`, `reload_skills`, `reload_output_styles` |
| mod UI | `ui_*` 19종, `ui_attach`는 `desktop`/`mobile`/`vscode` 표면을 받는다(cli:76237-76541) |

`fork_conversation`은 CCR `--sdk-url`과 first-party가 없으면 unsupported다(cli:72260-72262).
대신 `--resume <id> --fork-session`으로 새 프로세스에서 fork한다. REPL bridge의 23개(cli:796022-796320)와
비교하면 plain stdio에서 안 되는 것은 `set_color`와 `fork_conversation` 둘이다.

**엔진이 호스트에 보내는 요청.** `can_use_tool`, `request_user_dialog`(호스트가 `initialize`에서 선언한
dialog 종류만, cli:67578), `hook_callback`, `elicitation` 등 16종(cli:169440).

**stdin 프레임.** `user`, `bash_command`, `control_request`, `control_response`,
`control_cancel_request`, `keep_alive`, `update_environment_variables`, `queued_notification`,
`session_notice`.
- `bash_command`(cli:77667)는 모델 턴, 샌드박스, 권한 확인 없이 셸 명령을 바로 실행한다. `!` 명령을
  구현하는 수단이지만, **원격에서 온 것을 그대로 넘기면 안 된다.** 기계 정책으로 묶어야 한다.

**중계 계층이 허용할 제어 요청.** 보고 에이전트의 안전한 기본 집합: `interrupt`, `set_model`,
`set_permission_mode`(bypass 제외), `set_max_thinking_tokens`, `apply_flag_settings`(effort만),
`get_context_usage`, `mcp_status`, `stop_task`, `background_tasks`, `cancel_async_message`,
`rewind_conversation`, `file_suggestions`, `read_file`, `get_workspace_diff`, `side_question`.
버릴 것: `bash_command`(정책 없이), `claude_*` 인증, `mcp_set_servers`, `update_environment_variables`.

**MAWS 쪽 현황.** MAWS가 띄운 세션은 2026-10-18부터 `SMNS_MEMBER`로 sminos 멤버가 되어 desk에
나타난다. 그러나 그 세션들에 대한 steer, interrupt, model, 권한 결정은 **한 번도 시험되지 않았고**,
compact와 MAWS ask 답변은 실패할 것으로 보인다(`M/compact.tsx:217-220`, `M/ask.tsx:1232-1239`).

**누가 stdio 파이프를 쥐는가 — 먼저 정해야 할 것.** MAWS가 띄운 세션의 stdin/stdout은 sminos 데몬이
아니라 MAWS engine host가 쥔다(`src/engine-host/launch.ts:50-53`의 `--permission-prompt-tool stdio`, 128의
`SMNS_MEMBER`). 그리고 bridge mod도 그 세션 안에서 시작한다. `bridgeStart`가 건너뛰는 것은
`SMNS_INTERNAL`뿐이다(`M/bridge.tsx:1176-1180`). 그대로 두면 제어 경로가 둘이 되고, bridge의
`PermissionRequest`가 호스트의 `can_use_tool`과 경쟁할 것으로 보인다(추론, 미실행). 선택지는 둘이다.
- 데몬(또는 hub용 host)이 자기 stream-json 자식을 직접 띄운다. sminos-hub 설계의 "host = supervisor +
  headless main"이 이 모양이다.
- MAWS engine host가 자기 세션의 제어를 중계하는 창구를 연다.

어느 쪽이든 stdio로 호스팅된 세션에서는 bridge가 제어에서 물러나야 한다(관찰만 남기거나 아예 끈다).

### 3.3 터미널 세션: mod

mod는 실행 중인 TUI 프로세스 안에서 도는 유일한 확장 지점이다. 네이티브 REPL bridge와 같은 위치에
있다는 것이 desk의 강점이다.

| 기능 | mod로 | 비고 |
|---|---|---|
| 행 관찰(메인·서브에이전트) | 가능: `session.append` 이벤트 | door 종류로 행 성격 구분(cli:1034700-1034760) |
| 토큰 델타 | 가능: `turn.step` | 서브에이전트 델타의 유일한 출처(spec:307-310) |
| 턴 시작/끝 | 가능: `turn.start`/`turn.complete` + `turnId` | 상태 이벤트는 없다. requires_action은 PermissionRequest로 유도 |
| idle일 때 프롬프트 | 가능: `$.prompt.submit({asUser:true})` | 텍스트 전용, `/`로 시작하면 거부(cli:566628-566639) |
| 진행 중 턴에 끼워 넣기 | 부분: `$.session.append`로 user 행 추가, 다음 모델 요청 때 읽힘(dts:2946-2956) | desk의 steer. 사용자가 친 것으로 그려지진 않는다 |
| 첨부·이미지 | **부분, 스파이크 필요** | `$.prompt.submit`은 명시적 `attachments`를 거부하고(cli:566634) `$.session.append`는 텍스트 블록만, `$.prompt.media`는 관리형 mod 전용(dts:3042). 그러나 플러그인 prompt는 `skipAttachments`를 켜지 않으므로(cli:566643) 본문의 `@<경로>` 멘션이 첨부 추출을 타고(cli:157358-157361), Read가 이미지·PDF 내용을 돌려준다(cli:612386-612398). 그러면 같은 턴에 이미지 블록이 들어갈 수 있다(추론, 미실행). steer 경로(`$.session.append`)는 확정적으로 텍스트만 |
| 권한 프롬프트 감지·응답 | 가능: `classic.PermissionRequest` | 로컬 dialog와 경쟁, 이기면 dialog 닫힘(cli:274539-274551, 274947-275063). `updatedInput`, `updatedPermissions` 가능 |
| AskUserQuestion, ExitPlanMode | 가능: PermissionRequest + `updatedInput` | |
| 일반 dialog(request_user_dialog류) | **불가** | |
| interrupt | 가능: `$.turn.abort` | desk는 TaskStop까지 해서 Esc와 맞춘다 |
| model, effort | 가능 | desk는 `turn.step`에서 요청마다 다시 쓴다(설정 파일 오염을 피하려고) |
| 권한 모드 전환 | **부분** | `/plan`만 `$.command.run`으로. 그 외는 권한 답변에 `setMode`를 실을 때만 |
| slash 명령 | 가능: `$.command.run` | **desk bridge가 아직 노출하지 않는다.** idle까지 대기, Esc 뒤 거부 |
| 컨텍스트·rate limit·비용 | 가능: `$.session.usage`, `session.measure` | bridge가 이미 턴마다 `usage {context, cost}`를 보낸다(`M/bridge.tsx:1316`). `rateLimits`는 구독이 아니면 비어 있다(dts:12160-12163, 12181-12186). gateway·API key 환경에선 gateway가 주는 한도 정보가 있을 때만 의미가 있다 |
| 기계 위 파일 질의 | 해당 없음 | `file_suggestions`, `read_file`, diff는 데몬이 파일시스템에서 직접 답할 수 있다 |
| 로컬 TUI 표시 | 가능: `$.ui.status`, `$.ui.notice(tool_use_id, …)` | "원격 연결됨" 표시, 대기 dialog 아래 한 줄 |

**메워지지 않는 격차** (터미널 세션 고유):
1. 진행 중인 턴에 끼워 넣는 steer로는 이미지·파일을 넣을 수 없다. idle일 때 보내는 것은 데몬이 세션 전용
   디렉터리에 저장하고 `@<경로>`로 멘션하는 방법이 첨부 추출을 탈 가능성이 높다(위 표, 스파이크 필요).
   네이티브 RC도 받은 이미지를 디스크 경로에 쓰고 이미지 블록으로 넣는다(SPEC36 §16.4, cli:77418).
2. 권한 모드를 마음대로 바꿀 수 없다.
3. 로컬이 먼저 답했다는 통지가 없다. desk는 세션 레코드가 waiting을 벗어나거나 tool.call이 끝나거나
   턴이 끝나는 것으로 추론한다.
4. hook에 닿지 않는 프롬프트: person-only 프롬프트, 작업 디렉터리 밖 읽기 프롬프트(cli:274663-274679),
   백그라운드 서브에이전트의 프롬프트(dialog 전에 hook이 돌아서 3초 창만 쓸 수 있다).
5. 로컬에서 Esc를 누른 뒤에는 사람이 입력할 때까지 플러그인 프롬프트와 명령이 거부된다
   (cli:566536-566543, `tengu_plugin_input_refusal` 기본 true). desk는 inbox frame으로 깨운다.

### 3.4 터미널과 headless 사이 넘겨주기

- transcript에는 잠금이 없다. 평범한 `appendFile`로 쓴다(cli:516601-516643).
- 세션 레지스트리 `~/.claude/sessions/<pid>.json`이 있지만 resume 검사는 비-interactive holder만 본다
  (cli:906578-906583). 즉 TUI와 `-p`가 같은 세션을 동시에 쓰면 아무도 막지 않고, 다음 로드 때 마지막에
  쓴 가지만 보인다.
- 안전한 절차(엔진 자신의 respawn과 같은 순서, cli:803322-803390): idle까지 대기 → SIGTERM/SIGINT
  (SIGKILL 금지) → pid와 레지스트리 파일이 사라질 때까지 대기 → 같은 `CLAUDE_CONFIG_DIR`, 같은 cwd에서
  `--resume <uuid>`로 다른 쪽을 띄운다. `--continue`는 쓰지 않는다(열린 세션을 집을 수 있다).
- 재개 시 복원: 메시지, 모델, 읽은 파일 캐시, 파일 이력, todo. 복원 안 됨: print 모드의 권한 모드
  (`--permission-mode`로 다시 준다), MCP 상태, 세션 승인.
- 선행 사례의 가장 흔한 버그가 여기서 나온다: 살아 있는 세션을 두 번째 프로세스가 `--resume`해서
  대화가 갈라지고 prompt cache가 깨진다(7절).

### 3.5 그 밖의 표면

- `--bg` 감독자의 `control.sock`(같은 uid + `control.key`): `reply`, `list`, `subscribe`, `kill` 등.
  비공개라 op가 버전 표시 없이 바뀐다. desk는 bridge가 없을 때의 대체 경로로만 쓴다.
- 세션별 messaging 소켓: 피어 메시지로 framing되므로 "사람이 보낸 말"의 경로로는 맞지 않는다.
- `claude agents --json`, 세션 레지스트리: 발견과 상태용.

---

## 4. 기능별 격차표

"터미널"은 mod로 조종하는 세션, "hosted"는 데몬이 stdio로 소유한 세션이다.

| 기능 | 네이티브 RC | desk 현황 | 터미널에서 채우는 길 | hosted에서 채우는 길 |
|---|---|---|---|---|
| 텍스트 스트리밍 | `stream_event` 델타 | 출하(블록 단위로 그림) | 있음 | `--include-partial-messages` |
| tool 입력 스트리밍 | 델타에 포함 | 없음(100ms flush 때 행으로) | `turn.step`의 인자 JSON 청크 | partial messages |
| thinking | 델타 | 라벨만 | 격차 아님: 2.1.300의 live `thinking` 청크는 내용이 비어 있다(`web/src/depth/view/streaming-rows.ts:3-6`). API 수준에서 생략되는 것으로 보이며, 네이티브도 내용을 받지 못할 가능성이 높다(추론) | 같음 |
| 메시지 보내기(idle) | `user` 프레임 | 출하 | 있음 | `user` 프레임 |
| 진행 중 턴에 보내기 | 다음 단계에 접힘 | 출하(steer) | 있음 | `user` 프레임(큐) |
| 첨부 앱→기기 | `file_attachments` 20개·35MiB, 이미지 inline | 없음 | 저장 + `@<경로>` 멘션(스파이크) | `user` 프레임에 이미지 블록 |
| 파일 기기→앱 | `SendUserFile` 도구 | 없음 | mod가 도구 등록(`$.tool.register`) + 업로드 | 같음 |
| 권한 프롬프트 | first-wins + cancel + 재전달 | 출하 | 있음(예외 3.3) | `can_use_tool` + `initialize` 재전달 |
| AskUserQuestion | 중계 | 출하(네이티브), MAWS ask는 미지원 | 있음 | `can_use_tool` |
| 그 밖의 dialog | `request_user_dialog` | 없음 | 불가 | `request_user_dialog` |
| interrupt | `interrupt` | 출하 | 있음 | `interrupt` |
| model, effort | `set_model`, `apply_flag_settings` | 출하 | 있음 | 있음 |
| 권한 모드 | `set_permission_mode` | 미룸(spawn 때만) | `/plan`만 | `set_permission_mode` |
| slash 명령 | 앱 composer에서 전송 | `/compact`만 | `$.command.run` 노출 | `user` 프레임의 `/명령` |
| `!` 셸 | (로컬 세션엔 없음) | 없음 | `$.tool.call` Bash, 스파이크 필요 | `bash_command`, 정책 필수 |
| `@` 파일 제안 | `file_suggestions` | 없음 | 데몬이 직접 | `file_suggestions` |
| 파일 읽기 | `read_file`(작업 디렉터리 안, 1–10MB) | 없음 | 데몬이 같은 규칙으로 | `read_file` |
| workspace diff | `get_workspace_diff` | 출하(데몬, merge-base 기준) | 있음 | 있음 |
| 컨텍스트·비용 | `get_context_usage`, metadata | 데스크톱 Info 탭, 턴 단위(bridge가 `usage`를 이미 보냄) | 폰과 상태 문서로 넓히기 | `get_context_usage` |
| rate limit | `rate_limit_event`, metadata | 없음 | 구독이 아니면 `rateLimits`가 비어 있음: gateway 한도가 있으면 그것을 전달 | `rate_limit_event` 프레임(구독일 때) |
| MCP 상태·인증 | `mcp_status`, `mcp_authenticate` 등 | 이름만 | 불가(mod·transcript에 없음) | 있음 |
| 백그라운드 작업 | `background_tasks`, `stop_task` | 셸·monitor 중지 출하(DC10) | `$.tool.call` TaskStop | 있음 |
| `/btw` | `side_question` | 없음 | 불가 | `side_question` |
| rename, 색, 제목 | `rename_session`, `set_color` | 제목 표시만 | `$.command.run rename`(확인 필요) | `rename_session` |
| fork, rewind | `fork_conversation` | 미룸 | 불가 | `rewind_conversation`, `--fork-session` |
| 세션 목록·배지 | 상태 문서 + watch | 프로젝트별 출하 | — | — |
| 새 세션 띄우기 | 환경에 work 분배, same-dir/worktree, 용량 32 | 출하(데스크톱, 알려진 checkout만) | — | 데몬이 stream-json 자식 |
| archive, 재개 | archive, `--continue` 4시간 | retire, Resume 출하 | — | — |
| presence와 푸시 | presence 펄스, 터미널 포커스면 억제 | 탭 가시성 기준 | 터미널 presence 신호 추가 | — |
| 동시 시청 | 서버 fan-out | 브라우저마다 스트림 | 5절 | 5절 |
| 재접속 무손실 | 순번 재생 | log는 무손실, 세션 plane은 재snapshot | 5절 | 5절 |
| 기계가 꺼졌을 때 열람 | 서버 저장분 | 불가 | 5절 | 5절 |

---

## 5. 성능 동등성: 구조적 처방

### 5.1 desk의 현재 수치와 경로

- 웹 자체 몫(CI 측정): 첫 행 142ms, owner 메시지 57ms, `<message>` 36ms, 질문 23ms.
- 제안된 p95 예산(배포 환경에서 미확인): owner 메시지→세션 1s, 메시지·요청 그리기 2s, 첫 행 1.5s,
  청크 500ms(spec:4980-4983).
- 경로: 엔진 → mod(`turn.step`) → bridge 자식(Unix 소켓 HTTP) → 데몬 plane → uplink(Python, SSE 하향
  + 직렬 POST 상향) → Machine DO → Project DO → 브라우저 WebSocket.
- 병목으로 기록된 것:
  - uplink의 직렬 POST가 초당 600–750 프레임에서 첫 한계(spec:718-726);
  - log 업로드는 이벤트당 POST 하나(`S/sminos_uplink.py:832-835`);
  - 기계 재접속마다 열린 구독 전부 재snapshot. 끊김은 #57 기간 약 37시간에 두 기계 합쳐 53회로,
    기계·시간당 약 0.7회이고 그중 29회가 owner의 배포나 `wrangler tail`이었다. 배포를 빼면 약 0.3회다.
    즉 상시 문제라기보다 배포 때문이고, 미뤄진 staging 배포가 대부분을 없앤다;
  - 플러그인 갱신 때 데몬 재시작으로 약 60초 공백(launchd `ThrottleInterval 60`);
  - 시청자 N명이면 snapshot N번, 스트림 N개(공유 스트림은 미룸).

### 5.2 권고

**(a) 열기·재접속·다중 시청: 원칙을 바꾸지 않는 세 가지부터.** 네이티브 RC 성능의 근원(2.2절)이 주는
네 효과 중 셋은 hub 저장 없이 얻는다.

| 효과 | 원칙 안에서 얻는 길 | 근거 |
|---|---|---|
| 재접속 때 재snapshot 없음 | 세션 plane 구독을 cursor 기반으로: 브라우저가 마지막으로 받은 행의 위치를 대고 그 뒤만 받는다 | 기계 쪽 plane이 파일별 offset 색인으로 이미 페이지를 만들고(desk §9.2, `S/sminos_plane.py`), bridge 자식도 cursor 뒤의 행 id를 돌려준다(`rows?after=`, `M/bridge.tsx:1189-1197`). 구독이 cursor를 받게 하는 것은 DX4 변경이다 |
| 빠른 재열기 | 브라우저 쪽 행 캐시 + 꼬리 확인 | claude.ai가 `afterSeq = max(seq)`로 하는 방식(6.2절). desk-web은 #57 이후 그린 행을 이미 유지한다 |
| 시청자 N명 = 기계 스트림 하나 | hub의 세션당 공유 스트림 | desk 백로그(spec "one shared stream per session", DX4 변경) |
| 기계가 꺼져도 열람 | **없음.** hub 저장이 필요하다 | 아래 (a′) |

desk 설계는 hub 버퍼가 "snapshot 비용만 줄인다(G6이 그게 중요한지 잰다)"고 적었다(spec:2850-2851).
기준선 측정(f)과 G6 수치로 셋의 우선순위를 정한다.

**(a′) 기계가 꺼졌을 때의 열람: hub가 세션 이력을 저장할지 — owner 결정.**
- 내용: 세션마다 행 로그(봉투 `{session, seq, kind, ts, size, uuid}` + 본문)를 hub에 둔다. 델타는 저장하지
  않는다. 기계의 JSONL이 원본이고 hub 로그는 기계가 채우는 캐시이며 보존 한도를 둘 수 있다.
- **행은 나중에 바뀐다.** Claude Code transcript는 parent로 이어진 사슬이라 Esc rewind, `/clear`, compact,
  fork가 앞선 행을 살아 있는 사슬 밖으로 밀어낸다. desk 회고도 이것을 짚었고(off-chain mark), bridge는
  "Esc가 지나쳐 되감은" 전달을 다시 보낸다(`M/bridge.tsx:393`). 단순 append-only 캐시는 기계의 JSONL과
  다른 이력을 보여 준다. 사슬 변경 이벤트(묘비, 가지)를 정의하고, hub가 살아 있는 사슬을 담는지 원본 파일을
  담는지 정해야 한다.
- 제약: DO SQLite 객체당 10GB, 행당 2MB, R2 키당 초당 쓰기 1회(sminos-hub 설계의 봉인 세그먼트안 참고).
- desk가 이 방향을 기각한 근거는 둘이다(spec:444-450, 671-673): hub는 transcript를 저장하지 않는다는 원칙,
  그리고 E2E 기각 사유인 "hub가 `to`와 `kind`를 읽어야 라우팅"과 "org 단계에선 그룹 키 배포가 필요".
  세션 plane은 봉투만으로 라우팅되므로 첫 사유는 약해지지만, 두 번째는 org 시청자가 생기면 그대로 적용된다.

**(a″) 암호화로 무엇을 막을 수 있는가 — 위와 별개의 결정.**
- 저장분을 세션 키로 암호화하면 막는 것: DO·R2 저장소가 새거나 Cloudflare 쪽에서 저장분을 읽는 것.
- 막지 못하는 것: **hub를 배포할 수 있는 사람.** 같은 Worker가 웹앱을 내려준다(`apps/desk-hub/wrangler.jsonc`
  `assets.directory: "../desk-web/dist"`). 배포자는 키를 빼돌리는 JS를 내보낼 수 있다. desk 설계도 "웹앱
  배포가 손상되면 페이지에서 키를 읽을 수 있다"고 인정한다(spec:666-668).
- 진짜 E2E(hub 운영 주체도 못 읽음)를 주장하려면 웹 코드를 hub와 따로 통제되는 출처에서 받아야 한다:
  무결성 고정된 별도 origin, 설치형 셸(PWA 이상의 무결성이 필요하다), 또는 Desktop·네이티브 앱.
  Happy의 E2E가 성립하는 것도 클라이언트가 앱 스토어 앱이기 때문이다.
- **기계 쪽 암호 라이브러리 부재.** 데몬은 stdlib Python이고 stdlib에는 AEAD도 ECDSA도 없다(spec의 "no
  Ed25519 … HMAC-SHA256 only"). mod 런타임의 `crypto.subtle`은 `digest`뿐이다(dts:15544-15551). 암호화나
  서명을 기계에서 하려면 의존성 추가(`cryptography`), `openssl` 호출, 또는 다른 런타임의 구성요소가 필요하다.
  이 비용은 8절 갈림길 5의 서명 권고에도 똑같이 걸린다.

**(b) 세션 상태 문서.** `external_metadata`에 해당하는 작은 키 병합 문서를 세션마다 둔다: 상태,
대기 동작 요약, 모델, 모드, effort, 컨텍스트, 한도(gateway가 줄 때), 턴 요약, 브랜치. 목록·배지·미터를
이벤트 재생 없이 그린다. 터미널 세션은 bridge가 이미 보내는 것(`usage`, `turn.complete`, `tool.check`로 얻는
대기 요청)을 모아 만들고, hosted는 stdio 프레임에서 유도한다.

**(c) 영수증.** client 이벤트(보내기, steer, 답변)마다 received/processed를 돌려준다. desk에는 log
`human`의 delivery가 있으니 같은 모양을 steer와 RPC로 넓힌다.

**(d) uplink 처리량.** 프레임 배치(예: 100개 또는 1MiB), POST 파이프라이닝이나 기계용 WebSocket
(hibernatable WS는 미뤄져 있다), log 업로드 배치, 플러그인 갱신 시 재시작 없는 교체.

**(e) 델타 병합.** 수십 ms 창으로 델타를 묶어 프레임 수를 줄인다. 네이티브 RC도 델타를 ephemeral로
따로 다룬다.

**(f) 기준선 측정.** 네이티브 RC의 실제 지연은 바이너리로 알 수 없다. 구독 로그인이 되는 기계 하나에서
`claude remote-control` + claude.ai/code로 열기, 델타, 권한 왕복을 재고, 같은 시나리오를 desk에서 잰다.
동등성 목표를 숫자로 고정하는 유일한 방법이다.

---

## 6. UX 동등성: claude.ai 클라이언트가 하는 것

출처는 Claude Desktop **app-2.42304.0**(설치본, 2026-10-18 재추출)에 번들된 claude.ai 웹앱과 Desktop
main process의 정적 분석이다. 전체 프로토콜 참조(엔드포인트 표, 상수 표, 인용)는
[claude-ai-rc-client-protocol.md](claude-ai-rc-client-protocol.md)에
따로 있고, 이 절은 설계에 영향을 주는 것만 추린다. 인용 접두(`EPI`, `S104`, `STORE`, `SDK`, `CC43`, `MU`,
`CZ`)는 그 문서 첫 표에 풀려 있다.

### 6.1 설계를 바꾸는 발견

1. **브라우저가 Agent SDK를 직접 돌린다.** claude.ai/code는 모든 cloud·RC 세션을 브라우저용 SDK
   빌드의 `query()`로 연다. 제어 요청, 권한, dialog 처리를 SDK의 `Query` 클래스가 한다. 즉 웹 페이지가
   **원격 전송 위의 SDK 호스트**다(EPI:13173-13174, 13448-13468; SDK:87940-87992). MAWS engine host도 SDK
   호스트다. web MAWS가 같은 모양(브라우저 = stream-json 제어 프로토콜의 호스트)을 취하면 네이티브
   클라이언트와 구조가 같아진다(8절 갈림길 2).
2. **RC 세션의 실시간 경로는 v1 WebSocket이고 재생이 없다.** `wss://…/v1/sessions/ws/{id}/subscribe`를
   `replay`나 `from_event_id` 없이 연다(EPI:13465; S104:19915-19930). 끊긴 구간은 스트림 재생이 아니라
   **HTTP 페이지로 채운다**(`events?sort_order=asc&cursor=<headSeq>`, 3회 재시도, STORE:13337-14016).
   v2 SSE는 게이트가 켜진 cloud 세션에만 쓴다. 네이티브 RC의 성능은 "실시간 소켓 + 서버 로그의 HTTP
   페이지"의 조합에서 나온다는 뜻이고, 2.2절의 결론을 강화한다.
3. **worker 생존 여부는 세션 스트림에서 오지 않는다.** `session_update`를 무시하고, 세션 레코드 폴링
   (실행 중 15초, RC 30초), 계정 watch SSE, 클라이언트 쪽 감지기(`connection_status:"disconnected"` +
   비-user 프레임 70초 없음)로 판단한다(EPI:19109-19157).
4. **웹은 dialog 종류를 선언하지 않는다.** 모르는 종류는 `{behavior:"cancelled"}`로 답한다
   (EPI:8038-8048). 처리하는 `request_user_dialog`는 `refusal_fallback_prompt`, `auto_mode_server_fallback`
   두 종류뿐이다.
5. **배포된 클라이언트는 RC 세션에 cloud보다 적게 준다.** RC에는 서버 `unread`/`mark_read`가 없고,
   Desktop 알림에서 빠지고, 보낸 대기 메시지를 취소·수정할 수 없고(`Qw`가 cloud만 허용, EPI:9591-9597),
   `get_settings`·`get_task_output`·`list_directory`가 없다. 반대로 `fork_conversation`, `/btw`,
   "Continue in cloud"는 RC 전용이다.
6. **보내는 이벤트마다 서명한다**(게이트 `ccr_per_message_attestation_web`). ECDSA P-256, 도메인 분리된
   preimage, 브라우저는 IndexedDB의 추출 불가 WebCrypto 키, Desktop은 Secure Enclave 키(S104:8286-8489).
7. **Desktop은 세 갈래로 RC 호스트 역할을 한다**(6.9절).
8. **Desktop의 "self-hosted execution" 모드**가 웹앱의 세션 API를 설정된 호스트로 전달한다(6.10절).
   #52 본문에 없는 네 번째 통합 경로다.

### 6.2 세션 열기와 이력

- 기본(`ccr_pewter_heron`)은 최신 창 `events?limit=200&sort_order=desc`를 먼저 받고, 더 오래된 것은
  필요할 때 500개씩 내림차순으로 받는다. 실패 문구 "Couldn't load earlier messages. Try again."
- 캐시된 행이 있으면 `afterSeq = max(seq)`부터 꼬리만 확인한다.
- uuid로 중복 제거. 서버 순번 모드에서는 `headSeq`가 연속으로만 전진해 빈 구간이 보인 채로 남는다.
- 메모리 보존: 마지막 시청자가 떠나도 60초(턴 중이면 6분), "작업 중" 세션 8개를 15분·200행으로 유지.
- desk 대응: 세션 view는 기계에서 페이지를 받는다(§9.2). hub 로그(5.2 a)가 있으면 이 흐름을 그대로
  재현할 수 있다.

### 6.3 스트리밍 표시

- 델타를 블록별로 모아 **33ms**마다 그린다(패널 숨김 100ms, 문서 숨김 200ms). 블록이 끝나면 즉시 flush.
  같은 `message.id`의 최종 `assistant`가 오면 스트림 행을 숨긴다(STORE:7428-7907).
- 서브에이전트 델타는 그리지 않는다(메인 스레드만). desk는 서브에이전트 델타까지 스트리밍하므로 이미 더
  많이 보여준다.
- 작업 줄: "Waiting for Claude…"(`system/status requesting`), "Thinking…" 15/30/45/60초 단계,
  "Compacting session…", "{cause} · Retrying (n/m)", 턴 끝 "Thought for {s}s".

### 6.4 보내기

- **낙관적 echo**를 uuid로 넣고 서버 echo로 교체한다. 실패하면 echo를 지우고 composer 텍스트를 되돌린다.
- **지속 outbox**: sessionStorage `session-pending-messages`에 저장해 새로고침 뒤 재시도할 수 있다.
- 대기 중인 prompt는 `delivery_update`가 `PROCESSING`/`PROCESSED`를 알릴 때까지 transcript에 올리지
  않는다(EPI:4886-4985). 영수증(2.4절)이 UX에 직접 쓰이는 지점이다.
- 턴 중 Enter는 `priority:"next"`(steer), ⌘↵는 `priority:"later"`(대기열). 대기 막대: "N messages queued",
  "Send now"(RC에선 interrupt 후 실행), "Remove from queue", 순서 바꾸기.
- 세션 생성 직후 첫 전송은 한 배치: `set_permission_mode`, `set_model`, `apply_flag_settings`, 그리고 `user`.

### 6.5 composer

- **slash 명령 목록**: `system/init.slash_commands`(+ skills, plugins), `initialize` 응답의 `commands`(설명,
  인자 힌트), `commands_changed`가 교체. init 전에는 정적 대체 목록. Fuse.js 퍼지 매칭.
- **호스트가 가로채는 명령**: `/btw`→`side_question`, `/model`, `/effort`, `/plan`, `/permissions`, `/rename`,
  `/rewind`, `/fork`, `/status`, `/diff`, `/tasks`. 나머지는 **평범한 `user` 텍스트로 보낸다.**
- `!` 셸은 원격 세션에서 거부("Shell commands are only available in local sessions."), `/cd`·`/memory` 차단.
- **`@` 멘션**: 디바운스 없이 `file_suggestions{query}`, 1.5초 타임아웃, 50개, 오래된 응답 버림.
- **이미지**: 클라이언트에서 2000px·512KB 이하로 압축 → 업로드(`POST /api/{org}/upload`, 동시 4, 최대 16) →
  `file_attachments`. 실패하면 base64 inline 이미지 블록. 일반 파일은 메시지당 5개·30MiB.
- 초안은 localStorage에 400ms 디바운스로 저장.

### 6.6 권한 카드

- 카드는 `tool_use_id`로 저장하고 답은 wire의 `request_id`와 `toolUseID`로 보낸다.
- 버튼: Deny, Allow once, Always allow, Allow and switch to Auto. ExitPlanMode는 Reject, Revise, Accept,
  Accept and allow edits/auto. **웹의 "Always allow"는 `destination:"session"`으로 강제**된다(최대 5규칙).
- **오클릭 방지**: 카드가 뜬 뒤 400ms 안의 "always" 결정은 "once"로 낮춘다. 입력 상세가 아직 없으면
  거부만 가능.
- worker의 `control_cancel_request`가 오면 **아무것도 보내지 않고** 카드를 내린다.
- 접속 때 다시 보여주는 출처 세 가지: `initialize` 응답의 pending 목록, 이력 끝의 답 없는 `can_use_tool`,
  `external_metadata.pending_action`. 이미 답한 것은 localStorage 캐시(300초)로 거른다.
- desk 대응: 카드, 경쟁, 철회, digest 결속은 있다. 오클릭 방지, 세션 범위 "Always allow"
  (`updatedPermissions`), "Allow and switch to Auto", 접속 시 세 출처 재표시는 확인·추가 대상이다.

### 6.7 목록, 상태, 오프라인

- 상태 매핑 `FT`: worker_status가 아직 없으면 **pending**, `running`은 연결됐을 때만 running, 나머지 그대로
  (S104:14564-14610). 목록 우선순위: archived → error → awaiting → running → unread → PR → idle.
- "awaiting" = 대기 승인, `requires_action`, 또는 요약이 `blocked`/`need_input`인 안 읽은 행.
- RC 오프라인: 노트북 아이콘에 사선, "{machine} · Offline". 25초 뒤 "Reconnecting to your computer…"
  밴드, 이어서 "Continue in cloud…". `error_kind`: `computer_unreachable`, `host_exit`,
  `remote_control_disabled`, `never_connected`, `owner_changed`, `worker_auth_expired`, `environment_deleted`.
- 알림: 브라우저는 FCM web push. Desktop은 watch 스트림에서 running→`requires_action`이면 즉시,
  →idle이면 10초 뒤 알린다. **RC 세션은 Desktop 알림에서 빠져 있다.**

### 6.8 연결 생명주기

- 상태: connecting, reconnecting, connected, disconnected. 백오프 `max(min(1000·2^(p−1), 30000) ×
  U(0.75,1.25), retryAfter)`, 6회. 30초 이상 유지되거나 10프레임을 받으면 카운터 초기화.
- 예산을 다 쓰면 "Disconnected from the remote session. Send a message or refresh to reconnect."를 띄우고,
  온라인 복귀, 탭 표시, 사용자 전송 때 다시 연결한다.
- 깨우는 계기: 화면 열기, 전송, `pending_action` 등장, 권한 답변.
- presence: 탭마다 `client_id`로 20초마다, 30초 무입력이면 idle, 탭을 숨기면 2초 뒤 해제. 별도로 `ping`
  `{cause: open|viewing|typing}` 30–120초.

### 6.9 Desktop의 세 갈래

- **A. 로컬 Code 세션에 RC 켜기**: `query.enableRemoteControl(enabled, title)`. work secret 없이 CLI가
  직접 CCR 세션을 만들고 붙는다(CF:45897-46140).
- **B. "이 Mac/폴더 서비스"**: Desktop 자신이 bridge environment다. `POST /v1/environments/bridge`로
  등록하고 work를 폴링(최근 폴더 5초, 그 외 20초)한다. 받은 work item의 `secret`을 `remote_control`
  제어 요청으로 CLI에 넘기고(설정 `attachWithWorkSecret`, 기본 false), `remote_control_work_secret`
  갱신 요청이 오면 `/bridge/reconnect`로 재큐잉해 새 secret을 받는다(CZ:4791-4916).
- **C. Cowork**: `worker_type:"cowork"` environment, SDK의 `attachBridgeSession`으로 Desktop이 직접 worker가
  된다.
- 의미: MAWS(SDK 호스트)가 desk에서 하려는 일을 Desktop이 Anthropic 백엔드로 하고 있다. B의 구조
  (호스트가 environment가 되어 work를 받고 자식 세션에 넘김)가 desk의 hosted 세션 경로에 그대로 대응한다.

### 6.10 네 번째 통합 경로: Desktop self-hosted execution

- 설정 키 `selfHostedUrl` + 자격증명(`selfHostedToken`, helper script, external IdP). scope `3p`,
  `visibility:"public-undocumented"`, 2.16120부터. 켜면 "3P mode active (self-hosted execution; no inference
  on this device)"가 되고 claude.ai 계정을 쓰지 않는다(MU:171658, index.pre.js:34130-34232).
- Desktop이 `/v1/code/sessions*`, `/v1/code/triggers*`, `/v1/environment_providers/*`,
  `/v1/code/runners/self-hosted/sessions/*`를 그 호스트로 전달하고 `Authorization: Bearer`를 붙인다.
  SSE는 통과하고 WebSocket은 안 된다(터미널, share는 깨진다).
- 우리가 구현할 호스트 계약: `capabilities`, environments, 세션 목록·조회·생성·수정·archive·삭제·
  mark_read·ping, `events` 페이지 GET과 POST, `events/stream` SSE, `sessions/watch` SSE. payload는 SDK
  stream-json이라 핵심은 봉투 변환이다(추론).
- **판단**: Desktop 전용 두 번째 클라이언트로는 가능하다(대략 한 milestone). 폰이나 claude.ai 동등성의
  길은 아니다. Desktop 프로필을 통째로 3P 모드로 바꾸고(claude.ai 계정·로컬 세션 없음), 계약이 릴리스마다
  바뀐다(`host_report`, `diagnostic_counts`가 2.16120 이후 추가). 시간 상한을 둔 스파이크 가치는 있다:
  mock 호스트 + `http://127.0.0.1:<port>`를 가리킨 Desktop. **네이티브 UI 자체를 우리 세션의 클라이언트로
  쓰는** 유일한 길이라, 동등성 비교의 기준선으로도 쓸 수 있다.

### 6.11 동등 클라이언트가 네이티브보다 잘할 수 있는 곳

- RC 세션의 보낸 대기 메시지 취소: worker는 `cancel_async_message`를 구현한다. 웹이 막아 둔 것뿐이다.
- RC 세션 알림: Desktop은 뺐다.
- dialog 종류 선언: 웹은 하나도 선언하지 않는다. hosted 세션에서 `supportedDialogKinds`를 선언하면 더
  많은 dialog를 원격에서 받는다.
- 서브에이전트 델타 스트리밍: desk는 이미 한다.
- `!` 명령: 네이티브는 원격에서 거부한다. hosted 세션의 `bash_command`나 터미널 세션의 도구 호출로 정책
  아래에서 허용할 수 있다.
- 비용·소요 시간 표시: 웹은 `result`의 비용을 localStorage에만 넣고 보여주지 않는다.

### 6.12 Desktop SSH 모드: 다른 기계를 로컬 수준으로 다루는 Anthropic 자신의 설계

(2026-10-19 추가. 상세는 [desktop-modes-main.md](desktop-modes-main.md) §3,
[desktop-modes-renderer.md](desktop-modes-renderer.md))

- **구조**: SDK `Query`는 Desktop main에 그대로 있고 `spawnClaudeCodeProcess`만 갈아 끼운다(CF:81191).
  원격 호스트에는 Desktop이 배포한 helper 데몬 `claude-ssh`가 `--serve --socket`으로 돌고, SSH 연결마다
  `--bridge` 채널 하나로 JSON-RPC `process.spawn`/`reattach`, `files.*`, `git.*`를 나른다(D3:16733, 19255).
  CLI는 Desktop과 같은 고정 버전(2.1.299)을 helper가 `~/.claude/remote/`에 설치한다.
- **데몬이 프로세스를 소유한다**: Desktop이 끊기거나 종료해도 CLI는 계속 돌고, 다시 붙으면 checkpoint에서
  재입양한다(최대 3–7일, CF:80630). 끊긴 동안 출력은 세션당 16 MiB 버퍼에 남고, 권한 요청은 원격에서
  기한 없이 기다렸다가 재접속 때 다시 뜬다(공식 문서 desktop#handle-requests-that-arrive-while-you-are-away).
- **결과**: 로컬 세션의 기능 거의 전부(제어 subtype 전체, terminal, git, 파일, 호스트 쪽 worktree,
  connector, plugin, side chat)가 원격 기계에서 유지된다. 빠지는 것은 Desktop 옆에서만 되는 것(Browser
  pane, cwd 변경, merge-when-ready, 파일 pane 편집)뿐이다.
- **한계**: 제어면이 Desktop 한 대다. connector처럼 Desktop을 거치는 도구는 끊기면 약 30초 뒤 실패하고,
  여러 기기에서 동시에 보거나 조작하는 경로가 없다. 같은 기계를 RC로 보면 폭이 다시 좁아진다.
- **desk에 주는 의미**: 이것이 "원격 기계를 로컬 수준으로"의 기준 설계다. sminos 데몬이 stdio 자식을
  소유하는 hosted 세션 경로(§3.2)는 helper 역할에 해당하고, hub가 그 위에 여러 클라이언트로의 relay를
  더한다. SSH 모드의 깊이와 RC의 도달 범위를 함께 가진 Anthropic 제품은 없다. 이 조합이 desk가 노릴
  자리다. 기능 기준 자체는 MAWS다(1절의 재선언). SSH 모드는 그 기능을 원격으로 옮길 때의 분할과
  내구성(프로세스 소유, checkpoint 재생, 재입양)의 참조 설계로 쓴다.
- **가져올 것은 구조이지 SSH 전송이 아니다**: 중앙 웹 클라이언트에서 SSH를 그대로 쓰면 브라우저 대신
  중앙 서버가 SSH와 `Query`를 쥐어야 한다. 그러면 그 서버의 재시작·배포가 모든 기계의 제어를 끊고(desk 끊김
  53건 중 29건이 배포), 서버가 모든 기계의 셸 자격증명을 모으며, 기계마다 inbound 도달성이 필요하다.
  `Query`는 기계 위 데몬이 쥐고, 데몬이 hub로 outbound 연결하고, hub는 중계만 한다. SSH는 데몬을 처음
  설치하고 갱신하는 경로로 쓴다(Desktop도 `claude-ssh`를 SFTP로 올린다, D3:199-342).
- **데몬이 갖출 표면(claude-ssh 기준)**: `process.spawn/stdin/reattach/kill`, `files.*`, `git.*`,
  `launcher.resolve`, `server.capabilities/ping`(DK:3405-3407), PTY, 세션별 seq 출력 버퍼와 그 seq부터의
  재전송, 자식 기록(`children/<pid>.json`)과 재입양 조건(사람·정책 서명·호스트 키·launcher 일치,
  M/index.chunk-DBPLojse.js:150-200), 고정 CLI 버전 설치(`--cli-version … --cli-keep 3`, D3:18233-18263).
- Desktop SSH 세션에도 RC를 켤 수 있다(재입양 조건에 `remoteControl`이 들어 있다). Anthropic이 주는
  조합은 "Desktop 한 대는 SSH 깊이, 나머지 기기는 RC의 좁은 표면"이다.

---

## 7. 선행 사례와 교훈

조사 대상: Happy, Omnara, CloudCLI(claudecodeui), claude-code-webui, Claudable, opcode, vibe-kanban,
Crystal/Nimbalyst, Conductor, 공식 channels 플러그인, 커뮤니티 Telegram/Discord/Slack/tmux 브리지,
ACP + claude-agent-acp. 원 보고의 표와 이슈 번호는 부록 A에 있다.

**붙는 방식은 네 가지뿐이다.**
1. Agent SDK나 stream-json으로 직접 띄운다. 구조화된 승인을 얻지만 "넘겨받기"는 두 번째 프로세스의
   `--resume`이라 대화가 갈라진다.
2. TUI를 PTY나 tmux로 감싼다. 충실하지만 프롬프트를 화면에서 읽어야 하고 TUI가 바뀌면 깨진다.
3. 공식 channels. 공식 경로지만 `--channels`로 시작한 세션만, 들어오는 글은 "untrusted"로 표시되고
   밖으로는 아무것도 미러링되지 않는다.
4. 섞는다(Happy, Nimbalyst). 오래 살아남은 설계는 이쪽이다.

**실행 중인 터미널 세션에 붙는 제3자 도구는 없다.** 거의 모든 트래커에 요청이 있다(Happy #478,
Omnara #163/#186, Conductor #19/#22, vibe-kanban #3293). desk의 mod는 엔진 안에서 돌아서 이것을 한다.

**desk 설계에 바로 쓰이는 교훈.**
1. **세션당 writer 하나.** 가장 흔한 버그는 살아 있는 세션에 대한 두 번째 `--resume`이다(CloudCLI
   #1148/#883/#1144/#1536, opcode #92). hosted 경로를 도입하면 3.4절 절차가 필수다.
2. **대기 프롬프트는 소켓 이벤트가 아니라 지속 상태다.** 턴에 묶고, 해결을 모든 client에 방송하고,
   재접속 때 다시 보내고, 프로세스 재시작에도 살아남아야 한다. 짧은 타임아웃은 폰 사용자의 실제
   불만이다(CloudCLI 55초, #607). desk는 이미 이렇게 한다.
3. **Claude Code는 요청/응답이 아니라 이벤트 스트림이다.** 백그라운드 서브에이전트, task 알림, compact,
   wakeup이 아무도 시키지 않은 턴을 시작한다. 이를 놓친 래퍼는 멈추거나 어긋난다(claude-agent-acp
   #336/#1284, vibe-kanban #2783). 턴 끝은 명시적 신호로(desk #43의 turn-end kind).
4. **재생은 처음부터 전송 계층에.** 세션별 순번, 서버 쪽 재생 버퍼, `lastSeq` 구독, 멱등 id를 가진
   client outbox, uuid 중복 제거. 모바일 브라우저는 백그라운드로 갈 때 소켓을 "정상" 종료한다
   (vibe-kanban #3227). 30초 이하 ping.
5. **보안 기준선은 outbound-only + E2E.** Happy(세션별 AES-256-GCM 키를 계정 키로 감쌈, QR 페어링)와
   Nimbalyst가 운영 중이다. 푸시 payload는 E2E여도 APNs/FCM에 메타데이터가 샌다.
6. **푸시는 승인이 필요할 때가 핵심이고 presence로 거른다.** presence를 틀리면 전부 막힌다(Happy #1464).
7. **엔진 버전 표류에 대비.** 새 메시지 타입, 플래그 의미 변화, 설치 방식 차이. 관대한 파싱, 버전 고정
   또는 검증, `claude` 경로 설정. Omnara의 중단 사유가 "Claude Code의 잦은 업데이트로 래핑 유지 불가"였다.
8. **약관.** Anthropic 법률 문서는 제품을 만드는 개발자는 API key를 쓰고, 자기 앱에서 claude.ai
   로그인을 제공하지 말라고 한다. 사용자가 수정되지 않은 Claude Code에 자기 구독으로 로그인하는 것은
   막지 않는다. 개인용 relay는 이 범위 안이고, 로그인을 중개하는 배포 제품은 아니다. 이 영역은 2026년에
   두 번 바뀌었다. desk 설계가 SDK 호스팅을 기각한 이유 중 하나("구독 자격증명의 SDK 제품은 2월 약관에
   가깝다", spec:342-349)는 API key·gateway 환경에서는 무게가 다르다.

---

## 8. #52의 갈림길별 근거와 권고

#52 본문의 일곱 갈림길에 이 리서치가 주는 근거다. 권고는 출발점이고 결정은 #52 논의에서 한다.

1. **전송과 프로토콜.** (c) "브라우저가 Anthropic relay를 직접"은 코드상 불가다(3.1절). (a) desk hub를
   키우고 (b) hosted 세션을 stdio로 더하는 조합이 남는다. 프로토콜은 CCR v2의 구성(순번 로그, 상태 문서,
   영수증, 단일 worker, 대기 프롬프트 재전달)을 desk의 DX4–DX6 위에 재현하는 방향을 권한다.
   **(d) 새 선택지**: Desktop self-hosted execution 호스트 계약을 구현해 네이티브 Desktop UI를 두 번째
   클라이언트로 쓴다(6.10절). 주 경로가 아니라 기준선·보조 경로로 본다.
2. **MAWS 하나냐 포트냐.** 세션 plane의 공용어를 **엔진의 SDK 메시지 스키마**(stream-json의 `user`,
   `assistant`, `stream_event`, `system/*`, `control_*`)로 정하는 것을 권한다.
   - 네이티브 REPL bridge도 TUI 대화를 이 스키마로 바꿔 서버에 보낸다.
   - claude.ai 웹은 브라우저 안의 SDK `Query`로 이 스키마를 직접 처리한다(6.1절). 즉 네이티브 클라이언트는
     "원격 전송 위의 SDK 호스트"다. MAWS의 engine host broker도 같은 `control_request` 봉투를 쓴다.
   - hosted 세션은 그대로 흘리고, 터미널 세션은 bridge mod가 행과 `turn.step` 청크를 같은 모양으로 바꾼다.
     그러면 MAWS 렌더러(이미 stream-json을 읽는다)와 web MAWS가 두 종류의 세션을 같은 코드로 그린다.
     지금은 desk-web에서 어댑터가 이 변환을 한다.
3. **터미널(`!`).** hosted는 `bash_command`(기계 정책으로 제한), 터미널 세션은 `$.tool.call`로 Bash를
   부르는 방법을 스파이크로 확인한다. 진짜 PTY는 phase 2의 비상 경로로 step-up 인증 뒤에 둔다.
4. **새 세션과 실행 위치.** 네이티브 headless 서버의 형태(spawn 모드 same-dir/worktree/session, 용량,
   project thread 재큐잉)가 참고 모델이다. 클라우드 VM은 #37의 join token이 선행 조건이다.
5. **권한.** 네이티브 RC는 이벤트마다 기기 서명 판정, trusted device, 단명·용도별 자격증명을 쓴다.
   claude.ai 웹은 보내는 이벤트마다 기기 키로 서명한다: ECDSA P-256, 도메인 분리 preimage
   (`"anthropic.ccr.client_event.v1"`, 세션, uuid, type, payload의 JCS 해시), IndexedDB의 추출 불가
   WebCrypto 키, `POST /api/auth/trusted_devices`로 등록(6.1절). desk의 대응은 #38(명령 키 분리, 기계별
   서명 키)이다. **브라우저마다 추출 불가 WebCrypto 서명 키를 두고, 기계는 owner가 서명한 기기 목록으로
   검증하는** 방식이 네이티브 패턴과 #38의 목표를 함께 만족한다. 공유 HMAC 키가 페이지에 노출되는 현재의
   잔여 위험(spec:666-668)도 줄인다. 비용: 기계가 ECDSA를 검증하려면 stdlib 밖의 암호 구성요소가 필요하다
   (5.2 a″). 웹 코드를 hub가 내려주는 동안에는 배포자가 서명 코드를 바꿀 수 있다는 한계도 같다.
6. **세션 제어 지점.** 네이티브 RC worker 재사용은 불가로 확정(3.1절). 터미널은 mod, hosted는 stdio.
   bridge는 이미 `$.session.usage`와 `tool.check`를 쓴다. 아직 노출하지 않은 것은 `$.command.run`(slash 명령)과
   `$.ui.status`(TUI의 "원격 연결됨" 표시)다. hosted 세션에서는 bridge가 제어에서 물러나야 한다(3.2절).
7. **폰.** 2026-10-18에 폰의 direct channel이 session view가 되어(desk §4 개정) 네이티브 앱과 같은
   방향이다.

**우선순위 제안.**
1. 기준선 측정(5.2 f). 동등성 목표를 숫자로 고정한다.
2. 원칙 안의 성능 작업(5.2 a): cursor 기반 구독, 브라우저 행 캐시 + 꼬리 확인, 세션당 공유 스트림.
   그다음 uplink 처리량(5.2 d)과 staging 배포(끊김의 대부분이 배포였다).
3. 터미널 세션의 기능 격차 중 싼 것: `$.command.run` 노출(slash 명령), 데몬이 직접 답하는 `@` 파일 제안과
   파일 읽기, 첨부를 저장 + `@<경로>`로 넣는 스파이크.
4. hosted 세션 경로: stdio 파이프의 소유자 결정(3.2절), 제어 중계 + 허용 목록, bridge가 물러나는 규칙,
   3.4절 넘겨주기 절차.
5. 상태 문서와 영수증.
6. owner 결정: 기계가 꺼졌을 때의 열람을 위해 hub가 이력을 저장할지(5.2 a′), 그리고 저장분 암호화와
   진짜 E2E를 어디까지 원하는지(5.2 a″). 둘은 따로 정한다.
7. 기기→앱 파일(`SendUserFile` 대응), MCP 상태.

---

## 9. 확인이 필요한 것

| 질문 | 확인 방법 |
|---|---|
| 네이티브 RC의 실제 지연(열기, 델타, 권한 왕복) | 구독 로그인 기계에서 측정 |
| 터미널 세션에서 `$.prompt.submit`의 `@<경로>` 멘션이 이미지 블록으로 들어가는가 | 스파이크 |
| stdio 호스팅 세션에서 bridge의 `PermissionRequest`와 호스트의 `can_use_tool`이 경쟁하는가 | 스파이크 |
| 실제 RC 사용자가 받는 전송(WS인지 SSE인지), `delivery_update` 상태 집합, 서버의 `catch_up_truncated` 조건 | 로그인 계정으로 동적 probe(owner 승인 필요), `spikes/protocol-probe/` 관례 |
| Desktop self-hosted execution 호스트 계약의 최소 구현 | mock 호스트 + Desktop 스파이크(시간 상한) |
| gateway·API key 환경에서 `tengu_plugin_hooks_modules`의 실제 값 | 대상 기계에서 엔진 디버그 로그 |
| 터미널 세션 `!`: `$.tool.call`로 Bash를 부르면 transcript와 TUI에 어떻게 남는가 | 스파이크 |
| bridge에서 `$.command.run`으로 되는 명령(`/clear`, `/model`, `/effort`, `/rename`, `/plan`) | 스파이크 |
| MAWS hosted 세션(`-p` stdio)에서 bridge의 steer·interrupt·권한 결정 | 스파이크(지금 미시험) |
| hub 세션 로그의 처리량과 비용(DO SQLite, R2) | 부하 실험 |
| stdio `request_user_dialog`가 실제로 보내는 dialog 종류 | 코드 열거 + 실행 |
| mod의 long-poll이 classic hook의 600초 상한에 걸리는가 | 스파이크 |

---

## 부록 A. 선행 사례 비교표

2026-10-18 조사. 소스, LICENSE, 이슈 트래커를 커밋 기준으로 읽었고 약 25개 저장소·이슈를 `gh`로 표본
확인했다. 끝까지 실행해 본 것은 없다. "(uncertain)"은 출처가 직접 말하지 않는 추론이다.

### A.1 붙는 방식, 미러링, 권한 중계

| 프로젝트(상태) | 붙는 방식 | 이미 터미널에서 도는 세션을 미러링? | 권한 프롬프트가 원격에 닿는 방식 |
|---|---|---|---|
| Anthropic RC | 프로세스 내 REPL bridge, 서버 모드는 `--sdk-url` stream-json 자식 | 예(`/remote-control`) | 네이티브, 답할 때까지 열림 |
| Happy (활발, CLI v1.2.5) | 혼합, PTY 없음. local 모드: 실제 TUI + JSONL tail + SessionStart hook. remote 모드: TUI를 죽이고 같은 session id로 SDK `query({resume})` | 아니오. `happy`로 시작한 세션만 | remote 모드만, SDK `canUseTool` + 암호화 RPC |
| Omnara (래퍼는 2025-11 중단) | `pty.fork` + JSONL tail, 화면 문자열로 idle 판정 | 아니오 | 화면의 "Do you want"를 읽고 번호 입력 |
| CloudCLI / claudecodeui (활발) | 채팅: SDK `query()` + 보낼 때마다 `resume`. 셸 탭: node-pty `claude --resume` | 아니오. 6초 폴링 읽기 전용 | `canUseTool` over WebSocket, **55초 뒤 거부**, auto/bypass에서 누락(#873) |
| claude-code-webui (2026-05 보관) | 턴마다 `-p` 프로세스 | 아니오 | 거부→중단→숨은 "continue" 재전송 |
| Claudable (휴면) | 턴마다 SDK `query()` | 아니오 | 없음(bypass) |
| opcode (2025-10 이후 미유지) | 턴마다 `claude -p` | 아니오 | 없음(skip-permissions) |
| vibe-kanban (종료 중) | `claude -p` stream-json + stdio 제어 프로토콜, 버전 고정 | 아니오 | `can_use_tool`, PreToolUse hook이 `"ask"` 반환, 10시간 타임아웃 |
| Crystal → Nimbalyst (활발) | Nimbalyst: SDK 기본, 선택적으로 interactive TUI를 node-pty에(bracketed paste, `~/.claude/sessions/<pid>.json`, 로컬 `ANTHROPIC_BASE_URL` 프록시 또는 JSONL) | 외부 세션 읽기 전용 추적 후 보낼 때 resume식 인수(일부 추론) | `canUseTool`. TUI 경로는 loopback HTTP를 부르는 PreToolUse hook("interactive CLI는 `--permission-prompt-tool`을 무시") |
| Conductor (비공개) | 번들된 Claude Code + SDK | 아니오 | 문서 없음(uncertain) |
| 공식 channels (research preview) | `claude/channel` MCP 서버가 `notifications/claude/channel` 푸시 | `--channels`로 시작한 세션만 | `claude/channel/permission`, 로컬 dialog와 경쟁, "로컬에서 해결됨" 이벤트 없음 |
| 커뮤니티 SDK 채팅 브리지 | SDK 또는 stream-json + `--permission-prompt-tool stdio` | 아니오 | 인라인 버튼, 타임아웃 없음~5분 |
| 커뮤니티 tmux 브리지 | `tmux send-keys` 입력, JSONL tail·Stop hook·`capture-pane` 출력 | **세션이 이미 tmux 안이면 예** | `capture-pane` 정규식 |
| ACP + claude-agent-acp (v0.93.0) | ACP JSON-RPC 뒤의 SDK `query()` | 아니오. `session/load`는 transcript에서 재개 | `canUseTool` → `session/request_permission` |

### A.2 relay, 보안, 푸시, 라이선스

| 프로젝트 | relay·자체 호스팅 | 암호화·인증 | 푸시 | 라이선스 |
|---|---|---|---|---|
| RC | Anthropic 전용 | TLS, 서버가 transcript 저장, 단명 자격증명, Trusted Devices | Claude 앱, presence로 억제 | 독점 |
| Happy | Fastify + Socket.IO + Postgres/Redis/S3, 또는 PGlite 내장 `happy server` | **E2E**: QR 페어링 NaCl box, 세션별 AES-256-GCM 키를 계정 키로 감쌈, 서버는 id와 presence만. 푸시 payload에 제목·도구 이름 노출 | Expo | MIT |
| Omnara | FastAPI + Postgres, replay ring buffer가 있는 WS relay | E2E 없음 | Expo, SMS, 이메일 | Apache-2.0 / BSL |
| CloudCLI | 로컬 Express + ws, 0.0.0.0 | 단일 사용자, 7일 JWT 회수 불가, CORS 개방 | Web Push, iOS 고장(#1550) | AGPL-3.0 |
| vibe-kanban | 호스트가 relay로 outbound WS(yamux), 브라우저는 WebRTC 우선 | SPAKE2 6자 코드 페어링, 요청마다 Ed25519 서명, 순번 붙은 서명 프레임. relay 경로 payload 암호화는 못 찾음(uncertain) | 원격 client엔 없음 | Apache-2.0 |
| Nimbalyst | Cloudflare Worker sync 서버(저장소 밖) | E2E: QR 시드 → PBKDF2 → AES-256-GCM | APNs, 데스크톱 부재 시 | MIT |
| 공식 channels | relay 없음, 플랫폼 API 폴링 | 페어링 코드 + 발신자 허용 목록. 플랫폼은 평문을 본다 | 채팅 앱 | Apache-2.0 |
| ACP | 로컬 stdio. 원격 전송 RFD는 v1에서 진행 중 메시지 재생을 하지 않음 | — | — | Apache-2.0 |

### A.3 프로젝트별 아픈 곳 (이슈 번호는 각 저장소)

- Happy: remote에서 돌아온 뒤 터미널 어긋남(#613, #301, #1148), 폰이 가져갈 때 로컬 셸 죽임(#1331),
  승인 대기 중 입력하면 승인 중단(#1735), presence 버그로 푸시 미전달(#1464), stream-json이
  `--remote-control`을 무시해 remote 모드에서 RC 상실(#1859).
- Omnara: 업데이트 후 확인 팝업에서 멈춤(#276), idle 판정으로 알림 80개(#145).
- CloudCLI: 채팅과 CLI가 한 세션을 fork(#1148, #883, #1536), 전환 때 prompt cache 약 200K 재캐시
  (#1144), 고정 55초 승인 타임아웃(#607), 소켓 닫힌 동안 메시지 유실(#1270), 재접속이 명령 재실행(#567).
- vibe-kanban: 완료 미감지로 프로세스 누적(#2495), 서브에이전트가 도는 중 Stop 발화(#2783),
  모바일 브라우저 백그라운드 시 WS "정상" 종료(#3227), 업데이트 후 모르는 `control_request`(#2126).
- Nimbalyst: 모바일 취소 후 폰과 데스크톱 불일치(#1739), 폰의 stop이 다른 턴을 침(#1770),
  백그라운드 작업 종료가 대기 중 AskUserQuestion을 파괴(#1557).
- Conductor: idle 정리가 대기 질문 아래 프로세스를 죽임(#27), 푸시는 왔는데 승인 UI 없음(#24).
- 공식 channels(anthropics/claude-code): 들어온 메시지 무시(#36503), idle 세션을 못 깨움(#44380),
  AskUserQuestion이 원격 사용자를 멈춤(#70294).
- claude-agent-acp: 백그라운드 task 알림 유실로 어긋남(#336), task_notification 유실 시 턴 미종료
  (#1284), 권한 요청 id 어긋남으로 교착(#851), `session/load`가 마지막 compact부터만 재생(#1297),
  RC 미노출(#459), JetBrains의 구독 로그인 빌드 불허(#517).

## 부록 B. 출처

- claude.ai 클라이언트: [claude-ai-rc-client-protocol.md](claude-ai-rc-client-protocol.md)
  (app-2.42304.0, 엔드포인트·상수·인용 전체).
- 엔진: [cli.pretty.js](/Users/new/claude-code-bundle/2.1.300/cli.pretty.js),
  [mod API d.ts](/Users/new/claude-code-bundle/2.1.300/modules/claude-code.d.ts-7e7b76be.txt),
  [SPEC 36](/Users/new/claude-code-bundle/2.1.300/SPEC/36-remote-control-and-bridge.md),
  [SPEC 45](/Users/new/claude-code-bundle/2.1.300/SPEC/45-headless-and-sdk-protocol.md),
  [RC 한국어 지도](remote-control-client-overview.ko.md).
- desk: [설계](/Users/new/Developer/GitHub/MAWS/.claude/worktrees/smns-erb/docs/doperpowers/specs/2026-10-15-desk-design.md),
  [bridge mod](/Users/new/Developer/GitHub/doperpowers/hooks/mods/bridge.tsx),
  [uplink](/Users/new/Developer/GitHub/doperpowers/skills/sminos/scripts/sminos_uplink.py),
  [plane](/Users/new/Developer/GitHub/doperpowers/skills/sminos/scripts/sminos_plane.py),
  MAWS #52, #36, #37, #38, #43, #57.
- 공식 문서: https://code.claude.com/docs/en/remote-control,
  https://code.claude.com/docs/en/channels-reference, https://code.claude.com/docs/en/hooks,
  https://code.claude.com/docs/en/legal-and-compliance.
