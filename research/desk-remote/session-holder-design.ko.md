# 기계 쪽 세션 holder 설계 (MAWS·웹 세션의 프로세스를 쥐는 구조)

2026-10-27 판. 설계 문서다. 구현을 승인한 것이 아니다. MAWS #52의 연구 결과
[web-maws-remote-research.ko.md](web-maws-remote-research.ko.md)
§3.2, §3.7 위에 선다.

**판의 이력.**
- 2026-10-22 첫 판: 사람이 터미널에서 치는 `claude`도 wrapper를 거쳐 우리 PTY holder 안에서 돌게 하고, 웹에 터미널
  창을 두는 구조였다. 같은 날 비판 검토 한 차례로 식별자·인증·복구 계약과 정리·이동의 fence를 보강했다.
- 2026-10-23: 웹 터미널 창을 뺐다(F5, F6).
- 2026-10-24: PTY holder를 뺐다(F7). 터미널에서 띄운 세션은 holder 밖에서 plain으로 돌고 bridge mod로만 제어한다.
  이 문서는 이제 MAWS 앱이나 웹에서 연 `claude -p` 세션만 다룬다. 이전 판 전체는 PR #79의 커밋 8a9f24261에 있다.
- 2026-10-26: 두 가지를 고쳤다.
  - **Query의 자리.** Query는 MAWS 데몬이 아니라 engine host 안에 있다. MAWS architect가 코드로 확인했다(오늘의 E10 Session, `src/shared/engine/initialize.ts:13`). 기계 데몬(mawsd)은 engine host의 유일한 클라이언트다.
  - **Claude Desktop 3.6556.2의 helper 변경.** 미룬 interrupt의 영속, 첫 시작의 session id, 확인된 입양, 보류 입력의 한 번 시작을 반영했다([desktop-ssh-helper-3.6556.md](desktop-ssh-helper-3.6556.md)).
  - 원격 계층 전체(endpoint, 채널, 신원)는 MAWS PR #183의 `docs/doperpowers/specs/2026-10-26-remote-layer-design.md`가 정한다.
- 2026-10-27: P5(`docs/doperpowers/plans/2026-10-27-p5-org.md` §2)의 정리 규칙을 반영했다. 시간은 기계의 역할을 따르고, 정리는
  엄격하다(§1의 5). 일 상태는 task와 cron을 원천별로 따로 읽는다(§3.2). task는 지금 engine host가 이미 읽는 수준 신호를 쓰고,
  cron은 Stop hook에서 새로 읽는다.

사실의 근거가 되는 측정 노트(Claude Code 2.1.304–2.1.308):
- [desktop-ssh-helper-protocol.md](desktop-ssh-helper-protocol.md): claude-ssh의 전송·재입양 계약(이 설계의 기준)
- [background-work-handoff.md](background-work-handoff.md): 세션을 옮길 때 백그라운드 일
- [reap-signal-spike.md](reap-signal-spike.md): SIGTERM의 마감, 턴을 붙잡을 수 있는 곳
- [holder-tui-spike.md](holder-tui-spike.md): 우리 PTY 아래의 plain Claude(이전 판의 근거, 지금은 §11)
- [mod-command-run-probe.md](mod-command-run-probe.md), [bridge-perf-bench.md](bridge-perf-bench.md): 경로 A의 bridge mod

## 0. 무엇을 위한 것인가

**두 경로** (연구 문서 §3.7의 owner 결정, 2026-10-19).
- **경로 A.** 사람이 터미널에서 띄운 세션과 엔진의 `--bg` 세션이다. 프로세스는 사람의 터미널이나 엔진 supervisor가
  쥐고, 웹은 세션 안의 bridge mod로 제어한다. holder는 관여하지 않는다. 제어 폭은 mod API가 한도이고, 그 폭을
  넓히는 일은 이 문서 밖에서 한다(§3.4).
- **경로 B.** MAWS 앱이나 웹에서 연 세션이다. `claude -p` stream-json으로 띄우고, holder가 프로세스를 쥐고, engine host의
  Query가 제어한다. **이 문서의 대상이다.**

**장면 (경로 B).** 사람이 폰의 웹에서 MacBook의 MAWS 세션을 연다. 세션은 MAWS의 기능을 모두 쓴다. 폰이 잠들거나,
hub가 배포로 재시작하거나, mawsd나 engine host가 업데이트로 재시작해도 claude 프로세스와 그 백그라운드 셸·서브에이전트·
Monitor·MCP 작업은 끊기지 않는다. 다시 열면 놓친 출력을 받고 그대로 이어 쓴다.

**조건.**
- claude 프로세스는 Query보다 오래 산다. Query는 engine host에 있고, session host가 프로세스를 쥐므로 engine host 재시작은 프로세스 재시작이 아니다. mawsd 재시작은 Query도 건드리지 않는다.
- 출력은 놓치지 않고, 입력은 정확히 한 번 적용한다. 대기 중인 권한·dialog는 Query가 다시 붙을 때 다시 받는다.
- 클라이언트가 없어도 일이 남아 있는 세션은 끝내지 않는다.

**아니어야 하는 것.**
- raw 프로세스 스트림(PTY 바이트, SDK stdio)을 기계 밖으로 내보내는 것(F5). 웹이 받는 것은 bridge 행과 X1 이벤트이고,
  보내는 것은 봉인된 명령이다.
- 사람이 터미널에서 띄운 세션을 가로채거나 옮기는 것(F7).
- 수명 정책이 멀쩡한 세션을 죽이는 것(엔진 supervisor와 claude-ssh의 수명 정책은 가져오지 않는다, §11).
- hub가 member 인증 없이 실행을 일으킬 수 있는 구조(연구 문서 §3.5, 이 문서 §6).

## 1. owner 결정

지금 유효한 것만 적는다. 철회된 것을 포함한 기록은 §7이다.

1. 경로는 세션이 어디서 시작됐는지로 정한다. 터미널과 `--bg`에서 시작한 세션은 경로 A, MAWS 앱이나 웹에서 연 세션은
   경로 B다(2026-10-22, 10-24 개정).
2. 터미널에서 띄운 세션은 bridge mod로만 제어하고 그 한계를 받아들인다. holder 안에서 띄우지 않고, 살아 있는 프로세스를
   경로 B로 옮기지 않는다. 대신 mod 쪽 제어 표면을 최대한 넓힌다(F7, 2026-10-24).
3. 웹 터미널 창은 두지 않는다. 조작성은 좋지만 기존 sminos·MAWS 구조를 깨기 때문이다(F5, 2026-10-23).
4. 경로 B의 프로세스는 우리가 만든 holder가 claude-ssh 방식으로 쥔다. 엔진 supervisor는 참고만 한다(2026-10-22).
5. 클라이언트가 없고, 턴이 돌지 않고, 백그라운드 일과 cron이 없는 상태로 정해진 시간이 지난 세션은 끝낸다. transcript로
   다시 연다. 시간은 기계의 역할을 따른다. MacBook은 마지막 관심 뒤 10분(지금 규칙), 서버(mini, VM)는 24시간이다(F2,
   2026-10-22; P5 §2, 2026-10-27). 정리는 어느 기계에서든 엄격하다. 백그라운드 Bash, 서브에이전트, Monitor, session cron,
   MCP task 중 하나라도 있거나 일 상태를 읽을 수 없으면 끝내지 않는다(2026-10-27). 지금은 경로 B에만 적용한다.
6. holder는 MAWS engine host로 흡수한다. 지금 엔진 프로세스를 쥐는 E10 supervisor를 claude-ssh 방식으로 강화한 것이
   holder다(F3, 2026-10-24 개정).

## 2. 구조

```
기계
  사람의 터미널                                   웹(브라우저)
     │                                               ▲ X1 이벤트 ↓ · 봉인된 명령 ↑
  claude TUI (경로 A, holder 밖)                     │
     └ bridge mod ────────────┐                     hub (중계만, 믿지 않음)
                              ▼                      │
                         mawsd (endpoint 모듈: uplink, 신뢰 경계, 채널) ─┘
                              ▲            └ sminos 데몬 (로컬: 로그, 전달, 경로 A plane)
                              │ X1 이벤트 (경로 B), mawsd는 engine host의 유일한 클라이언트
                         engine host ── Query · maws tool server (쓰는 쪽 하나, 출력 checkpoint, request ledger)
                              │ stdin offset ↓ · 출력 seq ↑     └ holder manager (roster 재입양, 수명)
                         session host (세션마다 하나)
                              │ stdin·stdout pipe
                         claude -p stream-json (안에 관찰 전용 bridge mod)
```

경로 A와 B는 hub와 웹 쪽에서 plane 하나를 함께 쓴다. cursor, 연결 계약, 신뢰 채널, X1 어휘가 같고, 경로의 차이는
세션마다 내는 capability 목록에만 드러난다(연구 문서 §3.7).

## 3. 구성 요소

### 3.1 session host (세션마다 하나, 작고 거의 바뀌지 않는 것)

host가 죽으면 pipe가 닫혀 세션이 끝난다. 그래서 host는 가능한 한 작게 두고, 바뀌는 정책은 manager로 보낸다.
수명·인증·fence의 집행은 host에 남긴다. claude-ssh 데몬의 프로세스 객체를 세션마다 떼어 낸 모양이다.

- **쥐는 것.** claude의 stdin·stdout·stderr pipe. engine host가 준 launch descriptor(argv, cwd, env)로 시작한다.
- **식별자.** `holderId`는 holder 자리의 안정된 id다. `processEpoch`는 claude 자식을 띄울 때마다 새로 만들고 그 프로세스
  동안 바꾸지 않는다. `engineSessionId`는 현재 대화의 id이고, `bindingGeneration`은 채널 결합을 바꿀 때 증가시킨다.
  `hello`와 roster가 네 필드를 모두 싣는다. `/clear`, `/branch`, resume는 프로세스를 바꾸지 않고 `engineSessionId`를 바꾼다
  ([측정](mod-command-run-probe.md#L40)). 그때 제어·transcript를 새
  generation에 원자적으로 다시 묶고 옛 맥락의 명령을 무효화한다.
- **시작.** manager가 host를 double fork + `setsid`로 띄운다. host가 소켓과 자기 roster 항목을 먼저 만들고 ready를 보낸
  뒤, manager의 commit을 받아야 claude를 fork한다. commit 뒤 manager가 죽거나 ack가 사라지면 roster·hello·종료 상태로
  reconcile한다. 결과가 불명확하다고 같은 세션의 claude를 하나 더 띄우지 않는다.
- **Linux 수명.** host는 user systemd의 transient scope 안에서 띄운다. `setsid`나 double fork만으로는 `KillUserProcesses`가
  적용되는 logind session cgroup을 벗어나지 못한다. 로그아웃 뒤에도 살려면 lingering도 필요하다.
- **출력 ring.** stdout을 JSONL 줄 단위로 끊어 세션 안의 단조 증가 seq를 매기고 마지막 N MiB(claude-ssh는 16 MiB)를 둔다.
  `read(fromSeq)`는 그 seq부터 replay하고 보관 창 `firstSeq..lastSeq`를 알려 준다. gap은 추측하지 않고 정확히 드러난다.
- **입력 offset.** `stdin{data, offset}`은 멱등이다. host는 적용한 offset(`stdinApplied`)을 알려 주고, 이미 적용한 바이트는
  `duplicate`로 답한다.
- **writer fence.** 쓸 수 있는 Query는 하나다. host가 writer 신원과 단조 증가 fence를 쥐고, 옛 Query 연결에서 늦게 온
  쓰기를 거절한다. manager가 정책을 정하고 host가 compare-and-swap으로 적용한다. manager는 재입양할 때 이 기록을 읽고
  초기화하지 않는다.
- **소켓과 인증.** 같은 uid의 0700 디렉터리에 Unix socket을 두고 경로의 소유권을 확인하며 symlink를 거절한다.
  `hello`, ring 등 비공개 출력과 모든 제어보다 인증이 먼저다. `writer`, `observer`, `manage` capability를 나누고 모든 변경
  프레임에서 역할·맥락·fence를 검사한다. token은 fd나 pipe로 전달하고 argv, 로그, claude 자식의 env에 넣지 않는다.
  프레임과 queue 크기에 상한을 둔다.
- **수명.** 스스로 세션을 끝내는 정책은 없다. 엔진의 "부모가 없고 클라이언트가 없으면 60초 뒤 kill" 규칙과 claude-ssh의
  "300초 멈춘 프로세스 교체"는 두지 않는다. manager의 정리 의도는 host의 reap fence를 거쳐 집행한다(§3.2). claude가
  끝나면 종료 상태와 마지막 출력을 일정 시간 남긴다. 종료 확인은 host의 `waitpid`다.
- **구현.** 정적 native binary. Go가 유력하다(claude-ssh와 같은 선택).

### 3.2 holder manager (사용자당 하나, 언제든 바꿀 수 있는 것)

- **roster와 재입양.** host가 쓴 roster에서 pid, 프로세스 시작 시각, 소켓, 네 식별자를 읽는다. pid·시작 시각을 확인하고
  인증한 소켓의 `hello`와 맞춰 다시 잡는다. 재시작해도 세션은 유지된다.
- **API.** `spawn {argv, cwd, env}`, `list`, `attach {holderId, processEpoch, bindingGeneration, role}`, `kill`, `signal`,
  상태 이벤트(`running | asleep | ended`). `asleep`은 정리 규칙이 끝낸 세션이다.
- **정리 (F2).** 다음이 모두 참인 동안만 시계가 간다. 하나라도 깨지면 0이 되고, manager 재시작 때도 0부터 간다.
  - 붙은 Query 말고 클라이언트가 없다. 웹의 구독 화면도 클라이언트로 센다. 잊힌 탭이 세션을 붙잡을 수 있으므로 웹
    목록에 떠 있은 시간과 RSS를 보인다.
  - 턴이 돌지 않고, 일 상태가 현재 맥락의 `verified-empty`다.
  - host의 실시간 descendant 검사에 일의 흔적이 없다.

  **일 상태.** `unknown | nonempty | verified-empty`를 `(processEpoch, engineSessionId, activity generation)`에 묶는다.
  task와 cron은 원천이 달라 따로 읽는다. 둘 다 비었다고 알려졌을 때만 `verified-empty`다. 하나라도 unknown이면 unknown이고,
  unknown은 절대 정리하지 않는다.
  - **task** (백그라운드 Bash, 서브에이전트, Monitor, MCP task, workflow). stream의 `background_tasks_changed`가 원천이다
    ([SDK 0.3.259](/Users/new/claude-code-bundle/agent-sdk-0.3.259/sdk.d.ts#L3359)). 집합이 바뀔 때마다 전체를 보내는 수준
    신호라서, Stop이 없는 interrupt나 API error 뒤에도 task 쪽은 알려진 채로 남는다. 지금 engine host가 이미 이것을 읽어 예산과
    E10 idle 정리의 hard reason으로 쓴다(`src/engine-host/budget.ts`의 `hardReasons`).
    - `ambient` task는 지금 코드처럼 세지 않는다. 엔진이 사용자 일이 아니라고 표시한 정리용 task(skip_transcript task, 자동으로
      시작된 watcher)이고, 세면 watcher 하나가 세션을 끝없이 붙잡는다.
    - 프로세스가 시작될 때는 아무것도 오지 않으므로 빈 집합에서 출발한다.
    - 재입양한 프로세스는 snapshot이나 다음 변경이 올 때까지 unknown이다. SDK는 다시 `initialize`하면 지금 집합을 보낸다고
      적지만, 2.1.311 reprint에서 찾은 snapshot은 Remote Control attach 경로뿐이다
      ([L506648](/Users/new/claude-code-bundle/2.1.311/cli.pretty.js#L506648)). 잰다(§9).
  - **cron** (CronCreate, ScheduleWakeup, `/loop`). stream에는 대응하는 신호가 없고 Stop의 `session_crons`만 원천이다
    ([Stop 입력](/Users/new/claude-code-bundle/2.1.307/modules/claude-code.d.ts-2706c2b1.txt#L12912)). 지금 engine host는 이것을
    읽지 않으므로 Stop hook callback을 더한다.
    - Stop 없이 끝난 턴(사용자 interrupt, API error. StopFailure에는 일 목록이 없다:
      [StopFailure](/Users/new/claude-code-bundle/2.1.307/modules/claude-code.d.ts-2706c2b1.txt#L12895))은 마지막 Stop 뒤로 stream에
      cron 도구 호출(서브에이전트의 것 포함)이 없었으면 마지막으로 안 집합을 그대로 쓴다. cron은 도구 호출로만 생기므로 그
      집합은 실제보다 작지 않고, 틀려도 정리를 더 막는 쪽으로만 틀린다. cron 도구 호출이 있었으면 다음 Stop까지 unknown이다.
    - 새로 띄운 프로세스와 정리 뒤 `--resume`한 프로세스는 빈 집합에서 출발한다(정리는 cron이 없을 때만 한다). 그 밖의
      재시작(engine host 고장, major 업그레이드) 뒤의 `--resume`은 durable cron이 되살아날 수 있으므로 첫 Stop까지 unknown이다.
  - 모든 origin의 turn start, background tool launch, Query 재접속, id 변경은 verified-empty를 무효화한다.
  - host가 claude의 descendant를 실시간으로 검사한다. pid로 등록한 기반 프로세스(관찰 bridge child, MCP·LSP 서버)
    외에는 모두 일로 세어 정리를 막는다. 자식이 있다는 것은 veto일 뿐, 없다는 것은 일이 비었다는 증거가 아니다.

  정해진 시간(§1의 5)이 지나면 host가 다음 상태 기계를 집행한다.
  1. reap fence를 먼저 arm한다. arm 확인 전에는 신호를 보내지 않는다. 문을 쥔 쪽이 건강하지 않으면 arm하지 않고 일
     상태를 unknown으로 둔다.
  2. 문은 세션 안 관찰 전용 bridge mod의 `turn.step` hook이다. TUI에서는 이 hook이 `!` 셸 모드 완료와 queue에서 꺼낸
     prompt까지 모든 턴을 모델 요청 전에 붙잡았다([측정](reap-signal-spike.md)).
     `-p` 프로세스에서도 같은지는 재지 않았다(§9). Query는 쓰는 쪽 하나지만 cron 발화와 task 알림은 Query를 거치지 않고
     턴을 시작하므로 Query만으로는 문이 되지 않는다.
  3. host의 같은 상태 기계가 `reap cancelled`(턴 진행) 또는 `already signalled`(종료 중)로 답한다. 후자의 거절은 소비된
     턴이 되므로 그 답에 "holder가 세션을 끝냈다, 다시 열면 이어진다"를 적는다.
  4. fence가 arm된 뒤 최신 일 상태·generation·클라이언트·descendant를 최종 확인하고 SIGTERM을 보낸다.
  5. 끝나지 않으면 SIGKILL로 올리지 않는다. 일 상태를 unknown으로 돌리고 세션을 살려 두며 사건을 기록한다. `waitpid`로
     실제 종료를 확인한 경우에만 asleep으로 기록한다.

  `turn.step` 문은 hook chain이 요청 전에 실패하면 열린다
  ([2.1.307 L405905](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L405905)–405910). 그래서 1의 건강 조건이 fence의
  일부다. asleep 기록은 engineSessionId와 launch descriptor를 보관하고, 다시 열 때 argv의 `-c/--continue`,
  `-r/--resume <x>`, `--session-id`와 positional prompt를 지운 뒤 `--resume <engineSessionId>`를 넣는다.
- **구현.** MAWS engine host의 E10 supervisor를 키운 것이다(F3). Electron에 기대지 않는 Node 빌드이고 MAWS headless
  데몬과 함께 launchd·systemd unit으로 돈다. 세션마다의 host binary도 MAWS가 함께 배포한다. E10 프로토콜에서 지킬 것과
  더할 것은 연구 문서 §3.4를 따른다.

### 3.3 engine host의 Query

- **자리.** Query는 클라이언트 앱이 아니라 세션이 도는 기계의 engine host에 둔다(지금 MAWS 코드도 그렇다: E10 Session).
  Desktop SSH 모드에서 Desktop 앱이 하던 역할을 같은 기계의 engine host가 맡는다. mawsd는 그 engine host의 유일한 클라이언트이고,
  앱은 그 바깥의 클라이언트다. claude.ai는 브라우저가 Query를 직접 돌리지만
  ([claude.ai 클라이언트](claude-ai-rc-client-protocol.md#L33)) 우리는 그렇게 하지 않는다.
  - MAWS 소유 일(in-process MCP, hook callback)이 Query와 같은 프로세스에 산다.
  - Query는 엔진의 질문에 답하는 쓰는 쪽 하나라 잠드는 탭이나 여러 탭 중 하나에 둘 수 없다.
  - hub는 믿지 않는 중계라 SDK stdio를 통째로 지나게 하지 않는다(F5).
- **쓰는 쪽 하나.** host의 writer fence로 옛 Query의 쓰기를 거절한다. Query 재시작은 processEpoch를 바꾸지 않는다.
- **확인된 입양과 붙어 있음은 다르다** (Desktop 3.6556.2). 재입양한 프로세스는 Query가 다시 `initialize`하고, hook, 권한 모드, 대기 요청
  확인을 마친 뒤에야 "확인됨"으로 친다. 그 전에는 붙어 있어도 제어나 공유를 열지 않는다.
- **미룬 interrupt는 영속한다** (Desktop 3.6556.2의 `stopOwedAt`). 사람이 보낸 interrupt를 돌고 있는 세션에 넘길 때 owed 표시를
  영속으로 남긴다. 그 표시는 interrupt가 끝났거나, 관련 stdin 쓰기가 모두 받아들여진 것(`stdinApplied`)을 확인한 뒤에야 지운다.
  owed 표시가 있는 세션은 그냥 재입양해 일을 잇지 않는다. 재입양할 때 interrupt부터 전달하거나, 정리 대상으로만 다룬다.
- **첫 시작의 session id를 먼저 정한다** (Desktop 3.6556.2의 `namedCliSessionId`). spawn할 때 `--session-id`를 골라 roster에 적는다.
  claude가 id를 알리기 전에 Query가 죽어도 그 프로세스를 다시 찾을 수 있다.
- **보류 입력은 한 번만 시작한다** (Desktop 3.6556.2). 프로세스가 없는데 사람의 입력이 보류돼 있으면 세션을 한 번만 자동으로 다시 연다.
  그 한 번이 실패하면 사람의 다시 시도나 다음 입력을 기다린다. 끝없이 다시 시작하지 않는다.
- **`--await-initialize` 후보.** Desktop은 관리되는 launcher로 시작할 때 이 인자를 붙이고, 첫 stdin 쓰기 뒤에 `keep_alive` 한 줄을 보낸다.
  2.1.310에도 이 인자가 있다. Query의 `initialize` 전에 claude가 턴을 시작하지 않게 하는 데 쓸 수 있는지는 잰다(§9).
- **재입양.** claude-ssh의 전송·adoption 계약을 가져온다
  ([출력 checkpoint·stdin offset](desktop-ssh-helper-protocol.md#L183)–225,
  [대기 요청·gap 복구](desktop-ssh-helper-protocol.md#L299)–346).
  - 매 input write 전에 출력 checkpoint `{seq, skipBytes}`를 영속 commit하고, 새 Query의 stdin offset은 host의
    `stdinApplied`로 rebase한다.
  - checkpoint는 JSONL 줄 경계에 둔다. replay는 exact/gap으로 분류하고, gap이면 줄 경계를 다시 맞추고 transcript를
    다시 읽어 reseed한다.
  - 다시 `initialize`하면 엔진이 대기 중인 권한·dialog 요청을 다시 보낸다. replay와 겹치는 것은 request id로 중복을 없앤다.
  - host의 ring은 durable Query checkpoint가 아니다. ring만 남아 있다고 Query의 소비 위치와 응답 이력이 복원되지는 않는다.
- **살아남는 일의 경계.** CLI가 소유한 일은 engine host 재시작을 견딘다. MAWS가 소유한 일(engine host 안의 tool server와 hook)은 그대로 살아남지 않는다.
  mawsd 재시작은 둘 다 건드리지 않는다.
  - in-process MCP tool call은 MAWS의 메모리에 있다
    ([server.ts의 calls](/Users/new/Developer/GitHub/MAWS/src/engine-host/tool-server/server.ts#L77),
    [dispatch와 완료](/Users/new/Developer/GitHub/MAWS/src/engine-host/tool-server/server.ts#L164)–187).
  - SDK hook callback은 re-initialize 때 엔진이 retire한다
    ([2.1.307 재초기화](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L938674)–938690).
  - tool의 효과를 dispatch하기 전에 durable in-flight request ledger를 쓴다. 계획된 재시작은 timeout을 두고 drain한다.
    timeout만으로 강제 중단을 허용하지 않는다.
  - 갑작스러운 재시작 뒤 orphan request에는 "결과 불명; 이미 완료됐을 수 있다"고 답한다. 보통의 재시도 가능한 오류로
    돌려 side effect를 중복 실행하게 하지 않는다.
- **plane 생산.** Query가 받은 이벤트를 X1으로 바꿔 경로 B의 plane을 만들고, mawsd의 endpoint 모듈이 구독자마다 봉인해 내보낸다. 서브에이전트 토큰 델타는 SDK wire에
  없으므로 세션 안 관찰 전용 bridge의 `turn.step` 조각을 받아 같은 seq에 넣는다. 한 세션의 seq는 engine host 하나만
  매긴다(연구 문서 §3.7).

### 3.4 bridge mod

- **경로 A에서는 통제자다.** 스트림(행, `turn.step` 조각, 서브에이전트), steer, interrupt, 권한·질문 답, model·effort
  덮어쓰기, `$.command.run`으로 slash 명령을 다룬다. 이 폭을 최대한 넓히는 것이 F7의 일이다. 무엇이 닿고 무엇이 닿지 않는지와
  닿지 않는 것을 메울 길은 [mod-control-surface.md](mod-control-surface.md)에
  정리했다(2.1.309, 코드 읽기).
- **경로 B에서는 관찰만 한다.** engine host가 spawn할 때 env 표시를 두고, 그 표시가 있으면 bridge는 제어를 거절하거나
  engine host로 넘긴다(새 일이다. 지금 `bridge.tsx`에는 그 표시가 없다). 서브에이전트 델타를 engine host에 주고, 정리 fence의 `turn.step` 문을 집행한다(§3.2).

### 3.5 웹

- **세션 화면.** GUI(desk-web의 presentation, MAWS 렌더러 이식)만 있다. 웹 터미널 창은 두지 않는다(F5).
- **capability 목록.** 세션마다 명령별로 `gui | none`을 낸다. 웹은 경로 이름이 아니라 이 목록을 보고 조작을 그린다.
  - 경로 B: SDK 제어 요청 96종과 dialog 37종을 GUI로 다룬다.
  - 경로 A: mod로 닿는 것이 `gui`, 나머지가 `none`이다. 측정된 현재의 `none`은 rewind 지점 고르기, panel(`/usage`,
    `/permissions`, 인자 없는 `/mcp`), 일반 dialog 대부분, plan 외의 권한 모드 전환이다. mod 쪽 폭이 넓어지면 이 목록만 바뀐다.
- **끝난 경로 A 세션 다시 열기.** 터미널의 claude가 끝난 뒤에는 그 대화를 경로 B 세션으로 다시 열 수 있다(`--resume`).
  살아 있는 프로세스를 옮기는 것이 아니므로 백그라운드 일의 문제가 없다. 엔진 레지스트리(`~/.claude/sessions/<pid>.json`)로
  살아 있는 소유자를 확인하고, 살아 있으면 거절한다(연구 문서 §3.7). 첫 resume에 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`은
  자동으로 켜지 않는다. 끊긴 턴을 다시 돌리면 foreground 명령까지 처음부터 다시 실행되기 때문이다
  ([측정](background-work-handoff.md#L144)–150).

## 4. 데이터 흐름

- **경로 A.** claude 안의 bridge mod → bridge child → sminos 데몬 plane → hub → 웹. 웹의 동작은 봉인된 명령으로
  hub → sminos 데몬(봉인 검증) → bridge mod다.
- **경로 B 출력.** claude -p stdout → session host(seq ring) → engine host Query(checkpoint) → X1 이벤트 → mawsd endpoint 모듈(구독자마다 봉인) → 채널(hub 중계 또는 tailnet 직접) → 앱.
- **경로 B 입력.** 앱의 동작(RL4) → 채널 → mawsd endpoint 모듈(검증, 등급, 신선도) → engine host Query(opId 원장, 맥락 재확인)
  → session host(writer fence, stdin offset) → claude -p stdin.
- cursor의 맥락은 `(holderId, processEpoch, engineSessionId, bindingGeneration)`이고 그 안에 seq를 둔다.

## 5. 고장과 회복

| 일 | 결과 | 대응 |
|---|---|---|
| mawsd가 죽음 | Query, tool server, claude, CLI 일 모두 유지 | 채널과 engine host 클라이언트 연결만 끊긴다. 다시 붙고 cursor로 이어 간다 |
| engine host가 죽음 | claude와 CLI 일은 유지(session host가 쥔다). MAWS의 in-flight call은 잃음 | Query 재입양(checkpoint, stdinApplied rebase, 대기 요청 재전달, owed interrupt 먼저)과 ledger 복구. orphan은 결과 불명으로 답함 |
| manager가 죽음 | 세션·Query 연결·fence 기록은 host에 남음 | roster로 재입양하고 기존 fence를 읽음 |
| host가 죽음 | pipe가 닫혀 claude가 끝남 | ended로 표시하고 resume 제안. 끊긴 턴 재개 변수는 자동 설정하지 않음 |
| claude가 죽음 | host의 waitpid가 종료를 확인함 | 마지막 출력을 남기고 ended. 웹에서 resume 제안 |
| ring이 넘칠 만큼 Query가 오래 내려감 | checkpoint 이후 출력에 gap | gap을 알리고 transcript로 reseed. 정확한 복구로 표시하지 않음 |
| 기계 재부팅 | 모두 끝남 | 재부팅 전에 열려 있던 세션을 목록으로 제안 |
| holder 업데이트 | manager는 언제든 바꿈. host는 새 세션부터 새 binary | hello의 버전을 확인하고 호환되는 프로토콜로 재입양 |
| Claude Code 업데이트 | 도는 프로세스는 그대로. 새 세션은 새 버전 | `turn.step` 문과 SIGTERM 마감을 다시 잼 |
| 정리 SIGTERM 뒤에도 살아 있음 | 종료 확인 없음 | SIGKILL 없이 unknown으로 돌리고 기록. 세션 유지 |

## 6. 보안

- 로컬 경계는 같은 uid다. 그 uid의 코드는 신뢰한다. 소켓의 소유권·symlink를 검사하고 0700 디렉터리를 쓴다.
- 인증은 모든 private 출력과 제어보다 먼저다(엔진 자신의 PTY 소켓은 인증 전에 hello·ring을 보낸다,
  [2.1.307](/Users/new/claude-code-bundle/2.1.307/cli.pretty.js#L32598)–32636. 그 구멍은 빌리지 않는다).
- 웹에서 오는 것은 동작마다 봉인된 명령뿐이다. 명령은 principal, session, processEpoch, bindingGeneration에 묶이고 재결합 뒤
  옛 명령은 거절된다. stdio나 PTY 바이트는 hub를 지나지 않는다(F5).
- hub를 믿지 않는다면 명령 서명만으로는 부족하다. 조작된 GUI 표시를 보고 사람이 승인할 수 있으므로 표시 무결성도
  [연구 문서의 열린 신뢰 결정](web-maws-remote-research.ko.md#L259)에 포함한다.
  hub가 내려주는 JS 자체의 신뢰 한계도 남는다.
- 보존하는 launch descriptor의 env는 비밀 데이터로 다루고 출력·로그에 노출하지 않는다.

## 7. 갈림길 기록

- **F1. 사람이 터미널 창을 닫으면? (2026-10-22, F7로 철회)** 정했던 것: detach되어 계속 돈다. PTY holder가 없어져 해당이
  없다. 터미널 세션은 plain과 같이 창을 닫으면 끝난다.
- **F2. 클라이언트 없는 세션의 수명 (2026-10-22).** 정함: 24시간 정리(§3.2). Claude Code 프로세스 하나가 수백 MB를 쓴다(이
  MacBook에서 24개 평균 281 MB, 최대 549 MB RSS, 2026-10-22). 처음에는 detach된 TUI 세션을 위한 것이었고, F7 뒤로는 경로 B
  세션에 적용한다. 버린 대안: 절대 스스로 끝내지 않는다. 2026-10-27: P5가 기계 역할별 시간(MacBook 10분, 서버 24시간)과
  엄격한 정리를 정했다(§1의 5).
- **F3. holder는 어느 제품에 속하는가 (2026-10-22 정함, 10-24 개정).** 정함: MAWS engine host로 흡수한다. 지금 엔진
  프로세스를 쥐는 E10 supervisor를 claude-ssh 방식으로 강화하는 것이고, 연구 문서 §3.2가 원래 권한 길이다.
  - 처음 정했던 것: 독립된 작은 서비스(`apps/session-holder`)로 두고 sminos 데몬과 MAWS 데몬이 둘 다 클라이언트가 된다.
    F7 뒤에는 holder가 쥐는 것이 MAWS가 띄우는 pipe 세션뿐이라 클라이언트가 MAWS 데몬 하나로 줄어 그 근거가 없어졌다.
  - 버린 대안: 독립 서비스 유지. MAWS 밖의 클라이언트에 대비하는 대신 프로세스 경계와 프로토콜이 하나 더 남는다.
- **F4. "GUI 모드로 이어 가기 (세션을 다시 띄움)" 버튼 (2026-10-22, F7로 철회).** 살아 있는 터미널 세션을 pipe 종류로
  옮기는 버튼이었다. 끝난 세션을 경로 B로 다시 여는 것(§3.5)만 남는다.
- **F5. 웹 터미널 창 (2026-10-23).** 정함: 조작성은 좋지만 비선호이고 설계에서 뺐다.
  - sminos·desk: hub를 지나는 것은 동작마다 봉인되는 명령과 seq가 붙은 구조화된 행이다. 웹 터미널 창은 실행 등급의 raw
    키 바이트를 hub로 보내고, 자기 offset·lease·snapshot 프로토콜, passkey step-up, 화면 무결성 문제를 따로 데려온다.
  - MAWS: GUI는 X1 이벤트로 상태를 그린다. 창에서 누른 키는 그 모델에 보이지 않고, 한 세션에 제어면이 둘이 된다.
  - 같은 원칙: raw 프로세스 스트림은 기계를 떠나지 않는다. Query를 브라우저에 두지 않는 것도 여기서 나온다(§3.3).
- **F6. F5의 반영 (2026-10-23).** 정했던 것: 웹 터미널 창을 빼고, 키로만 되는 조작은 bridge 상태로 확인되는 기계 쪽
  매크로나 GUI 모드 전환으로 했다. F7로 매크로와 GUI 모드 전환도 PTY holder와 함께 없어졌다.
- **F7. 터미널에서 띄운 세션 (2026-10-24).** 정함: bridge mod로만 제어하고 한계를 받아들인다. PTY holder, wrapper, 매크로,
  살아 있는 세션의 경로 이동을 모두 뺀다. 대신 mod 쪽 제어 표면을 최대한 넓힌다.
  - 이유: 살아 있는 터미널 세션을 pipe로 옮기면 Monitor와 MCP 작업을 잃고, 서브에이전트의 진행 중 명령이 다시 돌며,
    백그라운드 셸을 살리려면 엔진 내부 인계 파일에 기대야 한다
    ([측정](background-work-handoff.md)). 그 대가로 얻는 것이 화면에서 고르는
    몇 가지 조작뿐이었다. PTY holder만 남기면 모든 `claude` 실행이 wrapper를 거치는 변경을 창을 닫아도 세션이 남는 것 하나를
    위해 지게 된다.
  - 버린 대안: 창을 닫아도 세션이 남도록 PTY holder만 남기기.

## 8. 검증 계획 (구현할 때)

1. **Query 재입양.** input 전 checkpoint commit, stdinApplied rebase, 줄 경계, 대기 요청 중복 제거, gap reseed, owed interrupt를 검사한다.
   engine host를 SIGKILL한 뒤 다시 띄워도 claude의 백그라운드 셸·서브에이전트·Monitor가 그대로 돌고, 놓친 출력을 받는다.
2. **writer fence.** 옛 Query와 새 Query가 동시에 쓰면 옛 쪽이 거절된다. 재결합 뒤 옛 명령도 거절된다.
3. **ledger.** MAWS 재시작 중 tool 효과가 이미 실행됐어도 orphan 응답이 보통의 재시도를 유도하지 않는다.
4. **manager.** SIGKILL해도 Query 연결과 host의 fence·input offset은 유지되고, 다시 뜬 manager가 이를 초기화하지 않는다.
   spawn 직후 manager crash와 ack 유실이 claude 이중 spawn을 만들지 않는다.
5. **식별자.** `/clear`, `/branch`, resume가 processEpoch는 유지하면서 engineSessionId와 bindingGeneration을 바꾸고, 옛 명령을 거절한다.
6. **reap-fence 경쟁.** fence arm 직전·직후·최종 검사와 SIGTERM 사이에 모든 origin의 턴 시도(Query 입력, cron 발화, task
   알림)를 넣는다. 취소 후 진행 또는 신호 후 거절 중 하나만 일어나는지 본다. `turn.step` hook이 실패하거나 bridge가 끊기면
   arm하지 않는다. 클라이언트·구독·턴·셸·Monitor·cron·미등록 descendant 중 하나만 남아도 끝내지 않는다.
7. **인증.** 인증 전 hello·ring 유출, observer의 쓰기, 옛 fence, symlink 소켓, 큰 프레임·queue를 거절한다.
8. **끝난 세션 다시 열기.** 살아 있는 소유자가 있으면 거절하고, 없으면 같은 engineSessionId로 이어진다.

## 9. 남은 미지수 (spike로 풀 것)

- **`-p` 프로세스의 정리 문과 마감.** `turn.step` 문과 SIGTERM의 graceful 마감은 TUI에서만 쟀다(2.1.308). `-p` stream-json
  프로세스 안에서 관찰 bridge가 로드되고 `turn.step`이 cron 발화·task 알림의 턴까지 붙잡는지, SIGTERM이 같은 마감을 하는지 잰다.
  SDK·Remote Control·peer·channel origin이 같은 경로를 쓴다는 것은 코드로만 읽었다.
- **경로 A의 mod 제어 표면.** 목록과 메울 길은 [mod-control-surface.md](mod-control-surface.md)에 있다.
  그 노트 §7의 spike(plan 나가기와 모드 전환, compaction으로 잘라 내기, 합성 Read로 미디어 넣기, model 확인 경로,
  elicitation 계약, panel 없는 설정·사용량·MCP 읽기)가 남은 일이다.
- **`--await-initialize`.** 2.1.310 reprint에 이 인자가 있다([L580881](/Users/new/claude-code-bundle/2.1.310/cli.pretty.js#L580881)). `initialize` 전에 턴이 시작되는 것을 막는지는 잰다(§3.3).
- **task snapshot과 durable cron.** 다시 `initialize`한 `-p` 프로세스가 `background_tasks_changed` snapshot을 보내는지,
  durable cron이 `--resume`에서 되살아나 첫 Stop 전에도 걸려 있는지 잰다(§3.2).
- **session host 소켓 경로 길이.** Desktop의 새 helper는 긴 Unix socket 경로를 위해 descriptor와 디렉터리 상대 경로로 붙는다.
  우리 경로를 짧게 두거나 같은 대비를 한다.
- **Linux scope와 lingering.** user transient scope가 logind session cgroup과 분리되고, KillUserProcesses와 로그아웃에서
  의도대로 살아남는가.
- **macOS TCC.** 데몬 아래 claude의 파일 접근 권한이 어느 앱에 귀속되는가(Desktop처럼 MAWS 앱인가).
- **Windows.** 범위 밖으로 둘지 정한다.
- Claude Code가 업데이트될 때마다 위 측정을 다시 한다.

## 10. 조용히 정한 것

- host는 세션마다 하나다. 하나의 host가 여러 세션을 쥐면 host 하나의 고장이 모두를 끝낸다(claude-ssh는 helper 교체가
  자식 전부를 죽인다).
- host와 manager 사이도 commit 뒤에는 claude를 다시 띄우지 않는다. 결과가 불명확하면 reconcile한다.
- holderId, processEpoch, engineSessionId, bindingGeneration을 구분한다. host 자리와 프로세스·대화 id를 같게 보지 않는다.
- fence와 적용 offset은 host에 남고 정책은 manager에 둔다.
- 정리 시계는 manager 메모리에만 둔다. unknown은 정리하지 않고 descendant는 positive veto로만 쓴다. SIGKILL escalation은 없다.
- MAWS 소유의 in-flight 일은 CLI 생존과 별개다. 효과 전 durable ledger와 결과 불명 응답으로 중복 효과를 막는다.
- 끝난 세션을 다시 열 때 중단된 턴 재실행은 자동으로 켜지 않는다.

## 11. 검토하고 버린 대안

- **터미널 세션도 PTY holder가 쥐는 구조 (2026-10-22 첫 판, F7로 버림).** wrapper가 사람의 `claude`를 처음부터 우리 PTY 안에서
  띄우고, 창을 닫아도 세션이 남게 했다. 다시 붙을 때의 화면 복원(xterm headless 에뮬레이터와 parser-safe checkpoint),
  job control, TCC, 매크로까지 설계와 측정이 있다
  ([holder-tui-spike.md](holder-tui-spike.md), 이전 판은 PR #79 커밋 8a9f24261).
- **웹 터미널 창 (F5).** 같은 TUI를 xterm.js로 보여 주고 passkey 확인 뒤 키보드를 넘겨받는 창이다. raw 키 바이트가 hub를
  지나고, MAWS GUI가 모르는 두 번째 제어면이 생긴다.
- **살아 있는 터미널 세션을 pipe로 옮기기 (F7).** headless `-p`는 엔진의 인계 파일(`adopt.json`)을 읽지 않는다. 옮기면
  Monitor와 MCP 작업을 잃고, 서브에이전트의 진행 중 명령이 다시 돈다. 백그라운드 셸은 `/background` → `claude stop` 뒤의
  종료 인계 파일을 holder가 읽어 감시하는 식으로만 살릴 수 있고, 버전마다 바뀌는 내부 파일에 기댄다
  ([측정](background-work-handoff.md)).
- **브라우저의 Query (claude.ai 모양).** MAWS 소유 일이 Query와 같은 프로세스에 살고, Query는 쓰는 쪽 하나이며, SDK stdio
  전체가 믿지 않는 hub를 지나게 되므로 버렸다(§3.3).
- **엔진 `--bg` supervisor와 claude-ssh의 수명 정책.** repaint 실패의 재시작, upgrade 이주, orphan 정리, 멈춘 프로세스 교체
  정책은 live work 보존과 맞지 않는다([엔진 정책](holder-tui-spike.md#L82)).
  claude-ssh helper 교체는 옛 자식 전부를 죽인다([helper 교체](desktop-ssh-helper-protocol.md#L88)).
  전송과 adoption의 세부는 빌리되 수명 정책은 빌리지 않는다.
