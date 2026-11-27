// The gate every lazy chunk of the page passes (T28; §P "The page's lazy chunks are gated as its requests are"). The
// page's own code is in its load; what the Markdown stack loads later (a code language's grammar, a highlighter theme,
// the diagram renderer and each kind of diagram) is a module whose answer runs as script in the page's origin, so it is
// asked for only while the tab's own proven connection is open. The build rewrites every dynamic import of a chunk to
// call the gate (vite.config.ts, `gateDynamicImports`), so the stack is gated from outside, unchanged. While a chunk
// waits, what needs it draws plain (Streamdown shows a block's code until its highlighting arrives, and a diagram as its
// source until its renderer does), and it draws again when the chunk comes. A load that failed (mawsd went while it was
// out) stays failed in the browser's module map, so it is asked again on the next proven connection under a fresh
// specifier, which the page server answers as the file (its query dropped). A chunk the gate asks for imports,
// statically, only chunks of the page's load (vite.config.ts, `withThePage`), so the gate's one fetch is all there is
// to it and a retry under a fresh specifier is a whole new try.
export interface ChunkGate {
  load(base: string, specifier: string): Promise<unknown>;
  opened(): void; // a connection reached `paired`: what waits looks again at whether the page's connection is proven
}

export function createChunkGate(deps: { proven: () => boolean; importer: (url: string) => Promise<unknown> }): ChunkGate {
  let connection = 0; // counts the connections that reached `paired`
  let waiting: Array<() => void> = [];
  const next = () => new Promise<void>((resolve) => waiting.push(resolve));

  return {
    async load(base, specifier) {
      const url = new URL(specifier, base).href;
      let failedOn: number | null = null;
      for (let tries = 0; ; ) {
        while (!deps.proven() || connection === failedOn) await next();
        try {
          return await deps.importer(tries === 0 ? url : `${url}?again=${tries}`);
        } catch {
          failedOn = connection;
          tries += 1;
        }
      }
    },
    opened() {
      connection += 1;
      const woken = waiting;
      waiting = [];
      for (const wake of woken) wake();
    },
  };
}

// The name the build's rewritten imports call: `import("./x.js")` becomes `__sheetChunk(import.meta.url, "./x.js")`
export const CHUNK_GATE_GLOBAL = '__sheetChunk';

export function installChunkGate(gate: ChunkGate): void {
  (globalThis as unknown as Record<string, ChunkGate['load']>)[CHUNK_GATE_GLOBAL] = (base, specifier) => gate.load(base, specifier);
}
