# web MAWS 원격 연결 — MAWS #52 프로토콜 단계의 리서치 기반 (2026-10-19)

**무엇을 위한 문서인가.** #52의 다음 단계는 desk의 원격 프로토콜을 다시 짓는 것이다. owner의 판정은
"지연, 연결 문제, 재개가 기준 미달"이다(#52 20:06Z). 이 문서는 그 재구축과 web MAWS(charter P5)의 설계가
설 근거를 한곳에 모은다. 결정은 #52 설계의 몫이다. 여기서는 각 결정의 근거와 권고를 적는다. 독립 검토 1회 반영.

**목표 (owner, 2026-10-19).**
- **기능**: 기준은 MAWS 자신이다. MAWS는 완결된 로컬 워크스페이스 앱으로 에이전트 제품 쪽 대부분을
  이미 갖고 있다. 웹은 MAWS 렌더러가 하는 것을 최대한 그대로 한다.
- **연결성**: Claude Code Remote Control 급으로 지연이 아주 낮고 동시성이 빨라야 한다.
- **도달 범위**: 여러 기계와 여러 프로젝트를 브라우저 하나에서, 여러 기기에서 동시에 다룬다.

**근거 문서** (모두 이 디렉터리, 원본은 owner MacBook의 `~/claude-code-bundle/2.1.300/notes/`):

| 문서 | 내용 |
|---|---|
| [maws-web-porting-surface.md](maws-web-porting-surface.md) | MAWS X2 registry 전체 분류, main에 남은 기계 쪽 기능, E10 supervisor 프로토콜, desk와의 관계 (MAWS `e42e6bbd8`) |
| [desktop-ssh-helper-protocol.md](desktop-ssh-helper-protocol.md) | Claude Desktop SSH 모드의 Desktop↔`claude-ssh` 프로토콜과 내구성, #52 실패 네 가지와의 대조 |
| [remote-dev-prior-art.md](remote-dev-prior-art.md) | VS Code remote·tunnels, Zed, JetBrains, dev tunnels, Codespaces, 실시간 동기화 설계, 원칙 19개 |
| [ahp-evaluation.md](ahp-evaluation.md) | Microsoft Agent Host Protocol을 desk 프로토콜로 쓸 수 있는가 |
| [claude-ai-rc-client-protocol.md](claude-ai-rc-client-protocol.md) | claude.ai와 Desktop이 RC 세션에 쓰는 클라이언트 프로토콜 |
| [desktop-modes-main.md](desktop-modes-main.md), [desktop-modes-renderer.md](desktop-modes-renderer.md) | Desktop의 로컬·SSH·클라우드·RC 세션 차이, 구조적인가 메울 수 있는가 |
| [rc-parity-research.ko.md](rc-parity-research.ko.md) | 이전 리서치(RC 기준). 엔진 제어 표면(stdio 96종, mod)과 성능 분석은 여전히 유효하다 |

desk 설계 문서(spec)는 MAWS `48fec4bd1`의 `docs/doperpowers/specs/2026-10-15-desk-design.md`다.

---

## 0. 요약

1. **"RC급"은 스트리밍 지연에서만 맞추면 되는 기준이다. 생존 감지와 재개에서는 RC를 넘어야 한다.** RC의
   실시간 소켓은 replay가 없다. keep-alive는 50초마다 오고, 오프라인 판정은 70초 뒤에 내리며, 6번 시도한
   뒤에는 수동이다. 비교한 모든 시스템 중 가장 느리다(prior-art §6). 생존 감지 목표는 VS Code(5초/20초)와
   `claude-ssh`(7초 핑, 2번 놓치면 끊음)에 둔다.
2. **기계 쪽이 권위다.** 세션 프로세스를 소유하는 기계 쪽 데몬이 세션마다 순번(`seq`)을 매긴다.
   hub(Durable Object)는 중계와 캐시일 뿐이고, 믿지 않는 중계다. 배포마다 모든 DO가 재시작되므로 hub
   메모리에 기대는 정확성은 없어야 한다. Desktop SSH 모드, AHP, Zed collab, Figma가 모두 같은 구조다.
3. **재개는 하나의 계약으로 푼다.**
   - 재접속 시 클라이언트가 구독마다 `(session, launch epoch, seq)` cursor를 보내면 답은
     `replay | snapshot | missing` 셋 중 하나다(AHP). 이 하나로 재접속, 중간에 들어온 시청자, 배포 후
     복구가 모두 해결된다.
   - epoch가 필요한 이유: MAWS의 `seq`는 launch의 journal seq라서 launch마다 다시 시작한다(charter X13).
     epoch 없는 `lastSeenSeq`는 Resume 뒤에 엉뚱한 이벤트와 맞는다.
   - 터미널과 `--bg` 세션에는 링이 없다. 지금은 bridge 스트림에 간격이 하나만 생겨도 구독이 끝난다
     (spec:1855-1861). bridge 경로에서 seq를 매기고 링을 둘 주체로는 plane을 가진 sminos 데몬이 자연스럽다.
   - desk의 30초 resume(#52 실패 3)은 "열 때 snapshot을 기다리고, 실패하면 늘어나는 backoff로 다시 연다"는
     구조 탓이다. 그중 약 25초를 구독 열기에 돌린 것은 #52의 추론이다. 그 구간에는 타임스탬프가 없다.
4. **입력은 두 갈래로 정확히 한 번 처리한다. 나이 검사는 버리지 않는다.**
   - `claude-ssh`의 stdin offset 중복 제거가 안전한 것은 인증된 점대점 채널 안이기 때문이다. desk의 hub는
     믿지 않는 중계다. 나이 검사를 빼면, 봉인된 spawn·steer·interrupt를 잡아 두거나 붙잡은 hub가 원장
     항목이 만료된 뒤 그것을 전달할 수 있다. 원장은 항목을 하루 둔다(`sminos_rpc.py:108-109`).
   - 바이트 스트림 입력(pty, 타이핑): 인증된 채널 안에서 offset으로 중복을 없앤다. 프레임마다 나이를
     검사하지 않는다.
   - 개별 동작(spawn, steer, 중단, 답, 승인): 시간 결합을 지킨다(spec:466-470, 696-698). 요청이 아직 대기
     중이면 클라이언트가 다시 봉인해 보낸다. nonce, `created`, mac은 새로 만들고 인자와 요청 digest는
     그대로 둔다(#52 20:15Z). 그 밖의 RPC는 창이 지나면 "보내지 않음, 다시 보내기"로 보여 준다.
   - desk의 60초 창이 재전송을 `stale`로 거부한 것(#52 실패 2)은 재봉인, 죽은 소켓을 알아채는 앱 핑,
     보내지 않음 UI 셋으로 고친다. freshness를 버려서 고치는 것이 아니다(§4).
5. **죽은 연결은 수 초 안에 알아야 한다.** 매 구간에서 양방향 앱 레벨 핑을 보내고, 수신 트래픽이 있으면
   핑을 생략하며, 10–20초 안에 판정한다. 기계 쪽 링크에는 이미 hub→기계 `hb`(15초)와 `hb-ack` 임대 갱신,
   1초마다 도는 instance 탐침(`PROBE_MS`)이 있다. 빠진 것은 브라우저↔hub 앱 핑이다. desk 브라우저 소켓은
   close만 기다린다(#52 실패 4).
6. **MAWS 쪽 포팅 이음새는 작다. 어려운 것은 의미의 이음새다.**
   - 렌더러에서 `window.maws`를 읽는 제품 파일은 하나뿐이고, 렌더러 파일 중 Electron이나 Node를 import하는
     것은 없다.
   - 어려운 것은 다음이다. id와 store가 기계 하나를 가정한다. 모든 이벤트가 모든 창으로 간다. supervisor는
     클라이언트를 하나만 받는다. 기계 쪽 기능 상당수(세션 서비스, git, scm, 파일, 색인)가 Electron main에
     있다(porting §3, §6).
7. **세션을 SDK host로 소유하면 desk의 "SDK host가 아니라 bridge" binding을 뒤집는다. 엔진의 백그라운드
   supervisor(`claude --bg`, `/background`)에 맡기면 뒤집지 않아도 된다(§3.6).**
   - binding의 근거는 둘이다. 터미널이 쥘 수 있는 세션, 그리고 구독 자격 증명 위의 SDK 제품에 대한 2026년
     2월 약관이다(spec:341-349). 여러 member가 있는 org에서는 다른 사람이 owner의 구독으로 엔진을 몰게
     된다. 이것이 약관에 더 가까워진다는 것은 추론이다.
   - `--bg` 세션은 엔진 supervisor가 소유하는 평범한 REPL이라 두 근거를 모두 지킨다. 대가는 제어 폭이다.
     권한 모드 전환, rewind, MCP toggle, 일반 dialog는 프로그램으로 할 수 없고 웹 터미널(`claude attach`
     중계)로 한다.
   - 권고는 웹이 다루는 세션의 기본 경로를 `--bg`로 두는 것이다. owner가 정한다(§7 첫 행).
8. **기계 쪽 끝점: 세션 프로세스는 엔진 supervisor가, 세션 밖의 MAWS 기계 쪽 서비스는 MAWS의 headless
   데몬이 맡는다.**
   - headless 데몬이 main의 기계 쪽 서비스(산출물과 Yjs, 라이브러리, git·scm, 파일, 설정)를 흡수하고,
     Electron 앱은 그 데몬의 클라이언트 중 하나가 된다. 이것은 `claude-ssh`와 VS Code Server가 택한
     분할이다. 웹은 hub를 거쳐 같은 데몬에 붙는다.
   - E10 supervisor를 WAN용으로 키우는 일(§3.4)은 MAWS 앱이 소유한 SDK 세션을 웹에 내줄 때만 필요하다.
   - 데몬은 Electron에 기대지 않는 일반 Node 빌드여야 한다. headless 기계와 Linux에서도 돌아야 하기 때문이다.
   - uplink와 신뢰 경계는 sminos에 두고, MAWS 데몬은 그 뒤의 로컬 클라이언트로 붙이는 것이 기본 권고다.
     MAWS가 없는 Linux와 devcloud 기계도 닿아야 한다. 로컬 홉의 비용을 재서, 문제가 되면 크로스플랫폼
     데몬 하나가 두 역할을 흡수한다(§3.3).
9. **신뢰 설계는 지금 정해야 하는 1차 결정이다.** hub는 프레임을 주입하거나 바꿀 수 있다. X2 표면을
   실으면 실행 등급 명령(`pty.write`, `scm.push`, `plugins.install`, bash)과 Yjs가 hub를 지난다. member별
   principal, 등급별 봉인 방식, `clientId`를 묶는 곳, 표시 스트림의 무결성에 따라 선의 모양이 달라진다.
   hub가 내려주는 JS 안의 키는 E2E가 아니라는 한계도 그대로다(§3.5).
10. **AHP는 메커니즘만 가져오고 프로토콜은 채택하지 않는다.**
    - 연결 계약(재접속, write-ahead 조정, 구독별 credit)은 거의 그대로 쓴다.
    - 어휘는 MAWS의 X2/X1로 유지한다. MAWS의 절반(Yjs 산출물, 브라우저, 라이브러리, connector, 원시 엔진
      이벤트)이 AHP 모델 밖에 있다.
    - AHP 자체가 아직 미성숙하다. 4개월에 걸친 10번의 릴리스 대부분이 breaking change였다.
    - VS Code와 연동하는 AHP facade는 나중에 붙일 수 있다(AHP §5).
11. **hub 저장은 owner 결정을 피할 수 없다.**
    - hub에 꼬리가 없으면 시청자가 열거나 재접속할 때마다 기계까지 왕복한다. 배포 한 번이면 모든 브라우저가
      모든 기계에서 다시 받는다.
    - owner의 기계는 잠드는 MacBook이다. 덮개를 닫은 채 보는 것은 주된 시나리오다.
    - 그래서 시청자가 많을 때 RC급 열기와 재접속은 hub 쪽 상태를 가리킨다(AHP §3.3). 이것은 "hub는
      transcript를 저장하지 않는다" binding(spec:446-449)과 부딪친다.
    - 권고: spec이 허용하는 메모리 재접속 버퍼를 먼저 잰다. owner가 hub의 암호문 저장을 받아들이면
      세션별 암호화 꼬리를 목표로 둔다(§4 끝).

---

## 1. 목표를 숫자로

#52의 benchmark는 binary의 RC와 claude.ai를 기준으로 삼는다고 이미 정했다(#52 20:06Z). 아래는 그
benchmark에 넣을 항목과, 선행 사례에서 온 하한이다. 숫자는 측정해서 확정한다. 근거가 약한 것은
그렇다고 적었다.

| 항목 | 기준 | 근거 |
|---|---|---|
| 토큰 델타: 엔진 → 브라우저 화면 | RC 이하 (benchmark로 측정) | 생산자 쪽 묶음 16–33 ms. MAWS는 이미 `session.eventBatch`를 16 ms로 묶는다(porting §2) |
| 키 입력 계열 (pty, typeahead) | 양방향 스트림 위에서 왕복 1회 | VS Code는 터미널 출력을 5 ms로 묶는다. Mosh 로컬 에코의 중앙값은 5 ms 미만이다(prior-art §6) |
| 죽은 연결 감지 | ≤ 20 s, 깨어날 때와 네트워크 변경 때는 즉시 탐침 | VS Code 5 s / 20 s, `claude-ssh` 최악 약 18 s, Zed collab 10 s |
| 재접속 후 이어 보기 | 왕복 1회 + 놓친 구간 replay. snapshot 재요청 없음 | AHP `reconnect`, `claude-ssh` `process.reattach{fromSeq}` |
| 세션 열기 → 첫 행 | ≤ 1.5 s (desk 자체 예산, #57) | 지금은 약 5 s |
| Resume 클릭 → 세션 표시 | 엔진 시작(약 2.5 s) + 왕복 1회 | 지금 약 30 s. #52는 그중 약 25 s를 구독 열기에 돌렸지만, 그 구간에는 타임스탬프가 없어 추론이다 |
| 시청자 N명일 때 기계 부하 | 시청자 수와 무관. fan-out뿐 아니라 열기와 재접속도 hub가 답한다 | 세션당 한 스트림, 시청자마다 별도 cursor. 열기와 재접속이 기계에 닿지 않으려면 hub 쪽 상태가 필요하다(§4 끝) |
| 기계가 잠든 동안 열람 | 최근 구간을 볼 수 있다 (owner 결정) | owner의 기계는 잠드는 MacBook이다. 지금은 기계가 꺼지면 깊이 정보를 볼 수 없다(rc-parity §0 4번) |
| 프레임 크기 | 모든 구간에서 1 MiB 미만, 프로토콜 층에서 분할 | vscode.dev/agents는 1.05 MB snapshot 하나 때문에 재접속을 무한 반복했다(vscode#335232) |

---

## 2. 무엇이 네트워크를 건너는가 (MAWS 쪽)

[porting §1–2](maws-web-porting-surface.md#L39)의 요약이다.

- **규모.** 명령 365개와 이벤트 77개가 25개 namespace에 있다.
  - 소유자별: main 186, engine host 169, pty host 10.
  - 렌더러에 열린 것 331개, main 전용 34개.
  - 기계에 묶인 것 약 305, 클라이언트에 묶인 것 약 38, 어느 쪽이든 되는 것 약 22.
- **키 입력 지연 계열은 작다.**
  - pty: `pty.data`가 offset을 단 바이너리 조각으로 내려오고, `pty.write`/`ack`/`resize`가 올라간다.
  - transcript: `session.eventBatch`.
  - 문서: Yjs 프레임. registry 밖으로 다닌다.
  - mod 표면: `session.ui.input`/`scroll`.
  - typeahead 읽기: `git.lsFiles`, `library.list` 등.
  - 나머지 사람의 동작(보내기, steer, 답, 중단, scm, 산출물)은 클릭 지연 계열이다.
- **WAN에서 바로 문제가 되는 모양.**
  - 전체 상태를 다시 보내는 push가 있다(`attention.changed`, `browser.tabs.changed`, `session.queue`,
    `session.catalogChanged`). 델타로 바꿔야 한다.
  - 크기 제한이 없는 읽기가 있다(`session.events`, `files.read`, `fs.readSpill`, `pty.attach`).
  - event batch는 최대 16 MiB이고 그 안에 base64 스크린샷이 들어간다. 참조로 받아오게 바꿔야 한다.
    desk hub의 프레임 한도는 1 MiB다.
  - 모든 이벤트가 모든 창으로 간다(`src/main/ipc/events.ts:14`). 클라이언트별 구독과 필터가 없다.
- **클라이언트에 묶인 것** (브라우저 대체품이 필요하거나 빠지는 것): 네이티브 다이얼로그와 메뉴, 종료 가드,
  Electron 알림, 음성 helper, 드롭한 파일의 기계 경로(업로드로 바뀐다), `maws-artifact:` scheme(기계별 HTTP
  origin으로 바뀐다), 앱 안 브라우저(화면 스트림이나 메타데이터만 보여 주는 쪽으로 바뀐다), OAuth 동의(지금은
  기계에서 열리고 127.0.0.1로 돌아온다).

---

## 3. 기계 쪽 끝점

### 3.1 지금 한 기계 위의 두 경로

- **MAWS 경로**: Electron main이 E10 detached supervisor에 Unix socket으로 붙는다. supervisor가 엔진
  프로세스를 소유한다.
- **desk 경로**: sminos 데몬(Python)이 hub에 uplink(SSE 아래, POST 위)로 붙는다. 세션 안의 bridge mod가
  권한 경합, steer, 스트리밍을 맡는다.
- **겹치는 곳.** MAWS 세션은 `SMNS_MEMBER`를 갖고 사용자 플러그인을 로드하므로 bridge mod가 그 안에서도
  돈다(porting §5). 그래서 같은 프로세스에 통제자가 둘 생긴다. 다음 충돌은 두 설계를 읽고 추론한 것이고,
  실행해 보지는 않았다.
  - desk의 send나 steer가 MAWS 큐와 전달 추적을 우회한다.
  - 권한 답이 stdio(MAWS)와 hook(desk) 사이에서 경합한다.
  - bridge가 요청마다 model을 바꿔서 MAWS의 `setModel`과 어긋난다.
  - desk Resume이 MAWS가 쥔 세션의 두 번째 소유자를 만든다.

### 3.2 권고: supervisor를 headless 기계 데몬으로 키운다

> 2026-10-19 갱신: 세션 프로세스의 소유는 §3.6의 `--bg` 경로를 기본으로 권한다. 이 절에서 그대로 남는
> 것은 세션 밖의 기계 쪽 서비스(산출물과 Yjs, 라이브러리, git·scm, 파일, 설정)를 맡을 headless 데몬이다.
> 세션을 소유하는 engine host의 WAN 강화(§3.4)는 MAWS 앱이 소유한 SDK 세션을 웹에 내줄 때만 필요하다.

- **분할.** 기계 쪽 데몬이 프로세스와 기계 쪽 기능을 소유하고, 클라이언트는 교체할 수 있게 한다.
  Electron 앱은 로컬 클라이언트 중 하나가 되고, 웹은 hub를 거친 원격 클라이언트가 된다.
  - `claude-ssh`: 프로세스를 소유하고, 끊기면 checkpoint부터 재입양한다.
  - VS Code Server: workspace 쪽 extension host를 원격에 두고 UI 쪽만 클라이언트에 둔다.
- **런타임.** 데몬은 Electron에 기대지 않는 일반 Node 빌드여야 한다. headless 기계와 Linux가 어차피 그것을
  요구한다. 지금 supervisor는 Electron 바이너리 아래 Node로 돌고(`src/engine-host/detached.ts:1-3`), MAWS
  빌드는 mac arm64뿐이다(`electron-builder.yml`).
- **데몬이 흡수해야 할 main의 기계 쪽 기능** (porting §3):
  - SQLite 세션 색인과 read model. engine host가 세션 id를 묶을 때 여기에 의존한다.
  - 세션 서비스: launch, fork, acquire, take-over, delete.
  - attention, owner channel, mods.
  - git과 scm(사용자 자격 증명으로 push와 PR).
  - 파일, 라이브러리 색인, connector broker.
  - 설정.
- **생명주기.**
  - macOS에서는 launchd, Linux에서는 systemd가 데몬을 소유한다. sminos 데몬이 이미 그렇게 하고 Ubuntu에서
    검증됐다(spec:179-181).
  - pty host는 앱보다 오래 살아야 한다. 지금은 Electron utility process라서 앱과 함께 죽는다.
  - 원격 클라이언트도 idle 종료 계산에 넣어야 한다. 지금은 클라이언트가 없고 세션도 없으면 10분 뒤 끝나고,
    클라이언트가 없는 동안에는 idle 세션을 멈추고 이벤트를 버린다.
- **Chromium이 기계에 필요한 것.** 산출물 export와 캡처 렌더러, `maws-artifact:` scheme, 에이전트가 모는
  브라우저 탭. 캡처는 에이전트 자신의 도구(`artifact_screenshot`)이므로, 헤드리스 기계에서는 UI만이 아니라
  도구 자체가 깨진다. 데몬에서는 이 기능들(캡처, export)을 선택 사항으로 두거나 headless Chromium으로 돌린다.
- **통제자는 프로세스당 하나.** MAWS가 소유한 세션에서는 bridge mod가 관찰만 하거나 MAWS에 위임한다.
  MAWS가 세션을 소유하는 것은 SDK host 경로이므로 §7 첫 행의 owner 재결정에 달려 있다.
  터미널 세션은 지금처럼 mod가 손님으로 붙는 경로로 남는다. 터미널 세션의 제어 폭은 mod가 한도다
  (rc-parity §3.3). 파일, git, worktree, 셸은 데몬이 주므로 터미널 세션에도 줄 수 있다.

### 3.3 기계당 연결 하나

- 기계의 등록, 신원, "기계가 결정한다" 신뢰 모델은 desk의 설계를 그대로 쓴다.
- 기계마다 바깥으로 나가는 연결 하나를 두고, 그 위에서 desk 트래픽과 MAWS 데몬 트래픽을 채널로 나눈다.
- **그 연결을 어느 프로세스가 쥘지는 신뢰 경계를 어느 프로세스에 둘지와 같은 결정이다. 이것을 먼저 정한다.**
  - 지금 봉인 검증, nonce 원장, 읽기 전용 모드, 권한 상한은 Python sminos에 있다(`sminos_rpc.py`,
    `sminos_policy`).
  - MAWS가 없는 Linux와 devcloud 기계도 계속 닿아야 한다.
  - **기본 권고**: sminos가 uplink와 신뢰 경계로 남고, MAWS 기계 데몬은 그 뒤의 로컬 클라이언트로 붙는다.
    로컬 홉(소켓 하나와 직렬화 한 번)의 비용을 잰다.
  - **대안이 나아지는 조건**: 측정에서 그 홉이 문제가 되면, Electron에 기대지 않는 크로스플랫폼 기계 데몬
    하나가 두 역할을 흡수한다. 고빈도 트래픽(pty, 델타, Yjs)은 전부 MAWS 쪽이라 홉이 빠지는 이득이 그쪽에
    몰린다. 이때도 봉인 검증, 원장, 정책을 함께 옮겨 신뢰 경계를 하나로 유지한다.
- **hub 쪽 객체 토폴로지도 함께 정한다.**
  - 기계 소켓을 어느 객체가 끝내는가. 브라우저가 세션 스트림을 위해 그 객체에 직접 붙는가.
  - 프레임마다 DO 왕복 한 번이 세션 plane의 한계였다(M5 측정, `machine.ts:289-290`). 프레임이 객체를
    여러 번 건너는 토폴로지는 그 한계를 다시 부른다.
  - 객체 하나의 처리량은 초당 요청 약 1,000개가 soft limit이다. Cloudflare 문서의 수치이고 재지 않았다.
  - 객체의 위치는 만들 때 정해진다.
  - 트래픽이 끊이지 않으면 hibernation을 잃는다. 활성 세션은 계속 과금된다.
  - 활성 세션당 비용 모델(요청 수, 지속 시간)을 세운다.
  - 구간별 지연과 처리량은 §8 스파이크 3에서 잰다.

### 3.4 E10 supervisor 프로토콜에서 지킬 것과 더할 것

- **지킬 것** (porting §4):
  - envelope과 `hello` 안정성 약속;
  - 시작 중에 온 요청을 잡아 두었다가 보내는 것;
  - `ready` 장벽;
  - id로 중복을 없애는 계약;
  - 아직 받지 못한 이벤트의 burst;
  - 세션별 seq와 5,000개 링;
  - 문서 프레임 구성.
- **더할 것.** 이 목록이 그대로 §4의 연결 계약이다.
  - 로컬 토큰을 넘는 인증과 권한 등급(§3.5);
  - 여러 동시 클라이언트와 fan-out;
  - 클라이언트별 구독과 cursor. seq가 launch마다 다시 시작하므로 cursor에 launch epoch를 넣는다;
  - 세션 이벤트가 아닌 것의 재생;
  - backpressure(지금은 256 MiB 뒤처진 클라이언트를 닫는 것뿐이라 큰 batch가 키 입력을 막는다);
  - 핑과 취소;
  - 정확히 일치하는 fingerprint 대신 호환 창.

### 3.5 신뢰 설계: hub는 믿지 않는 중계다 (1차 결정)

- **지금.** spec은 실행을 일으킬 수 있는 것을 hub가 갖지 않은 키로 인증한다(spec:670-705). 코드를 다는
  것은 RPC와 그 정산, 로그 이벤트이고, 공유 org 키의 HMAC-SHA256이다. 표시 스트림(transcript, 스트림,
  diff)은 코드 없이 중계된다. 승인만 화면에 그린 요청의 digest로 묶인다.
- **바뀌는 것.** web MAWS가 X2 표면을 실으면 실행 등급 명령(`pty.write`, `scm.push`, `plugins.install`,
  bash)과 Yjs 프레임이 hub를 지난다. 중계는 프레임을 주입하거나 바꿀 수 있다. 선의 모양이 아래 결정에
  달려 있으므로 프로토콜보다 먼저 정한다.
  - **principal.** 공유 org 키 대신 member별 principal을 두고 기계가 검증한다(#52 21:01Z). spec도 org
    단계에서 member별 비대칭 키와 admin이 서명한 member 목록으로 옮긴다고 적었다(spec:670-705).
  - **등급별 봉인.** 고빈도 스트림(pty, Yjs, 델타)은 채널 단위로 인증한다. 개별 실행 등급 동작은 요청마다
    봉인하고 passkey step-up을 받는다.
  - **`clientId`를 묶는 곳.** 재접속과 echo 확인이 `clientId`에 기댄다. hub 가장자리에서 묶으면 hub가 바꿀
    수 있다. principal에 묶고 기계가 확인하는 것을 권한다.
  - **표시 스트림의 무결성.** 사람은 hub가 중계한 transcript와 diff를 보고 승인한다. digest는 요청을
    묶지만, 판단의 근거가 된 맥락은 묶지 않는다. 표시 스트림에도 채널 인증을 둘지 정한다.
  - **hub가 내려주는 JS.** 같은 Worker가 웹앱을 내려주므로, hub를 배포할 수 있는 사람은 키를 빼돌리는 JS를
    내보낼 수 있다. 브라우저 쪽 키는 E2E가 아니다(rc-parity §0 4번, §5.2). 위 모든 봉인이 이 한계 안에 있다.
    넘으려면 웹 코드를 따로 통제되는 출처에서 받아야 한다.
  - **기계 쪽 암호.** member별 비대칭 서명은 기계에 암호 라이브러리가 필요하다. stdlib Python 데몬에는
    없다(rc-parity §5.2). 신뢰 경계를 어느 프로세스에 둘지(§3.3)와 엮인다.

### 3.6 세션 소유의 다른 길: 엔진의 백그라운드 supervisor (`claude --bg`, `/background`)

(2026-10-19 owner 제안을 검토한 것. 출처: SPEC 38 §38.1–38.14, SPEC 20 §20.15, 2.1.300 소스, mod API d.ts)

- **무엇인가.**
  - `claude --bg`, `claude agents`, `/background`가 만든 세션은 엔진 자신의 supervisor(`claude daemon run`)가
    소유한다(SPEC38 §38.1).
  - 세션마다 `claude --bg-pty-host` 프로세스가 PTY를 쥐고, 그 PTY 안에서 평범한 interactive REPL이
    돈다(cli:1147604). stream-json 세션이 아니다.
  - supervisor는 Unix socket `control.sock`(op 18개, proto 1)으로 목록, 상태, `reply`, `subscribe`,
    `attach`, `kill`을 내준다. 같은 uid와 `~/.claude/daemon/control.key`로 인증한다(§38.11).
  - `/background`는 프로세스를 옮기지 않는다. transcript를 flush하고, `--resume <transcript>
    --fork-session`으로 새 job을 띄운 뒤 터미널 쪽 세션을 끝낸다(cli:810555-810604). 엔진 자신의
    resume handoff다.
- **엔진이 이미 해 주는 내구성.**
  - supervisor가 재시작해도 살아 있는 PTY host를 재입양한다(§38.7.2).
  - 바이너리가 바뀌면 supervisor가 스스로 재시작하고, job을 새 버전으로 다시 띄운다(§38.7.5).
  - 프로세스가 죽으면 transcript로 다시 띄우고 끊긴 턴을 이어 간다(`CLAUDE_CODE_RESUME_INTERRUPTED_TURN`,
    SPEC20 §20.15).
  - 아무 터미널에서나 `claude attach <short>`로 붙을 수 있다. 여러 attacher가 동시에 붙는다(§38.13.3,
    Windows 제외).
- **desk는 이미 이 길을 쓴다.** 웹의 Spawn은 `claude --bg`, Resume은 `claude --bg --resume`이다
  (spec:599-601). 제어는 세션 안의 bridge mod가 하고, `control.sock`은 bridge가 없을 때의 fallback이다
  (spec:604-611). 제안은 이 길을 웹이 다루는 세션 전체의 기본 경로로 삼는 것이다.

| | `--bg` + bridge mod | stdio SDK host (MAWS engine host) |
|---|---|---|
| 프로세스 소유 | 엔진 supervisor | 우리 데몬 |
| 터미널이 쥘 수 있는가 | 예 (`claude attach`, `/background`) | 아니오 (멈추고 resume으로 넘길 때만) |
| spec의 "SDK host가 아니라 bridge" binding (spec:341-349) | 지킨다 | 뒤집는다 |
| 내구성 | 엔진이 유지한다 (재입양, 업그레이드 respawn, 끊긴 턴 재개) | 우리가 만들어야 한다 |
| 제어 폭 | mod API + slash 명령 + TUI 키 입력 | stdio 제어 요청 96종 |
| 화면에 그릴 데이터 | transcript 행 + `turn.step` 조각 (desk-web이 이미 그린다) | stream-json (MAWS X1 렌더러) |

- **`--bg` 경로에서 프로그램으로 할 수 없는 것.** mod API(dts)에 해당 기능이 없다.
  - 권한 모드를 마음대로 바꾸기. `/plan`과, 권한 답에 실은 `setMode`만 된다.
  - 대화 rewind와 파일 rewind. TUI의 picker로만 된다. 파일 쪽은 세션을 멈춘 뒤 `claude --resume <id>
    --rewind-files <message>`를 한 번 실행하는 길이 있어 보인다(cli:906312, 미검증).
  - 다른 MCP 서버의 toggle과 reconnect. `$.mcp.connect`는 플러그인이 자기 manifest에 둔 서버만
    다룬다(dts:2746-2785).
  - 일반 dialog(`request_user_dialog`)와 엔진의 `ui_*` 원격 표면(MAWS D-9의 R2).
  - `!` 셸. 확인하지 않았다.
  - 읽기는 대부분 된다: `$.settings.read`, `$.session.model`, usage. diff, 파일, export는 데몬이
    파일에서 답한다. MAWS의 SDK MCP 서버 `maws`(X9 도구)는 데몬이 띄우는 일반 MCP 서버로 옮길 수 있다(추론).
- **남는 빈 곳은 웹 터미널로 메운다.** 데몬이 자기 PTY 안에서 `claude attach <short>`를 돌리고 그 바이트를
  웹의 터미널로 중계하면, TUI가 할 수 있는 것은 전부 웹에서 된다. rewind picker, `/permissions`, `/mcp`도
  포함된다. Arkho A6 설계가 이 방식이다(spec:205). 내부 `control.sock`의 `attach`를 직접 말하는 것보다
  공개 CLI 동사를 쓰는 편이 엔진 버전이 바뀔 때 덜 깨진다.
- **우리가 만든 supervisor로 엔진의 supervisor를 대체하는 것은 권하지 않는다.**
  - CLI가 붙는 socket 경로는 설정으로 바꿀 수 없다. `/tmp/cc-daemon-<uid>/<sha256(config 디렉터리) 앞
    8자>/control.sock`으로 계산된다(cli:876523).
  - 대체하려면 `daemon.lock`, op 18개, rendezvous socket, PTY frame codec, roster, 재입양을 다시 만들어야
    한다. 전부 공개되지 않은 내부 프로토콜이고 릴리스마다 바뀔 수 있다.
  - CLI 쪽은 응답하지 않는 lock holder에 SIGTERM을 보내고(§38.14.3), 버전이 낮은 transient 데몬을
    은퇴시킨다(§38.14.4).
  - 대체해도 제어 폭은 늘지 않는다. 안에서 도는 것은 여전히 REPL이다.
- **정당하게 손댈 수 있는 곳.**
  - 생명주기: 데몬이 `claude daemon run`을 띄운다(origin `foreground`는 idle로 끝나지 않고 밀려나지
    않는다, §38.3). 아니면 지금처럼 `claude --bg`가 필요할 때 띄우게 둔다.
  - 세션 시작: 설정 `processWrapper`(`CLAUDE_CODE_PROCESS_WRAPPER`)는 supervisor와 그 세션들을 감싸는
    launcher다(cli:125354). launcher는 env와 플래그를 더한 뒤 claude로 `exec`해야 하고, 설정이 깨지면
    세션이 시작을 거부한다(SPEC01 §7.3). 모든 세션 시작에 우리 코드를 끼울 수 있는 공식 지점이지만,
    지금 필요한 일(플러그인 로드, `SMNS_MEMBER`)은 사용자 플러그인과 데몬의 spawn으로 이미 된다.
- **권고 (owner 결정 대상).**
  - 웹이 다루는 세션의 기본 경로를 `--bg` + bridge mod로 둔다. 그러면 §7 첫 행의 binding은 뒤집지 않아도
    된다.
  - 프로그램으로 안 되는 조작은 웹 터미널에서 한다. mod API가 넓어지면 GUI로 옮긴다.
  - stdio SDK 경로는 MAWS 앱의 로컬 세션에 남긴다. 한 세션은 한 번에 한 경로에만 있고, 경로를 옮길 때는
    엔진의 resume handoff를 쓴다(idle까지 대기, SIGTERM, 레지스트리 파일이 사라지면 `--resume`;
    rc-parity §3.4).
- **이 권고가 바꾸는 것.**
  - 세션 프로세스는 엔진 supervisor가 소유하고, 그 옆의 sminos 데몬이 bridge, uplink, 신뢰 경계, 세션별 seq와
    링을 맡는다. §3.3의 기본 권고와 같은 모양이다.
  - §3.2의 headless 데몬은 세션 밖의 MAWS 기계 쪽 서비스만 맡는다.
  - E10 supervisor의 WAN 강화(§3.4)는 MAWS 앱이 소유한 SDK 세션을 웹에 내줄 때만 필요하다.
- **확인할 것.**
  - `$.command.run('/background')`로 웹에서 터미널 세션을 background로 넘길 수 있는가. `/background`는
    확인 dialog를 띄운다.
  - `--rewind-files` 일회 실행.
  - `claude attach` 중계의 키 입력 지연.
  - API key만 있는 기계에서 `--bg`. owner의 기계에서는 gateway 뒤에서 이미 돈다.

---

## 4. 연결 계약 (선행 사례가 수렴하는 지점)

근거 강도는 prior-art §7을 따른다: [강] 여러 독립 시스템이 수렴했거나 운영 실패가 보여 준 것, [중] 한
강한 시스템이나 문서화된 이유, [약] 인접 증거에서 추론한 것. #5와 #15는 hub를 믿지 않는다는 desk의 전제
때문에 선행 사례와 모양이 다르다.

| # | 메커니즘 | 출처 | 강도 |
|---|---|---|---|
| 1 | **기계가 세션별 `(launch epoch, seq)`를 매긴다.** DO가 그 값을 바꾸지 않고 전한다. MAWS 세션은 데몬이, 링이 없는 터미널·`--bg` 세션은 plane을 가진 sminos 데몬이 매기고 링을 둔다 | AHP `serverSeq`, `claude-ssh` 프로세스별 `seq`, Linear `lastSyncId`. charter X13(seq는 launch마다 다시 시작), spec:1855-1861 | 강 |
| 2 | **세션당 로그 하나, 모든 항목에 출처 id, 시청자마다 cursor.** 한 시청자의 도착·지연·이탈이 다른 시청자를 바꾸지 않는다 | AHP `origin.clientId`. 반례: VS Code는 새 클라이언트가 붙으면 모두의 유예가 5분으로 줄어든다 | 강 |
| 3 | **재접속은 `{(session, launch epoch, seq)}` → `replay \| snapshot \| missing`.** epoch가 다르면 snapshot이다. "새로고침해서 이어가기"는 없다 | AHP lifecycle §Reconnection | 강 |
| 4 | **replay 버퍼는 바이트로 상한을 두고, 넘치면 snapshot으로.** snapshot은 토큰 로그가 아니라 상태다(확정된 transcript + 진행 중인 메시지를 한 번에) | dev tunnels 채널당 1 MB, Cloudflare Agents SDK의 진행 중 버퍼 | 중 / 강 |
| 5 | **입력은 두 갈래로 정확히 한 번.** 바이트 스트림(pty, 타이핑)은 인증된 채널 안에서 offset으로 중복을 없애고 프레임별 나이 검사를 하지 않는다. 개별 동작(spawn, steer, 중단, 답, 승인)은 시간 결합을 지키고, 대기 중이면 클라이언트가 다시 봉인해 보낸다. 확인은 echo가 한다 | `claude-ssh` stdin offset + `duplicate`(인증된 점대점 채널), AHP pending actions, claude.ai 영속 outbox; spec:466-470, 696-698 | 강 |
| 6 | **대기 중 프롬프트는 재접속 때 다시 뜬다.** CLI가 `initialize` 응답의 `pending_permission_requests`로 다시 보내고, 같은 `request_id`는 한 번만 처리한다. 먼저 답한 쪽이 이긴다 | cli:77939, `claude-ssh` §3.6 | 강 |
| 7 | **모든 구간에서 양방향 앱 핑을 보내고 10–20 s 안에 판정.** 수신 트래픽이 있으면 생략한다. DO는 auto-response로 핑에 답한다. 멈춘 event loop나 throttle된 배경 탭을 네트워크 탓으로 돌리지 않는다 | VS Code 5/20 s와 멈춤 가드, `claude-ssh` 7 s·2 misses·SRTT 적응 | 강 |
| 8 | **"기계 오프라인"과 "중계 오프라인"을 따로 보여 준다.** 생존은 끝에서 끝까지 잰다 | 여러 사례 | 강 |
| 9 | **재개 창 내내 다시 시도한다.** 서버가 명시적으로 판정한 경우만 영구 실패다. 시도마다 끝점을 다시 찾고, jitter를 넣고, `online`이나 탭 focus에서 즉시 시도한다. 사람의 동작은 backoff를 초기화한다 | VS Code의 실패 사례(remote-release#11805), `claude-ssh` | 강 |
| 10 | **배포 때마다 재접속이 몰린다고 가정한다.** DO 상태는 데몬에서 다시 만들 수 있어야 한다 | Cloudflare | 중 |
| 11 | **제어 트래픽이 토큰 홍수 뒤에 줄 서지 않는다.** 시청자별 흐름 제어를 두고, 뒤처진 시청자는 snapshot으로 내린다 | VS Code pty 100k/5k, AHP windowed delivery | 중 |
| 12 | **생산자 쪽에서 묶는다.** DO는 프레임을 바꾸지 않고 전한다 | Figma 33 ms, MAWS 16 ms | 중 |
| 13 | **프레임은 1 MB보다 한참 작게, 분할은 처음부터 프로토콜에.** 상태를 통째로 보내는 응답에도 상한을 둔다 | vscode#335232, AHP RFC #138 | 강 |
| 14 | **압축은 메시지 단위로 하거나 하지 않는다.** 상태를 갖는 permessage-deflate는 쓰지 않는다 | Zed zstd per message | 중 |
| 15 | **중계는 프레임을 주입하거나 바꿀 수 있다고 가정한다.** 실행을 일으키는 모든 것은 hub가 갖지 않은 키로 인증한다. 재접속 토큰은 세션 비밀을 가졌음을 증명하고, `clientId`는 principal에 묶어 기계가 확인한다. 1차 결정이다(§3.5) | spec:670-705(binding), AHP #259(재접속 탈취), #268(평문 bearer) | 강 |
| 16 | **화면은 로컬에서 그리고 입력도 로컬에서 받는다. 보내는 것은 화면이 아니라 의미다** | JetBrains Projector 포기 | 강 |

**입력의 두 갈래 (#5).**
- **왜 나이 검사를 버리면 안 되는가.** `claude-ssh`의 offset 중복 제거가 나이와 무관하게 안전한 것은 인증된
  점대점 채널 안이기 때문이다. desk의 hub는 믿지 않는 중계다. 나이 검사를 빼면, 봉인된 spawn·steer·interrupt를
  잡아 두거나 붙잡은 hub가 원장 항목이 만료된 뒤에 그것을 전달할 수 있다. 지금 창은 60초, 원장 보존은 하루다
  (`FRESH_S = 60`, `KEPT_S = 86400`, `sminos_rpc.py:108-109`). spec도 시간 결합을 binding으로 둔다. 중단,
  승인, 답은 "그것을 준 순간에 대해서만 의미가 있고", 나중에 실행되려고 기다리는 것은 없다(spec:466-470,
  696-698).
- **바이트 스트림 입력**(pty, 타이핑): 인증된 채널 안에서 offset으로 중복을 없앤다. 프레임마다 나이를 검사하지
  않는다. 재전송 방지는 채널 인증이 맡는다.
- **개별 동작**(spawn, steer, 중단, 답, 승인): 시간 결합을 지킨다. 요청이 아직 대기 중이면 클라이언트가 다시
  봉인해 보낸다. nonce, `created`, mac은 새로 만들고, 인자와 요청 digest는 그대로 둔다(#52 20:15Z의 규칙).
  그 밖의 RPC는 창이 지나면 "보내지 않음, 다시 보내기"로 보여 준다. 벽시계 대신 기계가 발급한 epoch나
  challenge로 시간 결합을 할 수도 있다.
- **원장 보존 ≥ 수용 창.** 창을 늘리거나 epoch로 바꿀 때도 이 조건을 지킨다.
- **60초 늦은 실패(#52 실패 2)를 고치는 것**은 셋이다: 재봉인, 죽은 소켓을 알아채는 앱 핑(#7), 보내지 않음
  UI. freshness를 버리는 것이 아니다.

**hub 저장과의 관계.**
- 1·3·4는 hub가 transcript를 저장하지 않아도 정확하게 성립한다. replay의 원천을 기계의 세션별 링과 JSONL로
  두면 된다. 하지만 그것만으로는 RC급이 아니다.
  - hub에 꼬리가 없으면 시청자가 열거나 재접속할 때마다 기계까지 왕복한다. 배포 한 번이면 모든 브라우저가
    모든 기계에서 다시 받는다.
  - owner의 기계는 잠드는 MacBook이다. 덮개를 닫은 채 보는 것은 주된 시나리오다.
- 그래서 시청자가 많을 때 RC급 열기와 재접속은 hub 쪽 상태를 가리킨다. AHP 평가도 RC급 열기와 재접속에는
  caching proxy(형태 B)가 필요하다고 본다(AHP §3.3). 이것은 "hub는 transcript를 저장하지 않는다" binding과
  부딪친다. spec이 허용하는 것은 메모리의 재접속 버퍼까지다(spec:446-449). owner 결정을 피할 수 없다.
- 선택지:
  - (a) spec의 메모리 재접속 버퍼. 배포 때 사라진다.
  - (b) 세션마다 바이트 상한을 둔 암호화된 꼬리를 DO SQLite에 둔다. hub는 읽지 못하는 암호문을 저장한다.
    진짜 E2E가 되려면 웹 코드도 따로 통제되는 출처에서 받아야 한다(§3.5).
  - (c) 완전한 caching proxy(AHP 형태 B). hub가 읽을 수 있는 세션 상태를 갖는다.
- 권고: (a)를 먼저 잰다. owner가 hub의 암호문 저장을 받아들이면 (b)를 목표로 둔다.

---

## 5. 지금 desk와의 격차

desk 쪽 사실은 MAWS master(`48fec4bd1`)의 코드와 #52의 진단(20:15Z)에서 확인한 것만 적는다.

| 메커니즘 (§4) | desk 지금 | 근거 |
|---|---|---|
| 기계↔hub 양방향 단일 스트림 | SSE 아래 + POST 위. POST 하나가 60 s 동안 온전한 답을 못 받아 uplink가 끊긴 적이 있다. POST는 각 프로젝트가 내야 할 답이 모두 스트림에 써진 뒤에야 답하므로, 그 기다림에는 DO 사이의 await가 들어 있다. 전송만 바꿔서는 이것이 없어지지 않는다 | `apps/desk-hub/src/objects/machine.ts:234, 236-245`; #52 20:06Z |
| 앱 핑과 빠른 판정 (#7) | 기계 링크: hub→기계 `hb` 프레임 15 s, 기계의 `hb-ack`가 임대를 갱신한다. 스트림을 쥔 instance는 1 s마다 자신이 아직 현재 instance인지 묻는다(`PROBE_MS`). 빠진 것은 브라우저↔hub 앱 핑이다. 브라우저 소켓은 close를 받아야 다시 붙는다 | `machine.ts:17, 71, 209, 348`; `apps/desk-web/src/hub/socket.ts:102` |
| 세션 스트림의 cursor 재개 (#3) | 열 때마다 기계 쪽에서 snapshot을 기다린다(최대 5 s 대기, 5 s 재시도, 20 s 상한). 실패하면 늘어나는 backoff로 다시 연다 → resume 약 30 s. 터미널·`--bg` 세션은 bridge 스트림에 간격이 생기면 구독이 끝나고, hub 버퍼에서 이어 가지 않는다 | #52 20:15Z 실패 3; spec:1855-1861 |
| 열림 상태가 연결 세대에 속함 | 보내기가 실패하면 열림 행이 지워지고 `not-open` 거부가 이어진다 | `project.ts:1118, 1122`; 실패 1 |
| 입력의 정확히 한 번 (#5) | 60 s freshness 창 때문에 재전송이 `stale`로 거부된다. Retry는 freshness를 확인하지 않고 다시 보낸다. 원장은 항목을 하루 둔다 | `project.ts:614, 617`; `sminos_rpc.py:108-109`; 실패 2 |
| 프레임 상한과 분할 (#13) | **이미 있다**: 1 MiB `FRAME_LIMIT`, `part` 분할, 256 KiB batch | `log-store.ts:23, 56`; `protocol/parts` |
| 프로젝트 로그의 순번 | **이미 있다**: `(writer, seq)` 유일, 도착 순 offset | `log-store.ts:1-20` |
| 재접속 backoff와 jitter (#9) | 0.5 s에서 두 배씩 15 s까지, 구간 위쪽 절반에서 뽑는다. `online`/focus 때 즉시 시도하는지는 확인하지 않았다 | `socket.ts:11` |
| 여러 클라이언트 (#2) | MAWS supervisor는 한 번에 한 클라이언트만 받는다 | `src/engine-host/detached.ts:3` |
| 클라이언트별 구독 | MAWS 이벤트는 모든 창으로 간다 | `src/main/ipc/events.ts:14` |
| 제어와 대량 데이터의 분리 (#11) | 확인하지 않았다 | — |

desk에는 이미 프로젝트 로그의 순번, 분할, jitter, 기계 링크의 heartbeat가 있다. 빠진 것은 **세션 스트림을
같은 순번·cursor 체계에 올리는 것**(launch epoch 포함), **DO 사이 await가 없는 양방향 단일 스트림**,
**브라우저↔hub 앱 핑**, **두 갈래의 입력 의미론**(개별 동작의 재봉인과 보내지 않음 UI)이다. 재구축의 핵심은
이 넷이고, 이 넷의 선 모양은 신뢰 설계(§3.5)에 달려 있다.

---

## 6. AHP를 어떻게 다룰까

자세한 것은 [ahp-evaluation.md](ahp-evaluation.md#L279).

- **가져올 것.** 재접속 계약, write-ahead 조정(확정 상태 + 대기 동작 렌더, 자기 echo로 pop), 구독별
  credit 창, 세션 상태를 채팅 모델(turn, tool call, 확인, 입력 요청, queued/steering, worker chat)로
  나누는 방식. Claude Code 세션의 대부분이 AHP 모델에 깨끗하게 들어간다.
- **채택하지 않는 이유.**
  - MAWS의 절반이 모델 밖에 있다. Yjs 산출물은 CRDT라서 host가 권위를 갖는 reducer 모델과 맞지 않는다.
    브라우저, 라이브러리, connector, 음성도 밖이고, X1 렌더러가 쓰는 원시 엔진 이벤트도 그렇다.
  - 2026-05-28부터 1.0.0(2026-10-02)까지 열 번 릴리스했고 대부분 breaking change였다. 1.1.0도 SDK를 깨는
    변경을 예고했다.
  - host SDK가 없다(#422).
  - 보안 문제가 열려 있다: 재접속 탈취(#259), 평문 bearer(#268).
- **Claude Code와의 관계.** VS Code의 참조 host는 Claude Agent SDK로 Claude Code를 돌린다(실험 단계).
  그 mapper가 버리는 것이 있다: compaction, status, 재시도, rate limit, hook 이벤트, 비용, "항상 허용"
  제안, `stopTask`, `rewindFiles`, context usage. 그리고 `interrupt` 대신 중단(abort)한다. MAWS가 이미
  다루는 폭보다 좁다.
- **나중에.** VS Code나 vscode.dev/agents와의 연동이 목표가 되면, 데몬에 AHP facade를 붙이는 것이 첫 단계다.

---

## 7. #52가 내려야 할 결정 (권고 포함)

앞의 세 행은 owner의 결정이거나 선의 모양을 정하는 1차 결정이다. 나머지 행이 이 셋 위에 선다.

| 결정 | 권고 | 대안이 나아지는 조건 |
|---|---|---|
| 세션을 누가 소유하는가: SDK host binding (owner) | spec은 "SDK host가 아니라 bridge"를 binding으로 둔다(spec:341-349). 근거는 터미널이 쥘 수 있는 세션, 그리고 구독 자격 증명 위의 SDK 제품에 대한 2026년 2월 약관이다. **권고: 웹이 다루는 세션은 엔진의 백그라운드 supervisor(`claude --bg`, `/background`)가 소유하고 bridge mod가 제어한다(§3.6).** binding을 지킨다. 프로그램으로 안 되는 조작(권한 모드 전환, rewind, MCP toggle, 일반 dialog)은 `claude attach`를 중계한 웹 터미널에서 한다. SDK 경로는 MAWS 앱의 로컬 세션에 남기고, 경로를 옮길 때는 resume handoff를 쓴다 | SDK host로 소유: 그 조작들을 웹 GUI에서 해야 할 때. binding을 뒤집고, 여러 member org에서 owner의 구독으로 다른 사람이 엔진을 모는 것이 약관상 괜찮은지(추론) 먼저 정한다. 입력: rc-parity §7 교훈 8 |
| 신뢰 설계 (1차) | member별 principal을 기계가 검증한다(#52 21:01Z). 고빈도 스트림은 채널 단위 인증, 개별 실행 등급 동작은 요청별 봉인 + passkey step-up. `clientId`는 principal에 묶어 기계가 확인한다. 표시 스트림의 무결성을 둘지 정한다. hub가 내려주는 JS의 키는 E2E가 아님을 전제로 적는다(§3.5) | — |
| hub 저장 (owner) | (a) 메모리 재접속 버퍼를 먼저 잰다. owner가 hub의 암호문 저장을 받아들이면 (b) 세션별 암호화 꼬리(DO SQLite, 바이트 상한)를 목표로 둔다(§4 끝) | (c) 완전한 caching proxy: hub가 읽을 수 있는 상태를 owner가 받아들이고, 열기·재접속을 기계 없이 전부 hub가 답해야 할 때 |
| 기계 쪽 끝점 | 세션 프로세스는 엔진 supervisor. 세션 밖의 MAWS 기계 쪽 서비스(산출물·Yjs, 라이브러리, git·scm, 파일, 설정)는 Electron에 기대지 않는 일반 Node 빌드의 headless 데몬(macOS launchd, Linux systemd)으로 옮긴다. 캡처와 export는 선택 사항이거나 headless Chromium으로. E10 supervisor의 WAN 강화는 MAWS 앱의 SDK 세션을 웹에 내줄 때만 | Electron main을 창 없는 서버로 계속 띄우는 것은 옮기는 비용이 지나치게 클 때만. 이 경우 Linux와 headless 기계는 빠진다 |
| 한 프로세스의 통제자 | `--bg`와 터미널 세션은 bridge mod. MAWS 앱이 소유한 SDK 세션은 MAWS 데몬 하나이고, bridge mod는 관찰하거나 위임한다 | — |
| uplink와 신뢰 경계를 쥐는 프로세스 | 신뢰 경계 프로세스를 먼저 정한다. 기본: sminos가 uplink와 신뢰 경계(봉인 검증, nonce 원장, 읽기 전용, 권한 상한)로 남고, MAWS 기계 데몬은 그 뒤의 로컬 클라이언트. MAWS가 없는 Linux·devcloud 기계도 닿는다. 로컬 홉 비용을 잰다(§3.3) | 측정에서 로컬 홉이 문제가 될 때: Electron에 기대지 않는 크로스플랫폼 기계 데몬 하나가 두 역할을 흡수한다 |
| 기계↔hub 전송 | 기계에서 나가는 WebSocket 하나(양방향, 채널 다중화). SSE+POST 폐기. 프레임의 응답이 DO 사이 await를 기다리지 않게 한다(§5) | — |
| hub 객체 토폴로지 | 기계 소켓을 끝내는 객체, 브라우저가 세션 스트림을 위해 그 객체에 직접 붙는지, 활성 세션당 비용 모델을 정한다. 프레임마다 DO 왕복을 하지 않는다. 객체당 처리량(초당 약 1,000 요청, Cloudflare 문서 수치), 만들 때 정해지는 위치, 상시 트래픽에서 잃는 hibernation을 계산에 넣는다. 스파이크 3의 구간별 측정으로 정한다(§3.3) | — |
| 세션 cursor | `(session, launch epoch, seq)`. epoch가 다르면 snapshot. MAWS 세션은 데몬이, 터미널·`--bg` 세션은 sminos 데몬이 plane에서 seq를 매기고 링을 둔다(§4 #1, #3) | — |
| 입력 의미론 | 두 갈래. 바이트 스트림은 인증된 채널 안 offset 중복 제거, 프레임별 나이 검사 없음. 개별 동작은 시간 결합을 지키고, 대기 중이면 새 nonce·`created`·mac, 같은 인자·digest로 재봉인해 보낸다(#52 20:15Z). 그 밖의 RPC는 창이 지나면 "보내지 않음, 다시 보내기". 원장 보존 ≥ 수용 창(§4) | 기기 시계를 믿을 수 없을 때: 벽시계 대신 기계가 발급한 epoch나 challenge |
| 생존 | 브라우저↔hub 앱 핑을 더한다. 모든 구간 양방향 핑 5–7 s, 2번 놓치면 판정, 깨어날 때·`online`·focus에서 즉시 탐침. 기계 링크의 `hb-ack` 임대와 1 s instance 탐침은 둔다 | — |
| 프로토콜 어휘 | MAWS X2/X1을 그대로 쓰고 AHP 메커니즘을 입힌다 | VS Code 연동이 목표가 되면 AHP facade 추가 |
| 권한 등급 | 읽기·쓰기·실행(spawn, 터미널) 등급을 hub뿐 아니라 기계가 검사한다. 위험한 것은 passkey step-up. 신뢰 설계(§3.5)와 함께 정한다 | #52 21:01Z의 org 단계와 함께 |
| 클라이언트에 묶인 기능 | §2 목록의 대체품을 정한다(업로드, HTTP origin, 화면 스트림 등) | — |
| 설정과 layout | 기계 쪽과 클라이언트 쪽으로 나누고, 렌더러 id와 store에 기계 차원을 더한다 | — |
| `session.ui.*` (mod 표면) | 행마다 왕복하거나 클라이언트에서 그린다. 측정 후 결정 | — |

---

## 8. 먼저 해볼 것

1. **계측.** #52가 이미 넣는 RPC ledger의 `created`/`done`, open→snapshot 시간에 더해, §1 표의 항목을 desk와
   RC 양쪽에서 같은 방법으로 잰다.
2. **세션 스트림 하나를 cursor 재개로.** 데몬 링 + `(session, launch epoch, seq)` → `replay | snapshot`을
   세션 하나에 구현한다. resume과 재접속 시간이 §1 표에 들어오는지 본다. 이 스파이크가 검증하는 것은 실패
   3이다. 실패 1(hub가 프로젝트의 열림 행을 지우는 것)은 따로 고친다. 같은 스파이크에서 hub 저장의 (a)
   메모리 재접속 버퍼를 두고, 배포 직후와 기계가 잠든 동안의 열기를 잰다.
3. **양방향 WebSocket uplink + 앱 핑 + 구간별 측정.**
   - 배포 중 재접속이 몰리는 상황과 죽은 소켓(OPEN이라고 보고하는 상태)을 일부러 만들어 판정 시간을 잰다.
   - 죽은 소켓 위에서 보낸 steer가 재봉인으로 한 번만 실행되는지 본다.
   - 브라우저→hub→객체→기계, 그리고 sminos 뒤 MAWS 데몬까지의 로컬 홉을 구간마다 재고, 객체당 처리량을
     잰다. 이 수치로 hub 객체 토폴로지와 uplink 프로세스(§3.3)를 정한다.
4. **supervisor 다중 클라이언트** (MAWS 앱의 SDK 세션을 웹에 내줄 때만). Electron 앱과 시험 클라이언트 하나를 동시에 붙여, 구독별 cursor와
   backpressure를 확인한다.
5. **`--bg` 경로의 빈 곳.** `claude attach`를 데몬의 PTY에서 돌려 웹 터미널로 중계하고 키 입력 지연을 잰다. `$.command.run('/background')`로 웹에서 터미널 세션을 넘길 수 있는지, 멈춘 세션에 `--rewind-files`를 한 번 실행해 파일이 되돌아가는지 본다. MAWS 렌더러의 세션 명령마다 `--bg` 경로에서 어떤 수단(mod, slash 명령, 데몬, 웹 터미널)으로 되는지 표로 만든다.

---

## 부록. 확인하지 못한 것

- RC의 실제 델타 지연. benchmark로 측정한다.
- desk의 제어와 대량 데이터 분리 여부, `online`/focus 때 즉시 재접속하는지.
- 권한 hook이 `-p` 모드의 MAWS 세션에서 도는지. 3.1의 경합이 실제로 일어나는지가 여기에 달렸다.
- AHP replay 버퍼 크기, dev tunnels 서버 쪽 세션 TTL, Cloudflare Worker/DO 소켓의 edge idle timeout.
- Cloudflare DO 객체당 처리량(초당 약 1,000 요청). 문서 수치이고 재지 않았다.
- 여러 member org가 owner의 구독으로 엔진을 모는 것이 약관상 어떤지. §7 첫 행은 추론이다.
- `claude-ssh` 내부. 문자열과 심볼만 읽었다.
