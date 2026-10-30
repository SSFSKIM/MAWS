import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_FIXTURE_DIR } from '../../../../../test/support/fixtures';
import { at } from '../../../../../test/support/machine';
import { loadScenario } from '../../../../../test/support/scenario';
import { EngineSessionStatusSchema } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import { useSessions } from '../../stores/sessions';
import { FAKE_RECORDS, fakeId, seedFakeSessions } from './fakeSessions';

// P5 O6 M2: the page holds the local machine's addresses of the scenario's bare ids.
const addressedRecord = (r: SessionRecord): SessionRecord => ({
  ...r,
  appId: at(r.appId),
  projectId: r.projectId === null ? null : at(r.projectId),
  lineage: r.lineage && { ...r.lineage, parentAppSessionId: at(r.lineage.parentAppSessionId) },
});

describe('panel harness scenario', () => {
  it('is a scenario main’s stub source accepts, and the page’s fake records are its sessions A and B, addressed', () => {
    const scenario = loadScenario(join(TEST_FIXTURE_DIR, 'panel/harness-sessions.json'));
    expect(scenario.sessions.map((r) => r.appId)).toEqual(['A', 'B']);
    expect([...FAKE_RECORDS.values()]).toEqual(scenario.sessions.map(addressedRecord));
    expect([fakeId('A'), fakeId('B')]).toEqual([at('A'), at('B')]);
    expect(FAKE_RECORDS.get(at(scenario.sessions[1].appId))!.worktree).toEqual({ path: '/tmp/maws-harness/b', branch: 'harness' });
  });

  it('seeds A live with a shell and a workflow in the background and B disk-only, with the scenario’s digests (M2)', () => {
    const scenario = loadScenario(join(TEST_FIXTURE_DIR, 'panel/harness-sessions.json'));
    const projectsVersion = useSessions.getState().projectsVersion;
    seedFakeSessions();
    const { engine, digests, records, projects } = useSessions.getState();
    expect([...projects.values()]).toEqual(scenario.projects.map((project) => ({ ...project, id: at(project.id) })));
    expect(useSessions.getState().projectsVersion).toBe(projectsVersion + 1);
    expect([...records.values()].every((record) => record.projectId !== null && projects.has(record.projectId))).toBe(true);
    expect([...engine.keys()]).toEqual([at('A')]);
    expect(EngineSessionStatusSchema.safeParse(engine.get(fakeId('A'))).success).toBe(true);
    expect(engine.get(fakeId('A'))!.backgroundTasks.map((t) => t.taskType)).toEqual(['local_bash', 'local_workflow']);
    expect(digests.get(fakeId('A'))!.childAgents).toEqual({ active: 2, done: 1 });
  });
});
