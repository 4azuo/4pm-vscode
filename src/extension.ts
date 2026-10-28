/**
 * Entry point of the 4PM VS Code extension: wires the session store, the AuthenticationProvider + URI handler, the
 * My work and Notifications views, the status bar, the workspace ↔ project link and the worker runner, and keeps
 * them in step with the signed-in state (context keys `4pm.signedIn`, `4pm.projectLinked`, `4pm.running`).
 * @adr 0670 @arch 0072
 */
import * as vscode from "vscode";
import type { MyWorkItem, NotificationResponse } from "@4pm/dto";
import { Api } from "./api";
import { AUTH_PROVIDER_ID, FourPmAuthProvider } from "./auth/auth-provider";
import { SessionStore } from "./auth/session-store";
import { locateRow } from "./book-locate";
import { affectsOrigins, serverUrl, webUrl } from "./config";
import { Runner } from "./run/runner";
import { StatusBar } from "./status-bar";
import { itemOf, MyWorkProvider } from "./views/my-work";
import { NotificationsProvider } from "./views/notifications";
import { WorkspaceLink } from "./workspace-link";

/** My-work kinds that are rows of a book file in the repo. */
const BOOK_KINDS = new Set(["REQ", "QA", "TSK", "DOC", "AST", "DONE", "REQUEST"]);

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
  const statusBar = new StatusBar(link);
  const runner = new Runner(api, link);
  const notificationsView = vscode.window.createTreeView("4pm.notifications", { treeDataProvider: notifications });
  notifications.attach(notificationsView);

  context.subscriptions.push(
    store,
    auth,
    link,
    notifications,
    statusBar,
    runner,
    notificationsView,
    vscode.authentication.registerAuthenticationProvider(AUTH_PROVIDER_ID, "4PM", auth, { supportsMultipleAccounts: false }),
    vscode.window.registerUriHandler(auth),
    vscode.window.registerTreeDataProvider("4pm.myWork", myWork),
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
    statusBar.setSignedIn(now);
  };
  /** Push the project-linked state. */
  const syncLinked = () => void vscode.commands.executeCommand("setContext", "4pm.projectLinked", !!link.project);

  context.subscriptions.push(
    store.onDidChange(syncSignedIn),
    link.onDidChange(() => {
      syncLinked();
      void statusBar.refresh();
    }),
    // A notification (worker disconnected, autonomous error, new work…) may change what the views show.
    notifications.onDidArrive(() => {
      void myWork.refresh();
      void statusBar.refresh();
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && signedIn()) {
        void myWork.refresh();
        void statusBar.refresh();
      }
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
    vscode.commands.registerCommand("4pm.runCommand", () => runner.runCommand()),
    vscode.commands.registerCommand("4pm.runPrompt", () => runner.runPrompt()),
    vscode.commands.registerCommand("4pm.stopRun", () => runner.stop()),
    vscode.commands.registerCommand("4pm.refresh", async () => {
      await Promise.all([myWork.refresh(), notifications.refresh(), statusBar.refresh()]);
    }),
    vscode.commands.registerCommand("4pm.markAllRead", () => notifications.markAllRead()),
    vscode.commands.registerCommand("4pm.markRead", (n: NotificationResponse) => notifications.markRead(n)),
    vscode.commands.registerCommand("4pm.openInWeb", (arg: unknown) => {
      const item = itemOf(arg);
      if (item) void vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}${item.href}`, true));
    }),
    vscode.commands.registerCommand("4pm.openItem", (item: MyWorkItem) => openItem(item, link)),
  );

  await store.reload();
  syncLinked();
  syncSignedIn();
  // Show the account in the Accounts menu without prompting.
  if (signedIn()) void vscode.authentication.getSession(AUTH_PROVIDER_ID, [], { silent: true });
}

/** Open a My-work row: its book file at the row when its project is this workspace's, else its web page. */
async function openItem(item: MyWorkItem, link: WorkspaceLink): Promise<void> {
  if (item.projectId === link.project?.id && BOOK_KINDS.has(item.kind)) {
    const found = await locateRow(item.id);
    if (found) {
      const doc = await vscode.workspace.openTextDocument(found.uri);
      const pos = new vscode.Position(found.line, 0);
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
      return;
    }
  }
  await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}${item.href}`, true));
}

/** Nothing to clean beyond the subscriptions. */
export function deactivate(): void {}
