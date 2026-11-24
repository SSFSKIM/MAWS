// Board tickets 421 and 420 (docs/doperpowers/plans/2026-11-23-tool-choice.md, "The groups" and Interfaces §A): one
// session's choice of MAWS's own tools, four switches and the question tool, fixed when the session starts (D1). The
// engine host lists a session's tools and writes its instructions from its set (D2); every place a set is stored or sent
// leaves it out at the full set, so absent means the full set (D3). `question: 'engine'` lists no `ask` and leaves the
// engine's own question tools as the engine offers them (D6). The canonical form has no "documents or dashboards on,
// artifacts off": the schema refuses it, and a control turns artifacts through `withArtifacts`.
import * as z from 'zod';
import { MAWS_TOOL_NAMES, type MawsToolName } from './tools';

export const MAWS_QUESTION_TOOLS = ['engine', 'maws'] as const;

export const MawsToolSetSchema = z
  .strictObject({
    artifacts: z.boolean(),
    documents: z.boolean(),
    dashboards: z.boolean(),
    auxiliary: z.boolean(),
    question: z.enum(MAWS_QUESTION_TOOLS),
  })
  .refine((set) => set.artifacts || (!set.documents && !set.dashboards), { message: 'documents and dashboards need artifacts' });
export type MawsToolSet = z.infer<typeof MawsToolSetSchema>;

export const FULL_MAWS_TOOL_SET: MawsToolSet = Object.freeze({ artifacts: true, documents: true, dashboards: true, auxiliary: true, question: 'maws' });

export const isFullSet = (set: MawsToolSet): boolean =>
  set.artifacts && set.documents && set.dashboards && set.auxiliary && set.question === 'maws';

export type MawsToolGroup = 'artifacts' | 'documents' | 'dashboards' | 'auxiliary' | 'question';

// Which switch governs each tool. Documents is `artifact_edit` (a document's and a dashboard's blocks) and the three
// comment tools (every kind's threads); Dashboards is the data binding alone (the plan's check of the groups). A tool
// added to the server does not compile until it has a group here.
export const MAWS_TOOL_GROUP = {
  ask: 'question',
  show_pane: 'auxiliary',
  artifact_create: 'artifacts',
  artifact_list: 'artifacts',
  artifact_screenshot: 'artifacts',
  artifact_describe_type: 'artifacts',
  artifact_read: 'artifacts',
  artifact_publish: 'artifacts',
  artifact_upload_asset: 'artifacts',
  artifact_list_assets: 'artifacts',
  artifact_export: 'artifacts',
  artifact_dataset: 'dashboards',
  artifact_edit: 'documents',
  artifact_comments: 'documents',
  artifact_reply: 'documents',
  artifact_resolve: 'documents',
  artifact_search: 'artifacts',
  artifact_delete: 'artifacts',
} as const satisfies Record<MawsToolName, MawsToolGroup>;

const groupOn = (set: MawsToolSet, group: MawsToolGroup): boolean => (group === 'question' ? set.question === 'maws' : set[group]);

/** What `tools/list` names for a session with this set, in MAWS_TOOL_NAMES order. */
export const listedTools = (set: MawsToolSet): MawsToolName[] => MAWS_TOOL_NAMES.filter((name) => groupOn(set, MAWS_TOOL_GROUP[name]));

/** Artifacts turned on or off: off turns documents and dashboards off with it, on turns both on. */
export const withArtifacts = (set: MawsToolSet, on: boolean): MawsToolSet => ({ ...set, artifacts: on, documents: on, dashboards: on });
