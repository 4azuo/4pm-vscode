/**
 * The "4PM Book" custom editor (*Open With…*, priority option) of the linked project's book files: the table reads the
 * **worker's** books (`machine-0028`) and approval progress (`project-0103`), cell edits are saved as a row patch
 * (`machine-0029` `bookSave`, AI_TODO through `machine-0063`), a USER_TODO form adds a request, selected rows are
 * approved / unapproved, and the task books show a board. Worker offline ⇒ the local file, read-only. The server and
 * the cli enforce every rule; the editor shows their answer.
 * @adr 0674 @api machine-0028 @api machine-0029 @api machine-0063 @api project-0103 @api project-0124 @arch 0072
 */
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { bookContentHash, type RowApprovalStatus } from "@4pm/dto";
import type { Api } from "../api";
import { errorText } from "../api";
import { webUrl } from "../config";
import type { WorkspaceLink } from "../workspace-link";
import type { PanelNotice } from "../panels/model";
import { setApproval } from "./approve";
import { approvalMark, bookKeyOf, buildBoard, editsPatch, isEditable, isTaskBook, readTable, type Board, type BookKey, type TableRow } from "./book-model";

/** The editor's view type (package.json `customEditors`). */
export const BOOK_EDITOR_VIEW_TYPE = "4pm.book";

/** Book files to open on the Board tab (set by the *Task board* command before it opens the editor). */
const boardRequests = new Set<string>();

/** Open `uri` in the book editor, on the Board tab when `board`. */
export async function openBookEditor(uri: vscode.Uri, board = false): Promise<void> {
  if (board) boardRequests.add(uri.toString());
  await vscode.commands.executeCommand("vscode.openWith", uri, BOOK_EDITOR_VIEW_TYPE);
}

/** What the webview renders. */
interface BookViewModel {
  title: string;
  subtitle: string;
  notices: PanelNotice[];
  editable: boolean;
  busy: boolean;
  columns: string[];
  rows: { id: string; cells: string[]; edited: boolean; conflict: boolean; approval: string; canApprove: boolean; canUnapprove: boolean }[];
  dirty: number;
  board: { key: keyof Board; title: string; cards: Board[keyof Board] }[] | null;
  canNewRequest: boolean;
  /** The tab to show first (sent once). */
  initialTab?: "board";
  labels: Record<string, string>;
}

/** A message from the webview. */
type BookEvent =
  | { type: "ready" }
  | { type: "edit"; id: string; col: number; value: string }
  | { type: "approve" | "unapprove"; ids: string[] }
  | { type: "save" | "discard" | "refresh" | "source" | "web" }
  | { type: "open"; id: string }
  | { type: "newRequest"; text: string };

/** Opens a row panel by id (wired by the extension). */
export type OpenRow = (projectId: string, rowId: string) => void;

/** The book editor provider. */
export class BookEditorProvider implements vscode.CustomReadonlyEditorProvider {
  /** Over the API, the workspace link and the row panel opener. */
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: Api,
    private readonly link: WorkspaceLink,
    private readonly openRow: OpenRow,
  ) {}

  /** The document is just the file's URI — the editor never writes it. */
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  /** Start a session for one opened book. */
  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    const book = bookKeyOf(document.uri.path.split("/").pop() ?? "");
    const session = new BookSession(document.uri, book, panel, this.extensionUri, this.api, this.link, this.openRow);
    panel.onDidDispose(() => session.dispose());
    await session.load();
  }
}

/** One open book editor. */
class BookSession implements vscode.Disposable {
  private base = "";
  private header: string[] = [];
  private rows: TableRow[] = [];
  private status = new Map<string, RowApprovalStatus>();
  private readonly edits = new Map<string, string[]>();
  private conflicts = new Set<string>();
  private notices: PanelNotice[] = [];
  private board: Board | null = null;
  private machineLinkId: string | null = null;
  private projectId: string | null = null;
  private readOnly = true;
  private busy = false;
  private ready = false;
  private initialTab: "board" | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  /** Bind the webview. */
  constructor(
    private readonly uri: vscode.Uri,
    private readonly book: BookKey | null,
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly api: Api,
    private readonly link: WorkspaceLink,
    private readonly openRow: OpenRow,
  ) {
    if (boardRequests.delete(uri.toString())) this.initialTab = "board";
    const media = vscode.Uri.joinPath(extensionUri, "media");
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = shell(panel.webview, media);
    this.subscriptions.push(panel.webview.onDidReceiveMessage((e: BookEvent) => void this.onEvent(e)));
  }

  /** Read the book (worker when online, else the local file) and render. */
  async load(): Promise<void> {
    this.notices = [...this.conflictNotice()];
    this.board = null;
    this.status.clear();
    const local = new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri));
    this.readOnly = true;
    this.machineLinkId = null;
    this.projectId = this.link.project?.id ?? null;
    if (!this.book) {
      this.notices.push({ kind: "error", text: vscode.l10n.t("This file is not a 4PM book.") });
      this.use(local);
      return this.render();
    }
    if (!this.projectId) {
      this.notices.push({ kind: "warning", text: vscode.l10n.t("Link this workspace to a 4PM project to see the worker's books and edit them.") });
      this.use(local);
      return this.render();
    }
    try {
      const worker = await this.link.worker();
      if (!worker?.online) {
        this.notices.push({ kind: "warning", text: vscode.l10n.t("The project's worker is offline — showing your local file, read-only.") });
        this.use(local);
        return this.render();
      }
      this.machineLinkId = worker.machineLinkId;
      const [read, approval, policy] = await Promise.all([
        this.api.sdk.machines.autonomousRead(worker.machineLinkId),
        this.api.sdk.bookGovernance.status(this.projectId, worker.machineLinkId).catch(() => null),
        isTaskBook(this.book) ? this.api.sdk.projects.autonomousWorkers(this.projectId).catch(() => null) : Promise.resolve(null),
      ]);
      for (const r of approval?.rows ?? []) this.status.set(r.rowId, r);
      this.use(read.books[this.book]);
      this.readOnly = !isEditable(this.book);
      if (bookContentHash(local) !== bookContentHash(this.base)) {
        this.notices.push({ kind: "info", text: vscode.l10n.t("Your local file differs from the worker's books — saves go to the worker; pull to update your checkout.") });
      }
      if (policy) {
        this.board = buildBoard(read.books, this.status, {
          claimTtlHours: policy.settings.claimTtlHours,
          runTimeoutMinutes: policy.settings.runTimeoutMinutes,
        });
      }
    } catch (err) {
      this.notices.push({ kind: "error", text: errorText(err) });
      this.use(local);
    }
    this.render();
  }

  /** Close. */
  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }

  /** Take `md` as the base the table and edits refer to (edits of rows that vanished are dropped). */
  private use(md: string): void {
    this.base = md;
    const table = readTable(md);
    this.header = table?.header ?? [];
    this.rows = table?.rows ?? [];
    for (const id of [...this.edits.keys()]) if (!this.rows.some((r) => r.id === id)) this.edits.delete(id);
  }

  /** The notice listing rows a save could not merge. */
  private conflictNotice(): PanelNotice[] {
    return this.conflicts.size
      ? [{ kind: "warning", text: vscode.l10n.t("Someone else changed {0} meanwhile — your edits there were dropped; the rest is kept.", [...this.conflicts].join(", ")) }]
      : [];
  }

  /** Send the view model. */
  private render(): void {
    if (!this.ready) return;
    const editable = !this.readOnly && !!this.machineLinkId;
    const model: BookViewModel = {
      title: this.uri.path.split("/").pop() ?? "",
      subtitle: this.machineLinkId ? vscode.l10n.t("Worker's books") : vscode.l10n.t("Local file"),
      notices: this.notices,
      editable,
      busy: this.busy,
      columns: this.header,
      rows: this.rows.map((r) => {
        const s = this.status.get(r.id);
        return {
          id: r.id,
          cells: this.edits.get(r.id) ?? r.cells,
          edited: this.edits.has(r.id),
          conflict: this.conflicts.has(r.id),
          approval: approvalMark(s),
          canApprove: !!s && s.myGroups.length > 0 && !!this.machineLinkId,
          canUnapprove: !!s && s.canUnapprove && !!this.machineLinkId,
        };
      }),
      dirty: this.edits.size,
      board: this.board
        ? [
            { key: "waiting", title: vscode.l10n.t("Waiting for approval"), cards: this.board.waiting },
            { key: "approved", title: vscode.l10n.t("Approved — queued"), cards: this.board.approved },
            { key: "running", title: vscode.l10n.t("In progress"), cards: this.board.running },
            { key: "done", title: vscode.l10n.t("Done"), cards: this.board.done },
          ]
        : null,
      canNewRequest: editable && this.book === "userTodo",
      ...(this.initialTab && this.board ? { initialTab: this.initialTab } : {}),
      labels: {
        table: vscode.l10n.t("Table"),
        board: vscode.l10n.t("Board"),
        filter: vscode.l10n.t("Filter rows…"),
        save: vscode.l10n.t("Save {0} change(s)"),
        discard: vscode.l10n.t("Discard"),
        refresh: vscode.l10n.t("Refresh"),
        approve: vscode.l10n.t("Approve selected"),
        unapprove: vscode.l10n.t("Unapprove selected"),
        source: vscode.l10n.t("Open source"),
        web: vscode.l10n.t("Open in 4PM"),
        approval: vscode.l10n.t("Approval"),
        open: vscode.l10n.t("Open"),
        newRequest: vscode.l10n.t("New request"),
        send: vscode.l10n.t("Add request"),
        empty: vscode.l10n.t("No rows."),
        readOnly: vscode.l10n.t("Read-only"),
      },
    };
    if (model.initialTab) this.initialTab = undefined;
    void this.panel.webview.postMessage({ type: "render", model });
  }

  /** Handle a webview message. */
  private async onEvent(e: BookEvent): Promise<void> {
    switch (e.type) {
      case "ready":
        this.ready = true;
        return this.render();
      case "edit": {
        if (this.readOnly) return;
        const row = this.rows.find((r) => r.id === e.id);
        if (!row || e.col < 0 || e.col >= this.header.length || this.header[e.col]?.trim().toLowerCase() === "id") return;
        const draft = [...(this.edits.get(e.id) ?? row.cells)];
        draft[e.col] = e.value.replace(/\r?\n/g, " ");
        if (draft.every((v, k) => v === (row.cells[k] ?? ""))) this.edits.delete(e.id);
        else this.edits.set(e.id, draft);
        return this.render();
      }
      case "discard":
        this.edits.clear();
        this.conflicts.clear();
        return this.load();
      case "refresh":
        return this.load();
      case "source":
        await vscode.window.showTextDocument(this.uri, { preview: false });
        return;
      case "web":
        if (this.projectId) await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}/projects/${this.projectId}`, true));
        return;
      case "open":
        if (this.projectId) this.openRow(this.projectId, e.id);
        return;
      case "save":
        return this.write(() => this.save());
      case "approve":
      case "unapprove":
        if (!this.machineLinkId || e.ids.length === 0) return;
        return this.write(() =>
          setApproval(
            this.api,
            this.machineLinkId!,
            e.ids.map((id) => ({ id, actions: this.cellOf(id, "actions") })),
            e.type === "approve",
          ),
        );
      case "newRequest":
        if (!this.machineLinkId || !e.text.trim()) return;
        return this.write(() => this.api.sdk.machines.autonomousWrite(this.machineLinkId!, { kind: "userTodo", content: e.text.trim() }));
    }
  }

  /** Send the edits as a row patch. */
  private async save(): Promise<void> {
    if (!this.machineLinkId || !this.book || !isEditable(this.book)) return;
    const patch = editsPatch(this.base, this.edits);
    if (!patch) {
      this.edits.clear();
      return;
    }
    if (this.book === "aiTodo") {
      await this.api.sdk.machines.tasksApproveBatch(this.machineLinkId, { approvals: [], unapprovals: [], book: { patch } });
    } else {
      await this.api.sdk.machines.autonomousWrite(this.machineLinkId, { kind: "bookSave", book: this.book, patch });
    }
    this.edits.clear();
    this.conflicts.clear();
  }

  /** Run a write; a conflict drops the conflicting edits and keeps the rest; then re-read. */
  private async write(run: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    this.render();
    try {
      await run();
    } catch (err) {
      const e = err as { errorCode?: string; meta?: Record<string, string | number> | null };
      const ids = typeof e.meta?.ids === "string" ? e.meta.ids.split(",").filter(Boolean) : [];
      if (e.errorCode === "BOOK_CONFLICT") {
        this.conflicts = new Set(ids);
        for (const id of ids) this.edits.delete(id);
      } else {
        void vscode.window.showErrorMessage(ids.length ? `${errorText(err)} — ${ids.join(", ")}` : errorText(err));
      }
    }
    this.busy = false;
    await this.load();
  }

  /** A base cell of a row by column name (case-insensitive). */
  private cellOf(id: string, column: string): string {
    const k = this.header.findIndex((h) => h.trim().toLowerCase() === column);
    const row = this.rows.find((r) => r.id === id);
    return k >= 0 && row ? (row.cells[k] ?? "") : "";
  }
}

/** The editor's HTML shell (strict CSP, nonce script). */
function shell(webview: vscode.Webview, media: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "book.js"));
  const styles = [webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css")), webview.asWebviewUri(vscode.Uri.joinPath(media, "book.css"))];
  const csp = ["default-src 'none'", `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join("; ");
  return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styles.map((s) => `<link rel="stylesheet" href="${s}">`).join("\n")}
</head>
<body class="book"><main id="root"></main><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
}
