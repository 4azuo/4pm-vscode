/**
 * The My work view (F3): what waits on the user across projects, grouped as on the web (in progress, to check, to
 * approve, to answer, discussions, external). A row opens its book file at the row when its project is the linked
 * workspace, else its page on the web.
 * @adr 0670 @api user-0030 @arch 0072
 */
import * as vscode from "vscode";
import { MY_WORK_GROUPS, type MyWorkGroup, type MyWorkItem } from "@4pm/dto";
import type { Api } from "../api";
import { errorText } from "../api";

/** A tree node: a group or an item. */
type Node = { kind: "group"; group: MyWorkGroup; count: number } | { kind: "item"; item: MyWorkItem } | { kind: "error"; message: string };

/** The label of each group. */
function groupLabel(group: MyWorkGroup): string {
  switch (group) {
    case "inProgress":
      return vscode.l10n.t("In progress");
    case "toCheck":
      return vscode.l10n.t("To check");
    case "toApprove":
      return vscode.l10n.t("To approve");
    case "toAnswer":
      return vscode.l10n.t("To answer");
    case "discussions":
      return vscode.l10n.t("Discussions");
    case "external":
      return vscode.l10n.t("External");
  }
}

/** Tree data for My work. */
export class MyWorkProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: MyWorkItem[] = [];
  private counts: Partial<Record<MyWorkGroup, number>> = {};
  private error: string | null = null;
  private signedIn = false;

  /** Over the API. */
  constructor(private readonly api: Api) {}

  /** Set the signed-in state and reload. */
  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
    if (!signedIn) {
      this.items = [];
      this.counts = {};
      this.error = null;
      this.changed.fire(undefined);
      return;
    }
    void this.refresh();
  }

  /** Reload from the server. */
  async refresh(): Promise<void> {
    if (!this.signedIn) return;
    try {
      const res = await this.api.sdk.users.myWork({ page: 1, size: 100 });
      this.items = res.items;
      this.counts = res.counts;
      this.error = null;
    } catch (err) {
      this.error = errorText(err);
    }
    this.changed.fire(undefined);
  }

  /** Root = groups with items (or the error); a group's children = its items. */
  getChildren(node?: Node): Node[] {
    if (!this.signedIn) return [];
    if (!node) {
      if (this.error) return [{ kind: "error", message: this.error }];
      return MY_WORK_GROUPS.filter((g) => this.items.some((i) => i.group === g)).map((g) => ({
        kind: "group" as const,
        group: g,
        count: this.counts[g] ?? 0,
      }));
    }
    if (node.kind === "group") return this.items.filter((i) => i.group === node.group).map((item) => ({ kind: "item" as const, item }));
    return [];
  }

  /** Render a node. */
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "error") {
      const t = new vscode.TreeItem(vscode.l10n.t("Could not load My work"));
      t.description = node.message;
      t.iconPath = new vscode.ThemeIcon("warning");
      return t;
    }
    if (node.kind === "group") {
      const t = new vscode.TreeItem(groupLabel(node.group), vscode.TreeItemCollapsibleState.Expanded);
      t.description = String(node.count);
      return t;
    }
    const { item } = node;
    const t = new vscode.TreeItem(item.title || item.id);
    t.description = `${item.projectName} · ${item.id}${item.due ? ` · ${item.due}` : ""}`;
    t.tooltip = new vscode.MarkdownString(
      [`**${item.title}**`, `${item.projectName} · ${item.kind} ${item.id} · ${item.state}`, item.due ? vscode.l10n.t("Due {0}", item.due) : ""]
        .filter(Boolean)
        .join("\n\n"),
    );
    t.iconPath = new vscode.ThemeIcon(item.kind === "DSC" ? "comment-discussion" : item.kind === "QA" ? "question" : "circle-outline");
    t.contextValue = "workItem";
    t.command = { command: "4pm.openItem", title: vscode.l10n.t("Open"), arguments: [item] };
    return t;
  }
}

/** The item a tree node / command argument refers to. */
export function itemOf(arg: unknown): MyWorkItem | null {
  if (!arg || typeof arg !== "object") return null;
  if ("item" in arg) return (arg as { item: MyWorkItem }).item;
  if ("href" in arg && "projectId" in arg) return arg as MyWorkItem;
  return null;
}
