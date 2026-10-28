/**
 * *View diff* of a changed book row: VS Code's diff editor on the book file — the last commit (`HEAD`) on the left,
 * the working tree on the right — positioned at the row, through the built-in Git extension's API. Exact only when
 * the local checkout matches the worker's books.
 * @adr 0673 @arch 0072
 */
import * as vscode from "vscode";

/** The part of the built-in Git extension API used here (`vscode.git`, API v1). */
interface GitApi {
  getRepository(uri: vscode.Uri): unknown | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

/** The Git API, or null when the Git extension is disabled. */
async function gitApi(): Promise<GitApi | null> {
  const ext = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>("vscode.git");
  if (!ext) return null;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports.getAPI(1);
}

/** Open the diff of `file` (HEAD ↔ working tree) at `line`; false (after telling the user) when it cannot. */
export async function openRowDiff(file: vscode.Uri, line: number, rowId: string): Promise<boolean> {
  const git = await gitApi();
  if (!git || !git.getRepository(file)) {
    void vscode.window.showInformationMessage(vscode.l10n.t("This book is not in a Git repository, so there is nothing to compare."));
    return false;
  }
  const pos = new vscode.Position(line, 0);
  await vscode.commands.executeCommand(
    "vscode.diff",
    git.toGitUri(file, "HEAD"),
    file,
    vscode.l10n.t("{0} — last commit ↔ working tree", rowId),
    { selection: new vscode.Range(pos, pos) },
  );
  return true;
}
