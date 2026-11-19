// The product's request filter, copied (not imported: the spike imports nothing from src/) from src/render/policies.ts
// at 281ef5a6c, with the owner's check the execution document adds (Interfaces §D, `shouldCancelForOwner`) as its first
// question. The listener's three branches are the product's, in the product's order: the owner's check, then a web
// contents' own filter (`ownFilters`), then the frame policies. Both ends of every request for a token host go into one
// ordered record (`record.mjs`): this file writes the listener's decision.
import { log } from './record.mjs';

const ARTIFACT_PREFIX = 'maws-artifact://';
const isStoreUrl = (url) => typeof url === 'string' && url.startsWith(ARTIFACT_PREFIX);
const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
const PDF_VIEWER_BLOB = `blob:${PDF_VIEWER}`;
const ALLOWED_BENEATH = [ARTIFACT_PREFIX, PDF_VIEWER, 'chrome://resources/'];
const allowedBeneath = (url) => ALLOWED_BENEATH.some((prefix) => url.startsWith(prefix));
export const TOKEN = /^[0-9a-f]{32}$/;
export const hostOf = (url) => (isStoreUrl(url) ? url.slice(ARTIFACT_PREFIX.length).split(/[/?#]/, 1)[0].toLowerCase() : null);

export function beneathStoreFrame(frame) {
  try {
    let current = frame ?? null;
    for (let depth = 0; current && depth < 64; depth++, current = current.parent) if (isStoreUrl(current.url)) return true;
    return false;
  } catch {
    return null;
  }
}
export function shownArtifact(frame) {
  let current = frame ?? null;
  for (let depth = 0; current && depth < 64; depth++, current = current.parent) if (isStoreUrl(current.url)) return hostOf(current.url);
  return undefined;
}
function crossesArtifacts(url, shown) {
  if (!url.startsWith(ARTIFACT_PREFIX) || shown === undefined) return false;
  return shown !== hostOf(url);
}
export function shouldCancelRequest({ url, beneath, initiatorOrigin, shown, appOrigin }) {
  const fromApp = appOrigin != null && initiatorOrigin === appOrigin;
  if (!fromApp && crossesArtifacts(url, shown)) return true;
  if (allowedBeneath(url)) return false;
  return beneath === true || isStoreUrl(initiatorOrigin);
}
export function shouldBlockFrameNavigation({ url, frameBeneath, initiatorBeneath, initiatorShows }) {
  if (crossesArtifacts(url, initiatorShows)) return true;
  if (allowedBeneath(url)) return false;
  return frameBeneath !== false || initiatorBeneath === true;
}
export function shouldCancelDownload({ url, urlChain }) {
  return [url, ...urlChain].some((u) => isStoreUrl(u) || u.startsWith(PDF_VIEWER_BLOB));
}
export function isCspExempt(url) {
  return isStoreUrl(url) || url.startsWith(PDF_VIEWER);
}
export function isStoreFramePermission(origins) {
  return origins.some(isStoreUrl);
}
// The document's `shouldCancelForOwner`: false outside the scheme and for a host that is no token's; else true unless
// the request's web contents is the token's owner (a request with none is cancelled).
export function shouldCancelForOwner({ url, webContentsId, ownerOf }) {
  const host = hostOf(url);
  if (host === null) return false;
  const owner = ownerOf(host);
  if (owner === undefined) return false;
  return owner === null || webContentsId === undefined || owner !== webContentsId;
}

const read = (get) => {
  try {
    return get();
  } catch {
    return undefined;
  }
};
const beneathRead = (get) => {
  try {
    return beneathStoreFrame(get());
  } catch {
    return null;
  }
};
const shownRead = (get, unreadable = () => undefined) => {
  try {
    return shownArtifact(get());
  } catch {
    return unreadable();
  }
};

export const ownFilters = new Map(); // webContentsId -> (url) => cancel

// The partition's one onBeforeRequest listener. `ownerOf` absent: the product of today (no owner's check).
// `partition` names the partition in the record. Every request is written to the record's `requests` log; a request
// for a token host is also written, with its decision, to the ordered record.
export function installFramePolicies(session, { partition, appOrigin = 'file://', ownerOf }) {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const frameUrl = read(() => details.frame?.url) ?? null;
    let branch;
    let cancel;
    if (ownerOf && shouldCancelForOwner({ url: details.url, webContentsId: details.webContentsId, ownerOf })) {
      branch = 'owner';
      cancel = true;
    } else {
      const own = details.webContentsId === undefined ? undefined : ownFilters.get(details.webContentsId);
      if (own) {
        branch = 'own-filter';
        cancel = own(details.url);
      } else {
        branch = 'frame-policies';
        cancel = shouldCancelRequest({ url: details.url, beneath: beneathRead(() => details.frame), initiatorOrigin: details.initiatorOrigin, shown: shownRead(() => details.frame), appOrigin });
      }
    }
    const host = hostOf(details.url);
    const entry = { partition, url: details.url, method: details.method, webContentsId: details.webContentsId ?? null, resourceType: details.resourceType, frameUrl, initiatorOrigin: details.initiatorOrigin ?? null, decision: cancel ? 'cancel' : 'pass', branch };
    if (host !== null && TOKEN.test(host)) log('decision', entry);
    else log('request', entry);
    callback({ cancel });
  });
}
