// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M4; Interfaces §E; decisions 21 and
// 22): ⌘K's artifacts. The search asks `library.list` with the query of this Mac and of each machine the conversation
// search asks, and keeps the machines that answered; Enter follows the artifact link's rule with the session on screen in
// the link's place, in four steps.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { tabId } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { artifactMachineOf, resetArtifactMachines } from '../artifacts/machines';
import { openArtifactTab } from '../library/actions';
import { registerPanelTool, resetPanelHost } from '../panel/host';
import { useLayout } from '../stores/layout';
import { activeTab, allTabs } from '../stores/layout-model';
import { resetShellStores } from '../test-support/shell-stores';
import { artifactId, countsOf, libraryRow } from '../test-support/remote-artifacts';
import { artifactsTool } from '../tools/artifacts/ArtifactsTool';
import { openPaletteArtifact, searchArtifacts } from './artifacts';

const THIRD = 'ThirdMachineRef0000000' as MachineRef;
const list = (rows: ReturnType<typeof libraryRow>[]) => ({ rows, counts: countsOf(rows) });

describe('the artifact search', () => {
  it('asks this Mac and each machine for the query, and keeps every machine that answered, this Mac first', async () => {
    const fake = fakeClient();
    const search = searchArtifacts(fake.client, 'plan', [OTHER_MACHINE, THIRD]);
    expect(fake.invoked('library.list')).toEqual([{ filter: { query: 'plan' } }, { filter: { query: 'plan' } }, { filter: { query: 'plan' } }]);
    expect(fake.machines('library.list')).toEqual([undefined, OTHER_MACHINE, THIRD]);
    await fake.reply('library.list', list([libraryRow(3, { title: 'Plan C' })]), 2); // the last answers first
    await fake.reply('library.list', list([libraryRow(1, { title: 'Plan A' })]));
    await fake.reply('library.list', list([]));
    expect(await search).toEqual({
      query: 'plan',
      groups: [
        { machine: TEST_MACHINE, rows: [libraryRow(1, { title: 'Plan A' })] },
        { machine: OTHER_MACHINE, rows: [] },
        { machine: THIRD, rows: [libraryRow(3, { title: 'Plan C' })] },
      ],
    });
  });

  it('leaves out, and says nothing of, a machine that does not answer, this Mac included, or whose call throws', async () => {
    const fake = fakeClient();
    const invoke = fake.client.invoke.bind(fake.client) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(fake.client, 'invoke').mockImplementation(((name: unknown, input: unknown, opts?: { machine?: MachineRef }) =>
      opts?.machine === THIRD ? Promise.reject(new Error('bridge gone')) : invoke(name, input, opts)) as never);
    const search = searchArtifacts(fake.client, '  plan ', [OTHER_MACHINE, THIRD]);
    expect(fake.invoked('library.list')).toEqual([{ filter: { query: 'plan' } }, { filter: { query: 'plan' } }]); // the text as the Library asks it
    await fake.fail('library.list', 'index unavailable', 'host_unavailable');
    await fake.reply('library.list', list([libraryRow(2, { title: 'Plan B' })])); // the control: an answer is kept
    expect(await search).toEqual({ query: '  plan ', groups: [{ machine: OTHER_MACHINE, rows: [libraryRow(2, { title: 'Plan B' })] }] });
  });
});

// Interfaces §E's four steps, one case each.
describe('Enter on an artifact', () => {
  const A = at('app-a' as AppSessionId);
  const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const DOC = artifactId(1);
  const artifactTab = (id: string, machine: MachineRef) => tabId({ kind: 'artifact', artifactId: id, machine });
  const sessionOnScreen = (id: AppSessionId) => useLayout.getState().openTab({ kind: 'session', appSessionId: id });
  const besideTheChat = (id: AppSessionId) => {
    const tab = useLayout.getState().panelBySession.get(id)?.tabs.find((t) => t.toolId === ARTIFACTS_TOOL_ID);
    return tab ? useLayout.getState().panelParams[tab.id] ?? null : null;
  };
  const mainArtifacts = () => allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact').map((t) => t.id);

  beforeEach(() => {
    resetShellStores();
    resetPanelHost();
    resetArtifactMachines();
  });

  it('first tells the page’s table which machine the artifact is on', () => {
    openPaletteArtifact(DOC, OTHER_MACHINE);
    expect(artifactMachineOf(DOC)).toBe(OTHER_MACHINE);
    openPaletteArtifact(DOC, TEST_MACHINE);
    expect(artifactMachineOf(DOC)).toBeNull(); // this Mac's
  });

  it('with a session on screen, brings forward the main tab that already shows it; once there is none, opens it beside the chat', () => {
    registerPanelTool(artifactsTool);
    openArtifactTab(DOC);
    sessionOnScreen(A);
    openPaletteArtifact(DOC, TEST_MACHINE);
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTab(DOC, TEST_MACHINE));
    expect(mainArtifacts()).toEqual([artifactTab(DOC, TEST_MACHINE)]);
    expect(besideTheChat(A)).toBeNull();
    useLayout.getState().closeTab(artifactTab(DOC, TEST_MACHINE)); // the control: with no such tab, the side column takes it
    sessionOnScreen(A);
    openPaletteArtifact(DOC, TEST_MACHINE);
    expect(besideTheChat(A)).toEqual({ target: DOC, machine: TEST_MACHINE });
  });

  it('with a session on screen whose side column can show the artifact on the artifact’s machine, opens it beside the chat', () => {
    registerPanelTool(artifactsTool);
    sessionOnScreen(REMOTE);
    openPaletteArtifact(DOC, OTHER_MACHINE);
    expect(besideTheChat(REMOTE)).toEqual({ target: DOC, machine: OTHER_MACHINE });
    expect(mainArtifacts()).toEqual([]);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${REMOTE}`);
  });

  // Decision Log 16 (iii): step 2 reuses a main tab only when it shows this artifact on the row's machine
  it('does not bring forward a main tab of another machine’s artifact with the same id; that machine’s own row does', () => {
    registerPanelTool(artifactsTool);
    openArtifactTab(DOC, undefined, OTHER_MACHINE); // the remote session's machine shows an artifact of the same id
    sessionOnScreen(REMOTE);
    openPaletteArtifact(DOC, TEST_MACHINE);
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTab(DOC, TEST_MACHINE));
    expect(mainArtifacts()).toEqual([artifactTab(DOC, OTHER_MACHINE), artifactTab(DOC, TEST_MACHINE)]);
    expect(besideTheChat(REMOTE)).toBeNull();
    sessionOnScreen(REMOTE);
    openPaletteArtifact(DOC, OTHER_MACHINE); // the control: the row of the tab's own machine brings it forward
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTab(DOC, OTHER_MACHINE));
    expect(besideTheChat(REMOTE)).toBeNull();
  });

  it('otherwise opens a main tab on the artifact’s machine: no session on screen, or a session on another machine than the artifact’s', () => {
    openPaletteArtifact(DOC, TEST_MACHINE); // no tool registered, no session on screen
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTab(DOC, TEST_MACHINE));
    registerPanelTool(artifactsTool);
    sessionOnScreen(REMOTE);
    const HERE = artifactId(2);
    openPaletteArtifact(HERE, TEST_MACHINE); // beside the remote session's chat the side column would read it on its machine
    expect(activeTab(useLayout.getState().main)?.id).toBe(artifactTab(HERE, TEST_MACHINE));
    expect(besideTheChat(REMOTE)).toBeNull();
    sessionOnScreen(REMOTE);
    openPaletteArtifact(artifactId(3), OTHER_MACHINE); // the control: on the session's machine it goes beside the chat
    expect(besideTheChat(REMOTE)).toEqual({ target: artifactId(3), machine: OTHER_MACHINE });
  });
});
