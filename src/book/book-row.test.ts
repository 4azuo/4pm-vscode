/**
 * Tests of the book row reader.
 * @adr 0673
 */
import { describe, expect, it } from "vitest";
import { findBookRow } from "./book-row";

const BOOK = [
  "# AI_TODO",
  "",
  "> intro | with a pipe",
  "",
  "| ID | Title | Priority | Notes |",
  "|----|-------|:--------:|-------|",
  "| TSK-000001-001 | Login form | High | a \\| b |",
  "| TSK-000001-002 | Login API | Medium | |",
].join("\n");

describe("findBookRow", () => {
  it("reads a row with the table header and its line", () => {
    expect(findBookRow(BOOK, "TSK-000001-001")).toEqual({
      id: "TSK-000001-001",
      line: 6,
      columns: ["ID", "Title", "Priority", "Notes"],
      cells: { ID: "TSK-000001-001", Title: "Login form", Priority: "High", Notes: "a | b" },
    });
  });

  it("returns null for an unknown id or a prefix", () => {
    expect(findBookRow(BOOK, "TSK-000001")).toBeNull();
  });
});
