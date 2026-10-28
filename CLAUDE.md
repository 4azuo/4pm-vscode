# CLAUDE.md — `@4pm/vscode`

The 4PM VS Code extension (public repo `4azuo/4pm-vscode`, source pushed at the first release; submodule `21-apps/32-vscode`). Decisions:
[ADR-0670](../../11-docs/11-adr/0670-vscode-extension.md) · [ADR-0673](../../11-docs/11-adr/0673-vscode-extension-v0-2-row-panel-approvals-autonomous-discussions.md) · [ADR-0674](../../11-docs/11-adr/0674-vscode-extension-v0-3-book-editor-and-task-board.md) · current state:
[arch 0072](../../11-docs/12-architecture/0072-vscode-extension.md). Shared app conventions:
[`../CLAUDE.md`](../CLAUDE.md).

## Code organization

- `src/extension.ts` — activation: wires everything and the context keys (`4pm.signedIn`, `4pm.projectLinked`,
  `4pm.running`).
- `src/auth/` — `SessionStore` (SecretStorage, shared by every window — a rotated refresh token is adopted, never
  re-presented), `FourPmAuthProvider` (Accounts menu + URI handler of the browser sign-in), `pkce.ts`.
- `src/api.ts` — `@4pm/sdk` over the client gateway with `X-4PM-Client: vscode/<version>`; `src/sse.ts` — SSE over
  fetch (no EventSource in the extension host).
- `src/views/` — My work, Notifications and Discussions tree views; `src/panels/` — the row and discussion
  panels (webviews rendering the declarative `PanelModel` with `media/panel.js` — DOM text only, strict CSP);
  `src/book/` — book row reader (over `@4pm/dto` `bookTable`), locate, git diff, approvals (`approve.ts`: AI_TODO via
  `machine-0063` with catalog tags), the *4PM Book* custom editor (`book-editor.ts` + `media/book.js`) and its pure
  builders (`book-model.ts`: patch, board); `src/status-bar.ts`; `src/workspace-link.ts` (project link +
  its worker); `src/run/` — console / AI runs into the "4PM Run" output channel.
- `l10n/bundle.l10n.<locale>.json` (keys = the English source strings of `vscode.l10n.t`) and
  `package.nls[.<locale>].json` (manifest strings) in en · vi · ja · zh-cn — add every new string to all of them.

## Rules

- Book edits are saved through the server as row patches (never by writing the local file).
- Panels hold no logic and do no network call: the extension builds the model and handles the posted actions.
- Every call goes through the client gateway: a new API needs its catalog entry
  (`21-apps/24-client-gateway/src/gateway/catalog.ts`, `clients: ["vscode"]`) and the arch 0072 table.
- **No polling** — refresh on events (sign-in, link change, a notification, window focus); live data over SSE with
  backoff + `Retry-After`.
- No authorization logic: hiding an action is a convenience, the server decides.
- Build: esbuild bundle (`scripts/build.mjs`); the Marketplace id `4azuo.4pm-vscode` is set when `scripts/package.mjs`
  stages `out/` (the workspace name stays `@4pm/vscode`).
