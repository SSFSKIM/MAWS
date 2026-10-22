# 기계 쪽 세션 holder 설계 (터미널 세션을 holder가 쥐는 구조 + SDK 경로)

2026-10-22. 설계 문서다. 구현을 승인한 것이 아니다. MAWS #52의 연구 결과
[web-maws-remote-research.ko.md](web-maws-remote-research.ko.md)
§3.6–3.7 위에 선다. 사실의 근거는 다음 네 측정 노트다(모두 Claude Code 2.1.307–2.1.308에서 실행).
- [holder-tui-spike.md](holder-tui-spike.md): 우리 PTY 아래의 plain Claude, 엔진 PTY host 설계 발췌
- [background-work-handoff.md](background-work-handoff.md): 세션을 옮길 때 백그라운드 일
- [mod-command-run-probe.md](mod-command-run-probe.md): mod, `reply`, PTY 키로 slash 명령 돌리기
- [bridge-perf-bench.md](bridge-perf-bench.md): bridge 구간 지연

## 0. 무엇을 위한 것인가

- **장면.** 사람이 MacBook 터미널에서 `claude`로 일하다가 자리를 뜬다. 폰이나 다른 기계의 웹에서 같은 세션을 열어
  흐름을 보고, 말을 걸고, 권한에 답하고, 모델·모드를 바꾸고, 필요하면 되감는다. 돌아와 터미널을 보면 아무것도
  옮겨지지 않았고, 백그라운드 셸·서브에이전트·Monitor·MCP 작업이 그대로 돌고 있다.
- **조건.**
  - 진행 중인 세션을 원격에서 그대로 이어 쓴다. 프로세스를 옮기지 않는다(백그라운드 일을 잃지 않는 유일한 길).
  - 제어 폭은 TUI가 할 수 있는 전부다. 프로그램으로 되는 것은 GUI로 주고, 키로만 되는 것은 웹의 터미널 창으로 준다.
  - 터미널 사용감은 plain `claude`와 같아야 한다.
- **아니어야 하는 것.**
  - RC처럼 좁은 미러.
  - 사람이 일하는 방식을 눈에 띄게 바꾸는 것. holder가 없거나 고장 나면 plain `claude`로 돌아간다.
  - 다시 그리기에 실패했다고 멀쩡한 세션을 재시작하는 것(엔진 supervisor의 job 정책은 가져오지 않는다).
  - hub가 member 서명 없이 실행을 일으킬 수 있는 구조(§3.5의 신뢰 설계를 그대로 따른다).

## 1. owner 결정 (2026-10-22)

1. 사람이 여는 터미널 세션은 처음부터 wrapper를 통해 holder 안에서 돈다.
2. PTY는 우리가 만든 holder가 쥔다(claude-ssh 방식). 엔진 supervisor(`runPtyHost`, `claude daemon`)는 참고만 한다.
3. 경로는 세션이 어디서 시작됐는지로 정한다. 터미널에서 시작한 세션은 TUI로 holder 안에, MAWS 앱이나 웹에서 시작한
   세션은 SDK 경로로 간다. 그리고 웹에 "full-control 모드로 이어 가기" 버튼을 두어 터미널 세션을 SDK 경로로 넘긴다.
4. 키로만 되는 조작은 웹의 터미널 창으로 하고, 검증된 몇 가지만 GUI 매크로로 만든다.

## 2. 구조

```
기계
  사람의 터미널                                   웹(브라우저)
     │ (raw tty)                                     ▲
  claude wrapper ─┐                                  │ hub (중계만)
     │ 직접 연결   │ 입장 요청                         │
     ▼            ▼                                  │
  session host ◀── holder manager ◀── sminos 데몬 ────┘  (uplink, 신뢰 경계, plane)
  (세션마다 하나:   (사용자당 하나: roster, 재입양,   ▲
   PTY master 또는  입장·권한, 터미널 에뮬레이터,     │
   stdio pipe,      checkpoint, 입력·크기 lease)   bridge mod (모든 claude 안)
   job-control                                      │
   helper, byte ring)                               │
     │                                              │
     ├── claude (TUI)                 ─────────────┘
     └── claude -p stream-json  ◀── MAWS 데몬의 Query (SDK 경로, 쓰는 쪽 하나)
```

세션 종류는 둘이고, holder 한 가족이 둘 다 쥔다.
- **PTY 종류**: plain `claude` TUI. 사람의 터미널, 웹 터미널 창이 붙는다. 구조화된 제어는 bridge mod.
- **pipe 종류**: `claude -p --input-format stream-json --output-format stream-json …`. MAWS 데몬의 Query가 붙는다.
  claude-ssh의 `process.spawn`과 같은 모양이다.

## 3. 구성 요소

### 3.1 session host (세션마다 하나, 작고 거의 바뀌지 않는 것)

host가 죽으면 세션이 죽는다(master가 닫히면 SIGHUP, exit 129; spike B2). 그래서 host는 가능한 한 작게 두고,
바뀌는 것은 전부 manager로 보낸다.

- **쥐는 것.** PTY master(PTY 종류) 또는 claude의 stdin·stdout pipe(pipe 종류). 사람이 쓰던 것과 같은 argv, cwd,
  env(셸의 env 전체, allowlist 아님), 크기, termios로 시작한다. `CLAUDE_CODE_SESSION_KIND`는 두지 않는다.
- **job control.** host 안의 helper가 같은 session에 있고, claude는 별도 process group으로서 foreground(`tcsetpgrp`)가
  된다. 이렇게 해야 Ctrl+Z가 claude를 실제로 멈추고 SIGCONT로 이어진다(spike B5에서 확인한 고침).
- **byte ring.** 출력에 절대 offset을 매기고 마지막 N MiB(예: 8 MiB)를 둔다. pipe 종류는 claude-ssh처럼 줄 단위 seq도
  매긴다. stdin은 offset으로 받아 다시 보낸 바이트를 한 번만 쓴다.
- **checkpoint 칸.** manager가 맡긴 터미널 상태 직렬화(§3.2)와 그것이 대응하는 ring offset을 하나 보관한다.
- **소켓.** 0700 디렉터리의 Unix socket. 엔진과 같은 5바이트 프레임(4바이트 길이 + 종류: 0 데이터, 1 JSON 제어,
  상한 1 MiB). 세션마다 token. 제어: `hello`(host 버전, 세션 id, claude pid, 상태), `resize`, `signal`, `kill`, `exit`,
  `checkpoint.put/get`, `ring.read(fromOffset)`.
- **수명.** 스스로 세션을 끝내지 않는다. 엔진의 "부모가 없고 클라이언트가 없으면 60초 뒤 kill" 규칙은 두지 않는다.
  claude가 끝나면 종료 상태와 마지막 화면을 일정 시간 남겨 두었다가 정리한다.
- **구현.** 정적 native binary. Go가 유력하다(claude-ssh와 같은 선택, PTY와 process group을 다루기 쉽다).

### 3.2 holder manager (사용자당 하나, 언제든 바꿀 수 있는 것)

- **roster와 재입양.** host마다 pid, 프로세스 시작 시각, 소켓, 세션 id, 종류, token을 기록한다. 시작할 때 roster를 읽어
  pid와 시작 시각을 확인하고 소켓에 `hello`를 물어 다시 잡는다(엔진 supervisor의 adoption pass와 같은 방식).
  manager가 재시작해도 세션과 붙어 있는 터미널은 영향을 받지 않는다(§3.3 직접 연결).
- **터미널 상태.** PTY 세션마다 headless 터미널 에뮬레이터(xterm.js headless + serialize addon)를 두고 host의 출력을
  따라 먹인다. 화면, scrollback(예: 10,000줄), DEC 모드, 제목, 커서를 안다.
  - 새 클라이언트(사람의 재접속, 웹 창)에는 직렬화한 상태를 보낸 뒤 live 바이트를 잇는다. 같은 크기 SIGWINCH가
    다시 그리지 않는 문제, 첫 클라이언트가 이미 칠해진 화면을 놓치는 문제, scrollback 손실이 함께 풀린다(spike B1).
  - 일정 바이트(예: 1 MiB)마다 직렬화한 상태를 host의 checkpoint 칸에 맡긴다. manager가 재시작하면 checkpoint를 읽고
    그 뒤의 ring을 다시 먹여 상태를 정확히 되살린다. checkpoint 간격을 ring 용량보다 작게 두면 늘 맞는다.
  - 웹 터미널도 xterm.js이므로 같은 parser가 같은 상태를 만든다. VS Code의 persistent terminal(pty host +
    xterm headless + serialize)이 쓰는 방식이다.
  - 에뮬레이터가 Claude TUI의 출력을 충실히 재현하지 못하는 경우의 fallback은 모드 복원 + 폭 jiggle이다(모든
    클라이언트에 보인다).
- **입장과 lease.**
  - 클라이언트는 세 등급이다: **owner**(입력과 크기를 가진다), **observer**(보기만, 크기를 바꾸지 않는다),
    **macro**(잠깐 입력 lease를 빌린다).
  - 기본 owner는 세션을 연 사람의 터미널이다. 웹 터미널 창은 observer로 들어오고 "키보드 가져오기"로 owner가 된다.
    그때 사람의 터미널에는 bridge mod가 `$.ui.status`로 "키보드: 웹"을 띄운다. owner가 떠나면 남은 사람의 터미널로
    돌아간다.
  - 크기는 owner의 크기를 따른다. observer는 PTY 크기로 그리고 자기 화면에 맞춰 축소하거나 스크롤한다.
  - TUI의 터미널 질의(DA, 배경색 등)에는 owner의 터미널만 답한다. owner가 없을 때는 에뮬레이터가 표준 질의에 답한다.
- **API.** `spawn {kind, argv, cwd, env, size, termios}`, `list`, `attach {session, role}`, `kill`, `signal`, 상태 이벤트
  (`running | stopped | detached | ended`)를 낸다. 클라이언트는 wrapper, sminos 데몬, MAWS 데몬이다.
- **구현.** Node(에뮬레이터를 브라우저와 같은 xterm.js로 쓰기 위해). launchd·systemd unit으로 돈다.

### 3.3 claude wrapper (사람이 치는 `claude`)

- **설치.** PATH 앞쪽 디렉터리에 `claude` shim을 둔다. 진짜 binary는 Claude Code가 관리하는 경로에서 찾는다.
  Claude Code 업데이트가 shim을 덮어쓰지 않는 위치다.
- **우회 규칙.** 다음은 holder를 거치지 않고 진짜 `claude`를 그대로 exec한다.
  - `-p`/`--print`, `--output-format`·`--input-format` 같은 SDK·기계용 흐름, stdin이나 stdout이 TTY가 아닌 실행.
  - subcommand와 도구 명령: `--help`, `--version`, `mcp`, `plugin`, `auth`, `daemon`, `attach`, `agents`, `update` 등.
  - 엔진 자신의 모드: `--bg`, `--remote`, `--teleport`, `remote-control`.
  - holder에 닿지 못할 때(설치 안 됨, manager가 답하지 않음, 짧은 timeout). 사람의 작업을 막지 않는다.
- **interactive 경로.** manager에 `spawn`을 요청하고, 받은 host 소켓과 token으로 **host에 직접** 붙는다. 그래서
  manager가 죽어도 사람의 터미널은 끊기지 않는다. raw 모드, 바이트 그대로 전달, SIGWINCH마다 resize.
- **Ctrl+Z.** plain과 같게 한다. TUI가 멈추면(host가 `stopped` 이벤트를 보냄) wrapper도 스스로 SIGTSTP로 멈춰 셸이
  job을 돌려받는다. `fg`로 wrapper가 이어지면 host에 SIGCONT를 보내 claude를 잇는다.
- **끝.** `/exit`이면 claude의 종료 코드를 그대로 내고 끝난다. 터미널 창을 닫으면(wrapper가 SIGHUP을 받으면) 세션은
  detach되어 계속 돈다(§7 F1). 같은 디렉터리에서 다음에 `claude`를 치면 "이 디렉터리에 실행 중인 세션이 있다:
  이어 붙을까?"를 묻는다. 이름으로 붙는 명령은 `claude-holder attach <name>`이다(엔진의 `claude attach`와 겹치지 않게).

### 3.4 bridge mod (모든 claude 안, 구조화된 제어)

desk의 bridge mod를 그대로 쓴다. 스트림(행, `turn.step` 조각, 서브에이전트), steer, interrupt, 권한·질문 답,
model·effort 덮어쓰기, `$.command.run`으로 slash 명령. 추가는 둘이다.
- host가 env로 넘긴 holder 세션 id를 읽어 sminos 데몬이 PTY 채널과 구조화된 채널을 한 세션으로 묶게 한다.
- "키보드: 웹" 같은 상태를 TUI에 표시한다.

### 3.5 웹

- **세션 화면.** GUI(desk-web의 presentation, MAWS 렌더러 이식)가 기본이다. 옆에 터미널 창(xterm.js)을 연다.
  창은 observer로 들어오고 같은 세션의 진짜 TUI를 보여 준다.
- **capability 목록.** 세션마다 명령별로 `gui | terminal | none`을 낸다. PTY 종류에서 GUI인 것: 보내기, steer,
  interrupt, 권한·질문 답, model, effort, compact, clear, rename, branch, `/mcp enable|disable|reconnect`, `/plan`,
  `/config key=value`, `/background`. terminal인 것: rewind 지점 고르기, panel(`/usage`, `/permissions`, 인자 없는
  `/mcp`), 일반 dialog 대부분, plan 모드에서 나오기.
- **검증된 매크로.** 키 순서 + 화면 조건 + timeout 묶음. manager의 에뮬레이터가 화면 텍스트를 알기 때문에 결과를
  확인할 수 있다. 첫 대상은 권한 모드 순환(Shift+Tab을 원하는 모드가 footer에 보일 때까지, 최대 4번). 실행 전에
  최근 N ms 안에 owner가 입력했으면 하지 않는다. 실패하면 터미널 창을 열어 사람에게 넘긴다.
- **"full-control 모드로 이어 가기" 버튼.** §3.6.

### 3.6 SDK 경로와 "full-control 모드로 이어 가기"

- **pipe 종류 세션.** host가 pipe를 쥐고, MAWS 데몬의 Query가 쓰는 쪽 하나로 붙는다. 쓰는 쪽은 epoch로 막는다
  (새 Query가 붙으면 옛 Query의 쓰기는 거절). Query가 재시작하면 host의 seq부터 다시 읽고, CLI는 `initialize`를
  다시 받으면 대기 중인 권한·dialog 요청을 다시 보낸다(SSH 모드와 같은 의미). MAWS가 업데이트되어도 세션은 계속
  돈다. E10 supervisor가 지금 세션을 idle에서 끊는 문제가 여기서 풀린다.
- **이어 가기(PTY → pipe).** 같은 session id로 프로세스만 바꾼다. 웹 버튼을 누르면 다음과 같다.
  1. 데몬이 bridge mod에서 지금 도는 일을 받는다(백그라운드 셸, 서브에이전트, Monitor, MCP 작업).
  2. 일이 있으면 웹이 "일이 끝나면 넘기기(권장)"와 "지금 넘기기: 잃는 것 목록"을 보인다. 잃는 것은
     background-work-handoff의 표를 따른다: 셸은 죽고, Monitor·stdio MCP 작업은 잃고, 서브에이전트는 transcript에서만
     이어진다.
  3. 넘길 때가 되면 사람의 터미널에 "웹에서 full-control 모드로 넘어갔다"를 띄우고 TUI를 `/exit`으로 끝낸다.
     레지스트리 파일이 사라질 때까지 기다린다.
  4. holder가 같은 cwd·env로 pipe 종류 `claude -p --resume <id> …`를 띄운다. 첫 resume에
     `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`을 준다(돌던 턴이 있으면 다시 돈다). 권한 모드는 다시 넘긴다.
  5. Query가 붙고 웹은 같은 session id에서 launch epoch가 바뀐 것을 보고 snapshot을 받는다.
  6. 사람의 wrapper는 "웹에서 이어 가는 중. 돌려받으려면 Enter"를 보이고 기다린다.
- **돌려받기(pipe → PTY).** idle까지 기다려 pipe 세션을 끝내고, 같은 host 자리에 PTY 종류 `claude --resume <id>`를
  띄워 사람의 터미널에 붙인다.
- **새 세션.** MAWS 앱과 웹에서 연 세션은 처음부터 pipe 종류다. MAWS 데몬이 없는 기계에서는 웹이 PTY 종류로 연다.

## 4. 데이터 흐름

- **사람의 키 입력.** 터미널 → wrapper → host(한 홉, 같은 기계의 Unix socket) → PTY. manager는 경로에 없다.
- **웹 터미널 창.** 브라우저 ↔ hub ↔ sminos uplink ↔ manager(입장, 에뮬레이터 snapshot) → host(live 바이트).
  바이트 채널은 연구 문서 §4의 입력 의미론 첫째 갈래를 따른다(인증된 채널 안에서 offset으로 중복 제거).
- **구조화된 흐름.** claude 안의 bridge mod → bridge child → sminos 데몬 plane → hub → 웹. cursor는
  `(session, launch epoch, seq)`이고, launch epoch는 host 인스턴스와 같다.
- **SDK 흐름.** claude -p ↔ host(seq ring) ↔ MAWS 데몬 Query → X1 이벤트 → sminos 데몬 plane → hub → 웹.

## 5. 고장과 회복

| 일 | 결과 | 대응 |
|---|---|---|
| manager가 죽음 | 세션과 사람의 터미널은 그대로. 웹 창은 끊김 | launchd가 다시 띄우고 roster로 재입양. checkpoint + ring으로 에뮬레이터 복구. 웹 창은 다시 붙어 snapshot |
| host가 죽음 | claude가 SIGHUP으로 끝남(exit 129) | 세션을 ended로 표시. "이어 열기"가 새 host에서 `--resume`(+ 끊긴 턴 재개 변수). host를 작게 둔 이유 |
| claude가 죽음 | host가 종료 상태를 받음 | 마지막 화면을 남기고 ended. 웹과 다음 `claude`에서 resume 제안 |
| 기계 재부팅 | 모두 끝남 | 재부팅 전에 열려 있던 세션을 목록으로 제안 |
| holder 업데이트 | manager는 언제든 바꿈. host는 새 세션부터 새 binary | host `hello`에 버전. manager는 호환 범위의 host 프로토콜을 모두 말한다 |
| Claude Code 업데이트 | 도는 TUI는 그대로. 새 세션은 새 버전 | 따로 할 일 없음 |
| wrapper가 holder에 닿지 못함 | plain `claude`로 실행 | 사람의 작업을 막지 않는다 |
| 에뮬레이터 재현 실패 | 화면이 어긋남 | 모드 복원 + 폭 jiggle. 세션은 재시작하지 않음 |

## 6. 보안

- 소켓은 같은 uid, 0700 디렉터리, 세션마다 token(엔진 방식).
- 웹에서 오는 PTY 입력은 실행 등급이다. 연구 문서 §3.5대로 member principal의 채널 인증 위에서만 받고, owner
  lease를 얻는 것("키보드 가져오기")에 passkey step-up을 둔다. observer는 읽기 전용이 기본이다.
- 녹화는 꺼 둔다.

## 7. 열린 결정 (owner)

- **F1. 터미널 창을 닫으면?** 권고: 세션은 detach되어 계속 돈다. 다음 `claude`에서 이어 붙기를 묻는다. 원격에서
  이어 쓰는 것이 목적이므로. 대안: plain과 같이 끝낸다(원격 이어 쓰기는 사람이 명시적으로 detach했을 때만).
- **F2. 떠 있는 detach 세션의 수명.** Claude Code 프로세스 하나가 수백 MB를 쓴다(이 MacBook에서 24개 평균
  281 MB, 최대 549 MB RSS, 2026-10-22). 권고: 클라이언트가 없고,
  idle이고, 백그라운드 일이 없는 상태로 24시간이 지나면 끝낸다(transcript로 다시 열 수 있다). 시간은 설정.
  대안: 절대 스스로 끝내지 않는다.
- **F3. holder는 어느 제품에 속하는가.** 권고: 독립된 작은 서비스(MAWS 저장소의 workspace app)로 두고 sminos 데몬과
  MAWS 데몬이 둘 다 클라이언트가 된다. MAWS가 없는 Linux·devcloud 기계에도 설치된다. 대안: MAWS headless 데몬의
  일부(설치가 하나로 줄지만 MAWS 없는 기계에 MAWS 데몬을 깔아야 한다), sminos의 일부(Python이라 xterm.js 에뮬레이터를
  쓰지 못한다).

## 8. 검증 계획 (구현할 때)

1. 두 layout 모두에서, 사람이 붙어 있는 채로 웹 창을 붙였다 뗐을 때 사람의 화면이 바뀌지 않는다. 웹 창은 scrollback,
   모드, 제목까지 맞다.
2. 사람이 붙어 있는 채로 manager를 SIGKILL하면 사람에게 아무 변화가 없고, 다시 뜬 manager의 에뮬레이터 상태가
   이전과 같다.
3. Ctrl+Z / `fg`가 plain과 같다(멈춤 상태 `T+`, 이어짐, 같은 session id).
4. owner와 observer: observer는 크기와 입력을 바꾸지 않는다. lease 넘기기와 돌려받기.
5. wrapper 우회 표(§3.3)의 모든 줄. holder가 없을 때 plain으로 돈다.
6. 이어 가기: 일이 비었을 때와 일이 있을 때(잃는 것 목록이 실제와 같은가), 턴 도중, 돌려받기.
7. 모든 holder 세션에 bridge mod가 로드되고 PTY 채널과 같은 세션으로 묶인다.
8. 키 입력 지연: holder가 더하는 것은 같은 기계 한 홉이다. 2 ms 미만을 목표로 잰다.

## 9. 남은 미지수 (spike로 풀 것)

- **에뮬레이터 충실도.** xterm.js headless가 Claude TUI 두 layout의 출력(동기화 출력, OSC 8 링크, 확장 키 프로토콜,
  넓은 문자)을 사람의 터미널과 같게 재현하는가. snapshot을 보낸 화면과 원래 화면을 비교해 잰다.
- **터미널 질의.** Claude TUI가 실행 중에 보내는 질의의 목록과, owner가 없을 때 에뮬레이터가 답해야 하는 것.
- **IDE 연동과 이미지 붙여넣기.** VS Code·JetBrains 터미널에서 `/ide` 연결과 macOS 클립보드 이미지 붙여넣기가
  holder 아래에서도 되는가. spike에서 실행하지 못했다.
- **detach 동안의 사람 신호.** 터미널 창이 닫힐 때 wrapper가 받는 신호와 셸의 동작(SIGHUP, 셸 종료 순서).
- **Windows.** ConPTY와 process group 의미가 다르다. 범위 밖으로 둘지 정한다.

## 10. 조용히 정한 것

- host는 세션마다 하나(엔진 방식). 하나의 host가 여러 세션을 쥐면 host 하나의 고장이 모두를 끝낸다.
- host와 manager의 프레임은 엔진과 같은 5바이트 codec.
- 사람의 터미널은 manager가 아니라 host에 직접 붙는다.
- 에뮬레이터는 manager에, 그 상태의 checkpoint는 host에.
- Ctrl+Z는 plain과 같이 멈춤이다. detach 키는 따로 두지 않는다.
- 다시 그리기 실패로 세션을 재시작하지 않는다.
- 엔진 supervisor의 job 기능(dispatch, transcript 자동 respawn, spare, 예약 worker, 업그레이드 이주)은 가져오지 않는다.
- 녹화는 꺼 둔다.
- 경로 이동은 같은 session id로 한다(`--fork-session` 없음).
