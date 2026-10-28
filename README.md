# 4PM for VS Code

See what waits on you in [4PM](https://4pm.app), get notifications, and drive your project's worker — without leaving
the editor. Works in VS Code and in editors that install from Open VSX (Cursor, Windsurf, VSCodium, Positron).

The extension acts **as you, with your permissions**. It never runs AI agents on your machine — agents keep running on
your project's workers.

## Features

- **Sign in with your browser.** Your normal 4PM login (password + two-factor, SSO) happens on the web; you approve
  the editor once and it signs in. Tokens are kept in the OS keychain. Revoke the editor any time under
  *Profile › Settings › Connected apps*.
- **Link the workspace to a 4PM project.** Pick the project once per workspace (nothing is written to the repo). The
  status bar shows the project, whether its worker is online, and the autonomous state.
- **My work.** What waits on you across projects — in progress, to check, to approve, to answer, discussions. A row
  of the linked project opens its book file at that row; anything else opens in 4PM.
- **Notifications.** Live, with an unread badge; mark one or all read.
- **Run on the worker.** Send a console command or an AI prompt to the linked project's worker, watch the output in
  the *4PM Run* output channel, stop it.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `4pm.serverUrl` | `https://gw.4pm.app` | The 4PM client gateway. Self-hosted: your own `gw.<domain>`. |
| `4pm.webUrl` | `https://app.4pm.app` | The 4PM web app (sign-in page, *Open in 4PM*). |

## Commands

*4PM: Sign In* · *Sign Out* · *Link Workspace to Project* · *Unlink Workspace* · *Run Command on Worker* ·
*Run AI Prompt on Worker* · *Stop Run* · *Refresh* · *Mark All Notifications Read*

## Development

This repository is a submodule of the 4PM monorepo (`21-apps/32-vscode`, package `@4pm/vscode`) and builds there:
`pnpm --filter @4pm/vscode build` bundles `dist/extension.js` with esbuild (the `@4pm/*` packages inside), and
`pnpm --filter @4pm/vscode package` stages `out/` and packs `4pm-vscode-<version>.vsix`. Press F5 with this folder
open to start an Extension Development Host.

## Licence

Source-available, all rights reserved — see [LICENSE](./LICENSE).
