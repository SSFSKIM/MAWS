// A page load's failure, as the chrome shows it (E4a execution document, Design §5): main classifies each main-frame
// `did-fail-load` into Codex's six states (`main-BvBtZhys.js:90639-90671`, which reads Chromium's error name) and the
// renderer draws that state's page. Pure, so main and the renderer share it.

export const LOAD_ERROR_KINDS = ['dns', 'offline', 'refused', 'timeout', 'certificate', 'generic'] as const;
export type LoadErrorKind = (typeof LOAD_ERROR_KINDS)[number];

// A navigation replaced by another, a Stop, or a download: never an error to show (Decision Log 15).
export const ERR_ABORTED = -3;

const BY_NAME: Readonly<Record<string, LoadErrorKind>> = {
  DNS_PROBE_POSSIBLE: 'dns',
  ERR_NAME_NOT_RESOLVED: 'dns',
  ERR_INTERNET_DISCONNECTED: 'offline',
  ERR_CONNECTION_REFUSED: 'refused',
  ERR_CONNECTION_TIMED_OUT: 'timeout',
  ERR_TIMED_OUT: 'timeout',
};

// The same errors by number (Chromium's `net_error_list.h`), for a failure whose description came empty.
const BY_CODE: Readonly<Record<number, LoadErrorKind>> = { [-105]: 'dns', [-106]: 'offline', [-102]: 'refused', [-118]: 'timeout', [-7]: 'timeout' };
const isCertificateCode = (code: number) => code <= -200 && code >= -299; // net_error_list.h: "200-299 Certificate errors"

// `code` and `description` are `did-fail-load`'s `errorCode` and `errorDescription` (Chromium's short name, such as
// `ERR_CONNECTION_REFUSED`). Null for ERR_ABORTED.
export function classifyLoadError(code: number, description: string): LoadErrorKind | null {
  if (code === ERR_ABORTED) return null;
  if (description !== '') {
    if (Object.hasOwn(BY_NAME, description)) return BY_NAME[description];
    if (description.startsWith('ERR_CERT_')) return 'certificate';
    return 'generic';
  }
  if (Object.hasOwn(BY_CODE, code)) return BY_CODE[code];
  return isCertificateCode(code) ? 'certificate' : 'generic';
}
