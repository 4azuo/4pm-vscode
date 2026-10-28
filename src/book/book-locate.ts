/**
 * Find a book row in the open workspace's book files (`AI_*.md` / `USER_*.md` at a folder root): the file, the
 * row's line and its parsed cells — for the row panel and *Open source*.
 * @adr 0670 @adr 0673 @arch 0072
 */
import * as vscode from "vscode";
import { findBookRow, type BookRow } from "./book-row";

/** The 0-based line where `id` first appears as a whole token, or -1. */
export function findRowLine(text: string, id: string): number {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`);
  const lines = text.split(/\r?\n/);
  return lines.findIndex((line) => re.test(line));
}

/** Where a row was found. */
export interface LocatedRow {
  uri: vscode.Uri;
  /** The book name (file name without `.md`). */
  book: string;
  line: number;
  /** The parsed row when it sits in a table; null when the id only appears in text. */
  row: BookRow | null;
}

/** The book file + row holding `id` in the workspace, or null. */
export async function locateRow(id: string): Promise<LocatedRow | null> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "{AI_,USER_}*.md"), null, 50);
    for (const uri of files) {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      const book = uri.path.split("/").pop()!.replace(/\.md$/, "");
      const row = findBookRow(text, id);
      if (row) return { uri, book, line: row.line, row };
      const line = findRowLine(text, id);
      if (line >= 0) return { uri, book, line, row: null };
    }
  }
  return null;
}

/** Open the book file at the row. */
export async function openSource(found: LocatedRow): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(found.uri);
  const pos = new vscode.Position(found.line, 0);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
}
