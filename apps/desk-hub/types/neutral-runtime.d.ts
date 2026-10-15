// What the protocol module may use of its runtime: WebCrypto's HMAC, SHA-256 and random values, UTF-8 text encoding,
// and URL parsing. Browsers, Workers, and Node provide each alike. Only tsconfig.protocol.json reads this file; the Worker,
// the web app, and the tests compile the module against their runtime's own declarations of the same names.

interface CryptoKey {
  readonly type: string;
  readonly algorithm: { readonly name: string };
  readonly usages: string[];
}

interface SubtleCrypto {
  importKey(
    format: 'raw',
    keyData: Uint8Array<ArrayBuffer>,
    algorithm: { name: 'HMAC'; hash: 'SHA-256' },
    extractable: boolean,
    keyUsages: Array<'sign' | 'verify'>,
  ): Promise<CryptoKey>;
  sign(algorithm: 'HMAC', key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  verify(algorithm: 'HMAC', key: CryptoKey, signature: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<boolean>;
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
}
