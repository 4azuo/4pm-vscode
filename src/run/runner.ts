/**
 * Run on the worker (F5): send a console command or an AI prompt to the linked project's worker (`command-0001`),
 * stream its output into the "4PM Run" output channel (`command-0003`, de-duplicated by `seq` across replays; status lines,
 * queue position and failover resets shown as such), and stop it (`command-0010`). One run at a time per window.
 * @adr 0670 @api command-0001 @api command-0003 @api command-0010 @arch 0072
 */
import * as vscode from "vscode";
import type { Api } from "../api";
import { errorText, showError } from "../api";
import { readSse, SseHttpError } from "../sse";
import type { WorkspaceLink } from "../workspace-link";
import { splitArgs } from "./split-args";

/** One output event of `command-0003` (the fields this view uses). */
interface OutputPayload {
  seq: number;
  chunk: string;
  done?: boolean;
  exitCode?: number;
  log?: boolean;
  reset?: boolean;
  cancelled?: boolean;
  /** A synthesized `done` whose output was already evicted. */
  unavailable?: boolean;
  queue?: { position: number; limit: number; running: number } | null;
}

/** Stream attempts before giving up on a run's output. */
const MAX_STREAM_ATTEMPTS = 5;

/** The runner. */
export class Runner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("4PM Run");
  private active: { commandId: string; abort: AbortController } | null = null;

  /** Over the API and the workspace link. */
  constructor(
    private readonly api: Api,
    private readonly link: WorkspaceLink,
  ) {}

  /** Ask for a console command and run it. */
  async runCommand(): Promise<void> {
    const line = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Command to run on the worker, in the project folder"),
      placeHolder: "npm test",
    });
    const args = line ? splitArgs(line) : [];
    if (args.length === 0) return;
    await this.dispatch({ command: args[0]!, args: args.slice(1), ai: false }, line!);
  }

  /** Ask for an AI prompt and run it. */
  async runPrompt(): Promise<void> {
    const prompt = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("AI prompt to run on the worker"),
      placeHolder: vscode.l10n.t("Explain the failing test in tests/login.spec.ts"),
    });
    if (!prompt?.trim()) return;
    await this.dispatch({ command: prompt.trim(), ai: true }, prompt.trim());
  }

  /** Stop the active run. */
  async stop(): Promise<void> {
    if (!this.active) return;
    try {
      await this.api.sdk.commands.cancel(this.active.commandId);
    } catch (err) {
      showError(vscode.l10n.t("Could not stop the run"), err);
    }
  }

  /** Close the channel and drop the stream. */
  dispose(): void {
    this.active?.abort.abort();
    this.output.dispose();
  }

  /** Dispatch to the linked project's worker and stream the output. */
  private async dispatch(body: { command: string; args?: string[]; ai: boolean }, shown: string): Promise<void> {
    const project = this.link.project;
    if (!project) return;
    if (this.active) {
      void vscode.window.showWarningMessage(vscode.l10n.t("A run is already in progress. Stop it first."));
      return;
    }
    let machineLinkId: string;
    try {
      const worker = await this.link.worker();
      if (!worker?.online) {
        void vscode.window.showWarningMessage(vscode.l10n.t("The project's worker is offline."));
        return;
      }
      machineLinkId = worker.machineLinkId;
    } catch (err) {
      showError(vscode.l10n.t("Could not load the worker state"), err);
      return;
    }
    let commandId: string;
    try {
      ({ commandId } = await this.api.sdk.commands.dispatch({ projectId: project.id, machineLinkId, ...body }));
    } catch (err) {
      showError(vscode.l10n.t("Could not start the run"), err);
      return;
    }
    const abort = new AbortController();
    this.active = { commandId, abort };
    void vscode.commands.executeCommand("setContext", "4pm.running", true);
    this.output.show(true);
    this.output.appendLine(`▶ ${body.ai ? vscode.l10n.t("AI prompt") : "$"} ${shown}`);
    try {
      await this.follow(commandId, abort.signal);
    } finally {
      this.active = null;
      void vscode.commands.executeCommand("setContext", "4pm.running", false);
    }
  }

  /** Read the run's stream until its `done` event (reconnecting a few times; the server replays from the start). */
  private async follow(commandId: string, signal: AbortSignal): Promise<void> {
    // Kept across reconnects: the server replays the run from its start.
    const state = { seen: new Set<number>(), done: false };
    for (let attempt = 1; attempt <= MAX_STREAM_ATTEMPTS && !signal.aborted; attempt++) {
      try {
        await readSse(this.api.url(`/commands/${commandId}/stream`), this.api.headers(), (m) => {
          let p: OutputPayload;
          try {
            p = JSON.parse(m.data) as OutputPayload;
          } catch {
            return;
          }
          this.apply(p, state);
        }, signal);
        if (state.done) return;
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof SseHttpError && err.status === 401) await this.api.ensureFresh();
        else if (!(err instanceof SseHttpError)) this.output.appendLine(`⚠ ${errorText(err)}`);
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    if (!signal.aborted) this.output.appendLine(vscode.l10n.t("⚠ Lost the run's output stream."));
  }

  /** Apply one event (a replay after a reconnect repeats seqs already shown; heartbeats are `seq -1` without `done`). */
  private apply(p: OutputPayload, state: { seen: Set<number>; done: boolean }): void {
    if (typeof p.seq !== "number") return;
    if (p.seq >= 0) {
      if (state.seen.has(p.seq)) return;
      state.seen.add(p.seq);
    }
    if (p.queue) this.output.appendLine(vscode.l10n.t("… queued: position {0} ({1}/{2} running)", p.queue.position, p.queue.running, p.queue.limit));
    if (p.reset) this.output.appendLine(vscode.l10n.t("— retrying with another AI profile —"));
    if (p.chunk) {
      if (p.log) this.output.appendLine(`› ${p.chunk.replace(/\n$/, "")}`);
      else this.output.append(p.chunk);
    }
    if (!p.done) return;
    state.done = true;
    this.output.appendLine("");
    if (p.unavailable) this.output.appendLine(vscode.l10n.t("■ Finished — its output is no longer available."));
    else if (p.cancelled) this.output.appendLine(vscode.l10n.t("■ Stopped."));
    else this.output.appendLine(vscode.l10n.t("■ Finished (exit code {0}).", p.exitCode ?? 0));
  }
}
