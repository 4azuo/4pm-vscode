/**
 * Pure builders of the book editor: which book a file is, the editable table of a book, the row patch of the user's
 * edits, and the task board (waiting · approved · in progress · done) from the worker's books + approval progress.
 * @adr 0674 @arch 0072
 */
import { bookRowHash, bookTable, liveClaimedIds, type BookPatch, type RowApprovalStatus } from "@4pm/dto";

/** A book the editor opens, by its `machine-0028` key. */
export type BookKey = "userTodo" | "userQa" | "aiTodo" | "aiProgress" | "aiDone";

/** File name (without `.md`) → book key. */
const BOOK_FILES: Record<string, BookKey> = {
  USER_TODO: "userTodo",
  USER_QA: "userQa",
  AI_TODO: "aiTodo",
  AI_PROGRESS: "aiProgress",
  AI_DONE: "aiDone",
};

/** The book key of a file name (`AI_TODO.md` ⇒ `aiTodo`), or null. */
export function bookKeyOf(fileName: string): BookKey | null {
  return BOOK_FILES[fileName.replace(/\.md$/i, "").toUpperCase()] ?? null;
}

/** The books a user edits here (the cli owns AI_PROGRESS; AI_DONE's verdict stays on the web). */
export function isEditable(book: BookKey): book is "userTodo" | "userQa" | "aiTodo" {
  return book === "userTodo" || book === "userQa" || book === "aiTodo";
}

/** The task books (they share the board). */
export function isTaskBook(book: BookKey): boolean {
  return book === "aiTodo" || book === "aiProgress" || book === "aiDone";
}

/** One row of the editor table: the base cells and the user's draft (when edited). */
export interface TableRow {
  id: string;
  line: number;
  cells: string[];
}

/** A book's table for the editor (null when the book has no id table). */
export function readTable(md: string): { header: string[]; rows: TableRow[] } | null {
  const t = bookTable(md);
  if (!t) return null;
  return { header: t.header, rows: t.rows.map((r) => ({ id: r.id, line: r.line, cells: t.header.map((_, k) => r.cells[k] ?? "") })) };
}

/**
 * The row patch of the edited rows against the base book (`prev` = the base row's hash, as `diffBook` would);
 * null when nothing changed. Rows unknown to the base are skipped.
 */
export function editsPatch(base: string, edits: ReadonlyMap<string, string[]>): BookPatch | null {
  const t = bookTable(base);
  if (!t) return null;
  const rows: BookPatch["rows"] = [];
  for (const [id, draft] of edits) {
    const row = t.rows.find((r) => r.id === id);
    if (!row) continue;
    const before = t.header.map((_, k) => row.cells[k] ?? "");
    if (before.every((v, k) => v === (draft[k] ?? ""))) continue;
    rows.push({ id, prev: bookRowHash(t.header, row.cells), cells: Object.fromEntries(t.header.map((h, k) => [h, draft[k] ?? ""])) });
  }
  return rows.length ? { v: 1, columns: t.header, rows } : null;
}

/** One board card. */
export interface BoardCard {
  id: string;
  title: string;
  team: string;
  priority: string;
  /** Approval mark: `final`, `n/m` of the required groups, or "". */
  approval: string;
  /** The worker holding a live claim. */
  worker?: string;
}

/** The four board columns. */
export interface Board {
  waiting: BoardCard[];
  approved: BoardCard[];
  running: BoardCard[];
  done: BoardCard[];
}

/** A cell by column name (case-insensitive). */
function cell(header: string[], cells: string[], name: string): string {
  const k = header.findIndex((h) => h.trim().toLowerCase() === name);
  return k >= 0 ? (cells[k] ?? "").trim() : "";
}

/** The approval mark of a row. */
export function approvalMark(status: RowApprovalStatus | undefined): string {
  if (!status) return "";
  if (status.final) return "final";
  return status.required.length ? `${status.satisfied.length}/${status.required.length}` : "";
}

/**
 * The task board: AI_TODO rows not final ⇒ waiting, final ⇒ approved (queued); rows under a live AI_PROGRESS claim ⇒
 * in progress; AI_DONE rows ⇒ done.
 */
export function buildBoard(
  books: { aiTodo: string; aiProgress: string; aiDone: string },
  status: ReadonlyMap<string, RowApprovalStatus>,
  ttl: { claimTtlHours: number; runTimeoutMinutes: number },
  now = Date.now(),
): Board {
  const board: Board = { waiting: [], approved: [], running: [], done: [] };
  const claims = liveClaimedIds(books.aiProgress, ttl, now);
  const card = (header: string[], r: TableRow): BoardCard => ({
    id: r.id,
    title: cell(header, r.cells, "title") || cell(header, r.cells, "task description"),
    team: cell(header, r.cells, "team") || cell(header, r.cells, "group"),
    priority: cell(header, r.cells, "priority"),
    approval: approvalMark(status.get(r.id)),
    ...(claims.has(r.id) ? { worker: claims.get(r.id) } : {}),
  });
  const todo = readTable(books.aiTodo);
  for (const r of todo?.rows ?? []) {
    const c = card(todo!.header, r);
    if (claims.has(r.id)) board.running.push(c);
    else if (status.get(r.id)?.final) board.approved.push(c);
    else board.waiting.push(c);
  }
  const done = readTable(books.aiDone);
  for (const r of done?.rows ?? []) board.done.push(card(done!.header, r));
  return board;
}
