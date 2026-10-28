/**
 * The Discussions view (D4): the linked project's discussions, open ones first, with a badge of those waiting on the
 * user (My work's *discussions* group for this project). A row opens the discussion panel.
 * @adr 0673 @api project-0108 @arch 0072
 */
import * as vscode from "vscode";
import type { DiscussionSummary } from "@4pm/dto";
import type { Api } from "../api";
import { errorText } from "../api";
import type { WorkspaceLink } from "../workspace-link";

/** A node: a discussion, or a message line (no project / error). */
type Node = { kind: "discussion"; d: DiscussionSummary } | { kind: "note"; text: string; icon: string };

/** Tree data for the linked project's discussions. */
export class DiscussionsProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: DiscussionSummary[] = [];
  private note: Node | null = null;
  private signedIn = false;
  private view: vscode.TreeView<Node> | null = null;

  /** Over the API and the workspace link. */
  constructor(
    private readonly api: Api,
    private readonly link: WorkspaceLink,
  ) {}

  /** Attach the tree view (for its badge). */
  attach(view: vscode.TreeView<Node>): void {
    this.view = view;
  }

  /** Set the signed-in state and reload. */
  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
    void this.refresh();
  }

  /** The number of discussions waiting on the user (from My work). */
  setWaiting(count: number): void {
    if (this.view) this.view.badge = count > 0 ? { value: count, tooltip: vscode.l10n.t("{0} waiting on you", count) } : undefined;
  }

  /** Reload the list. */
  async refresh(): Promise<void> {
    const project = this.link.project;
    this.items = [];
    this.note = null;
    if (!this.signedIn) {
      this.changed.fire(undefined);
      return;
    }
    if (!project) {
      this.note = { kind: "note", text: vscode.l10n.t("Link this workspace to a 4PM project"), icon: "link" };
    } else {
      try {
        const res = await this.api.sdk.bookGovernance.listDiscussions(project.id);
        this.items = [...res.items].sort(
          (a, b) => Number(a.status !== "open") - Number(b.status !== "open") || b.lastActivityAt.localeCompare(a.lastActivityAt),
        );
        if (this.items.length === 0) this.note = { kind: "note", text: vscode.l10n.t("No discussions yet."), icon: "comment" };
      } catch (err) {
        this.note = { kind: "note", text: errorText(err), icon: "warning" };
      }
    }
    this.changed.fire(undefined);
  }

  /** Root = the discussions (or a note). */
  getChildren(node?: Node): Node[] {
    if (node || !this.signedIn) return [];
    return this.note ? [this.note] : this.items.map((d) => ({ kind: "discussion" as const, d }));
  }

  /** Render a node. */
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "note") {
      const t = new vscode.TreeItem(node.text);
      t.iconPath = new vscode.ThemeIcon(node.icon);
      if (node.icon === "link") t.command = { command: "4pm.linkProject", title: node.text };
      return t;
    }
    const { d } = node;
    const t = new vscode.TreeItem(`${d.code} · ${d.title}`);
    t.description = `${d.messageCount} · ${new Date(d.lastActivityAt).toLocaleDateString(vscode.env.language)}`;
    t.iconPath = new vscode.ThemeIcon(d.status === "open" ? "comment-discussion" : "pass");
    t.tooltip = `${d.title}\n${d.authorName}${d.links.length ? ` · ${d.links.join(", ")}` : ""}`;
    t.command = { command: "4pm.openDiscussion", title: vscode.l10n.t("Open"), arguments: [d.id] };
    return t;
  }
}
