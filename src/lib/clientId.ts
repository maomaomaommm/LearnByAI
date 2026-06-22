/**
 * UUID v4 generator that is safe in insecure (plain-HTTP) browser contexts.
 *
 * `crypto.randomUUID()` only exists in a secure context (HTTPS or localhost), so
 * on a plain-HTTP deployment (e.g. http://<ip>) it is `undefined` and throws.
 * `crypto.getRandomValues()` IS available in insecure contexts, so we build a v4
 * UUID from it as a fallback. The result stays a valid UUID, so server-side
 * `isUuid()` persistence checks keep passing.
 */
export function randomId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  // Last resort: no Web Crypto at all. Still a valid-shaped v4 UUID.
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-${((Math.floor(Math.random() * 4) + 8).toString(16))}${rand().slice(1)}-${rand()}${rand()}${rand()}`;
}
