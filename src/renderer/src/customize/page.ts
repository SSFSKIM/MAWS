// Customize's page, held for the app run and never stored (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// §D, §H): My items' one search text, which every Show value narrows by (the session's `/plugins` and `/skills` keep the
// library store's), and a request that My items open a plugin's detail once its list holds it (`openMine`), for the
// place and the Show value it was made at. Where the page is, its view and Show, is U7b's `destination`.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Destination } from '@shared/ipc/schema/layout';

export type CustomizeShow = Extract<Destination, { kind: 'customize' }>['show'];

export const useCustomizePage: UseBoundStore<StoreApi<{ search: string }>> = create<{ search: string }>()(() => ({ search: '' }));

/** A detail My items opens when its list holds the plugin: asked at `place` (the page's folder, null for the user
 * configuration) with `show`; it ends when it opens, when another row opens, or when the page is elsewhere. */
export interface OpenRequest {
  pluginId: string;
  place: string | null;
  show: CustomizeShow;
}

export const useOpenRequest: UseBoundStore<StoreApi<{ request: OpenRequest | null }>> = create<{ request: OpenRequest | null }>()(() => ({ request: null }));

export const dropOpenRequest = (): void => {
  if (useOpenRequest.getState().request !== null) useOpenRequest.setState({ request: null });
};
