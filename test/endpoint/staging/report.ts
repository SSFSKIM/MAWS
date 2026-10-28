// The staging phone run's report (P5 O13 M7, Interfaces §H): each check one line as it ends, then one line per item,
// `PASS <item>` when every check of it passed, `FAIL <item>` when one failed, and `NOT RUN` or `NOT SHOWN` with its reason
// for an item the run could not show (lane B before O10's feed, the push without a tunnel). A line names no secret: the
// checks' details are built from ids, counts and reasons.

export const ITEMS = ['registration', 'round-trip lane A', 'round-trip lane B', 'class-bound', 'push-owner-only', 'freeze-seam'] as const;
export type Item = (typeof ITEMS)[number];

type State = { checks: Array<{ ok: boolean }>; held?: { word: 'NOT RUN' | 'NOT SHOWN'; why: string } };

export class Report {
  readonly #items = new Map<Item, State>(ITEMS.map((item) => [item, { checks: [] }]));

  constructor(private readonly print: (line: string) => void) {}

  /** Runs one check of `item`: its detail when it passes, its error when it fails. Whether it passed. */
  async check(item: Item, check: string, run: () => Promise<string>): Promise<boolean> {
    try {
      const detail = await run();
      this.#items.get(item)!.checks.push({ ok: true });
      this.print(`  ok    ${item} · ${check}: ${detail}`);
      return true;
    } catch (error) {
      this.#items.get(item)!.checks.push({ ok: false });
      this.print(`  FAIL  ${item} · ${check}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** What an item's proof stands on beyond this run (another suite, the owner's word): said, not checked. */
  note(item: Item, text: string): void {
    this.print(`  note  ${item}: ${text}`);
  }

  /** The item cannot be shown by this run, and why: its summary says so instead of PASS. */
  hold(item: Item, word: 'NOT RUN' | 'NOT SHOWN', why: string): void {
    this.#items.get(item)!.held = { word, why };
  }

  /** One line per item, in §H's order; whether no item failed. */
  summary(): boolean {
    let ok = true;
    for (const item of ITEMS) {
      const { checks, held } = this.#items.get(item)!;
      const failed = checks.some((c) => !c.ok);
      if (failed) ok = false;
      if (failed) this.print(`FAIL ${item}`);
      else if (held) this.print(`${held.word} ${item}: ${held.why}`);
      else if (checks.length === 0) {
        ok = false;
        this.print(`FAIL ${item}: nothing was checked`);
      } else this.print(`PASS ${item}`);
    }
    return ok;
  }
}
