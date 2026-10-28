/**
 * Entry point of the 4PM VS Code extension: wires the session store, the AuthenticationProvider + URI handler, the
 * My work / Notifications / Discussions / Books views, the row and discussion panels, the 4PM Book editor, the status
 * bar and its project menu,
 * the workspace ↔ project link and the worker runner, and keeps them in step with the signed-in state (context keys
 * `4pm.signedIn`, `4pm.projectLinked`, `4pm.running`).
 * @adr 0670 @adr 0673 @adr 0674 @arch 0072
 */
import * as vscode from "vscode";
import type { MyWorkItem, NotificationResponse } from "@4pm/dto";
import { Api, showError } from "./api";
import { AUTH_PROVIDER_ID, FourPmAuthProvider } from "./auth/auth-provider";
import { SessionStore } from "./auth/session-store";
import { BOOK_EDITOR_VIEW_TYPE, BookEditorProvider, openBookEditor } from "./book/book-editor";
import { locateRow } from "./book/book-locate";
import { affectsOrigins, serverUrl, webUrl } from "./config";
import { DiscussionPanels } from "./panels/discussion-panel";
import { RowPanels } from "./panels/row-panel";
import { Runner } from "./run/runner";
import { StatusBar } from "./status-bar";
import { BooksProvider, findBookFiles } from "./views/books";
import { DiscussionsProvider } from "./views/discussions";
import { itemOf, MyWorkProvider } from "./views/my-work";
import { NotificationsProvider } from "./views/notifications";
import { WorkspaceLink } from "./workspace-link";

/** My-work kinds that are rows of a book file in the repo. */
const BOOK_KINDS = new Set(["REQ", "QA", "TSK", "DOC", "AST", "DONE", "REQUEST"]);

/** The discussion id a My-work `DSC` item links to (`…&discussion=<id>` in its href). */
export function discussionIdOf(href: string): string | null {
  const query = href.split("?")[1];
  return query ? new URLSearchParams(query).get("discussion") : null;
}

/** Activate the extension. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const version = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";
  const store = new SessionStore(context.secrets);
  const api = new Api(store, version, () => {
    void vscode.window.showWarningMessage(vscode.l10n.t("Your 4PM session ended. Sign in again."), vscode.l10n.t("Sign in")).then((pick) => {
      if (pick) void vscode.commands.executeCommand("4pm.signIn");
    });
  });
  const auth = new FourPmAuthProvider(store, api);
  const link = new WorkspaceLink(context.workspaceState, api);
  const myWork = new MyWorkProvider(api);
  const notifications = new NotificationsProvider(api);
  const discussions = new DiscussionsProvider(api, link);
  const statusBar = new StatusBar(link, api);
  const runner = new Runner(api, link);
  const discussionPanels = new DiscussionPanels(context.extensionUri, api);
  const rowPanels = new RowPanels(context.extensionUri, api, link, (projectId, discussionId, linkRowId) =>
    void discussionPanels.show(projectId, discussionId, linkRowId),
  );
  const books = new BooksProvider();
  const bookEditor = new BookEditorProvider(context.extensionUri, api, link, (projectId, rowId) => void openRowById(projectId, rowId));
  /** Open a row panel for a row id of the linked project (from the book editor). */
  const openRowById = async (projectId: string, rowId: string) => {
    const project = link.project;
    if (!project || project.id !== projectId) return;
    const located = await locateRow(rowId);
    const cells = located?.row?.cells ?? {};
    await rowPanels.show({
      projectId,
      projectName: project.name,
      id: rowId,
      title: cells["Title"] || cells["Task description"] || rowId,
      kind: (rowId.split("-")[0] ?? "TSK") as MyWorkItem["kind"],
      state: "",
      due: cells["Due"] || null,
      href: `/projects/${projectId}`,
    });
  };
  const notificationsView = vscode.window.createTreeView("4pm.notifications", { treeDataProvider: notifications });
  const discussionsView = vscode.window.createTreeView("4pm.discussions", { treeDataProvider: discussions });
  notifications.attach(notificationsView);
  discussions.attach(discussionsView);

  context.subscriptions.push(
    store,
    auth,
    link,
    notifications,
    statusBar,
    runner,
    rowPanels,
    discussionPanels,
    notificationsView,
    discussionsView,
    vscode.authentication.registerAuthenticationProvider(AUTH_PROVIDER_ID, "4PM", auth, { supportsMultipleAccounts: false }),
    vscode.window.registerUriHandler(auth),
    vscode.window.registerTreeDataProvider("4pm.myWork", myWork),
    vscode.window.registerTreeDataProvider("4pm.books", books),
    vscode.window.registerCustomEditorProvider(BOOK_EDITOR_VIEW_TYPE, bookEditor, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => books.refresh()),
  );

  /** Whether a usable session exists for the configured server. */
  const signedIn = () => !!store.session?.account.id && store.session.server === serverUrl();
  let wasSignedIn: boolean | null = null;
  /** Push the signed-in state to every part (only when it changes). */
  const syncSignedIn = () => {
    const now = signedIn();
    if (now === wasSignedIn) return;
    wasSignedIn = now;
    void vscode.commands.executeCommand("setContext", "4pm.signedIn", now);
    myWork.setSignedIn(now);
    notifications.setSignedIn(now);
    discussions.setSignedIn(now);
    statusBar.setSignedIn(now);
  };
  /** Push the project-linked state. */
  const syncLinked = () => void vscode.commands.executeCommand("setContext", "4pm.projectLinked", !!link.project);
  /** Refresh what a server-side change may have touched. */
  const refreshViews = () => {
    void myWork.refresh();
    void statusBar.refresh();
    void discussions.refresh();
  };

  context.subscriptions.push(
    store.onDidChange(syncSignedIn),
    link.onDidChange(() => {
      syncLinked();
      void statusBar.refresh();
      void discussions.refresh();
    }),
    myWork.onDidLoad(() => {
      const project = link.project;
      discussions.setWaiting(project ? myWork.countFor(project.id, "discussions") : 0);
    }),
    // A notification (worker disconnected, approval, discussion, new work…) may change what the views show.
    notifications.onDidArrive((n) => {
      refreshViews();
      void rowPanels.refreshAll();
      const projectId = typeof n.payload.projectId === "string" ? n.payload.projectId : null;
      if (n.type.startsWith("discussion.") && projectId === link.project?.id) void discussionPanels.refreshAll(projectId);
      if (n.type === "discussion.mentioned") void showMention(n.payload, link, discussionPanels);
    }),
    discussionPanels.onDidChange(() => void discussions.refresh()),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && signedIn()) refreshViews();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (affectsOrigins(e)) syncSignedIn();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("4pm.signIn", async () => {
      try {
        await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], { createIfNone: true });
      } catch (err) {
        void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),
    vscode.commands.registerCommand("4pm.signOut", () => auth.removeSession()),
    vscode.commands.registerCommand("4pm.linkProject", () => link.pick()),
    vscode.commands.registerCommand("4pm.unlinkProject", () => link.unlink()),
    vscode.commands.registerCommand("4pm.projectMenu", () => projectMenu(api, link, statusBar)),
    vscode.commands.registerCommand("4pm.runCommand", () => runner.runCommand()),
    vscode.commands.registerCommand("4pm.runPrompt", () => runner.runPrompt()),
    vscode.commands.registerCommand("4pm.stopRun", () => runner.stop()),
    vscode.commands.registerCommand("4pm.refresh", async () => {
      await Promise.all([myWork.refresh(), notifications.refresh(), statusBar.refresh(), discussions.refresh()]);
    }),
    vscode.commands.registerCommand("4pm.markAllRead", () => notifications.markAllRead()),
    vscode.commands.registerCommand("4pm.markRead", (n: NotificationResponse) => notifications.markRead(n)),
    vscode.commands.registerCommand("4pm.openInWeb", (arg: unknown) => {
      const item = itemOf(arg);
      if (item) void vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}${item.href}`, true));
    }),
    vscode.commands.registerCommand("4pm.openItem", (item: MyWorkItem) => openItem(item, link, rowPanels, discussionPanels)),
    vscode.commands.registerCommand("4pm.openDiscussion", (discussionId: string) => {
      if (link.project) void discussionPanels.show(link.project.id, discussionId);
    }),
    vscode.commands.registerCommand("4pm.openBook", async (uri?: vscode.Uri) => {
      const target = uri ?? (await pickBook());
      if (target) await openBookEditor(target);
    }),
    vscode.commands.registerCommand("4pm.taskBoard", async () => {
      const todo = (await findBookFiles()).find((u) => u.path.endsWith("/AI_TODO.md"));
      if (todo) await openBookEditor(todo, true);
      else void vscode.window.showInformationMessage(vscode.l10n.t("No AI_TODO.md in this workspace."));
    }),
    vscode.commands.registerCommand("4pm.newDiscussion", () => {
      if (link.project) void discussionPanels.show(link.project.id, null);
    }),
  );

  await store.reload();
  syncLinked();
  syncSignedIn();
  // Show the account in the Accounts menu without prompting.
  if (signedIn()) void vscode.authentication.getSession(AUTH_PROVIDER_ID, [], { silent: true });
}

/**
 * Open a My-work item: a book row of the linked project ⇒ the row panel, one of its discussions ⇒ the discussion
 * panel, anything else ⇒ its web page.
 */
async function openItem(item: MyWorkItem, link: WorkspaceLink, rows: RowPanels, discussions: DiscussionPanels): Promise<void> {
  if (item.projectId === link.project?.id) {
    if (BOOK_KINDS.has(item.kind)) return rows.show(item);
    const discussionId = item.kind === "DSC" ? discussionIdOf(item.href) : null;
    if (discussionId) return discussions.show(item.projectId, discussionId);
  }
  await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}${item.href}`, true));
}

/** A mention: an editor message whose *Open* opens the discussion (its web page for another project). */
async function showMention(payload: Record<string, unknown>, link: WorkspaceLink, discussions: DiscussionPanels): Promise<void> {
  const title = typeof payload.title === "string" ? payload.title : "";
  const by = typeof payload.byName === "string" ? payload.byName : "";
  const open = vscode.l10n.t("Open");
  const pick = await vscode.window.showInformationMessage(vscode.l10n.t("4PM: {0} mentioned you in “{1}”", by, title), open);
  if (pick !== open) return;
  const projectId = typeof payload.projectId === "string" ? payload.projectId : null;
  const discussionId = typeof payload.discussionId === "string" ? payload.discussionId : null;
  if (projectId && discussionId && projectId === link.project?.id) return discussions.show(projectId, discussionId);
  if (typeof payload.href === "string") await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}${payload.href}`, true));
}

/** The status bar menu: the project autonomous switch, relink, unlink. @api project-0124 @api project-0125 */
async function projectMenu(api: Api, link: WorkspaceLink, statusBar: StatusBar): Promise<void> {
  const project = link.project;
  if (!project) return void (await link.pick());
  let enabled: boolean | null = null;
  try {
    enabled = (await api.sdk.projects.autonomousWorkers(project.id)).enabled;
  } catch {
    enabled = null;
  }
  type Pick = vscode.QuickPickItem & { run: () => Promise<unknown> };
  const items: Pick[] = [];
  if (enabled !== null) {
    items.push({
      label: enabled ? `$(debug-pause) ${vscode.l10n.t("Pause autonomous")}` : `$(play) ${vscode.l10n.t("Start autonomous")}`,
      description: vscode.l10n.t("for every worker of {0}", project.name),
      run: async () => {
        try {
          await api.sdk.projects.putAutonomousPolicy(project.id, { enabled: !enabled });
        } catch (err) {
          showError(vscode.l10n.t("Could not change autonomous"), err);
        }
        await statusBar.refresh();
      },
    });
  }
  items.push(
    { label: `$(link) ${vscode.l10n.t("Link another project")}`, run: () => link.pick() },
    { label: `$(debug-disconnect) ${vscode.l10n.t("Unlink this workspace")}`, run: () => link.unlink() },
  );
  const chosen = await vscode.window.showQuickPick(items, { placeHolder: project.name });
  await chosen?.run();
}

/** Let the user pick one of the workspace's book files. */
async function pickBook(): Promise<vscode.Uri | undefined> {
  const files = await findBookFiles();
  if (files.length === 0) {
    void vscode.window.showInformationMessage(vscode.l10n.t("No 4PM book files in this workspace."));
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    files.map((uri) => ({ label: uri.path.split("/").pop()!.replace(/\.md$/, ""), description: vscode.workspace.asRelativePath(uri), uri })),
    { placeHolder: vscode.l10n.t("Open a 4PM book") },
  );
  return pick?.uri;
}

/** Nothing to clean beyond the subscriptions. */
export function deactivate(): void {}
