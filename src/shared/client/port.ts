// The client port (P5 OX4, with `confirm`; O1 M3): every effect only a client can perform, asked through the client
// that requested it, or `null` where no request asked (a notification, the badge, a notification click's focus). A
// machine-bound service reaches the person's screen only through this, so the same service code runs in Electron main
// (`src/main/client/electron-port.ts`) or in mawsd, whose port asks the client over its connection.
//
// `noClient` is the answer when no client is reachable to perform the effect: mawsd's port gives it once the asking
// client has gone, or when none is connected. Electron's port never does (it shows app-level UI for `null` or a gone
// client). Every caller handles it with a degraded answer and never waits, so a missing client hangs nothing.
// Zod-free and Electron-free.
import type { ClientRef } from '../ipc/client';

export interface NoClient { readonly noClient: true }
export interface PickRequest { kind: 'file' | 'directory'; multiple: boolean; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }
export type PickAnswer = { paths: string[] } | { cancelled: true } | NoClient;
export interface SaveRequest { defaultPath: string }
export type SaveAnswer = { path: string } | { cancelled: true } | NoClient;
export interface ConfirmRequest { kind: 'info' | 'warning'; message: string; detail?: string; confirm: string; cancel: string }
export type ConfirmAnswer = { confirmed: boolean } | NoClient;
export type OpenTarget = { url: string } | { path: string };
export type OpenAnswer = { opened: true } | { opened: false; reason: string } | NoClient;
export type RevealAnswer = { revealed: true } | NoClient;
export interface NotifyRequest { title: string; body: string; silent: boolean; reply?: { placeholder: string }; actions?: string[] }
export type NotifyEvent =
  | { kind: 'shown' } | { kind: 'failed'; error: string } | { kind: 'clicked' }
  | { kind: 'replied'; text: string } | { kind: 'action'; index: number } | { kind: 'closed' };
export interface NotificationHandle { close(): void }
export interface ClientPort {
  pick(client: ClientRef | null, request: PickRequest): Promise<PickAnswer>;
  save(client: ClientRef | null, request: SaveRequest): Promise<SaveAnswer>;
  confirm(client: ClientRef | null, request: ConfirmRequest): Promise<ConfirmAnswer>;
  reveal(client: ClientRef | null, path: string): Promise<RevealAnswer>;
  openExternal(client: ClientRef | null, target: OpenTarget): Promise<OpenAnswer>; // a URL: http, https and mailto only, as open-external.ts checks
  notify(client: ClientRef | null, request: NotifyRequest, onEvent: (event: NotifyEvent) => void): NotificationHandle | { unsupported: string } | NoClient;
  badge(client: ClientRef | null, count: number): void | NoClient;
  focus(client: ClientRef | null, mode: 'bring' | 'request'): void | NoClient;
}

export const NO_CLIENT: NoClient = { noClient: true };
export const isNoClient = (answer: unknown): answer is NoClient => typeof answer === 'object' && answer !== null && (answer as Partial<NoClient>).noClient === true;
// What a caller with a reason field says when no client could perform the effect.
export const NO_CLIENT_REASON = 'no client';
