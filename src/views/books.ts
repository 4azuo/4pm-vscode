/**
 * The Books view: the linked workspace's book files (USER_TODO, USER_QA, AI_TODO, AI_PROGRESS, AI_DONE at a folder
 * root); a click opens the 4PM Book editor.
 * @adr 0674 @arch 0072
 */
import * as vscode from "vscode";
import { bookKeyOf } from "../book/book-model";

/** The book files in workspace order. */
const ORDER = ["USER_TODO.md", "USER_QA.md", "AI_TODO.md", "AI_PROGRESS.md", "AI_DONE.md"];

/** The book files of the open workspace folders. */
export async function findBookFiles(): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "{USER_TODO,USER_QA,AI_TODO,AI_PROGRESS,AI_DONE}.md"), null, 20);
    files.sort((a, b) => ORDER.indexOf(a.path.split("/").pop()!) - ORDER.indexOf(b.path.split("/").pop()!));
    out.push(...files);
  }
  return out;
}

/** Tree data for the Books view. */
export class BooksProvider implements vscode.TreeDataProvider<vscode.Uri> {
  private readonly changed = new vscode.EventEmitter<vscode.Uri | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Reload (folders changed, link changed). */
  refresh(): void {
    this.changed.fire(undefined);
  }

  /** Root = the book files. */
  async getChildren(node?: vscode.Uri): Promise<vscode.Uri[]> {
    return node ? [] : findBookFiles();
  }

  /** Render one book. */
  getTreeItem(uri: vscode.Uri): vscode.TreeItem {
    const name = uri.path.split("/").pop()!;
    const t = new vscode.TreeItem(name.replace(/\.md$/, ""));
    t.resourceUri = uri;
    t.description = vscode.workspace.asRelativePath(uri, true) === name ? undefined : vscode.workspace.asRelativePath(uri, true);
    t.iconPath = new vscode.ThemeIcon(bookKeyOf(name)?.startsWith("ai") ? "checklist" : "person");
    t.command = { command: "4pm.openBook", title: vscode.l10n.t("Open"), arguments: [uri] };
    return t;
  }
}
