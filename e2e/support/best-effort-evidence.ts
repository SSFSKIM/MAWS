// Diagnostics run before resource disposal, but must never keep it from running. Each capture gets the same bounded
// window independently; a lost page or trace still leaves the other evidence available. A late rejection stays handled.
export async function collectBestEffortEvidence(captures: Record<string, () => Promise<void>>, timeoutMs: number): Promise<void> {
  await Promise.all(Object.entries(captures).map(async ([name, capture]) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(capture),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`capture exceeded ${timeoutMs} ms`)), timeoutMs);
        }),
      ]);
    } catch (error) {
      console.warn(`Could not collect ${name}:`, error);
    } finally {
      clearTimeout(timer);
    }
  }));
}
