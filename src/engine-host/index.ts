// The engine host (charter §4.1): the utility process that will own Claude Code processes. In C1 it answers
// `engine.ping` and nothing else; C3 replaces this body. It ships no launch or environment code (D-1, X6).
import { hostPing, runHost } from '@shared/host/runtime';

const HOST_VERSION = __MAWS_VERSION__;

runHost(HOST_VERSION, (on) => {
  on('engine.ping', async () => hostPing(HOST_VERSION));
});
