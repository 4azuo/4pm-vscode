/**
 * Stage the published extension in `out/` and pack it with vsce: the workspace manifest is `@4pm/vscode`, while the
 * Marketplace / Open VSX id is `<publisher>.<name>` = `4azuo.4pm-vscode`, so the staged package.json gets that name
 * and drops the workspace-only fields (the bundle already holds every dependency).
 * @adr 0670
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const OUT = "out";
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const { scripts: _scripts, dependencies: _deps, devDependencies: _dev, private: _private, ...published } = manifest;
published.name = "4pm-vscode";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
writeFileSync(`${OUT}/package.json`, `${JSON.stringify(published, null, 2)}\n`);
for (const entry of ["dist", "l10n", "media", "README.md", "LICENSE", "CHANGELOG.md"]) {
  if (existsSync(entry)) cpSync(entry, `${OUT}/${entry}`, { recursive: true });
}
for (const file of readdirSync(".").filter((f) => /^package\.nls(\.[a-z-]+)?\.json$/.test(f))) cpSync(file, `${OUT}/${file}`);
// The bundle's source map is not published.
rmSync(`${OUT}/dist/extension.js.map`, { force: true });

execFileSync("vsce", ["package", "--no-dependencies", "--out", `../4pm-vscode-${published.version}.vsix`], {
  cwd: OUT,
  stdio: "inherit",
});
