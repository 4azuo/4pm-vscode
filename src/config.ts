/**
 * The extension's settings: the client gateway origin every API call goes to, and the web origin the browser sign-in
 * page and "open in web" links use.
 * @adr 0670 @arch 0072
 */
import * as vscode from "vscode";

/** The `X-4PM-Client` kind of this client. */
export const CLIENT_KIND = "vscode";

/** The settings section. */
const SECTION = "4pm";

/** An origin setting without its trailing slashes. */
function origin(key: string, fallback: string): string {
  const raw = vscode.workspace.getConfiguration(SECTION).get<string>(key) || fallback;
  return raw.trim().replace(/\/+$/, "");
}

/** The client gateway origin (`4pm.serverUrl`). */
export function serverUrl(): string {
  return origin("serverUrl", "https://gw.4pm.app");
}

/** The web app origin (`4pm.webUrl`). */
export function webUrl(): string {
  return origin("webUrl", "https://app.4pm.app");
}

/** Whether a configuration change touches the origins (the session belongs to one server). */
export function affectsOrigins(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration(`${SECTION}.serverUrl`) || e.affectsConfiguration(`${SECTION}.webUrl`);
}
