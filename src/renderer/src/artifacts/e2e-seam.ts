// The store's e2e seam in the page (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4): `window.__maws_documents`,
// installed only when the window was loaded for the e2e harness (main adds `e2e=1` to the page's URL under MAWS_E2E=1).
// It opens replicas through the window's real ArtifactHost and edits them schema-agnostically (a root type's attributes
// and text), so `e2e/artifacts-store.spec.ts` drives the product's port route end to end before any editor exists.
// M9: it also takes a whole state in (a seeded document) and times keystrokes to their durable ack, for S2's numbers.
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { applyV2, stateV2 } from '@artifacts/yjs';

interface Typing {
  prefix: string;
  typed: number;
  acked: number; // the edits known durable: typed − unsaved, at its highest
  timer: ReturnType<typeof setInterval>;
}

interface Opened {
  handle: DocumentHandle;
  restores: number[]; // the version ids `onRestored` fired for
  typing: Typing | null;
}

export interface DocumentsSeam {
  open(artifactId: string): Promise<number>; // a handle id, once its replica has synced
  json(id: number, root?: string): { attrs: Record<string, unknown>; text: string };
  setAttr(id: number, key: string, value: unknown, root?: string): void;
  insertText(id: number, index: number, text: string, root?: string): void;
  state(id: number): DocumentState;
  restores(id: number): number[];
  // Appends `<prefix><n>;` to the root's text every `everyMs`, counting what the host acknowledged.
  startTyping(id: number, prefix: string, everyMs: number): void;
  stopTyping(id: number): { typed: number; acked: number };
  // M9: applies a V2 state as a local edit (it goes to the host like any), and the replica's V2 state size.
  applyState(id: number, state: Uint8Array): void;
  stateSize(id: number): number;
  // M9: `count` appends to the root's text, each `gapMs` (min, max: uniformly drawn) after the last; answers each one's
  // milliseconds from the edit to the ack that made it durable, in order.
  timeAcks(id: number, count: number, gapMs: [number, number]): Promise<number[]>;
  close(id: number): void;
}

declare global {
  interface Window {
    __maws_documents?: DocumentsSeam;
  }
}

export const e2eRequested = (search: string): boolean => new URLSearchParams(search).get('e2e') === '1';

export function installDocumentsSeam(win: Window, host: () => ArtifactHost): void {
  const opened = new Map<number, Opened>();
  let lastId = 0;
  const get = (id: number): Opened => {
    const found = opened.get(id);
    if (!found) throw new Error(`no open document ${id}`);
    return found;
  };
  const node = (id: number, root = 'root') => get(id).handle.doc.get(root);
  win.__maws_documents = {
    async open(artifactId) {
      const handle = await host().open(artifactId);
      const id = ++lastId;
      const entry: Opened = { handle, restores: [], typing: null };
      handle.onRestored(({ versionId }) => entry.restores.push(versionId));
      handle.subscribe((state) => {
        const typing = entry.typing;
        if (typing) typing.acked = Math.max(typing.acked, typing.typed - state.unsaved);
      });
      opened.set(id, entry);
      return id;
    },
    json(id, root) {
      const type = node(id, root);
      const text = type.toArray().filter((part): part is string => typeof part === 'string').join('');
      return { attrs: Object.fromEntries(type.attrEntries()), text };
    },
    setAttr: (id, key, value, root) => node(id, root).setAttr(key, value as never),
    insertText: (id, index, text, root) => node(id, root).insert(index, text),
    state: (id) => get(id).handle.state(),
    restores: (id) => [...get(id).restores],
    startTyping(id, prefix, everyMs) {
      const entry = get(id);
      const typing: Typing = { prefix, typed: 0, acked: 0, timer: setInterval(() => {
        const type = node(id);
        const length = type.toArray().filter((part): part is string => typeof part === 'string').join('').length;
        type.insert(length, `${prefix}${typing.typed};`);
        typing.typed += 1;
        typing.acked = Math.max(typing.acked, typing.typed - entry.handle.state().unsaved);
      }, everyMs) };
      entry.typing = typing;
    },
    stopTyping(id) {
      const entry = get(id);
      const typing = entry.typing;
      if (!typing) throw new Error(`document ${id} is not typing`);
      clearInterval(typing.timer);
      entry.typing = null;
      return { typed: typing.typed, acked: Math.max(typing.acked, typing.typed - entry.handle.state().unsaved) };
    },
    applyState: (id, state) => applyV2(get(id).handle.doc, state),
    stateSize: (id) => stateV2(get(id).handle.doc).length,
    timeAcks(id, count, [minGap, maxGap]) {
      const { handle } = get(id);
      const editedAt: number[] = [];
      const latencies: number[] = [];
      return new Promise((resolve) => {
        // The provider acks in send order: with n edits made and u unsaved, the first n − u are durable.
        const off = handle.subscribe((state) => {
          const now = performance.now();
          while (latencies.length < editedAt.length - state.unsaved) latencies.push(now - editedAt[latencies.length]);
          if (latencies.length === count) {
            off();
            resolve(latencies);
          }
        });
        const edit = () => {
          const type = node(id);
          const length = type.toArray().filter((part): part is string => typeof part === 'string').join('').length;
          editedAt.push(performance.now());
          type.insert(length, `t${editedAt.length};`);
          if (editedAt.length < count) setTimeout(edit, minGap + Math.random() * (maxGap - minGap));
        };
        edit();
      });
    },
    close(id) {
      const entry = get(id);
      if (entry.typing) clearInterval(entry.typing.timer);
      entry.handle.close();
      opened.delete(id);
    },
  };
}
