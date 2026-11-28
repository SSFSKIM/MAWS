// A `Storage` for the page's unit suites: a map with the browser's interface, and a quota that can be set, past which
// `setItem` throws as a full store does.
export interface TestStorage extends Storage {
  entries(): Record<string, string>;
  quota: number | null; // the most characters keys and values may hold together; null: no bound
}

export function testStorage(entries: Record<string, string> = {}): TestStorage {
  const map = new Map(Object.entries(entries));
  const size = () => [...map].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  const store: TestStorage = {
    quota: null,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem(key: string, value: string) {
      const was = map.get(key);
      map.set(key, String(value));
      if (store.quota !== null && size() > store.quota) {
        if (was === undefined) map.delete(key);
        else map.set(key, was);
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
    },
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    entries: () => Object.fromEntries(map),
  };
  return store;
}
