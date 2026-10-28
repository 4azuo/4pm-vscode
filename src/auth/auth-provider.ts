/**
 * The 4PM AuthenticationProvider (Accounts menu) and the URI handler of the browser sign-in: sign-in opens the web
 * `/connect/vscode` page with a PKCE challenge, waits for the editor to hand back `…/auth?code&state`, exchanges the
 * code through the client gateway (`auth-0035`) and stores the session; sign-out calls `auth-0005`.
 * @adr 0670 @flow 0026 @arch 0072
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import * as vscode from "vscode";
import type { Api } from "../api";
import { errorText } from "../api";
import { serverUrl, webUrl } from "../config";
import { createPkce } from "./pkce";
import type { SessionStore, StoredSession } from "./session-store";

/** The provider id (package.json `contributes.authentication`). */
export const AUTH_PROVIDER_ID = "4pm";

/** The extension id the editor routes `<scheme>://<id>/auth` to. */
const EXTENSION_ID = "4azuo.4pm-vscode";

/** How long the browser step may take. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** A sign-in waiting for the editor to hand back its code. */
interface PendingSignIn {
  state: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

/** Provider + URI handler over the session store. */
export class FourPmAuthProvider implements vscode.AuthenticationProvider, vscode.UriHandler, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.changed.event;
  private pending: PendingSignIn | null = null;
  private last: vscode.AuthenticationSession | null = null;
  private readonly subscription: vscode.Disposable;

  /** Relay store changes (this window or another) as session changes. */
  constructor(
    private readonly store: SessionStore,
    private readonly api: Api,
  ) {
    this.last = this.toSession(store.session);
    this.subscription = store.onDidChange((stored) => {
      const next = this.toSession(stored);
      const prev = this.last;
      this.last = next;
      if (prev?.id === next?.id && prev?.accessToken === next?.accessToken) return;
      this.changed.fire({
        added: next && prev?.id !== next.id ? [next] : [],
        removed: prev && prev.id !== next?.id ? [prev] : [],
        changed: next && prev?.id === next.id ? [next] : [],
      });
    });
  }

  /** The stored session, when it belongs to the configured server. */
  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const session = this.toSession(this.store.session);
    return session ? [session] : [];
  }

  /** Run the browser sign-in. */
  async createSession(): Promise<vscode.AuthenticationSession> {
    const stored = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Signing in to 4PM in your browser…"), cancellable: true },
      (_progress, cancel) => this.signIn(cancel),
    );
    return this.toSession(stored)!;
  }

  /** Sign out: revoke the session on the server (best-effort), then forget it. */
  async removeSession(): Promise<void> {
    const refreshToken = this.store.session?.refreshToken;
    if (refreshToken) await this.api.sdk.auth.logout(refreshToken).catch(() => undefined);
    await this.store.clear();
  }

  /** The editor handed back `…/auth?code&state`. */
  handleUri(uri: vscode.Uri): void {
    if (uri.path !== "/auth" || !this.pending) return;
    const query = new URLSearchParams(uri.query);
    const code = query.get("code");
    // A URI with another state is not ours (an old tab, or a forged link) — ignore it.
    if (!code || query.get("state") !== this.pending.state) return;
    this.pending.resolve(code);
  }

  /** Stop relaying. */
  dispose(): void {
    this.pending?.reject(new Error("disposed"));
    this.subscription.dispose();
    this.changed.dispose();
  }

  /** The browser step, the exchange and the account lookup. */
  private async signIn(cancel: vscode.CancellationToken): Promise<StoredSession> {
    const { verifier, challenge, state } = createPkce();
    const callback = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://${EXTENSION_ID}/auth`));
    const page = new URL("/connect/vscode", webUrl());
    page.searchParams.set("state", state);
    page.searchParams.set("code_challenge", challenge);
    page.searchParams.set("code_challenge_method", "S256");
    page.searchParams.set("redirect_uri", callback.toString(true));
    page.searchParams.set("client_label", `${vscode.env.appName} · ${hostname()}`.slice(0, 80));

    const code = await this.waitForCode(state, cancel, () => vscode.env.openExternal(vscode.Uri.parse(page.toString(), true)));
    let tokens: { accessToken: string; refreshToken: string };
    try {
      tokens = await this.api.sdk.auth.clientGrantExchange({ code, codeVerifier: verifier });
    } catch (err) {
      throw new Error(vscode.l10n.t("Sign-in failed: {0}", errorText(err)), { cause: err });
    }
    const session: StoredSession = {
      id: randomUUID(),
      server: serverUrl(),
      ...tokens,
      account: { id: "", label: "" },
    };
    await this.store.save(session);
    try {
      const me = await this.api.sdk.users.me();
      const signedIn = { ...session, account: { id: me.id, label: me.aliasName || me.username } };
      await this.store.save(signedIn);
      return signedIn;
    } catch (err) {
      await this.store.clear();
      throw new Error(vscode.l10n.t("Sign-in failed: {0}", errorText(err)), { cause: err });
    }
  }

  /** Open the browser and wait for the code with this `state` (timeout / cancel ⇒ error). */
  private waitForCode(state: string, cancel: vscode.CancellationToken, open: () => Thenable<boolean>): Promise<string> {
    this.pending?.reject(new Error(vscode.l10n.t("Sign-in was restarted.")));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(vscode.l10n.t("Sign-in timed out."))), SIGN_IN_TIMEOUT_MS);
      const onCancel = cancel.onCancellationRequested(() => finish(new Error(vscode.l10n.t("Sign-in was cancelled."))));
      const finish = (err: Error | null, code?: string) => {
        clearTimeout(timer);
        onCancel.dispose();
        if (this.pending?.state === state) this.pending = null;
        if (err) reject(err);
        else resolve(code!);
      };
      this.pending = { state, resolve: (code) => finish(null, code), reject: (err) => finish(err) };
      void open().then((opened) => {
        if (!opened) finish(new Error(vscode.l10n.t("Could not open the browser.")));
      });
    });
  }

  /** A stored session as an AuthenticationSession; null when absent, unfinished or for another server. */
  private toSession(stored: StoredSession | null): vscode.AuthenticationSession | null {
    if (!stored || !stored.account.id || stored.server !== serverUrl()) return null;
    return { id: stored.id, accessToken: stored.accessToken, account: stored.account, scopes: [] };
  }
}
