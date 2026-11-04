// A session's task list id as the engine names its directory (SPEC 20 §20.2.2; C8b): the list a status's `taskListId`
// names, or a record's engine session id, with every character outside `[A-Za-z0-9_-]` made `-`. P5 O7 M8: the
// endpoint's `task-list` target rule and lane B's stream (its `tasks` part) read a session's list by it, as the
// renderer's task panel does (src/renderer/src/tools/agents/model/task-list.ts).
export function sanitiseListId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}
