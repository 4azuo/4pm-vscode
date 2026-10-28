/**
 * Find a My-work row in the open workspace's book files (`AI_*.md` / `USER_*.md` at a folder root), so the row opens
 * at its line in the editor instead of the web.
 * @adr 0670 @arch 0072
 */
import * as vscode from "vscode";

/** The 0-based line where `id` first appears as a whole token, or -1. */
export function findRowLine(text: string, id: string): number {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`);
  const lines = text.split(/\r?\n/);
  return lines.findIndex((line) => re.test(line));
}

/** The book file + line holding `id` in the workspace, or null. */
export async function locateRow(id: string): Promise<{ uri: vscode.Uri; line: number } | null> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "{AI_,USER_}*.md"), null, 50);
    for (const uri of files) {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      const line = findRowLine(text, id);
      if (line >= 0) return { uri, line };
    }
  }
  return null;
}
