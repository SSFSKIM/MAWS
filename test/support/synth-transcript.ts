// The seeded synthetic transcript (C6 execution document, "Replay stub, synthetic fixtures and harness"): X1 events
// for a long session, deterministic per seed, used by the transcript harness (`synthetic/500`), the anchoring spike
// (G1) and the derivation performance test. Blocks stream as deltas before they complete, as a live session delivers
// them; with `streamLast`, the final answer is a long run of deltas one batch interval apart, for the player to release
// at sixty batches a second. Imported by the renderer harness too, so it uses nothing Node-only.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, ParentToolUseId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';

export interface SynthOptions {
  turns: number;
  seed: number;
  streamLast?: boolean;
}

export const STREAM_BATCH_INTERVAL_MS = 1000 / 60;

type Payload<K extends SessionEvent['kind']> = Omit<Extract<SessionEvent, { kind: K }>, 'id' | 'sessionId' | 'at' | 'seq' | 'agentId' | 'parentToolUseId' | 'kind'>;
interface Child {
  agentId: AgentId;
  parentToolUseId: ParentToolUseId;
}

const SESSION = 'synth-session' as SessionId;
const START = Date.parse('2026-09-01T08:30:00.000Z');
const USAGE = { inputTokens: 1200, outputTokens: 800, cacheReadInputTokens: 30_000, cacheCreationInputTokens: 0, thinkingTokens: null };
const MODEL = 'claude-opus-5-5';

// mulberry32: small, fast and good enough to vary a fixture.
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  return { next, int, pick };
}

const WORDS = [
  'the', 'renderer', 'derives', 'rows', 'from', 'events', 'and', 'keeps', 'each', 'turn', 'stable', 'while', 'a', 'stream',
  'arrives', 'below', 'session', 'store', 'reader', 'anchor', 'group', 'cell', 'detail', 'receipt', 'engine', 'wire', 'test',
  'fixture', 'budget', 'frame', 'scroll', 'offset', 'measure', 'layout', 'token', 'theme', 'highlight', 'parse', 'block', 'list',
];
const FILES = ['src/app.ts', 'src/store.ts', 'src/view/List.tsx', 'src/model/derive.ts', 'test/derive.test.ts', 'README.md', 'package.json', 'src/util/time.ts'];
const COMMANDS = ['pnpm test', 'pnpm lint', 'git status', 'ls -la src', 'pnpm typecheck', 'rg TODO src'];
const LANGUAGES = ['ts', 'py', 'json', 'sh'] as const;
const CODE: Record<(typeof LANGUAGES)[number], (n: number) => string> = {
  ts: (n) => `export function measure${n}(rows: number[]): number {\n  let total = 0;\n  for (const row of rows) total += row * ${n};\n  return total;\n}`,
  py: (n) => `def measure_${n}(rows):\n    total = 0\n    for row in rows:\n        total += row * ${n}\n    return total`,
  json: (n) => `{\n  "turn": ${n},\n  "rows": [1, 2, 3],\n  "stable": true\n}`,
  sh: (n) => `for i in $(seq 1 ${n % 9 + 1}); do\n  echo "row $i"\ndone | wc -l`,
};

export function synthesise({ turns, seed, streamLast = false }: SynthOptions): SessionEvent[] {
  const random = prng(seed);
  const events: SessionEvent[] = [];
  let clock = START;
  let child: Child | null = null;

  const emit = <K extends SessionEvent['kind']>(kind: K, payload: Payload<K>, at = clock) => {
    const seq = events.length;
    events.push({
      id: `e${seq}` as EventId, sessionId: SESSION, at: new Date(at).toISOString(), seq,
      agentId: child?.agentId ?? null, parentToolUseId: child?.parentToolUseId ?? null, kind, ...payload,
    } as unknown as SessionEvent);
  };
  const tick = (min: number, max: number) => (clock += random.int(min, max));

  const sentence = (min: number, max: number) => {
    const words = Array.from({ length: random.int(min, max) }, () => random.pick(WORDS));
    const text = words.join(' ');
    return `${text[0].toUpperCase()}${text.slice(1)}.`;
  };
  const paragraph = (sentences: number) => Array.from({ length: sentences }, () => sentence(6, 14)).join(' ');

  // One assistant block: deltas of a few characters each, then its complete event.
  const block = (api: ApiMessageId, index: number, type: 'text' | 'thinking', text: string, chunk: [number, number]) => {
    for (let at = 0; at < text.length; ) {
      const size = random.int(chunk[0], chunk[1]);
      const piece = text.slice(at, at + size);
      at += size;
      emit('assistant.block.delta', {
        apiMessageId: api, blockIndex: index, blockType: type, userMessageUuid: null, inputJsonDelta: null,
        textDelta: type === 'text' ? piece : null, thinkingDelta: type === 'thinking' ? piece : null,
      });
      tick(15, 60);
    }
    emit('assistant.block.complete', {
      messageUuid: `${api}-u${index}` as MessageUuid, apiMessageId: api, blockIndex: index, model: MODEL, supersedes: null, aborted: false,
      userMessageUuids: [], block: type === 'text' ? { type: 'text', text } : { type: 'thinking', thinking: text, signature: '' },
    });
  };

  const toolCall = (api: ApiMessageId, index: number, id: ToolUseId, name: string, input: Record<string, unknown>, result: { content: string; structured: unknown; denial?: 'permission-rule' }) => {
    emit('assistant.block.complete', {
      messageUuid: `${api}-u${index}` as MessageUuid, apiMessageId: api, blockIndex: index, model: MODEL, supersedes: null, aborted: false,
      userMessageUuids: [], block: { type: 'tool_use', id, name, input },
    });
    emit('tool.use', { toolUseId: id, toolName: name, input, apiMessageId: api, messageUuid: `${api}-u${index}` as MessageUuid });
    const seconds = random.int(1, 6);
    if (name === 'Bash') {
      for (let s = 1; s < seconds; s += 1) {
        tick(900, 1100);
        emit('tool.progress', { toolUseId: id, toolName: name, elapsedSeconds: s, taskId: null, heartbeat: true });
      }
    } else tick(200, 1500);
    emit('tool.result', {
      toolUseId: id, content: result.content, isError: result.denial !== undefined, structured: result.structured, spillPath: null,
      denial: result.denial ?? null, safeguard: 'not_evaluated', messageUuid: `${id}-result` as MessageUuid,
    });
  };

  // A tool of the given category with its input and a result in the engine's shapes (Surprises & Discoveries).
  const tool = (category: number, turn: number): [string, Record<string, unknown>, { content: string; structured: unknown }] => {
    const file = random.pick(FILES);
    switch (category) {
      case 0: return ['mcp__docs__search', { query: sentence(2, 4) }, { content: paragraph(2), structured: null }];
      case 1: return random.next() < 0.5
        ? ['Skill', { skill: 'test-driven-development' }, { content: 'Loaded.', structured: null }]
        : ['ToolSearch', { query: 'select:WebFetch' }, { content: 'Found 1 tool.', structured: { matches: ['WebFetch'] } }];
      case 2: {
        const added = random.int(1, 12);
        const removed = random.int(0, 6);
        const lines = [' context', ...Array.from({ length: removed }, (_, i) => `-old line ${i}`), ...Array.from({ length: added }, (_, i) => `+new line ${i} of turn ${turn}`), ' context'];
        const hunk = { oldStart: 10, oldLines: removed + 2, newStart: 10, newLines: added + 2, lines };
        return random.next() < 0.8
          ? ['Edit', { file_path: file, old_string: 'old', new_string: 'new' }, { content: `The file ${file} has been updated.`, structured: { filePath: file, structuredPatch: [hunk], userModified: false } }]
          : ['Write', { file_path: file, content: 'new' }, { content: `File created at ${file}.`, structured: { type: 'create', filePath: file, content: 'new', structuredPatch: [hunk], originalFile: null, userModified: false } }];
      }
      case 3: {
        const kind = random.pick(['Read', 'Read', 'Glob', 'Grep'] as const);
        if (kind === 'Grep') return ['Grep', { pattern: random.pick(WORDS), path: 'src' }, { content: `${file}:12: ${sentence(4, 8)}`, structured: null }];
        if (kind === 'Glob') return ['Glob', { pattern: 'src/**/*.ts' }, { content: FILES.join('\n'), structured: null }];
        return ['Read', { file_path: file }, { content: Array.from({ length: 12 }, (_, i) => `${i + 1}\t${sentence(3, 9)}`).join('\n'), structured: null }];
      }
      case 4: {
        const command = random.pick(COMMANDS);
        const stdout = Array.from({ length: random.int(2, 14) }, () => sentence(3, 10)).join('\n');
        return ['Bash', { command, description: sentence(3, 6) }, { content: stdout, structured: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false } }];
      }
      case 5: return random.next() < 0.5
        ? ['WebFetch', { url: 'https://example.com/docs/virtual', prompt: sentence(3, 6) }, { content: paragraph(3), structured: null }]
        : ['WebSearch', { query: sentence(2, 4) }, { content: paragraph(3), structured: null }];
      default: return ['TodoWrite', { todos: [{ content: sentence(3, 5), status: 'in_progress' }] }, { content: 'Todos updated.', structured: null }];
    }
  };

  const answer = (turn: number, sections: number) => {
    const parts: string[] = [];
    for (let s = 0; s < sections; s += 1) {
      const language = LANGUAGES[(turn + s) % LANGUAGES.length];
      parts.push(
        `## ${sentence(2, 5).slice(0, -1)}`,
        paragraph(random.int(1, 3)),
        Array.from({ length: random.int(2, 4) }, () => `- ${sentence(3, 8)}`).join('\n'),
        ['| Row | Height | Stable |', '| --- | --- | --- |', ...Array.from({ length: random.int(2, 4) }, (_, i) => `| ${i + 1} | ${random.int(20, 400)}px | ${random.next() < 0.8 ? 'yes' : 'no'} |`)].join('\n'),
        `\`\`\`${language}\n${CODE[language](turn + s)}\n\`\`\``,
      );
    }
    if (turn % 15 === 0) parts.push('The frame budget, per interval:', '$$\n\\frac{1}{60}\\,\\mathrm{s} \\approx 16.7\\,\\mathrm{ms}, \\quad p_{95} \\le 17\\,\\mathrm{ms}\n$$');
    if (turn % 25 === 0) parts.push('How a batch reaches the list:', '```mermaid\nflowchart LR\n  Engine --> Host --> Store --> List\n  List --> Reader\n```');
    parts.push(paragraph(1));
    return parts.join('\n\n');
  };

  const subagents = (turn: number, api: ApiMessageId, firstIndex: number) => {
    for (let a = 0; a < 2; a += 1) {
      const toolUseId = `toolu_${turn}_agent${a}` as ToolUseId;
      const description = `Survey ${random.pick(FILES)} for ${random.pick(WORDS)}`;
      toolCall(api, firstIndex + a, toolUseId, 'Agent', { description, prompt: sentence(6, 12), subagent_type: 'general-purpose' }, {
        content: 'Async agent launched successfully.', structured: { agentId: `a${turn}x${a}`, status: 'async_launched', isAsync: true },
      });
      const taskId = `task_${turn}_${a}` as TaskId;
      emit('subagent.started', { taskId, toolUseId, description, subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: null });
      child = { agentId: `a${turn}x${a}` as AgentId, parentToolUseId: toolUseId as string as ParentToolUseId };
      const steps = random.int(5, 20);
      for (let step = 0; step < steps; ) {
        const childApi = `msg_${turn}_c${a}_${step}` as ApiMessageId;
        if (step % 3 === 2) {
          emit('assistant.block.complete', {
            messageUuid: `${childApi}-u0` as MessageUuid, apiMessageId: childApi, blockIndex: 0, model: MODEL, supersedes: null, aborted: false,
            userMessageUuids: [], block: { type: 'text', text: sentence(5, 12) },
          });
          step += 1;
        } else {
          const [name, input, result] = tool(3, turn);
          toolCall(childApi, 0, `toolu_${turn}_c${a}_${step}` as ToolUseId, name, input, result);
          step += 3;
        }
        tick(300, 2000);
      }
      child = null;
      emit('subagent.progress', { taskId, description, usage: { totalTokens: 4000, toolUses: steps, durationMs: 9000 }, lastToolName: 'Read', summary: null });
      emit('subagent.finished', { taskId, status: 'completed', summary: sentence(4, 8), outputFile: null, reason: null });
    }
  };

  for (let turn = 1; turn <= turns; turn += 1) {
    const last = turn === turns;
    // Most turns follow within minutes; some after hours or days, so time separators appear.
    clock += random.next() < 0.12 ? random.int(2 * 3_600_000, 30 * 3_600_000) : random.int(20_000, 15 * 60_000);
    const turnStart = clock;
    const userUuid = `u${turn}` as MessageUuid;
    emit('turn.started', { userMessageUuid: userUuid, origin: 'human' });
    const lines = random.int(1, 20);
    emit('user.message', {
      messageUuid: userUuid, content: Array.from({ length: lines }, () => sentence(4, 12)).join('\n'),
      isReplay: false, isSynthetic: false, origin: 'human', bash: null,
    });
    tick(500, 2000);

    let message = 0;
    const nextApi = () => `msg_${turn}_${message++}` as ApiMessageId;
    block(nextApi(), 0, 'thinking', paragraph(random.int(2, 4)), [10, 30]);

    const groups = random.int(0, 3);
    const categories: number[] = [];
    if (turn % 5 === 0) categories.push(2); // a receipt every fifth turn
    let denied = turn % 40 === 0; // a denial every fortieth turn
    const denials: { toolName: string; toolUseId: ToolUseId; toolInput: unknown }[] = [];
    for (let g = 0; g < Math.max(groups, categories.length, denied ? 1 : 0); g += 1) {
      const api = nextApi();
      block(api, 0, 'text', sentence(5, 12), [10, 30]); // commentary before the group
      const calls = random.int(g === 0 && denied ? 2 : 1, 8);
      for (let c = 0; c < calls; c += 1) {
        const category = categories.shift() ?? random.int(0, 6);
        const id = `toolu_${turn}_${g}_${c}` as ToolUseId;
        const [name, input, result] = tool(category, turn);
        if (denied && c === 1) {
          denied = false;
          denials.push({ toolName: name, toolUseId: id, toolInput: input });
          toolCall(api, c + 1, id, name, input, { content: 'Permission to use this tool was denied.', structured: null, denial: 'permission-rule' });
        } else toolCall(api, c + 1, id, name, input, result);
      }
    }
    if (turn % 10 === 0) subagents(turn, nextApi(), 0);

    const api = nextApi();
    if (last && streamLast) {
      // The streamed tail: one text block, deltas of a few characters one batch interval apart.
      const text = answer(turn, 30);
      const start = clock + 1000;
      let at = 0;
      for (let n = 0; at < text.length; n += 1) {
        const size = random.int(4, 8);
        emit('assistant.block.delta', {
          apiMessageId: api, blockIndex: 0, blockType: 'text', textDelta: text.slice(at, at + size), thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null,
        }, start + n * STREAM_BATCH_INTERVAL_MS);
        at += size;
        clock = start + n * STREAM_BATCH_INTERVAL_MS;
      }
      clock += STREAM_BATCH_INTERVAL_MS;
      emit('assistant.block.complete', {
        messageUuid: `${api}-u0` as MessageUuid, apiMessageId: api, blockIndex: 0, model: MODEL, supersedes: null, aborted: false,
        userMessageUuids: [], block: { type: 'text', text },
      });
    } else block(api, 0, 'text', answer(turn, random.int(1, 2)), [12, 30]);

    tick(100, 400);
    emit('usage.sample', { costUsd: 0.02 * turn, usage: USAGE, modelUsage: {}, source: 'result' });
    emit('turn.ended', {
      result: 'success', isError: false, terminalReason: 'completed', resultText: null, durationMs: clock - turnStart, numTurns: message,
      costUsd: 0.02, usage: USAGE, permissionDenials: denials, errors: [], userMessageUuids: [userUuid], origin: 'human', resultIndex: null, isEchoReceipt: false,
    });
    if (turn % 200 === 0) {
      tick(1000, 5000);
      emit('boundary.compaction', { trigger: 'auto', preTokens: 160_000, postTokens: 24_000, logicalParentUuid: userUuid, historical: false });
    }
  }
  return events;
}
