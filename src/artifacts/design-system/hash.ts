// A short, stable name for a text: FNV-1a over it twice with different offsets, a 64-bit hash in base 36. For ids that
// must be the same in every render and every window for equal input (a scope, a private face name), never for secrets.
function fnv(text: string, offset: number): string {
  let hash = offset;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export const stableHash = (text: string): string => `${fnv(text, 0x811c9dc5)}${fnv(text, 0x050c5d1f)}`;
