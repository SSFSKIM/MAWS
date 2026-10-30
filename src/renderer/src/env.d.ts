import type { PreloadBridge } from '@shared/ipc/schema';

declare global {
  interface Window {
    maws: PreloadBridge; // the raw pipe (P5 O6 M2: bare ids, the local machine by default); the page's code goes through `ipc`
  }
}
