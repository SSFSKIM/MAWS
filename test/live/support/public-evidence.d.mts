type Env = Record<string, string | undefined>;
export function createRedactor(env: Env): (text: string) => string;
export function redactJournal(text: string, env?: Env): string;
export function sittingLog(dir: string, sitting: string, env?: Env): (line: string) => void;
