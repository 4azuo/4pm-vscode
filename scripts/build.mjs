/**
 * Bundle the extension with esbuild into one CommonJS file (`dist/extension.js`): the @4pm/* workspace packages and
 * their deps go inside, only the `vscode` module stays external (the editor provides it).
 * Flags: `--watch` rebuilds on change, `--production` minifies without source maps.
 * @adr 0670
 */
import { context } from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const ctx = await context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
