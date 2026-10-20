import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

const roots = ["caderno/js", "netlify", "scripts", "tests"];
const extensions = new Set([".js", ".mjs"]);

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collect(path);
    return extensions.has(extname(entry.name)) ? [path] : [];
  });
}

const files = [...roots.flatMap(collect), "caderno/serve.mjs", "playwright.config.js"];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Sintaxe válida em ${files.length} arquivos.`);
