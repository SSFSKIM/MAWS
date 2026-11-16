// The guard of who sends as the person (UX wave U6e, board ticket 675; the architect's ruling D, condition 2). Every
// place in the repository's source that hands content to a send, a steer or the queue as a person's message, read off
// the source text: a site is a file and the verbs it holds, each verb a pattern of the chain from the window to the
// engine's stdin. The test (person-sends.test.ts) holds every site to a classification and fails on one it does not
// list, or on a count that moved.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const REPOSITORY = join(__dirname, '../..');

// The verbs, from the window inward:
export const VERBS = {
  // a content-carrying command named (sent, forwarded, offered, graded or handled): `session.send`, `session.steer`,
  // `session.queue.edit`
  command: /['"]session\.(?:send|steer|queue\.edit)['"]/g,
  // the window's human-prompt seams (composer/submit/send-human-prompt.ts, session/controls/controls-for.ts)
  seam: /\b(?:sendToSession|sendHumanPrompt|sendWithoutAcquiring|dispatchHumanPrompt)\(/g,
  // a session's controls port: its `send`, defined or called, and the host's own `send(content`
  port: /\bcontrols\??\.send\(|\bsend(?:\s*:\s*(?:async\s*)?\(|\s*\()\s*content\b/g,
  // a steer, called on the host, the queue or the agents tool's client
  steer: /\.steer\(/g,
  // the host's queue taking a message or an edit of one
  queue: /\bqueue\.(?:send|edit)\(/g,
  // the queue's preparation of a submission's content (the linked reads)
  prepare: /\bprepare\??:\s*\(content|\bdeps\.prepare\(/g,
  // a frame or a row given the person's origin
  frame: /origin:\s*\{\s*kind:\s*['"]human['"]/g,
  // a conversation's first message (the closing wave's item 4): a command that starts one named (`session.start`,
  // `session.fork`, `session.spawn` with its brief, `side.thread.open`), a start seam of the services or the window,
  // defined or called, and a first message composed in place
  start: /['"](?:session\.(?:start|fork|spawn)|side\.thread\.open)['"]/g,
  startSeam: /\b(?:startSession|forkSession)\(/g,
  firstMessage: /\bmessage:\s*\{\s*content\b/g,
} as const;
export type Verb = keyof typeof VERBS;
export type Site = { file: string; verbs: Partial<Record<Verb, number>> };

// The verbs one source text holds, with their counts; a text that holds none is no site.
export function sitesIn(source: string, file: string): Site | null {
  const verbs: Partial<Record<Verb, number>> = {};
  for (const [verb, pattern] of Object.entries(VERBS) as [Verb, RegExp][]) {
    const count = source.match(pattern)?.length ?? 0;
    if (count > 0) verbs[verb] = count;
  }
  return Object.keys(verbs).length > 0 ? { file, verbs } : null;
}

// Every site of the repository's source: src/ and apps/, TypeScript and JavaScript alike (apps/'s deploy probes are
// `.mjs`), tests, specs, fixtures, test supports, e2e trees, build output and declarations aside.
export function scanSends(root = REPOSITORY): Site[] {
  return ['src', 'apps'].flatMap((top) => listSources(join(root, top))).flatMap((path) => {
    const site = sitesIn(readFileSync(path, 'utf8'), relative(root, path).split(sep).join('/'));
    return site === null ? [] : [site];
  });
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'e2e', 'test-support', 'dist', 'out']);
function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : listSources(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec|fixture)\.|\.d\.[cm]?ts$/.test(entry.name) ? [path] : [];
  });
}
