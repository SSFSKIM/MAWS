// The custody seam of route D's sealed OAuth grants (P5 O4, docs/doperpowers/plans/2026-10-31-p5-o4-services.md,
// Interfaces §A and §B, Decision Log D6, D20 and D21). A sealer turns one record's JSON into the bytes a store file
// carries and back, and names the format line its files start with, so a store over one sealer reads a file another
// sealer wrote as unreadable rather than asking the wrong custody to open it.
//
// Two sealers exist: Electron's safeStorage in main (format 1, the Keychain's, src/main/connectors/oauth-store.ts's
// `electronOAuthSealer`), which only the one-time adoption still reads once O4 lands, and the machine's software key
// (format 2, src/services/connectors/custody.ts). They live here, on neutral ground, so main's legacy reader and the
// services library share the seam without either importing the other (lint rules A and B).

export const SEALED_FORMAT_V1 = 'maws-connector-oauth/1'; // Electron's safeStorage (the Keychain)
export const SEALED_FORMAT_V2 = 'maws-connector-oauth/2'; // the machine's key file, AES-256-GCM

export interface ConnectorOAuthSealer {
  // The line-1 value this sealer's files carry.
  readonly format: string;
  available(): Promise<boolean>;
  // `id`: the connection id, bound into the sealed bytes where the sealer can (the key file's associated data; the
  // Electron sealer ignores it).
  seal(text: string, id: string): Promise<Buffer>;
  open(sealed: Buffer, id: string): Promise<{ text: string; reseal: boolean }>;
}

// Electron's safeStorage's asynchronous API, as far as the Electron sealer calls it (an interface, so nothing that
// names it imports Electron).
export interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

// What the MAWS_E2E custody guard proves before each safeStorage operation (src/main/connectors/oauth-root.ts).
export interface E2ECustodyFacts {
  e2e: boolean; // the MAWS_E2E launch (the one that appends the mock keychain switch)
  mockKeychain(): boolean;
  userData(): string;
  scratch(): string | undefined; // the profile the harness named
  tmp(): string;
}
