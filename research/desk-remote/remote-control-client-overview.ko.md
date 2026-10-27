# Remote Control — Claude Code 2.1.300 바이너리에서 보이는 것 전체 정리

출처: `~/claude-code-bundle/2.1.300/` (바이너리 carve → `cli.pretty.js` 리프린트). 상세 근거와
`chunk:line` 인용은 검수 완료된 스펙 챕터
[`SPEC/36-remote-control-and-bridge.md`](/Users/new/claude-code-bundle/2.1.300/SPEC/36-remote-control-and-bridge.md)
(9,525줄, 인용 1,536개, bad 0)에 있다. 이 문서는 그 챕터를 한국어로 재구성한 지도이고, 각 절
끝의 `→ §n`은 그 챕터의 해당 절이다. 핵심 리터럴 15개(엔드포인트, 헤더, 에러 문구 등)는
2.1.300 리프린트에서 직접 재확인했다.

그 챕터는 일부가 2.1.287 기준으로 남아 있어서 바이너리와 다시 대조했다. 챕터에 없던 것과
2.1.300에서 달라진 것은 **22절**에 모았고, 본문(0–21절)에서 틀린 부분은 그 자리에서 고쳤다.

---

## 0. 결론 먼저

- **서버 구현은 거의 없지만, 서버와의 계약은 거의 전부 보인다.** 바이너리에는 로컬 쪽(worker)
  구현 전체, 그리고 서버 API의 엔드포인트·요청/응답 필드·헤더·에러 코드·close code·재시도
  정책이 들어 있다. 서버가 무엇을 하는지는 "클라이언트가 어떤 응답을 기대하고 어떤 에러를
  어떻게 처리하는가"로 상당 부분 역추적된다.
- **"클라이언트" 쪽 구현도 들어 있다.** 폰/웹이 쓰는 것과 같은 프로토콜의 *클라이언트* 측
  구현(`SessionsV2Client`, `RemoteSessionManager`)이 바이너리에 있다. Claude Code가 클라우드
  세션을 보거나 조종할 때(teleport 등) 이것을 쓴다. 즉 프로토콜의 양 끝이 모두 보인다.
- 용어 주의: Remote Control에서 **로컬 Claude Code가 "worker"**, **폰/브라우저가 "client"**,
  Anthropic 서버는 세션 레코드를 중계하는 relay다. 폰과 노트북 사이에 직접 연결은 없다.

---

## 1. 전체 구조

```
 [폰 앱 / claude.ai/code]  ──POST /events──▶  [api.anthropic.com]  ◀──SSE + POST──  [로컬 Claude Code]
        (client)          ◀──SSE stream────   /v1/code/sessions/<id>               (worker)
                                              /v1/environments/bridge  ◀─ poll ── claude remote-control
```

worker 역할을 하는 프로그램이 두 개 있다. 전송 계층·프레임·제어 프로토콜은 공유한다.

| | REPL bridge (세션 내) | Headless bridge server |
|---|---|---|
| 진입 | TUI에서 `/remote-control`(`/rc`), 시작 시 `--rc`/`--remote-control`, 설정 `remoteControlAtStartup` | `claude remote-control` (별칭 `rc`, `remote`, `sync`, `bridge`), `claude daemon remote-control` |
| 중계 대상 | 지금 이 터미널에서 돌고 있는 대화 하나 | 자기가 spawn하는 0개 이상의 자식 `claude --print` 프로세스 |
| 서버 객체 | session 하나 (`cse_…`) | environment 하나 + 자식마다 session 하나 |
| 세션 태그 | `remote-control-repl`, `remote-control-auto`, `ccr-mirror` | `remote-control-cli`, `remote-control-auto` |

- **CCR** = 클라우드 세션 서비스의 내부 코드네임. "CCR v2" = `/v1/code/sessions/…` 경로군,
  "v1" = 레거시 `/v1/sessions/…`.
- 세션 ID는 `cse_…`(v2)와 `session_…`(v1 호환) 두 표기를 계속 변환하며 쓴다.
- 웹 URL: 세션 링크 `https://claude.ai/code/<session_id>`, 환경 링크(QR에 들어감)
  `https://claude.ai/code?environment=<envId>`. 스테이징 `claude-ai.staging.ant.dev`, 로컬
  `localhost:4000` 분기도 있다.

→ §1

---

## 2. 사용 자격(eligibility)과 정책 — 전부 클라이언트에서 먼저 판정

통과해야 하는 조건 (순서대로 거부 사유 코드가 있음: `not_first_party`, `cloud_session`,
`managed_disabled`, `not_signed_in`, `not_subscription_auth`, `token_scope_limited`,
`no_organization`, `policy_unverified`, `org_policy_denied`, `flags_disabled`,
`flags_unreachable`, `gate_off`):

1. **first-party API만**: `api.anthropic.com`. Bedrock/Vertex/Foundry/Mantle/Claude Platform on
   AWS·GCP/Cloud gateway, `ANTHROPIC_BASE_URL` 커스텀, `ANTHROPIC_UNIX_SOCKET`은 각각 전용 문구로
   거부. `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL`도 RC에는 안 통한다.
2. **claude.ai 구독 OAuth**: API key/`apiKeyHelper`/`ANTHROPIC_AUTH_TOKEN`은 거부.
   `claude setup-token`이나 `CLAUDE_CODE_OAUTH_TOKEN` 같은 장기 토큰은 "inference-only"라 거부
   (full-scope + `user:profile` scope 필요).
3. **조직 정책**: policy-limits(`/api/claude_code/policy_limits`)의 `allow_remote_control`.
   mirror 모드는 `allow_remote_sessions`도 필요. HIPAA 조직이 한 번 로그인했으면 세션 끝까지 latch.
   managed 설정 `disableRemoteControl`.
4. **GrowthBook 게이트** `tengu_ccr_bridge`(기본 false) — 예외: 유료 플랜(pro/max/team/enterprise)
   + `DISABLE_TELEMETRY`/`DO_NOT_TRACK`으로 플래그 평가가 꺼진 경우는 플래그 없이도 허용.
5. **최소 버전**: `tengu_bridge_min_version` (하한 2.1.270, 서버가 올릴 수만 있음).
6. **Trusted Devices**: 조직이 요구하면 기기 등록 필요(`/login`으로 enroll).

`claude doctor`/`/doctor`에 Remote Control 체크리스트 9줄이 있고 `--debug`면 인증 상태 덤프
(`isClaudeAISubscriber`, `oauthScopes`, `tengu_ccr_bridge=…` 등)가 붙는다.

→ §2

---

## 3. 진입점

- **CLI**: 엔트리 스텁이 commander 파서보다 먼저 `remote-control|rc|remote|sync|bridge`를
  가로채 TUI를 로드하지 않는 fast path로 보낸다. 동사 앞의 루트 옵션은 28개 허용 목록 외엔
  "조용히 버리지 않고 거부"한다.
- **`--rc [name]` / `--remote-control [name]`**, `--remote-control-session-name-prefix`
  (기본 hostname). 자동 세션 이름은 `<hostname>-<형용사>-<명사>` (예: `my-laptop-gentle-brook`).
- **`/remote-control` (`/rc`)**: 미연결이면 연결, 연결 중이면 카드(연결 끊기 / QR 보기 / 계속).
  첫 사용 시 1회 동의 카드("Enable Remote Control" / "Never mind") — 수락했을 때만
  `remoteDialogSeen` 저장. 상태줄 라벨 `/rc connecting…`, `/rc active`, `/rc reconnecting`,
  `/rc failed`.
- **`/mobile`** (`/ios`, `/android`): 앱 다운로드 QR(`claude.ai/mobile?entrypoint=claude_code_cli`).
  페어링 토큰이 아니라 일반 URL이다.
- **`remoteControlAtStartup`**: 보안 민감 설정. 프로젝트/로컬 설정은 *끌 수만* 있고 켤 수 없다
  (켜려 하면 무시 + 디버그 경고). 미설정이면 org 정책 `remote_control_at_startup` → GrowthBook
  `tengu_cobalt_harbor` 순으로 기본값 결정. `/config`의 "Enable Remote Control for all sessions".
- **`claude daemon remote-control add|remove|list`**: `~/.claude/daemon.json`의 `remoteControl[]`
  항목(dir, name, spawnMode, capacity 32, permissionMode, sessionTimeoutSeconds, createSessionOnStart)
  으로 상주 서버를 둔다. 데몬 워커는 부모에 `{type:"rc_busy"}` IPC를 보내 업그레이드를 미룬다.
- **SDK/Desktop 호스트**: stdio 제어 요청 `remote_control {enabled, work_secret, …}`으로 호스트
  앱이 세션의 RC를 켠다. work secret도 호스트가 공급한다(22.5). SPEC 36 §3에는 없다.
- **mirror(보기 전용) 모드**: 설정 `autoUploadSessions`, 내부적으로 `outboundOnly`. 프로토콜은
  다 있지만 이 빌드에선 시작 경로가 하드코딩 false라 **도달 불가**.

→ §3

---

## 4. `claude remote-control` (headless 서버)

**플래그**: `--name`, `--session-id`, `-c/--continue`(이 디렉터리에서 ~4시간 내 기록된 세션 재접속),
`--permission-mode`, `--[no-]chrome`, `--spawn same-dir|worktree|session`, `--capacity N`(기본 32),
`--[no-]create-session-in-dir`, `-v`, `--debug-file`, `--allow-unattended-tool-calls`(22.2).
`--sandbox`/`--no-sandbox`는 2.1.300에서 에러로 바뀜. `--enable-live-preview`/`--preview-port`는
파서엔 있으나 "not available in this build"로 무조건 거부. 터널 구현 자체는 2.1.300에 들어
있지만 `claude mcp serve --session-tunnel` 경로로만 쓰인다(22.7).

**2.1.300에서 SPEC 36보다 커진 부분**: 계정 전체 세션을 SSE로 지켜보며 폴링 시점을 당기는
session watch(22.1), 클라우드 세션이 이 폴더에서 명령을 돌리게 하는 foreground tool host(22.2),
macOS에서 자식 턴이 도는 동안 `caffeinate`로 잠자기 방지(22.3).

**spawn 모드**: `same-dir`(기본, 모든 세션이 현재 디렉터리), `worktree`(세션마다 `bridge-<id>`
git worktree), `session`(단일 세션, 끝나면 종료). 런타임에 `w`로 토글, 스페이스로 QR 토글.

**시작 순서 요약**: 인자 파싱 → 기업 런처 체크 → attestation 정책 설치 → 권한 모드 검증 →
워크스페이스 trust(TTY면 질문) → 토큰 확인 → 첫 실행 `Enable Remote Control? (y/n)` →
`--continue` 해석 → base URL HTTPS 검사 → spawn 모드 결정 → 포인터 파일로 기존 environment 재사용
시도 → git 정보·machine id 수집 → **environment 등록** → 포인터 기록 → 폴링 루프.

**폴링 루프**: work item `{id, state, secret, data}`. `data.type`이 `healthcheck`면 ack,
`session`이면 자식 spawn. `data.mode === "tool_use"`면 tool-host 프로토콜로 분기.
용량이 차면 폴링 대신 heartbeat만 도는 모드가 있다. 백오프 두 줄기(연결 오류 2s→120s,
일반 오류 0.5s→30s, ±25% 지터, 10분 후 포기), 반복 간 공백이 240초를 넘으면 "시스템 sleep"으로
보고 오류 예산 리셋. 401/404 시 environment 재등록(최대 3회, 같은 id 요구), 세션별
`/bridge/reconnect` 재큐잉(최대 5회). 만료 전 선제 갱신도 있다.

**종료**: SIGINT/SIGTERM/SIGHUP, Ctrl-C/D. 자식 SIGTERM → 30초 유예 → SIGKILL. 데몬 업그레이드/
reload면 활성 세션 id(최대 64)를 포인터에 남겨 재시작 후 다시 붙는다. 아니면 archive + deregister.

**터미널 렌더러**: `Ready · <repo> · <branch>`, `Capacity: 0/32 · …`, 세션별 OSC-8 링크 행,
`[HH:MM:SS] Session started…` 로그, `Reconnecting · retrying in … · disconnected …`.

→ §4

---

## 5. Environments API (headless 서버 전용)

헤더: `Authorization: Bearer <토큰>`, `anthropic-version: 2023-06-01`,
`anthropic-beta: environments-2025-11-01`, `x-environment-runner-version: <버전>`,
가능하면 `X-Trusted-Device-Token`. Bearer 토큰은 엔드포인트마다 다르다. 해제·archive·
reconnect·refuse는 OAuth(갱신 재시도 래퍼 포함)이고, poll·ack·stop·heartbeat·offline은 호출자가
넘긴 토큰을 쓴다. 대조 에이전트에 따르면 poll·stop·offline은 environment secret, ack·heartbeat는
work item의 `session_ingress_token`이다(호출부는 직접 확인 안 함).

| 메서드 + 경로 | 내용 |
|---|---|
| `POST /v1/environments/bridge` | 등록. 응답 `{environment_id, environment_secret, environment_secret_expires_in}` |
| `GET /v1/code/sessions?limit=1` → `GET /v1/code/sessions/watch?include_trigger_sessions=true&exclude_tags=-` | session watch용 resume token 발급 → 계정 세션 변경 SSE(22.1) |
| `GET /v1/environments/{env}/work/poll` | 쿼리 `reclaim_older_than_ms`, `poll_interval_ms`. 빈 응답 = 일 없음 |
| `POST …/work/{work}/ack` · `/stop {force}` · `/heartbeat` | heartbeat 응답 `{lease_extended, state}` |
| `POST /v1/environments/{env}/bridge/reconnect {session_id}` | 세션 재큐잉 |
| `POST /v1/environments/bridge/{env}/offline` / `DELETE /v1/environments/bridge/{env}` | 오프라인 표시 / 해제 |
| `POST /v1/code/sessions/{id}/archive`, `…/events` | 세션 archive, 이벤트 기록 |
| `POST /v1/code/sessions/{id}/tool_hosts/refuse` | tool-host 거절 (`anthropic-beta: ccr-byoc-2025-07-29`) |

**등록 바디**가 서버에 무엇을 알리는지 그대로 보인다:
`machine_name`(hostname), `directory`, `branch`, `git_repo_url`(자격증명 제거), `max_sessions`,
`metadata {worker_type:"claude_code", machine_id, tool_host…}`, 재사용 시 `environment_id`, 그리고
선택적 **host profile**: OS·아키텍처·PATH에서 찾은 개발 도구 이름(최대 32개, `xcodebuild`,
`kubectl`, `terraform`, `nvidia-smi`, `psql` 등) + `full`일 때 MCP 서버 이름·scope(최대 16, 프로젝트
`.mcp.json`은 제외). 롤아웃 게이트 `tengu_bridge_host_profile` 기본 `off`, 사용자 설정
`remoteControl.shareHostProfile: off|basic|full`(가장 제한적인 값 우선, 프로젝트 설정은 낮추기만 가능).

**에러 분류**: 401(구독 로그인 안내), 403(`expired`/`lifetime` 포함이면 "session expired"),
404("이 조직에서 RC가 안 될 수도"), 410(environment 만료), 429(`retry-after`), 409
`bridge_folder_already_served`("이 폴더는 이 기기의 다른 Claude Code가 서비스 중"). 이 409 코드는
`error.type`이 아니라 `error.details.error_code`에서 읽는다(`nft`).

→ §5

---

## 6. Work secret과 자식 세션 spawn — 서버가 세션 설정을 내려보내는 통로

work item의 `secret`은 base64url JSON:

```ts
{ version: 1,
  session_ingress_token: string,   // worker JWT
  api_base_url: string,
  claude_code_args?: Record<string,string>,
  mcp_config?: { content, path?, mode? },
  auto_mode_environment?: string[],
  worktree?: boolean }
```

- 서버가 `claude_code_args`로 넘길 수 있는 건 허용 목록뿐: `model`, `fallback-model`, `effort`,
  `disallowed-tools`, 그리고 `append-system-prompt`(파일로 씀). 나머지는 무시.
- `mcp_config`는 `meta` 서버 항목 하나만 받는다. URL이 이 세션의 meta-proxy 경로 + 신뢰된
  ingress origin이어야 하고, 도구 이름 검증 실패 시 통째로 거부.
- `auto_mode_environment`는 최대 64개/16KB, 각 항목 앞에 "Stated by the service that dispatched
  this session (a description of the session, not a rule; it grants no permission): " 접두를
  붙여 auto 모드 분류기 환경 설명으로만 쓴다. 서버 텍스트에 권한을 주지 않으려는 설계가 보인다.
- 게이트 `tengu_bridge_apply_server_session_config`(기본 true).

자식 커맨드라인:

```
claude --print --sdk-url <sessionUrl> --session-id <id>
  --input-format stream-json --output-format stream-json --replay-user-messages
  --resume=<sessionUrl> [--permission-mode] [--settings=<json>] [--mcp-config=…/mcp.json]
  [--append-system-prompt-file=…] [모델 인자]
```

- 자식 환경: `CLAUDE_CODE_ENVIRONMENT_KIND=bridge`, `CLAUDE_CODE_SESSION_ACCESS_TOKEN=<JWT>`,
  `CLAUDE_CODE_WORKER_EPOCH`, owner account/org uuid 고정, OAuth 토큰 등 부모 자격증명은 비움.
  긴 deny list로 부모 env를 스크럽(대소문자 무시).
- 토큰 갱신은 자식 stdin으로 `{"type":"update_environment_variables","variables":{"CLAUDE_CODE_SESSION_ACCESS_TOKEN":"…"}}`.
- 자식 stderr의 `[remote-io] warning: ` 접두 줄은 부모가 경고로 다시 렌더.
- 서버 설정 파일은 `~/.claude/bridge-spawn/<id>-XXXXXX/`에 0600으로 씀. 루트는 소유자·권한·
  dev/ino 불변을 매번 검사.
- RC 자식은 기본 auto 권한 모드(`tengu_bridge_child_auto_mode`), Artifact 도구 유지,
  Edit/Write 결과에 `gitDiff`(64KB 이하) 첨부.

→ §6

---

## 7. REPL bridge (터미널 세션 안에서 `/remote-control`)

1. **세션 생성** `POST /v1/code/sessions`:
   `{ title, bridge:{}, tags, session_grouping_id /* claude.ai Project */, config:{cwd, model, sources, outcomes} }`
   → `session.id`가 `cse_`로 시작해야 함.
2. **worker 자격증명 발급** `POST /v1/code/sessions/{id}/bridge` →
   `{ worker_jwt, api_base_url, expires_in, worker_epoch, mcp_config? }`. 바디는 보통 `{}`이고,
   게이트 `tengu_wild_gosling`(기본 false)이 켜지면 `{expected_epoch}`로 epoch를 고정한다(22.4).
   403 `untrusted_device`/`session_stale_relogin`/`signature_wanted` 분기, Cloudflare 등
   *Anthropic origin이 아닌* 403(`cf-ray`, `request-id` 형식으로 판별)은 180초간 반복될 때까지
   판정 보류.
3. **재접속 판단**: env handoff(`CLAUDE_BRIDGE_REATTACH_SESSION` 등, 바이너리 업그레이드 re-exec 시),
   옵션, 재개한 transcript에 기록된 포인터 순. 기록된 owner 계정이 현재 로그인과 다르면 거부하고
   새 세션 + 히스토리 업로드 차단.
4. **상태 머신**: `ready → connected → reconnecting → failed / policy_disabled`. 3회 연속 init 실패면
   그 세션에서 포기.
5. 쓰지 않은 세션은 `replBridgePlaceholders`에 기록해두고 나중에 sweep해서 archive(최근 20개,
   30일).
6. 무엇이 업로드되나: `user`/`assistant`, 일부 `system`(local_command, compact_boundary 등),
   훅 메시지, 큐 명령. UUID로 dedup. 서브에이전트 내부 작업은 기본으로 **도구 호출/결과만**
   전송하고 산문은 안 보냄(`tengu_bridge_subagent_text` 기본 false).

원격 설정 `tengu_bridge_repl_v2_config`(heartbeat 20s, token refresh buffer 5분, connect timeout
15s, dedup 버퍼 2000 등)로 튜닝값을 서버가 원격 조정한다.

SPEC 36에 없는 REPL 쪽 동작(22.4): 계정 메모리를 폰으로 보내기 전에 가리는 redactor, 실패 후
10초 지나면 RC를 스스로 끄는 auto-disable과 재로그인 감지 시 다시 켜는 auth revive, transcript
따라잡기(`[persistence-sync]`).

→ §7

---

## 8. 전송 계층 (CCR v2 worker transport)

worker = SSE 읽기 스트림 + HTTP 쓰기 클라이언트 한 쌍.

- **읽기** `GET <sessionUrl>/worker/events/stream?from_sequence_num=n` (+`Last-Event-ID`).
  SSE `id`가 시퀀스 번호. keepalive 간격을 서버와 협상(`keepalive_tolerance_seconds`,
  `x-ccr-sse-keepalive-interval-seconds`), 기본 15s + 30s 여유 동안 프레임 없으면 재연결.
  재연결 1s→30s 무제한.
- **쓰기** (모든 바디에 `worker_epoch`):
  - `PUT /worker` — 상태 `idle|running|requires_action`, `requires_action_details`,
    `external_metadata`/`internal_metadata`(키 단위 병합), 종료 시 `connection_status:"disconnected"`.
  - `POST /worker/events` — 이벤트 배치(≤100개, ≤10MiB), 400/413/422면 ephemeral 먼저 버리고 재시도.
  - `POST /worker/internal-events`, `POST /worker/events/delivery`(수신/처리 영수증),
    `POST /worker/heartbeat`(응답으로 `heartbeat_interval_seconds`, `refreshed_auth`).
  - `POST <session>/worker/register` → `worker_epoch` (headless가 자식 대신 등록).
  - `POST /v1/code/sessions/{id}/client/presence` — 터미널 활동/포커스 시 presence 펄스(5s 디바운스).
- **worker_epoch = 세션당 활성 worker 하나**. 새 worker가 등록하면 옛 worker 요청은 409 +
  `x-ccr-conflict-reason`(`superseded_by_worker`, `epoch_stale`, `session_not_active`)을 받고 close
  4090으로 물러난다.
- **close code와 사용자 문구** (일부): 4090 "another connection took over this session … standing
  down", 4091 transport init 실패, 4092 사유 없는 끊김, 4093 heartbeat 계속 실패, 4094 worker
  자격증명 만료. **복구 가능한 건 401·4091·4093·4094뿐**, 4090은 종료. 4093 복구는 시간당 3회·하루
  72회 예산.

→ §8

---

## 9. 프레임

- **client → worker로 주입 가능한 대화 프레임은 `user` 하나뿐.** 나머지는 `control_request`,
  `control_response`, `control_cancel_request`, `queued_notification`이고 그 외는 로그 후 폐기.
  echo/재전달/서브에이전트 echo는 UUID 링으로 걸러낸다.
- **서버만 만들 수 있는 이벤트 타입**: `workflow_launch`, `queued_notification`, `session_notice`.
  envelope의 `event_type`과 payload `type`이 다르면 거부.
- **worker → 서비스 프레임**: `user`/`assistant`(transcript), `system/init`(능력 스냅샷, 모델·모드·
  명령 바뀔 때마다 재전송), `system/status`, `stream_event`(≤60KB, ephemeral), `thinking_tokens`,
  `result`(턴의 실제 결과), `task_started/progress/notification`, `background_tasks_changed`,
  `code_change_published`, `vcs_state_changed`, `worker_shutting_down {reason}`, `keep_alive`
  (`keep_alive`는 `CLAUDE_CODE_REMOTE_SEND_KEEPALIVES`가 설정돼 있을 때만 보낸다),
  `system/file_attachments_missing`, `rate_limit_event`(22.7).
- **SSE 이벤트 이름**: worker는 `client_event`, `ephemeral_event`; client는 추가로
  `catch_up_truncated`, `session_update {connection_status}`, `security_update`, `delivery_update`.
- 들어온 프레임은 UI 전 "conformance" 단계에서 수리/폐기(깊이 256 초과 잘라냄 등).

→ §9

---

## 10. 제어 프로토콜 (원격에서 할 수 있는 일의 전체 목록)

stdio SDK와 같은 `control_request/response` 봉투. 폰/웹이 보낼 수 있는 subtype:

| 범주 | subtype |
|---|---|
| 세션 | `initialize`(지원 dialog 종류 선언 → 명령 목록·현재 모델·모드·열린 프롬프트 반환), `interrupt`, `rename_session`, `set_color`, `fork_conversation` |
| 모델/모드 | `set_model`(8초 내 결정 안 나면 "pending" 응답 후 나중에 알림), `set_permission_mode`, `set_max_thinking_tokens`, `apply_flag_settings`(**`effortLevel`과 `ultracode`만** 허용) |
| 조회 | `file_suggestions`, `read_file`, `get_workspace_diff`(merge-base 기준), `get_context_usage`, `get_usage`, `mcp_status` |
| MCP | `mcp_authenticate`, `mcp_oauth_callback_url`, `mcp_reconnect`, `mcp_set_servers` |
| 작업 | `stop_task`, `background_tasks`, `cancel_async_message`, `side_question`(=`/btw`, 600초) |

- 응답 대기 기본 75초. 종료 중엔 조회 7종만 허용, mirror 모드면 `initialize` 외 전부 거부.
- `set_model`에 `only_if_model_is_current`를 붙이면 "Remote Control does not implement
  only_if_model_is_current. The request changed nothing."으로 거부.
- `read_file`은 작업 디렉터리·추가 디렉터리 안(또는 권한 검사가 허용한 곳)만 읽고, "ask"는 거부로
  취급한다. realpath 후 재검사, UNC·네트워크 경로 거부, 기본 1MB·최대 10MB(22.6).
- worker가 client에게 보내는 요청은 두 가지뿐: `can_use_tool`(권한), `request_user_dialog`
  (AskUserQuestion 같은 대화상자). 폰 UI에는 `dialog:<kind>` 가짜 도구로 표시.
- 원격(브리지 경유)에서 온 명령은 "restricted origin"으로 취급: 커스텀 output style 선택 불가 등.
  원격 `/clear`는 로컬에 떠 있는 다이얼로그를 닫고 실행.

→ §10

---

## 11. 권한 릴레이

로컬에서 권한 프롬프트가 뜨면 `can_use_tool` control_request 송신 + `PUT /worker`로
`requires_action` 표시 → 폰이 `control_response {behavior: allow|deny}` → worker가 해결 →
`control_cancel_request`로 다른 모든 클라이언트의 프롬프트를 닫음.

- **로컬과 원격 둘 다에 뜨고 먼저 답한 쪽이 이긴다.** 로컬 입력이 잠기는 상태는 없다.
- 응답의 `toolName`이 대기 중 도구와 다르면 무시.
- 열린 프롬프트는 `pending_permission_requests`로 재전달(최대 200), worker 출처가 아니면 제거.
- 전달 못 한 답은 1s, 5s, 15s, 45s로 재전송 후 포기 문구 표시.

→ §11

---

## 12. 상태 동기화

worker가 `external_metadata`로 서버에 올리는 키: `permission_mode`(bypass 모드일 땐 안 올림),
`is_ultraplan_mode`, `effort_level`, `cross_session_inbound`, `context_usage {used_tokens,
max_tokens}`, `post_turn_summary {status_category, status_detail, needs_action, …}`,
`pending_action(s)`(최대 32), `current_branches`, `worktree_state`, `task_summary`.
폰 앱의 세션 목록 상태 표시는 이 값들로 그려지는 것으로 보인다.

로컬에서 권한 모드를 바꾸면 `set_permission_mode`를 1s/3s/9s로 재시도하며 수렴시키고, 실패하면
worker가 마지막으로 확인한 모드로 되돌린다.

→ §12

---

## 13. 보안 장치 (클라이언트 측에 구현된 것)

- **Device attestation**: 서버가 각 `client_event`에 `device_attestation_status`를 찍어 보낸다
  (`VERIFIED`, `VERIFIED_KEYLESS_DEVICE`, `VERIFIED_BY_GATE`, `SERVICE_VOUCHED`,
  `SERVER_AUTHORED`, `TRANSITIVELY_VOUCHED`, `ABSENT`, `INVALID` …). worker는 사용자 메시지·권한
  응답·민감한 제어 요청(`set_model`, `set_permission_mode`, `interrupt`, `mcp_*` 등 15종)을 이
  판정으로 거른다. **집행은 기본 off**(`tengu_bridge_attestation_enforce`), 설정이 깨지면
  `VERIFIED`만 받는 쪽으로 fail-closed. 거부 시 "Remote Control ignored a message that arrived
  without a valid device signature …" 알림(분당 10개 제한).
  → 서명 검증 자체는 서버가 하고, 클라이언트는 그 판정을 정책으로 적용한다.
- **Trusted device 토큰**: `X-Trusted-Device-Token` 헤더, 403 `untrusted_device`면 토큰 비우고
  재등록 시도.
- **worker 출력처럼 생긴 user 프레임 폐기**(`<bash-stdout` 등 하네스 태그로 시작하는 텍스트를 client가
  보내면 버림) — 원격에서 도구 결과를 위조하는 걸 막는다.
- **계정 변경 감지**: 브리지 도중 로그인 계정이 바뀌면 즉시 쓰기 차단, `worker_shutting_down
  {reason:"account_changed"}` 송신, 원래 owner 자격증명으로 archive.
- 로컬 중복 방지: 같은 대화를 다른 터미널이 이미 브리지 중이면 자동 연결은 양보, 명시적
  `/remote-control`만 가져온다(`~/.claude/sessions/<pid>.json` + 프로세스 시작 토큰 비교).
- 서버가 보낸 시스템 프롬프트/환경 설명엔 "권한을 주지 않는다"는 접두, 서버 MCP는 meta 하나만,
  CLI 인자는 허용 목록만.

→ §13, §18

---

## 14. Claude Code 안의 "클라이언트" 구현: `SessionsV2Client` / `RemoteSessionManager`

폰/웹과 같은 역할의 클라이언트 코드가 바이너리에 있다(클라우드 세션·teleport에서 사용).

- 스트림 `GET /v1/code/sessions/{id}/events/stream[?from_sequence_num][&control_only=1]`,
  헤더에 `x-organization-uuid`, `X-Trusted-Device-Token`.
- 송신 `POST /v1/code/sessions/{id}/events {session_id, events:[…]}`, 이벤트 하나씩 서명
  (`eventSigner`). 결과 `accepted {sequence_num}` / `session_inactive`(409) / `failed`.
- 45초 liveness, 벽시계 drift(서스펜드) 감지 시 재연결, 응답 `Date` 헤더로 서버 시계 추정.
- 비-worker 출처에서 온 `user`·`env_manager_log` 외 타입은 폐기. 자기 control_request의 echo로
  "서버가 이 기기의 서명을 어떻게 판정했는지"를 읽는다.
- 권한 프롬프트 중복/재전달/폐기 관리, 전달 못 한 답 재전송, 첫 프롬프트 별도 재시도(3회),
  원격 백그라운드 작업 미러(`/tasks`에서 원격 작업 보기·중지).

→ §14, §15

---

## 15. 역방향: 클라우드 세션이 내 컴퓨터의 도구를 쓰는 기능 ("served tools")

클라우드 세션 모델이 `_host` 필드로 특정 기기를 지정해 그 기기에서 도구를 실행시키는 구조가
들어 있다.

- 현재 전송: 같은 세션 스트림의 제어 요청 4종 `remote_tool_call`, `remote_plumbing_call`,
  `remote_tools_probe`, `remote_tools_reannounce` + 기기 쪽 `remote_tools_announce`
  (도구 ≤16, passthrough MCP 도구 ≤256, 1MiB 한도).
- 서비스 가능한 네이티브 도구: `Bash`, `PowerShell`(Windows), `Read`, `Write`, `Edit`, `Glob`,
  `Grep`. 기기의 MCP 도구도 `mcp__remote-devices__<server>__<tool>`로 노출 가능.
- 레거시 전송: `wss://bridge.claudeusercontent.com/devices/<org>_<account>/<device>/bridge`.
- 결과 앞에 실행 위치 표기(`[ran on <host> · <dir>]`, `[refused on … — not run]` 등), 승인 대기·
  기기 수면·재연결에 대한 모델용 문구가 대량으로 있다.
- 기기 쪽 안전장치: 샌드박스가 약화돼 있으면 거부, 무인 실행 동의
  `~/.claude/state/unattended-serving-consent.json`(hostname·약관 버전이 맞아야 유효).
- **대부분 꺼져 있다**: `CLAUDE_CODE_REMOTE_TOOLS_FORWARD=true` 명시 필요, 데몬 tool-host 광고는
  `tengu_radiant_heron`(기본 false), `claude remote-control`의 foreground tool host와
  `--allow-unattended-tool-calls`는 `tengu_violin_luthier`(기본 false). 개발 중인 기능으로 보인다.
- headless 서버 쪽에서는 서버가 세션의 `external_metadata.tool_host_status =
  {state:"requested", environment_id}`로 "이 기기가 도구를 맡아 달라"고 요청하고, 기기는 watch
  스트림으로 이를 보고 helper를 띄우거나 `tool_hosts/refuse`로 거절한다(22.1, 22.3).

→ §17

---

## 16. 파일·알림

- **앱 → 로컬 파일**: `user` 프레임의 `file_attachments`(최대 20개, 개당 35MiB), 다운로드
  `GET {base}/api/oauth/files/{uuid}/content`(동시 16, 재시도). 실패는 "[attachment did not arrive]"
  같은 문구로 모델에 알림.
- **로컬 → 앱 파일**(`SendUserFile`): `POST /api/oauth/file_upload`, 버퍼 30MiB / 스트리밍 500MiB,
  BMP/TIFF→PNG, HEIC/AVIF→JPEG 미리보기 변환, 8000px 초과 이미지는 축소본 전송.
- **PushNotification**: 첫 연결 시 "Your Claude Code session is ready — continue from your phone
  anytime." 푸시를 브리지가 합성(실험 게이트, 기본 off).
- **업셀/넛지**: 20분 유휴 후 "control this session from your phone · /remote-control"(최대 3회),
  권한 넛지(기본 확률 0), 긴 턴 넛지(기본 off), 자동 연결 안내 카드 "Keep working from anywhere".

→ §16, §3.3

---

## 17. 디스크에 남는 것

| 경로 | 내용 |
|---|---|
| `~/.claude/projects/<key>/bridge-pointer.json` | `{sessionId, environmentId, source, pid, procStart, activeSessionIds…}`, TTL 4시간(프로젝트 스레드면 7일), `--continue`가 읽음 |
| `~/.claude/bridge-spawn/` | 자식별 서버 설정(mcp.json, append-system-prompt.txt), 0700/0600 |
| `~/.claude.json` | `remoteDialogSeen`, `remoteControlMachineId`(등록 시 `machine_id`), `replBridgePlaceholders`, `hasUsedRemoteControl`, 업셀 카운트, 프로젝트별 `remoteControlSpawnMode` |
| `~/.claude/daemon.json` | `remoteControl[]` 상주 서버 목록 |
| `<configHome>/remote-control/fork-seeds/` | 앱에서 fork할 때 시드 |
| `~/.claude/state/unattended-serving-consent.json` | 무인 도구 실행 동의 |

→ §19

---

## 18. 주요 게이트 (서버가 원격으로 켜고 끄는 스위치)

| 게이트 | 기본 | 의미 |
|---|---|---|
| `tengu_ccr_bridge` | false | RC 전체 마스터 스위치 |
| `tengu_cobalt_harbor` | false | 세션 시작 시 자동 연결 기본값 |
| `tengu_bridge_min_version` | 2.1.270 | 최소 버전 |
| `tengu_bridge_repl_v2_config` / `tengu_bridge_poll_interval_config` | 객체 | 재시도·heartbeat·폴링 간격 튜닝 |
| `tengu_bridge_host_profile` | off | 기기 정보 보고 수준 롤아웃 |
| `tengu_bridge_attestation_enforce(_config)` | off | 기기 서명 집행 |
| `tengu_bridge_apply_server_session_config` | true | work secret의 서버 설정 적용 |
| `tengu_bridge_subagent_frames` / `_text` | true / false | 서브에이전트 프레임 전송 / 산문 포함 |
| `tengu_bridge_requires_action_details` | false | 대기 중 프롬프트 상세 게시 |
| `tengu_copper_kestrel` | true | 원격 effort 변경 허용 |
| `tengu_ccr_v2_*` | 혼재 | v1/v2 경로 이전 상태 |
| `tengu_violin_luthier` | false | headless 서버의 foreground tool host, `--allow-unattended-tool-calls` |
| `tengu_wild_gosling` | false | `/bridge` 재발급 시 `expected_epoch` 고정 |
| `tengu_keen_lantern` | true | environment secret 만료 전 갱신 |
| `tengu_moonlit_lagoon` | true | macOS에서 bridge 자식 턴 중 `caffeinate` |
| `tengu_humble_petal` | true | `initialize`의 `inbound_read_receipts` |
| `tengu_humming_star` | true | inbox owner 주장을 서버 공지로 검증 |
| `tengu_encapsulated_dusk` | false | 계정 메모리를 가리는 대신 프레임째 버림(kill switch) |
| `tengu_zany_melody`, `tengu_noble_snowflake` | true / 객체 | transcript 지연 업로드 관련 |
| `tengu_bridge_poll_interval_config.watch_sessions` | false | 계정 세션 watch 사용 |

org 정책 키: `allow_remote_control`, `allow_remote_sessions`, `remote_control_at_startup`.
설정 키: `disableRemoteControl`, `remoteControlAtStartup`, `autoUploadSessions`,
`remoteControl.shareHostProfile`, `remoteTools.allowUnattendedServing`, `isolatePeerMachines`,
`crossSessionInbound`.

→ §20

---

## 19. 클라이언트/서버 역할 분담 — 바이너리에서 추론되는 서버 기능

**클라이언트(로컬 Claude Code)가 하는 것**: 에이전트 실행 전부, 권한 판단과 프롬프트, 자격 판정,
자식 프로세스 관리, worktree, 프레임 필터링·dedup, 서버 설정 검증, attestation 정책 적용, 재연결·
복구, 제목 생성, 상태 메타데이터 게시, 파일 다운로드/업로드.

**서버가 하는 것 (클라이언트가 기대하는 응답으로 드러나는 부분)**:

1. **세션 레코드 + 순번 붙은 이벤트 로그**: `sequence_num`, `from_sequence_num` 재생, 너무 오래된
   구간은 `catch_up_truncated`. 여러 클라이언트에 fan-out.
2. **worker 단일성 보장**: `worker_epoch` 발급·검증, 409 + `x-ccr-conflict-reason`.
3. **environment 단위 작업 큐**: 폴링/임대(`lease_extended`)/`reclaim_older_than_ms`/재큐잉/
   heartbeat — claude.ai에서 "이 컴퓨터에서 새 세션"을 누르면 work item이 생긴다.
4. **자격증명 발급**: environment secret, worker JWT(`session_ingress_token`, `worker_jwt`, 만료와
   heartbeat 응답의 `refreshed_auth`), trusted device 판정(`untrusted_device`,
   `session_stale_relogin`).
5. **기기 서명 검증**: 이벤트별 `device_attestation_status` 판정을 서버가 계산.
6. **연결 상태 추적**: worker `connection_status`를 클라이언트에 `session_update`로, 계정의 세션
   목록 `GET /v1/code/sessions?statuses=active&statuses=paused`(environment_kind, connection_status).
7. **세션 설정 주입**: claude.ai Project에서 디스패치된 세션에 모델·effort·금지 도구·시스템 프롬프트
   추가분·meta MCP·auto 모드 환경 설명을 work secret으로 전달.
8. **원격 튜닝**: keepalive/heartbeat 간격 권고, 최소 버전, 각종 GrowthBook 게이트.
9. **조직 정책**: `/api/claude_code/policy_limits`.
10. **파일 저장소**: `/api/oauth/files`, `/api/oauth/file_upload`(이미지 형식 검사, 개수 한도 등의
    에러 코드 `file_limit_exceeded`, `upload_busy`…가 보임).
11. **푸시 전송**, 세션 inbox(`FetchInboxMessage`). owner가 보낸 파일은 서버가 `file_id`를 미리
    공지해서 보증한다. 메시지 본문의 `rc_owner` 주장만으로는 owner로 인정하지 않는다(22.7).
12. **계정 단위 변경 피드**: `/v1/code/sessions/watch` SSE. opaque cursor(`resume_token`, `sync`
    id), 404 = 아직 이 계정에 미제공(서버 롤아웃), 410 = cursor 만료(22.1).
13. **기기에 도구 실행 요청**: 세션 메타데이터 `tool_host_status`로 특정 environment를 지목한다.
14. **클라우드 worker의 attestation 하한**: 응답 헤더 `x-ccr-attestation-policy`
    (`mode=off|observe|enforce`)로 서버가 정한다. 로컬 bridge 자식은 이 헤더 대신 로컬 게이트를
    따른다(22.8).
15. **SDK/Desktop용 work secret 발급**: Desktop 앱 같은 호스트가 받아 CLI에 넘기는 work secret(22.5).

클라이언트가 서버에 알리는 것: 다음 폴링까지의 간격(`poll_interval_ms`), 용량 초과 거절
(`client_metadata.desktop_rc_refusal`), 세션 색(`color:` 태그), 지원 기능(`worker_capabilities=
attestation-floor/1,worker-socket/1`), 기기 토큰(`x-trusted-device-token`).

**바이너리로는 알 수 없는 것**: 서버 내부 저장·보존 정책, attestation 서명 방식(기기 키),
폰 앱/웹 UI 동작(예: 오프라인 기기에서 Send 비활성화, 환경 메뉴 갱신 속도), Project 스레드
디스패치의 서버 측 로직, `POST /bridge`가 돌려주는 `mcp_config`의 실제 형태(소비 코드가 이
빌드에서 전부 stub).

---

## 20. 이 빌드에서 죽어 있거나 미완인 것

- mirror 모드(`autoUploadSessions`): 프로토콜 완비, 시작 경로가 false로 고정.
- live preview 터널: `claude remote-control --enable-live-preview`는 무조건 거부. 터널 구현은
  들어 있지만 `claude mcp serve --transport http --session-tunnel`로만 쓰인다(22.7).
- 클라우드 handoff 업로드 대기(`awaitUploadsForHandoff`): 코드는 있으나 이 빌드에서 호출하는 곳을
  못 찾음.
- `POST /bridge`의 주입 MCP: 받아서 넘기지만 소비자가 전부 stub.
- `autoAddRemoteControlDaemonWorker`: 설정 허용 목록에만 있고 읽는 곳 없음.
- served tools 대부분: env/게이트 기본 off.
- `CLAUDE_BRIDGE_BASE_URL`, `CLAUDE_BRIDGE_OAUTH_TOKEN`, `CLAUDE_BRIDGE_SESSION_INGRESS_URL`:
  레지스트리에 선언만, getter가 항상 undefined.
- `claude sync`/`remote`/`bridge` 별칭: 동작하지만 문서화 안 됨.

→ §3.5, §4.1, Open questions

---

## 21. 2.1.293 → 2.1.300 사이 RC 관련 변경 (changelog)

- `claude remote-control`이 키체인 잠김 같은 일시적 로그인 오류 후 연결 갱신을 포기하던 문제 →
  재시도 + `/login` 필요 시 경고.
- 여러 세션을 서비스하는 컴퓨터에서 세션이 실행 중인데 stopped로 표시되던 문제(세션별 heartbeat
  시계 분리).
- `--sandbox`/`--no-sandbox` 제거(에러).
- 느린 연결에서 큰 이벤트 배치가 업로드를 못 끝내 claude.ai 화면이 멈추던 문제(배치 분할, 크기
  비례 타임아웃).
- 같은 배치의 다른 프롬프트 실패 시 RC 프롬프트 유실, 자격증명 복구마다 시작 히스토리 재업로드,
  `/clear` 이전 대화 재개 시 이후 대화의 RC 세션에 붙던 문제. 마지막 것은 resume 쪽이 아니라
  `/clear` 처리기를 고쳤다: 지우기 직전 대화에 빈 `bridge-session` 기록을 즉시 남긴다. SPEC 36
  §18.4는 resume 메타데이터 로더를 고친 것으로 잘못 적었다.
- 서브에이전트를 많이 쓴 클라우드/RC 세션 재개 후 메모리 과다: `--sdk-url` worker가 transcript
  재구성 후 hydrate prefetch 이벤트 배열을 비운다. 모든 bridge 자식이 이 경로를 탄다.
- 사진 저장 실패 시 사진 유실, 30–35MiB 파일 미도착, 장시간 세션에서 파일 미도착.
- diff 뷰에서 삭제/이름변경이 modified로 보이던 문제, reftable 저장소의 cherry-pick/revert 충돌 인식.
- 도달 불가 기기 세션에서 메시지가 보내진 것처럼 보이던 문제(웹 쪽, 바이너리로 확인 불가).
- RC/클라우드 MCP 커넥터가 MCP 프로토콜 2026-07-28을 기본 협상.
- 권한 대기 상태 표시에서 MCP 도구를 `mcp__server__tool` 대신 읽기 쉬운 이름으로. CLI가 보내는
  값은 2.1.292와 바이트 단위로 같으므로 이름은 앱/서버 쪽에서 만든다.

---

## 22. SPEC 36에 없거나 2.1.300 기준으로 틀린 것

SPEC 36을 2.1.300 바이너리와 다시 대조한 결과다. 아래에 나오는 리터럴(엔드포인트, 게이트 이름,
문구)은 전부 `cli.pretty.js`에서 직접 확인했다. 수치·분기 세부 중 **†** 표시는 대조 에이전트가
보고한 것을 옮겼고 일부만 표본 확인했다. 괄호 속 숫자는 `cli.pretty.js` 줄 번호다.

### 22.1 계정 전체 세션 watch (headless 서버) — 가장 큰 누락

`claude remote-control`이 계정의 세션 변경을 SSE로 구독하다가, 이 기기와 관련된 변화가 오면
폴링을 앞당긴다. SPEC 36에는 한 단락뿐이고 Open questions는 이미 명세됐다고 잘못 적었다.

- **API** (895005): `GET /v1/code/sessions?limit=1`로 `resume_token`을 받고,
  `GET /v1/code/sessions/watch?include_trigger_sessions=true&exclude_tags=-`를
  `Last-Event-ID: <token>`으로 연다. 리다이렉트 금지. 헤더는 environment 클라이언트 것에서
  `anthropic-beta`를 빼고 `anthropic-client-platform`/`anthropic-client-version`을 붙인다.
- **이벤트**: `sync`(그 `id`가 다음 resume token, `^[\x21-\x7e]{1,4096}$`), `added`/`changed`
  (데이터 `{id, environment_id, status, worker_status, last_event_at,
  external_metadata.tool_host_status}`, 문자열은 각 256자 이하).
- **상태** `off → connecting → connected → backoff → parked`. 상수(1115478): 45초 무신호면 끊긴
  것으로 보고, `sync`가 6–9분 없으면 재연결, 210초가 안 된 토큰은 재사용, 백오프 15→60초,
  1MiB를 넘는 프레임이 오면 스트림 종료. †90초 공백은 기기 sleep으로 판단.
- **응답별 처리** (`cr()`, 1115667):

  | 응답 | 처리 |
  |---|---|
  | 401 / 403 | 15분 park |
  | 404 | `not_offered`, 1시간 park |
  | 410 | 토큰 재발급 |
  | 429 | `retry-after` (기본 30초, 최대 10분) |
  | 408 / 5xx | 재시도 |
  | 쓸 수 없는 응답 3회 연속 | 1시간 park |

- †**폴링 조절**: 이 environment 세션의 내용이 바뀌었거나 도구 실행 요청이 오면 300ms, 1.3s,
  4.3s, 15s, 30s, 60s 뒤에 연달아 폴링한다. 평소 간격은 watch 연결 중 60초, 끊긴 동안 30초.
  세션이 끝나면 600초 안에 한 번 더 폴링한다.
- **켜지는 조건** (1116360): `tengu_bridge_poll_interval_config.watch_sessions`(기본 false),
  first-party, 비필수 트래픽 차단이 아님, 정책 거부 없음. 기본으로는 꺼져 있고 서버가 계정별로
  켠다.
- 텔레메트리 `tengu_bridge_watch_summary`(시간별 카운터), `tengu_bridge_watch_miss`.

### 22.2 Foreground tool host와 `--allow-unattended-tool-calls`

2.1.287 이후 추가됐다. 게이트 `tengu_violin_luthier`(기본 false, 311150).

- 단일 세션 모드가 아닌 `claude remote-control`은 `startForegroundToolHost`를 띄워 클라우드
  세션이 이 폴더에서 명령을 실행하게 한다. 상태 문구 "Your cloud sessions can use this folder
  while Remote Control runs…", "Cloud sessions: run commands here, asking first".
- `--allow-unattended-tool-calls`: 이번 실행 동안 클라우드 세션의 auto 모드 명령을 묻지 않고
  실행한다(샌드박스 안에서만). `--spawn=session`·`--session-id`·`--continue`와 함께 쓰면
  거부(1117085), TTY 필요, 실행 단위 무인 허가를 기록. 게이트가 켜졌을 때만 도움말에 나온다.
- 15절 served tools와 같은 계열이다. SPEC 36 §17은 데몬 tool host만 다룬다.

### 22.3 Headless 서버의 그 밖의 누락

- **잠자기 방지** (239342): macOS에서 `CLAUDE_CODE_ENVIRONMENT_KIND=bridge`인 자식의 턴이 도는
  동안 refcount로 `caffeinate -i -t 300`을 주기적으로 다시 띄운다. 게이트 `tengu_moonlit_lagoon`
  (기본 true). SPEC 36 Open question 2.1.287#058의 답이다.
- **environment secret 갱신** (895068): 등록 응답의 `environment_secret_expires_in`을 보고
  만료 − min(max(수명/10, 15분), 24시간) × (1 + 0.25×난수) 시점에 갱신을 예약한다. 수명이
  1시간 미만이면 무시. 게이트 `tengu_keen_lantern`(기본 true).
- **재시작 시 project thread 세션 재큐잉** (1117686): 포인터에 저장된 claude.ai Project 스레드
  세션을 다시 큐에 넣는다. `tengu_bridge_project_thread_requeue {requested, requeued, dropped,
  deferred, unattempted}`.
- **tool-host 거절 코드** (782963): `gate_off`, `serving_off`, `not_served`, `at_capacity`,
  `start_failed`, `helper_exited`. †helper 동시 4개, 세션당 시작 3회, 10분에 10회 한도, helper
  종료 코드 78은 `serving_off`.
- **서버 에러 상세 표시** (2075): 서버 메시지가 한 줄 평문이고 1,024자 이하일 때만 보여준다.
  SPEC 36 §5.3이 인용한 `Rhr`/`external_poll_sessions` 판정은 없어졌다.

### 22.4 REPL bridge

- **계정 메모리 가리기** (90139, 어느 챕터에도 없음): 폰으로 나가는 프레임에서 메모리 도구
  호출/결과, 메모리 첨부, 메모리 스트림을 `[account memory withheld from Remote Control; shown in
  the terminal session…]` 같은 자리표시로 바꾼다. 2.1.300부터 compact 요약은 "…withheld from
  Remote Control because it may include account memory" 문구로, 명령 출력은 `[command output
  withheld from Remote Control: it may repeat the conversation summary…]`로 바뀐다. 메모리 관련
  권한·다이얼로그 프롬프트는 폰에 보내지 않고 터미널에만 띄운다. rc-fork 히스토리 업로드도 같은
  redactor를 거친다. `tengu_encapsulated_dusk`(기본 false)를 켜면 가리지 않고 프레임째 버린다.
- **transcript 따라잡기** (`[persistence-sync]`, 488485): 재시도 2초→300초. 첫 4회가 실패하면
  "fallen behind"로 보고 이후 실행이 성공할 때까지 transcript 기록을 멈춘다. 결과
  `caught_up` / `caught_up_after_retry` / `caught_up_late`. †서브에이전트 backfill은 20개·개당
  5MiB 한도이고, transcript에 history-suppression 표시가 있으면 하지 않는다.
- **`/bridge` epoch 고정** (643191): `tengu_wild_gosling`이 켜지면 바디가 `{expected_epoch}`.
  409에 `expected_epoch`/`actual_epoch`가 오면 †최대 2회 따라간 뒤 고정 없이 요청한다. SPEC 36은
  바디가 항상 `{}`라고 적었다.
- **auto-disable과 auth revive** (851487, 852443): 실패 후 10초 지나도 오류가 남아 있으면
  `replBridgeEnabled=false`로 끄고 `tengu_bridge_repl_auto_disabled`를 보낸다. 인증 실패였다면
  300초마다 같은 계정의 새 자격증명이 생겼는지 보고, 생기면 RC를 다시 켠다
  (`tengu_bridge_repl_auth_revive`, 무인 revive는 최대 10회). 게이트 `tengu_bridge_auth_revive`는
  4094 복구뿐 아니라 이 감시도 맡는다.
- **클라우드로 handoff** (92669): teleport-to-cloud가 `publishGitStateBeforeHandoff`로 git 상태를
  먼저 올린다. 실패 문구 "Claude Code didn't finish updating Remote Control in this terminal…".
  업로드 대기 함수(`awaitUploadsForHandoff`)는 있으나 호출하는 곳은 못 찾았다.
- `/clear` 수정과 재개 후 메모리 수정은 21절.

### 22.5 세 번째 진입점: SDK/Desktop 앱이 호스팅하는 RC

3절의 두 진입점 말고도, SDK 호스트(Desktop 앱 등)가 stdio 제어 요청으로 RC를 켜는 경로가 있다.

- **`remote_control` control_request** (77332): `enabled`, `work_secret`, `name`,
  `reattach_session_id`, `keep_session_on_exit`. 성공 응답 `{session_url, connect_url,
  environment_id, bridge_epoch, bridge_session_id}`.
- 에러: "Remote Control cannot be enabled from inside a remote session", "The conversation was
  cleared while Remote Control was being enabled; send the request again", 정책 거부
  `remote_control_policy_disabled`.
- work secret은 호스트가 공급한다. 갱신도 호스트에 `remote_control_work_secret` 요청을 보내 받는다.
  †새 JWT의 `exp`가 기존 것보다 늦지 않으면 거부. †`/worker/register` 실패는 408/429/5xx 재시도,
  401/403은 한 번 봐주고, 나머지는 종료.
- †이 경로("sdk-host lane")도 work secret의 시스템 프롬프트 추가분, `disallowed_tools`, meta MCP,
  모델, effort를 적용한다(`tengu_bridge_server_config_applied {lane:"sdk_host"}`).

### 22.6 제어 프로토콜 보정

- `set_model.only_if_model_is_current` 거부와 `read_file` 범위 제한은 10절.
- †`read_file`: 신뢰된 네트워크·NT namespace·UNC·automount 경로 거부, base64·`anchor` 옵션,
  텔레메트리 `tengu_bridge_read_file_served`.
- †`thinking_display`가 `"highlights"`도 받는다. TUI도 `set_max_thinking_tokens`를 적용한다.
  `initialize`에 `claude_code_version`, `inbound_read_receipts`(`tengu_humble_petal`)가 더 있다.
  `get_workspace_diff` 시간 초과는 `error_code:"workspace_diff_pending"`.

### 22.7 Inbox, rate limit, live preview 터널

- **Inbox owner 검증** (797949): `tengu_humming_star`(기본 true). 받은 메시지가 `rc_owner`라고
  주장해도, 서버 공지가 그 `file_id`를 owner 것으로 미리 알리지 않았으면 제3자 메시지로 낮춘다
  (`tengu_inbox_owner_kind_unannounced`). 새 거부 사유 `no_bridge`, `base_url_override`. SPEC 36
  §16.4a는 `from="rc_owner"`만으로 충분하다고 적었다.
- **rate limit 중계** (238518): SDK 프레임 `rate_limit_event`와 `external_metadata.rate_limit_info`로
  사용량 한도를 폰에 알린다. †리셋 시각당 30초 throttle, 게이트 `tengu_composed_quail`.
- **live preview 터널** (725688, `chunk-hygz0amd`): SPEC 36은 구현이 없다고 했지만 2.1.300에
  들어 있다. `/anthropic.ccr.api.v1alpha2.tunnel.TunnelService/TunnelProxy`로 WebSocket을 열고
  GET/POST/DELETE를 `127.0.0.1:<port>`로 넘긴다(허용 포트 목록 밖이면 거부). †PTY 터널 거부,
  cookie·authorization 등 헤더 제거, WebSocket 터널 8개 한도. 지금은
  `claude mcp serve --transport http --session-tunnel`로만 쓰이고, `claude remote-control`의
  플래그는 여전히 거부된다.

### 22.8 전송 계층과 attestation

- **서버가 정하는 attestation 정책** (652728): SSE 응답 헤더
  `x-ccr-attestation-policy: v=1; mode=off|observe|enforce; level=…; accept=…`. 클라이언트는
  쿼리 `worker_capabilities=attestation-floor/1,worker-socket/1`로 지원을 알린다.
  `x-ccr-session-writers`(`owner_account_only`/`not_owner_only`)도 있다. bridge가 아닌 환경
  (클라우드 worker)에 적용되고, 로컬 bridge 자식은 13절대로 로컬 게이트를 따른다.
- `keep_alive`는 `CLAUDE_CODE_REMOTE_SEND_KEEPALIVES`가 있을 때만 보낸다(9절).
- †SPEC 36 §8과 다른 점: 상수 블록(실제 `je=2000`, `Ge=1.5`, 650583), terminal close 때 goodbye
  미전송, `live_only:true`인 `control_response`는 ephemeral이고 57,344바이트를 넘으면 에러로
  대체, init 실패 사유 `no_auth_headers`/`missing_epoch`.
- †명세가 없는 것: heartbeat 응답의 `event_flush_policy`, `release_lease:true` heartbeat,
  `CLAUDE_CODE_CCR_WORKER_SOCKET` WebSocket 프로토콜(`worker-socket/1`, 클라우드 전용).
- †`SessionsV2Client`: 413, 또는 `remote_tool_result_too_large`가 든 400이면
  `{outcome:"failed", tooLarge:true}`.

### 22.9 SPEC 36 자체의 낡은 부분

- 2.1.287 표기가 SPEC 36의 L501, L2380, L2669-2670, L4244, L4363, L6492에 남아 있다.
- †minified 이름 상당수가 이전 빌드 것이다(예 `mbr`→`Y0s`). 챕터의 함수 이름으로 grep하면 안
  맞을 수 있다.
- §20.3 게이트 표에 18절에 추가한 게이트들이 없다.
- §18.4의 `/clear` 수정 귀속, §10.3의 MCP 이름 표시 귀속이 틀렸다(21절).
