/**
 * The 4PM API as this extension uses it: the @4pm/sdk client pointed at the client gateway, sending
 * `X-4PM-Client: vscode/<version>` and the stored Bearer, refreshing through `auth-0004` (coordinated with the other
 * windows through the session store), plus the SSE URL / header helpers.
 * @adr 0670 @arch 0072
 */
import * as vscode from "vscode";
import { Sdk4pm } from "@4pm/sdk";
import { CLIENT_KIND, serverUrl } from "./config";
import type { SessionStore } from "./auth/session-store";

/** Holds the SDK for the current server; rebuilt when the server setting changes. */
export class Api {
  private sdkCache: { server: string; sdk: Sdk4pm } | null = null;
  readonly clientHeader: string;

  /** `version` is the extension's own version (sent in `X-4PM-Client`). */
  constructor(
    private readonly store: SessionStore,
    version: string,
    private readonly onSignedOut: () => void,
  ) {
    this.clientHeader = `${CLIENT_KIND}/${version}`;
  }

  /** The SDK over the configured gateway. */
  get sdk(): Sdk4pm {
    const server = serverUrl();
    if (this.sdkCache?.server !== server) this.sdkCache = { server, sdk: this.build(server) };
    return this.sdkCache.sdk;
  }

  /** Absolute URL of a gateway path. */
  url(path: string): string {
    return `${serverUrl()}${path}`;
  }

  /** Headers for a raw request (SSE): the client header and the current Bearer. */
  headers(): Record<string, string> {
    const token = this.store.session?.accessToken;
    return { "X-4PM-Client": this.clientHeader, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  /** Make sure the access token is fresh — an authenticated call refreshes it on a 401 (used before an SSE retry). */
  async ensureFresh(): Promise<boolean> {
    try {
      await this.sdk.notifications.unreadCount();
      return true;
    } catch {
      return this.store.session !== null;
    }
  }

  /** Build the SDK client for `server`. */
  private build(server: string): Sdk4pm {
    const store = this.store;
    return new Sdk4pm({
      baseUrl: server,
      defaultHeaders: { "X-4PM-Client": this.clientHeader },
      getTokens: () => ({
        accessToken: store.session?.accessToken ?? null,
        refreshToken: store.session?.refreshToken ?? null,
      }),
      setTokens: (tokens) => {
        void store.updateTokens(tokens && tokens.accessToken && tokens.refreshToken ? { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } : null);
      },
      // Another window may have rotated the token already — adopt its pair instead of presenting a rotated one.
      refreshGate: async (refreshToken, doRefresh) => {
        const latest = await store.reload();
        if (latest && latest.refreshToken !== refreshToken) {
          return { accessToken: latest.accessToken, refreshToken: latest.refreshToken };
        }
        return doRefresh();
      },
      onAuthError: () => {
        void store.clear();
        this.onSignedOut();
      },
    });
  }
}

/** A short message for an API failure (the server's English fallback; never the error id). */
export function errorText(err: unknown): string {
  if (err && typeof err === "object" && "errorCode" in err) {
    const e = err as { errorCode: string; message?: string };
    return e.message ? `${e.message} (${e.errorCode})` : e.errorCode;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Show an API failure as an editor error message. */
export function showError(prefix: string, err: unknown): void {
  void vscode.window.showErrorMessage(`${prefix}: ${errorText(err)}`);
}
