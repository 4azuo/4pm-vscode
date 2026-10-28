# CLAUDE.md — `@4pm/vscode`

The 4PM VS Code extension (public repo `4azuo/4pm-vscode`, submodule `21-apps/32-vscode`). Decision:
[ADR-0670](../../11-docs/11-adr/0670-vscode-extension.md) · current state:
[arch 0072](../../11-docs/12-architecture/0072-vscode-extension.md). Shared app conventions:
[`../CLAUDE.md`](../CLAUDE.md).

## Code organization

- `src/extension.ts` — activation: wires everything and the context keys (`4pm.signedIn`, `4pm.projectLinked`,
  `4pm.running`).
- `src/auth/` — `SessionStore` (SecretStorage, shared by every window — a rotated refresh token is adopted, never
  re-presented), `FourPmAuthProvider` (Accounts menu + URI handler of the browser sign-in), `pkce.ts`.
- `src/api.ts` — `@4pm/sdk` over the client gateway with `X-4PM-Client: vscode/<version>`; `src/sse.ts` — SSE over
  fetch (no EventSource in the extension host).
- `src/views/` — My work and Notifications tree views; `src/status-bar.ts`; `src/workspace-link.ts` (project link +
  its worker); `src/run/` — console / AI runs into the "4PM Run" output channel.
- `l10n/bundle.l10n.<locale>.json` (keys = the English source strings of `vscode.l10n.t`) and
  `package.nls[.<locale>].json` (manifest strings) in en · vi · ja · zh-cn — add every new string to all of them.

## Rules

- Every call goes through the client gateway: a new API needs its catalog entry
  (`21-apps/24-client-gateway/src/gateway/catalog.ts`, `clients: ["vscode"]`) and the arch 0072 table.
- **No polling** — refresh on events (sign-in, link change, a notification, window focus); live data over SSE with
  backoff + `Retry-After`.
- No authorization logic: hiding an action is a convenience, the server decides.
- Build: esbuild bundle (`scripts/build.mjs`); the Marketplace id `4azuo.4pm-vscode` is set when `scripts/package.mjs`
  stages `out/` (the workspace name stays `@4pm/vscode`).
