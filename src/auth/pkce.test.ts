/**
 * Tests of the PKCE helpers (RFC 7636 appendix B vector + shapes the server accepts).
 * @adr 0670
 */
import { describe, expect, it } from "vitest";
import { createPkce, s256 } from "./pkce";

describe("pkce", () => {
  it("matches the RFC 7636 S256 example", () => {
    expect(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("creates a verifier / challenge / state the server accepts", () => {
    const { verifier, challenge, state } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state.length).toBeGreaterThan(20);
  });
});
