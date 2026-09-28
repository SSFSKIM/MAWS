import type { MawsBridge } from '@shared/ipc/schema';

declare global {
  interface Window {
    maws: MawsBridge;
  }
}
