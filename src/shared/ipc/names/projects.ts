// X2 `projects.*` names without their schemas (`../names.ts`; the project registry's M12). Exactly the keys of
// `../schema/projects.ts`. Every one is main-only: the `maws` command line and the attached app reach them on `mawsd`'s
// machine socket, never a window; the act request is main's to show, through its own `org.projectActs.*`.
export const commands = [] as const;

export const events = [] as const;

export const mainOnlyCommands = ['projects.registry', 'projects.forward', 'projects.act.answer'] as const;

export const mainOnlyEvents = ['projects.act.request'] as const;
