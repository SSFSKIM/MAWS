// Per-owner release fences (P5 O1 M2): an async step that must not act for an owner released while it ran (a watch
// whose client ended during its status read) holds the owner's fence and asks it, after its awaits, whether a release
// came. A fence exists only while some step holds it, and a release retires it, so an owner that ended leaves nothing
// behind however long the process runs; a step begun after a release gets a fresh fence.
interface Fence {
  released: boolean;
  holders: number;
}

export class ReleaseFences<K> {
  private readonly fences = new Map<K, Fence>();

  // Runs `step` holding `owner`'s fence, taken before `step`'s first await; `released()` answers whether `owner` was
  // released since.
  async hold<T>(owner: K, step: (released: () => boolean) => Promise<T>): Promise<T> {
    let fence = this.fences.get(owner);
    if (!fence) this.fences.set(owner, (fence = { released: false, holders: 0 }));
    const held = fence;
    held.holders += 1;
    try {
      return await step(() => held.released);
    } finally {
      held.holders -= 1;
      if (held.holders === 0 && this.fences.get(owner) === held) this.fences.delete(owner);
    }
  }

  release(owner: K): void {
    const fence = this.fences.get(owner);
    if (!fence) return;
    fence.released = true;
    this.fences.delete(owner);
  }

  // The fences held now (diagnostics and tests).
  get size(): number {
    return this.fences.size;
  }
}
