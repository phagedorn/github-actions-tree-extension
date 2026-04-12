import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const config = (entryPoint, outfile) => ({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  format: "iife",
  minify: false,
  sourcemap: watch,
  logLevel: "info",
});

if (watch) {
  const ctxContent = await esbuild.context(config("src/content.js", "content.js"));
  const ctxOptions = await esbuild.context(config("src/options.js",  "options.js"));
  await ctxContent.watch();
  await ctxOptions.watch();
  console.log("Watching for changes… (Ctrl-C to stop)");
} else {
  await esbuild.build(config("src/content.js", "content.js"));
  await esbuild.build(config("src/options.js",  "options.js"));
  console.log("Build complete.");
}
