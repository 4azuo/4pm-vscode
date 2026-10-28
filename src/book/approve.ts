/**
 * Approve / unapprove book rows the way the web does: AI_TODO rows go through `machine-0063` with each row's catalog
 * tags (its `Actions` cell), so the tagged actions run on approval; USER_TODO / USER_QA rows go through `machine-0080`.
 * Shared by the row panel and the book editor.
 * @adr 0674 @api machine-0063 @api machine-0080
 */
import { isAiTaskTag } from "@4pm/constants";
import { approvalBookOfRow } from "@4pm/dto";
import type { Api } from "../api";

/** A row to (un)approve, with its `Actions` cell (AI_TODO only). */
export interface ApprovalTarget {
  id: string;
  actions?: string;
}

/** The known catalog tags of an `Actions` cell (comma / space separated; unknown tokens dropped). */
export function actionTags(cell: string | undefined): string[] {
  return (cell ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isAiTaskTag(s));
}

/** Approve (or unapprove) rows on the project's worker, split by book. */
export async function setApproval(api: Api, machineLinkId: string, rows: ApprovalTarget[], approve: boolean): Promise<void> {
  const tasks = rows.filter((r) => approvalBookOfRow(r.id) === "aiTodo");
  const others = rows.filter((r) => approvalBookOfRow(r.id) !== "aiTodo").map((r) => r.id);
  if (tasks.length) {
    await api.sdk.machines.tasksApproveBatch(
      machineLinkId,
      approve
        ? { approvals: tasks.map((t) => ({ taskId: t.id, tags: actionTags(t.actions) })), unapprovals: [] }
        : { approvals: [], unapprovals: tasks.map((t) => t.id) },
    );
  }
  if (others.length) {
    await api.sdk.bookGovernance.bookApprovals(machineLinkId, approve ? { approve: others, unapprove: [] } : { approve: [], unapprove: others });
  }
}
