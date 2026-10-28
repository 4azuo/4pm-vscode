/**
 * The book row panel (D1): a My-work row of the linked project opens as a card — its cells read from the local book
 * file, its approval progress and linked discussions from the server — with Approve / Unapprove / Answer / View diff /
 * discussions / Open source / Open in 4PM. Which actions show comes from the server's answer (`myGroups`,
 * `canUnapprove`); every action is checked again by the server. One panel per row, reused when reopened.
 * AI_TODO approvals carry the row's catalog tags (`book/approve.ts`).
 * @adr 0673 @adr 0674 @api project-0103 @api project-0120 @api project-0108 @arch 0072
 */
import * as vscode from "vscode";
import type { ApprovalGroup, DiscussionSummary, MyWorkItem, RowApprovalStatus } from "@4pm/dto";

/** The row a panel shows — a My-work item, or a row opened from the book editor. */
export type RowRef = Pick<MyWorkItem, "projectId" | "projectName" | "id" | "title" | "kind" | "state" | "due" | "href">;
import type { Api } from "../api";
import { errorText } from "../api";
import { webUrl } from "../config";
import { locateRow, openSource, type LocatedRow } from "../book/book-locate";
import { setApproval } from "../book/approve";
import { openRowDiff } from "../book/git-diff";
import type { WorkspaceLink } from "../workspace-link";
import type { PanelEvent, PanelModel, PanelNotice, PanelSection } from "./model";
import { PanelView } from "./webview";

/** Opens a discussion panel (wired by the extension). */
export type OpenDiscussion = (projectId: string, discussionId: string | null, linkRowId?: string) => void;

/** Everything one panel shows. */
interface RowState {
  item: RowRef;
  located: LocatedRow | null;
  machineLinkId: string | null;
  status: RowApprovalStatus | null;
  discussions: DiscussionSummary[];
  /** Why server data is missing (worker offline, request failed). */
  serverNote: string | null;
}

/** The label of an approval group. */
function groupLabel(group: ApprovalGroup): string {
  switch (group) {
    case "teamLead":
      return vscode.l10n.t("Team lead");
    case "designated":
      return vscode.l10n.t("Designated approver");
    case "client":
      return vscode.l10n.t("Customer");
    case "member":
      return vscode.l10n.t("Approver");
  }
}

/** A date-time in the editor's language. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(vscode.env.language);
}

/** The row panels, one per project row. */
export class RowPanels implements vscode.Disposable {
  private readonly open = new Map<string, { view: PanelView; state: RowState }>();

  /** Over the API, the workspace link and the discussion opener. */
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: Api,
    private readonly link: WorkspaceLink,
    private readonly openDiscussion: OpenDiscussion,
  ) {}

  /** Open (or focus and refresh) the panel of a row. */
  async show(item: RowRef): Promise<void> {
    const key = `${item.projectId}:${item.id}`;
    const existing = this.open.get(key);
    if (existing) {
      existing.view.panel.reveal();
      await this.reload(existing.view, existing.state.item);
      return;
    }
    const view = new PanelView(this.extensionUri, "4pm.row", item.id, (e) => void this.onEvent(key, e));
    this.open.set(key, { view, state: { item, located: null, machineLinkId: null, status: null, discussions: [], serverNote: null } });
    view.panel.onDidDispose(() => {
      view.dispose();
      this.open.delete(key);
    });
    await this.reload(view, item);
  }

  /** Re-read every open panel (after a notification). */
  async refreshAll(): Promise<void> {
    await Promise.all([...this.open.values()].map((p) => this.reload(p.view, p.state.item)));
  }

  /** Close every panel. */
  dispose(): void {
    for (const p of this.open.values()) p.view.panel.dispose();
    this.open.clear();
  }

  /** Load the row from the book file and the server, then render. */
  private async reload(view: PanelView, item: RowRef): Promise<void> {
    const entry = this.open.get(`${item.projectId}:${item.id}`);
    if (!entry) return;
    if (view.current) view.render({ ...view.current, busy: true });
    const state: RowState = { item, located: await locateRow(item.id), machineLinkId: null, status: null, discussions: [], serverNote: null };
    try {
      const worker = await this.link.worker();
      state.machineLinkId = worker?.machineLinkId ?? null;
      const [status, discussions] = await Promise.all([
        worker?.online
          ? this.api.sdk.bookGovernance.status(item.projectId, worker.machineLinkId).then((r) => r.rows.find((x) => x.rowId === item.id) ?? null)
          : Promise.resolve(null),
        this.api.sdk.bookGovernance.listDiscussions(item.projectId, { rowId: item.id }).then((r) => r.items),
      ]);
      state.status = status;
      state.discussions = discussions;
      if (!worker?.online) state.serverNote = vscode.l10n.t("The project's worker is offline — approval progress is unavailable.");
    } catch (err) {
      state.serverNote = errorText(err);
    }
    entry.state = state;
    view.render(this.model(state));
  }

  /** Build the panel model. */
  private model(s: RowState): PanelModel {
    const { item, located, status } = s;
    const notices: PanelNotice[] = [];
    if (!located) notices.push({ kind: "warning", text: vscode.l10n.t("This row is not in the local book files — pull the latest books.") });
    if (s.serverNote) notices.push({ kind: "warning", text: s.serverNote });
    const changed = !!status && status.parties.length > 0 && !status.final;
    if (changed) notices.push({ kind: "info", text: vscode.l10n.t("Changed since it was approved. View diff compares with your last commit — pull first if the worker has newer books.") });
    if (status && status.openDiscussions > 0) {
      notices.push({ kind: "info", text: vscode.l10n.t("{0} open discussion(s) must be resolved before approval.", status.openDiscussions) });
    }

    const cells = located?.row?.cells ?? {};
    const detailFields = (located?.row?.columns ?? [])
      .filter((c) => c !== "ID" && c !== "Title")
      .map((c): [string, string] => [c, cells[c] ?? ""]);
    const sections: PanelSection[] = [
      {
        title: vscode.l10n.t("Details"),
        fields: [[vscode.l10n.t("State"), item.state], ...(item.due ? [[vscode.l10n.t("Due"), item.due] as [string, string]] : []), ...detailFields],
      },
    ];
    if (status) {
      sections.push({
        title: vscode.l10n.t("Approval"),
        fields: [
          [vscode.l10n.t("Status"), status.final ? vscode.l10n.t("Approved") : vscode.l10n.t("Not approved yet")],
          ...(status.required.length
            ? [[vscode.l10n.t("Required"), status.required.map((g) => `${status.satisfied.includes(g) ? "✔" : "○"} ${groupLabel(g)}`).join("   ")] as [string, string]]
            : []),
        ],
        items: status.parties.map((p) => ({ label: p.byLabel, detail: `${groupLabel(p.group)} · ${when(p.at)}` })),
      });
    }
    sections.push({
      title: vscode.l10n.t("Discussions"),
      items: s.discussions.map((d) => ({
        label: `${d.code} · ${d.title}`,
        detail: `${d.status === "open" ? vscode.l10n.t("open") : vscode.l10n.t("resolved")} · ${vscode.l10n.t("{0} message(s)", d.messageCount)}`,
        action: "openDiscussion",
        value: d.id,
      })),
      empty: vscode.l10n.t("No discussion about this row."),
    });

    const isQuestion = located?.book === "USER_QA" || item.kind === "QA";
    const unanswered = isQuestion && !(cells["Answer"] ?? "").trim();
    return {
      title: `${item.id} · ${item.title}`,
      subtitle: `${item.projectName}${located ? ` · ${located.book}` : ""}`,
      notices,
      sections,
      form: unanswered ? { id: "answer", label: vscode.l10n.t("Your answer"), submit: vscode.l10n.t("Send answer") } : undefined,
      actions: [
        ...(status && status.myGroups.length ? [{ id: "approve", label: vscode.l10n.t("Approve"), kind: "primary" as const }] : []),
        ...(status?.canUnapprove ? [{ id: "unapprove", label: vscode.l10n.t("Unapprove"), kind: "danger" as const }] : []),
        ...(changed && located ? [{ id: "diff", label: vscode.l10n.t("View diff") }] : []),
        { id: "newDiscussion", label: vscode.l10n.t("New discussion") },
        ...(located ? [{ id: "source", label: vscode.l10n.t("Open source") }] : []),
        { id: "web", label: vscode.l10n.t("Open in 4PM") },
        { id: "refresh", label: vscode.l10n.t("Refresh") },
      ],
    };
  }

  /** Handle a webview action. */
  private async onEvent(key: string, e: PanelEvent): Promise<void> {
    const entry = this.open.get(key);
    if (!entry || e.type !== "action") return;
    const { view, state } = entry;
    const { item } = state;
    switch (e.id) {
      case "refresh":
        return this.reload(view, item);
      case "source":
        if (state.located) await openSource(state.located);
        return;
      case "web":
        await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}${item.href}`, true));
        return;
      case "diff":
        if (state.located) await openRowDiff(state.located.uri, state.located.line, item.id);
        return;
      case "openDiscussion":
        if (e.value) this.openDiscussion(item.projectId, e.value);
        return;
      case "newDiscussion":
        this.openDiscussion(item.projectId, null, item.id);
        return;
      case "approve":
      case "unapprove":
        if (!state.machineLinkId) return;
        return this.run(view, item, () =>
          setApproval(this.api, state.machineLinkId!, [{ id: item.id, actions: state.located?.row?.cells["Actions"] }], e.id === "approve"),
        );
      case "answer":
        if (!e.value?.trim()) return;
        return this.run(view, item, () =>
          this.api.sdk.client.request({
            method: "POST",
            path: `/projects/${encodeURIComponent(item.projectId)}/autonomous/answers`,
            body: { questionId: item.id, answer: e.value!.trim() },
            auth: true,
          }),
        );
    }
  }

  /** Run a write, report a failure, then reload. */
  private async run(view: PanelView, item: RowRef, write: () => Promise<unknown>): Promise<void> {
    if (view.current) view.render({ ...view.current, busy: true });
    try {
      await write();
    } catch (err) {
      void vscode.window.showErrorMessage(errorText(err));
    }
    await this.reload(view, item);
  }
}
