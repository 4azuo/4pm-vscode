/**
 * The discussion panel (D4): one discussion of the linked project — its messages and a reply box — or a new
 * discussion (title asked first, optionally linked to the book row it was opened from). One panel per discussion.
 * @adr 0673 @api project-0109 @api project-0110 @api project-0111 @arch 0072
 */
import * as vscode from "vscode";
import type { DiscussionDetail } from "@4pm/dto";
import type { Api } from "../api";
import { errorText } from "../api";
import type { PanelEvent, PanelModel } from "./model";
import { PanelView } from "./webview";

/** A date-time in the editor's language. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(vscode.env.language);
}

/** The discussion panels. */
export class DiscussionPanels implements vscode.Disposable {
  private readonly open = new Map<string, PanelView>();
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires after a discussion was created or replied to (views refresh). */
  readonly onDidChange = this.changed.event;

  /** Over the API. */
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly api: Api,
  ) {}

  /** Open a discussion, or start a new one (`discussionId` null) linked to `linkRowId`. */
  async show(projectId: string, discussionId: string | null, linkRowId?: string): Promise<void> {
    if (discussionId === null) return this.create(projectId, linkRowId);
    const existing = this.open.get(discussionId);
    if (existing) {
      existing.panel.reveal();
      await this.reload(existing, projectId, discussionId);
      return;
    }
    const view = new PanelView(this.extensionUri, "4pm.discussion", vscode.l10n.t("Discussion"), (e) =>
      void this.onEvent(view, projectId, discussionId, e),
    );
    this.open.set(discussionId, view);
    view.panel.onDidDispose(() => {
      view.dispose();
      this.open.delete(discussionId);
    });
    await this.reload(view, projectId, discussionId);
  }

  /** Re-read every open discussion (after a discussion notification). */
  async refreshAll(projectId: string): Promise<void> {
    await Promise.all([...this.open.entries()].map(([id, view]) => this.reload(view, projectId, id)));
  }

  /** Close every panel. */
  dispose(): void {
    for (const view of this.open.values()) view.panel.dispose();
    this.open.clear();
    this.changed.dispose();
  }

  /** Ask a title, then show a panel whose form sends the first message. */
  private async create(projectId: string, linkRowId?: string): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: linkRowId ? vscode.l10n.t("Title of the new discussion about {0}", linkRowId) : vscode.l10n.t("Title of the new discussion"),
      validateInput: (v) => (v.trim().length > 200 ? vscode.l10n.t("At most 200 characters.") : null),
    });
    if (!title?.trim()) return;
    const view = new PanelView(this.extensionUri, "4pm.discussion", title.trim(), (e) => {
      if (e.type !== "action" || e.id !== "create" || !e.value?.trim()) return;
      void (async () => {
        if (view.current) view.render({ ...view.current, busy: true });
        try {
          const created = await this.api.sdk.bookGovernance.createDiscussion(projectId, {
            title: title.trim(),
            body: e.value!.trim(),
            team: "",
            links: linkRowId && /^(REQ|TSK|DOC|QA)-[\w-]+$/.test(linkRowId) ? [linkRowId] : [],
            addresseeUserIds: [],
            addresseeTeamIds: [],
            tags: [],
            due: null,
            issues: [],
          });
          this.changed.fire();
          view.panel.dispose();
          await this.show(projectId, created.id);
        } catch (err) {
          void vscode.window.showErrorMessage(errorText(err));
          if (view.current) view.render({ ...view.current, busy: false });
        }
      })();
    });
    view.panel.onDidDispose(() => view.dispose());
    view.render({
      title: title.trim(),
      subtitle: linkRowId ? vscode.l10n.t("New discussion about {0}", linkRowId) : vscode.l10n.t("New discussion"),
      sections: [],
      actions: [],
      form: { id: "create", label: vscode.l10n.t("First message"), submit: vscode.l10n.t("Open discussion") },
    });
  }

  /** Load and render one discussion. */
  private async reload(view: PanelView, projectId: string, discussionId: string): Promise<void> {
    if (view.current) view.render({ ...view.current, busy: true });
    try {
      view.render(this.model(await this.api.sdk.bookGovernance.getDiscussion(projectId, discussionId)));
    } catch (err) {
      view.render({ title: vscode.l10n.t("Discussion"), notices: [{ kind: "error", text: errorText(err) }], sections: [], actions: [{ id: "refresh", label: vscode.l10n.t("Refresh") }] });
    }
  }

  /** Build the panel model. */
  private model(d: DiscussionDetail): PanelModel {
    return {
      title: `${d.code} · ${d.title}`,
      subtitle: [
        d.status === "open" ? vscode.l10n.t("open") : vscode.l10n.t("resolved"),
        d.authorName,
        when(d.createdAt),
        d.links.length ? vscode.l10n.t("about {0}", d.links.join(", ")) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      notices: d.pendingOps > 0 ? [{ kind: "info", text: vscode.l10n.t("Some changes are not saved to the repository yet.") }] : [],
      sections: [
        {
          title: vscode.l10n.t("Messages"),
          messages: d.messages.map((m) => ({
            author: m.authorName,
            at: `${when(m.at)}${m.editedAt ? ` · ${vscode.l10n.t("edited")}` : ""}`,
            body: m.deleted ? vscode.l10n.t("(deleted)") : m.body,
            muted: m.deleted || m.syncing,
          })),
          empty: vscode.l10n.t("No messages yet."),
        },
      ],
      form: { id: "reply", label: vscode.l10n.t("Reply"), submit: vscode.l10n.t("Send") },
      actions: [{ id: "refresh", label: vscode.l10n.t("Refresh") }],
    };
  }

  /** Handle a webview action. */
  private async onEvent(view: PanelView, projectId: string, discussionId: string, e: PanelEvent): Promise<void> {
    if (e.type !== "action") return;
    if (e.id === "refresh") return this.reload(view, projectId, discussionId);
    if (e.id !== "reply" || !e.value?.trim()) return;
    if (view.current) view.render({ ...view.current, busy: true });
    try {
      await this.api.sdk.bookGovernance.postMessage(projectId, discussionId, { body: e.value.trim(), mentionUserIds: [] });
      this.changed.fire();
    } catch (err) {
      void vscode.window.showErrorMessage(errorText(err));
    }
    await this.reload(view, projectId, discussionId);
  }
}
