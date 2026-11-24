// Board tickets 421 and 420 (docs/doperpowers/plans/2026-11-23-tool-choice.md, "The groups", Interfaces §A, M1): one
// session's set of MAWS's tools, the groups its switches govern and what `tools/list` names for it.
import { describe, expect, it } from 'vitest';
import { MAWS_TOOL_NAMES, type MawsToolName } from './tools';
import { FULL_MAWS_TOOL_SET, isFullSet, listedTools, MAWS_TOOL_GROUP, MawsToolSetSchema, withArtifacts, type MawsToolGroup, type MawsToolSet } from './tool-set';

const namesOf = (group: MawsToolGroup): MawsToolName[] => MAWS_TOOL_NAMES.filter((name) => MAWS_TOOL_GROUP[name] === group);
const set = (over: Partial<MawsToolSet>): MawsToolSet => ({ ...FULL_MAWS_TOOL_SET, ...over });

describe('the groups (the plan’s table, after ticket 848)', () => {
  it('names each group’s tools, and every tool of the server has one', () => {
    expect(namesOf('artifacts')).toEqual(['artifact_create', 'artifact_list', 'artifact_screenshot', 'artifact_describe_type', 'artifact_read', 'artifact_publish', 'artifact_upload_asset', 'artifact_list_assets', 'artifact_export', 'artifact_search', 'artifact_delete']);
    expect(namesOf('documents')).toEqual(['artifact_edit', 'artifact_comments', 'artifact_reply', 'artifact_resolve']);
    expect(namesOf('dashboards')).toEqual(['artifact_dataset']);
    expect(namesOf('auxiliary')).toEqual(['show_pane']);
    expect(namesOf('question')).toEqual(['ask']);
    expect(Object.keys(MAWS_TOOL_GROUP).sort()).toEqual([...MAWS_TOOL_NAMES].sort());
  });
});

describe('the set', () => {
  it('the full set is every switch on and MAWS’s question, and is the one full set', () => {
    expect(FULL_MAWS_TOOL_SET).toEqual({ artifacts: true, documents: true, dashboards: true, auxiliary: true, question: 'maws' });
    expect(isFullSet(FULL_MAWS_TOOL_SET)).toBe(true);
    for (const off of [{ artifacts: false, documents: false, dashboards: false }, { documents: false }, { dashboards: false }, { auxiliary: false }, { question: 'engine' as const }]) expect(isFullSet(set(off))).toBe(false);
  });

  it('refuses documents or dashboards without artifacts, and an unknown key or question tool', () => {
    expect(MawsToolSetSchema.safeParse(set({ artifacts: false, documents: false, dashboards: false })).success).toBe(true);
    for (const bad of [set({ artifacts: false, dashboards: false }), set({ artifacts: false, documents: false })]) {
      expect(MawsToolSetSchema.safeParse(bad).error?.issues.map((issue) => issue.message)).toEqual(['documents and dashboards need artifacts']);
    }
    expect(MawsToolSetSchema.safeParse({ ...FULL_MAWS_TOOL_SET, browser: true }).success).toBe(false);
    expect(MawsToolSetSchema.safeParse({ ...FULL_MAWS_TOOL_SET, question: 'sminos' }).success).toBe(false);
  });

  it('withArtifacts: off takes documents and dashboards with it; on brings both back', () => {
    const off = withArtifacts(set({ question: 'engine', auxiliary: false }), false);
    expect(off).toEqual({ artifacts: false, documents: false, dashboards: false, auxiliary: false, question: 'engine' });
    expect(withArtifacts(off, true)).toEqual({ artifacts: true, documents: true, dashboards: true, auxiliary: false, question: 'engine' });
    expect(MawsToolSetSchema.parse(off)).toEqual(off);
  });
});

describe('listedTools: what tools/list names for a set, in MAWS_TOOL_NAMES order', () => {
  it('the full set lists every tool', () => {
    expect(listedTools(FULL_MAWS_TOOL_SET)).toEqual([...MAWS_TOOL_NAMES]);
  });

  it('each switch off removes exactly its group', () => {
    const without = (group: MawsToolGroup) => MAWS_TOOL_NAMES.filter((name) => MAWS_TOOL_GROUP[name] !== group);
    expect(listedTools(set({ documents: false }))).toEqual(without('documents'));
    expect(listedTools(set({ dashboards: false }))).toEqual(without('dashboards'));
    expect(listedTools(set({ auxiliary: false }))).toEqual(without('auxiliary'));
    expect(listedTools(set({ question: 'engine' }))).toEqual(without('question'));
    expect(listedTools(withArtifacts(FULL_MAWS_TOOL_SET, false))).toEqual(['ask', 'show_pane']);
  });

  it('everything off lists nothing', () => {
    expect(listedTools({ artifacts: false, documents: false, dashboards: false, auxiliary: false, question: 'engine' })).toEqual([]);
  });
});
