// P4-A2 G2.7 (X35): the slide layer's samples, as the paid run's page-side recorder takes them
// (e2e/support/slide-provisional-live.ts), and the judgement over them. DOM-free, so test/support's unit test runs it
// under the node project.

/** One change of what the stage draws of one slide's layer, and of one watched element. */
export interface SlideSample {
  at: number; // Date.now() in the page
  writing: string | null; // the stage layer's `data-provisional-writing`: the tool use id of the call writing the slide
  label: string | null; // the layer's label ("<name> is writing…"), null when none is drawn
  held: string | null; // the keys the layer holds back for the human (G-R4), space-separated
  ghost: { key: string; shown: string; text: string }[]; // every node the ghost canvas draws: its key, why, its text
  live: { text: string; veiled: boolean } | null; // the watched element's node on the live canvas
  thumb: string | null; // the filmstrip thumbnail's ring: the writing call's tool use id
}

/** The ghost canvas's node for `key` in a sample, or null when the ghost does not draw it. */
export const ghostOf = (sample: SlideSample, key: string) => sample.ghost.find((node) => node.key === key) ?? null;

/**
 * The swap judged over the samples from the first whose ghost draws element `key` with the whole `written` text: no
 * sample in which the element shows neither (the ghost with that text, or its live node with it and unveiled), and none
 * in which it shows both. Answers whether there was a swap to judge (`judged`: false when no ghost ever held the text,
 * which a caller must fail, since a swap never seen is no clean one), where the judgement starts (-1 then) and the
 * offenders. It answers rather than throws so the paid run's timeline is still written before its assertions.
 */
export function slideSwapOffenders(samples: readonly SlideSample[], key: string, written: string): { judged: boolean; from: number; gaps: SlideSample[]; doubles: SlideSample[] } {
  const ghostUp = (s: SlideSample) => ghostOf(s, key)?.text === written;
  const real = (s: SlideSample) => s.live !== null && !s.live.veiled && s.live.text === written;
  const from = samples.findIndex(ghostUp);
  if (from < 0) return { judged: false, from, gaps: [], doubles: [] };
  const after = samples.slice(from);
  return { judged: true, from, gaps: after.filter((s) => !ghostUp(s) && !real(s)), doubles: after.filter((s) => ghostUp(s) && real(s)) };
}
