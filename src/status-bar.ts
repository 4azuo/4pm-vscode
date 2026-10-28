/**
 * The status bar item (F2): the linked project, the project autonomous switch, its worker online / offline and the
 * worker's own autonomous state; a click opens the project menu (D3). Refreshed on events (sign-in, link change, a
 * notification, the window regaining focus) — never on a timer.
 * @adr 0670 @adr 0673 @api project-0124 @arch 0072
 */
import * as vscode from "vscode";
import type { Api } from "./api";
import type { WorkspaceLink } from "./workspace-link";

/** Render the status bar item. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private signedIn = false;
  private seq = 0;

  /** Over the workspace link and the API. */
  constructor(
    private readonly link: WorkspaceLink,
    private readonly api: Api,
  ) {
    this.item.name = "4PM";
    this.item.show();
  }

  /** Set the signed-in state and redraw. */
  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
    void this.refresh();
  }

  /** Redraw (fetches the worker state when a project is linked). */
  async refresh(): Promise<void> {
    const seq = ++this.seq;
    if (!this.signedIn) {
      this.render("$(account) 4PM", vscode.l10n.t("Sign in to 4PM"), "4pm.signIn");
      return;
    }
    const project = this.link.project;
    if (!project) {
      this.render("$(link) 4PM", vscode.l10n.t("Link this workspace to a 4PM project"), "4pm.linkProject");
      return;
    }
    let text = `$(project) ${project.name}`;
    let tooltip = vscode.l10n.t("4PM project: {0}", project.name);
    try {
      const [worker, policy] = await Promise.all([
        this.link.worker(),
        this.api.sdk.projects.autonomousWorkers(project.id).catch(() => null),
      ]);
      if (seq !== this.seq) return;
      if (policy) {
        text += policy.enabled ? " · $(play-circle)" : " · $(stop-circle)";
        tooltip += `\n${vscode.l10n.t("Project autonomous: {0}", policy.enabled ? vscode.l10n.t("on") : vscode.l10n.t("off"))}`;
      }
      if (!worker) {
        text += ` · $(circle-slash) ${vscode.l10n.t("no worker")}`;
        tooltip += `\n${vscode.l10n.t("No worker serves this project.")}`;
      } else {
        text += worker.online ? ` · $(pass-filled) ${vscode.l10n.t("online")}` : ` · $(circle-large-outline) ${vscode.l10n.t("offline")}`;
        if (worker.autonomous !== "off") text += worker.autonomous === "on" ? " · $(sync)" : " · $(debug-pause)";
        tooltip += `\n${vscode.l10n.t("Worker: {0} ({1})", worker.workerName, worker.online ? vscode.l10n.t("online") : vscode.l10n.t("offline"))}`;
        tooltip += `\n${vscode.l10n.t("Autonomous: {0}", autonomousLabel(worker.autonomous))}`;
      }
    } catch {
      if (seq !== this.seq) return;
      text += " · $(warning)";
      tooltip += `\n${vscode.l10n.t("Could not load the worker state.")}`;
    }
    this.render(text, tooltip, "4pm.projectMenu");
  }

  /** Apply text, tooltip and click command. */
  private render(text: string, tooltip: string, command: string): void {
    this.item.text = text;
    this.item.tooltip = tooltip;
    this.item.command = command;
  }

  /** Remove the item. */
  dispose(): void {
    this.item.dispose();
  }
}

/** The label of an autonomous state. */
function autonomousLabel(state: "on" | "paused" | "off"): string {
  if (state === "on") return vscode.l10n.t("on");
  if (state === "paused") return vscode.l10n.t("paused");
  return vscode.l10n.t("off");
}
