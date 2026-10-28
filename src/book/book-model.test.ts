/**
 * Tests of the book editor builders.
 * @adr 0674
 */
import { describe, expect, it } from "vitest";
import { applyBookPatch, type RowApprovalStatus } from "@4pm/dto";
import { bookKeyOf, buildBoard, editsPatch, readTable } from "./book-model";

const TODO = "# AI_TODO\n\n| ID | Title | Priority | Team |\n|---|---|---|---|\n| TSK-000001-001 | Login | High | web |\n| TSK-000001-002 | API | Low | api |\n| TSK-000001-003 | Docs | Low | web |\n";
const PROGRESS = "| ID | Worker | Started |\n|---|---|---|\n| TSK-000001-003 | w1 | 2026-10-28 10:00 |\n";
const DONE = "| ID | Title |\n|---|---|\n| TSK-000000-009 | Old |\n";

/** A minimal approval status row. */
function status(rowId: string, final: boolean): RowApprovalStatus {
  return { rowId, book: "aiTodo", team: "", required: ["teamLead"], satisfied: final ? ["teamLead"] : [], parties: [], final, candidates: {}, myGroups: [], canUnapprove: false, openDiscussions: 0, openRequests: 0, authorKind: "ai" };
}

describe("book editor model", () => {
  it("maps file names to books", () => {
    expect(bookKeyOf("AI_TODO.md")).toBe("aiTodo");
    expect(bookKeyOf("USER_QA.md")).toBe("userQa");
    expect(bookKeyOf("README.md")).toBeNull();
  });

  it("builds a patch the shared applier accepts, and none when nothing changed", () => {
    const t = readTable(TODO)!;
    const row = t.rows[1]!;
    const edited = [...row.cells];
    edited[1] = "API v2";
    const patch = editsPatch(TODO, new Map([[row.id, edited], [t.rows[0]!.id, [...t.rows[0]!.cells]]]))!;
    expect(patch.rows.map((r) => r.id)).toEqual(["TSK-000001-002"]);
    const applied = applyBookPatch(TODO, patch);
    expect(applied.ok && applied.md.includes("| TSK-000001-002 | API v2 | Low | api |")).toBe(true);
    expect(editsPatch(TODO, new Map([[row.id, [...row.cells]]]))).toBeNull();
  });

  it("sorts tasks into the board columns", () => {
    const board = buildBoard(
      { aiTodo: TODO, aiProgress: PROGRESS, aiDone: DONE },
      new Map([["TSK-000001-001", status("TSK-000001-001", true)], ["TSK-000001-002", status("TSK-000001-002", false)]]),
      { claimTtlHours: 6, runTimeoutMinutes: 60 },
      Date.parse("2026-10-28T11:00:00Z"),
    );
    expect(board.approved.map((c) => c.id)).toEqual(["TSK-000001-001"]);
    expect(board.waiting.map((c) => [c.id, c.approval])).toEqual([["TSK-000001-002", "0/1"]]);
    expect(board.running.map((c) => [c.id, c.worker])).toEqual([["TSK-000001-003", "w1"]]);
    expect(board.done.map((c) => c.id)).toEqual(["TSK-000000-009"]);
  });
});
