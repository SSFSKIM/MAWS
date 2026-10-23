# 기계 쪽 세션 holder 설계 (터미널 세션을 holder가 쥐는 구조 + SDK 경로)

2026-10-22. 설계 문서다. 구현을 승인한 것이 아니다. MAWS #52의 연구 결과
[web-maws-remote-research.ko.md](web-maws-remote-research.ko.md)
§3.6–3.7 위에 선다.
2026-10-22 비판 검토 한 차례를 거쳐 식별자·인증·복구 계약과 정리·이동의 fence를 보강했다.
2026-10-23 웹 터미널 창을 설계에서 뺐다(F5, F6). 웹은 구조화된 제어만 하고, raw 프로세스 스트림은 기계를 떠나지 않는다.

사실의 근거는 다음 다섯 측정 노트다(PTY·명령·handoff·정리 신호는 Claude Code 2.1.307–2.1.308, bridge bench는 2.1.304다).
- [holder-tui-spike.md](holder-tui-spike.md): 우리 PTY 아래의 plain Claude, 엔진 PTY host 설계 발췌
- [background-work-handoff.md](background-work-handoff.md): 세션을 옮길 때 백그라운드 일
- [mod-command-run-probe.md](mod-command-run-probe.md): mod, `reply`, PTY 키로 slash 명령 돌리기
- [bridge-perf-bench.md](bridge-perf-bench.md): bridge 구간 지연
- [reap-signal-spike.md](reap-signal-spike.md): SIGTERM과 `/exit`의 마감 비교, 턴을 어디서 붙잡을 수 있는가

## 0. 무엇을 위한 것인가

- **장면.** 사람이 MacBook 터미널에서 `claude`로 일하다가 자리를 뜬다. 폰이나 다른 기계의 웹에서 같은 세션을 열어
  흐름을 보고, 말을 걸고, 권한에 답하고, 모델·모드를 바꾼다. 돌아와 터미널을 보면 아무것도 옮겨지지 않았고,
  백그라운드 셸·서브에이전트·Monitor·MCP 작업이 그대로 돌고 있다.
- **조건.**
  - 진행 중인 세션을 원격에서 그대로 이어 쓴다. 프로세스를 옮기지 않는다(백그라운드 일을 잃지 않는 유일한 길).
  - 제어 폭은 프로그램으로 되는 것 전부이고, 그것을 GUI로 준다. 키로만 되는 조작은 bridge가 보고하는 상태로 앞뒤를
    확인할 수 있는 것만 기계 쪽 매크로로 준다. 되감기 지점 고르기처럼 화면에서 고르는 조작은 "GUI 모드로 이어 가기"로
    다시 띄운 뒤 SDK 제어로 하거나 기계 앞에서 한다(F5, F6).
  - 터미널 사용감은 plain `claude`와 같아야 한다.
- **아니어야 하는 것.**
  - RC처럼 좁은 미러.
  - raw 프로세스 스트림(PTY 바이트, SDK stdio)을 기계 밖으로 내보내는 것(F5). 웹이 받는 것은 bridge 행과 X1 이벤트이고,
    보내는 것은 봉인된 명령이다.
  - 사람이 일하는 방식을 눈에 띄게 바꾸는 것. claude를 띄우기 전의 명시적 실패에만 plain `claude`로 돌아간다.
  - 다시 그리기에 실패했다고 멀쩡한 세션을 재시작하는 것(엔진 supervisor의 job 정책은 가져오지 않는다).
  - hub가 member 인증 없이 실행을 일으킬 수 있는 구조(연구 문서 §3.5와 이 문서 §6의 신뢰 결정을 따른다).

## 1. owner 결정 (2026-10-22)

1. 사람이 여는 터미널 세션은 처음부터 wrapper를 통해 holder 안에서 돈다.
2. PTY는 우리가 만든 holder가 쥔다(claude-ssh 방식). 엔진 supervisor(`runPtyHost`, `claude daemon`)는 참고만 한다.
3. 경로는 세션이 어디서 시작됐는지로 정한다. 터미널에서 시작한 세션은 TUI로 holder 안에, MAWS 앱이나 웹에서 시작한
   세션은 SDK 경로로 간다. 그리고 웹에 "GUI 모드로 이어 가기 (세션을 다시 띄움)" 버튼을 두어 터미널 세션을 SDK 경로로 넘긴다(이름은 F4).
4. 키로만 되는 조작은 원격에서 기계 쪽 매크로로 하되, bridge가 보고하는 상태로 앞뒤를 확인할 수 있는 것만 만든다.
   나머지는 "GUI 모드로 이어 가기" 뒤의 SDK 제어로 하거나 원격에서 하지 않는다(2026-10-23 개정, F6). 처음 결정은
   "웹의 터미널 창으로 한다"였다.
5. 사람이 터미널 창을 닫으면 세션은 detach되어 계속 돈다(F1).
6. detach된 세션은 클라이언트가 없고, 턴이 돌지 않고, 백그라운드 일과 예약된 cron이 없는 상태로 24시간이 지나면
   끝낸다. transcript로 다시 연다. 시간은 설정이다(F2, §3.2 정리).
7. holder는 독립된 작은 서비스다. MAWS 저장소의 workspace app으로 두고 wrapper, sminos 데몬, MAWS 데몬이 그
   클라이언트가 된다. MAWS가 없는 기계에도 따로 설치된다(F3).
8. 웹 터미널 창은 두지 않는다. 조작성은 좋지만 기존 sminos·MAWS 구조를 깨기 때문이다(F5, F6, 2026-10-23).

## 2. 구조

```
기계
  사람의 터미널                                   웹(브라우저)
     │ (raw tty)                                     ▲
  claude wrapper ─┐                                  │ hub (중계만)
     │ 시작·직결   │ 입장 요청                         │
     ▼            ▼                                  │
  session host ◀── holder manager ◀── sminos 데몬 ────┘  (uplink, 신뢰 경계, plane)
  (세션마다 하나:   (사용자당 하나: roster 재입양,  ▲
   PTY master 또는  lease·매크로 정책, 정리 정책,   │
   stdio pipe,      경로 이동)                        bridge mod (모든 claude 안)
   job-control,                                     │
   ring, fence)                                     │
     │                                              │
     ├── claude (TUI)                 ─────────────┘
     └── claude -p stream-json  ◀── MAWS 데몬의 Query (SDK 경로, 쓰는 쪽 하나)
```

세션 종류는 둘이고, holder 한 가족이 둘 다 쥔다.
- **PTY 종류**: plain `claude` TUI. 사람의 터미널만 붙는다. 웹은 bridge mod로 구조화된 제어를 하고, 키 입력은
  기계 쪽 매크로로만 넣는다.
- **pipe 종류**: `claude -p --input-format stream-json --output-format stream-json …`. MAWS 데몬의 Query가 붙는다.
  claude-ssh의 `process.spawn`과 같은 모양이다.

## 3. 구성 요소

### 3.1 session host (세션마다 하나, 작고 거의 바뀌지 않는 것)

host가 죽으면 세션이 죽는다(master가 닫히면 SIGHUP, exit 129; spike B2). 그래서 host는 가능한 한 작게 두고,
바뀌는 정책과 에뮬레이터는 manager로 보낸다. 수명·인증·fence의 집행은 host에 남긴다.

- **쥐는 것.** PTY master(PTY 종류) 또는 claude의 stdin·stdout pipe(pipe 종류). 사람이 쓰던 것과 같은 argv, cwd,
  env(셸의 env 전체, allowlist 아님), 크기, termios로 시작한다. `CLAUDE_CODE_SESSION_KIND`는 두지 않는다.
- **식별자.** `holderId`는 holder 자리의 안정된 id다. `processEpoch`는 claude 자식을 띄울 때마다 새로 만들고 그
  프로세스 동안 바꾸지 않는다. 같은 host 자리에서 다시 띄워도 새 값이다. `engineSessionId`는 현재 대화의 id이고,
  `bindingGeneration`은 채널 결합을 바꿀 때 증가시킨다. `hello`와 roster가 네 필드를 모두 싣는다.
  - `/clear`, `/branch`, resume는 프로세스를 바꾸지 않고 `engineSessionId`를 바꾼다
    ([branch·resume 측정](mod-command-run-probe.md#L40),
    [clear 측정](mod-command-run-probe.md#L50)).
  - id가 바뀌면 제어·transcript·PTY를 새 generation에 원자적으로 다시 묶는다. 옛 맥락의 명령과 lease는 무효화한다.
- **시작 (prepare/commit).** wrapper가 host를 띄운다. host가 소켓과 자기 roster 항목을 만들고 ready를 보낸다.
  wrapper의 commit을 받아야 claude를 fork한다. commit 전에 wrapper가 사라지면 자식을 띄우지 않고 끝난다.
  commit 뒤에는 plain으로 돌아가지 않고 같은 host에 붙거나 그 상태를 확인한다.
- **Linux 수명.** host는 user systemd의 transient scope 안에서 띄운다. `setsid`나 double fork만으로는
  `KillUserProcesses`가 적용되는 logind session cgroup을 벗어나지 못한다. 로그아웃 뒤에도 살려면 lingering도 필요하다.
- **job control.** host 안의 helper가 같은 session에 있고, claude는 별도 process group으로서 foreground(`tcsetpgrp`)가
  된다. 이렇게 해야 Ctrl+Z가 claude를 실제로 멈추고 SIGCONT로 이어진다(spike B5에서 확인한 고침).
- **ring.** 출력 바이트와 resize 이벤트를 종류가 있는 순서화된 기록으로 둔다. 절대 offset과 마지막 N MiB(예: 8 MiB)를
  보관한다. pipe 종류는 claude-ssh처럼 줄 단위 seq도 매긴다. stdin은 적용한 offset으로 중복을 제거한다.
- **checkpoint 칸.** manager가 맡긴 터미널 상태 직렬화(§3.2)와 대응하는 ring offset을 함께 보관한다. PTY 종류에서는
  정확한 이어 붙기(§3.2의 개선 항목)를 켤 때만 쓴다.
- **소켓과 인증.** 같은 uid의 0700 디렉터리에 Unix socket을 두고 경로의 소유권을 확인하며 symlink를 거절한다.
  5바이트 프레임(4바이트 길이 + 종류: 0 데이터, 1 JSON 제어)을 쓰되 엔진의 인증 의미론은 가져오지 않는다.
  - `hello`, ring 등 비공개 출력과 모든 제어보다 인증이 먼저다. 엔진은 인증 전에 hello·ring을 보내고 resize·kill을
    token gate 밖에서 처리한다([2.1.307 소켓 처리](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32598)–32636).
  - `owner-attach`, `observer-attach`, `manage` capability를 나눈다. host는 `data`, `resize`, `signal`, `kill`,
    `checkpoint.put` 등 모든 변경 프레임에서 역할·맥락·fence를 검사한다.
  - token은 fd나 pipe로 전달한다. argv, 로그, claude 자식의 env에는 넣지 않는다. 프레임(최대 1 MiB), checkpoint
    chunk와 전체 크기, 송수신 queue 증가에 상한을 둔다. 같은 uid의 코드는 신뢰 경계 안에 있다.
  - 제어는 `hello`(host 버전, 네 식별자, claude pid, 상태), `resize`, `signal`, `kill`, `exit`,
    `checkpoint.put/get`, `ring.read(fromOffset)`를 포함한다.
- **lease 기록.** host가 writer 신원, 단조 증가 fence, size owner, input-applied offset을 쥔다. manager가 정책을
  정하고 host가 compare-and-swap으로 적용한다. 옛 owner의 연결이 열려 있어도 지연된 변경 프레임은 거절한다.
  manager는 재입양할 때 이 기록을 읽고 초기화하지 않는다. 최초 owner는 prepare에서 원래 wrapper로 지정한다.
- **터미널 질의.** responder는 입력 owner와 별도로 지정한다. host는 그 responder에게만 질의를 전달하고,
  다른 클라이언트의 답과 snapshot 재생 중 생긴 답을 버린다.
  - 원래 터미널에서 관찰한 정적 capability 답(DA, XTVERSION 등)을 cache한다. 살아 있는 responder가 없으면 host가 답한다.
  - 동적 질의(커서 위치, 크기 보고, DECRQM 모드 보고, 키보드 프로토콜 flag)는 현재의 권위 있는 상태에서 답한다.
    크기는 host가 답한다. 커서와 모드는 에뮬레이터가 있을 때(정확한 이어 붙기를 켠 뒤)만 답한다. 그 전에는 붙은
    터미널이 없는 동안 답하지 않는다(§9).
- **수명.** 스스로 세션을 끝내는 정책은 없다. 엔진의 "부모가 없고 클라이언트가 없으면 60초 뒤 kill" 규칙은 두지 않는다.
  manager의 정리 의도는 host의 reap fence를 거쳐 집행한다(§3.2). claude가 끝나면 종료 상태와 마지막 화면을 일정 시간 남긴다.
  경로 이동이 기다리는 정확한 종료 확인은 host의 `waitpid`다.
- **구현.** 정적 native binary. Go가 유력하다(claude-ssh와 같은 선택, PTY와 process group을 다루기 쉽다).
  정확한 이어 붙기를 켤 때 §8의 복구 수락 시험을 통과하지 못하면 에뮬레이터를 host로 옮겨 host를 Node 프로세스로 만든다.

### 3.2 holder manager (사용자당 하나, 언제든 바꿀 수 있는 것)

- **roster와 재입양.** host가 쓴 roster에서 pid, 프로세스 시작 시각, 소켓, 네 식별자, 종류와 capability 참조를 읽는다.
  pid·시작 시각을 확인하고 인증한 소켓의 `hello`와 맞춰 다시 잡는다. manager는 터미널 세션의 시작 경로에 없고,
  올라와 있을 때 roster 디렉터리의 host들을 입양한다. 재시작해도 세션과 직접 붙은 터미널은 유지된다.
- **다시 붙을 때의 화면.** 웹 터미널 창이 없으므로(F5) 다시 붙는 클라이언트는 사람의 터미널뿐이다. 창을 닫았다가(F1)
  다른 터미널에서 이어 붙는 경우다.
  - 처음에는 degraded repaint로 시작한다. 모드 preamble을 다시 보내고 폭을 jiggle해 viewport를 다시 그리게 한다.
    측정에서 모드와 viewport는 맞았고, 제목과 그 전의 main-screen scrollback은 돌아오지 않았다
    ([측정](holder-tui-spike.md#L94)). 이것을 `degraded`로 알린다. plain
    `claude`였다면 창을 닫을 때 세션이 끝났다.
- **정확한 이어 붙기 (개선 항목, 처음에는 켜지 않는다).** PTY 세션마다 xterm headless에 host의 출력·resize 기록을
  순서대로 먹인다. 정확한 복구는 모든 터미널 출력에 대한 약속이 아니다. spike로 열거할 Claude TUI의 제한된 출력
  어휘와 아래 상태 집합에 대해 보장한다. §8의 1을 통과한 뒤에만 켠다.
  - 새 클라이언트에는 직렬화 상태를 보낸 뒤 그 offset 다음의 live 기록을 잇는다. 화면, bounded scrollback(예: 10,000줄),
    현재 커서·rendition, 모드와 제목을 복원한다. 같은 크기 SIGWINCH만으로 다시 그리지 않는 문제를 피한다(spike B1).
  - checkpoint 지점은 고정한 xterm parser 자신의 내부 상태로 고른다. ground state이고 UTF-8 decoder가 비었으며,
    `precedingJoinState`를 저장하고 DEC 2026 synchronized update 안이 아닐 때만 만든다. host에 별도 scanner를 두어
    두 parser가 경계에 합의하게 하지 않는다.
  - serializer는 addon-serialize의 확장 fork다. xterm headless, serializer, Unicode provider를 함께 버전 고정한다.
    기존 출력에 더해 다음을 저장한다.
    - 두 buffer 각각의 saved cursor(위치, rendition, charset)와 비활성 alternate buffer다.
    - title stack, scroll region, tab stop, G0–G3 charset, pending-wrap flag다.
    - mouse·focus·bracketed-paste·kitty-keyboard 모드다.
    - 열린 OSC 8 링크와 link registry, palette와 default color다.
    - cursor style·visibility·blink와 사용하는 버전들이다.
  - 일정 출력량(예: 1 MiB)마다 안전한 지점에서 checkpoint를 host에 맡긴다. 재시작 때 checkpoint와 그 뒤의 ring을
    적용한다. 간격을 ring보다 작게 잡는 것만으로 manager의 긴 중단까지 보장하지는 않는다.
  - manager가 없는 동안 ring이 넘쳐 gap이 생기면 명시적인 degraded 상태를 알린다. 복구는 모드 복원 + 폭 jiggle의
    눈에 보이는 repaint다. 모든 클라이언트에 보이며 scrollback 등 잃은 상태를 정확히 복원했다고 부르지 않는다.
  - 근거는 MAWS에 설치된 `@xterm/headless 6.0.0`·`addon-serialize 0.14.0`의 메모리 내 시험이다(비판 검토가 격리된
    HOME에서 실행했고 스크립트는 남기지 않았다. 구현 전에 §8의 시험으로 다시 잰다). `ESC[3` 뒤 checkpoint와
    `1mRED` suffix는 문자 그대로 `1mRED`로 복원됐고, checkpoint에 걸쳐 잘린 UTF-8 문자는 사라졌으며, saved cursor는
    잘못된 위치로 돌아갔다. addon은 셀과 일부 모드를 쓰지 parser·decoder 상태를 쓰지 않는다
    ([SerializeAddon.ts](/Users/new/Developer/GitHub/MAWS/node_modules/@xterm/addon-serialize/src/SerializeAddon.ts#L432)–532).
    VS Code는 serializer를 자주 교체하는 manager가 아니라 PTY와 같은 내구성의 pty-host 안에 둔다
    ([prior art](remote-dev-prior-art.md#L77)).
  - §8의 future-continuation 시험이 수락 기준이다. 통과하지 못하면 에뮬레이터를 host로 옮긴다. repaint를 정확성의
    대체 증거로 삼지 않는다.
- **입장과 lease.** 정책은 manager, 집행과 기록은 host(§3.1)에 둔다.
  - 클라이언트는 세 등급이다: **owner**(입력과 크기를 가진다), **observer**(보기만, 크기를 바꾸지 않는다),
    **macro**(배타적인 fenced transaction으로 잠깐 입력을 가진다).
  - 기본 owner는 세션을 연 사람의 터미널이다. 같은 기계의 다른 터미널에서 `claude-holder attach`로 붙으면 observer로
    들어오고, 명시적으로 넘겨받아야 owner가 된다. 크기는 owner를 따르고 observer는 그 크기로 그린다. 웹은 이 등급에
    들어오지 않는다(F5).
  - macro는 웹의 봉인된 명령으로 시작하고, 키 순서는 기계 쪽에 고정되어 있다. precondition과 결과는 bridge가 보고하는
    상태(permission mode, 턴이 도는지)로 확인하고 명시적 취소를 갖는다. owner가 N ms 조용했다는 사실은 실행 허가가
    아니다. macro가 겨냥한 UI를 바꾸는 구조화된 명령도 같은 중재에 참여한다. macro가 입력을 쥔 동안 사람의 터미널에는
    bridge mod가 `$.ui.status`로 "원격 매크로 실행 중"을 띄운다.
- **정리 (F2).** 클라이언트가 없고, 턴이 돌지 않고, 백그라운드 일과 cron이 없는 상태로 24시간(설정)이 지나면 끝낸다.
  manager의 시계는 다음이 모두 참인 동안만 간다.
  - PTY 클라이언트(owner, observer, macro)와 desk의 구독 화면이 없다.
  - 턴이 돌지 않고, 일 상태가 현재 맥락의 `verified-empty`다.
  - host의 실시간 descendant 검사에 일의 흔적이 없다.

  **일 상태.** `unknown | nonempty | verified-empty`를 `(processEpoch, engineSessionId, activity generation)`에 묶는다.
  - 최신 turn start 뒤에 발생한 Stop hook만 `verified-empty`의 근거가 된다. 그 Stop의 `background_tasks`와
    `session_crons`가 모두 명시적으로 비어 있어야 한다. 목록이 없으면 unknown이다
    ([Stop 입력](/Users/new/claude-code-bundle/2.1.307/modules/claude-code.d.ts-2706c2b1.txt#L12912)). cron도 일로 센다.
  - 사용자 interrupt나 API error에는 Stop이 없고, StopFailure에는 일 목록이 없다
    ([StopFailure 입력](/Users/new/claude-code-bundle/2.1.307/modules/claude-code.d.ts-2706c2b1.txt#L12895)). 그 경로는 unknown으로 남는다.
  - 모든 prompt origin의 turn start, background tool launch, bridge 재접속, id 변경은 verified-empty를 무효화한다.
    옛 generation의 빈 목록은 이를 되살리지 못한다. unknown은 절대 정리하지 않는다.
  - host가 claude의 descendant를 실시간으로 검사한다. pid로 등록한 기반 프로세스 외에는 모두 일로 세어 정리를 막는다.
    예외는 모든 bridged 세션의 bridge child와 MCP·LSP 서버다
    ([bridge child 측정](bridge-perf-bench.md#L60)). 자식이 있다는 것은 veto일 뿐,
    없다는 것은 일이 비었다는 증거가 아니다.

  조건 하나라도 깨지면 시계는 0이 된다. manager 재시작 때도 0부터 간다. 24시간 뒤에도 마지막 보고와 신호 사이의
  경쟁을 막기 위해 host가 다음 상태 기계를 집행한다.
  1. bridge mod를 통해 reap fence를 먼저 arm한다. arm 확인 전에는 신호를 보내지 않는다. bridge가 건강하지 않으면
     (heartbeat가 끊겼거나 `turn.step` hook이 걸려 있다는 자기 확인이 없으면) arm하지 않고 일 상태를 unknown으로 둔다.
  2. 문은 bridge의 `turn.step` hook이다. fence가 있는 동안 이 hook은 main-loop 모델 요청 직전에 `activity`를 host에
     보고하고 답을 기다린다. prompt hook은 문이 될 수 없다. `!` 셸 모드가 끝나며 시작한 턴과, arm 전에 queue에
     받아들여졌다가 나중에 꺼내진 prompt는 `prompt.submit`과 UserPromptSubmit을 모두 거치지 않는다. `turn.start`는
     관찰용이라 붙잡지 못한다(6초 hook 안에서 약 40 ms 뒤 모델 요청이 나갔다). `turn.step`은 3초를 붙잡고 두 경우를
     모두 모델 요청 전에 멈췄다([측정](reap-signal-spike.md)). `prompt.submit`은 출처와 이른 거절(사람의 초안을 되돌려 줌)에만 쓴다.
  3. host의 같은 상태 기계가 `reap cancelled`(`next`로 턴 진행) 또는 `already signalled`(종료 중)로 답한다. 후자의
     거절은 소비된 턴이 된다. prompt는 이미 transcript에 있고 거절이 assistant 답으로 남으므로, 그 답에 "holder가
     세션을 끝냈다, 다시 열면 이어진다"를 적는다.
  4. fence가 arm된 뒤 최신 일 상태·generation·클라이언트·descendant를 최종 확인하고 SIGTERM을 보낸다.
  5. 수 초 뒤에도 claude가 끝나지 않으면 SIGKILL로 올리지 않는다. 일 상태를 unknown으로 돌리고 세션을 살려 두며
     사건을 기록한다. `waitpid`로 실제 종료를 확인한 경우에만 asleep으로 기록한다.

  정리에 `/exit`을 쓰지 않는다. 열린 panel 뒤에서 명령이 오래 대기하다 뒤늦게 실행될 수 있고
  ([명령 queue 측정](mod-command-run-probe.md#L61)),
  [CommandRunArgs](/Users/new/claude-code-bundle/2.1.307/modules/claude-code.d.ts-2706c2b1.txt#L1813)에는 취소가 없다.
  SIGTERM은 측정에서 graceful했다(2.1.308). SessionEnd(reason `other`)가 돌고 터미널 모드가 복원되며, 직전까지의
  대화가 모두 저장되고 약 1초 안에 exit 143으로 끝났다. panel이나 확인 창이 열려 있어도 같았다([측정](reap-signal-spike.md)).
  다만 SIGTERM은 `/exit`이 백그라운드 일에 묻는 확인을 건너뛰고 등록된 셸을 죽인다. 그 확인이 안전망이 되지 않으므로
  잘못된 verified-empty를 막는 책임은 모두 일 상태 판정에 있다.

  `turn.step` 문은 실패하면 열린다. streaming chain이 요청 전에 실패하면 엔진은 그대로 모델로 간다
  ([2.1.307 L405905](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L405905)–405910). 그래서 1의 bridge 건강 조건이 fence의 일부다.
  남는 위험은 arm 확인과 신호 사이에 hook이 조용히 실패하고 턴이 시작되는 경우다. title·suggestion 같은 보조 요청은
  이 문 밖이지만 도구를 띄우지 않는다.

  asleep 기록은 engineSessionId, launch descriptor(argv, cwd, env), 끝난 시각을 보관한다. 다시 열 때 argv에서
  `-c/--continue`, `-r/--resume <x>`, `--session-id`와 그 값, `-p`, positional prompt를 제거한 뒤
  `--resume <engineSessionId>`를 넣는다. wrapper의 이어 붙기 질문과 웹 목록에서 다시 열 수 있다.
- **API.** `spawn {kind, argv, cwd, env, size, termios}`, `list`, `attach {holderId, processEpoch, bindingGeneration, role}`,
  `kill`, `signal`, 상태 이벤트(`running | stopped | detached | asleep | ended`)를 낸다. 복구 품질은 `exact | degraded`로
  따로 알린다. `asleep`은 정리 규칙이 끝낸 세션이다. wrapper의 최초 시작은 manager의 `spawn`에 의존하지 않는다.
- **구현 (F3).** 독립된 작은 서비스다. MAWS 저장소의 workspace app `apps/session-holder`로 `apps/desk-hub`,
  `apps/desk-web` 옆에 둔다. manager는 Node이고 host·wrapper도 같은 app에서 나온다. launchd·systemd unit으로 돈다.
  MAWS와 sminos는 클라이언트일 뿐이므로 MAWS가 없는 Linux·devcloud 기계에도 같은 서비스가 설치된다.

### 3.3 claude wrapper (사람이 치는 `claude`)

- **설치.** PATH 앞쪽 디렉터리에 `claude` shim을 둔다. Claude Code 업데이트가 shim을 덮어쓰지 않는 위치다.
  진짜 binary를 찾을 때 shim 자신의 디렉터리를 건너뛰고 env marker로 재진입을 막아 재귀 실행하지 않는다.
- **우회 규칙.** 다음은 holder를 거치지 않고 진짜 `claude`를 그대로 exec한다.
  - `-p`/`--print`, `--output-format`·`--input-format` 같은 SDK·기계용 흐름, stdin이나 stdout이 TTY가 아닌 실행.
  - subcommand와 도구 명령: `--help`, `--version`, `mcp`, `plugin`, `auth`, `daemon`, `attach`, `agents`, `update` 등.
  - 엔진 자신의 모드: `--bg`, `--remote`, `--teleport`, `remote-control`.
  - 명시적인 unmanaged 실행인 `CLAUDE_HOLDER=0`이다. claude flag를 새로 만들지 않는다.
- **interactive 경로.** wrapper가 double fork + `setsid`로 host를 직접 띄운다(Linux는 §3.1의 user scope 안이다).
  prepare/commit을 거쳐 받은 소켓과 fd/pipe의 capability로 host에 직접 붙는다. manager가 죽어도 시작과 기존 터미널
  연결은 유지된다. raw 모드, 바이트 그대로 전달, lease를 가진 동안 SIGWINCH마다 resize한다.
- **실패 경계.** host binary가 없거나 commit 전에 host가 실패했다는 명시적 pre-spawn 실패에만 plain으로 돌아간다.
  manager의 무응답이나 짧은 timeout은 우회 이유가 아니다. commit 뒤 wrapper·host가 죽거나 ack가 사라져도 같은
  holderId의 상태를 확인한다. 결과가 불명확하다고 두 번째 plain 프로세스를 띄우지 않는다.
- **Ctrl+Z.** plain과 같게 한다. TUI가 멈추면(host가 `stopped` 이벤트를 보냄) wrapper도 스스로 SIGTSTP로 멈춰 셸이
  job을 돌려받는다. `fg`로 wrapper가 이어지면 host에 SIGCONT를 보내 claude를 잇는다.
- **끝.** `/exit`이면 claude의 종료 코드를 그대로 내고 끝난다. 터미널 창을 닫으면(wrapper가 SIGHUP을 받으면) 세션은
  detach되어 계속 돈다(F1). 같은 디렉터리에서 다음에 `claude`를 치면 "이 디렉터리에 실행 중인 세션이 있다:
  이어 붙을까?"를 묻는다. 이름으로 붙는 명령은 `claude-holder attach <name>`이다(엔진의 `claude attach`와 겹치지 않게).
- **macOS TCC.** responsible process가 plain 때처럼 터미널 앱으로 남는다는 추론은 아직 검증하지 않았다(§9).

### 3.4 bridge mod (모든 claude 안, 구조화된 제어)

desk의 bridge mod를 쓴다. 스트림(행, `turn.step` 조각, 서브에이전트), steer, interrupt, 권한·질문 답,
model·effort 덮어쓰기, `$.command.run`으로 slash 명령을 다룬다. holder를 위한 연결은 다음과 같다.
- 비밀이 아닌 holderId·processEpoch와 현재 `$.session.id()`를 보고한다. id 변경 때 host·manager가 generation을 바꾸고
  sminos 데몬이 제어·transcript·PTY를 원자적으로 다시 묶는다. 인증 token은 claude env로 전달하지 않는다.
- turn start·Stop·background launch·재접속을 일 상태에 반영하고 reap fence의 `turn.step` 문을 집행한다.
- 구조화된 UI 변경을 macro 중재에 참여시키고, macro가 앞뒤를 확인하는 상태(permission mode, 턴 여부)를 보고하며,
  "원격 매크로 실행 중" 같은 상태를 TUI에 표시한다.

### 3.5 웹

- **세션 화면.** GUI(desk-web의 presentation, MAWS 렌더러 이식)만 있다. 웹 터미널 창은 두지 않는다(F5). 웹이 받는
  것은 bridge 행과 X1 이벤트이고, 보내는 것은 동작마다 봉인된 명령이다.
- **capability 목록.** 세션마다 명령별로 `gui | macro | none`을 낸다. PTY 종류에서 GUI인 것: 보내기, steer,
  interrupt, 권한·질문 답, model, effort, compact, clear, rename, branch, `/mcp enable|disable|reconnect`, `/plan`,
  `/config key=value`, `/background`. macro인 것: plan 모드에서 나오기. plan으로 바꾸기는 mod의 `/plan`으로 한다.
  none인 것: rewind 지점 고르기, panel(`/usage`, `/permissions`, 인자 없는 `/mcp`), 일반 dialog 대부분이다. none 옆에는
  "GUI 모드로 이어 가기"를 함께 보인다. pipe 종류에서는 SDK 제어 요청 96종과 dialog 37종을 GUI로 다룬다.
- **검증된 매크로.** 키 순서 + bridge 상태 조건 + timeout을 배타적인 fenced transaction으로 실행한다. 상태 precondition과
  결과를 확인하고 명시적으로 취소할 수 있다. 결과가 목표와 다르면 멈추고, bridge가 보고한 현재 상태와 함께 실패를 보인다.
  - Shift+Tab 순환은 턴이 없고 일이 verified-empty인 경계에서만 허용한다. 그 밖에는 이유와 함께 비활성화한다.
  - bridge가 보고하는 permission mode가 목표가 될 때까지 최대 4번 누른다. 측정된 순환은
    manual → accept edits → plan을 거친다
    ([키 측정](mod-command-run-probe.md#L96)). 도는 tool이 있을 때 이 경로로
    plan에 가면 잠깐 accept edits를 켜므로, 직접 `/plan`으로 가는 것과 같지 않다.
- **이어 가기 버튼.** "GUI 모드로 이어 가기 (세션을 다시 띄움)"(F4). §3.6의 프로세스 재시작이다.

### 3.6 SDK 경로와 이어 가기

- **pipe 종류 세션.** host가 pipe를 쥐고 MAWS 데몬의 Query가 쓰는 쪽 하나로 붙는다. host의 writer fence로 옛 Query의
  쓰기를 거절한다. Query 재시작은 claude 프로세스 재시작과 다르며 processEpoch를 바꾸지 않는다.
- **Query의 자리.** Query는 브라우저가 아니라 기계의 MAWS 데몬에 둔다. Desktop SSH 모드에서 Desktop 앱이 하던 역할을
  같은 기계의 MAWS 데몬이 맡고, 브라우저는 그 바깥의 클라이언트다. claude.ai는 브라우저가 Query를 직접 돌리지만
  ([claude.ai 클라이언트](claude-ai-rc-client-protocol.md#L33)) 우리는 그렇게 하지 않는다.
  아래의 MAWS 소유 일(in-process MCP, hook callback)이 Query와 같은 프로세스에 산다. Query는 엔진의 질문에 답하는
  쓰는 쪽 하나라 잠드는 탭에 둘 수 없다. hub는 믿지 않는 중계라 SDK stdio를 통째로 지나게 하지 않는다(F5).
- **살아남는 일의 경계.** CLI가 소유한 일은 MAWS 데몬 재시작을 견딘다. MAWS가 소유한 일은 그대로 살아남지 않는다.
  - in-process MCP tool call은 MAWS의 메모리에 있다
    ([server.ts의 calls](/Users/new/Developer/GitHub/MAWS/src/engine-host/tool-server/server.ts#L77),
    [dispatch와 완료](/Users/new/Developer/GitHub/MAWS/src/engine-host/tool-server/server.ts#L164)–187).
  - SDK hook callback은 re-initialize 때 엔진이 retire한다
    ([2.1.307 재초기화](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L938674)–938690).
  - tool의 효과를 dispatch하기 전에 durable in-flight request ledger를 쓴다. 계획된 재시작은 timeout을 두고 drain하며
    아래와 같은 중단 정책을 따른다. timeout만으로 강제 중단을 허용하지 않는다.
  - 갑작스러운 재시작 뒤 orphan request에는 "결과 불명; 이미 완료됐을 수 있다"고 답한다. 보통의 재시도 가능한 오류로
    돌려 side effect를 중복 실행하게 하지 않는다.
- **Query 재입양.** claude-ssh의 전송·adoption 계약을 가져온다
  ([출력 checkpoint·stdin offset](desktop-ssh-helper-protocol.md#L183)–225,
  [대기 요청·gap 복구](desktop-ssh-helper-protocol.md#L299)–346).
  - 매 input write 전에 output checkpoint를 영속 commit하고, 새 Query의 stdin offset은 host의 `stdinApplied`로 rebase한다.
  - checkpoint는 JSONL 줄 경계에 둔다. replay는 exact/gap으로 분류하고, gap이면 줄 경계를 다시 맞춘다.
  - `initialize`의 대기 권한·dialog 재전달과 replay는 request id로 중복 제거한다. gap에서는 transcript를 다시 읽어 reseed한다.
  - 8 MiB ring은 durable Query checkpoint가 아니다. 링만 남아 있다고 Query의 소비 위치와 응답 이력이 복원되지는 않는다.
- **경로 이동 (PTY ↔ pipe).** 양방향 모두 같은 engineSessionId로 프로세스를 바꾸는 상태 기계다. 세션의 배타 lock과
  fence를 가지고 `requested → draining(취소 가능) → verified quiescent → 옛 프로세스의 waitpid 종료 확인 → 새 프로세스
  spawn → bound`로 간다. 실패 상태도 기록하고 이어서 복구한다. 옛 프로세스의 종료를 확인하기 전에는 새 것을 띄우지 않는다.
  - 일 상태에는 unknown과 foreground 효과도 포함한다. 기본은 quiescence를 확인한 뒤 이동한다. pipe → PTY 돌려받기도
    단지 idle을 기다리는 것으로 끝내지 않는다. drain 중 새 활동이 있으면 검증을 무효화하고 fence로 마지막 경쟁을 막는다.
  - "지금 넘기기"는 명시적인 파괴적 override다. 멈출 셸·서브에이전트·Monitor·MCP 작업과 foreground 효과, 결과 불명을
    보여 주고 경고한다. 중단된 턴 재개는 foreground 명령까지 포함한 프롬프트 전체를 다시 실행한다
    ([재실행 측정](background-work-handoff.md#L144)–150).
    `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`은 자동으로 켜지 않는다.
  - launch descriptor의 argv(system-prompt flag, tool 선택, MCP config, plugin dir), cwd, env를 보존한다. resume·종류
    flag와 positional prompt는 §3.2처럼 정규화하고 새 종류에 맞게 넣는다. bridge가 읽을 수 있는 세션별 model, effort,
    permission mode, MCP disabled set, add-dir는 다시 적용한다. 옮길 수 없는 것은 사람에게 잃는 목록으로 보여 준다.
  - 새 자식에는 새 processEpoch를 주고 제어·transcript·PTY를 새 bindingGeneration에 묶는다. 웹은 snapshot을 받는다.
    PTY → pipe 뒤 wrapper는 "웹의 GUI 모드에서 이어 가는 중. 돌려받으려면 Enter"를 보이고 기다린다.
- **새 세션.** MAWS 앱과 웹에서 연 세션은 처음부터 pipe 종류다. MAWS 데몬이 없는 기계에서는 웹이 PTY 종류로 연다.

## 4. 데이터 흐름

- **사람의 키 입력.** 터미널 → wrapper → host(인증·역할·fence·offset 검사) → PTY다. manager는 이 한 홉 경로에 없다.
- **매크로.** 웹의 봉인된 명령 → hub → sminos 데몬(봉인 검증) → manager(정책, fence) → host(macro lease로 PTY 입력)다.
  웹에서 PTY로 가는 바이트 경로는 없다(F5).
- **구조화된 흐름.** claude 안의 bridge mod → bridge child → sminos 데몬 plane → hub → 웹이다. cursor의 맥락은
  `(holderId, processEpoch, engineSessionId, bindingGeneration)`이고 그 안에 seq를 둔다. host 자리와 processEpoch를
  같게 보지 않는다. id 변경은 세 채널에 함께 반영한다.
- **SDK 흐름.** claude -p ↔ host(seq ring) ↔ MAWS 데몬 Query → X1 이벤트 → sminos 데몬 plane → hub → 웹이다.

## 5. 고장과 회복

| 일 | 결과 | 대응 |
|---|---|---|
| manager가 죽음 | 세션·직접 연결·lease 기록은 host에 남음. 진행 중인 매크로는 취소됨 | roster로 재입양하고 기존 fence를 읽음. 매크로는 다시 실행하지 않음 |
| host가 죽음 | PTY 종류 claude는 SIGHUP으로 끝남(exit 129) | ended로 표시하고 새 host의 resume 제안. 끊긴 턴 재개 변수는 자동 설정하지 않음 |
| claude가 죽음 | host의 waitpid가 종료를 확인함 | 마지막 화면을 남기고 ended. 웹과 다음 `claude`에서 resume 제안 |
| 기계 재부팅 | 모두 끝남 | 재부팅 전에 열려 있던 세션을 목록으로 제안 |
| holder 업데이트 | manager는 언제든 바꿈. host는 새 세션부터 새 binary | hello의 버전을 확인하고 호환되는 프로토콜로 재입양 |
| Claude Code 업데이트 | 도는 TUI는 그대로. 새 세션은 새 버전 | 매크로의 키 순서·상태 보고와 `turn.step` 문을 다시 잼 |
| commit 전 host 시작 실패 | claude는 아직 없음 | binary 없음·명시적 실패에만 plain 실행 |
| commit 뒤 wrapper·host crash 또는 ack 유실 | 같은 host에 commit된 실행의 생존 여부를 확인해야 함 | roster·hello·종료 상태로 reconcile. timeout으로 plain을 중복 실행하지 않음 |
| 다시 붙은 터미널의 화면이 어긋남 | degraded repaint는 모드와 viewport만 되살림 | degraded를 알리고 다시 repaint. 세션은 재시작하지 않음 |
| 매크로가 목표 상태에 닿지 못함 | 키 일부만 적용됐을 수 있음 | 멈추고 bridge가 보고한 현재 상태를 보임. 자동 재시도 없음 |
| MAWS 데몬이 죽음 | CLI 일은 유지되지만 MAWS의 in-flight call은 잃음 | Query 재입양과 ledger 복구. orphan은 결과 불명으로 답함 |
| 정리 SIGTERM 뒤에도 살아 있음 | 종료 확인 없음 | SIGKILL 없이 unknown으로 돌리고 기록. 세션 유지 |

## 6. 보안

- 로컬 경계는 같은 uid다. 그 uid의 코드는 신뢰한다. 소켓의 소유권·symlink를 검사하고 0700 디렉터리를 쓴다.
- private hello·ring·checkpoint 출력과 제어 전에 인증한다. owner-attach·observer-attach·manage를 분리하고 모든
  변경 프레임에 역할·맥락·fence를 적용한다. token은 fd/pipe로만 전달하며 argv·로그·claude env에 넣지 않는다.
  프레임·checkpoint chunk·전체 크기·queue를 제한한다. codec을 빌려도 엔진의 인증 구멍을 빌리지 않는다.
- 웹은 PTY 바이트를 보내지 않는다(F5). 웹이 일으키는 PTY 입력은 매크로뿐이다. 매크로는 이름과 인자가 정해진
  봉인된 명령으로만 시작하고, 키 순서는 기계 쪽에 고정되어 있어 hub가 바꿀 수 없다. 명령은 principal, session,
  processEpoch, bindingGeneration에 묶이고 재결합 뒤 옛 명령은 거절된다.
- hub를 믿지 않는다면 명령 서명만으로는 부족하다. 조작된 GUI 표시를 보고 사람이 승인할 수 있으므로 표시 무결성도
  [연구 문서의 열린 신뢰 결정](web-maws-remote-research.ko.md#L259)에 포함한다.
  hub가 내려주는 JS 자체의 신뢰 한계도 남는다. 이를 정하지 않고 원격 승인을 안전하다고 부르지 않는다.
- 녹화는 꺼 둔다. 보존하는 launch descriptor의 env도 비밀 데이터로 다루고 출력·로그에 노출하지 않는다.

## 7. owner가 정한 갈림길 (2026-10-22)

F1–F5는 정해졌다(§1의 3, 5–8). F6이 열려 있다.

- **F1. 사람이 터미널 창을 닫으면?** 정함: detach되어 계속 돈다. 다음 `claude`에서 이어 붙기를 묻는다. 원격에서 이어
  쓰는 것이 목적이기 때문이다. 버린 대안: plain과 같이 끝내고, 원격 이어 쓰기는 사람이 명시적으로 detach했을
  때만 한다.
- **F2. detach된 세션의 수명.** Claude Code 프로세스 하나가 수백 MB를 쓴다(이 MacBook에서 24개 평균 281 MB, 최대
  549 MB RSS, 2026-10-22). 정함: 클라이언트가 없고, 턴이 돌지 않고, 백그라운드 일과 cron이 없는 상태로 24시간이 지나면
  끝낸다(§3.2 정리). transcript로 다시 연다. 시간은 설정이다. 버린 대안: 절대 스스로 끝내지 않는다.
- **F3. holder는 어느 제품에 속하는가.** 정함: 독립된 작은 서비스(MAWS 저장소의 workspace app)로 두고 sminos
  데몬과 MAWS 데몬이 둘 다 클라이언트가 된다(§3.2 구현). 버린 대안: MAWS headless 데몬의 일부(설치가 하나로
  줄지만 MAWS 없는 기계에 MAWS 데몬을 깔아야 한다), sminos의 일부(Python이라 xterm.js 에뮬레이터를 쓰지 못한다).
  (2026-10-23, F6 뒤: sminos 안에 두는 안을 버린 이유였던 xterm.js 에뮬레이터는 개선 항목으로 내려갔다. 그래도 독립
  서비스로 둔다. MAWS 앱의 SDK 세션이 프로세스를 쥐는 일로 sminos 데몬에 기대지 않게 하기 위해서다.)
- **F4. 이어 가기 버튼의 이름.** 정함: "GUI 모드로 이어 가기 (세션을 다시 띄움)". 버린 대안: 처음 이름인 "full-control 모드로
  이어 가기". TUI + 터미널 창도 이미 전체 제어를 주므로 "full-control 모드로 이어 가기"는 오해를 부를 수 있다. SDK 경로가 더하는 것은
  다시 띄운 프로세스에서의 GUI-native 제어다. 이름이 그 대가(프로세스 재시작)를 드러낸다. (F6 뒤에는 이 버튼이 화면에서
  고르는 조작, 예를 들어 되감기의 원격 경로이기도 하다.)
- **F5. 웹 터미널 창 (2026-10-23).** 정함: 조작성은 좋지만 비선호다. 기존 sminos·MAWS 구조를 깨기 때문이다. 설계에서는
  뺐다(F6).
  - **sminos·desk.** hub를 지나는 것은 동작마다 봉인되는 명령과 seq가 붙은 구조화된 행이다. 웹 터미널 창은 실행
    등급의 raw 키 바이트를 hub로 보낸다. 그래서 자기 offset·lease·snapshot 프로토콜, passkey step-up, 화면 무결성
    문제(§6)를 따로 데려온다.
  - **MAWS.** GUI는 X1 이벤트로 상태를 그린다. 창에서 누른 키는 그 모델에 보이지 않고 결과로만 드러난다. 한 세션에
    제어면이 둘이 되어 macro fence나 "키보드: 웹" 표시 같은 중재가 필요해진다.
  - **같은 원칙.** raw 프로세스 스트림은 기계를 떠나지 않는다. PTY 바이트도, SDK stdio도 마찬가지다. 그래서 Query는
    claude.ai처럼 브라우저에 두지 않고 기계의 MAWS 데몬에 둔다(§3.6). 웹이 받는 것은 X1 이벤트와 bridge 행이고,
    보내는 것은 봉인된 명령이다.
- **F6. F5를 설계에 어떻게 반영하는가 (2026-10-23).** 정함: 웹 터미널 창을 설계에서 뺀다.
  - 키로만 되는 조작은 bridge가 보고하는 상태로 앞뒤를 확인할 수 있는 기계 쪽 매크로로 한다(plan 모드에서 나오기).
    rewind 지점 고르기, panel, 일반 dialog 대부분은 "GUI 모드로 이어 가기" 뒤에 하거나 원격에서 하지 않는다(§3.5).
  - PTY holder는 남는다. 사람이 터미널 창을 닫아도 세션이 남고(F1), 다시 붙을 수 있고, 이어 가기를 전환한다.
  - 에뮬레이터와 정확한 화면 복구는 전제 조건에서 개선 항목으로 내려갔다(§3.2). 다시 붙을 때는 degraded repaint로 시작한다.
  - 버린 대안: 마지막 수단으로 남기기(명시적으로 켜는 창이고 터미널 장치가 모두 남는다), PTY holder까지 빼기(터미널
    세션은 오늘의 desk처럼 bridge mod로만 제어되고 창을 닫으면 끝난다).

## 8. 검증 계획 (구현할 때)

1. **future-continuation 수락 시험 (정확한 이어 붙기를 켤 때).** Claude TUI의 열거된 출력 어휘에서 모든 출력 바이트·resize offset마다 중단을 걸고,
   그 지점까지의 유효 checkpoint + ring으로 복원한다. 동일한 suffix와 terminal query를 먹인 뒤 미래의 상태·출력·응답을
   비교한다. chunk 경계에 걸친 Unicode, saved cursor, 두 buffer, 링크·색·모드·DEC 2026을 포함한다. 화면 사진만 맞추는
   시험은 아니다. 통과하지 못하면 에뮬레이터를 host로 옮긴다.
2. 두 layout 모두에서 사람이 터미널 창을 닫았다가 다른 터미널에서 이어 붙으면 모드가 복원되고 viewport가 다시 그려지며
   `degraded`가 알려진다. 두 번째 터미널이 observer로 붙었다 떨어져도 owner의 화면은 바뀌지 않는다.
3. manager를 SIGKILL해도 사람의 직접 연결과 host의 lease·fence·input offset은 유지된다. 다시 뜬 manager가 이를
   초기화하지 않는다. 진행 중이던 매크로는 취소되고 다시 실행되지 않는다.
4. Ctrl+Z / `fg`가 plain과 같다(멈춤 상태 `T+`, 이어짐, 같은 processEpoch·engineSessionId).
5. owner·observer·macro의 역할을 검사한다. observer는 resize·입력을 못 하고, owner 교체 전 연결에서 늦게 온 프레임은
   거절된다. macro의 bridge 상태 precondition·결과 확인·취소와 구조화된 UI 명령의 경쟁도 검사한다. 웹에서 PTY로 가는
   바이트 경로가 없다는 것도 확인한다.
6. 정적·동적 query 답을 구분한다. responder 외 답과 replay 중 답은 버린다. responder가 없으면 static cache를 쓰고,
   크기는 host가 답하며, 에뮬레이터가 없는 동안 커서·모드 질의에는 답하지 않는다.
7. wrapper 우회 표와 `CLAUDE_HOLDER=0`, binary 탐색의 재귀 방지를 검사한다. prepare 뒤 commit 전 wrapper 종료는
   자식을 만들지 않는다. commit 직후 wrapper·host crash와 ack 유실은 plain 이중 spawn을 만들지 않는다.
8. `/clear`, `/branch`, resume가 processEpoch는 유지하면서 engineSessionId와 bindingGeneration을 바꾼다. 제어·transcript·PTY는
   함께 다시 묶이고 옛 명령·lease·grant는 거절된다. 모든 holder 세션에서 bridge mod가 이 결합을 보고한다.
9. 양방향 이동은 empty·nonempty·unknown·foreground 효과와 턴 도중 override를 시험한다. waitpid 전 새 프로세스가
   없고, 실패 상태에서 다시 진행할 수 있다. launch descriptor·세션 override·잃는 목록과 실제 결과를 비교한다.
10. Query 재입양은 input 전 checkpoint commit, stdinApplied rebase, 줄 경계, pending request 중복 제거, gap reseed를
    검사한다. MAWS 재시작 중 tool 효과가 이미 실행됐어도 orphan 응답이 보통의 재시도를 유도하지 않는다.
11. **reap-fence 경쟁.** 마지막 빈 Stop 뒤 턴 B가 background 일을 시작하고 interrupt되는 경우는 unknown으로 남는다.
    fence arm 직전·직후·최종 검사와 SIGTERM 사이에 모든 origin의 턴 시도를 넣는다. `!` 셸 모드 완료, arm 전에
    queue에 들어간 prompt, 같은 mod가 넣은 prompt를 포함한다. 취소 후 진행 또는 신호 후 거절 중 하나만 일어나는지
    본다. `turn.step` hook이 실패하거나 bridge가 끊기면 arm하지 않는지도 본다. 클라이언트·구독·턴·셸·Monitor·cron·미등록 descendant 중 하나만 남아도 끝내지 않는다.
    bridge child·등록 MCP·LSP만으로 영원히 막히지는 않는다. 모두 비었을 때 시험용 시간 뒤 SIGTERM과 waitpid로 asleep이
    되고, 재개 argv가 정규화된다. SIGTERM에 응답하지 않으면 SIGKILL 없이 unknown으로 돌아간다.
12. 인증 전 hello·ring 유출, observer의 변경, 옛 fence, symlink 소켓, 큰 프레임·checkpoint·queue를 거절한다.
13. 키 입력 지연은 같은 기계 한 홉이 더해지는 비용을 재고 2 ms 미만을 목표로 한다.

## 9. 남은 미지수 (spike로 풀 것)

- **TUI 출력 어휘와 복구 (개선 항목, F6 뒤로는 전제 조건이 아니다).** 정확한 이어 붙기를 켤 때 푼다. Claude TUI 두
  layout의 출력·질의를 열거한다. 동기화 출력, OSC 8, 키보드 프로토콜, 넓은 문자·결합 문자와 resize를 포함해 §3.2의
  bounded contract와 §8의 미래 동작 비교를 검증한다.
- **붙은 터미널이 없을 때의 동적 질의.** detach된 동안 Claude TUI가 커서 위치나 모드를 물으면 host는 답하지 않는다.
  그래도 TUI가 멈추거나 화면이 틀어지지 않는가.
- **매크로의 상태 보고.** bridge가 permission mode의 변화를 바로 보고하는가. 매크로의 앞뒤 확인이 여기에 기댄다.
- **정리 신호와 문 (2026-10-22 일부 해결, [reap-signal-spike.md](reap-signal-spike.md)).** SIGTERM은 graceful하고, `turn.step`이
  main-loop 모델 요청을 붙잡는 문이 된다는 것을 2.1.308에서 쟀다. 남은 것은 셋이다.
  - SDK, Remote Control, peer, channel origin은 같은 경로를 쓴다는 것을 코드로만 읽었다.
  - `turn.step` hook의 조용한 실패를 bridge 건강 조건이 얼마나 덮는가.
  - Claude Code가 업데이트될 때마다 두 결과가 그대로인가. 버전마다 다시 잰다.
- **macOS TCC.** double fork·setsid와 host 아래에서도 responsible process가 원래 터미널 앱으로 남는가.
- **Linux scope와 lingering.** user transient scope가 logind session cgroup과 분리되고, KillUserProcesses와 로그아웃에서
  의도대로 살아남는가. lingering이 없는 경우의 설치·표시 동작을 확인한다.
- **IDE 연동과 이미지 붙여넣기.** VS Code·JetBrains 터미널에서 `/ide` 연결과 macOS 클립보드 이미지 붙여넣기가
  holder 아래에서도 되는가. spike에서 실행하지 못했다.
- **detach 동안의 사람 신호.** 터미널 창이 닫힐 때 wrapper가 받는 신호와 셸의 동작(SIGHUP, 셸 종료 순서).
- **Windows.** ConPTY와 process group 의미가 다르다. 범위 밖으로 둘지 정한다.

## 10. 조용히 정한 것

- host는 세션마다 하나다. 하나의 host가 여러 세션을 쥐면 host 하나의 고장이 모두를 끝낸다.
- host와 manager의 프레임은 5바이트 codec이지만 인증은 모든 private 출력·제어보다 먼저다. 역할과 fence를 매번 검사한다.
- wrapper가 prepare/commit으로 host를 직접 시작한다. manager는 roster에서 입양하고 사람의 터미널은 host에 직접 붙는다.
- commit 뒤에는 plain fallback이 없다. Linux는 user scope와 lingering으로 로그아웃 수명을 다룬다.
- holderId, processEpoch, engineSessionId, bindingGeneration을 구분한다. host 자리와 프로세스·대화 id를 같게 보지 않는다.
- lease와 적용 offset은 host에 남고 정책은 manager에 둔다. macro는 quiet-time 추측이 아니라 배타 fenced transaction이다.
- 다시 붙을 때는 모드 복원과 폭 jiggle의 degraded repaint로 시작한다. 정확한 이어 붙기(에뮬레이터는 manager, 안전한
  parser 경계의 확장 checkpoint는 host)는 수락 시험을 통과한 뒤 켜는 개선이다. 통과하지 못하면 에뮬레이터를 Node host로 옮긴다.
- gap은 알림을 동반한 degraded다. 다시 그리기 실패로 세션을 재시작하지 않는다.
- 입력 owner와 query responder는 별개다. static capability는 cache하고 dynamic state를 cache 답으로 대신하지 않는다.
- Ctrl+Z는 plain과 같이 멈춤이다. detach 키는 따로 두지 않는다. 녹화는 꺼 둔다.
- 정리 시계는 웹 구독자도 클라이언트로 센다. 잊힌 탭이 세션을 붙잡을 수 있으므로 웹 목록에 떠 있은 시간과 RSS를 보인다.
- 정리 시계는 manager 메모리에만 둔다. 재시작하면 0부터 간다. unknown은 정리하지 않고 descendant는 positive veto로만 쓴다.
- 정리는 `turn.step` 문의 reap fence 뒤 SIGTERM과 waitpid로 끝낸다. SIGKILL escalation과 취소 불가능한 `/exit` 예약은 없다.
- 경로 이동은 같은 engineSessionId로 한다(`--fork-session` 없음). 양방향 모두 배타 lock·fence·quiescence·waitpid가 필요하다.
  중단된 턴 재실행은 자동으로 켜지 않는다. launch descriptor와 가능한 세션 override를 보존한다.
- MAWS 소유의 in-flight 일은 CLI 생존과 별개다. 효과 전 durable ledger와 결과 불명 응답으로 중복 효과를 막는다.
- 이름은 workspace app `apps/session-holder`, 사람이 치는 명령 `claude-holder`다. 웹의 이어 가기 버튼은 "GUI 모드로 이어 가기"다(F4).
- 설치는 MAWS 앱이 있는 Mac에서는 MAWS가 함께 하고, 그 밖에는 플랫폼별 release 묶음(manager, host, wrapper)을 따로 깐다.

## 11. 검토하고 버린 대안

- **tmux의 private one-session server.** native attach는 모든 클라이언트를 tmux로 다시 그리므로 사람의 터미널이 Claude의
  바이트를 직접 받지 않는다. TERM·TMUX도 바뀌어 자식의 터미널 계약이 달라진다. control mode는 raw pane 출력을 주지만
  snapshot은 capture-pane에 기대며 serialize와 비슷한 누락이 있고, 자식의 터미널 계약이 바뀌는 점도 남는다.
  원래 물리 터미널로 raw 출력을 통과시키는 제품 선택이다. 우리 경로가 더 싸다는 주장은 아니다.
- **엔진 `--bg` supervisor와 claude-ssh의 수명 정책.** repaint 실패의 재시작, upgrade 이주, orphan 정리 정책은 live work
  보존과 맞지 않는다([엔진 정책](holder-tui-spike.md#L82)). claude-ssh helper 교체는
  옛 자식 전부를 죽인다([helper 교체](desktop-ssh-helper-protocol.md#L88)). 전송과
  adoption의 세부는 빌리되 수명 정책은 빌리지 않는다. dispatch, transcript 자동 respawn, spare, 예약 worker도 가져오지 않는다.
- **웹 터미널 창 (2026-10-23, F5·F6).** 같은 TUI를 xterm.js로 보여 주고 passkey 확인 뒤 키보드를 넘겨받는 창이다.
  조작성은 가장 좋다. 그러나 실행 등급의 raw 키 바이트가 hub를 지나고, MAWS GUI가 모르는 두 번째 제어면이 생긴다.
  처음 설계의 세부(observer 입장, 키보드 가져오기와 passkey, 정확한 복구를 전제로 한 snapshot)는 PR #79의 커밋
  3bc513ee1 판에 남아 있다.
- **브라우저의 Query (claude.ai 모양).** 브라우저가 Agent SDK의 Query를 직접 돌리고 기계는 프로세스만 쥐는 길이다.
  MAWS 소유 일이 Query와 같은 프로세스에 살고, Query는 쓰는 쪽 하나이며, SDK stdio 전체가 믿지 않는 hub를 지나게
  되므로 버렸다(§3.6).
