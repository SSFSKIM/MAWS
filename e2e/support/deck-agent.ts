// The deck's agent through the host's scale seam (P3-C M10's row 2, moved here by P4-B2 M0 so the drag spec shares it;
// docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D17, the tracker's seam row of 2026-10-18): an agent session
// whose `artifact_read` and `artifact_publish` are A's real tools run in the engine host by
// `src/engine-host/presentations/scale-seam.ts` (started under MAWS_E2E=1 and MAWS_PRESENTATIONS_SCALE=1), so every
// publish is A's `publishDoc` over the deck's three-way publish, reaching the editor's replica through the host as an
// agent's does. The workload: one slide at a time, its first font size stepped (64 → 65 → 64 …), every `everyMs`.
// `fidelityProblems` is the drag's fidelity regression: the publishes were the host's (each answered with a rising
// revision), reached the tab's replica as remote applies (P4-B2 M6: every publish's row integrated, since the gesture
// hold applies those it held merged into one update at the drop), and are what the deck reads back.
// Free of Playwright, so test/support/deck-agent.test.ts runs it against a fake seam.

/** The agent's session name in the host's seam. */
export const DECK_AGENT = 'deck-agent';

/** The host loop around a call, as the seam answers it (`LoopStats` in src/engine-host/documents/kinds/document-perf.ts). */
export interface HostLoop {
  max: number;
  p99: number;
  mean: number;
}

/** A tool call's answer from the seam (`DeckCallAnswer` in the host's scale-seam.ts). */
export interface DeckCall<R> {
  ok: true;
  isError: boolean;
  result?: R;
  text: string;
  wallMs: number;
  loop: HostLoop;
  busyMs: number;
}
export type ReadResult = { revision: number; files: Record<string, string> };
export type PublishResult = { revision: number; changed: string[] };

/** The seam's file channel (`PerfSeam` in e2e/support/document-scale.ts). */
export interface DeckChannel {
  send<T>(command: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

// The font size the agent steps: a file's first whole px size, as the kind writes a style (`name:value`, no space).
const STEPPED = /font-size:(\d+)px/;

/** The font size the agent steps in a file (its first whole px size), or null when it has none. */
export function firstFontSize(file: string): number | null {
  const size = STEPPED.exec(file);
  return size ? Number(size[1]) : null;
}

/** The agent's view of the deck: its last read's files, updated by what it publishes, and the last revision it saw. */
export class DeckAgent {
  files: Record<string, string> = {};
  revision = 0;
  private turn = 0;
  constructor(
    private readonly seam: DeckChannel,
    readonly artifactId: string,
    readonly session: string = DECK_AGENT,
  ) {}

  async read(): Promise<DeckCall<ReadResult>> {
    const answer = await this.seam.send<DeckCall<ReadResult>>({ cmd: 'call', session: this.session, tool: 'artifact_read', args: { artifact: this.artifactId } });
    if (answer.isError) throw new Error(`the agent's read was refused: ${answer.text}`);
    this.files = { ...answer.result!.files };
    this.revision = answer.result!.revision;
    return answer;
  }

  /** One publish of `paths`, each slide's first font size stepped (up on odd turns, down on even), from the revision it last saw. */
  async publish(paths: string[]): Promise<DeckCall<PublishResult>> {
    this.turn += 1;
    const sent: Record<string, string> = {};
    for (const path of paths) {
      const file = this.files[path];
      const stepped = file?.replace(STEPPED, (_m, size: string) => `font-size:${this.turn % 2 === 1 ? Number(size) + 1 : Number(size) - 1}px`);
      if (file === undefined || stepped === undefined || stepped === file) throw new Error(`${path} has no font size to step`);
      sent[path] = stepped;
    }
    const answer = await this.seam.send<DeckCall<PublishResult>>({ cmd: 'call', session: this.session, tool: 'artifact_publish', args: { artifact: this.artifactId, baseRevision: 'last', files: sent } });
    if (answer.isError) throw new Error(`the agent's publish was refused: ${answer.text}`);
    const changed = [...answer.result!.changed].sort();
    const asked = [...paths].sort();
    if (changed.join('\n') !== asked.join('\n')) throw new Error(`the agent's publish changed ${changed.join(', ')}, not ${asked.join(', ')}`);
    Object.assign(this.files, sent);
    this.revision = answer.result!.revision;
    return answer;
  }

  slidePaths(): string[] {
    return Object.keys(this.files)
      .filter((path) => path.startsWith('project/slides/'))
      .sort();
  }

  /** The session's end: its replicas closed in the host. */
  release(): Promise<unknown> {
    return this.seam.send({ cmd: 'release', session: this.session });
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The agent republishing one slide every `everyMs` (the second slide on, round robin) until `until` settles. */
export async function republishing(agent: DeckAgent, until: Promise<unknown>, everyMs: number, sleep: (ms: number) => Promise<void> = pause): Promise<DeckCall<PublishResult>[]> {
  let done = false;
  const settle = () => (done = true);
  void until.then(settle, settle);
  const slides = agent.slidePaths().slice(1);
  const answers: DeckCall<PublishResult>[] = [];
  for (let k = 0; !done; k++) {
    await sleep(everyMs);
    if (done) break;
    answers.push(await agent.publish([slides[k % slides.length]!]));
  }
  return answers;
}

export interface FidelityInput {
  /** The revision the agent last saw before the drag. */
  revisionBefore: number;
  /** The drag's publishes, in order. */
  published: DeckCall<PublishResult>[];
  /**
   * The updates of other origins the tab's replica applied over the drag and after its drop (the drag probe's). P4-B2
   * M6: the gesture hold applies the publishes it held at the drop merged into one, so this counts no publish.
   */
  remoteApplies: number;
  /** M6: the highest row the tab's replica integrated, read after the drop (the seam's `frames`). */
  integrated: number;
  /** What the agent last published of each file. */
  agentFiles: Record<string, string>;
  /** The deck's files read back after the drop. */
  readBack: Record<string, string>;
}

/** What makes a drag's agent not the product's (none when faithful): its publishes, the tab's applies, the read-back. */
export function fidelityProblems({ revisionBefore, published, remoteApplies, integrated, agentFiles, readBack }: FidelityInput): string[] {
  if (published.length === 0) return ['the agent published nothing during the drag'];
  const problems: string[] = [];
  let last = revisionBefore;
  published.forEach((answer, i) => {
    const revision = answer.result!.revision;
    if (!(revision > last)) problems.push(`publish ${i + 1} answered revision ${revision}, not above ${last}`);
    last = Math.max(last, revision);
  });
  // M6: every publish's row integrated (rows arrive in order: reaching the last one's is reaching them all), as remote
  if (integrated < last) problems.push(`the tab’s replica integrated rows through ${integrated}, not the last publish’s ${last}`);
  if (remoteApplies === 0) problems.push('the tab’s replica applied no remote update');
  const paths = [...new Set(published.flatMap((answer) => answer.result!.changed))].sort();
  for (const path of paths) {
    const want = firstFontSize(agentFiles[path] ?? '');
    const got = firstFontSize(readBack[path] ?? '');
    if (got !== want) problems.push(`${path} reads back font size ${got ?? 'none'}, the agent last published ${want ?? 'none'}`);
  }
  return problems;
}
