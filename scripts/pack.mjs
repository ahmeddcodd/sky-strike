// Packages the production build into an uploadable YouTube Playables zip.
//
// Playables rules honored here:
//   - index.html at the ROOT of the zip (dist/ contents, not the dist/ folder)
//   - relative asset paths (vite base: "./")
//   - fully self-contained: the only external request is the youtube.com SDK
//   - well under the limits (zip <= 200 MB, initial load < 30 MB, no file > 30 MB)
//
// It also strips `crossorigin` from the built tags: the bundle is same-origin
// inside the sandbox, and the attribute can trigger a needless CORS check.
//
// Uses PowerShell's Compress-Archive (present on Windows) so there's no extra
// dependency. Run: `node scripts/pack.mjs` (or `npm run pack`).

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const dist = join(root, "dist");
const htmlPath = join(dist, "index.html");
const name = "sky-strike-playables.zip";
const zipPath = join(root, name);

if (!existsSync(htmlPath)) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

// 1. clean the built HTML: drop crossorigin (same-origin in the sandbox)
let html = readFileSync(htmlPath, "utf8");
html = html.replace(/\s+crossorigin(=(["'])[^"']*\2)?/g, "");
writeFileSync(htmlPath, html);

// 2. sanity: index.html must be at the root and reference the SDK + relative assets
if (!/src="https:\/\/www\.youtube\.com\/game_api\/v1"/.test(html)) {
  console.error("SDK script tag missing from index.html — aborting.");
  process.exit(1);
}
if (/(src|href)="\/(?!\/)/.test(html)) {
  console.error("Absolute asset paths found (need base: './') — aborting.");
  process.exit(1);
}

// 3. size guardrails (fail loudly if a limit is approached)
const files = [];
const walk = (dir, rel = "") => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(abs, r);
    else files.push({ path: r, size: statSync(abs).size });
  }
};
walk(dist);
const total = files.reduce((n, f) => n + f.size, 0);
const biggest = files.reduce((a, b) => (b.size > a.size ? b : a));
const MB = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
if (biggest.size > 30 * 1024 * 1024) {
  console.error(`File exceeds 30 MB limit: ${biggest.path} (${MB(biggest.size)})`);
  process.exit(1);
}
if (total > 30 * 1024 * 1024) {
  console.warn(`WARNING: uncompressed total ${MB(total)} exceeds the 30 MB initial-load budget.`);
}

// 4. zip the CONTENTS of dist (index.html lands at the zip root)
rmSync(zipPath, { force: true });
execFileSync("powershell", [
  "-NoProfile", "-Command",
  `Compress-Archive -Path '${dist}\\*' -DestinationPath '${zipPath}' -Force`,
], { stdio: "inherit" });

const zipSize = statSync(zipPath).size;
console.log("\n=== Playables package ready ===");
console.log(`zip:            ${name}`);
console.log(`zip size:       ${MB(zipSize)}   (limit 200 MB)`);
console.log(`uncompressed:   ${MB(total)}   (initial load limit 30 MB)`);
console.log(`files:          ${files.length}`);
console.log(`largest file:   ${biggest.path} — ${MB(biggest.size)}   (limit 30 MB)`);
console.log(`entry:          index.html at zip root`);
