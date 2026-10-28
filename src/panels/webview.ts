/**
 * The webview shell shared by the row and discussion panels: a strict CSP (local script + style only, a nonce on the
 * script, no remote content), the renderer `media/panel.js`, and a typed `render` / `onEvent` channel.
 * @adr 0673 @arch 0072
 */
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { PanelEvent, PanelModel } from "./model";

/** A panel with its rendering channel. */
export class PanelView implements vscode.Disposable {
  readonly panel: vscode.WebviewPanel;
  private model: PanelModel | null = null;
  private ready = false;
  private readonly subscriptions: vscode.Disposable[] = [];

  /** Create the panel; `onEvent` receives the webview's actions. */
  constructor(extensionUri: vscode.Uri, viewType: string, title: string, onEvent: (e: PanelEvent) => void) {
    const media = vscode.Uri.joinPath(extensionUri, "media");
    this.panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media],
      retainContextWhenHidden: false,
    });
    this.panel.webview.html = shell(this.panel.webview, media);
    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((e: PanelEvent) => {
        if (e.type === "ready") {
          this.ready = true;
          if (this.model) void this.panel.webview.postMessage({ type: "render", model: this.model });
          return;
        }
        onEvent(e);
      }),
    );
  }

  /** Show a model (kept and re-sent when the webview reloads). */
  render(model: PanelModel): void {
    this.model = model;
    this.panel.title = model.title;
    if (this.ready) void this.panel.webview.postMessage({ type: "render", model });
  }

  /** The model on screen. */
  get current(): PanelModel | null {
    return this.model;
  }

  /** Dispose the listeners (the panel disposes itself when closed). */
  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }
}

/** The HTML shell. */
function shell(webview: vscode.Webview, media: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
</head>
<body><main id="root"></main><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
}
