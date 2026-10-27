// The WebCrypto type names the package uses, for a consumer that compiles it under Node's own declarations without the
// DOM library (the root tsconfig.node.json, where main and mawsd import it). @types/node declares `CryptoKey` as a
// global value only and these names not at all; the browser's lib.dom and the Workers types declare them themselves.
import type { webcrypto } from 'node:crypto';

declare global {
  type CryptoKey = webcrypto.CryptoKey;
  type CryptoKeyPair = webcrypto.CryptoKeyPair;
  type JsonWebKey = webcrypto.JsonWebKey;
}
