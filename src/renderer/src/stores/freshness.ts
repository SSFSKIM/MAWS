// Ordering discipline for stores that mix pushed events with request replies. An event is always the newest word, so
// it advances the version; a request stamps the version when it is issued, and its reply is applied only if nothing
// advanced it since: no event arrived, and the connection that asked is still the live one (disconnecting advances
// it too). Replies never advance it, so two in-flight replies with no event between them both still apply in order.
export interface Freshness {
  advance(): void; // on every event applied, and on disconnect
  stamp(): () => boolean; // at request time; call the result on reply: is it still fresh?
}

export function createFreshness(): Freshness {
  let version = 0;
  return {
    advance() {
      version += 1;
    },
    stamp() {
      const issuedAt = version;
      return () => version === issuedAt;
    },
  };
}
