/**
 * PKCE (RFC 7636, S256) and the `state` nonce of the browser sign-in.
 * @adr 0670 @flow 0026
 */
import { createHash, randomBytes } from "node:crypto";

/** A random base64url string of `bytes` bytes. */
function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** A fresh verifier (43 chars), its S256 challenge and a state nonce. */
export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBase64Url(32);
  return { verifier, challenge: s256(verifier), state: randomBase64Url(24) };
}

/** base64url(SHA-256(verifier)). */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
