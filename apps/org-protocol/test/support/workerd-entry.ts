// A Worker that replays the committed vectors and answers with what failed (test/workerd.test.ts).
import { replayVectors, VECTORS } from '../../vectors/index.ts';

export default {
  async fetch(): Promise<Response> {
    return Response.json({ cases: VECTORS.cases.length, failures: await replayVectors(VECTORS) });
  },
};
