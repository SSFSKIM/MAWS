// The protocol package's test support (O11 M7): the Node reference client of the app's hub connection (OX8) — its
// routes and its three sockets — and acceptance 6's run over them, for the hub's suites, the deploy tool's
// measurements and the CLI; and (O10 M1) RL2's test device, a hostile relay in a channel's path, in-memory carriers and
// a software WebAuthn authenticator. Node only (it hands WebSocket its Access headers, which only Node's client takes): not part
// of the package's runtime-neutral surface.
export { referenceCheck, type CheckLine, type CheckOptions, type CheckResult } from './check.ts';
export { accessTokenHeaders, HubClient, HubRefusal, type PushRecord, type PushRegistration } from './hub-client.ts';
export { echoCheck, echoPayloads, machineSocketPath, RelayApp, type EchoCheck } from './machine-socket.ts';
export { deviceHuman, projectSocketPath, ProjectSocket, type DeviceHuman, type HumanAck, type HumanRefused, type LoggedEvent } from './project-socket.ts';
export { listingKey, REGISTRY_SOCKET_PATH, RegistrySocket } from './registry-socket.ts';
export { PartJoiner, type Headers } from './socket.ts';
export { p1363ToDer, SoftwareAuthenticator, type AssertOptions } from './authenticator.ts';
export { duplexPair, TamperRelay, type Direction, type Tamper } from './tamper-relay.ts';
export { TestDevice, type ActionFields } from './test-device.ts';
