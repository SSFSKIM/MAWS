// The agent listing under a steady write load: a bound session with about 4,000 agent files under `subagents/` (half
// transcripts, half metas, a third of them under workflow runs) while agents append, metas are rewritten and new agents
// arrive at a steady rate, each write reported as the watcher would report it. It counts the walks of the whole tree and
// the process CPU (user and system, so the libuv pool's reads count) the service spends over the writer's own, until the
// service has caught up. Timing only, so it runs on request:
// `MAWS_BENCH=1 pnpm exec vitest run src/engine-host/fs/subagents-bench.test.ts` (MAWS_BENCH_AGENTS, _RATE and _SECONDS
// resize it), each number printed with the 1-minute load average beside it.
import { EventEmitter } from 'node:events';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import { StoreFixture } from '../../../test/support/store-fixture';
import { FsService } from './service';
import { SubagentReader } from './subagents';
import type { WatchFn } from './watcher';

const S1 = '11111111-1111-4111-8111-111111111111' as SessionId;
const A1 = 'app-1' as AppSessionId;
const AGENTS = Number(process.env.MAWS_BENCH_AGENTS ?? 2_000); // two files each
const RATE = Number(process.env.MAWS_BENCH_RATE ?? 10); // writes per second
const SECONDS = Number(process.env.MAWS_BENCH_SECONDS ?? 20);
const QUIET_MS = 1_500; // no walk or pass for this long once the writes stop: the service has caught up

const line = (text: string) => `${JSON.stringify({ type: 'user', uuid: `u-${text}`, parentUuid: null, cwd: '/work/a', timestamp: '2026-10-31T10:00:00.000Z', message: { role: 'user', content: text } })}\n`;
const meta = (id: number, extra: object = {}) => JSON.stringify({ agentType: 'workflow-subagent', description: `agent ${id}`, toolUseId: `toolu_${id}`, spawnDepth: 1, ...extra });
const agentDir = (id: number) => (id % 3 === 0 ? `subagents/workflows/wf_${id % 20}` : 'subagents');
const report = (name: string, value: unknown) => console.log(`[relist bench] ${name}: ${JSON.stringify(value)} (load ${loadavg()[0]!.toFixed(1)})`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cpuMs = (since: NodeJS.CpuUsage) => {
  const used = process.cpuUsage(since);
  return Math.round((used.user + used.system) / 1000);
};
const keyOf = (agents: readonly SubagentEntry[]) => JSON.stringify(agents.map(({ agentId, transcriptPath, runId, meta }) => [agentId, transcriptPath, runId, meta]));

describe.skipIf(process.env.MAWS_BENCH !== '1')('the agent listing under a steady write load', () => {
  it(`${AGENTS * 2} agent files, ${RATE} writes/s for ${SECONDS} s`, { timeout: 30 * 60_000 }, async () => {
    const fixture = await StoreFixture.create();
    const transcript = await fixture.addTranscript('/work/a', S1, [line('parent').trimEnd()]);
    const sessionDir = join(dirname(transcript), S1);
    for (let id = 0; id < AGENTS; id += 1) {
      await fixture.addSidecar(S1, `${agentDir(id)}/agent-a${id}.jsonl`, line(`prompt ${id}`));
      await fixture.addSidecar(S1, `${agentDir(id)}/agent-a${id}.meta.json`, meta(id));
    }

    // One write load, reported through `fire`; the same schedule with nothing listening is the writer's own cost.
    let next = AGENTS;
    const writes = async (fire: (path: string) => void) => {
      const started = performance.now();
      for (let n = 0; n < RATE * SECONDS; n += 1) {
        const roll = n % 10;
        if (roll === 0) {
          const id = next++; // a new agent: its transcript, then its meta
          const path = join(sessionDir, agentDir(id), `agent-a${id}.jsonl`);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, line(`prompt ${id}`));
          fire(path);
          await writeFile(join(sessionDir, agentDir(id), `agent-a${id}.meta.json`), meta(id));
          fire(join(sessionDir, agentDir(id), `agent-a${id}.meta.json`));
        } else if (roll === 5) {
          const id = next - 1 - (n % 50); // a recent agent's meta patched (its end, say)
          await writeFile(join(sessionDir, agentDir(id), `agent-a${id}.meta.json`), meta(id, { stoppedByUser: n % 20 === 5 }));
          fire(join(sessionDir, agentDir(id), `agent-a${id}.meta.json`));
        } else {
          const id = next - 1 - (n % 50); // one of the fifty most recent agents appends
          const path = join(sessionDir, agentDir(id), `agent-a${id}.jsonl`);
          await appendFile(path, line(`turn ${n}`));
          fire(path);
        }
        const due = started + ((n + 1) * 1000) / RATE;
        await sleep(Math.max(0, due - performance.now()));
      }
    };

    const control = process.cpuUsage();
    await writes(() => {});
    const writerCpuMs = cpuMs(control);

    let listener: ((event: string, filename: string | null) => void) | null = null;
    const watch: WatchFn = (path, _options, onEvent) => {
      if (path === fixture.paths.projects) listener = onEvent;
      return Object.assign(new EventEmitter(), { close: vi.fn() });
    };
    const original = SubagentReader.prototype.list;
    let walks = 0;
    let busy = 0;
    let lastActivity = performance.now();
    const track = <T>(work: Promise<T>) => {
      busy += 1;
      return work.finally(() => {
        busy -= 1;
        lastActivity = performance.now();
      });
    };
    const list = vi.spyOn(SubagentReader.prototype, 'list').mockImplementation(function (this: SubagentReader, dir: string) {
      walks += 1;
      return track(original.call(this, dir));
    });
    const proto = SubagentReader.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const originalUpdate = proto.update; // the incremental pass, where there is one
    let updates = 0;
    const update = originalUpdate === undefined ? null : vi.spyOn(proto, 'update').mockImplementation(function (this: unknown, ...args: unknown[]) {
      updates += 1;
      return track(originalUpdate.apply(this, args));
    });
    const changed: SubagentEntry[][] = [];
    const service = new FsService({ paths: fixture.paths, watch, emit: (name, payload) => (name === 'fs.subagentsChanged' && changed.push((payload as { agents: SubagentEntry[] }).agents), true) });
    try {
      await service.start();
      await service.bind([{ sessionId: S1, appSessionId: A1 }]);
      const single = performance.now();
      const singleCpu = process.cpuUsage();
      const baseline = await service.subagents(A1); // the renderer's first read
      report('one walk', { agents: baseline.agents.length, wallMs: Math.round(performance.now() - single), cpuMs: cpuMs(singleCpu) });
      await sleep(QUIET_MS);
      walks = 0;
      updates = 0;

      const cpu = process.cpuUsage();
      const t0 = performance.now();
      await writes((path) => listener!('change', relative(fixture.paths.projects, path)));
      const writesDone = performance.now();
      const walksDuringWrites = walks;
      while (busy > 0 || performance.now() - lastActivity < QUIET_MS) await sleep(100);
      const caughtUp = lastActivity;
      const serviceCpuMs = cpuMs(cpu) - writerCpuMs;
      report('result', {
        writes: RATE * SECONDS,
        walksDuringWrites,
        walks,
        incrementalPasses: updates,
        drainMs: Math.round(Math.max(0, caughtUp - writesDone)),
        wallMs: Math.round(caughtUp - t0),
        writerCpuMs,
        serviceCpuMs,
        serviceCpuShare: `${Math.round((serviceCpuMs / (caughtUp - t0)) * 100)}%`,
      });
      // Caught up: the last change event names the agents a fresh walk finds.
      expect(keyOf(changed.at(-1) ?? [])).toBe(keyOf(await new SubagentReader().list(sessionDir)));
    } finally {
      service.stop();
      list.mockRestore();
      update?.mockRestore();
      await fixture.dispose();
    }
  });
});
