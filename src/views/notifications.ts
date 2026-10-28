/**
 * The Notifications view (F4): the latest notifications with an unread badge, fed live by the user's SSE stream
 * (`notification-0002`) — one stream per window, reconnecting with backoff and honouring `Retry-After`; a new
 * notification also shows as an editor notification. Opening an unread one marks it read.
 * @adr 0670 @api notification-0001 @api notification-0002 @arch 0072
 */
import * as vscode from "vscode";
import type { NotificationResponse } from "@4pm/dto";
import type { Api } from "../api";
import { errorText } from "../api";
import { readSse, SseHttpError } from "../sse";

/** How many notifications the view lists. */
const PAGE_SIZE = 50;
/** Reconnect backoff bounds (ms). */
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

/** A one-line text for a notification: its payload's title / message, else its type in words. */
export function notificationText(n: Pick<NotificationResponse, "type" | "payload">): string {
  const p = n.payload ?? {};
  for (const key of ["title", "message", "text", "name"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return n.type.replace(/[._]/g, " ");
}

/** Tree data + the live stream. */
export class NotificationsProvider implements vscode.TreeDataProvider<NotificationResponse>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<NotificationResponse | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly arrived = new vscode.EventEmitter<Pick<NotificationResponse, "type" | "payload">>();
  /** Fires for each live notification (other parts refresh on it). */
  readonly onDidArrive = this.arrived.event;
  private items: NotificationResponse[] = [];
  private unread = 0;
  private view: vscode.TreeView<NotificationResponse> | null = null;
  private stream: AbortController | null = null;

  /** Over the API. */
  constructor(private readonly api: Api) {}

  /** Attach the tree view (for its badge). */
  attach(view: vscode.TreeView<NotificationResponse>): void {
    this.view = view;
    this.renderBadge();
  }

  /** Signed in ⇒ load and open the stream; signed out ⇒ clear and close it. */
  setSignedIn(signedIn: boolean): void {
    this.stream?.abort();
    this.stream = null;
    if (!signedIn) {
      this.items = [];
      this.unread = 0;
      this.renderBadge();
      this.changed.fire(undefined);
      return;
    }
    void this.refresh();
    const controller = new AbortController();
    this.stream = controller;
    void this.runStream(controller.signal);
  }

  /** Reload the list and the unread count. */
  async refresh(): Promise<void> {
    try {
      const [page, count] = await Promise.all([
        this.api.sdk.notifications.list({ page: 1, size: PAGE_SIZE }),
        this.api.sdk.notifications.unreadCount(),
      ]);
      this.items = page.items;
      this.unread = count.unread;
    } catch {
      // Keep the last list; the stream reconnect or the next event retries.
    }
    this.renderBadge();
    this.changed.fire(undefined);
  }

  /** Mark one read. */
  async markRead(n: NotificationResponse): Promise<void> {
    if (n.readAt) return;
    try {
      await this.api.sdk.notifications.read(n.id);
      await this.refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(errorText(err));
    }
  }

  /** Mark all read. */
  async markAllRead(): Promise<void> {
    try {
      await this.api.sdk.notifications.readAll();
      await this.refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(errorText(err));
    }
  }

  /** Root = the notifications. */
  getChildren(node?: NotificationResponse): NotificationResponse[] {
    return node ? [] : this.items;
  }

  /** Render one notification. */
  getTreeItem(n: NotificationResponse): vscode.TreeItem {
    const t = new vscode.TreeItem(notificationText(n));
    t.description = new Date(n.createdAt).toLocaleString(vscode.env.language);
    t.iconPath = new vscode.ThemeIcon(n.readAt ? "bell" : "bell-dot");
    t.contextValue = n.readAt ? "notification.read" : "notification.unread";
    t.command = { command: "4pm.markRead", title: vscode.l10n.t("Mark read"), arguments: [n] };
    return t;
  }

  /** Close the stream. */
  dispose(): void {
    this.stream?.abort();
    this.changed.dispose();
    this.arrived.dispose();
  }

  /** Keep one stream open until aborted: reconnect with backoff, honour `Retry-After`, refresh the token on 401. */
  private async runStream(signal: AbortSignal): Promise<void> {
    let backoff = BACKOFF_MIN_MS;
    while (!signal.aborted) {
      let waitMs = backoff;
      try {
        await readSse(this.api.url("/notifications/stream"), this.api.headers(), (m) => {
          backoff = BACKOFF_MIN_MS;
          // The event name is the notification type; `job.progress` (project create/add jobs) is not one.
          if (m.event !== "message" && m.event !== "job.progress") this.onLive(m.event, m.data);
        }, signal);
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof SseHttpError) {
          if (err.status === 401 && !(await this.api.ensureFresh())) return;
          if (err.retryAfterSec) waitMs = err.retryAfterSec * 1000;
        }
      }
      if (signal.aborted) return;
      await sleep(waitMs + Math.floor(Math.random() * 500), signal);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  }

  /** A live notification (`type` + its payload): show it and refresh. */
  private onLive(type: string, data: string): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const n = { type, payload };
    this.arrived.fire(n);
    // A mention gets its own actionable message (the extension opens the discussion).
    if (type !== "discussion.mentioned") void vscode.window.showInformationMessage(`4PM: ${notificationText(n)}`);
    void this.refresh();
  }

  /** Show the unread count on the view. */
  private renderBadge(): void {
    if (!this.view) return;
    this.view.badge = this.unread > 0 ? { value: this.unread, tooltip: vscode.l10n.t("{0} unread", this.unread) } : undefined;
  }
}

/** Wait `ms`, or less when aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
