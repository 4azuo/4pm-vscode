/**
 * Tests of the book row lookup.
 * @adr 0670
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
const { findRowLine } = await import("./book-locate");

describe("findRowLine", () => {
  const book = "# AI_TODO\n\n| ID | Title |\n| T-0012 | Login |\n| T-00123 | Other |\n";

  it("finds the row by its whole id", () => {
    expect(findRowLine(book, "T-0012")).toBe(3);
    expect(findRowLine(book, "T-00123")).toBe(4);
  });

  it("returns -1 when the id is absent or only a prefix of another", () => {
    expect(findRowLine(book, "T-001")).toBe(-1);
  });
});
