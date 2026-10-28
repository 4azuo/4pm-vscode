/**
 * One row of a book file (`AI_TODO.md`, `USER_QA.md`…) read with the shared book table reader of `@4pm/dto` —
 * the same table web, server and cli diff and patch.
 * @adr 0673 @adr 0674 @arch 0072
 */
import { bookTable } from "@4pm/dto";

/** One parsed book row. */
export interface BookRow {
  id: string;
  /** 0-based line of the row in the file. */
  line: number;
  /** Column names in order (`ID` first). */
  columns: string[];
  /** Cell text by column name. */
  cells: Record<string, string>;
}

/** The row whose id is `id` in the book's id table, or null. */
export function findBookRow(text: string, id: string): BookRow | null {
  const table = bookTable(text);
  const row = table?.rows.find((r) => r.id === id);
  if (!table || !row) return null;
  return {
    id,
    line: row.line,
    columns: table.header,
    cells: Object.fromEntries(table.header.map((h, k) => [h, row.cells[k] ?? ""])),
  };
}
