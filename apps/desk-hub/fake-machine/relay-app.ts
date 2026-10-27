// A fake app's socket to a machine (O11 M6): the reference client's Machine socket, which moved into the protocol
// package's test support in M7 (apps/org-protocol/test-support/machine-socket.ts) so the reference client holds all
// three of the app's sockets; the suites and the CLI keep importing it from here.
export { echoCheck, echoPayloads, RelayApp, type EchoCheck } from 'org-protocol/test-support';
