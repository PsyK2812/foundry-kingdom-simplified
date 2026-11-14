/**
 * Build kingdom-simplified.zip with the module files at the zip's root (what Foundry's manifest install expects).
 * Usage: npm run release
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ZIP = path.join(ROOT, "kingdom-simplified.zip");
const INCLUDE = ["module.json", "README.md", "scripts", "templates", "styles", "lang", "icons", "packs"];

fs.rmSync(path.join(ROOT, "src/packs/_json"), { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
execFileSync("zip", ["-rq", ZIP, ...INCLUDE, "-x", "packs/*/LOCK", "packs/*/LOG*"], { cwd: ROOT, stdio: "inherit" });
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
console.log(`kingdom-simplified.zip built for v${version}`);
