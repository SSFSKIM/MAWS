// What the protocol code may use of its runtime: WebCrypto's HMAC, SHA-256, P-256 ECDSA and ECDH, HKDF, AES-GCM and
// random values, UTF-8 text encoding, URL parsing, and timers (RL2's handshake waits a bounded time for each message). Browsers, Workers, and Node provide each alike. Only the neutral
// typechecks read this file (apps/org-protocol/tsconfig.json, apps/desk-hub/tsconfig.protocol.json); the Worker, the web
// app, and the tests compile the same code against their runtime's own declarations of the same names.

type KeyUsage = 'sign' | 'verify' | 'deriveBits' | 'deriveKey' | 'encrypt' | 'decrypt';

interface CryptoKey {
  readonly type: string;
  readonly extractable: boolean;
  readonly algorithm: { readonly name: string };
  readonly usages: string[];
}

interface CryptoKeyPair {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
}

interface JsonWebKey {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  ext?: boolean;
  key_ops?: string[];
}

type P256 = { name: 'ECDSA' | 'ECDH'; namedCurve: 'P-256' };
type EcdsaSha256 = { name: 'ECDSA'; hash: 'SHA-256' };
type EcdhDerive = { name: 'ECDH'; public: CryptoKey };
type HkdfSha256 = { name: 'HKDF'; hash: 'SHA-256'; salt: Uint8Array<ArrayBuffer>; info: Uint8Array<ArrayBuffer> };
type AesGcm = { name: 'AES-GCM'; iv: Uint8Array<ArrayBuffer>; additionalData?: Uint8Array<ArrayBuffer>; tagLength?: 128 };
type AesGcmKey = { name: 'AES-GCM'; length: 256 };

interface SubtleCrypto {
  importKey(
    format: 'raw',
    keyData: Uint8Array<ArrayBuffer>,
    algorithm: { name: 'HMAC'; hash: 'SHA-256' },
    extractable: boolean,
    keyUsages: Array<'sign' | 'verify'>,
  ): Promise<CryptoKey>;
  importKey(format: 'raw', keyData: Uint8Array<ArrayBuffer>, algorithm: P256, extractable: boolean, keyUsages: KeyUsage[]): Promise<CryptoKey>;
  importKey(format: 'jwk', keyData: JsonWebKey, algorithm: P256, extractable: boolean, keyUsages: KeyUsage[]): Promise<CryptoKey>;
  importKey(format: 'raw', keyData: Uint8Array<ArrayBuffer>, algorithm: 'HKDF', extractable: false, keyUsages: Array<'deriveBits' | 'deriveKey'>): Promise<CryptoKey>;
  importKey(format: 'raw', keyData: Uint8Array<ArrayBuffer>, algorithm: { name: 'AES-GCM' }, extractable: boolean, keyUsages: Array<'encrypt' | 'decrypt'>): Promise<CryptoKey>;
  exportKey(format: 'raw', key: CryptoKey): Promise<ArrayBuffer>;
  exportKey(format: 'jwk', key: CryptoKey): Promise<JsonWebKey>;
  generateKey(algorithm: P256, extractable: boolean, keyUsages: KeyUsage[]): Promise<CryptoKeyPair>;
  sign(algorithm: 'HMAC', key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  sign(algorithm: EcdsaSha256, key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  verify(algorithm: 'HMAC', key: CryptoKey, signature: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<boolean>;
  verify(algorithm: EcdsaSha256, key: CryptoKey, signature: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<boolean>;
  deriveBits(algorithm: EcdhDerive | HkdfSha256, baseKey: CryptoKey, length: number): Promise<ArrayBuffer>;
  deriveKey(algorithm: HkdfSha256, baseKey: CryptoKey, derivedKeyType: AesGcmKey, extractable: boolean, keyUsages: Array<'encrypt' | 'decrypt'>): Promise<CryptoKey>;
  encrypt(algorithm: AesGcm, key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  decrypt(algorithm: AesGcm, key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  digest(algorithm: 'SHA-256', data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
}

declare const crypto: {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends Uint8Array<ArrayBuffer>>(array: T): T;
};

declare class TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>;
}

declare class TextDecoder {
  constructor(label?: 'utf-8', options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array<ArrayBuffer>): string;
}

declare class URL {
  constructor(url: string);
  readonly protocol: string;
  readonly hostname: string;
  readonly origin: string;
}

declare function setTimeout(handler: () => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;
