/**
 * The 4PM project linked to the open workspace (F2): picked once from the projects the user can read and kept in
 * `workspaceState` — nothing is written to the repo. Also resolves that project's worker (the cli whose project
 * folder is this project): online state, autonomous state and the link a run goes to.
 * @adr 0670 @arch 0072
 */
import * as vscode from "vscode";
import type { WorkerResponse } from "@4pm/dto";
import type { Api } from "./api";
import { showError } from "./api";

/** The linked project. */
export interface LinkedProject {
  id: string;
  name: string;
}

/** The worker state of the linked project. */
export interface ProjectWorker {
  /** The cli link a command goes to (a connected one when any). */
  machineLinkId: string;
  workerName: string;
  online: boolean;
  autonomous: "on" | "paused" | "off";
}

/** The workspaceState key. */
const KEY = "4pm.linkedProject";

/** Pick the project worker from the worker list: prefer a connected cli serving the project. */
export function findProjectWorker(workers: WorkerResponse[], projectId: string): ProjectWorker | null {
  const candidates = workers.flatMap((w) =>
    w.machineLinks
      .filter((l) => l.physicProject?.projectId === projectId)
      .map((l) => ({ worker: w, link: l, physic: l.physicProject! })),
  );
  const pick = candidates.find((c) => c.link.connected) ?? candidates[0];
  if (!pick) return null;
  return {
    machineLinkId: pick.link.id,
    workerName: pick.worker.name,
    online: pick.link.connected,
    autonomous: !pick.physic.isAutonomous ? "off" : pick.physic.autonomousPaused ? "paused" : "on",
  };
}

/** The link between the workspace and a project. */
export class WorkspaceLink implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<LinkedProject | null>();
  readonly onDidChange = this.changed.event;

  /** Over this workspace's state. */
  constructor(
    private readonly state: vscode.Memento,
    private readonly api: Api,
  ) {}

  /** The linked project, if any. */
  get project(): LinkedProject | null {
    return this.state.get<LinkedProject>(KEY) ?? null;
  }

  /** Let the user pick a project for this workspace. */
  async pick(): Promise<LinkedProject | null> {
    let items: vscode.QuickPickItem[] & { id?: string }[];
    try {
      const page = await this.api.sdk.projects.list({ page: 1, size: 100 });
      items = page.items.map((p) => ({ label: p.name, description: p.description || undefined, id: p.id }));
    } catch (err) {
      showError(vscode.l10n.t("Could not load projects"), err);
      return null;
    }
    if (items.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t("You have no 4PM projects to link."));
      return null;
    }
    const chosen = (await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t("Link this workspace to a 4PM project"),
      matchOnDescription: true,
    })) as (vscode.QuickPickItem & { id?: string }) | undefined;
    if (!chosen?.id) return null;
    const linked = { id: chosen.id, name: chosen.label };
    await this.state.update(KEY, linked);
    this.changed.fire(linked);
    return linked;
  }

  /** Forget the link. */
  async unlink(): Promise<void> {
    await this.state.update(KEY, undefined);
    this.changed.fire(null);
  }

  /** The linked project's worker (null when none serves it; throws on an API error). */
  async worker(): Promise<ProjectWorker | null> {
    const project = this.project;
    if (!project) return null;
    const page = await this.api.sdk.workers.list({ page: 1, size: 100 });
    return findProjectWorker(page.items, project.id);
  }

  /** Stop. */
  dispose(): void {
    this.changed.dispose();
  }
}
