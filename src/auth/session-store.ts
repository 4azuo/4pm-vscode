/**
 * The signed-in session, kept in VS Code SecretStorage (the OS keychain) and shared by every window of the editor:
 * the token pair, the account and the server it belongs to. A window that rotates the refresh token writes the new
 * pair; the others pick it up through `onDidChange`, so no window ever presents a rotated token past the server's
 * grace window (that would revoke the session as stolen).
 * @adr 0670 @arch 0072
 */
import * as vscode from "vscode";

/** The stored session. */
export interface StoredSession {
  /** The AuthenticationSession id (random, per sign-in). */
  id: string;
  /** The gateway origin the tokens were issued through. */
  server: string;
  accessToken: string;
  refreshToken: string;
  account: { id: string; label: string };
}

/** The SecretStorage key. */
const KEY = "4pm.session";

/** Read / write the session; `onDidChange` fires on any change, from this window or another. */
export class SessionStore implements vscode.Disposable {
  private current: StoredSession | null = null;
  private readonly changed = new vscode.EventEmitter<StoredSession | null>();
  readonly onDidChange = this.changed.event;
  private readonly subscription: vscode.Disposable;

  /** Watch the secret for writes from other windows. */
  constructor(private readonly secrets: vscode.SecretStorage) {
    this.subscription = secrets.onDidChange((e) => {
      if (e.key === KEY) void this.reload();
    });
  }

  /** The session in memory (call `reload` once at start-up). */
  get session(): StoredSession | null {
    return this.current;
  }

  /** Re-read the stored session; fires `onDidChange` when it differs. */
  async reload(): Promise<StoredSession | null> {
    const raw = await this.secrets.get(KEY);
    let next: StoredSession | null;
    try {
      next = raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      next = null;
    }
    if (JSON.stringify(next) !== JSON.stringify(this.current)) {
      this.current = next;
      this.changed.fire(next);
    }
    return next;
  }

  /** Store a session (sign-in). */
  async save(session: StoredSession): Promise<void> {
    this.current = session;
    await this.secrets.store(KEY, JSON.stringify(session));
    this.changed.fire(session);
  }

  /** Replace the token pair after a refresh; null clears the session (refresh refused). */
  async updateTokens(tokens: { accessToken: string; refreshToken: string } | null): Promise<void> {
    if (!tokens) return this.clear();
    if (!this.current) return;
    await this.save({ ...this.current, ...tokens });
  }

  /** Forget the session (sign-out, revoked, server changed). */
  async clear(): Promise<void> {
    const had = this.current !== null;
    this.current = null;
    await this.secrets.delete(KEY);
    if (had) this.changed.fire(null);
  }

  /** Stop watching. */
  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}
